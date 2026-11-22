import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_CLASSES, CLASS_KEYS, FDA_COLD_HOLD_C, FDA_HOT_HOLD_C,
  DANGER_ZONE_LIMIT_MIN, URGENCY_TIERS, TIER_THRESHOLDS_H,
  fToC, cToF, q10Rate, arrheniusRate, shelfLifeHours, dangerAccrualPerMin,
  simulateColdChain, urgencyTier, assessLot, dangerFraction,
  compareRescuePriority, isTCS, lotBaseHours, formatHours,
} from '../src/spoilage.mjs';

// ---------- temperature conversion ----------

test('41 F converts to 5 C', () => assert.equal(fToC(41), 5));
test('5 C converts to 41 F', () => assert.equal(cToF(5), 41));
test('135 F converts to about 57.2 C', () => assert.ok(Math.abs(fToC(135) - 57.2) < 0.03));
test('fToC/cToF round-trips at -40', () => assert.ok(Math.abs(cToF(fToC(-40)) - -40) < 1e-9));
test('fToC/cToF round-trips at 98.6', () => assert.ok(Math.abs(cToF(fToC(98.6)) - 98.6) < 1e-9));
test('FDA constants agree: cold hold 5 C is 41 F', () => assert.equal(Math.round(cToF(FDA_COLD_HOLD_C)), 41));
test('FDA constants agree: hot hold 57.2 C is about 135 F', () => assert.ok(Math.abs(cToF(FDA_HOT_HOLD_C) - 135) < 0.3));

// ---------- product class table ----------

test('six product classes are defined', () => assert.equal(CLASS_KEYS.length, 6));
test('every class has positive base hours and q10 > 1', () => {
  for (const c of Object.values(PRODUCT_CLASSES)) {
    assert.ok(c.baseHours > 0, 'baseHours');
    assert.ok(c.q10 > 1, 'q10');
    assert.equal(typeof c.tcs, 'boolean');
  }
});
test('TCS classes are protein, dairy and prepared', () => {
  assert.deepEqual(CLASS_KEYS.filter((k) => PRODUCT_CLASSES[k].tcs), ['protein', 'dairy', 'prepared']);
});
test('non-TCS classes are produce, bakery and dry', () => {
  assert.deepEqual(CLASS_KEYS.filter((k) => !PRODUCT_CLASSES[k].tcs), ['produce', 'bakery', 'dry']);
});

// ---------- q10 model ----------

for (const [key, cls] of Object.entries(PRODUCT_CLASSES)) {
  test(`q10Rate is exactly 1 at ${FDA_COLD_HOLD_C} C for ${key}`, () => {
    assert.ok(Math.abs(q10Rate(FDA_COLD_HOLD_C, cls.q10) - 1) < 1e-12);
  });
  test(`q10Rate at +10 C equals the class q10 for ${key}`, () => {
    assert.ok(Math.abs(q10Rate(FDA_COLD_HOLD_C + 10, cls.q10) - cls.q10) < 1e-9);
  });
  test(`q10Rate at -10 C equals 1/q10 for ${key}`, () => {
    assert.ok(Math.abs(q10Rate(FDA_COLD_HOLD_C - 10, cls.q10) - 1 / cls.q10) < 1e-9);
  });
}

for (const [key, cls] of Object.entries(PRODUCT_CLASSES)) {
  for (const T of [10, 15, 20, 25, 30, 35, 40]) {
    test(`q10Rate(${T} C) exceeds rate at cold holding for ${key}`, () => {
      assert.ok(q10Rate(T, cls.q10) > q10Rate(FDA_COLD_HOLD_C, cls.q10));
    });
  }
  for (const T of [-10, -5, 0]) {
    test(`q10Rate(${T} C) is slower than cold holding for ${key}`, () => {
      assert.ok(q10Rate(T, cls.q10) < q10Rate(FDA_COLD_HOLD_C, cls.q10));
    });
  }
  test(`q10Rate is strictly increasing across -10..40 C for ${key}`, () => {
    let prev = -1;
    for (let T = -10; T <= 40; T += 2.5) {
      const r = q10Rate(T, cls.q10);
      assert.ok(r > prev, `not increasing at ${T}`);
      prev = r;
    }
  });
}

test('q10Rate throws on non-finite temperature', () => assert.throws(() => q10Rate(NaN, 2)));
test('q10Rate throws on zero q10', () => assert.throws(() => q10Rate(20, 0)));
test('q10Rate throws on negative q10', () => assert.throws(() => q10Rate(20, -2)));

// ---------- Arrhenius reference model ----------

test('arrheniusRate is 1 at reference temperature', () => assert.ok(Math.abs(arrheniusRate(5) - 1) < 1e-9));
test('arrheniusRate exceeds 1 at 25 C', () => assert.ok(arrheniusRate(25) > 1));
test('arrheniusRate is below 1 at 0 C', () => assert.ok(arrheniusRate(0) < 1));
test('arrheniusRate is strictly increasing over -10..40 C', () => {
  let prev = -1;
  for (let T = -10; T <= 40; T += 5) {
    const r = arrheniusRate(T);
    assert.ok(r > prev);
    prev = r;
  }
});
test('arrheniusRate with higher activation energy reacts harder', () => {
  assert.ok(arrheniusRate(25, 80_000) > arrheniusRate(25, 40_000));
});
test('arrheniusRate throws on NaN', () => assert.throws(() => arrheniusRate(NaN)));

// ---------- shelf life ----------

for (const [key, cls] of Object.entries(PRODUCT_CLASSES)) {
  test(`shelfLifeHours at cold holding equals base hours for ${key}`, () => {
    assert.ok(Math.abs(shelfLifeHours(key, FDA_COLD_HOLD_C) - cls.baseHours) < 1e-9);
  });
  test(`shelfLifeHours at 20 C is shorter than at 5 C for ${key}`, () => {
    assert.ok(shelfLifeHours(key, 20) < shelfLifeHours(key, 5));
  });
  test(`shelfLifeHours at 0 C is longer than at 5 C for ${key}`, () => {
    assert.ok(shelfLifeHours(key, 0) > shelfLifeHours(key, 5));
  });
  test(`shelfLifeHours halves under a +10/q10 relationship for ${key}`, () => {
    const ratio = shelfLifeHours(key, 5) / shelfLifeHours(key, 15);
    assert.ok(Math.abs(ratio - cls.q10) < 1e-9);
  });
}

test('shelfLifeHours honors a lot-level freshHours override', () => {
  const lot = { category: 'produce', kg: 1, servings: 1, freshHours: 10 };
  assert.ok(Math.abs(shelfLifeHours(lot, 5) - 10) < 1e-9);
});
test('shelfLifeHours throws on a bad category', () => assert.throws(() => shelfLifeHours('air', 5)));

// ---------- danger-zone accrual ----------

for (const T of [-10, 0, 4.9, 5]) {
  test(`no danger accrual at ${T} C (at or below cold holding)`, () => {
    assert.equal(dangerAccrualPerMin(T), 0);
  });
}
for (const T of [5.01, 10, 20, 35, 45, 56.9]) {
  test(`1:1 danger accrual at ${T} C (inside zone)`, () => {
    assert.equal(dangerAccrualPerMin(T), 1);
  });
}
for (const T of [57.2, 58, 60, 100]) {
  test(`no danger accrual at ${T} C (at or above hot holding)`, () => {
    assert.equal(dangerAccrualPerMin(T), 0);
  });
}
test('dangerAccrualPerMin throws on NaN', () => assert.throws(() => dangerAccrualPerMin(NaN)));

// ---------- cold-chain simulation ----------

test('fresh lot loses no life with zero elapsed minutes', () => {
  const lot = { id: 'a', category: 'dairy', kg: 1, servings: 1, freshHours: 100 };
  const sim = simulateColdChain(lot, [{ tempC: 30, minutes: 0 }]);
  assert.equal(sim.lifeLeftHours, 100);
  assert.equal(sim.spoiled, false);
});

test('life left shrinks linearly with minutes at fixed temp', () => {
  const lot = { id: 'a', category: 'produce', kg: 1, servings: 1, freshHours: 120 };
  const s60 = simulateColdChain(lot, [{ tempC: 20, minutes: 60 }]);
  const s120 = simulateColdChain(lot, [{ tempC: 20, minutes: 120 }]);
  const consumed60 = 120 - s60.lifeLeftHours;
  const consumed120 = 120 - s120.lifeLeftHours;
  assert.ok(Math.abs(consumed120 - 2 * consumed60) < 1e-9);
});

test('two half-segments equal one full segment', () => {
  const lot = { id: 'a', category: 'produce', kg: 1, servings: 1, freshHours: 120 };
  const one = simulateColdChain(lot, [{ tempC: 22, minutes: 120 }]);
  const two = simulateColdChain(lot, [{ tempC: 22, minutes: 60 }, { tempC: 22, minutes: 60 }]);
  assert.ok(Math.abs(one.lifeLeftHours - two.lifeLeftHours) < 1e-9);
});

test('split hot then cold profile beats all-hot profile', () => {
  const lot = { id: 'a', category: 'dairy', kg: 1, servings: 1, freshHours: 200 };
  const mixed = simulateColdChain(lot, [{ tempC: 25, minutes: 60 }, { tempC: 4, minutes: 60 }]);
  const hot = simulateColdChain(lot, [{ tempC: 25, minutes: 120 }]);
  assert.ok(mixed.lifeLeftHours > hot.lifeLeftHours);
});

for (const cls of ['protein', 'dairy', 'prepared']) {
  test(`${cls} spoils through the 4-hour danger-zone budget at 25 C`, () => {
    const lot = { id: 'x', category: cls, kg: 2, servings: 4, freshHours: 500 };
    const sim = simulateColdChain(lot, [{ tempC: 25, minutes: DANGER_ZONE_LIMIT_MIN }]);
    assert.equal(sim.spoiled, true);
    assert.equal(sim.cause, 'danger-zone');
    assert.equal(sim.dangerMinutes, 240);
  });
  test(`${cls} survives 239 danger-zone minutes`, () => {
    const lot = { id: 'x', category: cls, kg: 2, servings: 4, freshHours: 500 };
    const sim = simulateColdChain(lot, [{ tempC: 25, minutes: 239 }]);
    assert.equal(sim.spoiled, false);
    assert.equal(sim.dangerMinutes, 239);
  });
}

for (const cls of ['produce', 'bakery', 'dry']) {
  test(`non-TCS ${cls} never trips the danger-zone rule`, () => {
    const lot = { id: 'x', category: cls, kg: 2, servings: 4, freshHours: 10000 };
    const sim = simulateColdChain(lot, [{ tempC: 25, minutes: 500 }]);
    assert.equal(sim.dangerMinutes, 0);
    assert.equal(sim.cause, null);
  });
}

test('a lot spoils by age when life runs out', () => {
  const lot = { id: 'x', category: 'bakery', kg: 1, servings: 2, freshHours: 4 };
  const sim = simulateColdChain(lot, [{ tempC: 20, minutes: 600 }]);
  assert.equal(sim.spoiled, true);
  assert.equal(sim.cause, 'age');
  assert.equal(sim.lifeLeftHours, 0);
});

test('age spoilage beats danger zone when both apply for non-TCS', () => {
  const lot = { id: 'x', category: 'produce', kg: 1, servings: 2, freshHours: 1 };
  const sim = simulateColdChain(lot, [{ tempC: 40, minutes: 400 }]);
  assert.equal(sim.spoiled, true);
  assert.equal(sim.cause, 'age');
});

test('danger-zone cause wins for TCS when 240 min hits first', () => {
  const lot = { id: 'x', category: 'protein', kg: 1, servings: 2, freshHours: 200 };
  const sim = simulateColdChain(lot, [{ tempC: 40, minutes: 400 }]);
  assert.equal(sim.spoiled, true);
  assert.equal(sim.cause, 'danger-zone');
});

test('isTCS respects a lot-level override', () => {
  assert.equal(isTCS({ category: 'produce', tcs: true }), true);
  assert.equal(isTCS({ category: 'protein', tcs: false }), false);
});

test('isTCS falls back to the class flag', () => {
  assert.equal(isTCS({ category: 'protein' }), true);
  assert.equal(isTCS({ category: 'dry' }), false);
});

test('lotBaseHours clamps negative overrides at zero', () => {
  assert.equal(lotBaseHours({ category: 'dairy', freshHours: -5 }), 0);
});

test('simulateColdChain rejects a NaN profile temperature', () => {
  assert.throws(() => simulateColdChain({ category: 'dry', kg: 1, servings: 1 }, [{ tempC: NaN, minutes: 5 }]));
});

test('simulateColdChain tolerates missing minutes as zero', () => {
  const sim = simulateColdChain({ category: 'dry', kg: 1, servings: 1, freshHours: 9 }, [{ tempC: 30 }]);
  assert.equal(sim.lifeLeftHours, 9);
});

// ---------- urgency tiers ----------

test('urgencyTier maps 0-7.9 h to critical', () => {
  for (const h of [0, 1, 7.9]) assert.equal(urgencyTier(h), 'critical');
});
test('urgencyTier maps 8-23.9 h to high', () => {
  for (const h of [8, 12, 23.9]) assert.equal(urgencyTier(h), 'high');
});
test('urgencyTier maps 24-71.9 h to watch', () => {
  for (const h of [24, 48, 71.9]) assert.equal(urgencyTier(h), 'watch');
});
test('urgencyTier maps 72 h and up to stable', () => {
  for (const h of [72, 200, 10000]) assert.equal(urgencyTier(h), 'stable');
});
test('urgencyTier thresholds are strictly increasing', () => {
  assert.ok(TIER_THRESHOLDS_H.critical < TIER_THRESHOLDS_H.high);
  assert.ok(TIER_THRESHOLDS_H.high < TIER_THRESHOLDS_H.watch);
});
test('urgencyTier throws on NaN', () => assert.throws(() => urgencyTier(NaN)));
test('four urgency tiers exist', () => assert.equal(URGENCY_TIERS.length, 4));

// ---------- assessLot ----------

test('assessLot marks a dead lot spoiled with tier spoiled', () => {
  const lot = { id: 'x', category: 'produce', kg: 1, servings: 1, freshHours: 1 };
  const a = assessLot(lot, 35, 600);
  assert.equal(a.spoiled, true);
  assert.equal(a.tier, 'spoiled');
});
test('assessLot returns tier and tcs for a healthy lot', () => {
  const a = assessLot({ category: 'dry', kg: 1, servings: 1 }, 20, 30);
  assert.equal(a.tier, 'stable');
  assert.equal(a.tcs, false);
});
test('assessLot honors an explicit lot profile over ambient', () => {
  const lot = { category: 'dairy', kg: 1, servings: 1, freshHours: 100, profile: [{ tempC: 5, minutes: 120 }] };
  const a = assessLot(lot, 40, 120);
  assert.ok(Math.abs(a.lifeLeftHours - (100 - 2)) < 1e-9);
});
test('assessLot accumulates danger only for TCS', () => {
  const tcs = assessLot({ category: 'protein', kg: 1, servings: 1, freshHours: 500 }, 25, 100);
  const non = assessLot({ category: 'produce', kg: 1, servings: 1, freshHours: 500 }, 25, 100);
  assert.equal(tcs.dangerMinutes, 100);
  assert.equal(non.dangerMinutes, 0);
});

// ---------- dangerFraction / priority / formatting ----------

test('dangerFraction is zero for non-TCS lots', () => {
  assert.equal(dangerFraction({ category: 'produce' }, 200), 0);
});
test('dangerFraction scales TCS danger minutes', () => {
  assert.equal(dangerFraction({ category: 'dairy' }, 120), 0.5);
});
test('dangerFraction clamps at 1', () => {
  assert.equal(dangerFraction({ category: 'dairy' }, 9999), 1);
});
test('dangerFraction clamps negatives at 0', () => {
  assert.equal(dangerFraction({ category: 'dairy' }, -10), 0);
});

test('compareRescuePriority orders least life first', () => {
  const a = { lifeLeftHours: 2, kg: 1 };
  const b = { lifeLeftHours: 50, kg: 1 };
  assert.ok(compareRescuePriority(a, b) < 0);
});
test('compareRescuePriority breaks ties by bigger kg first', () => {
  const a = { lifeLeftHours: 10, kg: 20 };
  const b = { lifeLeftHours: 10, kg: 2 };
  assert.ok(compareRescuePriority(a, b) < 0);
});
test('compareRescuePriority treats missing life as infinity', () => {
  assert.ok(compareRescuePriority({ kg: 1 }, { lifeLeftHours: 50, kg: 1 }) > 0);
});

test('formatHours renders sub-48h durations in hours', () => assert.equal(formatHours(5.25), '5.3 h'));
test('formatHours renders long durations in days and hours', () => assert.equal(formatHours(100), '4 d 4 h'));
test('formatHours renders NaN as a dash', () => assert.equal(formatHours(NaN), '-'));
test('formatHours renders exactly 48 h in days', () => assert.equal(formatHours(48), '2 d 0 h'));
