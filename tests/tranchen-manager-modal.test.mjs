"use strict";

import {
    setManagerModalWriteStateReader,
    notifyManagerModalState,
    confirmManagerModalBaseline,
    captureManagerModalSubmission,
    finishManagerModalSubmission,
    bindCashPostingModalLifecycle,
    bindTrancheModalLifecycle,
    closeCashPostingModal,
    closeTrancheModal,
    createUniqueTrancheId,
    openCreateTrancheModal,
    openCashPostingModal,
    openEditTrancheModal,
    readCashPostingForm,
    isCashPostingSourceInvalid,
    readTrancheFromForm,
    syncTrancheTypeOptions,
    showTrancheFormError,
    clearTrancheFormError
} from '../app/tranches/tranchen-manager-modal.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { TrancheValidationError } from '../types/tranche-contract.js';
import { createTranchenPageDom, MockElement } from './tranchen-manager-page.test.mjs';

console.log('--- Tranchen Manager Modal Tests ---');

function createElement(id, doc) {
    return {
        id,
        value: '',
        textContent: '',
        hidden: false,
        disabled: false,
        checked: false,
        options: [],
        listeners: {},
        attributes: new Map(),
        classList: {
            values: new Set(),
            add(v) { this.values.add(v); },
            remove(v) { this.values.delete(v); },
            has(v) { return this.values.has(v); },
            contains(v) { return this.values.has(v); }
        },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        removeEventListener(type) { delete this.listeners[type]; },
        showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        removeAttribute(name) { this.attributes.delete(name); },
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        focus() { doc.activeElement = this; },
        reset() {
            this.value = '';
        }
    };
}

function createDocumentMock() {
    const doc = { activeElement: null, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener(type) { delete this.listeners[type]; } };
    const elements = new Map();
    const ids = [
        'trancheModalDescription', 'trancheFormPreview', 'modalTitle', 'trancheModal', 'trancheForm', 'name', 'isin', 'ticker', 'shares',
        'purchasePrice', 'currentPrice', 'purchaseDate', 'category', 'type', 'tqf', 'taxExempt', 'notes',
        'trancheFormError', 'retryTrancheDialogSaveBtn', 'closeTrancheModalBtn', 'saveTrancheBtn', 'opener'
        , 'cashPostingModal', 'cashPostingModalTitle', 'cashPostingModalSummary', 'cashPostingForm',
        'cashPostingBalance', 'cashPostingReasonGroup', 'cashPostingReason', 'cashPostingFormError',
        'retryCashPostingSaveBtn', 'cashPostingCancelBtn', 'cashPostingSubmitBtn',
        'navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardStay', 'navigationGuardLeave', 'navigationGuardDescription', 'suiteNavigationStatus'
    ];
    ids.forEach(id => elements.set(id, createElement(id, doc)));
    elements.get('retryTrancheDialogSaveBtn').hidden = true;
    elements.get('retryCashPostingSaveBtn').hidden = true;
    elements.get('category').value = 'equity';
    elements.get('type').value = 'aktien_neu';
    elements.get('type').options = ['aktien_alt', 'aktien_neu', 'anleihe', 'geldmarkt', 'gold']
        .map(value => ({ value, disabled: false, hidden: false }));
    const focusOrder = [
        'retryTrancheDialogSaveBtn', 'name', 'isin', 'ticker', 'shares', 'purchasePrice', 'currentPrice', 'purchaseDate',
        'category', 'type', 'tqf', 'taxExempt', 'notes', 'closeTrancheModalBtn', 'saveTrancheBtn'
    ].map(id => elements.get(id));
    elements.get('trancheModal').querySelectorAll = () => focusOrder;
    elements.get('cashPostingModal').querySelectorAll = () => [
        elements.get('cashPostingBalance'), elements.get('cashPostingReason'),
        elements.get('retryCashPostingSaveBtn'),
        elements.get('cashPostingCancelBtn'), elements.get('cashPostingSubmitBtn')
    ];
    doc.getElementById = id => elements.get(id) || null;
    return doc;
}

console.log('Test 1: create modal resets form and opens');
{
    const doc = createDocumentMock();
    doc.getElementById('tqf').value = '0.1';
    doc.getElementById('taxExempt').checked = true;
    openCreateTrancheModal(doc);
    assertEqual(doc.getElementById('modalTitle').textContent, 'Kauf eintragen', 'Create modal should set title');
    assertEqual(doc.getElementById('tqf').value, '0', 'Create modal should reset TQF without asset-class inference');
    assertEqual(doc.getElementById('taxExempt').checked, false, 'Create modal should reset explicit tax exemption');
    assertEqual(doc.getElementById('saveTrancheBtn').textContent, 'Tranche speichern', 'Kaufmodus benennt seine Speicheraktion');
    assert(doc.getElementById('trancheModalDescription').textContent.includes('nicht automatisch verringert'), 'Kaufdialog beschreibt Tagesgeldvertrag');
    assert(doc.getElementById('trancheModal').classList.has('active'), 'Create modal should open modal');
    assertEqual(doc.activeElement.id, 'name', 'Create modal should focus the first form field');
    assert(doc.getElementById('type').options.find(option => option.value === 'gold').disabled, 'Create modal should hide incompatible types');
}
console.log('✓ create modal resets form and opens OK');

console.log('Test 2: edit modal fills fields');
{
    const doc = createDocumentMock();
    openEditTrancheModal({
        name: 'ETF',
        isin: 'DE000123',
        ticker: 'VWCE',
        shares: 5,
        purchasePrice: 100,
        currentPrice: 120,
        purchaseDate: '2024-01-01',
        category: 'equity',
        type: 'aktien_neu',
        tqf: 0.3,
        taxExempt: true,
        notes: 'Test'
    }, doc);
    assertEqual(doc.getElementById('name').value, 'ETF', 'Edit modal should fill name');
    assertEqual(doc.getElementById('saveTrancheBtn').textContent, 'Änderungen speichern', 'Bearbeitungsmodus benennt seine Speicheraktion');
    assert(doc.getElementById('trancheFormPreview').textContent.includes('500') && doc.getElementById('trancheFormPreview').textContent.includes('600'), 'Vorschau nutzt kanonischen Einstand und Marktwert');
    assertEqual(doc.getElementById('ticker').value, 'VWCE', 'Edit modal should fill ticker');
    assertEqual(doc.getElementById('taxExempt').checked, true, 'Edit modal should fill explicit tax exemption');
    assert(doc.getElementById('trancheModal').classList.has('active'), 'Edit modal should open modal');
}
console.log('✓ edit modal fills fields OK');

console.log('Test 3: readTrancheFromForm computes derived values');
{
    const doc = createDocumentMock();
    doc.getElementById('name').value = 'ETF';
    doc.getElementById('shares').value = '10';
    doc.getElementById('purchasePrice').value = '100';
    doc.getElementById('currentPrice').value = '120';
    doc.getElementById('purchaseDate').value = '2024-01-01';
    doc.getElementById('category').value = 'equity';
    doc.getElementById('type').value = 'aktien_neu';
    doc.getElementById('tqf').value = '0.3';
    doc.getElementById('taxExempt').checked = true;
    const tranche = readTrancheFromForm('id-1', doc);
    assertEqual(tranche.trancheId, 'id-1', 'Form reader should preserve existing id');
    assertEqual(tranche.marketValue, 1200, 'Form reader should compute market value');
    assertEqual(tranche.costBasis, 1000, 'Form reader should compute cost basis');
    assertEqual(tranche.taxExempt, true, 'Form reader should persist explicit tax exemption');
}
console.log('✓ readTrancheFromForm computes derived values OK');

console.log('Test 4: close modal removes active class');
{
    const doc = createDocumentMock();
    doc.getElementById('trancheModal').classList.add('active');
    closeTrancheModal(doc);
    assertEqual(doc.getElementById('trancheModal').classList.has('active'), false, 'Close modal should remove active class');
}
console.log('✓ close modal removes active class OK');

console.log('Test 5: form reader rejects category/type mismatch with field context');
{
    const doc = createDocumentMock();
    doc.getElementById('name').value = 'Mismatch';
    doc.getElementById('shares').value = '1';
    doc.getElementById('purchasePrice').value = '100';
    doc.getElementById('currentPrice').value = '100';
    doc.getElementById('category').value = 'equity';
    doc.getElementById('type').value = 'anleihe';
    doc.getElementById('tqf').value = '0';
    let error = null;
    try {
        readTrancheFromForm('mismatch-id', doc);
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof TrancheValidationError, 'Mismatch should throw contract validation error');
    assert(error.errors.some(item => item.code === 'TRANCHE_CLASSIFICATION_MISMATCH'), 'Mismatch should expose stable error code');
    assert(error.errors.some(item => item.trancheId === 'mismatch-id' && item.field === 'category'), 'Mismatch should expose tranche and field context');
}
console.log('✓ form mismatch validation OK');

console.log('Test 6: blank TQF is not converted to zero');
{
    const doc = createDocumentMock();
    doc.getElementById('name').value = 'ETF';
    doc.getElementById('shares').value = '1';
    doc.getElementById('purchasePrice').value = '100';
    doc.getElementById('category').value = 'equity';
    doc.getElementById('type').value = 'aktien_neu';
    doc.getElementById('tqf').value = '';
    let error = null;
    try {
        readTrancheFromForm('tqf-id', doc);
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof TrancheValidationError, 'Blank TQF should throw contract validation error');
    assert(error.errors.some(item => item.field === 'tqf'), 'Blank TQF should retain field context');
}
console.log('✓ blank TQF validation OK');

console.log('Test 7: category selection exposes only canonical types');
{
    const doc = createDocumentMock();
    doc.getElementById('category').value = 'gold';
    const allowed = syncTrancheTypeOptions(doc);
    assertEqual(allowed.join(','), 'gold', 'Gold category should expose only gold type');
    assertEqual(doc.getElementById('type').value, 'gold', 'Gold category should select gold type');
    assert(doc.getElementById('type').options.find(option => option.value === 'aktien_neu').disabled, 'Equity type should be disabled for gold');
}
console.log('✓ canonical type options OK');

console.log('Test 8: generated ids retry collisions before returning');
{
    const candidates = ['duplicate-id', 'unique-id'];
    const trancheId = createUniqueTrancheId(['duplicate-id'], () => candidates.shift());
    assertEqual(trancheId, 'unique-id', 'ID generator should retry an occupied id');
}
console.log('✓ collision-safe id generation OK');

console.log('Test 9: non-finite and overflowing financial values are rejected');
{
    const doc = createDocumentMock();
    doc.getElementById('name').value = 'Overflow';
    doc.getElementById('shares').value = '1e308';
    doc.getElementById('purchasePrice').value = '1e308';
    doc.getElementById('currentPrice').value = '1e308';
    doc.getElementById('category').value = 'equity';
    doc.getElementById('type').value = 'aktien_neu';
    doc.getElementById('tqf').value = '0.3';
    let error = null;
    try {
        readTrancheFromForm('overflow-id', doc);
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof TrancheValidationError, 'Overflowing derived values should be rejected');
    assert(error.errors.some(item => item.code === 'TRANCHE_NUMBER_NON_FINITE'), 'Overflow should retain a stable non-finite code');
}
console.log('✓ finite financial validation OK');

console.log('Test 10: Escape closes dialog and focus trap returns to opener');
{
    const doc = createDocumentMock();
    const opener = doc.getElementById('opener');
    opener.focus();
    bindTrancheModalLifecycle(doc);
    openCreateTrancheModal(doc, opener);
    const modal = doc.getElementById('trancheModal');
    let prevented = false;
    modal.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
    assert(prevented, 'Shift+Tab on first field should be trapped');
    assertEqual(doc.activeElement.id, 'saveTrancheBtn', 'Focus trap should wrap to last control');
    modal.listeners.keydown({ key: 'Escape', preventDefault() {} });
    assertEqual(modal.classList.has('active'), false, 'Escape should close dialog');
    assertEqual(doc.activeElement.id, 'opener', 'Closing should restore focus to opener');
}
console.log('✓ dialog keyboard lifecycle OK');

console.log('Test 11: cash dialog shows immutable evidence and reads explicit confirmation/correction input');
{
    const doc = createDocumentMock();
    const opener = doc.getElementById('opener');
    openCashPostingModal({
        mode: 'confirm',
        targetActionId: 'sale-1',
        confirmedNetProceedsEur: 95,
        cashBalanceAfterPostingEur: null,
        nextRevision: null,
        nextActionId: 'cash-confirmation:v1:sale-1'
    }, doc, opener);
    assert(doc.getElementById('cashPostingModal').classList.has('active'), 'Cash confirmation dialog should open');
    assert(doc.getElementById('cashPostingModalSummary').textContent.includes('sale-1')
        && doc.getElementById('cashPostingModalSummary').textContent.includes('95,00')
        && doc.getElementById('cashPostingModalSummary').textContent.includes('cash-confirmation:v1:sale-1'),
    'Cash dialog should show target, immutable net proceeds and next audit id');
    assertEqual(doc.getElementById('cashPostingReasonGroup').hidden, true,
        'Initial cash confirmation should not ask for a correction reason');
    doc.getElementById('cashPostingBalance').value = '10095.25';
    assertEqual(readCashPostingForm(doc).cashBalanceAfterPostingEur, 10095.25,
        'Cash dialog should read the explicitly entered balance');
    closeCashPostingModal(doc, { confirmed: true });
    assertEqual(doc.activeElement, opener, 'Closing cash dialog should restore opener focus');

    openCashPostingModal({
        mode: 'correct',
        targetActionId: 'sale-1',
        confirmedNetProceedsEur: 95,
        cashBalanceAfterPostingEur: 10095.25,
        nextRevision: 1,
        nextActionId: 'cash-correction:v1:sale-1:1'
    }, doc, opener);
    assertEqual(doc.getElementById('cashPostingReasonGroup').hidden, false,
        'Correction dialog should require a visible reason');
    assertEqual(doc.getElementById('cashPostingReason').required, true,
        'Correction reason should be browser-required');
    doc.getElementById('cashPostingBalance').value = '10090';
    doc.getElementById('cashPostingReason').value = 'Zahlendreher';
    const correction = readCashPostingForm(doc);
    assertEqual(correction.cashBalanceAfterPostingEur, 10090, 'Correction should read the new cash balance');
    assertEqual(correction.correctionReason, 'Zahlendreher', 'Correction should read the mandatory reason');
}
console.log('✓ cash dialog evidence contract OK');

console.log('Test: Guardinitialisierung vor dynamischer Casherzeugung und wiederholte Lifecyclebindung');
{
    const doc = createTranchenPageDom();
    const handlers = new Set();
    doc.defaultView = {
        addEventListener(type, handler) { if (type === 'beforeunload') handlers.add(handler); },
        removeEventListener(type, handler) { if (type === 'beforeunload') handlers.delete(handler); }
    };
    setManagerModalWriteStateReader(() => false, doc);
    const guard = getPageNavigationGuard(doc);
    assertEqual(doc.getElementById('cashPostingBalance'), null, 'Guard entsteht vor den dynamischen Cashfeldern');
    const snapshots = [];
    guard.subscribe(reasons => snapshots.push(reasons));
    const context = { mode: 'confirm', targetActionId: 'synthetic-sale', confirmedNetProceedsEur: 95,
        nextActionId: 'cash-confirmation:v1:synthetic-sale', cashBalanceAfterPostingEur: null };
    bindCashPostingModalLifecycle(doc);
    openCashPostingModal(context, doc);
    const balance = doc.getElementById('cashPostingBalance'), form = doc.getElementById('cashPostingForm');
    for (let repeat = 0; repeat < 3; repeat++) {
        bindCashPostingModalLifecycle(doc);
        bindTrancheModalLifecycle(doc);
    }
    assertEqual(handlers.has(guard.beforeUnload), false, 'Sauberer dynamischer Dialog benötigt keine native Nachfrage');
    for (const id of ['cashPostingBalance', 'cashPostingReason']) for (const event of ['input', 'change']) {
        assertEqual(doc.getElementById(id).listeners[event]?.length, 1, 'Pro dynamischem Feld bleibt genau ein Ereignislistener');
    }
    assertEqual(form.listeners.reset.length, 1, 'Formularreset bleibt genau einmal gebunden');
    assertEqual(doc.getElementById('category').listeners.change.length, 2, 'Kategorie behält genau Guard- und Typoptionenlistener');
    assertEqual(doc.getElementById('notes').listeners.input.length, 1, 'Auch Trancheneingaben werden nur einmal gebunden');
    balance.value = '5095';
    balance.listeners.input[0]({ type: 'input', target: balance });
    assert(snapshots.at(-1).some(reason => reason.owner === 'manager-dialog-cash' && reason.dirty),
        'Dynamisches input benachrichtigt den Subscriber ohne Guardrefresh');
    assertEqual(handlers.has(guard.beforeUnload), true, 'Dynamisches input installiert sofort den nativen Handler');
    const notificationsBeforeReset = snapshots.length;
    form.reset();
    await Promise.resolve();
    assertEqual(snapshots.length, notificationsBeforeReset + 1, 'Reset benachrichtigt genau einmal nach der Standardaktion');
    assertEqual(handlers.has(guard.beforeUnload), false, 'Reset auf die leere Baseline entfernt den nativen Handler');
    assertEqual(closeCashPostingModal(doc), true, 'Zurückgesetzter Dialog schließt ohne Nachfrage');
    openCashPostingModal(context, doc);
    assertEqual(balance.listeners.input.length, 1, 'Erneute Öffnung erzeugt keinen zweiten Feldlistener');
    assertEqual(form.listeners.reset.length, 1, 'Erneute Öffnung erzeugt keinen zweiten Resetlistener');
    assertEqual(readCashPostingForm(doc).nextActionId, context.nextActionId, 'Reine Lifecyclebindung verändert keine Cashaktions-ID');
    closeCashPostingModal(doc);
}

console.log('Test 12: Formular erhält ausschließlich unveränderte Kursprovenienz');
{
    const original = {
        schemaVersion: 2, trancheId: 'dated', name: 'ETF', isin: 'DE000TEST001', ticker: 'TEST.DE',
        shares: 2, purchasePrice: 100, currentPrice: 120, purchaseDate: '',
        category: 'equity', type: 'aktien_neu', tqf: 0.3, taxExempt: false, notes: '', asOf: 1700000000
    };
    const read = (changes, previous = original) => {
        const doc = createDocumentMock();
        openEditTrancheModal(previous, doc);
        for (const field of ['currentPrice', 'purchasePrice', 'shares', 'tqf']) {
            doc.getElementById(field).value = String(doc.getElementById(field).value);
        }
        for (const [field, value] of Object.entries(changes)) {
            if (field === 'taxExempt') doc.getElementById(field).checked = value;
            else doc.getElementById(field).value = value;
        }
        return readTrancheFromForm(previous.trancheId, doc, { existingTranche: previous });
    };
    for (const changes of [{ notes: 'Notiz' }, { shares: '3' }, { tqf: '0.2' }, { taxExempt: true },
        { purchasePrice: '90' }, { ticker: ' test.de ' }]) {
        assertEqual(read(changes).asOf, original.asOf, 'Unveränderter Kurs behält seine Zeit');
    }
    for (const changes of [{ currentPrice: '130' }, { isin: 'DE000TEST002' }, { ticker: 'OTHER.DE' },
        { category: 'bonds', type: 'anleihe', tqf: '0' }, { type: 'aktien_alt' }, { currentPrice: '' }]) {
        assert(!('asOf' in read(changes)), 'Manuelle Kurs-/Instrumentänderung oder Kaufpreis-Fallback entfernt Zeit');
    }
    const changed = read({ currentPrice: '130' });
    assert(!('asOf' in read({ currentPrice: '120' }, changed)), 'Wiedereintragen des früheren Preises erfindet keine Zeit');
    const fallback = read({ currentPrice: '' });
    assertEqual(fallback.currentPrice, 100, 'Leeres Kursfeld nutzt weiter den Kaufpreis');
    const doc = createDocumentMock();
    openEditTrancheModal(original, doc);
    doc.getElementById('currentPrice').value = '120';
    doc.getElementById('tqf').value = '0.3';
    assert(!('asOf' in readTrancheFromForm(null, doc, { idFactory: () => 'new' })), 'Neuanlage ist undatiert');
}

for (const kind of ['tranche', 'cash']) {
    const doc = createDocumentMock(), guard = getPageNavigationGuard(doc);
    const open = () => kind === 'tranche' ? openCreateTrancheModal(doc) : openCashPostingModal({ mode: 'confirm', targetActionId: 'synthetic', confirmedNetProceedsEur: 1 }, doc);
    const close = () => kind === 'tranche' ? closeTrancheModal(doc) : closeCashPostingModal(doc);
    const field = doc.getElementById(kind === 'tranche' ? 'notes' : 'cashPostingBalance');
    const modal = doc.getElementById(kind === 'tranche' ? 'trancheModal' : 'cashPostingModal');
    open(); const baseline = field.value;
    assertEqual(guard.reasons().length, 0, 'Vollständig befülltes Formular startet sauber');
    field.value = '42'; field.listeners.input();
    assertEqual(guard.reasons().some(s => s.dirty), true, 'Tatsächliche Formularänderung ist verlustrelevant');
    const pending = close();
    assertEqual(modal.classList.contains('active'), true, 'Dirty-Benutzerschließen wartet auf Entscheidung');
    assertEqual(doc.getElementById('navigationGuardTitle').textContent, 'Änderungen verwerfen?', 'Dirty-Schließen benennt Verwerfen im zugänglichen Titel');
    assertEqual(doc.getElementById('navigationGuardLeave').textContent, 'Verwerfen', 'Dirty-Schließen bestätigt das Verwerfen statt einen Seitenwechsel');
    assertEqual(doc.getElementById('navigationGuardDescription').textContent, 'Ungespeicherte Eingaben gehen verloren – trotzdem verwerfen?', 'Dirty-Schließen beschreibt den Eingabeverlust ohne Seitenwechsel');
    doc.listeners.keydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assertEqual(await pending, false, 'Escape verwirft Dirty-Schließen');
    assertEqual(modal.classList.contains('active'), true, 'Escape schließt keinen darunterliegenden Fachdialog');
    assertEqual(field.value, '42', 'Bleiben erhält ungespeicherte Werte');
    for (const trigger of ['Escape', 'Overlay']) {
        if (trigger === 'Escape') modal.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
        else {
            if (kind === 'tranche') {
                let prevented = false;
                modal.listeners.mousedown({ target: modal, preventDefault() { prevented = true; } });
                assertEqual(prevented, true, 'Hintergrund-Mausversuch verdrängt den Tranchendialogfokus nicht');
            }
            modal.listeners.click({ target: modal });
            if (kind === 'tranche') {
                assertEqual(doc.getElementById('navigationGuardDialog').open, false, 'Dirty-Tranchenhintergrund öffnet keine Schutzfrage');
                assertEqual(modal.classList.contains('active'), true, 'Dirty-Hintergrundversuch erhält den Tranchendialog');
                assertEqual(field.value, '42', 'Dirty-Hintergrundversuch erhält Formularwerte');
                assertEqual(guard.isBusy(), false, 'Dirty-Hintergrundversuch reserviert keine App-Navigation');
                continue;
            }
        }
        assertEqual(doc.getElementById('navigationGuardDialog').open, true, `${kind}: ${trigger} öffnet die Dirty-Nachfrage`);
        assertEqual(doc.getElementById('navigationGuardTitle').textContent, 'Änderungen verwerfen?', `${kind}: ${trigger} benennt Verwerfen`);
        assertEqual(doc.getElementById('navigationGuardLeave').textContent, 'Verwerfen', `${kind}: ${trigger} bestätigt Verwerfen`);
        doc.getElementById('navigationGuardStay').listeners.click();
        for (let index = 0; index < 8; index++) await Promise.resolve();
        assertEqual(guard.isBusy(), false, 'Bleiben gibt den Schließversuch wieder frei');
        assertEqual(modal.classList.contains('active'), true, 'Bleiben erhält den Fachdialog nach Escape oder Overlay');
        assertEqual(field.value, '42', 'Bleiben erhält die Eingaben nach Escape oder Overlay');
    }
    field.value = baseline; field.listeners.input();
    assertEqual(guard.reasons().some(s => s.dirty), false, 'Rückänderung zum Ausgangswert ist wieder sauber');
    if (kind === 'tranche') {
        modal.listeners.click({ target: modal });
        assertEqual(modal.classList.contains('active'), false, 'Sauberer Tranchendialog schließt weiterhin über den Hintergrund');
        open();
    }
    field.value = '43'; field.listeners.change();
    confirmManagerModalBaseline(kind, doc);
    assertEqual(guard.reasons().some(s => s.dirty), false, 'Bestätigter Speicherstand ersetzt Baseline');
    field.value = '44'; field.listeners.input();
    const discard = close(); doc.getElementById('navigationGuardLeave').listeners.click();
    assertEqual(await discard, true, 'Explizites Verwerfen schließt Dirty-Fachdialog');
    assertEqual(modal.classList.contains('active'), false, 'Verworfenes Formular erzeugt keinen weiteren Verlustgrund');
    open(); let writing = true; setManagerModalWriteStateReader(() => writing, doc);
    assertEqual(close(), false, 'Schließknopf ist während tatsächlichem Write gesperrt');
    modal.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    modal.listeners.click({ target: modal });
    assertEqual(modal.classList.contains('active'), true, 'Escape und Overlay bleiben bei Write gesperrt');
    writing = false; notifyManagerModalState(doc);
    assertEqual(close(), true, 'Nach Ende des Writes ist sauberes Benutzerschließen möglich');
}
{
    const doc = createDocumentMock(); openCreateTrancheModal(doc);
    const guard = getPageNavigationGuard(doc), checkbox = doc.getElementById('taxExempt');
    checkbox.checked = true; checkbox.listeners.change();
    assertEqual(guard.reasons().some(s => s.dirty), true, 'Checkbox gehört zur echten Baseline');
    checkbox.checked = false; checkbox.listeners.change();
    assertEqual(guard.reasons().length, 0, 'Checkbox-Rückänderung wird sauber');
    const select = doc.getElementById('type'); select.value = 'aktien_alt'; select.listeners.change();
    assertEqual(guard.reasons().some(s => s.dirty), true, 'Select gehört zur echten Baseline');
    let writing = false; setManagerModalWriteStateReader(() => writing, doc);
    const closing = closeTrancheModal(doc);
    writing = true; notifyManagerModalState(doc);
    doc.getElementById('navigationGuardLeave').listeners.click();
    assertEqual(await closing, false, 'Während Nachfrage gestarteter Commit überstimmt Verwerfzustimmung');
    assertEqual(doc.getElementById('trancheModal').classList.contains('active'), true, 'Commit erhält Fachdialog und Eingaben');
}

{
    const doc = createDocumentMock(); openCreateTrancheModal(doc);
    doc.getElementById('notes').value = 'Nicht quittierter Editor';
    const guard = getPageNavigationGuard(doc);
    const foreign = guard.register('foreign-manager-write', { read: () => ({ phase: 'commit' }) });
    assertEqual(closeTrancheModal(doc, { confirmed: true }), false, 'Erfolgsschließen quittiert keinen fremden Commit');
    assert(guard.reasons().some(reason => reason.owner === 'manager-dialog-tranche' && reason.dirty), 'Abgewiesener Erfolgsschluss setzt keine Baseline');
    assert(guard.reasons().some(reason => reason.owner === 'foreign-manager-write' && reason.phase === 'commit'), 'Fremder Besitzer bleibt vollständig registriert');
    foreign.unregister();
    assertEqual(closeTrancheModal(doc, { confirmed: true }), true, 'Bestätigtes Ende erlaubt einmaligen Schluss');
    assertEqual(closeTrancheModal(doc, { confirmed: true }), false, 'Doppelter Erfolgsschluss wird nicht wieder ausgeführt');
}

for (const fieldId of ['type', 'taxExempt']) {
    const doc = createDocumentMock();
    openCreateTrancheModal(doc);
    const submitted = captureManagerModalSubmission('tranche', doc);
    if (fieldId === 'type') doc.getElementById(fieldId).value = 'aktien_alt';
    else doc.getElementById(fieldId).checked = true;
    assertEqual(finishManagerModalSubmission('tranche', submitted, null, doc), false,
        `${fieldId}: spätere Select-/Checkboxeingabe verhindert alten Erfolgsschluss`);
    assert(doc.getElementById('trancheModal').classList.contains('active'), 'Geänderter Editor bleibt offen');
    assert(getPageNavigationGuard(doc).reasons().some(reason => reason.dirty), 'Geänderter Editor bleibt geschützt');
}
for (const kind of ['tranche', 'cash']) {
    const doc = createDocumentMock();
    const open = () => kind === 'tranche' ? openCreateTrancheModal(doc)
        : openCashPostingModal({ mode: 'confirm', targetActionId: 'same-target', confirmedNetProceedsEur: 1 }, doc);
    open(); const submitted = captureManagerModalSubmission(kind, doc);
    open();
    assertEqual(captureManagerModalSubmission(kind, doc).signature, submitted.signature,
        'Gegenprobe öffnet identische Eingaben in einer neuen Dialoginstanz');
    assertEqual(finishManagerModalSubmission(kind, submitted, null, doc), false,
        'Auch identische neue Dialoginstanz wird durch älteren Erfolg nicht geschlossen');
    assert(doc.getElementById(kind === 'tranche' ? 'trancheModal' : 'cashPostingModal').classList.contains('active'),
        'Neue Dialoginstanz bleibt offen');
}

{
    const doc = createTranchenPageDom();
    const preview = doc.register(doc.createElement('p')); preview.id = 'trancheFormPreview'; doc.register(preview);
    openCreateTrancheModal(doc);
    const guard = getPageNavigationGuard(doc);
    const signature = captureManagerModalSubmission('tranche', doc).signature;
    assertEqual(guard.reasons().length, 0, 'Öffnen und reine Vorschau ändern keine Formularbaseline');
    for (const [id, value] of [['shares', '2'], ['purchasePrice', '100'], ['currentPrice', '']]) {
        const input = doc.getElementById(id); input.value = value;
        for (const handler of input.listeners.input) handler({ target: input });
    }
    assert(preview.textContent.includes('Einstand 200') && preview.textContent.includes('Marktwert 200'), 'Leerer Kurs benutzt den bestehenden Kaufpreisfallback in der Vorschau');
    const price = doc.getElementById('currentPrice'); price.value = '-1';
    for (const handler of price.listeners.input) handler({ target: price });
    assert(preview.textContent.includes('gültiger Eingabe'), 'Ungültiger Vorschaukurs wird nicht als Wert ausgegeben');
    assert(captureManagerModalSubmission('tranche', doc).signature !== signature, 'Vorschau ersetzt keine Entwurfs- oder Commitidentität');
}

{
    const doc = createDocumentMock();
    const oldButton = doc.getElementById('opener');
    oldButton.dataset = { trancheId: 'stable-focus-id', action: 'edit-tranche' };
    oldButton.isConnected = false;
    const replacement = createElement('rerendered-edit', doc);
    replacement.dataset = { ...oldButton.dataset };
    doc.querySelectorAll = selector => selector.startsWith('#tranchenTable') ? [replacement] : [];
    openEditTrancheModal({ name: 'Fokusprobe', category: 'equity', type: 'aktien_neu' }, doc, oldButton);
    closeTrancheModal(doc, { confirmed: true });
    assertEqual(doc.activeElement, replacement, 'Erfolgsschluss findet den neu gerenderten Zeilenbutton über dieselbe ID');
}


{
    const doc = createTranchenPageDom();
    const categories = ['equity', 'bonds', 'gold', 'money_market'].map(value => {
        const button = new MockElement('', 'button'); button.dataset.trancheCategory = value;
        button.closest = () => button; return button;
    });
    const types = ['aktien_alt', 'aktien_neu', 'anleihe', 'gold', 'geldmarkt'].map(value => {
        const button = new MockElement('', 'button'); button.dataset.trancheType = value;
        button.closest = () => button; return button;
    });
    doc.querySelectorAll = selector => selector === '[data-tranche-category]' ? categories
        : selector === '[data-tranche-type]' ? types : [];
    for (const id of ['trancheCategoryChoices', 'trancheTypeChoices']) doc.register(new MockElement(id));
    for (const id of ['category', 'type']) doc.getElementById(id).dispatchEvent = event => {
        for (const handler of doc.getElementById(id).listeners[event.type] || []) handler(event);
    };
    openCreateTrancheModal(doc);
    const guard = getPageNavigationGuard(doc);
    const click = (id, button) => doc.getElementById(id).listeners.click[0]({ target: button });
    click('trancheCategoryChoices', categories[2]);
    assertEqual(doc.getElementById('category').value, 'gold', 'Anlageformsegment setzt den vorhandenen Wertträger');
    assertEqual(doc.getElementById('type').value, 'gold', 'Anlageformwechsel erhält die kanonische Typmatrix');
    assertEqual(types.filter(button => !button.hidden).map(button => button.dataset.trancheType).join(','), 'gold', 'Segmentansicht enthält nur zulässige Typen');
    assertEqual(types[3].getAttribute('aria-pressed'), 'true', 'Typsegment spiegelt die kanonische Auswahl');
    assert(guard.reasons().some(reason => reason.dirty), 'Segmentklick dispatcht das bestehende Change für den Guard');
    click('trancheCategoryChoices', categories[0]);
    click('trancheTypeChoices', types[0]);
    assertEqual(doc.getElementById('type').value, 'aktien_alt', 'Bestandssegment bedient die bestehende Typwahl');
    click('trancheTypeChoices', types[1]);
    assertEqual(guard.reasons().length, 0, 'Segmentrückänderung stellt die saubere Formularbaseline her');
    setManagerModalWriteStateReader(() => true, doc);
    click('trancheCategoryChoices', categories[2]);
    assertEqual(doc.getElementById('category').value, 'equity', 'Segmentklick verändert während Write keine Eingaben');
    setManagerModalWriteStateReader(() => false, doc);
    for (let repeat = 0; repeat < 3; repeat++) bindTrancheModalLifecycle(doc);
    assertEqual(doc.getElementById('trancheCategoryChoices').listeners.click.length, 1, 'Segmenthost bleibt einmal je Dokument gebunden');
    doc.getElementById('category').hidden = true;
    categories[0].focus = () => { doc.activeElement = categories[0]; };
    doc.getElementById('trancheCategoryChoices').querySelector = () => categories[0];
    showTrancheFormError(new TrancheValidationError([{ field: 'category', code: 'TRANCHE_CLASSIFICATION_MISMATCH', message: 'Ungültige Anlageform.' }]), doc);
    assertEqual(doc.activeElement, categories[0], 'Feldfehler fokussiert sichtbares Anlageformsegment statt verborgenem Select');
    assertEqual(doc.getElementById('trancheCategoryChoices').getAttribute('aria-invalid'), 'true', 'Segmentgruppe erhält den strukturierten Feldfehler');
    clearTrancheFormError(doc);
    assertEqual(doc.getElementById('trancheCategoryChoices').getAttribute('aria-invalid'), null, 'Fehlerreset bereinigt auch die Segmentgruppe');
}

{
    const doc = createDocumentMock();
    const oldOpener = doc.getElementById('opener');
    oldOpener.isConnected = false;
    const replacement = createElement('erneuerterCashausloeser', doc);
    replacement.dataset = { targetActionId: 'sale-focus' };
    const readElement = doc.getElementById;
    doc.getElementById = id => id === 'reconciliationCashStatuses' ? { querySelectorAll: () => [replacement] } : readElement(id);
    openCashPostingModal({ mode: 'confirm', targetActionId: 'sale-focus', confirmedNetProceedsEur: 95,
        cashBalanceAfterPostingEur: null, nextActionId: 'cash-confirmation:v1:sale-focus' }, doc, oldOpener);
    closeCashPostingModal(doc, { confirmed: true });
    assertEqual(doc.activeElement, replacement, 'Cashschluss findet nach Rerender den neuen Aktionsknoten desselben Verkaufs');
}

// Reale Kauf-/Cashleser erhalten denselben Zahlenvertrag bei beiden Trennzeichen.
for (const separator of [',', '.']) {
    const doc = createDocumentMock();
    openCreateTrancheModal(doc);
    doc.getElementById('name').value = 'Synthetischer Dezimalkauf';
    doc.getElementById('shares').value = `7${separator}5`;
    doc.getElementById('purchasePrice').value = `10${separator}5`;
    doc.getElementById('currentPrice').value = '';
    doc.getElementById('tqf').value = `0${separator}3`;
    const tranche = readTrancheFromForm('decimal-buy', doc);
    assertEqual(tranche.shares, 7.5, 'Kaufdialog liest Komma/Punkt kanonisch ohne Rundung');
    assertEqual(tranche.purchasePrice, 10.5, 'Kaufpreis liest Komma/Punkt kanonisch');
    assertEqual(tranche.currentPrice, 10.5, 'Optional leerer Kurs übernimmt weiterhin den Kaufpreis');
    assertEqual(tranche.tqf, 0.3, 'Teilfreistellung verwendet denselben Adapter');
    openEditTrancheModal(tranche, doc);
    assertEqual(doc.getElementById('shares').value, '7,5', 'Kauf-/Bearbeitungsdialog zeigt deutsche Stückzahl');
    openCashPostingModal({ mode: 'confirm', actionId: 'synthetic-action', trancheId: 'decimal-buy', cashBalanceAfterPostingEur: 107.5 }, doc);
    assertEqual(doc.getElementById('cashPostingBalance').value, '107,5', 'Cashdialog zeigt gespeicherten Betrag deutsch');
    doc.getElementById('cashPostingBalance').value = `107${separator}5`;
    assertEqual(readCashPostingForm(doc).cashBalanceAfterPostingEur, 107.5, 'Cashdialog liest beide Trennzeichen kanonisch');
    doc.getElementById('cashPostingBalance').value = '';
    assert(Number.isNaN(readCashPostingForm(doc).cashBalanceAfterPostingEur), 'Leeres Pflichtcashfeld bleibt ungültig');
    doc.getElementById('shares').value = '7,5.0';
    let rejected = false;
    try { readTrancheFromForm('invalid-decimal', doc); } catch { rejected = true; }
    assert(rejected, 'Kaufdialog erhält die Fachvalidierung bei mehrdeutigen Dezimalzahlen');
}

console.log('SOURCE: Fachlicher Quellenfehler sperrt nur Cashsubmit und bleibt über den Abbruchlebenszyklus sichtbar');
{
    const doc = createDocumentMock();
    const context = { mode: 'correct', targetActionId: 'source-sale', confirmedNetProceedsEur: 95,
        cashBalanceAfterPostingEur: null, currentCashError: 'Tagesgeldhistorie und aktueller Betrag widersprechen sich.' };
    openCashPostingModal(context, doc);
    assertEqual(isCashPostingSourceInvalid(doc), true, 'Öffnungsfehler ist lesend abfragbar');
    assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, true, 'Fachlicher Fehler sperrt Submit sofort');
    const error = doc.getElementById('cashPostingFormError');
    assertEqual(error.hidden, false, 'Quellenfehler ist bereits beim Öffnen sichtbar');
    assert(error.textContent.includes('Tagesgeldquelle ist beschädigt oder widersprüchlich'), 'Quellenfehler benennt beschädigte/widersprüchliche Quelle');
    assert(!doc.getElementById('cashPostingModalSummary').textContent.includes('wird als Tagesgeld-Stand übernommen'), 'Zusammenfassung verspricht bei Quellenfehler keine Übernahme');
    doc.getElementById('cashPostingBalance').value = '10100';
    doc.getElementById('cashPostingReason').value = 'Synthetische Korrektur';
    assertEqual(readCashPostingForm(doc), null, 'Auch programmatisches Lesen liefert keinen Auftrag');
    assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, true, 'Fachlicher Fehler bietet keinen Retry');
    const closing = closeCashPostingModal(doc);
    assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), true, 'Dirty-Abbruch wartet auf Entscheidung');
    doc.getElementById('navigationGuardLeave').listeners.click();
    assertEqual(await closing, true, 'Bestätigter Abbruch schließt den fehlerhaften Dialog');
    assertEqual(isCashPostingSourceInvalid(doc), false, 'Schließen entfernt den flüchtigen Quellenfehler');
    openCashPostingModal({ ...context, currentCashError: null, cashBalanceAfterPostingEur: 0 }, doc);
    assertEqual(error.hidden, true, 'Gültiges Wiederöffnen löscht sichtbaren Fehler');
    assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, false, 'Numerische Null erlaubt Submit');
    assertEqual(readCashPostingForm(doc).cashBalanceAfterPostingEur, 0, 'Null bleibt gültig lesbar');
    closeCashPostingModal(doc);
    openCashPostingModal({ ...context, currentCashError: null }, doc);
    assertEqual(doc.getElementById('cashPostingBalance').value, '', 'Fehlende Quelle ohne Fehler bleibt explizit eingebbar');
    doc.getElementById('cashPostingBalance').value = '0';
    assertEqual(readCashPostingForm(doc).cashBalanceAfterPostingEur, 0, 'Explizite Null ohne Quellrecord ist gültig');
    closeCashPostingModal(doc, { confirmed: true });
}
