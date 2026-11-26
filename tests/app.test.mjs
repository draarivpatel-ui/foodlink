import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRODUCT_CLASSES, assessLot, cToF } from '../src/spoilage.mjs';
import { ALLERGENS, allocateBoxes } from '../src/nutrition.mjs';
import { planRoute, co2eKg } from '../src/routing.mjs';
import { SCENARIOS, getScenario, allLots, encodeState, decodeState, validateScenario, scenarioFromCSV } from '../src/scenarios.mjs';
import { buildRuns } from '../src/shifts.mjs';
import { servingsDelivered } from '../src/impact.mjs';
import { t } from '../src/i18n.mjs';

const app = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const functionSource = name => {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists in the app');
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const appFunctions = (names, bindings) => Function(...Object.keys(bindings),
  names.map(functionSource).join('\n') + '\nreturn {' + names.join(',') + '};')(...Object.values(bindings));
const initialState = () => ({
  scenario: getScenario('storm-outage'), scenarioId: 'storm-outage', dirty: false,
  params: { ambientC: 32, elapsedMin: 30, capacityKg: 380, speedKmh: 34, coldChainMaxMin: 75 },
  assessments: new Map(), claims: {}, lang: 'en', theme: 'light',
});

test('storm triage excludes all five spoiled lots from rescue, impact and household boxes', () => {
  const state = initialState();
  const snapshot = JSON.stringify(state.scenario);
  let routed, inventory;
  const { recompute } = appFunctions(['recompute'], {
    state, allLots, assessLot, buildRuns,
    planRoute: (scenario, options) => { routed = scenario; return planRoute(scenario, options); },
    allocateBoxes: (lots, households) => { inventory = lots; return allocateBoxes(lots, households); },
  });
  recompute();
  const spoiled = ['l-yogurt', 'l-deli', 'l-fish', 'l-prepared-meals', 'l-oj'];
  assert.deepEqual([...state.assessments].filter(([, a]) => a.spoiled).map(([id]) => id), spoiled);
  for (const id of spoiled) {
    assert.ok(!state.deliveredIds.has(id), id + ' must not be delivered');
    assert.ok(!state.plan.visits.some(v => v.picked?.includes(id)), id + ' must not be picked up');
    assert.ok(!state.allocation.boxes.some(box => box.items.some(item => item.lotId === id)), id + ' must not enter a box');
  }
  assert.equal(state.plan.rescuedKg, 103);
  assert.equal(servingsDelivered(state.plan, state.scenario), 352);
  assert.equal(co2eKg(state.plan.rescuedKg), co2eKg(103));
  for (const lot of allLots(routed)) {
    const a = state.assessments.get(lot.id);
    for (const key of ['lifeLeftHours', 'dangerMinutes', 'spoiled', 'tier']) assert.equal(lot[key], a[key], lot.id + ' ' + key);
  }
  assert.ok(inventory.length > 0);
  for (const lot of inventory) {
    assert.equal(lot.spoiled, false);
    assert.equal(lot.lifeLeftHours, state.assessments.get(lot.id).lifeLeftHours);
    assert.equal(lot.dangerMinutes, state.assessments.get(lot.id).dangerMinutes);
  }
  assert.equal(JSON.stringify(state.scenario), snapshot, 'assessments must not change the source inventory');
  state.params.elapsedMin = 0;
  recompute();
  assert.equal(state.plan.rescuedKg, 203, 'reassessing a shorter elapsed time restores fresh stock');
  assert.ok(state.deliveredIds.has('l-yogurt'));
});

const savedParams = { ambientC: 40, elapsedMin: 30, capacityKg: 200, speedKmh: 20, coldChainMaxMin: 60 };
for (const embedded of [false, true]) {
  test((embedded ? 'embedded scenario' : 'preset') + ' hash restores all five sliders after scenario defaults', () => {
    const state = initialState();
    const controls = new Map();
    const $ = id => {
      if (!controls.has(id)) controls.set(id, {});
      return controls.get(id);
    };
    const payload = { params: savedParams, ui: { lang: 'es', theme: 'dark' } };
    if (embedded) payload.scenario = getScenario('storm-outage');
    else payload.scenarioId = 'storm-outage';
    const { loadFromHash } = appFunctions(['applyScenario', 'loadFromHash', 'pickParams', 'syncControls', 'updateOutputs'], {
      state, $, cToF, SCENARIOS, getScenario, decodeState, validateScenario,
      location: { hash: '#s=' + encodeState(payload) }, renderScenarioButtons: () => {},
    });
    assert.equal(loadFromHash(), true);
    assert.deepEqual(state.params, savedParams);
    const sliders = { 'in-ambient': 'ambientC', 'in-elapsed': 'elapsedMin', 'in-capacity': 'capacityKg',
      'in-speed': 'speedKmh', 'in-chain': 'coldChainMaxMin' };
    for (const [id, key] of Object.entries(sliders)) assert.equal(Number($(id).value), savedParams[key], id);
    assert.equal(state.lang, 'es');
    assert.equal(state.theme, 'dark');
    assert.equal(state.dirty, embedded);
  });
}

test('language switching translates editor labels, slider names and tags without changing values', () => {
  const state = initialState();
  const nodes = [];
  const byId = new Map();
  const element = tag => {
    const node = { tag, dataset: {}, attributes: {}, children: [], textContent: '',
      setAttribute(name, value) { this.attributes[name] = String(value); },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); return child; } };
    nodes.push(node);
    return node;
  };
  const $ = id => {
    if (!byId.has(id)) byId.set(id, element('div'));
    return byId.get(id);
  };
  for (const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)) {
    const node = $(match[1]);
    for (const [attribute, key] of [['data-i18n-aria', 'i18nAria'], ['data-i18n-placeholder', 'i18nPlaceholder']]) {
      const value = match[0].match(new RegExp(attribute + '="([^"]+)"'))?.[1];
      if (value) node.dataset[key] = value;
    }
    const placeholder = match[0].match(/placeholder="([^"]+)"/)?.[1];
    if (placeholder) node.placeholder = placeholder;
    const aria = match[0].match(/aria-label="([^"]+)"/)?.[1];
    if (aria) node.setAttribute('aria-label', aria);
  }
  const document = { documentElement: {}, createElement: element,
    querySelectorAll: selector => {
      const key = { '[data-i18n]': 'i18n', '[data-i18n-aria]': 'i18nAria',
        '[data-i18n-placeholder]': 'i18nPlaceholder' }[selector];
      assert.ok(key, selector);
      return nodes.filter(node => node.dataset[key]);
    } };
  const start = app.indexOf("  const catSel = $('lot-category');");
  const end = app.indexOf('  const refreshDonors =', start);
  Function('$', 'document', 'PRODUCT_CLASSES', 'ALLERGENS', 'state', 't', app.slice(start, end))(
    $, document, PRODUCT_CLASSES, ALLERGENS, state, t);
  const { applyLang } = appFunctions(['applyLang'], { state, $, document, t,
    renderExplainer: () => {}, renderScenarioButtons: () => {}, recompute: () => {}, renderAll: () => {} });
  const categories = { protein: 'Proteína', dairy: 'Lácteos', prepared: 'Comidas preparadas',
    produce: 'Frutas y verduras', bakery: 'Panadería', dry: 'Alimentos secos' };
  const allergens = { gluten: 'gluten', nuts: 'frutos secos', peanuts: 'cacahuates', dairy: 'lácteos',
    egg: 'huevo', soy: 'soya', fish: 'pescado', shellfish: 'mariscos', sesame: 'sésamo' };
  const checkboxLabels = () => $('lot-allergens').children.map(label => ({
    checkbox: label.children.find(child => child.type === 'checkbox'),
    text: label.children.filter(child => child.type !== 'checkbox').map(child =>
      typeof child === 'string' ? child : child.textContent).join(''),
  }));
  checkboxLabels()[1].checkbox.checked = true;
  state.lang = 'es';
  applyLang();
  for (const option of $('lot-category').children) assert.equal(option.textContent, categories[option.value]);
  for (const label of checkboxLabels()) assert.equal(label.text, allergens[label.checkbox.value]);
  const sliderNames = { 'in-ambient': 'Temperatura ambiente en grados Celsius', 'in-elapsed': 'Tiempo transcurrido en minutos',
    'in-capacity': 'Capacidad del vehículo en kilogramos', 'in-speed': 'Velocidad del vehículo en kilómetros por hora',
    'in-chain': 'Límite de cadena de frío en minutos' };
  for (const [id, label] of Object.entries(sliderNames)) assert.equal($(id).attributes['aria-label'], label);
  assert.equal($('lot-tags').placeholder, 'p. ej., halal');
  assert.equal(document.documentElement.lang, 'es');
  assert.equal(checkboxLabels()[1].checkbox.checked, true);
  state.lang = 'en';
  applyLang();
  for (const option of $('lot-category').children) assert.equal(option.textContent, PRODUCT_CLASSES[option.value].label);
  for (const label of checkboxLabels()) assert.equal(label.text, label.checkbox.value);
  assert.equal($('lot-tags').placeholder, 'e.g., halal; vegetarian');
  assert.equal(checkboxLabels()[1].checkbox.checked, true);
});

test('import and reset rebuild the lot donor choices for the active scenario', () => {
  const state = initialState();
  const byId = new Map();
  const makeElement = (tag) => {
    const node = {
      tag, dataset: {}, attributes: {}, children: [], listeners: {}, style: {},
      value: '', textContent: '', placeholder: '', type: '', checked: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      querySelectorAll(selector) {
        const flat = (n) => [n, ...n.children.flatMap(flat)];
        if (selector === 'input:checked') return flat(this).filter((x) => x.type === 'checkbox' && x.checked);
        return [];
      },
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return ''; },
      set(value) { if (value === '') this.children = []; },
    });
    return node;
  };
  const $ = (id) => {
    if (!byId.has(id)) byId.set(id, makeElement('div'));
    return byId.get(id);
  };
  const document = {
    createElement: makeElement,
    querySelectorAll: () => [],
    body: makeElement('body'),
    documentElement: {},
  };
  const applyScenario = (s, id) => {
    state.scenario = s;
    state.scenarioId = id || s.id || 'custom';
    state.dirty = !id;
  };
  const { wireControls } = appFunctions(['wireControls'], {
    state, $, document, window: { addEventListener() {} }, t,
    PRODUCT_CLASSES, ALLERGENS, SCENARIOS, getScenario, validateScenario, scenarioFromCSV,
    applyScenario, clearBoard: () => {}, recompute: () => {}, renderAll: () => {}, syncHash: () => {},
    exportStateJSON: JSON.stringify, download: () => {}, briefJSON: () => ({}), boardState: () => ({ active: {}, reach: {} }),
    flashBrief: () => {}, runSelfTests: () => ({ passed: 0, failed: 0, results: [] }), selectTab: () => {},
    navigator: {}, location: { href: 'http://local/' }, history: {}, encodeState, decodeState,
  });
  wireControls();
  assert.deepEqual(
    $('lot-donor').children.map((o) => o.textContent),
    state.scenario.donors.map((d) => d.name),
  );

  const imported = getScenario('school-cafeteria');
  imported.id = 'imported-custom';
  $('import-text').value = JSON.stringify({ scenario: imported });
  $('import-btn').listeners.click[0]();
  assert.deepEqual(
    $('lot-donor').children.map((o) => o.textContent),
    imported.donors.map((d) => d.name),
    'import must replace stale donor options',
  );

  $('reset-btn').listeners.click[0]();
  assert.deepEqual(
    $('lot-donor').children.map((o) => o.textContent),
    SCENARIOS[0].donors.map((d) => d.name),
    'reset must replace stale donor options',
  );
});
