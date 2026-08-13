# Niroga — AI Chat Behavioral Analytics

**[Niroga](https://myniroga.com)** analyzes AI conversations across ChatGPT, Claude, and
Gemini to surface behavioral and emotional patterns — stress, burnout, cognitive load.

**This repo is Niroga's open-source capture layer**: the Chrome extension that turns three
different live chat UIs into clean, structured conversation streams in real time. The
analysis engine lives in the private codebase.

## The problem

AI chat UIs render messages incrementally: streaming tokens, virtual-DOM re-renders,
SPA navigation that swaps conversations without a page load. Naively watching the DOM
either misses content or fires hundreds of times per response. This layer captures
complete conversations, cheaply, across three differently-built UIs.

## How it works

**Multi-strategy extraction per platform.** Each platform gets cascading selector
strategies — ChatGPT's stable `data-message-author-role` attributes first; Claude and
Gemini fall through up to four strategies (test-ids → turn containers → prose blocks →
structural last resort), so a UI refactor degrades capture instead of breaking it.

**Position-based turn ordering.** Where user and assistant turns are queried separately
(Claude, Gemini), turns are interleaved by `getBoundingClientRect().top` rather than
DOM order, which survives container nesting differences.

**Snapshot + growth detection.** On each mutation batch the full conversation is
re-extracted and compared against the buffer by length — simple, idempotent, and immune
to partial-render states.

**Two-tier debounce.** One user message → 5s debounce (a "listening" ping). Two or
more → 2s debounce (analysis trigger). Streaming responses collapse into a single
capture after the stream settles.

**SPA navigation detection.** URL polling + `popstate` listeners detect conversation
switches, flush the buffer, and rotate the conversation ID — so multiple conversations
are tracked independently without page loads.

**MV3 service-worker messaging.** Content scripts stay thin: capture payloads
(windowed to the last 20 messages, content truncated to 2KB per message) are passed to
the background worker, which forwards to a configurable endpoint.

## Run the demo (no install)

Open `demo/mock-chat.html` in any browser. Add user messages and stream a mock
assistant reply — the log panel shows buffering and debounced capture firing in
real time using the same logic as the extension.

## Load the extension

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Open ChatGPT, Claude, or Gemini and chat — captures log in the service-worker console
3. To forward captures to your own backend, set `CAPTURE_ENDPOINT` in `extension/config.js`

## What's deliberately NOT here

Niroga's analysis backend, auth, history import, and product UI live in the private
codebase. This repo is the capture layer only.

## License

MIT
