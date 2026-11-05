/** Lesende, aufruflokale Momentaufnahmen; niemals Teil des Persistenz-State. */
/** @param {number} flexAnnual */
export function createFlexTraceCollector(flexAnnual, { collectEntries = true } = {}) {
    const entries = /** @type {{schritt:string;rateVorher:number;rateNachher:number;gegriffen:boolean;grund:string;kennzahlen:Readonly<Record<string,number|string|boolean|null|undefined>>;monatsbetragVorher:number;monatsbetragNachher:number;monatswirkungEur:number}[]} */ ([]);
    const reductions = /** @type {{source:string|undefined;drop:number;rateBefore:number}[]} */ ([]);
    let finalRate = 100;
    /** @type {Record<string,string>} */
    const sources = { previous_rate: 'Vorjahresbezug', raw_target: 'Tiefer Bär',
        internal_smoothing: 'Glättung', annual_change_limit: 'Glättung (Anstieg)',
        flex_share_curve: 'Flex-Anteil (S-Kurve)', bear_cap: 'Guardrail (Bären-Cap)',
        runway_cap: 'Guardrail (Runway-Cap)', flex_budget: 'Flex-Budget (Cap)',
        final_smoothing: 'Glättung (Final-Guardrail)', quantization: 'Rundung' };
    const monthly = /** @param {number} rate */
    rate => (flexAnnual * (Math.max(0, Math.min(100, rate)) / 100)) / 12;
    const considerReduction = /** @param {string|undefined} source
 * @param {number} drop */
    (source, drop, rateBefore = finalRate + drop) => {
        if (Number.isFinite(drop) && drop > 0 && Number.isFinite(rateBefore)) {
            reductions.push({ source, drop, rateBefore });
        }
    };
    return {
        considerReduction,

        /** @param {string} schritt
 * @param {number} rateVorher
 * @param {number} rateNachher
 * @param {string} grund
 * @param {Record<string,number|string|boolean|null|undefined>} kennzahlen
 * @param {number} [monatsbetragNachher] */
        record(schritt, rateVorher, rateNachher, grund, kennzahlen = {}, monatsbetragNachher) {
            const drop = rateVorher - rateNachher;
            considerReduction(schritt === 'guardrails' ? /** @type {string|undefined} */ (kennzahlen.gewaehlteQuelle) : sources[schritt] || grund, drop, rateVorher);
            finalRate = rateNachher;
            if (!collectEntries) return;
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

        /** @param {number} endRate
 * @param {{budgetFloorBlocked?:boolean;previousRate?:number}} options */
        strongestReduction(endRate = finalRate, { budgetFloorBlocked = false, previousRate } = {}) {
            if (budgetFloorBlocked && endRate < /** @type {number} */ (previousRate)) return 'Guardrail (Vorsicht)';
            let largestDrop = 0, reductionSource = null;
            for (const { source, drop, rateBefore } of reductions) {
                // Spätere Anhebungen können eine frühere Senkung aufheben.
                const remainingDrop = Math.min(drop, Math.max(0, rateBefore - endRate));
                if (remainingDrop > largestDrop) {
                    largestDrop = remainingDrop;
                    reductionSource = source;
                }
            }
            return reductionSource;
        },
        snapshot() {
            return Object.freeze([...entries]);
        }
    };
}
