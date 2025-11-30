// Sidebar script - loads WASM and processes chat messages

let wasmModule = null;

// DOM elements
const statusText = document.getElementById('status-text');
const statusDiv = document.getElementById('status');
const statsDiv = document.getElementById('stats');
const processedCount = document.getElementById('processed-count');
const clustersDiv = document.getElementById('clusters');
const errorDiv = document.getElementById('error');

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
    
    statusText.textContent = 'Ready! Waiting for chat messages...';
    console.log('WASM module loaded successfully');
    
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
    // Call WASM clustering function
    const result = wasmModule.cluster_messages(messages);
    
    // Update UI
    statusDiv.classList.add('active');
    statusText.textContent = 'Processing live chat...';
    statsDiv.classList.remove('hidden');
    processedCount.textContent = allMessages.length; // Show total accumulated
    
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
    
    // Render cluster buckets
    result.buckets.forEach(bucket => {
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
    
  } catch (error) {
    console.error('Error processing messages:', error);
    errorDiv.textContent = `Processing error: ${error.message}`;
    errorDiv.classList.remove('hidden');
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
    console.log('Received chat messages:', message.messages.length);
    
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
