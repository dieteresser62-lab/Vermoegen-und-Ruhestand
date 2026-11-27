// NK-1 (FR-84) Sollfall A: Martin und Petra, „Martin trägt“, Pflege an. Nur Beispieldaten: Petra ist heute Grad 4 im Heim,
// ihr Tagesgeld ist 0 (Depot 70.000 € wie im Steckbrief), Martin hat 400.000 € Tagesgeld. Alle übrigen Felder wie in der Variante.
export const MARTIN = 'muster_martin', PETRA = 'muster_petra';
/** @param {Record<string, string>} records Beispieldaten aus `createMusterHaushaltRecords`. */
export function sollfallARecords(records) {
    const registry = JSON.parse(records.rs_profiles_v1);
    const patch = { [MARTIN]: { profile_tagesgeld: '400000' },
        [PETRA]: { profile_tagesgeld: '0', profile_care_grade_today: '4', profile_care_form_today: 'residential' } };
    for (const [id, values] of Object.entries(patch)) {
        Object.assign(registry.profiles[id].data, values);
        if (records.rs_active_profile === id) Object.assign(records, values);
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}

/** NK-1b (Gutachten NK1C-Fable P1-1): wie Sollfall A, aber Martin ohne Tagesgeld und mit halbem Depot (250.000 €). Seine Liquidität
 * ist knapp; er verkauft für die Auszahlung. @param {Record<string, string>} records */
export function knappRecords(records) {
    const registry = JSON.parse(records.rs_profiles_v1);
    const half = (/** @type {string} */ raw) => JSON.stringify(JSON.parse(raw || '[]').map((/** @type {any} */ lot) => ({ ...lot,
        shares: lot.shares / 2, marketValue: lot.marketValue / 2, costBasis: lot.costBasis / 2 })));
    const martin = registry.profiles[MARTIN].data;
    const patch = { [MARTIN]: { profile_tagesgeld: '0', depot_tranchen: half(martin.depot_tranchen) },
        [PETRA]: { profile_tagesgeld: '0', profile_care_grade_today: '4', profile_care_form_today: 'residential' } };
    for (const [id, values] of Object.entries(patch)) {
        Object.assign(registry.profiles[id].data, values);
        if (records.rs_active_profile === id) Object.assign(records, values);
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}
