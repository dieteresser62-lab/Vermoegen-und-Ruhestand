import { respondPageDialog } from './helpers/page-dialog-dom.mjs';
import { initTranchenManagerPage, saveManagerHistoryStart } from '../app/tranches/tranchen-manager-page.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { closeTrancheModal, closeCashPostingModal, openCreateTrancheModal, openCashPostingModal } from '../app/tranches/tranchen-manager-modal.js';
import { createTranchenPageDom, createLocalStorageMock, installGlobals, createCashSale, createCashRegistry, MockElement, waitFor } from './tranchen-manager-page.test.mjs';

const globals = Object.fromEntries(['document', 'window', 'localStorage', 'confirm', 'alert', 'URL', 'Blob', 'fetch'].map(key => [key, globalThis[key]]));
const originalFlush = PersistenceFacade.flush;
const originalSetItem = persistenceStorage.setItem;
const lot = { schemaVersion: 2, trancheId: 'page-cash-lot', name: 'Synthetische Tranche', shares: 10,
    purchasePrice: 80, currentPrice: 120, ticker: 'TEST.DE', isin: '', purchaseDate: '',
    category: 'equity', type: 'aktien_neu', tqf: 0.3, taxExempt: false, notes: '' };
const profileId = 'page-cash-profile';
const event = { preventDefault() {} };
async function setup({ lots = [lot], sale = { ...createCashSale({ cashStatus: 'pending_manual_posting' }), cashBalanceAfterPostingEur: undefined, cashConfirmedAt: undefined } } = {}) {
    const doc = createTranchenPageDom();
    for (const id of ['managerHousehold', 'managerHistoryStart', 'managerHistoryStartConfirm', 'managerHistoryStartStatus']) doc.register(new MockElement(id));
    installGlobals(doc, createLocalStorageMock());
    PersistenceFacade.flush = originalFlush;
    const backend = new Map();
    const adapter = {
        name: 'synthetic-manager-backend', async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch(batch) {
            for (const key of batch.deletes) backend.delete(key);
            for (const [key, value] of batch.upserts) backend.set(key, String(value));
        }
    };
    PersistenceFacade.resetPersistenceForTests(adapter);
    await PersistenceFacade.init();
    const registry = createCashRegistry(sale ? [sale] : []);
    const raw = JSON.stringify(lots);
    registry.profiles[profileId].data.depot_tranchen = raw;
    persistenceStorage.setItem('depot_tranchen', raw);
    persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
    persistenceStorage.setItem('rs_current_profile', profileId);
    persistenceStorage.setItem('rs_active_profile', profileId);
    await originalFlush.call(PersistenceFacade);
    initTranchenManagerPage({ profileId });
    return { doc, guard: getPageNavigationGuard(doc), raw, registryRaw: persistenceStorage.getItem('rs_profiles_v1'), backend, adapter };
}
function holdFlushes({ durable = false, cashAdapter = null } = {}) {
    const calls = [];
    if (cashAdapter) {
        // Cash wird nach einem schreibfreien Vorflush direkt transaktional im
        // Backend ersetzt. Auch den Rollback am echten Adapter halten.
        const saveBatch = cashAdapter.saveBatch.bind(cashAdapter);
        cashAdapter.saveBatch = async batch => {
            const result = await new Promise((resolve, reject) => calls.push({ resolve, reject, batch }));
            if (result === false) throw new Error('Synthetischer Backend-Schreibfehler');
            await saveBatch(batch);
        };
        return calls;
    }
    PersistenceFacade.flush = async () => {
        const result = await new Promise((resolve, reject) => calls.push({ resolve, reject }));
        return result === false ? false : durable ? originalFlush.call(PersistenceFacade) : true;
    };
    return calls;
}
function submit(doc, id) { return doc.getElementById(id).listeners.submit[0](event); }
function fillEdit(doc) {
    const button = new MockElement('edit', 'button');
    button.dataset.action = 'edit-tranche'; button.dataset.trancheId = window.tranchen[0].trancheId;
    doc.getElementById('tranchenTable').listeners.click[0]({ target: button });
    for (const id of ['shares', 'purchasePrice', 'currentPrice', 'tqf']) doc.getElementById(id).value = String(doc.getElementById(id).value);
    doc.getElementById('name').value = 'Geänderter Name';
}
function openCash(doc, correct) {
    const button = new MockElement('cash', 'button');
    button.dataset.cashAction = correct ? 'correct' : 'confirm'; button.dataset.targetActionId = 'page-cash-sale';
    doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: button });
    doc.getElementById('cashPostingBalance').value = '5095';
    doc.getElementById('cashPostingReason').value = 'Synthetische Korrektur';
}
async function assertBlocked(doc, guard, kind) {
    assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Erste Mutation besitzt echten Commitgrund');
    assertEqual(await guard.prepare({ decide: async () => { throw new Error('Keine Verlustfrage während Write'); } }), null,
        'App-Navigation wird am echten Handlerwrite abgewehrt');
    assertEqual(await guard.prepare({ intent: 'close' }), null, 'EXE-Schließentscheidung bleibt bei Commit gesperrt');
    const modalId = kind === 'tranche' ? 'trancheModal' : 'cashPostingModal';
    const modal = doc.getElementById(modalId);
    if (modal.classList.contains('active')) {
        const close = kind === 'tranche' ? closeTrancheModal : closeCashPostingModal;
        assertEqual(close(doc, { confirmed: true }), false, 'confirmed allein ist kein Schreibbypass');
        modal.listeners.keydown[0]({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
        modal.listeners.click[0]({ target: modal });
        const button = doc.getElementById(kind === 'tranche' ? 'closeTrancheModalBtn' : 'cashPostingCancelBtn');
        await button.click();
        assert(modal.classList.contains('active'), 'Escape, Knopf und Overlay erhalten den Editor');
    }
    const before = persistenceStorage.getItem('depot_tranchen');
    await doc.getElementById('clearTranchesBtn').click();
    await doc.getElementById('retryTrancheLoadBtn').click();
    assertEqual(persistenceStorage.getItem('depot_tranchen'), before, 'Neue Mutation und Reloadhandler bleiben gesperrt');
}

try {
    {
        const { doc, guard, backend } = await setup({ sale: null });
        const key = 'rs_wealth_history_start_v1';
        const before = '{"version":1,"startDate":"2026-01-01"}';
        persistenceStorage.setItem(key, before); await originalFlush.call(PersistenceFacade);
        const registryBefore = backend.get('rs_profiles_v1');
        const field = doc.getElementById('managerHistoryStart'); field.closest = selector => selector === '[data-history-start-input]' ? field : null; field.value = '2026-01-03';
        doc.getElementById('managerHousehold').listeners.input[0]({ target: field });
        assert(guard.reasons().some(reason => reason.dirty), 'Beginnentwurf besitzt echten Navigationsgrund');
        assertEqual(await guard.prepare({ decide: async () => false }), null, 'Abgelehnte Navigation erhält Beginnentwurf');
        assertEqual(backend.get(key), before, 'Navigation ohne Bestätigung schreibt keinen Beginn');
        const calls = holdFlushes({ durable: true });
        const saving = doc.getElementById('managerHousehold').listeners.submit[0]({ target: { closest: selector => selector === '[data-history-start-form]' ? {} : null }, preventDefault() {} });
        await waitFor(() => calls.length === 1, 'Beginncommit erreicht echten Managerflush');
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Beginnhandler besitzt echte Manager-Commitphase');
        assert(doc.getElementById('managerHistoryStart').disabled && doc.getElementById('depotAddTrancheBtn').disabled, 'Beginnflush sperrt konkurrierende Eingaben und Mutationen');
        assertEqual(await guard.prepare(), null, 'Navigation überholt echten Beginnhandler nicht');
        calls[0].resolve(true); assertEqual(await saving, true, 'Bestätigter Beginnhandler meldet Erfolg');
        assertEqual(JSON.parse(backend.get(key)).startDate, '2026-01-03', 'Beginnhandler speichert dauerhaft');
        assertEqual(backend.get('rs_profiles_v1'), registryBefore, 'Globaler Beginn verändert keine Profilregistry');
        assertEqual(guard.reasons().length, 0, 'Beginnbestätigung bereinigt Entwurf und Besitz');
        PersistenceFacade.flush = originalFlush;
        const confirmed = backend.get(key); let first = true;
        PersistenceFacade.flush = async () => { if (first) { first = false; return false; } return originalFlush.call(PersistenceFacade); };
        assertEqual(await saveManagerHistoryStart('2026-01-02'), false, 'Echter Beginnflushfehler meldet keinen Erfolg');
        assertEqual(backend.get(key), confirmed, 'Echter Beginnflushfehler erhält bestätigte Recordbytes');
        assert(doc.getElementById('managerHistoryStartStatus').textContent.includes('nicht bestätigt'), 'Beginnfehler bleibt im eigenen Status sichtbar');
        PersistenceFacade.flush = originalFlush;
        assertEqual(await saveManagerHistoryStart('2026-02-29'), false, 'Echter Beginnhandler weist ungültigen Kalendertag ab');
        assertEqual(backend.get(key), confirmed, 'Ungültiger Beginnhandler erhält bestätigten Record');
    }
    console.log('Cash-Vorflushfehler schreiben weder Fachwerte noch Rollback');
    for (const correct of [false, true]) {
        const { doc, guard, backend, adapter, registryRaw } = await setup({ sale: correct ? createCashSale() : undefined });
        openCash(doc, correct);
        const before = JSON.stringify([...backend]);
        const saveBatch = adapter.saveBatch.bind(adapter);
        let writes = 0;
        adapter.saveBatch = async batch => { writes++; return saveBatch(batch); };
        const calls = holdFlushes();
        const pending = submit(doc, 'cashPostingForm');
        await waitFor(() => calls.length === 1, 'Cashauftrag wartet im Vorflush');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryRaw, 'Vorflush enthält noch keinen Auditwrite');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), null, 'Vorflush enthält noch keinen Tagesgeldwrite');
        await assertBlocked(doc, guard, 'cash');
        calls[0].resolve(false);
        assertEqual(await pending, false, 'Vorflushfehler bestätigt keinen Cashauftrag');
        assertEqual(calls.length, 1, 'Ohne Fachmutation ist kein Rückschreibflush erforderlich');
        assertEqual(writes, 0, 'Vorflushfehler startet keinen Backendwrite');
        assertEqual(JSON.stringify([...backend]), before, 'Vorflushfehler erhält sämtliche Backendbytes');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryRaw, 'Vorflushfehler erhält die Cacheregistry');
        assertEqual(guard.reasons().some(reason => reason.phase === 'commit'), false, 'Vorflushfehler gibt Operationsbesitzer frei');
        assert(guard.reasons().some(reason => reason.dirty), 'Vorflushfehler erhält den Wiederholungsauftrag');
        PersistenceFacade.flush = originalFlush;
        await doc.getElementById('retryCashPostingSaveBtn').click();
        assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, true, 'Retry nach Vorflushfehler quittiert den Cashauftrag');
        assertEqual(writes, 1, 'Retry benötigt genau einen gemeinsamen Cash-/Auditwrite');
        assertEqual(backend.get('profile_tagesgeld'), '5095', 'Retry bestätigt absoluten Tagesgeldstand dauerhaft');
        assertEqual(JSON.parse(backend.get('profile_cash_history_v1')).entries.length, 1, 'Retry hinterlässt genau einen Cashbeleg');
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).trancheReconciliation.actions.length, 2, 'Retry hinterlässt genau einen Auditbeleg');
    }

    console.log('Cash-Readbackfehler warten auf echten Backendrollback');
    for (const correct of [false, true]) {
        const { doc, guard, backend, adapter, registryRaw } = await setup({ sale: correct ? createCashSale() : undefined });
        openCash(doc, correct);
        const before = Object.fromEntries(backend);
        const loadAll = adapter.loadAll.bind(adapter);
        let corruptReadback = true;
        adapter.loadAll = async () => {
            const records = await loadAll();
            if (corruptReadback && records.rs_profiles_v1 !== registryRaw) {
                corruptReadback = false;
                return { ...records, rs_profiles_v1: registryRaw };
            }
            return records;
        };
        const calls = holdFlushes({ cashAdapter: adapter });
        const pending = submit(doc, 'cashPostingForm');
        await waitFor(() => calls.length === 1, 'Cashauftrag erreicht Backend');
        const expected = persistenceStorage.getItem('rs_profiles_v1');
        calls[0].resolve(true);
        await waitFor(() => calls.length === 2, 'Abweichender Readback startet Backendrollback');
        assertEqual(backend.get('rs_profiles_v1'), expected, 'Vor Rollback liegt der Fachwrite tatsächlich dauerhaft vor');
        await assertBlocked(doc, guard, 'cash');
        calls[1].resolve(true);
        assertEqual(await pending, false, 'Readbackfehler bestätigt keinen Teilerfolg');
        assertEqual(JSON.stringify(Object.fromEntries(backend)), JSON.stringify(before), 'Bestätigter Rollback erhält sämtliche Backendbytes');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryRaw, 'Bestätigter Rollback erhält die Cacheregistry');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), null, 'Bestätigter Rollback entfernt unbestätigten Cashstand');
        assertEqual(persistenceStorage.getItem('profile_cash_history_v1'), null, 'Bestätigter Rollback entfernt unbestätigten Cashbeleg');
        const retry = doc.getElementById('retryCashPostingSaveBtn').click();
        await waitFor(() => calls.length === 3, 'Readback-Retry erreicht Backend');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), expected, 'Readback-Retry verwendet dieselben Auditbytes');
        calls[2].resolve(true);
        await retry;
        assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, true, 'Readback-Retry quittiert den Cashauftrag');
        assertEqual(backend.get('rs_profiles_v1'), expected, 'Readback-Retry bestätigt dieselben Auditbytes dauerhaft');
        assertEqual(JSON.parse(backend.get('profile_cash_history_v1')).entries.length, 1, 'Readback-Retry hinterlässt genau einen Cashbeleg');
    }

    console.log('Managerwrites halten Mutation, Flush, Rückschreiben und Retry zusammen');
    for (const kind of ['tranche', 'cash-confirm', 'cash-correct', 'reconcile', 'delete', 'profile']) {
        const { doc, guard, raw, registryRaw, adapter } = await setup({ sale: kind === 'cash-correct' ? createCashSale() : undefined });
        let pending;
        if (kind === 'tranche') fillEdit(doc);
        if (kind.startsWith('cash')) openCash(doc, kind === 'cash-correct');
        if (kind === 'reconcile') {
            for (const [id, value] of Object.entries({ reconcileActionId: 'guard-sale', reconcileTrancheId: lot.trancheId,
                reconcileExecutedAt: '2026-07-14', reconcileSharesSold: '1', reconcileGrossProceeds: '120', reconcileFees: '0' })) {
                if (!doc.getElementById(id)) doc.register(new MockElement(id, 'input'));
                doc.getElementById(id).value = value;
            }
            submit(doc, 'reconciliationForm');
        }
        const calls = holdFlushes({ cashAdapter: kind.startsWith('cash') ? adapter : null });
        let firstMutation = true;
        persistenceStorage.setItem = (key, value) => {
            if (firstMutation) {
                firstMutation = false;
                assert(guard.reasons().some(reason => reason.phase === 'commit' && typeof reason.owner === 'symbol'),
                    'Erste Speichermutation besitzt bereits Operationscommit');
            }
            return originalSetItem.call(persistenceStorage, key, value);
        };
        if (kind === 'tranche') pending = submit(doc, 'trancheForm');
        else if (kind.startsWith('cash')) pending = submit(doc, 'cashPostingForm');
        else if (kind === 'reconcile') pending = doc.getElementById('reconciliationConfirmBtn').click();
        else if (kind === 'delete') pending = doc.getElementById('clearTranchesBtn').click();
        else {
            const input = doc.getElementById('profileTagesgeld'); input.value = '100'; input.listeners.input[0]();
        }
        if (['reconcile', 'delete'].includes(kind)) await respondPageDialog(doc);
        await waitFor(() => calls.length === 1, `${kind}: Write erreicht Flush`);
        persistenceStorage.setItem = originalSetItem;
        await assertBlocked(doc, guard, kind === 'tranche' ? 'tranche' : 'cash');
        calls[0].resolve(false);
        await waitFor(() => calls.length === 2, `${kind}: Rückschreibflush wird abgewartet`);
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Rollback erhält exakte Tranchenbytes');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryRaw, 'Rollback erhält exakte Registrybytes');
        await assertBlocked(doc, guard, kind === 'tranche' ? 'tranche' : 'cash');
        // Auch ein Rückschreibfehler beendet die Sperre erst nach festgestelltem Fehler.
        if (kind === 'cash-correct') calls[1].reject(new Error('Synthetischer Rückschreibfehler'));
        else calls[1].resolve(true);
        if (pending) await pending;
        await waitFor(() => !guard.reasons().some(reason => reason.phase === 'commit'), 'Writeende gibt Besitzer frei');
        assert(guard.reasons().some(reason => reason.dirty), 'Wiederholungsauftrag bleibt Eingabeverlustgrund ohne Dauerlock');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, false, 'Retry bleibt erreichbar');
        assertEqual(doc.getElementById('tranchePersistenceStatus').dataset.kind, 'error', 'Flush-false meldet keinen Erfolg');
        if (kind === 'cash-correct') assert(doc.getElementById('reconciliationStatus').textContent.includes('Wiederherstellung erforderlich'), 'Rückschreibfehler wird ausdrücklich als Recoverybedarf gemeldet');
        const retryId = kind === 'tranche' ? 'retryTrancheDialogSaveBtn' : kind.startsWith('cash') ? 'retryCashPostingSaveBtn' : 'retryTrancheSaveBtn';
        assertEqual(doc.getElementById(retryId).hidden, false, 'Zugehöriger Wiederholenknopf ist sichtbar');
        if (kind === 'tranche' || kind.startsWith('cash')) {
            assert(doc.getElementById(kind === 'tranche' ? 'trancheFormError' : 'cashPostingFormError').textContent.length > 0,
                'Speicherfehler steht im offenen Fachdialog');
        }
        const retry = doc.getElementById(retryId).click();
        await waitFor(() => calls.length === 3, `${kind}: identischer Retry erreicht Flush`);
        calls[2].resolve(true); await retry;
        assertEqual(guard.reasons().some(reason => reason.phase === 'commit'), false, 'Erfolg gibt den eigenen Besitzer frei');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, true, 'Erfolg quittiert genau den Wiederholungsauftrag');
        if (kind === 'tranche' || kind.startsWith('cash')) {
            const modal = doc.getElementById(kind === 'tranche' ? 'trancheModal' : 'cashPostingModal');
            assertEqual(modal.classList.contains('active'), false, 'Erfolgreicher Retry schließt intern nach Writeende');
        }
        if (kind === 'reconcile' || kind.startsWith('cash')) {
            const actions = JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).trancheReconciliation.actions;
            assertEqual(actions.length, 2, 'Retry hängt dieselbe Action-ID genau einmal an');
        }
    }

    console.log('Dialogretry erhält Auftragsgrenzen, Folgeeingaben und neue Dialoginstanzen');
    for (const kind of ['tranche', 'cash-confirm', 'cash-correct']) for (const timing of ['after-error', 'during-retry', 'new-opening']) {
        const { doc, guard, backend, adapter } = await setup({ lots: kind === 'tranche' ? [] : [lot], sale: kind === 'cash-correct' ? createCashSale() : undefined });
        const tranche = kind === 'tranche';
        if (tranche) {
            await doc.getElementById('depotAddTrancheBtn').click();
            for (const [id, value] of Object.entries({ name: 'Ursprünglich', shares: '2', purchasePrice: '100', currentPrice: '110', tqf: '0.3' })) doc.getElementById(id).value = value;
        } else openCash(doc, kind === 'cash-correct');
        const formId = tranche ? 'trancheForm' : 'cashPostingForm';
        const retryId = tranche ? 'retryTrancheDialogSaveBtn' : 'retryCashPostingSaveBtn';
        const field = doc.getElementById(tranche ? 'notes' : 'cashPostingBalance');
        const calls = holdFlushes({ durable: true, cashAdapter: tranche ? null : adapter });
        const first = submit(doc, formId);
        await waitFor(() => calls.length === 1, 'Erster Auftrag erreicht Write');
        const expected = persistenceStorage.getItem(tranche ? 'depot_tranchen' : 'rs_profiles_v1');
        calls[0].resolve(false);
        await waitFor(() => calls.length === 2, 'Erster Fehler erreicht Rollback');
        calls[1].resolve(true); await first;
        await submit(doc, formId);
        assertEqual(calls.length, 2, 'Paralleler Submit ersetzt ungelösten Auftrag nicht');
        const foreign = guard.register('synthetic-foreign', { read: () => ({ phase: 'commit' }) });
        assertEqual(doc.getElementById(retryId).disabled, true, 'Fremder Commit sperrt den sichtbaren Retryknopf');
        await doc.getElementById(retryId).click();
        assertEqual(calls.length, 2, 'Fremder Commit sperrt Retry');
        foreign.unregister();
        assertEqual(doc.getElementById(retryId).disabled, false, 'Fremdes Writeende gibt den Retryknopf wieder frei');
        if (timing === 'after-error') field.value = tranche ? 'Spätere Notiz' : '6000';
        const retry = doc.getElementById(retryId).click();
        await waitFor(() => calls.length === 3, 'Retry erreicht gespeicherten Auftrag');
        assertEqual(persistenceStorage.getItem(tranche ? 'depot_tranchen' : 'rs_profiles_v1'), expected,
            'Retry verwendet bytegleich dieselben Daten einschließlich IDs und Zeitpunkten');
        await doc.getElementById(retryId).click(); await submit(doc, formId);
        assertEqual(calls.length, 3, 'Doppelklick und Submit starten keinen zweiten Write');
        if (timing === 'new-opening') {
            if (tranche) openCreateTrancheModal(doc);
            else openCashPostingModal({ mode: 'confirm', targetActionId: 'new-target', confirmedNetProceedsEur: 1, nextActionId: 'new-action' }, doc);
        }
        if (timing !== 'after-error') field.value = tranche ? 'Spätere Notiz' : '6000';
        calls[2].resolve(true); await retry;
        assertEqual(backend.get(tranche ? 'depot_tranchen' : 'rs_profiles_v1'), expected,
            'Bestätigtes Retryende speichert ursprüngliche Daten bytegleich im Backend');
        const modal = doc.getElementById(tranche ? 'trancheModal' : 'cashPostingModal');
        assert(modal.classList.contains('active'), 'Älterer Erfolg erhält jüngeren Editor');
        assertEqual(field.value, tranche ? 'Spätere Notiz' : '6000', 'Erfolg erhält jüngere Eingaben');
        assert(guard.reasons().some(reason => reason.owner === `manager-dialog-${tranche ? 'tranche' : 'cash'}` && reason.dirty),
            'Jüngerer Editor bleibt verlustrelevant');
        assertEqual(doc.getElementById(retryId).hidden, true, 'Erfolg quittiert ausschließlich alten Auftrag');
        if (timing !== 'new-opening') {
            if (tranche) {
                const id = JSON.parse(expected)[0].trancheId;
                const next = submit(doc, formId);
                await waitFor(() => calls.length === 4, 'Bewusster Folgesubmit erreicht Write');
                calls[3].resolve(true); await next;
                const lots = JSON.parse(persistenceStorage.getItem('depot_tranchen'));
                assertEqual(lots.length, 1, 'Folgesubmit dupliziert bestätigte Neuanlage nicht');
                assertEqual(lots[0].trancheId, id, 'Folgesubmit bearbeitet bestätigte ID');
                assertEqual(lots[0].notes, 'Spätere Notiz', 'Bewusster Folgesubmit bestätigt spätere Eingabe');
            } else {
                assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, true,
                    'Bestätigter Cashauftrag ist vom unbestätigten Entwurf getrennt und nicht erneut submitbar');
                await submit(doc, formId);
                assertEqual(calls.length, 3, 'Bestätigter Casheditor erzeugt keinen automatischen Folgeauftrag');
                const actions = JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).trancheReconciliation.actions;
                assertEqual(actions.length, 2, 'Cashretry bestätigt dieselbe Action genau einmal');
                assertEqual(actions[1].cashBalanceAfterPostingEur, 5095, 'Audit enthält ursprünglichen Cashstand');
            }
        }
    }

    for (const kind of ['tranche', 'cash-confirm', 'cash-correct']) {
        const tranche = kind === 'tranche';
        const { doc, guard, backend, adapter } = await setup({ sale: kind === 'cash-correct' ? createCashSale() : undefined });
        if (tranche) fillEdit(doc); else openCash(doc, kind === 'cash-correct');
        const formId = tranche ? 'trancheForm' : 'cashPostingForm';
        const retryId = tranche ? 'retryTrancheDialogSaveBtn' : 'retryCashPostingSaveBtn';
        const calls = holdFlushes({ durable: true, cashAdapter: tranche ? null : adapter });
        let attempt = submit(doc, formId), expected;
        for (let round = 0; round < 2; round++) {
            await waitFor(() => calls.length === round * 2 + 1, 'Ursprünglicher Auftrag erreicht erneut Write');
            const bytes = persistenceStorage.getItem(tranche ? 'depot_tranchen' : 'rs_profiles_v1');
            expected ??= bytes;
            assertEqual(bytes, expected, 'Auch erneuter Fehler erzeugt keine neue ID oder neuen Zeitstempel');
            calls[round * 2].resolve(false);
            await waitFor(() => calls.length === round * 2 + 2, 'Erneuter Fehler wartet Rollbackende ab');
            calls[round * 2 + 1].resolve(true); await attempt;
            assert(guard.reasons().some(reason => reason.dirty), 'Erneuter Fehler bestätigt keine Baseline');
            attempt = doc.getElementById(retryId).click();
        }
        await waitFor(() => calls.length === 5, 'Letzter Retry erreicht Write');
        calls[4].resolve(true); await attempt;
        assertEqual(backend.get(tranche ? 'depot_tranchen' : 'rs_profiles_v1'), expected, 'Erfolg bestätigt ursprünglichen Auftrag im Backend');
        assertEqual(doc.getElementById(tranche ? 'trancheModal' : 'cashPostingModal').classList.contains('active'), false,
            'Unveränderter Editor schließt nach bestätigt abgeschlossenem Retry');
    }

    console.log('Fehlgeschlagene Rückschreibkeys zeigen weiterhin den bestätigten Stand');
    {
        const { doc, guard } = await setup();
        const calls = holdFlushes();
        const removeItem = persistenceStorage.removeItem;
        const input = doc.getElementById('profileTagesgeld');
        input.value = '100'; input.listeners.input[0]();
        await waitFor(() => calls.length === 1, 'Profilmutation erreicht Flush');
        persistenceStorage.removeItem = key => {
            if (key === 'profile_tagesgeld') throw new Error('Synthetischer Keyfehler');
            return removeItem.call(persistenceStorage, key);
        };
        try {
            calls[0].resolve(false);
            await waitFor(() => calls.length === 2, 'Keyfehler überspringt keinen Rückschreibflush');
            calls[1].resolve(true);
            await waitFor(() => !guard.reasons().some(reason => reason.phase === 'commit'), 'Keyfehler wird vollständig beendet');
            assertEqual(String(input.value), '0', 'Bestätigter Profilwert bleibt trotz fehlgeschlagenem Keyrollback sichtbar');
            assert(doc.getElementById('tranchePersistenceStatus').textContent.includes('Rückschreiben'), 'Keyfehler behauptet keine dauerhafte Wiederherstellung');
            assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, false, 'Keyfehler erhält den Wiederholungsauftrag');
        } finally { persistenceStorage.removeItem = removeItem; }
    }
    {
        const { doc, guard, backend, adapter, registryRaw } = await setup(); openCash(doc, false);
        const calls = holdFlushes({ cashAdapter: adapter });
        const pending = submit(doc, 'cashPostingForm');
        await waitFor(() => calls.length === 1, 'Cashmutation erreicht echten Backendwrite');
        calls[0].resolve(false);
        await waitFor(() => calls.length === 2, 'Auditrollback erreicht echten Backendwrite');
        calls[1].reject(new Error('Synthetischer Auditrollbackfehler')); await pending;
        assert(doc.getElementById('reconciliationCashStatuses').innerHTML.includes('data-cash-action="confirm"'),
            'Cashprojektion zeigt alten bestätigten Status statt unbestätigtem Auditereignis');
        assertEqual(backend.get('rs_profiles_v1'), registryRaw, 'Abgewiesene Writes verändern die Backendregistry nicht');
        assert(doc.getElementById('reconciliationStatus').textContent.includes('Wiederherstellung erforderlich'),
            'Unbestätigter Backendrollback wird ausdrücklich als Recoverybedarf gemeldet');
        assertEqual(guard.reasons().some(reason => reason.phase === 'commit'), false, 'Auditrollbackfehler erzeugt keinen Dauerlock');
    }

    console.log('Profilfelder verhindern Nutzereingaben während fremder Manageroperationen');
    for (const kind of ['quotes', 'tranche']) {
        const { doc, guard } = await setup();
        const input = doc.getElementById('profileTagesgeld');
        assertEqual(input.disabled, false, `${kind}: Profilfeld ist vor der Operation bedienbar`);
        const calls = holdFlushes(), requests = [];
        let pending;
        if (kind === 'quotes') {
            globalThis.fetch = url => new Promise(resolve => requests.push({ url, resolve }));
            pending = doc.getElementById('updatePricesBtn').click();
            await waitFor(() => requests.length === 1, 'Kursbatch wartet auf gehaltene Fetch-Promise');
            assert(guard.reasons().some(reason => reason.phase === 'preparing'), 'Kursbatch ist noch in Vorbereitung');
        } else {
            fillEdit(doc);
            pending = submit(doc, 'trancheForm');
            await waitFor(() => calls.length === 1, 'Tranchenwrite wartet auf gehaltenen Flush');
            assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Tranchenflush besitzt Commitgrund');
        }
        assertEqual(input.disabled, true, `${kind}: Profilfeld verhindert eine Nutzereingabe während der Sperre`);
        // Nur das Testdoppel kann ein deaktiviertes Feld ändern und seinen Listener direkt aufrufen.
        input.value = '321';
        assertEqual(input.listeners.input[0](), false, `${kind}: Echter Listener wehrt die synthetische Eingabe ab`);
        assertEqual(input.disabled, true, `${kind}: Synthetischer Input hebt die Feldsperre nicht auf`);
        if (kind === 'quotes') {
            requests[0].resolve({ ok: true, json: async () => ({ symbol: lot.ticker, price: 150,
                currency: 'EUR', asOf: Math.floor(Date.now() / 1000), source: 'synthetic' }) });
            await waitFor(() => calls.length === 1, 'Kursbatch erreicht seinen Tranchenflush');
            assertEqual(input.disabled, true, 'Profilfeld bleibt beim Übergang von Vorbereitung zu Commit gesperrt');
        }
        calls[0].resolve(true);
        await pending;
        assertEqual(input.disabled, false, `${kind}: Profilfeld ist nach Operationsende wieder bedienbar`);
        input.value = '654'; input.listeners.input[0]();
        await waitFor(() => calls.length === 2, `${kind}: Neue bedienbare Eingabe erreicht Profilflush`);
        calls[1].resolve(true);
        await waitFor(() => !guard.reasons().some(reason => reason.phase === 'commit'), 'Profilautosave endet vollständig');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '654', `${kind}: Neue Nutzereingabe wird dauerhaft gespeichert`);
        assertEqual(doc.getElementById('tranchePersistenceStatus').textContent, 'Profilwerte dauerhaft gespeichert.',
            `${kind}: Autosave meldet bestätigten Erfolg`);
    }

    console.log('Profilfortsetzungen bleiben ohne Freigabelücke');
    {
        const { doc, guard } = await setup(); const calls = holdFlushes();
        const input = doc.getElementById('profileTagesgeld'); input.value = '100'; input.listeners.input[0]();
        await waitFor(() => calls.length === 1, 'Erster Profilwrite');
        let gap = false;
        const unsubscribe = guard.subscribe(reasons => { if (!reasons.some(reason => reason.phase === 'commit')) gap = true; });
        input.value = '200'; input.listeners.input[0]();
        calls[0].resolve(true);
        await waitFor(() => calls.length === 2, 'Fortsetzung startet im selben Besitzer');
        assertEqual(gap, false, 'Kein Notify ohne Commit zwischen Profilwrites');
        assertEqual(await guard.prepare(), null, 'Navigation überholt keine Fortsetzung');
        calls[1].resolve(true);
        await waitFor(() => !guard.reasons().some(reason => reason.phase === 'commit'), 'Letzter Profilwrite beendet Besitzer');
        unsubscribe();
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '200', 'Letzter gültiger Profilwert wird bestätigt');
    }

    console.log('Angenommene Kurskündigung wartet alle Jobs und verwirft späte Antworten');
    {
        const lots = Array.from({ length: 6 }, (_, index) => ({ ...lot, trancheId: `lot-${index}`, ticker: `TEST${index}.DE` }));
        const { doc, guard, raw } = await setup({ lots }); const requests = [];
        globalThis.fetch = url => new Promise(resolve => requests.push({ url, resolve }));
        const batch = doc.getElementById('updatePricesBtn').click();
        await waitFor(() => requests.length === 3, 'Alle drei parallelen Jobs gestartet');
        let finished = false;
        const navigation = guard.prepare({ decide: async () => true }).then(attempt => { finished = true; return attempt; });
        for (let index = 0; index < 12; index++) await Promise.resolve();
        assertEqual(finished, false, 'Navigation wartet selbst bei ignoriertem AbortSignal auf Jobenden');
        requests[0].resolve({ ok: false, status: 404 });
        for (let index = 0; index < 12; index++) await Promise.resolve();
        assertEqual(finished, false, 'Ein beendeter Job reicht nicht zur Freigabe');
        for (const [index, request] of requests.entries()) if (index) request.resolve({ ok: true, json: async () => ({
            symbol: `TEST${index}.DE`, price: 150, currency: 'EUR', asOf: Math.floor(Date.now() / 1000)
        }) });
        const attempt = await navigation; await batch;
        assert(attempt && guard.validate(attempt), 'Alle bestätigten Abbruchenden erlauben Navigation');
        assertEqual(requests.length, 3, 'Keine Suchanfrage und kein Folgebatch nach Kündigung');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Späte Quoteantworten starten keinen Save');
        guard.end(attempt);
        assertEqual(doc.getElementById('updatePricesBtn').disabled, false, 'Nach Abbruchende bleibt Kursretry erreichbar');
    }
    console.log('Navigationskündigung überstimmt auch einen vorherigen Batchtimeout');
    {
        const lots = Array.from({ length: 6 }, (_, index) => ({ ...lot, trancheId: `timeout-${index}`, ticker: `TEST${index}.DE` }));
        const { doc, guard, raw } = await setup({ lots });
        const requests = []; let timeout, flushes = 0;
        globalThis.fetch = url => new Promise(resolve => requests.push({ url, resolve }));
        PersistenceFacade.flush = async () => { flushes++; return true; };
        const schedule = globalThis.setTimeout;
        globalThis.setTimeout = (callback, ms, ...args) => {
            if (ms === 12000) timeout = callback;
            return schedule(callback, ms, ...args);
        };
        let batch;
        try { batch = doc.getElementById('updatePricesBtn').click(); }
        finally { globalThis.setTimeout = schedule; }
        await waitFor(() => requests.length === 3, 'Timeoutgegenfall startet drei Jobs');
        requests[0].resolve({ ok: true, json: async () => ({ symbol: 'TEST0.DE', price: 150, currency: 'EUR', asOf: Math.floor(Date.now() / 1000) }) });
        await waitFor(() => requests.length === 4, 'Ein valides Teilresultat liegt vor Timeout vor');
        timeout();
        const navigation = guard.prepare({ decide: async () => true });
        for (let index = 0; index < 12; index++) await Promise.resolve();
        for (const [index, request] of requests.entries()) if (index) request.resolve({ ok: false, status: 404 });
        const attempt = await navigation; await batch;
        assert(attempt && guard.validate(attempt), 'Kündigung nach Timeout endet ohne neuen Verlustgrund oder Save');
        assertEqual(flushes, 0, 'Vorhandenes Teilresultat startet nach Navigationskündigung auch keinen Rückschreibwrite');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Timeout plus Kündigung lässt Bestand bytegleich');
        guard.end(attempt);
    }

} finally {
    persistenceStorage.setItem = originalSetItem;
    PersistenceFacade.flush = originalFlush;
    PersistenceFacade.resetPersistenceForTests();
    for (const [key, value] of Object.entries(globals)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}

// Die einzige Reiterliste und Kartenaktionen delegieren identische geschützte Aufträge.
{
    const { bindManagerProfileSwitch } = await import('../app/tranches/tranchen-manager-profiles.js');
    const { resolveManagerTarget } = await import('../app/tranches/tranchen-manager-page.js');
    const listeners = {}, nav = { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) };
    const doc = { getElementById: id => id === 'managerSectionNav' ? nav : null };
    const requests = [];
    assertEqual(bindManagerProfileSwitch(doc, async (id, opener) => { requests.push({ id, opener }); }), true, 'Ansichtsaufträge werden einmal gebunden');
    assertEqual(bindManagerProfileSwitch(doc, () => {}), false, 'Neuzeichnen verdoppelt die Bindung nicht');
    const plan = { dataset: { managerView: 'plan' }, closest: selector => selector === '[data-manager-view]' || selector === '[role="tab"]' ? plan : null };
    await listeners.click[0]({ target: plan, preventDefault() {} });
    await listeners.keydown[0]({ target: plan, key: ' ', preventDefault() {} });
    assertEqual(requests.length, 2, 'Klick und Leertaste bestätigen über denselben Ansichtsauftrag');
    assertEqual(requests[0].id, null, 'Planaktivierung ist von einer Profilidentität getrennt');
    for (const location of [{ hash: '#fremd', search: '?person=b' }, { hash: '#profileTagesgeld', search: '?person=a&person=b' },
        { hash: '#personendaten', search: '?person=' }, { hash: '#managerDepotTitle', search: '?fremd=a' }])
        assertEqual(resolveManagerTarget(location), null, 'Unbekannte und mehrdeutige Ziele sind kein Navigationsauftrag');
}
