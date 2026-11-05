/** PF-1: deterministische Messung einer separaten Quellkopie, ohne Produktwrites.
 * Aufruf: node tests/extended/care-flex-measurement.mjs <source> <alt|A|Aprime|AB> <output> [no-care]
 * Vier Quellkopien und die A′-Einzeilenänderung beschreibt MESSUNG-PF-1.md.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [source, variant, output, mode] = process.argv.slice(2);
if (!source || !['alt', 'A', 'Aprime', 'AB'].includes(variant) || !output) throw new Error('Quellkopie, Variante und Ausgabedatei erforderlich');
const load = file => import(pathToFileURL(resolve(source, file)));
const { inputs: fixtureInputs } = await load('tests/extended/parity-replay-fixture.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const noCare = mode === 'no-care';
const inputs = structuredClone(fixtureInputs);
Object.assign(inputs, { pflegefallLogikAktivieren: !noCare, pflegeModellTyp: 'chronisch',
    pflegeRampUp: 5, pflegeMaxFloor: 120000, pflegeKostenDrift: .035, pflegeRegionalZuschlag: 0,
    pflegeMinDauer: 5, pflegeMaxDauer: 10 });
const levels = variant === 'AB' ? [1, 1, .5, 0, 0] : [.75, .25, .1, 0, 0];
inputs.pflegeGradeConfigs = Object.fromEntries([6000, 12000, 18000, 32000, 60000].map((zusatz, i) =>
    [i + 1, { zusatz, flexCut: levels[i], mortalityFactor: [0, 0, 3, 5, 5][i] }]));
inputs.pflegeStufe1Zusatz = 6000;
inputs.pflegeStufe1FlexCut = levels[0];
const params = { anzahl: 2000, maxDauer: 35, methode: 'block', blockSize: 3, seed: 12345,
    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const digest = createHash('sha256'), paths = [];
let outputBytes = 0, financialYears = 0, careYears = 0, transitions = 0, outsideBearTransitions = 0;
const flex = [], careAnnual = [], budgetDrops = [], budgetDropEuros = [];
let maxJump = { euro: 0, percent: 0 }, maxOutsideDrop = { euro: 0, percent: 0 };
// 40 Chunks à 50 Pfade begrenzen den Speicher. Absolute Laufindizes und
// per-run-seed erhalten die gleichen Zufallspfade wie der Gesamtauftrag.
for (let start = 0; start < params.anzahl; start += 50) {
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params,
        widowOptions: inputs.widowOptions, useCapeSampling: true,
        runRange: { start, count: 50 }, logIndices: new Set(Array.from({ length: 50 }, (_, i) => start + i)),
        engine: EngineAPI });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Technischer Fehler in der Messung');
    const bytes = JSON.stringify(chunk);
    digest.update(bytes); outputBytes += Buffer.byteLength(bytes);
    for (let i = 0; i < chunk.runMeta.length; i++) {
        const meta = chunk.runMeta[i];
        const rows = meta.logDataRows.filter(row => row.recordType === 'financial_year');
        let previous = null, pathDrops = 0, annualCareSum = 0, pathCareYears = 0, pathFlexSum = 0;
        const years = [];
        for (const row of rows) {
            const factor = row.inflation_factor_cum;
            if (!(factor > 0) || !Number.isFinite(row.floor_brutto) || !Number.isFinite(row.flex_haushalt_erfuellt)) throw new Error('Unvollständiges Finanzjahr');
            financialYears++;
            const budget = (row.floor_brutto + row.flex_haushalt_erfuellt) / factor;
            const paidFlex = row.flex_haushalt_erfuellt / factor;
            const inCare = Boolean(row.CareP1_Active || row.CareP2_Active || row.CareP1_Cost > 0 || row.CareP2_Cost > 0);
            const cost = ((row.CareP1_Cost || 0) + (row.CareP2_Cost || 0)) / factor;
            if (inCare) { careYears++; pathCareYears++; flex.push(paidFlex); pathFlexSum += paidFlex; careAnnual.push(cost); annualCareSum += cost; }
            if (!row.Regime || row.Regime === 'unknown') throw new Error('Marktregime fehlt');
            const bear = row.Regime.includes('bear');
            if (previous && row.jahr === previous.year + 1 && previous.budget > 0) {
                transitions++;
                const change = budget - previous.budget, pct = 100 * change / previous.budget;
                if (Math.abs(change) > Math.abs(maxJump.euro)) maxJump = { euro: change, percent: pct, path: meta.index, year: row.jahr };
                if (!bear) {
                    outsideBearTransitions++;
                    if (pct < -5) { budgetDrops.push(pct); budgetDropEuros.push(change); pathDrops++; }
                    if (change < maxOutsideDrop.euro) maxOutsideDrop = { euro: change, percent: pct, path: meta.index, year: row.jahr };
                }
            }
            previous = { year: row.jahr, budget };
            years.push({ year: row.jahr, inCare, care: cost, flex: paidFlex, budget, regime: row.Regime });
        }
        const terminalCareNeed = meta.totalCareAdditionalNeedRealEur - annualCareSum;
        // Der Runner erfasst den Bedarf auch vor einem gescheiterten Finanzjahr.
        // Eine Terminalzeile ist keine bezahlte Jahresrechnung.
        if (Math.abs(terminalCareNeed) > 1e-5 && !(meta.failed && terminalCareNeed > 0
            && meta.logDataRows.some(row => row.recordType === 'terminal_ruin'))) {
            throw new Error(`Pflegebedarf nicht erklärbar: Pfad ${meta.index}, Differenz ${terminalCareNeed}`);
        }
        paths.push({ index: meta.index, realEnd: chunk.pathSummaries.finalValueRealEur[i], failed: meta.failed,
            care: meta.careEverActive, careSum: meta.totalCareAdditionalNeedRealEur, annualCareSum, terminalCareNeed,
            pathCareYears, pathFlexSum, outsideBearDrops: pathDrops, years });
    }
    console.log(`${variant}${noCare ? '/ohne Pflege' : ''}: ${start + 50}/${params.anzahl}`);
}
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const quantile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), pos = (sorted.length - 1) * p, low = Math.floor(pos);
    return sorted[low] + (sorted[Math.ceil(pos)] - sorted[low]) * (pos - low);
};
const carePaths = paths.filter(path => path.care), wealth = paths.map(path => path.realEnd);
const result = { variant, noCare, runtime: { node: process.version, platform: process.platform, arch: process.arch }, params, input: inputs, inputSha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
    completeOutputSha256: digest.digest('hex'), outputBytes,
    metrics: { paths: paths.length, successCount: paths.filter(path => !path.failed).length,
        successPct: 100 * paths.filter(path => !path.failed).length / paths.length,
        realEndP10: quantile(wealth, .1), realEndP50: quantile(wealth, .5), worstRealEnd: Math.min(...wealth),
        carePaths: carePaths.length, meanCareSumReal: mean(carePaths.map(path => path.careSum)),
        meanCareAnnualReal: mean(careAnnual), meanCareYearFlexReal: mean(flex), careYearFlexP10Real: quantile(flex, .1),
        financialYears, careYears, transitions, outsideBearTransitions, outsideBearDropCount: budgetDrops.length,
        outsideBearDropPct: 100 * budgetDrops.length / outsideBearTransitions,
        meanOutsideBearDropReal: mean(budgetDropEuros), meanOutsideBearDropPct: mean(budgetDrops),
        maxJump, maxOutsideDrop }, paths };
if (result.metrics.paths !== 2000) throw new Error('Unvollständiger Lauf');
writeFileSync(output, JSON.stringify(result));
console.log(JSON.stringify(result.metrics));
console.log(`SHA-256 vollständige Ausgabe: ${result.completeOutputSha256} (${outputBytes} Bytes)`);
