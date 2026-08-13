// Chat DOM Observer — background service worker
// Receives debounced capture payloads from content scripts.
// Forwards to CAPTURE_ENDPOINT when configured; otherwise logs them.
importScripts('config.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'CHECK_PAUSED') {
    chrome.storage.local.get(['observer_paused'], (r) => {
      sendResponse({ paused: r.observer_paused || false });
    });
    return true;
  }

  if (msg.action === 'SET_PAUSED') {
    chrome.storage.local.set({ observer_paused: msg.paused });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'CAPTURE_MESSAGES') {
    handleCapture(msg.payload, sendResponse);
    return true;
  }
});

async function handleCapture(payload, sendResponse) {
  console.log(
    '[Observer BG] Capture:', payload.platform,
    '| conversation:', payload.conversation_id,
    '| messages:', payload.messages.length
  );

  if (!CAPTURE_ENDPOINT) {
    sendResponse({ success: true, logged: true });
    return;
  }

  try {
    const res = await fetch(CAPTURE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    sendResponse({ success: res.ok, status: res.status });
  } catch (e) {
    console.error('[Observer BG] Capture error:', e);
    sendResponse({ success: false, error: e.message });
  }
}
