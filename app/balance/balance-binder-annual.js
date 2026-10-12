import { evaluateAnnualPlanPreview } from '../shared/annual-plan-editor.js';
import { prepareAnnualMarketData } from '../shared/annual-marketdata.js';
/**
 * Module: Balance Binder Annual
 * Purpose: specific binder module for Annual Update workflows.
 *          It groups functionality for Inflation, Market Data updates, and the Annual Update Modal.
 * Usage: Used by balance-binder.js to organize annual update logic.
 * Dependencies: balance-annual-inflation.js, balance-annual-marketdata.js, balance-annual-modal.js, balance-annual-orchestrator.js
 */
import { createInflationHandlers } from './balance-annual-inflation.js';
import { createMarketdataHandlers } from './balance-annual-marketdata.js';
import { createAnnualModalHandlers } from './balance-annual-modal.js';
import { createAnnualNavigationLifecycle } from './balance-annual-orchestrator.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';

export function createAnnualHandlers({
    dom,
    appState,
    update,
    debouncedUpdate,
    getLastUpdateResults,
    setLastUpdateResults,
    getModel, priceActions,
    navigationLifecycle = createAnnualNavigationLifecycle({ flush: async () => {
        if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    } })
}) {
    const inflation = createInflationHandlers({ dom, update, debouncedUpdate, navigationLifecycle });
    const marketdata = createMarketdataHandlers({
        dom,
        appState,
        navigationLifecycle,
        debouncedUpdate,
        applyAnnualInflation: inflation.applyAnnualInflation
    });
    const modal = createAnnualModalHandlers({ getLastUpdateResults, dom, getModel, priceActions, evaluatePlan: evaluateAnnualPlanPreview });
    const write = action => (...args) => navigationLifecycle.run({}, operation => {
        operation.commit();
        return action(...args);
    });
    return {
        publishResult(result) {
            if (!result?.results) return null;
            const published = { ...result.results, confirmed: result.status === 'already_committed',
                errors: result.error && !result.results.errors?.length
                    ? [{ step: 'Abschluss', error: result.error.message }] : result.results.errors };
            setLastUpdateResults(published);
            if (dom.controls?.btnJahresUpdateLog) dom.controls.btnJahresUpdateLog.disabled = false;
            return published;
        },
        prepareAnnualUpdate: options => prepareAnnualMarketData({ ...options,
            signal: options.signal || options.navigationOperation?.controller.signal,
            readers: { prepareInflation: inflation.prepareInflation, prepareETF: marketdata.prepareETF, prepareCape: marketdata.prepareCape } }),
        prepareInflation: inflation.prepareInflation,
        prepareETF: marketdata.prepareETF,
        prepareCape: marketdata.prepareCape,
        setProgress: modal.setProgress,
        abortContinuation: modal.abortContinuation,
        showPlanningStart: modal.showPlanningStart,
        applyInflationToBedarfe: write(inflation.applyInflationToBedarfe),
        applyAnnualInflation: inflation.applyAnnualInflation,
        handleFetchInflation: inflation.handleFetchInflation,
        showUpdateResultModal: modal.showUpdateResultModal,
        handleShowUpdateLog: modal.handleShowUpdateLog,
        showAnnualPreparation: modal.showAnnualPreparation,
        showAnnualContinuation: modal.showAnnualContinuation,
        closeAnnualModal: modal.closeAnnualModal,
        handleNachrueckenMitETF: marketdata.handleNachrueckenMitETF,
        handleFetchCapeAuto: marketdata.handleFetchCapeAuto
    };
}
