import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [beforeFile, afterFile, historicalBeforeFile, historicalAfterFile, lowerFile, upperFile, output] = process.argv.slice(2);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before = read(beforeFile), after = read(afterFile);
assert.deepEqual(before.inputs, after.inputs);
assert.deepEqual(before.parameters, after.parameters);
assert.equal(after.parameters.anzahl, 2000);
assert.equal(after.parameters.seed, 12345);
assert.equal(after.parameters.methode, 'regime_markov');
for (const key of ['usual', 'none']) assert.deepEqual(before.scenarios[key], after.scenarios[key], `${key}: vollständige MC-Ergebnisse und Lebenspfade bytegleich`);
const backtests = [];
for (const key of Object.keys(before.scenarios)) {
    assert.equal(before.scenarios[key].inputsSha256, after.scenarios[key].inputsSha256);
    assert.deepEqual(before.scenarios[key].counterchecks, after.scenarios[key].counterchecks, `${key}: Backtests bytegleich`);
    backtests.push(...before.scenarios[key].counterchecks);
}
const historicalBefore = read(historicalBeforeFile), historicalAfter = read(historicalAfterFile);
assert.deepEqual(historicalBefore.inputs, historicalAfter.inputs);
assert.deepEqual(historicalBefore.parameters, historicalAfter.parameters);
assert.equal(historicalAfter.parameters.anzahl, 2000);
const sensitivity = [read(lowerFile), read(upperFile)];
for (const [index, run] of sensitivity.entries()) {
    assert.equal(run.slowerFactor, [.35, .65][index]);
    assert.deepEqual(after.inputs, run.inputs);
    assert.deepEqual(after.parameters, run.parameters);
    assert.equal(after.scenarios.slower.inputsSha256, run.scenarios.slower.inputsSha256);
    assert.deepEqual(after.scenarios.slower.counterchecks, run.scenarios.slower.counterchecks);
}
const compact = run => ({ ...run, inputs: undefined, scenarios: Object.fromEntries(
    Object.entries(run.scenarios).map(([key, value]) => [key, { ...value, chunks: undefined }])) });
writeFileSync(output, JSON.stringify({ synthetic: true, baseline: before.baseline, testDate: after.testDate,
    inputs: after.inputs, definitions: after.definitions, before: compact(before), after: compact(after),
    historical: { before: compact(historicalBefore), after: compact(historicalAfter) },
    sensitivity: sensitivity.map(compact), byteEquality: {
        usualCompleteMcSha256: after.scenarios.usual.completeChunksSha256,
        noCurrentGradeCompleteMcSha256: after.scenarios.none.completeChunksSha256,
        allTwelveBacktestsSha256: hash(backtests), backtestCount: backtests.length,
        policy: 'SHA-256 über vollständige serialisierte Ergebnisse ohne Feldfilter; MC sequenziell in 100er-Chunks.'
    } }, null, 2) + '\n');
console.log('MC-Kontrollen und alle zwölf Backtests bytegleich; Messbeleg geschrieben.');
