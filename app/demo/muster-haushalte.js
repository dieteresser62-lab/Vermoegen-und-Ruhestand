// Ohne Engine ladbar: Auswahl und Namen werden auch beim Seitenstart gebraucht.
export const MUSTER_HAUSHALTE = Object.freeze([
    Object.freeze({ id: 'max-erika', name: 'Max und Erika', title: 'Gemeinsam in den Ruhestand' }),
    Object.freeze({ id: 'renate', name: 'Renate', title: 'Kleine Rente, laufender Vermögensverzehr' }),
    Object.freeze({ id: 'jan-lena', name: 'Jan und Lena', title: 'Früher aufhören und die Rentenlücke überbrücken' }),
    Object.freeze({ id: 'helga-werner', name: 'Helga und Werner', title: 'Ruhestand mit Pflegevorsorge' }),
    Object.freeze({ id: 'sophie', name: 'Sophie', title: 'Die letzten Berufsjahre bewusst gestalten' }),
    Object.freeze({ id: 'martin-petra', name: 'Martin und Petra', title: 'Unverheiratet, ungleiches Vermögen, Haus und vermietete Wohnung' })
]);
export const DEFAULT_MUSTER_HAUSHALT = MUSTER_HAUSHALTE[0].id;
export const HANDBOOK_MUSTER_DATE = '2026-10-23';

/**
 * @param {string} [householdId]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function musterHaushalt(householdId = DEFAULT_MUSTER_HAUSHALT) {
    const household = MUSTER_HAUSHALTE.find(entry => entry.id === householdId);
    if (!household) throw new Error('Beschädigter Spielbereich-Zustand: unbekannter Beispielhaushalt. Bitte den Spielbereich beenden.');
    return household;
}

// Kennungen entsprechen den freigegebenen Varianten im Startdialog.
/** @type {Record<string, [string, string, Partial<import("../../typcheck/datenvertraege.js").PlanValues>?][]>} */
const VARIANTEN = {
    'max-erika': [['immobilien', 'Haus und vermietete Wohnung'], ['kurssturz', 'Markt erst heiß, dann Rückgang'], ['teilweise', 'Plan teilweise umgesetzt']],
    renate: [['klein', 'Kleines Vermögen']],
    'jan-lena': [['halten', 'Lebensstandard halten']],
    // FR-73: Der Grundbedarf bleibt ohne Pflege; die heutige Pflege rechnet die App selbst.
    'helga-werner': [['haus-pg3', 'Mit Haus, Werner Pflegegrad 3', { floorBedarf: 36000 }]],
    sophie: [['teilzeit', 'Teilzeit vor der Rente']],
    'martin-petra': [['hundert', 'Gegenseitig 100 %'], ['ehe', 'Verheiratet'], ['testament', 'Testament']]
};
/**
 * @param {string} [householdId]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function musterVarianten(householdId = DEFAULT_MUSTER_HAUSHALT) {
    musterHaushalt(householdId);
    return [{ id: 'grund', name: householdId === 'martin-petra' ? 'Haus + Steuer' : 'Grundfall' },
        ...(VARIANTEN[householdId] || []).map(([id, name, values]) => ({ id, name, ...values }))];
}
/**
 * @param {string} [householdId]
 * @param {string} [variantId]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function musterVariante(householdId = DEFAULT_MUSTER_HAUSHALT, variantId = 'grund') {
    const variant = musterVarianten(householdId).find(entry => entry.id === variantId);
    if (!variant) throw new Error('Beschädigter Spielbereich-Zustand: unbekannte Beispielvariante. Bitte den Spielbereich beenden.');
    return variant;
}
/** Marktverlauf der Spielkurse einer Variante (AR-3); sonst null, also die gewohnten Kurven.
 * @param {string} [householdId] @param {string} [variantId] @returns {string|null} */
export function musterMarktverlauf(householdId = DEFAULT_MUSTER_HAUSHALT, variantId = 'grund') {
    return householdId === 'max-erika' && variantId === 'kurssturz' ? 'kurssturz' : null;
}
