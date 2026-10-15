import assert from 'node:assert/strict';
import { EngineAPI } from '../../engine/index.mjs';
import { CONFIG } from '../../app/balance/balance-config.js';
import { dynamicFlexPresetPatch } from '../../app/shared/dynamic-flex-presets.js';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { createParityCase, validateParityCase } from '../../app/balance/parity-case.js';
import { hashParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { inputs, records, source, runFixture } from './parity-replay-fixture.mjs';
import { createParitySequenceSeed, runParityBalanceSequence, SEQUENCE_INCOMPLETE } from './parity-balance-sequence.mjs';
import { createParitySequenceCase, replayParitySequenceCase, parityRunFailed, summarizeParityScenario } from './parity-scenarios.mjs';
import { summarizeParityResiduals } from './parity-residuals.mjs';
import { nodeParityHash } from './parity-node-hash.mjs';

export function testParityScenarios() {
    let checks = 0;
    const equal = (a, b, message) => { assert.deepStrictEqual(a, b, message); checks++; };
    const ok = (value, message) => { assert.ok(value, message); checks++; };
    const bytes = JSON.stringify({ inputs, records });
    const collector = createParityReplayCollector({ source, initialRecords: records });
    const ruin = runFixture({ collector, input: { ...inputs, startFloorBedarf: 1e10,
        startFlexBedarf: 0, minimumFlexAnnual: 0 } });
    equal(ruin.outcome.kind, 'ruin', 'Früher wirtschaftlicher Terminalfall');
    equal(ruin.rows.length, 1, 'Keine weiteren Jahre nach Ruin');
    equal(collector.toLog().years.length, 1, 'Nur die tatsächliche Entscheidung des Terminaljahrs, kein Folgejahr');
    equal(parityRunFailed([], [ruin.outcome]), false, 'Wirtschaftlicher Ruin ist kein technischer Fehler');
    const failedCollector = createParityReplayCollector({ source, initialRecords: records });
    const failure = runFixture({ collector: failedCollector, engine: { simulateSingleYear() { throw Error('SYNTHETIC_ENGINE_FAILURE'); } } });
    equal(failure.outcome.kind, 'technical_error');
    equal(failure.rows.length, 0, 'Keine Auszahlung im technischen Terminaljahr');
    equal(parityRunFailed([], [failure.outcome]), true, 'Technischer Terminalfall setzt Fehlerexit');
    for (const status of ['FACHLICH_OFFEN', 'FEHLT_MODELL', 'FEHLT_LOG', 'PHASE_NICHT_VERGLEICHBAR', 'AUSGEKLAMMERT']) {
        equal(parityRunFailed([{ fields: [{ status, question: 3 }] }]), false, `${status} ist kein Fehlerexit`);
    }
    equal(parityRunFailed([{ fields: [{ status: 'TECHNISCHER_FEHLER' }] }]), true);
    equal(parityRunFailed([{ fields: [{ status: 'ABWEICHUNG' }] }]), true, 'Nicht klassifizierte Abweichung scheitert');
    equal(parityRunFailed([{ fields: [{ status: 'UNBEKANNT' }] }]), true);
    equal(parityRunFailed([{ fields: [{ status: 'FACHLICH_OFFEN', question: null }] }]), true);
    const gap = { id: 'sequence.execution', status: 'FEHLT_MODELL', reason: 'independent_annual_execution_adapter_missing' };
    const classify = row => summarizeParityResiduals([{ id: 'synthetic', historicalYear: 2000, fields: [row] }]);
    equal(classify(gap).classes[0].id, 'FOLGELAUF_AUSFUEHRUNG_FEHLT');
    equal(classify({ ...gap, reason: 'unknown_gap' }).unclassified.length, 1, 'Neue Lücken brauchen eine benannte Ursache');
    equal(classify({ ...gap, id: 'decision.monthlyBudget' }).unclassified.length, 1, 'Folgelauflücke darf kein Budget verdecken');
    equal(classify({ ...gap, status: 'TECHNISCHER_FEHLER' }).unclassified.length, 1, 'Technische Fehler erhalten keine Restklassenausnahme');

    const normal = createParityReplayCollector({ source, initialRecords: records });
    runFixture({ collector: normal });
    const log = normal.toLog();
    for (const value of [undefined, null, -0, Infinity, -Infinity, NaN, 'Grüße', log,
        { z: undefined, a: [null, NaN, -0], '10': 10, '2': 2, '4294967296': 1, '01': 1 },
        new Array(2), JSON.parse('{"__proto__":1,"toJSON":2,"😀":"ä"}')]) {
        equal(nodeParityHash(value), hashParityReplayValue(value), 'Native SHA-256 verwendet identische kanonische Bytes');
    }
    const portable = createParityCase(log, 1, { engineApi: EngineAPI });
    equal(createParityCase(log, 1, { engineApi: EngineAPI, hashValue: nodeParityHash }), portable,
        'Native Hashfunktion ändert keinen Beleg und kein Ergebnis');
    const corrupted = structuredClone(portable); corrupted.fields[0].reason = 'SYNTHETIC_TAMPERING';
    equal(validateParityCase(corrupted, { hashValue: nodeParityHash }).valid, false, 'Native Prüfung erkennt manipulierte Belege');
    const events = log.years.map(year => ({ historicalYear: year.historicalYear, logicalPlanningYear: year.logicalPlanningYear,
        yearData: year.marketContext.yearData, rentAdjustment: year.assumptions.rentAdjPct }));
    const seed = createParitySequenceSeed(records, dynamicFlexPresetPatch('off'),
        { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 80, endeVJ_3: 70, ath: 100, jahreSeitAth: 0 }, 2026);
    const sequence = { initialRecords: seed, events }, sequenceBytes = JSON.stringify(sequence);
    const ambient = ['window', 'document', 'localStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket'];
    const descriptors = Object.fromEntries(ambient.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        for (const key of ambient) Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(`AMBIENT:${key}`); } });
        const observations = runParityBalanceSequence(sequence, { engineApi: EngineAPI });
        equal(observations.length, 3);
        equal(observations[0].status, SEQUENCE_INCOMPLETE);
        ok(observations[0].decision, 'Erste unabhängige Balanceentscheidung vorhanden');
        equal(observations[0].execution.applied, false, 'Keine willkürliche Cashaufteilung');
        equal(observations[0].execution.question, null, 'FR-10 ist entschieden; es fehlt der unabhängige Buchungsadapter');
        equal(observations[1].decision, null, 'Keine erfundene Entscheidung hinter ungeklärter Ausführung');
        equal(observations[2].firstUnavailableYear, 2000);
        const compared = [];
        for (const year of log.years) {
            const recorded = createParityCase(log, year.yearIndex, { engineApi: EngineAPI, id: `probe-recorded-${year.historicalYear}` });
            const value = createParitySequenceCase(recorded, { initialRecords: seed, events: events.slice(0, year.yearIndex + 1) }, observations[year.yearIndex]);
            equal(replayParitySequenceCase(JSON.parse(JSON.stringify(value))).reproduced, true, 'Unabhängiger Einzelfall reproduziert');
            equal(value.summary.complete, false);
            compared.push(recorded, value);
        }
        const summary = summarizeParityScenario('probe', 'Probe', compared, { kind: 'completed' });
        equal(summary.decisionEqualYears, 3, 'Entscheidungsgleichheit zählt unabhängig von Beweislücken');
        equal(summary.transactionEqualYears, 3, 'Persönliche Plantransaktionen werden vollständig verglichen');
        equal(summary.equalYears, 0, 'Teilgleichheit wird nie zur vollständigen Parität');
        equal(summary.residuals.unclassified, [], 'Jede verbleibende Szenarienlücke hat eine enge benannte Klasse');
        const terminal = runParityBalanceSequence(sequence, { engineApi: { simulateSingleYear() { throw Error('SYNTHETIC_ENGINE_FAILURE'); } } });
        equal(terminal[0].status, 'TECHNISCHER_FEHLER');
        equal(terminal[1].decision, null);

        // Fully executable zero-flow fixture exercises own state, pensions and annual update over three years.
        const zeroSeed = createParitySequenceSeed(records, { ...dynamicFlexPresetPatch('off'), floorBedarf: 0, flexBedarf: 0, minimumFlexAnnual: 0 },
            { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 80, endeVJ_3: 70, ath: 100, jahreSeitAth: 0 }, 2026);
        const zeroEvents = events.map(event => ({ ...event, yearData: { ...event.yearData, zinssatz: 0 } }));
        const zero = runParityBalanceSequence({ initialRecords: zeroSeed, events: zeroEvents }, { engineApi: EngineAPI });
        equal(zero.map(year => year.status), ['AUSGEFUEHRT', 'AUSGEFUEHRT', 'AUSGEFUEHRT'], 'Mehrjähriger unabhängiger Zustand ohne Kontenwahl');
        const registry = JSON.parse(zero[1].records.rs_profiles_v1);
        const personal = JSON.parse(registry.profiles.muster_a.data[CONFIG.STORAGE.LS_KEY]);
        equal(personal.profilverbundHouseholdLastState, { ...zero[0].decision.newState, taxState: { lossCarry: 0 } },
            'Folgejahr verwendet eigenen Balancezustand');
        equal(Number(registry.profiles.muster_a.data.profile_rente_monatlich), 2300 * (1 + events[0].rentAdjustment / 100),
            'Rentenbasis aus eigener Vorjahresbasis');
        equal(zero[1].engineInput.horizonYears, 30, 'Kein eingespritzter Simulatorhorizont');
        equal(zero[1].engineInput.endeVJ, zero[0].engineInput.endeVJ * (1 + events[1].yearData.rendite),
            'FR-14: Schlusskurs bleibt im unabhängigen Folgelauf ungerundet');
        equal(zero[1].engineInput.inflation, events[0].yearData.inflation,
            'FR-14: Inflation behält im Folgejahr die Quellpräzision');
        const zeroCase = createParitySequenceCase(portable, { initialRecords: zeroSeed, events: zeroEvents.slice(0, 2) }, zero[1]);
        ok(!zeroCase.fields.some(row => row.id.startsWith('sequence.serialization.')), 'Nullentnahme-Reichweiten bleiben exportierbar');
        equal(replayParitySequenceCase(JSON.parse(JSON.stringify(zeroCase))).reproduced, true, 'Nullentnahme einzeln reproduziert');
    } finally {
        for (const key of ambient) if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else delete globalThis[key];
    }
    equal(JSON.stringify(sequence), sequenceBytes, 'Externe Folgeereignisse und Anfangsrecords unverändert');
    equal(JSON.stringify({ inputs, records }), bytes, 'Muster und Simulatoreingaben unverändert');
    console.log(`Paritätsszenarien: ${checks} Prüfungen erfolgreich; Terminalfälle und unabhängige Fortsetzung geprüft.`);
}
