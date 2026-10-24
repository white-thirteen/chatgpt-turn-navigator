// Optional browser QA. Playwright is tooling, never bundled or a runtime dependency.
// Example: PLAYWRIGHT_MODULE_PATH=file:///.../playwright/index.mjs node tests/browser-smoke.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = await readFile(path.join(root, 'tests/fixture.html'), 'utf8');
const bundle = await readFile(path.join(root, 'dist/turn-navigator.user.js'), 'utf8');
const output = process.env.QA_OUTPUT_DIR || path.join(root, 'qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
const requests = [];
const checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
const settle = () => page.waitForTimeout(650);
const state = () => page.evaluate(() => {
  const host = document.querySelector('#chatgpt-turn-navigator');
  const root = host?.shadowRoot;
  const frame = root?.querySelector('.frame');
  const rail = root?.querySelector('.scroller');
  const box = root?.querySelector('.preview');
  return {
    hidden: host?.hidden, display: host ? getComputedStyle(host).display : null, count: root?.querySelectorAll('.mark').length,
    height: frame?.getBoundingClientRect().height, railTop: rail?.scrollTop,
    fade: rail?.dataset.fade,
    active: root?.querySelector('[aria-current="true"]')?.dataset.turnId,
    busy: root?.querySelectorAll('.markBusy').length,
    preview: box && !box.hidden ? box.textContent : '',
    frame: frame ? { x: frame.getBoundingClientRect().x, y: frame.getBoundingClientRect().y } : null,
    widths: root ? [...root.querySelectorAll('.mark')].map(el => getComputedStyle(el, '::before').width) : []
  };
});
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  await page.goto('https://chatgpt.com/c/local-fixture');
  await page.addScriptTag({ content: bundle });
  await settle();
  await check('five turns: 52px rail, 10px centres, ordinary marks 12px', async () => {
    const s = await state(); assert.equal(s.hidden, false); assert.equal(s.count, 5); assert.equal(s.height, 52);
    const spacing = await page.evaluate(() => {
      const nodes = document.querySelector('#chatgpt-turn-navigator').shadowRoot.querySelectorAll('.mark');
      return nodes[1].getBoundingClientRect().y - nodes[0].getBoundingClientRect().y;
    });
    assert.equal(spacing, 10);
    assert.ok(s.widths.filter(width => width === '12px').length >= 3);
  });
  await check('hover previews text and widens the correct inactive mark', async () => {
    const s = await state();
    await page.mouse.move(s.frame.x + 3, s.frame.y + 46);
    await page.waitForTimeout(200);
    const hover = await state(); assert.match(hover.preview, /键盘/); assert.equal(hover.widths[4], '18px');
    assert.equal(await page.evaluate(() => document.querySelector('#chatgpt-turn-navigator').shadowRoot.querySelectorAll('.markActive.markPreview').length), 0);
    await page.screenshot({ path: path.join(output, 'preview-light.png') });
  });
  await check('clicking the empty left part of the rail jumps to a turn below the header', async () => {
    const s = await state();
    await page.mouse.click(s.frame.x + 2, s.frame.y + 36);
    await page.waitForTimeout(100);
    const next = await state(); assert.equal(next.active, 'user:user-4');
    const top = await page.locator('[data-message-id="user-4"]').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top - 72) <= 2, `target top ${top} expected 72`);
  });
  await page.mouse.move(400, 40);
  await settle();
  await check('explicit generation signals pulse, streamed updates preserve button identity', async () => {
    await page.evaluate(() => {
      window.savedMark = document.querySelector('#chatgpt-turn-navigator').shadowRoot.querySelectorAll('.mark')[4];
      fixture.busy(true);
      let i = 0;
      window.streamTimer = setInterval(() => { document.querySelector('[data-message-id="assistant-5"]').textContent = '持续生成测试 ' + ++i; if (i >= 15) clearInterval(window.streamTimer); }, 45);
    });
    await page.waitForTimeout(420);
    assert.equal((await state()).busy, 1);
    assert.equal(await page.evaluate(() => window.savedMark === document.querySelector('#chatgpt-turn-navigator').shadowRoot.querySelectorAll('.mark')[4]), true);
    await page.waitForTimeout(400);
    await page.evaluate(() => fixture.busy(false));
    await settle(); assert.equal((await state()).busy, 0);
  });
  await check('100 turns cap at 420px; keyboard End/Enter reveals and navigates the last turn', async () => {
    await page.evaluate(() => fixture.render(100)); await settle();
    const initial = await state(); assert.equal(initial.count, 100); assert.equal(initial.height, 420); assert.equal(initial.fade, 'down');
    await page.locator('#chatgpt-turn-navigator').locator('.mark').first().focus();
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const last = await state(); assert.equal(last.active, 'user:user-100'); assert.ok(last.railTop > 570); assert.equal(last.fade, 'up');
    const top = await page.locator('[data-message-id="user-100"]').evaluate(el => el.getBoundingClientRect().top);
    const end = await page.locator('.conversation').evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    assert.ok(Math.abs(top - 72) <= 2 || Math.abs(end.top - end.max) <= 2, `last turn must align or clamp at scroll limit: ${top}`);
    await page.waitForTimeout(500); assert.equal((await state()).active, 'user:user-100');
  });
  await check('pointer and keyboard focus each suspend rail auto-follow', async () => {
    await page.evaluate(() => document.querySelector('#chatgpt-turn-navigator').shadowRoot.activeElement?.blur());
    const s = await state(); await page.mouse.move(s.frame.x + 2, s.frame.y + 200);
    const before = (await state()).railTop;
    await page.evaluate(() => { document.querySelector('.conversation').scrollTop = 0; });
    await settle(); const after = await state(); assert.equal(after.railTop, before); assert.notEqual(after.active, 'user:user-100');
    await page.mouse.move(400, 40); await settle(); assert.ok((await state()).railTop < 10);
    await page.locator('#chatgpt-turn-navigator').locator('.mark').first().focus();
    const focusedTop = (await state()).railTop;
    await page.evaluate(() => { document.querySelector('.conversation').scrollTop = 5000; });
    await settle(); assert.equal((await state()).railTop, focusedTop);
  });
  await check('internal rail wheel stays contained and has both fades mid-scroll', async () => {
    await page.evaluate(() => document.querySelector('#chatgpt-turn-navigator').shadowRoot.activeElement?.blur());
    const s = await state(); await page.mouse.move(s.frame.x + 4, s.frame.y + 200);
    const pageTop = await page.locator('.conversation').evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, 130); await page.waitForTimeout(100);
    const next = await state(); assert.ok(next.railTop > 0); assert.equal(next.fade, 'both');
    assert.equal(await page.locator('.conversation').evaluate(el => el.scrollTop), pageTop);
  });
  await check('previously observed unmounted turns are marked unloaded', async () => {
    await page.evaluate(() => {
      document.querySelector('[data-message-id="user-1"]').closest('article').remove();
      document.querySelector('[data-message-id="assistant-1"]').closest('article').remove();
    });
    await settle();
    const unloaded = await page.evaluate(() => {
      const mark = document.querySelector('#chatgpt-turn-navigator').shadowRoot.querySelector('.mark');
      return { cls: mark.classList.contains('markUnloaded'), label: mark.getAttribute('aria-label'), width: getComputedStyle(mark, '::before').width };
    });
    assert.equal(unloaded.cls, true); assert.match(unloaded.label, /会加载历史/);
  });
  await check('SPA navigation discards old turn IDs and cached history', async () => {
    await page.evaluate(() => { history.pushState({}, '', '/c/other-fixture'); fixture.render(3, 301); });
    await settle(); const s = await state(); assert.equal(s.count, 3); assert.equal(s.height, 32); assert.match(s.active, /user-30/);
    assert.equal(await page.locator('#chatgpt-turn-navigator').locator('[data-turn-id="user:user-1"]').count(), 0);
  });
  await check('theme follows the host even when OS colour preference differs', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => { document.documentElement.className = 'dark'; }); await settle();
    const colour = await page.evaluate(() => {
      const host = document.querySelector('#chatgpt-turn-navigator');
      return { theme: host.dataset.theme, active: getComputedStyle(host.shadowRoot.querySelector('.markActive'), '::before').backgroundColor };
    });
    assert.equal(colour.theme, 'dark'); assert.equal(colour.active, 'rgb(250, 250, 250)');
    const s = await state(); await page.mouse.move(s.frame.x + 3, s.frame.y + 26); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, 'preview-dark.png') });
  });
  await check('reduced motion disables mark and tooltip animation', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => fixture.busy(true)); await settle();
    const animations = await page.evaluate(() => {
      const root = document.querySelector('#chatgpt-turn-navigator').shadowRoot;
      return [...root.querySelectorAll('.mark, .preview, .frame')].flatMap(el => [getComputedStyle(el).animationName, getComputedStyle(el).transitionDuration, getComputedStyle(el, '::before').animationName]);
    });
    assert.ok(animations.every(value => value === 'none' || value === '0s'));
    await page.evaluate(() => fixture.busy(false));
  });
  await check('conversation container width <= 900px hides the rail', async () => {
    await page.setViewportSize({ width: 1100, height: 1000 }); await settle(); assert.equal((await state()).hidden, true); assert.equal((await state()).display, 'none');
    await page.setViewportSize({ width: 1440, height: 1000 }); await settle(); assert.equal((await state()).hidden, false);
  });
  await check('a single turn is normally hidden; a cancelled empty response never pulses', async () => {
    await page.evaluate(() => { history.pushState({}, '', '/c/single'); fixture.render(1); }); await settle(); assert.equal((await state()).hidden, true); assert.equal((await state()).display, 'none');
    await page.evaluate(() => { fixture.render(2); document.querySelector('[data-message-id="assistant-2"]').textContent = ''; }); await settle(); assert.equal((await state()).busy, 0);
  });
  await check('broken role selectors hide safely, and recovery rebuilds the rail', async () => {
    await page.evaluate(() => document.querySelectorAll('[data-message-author-role]').forEach(el => { el.dataset.savedRole = el.dataset.messageAuthorRole; el.removeAttribute('data-message-author-role'); }));
    await settle(); assert.equal((await state()).hidden, true); assert.equal((await state()).display, 'none');
    await page.evaluate(() => document.querySelectorAll('[data-saved-role]').forEach(el => el.dataset.messageAuthorRole = el.dataset.savedRole));
    await settle(); assert.equal((await state()).hidden, false);
  });
  await check('reinjection leaves one instance and no uncaught exceptions or extra requests', async () => {
    await page.addScriptTag({ content: bundle }); await settle();
    assert.equal(await page.locator('#chatgpt-turn-navigator').count(), 1);
    assert.deepEqual(errors, []); assert.equal(requests.length, 1);
  });
  await check('modern turn-key DOM works when the first main is hidden and legacy roles are absent', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/c/modern-fixture'); fixture.render(5);
      const current = document.querySelector('main');
      current.dataset.appShellMainSurface = '';
      const inactive = document.createElement('main'); inactive.style.display = 'none';
      inactive.dataset.inactiveFixture = 'true'; document.body.prepend(inactive);
      const conversation = document.querySelector('.conversation');
      conversation.removeAttribute('data-conversation-scroll'); conversation.dataset.appActionTimelineScroll = '';
      const form = document.querySelector('form'); form.dataset.chatgptComposer = '';
      const input = document.querySelector('#prompt-textarea'); input.removeAttribute('id'); input.className = 'ProseMirror'; input.dataset.composerMarkdown = '';
      for (const el of document.querySelectorAll('[data-message-author-role]')) {
        const role = el.dataset.messageAuthorRole;
        const n = el.dataset.messageId.split('-').at(-1);
        el.dataset.contentSearchUnitKey = `turn-${n}:0:${role}`;
        el.removeAttribute('data-message-author-role'); el.removeAttribute('data-message-id');
      }
      const style = document.createElement('style');
      style.textContent = '.modernTurn {padding:24px 0} [data-content-search-unit-key$=":user"] {background:#303030;border-radius:16px;padding:12px 18px;margin-left:80px} [data-content-search-unit-key$=":assistant"] {padding-top:14px} .ProseMirror {max-width:760px;margin:auto;min-height:64px;padding:16px;border:1px solid #444;border-radius:20px;background:#27272a}';
      document.head.append(style);
      for (const article of [...document.querySelectorAll('article')]) {
        const wrapper = document.createElement('div'); wrapper.dataset.turnKey = article.dataset.testid; wrapper.className = 'modernTurn';
        wrapper.append(...article.childNodes); article.replaceWith(wrapper);
      }
    });
    await settle();
    assert.equal(await page.locator('[data-message-author-role]').count(), 0);
    assert.equal(await page.locator('article[data-testid^="conversation-turn"]').count(), 0);
    assert.equal(await page.locator('main').first().evaluate(el => el.clientWidth), 0);
    const s = await state(); assert.equal(s.hidden, false); assert.equal(s.count, 5); assert.equal(s.height, 52);
    assert.ok(s.frame.y > 64); assert.ok(s.frame.x < 1440);
    await page.mouse.move(s.frame.x + 3, s.frame.y + 26); await page.waitForTimeout(200);
    assert.match((await state()).preview, /当前正在阅读/);
    await page.mouse.click(s.frame.x + 2, s.frame.y + 26); await page.waitForTimeout(100);
    assert.equal((await state()).active, 'user:turn-3:0:user');
    const top = await page.locator('[data-content-search-unit-key="turn-3:0:user"]').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top - 72) <= 2, `modern turn top ${top}`);
    await page.screenshot({ path: path.join(output, 'preview-modern.png') });
  });
  await check('diagnostics opens without exposing chat text or conversation identifiers', async () => {
    await page.keyboard.press('Alt+Shift+N');
    const panel = page.locator('#turn-navigator-diagnostics').locator('section');
    await panel.waitFor({ state: 'visible' });
    const report = JSON.parse(await panel.locator('pre').innerText());
    assert.equal(report.version, '0.1.1'); assert.equal(report.legacyUsers, 0); assert.equal(report.modernUsers, 5); assert.equal(report.recognizedUsers, 5);
    assert.ok(report.main.width > 900); assert.equal(report.scroller.timeline, true);
    assert.ok(!JSON.stringify(report).includes('modern-fixture')); assert.ok(!JSON.stringify(report).includes('turn-3')); assert.ok(!JSON.stringify(report).includes('怎样判断'));
    await panel.getByRole('button', { name: '关闭' }).click();
  });
  await check('message role on a turn node itself is recognized', async () => {
    await page.evaluate(() => {
      history.pushState({}, '', '/c/self-role');
      const messages = document.querySelector('.messages'); messages.replaceChildren();
      for (let i = 1; i <= 3; i++) {
        const article = document.createElement('article'); article.dataset.testid = `conversation-turn-${i}`; article.dataset.messageAuthorRole = 'user'; article.dataset.messageId = `self-${i}`; article.textContent = `第${i}个问题`;
        messages.append(article);
      }
    });
    await settle(); assert.equal((await state()).count, 3); assert.equal((await state()).hidden, false);
  });
  await check('role=main fallback is supported, without a visible main element', async () => {
    await page.evaluate(() => {
      const active = document.querySelector('main[data-app-shell-main-surface]');
      const next = document.createElement('div'); next.setAttribute('role', 'main'); next.style.cssText = 'position:fixed;inset:0 0 0 248px;display:flex;flex-direction:column';
      next.append(...active.childNodes); active.replaceWith(next);
    });
    await settle(); assert.equal((await state()).hidden, false); assert.equal((await state()).count, 3);
  });
  await check('continuous streaming plus UI style updates do not cause observer feedback loops', async () => {
    await page.waitForTimeout(800);
    const counts = await page.evaluate(async () => {
      let reads = 0;
      const observer = new MutationObserver(() => reads++);
      observer.observe(document.querySelector('#chatgpt-turn-navigator'), { attributes: true });
      await new Promise(resolve => setTimeout(resolve, 1000)); observer.disconnect(); return reads;
    });
    assert.ok(counts < 100, `unexpected update storm: ${counts}`);
    assert.deepEqual(errors, []); assert.equal(requests.length, 1);
  });
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ environment: 'Headless Chromium; intercepted local fixture at chatgpt.com; no live account or live DOM tested', checks, errors, requests }, null, 2));
  console.log(`${checks.length} browser checks passed.`);
} finally { await browser.close(); }
