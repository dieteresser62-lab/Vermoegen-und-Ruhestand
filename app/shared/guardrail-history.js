/** FR-12: Nur geänderte Planentscheidungen verwerfen die Leitplankenhistorie.
 * Aufrufer liefern Planwerte vor CAPE-Gate, Altersableitung und Jahresindexierung.
 * Fehlende Altbelege lösen keinen vermuteten Reset aus.
 */
export const GUARDRAIL_PLAN_FIELDS = Object.freeze([
    'floorBedarf', 'flexBedarf', 'minimumFlexAnnual',
    'flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge',
    'liquidityRunwayYears', 'minCashBufferMonths', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq',
    'dynamicFlex', 'horizonMethod', 'horizonYears', 'survivalQuantile',
    'goGoActive', 'goGoMultiplier', 'longevityMode', 'longevityQuantileShift',
    'longevityRelativePct', 'longevityBufferYears', 'householdWithdrawalMode',
    'entnahmeStrategie', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold'
]);

export const INDEXED_GUARDRAIL_PLAN_FIELDS = Object.freeze([
    'floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetRecharge'
]);

/** Balance-, Plan- und Simulatornamen auf dieselben skalaren Entscheidungen abbilden. */
export function selectGuardrailPlanInputs(inputs = {}) {
    const strategy = inputs.decumulation?.threeBucket || inputs.decumulation || {};
    const value = key => {
        if (key === 'floorBedarf') return inputs.floorBedarf ?? inputs.startFloorBedarf;
        if (key === 'flexBedarf') return inputs.flexBedarf ?? inputs.startFlexBedarf;
        if (key === 'horizonYears') return inputs.guardrailPlanHorizonYears ?? inputs.horizonYears;
        if (key === 'entnahmeStrategie') return inputs.decumulation?.mode ?? inputs.entnahmeStrategie;
        return inputs[key] !== undefined ? inputs[key] : strategy[key];
    };
    return Object.fromEntries(GUARDRAIL_PLAN_FIELDS.map(key => [key, value(key)])
        .filter(([, entry]) => entry !== undefined));
}

export function shouldResetGuardrailState(previous, next) {
    if (!previous || !next) return false;
    const before = selectGuardrailPlanInputs(previous), after = selectGuardrailPlanInputs(next);
    return GUARDRAIL_PLAN_FIELDS.some(key => Object.hasOwn(before, key) && Object.hasOwn(after, key)
        && before[key] !== after[key]);
}

/** Keine Mutation; Steuerstände bleiben auch bei einem neuen Plan erhalten. */
export function applyGuardrailPlanChange(lastState, previous, next) {
    if (!shouldResetGuardrailState(previous, next)) return lastState;
    return lastState?.taxState ? { taxState: { ...lastState.taxState } } : null;
}
