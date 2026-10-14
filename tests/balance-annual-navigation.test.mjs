import { installAnnualLocks, annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { completeAnnualPeriodCommit } from '../app/balance/balance-annual-period.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createAnnualNavigationLifecycle } from '../app/balance/balance-annual-orchestrator.js';
import { createSnapshotHandlers, consumeAnnualRetry, ANNUAL_RETRY_SESSION_KEY } from '../app/balance/balance-binder-snapshots.js';
import { createInflationHandlers } from '../app/balance/balance-annual-inflation.js';
import { createMarketdataHandlers, createManualAnnualQuote } from '../app/balance/balance-annual-marketdata.js';
import { createAnnualModalHandlers, reportAnnualActionError, finishAnnualPreflight } from '../app/balance/balance-annual-modal.js';
import { createAnnualHandlers } from '../app/balance/balance-binder-annual.js';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { PersistenceFacade, persistenceStorage, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { CONFIG, ValidationError } from '../app/balance/balance-config.js';
import { createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
async function until(predicate) {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('Die kontrollierte Barriere wurde nicht erreicht.');
}
const previous = {
    load: StorageManager.loadState, save: StorageManager.saveState,
    create: StorageManager.createSnapshot, render: StorageManager.renderSnapshots,
    list: SnapshotArchive.listSnapshots, read: SnapshotArchive.readSnapshot,
    toast: UIRenderer.toast, clear: UIRenderer.clearActionError, error: UIRenderer.handleActionError,
    fetch: globalThis.fetch, document: globalThis.document, confirm: globalThis.confirm, flush: PersistenceFacade.flush,
    localStorage: globalThis.localStorage, testDate: getAppTestDate(),
    restoreBinder: preserveUIBinderStateForTests()
};
let state, errors, fachwrites;
function seed() {
    state = { annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null } };
    errors = []; fachwrites = 0;
}
function domFixture() {
    return {
        inputs: Object.fromEntries(Object.entries({ profilName: 'Synthetisches Jahr', aktuellesAlter: '67',
            inflation: '2', floorBedarf: '1000', endeVJ: '120', endeVJ_1: '110', endeVJ_2: '100',
            endeVJ_3: '90', ath: '150', jahreSeitAth: '2', marketCapeRatio: '20' }).map(([key, value]) => [key, { value }])),
        controls: { btnJahresUpdate: { innerHTML: 'Jahr', disabled: false }, btnUndoNachruecken: { style: {} } },
        outputs: {}, expenses: { yearSelect: { value: '2026' } }
    };
}

const restoreLocks = installAnnualLocks();
try {
    globalThis.confirm = () => true;
    StorageManager.loadState = () => structuredClone(state);
    StorageManager.saveState = value => { state = structuredClone(value); };
    UIRenderer.toast = () => {};
    UIRenderer.clearActionError = () => {};
    UIRenderer.handleActionError = error => { errors.push(error.message); };

    // Jahresphasen, Snapshot- und Retrybarrieren: annual-coordinator.test.mjs.
    for (const kind of ['inflation', 'etf', 'cape']) {
        seed();
        state.annualPeriodMetadata.pendingCommit = { periodId: `calendar-year:${new Date().getFullYear() - 1}`, snapshotId: 'synthetic', phase: 'writes_started' };
        const dom = domFixture(), gate = deferred();
        const guard = createNavigationGuard({ decide: async () => true });
        let fetches = 0, writes = 0;
        const lifecycle = createAnnualNavigationLifecycle({ guard, flush: async () => { writes++; } });
        const fetchImpl = async () => { fetches++; await gate.promise; return { ok: true, json: async () => [null, [{ indicator: { id: 'FP.CPI.TOTL.ZG' }, countryiso3code: 'DEU', date: '2026', value: 2 }]], text: async () => '2026.12 30' }; };
        globalThis.fetch = fetchImpl;
        const inflation = createInflationHandlers({ dom, update: () => { writes++; }, debouncedUpdate: () => { writes++; },
            navigationLifecycle: lifecycle, fetchImpl, now: () => new Date(2027, 0, 15), setTimeoutImpl: () => 0, clearTimeoutImpl() {} });
        const market = createMarketdataHandlers({ dom, appState: {}, debouncedUpdate: () => { writes++; }, applyAnnualInflation: () => { writes++; }, navigationLifecycle: lifecycle });
        const action = kind === 'inflation' ? inflation.handleFetchInflation : kind === 'etf' ? market.handleNachrueckenMitETF : market.handleFetchCapeAuto;
        const before = JSON.stringify({ state, inputs: dom.inputs });
        const running = action();
        const navigation = guard.prepare();
        await until(() => lifecycle.read().phase === 'cancelling');
        gate.resolve();
        assertEqual((await running).status, 'cancelled', `${kind}: Einzelabruf bestätigt Vorbereitungskündigung`);
        const attempt = await navigation;
        assert(Boolean(attempt), `${kind}: Handoff wartet Einzelabrufende`);
        assertEqual(fetches, 1, `${kind}: keine Fallback-/Retryfolge nach Kündigung`);
        assertEqual(writes, 0, `${kind}: keine verspätete Antwortanwendung oder Flush`);
        assertEqual(JSON.stringify({ state, inputs: dom.inputs }), before, `${kind}: Inflations-/Marktdaten bleiben unverändert`);
        guard.end(attempt);
    }

    for (const kind of ['inflation', 'etf', 'cape']) {
        seed();
        setAppTestDate('2027-01-02');
        state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic', phase: 'writes_started' };
        const dom = domFixture();
        let fetches = 0, writes = 0;
        globalThis.fetch = () => { fetches++; throw new Error('Kein Netz'); };
        const realLifecycle = createAnnualNavigationLifecycle({ guard: null, flush: async () => { writes++; } });
        // Kündigung exakt in der asynchronen Ergebnisgrenze vor commit().
        const lifecycle = { run: (options, execute) => realLifecycle.run(options, operation => {
            const running = execute(operation);
            operation.controller.abort();
            return running;
        }) };
        const inflation = createInflationHandlers({ dom, update: () => { writes++; }, debouncedUpdate() {}, navigationLifecycle: lifecycle });
        const market = createMarketdataHandlers({ dom, appState: {}, debouncedUpdate: () => { writes++; }, applyAnnualInflation() {}, navigationLifecycle: lifecycle });
        const action = kind === 'inflation' ? inflation.handleFetchInflation : kind === 'etf' ? market.handleNachrueckenMitETF : market.handleFetchCapeAuto;
        const before = JSON.stringify({ state, inputs: dom.inputs });
        assertEqual((await action()).status, 'cancelled', `${kind}: synthetischer Einzelabruf respektiert Abbruch`);
        assertEqual(fetches, 0, `${kind}: synthetischer Abbruch startet keinen echten Fallback`);
        assertEqual(writes, 0, `${kind}: Abbruch vor Mutation und Flush`);
        assertEqual(JSON.stringify({ state, inputs: dom.inputs }), before, `${kind}: Abbruch erhält ursprüngliche Daten`);
        setAppTestDate(null);
    }

    for (const fail of [false, true]) {
        seed();
        const dom = domFixture(), gate = deferred(), guard = createNavigationGuard();
        const lifecycle = createAnnualNavigationLifecycle({ guard, flush: () => gate.promise });
        const inflation = createInflationHandlers({
            dom, update() {}, debouncedUpdate() {}, navigationLifecycle: lifecycle,
            now: () => new Date(2027, 0, 15), setTimeoutImpl: () => 0, clearTimeoutImpl() {},
            fetchImpl: async () => ({ ok: true, json: async () => [null, [{ indicator: { id: 'FP.CPI.TOTL.ZG' }, countryiso3code: 'DEU', date: '2026', value: 2 }]] })
        });
        const running = inflation.handleFetchInflation().then(result => ({ result }), error => ({ error }));
        await until(() => lifecycle.read().phase === 'commit');
        assertEqual(dom.inputs.floorBedarf.value, '1.020', 'Normaler Einzelabruf bewahrt multiplikative Inflationsanpassung');
        assertEqual(await guard.prepare(), null, 'Einzelabruf hält Schreibsperre durch den offenen Flush');
        assertEqual((await inflation.handleFetchInflation()).status, 'in_flight', 'Offener Einzelabschluss lässt keine nächste Aktion zu');
        gate.resolve(!fail);
        const outcome = await running;
        if (fail) {
            assertEqual(outcome.error.message, 'PERSISTENCE_FLUSH_FAILED', 'Abgelehnter Einzelabschlussflush ist kein bestätigter Erfolg');
            assert(errors.includes('PERSISTENCE_FLUSH_FAILED'), 'Einzelflushfehler wird ortsfest gemeldet');
        } else assertEqual(outcome.result.rate, 2, 'Bestätigter Einzelabschluss bewahrt fachliches Ergebnis');
        assertEqual(guard.reasons().length, 0, 'Einzelhandler löst erst nach Abschluss seine Laufzeitsperre');
    }

    {
        seed();
        const guard = createNavigationGuard(), gate = deferred();
        const owner = createAnnualNavigationLifecycle({ guard, flush: () => gate.promise });
        const nested = createAnnualNavigationLifecycle({ guard, flush: async () => { throw new Error('Kein geschachtelter Flush'); } });
        let nestedDone = false;
        const running = owner.run({}, async operation => {
            operation.commit();
            await nested.run({ navigationOperation: operation }, async inherited => {
                assertEqual(inherited, operation, 'Nested-Abruf verwendet denselben Besitzer');
            });
            nestedDone = true;
        });
        await until(() => nestedDone);
        assertEqual(guard.reasons().length, 1, 'Nested-Ende löst äußere Schreibsperre nicht');
        assertEqual(await guard.prepare(), null, 'Offener Abschlussflush hält Sperre bis Bestätigung');
        gate.resolve(); await running;
        assertEqual(guard.reasons().length, 0, 'Bestätigter Flush beendet Besitzer');
    }

    {
        const { doc } = createDialogFixture(); globalThis.document = doc;
        const node = id => { const value = doc.createElement('button'); value.id = id; doc.body.append(value); return value; };
        node('opener');
        const aliases = { modalTitle: 'balanceAnnualCloseTitle', modalResults: 'annualResults', modalCloseBtn: 'annualCloseBtn' };
        const elements = { get: id => id === 'x' ? doc.querySelector('[data-close-dialog-close]') : doc.getElementById(aliases[id] || id) };
        const emit = async (type, event) => doc.getElementById('balanceAnnualClose')?.fire(type, event);
        const text = root => dialogElements(root).map(node => node.textContent).join(' ');
        const guard = getPageNavigationGuard(doc);
        const lifecycle = createAnnualNavigationLifecycle({ guard, flush: async () => {} });
        const results = { startTime: 1, endTime: 2, errors: [], age: { old: 67, new: 68 } };
        const handlers = createAnnualModalHandlers({ getLastUpdateResults: () => results });
        doc.activeElement = elements.get('opener');
        let binding;
        const prepared = handlers.showAnnualPreparation({ targetYear: 2026, opener: elements.get('opener'),
            model: { occasion: { previousYear: 2026, previousMonth: 12 } },
            people: [{ id: 'a', name: 'A', value: 18000, lastDate: '2026-09-01' }],
            onReady: handle => { binding = handle; },
            validatePrice: value => ({ manualPrice: createManualAnnualQuote(value, 'calendar-year:2026').price }) });
        assert(doc.getElementById('balanceAnnualClose').querySelectorAll('[data-close-dialog-step]').length === 6,
            'Vorbereitungsdialog zeigt sechs Schritte ohne behaupteten Jahrescommit');
        assertEqual(elements.get('modalTitle').textContent, 'Dezember und Jahr 2026 abschließen', 'Vorbereitungstitel verwendet Periodenkontext');
        const root = doc.getElementById('balanceAnnualClose');
        const footer = root.querySelector('[data-close-dialog-footer]');
        const backup = root.querySelector('[data-overview-backup]');
        const backupStatus = root.querySelector('[data-annual-backup-status]');
        assert(footer.children.indexOf(backup.parent) < footer.children.indexOf(root.querySelector('.close-dialog-foot-row'))
            && footer.children.indexOf(backupStatus) < footer.children.indexOf(root.querySelector('.close-dialog-foot-row')),
            'Sicherungshinweis und Exportstatus stehen innerhalb der Fußleiste vor den Abschlussaktionen');
        assert(backup.className.includes('ds-button-secondary') && !backup.parent.hidden && backupStatus.hidden,
            'Empfohlene Sicherung bleibt sekundär und Exportstatus zunächst verborgen');
        binding.activate('cash');
        const cashStep = root.querySelector('[data-close-dialog-step="cash"]');
        assertEqual(dialogElements(cashStep).filter(node => node.textContent === 'Tagesgeld am 31.12.2026').length, 1,
            'Jahresendstand hat genau einen sichtbaren Schritttitel');
        assert(!cashStep.querySelector('h3') && cashStep.querySelector('.close-dialog-step-summary').hidden,
            'Offener Jahresschritt enthält keine Zwischenüberschrift oder vorgeschaltete Zusammenfassung');
        const cashFields = cashStep.querySelector('.tagesgeld-fields');
        assertEqual(cashFields.children[0].className, 'tagesgeld-provenance', 'Jahresfelder beginnen mit der gemeinsamen Herkunft');
        assert(cashFields.querySelector('.ds-info-pop').textContent.includes('heutigen Bestätigungstag'), 'Cashbeleg und Bestätigungstag bleiben im Info-Popover erreichbar');
        assertEqual(cashFields.querySelector('[data-tagesgeld-confirm]').textContent, 'Stand stimmt', 'Vorbelegter Jahresendstand besitzt eine ausdrückliche Bestätigung');
        assert(elements.get('annualConfirmBtn').disabled, 'Vorbelegter Jahresendstand gibt den Jahresabschluss nicht frei');
        const cashInput = root.querySelector('[data-tagesgeld-person]'); cashInput.value = '18.000,125';
        binding.update({ occasion: { previousYear: 2026, previousMonth: 12 } });
        assert(root.querySelector('[data-tagesgeld-person]') === cashInput && cashInput.value === '18.000,125',
            'Refresh erhält Jahresfeldidentität und Entwurf');
        binding.setBusy(true); await backup.fire('click');
        assert(backup.disabled && backupStatus.hidden, 'Busy sperrt den bestehenden Backuphaken ohne Exportstart');
        binding.setBusy(false);
        binding.setStatus('Jahr gespeichert · Wiederherstellung erforderlich');
        assertEqual(footer.querySelector('.close-dialog-status').textContent, 'Jahr gespeichert · Wiederherstellung erforderlich',
            'Vorgeordnete Sicherung erhält den bestehenden Jahres-/Monatsstatuskanal');

        binding.updateMarketData({ values: { inflation: annualTestMarketData.inflation, cape: annualTestMarketData.cape }, errors: { etf: 'Fehlt' } });
        await prepareCloseFixture(doc);
        elements.get('annualHandPrice').value = '-1'; await elements.get('annualHandPrice').fire('input');
        await elements.get('annualConfirmBtn').fire('click');
        assertEqual(elements.get('annualConfirmBtn').hidden, false, 'Ungültiger Handkurs beginnt keinen Jahresabschluss');
        elements.get('annualHandPrice').value = '160.4'; await elements.get('annualHandPrice').fire('input');
        await elements.get('annualConfirmBtn').fire('click');
        assertEqual((await prepared).manualPrice, 160.4, 'Dialog bestätigt Kurs flüchtig für denselben Jahrespfad');
        handlers.showUpdateResultModal(results); await elements.get('modalCloseBtn').fire('click');
        const cancelled = handlers.showAnnualPreparation({ targetYear: 2026, validatePrice() {} });
        await elements.get('modalCloseBtn').fire('click');
        assertEqual(await cancelled, null, 'Dialogabbruch bestätigt keinen Jahreswrite');
        handlers.showPlanningStart({ firstPlanningYear: 2026, opener: elements.get('opener') });
        assertEqual(elements.get('modalTitle').textContent, 'Erster Jahresabschluss', 'Kopfzugang öffnet erreichbaren Erstjahrhinweis');
        assert(text(elements.get('modalResults')).includes('Erstes Planungsjahr 2026 · erster Jahresabschluss Anfang 2027'), 'Hinweis nennt relevanten Termin');
        assert(elements.get('annualConfirmBtn').hidden && !elements.get('annualHandPriceGroup'), 'Hinweis bietet weder Abschluss 2025 noch Handkurs');
        await elements.get('modalCloseBtn').fire('click');
        assertEqual(doc.activeElement.id, 'opener', 'Erstjahrhinweis gibt Fokus an den Auslöser zurück');

        // Befund 1: Den echten Kopfzugang bis nach dem Binder-Fallback ausführen.
        console.log('Befund 1: vollständiger Kopfzugang erhält den Erstjahrhinweis');
        const records = new Map();
        globalThis.localStorage = { getItem: key => records.get(key) ?? null,
            setItem: (key, value) => records.set(key, String(value)), removeItem: key => records.delete(key),
            key: index => [...records.keys()][index] ?? null, get length() { return records.size; } };
        resetPersistenceRuntimeForTests();
        setAppTestDate('2026-01-02');
        seed();
        state.wealthHistory = { schemaVersion: 1, entries: [createManualWealthHistoryEntry({
            tagesgeld: 10000, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0
        }, '2026-01-01')] };
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
        persistenceStorage.setItem('rs_current_profile', 'a');
        persistenceStorage.setItem('rs_active_profile', 'a');
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Synthetisch' }, data: {} }
        } }));
        // Der echte Exportbinder bleibt innerhalb der Jahresfußleiste und besitzt Busy bis Exportende.
        {
            const originalCreate = doc.createElement, originalFlush = PersistenceFacade.flush;
            let downloads = 0, exportBinding, entered = false;
            doc.createElement = tag => { const element = originalCreate(tag); if (tag === 'a') element.click = () => { downloads++; }; return element; };
            const exportHandlers = createAnnualModalHandlers({ getLastUpdateResults: () => results });
            setAppTestDate(null);
            const pending = exportHandlers.showAnnualPreparation({ targetYear: 2025, onReady: h => { exportBinding = h; } });
            const backup = doc.querySelector('[data-overview-backup]'), status = doc.querySelector('[data-annual-backup-status]');
            const gate = deferred();
            PersistenceFacade.flush = async () => { if (!entered) { entered = true; await gate.promise; } return true; };
            try {
                const exporting = backup.fire('click'); await until(() => entered);
                assert(exportBinding.root.getAttribute('aria-busy') === 'true' && backup.disabled && !status.hidden && status.textContent === 'Backup wird erstellt...',
                    'Echter Jahresexport zeigt Status und hält Busy bis Exportende');
                await backup.fire('click'); assertEqual(downloads, 0, 'Busy verhindert zweiten Export während Vorflush');
                gate.resolve(); await exporting;
                assertEqual(downloads, 1, 'Bestehender Backuphaken stößt genau einen Download an');
                assert(exportBinding.root.getAttribute('aria-busy') === 'false' && status.dataset.kind === 'ok' && status.textContent.includes('Komplettes fachliches Backup erstellt'),
                    'Exportstatus bestätigt den echten Backupabschluss');
                assert(backup.parent.hidden && !status.hidden, 'Aktuelle Sicherung verbirgt Empfehlung und erhält Exportstatus');
                persistenceStorage.removeItem('overview_last_full_backup_v1'); doc.dispatchEvent(new Event('overview-backup-changed'));
                assert(!backup.parent.hidden, 'Fehlender Sicherungsbeleg blendet Empfehlung wieder ein');
                exportBinding.close(false); await pending;
            } finally { gate.resolve(); PersistenceFacade.flush = originalFlush; doc.createElement = originalCreate; setAppTestDate('2026-01-02'); }
        }
        const binderDom = domFixture();
        const headButton = node('jahresabschlussBtn');
        const otherFocus = node('otherFocus');
        binderDom.controls.jahresabschlussBtn = headButton;
        let snapshots = 0, fetches = 0, writes = 0;
        StorageManager.createSnapshot = async () => { snapshots++; throw new Error('Unerwarteter Snapshot'); };
        StorageManager.saveState = () => { writes++; };
        globalThis.fetch = async () => { fetches++; throw new Error('Unerwarteter Abruf'); };
        initUIBinder(binderDom, {}, () => { writes++; return { ok: true }; }, () => { writes++; });
        // Nur die asynchrone Vorbereitung anhalten; danach echte Manual-/Snapshot-/Modalhandler.
        const manual = preserveUIBinderStateForTests().handlers.manual;
        const withAnnual = manual.withAnnual.bind(manual);
        let preparationGate, preparationReached;
        manual.withAnnual = execute => withAnnual(async () => {
            preparationReached.resolve();
            await preparationGate.promise;
            return execute();
        });
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        for (let attempt = 0; attempt < 2; attempt++) {
            preparationGate = deferred(); preparationReached = deferred();
            // Klick ohne vorherigen Buttonfokus sowie direkter Handler mit Fokus-Rückfall.
            doc.activeElement = attempt === 0 ? otherFocus : headButton;
            const event = { currentTarget: headButton, isTrusted: true };
            const opening = UIBinder.handleJahresabschluss(attempt === 0 ? event : undefined);
            event.currentTarget = null;
            await preparationReached.promise;
            otherFocus.focus();
            assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, 'Vorbereitungsbarriere liegt vor der Dialogöffnung');
            assertEqual((await UIBinder.handleJahresabschluss()).status, 'in_flight', 'Doppelter Kopfzugang bleibt während des Hinweishandlers gesperrt');
            preparationGate.resolve();
            const opened = await opening;
            assertEqual(opened.status, 'not_applicable', 'Vollständiger Kopfzugang liefert den Hinweisstatus');
            assertEqual(elements.get('modalTitle').textContent, 'Erster Jahresabschluss', 'Binder erhält den Erstjahrhinweistitel');
            assert(text(elements.get('modalResults')).includes('Erstes Planungsjahr 2026 · erster Jahresabschluss Anfang 2027'), 'Binder erhält den Erstjahrhinweistext');
            assert(!/Jahresabschluss unvollständig|Kein neuer Jahresabschluss\./.test(text(elements.get('modalResults'))), 'Kein synthetischer Abschlussfehler');
            assert(elements.get('annualConfirmBtn').hidden && !elements.get('annualHandPriceGroup'), 'Kopfzugang bietet keinen Abschluss und Handkurs');
            await elements.get('modalCloseBtn').fire('click');
            assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, 'Vollständiger Kopfzugang schließt den Dialog');
            assertEqual(doc.activeElement, headButton, 'Vollständiger Kopfzugang gibt Fokus trotz asynchroner Änderung an #jahresabschlussBtn zurück');
            assert(!doc.activeElement?.closest('dialog') && !headButton.disabled, 'Fokus liegt außerhalb des geschlossenen Dialogs auf freigegebenem Kopfknopf');
            assertEqual(guard.reasons().length, 0, 'Erstjahrende gibt sämtliche Laufzeitsperren frei');
            assertEqual(state.annualPeriodMetadata.pendingCommit, null, 'Erstjahr bleibt ohne Periodencommit');
        }
        assertEqual(snapshots + fetches + writes, 0, 'Kopfzugang erzeugt keine Snapshots, Abrufe, Inflation, Rollover oder Fachwrites');
        assertEqual(errors.length, 0, 'Kopfzugang setzt keinen Fehlerstatus');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Kopfzugang erhält sämtliche Speicherbytes');
        // Ein Ausgaben-Ansichtsjahr ist kein Abschlussgate mehr; Dienstprüfung in annual-coordinator.test.mjs.
        state.annualPeriodMetadata.pendingCommit = null;
        setAppTestDate(previous.testDate);
        for (const path of ['modalCloseBtn', 'x', 'Escape']) {
            const gate = deferred();
            doc.activeElement = elements.get('opener');
            const running = lifecycle.run({}, async operation => { operation.commit(); await gate.promise; });
            handlers.handleShowUpdateLog();
            const close = () => path === 'Escape'
                ? emit('keydown', { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} })
                : elements.get(path).fire('click');
            await close();
            assertEqual(doc.getElementById('balanceAnnualClose').open, true, `${path}: aktiver Commit hält Jahresdialog offen`);
            assert(doc.getElementById('balanceAnnualClose').contains(doc.activeElement), `${path}: Fokus bleibt im Jahresdialog`);
            await emit('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
            assert(doc.getElementById('balanceAnnualClose').contains(doc.activeElement), `${path}: Shift+Tab hält Fokusfalle`);
            for (const key of ['j', 'e', 'i', 'J', 'E', 'I']) {
                let prevented = false;
                UIBinder.handleKeyboardShortcuts({ altKey: true, key, preventDefault() { prevented = true; } });
                assert(prevented, `${path}: Alt+${key} startet keine Aktion im Commit`);
            }
            gate.resolve(); await running;
            assertEqual(guard.reasons().length, 0, `${path}: Anzeigeprotokoll meldet keinen Eingabeverlust`);
            await close();
            assertEqual(Boolean(doc.getElementById('balanceAnnualClose')), false, `${path}: nach Ende wieder schließbar`);
            assertEqual(doc.activeElement.id, 'opener', `${path}: Fokus kehrt zum Auslöser zurück`);
            assert(!doc.getElementById('balanceAnnualClose'), `${path}: Host und Komponentenlistener entfernt`);
        }

    }
} finally {
    restoreLocks();
    StorageManager.loadState = previous.load; StorageManager.saveState = previous.save;
    StorageManager.createSnapshot = previous.create; StorageManager.renderSnapshots = previous.render;
    SnapshotArchive.listSnapshots = previous.list; SnapshotArchive.readSnapshot = previous.read;
    UIRenderer.toast = previous.toast; UIRenderer.clearActionError = previous.clear; UIRenderer.handleActionError = previous.error;
    if (previous.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = previous.fetch;
    PersistenceFacade.flush = previous.flush;
    if (previous.confirm === undefined) delete globalThis.confirm; else globalThis.confirm = previous.confirm;
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.localStorage;
    setAppTestDate(previous.testDate);
    previous.restoreBinder();
    resetPersistenceRuntimeForTests();
}
