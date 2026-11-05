import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { personReferenceYear } from '../profile/profile-person-data.js';
import { CONFIG } from './balance-config.js';

/** Gemeinsame, lesende Bereichs- und Jahreswahl für Balance und ihre Quellenbasis. */
/** @param {import('../../typcheck/balance-ui.js').PlanSourceOptions} [options] @returns {{plan: ReturnType<typeof readBalanceHouseholdPlan>, scope: import('../../typcheck/datenvertraege.js').PlanScope, referenceYear: number}} */
export function readBalancePlanContext({ storage, referenceYear } = {}) {
    const plan = readBalanceHouseholdPlan({ storage });
    const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY) || '{}');
    return { plan, scope: plan.scope, referenceYear: referenceYear ?? personReferenceYear(state.annualPeriodMetadata) };
}
