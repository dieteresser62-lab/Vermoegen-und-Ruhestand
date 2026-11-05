// node scripts/compare-zg1b.mjs <vorher.json> <nachher.json> <Beleg.json>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [beforePath, afterPath, output] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path));
const before = read(beforePath), after = read(afterPath);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.deepEqual(before.params, after.params);
assert.equal(before.households.length, 2);
assert.equal(after.households.length, 2);
const evidence = { params: before.params, testDate: before.testDate, households: [] };
for (const [i, a] of before.households.entries()) {
    const b = after.households[i];
    assert.equal(a.id, b.id); assert.equal(a.variant, b.variant);
    assert.deepEqual(a.inputs, b.inputs);
    assert.deepEqual(a.fixedBacktests, b.fixedBacktests);
    assert.deepEqual(a.controls, b.controls);
    assert.equal(a.paths.length, before.params.anzahl);
    assert.equal(a.paths.length, b.paths.length);
    let higherTax = 0, changedPaths = 0, unchangedPaths = 0;
    const taxChanges = [];
    for (const [j, p] of a.paths.entries()) {
        const q = b.paths[j];
        assert.equal(p.index, q.index);
        assert.equal(p.death?.year, q.death?.year);
        const affected = p.death && ((p.death.estate.inheritedHome > 0 && a.inputs.home?.some(home => home.profileId === p.death.estate.deceasedProfileId && home.nutzung === 'selbst'))
            || a.inputs.plannedInflows?.some(inflow => inflow.year - a.inputs.plannedInflowsReferenceYear < p.death.year));
        const delta = (q.death?.tax || 0) - (p.death?.tax || 0);
        assert(delta >= -1e-7, `${a.id}/${p.index}: unerwartet niedrigere Steuer`);
        if (delta > 1e-7) {
            assert(affected, `${a.id}/${p.index}: Steueranstieg ohne Familienheim oder Zufluss`);
            higherTax++;
            taxChanges.push({ index: p.index, before: p.death.tax, after: q.death.tax });
        }
        if (p.hash === q.hash) unchangedPaths++;
        else { assert(affected, `${a.id}/${p.index}: andere Änderung`); changedPaths++; }
    }
    const row = { id: a.id, variant: a.variant, inputsHash: hash(a.inputs), inputs: a.inputs,
        before: a.metrics, after: b.metrics, higherTax, changedPaths, unchangedPaths, taxChanges,
        beforeChunks: a.chunks, afterChunks: b.chunks, fixedBacktests: a.fixedBacktests, byteControls: a.controls };
    evidence.households.push(row);
    console.log(`${a.id}/${a.variant}: Steuer Median ${a.metrics.taxMedian.toFixed(2)} → ${b.metrics.taxMedian.toFixed(2)}, P90 ${a.metrics.taxP90.toFixed(2)} → ${b.metrics.taxP90.toFixed(2)}; ${higherTax} höhere Steuer, ${unchangedPaths} Pfade bytegleich`);
}
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
