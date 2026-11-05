// Nur der geänderte Speichervertrag wird in seine frühere Darstellung projiziert.
// Die vollständigen übrigen Records und ihre Reihenfolge bleiben prüfbar.
export function legacyDemoIncomeRecords(records) {
    const person = data => {
        const entries = data.profile_einkuenfte_v1 ? JSON.parse(data.profile_einkuenfte_v1).entries : [];
        const once = entries.filter(entry => !entry.art);
        const old = once.length ? { profile_planned_inflows_v1: JSON.stringify({ schemaVersion: 1,
            entries: once.map(entry => ({ year: Number(entry.monat.slice(0, 4)), amount: entry.betrag, label: entry.bezeichnung })) }) } : {};
        for (const [key, value] of Object.entries(data)) {
            if (['profile_einkuenfte_v1', 'profile_einkuenfte_migration_v1'].includes(key)) continue;
            old[key] = value;
            if (key === 'profile_rente_monatlich') old.profile_sonstige_einkuenfte = '0';
        }
        return old;
    };
    const result = person(records);
    const registry = JSON.parse(result.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) profile.data = person(profile.data);
    result.rs_profiles_v1 = JSON.stringify(registry);
    return result;
}
