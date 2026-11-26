// FoodLink route optimizer.
// Multi-stop volunteer dispatch planning: pickup at donor sites and delivery
// to pantries, with vehicle capacity, time windows and a cold-chain transit
// budget. Small instances are solved exactly by enumeration; larger ones get
// a nearest-neighbor seed refined by feasibility-aware 2-opt.

import { isTCS } from './spoilage.mjs';

// EPA WARM v15 "Modeling Food Donation Benefits in WARM" (June 2019), Table 1:
// low-end estimate (avoided landfilling only) is 0.54 MTCO2E per short ton of
// food donated (Table 1's own unit), the same for every food category. We
// apply it only to kg actually delivered inside the cold-chain budget and add
// no further loss adjustment. 0.54 t / 907.18474 kg = 0.595 kg/kg.
export const SHORT_TON_KG = 907.18474;
export const WARM_V15_DONATION_LOW_MTCO2E_PER_SHORT_TON = 0.54;
export const CO2E_PER_KG_FOOD = (WARM_V15_DONATION_LOW_MTCO2E_PER_SHORT_TON * 1000) / SHORT_TON_KG; // kg CO2e per kg food

export const DEFAULT_SPEED_KMH = 32;
export const DEFAULT_SERVICE_MIN = 12;
export const DEFAULT_COLD_CHAIN_MIN = 120;
export const DEFAULT_EXACT_MAX = 8;

export function haversineKm(a, b) {
  const R = 6371.0088;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function travelMinutes(km, speedKmh = DEFAULT_SPEED_KMH) {
  if (!Number.isFinite(km) || !Number.isFinite(speedKmh) || speedKmh <= 0) {
    throw new RangeError('travelMinutes needs finite km and speedKmh > 0');
  }
  return (km / speedKmh) * 60;
}

export function co2eKg(rescuedKg) {
  return Math.round(rescuedKg * CO2E_PER_KG_FOOD * 10) / 10;
}

// Build the routing context from a scenario + parameter overrides.
// Lots flagged spoiled by the spoilage engine are excluded from pickup.
export function buildContext(scenario, opts = {}) {
  const vehicle = scenario.vehicle || {};
  return {
    depot: opts.depot || scenario.depot,
    speedKmh: opts.speedKmh ?? vehicle.speedKmh ?? DEFAULT_SPEED_KMH,
    serviceMin: opts.serviceMin ?? vehicle.serviceMin ?? DEFAULT_SERVICE_MIN,
    capacityKg: opts.capacityKg ?? vehicle.capacityKg ?? 400,
    startMin: opts.startMin ?? scenario.startMin ?? 8 * 60,
    coldChainMaxMin: opts.coldChainMaxMin ?? scenario.coldChainMaxMin ?? DEFAULT_COLD_CHAIN_MIN,
    returnToDepot: opts.returnToDepot ?? false,
    stops: [
      ...scenario.donors.map((d) => ({ kind: 'donor', ref: d, id: d.id })),
      ...scenario.pantries.map((p) => ({ kind: 'pantry', ref: p, id: p.id })),
    ],
  };
}

// Simulate one stop order. Returns the full trace; the plan is "feasible"
// when every stop is reached inside its time window. Lots that miss the
// cold-chain budget are marked spoiled on arrival, not rescued.
export function simulateOrder(order, ctx) {
  let t = ctx.startMin;
  let pos = ctx.depot;
  let loadKg = 0;
  let km = 0;
  let rescuedKg = 0;
  let spoiledKg = 0;
  const carried = [];
  const pantryUsed = new Map(ctx.stops
    .filter((s) => s.kind === 'pantry')
    .map((s) => [s.id, 0]));
  const visits = [];
  const violations = [];
  const timeline = [];

  const pushVisit = (stop, arrive, depart, wait, detail = {}) => {
    const v = { stopId: stop.id, kind: stop.kind, arrive, depart, wait, ...detail };
    visits.push(v);
    timeline.push(v);
  };

  for (const stop of order) {
    const legKm = haversineKm(pos, stop.ref);
    km += legKm;
    let arrive = t + travelMinutes(legKm, ctx.speedKmh);
    const open = stop.ref.openMin ?? -Infinity;
    const close = stop.ref.closeMin ?? Infinity;
    let wait = 0;
    if (arrive < open) { wait = open - arrive; arrive = open; }
    if (arrive > close) {
      violations.push({ stopId: stop.id, kind: 'window', arrive, close });
      return { feasible: false, violations, visits, timeline, km, rescuedKg, spoiledKg, totalMinutes: arrive - ctx.startMin, order };
    }
    let depart = arrive + ctx.serviceMin;
    if (stop.kind === 'donor') {
      const picked = [];
      for (const lot of stop.ref.lots || []) {
        if (lot.spoiled) continue;
        if (loadKg + lot.kg > ctx.capacityKg) continue; // leave what does not fit
        loadKg += lot.kg;
        const held = { ...lot, pickedAt: arrive };
        carried.push(held);
        picked.push(lot.id);
      }
      pushVisit(stop, arrive, depart, wait, { picked, loadKg });
    } else {
      const delivered = [];
      const spoiledOnArrival = [];
      const used = pantryUsed.get(stop.id) ?? 0;
      const capacity = stop.ref.capacityKg ?? Infinity;
      let roomKg = capacity - used;
      let acceptedKg = 0;
      for (const lot of carried.slice()) {
        if (lot.kg > roomKg) continue;
        const transitMin = arrive - lot.pickedAt;
        const okChain = !isTCS(lot) || transitMin <= ctx.coldChainMaxMin;
        carried.splice(carried.indexOf(lot), 1);
        loadKg -= lot.kg;
        if (okChain) {
          roomKg -= lot.kg;
          acceptedKg += lot.kg;
          delivered.push(lot.id);
          rescuedKg += lot.kg;
        } else {
          spoiledOnArrival.push(lot.id);
          spoiledKg += lot.kg;
        }
      }
      pantryUsed.set(stop.id, used + acceptedKg);
      pushVisit(stop, arrive, depart, wait, { delivered, spoiledOnArrival, loadKg });
    }
    t = depart;
    pos = stop.ref;
  }

  if (ctx.returnToDepot) {
    const legKm = haversineKm(pos, ctx.depot);
    km += legKm;
    t += travelMinutes(legKm, ctx.speedKmh);
  }

  const strandedKg = carried.reduce((n, l) => n + l.kg, 0);
  spoiledKg += strandedKg;
  return {
    feasible: true,
    violations,
    visits,
    timeline,
    km,
    totalMinutes: t - ctx.startMin,
    rescuedKg: Math.round(rescuedKg * 1000) / 1000,
    spoiledKg: Math.round(spoiledKg * 1000) / 1000,
    strandedKg: Math.round(strandedKg * 1000) / 1000,
    order,
  };
}

// Lexicographic plan comparison: rescued kg first, then shorter time.
export function betterPlan(a, b) {
  if (a == null) return false;
  if (b == null) return true;
  if (a.feasible !== b.feasible) return a.feasible;
  if (!a.feasible) return a.totalMinutes < b.totalMinutes;
  if (a.rescuedKg !== b.rescuedKg) return a.rescuedKg > b.rescuedKg;
  return a.totalMinutes < b.totalMinutes;
}

// Greedy seed: repeatedly pick the reachable stop with the earliest arrival.
export function nearestNeighborPlan(ctx) {
  const remaining = ctx.stops.slice();
  const order = [];
  let pos = ctx.depot;
  let t = ctx.startMin;
  while (remaining.length) {
    let bestIdx = -1;
    let bestArrive = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const arrive = Math.max(
        t + travelMinutes(haversineKm(pos, s.ref), ctx.speedKmh),
        s.ref.openMin ?? -Infinity,
      );
      const close = s.ref.closeMin ?? Infinity;
      if (arrive <= close && arrive < bestArrive) { bestArrive = arrive; bestIdx = i; }
    }
    if (bestIdx < 0) break; // no stop still reachable: keep the rest for reporting
    const [next] = remaining.splice(bestIdx, 1);
    order.push(next);
    t = bestArrive + ctx.serviceMin;
    pos = next.ref;
  }
  const sim = simulateOrder(order, ctx);
  return { ...sim, skipped: remaining.map((s) => s.id) };
}

// Feasibility-aware 2-opt. Never accepts a move that breaks a time window or
// lowers the lexicographic score.
export function twoOptImprove(order, ctx, maxIter = 60) {
  let best = order.slice();
  let bestSim = simulateOrder(best, ctx);
  let iterations = 0;
  let improved = true;
  while (improved && iterations < maxIter) {
    improved = false;
    iterations += 1;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = best.slice(0, i)
          .concat(best.slice(i, j + 1).reverse())
          .concat(best.slice(j + 1));
        const sim = simulateOrder(candidate, ctx);
        if (betterPlan(sim, bestSim)) {
          best = candidate;
          bestSim = sim;
          improved = true;
        }
      }
    }
  }
  return { ...bestSim, iterations };
}

// Exhaustive subset-and-permutation search for small instances (n <= ~8).
// A stop that cannot be reached inside its window must not poison the whole
// plan: the exact solver compares every ordered subset, then reports the
// stops it left out. This is still exact for the rescue objective because a
// feasible full route is only one candidate among the subsets.
export function exactPlan(ctx) {
  const stops = ctx.stops.slice();
  let best = null;
  // Exact-search scoring keeps the rescue objective first, then covers every
  // stop it can. Coverage outranks minutes here so a redundant but reachable
  // pantry still becomes a volunteer hand-off instead of being optimized away;
  // a stop is skipped only when visiting it is impossible or costs rescued food.
  const betterExact = (a, b) => {
    if (b == null) return true;
    if (a.feasible !== b.feasible) return a.feasible;
    if (!a.feasible) return a.totalMinutes < b.totalMinutes;
    if (a.rescuedKg !== b.rescuedKg) return a.rescuedKg > b.rescuedKg;
    if (a.order.length !== b.order.length) return a.order.length > b.order.length;
    return a.totalMinutes < b.totalMinutes;
  };
  const consider = (indices) => {
    const order = indices.map((i) => stops[i]);
    const chosen = new Set(indices);
    const sim = simulateOrder(order, ctx);
    sim.skipped = stops.filter((_, i) => !chosen.has(i)).map((s) => s.id);
    if (betterExact(sim, best)) best = sim;
  };

  consider([]);
  const used = new Array(stops.length).fill(false);
  const current = [];
  const permuteLength = (targetLen) => {
    if (current.length === targetLen) {
      consider(current.slice());
      return;
    }
    for (let i = 0; i < stops.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(i);
      permuteLength(targetLen);
      current.pop();
      used[i] = false;
    }
  };
  for (let len = 1; len <= stops.length; len++) permuteLength(len);

  return best || { feasible: false, violations: [{ kind: 'none' }], visits: [], km: 0, rescuedKg: 0, spoiledKg: 0, totalMinutes: 0, order: [], skipped: stops.map((s) => s.id) };
}

// Top-level entry: exact search up to exactMax stops, NN + 2-opt beyond.
export function planRoute(scenario, opts = {}) {
  const ctx = buildContext(scenario, opts);
  const n = ctx.stops.length;
  const exactMax = opts.exactMax ?? DEFAULT_EXACT_MAX;
  if (n === 0) {
    return { feasible: true, violations: [], visits: [], km: 0, totalMinutes: 0, rescuedKg: 0, spoiledKg: 0, strandedKg: 0, order: [], method: 'empty', ctx };
  }
  let plan;
  let method;
  if (n <= exactMax) {
    plan = exactPlan(ctx);
    method = 'exact';
  } else {
    const seed = nearestNeighborPlan(ctx);
    plan = twoOptImprove(seed.order, ctx);
    method = 'nn+2opt';
    if (!plan.feasible && seed.feasible) plan = seed;
  }
  return { ...plan, method, ctx };
}

// Convenience: shortest-path distance of an order (km), depot first.
export function routeDistanceKm(order, depot) {
  let pos = depot;
  let km = 0;
  for (const stop of order) {
    km += haversineKm(pos, stop.ref);
    pos = stop.ref;
  }
  return km;
}
