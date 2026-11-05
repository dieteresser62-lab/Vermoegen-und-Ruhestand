/** FR-50: gemeinsame Pflegewerte des Haushalts; keine Writes beim Lesen. */
export const HOUSEHOLD_CARE_VALUES_KEY = 'household_care_values_v1';
export const CARE_ALLOWANCE_SOURCE = 'https://www.bundesgesundheitsministerium.de/fileadmin/Dateien/3_Downloads/P/Pflegeversicherung_Leistungsbeitraege/Uebersicht_Leistungsbetraege_2026_VA.pdf';
export const CARE_RESIDENTIAL_SOURCE = 'https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html';
export const DEFAULT_CARE_VALUES = Object.freeze({
    version: 1,
    allowance: Object.freeze({ values: Object.freeze({ 2: 347, 3: 599, 4: 800, 5: 990 }), asOf: '2026-01', source: CARE_ALLOWANCE_SOURCE, origin: 'mitgeliefert', validFrom: '2025-01' }),
    residential: Object.freeze({ monthly: 3364, asOf: '2026-07', source: CARE_RESIDENTIAL_SOURCE, origin: 'mitgeliefert', validFrom: '2026-07' }),
    confirmedForYear: null
});

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
        || [value.allowance, value.residential].some(part => !validMonth(part.asOf) || !validMonth(part.validFrom)
            || !['mitgeliefert', 'von Hand'].includes(part.origin) || typeof part.source !== 'string' || !part.source)
        || value.confirmedForYear !== null && (!Number.isInteger(value.confirmedForYear) || value.confirmedForYear < 1900 || value.confirmedForYear > 9999)) {
        throw new Error('Die gespeicherten Pflegewerte sind ungültig.');
    }
    return value;
}

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const readCareValues = storage => parseCareValues(storage?.getItem(HOUSEHOLD_CARE_VALUES_KEY));

/** Destatis 22421-01, I34:I38 / C34:C38; bisherige Rundung auf 100 Euro.
 *
 * @param values Fachwerte des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function officialCareCosts(values = DEFAULT_CARE_VALUES) {
    const shares = [[4344, 785822], [132378, 2300753], [297955, 1686286], [248626, 669263], [114191, 244252]];
    return Object.fromEntries(shares.map(([home, total], i) => [i + 1, Math.round(home / total * values.residential.monthly * 12 / 100) * 100]));
}

/** Mitgelieferte Beträge ergänzen keine neuen Simulator-Eingabefelder.
 *
 * @param values Fachwerte des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function careValuesInputPatch(values) {
    return [2, 3, 4, 5].every(grade => values.allowance.values[grade] === DEFAULT_CARE_VALUES.allowance.values[grade])
        && values.residential.monthly === DEFAULT_CARE_VALUES.residential.monthly ? {} : { careValues: values };
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
        confirmValues() { values.confirmedForYear = year; confirmed = true; },
        accept() { if (!confirmed) throw new Error('Bitte die Pflegewerte bestätigen.'); return structuredClone(values); }
    };
}
