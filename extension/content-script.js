// Content script for YouTube/Twitch live chat monitoring

console.log('Chat Signal Radar content script loaded');

const BATCH_INTERVAL = 5000; // 5 seconds
let messageBatch = [];

// Detect platform
const isYouTube = window.location.hostname.includes('youtube.com');
const isTwitch = window.location.hostname.includes('twitch.tv');

// YouTube chat selector
const YOUTUBE_CHAT_SELECTOR = 'yt-live-chat-text-message-renderer';
// Twitch chat selector
const TWITCH_CHAT_SELECTOR = '.chat-line__message';

function extractYouTubeMessage(element) {
  const authorElement = element.querySelector('#author-name');
  const messageElement = element.querySelector('#message');
  
  if (!authorElement || !messageElement) return null;
  
  return {
    text: messageElement.textContent.trim(),
    author: authorElement.textContent.trim(),
    timestamp: Date.now()
  };
}

function extractTwitchMessage(element) {
  const authorElement = element.querySelector('.chat-author__display-name');
  const messageElement = element.querySelector('.text-fragment');
  
  if (!authorElement || !messageElement) return null;
  
  return {
    text: messageElement.textContent.trim(),
    author: authorElement.textContent.trim(),
    timestamp: Date.now()
  };
}

function observeChat() {
  let chatContainer = null;
  let observer = null;

  if (isYouTube) {
    // Wait for YouTube chat iframe or embedded chat
    const checkForChat = setInterval(() => {
      const iframe = document.querySelector('iframe#chatframe');
      if (iframe && iframe.contentDocument) {
        chatContainer = iframe.contentDocument.querySelector('#items');
      } else {
        chatContainer = document.querySelector('yt-live-chat-item-list-renderer #items');
      }

      if (chatContainer) {
        clearInterval(checkForChat);
        startObserving(chatContainer, YOUTUBE_CHAT_SELECTOR, extractYouTubeMessage);
      }
    }, 1000);
  } else if (isTwitch) {
    // Wait for Twitch chat
    const checkForChat = setInterval(() => {
      chatContainer = document.querySelector('.chat-scrollable-area__message-container');
      
      if (chatContainer) {
        clearInterval(checkForChat);
        startObserving(chatContainer, TWITCH_CHAT_SELECTOR, extractTwitchMessage);
      }
    }, 1000);
  }
}

function startObserving(container, selector, extractor) {
  console.log('Chat Signal Radar: Started observing chat');

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const messageElement = node.matches(selector) ? node : node.querySelector(selector);
          if (messageElement) {
            const message = extractor(messageElement);
            if (message) {
              messageBatch.push(message);
            }
          }
        }
      });
    });
  });

  observer.observe(container, {
    childList: true,
    subtree: true
  });

  // Send batched messages periodically
  setInterval(() => {
    if (messageBatch.length > 0) {
      console.log(`Chat Signal Radar: Sending batch of ${messageBatch.length} messages`);
      chrome.runtime.sendMessage({
        type: 'CHAT_MESSAGES',
        messages: messageBatch,
        platform: isYouTube ? 'youtube' : 'twitch'
      });
      messageBatch = [];
    }
  }, BATCH_INTERVAL);
}

// Start observing when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeChat);
} else {
  observeChat();
}
