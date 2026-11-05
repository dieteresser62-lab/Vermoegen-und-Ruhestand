import { readEV1bReferences, ev1bEvidence } from './helpers/ev-1b-expectations.mjs';
const readMD2References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readMD2References as readBeforeEV1bReferences, md2Evidence } from './helpers/md-2-expectations.mjs';
import { readZG1References as readBeforeMD2References, zg1Evidence } from './helpers/zg-1-expectations.mjs';
const readZG1References = value => readMD2References(readBeforeMD2References(value));
import { readEV1References as readBeforeZG1References, ev1Evidence } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences, qscEvidence } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences, vf2bEvidence } from './helpers/vf-2b-expectations.mjs';
import { gl1Evidence, readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAS1Hash, as1Evidence } from './helpers/as-1-expectations.mjs';
import { readEP1Hash, ep1Evidence } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash, rng1Evidence } from './helpers/rng-1-expectations.mjs';
import { readAN1Hash, an1Evidence } from './helpers/an-1-expectations.mjs';
import { incomeSurplusEvidence } from './helpers/ek-1d-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { kg1Samples, kg1Parameters } from './helpers/kg-1-scenarios.mjs';
import { withLegacyCareProvenance } from './helpers/pm-1-expectations.mjs';
import { nr1Evidence } from './helpers/nr-1-expectations.mjs';

const readRNG1Hash = before => readQSCReferences(readAS1Hash(readEP1Hash(readBeforeEP1Hash(before))));
const evidence = JSON.parse(readFileSync(new URL('./fixtures/kg-1-expectation-deltas.json', import.meta.url)));
assertEqual(nr1Evidence.parameters.paths, 2000, 'NR-1: Anzeigevergleich mit 2.000 festen MC-Pfaden belegt');
for (const [key, group] of Object.entries(nr1Evidence.groups)) {
    assertEqual(group.beforeUnchangedSha256, group.afterUnchangedSha256, `${key}: vollständiger Alt/Neu-Beleg außerhalb vk und Grundtexten bytegleich`);
}
const textFields = new Set(['kuerzungQuelle', 'CutReason', 'anmerkung']);
const hash = value => createHash('sha256').update(value).digest('hex');
function numericFingerprint(value) {
    const digest = createHash('sha256');
    let count = 0;
    digest.update('[');
    const visit = (current, path) => {
        if (typeof current === 'number') {
            if (count++) digest.update(',');
            digest.update(JSON.stringify([path, current]));
        } else if (current && typeof current === 'object') {
            for (const [key, child] of Object.entries(current)) visit(child, `${path}.${key}`);
        }
    };
    visit(value, '$');
    digest.update(']');
    return { count, hash: digest.digest('hex') };
}

const engineResults = [];
const samples = await kg1Samples({ onEngineResult: result => engineResults.push(result) });
assertEqual(JSON.stringify(kg1Parameters), JSON.stringify(evidence.parameters), 'KG-1: feste synthetische Messparameter');
assertEqual(samples.backtest.outcome.kind, 'completed', 'KG-1: Muster-Backtest 2000–2025 vollständig');
assertEqual(samples.mc.financialMetricsValid, true, 'KG-1: Monte Carlo ohne technische Ausfälle');
assertEqual(samples.mc.runMeta.length, kg1Parameters.paths, 'KG-1: alle 100 festen Seeds enthalten');
for (const [key, result] of Object.entries({ ...samples, engineResults })) {
    // JSON ist derselbe Exportvertrag wie bei der Vorhermessung, auch für TypedArrays.
    const serialized = JSON.stringify(withLegacyCareProvenance(result));
    const normalized = JSON.parse(serialized);
    const historical = evidence.groups[key];
    const surplus = incomeSurplusEvidence.kg1Groups[key];
    const expected = surplus || { ...historical, numericSha256: historical.beforeNumericSha256 };
    const display = nr1Evidence.kg1Groups[key];
    const numeric = numericFingerprint(normalized);
    assertEqual(historical.beforeNumericSha256, historical.afterNumericSha256, `${key}: historischer KG-1-Zahlenbeleg bleibt identisch`);
    assertEqual(display.before.numericSha256, expected.numericSha256, `${key}: NR-1-Ausgangsstand entspricht dem bisherigen Zahlenbeleg`);
    assertEqual(display.before.afterSha256, expected.afterSha256, `${key}: bisherige vollständige Referenz bleibt erhalten`);
    assertEqual(numeric.count, ev1bEvidence.numericLeaves[key] ?? md2Evidence.numericLeaves[key] ?? zg1Evidence.numericLeaves[key] ?? ev1Evidence.numericLeaves[key] ?? qscEvidence.numericLeaves[key] ?? vf2bEvidence.numericLeaves[key] ?? gl1Evidence.numericLeaves[key] ?? as1Evidence.numericLeaves[key] ?? ep1Evidence.numericLeaves[key] ?? rng1Evidence.numericLeaves[key] ?? an1Evidence.numericLeaves[key] ?? display.after.numericLeaves, `${key}: sämtliche Zahlenfelder einschließlich belegter Rentenreste`);
    assertEqual(numeric.hash, readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(display.after.numericSha256)))))), `${key}: jedes Zahlenfeld mit Pfad einschließlich korrigierter vk-Felder`);
    assertEqual(hash(JSON.stringify(normalized, (field, value) => textFields.has(field) ? undefined : value)), readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(display.after.unchangedExceptTextsSha256)))))), `${key}: vollständige Referenz ohne Grund und Anmerkung`);
    const unchangedHash = hash(JSON.stringify(normalized, (field, value) => field === 'vk' || textFields.has(field) ? undefined : value));
    assertEqual(unchangedHash, readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(display.before.unchangedExceptDisplaySha256)))))), `${key}: vollständiger Feldvergleich außerhalb vk und Grundtexten mit belegten FR-46-Käufen`);
    assertEqual(hash(serialized), readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(display.after.afterSha256)))))), `${key}: vollständige Ergebnisse einschließlich Gründe, vk und Rentenreste`);
}
for (const row of [...samples.backtest.rows.map(entry => entry.row), ...samples.mc.runMeta.flatMap(meta => meta.logDataRows)]) {
    if (!row.entscheidung) continue;
    assertEqual(row.CutReason, row.entscheidung.kuerzungQuelle, 'KG-1: Log und Anmerkungsquelle nennen denselben Grund');
    if (row.SevereFlexEmergencyActive && row.FinalLimitingPolicy === 'safety_cap') {
        assertEqual(row.CutReason, 'Safety-Cap (schwere Flex-Notlage)', 'KG-1: bindende Notlage hat auch im Simulator Vorrang');
    }
}
