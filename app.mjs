// FoodLink workbench wiring. Everything runs client-side: state, engines,
// SVG rendering, hash sharing. No network, no frameworks.

import {
  PRODUCT_CLASSES, DANGER_ZONE_LIMIT_MIN,
  assessLot, formatHours, compareRescuePriority, cToF, urgencyTier,
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
import { t, manifestLines, checklist, explainer } from './src/i18n.mjs';
import { runSelfTests } from './src/selftest.mjs';
import { ambientWindowHours, formatWindow, servingsDelivered, coldChainMargins } from './src/impact.mjs';
import {
  buildRuns, claimRun, requestHandoff, takeOverRun, releaseRun, normalizeClaims,
  reconcileClaims, runStatus, boardSummary, householdReach, briefLines, briefJSON,
} from './src/shifts.mjs';

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
  claims: {},
  runs: [],
  drafts: {},
  runErrors: {},
};

// ---------- state init / hash ----------

function applyScenario(s, id, sync = true) {
  state.scenario = s;
  state.scenarioId = id || s.id || 'custom';
  state.dirty = !id;
  state.params.ambientC = s.ambientC;
  state.params.coldChainMaxMin = s.coldChainMaxMin ?? 120;
  state.params.capacityKg = s.vehicle?.capacityKg ?? 320;
  state.params.speedKmh = s.vehicle?.speedKmh ?? 30;
  state.params.elapsedMin = 0;
  if (sync) syncControls();
}

function loadFromHash() {
  const raw = location.hash.replace(/^#s=/, '').replace(/^#/, '');
  if (!raw) return false;
  const res = decodeState(raw);
  if (!res.ok) return false;
  const st = res.state;
  if (st.ui) {
    if (st.ui.lang === 'es' || st.ui.lang === 'en') state.lang = st.ui.lang;
    if (st.ui.theme === 'dark' || st.ui.theme === 'light') state.theme = st.ui.theme;
  }
  if (st.claims) state.claims = normalizeClaims(st.claims);
  if (st.scenario) {
    const v = validateScenario(st.scenario);
    if (v.ok) applyScenario(st.scenario, null, false);
    else return false;
  } else if (st.scenarioId && SCENARIOS.some((s) => s.id === st.scenarioId)) {
    applyScenario(getScenario(st.scenarioId), st.scenarioId, false);
  }
  if (st.params) Object.assign(state.params, pickParams(st.params));
  syncControls();
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
  if (Object.keys(state.claims).length) payload.claims = state.claims;
  history.replaceState(null, '', `#s=${encodeState(payload)}`);
  const share = $('share-url');
  if (share) share.value = location.href;
}

// ---------- compute ----------

function recompute() {
  const { scenario, params } = state;
  const startMin = scenario.startMin + params.elapsedMin;
  state.assessments.clear();
  const assessedScenario = {
    ...scenario,
    donors: scenario.donors.map(donor => ({
      ...donor,
      lots: (donor.lots || []).map(lot => {
        const a = assessLot(lot, params.ambientC, params.elapsedMin);
        state.assessments.set(lot.id, a);
        return { ...lot, ...a };
      }),
    })),
  };

  state.plan = planRoute(assessedScenario, {
    capacityKg: params.capacityKg,
    speedKmh: params.speedKmh,
    coldChainMaxMin: params.coldChainMaxMin,
    startMin,
  });

  const lotById = new Map(allLots(assessedScenario).map((l) => [l.id, l]));
  const deliveredIds = new Set();
  for (const v of state.plan.visits || []) for (const id of v.delivered || []) deliveredIds.add(id);
  const deliveredLots = [...deliveredIds].map((id) => lotById.get(id)).filter(Boolean);
  state.allocation = allocateBoxes(deliveredLots, state.scenario.households);
  state.deliveredIds = deliveredIds;
  state.runs = buildRuns(state.plan, assessedScenario, {
    ambientC: params.ambientC, elapsedMin: params.elapsedMin,
    budgetMin: params.coldChainMaxMin, assessments: state.assessments,
  });
}

// ---------- i18n ----------

function applyLang() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(state.lang, el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(state.lang, el.dataset.i18nAria));
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(state.lang, el.dataset.i18nPlaceholder);
  }
  $('selftest-close').setAttribute('aria-label', t(state.lang, 'closeLabel'));
  $('how-close').setAttribute('aria-label', t(state.lang, 'closeLabel'));
  renderExplainer();
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

// Map labels are sized against the rendered width so they stay legible on a
// phone, then placed at the first candidate spot that clears every node,
// halo, stop badge, other label and the frame. A label that fits nowhere is
// dropped; the numbered stop list beside the map still names every stop.
let lastMapWidth = 0;
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

function labelFontUnits() {
  const w = $('map').getBoundingClientRect().width || lastMapWidth || MAP_W;
  lastMapWidth = w;
  const screenPx = w < 560 ? 10.5 : 11.5;
  return Math.min(22, Math.max(11.5, (screenPx * MAP_W) / w));
}

function textWidth(text, fontUnits) {
  if (!measureCtx) return text.length * fontUnits * 0.56;
  measureCtx.font = `600 ${fontUnits}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const circleBox = (cx, cy, r) => ({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });

function renderMap() {
  const svg = $('map');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const proj = projectPoints();
  const s = state.scenario;
  const lang = state.lang;
  const fontU = labelFontUnits();
  const k = Math.min(1.9, Math.max(1, fontU / 11.5)); // badge scale tracks label scale

  const grid = svgEl('g', { class: 'grid', 'aria-hidden': 'true' }, svg);
  for (let i = 1; i < 8; i++) {
    svgEl('line', { class: 'grid-line', x1: (MAP_W / 8) * i, y1: 0, x2: (MAP_W / 8) * i, y2: MAP_H }, grid);
    svgEl('line', { class: 'grid-line', x1: 0, y1: (MAP_H / 7) * i, x2: MAP_W, y2: (MAP_H / 7) * i }, grid);
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

  const obstacles = [{ x: -1, y: -1, w: 0, h: 0 }];
  const nodeBoxById = new Map();
  const labels = [];

  // Depot.
  svgEl('rect', {
    class: 'node node-depot', x: depotPos.x - 7, y: depotPos.y - 7, width: 14, height: 14,
    transform: `rotate(45 ${depotPos.x} ${depotPos.y})`,
  }, svg).appendChild(Object.assign(document.createElementNS(SVGNS, 'title'), { textContent: s.depot.name || t(lang, 'depotLabel') }));
  obstacles.push(circleBox(depotPos.x, depotPos.y, 11));
  labels.push({ p: depotPos, r: 11, text: s.depot.name || t(lang, 'depotLabel'), cls: 'map-label depot' });

  // Donors with urgency halos.
  for (const d of s.donors) {
    const p = proj(d);
    const tier = worstTier(d);
    const color = TIER_COLOR[tier];
    let r = 11;
    if (tier === 'critical' || tier === 'high' || tier === 'spoiled') {
      const halo = svgEl('circle', { class: 'halo', cx: p.x, cy: p.y, r: 20 }, svg);
      halo.style.stroke = color;
      r = 22;
    }
    const c = svgEl('circle', { class: `node node-donor tier-${tier}`, cx: p.x, cy: p.y, r: 10, 'data-stop': d.id }, svg);
    c.style.fill = color;
    const title = svgEl('title', {}, c);
    const lots = (d.lots || []).map((l) => `${l.name} (${l.kg} kg)`).join(', ');
    title.textContent = `${d.name}: ${lots}`;
    const nb = circleBox(p.x, p.y, r);
    obstacles.push(nb);
    nodeBoxById.set(d.id, nb);
    labels.push({ p, r, text: d.name, cls: 'map-label' });
  }

  // Pantries.
  for (const p2 of s.pantries) {
    const p = proj(p2);
    const r = svgEl('rect', { class: 'node node-pantry', x: p.x - 9, y: p.y - 9, width: 18, height: 18, rx: 3, 'data-stop': p2.id }, svg);
    r.style.fill = 'var(--accent)';
    svgEl('title', {}, r).textContent = `${p2.name} (${p2.capacityKg} ${t(lang, 'kgUnit')})`;
    const nb = circleBox(p.x, p.y, 12);
    obstacles.push(nb);
    nodeBoxById.set(p2.id, nb);
    labels.push({ p, r: 12, text: p2.name, cls: 'map-label' });
  }

  // Numbered stop badges sit up and to the right of each node so the node
  // keeps its urgency color. A stop visited twice shows both numbers.
  // Each badge tries eight spots touching its node and takes the first one
  // clear of other nodes and badges (close neighbors otherwise stack).
  const nodeBoxes = obstacles.slice();
  const badges = [];
  visits.forEach((v, i) => {
    const p = stopPos.get(v.stopId);
    if (!p) return;
    const br = 9 * k;
    const d = 6 + br * 0.85;
    const own = nodeBoxById.get(v.stopId);
    const D = Math.SQRT2 * d;
    // Diagonals first (classic badge spot), then the four sides; only if all
    // eight touch something does a badge step outward.
    const dirs = [-45, -135, 45, 135, 0, 180, -90, 90].map((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
    const tryAt = (ux, uy, step) => {
      const bx = p.x + ux * (D + step * (2 * br + 1));
      const by = p.y + uy * (D + step * (2 * br + 1));
      const box = circleBox(bx, by, br + 1);
      const clear = !badges.some((b) => overlaps(box, b))
        && !nodeBoxes.some((n) => n !== own && overlaps(box, n))
        && bx - br > 0 && bx + br < MAP_W && by - br > 0 && by + br < MAP_H;
      return clear ? { bx, by, box } : null;
    };
    let spot = null;
    for (let step = 0; step < 3 && !spot; step++) {
      for (const [ux, uy] of dirs) { spot = tryAt(ux, uy, step); if (spot) break; }
    }
    if (!spot) spot = { bx: p.x + d, by: p.y - d, box: circleBox(p.x + d, p.y - d, br + 1) };
    const { bx, by } = spot;
    badges.push(spot.box);
    svgEl('circle', { class: 'stop-disc', cx: bx.toFixed(1), cy: by.toFixed(1), r: br.toFixed(1), 'data-stop': v.stopId }, svg);
    svgEl('text', { class: 'stop-num', x: bx.toFixed(1), y: (by + 3.8 * k).toFixed(1), 'font-size': (11 * k).toFixed(1) }, svg).textContent = String(i + 1);
    obstacles.push(circleBox(bx, by, br + 1));
  });

  // Place labels, most urgent first.
  const placed = [];
  const lineH = fontU * 1.3; // full ascent + descent, matches getBBox
  for (const lb of labels) {
    const w = textWidth(lb.text, fontU) * 1.06 + 8; // headroom: canvas and SVG can resolve the system face differently
    const { x, y } = lb.p;
    const gap = lb.r + 4;
    const cands = [
      { ax: x - w / 2, ay: y + gap, anchor: 'middle' },
      { ax: x - w / 2, ay: y - gap - lineH, anchor: 'middle' },
      { ax: x + gap, ay: y - lineH / 2, anchor: 'start' },
      { ax: x - gap - w, ay: y - lineH / 2, anchor: 'end' },
      { ax: x - w / 2, ay: y + gap + lineH * 0.9, anchor: 'middle' },
      { ax: x + gap, ay: y + gap * 0.4, anchor: 'start' },
      { ax: x - gap - w, ay: y + gap * 0.4, anchor: 'end' },
      // Diagonal corners clear the node's square box on both axes.
      { ax: x + gap, ay: y - gap - lineH, anchor: 'start' },
      { ax: x - gap - w, ay: y - gap - lineH, anchor: 'end' },
      { ax: x + gap, ay: y + gap, anchor: 'start' },
      { ax: x - gap - w, ay: y + gap, anchor: 'end' },
    ];
    let spot = null;
    for (const c of cands) {
      const box = { x: c.ax, y: c.ay, w, h: lineH };
      if (box.x < 4 || box.y < 4 || box.x + box.w > MAP_W - 4 || box.y + box.h > MAP_H - 4) continue;
      if (obstacles.some((o) => overlaps(box, o)) || placed.some((o) => overlaps(box, o))) continue;
      spot = { ...c, box };
      break;
    }
    if (!spot) continue;
    placed.push(spot.box);
    // A soft plate under each name keeps the dashed route from striking
    // through the words; it fills exactly the box already cleared above.
    svgEl('rect', {
      class: 'map-label-plate',
      x: spot.box.x.toFixed(1),
      y: spot.box.y.toFixed(1),
      width: w.toFixed(1),
      height: lineH.toFixed(1),
      rx: (lineH / 2).toFixed(1),
    }, svg);
    const tx = spot.anchor === 'middle' ? spot.box.x + w / 2 : spot.anchor === 'start' ? spot.box.x + 3 : spot.box.x + w - 3;
    const el = svgEl('text', {
      class: lb.cls,
      x: tx.toFixed(1),
      y: (spot.box.y + fontU * 1.0).toFixed(1),
      'text-anchor': spot.anchor,
      'font-size': fontU.toFixed(2),
    }, svg);
    el.textContent = lb.text;
  }

  renderLegend();
}

function renderLegend() {
  const el = $('map-legend');
  el.innerHTML = '';
  const add = (label, cls, style = {}) => {
    const span = document.createElement('span');
    span.className = 'key';
    const sw = document.createElement('span');
    sw.className = `swatch ${cls}`;
    Object.assign(sw.style, style);
    span.append(sw, document.createTextNode(label));
    el.appendChild(span);
  };
  const L = (k) => t(state.lang, k);
  add(L('legendDepot'), 'sw-depot');
  add(L('legendPantry'), 'sw-pantry');
  for (const tier of ['critical', 'high', 'watch', 'stable', 'spoiled']) {
    add(`${L('legendDonor')}: ${L(`tier${tier[0].toUpperCase()}${tier.slice(1)}`).toLowerCase()}`, 'sw-donor', { background: TIER_COLOR[tier] });
  }
  add(L('legendRoute'), 'sw-route');
  add(L('legendStop'), 'sw-stop');
}

const clock = (min) => {
  const rounded = Math.round(min);
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};

function renderStats() {
  const plan = state.plan;
  const kgFmt = (n) => `${Math.round((n ?? 0) * 10) / 10} kg`;
  $('stat-kg').textContent = kgFmt(plan.rescuedKg);
  $('stat-servings').textContent = String(servingsDelivered(plan, state.scenario));
  $('stat-co2').textContent = `${co2eKg(plan.rescuedKg ?? 0)} kg CO2e`;
  $('stat-spoiled').textContent = kgFmt(plan.spoiledKg);
  $('stat-km').textContent = `${(plan.km ?? 0).toFixed(1)} km`;
  $('stat-min').textContent = `${Math.round(plan.totalMinutes ?? 0)} min`;
  $('stat-method').textContent = plan.method || '-';
  $('stat-spoiled').classList.toggle('bad', (plan.spoiledKg ?? 0) > 0);

  const budget = state.params.coldChainMaxMin;
  const { tightest } = coldChainMargins(plan, state.scenario, budget);
  const cell = $('stat-margin-cell');
  const meter = $('stat-margin-meter');
  if (tightest) {
    const used = Math.min(1, Math.max(0, tightest.transitMin / budget));
    $('stat-margin').textContent = `${Math.round(tightest.marginMin)} min`;
    $('stat-margin-sub').textContent = t(state.lang, 'marginSub', {
      lot: tightest.name, transit: Math.round(tightest.transitMin), budget,
    });
    meter.style.width = `${used * 100}%`;
    cell.classList.toggle('tight', used >= 0.75);
    cell.classList.remove('empty');
  } else {
    $('stat-margin').textContent = '-';
    $('stat-margin-sub').textContent = t(state.lang, 'marginNone');
    meter.style.width = '0%';
    cell.classList.remove('tight');
    cell.classList.add('empty');
  }
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
    row.className = `lot-row tier-row-${tier}`;

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
    cap.textContent = `${t(state.lang, 'lifeLeft')}: ${a.spoiled ? t(state.lang, 'lifeAtRef', { t: '0 h' }) : t(state.lang, 'lifeAtRef', { t: formatHours(a.lifeLeftHours ?? 0) })}`;
    const win = document.createElement('span');
    const winH = ambientWindowHours(lot, a, state.params.ambientC);
    // Colored by the window itself (same hour thresholds as the engine's
    // tiers) so a lot that is Stable in the cooler but has 4 h on the table
    // reads as urgent here.
    win.className = `spoil-window tier-text-${a.spoiled ? 'spoiled' : urgencyTier(winH)}`;
    win.textContent = a.spoiled
      ? t(state.lang, a.cause === 'danger-zone' ? 'spoiledDanger' : 'spoiledAge')
      : t(state.lang, 'spoilsIn', { t: formatWindow(winH), c: state.params.ambientC });
    lifeCell.append(win, bar, cap);

    const dCell = document.createElement('div');
    dCell.className = 'dangercell';
    if (a.tcs) {
      const dbar = document.createElement('div');
      dbar.className = 'bar';
      const dfill = document.createElement('div');
      const used = (a.dangerMinutes ?? 0) / DANGER_ZONE_LIMIT_MIN;
      dfill.className = used >= 0.5 ? 'fill danger hot' : 'fill danger';
      dfill.style.width = `${Math.min(100, used * 100)}%`;
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
    ? t(state.lang, 'leftoverNote', { n: left.length, kg: left.reduce((n, x) => n + x.kgLeft, 0).toFixed(1) })
    : '';
}

// ---------- volunteer board ----------

const STATUS_CLASS = { open: 'st-open', claimed: 'st-claimed', handoff: 'st-handoff' };

function boardState() {
  const { active, orphaned } = reconcileClaims(state.claims, state.runs);
  return { active, orphaned, sum: boardSummary(state.runs, active), reach: householdReach(state.allocation) };
}

// One segment per run, as wide as the run's share of the shift, colored by
// its status. Drawn twice: small on the dispatch card, large on the board.
function renderRelay(el, active) {
  el.textContent = '';
  const runs = state.runs;
  if (!runs.length) return;
  const t0 = runs[0].startMin;
  const span = Math.max(1, runs[runs.length - 1].endMin - t0);
  for (const r of runs) {
    const seg = document.createElement('span');
    seg.className = `relay-seg ${STATUS_CLASS[runStatus(active, r.id)]}`;
    seg.style.flexGrow = String(Math.max(0.12, (r.endMin - r.startMin) / span));
    seg.textContent = String(r.n);
    el.appendChild(seg);
  }
}

function renderCoverage() {
  const { active, sum } = boardState();
  $('coverage-text').textContent = sum.runs
    ? t(state.lang, 'coverageInline', { covered: sum.covered, total: sum.runs })
    : t(state.lang, 'emptyManifest');
  $('coverage-open').hidden = !sum.runs;
  renderRelay($('coverage-relay'), active);
  $('tab-board-count').textContent = sum.runs ? `${sum.covered}/${sum.runs}` : '';
  $('tab-board-count').classList.toggle('done', sum.runs > 0 && sum.covered === sum.runs);
}

function stopToken(s) {
  const tok = document.createElement('span');
  tok.className = `stop-tok kind-${s.kind}`;
  const n = document.createElement('span');
  n.className = 'stop-tok-n';
  n.textContent = String(s.stopNo);
  tok.append(n, document.createTextNode(s.name));
  return tok;
}

function runErrorText(code) {
  if (code === 'name-required') return t(state.lang, 'errNameRequired');
  if (code === 'already-claimed') return t(state.lang, 'errAlreadyClaimed');
  return t(state.lang, 'errGeneric');
}

function applyClaim(op, runId, name) {
  const fn = { claim: claimRun, handoff: requestHandoff, take: takeOverRun, release: releaseRun }[op];
  const res = op === 'handoff' || op === 'release' ? fn(state.claims, state.runs, runId) : fn(state.claims, state.runs, runId, name);
  if (res.ok) {
    state.claims = res.claims;
    delete state.runErrors[runId];
    delete state.drafts[runId];
  } else {
    state.runErrors[runId] = runErrorText(res.error);
  }
  renderCoverage();
  renderBoard();
  syncHash();
  const again = document.querySelector(`[data-run="${CSS.escape(runId)}"] ${res.ok ? 'button' : 'input'}`);
  again?.focus();
}

function nameForm(r, op, label) {
  const form = document.createElement('form');
  form.className = 'claim-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.placeholder = t(state.lang, 'namePlaceholder');
  input.setAttribute('aria-label', t(state.lang, 'nameLabel', { n: r.n }));
  input.value = state.drafts[r.id] || '';
  input.addEventListener('input', () => { state.drafts[r.id] = input.value; });
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.className = 'btn solid';
  btn.textContent = label;
  form.append(input, btn);
  form.addEventListener('submit', (e) => { e.preventDefault(); applyClaim(op, r.id, input.value); });
  return form;
}

function actionBtn(text, op, runId, cls = 'btn') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', () => applyClaim(op, runId));
  return b;
}

function renderBoard() {
  const L = (k, p) => t(state.lang, k, p);
  const { active, orphaned, sum, reach } = boardState();
  $('fig-cover').textContent = `${sum.covered}/${sum.runs}`;
  $('fig-kg').textContent = `${sum.coveredKg} / ${sum.totalKg} kg`;
  $('fig-households').textContent = String(reach.households);
  $('fig-people').textContent = String(reach.people);
  renderRelay($('board-relay'), active);

  const on = $('orphan-note');
  on.hidden = orphaned.length === 0;
  $('orphan-text').textContent = orphaned.length
    ? L('orphanNote', { n: orphaned.length, names: orphaned.map((o) => o.by).join(', ') })
    : '';

  const list = $('run-list');
  list.textContent = '';
  if (!state.runs.length) {
    const li = document.createElement('li');
    li.className = 'run run-empty';
    li.textContent = L('emptyManifest');
    list.appendChild(li);
  }
  for (const r of state.runs) {
    const st = runStatus(active, r.id);
    const c = active[r.id];
    const li = document.createElement('li');
    li.className = `run ${STATUS_CLASS[st]}`;
    li.dataset.run = r.id;

    const head = document.createElement('div');
    head.className = 'run-head';
    const h = document.createElement('h3');
    h.textContent = L('runTitle', { n: r.n });
    const win = document.createElement('span');
    win.className = 'run-window';
    win.textContent = r.window;
    const status = document.createElement('span');
    status.className = 'run-status';
    status.textContent = st === 'open' ? L('runOpen')
      : st === 'handoff' ? L('runHandoff', { name: c.by })
        : c.from ? L('runRelay', { name: c.by, from: c.from }) : L('runClaimed', { name: c.by });
    head.append(h, win, status);

    const route = document.createElement('div');
    route.className = 'run-route';
    route.setAttribute('aria-label', L('runStops'));
    r.stops.forEach((s, i) => {
      if (i) {
        const arrow = document.createElement('span');
        arrow.className = 'run-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        route.appendChild(arrow);
      }
      route.appendChild(stopToken(s));
    });

    const facts = document.createElement('div');
    facts.className = 'run-facts';
    const fact = (text, cls = '') => {
      const f = document.createElement('span');
      f.className = `run-fact ${cls}`;
      f.textContent = text;
      facts.appendChild(f);
    };
    fact(`${r.deliveredKg} kg`);
    fact(`${r.servings} ${L('servingsUnit')}`);
    if (r.soonestSpoilH != null) fact(L('runSpoils', { t: formatWindow(r.soonestSpoilH) }), `tier-text-${r.urgency}`);
    if (r.tightestMarginMin != null) fact(L('runMargin', { m: Math.round(r.tightestMarginMin) }));
    if (!r.endsAtPantry) fact(L('runNoPantry'), 'tier-text-critical');

    const act = document.createElement('div');
    act.className = 'run-act';
    if (st === 'open') act.appendChild(nameForm(r, 'claim', L('claimButton')));
    else if (st === 'claimed') {
      act.append(actionBtn(L('handoffButton'), 'handoff', r.id), actionBtn(L('releaseButton'), 'release', r.id, 'btn ghost'));
    } else {
      act.append(nameForm(r, 'take', L('takeOverButton')), actionBtn(L('releaseButton'), 'release', r.id, 'btn ghost'));
    }
    const err = document.createElement('p');
    err.className = 'run-err';
    err.setAttribute('role', 'status');
    err.textContent = state.runErrors[r.id] || '';
    act.appendChild(err);

    li.append(head, route, facts, act);
    list.appendChild(li);
  }

  $('brief-pre').textContent = currentBrief(active, reach).join('\n');
}

function currentBrief(active, reach) {
  return briefLines(state.runs, active, { scenarioName: state.scenario.name, reach }, state.lang);
}

function flashBrief(msg) {
  const el = $('brief-status');
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2200);
}

// ---------- how it works drawer ----------

function renderExplainer() {
  const body = $('how-body');
  body.textContent = '';
  for (const sec of explainer(state.lang)) {
    const section = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = sec.h;
    section.appendChild(h);
    for (const para of sec.p || []) {
      const p = document.createElement('p');
      p.textContent = para;
      section.appendChild(p);
    }
    if (sec.rows) {
      const dl = document.createElement('dl');
      for (const row of sec.rows) {
        const dt = document.createElement('dt');
        dt.textContent = row.term;
        const dd = document.createElement('dd');
        dd.textContent = row.text;
        dl.append(dt, dd);
      }
      section.appendChild(dl);
    }
    body.appendChild(section);
  }
  const shelf = document.createElement('section');
  const sh = document.createElement('h3');
  sh.textContent = t(state.lang, 'tabShelf');
  const sp = document.createElement('p');
  sp.textContent = t(state.lang, 'shelfNote');
  const sp2 = document.createElement('p');
  sp2.textContent = t(state.lang, 'shareNote');
  shelf.append(sh, sp, sp2);
  body.appendChild(shelf);
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
  renderCoverage();
  renderBoard();
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
      if (next) { clearBoard(); applyScenario(getScenario(s.id), s.id); }
      recompute();
      renderAll();
      syncHash();
      state._refreshDonors?.();
    });
    wrap.appendChild(b);
  }
  $('scenario-blurb').textContent = state.scenario.blurb || '';
}

// Claims name stops of one scenario, so a different scenario starts with an
// empty board instead of a wall of orphaned claims.
function clearBoard() {
  state.claims = {};
  state.drafts = {};
  state.runErrors = {};
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

  const tabEls = [...document.querySelectorAll('.tab')];
  for (const tab of tabEls) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const i = tabEls.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = tabEls[(i + 1) % tabEls.length];
      else if (e.key === 'ArrowLeft') next = tabEls[(i + tabEls.length - 1) % tabEls.length];
      else if (e.key === 'Home') next = tabEls[0];
      else if (e.key === 'End') next = tabEls[tabEls.length - 1];
      if (!next) return;
      e.preventDefault();
      selectTab(next.dataset.tab);
      next.focus();
    });
  }
  $('coverage-open').addEventListener('click', () => {
    selectTab('board');
    $('tab-btn-board').scrollIntoView({ block: 'start' });
    document.querySelector('#run-list input, #run-list button')?.focus({ preventScroll: true });
  });

  // Volunteer board actions.
  $('brief-copy').addEventListener('click', async () => {
    const text = $('brief-pre').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('brief-pre'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('copy');
    }
    flashBrief(t(state.lang, 'briefCopied'));
  });
  $('brief-json').addEventListener('click', () => {
    const { active, reach } = boardState();
    const payload = briefJSON(state.runs, active, { scenarioName: state.scenario.name, reach });
    download('foodlink-volunteer-brief.json', JSON.stringify(payload, null, 2), 'application/json');
  });
  $('brief-print').addEventListener('click', () => {
    document.body.classList.add('print-brief');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-brief'));
  $('orphan-clear').addEventListener('click', () => {
    state.claims = reconcileClaims(state.claims, state.runs).active;
    renderCoverage();
    renderBoard();
    syncHash();
  });

  // How it works drawer.
  const drawer = $('how-drawer');
  $('how-btn').addEventListener('click', () => {
    if (typeof drawer.showModal === 'function') drawer.showModal();
    else drawer.setAttribute('open', '');
  });
  $('how-close').addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.close(); });

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

  $('print-btn').addEventListener('click', () => {
    document.body.classList.remove('print-brief');
    window.print();
  });

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
    state._refreshDonors?.();
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
      clearBoard();
      msg.textContent = '';
      state._refreshDonors?.();
      recompute();
      renderAll();
      syncHash();
    }
  });

  // Lot editor.
  const donorSel = $('lot-donor');
  const catSel = $('lot-category');
  for (const key of Object.keys(PRODUCT_CLASSES)) {
    const o = document.createElement('option');
    o.value = key;
    o.dataset.i18n = 'product_' + key;
    o.textContent = t(state.lang, o.dataset.i18n);
    catSel.appendChild(o);
  }
  const allergenWrap = $('lot-allergens');
  for (const a of ALLERGENS) {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = a;
    const text = document.createElement('span');
    text.dataset.i18n = 'allergen_' + a;
    text.textContent = t(state.lang, text.dataset.i18n);
    lab.append(cb, text);
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
    if (!state.dirty && SCENARIOS.some((x) => x.id === state.scenarioId)) {
      state.scenario.id = `${state.scenarioId}-custom`;
      state.scenario.name = `${state.scenario.name} (edited)`;
      state.scenarioId = state.scenario.id;
    }
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
    renderScenarioButtons();
    renderAll();
    syncHash();
  });
  // Refresh the donor select whenever a new scenario is applied.
  state._refreshDonors = refreshDonors;
}

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((x) => {
    const on = x.dataset.tab === name;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
    x.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
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

function watchMapWidth() {
  if (typeof ResizeObserver === 'undefined') return;
  let pending = 0;
  new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width || 0;
    if (!w || Math.abs(w - lastMapWidth) < 24) return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => renderMap());
  }).observe($('map'));
}

function boot() {
  loadFromHash();
  document.documentElement.dataset.theme = state.theme;
  wireControls();
  syncControls();
  applyLang();
  syncHash();
  watchMapWidth();
  if (state._refreshDonors) state._refreshDonors();
  // Keep the donor select in sync after scenario switches.
  for (const b of $('scenario-buttons').querySelectorAll('.scn')) {
    b.addEventListener('click', () => state._refreshDonors?.());
  }
}

boot();
