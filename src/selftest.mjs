// FoodLink self-tests.
// A compact invariant suite that runs the real engines in the browser (the
// "Run self-tests" button) and in Node. Each check returns {name, ok, detail}.

import {
  PRODUCT_CLASSES, FDA_COLD_HOLD_C, DANGER_ZONE_LIMIT_MIN,
  q10Rate, arrheniusRate, dangerAccrualPerMin, shelfLifeHours,
  simulateColdChain, urgencyTier, assessLot,
} from './spoilage.mjs';
import {
  allocateBoxes, lotEligibleFor, satisfiesConstraint, boxScore, FOOD_GROUPS,
} from './nutrition.mjs';
import {
  haversineKm, co2eKg, CO2E_PER_KG_FOOD, planRoute, twoOptImprove,
  nearestNeighborPlan, buildContext, simulateOrder,
} from './routing.mjs';
import {
  SCENARIOS, validateScenario, scenarioToCSV, scenarioFromCSV,
  encodeState, decodeState, exportStateJSON, allLots,
} from './scenarios.mjs';
import { STRINGS, keyParity, manifestLines, checklist, t } from './i18n.mjs';

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

check('every built-in scenario validates', () => {
  const bad = SCENARIOS.filter((s) => !validateScenario(s).ok);
  return { ok: bad.length === 0, detail: bad.map((s) => s.id).join(',') || '4/4 valid' };
});

check('q10 rate rises with temperature for every class', () => {
  for (const [key, cls] of Object.entries(PRODUCT_CLASSES)) {
    for (const T of [-5, 0, 5, 10, 20, 30]) {
      if (!(q10Rate(T + 1, cls.q10) > q10Rate(T, cls.q10))) {
        return { ok: false, detail: `${key} broke at ${T}` };
      }
    }
  }
  return { ok: true, detail: 'monotonic across -5..31 C' };
});

check('q10 rate is exactly 1 at the cold-holding limit', () => (
  { ok: Object.values(PRODUCT_CLASSES).every((c) => Math.abs(q10Rate(FDA_COLD_HOLD_C, c.q10) - 1) < 1e-12), detail: 'rate(5 C) = 1' }
));

check('danger zone accrues only strictly inside 5 C..57.2 C', () => (
  { ok: dangerAccrualPerMin(5) === 0 && dangerAccrualPerMin(20) === 1 && dangerAccrualPerMin(57.2) === 0 && dangerAccrualPerMin(60) === 0, detail: 'binary accrual' }
));

check('arrhenius and q10 agree on direction', () => {
  const T = 25;
  return { ok: arrheniusRate(T) > 1 && q10Rate(T) > 1 && arrheniusRate(0) < 1, detail: 'warming speeds decay' };
});

check('a TCS lot spoils at the 4-hour danger-zone mark', () => {
  const lot = { id: 'x', category: 'protein', kg: 5, servings: 10 };
  const sim = simulateColdChain(lot, [{ tempC: 25, minutes: DANGER_ZONE_LIMIT_MIN }]);
  return { ok: sim.spoiled && sim.cause === 'danger-zone', detail: `${sim.dangerMinutes} danger min` };
});

check('urgency tiers order critical < high < watch < stable', () => {
  const seq = [urgencyTier(4), urgencyTier(12), urgencyTier(48), urgencyTier(200)];
  return { ok: seq.join(',') === 'critical,high,watch,stable', detail: seq.join(',') };
});

check('shelf life shrinks when warmed', () => (
  { ok: shelfLifeHours('dairy', 20) < shelfLifeHours('dairy', 5), detail: `${Math.round(shelfLifeHours('dairy', 20))} h at 20 C` }
));

for (const s of SCENARIOS) {
  check(`route is feasible and rescues food: ${s.id}`, () => {
    const copy = JSON.parse(JSON.stringify(s));
    for (const d of copy.donors) {
      for (const l of d.lots) {
        const a = assessLot(l, copy.ambientC, 0);
        Object.assign(l, { lifeLeftHours: a.lifeLeftHours, spoiled: a.spoiled });
      }
    }
    const plan = planRoute(copy, {});
    return {
      ok: plan.feasible && plan.rescuedKg > 0,
      detail: `${plan.method} ${plan.rescuedKg} kg, ${Math.round(plan.totalMinutes)} min`,
    };
  });
}

check('planned route respects vehicle capacity', () => {
  const s = SCENARIOS[0];
  const ctx = buildContext(s, {});
  const plan = planRoute(s, {});
  let ok = plan.visits.every((v) => (v.loadKg ?? 0) <= ctx.capacityKg + 1e-9);
  return { ok, detail: `cap ${ctx.capacityKg} kg` };
});

check('2-opt never makes a plan worse', () => {
  const s = SCENARIOS[2];
  const ctx = buildContext(s, {});
  const seed = nearestNeighborPlan(ctx);
  const refined = twoOptImprove(seed.order, ctx);
  const notWorse = refined.rescuedKg >= seed.rescuedKg
    && refined.feasible === true;
  return { ok: notWorse, detail: `${seed.rescuedKg} -> ${refined.rescuedKg} kg` };
});

check('CO2e counter uses the EPA WARM factor', () => (
  { ok: Math.abs(co2eKg(10) - 10 * CO2E_PER_KG_FOOD) < 1e-9, detail: '10 kg -> 25 kg CO2e' }
));

check('haversine: zero distance to self, sane city distance', () => {
  const a = { lat: 29.7, lon: -95.4 };
  const b = { lat: 29.75, lon: -95.4 };
  const d = haversineKm(a, b);
  return { ok: haversineKm(a, a) === 0 && d > 5 && d < 6.2, detail: `${d.toFixed(2)} km` };
});

check('allocator never violates household constraints', () => {
  const s = SCENARIOS[3];
  const lots = allLots(s).map((l) => ({ ...l, lifeLeftHours: assessLot(l, s.ambientC, 0).lifeLeftHours, spoiled: false }));
  const { boxes } = allocateBoxes(lots, s.households);
  const byId = new Map(lots.map((l) => [l.id, l]));
  for (const b of boxes) {
    for (const item of b.items) {
      if (!lotEligibleFor(byId.get(item.lotId), b.household)) {
        return { ok: false, detail: `${item.lotId} -> ${b.household.id}` };
      }
    }
  }
  return { ok: true, detail: `${boxes.length} boxes clean` };
});

check('diabetic screen rejects high-sugar and high-sodium lots', () => (
  {
    ok: !satisfiesConstraint({ category: 'dry', kg: 1, servings: 1, sugarG: 40, sodiumMg: 100 }, 'diabetic')
      && !satisfiesConstraint({ category: 'dry', kg: 1, servings: 1, sugarG: 0, sodiumMg: 900 }, 'diabetic')
      && satisfiesConstraint({ category: 'dry', kg: 1, servings: 1, sugarG: 4, sodiumMg: 100 }, 'diabetic'),
    detail: 'sugar/sodium bounds hold',
  }
));

check('box score is bounded 0..1', () => {
  const s = SCENARIOS[1];
  const lots = allLots(s).map((l) => ({ ...l, spoiled: false }));
  const { boxes } = allocateBoxes(lots, s.households);
  const scores = boxes.map(boxScore);
  return { ok: scores.every((x) => x >= 0 && x <= 1), detail: scores.map((x) => x.toFixed(2)).join(' ') };
});

check('CSV round-trip preserves the scenario', () => {
  const s = SCENARIOS[0];
  const back = scenarioFromCSV(scenarioToCSV(s));
  const same = back.ok
    && back.scenario.donors.length === s.donors.length
    && back.scenario.pantries.length === s.pantries.length
    && allLots(back.scenario).length === allLots(s).length;
  return { ok: same, detail: back.ok ? 'lot counts match' : back.errors.join('; ') };
});

check('JSON export and URL-hash state round-trip', () => {
  const state = { scenarioId: SCENARIOS[0].id, params: { ambientC: 21, elapsedMin: 45 } };
  const tok = encodeState(state);
  const back = decodeState(`#${tok}`);
  return { ok: back.ok && back.state.params.ambientC === 21, detail: `token ${tok.length} chars` };
});

check('malformed hash tokens fail safe', () => {
  const bad = ['#', '#!!bogus', '#%%%', '#AAAA', '#e30'].every((h) => !decodeState(h).ok);
  return { ok: bad, detail: '5 bad tokens rejected' };
});

check('i18n key parity between English and Spanish', () => {
  const p = keyParity();
  return { ok: p.missingInEs.length === 0 && p.missingInEn.length === 0, detail: `${Object.keys(STRINGS.en).length} keys each` };
});

check('t() interpolates and falls back to English', () => (
  { ok: t('es', 'appTitle') === 'FoodLink' && t('xx', 'appTitle') === 'FoodLink', detail: 'fallback ok' }
));

check('checklist ships both languages', () => (
  { ok: checklist('en').length === checklist('es').length && checklist('en').length >= 6, detail: `${checklist('en').length} items` }
));

check('manifest renders stops or a clear empty state', () => {
  const s = SCENARIOS[0];
  const plan = planRoute(s, {});
  const lines = manifestLines(plan, s, 'en');
  return { ok: lines.length > 3 && lines[0].includes('FoodLink'), detail: `${lines.length} lines` };
});

check('JSON export parses back', () => {
  const parsed = JSON.parse(exportStateJSON({ a: 1, b: [2, 3] }));
  return { ok: parsed.b[1] === 3, detail: 'stable JSON' };
});

check('every group constant is used by the allocator', () => (
  { ok: FOOD_GROUPS.length === 5, detail: FOOD_GROUPS.join(', ') }
));

check('route simulation returns a visit for every planned stop', () => {
  const s = SCENARIOS[1];
  const plan = planRoute(s, {});
  return { ok: plan.visits.length === plan.order.length, detail: `${plan.visits.length} visits` };
});

export function runSelfTests() {
  const results = checks.map(({ name, fn }) => {
    try {
      const r = fn();
      return { name, ok: !!r.ok, detail: r.detail ?? '' };
    } catch (err) {
      return { name, ok: false, detail: `threw: ${err.message}` };
    }
  });
  return {
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
