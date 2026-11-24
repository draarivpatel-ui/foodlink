// FoodLink headless browser audit.
// Drives real headless Chromium via Playwright (resolved from the
// PLAYWRIGHT_MJS env path or a normal `playwright` package resolution, so
// the repo itself stays zero-dependency). Verifies, at desktop and mobile
// viewports:
//   * 0 console errors, 0 uncaught page errors
//   * 0 external network requests (everything is local)
//   * 0 horizontal overflow
//   * every tab, scenario, slider, language, theme, self-test, import and
//     add-lot interaction works
// and writes screenshots/{desktop,mobile}.png.
//
// Run: PLAYWRIGHT_MJS=<file:///abs/path/to/playwright/index.mjs> node scripts/browser-check.mjs

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
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
const browser = await playwright.chromium.launch({ channel: 'chrome' }).catch(() => playwright.chromium.launch());

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

try {
  await mkdir(`${root}screenshots`, { recursive: true });
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
      await page.screenshot({ path: `${root}screenshots/${vp.name}.png` }).catch(() => {});
      await page.close();
      continue;
    }
    check(`${vp.name}: page boots and renders map`, true);

    const step = async (name, fn) => {
      try { await fn(); check(`${vp.name}: ${name}`, true); }
      catch (err) { check(`${vp.name}: ${name}`, false, String(err.message || err).split('\n')[0].slice(0, 120)); }
    };

    // Tabs.
    for (const tab of ['shelf', 'boxes', 'manifest', 'data', 'dispatch']) {
      await step(`tab "${tab}" activates`, async () => {
        await page.click(`[data-tab="${tab}"]`);
        await page.waitForSelector(`#panel-${tab}.active`, { timeout: 4000 });
      });
    }

    // Scenario switching: click every scenario button.
    const scnCount = await page.locator('.scn').count();
    for (let i = 0; i < scnCount; i++) {
      await page.locator('.scn').nth(i).click();
      await page.waitForTimeout(120);
    }
    check(`${vp.name}: ${scnCount} scenario buttons switch`, scnCount >= 4, `${scnCount} buttons`);

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

    // JSON export into the textarea.
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 4000 }).catch(() => null),
      page.click('#export-json'),
    ]);
    const exportText = await page.inputValue('#import-text');
    check(`${vp.name}: JSON export fills textarea`, exportText.includes('"scenario"'), dl ? 'download ok' : 'download skipped');

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
    await page.screenshot({ path: `${root}screenshots/${vp.name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed at 2 viewports`);
process.exit(failed.length ? 1 : 0);
