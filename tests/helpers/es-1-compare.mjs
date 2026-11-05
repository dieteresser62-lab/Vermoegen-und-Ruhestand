// Prüft vollständige Ergebnisprüfsummen; keine Filter in MC- oder Balance-Ergebnissen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [beforeFile, afterFile, nvBeforeFile, nvB01File, output, beforeRevision] = process.argv.slice(2);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before = read(beforeFile), after = read(afterFile), nvBefore = read(nvBeforeFile), nvB01 = read(nvB01File);
assert.deepEqual(before.parameters, after.parameters);
assert.equal(after.parameters.anzahl, 2000); assert.equal(after.parameters.seed, 12345);
assert.equal(after.testDate, '2026-10-23'); assert.equal(before.testDate, after.testDate);
const compatibility = {};
for (const key of ['married', 'unmarried50', 'unmarried0', 'noHome', 'floor100']) {
    assert.deepEqual(before.scenarios[key], after.scenarios[key], `${key}: vollständige Chunks bytegleich`);
    compatibility[key] = { before: before.scenarios[key].sha256, after: after.scenarios[key].sha256 };
}
assert.deepEqual(before.compatibility, after.compatibility, 'Balance-Eingabe, Balance-Rechnung und Parität bytegleich');
Object.assign(compatibility, Object.fromEntries(Object.entries(before.compatibility).map(([key, value]) => [key, { before: value, after: value }])));
for (const key of Object.keys(before.scenarios)) {
    assert.equal(before.scenarios[key].inputsSha256, after.scenarios[key].inputsSha256, `${key}: identische vollständige Eingaben`);
    assert(after.scenarios[key].maxFlowDelta < .01, `${key}: Jahresfluss bilanziert`);
}
assert(after.counterchecks[0].shortfall < 1, 'Gegenprobe: keine ungedeckte Steuer');
assert(Math.abs(after.counterchecks[1].survivorMoney - 100000) < 1, 'Eigenes Geld erhalten');
assert(before.counterchecks[0].shortfall > 40000, 'Ausgangsfehler reproduziert');
assert.deepEqual(nvBefore, nvB01, 'Isolierter Hausabgang B-01: komplette NV-1-Messung unverändert');
const evidence = { synthetic: true, beforeRevision, testDate: after.testDate, parameters: after.parameters,
    basis: 'Max/Erika: Haus 800000 EUR bei Max, unverheiratet, Haus + Steuer, 0 %. Groß wie EP-3: Geld 3 Mio. EUR 90/10, Haus 800000 EUR bei Max, Erika PG2 üblich, Haus + Steuer + 25 %, Standard ohne Anleihen. Pflege an; 35 Jahre. Mediane über alle 2000 Pfade einschließlich Nullpfaden, Steuer und X nominale Pfadsummen, Endvermögen real. Verkaufssteuer auf X: zusätzliche Jahressteuer für die Liquidation ausschließlich dieses Depotanteils; im Ausgangsordner nur lesende Messsonde, keine Änderung an Rechnung oder Logs. Gegenproben mit 1000000 EUR Depot/500000 EUR Einstand und optional zusätzlich 200000 EUR Tagesgeld; Pauschbetrag dort 1000 EUR, Kirchensteuer null.',
    before, after, compatibility, compatibilitySha256: hash(compatibility),
    nv1IsolatedB01: { before: nvBefore, after: nvB01, sha256: hash(nvB01),
        scope: 'Nur Hausabgang an Dritte, isoliert von der Netto-Steuergeldkorrektur; 3 Haushalte mit je 2000 Pfaden sowie sämtliche historischen Gegenproben. Vollständige Ergebnisse einschließlich Chunk-Prüfsummen identisch.' } };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ compatibilitySha256: evidence.compatibilitySha256, nv1Sha256: evidence.nv1IsolatedB01.sha256 }));
