// Encoder Adapter — Transformers.js feature-extraction pipeline singleton
// Provides: batch encoding, WebGPU/WASM backend detection, hash cache, retry logic
//
// All browser-specific code (Transformers.js import, chrome API, navigator) is
// deferred to initEncoder() so this module can be safely imported in Node.js tests.

// ---------------------------------------------------------------------------
// Lazy-loaded browser dependencies (set by initTransformersRuntime)
// ---------------------------------------------------------------------------

let _env = null;
let _pipeline = null;
let _scheduleGpuTask = null;
let _runtimeReady = false;

/**
 * Load Transformers.js and GPU scheduler at runtime.
 * Called once from initEncoder(). No-ops on subsequent calls.
 * Separated from module scope so Node.js tests can import this file
 * without triggering browser-only code.
 */
async function initTransformersRuntime() {
  if (_runtimeReady) return;

  const transformers = await import('../libs/transformers/transformers.js');
  _env = transformers.env;
  _pipeline = transformers.pipeline;

  const scheduler = await import('./modules/gpu-scheduler.js');
  _scheduleGpuTask = scheduler.scheduleGpuTask;

  // Configure ONNX WASM paths BEFORE any pipeline() call (Pitfall 2 in research)
  // Must point to vendored files via extension URL to satisfy MV3 CSP
  _env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('libs/transformers/');

  // Load MiniLM from the bundled copy — no runtime HuggingFace fetch. This
  // eliminates the whole "HF moved a host and CSP blocks the download" failure
  // class (Xet migration, LFS host changes, revocation). Model files live under
  // extension/libs/models/ (vendored by scripts/vendor-minilm.sh, pinned to
  // MODEL_REVISION). CSP connect-src is 'self' only.
  _env.allowRemoteModels = false;
  _env.allowLocalModels = true;
  _env.localModelPath = chrome.runtime.getURL('libs/models/');
  _env.useBrowserCache = false; // bundled files are already local; no cache needed

  _runtimeReady = true;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// HuggingFace commit the bundled model files were vendored from. The model is
// shipped locally (extension/libs/models/), so this is not fetched at runtime;
// it is the provenance/pin used by scripts/vendor-minilm.sh. To rotate: verify a
// new commit at https://huggingface.co/Xenova/all-MiniLM-L6-v2/commits/main,
// update here, and re-run the vendor script.
const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';

let encoderPipeline = null;
let encoderState = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
let backendUsed = null;    // 'webgpu' | 'wasm' | null
let initPromise = null;    // Prevent double-init (single in-flight promise)

// Embedding hash cache — keyed by simpleHash(message.text)
const embeddingCache = new Map();
const MAX_CACHE_SIZE = 2000; // ~3MB max at 384 floats * 4 bytes per entry

// Adaptive batch queue
let encodingQueue = [];
let flushTimer = null;
const MIN_BATCH = 10;
const MAX_BATCH = 50;
const TIME_FLUSH_MS = 8000; // 8s timeout for slow chats

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * djb2-style hash — fast, no external library needed for short chat messages.
 * @param {string} str
 * @returns {string} hash as base-36 string
 */
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit int
  }
  return hash.toString(36);
}

/**
 * Evict oldest entries when cache exceeds MAX_CACHE_SIZE.
 * Map preserves insertion order, so first keys are oldest.
 */
function trimCache() {
  if (embeddingCache.size > MAX_CACHE_SIZE) {
    const toDelete = embeddingCache.size - MAX_CACHE_SIZE;
    let count = 0;
    for (const key of embeddingCache.keys()) {
      if (count >= toDelete) break;
      embeddingCache.delete(key);
      count++;
    }
    console.log(`[Encoder] Cache evicted ${toDelete} old entries`);
  }
}

/**
 * Execute encoding for a batch and invoke callback with results.
 * @param {Array} batch — message objects with .text property
 * @param {Function} onBatchReady — called with (batch, embeddings)
 */
async function flushQueue(onBatchReady) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (encodingQueue.length === 0) return;

  const batch = encodingQueue.splice(0, MAX_BATCH);
  try {
    const startTime = Date.now();
    const embeddings = await encodeMessages(batch);
    const durationMs = Date.now() - startTime;
    if (onBatchReady && embeddings) {
      onBatchReady(batch, embeddings, durationMs);
    }
  } catch (err) {
    console.log('[Encoder] flushQueue error:', err);
  }

  // Re-schedule if items remain after this batch
  if (encodingQueue.length > 0) {
    flushTimer = setTimeout(() => flushQueue(onBatchReady), TIME_FLUSH_MS);
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Initialize the feature-extraction pipeline.
 * Tries WebGPU first; falls back to WASM on failure.
 * Runs a warm-up inference after loading to prime the JIT.
 *
 * @param {Function} onProgress — called with progress event objects
 * @returns {Promise<pipeline>} the loaded pipeline
 */
async function initEncoder(onProgress) {
  if (encoderState === 'ready') return encoderPipeline;

  // Return existing in-flight promise to prevent double-init
  if (initPromise) return initPromise;

  initPromise = (async () => {
    encoderState = 'loading';

    // Load Transformers.js and GPU scheduler on first call
    await initTransformersRuntime();

    // WebGPU detection — Transformers.js does NOT auto-fallback (Pitfall 3)
    let device = 'wasm';
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          device = 'webgpu';
          console.log('[Encoder] WebGPU adapter found, attempting WebGPU backend');
        }
      } catch (e) {
        console.log('[Encoder] WebGPU requestAdapter failed, using WASM:', e);
      }
    }

    backendUsed = device;

    // Defensive progress callback — some events lack status/progress (Pitfall 4)
    const progressCallback = (event) => {
      if (!event) return;
      const status = event.status ?? 'unknown';
      const progress = event.progress ?? 0;
      if (onProgress) {
        onProgress({ ...event, status, progress });
      }
    };

    // First attempt: preferred device (WebGPU or WASM)
    try {
      console.log(`[Encoder] Loading ${MODEL_ID} with device: ${device}`);
      const startTime = Date.now();

      encoderPipeline = await _pipeline('feature-extraction', MODEL_ID, {
        device,
        dtype: 'q8',
        progress_callback: progressCallback,
      });

      console.log(`[Encoder] Pipeline loaded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    } catch (err) {
      if (device === 'webgpu') {
        // WebGPU failed — fall back to WASM (Pitfall 3)
        console.log('[Encoder] WebGPU init failed, falling back to WASM:', err);
        backendUsed = 'wasm';

        encoderPipeline = await _pipeline('feature-extraction', MODEL_ID, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: progressCallback,
        });
      } else {
        // WASM itself failed — propagate error
        encoderState = 'error';
        initPromise = null;
        throw err;
      }
    }

    // Warm-up run to prime GPU/WASM JIT before first real encode
    // Route through scheduler so warm-up counts as the first GPU task in the queue
    console.log('[Encoder] Running warm-up inference...');
    await _scheduleGpuTask('encoder', 1, () =>
      encoderPipeline(['warm up'], { pooling: 'mean', normalize: true })
    );
    console.log(`[Encoder] Warm-up complete. Backend: ${backendUsed}`);

    // Signal fully ready to caller
    if (onProgress) {
      onProgress({ status: 'ready', progress: 100 });
    }

    encoderState = 'ready';
    return encoderPipeline;
  })();

  return initPromise;
}

/**
 * Initialize with automatic retry on failure (3 attempts, exponential backoff).
 * Calls onError with user-facing messages on each retry and final failure.
 *
 * @param {Function} onProgress — forwarded to initEncoder
 * @param {Function} onError — called with user-facing error string
 * @returns {Promise<pipeline|null>} pipeline on success, null after exhausted retries
 */
async function initEncoderWithRetry(onProgress, onError) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Reset state so initEncoder runs fresh after a previous failure
      if (encoderState === 'error' || (attempt > 1 && initPromise)) {
        encoderState = 'idle';
        initPromise = null;
        encoderPipeline = null;
      }
      return await initEncoder(onProgress);
    } catch (err) {
      console.log(`[Encoder] Init attempt ${attempt}/${MAX_RETRIES} failed:`, err);

      if (attempt < MAX_RETRIES) {
        const msg = `Download failed, retrying... (${attempt}/${MAX_RETRIES})`;
        if (onError) onError(msg);
        // Exponential backoff: 1s, 2s
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      } else {
        // All retries exhausted
        encoderState = 'error';
        initPromise = null;
        const finalMsg = 'Semantic engine unavailable \u2014 using keyword analysis';
        if (onError) onError(finalMsg);
        return null;
      }
    }
  }

  return null;
}

/**
 * Encode an array of message objects using the hash cache.
 * Only new (unseen) message texts are sent to the pipeline.
 * Returns embeddings for ALL input messages in input order.
 *
 * @param {Array<{text: string}>} messages
 * @returns {Promise<Array<number[]>|null>} array of 384-dim embedding arrays, or null if not ready
 */
async function encodeMessages(messages) {
  if (!encoderPipeline) {
    console.log('[Encoder] encodeMessages called but pipeline not ready');
    return null;
  }

  // Filter to messages not yet in cache
  const newMessages = messages.filter(m => !embeddingCache.has(simpleHash(m.text)));
  const cachedCount = messages.length - newMessages.length;

  if (newMessages.length > 0) {
    const texts = newMessages.map(m => m.text);
    // Route GPU inference through scheduler — only the pipeline call touches the GPU;
    // cache lookups and cache writes are CPU-only and stay outside the scheduler
    const output = await _scheduleGpuTask('encoder', 1, () =>
      encoderPipeline(texts, { pooling: 'mean', normalize: true })
    );
    const embeddings = output.tolist(); // number[][], shape [n, 384]

    newMessages.forEach((msg, i) => {
      embeddingCache.set(simpleHash(msg.text), embeddings[i]);
    });

    trimCache();
  }

  console.log(`[Encoder] Encoded ${newMessages.length} new, ${cachedCount} cached (cache size: ${embeddingCache.size})`);

  // Return embeddings in input order (all from cache now)
  return messages.map(m => embeddingCache.get(simpleHash(m.text)));
}

/**
 * Adaptive batch scheduler — push messages into queue and flush when ready.
 * Flushes immediately when queue reaches MAX_BATCH; otherwise waits TIME_FLUSH_MS.
 *
 * @param {Array} messages — message objects to schedule
 * @param {Function} onBatchReady — called with (batch, embeddings) when a batch is encoded
 */
function scheduleEncode(messages, onBatchReady) {
  encodingQueue.push(...messages);

  if (encodingQueue.length >= MAX_BATCH) {
    flushQueue(onBatchReady);
    return;
  }

  // Reset time-based flush timer
  if (flushTimer) clearTimeout(flushTimer);
  if (encodingQueue.length > 0) {
    flushTimer = setTimeout(() => flushQueue(onBatchReady), TIME_FLUSH_MS);
  }
}

/**
 * Return current encoder state string.
 * @returns {'idle'|'loading'|'ready'|'error'}
 */
function getEncoderState() {
  return encoderState;
}

/**
 * Return backend info for display in Settings page.
 * @returns {{ state: string, backend: string|null }}
 */
function getBackendInfo() {
  return { state: encoderState, backend: backendUsed };
}

/**
 * Reset encoder to initial state — clears pipeline, cache, and queue.
 * Call before reloading the extension or on teardown.
 */
function resetEncoder() {
  // Transformers.js pipelines don't expose explicit dispose — set to null for GC
  encoderPipeline = null;
  initPromise = null;
  encoderState = 'idle';
  backendUsed = null;

  embeddingCache.clear();

  encodingQueue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  console.log('[Encoder] Reset complete');
}

export {
  initEncoder,
  initEncoderWithRetry,
  encodeMessages,
  scheduleEncode,
  getEncoderState,
  getBackendInfo,
  resetEncoder,
};
