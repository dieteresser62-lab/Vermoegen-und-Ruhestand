import { selectGuardrailPlanInputs, INDEXED_GUARDRAIL_PLAN_FIELDS } from '../shared/guardrail-history.js';
/** Private record translation only. All financial projections belong to Balance. */
import { CONFIG } from './balance-config.js';
import { buildPlanRecord, PLAN_FIELDS, readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { validatePersonDataContext } from '../simulator/simulator-person-overrides.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';

const stateKey = CONFIG.STORAGE.LS_KEY;
const marketFields = ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation'];
const needSources = { floorBedarf: 'baseFloor', flexBedarf: 'baseFlex', minimumFlexAnnual: 'baseMinimumFlexAnnual',
    flexBudgetAnnual: 'baseFlexBudgetAnnual', flexBudgetRecharge: 'baseFlexBudgetRecharge' };
const historyFields = [...Object.keys(needSources), 'flexBudgetYears'];

export class ParityRecordError extends Error {
    constructor(path, reason, status = 'FEHLT_LOG') {
        super(reason);
        this.issue = { status, path, reason };
    }
}
const requireValue = (condition, path, reason) => { if (!condition) throw new ParityRecordError(path, reason); };

/** No source adapter, callback or mutable record map can be attached to this view. */
export function createReadonlyParityStorage(records) {
    const copy = Object.freeze({ ...records });
    if (Object.values(copy).some(value => typeof value !== 'string')) throw new TypeError('Replayrecords müssen Strings sein.');
    const keys = Object.keys(copy);
    const deny = () => { throw new Error('PARITY_READ_ONLY_STORAGE'); };
    return Object.freeze({ getItem: key => Object.hasOwn(copy, key) ? copy[key] : null,
        key: index => keys[index] ?? null, get length() { return keys.length; },
        setItem: deny, removeItem: deny, clear: deny, toRecords: () => ({ ...copy }) });
}

/** Shares and acquisition metadata are evidence, never replaced by synthetic unit lots. */
export function serializeParityBalanceLot(lot, profileId) {
    const path = `cashAndLots.lots.${lot?.trancheId ?? '?'}`;
    for (const key of ['trancheId', 'type', 'category', 'purchaseDate']) {
        requireValue(typeof lot?.[key] === 'string' && lot[key].length > 0, `${path}.${key}`, 'lot_metadata_unavailable');
    }
    requireValue(lot.sourceProfileId === profileId, `${path}.sourceProfileId`, 'lot_owner_unavailable');
    requireValue(Number.isFinite(lot.shares) && lot.shares > 0, `${path}.shares`, 'lot_shares_unavailable');
    for (const key of ['marketValue', 'costBasis', 'tqf']) {
        requireValue(Number.isFinite(lot[key]) && lot[key] >= 0, `${path}.${key}`, 'lot_value_unavailable');
    }
    requireValue(typeof lot.taxExempt === 'boolean', `${path}.taxExempt`, 'lot_tax_status_unavailable');
    // Balance prefixes local IDs itself. Remove exactly one proven owner prefix.
    const trancheId = lot.trancheId.startsWith(`${profileId}:`) ? lot.trancheId.slice(profileId.length + 1) : lot.trancheId;
    return normalizeTrancheCollection([{ ...lot, trancheId,
        currentPrice: lot.marketValue / lot.shares, purchasePrice: lot.costBasis / lot.shares }], { mode: 'persisted' })[0];
}

function planForYear(initial, year) {
    const values = structuredClone(initial);
    // horizonYears in assumptions may already be a runner result. Keep the stored plan.
    for (const field of PLAN_FIELDS.filter(key => !['cape', 'horizonYears', ...Object.keys(needSources)].includes(key))) {
        if (Object.hasOwn(year.assumptions, field)) values[field] = structuredClone(year.assumptions[field]);
    }
    for (const [field, source] of Object.entries(needSources)) {
        const value = year.simulatorStateBefore?.[source];
        requireValue(Number.isFinite(value), `simulatorStateBefore.${source}`, 'annual_plan_basis_unavailable');
        values[field] = value;
    }
    const cape = year.marketContext?.resolvedCapeRatio;
    requireValue(Number.isFinite(cape) && cape >= 0, 'marketContext.resolvedCapeRatio', 'cape_provenance_unavailable');
    // A captured market period is provenance; it is not a live quote timestamp.
    values.cape = { value: cape, asOf: null, source: `ParityReplayLogV1:market-year:${year.historicalYear}` };
    return values;
}

function applyPersonContext(registry, context, ids, primaryId, referenceYear) {
    if (context == null) return;
    validatePersonDataContext(context);
    requireValue(context.referenceYear === referenceYear, 'assumptions.personDataContext.referenceYear', 'person_reference_year_mismatch');
    requireValue(context.persons.length === ids.length && context.persons.every(person => ids.includes(person.profileId)),
        'assumptions.personDataContext.persons', 'person_scope_mismatch');
    requireValue(context.persons.find(person => person.role === 'primary').profileId === primaryId,
        'assumptions.personDataContext.persons', 'primary_person_mismatch');
    for (const person of context.persons) for (const change of person.changes) {
        registry.profiles[person.profileId].data[change.field] = String(change.effectiveValue);
    }
}

function checkSupportedYear(year) {
    const events = year.householdEvents;
    requireValue(events && Object.hasOwn(events, 'careFloorAddition') && Object.hasOwn(events, 'temporaryFlexFactor'),
        'householdEvents', 'household_event_evidence_unavailable');
    const alive = events.normalizedHouseholdContext;
    requireValue(typeof alive?.p1Alive === 'boolean' && typeof alive?.p2Alive === 'boolean',
        'householdEvents.normalizedHouseholdContext', 'household_life_evidence_unavailable');
    const health = year.assumptions.healthBucket;
    if (events.careFloorAddition !== 0 || events.temporaryFlexFactor !== 1 || events.pflegeMeta != null
        || alive?.p1Alive === false || alive?.p2Alive === false
        || alive?.widowBenefits?.p1FromP2 || alive?.widowBenefits?.p2FromP1
        || health?.enabled || year.assumptions.healthBucketEnabled
        || year.assumptions.accumulationPhase?.enabled) {
        throw new ParityRecordError('householdEvents', 'care_survivor_accumulation_or_temporary_flex_outside_initial_scope', 'AUSGEKLAMMERT');
    }
}

/** Sources are restored copies from one validated log, never a live storage snapshot. */
export function buildParityBalanceRecords(initialRecords, year, issues) {
    requireValue(initialRecords && typeof initialRecords === 'object', 'initialRecords', 'initial_person_and_plan_records_unavailable');
    const records = { ...initialRecords };
    const initialStorage = createReadonlyParityStorage(records);
    for (const key of ['rs_profiles_v1', 'rs_current_profile', 'rs_active_profile', stateKey, 'household_plan_v1']) {
        requireValue(typeof records[key] === 'string' && records[key].length > 0, `initialRecords.${key}`, 'initial_record_unavailable');
    }
    checkSupportedYear(year);
    requireValue(Number.isInteger(year.historicalYear), 'historicalYear', 'historical_year_unavailable');
    requireValue(Number.isInteger(year.logicalPlanningYear) && year.logicalPlanningYear >= 1900 && year.logicalPlanningYear < 9999,
        'logicalPlanningYear', 'logical_planning_year_unavailable');
    requireValue(Number.isInteger(year.assumptions.referenceYear)
        && year.assumptions.referenceYear + year.yearIndex === year.logicalPlanningYear,
        'assumptions.referenceYear', 'person_and_plan_year_mismatch');
    const initialPlan = readBalanceHouseholdPlan({ storage: initialStorage });
    requireValue(initialPlan.status === 'valid', 'initialRecords.household_plan_v1', 'confirmed_plan_unavailable');
    const registry = JSON.parse(records.rs_profiles_v1);
    const ids = initialPlan.scope.ids;
    const primaryId = year.assumptions.simulationSourceProfileId;
    requireValue(ids.includes(primaryId) && ids.length <= 2, 'assumptions.simulationSourceProfileId', 'personal_pension_mapping_unavailable');
    requireValue((year.assumptions.partner?.aktiv === true) === (ids.length === 2), 'assumptions.partner', 'partner_provenance_unavailable');
    const people = readBalancePersonStatus({ storage: initialStorage, win: null, referenceYear: year.assumptions.referenceYear });
    requireValue(people.ready && people.status !== 'demo', 'initialRecords.profiles', 'person_records_unavailable');
    for (const person of people.entries) registry.profiles[person.profileId].data = person.data;
    applyPersonContext(registry, year.assumptions.personDataContext, ids, primaryId, year.assumptions.referenceYear);
    const lots = year.cashAndLots?.lots;
    requireValue(Array.isArray(lots), 'cashAndLots.lots', 'engine_lots_unavailable');
    for (const lot of lots) requireValue(ids.includes(lot.sourceProfileId), 'cashAndLots.lots.sourceProfileId', 'lot_owner_unavailable_or_outside_scope');
    const values = planForYear(initialPlan.entry.values, year);
    const previousInput = year.resetEvidence?.previousEngineInput;
    if (year.yearIndex > 0) requireValue(previousInput, 'resetEvidence.previousEngineInput', 'previous_input_evidence_unavailable');
    if (previousInput) {
        for (const field of historyFields) requireValue(Number.isFinite(previousInput[field]),
            `resetEvidence.previousEngineInput.${field}`, 'previous_plan_evidence_unavailable');
    }
    requireValue(Object.hasOwn(year, 'engineLastState') && Object.hasOwn(year.resetEvidence || {}, 'previousEngineLastState'),
        'resetEvidence.previousEngineLastState', 'previous_state_evidence_unavailable');
    const market = year.marketContext?.marketDataCurrentYear;
    for (const field of marketFields) requireValue(Number.isFinite(market?.[field]), `marketContext.marketDataCurrentYear.${field}`, 'market_window_unavailable');

    const cashOwners = year.cashAndLots?.cashOwnership?.persons;
    const cashEvidence = year.cashAndLots?.cashOwnership?.evidence;
    const provenance = { planningYear: year.logicalPlanningYear, historicalYear: year.historicalYear,
        plan: 'assumptions_and_simulatorStateBefore', horizon: 'initialRecords.household_plan_v1',
        market: 'marketContext.marketDataCurrentYear', priorInput: previousInput ? 'resetEvidence.previousEngineInput' : 'initialRecords',
        householdState: 'engineLastState', persons: {} };
    for (const id of ids) {
        const data = registry.profiles[id].data;
        for (const key of ['profile_geburtsdatum', 'profile_rentenbeginn', 'profile_rente_monatlich',
            'profile_sonstige_einkuenfte', 'profile_sparer_pauschbetrag', 'profile_kirchensteuer_pct', 'profile_tagesgeld', stateKey]) {
            requireValue(typeof data[key] === 'string' && data[key] !== '', `initialRecords.profiles.${id}.${key}`, 'personal_record_unavailable');
        }
        requireValue(Number.isFinite(Number(data.profile_tagesgeld)) && Number(data.profile_tagesgeld) >= 0,
            `initialRecords.profiles.${id}.profile_tagesgeld`, 'personal_cash_value_unavailable');
        const cashAccount = cashOwners?.find(person => person.profileId === id);
        if (cashAccount && cashEvidence !== 'legacy_personal_cash_unavailable') {
            requireValue(Number.isFinite(cashAccount.tagesgeld) && cashAccount.tagesgeld >= 0,
                `cashAndLots.cashOwnership.persons.${id}.tagesgeld`, 'personal_cash_value_unavailable');
            data.profile_tagesgeld = String(cashAccount.tagesgeld);
        } else issues.push({ status: 'FEHLT_LOG', path: `persons.${id}.cash`, reason: 'personal_cash_evidence_unavailable' });
        const annualSource = id === primaryId ? 'currentAnnualPension' : 'currentAnnualPension2';
        const annual = year.simulatorStateBefore[annualSource];
        requireValue(Number.isFinite(annual) && annual >= 0, `simulatorStateBefore.${annualSource}`, 'personal_pension_basis_unavailable');
        // Full entitlement before payment months or partner tax haircut; Balance projects the months.
        data.profile_rente_monatlich = String(annual / 12);
        const ownedLots = lots.filter(lot => lot.sourceProfileId === id).map(lot => serializeParityBalanceLot(lot, id));
        data.depot_tranchen = JSON.stringify(normalizeTrancheCollection(ownedLots, { mode: 'persisted' }));
        const state = JSON.parse(data[stateKey]);
        requireValue(state?.inputs && typeof state.inputs === 'object' && !Array.isArray(state.inputs),
            `initialRecords.profiles.${id}.${stateKey}.inputs`, 'personal_history_unavailable');
        if (previousInput) state.profilverbundHouseholdInputs = structuredClone(previousInput);
        if (ids.length > 1) {
            if (cashAccount?.taxState) state.lastState = { ...state.lastState, taxState: structuredClone(cashAccount.taxState) };
            if (year.engineLastState == null) delete state.profilverbundHouseholdLastState;
            else state.profilverbundHouseholdLastState = structuredClone(year.engineLastState);
        } else {
            // With exactly one person the pool is that person's state; there is no attribution.
            state.lastState = structuredClone(year.engineLastState);
            if (previousInput) state.inputs = structuredClone(previousInput);
        }
        data[stateKey] = JSON.stringify(state);
        provenance.persons[id] = { pension: `simulatorStateBefore.${annualSource}`, pensionStart: 'initialRecords_or_personDataContext',
            cash: cashAccount ? 'cashAndLots.cashOwnership.persons' : 'initialRecords_unproven_current_cash', taxState: cashAccount?.taxState ? 'cashAndLots.cashOwnership.persons' : ids.length > 1 ? 'initialRecords' : 'engineLastState', lots: 'cashAndLots.lots',
            lotIds: lots.filter(lot => lot.sourceProfileId === id).map((lot, index) => ({ replayId: lot.trancheId, storageId: ownedLots[index].trancheId })) };
        if (ids.length > 1 && !cashAccount?.taxState) issues.push({ status: 'FEHLT_MODELL', path: `persons.${id}.taxState`, reason: 'legacy_personal_tax_state_unavailable',
            basis: 'initialRecords', currentAtDecision: false });
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    // Balance overlays the current person's live keys. Mirror only into the private map.
    const current = registry.profiles[records.rs_current_profile];
    requireValue(current?.data, 'initialRecords.rs_current_profile', 'current_profile_unavailable');
    Object.assign(records, current.data);
    const root = JSON.parse(records[stateKey]);
    root.inputs = { ...root.inputs, ...Object.fromEntries(marketFields.map(field => [field, market[field]])) };
    for (const field of marketFields) (root.balanceInputFields ||= {})[field] = { value: String(market[field]), checked: false };
    if (previousInput) {
        // Der Vorjahresinput liegt vor der automatischen Jahresindexierung.
        // Rohplanentscheidungen stammen aus dem protokollierten Simulatorzustand.
        const priorPlan = selectGuardrailPlanInputs(year.simulatorStateBefore.guardrailPlanInputs || {});
        for (const field of historyFields) priorPlan[field] = previousInput[field]
            * (INDEXED_GUARDRAIL_PLAN_FIELDS.includes(field) ? 1 + previousInput.inflation / 100 : 1);
        (root.balanceStateLifecycle ||= {}).planInputEvidence = { ...root.balanceStateLifecycle?.planInputEvidence,
            [initialPlan.scope.key]: priorPlan };
    }
    records[stateKey] = JSON.stringify(root);
    // A captured legacy migration marker is retained; never manufacture one.
    // An old annual outcome must not override this decision's explicit inflation.
    delete records.annual_plan_record_v1;
    records.household_plan_v1 = buildPlanRecord(initialPlan.raw, [{ scope: initialPlan.scope, values }],
        { now: () => new Date(`${year.logicalPlanningYear}-01-01T12:00:00.000Z`) }).raw;
    return { storage: createReadonlyParityStorage(records), provenance };
}
