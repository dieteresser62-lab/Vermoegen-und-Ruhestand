/** Private execution boundary. Independent annual account booking is not implemented here. */
import { CONFIG } from '../../app/balance/balance-config.js';
import { createReadonlyParityStorage } from '../../app/balance/parity-balance-records.js';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { evaluateAnnualDraft } from '../../app/balance/balance-annual-storage-commit.js';
import { computeAnnualPlanUpdate } from '../../app/balance/balance-annual-storage.js';
import { createManualAnnualQuote } from '../../app/shared/annual-marketdata.js';
import { INFLATION_RESULT_METRIC } from '../../app/balance/balance-annual-inflation.js';
import { buildPlanRecord, readBalanceHouseholdPlan, stripBalancePlanInputs } from '../../app/profile/household-plan.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';

const stateKey = CONFIG.STORAGE.LS_KEY;
export const SEQUENCE_INCOMPLETE = 'NICHT_VOLLSTAENDIG_AUSFUEHRBAR';
const marketKeys = ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth'];

function changePeople(records, change) {
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(registry.profiles)) change(profile.data, id);
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
}

function setMarket(records, market) {
    const state = JSON.parse(records[stateKey]);
    for (const key of [...marketKeys, 'inflation']) {
        state.inputs[key] = market[key];
        (state.balanceInputFields ||= {})[key] = { value: String(market[key]), checked: false };
    }
    records[stateKey] = JSON.stringify(state);
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles[records.rs_current_profile].data[stateKey] = records[stateKey];
    records.rs_profiles_v1 = JSON.stringify(registry);
}

/** Only exogenous returns touch the independent holdings; no later simulator stock/state is accepted. */
function applyReturns(records, yearData) {
    changePeople(records, data => {
        const lots = normalizeTrancheCollection(JSON.parse(data.depot_tranchen), { mode: 'persisted' });
        for (const lot of lots) {
            const rate = lot.category === 'equity' ? yearData.rendite
                : lot.category === 'gold' ? yearData.gold_eur_perf / 100
                    : lot.category === 'bonds' ? yearData.zinssatz / 100 : 0;
            lot.currentPrice *= 1 + rate;
            lot.marketValue = lot.currentPrice * lot.shares;
        }
        data.depot_tranchen = JSON.stringify(normalizeTrancheCollection(lots, { mode: 'persisted' }));
    });
}

/** FR-10 decides the account order; this adapter still lacks its own annual booking ledger. */
export function prepareParityExecution(evaluation, yearData) {
    const runs = evaluation.runs || [{ profileId: evaluation.calculation.profileId,
        ui: evaluation.modelResult.ui, newState: evaluation.modelResult.newState }];
    const ledger = runs.map(run => ({ profileId: run.profileId, action: structuredClone(run.ui.action),
        withdrawal: run.ui.spending.monatlicheEntnahme * 12, nextTaxState: structuredClone(run.newState.taxState ?? null) }));
    const needsAccounts = ledger.some(item => item.withdrawal !== 0 || item.action.steuer !== 0 || item.action.quellen?.length
        || Object.values(item.action.verwendungen || {}).some(value => value !== 0)) || yearData.zinssatz !== 0;
    return { assumption: 'Empfehlung vollständig ausgeführt', ledger,
        status: needsAccounts ? SEQUENCE_INCOMPLETE : 'AUSGEFUEHRT',
        reason: needsAccounts ? 'independent_annual_execution_adapter_missing' : 'no_cash_or_trade_movements',
        question: null, applied: !needsAccounts };
}

function continueOwnState(records, evaluation, rentAdjustment) {
    changePeople(records, (data, id) => {
        const state = JSON.parse(data[stateKey]);
        const run = evaluation.runs?.find(item => item.profileId === id);
        state.inputs = stripBalancePlanInputs(run?.persistedInput || run?.input || evaluation.inputData);
        state.lastState = structuredClone(run?.newState || evaluation.modelResult.newState);
        if (evaluation.runs) {
            state.profilverbundHouseholdInputs = stripBalancePlanInputs(evaluation.runs.householdInput);
            state.profilverbundHouseholdLastState = { ...structuredClone(evaluation.modelResult.newState), taxState: { lossCarry: 0 } };
        }
        data[stateKey] = JSON.stringify(state);
        data.profile_rente_monatlich = String(Number(data.profile_rente_monatlich) * (1 + rentAdjustment / 100));
    });
}

/** Seed once from the original household and the frozen pre-period market, never from a later replay. */
export function createParitySequenceSeed(initialRecords, preset, market, referenceYear) {
    const records = { ...initialRecords };
    const plan = readBalanceHouseholdPlan({ storage: createReadonlyParityStorage(records) });
    records.household_plan_v1 = buildPlanRecord(plan.raw, [{ scope: plan.scope, values: { ...plan.entry.values, ...preset } }],
        { now: () => new Date(`${referenceYear}-01-01T12:00:00Z`) }).raw;
    delete records.annual_plan_record_v1;
    setMarket(records, { ...market, inflation: 0 });
    return records;
}

/** Subsequent years with an unresolved execution are evidence gaps, never fabricated recommendations. */
export function runParityBalanceSequence({ initialRecords, events }, { engineApi } = {}) {
    let records = { ...initialRecords }, stopped = null;
    const observations = [];
    for (const event of events) {
        const { logicalPlanningYear, historicalYear, yearData } = event;
        if (stopped) {
            observations.push({ historicalYear, logicalPlanningYear, status: stopped.status,
                firstUnavailableYear: stopped.historicalYear, reason: stopped.reason,
                calculation: null, execution: null, decision: null, records: null });
            continue;
        }
        try {
            applyReturns(records, yearData);
            let draft;
            if (observations.length === 0) {
                const calculation = buildBalanceEngineInputFromStorage({ storage: createReadonlyParityStorage(records), referenceYear: logicalPlanningYear });
                const previous = calculation.readerInputData;
                const price = previous.endeVJ * (1 + yearData.rendite);
                setMarket(records, { endeVJ: price, endeVJ_1: previous.endeVJ, endeVJ_2: previous.endeVJ_1,
                    endeVJ_3: previous.endeVJ_2, ath: Math.max(previous.ath, price),
                    jahreSeitAth: price >= previous.ath ? 0 : previous.jahreSeitAth + 1, inflation: yearData.inflation });
                const plan = readBalanceHouseholdPlan({ storage: createReadonlyParityStorage(records) });
                const values = { ...plan.entry.values, cape: { value: yearData.capeRatio, asOf: null, source: 'frozen_historical_period' } };
                records.household_plan_v1 = buildPlanRecord(plan.raw, [{ scope: plan.scope, values }],
                    { now: () => new Date(`${logicalPlanningYear}-01-01T12:00:00Z`) }).raw;
                draft = { records, values, scope: plan.scope, planningYear: logicalPlanningYear, ageByPerson: {} };
            } else {
                const previous = buildBalanceEngineInputFromStorage({ storage: createReadonlyParityStorage(records), referenceYear: logicalPlanningYear - 1 });
                const targetYear = logicalPlanningYear - 1;
                const priorEvent = events[observations.length - 1];
                const date = `${targetYear}-12-31`;
                draft = computeAnnualPlanUpdate({ storage: createReadonlyParityStorage(records), targetYear,
                    now: () => new Date(`${logicalPlanningYear}-01-01T12:00:00Z`), marketData: {
                        inflation: { rate: priorEvent.yearData.inflation, year: targetYear, metric: INFLATION_RESULT_METRIC,
                            source: `historical-year:${priorEvent.historicalYear}`, dataAsOf: date, fetchStatus: 'ok_synthetic' },
                        etf: createManualAnnualQuote(previous.readerInputData.endeVJ * (1 + yearData.rendite), `calendar-year:${targetYear}`),
                        cape: { capeRatio: yearData.capeRatio, capeAsOf: date, capeSource: `historical-year:${historicalYear}`,
                            capeFetchStatus: 'ok_synthetic', capeUpdatedAt: `${date}T12:00:00Z` }
                    } });
                records = { ...draft.records };
            }
            const evaluation = evaluateAnnualDraft(draft, { engineApi, now: () => new Date(`${logicalPlanningYear}-01-01T12:00:00Z`) });
            const execution = prepareParityExecution(evaluation, yearData);
            observations.push({ historicalYear, logicalPlanningYear, status: execution.status, reason: execution.reason,
                records: { ...records }, engineInput: evaluation.calculation.engineInput,
                engineLastState: evaluation.calculation.engineLastState, decision: evaluation.modelResult,
                annualMonthlyBudget: evaluation.monthlyBudget, profiles: evaluation.calculation.profiles,
                personalResults: evaluation.runs ? [...evaluation.runs] : [], history: evaluation.calculation.history,
                finalAction: evaluation.runs?.finalAction || evaluation.modelResult.ui.action, execution });
            if (!execution.applied) stopped = { historicalYear, status: execution.status, reason: execution.reason };
            else continueOwnState(records, evaluation, event.rentAdjustment);
        } catch (error) {
            stopped = { historicalYear, status: 'TECHNISCHER_FEHLER', reason: error.message };
            observations.push({ historicalYear, logicalPlanningYear, ...stopped, decision: null, execution: null, records: null });
        }
    }
    return observations;
}
