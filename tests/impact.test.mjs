import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientWindowHours, formatWindow, servingsDelivered, coldChainMargins } from '../src/impact.mjs';
import { assessLot, q10Rate, PRODUCT_CLASSES, simulateColdChain } from '../src/spoilage.mjs';
import { planRoute, simulateOrder, buildContext } from '../src/routing.mjs';
import { SCENARIOS, getScenario, allLots } from '../src/scenarios.mjs';

const lot = (category, freshHours, extra = {}) => ({ id: 'x', name: 'X', category, kg: 1, servings: 2, freshHours, ...extra });

// ---------- ambientWindowHours ----------

test('window equals life left at the 5 C reference', () => {
  const l = lot('produce', 30);
  assert.equal(ambientWindowHours(l, assessLot(l, 5, 0), 5), 30);
});

test('window divides life left by the Q10 rate at ambient', () => {
  const l = lot('bakery', 60);
  const a = assessLot(l, 26, 0);
  assert.ok(Math.abs(ambientWindowHours(l, a, 26) - 60 / q10Rate(26, PRODUCT_CLASSES.bakery.q10)) < 1e-9);
});

test('TCS window is capped by the FDA 4-hour danger-zone clock', () => {
  const milk = lot('dairy', 96);
  const a = assessLot(milk, 20, 0);
  assert.ok(96 / q10Rate(20, 2.5) > 4, 'Q10 alone would allow more than 4 h');
  assert.equal(ambientWindowHours(milk, a, 20), 4);
});

test('TCS cap shrinks by danger minutes already used', () => {
  const milk = lot('dairy', 96);
  const a = assessLot(milk, 20, 60);
  assert.equal(a.dangerMinutes, 60);
  assert.equal(ambientWindowHours(milk, a, 20), 3);
});

test('no danger cap at or below 5 C', () => {
  const milk = lot('dairy', 96);
  assert.equal(ambientWindowHours(milk, assessLot(milk, 4, 0), 4), 96 / q10Rate(4, 2.5));
});

test('non-TCS lots are never capped by the danger clock', () => {
  const bread = lot('bakery', 96);
  assert.ok(ambientWindowHours(bread, assessLot(bread, 30, 0), 30) > 4);
});

test('the window agrees with the engine: lot spoils right at the window', () => {
  for (const cat of Object.keys(PRODUCT_CLASSES)) {
    const l = lot(cat, 30);
    const T = 22;
    const w = ambientWindowHours(l, assessLot(l, T, 0), T);
    const before = simulateColdChain(l, [{ tempC: T, minutes: w * 60 - 1 }]);
    const after = simulateColdChain(l, [{ tempC: T, minutes: w * 60 + 1 }]);
    assert.equal(before.spoiled, false, `${cat} not yet spoiled`);
    assert.equal(after.spoiled, true, `${cat} spoiled just after`);
  }
});

test('spoiled lots have a zero window', () => {
  const l = lot('prepared', 2);
  const a = assessLot(l, 30, 240);
  assert.equal(a.spoiled, true);
  assert.equal(ambientWindowHours(l, a, 30), 0);
});

test('missing assessment gives zero', () => assert.equal(ambientWindowHours(lot('dry', 10), null, 20), 0));

// ---------- formatWindow ----------

test('formatWindow under an hour uses minutes', () => assert.equal(formatWindow(0.4), '24 min'));
test('formatWindow hours keep one decimal', () => assert.equal(formatWindow(3.46), '3.5 h'));
test('formatWindow long spans use days', () => assert.equal(formatWindow(98), '4 d 2 h'));
test('formatWindow rolls 23.6 h remainder into the next day', () => assert.equal(formatWindow(71.7), '3 d 0 h'));
test('formatWindow rejects non-finite', () => assert.equal(formatWindow(NaN), '-'));
test('formatWindow zero is 0 min', () => assert.equal(formatWindow(0), '0 min'));

// ---------- servingsDelivered / coldChainMargins on every built-in scenario ----------

function planFor(s) {
  const sc = getScenario(s.id);
  for (const l of allLots(sc)) {
    const a = assessLot(l, sc.ambientC, 0);
    // mirror app.mjs: write the assessment back onto the scenario lot
    for (const d of sc.donors) for (const x of d.lots) if (x.id === l.id) Object.assign(x, { spoiled: a.spoiled, lifeLeftHours: a.lifeLeftHours });
  }
  const plan = planRoute(sc, { startMin: sc.startMin });
  return { sc, plan };
}

for (const s of SCENARIOS) {
  test(`servings delivered match delivered lots: ${s.id}`, () => {
    const { sc, plan } = planFor(s);
    const byId = new Map(allLots(sc).map((l) => [l.id, l]));
    let kg = 0; let servings = 0;
    for (const v of plan.visits) for (const id of v.delivered || []) { kg += byId.get(id).kg; servings += byId.get(id).servings; }
    assert.ok(Math.abs(kg - plan.rescuedKg) < 1e-6, 'delivered kg equals rescuedKg');
    assert.equal(servingsDelivered(plan, sc), servings);
  });

  test(`every delivered TCS lot sits inside the cold-chain budget: ${s.id}`, () => {
    const { sc, plan } = planFor(s);
    const budget = plan.ctx.coldChainMaxMin;
    const m = coldChainMargins(plan, sc, budget);
    for (const r of m.rows) {
      assert.ok(r.marginMin >= -1e-9, `${r.lotId} margin ${r.marginMin}`);
      assert.ok(Math.abs(r.transitMin + r.marginMin - budget) < 1e-9);
    }
    if (m.rows.length) assert.equal(m.tightest, m.rows[0]);
  });
}

test('margin rows mirror simulateOrder transit (pantry arrival minus donor arrival)', () => {
  const sc = {
    depot: { lat: 0, lon: 0 },
    donors: [{ id: 'd1', name: 'D', lat: 0, lon: 0.01, lots: [{ id: 'm', name: 'Milk', category: 'dairy', kg: 5, servings: 10, freshHours: 96 }] }],
    pantries: [{ id: 'p1', name: 'P', lat: 0, lon: 0.05, capacityKg: 100 }],
    vehicle: { capacityKg: 100, speedKmh: 30, serviceMin: 10 },
    startMin: 600,
  };
  const ctx = buildContext(sc, { coldChainMaxMin: 90 });
  const sim = simulateOrder(ctx.stops, ctx);
  const m = coldChainMargins(sim, sc, 90);
  const transit = sim.visits[1].arrive - sim.visits[0].arrive;
  assert.equal(m.rows.length, 1);
  assert.ok(Math.abs(m.tightest.transitMin - transit) < 1e-9);
  assert.ok(Math.abs(m.tightest.marginMin - (90 - transit)) < 1e-9);
  assert.equal(servingsDelivered(sim, sc), 10);
});

test('non-TCS deliveries produce no margin rows', () => {
  const sc = {
    depot: { lat: 0, lon: 0 },
    donors: [{ id: 'd1', name: 'D', lat: 0, lon: 0.01, lots: [{ id: 'b', name: 'Bread', category: 'bakery', kg: 5, servings: 10, freshHours: 96 }] }],
    pantries: [{ id: 'p1', name: 'P', lat: 0, lon: 0.05, capacityKg: 100 }],
    vehicle: { capacityKg: 100, speedKmh: 30, serviceMin: 10 },
    startMin: 600,
  };
  const ctx = buildContext(sc, {});
  const sim = simulateOrder(ctx.stops, ctx);
  const m = coldChainMargins(sim, sc, 120);
  assert.equal(m.rows.length, 0);
  assert.equal(m.tightest, null);
});

test('empty plan is safe', () => {
  assert.equal(servingsDelivered(null, null), 0);
  assert.deepEqual(coldChainMargins({ visits: [] }, { donors: [] }, 120), { rows: [], tightest: null });
});
