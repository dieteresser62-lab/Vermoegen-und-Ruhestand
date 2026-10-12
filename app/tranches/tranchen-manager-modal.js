import { readDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';
// @ts-check

import { getPageNavigationGuard, isNavigationGuardDialogOpen } from '../shared/navigation-guard-dialog.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

import { calculateTrancheDerivedValues, generateTrancheId } from './tranchen-manager-state.js';
import {
    normalizeTranche,
    TRANCHE_CATEGORY_TYPES,
    TrancheValidationError
} from '../../types/tranche-contract.js';

const dialogStates = new WeakMap();
const boundDocuments = new WeakSet();
const cashDialogStates = new WeakMap();
const cashBoundDocuments = new WeakSet();
const FIELD_LABELS = Object.freeze({
    trancheId: 'Tranche-ID',
    name: 'Name',
    shares: 'Stückzahl',
    purchasePrice: 'Kaufpreis',
    currentPrice: 'aktueller Kurs',
    purchaseDate: 'Kaufdatum',
    category: 'Kategorie',
    type: 'Typ',
    tqf: 'Teilfreistellung',
    taxExempt: 'Steuerfreiheit'
});

const modalGuards = new WeakMap();
const trancheFields = ['name', 'isin', 'ticker', 'shares', 'purchasePrice', 'currentPrice', 'purchaseDate', 'category', 'type', 'tqf', 'taxExempt', 'notes'];
const cashFields = ['cashPostingBalance', 'cashPostingReason'];
const saleFields = ['reconcileActionId', 'reconcileTrancheId', 'reconcileExecutedAt', 'reconcileSharesSold', 'reconcileGrossProceeds', 'reconcileFees', 'reconcileRecommendedShares', 'reconcileRecommendedGross', 'reconcileCashStatus', 'reconcileInitialCashBalance'];
const modalSpecs = { tranche: [trancheFields, 'trancheModal', 'trancheForm'], cash: [cashFields, 'cashPostingModal', 'cashPostingForm'], sale: [saleFields, 'saleModal', 'reconciliationForm'], people: [['managerPersonName'], 'managerPeopleModal', 'managerPeopleForm'] };


function formSignature(doc, fields) {
    return JSON.stringify(fields.map(id => {
        const field = byId(doc, id);
        return [id, field?.value ?? '', field?.checked === true];
    }));
}

function modalGuardState(doc) {
    if (modalGuards.has(doc)) return modalGuards.get(doc);
    const guard = getPageNavigationGuard(doc);
    const state = { guard, writeState: () => false, entries: {} };
    modalGuards.set(doc, state);
    for (const [kind, [fields, modalId]] of Object.entries(modalSpecs)) {
        const entry = { owner: `manager-dialog-${kind}`, baseline: null, last: null, revision: 0, opening: null, retained: false, boundElements: new WeakSet() };
        entry.registration = guard.register(entry.owner, { read: () => {
            const signature = formSignature(doc, fields);
            if (entry.last !== signature) { entry.last = signature; entry.revision++; }
            const open = byId(doc, modalId)?.classList.contains('active') === true;
            return { revision: entry.revision, dirty: open && entry.baseline !== null && (entry.retained || signature !== entry.baseline),
                phase: open && state.writeState() ? 'commit' : 'idle',
                message: open && state.writeState() ? 'Manager schreibt – bitte warten.' : 'Ungespeicherte Eingaben gehen verloren – trotzdem wechseln?' };
        } });
        state.entries[kind] = entry;
        bindModalGuardFields(kind, doc, entry);
    }
    return state;
}

// Der Guard kann vor dem dynamischen Cashformular entstehen. Fehlende Elemente
// bleiben bindbar; vorhandene Elemente erhalten ihre Listener genau einmal.
function bindModalGuardFields(kind, doc, entry = modalGuardState(doc).entries[kind]) {
    for (const id of modalSpecs[kind][0]) {
        const field = byId(doc, id);
        if (!field?.addEventListener || entry.boundElements.has(field)) continue;
        for (const event of ['input', 'change']) field.addEventListener(event, entry.registration.notify);
        entry.boundElements.add(field);
    }
    const form = byId(doc, modalSpecs[kind][2]);
    if (form?.addEventListener && !entry.boundElements.has(form)) {
        form.addEventListener('reset', () => queueMicrotask(entry.registration.notify));
        entry.boundElements.add(form);
    }
}

/** Pagehandler liefert echte Flags, keine Ableitung aus disabled oder Klassen. */
export function setManagerModalWriteStateReader(reader, doc = document) {
    modalGuardState(doc).writeState = reader;
    notifyManagerModalState(doc);
}
export function notifyManagerModalState(doc = document) {
    const state = modalGuards.get(doc);
    if (state) for (const entry of Object.values(state.entries)) entry.registration.notify();
}
export function confirmManagerModalBaseline(kind, doc = document) {
    const entry = modalGuardState(doc).entries[kind];
    entry.retained = false;
    entry.baseline = formSignature(doc, modalSpecs[kind][0]);
    entry.last = entry.baseline;
    entry.revision++;
    entry.registration.notify();
}

// Reine UI-Metadaten: weder IDs noch gespeicherte Auftragsdaten werden neu erzeugt.
export function captureManagerModalSubmission(kind, doc = document) {
    const entry = modalGuardState(doc).entries[kind];
    return { opening: entry.opening, signature: formSignature(doc, modalSpecs[kind][0]) };
}
export function isManagerModalSubmissionCurrent(kind, submission, doc = document) {
    if (!submission) return false;
    const entry = modalGuardState(doc).entries[kind];
    return Boolean(entry.opening === submission.opening
        && byId(doc, modalSpecs[kind][1])?.classList.contains('active'));
}
export function finishManagerModalSubmission(kind, submission, navigationOperation, doc = document) {
    if (!isManagerModalSubmissionCurrent(kind, submission, doc)) return false;
    if (captureManagerModalSubmission(kind, doc).signature === submission.signature) {
        if (kind === 'tranche') clearTrancheFormError(doc);
        else clearCashPostingFormError(doc);
        return kind === 'tranche' ? closeTrancheModal(doc, { confirmed: true, navigationOperation })
            : closeCashPostingModal(doc, { confirmed: true, navigationOperation });
    }
    const entry = modalGuardState(doc).entries[kind];
    entry.retained = true;
    entry.revision++;
    if (kind === 'cash') cashDialogStates.get(doc).completed = true;
    entry.registration.notify();
    const message = 'Der ursprüngliche Auftrag wurde gespeichert. Ihre späteren Eingaben bleiben unbestätigt erhalten.'
        + (kind === 'cash' ? ' Für weitere Cashänderungen verwerfen Sie diesen Entwurf und öffnen die Korrektur neu.' : '');
    const target = byId(doc, kind === 'tranche' ? 'trancheFormError' : 'cashPostingFormError');
    if (target) { target.textContent = message; target.hidden = false; }
    return false;
}
function requestClose(kind, doc, close, confirmed, navigationOperation) {
    const state = modalGuardState(doc), entry = state.entries[kind];
    const modalId = modalSpecs[kind][1];
    if (!byId(doc, modalId)?.classList.contains('active')) return false;
    if (isNavigationGuardDialogOpen(doc) || state.writeState()) return false;
    // Nur der eigene, bereits bestätigte Abschluss darf seinen Besitzer leihen.
    if (state.guard.reasons().some(reason => reason.phase === 'commit'
        && !(confirmed && navigationOperation?.owns?.(reason.owner)))) return false;
    const current = state.guard.reasons().find(reason => reason.owner === entry.owner);
    if (confirmed || !current?.dirty) {
        if (confirmed) confirmManagerModalBaseline(kind, doc);
        close(); entry.baseline = null; entry.registration.notify(); return true;
    }
    return state.guard.prepare({ owners: [entry.owner], opener: doc.activeElement, intent: 'discard' }).then(attempt => {
        if (!attempt) return false;
        const accepted = !state.writeState() && state.guard.validate(attempt);
        state.guard.end(attempt);
        if (accepted) { close(); entry.baseline = null; entry.registration.notify(); }
        return accepted;
    }).catch(() => false);
}

function byId(doc, id) {
    return doc.getElementById(id);
}

function setFieldValue(doc, id, value) {
    const el = byId(doc, id);
    if (el) el.value = ['shares', 'purchasePrice', 'currentPrice', 'tqf', 'cashPostingBalance'].includes(id) ? displayDecimalInput(value) : value ?? '';
}

export function resetTrancheForm(doc = document) {
    byId(doc, 'trancheForm')?.reset();
    setFieldValue(doc, 'tqf', '0');
    if (byId(doc, 'taxExempt')) byId(doc, 'taxExempt').checked = false;
    setFieldValue(doc, 'category', 'equity');
    syncTrancheTypeOptions(doc, 'aktien_neu');
    clearTrancheFormError(doc);
}

function getDialogState(doc) {
    if (!dialogStates.has(doc)) dialogStates.set(doc, { returnFocus: null });
    return dialogStates.get(doc);
}

function getFocusableElements(modal) {
    if (!modal?.querySelectorAll) return [];
    return Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden && element.getAttribute?.('aria-hidden') !== 'true');
}

function activateDialog(doc, opener = null) {
    const modal = byId(doc, 'trancheModal');
    if (!modal) return;
    bindTrancheModalLifecycle(doc);
    const state = getDialogState(doc);
    state.returnFocus = opener || doc.activeElement || null;
    const retry = byId(doc, 'retryTrancheDialogSaveBtn');
    if (retry) retry.hidden = true;
    modal.classList.add('active');
    modal.setAttribute?.('aria-hidden', 'false');
    modalGuardState(doc).entries.tranche.opening = {};
    confirmManagerModalBaseline('tranche', doc);
    const initialFocus = byId(doc, 'name') || getFocusableElements(modal)[0];
    initialFocus?.focus?.();
}

export function syncTrancheTypeOptions(doc = document, preferredType = '') {
    const category = byId(doc, 'category')?.value || 'equity';
    const typeSelect = byId(doc, 'type');
    const allowedTypes = TRANCHE_CATEGORY_TYPES[category] || [];
    if (!typeSelect) return allowedTypes;
    Array.from(typeSelect.options || []).forEach(option => {
        const allowed = allowedTypes.includes(option.value);
        option.disabled = !allowed;
        option.hidden = !allowed;
    });
    const nextType = allowedTypes.includes(preferredType)
        ? preferredType
        : allowedTypes.includes(typeSelect.value) ? typeSelect.value : allowedTypes[0] || '';
    typeSelect.value = nextType;
    for (const button of doc.querySelectorAll?.('[data-tranche-category]') || []) {
        button.setAttribute('aria-pressed', String(button.dataset.trancheCategory === category));
        button.disabled = byId(doc, 'category')?.disabled === true;
    }
    for (const button of doc.querySelectorAll?.('[data-tranche-type]') || []) {
        const allowed = allowedTypes.includes(button.dataset.trancheType);
        button.hidden = !allowed;
        button.disabled = !allowed || typeSelect.disabled;
        button.setAttribute('aria-pressed', String(button.dataset.trancheType === nextType));
    }
    return allowedTypes;
}

function bindTrancheChoices(doc) {
    for (const [host, field, attribute] of [
        ['trancheCategoryChoices', 'category', 'trancheCategory'],
        ['trancheTypeChoices', 'type', 'trancheType']
    ]) {
        byId(doc, host)?.addEventListener?.('click', event => {
            const selector = field === 'category' ? '[data-tranche-category]' : '[data-tranche-type]';
            const button = event.target.closest(selector), select = byId(doc, field);
            const state = modalGuardState(doc);
            if (!button || button.disabled || button.hidden || !select || select.disabled
                || state.writeState() || state.guard.isBusy() || isNavigationGuardDialogOpen(doc)) return;
            select.value = button.dataset[attribute];
            const EventConstructor = doc.defaultView?.Event || Event;
            select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
            syncTrancheTypeOptions(doc);
        });
    }
}

export function openCreateTrancheModal(doc = document, opener = null) {
    byId(doc, 'modalTitle').textContent = 'Kauf eintragen';
    setTrancheDialogMode(false, doc);
    resetTrancheForm(doc);
    renderTrancheFormPreview(doc);
    activateDialog(doc, opener);
}

export function openEditTrancheModal(tranche, doc = document, opener = null) {
    if (!tranche) return false;
    byId(doc, 'modalTitle').textContent = 'Tranche bearbeiten';
    setTrancheDialogMode(true, doc);
    clearTrancheFormError(doc);
    setFieldValue(doc, 'name', tranche.name);
    setFieldValue(doc, 'isin', tranche.isin || '');
    setFieldValue(doc, 'ticker', tranche.ticker || '');
    setFieldValue(doc, 'shares', tranche.shares);
    setFieldValue(doc, 'purchasePrice', tranche.purchasePrice);
    setFieldValue(doc, 'currentPrice', tranche.currentPrice || '');
    setFieldValue(doc, 'purchaseDate', tranche.purchaseDate || '');
    setFieldValue(doc, 'category', tranche.category);
    syncTrancheTypeOptions(doc, tranche.type);
    setFieldValue(doc, 'tqf', tranche.tqf);
    if (byId(doc, 'taxExempt')) byId(doc, 'taxExempt').checked = tranche.taxExempt === true;
    setFieldValue(doc, 'notes', tranche.notes || '');
    renderTrancheFormPreview(doc);
    activateDialog(doc, opener);
    return true;
}

function setTrancheDialogMode(editing, doc) {
    const submit = byId(doc, 'saveTrancheBtn');
    if (submit) submit.textContent = editing ? 'Änderungen speichern' : 'Tranche speichern';
    const description = byId(doc, 'trancheModalDescription');
    if (description) description.textContent = editing
        ? 'Ändert die ausgewählte Tranche; ihre Kennung bleibt erhalten. Das Tagesgeld wird nicht automatisch verändert.'
        : 'Legt eine neue Tranche an. Pflichtfelder sind markiert. Das Tagesgeld wird nicht automatisch verringert.';
}

function renderTrancheFormPreview(doc) {
    const preview = byId(doc, 'trancheFormPreview');
    if (!preview) return;
    try {
        const price = byId(doc, 'currentPrice')?.value;
        const derived = calculateTrancheDerivedValues({
            shares: readDecimalInput(byId(doc, 'shares')?.value),
            purchasePrice: readDecimalInput(byId(doc, 'purchasePrice')?.value),
            currentPrice: price === '' ? undefined : readDecimalInput(price)
        });
        preview.textContent = `Einstand ${formatDisplayNumber(derived.costBasis, { unit: 'currency', fractionDigits: 0 })} · Marktwert ${formatDisplayNumber(derived.marketValue, { unit: 'currency', fractionDigits: 0 })}`;
    } catch {
        preview.textContent = 'Einstand und Marktwert erscheinen nach gültiger Eingabe.';
    }
}

export function closeTrancheModal(doc = document, { confirmed = false, navigationOperation } = {}) {
    return requestClose('tranche', doc, () => closeTrancheDialog(doc), confirmed, navigationOperation);
}
function closeTrancheDialog(doc) {
    const modal = byId(doc, 'trancheModal');
    modal?.classList.remove('active');
    modal?.setAttribute?.('aria-hidden', 'true');
    clearTrancheFormError(doc);
    const state = getDialogState(doc);
    let returnFocus = state.returnFocus;
    state.returnFocus = null;
    if (returnFocus?.isConnected === false) {
        const original = returnFocus;
        returnFocus = Array.from(doc.querySelectorAll?.('#tranchenTable button[data-action][data-tranche-id]') || [])
            .find(button => button.dataset.trancheId === original.dataset?.trancheId
                && button.dataset.action === original.dataset?.action) || byId(doc, 'depotAddTrancheBtn');
    }
    returnFocus?.focus?.();
}

export function ensureCashPostingModal(doc = document) {
    let modal = byId(doc, 'cashPostingModal');
    if (modal || typeof doc.createElement !== 'function') return modal;
    modal = doc.createElement('div');
    modal.id = 'cashPostingModal';
    modal.className = 'modal';
    modal.setAttribute?.('role', 'dialog');
    modal.setAttribute?.('aria-modal', 'true');
    modal.setAttribute?.('aria-labelledby', 'cashPostingModalTitle');
    modal.setAttribute?.('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="modal-content ds-card" role="document">
            <h2 id="cashPostingModalTitle">Cashstatus bearbeiten</h2>
            <pre id="cashPostingModalSummary" style="white-space: pre-wrap;"></pre>
            <form id="cashPostingForm">
                <div class="form-group">
                    <label for="cashPostingBalance">Aktuellen Tagesgeld-Stand übernehmen (€) *</label>
                    <input class="ds-input" id="cashPostingBalance" type="text" inputmode="decimal" lang="de" required>
                </div>
                <div id="cashPostingReasonGroup" class="form-group" hidden>
                    <label for="cashPostingReason">Korrekturgrund *</label>
                    <textarea class="ds-input" id="cashPostingReason" rows="3"></textarea>
                </div>
                <div id="cashPostingFormError" class="reconciliation-status ds-note ds-note-error" data-kind="error" role="alert" aria-live="assertive" hidden></div>
                <div class="reconciliation-actions">
                    <button id="retryCashPostingSaveBtn" type="button" class="btn-secondary ds-button ds-button-secondary" hidden>Speichern erneut versuchen</button>
                    <button id="cashPostingCancelBtn" type="button" class="btn-secondary ds-button ds-button-secondary">Abbrechen – nichts ändern</button>
                    <button id="cashPostingSubmitBtn" type="submit" class="btn-danger ds-button ds-button-danger">Tagesgeld nachgetragen – bestätigen</button>
                </div>
            </form>
        </div>`;
    doc.body?.appendChild?.(modal);
    return modal;
}

function formatCashDialogMoney(value) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

export function openCashPostingModal(context, doc = document, opener = null) {
    const modal = ensureCashPostingModal(doc);
    if (!modal || !context) return false;
    bindCashPostingModalLifecycle(doc);
    const mode = context.mode === 'correct' ? 'correct' : 'confirm';
    const state = {
        context: { ...context, mode },
        returnFocus: opener || doc.activeElement || null
    };
    cashDialogStates.set(doc, state);
    const title = byId(doc, 'cashPostingModalTitle');
    if (title) title.textContent = mode === 'correct'
        ? 'Bestätigten Cashstand append-only korrigieren'
        : 'Tagesgeld nachgetragen – bestätigen';
    const previousBalance = context.historicalAuditBalanceEur === null
        || context.historicalAuditBalanceEur === undefined
        ? 'nicht dokumentiert'
        : formatCashDialogMoney(context.historicalAuditBalanceEur);
    const summary = byId(doc, 'cashPostingModalSummary');
    if (summary) {
        summary.textContent = [
            `Zielverkauf: ${context.targetActionId}`,
            `Nettoerlös (unveränderlich): ${formatCashDialogMoney(context.confirmedNetProceedsEur)}`,
            `Historischer Auditbetrag (letzter Nachweis): ${previousBalance}`,
            `Aktueller Tagesgeld-Stand: ${context.cashBalanceAfterPostingEur === null || context.cashBalanceAfterPostingEur === undefined
                ? 'nicht verfügbar' : formatCashDialogMoney(context.cashBalanceAfterPostingEur)}`,
            ...(context.currentCashError ? [`Aktuelle Cashquelle nicht lesbar: ${context.currentCashError}`] : []),
            `Nächster Auditnachweis: ${context.nextActionId}`,
            ...(mode === 'correct' ? [`Nächste Korrekturrevision: ${context.nextRevision}`] : []),
            context.currentCashError ? cashSourceErrorMessage(context.currentCashError)
                : 'Der bestätigte absolute Betrag wird als Tagesgeld-Stand übernommen. Nettoerlös wird nicht addiert.'
        ].join('\n');
    }
    setFieldValue(doc, 'cashPostingBalance', context.cashBalanceAfterPostingEur ?? '');
    setFieldValue(doc, 'cashPostingReason', '');
    const reasonGroup = byId(doc, 'cashPostingReasonGroup');
    if (reasonGroup) reasonGroup.hidden = mode !== 'correct';
    const reason = byId(doc, 'cashPostingReason');
    if (reason) reason.required = mode === 'correct';
    const submit = byId(doc, 'cashPostingSubmitBtn');
    if (submit) submit.textContent = mode === 'correct'
        ? 'Aktuellen Tagesgeld-Stand übernehmen und Korrektur bestätigen'
        : 'Aktuellen Tagesgeld-Stand übernehmen und Cashbuchung bestätigen';
    clearCashPostingFormError(doc);
    if (context.currentCashError) showCashPostingFormError(cashSourceErrorMessage(context.currentCashError), 'cashPostingBalance', doc);
    if (submit) submit.disabled = Boolean(context.currentCashError);
    const retry = byId(doc, 'retryCashPostingSaveBtn');
    if (retry) retry.hidden = true;
    modal.classList.add('active');
    modal.setAttribute?.('aria-hidden', 'false');
    modalGuardState(doc).entries.cash.opening = {};
    confirmManagerModalBaseline('cash', doc);
    byId(doc, 'cashPostingBalance')?.focus?.();
    return true;
}

export function closeCashPostingModal(doc = document, { confirmed = false, navigationOperation } = {}) {
    return requestClose('cash', doc, () => closeCashDialog(doc), confirmed, navigationOperation);
}
function closeCashDialog(doc) {
    const modal = byId(doc, 'cashPostingModal');
    modal?.classList.remove('active');
    modal?.setAttribute?.('aria-hidden', 'true');
    clearCashPostingFormError(doc);
    const state = cashDialogStates.get(doc);
    cashDialogStates.delete(doc);
    let returnFocus = state?.returnFocus;
    if (returnFocus?.isConnected === false) {
        returnFocus = Array.from(byId(doc, 'reconciliationCashStatuses')?.querySelectorAll?.('[data-target-action-id]') || [])
            .find(button => button.dataset.targetActionId === state.context?.targetActionId) || byId(doc, 'depotOpenSaleEntryBtn');
    }
    returnFocus?.focus?.();
}

export function readCashPostingForm(doc = document) {
    const state = cashDialogStates.get(doc);
    if (!state?.context || state.completed) return null;
    if (state.context.currentCashError) {
        showCashPostingFormError(cashSourceErrorMessage(state.context.currentCashError), 'cashPostingBalance', doc);
        return null;
    }
    const rawBalance = byId(doc, 'cashPostingBalance')?.value;
    return {
        ...state.context,
        cashBalanceAfterPostingEur: rawBalance === '' || rawBalance === null || rawBalance === undefined
            ? Number.NaN
            : readDecimalInput(rawBalance),
        correctionReason: byId(doc, 'cashPostingReason')?.value || ''
    };
}

export function isCashPostingEditorCompleted(doc = document) {
    return cashDialogStates.get(doc)?.completed === true;
}

function cashSourceErrorMessage(error) {
    return `Die Tagesgeldquelle ist beschädigt oder widersprüchlich: ${error} Keine Bestätigung möglich. Bitte die Quelle prüfen und den Dialog danach neu öffnen.`;
}

export function isCashPostingSourceInvalid(doc = document) {
    return Boolean(cashDialogStates.get(doc)?.context.currentCashError);
}

export function clearCashPostingFormError(doc = document) {
    const target = byId(doc, 'cashPostingFormError');
    if (target) {
        target.textContent = '';
        target.hidden = true;
    }
    byId(doc, 'cashPostingBalance')?.removeAttribute?.('aria-invalid');
    byId(doc, 'cashPostingReason')?.removeAttribute?.('aria-invalid');
}

export function showCashPostingFormError(message, field = null, doc = document) {
    clearCashPostingFormError(doc);
    const target = byId(doc, 'cashPostingFormError');
    if (target) {
        target.textContent = message || 'Cashstatus konnte nicht verarbeitet werden.';
        target.hidden = false;
    }
    const input = field ? byId(doc, field) : null;
    input?.setAttribute?.('aria-invalid', 'true');
    input?.focus?.();
}

export function bindCashPostingModalLifecycle(doc = document) {
    const modal = ensureCashPostingModal(doc);
    if (!modal) return;
    bindModalGuardFields('cash', doc);
    if (cashBoundDocuments.has(doc)) return;
    byId(doc, 'cashPostingCancelBtn')?.addEventListener?.('click', () => closeCashPostingModal(doc));
    modal.addEventListener?.('mousedown', event => { if (event.target === modal) event.preventDefault(); });
    modal.addEventListener?.('click', event => { if (event.target === modal) closeCashPostingModal(doc); });
    modal.addEventListener?.('keydown', event => {
        if (event.defaultPrevented || isNavigationGuardDialogOpen(doc) || !modal.classList.contains?.('active')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation?.();
            closeCashPostingModal(doc);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(modal);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && doc.activeElement === first) {
            event.preventDefault();
            last.focus?.();
        } else if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first.focus?.();
        }
    });
    cashBoundDocuments.add(doc);
}

export function createUniqueTrancheId(existingIds = [], idFactory = generateTrancheId) {
    const occupied = new Set(existingIds);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const trancheId = idFactory();
        if (typeof trancheId === 'string' && trancheId.trim() && !occupied.has(trancheId)) return trancheId;
    }
    throw new TrancheValidationError([{
        code: 'TRANCHE_ID_GENERATION_FAILED',
        field: 'trancheId',
        index: -1,
        trancheId: null,
        message: 'Es konnte keine eindeutige Tranche-ID erzeugt werden.'
    }]);
}

export function formatTrancheValidationError(error) {
    if (!(error instanceof TrancheValidationError) && error?.code !== 'TRANCHE_VALIDATION_FAILED') {
        return 'Die Tranche konnte nicht validiert werden.';
    }
    const first = Array.isArray(error.errors) ? error.errors[0] : null;
    if (!first) return error.message || 'Die Tranchendaten sind ungültig.';
    const tranche = first.trancheId ? `Tranche ${first.trancheId}, ` : '';
    const field = FIELD_LABELS[first.field] || first.field || 'Datensatz';
    return `${tranche}Feld ${field}: ${first.message} (${first.code})`;
}

export function clearTrancheFormError(doc = document) {
    const status = byId(doc, 'trancheFormError');
    if (status) {
        status.textContent = '';
        status.hidden = true;
    }
    Object.keys(FIELD_LABELS).forEach(field => byId(doc, field)?.removeAttribute?.('aria-invalid'));
    for (const id of ['trancheCategoryChoices', 'trancheTypeChoices']) byId(doc, id)?.removeAttribute?.('aria-invalid');
}

export function showTrancheFormError(error, doc = document) {
    clearTrancheFormError(doc);
    const status = byId(doc, 'trancheFormError');
    const message = `Speichern blockiert. ${formatTrancheValidationError(error)}`;
    if (status) {
        status.textContent = message;
        status.hidden = false;
    }
    const firstField = Array.isArray(error?.errors) ? error.errors[0]?.field : null;
    const field = firstField ? byId(doc, firstField) : null;
    field?.setAttribute?.('aria-invalid', 'true');
    const choices = field?.hidden && ['category', 'type'].includes(firstField)
        ? byId(doc, firstField === 'category' ? 'trancheCategoryChoices' : 'trancheTypeChoices') : null;
    if (choices) {
        choices.setAttribute?.('aria-invalid', 'true');
        const focusTarget = choices.querySelector?.('button[aria-pressed="true"]')
            || choices.querySelector?.('button:not([hidden]):not([disabled])');
        focusTarget?.focus?.();
    } else field?.focus?.();
    return message;
}

export function bindTrancheModalLifecycle(doc = document) {
    bindModalGuardFields('tranche', doc);
    if (boundDocuments.has(doc)) return;
    const modal = byId(doc, 'trancheModal');
    const category = byId(doc, 'category');
    bindTrancheChoices(doc);
    byId(doc, 'dismissTrancheModalBtn')?.addEventListener?.('click', () => closeTrancheModal(doc));
    for (const id of ['shares', 'purchasePrice', 'currentPrice']) {
        byId(doc, id)?.addEventListener?.('input', () => renderTrancheFormPreview(doc));
    }
    // Ein Mausversuch auf die verdeckte Navigation trifft den Hintergrund.
    // Bei geänderten Eingaben ist das keine ausdrückliche Verwerfaktion.
    modal?.addEventListener?.('mousedown', event => {
        if (event.target === modal) event.preventDefault();
    });
    modal?.addEventListener?.('click', event => {
        if (event.target !== modal) return;
        const state = modalGuardState(doc);
        if (state.guard.reasons().some(reason => reason.owner === state.entries.tranche.owner && reason.dirty)) return;
        closeTrancheModal(doc);
    });
    modal?.addEventListener?.('keydown', event => {
        if (event.defaultPrevented || isNavigationGuardDialogOpen(doc) || !modal.classList.contains?.('active')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation?.();
            closeTrancheModal(doc);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(modal);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && doc.activeElement === first) {
            event.preventDefault();
            last.focus?.();
        } else if (!event.shiftKey && doc.activeElement === last) {
            event.preventDefault();
            first.focus?.();
        }
    });
    category?.addEventListener?.('change', () => syncTrancheTypeOptions(doc));
    boundDocuments.add(doc);
}

export function readTrancheFromForm(existingId = null, doc = document, options = {}) {
    const purchasePrice = readDecimalInput(byId(doc, 'purchasePrice').value);
    const currentPriceInput = byId(doc, 'currentPrice').value.trim();
    const tqfInput = byId(doc, 'tqf').value.trim();
    const derived = calculateTrancheDerivedValues({
        schemaVersion: 2,
        trancheId: existingId || createUniqueTrancheId(options.existingIds, options.idFactory),
        name: byId(doc, 'name').value,
        isin: byId(doc, 'isin').value,
        ticker: byId(doc, 'ticker').value,
        shares: readDecimalInput(byId(doc, 'shares').value),
        purchasePrice,
        currentPrice: currentPriceInput === '' ? purchasePrice : readDecimalInput(currentPriceInput),
        purchaseDate: byId(doc, 'purchaseDate').value,
        category: byId(doc, 'category').value,
        type: byId(doc, 'type').value,
        tqf: tqfInput === '' ? '' : readDecimalInput(tqfInput),
        taxExempt: byId(doc, 'taxExempt')?.checked === true,
        notes: byId(doc, 'notes').value
    });
    const normalized = normalizeTranche(derived, { mode: 'persisted' });
    const previous = options.existingTranche;
    if (previous && previous.trancheId === existingId && currentPriceInput !== '') {
        const canonicalPrevious = normalizeTranche(previous, { mode: 'persisted' });
        const quoteFields = ['currentPrice', 'isin', 'ticker', 'category', 'type'];
        if (canonicalPrevious.asOf !== undefined
            && quoteFields.every(field => normalized[field] === canonicalPrevious[field])) {
            normalized.asOf = canonicalPrevious.asOf;
        }
    }
    return normalized;
}

// Zusätzliche Managerdialoge teilen Verwerfentscheidung, Schreibsperre und Fokusvertrag.
const auxiliaryDialogs = new WeakMap();
export function bindManagerAuxiliaryDialog(kind, doc, onDiscard = () => {}) {
    const modal = byId(doc, modalSpecs[kind][1]);
    if (!modal) return;
    let entries = auxiliaryDialogs.get(doc);
    if (!entries) { entries = {}; auxiliaryDialogs.set(doc, entries); }
    if (entries[kind]) return;
    entries[kind] = { opener: null, onDiscard };
    bindModalGuardFields(kind, doc);
    modal.addEventListener('click', event => { if (event.target === modal) closeManagerAuxiliaryDialog(kind, doc); });
    modal.addEventListener('keydown', event => {
        if (!modal.classList.contains('active') || isNavigationGuardDialogOpen(doc)) return;
        if (event.key === 'Escape') { event.preventDefault(); closeManagerAuxiliaryDialog(kind, doc); }
        if (event.key === 'Tab') {
            const focusable = getFocusableElements(modal).filter(element => !element.closest?.('[hidden]'));
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    });
}
export function openManagerAuxiliaryDialog(kind, doc, opener, focusId) {
    const modal = byId(doc, modalSpecs[kind][1]);
    const state = modalGuardState(doc);
    if (!modal || state.writeState() || state.guard.isBusy()) return false;
    auxiliaryDialogs.get(doc)[kind].opener = opener || doc.activeElement;
    state.entries[kind].opening = {};
    modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false');
    confirmManagerModalBaseline(kind, doc);
    byId(doc, focusId)?.focus();
    return true;
}
export function closeManagerAuxiliaryDialog(kind, doc = document, { confirmed = false, navigationOperation } = {}) {
    return requestClose(kind, doc, () => {
        const modal = byId(doc, modalSpecs[kind][1]);
        modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true');
        const entry = auxiliaryDialogs.get(doc)?.[kind];
        entry?.onDiscard(); entry?.opener?.focus?.();
    }, confirmed, navigationOperation);
}
