import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from './balance-main-profilverbund.js';
import { buildParityBalanceRecords, ParityRecordError } from './parity-balance-records.js';
import { validateParityReplayLog, restoreParityReplayValue, hashParityReplayValue,
    PARITY_REPLAY_INCOMPLETE } from '../simulator/parity-replay-contract.js';

/** One independent decision, starting from the recorded state, without any commit path. */
export function buildParityBalanceReplayYear(log, yearIndex, { expectedSource, hashValue = hashParityReplayValue } = {}) {
    const validation = validateParityReplayLog(log, { expectedSource, hashValue });
    const issues = [...validation.issues];
    const base = { replayable: false, comparisonEligible: false, status: PARITY_REPLAY_INCOMPLETE,
        basis: 'PARTIAL_BALANCE_REPLAY', yearIndex, issues, storage: null, calculation: null };
    if (!validation.valid) return base;
    const captured = log.years.find(year => year.yearIndex === yearIndex);
    if (!captured) {
        issues.push({ status: 'FEHLT_LOG', path: 'yearIndex', reason: 'decision_year_unavailable' });
        return base;
    }
    try {
        const year = restoreParityReplayValue(captured);
        const previousCaptured = log.years.find(item => item.yearIndex === yearIndex - 1);
        if (previousCaptured && hashValue(captured.resetEvidence.previousEngineInput) !== hashValue(previousCaptured.engineInput)) {
            throw new ParityRecordError('resetEvidence.previousEngineInput', 'previous_input_evidence_mismatch', 'TECHNISCHER_FEHLER');
        }
        const { storage, provenance } = buildParityBalanceRecords(restoreParityReplayValue(log.initialRecords), year, issues);
        const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: year.logicalPlanningYear });
        const before = year.engineLastState;
        const after = calculation.engineLastState;
        const removedFields = Object.keys(before || {}).filter(key => !Object.hasOwn(after || {}, key));
        return { ...base, storage, provenance, calculation, logicalPlanningYear: year.logicalPlanningYear,
            historicalYear: year.historicalYear, resetEvidence: { simulator: structuredClone(year.resetEvidence),
                balance: { before: structuredClone(before), after: structuredClone(after), removedFields,
                    resetApplied: removedFields.length > 0, reason: removedFields.length ? 'balance_prepareEngineLastState' : 'state_retained' },
                planHistory: structuredClone(calculation.history) } };
    } catch (error) {
        issues.push(error instanceof ParityRecordError ? error.issue
            : { status: 'TECHNISCHER_FEHLER', path: 'balanceRecordAdapter', reason: error.message });
        return base;
    }
}

/** Invoke the actual DOM-free household path, including personal action attribution. */
export function evaluateParityBalanceReplayYear(log, yearIndex, { engineApi, expectedSource, hashValue } = {}) {
    const replay = buildParityBalanceReplayYear(log, yearIndex, { expectedSource, hashValue });
    if (!replay.calculation) return { ...replay, runs: null, householdResult: null };
    if (typeof engineApi?.simulateSingleYear !== 'function') throw new TypeError('Eine explizite EngineAPI ist erforderlich.');
    const { inputData, profiles, engineLastState, profileId, householdPlan, engineInput } = replay.calculation;
    try {
        const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== profileId;
        const runs = multi ? evaluateStoredAnnualHousehold(inputData, profiles, engineLastState,
            { engineApi, withdrawalMode: householdPlan.entry.values.householdWithdrawalMode }) : null;
        const householdResult = runs?.householdResult || engineApi.simulateSingleYear(engineInput, engineLastState);
        if (householdResult?.error) throw householdResult.error;
        if (!householdResult?.newState || !householdResult?.ui) throw new Error('Unvollständiges Balance-Engineergebnis.');
        return { ...replay, runs, householdResult };
    } catch (error) {
        replay.issues.push({ status: 'TECHNISCHER_FEHLER', path: 'balanceEvaluation', reason: error.message });
        return { ...replay, runs: null, householdResult: null };
    }
}
