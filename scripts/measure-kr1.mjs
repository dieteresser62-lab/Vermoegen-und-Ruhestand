/** KR-1 Messung [M1]: Monte Carlo je Musterhaushalt, nur synthetische Musterdaten, fester Seed (per-run-seed).
 * node scripts/measure-kr1.mjs <Quellordner> <Ausgabe.json> <Variante> <Haushalt> [Pfade=2000]
 * Variante: `basis` oder `tail` (Crash-Zuschlag fest an, Werte wie die Vorgabe der Oberfläche beim Einschalten).
 * Der Quellordner bestimmt den Codestand (Basis, KR-1, Wegwerfkopie). Kennzahlen:
 * - Grundbedarf gedeckt: Läufe ohne Ruin / Läufe (wie outcomeInventory.floorCoveragePct);
 * - Hilfe zur Pflege: Läufe mit Hilfe zur Pflege / Läufe;
 * - Mindest-Flex: Jahre unter Mindest-Flex / beobachtete Finanzjahre und Läufe mit solchen Jahren;
 * - Endvermögen P10/P50 real (pathSummaries.finalValueRealEur);
 * - Jahresbudget der ersten 5 Jahre: (Grundbedarf brutto + gezahlter Flex) / kumulierte Inflation, Mittel je Lauf, dann über Läufe;
 * - Anhebung greift: Finanzjahre mit Kürzungsquelle „Budget-Floor“ und Läufe mit mindestens einem solchen Jahr.
 * Pfadgleichheit: je Lauf die Folge der gezogenen historischen Jahre (histJahr), damit alt und neu vergleichbar sind.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, variant = 'basis', householdId, countArg = '2000'] = process.argv.slice(2);
if (!root || !output || !householdId) throw new Error('Quellordner, Ausgabe, Variante und Haushalt erforderlich.');
if (!['basis', 'tail'].includes(variant)) throw new Error(`Unbekannte Variante: ${variant}`);
const tail = variant === 'tail';
const load = file => import(pathToFileURL(resolve(root, file)).href);
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const { quantile } = await load('app/simulator/simulator-utils.js');
const { readMinimumFlexYear } = await load('app/simulator/minimum-flex-metrics.js');

const testDate = '2027-01-02';
const inputs = await measurementInputs(0, householdId, testDate);
if (tail) Object.assign(inputs, { tailRiskEnabled: true, tailRiskAnnualProbabilityPct: 1,
    tailRiskReturnShockPct: -35, tailRiskInflationShockPct: 6, tailRiskDurationYears: 1, tailRiskCooldownYears: 10 });
// Wie oft die Anhebung greift: Engine-Entscheidungen, in denen der Schritt „guardrails“ die Rate anhebt (nur der
// Budget-Floor hebt dort an). Die Spur wird nur gelesen und vor der Rückgabe entfernt; die Rechnung bleibt gleich.
let engineDecisions = 0, floorRaises = 0;
const engine = { ...EngineAPI, simulateSingleYear(input, lastState, options = {}) {
    const result = EngineAPI.simulateSingleYear(input, lastState, { ...options, includeFlexTrace: true });
    const trace = result?.ui?.spending?.flexTrace;
    if (Array.isArray(trace)) {
        engineDecisions++;
        const step = trace.find(entry => entry.schritt === 'guardrails');
        if (step && step.rateNachher > step.rateVorher + 1e-9) floorRaises++;
        if (!options.includeFlexTrace) delete result.ui.spending.flexTrace;
    }
    return result;
} };
const count = Number(countArg);
const params = { ...parameters, anzahl: count };
const digest = createHash('sha256'), finalReal = [], paths = [], budgets = [];
let ruin = 0, technical = 0, careAidRuns = 0, belowYears = 0, observedYears = 0, belowRuns = 0, floorYears = 0, floorRuns = 0,
    financialYears = 0, tailYear0 = 0;
const cutReasons = {};
for (let start = 0; start < count; start += 100) {
    const size = Math.min(100, count - start);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start, count: size }, engine,
        logIndices: Array.from({ length: size }, (_, index) => start + index) });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error(JSON.stringify(chunk.technicalInventory));
    digest.update(JSON.stringify(chunk));
    ruin += chunk.totals.outcomeRuinCount;
    technical += chunk.technicalInventory.technicalError;
    careAidRuns += chunk.careAid?.runIndices.length || 0;
    finalReal.push(...chunk.pathSummaries.finalValueRealEur);
    for (const run of chunk.runMeta) {
        const rows = run.logDataRows || [];
        paths.push(rows.map(row => row.histJahr ?? '').join(','));
        if (rows[0]?.tailRiskActive === true) tailYear0++;
        let below = 0, floor = 0;
        const firstFive = [];
        for (const row of rows) {
            const flex = readMinimumFlexYear(row);
            if (!flex) continue;
            financialYears++;
            cutReasons[row.CutReason] = (cutReasons[row.CutReason] || 0) + 1;
            if (row.CutReason === 'Budget-Floor') floor++;
            if (flex.missing) continue;
            observedYears++;
            if (flex.below) below++;
            if (row.jahr >= 1 && row.jahr <= 5 && Number.isFinite(row.floor_brutto) && row.inflation_factor_cum > 0) {
                firstFive.push((row.floor_brutto + flex.paid) / row.inflation_factor_cum);
            }
        }
        belowYears += below; belowRuns += below > 0 ? 1 : 0;
        floorYears += floor; floorRuns += floor > 0 ? 1 : 0;
        if (firstFive.length) budgets.push(firstFive.reduce((sum, value) => sum + value, 0) / firstFive.length);
    }
    if ((start + size) % 500 === 0) console.log(`${householdId}/${variant}: ${start + size}/${count}`);
}
const round = value => Math.round(value * 100) / 100;
const result = {
    householdId, variant, root: resolve(root), testDate, parameters: params,
    tail: tail ? { probabilityPct: 1, returnShockPct: -35, inflationShockPct: 6, durationYears: 1, cooldownYears: 10 } : null,
    floorCoveredPct: round((count - ruin - technical) / count * 100), ruin, technical,
    careAidRunsPct: round(careAidRuns / count * 100), careAidRuns,
    belowMinimumFlexYearsPct: round(observedYears ? belowYears / observedYears * 100 : 0), belowMinimumFlexRunsPct: round(belowRuns / count * 100),
    belowMinimumFlexYears: belowYears, observedYears,
    finalRealP10: Math.round(quantile(finalReal, 0.1)), finalRealP50: Math.round(quantile(finalReal, 0.5)),
    budgetFirstFiveRealMean: Math.round(budgets.reduce((sum, value) => sum + value, 0) / budgets.length), budgetRuns: budgets.length,
    budgetFloorYears: floorYears, budgetFloorYearsPct: round(financialYears ? floorYears / financialYears * 100 : 0),
    budgetFloorRunsPct: round(floorRuns / count * 100), financialYears, tailYear0Runs: tailYear0, cutReasons,
    engineDecisions, floorRaises, floorRaisesPct: round(engineDecisions ? floorRaises / engineDecisions * 100 : 0),
    completeOutputSha256: digest.digest('hex'), paths
};
writeFileSync(output, JSON.stringify(result) + '\n');
const { paths: _paths, cutReasons: _reasons, ...summary } = result;
console.log(JSON.stringify(summary));
