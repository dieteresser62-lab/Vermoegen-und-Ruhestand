/** Reiner Jahresentwurf: ausschließlich bestätigte Records und vorbereitete Quellen. */
import { selectGuardrailPlanInputs, INDEXED_GUARDRAIL_PLAN_FIELDS } from '../shared/guardrail-history.js';
import { CONFIG } from './balance-config.js';
import { WEALTH_CAPTURES_KEY } from '../../types/wealth-capture-contract.js';
import { buildBalanceEngineInputFromStorage, buildStoredProfileEngineInput } from './balance-input-storage.js';
import { validateInflationResult, prepareAnnualNeeds } from './balance-annual-inflation.js';
import { validateAnnualPreparationValue } from '../shared/annual-marketdata.js';
import { createAnnualMarketDataRequest, validatePreparedAnnualQuote } from './balance-annual-marketdata.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, assertPlanValues, PLAN_FIELDS, PLAN_FIELD_PATHS,
    canonicalPlan, projectPlanToBalance, stripBalancePlanInputs } from '../profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../profile/annual-plan-record.js';
import { stripBalancePersonInputs } from '../profile/profile-person-data.js';
import { createProfileOwnedBalanceState } from '../profile/profile-storage.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { deriveYearEndMarketInputs } from './balance-market-preview.js';

/** Der Adapter bleibt privat; keine Weiterleitung von Writes an den Quellspeicher. */
/**
 * @param records Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/datenvertraege.js').StringRecords} records @returns {import('../../typcheck/datenvertraege.js').RecordStorage & {records: import('../../typcheck/datenvertraege.js').StringRecords}} */
export function annualRecordStorage(records) {
    const copy = { ...records };
    return { getItem: key => copy[key] ?? null, setItem: (key, value) => { copy[key] = String(value); },
        removeItem: key => { delete copy[key]; }, key: index => Object.keys(copy)[index] ?? null,
        get length() { return Object.keys(copy).length; }, records: copy };
}
/**
 * @param storage Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/datenvertraege.js').RecordStorage} storage @returns {import('../../typcheck/datenvertraege.js').StringRecords} */
export function captureAnnualRecords(storage) {
    const keys = typeof storage.key === 'function' && Number.isInteger(storage.length)
        ? Array.from({ length: storage.length }, (_, index) => storage.key(index))
        : [CONFIG.STORAGE.LS_KEY, CONFIG.STORAGE.MIGRATION_FLAG, HOUSEHOLD_PLAN_KEY, ANNUAL_PLAN_RECORD_KEY, WEALTH_CAPTURES_KEY,
            'rs_profiles_v1', 'rs_current_profile', 'rs_active_profile', 'balance_expenses_v1', 'household_planned_expenses_v1', 'household_care_values_v1',
            'household_withdrawal_mode', ...PROFILE_SCOPED_FIXED_KEYS];
    return Object.fromEntries(keys.filter(Boolean).sort().map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw != null));
}

/**
 * @param result Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function assertPreparedAnnualCape(result) {
    if (!result || !Number.isFinite(result.capeRatio) || result.capeRatio <= 0
        || result.capeSource !== 'stored_last_value' && (result.capeRatio < 5 || result.capeRatio > 80)
        || !result.capeSource || !['ok_primary', 'ok_fallback_mirror', 'ok_fallback_stored', 'warn_stale_source', 'ok_synthetic'].includes(result.capeFetchStatus)) {
        throw new Error('Der vorbereitete CAPE-Stand ist ungültig oder ohne Quelle.');
    }
    return result;
}

/**
 * @param values Eingabe für die bestehende Projektion.
 * @param patch Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function applyAdoptedPlanPatch(values, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(key => !PLAN_FIELDS.includes(key))) throw new Error('Unbekanntes Planfeld.');
    const next = { ...structuredClone(values), ...structuredClone(patch) };
    for (const key of ['cape', 'decumulation']) if (Object.hasOwn(patch, key)) next[key] = { ...values[key], ...patch[key] };
    assertPlanValues(next);
    const at = (item, path) => path.split('.').reduce((value, key) => value[key], item);
    return { values: next, adjustedFields: PLAN_FIELD_PATHS.filter(path => canonicalPlan(at(values, path)) !== canonicalPlan(at(next, path))) };
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/balance-ui.js').ComputeAnnualOptions} [options] @returns Jahresentwurf mit eingefrorenen Quellen. */
export function computeAnnualPlanUpdate({ targetYear, marketData, yearHigh, scope, storage, now } = {}) {
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
    const lastPeriod = metadata?.lastCommittedPeriod || state.balanceStateLifecycle?.lastCommittedPeriod;
    if (lastPeriod && targetYear > Number(lastPeriod.slice(-4)) + 1) throw new Error(`Bitte zuerst das Jahr ${Number(lastPeriod.slice(-4)) + 1} mit seinen Jahresdaten abschließen. Abschlussjahre dürfen nicht übersprungen werden.`);
    const inflation = validateInflationResult(marketData?.inflation, targetYear);
    const quote = validatePreparedAnnualQuote(marketData?.etf, createAnnualMarketDataRequest(periodId));
    const cape = validateAnnualPreparationValue('cape', assertPreparedAnnualCape(marketData?.cape), targetYear);
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
    const old = before.readerInputData, price = quote.price, oldATH = old.ath;
    const marketInputs = deriveYearEndMarketInputs(/** @type {import('./balance-market-preview.js').AnnualMarketInputs} */ (old), price);
    if (yearHigh) {
        const highDay = Date.parse(`${yearHigh.asOf}T00:00:00Z`);
        if (!Number.isFinite(yearHigh.value) || yearHigh.value <= marketInputs.ath || !/^\d{4}-\d{2}-\d{2}$/.test(yearHigh.asOf)
            || !Number.isFinite(highDay) || new Date(highDay).toISOString().slice(0, 10) !== yearHigh.asOf
            || yearHigh.asOf < `${targetYear - 1}-12-31` || yearHigh.asOf > quote.asOf)
            throw new Error('Das gewählte Jahreshoch ist ungültig. Bitte die Marktdaten erneut prüfen.');
        marketInputs.ath = yearHigh.value;
        marketInputs.jahreSeitAth = (Date.parse(`${targetYear}-12-31T00:00:00Z`) - highDay) / 86400000 / 365.2425;
    }
    state.inputs = { ...state.inputs, inflation: inflation.rate, ...marketInputs };
    for (const [id, value] of Object.entries({ ...marketInputs, inflation: state.inputs.inflation })) {
        (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
    }
    state.needsAdjustedForInflationYear = planningYear;
    const advanceInflation = (lastState, marker) => {
        if (!lastState || planningYear <= (Number(marker) || 0)) return lastState;
        const factor = Number(lastState.cumulativeInflationFactor ?? 1) * (1 + inflation.rate / 100);
        if (!Number.isFinite(factor) || factor <= 0) throw new Error('Der kumulierte Inflationsfaktor ist ungültig.');
        return { ...lastState, cumulativeInflationFactor: factor };
    };
    // Dieselbe Quelle wie der Storage-Reader: den gemeinsamen Verlauf einmal
    // fortschreiben und auf alle beteiligten Profile spiegeln.
    const appliedYear = state.lastInflationAppliedAtYear;
    const source = interim.profiles.find(profile => profile.balanceState?.profilverbundHouseholdLastState)?.balanceState || state;
    const householdState = multi && interim.profiles.length > 1
        ? advanceInflation(source.profilverbundHouseholdLastState, appliedYear) : null;
    const updatedRegistry = JSON.parse(adapter.getItem('rs_profiles_v1'));
    if (multi) for (const profile of interim.profiles) {
        const own = profile.profileId === before.profileId ? state
            : JSON.parse(updatedRegistry.profiles[profile.profileId].data[CONFIG.STORAGE.LS_KEY]);
        if (interim.profiles.length === 1 && profile.profileId !== before.profileId) own.lastState = advanceInflation(own.lastState, appliedYear);
        if (householdState) own.profilverbundHouseholdLastState = structuredClone(householdState);
        updatedRegistry.profiles[profile.profileId].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(createProfileOwnedBalanceState(own));
    }
    state.lastState = advanceInflation(state.lastState, appliedYear);
    if (state.lastState || householdState) state.lastInflationAppliedAtYear = planningYear;
    if (householdState) state.profilverbundHouseholdLastState = structuredClone(householdState);
    adapter.setItem('rs_profiles_v1', JSON.stringify(updatedRegistry));
    const lastHighAsOf = yearHigh?.asOf || (price >= oldATH ? quote.asOf : state.annualMarketDataMeta?.ath?.lastHighAsOf || null);
    state.annualMarketDataMeta = { schemaVersion: 1, periodId, targetYear, price, asOf: quote.asOf,
        ticker: quote.ticker, source: quote.source, ...(inflation.fetchStatus === 'ok_synthetic' ? { inflation } : {}),
        ath: { value: marketInputs.ath, yearsSince: marketInputs.jahreSeitAth, evaluatedAsOf: quote.asOf, lastHighAsOf,
            ...(yearHigh ? { reading: 'year_high' } : {}) } };
    const { sourceLabel, errors, ...capeMeta } = cape;
    state.capeMeta = { ...state.capeMeta, ...capeMeta };
    state = stripBalancePersonInputs(state);
    adapter.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    // Der bisherige Jahresorchestrator spiegelt vor COMMIT_PERIOD den aktiven
    // Stand in die Registry. Dazu gehört der bereits fortgeschriebene Faktor.
    const finalRegistry = JSON.parse(adapter.getItem('rs_profiles_v1'));
    finalRegistry.profiles[before.profileId].meta.updatedAt = timestamp.toISOString();
    Object.assign(finalRegistry.profiles[before.profileId].data, /** @type {(storage: import("../../typcheck/datenvertraege.js").RecordStorage)=>import("../../typcheck/datenvertraege.js").StringRecords} */ (captureProfileData)(adapter));
    finalRegistry.profiles[before.profileId].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(createProfileOwnedBalanceState(state));
    adapter.setItem('rs_profiles_v1', JSON.stringify(finalRegistry));
    const people = readBalancePersonStatus({ storage: adapter, win: null, referenceYear: planningYear });
    if (!people.ready) throw people.error || new Error(people.message);
    const ageByPerson = Object.fromEntries(people.persons.map(person => [person.profileId, person.age]));
    return { status: 'prepared', periodId, targetYear, planningYear, scope: before.scope, profileId: before.profileId,
        ...(yearHigh ? { yearHigh: { ...yearHigh } } : {}),
        baseRecords, records: adapter.records, values, ageByPerson, inflation, marketData: { inflation, etf: quote, cape },
        before, snapshot: { plan: structuredClone(values), inflation: state.inputs.inflation, ageByPerson },
        results: { inflation, cape, age: { old: before.inputData.aktuellesAlter, new: people.persons.find(p => p.profileId === people.calculationProfileId)?.age },
            etf: { price, date: quote.date.toLocaleDateString('de-DE', { timeZone: 'UTC' }), asOf: quote.asOf,
                ticker: quote.ticker, source: quote.source, targetYear, periodId,
                ath: { old: oldATH, new: marketInputs.ath, isNew: yearHigh ? true : price > oldATH, yearsSince: marketInputs.jahreSeitAth, evaluatedAsOf: quote.asOf, lastHighAsOf,
                    ...(yearHigh ? { reading: 'year_high' } : {}) } }, errors: [] } };
}
