/** ATH-1b (FR-89, Ergänzung 2): Korrekturen am Allzeithoch ohne automatischen Filter. Ein Tageskurs lässt sich als
 * „nicht verwenden“ markieren und wieder freigeben; ein Split teilt gespeichertes Hoch und Jahresschlüsse einmal und lässt
 * Tagesschlüsse vor dem Splitdatum nicht mehr zählen. Die Rohkurse bleiben unverändert gespeichert. */
/** @import * as D from '../../typcheck/datenvertraege.js' */

/** Haushaltseigenes Feld im Balance-Stand; fehlt es, gilt ATH-1 unverändert [A7]. */
export const ATH_CORRECTIONS_KEY = 'athCorrections';
/** Die fünf Marktwerte, die ein Split teilt. */
export const SPLIT_MARKET_FIELDS = Object.freeze(['ath', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3']);

/** @typedef {{asOf: string, ratio: number, recordedAt: string, before: Record<string, number>, after: Record<string, number>}} SplitRecord */
/** @typedef {{ignoredCloses: string[], splits: SplitRecord[]}} AthCorrections */

/** @param {unknown} value */
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** @param {unknown} value */
const isRatio = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value !== 1;

/** Liest die Korrekturen tolerant; ungültige Einträge zählen nicht.
 * @param {D.BalanceState|null|undefined} state @returns {AthCorrections} */
export function readAthCorrections(state) {
    const raw = /** @type {any} */ (state)?.[ATH_CORRECTIONS_KEY];
    const ignoredCloses = [...new Set((Array.isArray(raw?.ignoredCloses) ? raw.ignoredCloses : []).filter(isDate))].sort();
    const splits = (Array.isArray(raw?.splits) ? raw.splits : [])
        .filter((/** @type {any} */ split) => split && isDate(split.asOf) && isRatio(split.ratio))
        .map((/** @type {any} */ split) => structuredClone(split))
        .sort((/** @type {SplitRecord} */ a, /** @type {SplitRecord} */ b) => a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);
    return { ignoredCloses, splits };
}

/** Korrekturen für `deriveMarketHigh`: markierte Tage und der Tag des letzten Splits.
 * @param {D.BalanceState|null|undefined} state @returns {import('./balance-market-preview.js').HighCorrections} */
export function highCorrectionsOf(state) {
    const { ignoredCloses, splits } = readAthCorrections(state);
    return { ignoredCloses, splitFrom: splits.at(-1)?.asOf ?? null };
}

/** @param {D.BalanceState} state @param {AthCorrections} corrections @returns {D.BalanceState} */
const withCorrections = (state, corrections) => ({ ...state, [ATH_CORRECTIONS_KEY]: corrections });

/** Einen Tageskurs nicht mehr für das Hoch verwenden. @param {D.BalanceState} state @param {string} asOf */
export function ignoreDailyClose(state, asOf) {
    if (!isDate(asOf)) throw new Error('Ungültiges Kursdatum.');
    const current = readAthCorrections(state);
    return withCorrections(state, { ...current, ignoredCloses: [...new Set([...current.ignoredCloses, asOf])].sort() });
}

/** Einen markierten Tageskurs wieder verwenden. @param {D.BalanceState} state @param {string} asOf */
export function restoreDailyClose(state, asOf) {
    const current = readAthCorrections(state);
    return withCorrections(state, { ...current, ignoredCloses: current.ignoredCloses.filter(date => date !== asOf) });
}

/** Rechnet einen Split vor, ohne etwas zu schreiben: vorher und nachher je Marktwert, auf Cent gerundet.
 * `closingYear`: nächstes Abschlussjahr; ein Split danach wird abgelehnt (FR-89, Ergänzung 4).
 * @param {{state: D.BalanceState, inputs: Record<string, unknown>, asOf: string, ratio: number, closingYear?: number|null, now?: () => Date}} options
 * @returns {SplitRecord} */
export function planSplit({ state, inputs, asOf, ratio, closingYear = null, now = () => new Date() }) {
    if (!isDate(asOf)) throw new Error('Bitte das Datum des Splits angeben.');
    // FR-89, Ergänzung 4: Ein Split nach dem offenen Abschlussjahr würde dessen Jahresschluss ungeteilt auf geteilte Werte setzen.
    if (Number.isInteger(closingYear) && Number(asOf.slice(0, 4)) > /** @type {number} */ (closingYear)) {
        throw new Error(`Erst den Jahresabschluss ${closingYear} durchführen, dann den Split eintragen.`);
    }
    if (!isRatio(ratio)) throw new Error('Bitte ein Verhältnis größer als 0 und ungleich 1 angeben, etwa 2 für 1:2.');
    if (readAthCorrections(state).splits.some(split => split.asOf === asOf)) throw new Error('Für dieses Datum ist schon ein Split eingetragen.');
    const before = Object.fromEntries(SPLIT_MARKET_FIELDS.map(field => {
        const value = Number(inputs[field]);
        if (!Number.isFinite(value) || value < 0) throw new Error('Allzeithoch und Jahresschlüsse müssen gültige Zahlen sein.');
        return [field, value];
    }));
    const after = Object.fromEntries(SPLIT_MARKET_FIELDS.map(field => [field, Math.round(before[field] / ratio * 100) / 100]));
    return { asOf, ratio, recordedAt: now().toISOString(), before, after };
}

/** Speichert den Split im Balance-Stand: Eintrag, geteiltes Hoch der Jahresmarktdaten und geteilte Marktwerte der Eingaben.
 * Die Eingaben aller Personen folgen über das gewöhnliche Speichern der Eingabefelder.
 * @param {D.BalanceState} state @param {SplitRecord} split @returns {D.BalanceState} */
export function applySplit(state, split) {
    const current = readAthCorrections(state);
    const next = /** @type {any} */ (withCorrections(state, { ...current, splits: [...current.splits, structuredClone(split)] }));
    next.inputs = { ...next.inputs, ...split.after };
    next.balanceInputFields = { ...next.balanceInputFields };
    for (const field of SPLIT_MARKET_FIELDS) next.balanceInputFields[field] = { value: String(split.after[field]), checked: false };
    const meta = next.annualMarketDataMeta;
    if (meta?.ath && Number.isFinite(meta.ath.value)) {
        const divide = (/** @type {number} */ value) => Math.round(value / split.ratio * 100) / 100;
        next.annualMarketDataMeta = { ...meta, ...(Number.isFinite(meta.price) ? { price: divide(meta.price) } : {}),
            ath: { ...meta.ath, value: meta.ath.value === split.before.ath ? split.after.ath : divide(meta.ath.value) } };
    }
    return next;
}
