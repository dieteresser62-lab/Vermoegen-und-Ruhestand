import {
    copyParityReplayValue,
    PARITY_REPLAY_PHASE,
    PARITY_REPLAY_SCHEMA_VERSION,
    sealParityReplayLog
} from './parity-replay-contract.js';

function normalizeUnlimitedRunways(result) {
    if (result?.ui?.spending?.monatlicheEntnahme !== 0) return result;
    const unlimited = () => ({ status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' });
    const general = { ...result.diagnosis?.general };
    for (const key of ['runwayMonate', 'dynamicFlexSafetyRunwayMonate', 'runwayMonateVorTransaktion']) {
        if (general[key] === Infinity) general[key] = unlimited();
    }
    return {
        ...result,
        ui: { ...result.ui, runway: { ...result.ui.runway,
            ...(result.ui.runway?.months === Infinity ? { months: unlimited() } : {}) } },
        diagnosis: { ...result.diagnosis, general,
            ...(Array.isArray(result.diagnosis?.guardrails) ? { guardrails: result.diagnosis.guardrails.map(guard =>
                guard.type === 'months' && guard.name?.startsWith('Runway') && guard.value === Infinity
                    ? { ...guard, value: unlimited() } : guard) } : {}) }
    };
}

/**
 * Local memory only. Pass as simulateOneYear's tenth argument; never place it in inputs.
 * Provenance and initial records must be supplied by the caller, never read from live storage.
 */
export function createParityReplayCollector({ source = {}, initialRecords = null } = {}) {
    const captureIssues = [];
    const copy = (value, path) => copyParityReplayValue(value, captureIssues, path);
    const provenance = copy({ sourceHash: null, datasetHash: null, engineVersion: null,
        temporalConventionId: null, ...source }, '$.source');
    const records = copy(initialRecords, '$.initialRecords');
    const years = [];
    const pending = new Set();

    return Object.freeze({
        beginYear(state, yearIndex, yearData) {
            const token = {
                yearIndex,
                historicalYear: Number.isInteger(yearData?.jahr) ? yearData.jahr : null,
                simulatorStateAtYearStart: copy(state, `$.years.${years.length}.simulatorStateAtYearStart`)
            };
            // A year without an Engine call (e.g. accumulation) is not a decision record.
            return token;
        },
        beforeEngine(token, context) {
            const path = `$.years.${years.length}`;
            const { engineInput, engineLastState, assumptions, simulatorStateBefore, cumulativeInflationFactor } = context;
            const year = {
                ...token,
                decisionPhase: PARITY_REPLAY_PHASE,
                logicalPlanningYear: Number.isInteger(assumptions.referenceYear)
                    ? assumptions.referenceYear + token.yearIndex : null,
                ...copy(context, path),
                cashAndLots: copy({
                    pooledLiquidity: engineInput.aktuelleLiquiditaet,
                    componentCash: {
                        tagesgeld: simulatorStateBefore.portfolio.tagesgeld,
                        geldmarktEtf: simulatorStateBefore.portfolio.geldmarktEtf
                    },
                    cashOwnership: { status: 'BELEGT', persons: simulatorStateBefore.portfolio.personAccounts,
                        evidence: simulatorStateBefore.portfolio.personalAccountEvidence || 'continued_personal_accounts' },
                    componentFreshness: { status: 'FORTGESCHRIEBEN', reason: 'FR10_personal_accounts' },
                    lots: engineInput.detailledTranches
                }, `${path}.cashAndLots`),
                horizonContext: copy({
                    horizonYears: engineInput.horizonYears,
                    diagnostics: assumptions.longevityHorizonDiagnostics,
                    aktuellesAlter: engineInput.aktuellesAlter,
                    startAlter: assumptions.startAlter,
                    partner: assumptions.partner,
                    personDataContext: assumptions.personDataContext
                }, `${path}.horizonContext`),
                resetEvidence: copy({
                    simulatorResetApplied: context.guardrailResetApplied === true,
                    removedFields: Object.keys(simulatorStateBefore.lastState || {})
                        .filter(key => !Object.hasOwn(engineLastState || {}, key)),
                    reason: context.guardrailResetApplied ? 'deliberate_plan_change' : 'state_retained',
                    previousEngineLastState: simulatorStateBefore.lastState,
                    cumulativeInflationFactor,
                    inflationFactorReplaced: engineLastState?.initialized === true
                }, `${path}.resetEvidence`)
            };
            // Already copied in the preceding record; do not encode its markers twice.
            year.resetEvidence.previousEngineInput = years.at(-1)?.engineInput ?? null;
            years.push(year);
            pending.add(token);
            token.record = year;
        },
        afterEngine(token, result) {
            if (!pending.delete(token)) return;
            // Only the zero-withdrawal runway has a defined JSON infinity representation.
            const capturedResult = normalizeUnlimitedRunways(result);
            token.record.expectedDecision = copy(capturedResult, `$.years.${years.indexOf(token.record)}.expectedDecision`);
        },
        toLog() {
            // All stored values already belong to the collector; the returned log gets another copy.
            const log = {
                schemaVersion: PARITY_REPLAY_SCHEMA_VERSION,
                source: provenance,
                initialRecords: records,
                years,
                limitations: [
                    ...(!years.every(year => year.cashAndLots.cashOwnership.persons.every(person => person.taxState))
                        ? [{ status: 'FEHLT_MODELL', reason: 'legacy_personal_tax_state_unavailable', fields: ['personalTaxState'] }] : [])
                ],
                captureIssues
            };
            return sealParityReplayLog(JSON.parse(JSON.stringify(log)));
        }
    });
}
