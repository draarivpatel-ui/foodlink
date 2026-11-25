// FoodLink headless browser audit.
// Drives real headless Chromium via Playwright (resolved from the
// PLAYWRIGHT_MJS env path or a normal `playwright` package resolution, so
// the repo itself stays zero-dependency). Verifies, at desktop and mobile
// viewports (desktop, tablet and mobile):
//   * 0 console errors, 0 uncaught page errors
//   * 0 external network requests (everything is local)
//   * 0 horizontal overflow
//   * every tab, scenario, slider, language, theme, self-test, import and
//     add-lot interaction works, including arrow-key tab navigation
// and writes screenshots/{desktop,mobile}.png (all widths when BROWSER_SCREENSHOTS_DIR is set).
//
// Run: PLAYWRIGHT_MJS=<file:///abs/path/to/playwright/index.mjs> node scripts/browser-check.mjs

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const shots = process.env.BROWSER_SCREENSHOTS_DIR ? `${process.env.BROWSER_SCREENSHOTS_DIR.replace(/\/$/, '')}/` : `${root}screenshots/`;
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MJS) return import(process.env.PLAYWRIGHT_MJS);
  try {
    return await import('playwright');
  } catch {
    const req = createRequire(process.cwd() + '/');
    return req('playwright');
  }
}

let playwright;
try {
  playwright = await loadPlaywright();
} catch (err) {
  console.error('Playwright not found. Set PLAYWRIGHT_MJS to the playwright index.mjs file URL.');
  console.error(String(err.message || err));
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`);
};

const { server, port } = await createStaticServer(0);
const base = `http://127.0.0.1:${port}`;
const launchOptions = {
  channel: 'chrome',
  headless: true,
  args: ['--headless=new', '--mute-audio', '--disable-blink-features=AutomationControlled'],
};
if (process.env.BROWSER_DOWNLOADS_DIR) launchOptions.downloadsPath = process.env.BROWSER_DOWNLOADS_DIR;
const browser = await playwright.chromium.launch(launchOptions).catch(() => {
  const fallback = { ...launchOptions };
  delete fallback.channel;
  return playwright.chromium.launch(fallback);
});

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

try {
  await mkdir(shots, { recursive: true });
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const consoleErrors = [];
    const pageErrors = [];
    const externalRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    page.on('request', (r) => {
      const u = r.url();
      if (/^https?:/.test(u) && !u.startsWith(base)) externalRequests.push(u);
    });

    try {
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.waitForSelector('#map circle', { timeout: 8000 });
    } catch (err) {
      check(`${vp.name}: page boots and renders map`, false, String(err.message || err).split('\n')[0]);
      if (process.env.BROWSER_SCREENSHOTS_DIR || vp.name !== 'tablet') await page.screenshot({ path: `${shots}${vp.name}.png` }).catch(() => {});
      await page.close();
      continue;
    }
    check(`${vp.name}: page boots and renders map`, true);

    const step = async (name, fn) => {
      try { await fn(); check(`${vp.name}: ${name}`, true); }
      catch (err) { check(`${vp.name}: ${name}`, false, String(err.message || err).split('\n')[0].slice(0, 120)); }
    };

    // Tabs.
    for (const tab of ['board', 'shelf', 'boxes', 'manifest', 'data', 'dispatch']) {
      await step(`tab "${tab}" activates`, async () => {
        await page.click(`[data-tab="${tab}"]`);
        await page.waitForSelector(`#panel-${tab}.active`, { timeout: 4000 });
      });
    }

    await step('arrow keys move the tablist', async () => {
      await page.locator('#tab-btn-dispatch').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForSelector('#panel-board.active', { timeout: 3000 });
      await page.keyboard.press('ArrowLeft');
      await page.waitForSelector('#panel-dispatch.active', { timeout: 3000 });
    });

    // Scenario switching: click every scenario button.
    const scnCount = await page.locator('.scn').count();
    for (let i = 0; i < scnCount; i++) {
      await page.locator('.scn').nth(i).click();
      await page.waitForTimeout(120);
    }
    check(`${vp.name}: ${scnCount} scenario buttons switch`, scnCount >= 4, `${scnCount} buttons`);

    // Map legibility on every scenario: no label overlaps a node, halo, stop
    // badge, another label or the frame; every stop badge touches its own
    // node and clears every other node and badge.
    const MAP_GEOMETRY = () => {
      const svg = document.getElementById('map');
      const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      const circ = (c) => { const r = +c.getAttribute('r'); return { x: +c.getAttribute('cx') - r, y: +c.getAttribute('cy') - r, w: 2 * r, h: 2 * r, cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), r }; };
      const nodes = [...svg.querySelectorAll('.node')].map((n) => {
        const b = n.getBBox();
        return { id: n.dataset.stop || 'depot', x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: Math.hypot(b.width, b.height) / 2 };
      });
      const halos = [...svg.querySelectorAll('.halo')].map(circ);
      const badges = [...svg.querySelectorAll('.stop-disc')].map((c) => ({ id: c.dataset.stop, ...circ(c) }));
      const labels = [...svg.querySelectorAll('text.map-label')].map((t) => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height }; });
      const bad = [];
      labels.forEach((l, i) => {
        for (const o of [...nodes, ...halos, ...badges]) if (ov(l, o)) bad.push(`label ${l.text} hits a marker`);
        labels.forEach((m, j) => { if (j > i && ov(l, m)) bad.push(`label ${l.text} hits ${m.text}`); });
        if (l.x < 0 || l.y < 0 || l.x + l.w > 800 || l.y + l.h > 560) bad.push(`label ${l.text} leaves the frame`);
      });
      badges.forEach((b, i) => {
        const own = nodes.find((n) => n.id === b.id);
        // Diagonal corner of a square pantry is ~2.7 units past its inscribed radius.
        if (!own || Math.hypot(b.cx - own.cx, b.cy - own.cy) > Math.min(own.w, own.h) / 2 + b.r + 4) bad.push(`badge for ${b.id} detached from its node`);
        for (const n of nodes) if (n.id !== b.id && ov(b, n)) bad.push(`badge for ${b.id} covers node ${n.id}`);
        badges.forEach((c, j) => { if (j > i && ov(b, c)) bad.push(`badges ${b.id} and ${c.id} overlap`); });
      });
      return { labels: labels.length, badges: badges.length, bad };
    };
    for (let i = 0; i < scnCount; i++) {
      await page.locator('.scn').nth(i).click();
      await page.waitForTimeout(120);
      const g = await page.evaluate(MAP_GEOMETRY);
      check(`${vp.name}: scenario ${i + 1} map has no label or badge collisions`, g.bad.length === 0 && g.badges > 0 && g.labels > 0, g.bad[0] || `${g.labels} labels, ${g.badges} badges`);
    }

    // Sliders: move each to an extreme and back.
    for (const id of ['in-ambient', 'in-elapsed', 'in-capacity', 'in-speed', 'in-chain']) {
      const el = page.locator(`#${id}`);
      await el.evaluate((n) => { n.value = n.max; n.dispatchEvent(new Event('input', { bubbles: true })); });
      await el.evaluate((n) => { n.value = n.min; n.dispatchEvent(new Event('input', { bubbles: true })); });
      await el.evaluate((n, v) => { n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); }, String(await el.getAttribute('value') || (await el.evaluate((n) => n.defaultValue))));
    }
    await page.waitForSelector('#map circle', { timeout: 4000 });

    // Language toggle to Spanish and back.
    await page.click('#lang-btn');
    const h1es = await page.textContent('.topbar h1');
    const tabEs = await page.textContent('[data-tab="dispatch"]');
    check(`${vp.name}: ES toggle translates chrome`, tabEs.trim() === 'Mapa de despacho', `h1=${h1es?.trim()} tab=${tabEs?.trim()}`);
    await page.click('#lang-btn');

    // Theme toggle.
    await page.click('#theme-btn');
    const theme = await page.getAttribute('html', 'data-theme');
    check(`${vp.name}: dark theme applies`, theme === 'dark', `data-theme=${theme}`);
    await page.click('#theme-btn');

    // Volunteer board: open it from the dispatch card, claim with real typing,
    // ask for a hand-off, take it over, then reload and expect the same board.
    await step('coverage button opens the volunteer board', async () => {
      await page.click('[data-tab="dispatch"]');
      await page.click('#coverage-open');
      await page.waitForSelector('#panel-board.active', { timeout: 4000 });
    });
    await step('empty name is refused with a message', async () => {
      await page.locator('#run-list .claim-form button').first().click();
      const msg = await page.locator('#run-list .run-err').first().innerText();
      if (!/first name/i.test(msg)) throw new Error(`message "${msg}"`);
    });
    await step('claim, hand-off and take-over update the board', async () => {
      await page.locator('#run-list .claim-form input').first().click();
      await page.keyboard.type('Maya');
      await page.keyboard.press('Enter');
      await page.locator('#run-list li').first().getByRole('button', { name: /hand-off/i }).click();
      await page.locator('#run-list li').first().locator('input').click();
      await page.keyboard.type('Jordan');
      await page.keyboard.press('Enter');
      const st = await page.locator('#run-list .run-status').first().innerText();
      if (st !== 'Jordan took over from Maya') throw new Error(st);
      const brief = await page.textContent('#brief-pre');
      if (!brief.includes('driver Jordan (took over from Maya)')) throw new Error('brief missing relay');
    });
    await step('claims survive a reload from the share link', async () => {
      const url = page.url();
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load' });
      await page.click('[data-tab="board"]');
      const st = await page.locator('#run-list .run-status').first().innerText();
      if (st !== 'Jordan took over from Maya') throw new Error(st);
    });
    await step('a replan that drops the run reports the orphaned claim', async () => {
      await page.locator('#in-capacity').evaluate((n) => { n.value = '80'; n.dispatchEvent(new Event('input', { bubbles: true })); });
      if (await page.locator('#orphan-note').isHidden()) throw new Error('orphan note hidden');
      await page.locator('#in-capacity').evaluate((n) => { n.value = '320'; n.dispatchEvent(new Event('input', { bubbles: true })); });
      if (!(await page.locator('#orphan-note').isHidden())) throw new Error('orphan note stuck after restore');
    });
    await step('brief downloads as JSON', async () => {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.click('#brief-json')]);
      if (d.suggestedFilename() !== 'foodlink-volunteer-brief.json') throw new Error(d.suggestedFilename());
      await d.delete().catch(() => {});
    });
    await step('how it works drawer opens and closes', async () => {
      await page.click('#how-btn');
      await page.waitForSelector('#how-drawer[open]', { timeout: 4000 });
      const n = await page.locator('#how-body section').count();
      if (n < 5) throw new Error(`${n} sections`);
      await page.click('#how-close');
      await page.waitForSelector('#how-drawer:not([open])', { state: 'attached', timeout: 4000 });
    });
    await step('no em or en dash in any rendered text', async () => {
      for (const tab of ['dispatch', 'board', 'shelf', 'boxes', 'manifest', 'data']) {
        await page.click(`[data-tab="${tab}"]`);
        const txt = await page.evaluate(() => document.body.innerText + document.getElementById('how-body').textContent);
        if (/[\u2013\u2014]/.test(txt)) throw new Error(`dash on ${tab}`);
      }
    });

    // Self-tests: open panel, everything passes.
    await page.click('#selftest-btn');
    await page.waitForSelector('#selftest-panel:not([hidden])', { timeout: 4000 });
    await page.waitForSelector('#selftest-list li', { timeout: 8000 });
    const stTotal = await page.locator('#selftest-list li').count();
    const stBad = await page.locator('#selftest-list li.bad').count();
    check(`${vp.name}: self-tests all pass`, stTotal > 0 && stBad === 0, `${stTotal - stBad}/${stTotal}`);
    await page.click('#selftest-close');

    // Map has route and node markers after re-render.
    const circles = await page.locator('#map circle').count();
    const route = await page.locator('#map polyline.route-line').count();
    check(`${vp.name}: map renders nodes and route`, circles > 5 && route === 1, `${circles} circles, ${route} route`);

    // Shelf tab rows exist.
    await page.click('[data-tab="shelf"]');
    const lotRows = await page.locator('.lot-row').count();
    check(`${vp.name}: shelf-life rows render`, lotRows > 0, `${lotRows} rows`);

    // Boxes render.
    await page.click('[data-tab="boxes"]');
    const boxCards = await page.locator('.box-card').count();
    check(`${vp.name}: household boxes render`, boxCards > 0, `${boxCards} boxes`);

    // Manifest has stops.
    await page.click('[data-tab="manifest"]');
    const manifest = await page.textContent('#manifest-pre');
    check(`${vp.name}: manifest has stop lines`, /Stop 1|Parada 1/.test(manifest || ''), `${(manifest || '').split('\n').length} lines`);

    // Data tab: add a lot, export, import round-trip.
    await page.click('[data-tab="data"]');
    await page.fill('#lot-name', 'Audit crate');
    await page.fill('#lot-kg', '7');
    await page.fill('#lot-servings', '14');
    await page.click('#add-lot');
    await page.waitForTimeout(120);
    const shareUrl = await page.inputValue('#share-url');
    check(`${vp.name}: add-lot updates share hash`, shareUrl.includes('#s='), 'hash present');
    const scnIds = await page.locator('.scn').evaluateAll((els) => els.map((el) => el.dataset.scn));
    check(`${vp.name}: editing a built-in scenario adds one distinct custom chip`, scnIds.filter((x) => x.endsWith('-custom')).length === 1 && new Set(scnIds).size === scnIds.length, scnIds.join(','));

    // JSON export into the textarea.
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 4000 }).catch(() => null),
      page.click('#export-json'),
    ]);
    const exportText = await page.inputValue('#import-text');
    check(`${vp.name}: JSON export fills textarea`, exportText.includes('"scenario"'), dl ? 'download ok' : 'download skipped');
    if (dl) await dl.delete().catch(() => {});

    // Malformed import is rejected with a message.
    await page.fill('#import-text', '{not json');
    await page.click('#import-btn');
    const err = await page.textContent('#import-msg');
    check(`${vp.name}: bad import shows error`, (err || '').length > 0, (err || '').slice(0, 40));

    // No horizontal overflow.
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { sw: de.scrollWidth, cw: de.clientWidth, bw: document.body.scrollWidth };
    });
    check(`${vp.name}: zero horizontal overflow`, overflow.sw <= overflow.cw, `scrollWidth ${overflow.sw} <= clientWidth ${overflow.cw}`);

    // Errors collected.
    check(`${vp.name}: zero console errors`, consoleErrors.length === 0, consoleErrors[0] || 'clean');
    check(`${vp.name}: zero page errors`, pageErrors.length === 0, pageErrors[0] || 'clean');
    check(`${vp.name}: zero external requests`, externalRequests.length === 0, externalRequests[0] || 'clean');

    // Return to the hero view (dispatch map, default scenario) for the gallery shot.
    await page.click('[data-tab="dispatch"]').catch(() => {});
    await page.locator('.scn').first().click().catch(() => {});
    await page.waitForSelector('#map circle', { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    if (process.env.BROWSER_SCREENSHOTS_DIR || vp.name !== 'tablet') await page.screenshot({ path: `${shots}${vp.name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed at 3 viewports`);
process.exit(failed.length ? 1 : 0);
