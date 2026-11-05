// Vollreferenzen nach MD-2 messen und mit den unveränderten Ausgangsmodulen prüfen.
// node scripts/measure-md2-deltas.mjs tests/<Datei>.test.mjs collect|control <Ausgabe.json> [Ausgangsordner]
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [file, mode, output, baseline] = process.argv.slice(2);
if (!['collect', 'control'].includes(mode) || !output || mode === 'control' && !baseline) throw new Error('Datei, collect|control, Ausgabe und gegebenenfalls Ausgangsordner angeben.');
const changed = ['mc-run-metrics.js', 'monte-carlo-runner.js', 'mc-year-sampling.js',
    'stationary-bootstrap-sampler.js', 'scenario-analyzer.js', 'scenario-wealth-chart.js',
    'scenario-comparison.js', 'scenario-log-view.js', 'simulator-results.js'].map(file => 'app/simulator/' + file);
const originals = mode === 'control' ? Object.fromEntries(changed.map(file => [file, readFileSync(resolve(baseline, file), 'utf8')])) : {};
register(`data:text/javascript,${encodeURIComponent(`
const originals = ${JSON.stringify(originals)};
export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (url.endsWith('/tests/helpers/md-2-expectations.mjs')) return { ...result,
        source: 'export const md2Evidence={numericLeaves:{}}; export const readMD2References=value=>value;' };
    for (const [file, source] of Object.entries(originals)) if (url.endsWith('/' + file)) return { ...result, source };
    return result;
}`)}`);
const { installAssertionGlobals, getTestExecutionPolicy } = await import('../tests/run-tests.mjs');
const counters = installAssertionGlobals({ verbosePasses: false });
const original = globalThis.assertEqual, hashes = {}, labels = [], counts = {};
function collect(actual, expected, label) {
    if (actual === expected) return false;
    if (typeof actual === 'number' && typeof expected === 'number' && /sämtliche Zahlenfelder/.test(label)) {
        counts[label] = { before: expected, after: actual }; return true;
    }
    if (typeof actual === 'string' && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(actual) && /^[a-f0-9]{64}$/.test(expected)) {
        if (hashes[expected] && hashes[expected] !== actual) throw new Error('Mehrdeutiges Hashdelta.');
        hashes[expected] = actual; labels.push({ expected, actual, label }); return true;
    }
    if (typeof actual === 'string' && typeof expected === 'string' && /^[\[{]/.test(actual) && /^[\[{]/.test(expected)) {
        const a = JSON.parse(actual), e = JSON.parse(expected);
        let changed = false;
        const walk = (a, e, path) => {
            if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(e))) throw new Error('Veränderte Belegstruktur: ' + path);
            for (const key of Object.keys(e)) {
                if (a[key] && e[key] && typeof a[key] === 'object' && typeof e[key] === 'object') walk(a[key], e[key], path + '.' + key);
                else if (collect(a[key], e[key], path + '.' + key)) changed = true;
                else if (a[key] !== e[key]) throw new Error('Änderung außerhalb eines Hashwerts: ' + path + '.' + key);
            }
        };
        walk(a, e, label); return changed;
    }
    return false;
}
if (mode === 'collect') globalThis.assertEqual = (actual, expected, label) => collect(actual, expected, label)
    ? original(actual, actual, 'Messung: ' + label) : original(actual, expected, label);
if (getTestExecutionPolicy(file.split('/').at(-1)).instrumentAssertions) register(pathToFileURL(resolve('tests/legacy-assertion-loader.mjs')).href);
let completed = false;
try { await import(pathToFileURL(resolve(file))); completed = true; }
finally { writeFileSync(output, JSON.stringify({ file, mode, completed, totalAssertions: counters.total,
    failedAssertions: counters.failedAssertions, hashes, labels, counts }, null, 2) + '\n'); }
console.log(`${file}: ${mode}, ${Object.keys(hashes).length} Hashdeltas, ${counters.failedAssertions} Fehler`);
process.exit(counters.failedAssertions ? 1 : 0);
