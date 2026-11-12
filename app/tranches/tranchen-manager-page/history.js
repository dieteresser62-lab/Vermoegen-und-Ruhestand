// @ts-check
import { state } from './state.js';
import { PROFILE_STORAGE_KEYS } from '../../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY, PROFILE_CASH_HISTORY_KEY } from '../../profile/profile-wealth-history.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { requestPageConfirmation, showPageAlert } from '../../shared/page-dialog.js';
import { byId } from './helpers.js';
import { renderPersistenceState } from './persistence-status.js';
import { processingIsBlocked } from './controls.js';
import { prepareHistoryRecovery, commitHistoryRecovery } from '../tranchen-history-recovery.js';
import { render } from './rendering.js';
import { assertHistoryStart } from '../tranchen-history-store.js';
import { confirmManagerHistoryStart } from '../tranchen-history-ui.js';
import { setReloadPricesProgress, reloadPricesDoneText } from '../tranche-split-hint.js';
import { reloadSymbolHistory, historyReloadReason } from '../tranchen-history-reload.js';

/** Entscheidung gehört zum ursprünglichen Dokument, Profil und unveränderten Bestand. */
export async function requestManagerDecision(options, operation, decide) {
    const doc = document, profileId = state.profileId, tranches = state.tranchen, loadStatus = state.loadStatus;
    const keys = [...Object.values(PROFILE_STORAGE_KEYS), 'depot_tranchen', PROFILE_WEALTH_LOTS_KEY, PROFILE_CASH_HISTORY_KEY];
    const source = new Map(keys.map(key => [key, persistenceStorage.getItem(key)]));
    const confirmed = await (decide ? decide(options.description) : requestPageConfirmation({
        ...options, doc, signal: operation.controller.signal,
        returnFocus: () => { const opener = options.opener; (opener?.isConnected ? opener : byId('depotAddTrancheBtn') || byId('tranchePersistenceStatus'))?.focus?.(); }
    }));
    operation.check();
    return confirmed === true && document === doc && state.boundDocument === doc && state.profileId === profileId
        && state.tranchen === tranches && state.loadStatus === loadStatus
        && [...source].every(([key, raw]) => persistenceStorage.getItem(key) === raw);
}

export async function runManagerOperation(execute) {
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    try { return await state.navigationLifecycle.run({}, execute); }
    catch (error) {
        if (error?.name !== 'AbortError') {
            state.persistenceError = error.message || 'Die Aktion konnte nicht abgeschlossen werden.';
            renderPersistenceState();
        }
        return false;
    } finally {
        renderPersistenceState();
    }
}

/** @param {{trancheId: string, kind: string}} request
 * @param {{confirmCorrection?: (description: string) => unknown}} [options]
 */
export async function repairManagerHistory({ trancheId, kind }, { confirmCorrection } = {}) {
    if (processingIsBlocked()) return false;
    const doc = document, origin = state.profileId;
    const valid = () => document === doc && state.boundDocument === doc && state.profileId === origin;
    state.historyRecoveryMessage = '';
    state.persistenceError = '';
    const result = await runManagerOperation(async operation => {
        const prepared = prepareHistoryRecovery({ profileId: origin, trancheId, kind });
        if (!prepared) return false;
        const message = kind === 'correct'
            ? `Für „${prepared.candidate.name}“ bestätigen: Kaufdatum, Typ, ISIN und Stückzahl sind rückwirkend gültige Stammdaten. Dies ist kein späterer Nachkauf; dafür eine neue Tranche anlegen. Die Rekonstruktion bleibt vorläufig. Fortfahren?`
            : `„${prepared.candidate.name}“ als nie gültige Fehleingabe aus dem Verlauf verwerfen? Nur die Verlaufskopie wird entfernt. Dies erfasst keinen Verkauf und keine Entnahme und ändert weder Depotbestand noch Tagesgeld.`;
        const confirmed = await requestManagerDecision({ title: kind === 'correct' ? 'Verlauf korrigieren' : 'Verlauf verwerfen', description: message, confirmLabel: kind === 'correct' ? 'Verlauf korrigieren' : 'Verlauf verwerfen', danger: kind !== 'correct', opener: document.activeElement }, operation, confirmCorrection);
        if (!confirmed) return false;
        await commitHistoryRecovery(prepared, { confirmed: true, operation, valid });
        if (!valid()) return false;
        state.historyRecoveryMessage = kind === 'correct' ? 'Korrigierter Verlauf bestätigt · vorläufige Rekonstruktion.' : 'Fehleingabe aus dem Verlauf verworfen.';
        return true;
    });
    if (!valid()) return false;
    if (result !== true && state.persistenceError) state.historyRecoveryMessage = `Verlauf nicht repariert: ${state.persistenceError} Erneut bestätigen, um zu wiederholen.`;
    render();
    const replacement = Array.from(/** @type {NodeListOf<HTMLButtonElement>} */ (byId('managerHousehold')?.querySelectorAll?.('[data-history-recovery]')) || [])
        .find(button => button.dataset.historyRecovery === trancheId);
    (replacement || byId('managerHistoryRecoveryStatus'))?.focus?.();
    return result === true;
}

/** Ein Beginnwrite besitzt denselben kurzen Commit wie die übrige Managerbedienung. */
export async function saveManagerHistoryStart(startDate = byId('managerHistoryStart')?.value) {
    if (processingIsBlocked()) return false;
    const status = byId('managerHistoryStartStatus');
    const origin = state.profileId;
    const doc = document;
    try {
        // Vor Besitzaufnahme validieren: ungültige Eingaben erzeugen keinen Write.
        const next = assertHistoryStart({ version: 1, startDate });
        const result = await runManagerOperation(async operation => {
            await confirmManagerHistoryStart(next.startDate, { operation,
                valid: () => document === doc && state.profileId === origin });
            state.historyStartDraft = null;
            render();
            const currentStatus = byId('managerHistoryStartStatus');
            if (currentStatus) currentStatus.textContent = 'Verlaufsbeginn bestätigt. Fehlende Kurse werden beim nächsten Start nachgeladen.';
            byId('managerHistoryStartConfirm')?.focus();
            return true;
        });
        if (result !== true && status) status.textContent = `Beginn nicht bestätigt. ${state.persistenceError || 'Die Aktion wurde abgebrochen.'}`;
        return result === true;
    } catch (error) {
        if (status) status.textContent = `Beginn nicht bestätigt. ${error.message}`;
        return false;
    }
}

/** TH-2: Tageskurse eines Wertpapiers nach Rückfrage vollständig neu laden; scheitert etwas, bleibt alles unverändert.
 * @param {{trancheId: string, name: string, ticker?: string}} tranche
 * @param {HTMLElement} [opener]
 */
export async function reloadManagerPrices(tranche, opener) {
    if (processingIsBlocked() || !tranche?.ticker) return false;
    const doc = document, origin = state.profileId;
    const valid = () => document === doc && state.boundDocument === doc && state.profileId === origin;
    const status = byId('priceUpdateStatus');
    state.persistenceError = '';
    let reason = '', savedDays = 0;
    const result = await runManagerOperation(async operation => {
        const confirmed = await requestManagerDecision({ title: 'Tageskurse neu laden',
            description: `Alle gespeicherten Tageskurse von „${tranche.name}“ werden beim Kursdienst neu abgerufen und erst nach vollständigem Abruf ersetzt. Tranchen und andere Wertpapiere bleiben unverändert.`,
            confirmLabel: 'Tageskurse neu laden', opener }, operation);
        if (!confirmed) return false;
        if (status) status.textContent = `Tageskurse von „${tranche.name}“ werden geladen …`;
        setReloadPricesProgress({ trancheId: tranche.trancheId, phase: 'running', text: '' });
        render();
        try { savedDays = (await reloadSymbolHistory(tranche.ticker, { operation, valid })).days; }
        catch (error) {
            setReloadPricesProgress(null);
            if (operation.controller.signal.aborted) throw error;
            reason = historyReloadReason(error) + (error?.rollbackConfirmed === false ? ' Der vorherige Stand konnte nicht sicher bestätigt werden.' : ' Die gespeicherten Kurse bleiben unverändert.');
            return false;
        }
        return true;
    });
    setReloadPricesProgress(null);
    if (!valid()) return false;
    const message = result === true ? reloadPricesDoneText(tranche.name, savedDays)
        : reason || state.persistenceError ? `Tageskurse von „${tranche.name}“ nicht neu geladen: ${reason || state.persistenceError}` : '';
    if (status) status.textContent = message;
    // TH-2c: Bestätigung bei der Tranche, nach wenigen Sekunden von selbst weg (ohne neues Rendern).
    if (result === true) {
        setReloadPricesProgress({ trancheId: tranche.trancheId, phase: 'done', text: message });
        setTimeout(() => { setReloadPricesProgress(null); document.querySelectorAll('[data-price-reload-notice]').forEach(node => node.remove()); }, 8000);
    }
    render();
    // Verschwindet der Splithinweis nach dem Neuladen, bleibt der Fokus in derselben Zeile.
    const replacement = Array.from(/** @type {NodeListOf<HTMLButtonElement>} */ (byId('tranchenTable')?.querySelectorAll?.('[data-action="reload-prices"], [data-action="edit-tranche"]')) || [])
        .find(button => button.dataset.trancheId === tranche.trancheId);
    replacement?.focus?.();
    if (result !== true && message) await showPageAlert({ title: 'Tageskurse nicht neu geladen', description: message }).catch(() => {});
    return result === true;
}
