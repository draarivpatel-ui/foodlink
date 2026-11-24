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
    shelfNote: 'Life left is counted in hours at 5 C, the FDA cold-holding limit. Spoils in is the time left if the lot keeps sitting at the current ambient temperature, capped by the 4-hour danger-zone clock for TCS foods.',
    simBadge: 'Offline simulation, deterministic, no network calls',
    outcomeTitle: 'Dispatch outcome',
    servingsLabel: 'Servings delivered',
    marginLabel: 'Tightest cold-chain margin',
    marginSub: '{lot}: {transit} of {budget} min in transit',
    marginNone: 'No TCS lots delivered on this route',
    lifeAtRef: '{t} at 5 C',
    spoilsIn: 'Spoils in {t} at {c} C',
    legendStop: 'stop order',
    closeLabel: 'Close',
    spoiledDanger: 'Discard: 4-hour danger-zone limit reached',
    spoiledAge: 'Discard: shelf life used up',
    leftoverNote: '{n} delivered lots still hold {kg} kg not packed into any household box.',
    tabBoard: 'Volunteer board',
    howButton: 'How it works',
    howTitle: 'How FoodLink works',
    boardTitle: 'Volunteer board',
    runTitle: 'Run {n}',
    runOpen: 'Needs a driver',
    runClaimed: '{name} is driving',
    runRelay: '{name} took over from {from}',
    runHandoff: '{name} needs someone to take over',
    claimButton: 'Claim run',
    handoffButton: 'Ask for hand-off',
    takeOverButton: 'Take over',
    releaseButton: 'Release',
    namePlaceholder: 'First name',
    nameLabel: 'Volunteer first name for run {n}',
    errNameRequired: 'Type a first name first.',
    errAlreadyClaimed: 'Someone already has this run.',
    errGeneric: 'That did not work. The plan may have changed.',
    coverageLabel: 'Runs with a driver',
    coveredKgLabel: 'Food with a driver',
    householdsLabel: 'Households with a box',
    peopleLabel: 'Neighbors reached',
    runSpoils: 'Spoils in {t} if it waits',
    runMargin: '{m} min cold-chain margin',
    runNoPantry: 'Ends without a drop-off',
    runStops: 'Stops',
    copyBrief: 'Copy brief',
    briefCopied: 'Brief copied',
    downloadBriefJson: 'Download JSON',
    printBrief: 'Print brief',
    briefTitle: 'Neighborhood volunteer brief',
    briefCoverage: '{covered} of {total} runs have a driver. {kg} of {totalKg} kg is covered.',
    briefReach: '{households} households ({people} people) get a balanced box. {servings} servings in all.',
    briefStatusOpen: 'OPEN, needs a driver',
    briefStatusClaimed: 'driver {name}',
    briefStatusRelay: 'driver {name} (took over from {from})',
    briefStatusHandoff: 'hand-off needed, {name} is stepping away',
    briefNeeds: 'Still needed: {list}.',
    briefAllCovered: 'Every run has a driver.',
    orphanNote: 'The route changed, so {n} earlier claim(s) no longer match a run: {names}.',
    clearOrphans: 'Clear',
    coverageInline: '{covered} of {total} runs have a driver',
    openBoard: 'Open volunteer board',
    ambientShort: 'Ambient',
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
    shelfNote: 'La vida restante se cuenta en horas a 5 C, el límite de refrigeración de la FDA. Se echa a perder en indica el tiempo que queda si el lote sigue a la temperatura ambiente actual, con el tope del reloj de 4 horas en zona de peligro para alimentos TCS.',
    simBadge: 'Simulación sin conexión, determinista, sin llamadas de red',
    outcomeTitle: 'Resultado del despacho',
    servingsLabel: 'Porciones entregadas',
    marginLabel: 'Margen de cadena de frío más ajustado',
    marginSub: '{lot}: {transit} de {budget} min en tránsito',
    marginNone: 'Ningún lote TCS entregado en esta ruta',
    lifeAtRef: '{t} a 5 C',
    spoilsIn: 'Se echa a perder en {t} a {c} C',
    legendStop: 'orden de parada',
    closeLabel: 'Cerrar',
    spoiledDanger: 'Desechar: se alcanzó el límite de 4 horas en zona de peligro',
    spoiledAge: 'Desechar: vida útil agotada',
    leftoverNote: '{n} lotes entregados aún tienen {kg} kg sin asignar a ninguna caja familiar.',
    tabBoard: 'Tablero de voluntarios',
    howButton: 'Cómo funciona',
    howTitle: 'Cómo funciona FoodLink',
    boardTitle: 'Tablero de voluntarios',
    runTitle: 'Tramo {n}',
    runOpen: 'Necesita conductor',
    runClaimed: '{name} conduce',
    runRelay: '{name} relevó a {from}',
    runHandoff: '{name} necesita relevo',
    claimButton: 'Tomar tramo',
    handoffButton: 'Pedir relevo',
    takeOverButton: 'Tomar relevo',
    releaseButton: 'Liberar',
    namePlaceholder: 'Nombre',
    nameLabel: 'Nombre del voluntario para el tramo {n}',
    errNameRequired: 'Escribe un nombre primero.',
    errAlreadyClaimed: 'Alguien ya tiene este tramo.',
    errGeneric: 'No funcionó. Puede que el plan haya cambiado.',
    coverageLabel: 'Tramos con conductor',
    coveredKgLabel: 'Alimento con conductor',
    householdsLabel: 'Hogares con caja',
    peopleLabel: 'Vecinos alcanzados',
    runSpoils: 'Se echa a perder en {t} si espera',
    runMargin: '{m} min de margen de frío',
    runNoPantry: 'Termina sin entrega',
    runStops: 'Paradas',
    copyBrief: 'Copiar resumen',
    briefCopied: 'Resumen copiado',
    downloadBriefJson: 'Descargar JSON',
    printBrief: 'Imprimir resumen',
    briefTitle: 'Resumen vecinal de voluntarios',
    briefCoverage: '{covered} de {total} tramos tienen conductor. {kg} de {totalKg} kg están cubiertos.',
    briefReach: '{households} hogares ({people} personas) reciben una caja balanceada. {servings} porciones en total.',
    briefStatusOpen: 'ABIERTO, necesita conductor',
    briefStatusClaimed: 'conduce {name}',
    briefStatusRelay: 'conduce {name} (relevó a {from})',
    briefStatusHandoff: 'se necesita relevo, {name} se retira',
    briefNeeds: 'Aún se necesita: {list}.',
    briefAllCovered: 'Todos los tramos tienen conductor.',
    orphanNote: 'La ruta cambió, así que {n} asignación(es) anteriores ya no coinciden con un tramo: {names}.',
    clearOrphans: 'Borrar',
    coverageInline: '{covered} de {total} tramos tienen conductor',
    openBoard: 'Abrir tablero',
    ambientShort: 'Ambiente',
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

// Content of the "How it works" drawer. Same structure in both languages:
// each section has a heading and either paragraphs or a list of
// { term, text } rows. Every number here matches a constant in src/.
const EXPLAINER = Object.freeze({
  en: [
    { h: 'The problem', p: [
      'Food rescue runs on three clocks at once. Produce wilts at room temperature, cold food has a four-hour danger-zone budget, and pantries close. Most volunteer crews juggle all three in a group chat.',
      'FoodLink puts the three clocks on one screen and turns the plan into short runs that neighbors can claim, hand off and share.',
    ] },
    { h: 'How a plan is made', rows: [
      { term: 'Spoilage clock', text: 'Each lot ages with a Q10 temperature model anchored at the FDA cold-holding limit of 41 F (5 C). Foods that need temperature control also add up danger-zone minutes above 41 F, and four hours in total means discard.' },
      { term: 'Route solver', text: 'Up to 8 stops it tries every stop order. Beyond that it builds a nearest-neighbor route and improves it with 2-opt. Van capacity, donor and pantry hours, and a per-lot cold-chain budget all have to hold.' },
      { term: 'Box allocator', text: 'Delivered food is packed into household boxes against food-group targets per person, while honoring gluten-free, nut-free, dairy-free, halal, vegetarian and diabetic needs.' },
      { term: 'Volunteer board', text: 'The route is split into runs that each end at a pantry, so the van can change hands there. Neighbors claim a run, ask for a hand-off or take one over, and the claims travel inside the share link.' },
    ] },
    { h: 'The numbers behind it', rows: [
      { term: '41 F / 5 C', text: 'FDA Food Code cold holding' },
      { term: '135 F / 57 C', text: 'FDA Food Code hot holding' },
      { term: '4 hours', text: 'Total danger-zone time before food that needs temperature control is discarded' },
      { term: '0.595 kg CO2e', text: 'Landfill emissions avoided per kg donated, from the EPA WARM v15 low-end food-donation factor of 0.54 t per short ton' },
    ] },
    { h: 'What building it taught', p: [
      'Danger-zone time adds up across every stop, so the shortest route can still spoil the milk. The solver treats spoilage as lost food, not as a footnote.',
      'Exact search is cheap at neighborhood scale, so approximation is only the fallback.',
      'Allergies, diets and faith rules each need their own logic. One yes or no flag gets households hurt.',
    ] },
    { h: 'How it was built', p: [
      'Plain HTML, CSS and JavaScript modules with no dependencies and no network calls. Every engine is covered by Node tests, and the Run self-tests button runs the same checks in this page.',
      'AI coding assistants (Devin SWE-2 and Claude) helped write the code, tests and docs under Aariv Patel\'s direction. All places, lots and households are fictional.',
    ] },
  ],
  es: [
    { h: 'El problema', p: [
      'El rescate de alimentos corre contra tres relojes. Los productos frescos se marchitan a temperatura ambiente, la comida fría tiene un límite de cuatro horas en la zona de peligro y las despensas cierran. La mayoría de los equipos voluntarios coordina todo en un chat.',
      'FoodLink muestra los tres relojes en una pantalla y divide el plan en tramos cortos que los vecinos pueden tomar, relevar y compartir.',
    ] },
    { h: 'Cómo se arma un plan', rows: [
      { term: 'Reloj de deterioro', text: 'Cada lote envejece con un modelo de temperatura Q10 anclado al límite de refrigeración de la FDA de 41 F (5 C). Los alimentos que requieren control de temperatura además suman minutos en zona de peligro por encima de 41 F, y cuatro horas en total significan desechar.' },
      { term: 'Planificador de ruta', text: 'Con hasta 8 paradas prueba todos los órdenes posibles. Con más, arma una ruta del vecino más cercano y la mejora con 2-opt. Deben cumplirse la capacidad de la camioneta, los horarios de donantes y despensas, y el límite de cadena de frío de cada lote.' },
      { term: 'Asignador de cajas', text: 'Los alimentos entregados se reparten en cajas familiares según metas por grupo de alimentos por persona, respetando necesidades sin gluten, sin nueces, sin lácteos, halal, vegetarianas y para diabetes.' },
      { term: 'Tablero de voluntarios', text: 'La ruta se divide en tramos que terminan en una despensa, para que la camioneta cambie de manos ahí. Los vecinos toman un tramo, piden relevo o relevan a otro, y las asignaciones viajan dentro del enlace.' },
    ] },
    { h: 'Los números', rows: [
      { term: '41 F / 5 C', text: 'Refrigeración según el Código de Alimentos de la FDA' },
      { term: '135 F / 57 C', text: 'Mantenimiento en caliente según el Código de Alimentos de la FDA' },
      { term: '4 horas', text: 'Tiempo total en zona de peligro antes de desechar alimentos que requieren control de temperatura' },
      { term: '0.595 kg CO2e', text: 'Emisiones de vertedero evitadas por kg donado, del factor bajo de donación de alimentos EPA WARM v15 de 0.54 t por tonelada corta' },
    ] },
    { h: 'Lo que enseñó construirlo', p: [
      'El tiempo en zona de peligro se suma en cada parada, así que la ruta más corta igual puede echar a perder la leche. El planificador cuenta el deterioro como comida perdida.',
      'La búsqueda exacta es barata a escala de vecindario, así que la aproximación es solo el respaldo.',
      'Alergias, dietas y reglas de fe necesitan cada una su propia lógica. Una sola casilla de sí o no pone en riesgo a los hogares.',
    ] },
    { h: 'Cómo se construyó', p: [
      'HTML, CSS y módulos de JavaScript sin dependencias ni llamadas de red. Cada motor tiene pruebas en Node, y el botón Autopruebas ejecuta las mismas comprobaciones en esta página.',
      'Asistentes de programación con IA (Devin SWE-2 y Claude) ayudaron a escribir el código, las pruebas y la documentación bajo la dirección de Aariv Patel. Todos los lugares, lotes y hogares son ficticios.',
    ] },
  ],
});

export function explainer(lang = 'en') {
  return EXPLAINER[lang] || EXPLAINER.en;
}

export { formatHours };
