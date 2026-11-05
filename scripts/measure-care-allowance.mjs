/** FR-47: alte und neue Quellen getrennt ausführen; ausschließlich synthetische Eingaben.
 * node scripts/measure-care-allowance.mjs <Quellordner> <Ausgabe.json> <alte Basis> [Pfade=2000]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, baseline, countArg = '2000'] = process.argv.slice(2);
if (!baseline) throw new Error('Quellordner, Ausgabe und alte Basis fehlen.');
const load = (dir, file) => import(pathToFileURL(resolve(dir, file)));
const { measurementInputs } = await load(baseline, 'tests/helpers/ek-1b-measurement.mjs');
const { inputs: fixture } = await load(baseline, 'tests/extended/parity-replay-fixture.mjs');
const { readCareInputs } = await load(baseline, 'app/simulator/simulator-input-care.js');
const { runFixture: currentBacktest } = await load(root, 'tests/extended/parity-replay-fixture.mjs');
const { runMonteCarloChunk } = await load(root, 'app/simulator/monte-carlo-runner.js');
const { runSweepChunk } = await load(root, 'app/simulator/sweep-runner.js');
const { createStressReplayCaptureRequest } = await load(root, 'app/simulator/stress-replay-path-materializer.js');
const { careAllowanceAnnual } = await load(resolve(import.meta.dirname, '..'), 'app/shared/care-benefits.js');
const { EngineAPI } = await load(root, 'engine/index.mjs');
const html = readFileSync(resolve(baseline, 'Simulator.html'), 'utf8');
const careDefaults = readCareInputs({ doc: { getElementById(id) {
    const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    return tag ? { value: tag.match(/\bvalue="([^"]*)"/)?.[1] ?? '', checked: /\bchecked\b/.test(tag) } : null;
} } });
const maxErika = { ...await measurementInputs(0, 'max-erika'), ...careDefaults,
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch' };
const pair = { ...structuredClone(fixture), ...careDefaults, startAlter: 60,
    partner: { ...fixture.partner, startAlter: 63 }, pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch' };
const scenarios = {
    'max-erika': maxErika,
    'today-usual': { ...pair, careToday: { grade: 2, additionalMonthly: null, progression: 'usual', allowanceAsIncome: false } },
    'today-slower': { ...pair, careToday: { grade: 2, additionalMonthly: null, progression: 'slower', allowanceAsIncome: false } },
    'official': { ...maxErika, pflegeKostenStaffelPreset: 'amtlich', pflegeGradeConfigs: Object.fromEntries([200, 2300, 7100, 15000, 18900].map((zusatz, i) => [i + 1, { ...careDefaults.pflegeGradeConfigs[i + 1], zusatz }])) },
    'no-care': { ...pair, pflegefallLogikAktivieren: false }
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const params = { anzahl: Number(countArg), maxDauer: 47, methode: 'block', blockSize: 3,
    seed: 12345, rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const backtestOnly = process.argv.includes('--backtest-only');
const result = backtestOnly ? JSON.parse(readFileSync(output, 'utf8')) : { params, source: root === baseline ? 'PG-1' : 'FR-47', scenarios: {} };
const isOld = root === baseline;
for (const [name, inputs] of Object.entries(scenarios)) {
    const digest = createHash('sha256'), wealth = [];
    let bytes = 0, failed = 0, careCost = 0, allowance = 0;
    for (let start = 0; start < (backtestOnly ? 0 : params.anzahl); start += 50) {
        const count = Math.min(50, params.anzahl - start), indices = Array.from({ length: count }, (_, i) => start + i);
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, widowOptions: inputs.widowOptions,
            useCapeSampling: true, runRange: { start, count }, logIndices: new Set(indices),
            stressReplayCapture: createStressReplayCaptureRequest(indices), engine: EngineAPI });
        if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Technischer Messfehler.');
        const serialized = JSON.stringify(chunk); digest.update(serialized); bytes += Buffer.byteLength(serialized);
        wealth.push(...chunk.pathSummaries.finalValueRealEur); failed += chunk.totals.failCount;
        for (const meta of chunk.runMeta) {
            let inflation = 1;
            for (const year of meta.stressReplayCapture.years) {
                const event = year.householdEvents[0];
                for (const p of [1, 2]) {
                    const care = event?.[`careMetaP${p}`];
                    if (!care?.active) continue;
                    const weight = event[`p${p}Alive`] ? 1 : .5;
                    careCost += care.zusatzFloorZiel * weight / inflation;
                    // Voller Lebenspfad einschließlich Schattenjahre nach finanziellem Ruin.
                    allowance += isOld ? (care.initialAllowanceAsIncome && care.grade === care.initialGrade
                        ? [0, 0, 347, 599, 800, 990][care.grade] * 12 * weight : 0)
                        : careAllowanceAnnual({ grade: care.grade, preset: inputs.pflegeKostenStaffelPreset, lifeFactor: weight });
                }
                inflation *= 1 + year.inflationPct / 100;
            }
        }
        if ((start + count) % 500 === 0) console.log(`${result.source}/${name}: ${start + count}/${params.anzahl}`);
    }
    wealth.sort((a, b) => a - b);
    const q = p => { const x = (wealth.length - 1) * p; return wealth[Math.floor(x)] + (wealth[Math.ceil(x)] - wealth[Math.floor(x)]) * (x % 1); };
    const historical = currentBacktest({ input: inputs, selectedPeriod: { startYear: 1965, endYear: 2011 } });
    const probes = {};
    if (!backtestOnly && ['no-care', 'official'].includes(name)) for (const couple of [true, false]) {
        const probeInputs = structuredClone(inputs); if (!couple) probeInputs.partner = { aktiv: false };
        const probe = { ...params, anzahl: 4, maxDauer: 12 };
        probes[`${couple ? 'couple' : 'single'}-mc`] = hash(await runMonteCarloChunk({ inputs: probeInputs, monteCarloParams: probe,
            widowOptions: inputs.widowOptions, useCapeSampling: false, logIndices: new Set([0, 1, 2, 3]), engine: EngineAPI }));
        probes[`${couple ? 'couple' : 'single'}-sweep`] = hash(runSweepChunk({ baseInputs: probeInputs,
            paramCombinations: [{ liquidityRunwayYears: 3, goldRebalancingBand: 20, maxSkimPct: 10, maxBearRefillPct: 5, goldTargetPct: 0 }],
            sweepConfig: { anzahlRuns: 4, maxDauer: 12, blockSize: 3, baseSeed: 12345, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, engine: EngineAPI }));
    }
    result.scenarios[name] = { ...(backtestOnly ? result.scenarios[name] : { inputHash: hash(inputs), completeOutputSha256: digest.digest('hex'), outputBytes: bytes,
        successPct: 100 * (params.anzahl - failed) / params.anzahl, realEndP10: q(.1), realEndP50: q(.5),
        meanCareCostReal: careCost / params.anzahl, meanCareAllowanceReal: allowance / params.anzahl, probes }),
        backtest: { hash: hash(historical), outcome: historical.outcome, summary: historical.summary, rows: historical.rows.length,
            careCostReal: historical.rows.reduce((sum, entry) => sum + (entry.row.pflege_zusatz_floor || 0) / entry.row.inflation_factor_cum, 0),
            careAllowanceReal: historical.rows.reduce((sum, entry) => sum + (entry.row.pflegegeld || 0) / entry.row.inflation_factor_cum, 0) } };
    if (historical.outcome.kind !== 'completed') throw new Error('Backtest muss vollständig auswertbar sein.');
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name, ...result.scenarios[name], backtest: undefined }));
}
