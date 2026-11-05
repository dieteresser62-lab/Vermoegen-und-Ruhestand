import { effectiveIncomeFromRecord, monthlyOtherIncome } from '../profile/profile-income.js';
import { projectBalanceFlexTrace } from './balance-flex-trace.js';
import { projectPerson } from '../profile/profile-person-data.js';
import { calculateActionLiquidityDelta } from '../profile/profilverbund-action-attribution.js';
import { calculateTaxPerEuro, calculateWithdrawalDistribution } from '../profile/profilverbund-balance.js';
import { personalProfiles } from '../simulator/simulator-personal-accounts.js';
import { canonicalParityAction, canonicalParityLots, compareParityField, compareParityTree,
    parityMeasurement } from '../shared/parity-compare.js';

const before = 'VOR_TRANSAKTION', after = 'NACH_TRANSAKTION', payout = 'VOR_AUSZAHLUNG', end = 'JAHRESENDE';
const at = (value, path) => path.split('.').reduce((object, key) => object?.[key], value);
const sumCash = input => Number.isFinite(input?.tagesgeld) && Number.isFinite(input?.geldmarktEtf) ? input.tagesgeld + input.geldmarktEtf : undefined;

/** Restore only IDs proved by the private record adapter, including new simlot purchases. */
/**
 * @param lots Eingabe für die bestehende Projektion.
 * @param provenance Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function parityReplayLotIds(lots, provenance) {
    return lots?.map(lot => {
        const mapping = provenance?.persons?.[lot.sourceProfileId]?.lotIds
            ?.find(row => `${lot.sourceProfileId}:${row.storageId}` === lot.trancheId);
        return mapping ? { ...lot, trancheId: mapping.replayId } : lot;
    });
}

/** The record adapter converts values to prices. An ULP can reverse an exact tax tie.
 * Only source/owner allocations may be marked; different household totals remain errors.
 */
/**
 * @param input Eingabe für die bestehende Projektion.
 * @param other Eingabe für die bestehende Projektion.
 * @param action Eingabe für die bestehende Projektion.
 * @param balanceAction Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function parityTaxSourcePriceTie(input, other, action, balanceAction) {
    if (!action || !balanceAction || input.householdWithdrawalMode !== 'tax_optimized') return false;
    const total = (value, key) => value.quellen.reduce((sum, source) => sum + (source[key] || 0), 0);
    for (const key of ['brutto', 'netto', 'steuer']) if (Math.abs(total(action, key) - total(balanceAction, key)) > .01) return false;
    const left = input.detailledTranches || [], right = other?.detailledTranches || [];
    const tiedIds = new Set();
    const id = lot => JSON.stringify([lot.sourceProfileId, lot.trancheId]);
    const same = (a, b) => a.sourceProfileId === b.sourceProfileId && a.trancheId === b.trancheId;
    const ratio = lot => lot.taxExempt ? 0 : ((lot.marketValue - lot.costBasis) / lot.marketValue) * (1 - lot.tqf);
    for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
        const a = left[i], b = left[j], c = right.find(lot => same(a, lot)), d = right.find(lot => same(b, lot));
        if (!c || !d || a.sourceProfileId === b.sourceProfileId || a.category !== b.category || a.marketValue <= 0 || b.marketValue <= 0) continue;
        if ([a, b].some((lot, index) => ['costBasis', 'marketValue'].some(key => Math.abs(lot[key] - [c, d][index][key]) > 1e-7))) continue;
        const delta = ratio(a) - ratio(b), otherDelta = ratio(c) - ratio(d);
        if (Math.abs(delta) <= 1e-14 && Math.abs(otherDelta) <= 1e-14 && Math.sign(delta) !== Math.sign(otherDelta)) {
            tiedIds.add(id(a)); tiedIds.add(id(b));
        }
    }
    const gross = value => new Map(value.quellen.map(source => [id(source), source.brutto]));
    const grossA = gross(action), grossB = gross(balanceAction);
    const changed = [...new Set([...grossA.keys(), ...grossB.keys()])]
        .filter(key => Math.abs((grossA.get(key) || 0) - (grossB.get(key) || 0)) > .01);
    return changed.length > 0 && changed.every(key => tiedIds.has(key));
}

/** The same price roundtrip can reverse the personal cash-withdrawal order. */
/**
 * @param left Eingabe für die bestehende Projektion.
 * @param right Eingabe für die bestehende Projektion.
 * @param paid Eingabe für die bestehende Projektion.
 * @param distribution Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function parityTaxWithdrawalPriceTie(left, right, paid, distribution) {
    if (paid?.mode !== 'tax_optimized' || distribution?.mode !== 'tax_optimized' || paid.restCause
        || Math.abs(paid.total - distribution.totalNeed) > .01) return false;
    const expected = calculateWithdrawalDistribution(left, { netWithdrawal: paid.total }, paid.mode);
    if (expected.items.some(item => Math.abs(item.withdrawalAmount
        - (paid.items.find(row => row.profileId === item.profileId)?.amount || 0)) > .01)) return false;
    const changed = left.filter(person => Math.abs((paid.items.find(item => item.profileId === person.profileId)?.amount || 0)
        - (distribution.items.find(item => item.profileId === person.profileId)?.withdrawalAmount || 0)) > .01);
    if (changed.length < 2) return false;
    const tied = new Set();
    for (let i = 0; i < changed.length; i++) for (let j = i + 1; j < changed.length; j++) {
        const a = changed[i], b = changed[j];
        const c = right.find(person => person.profileId === a.profileId), d = right.find(person => person.profileId === b.profileId);
        if (!c || !d) continue;
        if ([a, b].some((person, index) => ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu',
            'costBasisAlt', 'costBasisNeu', 'kirchensteuerSatz'].some(key =>
            Math.abs((person.inputs[key] || 0) - ([c, d][index].inputs[key] || 0)) > 1e-7))) continue;
        const delta = calculateTaxPerEuro(a.inputs) - calculateTaxPerEuro(b.inputs);
        const otherDelta = calculateTaxPerEuro(c.inputs) - calculateTaxPerEuro(d.inputs);
        if (Math.abs(delta) <= 1e-14 && Math.abs(otherDelta) <= 1e-14 && Math.sign(delta) !== Math.sign(otherDelta)) {
            tied.add(a.profileId); tied.add(b.profileId);
        }
    }
    return changed.every(person => tied.has(person.profileId));
}

// sale-engine.mjs liest bei Einzeltranchen deren TQF statt der Legacy-Aggregatwerte.
/** @param {string} key @param {{detailledTranches?: unknown}} simulator @param {{detailledTranches?: unknown}} balance @returns Ausnahmestatus für die ersetzten Legacy-Steuerwerte. */
export const parityLegacyTqfOptions = (key, simulator, balance) => ['tqfAlt', 'tqfNeu'].includes(key)
    && Array.isArray(simulator?.detailledTranches) && Array.isArray(balance?.detailledTranches)
    ? { status: 'NICHT_ANWENDBAR', reason: 'legacy_tqf_superseded_by_compared_lots' } : {};

/** Planned actions alone do not prove execution scope: reject extra coverage and clipped trades. */
/**
 * @param result Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function parityPrePayoutEvidence(result) {
    const trace = result?.logData?.balance_trace;
    const phases = ['after_returns', 'after_action_sales', 'after_forced_sales', 'after_buys'].map(phase => trace?.find(item => item.phase === phase));
    const [start, sales, forced, buys] = phases;
    if (phases.some(value => !value) || !Number.isFinite(forced.liquiditaetDelta) || !Number.isFinite(forced.healthBucketUsed)) {
        return { status: 'FEHLT_LOG', reason: 'execution_phase_evidence_missing', complete: false };
    }
    if (forced.liquiditaetDelta !== 0 || forced.healthBucketUsed !== 0) return {
        status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'additional_sales_or_reserve_coverage', complete: false };
    const action = result.ui?.action?.plannedActionFlow;
    if (!Array.isArray(action?.quellen) || !action.verwendungen) return { status: 'FEHLT_LOG', reason: 'planned_action_missing', complete: false };
    const gross = { equity: 0, gold: 0, bonds: 0, cash: 0 };
    for (const source of action.quellen) {
        const pot = source.kind === 'liquiditaet' ? 'cash' : ['gold'].includes(source.category || source.kind) ? 'gold'
            : ['bonds', 'anleihe', 'anleihen', 'bond'].includes(source.category || source.kind) ? 'bonds'
                : ['equity', 'aktien', 'aktien_alt', 'aktien_neu'].includes(source.category || source.kind) ? 'equity' : null;
        if (!pot || !Number.isFinite(source.brutto)) return { status: 'FEHLT_LOG', reason: 'source_execution_not_evidenced', complete: false };
        gross[pot] += source.brutto;
    }
    if (!Number.isFinite(sales.cashSpend)) return { status: 'FEHLT_LOG', reason: 'cash_source_execution_missing', complete: false };
    if (Math.abs(sales.cashSpend - gross.cash) > 0.01 || (action.verwendungen.geldmarkt ?? 0) !== 0) {
        return { status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'cash_or_additional_bucket_execution_differs', complete: false };
    }
    for (const pot of ['equity', 'gold', 'bonds']) {
        if (!Number.isFinite(start[pot]) || !Number.isFinite(sales[pot])) return { status: 'FEHLT_LOG', reason: 'sale_inventory_evidence_missing', complete: false };
        if (Math.abs(start[pot] - sales[pot] - gross[pot]) > 0.01) return { status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'executed_sales_differ_from_plan', complete: false };
    }
    for (const [pot, use] of [['equity', 'aktien'], ['gold', 'gold'], ['bonds', 'bonds']]) {
        const amount = Object.hasOwn(action.verwendungen, use) ? action.verwendungen[use] : 0;
        if (![buys[pot], forced[pot], amount].every(Number.isFinite)) return { status: 'FEHLT_LOG', reason: 'buy_inventory_evidence_missing', complete: false };
        if (Math.abs(buys[pot] - forced[pot] - amount) > 0.01) return { status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'executed_buys_differ_from_plan', complete: false };
    }
    return { status: 'GLEICH', reason: 'planned_trades_executed_without_extra_coverage', complete: true };
}

/** Contract projections only. Decisions and reset rules are always computed in product modules. */
/**
 * @param year Eingabe für die bestehende Projektion.
 * @param simulator Eingabe für die bestehende Projektion.
 * @param balance Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function compareParityYear(year, simulator, balance) {
    const fields = [], input = year.engineInput;
    const other = balance?.engineInput ? { ...balance.engineInput,
        detailledTranches: parityReplayLotIds(balance.engineInput.detailledTranches, balance.provenance) } : undefined;
    const balanceAction = balance?.finalAction ? { ...balance.finalAction,
        quellen: parityReplayLotIds(balance.finalAction.quellen, balance.provenance) } : undefined;
    const e = year.expectedDecision, b = balance?.decision, s = simulator?.result;
    const registry = balance?.records ? JSON.parse(balance.records.rs_profiles_v1) : null;
    const otherIncome = id => monthlyOtherIncome(effectiveIncomeFromRecord(registry?.profiles?.[id]?.data || {}), year.logicalPlanningYear ?? year.assumptions?.referenceYear ?? new Date().getFullYear());
    const hasOtherIncome = balance?.profiles?.some(profile => otherIncome(profile.profileId) !== 0);
    const fr7 = { status: 'AUSGEKLAMMERT', reason: 'FR7_other_income_balance_only' };
    const add = (id, a, z, tolerance = 'EXACT', options = {}) => {
        const phase = options.phase || before;
        const row = /** @type {import("../../typcheck/balance-ui.js").CompareParityField} */ (compareParityField)({ id, phase, category: options.category || 'EINGABE', tolerance, ...options,
            simulator: /** @type {import("../../typcheck/balance-ui.js").ParityMeasurement} */ (parityMeasurement)(a, { phase: options.simulatorPhase || phase, path: options.simulatorPath || `simulator.${id}`,
                zeroWithdrawal: options.zeroSimulator === true }),
            balance: /** @type {import("../../typcheck/balance-ui.js").ParityMeasurement} */ (parityMeasurement)(z, { phase: options.balancePhase || phase, path: options.balancePath || `balance.${id}`,
                zeroWithdrawal: options.zeroBalance === true }) });
        fields.push(row); return row;
    };
    const questions = new Map();
    const remember = row => { if (row.question && !row.withinTolerance) {
        if (!questions.has(row.question)) questions.set(row.question, []);
        questions.get(row.question).push(row.id);
    } };
    for (const [keys, tolerance] of /** @type {[string[], string][]} */ ([
        [['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetRecharge', 'depotwertAlt', 'depotwertNeu',
            'goldWert', 'costBasisAlt', 'costBasisNeu', 'goldCost', 'sparerPauschbetrag'], 'EUR'],
        [['flexBudgetYears', 'aktuellesAlter', 'horizonYears', 'horizonMethod', 'longevityMode', 'longevityBufferYears',
            'goldAktiv', 'goldSteuerfrei', 'goGoActive', 'dynamicFlex', 'renteAktiv', 'risikoprofil'], 'EXACT'],
        [['tqfAlt', 'tqfNeu', 'goldZielProzent', 'goldFloorProzent', 'rebalancingBand', 'capeRatio', 'inflation',
            'survivalQuantile', 'longevityQuantileShift', 'longevityRelativePct', 'goGoMultiplier', 'liquidityRunwayYears',
            'minCashBufferMonths', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq', 'kirchensteuerSatz'], 'RATE']
    ])) for (const key of keys) {
        const capeGate = key === 'dynamicFlex' && input.capeRatio === 0 && input.dynamicFlex !== other?.dynamicFlex;
        remember(add(`input.${key}`, input[key], other?.[key], tolerance, {
            ...parityLegacyTqfOptions(key, input, other),
            ...(hasOtherIncome && key === 'renteAktiv' ? fr7 : {}),
            ...(capeGate ? { status: 'AUSGEKLAMMERT', reason: 'documented_balance_cape_zero_gate' } : {}) }));
    }
    remember(add('input.annualPension', input.renteMonatlich * 12, other ? other.renteMonatlich * 12 : undefined, 'EUR', {
        ...(hasOtherIncome ? fr7 : {}), simulatorPath: 'engineInput.renteMonatlich*12', balancePath: 'C.engineInput.renteMonatlich*12' }));
    remember(add('input.monthlyPension', input.renteMonatlich, other?.renteMonatlich, 'EUR', hasOtherIncome ? fr7 : {}));
    remember(add('input.pooledCash', input.aktuelleLiquiditaet, sumCash(other), 'EUR'));
    for (const key of ['tagesgeld', 'geldmarktEtf']) add(`input.cashComponents.${key}`, year.cashAndLots.componentCash?.[key], other?.[key], 'EUR',
        { ...(year.cashAndLots.componentCash?.[key] === undefined ? { status: 'FEHLT_LOG', reason: 'cash_component_unavailable' } : {}) });
    add('input.finalizeThreeBucketAction', input.finalizeThreeBucketAction, other?.finalizeThreeBucketAction, 'EXACT',
        input.decumulation?.mode === '3_bucket_jilge' ? {} : { status: 'NICHT_ANWENDBAR', reason: 'three_bucket_disabled' });
    add('input.deferTaxSettlement', input.deferTaxSettlement, other?.deferTaxSettlement, 'EXACT',
        { status: balance?.profiles?.length > 1 && !year.cashAndLots.cashOwnership?.persons?.every(person => person.taxState)
            ? 'FEHLT_MODELL' : 'NICHT_ANWENDBAR', reason: 'household_tax_settled_after_source_attribution' });
    for (const key of ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath']) {
        remember(add(`input.marketRelative.${key}`, input[key] / input.endeVJ_1,
            other ? other[key] / other.endeVJ_1 : undefined, 'RATE'));
    }
    remember(add('input.jahreSeitAth', input.jahreSeitAth, other?.jahreSeitAth, 'EXACT'));
    add('input.historicalYear', year.historicalYear, balance?.resetEvidence?.simulator ? year.historicalYear : undefined);
    add('input.logicalPlanningYear', year.logicalPlanningYear, balance?.provenance?.planningYear);
    const temporal = year.marketContext.yearData.temporal;
    for (const [key, value] of [['capeReferenceYear', temporal?.decisionAsOf?.capeRatio],
        ['inflationReferenceYear', temporal?.realizedSourceYears?.inflation], ['temporalConventionId', temporal?.temporalConventionId]]) {
        add(`input.temporal.${key}`, value, undefined, 'EXACT',
            { status: 'FEHLT_LOG', reason: 'balance_records_have_no_independent_market_period_metadata',
                balancePath: 'C.householdPlan.cape.source_and_market_records' });
    }
    fields.push(...compareParityTree({ id: 'input.decumulation', simulator: input.decumulation, balance: other?.decumulation,
        phase: before, category: 'EINGABE', toleranceForKey: (key, a, b) => key === 'mode' || a === null || b === null ? 'EXACT' : 'RATE' }));
    add('input.withdrawalMode', year.assumptions.householdWithdrawalMode,
        balance?.distribution?.mode ?? (balance?.profiles?.length === 1 ? year.assumptions.householdWithdrawalMode : undefined));
    const leftLots = canonicalParityLots(input.detailledTranches), rightLots = canonicalParityLots(other?.detailledTranches);
    fields.push(...compareParityTree({ id: 'input.lots', simulator: leftLots, balance: rightLots, phase: before, category: 'EINGABE' }));
    for (const [side, lots] of /** @type {[string, ReturnType<typeof canonicalParityLots>][]} */ ([['simulator', leftLots], ['balance', rightLots]])) {
        const keys = lots?.map(lot => JSON.stringify([lot.sourceProfileId, lot.trancheId]));
        if (keys && new Set(keys).size !== keys.length) add(`input.${side}.uniqueLotIds`, keys, undefined, 'EXACT',
            { status: 'TECHNISCHER_FEHLER', reason: 'duplicate_owner_lot_id' });
    }
    const stateRows = compareParityTree({ id: 'state', simulator: year.engineLastState, balance: balance?.engineLastState,
        phase: before, category: 'VORZUSTAND' });
    fields.push(...stateRows); stateRows.forEach(remember);
    const personIds = balance?.profiles?.map(profile => profile.profileId) || [];
    for (const profile of balance?.profiles || []) {
        const primary = profile.profileId === year.assumptions.simulationSourceProfileId;
        const prefix = `persons.${profile.profileId}`;
        const person = projectPerson(registry.profiles[profile.profileId].data, year.logicalPlanningYear);
        const age = primary ? year.effectiveAnnualPensions.currentAgeP1
            : Number.isFinite(year.assumptions.partner?.startAlter) ? year.assumptions.partner.startAlter + year.yearIndex : undefined;
        add(`${prefix}.age`, age, profile.inputs.aktuellesAlter);
        const start = primary ? year.assumptions.renteStartOffsetJahre : year.assumptions.partner?.startInJahren;
        const partial = primary ? year.assumptions.renteStartMonate : year.assumptions.partner?.renteStartMonate;
        const months = year.yearIndex < start ? 0 : year.yearIndex === start ? partial : 12;
        add(`${prefix}.pensionMonths`, months, person.monateImJahr);
        remember(add(`${prefix}.annualPension`, year.effectiveAnnualPensions[primary ? 'rente1' : 'rente2'],
            profile.inputs.renteMonatlich * 12, 'EUR', otherIncome(profile.profileId) ? fr7 : {}));
        const account = year.cashAndLots.cashOwnership?.persons?.find(person => person.profileId === profile.profileId);
        for (const key of ['tagesgeld', 'geldmarktEtf']) add(`${prefix}.${key}`,
            account?.[key], profile.inputs[key], 'EUR', { category: 'PERSONENVERTEILUNG' });
        add(`${prefix}.lossCarry`, account?.taxState?.lossCarry, profile.balanceState?.lastState?.taxState?.lossCarry, 'EUR',
            { category: 'VORZUSTAND', ...(!account?.taxState ? { status: 'FEHLT_MODELL', reason: 'legacy_personal_tax_state_unavailable' } : {}) });
    }
    if (input.longevityMode && input.longevityMode !== 'none') {
        fields.push(...compareParityTree({ id: 'input.longevityDiagnostics',
            simulator: year.horizonContext.diagnostics, balance: other?.longevityHorizonDiagnostics,
            phase: before, category: 'EINGABE' }));
    } else add('input.longevityDiagnostics', year.horizonContext.diagnostics, other?.longevityHorizonDiagnostics, 'EXACT',
        { status: 'NICHT_ANWENDBAR', reason: 'longevity_mode_none' });
    const dependencies = [...questions.values()].flat();
    const decisionOptions = { category: 'ENTSCHEIDUNG', upstream: dependencies, ...(hasOtherIncome ? fr7 : {}) };
    add('decision.monthlyBudget', e?.newState?.lastTotalBudget / 12, balance?.annualMonthlyBudget, 'EUR',
        decisionOptions);
    const pension = Number.isFinite(balance?.annualMonthlyBudget) && Number.isFinite(b?.ui?.spending?.monatlicheEntnahme)
        ? (balance.annualMonthlyBudget - b.ui.spending.monatlicheEntnahme) * 12 : undefined;
    add('decision.annualIncomeRounding', input.renteMonatlich * 12, pension, 'EUR',
        { category: 'ENTSCHEIDUNG', ...(hasOtherIncome ? fr7 : {}), simulatorPath: 'engineInput.renteMonatlich*12', balancePath: '(J.monthlyBudget-J.monthlyWithdrawal)*12' });
    const projection = projectBalanceFlexTrace({ ...e?.ui, input });
    add('decision.plannedPensionSurplus', projection.income == null ? undefined : Math.max(0, projection.income * 12 - input.floorBedarf),
        balance?.projection?.income == null ? undefined : Math.max(0, balance.projection.income * 12 - other.floorBedarf), 'EUR', decisionOptions);
    for (const key of ['budget', 'householdFlex', 'financedHouseholdFlex']) add(`decision.household.${key}`,
        projection[key] === null ? undefined : projection[key] * 12,
        balance?.projection?.[key] == null ? undefined : balance.projection[key] * 12, 'EUR', decisionOptions);
    add('decision.monthlyWithdrawal', e?.ui?.spending?.monatlicheEntnahme, b?.ui?.spending?.monatlicheEntnahme, 'EUR', decisionOptions);
    add('decision.annualWithdrawal', e?.ui?.spending?.monatlicheEntnahme * 12,
        b ? b.ui.spending.monatlicheEntnahme * 12 : undefined, 'EUR', decisionOptions);
    add('decision.loggedAnnualWithdrawal', s?.logData?.entnahme_plan, b ? b.ui.spending.monatlicheEntnahme * 12 : undefined, 'EUR', decisionOptions);
    add('control.plannedWithdrawal', s?.logData?.entnahme_plan, e?.ui?.spending?.monatlicheEntnahme * 12, 'EUR',
        { category: 'ENTSCHEIDUNG', reason: 'planned_withdrawal_consistency' });
    add('control.actualWithdrawal', s?.logData?.entnahme_effektiv, s?.logData?.entscheidung?.jahresEntnahme, 'EUR',
        { category: 'AUSFUEHRUNG', phase: end, reason: 'actual_withdrawal_consistency' });
    for (const [path, tolerance] of [
        ['newState.flexRate', 'RATE'], ['ui.spending.kuerzungProzent', 'RATE'], ['ui.spending.kuerzungQuelle', 'EXACT'],
        ['diagnosis.keyParams.finalLimitingPolicy', 'EXACT'], ['ui.market.sKey', 'EXACT'],
        ['ui.vpw.horizonYears', 'EXACT'], ['ui.vpw.expectedRealReturn', 'RATE'], ['ui.vpw.dynamicFlex', 'EUR'],
        ['newState.vpwSafetyStage', 'EXACT'],
        ...['minimumFlexAnnual', 'minimumFlexEffectiveFinal', 'minimumFlexShortfallAnnual'].map(key => [`diagnosis.keyParams.${key}`, 'EUR']),
        ...['minimumFlexStatus', 'minimumFlexFulfilled', 'safetyCapActive', 'safetyCapApplied', 'safetyCapSource', 'minimumFlexOverrideAllowed']
            .map(key => [`diagnosis.keyParams.${key}`, 'EXACT'])
    ]) add(`decision.${path}`, at(e, path), at(b, path), tolerance, { ...decisionOptions,
        ...(['ui.vpw.dynamicFlex', 'ui.vpw.expectedRealReturn'].includes(path)
            && e?.ui?.vpw?.enabled === false && b?.ui?.vpw?.enabled === false
            && at(e, path) === undefined && at(b, path) === undefined
            ? { status: 'NICHT_ANWENDBAR', reason: 'dynamic_flex_inactive' } : {}) });
    const actionS = canonicalParityAction(s?.ui?.action?.plannedActionFlow), actionB = canonicalParityAction(balanceAction);
    const personalActions = s?.ui?.action?.personalPlannedActions;
    const sourceTie = parityTaxSourcePriceTie(input, other, s?.ui?.action?.plannedActionFlow, balanceAction);
    const sourceOptions = sourceTie ? { status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'tax_source_order_after_price_roundtrip' } : {};
    const transactionOptions = personIds.length > 1 && !personalActions
        ? { status: 'FEHLT_MODELL', reason: 'legacy_personal_tax_state_unavailable' } : decisionOptions;
    add('transaction.type', actionS?.type, actionB?.type, 'EXACT', { ...transactionOptions, phase: after, category: 'AUSFUEHRUNG' });
    fields.push(...compareParityTree({ id: 'transaction.sources', simulator: actionS?.sources, balance: actionB?.sources,
        phase: after, category: 'PERSONENVERTEILUNG', ...transactionOptions, ...sourceOptions }));
    const usesS = actionS?.uses, usesB = actionB?.uses;
    for (const key of [...new Set([...Object.keys(usesS || {}), ...Object.keys(usesB || {})])].sort()) add(`transaction.uses.${key}`,
        usesS ? usesS[key] ?? 0 : undefined, usesB ? usesB[key] ?? 0 : undefined, 'EUR', { ...transactionOptions, phase: after, category: 'AUSFUEHRUNG' });
    add('transaction.tax', actionS?.tax, actionB?.tax, 'EUR', { ...transactionOptions, phase: after, category: 'AUSFUEHRUNG' });
    const payouts = s?.logData?.personalPayout;
    const payoutTie = year.simulatorStateBefore?.portfolio?.personAccounts
        && parityTaxWithdrawalPriceTie(personalProfiles(year.simulatorStateBefore.portfolio, year.assumptions),
            balance?.profiles || [], payouts, balance?.distribution);
    const payoutOptions = payoutTie ? { status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'tax_withdrawal_order_after_price_roundtrip' }
        // Ein belegter Eigentümerwechsel der steuerlich gleichen Verkaufsquelle
        // ändert auch das danach verfügbare persönliche Tagesgeld.
        : sourceTie && !payouts?.restCause && Math.abs(payouts?.total - balance?.distribution?.totalNeed) <= .01 ? sourceOptions : {};
    add('transaction.personalPayoutOrder', payouts?.items.map(item => item.profileId), balance?.distribution?.items.map(item => item.profileId), 'EXACT',
        { phase: after, category: 'PERSONENVERTEILUNG', ...payoutOptions, ...(personIds.length === 1 ? { status: 'NICHT_ANWENDBAR', reason: 'single_person' } : {}) });
    for (const run of balance?.personalResults || []) {
        const personal = personalActions?.find(row => row.profileId === run.profileId);
        const options = { ...transactionOptions, ...sourceOptions, phase: after, category: 'PERSONENVERTEILUNG' };
        add(`transaction.persons.${run.profileId}.annualWithdrawal`, payouts?.items.find(item => item.profileId === run.profileId)?.amount ?? (payouts ? 0 : undefined),
            run.ui.spending.monatlicheEntnahme * 12, 'EUR', { phase: after, category: 'PERSONENVERTEILUNG', ...payoutOptions,
                ...(payouts?.restCause ? { status: 'FEHLT_MODELL', reason: payouts.restCause } : {}), ...(hasOtherIncome ? fr7 : {}) });
        add(`transaction.persons.${run.profileId}.plannedTax`, personal?.action.steuer, run.ui.action.steuer, 'EUR', options);
        add(`transaction.persons.${run.profileId}.lossCarryNext`, personal?.taxStateNext?.lossCarry, run.newState.taxState?.lossCarry, 'EUR', options);
        for (const [pot, amount] of Object.entries(run.ui.action.verwendungen || {})) add(`transaction.persons.${run.profileId}.uses.${pot}`,
            personal?.action.verwendungen?.[pot], amount, 'EUR', options);
    }
    const phaseEvidence = parityPrePayoutEvidence(s);
    // No equivalence from equal totals: complete actions (including owner/order/tax) must agree first.
    const comparableActions = actionS && actionB && phaseEvidence.complete && fields
        .filter(row => row.id.startsWith('transaction.'))
        .every(row => ['GLEICH', 'NICHT_ANWENDBAR'].includes(row.status));
    const phaseOptions = comparableActions ? decisionOptions : { status: phaseEvidence.status === 'FEHLT_LOG' ? 'FEHLT_LOG' : 'PHASE_NICHT_VERGLEICHBAR',
        reason: phaseEvidence.complete ? 'different_or_incomplete_transaction_scope' : phaseEvidence.reason };
    const coverage = s?.logData?.balance_trace?.find(item => item.phase === 'after_forced_sales');
    for (const key of ['liquiditaetDelta', 'healthBucketUsed']) add(`liquidity.extraCoverage.${key}`, coverage?.[key], 0, 'EUR',
        { phase: payout, category: 'AUSFUEHRUNG', ...(coverage?.[key] !== 0 ? phaseOptions : {}) });
    const zeroSimulator = e?.ui?.spending?.monatlicheEntnahme === 0, zeroBalance = b?.ui?.spending?.monatlicheEntnahme === 0;
    const balanceCash = other && balance.finalAction ? sumCash(other) + calculateActionLiquidityDelta(balance.finalAction) : undefined;
    add('liquidity.cashBeforePayout', s?.logData?.liq_before_payout, balanceCash, 'EUR', { ...phaseOptions, phase: payout });
    const loggedRunway = s?.logData?.runway_after_transaction_before_payout_months;
    const simulatorRunway = zeroSimulator && loggedRunway === null && Number.isFinite(s?.logData?.liq_before_payout) ? Infinity : loggedRunway;
    add('liquidity.runwayMonths', simulatorRunway, b?.ui?.runway?.months, 'RATE',
        { ...phaseOptions, phase: payout, zeroSimulator, zeroBalance });
    for (const [key, path, tolerance] of [['target', 'ui.zielLiquiditaet', 'EUR'], ['targetMonths', 'diagnosis.general.runwayTargetMonate', 'RATE'],
        ['minimumMonths', 'diagnosis.keyParams.minimumFlexEmergencyMinRunwayMonths', 'RATE']]) add(`liquidity.${key}`, at(e, path), at(b, path), tolerance, {
            ...decisionOptions, ...(key === 'minimumMonths' && at(e, path) === undefined && at(b, path) === undefined
                && [e, b].every(result => result?.diagnosis?.keyParams && !Object.keys(result.diagnosis.keyParams)
                    .some(name => name.startsWith('minimumFlexEmergency')))
                ? { status: 'NICHT_ANWENDBAR', reason: 'minimum_flex_emergency_not_evaluated' } : {}) });
    add('liquidity.coverageAfter', s?.ui?.liquiditaet?.deckungNachher ?? undefined, b?.ui?.liquiditaet?.deckungNachher, 'RATE',
        { ...phaseOptions, phase: payout, ...(zeroSimulator && s?.ui?.zielLiquiditaet === 0
            ? { status: 'NICHT_ANWENDBAR', reason: 'zero_liquidity_target' } : {}) });
    add('liquidity.withdrawalDenominator', s?.logData?.entnahme_plan, b ? b.ui.spending.monatlicheEntnahme * 12 : undefined, 'EUR',
        { ...phaseOptions, phase: payout });
    for (const [id, value] of [['portfolio', s?.newState?.portfolio], ['actualWithdrawal', s?.logData?.entnahme_effektiv],
        ['annualTax', s?.logData?.steuern_gesamt], ['lossCarry', s?.logData?.lossCarryEnd], ['taxCashAdjustment', s?.logData?.tax_cash_adjustment],
        ['actualHouseholdFlex', s?.logData?.flex_haushalt_erfuellt], ['actualGrossHouseholdFlex', s?.logData?.flex_brutto_haushalt],
        ['actualPensionSurplus', s?.logData?.flex_rentenueberschuss]]) add(`yearEnd.${id}`,
        value, undefined, id === 'portfolio' ? 'EXACT' : 'EUR',
        { phase: end, status: 'PHASE_NICHT_VERGLEICHBAR', category: 'ZEITLAGE', reason: 'balance_has_no_executed_year_end' });
    const flow = s?.logData?.portfolio_flow_delta;
    add('yearEnd.flowDelta', flow, 0, 'EUR', { phase: end, category: 'AUSFUEHRUNG',
        ...(Number.isFinite(flow) && Math.abs(flow) > 0.01 ? { status: 'TECHNISCHER_FEHLER', reason: 'flow_delta_exceeds_contract' } : {}) });
    // Preserve phase order even when fields are added in a different implementation order.
    return fields.sort((a, b) => [before, after, payout, end].indexOf(a.phase) - [before, after, payout, end].indexOf(b.phase));
}
