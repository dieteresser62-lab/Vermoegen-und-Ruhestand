import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { EngineAPI } from '../../engine/index.mjs';
import { dynamicFlexPresetPatch, DYNAMIC_FLEX_OPTIONS } from '../../app/shared/dynamic-flex-presets.js';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { sealParityReplayLog, validateParityReplayLog, copyParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { createParityCase, sealParityCase, validateParityCase } from '../../app/balance/parity-case.js';
import { compareParityTree, compareParityField, parityMeasurement, summarizeParityFields,
    canonicalParityAction, canonicalParityLots, PARITY_PHASES } from '../../app/shared/parity-compare.js';
import { records, inputs, provider, source, runFixture } from './parity-replay-fixture.mjs';
import { createParitySequenceSeed, runParityBalanceSequence, SEQUENCE_INCOMPLETE } from './parity-balance-sequence.mjs';
import { nodeParityHash } from './parity-node-hash.mjs';
import { parityLegacyTqfOptions } from '../../app/balance/parity-year-comparison.js';
import { summarizeParityResiduals } from './parity-residuals.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const SCENARIO_PERIOD = Object.freeze({ startYear: 2000, endYear: 2025 });

/** Content provenance includes the private execution/comparison adapters, without spawning git. */
export function paritySource() {
    const manifest = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (/\.(js|mjs|json)$/.test(entry.name)) manifest.push([relative(root, path).replaceAll('\\', '/'),
                nodeParityHash(readFileSync(path, 'utf8'))]);
        }
    }
    for (const directory of ['app', 'engine', 'types', 'workers', 'tests/extended']) visit(join(root, directory));
    return { ...source, sourceHash: nodeParityHash(manifest),
        datasetHash: nodeParityHash(provider.preparePeriod(SCENARIO_PERIOD)) };
}

export function parityRunFailed(cases, outcomes = []) {
    const statuses = new Set(['GLEICH', 'FACHLICH_OFFEN', 'FEHLT_MODELL', 'FEHLT_LOG',
        'PHASE_NICHT_VERGLEICHBAR', 'NICHT_ANWENDBAR', 'AUSGEKLAMMERT']);
    return outcomes.some(outcome => !['completed', 'ruin', 'incomplete', 'cancelled'].includes(outcome.kind))
        || cases.some(value => value.fields.some(row => !statuses.has(row.status)
            || row.status === 'FACHLICH_OFFEN' && !(row.question >= 1 && row.question <= 8)));
}

function sequenceField(id, a, b, tolerance, options = {}) {
    const phase = options.phase || 'VOR_TRANSAKTION';
    return compareParityField({ id, phase, tolerance, category: 'ENTSCHEIDUNG', ...options,
        simulator: parityMeasurement(a, { phase, path: `recorded.${id}` }),
        balance: parityMeasurement(b, { phase, path: `sequence.${id}` }) });
}

function encodeSequence(value, issues, zeroWithdrawal, path = '$') {
    if (value === Infinity && zeroWithdrawal && /runway|months/i.test(path)) {
        return { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' };
    }
    if (zeroWithdrawal && value?.type === 'months' && value.name?.startsWith('Runway') && value.value === Infinity) {
        value = { ...value, value: { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' } };
    }
    if (Array.isArray(value)) return value.map((item, index) => encodeSequence(item, issues, zeroWithdrawal, `${path}.${index}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .map(([key, item]) => [key, encodeSequence(item, issues, zeroWithdrawal, `${path}.${key}`)]));
    return copyParityReplayValue(value, issues, path);
}

/** A sequence case stores only initial records and exogenous events as continuation inputs. */
export function createParitySequenceCase(recorded, sequence, observation) {
    const captured = recorded.replay.log.years[0];
    const fields = [];
    const pending = observation.status === SEQUENCE_INCOMPLETE;
    fields.push(sequenceField('sequence.execution', undefined, observation.execution?.status, 'EXACT', {
        category: 'AUSFUEHRUNG', phase: 'JAHRESENDE', status: pending ? 'FEHLT_MODELL'
            : observation.status === 'TECHNISCHER_FEHLER' ? 'TECHNISCHER_FEHLER' : 'PHASE_NICHT_VERGLEICHBAR',
        reason: observation.reason }));
    const comparable = observation.decision;
    if (comparable) {
        // Input causes precede result differences. Unrelated fields never inherit a blanket exception.
        for (const key of ['depotwertAlt', 'depotwertNeu', 'costBasisAlt', 'costBasisNeu', 'goldWert', 'goldCost', 'tqfAlt', 'tqfNeu']) {
            fields.push(sequenceField(`sequence.input.${key}`, captured.engineInput[key], observation.engineInput[key],
                key.startsWith('tqf') ? 'RATE' : 'EUR', { category: 'EINGABE',
                    ...parityLegacyTqfOptions(key, captured.engineInput, observation.engineInput) }));
        }
        fields.push(...compareParityTree({ id: 'sequence.input.lots', simulator: canonicalParityLots(captured.engineInput.detailledTranches),
            balance: canonicalParityLots(observation.engineInput.detailledTranches), phase: 'VOR_TRANSAKTION', category: 'EINGABE' }));
        for (const [key, question, tolerance] of [['horizonYears', undefined, 'EXACT'], ['floorBedarf', undefined, 'EUR'],
            ['flexBedarf', undefined, 'EUR'], ['minimumFlexAnnual', undefined, 'EUR'], ['inflation', undefined, 'RATE'], ['capeRatio', undefined, 'RATE'],
            ['ath', undefined, 'RATE'], ['jahreSeitAth', undefined, 'EXACT']]) {
            const left = key === 'ath' ? captured.engineInput.ath / captured.engineInput.endeVJ_1 : captured.engineInput[key];
            const right = key === 'ath' ? observation.engineInput.ath / observation.engineInput.endeVJ_1 : observation.engineInput[key];
            fields.push(sequenceField(`sequence.input.${key}`, left, right, tolerance,
                { category: 'EINGABE', question }));
        }
        fields.push(sequenceField('sequence.input.pensionAnnual', captured.engineInput.renteMonatlich * 12,
            observation.engineInput.renteMonatlich * 12, 'EUR', { category: 'EINGABE' }));
        fields.push(...compareParityTree({ id: 'sequence.state', simulator: captured.engineLastState,
            balance: observation.engineLastState, phase: 'VOR_TRANSAKTION', category: 'VORZUSTAND' }));
        const causes = fields.filter(row => row.status === 'FACHLICH_OFFEN').map(row => row.id);
        const cause = fields.find(row => row.status === 'FACHLICH_OFFEN')?.question;
        for (const [id, a, b, tolerance] of [
            ['monthlyWithdrawal', captured.expectedDecision.ui.spending.monatlicheEntnahme, comparable.ui.spending.monatlicheEntnahme, 'EUR'],
            ['annualWithdrawal', captured.expectedDecision.ui.spending.monatlicheEntnahme * 12, comparable.ui.spending.monatlicheEntnahme * 12, 'EUR'],
            ['monthlyBudget', captured.expectedDecision.newState.lastTotalBudget / 12, observation.annualMonthlyBudget, 'EUR'],
            ['flexRate', captured.expectedDecision.newState.flexRate, comparable.newState.flexRate, 'RATE'],
            ['market', captured.expectedDecision.ui.market.sKey, comparable.ui.market.sKey, 'EXACT']
        ]) fields.push(sequenceField(`sequence.decision.${id}`, a, b, tolerance, { question: cause, upstream: causes }));
        fields.push(sequenceField('sequence.personalExecution', undefined, observation.execution.ledger, 'EXACT',
            { category: 'PERSONENVERTEILUNG', phase: 'NACH_TRANSAKTION', status: 'FEHLT_MODELL', reason: 'independent_annual_execution_ledger_unavailable' }));
        fields.push(...compareParityTree({ id: 'sequence.transaction',
            simulator: canonicalParityAction(recorded.measured?.simulator?.result?.ui?.action?.plannedActionFlow),
            balance: canonicalParityAction(observation.finalAction), phase: 'NACH_TRANSAKTION', category: 'PERSONENVERTEILUNG' }));
    } else fields.push(sequenceField('sequence.decision', undefined, undefined, 'EXACT', {
        status: observation.status === 'TECHNISCHER_FEHLER' ? 'TECHNISCHER_FEHLER' : 'FEHLT_MODELL',
        reason: `no_engine_call_after_terminal:${observation.firstUnavailableYear}` }));
    const issues = [];
    const measured = encodeSequence(observation, issues, observation.decision?.ui?.spending?.monatlicheEntnahme === 0);
    for (const issue of issues) fields.push(sequenceField(`sequence.serialization.${issue.path}`, undefined, undefined, 'EXACT',
        { status: 'TECHNISCHER_FEHLER', reason: issue.reason }));
    const categories = ['EINGABE', 'VORZUSTAND', 'RUNDUNG', 'ZEITLAGE', 'ENTSCHEIDUNG', 'PERSONENVERTEILUNG', 'AUSFUEHRUNG'];
    fields.sort((a, b) => PARITY_PHASES.indexOf(a.phase) - PARITY_PHASES.indexOf(b.phase)
        || categories.indexOf(a.category) - categories.indexOf(b.category));
    return sealParityCase({ ...recorded, id: recorded.id.replace('-recorded-', '-sequence-'),
        replay: { log: recorded.replay.log, sequence: structuredClone(sequence) },
        measured: { balanceSequence: measured }, fields, summary: summarizeParityFields(fields) }, nodeParityHash);
}

export function replayParitySequenceCase(value, { engineApi = EngineAPI, expectedSource } = {}) {
    const validation = validateParityCase(value, { expectedSource, hashValue: nodeParityHash });
    if (!validation.valid || !value.replay.sequence) return { reproduced: false, validation, case: null };
    const observations = runParityBalanceSequence(value.replay.sequence, { engineApi });
    const recorded = createParityCase(value.replay.log, value.yearIndex, { engineApi, expectedSource,
        id: value.id.replace('-sequence-', '-recorded-'), hashValue: nodeParityHash });
    const actual = createParitySequenceCase(recorded, value.replay.sequence, observations.at(-1));
    return { reproduced: actual.caseHash === value.caseHash, validation, case: actual };
}

export function summarizeParityScenario(key, label, cases, outcome) {
    const result = { key, label, backtestOutcome: outcome, years: 26, equalYears: 0, decisionEqualYears: 0, transactionEqualYears: 0, roundingYears: 0,
        openQuestions: {}, missingPersonModelYears: 0, errorYears: 0, technicalFields: [], counts: {},
        recordedYears: 0, sequenceDecisions: 0, sequenceUnavailableYears: 0, sequenceStoppedYear: null };
    const byYear = new Map();
    for (const value of cases) {
        const group = byYear.get(value.historicalYear) || [];
        group.push(value); byYear.set(value.historicalYear, group);
        if (value.replay.sequence) {
            if (value.measured.balanceSequence.decision) result.sequenceDecisions++;
            if (value.measured.balanceSequence.status === SEQUENCE_INCOMPLETE) {
                result.sequenceUnavailableYears++;
                result.sequenceStoppedYear ??= value.historicalYear;
            }
        } else result.recordedYears++;
        for (const row of value.fields) {
            result.counts[row.status] = (result.counts[row.status] || 0) + 1;
            if (row.status === 'TECHNISCHER_FEHLER') result.technicalFields.push({ case: value.id, field: row.id, reason: row.reason });
        }
    }
    for (const group of byYear.values()) {
        const rows = group.flatMap(value => value.fields);
        const recorded = group.find(value => !value.replay.sequence);
        const equalPart = (prefix, required) => recorded && required.every(id => recorded.fields.some(row => row.id === id))
            && recorded.fields.filter(row => row.id.startsWith(prefix))
                .every(row => row.status === 'GLEICH' && row.classification === 'gleich' || row.status === 'NICHT_ANWENDBAR');
        if (equalPart('decision.', ['decision.monthlyBudget', 'decision.monthlyWithdrawal', 'decision.annualWithdrawal'])) result.decisionEqualYears++;
        if (equalPart('transaction.', ['transaction.type', 'transaction.tax', 'transaction.personalPayoutOrder'])) result.transactionEqualYears++;
        if (group.length === 2 && group.every(value => value.summary.complete)) result.equalYears++;
        if (rows.some(row => row.classification === 'Rundungsursache')) result.roundingYears++;
        for (let question = 1; question <= 8; question++) if (rows.some(row => row.status === 'FACHLICH_OFFEN' && row.question === question)) {
            result.openQuestions[question] = (result.openQuestions[question] || 0) + 1;
        }
        if (rows.some(row => row.status === 'FEHLT_MODELL')) result.missingPersonModelYears++;
        if (rows.some(row => row.status === 'TECHNISCHER_FEHLER')) result.errorYears++;
    }
    result.residuals = summarizeParityResiduals(cases);
    result.console = `${label}: Entscheidungen gleich ${result.decisionEqualYears}/26; Personenplan gleich ${result.transactionEqualYears}/26; vollständig gleich ${result.equalYears}/26; Rundung ${result.roundingYears}; offene Fachfragen `
        + (Object.keys(result.openQuestions).join(', ') || 'keine')
        + `; fehlendes Personenmodell ${result.missingPersonModelYears}; Fehler ${result.errorYears}; Folgelauf ${result.sequenceDecisions}/26`
        + (result.sequenceStoppedYear === null ? '.' : `, ab ${result.sequenceStoppedYear} unvollständig ausführbar.`);
    result.console += ` Restklassen: ${result.residuals.classes.map(entry => entry.id).join(', ') || 'keine'}; unklassifiziert ${result.residuals.unclassified.length}.`;
    return result;
}

export function runParityScenarios({ source: suppliedSource, engineApi = EngineAPI } = {}) {
    const started = performance.now(), cases = [], scenarios = [];
    const provenance = suppliedSource || paritySource();
    const unchanged = JSON.stringify({ records, inputs, provenance });
    const prepared = provider.preparePeriod(SCENARIO_PERIOD);
    const levels = prepared.initialMarketHistory.levels;
    const scale = 100 / levels.endeVJ.value;
    const market = { ...Object.fromEntries(['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3'].map(key => [key, levels[key].value * scale])),
        ath: prepared.initialMarketHistory.allTimeHigh.value * scale, jahreSeitAth: prepared.initialMarketHistory.yearsSinceAllTimeHigh };
    for (const [key, label] of DYNAMIC_FLEX_OPTIONS.filter(([key]) => key !== 'custom')) {
        const scenarioInputs = { ...structuredClone(inputs), ...dynamicFlexPresetPatch(key) };
        const initialRecords = createParitySequenceSeed(records, dynamicFlexPresetPatch(key), market, inputs.referenceYear);
        const collector = createParityReplayCollector({ source: provenance, initialRecords });
        const inputBytes = JSON.stringify(scenarioInputs);
        const backtest = runFixture({ input: scenarioInputs, collector, engine: engineApi, selectedPeriod: SCENARIO_PERIOD });
        const log = collector.toLog(), logBytes = JSON.stringify(log);
        assert.equal(validateParityReplayLog(log, { expectedSource: provenance, hashValue: nodeParityHash }).valid, true, `${label}: Logvertrag`);
        const events = log.years.map(year => ({ historicalYear: year.historicalYear, logicalPlanningYear: year.logicalPlanningYear,
            yearData: year.marketContext.yearData, rentAdjustment: year.assumptions.rentAdjPct }));
        const sequence = { initialRecords, events };
        const sequenceBytes = JSON.stringify(sequence);
        const observations = runParityBalanceSequence(sequence, { engineApi });
        const scenarioCases = [];
        for (const year of log.years) {
            // Validate the full chain once above; each case retains its own previous-input evidence.
            const previous = log.years.find(item => item.yearIndex === year.yearIndex - 1);
            if (previous) assert.equal(nodeParityHash(year.resetEvidence.previousEngineInput), nodeParityHash(previous.engineInput),
                `${label}: unveränderte Eingabeevidenz des Vorjahrs`);
            const single = sealParityReplayLog({ ...log, years: [year] }, nodeParityHash);
            const recorded = createParityCase(single, year.yearIndex, { engineApi, expectedSource: provenance,
                id: `${key}-recorded-${year.historicalYear}`, hashValue: nodeParityHash });
            scenarioCases.push(recorded, createParitySequenceCase(recorded,
                { initialRecords, events: events.slice(0, year.yearIndex + 1) }, observations[year.yearIndex]));
        }
        cases.push(...scenarioCases);
        scenarios.push(summarizeParityScenario(key, label, scenarioCases, backtest.outcome));
        assert.equal(JSON.stringify(sequence), sequenceBytes, `${label}: private Fortsetzungseingaben unverändert`);
        assert.equal(JSON.stringify(log), logBytes, `${label}: Collectorbeleg unverändert`);
        assert.equal(JSON.stringify(scenarioInputs), inputBytes, `${label}: Eingaben unverändert`);
    }
    assert.equal(JSON.stringify({ records, inputs, provenance }), unchanged, 'Anfangsrecords und Herkunft unverändert');
    return { cases, scenarios, failed: parityRunFailed(cases, scenarios.map(s => s.backtestOutcome))
        || scenarios.some(s => s.residuals.unclassified.length > 0), durationMs: performance.now() - started };
}

export function writeParityRun(run, probeCases, directory) {
    const started = performance.now();
    const destination = directory ? resolve(directory) : mkdtempSync(join(tmpdir(), 'paritaet-'));
    mkdirSync(destination, { recursive: true });
    const cases = [...run.cases, ...probeCases];
    for (const value of cases) writeFileSync(join(destination, `${value.id}.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const summary = { schemaVersion: 'ParitySummaryV1', period: SCENARIO_PERIOD, source: cases[0]?.source,
        complete: run.cases.length > 0 && run.cases.every(value => value.summary.complete), failed: run.failed,
        residuals: summarizeParityResiduals(run.cases), scenarios: run.scenarios, files: cases.map(value => `${value.id}.json`),
        durationMs: run.durationMs + performance.now() - started, runtimeTargetMs: 10000,
        runtimeTargetMet: run.durationMs + performance.now() - started < 10000,
        limitation: 'Kein Nachweis vollständiger Parität; der unabhängige Balanceadapter hat keine persönlichen Jahresendbuchungen.' };
    writeFileSync(join(destination, 'zusammenfassung.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    return { destination, summary };
}
