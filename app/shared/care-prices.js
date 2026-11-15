/** FR-73 P8/Punkt 9: Staffel zu Hause, Deckel „Maximaler Pflege-Floor“, eigene Ausgaben im Heim und der
 * Kostenanstieg gehören zum gemeinsamen Pflegewerte-Record. Alte `sim_`-Beträge werden nur lesend als
 * Altbestand aufgelöst; Lesen schreibt nie. Fortgeschrieben wird einmal je Jahresabschluss aus einer eingefrorenen Basis. */
import { CARE_COST_DEFAULTS, CARE_DRIFT_DEFAULT_PERCENT, readCareCostSettings, resolveCareSetting } from './care-cost-resolver.js';
import { assertCarePrices, parseCareValues, residentialComponents, residentialMonthly } from './household-care-values.js';
import { resolveCareDriftSchedule, careDriftRateForYear } from './care-cost-drift.js';

export const CARE_PRICE_DEFAULTS = Object.freeze({ costs: CARE_COST_DEFAULTS, maximumFloor: 120000, ownExpensesMonthly: 500, driftPercent: CARE_DRIFT_DEFAULT_PERCENT });
/** Gutachten PFA-4, Befund 2: eigener Preisblock einer Außenperson (gleiche Form wie `prices` im Pflegewerte-Record) an
 * ihrem eigenen Profil; nur eine bewusste Eingabe im Simulator schreibt ihn, Lesen nie. */
export const OWN_CARE_PRICES_KEY = 'sim_pflegePreise';
const GRADES = [1, 2, 3, 4, 5];
const readKey = (source, key) => typeof source?.getItem === 'function' ? source.getItem(key) : source?.[key];

/** Eigener Preisblock einer Außenperson aus ihrem Preisbesitzer; fehlend bleibt Altbestand, Unlesbares ist ein Fehler.
 *
 * @param {object|null|undefined} source Speicheradapter oder Profilrecord der Außenperson.
 * @returns {import('../../typcheck/datenvertraege.js').CarePrices|undefined} Markierter Block oder undefined.
 */
function ownCarePrices(source) {
    const raw = readKey(source, OWN_CARE_PRICES_KEY);
    if (raw == null || String(raw).trim() === '') return undefined;
    let parsed;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('Die gespeicherten Pflegepreise sind ungültig.'); }
    assertCarePrices(parsed);
    return parsed;
}
/** Kaufmännisch auf ganze Euro, ohne Gleitkommarest (3.600 × 1,025 × 1,05 = 3.874,50 → 3.875). */
export const wholeEuro = value => Math.floor(value + 0.5 + 1e-9);

/** Preise des Haushalts: Record zuerst, sonst die alten `sim_`-Beträge über den Resolver (fehlend ≠ 0).
 * Außenpersonen (`shared: false`) lesen ihren eigenen Preisblock (`sim_pflegePreise`), sonst ihre eigene Staffel aus den
 * `sim_`-Schlüsseln. Der Kostenanstieg gilt als bewusste Eingabe, sobald er im Preisblock steht (`driftMarked`); sonst
 * liest ihn der Resolver (3,5 → 5).
 *
 * @param {{prices?: object}|null|undefined} careValues Gelesener Pflegewerte-Record.
 * @param {object|null|undefined} legacySource Speicheradapter oder Profilrecord mit `sim_pflege…`-Schlüsseln.
 * @param {{shared?: boolean}} [options]
 * @returns {{costs: Record<number, number>, maximumFloor: number, ownExpensesMonthly: number, driftPercent: number, driftUntilYear: number, driftAfterPercent: number, driftMarked: boolean, scheduleMarked: boolean, origin: string, priceYear: number|null, stored: boolean}} Wirksame Preise.
 */
export function resolveCarePrices(careValues, legacySource, { shared = true } = {}) {
    const stored = shared ? careValues?.prices : ownCarePrices(legacySource);
    const legacy = readCareCostSettings(legacySource);
    const driftMarked = Number.isFinite(stored?.driftPercent);
    // FR-73 Punkt 8 geändert [A7]: Verlauf erste Rate / Wechseljahr / zweite Rate, Altbestand nur beim Lesen umgedeutet.
    const scheduleMarked = Number.isFinite(stored?.driftAfterPercent);
    // GN-2b (Fable P3-7): Ist die erste Rate im Block markiert, gilt nur der Block; `sim_`-Verlaufsfelder zählen dann nicht.
    const schedule = resolveCareDriftSchedule({ firstPercent: driftMarked ? stored.driftPercent : legacy.driftPercent,
        untilYear: scheduleMarked ? stored.driftUntilYear ?? null : driftMarked ? null : legacy.driftUntilYear,
        afterPercent: scheduleMarked ? stored.driftAfterPercent : driftMarked ? null : legacy.driftAfterPercent });
    const drift = { driftPercent: schedule.firstPercent, driftUntilYear: schedule.untilYear, driftAfterPercent: schedule.afterPercent, driftMarked, scheduleMarked };
    if (stored) {
        return { costs: Object.fromEntries(GRADES.map(grade => [grade, stored.costs[grade]])), maximumFloor: stored.maximumFloor,
            ownExpensesMonthly: stored.ownExpensesMonthly, ...drift, origin: stored.origin, priceYear: stored.priceYear, stored: true };
    }
    const isDefault = GRADES.every(grade => legacy.costs[grade] === CARE_PRICE_DEFAULTS.costs[grade])
        && legacy.maximumFloor === CARE_PRICE_DEFAULTS.maximumFloor && legacy.ownExpensesMonthly === CARE_PRICE_DEFAULTS.ownExpensesMonthly;
    return { costs: legacy.costs, maximumFloor: legacy.maximumFloor, ownExpensesMonthly: legacy.ownExpensesMonthly, ...drift, driftMarked: false, scheduleMarked: false,
        origin: isDefault ? 'mitgeliefert' : 'von Hand', priceYear: null, stored: false };
}

/** Verlauf des Kostenanstiegs aus wirksamen Preisen. @param {ReturnType<typeof resolveCarePrices>} prices */
export const careDriftScheduleOf = prices => ({ firstPercent: prices.driftPercent, untilYear: prices.driftUntilYear, afterPercent: prices.driftAfterPercent });

/** Rate über der Inflation für den Schritt in das Planjahr `year` (Jahresabschluss, Balance-Folgejahr).
 * @param {ReturnType<typeof resolveCarePrices>} prices @param {number} year @returns {number} */
export const careDriftPercentForYear = (prices, year) => careDriftRateForYear(year, careDriftScheduleOf(prices));

/** Kostenanstieg in Prozent allein aus dem Altbestand (Resolver: 3,5 gilt als 5). Die wirksame Zahl samt
 * Markierung liefert {@link resolveCarePrices}.
 *
 * @param {object|null|undefined} legacySource Speicheradapter oder Profilrecord.
 * @returns {number} Prozent.
 */
export function careDriftPercent(legacySource) {
    const read = key => typeof legacySource?.getItem === 'function' ? legacySource.getItem(key) : legacySource?.[key];
    return resolveCareSetting('sim_pflegeKostenDrift', read('sim_pflegeKostenDrift'));
}

/** Punkt 9: Staffel und Deckel × (1 + Inflation) × (1 + Kostenanstieg), eigene Ausgaben × (1 + Inflation), ganze Euro.
 * Ein markierter Kostenanstieg bleibt im Block stehen.
 *
 * @param {ReturnType<typeof resolveCarePrices>} prices Eingefrorene Ausgangsbasis.
 * @param {{inflationRate: number, driftPercent: number, priceYear: number}} options Abschlussinflation, Kostenanstieg, neues Planjahr.
 * @returns {{costs: Record<number, number>, maximumFloor: number, ownExpensesMonthly: number, driftPercent?: number, origin: 'fortgeschrieben', priceYear: number}} Fortgeschriebener Block.
 */
export function projectCarePrices(prices, { inflationRate, driftPercent, priceYear }) {
    const inflation = 1 + inflationRate / 100, factor = inflation * (1 + driftPercent / 100);
    return { costs: Object.fromEntries(GRADES.map(grade => [grade, wholeEuro(prices.costs[grade] * factor)])),
        maximumFloor: wholeEuro(prices.maximumFloor * factor), ownExpensesMonthly: wholeEuro(prices.ownExpensesMonthly * inflation),
        ...(prices.driftMarked ? { driftPercent: prices.driftPercent } : {}),
        ...(prices.scheduleMarked ? { driftUntilYear: prices.driftUntilYear, driftAfterPercent: prices.driftAfterPercent } : {}), origin: 'fortgeschrieben', priceYear };
}

/** Der vollständige Pflegewerte-Record für das neue Planjahr: Heim-Bestandteile und Preise fortgeschrieben,
 * Pflegegeld unverändert. Rechnet stets aus der übergebenen Basis, nie aus einem schon fortgeschriebenen Stand.
 *
 * @param {object|string|null|undefined} raw Gespeicherter Record (Objekt oder JSON) oder null für die Vorgaben.
 * @param {{inflationRate: number, driftPercent: number, priceYear: number, legacySource?: object|null, shared?: boolean}} options
 * @returns {object} Neuer Record ohne Bestätigung.
 */
export function projectCareValuesForYear(raw, { inflationRate, driftPercent, priceYear, legacySource = null, shared = true }) {
    const base = parseCareValues(raw);
    const factor = (1 + inflationRate / 100) * (1 + driftPercent / 100);
    const parts = residentialComponents(base.residential);
    const components = { care: wholeEuro(parts.care * factor), board: wholeEuro(parts.board * factor), invest: wholeEuro(parts.invest * factor) };
    const month = `${priceYear}-01`;
    return { ...base, confirmedForYear: null,
        residential: { ...base.residential, components, monthly: residentialMonthly(components), origin: 'fortgeschrieben', asOf: month, validFrom: month },
        prices: projectCarePrices(resolveCarePrices(base, legacySource, { shared }), { inflationRate, driftPercent, priceYear }) };
}

/** Eigene Eingabe im Simulator: ein Preisfeld ändern, alles andere aus der wirksamen Basis übernehmen.
 * Ein Kostenanstieg im Patch wird damit zur bewussten Eingabe (Gutachten PFA-2, Befund 6).
 *
 * @param {object|string|null|undefined} raw Gespeicherter Record.
 * @param {Partial<{costs: Record<number, number>, maximumFloor: number, ownExpensesMonthly: number, driftPercent: number}>} patch Geänderte Werte.
 * @param {{priceYear: number, legacySource?: object|null}} options Preisstand und Altbestand.
 * @returns {object} Record mit Herkunft „von Hand“.
 */
export function careValuesWithPrices(raw, patch, { priceYear, legacySource = null }) {
    const base = parseCareValues(raw);
    return { ...base, prices: patchedCarePrices(resolveCarePrices(base, legacySource), patch, priceYear) };
}

/** Eigene Eingabe einer Außenperson im Simulator: ihr Preisblock aus dem eigenen Preisbesitzer, ein Feld geändert,
 * Herkunft „von Hand“ (Gutachten PFA-4, Befund 2). Zu schreiben unter {@link OWN_CARE_PRICES_KEY}.
 *
 * @param {object|null|undefined} legacySource Speicheradapter oder Profilrecord der Außenperson.
 * @param {Partial<{costs: Record<number, number>, maximumFloor: number, ownExpensesMonthly: number, driftPercent: number}>} patch Geänderte Werte.
 * @param {{priceYear: number}} options Preisstand.
 * @returns {import('../../typcheck/datenvertraege.js').CarePrices} Markierter Block.
 */
export function ownCarePricesWithPatch(legacySource, patch, { priceYear }) {
    return patchedCarePrices(resolveCarePrices(null, legacySource, { shared: false }), patch, priceYear);
}

function patchedCarePrices(current, patch, priceYear) {
    // GN-2b (Steuerung zu Fable P2-2): Ändert der Nutzer eine der drei Angaben, werden alle drei mit dem gerade wirksamen
    // Verlauf geschrieben. Die Altbestandsregel „anderer Wert → dauerhaft“ gilt damit nur noch für Werte vor GN-2.
    const touched = patch.driftPercent !== undefined || patch.driftUntilYear !== undefined || patch.driftAfterPercent !== undefined;
    const drift = patch.driftPercent ?? (current.driftMarked || touched ? current.driftPercent : undefined);
    const schedule = touched || current.scheduleMarked
        ? { driftUntilYear: patch.driftUntilYear ?? current.driftUntilYear, driftAfterPercent: patch.driftAfterPercent ?? current.driftAfterPercent } : {};
    const prices = /** @type {import('../../typcheck/datenvertraege.js').CarePrices} */ ({ costs: { ...current.costs, ...(patch.costs || {}) },
        maximumFloor: patch.maximumFloor ?? current.maximumFloor, ownExpensesMonthly: patch.ownExpensesMonthly ?? current.ownExpensesMonthly,
        ...(drift === undefined ? {} : { driftPercent: drift }), ...schedule, origin: 'von Hand', priceYear: current.priceYear ?? priceYear });
    assertCarePrices(prices);
    return prices;
}
