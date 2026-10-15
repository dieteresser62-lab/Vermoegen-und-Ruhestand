import { areaSessionStorage } from './persistence-area-storage.js';
import { captureStartupPriceSource, runStartupPriceRefresh, waitStartupPriceRefresh, publishStartupPriceReport, readStartupPriceReport } from '../tranches/tranchen-startup-prices.js';
import { createNavigationOperationLifecycle } from './navigation-guard.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';

const context = model => JSON.stringify([model?.activeId, model?.scope?.key, model?.now?.toDateString()]);
const settledReport = report => ['waiting', 'started', 'loading', 'running'].includes(report?.status) ? null : report;

/** Wiederholbarer Anschluss an den bestehenden Quote-Commitbesitzer. */
export function createClosePriceActions({ doc = globalThis.document, win = globalThis.window,
    guard = getPageNavigationGuard(doc, win), getModel, onReport = () => {},
    source = captureStartupPriceSource, coordinator = runStartupPriceRefresh,
    waitStartup = () => waitStartupPriceRefresh(doc), publish = report => publishStartupPriceReport(report, areaSessionStorage(win?.sessionStorage)) } = {}) {
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Kurse werden dauerhaft gespeichert – bitte warten.' });
    let running = false;
    return {
        get running() { return running; },
        async refresh({ signal, progress = () => {} } = {}) {
            if (running || signal?.aborted) return null;
            running = true;
            const model = getModel();
            const initial = context(model), previousReport = settledReport(model?.priceReport) ?? null;
            const valid = () => !signal?.aborted && context(getModel()) === initial;
            const report = value => { if (valid()) { onReport(value); progress(value); } };
            try {
                report({ status: 'waiting', results: [] });
                await waitStartup();
                if (!valid()) return null;
                const result = await lifecycle.run({}, async operation => {
                    const abort = () => { if (operation.phase !== 'commit') operation.controller.abort(); };
                    signal?.addEventListener('abort', abort, { once: true });
                    try { return await coordinator({ source: source(), operation, valid, progress: report }); }
                    finally { signal?.removeEventListener('abort', abort); }
                });
                if (!valid()) return null;
                publish(result); report(result); return result;
            } catch (error) {
                if (valid()) report({ status: error.code === 'NAVIGATION_WRITE_BUSY' ? 'unavailable' : 'storage-failed', updated: 0, results: [] });
                return null;
            } finally {
                running = false;
                // Der ungültige Auftrag darf seinen flüchtigen Seitenbericht nicht zurücklassen.
                // Ein inzwischen bestätigter Sitzungsabruf hat Vorrang vor dem vorherigen Stand.
                if (!valid()) {
                    let restoredReport = previousReport;
                    try { restoredReport = settledReport(readStartupPriceReport(areaSessionStorage(win?.sessionStorage))) ?? previousReport; }
                    catch { /* Ohne Sitzungszugriff bleibt der vorherige bestätigte Stand verfügbar. */ }
                    onReport(restoredReport);
                }
            }
        }
    };
}

/** Delegation überlebt die reine Modellaktualisierung; Entwurfsfelder bleiben beim Dialog. */
export function bindClosePriceActions(handle, { actions, getModel, update, signal, after = () => {} } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    handle.closed.finally(() => { abort(); signal?.removeEventListener('abort', abort); });
    handle.listen(handle.root, 'click', async event => {
        const button = event.target.closest?.('[data-close-prices-refresh]');
        if (!button || handle.busy || button.disabled || !actions || controller.signal.aborted) return;
        handle.setBusy(true);
        try {
            await actions.refresh({ signal: controller.signal, progress: () => {
                if (!controller.signal.aborted && handle.root.open) { update(getModel()); handle.setBusy(true); }
            } });
        } finally {
            handle.setBusy(false);
            if (!controller.signal.aborted && handle.root.open) { update(getModel()); after(); }
        }
    });
}
