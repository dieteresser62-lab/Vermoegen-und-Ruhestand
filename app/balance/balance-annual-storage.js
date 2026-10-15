/** Reiner Jahresentwurf: ausschließlich bestätigte Records und vorbereitete Quellen. */
import { selectGuardrailPlanInputs, INDEXED_GUARDRAIL_PLAN_FIELDS } from '../shared/guardrail-history.js';
import { CONFIG } from './balance-config.js';
import { WEALTH_CAPTURES_KEY } from '../../types/wealth-capture-contract.js';
import { buildBalanceEngineInputFromStorage, buildStoredProfileEngineInput } from './balance-input-storage.js';
import { validateInflationResult, prepareAnnualNeeds } from './balance-annual-inflation.js';
import { createAnnualMarketDataRequest, validatePreparedAnnualQuote } from './balance-annual-marketdata.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, assertPlanValues, PLAN_FIELDS, PLAN_FIELD_PATHS,
    canonicalPlan, projectPlanToBalance, stripBalancePlanInputs } from '../profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../profile/annual-plan-record.js';
import { stripBalancePersonInputs } from '../profile/profile-person-data.js';
import { createProfileOwnedBalanceState } from '../profile/profile-storage.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';

/** Der Adapter bleibt privat; keine Weiterleitung von Writes an den Quellspeicher. */
export function annualRecordStorage(records) {
    const copy = { ...records };
    return { getItem: key => copy[key] ?? null, setItem: (key, value) => { copy[key] = String(value); },
        removeItem: key => { delete copy[key]; }, key: index => Object.keys(copy)[index] ?? null,
        get length() { return Object.keys(copy).length; }, records: copy };
}
export function captureAnnualRecords(storage) {
    const keys = typeof storage.key === 'function' && Number.isInteger(storage.length)
        ? Array.from({ length: storage.length }, (_, index) => storage.key(index))
        : [CONFIG.STORAGE.LS_KEY, CONFIG.STORAGE.MIGRATION_FLAG, HOUSEHOLD_PLAN_KEY, ANNUAL_PLAN_RECORD_KEY, WEALTH_CAPTURES_KEY,
            'rs_profiles_v1', 'rs_current_profile', 'rs_active_profile', 'balance_expenses_v1',
            'household_withdrawal_mode', ...PROFILE_SCOPED_FIXED_KEYS];
    return Object.fromEntries(keys.filter(Boolean).sort().map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw != null));
}

export function assertPreparedAnnualCape(result) {
    if (!result || !Number.isFinite(result.capeRatio) || result.capeRatio <= 0
        || result.capeSource !== 'stored_last_value' && (result.capeRatio < 5 || result.capeRatio > 80)
        || !result.capeSource || !['ok_primary', 'ok_fallback_mirror', 'ok_fallback_stored', 'warn_stale_source', 'ok_synthetic'].includes(result.capeFetchStatus)) {
        throw new Error('Der vorbereitete CAPE-Stand ist ungültig oder ohne Quelle.');
    }
    return result;
}

export function applyAdoptedPlanPatch(values, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(key => !PLAN_FIELDS.includes(key))) throw new Error('Unbekanntes Planfeld.');
    const next = { ...structuredClone(values), ...structuredClone(patch) };
    for (const key of ['cape', 'decumulation']) if (Object.hasOwn(patch, key)) next[key] = { ...values[key], ...patch[key] };
    assertPlanValues(next);
    const at = (item, path) => path.split('.').reduce((value, key) => value[key], item);
    return { values: next, adjustedFields: PLAN_FIELD_PATHS.filter(path => canonicalPlan(at(values, path)) !== canonicalPlan(at(next, path))) };
}

export function computeAnnualPlanUpdate({ targetYear, marketData, scope, storage, now } = {}) {
    if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear >= 9999) throw new Error('Ungültiges Abschlussjahr.');
    const periodId = `calendar-year:${targetYear}`, planningYear = targetYear + 1;
    const baseRecords = captureAnnualRecords(storage), adapter = annualRecordStorage(baseRecords);
    const before = buildBalanceEngineInputFromStorage({ scope, storage: adapter, referenceYear: targetYear });
    let state = structuredClone(before.persistentState);
    const metadata = state.annualPeriodMetadata;
    if (metadata?.lastCommittedPeriod === periodId || state.balanceStateLifecycle?.lastCommittedPeriod === periodId) {
        return { status: 'already_committed', periodId, targetYear, planningYear, baseRecords };
    }
    if (before.householdPlan.status !== 'valid') throw new Error('Der Planbereich muss vor dem Jahresabschluss bestätigt sein.');
    if (metadata?.pendingCommit && metadata.pendingCommit.periodId !== periodId) throw new Error('Eine andere Jahresperiode ist vorbereitet.');
    if (metadata?.lastCommittedPeriod && Number(metadata.lastCommittedPeriod.slice(-4)) >= targetYear) throw new Error('Das Abschlussjahr liegt vor dem bestätigten Jahresstand.');
    const inflation = validateInflationResult(marketData?.inflation, targetYear);
    const quote = validatePreparedAnnualQuote(marketData?.etf, createAnnualMarketDataRequest(periodId));
    const cape = assertPreparedAnnualCape(marketData?.cape);
    const values = structuredClone(before.householdPlan.entry.values);
    const fields = Object.fromEntries(['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetRecharge']
        .map(id => [id, { value: values[id] }]));
    const alreadyAdjusted = state.needsAdjustedForInflationYear === planningYear;
    const needs = prepareAnnualNeeds(fields, alreadyAdjusted ? 0 : inflation.rate);
    for (const entry of needs.entries) values[entry.id] = entry.nextAmount;
    assertPlanValues(values);
    const timestamp = now ? now() : new Date(cape.capeUpdatedAt);
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new Error('Der vorbereitete Jahreszeitpunkt fehlt.');
    state.needsAdjustedForInflationYear = planningYear;
    state.inputs = { ...state.inputs, inflation: inflation.rate };
    (state.balanceInputFields ||= {}).inflation = { value: String(state.inputs.inflation), checked: false };
    state = stripBalancePersonInputs(state);
    adapter.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    adapter.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(before.householdPlan.raw, [{ scope: before.scope, values }], { now: () => timestamp }).raw);
    // Der alte Inflationshandler bestätigt Eingaben vor dem Markt-Nachrücken.
    // Diese Zwischenprojektion ist Resetevidenz, kein zusätzlicher Livewrite.
    const interim = buildBalanceEngineInputFromStorage({ scope: before.scope, storage: adapter, referenceYear: planningYear });
    const sharedInput = interim.inputData;
    const multi = interim.profiles.length > 1 || interim.profiles.length === 1 && interim.profiles[0].profileId !== before.profileId;
    if (multi) {
        state.inputs = stripBalancePlanInputs(sharedInput);
        const registry = JSON.parse(adapter.getItem('rs_profiles_v1'));
        const householdInput = { ...sharedInput, finalizeThreeBucketAction: true, ...(interim.profiles.length > 1 ? { deferTaxSettlement: true } : {}) };
        for (const profile of interim.profiles) {
            const own = { ...profile.balanceState, inputs: stripBalancePlanInputs(buildStoredProfileEngineInput(sharedInput, profile)),
                profilverbundHouseholdInputs: stripBalancePlanInputs(householdInput) };
            registry.profiles[profile.profileId].meta.updatedAt = timestamp.toISOString();
            registry.profiles[profile.profileId].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(createProfileOwnedBalanceState(own));
            if (profile.profileId === before.profileId) Object.assign(state, { inputs: own.inputs, profilverbundHouseholdInputs: own.profilverbundHouseholdInputs });
        }
        adapter.setItem('rs_profiles_v1', JSON.stringify(registry));
    } else state.inputs = stripBalancePlanInputs(sharedInput);
    state = stripBalancePersonInputs(state);
    // Automatische Indexierung verschiebt auch die alte Planbasis. Eine schon
    // vorher bewusst geänderte Einstellung bleibt bis zum Jahrescommit erkennbar.
    const evidence = selectGuardrailPlanInputs(before.history.persistentState.inputs);
    if (!alreadyAdjusted) for (const key of INDEXED_GUARDRAIL_PLAN_FIELDS) {
        if (Number.isFinite(evidence[key])) evidence[key] *= 1 + inflation.rate / 100;
    }
    state.balanceStateLifecycle = { ...state.balanceStateLifecycle, planInputEvidence: { ...state.balanceStateLifecycle?.planInputEvidence,
        [before.scope.key]: evidence } };
    values.cape = { value: cape.capeRatio, asOf: cape.capeAsOf, source: cape.capeSource };
    assertPlanValues(values);
    adapter.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(adapter.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: before.scope, values }], { now: () => timestamp }).raw);
    const old = before.readerInputData, price = quote.price, oldATH = old.ath, yearsSince = price >= oldATH ? 0 : old.jahreSeitAth + 1;
    const marketInputs = { endeVJ: price, endeVJ_1: old.endeVJ, endeVJ_2: old.endeVJ_1, endeVJ_3: old.endeVJ_2,
        ath: price > oldATH ? price : oldATH, jahreSeitAth: yearsSince };
    state.inputs = { ...state.inputs, inflation: inflation.rate, ...marketInputs };
    for (const [id, value] of Object.entries({ ...marketInputs, inflation: state.inputs.inflation })) {
        (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
    }
    state.needsAdjustedForInflationYear = planningYear;
    if (state.lastState && planningYear > (Number(state.lastInflationAppliedAtYear) || 0)) {
        const factor = Number(state.lastState.cumulativeInflationFactor ?? 1) * (1 + state.inputs.inflation / 100);
        if (!Number.isFinite(factor) || factor <= 0) throw new Error('Der kumulierte Inflationsfaktor ist ungültig.');
        state.lastState.cumulativeInflationFactor = factor;
        state.lastInflationAppliedAtYear = planningYear;
    }
    const lastHighAsOf = price >= oldATH ? quote.asOf : state.annualMarketDataMeta?.ath?.lastHighAsOf || null;
    state.annualMarketDataMeta = { schemaVersion: 1, periodId, targetYear, price, asOf: quote.asOf,
        ticker: quote.ticker, source: quote.source, ...(inflation.fetchStatus === 'ok_synthetic' ? { inflation } : {}),
        ath: { value: marketInputs.ath, yearsSince, evaluatedAsOf: quote.asOf, lastHighAsOf } };
    const { sourceLabel, errors, ...capeMeta } = cape;
    state.capeMeta = { ...state.capeMeta, ...capeMeta };
    state = stripBalancePersonInputs(state);
    adapter.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    // Der bisherige Jahresorchestrator spiegelt vor COMMIT_PERIOD den aktiven
    // Stand in die Registry. Dazu gehört der bereits fortgeschriebene Faktor.
    const finalRegistry = JSON.parse(adapter.getItem('rs_profiles_v1'));
    finalRegistry.profiles[before.profileId].meta.updatedAt = timestamp.toISOString();
    Object.assign(finalRegistry.profiles[before.profileId].data, captureProfileData(adapter));
    finalRegistry.profiles[before.profileId].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(createProfileOwnedBalanceState(state));
    adapter.setItem('rs_profiles_v1', JSON.stringify(finalRegistry));
    const people = readBalancePersonStatus({ storage: adapter, win: null, referenceYear: planningYear });
    if (!people.ready) throw people.error || new Error(people.message);
    const ageByPerson = Object.fromEntries(people.persons.map(person => [person.profileId, person.age]));
    return { status: 'prepared', periodId, targetYear, planningYear, scope: before.scope, profileId: before.profileId,
        baseRecords, records: adapter.records, values, ageByPerson, inflation, marketData: { inflation, etf: quote, cape },
        before, snapshot: { plan: structuredClone(values), inflation: state.inputs.inflation, ageByPerson },
        results: { inflation, cape, age: { old: before.inputData.aktuellesAlter, new: people.persons.find(p => p.profileId === people.calculationProfileId)?.age },
            etf: { price, date: quote.date.toLocaleDateString('de-DE', { timeZone: 'UTC' }), asOf: quote.asOf,
                ticker: quote.ticker, source: quote.source, targetYear, periodId,
                ath: { old: oldATH, new: marketInputs.ath, isNew: price > oldATH, yearsSince, evaluatedAsOf: quote.asOf, lastHighAsOf } }, errors: [] } };
}
