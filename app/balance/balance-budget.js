import { decidedFixedIncomeSurplus } from '../shared/fixed-income-budget.js';

/** FR-52: aktuelles Budget und Anlageanteil aus denselben Jahreswerten wie im Simulator. */
/** @param {import('../../typcheck/balance-ui.js').Ui} [ui] @returns {import('../../typcheck/balance-ui.js').Budget} */
export function projectBalanceBudget(ui = {}) {
    const input = ui.input || {};
    const income = (input.renteAktiv ?? Number.isFinite(input.renteMonatlich)) ? input.renteMonatlich : 0;
    const withdrawal = ui.spending?.monatlicheEntnahme;
    if (![income, withdrawal].every(Number.isFinite)) return { income, withdrawal, budget: null, saving: null };
    let saving = 0;
    if ([input.floorBedarf, input.flexBedarf].every(Number.isFinite)) {
        saving = decidedFixedIncomeSurplus(/** @type {Parameters<typeof decidedFixedIncomeSurplus>[0]} */ (ui)) / 12;
    }
    return { income, withdrawal, budget: income + withdrawal - saving, saving };
}
