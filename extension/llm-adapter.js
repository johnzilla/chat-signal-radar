// LLM Adapter for WebLLM integration (MV3-safe, bundled version)

let engine = null;
let isInitializing = false;
let isInitialized = false;

/**
 * Initialize WebLLM engine with bundled library
 * @param {Function} progressCallback - Optional callback for initialization progress
 * @returns {Promise<void>}
 */
async function initializeLLM(progressCallback = null) {
  if (isInitialized) return;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }

  try {
    isInitializing = true;

    // Check if WebLLM bundle exists
    const webllmPath = chrome.runtime.getURL('libs/web-llm/index.js');
    
    try {
      // Try to load bundled WebLLM
      const { CreateMLCEngine } = await import(webllmPath);

      // Initialize with small model (Phi-2 or Llama-3.2-1B)
      engine = await CreateMLCEngine('Phi-2-q4f16_1-MLC', {
        initProgressCallback: (report) => {
          if (progressCallback) {
            progressCallback({
              progress: report.progress || 0,
              text: report.text || 'Loading...'
            });
          }
          console.log('[LLM] Loading:', report.text);
        },
        // Use extension storage for caching
        appConfig: {
          useIndexedDBCache: true
        }
      });

      isInitialized = true;
      console.log('[LLM] WebLLM engine initialized successfully');

    } catch (bundleError) {
      // If bundle doesn't exist, use fallback
      console.warn('[LLM] WebLLM bundle not found, using fallback summarizer:', bundleError);
      engine = createFallbackEngine();
      isInitialized = true;
      
      if (progressCallback) {
        progressCallback({ progress: 1, text: 'Using fallback mode' });
      }
    }

  } catch (error) {
    console.error('[LLM] Initialization failed:', error);
    isInitializing = false;
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Create fallback engine for when WebLLM is not available
 */
function createFallbackEngine() {
  return {
    chat: {
      completions: {
        create: async ({ messages }) => {
          const userMessage = messages.find(m => m.role === 'user')?.content || '';
          return {
            choices: [{
              message: {
                content: generateFallbackSummary(userMessage)
              }
            }]
          };
        }
      }
    }
  };
}

/**
 * Generate fallback summary without LLM
 */
function generateFallbackSummary(prompt) {
  const lines = prompt.split('\n');
  const buckets = [];
  
  let currentBucket = null;
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+?)\s+\((\d+)\s+messages\)/);
    if (match) {
      currentBucket = { label: match[1], count: parseInt(match[2]) };
      buckets.push(currentBucket);
    }
  }
  
  if (buckets.length === 0) {
    return 'No significant patterns detected in the chat.';
  }
  
  const topBucket = buckets.reduce((max, b) => b.count > max.count ? b : max, buckets[0]);
  let summary = `📊 Main focus: ${topBucket.label} (${topBucket.count} messages)`;
  
  if (buckets.length > 1) {
    const others = buckets.filter(b => b !== topBucket)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map(b => `${b.label} (${b.count})`)
      .join(', ');
    summary += `\n\nAlso active: ${others}`;
  }
  
  // Add engagement insight
  const totalMessages = buckets.reduce((sum, b) => sum + b.count, 0);
  if (totalMessages > 20) {
    summary += `\n\n💬 High engagement with ${totalMessages} messages analyzed.`;
  }
  
  return summary;
}

/**
 * Summarize cluster buckets using LLM
 * @param {Array} buckets - Array of ClusterBucket objects from Rust WASM
 * @returns {Promise<Object>} Summary object with insights
 */
async function summarizeBuckets(buckets) {
  if (!isInitialized) {
    throw new Error('LLM not initialized. Call initializeLLM() first.');
  }

  if (!buckets || buckets.length === 0) {
    return { 
      summary: 'No messages to summarize.',
      refined_buckets: [],
      timestamp: Date.now()
    };
  }

  try {
    const prompt = buildSummaryPrompt(buckets);

    const response = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are analyzing live stream chat. Provide a concise 2-3 sentence summary highlighting key themes, questions, or concerns. Be specific and actionable.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    const summaryText = response.choices[0].message.content;

    return {
      summary: summaryText,
      refined_buckets: buckets.map(b => ({
        label: b.label,
        count: b.count,
        sample: b.sample_messages[0] || ''
      })),
      timestamp: Date.now(),
      bucket_count: buckets.length
    };

  } catch (error) {
    console.error('[LLM] Summarization failed:', error);
    throw error;
  }
}

/**
 * Build prompt from cluster buckets
 */
function buildSummaryPrompt(buckets) {
  let prompt = 'Analyze these chat message clusters:\n\n';

  buckets.forEach((bucket, index) => {
    prompt += `${index + 1}. ${bucket.label} (${bucket.count} messages):\n`;
    bucket.sample_messages.slice(0, 2).forEach(msg => {
      prompt += `   - "${msg}"\n`;
    });
    prompt += '\n';
  });

  prompt += 'Summary:';
  return prompt;
}

/**
 * Check if LLM is ready
 */
function isLLMReady() {
  return isInitialized;
}

/**
 * Reset/cleanup LLM engine
 */
async function resetLLM() {
  if (engine) {
    engine = null;
    isInitialized = false;
    isInitializing = false;
    console.log('[LLM] Engine reset');
  }
}

export {
  initializeLLM,
  summarizeBuckets,
  isLLMReady,
  resetLLM
};
