import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { unchangedEngineSamples, unchangedSimulatorSamples } from './helpers/ff-b-bytegleich-scenarios.mjs';

// FR-30 ändert diese zuvor unter FF-B unveränderten Zielwerte; neue FF-D-Referenz.
// Alt-neu-Hashes stehen in fixtures/ff-d-expectation-deltas.json; unbetroffene Bytes in ff-d-regression.test.mjs.
// Keine Projektion, Feldfilter oder Rundung; ausschließlich synthetische Eingaben.
const engine = unchangedEngineSamples(EngineAPI);
const simulator = unchangedSimulatorSamples({ initMcRunState, simulateOneYear, engine: EngineAPI });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const result of engine) {
    assert(!result.error, 'Unbetroffenes Enginejahr ist gültig');
    assert(!result.ui.vpw.wishFlexCapApplied && !result.diagnosis.general.severeFlexEmergencyActive,
        'Unbetroffenes Enginejahr hat weder Notlage noch greifende Obergrenze');
}
for (const result of simulator) {
    assertEqual(result.kind, 'success', 'Unbetroffenes Simulatorjahr ist gültig');
    assert(result.logData.cashInterestEarned >= 0, 'Unbetroffenes Simulatorjahr ohne negative Zinsen');
    assert(!result.logData.SevereFlexEmergencyActive, 'Unbetroffenes Simulatorjahr ohne Notlage');
}
assertEqual(hash(engine), readQSCReferences(readGL1References(readJB2Hash('f54fa84794651a29d3f07a096df9942a7f750b0e86ec2a289581bae61f59eb75'))), 'Sechs vollständige Engine-Ergebnisse nach FR-20/33/34 auf BK-2-Referenz');
assertEqual(hash(simulator), readQSCReferences(readGL1References(readJB2Hash('c12e991667ed28da619b3fbfd3db39ec23aee5a137c655c0eeef2c25018a0503'))), 'Drei vollständige Simulator-Ergebnisse nach FR-20/33/34 auf BK-2-Referenz');
