/** FR-40: MC-Alt/Neu auf getrennten Quellständen, ohne Produktwrites.
 * node tests/extended/care-death-flex-measurement.mjs <source> <output.json>
 * Beide Ausgaben enthalten Prüfsummen sämtlicher Chunkfelder samt Vermögensfächer.
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
const quantile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * p;
    return sorted[Math.floor(position)]
        + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1);
};
const result = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, params, modes: {} };
for (const mode of ['care', 'no-care']) {
    const inputs = structuredClone(fixtureInputs);
    Object.assign(inputs, { dynamicFlex: true, pflegefallLogikAktivieren: mode === 'care', pflegeModellTyp: 'chronisch',
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
        const bytes = JSON.stringify({ ...chunk, wealthFan: chunk.wealthFan });
        digest.update(bytes); outputBytes += Buffer.byteLength(bytes);
        for (const [i, meta] of chunk.runMeta.entries()) {
            const rows = meta.logDataRows.filter(row => row.recordType === 'financial_year');
            // Das Sterbejahrprotokoll bewahrt Grad und halbe Pflegekosten der verstorbenen Person.
            const death = rows.find(row => row.SurvivorDeathYear && [1, 2].some(person =>
                row[`Person${person}Alive`] === 0 && row[`CareP${person}_Active`] === 1
                && row[`CareP${person}_Grade`] >= 3));
            const survivorRows = death ? rows.filter(row => row.jahr > death.jahr
                && row.Person1Alive + row.Person2Alive === 1) : [];
            const summary = Object.fromEntries(Object.entries(chunk.pathSummaries).map(([key, values]) => [key, values[i]]));
            paths.push({ index: meta.index, sha256: hash({ meta, summary }), failed: meta.failed,
                nominalEnd: chunk.pathSummaries.finalValueNominalEur[i], realEnd: chunk.pathSummaries.finalValueRealEur[i],
                careDeathYear: death?.jahr ?? null, survivorYears: survivorRows.length,
                survivorFlexNominalSum: survivorRows.reduce((sum, row) => sum + row.flex_haushalt_erfuellt, 0),
                survivorFlexRealSum: survivorRows.reduce((sum, row) => sum + row.flex_haushalt_erfuellt / row.inflation_factor_cum, 0),
                survivorFlexSha256: hash(survivorRows.map(row => [row.jahr, row.flex_haushalt_erfuellt])) });
        }
        if ((start + 50) % 250 === 0) console.log(`${mode}: ${start + 50}/${params.anzahl}`);
    }
    if (paths.length !== 2000) throw new Error('Unvollständige Messung.');
    const survivorYears = paths.reduce((sum, path) => sum + path.survivorYears, 0);
    result.modes[mode] = { inputs, inputSha256: hash(inputs), completeOutputSha256: digest.digest('hex'), outputBytes,
        successCount: paths.filter(path => !path.failed).length,
        successPct: 100 * paths.filter(path => !path.failed).length / paths.length,
        nominalEndP10: quantile(paths.map(path => path.nominalEnd), .1),
        nominalEndP50: quantile(paths.map(path => path.nominalEnd), .5),
        realEndP10: quantile(paths.map(path => path.realEnd), .1),
        realEndP50: quantile(paths.map(path => path.realEnd), .5),
        careDeathPaths: paths.filter(path => path.careDeathYear !== null).length, survivorYears,
        meanSurvivorFlexNominal: survivorYears ? paths.reduce((sum, path) => sum + path.survivorFlexNominalSum, 0) / survivorYears : null,
        meanSurvivorFlexReal: survivorYears ? paths.reduce((sum, path) => sum + path.survivorFlexRealSum, 0) / survivorYears : null,
        paths };
    console.log(JSON.stringify({ mode, ...result.modes[mode], inputs: undefined, paths: undefined }));
}
writeFileSync(output, JSON.stringify(result));
