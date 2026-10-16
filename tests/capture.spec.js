// @ts-check
// Behavioural tests for the capture layer, run against demo/mock-chat.html.
// The demo page uses the SAME extraction, buffering and two-tier debounce
// logic as the extension content scripts, so these tests pin that behaviour
// without needing chrome.* APIs.
const { test, expect } = require('@playwright/test');
const path = require('path');

const DEMO_URL = 'file://' + path.resolve(__dirname, '..', 'demo', 'mock-chat.html');

async function logLines(page) {
  return page.locator('#log > div').allTextContents();
}

function captureLines(lines) {
  return lines.filter((l) => l.startsWith('CAPTURE'));
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL);
  await expect(page.locator('#log')).toContainText('Observer active');
});

test('extracts role and content from data-message-author-role nodes', async ({ page }) => {
  await page.getByRole('button', { name: 'Add user message' }).click();
  const messages = await page.evaluate(() => extractMessages());
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe('user');
  expect(messages[0].content).toContain('User message #1');
});

test('one user message enters the listening state (5s debounce) before capturing', async ({ page }) => {
  await page.getByRole('button', { name: 'Add user message' }).click();
  await expect(page.locator('#log')).toContainText('debounce 5s (listening)');

  // Nothing should be captured during the first ~2s of the 5s window.
  await page.waitForTimeout(2000);
  expect(captureLines(await logLines(page))).toHaveLength(0);

  // After the window elapses, exactly one capture fires with one user message.
  await expect(page.locator('#log')).toContainText('CAPTURE → 1 messages (1 user)', { timeout: 6000 });
  expect(captureLines(await logLines(page))).toHaveLength(1);
});

test('two user messages trigger the 2s analysis debounce and a single capture', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add user message' });
  await add.click();
  await add.click();
  await expect(page.locator('#log')).toContainText('debounce 2s');

  await expect(page.locator('#log')).toContainText('CAPTURE → 2 messages (2 user)', { timeout: 4000 });
  // The 5s "listening" timer from the first message must have been cancelled,
  // so there is still exactly one capture after it would have fired.
  await page.waitForTimeout(4000);
  expect(captureLines(await logLines(page))).toHaveLength(1);
});

test('a streaming assistant reply collapses into one capture', async ({ page }) => {
  const add = page.getByRole('button', { name: 'Add user message' });
  await add.click();
  await add.click();
  await page.getByRole('button', { name: 'Stream assistant reply' }).click();

  // The reply streams in ~1.5s via many DOM mutations. Wait for it to settle
  // plus the debounce, then assert a single capture that includes the reply.
  await expect(page.locator('[data-message-author-role="assistant"]')).toContainText('after the stream settles', { timeout: 5000 });
  await expect(page.locator('#log')).toContainText('CAPTURE → 3 messages (2 user)', { timeout: 4000 });
  await page.waitForTimeout(3000);
  expect(captureLines(await logLines(page))).toHaveLength(1);

  const messages = await page.evaluate(() => extractMessages());
  expect(messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
});

test('re-extraction is idempotent: no new buffer when message count is unchanged', async ({ page }) => {
  await page.getByRole('button', { name: 'Add user message' }).click();
  await expect(page.locator('#log')).toContainText('buffered 1');
  // Mutate an existing node without adding a message; the buffer must not grow.
  await page.evaluate(() => {
    const el = document.querySelector('[data-message-author-role="user"]');
    el.textContent = el.textContent + ' (edited)';
  });
  await page.waitForTimeout(500);
  const buffered = (await logLines(page)).filter((l) => l.startsWith('buffered'));
  expect(buffered).toHaveLength(1);
});
