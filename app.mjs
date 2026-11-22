// FoodLink workbench wiring. Everything runs client-side: state, engines,
// SVG rendering, hash sharing. No network, no frameworks.

import {
  PRODUCT_CLASSES, DANGER_ZONE_LIMIT_MIN,
  assessLot, formatHours, compareRescuePriority, cToF,
} from './src/spoilage.mjs';
import {
  FOOD_GROUPS, ALLERGENS,
  allocateBoxes, boxScore, nutritionTotals,
} from './src/nutrition.mjs';
import { planRoute, co2eKg } from './src/routing.mjs';
import {
  SCENARIOS, getScenario, clone, validateScenario, encodeState, decodeState,
  scenarioToCSV, scenarioFromCSV, exportStateJSON, allLots,
} from './src/scenarios.mjs';
import { t, manifestLines, checklist } from './src/i18n.mjs';
import { runSelfTests } from './src/selftest.mjs';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

const TIER_RANK = { spoiled: 0, critical: 1, high: 2, watch: 3, stable: 4 };
const TIER_COLOR = {
  critical: 'var(--crit)', high: 'var(--high)', watch: 'var(--watch)',
  stable: 'var(--stable)', spoiled: 'var(--spoiled)',
};

const state = {
  scenarioId: SCENARIOS[0].id,
  scenario: clone(SCENARIOS[0]),
  dirty: false,
  params: { ambientC: 26, elapsedMin: 0, capacityKg: 320, speedKmh: 30, coldChainMaxMin: 120 },
  lang: 'en',
  theme: 'light',
  plan: null,
  allocation: null,
  assessments: new Map(),
};

// ---------- state init / hash ----------

function applyScenario(s, id) {
  state.scenario = s;
  state.scenarioId = id || s.id || 'custom';
  state.dirty = !id;
  state.params.ambientC = s.ambientC;
  state.params.coldChainMaxMin = s.coldChainMaxMin ?? 120;
  state.params.capacityKg = s.vehicle?.capacityKg ?? 320;
  state.params.speedKmh = s.vehicle?.speedKmh ?? 30;
  state.params.elapsedMin = 0;
  syncControls();
}

function loadFromHash() {
  const raw = location.hash.replace(/^#s=/, '').replace(/^#/, '');
  if (!raw) return false;
  const res = decodeState(raw);
  if (!res.ok) return false;
  const st = res.state;
  if (st.params) Object.assign(state.params, pickParams(st.params));
  if (st.ui) {
    if (st.ui.lang === 'es' || st.ui.lang === 'en') state.lang = st.ui.lang;
    if (st.ui.theme === 'dark' || st.ui.theme === 'light') state.theme = st.ui.theme;
  }
  if (st.scenario) {
    const v = validateScenario(st.scenario);
    if (v.ok) applyScenario(st.scenario, null);
    else return false;
  } else if (st.scenarioId && SCENARIOS.some((s) => s.id === st.scenarioId)) {
    applyScenario(getScenario(st.scenarioId), st.scenarioId);
  }
  return true;
}

function pickParams(p) {
  const out = {};
  for (const k of ['ambientC', 'elapsedMin', 'capacityKg', 'speedKmh', 'coldChainMaxMin']) {
    if (Number.isFinite(p[k])) out[k] = p[k];
  }
  return out;
}

function syncHash() {
  const payload = { params: state.params, ui: { lang: state.lang, theme: state.theme } };
  if (state.dirty) payload.scenario = state.scenario;
  else payload.scenarioId = state.scenarioId;
  history.replaceState(null, '', `#s=${encodeState(payload)}`);
  const share = $('share-url');
  if (share) share.value = location.href;
}

// ---------- compute ----------

function recompute() {
  const { scenario, params } = state;
  const startMin = scenario.startMin + params.elapsedMin;
  state.assessments.clear();
  for (const lot of allLots(scenario)) {
    const a = assessLot(lot, params.ambientC, params.elapsedMin);
    Object.assign(lot, { lifeLeftHours: a.lifeLeftHours, dangerMinutes: a.dangerMinutes, spoiled: a.spoiled, tier: a.tier });
    state.assessments.set(lot.id, a);
  }

  state.plan = planRoute(scenario, {
    capacityKg: params.capacityKg,
    speedKmh: params.speedKmh,
    coldChainMaxMin: params.coldChainMaxMin,
    startMin,
  });

  const lotById = new Map(allLots(scenario).map((l) => [l.id, l]));
  const deliveredIds = new Set();
  for (const v of state.plan.visits || []) for (const id of v.delivered || []) deliveredIds.add(id);
  const deliveredLots = [...deliveredIds].map((id) => lotById.get(id)).filter(Boolean);
  state.allocation = allocateBoxes(deliveredLots, state.scenario.households);
  state.deliveredIds = deliveredIds;
}

// ---------- i18n ----------

function applyLang() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(state.lang, el.dataset.i18n);
  }
  renderScenarioButtons();
  recompute();
  renderAll();
}

// ---------- rendering ----------

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

const MAP_W = 800;
const MAP_H = 560;
const MAP_PAD = 52;

function projectPoints() {
  const pts = [state.scenario.depot, ...state.scenario.donors, ...state.scenario.pantries]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  let minLat = Math.min(...pts.map((p) => p.lat));
  let maxLat = Math.max(...pts.map((p) => p.lat));
  let minLon = Math.min(...pts.map((p) => p.lon));
  let maxLon = Math.max(...pts.map((p) => p.lon));
  if (maxLat - minLat < 1e-6) { minLat -= 0.01; maxLat += 0.01; }
  if (maxLon - minLon < 1e-6) { minLon -= 0.01; maxLon += 0.01; }
  const latPad = (maxLat - minLat) * 0.12;
  const lonPad = (maxLon - minLon) * 0.12;
  minLat -= latPad; maxLat += latPad; minLon -= lonPad; maxLon += lonPad;
  const scale = Math.min((MAP_W - 2 * MAP_PAD) / (maxLon - minLon), (MAP_H - 2 * MAP_PAD) / (maxLat - minLat));
  const ox = (MAP_W - scale * (maxLon - minLon)) / 2;
  const oy = (MAP_H - scale * (maxLat - minLat)) / 2;
  return (p) => ({
    x: ox + (p.lon - minLon) * scale,
    y: MAP_H - (oy + (p.lat - minLat) * scale),
  });
}

function worstTier(donor) {
  let worst = 'stable';
  for (const l of donor.lots || []) {
    const a = state.assessments.get(l.id);
    const tier = a ? a.tier : 'stable';
    if (TIER_RANK[tier] < TIER_RANK[worst]) worst = tier;
  }
  return worst;
}

function renderMap() {
  const svg = $('map');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const proj = projectPoints();
  const s = state.scenario;
  const lang = state.lang;

  for (let i = 1; i < 8; i++) {
    svgEl('line', { class: 'grid-line', x1: (MAP_W / 8) * i, y1: 0, x2: (MAP_W / 8) * i, y2: MAP_H }, svg);
    svgEl('line', { class: 'grid-line', x1: 0, y1: (MAP_H / 7) * i, x2: MAP_W, y2: (MAP_H / 7) * i }, svg);
  }

  // Route polyline through planned visits.
  const visits = state.plan?.visits || [];
  const stopPos = new Map();
  for (const d of s.donors) stopPos.set(d.id, proj(d));
  for (const p of s.pantries) stopPos.set(p.id, proj(p));
  const depotPos = proj(s.depot);
  const routePts = [depotPos, ...visits.map((v) => stopPos.get(v.stopId)).filter(Boolean)];
  if (routePts.length > 1) {
    svgEl('polyline', {
      class: 'route-line',
      points: routePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    }, svg);
  }

  // Depot.
  svgEl('rect', {
    class: 'node node-depot', x: depotPos.x - 7, y: depotPos.y - 7, width: 14, height: 14,
    transform: `rotate(45 ${depotPos.x} ${depotPos.y})`,
  }, svg).appendChild(Object.assign(document.createElementNS(SVGNS, 'title'), { textContent: s.depot.name || t(lang, 'depotLabel') }));

  // Donors with urgency halos.
  for (const d of s.donors) {
    const p = proj(d);
    const tier = worstTier(d);
    const color = TIER_COLOR[tier];
    if (tier === 'critical' || tier === 'high' || tier === 'spoiled') {
      const halo = svgEl('circle', { class: 'halo', cx: p.x, cy: p.y, r: 20 }, svg);
      halo.style.stroke = color;
    }
    const c = svgEl('circle', { class: 'node', cx: p.x, cy: p.y, r: 10 }, svg);
    c.style.fill = color;
    const title = svgEl('title', {}, c);
    const lots = (d.lots || []).map((l) => `${l.name} (${l.kg} kg)`).join(', ');
    title.textContent = `${d.name}: ${lots}`;
    placeLabel(svg, p, d.name);
  }

  // Pantries.
  for (const p2 of s.pantries) {
    const p = proj(p2);
    const r = svgEl('rect', { class: 'node', x: p.x - 9, y: p.y - 9, width: 18, height: 18 }, svg);
    r.style.fill = 'var(--accent)';
    svgEl('title', {}, r).textContent = `${p2.name} (${p2.capacityKg} ${t(lang, 'kgUnit')})`;
    placeLabel(svg, p, p2.name);
  }

  // Numbered stop discs along the route.
  visits.forEach((v, i) => {
    const p = stopPos.get(v.stopId);
    if (!p) return;
    svgEl('circle', { class: 'stop-disc', cx: p.x, cy: p.y, r: 8.5 }, svg);
    svgEl('text', { class: 'stop-num', x: p.x, y: p.y + 3.5 }, svg).textContent = String(i + 1);
  });

  renderLegend();
}

// Labels sit below a node, flipping to the left side near the right edge so
// the text never clips the viewBox or covers the numbered stop disc.
function placeLabel(svg, p, text) {
  const flip = p.x > MAP_W - 150;
  const el = svgEl('text', {
    class: 'map-label',
    x: flip ? p.x - 14 : p.x,
    y: flip ? p.y + 4 : p.y + 24,
    'text-anchor': flip ? 'end' : 'middle',
  }, svg);
  el.textContent = text;
}

function renderLegend() {
  const el = $('map-legend');
  el.innerHTML = '';
  const items = [
    ['legendDepot', 'var(--ink)'],
    ['legendDonor', 'var(--high)'],
    ['legendPantry', 'var(--accent)'],
    ['legendRoute', 'transparent'],
  ];
  for (const [key, color] of items) {
    const span = document.createElement('span');
    span.className = 'key';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = color;
    if (color === 'transparent') sw.style.borderBottom = '3px dashed var(--ink)';
    span.append(sw, document.createTextNode(t(state.lang, key)));
    el.appendChild(span);
  }
}

const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

function renderStats() {
  const plan = state.plan;
  $('stat-kg').textContent = `${plan.rescuedKg ?? 0} kg`;
  $('stat-co2').textContent = `${co2eKg(plan.rescuedKg ?? 0)} kg`;
  $('stat-spoiled').textContent = `${plan.spoiledKg ?? 0} kg`;
  $('stat-km').textContent = `${(plan.km ?? 0).toFixed(1)} km`;
  $('stat-min').textContent = `${Math.round(plan.totalMinutes ?? 0)} min`;
  $('stat-method').textContent = plan.method || '-';
}

function renderStops() {
  const ol = $('stop-list');
  ol.innerHTML = '';
  const byId = new Map();
  for (const d of state.scenario.donors) byId.set(d.id, d);
  for (const p of state.scenario.pantries) byId.set(p.id, p);
  for (const v of state.plan?.visits || []) {
    const stop = byId.get(v.stopId) || {};
    const li = document.createElement('li');
    const main = document.createElement('span');
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = v.kind === 'donor' ? t(state.lang, 'pickup') : t(state.lang, 'dropoff');
    main.append(kind, ` ${stop.name || v.stopId}`);
    const meta = document.createElement('span');
    meta.className = 'meta';
    const bits = [`${clock(v.arrive)}-${clock(v.depart)}`];
    if (v.picked?.length) bits.push(`+${v.picked.length} ${t(state.lang, 'manifestPicked')}`);
    if (v.delivered?.length) bits.push(`${v.delivered.length} ${t(state.lang, 'manifestDelivered')}`);
    if (v.spoiledOnArrival?.length) bits.push(`${v.spoiledOnArrival.length} ${t(state.lang, 'tierSpoiled')}`);
    meta.textContent = bits.join(' | ');
    li.append(main, meta);
    ol.appendChild(li);
  }
  if (ol.children.length === 0) {
    const li = document.createElement('li');
    li.textContent = t(state.lang, 'emptyManifest');
    ol.appendChild(li);
  }
}

function renderShelf() {
  const wrap = $('lot-rows');
  wrap.innerHTML = '';
  const rows = [];
  for (const d of state.scenario.donors) {
    for (const l of d.lots || []) {
      const a = state.assessments.get(l.id) || {};
      rows.push({ lot: l, donor: d, a });
    }
  }
  rows.sort((x, y) => compareRescuePriority({ ...x.lot, lifeLeftHours: x.a.lifeLeftHours }, { ...y.lot, lifeLeftHours: y.a.lifeLeftHours }));
  for (const { lot, donor, a } of rows) {
    const tier = a.tier || 'stable';
    const row = document.createElement('div');
    row.className = 'lot-row';

    const nameCell = document.createElement('div');
    nameCell.className = 'name';
    nameCell.textContent = lot.name;
    const dspan = document.createElement('span');
    dspan.className = 'donor';
    dspan.textContent = `${donor.name} | ${donor.id}`;
    nameCell.appendChild(dspan);

    const catCell = document.createElement('div');
    catCell.className = 'catcell';
    const catChip = document.createElement('span');
    catChip.className = 'chip';
    catChip.textContent = PRODUCT_CLASSES[lot.category]?.label || lot.category;
    catCell.appendChild(catChip);

    const kgCell = document.createElement('div');
    kgCell.className = 'kg-cell';
    kgCell.textContent = `${lot.kg} kg`;

    const lifeCell = document.createElement('div');
    lifeCell.className = 'lifecell';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    const base = Math.max(1, lot.freshHours ?? PRODUCT_CLASSES[lot.category].baseHours);
    fill.className = `fill tier-${tier}`;
    fill.style.width = `${Math.min(100, Math.max(0, ((a.lifeLeftHours ?? 0) / base) * 100))}%`;
    bar.appendChild(fill);
    const cap = document.createElement('span');
    cap.className = 'bar-caption';
    cap.textContent = `${t(state.lang, 'lifeLeft')}: ${a.spoiled ? t(state.lang, 'tierSpoiled') : formatHours(a.lifeLeftHours ?? 0)}`;
    lifeCell.append(bar, cap);

    const dCell = document.createElement('div');
    dCell.className = 'dangercell';
    if (a.tcs) {
      const dbar = document.createElement('div');
      dbar.className = 'bar';
      const dfill = document.createElement('div');
      dfill.className = 'fill danger';
      dfill.style.width = `${Math.min(100, ((a.dangerMinutes ?? 0) / DANGER_ZONE_LIMIT_MIN) * 100)}%`;
      dbar.appendChild(dfill);
      const dcap = document.createElement('span');
      dcap.className = 'bar-caption';
      dcap.textContent = `${Math.round(a.dangerMinutes ?? 0)} / ${DANGER_ZONE_LIMIT_MIN} ${t(state.lang, 'minUnit')} (${t(state.lang, 'dangerBudgetNote')})`;
      dCell.append(dbar, dcap);
    } else {
      const n = document.createElement('span');
      n.className = 'bar-caption';
      n.textContent = `${t(state.lang, 'dangerUsed')}: ${t(state.lang, 'noneLabel')}`;
      dCell.appendChild(n);
    }

    const tierCell = document.createElement('div');
    tierCell.className = 'tiercell';
    const chip = document.createElement('span');
    chip.className = `chip tier-${tier}`;
    chip.textContent = t(state.lang, `tier${tier[0].toUpperCase()}${tier.slice(1)}`);
    tierCell.appendChild(chip);

    row.append(nameCell, catCell, kgCell, lifeCell, dCell, tierCell);
    wrap.appendChild(row);
  }
}

function renderBoxes() {
  const grid = $('box-grid');
  grid.innerHTML = '';
  const lotById = new Map(allLots(state.scenario).map((l) => [l.id, l]));
  for (const box of state.allocation?.boxes || []) {
    const card = document.createElement('div');
    card.className = 'box-card';
    const h = document.createElement('h3');
    h.textContent = box.household.name;
    const meta = document.createElement('div');
    meta.className = 'hh-meta';
    const cons = (box.household.constraints || []).join(', ') || t(state.lang, 'noneLabel');
    meta.textContent = `${box.household.size} ${t(state.lang, 'servingsUnit')} cap | ${t(state.lang, 'constraintsLabel')}: ${cons} | ${t(state.lang, 'balanceLabel')}: ${Math.round(boxScore(box) * 100)}%`;
    card.append(h, meta);

    for (const g of FOOD_GROUPS) {
      if ((box.target[g] || 0) <= 0) continue;
      const gr = document.createElement('div');
      gr.className = 'grow';
      const name = document.createElement('span');
      name.className = 'gname';
      name.textContent = g;
      const gbar = document.createElement('div');
      gbar.className = 'gbar';
      const gfill = document.createElement('div');
      const frac = Math.min(1, (box.have[g] || 0) / box.target[g]);
      gfill.className = `gfill${frac < 1 ? ' short' : ''}`;
      gfill.style.width = `${frac * 100}%`;
      gbar.appendChild(gfill);
      const val = document.createElement('span');
      val.className = 'gval';
      val.textContent = `${box.have[g]}/${box.target[g]}`;
      gr.append(name, gbar, val);
      card.appendChild(gr);
    }

    if (box.items.length) {
      const table = document.createElement('table');
      table.className = 'items-table';
      table.innerHTML = `<tr><th>${t(state.lang, 'lotName')}</th><th>${t(state.lang, 'servingsUnit')}</th><th>${t(state.lang, 'kgUnit')}</th></tr>`;
      for (const it of box.items) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td></td><td>${it.servings}</td><td>${it.kg}</td>`;
        tr.firstElementChild.textContent = it.name;
        table.appendChild(tr);
      }
      card.appendChild(table);
    }
    const totals = nutritionTotals(box.items, lotById);
    const tot = document.createElement('div');
    tot.className = 'totals';
    tot.textContent = `${t(state.lang, 'totalsLabel')}: ${totals.servings} ${t(state.lang, 'servingsUnit')} | ${t(state.lang, 'proteinG')} ${totals.proteinG} g | ${t(state.lang, 'sodiumMg')} ${totals.sodiumMg} mg | ${t(state.lang, 'sugarG')} ${totals.sugarG} g`;
    card.appendChild(tot);
    if (box.unmet.length) {
      const u = document.createElement('div');
      u.className = 'unmet';
      u.textContent = `${t(state.lang, 'unmetLabel')}: ${box.unmet.map((x) => `${x.group} -${x.missing}`).join(', ')}`;
      card.appendChild(u);
    }
    grid.appendChild(card);
  }
  const lo = $('leftovers');
  const left = state.allocation?.leftovers || [];
  lo.textContent = left.length
    ? `${t(state.lang, 'rescuedLabel')}: ${left.length} lots unallocated (${left.reduce((n, x) => n + x.kgLeft, 0).toFixed(1)} kg left)`
    : '';
}

function renderManifest() {
  $('manifest-pre').textContent = manifestLines(state.plan, state.scenario, state.lang).join('\n');
  const ol = $('checklist');
  ol.innerHTML = '';
  for (const item of checklist(state.lang)) {
    const li = document.createElement('li');
    li.textContent = item;
    ol.appendChild(li);
  }
}

function renderAll() {
  renderMap();
  renderStats();
  renderStops();
  renderShelf();
  renderBoxes();
  renderManifest();
}

// ---------- controls ----------

function renderScenarioButtons() {
  const wrap = $('scenario-buttons');
  wrap.innerHTML = '';
  const list = state.dirty || !SCENARIOS.some((s) => s.id === state.scenarioId)
    ? [...SCENARIOS, state.scenario]
    : SCENARIOS;
  for (const s of list) {
    const b = document.createElement('button');
    b.className = `scn${s.id === state.scenarioId ? ' active' : ''}`;
    b.textContent = s.name;
    b.dataset.scn = s.id;
    b.addEventListener('click', () => {
      if (s.id === state.scenarioId) return;
      const next = SCENARIOS.find((x) => x.id === s.id);
      if (next) applyScenario(getScenario(s.id), s.id);
      recompute();
      renderAll();
      syncHash();
      state._refreshDonors?.();
    });
    wrap.appendChild(b);
  }
  $('scenario-blurb').textContent = state.scenario.blurb || '';
}

function syncControls() {
  $('in-ambient').value = state.params.ambientC;
  $('in-elapsed').value = state.params.elapsedMin;
  $('in-capacity').value = state.params.capacityKg;
  $('in-speed').value = state.params.speedKmh;
  $('in-chain').value = state.params.coldChainMaxMin;
  updateOutputs();
  renderScenarioButtons();
}

function updateOutputs() {
  $('out-ambient').textContent = `${state.params.ambientC} C / ${Math.round(cToF(state.params.ambientC))} F`;
  $('out-elapsed').textContent = `${state.params.elapsedMin} min`;
  $('out-capacity').textContent = `${state.params.capacityKg} kg`;
  $('out-speed').textContent = `${state.params.speedKmh} km/h`;
  $('out-chain').textContent = `${state.params.coldChainMaxMin} min`;
}

function wireControls() {
  const bind = (id, key) => {
    $(id).addEventListener('input', (e) => {
      state.params[key] = Number(e.target.value);
      updateOutputs();
      recompute();
      renderAll();
      syncHash();
    });
  };
  bind('in-ambient', 'ambientC');
  bind('in-elapsed', 'elapsedMin');
  bind('in-capacity', 'capacityKg');
  bind('in-speed', 'speedKmh');
  bind('in-chain', 'coldChainMaxMin');

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => {
        x.classList.toggle('active', x === tab);
        x.setAttribute('aria-selected', x === tab ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`);
      });
    });
  }

  $('lang-btn').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'es' : 'en';
    applyLang();
    syncHash();
  });

  $('theme-btn').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.theme;
    syncHash();
  });

  $('print-btn').addEventListener('click', () => window.print());

  $('selftest-btn').addEventListener('click', () => {
    const { passed, failed, results } = runSelfTests();
    const list = $('selftest-list');
    list.innerHTML = '';
    for (const r of results) {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'bad';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = r.ok ? 'ok' : 'X';
      const name = document.createElement('span');
      name.textContent = r.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = r.detail;
      li.append(mark, name, detail);
      list.appendChild(li);
    }
    $('selftest-score').textContent = `${passed} pass / ${failed} fail`;
    $('selftest-panel').hidden = false;
  });
  $('selftest-close').addEventListener('click', () => { $('selftest-panel').hidden = true; });
  $('selftest-panel').addEventListener('click', (e) => {
    if (e.target === $('selftest-panel')) $('selftest-panel').hidden = true;
  });

  // Data tab.
  $('export-json').addEventListener('click', () => {
    const payload = { scenario: state.scenario, params: state.params };
    $('import-text').value = exportStateJSON(payload);
    download('foodlink-state.json', JSON.stringify(payload, null, 2), 'application/json');
  });
  $('export-csv').addEventListener('click', () => {
    const csv = scenarioToCSV(state.scenario);
    $('import-text').value = csv;
    download('foodlink-scenario.csv', csv, 'text/csv');
  });
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('copy-link').textContent = t(state.lang, 'linkCopied');
      setTimeout(() => { $('copy-link').textContent = t(state.lang, 'copyLink'); }, 1600);
    } catch {
      $('share-url').select();
      document.execCommand('copy');
    }
  });
  $('reset-btn').addEventListener('click', () => {
    if (SCENARIOS.some((s) => s.id === state.scenarioId)) {
      applyScenario(getScenario(state.scenarioId), state.scenarioId);
    } else {
      applyScenario(getScenario(SCENARIOS[0].id), SCENARIOS[0].id);
    }
    recompute();
    renderAll();
    syncHash();
  });
  $('import-btn').addEventListener('click', () => {
    const msg = $('import-msg');
    const text = $('import-text').value.trim();
    if (!text) { msg.textContent = 'empty'; return; }
    let applied = false;
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        const scen = parsed.scenario || parsed;
        const v = validateScenario(scen);
        if (v.ok) {
          applyScenario(scen, null);
          if (parsed.params) Object.assign(state.params, pickParams(parsed.params));
          applied = true;
        } else msg.textContent = v.errors.slice(0, 3).join('; ');
      } catch (e) { msg.textContent = String(e.message); }
    }
    if (!applied && !text.startsWith('{')) {
      const res = scenarioFromCSV(text);
      if (res.ok) { applyScenario(res.scenario, null); applied = true; }
      else msg.textContent = res.errors.slice(0, 3).join('; ') || 'invalid CSV';
    }
    if (applied) {
      msg.textContent = '';
      recompute();
      renderAll();
      syncHash();
    }
  });

  // Lot editor.
  const donorSel = $('lot-donor');
  const catSel = $('lot-category');
  for (const [key, c] of Object.entries(PRODUCT_CLASSES)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = c.label;
    catSel.appendChild(o);
  }
  const allergenWrap = $('lot-allergens');
  for (const a of ALLERGENS) {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = a;
    lab.append(cb, a);
    allergenWrap.appendChild(lab);
  }
  const refreshDonors = () => {
    donorSel.innerHTML = '';
    for (const d of state.scenario.donors) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name;
      donorSel.appendChild(o);
    }
  };
  refreshDonors();
  $('add-lot').addEventListener('click', () => {
    const donor = state.scenario.donors.find((d) => d.id === donorSel.value) || state.scenario.donors[0];
    if (!donor) return;
    const allergens = [...allergenWrap.querySelectorAll('input:checked')].map((x) => x.value);
    const tags = $('lot-tags').value.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
    const kg = Number($('lot-kg').value);
    const servings = Number($('lot-servings').value);
    const fresh = Number($('lot-fresh').value);
    if (!(kg > 0) || !(servings > 0) || !(fresh >= 0)) return;
    donor.lots.push({
      id: `custom-${Date.now().toString(36)}-${donor.lots.length}`,
      name: $('lot-name').value || 'Custom lot',
      category: catSel.value,
      kg, servings, freshHours: fresh,
      allergens, tags,
      proteinG: 5, fiberG: 1, sodiumMg: 120, sugarG: 3,
    });
    state.dirty = true;
    recompute();
    renderAll();
    syncHash();
  });
  // Refresh the donor select whenever a new scenario is applied.
  state._refreshDonors = refreshDonors;
}

function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- boot ----------

function boot() {
  loadFromHash();
  document.documentElement.dataset.theme = state.theme;
  wireControls();
  syncControls();
  applyLang();
  syncHash();
  if (state._refreshDonors) state._refreshDonors();
  // Keep the donor select in sync after scenario switches.
  for (const b of $('scenario-buttons').querySelectorAll('.scn')) {
    b.addEventListener('click', () => state._refreshDonors?.());
  }
}

boot();
