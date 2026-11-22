// FoodLink spoilage engine.
// Thermal shelf-life and cold-chain decay math anchored on FDA Food Code
// cold-holding limits, a Q10 temperature model and an Arrhenius reference
// model. All functions are pure and work identically in Node and browsers.

export const FDA_COLD_HOLD_C = 5; // 41 F: maximum cold-holding temperature
export const FDA_COLD_HOLD_F = 41;
export const FDA_HOT_HOLD_C = 57.2; // 135 F: minimum hot-holding temperature
export const DANGER_ZONE_LIMIT_MIN = 240; // FDA 4-hour cumulative TCS rule
export const GAS_CONSTANT_J = 8.314;

// Product classes. baseHours is shelf life remaining when held at or below
// the FDA cold-holding limit, counted from when the lot enters the system.
// q10 is the spoilage-rate multiplier per +10 C. tcs marks "time/temperature
// control for safety" foods that fall under the 4-hour danger-zone rule.
export const PRODUCT_CLASSES = Object.freeze({
  protein:  { label: 'Protein',        baseHours: 72,   q10: 3.0, tcs: true  },
  dairy:    { label: 'Dairy',          baseHours: 240,  q10: 2.5, tcs: true  },
  prepared: { label: 'Prepared meals', baseHours: 168,  q10: 3.0, tcs: true  },
  produce:  { label: 'Produce',        baseHours: 120,  q10: 2.2, tcs: false },
  bakery:   { label: 'Bakery',         baseHours: 96,   q10: 1.8, tcs: false },
  dry:      { label: 'Dry goods',      baseHours: 4320, q10: 1.5, tcs: false },
});
export const CLASS_KEYS = Object.freeze(Object.keys(PRODUCT_CLASSES));

export const URGENCY_TIERS = Object.freeze(['critical', 'high', 'watch', 'stable']);
// Hours of shelf life remaining (at the reference temperature) below which a
// lot falls into each tier. Ordered from tightest to loosest.
export const TIER_THRESHOLDS_H = Object.freeze({ critical: 8, high: 24, watch: 72 });

export function fToC(f) { return (f - 32) * (5 / 9); }
export function cToF(c) { return c * (9 / 5) + 32; }

function kelvin(c) { return c + 273.15; }

// Spoilage rate multiplier relative to the reference temperature.
// rate(refC) === 1; rate doubles/triples per 10 C according to q10.
export function q10Rate(tempC, q10 = 2, refC = FDA_COLD_HOLD_C) {
  if (!Number.isFinite(tempC) || !Number.isFinite(q10) || q10 <= 0) {
    throw new RangeError('q10Rate needs a finite temperature and q10 > 0');
  }
  return Math.pow(q10, (tempC - refC) / 10);
}

// Arrhenius rate multiplier relative to refC for activation energy eaJ.
export function arrheniusRate(tempC, eaJ = 50_000, refC = FDA_COLD_HOLD_C) {
  if (!Number.isFinite(tempC) || !Number.isFinite(eaJ) || eaJ <= 0) {
    throw new RangeError('arrheniusRate needs finite inputs and eaJ > 0');
  }
  return Math.exp((eaJ / GAS_CONSTANT_J) * (1 / kelvin(refC) - 1 / kelvin(tempC)));
}

export function classOf(lot) {
  const cls = PRODUCT_CLASSES[lot?.category];
  if (!cls) throw new RangeError(`unknown product category: ${lot?.category}`);
  return cls;
}

export function isTCS(lot) {
  if (typeof lot?.tcs === 'boolean') return lot.tcs;
  return classOf(lot).tcs;
}

// Shelf life remaining at scenario start, expressed in reference-temperature
// hours. A lot may carry its own freshHours override.
export function lotBaseHours(lot) {
  const base = Number.isFinite(lot?.freshHours) ? lot.freshHours : classOf(lot).baseHours;
  return Math.max(0, base);
}

// Whole-life shelf duration if held continuously at tempC.
export function shelfLifeHours(categoryOrLot, tempC) {
  const cls = typeof categoryOrLot === 'string'
    ? PRODUCT_CLASSES[categoryOrLot]
    : classOf(categoryOrLot);
  if (!cls) throw new RangeError(`unknown product category: ${categoryOrLot}`);
  const base = typeof categoryOrLot === 'string' ? cls.baseHours : lotBaseHours(categoryOrLot);
  return base / q10Rate(tempC, cls.q10);
}

// Danger-zone accrual: minutes of FDA danger-zone exposure gained per real
// minute held at tempC. Strictly inside the zone the accrual is 1:1; at or
// below cold holding, and at or above hot holding, it is zero.
export function dangerAccrualPerMin(tempC) {
  if (!Number.isFinite(tempC)) throw new RangeError('temperature must be finite');
  if (tempC <= FDA_COLD_HOLD_C) return 0;
  if (tempC >= FDA_HOT_HOLD_C) return 0;
  return 1;
}

// Advance a lot through a temperature profile.
// profile: [{ tempC, minutes }]. Returns remaining life, accumulated
// danger-zone minutes, spoilage flag and cause.
export function simulateColdChain(lot, profile) {
  const cls = classOf(lot);
  const tcs = isTCS(lot);
  let lifeLeft = lotBaseHours(lot);
  let dangerMinutes = 0;
  for (const seg of profile || []) {
    const minutes = Math.max(0, Number(seg.minutes) || 0);
    const tempC = Number(seg.tempC);
    if (!Number.isFinite(tempC)) throw new RangeError('profile segment needs a finite tempC');
    lifeLeft -= (minutes / 60) * q10Rate(tempC, cls.q10);
    if (tcs) dangerMinutes += dangerAccrualPerMin(tempC) * minutes;
    if (lifeLeft <= 0) break;
    if (tcs && dangerMinutes >= DANGER_ZONE_LIMIT_MIN) break;
  }
  const spoiled = lifeLeft <= 0 || (tcs && dangerMinutes >= DANGER_ZONE_LIMIT_MIN);
  const cause = spoiled
    ? (tcs && dangerMinutes >= DANGER_ZONE_LIMIT_MIN ? 'danger-zone' : 'age')
    : null;
  return {
    lifeLeftHours: Math.max(0, lifeLeft),
    dangerMinutes,
    spoiled,
    cause,
  };
}

// Urgency tier from reference-temperature hours of life remaining.
export function urgencyTier(lifeLeftHours) {
  if (!Number.isFinite(lifeLeftHours)) throw new RangeError('lifeLeftHours must be finite');
  if (lifeLeftHours < TIER_THRESHOLDS_H.critical) return 'critical';
  if (lifeLeftHours < TIER_THRESHOLDS_H.high) return 'high';
  if (lifeLeftHours < TIER_THRESHOLDS_H.watch) return 'watch';
  return 'stable';
}

// Assess a lot after elapsedMin held at ambientC (or through an explicit
// profile of segments). Returns everything the UI and allocator need.
export function assessLot(lot, ambientC, elapsedMin = 0) {
  const profile = Array.isArray(lot?.profile)
    ? lot.profile
    : [{ tempC: ambientC, minutes: elapsedMin }];
  const sim = simulateColdChain(lot, profile);
  return {
    ...sim,
    tier: sim.spoiled ? 'spoiled' : urgencyTier(sim.lifeLeftHours),
    tcs: isTCS(lot),
  };
}

// Fraction of danger-zone budget consumed, 0..1. Non-TCS lots always 0.
export function dangerFraction(lot, dangerMinutes) {
  if (!isTCS(lot)) return 0;
  return Math.min(1, Math.max(0, dangerMinutes / DANGER_ZONE_LIMIT_MIN));
}

// Rescue priority sort key: lots with less life left come first, ties broken
// by larger mass (more food rescued per stop).
export function compareRescuePriority(a, b) {
  const la = a.lifeLeftHours ?? Number.POSITIVE_INFINITY;
  const lb = b.lifeLeftHours ?? Number.POSITIVE_INFINITY;
  if (la !== lb) return la - lb;
  return (b.kg || 0) - (a.kg || 0);
}

export function formatHours(h) {
  if (!Number.isFinite(h)) return '-';
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return `${d} d ${rem} h`;
}
