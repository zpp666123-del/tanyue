// Run against a browser preview: NODE_PATH=<existing Playwright modules> node tools/test-data-flows.cjs [url]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1320, height: 850 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('tanyue.state.v1')));
  const upload = async (name, text) => {
    await page.locator('[data-action="open-import"]').first().click();
    await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  };
  try {
    await page.goto(process.argv[2] || 'http://127.0.0.1:4173');
    await page.locator('#app .main-nav').waitFor();
    const original = await state();
    assert(!await page.getByText('坚持阅读第 12 天', { exact: false }).count());
    await upload('preview-test.txt', '第一章\n这是用于检查预览的正文。读完需要用户明确确认。\n\n第二段正文。');
    await page.locator('#import-preview').waitFor();
    assert.equal((await state()).books.length, original.books.length, 'preview must not persist');
    await page.locator('#import-preview [data-action="close-modal"]').first().click();
    await page.locator('#import-preview').waitFor({ state: 'detached' });
    assert.equal((await state()).books.length, original.books.length, 'cancel must not persist');
    await upload('preview-test.txt', '第一章\n这是用于检查预览的正文。读完需要用户明确确认。\n\n第二段正文。');
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      window.testRestoreWrites = () => { Storage.prototype.setItem = write; };
      Storage.prototype.setItem = function(key, value) {
        if (key === 'tanyue.state.v1') throw new DOMException('test quota', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    });
    await page.locator('[data-action="confirm-import"]').click();
    await page.waitForFunction(() => document.querySelector('#import-save-status')?.textContent.includes('保存失败'));
    assert.equal((await state()).books.length, original.books.length, 'failed save must not change bookshelf');
    await page.evaluate(() => window.testRestoreWrites());
    await page.locator('[data-action="confirm-import"]').click();
    await page.locator('#import-preview').waitFor({ state: 'detached' });
    assert.equal((await state()).books.length, original.books.length + 1, 'retry persists exactly once');
    await page.reload();
    await page.locator('#app .main-nav').waitFor();
    assert.equal((await state()).books.length, original.books.length + 1);
    await page.locator('[data-action="navigate"][data-view="settings"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="export-data"]').click();
    const exported = await downloading;
    const backup = await state();
    mkdirSync('output/verification', { recursive: true });
    await exported.saveAs('output/verification/data-flow-export.json');
    backup.segments[0].note = '恢复的笔记';
    backup.segments[0].favorite = true;
    await page.locator('#restore-input').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.locator('#restore-preview').waitFor();
    const beforeRestore = await state();
    await page.locator('[data-action="confirm-restore"]').click();
    await page.locator('#restore-complete').waitFor();
    assert.equal((await state()).segments[0].note, '恢复的笔记');
    const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('tanyue.before-restore.v1')));
    assert.equal(savedBefore.segments[0].note, beforeRestore.segments[0].note, 'automatic backup preserves original');
    await page.reload();
    await page.locator('#app .main-nav').waitFor();
    assert.equal((await state()).segments[0].note, '恢复的笔记', 'restored notes survive restart');
    backup.segments[0].originalText += 'tampered';
    await page.locator('#restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByText('备份校验失败：原文内容哈希不一致').waitFor();
    assert.equal((await state()).segments[0].note, '恢复的笔记');
    await page.screenshot({ path: 'output/verification/settings.png' });
    assert.deepEqual(errors, [], 'no unhandled UI errors');
    console.log('PASS: preview, cancel, failed save, retry, reload, export, restore, pre-restore backup, tamper rejection, honest statistics');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
