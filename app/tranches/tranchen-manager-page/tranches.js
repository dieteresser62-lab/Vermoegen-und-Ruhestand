// @ts-check
import { processingIsBlocked } from './controls.js';
import { state } from './state.js';
import { openEditTrancheModal, formatTrancheValidationError, showTrancheFormError, clearTrancheFormError, readTrancheFromForm, captureManagerModalSubmission, isManagerModalSubmissionCurrent,
    prefillTrancheSharesCorrection, readTrancheSharesCorrection, revealTrancheSharesCorrection, acceptTrancheCorrection, finishTrancheDetails, trackTrancheNoteWrite, showTrancheQuoteCheck, closeTrancheModal } from '../tranchen-manager-modal.js';
import { readReconciliationHistory, projectReconciliationCashStatuses, projectBuyCashStatuses } from '../tranche-reconciliation.js';
import { trancheHistory, trancheDeletion, planReference, cancelledBuyDebit, DELETION_UNREADABLE, correctedTranche, trancheDetailFigures } from '../tranche-detail-model.js';
import { readAnnualPlanRecord } from '../../profile/annual-plan-record.js';
import { memberPlanScope } from '../../profile/household-plan.js';
import { prepareTrancheDetailWrite, commitSaleFlowWrite, openHouseholdRegistry } from '../household-sale-writer.js';
import { readCashPerson } from '../../profile/profile-cash-update.js';
import { requestPageChoice } from '../../shared/page-choice-dialog.js';
import { requestPageInput } from '../../shared/page-dialog.js';
import { euro, euroCent, flowNumber, parseMoney } from '../sale-flow-steps.js';
import { searchSecurities, probeSearchQuote } from '../tranchen-price-service.js';
import { reloadAfterHouseholdWrite } from './profile-values.js';
import { runManagerOperation, requestManagerDecision } from './history.js';
import { normalizeTranches } from '../tranchen-manager-state.js';
import { byId, readStoredValue, flushManagerRecords, restoreManagerRecords, finishManagerDecimalSubmission } from './helpers.js';
import { renderPersistenceState, clearRawPreview } from './persistence-status.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY } from '../../profile/profile-state.js';
import { PROFILE_LIVE_BASE_KEY, saveCurrentProfileFromLocalStorage } from '../../profile/profile-storage.js';
import { PROFILE_WEALTH_LOTS_KEY } from '../../profile/profile-wealth-history.js';
import { recordTrancheCollection } from '../tranchen-recording.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { render } from './rendering.js';
import { renderTrancheDetail, exactShares } from '../tranche-detail-view.js';
import { displayDecimalInput } from '../tranchen-manager-decimal-input.js';
import { openManagerBuyFlow, openManagerSaleFlow } from './views.js';

/** VK-2 (FR-79 Punkt 8): „Kauf eintragen“ öffnet den geführten Kauf ohne Planbezug; `#trancheModal` dient nur noch dem Bearbeiten. */
export function addTranche(event) {
    if (processingIsBlocked()) return;
    state.editingIndex = -1;
    openManagerBuyFlow(event?.currentTarget || event?.target || null);
}

export function editTranche(index, opener = null) {
    if (processingIsBlocked()) return;
    state.editingIndex = index;
    const tranche = state.tranchen[index];
    if (!tranche) return;
    openEditTrancheModal(tranche, document, opener, trancheDetailContext(tranche));
}

/** VK-3: Person, Verlauf (Kauf- und Verkaufsbelege mit Gutschrift und Planbezug) und Löschbarkeit für „Tranche im Detail“. Nur gelesen;
 * ein unlesbarer Abgleich zeigt nur die Stammdaten und sperrt Löschen (VK-3b, P3-2). @param {any} tranche */
export function trancheDetailContext(tranche) {
    const profileId = state.profileId;
    let registry = null, records = [], readable = true;
    try { registry = JSON.parse(persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry) || 'null'); records = [...readReconciliationHistory(registry)]; } catch { records = []; readable = false; }
    let cashStatuses = [], buyStatuses = [];
    try { cashStatuses = [...projectReconciliationCashStatuses(registry, profileId)]; buyStatuses = [...projectBuyCashStatuses(registry, profileId)]; } catch { readable = false; }
    const ids = Object.keys(registry?.profiles || {});
    const years = [...new Set(records.filter(record => record.trancheId === tranche.trancheId).map(record => Number(String(record.executedAt || '').slice(0, 4))))];
    const references = [];
    try {
        const scope = memberPlanScope(ids.includes(profileId) ? ids : [profileId], persistenceStorage);
        for (const year of years.filter(Number.isInteger)) references.push(planReference(readAnnualPlanRecord({ year, scope, storage: persistenceStorage }), scope.ids));
    } catch { /* ohne Planbezug */ }
    const deletion = readable ? trancheDeletion(tranche, profileId, records) : DELETION_UNREADABLE;
    // VK-3b (Fable P3-6): Korrektur der Stückzahl aus dem Verlaufslos (vorhandener Eintrag `manualCorrectionAt`).
    let correctedAt = null;
    try { correctedAt = JSON.parse(openHouseholdRegistry(persistenceStorage).registry.profiles[profileId]?.data?.[PROFILE_WEALTH_LOTS_KEY] || 'null')?.lots?.[tranche.trancheId]?.manualCorrectionAt || null; } catch { correctedAt = null; }
    return { personName: registry?.profiles?.[profileId]?.meta?.name || 'Person',
        history: trancheHistory({ tranche, profileId, records, cashStatuses, buyStatuses, references, correctedAt }),
        deletion, debit: cancelledBuyDebit(records, buyStatuses, deletion.cancelBuy), profileId };
}

/** VK-3b (Gutachten VK3-FABLE P2-3, Nachtrag 1): War die Abbuchung des Kaufs schon bestätigt, wählt der Nutzer ausdrücklich zwischen
 * „Tagesgeld zurücksetzen“ (Vorschlag: heutiges Tagesgeld + Belastung, änderbar, geprüft wie im Gutschrift-Schritt) und „Tagesgeld
 * unverändert lassen“. Ergebnis: `{cashValue}` (null = unverändert) oder null bei Abbruch.
 * @param {{tranche: any, personName: string, debit: {amount: number}, signal?: AbortSignal, opener?: any}} options */
async function requestCancelBuyCash({ tranche, personName, debit, signal, opener }) {
    let current = null;
    try { const cash = readCashPerson(state.profileId, personName, openHouseholdRegistry(persistenceStorage).registry.profiles[state.profileId]?.data || {}); current = Number.isFinite(cash.value) ? cash.value : null; } catch { current = null; }
    // VN-4 Nachtrag 1 (N2): Tagesgeld-Vorschlag in ganzen Euro.
    const proposal = current === null ? null : Math.round(current + debit.amount);
    const choice = await requestPageChoice({ doc: document, opener, signal, danger: true, confirmLabel: 'Kauf rückgängig', cancelLabel: 'Abbrechen',
        title: 'Kauf rückgängig machen',
        description: `Tranche „${tranche.name || tranche.trancheId}“ löschen und den eingetragenen Kauf zurücknehmen? Die Abbuchung von ${euroCent(debit.amount)} ist schon bestätigt: Das Tagesgeld von ${personName} ist um diesen Betrag gekürzt. Ohne Rücksetzen zeigt die App das Vermögen danach um ${euroCent(debit.amount)} zu niedrig.`,
        rows: [{ id: 'cash', kind: 'radio', label: 'Tagesgeld', selected: 'reset', options: [
            { value: 'reset', label: proposal === null ? 'Tagesgeld zurücksetzen' : `Tagesgeld zurücksetzen (Vorschlag ${euro(proposal)})`, suggested: true },
            { value: 'keep', label: 'Tagesgeld unverändert lassen' }] }] });
    if (!choice) return null;
    if (choice.cash === 'keep') return { cashValue: null };
    const text = await requestPageInput({ doc: document, signal, title: 'Tagesgeld zurücksetzen', confirmLabel: 'Kauf rückgängig', danger: true,
        description: current === null ? `Tagesgeld von ${personName} jetzt eintragen.` : `Vorschlag: ${euro(current)} heute + Belastung ${euroCent(debit.amount)}.`,
        label: `Tagesgeld ${personName} jetzt (€)`, value: proposal === null ? '' : flowNumber(proposal),
        validate: (/** @type {string} */ raw) => { const value = parseMoney(raw); return Number.isFinite(value) && value >= 0 ? true : 'Bitte einen gültigen Tagesgeld-Stand eintragen.'; } });
    if (text === null) return null;
    return { cashValue: Math.round(parseMoney(text) * 100) / 100 };
}

export async function persistTranchen(nextTranches, options = {}) {
    const {
        successMessage = 'Änderung dauerhaft gespeichert.',
        onSuccess = null,
        allowRecovery = false
    } = options;

    if (state.commitInFlight || state.cashPostingInFlight || state.profileCommitInFlight) return false;
    if (!options.navigationOperation) return runManagerOperation(operation => persistTranchen(nextTranches, { ...options, navigationOperation: operation }));
    if (!allowRecovery && (state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable')) return false;

    let normalized;
    try {
        normalized = normalizeTranches(nextTranches);
    } catch (error) {
        const detail = formatTrancheValidationError(error);
        state.persistenceError = `Die Änderung verletzt den Tranchenvertrag und wurde nicht gespeichert. ${detail}`;
        if (byId('trancheModal')?.classList?.contains?.('active')) showTrancheFormError(error);
        renderPersistenceState();
        return false;
    }

    const previousLiveRaw = state.loadStatus === 'corrupt'
        ? state.corruptRaw
        : state.confirmedRaw;
    const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
    const previousLiveBase = readStoredValue(PROFILE_LIVE_BASE_KEY);
    const previousLotsRaw = readStoredValue(PROFILE_WEALTH_LOTS_KEY);
    const previousLoadStatus = state.loadStatus;
    const previousCorruptRaw = state.corruptRaw;

    let committed = false;
    state.commitInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    renderPersistenceState();

    try {
        options.navigationOperation.commit();
        const persisted = recordTrancheCollection(normalized, persistenceStorage, { previousTranches: state.confirmedTranches });
        if (!saveCurrentProfileFromLocalStorage()) {
            throw new Error('PROFILE_SAVE_FAILED');
        }
        await flushManagerRecords();

        state.tranchen = persisted;
        state.confirmedTranches = persisted;
        state.confirmedRaw = JSON.stringify(persisted);
        state.corruptRaw = null;
        state.loadStatus = persisted.length > 0 ? 'valid' : 'empty';
        state.pendingCommit = null;
        state.registryDisplayRaw = undefined;
        state.taxMigrationWarning = '';
        state.persistenceMessage = successMessage;
        clearRawPreview();
        committed = true;
        return true;
    } catch {
        const restored = await restoreManagerRecords([
            [PROFILE_TRANCHES_KEY, previousLiveRaw],
            [PROFILE_WEALTH_LOTS_KEY, previousLotsRaw],
            [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw],
            [PROFILE_LIVE_BASE_KEY, previousLiveBase]
        ]);
        state.tranchen = state.confirmedTranches;
        state.loadStatus = previousLoadStatus;
        state.corruptRaw = previousCorruptRaw;
        state.pendingCommit = { tranches: normalized, successMessage, onSuccess, allowRecovery, modalSubmission: options.modalSubmission };
        state.registryDisplayRaw = previousRegistryRaw;
        state.persistenceError = restored
            ? 'Speichern wurde nicht dauerhaft bestätigt. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.'
            : 'Speichern und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.';
        return false;
    } finally {
        state.commitInFlight = false;
        render();
        renderPersistenceState();
        if (committed && typeof onSuccess === 'function') onSuccess(options.navigationOperation);
    }
}

export async function deleteTranche(index) {
    if (processingIsBlocked()) return false;
    const tranche = state.tranchen[index];
    if (!tranche) return false;
    // VK-3 (Ergänzung 1, Nachtrag 2): gesperrt mit Verkaufsbeleg; mit eigenem Kaufbeleg „Kauf rückgängig“ (Storno im Abgleich).
    const { deletion, debit, personName } = trancheDetailContext(tranche);
    if (!deletion.allowed) {
        state.persistenceError = deletion.reason;
        renderPersistenceState();
        return false;
    }
    const opener = document.activeElement;
    const deleted = await runManagerOperation(async operation => {
        /** @type {number|null} */
        let cashValue = null;
        // VK-3b P2-3: Bei bestätigter Abbuchung Betrag, Folge und die Wahl zum Tagesgeld; bei offener Abbuchung entfällt sie mit dem Storno.
        const decide = deletion.cancelBuy && debit?.confirmed ? async () => {
            const answer = await requestCancelBuyCash({ tranche, personName, debit, signal: operation.controller.signal, opener });
            if (!answer) return false;
            cashValue = answer.cashValue;
            return true;
        } : undefined;
        // VK-3d P8: Beim Storno heißt auch die Bestätigung „Kauf rückgängig“.
        if (!await requestManagerDecision({ title: deletion.cancelBuy ? 'Kauf rückgängig machen' : 'Tranche löschen', confirmLabel: deletion.cancelBuy ? 'Kauf rückgängig' : 'Tranche löschen', danger: true,
            opener, description: deletion.cancelBuy
                ? `Tranche „${tranche.name || tranche.trancheId}“ löschen und den eingetragenen Kauf zurücknehmen? Der Stand der Käufe zeigt danach wieder „offen“. Die offene Abbuchung${debit ? ` von ${euroCent(debit.amount)}` : ''} entfällt; das Tagesgeld bleibt unverändert.`
                : `Tranche „${tranche.name || tranche.trancheId}“ wirklich dauerhaft löschen?` }, operation, decide)) return false;
        if (deletion.cancelBuy) return writeTrancheDetail({ remove: tranche.trancheId, cancelBuy: deletion.cancelBuy, cashValue }, operation);
        const nextTranches = state.tranchen.filter(item => item.trancheId !== tranche.trancheId);
        return persistTranchen(nextTranches, { navigationOperation: operation, successMessage: 'Tranche dauerhaft gelöscht.' });
    });
    if (deleted === true) byId('depotAddTrancheBtn')?.focus?.();
    if (deleted === true && deletion.cancelBuy) reloadAfterDetailWrite();
    return deleted;
}

/** VK-3b (Gutachten VK3 Befund 1): Neuladen erst nach dem Ende der Operation und nach dem Schließen des Dialogs; vorher hielte die
 * laufende Operation den Navigationsschutz und der Reload bräche ab. VK-3c: Das Tagesgeldfeld übernimmt vorher den gespeicherten Stand. */
function reloadAfterDetailWrite() {
    reloadAfterHouseholdWrite();
}

/** VK-3: Korrektur der Stückzahl und „Kauf rückgängig“ über den gemeinsamen Haushaltsschreiber; der Aufrufer lädt danach neu.
 * @param {{tranche?: any, correction?: boolean, correctionReason?: 'depotauszug'|'split', remove?: string, cancelBuy?: string, cashValue?: number|null}} request @param {any} operation */
async function writeTrancheDetail(request, operation) {
    try {
        const prepared = await prepareTrancheDetailWrite({ profileId: state.profileId, ...request });
        operation.check?.();
        await commitSaleFlowWrite(prepared, { navigationOperation: operation });
    } catch (error) {
        state.persistenceError = `Nicht gespeichert: ${error?.message || 'Speichern nicht möglich.'} Es wurde nichts geändert.`;
        renderPersistenceState();
        return false;
    }
    state.persistenceMessage = request.remove ? `Tranche gelöscht, Kauf zurückgenommen.${Number.isFinite(request.cashValue) ? ` Tagesgeld auf ${euro(/** @type {number} */ (request.cashValue))} gesetzt.` : ''}`
        : 'Stückzahl korrigiert; der Vermögensverlauf führt die Korrektur mit.';
    renderPersistenceState();
    return true;
}

/** TD-1: getrennte Aktionen für Stückkorrektur, Notiz, Kursprüfung und Verkauf. */
export function bindTrancheDetailControls() {
    const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
    let correctionReason = 'difference';
    const current = () => state.tranchen[state.editingIndex];
    const preview = () => {
        const split = correctionReason === 'split';
        byId('trancheCorrectionReason').textContent = split ? 'Beim Split bleibt der Einstand gleich, der Kaufpreis je Stück wird umgerechnet.'
            : 'Der Kaufpreis je Stück bleibt, der Einstand ändert sich mit der Stückzahl.';
        for (const button of document.querySelectorAll('[data-correction]')) button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.correction === correctionReason));
        try {
            if (readTrancheSharesCorrection(document) === current().shares) { byId('trancheCorrectionPreview').textContent = 'Danach: unverändert.'; return; }
            const figures = trancheDetailFigures(correctedTranche(current(), readTrancheSharesCorrection(document), correctionReason));
            byId('trancheCorrectionPreview').textContent = `Danach: ${exactShares(figures.shares)} Stück · Einstand ${split ? 'bleibt ' : ''}${euro(figures.costBasis)} (${euroCent(figures.purchasePrice)} je Stück) · Wert heute ${euro(figures.marketValue)}`;
        } catch (error) { byId('trancheCorrectionPreview').textContent = error.message; }
    };
    const correctShares = () => {
        if (processingIsBlocked()) return;
        if (byId('trancheSharesGroup')?.hidden === false) { byId('shares')?.focus(); return; }
        correctionReason = 'difference';
        prefillTrancheSharesCorrection(document);
        byId('trancheCorrectionIntro').textContent = `Trag ein, was auf deinem Depotauszug steht. Bisher stehen hier ${exactShares(current().shares)} Stück.`;
        clearTrancheFormError(); preview(); revealTrancheSharesCorrection(document);
    };
    byId('trancheDetailKpis')?.addEventListener('click', event => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.closest?.('[data-tranche-shares-edit]')) correctShares();
        const tax = target.closest?.('[data-tranche-tax-toggle]');
        if (tax) { const text = byId('trancheTaxExplain'); text.hidden = !text.hidden; tax.setAttribute('aria-expanded', String(!text.hidden)); }
    });
    byId('shares')?.addEventListener('input', preview);
    byId('trancheCorrectionReasons')?.addEventListener('click', event => {
        if (processingIsBlocked()) return;
        const button = /** @type {HTMLElement} */ (event.target).closest('[data-correction]');
        if (button) { correctionReason = /** @type {HTMLElement} */ (button).dataset.correction; preview(); }
    });
    const hideCorrection = () => { byId('trancheSharesGroup').hidden = true; byId('trancheDetailActions').hidden = false; byId('trancheSharesNote').hidden = false; };
    byId('trancheCorrectionCancelBtn')?.addEventListener('click', () => {
        if (processingIsBlocked()) return;
        input('shares').value = displayDecimalInput(current().shares, input('shares')); hideCorrection(); clearTrancheFormError();
    });
    const saveCorrection = async () => {
        if (processingIsBlocked()) return;
        if (readTrancheSharesCorrection(document) === current().shares) {
            input('shares').value = displayDecimalInput(current().shares, input('shares'));
            hideCorrection(); clearTrancheFormError(); return;
        }
        let tranche;
        try { tranche = normalizeTranches([correctedTranche(current(), readTrancheSharesCorrection(document), correctionReason)])[0]; }
        catch (error) { showTrancheFormError(error); return; }
        const saved = await runManagerOperation(operation => writeTrancheDetail({ tranche, correction: true, correctionReason: correctionReason === 'split' ? 'split' : 'depotauszug' }, operation));
        if (saved !== true) return;
        const stored = normalizeTranches(JSON.parse(persistenceStorage.getItem(PROFILE_TRANCHES_KEY)));
        state.tranchen = stored; state.confirmedTranches = stored; state.confirmedRaw = JSON.stringify(stored);
        tranche = stored.find(item => item.trancheId === tranche.trancheId);
        acceptTrancheCorrection(tranche, document);
        hideCorrection(); clearTrancheFormError();
        renderTrancheDetail(document, { tranche, ...trancheDetailContext(tranche) }); render();
    };
    byId('trancheCorrectionSaveBtn')?.addEventListener('click', () => void saveCorrection());
    byId('shares')?.addEventListener('keydown', event => {
        if (state.editingIndex >= 0 && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void saveCorrection(); }
    });
    let noteSaving = null, noteQueued = false;
    const saveNote = () => {
        const tranche = current(), notes = input('notes').value;
        if (!tranche) return;
        if (noteSaving) { noteQueued = true; return; }
        if (notes === (tranche.notes || '')) return;
        const status = byId('trancheNoteStatus');
        if (processingIsBlocked()) { status.textContent = 'Noch nicht gespeichert. Bitte nach dem laufenden Vorgang erneut verlassen.'; return; }
        const next = state.tranchen.map(item => item.trancheId === tranche.trancheId ? { ...item, notes } : item);
        status.textContent = 'Wird gespeichert …';
        noteSaving = persistTranchen(next, { successMessage: 'Notiz gespeichert.', onSuccess: null }).then(saved => {
            status.textContent = saved ? 'gespeichert' : 'Nicht gespeichert. Bitte erneut versuchen.';
            return saved;
        }).finally(() => { noteSaving = null; if (noteQueued) { noteQueued = false; saveNote(); } });
        trackTrancheNoteWrite(noteSaving, document);
    };
    byId('notes')?.addEventListener('blur', saveNote);
    byId('trancheDetailSaleBtn')?.addEventListener('click', async event => {
        const opener = /** @type {HTMLElement} */ (event.currentTarget);
        if (noteSaving && !await noteSaving) return;
        if (processingIsBlocked()) return;
        const trancheId = current()?.trancheId;
        if (await closeTrancheModal(document)) openManagerSaleFlow(trancheId, opener);
    });
    let quoteRequest = 0;
    byId('closeTrancheModalBtn')?.addEventListener('click', () => { if (!processingIsBlocked()) quoteRequest++; });
    const checkQuote = async () => {
        if (processingIsBlocked()) return;
        const request = ++quoteRequest, opening = captureManagerModalSubmission('tranche');
        const ticker = String(input('ticker')?.value || '').trim().toUpperCase();
        const isin = String(input('isin')?.value || '').trim().toUpperCase();
        const valid = () => request === quoteRequest && isManagerModalSubmissionCurrent('tranche', opening)
            && ticker === String(input('ticker')?.value || '').trim().toUpperCase() && isin === String(input('isin')?.value || '').trim().toUpperCase();
        showTrancheQuoteCheck(document, { status: 'pending' });
        let symbol = ticker;
        if (!symbol && isin) symbol = (/** @type {any} */ (await searchSecurities(isin).catch(() => null)))?.hits?.find((/** @type {any} */ hit) => hit.status === 'ok' || hit.status === 'stale')?.symbol || '';
        if (!valid()) return;
        if (!symbol) { showTrancheQuoteCheck(document, { status: 'none' }); return; }
        const result = /** @type {any} */ (await probeSearchQuote(symbol, null).catch(() => ({ status: 'failed' })));
        if (valid()) showTrancheQuoteCheck(document, { ...result, symbol });
    };
    byId('trancheQuoteRecheckBtn')?.addEventListener('click', () => void checkQuote());
    byId('trancheTickerCheckBtn')?.addEventListener('click', () => void checkQuote());
    byId('deleteTrancheDialogBtn')?.addEventListener('click', async () => {
        if (processingIsBlocked() || state.editingIndex < 0) return;
        const index = state.editingIndex;
        await closeTrancheModal(document);
        if (byId('trancheModal')?.classList?.contains?.('active')) return;
        await deleteTranche(index);
    });
}

export async function saveTranche(event) {
    event.preventDefault();
    if (processingIsBlocked()) return;
    clearTrancheFormError();

    const existingId = (state.editingIndex >= 0 && state.tranchen[state.editingIndex])
        ? state.tranchen[state.editingIndex].trancheId
        : null;
    let tranche;
    try {
        tranche = readTrancheFromForm(existingId, document, {
            existingIds: state.tranchen.map(item => item.trancheId),
            existingTranche: state.tranchen[state.editingIndex], detailsOnly: true
        });
    } catch (error) {
        showTrancheFormError(error);
        state.persistenceError = `Tranche nicht gespeichert. ${formatTrancheValidationError(error)}`;
        renderPersistenceState();
        return false;
    }
    const previousTranche = state.tranchen[state.editingIndex];
    if (previousTranche) tranche = normalizeTranches([{ ...tranche, shares: previousTranche.shares, notes: previousTranche.notes }])[0];
    const nextTranches = [...state.tranchen];

    if (state.editingIndex >= 0) {
        nextTranches[state.editingIndex] = tranche;
    } else {
        nextTranches.push(tranche);
    }

    const modalSubmission = captureManagerModalSubmission('tranche');
    return persistTranchen(nextTranches, {
        modalSubmission,
        successMessage: existingId ? 'Tranche dauerhaft aktualisiert.' : 'Tranche dauerhaft angelegt.',
        onSuccess: navigationOperation => {
            if (isManagerModalSubmissionCurrent('tranche', modalSubmission)) {
                state.editingIndex = state.tranchen.findIndex(item => item.trancheId === tranche.trancheId);
            }
            if (existingId && byId('trancheSharesGroup')?.hidden === false && isManagerModalSubmissionCurrent('tranche', modalSubmission)
                && captureManagerModalSubmission('tranche').signature === modalSubmission.signature) {
                finishTrancheDetails(tranche, document);
                renderTrancheDetail(document, { tranche, ...trancheDetailContext(tranche) });
            } else finishManagerDecimalSubmission('tranche', modalSubmission, navigationOperation);
        }
    });
}
