// Background service worker for Chrome extension

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Relay messages from content script to side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHAT_MESSAGES') {
    // Broadcast to all side panel instances
    chrome.runtime.sendMessage(message).catch(() => {
      // Side panel may not be open, that's okay
    });
  }
  return false;
});
