// Run against the local preview; uses an isolated browser context.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(process.argv[2] || 'http://127.0.0.1:1420');
    await page.locator('.floating-orb').waitFor();
    let box = await page.locator('.floating-orb').boundingBox();
    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(5, 300, { steps: 20 });
    await page.mouse.up();
    box = await page.locator('.floating-orb').boundingBox();
    assert.equal(box.x, -24, 'left edge half hidden');
    await page.mouse.move(10, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(990, 300, { steps: 20 });
    await page.mouse.up();
    box = await page.locator('.floating-orb').boundingBox();
    assert.equal(box.x, 976, 'right edge half hidden');
    assert.equal(await page.locator('.reading-popup-card').count(), 0, 'drag must not open popup');
    const result = await page.evaluate(async () => {
      const state = TanYue.createDemoState();
      state.settings.adSkin = true;
      const original = TanYue.currentSegment(state).originalText;
      const popup = new TanYue.ReadingPopupController(() => state, async () => true, () => {}, async () => true);
      popup.show();
      const card = document.querySelector('.popup-ad-skin');
      const text = Array.from(card.querySelectorAll('.popup-original p'), p => p.textContent).join('\n\n');
      const actions = Array.from(card.querySelectorAll('[data-popup-action]'), el => el.dataset.popupAction);
      await popup.close();
      return { original, text, actions };
    });
    assert.equal(result.text, result.original);
    for (const action of ['open-home', 'close', 'favorite', 'open-reader', 'continue', 'snooze', 'pause-today']) assert(result.actions.includes(action), action);
    console.log('PASS: left/right half docking, drag does not click, ad skin preserves original text and all seven actions');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
