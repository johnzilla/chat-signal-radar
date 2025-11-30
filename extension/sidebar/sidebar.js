// Sidebar script - loads WASM and processes chat messages

import { initializeLLM, summarizeBuckets, isLLMReady } from '../llm-adapter.js';

let wasmModule = null;
let llmEnabled = false;

// DOM elements
const statusText = document.getElementById('status-text');
const statusDiv = document.getElementById('status');
const statsDiv = document.getElementById('stats');
const processedCount = document.getElementById('processed-count');
const clustersDiv = document.getElementById('clusters');
const errorDiv = document.getElementById('error');
const aiSummaryDiv = document.getElementById('ai-summary');
const aiSummaryText = document.getElementById('ai-summary-text');

// Initialize WASM module
async function initWasm() {
  try {
    statusText.textContent = 'Loading clustering engine...';
    
    // Import the WASM module
    const wasmPath = chrome.runtime.getURL('wasm/wasm_engine.js');
    const { default: init, cluster_messages } = await import(wasmPath);
    
    // Initialize WASM
    const wasmBinaryPath = chrome.runtime.getURL('wasm/wasm_engine_bg.wasm');
    await init(wasmBinaryPath);
    
    wasmModule = { cluster_messages };
    
    statusText.textContent = 'Loading AI model...';
    
    // Initialize LLM in background
    initializeLLM((progress) => {
      statusText.textContent = `Loading AI: ${Math.round(progress.progress * 100)}%`;
    }).then(() => {
      llmEnabled = true;
      statusText.textContent = 'Ready! Waiting for chat messages...';
      console.log('[Sidebar] LLM initialized');
    }).catch((error) => {
      console.warn('[Sidebar] LLM initialization failed, continuing without AI summaries:', error);
      llmEnabled = false;
      statusText.textContent = 'Ready! Waiting for chat messages...';
    });
    
  } catch (error) {
    console.error('Failed to load WASM:', error);
    statusText.textContent = 'Error loading clustering engine';
    errorDiv.textContent = `Failed to load WASM: ${error.message}`;
    errorDiv.classList.remove('hidden');
  }
}

// Process incoming messages
function processMessages(messages) {
  if (!wasmModule) {
    console.error('WASM module not loaded');
    return;
  }

  try {
    // Call WASM clustering function - returns ClusterResult
    const result = wasmModule.cluster_messages(messages);
    
    // Validate ClusterResult shape
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid result from cluster_messages');
    }
    if (!Array.isArray(result.buckets)) {
      throw new Error('ClusterResult.buckets must be an array');
    }
    if (typeof result.processed_count !== 'number') {
      throw new Error('ClusterResult.processed_count must be a number');
    }
    
    // Update UI
    statusDiv.classList.add('active');
    statusText.textContent = 'Processing live chat...';
    statsDiv.classList.remove('hidden');
    processedCount.textContent = result.processed_count;
    
    // Clear previous clusters
    clustersDiv.innerHTML = '';
    
    if (result.buckets.length === 0) {
      clustersDiv.innerHTML = `
        <div class="empty-state">
          <p>No clusters yet. Keep chatting!</p>
        </div>
      `;
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
      
      bucketEl.innerHTML = `
        <div class="cluster-header">
          <div class="cluster-label">${escapeHtml(bucket.label)}</div>
          <div class="cluster-count">${bucket.count}</div>
        </div>
        <div class="cluster-messages">
          ${bucket.sample_messages.map(msg => 
            `<div class="message-item">${escapeHtml(msg)}</div>`
          ).join('')}
        </div>
      `;
      
      clustersDiv.appendChild(bucketEl);
    });
    
    // Generate AI summary if enabled
    if (llmEnabled && isLLMReady() && result.buckets.length > 0) {
      generateAISummary(result.buckets);
    }
    
  } catch (error) {
    console.error('Error processing messages:', error);
    errorDiv.textContent = `Processing error: ${error.message}`;
    errorDiv.classList.remove('hidden');
  }
}

// Generate AI summary from buckets
async function generateAISummary(buckets) {
  try {
    aiSummaryText.textContent = 'Generating AI summary...';
    aiSummaryDiv.classList.remove('hidden');
    
    const summary = await summarizeBuckets(buckets);
    aiSummaryText.textContent = summary.summary;
    
  } catch (error) {
    console.error('[Sidebar] AI summary failed:', error);
    aiSummaryDiv.classList.add('hidden');
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Accumulate messages across batches for better clustering
let allMessages = [];
const MAX_MESSAGES = 100; // Keep last 100 messages

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHAT_MESSAGES') {
    // Add new messages to accumulator
    allMessages.push(...message.messages);
    
    // Keep only recent messages
    if (allMessages.length > MAX_MESSAGES) {
      allMessages = allMessages.slice(-MAX_MESSAGES);
    }
    
    // Process all accumulated messages
    processMessages(allMessages);
  }
});

// Initialize on load
initWasm();
