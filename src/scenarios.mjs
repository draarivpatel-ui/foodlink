// FoodLink scenario library and state codecs.
// Four built-in civic scenarios, a strict validator, CSV and JSON
// import/export, and a URL-hash share format. All place names are fictional.

import { CLASS_KEYS } from './spoilage.mjs';
import { ALLERGENS, CONSTRAINTS } from './nutrition.mjs';

const lotDefaults = {
  allergens: [], tags: [], proteinG: 0, fiberG: 0, sodiumMg: 0, sugarG: 0,
};

function mkLot(id, name, category, kg, servings, freshHours, extra = {}) {
  return { id, name, category, kg, servings, freshHours, ...lotDefaults, ...extra };
}

function mkDonor(id, name, lat, lon, openMin, closeMin, lots) {
  return { id, name, lat, lon, openMin, closeMin, lots };
}

function mkPantry(id, name, lat, lon, openMin, closeMin, capacityKg) {
  return { id, name, lat, lon, openMin, closeMin, capacityKg };
}

function mkHousehold(id, name, size, constraints = []) {
  return { id, name, size, constraints };
}

export const SCENARIOS = Object.freeze([
  {
    id: 'farmers-market',
    name: 'Saturday Farmers Market Rescue',
    blurb: 'Stalls close at 14:00 with crates of produce, bread and hot trays still unsold. Volunteers have one van and a warm afternoon.',
    ambientC: 26,
    startMin: 14 * 60,
    coldChainMaxMin: 120,
    vehicle: { capacityKg: 320, speedKmh: 30, serviceMin: 12 },
    depot: { name: 'Volunteer depot', lat: 29.701, lon: -95.401 },
    donors: [
      mkDonor('d-mkt-1', 'North Stall Row', 29.712, -95.392, 13 * 60 + 30, 15 * 60, [
        mkLot('l-tomatoes', 'Heirloom tomatoes', 'produce', 38, 90, 60, { fiberG: 2 }),
        mkLot('l-greens', 'Cut salad greens', 'produce', 16, 60, 30, { tcs: true, fiberG: 3 }),
        mkLot('l-berries', 'Berry pints', 'produce', 9, 36, 20, { sugarG: 7, fiberG: 4 }),
      ]),
      mkDonor('d-mkt-2', 'Bakery Tent', 29.698, -95.385, 13 * 60 + 45, 15 * 60 + 30, [
        mkLot('l-sourdough', 'Sourdough loaves', 'bakery', 22, 44, 72, { allergens: ['gluten'], fiberG: 2 }),
        mkLot('l-bagels', 'Bagel bags', 'bakery', 14, 40, 60, { allergens: ['gluten', 'sesame'] }),
      ]),
      mkDonor('d-mkt-3', 'Hot Food Corner', 29.706, -95.412, 13 * 60 + 30, 14 * 60 + 45, [
        mkLot('l-rice-trays', 'Rice and bean trays', 'prepared', 25, 50, 5, { tags: ['halal', 'vegetarian'], proteinG: 9, sodiumMg: 410 }),
        mkLot('l-chicken-wraps', 'Chicken wraps', 'prepared', 18, 36, 4, { tags: ['halal', 'meat'], proteinG: 14, sodiumMg: 520, allergens: ['gluten'] }),
      ]),
      mkDonor('d-mkt-4', 'Dairy Cooler', 29.690, -95.398, 13 * 60 + 45, 15 * 60, [
        mkLot('l-milk', 'Milk gallons', 'dairy', 30, 64, 96, { allergens: ['dairy'], proteinG: 8 }),
        mkLot('l-cheese', 'Cheese wedges', 'dairy', 11, 44, 120, { allergens: ['dairy'], proteinG: 7, sodiumMg: 350 }),
      ]),
    ],
    pantries: [
      mkPantry('p-east', 'Eastside Community Fridge', 29.718, -95.376, 13 * 60, 17 * 60, 160),
      mkPantry('p-west', 'Westgate Pantry', 29.688, -95.425, 13 * 60, 18 * 60, 200),
    ],
    households: [
      mkHousehold('h-rivera', 'Rivera household', 4, []),
      mkHousehold('h-ode', 'Ode household', 3, ['nut-free']),
      mkHousehold('h-amin', 'Amin household', 5, ['halal']),
      mkHousehold('h-beck', 'Beck household', 2, ['gluten-free', 'diabetic']),
    ],
  },
  {
    id: 'school-cafeteria',
    name: 'School Cafeteria Surplus Share',
    blurb: 'Friday service ended with covered pans and sealed cartons left over. Everything is already chilled; the question is who it can reach before the weekend.',
    ambientC: 18,
    startMin: 15 * 60 + 30,
    coldChainMaxMin: 150,
    vehicle: { capacityKg: 240, speedKmh: 28, serviceMin: 10 },
    depot: { name: 'Loading dock', lat: 29.662, lon: -95.447 },
    donors: [
      mkDonor('d-caf-a', 'Cafeteria Line A', 29.668, -95.441, 15 * 60, 16 * 60 + 30, [
        mkLot('l-pasta', 'Pasta bake pans', 'prepared', 34, 80, 30, { allergens: ['gluten', 'dairy'], tags: ['vegetarian'], proteinG: 11, sodiumMg: 540 }),
        mkLot('l-veg-cups', 'Vegetable cups', 'produce', 12, 48, 36, { tcs: true, fiberG: 3 }),
      ]),
      mkDonor('d-caf-b', 'Cafeteria Line B', 29.656, -95.455, 15 * 60, 16 * 60 + 15, [
        mkLot('l-milk-caf', 'Sealed milk cartons', 'dairy', 26, 96, 110, { allergens: ['dairy'], proteinG: 8 }),
        mkLot('l-rolls', 'Dinner rolls', 'bakery', 16, 64, 70, { allergens: ['gluten'] }),
        mkLot('l-fruit', 'Whole apples and oranges', 'produce', 20, 80, 96, { fiberG: 3 }),
      ]),
    ],
    pantries: [
      mkPantry('p-youth', 'Youth Center Supper Club', 29.674, -95.432, 15 * 60 + 30, 19 * 60, 90),
      mkPantry('p-senior', 'Senior Hall Kitchen', 29.648, -95.462, 15 * 60 + 30, 18 * 60 + 30, 80),
      mkPantry('p-faith', 'Community Hall Fridge', 29.670, -95.470, 16 * 60, 20 * 60, 120),
    ],
    households: [
      mkHousehold('h-supp-1', 'Supper club table 1', 6, []),
      mkHousehold('h-supp-2', 'Supper club table 2', 6, ['nut-free']),
      mkHousehold('h-veggie', 'Green household', 3, ['vegetarian']),
      mkHousehold('h-senior', 'Senior delivery route', 4, ['diabetic']),
    ],
  },
  {
    id: 'storm-outage',
    name: 'Storm Power-Outage Cold-Chain Triage',
    blurb: 'An overnight outage warmed three grocers\' reach-in cases. Every TCS lot is burning its four-hour budget. Triage, then drive fast.',
    ambientC: 32,
    startMin: 9 * 60,
    coldChainMaxMin: 75,
    vehicle: { capacityKg: 380, speedKmh: 34, serviceMin: 8 },
    depot: { name: 'Relief staging lot', lat: 29.735, lon: -95.355 },
    donors: [
      mkDonor('d-gro-1', 'Corner Grocer Cooler', 29.742, -95.348, 8 * 60 + 30, 11 * 60, [
        mkLot('l-yogurt', 'Yogurt tubs', 'dairy', 22, 70, 3, { allergens: ['dairy'], proteinG: 6, sugarG: 12 }),
        mkLot('l-deli', 'Deli meat packs', 'protein', 15, 50, 2.5, { tags: ['non-halal'], proteinG: 15, sodiumMg: 890 }),
      ]),
      mkDonor('d-gro-2', 'Market on Fifth', 29.728, -95.370, 8 * 60 + 30, 11 * 60 + 30, [
        mkLot('l-fish', 'Fish fillets on ice', 'protein', 19, 55, 3.5, { allergens: ['fish'], tags: ['halal'], proteinG: 17, sodiumMg: 210 }),
        mkLot('l-prepared-meals', 'Chilled meal boxes', 'prepared', 28, 60, 4, { tags: ['halal', 'meat'], proteinG: 13, sodiumMg: 610 }),
        mkLot('l-oj', 'Orange juice jugs', 'dairy', 16, 48, 5, { sugarG: 22 }),
      ]),
      mkDonor('d-gro-3', 'Freezer Barn Annex', 29.750, -95.335, 8 * 60 + 45, 12 * 60, [
        mkLot('l-frozen-veg', 'Frozen vegetable sacks', 'produce', 40, 120, 26, { tcs: true, fiberG: 3 }),
        mkLot('l-bread-annex', 'Bread racks', 'bakery', 18, 72, 80, { allergens: ['gluten'] }),
        mkLot('l-rice-bags', 'Rice and lentil bags', 'dry', 45, 160, 2400, { tags: ['halal', 'vegetarian'], proteinG: 8 }),
      ]),
    ],
    pantries: [
      mkPantry('p-shelter', 'Storm Shelter Kitchen', 29.746, -95.360, 8 * 60 + 30, 13 * 60, 140),
      mkPantry('p-mutual', 'Mutual Aid Hub', 29.720, -95.382, 9 * 60, 14 * 60, 160),
    ],
    households: [
      mkHousehold('h-shelter-a', 'Shelter wing A', 8, []),
      mkHousehold('h-shelter-b', 'Shelter wing B', 8, ['nut-free']),
      mkHousehold('h-halal-fam', 'Farah household', 4, ['halal']),
      mkHousehold('h-diab-out', 'Outreach van route', 3, ['diabetic']),
    ],
  },
  {
    id: 'thanksgiving-surge',
    name: 'Thanksgiving Pantry Surge',
    blurb: 'Holiday week: the food bank is flush with turkeys, roasts, dairy and dry goods, and every pantry in the network wants a share before Friday.',
    ambientC: 12,
    startMin: 8 * 60,
    coldChainMaxMin: 180,
    vehicle: { capacityKg: 500, speedKmh: 30, serviceMin: 15 },
    depot: { name: 'Regional food bank dock', lat: 29.760, lon: -95.370 },
    donors: [
      mkDonor('d-fb-frozen', 'Food Bank Freezer Row', 29.761, -95.371, 8 * 60, 12 * 60, [
        mkLot('l-turkeys', 'Frozen turkeys', 'protein', 120, 160, 400, { tags: ['halal'], proteinG: 19, sodiumMg: 180 }),
        mkLot('l-ham', 'Smoked hams', 'protein', 60, 90, 300, { tags: ['non-halal'], proteinG: 16, sodiumMg: 980 }),
      ]),
      mkDonor('d-fb-dairy', 'Food Bank Dairy Bay', 29.762, -95.368, 8 * 60, 12 * 60, [
        mkLot('l-milk-surge', 'Milk cases', 'dairy', 80, 240, 150, { allergens: ['dairy'], proteinG: 8 }),
        mkLot('l-butter', 'Butter and cream boxes', 'dairy', 24, 96, 200, { allergens: ['dairy'], proteinG: 1, sodiumMg: 90 }),
      ]),
      mkDonor('d-gro-chain', 'Grocery Chain Donation', 29.755, -95.390, 8 * 60 + 30, 11 * 60 + 30, [
        mkLot('l-stuffing', 'Stuffing and roll mix', 'dry', 55, 220, 3000, { allergens: ['gluten'] }),
        mkLot('l-cranberry', 'Canned cranberries', 'dry', 30, 120, 4000, { sugarG: 21 }),
        mkLot('l-sweet-pot', 'Sweet potato crates', 'produce', 48, 140, 170, { fiberG: 4 }),
      ]),
      mkDonor('d-bakery-hol', 'Holiday Bakery Run', 29.770, -95.350, 8 * 60 + 30, 10 * 60 + 30, [
        mkLot('l-pies', 'Pumpkin pies', 'bakery', 26, 80, 30, { allergens: ['gluten', 'dairy', 'egg'], sugarG: 19 }),
        mkLot('l-rolls-hol', 'Roll sleeves', 'bakery', 15, 90, 60, { allergens: ['gluten'] }),
      ]),
      mkDonor('d-garden-gle', 'Garden Gleaners Truck', 29.748, -95.342, 9 * 60, 12 * 60, [
        mkLot('l-greens-hol', 'Collard greens', 'produce', 22, 70, 50, { fiberG: 4 }),
        mkLot('l-squash', 'Winter squash', 'produce', 36, 90, 260, { fiberG: 3 }),
      ]),
    ],
    pantries: [
      mkPantry('p-north-pan', 'Northside Pantry', 29.778, -95.360, 8 * 60 + 30, 15 * 60, 220),
      mkPantry('p-river-pan', 'Riverbend Pantry', 29.740, -95.330, 8 * 60 + 30, 16 * 60, 180),
      mkPantry('p-faith-pan', 'Interfaith Kitchen', 29.765, -95.400, 9 * 60, 14 * 60, 200),
    ],
    households: [
      mkHousehold('h-hol-1', 'Vale household', 6, []),
      mkHousehold('h-hol-2', 'Marsh household', 4, ['gluten-free']),
      mkHousehold('h-hol-3', 'Sayed household', 5, ['halal']),
      mkHousehold('h-hol-4', 'Linn household', 2, ['diabetic', 'dairy-free']),
      mkHousehold('h-hol-5', 'Prado household', 7, ['nut-free']),
    ],
  },
]);

export function getScenario(id) {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new RangeError(`unknown scenario: ${id}`);
  return clone(found);
}

export function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// ---------- validation ----------

const num = (v) => Number.isFinite(v);
const arrOk = (v) => Array.isArray(v);

export function validateScenario(raw) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (raw == null || typeof raw !== 'object') return { ok: false, errors: ['scenario must be an object'] };
  const s = raw;
  if (typeof s.id !== 'string' || !s.id) fail('id required');
  if (typeof s.name !== 'string' || !s.name) fail('name required');
  if (!num(s.ambientC) || s.ambientC < -30 || s.ambientC > 60) fail('ambientC out of range');
  if (!num(s.startMin) || s.startMin < 0 || s.startMin >= 1440) fail('startMin out of range');
  if (s.coldChainMaxMin != null && (!num(s.coldChainMaxMin) || s.coldChainMaxMin <= 0)) fail('coldChainMaxMin invalid');
  const v = s.vehicle || {};
  if (!num(v.capacityKg) || v.capacityKg <= 0) fail('vehicle.capacityKg required');
  if (!num(v.speedKmh) || v.speedKmh <= 0) fail('vehicle.speedKmh required');
  if (s.depot == null || !num(s.depot.lat) || !num(s.depot.lon)) fail('depot lat/lon required');

  const ids = new Set();
  const checkPlace = (p, label) => {
    if (typeof p?.id !== 'string' || !p.id) fail(`${label} id required`);
    if (ids.has(p?.id)) fail(`duplicate id ${p?.id}`);
    ids.add(p?.id);
    if (!num(p.lat) || Math.abs(p.lat) > 90 || !num(p.lon) || Math.abs(p.lon) > 180) fail(`${p?.id} bad coordinates`);
    if (!num(p.openMin) || !num(p.closeMin) || p.openMin >= p.closeMin) fail(`${p?.id} bad time window`);
  };

  if (!arrOk(s.donors) || s.donors.length === 0) fail('at least one donor required');
  for (const d of s.donors || []) {
    checkPlace(d, 'donor');
    if (!arrOk(d.lots)) fail(`${d.id} lots must be an array`);
    for (const l of d.lots || []) {
      if (typeof l?.id !== 'string' || !l.id) fail(`lot in ${d.id} missing id`);
      if (ids.has(l?.id)) fail(`duplicate id ${l?.id}`);
      ids.add(l?.id);
      if (!CLASS_KEYS.includes(l?.category)) fail(`${l.id} bad category ${l.category}`);
      if (!num(l.kg) || l.kg <= 0) fail(`${l.id} kg must be > 0`);
      if (!num(l.servings) || l.servings <= 0) fail(`${l.id} servings must be > 0`);
      if (l.freshHours != null && (!num(l.freshHours) || l.freshHours < 0)) fail(`${l.id} freshHours invalid`);
      if (arrOk(l.allergens)) {
        for (const a of l.allergens) if (!ALLERGENS.includes(a)) fail(`${l.id} unknown allergen ${a}`);
      } else if (l.allergens != null) fail(`${l.id} allergens must be an array`);
    }
  }
  if (!arrOk(s.pantries) || s.pantries.length === 0) fail('at least one pantry required');
  for (const p of s.pantries || []) {
    checkPlace(p, 'pantry');
    if (!num(p.capacityKg) || p.capacityKg <= 0) fail(`${p.id} capacityKg must be > 0`);
  }
  if (!arrOk(s.households)) fail('households must be an array');
  for (const h of s.households || []) {
    if (typeof h?.id !== 'string' || !h.id) fail('household id required');
    if (!num(h.size) || h.size < 1 || h.size > 30) fail(`${h.id} size invalid`);
    if (arrOk(h.constraints)) {
      for (const c of h.constraints) if (!CONSTRAINTS.includes(c)) fail(`${h.id} unknown constraint ${c}`);
    } else if (h.constraints != null) fail(`${h.id} constraints must be an array`);
  }
  return { ok: errors.length === 0, errors, scenario: s };
}

// ---------- JSON / hash codecs ----------

function b64urlEncode(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const std = b64.replaceAll('-', '+').replaceAll('_', '/') + pad;
  if (typeof Buffer !== 'undefined') return Buffer.from(std, 'base64').toString('utf8');
  const bin = atob(std);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Serialize the whole app state { scenario, params } into a URL hash token.
export function encodeState(state) {
  return b64urlEncode(JSON.stringify(state));
}

// Parse a hash token. Returns { ok, state, errors }; never throws.
export function decodeState(token) {
  try {
    if (typeof token !== 'string' || token.length === 0) return { ok: false, errors: ['empty token'] };
    const clean = token.startsWith('#') ? token.slice(1) : token;
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(clean)) return { ok: false, errors: ['bad encoding'] };
    const parsed = JSON.parse(b64urlDecode(clean));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, errors: ['not a state object'] };
    if (!('scenario' in parsed) && !('scenarioId' in parsed) && !('params' in parsed) && !('ui' in parsed)) {
      return { ok: false, errors: ['no state keys'] };
    }
    if (parsed.scenario != null) {
      const v = validateScenario(parsed.scenario);
      if (!v.ok) return { ok: false, errors: v.errors };
    }
    return { ok: true, state: parsed };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  }
}

export function exportStateJSON(state) {
  return JSON.stringify(state, null, 2);
}

// ---------- CSV codecs ----------
// One flat CSV describes a whole scenario. Record kinds:
//   meta,ambientC,startMin,capacityKg,speedKmh,serviceMin,coldChainMaxMin
//   depot,name,lat,lon
//   donor,id,name,lat,lon,openMin,closeMin
//   pantry,id,name,lat,lon,openMin,closeMin,capacityKg
//   household,id,name,size,constraints(;)
//   lot,donorId,id,name,category,kg,servings,freshHours,tempC,allergens(;),tags(;),proteinG,fiberG,sodiumMg,sugarG

export function csvEscape(field) {
  const s = field == null ? '' : String(field);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export function scenarioToCSV(s) {
  const lines = [];
  const v = s.vehicle || {};
  lines.push(['meta', s.ambientC, s.startMin, v.capacityKg, v.speedKmh, v.serviceMin, s.coldChainMaxMin].map(csvEscape).join(','));
  lines.push(['depot', s.depot?.name || 'Depot', s.depot?.lat, s.depot?.lon].map(csvEscape).join(','));
  for (const d of s.donors || []) {
    lines.push(['donor', d.id, d.name, d.lat, d.lon, d.openMin, d.closeMin].map(csvEscape).join(','));
    for (const l of d.lots || []) {
      lines.push([
        'lot', d.id, l.id, l.name, l.category, l.kg, l.servings, l.freshHours,
        l.tempC ?? '', (l.allergens || []).join(';'), (l.tags || []).join(';'),
        l.proteinG ?? 0, l.fiberG ?? 0, l.sodiumMg ?? 0, l.sugarG ?? 0,
      ].map(csvEscape).join(','));
    }
  }
  for (const p of s.pantries || []) {
    lines.push(['pantry', p.id, p.name, p.lat, p.lon, p.openMin, p.closeMin, p.capacityKg].map(csvEscape).join(','));
  }
  for (const h of s.households || []) {
    lines.push(['household', h.id, h.name, h.size, (h.constraints || []).join(';')].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

const toNum = (x) => (x === '' || x == null ? undefined : Number(x));
const list = (x) => (x || '').split(';').map((t) => t.trim()).filter(Boolean);

export function scenarioFromCSV(text) {
  const rows = parseCSV(text).filter((r) => r.length && r[0] !== 'kind');
  const s = { id: 'custom', name: 'Custom lot', donors: [], pantries: [], households: [] };
  const donorById = new Map();
  const errors = [];
  for (const r of rows) {
    const kind = r[0];
    try {
      if (kind === 'meta') {
        s.ambientC = toNum(r[1]);
        s.startMin = toNum(r[2]);
        s.vehicle = { capacityKg: toNum(r[3]), speedKmh: toNum(r[4]), serviceMin: toNum(r[5]) };
        s.coldChainMaxMin = toNum(r[6]);
      } else if (kind === 'depot') {
        s.depot = { name: r[1] || 'Depot', lat: toNum(r[2]), lon: toNum(r[3]) };
      } else if (kind === 'donor') {
        const d = { id: r[1], name: r[2], lat: toNum(r[3]), lon: toNum(r[4]), openMin: toNum(r[5]), closeMin: toNum(r[6]), lots: [] };
        s.donors.push(d); donorById.set(d.id, d);
      } else if (kind === 'pantry') {
        s.pantries.push({ id: r[1], name: r[2], lat: toNum(r[3]), lon: toNum(r[4]), openMin: toNum(r[5]), closeMin: toNum(r[6]), capacityKg: toNum(r[7]) });
      } else if (kind === 'household') {
        s.households.push({ id: r[1], name: r[2], size: toNum(r[3]), constraints: list(r[4]) });
      } else if (kind === 'lot') {
        const d = donorById.get(r[1]);
        if (!d) { errors.push(`lot ${r[2]} references missing donor ${r[1]}`); continue; }
        d.lots.push({
          id: r[2], name: r[3], category: r[4], kg: toNum(r[5]), servings: toNum(r[6]),
          freshHours: toNum(r[7]), tempC: toNum(r[8]),
          allergens: list(r[9]), tags: list(r[10]),
          proteinG: toNum(r[11]) ?? 0, fiberG: toNum(r[12]) ?? 0,
          sodiumMg: toNum(r[13]) ?? 0, sugarG: toNum(r[14]) ?? 0,
        });
      } else {
        errors.push(`unknown record kind: ${kind}`);
      }
    } catch (err) {
      errors.push(`${kind}: ${err.message}`);
    }
  }
  if (!s.name || s.name === 'Custom lot') s.name = 'Custom scenario';
  const v = validateScenario(s);
  return { ok: errors.length === 0 && v.ok, errors: [...errors, ...v.errors], scenario: v.ok ? s : undefined };
}

// Simpler lot-only CSV for the inventory editor (no donor column needed:
// caller chooses the target donor).
export function lotsToCSV(lots) {
  const lines = ['name,category,kg,servings,freshHours,tempC,allergens,tags,proteinG,fiberG,sodiumMg,sugarG'];
  for (const l of lots) {
    lines.push([
      l.name, l.category, l.kg, l.servings, l.freshHours, l.tempC ?? '',
      (l.allergens || []).join(';'), (l.tags || []).join(';'),
      l.proteinG ?? 0, l.fiberG ?? 0, l.sodiumMg ?? 0, l.sugarG ?? 0,
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function lotsFromCSV(text, idPrefix = 'lot') {
  const rows = parseCSV(text).filter((r) => r.length > 1);
  if (rows.length === 0) return { ok: false, errors: ['no rows'], lots: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('name') && header.includes('category');
  const data = hasHeader ? rows.slice(1) : rows;
  const cols = hasHeader ? header : ['name', 'category', 'kg', 'servings', 'freshhours', 'tempc', 'allergens', 'tags', 'proteing', 'fiberg', 'sodiummg', 'sugarg'];
  const lots = [];
  const errors = [];
  data.forEach((r, i) => {
    const cell = (k) => {
      const idx = cols.indexOf(k);
      return idx < 0 ? '' : r[idx];
    };
    const lot = {
      id: `${idPrefix}-${i + 1}`,
      name: cell('name') || `Lot ${i + 1}`,
      category: cell('category'),
      kg: toNum(cell('kg')),
      servings: toNum(cell('servings')),
      freshHours: toNum(cell('freshhours')),
      tempC: toNum(cell('tempc')),
      allergens: list(cell('allergens')),
      tags: list(cell('tags')),
      proteinG: toNum(cell('proteing')) ?? 0,
      fiberG: toNum(cell('fiberg')) ?? 0,
      sodiumMg: toNum(cell('sodiummg')) ?? 0,
      sugarG: toNum(cell('sugarg')) ?? 0,
    };
    if (!CLASS_KEYS.includes(lot.category)) { errors.push(`row ${i + 1}: bad category`); return; }
    if (!num(lot.kg) || lot.kg <= 0 || !num(lot.servings) || lot.servings <= 0) { errors.push(`row ${i + 1}: kg/servings invalid`); return; }
    lots.push(lot);
  });
  return { ok: errors.length === 0, errors, lots };
}

// All donor lots of a scenario, flattened with their donor id attached.
export function allLots(scenario) {
  const out = [];
  for (const d of scenario.donors || []) {
    for (const l of d.lots || []) out.push({ ...l, donorId: d.id });
  }
  return out;
}
