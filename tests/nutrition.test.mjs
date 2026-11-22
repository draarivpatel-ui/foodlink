import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOD_GROUPS, CATEGORY_GROUP, ALLERGENS, CONSTRAINTS,
  DEFAULT_TARGET_PER_PERSON, DIABETIC_MAX_SODIUM_MG, DIABETIC_MAX_SUGAR_G,
  groupOf, hasAllergen, satisfiesConstraint, lotEligibleFor, boxTarget,
  allocateBoxes, boxScore, nutritionTotals,
} from '../src/nutrition.mjs';
import { SCENARIOS, allLots } from '../src/scenarios.mjs';
import { assessLot } from '../src/spoilage.mjs';

const mk = (over = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  name: 'fixture', category: 'produce', kg: 5, servings: 10,
  allergens: [], tags: [], proteinG: 0, fiberG: 0, sodiumMg: 0, sugarG: 0,
  ...over,
});

// ---------- group mapping ----------

test('six categories map onto five food groups', () => {
  for (const [cat, g] of Object.entries(CATEGORY_GROUP)) {
    assert.ok(FOOD_GROUPS.includes(g), `${cat} -> ${g}`);
  }
});
for (const [cat, g] of Object.entries(CATEGORY_GROUP)) {
  test(`groupOf(${cat}) is ${g}`, () => assert.equal(groupOf({ category: cat }), g));
}
test('groupOf throws on an unknown category', () => assert.throws(() => groupOf({ category: 'air' })));

// ---------- allergen helpers ----------

test('hasAllergen true when listed', () => assert.ok(hasAllergen(mk({ allergens: ['nuts'] }), 'nuts')));
test('hasAllergen false when absent', () => assert.ok(!hasAllergen(mk({ allergens: ['egg'] }), 'nuts')));
test('hasAllergen false for empty allergens', () => assert.ok(!hasAllergen(mk(), 'gluten')));

// ---------- constraint satisfaction fixtures ----------

const fixtures = {
  plainProduce: mk({ category: 'produce' }),
  wheatBread: mk({ category: 'bakery', allergens: ['gluten'] }),
  peanutButter: mk({ category: 'protein', allergens: ['peanuts'], tags: ['plant-protein'] }),
  almondMilk: mk({ category: 'dairy', allergens: ['nuts'], tags: ['vegetarian'] }),
  yogurtCup: mk({ category: 'dairy', allergens: ['dairy'] }),
  halalChicken: mk({ category: 'protein', tags: ['halal'] }),
  porkCuts: mk({ category: 'protein', tags: ['non-halal'] }),
  beefStew: mk({ category: 'prepared', tags: ['meat', 'halal'] }),
  sugaryCans: mk({ category: 'dry', sugarG: 40 }),
  saltySoup: mk({ category: 'prepared', sodiumMg: 900, tags: ['vegetarian'] }),
  cleanDry: mk({ category: 'dry', sugarG: 2, sodiumMg: 50 }),
  eggNoodles: mk({ category: 'bakery', allergens: ['gluten', 'egg'] }),
  tofu: mk({ category: 'protein', tags: ['plant-protein', 'vegetarian', 'halal'], allergens: ['soy'] }),
};

const constraintCases = [
  // [constraint, lotFixtureKey, expected]
  ['gluten-free', 'plainProduce', true],
  ['gluten-free', 'wheatBread', false],
  ['gluten-free', 'eggNoodles', false],
  ['gluten-free', 'cleanDry', true],
  ['nut-free', 'plainProduce', true],
  ['nut-free', 'peanutButter', false],
  ['nut-free', 'almondMilk', false],
  ['nut-free', 'cleanDry', true],
  ['dairy-free', 'yogurtCup', false],
  ['dairy-free', 'almondMilk', true],
  ['dairy-free', 'halalChicken', true],
  ['dairy-free', 'wheatBread', true],
  ['dairy-free', 'cleanDry', true],
  ['halal', 'halalChicken', true],
  ['halal', 'porkCuts', false],
  ['halal', 'beefStew', true],
  ['halal', 'plainProduce', true],
  ['halal', 'peanutButter', false],
  ['halal', 'tofu', true],
  ['diabetic', 'sugaryCans', false],
  ['diabetic', 'saltySoup', false],
  ['diabetic', 'cleanDry', true],
  ['diabetic', 'plainProduce', true],
  ['vegetarian', 'halalChicken', false],
  ['vegetarian', 'beefStew', false],
  ['vegetarian', 'porkCuts', false],
  ['vegetarian', 'tofu', true],
  ['vegetarian', 'peanutButter', true],
  ['vegetarian', 'plainProduce', true],
];

for (const [c, fx, expected] of constraintCases) {
  test(`${c} on ${fx} -> ${expected}`, () => {
    assert.equal(satisfiesConstraint(fixtures[fx], c), expected);
  });
}

test('unknown constraint never excludes a lot', () => {
  assert.equal(satisfiesConstraint(mk(), 'purple-only'), true);
});
test('diabetic bound is exactly at the documented caps', () => {
  assert.equal(satisfiesConstraint(mk({ sugarG: DIABETIC_MAX_SUGAR_G, sodiumMg: DIABETIC_MAX_SODIUM_MG }), 'diabetic'), true);
  assert.equal(satisfiesConstraint(mk({ sugarG: DIABETIC_MAX_SUGAR_G + 1 }), 'diabetic'), false);
  assert.equal(satisfiesConstraint(mk({ sodiumMg: DIABETIC_MAX_SODIUM_MG + 1 }), 'diabetic'), false);
});
test('halal requires the tag on protein but not on produce', () => {
  assert.equal(satisfiesConstraint(mk({ category: 'protein' }), 'halal'), false);
  assert.equal(satisfiesConstraint(mk({ category: 'produce' }), 'halal'), true);
});

// ---------- household eligibility ----------

const hh = (constraints = [], size = 3) => ({ id: 'h', name: 'h', size, constraints });

test('multi-constraint household needs every rule satisfied', () => {
  const h = hh(['gluten-free', 'nut-free']);
  assert.equal(lotEligibleFor(mk({ allergens: ['gluten'] }), h), false);
  assert.equal(lotEligibleFor(mk({ allergens: ['peanuts'] }), h), false);
  assert.equal(lotEligibleFor(mk({ allergens: ['soy'] }), h), true);
});
test('household without constraints accepts anything', () => {
  assert.equal(lotEligibleFor(fixtures.porkCuts, hh([])), true);
});
test('household missing constraints field accepts anything', () => {
  assert.equal(lotEligibleFor(fixtures.wheatBread, { id: 'x', size: 2 }), true);
});
test('every listed constraint name is a known constant', () => {
  for (const c of CONSTRAINTS) assert.equal(typeof satisfiesConstraint(mk(), c), 'boolean');
});

// ---------- box targets ----------

test('boxTarget scales with household size', () => {
  const t1 = boxTarget(hh([], 1));
  const t3 = boxTarget(hh([], 3));
  assert.equal(t3.produce, 3 * t1.produce);
});
test('boxTarget covers every food group', () => {
  const t = boxTarget(hh([], 2));
  for (const g of FOOD_GROUPS) assert.ok(g in t);
});
test('boxTarget of size 1 equals the per-person table', () => {
  const t = boxTarget(hh([], 1));
  assert.deepEqual(t, { ...DEFAULT_TARGET_PER_PERSON });
});
test('boxTarget clamps missing size to one person', () => {
  const t = boxTarget({ id: 'x' });
  assert.equal(t.produce, DEFAULT_TARGET_PER_PERSON.produce);
});

// ---------- allocation ----------

const inv = () => [
  mk({ id: 'a1', category: 'produce', kg: 10, servings: 40, lifeLeftHours: 20 }),
  mk({ id: 'a2', category: 'protein', kg: 8, servings: 30, tags: ['halal'], lifeLeftHours: 30 }),
  mk({ id: 'a3', category: 'bakery', kg: 6, servings: 40, allergens: ['gluten'], lifeLeftHours: 50 }),
  mk({ id: 'a4', category: 'dairy', kg: 6, servings: 30, allergens: ['dairy'], lifeLeftHours: 80 }),
  mk({ id: 'a5', category: 'dry', kg: 10, servings: 50, lifeLeftHours: 2000 }),
];

test('allocateBoxes returns one box per household', () => {
  const { boxes } = allocateBoxes(inv(), [hh([], 2), hh([], 4)]);
  assert.equal(boxes.length, 2);
});
test('allocated servings come out of inventory (conservation)', () => {
  const inventory = inv();
  const total = inventory.reduce((n, l) => n + l.servings, 0);
  const { boxes, leftovers } = allocateBoxes(inventory, [hh([], 2)]);
  const alloc = boxes[0].items.reduce((n, i) => n + i.servings, 0);
  const left = leftovers.reduce((n, x) => n + x.servingsLeft, 0);
  assert.equal(alloc + left, total);
});
test('allocated kg come out of inventory (conservation)', () => {
  const inventory = inv();
  const total = inventory.reduce((n, l) => n + l.kg, 0);
  const { boxes, leftovers } = allocateBoxes(inventory, [hh([], 2)]);
  const alloc = boxes.reduce((n, b) => n + b.items.reduce((m, i) => m + i.kg, 0), 0);
  const left = leftovers.reduce((n, x) => n + x.kgLeft, 0);
  assert.ok(Math.abs(alloc + left - total) < 0.01);
});
test('gluten-free household receives no gluten lot', () => {
  const { boxes } = allocateBoxes(inv(), [hh(['gluten-free'], 2)]);
  assert.ok(boxes[0].items.every((i) => i.lotId !== 'a3'));
});
test('dairy-free household receives no dairy lot', () => {
  const { boxes } = allocateBoxes(inv(), [hh(['dairy-free'], 2)]);
  assert.ok(boxes[0].items.every((i) => i.lotId !== 'a4'));
});
test('halal household only gets tagged protein', () => {
  const inventory = [...inv(), mk({ id: 'a6', category: 'protein', kg: 4, servings: 20, lifeLeftHours: 25 })];
  const { boxes } = allocateBoxes(inventory, [hh(['halal'], 2)]);
  const ids = boxes[0].items.map((i) => i.lotId);
  assert.ok(ids.includes('a2'));
  assert.ok(!ids.includes('a6'));
});
test('urgent lots are consumed before stable ones', () => {
  const inventory = [
    mk({ id: 'slow', category: 'produce', kg: 5, servings: 30, lifeLeftHours: 500 }),
    mk({ id: 'fast', category: 'produce', kg: 5, servings: 30, lifeLeftHours: 3 }),
  ];
  const { boxes } = allocateBoxes(inventory, [hh([], 1)]);
  const ids = boxes[0].items.map((i) => i.lotId);
  assert.equal(ids[0], 'fast');
});
test('spoiled lots are never allocated', () => {
  const inventory = [mk({ id: 'dead', category: 'produce', kg: 5, servings: 30, spoiled: true })];
  const { boxes, leftovers } = allocateBoxes(inventory, [hh([], 1)]);
  assert.equal(boxes[0].items.length, 0);
  assert.equal(leftovers.length, 0);
});
test('empty inventory yields empty boxes and stats', () => {
  const { boxes, stats } = allocateBoxes([], [hh([], 2)]);
  assert.equal(boxes[0].items.length, 0);
  assert.equal(stats.servingsAllocated, 0);
});
test('zero households yields stats only', () => {
  const { boxes, stats } = allocateBoxes(inv(), []);
  assert.equal(boxes.length, 0);
  assert.equal(stats.householdCount, 0);
});
test('unmet groups are reported honestly', () => {
  const { boxes } = allocateBoxes([mk({ id: 'only', category: 'produce', kg: 2, servings: 4 })], [hh([], 3)]);
  assert.ok(boxes[0].unmet.length > 0);
  assert.ok(boxes[0].unmet.some((u) => u.group === 'protein'));
});
test('a fully served household reports no unmet groups', () => {
  const { boxes } = allocateBoxes(inv(), [hh([], 1)]);
  assert.equal(boxes[0].unmet.length, 0);
});
test('allocation is deterministic on identical input', () => {
  const a = allocateBoxes(inv(), [hh([], 2), hh(['nut-free'], 3)]);
  const b = allocateBoxes(inv(), [hh([], 2), hh(['nut-free'], 3)]);
  assert.deepEqual(a, b);
});
test('stats count fully served households', () => {
  const { stats } = allocateBoxes(inv(), [hh([], 1), hh([], 2)]);
  assert.ok(stats.householdsFullyServed >= 1);
  assert.equal(stats.householdCount, 2);
});
test('servings are whole numbers in every box', () => {
  const { boxes } = allocateBoxes(inv(), [hh([], 3), hh([], 2)]);
  for (const b of boxes) for (const i of b.items) assert.ok(Number.isInteger(i.servings));
});
test('no lot is overdrawn across households', () => {
  const inventory = inv();
  const { boxes } = allocateBoxes(inventory, [hh([], 5), hh([], 5), hh([], 5)]);
  const used = new Map();
  for (const b of boxes) for (const i of b.items) used.set(i.lotId, (used.get(i.lotId) || 0) + i.servings);
  for (const l of inventory) assert.ok((used.get(l.id) || 0) <= l.servings);
});

// ---------- allocation on real scenarios ----------

for (const s of SCENARIOS) {
  test(`${s.id}: allocated items satisfy every household constraint`, () => {
    const lots = allLots(s).map((l) => ({ ...l, lifeLeftHours: assessLot(l, s.ambientC, 0).lifeLeftHours }));
    const byId = new Map(lots.map((l) => [l.id, l]));
    const { boxes } = allocateBoxes(lots, s.households);
    for (const b of boxes) {
      for (const item of b.items) {
        assert.ok(lotEligibleFor(byId.get(item.lotId), b.household), `${item.lotId} -> ${b.household.id}`);
      }
    }
  });
  test(`${s.id}: box scores stay inside 0..1`, () => {
    const { boxes } = allocateBoxes(allLots(s), s.households);
    for (const b of boxes) {
      const sc = boxScore(b);
      assert.ok(sc >= 0 && sc <= 1, `${b.household.id} scored ${sc}`);
    }
  });
  test(`${s.id}: allocated kg never exceeds lot mass`, () => {
    const lots = allLots(s);
    const byId = new Map(lots.map((l) => [l.id, l]));
    const { boxes } = allocateBoxes(lots, s.households);
    const used = new Map();
    for (const b of boxes) for (const i of b.items) used.set(i.lotId, (used.get(i.lotId) || 0) + i.kg);
    for (const [id, kg] of used) assert.ok(kg <= byId.get(id).kg + 0.001, id);
  });
}

// ---------- boxScore / nutritionTotals ----------

test('boxScore of a perfect box is 1', () => {
  const { boxes } = allocateBoxes(inv(), [hh([], 1)]);
  assert.equal(boxScore(boxes[0]), 1);
});
test('boxScore of an empty box is below 1', () => {
  const b = { target: { produce: 2, protein: 2, grain: 2, dairy: 1, extras: 0 }, have: {} };
  assert.ok(boxScore(b) < 0.2);
});
test('boxScore handles a missing box', () => assert.equal(boxScore(null), 0));

test('nutritionTotals sums per-serving nutrients', () => {
  const lot = mk({ id: 'n1', proteinG: 10, sodiumMg: 100, sugarG: 5, fiberG: 2 });
  const items = [{ lotId: 'n1', servings: 4, kg: 2, name: 'x', category: 'dry', group: 'grain' }];
  const totals = nutritionTotals(items, new Map([['n1', lot]]));
  assert.equal(totals.proteinG, 40);
  assert.equal(totals.sodiumMg, 400);
  assert.equal(totals.servings, 4);
});
test('nutritionTotals tolerates unknown lot ids', () => {
  const totals = nutritionTotals([{ lotId: 'ghost', servings: 2, kg: 1 }], new Map());
  assert.equal(totals.servings, 2);
  assert.equal(totals.proteinG, 0);
});
test('nutritionTotals accepts a resolver function', () => {
  const lot = mk({ id: 'n1', proteinG: 3 });
  const totals = nutritionTotals([{ lotId: 'n1', servings: 2, kg: 1 }], (id) => (id === 'n1' ? lot : undefined));
  assert.equal(totals.proteinG, 6);
});

test('allergen registry has the FDA major set', () => {
  for (const a of ['gluten', 'nuts', 'peanuts', 'dairy', 'egg', 'soy', 'fish', 'shellfish', 'sesame']) {
    assert.ok(ALLERGENS.includes(a), a);
  }
});
test('constraint registry covers the six advertised diets', () => {
  assert.deepEqual([...CONSTRAINTS].sort(), ['dairy-free', 'diabetic', 'gluten-free', 'halal', 'nut-free', 'vegetarian']);
});
