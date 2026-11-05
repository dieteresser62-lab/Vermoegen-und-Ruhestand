// Kompakte synthetische Messbelege aus vollständigen MC-Chunks, ohne Ergebnisfilter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [beforeFile, afterFile, output, revision] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforeFile, 'utf8')), after = JSON.parse(readFileSync(afterFile, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compact = ({ paths, ...summary }) => summary;
assert.deepEqual(before.parameters, after.parameters);
assert.equal(before.parameters.anzahl, 2000);
assert.equal(before.parameters.seed, 12345);
assert.deepEqual(Object.keys(before.scenarios), Object.keys(after.scenarios));
const result = { synthetic: true, beforeRevision: revision, parameters: before.parameters,
    basis: 'Muster Max/Erika mit Haus 800000 EUR bei Max, unverheiratet, Immobilien und Steuer + 0 %. Groß wie EP-2: 3 Mio. EUR Geld 90/10, Haus 800000 EUR bei Max, Erika heute PG2 üblich. Renate mit Wohnung 300000 EUR, heute PG3 üblich. Pflege an, 35 Jahre; Strategie und Eingaben vor/nach unverändert. Groß: Standard, keine Anleihen. Endvermögen real; Erbschaftsteuer nominale Pfadsumme, Median über alle 2000 Läufe einschließlich Nullpfaden. Verkaufsjahr: erstes Verkaufsjahr je Lauf. Vor Tod: Verkauf zu Lebzeiten des ursprünglichen Eigentümers, unabhängig von einem späteren finanziellen Ruin oder Tod außerhalb des Horizonts. Erst nach dessen Nachlass verkaufte Anteile zählen dort nicht.',
    before: {}, after: {}, compatibility: {} };
const backtestsBefore = [], backtestsAfter = [], unchangedBefore = [], unchangedAfter = [];
for (const [key, old] of Object.entries(before.scenarios)) {
    const current = after.scenarios[key], strategy = key.startsWith('renate/') ? '3_bucket_jilge' : 'standard';
    assert.equal(old.inputsSha256, current.inputsSha256, `${key}: gleiche vollständige Eingaben`);
    assert.equal(old.strategy, strategy); assert.equal(current.strategy, strategy);
    assert.equal(old.bonds, current.bonds);
    if (key.startsWith('gross/')) assert.equal(old.bonds, 0, 'Groß enthält keine Anleihen');
    result.before[key] = { strategy, ...compact(old) }; result.after[key] = { strategy, ...compact(current) };
    assert.equal(old.backtestSha256, current.backtestSha256, `${key}: Backtest bytegleich`);
    backtestsBefore.push([key, old.backtestSha256]); backtestsAfter.push([key, current.backtestSha256]);
    assert.equal(old.paths.length, 2000); assert.equal(current.paths.length, 2000);
    let unchanged = 0, changed = 0;
    for (let i = 0; i < 2000; i++) {
        const a = old.paths[i], b = current.paths[i];
        if (a.sha256 !== b.sha256) changed++;
        if (a.sale || b.sale) continue;
        assert.equal(a.sha256, b.sha256, `${key}/${i}: ohne Pflegeverkauf bytegleich`);
        unchangedBefore.push([key, i, a.sha256]); unchangedAfter.push([key, i, b.sha256]); unchanged++;
    }
    result.compatibility[key] = { unchangedWithoutSalePaths: unchanged, changedPaths: changed };
}
for (const key of ['noHome', 'sophie']) {
    assert.deepEqual(before.compatibility[key], after.compatibility[key], `${key}: vollständige Chunks, Pfadhashes und Backtest bytegleich`);
    result.compatibility[key] = { before: compact(before.compatibility[key]), after: compact(after.compatibility[key]) };
}
for (const key of ['parity', 'balance', 'balanceCalculation']) {
    assert.equal(before.compatibility[key], after.compatibility[key], `${key}: bytegleich`);
    result.compatibility[key] = { before: before.compatibility[key], after: after.compatibility[key] };
}
result.compatibility.allBacktests = { count: backtestsBefore.length, before: hash(backtestsBefore), after: hash(backtestsAfter) };
result.compatibility.allWithoutSalePaths = { count: unchangedBefore.length, before: hash(unchangedBefore), after: hash(unchangedAfter) };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.compatibility, null, 2));
