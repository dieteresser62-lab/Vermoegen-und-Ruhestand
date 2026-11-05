/** PM-1a: sequenzielle 2.000-Pfad-Messung einer Wegwerf-Arbeitskopie.
 * node scripts/measure-care-model.mjs <worktree> <output.json> [no-care]
 * Eintrittssensitivität: in der neuen Arbeitskopie die Build-Totals mit
 * 0,7 bzw. 1,3 multiplizieren und den Demografievertrag dort neu erzeugen.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withLegacyCareProvenance } from '../tests/helpers/pm-1-expectations.mjs';
const [source, output, mode] = process.argv.slice(2);
if (!source || !output) throw new Error('Arbeitskopie und Ausgabedatei erforderlich.');
const load = file => import(pathToFileURL(resolve(source, file)));
const { inputs: fixture } = await load('tests/extended/parity-replay-fixture.mjs');
const { readCareInputs } = await load('app/simulator/simulator-input-care.js');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { createStressReplayCaptureRequest } = await load('app/simulator/stress-replay-path-materializer.js');
const { EngineAPI } = await load('engine/index.mjs');
const html = readFileSync(resolve(source, 'Simulator.html'), 'utf8');
const defaults = readCareInputs({ doc: { getElementById(id) {
    const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    return tag ? { value: tag.match(/\bvalue="([^"]*)"/)?.[1] ?? '', checked: /\bchecked\b/.test(tag) } : null;
} } });
const inputs = { ...structuredClone(fixture), ...defaults,
    pflegefallLogikAktivieren: mode !== 'no-care', pflegeModellTyp: 'chronisch' };
// Identische explizite ungenutzte Pflegeeingaben für den Bytevergleich.
if (mode === 'no-care') for (const [i, config] of Object.values(inputs.pflegeGradeConfigs).entries()) {
    config.mortalityFactor = [0, 0, 3, 5, 5][i];
}
const params = { anzahl: 2000, maxDauer: 35, methode: 'block', blockSize: 3, seed: 12345,
    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const digest = createHash('sha256'), paths = [];
const comparisonDigest = createHash('sha256');
let outputBytes = 0, gradeYears = 0, highGradeYears = 0;
for (let start = 0; start < params.anzahl; start += 50) {
    const indices = Array.from({ length: 50 }, (_, i) => start + i);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params,
        widowOptions: inputs.widowOptions, useCapeSampling: true, runRange: { start, count: 50 },
        logIndices: new Set(indices), stressReplayCapture: createStressReplayCaptureRequest(indices), engine: EngineAPI });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Technischer Messfehler.');
    const bytes = JSON.stringify({ ...chunk, wealthFan: chunk.wealthFan });
    digest.update(bytes); outputBytes += Buffer.byteLength(bytes);
    comparisonDigest.update(JSON.stringify(withLegacyCareProvenance({ ...chunk, wealthFan: chunk.wealthFan })));
    for (const [i, meta] of chunk.runMeta.entries()) {
        for (const year of meta.stressReplayCapture.years) {
            if (year.continuation) continue; // Gleicher Horizont wie runMeta.totalCareYears, vor Schattenfortsetzung.
            for (const event of year.householdEvents) for (const p of [1, 2]) {
                const care = event[`careMetaP${p}`];
                if (!care?.active) continue;
                const weight = event[`p${p}Alive`] ? 1 : .5;
                gradeYears += weight;
                if (care.grade >= 4) highGradeYears += weight;
            }
        }
        paths.push({ index: meta.index, failed: meta.failed, care: meta.careEverActive,
            realEnd: chunk.pathSummaries.finalValueRealEur[i], careYears: meta.totalCareYears,
            careCostReal: meta.totalCareAdditionalNeedRealEur });
    }
    if ((start + 50) % 250 === 0) console.log(`${mode || 'care'}: ${start + 50}/2000`);
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b), pos = (sorted.length - 1) * q;
    return sorted[Math.floor(pos)] + (sorted[Math.ceil(pos)] - sorted[Math.floor(pos)]) * (pos % 1);
};
const carePaths = paths.filter(path => path.care), wealth = paths.map(path => path.realEnd);
const totalCareYears = paths.reduce((sum, path) => sum + path.careYears, 0);
if (paths.length !== 2000 || Math.abs(gradeYears - totalCareYears) > 1e-8) {
    throw new Error(`Unvollständige Messung: ${paths.length} Pfade; Gradjahre ${gradeYears} gegen ${totalCareYears}.`);
}
const result = { runtime: { node: process.version, platform: process.platform, arch: process.arch },
    params, inputs, completeOutputSha256: digest.digest('hex'), comparisonOutputSha256: comparisonDigest.digest('hex'), outputBytes,
    metrics: { successPct: 100 * paths.filter(path => !path.failed).length / paths.length,
        realEndP10: quantile(wealth, .1), realEndP50: quantile(wealth, .5), worstRealEnd: Math.min(...wealth),
        carePathPct: 100 * carePaths.length / paths.length, meanCareYearsPerCarePath: carePaths.length ? mean(carePaths.map(p => p.careYears)) : 0,
        meanCareCostRealPerCarePath: carePaths.length ? mean(carePaths.map(p => p.careCostReal)) : 0,
        grade45YearSharePct: gradeYears ? 100 * highGradeYears / gradeYears : 0, gradeYears, highGradeYears }, paths };
writeFileSync(output, JSON.stringify(result));
console.log(JSON.stringify({ ...result, inputs: undefined, paths: undefined }));
