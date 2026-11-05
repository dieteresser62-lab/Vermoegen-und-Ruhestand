/** FR-47-Ursachenprobe; schreibt weder Quellen noch historische Referenzen.
 * node scripts/measure-care-allowance-deltas.mjs tests/<Datei>.test.mjs collect|control /tmp/<Ergebnis>.json
 * collect misst volle geänderte Hashes; control schaltet nur Pflegegeld aus und prüft alle alten Erwartungen.
 */
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [file, mode, output] = process.argv.slice(2);
{
    const loader = `export async function load(url, context, nextLoad) {
        const result = await nextLoad(url, context);
        if (url.endsWith('/tests/helpers/pg-1b-expectations.mjs')) return { ...result, source: String(result.source).replace('pg1bEvidence.hashes[before] ?? before', 'before') };
        if (${mode !== 'control'} || !url.endsWith('/app/shared/care-benefits.js')) return result;
        const source = String(result.source), target = "if (preset === 'amtlich' || careForm !== 'family') return 0;";
        if (!source.includes(target)) throw new Error('Pflegegeld-Ableitung fehlt.');
        return { ...result, source: source.replace(target, 'return 0; // Nur diese Ursachenprobe: kein Pflegegeld') };
    }`;
    register(`data:text/javascript,${encodeURIComponent(loader)}`);
}
const { installAssertionGlobals } = await import(pathToFileURL(process.cwd()+'/tests/run-tests.mjs'));
const counters = installAssertionGlobals({ verbosePasses: false });
const assertEqualOriginal = globalThis.assertEqual;
const hashes = {}, labels = [];
if (mode === 'collect') globalThis.assertEqual = (actual, expected, label) => {
    if (actual !== expected && /^[a-f0-9]{64}$/.test(actual) && /^[a-f0-9]{64}$/.test(expected)) {
        if (hashes[expected] && hashes[expected] !== actual) throw new Error('Nicht eindeutiger Delta-Hash.');
        hashes[expected] = actual; labels.push({ expected, actual, label });
        return assertEqualOriginal(actual, actual, 'Nur Messung, keine Freigabe: ' + label);
    }
    return assertEqualOriginal(actual, expected, label);
};
await import(pathToFileURL(process.cwd()+'/'+file));
const result = { file, mode, totalAssertions: counters.total, failedAssertions: counters.failedAssertions, hashes, labels };
if (counters.failedAssertions) throw new Error('Ursachenprobe mit weiteren Befunden.');
writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
