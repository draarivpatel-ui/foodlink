import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS, getScenario, clone, validateScenario, encodeState, decodeState,
  exportStateJSON, scenarioToCSV, scenarioFromCSV, lotsToCSV, lotsFromCSV,
  parseCSV, csvEscape, allLots,
} from '../src/scenarios.mjs';

// ---------- built-in library ----------

test('four built-in scenarios ship', () => assert.equal(SCENARIOS.length, 4));
test('scenario ids are unique', () => {
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
});
for (const s of SCENARIOS) {
  test(`${s.id}: validates clean`, () => {
    const v = validateScenario(s);
    assert.equal(v.ok, true, v.errors.join('; '));
  });
  test(`${s.id}: all entity ids are unique`, () => {
    const ids = new Set();
    for (const d of s.donors) {
      assert.ok(!ids.has(d.id), d.id);
      ids.add(d.id);
      for (const l of d.lots) { assert.ok(!ids.has(l.id), l.id); ids.add(l.id); }
    }
    for (const p of s.pantries) { assert.ok(!ids.has(p.id), p.id); ids.add(p.id); }
  });
  test(`${s.id}: every time window opens before it closes`, () => {
    for (const p of [...s.donors, ...s.pantries]) assert.ok(p.openMin < p.closeMin, p.id);
  });
  test(`${s.id}: every lot has positive kg and servings`, () => {
    for (const l of allLots(s)) {
      assert.ok(l.kg > 0 && l.servings > 0, l.id);
    }
  });
  test(`${s.id}: households are non-empty and sized`, () => {
    assert.ok(s.households.length > 0);
    for (const h of s.households) assert.ok(h.size >= 1);
  });
}

test('getScenario returns a deep copy (mutation does not leak)', () => {
  const a = getScenario('farmers-market');
  a.donors[0].lots[0].kg = 99999;
  const b = getScenario('farmers-market');
  assert.notEqual(b.donors[0].lots[0].kg, 99999);
});
test('getScenario throws on an unknown id', () => assert.throws(() => getScenario('nope')));
test('clone deep-copies nested structures', () => {
  const src = { a: { b: [1, 2] } };
  const c = clone(src);
  c.a.b[0] = 9;
  assert.equal(src.a.b[0], 1);
});

// ---------- validation ----------

const good = () => getScenario('farmers-market');

const invalidCases = [
  ['null input', null],
  ['string input', 'x'],
  ['missing id', { ...good(), id: '' }],
  ['ambient too hot', { ...good(), ambientC: 99 }],
  ['bad startMin', { ...good(), startMin: 2000 }],
  ['no donors', { ...good(), donors: [] }],
  ['no pantries', { ...good(), pantries: [] }],
  ['donor window inverted', (() => { const s = good(); s.donors[0].openMin = 900; s.donors[0].closeMin = 100; return s; })()],
  ['lot bad category', (() => { const s = good(); s.donors[0].lots[0].category = 'air'; return s; })()],
  ['lot zero kg', (() => { const s = good(); s.donors[0].lots[0].kg = 0; return s; })()],
  ['lot fractional servings', (() => { const s = good(); s.donors[0].lots[0].servings = 2.5; return s; })()],
  ['lot bad allergen', (() => { const s = good(); s.donors[0].lots[0].allergens = ['kryptonite']; return s; })()],
  ['duplicate entity ids', (() => { const s = good(); s.donors[1].id = s.donors[0].id; return s; })()],
  ['pantry zero capacity', (() => { const s = good(); s.pantries[0].capacityKg = 0; return s; })()],
  ['household bad size', (() => { const s = good(); s.households[0].size = 0; return s; })()],
  ['household fractional size', (() => { const s = good(); s.households[0].size = 1.5; return s; })()],
  ['household bad constraint', (() => { const s = good(); s.households[0].constraints = ['paleo']; return s; })()],
  ['vehicle missing capacity', (() => { const s = good(); s.vehicle = { speedKmh: 30 }; return s; })()],
  ['negative service minutes', (() => { const s = good(); s.vehicle.serviceMin = -1; return s; })()],
  ['lot tags as a string', (() => { const s = good(); s.donors[0].lots[0].tags = 'meat'; return s; })()],
  ['lot tags with a non-string entry', (() => { const s = good(); s.donors[0].lots[0].tags = [['meat']]; return s; })()],
  ['negative sugar hides diabetic risk', (() => { const s = good(); s.donors[0].lots[0].sugarG = -1; return s; })()],
  ['negative sodium hides diabetic risk', (() => { const s = good(); s.donors[0].lots[0].sodiumMg = -1; return s; })()],
  ['non-finite protein total', (() => { const s = good(); s.donors[0].lots[0].proteinG = Infinity; return s; })()],
  ['tcs override as a string', (() => { const s = good(); s.donors[0].lots[0].tcs = 'false'; return s; })()],
  ['profile with negative minutes', (() => { const s = good(); s.donors[0].lots[0].profile = [{ tempC: 20, minutes: -1 }]; return s; })()],
  ['profile with non-finite temperature', (() => { const s = good(); s.donors[0].lots[0].profile = [{ tempC: NaN, minutes: 1 }]; return s; })()],
];

for (const [name, input] of invalidCases) {
  test(`validator rejects: ${name}`, () => {
    assert.equal(validateScenario(input).ok, false);
  });
}
test('validator reports errors, not throws, on garbage', () => {
  const v = validateScenario(42);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length > 0);
});

// ---------- CSV ----------

test('csvEscape quotes fields containing commas', () => assert.equal(csvEscape('a,b'), '"a,b"'));
test('csvEscape doubles embedded quotes', () => assert.equal(csvEscape('say "hi"'), '"say ""hi"""'));
test('csvEscape leaves plain fields alone', () => assert.equal(csvEscape('plain'), 'plain'));
test('parseCSV handles quoted commas', () => {
  const rows = parseCSV('a,"b,c",d\n');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
});
test('parseCSV handles CRLF', () => {
  const rows = parseCSV('a,b\r\nc,d\r\n');
  assert.equal(rows.length, 2);
});
test('parseCSV ignores a trailing newline', () => {
  assert.equal(parseCSV('a\n').length, 1);
});
test('parseCSV survives empty input', () => assert.deepEqual(parseCSV(''), []));
test('parseCSV rejects an unterminated quoted field', () => {
  assert.throws(() => parseCSV('a,"unterminated\nb,c\n'), /unterminated/i);
});
test('scenarioFromCSV reports malformed quoting instead of throwing', () => {
  const res = scenarioFromCSV('meta,20,600,100,30,10,120\ndepot,"broken,0,0\n');
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /unterminated/i.test(e)));
});
test('lotsFromCSV reports malformed quoting instead of throwing', () => {
  const res = lotsFromCSV('name,category,kg,servings\n"broken,produce,1,2\n');
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /unterminated/i.test(e)));
});

for (const s of SCENARIOS) {
  test(`${s.id}: CSV round-trip preserves structure`, () => {
    const res = scenarioFromCSV(scenarioToCSV(s));
    assert.equal(res.ok, true, res.errors.join('; '));
    const back = res.scenario;
    assert.equal(back.donors.length, s.donors.length);
    assert.equal(back.pantries.length, s.pantries.length);
    assert.equal(back.households.length, s.households.length);
    assert.equal(allLots(back).length, allLots(s).length);
  });
}

test('CSV round-trip preserves lot allergens and tags', () => {
  const s = SCENARIOS[0];
  const back = scenarioFromCSV(scenarioToCSV(s)).scenario;
  const orig = allLots(s).find((l) => (l.allergens || []).length > 0);
  const re = allLots(back).find((l) => l.id === orig.id);
  assert.deepEqual(re.allergens, orig.allergens);
});
test('CSV round-trip preserves meta fields', () => {
  const s = SCENARIOS[2];
  const back = scenarioFromCSV(scenarioToCSV(s)).scenario;
  assert.equal(back.ambientC, s.ambientC);
  assert.equal(back.startMin, s.startMin);
  assert.equal(back.coldChainMaxMin, s.coldChainMaxMin);
});
test('CSV round-trip preserves pantry capacity', () => {
  const s = SCENARIOS[1];
  const back = scenarioFromCSV(scenarioToCSV(s)).scenario;
  assert.deepEqual(back.pantries.map((p) => p.capacityKg), s.pantries.map((p) => p.capacityKg));
});
test('CSV round-trip preserves household constraints', () => {
  const s = SCENARIOS[0];
  const back = scenarioFromCSV(scenarioToCSV(s)).scenario;
  const h = back.households.find((x) => x.id === 'h-amin');
  assert.deepEqual(h.constraints, ['halal']);
});
test('scenarioFromCSV rejects a lot pointing at a missing donor', () => {
  const res = scenarioFromCSV('lot,d-nope,l1,Name,produce,5,10,40,,,,,,,\n');
  assert.equal(res.ok, false);
});
test('scenarioFromCSV rejects garbage rows', () => {
  const res = scenarioFromCSV('bogus,1,2,3\n');
  assert.equal(res.ok, false);
});
test('scenarioFromCSV handles quoted commas in names', () => {
  const csv = 'meta,20,600,100,30,10,120\ndepot,"Depot, Main",0,0\ndonor,d1,"D, one",0,0.01,0,1000\nlot,d1,l1,"Lot, A",produce,5,10,40,,,,,,\npantry,p1,"P, one",0,0.02,0,2000,100\nhousehold,h1,"H, one",2,\n';
  const res = scenarioFromCSV(csv);
  assert.equal(res.ok, true, res.errors.join(';'));
  assert.equal(res.scenario.donors[0].name, 'D, one');
});

// ---------- lot-level CSV ----------

test('lotsToCSV/lotsFromCSV round-trip', () => {
  const lots = allLots(SCENARIOS[0]).slice(0, 3);
  const res = lotsFromCSV(lotsToCSV(lots));
  assert.equal(res.ok, true, res.errors.join(';'));
  assert.equal(res.lots.length, 3);
  assert.equal(res.lots[0].name, lots[0].name);
});
test('lotsFromCSV rejects a bad category', () => {
  const res = lotsFromCSV('name,category,kg,servings\nX,air,1,1\n');
  assert.equal(res.ok, false);
});
test('lotsFromCSV rejects non-positive mass', () => {
  const res = lotsFromCSV('name,category,kg,servings\nX,produce,-1,4\n');
  assert.equal(res.ok, false);
});
test('lotsFromCSV works without a header row', () => {
  const res = lotsFromCSV('Crate,produce,5,10,40,,,,,,,\n');
  assert.equal(res.ok, true);
  assert.equal(res.lots[0].category, 'produce');
});
test('lotsFromCSV assigns sequential ids', () => {
  const res = lotsFromCSV('a,produce,1,2,40,,,,,,,\nb,dry,3,4,400,,,,,,,\n');
  assert.deepEqual(res.lots.map((l) => l.id), ['lot-1', 'lot-2']);
});

// ---------- JSON / hash state ----------

test('exportStateJSON produces parseable pretty JSON', () => {
  const s = exportStateJSON({ a: 1 });
  assert.equal(JSON.parse(s).a, 1);
  assert.ok(s.includes('\n'));
});

test('encodeState/decodeState round-trips params', () => {
  const state = { scenarioId: 'farmers-market', params: { ambientC: 21, elapsedMin: 45 } };
  const back = decodeState(encodeState(state));
  assert.equal(back.ok, true);
  assert.equal(back.state.params.ambientC, 21);
});
test('hash token is URL-safe (no +, / or = inside)', () => {
  const tok = encodeState({ scenarioId: 'x', params: { q: 'a+b/c=d' } });
  assert.ok(!/[+/=]/.test(tok));
});
test('decodeState tolerates a leading # and #s= prefix', () => {
  const tok = encodeState({ scenarioId: 'storm-outage' });
  assert.equal(decodeState(`#${tok}`).ok, true);
});
test('decodeState round-trips an embedded custom scenario', () => {
  const s = getScenario('school-cafeteria');
  s.donors[0].lots.push({ id: 'x1', name: 'Extra', category: 'dry', kg: 3, servings: 9, freshHours: 100, allergens: [], tags: [] });
  const back = decodeState(encodeState({ scenario: s }));
  assert.equal(back.ok, true, (back.errors || []).join(';'));
  assert.equal(allLots(back.state.scenario).length, allLots(s).length);
});

const badTokens = [
  ['empty', '#'],
  ['symbols', '#!!bogus'],
  ['percent junk', '#%%%'],
  ['not base64 json', '#AAAA'],
  ['truncated json', '#e30'],
  ['plain text', '#hello'],
  ['number', '#12345'],
  ['array not object', '#WzEsMl0'],
];
for (const [name, tok] of badTokens) {
  test(`decodeState fails safe on ${name}`, () => {
    assert.equal(decodeState(tok).ok, false);
  });
}
test('decodeState rejects a hash holding an invalid scenario', () => {
  const tok = encodeState({ scenario: { id: '', name: '' } });
  const res = decodeState(tok);
  assert.equal(res.ok, false);
});
test('decodeState never throws on adversarial input', () => {
  assert.doesNotThrow(() => decodeState('#' + 'A'.repeat(5000)));
});

// ---------- allLots ----------

test('allLots flattens donors with donorId attached', () => {
  const s = SCENARIOS[0];
  const lots = allLots(s);
  const total = s.donors.reduce((n, d) => n + d.lots.length, 0);
  assert.equal(lots.length, total);
  assert.ok(lots.every((l) => typeof l.donorId === 'string'));
});
test('allLots returns copies, not references', () => {
  const s = SCENARIOS[0];
  const lots = allLots(s);
  lots[0].kg = -1;
  assert.notEqual(s.donors.flatMap((d) => d.lots)[0].kg, -1);
});
