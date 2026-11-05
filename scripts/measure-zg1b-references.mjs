// node scripts/measure-zg1b-references.mjs <Ausgabe.json> [Ausgangsquellordner]
// Der optionale Ordner enthält unveränderte Kopien der vier Fachmodule.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [output, baseline] = process.argv.slice(2);
assert(output);
if (baseline) {
    const files = ['app/profile/household-partnership.js', 'app/simulator/simulator-inheritance.js',
        'app/simulator/planned-inflows.js', 'app/simulator/simulator-engine-direct.js'];
    const originals = Object.fromEntries(files.map(file => [file, readFileSync(resolve(baseline, file), 'utf8')]));
    register(`data:text/javascript,${encodeURIComponent(`
        const originals=${JSON.stringify(originals)};
        export async function load(url,context,next) {
            const result=await next(url,context);
            for(const [file,source] of Object.entries(originals))if(url.endsWith('/'+file))return {...result,source};
            return result;
        }`)}`);
}
const { parityChunk, resultHashes, characteristicIndices, parityParams } = await import('../tests/helpers/md-2-parity.mjs');
const { readEV1bReferences } = await import('../tests/helpers/ev-1b-expectations.mjs');
const previous = JSON.parse(readFileSync(new URL('../tests/fixtures/md-2-parity-before.json', import.meta.url)));
const cases = {};
for (const [name, reference] of Object.entries(previous.cases)) {
    const [method, home] = name.split('/');
    const chunk = await parityChunk(method, home === 'home');
    assert.equal(chunk.technicalInventory.technicalError, 0);
    const before = readEV1bReferences(reference.hashes), after = resultHashes(chunk);
    if (baseline || home === 'no-home') assert.deepEqual(after, before, name);
    cases[name] = { before, after, characteristicIndices: characteristicIndices(chunk.runMeta) };
}
writeFileSync(output, JSON.stringify({ reason: 'ZG-1b: Familienheim kürzt den steuerfreien Zugewinn; vollständige Ausgangsreferenzen bleiben erhalten.',
    runtime: { node: process.version, platform: process.platform },
    params: parityParams, cases }, null, 2) + '\n');
