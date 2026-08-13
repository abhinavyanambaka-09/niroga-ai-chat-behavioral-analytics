// Demo harness: runs the SAME extraction + observation + debounce pattern
// as the extension content scripts, against a mock chat page — no chrome APIs.

const chat = document.getElementById('chat');
const logEl = document.getElementById('log');
function log(...args) {
  const line = document.createElement('div');
  line.textContent = args.join(' ');
  logEl.prepend(line);
}

// ── Same extraction strategy as content-chatgpt.js ──
function extractMessages() {
  const messages = [];
  document.querySelectorAll('[data-message-author-role]').forEach(el => {
    const role = el.getAttribute('data-message-author-role');
    const content = el.textContent?.trim();
    if (content) messages.push({ role: role === 'user' ? 'user' : 'assistant', content: content.substring(0, 2000) });
  });
  return messages;
}

// ── Same buffer + two-tier debounce as the extension ──
let messageBuffer = [];
let sendTimer = null;

function sendToBackground() {
  if (messageBuffer.length === 0) return;
  const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
  log(`CAPTURE → ${messageBuffer.length} messages (${userMsgCount} user) [last 20 sent]`);
}

const observer = new MutationObserver(() => {
  const newMessages = extractMessages();
  if (newMessages.length > messageBuffer.length) {
    messageBuffer = newMessages;
    const userMsgCount = messageBuffer.filter(m => m.role === 'user').length;
    clearTimeout(sendTimer);
    if (userMsgCount >= 2) {
      sendTimer = setTimeout(sendToBackground, 2000);   // analysis trigger
      log(`buffered ${messageBuffer.length} — debounce 2s`);
    } else if (userMsgCount === 1) {
      sendTimer = setTimeout(sendToBackground, 5000);   // listening state
      log(`buffered ${messageBuffer.length} — debounce 5s (listening)`);
    }
  }
});
observer.observe(chat, { childList: true, subtree: true });

// ── Mock chat controls ──
let n = 0;
function addUserMessage() {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'user');
  el.textContent = `User message #${++n}: how does debounced capture work?`;
  chat.appendChild(el);
}

function streamAssistantReply() {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'assistant');
  chat.appendChild(el);
  const full = 'Streaming reply: tokens arrive incrementally, so the observer fires many times — the debounce collapses them into one capture after the stream settles.';
  let i = 0;
  const t = setInterval(() => {
    el.textContent = full.slice(0, i += 6);
    if (i >= full.length) clearInterval(t);
  }, 60);
}

log('Observer active on mock chat. Add messages to see debounced capture.');
