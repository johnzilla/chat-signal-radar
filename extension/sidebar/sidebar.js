// All innerHTML must use DOMPurify
// Sidebar script - loads WASM and processes chat messages

import { initializeLLM, summarizeBuckets, analyzeSentiment, computeFallbackSentiment, isLLMReady, resetLLM, isInFallback, getFallbackReason, retryLLM } from '../llm-adapter.js';
import { saveSession, loadSessions, deleteSession, clearAllSessions } from '../storage-manager.js';
import { safeSetHTML, DOMPURIFY_CONFIG, escapeHtml, safeCreateElement } from './utils/DOMHelpers.js';
import { initEncoderWithRetry, scheduleEncode, getEncoderState, getBackendInfo, resetEncoder } from './encoder-adapter.js';
import { buildPrototypes, classifyBatch, isSemanticReady, setSemanticMode, setKeywordMode, getMode } from './cosine-router.js';
import { ROUTING_CONFIG } from './routing-config.js';
import { DEFAULT_SETTINGS } from '../settings-defaults.js';
import { validateMessages as _validateMessages, validateAnalysisResult as _validateAnalysisResult, validateSettings as _validateSettings } from './utils/ValidationHelpers.js';

const DEBUG = false;
const isTestEnv = typeof globalThis !== 'undefined' && globalThis.__CHAT_SIGNAL_RADAR_TEST__ === true;

let wasmModule = null;
let llmEnabled = false;
let llmLoading = false;

let settings = { ...DEFAULT_SETTINGS };

// Mood emoji mapping
const MOOD_EMOJIS = {
  excited: '🎉',
  positive: '😊',
  angry: '😠',
  negative: '😔',
  confused: '🤔',
  neutral: '😐'
};

// Throttle sentiment analysis to every 10 seconds
let lastSentimentUpdate = 0;
const SENTIMENT_UPDATE_INTERVAL = 10000;

// Throttle AI summary generation to every 30 seconds
let lastSummaryUpdate = 0;
const SUMMARY_UPDATE_INTERVAL = 30000;

// DOM elements
const statusText = document.getElementById('status-text');
const statusDiv = document.getElementById('status');
const statsDiv = document.getElementById('stats');
const processedCount = document.getElementById('processed-count');
const clustersDiv = document.getElementById('clusters');
const errorDiv = document.getElementById('error');
const aiSummaryDiv = document.getElementById('ai-summary');
const aiSummaryText = document.getElementById('ai-summary-text');

// New DOM elements for mood and topics
const moodSection = document.getElementById('mood-section');
const moodEmoji = document.getElementById('mood-emoji');
const moodLabel = document.getElementById('mood-label');
const moodConfidence = document.getElementById('mood-confidence');
const moodSummary = document.getElementById('mood-summary');
const sentimentSamples = document.getElementById('sentiment-samples');
const topicsSection = document.getElementById('topics-section');
const topicsCloud = document.getElementById('topics-cloud');
const firstRunDiv = document.getElementById('first-run');
const settingsLink = document.getElementById('settings-link');
const endSessionBtn = document.getElementById('end-session-btn');
const summaryModal = document.getElementById('summary-modal');
const saveSummaryBtn = document.getElementById('save-summary-btn');
const copySummaryBtn = document.getElementById('copy-summary-btn');
const closeSummaryBtn = document.getElementById('close-summary-btn');
const exportBtn = document.getElementById('export-btn');
const exportMenu = document.getElementById('export-menu');
const exportJsonBtn = document.getElementById('export-json-btn');
const exportMdBtn = document.getElementById('export-md-btn');
const copyToast = document.getElementById('copy-toast');

// First-run AI note elements
const llmAiNote = document.getElementById('llm-ai-note');
const llmEnableBtn = document.getElementById('llm-enable-btn');
const llmSkipBtn = document.getElementById('llm-skip-btn');

// Stream ended prompt elements
const streamEndedPrompt = document.getElementById('stream-ended-prompt');
const saveSessionBtn = document.getElementById('save-session-btn');
const dismissPromptBtn = document.getElementById('dismiss-prompt-btn');

// Tab and history elements
const liveTab = document.getElementById('live-tab');
const historyTab = document.getElementById('history-tab');
const historyView = document.getElementById('history-view');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// Encoder progress bar elements
const encoderProgress = document.getElementById('encoder-progress');
const encoderProgressFill = document.getElementById('encoder-progress-fill');
const encoderProgressText = document.getElementById('encoder-progress-text');

// Clustering mode badge elements
const clustersHeader = document.getElementById('clusters-header');
const clusteringModeBadge = document.getElementById('clustering-mode-badge');

// Fallback notice elements
const fallbackNotice = document.getElementById('ai-fallback-notice');
const retryAiBtn = document.getElementById('retry-ai-btn');

// System status panel elements
const ssAnalysis = document.getElementById('ss-analysis');
const ssSemantic = document.getElementById('ss-semantic');
const ssAi = document.getElementById('ss-ai');

// Encoder state
let encoderReady = false;

// Update the clustering mode badge text ('Semantic' or 'Keyword')
function updateClusteringBadge(mode) {
  if (clusteringModeBadge) clusteringModeBadge.textContent = mode;
}

// Update the system status traffic light panel
function updateSystemStatus() {
  // Helper to set dot class and tooltip
  function setDot(el, dotClass, tooltip) {
    if (!el) return;
    const dot = el.querySelector('.system-status-dot');
    if (dot) {
      dot.className = 'system-status-dot ' + dotClass;
    }
    el.title = tooltip;
  }

  // --- Analysis (WASM) ---
  if (wasmModule !== null) {
    setDot(ssAnalysis, 'dot-ready', 'Analysis engine: ready');
  } else if (errorDiv && !errorDiv.classList.contains('hidden')) {
    setDot(ssAnalysis, 'dot-error', 'Analysis engine: failed to load');
  } else {
    setDot(ssAnalysis, 'dot-loading', 'Analysis engine: loading...');
  }

  // --- Semantic (encoder + cosine router) ---
  const encoderState = getEncoderState();
  if (encoderReady && isSemanticReady()) {
    const backend = getBackendInfo();
    setDot(ssSemantic, 'dot-ready', `Semantic engine: active (${backend.backend})`);
  } else if (encoderReady && !isSemanticReady()) {
    setDot(ssSemantic, 'dot-ready', 'Encoder ready, keyword mode');
  } else if (encoderState === 'loading') {
    setDot(ssSemantic, 'dot-loading', 'Semantic engine: downloading model...');
  } else if (encoderState === 'error') {
    setDot(ssSemantic, 'dot-error', 'Semantic engine: unavailable');
  } else {
    setDot(ssSemantic, 'dot-loading', 'Semantic engine: loading...');
  }

  // --- AI (Nano) ---
  if (!settings.aiSummariesEnabled && !llmLoading) {
    setDot(ssAi, 'dot-off', 'AI summaries: off');
    if (ssAi) ssAi.classList.add('clickable');
  } else if (llmLoading) {
    setDot(ssAi, 'dot-loading', 'AI: downloading model...');
    if (ssAi) ssAi.classList.remove('clickable');
  } else if (isLLMReady() && !isInFallback()) {
    setDot(ssAi, 'dot-ready', 'AI summaries: active');
    if (ssAi) ssAi.classList.remove('clickable');
  } else if (isInFallback()) {
    const reason = getFallbackReason();
    let tooltip;
    if (reason === 'no-gpu') {
      tooltip = 'AI: needs a GPU \u2014 using rule-based analysis';
    } else if (reason === 'garbage') {
      tooltip = 'AI: model not responding \u2014 using rule-based analysis';
    } else {
      tooltip = 'AI: could not load \u2014 using rule-based analysis';
    }
    setDot(ssAi, 'dot-off', tooltip);
    if (ssAi) ssAi.classList.remove('clickable');
  } else {
    setDot(ssAi, 'dot-off', 'AI summaries: off');
    if (ssAi) ssAi.classList.add('clickable');
  }
}

// Session tracking
let sessionStartTime = null;
let lastAnalysisResult = null;
let lastSemanticBuckets = null; // Latest cosine-routed buckets when semantic mode is active
let currentPlatform = null;
let currentStreamTitle = null;
let currentStreamUrl = null;
let currentMood = 'neutral';

// Accumulate questions across entire session (not just last 100 messages)
let sessionQuestions = [];
const MAX_SESSION_QUESTIONS = 50; // Keep up to 50 unique questions per session

// Total messages seen this session (cumulative, doesn't decrease)
let totalMessageCount = 0;

// Cumulative sentiment counts for entire session
let sessionSentiment = {
  positive_count: 0,
  negative_count: 0,
  confused_count: 0,
  neutral_count: 0
};

// Inactivity detection
let lastMessageTime = null;
let inactivityCheckInterval = null;

// Current view state
let currentView = 'live'; // 'live' or 'history'
let currentDetailSession = null; // Session being viewed in detail modal

// Settings link opens options page
if (!isTestEnv) {
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Click AI dot to open Settings when AI is off
  ssAi.addEventListener('click', () => {
    if (!settings.aiSummariesEnabled) {
      chrome.runtime.openOptionsPage();
    }
  });

  // End session button
  endSessionBtn.addEventListener('click', showSessionSummary);

  // Modal buttons
  saveSummaryBtn.addEventListener('click', async () => {
    saveSummaryBtn.disabled = true;
    saveSummaryBtn.textContent = 'Saving...';
    await saveCurrentSession();
    saveSummaryBtn.textContent = 'Saved!';
    setTimeout(() => startNewSession(), 600);
  });
  copySummaryBtn.addEventListener('click', copySummaryToClipboard);
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('hidden');
  });
  exportJsonBtn.addEventListener('click', () => exportSession('json'));
  exportMdBtn.addEventListener('click', () => exportSession('markdown'));
  document.addEventListener('click', () => exportMenu.classList.add('hidden'));
  closeSummaryBtn.addEventListener('click', startNewSession);

  // Close modal on backdrop click
  summaryModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    summaryModal.classList.add('hidden');
    exportMenu.classList.add('hidden');
  });

  // First-run AI note handlers
  llmEnableBtn.addEventListener('click', async () => {
    llmAiNote.classList.add('hidden');
    // Update the unified aiSummariesEnabled setting
    const updatedSettings = { ...settings, aiSummariesEnabled: true };
    settings = updatedSettings;
    await chrome.storage.sync.set({ settings: updatedSettings, aiConsentShown: true });
    startLLMInitialization();
  });

  llmSkipBtn.addEventListener('click', async () => {
    llmAiNote.classList.add('hidden');
    // Mark the note as shown, keep aiSummariesEnabled as false
    await chrome.storage.sync.set({ aiConsentShown: true });
    llmEnabled = false;
    statusText.textContent = 'Ready! Waiting for chat messages...';
    updateSystemStatus();
  });

  // Retry AI button: re-initialize the LLM engine after entering fallback mode
  if (retryAiBtn) {
    retryAiBtn.addEventListener('click', async () => {
      if (fallbackNotice) fallbackNotice.classList.add('hidden');
      retryAiBtn.disabled = true;
      llmLoading = true;
      statusText.textContent = 'Reloading AI…';
      updateSystemStatus();
      try {
        await retryLLM((progress) => {
          statusText.textContent = `Loading AI: ${Math.round(progress.progress * 100)}%`;
        });
        llmEnabled = true;
        if (isInFallback()) {
          statusText.textContent = 'Could not start AI \u2014 rule-based analysis active';
        } else {
          statusText.textContent = 'AI ready!';
        }
      } catch (error) {
        console.warn('[Sidebar] AI retry failed:', error);
        llmEnabled = false;
        statusText.textContent = 'AI unavailable \u2014 using rule-based analysis';
      }
      llmLoading = false;
      retryAiBtn.disabled = false;
      updateFallbackNotice();
      updateSystemStatus();
    });
  }

  // Stream ended prompt handlers
  saveSessionBtn.addEventListener('click', async () => {
    streamEndedPrompt.classList.add('hidden');
    await saveCurrentSession();
    showSessionSummary();
    // Mark save button as already saved since inactivity prompt auto-saved
    if (saveSummaryBtn) {
      saveSummaryBtn.disabled = true;
      saveSummaryBtn.textContent = 'Saved!';
    }
  });

  dismissPromptBtn.addEventListener('click', () => {
    streamEndedPrompt.classList.add('hidden');
  });

  // Tab handlers
  liveTab.addEventListener('click', () => switchToView('live'));
  historyTab.addEventListener('click', () => switchToView('history'));

  // Clear history button
  clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Clear all session history? This cannot be undone.')) {
      await clearAllSessions();
      renderHistoryList([]);
    }
  });

  // GPU scheduler: handle permanent GPU loss
  // When the WebGPU device is lost unexpectedly, the scheduler broadcasts this event
  // so the sidebar falls back to WASM-only mode on the next analysis cycle
  window.addEventListener('gpu-unavailable', (event) => {
    console.warn('[Sidebar] GPU unavailable, falling back to WASM-only mode:', event.detail);
    encoderReady = false;
    setKeywordMode();
    updateClusteringBadge('Keyword');
    updateSystemStatus();
    // Encoder will continue to function via WASM backend on next init
    // No UI change needed — analysis gate falls through when encoderReady is false
  });
}


// Load settings from chrome.storage
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    const merged = { ...DEFAULT_SETTINGS, ...result.settings };
    try {
      _validateSettings(merged);
      settings = merged;
    } catch (validationError) {
      console.warn('[Sidebar] Stored settings invalid, using defaults:', validationError.message);
      settings = { ...DEFAULT_SETTINGS };
    }
    updateAiSummaryState();
  } catch (error) {
    console.warn('[Sidebar] Failed to load settings, using defaults:', error);
    settings = { ...DEFAULT_SETTINGS };
    updateAiSummaryState();
  }
}

// Listen for settings changes
if (!isTestEnv) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      updateAiSummaryState();
    }
  });
}

// Initialize encoder pipeline with stage-aware progress bar
async function initEncoderOnStartup() {
  // Detect warm start (MiniLM already cached from a previous session)
  const { miniLMCached } = await chrome.storage.local.get('miniLMCached');
  const encoderStatusText = document.getElementById('encoder-status-text');

  if (encoderStatusText) {
    encoderStatusText.textContent = miniLMCached
      ? 'Restoring semantic engine...'
      : 'Loading semantic engine...';
    encoderStatusText.classList.remove('hidden');
  }

  // Show progress bar
  encoderProgress.classList.remove('hidden');

  const onProgress = (event) => {
    if (!event || !event.status) return;

    const progress = event.progress ?? 0;

    switch (event.status) {
      case 'initiate':
      case 'download':
        encoderProgressText.textContent = 'Downloading model...';
        encoderProgressFill.style.width = '0%';
        break;
      case 'progress':
        encoderProgressText.textContent = 'Downloading model...';
        encoderProgressFill.style.width = `${Math.round(progress)}%`;
        break;
      case 'done':
        encoderProgressText.textContent = 'Initializing encoder...';
        encoderProgressFill.style.width = '95%';
        break;
      case 'ready':
        encoderProgressText.textContent = 'Warming up...';
        encoderProgressFill.style.width = '99%';
        break;
      default:
        break;
    }
  };

  const onError = (message) => {
    encoderProgress.classList.add('error');
    encoderProgressText.textContent = message;

    // Final failure: brief error display then hide and continue in WASM-only fallback
    if (message.includes('unavailable')) {
      setTimeout(() => {
        encoderProgress.classList.add('fade-out');
      }, 4000);
      setTimeout(() => {
        encoderProgress.classList.add('hidden');
      }, 5000);
      encoderReady = false;
      updateSystemStatus();

      // Hide status text on final encoder failure
      const encoderStatusEl = document.getElementById('encoder-status-text');
      if (encoderStatusEl) encoderStatusEl.classList.add('hidden');
    }
  };

  const result = await initEncoderWithRetry(onProgress, onError);

  // Hide encoder status text regardless of outcome (success or non-unavailable error)
  if (encoderStatusText) {
    encoderStatusText.classList.add('hidden');
  }

  if (result !== null) {
    // Success — fill to 100%, fade out progress bar
    encoderProgressFill.style.width = '100%';
    encoderProgressText.textContent = '';

    setTimeout(() => {
      encoderProgress.classList.add('fade-out');
    }, 500);
    setTimeout(() => {
      encoderProgress.classList.add('hidden');
    }, 1300);

    encoderReady = true;

    // Build cosine routing prototype vectors from seed phrases
    try {
      await buildPrototypes();
      setSemanticMode();
      updateClusteringBadge('Semantic');
      console.log('[Sidebar] Semantic clustering activated');
    } catch (err) {
      console.warn('[Sidebar] Failed to build prototypes, staying in keyword mode:', err);
    }

    updateSystemStatus();

    // Store backend info for Settings page display
    chrome.storage.local.set({ encoderBackend: getBackendInfo() });
    console.log(`[Encoder] Ready, backend: ${getBackendInfo().backend}`);

    // Mark MiniLM as cached so next session shows "Restoring..." instead of "Loading..."
    chrome.storage.local.set({ miniLMCached: true });

    // Catch-up: encode messages that arrived during the loading window
    if (allMessages && allMessages.length > 0) {
      console.log(`[Encoder] Catch-up: encoding ${allMessages.length} buffered messages`);
      scheduleEncode(allMessages, (batch, embeddings) => {
        console.log(`[Encoder] Catch-up batch encoded: ${batch.length} messages`);
      });
    }
  }
}

// Initialize WASM module
async function initWasm() {
  try {
    statusText.textContent = 'Loading settings...';
    await loadSettings();

    statusText.textContent = 'Loading clustering engine...';

    // Import the WASM module
    const wasmPath = chrome.runtime.getURL('wasm/wasm_engine.js');
    const { default: init, cluster_messages, analyze_chat, analyze_chat_with_settings } = await import(wasmPath);

    // Initialize WASM
    const wasmBinaryPath = chrome.runtime.getURL('wasm/wasm_engine_bg.wasm');
    await init(wasmBinaryPath);

    wasmModule = { cluster_messages, analyze_chat, analyze_chat_with_settings };
    updateSystemStatus();

    // Start encoder loading in background — non-blocking, does not delay WASM analysis
    // Messages arriving before encoder is ready are processed normally by WASM keyword clustering
    initEncoderOnStartup();

    // Check AI settings and show consent modal if needed
    await checkAISettings();

  } catch (error) {
    console.error('Failed to load WASM:', error);
    statusText.textContent = 'Error loading clustering engine';
    errorDiv.textContent = `Failed to load WASM: ${error.message}`;
    errorDiv.classList.remove('hidden');
    updateSystemStatus();
  }
}

// Check AI settings and show the first-run note if needed
async function checkAISettings() {
  try {
    const result = await chrome.storage.sync.get('aiConsentShown');

    if (settings.aiSummariesEnabled) {
      // AI is enabled, initialize the engine
      startLLMInitialization();
    } else if (result.aiConsentShown) {
      // User has seen the first-run note before and chose not to enable
      llmEnabled = false;
      statusText.textContent = 'Ready! Waiting for chat messages...';
      updateSystemStatus();
    } else {
      // First time — show the lightweight on-device-AI note (no download to
      // disclose; Nano runs locally via Chrome's built-in model).
      statusText.textContent = 'Ready! Waiting for chat messages...';
      llmAiNote.classList.remove('hidden');
    }
  } catch (error) {
    console.warn('[Sidebar] Failed to check AI settings:', error);
    statusText.textContent = 'Ready! Waiting for chat messages...';
  }
}

// Start LLM initialization after consent
function startLLMInitialization() {
  llmLoading = true;
  statusText.textContent = 'Loading on-device AI…';
  updateSystemStatus();

  initializeLLM((progress) => {
    statusText.textContent = `Loading AI: ${Math.round(progress.progress * 100)}%`;
  }).then(() => {
    llmLoading = false;
    llmEnabled = true;
    if (isInFallback()) {
      const reason = getFallbackReason();
      if (reason === 'no-gpu') {
        statusText.textContent = 'No compatible GPU \u2014 using rule-based analysis';
      } else {
        statusText.textContent = 'AI unavailable \u2014 using rule-based analysis';
      }
    } else {
      statusText.textContent = 'Ready! Waiting for chat messages...';
    }
    updateFallbackNotice();
    updateSystemStatus();
    if (DEBUG) console.log('[Sidebar] LLM initialized');
  }).catch((error) => {
    llmLoading = false;
    console.warn('[Sidebar] LLM initialization failed, continuing without AI summaries:', error);
    llmEnabled = false;
    statusText.textContent = 'AI unavailable \u2014 using rule-based analysis';
    updateFallbackNotice();
    updateSystemStatus();
  });
}

function updateAiSummaryState() {
  if (settings.aiSummariesEnabled) {
    if (!isLLMReady() && !llmEnabled) {
      startLLMInitialization();
    }
  } else {
    aiSummaryDiv.classList.add('hidden');
    llmEnabled = false;
    resetLLM();
    updateSystemStatus();
  }
}

// Build semantic bucket objects from cosine-classified messages
function buildSemanticBuckets(messages, labels) {
  const bucketMap = new Map([
    ['Questions', { label: 'Questions', count: 0, sample_messages: [] }],
    ['Issues/Bugs', { label: 'Issues/Bugs', count: 0, sample_messages: [] }],
    ['Requests', { label: 'Requests', count: 0, sample_messages: [] }],
    ['General Chat', { label: 'General Chat', count: 0, sample_messages: [] }],
  ]);

  messages.forEach((msg, i) => {
    const label = labels[i];
    const bucket = bucketMap.get(label);
    if (bucket) {
      bucket.count++;
      if (bucket.sample_messages.length < 3) {
        bucket.sample_messages.push(msg.text);
      }
    }
  });

  return [...bucketMap.values()].filter(b => b.count > 0);
}

// Process incoming messages
function processMessages(messages) {
  if (!wasmModule) {
    console.error('WASM module not loaded');
    return;
  }

  try {
    // Validate input messages
    validateMessages(messages);
    
    // Use combined analysis function with settings for spam filtering
    const result = wasmModule.analyze_chat_with_settings(
      messages,
      settings.topicMinCount,
      settings.spamThreshold,
      settings.duplicateWindow * 1000  // convert to milliseconds
    );

    // Comprehensive validation of WASM output
    validateAnalysisResult(result);

    // Update UI
    statusDiv.classList.add('active');
    if (!llmLoading) {
      statusText.textContent = 'Processing live chat...';
    }
    statsDiv.classList.remove('hidden');
    processedCount.textContent = totalMessageCount;

    // Update window stats indicator
    const windowCurrentEl = document.getElementById('window-current');
    const windowMaxEl = document.getElementById('window-max');
    if (windowCurrentEl) windowCurrentEl.textContent = messages.length;
    if (windowMaxEl) windowMaxEl.textContent = settings.analysisWindowSize || 500;

    // Hide first-run guidance once we have messages
    firstRunDiv.classList.add('hidden');

    // Start session timer on first message
    if (!sessionStartTime) {
      sessionStartTime = Date.now();
    }

    // Show End Session button
    endSessionBtn.classList.remove('hidden');

    // Store latest analysis result for summary
    lastAnalysisResult = result;

    // While encoder is loading, allow WASM keyword clusters to render immediately.
    // Only the scheduleEncode call is skipped (encoder not ready for embeddings yet).
    // When encoder errors, encoderLoading is false and scheduleEncode is also skipped (encoderReady false).
    const encoderLoading = !encoderReady && getEncoderState() === 'loading';

    // Accumulate questions for the session summary
    const questionsBucket = result.buckets?.find(b => b.label === 'Questions');
    if (questionsBucket && questionsBucket.sample_messages) {
      questionsBucket.sample_messages.forEach(q => {
        // Add if not already in session questions (avoid duplicates)
        if (!sessionQuestions.includes(q)) {
          sessionQuestions.push(q);
          // Keep only the most recent questions if we exceed the limit
          if (sessionQuestions.length > MAX_SESSION_QUESTIONS) {
            sessionQuestions.shift();
          }
        }
      });
    }

    // Update trending topics
    updateTopics(result.topics);

    // Update mood indicator (throttled)
    const now = Date.now();
    if (now - lastSentimentUpdate > SENTIMENT_UPDATE_INTERVAL) {
      lastSentimentUpdate = now;
      updateMoodIndicator(messages, result.sentiment_signals, settings);
    }

    // Show the clusters-header alongside the clusters section
    if (clustersHeader) clustersHeader.classList.remove('hidden');

    // Clear previous clusters
    clustersDiv.innerHTML = '';

    if (result.buckets.length === 0) {
      safeSetHTML(clustersDiv, '<div class="empty-state"><p>No clusters yet. Keep chatting!</p></div>');
      return;
    }

    // Render cluster buckets - validate each bucket shape
    result.buckets.forEach(bucket => {
      if (!bucket.label || !bucket.count || !Array.isArray(bucket.sample_messages)) {
        console.warn('Invalid bucket shape:', bucket);
        return;
      }

      const bucketEl = document.createElement('div');
      bucketEl.className = 'cluster-bucket';

      // Build bucket content safely
      const headerDiv = safeCreateElement('div', 'cluster-header');
      const labelDiv = safeCreateElement('div', 'cluster-label', escapeHtml(bucket.label));
      const countDiv = safeCreateElement('div', 'cluster-count', bucket.count.toString());
      headerDiv.appendChild(labelDiv);
      headerDiv.appendChild(countDiv);
      
      const messagesDiv = safeCreateElement('div', 'cluster-messages');
      bucket.sample_messages.forEach(msg => {
        const msgDiv = safeCreateElement('div', 'message-item', escapeHtml(msg));
        messagesDiv.appendChild(msgDiv);
      });
      
      bucketEl.innerHTML = '';
      bucketEl.appendChild(headerDiv);
      bucketEl.appendChild(messagesDiv);

      clustersDiv.appendChild(bucketEl);
    });

    // Generate AI summary if enabled (throttled)
    if (llmEnabled && isLLMReady() && result.buckets.length > 0 && now - lastSummaryUpdate > SUMMARY_UPDATE_INTERVAL) {
      lastSummaryUpdate = now;
      generateAISummary(result.buckets);
    }

    // Feed messages to encoder and optionally override WASM buckets with semantic routing.
    // Skip when encoder is still loading (encoderLoading) — catch-up encoding runs after init.
    if (encoderReady && !encoderLoading) {
      scheduleEncode(messages, (batch, embeddings, durationMs) => {
        // Check if encoding is too slow (WASM backend fallback)
        if (durationMs !== undefined && batch.length > 0) {
          const msPerMessage = durationMs / batch.length;
          if (msPerMessage > ROUTING_CONFIG.wasmSpeedThresholdMsPerMessage) {
            console.log(`[Sidebar] Encoding too slow (${msPerMessage.toFixed(0)}ms/msg), falling back to keyword mode`);
            setKeywordMode();
            lastSemanticBuckets = null; // keyword mode now authoritative (nit d)
            updateClusteringBadge('Keyword');
            updateSystemStatus();
            return;
          }
        }

        // If semantic mode is active and we have embeddings, override bucket display
        if (isSemanticReady() && embeddings) {
          const labels = classifyBatch(batch, embeddings);
          const semanticBuckets = buildSemanticBuckets(batch, labels);
          lastSemanticBuckets = semanticBuckets; // capture for export/save (nit d)

          // Override the WASM bucket display with semantic buckets
          clustersDiv.innerHTML = '';
          if (semanticBuckets.length === 0) {
            safeSetHTML(clustersDiv, '<div class="empty-state"><p>No clusters yet. Keep chatting!</p></div>');
          } else {
            semanticBuckets.forEach(bucket => {
              const bucketEl = document.createElement('div');
              bucketEl.className = 'cluster-bucket';

              const headerDiv = safeCreateElement('div', 'cluster-header');
              const labelDiv = safeCreateElement('div', 'cluster-label', escapeHtml(bucket.label));
              const countDiv = safeCreateElement('div', 'cluster-count', bucket.count.toString());
              headerDiv.appendChild(labelDiv);
              headerDiv.appendChild(countDiv);

              const messagesDiv = safeCreateElement('div', 'cluster-messages');
              bucket.sample_messages.forEach(msg => {
                const msgDiv = safeCreateElement('div', 'message-item', escapeHtml(msg));
                messagesDiv.appendChild(msgDiv);
              });

              bucketEl.appendChild(headerDiv);
              bucketEl.appendChild(messagesDiv);
              clustersDiv.appendChild(bucketEl);
            });
          }

          console.log(`[Sidebar] Semantic buckets: ${semanticBuckets.map(b => `${b.label}(${b.count})`).join(', ')}`);
        } else {
          console.log(`[Encoder] Batch encoded: ${batch.length} messages, ${embeddings ? embeddings.length : 0} embeddings`);
        }
      });
    }

  } catch (error) {
    console.error('Error processing messages:', error);
    errorDiv.textContent = `Processing error: ${error.message}`;
    errorDiv.classList.remove('hidden');
  }
}

// Update trending topics display
function updateTopics(topics) {
  if (!topics || topics.length === 0) {
    topicsSection.classList.add('hidden');
    return;
  }

  topicsSection.classList.remove('hidden');
  topicsCloud.innerHTML = '';

  // Determine max count for sizing
  const maxCount = Math.max(...topics.map(t => t.count));

  topics.forEach(topic => {
    const tag = document.createElement('span');
    tag.className = 'topic-tag';

    // Add emote class if applicable
    if (topic.is_emote) {
      tag.classList.add('emote');
    }

    // Size class based on relative frequency
    const ratio = topic.count / maxCount;
    if (ratio > 0.7) {
      tag.classList.add('size-large');
    } else if (ratio > 0.4) {
      tag.classList.add('size-medium');
    } else {
      tag.classList.add('size-small');
    }

    tag.innerHTML = DOMPurify.sanitize(`
      ${escapeHtml(topic.term)}
      <span class="topic-count">${topic.count}</span>
    `, DOMPURIFY_CONFIG);

    topicsCloud.appendChild(tag);
  });
}

// Update mood indicator display
async function updateMoodIndicator(messages, sentimentSignals, currentSettings) {
  moodSection.classList.remove('hidden');

  let sentimentResult;

  if (llmEnabled && isLLMReady()) {
    try {
      // Use LLM for more accurate sentiment
      sentimentResult = await analyzeSentiment(messages, sentimentSignals);
    } catch (error) {
      console.warn('[Sidebar] LLM sentiment failed, using fallback:', error);
      sentimentResult = computeFallbackSentiment(sentimentSignals, currentSettings);
    }
    updateFallbackNotice();
  } else {
    // Use rule-based fallback
    sentimentResult = computeFallbackSentiment(sentimentSignals, currentSettings);
  }

  // Get previous mood for animation
  const moodClasses = ['excited', 'positive', 'angry', 'negative', 'confused', 'neutral'];
  const previousMood = moodClasses.find(c => moodSection.classList.contains(c));

  // Remove previous mood class, add new one
  moodClasses.forEach(c => moodSection.classList.remove(c));
  moodSection.classList.add(sentimentResult.mood);

  // Animate emoji change
  if (previousMood !== sentimentResult.mood) {
    moodEmoji.classList.add('pulse');
    setTimeout(() => moodEmoji.classList.remove('pulse'), 500);
  }

  moodEmoji.textContent = MOOD_EMOJIS[sentimentResult.mood] || '😐';
  moodLabel.textContent = sentimentResult.mood;
  moodConfidence.textContent = `${Math.round(sentimentResult.confidence * 100)}% confidence`;
  moodSummary.textContent = sentimentResult.summary || '';

  // Display sentiment samples based on mood
  updateSentimentSamples(sentimentResult.mood, sentimentSignals);

  // Track current mood for session saving
  currentMood = sentimentResult.mood;
}

// Display sentiment sample messages based on current mood
function updateSentimentSamples(mood, signals) {
  if (!sentimentSamples) return;

  // Determine which samples to show based on mood
  let samples = [];
  let label = '';

  if (mood === 'negative' || mood === 'angry') {
    samples = signals.negative_samples || [];
    label = 'Negative signals:';
  } else if (mood === 'confused') {
    samples = signals.confused_samples || [];
    label = 'Confusion signals:';
  } else if (mood === 'positive' || mood === 'excited') {
    samples = signals.positive_samples || [];
    label = 'Positive signals:';
  }

  // Only show if we have samples
  if (samples.length === 0) {
    sentimentSamples.classList.add('hidden');
    return;
  }

  sentimentSamples.classList.remove('hidden');
  sentimentSamples.innerHTML = DOMPurify.sanitize(`
    <div class="samples-label">${label}</div>
    <ul class="samples-list">
      ${samples.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
    </ul>
  `, DOMPURIFY_CONFIG);
}

// Show or hide the fallback notice with reason-specific messaging
function updateFallbackNotice() {
  if (!fallbackNotice) return;
  if (!isInFallback()) {
    fallbackNotice.classList.add('hidden');
    return;
  }
  fallbackNotice.classList.remove('hidden');
  const reason = getFallbackReason();
  const msgEl = document.getElementById('fallback-message');
  if (msgEl) {
    if (reason === 'no-gpu') {
      msgEl.textContent = 'AI needs a GPU \u2014 using rule-based analysis';
    } else if (reason === 'garbage') {
      msgEl.textContent = 'AI not responding \u2014 using rule-based analysis';
    } else {
      msgEl.textContent = 'AI could not load \u2014 using rule-based analysis';
    }
  }
  // Only show retry for transient failures
  if (retryAiBtn) {
    retryAiBtn.classList.toggle('hidden', reason === 'no-gpu');
  }
}

// Generate AI summary from buckets
async function generateAISummary(buckets) {
  try {
    const loadingSpan = safeCreateElement('span', 'loading', 'Generating AI summary...');
    aiSummaryText.innerHTML = '';
    aiSummaryText.appendChild(loadingSpan);
    aiSummaryDiv.classList.remove('hidden');

    const summary = await summarizeBuckets(buckets);

    // Format summary as a list (split by newlines)
    const lines = summary.summary.split('\n').filter(line => line.trim());
    if (lines.length > 1) {
      // Use safe DOM manipulation instead of innerHTML
      const ul = safeCreateElement('ul', 'ai-summary-list');
      lines.forEach(line => {
        const li = safeCreateElement('li', '', escapeHtml(line));
        ul.appendChild(li);
      });
      aiSummaryText.innerHTML = '';
      aiSummaryText.appendChild(ul);
    } else {
      aiSummaryText.textContent = summary.summary;
    }

    updateFallbackNotice();

  } catch (error) {
    console.error('[Sidebar] AI summary failed:', error);
    aiSummaryDiv.classList.add('hidden');
    updateFallbackNotice();
  }
}

// Validation imported from utils/ValidationHelpers.js (aliased to avoid naming conflicts with exports)
const validateAnalysisResult = _validateAnalysisResult;
const validateMessages = _validateMessages;

// Accumulate messages across batches for better clustering
let allMessages = [];

// Listen for messages from content script
if (!isTestEnv) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHAT_MESSAGES') {
      // Track platform and stream info
      if (message.platform) currentPlatform = message.platform;
      if (message.streamTitle) currentStreamTitle = message.streamTitle;
      if (message.streamUrl) currentStreamUrl = message.streamUrl;

      // Update last message time for inactivity detection
      lastMessageTime = Date.now();
      startInactivityCheck();

      // Hide stream ended prompt if showing
      streamEndedPrompt.classList.add('hidden');

      // Track total messages seen this session
      totalMessageCount += message.messages.length;

      // Accumulate sentiment from new messages (before adding to rolling window)
      if (wasmModule && message.messages.length > 0) {
        try {
          const batchResult = wasmModule.analyze_chat_with_settings(
            message.messages,
            settings.topicMinCount,
            settings.spamThreshold,
            settings.duplicateWindow * 1000
          );
          if (batchResult && batchResult.sentiment_signals) {
            sessionSentiment.positive_count += batchResult.sentiment_signals.positive_count;
            sessionSentiment.negative_count += batchResult.sentiment_signals.negative_count;
            sessionSentiment.confused_count += batchResult.sentiment_signals.confused_count;
            sessionSentiment.neutral_count += batchResult.sentiment_signals.neutral_count;
          }
        } catch (e) {
          // Ignore errors in batch sentiment, will still process normally
        }
      }

      // Add new messages to accumulator
      allMessages.push(...message.messages);

      // Cap buffer at 2x window size to prevent unbounded growth
      // (keeping 2x allows smooth window expansion without data loss)
      const windowSize = settings.analysisWindowSize || 500;
      if (allMessages.length > windowSize * 2) {
        allMessages = allMessages.slice(-(windowSize * 2));
      }

      // Slice to analysis window and process
      const windowMessages = allMessages.slice(-windowSize);
      processMessages(windowMessages);
    }
  });

  // Initialize on load
  initWasm();
}

// ============================================================================
// SESSION SUMMARY FUNCTIONS
// ============================================================================

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function showSessionSummary() {
  if (!lastAnalysisResult || !sessionStartTime) {
    return;
  }

  const duration = Date.now() - sessionStartTime;
  const result = lastAnalysisResult;

  // Update duration and message count
  document.getElementById('summary-duration').textContent = formatDuration(duration);
  document.getElementById('summary-messages').textContent = totalMessageCount;

  // Update sentiment bars - use session-accumulated sentiment
  const sentimentContainer = document.getElementById('summary-sentiment');
  const total = sessionSentiment.positive_count + sessionSentiment.negative_count +
                sessionSentiment.confused_count + sessionSentiment.neutral_count;

  if (total > 0) {
    sentimentContainer.innerHTML = DOMPurify.sanitize(
      ['positive', 'negative', 'confused', 'neutral'].map(type => {
        const count = sessionSentiment[`${type}_count`];
        const percent = Math.round((count / total) * 100);
        return `
          <div class="sentiment-bar">
            <span class="sentiment-bar-label">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
            <div class="sentiment-bar-track">
              <div class="sentiment-bar-fill ${type}" style="width: ${percent}%"></div>
            </div>
            <span class="sentiment-bar-value">${count}</span>
          </div>
        `;
      }).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(sentimentContainer, '<p class="summary-no-data">No sentiment data</p>');
  }

  // Update topics
  const topicsContainer = document.getElementById('summary-topics');
  if (result.topics && result.topics.length > 0) {
    topicsContainer.innerHTML = '';
    result.topics.slice(0, 10).forEach(topic => {
      const span = safeCreateElement('span', `summary-topic ${topic.is_emote ? 'emote' : ''}`,
        `${escapeHtml(topic.term)} (${topic.count})`);
      topicsContainer.appendChild(span);
    });
  } else {
    safeSetHTML(topicsContainer, '<p class="summary-no-data">No trending topics</p>');
  }

  // Update clusters
  const clustersContainer = document.getElementById('summary-clusters');
  if (result.buckets && result.buckets.length > 0) {
    clustersContainer.innerHTML = DOMPurify.sanitize(
      result.buckets.map(bucket =>
        `<div class="summary-cluster">
          <span class="summary-cluster-label">${escapeHtml(bucket.label)}:</span>
          <span class="summary-cluster-count">${bucket.count}</span>
        </div>`
      ).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(clustersContainer, '<p class="summary-no-data">No clusters</p>');
  }

  // Update top questions - use session-accumulated questions
  const questionsContainer = document.getElementById('summary-questions');
  if (sessionQuestions.length > 0) {
    // Show most recent questions first (reverse order)
    const recentQuestions = [...sessionQuestions].reverse().slice(0, 5);
    questionsContainer.innerHTML = DOMPurify.sanitize(
      recentQuestions.map(msg =>
        `<div class="summary-question">${escapeHtml(msg)}</div>`
      ).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(questionsContainer, '<p class="summary-no-data">No questions captured</p>');
  }

  // Build session object for export from live state
  currentDetailSession = {
    startTime: sessionStartTime,
    endTime: Date.now(),
    duration,
    platform: currentPlatform || 'unknown',
    streamTitle: currentStreamTitle || '',
    streamUrl: currentStreamUrl || '',
    messageCount: totalMessageCount,
    buckets: pickDisplayBuckets(result.buckets, lastSemanticBuckets, isSemanticReady()),
    topics: result.topics || [],
    sentimentSignals: { ...sessionSentiment },
    mood: currentMood || 'neutral',
    sessionQuestions: [...sessionQuestions]
  };

  // Reset save button state
  if (saveSummaryBtn) {
    saveSummaryBtn.disabled = false;
    saveSummaryBtn.textContent = 'Save Session';
  }

  // Show modal
  summaryModal.classList.remove('hidden');
}

function generateSummaryText() {
  if (!lastAnalysisResult || !sessionStartTime) {
    return '';
  }

  const duration = Date.now() - sessionStartTime;
  const result = lastAnalysisResult;

  let text = `📡 CHAT SIGNAL - SESSION SUMMARY\n`;
  text += `${'='.repeat(40)}\n\n`;

  text += `⏱️  Duration: ${formatDuration(duration)}\n`;
  text += `💬 Messages: ${totalMessageCount}\n\n`;

  // Sentiment - use session-accumulated counts
  const total = sessionSentiment.positive_count + sessionSentiment.negative_count +
                sessionSentiment.confused_count + sessionSentiment.neutral_count;
  const score = total > 0
    ? Math.round(((sessionSentiment.positive_count - sessionSentiment.negative_count) / total) * 100)
    : 0;

  text += `📊 SENTIMENT BREAKDOWN\n`;
  text += `   Positive: ${sessionSentiment.positive_count}\n`;
  text += `   Negative: ${sessionSentiment.negative_count}\n`;
  text += `   Confused: ${sessionSentiment.confused_count}\n`;
  text += `   Neutral:  ${sessionSentiment.neutral_count}\n`;
  text += `   Score:    ${score}/100\n\n`;

  // Topics
  if (result.topics && result.topics.length > 0) {
    text += `🏷️  TRENDING TOPICS\n`;
    result.topics.slice(0, 5).forEach(topic => {
      text += `   ${topic.is_emote ? '😀 ' : ''}${topic.term} (${topic.count})\n`;
    });
    text += `\n`;
  }

  // Clusters
  if (result.buckets && result.buckets.length > 0) {
    text += `📁 CLUSTERS\n`;
    result.buckets.forEach(bucket => {
      text += `   ${bucket.label}: ${bucket.count}\n`;
    });
    text += `\n`;
  }

  // Top questions - use session-accumulated questions
  if (sessionQuestions.length > 0) {
    text += `❓ TOP QUESTIONS\n`;
    const recentQuestions = [...sessionQuestions].reverse().slice(0, 5);
    recentQuestions.forEach((msg, i) => {
      text += `   ${i + 1}. ${msg}\n`;
    });
    text += `\n`;
  }

  text += `${'='.repeat(40)}\n`;
  text += `Generated by Chat Signal\n`;

  return text;
}

async function copySummaryToClipboard() {
  const text = generateSummaryText();

  try {
    await navigator.clipboard.writeText(text);

    // Show toast
    copyToast.classList.remove('hidden');
    setTimeout(() => {
      copyToast.classList.add('hidden');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    alert('Failed to copy to clipboard');
  }
}

// Platforms we recognize; anything else is normalized so it can't inject
// unexpected characters into the download filename.
const KNOWN_PLATFORMS = ['youtube', 'twitch'];

function sanitizePlatform(platform) {
  return KNOWN_PLATFORMS.includes(platform) ? platform : 'unknown';
}

function buildExportFilename(session, format) {
  const date = new Date(session.startTime);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const ext = format === 'json' ? 'json' : 'md';
  return `chatsignal-${dateStr}-${sanitizePlatform(session.platform)}.${ext}`;
}

// Export/save must capture whatever the user actually saw: semantic clusters
// when semantic mode is active, otherwise the WASM keyword buckets.
function pickDisplayBuckets(keywordBuckets, semanticBuckets, semanticActive) {
  return (semanticActive && semanticBuckets && semanticBuckets.length > 0)
    ? semanticBuckets
    : (keywordBuckets || []);
}

function generateSessionMarkdown(session) {
  const date = new Date(session.startTime);
  const signals = session.sentimentSignals;
  const total = signals.positive_count + signals.negative_count +
                signals.confused_count + signals.neutral_count;
  const score = total > 0
    ? Math.round(((signals.positive_count - signals.negative_count) / total) * 100)
    : 0;

  let md = `# Chat Signal - Session Summary\n\n`;
  md += `**Date:** ${date.toLocaleDateString()} ${date.toLocaleTimeString()}\n`;
  md += `**Platform:** ${session.platform}\n`;
  if (session.streamTitle) md += `**Stream:** ${session.streamTitle}\n`;
  if (session.streamUrl) md += `**URL:** ${session.streamUrl}\n`;
  md += `**Duration:** ${formatDuration(session.duration)}\n`;
  md += `**Messages:** ${session.messageCount}\n`;
  md += `**Mood:** ${session.mood}\n\n`;

  md += `## Sentiment Breakdown\n\n`;
  md += `| Type | Count |\n|------|-------|\n`;
  md += `| Positive | ${signals.positive_count} |\n`;
  md += `| Negative | ${signals.negative_count} |\n`;
  md += `| Confused | ${signals.confused_count} |\n`;
  md += `| Neutral | ${signals.neutral_count} |\n`;
  md += `| **Score** | **${score}/100** |\n\n`;

  if (session.topics && session.topics.length > 0) {
    md += `## Trending Topics\n\n`;
    session.topics.slice(0, 10).forEach(topic => {
      md += `- ${topic.term} (${topic.count})${topic.is_emote ? ' [emote]' : ''}\n`;
    });
    md += `\n`;
  }

  if (session.buckets && session.buckets.length > 0) {
    md += `## Clusters\n\n`;
    session.buckets.forEach(bucket => {
      md += `### ${bucket.label} (${bucket.count})\n\n`;
      if (bucket.sample_messages && bucket.sample_messages.length > 0) {
        bucket.sample_messages.forEach(msg => {
          md += `> ${msg}\n`;
        });
        md += `\n`;
      }
    });
  }

  const questions = session.sessionQuestions || [];
  if (questions.length > 0) {
    md += `## Top Questions\n\n`;
    [...questions].reverse().slice(0, 10).forEach((msg, i) => {
      md += `${i + 1}. ${msg}\n`;
    });
    md += `\n`;
  }

  md += `---\nGenerated by Chat Signal\n`;
  return md;
}

function exportSession(format) {
  exportMenu.classList.add('hidden');

  const session = currentDetailSession;
  if (!session) return;

  let content, mimeType;
  if (format === 'json') {
    content = JSON.stringify(session, null, 2);
    mimeType = 'application/json';
  } else {
    content = generateSessionMarkdown(session);
    mimeType = 'text/markdown';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildExportFilename(session, format);
  a.click();
  // Defer revocation: revoking immediately after click() can cancel the
  // download before the browser has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startNewSession() {
  // Reset session state
  sessionStartTime = null;
  lastAnalysisResult = null;
  lastSemanticBuckets = null;
  allMessages = [];
  sessionQuestions = [];
  totalMessageCount = 0;
  sessionSentiment = { positive_count: 0, negative_count: 0, confused_count: 0, neutral_count: 0 };
  currentPlatform = null;
  currentStreamTitle = null;
  currentStreamUrl = null;
  currentMood = 'neutral';

  // Stop inactivity check
  stopInactivityCheck();

  // Hide modal
  summaryModal.classList.add('hidden');

  // Reset UI
  endSessionBtn.classList.add('hidden');
  statsDiv.classList.add('hidden');
  moodSection.classList.add('hidden');
  topicsSection.classList.add('hidden');
  aiSummaryDiv.classList.add('hidden');
  if (fallbackNotice) fallbackNotice.classList.add('hidden');
  clustersDiv.innerHTML = '';
  if (clustersHeader) clustersHeader.classList.add('hidden');
  firstRunDiv.classList.remove('hidden');
  statusDiv.classList.remove('active');
  statusText.textContent = 'Waiting for chat messages...';

  // Switch to live view
  switchToView('live');
}

// ============================================================================
// INACTIVITY DETECTION
// ============================================================================

function startInactivityCheck() {
  // Clear existing interval if any
  if (inactivityCheckInterval) {
    clearInterval(inactivityCheckInterval);
  }

  inactivityCheckInterval = setInterval(() => {
    if (lastMessageTime && sessionStartTime) {
      const timeSinceLastMessage = Date.now() - lastMessageTime;
      const inactivityMs = (settings.inactivityTimeout || 120) * 1000;
      if (timeSinceLastMessage >= inactivityMs) {
        showStreamEndedPrompt();
        stopInactivityCheck();
      }
    }
  }, 10000); // Check every 10 seconds
}

function stopInactivityCheck() {
  if (inactivityCheckInterval) {
    clearInterval(inactivityCheckInterval);
    inactivityCheckInterval = null;
  }
}

function showStreamEndedPrompt() {
  // Only show if we have session data
  if (lastAnalysisResult && sessionStartTime) {
    streamEndedPrompt.classList.remove('hidden');
  }
}

// ============================================================================
// SESSION PERSISTENCE
// ============================================================================

async function saveCurrentSession() {
  if (!lastAnalysisResult || !sessionStartTime) {
    return null;
  }

  const endTime = Date.now();
  const sessionData = {
    startTime: sessionStartTime,
    endTime: endTime,
    duration: endTime - sessionStartTime,
    platform: currentPlatform || 'unknown',
    streamTitle: currentStreamTitle || 'Unknown Stream',
    streamUrl: currentStreamUrl || '',
    messageCount: totalMessageCount,
    buckets: pickDisplayBuckets(lastAnalysisResult.buckets, lastSemanticBuckets, isSemanticReady()),
    topics: lastAnalysisResult.topics,
    sentimentSignals: { ...sessionSentiment },
    mood: currentMood,
    sessionQuestions: [...sessionQuestions] // Save accumulated questions
  };

  try {
    const sessionId = await saveSession(sessionData);
    if (DEBUG) console.log('[Sidebar] Session saved:', sessionId);
    return sessionId;
  } catch (error) {
    console.error('[Sidebar] Failed to save session:', error);
    return null;
  }
}

// ============================================================================
// HISTORY VIEW
// ============================================================================

function switchToView(view) {
  currentView = view;

  if (view === 'live') {
    liveTab.classList.add('active');
    historyTab.classList.remove('active');
    historyView.classList.add('hidden');

    // Show live view elements
    statusDiv.classList.remove('hidden');
    if (lastAnalysisResult) {
      statsDiv.classList.remove('hidden');
      moodSection.classList.remove('hidden');
      topicsSection.classList.remove('hidden');
      clustersDiv.classList.remove('hidden');
      if (clustersHeader) clustersHeader.classList.remove('hidden');
    } else {
      firstRunDiv.classList.remove('hidden');
    }

    // Restore fallback notice to correct state when returning to live view
    updateFallbackNotice();
  } else if (view === 'history') {
    historyTab.classList.add('active');
    liveTab.classList.remove('active');
    historyView.classList.remove('hidden');

    // Hide live view elements
    statusDiv.classList.add('hidden');
    statsDiv.classList.add('hidden');
    moodSection.classList.add('hidden');
    topicsSection.classList.add('hidden');
    clustersDiv.classList.add('hidden');
    if (clustersHeader) clustersHeader.classList.add('hidden');
    firstRunDiv.classList.add('hidden');
    aiSummaryDiv.classList.add('hidden');
    if (fallbackNotice) fallbackNotice.classList.add('hidden');

    // Load and render history
    loadAndRenderHistory();
  }
}

async function loadAndRenderHistory() {
  const sessions = await loadSessions();
  renderHistoryList(sessions);
}

function renderHistoryList(sessions) {
  historyList.innerHTML = '';

  if (sessions.length === 0) {
    historyEmpty.classList.remove('hidden');
    clearHistoryBtn.classList.add('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  clearHistoryBtn.classList.remove('hidden');

  sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.addEventListener('click', () => viewSessionDetail(session));

    const date = new Date(session.startTime);
    const dateStr = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = DOMPurify.sanitize(`
      <div class="session-card-header">
        <span class="session-card-date">${escapeHtml(dateStr)}</span>
        <span class="session-card-platform">${escapeHtml(session.platform)}</span>
      </div>
      <div class="session-card-stats">
        <span class="session-card-stat">
          <span>${escapeHtml(formatDuration(session.duration))}</span>
        </span>
        <span class="session-card-stat">
          <span>${escapeHtml(String(session.messageCount))} msgs</span>
        </span>
      </div>
      <div class="session-card-mood">
        ${escapeHtml(MOOD_EMOJIS[session.mood] || '😐')} ${escapeHtml(session.mood)}
      </div>
      <button class="session-card-delete" title="Delete session">
        <span>x</span>
      </button>
    `, DOMPURIFY_CONFIG);

    // Handle delete button separately
    const deleteBtn = card.querySelector('.session-card-delete');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this session?')) {
        await deleteSession(session.id);
        loadAndRenderHistory();
      }
    });

    historyList.appendChild(card);
  });
}

function viewSessionDetail(session) {
  currentDetailSession = session;
  // Populate the summary modal with session data
  document.getElementById('summary-duration').textContent = formatDuration(session.duration);
  document.getElementById('summary-messages').textContent = session.messageCount;

  // Update sentiment bars
  const sentimentContainer = document.getElementById('summary-sentiment');
  const signals = session.sentimentSignals;
  const total = signals.positive_count + signals.negative_count + signals.confused_count + signals.neutral_count;

  if (total > 0) {
    sentimentContainer.innerHTML = DOMPurify.sanitize(
      ['positive', 'negative', 'confused', 'neutral'].map(type => {
        const count = signals[`${type}_count`];
        const percent = Math.round((count / total) * 100);
        return `
          <div class="sentiment-bar">
            <span class="sentiment-bar-label">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
            <div class="sentiment-bar-track">
              <div class="sentiment-bar-fill ${type}" style="width: ${percent}%"></div>
            </div>
            <span class="sentiment-bar-value">${count}</span>
          </div>
        `;
      }).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(sentimentContainer, '<p class="summary-no-data">No sentiment data</p>');
  }

  // Update topics
  const topicsContainer = document.getElementById('summary-topics');
  if (session.topics && session.topics.length > 0) {
    topicsContainer.innerHTML = DOMPurify.sanitize(
      session.topics.slice(0, 10).map(topic =>
        `<span class="summary-topic ${topic.is_emote ? 'emote' : ''}">${escapeHtml(topic.term)} (${topic.count})</span>`
      ).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(topicsContainer, '<p class="summary-no-data">No trending topics</p>');
  }

  // Update clusters
  const clustersContainer = document.getElementById('summary-clusters');
  if (session.buckets && session.buckets.length > 0) {
    clustersContainer.innerHTML = DOMPurify.sanitize(
      session.buckets.map(bucket =>
        `<div class="summary-cluster">
          <span class="summary-cluster-label">${escapeHtml(bucket.label)}:</span>
          <span class="summary-cluster-count">${bucket.count}</span>
        </div>`
      ).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    safeSetHTML(clustersContainer, '<p class="summary-no-data">No clusters</p>');
  }

  // Update top questions - use saved session questions if available
  const questionsContainer = document.getElementById('summary-questions');
  const savedQuestions = session.sessionQuestions || [];
  if (savedQuestions.length > 0) {
    const recentQuestions = [...savedQuestions].reverse().slice(0, 5);
    questionsContainer.innerHTML = DOMPurify.sanitize(
      recentQuestions.map(msg =>
        `<div class="summary-question">${escapeHtml(msg)}</div>`
      ).join(''),
      DOMPURIFY_CONFIG
    );
  } else {
    // Fallback to bucket sample messages for older sessions
    const questionsBucket = session.buckets?.find(b => b.label === 'Questions');
    if (questionsBucket && questionsBucket.sample_messages.length > 0) {
      questionsContainer.innerHTML = DOMPurify.sanitize(
        questionsBucket.sample_messages.slice(0, 3).map(msg =>
          `<div class="summary-question">${escapeHtml(msg)}</div>`
        ).join(''),
        DOMPURIFY_CONFIG
      );
    } else {
      safeSetHTML(questionsContainer, '<p class="summary-no-data">No questions captured</p>');
    }
  }

  // Update modal title to indicate it's a past session
  const modalTitle = summaryModal.querySelector('h2');
  const date = new Date(session.startTime);
  modalTitle.textContent = `Session Summary - ${date.toLocaleDateString()}`;

  // Change buttons for history view
  if (saveSummaryBtn) saveSummaryBtn.classList.add('hidden');
  copySummaryBtn.textContent = 'Copy Summary';
  closeSummaryBtn.textContent = 'Close';

  // Temporarily override close button behavior for history view
  closeSummaryBtn.removeEventListener('click', startNewSession);
  function restoreCloseHandler() {
    summaryModal.classList.add('hidden');
    modalTitle.textContent = 'Session Summary';
    closeSummaryBtn.textContent = 'Start New Session';
    closeSummaryBtn.removeEventListener('click', restoreCloseHandler);
    closeSummaryBtn.addEventListener('click', startNewSession);
    if (saveSummaryBtn) saveSummaryBtn.classList.remove('hidden');
  }
  closeSummaryBtn.addEventListener('click', restoreCloseHandler);

  // Show modal
  summaryModal.classList.remove('hidden');
}

// Export for testing
if (isTestEnv && typeof globalThis !== 'undefined') {
  globalThis.ChatSignalRadarSidebar = {
    updateAiSummaryState,
    updateMoodIndicator,
    updateTopics,
    updateSystemStatus,
    formatDuration,
    generateSummaryText,
    generateSessionMarkdown,
    exportSession,
    sanitizePlatform,
    buildExportFilename,
    pickDisplayBuckets,
    showSessionSummary,
    startInactivityCheck,
    stopInactivityCheck,
    saveCurrentSession,
    switchToView,
    renderHistoryList,
    setSidebarState: (state) => {
      if (state.settings) {
        settings = state.settings;
      }
      if (typeof state.llmEnabled === 'boolean') {
        llmEnabled = state.llmEnabled;
      }
      if (state.sessionStartTime !== undefined) {
        sessionStartTime = state.sessionStartTime;
      }
      if (state.lastAnalysisResult !== undefined) {
        lastAnalysisResult = state.lastAnalysisResult;
      }
      if (state.totalMessageCount !== undefined) {
        totalMessageCount = state.totalMessageCount;
      }
      if (state.sessionSentiment !== undefined) {
        sessionSentiment = state.sessionSentiment;
      }
      if (state.sessionQuestions !== undefined) {
        sessionQuestions = state.sessionQuestions;
      }
    }
  };
}
