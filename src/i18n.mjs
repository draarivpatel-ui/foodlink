// FoodLink i18n and print-sheet text.
// English and Spanish dictionaries, a t() lookup with {param} interpolation,
// the volunteer dispatch manifest text, and the food-donation safety
// checklist (anchored on the Bill Emerson Good Samaritan Food Donation Act).

import { formatHours } from './spoilage.mjs';

export const LANGS = Object.freeze(['en', 'es']);

export const STRINGS = Object.freeze({
  en: {
    appTitle: 'FoodLink',
    tabDispatch: 'Dispatch map',
    tabShelf: 'Shelf-life triage',
    tabBoxes: 'Household boxes',
    tabManifest: 'Manifest & checklist',
    tabData: 'Data & sharing',
    scenarioLabel: 'Scenario',
    ambientLabel: 'Ambient temp',
    elapsedLabel: 'Elapsed time',
    capacityLabel: 'Vehicle capacity',
    speedLabel: 'Vehicle speed',
    coldChainLabel: 'Cold-chain budget',
    langButton: 'ES',
    themeButton: 'Theme',
    selfTestButton: 'Run self-tests',
    selfTestTitle: 'Self-tests',
    printButton: 'Print manifest',
    kmUnit: 'km',
    minUnit: 'min',
    hUnit: 'h',
    kgUnit: 'kg',
    rescuedLabel: 'Food rescued',
    spoiledLabel: 'Lost to spoilage',
    co2Label: 'Landfill emissions avoided',
    co2Sub: 'EPA WARM v15 donation guidance, low-end: 0.54 t CO2e per short ton (0.595 kg per kg)',
    routeMethod: 'Solver',
    routeTime: 'Route time',
    routeKm: 'Route distance',
    stopsPlanned: 'Planned stops',
    pickup: 'Pickup',
    dropoff: 'Drop-off',
    waitLabel: 'wait',
    windowLabel: 'window',
    tierCritical: 'Critical',
    tierHigh: 'High',
    tierWatch: 'Watch',
    tierStable: 'Stable',
    tierSpoiled: 'Spoiled',
    lifeLeft: 'Life left',
    dangerUsed: 'Danger-zone clock',
    categoryLabel: 'Class',
    lotName: 'Lot',
    donorLabel: 'Donor',
    pantryLabel: 'Pantry',
    depotLabel: 'Depot',
    householdLabel: 'Household',
    constraintsLabel: 'Constraints',
    unmetLabel: 'Unmet groups',
    servingsUnit: 'servings',
    balanceLabel: 'Box balance',
    totalsLabel: 'Box totals',
    proteinG: 'Protein',
    fiberG: 'Fiber',
    sodiumMg: 'Sodium',
    sugarG: 'Sugar',
    gUnit: 'g',
    mgUnit: 'mg',
    manifestTitle: 'Volunteer dispatch manifest',
    manifestIntro: 'Stops in planned order. All times are local clock minutes.',
    manifestStop: 'Stop',
    manifestArrive: 'arrive',
    manifestDepart: 'depart',
    manifestLoad: 'on board',
    manifestPicked: 'picked',
    manifestDelivered: 'delivered',
    manifestSpoiled: 'spoiled on arrival',
    checklistTitle: 'Donation safety checklist',
    dataTitle: 'Data and sharing',
    jsonExport: 'Export JSON',
    csvExport: 'Export scenario CSV',
    copyLink: 'Copy share link',
    linkCopied: 'Link copied',
    importLabel: 'Import JSON or CSV',
    importButton: 'Import',
    resetButton: 'Reset scenario',
    addLotTitle: 'Add a lot to a donor',
    addLotButton: 'Add lot',
    fieldName: 'Name',
    fieldCategory: 'Category',
    fieldKg: 'kg',
    fieldServings: 'Servings',
    fieldFresh: 'Fresh hours at 5 C',
    fieldAllergens: 'Allergens',
    fieldTags: 'Tags',
    shareNote: 'The whole workbench state rides in the URL hash. No server sees it.',
    fictionNote: 'All places, lots and households are fictional teaching examples.',
    emptyManifest: 'No feasible route. Widen windows, raise capacity or shorten the chain budget.',
    noneLabel: 'none',
    minutesShort: 'min',
    scenarioCustom: 'Custom scenario',
    lotEditorDonor: 'Target donor',
    legendDonor: 'donor',
    legendPantry: 'pantry',
    legendRoute: 'route',
    legendDepot: 'depot',
    elapsedNow: 'now',
    dangerBudgetNote: 'FDA 4-hour TCS budget',
    shelfNote: 'Life remaining at current ambient temperature',
  },
  es: {
    appTitle: 'FoodLink',
    tabDispatch: 'Mapa de despacho',
    tabShelf: 'Triage de vida útil',
    tabBoxes: 'Cajas familiares',
    tabManifest: 'Manifiesto y lista',
    tabData: 'Datos y compartir',
    scenarioLabel: 'Escenario',
    ambientLabel: 'Temp. ambiente',
    elapsedLabel: 'Tiempo transcurrido',
    capacityLabel: 'Capacidad del vehículo',
    speedLabel: 'Velocidad',
    coldChainLabel: 'Límite de cadena de frío',
    langButton: 'EN',
    themeButton: 'Tema',
    selfTestButton: 'Autopruebas',
    selfTestTitle: 'Autopruebas',
    printButton: 'Imprimir manifiesto',
    kmUnit: 'km',
    minUnit: 'min',
    hUnit: 'h',
    kgUnit: 'kg',
    rescuedLabel: 'Alimento rescatado',
    spoiledLabel: 'Perdido por deterioro',
    co2Label: 'Emisiones de vertedero evitadas',
    co2Sub: 'Guía de donación EPA WARM v15, estimación baja: 0.54 t CO2e por tonelada corta (0.595 kg por kg)',
    routeMethod: 'Solucionador',
    routeTime: 'Tiempo de ruta',
    routeKm: 'Distancia de ruta',
    stopsPlanned: 'Paradas planeadas',
    pickup: 'Recolección',
    dropoff: 'Entrega',
    waitLabel: 'espera',
    windowLabel: 'horario',
    tierCritical: 'Crítico',
    tierHigh: 'Alto',
    tierWatch: 'Vigilar',
    tierStable: 'Estable',
    tierSpoiled: 'Echado a perder',
    lifeLeft: 'Vida restante',
    dangerUsed: 'Reloj de zona de peligro',
    categoryLabel: 'Clase',
    lotName: 'Lote',
    donorLabel: 'Donante',
    pantryLabel: 'Despensa',
    depotLabel: 'Base',
    householdLabel: 'Hogar',
    constraintsLabel: 'Restricciones',
    unmetLabel: 'Grupos sin cubrir',
    servingsUnit: 'porciones',
    balanceLabel: 'Balance de caja',
    totalsLabel: 'Totales de caja',
    proteinG: 'Proteína',
    fiberG: 'Fibra',
    sodiumMg: 'Sodio',
    sugarG: 'Azúcar',
    gUnit: 'g',
    mgUnit: 'mg',
    manifestTitle: 'Manifiesto de despacho de voluntarios',
    manifestIntro: 'Paradas en orden planeado. Tiempos en minutos del reloj local.',
    manifestStop: 'Parada',
    manifestArrive: 'llegada',
    manifestDepart: 'salida',
    manifestLoad: 'a bordo',
    manifestPicked: 'recogido',
    manifestDelivered: 'entregado',
    manifestSpoiled: 'echado a perder al llegar',
    checklistTitle: 'Lista de seguridad para donaciones',
    dataTitle: 'Datos y compartir',
    jsonExport: 'Exportar JSON',
    csvExport: 'Exportar CSV del escenario',
    copyLink: 'Copiar enlace',
    linkCopied: 'Enlace copiado',
    importLabel: 'Importar JSON o CSV',
    importButton: 'Importar',
    resetButton: 'Restablecer escenario',
    addLotTitle: 'Agregar lote a un donante',
    addLotButton: 'Agregar lote',
    fieldName: 'Nombre',
    fieldCategory: 'Categoría',
    fieldKg: 'kg',
    fieldServings: 'Porciones',
    fieldFresh: 'Horas frescura a 5 C',
    fieldAllergens: 'Alérgenos',
    fieldTags: 'Etiquetas',
    shareNote: 'Todo el estado viaja en el hash de la URL. Ningún servidor lo ve.',
    fictionNote: 'Todos los lugares, lotes y hogares son ejemplos ficticios.',
    emptyManifest: 'Sin ruta factible. Amplíe horarios, suba la capacidad o ajuste la cadena de frío.',
    noneLabel: 'ninguna',
    minutesShort: 'min',
    scenarioCustom: 'Escenario personalizado',
    lotEditorDonor: 'Donante destino',
    legendDonor: 'donante',
    legendPantry: 'despensa',
    legendRoute: 'ruta',
    legendDepot: 'base',
    elapsedNow: 'ahora',
    dangerBudgetNote: 'Presupuesto FDA de 4 h para TCS',
    shelfNote: 'Vida restante a la temperatura ambiente actual',
  },
});

export function interpolate(s, params) {
  if (!params) return s;
  let out = s;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export function t(lang, key, params) {
  const dict = STRINGS[lang] || STRINGS.en;
  const s = dict[key] ?? STRINGS.en[key] ?? key;
  return interpolate(s, params);
}

// Keys present in one language but missing in the other.
export function keyParity() {
  const en = new Set(Object.keys(STRINGS.en));
  const es = new Set(Object.keys(STRINGS.es));
  return {
    missingInEs: [...en].filter((k) => !es.has(k)),
    missingInEn: [...es].filter((k) => !en.has(k)),
  };
}

const clock = (min) => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Plain-text dispatch manifest for the print sheet.
export function manifestLines(plan, scenario, lang = 'en') {
  const L = (k) => t(lang, k);
  const lines = [];
  lines.push(`${L('appTitle')} | ${L('manifestTitle')}`);
  lines.push(`${scenario.name} | ${L('manifestIntro')}`);
  lines.push('');
  if (!plan?.visits?.length) {
    lines.push(L('emptyManifest'));
    return lines;
  }
  plan.visits.forEach((v, i) => {
    const stop = plan.order[i]?.ref || {};
    const head = `${L('manifestStop')} ${i + 1}: ${stop.name || v.stopId} (${v.kind === 'donor' ? L('pickup') : L('dropoff')})`;
    lines.push(head);
    lines.push(`  ${L('manifestArrive')} ${clock(v.arrive)}  ${L('manifestDepart')} ${clock(v.depart)}${v.wait > 0 ? `  ${L('waitLabel')} ${Math.round(v.wait)} ${L('minutesShort')}` : ''}`);
    if (v.picked?.length) lines.push(`  ${L('manifestPicked')}: ${v.picked.join(', ')}  |  ${L('manifestLoad')} ${Math.round(v.loadKg)} ${L('kgUnit')}`);
    if (v.delivered?.length) lines.push(`  ${L('manifestDelivered')}: ${v.delivered.join(', ')}`);
    if (v.spoiledOnArrival?.length) lines.push(`  ${L('manifestSpoiled')}: ${v.spoiledOnArrival.join(', ')}`);
  });
  lines.push('');
  lines.push(`${L('routeKm')}: ${plan.km.toFixed(1)} ${L('kmUnit')} | ${L('routeTime')}: ${Math.round(plan.totalMinutes)} ${L('minutesShort')} | ${L('rescuedLabel')}: ${plan.rescuedKg} ${L('kgUnit')}`);
  return lines;
}

// Food-donation safety checklist grounded in the Bill Emerson Good
// Samaritan Food Donation Act plus ordinary cold-chain practice.
const CHECKLIST = Object.freeze({
  en: [
    'Donate only food that is apparently wholesome: sound, unopened or properly covered, and fit to eat.',
    'The Bill Emerson Good Samaritan Food Donation Act protects good-faith donors and nonprofits from liability, except in cases of gross negligence or intentional misconduct.',
    'Keep time/temperature control for safety (TCS) food at 41 F / 5 C or below, or at 135 F / 57 C or above.',
    'Track cumulative time in the danger zone. Discard TCS food after 4 hours total between 41 F and 135 F.',
    'Label every lot with its pickup time so the pantry can check transit time against the cold-chain budget.',
    'Record allergens on every container and read constraints before packing a household box.',
    'Use clean, food-grade containers and keep raw animal products separate from ready-to-eat food.',
    'When in doubt, throw it out: a lot that smells, leaks or has passed its date does not get donated.',
  ],
  es: [
    'Done solo alimentos aparentemente sanos: en buen estado, sin abrir o bien cubiertos, y aptos para comer.',
    'La Ley Bill Emerson de Donación de Alimentos de Buen Samaritano protege a donantes y organizaciones de buena fe, salvo negligencia grave o mala conducta intencional.',
    'Mantenga los alimentos TCS a 41 F / 5 C o menos, o a 135 F / 57 C o más.',
    'Sume el tiempo en la zona de peligro. Deseche alimentos TCS tras 4 horas en total entre 41 F y 135 F.',
    'Etiquete cada lote con su hora de recolección para comparar el tránsito con el límite de cadena de frío.',
    'Anote los alérgenos en cada envase y revise las restricciones antes de armar una caja familiar.',
    'Use envases limpios aptos para alimentos y separe productos crudos de origen animal de la comida lista para comer.',
    'Ante la duda, deséchelo: un lote con mal olor, fugas o fecha vencida no se dona.',
  ],
});

export function checklist(lang = 'en') {
  return CHECKLIST[lang] || CHECKLIST.en;
}

export { formatHours };
