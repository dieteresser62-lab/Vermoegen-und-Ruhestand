/** SN-1: vollständige MC-Ausgaben einer Quellkopie, speicherbegrenzt und seriell.
 * node tests/extended/care-survivor-cap-measurement.mjs <source> <output.json>
 * Vergleiche dieselben Aufrufe auf Ausgangsstand und geändertem Stand.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Quellkopie und Ausgabedatei erforderlich.');
const load = file => import(pathToFileURL(resolve(source, file)));
const { inputs: fixtureInputs } = await load('tests/extended/parity-replay-fixture.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const params = { anzahl: 2000, maxDauer: 35, methode: 'block', blockSize: 3, seed: 12345,
    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const quantile = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = (sorted.length - 1) / 2;
    return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
};
const result = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, params, modes: {} };
for (const mode of ['care', 'no-care']) {
    const inputs = structuredClone(fixtureInputs);
    Object.assign(inputs, { pflegefallLogikAktivieren: mode !== 'no-care', pflegeModellTyp: 'chronisch',
        pflegeRampUp: 5, pflegeMaxFloor: 60000, pflegeKostenDrift: .035, pflegeRegionalZuschlag: 0,
        pflegeMinDauer: 5, pflegeMaxDauer: 10 });
    inputs.pflegeGradeConfigs = Object.fromEntries([6000, 12000, 18000, 32000, 60000].map((zusatz, i) =>
        [i + 1, { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: [0, 0, 3, 5, 5][i] }]));
    const digest = createHash('sha256'), paths = [];
    let outputBytes = 0;
    for (let start = 0; start < params.anzahl; start += 50) {
        const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params,
            widowOptions: inputs.widowOptions, useCapeSampling: true, runRange: { start, count: 50 },
            logIndices: new Set(Array.from({ length: 50 }, (_, i) => start + i)), engine: EngineAPI });
        if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Technischer Messfehler.');
        // Keine Projektion: sämtliche Chunkfelder samt nicht enumerierbarem Fächer.
        const bytes = JSON.stringify({ ...chunk, wealthFan: chunk.wealthFan });
        digest.update(bytes); outputBytes += Buffer.byteLength(bytes);
        for (const [i, meta] of chunk.runMeta.entries()) {
            const summary = Object.fromEntries(Object.entries(chunk.pathSummaries).map(([key, values]) => [key, values[i]]));
            paths.push({ index: meta.index, sha256: hash({ meta, summary }), failed: meta.failed,
                nominalEnd: chunk.pathSummaries.finalValueNominalEur[i], realEnd: chunk.pathSummaries.finalValueRealEur[i],
                care: meta.careEverActive });
        }
        if ((start + 50) % 250 === 0) console.log(`${mode}: ${start + 50}/${params.anzahl}`);
    }
    if (paths.length !== 2000) throw new Error('Unvollständige Messung.');
    result.modes[mode] = { inputs, inputSha256: hash(inputs), completeOutputSha256: digest.digest('hex'), outputBytes,
        successCount: paths.filter(path => !path.failed).length,
        successPct: 100 * paths.filter(path => !path.failed).length / paths.length,
        nominalEndP50: quantile(paths.map(path => path.nominalEnd)), realEndP50: quantile(paths.map(path => path.realEnd)),
        carePaths: paths.filter(path => path.care).length, paths };
    console.log(JSON.stringify({ mode, ...result.modes[mode], inputs: undefined, paths: undefined }));
}
// Zehn echte Pflegepfade ohne Tod über zwölf vollständige Finanzjahre.
// Die Kandidaten werden deterministisch in aufsteigender Pfadnummer geprüft.
const controlParams = { ...params, maxDauer: 12 };
const controlInputs = result.modes.care.inputs;
const controlDigest = createHash('sha256'), controlIndices = [];
let controlBytes = 0;
for (let index = 0; index < 2000 && controlIndices.length < 10; index++) {
    const chunk = await runMonteCarloChunk({ inputs: controlInputs, monteCarloParams: controlParams,
        widowOptions: controlInputs.widowOptions, useCapeSampling: true,
        runRange: { start: index, count: 1 }, logIndices: [index], engine: EngineAPI });
    const meta = chunk.runMeta[0], rows = meta?.logDataRows;
    if (!meta?.careEverActive || meta.failed || rows?.length !== 12
        || rows.some(row => row.recordType !== 'financial_year' || row.Person1Alive !== 1 || row.Person2Alive !== 1)) continue;
    const bytes = JSON.stringify({ ...chunk, wealthFan: chunk.wealthFan });
    controlDigest.update(bytes); controlBytes += Buffer.byteLength(bytes); controlIndices.push(index);
}
if (controlIndices.length !== 10) throw new Error('Zehn Pflegepfade ohne Tod fehlen.');
result.modes['care-no-death'] = { params: controlParams, indices: controlIndices,
    completeOutputSha256: controlDigest.digest('hex'), outputBytes: controlBytes };
console.log(JSON.stringify({ mode: 'care-no-death', ...result.modes['care-no-death'] }));
writeFileSync(output, JSON.stringify(result));
