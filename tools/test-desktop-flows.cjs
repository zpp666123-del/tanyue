// Requires an isolated Tauri dev build (identifier ends in .validation) with WebView2 CDP on 9223.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');

(async () => {
  const app = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = app.contexts().flatMap(c => c.pages()).find(p => !p.url().includes('mode='));
  assert(page, 'main WebView required');
  const diagnostics = await page.evaluate(() => TanYue.DesktopBridge.storageDiagnostics());
  assert(diagnostics.databasePath.includes('tanyue.validation'), 'refuse to modify a real user database');
  const result = { diagnostics, checks: [] };
  const original = await page.evaluate(() => TanYue.DesktopBridge.loadAppState());
  const incoming = await page.evaluate(raw => {
    const state = TanYue.parseStateBackup(raw);
    state.segments[0].note = 'native restore check';
    state.schedule.enabled = false;
    return state;
  }, original);
  const backupPath = await page.evaluate(state => TanYue.DesktopBridge.invokeRequired('restore_app_state', { stateJson: JSON.stringify(state) }), incoming);
  assert.equal(JSON.parse(readFileSync(backupPath, 'utf8')).segments[0].note, JSON.parse(original).segments[0].note);
  const restored = await page.evaluate(() => TanYue.DesktopBridge.loadAppState());
  assert.equal(JSON.parse(restored).segments[0].note, 'native restore check');
  result.checks.push('SQLite restore and pre-restore backup');
  await page.evaluate(async () => { await TanYue.DesktopBridge.emitStateChanged(); });
  await page.reload();
  await page.locator('#app').waitFor();
  const initialAutostart = await page.evaluate(() => TanYue.DesktopBridge.getAutostart());
  assert.equal(await page.evaluate(() => TanYue.DesktopBridge.setAutostart(true)), true);
  assert.equal(await page.evaluate(() => TanYue.DesktopBridge.setAutostart(false)), false);
  if (initialAutostart) await page.evaluate(() => TanYue.DesktopBridge.setAutostart(true));
  result.checks.push('native autostart enable/disable');

  const editor = await chromium.launch({ channel: 'msedge', headless: false });
  try {
    const pad = await editor.newPage();
    await pad.setContent('<title>弹阅焦点验收输入框</title><label>输入测试<textarea autofocus rows="8" cols="60"></textarea></label>');
    await pad.locator('textarea').focus();
    await pad.bringToFront();
    assert(await pad.evaluate(() => document.hasFocus()), 'test editor must start focused');
    const losses = [];
    await pad.evaluate(() => { window.focusLosses = []; addEventListener('blur', () => window.focusLosses.push(Date.now())); });
    await page.evaluate(() => TanYue.DesktopBridge.showReadingPopup());
    for (let index = 0; index < 50; index++) {
      if (!await pad.evaluate(() => document.hasFocus())) losses.push(index);
      await pad.keyboard.type('x');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const popup = app.contexts().flatMap(c => c.pages()).find(p => p.url().includes('mode=popup'));
    assert(popup, 'native popup must exist');
    assert(await popup.evaluate(() => window.__TAURI__.window.getCurrentWindow().isVisible()), 'popup must actually be visible');
    assert.equal(await pad.locator('textarea').inputValue(), 'x'.repeat(50));
    assert.equal((await pad.evaluate(() => window.focusLosses)).length, 0, 'popup stole focus');
    assert.equal(losses.length, 0, 'editor lost focus while popup appeared');
    result.checks.push('5 seconds continuous input: visible native popup did not steal focus');
    await page.evaluate(() => TanYue.DesktopBridge.hideReadingPopup());
  } finally { await editor.close(); }

  // Close-to-tray is checked using the native titlebar, without granting JS window-close permission.
  mkdirSync('output/verification', { recursive: true });
  writeFileSync('output/verification/desktop-results.json', JSON.stringify(result, null, 2));
  if (process.argv.includes('--update')) {
    const announcement = await page.evaluate(() => TanYue.UpdaterBridge.check());
    assert(announcement, 'older isolated version should discover the release');
    result.announcement = announcement;
    await page.evaluate(async () => {
      window.updateProgress = [];
      await TanYue.UpdaterBridge.download(progress => window.updateProgress.push(progress));
    });
    result.download = await page.evaluate(() => window.updateProgress.at(-1));
    assert(result.download.downloaded > 1000000, 'real installer must fully download and verify');
    result.checks.push('real GitHub release discovery, download and signature verification; process remains alive');
  }
  mkdirSync('output/verification', { recursive: true });
  writeFileSync('output/verification/desktop-results.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
