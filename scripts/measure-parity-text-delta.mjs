// Vollständige synthetische Paritätsbelege vergleichen; nur Szenario-Ausgabetexte dürfen abweichen.
// node scripts/measure-parity-text-delta.mjs <vorher.json> <nachher.json> <Beleg.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.argv[2] === '--capture') {
    const [root, output] = process.argv.slice(3);
    assert(root && output, 'Quellordner und Messdatei angeben');
    const statement = `captureBytes(${JSON.stringify(resolve(output))}, JSON.stringify(legacyDisplay));\n`;
    register('data:text/javascript,' + encodeURIComponent(`
        export async function load(url, context, nextLoad) {
            const result = await nextLoad(url, context);
            if (!url.endsWith('/tests/immobilien-empty-bytegleich.test.mjs')) return result;
            const source = "import { writeFileSync as captureBytes } from 'node:fs';" +
                String(result.source).replace('assertEqual(hash(legacyDisplay),',
                    ${JSON.stringify(statement)} + 'assertEqual(hash(legacyDisplay),');
            return { ...result, source };
        }
    `));
    const { installAssertionGlobals } = await import(pathToFileURL(resolve(root, 'tests/run-tests.mjs')));
    installAssertionGlobals({ verbosePasses: false });
    await import(pathToFileURL(resolve(root, 'tests/immobilien-empty-bytegleich.test.mjs')));
    process.exit(0);
}

const [beforePath, afterPath, output] = process.argv.slice(2);
assert(beforePath && afterPath && output, 'Zwei Messbelege und Ausgabe angeben');
const beforeBytes = readFileSync(beforePath), afterBytes = readFileSync(afterPath);
const before = JSON.parse(beforeBytes), after = JSON.parse(afterBytes);
const changedText = [];
let numericLeaves = 0;
function compare(a, b, path = '') {
    assert.equal(typeof a, typeof b, `Gleicher Typ: ${path}`);
    if (a && typeof a === 'object') {
        assert.deepEqual(Object.keys(a), Object.keys(b), `Gleiche Struktur: ${path}`);
        for (const key of Object.keys(a)) compare(a[key], b[key], path ? `${path}.${key}` : key);
    } else if (/^scenarios\.[0-3]\.console$/.test(path) && a !== b) {
        assert.equal(typeof a, 'string');
        changedText.push({ path, before: a, after: b });
    } else {
        assert.equal(a, b, `Unveränderter Inhalt: ${path}`);
        if (typeof a === 'number') numericLeaves++;
    }
}
compare(before, after);
assert.equal(changedText.length, 4, 'Genau vier geänderte Szenario-Ausgabetexte');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const financialBefore = structuredClone(before), financialAfter = structuredClone(after);
for (const value of [financialBefore, financialAfter]) for (const scenario of value.scenarios) delete scenario.console;
assert.equal(JSON.stringify(financialBefore), JSON.stringify(financialAfter), 'Alle Inhalte außerhalb der Ausgabetexte bytegleich');
const evidence = { beforeHash: sha(beforeBytes), afterHash: sha(afterBytes),
    unchangedContentHash: sha(JSON.stringify(financialBefore)), numericLeaves, parityCases: before.cases.length, changedText };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(`${evidence.parityCases} Fälle, ${numericLeaves} Zahlenwerte und übrige Inhalte bytegleich; vier Ausgabetexte geändert.`);
