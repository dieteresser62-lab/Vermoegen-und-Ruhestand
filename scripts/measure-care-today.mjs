/** FR-45: node scripts/measure-care-today.mjs <Quellordner> <Ausgabe.json> [none|grade|zero|no-care]
 * Je Aufruf nur ein MC-Prozess; 2.000 synthetische Paarpfade, Seed 12345.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
const [source, output, variant = 'none', sensitivityRaw = '1'] = process.argv.slice(2);
const sensitivity = Number(sensitivityRaw);
if (![.7, 1, 1.3].includes(sensitivity)) throw new Error('Empfindlichkeit: nur 0,7 / 1 / 1,3.');
if (sensitivity !== 1) {
    // Ausschließlich Messprozess: keine zusätzlichen Produktparameter oder Quellwrites.
    const loader = `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (!url.endsWith('/simulator-engine-helpers.js')) return result;
        const source = String(result.source);
        const target = "careToday.progression === 'slower' ? .5";
        if (!source.includes(target)) throw new Error('Verlaufsfaktor für die Empfindlichkeitsprobe fehlt.');
        return { ...result, source: source.replace(target, "careToday.progression === 'slower' ? ${.5 * sensitivity}") };
    }`;
    register(`data:text/javascript,${encodeURIComponent(loader)}`);
}
if (!source || !output || !['none', 'grade', 'zero', 'no-care'].includes(variant)) throw new Error('Quellordner, Ausgabe und gültige Variante erforderlich.');
const load = file => import(pathToFileURL(resolve(source, file)));
const { inputs: fixture, runFixture } = await load('tests/extended/parity-replay-fixture.mjs');
const { readCareInputs } = await load('app/simulator/simulator-input-care.js');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { runSweepChunk } = await load('app/simulator/sweep-runner.js');
const { createStressReplayCaptureRequest } = await load('app/simulator/stress-replay-path-materializer.js');
const { EngineAPI } = await load('engine/index.mjs');
const html = readFileSync(resolve(source, 'Simulator.html'), 'utf8');
const defaults = readCareInputs({ doc: { getElementById(id) {
    const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    return tag ? { value: tag.match(/\bvalue="([^"]*)"/)?.[1] ?? '', checked: /\bchecked\b/.test(tag) } : null;
} } });
const inputs = { ...structuredClone(fixture), ...defaults, startAlter: 60,
    partner: { ...fixture.partner, startAlter: 63 }, pflegefallLogikAktivieren: variant !== 'no-care', pflegeModellTyp: 'chronisch' };
if (variant === 'grade' || variant === 'zero') inputs.careToday = { grade: 2,
    additionalMonthly: variant === 'zero' ? 0 : null, progression: variant === 'zero' ? 'slower' : 'usual', allowanceAsIncome: variant === 'zero' };
const params = { anzahl: 2000, maxDauer: 48, methode: 'block', blockSize: 3,
    seed: 12345, rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const digest = createHash('sha256'), paths = [];
let outputBytes = 0;
for (let start = 0; start < params.anzahl; start += 50) {
    const indices = Array.from({ length: 50 }, (_, i) => start + i);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, widowOptions: inputs.widowOptions,
        useCapeSampling: true, runRange: { start, count: 50 }, logIndices: new Set(indices),
        stressReplayCapture: createStressReplayCaptureRequest(indices), engine: EngineAPI });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Technischer Messfehler.');
    const bytes = JSON.stringify(chunk); digest.update(bytes); outputBytes += Buffer.byteLength(bytes);
    for (const [i, meta] of chunk.runMeta.entries()) {
        let p1LifeYears = params.maxDauer, censored = true, careYears = 0, careCostReal = 0, inflationFactor = 1;
        for (const year of meta.stressReplayCapture.years) {
            const event = year.householdEvents[0];
            if (event && (event.p1Alive === 0 || event.p1Alive === false) && censored) { p1LifeYears = year.yearIndex + .5; censored = false; }
            for (const p of [1, 2]) {
                const care = event?.[`careMetaP${p}`];
                if (!care?.active) continue;
                const weight = event[`p${p}Alive`] ? 1 : .5;
                careYears += weight;
                careCostReal += care.zusatzFloorZiel * weight / inflationFactor;
            }
            inflationFactor *= 1 + year.inflationPct / 100;
        }
        paths.push({ index: meta.index, failed: meta.failed, realEnd: chunk.pathSummaries.finalValueRealEur[i],
            careYears, careCostReal, p1LifeYears, p1DeathAge: 60 + p1LifeYears, censored });
    }
    if ((start + 50) % 250 === 0) console.log(`${variant}: ${start + 50}/2000`);
}
const mean = key => paths.reduce((sum, path) => sum + path[key], 0) / paths.length;
const wealth = paths.map(path => path.realEnd).sort((a, b) => a - b);
const quantile = q => { const pos = (wealth.length - 1) * q; return wealth[Math.floor(pos)] + (wealth[Math.ceil(pos)] - wealth[Math.floor(pos)]) * (pos % 1); };
const backtest = runFixture({ input: inputs, selectedPeriod: { startYear: 1965, endYear: 2024 } });
const backtestBytes = JSON.stringify(backtest);
const probeParams = { ...params, anzahl: 4, maxDauer: 12, blockSize: 1, seed: 91827 };
const checks = {};
for (const couple of [false, true]) {
    const probeInputs = structuredClone(inputs); delete probeInputs.careToday;
    if (!couple) probeInputs.partner = { aktiv: false };
    const combo = { liquidityRunwayYears: 3, goldRebalancingBand: 20, maxSkimPct: 10, maxBearRefillPct: 5, goldTargetPct: 0 };
    const results = { backtest: runFixture({ input: probeInputs, selectedPeriod: { startYear: 2000, endYear: 2011 } }),
        mc: await runMonteCarloChunk({ inputs: probeInputs, monteCarloParams: probeParams,
            logIndices: new Set([0, 1, 2, 3]), widowOptions: probeInputs.widowOptions, useCapeSampling: false, engine: EngineAPI }),
        sweep: runSweepChunk({ baseInputs: probeInputs, paramCombinations: [combo], sweepConfig: { anzahlRuns: 4, maxDauer: 12, blockSize: 1,
            baseSeed: 91827, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, engine: EngineAPI }) };
    for (const [runner, result] of Object.entries(results)) checks[`${couple ? 'couple' : 'single'}-${runner}`] = createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
const result = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, variant, sensitivity, params, inputs,
    completeOutputSha256: digest.digest('hex'), outputBytes, noCurrentGradeChecks: checks,
    metrics: { successPct: 100 * paths.filter(path => !path.failed).length / paths.length,
        realEndP10: quantile(.1), realEndP50: quantile(.5), meanCareCostReal: mean('careCostReal'), meanCareYears: mean('careYears'),
        meanP1LifeYears: mean('p1LifeYears'), meanP1DeathAge: mean('p1DeathAge'), censoredPaths: paths.filter(path => path.censored).length },
    backtest: { sha256: createHash('sha256').update(backtestBytes).digest('hex'), outcome: backtest.outcome,
        summary: backtest.summary, rows: backtest.rows.length,
        careCostReal: backtest.rows.reduce((sum, entry) => sum + (entry.row.pflege_zusatz_floor || 0) / entry.row.inflation_factor_cum, 0) } };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, inputs: undefined, backtest: result.backtest }));
