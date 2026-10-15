import { simulateOneYear } from '../simulator/simulator-engine-wrapper.js';
import { copyParityReplayValue, restoreParityReplayValue, hashParityReplayValue, sealParityReplayLog,
    validateParityReplayLog } from '../simulator/parity-replay-contract.js';
import { evaluateParityBalanceReplayYear } from './parity-balance-replay.js';
import { evaluateAnnualDraft } from './balance-annual-storage-commit.js';
import { projectBalanceFlexTrace } from './balance-flex-trace.js';
import { compareParityTree, compareParityField, parityMeasurement, PARITY_TOLERANCES, PARITY_PHASES, summarizeParityFields } from '../shared/parity-compare.js';
import { compareParityYear } from './parity-year-comparison.js';

export const PARITY_CASE_VERSION = 'ParityCaseV1';

/** Only the contract's zero-withdrawal runways may encode infinity. */
function encode(value, issues, zeroWithdrawal, path = '$') {
    if (value === Infinity && zeroWithdrawal && /runway|months/i.test(path)) {
        return { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' };
    }
    if (value instanceof Error) return { name: value.name, message: value.message,
        ...(value.context ? { context: encode(value.context, issues, false, `${path}.context`) } : {}) };
    if (Array.isArray(value)) return value.map((child, index) => encode(child, issues, zeroWithdrawal, `${path}.${index}`));
    if (zeroWithdrawal && value?.type === 'months' && value.name?.startsWith('Runway') && value.value === Infinity) {
        value = { ...value, value: { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' } };
    }
    if (value && typeof value === 'object' && !(value instanceof Error)) return Object.fromEntries(Object.entries(value)
        .map(([key, child]) => [key, encode(child, issues, zeroWithdrawal, `${path}.${key}`)]));
    return copyParityReplayValue(value, issues, path);
}

export function sealParityCase(value, hashValue = hashParityReplayValue) {
    const { caseHash: ignored, ...payload } = value;
    return { ...payload, caseHash: hashValue(payload) };
}

/** A self-contained year includes its own previous-input/reset evidence, not other years. */
export function createParityCase(log, yearIndex, { engineApi, expectedSource, id = `year-${yearIndex + 1}`, hashValue = hashParityReplayValue } = {}) {
    if (typeof engineApi?.simulateSingleYear !== 'function') throw new TypeError('Eine explizite EngineAPI ist erforderlich.');
    const validation = validateParityReplayLog(log, { expectedSource, hashValue });
    let issues = [...validation.issues];
    const runtimeEngineVersion = engineApi.getVersion?.() ?? null;
    if (runtimeEngineVersion && log?.source?.engineVersion
        && hashValue(runtimeEngineVersion) !== hashValue(log.source.engineVersion)) {
        issues.push({ status: 'TECHNISCHER_FEHLER', path: 'source.engineVersion', reason: 'engine_version_mismatch' });
    }
    const captured = log?.years?.find(year => year.yearIndex === yearIndex);
    let singleLog = validation.valid && captured ? sealParityReplayLog({ ...structuredClone(log), years: [structuredClone(captured)] }, hashValue) : structuredClone(log ?? null);
    // Never heal a broken source hash or a contradictory cross-year reference by extracting a year.
    if (validation.valid && captured && yearIndex > 0) {
        const previous = log.years.find(year => year.yearIndex === yearIndex - 1);
        if (previous && hashValue(captured.resetEvidence.previousEngineInput) !== hashValue(previous.engineInput)) {
            issues.push({ status: 'TECHNISCHER_FEHLER', path: 'resetEvidence.previousEngineInput', reason: 'previous_input_evidence_mismatch' });
            singleLog = structuredClone(log);
        }
    }
    if (!issues.some(issue => issue.status === 'TECHNISCHER_FEHLER')) issues = [...validateParityReplayLog(singleLog, { expectedSource, hashValue }).issues];
    let simulator = null, balance = null, fields = [];
    if (validation.valid && captured && !issues.some(issue => issue.status === 'TECHNISCHER_FEHLER')) {
        const year = restoreParityReplayValue(captured);
        let boundary = null;
        try {
            const events = year.householdEvents;
            const result = simulateOneYear(structuredClone(year.simulatorStateAtYearStart), structuredClone(year.assumptions),
                structuredClone(year.marketContext.yearData), yearIndex, structuredClone(events.pflegeMeta),
                events.careFloorAddition, structuredClone(events.householdContext), events.temporaryFlexFactor, engineApi, {
                    beginYear: () => ({}),
                    beforeEngine(token, context) { boundary = structuredClone(context); },
                    afterEngine(token, decision) { boundary.decision = encode(decision, issues, decision?.ui?.spending?.monatlicheEntnahme === 0); }
                });
            simulator = { boundary, result };
            if (result.kind !== 'success') issues.push({ status: result.kind === 'ruin' ? 'AUSGEKLAMMERT' : 'TECHNISCHER_FEHLER',
                path: 'simulator.result', reason: result.code || result.kind });
            if (boundary) {
                for (const key of ['engineInput', 'engineLastState', 'options']) fields.push(...compareParityTree({
                    id: `control.${key}`, simulator: captured[key], balance: encode(boundary[key], issues, false), category: 'EINGABE', phase: 'VOR_TRANSAKTION',
                    toleranceForKey: () => 'EXACT', simulatorPath: `recorded.${key}`, balancePath: `rerun.${key}` }));
                fields.push(...compareParityTree({ id: 'control.decision', simulator: captured.expectedDecision,
                    balance: boundary.decision, category: 'ENTSCHEIDUNG', phase: 'VOR_TRANSAKTION',
                    zeroWithdrawal: year.expectedDecision?.ui?.spending?.monatlicheEntnahme === 0 && boundary.decision?.ui?.spending?.monatlicheEntnahme === 0,
                    toleranceForKey: () => 'EXACT', simulatorPath: 'recorded.expectedDecision', balancePath: 'rerun.decision' }));
            } else issues.push({ status: 'FEHLT_LOG', path: 'simulator.boundary', reason: 'no_engine_call' });
        } catch (error) { issues.push({ status: 'TECHNISCHER_FEHLER', path: 'simulatorReplay', reason: error.message }); }
        const replay = evaluateParityBalanceReplayYear(singleLog, yearIndex, { engineApi, expectedSource, hashValue });
        issues.push(...replay.issues);
        if (replay.calculation) {
            const c = replay.calculation;
            let annual = null;
            if (replay.householdResult) try {
                annual = evaluateAnnualDraft({ records: replay.storage.toRecords(), values: c.householdPlan.entry.values,
                    scope: c.scope, planningYear: year.logicalPlanningYear, ageByPerson: {} },
                { engineApi, now: () => new Date(`${year.logicalPlanningYear}-01-01T12:00:00Z`) });
            } catch (error) { issues.push({ status: 'TECHNISCHER_FEHLER', path: 'balance.annualDraft', reason: error.message }); }
            balance = { records: replay.storage.toRecords(), engineInput: c.engineInput, engineLastState: c.engineLastState,
                profiles: c.profiles, history: c.history, provenance: replay.provenance, resetEvidence: replay.resetEvidence,
                marketProvenance: { cape: c.householdPlan.entry.values.cape },
                decision: replay.householdResult, finalAction: replay.runs?.finalAction || replay.householdResult?.ui?.action,
                distribution: replay.runs?.distribution, personalResults: replay.runs ? [...replay.runs] : null,
                annualMonthlyBudget: annual?.monthlyBudget, projection: replay.householdResult
                    ? projectBalanceFlexTrace({ ...replay.householdResult.ui, input: c.inputData }) : null };
        }
        fields.push(...compareParityYear(year, simulator, balance));
    } else if (!captured) issues.push({ status: 'FEHLT_LOG', path: 'yearIndex', reason: 'decision_year_unavailable' });
    if (!log?.source?.revision) issues.push({ status: 'FEHLT_LOG', path: 'source.revision', reason: 'source_revision_unavailable' });
    const uniqueIssues = [...new Map(issues.map(issue => [hashValue(issue), issue])).values()];
    for (const [index, issue] of uniqueIssues.entries()) fields.push({ id: `evidence.${index + 1}`, phase: issue.phase || 'VOR_TRANSAKTION',
        category: 'EINGABE', tolerance: 'EXACT', absoluteTolerance: 0, status: issue.status,
        classification: issue.status === 'FACHLICH_OFFEN' ? `offene Fachfrage ${issue.question}` :
            ({ FEHLT_MODELL: 'fehlendes Personenmodell', FEHLT_LOG: 'fehlender Logwert', AUSGEKLAMMERT: 'ausgeklammert' }[issue.status] || 'technischer Fehler'),
        reason: issue.reason, question: issue.question ?? null, upstream: [], withinTolerance: false, delta: null,
        simulator: { ...issue, value: null, phase: issue.phase || 'VOR_TRANSAKTION', path: issue.path || 'log' },
        balance: { ...issue, value: null, phase: issue.phase || 'VOR_TRANSAKTION', path: issue.path || 'log' } });
    const serializationIssues = [];
    const measured = { simulator: simulator ? { engineInput: encode(simulator.boundary?.engineInput, serializationIssues, false),
        engineLastState: encode(simulator.boundary?.engineLastState, serializationIssues, false),
        options: encode(simulator.boundary?.options, serializationIssues, false),
        decision: simulator.boundary?.decision, result: encode(simulator.result, serializationIssues,
            simulator.result?.ui?.spending?.monatlicheEntnahme === 0) } : null,
    balance: balance ? encode(balance, serializationIssues, balance.decision?.ui?.spending?.monatlicheEntnahme === 0) : null };
    for (const issue of serializationIssues) fields.push(compareParityField({ id: `serialization.${issue.path}`,
        phase: 'JAHRESENDE', category: 'AUSFUEHRUNG', status: 'TECHNISCHER_FEHLER', reason: issue.reason,
        simulator: parityMeasurement(undefined, { phase: 'JAHRESENDE', path: issue.path }),
        balance: parityMeasurement(undefined, { phase: 'JAHRESENDE', path: issue.path }) }));
    const categoryOrder = ['EINGABE', 'VORZUSTAND', 'RUNDUNG', 'ZEITLAGE', 'ENTSCHEIDUNG', 'PERSONENVERTEILUNG', 'AUSFUEHRUNG'];
    fields.sort((a, b) => PARITY_PHASES.indexOf(a.phase) - PARITY_PHASES.indexOf(b.phase)
        || categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
    return sealParityCase({ schemaVersion: PARITY_CASE_VERSION, id, kind: 'RECORDED_YEAR',
        source: { revision: null, sourceHash: null, datasetHash: null, engineVersion: null, temporalConventionId: null, ...log?.source },
        configurationHash: hashValue(captured?.assumptions ?? null),
        historicalYear: captured?.historicalYear ?? null, logicalPlanningYear: captured?.logicalPlanningYear ?? null,
        yearIndex, runtimeEngineVersion, phases: [...PARITY_PHASES], replay: { log: singleLog }, expected: captured?.expectedDecision ?? null,
        measured, tolerances: { ...PARITY_TOLERANCES }, fields, summary: summarizeParityFields(fields) }, hashValue);
}

export function validateParityCase(value, { expectedSource, hashValue = hashParityReplayValue } = {}) {
    try {
        if (value?.schemaVersion !== PARITY_CASE_VERSION || value.kind !== 'RECORDED_YEAR') throw new Error('unsupported_parity_case');
        const { caseHash, ...payload } = value;
        if (caseHash !== hashValue(payload)) throw new Error('case_hash_mismatch');
        if (hashValue(value.tolerances) !== hashValue(PARITY_TOLERANCES)) throw new Error('tolerances_changed');
        const validation = validateParityReplayLog(value.replay.log, { expectedSource, hashValue });
        if (expectedSource && validation.issues.some(issue => issue.reason === 'source_mismatch')) throw new Error('source_mismatch');
        const year = value.replay.log?.years?.find(year => year.yearIndex === value.yearIndex);
        if (value.configurationHash !== hashValue(year?.assumptions ?? null)
            || hashValue(value.expected) !== hashValue(year?.expectedDecision ?? null)) throw new Error('case_evidence_mismatch');
        return { valid: true, logValid: validation.valid, issues: [] };
    } catch (error) { return { valid: false, issues: [{ status: 'TECHNISCHER_FEHLER', reason: error.message }] }; }
}

/** Recalculate from source evidence, then compare to the exported observation without rebasing it. */
export function replayParityCase(value, options = {}) {
    const validation = validateParityCase(value, options);
    if (!validation.valid) return { reproduced: false, validation, case: null };
    const actual = createParityCase(value.replay.log, value.yearIndex, { ...options, id: value.id });
    return { reproduced: actual.caseHash === value.caseHash, validation, case: actual };
}
