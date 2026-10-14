import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, PLAN_DEFAULTS, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { createAnnualHandlers } from '../app/balance/balance-binder-annual.js';
import { createAnnualNavigationLifecycle } from '../app/balance/balance-annual-orchestrator.js';
import { createBalanceWealthHistoryService } from '../app/balance/balance-wealth-history.js';
import { createAnnualMonthSession } from '../app/balance/balance-close-coordinator.js';
import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { loadProfilverbundProfiles, aggregateProfilverbundInputs } from '../app/profile/profilverbund-balance.js';
import { EngineAPI } from '../engine/index.mjs';
import { calculateExpensesBudget } from '../app/balance/balance-update-pipeline.js';
import { formatDisplayNumber } from '../app/shared/designsystem-number-format.js';
import { projectOverview, buildBalanceOverviewSummary } from '../app/overview/overview-model.js';
import { storeOverviewSummary, readMonthProvision, OVERVIEW_MONTH_KEY, OVERVIEW_SUMMARY_KEY, overviewScope, OVERVIEW_BACKUP_KEY } from '../app/overview/overview-storage.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { DATA_BACKUP_SUMMARY_KEY, assertBackupSummary } from '../app/data/data-backup-summary.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';

const old = { doc: globalThis.document, win: globalThis.window, fetch: globalThis.fetch, timeout: globalThis.setTimeout,
    confirm: globalThis.confirm, location: globalThis.location,
    date: getAppTestDate(), toast: UIRenderer.toast, clear: UIRenderer.clearActionError, error: UIRenderer.handleActionError,
    render: StorageManager.renderSnapshots, flush: P.flush };
const restoreLocks = installAnnualLocks();
try {
    UIRenderer.toast = () => {}; UIRenderer.clearActionError = () => {}; UIRenderer.handleActionError = error => { throw error; };
    StorageManager.renderSnapshots = async () => {};
    // Nur Animationstimer werden im DOM-freien Workflow ausgelassen.
    globalThis.setTimeout = fn => { fn(); return 0; };
    globalThis.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };
    for (const failure of ['none', 'unchanged', 'flush', 'snapshot', 'replace', 'rollback', 'late']) {
        const date = failure === 'late' ? '2027-03-02' : '2027-01-02'; setAppTestDate(date);
        const { doc } = createDialogFixture(); globalThis.document = doc; globalThis.window = { document: doc };
        const backend = new Map(), snapshots = new Map();
        const writes = [];
        let commitResult, fixedIncomeAnnual;
        let armed = false, sawMonth = false, corrupt = false, failed = false, annualUpdates = 0;
        let backupReadGate = null, backupReading = false, failDownload = false, downloads = 0;
        const adapter = { name: 'year-month-durable', async open() {}, async loadAll() {
            if (backupReadGate) { backupReading = true; await backupReadGate; }
            const records = Object.fromEntries(backend);
            if (corrupt) { corrupt = false; records[OVERVIEW_MONTH_KEY] = '{}'; }
            return records;
        }, async saveBatch({ deletes, upserts }) {
            writes.push({ deletes: [...deletes], upserts: structuredClone(upserts) });
            const monthWrite = upserts.some(([key, raw]) => key === OVERVIEW_MONTH_KEY && raw);
            if (armed && failure === 'rollback' && sawMonth && !monthWrite) throw new Error('ROLLBACK_INJECTED');
            if (armed && failure === 'replace' && monthWrite && !failed) { failed = true; throw new Error('REPLACE_INJECTED'); }
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, raw]) => backend.set(key, raw));
            if (armed && failure === 'rollback' && monthWrite && !failed) { failed = true; sawMonth = true; corrupt = true; }
        }, async listSnapshots() { return [...snapshots.values()]; }, async readSnapshot(id) {
            const snapshot = structuredClone(snapshots.get(id));
            if (armed && failure === 'snapshot' && snapshot?.label.startsWith('Monatsabschluss') && !failed) {
                failed = true; snapshot.records.profile_tagesgeld = '1';
            }
            return snapshot;
        }, async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); }, async deleteSnapshot(id) { snapshots.delete(id); } };
        P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const meta = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
        const state = { inputs: { floorBedarf: 10000, flexBedarf: 5000 }, lastState: { cumulativeInflationFactor: 1 }, annualPeriodMetadata: meta, wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry({ tagesgeld: 100000, geldmarktEtf: 20000, depotwertAlt: 30000, depotwertNeu: 40000 }, '2026-01-01')] } };
        const person = (name, birth, pension, start) => ({ meta: { id: name, name, belongsToHousehold: true }, data: {
            profile_person_schema_version: '1', profile_geburtsdatum: birth, profile_aktuelles_alter: '67',
            profile_rentenbeginn: start, profile_rente_monatlich: String(pension), profile_tagesgeld: '50000',
            depot_tranchen: '[]', [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state)
        } });
        const registry = { version: 1, profiles: { Max: person('Max', '1958-03-14', 1600, '2027-07-01'), Erika: person('Erika', '1960-01-01', 1200, '2020-01-01') } };
        const partnerState = { ...state }; delete partnerState.annualPeriodMetadata; registry.profiles.Erika.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(partnerState);
        for (const [key, raw] of Object.entries({ rs_current_profile: 'Max', rs_active_profile: 'Max', rs_profiles_v1: JSON.stringify(registry), ...registry.profiles.Max.data })) storage.setItem(key, raw);
        const planScope = overviewScope('household', ['Max', 'Erika']);
        storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, [{ scope: planScope, values: {
            ...structuredClone(PLAN_DEFAULTS), floorBedarf: 10000, flexBedarf: 5000, minimumFlexAnnual: 1000,
            flexBudgetAnnual: 5000, flexBudgetRecharge: 2000, cape: { value: 28, asOf: null, source: null }
        } }]).raw);
        storage.setItem('balance_expenses_v1', JSON.stringify({ version: 1, activeYear: 2026, years: {} }));
        await P.flush();
        const guard = createNavigationGuard(), lifecycle = createAnnualNavigationLifecycle({ guard, flush: () => P.flush() });
        const scope = overviewScope('household', ['Max', 'Erika']);
        const inputs = Object.fromEntries(Object.entries({ profilName: 'Max + Erika', floorBedarf: '10.000', flexBedarf: '5.000',
            minimumFlexAnnual: '1000', flexBudgetAnnual: '5000', flexBudgetRecharge: '2000', aktuellesAlter: '67', inflation: '2.5',
            endeVJ: '120', endeVJ_1: '110', endeVJ_2: '100', endeVJ_3: '90', ath: '150', jahreSeitAth: '1', marketCapeRatio: '28', capeRatio: '28' }).map(([id, value]) => [id, { value }]));
        const dom = { inputs, outputs: {}, controls: { btnJahresUpdate: { innerHTML: 'Jahresupdate' } } };
        const annual = createAnnualHandlers({ dom, appState: {}, update: () => ({ ok: true }), debouncedUpdate() {},
            getLastUpdateResults: () => null, setLastUpdateResults() {}, navigationLifecycle: lifecycle });
        const packageData = { inflation: await annual.prepareInflation({ targetYear: 2026 }),
            etf: await annual.prepareETF({ targetYear: 2026 }), cape: await annual.prepareCape({ targetYear: 2026 }) };
        const preview = projectAnnualPreview({ targetYear: 2026, inputs, inflation: packageData.inflation });
        const cash = { people: captureCashPeople({ ids: scope.ids, activeId: 'Max' }),
            values: failure === 'unchanged' ? { Max: 50000, Erika: 50000 } : { Max: 45000.125, Erika: 40000.25 } };
        const wealth = createBalanceWealthHistoryService({ guard });
        const handlers = createSnapshotHandlers({ engineLoader: { load: async () => EngineAPI }, confirmAnnual: async () => ({}), decide: async () => true, dom, appState: {}, wealthHistory: wealth, navigationLifecycle: lifecycle,
            runAnnualUpdate: async options => { annualUpdates++; return annual.prepareAnnualUpdate(options); },
            applyAnnualInflation: annual.applyAnnualInflation, validateLiveState: () => ({ ok: true }),
            rollExpensesYearFn: () => 2027,
            flushLiveState: async () => { if (await P.flush() === false) throw new Error('FLUSH_FAILED'); },
            commitLiveState: async options => {
                const committed = await commitAnnualPlanUpdate({ ...options, engineApi: EngineAPI, now: () => new Date(`${date}T11:00:00Z`) });
                commitResult = committed.result;
                fixedIncomeAnnual = Math.round(commitResult.inputData.renteMonatlich * 12);
                return committed;
            },
            projectAnnualState: () => {
                const plan = readBalanceHouseholdPlan();
                for (const key of ['floorBedarf', 'flexBedarf']) inputs[key].value = UIUtils.formatNumber(plan.entry.values[key]);
            } });
        const beforeYear = await P.readPersistedRecords();
        const beforeCashHistory = Object.fromEntries(scope.ids.map(id => [id, id === 'Max'
            ? beforeYear.profile_cash_history_v1 : JSON.parse(beforeYear.rs_profiles_v1).profiles[id].data.profile_cash_history_v1]));
        const result = await handlers.handleJahresabschluss({ confirmedPreparation: { cash, preparedMarketData: packageData } });
        assertEqual(result.status, 'already_committed', failure + ': echter Jahresworkflow finalisiert');
        assert(!guard.reasons().some(reason => reason.phase === 'commit'), 'Jahreslease vor Monatsphase freigegeben');
        const readModel = () => projectOverview({ registry: JSON.parse(storage.getItem('rs_profiles_v1')), activeId: 'Max', liveData: P.exportAllSync().records });
        const session = await createAnnualMonthSession({ targetYear: 2026, annualSnapshotId: result.snapshotId, cash, readModel, guard,
            readPending: () => StorageManager.loadState().annualPeriodMetadata.pendingCommit,
            confirmSummary: () => storeOverviewSummary(buildBalanceOverviewSummary({ modelResult: commitResult.modelResult,
                monthlyBudget: calculateExpensesBudget({ fixedIncomeAnnual, monthlyWithdrawal: commitResult.modelResult.ui.spending.monatlicheEntnahme }).monthlyBudget,
                metadata: StorageManager.loadState().annualPeriodMetadata, scope }), { expectedProfileId: 'Max', guard }) });
        assertEqual(session.model.summary.monthlyWithdrawal, commitResult.modelResult.ui.spending.monatlicheEntnahme, 'Verbindlicher Monatsbetrag stammt aus realem Jahresergebnis');
        assertEqual(session.request.month, failure === 'late' ? '2027-02' : '2026-12', 'Tatsächlicher Vormonat wird gespeichert');
        const afterYear = await P.readPersistedRecords(), yearState = JSON.parse(afterYear[CONFIG.STORAGE.LS_KEY]);
        if (failure === 'unchanged') for (const id of scope.ids) {
            const data = id === 'Max' ? afterYear : JSON.parse(afterYear.rs_profiles_v1).profiles[id].data;
            assertEqual(data.profile_cash_history_v1, beforeCashHistory[id], id + ': unveränderter Cash erzeugt auch im Jahresteil keinen Historieneintrag');
            assertEqual(JSON.parse(data.profile_cash_history_v1 || '{"entries":[]}').entries.length, 0, id + ': nach dem Jahresteil weiterhin keine Cashhistorieneinträge');
        }
        assertEqual(yearState.wealthHistory.entries.filter(entry => entry.id === 'annual:2026').length, 1, 'Genau ein Jahresend-Vermögenspunkt');
        assertEqual(yearState.wealthHistory.entries.find(entry => entry.id === 'annual:2026').tagesgeld, cash.values.Max + cash.values.Erika, 'Jahrespunkt verwendet eingegebene Cashsumme');
        assertEqual(yearState.annualPeriodMetadata.lastCommittedPeriod, 'calendar-year:2026', 'Genau ein Jahresmarker');
        assertEqual(yearState.annualPeriodMetadata.pendingCommit, null, 'Keine ausstehende Jahresphase');
        assertEqual(snapshots.size, 1, 'Vor Monatsbestätigung genau ein Jahressnapshot');
        const household = loadProfilverbundProfiles();
        const actual = aggregateProfilverbundInputs(household, { floorBedarf: UIUtils.parseCurrency(inputs.floorBedarf.value), flexBedarf: UIUtils.parseCurrency(inputs.flexBedarf.value) });
        assertEqual(preview.needs.find(need => need.id === 'floorBedarf').after, actual.totalFloor, 'Verbindlicher Floor entspricht Jahrespfad');
        for (const person of preview.people) {
            assertEqual(person.startAlter, household.find(row => row.profileId === person.id).inputs.aktuellesAlter, person.name + ': Januaralter entspricht Jahrespfad');
            assertEqual(person.budgetPensionMonthly, household.find(row => row.profileId === person.id).inputs.renteMonatlich, person.name + ': Rente entspricht Jahrespfad');
        }
        // Derselbe Vorbereitungs-Host erhält den internen Backup-Binder; der Vorabhinweis bleibt nach dem Jahr verborgen.
        let displayResult, binding, receipt, error, monthSaves = 0;
        const modal = createAnnualModalHandlers({ dom, getLastUpdateResults: () => displayResult, isCommitActive: () => false });
        const preparation = modal.showAnnualPreparation({ targetYear: 2026, model: session.model,
            people: session.request.cash.people.map(person => ({ ...person, value: cash.values[person.id] })),
            onReady: handle => { binding = handle; } });
        binding.updateMarketData({ values: packageData, errors: {} });
        const confirm = doc.getElementById('annualConfirmBtn'), resultHost = doc.getElementById('balanceAnnualClose');
        await prepareCloseFixture(doc);
        assert(!confirm.disabled, 'Vollständige Marktdaten und gültiges Tagesgeld aller Personen geben echte Vorbereitung frei');
        await confirm.fire('click'); await preparation;
        displayResult = { ...result.results, monthSession: session, confirmed: true };
        modal.showUpdateResultModal(displayResult);
        assert(doc.getElementById('balanceAnnualClose') === resultHost, 'Monatsphase erhält Vorbereitungs-Host mit Backup-Listener');
        const save = session.save.bind(session);
        session.save = async () => {
            monthSaves++;
            try { receipt = await save(); return receipt; } catch (caught) { error = caught; throw caught; }
        };
        const create = doc.createElement;
        doc.createElement = tag => {
            const element = create(tag);
            if (tag === 'a') element.click = () => { downloads++; if (failDownload) throw new Error('DOWNLOAD_INJECTED'); };
            return element;
        };
        const verifyBackup = async (phase, outcome) => {
            const previousBasis = storage.getItem(DATA_BACKUP_SUMMARY_KEY);
            const previousBackup = storage.getItem(OVERVIEW_BACKUP_KEY);
            if (session.phase !== 'recovery') { storage.removeItem(OVERVIEW_BACKUP_KEY); await P.flush(); }
            setAppTestDate(null); doc.dispatchEvent(new Event('overview-backup-changed'));
            const backup = resultHost.querySelector('[data-overview-backup]'), status = resultHost.querySelector('[data-annual-backup-status]');
            assert(backup.parent.hidden, phase + ': Vorab-Sicherungsempfehlung bleibt auch nach Refresh verborgen');
            const before = Object.fromEntries(backend), snapshotBytes = JSON.stringify([...snapshots]), saves = monthSaves, count = downloads;
            const text = confirm.textContent, disabled = confirm.disabled;
            const dialogStatus = resultHost.querySelector('[data-close-dialog-footer]').querySelectorAll('.close-dialog-status').find(node => node.getAttribute('role') === 'status').textContent;
            assertEqual(disabled, phase === 'recovery', phase + ': phasengültiger Ausgangszustand');
            assertEqual(text, phase === 'C' ? 'Fertig' : 'Erneut versuchen', phase + ': phasengültiger Knopftext');
            failDownload = outcome === 'error' && phase !== 'recovery'; backupReading = false;
            let release; backupReadGate = new Promise(resolve => { release = resolve; });
            try {
                // Den erhaltenen Binder direkt auslösen, um Export-/Recoverygrenzen unabhängig von der verborgenen Empfehlung zu prüfen.
                const exporting = backup.fire('click');
                for (let turn = 0; turn < 100 && !backupReading; turn++) await Promise.resolve();
                assert(backupReading && resultHost.getAttribute('aria-busy') === 'true' && confirm.disabled, phase + ': laufender Backup sperrt Bestätigung');
                await confirm.fire('click');
                release(); backupReadGate = null; await exporting;
                assertEqual(confirm.disabled, disabled, phase + ': Backupende erhält phasengültige Sperre');
                assertEqual(confirm.textContent, text, phase + ': Backupende erhält Knopftext');
                assert(!confirm.hidden && resultHost.open, phase + ': Knopf und Host bleiben sichtbar');
                assertEqual(monthSaves, saves, phase + ': Backup startet keinen Monats-Save');
                assertEqual(JSON.stringify([...snapshots]), snapshotBytes, phase + ': sämtliche Snapshots bytegleich');
                assertEqual(resultHost.querySelector('[data-close-dialog-footer]').querySelectorAll('.close-dialog-status').find(node => node.getAttribute('role') === 'status').textContent, dialogStatus, phase + ': Monats-/Recoveryhinweis bleibt erhalten');
                const after = Object.fromEntries(backend);
                if (outcome === 'success') {
                    assertEqual(status.dataset.kind, 'ok', phase + ': Export bestätigt Erfolg');
                    assert(after[OVERVIEW_BACKUP_KEY] && backup.parent.hidden, phase + ': Sicherungsbeleg aktualisiert Empfehlung');
                    const basis = JSON.parse(after[DATA_BACKUP_SUMMARY_KEY]);
                    assertBackupSummary(basis);
                    assertEqual(basis.exportedAt, after[OVERVIEW_BACKUP_KEY], phase + ': Vergleichsbasis und Sicherungszeit sind gemeinsam bestätigt');
                    assertEqual(downloads, count + 1, phase + ': eine Dateiausgabe');
                } else {
                    assertEqual(status.dataset.kind, 'error', phase + ': Exportfehler sichtbar');
                    assert(!status.hidden && backup.parent.hidden, phase + ': interner Export meldet Fehler ohne die alte Vorabempfehlung einzublenden');
                    if (phase !== 'recovery') assert(status.textContent.includes('DOWNLOAD_INJECTED'), phase + ': kontrollierter Dateiausgabefehler');
                    else {
                        assert(P.hasSyncWriteBlocks(), 'Backup erhält echte Recovery-Schreibsperre');
                        assert(status.textContent.includes('Sicherungszeit und Vergleichsbasis konnten nicht dauerhaft bestätigt werden'), 'Echte Recovery-Schreibsperre verhindert Backupbestätigung nach Dateiausgabe');
                    }
                    assertEqual(JSON.stringify(after), JSON.stringify(before), phase + ': Fehler setzt keinen Erfolgsbeleg');
                }
                delete before[OVERVIEW_BACKUP_KEY]; delete after[OVERVIEW_BACKUP_KEY];
                delete before[DATA_BACKUP_SUMMARY_KEY]; delete after[DATA_BACKUP_SUMMARY_KEY];
                assertEqual(JSON.stringify(after), JSON.stringify(before), phase + ': Export erhält alle Fachrecords');
                if (phase === 'C') assert(resultHost.querySelector('[data-annual-combined-result="C"]'), 'Backup erhält Ergebnis C');
            } finally {
                release(); backupReadGate = null; setAppTestDate(date);
                // Testaufbau zurücksetzen, damit der folgende Monatsretry denselben Quellstand prüft.
                if (session.phase !== 'recovery') {
                    if (previousBackup === null) storage.removeItem(OVERVIEW_BACKUP_KEY);
                    else storage.setItem(OVERVIEW_BACKUP_KEY, previousBackup);
                    if (previousBasis === null) storage.removeItem(DATA_BACKUP_SUMMARY_KEY);
                    else storage.setItem(DATA_BACKUP_SUMMARY_KEY, previousBasis);
                    await P.flush(); doc.dispatchEvent(new Event('overview-backup-changed'));
                }
            }
        };
        for (const outcome of ['error', 'success']) await verifyBackup('month', outcome);
        armed = true;
        if (failure === 'flush') P.flush = async () => false;
        await confirm.fire('click');
        P.flush = old.flush;
        if (['flush', 'snapshot', 'replace', 'rollback'].includes(failure)) {
            assert(error && !receipt, failure + ': Monatsfehler bestätigt keinen Erfolg');
            const records = await P.readPersistedRecords();
            assertEqual(records[CONFIG.STORAGE.LS_KEY], afterYear[CONFIG.STORAGE.LS_KEY], failure + ': Jahresmarker und Jahresendstand bytegleich');
            assertEqual(records[OVERVIEW_SUMMARY_KEY], afterYear[OVERVIEW_SUMMARY_KEY], failure + ': neuer Plan bleibt bytegleich');
            if (failure === 'rollback') {
                assertEqual(session.phase, 'recovery', 'Rollbackfehler sperrt normalen Retry');
                assert(P.hasSyncWriteBlocks(), 'Rollbackfehler erhält Persistenzschreibsperre');
                assert(resultHost.querySelector('[data-close-dialog-footer]').querySelectorAll('.close-dialog-status').find(node => node.getAttribute('role') === 'status').textContent.includes('Wiederherstellung erforderlich'), 'Adapter meldet echte Monatsrecovery');
                await verifyBackup('recovery', 'error');
                assertEqual(await session.save(), false, 'Recovery startet keinen zweiten Writer');
                let blocked = false; try { storage.setItem('profile_tagesgeld', '1'); } catch { blocked = true; }
                assert(blocked, 'Rollbackfehler sperrt auch direkte veraltete Eingabewrites');
                armed = false;
                const recovery = globalThis.window.__balanceMonthRecovery;
                const monthSnapshot = await SnapshotArchive.readSnapshot(recovery.snapshotId);
                assertEqual(monthSnapshot.label, `Monatsabschluss ${session.request.month}`, 'Recovery verweist auf echten Monatswiederherstellungspunkt');
                assert(!Object.hasOwn(monthSnapshot.records, OVERVIEW_MONTH_KEY), 'Erster Monatsabschluss hat im Snapshot noch keinen aktiven Monatsrecord');
                assert(readMonthProvision(records[OVERVIEW_MONTH_KEY], session.request.month, scope), 'Fehlgeschlagener Rollback hinterlässt aktiven Monatsmarker vor Restore');
                const actionErrors = [], writesBeforeRestore = writes.length;
                globalThis.confirm = () => true;
                globalThis.location = { reload() { throw new Error('RELOAD_INJECTED'); } };
                UIRenderer.handleActionError = error => { actionErrors.push(error); };
                const restoreEvent = key => ({ target: { closest: selector => selector === '.restore-snapshot' ? { dataset: { key } } : null } });
                try {
                    await handlers.handleSnapshotActions(restoreEvent(result.snapshotId));
                    assertEqual(actionErrors.length, 1, 'Restoreknopf weist echten Jahressnapshot während Monatsrecovery ab');
                    assert(actionErrors[0].context.originalError.message.includes('fehlgeschlagenen Monatsabschlusses'), 'Fremder Snapshotschlüssel erhält passenden Ablehnungsgrund');
                    assertEqual(writes.length, writesBeforeRestore, 'Abgewiesener Snapshot löst keinen Backendwrite aus');
                    assertEqual(JSON.stringify(await P.readPersistedRecords()), JSON.stringify(records), 'Abgewiesener Snapshot lässt sämtliche Records unverändert');
                    assert(P.hasSyncWriteBlocks(), 'Abgewiesener Snapshot erhält Schreibsperre');
                    const uiRestored = await handlers.handleSnapshotActions(restoreEvent(monthSnapshot.id));
                    assertEqual(uiRestored.status, 'reload_required', 'Restoreknopf akzeptiert echten Monatssnapshotschlüssel und führt geschützten Restore aus');
                    assert(writes.slice(writesBeforeRestore).some(write => write.deletes.includes(OVERVIEW_MONTH_KEY)), 'Monatsrestore löscht fehlenden Snapshotrecord ausdrücklich im Backend');
                    assertEqual(actionErrors.length, 2, 'Restoreknopf meldet weiterhin erforderlichen Reload');
                    assert(actionErrors[1].message.includes('bitte die Seite neu laden'), 'Erfolgreicher Monatsrestore weist auf gesperrte veraltete Oberfläche hin');
                } finally {
                    globalThis.confirm = old.confirm; globalThis.location = old.location;
                    UIRenderer.handleActionError = error => { throw error; };
                }
                const restored = await globalThis.window.__balanceMonthRecovery.restore({ reload: () => { throw new Error('RELOAD_INJECTED'); } });
                assertEqual(restored.status, 'reload_required', 'Geschützter Monatsrestore wartet auf Reload');
                const restoredRecords = await P.readPersistedRecords();
                assertEqual(restoredRecords.rs_profiles_v1, afterYear.rs_profiles_v1, 'Monatsrestore nimmt sämtliche Haushaltsmarker zurück');
                assertEqual(restoredRecords[OVERVIEW_MONTH_KEY], afterYear[OVERVIEW_MONTH_KEY], 'Monatsrestore setzt aktiven Monatsrecord auf den Snapshotzustand zurück');
                assert(!Object.hasOwn(restoredRecords, OVERVIEW_MONTH_KEY), 'Fehlender aktiver Monatsrecord bleibt auch im Backend fehlend');
                assertEqual(storage.getItem(OVERVIEW_MONTH_KEY), null, 'Fehlender aktiver Monatsrecord bleibt auch im Cache fehlend');
                for (const id of scope.ids) {
                    const data = id === 'Max' ? restoredRecords : JSON.parse(restoredRecords.rs_profiles_v1).profiles[id].data;
                    assert(!readMonthProvision(data[OVERVIEW_MONTH_KEY], session.request.month, scope), id + ': Monatsmarker nach Restore nicht mehr bestätigt');
                }
                assertEqual(restoredRecords[CONFIG.STORAGE.LS_KEY], afterYear[CONFIG.STORAGE.LS_KEY], 'Monatsrestore erhält bestätigtes Jahr');
                assert(P.hasSyncWriteBlocks(), 'Nach Restore ohne Reload bleibt veraltete Oberfläche gesperrt');
                continue;
            }
            const reloaded = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: 'Max', liveData: records });
            assertEqual(reloaded.occasion.kind, 'monthly', 'Dauerhafter Monatsfehler bleibt nach Reload monatlicher Anlass');
            assertEqual(reloaded.occasion.annualState, 'done', 'Dauerhafter Jahresmarker bleibt nach Reload bestätigt');
            assertEqual(readModel().occasion.kind, 'monthly', 'Teilfehler bleibt Monatsanlass');
            assertEqual(readModel().occasion.annualState, 'done', 'Teilfehler bleibt jahresbestätigt');
            for (const outcome of ['error', 'success']) await verifyBackup('retry', outcome);
            await confirm.fire('click');
        }
        assert(receipt && receipt.annualSnapshotId !== receipt.monthSnapshotId, 'Zwei getrennte Belege für Ergebnis C');
        assertEqual(annualUpdates, 1, 'Normaler Monatsretry wiederholt keinen Jahresworkflow');
        assertEqual(snapshots.size, 2, 'Genau zwei Wiederherstellungspunkte auch nach Retry');
        const monthSnapshot = await SnapshotArchive.readSnapshot(receipt.monthSnapshotId);
        assertEqual(JSON.parse(monthSnapshot.records[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata.lastCommittedPeriod, 'calendar-year:2026', 'Monatssicherung enthält abgeschlossenen Jahresstand');
        const records = await P.readPersistedRecords(), profiles = JSON.parse(records.rs_profiles_v1).profiles;
        for (const id of scope.ids) {
            const data = id === 'Max' ? records : profiles[id].data;
            assert(readMonthProvision(data[OVERVIEW_MONTH_KEY], session.request.month, scope), id + ': genau ein bestätigter Vormonatsmarker');
            assertEqual(Object.keys(JSON.parse(data[OVERVIEW_MONTH_KEY]).entries).length, 1, id + ': keine Markerduplikate');
            assertEqual(Number(data.profile_tagesgeld), cash.values[id], id + ': identischer Jahres-/Monatscash');
            assertEqual(data.profile_cash_history_v1, id === 'Max' ? afterYear.profile_cash_history_v1 : JSON.parse(afterYear.rs_profiles_v1).profiles[id].data.profile_cash_history_v1, id + ': kein zusätzlicher Cashhistorieneintrag im Monat');
            if (failure !== 'unchanged') assertEqual(JSON.parse(data.profile_cash_history_v1).entries.length, 1, id + ': einmaliger Cashbeleg für Änderung');
            else {
                assertEqual(data.profile_cash_history_v1, beforeCashHistory[id], id + ': unveränderter Cash bleibt auch nach dem Monatsteil bytegleich zum Stand vor dem Jahr');
                assertEqual(JSON.parse(data.profile_cash_history_v1 || '{"entries":[]}').entries.length, 0, id + ': nach dem Monatsteil weiterhin keine Cashhistorieneinträge');
            }
        }
        assertEqual(readModel().occasion.kind, 'play', 'Beiderseitiger Erfolg erreicht ruhigen Anlass');
        for (const outcome of ['error', 'success']) await verifyBackup('C', outcome);
        const beforeDone = JSON.stringify(await P.readPersistedRecords()), savesBeforeDone = monthSaves;
        const annualBody = doc.getElementById('annualResults');
        for (let click = 0; click < 2; click++) {
            await doc.getElementById('annualShowLog').fire('click');
            assert(doc.getElementById('annualResults') === annualBody && !annualBody.parent.hidden, 'Protokoll in C bleibt sichtbar ohne Ergebnisneuaufbau');
            assertEqual(JSON.stringify(await P.readPersistedRecords()), beforeDone, 'Protokoll in C erhält alle Jahres-/Monatsrecords und Cashwerte');
            assertEqual(snapshots.size, 2, 'Protokoll in C erzeugt keinen weiteren Snapshot');
        }
        const text = dialogElements(doc.getElementById('balanceAnnualClose')).map(node => node.textContent).join(' ');
        assert(text.includes('Max') && text.includes('Erika') && text.includes(formatDisplayNumber(session.model.summary.monthlyWithdrawal, { unit: 'currency', fractionDigits: 2 })) && text.includes(formatDisplayNumber(session.model.summary.monthlyBudget, { unit: 'currency', fractionDigits: 2 })), 'Ergebnis C nennt Haushalt und bestätigte Planwerte');
        await doc.getElementById('annualConfirmBtn').fire('click');
        assertEqual(monthSaves, savesBeforeDone, 'Fertig startet keinen erneuten Monats-Save');
        assert(!resultHost.open, 'Fertig schließt bestehenden Host');
        assertEqual(JSON.stringify(await P.readPersistedRecords()), beforeDone, 'Fertig erzeugt keinen Fachwrite');
        P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        assertEqual(readModel().occasion.kind, 'play', 'Reload bestätigt ruhigen Anlass mit dauerhaftem Monat');
    }
} finally {
    globalThis.document = old.doc; globalThis.window = old.win; globalThis.fetch = old.fetch; globalThis.setTimeout = old.timeout;
    globalThis.confirm = old.confirm; globalThis.location = old.location;
    setAppTestDate(old.date); UIRenderer.toast = old.toast; UIRenderer.clearActionError = old.clear; UIRenderer.handleActionError = old.error;
    StorageManager.renderSnapshots = old.render; P.flush = old.flush; P.resetPersistenceRuntimeForTests();
}

// Vollbackup im echten Jahresadapter, mit kontrollierter Dateiausgabegrenze.
try {
    setAppTestDate(null);
    for (const receipt of [null, 'ungültig', 8, 7, 1]) {
        const { doc } = createDialogFixture(); globalThis.document = doc; globalThis.window = { document: doc };
        const records = new Map([['profile_tagesgeld', '18000']]);
        if (receipt !== null) records.set(OVERVIEW_BACKUP_KEY, typeof receipt === 'number' ? new Date(Date.now() - receipt * 86400000 + 1000).toISOString() : receipt);
        let writes = 0, downloads = 0, failDownload = false, readGate = null, reading = false;
        const adapter = { async open() {}, async loadAll() { if (readGate) { reading = true; await readGate; } return Object.fromEntries(records); }, async readAll() { return Object.fromEntries(records); },
            async saveBatch({ upserts, deletes }) { writes++; deletes.forEach(key => records.delete(key)); upserts.forEach(([key, value]) => records.set(key, value)); } };
        P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const create = doc.createElement;
        doc.createElement = tag => {
            const element = create(tag);
            if (tag === 'a') element.click = () => {
                downloads++;
                assert(!records.has(OVERVIEW_BACKUP_KEY) || records.get(OVERVIEW_BACKUP_KEY) === 'ungültig' || Date.parse(records.get(OVERVIEW_BACKUP_KEY)) < Date.now() - 7 * 86400000, 'Sicherungsbeleg wird erst nach der Dateiausgabe geschrieben');
                if (failDownload) throw new Error('DOWNLOAD_INJECTED');
            };
            return element;
        };
        const modal = createAnnualModalHandlers({ getLastUpdateResults: () => null, isCommitActive: () => false });
        let binding;
        const pending = modal.showAnnualPreparation({ targetYear: 2025, people: [{ id: 'a', name: 'A', value: 18000 }],
            model: { occasion: { previousYear: 2025, previousMonth: 12 } }, onReady: handle => { binding = handle; } });
        const root = doc.getElementById('balanceAnnualClose'), backup = root.querySelector('[data-overview-backup]');
        const recommended = receipt === null || receipt === 'ungültig' || receipt === 8;
        assertEqual(!backup.parent.hidden, recommended, 'Jahresbackupempfehlung verwendet die bestehende Siebentagegrenze: ' + receipt);
        if (recommended) {
            const cash = root.querySelector('[data-tagesgeld-person]'); cash.value = '19.000'; await cash.fire('input');
            doc.getElementById('annualHandPrice').value = '160.4';
            const baseline = JSON.stringify(Object.fromEntries(records));
            failDownload = true;
            let releaseRead; readGate = new Promise(resolve => { releaseRead = resolve; });
            const exporting = backup.fire('click');
            for (let turn = 0; turn < 100 && !reading; turn++) await Promise.resolve();
            assert(reading && root.getAttribute('aria-busy') === 'true', 'Vollbackup bleibt bis zum vorhandenen Persistenzleserabschluss busy');
            const completeMarket = Object.fromEntries([['inflation', '2.5'], ['etf', '160'], ['cape', '28']]
                .map(([type, value]) => [type, createManualAnnualValue(type, value, 2025)]));
            binding.updateMarketData({ values: receipt === 'ungültig' ? { etf: completeMarket.etf } : completeMarket, errors: {} });
            assert(doc.getElementById('annualConfirmBtn').disabled, 'Später Marktdatenabschluss gibt während Vollbackup keine Jahresbestätigung frei');
            await doc.getElementById('annualConfirmBtn').fire('click');
            assert(root.open && root.getAttribute('aria-busy') === 'true', 'Jahresbestätigung überholt den laufenden Vollbackup nicht');
            releaseRead(); readGate = null; await exporting;
            await prepareCloseFixture(doc);
            assertEqual(doc.getElementById('annualConfirmBtn').disabled, receipt === 'ungültig', 'Nach Exportende folgen Jahrescontrols dem aktuellen vorbereiteten Stand');
            if (receipt === 'ungültig') {
                binding.updateMarketData({ values: completeMarket, errors: {} });
                assert(!doc.getElementById('annualConfirmBtn').disabled, 'Erst vollständige Marktdaten geben Vorbereitung nach Backup frei');
            }
            assertEqual(JSON.stringify(Object.fromEntries(records)), baseline, 'Fehlgeschlagene Dateiausgabe setzt keinen Erfolgsbeleg');
            assert(root.querySelector('[data-annual-backup-status]').textContent.includes('DOWNLOAD_INJECTED'), 'Vollbackupfehler bleibt im Dialog sichtbar');
            setAppTestDate('2026-01-02'); await backup.fire('click');
            assert(root.querySelector('[data-annual-backup-status]').textContent.includes('während des Probelaufs gesperrt'), 'Bestehende Probelaufsperre bleibt am Dialogknopf sichtbar');
            assertEqual(downloads, 1, 'Probelaufsperre verhindert jede Dateiausgabe');
            assertEqual(JSON.stringify(Object.fromEntries(records)), baseline, 'Probelaufsperre schreibt keinen Sicherungsbeleg');
            setAppTestDate(null); failDownload = false; await backup.fire('click');
            assertEqual(downloads, 2, 'Dialogknopf verwendet die vorhandene Vollbackup-Dateiausgabe');
            assert(records.has(OVERVIEW_BACKUP_KEY) && writes > 0, 'Erfolgreiche Dateiausgabe bestätigt vorhandenen Sicherungsbeleg dauerhaft');
            assert(backup.parent.hidden && root.querySelector('[data-annual-backup-status]').dataset.kind === 'ok', 'Bestätigter Export aktualisiert Empfehlung und lässt Erfolg sichtbar');
            assert(root.open && cash.value === '19.000' && doc.getElementById('annualHandPrice').value === '160.4', 'Export erhält Jahresdialog und Cash-/Handkursentwurf');
            assert(!records.has(CONFIG.STORAGE.LS_KEY) && !records.has(OVERVIEW_MONTH_KEY), 'Backup bestätigt weder Jahr noch Monat');
        }
        binding.close(false); await pending;
        const count = downloads; await backup.fire('click'); assertEqual(downloads, count, 'Geschlossener Backupknopf hat keinen wirksamen Listener');
    }
} finally {
    restoreLocks();
    globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date); P.resetPersistenceRuntimeForTests();
}

// Beide tatsächlichen Statusrenderer lesen dieselbe Erstjahres-/Haushaltsquelle.
{
    const { createMusterHaushaltRecords } = await import('../app/demo/muster-haushalt.js');
    const { projectOverviewFromRecords } = await import('../app/overview/overview-model.js');
    const { SummaryRenderer } = await import('../app/balance/balance-renderer-summary.js');
    try {
        for (const single of [false, true]) {
            setAppTestDate('2026-01-02');
            const records = createMusterHaushaltRecords('2026-01-02');
            const registry = JSON.parse(records.rs_profiles_v1);
            const initialState = raw => {
                const state = JSON.parse(raw || '{}');
                state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
                state.wealthHistory = { schemaVersion: 1, entries: [] };
                return JSON.stringify(state);
            };
            const expenses = JSON.parse(records.balance_expenses_v1);
            for (const year of Object.keys(expenses.years)) if (Number(year) < 2026) delete expenses.years[year];
            records.balance_expenses_v1 = JSON.stringify(expenses);
            records[CONFIG.STORAGE.LS_KEY] = initialState(records[CONFIG.STORAGE.LS_KEY]);
            for (const profile of Object.values(registry.profiles)) profile.data[CONFIG.STORAGE.LS_KEY] = initialState(profile.data[CONFIG.STORAGE.LS_KEY]);
            records.rs_profiles_v1 = JSON.stringify(registry);
            if (single) {
                for (const profile of Object.values(registry.profiles)) profile.meta.belongsToHousehold = false;
                records.rs_profiles_v1 = JSON.stringify(registry);
            }
            const backend = new Map(Object.entries(records));
            P.resetPersistenceForTests({ async open() {}, async loadAll() { return Object.fromEntries(backend); },
                async saveBatch() { throw new Error('UNEXPECTED_STATUS_WRITE'); } });
            await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const { doc } = createDialogFixture(); globalThis.document = doc; globalThis.window = { document: doc };
            const outputs = {};
            for (const id of ['balanceNextAnnualLabel', 'balanceNextAnnual', 'balanceActionFootnote', 'balanceActionDisclaimer', 'balanceBudgetChips']) {
                outputs[id] = doc.createElement(id === 'balanceNextAnnual' ? 'button' : 'div'); outputs[id].id = id; doc.body.append(outputs[id]);
            }
            const startpage = projectOverviewFromRecords({ registry, activeId: records.rs_current_profile, liveData: records, now: new Date(2026, 0, 2, 12) });
            new SummaryRenderer({ outputs, controls: { jahresabschlussBtn: { disabled: false } } }, { loadState: () => JSON.parse(records[CONFIG.STORAGE.LS_KEY]) }).renderContext();
            assertEqual(startpage.occasion.annualState, 'not_applicable', 'Erstjahrstatus auf Startseite: ' + single);
            assertEqual(outputs.balanceNextAnnualLabel.textContent, 'Erster Jahresabschluss', 'Balance bietet im Erstjahr keinen Abschluss 2025: ' + single);
            assert(outputs.balanceNextAnnual.disabled && outputs.balanceNextAnnual.hidden && outputs.balanceActionDisclaimer.textContent.includes('Anfang 2027'), 'Folgeknopf bleibt schreibfrei mit erstem Termin: ' + single);
            assertEqual(JSON.stringify(Object.fromEntries(backend)), JSON.stringify(records), 'Statusvergleich verändert keine Finanzrecords: ' + single);
        }
    } finally {
        globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date); P.resetPersistenceRuntimeForTests();
    }
}
