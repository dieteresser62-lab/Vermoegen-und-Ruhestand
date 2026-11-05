// Vollständige Pfadergebnisse vergleichen; nur kompakte synthetische Belege ablegen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [beforeFile, afterFile, output] = process.argv.slice(2);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const before = read(beforeFile), after = read(afterFile);
const ep2 = read(new URL('../fixtures/ep-2-home-sale-measurement.json', import.meta.url));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compact = ({ paths, ...summary }) => summary;
assert.deepEqual(before.parameters, after.parameters);
assert.equal(before.parameters.anzahl, 2000);
assert.deepEqual(Object.keys(before.scenarios), Object.keys(after.scenarios));
const result = { sourceRevision: '53525307664e05b0d76036722aabdefa6f8100bf',
    basis: before.basis, parameters: before.parameters, before: {}, after: {}, compatibility: {} };
const unchangedBefore = [], unchangedAfter = [], backtestsBefore = [], backtestsAfter = [];
for (const [key, old] of Object.entries(before.scenarios)) {
    const current = after.scenarios[key];
    if (ep2.after[key]) assert.deepEqual(compact(old), ep2.after[key], `${key}: Ausgangsstand entspricht EP-2`);
    result.before[key] = compact(old); result.after[key] = compact(current);
    assert.equal(old.backtestSha256, current.backtestSha256, `${key}: Backtest bytegleich`);
    backtestsBefore.push([key, old.backtestSha256]); backtestsAfter.push([key, current.backtestSha256]);
    assert.equal(old.paths.length, before.parameters.anzahl);
    assert.equal(current.paths.length, old.paths.length);
    let protectedPaths = 0, changedPaths = 0;
    for (let i = 0; i < old.paths.length; i++) {
        const a = old.paths[i], b = current.paths[i];
        if (a.sha256 !== b.sha256) changedPaths++;
        // Die Vereinigung erfasst auch einen durch die Korrektur verhinderten Ruin im Todesjahr.
        if (key.includes('homeAndTax') || a.deathWithExternalPartner || b.deathWithExternalPartner) continue;
        assert.equal(a.sha256, b.sha256, `${key}/${i}: ohne FR-54 und Tod bei externer Partnerpflege bytegleich`);
        unchangedBefore.push([key, i, a.sha256]); unchangedAfter.push([key, i, b.sha256]); protectedPaths++;
    }
    result.compatibility[key] = { protectedPaths, changedPaths, backtestSha256: old.backtestSha256 };
}
for (const key of ['parity', 'balance']) {
    assert.equal(before.compatibility[key], after.compatibility[key], `${key}: bytegleich`);
    assert.equal(before.compatibility[key], ep2.compatibility[key].after, `${key}: entspricht EP-2`);
    result.compatibility[key] = { before: before.compatibility[key], after: after.compatibility[key] };
}
const sophieBefore = compact(before.compatibility.sophie), sophieAfter = compact(after.compatibility.sophie);
assert.deepEqual(sophieBefore, sophieAfter, 'Sophie: vollständige Chunks und Backtest bytegleich');
assert.deepEqual(sophieBefore, ep2.compatibility.sophie.after, 'Sophie: entspricht EP-2');
result.compatibility.sophie = { before: sophieBefore, after: sophieAfter };
result.compatibility.allUnchangedPaths = { count: unchangedBefore.length,
    before: hash(unchangedBefore), after: hash(unchangedAfter) };
result.compatibility.allBacktests = { count: backtestsBefore.length,
    before: hash(backtestsBefore), after: hash(backtestsAfter) };
assert(unchangedBefore.length > 0);
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.compatibility, null, 2));
