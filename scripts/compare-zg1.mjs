// node scripts/compare-zg1.mjs <vorher.json> <nachher.json> <Beleg.json> [Parität-vorher] [Parität-nachher]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [beforePath, afterPath, output, parityBefore, parityAfter] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path));
const before = read(beforePath), after = read(afterPath);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.deepEqual(before.params, after.params);
const evidence = { params: before.params, testDate: before.testDate, households: [] };
for (const [i, a] of before.households.entries()) {
    const b = after.households[i]; assert(b && a.id === b.id && a.variant === b.variant);
    assert.deepEqual(a.inputs, b.inputs); assert.deepEqual(a.fixedBacktests, b.fixedBacktests);
    assert.deepEqual(a.controls, b.controls);
    let lowerTax = 0, withAllowance = 0, unchangedWithoutAllowance = 0, changedPaths = 0;
    assert.equal(a.paths.length, before.params.anzahl); assert.equal(a.paths.length, b.paths.length);
    for (const [j, p] of a.paths.entries()) {
        const q = b.paths[j]; assert.equal(p.index, q.index);
        if (p.hash !== q.hash) changedPaths++;
        assert.equal(p.death?.year, q.death?.year);
        if ((q.death?.estate.exemptGain || 0) > 0) withAllowance++;
        else { assert.equal(p.hash, q.hash, `${a.id}/${a.variant}/${p.index}: Änderung ohne Ausgleich`); unchangedWithoutAllowance++; }
        if (p.death && q.death.tax < p.death.tax - 1e-7) { assert(q.death.estate.exemptGain > 0); lowerTax++; }
        if (p.death) assert(q.death.tax <= p.death.tax + 1e-7);
    }
    const row = { id: a.id, variant: a.variant, inputsHash: hash(a.inputs), inputs: a.inputs,
        before: a.metrics, after: b.metrics, lowerTax, withAllowance, unchangedWithoutAllowance, changedPaths,
        beforeChunks: a.chunks, afterChunks: b.chunks, fixedBacktests: a.fixedBacktests, byteControls: a.controls };
    evidence.households.push(row);
    console.log(`${a.id}/${a.variant}: Steuer Median ${a.metrics.taxMedian.toFixed(2)} → ${b.metrics.taxMedian.toFixed(2)}, P90 ${a.metrics.taxP90.toFixed(2)} → ${b.metrics.taxP90.toFixed(2)}; ${lowerTax} niedrigere Steuer, ${unchangedWithoutAllowance} bytegleich ohne Ausgleich`);
}
assert.equal(before.households.length, after.households.length);
if (parityBefore && parityAfter) {
    const differences = new Map(), files = readdirSync(parityBefore).filter(f => f.endsWith('.json'));
    const allowed = new Set(['sourceHash','logHash','caseHash','durationMs','runtimeTargetMet']);
    let cases = 0;
    function compare(a,b,path='') {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        assert.equal(typeof a,typeof b,path);
        if (a && typeof a === 'object') {
            assert.deepEqual(Object.keys(a),Object.keys(b),path);
            for (const k of Object.keys(a)) {
                if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
                const p=path+'.'+k;
                if (allowed.has(k)) differences.set(p,(differences.get(p)||0)+1);
                else compare(a[k],b[k],p);
            }
        } else assert.deepEqual(a,b,path);
    }
    for (const f of files) { const a=read(parityBefore+'/'+f),b=read(parityAfter+'/'+f);compare(a,b);if(a.schemaVersion==='ParityCaseV1')cases++; }
    evidence.parity = { cases, changedMetadata: Object.fromEntries(differences), before: read(parityBefore+'/zusammenfassung.json'), after: read(parityAfter+'/zusammenfassung.json') };
}
writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
