import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, LANGS, t, interpolate, keyParity, manifestLines, checklist } from '../src/i18n.mjs';
import { SCENARIOS, getScenario } from '../src/scenarios.mjs';
import { planRoute } from '../src/routing.mjs';

// ---------- key parity (one test per key) ----------

const enKeys = Object.keys(STRINGS.en);
const esKeys = Object.keys(STRINGS.es);

test('English and Spanish have identical key sets', () => {
  const p = keyParity();
  assert.deepEqual(p.missingInEs, []);
  assert.deepEqual(p.missingInEn, []);
});

for (const k of enKeys) {
  test(`key "${k}" exists in Spanish`, () => {
    assert.ok(k in STRINGS.es, `missing in es`);
  });
}
for (const k of esKeys) {
  test(`key "${k}" exists in English`, () => {
    assert.ok(k in STRINGS.en, `missing in en`);
  });
}
for (const k of enKeys) {
  test(`key "${k}" is non-empty in both languages`, () => {
    assert.ok(STRINGS.en[k].length > 0);
    assert.ok(STRINGS.es[k].length > 0);
  });
}

test('both languages are registered', () => assert.deepEqual(LANGS, ['en', 'es']));
test('a non-trivial dictionary ships (>= 60 keys)', () => assert.ok(enKeys.length >= 60, `${enKeys.length} keys`));

// ---------- t() ----------

test('t returns the English string', () => assert.equal(t('en', 'tabDispatch'), 'Dispatch map'));
test('t returns the Spanish string', () => assert.equal(t('es', 'tabDispatch'), 'Mapa de despacho'));
test('t falls back to English for unknown languages', () => assert.equal(t('fr', 'tabDispatch'), 'Dispatch map'));
test('t returns the key itself for unknown keys', () => assert.equal(t('en', 'ghost-key'), 'ghost-key'));
test('t interpolates {params}', () => {
  assert.equal(interpolate('hello {name} and {n}', { name: 'world', n: 3 }), 'hello world and 3');
});
test('interpolate leaves missing params literal', () => {
  assert.equal(interpolate('hi {name}', {}), 'hi {name}');
});
test('interpolate without params returns input', () => {
  assert.equal(interpolate('plain'), 'plain');
});
test('Spanish UI terms differ from English where expected', () => {
  for (const k of ['tabDispatch', 'printButton', 'rescuedLabel', 'tierCritical']) {
    assert.notEqual(STRINGS.es[k], STRINGS.en[k], k);
  }
});
test('brand name stays FoodLink in both languages', () => {
  assert.equal(STRINGS.en.appTitle, 'FoodLink');
  assert.equal(STRINGS.es.appTitle, 'FoodLink');
});

// ---------- checklist ----------

test('checklist ships 8 items in English', () => assert.equal(checklist('en').length, 8));
test('checklist ships 8 items in Spanish', () => assert.equal(checklist('es').length, 8));
test('checklist falls back to English', () => assert.equal(checklist('fr').length, 8));
test('checklist mentions the Good Samaritan Act', () => {
  assert.ok(checklist('en').some((x) => x.includes('Good Samaritan')));
});
test('checklist mentions the 41 F cold-holding line', () => {
  assert.ok(checklist('en').some((x) => x.includes('41 F')));
});

// ---------- manifest ----------

test('manifest renders numbered stops in English', () => {
  const s = getScenario('farmers-market');
  const plan = planRoute(s, {});
  const lines = manifestLines(plan, s, 'en');
  assert.ok(lines.some((l) => l.includes('Stop 1')));
  assert.ok(lines[0].includes('FoodLink'));
});
test('manifest renders numbered stops in Spanish', () => {
  const s = getScenario('farmers-market');
  const plan = planRoute(s, {});
  const lines = manifestLines(plan, s, 'es');
  assert.ok(lines.some((l) => l.includes('Parada 1')));
});
test('manifest reports route totals', () => {
  const s = getScenario('school-cafeteria');
  const plan = planRoute(s, {});
  const text = manifestLines(plan, s, 'en').join('\n');
  assert.ok(/Route distance/.test(text));
  assert.ok(/kg/.test(text));
});
test('empty plan yields the honest empty-state line', () => {
  const s = getScenario('storm-outage');
  const lines = manifestLines({ visits: [], order: [] }, s, 'en');
  assert.ok(lines.some((l) => l.includes('No feasible route')));
});
test('manifest marks pickups and drop-offs distinctly', () => {
  const s = getScenario('farmers-market');
  const plan = planRoute(s, {});
  const text = manifestLines(plan, s, 'en').join('\n');
  assert.ok(text.includes('Pickup'));
  assert.ok(text.includes('Drop-off'));
});
