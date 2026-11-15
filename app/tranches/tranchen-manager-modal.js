import { bindDialogBackdrop } from '../shared/dialog-backdrop.js';
import { readDecimalInput, readMoneyText, displayDecimalInput, canonicalDecimalInput, isMoneyInput } from './tranchen-manager-decimal-input.js';
import { purchaseStockState } from './tranche-detail-model.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';

import { getPageNavigationGuard, isNavigationGuardDialogOpen } from '../shared/navigation-guard-dialog.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

import { calculateTrancheDerivedValues, generateTrancheId } from './tranchen-manager-state.js';
import { renderTrancheDetail, renderTrancheDetailFigures, renderTqfChoices, renderQuoteCheck, hasQuote, exactShares } from './tranche-detail-view.js';
import {
    normalizeTranche,
    TRANCHE_CATEGORY_TYPES,
    TrancheValidationError
} from '../../types/tranche-contract.js';

const dialogStates = new WeakMap();
/** VK-3: Kaufpreis je Stück mit zwei Stellen anzeigen, gespeichert bleibt der ungerundete Wert, solange der Text unverändert ist. */
const exactPurchase = new WeakMap();
const correctionPrefills = new WeakMap();
/** VK-3d P5: Tranche der offenen Detailansicht je Dokument, für die Steuerschätzung vor dem Speichern. */
const detailTranches = new WeakMap();
const noteWrites = new WeakMap();
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
const trancheFields = ['name', 'isin', 'ticker', 'shares', 'purchasePrice', 'currentPrice', 'purchaseDate', 'category', 'type', 'tqf', 'taxExempt'];
const cashFields = ['cashPostingBalance', 'cashPostingReason'];
const modalSpecs = { tranche: [trancheFields, 'trancheModal', 'trancheForm'], cash: [cashFields, 'cashPostingModal', 'cashPostingForm'], people: [['managerPersonName'], 'managerPeopleModal', 'managerPeopleForm'] };


function formSignature(doc, fields) {
    return JSON.stringify(fields.map(id => {
        const field = byId(doc, id);
        const raw = field?.value ?? '';
        const canonical = id === 'shares' ? String(readTrancheSharesCorrection(doc)) : isMoneyInput(field) ? canonicalDecimalInput(raw, field) : 'NaN';
        // VN-3: Wert statt Schreibweise – die Formatierung nach dem Verlassen (DS-1 Punkt 4, „8000“ → „8.000,00“) ist keine Änderung.
        return [id, canonical === 'NaN' || canonical === '' ? raw : String(Number(canonical)), field?.checked === true];
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
        if (id === 'shares') field.addEventListener('input', () => correctionPrefills.delete(doc));
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
        + (kind === 'cash' ? ' Willst du noch etwas ändern, verwirf diesen Entwurf und öffne die Korrektur neu.' : '');
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
    // #tqf ist ein versteckter Wertträger, kein deutsches Anzeigefeld.
    if (el) el.value = id === 'tqf' ? canonicalDecimalInput(value) : ['shares', 'purchasePrice', 'currentPrice', 'cashPostingBalance'].includes(id) ? displayDecimalInput(value, el) : value ?? '';
}

export function resetTrancheForm(doc = document) {
    detailTranches.delete(doc);
    correctionPrefills.delete(doc);
    byId(doc, 'trancheForm')?.reset();
    exactPurchase.delete(doc);
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
    return Array.from(/** @type {NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>} */ (modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    ))).filter(element => !element.hidden && element.getAttribute?.('aria-hidden') !== 'true' && !element.closest?.('[hidden]'));
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
    const initialFocus = (detailTranches.has(doc) ? byId(doc, 'trancheQuoteRecheckBtn') : null) || byId(doc, 'name') || getFocusableElements(modal)[0];
    initialFocus?.focus?.();
}

export function syncTrancheTypeOptions(doc = document, preferredType = '') {
    const category = byId(doc, 'category')?.value || 'equity';
    syncTrancheTaxControls(doc);
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
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (doc.querySelectorAll?.('[data-tranche-category]')) || []) {
        button.setAttribute('aria-pressed', String(button.dataset.trancheCategory === category));
        button.disabled = byId(doc, 'category')?.disabled === true;
    }
    for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (doc.querySelectorAll?.('[data-tranche-type]')) || []) {
        const allowed = allowedTypes.includes(button.dataset.trancheType);
        button.hidden = !allowed;
        button.disabled = !allowed || typeSelect.disabled;
        button.setAttribute('aria-pressed', String(button.dataset.trancheType === nextType));
    }
    syncTranchePurchaseStock(doc);
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

/** @param {Document} [doc] @param {HTMLElement|null} [opener]
 * @param {{tranche?: any, category?: string, type?: string, amount?: number|null}|null} [prefill] FR-79 (VK-1 vorläufig): Geldmarktkauf aus dem
 * Verkaufserlös, Wertpapier und Stück vorbelegt. Ohne eigene Tranche (Gutachten VK-1 P2-05) nur Anlageform und Betrag. */
export function openCreateTrancheModal(doc = document, opener = null, prefill = null) {
    byId(doc, 'modalTitle').textContent = 'Kauf eintragen';
    setTrancheDialogMode(false, doc);
    resetTrancheForm(doc);
    setTrancheDetailLayout(doc, false);
    if (prefill && !prefill.tranche && prefill.category) {
        setFieldValue(doc, 'category', prefill.category);
        syncTrancheTypeOptions(doc, prefill.type || '');
        setFieldValue(doc, 'purchaseDate', localCalendarDate(appNow()));
        const description = byId(doc, 'trancheModalDescription');
        if (description && prefill.amount > 0) description.textContent = `Geldmarktkauf aus dem Verkaufserlös: ${formatDisplayNumber(prefill.amount, { unit: 'currency', fractionDigits: 2, minimumFractionDigits: 2 })}. Trag Wertpapier, Stück und Kaufkurs aus deiner Abrechnung ein. Das Tagesgeld wird nicht automatisch verringert.`;
    }
    if (prefill?.tranche) {
        const tranche = prefill.tranche, price = Number(tranche.currentPrice);
        setFieldValue(doc, 'name', tranche.name || '');
        setFieldValue(doc, 'isin', tranche.isin || '');
        setFieldValue(doc, 'ticker', tranche.ticker || '');
        setFieldValue(doc, 'category', tranche.category);
        setFieldValue(doc, 'tqf', tranche.tqf);
        if (byId(doc, 'taxExempt')) byId(doc, 'taxExempt').checked = tranche.taxExempt === true;
        if (price > 0) { setFieldValue(doc, 'currentPrice', price); setFieldValue(doc, 'purchasePrice', price); }
        if (price > 0 && prefill.amount > 0) setFieldValue(doc, 'shares', Math.floor(prefill.amount / price));
        setFieldValue(doc, 'purchaseDate', localCalendarDate(appNow()));
        syncTrancheTypeOptions(doc, tranche.type);
    }
    renderTrancheFormPreview(doc);
    activateDialog(doc, opener);
}

/** VK-3 (FR-79 Punkt 9): „Tranche im Detail“. `context` (Person, Verlauf, Löschbarkeit) liefert die Seite; ohne Kontext nur die Felder.
 * @param {any} tranche @param {Document} [doc] @param {HTMLElement|null} [opener]
 * @param {{personName: string, history: any[], deletion: {allowed: boolean, reason: string}}|null} [context] */
export function openEditTrancheModal(tranche, doc = document, opener = null, context = null) {
    if (!tranche) return false;
    correctionPrefills.delete(doc);
    detailTranches.set(doc, tranche);
    byId(doc, 'modalTitle').textContent = tranche.name || 'Tranche im Detail';
    setTrancheDialogMode(true, doc);
    clearTrancheFormError(doc);
    setTrancheDetailLayout(doc, true, tranche);
    setFieldValue(doc, 'name', tranche.name);
    setFieldValue(doc, 'isin', tranche.isin || '');
    setFieldValue(doc, 'ticker', tranche.ticker || '');
    setFieldValue(doc, 'shares', tranche.shares);
    const purchase = byId(doc, 'purchasePrice');
    if (purchase) {
        purchase.value = Number.isFinite(Number(tranche.purchasePrice)) ? formatDisplayNumber(Number(tranche.purchasePrice), { fractionDigits: 2, minimumFractionDigits: 2 }) : '';
        exactPurchase.set(doc, { text: purchase.value, value: Number(tranche.purchasePrice) });
    }
    setFieldValue(doc, 'currentPrice', tranche.currentPrice || '');
    setFieldValue(doc, 'purchaseDate', tranche.purchaseDate || '');
    setFieldValue(doc, 'category', tranche.category);
    setFieldValue(doc, 'tqf', tranche.tqf);
    if (byId(doc, 'taxExempt')) byId(doc, 'taxExempt').checked = tranche.taxExempt === true;
    syncTrancheTypeOptions(doc, tranche.type);
    bindFieldFormats(doc);
    setFieldValue(doc, 'notes', tranche.notes || '');
    if (context) renderTrancheDetail(doc, { tranche, ...context });
    const noteStatus = byId(doc, 'trancheNoteStatus'); if (noteStatus) noteStatus.textContent = '';
    renderTrancheFormPreview(doc);
    activateDialog(doc, opener);
    return true;
}

/** VK-3d P5: Steuerschätzung und Erklärung mit der gewählten Teilfreistellung und „Ganz steuerfrei“, noch vor dem Speichern.
 * @param {Document} doc */
function refreshDetailTax(doc) {
    const tranche = detailTranches.get(doc);
    if (!tranche || byId(doc, 'trancheModal')?.classList?.contains('active') === false) return;
    const tqf = readDecimalInput(byId(doc, 'tqf')?.value);
    renderTrancheDetailFigures(doc, { ...tranche, category: byId(doc, 'category')?.value || tranche.category, type: byId(doc, 'type')?.value || tranche.type, purchaseDate: byId(doc, 'purchaseDate')?.value || '', tqf: Number.isFinite(tqf) ? tqf : tranche.tqf, taxExempt: byId(doc, 'taxExempt')?.checked === true });
}
const boundFormats = new WeakSet();
/** DS-1 Punkt 4: Nach dem Verlassen zeigt ein Kursfeld zwei bis vier Nachkommastellen, ein Eurobetrag zwei.
 * Nur nach einer Eingabe des Nutzers, Ungültiges bleibt stehen. @param {Document} doc */
function bindFieldFormats(doc) {
    // Der Kaufpreis je Stück (Einstand mit Gebühren) behält alle Stellen; er bestimmt den Einstand.
    const formats = { currentPrice: [2, 4], cashPostingBalance: [0, 2] };
    for (const [id, [min, max]] of Object.entries(formats)) {
        const field = /** @type {HTMLInputElement|null} */ (byId(doc, id));
        if (!field || boundFormats.has(field)) continue;
        boundFormats.add(field);
        // Fokus und Verlassen statt `change`: die Formular- und Schutzlogik der Felder bleibt bei genau einem Listener je Ereignis.
        let atFocus = '';
        field.addEventListener('focus', () => { atFocus = field.value; });
        field.addEventListener('blur', () => {
            if (field.value === atFocus) return;
            const value = readDecimalInput(String(field.value || '').replace(/[\s\u00a0€]/g, ''), field);
            // Mehr Stellen als die Anzeige trägt bleiben unverändert stehen; die App rundet keine Eingabe.
            if (Number.isFinite(value) && Math.abs(Math.round(value * 10 ** max) / 10 ** max - value) < 1e-9) field.value = value.toLocaleString('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: isMoneyInput(field) && id !== 'currentPrice' });
        });
    }
}
/** @param {Document} doc */
function syncTrancheTaxControls(doc) {
    renderTqfChoices(doc, byId(doc, 'category')?.value || 'equity', byId(doc, 'tqf')?.value,
        () => { notifyManagerModalState(doc); refreshDetailTax(doc); });
}

/** Gespeicherten Kurs samt Abrufstand und Sichtbarkeit des Handkurses wiederherstellen. @param {Document} doc @param {any} tranche */
function restoreTrancheQuote(doc, tranche) {
    const quoted = hasQuote(tranche), group = byId(doc, 'trancheManualPriceGroup');
    if (group) group.hidden = quoted;
    renderQuoteCheck(doc, quoted ? { status: 'stored', symbol: tranche.ticker, price: tranche.currentPrice, asOf: tranche.asOf }
        : { status: String(tranche?.ticker || '').trim() ? 'failed' : 'none', symbol: tranche?.ticker || '', price: tranche?.currentPrice });
}

/** VK-3: Detailansicht (Kennzahlen, Verlauf, Löschen, Stück nur über „Stückzahl korrigieren“, Kurs von Hand nur ohne Kursabruf) oder – nur für
 * Altaufrufe ohne Oberflächeneinstieg – das leere Formular. @param {Document} doc @param {boolean} detail @param {any} [tranche] */
function setTrancheDetailLayout(doc, detail, tranche = null) {
    const show = (/** @type {string} */ id, /** @type {boolean} */ visible) => { const element = byId(doc, id); if (element) element.hidden = !visible; };
    for (const id of ['trancheDetailKpis', 'trancheSharesNote', 'deleteTrancheDialogBtn', 'trancheDetailActions']) show(id, detail);
    show('trancheSharesGroup', !detail);
    show('trancheTaxExplain', false);
    show('trancheStockWarning', false);
    show('trancheDetailsFields', !detail);
    byId(doc, 'trancheDetailsToggle')?.setAttribute('aria-expanded', String(!detail));
    show('trancheDeleteReason', false);
    const history = byId(doc, 'trancheHistoryList')?.closest?.('section'); if (history) history.hidden = !detail;
    const eyebrow = byId(doc, 'trancheDetailEyebrow'); if (eyebrow) eyebrow.textContent = detail ? 'Tranche' : 'Kauf';
    show('trancheManualPriceGroup', !detail || !hasQuote(tranche));
    if (detail) restoreTrancheQuote(doc, tranche);
}

/** Gerundete Vorbelegung bleibt bis zur ersten Eingabe der gespeicherte Wert. @param {Document} [doc] */
export function prefillTrancheSharesCorrection(doc = document) {
    const field = byId(doc, 'shares'), value = detailTranches.get(doc).shares;
    field.value = exactShares(value);
    correctionPrefills.set(doc, { text: field.value, value });
}

/** Vorschau, Speichern und Formularschutz lesen dieselbe Stückzahl. @param {Document} [doc] */
export function readTrancheSharesCorrection(doc = document) {
    const text = byId(doc, 'shares')?.value, prefill = correctionPrefills.get(doc);
    return prefill && text === prefill.text ? prefill.value : readMoneyText(text);
}

/** VK-3: „Stückzahl korrigieren“ öffnet den Editor innerhalb des Dialogs. @param {Document} [doc] */
export function revealTrancheSharesCorrection(doc = document) {
    const group = byId(doc, 'trancheSharesGroup'), note = byId(doc, 'trancheSharesNote');
    if (group) group.hidden = false;
    if (note) note.hidden = true;
    const actions = byId(doc, 'trancheDetailActions'); if (actions) actions.hidden = true;
    byId(doc, 'shares')?.focus?.();
}

/** VK-3: Ergebnis von „Kurs abrufen“ oder „Kürzel prüfen“ anzeigen; ohne Kurs erscheint „Kurs von Hand“. @param {Document} doc @param {any} result */
export function showTrancheQuoteCheck(doc, result) {
    renderQuoteCheck(doc, result);
    const group = byId(doc, 'trancheManualPriceGroup');
    if (group && result.status !== 'pending') group.hidden = result.status === 'ok';
}

function setTrancheDialogMode(editing, doc) {
    const submit = byId(doc, 'saveTrancheBtn');
    if (submit) submit.textContent = editing ? 'Angaben speichern' : 'Tranche speichern';
    const description = byId(doc, 'trancheModalDescription');
    if (description && !editing) description.textContent = 'Legt eine neue Tranche an. Pflichtfelder sind markiert. Das Tagesgeld wird nicht automatisch verringert.';
}

function renderTrancheFormPreview(doc) {
    const preview = byId(doc, 'trancheFormPreview');
    if (!preview) return;
    try {
        const price = byId(doc, 'currentPrice')?.value;
        const derived = calculateTrancheDerivedValues({
            shares: readTrancheSharesCorrection(doc),
            purchasePrice: readDecimalInput(byId(doc, 'purchasePrice')?.value, byId(doc, 'purchasePrice')),
            currentPrice: price === '' ? undefined : readDecimalInput(price, byId(doc, 'currentPrice'))
        });
        preview.textContent = `Einstand ${formatDisplayNumber(derived.costBasis, { unit: 'currency', fractionDigits: 0 })} · Marktwert ${formatDisplayNumber(derived.marketValue, { unit: 'currency', fractionDigits: 0 })}`;
    } catch {
        preview.textContent = 'Einstand und Marktwert erscheinen nach gültiger Eingabe.';
    }
}

/** @param {Document} [doc]
 * @param {{confirmed?: boolean, navigationOperation?: import('../../typcheck/runtime-contracts.js').NavigationOperation}} [options]
 */
export function closeTrancheModal(doc = document, { confirmed = false, navigationOperation } = {}) {
    const note = noteWrites.get(doc);
    if (note) return note.then(saved => saved === true && closeTrancheModal(doc, { confirmed, navigationOperation }));
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
        returnFocus = Array.from(/** @type {NodeListOf<HTMLButtonElement>} */ (doc.querySelectorAll?.('#tranchenTable button[data-action][data-tranche-id]')) || [])
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
            <h2 id="cashPostingModalTitle">Tagesgeld nach dem Verkauf</h2>
            <p id="cashPostingModalSummary" class="pv-cash-posting-summary"></p>
            <form id="cashPostingForm">
                <div class="form-group">
                    <label for="cashPostingBalance">Tagesgeld jetzt *</label>
                    <span class="ds-unit-frame"><input class="ds-input" id="cashPostingBalance" data-money-input type="text" inputmode="decimal" lang="de" required><span>€</span></span>
                </div>
                <div id="cashPostingReasonGroup" class="form-group" hidden>
                    <label for="cashPostingReason">Warum korrigierst du? *</label>
                    <textarea class="ds-input" id="cashPostingReason" rows="3"></textarea>
                </div>
                <div id="cashPostingFormError" class="reconciliation-status ds-note ds-note-error" data-kind="error" role="alert" aria-live="assertive" hidden></div>
                <div class="reconciliation-actions">
                    <button id="retryCashPostingSaveBtn" type="button" class="btn-secondary ds-button ds-button-secondary" hidden>Speichern erneut versuchen</button>
                    <button id="cashPostingCancelBtn" type="button" class="btn-secondary ds-button ds-button-secondary">Abbrechen – nichts ändern</button>
                    <button id="cashPostingSubmitBtn" type="submit" class="btn-danger ds-button ds-button-danger">Stand übernehmen und Gutschrift bestätigen</button>
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
    bindCashPostingModalLifecycle(doc); bindFieldFormats(doc);
    const mode = context.mode === 'correct' ? 'correct' : 'confirm';
    const state = {
        context: { ...context, mode },
        returnFocus: opener || doc.activeElement || null
    };
    cashDialogStates.set(doc, state);
    // DS-1 Punkt 8: Klartext ohne Kennungen, Datum deutsch, Ansprache „du“. Kennung und Revision bleiben als Datenattribute am Text
    // (Schutz gegen einen veralteten Dialog), stehen aber nicht mehr im sichtbaren Text.
    const title = byId(doc, 'cashPostingModalTitle');
    if (title) title.textContent = mode === 'correct' ? 'Tagesgeld nach dem Verkauf korrigieren' : 'Gutschrift aufs Tagesgeld bestätigen';
    const date = typeof context.executedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(context.executedAt)
        ? context.executedAt.slice(0, 10).split('-').reverse().join('.') : '';
    const known = value => value !== null && value !== undefined;
    const summary = byId(doc, 'cashPostingModalSummary');
    if (summary) {
        summary.textContent = [
            `Verkauf${date ? ` vom ${date}` : ''}${context.trancheName ? ` · ${context.trancheName}` : ''}: Nettoerlös ${formatCashDialogMoney(context.confirmedNetProceedsEur)}.`,
            `Zuletzt bestätigter Tagesgeld-Stand: ${known(context.historicalAuditBalanceEur) ? formatCashDialogMoney(context.historicalAuditBalanceEur) : 'noch keiner'}.`,
            `Dein Tagesgeld laut App heute: ${known(context.cashBalanceAfterPostingEur) ? formatCashDialogMoney(context.cashBalanceAfterPostingEur) : 'nicht lesbar'}.`,
            ...(context.currentCashError ? [`Dein Tagesgeld lässt sich gerade nicht lesen: ${context.currentCashError}`] : []),
            context.currentCashError ? cashSourceErrorMessage(context.currentCashError)
                : 'Trag den Stand ein, der jetzt auf deinem Konto steht. Die App übernimmt ihn so und rechnet den Nettoerlös nicht noch einmal dazu.'
        ].join('\n');
        if (summary.dataset) {
            summary.dataset.nextActionId = String(context.nextActionId ?? '');
            if (mode === 'correct') summary.dataset.nextRevision = String(context.nextRevision ?? ''); else delete summary.dataset.nextRevision;
        }
    }
    setFieldValue(doc, 'cashPostingBalance', context.cashBalanceAfterPostingEur ?? '');
    setFieldValue(doc, 'cashPostingReason', '');
    const reasonGroup = byId(doc, 'cashPostingReasonGroup');
    if (reasonGroup) reasonGroup.hidden = mode !== 'correct';
    const reason = byId(doc, 'cashPostingReason');
    if (reason) reason.required = mode === 'correct';
    const submit = byId(doc, 'cashPostingSubmitBtn');
    if (submit) submit.textContent = mode === 'correct'
        ? 'Stand übernehmen und Korrektur speichern'
        : 'Stand übernehmen und Gutschrift bestätigen';
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

/** @param {Document} [doc]
 * @param {{confirmed?: boolean, navigationOperation?: import('../../typcheck/runtime-contracts.js').NavigationOperation}} [options]
 */
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
        returnFocus = Array.from(/** @type {NodeListOf<HTMLElement>} */ (byId(doc, 'reconciliationCashStatuses')?.querySelectorAll?.('[data-target-action-id]')) || [])
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
            : readDecimalInput(rawBalance, byId(doc, 'cashPostingBalance')),
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
        target.textContent = message || 'Die Gutschrift konnte nicht verarbeitet werden.';
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
    bindDialogBackdrop(modal, () => closeCashPostingModal(doc));
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
        const focusTarget = /** @type {HTMLButtonElement | null} */ (choices.querySelector?.('button[aria-pressed="true"]'))
            || /** @type {HTMLButtonElement | null} */ (choices.querySelector?.('button:not([hidden]):not([disabled])'));
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
    byId(doc, 'taxExempt')?.addEventListener?.('change', () => { syncTrancheTaxControls(doc); refreshDetailTax(doc); });
    byId(doc, 'dismissTrancheModalBtn')?.addEventListener?.('click', () => closeTrancheModal(doc));
    for (const id of ['shares', 'purchasePrice', 'currentPrice']) {
        byId(doc, id)?.addEventListener?.('input', () => renderTrancheFormPreview(doc));
    }
    // VK-3: Ohne Kürzel gibt es keinen Kursabruf; dann erscheint „Kurs von Hand“.
    byId(doc, 'ticker')?.addEventListener?.('input', () => {
        const group = byId(doc, 'trancheManualPriceGroup');
        if (group && !String(byId(doc, 'ticker')?.value || '').trim()) group.hidden = false;
    });
    bindDialogBackdrop(modal, () => closeTrancheModal(doc));
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
    category?.addEventListener?.('change', () => { syncTrancheTypeOptions(doc); refreshDetailTax(doc); });
    byId(doc, 'purchaseDate')?.addEventListener?.('change', () => { syncTranchePurchaseStock(doc); refreshDetailTax(doc); });
    byId(doc, 'trancheStockAdoptBtn')?.addEventListener?.('click', () => {
        const date = byId(doc, 'purchaseDate')?.value;
        if (date) { byId(doc, 'type').value = date < '2009-01-01' ? 'aktien_alt' : 'aktien_neu'; syncTranchePurchaseStock(doc); notifyManagerModalState(doc); refreshDetailTax(doc); }
    });
    byId(doc, 'trancheStockCheckBtn')?.addEventListener?.('click', () => {
        byId(doc, 'trancheDetailsFields').hidden = false;
        byId(doc, 'trancheDetailsToggle').setAttribute('aria-expanded', 'true');
        byId(doc, 'trancheStockAdoptBtn')?.focus();
    });
    byId(doc, 'trancheDetailsToggle')?.addEventListener?.('click', () => {
        const fields = byId(doc, 'trancheDetailsFields'); fields.hidden = !fields.hidden;
        byId(doc, 'trancheDetailsToggle').setAttribute('aria-expanded', String(!fields.hidden));
    });
    boundDocuments.add(doc);
}

export function readTrancheFromForm(existingId = null, doc = document, options = {}) {
    const exact = exactPurchase.get(doc);
    const purchaseText = byId(doc, 'purchasePrice').value;
    const purchasePrice = exact && existingId && exact.text === purchaseText ? exact.value : readDecimalInput(purchaseText, byId(doc, 'purchasePrice'));
    const currentPriceInput = byId(doc, 'currentPrice').value.trim();
    // VK-3 (Nachtrag 2): Ein leerer Kurs wird nicht still zum Kaufpreis; beim Bearbeiten bleibt der gespeicherte Kurs. Nur ohne Kurs greift
    // der Rückfall des Tranchenvertrags (alte Daten, neue Tranche).
    const previousPrice = Number(options.existingTranche?.currentPrice);
    const tqfInput = byId(doc, 'tqf').value.trim();
    syncTranchePurchaseStock(doc);
    const derived = calculateTrancheDerivedValues({
        ...(options.existingTranche || detailTranches.get(doc) || {}),
        asOf: undefined,
        schemaVersion: 2,
        trancheId: existingId || createUniqueTrancheId(options.existingIds, options.idFactory),
        name: byId(doc, 'name').value,
        isin: byId(doc, 'isin').value,
        ticker: byId(doc, 'ticker').value,
        shares: options.detailsOnly && options.existingTranche ? options.existingTranche.shares : readTrancheSharesCorrection(doc),
        purchasePrice,
        currentPrice: currentPriceInput !== '' ? readDecimalInput(currentPriceInput, byId(doc, 'currentPrice'))
            : existingId && previousPrice > 0 ? previousPrice : purchasePrice,
        purchaseDate: byId(doc, 'purchaseDate').value,
        category: byId(doc, 'category').value,
        type: purchaseStockState({ category: byId(doc, 'category').value, type: byId(doc, 'type').value, purchaseDate: byId(doc, 'purchaseDate').value }, (options.existingTranche || detailTranches.get(doc))?.purchaseDate || '').type,
        tqf: tqfInput === '' ? '' : readDecimalInput(tqfInput),
        taxExempt: byId(doc, 'taxExempt')?.checked === true,
        notes: byId(doc, 'notes').value
    });
    const normalized = normalizeTranche(derived, { mode: 'persisted' });
    const previous = options.existingTranche;
    if (previous && previous.trancheId === existingId && (currentPriceInput !== '' || previousPrice > 0)) {
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
    bindDialogBackdrop(modal, () => closeManagerAuxiliaryDialog(kind, doc));
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
/** @param {string} kind
 * @param {Document} [doc]
 * @param {{confirmed?: boolean, navigationOperation?: import('../../typcheck/runtime-contracts.js').NavigationOperation}} [options]
 */
export function closeManagerAuxiliaryDialog(kind, doc = document, { confirmed = false, navigationOperation } = {}) {
    return requestClose(kind, doc, () => {
        const modal = byId(doc, modalSpecs[kind][1]);
        modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true');
        const entry = auxiliaryDialogs.get(doc)?.[kind];
        entry?.onDiscard(); entry?.opener?.focus?.();
    }, confirmed, navigationOperation);
}

/** FR-83: Nur ein geändertes Datum setzt den Bestand; vorhandene Widersprüche bleiben sichtbar.
 * @param {Document} [doc] */
export function syncTranchePurchaseStock(doc = document) {
    const category = byId(doc, 'category')?.value, field = byId(doc, 'type');
    if (!field) return;
    const stock = purchaseStockState({ category, type: field.value, purchaseDate: byId(doc, 'purchaseDate')?.value || '' }, detailTranches.get(doc)?.purchaseDate || '');
    field.value = stock.type;
    const show = (id, visible) => { const el = byId(doc, id); if (el) el.hidden = !visible; };
    show('trancheStockGroup', stock.equity);
    show('trancheTypeChoices', !stock.dated);
    show('trancheStockReadOnly', stock.dated);
    show('trancheStockAdoptBtn', stock.mismatch);
    const value = byId(doc, 'trancheStockReadOnly'), reason = byId(doc, 'trancheStockReason');
    if (value) value.textContent = field.value === 'aktien_alt' ? 'Altbestand' : 'Neubestand';
    if (reason) reason.textContent = stock.mismatch ? 'Der gespeicherte Bestand passt nicht zum Kaufdatum. Bis zur Übernahme bleibt er erhalten.'
        : stock.dated ? `Ergibt sich aus dem Kaufdatum: gekauft ${stock.expected === 'aktien_alt' ? 'vor 2009' : 'nach 2008'}.` : 'Ohne Kaufdatum wählst du den Bestand selbst.';
}

/** Nach bestätigter Korrektur nur die betroffenen Formularwerte bestätigen; andere Angaben bleiben Entwurf.
 * @param {any} tranche @param {Document} [doc] */
export function acceptTrancheCorrection(tranche, doc = document) {
    correctionPrefills.delete(doc);
    const exact = exactPurchase.get(doc), purchase = byId(doc, 'purchasePrice');
    const unchanged = exact && purchase?.value === exact.text;
    detailTranches.set(doc, tranche);
    setFieldValue(doc, 'shares', tranche.shares);
    if (unchanged) {
        purchase.value = formatDisplayNumber(tranche.purchasePrice, { fractionDigits: 2, minimumFractionDigits: 2 });
        exactPurchase.set(doc, { text: purchase.value, value: tranche.purchasePrice });
    }
    const entry = modalGuardState(doc).entries.tranche;
    if (entry.baseline) {
        const current = JSON.parse(formSignature(doc, trancheFields));
        entry.baseline = JSON.stringify(JSON.parse(entry.baseline).map(row => row[0] === 'shares' || unchanged && row[0] === 'purchasePrice' ? current.find(item => item[0] === row[0]) : row));
        entry.registration.notify();
    }
}

/** Angaben wiederherstellen, ohne eine offene Stückkorrektur oder die Notiz anzufassen. @param {Document} [doc] */
export function cancelTrancheDetails(doc = document) {
    const tranche = detailTranches.get(doc);
    if (!tranche) return closeTrancheModal(doc);
    for (const id of trancheFields.filter(id => id !== 'shares' && id !== 'taxExempt' && id !== 'purchasePrice')) setFieldValue(doc, id, tranche[id]);
    const purchase = byId(doc, 'purchasePrice');
    purchase.value = formatDisplayNumber(tranche.purchasePrice, { fractionDigits: 2, minimumFractionDigits: 2 });
    exactPurchase.set(doc, { text: purchase.value, value: tranche.purchasePrice });
    byId(doc, 'taxExempt').checked = tranche.taxExempt === true;
    syncTrancheTypeOptions(doc, tranche.type);
    restoreTrancheQuote(doc, tranche);
    renderTrancheFormPreview(doc);
    finishTrancheDetails(tranche, doc);
    refreshDetailTax(doc);
}

/** Bestätigt nur Angaben; die Baseline einer offenen Stückkorrektur bleibt erhalten.
 * @param {any} tranche @param {Document} [doc] */
export function finishTrancheDetails(tranche, doc = document) {
    detailTranches.set(doc, tranche);
    const fields = byId(doc, 'trancheDetailsFields'); if (fields) fields.hidden = true;
    byId(doc, 'trancheDetailsToggle')?.setAttribute('aria-expanded', 'false');
    const entry = modalGuardState(doc).entries.tranche;
    const current = JSON.parse(formSignature(doc, trancheFields));
    if (entry.baseline) entry.baseline = JSON.stringify(JSON.parse(entry.baseline).map(row => row[0] === 'shares' ? row : current.find(item => item[0] === row[0])));
    entry.registration.notify(); clearTrancheFormError(doc);
}

/** Schließen wartet die unabhängige Notizbestätigung ab. @param {Promise<boolean>} pending @param {Document} [doc] */
export function trackTrancheNoteWrite(pending, doc = document) {
    noteWrites.set(doc, pending);
    void pending.finally(() => { if (noteWrites.get(doc) === pending) noteWrites.delete(doc); });
}
