import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { overviewScope, storeOverviewSummary, readOverviewSummary, OVERVIEW_SUMMARY_KEY, OVERVIEW_BACKUP_KEY } from '../app/overview/overview-storage.js';
import { buildFullPersistenceBackup, downloadFullPersistenceBackup, downloadRecoveryPersistenceBackup, normalizeFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { switchProfile } from '../app/profile/profile-storage.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { OVERVIEW_MONTH_KEY, storeMonthProvision, readMonthProvision } from '../app/overview/overview-storage.js';

const backend = new Map();
const snapshots = new Map();
PersistenceFacade.resetPersistenceForTests({ name: 'overview-synthetic', async open() {}, async loadAll() { return Object.fromEntries(backend); },
    async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); return true; },
    async readSnapshot(id) { return snapshots.get(id); },
    async listSnapshots() { return [...snapshots.values()]; },
    async saveBatch({ deletes, upserts }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); } });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const data = { depot_tranchen: '[]', profile_tagesgeld: '100' };
const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'A' }, data: { ...data } }, b: { meta: { id: 'b', name: 'B' }, data: { ...data } } } };
for (const [key, value] of Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' })) persistenceStorage.setItem(key, value);
await PersistenceFacade.flush();
const scope = overviewScope('household', ['b', 'a']);
const single = overviewScope('single', ['a']);
const summary = { year: 2026, scope, monthlyWithdrawal: 1234.5, monthlyBudget: 2000, createdAt: '2026-01-02T12:00:00.000Z', status: 'vorläufig' };
const guard = createNavigationGuard();
for (const phase of ['preparing', 'cancelling']) {
    const before = persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY);
    const registryBefore = persistenceStorage.getItem('rs_profiles_v1');
    let flushes = 0;
    const owner = guard.register(Symbol('synthetic-import'), { read: () => ({ phase }) });
    assertEqual(await storeOverviewSummary({ ...summary, monthlyWithdrawal: 9999 }, {
        expectedProfileId: 'a', guard, flush: () => { flushes++; return true; }
    }), false, `${phase}: Kandidatenplan wird nicht gespeichert`);
    assertEqual(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), before, `${phase}: Live-Summary bleibt bytegleich`);
    assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryBefore, `${phase}: Profil-Summaries bleiben bytegleich`);
    assertEqual(flushes, 0, `${phase}: Kandidatenplan startet keinen Flush`);
    assertEqual(guard.reasons().length, 1, `${phase}: kein zusätzlicher Commitbesitzer`);
    owner.unregister();
}
const importCommit = guard.register(Symbol('synthetic-import-commit'), { read: () => ({ phase: 'commit' }) });
assertEqual(await storeOverviewSummary({ ...summary, year: 2028 }, { expectedProfileId: 'a', guard }), true, 'Bestätigte Import-Commitphase darf den Plan speichern');
assertEqual(guard.reasons().length, 1, 'Planabschluss erhält den äußeren Import-Commitbesitzer');
importCommit.unregister();
let finish;
const pending = storeOverviewSummary(summary, { expectedProfileId: 'a', guard, flush: () => new Promise(resolve => { finish = resolve; }) });
await Promise.resolve();
assertEqual(guard.reasons()[0].phase, 'commit', 'Summary hält Navigation bis zum Schreibabschluss');
assertEqual(pending.navigationOwner, guard.reasons()[0].owner, 'Schreibpromise benennt genau seinen eigenen Guardbesitzer');
finish(true); assertEqual(await pending, true, 'Summary bestätigt Schreibabschluss');
assertEqual(guard.reasons().length, 0, 'Summary löst nur eigenen Besitzer');
await PersistenceFacade.flush();
assertEqual(readOverviewSummary(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), 2026, scope).monthlyWithdrawal, 1234.5, 'Haushaltsplan liest genau einen Betrag');
assertEqual(readOverviewSummary(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), 2026, single), null, 'Haushaltsstand täuscht keinen Einzelstand vor');
await storeOverviewSummary({ ...summary, scope: single, monthlyWithdrawal: 500 }, { expectedProfileId: 'a', guard: null });
await storeOverviewSummary({ ...summary, year: 2027 }, { expectedProfileId: 'a', guard: null });
assertEqual(readOverviewSummary(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), 2026, scope).monthlyWithdrawal, 1234.5, 'Anderer Umfang/Jahr erhält vorhandenen Stand');
assertEqual(readOverviewSummary(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), 2026, single).monthlyWithdrawal, 500, 'Einzelumfang getrennt');
const unchanged = persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY);
assertEqual(await storeOverviewSummary(summary, { expectedProfileId: 'b', guard: null }), false, 'Gewechselte Identität verwirft Zielwrite');
assertEqual(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), unchanged, 'Identitätsfehler schreibt nichts');
assertEqual(await storeOverviewSummary({ ...summary, scope: overviewScope('single', ['b']) }, { expectedProfileId: 'a', guard: null }), false, 'Fremder Einzelumfang schreibt keinen Eintrag ins aktive Profil');
assertEqual(readOverviewSummary('{broken', 2026, scope), null, 'Beschädigter Anzeigeeintrag bleibt ruhiger Leerzustand');
assertEqual(isAllowedPersistenceImportKey(OVERVIEW_SUMMARY_KEY), true, 'Summary ist explizit backupfähig');
assertEqual(isAllowedSnapshotCaptureKey(OVERVIEW_SUMMARY_KEY), true, 'Summary folgt Profil-Snapshot');
assertEqual(isAllowedSnapshotCaptureKey(OVERVIEW_BACKUP_KEY), false, 'Fachlicher Snapshot setzt reale Sicherungszeit nicht zurück');
assertEqual(isAllowedPersistenceImportKey('overview_invented'), false, 'Kein pauschaler Übersichtpräfix');

const oldTime = '2025-12-15T10:00:00.000Z';
persistenceStorage.setItem(OVERVIEW_BACKUP_KEY, oldTime); await PersistenceFacade.flush();
assertEqual(buildFullPersistenceBackup().records[OVERVIEW_BACKUP_KEY], oldTime, 'Bloßer Builder setzt keine Exportzeit');
const flush = PersistenceFacade.flush;
PersistenceFacade.flush = async () => false;
let downloads = 0;
try { await downloadFullPersistenceBackup({ download: () => downloads++ }); } catch {}
assertEqual(downloads, 0, 'Fehlender Vorflush startet keine Datei');
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), oldTime, 'Vorflushfehler erhält Zeitpunkt');
PersistenceFacade.flush = flush;
try { await downloadFullPersistenceBackup({ download: () => { throw new Error('synthetic-download'); } }); } catch {}
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), oldTime, 'Downloadfehler erhält Zeitpunkt');
try { await downloadFullPersistenceBackup({ download: async () => { throw new Error('synthetic-async-download'); } }); } catch {}
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), oldTime, 'Auch asynchroner Downloadfehler erhält Zeitpunkt');
let stampFlushes = 0, rejectedStamp = false;
PersistenceFacade.flush = async () => { stampFlushes++; if (stampFlushes === 2) throw new Error('synthetic-stamp-flush'); return flush(); };
try { await downloadFullPersistenceBackup({ download() {} }); } catch { rejectedStamp = true; }
PersistenceFacade.flush = flush;
assertEqual(rejectedStamp, true, 'Unbestätigte Sicherungszeit meldet nach Dateiausgabe keinen Gesamterfolg');
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), oldTime, 'Zeitwritefehler stellt vorherigen Zeitpunkt wieder her');
assertEqual(backend.get(OVERVIEW_BACKUP_KEY), oldTime, 'Zeitwritefehler bestätigt den alten Zeitrecord dauerhaft');
let delivered;
const exported = await downloadFullPersistenceBackup({ download: backup => { delivered = structuredClone(backup); assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), oldTime, 'Noch kein lokaler Erfolg während Downloadaufruf'); } });
assertEqual(delivered.records[OVERVIEW_BACKUP_KEY], delivered.exportedAt, 'Datei enthält aktuellen Exportrecord');
assertEqual(delivered.recordCount, Object.keys(delivered.records).length, 'Zähler enthält neuen Record');
assertEqual(delivered.localStorage[OVERVIEW_BACKUP_KEY], delivered.exportedAt, 'Bestehender Alias bleibt konsistent');
assertEqual(backend.get(OVERVIEW_BACKUP_KEY), exported.backup.exportedAt, 'Erfolg ist dauerhaft bestätigt');
assertEqual(normalizeFullPersistenceBackup(delivered).ok, true, 'Neues Backup bleibt kompatibel');
const imported = await importFullPersistenceBackup(delivered);
assertEqual(imported.ok, true, 'Vollbackup-Roundtrip bestätigt');
assertEqual(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), delivered.records[OVERVIEW_SUMMARY_KEY], 'Roundtrip erhält Summarybytes');
assertEqual(switchProfile('b'), true, 'Bestehender Profilwechsel bleibt nutzbar'); await PersistenceFacade.flush();
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), exported.backup.exportedAt, 'Profilwechsel erhält globale Sicherungszeit');
assertEqual(readOverviewSummary(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), 2026, scope).monthlyWithdrawal, 1234.5, 'B erhält gemeinsamen Haushaltsstand, keine individuelle Verdoppelung');

// Recovery verwendet weiterhin die reale Downloadfunktion, setzt aber keine Vollsicherungszeit.
const doc = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
await downloadRecoveryPersistenceBackup({ document: doc });
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), exported.backup.exportedAt, 'Recoveryexport ändert Vollsicherungszeit nicht');
const legacy = structuredClone(delivered);
delete legacy.records[OVERVIEW_BACKUP_KEY]; delete legacy.records[OVERVIEW_SUMMARY_KEY];
const legacyRegistry = JSON.parse(legacy.records.rs_profiles_v1);
for (const profile of Object.values(legacyRegistry.profiles)) delete profile.data[OVERVIEW_SUMMARY_KEY];
legacy.records.rs_profiles_v1 = JSON.stringify(legacyRegistry);
legacy.localStorage = legacy.records; legacy.recordCount = Object.keys(legacy.records).length;
assertEqual(normalizeFullPersistenceBackup(legacy).ok, true, 'Alte Backups ohne neue Records bleiben gültig');
assertEqual((await importFullPersistenceBackup(legacy)).ok, true, 'Altes Backup ohne neue Schlüssel durchläuft den echten Import');
assertEqual(persistenceStorage.getItem(OVERVIEW_BACKUP_KEY), null, 'Altes Backup erzeugt keine erfundene Sicherungszeit');
assertEqual(persistenceStorage.getItem(OVERVIEW_SUMMARY_KEY), null, 'Altes Backup erzeugt keinen erfundenen Plan');
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), null, 'Altes Backup erzeugt keinen erfundenen Monatshaken');
assertEqual(isAllowedPersistenceImportKey(OVERVIEW_MONTH_KEY), true, 'Monatshaken ist explizit backupfähig');
assertEqual(isAllowedSnapshotCaptureKey(OVERVIEW_MONTH_KEY), true, 'Monatshaken folgt dem Profil-Snapshot');
const missingContextRecords = new Map();
let missingContextWrites = 0;
const missingContextStorage = { getItem: key => missingContextRecords.get(key) ?? null,
    setItem() { missingContextWrites++; }, removeItem() { missingContextWrites++; } };
assertEqual(await storeMonthProvision({ month: '2026-09', scope, expectedProfileId: 'a' }, {
    storage: missingContextStorage, guard: null, isBlocked: () => false, flush: () => true
}), false, 'Fehlender Profilkontext wird ohne Bootstrap abgewiesen');
assertEqual(missingContextWrites, 0, 'Fehlender Profilkontext erzeugt kein Defaultprofil');
const monthOptions = { guard, now: () => new Date('2026-10-06T12:00:00Z') };
const monthRequest = { month: '2026-09', scope, expectedProfileId: 'a' };
// Besitz ist ein konkreter Operationsbesitz, keine Namens- oder Phasenfreigabe.
const owner = Symbol('overview-month-close');
const monthRegistryBefore = persistenceStorage.getItem('rs_profiles_v1');
const monthLiveBefore = persistenceStorage.getItem(OVERVIEW_MONTH_KEY);
let ownedPhase = 'commit', operationActive = true;
const outerLease = guard.register(owner, { read: () => ({ phase: ownedPhase }) });
const navigationOperation = { owns: candidate => operationActive && candidate === owner,
    check() { if (!operationActive) throw new Error('OPERATION_ENDED'); } };
try {
    for (const phase of ['commit', 'running', 'preparing', 'cancelling', 'result']) {
        const foreign = guard.register(Symbol('overview-month-close'), { read: () => phase === 'result' ? { result: true } : { phase } });
        const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
        let flushes = 0;
        try {
            assertEqual(await storeMonthProvision(monthRequest, { ...monthOptions, navigationOperation,
                flush: () => { flushes++; return true; } }), false, phase + ': eigener Besitz erlaubt keinen fremden Besitzer');
            assertEqual(flushes, 0, phase + ': kein Flush bei fremdem Besitzer');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, phase + ': kein Cachewrite bei fremdem Besitzer');
        } finally { foreign.unregister(); }
    }
    ownedPhase = 'running'; outerLease.notify();
    assertEqual(await storeMonthProvision(monthRequest, { ...monthOptions, navigationOperation }), false, 'Eigene Nachfrage ist keine bestätigte Schreibphase');
    ownedPhase = 'commit'; outerLease.notify();
    assertEqual(await storeMonthProvision(monthRequest, monthOptions), false, 'Gleicher Leasename ohne Operationsbesitz reicht nicht');
    const borrowedRequest = { ...monthRequest, month: '2026-08' };
    assertEqual(await storeMonthProvision(borrowedRequest, { ...monthOptions, navigationOperation }), true, 'Genau eigener Commitbesitz darf dauerhaft schreiben');
    assertEqual(guard.reasons().length, 1, 'Geliehener Store erzeugt keinen zweiten Besitzer');
    assertEqual(guard.reasons()[0].owner, owner, 'Storecleanup quittiert äußeren Besitzer nicht');
    assert(readMonthProvision(backend.get(OVERVIEW_MONTH_KEY), '2026-08', scope), 'Geliehener Write im Backend bestätigt');
    operationActive = false;
    let endedError;
    try { await storeMonthProvision(monthRequest, { ...monthOptions, navigationOperation }); } catch (error) { endedError = error; }
    assertEqual(endedError?.message, 'OPERATION_ENDED', 'Beendeter Operationsbesitz wird nicht wiederverwendet');
} finally {
    outerLease.unregister();
    persistenceStorage.setItem('rs_profiles_v1', monthRegistryBefore);
    if (monthLiveBefore === null) persistenceStorage.removeItem(OVERVIEW_MONTH_KEY);
    else persistenceStorage.setItem(OVERVIEW_MONTH_KEY, monthLiveBefore);
    await PersistenceFacade.flush();
}
const domainBefore = Object.fromEntries([...backend].filter(([key]) => !['rs_profiles_v1', OVERVIEW_MONTH_KEY].includes(key)));
const profilesBefore = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
let monthFlushes = 0, finishMonth;
const monthJob = storeMonthProvision(monthRequest, { ...monthOptions, flush: async () => {
    monthFlushes++;
    if (monthFlushes === 2) return new Promise(resolve => { finishMonth = resolve; });
    return PersistenceFacade.flush();
} });
while (!finishMonth) await Promise.resolve();
assertEqual(guard.reasons()[0].phase, 'commit', 'Monatshaken hält Navigation bis zum bestätigten Flush');
assertEqual(await storeMonthProvision(monthRequest, monthOptions), false, 'Doppelklick startet keinen zweiten Monatswrite');
finishMonth(true);
assertEqual(await monthJob, true, 'Monatshaken bestätigt den Flush');
await PersistenceFacade.flush();
assertEqual(guard.reasons().length, 0, 'Monatshaken löst eigenen Besitzer');
assert(readMonthProvision(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), '2026-09', scope), 'Haushaltshaken wird bestätigt gelesen');
assertEqual(readMonthProvision(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), '2026-10', scope), null, 'Monate bleiben getrennt');
assertEqual(readMonthProvision(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), '2027-09', scope), null, 'Jahre bleiben getrennt');
assertEqual(readMonthProvision(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), '2026-09', single), null, 'Umfänge bleiben getrennt');
const monthBytes = persistenceStorage.getItem(OVERVIEW_MONTH_KEY);
const invalidScopeRecord = JSON.parse(monthBytes);
invalidScopeRecord.entries[JSON.stringify(['2026-09', scope.key])].scope.ids = ['foreign'];
assertEqual(readMonthProvision(JSON.stringify(invalidScopeRecord), '2026-09', scope), null, 'Widersprüchlicher gespeicherter Scope wird nicht erledigt angenommen');
await storeMonthProvision(monthRequest, monthOptions);
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Wiederholung verändert keinen Erledigtzeitpunkt');
assertEqual(JSON.stringify(Object.fromEntries([...backend].filter(([key]) => !['rs_profiles_v1', OVERVIEW_MONTH_KEY].includes(key)))), JSON.stringify(domainBefore), 'Monatswrite verändert ausschließlich neuen Record und Profilpersistenz');
const profilesAfter = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
for (const id of scope.ids) {
    delete profilesAfter.profiles[id].data[OVERVIEW_MONTH_KEY];
}
assertEqual(JSON.stringify(profilesAfter), JSON.stringify(profilesBefore), 'Keine Cash-, Tranchen-, Fach- oder Jahresänderung im Profilbestand');
const monthBackup = buildFullPersistenceBackup();
assertEqual((await importFullPersistenceBackup(monthBackup)).ok, true, 'Monatshaken durchläuft bestätigten Vollbackup-Roundtrip');
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Monatsrecord bleibt bytegleich nach Backupimport');
assertEqual(switchProfile('b'), true, 'Profilwechsel lädt gemeinsamen Monatshaken'); await PersistenceFacade.flush();
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Haushaltshaken ist beim Partner vorhanden');
assertEqual(switchProfile('a'), true, 'Test kehrt zum Ausgangsprofil zurück'); await PersistenceFacade.flush();
let failFlushes = 0, rejectedMonth = false;
try { await storeMonthProvision({ ...monthRequest, month: '2026-08' }, { ...monthOptions, flush: async () => {
    failFlushes++; await PersistenceFacade.flush();
    return failFlushes !== 2;
} }); } catch { rejectedMonth = true; }
assertEqual(rejectedMonth, true, 'Fehlflush bestätigt keinen Monatshaken');
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Fehlflush nimmt eigenen Livekandidaten zurück');
assertEqual(backend.get(OVERVIEW_MONTH_KEY), monthBytes, 'Fehlflush nimmt auch möglicherweise geschriebenen Backendkandidaten zurück');
assertEqual(guard.reasons().length, 0, 'Fehlflush löst Besitzer');
assertEqual(await storeMonthProvision({ ...monthRequest, month: '2026-07' }, { ...monthOptions, flush: async () => {
    persistenceStorage.setItem('rs_current_profile', 'b'); return true;
} }), false, 'Profilwechsel im Vorflush verwirft Zielwrite');
persistenceStorage.setItem('rs_current_profile', 'a'); await PersistenceFacade.flush();
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Vorflush-Profilwechsel schreibt keinen Monat');
let switchFlushes = 0;
try { await storeMonthProvision({ ...monthRequest, month: '2026-06' }, { ...monthOptions, flush: async () => {
    await PersistenceFacade.flush(); switchFlushes++;
    if (switchFlushes === 2) switchProfile('b');
    return true;
} }); } catch {}
assertEqual(readMonthProvision(JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles.a.data[OVERVIEW_MONTH_KEY], '2026-06', scope), null, 'Profilwechsel im Abschlussflush nimmt falschen Zielwrite zurück');
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), monthBytes, 'Profilwechsel-Rollback erhält fremden Livebestand');
switchProfile('a'); await PersistenceFacade.flush();
let changeScopeFlushes = 0;
assertEqual(await storeMonthProvision({ ...monthRequest, month: '2026-05' }, { ...monthOptions, flush: async () => {
    changeScopeFlushes++;
    if (changeScopeFlushes === 1) {
        const changed = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        changed.profiles.b.meta.belongsToHousehold = false;
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(changed));
    }
    return true;
} }), false, 'Geänderte Haushaltsmitgliedschaft im Vorflush verwirft Zielwrite');
assertEqual(await storeMonthProvision({ ...monthRequest, scope: single }, monthOptions), true, 'Einzelprofil hat eigenen bestätigten Haken');
assert(readMonthProvision(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), '2026-09', single), 'Einzelhaken getrennt vom alten Haushalt lesbar');
const singleBytes = persistenceStorage.getItem(OVERVIEW_MONTH_KEY);
await PersistenceFacade.flush();
PersistenceFacade.resetPersistenceForTests({ name: 'overview-reload', async open() {}, async loadAll() { return Object.fromEntries(backend); },
    async saveBatch({ deletes, upserts }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); } });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
assertEqual(persistenceStorage.getItem(OVERVIEW_MONTH_KEY), singleBytes, 'Bestätigter Reload liest denselben Monatsrecord aus dem Backend');
PersistenceFacade.resetPersistenceForTests();

// P12c/Befund 3: echte Balance-Summaryfolge mit getrenntem Backend und Neustart.
{
    const { projectOverview, buildBalanceOverviewSummary } = await import('../app/overview/overview-model.js');
    const { CONFIG } = await import('../app/balance/balance-config.js');
    const now = new Date(2027, 0, 15, 12), scope = overviewScope('single', ['a']);
    const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    const data = { depot_tranchen: '[]', profile_tagesgeld: '100000',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata }),
        balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
    const persisted = new Map(Object.entries({ ...data, rs_current_profile: 'a', rs_active_profile: 'a',
        rs_profiles_v1: JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Synthetisch' }, data } } }) }));
    const adapter = { name: 'P12c Summaryfolge', async loadAll() { return Object.fromEntries(persisted); },
        async saveBatch({ deletes, upserts }) { deletes.forEach(key => persisted.delete(key)); upserts.forEach(([key, value]) => persisted.set(key, value)); } };
    const read = label => {
        const records = PersistenceFacade.exportAllSync().records, before = JSON.stringify(records);
        const model = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: 'a', liveData: records, now });
        assertEqual(model.firstPlanningYear, 2026, label + ': Erstjahr bleibt 2026');
        assertEqual(model.occasion.annualState, 'open', label + ': Abschluss bleibt fällig');
        assertEqual(model.nextSteps[0].href, 'Balance.html?year=2026#jahresabschluss', label + ': Vorjahresziel bleibt erhalten');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, label + ': lesend bytegleich');
    };
    PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
    read('Startseite');
    const summary = buildBalanceOverviewSummary({ modelResult: { ui: { spending: { monatlicheEntnahme: 321 } } }, monthlyBudget: 432, metadata, scope, now });
    assertEqual(summary.year, 2027, 'Produktiver Summarybuilder liefert laufendes Jahr');
    assertEqual(await storeOverviewSummary(summary, { expectedProfileId: 'a', guard: null }), true, 'Produktiver Writer bleibt aktiv');
    await PersistenceFacade.flush();
    assertEqual(readOverviewSummary(persisted.get(OVERVIEW_SUMMARY_KEY), 2027, scope).monthlyWithdrawal, 321, 'Summary 2027 dauerhaft im Livebestand');
    assertEqual(JSON.parse(persisted.get('rs_profiles_v1')).profiles.a.data[OVERVIEW_SUMMARY_KEY], persisted.get(OVERVIEW_SUMMARY_KEY), 'Summary 2027 dauerhaft in Registry');
    read('Nach echtem Summarywrite');
    PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
    read('Direkt aus Backend neu geladen');
    PersistenceFacade.resetPersistenceForTests();
}
