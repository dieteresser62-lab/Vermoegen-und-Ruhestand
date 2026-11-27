// NK-1 (FR-84 Punkt 13): Invariante „kein Ruin, solange das Geldvermögen des Haushalts den Grundbedarf ohne Pflege deckt“. NK-1b: dazu
// in jedem Erfolgsjahr die unabhängige Prüfung aus den Zahlungen der Jahreszeile (`unpaidBasicNeed`).
// Nur Beispielhaushalte. Jeder Ruin eines Laufs muss einen echten Haushaltsmangel zeigen: Geldvermögen (Tagesgeld, Geldmarkt,
// Depot aller Personen, Pflegereserve) unter dem Grundbedarf ohne Pflege nach Renten und Einkünften, mit festen geplanten Ausgaben.
import { measurementInputs, parameters, backtest } from './ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { resolveMonteCarloDefaultDurationV1 } from '../../app/simulator/monte-carlo-parameters.js';
import { observeYearOutcomesForTests } from '../../app/simulator/simulator-engine-direct.js';
import { EngineAPI } from '../../engine/index.mjs';
import { invariantRuns } from './test-profil.mjs';

export const INVARIANT_TEST_DATE = '2026-11-15';

/** NK-1b/NK-1c (Gutachten NK1C Befund 9, NK1C2 Befund 6, Fable P2-7 und N2): unabhängige Prüfung eines Erfolgsjahrs nur aus der
 * Jahreszeile, ohne `basicCoverage`. Pflichtfelder müssen endliche Zahlen sein, die Auszahlung muss gebucht sein: Buchungen je Person
 * (`personalPayout.items`), Partnerzahlungen und Rückfallverkauf ergeben die Entnahme (Verheiratete) bzw. Entnahme plus höchstens die
 * Einkünfte (Unverheiratete). Verbraucht ist bei Unverheirateten genau das Gebuchte, sonst das Gebuchte plus die verbrauchten
 * Einkünfte. Zusammen mit der Hilfe zur Pflege aus der Auszahlung muss das den ganzen Floor samt Pflege decken; der Staat zahlt
 * höchstens die Pflege; ein offener Rest am Grundbedarf ist höchstens ein Rundungsrest.
 * @param {any} row Jahreszeile eines Erfolgsjahrs. @returns {string|null} Grund oder null. */
export function unpaidBasicNeed(row) {
    const tolerance = 1, cent = 0.01;
    const finite = (/** @type {any} */ value) => typeof value === 'number' && Number.isFinite(value);
    for (const key of ['floor_brutto', 'entnahme_effektiv', 'renteSum']) if (!finite(row?.[key])) return `Pflichtfeld ${key} fehlt`;
    for (const key of ['sonstige_einkuenfte', 'einkuenfte_gespart', 'hilfe_zur_pflege', 'hilfe_zur_pflege_steuer', 'grundbedarf_rest',
        'pflege_zusatz_floor', 'pflege_heimkosten', 'pflege_heim_eigene_ausgaben']) if (row[key] !== undefined && !finite(row[key])) return `Feld ${key} ungültig`;
    const payout = row.personalPayout;
    if (!payout || !Array.isArray(payout.items) || !finite(payout.total)) return 'Zahlungsnachweis fehlt';
    let booked = 0;
    for (const item of payout.items) {
        if (!finite(item?.amount) || item.amount < -cent) return 'Buchung ungültig';
        // NK-2 (Gutachten NK1C3 Befund 2): Kontenwerte erst auf Vorhandensein, endliche Zahl und Vorzeichen prüfen, dann die Summe.
        if (!finite(item.tagesgeldUsed) || !finite(item.geldmarktUsed)) return 'Kontenangabe der Buchung fehlt oder ist ungültig';
        if (item.tagesgeldUsed < -cent || item.geldmarktUsed < -cent) return 'Kontenangabe der Buchung negativ';
        if (Math.abs(item.tagesgeldUsed + item.geldmarktUsed - item.amount) > cent) return 'Buchung passt nicht zu den Konten';
        booked += item.amount;
    }
    if (Math.abs(booked - payout.total) > cent) return 'Summe der Buchungen weicht ab';
    for (const item of row.partner_grundbedarf || []) { if (!finite(item?.amount)) return 'Partnerzahlung ungültig'; booked += item.amount; }
    if (payout.fallback !== undefined) { if (!finite(payout.fallback)) return 'Rückfallverkauf ungültig'; booked += payout.fallback; }
    const income = row.renteSum + (row.sonstige_einkuenfte || 0) - (row.einkuenfte_gespart || 0);
    const unmarried = payout.mode === 'unmarried';
    const gap = booked - row.entnahme_effektiv;
    if (unmarried ? gap < -cent || gap > Math.max(0, income) + cent : Math.abs(gap) > cent) return `Gebucht ${Math.round(booked)} € passt nicht zur Entnahme ${Math.round(row.entnahme_effektiv)} €`;
    const care = (row.pflege_zusatz_floor || 0) + (row.pflege_heimkosten || 0) + (row.pflege_heim_eigene_ausgaben || 0);
    const consumed = unmarried ? booked : booked + income;
    const payoutAid = (row.hilfe_zur_pflege || 0) - (row.hilfe_zur_pflege_steuer || 0);
    if (consumed + payoutAid + tolerance < row.floor_brutto) return `Floor nicht bezahlt: verbraucht ${Math.round(consumed)} € + Hilfe ${Math.round(payoutAid)} € < Floor ${Math.round(row.floor_brutto)} €`;
    if ((row.hilfe_zur_pflege || 0) > care + tolerance) return `Hilfe ${Math.round(row.hilfe_zur_pflege)} € über den Pflegekosten ${Math.round(care)} €`;
    if ((row.grundbedarf_rest || 0) > tolerance) return `Grundbedarf offen ${Math.round(row.grundbedarf_rest)} €`;
    return null;
}

/** Ruin wegen einer Steuerlücke (Einkommen-, Erbschaft- oder Wohnrechtsteuer). Seit NK-2 (FR-84 Punkt 17) wird sie Schuld; ein solcher
 * Ruin ist daher immer eine Verletzung und wird zusätzlich gezählt. @param {any} outcome */
export const taxGapRuin = outcome => outcome?.taxGap === true || /^(Steuer im Haushalt ungedeckt|Erbschaftsteuer ungedeckt|Steuer Wohnrecht)/.test(String(outcome?.reason || ''));

/** Ruin, obwohl das Geldvermögen den Grundbedarf ohne Pflege deckt (oder ohne Angabe dazu), oder wegen einer Steuerlücke. */
const violates = outcome => taxGapRuin(outcome) || !outcome.basicCoverage || outcome.basicCoverage.money + 0.01 >= outcome.basicCoverage.need;

/** Beobachtet alle Jahresergebnisse eines Aufrufs; Laufnummer zählt mit jedem Jahr 0 weiter. */
async function observe(fn) {
    const ruins = [];
    let run = -1;
    observeYearOutcomesForTests((outcome, yearIndex) => {
        if (yearIndex === 0) run++;
        if (outcome?.isRuin) ruins.push({ run, year: yearIndex + 1, reason: String(outcome.reason || ''),
            money: outcome.basicCoverage?.money ?? null, need: outcome.basicCoverage?.need ?? null, violation: violates(outcome), taxGap: taxGapRuin(outcome) });
        else if (outcome?.kind === 'success' && outcome.logData) {
            const unpaid = unpaidBasicNeed(outcome.logData);
            if (unpaid) ruins.push({ run, year: yearIndex + 1, reason: `Erfolgsjahr: ${unpaid}`, money: null, need: null, violation: true, success: true });
        }
    });
    try { return { result: await fn(), ruins }; } finally { observeYearOutcomesForTests(null); }
}

/**
 * @param {string} household Beispielhaushalt.
 * @param {string} variant Variante.
 * @param {{runs?: number, transform?: (records: Record<string, string>) => Record<string, string>, label?: string}} [options]
 * @returns {Promise<{label: string, runs: number, failed: number, ruins: any[], violations: any[], backtests: {period: string, ruin: boolean}[]}>}
 */
export async function checkHouseholdInvariant(household, variant = 'grund', { runs = 1000, transform = null, label = `${household}/${variant}` } = {}) {
    const inputs = await measurementInputs(0, household, INVARIANT_TEST_DATE, variant, transform);
    const maxDauer = resolveMonteCarloDefaultDurationV1(inputs);
    const ruins = [];
    let failed = 0;
    for (let start = 0; start < runs; start += 250) {
        const count = Math.min(250, runs - start);
        const { result, ruins: seen } = await observe(() => runMonteCarloChunk({ inputs, engine: EngineAPI,
            monteCarloParams: { ...parameters, anzahl: runs, maxDauer }, widowOptions: inputs.widowOptions, useCapeSampling: false,
            runRange: { start, count } }));
        failed += result.totals.failCount;
        ruins.push(...seen.map(row => ({ ...row, run: row.run + start })));
    }
    const backtests = [];
    for (const [from, to] of [[2000, 2025], [1965, 1999]]) {
        const { result, ruins: seen } = await observe(() => backtest(inputs, from, to));
        ruins.push(...seen.map(row => ({ ...row, run: `Backtest ${from}–${to}` })));
        backtests.push({ period: `${from}–${to}`, ruin: result.outcome?.kind === 'ruin' || seen.some(row => !row.success) });
    }
    const violations = ruins.filter(row => row.violation).map(row => ({ household: label, run: row.run, year: row.year, reason: row.reason,
        money: row.money === null ? null : Math.round(row.money), need: row.need === null ? null : Math.round(row.need) }));
    return { label, runs, failed, ruins, violations, backtests, taxGaps: ruins.filter(row => row.taxGap).length };
}

/** Meldung je Verletzung: Haushalt, Lauf, Jahr und Grund. @param {any[]} violations */
export const describeViolations = violations => violations.map(row => `${row.household} · Lauf ${row.run} · Jahr ${row.year} · ${row.reason}`
    + ` · Geldvermögen ${row.money ?? '?'} € · Grundbedarf ohne Pflege ${row.need ?? '?'} €`).join('\n');

/** Testlauf für einen Beispielhaushalt mit allen Varianten: Monte Carlo mit Startwert 12345, dazu Backtests. Läufe nach Testprofil:
 * 1.000 in `npm run test:schwer`, 100 in `npm test`; die Backtests und die Prüfung bleiben gleich.
 * @param {string} household @param {{extra?: {label: string, variant: string, transform: (records: Record<string, string>) => Record<string, string>}[]}} [options] */
export async function assertHouseholdInvariant(household, { extra = [] } = {}) {
    const runs = invariantRuns();
    const { musterVarianten } = await import('../../app/demo/muster-haushalte.js');
    const cases = [...musterVarianten(household).map(variant => ({ label: `${household}/${variant.id}`, variant: variant.id, transform: null })), ...extra];
    const violations = [];
    for (const item of cases) {
        const result = await checkHouseholdInvariant(household, item.variant, { runs, transform: item.transform, label: item.label });
        console.log(`NK-1 Invariante ${item.label}: ${result.failed} von ${result.runs} Läufen gescheitert (${result.taxGaps} wegen Steuerlücke), ${result.violations.length} Verletzungen,`
            + ` Backtests ${result.backtests.map(row => `${row.period} ${row.ruin ? 'Ruin' : 'ohne Ruin'}`).join(', ')}`);
        violations.push(...result.violations);
    }
    globalThis.assertEqual(violations.length, 0, `FR-84 Punkt 13: kein Ruin, solange das Geldvermögen den Grundbedarf ohne Pflege deckt (${household})`
        + (violations.length ? `\n${describeViolations(violations)}` : ''));
}
