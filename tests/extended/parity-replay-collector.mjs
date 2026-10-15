import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { copyParityReplayValue, restoreParityReplayValue, validateParityReplayLog, parseParityReplayLog,
    sealParityReplayLog, PARITY_REPLAY_INCOMPLETE } from '../../app/simulator/parity-replay-contract.js';
import { EngineAPI } from '../../engine/index.mjs';
import { simulateOneYear } from '../../app/simulator/simulator-engine-direct.js';
import { inputs, records, recordBytes, runFixture, source } from './parity-replay-fixture.mjs';

export function testParityReplayCollector() {
    let checks = 0;
    const equal = (a, b, message) => { assert.deepStrictEqual(a, b, message); checks++; };
    const ok = (value, message) => { assert.ok(value, message); checks++; };
    const collector = createParityReplayCollector({ source, initialRecords: records });
    const inputBytes = JSON.stringify(inputs);
    const baseline = runFixture();
    const observed = [];
    const engine = { ...EngineAPI, simulateSingleYear(input, state, ...options) {
        const before = structuredClone({ input, state, options });
        const result = EngineAPI.simulateSingleYear(input, state, ...options);
        observed.push({ ...before, result: structuredClone(result) });
        return result;
    } };
    const recorded = runFixture({ collector, engine });
    equal(baseline.outcome.kind, 'completed', 'Musterpfad erfolgreich');
    equal(JSON.stringify(recorded), JSON.stringify(baseline), 'Aufzeichnung an/aus: vollständiges Ergebnis bytegleich');
    const json = JSON.stringify(collector.toLog());
    const { log, validation } = parseParityReplayLog(json, { expectedSource: source });
    ok(validation.valid, JSON.stringify(validation.issues));
    ok(validation.engineReplayable, 'Engineargumente vollständig replayfähig');
    equal(validation.status, PARITY_REPLAY_INCOMPLETE, 'keine vollständige Haushaltsparität behaupten');
    equal(validation.replayable, false);
    equal(log.years.length, 3);
    const schema = JSON.parse(readFileSync(new URL('../../types/parity-replay-log-v1.schema.json', import.meta.url), 'utf8'));
    equal(schema.properties.schemaVersion.const, log.schemaVersion);
    for (const field of schema.required) ok(Object.hasOwn(log, field), `Schemafeld ${field}`);
    for (const field of schema.$defs.year.required) ok(Object.hasOwn(log.years[0], field), `Jahresschemafeld ${field}`);
    for (const [i, year] of log.years.entries()) {
        const call = observed[i];
        equal(restoreParityReplayValue(year.engineInput), call.input, 'Input vor Engine kopiert');
        equal(restoreParityReplayValue(year.engineLastState), call.state, 'exakter zweiter Parameter');
        equal(call.options, [], 'Engine weiterhin mit genau zwei Argumenten');
        equal(restoreParityReplayValue(year.options), undefined, 'nicht übergebene Optionen erhalten');
        equal(restoreParityReplayValue(year.expectedDecision), call.result, 'Ergebnis vor nachträglicher Mutation');
        const replay = EngineAPI.simulateSingleYear(restoreParityReplayValue(year.engineInput), restoreParityReplayValue(year.engineLastState));
        equal(replay, call.result, 'JSON-Einzeljahr reproduziert Engineentscheidung');
        equal(year.historicalYear, 2000 + i);
        equal(year.logicalPlanningYear, 2026 + i, 'Planjahr unabhängig von Marktjahr');
        equal(year.decisionPhase, 'VOR_TRANSAKTION');
        equal(year.effectiveAnnualPensions.pensionAnnual, recorded.rows[i].row.pension_annual);
        equal(year.effectiveAnnualPensions.pensionAnnual / 12, call.input.renteMonatlich);
        equal(year.cashAndLots.lots, year.engineInput.detailledTranches);
        equal(year.simulatorStateBefore.portfolio.liquiditaet, year.engineInput.aktuelleLiquiditaet);
        equal(year.resetEvidence.simulatorResetApplied, false);
        equal(year.resetEvidence.removedFields, []);
        if (i > 0) equal(year.resetEvidence.previousEngineInput, log.years[i - 1].engineInput);
        const start = restoreParityReplayValue(year.simulatorStateAtYearStart);
        const assumptions = restoreParityReplayValue(year.assumptions);
        const events = restoreParityReplayValue(year.householdEvents);
        const replayedYear = simulateOneYear(start, assumptions, year.marketContext.yearData, year.yearIndex,
            events.pflegeMeta, events.careFloorAddition, events.householdContext, events.temporaryFlexFactor, EngineAPI);
        const { portfolio_total_start, ...row } = recorded.rows[i].row;
        equal(JSON.stringify(replayedYear.logData), JSON.stringify(row), 'privater Jahresstart reproduziert Simulatorlog');
    }
    ok(!validation.issues.some(issue => issue.status === 'FEHLT_MODELL'), 'Persönliche Steuerstände sind belegt');
    ok(!validation.issues.some(issue => issue.question === 3), 'FR-10: Kontenfortschreibung ist entschieden');
    ok(!validation.issues.some(issue => issue.question === 6), 'FR-13: kein pauschaler Befund für Planungsdauer');
    ok(!validation.issues.some(issue => [1, 2, 4, 5, 7, 8].includes(issue.question)), 'FR-8/FR-9/FR-11/FR-12/FR-14/FR-15 sind entschieden');
    equal(JSON.stringify(records), recordBytes, 'Musterrecords unverändert');
    log.years[0].engineInput.floorBedarf = -1;
    equal(validateParityReplayLog(log).valid, false, 'Manipulation vom Beleg-Hash erkannt');
    equal(JSON.stringify(collector.toLog()), json, 'Rückgabe besitzt keine Collector-Referenzen');

    for (const field of ['engineInput', 'engineLastState', 'options', 'expectedDecision', 'simulatorStateBefore', 'cashAndLots']) {
        const incomplete = JSON.parse(json);
        delete incomplete.years[0][field];
        const validation = validateParityReplayLog(sealParityReplayLog(incomplete));
        equal(validation.status, PARITY_REPLAY_INCOMPLETE, `Lücke ${field} bleibt sichtbar`);
        ok(validation.issues.some(issue => issue.path.endsWith(`.${field}`)));
        if (['engineInput', 'engineLastState', 'options', 'expectedDecision'].includes(field)) equal(validation.engineReplayable, false);
    }
    const wrongPhase = JSON.parse(json);
    wrongPhase.years[0].decisionPhase = 'JAHRESENDE';
    equal(validateParityReplayLog(sealParityReplayLog(wrongPhase)).valid, false);
    equal(validateParityReplayLog({ rows: baseline.rows }).status, PARITY_REPLAY_INCOMPLETE, 'Altlog ist kein vollständiger Replaybeleg');
    equal(validateParityReplayLog(JSON.parse(json), { expectedSource: { sourceHash: 'a'.repeat(64) } }).valid, false);
    const empty = createParityReplayCollector().toLog();
    equal(validateParityReplayLog(empty).engineReplayable, false);
    equal(validateParityReplayLog(empty).status, PARITY_REPLAY_INCOMPLETE);
    const unsupported = copyParityReplayValue({ optional: undefined, negativeZero: -0 });
    equal(restoreParityReplayValue(JSON.parse(JSON.stringify(unsupported))), { optional: undefined, negativeZero: -0 });
    const corrupt = JSON.parse(json);
    corrupt.years[0].engineInput.floorBedarf = NaN;
    equal(validateParityReplayLog(corrupt).valid, false, 'NaN ist technischer Fehler');
    const cyclic = JSON.parse(json);
    cyclic.self = cyclic;
    equal(validateParityReplayLog(cyclic).valid, false, 'zyklischer Import scheitert ohne Laufzeitwurf');

    // A failed Engine invocation leaves a visibly incomplete record, never an invented decision.
    const failed = createParityReplayCollector({ source, initialRecords: records });
    const outcome = runFixture({ collector: failed, engine: { simulateSingleYear() { throw new Error('synthetic failure'); } } });
    equal(outcome.outcome.kind, 'technical_error');
    equal(validateParityReplayLog(failed.toLog()).engineReplayable, false);

    const zeroCollector = createParityReplayCollector({ source, initialRecords: records });
    const zeroInputs = { ...inputs, startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0 };
    const zeroOff = runFixture({ input: zeroInputs });
    equal(JSON.stringify(runFixture({ input: zeroInputs, collector: zeroCollector })), JSON.stringify(zeroOff), 'Nullentnahme bleibt bytegleich');
    const zeroValidation = validateParityReplayLog(zeroCollector.toLog());
    ok(zeroValidation.valid, JSON.stringify(zeroValidation.issues));
    equal(zeroCollector.toLog().years[0].expectedDecision.ui.runway.months,
        { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' });
    const zeroYear = zeroCollector.toLog().years[0];
    equal(restoreParityReplayValue(zeroYear.expectedDecision), EngineAPI.simulateSingleYear(
        restoreParityReplayValue(zeroYear.engineInput), restoreParityReplayValue(zeroYear.engineLastState)), 'unbegrenzte Reichweiten exakt wiederhergestellt');

    const invalidNumber = createParityReplayCollector({ source, initialRecords: records });
    runFixture({ collector: invalidNumber, engine: { ...EngineAPI, simulateSingleYear(input, state) {
        const result = EngineAPI.simulateSingleYear(input, state);
        result.diagnosis.syntheticInvalid = Infinity;
        return result;
    } } });
    equal(validateParityReplayLog(invalidNumber.toLog()).valid, false, 'Infinity außerhalb Nullentnahme-Reichweite ist ein technischer Fehler');

    const noOwners = JSON.parse(json);
    delete noOwners.years[0].cashAndLots.lots[0].sourceProfileId;
    // Remove the matching input provenance too: the absence, rather than an inconsistent copy, is under test.
    delete noOwners.years[0].engineInput.detailledTranches[0].sourceProfileId;
    ok(validateParityReplayLog(sealParityReplayLog(noOwners)).issues.some(issue => issue.reason === 'lot_owner_unavailable'));

    const isolatedRecords = structuredClone(records);
    const isolatedSource = structuredClone(source);
    const isolated = createParityReplayCollector({ source: isolatedSource, initialRecords: isolatedRecords });
    isolatedSource.sourceHash = '0'.repeat(64);
    isolatedRecords.syntheticMutation = true;
    equal(isolated.toLog().source, source, 'Herkunft beim Anlegen kopiert');
    equal(isolated.toLog().initialRecords, records, 'Anfangsrecords beim Anlegen kopiert');

    // Observe input mutation by an injected Engine: the recorder must precede the call.
    const mutating = createParityReplayCollector({ source, initialRecords: records });
    runFixture({ collector: mutating, engine: { ...EngineAPI, simulateSingleYear(input, state) {
        const result = EngineAPI.simulateSingleYear(input, state);
        input.syntheticMutation = true;
        if (state) state.syntheticMutation = true;
        return result;
    } } });
    ok(mutating.toLog().years.every(year => !year.engineInput.syntheticMutation && !year.engineLastState?.syntheticMutation));
    // Care and household events are retained even though they are outside the first comparison scope.
    const eventCollector = createParityReplayCollector({ source, initialRecords: records });
    const first = JSON.parse(json).years[0];
    const eventState = restoreParityReplayValue(first.simulatorStateAtYearStart);
    const eventInputs = restoreParityReplayValue(first.assumptions);
    const events = { p1Alive: true, p2Alive: true, widowBenefits: {} };
    simulateOneYear(eventState, eventInputs, first.marketContext.yearData, 0, { grade: 2 }, 1200, events, 0.9, EngineAPI, eventCollector);
    equal(eventCollector.toLog().years[0].householdEvents.careFloorAddition, 1200);
    equal(eventCollector.toLog().years[0].householdEvents.temporaryFlexFactor, 0.9);
    equal(eventCollector.toLog().years[0].householdEvents.householdContext, events);
    equal(JSON.stringify(inputs), inputBytes, 'Laufannahmen bleiben beim Aufrufer');
    console.log(`Paritätscollector: ${checks} Prüfungen erfolgreich.`);
    return checks;
}
