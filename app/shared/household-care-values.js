/** FR-50: gemeinsame Pflegewerte des Haushalts; keine Writes beim Lesen. */
export const HOUSEHOLD_CARE_VALUES_KEY = 'household_care_values_v1';
export const CARE_ALLOWANCE_SOURCE = 'https://www.bundesgesundheitsministerium.de/fileadmin/Dateien/3_Downloads/P/Pflegeversicherung_Leistungsbeitraege/Uebersicht_Leistungsbetraege_2026_VA.pdf';
export const CARE_RESIDENTIAL_SOURCE = 'https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html';
/** FR-72: vdek 1.7.2026, Bund, €/Monat vor dem Zuschuss der Kasse; Pflegeanteil (EEE) einschließlich Ausbildungskosten. */
export const DEFAULT_RESIDENTIAL_COMPONENTS = Object.freeze({ care: 2088, board: 1068, invest: 521 });
/** § 43c SGB XI: Zuschuss auf den Pflegeanteil im 1., 2., 3. und ab dem 4. Heimjahr. */
export const RESIDENTIAL_SUBSIDY_RATES = Object.freeze([0.15, 0.30, 0.50, 0.75]);
export const DEFAULT_CARE_VALUES = Object.freeze({
    version: 1,
    allowance: Object.freeze({ values: Object.freeze({ 2: 347, 3: 599, 4: 800, 5: 990 }), asOf: '2026-01', source: CARE_ALLOWANCE_SOURCE, origin: 'mitgeliefert', validFrom: '2025-01' }),
    residential: Object.freeze({ monthly: 3364, components: DEFAULT_RESIDENTIAL_COMPONENTS, asOf: '2026-07', source: CARE_RESIDENTIAL_SOURCE, origin: 'mitgeliefert', validFrom: '2026-07' }),
    confirmedForYear: null
});

/** FR-73 P8: Herkunft der Preise; das Pflegegeld wird nie fortgeschrieben. */
export const CARE_PRICE_ORIGINS = Object.freeze(['mitgeliefert', 'von Hand', 'fortgeschrieben']);

/**
 * @param raw Rohwert vor der bestehenden Prüfung.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function parseCareValues(raw) {
    if (raw == null) return structuredClone(DEFAULT_CARE_VALUES);
    const value = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    const validMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '');
    if (value?.version !== 1 || !value.allowance || !value.residential
        || [2, 3, 4, 5].some(grade => !Number.isFinite(value.allowance.values?.[grade]) || value.allowance.values[grade] < 0)
        || !Number.isFinite(value.residential.monthly) || value.residential.monthly < 0
        || value.residential.components !== undefined && !validComponents(value.residential.components)
        || [value.allowance, value.residential].some(part => !validMonth(part.asOf) || !validMonth(part.validFrom)
            || typeof part.source !== 'string' || !part.source)
        || !['mitgeliefert', 'von Hand'].includes(value.allowance.origin) || !CARE_PRICE_ORIGINS.includes(value.residential.origin)
        || value.confirmedForYear !== null && (!Number.isInteger(value.confirmedForYear) || value.confirmedForYear < 1900 || value.confirmedForYear > 9999)) {
        throw new Error('Die gespeicherten Pflegewerte sind ungültig.');
    }
    assertCarePrices(value.prices);
    return value;
}

/** Preisblock des Records (Staffel zu Hause €/Jahr, Deckel €/Jahr, eigene Ausgaben €/Monat, optional der bewusst
 * eingegebene Kostenanstieg in Prozent); `undefined` ist Altbestand.
 *
 * @param {Partial<import("../../typcheck/datenvertraege.js").CarePrices>|null|undefined} prices Gespeicherter Block `prices`.
 * @returns {void}
 */
export function assertCarePrices(prices) {
    if (prices === undefined) return;
    const valid = prices !== null && typeof prices === 'object' && !Array.isArray(prices)
        && [1, 2, 3, 4, 5].every(grade => Number.isFinite(prices.costs?.[grade]) && prices.costs[grade] >= 0)
        && Number.isFinite(prices.maximumFloor) && prices.maximumFloor >= 0
        && Number.isFinite(prices.ownExpensesMonthly) && prices.ownExpensesMonthly >= 0
        && (prices.driftPercent === undefined || Number.isFinite(prices.driftPercent) && prices.driftPercent >= 0)
        && CARE_PRICE_ORIGINS.includes(prices.origin)
        && Number.isInteger(prices.priceYear) && prices.priceYear >= 1900 && prices.priceYear <= 9999;
    if (!valid) throw new Error('Die gespeicherten Pflegepreise sind ungültig.');
}

function validComponents(components) {
    return components !== null && typeof components === 'object'
        && ['care', 'board', 'invest'].every(key => Number.isFinite(components[key]) && components[key] >= 0);
}

/** Zuschuss der Kasse auf den Pflegeanteil im Heimjahr (ab 1); Grad 1 ohne Zuschuss.
 *
 * @param {number} [heimYear] Heimjahr ab 1; ab dem vierten gilt derselbe Zuschuss.
 * @param {{grade?: number}} [options]
 * @returns {number} Anteil zwischen 0 und 1.
 */
export function residentialSubsidyRate(heimYear = 1, { grade = 2 } = {}) {
    return Number(grade) === 1 ? 0 : RESIDENTIAL_SUBSIDY_RATES[Math.min(Math.max(1, Math.floor(heimYear)), 4) - 1];
}

/** Eigenanteil im Monat nach dem Zuschuss des Heimjahrs (ab 1), auf volle Euro wie vdek; Grad 1 ohne Zuschuss.
 *
 * @param {{care: number, board: number, invest: number, firstYear?: number}} components Bestandteile vor Zuschuss; `firstYear` setzt das erste Heimjahr fest.
 * @param {number} [heimYear] Heimjahr ab 1; ab dem vierten gilt derselbe Zuschuss.
 * @param {{grade?: number}} [options]
 * @returns {number} Euro im Monat.
 */
export function residentialMonthly(components, heimYear = 1, { grade = 2 } = {}) {
    if (Math.floor(heimYear) <= 1 && Number(grade) !== 1 && Number.isFinite(components.firstYear)) return components.firstYear;
    const rate = residentialSubsidyRate(heimYear, { grade });
    // Ungerundet rechnen und einmal kaufmännisch auf Euro runden; die Toleranz fängt nur Gleitkommarauschen ab
    // (exakt 3.655,50 € → 3.656 €, 3.655,495 € → 3.655 €, skalierte Altbestandteile ohne Vorabrundung).
    return Math.floor((1 - rate) * components.care + components.board + components.invest + 0.5 + 1e-9);
}

/** Bestandteile zum gespeicherten Heimwert. Ältere Stände kennen nur das erste Heimjahr; dann werden die
 * mitgelieferten Bestandteile ohne Zwischenrundung so skaliert, dass dieses gleich bleibt (Gutachten FR72, B18).
 *
 * @param residential Gespeicherter Heimteil der Pflegewerte.
 * @returns {{care: number, board: number, invest: number, firstYear?: number}} Bestandteile vor Zuschuss; skalierte Altwerte mit dem gespeicherten ersten Heimjahr.
 */
export function residentialComponents(residential) {
    const own = residential.components, base = DEFAULT_RESIDENTIAL_COMPONENTS;
    if (own && residentialMonthly(own) === residential.monthly) return { care: own.care, board: own.board, invest: own.invest };
    if (residential.monthly === DEFAULT_CARE_VALUES.residential.monthly) return { ...base };
    const factor = residential.monthly / ((1 - RESIDENTIAL_SUBSIDY_RATES[0]) * base.care + base.board + base.invest);
    // Das erste Heimjahr bleibt der gespeicherte Wert, auch mit Cent (Gutachten HE-1, Befund 2).
    return { care: factor * base.care, board: factor * base.board, invest: factor * base.invest, firstYear: residential.monthly };
}

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const readCareValues = storage => parseCareValues(storage?.getItem(HOUSEHOLD_CARE_VALUES_KEY));

/** Destatis 22421-01, 2023: Pflegebedürftige im Heim (I34:I38) und insgesamt (C34:C38) je Grad 1–5. */
const OFFICIAL_RESIDENTIAL_COUNTS = Object.freeze([[4344, 785822], [132378, 2300753], [297955, 1686286], [248626, 669263], [114191, 244252]]);

/** FR-72 Punkt 7: Heimanteil je Grad (0,6 / 5,8 / 17,7 / 37,1 / 46,8 %), ungerundet.
 *
 * @param {number} grade Pflegegrad 1–5.
 * @returns {number} Anteil zwischen 0 und 1; ohne gültigen Grad 0.
 */
export function officialResidentialShare(grade) {
    const counts = OFFICIAL_RESIDENTIAL_COUNTS[Number(grade) - 1];
    return counts ? counts[0] / counts[1] : 0;
}

/** Destatis 22421-01, I34:I38 / C34:C38; bisherige Rundung auf 100 Euro.
 *
 * @param values Fachwerte des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function officialCareCosts(values = DEFAULT_CARE_VALUES) {
    return Object.fromEntries(OFFICIAL_RESIDENTIAL_COUNTS.map(([home, total], i) => [i + 1, Math.round(home / total * values.residential.monthly * 12 / 100) * 100]));
}

/** Mitgelieferte Beträge ergänzen keine neuen Simulator-Eingabefelder.
 *
 * @param values Fachwerte des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function careValuesInputPatch(values) {
    const components = residentialComponents(values.residential);
    return [2, 3, 4, 5].every(grade => values.allowance.values[grade] === DEFAULT_CARE_VALUES.allowance.values[grade])
        && values.residential.monthly === DEFAULT_CARE_VALUES.residential.monthly
        && ['care', 'board', 'invest'].every(key => components[key] === DEFAULT_RESIDENTIAL_COMPONENTS[key]) ? {} : { careValues: values };
}

/**
 * @param raw Rohwert vor der bestehenden Prüfung.
 * @param year Bezugsjahr.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createCareValuesDraft(raw, year) {
    let values = parseCareValues(raw), confirmed = false, dirty = false;
    return { read: () => ({ values: structuredClone(values), confirmed, dirty }),
        change(next) { values = parseCareValues(next); confirmed = false; dirty = true; },
        // FR-73 Punkt 9: ein neuer Vorschlag der App hebt die Bestätigung auf, ist aber keine eigene Eingabe.
        propose(next) { values = parseCareValues(next); confirmed = false; },
        confirmValues() { values.confirmedForYear = year; confirmed = true; },
        accept() { if (!confirmed) throw new Error('Bitte die Pflegewerte bestätigen.'); return structuredClone(values); }
    };
}
