// Chat DOM Observer — content script for Gemini (gemini.google.com)
// Detects SPA navigation to track multiple conversations independently
// Debounced capture matching ChatGPT pattern

(function() {
  'use strict';

  let messageBuffer = [];
  let conversationId = 'gemini-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let sendTimer = null;
  let isPaused = false;
  let currentUrl = window.location.href;

  chrome.runtime.sendMessage({ action: 'CHECK_PAUSED' }, (resp) => {
    isPaused = resp?.paused || false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.observer_paused) isPaused = changes.observer_paused.newValue;
  });

  function extractMessages() {
    const messages = [];

    // Strategy 1: Gemini's chat-turn-container (most reliable for AI Studio / Gemini web)
    const userTurns = document.querySelectorAll('.chat-turn-container.user, [class*="query-content"], [class*="user-query"]');
    const modelTurns = document.querySelectorAll('.chat-turn-container.model, [class*="response-content"], [class*="model-response"]');

    if (userTurns.length > 0 || modelTurns.length > 0) {
      const allTurns = [];
      userTurns.forEach(el => {
        const content = el.textContent?.trim();
        if (content && content.length > 3) {
          allTurns.push({ role: 'user', content: content.substring(0, 2000), top: el.getBoundingClientRect().top });
        }
      });
      modelTurns.forEach(el => {
        const content = el.textContent?.trim();
        if (content && content.length > 3) {
          allTurns.push({ role: 'assistant', content: content.substring(0, 2000), top: el.getBoundingClientRect().top });
        }
      });
      allTurns.sort((a, b) => a.top - b.top);
      allTurns.forEach(t => messages.push({ role: t.role, content: t.content }));
      if (messages.length > 0) return messages;
    }

    // Strategy 2: message-content custom elements (Angular-based Gemini)
    const messageContents = document.querySelectorAll('message-content');
    if (messageContents.length > 0) {
      messageContents.forEach((el, i) => {
        const content = el.textContent?.trim();
        if (content && content.length > 5) {
          // In Gemini, odd elements are typically model responses
          messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: content.substring(0, 2000) });
        }
      });
      if (messages.length > 0) return messages;
    }

    // Strategy 3: Gemini conversation bubbles with query/response patterns
    const turns = document.querySelectorAll('[class*="conversation"] [class*="turn"], [class*="chat-message"]');
    turns.forEach(el => {
      const isUser = el.classList.toString().toLowerCase().includes('query') ||
                     el.classList.toString().toLowerCase().includes('user') ||
                     el.classList.toString().toLowerCase().includes('human');
      const content = el.textContent?.trim();
      if (content && content.length > 5) {
        messages.push({ role: isUser ? 'user' : 'assistant', content: content.substring(0, 2000) });
      }
    });
    if (messages.length > 0) return messages;

    // Strategy 4: model-response-text fallback
    const modelTexts = document.querySelectorAll('.model-response-text, .response-text');
    if (modelTexts.length > 0) {
      // For each model response, try to find the preceding user query
      modelTexts.forEach((el, i) => {
        // Add a dummy user message for pairing
        messages.push({ role: 'user', content: `[User message ${i + 1}]` });
        const content = el.textContent?.trim();
        if (content && content.length > 5) {
          messages.push({ role: 'assistant', content: content.substring(0, 2000) });
        }
      });
    }

    return messages;
  }

  function sendToBackground() {
    if (isPaused || messageBuffer.length === 0) return;
    const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
    console.log('[Observer] Gemini: Sending', messageBuffer.length, 'messages (user msgs:', userMsgCount, ')');
    chrome.runtime.sendMessage({
      action: 'CAPTURE_MESSAGES',
      payload: {
        platform: 'Gemini',
        conversation_id: conversationId,
        title: document.title || 'Gemini Conversation',
        messages: messageBuffer.slice(-20)
      }
    }, (response) => {
      console.log('[Observer] Gemini capture response:', response?.success, 'listening:', response?.listening);
    });
  }

  function resetForNewConversation() {
    clearTimeout(sendTimer);
    sendToBackground();
    messageBuffer = [];
    conversationId = 'gemini-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    console.log('Observer: New Gemini conversation detected, ID:', conversationId);
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

  const observer = new MutationObserver(() => {
    if (isPaused) return;
    const newMessages = extractMessages();
    if (newMessages.length > messageBuffer.length) {
      messageBuffer = newMessages;
      const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
      clearTimeout(sendTimer);
      if (userMsgCount >= 2) {
        // Send after 2s debounce when 2+ user messages
        sendTimer = setTimeout(sendToBackground, 2000);
      } else if (userMsgCount === 1) {
        // Send after 5s for first message (listening state)
        sendTimer = setTimeout(sendToBackground, 5000);
      }
      console.log('[Observer] Gemini messages:', messageBuffer.length, 'user:', userMsgCount);
    }
  });

  const targetNode = document.querySelector('main') || document.body;
  observer.observe(targetNode, { childList: true, subtree: true });
  window.addEventListener('beforeunload', sendToBackground);
  console.log('Observer: Gemini monitoring active (SPA-aware, debounced capture)');
})();
