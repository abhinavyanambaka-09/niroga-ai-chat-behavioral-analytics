// Chat DOM Observer — content script for Claude (claude.ai)
// Detects SPA navigation to track multiple conversations independently
// Debounced capture matching ChatGPT pattern

(function() {
  'use strict';

  let messageBuffer = [];
  let conversationId = 'claude-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
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

    // Strategy 1: Claude's data-testid based selectors (most reliable)
    const humanTurns = document.querySelectorAll('[data-testid="human-turn"], [data-testid*="user-message"]');
    const assistantTurns = document.querySelectorAll('[data-testid="ai-turn"], [data-testid*="assistant-message"]');

    if (humanTurns.length > 0 || assistantTurns.length > 0) {
      // Collect all turns with position info to interleave correctly
      const allTurns = [];
      humanTurns.forEach(el => {
        const content = el.textContent?.trim();
        if (content && content.length > 3) {
          allTurns.push({ role: 'user', content: content.substring(0, 2000), top: el.getBoundingClientRect().top });
        }
      });
      assistantTurns.forEach(el => {
        const content = el.textContent?.trim();
        if (content && content.length > 3) {
          allTurns.push({ role: 'assistant', content: content.substring(0, 2000), top: el.getBoundingClientRect().top });
        }
      });
      allTurns.sort((a, b) => a.top - b.top);
      allTurns.forEach(t => messages.push({ role: t.role, content: t.content }));
      if (messages.length > 0) return messages;
    }

    // Strategy 2: Claude's conversation turn containers
    const turns = document.querySelectorAll('[class*="turn"], [class*="Turn"]');
    turns.forEach(el => {
      const isHuman = el.querySelector('[class*="human"], [class*="Human"]') ||
                       el.getAttribute('data-testid')?.includes('human') ||
                       el.classList.toString().toLowerCase().includes('human') ||
                       el.classList.toString().toLowerCase().includes('user');
      const contentEl = el.querySelector('.whitespace-pre-wrap, .prose, [class*="message-content"], [class*="MessageContent"]') || el;
      const content = contentEl.textContent?.trim();
      if (content && content.length > 3) {
        messages.push({ role: isHuman ? 'user' : 'assistant', content: content.substring(0, 2000) });
      }
    });
    if (messages.length > 0) return messages;

    // Strategy 3: Broad fallback — look for .prose blocks or message-like containers
    const proseBlocks = document.querySelectorAll('.prose, [class*="message-text"], [class*="MessageText"]');
    proseBlocks.forEach((el, i) => {
      const content = el.textContent?.trim();
      if (content && content.length > 5) {
        messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: content.substring(0, 2000) });
      }
    });

    // Strategy 4: Last resort — any main content area with substantial text blocks
    if (messages.length === 0) {
      const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
      if (mainContent) {
        const blocks = mainContent.querySelectorAll('div > div > div');
        let lastLength = 0;
        blocks.forEach((el) => {
          const content = el.textContent?.trim();
          if (content && content.length > 20 && content.length !== lastLength) {
            lastLength = content.length;
            messages.push({ role: messages.length % 2 === 0 ? 'user' : 'assistant', content: content.substring(0, 2000) });
          }
        });
      }
    }

    return messages;
  }

  function sendToBackground() {
    if (isPaused || messageBuffer.length === 0) return;
    const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
    console.log('[Observer] Claude: Sending', messageBuffer.length, 'messages (user msgs:', userMsgCount, ')');
    chrome.runtime.sendMessage({
      action: 'CAPTURE_MESSAGES',
      payload: {
        platform: 'Claude',
        conversation_id: conversationId,
        title: document.title || 'Claude Conversation',
        messages: messageBuffer.slice(-20)
      }
    }, (response) => {
      console.log('[Observer] Claude capture response:', response?.success, 'listening:', response?.listening);
      if (response?.success && response?.analysis) {
      } else if (response?.listening) {
      }
    });
  }

  function resetForNewConversation() {
    clearTimeout(sendTimer);
    sendToBackground();
    messageBuffer = [];
    conversationId = 'claude-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    console.log('Observer: New Claude conversation detected, ID:', conversationId);
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
        // Send after 2s debounce when 2+ user messages (triggers analysis)
        sendTimer = setTimeout(sendToBackground, 2000);
      } else if (userMsgCount === 1) {
        // Send after 5s for first message (listening state)
        sendTimer = setTimeout(sendToBackground, 5000);
      }
      console.log('[Observer] Claude messages:', messageBuffer.length, 'user:', userMsgCount);
    }
  });

  const targetNode = document.querySelector('main') || document.body;
  observer.observe(targetNode, { childList: true, subtree: true });
  window.addEventListener('beforeunload', sendToBackground);
  console.log('Observer: Claude monitoring active (SPA-aware, debounced capture)');
})();
