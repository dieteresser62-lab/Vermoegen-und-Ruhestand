import { readAssetStrategyWarnings, enableAssetStrategy, THREE_BUCKET_ACTIVATION } from '../profile/asset-strategy.js';
import { readSimulatorHouseholdPlan } from '../profile/household-plan.js';
import { renderAssetStrategyWarnings, bindAssetStrategyWarnings } from '../shared/asset-strategy-warnings.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getSimulatorPlanTrial } from './simulator-plan-trial.js';

/**
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function renderSimulatorAssetStrategyWarnings(doc = globalThis.document) {
    const host = doc.getElementById('simAssetStrategyWarnings');
    if (!host) return;
    try {
        const plan = readSimulatorHouseholdPlan();
        const values = getSimulatorPlanTrial(doc).formValues();
        const effective = values && plan.entry ? { ...plan, entry: { ...plan.entry, values } } : plan;
        renderAssetStrategyWarnings(host, readAssetStrategyWarnings({ plan: effective }), { showName: true });
    } catch { host.hidden = true; /* Die bestehende Profil-Recovery meldet beschädigte Quellen. */ }
}

/**
 * @param {object} [options]
 * @param [options.doc]
 * @param [options.refresh]
 * @returns {void}
 */
export function initSimulatorAssetStrategyWarnings({ doc = globalThis.document, refresh = () => {} } = {}) {
    const guard = getPageNavigationGuard(doc), lifecycle = createNavigationOperationLifecycle({ guard });
    bindAssetStrategyWarnings({ doc, blocked: () => guard.isBusy(),
        enable: async warning => {
            await lifecycle.run({}, navigationOperation => enableAssetStrategy({ ...warning, navigationOperation }));
            if (warning.kind === 'bonds' && getSimulatorPlanTrial(doc).read().active)
                getSimulatorPlanTrial(doc).update({ decumulation: THREE_BUCKET_ACTIVATION }, { validate: false });
        }, refresh: () => { refresh(); renderSimulatorAssetStrategyWarnings(doc); } });
    for (const name of ['input', 'change', 'simulator:plan-trial', 'simulator:household-applied'])
        doc.addEventListener(name, () => renderSimulatorAssetStrategyWarnings(doc));
    renderSimulatorAssetStrategyWarnings(doc);
}
