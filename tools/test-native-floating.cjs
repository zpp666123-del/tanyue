const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const app = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = app.contexts().flatMap(c => c.pages());
  const page = pages.find(p => p.url().includes('mode=floating'));
  assert(page, 'close isolated main window to tray first');
  assert((await page.evaluate(() => TanYue.DesktopBridge.storageDiagnostics())).databasePath.includes('tanyue.validation'));
  await page.evaluate(() => TanYue.DesktopBridge.hideReadingPopup());
  const geometry = () => page.evaluate(async () => {
    const win = window.__TAURI__.window.getCurrentWindow();
    return { position: await win.outerPosition(), size: await win.outerSize(), scale: await win.scaleFactor(), monitor: await window.__TAURI__.window.currentMonitor(), screenX, screenY };
  });
  let g = await geometry();
  await page.evaluate(({ x, y }) => TanYue.DesktopBridge.moveFloatingWidget(x, y, false), {
    x: (g.monitor.position.x + g.monitor.size.width - g.size.width / 2) / g.scale - 40,
    y: 300
  });
  await page.waitForTimeout(200);
  const box = await page.locator('.floating-orb').boundingBox();
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 44, box.y + 24, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  g = await geometry();
  const center = g.position.x + g.size.width / 2;
  assert(Math.abs(center - (g.monitor.position.x + g.monitor.size.width)) <= 1, 'right edge must bisect actual icon');
  assert(!app.contexts().flatMap(c => c.pages()).some(p => p.url().includes('mode=popup')), 'drag does not open popup');
  // Move out and then settle at the opposite edge through the same native command.
  await page.evaluate(() => TanYue.DesktopBridge.moveFloatingWidget(-20, 300, true));
  g = await geometry();
  assert(Math.abs(g.position.x + g.size.width / 2 - g.monitor.position.x) <= 1, 'left half docking');
  await page.evaluate(() => TanYue.DesktopBridge.moveFloatingWidget(250, 300, true));
  g = await geometry();
  assert.equal(g.position.x, 250 * g.scale, 'can drag back out');
  const main = pages.find(p => !p.url().includes('mode='));
  await main.evaluate(async () => {
    const state = JSON.parse(await TanYue.DesktopBridge.loadAppState());
    state.settings.adSkin = true;
    await TanYue.DesktopBridge.saveAppState(JSON.stringify(state));
    await TanYue.DesktopBridge.showReadingPopup();
  });
  let popup;
  for (let i = 0; i < 30 && !popup; i++) {
    popup = app.contexts().flatMap(c => c.pages()).find(p => p.url().includes('mode=popup'));
    if (!popup) await page.waitForTimeout(100);
  }
  await popup.locator('.popup-ad-skin').waitFor();
  await popup.waitForTimeout(500);
  const p = await popup.evaluate(() => window.__TAURI__.window.getCurrentWindow().outerPosition());
  g = await geometry();
  assert(Math.abs(p.x - (g.position.x + g.size.width / 2 + 26 * g.scale)) <= 1, 'popup attaches to icon content, excluding invisible native width');
  await popup.screenshot({ path: 'output/verification/ad-skin.png' });
  await main.evaluate(() => TanYue.DesktopBridge.hideReadingPopup());
  console.log('PASS: native pointer drag, both half-hidden edges, move back out');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
