import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuns, claimRun, requestHandoff, takeOverRun, releaseRun, normalizeClaims,
  reconcileClaims, runStatus, boardSummary, householdReach, briefLines, briefJSON,
  sanitizeName, MAX_NAME_LEN, MAX_CLAIMS,
} from '../src/shifts.mjs';
import { SCENARIOS, getScenario, allLots, encodeState, decodeState } from '../src/scenarios.mjs';
import { planRoute } from '../src/routing.mjs';
import { allocateBoxes } from '../src/nutrition.mjs';
import { assessLot } from '../src/spoilage.mjs';
import { servingsDelivered } from '../src/impact.mjs';
import { STRINGS } from '../src/i18n.mjs';

const EM = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// Mirrors app.mjs recompute(): lots carry their assessment before routing.
function setup(id, params = {}) {
  const s = getScenario(id);
  const p = { ambientC: s.ambientC, elapsedMin: 0, capacityKg: s.vehicle.capacityKg, speedKmh: s.vehicle.speedKmh, coldChainMaxMin: s.coldChainMaxMin, ...params };
  const assessments = new Map();
  for (const lot of allLots(s)) {
    const a = assessLot(lot, p.ambientC, p.elapsedMin);
    Object.assign(lot, { lifeLeftHours: a.lifeLeftHours, dangerMinutes: a.dangerMinutes, spoiled: a.spoiled, tier: a.tier });
    assessments.set(lot.id, a);
  }
  const plan = planRoute(s, { capacityKg: p.capacityKg, speedKmh: p.speedKmh, coldChainMaxMin: p.coldChainMaxMin, startMin: s.startMin + p.elapsedMin });
  const runs = buildRuns(plan, s, { ambientC: p.ambientC, elapsedMin: p.elapsedMin, budgetMin: p.coldChainMaxMin, assessments });
  const delivered = new Set(plan.visits.flatMap((v) => v.delivered || []));
  const lotById = new Map(allLots(s).map((l) => [l.id, l]));
  const allocation = allocateBoxes([...delivered].map((x) => lotById.get(x)), s.households);
  return { s, p, plan, runs, allocation };
}

const PARAM_GRID = [
  {},
  { ambientC: 5 },
  { ambientC: 35 },
  { elapsedMin: 120 },
  { capacityKg: 100 },
  { coldChainMaxMin: 30 },
  { speedKmh: 15 },
];

// ---------- run structure, every scenario x parameter grid ----------

for (const sc of SCENARIOS) {
  for (const params of PARAM_GRID) {
    const tag = `${sc.id} ${JSON.stringify(params)}`;
    const { plan, runs, s } = setup(sc.id, params);

    test(`runs cover every visit exactly once in order (${tag})`, () => {
      const flat = runs.flatMap((r) => r.stops.map((x) => x.stopNo));
      assert.deepEqual(flat, plan.visits.map((_, i) => i + 1));
    });

    test(`every run but the last ends at a pantry (${tag})`, () => {
      runs.slice(0, -1).forEach((r) => assert.equal(r.endsAtPantry, true, r.id));
      for (const r of runs) assert.equal(r.endsAtPantry, r.stops.at(-1).kind === 'pantry');
    });

    test(`run kg and servings add up to the plan (${tag})`, () => {
      const kg = runs.reduce((n, r) => n + r.deliveredKg, 0);
      assert.ok(Math.abs(kg - plan.rescuedKg) < 0.11, `${kg} vs ${plan.rescuedKg}`);
      assert.equal(runs.reduce((n, r) => n + r.servings, 0), servingsDelivered(plan, s));
    });

    test(`run ids are unique and built from stop ids (${tag})`, () => {
      const ids = runs.map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const r of runs) assert.ok(r.id.startsWith(r.stops.map((x) => x.stopId).join('>')));
    });

    test(`run windows are ordered and well formed (${tag})`, () => {
      for (const r of runs) {
        assert.match(r.window, /^\d\d:\d\d-\d\d:\d\d$/);
        assert.ok(r.endMin >= r.startMin);
      }
      for (let i = 1; i < runs.length; i++) assert.ok(runs[i].startMin >= runs[i - 1].endMin - 1e-9);
    });

    test(`spoil window and margin are finite when present (${tag})`, () => {
      for (const r of runs) {
        if (r.soonestSpoilH != null) assert.ok(Number.isFinite(r.soonestSpoilH) && r.soonestSpoilH >= 0);
        if (r.tightestMarginMin != null) assert.ok(Number.isFinite(r.tightestMarginMin));
        assert.ok(['critical', 'high', 'watch', 'stable'].includes(r.urgency));
      }
    });

    test(`brief is dash free and names every run (${tag})`, () => {
      const text = briefLines(runs, {}, { scenarioName: s.name }, 'en').join('\n');
      assert.ok(!text.includes(EM) && !text.includes(EN_DASH));
      for (const r of runs) assert.ok(text.includes(`Run ${r.n} |`));
    });
  }
}

// ---------- claim lifecycle ----------

const fm = setup('farmers-market');
const r1 = fm.runs[0].id;
const r2 = fm.runs[1].id;

test('farmers market splits into two runs', () => assert.equal(fm.runs.length, 2));
test('a fresh board is all open', () => {
  const sum = boardSummary(fm.runs, {});
  assert.equal(sum.open, 2);
  assert.equal(sum.covered, 0);
  assert.equal(sum.coveredShare, 0);
  assert.equal(sum.nextOpen.id, r1);
});

test('claim needs a name', () => {
  const r = claimRun({}, fm.runs, r1, '   ');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'name-required');
});
test('claim rejects an unknown run', () => {
  assert.equal(claimRun({}, fm.runs, 'nope', 'Maya').error, 'unknown-run');
});
test('claim marks the run as claimed', () => {
  const r = claimRun({}, fm.runs, r1, 'Maya');
  assert.ok(r.ok);
  assert.deepEqual(r.claims[r1], { by: 'Maya', status: 'claimed' });
  assert.equal(runStatus(r.claims, r1), 'claimed');
  assert.equal(runStatus(r.claims, r2), 'open');
});
test('claim does not mutate the input', () => {
  const before = {};
  claimRun(before, fm.runs, r1, 'Maya');
  assert.deepEqual(before, {});
});
test('a second volunteer cannot grab a claimed run', () => {
  const a = claimRun({}, fm.runs, r1, 'Maya').claims;
  const b = claimRun(a, fm.runs, r1, 'Jordan');
  assert.equal(b.ok, false);
  assert.equal(b.error, 'already-claimed');
  assert.equal(b.claims, a);
});
test('the same volunteer re-claiming is a no-op success', () => {
  const a = claimRun({}, fm.runs, r1, 'Maya').claims;
  assert.ok(claimRun(a, fm.runs, r1, 'Maya').ok);
});
test('hand-off request needs an existing claim', () => {
  assert.equal(requestHandoff({}, fm.runs, r1).error, 'not-claimed');
  assert.equal(requestHandoff({}, fm.runs, 'ghost').error, 'unknown-run');
});
test('hand-off keeps the driver name and flips status', () => {
  const a = claimRun({}, fm.runs, r1, 'Maya').claims;
  const b = requestHandoff(a, fm.runs, r1);
  assert.ok(b.ok);
  assert.deepEqual(b.claims[r1], { by: 'Maya', status: 'handoff' });
  assert.equal(runStatus(b.claims, r1), 'handoff');
});
test('take over records who handed off', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  const r = takeOverRun(c, fm.runs, r1, 'Jordan');
  assert.ok(r.ok);
  assert.deepEqual(r.claims[r1], { by: 'Jordan', status: 'claimed', from: 'Maya' });
});
test('take over by the original driver cancels the hand-off', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  assert.deepEqual(takeOverRun(c, fm.runs, r1, 'Maya').claims[r1], { by: 'Maya', status: 'claimed' });
});
test('take over of a claimed run without hand-off is refused', () => {
  const c = claimRun({}, fm.runs, r1, 'Maya').claims;
  assert.equal(takeOverRun(c, fm.runs, r1, 'Jordan').error, 'not-handoff');
});
test('take over of an open run is a claim', () => {
  assert.deepEqual(takeOverRun({}, fm.runs, r1, 'Jordan').claims[r1], { by: 'Jordan', status: 'claimed' });
});
test('claiming a run in hand-off routes to take over', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  assert.equal(claimRun(c, fm.runs, r1, 'Jordan').claims[r1].from, 'Maya');
});
test('take over needs a name', () => {
  assert.equal(takeOverRun({}, fm.runs, r1, '').error, 'name-required');
});
test('release reopens a run', () => {
  const c = claimRun({}, fm.runs, r1, 'Maya').claims;
  const r = releaseRun(c, fm.runs, r1);
  assert.ok(r.ok);
  assert.deepEqual(r.claims, {});
});
test('release of an open run reports not-claimed', () => {
  assert.equal(releaseRun({}, fm.runs, r1).error, 'not-claimed');
});

// ---------- summary and reach ----------

test('summary counts covered, hand-off and open runs', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = claimRun(c, fm.runs, r2, 'Jordan').claims;
  c = requestHandoff(c, fm.runs, r2).claims;
  const s = boardSummary(fm.runs, c);
  assert.equal(s.covered, 1);
  assert.equal(s.handoff, 1);
  assert.equal(s.open, 0);
  assert.equal(s.coveredKg, fm.runs[0].deliveredKg);
  assert.equal(s.openKg, fm.runs[1].deliveredKg);
  assert.equal(s.nextOpen.id, r2);
  assert.equal(s.coveredShare, 0.5);
});
test('summary with every run claimed has no next open run', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = claimRun(c, fm.runs, r2, 'Jordan').claims;
  const s = boardSummary(fm.runs, c);
  assert.equal(s.nextOpen, null);
  assert.equal(s.coveredShare, 1);
  assert.equal(s.coveredKg, s.totalKg);
});
test('summary of no runs is all zero', () => {
  const s = boardSummary([], {});
  assert.deepEqual([s.runs, s.covered, s.open, s.totalKg, s.coveredShare], [0, 0, 0, 0, 0]);
});
test('household reach counts only non-empty boxes', () => {
  const reach = householdReach(fm.allocation);
  const expected = fm.allocation.boxes.filter((b) => b.items.length);
  assert.equal(reach.households, expected.length);
  assert.equal(reach.people, expected.reduce((n, b) => n + b.household.size, 0));
  assert.ok(reach.households > 0);
});
test('household reach of nothing is zero', () => {
  assert.deepEqual(householdReach(null), { households: 0, people: 0 });
  assert.deepEqual(householdReach({ boxes: [{ items: [], household: { size: 4 } }] }), { households: 0, people: 0 });
});

// ---------- names and link decoding ----------

test('sanitizeName trims and collapses whitespace', () => assert.equal(sanitizeName('  Maya   R  '), 'Maya R'));
test('sanitizeName strips angle brackets', () => assert.equal(sanitizeName('<b>Jo</b>'), 'bJo/b'));
test('sanitizeName strips control characters', () => assert.equal(sanitizeName('Jo\u0000\u0007rdan'), 'Jordan'));
test('sanitizeName caps the length', () => assert.equal([...sanitizeName('x'.repeat(100))].length, MAX_NAME_LEN));
test('sanitizeName keeps accented names', () => assert.equal(sanitizeName('José Núñez'), 'José Núñez'));
test('sanitizeName rejects non-strings', () => {
  for (const v of [null, undefined, 42, {}, []]) assert.equal(sanitizeName(v), '');
});
test('normalizeClaims drops junk shapes', () => {
  for (const v of [null, 'x', 7, [1, 2], true]) assert.deepEqual(normalizeClaims(v), {});
});
test('normalizeClaims keeps a valid claim', () => {
  assert.deepEqual(normalizeClaims({ [r1]: { by: 'Maya', status: 'claimed' } }), { [r1]: { by: 'Maya', status: 'claimed' } });
});
test('normalizeClaims drops a bad status', () => {
  assert.deepEqual(normalizeClaims({ [r1]: { by: 'Maya', status: 'owner' } }), {});
});
test('normalizeClaims drops an empty name', () => {
  assert.deepEqual(normalizeClaims({ [r1]: { by: '<>', status: 'claimed' } }), {});
});
test('normalizeClaims drops a hostile run id', () => {
  assert.deepEqual(normalizeClaims({ '<script>': { by: 'Maya', status: 'claimed' } }), {});
});
test('normalizeClaims sanitizes names and from', () => {
  const out = normalizeClaims({ [r1]: { by: ' <i>Maya</i> ', status: 'claimed', from: 'Jo<>' } });
  assert.deepEqual(out[r1], { by: 'iMaya/i', status: 'claimed', from: 'Jo' });
});
test('normalizeClaims drops from equal to by', () => {
  assert.deepEqual(normalizeClaims({ [r1]: { by: 'Maya', status: 'claimed', from: 'Maya' } })[r1], { by: 'Maya', status: 'claimed' });
});
test('normalizeClaims caps the number of claims', () => {
  const raw = {};
  for (let i = 0; i < 100; i++) raw[`d-${i}>p-x`] = { by: `V${i}`, status: 'claimed' };
  assert.equal(Object.keys(normalizeClaims(raw)).length, MAX_CLAIMS);
});

// ---------- replans and the share link ----------

test('a claim survives a replan that keeps the same stops', () => {
  const c = claimRun({}, fm.runs, r1, 'Maya').claims;
  const again = setup('farmers-market', { ambientC: 24 });
  const { active, orphaned } = reconcileClaims(c, again.runs);
  if (again.runs.some((r) => r.id === r1)) {
    assert.deepEqual(active, c);
    assert.deepEqual(orphaned, []);
  } else {
    assert.equal(orphaned.length, 1);
  }
});
test('a claim on stops that vanish becomes an orphan', () => {
  const c = { 'zz-gone>p-nowhere': { by: 'Maya', status: 'claimed' } };
  const { active, orphaned } = reconcileClaims(c, fm.runs);
  assert.deepEqual(active, {});
  assert.deepEqual(orphaned, [{ runId: 'zz-gone>p-nowhere', by: 'Maya', status: 'claimed' }]);
});
test('a capacity squeeze replan reports changed runs as orphans, not silent drops', () => {
  let c = {};
  for (const r of fm.runs) c = claimRun(c, fm.runs, r.id, `V${r.n}`).claims;
  const squeezed = setup('farmers-market', { capacityKg: 80 });
  const { active, orphaned } = reconcileClaims(c, squeezed.runs);
  assert.equal(Object.keys(active).length + orphaned.length, fm.runs.length);
  for (const id of Object.keys(active)) assert.ok(squeezed.runs.some((r) => r.id === id));
});
test('claims round-trip through the real URL hash state', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = claimRun(c, fm.runs, r2, 'José').claims;
  c = requestHandoff(c, fm.runs, r2).claims;
  const payload = { params: fm.p, ui: { lang: 'es', theme: 'dark' }, scenarioId: 'farmers-market', claims: c };
  const dec = decodeState(encodeState(payload));
  assert.ok(dec.ok);
  assert.deepEqual(normalizeClaims(dec.state.claims), c);
  assert.deepEqual(dec.state.params, fm.p);
  assert.equal(dec.state.scenarioId, 'farmers-market');
  assert.deepEqual(dec.state.ui, { lang: 'es', theme: 'dark' });
});
test('a hash with hostile claims decodes to clean claims', () => {
  const payload = { scenarioId: 'farmers-market', claims: { [r1]: { by: '<img src=x onerror=alert(1)>', status: 'claimed' }, bad: 5 } };
  const dec = decodeState(encodeState(payload));
  assert.ok(dec.ok);
  const out = normalizeClaims(dec.state.claims);
  assert.ok(!JSON.stringify(out).includes('<'));
});

// ---------- brief text and JSON ----------

test('brief shows coverage, reach and open runs', () => {
  const c = claimRun({}, fm.runs, r1, 'Maya').claims;
  const reach = householdReach(fm.allocation);
  const text = briefLines(fm.runs, c, { scenarioName: fm.s.name, reach }, 'en').join('\n');
  assert.ok(text.includes('Neighborhood volunteer brief'));
  assert.ok(text.includes('1 of 2 runs have a driver'));
  assert.ok(text.includes(`${reach.households} households`));
  assert.ok(text.includes('driver Maya'));
  assert.ok(text.includes('Still needed: Run 2'));
});
test('brief says every run is covered when it is', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = claimRun(c, fm.runs, r2, 'Jordan').claims;
  assert.ok(briefLines(fm.runs, c, {}, 'en').join('\n').includes('Every run has a driver.'));
});
test('brief names a relay', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  c = takeOverRun(c, fm.runs, r1, 'Jordan').claims;
  assert.ok(briefLines(fm.runs, c, {}, 'en').join('\n').includes('driver Jordan (took over from Maya)'));
});
test('brief flags a hand-off request', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  assert.ok(briefLines(fm.runs, c, {}, 'en').join('\n').includes('hand-off needed, Maya is stepping away'));
});
test('brief renders in Spanish', () => {
  const text = briefLines(fm.runs, {}, {}, 'es').join('\n');
  assert.ok(text.includes('Resumen vecinal de voluntarios'));
  assert.ok(text.includes('Tramo 1'));
  assert.ok(text.includes('ABIERTO'));
});
test('brief of an empty plan explains why', () => {
  assert.ok(briefLines([], {}, {}, 'en').join('\n').includes('No feasible route'));
});
test('brief is deterministic', () => {
  const a = briefLines(fm.runs, {}, { scenarioName: 'x' }, 'en').join('\n');
  const b = briefLines(fm.runs, {}, { scenarioName: 'x' }, 'en').join('\n');
  assert.equal(a, b);
});
test('JSON brief mirrors the board', () => {
  let c = claimRun({}, fm.runs, r1, 'Maya').claims;
  c = requestHandoff(c, fm.runs, r1).claims;
  c = takeOverRun(c, fm.runs, r1, 'Jordan').claims;
  const reach = householdReach(fm.allocation);
  const j = briefJSON(fm.runs, c, { scenarioName: fm.s.name, reach });
  assert.equal(j.kind, 'volunteer-brief');
  assert.equal(j.runs.length, fm.runs.length);
  assert.equal(j.runs[0].volunteer, 'Jordan');
  assert.equal(j.runs[0].handedOffFrom, 'Maya');
  assert.equal(j.runs[1].status, 'open');
  assert.equal(j.summary.households, reach.households);
  assert.equal(j.summary.covered, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(j)), j);
});
test('JSON brief has no wall-clock stamp', () => {
  const a = JSON.stringify(briefJSON(fm.runs, {}, {}));
  const b = JSON.stringify(briefJSON(fm.runs, {}, {}));
  assert.equal(a, b);
});

// ---------- strings ----------

for (const k of ['tabBoard', 'howButton', 'runTitle', 'claimButton', 'handoffButton', 'takeOverButton', 'releaseButton', 'copyBrief', 'printBrief', 'briefTitle']) {
  test(`board string "${k}" is translated`, () => {
    assert.ok(STRINGS.en[k] && STRINGS.es[k]);
    assert.notEqual(STRINGS.en[k], STRINGS.es[k]);
  });
}
test('no board string uses an em or en dash', () => {
  for (const lang of ['en', 'es']) {
    for (const [k, v] of Object.entries(STRINGS[lang])) {
      assert.ok(!v.includes(EM) && !v.includes(EN_DASH), `${lang}.${k}`);
    }
  }
});

test('normalizeClaims drops prototype-key run ids instead of writing them', () => {
  const raw = {
    '__proto__': { by: 'Ada', status: 'claimed' },
    constructor: { by: 'Ada', status: 'claimed' },
    prototype: { by: 'Ada', status: 'claimed' },
    'run-1': { by: 'Ada', status: 'claimed' },
  };
  const out = normalizeClaims(raw);
  assert.deepEqual(Object.keys(out), ['run-1']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});
