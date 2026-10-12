/** Lesende, aufruflokale Momentaufnahmen; niemals Teil des Persistenz-State. */
export function createFlexTraceCollector(flexAnnual) {
    const entries = [];
    const monthly = rate => (flexAnnual * (Math.max(0, Math.min(100, rate)) / 100)) / 12;
    return {
        record(schritt, rateVorher, rateNachher, grund, kennzahlen = {}, monatsbetragNachher) {
            const monatsbetragVorher = monthly(rateVorher);
            const nextMonthly = monatsbetragNachher ?? monthly(rateNachher);
            entries.push(Object.freeze({
                schritt,
                rateVorher,
                rateNachher,
                gegriffen: nextMonthly !== monatsbetragVorher,
                grund,
                // Unbegrenzte Reichweite (Bedarf null) ist keine endliche
                // JSON-Kennzahl. Nur die Diagnose erhält null; Policies bleiben gleich.
                kennzahlen: Object.freeze(Object.fromEntries(Object.entries(kennzahlen)
                    .map(([key, value]) => [key, typeof value === 'number' && !Number.isFinite(value) ? null : value]))),
                monatsbetragVorher,
                monatsbetragNachher: nextMonthly,
                monatswirkungEur: nextMonthly - monatsbetragVorher
            }));
        },
        snapshot() {
            return Object.freeze([...entries]);
        }
    };
}
