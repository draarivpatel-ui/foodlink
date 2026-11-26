// FoodLink volunteer board. Turns one planned van route into short rescue
// runs that neighbors can claim, hand off and share.
//
//   buildRuns        split plan.visits into runs; each run ends at a pantry
//                    drop-off, so a driver can hand the van over there
//   claimRun         a volunteer takes an open run
//   requestHandoff   the current driver asks for someone to take over
//   takeOverRun      a neighbor accepts a hand-off (or an open run)
//   releaseRun       the run goes back to open
//   normalizeClaims  strict decoder for claims that arrive in a share link
//   reconcileClaims  keeps claims whose run still exists after a replan
//   boardSummary     coverage counts, kg and servings with and without a driver
//   householdReach   households and people that get a box from this plan
//   briefLines       plain-text neighborhood brief (copy, print)
//   briefJSON        the same brief as structured data
//
// Run ids are built from stop ids, never from list position, so a claim
// stays on the same stops when a slider re-plans the route and drops out
// (as an orphan the UI reports) when those stops no longer form a run.
// Nothing here reads the wall clock, so a brief is deterministic.

import { assessLot, urgencyTier } from './spoilage.mjs';
import { ambientWindowHours, coldChainMargins, formatWindow } from './impact.mjs';
import { t } from './i18n.mjs';

export const MAX_NAME_LEN = 32;
export const MAX_CLAIMS = 40;
export const CLAIM_STATUSES = Object.freeze(['claimed', 'handoff']);
const RUN_ID_RE = /^[A-Za-z0-9_.:>#-]{1,240}$/;

const clock = (min) => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
};

function indexScenario(scenario) {
  const stops = new Map();
  const lots = new Map();
  for (const d of scenario?.donors || []) {
    stops.set(d.id, d);
    for (const l of d.lots || []) lots.set(l.id, l);
  }
  for (const p of scenario?.pantries || []) stops.set(p.id, p);
  return { stops, lots };
}

// Split the route into runs. A run collects stops until a pantry drop-off
// closes it; pickups left after the last drop-off form a final run that is
// flagged endsAtPantry: false.
export function buildRuns(plan, scenario, opts = {}) {
  const { ambientC = scenario?.ambientC ?? 20, elapsedMin = 0, budgetMin = scenario?.coldChainMaxMin ?? 120 } = opts;
  const assessments = opts.assessments || null;
  const { stops, lots } = indexScenario(scenario);
  const margins = coldChainMargins(plan, scenario, budgetMin).rows;
  const marginByLot = new Map(margins.map((r) => [r.lotId, r.marginMin]));

  const assess = (lot) => assessments?.get?.(lot.id) || assessLot(lot, ambientC, elapsedMin);

  const groups = [];
  let cur = [];
  (plan?.visits || []).forEach((v, i) => {
    cur.push({ v, stopNo: i + 1 });
    if (v.kind === 'pantry') { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);

  const seen = new Map();
  return groups.map((g, gi) => {
    const baseId = g.map(({ v }) => v.stopId).join('>');
    const dup = seen.get(baseId) || 0;
    seen.set(baseId, dup + 1);
    const id = dup ? `${baseId}#${dup + 1}` : baseId;

    const pickedIds = g.flatMap(({ v }) => v.picked || []);
    const deliveredIds = g.flatMap(({ v }) => v.delivered || []);
    const spoiledIds = g.flatMap(({ v }) => v.spoiledOnArrival || []);
    const deliveredKg = round1(deliveredIds.reduce((n, id2) => n + (Number(lots.get(id2)?.kg) || 0), 0));
    const servings = deliveredIds.reduce((n, id2) => n + (Number(lots.get(id2)?.servings) || 0), 0);

    let soonestSpoilH = null;
    let soonestLot = null;
    for (const lid of pickedIds) {
      const lot = lots.get(lid);
      if (!lot) continue;
      const h = ambientWindowHours(lot, assess(lot), ambientC);
      if (soonestSpoilH == null || h < soonestSpoilH) { soonestSpoilH = h; soonestLot = lot.name; }
    }
    let tightestMarginMin = null;
    for (const lid of deliveredIds) {
      if (!marginByLot.has(lid)) continue;
      const m = marginByLot.get(lid);
      if (tightestMarginMin == null || m < tightestMarginMin) tightestMarginMin = m;
    }

    const first = g[0].v;
    const last = g[g.length - 1].v;
    return {
      id,
      n: gi + 1,
      stops: g.map(({ v, stopNo }) => ({
        stopId: v.stopId,
        stopNo,
        kind: v.kind,
        name: stops.get(v.stopId)?.name || v.stopId,
        arrive: v.arrive,
        depart: v.depart,
      })),
      startMin: first.arrive,
      endMin: last.depart,
      window: `${clock(first.arrive)}-${clock(last.depart)}`,
      pickedIds,
      deliveredIds,
      spoiledIds,
      deliveredKg,
      servings,
      endsAtPantry: last.kind === 'pantry',
      soonestSpoilH,
      soonestLot,
      urgency: soonestSpoilH == null ? 'stable' : urgencyTier(soonestSpoilH),
      tightestMarginMin,
    };
  });
}

function round1(x) { return Math.round(x * 10) / 10; }

// Names come from people typing and from share links, so they are cleaned
// to plain short text: no control characters, no angle brackets, collapsed
// whitespace, at most MAX_NAME_LEN characters.
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, MAX_NAME_LEN).join('').trim();
}

const runIds = (runs) => new Set((runs || []).map((r) => r.id));

function result(ok, claims, error = null) {
  return { ok, claims, error };
}

export function claimRun(claims, runs, runId, name) {
  const who = sanitizeName(name);
  if (!who) return result(false, claims, 'name-required');
  if (!runIds(runs).has(runId)) return result(false, claims, 'unknown-run');
  const cur = claims?.[runId];
  if (cur && cur.status === 'claimed' && cur.by !== who) return result(false, claims, 'already-claimed');
  if (cur && cur.status === 'handoff') return takeOverRun(claims, runs, runId, who);
  return result(true, { ...claims, [runId]: { by: who, status: 'claimed' } });
}

export function requestHandoff(claims, runs, runId) {
  if (!runIds(runs).has(runId)) return result(false, claims, 'unknown-run');
  const cur = claims?.[runId];
  if (!cur || cur.status !== 'claimed') return result(false, claims, 'not-claimed');
  return result(true, { ...claims, [runId]: { by: cur.by, status: 'handoff' } });
}

export function takeOverRun(claims, runs, runId, name) {
  const who = sanitizeName(name);
  if (!who) return result(false, claims, 'name-required');
  if (!runIds(runs).has(runId)) return result(false, claims, 'unknown-run');
  const cur = claims?.[runId];
  if (!cur) return claimRun(claims, runs, runId, who);
  if (cur.status !== 'handoff') return result(false, claims, 'not-handoff');
  const next = { by: who, status: 'claimed' };
  if (cur.by && cur.by !== who) next.from = cur.by;
  return result(true, { ...claims, [runId]: next });
}

export function releaseRun(claims, runs, runId) {
  if (!claims || !(runId in claims)) return result(false, claims, 'not-claimed');
  const next = { ...claims };
  delete next[runId];
  return result(true, next);
}

// Strict decoder for claims from a link or an imported file. Anything that
// is not a well-formed claim is dropped, never thrown on.
export function normalizeClaims(raw) {
  const out = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, c] of Object.entries(raw)) {
    if (n >= MAX_CLAIMS) break;
    if (!RUN_ID_RE.test(id)) continue;
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    if (c == null || typeof c !== 'object' || Array.isArray(c)) continue;
    const by = sanitizeName(c.by);
    if (!by || !CLAIM_STATUSES.includes(c.status)) continue;
    const entry = { by, status: c.status };
    const from = sanitizeName(c.from);
    if (from && from !== by) entry.from = from;
    out[id] = entry;
    n++;
  }
  return out;
}

// Split claims into those that still match a run and those orphaned by a
// replan (stops changed, so the run they named no longer exists).
export function reconcileClaims(claims, runs) {
  const ids = runIds(runs);
  const active = {};
  const orphaned = [];
  for (const [id, c] of Object.entries(claims || {})) {
    if (ids.has(id)) active[id] = c;
    else orphaned.push({ runId: id, by: c.by, status: c.status });
  }
  return { active, orphaned };
}

export function runStatus(claims, runId) {
  const c = claims?.[runId];
  if (!c) return 'open';
  return c.status === 'handoff' ? 'handoff' : 'claimed';
}

export function boardSummary(runs, claims) {
  const s = {
    runs: 0, covered: 0, handoff: 0, open: 0,
    totalKg: 0, coveredKg: 0, openKg: 0,
    totalServings: 0, coveredServings: 0,
    nextOpen: null,
  };
  for (const r of runs || []) {
    s.runs++;
    s.totalKg += r.deliveredKg;
    s.totalServings += r.servings;
    const st = runStatus(claims, r.id);
    if (st === 'claimed') {
      s.covered++;
      s.coveredKg += r.deliveredKg;
      s.coveredServings += r.servings;
    } else {
      if (st === 'handoff') s.handoff++; else s.open++;
      s.openKg += r.deliveredKg;
      if (!s.nextOpen || r.startMin < s.nextOpen.startMin) s.nextOpen = r;
    }
  }
  s.totalKg = round1(s.totalKg);
  s.coveredKg = round1(s.coveredKg);
  s.openKg = round1(s.openKg);
  s.coveredShare = s.runs ? s.covered / s.runs : 0;
  return s;
}

// Households that receive a non-empty box from the allocator, and the
// people in them. Read straight from allocateBoxes output.
export function householdReach(allocation) {
  let households = 0;
  let people = 0;
  for (const b of allocation?.boxes || []) {
    if (!b.items?.length) continue;
    households++;
    people += Number(b.household?.size) || 0;
  }
  return { households, people };
}

function statusText(lang, claims, runId) {
  const c = claims?.[runId];
  if (!c) return t(lang, 'briefStatusOpen');
  if (c.status === 'handoff') return t(lang, 'briefStatusHandoff', { name: c.by });
  return c.from
    ? t(lang, 'briefStatusRelay', { name: c.by, from: c.from })
    : t(lang, 'briefStatusClaimed', { name: c.by });
}

// Plain-text brief a coordinator can paste into a group chat or print.
export function briefLines(runs, claims, ctx = {}, lang = 'en') {
  const L = (k, p) => t(lang, k, p);
  const sum = boardSummary(runs, claims);
  const reach = ctx.reach || { households: 0, people: 0 };
  const lines = [];
  lines.push(`${L('appTitle')} | ${L('briefTitle')}`);
  if (ctx.scenarioName) lines.push(ctx.scenarioName);
  lines.push(L('briefCoverage', { covered: sum.covered, total: sum.runs, kg: sum.coveredKg, totalKg: sum.totalKg }));
  lines.push(L('briefReach', { households: reach.households, people: reach.people, servings: sum.totalServings }));
  lines.push('');
  if (!runs?.length) {
    lines.push(L('emptyManifest'));
    return lines;
  }
  for (const r of runs) {
    lines.push(`${L('runTitle', { n: r.n })} | ${r.window} | ${statusText(lang, claims, r.id)}`);
    lines.push(`  ${r.stops.map((s) => `${s.stopNo}. ${s.name} (${s.kind === 'donor' ? L('pickup') : L('dropoff')})`).join('  >  ')}`);
    const bits = [`${r.deliveredKg} ${L('kgUnit')}`, `${r.servings} ${L('servingsUnit')}`];
    if (r.soonestSpoilH != null) bits.push(L('runSpoils', { t: formatWindow(r.soonestSpoilH) }));
    if (r.tightestMarginMin != null) bits.push(L('runMargin', { m: Math.round(r.tightestMarginMin) }));
    if (!r.endsAtPantry) bits.push(L('runNoPantry'));
    lines.push(`  ${bits.join(' | ')}`);
  }
  const openRuns = runs.filter((r) => runStatus(claims, r.id) !== 'claimed');
  lines.push('');
  lines.push(openRuns.length
    ? L('briefNeeds', { list: openRuns.map((r) => `${L('runTitle', { n: r.n })} (${r.window})`).join(', ') })
    : L('briefAllCovered'));
  return lines;
}

export function briefJSON(runs, claims, ctx = {}) {
  const sum = boardSummary(runs, claims);
  return {
    app: 'FoodLink',
    kind: 'volunteer-brief',
    version: 1,
    scenario: ctx.scenarioName || null,
    summary: {
      runs: sum.runs, covered: sum.covered, handoff: sum.handoff, open: sum.open,
      totalKg: sum.totalKg, coveredKg: sum.coveredKg, openKg: sum.openKg,
      servings: sum.totalServings,
      households: ctx.reach?.households ?? 0,
      people: ctx.reach?.people ?? 0,
    },
    runs: (runs || []).map((r) => {
      const c = claims?.[r.id];
      return {
        n: r.n,
        id: r.id,
        window: r.window,
        status: runStatus(claims, r.id),
        volunteer: c?.by ?? null,
        handedOffFrom: c?.from ?? null,
        stops: r.stops.map((s) => ({ no: s.stopNo, id: s.stopId, name: s.name, kind: s.kind })),
        kg: r.deliveredKg,
        servings: r.servings,
        spoilsInHours: r.soonestSpoilH == null ? null : Math.round(r.soonestSpoilH * 100) / 100,
        coldChainMarginMin: r.tightestMarginMin == null ? null : Math.round(r.tightestMarginMin),
        endsAtPantry: r.endsAtPantry,
      };
    }),
  };
}
