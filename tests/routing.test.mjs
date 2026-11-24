import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CO2E_PER_KG_FOOD, haversineKm, travelMinutes, co2eKg,
  buildContext, simulateOrder, betterPlan, nearestNeighborPlan,
  twoOptImprove, exactPlan, planRoute, routeDistanceKm,
} from '../src/routing.mjs';
import { SCENARIOS, allLots } from '../src/scenarios.mjs';
import { assessLot } from '../src/spoilage.mjs';

// Deterministic PRNG for random-instance property tests.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const miniScenario = (over = {}) => ({
  id: 'mini', name: 'mini', ambientC: 20, startMin: 600, coldChainMaxMin: 120,
  vehicle: { capacityKg: 100, speedKmh: 30, serviceMin: 10 },
  depot: { name: 'depot', lat: 0, lon: 0 },
  donors: [], pantries: [], households: [],
  ...over,
});

const donor = (id, lat, lon, openMin, closeMin, lots = []) => ({ id, name: id, lat, lon, openMin, closeMin, lots });
const pantry = (id, lat, lon, openMin, closeMin, capacityKg) => ({ id, name: id, lat, lon, openMin, closeMin, capacityKg });
const lot = (id, kg, over = {}) => ({ id, name: id, category: 'produce', kg, servings: Math.ceil(kg), freshHours: 100, allergens: [], tags: [], ...over });

// ---------- haversine ----------

test('haversine distance to self is zero', () => {
  assert.equal(haversineKm({ lat: 29.7, lon: -95.4 }, { lat: 29.7, lon: -95.4 }), 0);
});
test('haversine: one degree of latitude is about 111 km', () => {
  const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(d > 110 && d < 112, `${d} km`);
});
test('haversine is symmetric', () => {
  const a = { lat: 29.7, lon: -95.4 };
  const b = { lat: 29.71, lon: -95.44 };
  assert.ok(Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 1e-12);
});
test('haversine satisfies triangle inequality on a three-point trip', () => {
  const a = { lat: 29.7, lon: -95.4 };
  const b = { lat: 29.72, lon: -95.42 };
  const c = { lat: 29.69, lon: -95.38 };
  assert.ok(haversineKm(a, c) <= haversineKm(a, b) + haversineKm(b, c) + 1e-9);
});
test('haversine long-haul sanity: Houston to Chicago ~1500 km', () => {
  const d = haversineKm({ lat: 29.76, lon: -95.37 }, { lat: 41.88, lon: -87.63 });
  assert.ok(d > 1400 && d < 1600, `${d} km`);
});

// ---------- travel / CO2 ----------

test('travelMinutes: 32 km at 32 km/h is 60 min', () => assert.equal(travelMinutes(32, 32), 60));
test('travelMinutes halves when speed doubles', () => assert.equal(travelMinutes(10, 60), travelMinutes(10, 30) / 2));
test('travelMinutes throws on zero speed', () => assert.throws(() => travelMinutes(10, 0)));
test('travelMinutes throws on NaN distance', () => assert.throws(() => travelMinutes(NaN, 30)));

test('CO2e factor is the EPA WARM v15 donation low-end 0.54 t per short ton', () => assert.ok(Math.abs(CO2E_PER_KG_FOOD - 0.54 * 1000 / 907.18474) < 1e-12));
test('CO2e factor is about 0.595 kg per kg', () => assert.equal(Math.round(CO2E_PER_KG_FOOD * 1000) / 1000, 0.595));
test('co2eKg(0) is zero', () => assert.equal(co2eKg(0), 0));
test('co2eKg(10 kg) is 6 kg CO2e', () => assert.equal(co2eKg(10), 6));
test('co2eKg(183 kg) is 108.9 kg CO2e', () => assert.equal(co2eKg(183), 108.9));
test('co2eKg scales linearly (within rounding)', () => assert.ok(Math.abs(co2eKg(200) - co2eKg(100) * 2) <= 0.1));
test('co2eKg rounds to one decimal', () => assert.equal(co2eKg(0.33), 0.2));

// ---------- context ----------

test('buildContext applies scenario vehicle defaults', () => {
  const s = miniScenario();
  const ctx = buildContext(s, {});
  assert.equal(ctx.capacityKg, 100);
  assert.equal(ctx.speedKmh, 30);
  assert.equal(ctx.startMin, 600);
});
test('buildContext honors overrides', () => {
  const ctx = buildContext(miniScenario(), { capacityKg: 9, speedKmh: 40 });
  assert.equal(ctx.capacityKg, 9);
  assert.equal(ctx.speedKmh, 40);
});
test('buildContext lists donors then pantries as stops', () => {
  const s = miniScenario({ donors: [donor('d1', 0, 0.01, 0, 1000)], pantries: [pantry('p1', 0, 0.02, 0, 1200, 50)] });
  const ctx = buildContext(s, {});
  assert.deepEqual(ctx.stops.map((x) => x.kind), ['donor', 'pantry']);
});

// ---------- simulateOrder mechanics ----------

test('arriving before open waits until open', () => {
  const s = miniScenario({ donors: [donor('d1', 0, 0.01, 700, 900, [lot('l1', 10)])] });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  const v = sim.visits[0];
  assert.equal(v.arrive, 700);
  assert.ok(v.wait > 0);
});

test('arriving after close is infeasible', () => {
  const s = miniScenario({ donors: [donor('d1', 0, 0.5, 0, 601)] }); // far away, closes a minute after start
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.feasible, false);
  assert.equal(sim.violations[0].kind, 'window');
});

test('vehicle capacity leaves overweight lots behind', () => {
  const s = miniScenario({
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('big', 150), lot('small', 40)])],
    pantries: [pantry('p1', 0, 0.02, 0, 1400, 500)],
  });
  const ctx = buildContext(s, {}); // capacity 100
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.feasible, true);
  assert.equal(sim.rescuedKg, 40);
});

test('TCS lots that miss the cold-chain budget are spoiled on arrival', () => {
  const s = miniScenario({
    coldChainMaxMin: 30,
    vehicle: { capacityKg: 300, speedKmh: 30, serviceMin: 5 },
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('milk', 20, { category: 'dairy' })])],
    pantries: [pantry('p1', 0, 1.0, 0, 4000, 500)], // ~111 km, 222 min away
  });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.feasible, true);
  assert.equal(sim.rescuedKg, 0);
  assert.equal(sim.spoiledKg, 20);
  assert.deepEqual(sim.visits[1].spoiledOnArrival, ['milk']);
});

test('non-TCS lots ignore the cold-chain budget', () => {
  const s = miniScenario({
    coldChainMaxMin: 30,
    vehicle: { capacityKg: 300, speedKmh: 30, serviceMin: 5 },
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('rice', 20, { category: 'dry' })])],
    pantries: [pantry('p1', 0, 1.0, 0, 4000, 500)],
  });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.rescuedKg, 20);
});

test('pantry capacity caps what it accepts', () => {
  const s = miniScenario({
    vehicle: { capacityKg: 300, speedKmh: 30, serviceMin: 5 },
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('l1', 60), lot('l2', 60)])],
    pantries: [pantry('p1', 0, 0.02, 0, 1400, 80)],
  });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.rescuedKg, 60); // only one 60 kg lot fits the 80 kg room
  assert.equal(sim.strandedKg, 60);
});

test('a second pantry visit can unload the remainder', () => {
  const s = miniScenario({
    vehicle: { capacityKg: 300, speedKmh: 30, serviceMin: 5 },
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('l1', 60), lot('l2', 60)])],
    pantries: [pantry('p1', 0, 0.02, 0, 1400, 80), pantry('p2', 0, 0.03, 0, 1400, 100)],
  });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.rescuedKg, 120);
});

test('already-spoiled lots are skipped at pickup', () => {
  const s = miniScenario({
    donors: [donor('d1', 0, 0.01, 0, 1000, [lot('dead', 50, { spoiled: true }), lot('live', 10)])],
    pantries: [pantry('p1', 0, 0.02, 0, 1400, 100)],
  });
  const ctx = buildContext(s, {});
  const sim = simulateOrder(ctx.stops, ctx);
  assert.equal(sim.rescuedKg, 10);
});

test('empty order is feasible and rescues nothing', () => {
  const sim = simulateOrder([], buildContext(miniScenario(), {}));
  assert.equal(sim.feasible, true);
  assert.equal(sim.rescuedKg, 0);
});

test('returnToDepot adds the home leg', () => {
  const s = miniScenario({ donors: [donor('d1', 0, 0.01, 0, 1000, [lot('l1', 10)])] });
  const ctx = buildContext(s, { returnToDepot: true });
  const sim = simulateOrder(ctx.stops.filter((x) => x.kind === 'donor'), ctx);
  assert.ok(sim.totalMinutes > 10 + travelMinutes(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }), 30));
});

// ---------- betterPlan ordering ----------

test('feasible beats infeasible', () => {
  assert.ok(betterPlan({ feasible: true, rescuedKg: 1, totalMinutes: 9 }, { feasible: false, rescuedKg: 99, totalMinutes: 1 }));
});
test('more rescued kg wins among feasible plans', () => {
  assert.ok(betterPlan({ feasible: true, rescuedKg: 50, totalMinutes: 90 }, { feasible: true, rescuedKg: 40, totalMinutes: 10 }));
});
test('shorter time breaks a rescued-kg tie', () => {
  assert.ok(betterPlan({ feasible: true, rescuedKg: 50, totalMinutes: 30 }, { feasible: true, rescuedKg: 50, totalMinutes: 40 }));
});
test('equal plans do not beat each other', () => {
  const a = { feasible: true, rescuedKg: 5, totalMinutes: 30 };
  const b = { feasible: true, rescuedKg: 5, totalMinutes: 30 };
  assert.equal(betterPlan(a, b), false);
});
test('null never beats a plan', () => {
  assert.equal(betterPlan(null, { feasible: false, totalMinutes: 0 }), false);
});

// ---------- scenario-level plans ----------

for (const s of SCENARIOS) {
  for (const d of s.donors) {
    for (const l of d.lots) {
      const a = assessLot(l, s.ambientC, 0);
      Object.assign(l, { lifeLeftHours: a.lifeLeftHours, spoiled: a.spoiled });
    }
  }

  test(`${s.id}: planRoute finds a feasible plan`, () => {
    const plan = planRoute(s, {});
    assert.equal(plan.feasible, true, JSON.stringify(plan.violations));
  });
  test(`${s.id}: plan rescues more than 0 kg`, () => {
    assert.ok(planRoute(s, {}).rescuedKg > 0);
  });
  test(`${s.id}: every visit respects its time window`, () => {
    const plan = planRoute(s, {});
    for (const v of plan.visits) {
      const stop = plan.order.find((x) => x.id === v.stopId).ref;
      assert.ok(v.arrive >= (stop.openMin ?? -Infinity) - 1e-9 && v.arrive <= stop.closeMin + 1e-9, `${v.stopId} at ${v.arrive}`);
    }
  });
  test(`${s.id}: carried load never exceeds vehicle capacity`, () => {
    const ctx = buildContext(s, {});
    const plan = planRoute(s, {});
    for (const v of plan.visits) assert.ok((v.loadKg ?? 0) <= ctx.capacityKg + 1e-9);
  });
  test(`${s.id}: visit count equals order length`, () => {
    const plan = planRoute(s, {});
    assert.equal(plan.visits.length, plan.order.length);
  });
  test(`${s.id}: method label is exact or nn+2opt`, () => {
    const plan = planRoute(s, {});
    assert.ok(['exact', 'nn+2opt'].includes(plan.method));
  });
  test(`${s.id}: rescued kg equals summed delivered mass`, () => {
    const plan = planRoute(s, {});
    const lotsById = new Map(allLots(s).map((l) => [l.id, l]));
    let kg = 0;
    for (const v of plan.visits) for (const id of v.delivered || []) kg += lotsById.get(id).kg;
    assert.ok(Math.abs(kg - plan.rescuedKg) < 0.001);
  });
  test(`${s.id}: spoiled-on-arrival lots are not counted as rescued`, () => {
    const plan = planRoute(s, {});
    const lotsById = new Map(allLots(s).map((l) => [l.id, l]));
    let kg = 0;
    for (const v of plan.visits) for (const id of v.spoiledOnArrival || []) kg += lotsById.get(id).kg;
    assert.ok(kg <= plan.spoiledKg + 0.001);
  });
}

// ---------- 2-opt and exact search properties ----------

test('2-opt never returns a plan worse than its seed (20 seeded instances)', () => {
  const rand = lcg(7);
  for (let trial = 0; trial < 20; trial++) {
    const donors = Array.from({ length: 3 }, (_, i) =>
      donor(`d${i}`, rand() * 0.1, rand() * 0.1, 480 + Math.floor(rand() * 60), 900 + Math.floor(rand() * 120), [lot(`l${i}`, 5 + rand() * 30)]));
    const pantries = Array.from({ length: 3 }, (_, i) =>
      pantry(`p${i}`, rand() * 0.1, rand() * 0.1, 480, 1400, 200));
    const s = miniScenario({ donors, pantries });
    const ctx = buildContext(s, {});
    const seed = nearestNeighborPlan(ctx);
    const refined = twoOptImprove(seed.order, ctx);
    assert.ok(!betterPlan(seed, refined), `trial ${trial}: seed beat refinement`);
  }
});

test('exact plan is never worse than NN+2-opt (12 seeded instances)', () => {
  const rand = lcg(99);
  for (let trial = 0; trial < 12; trial++) {
    const donors = Array.from({ length: 3 }, (_, i) =>
      donor(`d${i}`, rand() * 0.08, rand() * 0.08, 480 + Math.floor(rand() * 60), 900 + Math.floor(rand() * 120), [lot(`l${i}`, 5 + rand() * 25)]));
    const pantries = Array.from({ length: 3 }, (_, i) =>
      pantry(`p${i}`, rand() * 0.08, rand() * 0.08, 480, 1400, 300));
    const s = miniScenario({ donors, pantries });
    const ctx = buildContext(s, {});
    const exact = exactPlan(ctx);
    const seed = nearestNeighborPlan(ctx);
    const heur = twoOptImprove(seed.order, ctx);
    assert.ok(!betterPlan(heur, exact), `trial ${trial}: heuristic beat exact`);
  }
});

test('2-opt strictly improves or matches a bad starting order', () => {
  // Reversed ordering forces the van to zigzag; 2-opt should do no worse.
  const s = miniScenario({
    donors: [donor('d1', 0, 0.01, 0, 2000, [lot('a', 20)]), donor('d2', 0, 0.05, 0, 2000, [lot('b', 20)])],
    pantries: [pantry('p1', 0, 0.03, 0, 3000, 100), pantry('p2', 0, 0.02, 0, 3000, 100)],
  });
  const ctx = buildContext(s, {});
  const reversed = ctx.stops.slice().reverse();
  const seedSim = simulateOrder(reversed, ctx);
  const refined = twoOptImprove(reversed, ctx);
  assert.ok(!betterPlan(seedSim, refined));
});

test('planRoute uses exact search at or under exactMax', () => {
  const plan = planRoute(SCENARIOS[1], {});
  assert.equal(plan.method, 'exact');
});

test('planRoute falls back to heuristic beyond exactMax', () => {
  const s = SCENARIOS[0];
  const plan = planRoute(s, { exactMax: 0 });
  assert.equal(plan.method, 'nn+2opt');
  assert.equal(plan.feasible, true);
});

test('empty scenario returns an empty feasible plan', () => {
  const plan = planRoute(miniScenario(), {});
  assert.equal(plan.method, 'empty');
  assert.equal(plan.feasible, true);
});

test('routeDistanceKm sums legs from the depot', () => {
  const s = SCENARIOS[0];
  const plan = planRoute(s, {});
  const expect = routeDistanceKm(plan.order, s.depot);
  assert.ok(Math.abs(expect - plan.km) < 1e-9);
});

test('nearestNeighborPlan only queues stops that are still open', () => {
  const s = miniScenario({
    donors: [donor('past', 0, 0.01, 0, 100), donor('open', 0, 0.02, 0, 2000, [lot('l', 5)])],
  });
  const ctx = buildContext(s, {});
  const nn = nearestNeighborPlan(ctx);
  assert.deepEqual(nn.order.map((x) => x.id), ['open']);
  assert.deepEqual(nn.skipped, ['past']);
});

test('nearestNeighborPlan handles zero stops', () => {
  const ctx = buildContext(miniScenario(), {});
  const nn = nearestNeighborPlan(ctx);
  assert.equal(nn.order.length, 0);
  assert.equal(nn.feasible, true);
});
