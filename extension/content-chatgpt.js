// Chat DOM Observer — content script for ChatGPT (chat.openai.com / chatgpt.com)
// Captures conversation messages using MutationObserver
// Detects SPA navigation to track multiple conversations independently

(function() {
  'use strict';

  let messageBuffer = [];
  let conversationId = 'chatgpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let sendTimer = null;
  let isPaused = false;
  let currentUrl = window.location.href;

  // Check if monitoring is paused
  chrome.runtime.sendMessage({ action: 'CHECK_PAUSED' }, (resp) => {
    isPaused = resp?.paused || false;
  });

  // Listen for pause state changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.observer_paused) {
      isPaused = changes.observer_paused.newValue;
    }
  });

  function extractMessages() {
    const messages = [];
    const turns = document.querySelectorAll('[data-message-author-role]');
    turns.forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      const content = el.textContent?.trim();
      if (content) {
        messages.push({ role: role === 'user' ? 'user' : 'assistant', content: content.substring(0, 2000) });
      }
    });

    if (messages.length === 0) {
      const articles = document.querySelectorAll('article[data-testid]');
      articles.forEach(el => {
        const isUser = el.querySelector('[data-message-author-role="user"]');
        const content = el.textContent?.trim();
        if (content) {
          messages.push({ role: isUser ? 'user' : 'assistant', content: content.substring(0, 2000) });
        }
      });
    }

    return messages;
  }

  function sendToBackground() {
    if (isPaused || messageBuffer.length === 0) return;
    const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
    console.log('[Observer] Sending', messageBuffer.length, 'messages to background (user msgs:', userMsgCount, ')');
    chrome.runtime.sendMessage({
      action: 'CAPTURE_MESSAGES',
      payload: {
        platform: 'ChatGPT',
        conversation_id: conversationId,
        title: document.title || 'ChatGPT Conversation',
        messages: messageBuffer.slice(-20)
      }
    }, (response) => {
      console.log('[Observer] Capture response:', response?.success, 'listening:', response?.listening);
      if (response?.success && response?.analysis) {
      } else if (response?.listening) {
      }
    });
  }

  function resetForNewConversation() {
    clearTimeout(sendTimer);
    sendToBackground();
    messageBuffer = [];
    conversationId = 'chatgpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    console.log('Observer: New ChatGPT conversation detected, ID:', conversationId);
  }

  // --- SPA Navigation Detection ---
  setInterval(() => {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
      currentUrl = newUrl;
      resetForNewConversation();
    }
  }, 1500);

  window.addEventListener('popstate', () => {
    setTimeout(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        resetForNewConversation();
      }
    }, 100);
  });

  {
    const observer = new MutationObserver(() => {
      if (isPaused) return;
      const newMessages = extractMessages();
      if (newMessages.length > messageBuffer.length) {
        messageBuffer = newMessages;
        const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
        clearTimeout(sendTimer);
        if (userMsgCount >= 2) {
          // Send immediately when 2+ user messages (triggers analysis)
          sendTimer = setTimeout(sendToBackground, 2000);
        } else if (userMsgCount === 1) {
          // Send after 5s for first message (listening state)
          sendTimer = setTimeout(sendToBackground, 5000);
        }
        console.log('[Observer] Messages:', messageBuffer.length, 'user:', userMsgCount);
      }
    });

    const targetNode = document.querySelector('main') || document.body;
    observer.observe(targetNode, { childList: true, subtree: true });
    window.addEventListener('beforeunload', sendToBackground);
    console.log('Observer: ChatGPT monitoring active (SPA-aware, debounced capture)');
  }

})();
