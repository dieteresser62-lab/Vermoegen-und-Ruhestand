// KL-1: vollständige Ergebnisprüfsummen und Pfadbelege, ausschließlich Musterdaten.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, probe] = process.argv.slice(2);
if (!root || !output) throw new Error('Aufruf: node scripts/measure-post-ruin-mortality.mjs <Quellordner> <Ausgabe.json> [strained]');
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk, buildMonteCarloAggregates, attachMonteCarloBatchOutcome } = await load('app/simulator/monte-carlo-runner.js');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Alle Logzeilen zusammen können V8s maximale Stringlänge überschreiten.
// Stückweise schreiben ergibt dieselben JSON-Bytes wie JSON.stringify(chunk).
function hashChunk(chunk) {
    const digest = createHash('sha256');
    digest.update('{');
    Object.entries(chunk).forEach(([key, value], index) => {
        digest.update(`${index ? ',' : ''}${JSON.stringify(key)}:`);
        if (key === 'runMeta') {
            digest.update('[');
            value.forEach((run, i) => { if (i) digest.update(','); digest.update(JSON.stringify(run)); });
            digest.update(']');
        } else digest.update(JSON.stringify(value));
    });
    return digest.update('}').digest('hex');
}
function leaves(value, prefix = '', out = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
        for (const [key, entry] of Object.entries(value)) leaves(entry, prefix ? `${prefix}.${key}` : key, out);
    } else out[prefix] = value;
    return out;
}
const result = { synthetic: true, parameters, useCapeSampling: false, scenarios: {} };
const scenarios = probe === 'strained' ? [['max-erika', false]]
    : ['max-erika', 'sophie'].flatMap(household => [true, false].map(care => [household, care]));
for (const [household, care] of scenarios) {
    const inputs = { ...await measurementInputs(0, household), pflegefallLogikAktivieren: care };
    if (probe === 'strained') Object.assign(inputs, { startFlexBedarf: 300000, minimumFlexAnnual: 60000 });
    const life = Array.from({ length: parameters.anzahl }, () => []);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: parameters, widowOptions: inputs.widowOptions,
        useCapeSampling: false, engine: EngineAPI, collectWealthFan: true,
        comparisonPairing: { mode: 'record', tapes: new Map(), continuationYears: new Map(),
            onYear: row => life[row.runIndex].push(row) } });
    if (!chunk.financialMetricsValid) throw new Error(JSON.stringify(chunk.technicalInventory));
    const aggregated = attachMonteCarloBatchOutcome(buildMonteCarloAggregates({ inputs, totalRuns: parameters.anzahl, ...chunk }), chunk.technicalInventory);
    const vectors = leaves({ buffers: chunk.buffers, pathSummaries: chunk.pathSummaries, pathMissingness: chunk.pathMissingness });
    const paths = life.map((rows, index) => ({
        ruined: chunk.pathSummaries.outcomeCode[index] === 1,
        financialSha256: hash(chunk.runMeta[index]),
        lifeUntilRuinSha256: hash(rows.filter(row => row.historicalYear !== null)),
        postRuinLifeSha256: hash(rows.filter(row => row.historicalYear === null)),
        fields: Object.fromEntries(Object.entries(vectors).filter(([, vector]) => ArrayBuffer.isView(vector))
            .map(([key, vector]) => [key, vector[index]]))
    }));
    const id = `${household}/care-${care ? 'on' : 'off'}${probe === 'strained' ? '/strained' : ''}`;
    const chunkSha256 = hashChunk(chunk);
    result.scenarios[id] = { inputsSha256: hash(inputs), chunkSha256, aggregatedSha256: hash(aggregated),
        outcome: aggregated.outcomeInventory, paths,
        aggregateFields: Object.fromEntries(Object.entries(leaves(aggregated)).map(([key, value]) => [key, hash(value)])) };
    writeFileSync(output, JSON.stringify(result) + '\n');
    console.log(`${id}: ${parameters.anzahl} Läufe, ${chunk.totals.failCount} Ruine, SHA-256 ${chunkSha256}`);
}
