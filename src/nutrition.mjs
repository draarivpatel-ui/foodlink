// FoodLink nutrition allocator.
// Builds balanced household pantry boxes out of rescued inventory while
// honoring allergen and dietary constraints. USDA MyPlate-style food-group
// balance is the objective; serving targets scale with household size.

import { compareRescuePriority } from './spoilage.mjs';

export const FOOD_GROUPS = Object.freeze(['produce', 'protein', 'grain', 'dairy', 'extras']);

// Map product categories onto food groups used for box balancing.
export const CATEGORY_GROUP = Object.freeze({
  produce: 'produce',
  protein: 'protein',
  dairy: 'dairy',
  bakery: 'grain',
  dry: 'grain',
  prepared: 'extras',
});

export const ALLERGENS = Object.freeze([
  'gluten', 'nuts', 'peanuts', 'dairy', 'egg', 'soy', 'fish', 'shellfish', 'sesame',
]);

// Reference serving caps used by the diabetic (low sugar, lower sodium)
// screening rule. Sodium bound follows the FDA "high in sodium" 20% DV line.
export const DIABETIC_MAX_SUGAR_G = 10;
export const DIABETIC_MAX_SODIUM_MG = 480;

// Default servings per household member per food group in one pantry box.
export const DEFAULT_TARGET_PER_PERSON = Object.freeze({
  produce: 2, protein: 2, grain: 2, dairy: 1, extras: 0,
});

export const CONSTRAINTS = Object.freeze([
  'gluten-free', 'nut-free', 'dairy-free', 'halal', 'diabetic', 'vegetarian',
]);

export function groupOf(lot) {
  const g = CATEGORY_GROUP[lot?.category];
  if (!g) throw new RangeError(`unknown category: ${lot?.category}`);
  return g;
}

function allergenSet(lot) {
  return new Set(lot?.allergens || []);
}

function tagSet(lot) {
  return new Set(lot?.tags || []);
}

export function hasAllergen(lot, allergen) {
  return allergenSet(lot).has(allergen);
}

// True when the lot may be served to a household carrying `constraint`.
export function satisfiesConstraint(lot, constraint) {
  const allergens = allergenSet(lot);
  const tags = tagSet(lot);
  switch (constraint) {
    case 'gluten-free':
      return !allergens.has('gluten');
    case 'nut-free':
      return !allergens.has('nuts') && !allergens.has('peanuts');
    case 'dairy-free':
      return !allergens.has('dairy');
    case 'halal':
      if (tags.has('non-halal')) return false;
      // Animal-derived protein and mixed prepared trays need explicit halal sourcing.
      if (lot?.category === 'protein' || lot?.category === 'prepared') return tags.has('halal');
      return true;
    case 'diabetic':
      return (lot?.sugarG ?? 0) <= DIABETIC_MAX_SUGAR_G
        && (lot?.sodiumMg ?? 0) <= DIABETIC_MAX_SODIUM_MG;
    case 'vegetarian':
      if (tags.has('meat')) return false;
      if (lot?.category === 'protein') return tags.has('plant-protein') || tags.has('vegetarian');
      return true;
    default:
      return true; // unknown constraints do not exclude food
  }
}

// True only when the lot passes every constraint on the household.
export function lotEligibleFor(lot, household) {
  for (const c of household?.constraints || []) {
    if (!satisfiesConstraint(lot, c)) return false;
  }
  return true;
}

// Box target: servings per food group for this household.
export function boxTarget(household, perPerson = DEFAULT_TARGET_PER_PERSON) {
  const size = Math.max(1, household?.size || 1);
  const target = {};
  for (const g of FOOD_GROUPS) target[g] = (perPerson[g] || 0) * size;
  return target;
}

// Greedy balanced allocator. Lots are consumed rescue-first (least life
// remaining first, then largest mass) so the most fragile food moves first.
// Returns boxes keyed by household plus unconsumed leftovers.
export function allocateBoxes(inventory, households, opts = {}) {
  const perPerson = opts.perPerson || DEFAULT_TARGET_PER_PERSON;
  // Working copy with live stock counters.
  const stock = (inventory || [])
    .filter((l) => (l.servings || 0) > 0 && (l.kg || 0) > 0 && !l.spoiled)
    .map((l) => ({ lot: l, servingsLeft: l.servings, kgLeft: l.kg }));
  stock.sort((a, b) => compareRescuePriority(a.lot, b.lot));

  const boxes = [];
  for (const hh of households || []) {
    const target = boxTarget(hh, perPerson);
    const have = Object.fromEntries(FOOD_GROUPS.map((g) => [g, 0]));
    const items = [];
    for (const g of FOOD_GROUPS) {
      let need = target[g] - have[g];
      if (need <= 0) continue;
      for (const s of stock) {
        if (need <= 0) break;
        if (s.servingsLeft <= 0) continue;
        if (groupOf(s.lot) !== g) continue;
        if (!lotEligibleFor(s.lot, hh)) continue;
        const takeServings = Math.min(s.servingsLeft, need);
        const takeKg = s.lot.kg * (takeServings / s.lot.servings);
        s.servingsLeft -= takeServings;
        s.kgLeft -= takeKg;
        have[g] += takeServings;
        need -= takeServings;
        items.push({
          lotId: s.lot.id,
          name: s.lot.name,
          category: s.lot.category,
          group: g,
          servings: takeServings,
          kg: Math.round(takeKg * 1000) / 1000,
        });
      }
    }
    const unmet = FOOD_GROUPS.filter((g) => have[g] < target[g])
      .map((g) => ({ group: g, missing: target[g] - have[g] }));
    boxes.push({ household: hh, items, have, target, unmet });
  }

  const leftovers = stock
    .filter((s) => s.servingsLeft > 0)
    .map((s) => ({ lot: s.lot, servingsLeft: s.servingsLeft, kgLeft: Math.round(s.kgLeft * 1000) / 1000 }));

  const servingsAllocated = boxes.reduce(
    (n, b) => n + b.items.reduce((m, i) => m + i.servings, 0), 0);
  const kgAllocated = boxes.reduce(
    (n, b) => n + b.items.reduce((m, i) => m + i.kg, 0), 0);
  const householdsFullyServed = boxes.filter((b) => b.unmet.length === 0).length;

  return {
    boxes,
    leftovers,
    stats: {
      servingsAllocated,
      kgAllocated: Math.round(kgAllocated * 1000) / 1000,
      householdsFullyServed,
      householdCount: (households || []).length,
    },
  };
}

// Balance score 0..1: mean per-group coverage capped at the target.
export function boxScore(box) {
  if (!box?.target) return 0;
  let acc = 0;
  let counted = 0;
  for (const g of FOOD_GROUPS) {
    const need = box.target[g];
    if (need <= 0) continue;
    counted += 1;
    acc += Math.min(1, (box.have?.[g] || 0) / need);
  }
  return counted === 0 ? 1 : acc / counted;
}

// Nutrient totals for a box's items, resolved against the inventory lots.
export function nutritionTotals(items, lotById) {
  const totals = { servings: 0, kg: 0, proteinG: 0, fiberG: 0, sodiumMg: 0, sugarG: 0 };
  for (const item of items || []) {
    const lot = typeof lotById === 'function' ? lotById(item.lotId) : lotById?.get?.(item.lotId);
    totals.servings += item.servings;
    totals.kg += item.kg;
    if (lot) {
      totals.proteinG += (lot.proteinG || 0) * item.servings;
      totals.fiberG += (lot.fiberG || 0) * item.servings;
      totals.sodiumMg += (lot.sodiumMg || 0) * item.servings;
      totals.sugarG += (lot.sugarG || 0) * item.servings;
    }
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 10) / 10;
  return totals;
}
