// @ts-check
import { byId } from './helpers.js';
import { state, QUOTE_BATCH_TIMEOUT_MS, QUOTE_BATCH_CONCURRENCY } from './state.js';
import { createBatchQuoteFetcher, resolveTrancheQuote, quoteErrorDetails } from '../tranchen-price-service.js';
import { calculateTrancheDerivedValues } from '../tranchen-manager-state.js';
import { persistTranchen } from './tranches.js';
import { processingIsBlocked } from './controls.js';
import { showPageAlert } from '../../shared/page-dialog.js';
import { renderPersistenceState } from './persistence-status.js';
import { runManagerOperation } from './history.js';

export function formatQuoteIssue(result) {
    const label = result.name || result.trancheId || 'Unbenannte Tranche';
    const message = result.status === 'skipped'
        ? 'Ticker oder ISIN fehlt'
        : String(result.message || 'Kursabruf fehlgeschlagen').trim().replace(/[.\s]+$/, '');
    return `${label}: ${message}.`;
}

export function formatBatchStatus(results, options = {}) {
    const updated = results.filter(result => result.status === 'updated').length;
    if (options.persistenceFailed) {
        return 'Kurse konnten nicht aktualisiert werden: Das Speichern ist fehlgeschlagen. Der bisherige Stand bleibt erhalten.';
    }
    if (updated === results.length) return 'Kurse erfolgreich aktualisiert.';

    const headline = updated > 0
        ? `Kurse teilweise aktualisiert (${updated} von ${results.length}).`
        : 'Kurse konnten nicht aktualisiert werden.';
    const issues = results
        .filter(result => result.status !== 'updated')
        .map(formatQuoteIssue)
        .join(' ');
    return `${headline} ${issues}`.trim();
}

export async function executePriceBatch(batchId, controller, navigationOperation) {
    const statusEl = byId('priceUpdateStatus');
    const nextTranches = state.tranchen.map(tranche => ({ ...tranche }));
    const results = new Array(nextTranches.length);
    const fetcher = createBatchQuoteFetcher(controller.signal);
    let nextIndex = 0;
    let completed = 0;
    let timedOut = false;
    const batchTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, QUOTE_BATCH_TIMEOUT_MS);

    statusEl.textContent = `Kurse werden aktualisiert... (0/${nextTranches.length})`;
    const worker = async () => {
        while (nextIndex < nextTranches.length && !controller.signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const tranche = nextTranches[index];
            let result;
            try {
                result = await resolveTrancheQuote(tranche, fetcher);
                if (result.status === 'updated') {
                    const quote = result.quote;
                    Object.assign(tranche, calculateTrancheDerivedValues({
                        ...tranche,
                        ticker: quote.symbol,
                        currentPrice: quote.price,
                        asOf: quote.asOf
                    }));
                }
            } catch (error) {
                result = {
                    status: 'failed',
                    ...quoteErrorDetails(error, tranche.ticker || tranche.isin)
                };
            }
            results[index] = {
                trancheId: tranche.trancheId,
                name: tranche.name,
                ...result
            };
            completed += 1;
            if (state.quoteBatchId === batchId) {
                statusEl.textContent = `Kurse werden aktualisiert... (${completed}/${nextTranches.length})`;
            }
        }
    };

    try {
        const workerCount = Math.min(QUOTE_BATCH_CONCURRENCY, nextTranches.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
        clearTimeout(batchTimer);
    }

    if (timedOut) {
        results.forEach((result, index) => {
            if (result?.status !== 'failed' || result.code !== 'REQUEST_ABORTED') return;
            results[index] = {
                ...result,
                code: 'BATCH_TIMEOUT',
                message: `Batch-Gesamtdauer von ${QUOTE_BATCH_TIMEOUT_MS / 1000} Sekunden ueberschritten.`
            };
        });
    }

    for (let index = 0; index < results.length; index += 1) {
        if (results[index]) continue;
        const tranche = nextTranches[index];
        results[index] = {
            trancheId: tranche.trancheId,
            name: tranche.name,
            status: 'failed',
            code: timedOut ? 'BATCH_TIMEOUT' : 'REQUEST_ABORTED',
            message: timedOut
                ? `Batch-Gesamtdauer von ${QUOTE_BATCH_TIMEOUT_MS / 1000} Sekunden ueberschritten.`
                : 'Kursbatch wurde abgebrochen.',
            symbol: tranche.ticker || tranche.isin || 'unbekannt'
        };
    }

    if (navigationOperation.controller.signal.aborted || state.quoteBatchId !== batchId || controller.signal.aborted && !timedOut) return false;
    const updated = results.filter(result => result.status === 'updated').length;
    if (updated === 0) {
        statusEl.textContent = formatBatchStatus(results);
        return false;
    }

    const committed = await persistTranchen(nextTranches, {
        successMessage: 'Kursänderungen dauerhaft gespeichert.',
        navigationOperation
    });
    if (state.quoteBatchId !== batchId) return false;
    statusEl.textContent = formatBatchStatus(results, { persistenceFailed: !committed });
    return committed;
}

export function updatePrices() {
    if (state.quoteBatchPromise) return state.quoteBatchPromise;
    if (processingIsBlocked()) return Promise.resolve(false);
    if (!state.tranchen.length) {
        void showPageAlert({ title: 'Keine Tranchen vorhanden', description: 'Lege zuerst eine Tranche an. Danach kannst Du die Kurse aktualisieren.' }).catch(error => { state.persistenceError = error.message; renderPersistenceState(); });
        return Promise.resolve(false);
    }

    const batchId = state.quoteBatchId + 1;
    state.quoteBatchId = batchId;
    const batchPromise = runManagerOperation(async navigationOperation => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        navigationOperation.controller.signal.addEventListener('abort', abort, { once: true });
        state.quoteBatchController = controller;
        try { return await executePriceBatch(batchId, controller, navigationOperation); }
        finally {
            navigationOperation.controller.signal.removeEventListener('abort', abort);
            if (state.quoteBatchId === batchId) {
                state.quoteBatchController = null;
                state.quoteBatchPromise = null;
                renderPersistenceState();
            }
        }
    });
    state.quoteBatchPromise = batchPromise;
    renderPersistenceState();
    return batchPromise;
}
