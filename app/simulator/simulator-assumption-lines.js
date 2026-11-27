// GN-1 Teil C (S3): Annahmen an der Deckungsquote und deutsche Namen statt technischer Kürzel. Nur Anzeige, die Rechnung bleibt.
import { careDriftLabel } from '../shared/care-cost-drift.js';
import { STRESS_PRESETS } from './simulator-data.js';
import { resolveMonteCarloDefaultDurationV1 } from './monte-carlo-parameters.js';

/** Deutsche Namen wie in den Auswahlfeldern des Simulators. */
export const RUN_LABELS = Object.freeze({
    methode: Object.freeze({ regime_markov: 'Marktregime mit Übergängen', regime_iid: 'Marktregime unabhängig', block: 'Block-Bootstrap', stationary: 'Stationary Bootstrap' }),
    decumulation: Object.freeze({ standard: 'Standard', '3_bucket_jilge': '3-Töpfe' }),
    // Alles außer „akut“ rechnet wie „chronisch“ (auch der alte Speicherwert „kosten“).
    careModel: Object.freeze({ chronisch: 'chronisch, bis Lebensende', kosten: 'chronisch, bis Lebensende', akut: 'akut, begrenzte Dauer' })
});

/** @param {'methode'|'decumulation'|'careModel'} kind @param {unknown} value @returns {string} */
export function runLabel(kind, value) {
    const key = String(value ?? '');
    return /** @type {Record<string, string>} */ (RUN_LABELS[kind])[key] ?? key;
}

/** MS-1: Methode mit Blocklänge, wo sie wirkt (Stationary Bootstrap: erwartete Länge, Block-Bootstrap: feste Länge).
 * @param {unknown} method @param {unknown} blockSize @returns {string} */
export function monteCarloMethodLabel(method, blockSize) {
    const label = runLabel('methode', method);
    const length = Number(blockSize);
    return (method === 'stationary' || method === 'block') && Number.isFinite(length) && length > 0
        ? `${label}, Blocklänge ${length}` : label;
}

/** @param {unknown} key @returns {string} Name des Stress-Szenarios. */
export function stressLabel(key) {
    const preset = /** @type {Record<string, {label?: string}>} */ (STRESS_PRESETS)[String(key ?? 'NONE')];
    return preset?.label ?? String(key ?? 'Kein Stress');
}

/** Hinweis wie in Personen & Vermögen unter „wie Löhne“ (FR-74). */
export const WAGE_ADJUSTMENT_HINT = 'Historisch im Mittel real rund +2,6 % pro Jahr, geprägt von den Wirtschaftswunderjahren. Seit 1992 rund +0,6 %. Vorsichtiger ist „wie Inflation“.';

const percent = (/** @type {number} */ value) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)} %`;

/** Rentenanpassung des Haushalts. Im Haushalt gilt die Wahl des Hauptprofils für beide Renten (FR-74).
 * @param {any} inputs @returns {string} */
export function pensionAdjustmentLabel(inputs) {
    const mode = inputs?.rentAdjMode;
    if (mode === 'cpi') return 'wie Inflation';
    if (mode === 'wage') return 'wie Löhne';
    const pct = Number(inputs?.rentAdjPct);
    return mode === 'none' || !(pct > 0) ? 'keine' : `fester Satz ${percent(pct)}`;
}

/** Zeilen „Gerechnet mit“ unter der Deckungsquote: Rentenanpassung, Fondskosten, Pflegekosten, Lebensdauer; dazu der Anteil der
 * Pflegefälle an den gescheiterten Läufen (aus `extraKPI.pflege.household`, wie im Export) und bei „wie Löhne“ der Hinweis.
 * @param {any} inputs Wirksame Simulationseingaben. @param {any} [results] Monte-Carlo-Ergebnis.
 * @param {{durationYears?: number|null, failCount?: number|null}} [options] Laufdauer aus den Laufparametern (GN-2b, Fable P3-3); gescheiterte Läufe (GH-1).
 * @returns {{line: string, careShare: string, wageHint: string}} */
export function coverageAssumptions(inputs = {}, results = null, { durationYears = null, failCount = null } = {}) {
    const parts = [`Rentenanpassung ${pensionAdjustmentLabel(inputs)}`];
    const cost = Number(inputs?.equityCostPct);
    if (Number.isFinite(cost)) parts.push(`Fondskosten ${percent(cost)} im Jahr`);
    // GN-2b (Fable P3-3): auch bei Pflegegrad heute ohne Pflegelogik, denn dann wird der Anstieg ebenso gerechnet.
    if (inputs?.pflegefallLogikAktivieren === true || inputs?.careToday?.grade || inputs?.partner?.careToday?.grade) {
        // GN-2 (FR-73 Punkt 8 geändert): beide Raten und das Jahr, bei gleichen Raten nur eine.
        const drift = Number(inputs?.pflegeKostenDrift), after = Number(inputs?.pflegeKostenDriftDanach), first = Number.isFinite(drift) ? drift * 100 : 0;
        parts.push(`Pflegekosten ${careDriftLabel({ firstPercent: first, untilYear: Number(inputs?.pflegeKostenDriftBis),
            afterPercent: Number.isFinite(after) ? after * 100 : first })}`);
    }
    let automatic = true;
    try { automatic = !Number.isFinite(durationYears) || durationYears === resolveMonteCarloDefaultDurationV1(inputs); } catch { automatic = true; }
    parts.push(`Lebensdauer nach der Sterbetafel des Jahrgangs (Destatis), ${automatic ? 'Simulation bis Alter 110 der jüngsten Person'
        : `Simulation über ${Number(durationYears).toLocaleString('de-DE')} Jahre`}`);
    const care = results?.extraKPI?.pflege?.household;
    const count = (/** @type {unknown} */ rate, /** @type {unknown} */ size) => Number.isFinite(Number(rate)) && Number.isFinite(Number(size))
        ? Math.round(Number(rate) * Number(size) / 100) : null;
    const withCare = count(care?.shortfallRateWithCarePct, care?.sampleSize) ?? 0;
    const withoutCare = count(care?.shortfallRateWithoutCarePct, care?.noCareSampleSize) ?? 0;
    const total = withCare + withoutCare;
    // GH-1 Punkt 3: getrennt nach „Geld reicht nicht“ (gescheiterte Läufe) und „Aktien und Gold aufgebraucht, Rente und Liquidität reichen
    // noch“, damit die Zahl nicht größer wirkt als die gescheiterten Läufe. Aus vorhandenen Zählern, ohne neuen Zähler im Lauf.
    const failed = Number.isFinite(Number(failCount)) && failCount !== null ? Math.min(total, Math.max(0, Math.round(Number(failCount)))) : null;
    const de = (/** @type {number} */ value) => value.toLocaleString('de-DE');
    const careShare = !(inputs?.pflegefallLogikAktivieren === true && care && total > 0) ? ''
        : failed === null
            ? `Von ${de(total)} Läufen, in denen das Geld nicht reicht oder Aktien und Gold aufgebraucht sind, hatten ${de(withCare)} einen Pflegefall.`
            // VK-3c (Gemini Befund 2): Jede Zahl nennt ihre Grundmenge; die Aufteilung 8 + 18 gilt den 26 Läufen, nicht den 20 mit Pflegefall.
            : `${de(total)} Läufe mit Engpass, davon ${de(withCare)} mit Pflegefall. Von den ${de(total)} reicht in ${de(failed)} das Geld nicht; in ${de(total - failed)} sind Aktien und Gold aufgebraucht, Rente und Liquidität reichen aber noch.`;
    return { line: `Gerechnet mit: ${parts.join(' · ')}.`, careShare, wageHint: inputs?.rentAdjMode === 'wage' ? `Rentenanpassung „wie Löhne“: ${WAGE_ADJUSTMENT_HINT}` : '' };
}
