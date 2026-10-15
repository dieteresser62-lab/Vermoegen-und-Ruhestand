import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { generateExampleExpensesCsv, resolveExampleExpensesBasis, EXAMPLE_SOURCE } from '../app/demo/beispielausgaben.js';
import { importExpenses } from '../app/balance/balance-expenses-import.js';
import { parseCategoryCsv } from '../app/balance/balance-expenses-csv.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createProbelaufController } from '../app/shared/probelauf-state.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { appNow, getAppTestDate, setAppTestDate, advanceCalendarDate, localCalendarDate } from '../app/shared/app-clock.js';
import { isSyntheticPriceMode } from '../app/shared/market-price-adapter.js';
import { saveTranchesToStorage } from '../app/tranches/tranchen-manager-state.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { patchHouseholdPlan } from '../app/profile/household-plan.js';
import { SnapshotArchive as A } from '../app/shared/snapshot-archive.js';
import { PROBELAUF_STATE_KEY, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { projectOverviewFromRecords, bindOverviewMonthClose } from '../app/overview/overview-main.js';
import { downloadFullPersistenceBackup, downloadRecoveryPersistenceBackup, buildFullPersistenceBackup, normalizeFullPersistenceBackup, importFullPersistenceBackup, bindFullBackupButton, bindFullBackupImport } from '../app/shared/persistence-backup.js';
import { OVERVIEW_BACKUP_KEY, storeMonthProvision, storeOverviewSummary } from '../app/overview/overview-storage.js';
import { projectPerson, stripBalancePersonInputs } from '../app/profile/profile-person-data.js';
import { buildBalanceOverviewSummary } from '../app/overview/overview-model.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { switchProfile, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { commitTrancheReconciliation, commitCashPostingConfirmation, projectReconciliationCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { runStartupPriceRefresh } from '../app/tranches/tranchen-startup-prices.js';
import { runHistoryFetch } from '../app/tranches/tranchen-history-fetch.js';
import { createAnnualHandlers } from '../app/balance/balance-binder-annual.js';
import { createMarketdataHandlers } from '../app/balance/balance-annual-marketdata.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { EngineAPI } from '../engine/index.mjs';
import { validateBalanceInputs } from '../app/balance/balance-update-pipeline.js';
import { createAnnualNavigationLifecycle } from '../app/balance/balance-annual-orchestrator.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';

const backend = records => playFixture('tauri', records);
const win = { location: { href: 'http://localhost/index.html' } };
async function boot(f) {
    setAppTestDate(null);
    const c = await f.boot();
    for (const method of ['start', 'changeDate', 'end']) {
        const run = c[method].bind(c);
        c[method] = async (...args) => {
            const before = f.realBytes();
            const result = await run(...args);
            assert(f.realBytes() === before, `${method}: echte Daten und Sicherungspunkte bytegleich`);
            return result;
        };
    }
    return c;
}
const model = () => projectOverviewFromRecords({ registry: JSON.parse(storage.getItem('rs_profiles_v1')), activeId: storage.getItem('rs_active_profile'), liveData: P.exportAllSync().records });
const bytes = values => JSON.stringify(Object.entries(values).filter(([key]) => isProbelaufRecordKey(key)).sort());
const restoreAnnualLocks = installAnnualLocks();
const before = { fetch: globalThis.fetch, toast: UIRenderer.toast, error: UIRenderer.handleActionError, render: StorageManager.renderSnapshots };
let net = 0;
globalThis.fetch = () => { net++; throw new Error('Kein Kursnetz im Musterlauf.'); };
UIRenderer.toast = () => {}; UIRenderer.handleActionError = error => { throw error; }; StorageManager.renderSnapshots = async () => {};

// DOM-Handler liefern echte Promises; kein zeitabhängiges Warten auf Nebenwirkungen.
async function withBackupDOM(payload, run) {
    const previous = { reader: globalThis.FileReader, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const count = { downloads: 0, navigationLinks: [], blobs: 0, events: 0, reads: 0, choosers: 0, recovery: 0, reloads: 0 };
    const node = () => ({ dataset: {}, value: '', disabled: false, handlers: {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
        click() { this.job = this.handlers.click?.(); return this.job; } });
    const nodes = Object.fromEntries(['fullBackupBtn', 'fullBackupImportBtn', 'fullBackupImportFile', 'fullBackupStatus', 'overviewFocus', 'overviewMonthStatus'].map(id => [id, node()]));
    const doc = { defaultView: { Event }, getElementById: id => nodes[id], querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {}, dispatchEvent(event) { if (event.type === 'overview-backup-changed') count.events++; },
        body: { appendChild(link) { link.parentNode = this; } }, createElement: () => ({
            attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); },
            getAttribute(name) { return this.attributes[name] ?? null; },
            click() {
                if (Object.hasOwn(this.attributes, 'data-profile-handoff')) count.navigationLinks.push(this);
                else count.downloads++;
            },
            remove() { this.parentNode = null; }
        }) };
    nodes.fullBackupImportFile.files = [{}];
    nodes.fullBackupImportFile.click = () => count.choosers++;
    URL.createObjectURL = () => { count.blobs++; return 'blob:probelauf-test'; };
    URL.revokeObjectURL = () => {};
    globalThis.FileReader = class { readAsText() {
        count.reads++;
        this.result = JSON.stringify(payload);
        // Auch ein echter Start darf das Dateilesen deterministisch unterbrechen.
        Promise.resolve().then(() => dom.onRead?.()).then(() => this.onload(), error => { this.error = error; this.onerror(); });
    } };
    const dom = { doc, nodes, count, onRead: null };
    try { return await run(dom); }
    finally { globalThis.FileReader = previous.reader; URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke; }
}
const archiveBytes = adapter => JSON.stringify([...adapter.points.entries()].sort());
async function rejectedDownload(action, options, label) {
    let error;
    try { await action(options); } catch (caught) { error = caught; }
    assertEqual(error?.code, 'probelauf_backup_blocked', `${label}: direkte API meldet Probelaufsperre`);
    assert(error?.message.includes('Spielbereich'), `${label}: verständlicher Sperrgrund`);
}
function bindImport(dom, extra = {}) {
    bindFullBackupImport({ document: dom.doc, guard: createNavigationGuard({ decide: async () => true }),
        confirmImport: () => true, createRecoveryBackup: async () => { dom.count.recovery++; return { skipped: false }; },
        reload: () => { dom.count.reloads++; }, ...extra });
}
function blockedStatus(dom, label) {
    assertEqual(dom.nodes.fullBackupStatus.dataset.kind, 'error', `${label}: kein Backup-Erfolgsstatus`);
    assert(dom.nodes.fullBackupStatus.textContent.includes('Spielbereich'), `${label}: sichtbarer Probelaufhinweis`);
}
async function verifyBackupBlocked(adapter, c, payload, label) {
    await withBackupDOM(payload, async dom => {
        const records = JSON.stringify(adapter.values), points = archiveBytes(adapter);
        const time = storage.getItem(OVERVIEW_BACKUP_KEY), persistedTime = adapter.values[OVERVIEW_BACKUP_KEY];
        const writes = adapter.writes, snapshotWrites = adapter.snapshotWrites;
        const originalFlush = P.flush, originalReplace = P.replaceRecordsTransactional;
        let flushes = 0, replaces = 0, injectedDownloads = 0;
        P.flush = async (...args) => { flushes++; return originalFlush(...args); };
        P.replaceRecordsTransactional = async (...args) => { replaces++; return originalReplace(...args); };
        try {
            // Ohne Koordinator und mit injiziertem Download bleibt die direkte API geschützt.
            await rejectedDownload(downloadFullPersistenceBackup, { document: dom.doc, download: () => injectedDownloads++ }, label);
            await rejectedDownload(downloadFullPersistenceBackup, { document: dom.doc }, `${label} Ankerweg`);
            await rejectedDownload(downloadRecoveryPersistenceBackup, { document: dom.doc }, `${label} Recovery`);
            for (const preparedRecovery of [undefined, { recoverySnapshotId: 'umgehung', previousRecords: {} }]) {
                const result = await importFullPersistenceBackup(payload, { guard: null, preparedRecovery });
                assertEqual(result.ok, false, `${label}: gültiger Direktimport abgewiesen`);
                assertEqual(result.code, 'probelauf_backup_blocked', `${label}: auch vorbereitete Recovery umgeht Sperre nicht`);
                assertEqual(result.recoverySnapshotId, null, `${label}: kein neuer Recoverypunkt`);
            }
            bindFullBackupButton({ document: dom.doc, probelaufController: c });
            await dom.nodes.fullBackupBtn.click(); blockedStatus(dom, `${label} Exportbutton`);
            bindOverviewMonthClose({ doc: dom.doc, win, getModel: () => null, refresh() {} });
            await dom.nodes.overviewFocus.handlers.click({ target: { closest: selector => selector === '[data-overview-backup]' ? {} : null } });
            assertEqual(dom.count.navigationLinks.length, 1, `${label}: Fokusweg bedient genau einen zentralen Sicherungsverweis`);
            const link = dom.count.navigationLinks[0];
            assertEqual(link.getAttribute('href'), 'Daten-Sicherung.html#daten-sicherung', `${label}: Fokusweg erreicht die zentrale Vollsicherung`);
            assertEqual(link.getAttribute('data-profile-handoff-export'), 'false', `${label}: Fokusweg verwendet lokalen Handoff ohne Dateiexport`);
            assertEqual(link.parentNode, null, `${label}: Fokusweg entfernt seinen kurzlebigen Link`);
            assertEqual(dom.doc.getElementById('daten-sicherung'), undefined, `${label}: Fokusweg benötigt keine entfernte Startseitenkarte`);
            // Auf der zentralen Seite verhindert derselbe Binder weiterhin den Export.
            await dom.nodes.fullBackupBtn.click(); blockedStatus(dom, `${label} zentrale Sicherungsseite`);
            assertEqual(dom.nodes.fullBackupBtn.disabled, false, `${label}: Exportbedienung zurückgesetzt`);
            bindImport(dom, { probelaufController: c });
            await dom.nodes.fullBackupImportBtn.click(); blockedStatus(dom, `${label} Importbutton`);
            dom.nodes.fullBackupImportFile.value = 'backup.json';
            await dom.nodes.fullBackupImportFile.handlers.change(); blockedStatus(dom, `${label} künstliches Dateievent`);
            assertEqual(dom.nodes.fullBackupImportFile.value, '', `${label}: Dateiauswahl zurückgesetzt`);
            assertEqual(dom.count.reads, 0, `${label}: gesperrte Datei wird nicht gelesen`);
            assertEqual(dom.count.choosers, 0, `${label}: keine Dateiauswahl geöffnet`);
            assertEqual(dom.count.recovery, 0, `${label}: Recoverycallback nicht aufgerufen`);
            assertEqual(dom.count.reloads, 0, `${label}: kein Reload`);
            assertEqual(dom.count.downloads, 0, `${label}: kein Dateiexport-Ankerklick/Download`);
            assertEqual(dom.count.blobs, 0, `${label}: keine Blobausgabe`);
            assertEqual(injectedDownloads, 0, `${label}: kein injizierter Download`);
            assertEqual(dom.count.events, 0, `${label}: kein overview-backup-changed-Erfolg`);
            assertEqual(flushes, 0, `${label}: kein vorbereitender Flush`);
            assertEqual(replaces, 0, `${label}: kein Replaceaufruf`);
            assertEqual(adapter.writes, writes, `${label}: keine Backendwrites`);
            assertEqual(adapter.snapshotWrites, snapshotWrites, `${label}: keine Snapshotwrites`);
            assertEqual(JSON.stringify(adapter.values), records, `${label}: gesamte Backendrecords bytegleich`);
            assertEqual(archiveBytes(adapter), points, `${label}: sämtliche Archivpunkte einschließlich Vor Spielbereich bytegleich`);
            assertEqual(storage.getItem(OVERVIEW_BACKUP_KEY), time, `${label}: Sicherungszeit im Cache unverändert`);
            assertEqual(adapter.values[OVERVIEW_BACKUP_KEY], persistedTime, `${label}: Sicherungszeit im Backend unverändert`);
        } finally { P.flush = originalFlush; P.replaceRecordsTransactional = originalReplace; }
    });
}
async function verifyBackupNormal(adapter, payload, label) {
    await withBackupDOM(payload, async dom => {
        const exported = await downloadFullPersistenceBackup({ document: dom.doc, window: win });
        assert(normalizeFullPersistenceBackup(exported.backup).ok, `${label}: exportiertes Backup normalisierbar`);
        assertEqual(dom.count.downloads, 1, `${label}: ein echter Exportankerklick`);
        assertEqual(dom.count.events, 1, `${label}: genau ein Backup-Erfolg`);
        assertEqual(storage.getItem(OVERVIEW_BACKUP_KEY), exported.backup.exportedAt, `${label}: Exportzeit im Cache bestätigt`);
        assertEqual(adapter.values[OVERVIEW_BACKUP_KEY], exported.backup.exportedAt, `${label}: Exportzeit dauerhaft bestätigt`);
        const previousRecords = JSON.stringify(P.exportAllSync().records), writes = adapter.writes, snapshotWrites = adapter.snapshotWrites;
        const replace = P.replaceRecordsTransactional;
        let replacements = 0;
        P.replaceRecordsTransactional = async (...args) => {
            replacements++;
            assertEqual(adapter.snapshotWrites, snapshotWrites + 1, `${label}: Recoverywrite vor Replace`);
            const point = [...adapter.points.values()].find(point => point.kind === 'full-backup-import-recovery');
            assertEqual(JSON.stringify(point.records), previousRecords, `${label}: Recovery hält vorherige Rohrecords`);
            assertEqual(dom.count.recovery, 1, `${label}: Recoverydownloadcallback vor Replace`);
            return replace(...args);
        };
        try {
            bindImport(dom);
            await dom.nodes.fullBackupImportBtn.click();
            assertEqual(dom.count.choosers, 1, `${label}: Dateiauswahl wieder möglich`);
            await dom.nodes.fullBackupImportFile.handlers.change();
        } finally { P.replaceRecordsTransactional = replace; }
        assertEqual(replacements, 1, `${label}: genau eine Bestandsersetzung`);
        assert(adapter.writes > writes, `${label}: normaler Import dauerhaft geschrieben`);
        assertEqual(dom.count.reloads, 1, `${label}: bestätigter Import lädt einmal neu`);
        assertEqual(dom.nodes.fullBackupStatus.dataset.kind, 'ok', `${label}: normaler Import meldet Erfolg`);
    });
}

// Der gemeinsame Renderer erhält echte Jahresergebnisse; das Fixture doppelt nur die DOM-Mechanik.
async function verifyAnnualProtocol(results) {
    const previousDocument = globalThis.document;
    const { doc } = createDialogFixture();
    globalThis.document = doc;
    try {
        const renderer = createAnnualModalHandlers({ getLastUpdateResults: () => results, isCommitActive: () => false });
        renderer.showUpdateResultModal(results);
        const rendered = () => dialogElements(doc.getElementById('annualResults'));
        const text = () => rendered().map(node => node.textContent).join(' ');
        assert(text().includes('Jahresabschluss bestätigt'), 'Gemeinsamer Renderer zeigt bestätigten Abschluss');
        assertEqual(doc.getElementById('balanceAnnualClose').dataset.annualYearResult, 'confirmed', 'Ergebnisdialog kennzeichnet die echte Jahresbestätigung');
        assertEqual(text().split('Spielbereich · synthetisch').length - 1, 3, 'Gemeinsamer Renderer zeigt Herkunft aller drei Werte');
        await doc.getElementById('annualCloseBtn').fire('click');
        assert(!doc.getElementById('balanceAnnualClose'), 'Ergebnisdialog ist vor dem erneuten Protokollaufruf entfernt');
        renderer.handleShowUpdateLog(true);
        assertEqual(text().split('Spielbereich · synthetisch').length - 1, 3, 'Erneut geöffnetes Protokoll erhält Jahresherkunft');
        assert(rendered().some(node => node.tag === 'h4' && node.textContent === 'Protokoll'), 'Gemeinsamer Protokollrenderer wird ausgeführt');
        assert(Number.isFinite(results.startTime) && Number.isFinite(results.endTime), 'Produktiver Jahrespfad liefert gültige Protokollzeiten');
        assert(text().includes(`Start: ${new Date(results.startTime).toLocaleString('de-DE')} · Ende: ${new Date(results.endTime).toLocaleString('de-DE')}`), 'Protokoll enthält die tatsächlichen Jahreszeiten');
        await doc.getElementById('annualCloseBtn').fire('click');
        assert(!doc.getElementById('balanceAnnualClose'), 'Auch der erneut geöffnete Protokolldialog bleibt schließbar');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

// Der echte Jahreskoordinator, Recovery-Snapshot, Marktadapter und Verlaufwriter.
// Alle drei Marktdatenvorbereitungen und der gemeinsame fachliche Jahreswrite laufen produktiv.
async function closeYear(profileId, targetYear, { failFinalWrite } = {}) {
    assert(switchProfile(profileId), 'Echter Profilwechsel akzeptiert Musterbestand');
    await P.flush();
    assertEqual(model().members.map(person => `${person.id}:${person.name}`).join(','), 'muster_a:Max,muster_b:Erika', 'Echter Profilwechsel erhält Musternamen und IDs');
    const state = StorageManager.loadState();
    assertEqual(JSON.parse(storage.getItem('rs_profiles_v1')).profiles[profileId].meta.name,
        profileId === 'muster_a' ? 'Max' : 'Erika', 'Aktive Person nach Profilwechsel stammt aus der Profilquelle');
    const needsClose = state.annualPeriodMetadata.lastCommittedPeriod !== `calendar-year:${targetYear}`;
    const dom = { inputs: Object.fromEntries(Object.entries(state.inputs).map(([key, value]) => [key, { value: String(value) }])),
        expenses: { yearSelect: { value: String(targetYear) } }, outputs: { snapshotList: {} }, controls: { snapshotStatus: {} } };
    dom.inputs.aktuellesAlter = { value: String(projectPerson(P.exportAllSync().records, targetYear).startAlter) };
    dom.controls.btnJahresUpdate = { disabled: false, innerHTML: 'Jahresabschluss' };
    dom.controls.btnJahresUpdateLog = { disabled: true };
    const lifecycle = createAnnualNavigationLifecycle({ guard: null });
    let protocol;
    const annual = createAnnualHandlers({ dom, appState: {}, debouncedUpdate() {}, navigationLifecycle: lifecycle,
        getLastUpdateResults: () => protocol, setLastUpdateResults: results => { protocol = results; } });
    const calculate = () => {
        const { inputData, engineLastState } = buildBalanceEngineInputFromStorage({ storage, referenceYear: targetYear + 1 });
        validateBalanceInputs(inputData);
        const modelResult = EngineAPI.simulateSingleYear(inputData, engineLastState);
        assert(modelResult.newState && modelResult.ui, 'Echte Engine liefert modellgültigen Candidate');
        return { ok: true, inputData, modelResult };
    };
    const handlers = createSnapshotHandlers({ dom, appState: { snapshotHandle: null }, navigationLifecycle: lifecycle,
        confirmAnnual: async ({ people }) => {
            assertEqual(people.map(person => `${person.id}:${person.name}`).join(','), 'muster_a:Max,muster_b:Erika',
                'Produktive Jahresvorbereitung liefert genau die Musterhaushaltspersonen');
            assert(people.every(person => !person.error && Number.isFinite(person.value)), 'Jahrescash stammt aus gültigen Profilquellen');
            return { cash: { people, values: Object.fromEntries(people.map(person => [person.id, person.value])) } };
        },
        validateLiveState: calculate, runAnnualUpdate: annual.prepareAnnualUpdate,
        commitLiveState: async options => {
            failFinalWrite?.();
            return commitAnnualPlanUpdate({ ...options, engineApi: EngineAPI, now: appNow });
        },
        projectAnnualState: committed => { protocol = committed.results; }
    });
    const committed = await handlers.handleJahresabschluss();
    if (failFinalWrite) {
        assertEqual(committed.status, 'incomplete_recovery', 'Fehlerschreiben hält Jahresabschluss im Recoverypfad');
        assert(StorageManager.loadState().annualPeriodMetadata.pendingCommit?.snapshotId, 'Fehlerschreiben behält bestätigten Rückkehrsnapshot');
        assertEqual(StorageManager.loadState().annualPeriodMetadata.lastCommittedPeriod, `calendar-year:${targetYear - 1}`, 'Fehlerschreiben bestätigt keine neue Periode');
        return;
    }
    assertEqual(committed.status, 'already_committed' , 'Bestehender Jahresabschluss dauerhaft bestätigt');
    const final = JSON.parse((await P.readPersistedRecords(key => key === CONFIG.STORAGE.LS_KEY))[CONFIG.STORAGE.LS_KEY]);
    assertEqual(final.annualPeriodMetadata.lastCommittedPeriod, `calendar-year:${targetYear}`, 'Jahresperiode im Backend bestätigt');
    if (needsClose && targetYear >= 2026) assert(final.wealthHistory.entries.some(entry => entry.id === `annual:${targetYear}`), 'Bestehender Vermögenswriter bestätigt Jahresrecord');
    if (needsClose) {
        await verifyAnnualProtocol(committed.results);
        assertEqual(committed.results.confirmed, true, 'Produktiver Abschluss bestätigt Ergebnis');
        assertEqual(committed.results.errors.length, 0, 'Alle produktiven Jahresschritte erfolgreich');
        for (const step of ['inflation', 'etf']) assertEqual(committed.results[step].source, 'Spielbereich · synthetisch', 'Ergebnis nennt Jahresherkunft');
        assertEqual(committed.results.cape.sourceLabel, 'Spielbereich · synthetisch', 'CAPE-Ergebnislabel');
        assertEqual(final.annualPeriodMetadata.pendingCommit, null, 'Dauerhafter Abschluss ohne Recoverymarker');
        assertEqual(final.annualMarketDataMeta.inflation.year, targetYear, 'Inflationsmeta überlebt ETF-Aufbau und Backendreadback');
        assertEqual(final.annualMarketDataMeta.inflation.source, 'Spielbereich · synthetisch', 'Persistierte Inflationsherkunft');
        assertEqual(final.annualMarketDataMeta.source, 'Spielbereich · synthetisch', 'Persistierte ETF-Herkunft');
        assertEqual(final.capeMeta.capeSource, 'Spielbereich · synthetisch', 'Persistierte CAPE-Herkunft');
        assertEqual(final.capeMeta.capeAsOf, `${targetYear}-12-31`, 'Persistierter CAPE-Jahresstand');
        assertEqual(final.wealthHistory.entries.filter(entry => entry.id === `annual:${targetYear}`).length, 1, 'Genau ein Jahresstand');
        assertEqual(protocol.inflation.year, targetYear, 'Produktiver Protokollspeicher bewahrt Jahresherkunft');
        const beforeRepeat = storage.getItem(CONFIG.STORAGE.LS_KEY);
        await handlers.handleJahresabschluss();
        assertEqual(storage.getItem(CONFIG.STORAGE.LS_KEY), beforeRepeat, 'Wiederholung verändert Bedarf, Kurskette und Meta nicht nochmals');
    }
    const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
    const annualPensions = Object.values(registry.profiles).reduce((sum, profile) => sum + projectPerson(profile.data, targetYear + 1).renteImJahr, 0);
    const summary = buildBalanceOverviewSummary({ modelResult: { ui: { spending: { monatlicheEntnahme: (60000 - annualPensions) / 12 } } },
        monthlyBudget: 5000, metadata: final.annualPeriodMetadata, scope: model().scope });
    assert(await storeOverviewSummary(summary, { expectedProfileId: profileId, guard: null }), 'Produktiver Summarywriter stellt Folgejahresplan bereit');
}

try {
    {
        const adapter = await backend(createMusterHaushaltRecords('2026-12-15'));
        const original = bytes(adapter.values);
        let c = await boot(adapter);
        await c.start(() => ({ source: 'demo', testDate: '2026-12-15' }));
        c = await boot(adapter);
        await c.changeDate('2027-01-02'); c = await boot(adapter);
        await closeYear('muster_a', 2026);
        const annualMeta = StorageManager.loadState().annualMarketDataMeta;
        assert(switchProfile('muster_b'), 'Erika liest gemeinsame Jahresmeta'); await P.flush();
        assertEqual(JSON.stringify(StorageManager.loadState().annualMarketDataMeta), JSON.stringify(annualMeta), 'Profilwechsel erhält aktuelle Inflations-/ETF-Meta');
        await closeYear('muster_b', 2026);
        assertEqual(net, 0, '15.12.2026 → 02.01.2027: Abschluss ohne sämtliche Datenanfragen');
        await c.end(() => true);
        assertEqual(bytes(adapter.values), original, 'Rückkehr erhält ursprüngliche Rohrecords');
        await boot(adapter); assertEqual((await A.listSnapshots()).length, 0, 'Keine neuen echten Sicherungspunkte');
    }
    {
        const adapter = await backend(createMusterHaushaltRecords('2026-12-15'));
        const original = bytes(adapter.values);
        let c = await boot(adapter);
        await c.start(() => ({ source: 'demo', testDate: '2026-12-15' })); c = await boot(adapter);
        await c.changeDate('2027-01-02'); c = await boot(adapter);
        const errorHandler = UIRenderer.handleActionError;
        UIRenderer.handleActionError = () => {};
        try { await closeYear('muster_a', 2026, { failFinalWrite: () => { adapter.fail = true; } }); }
        finally { UIRenderer.handleActionError = errorHandler; }
        c = await boot(adapter); await c.end(() => true);
        assertEqual(bytes(adapter.values), original, 'Rückkehr nach Jahres-Fehlerschreiben erhält Ausgangsrohrecords');
        assertEqual(net, 0, 'Auch Recovery erzeugt keinen Marktdatenfallback');
    }
    // Ruhiger Musterstart 02.11., dann November/Dezember über denselben Bestand.
    {
        const adapter = await backend(createMusterHaushaltRecords('2026-11-02'));
        const beforeRun = bytes(adapter.values);
        let c = await boot(adapter);
        await c.start(() => ({ source: 'demo', testDate: '2026-11-02' })); c = await boot(adapter);
        assertEqual(model().occasion.kind, 'play', 'Musterstart ohne Vorjahresvorbereitung ruhig');
        for (const [index, expected] of ['November abgeschlossen ✓', 'Dezember abgeschlossen ✓'].entries()) {
            await c.changeDate(advanceCalendarDate(c.state.testDate, 'month')); c = await boot(adapter);
            if (index) {
                assertEqual(model().occasion.kind, 'annual', 'Jahreswechsel gewinnt vor Dezemberabschluss');
                await closeYear('muster_a', 2026); await closeYear('muster_b', 2026);
                assert(switchProfile('muster_a'), 'Monatsweg kehrt zu Max zurück'); await P.flush();
            }
            const current = model();
            assertEqual(current.occasion.kind, 'monthly', 'Echter Monatsanlass nach Datumssprung');
            assertEqual(current.members.map(person => person.name).join(','), 'Max,Erika', 'Musterpersonen im Monatsdurchstich');
            const { year, month } = current.expenses, ids = current.scope.ids;
            const basis = resolveExampleExpensesBasis({ year, ids, budget: current.expenseBudget });
            const csvs = ids.map(profileId => generateExampleExpensesCsv({ controller: c, ids, profileId, year, month, basis }));
            const result = await importExpenses({ controller: c, confirm: async () => true,
                targets: ids.map((profileId, position) => ({ year, month, profileId, source: EXAMPLE_SOURCE, text: async () => csvs[position] })) });
            assertEqual(result.status, 'saved', 'Sammelimport dauerhaft bestätigt');
            assert(model().expenses.complete, 'Übersicht projiziert vollständig importierte CSV-Ausgaben');
            const imported = JSON.parse(adapter.values.balance_expenses_v1);
            ids.forEach((id, position) => assertEqual(JSON.stringify(imported.years[year].months[month].profiles[id].categories), JSON.stringify(parseCategoryCsv(csvs[position])), 'Backendkategorien kommen aus CSV'));
            assertEqual(storage.getItem('balance_expenses_v1'), adapter.values.balance_expenses_v1, 'Ausgabencache und Backend unabhängig geprüft');
            await withBackupDOM({}, async ({ doc, nodes }) => {
                bindOverviewMonthClose({ doc, win, getModel: model, refresh() {}, confirm: async () => ({}) });
                const button = { hasAttribute: name => name === 'data-overview-month-confirm' };
                await nodes.overviewFocus.handlers.click({ target: { closest: selector => selector === '[data-overview-month]' ? button : null } });
                assertEqual(nodes.overviewMonthStatus?.textContent || doc.getElementById('overviewMonthStatus')?.textContent, expected, 'Echter Binder zeigt bestätigten Monat');
            });
            assertEqual(model().occasion.kind, 'play', 'storeMonthProvision beendet echten Monatsanlass');
            assertEqual(storage.getItem('overview_month_provision_v1'), adapter.values.overview_month_provision_v1, 'Monatshaken getrennt dauerhaft bestätigt');
        }
        c = await boot(adapter); await c.end(() => true);
        assertEqual(bytes(adapter.values), beforeRun, 'Monatsdurchstich stellt ursprüngliche Fachrecords bytegleich wieder her');
    }
    // Eine eigene Einzelkennung darf in Balance und Übersicht nie zu default werden.
    {
        const originals = createMusterHaushaltRecords('2026-11-02');
        const registry = JSON.parse(originals.rs_profiles_v1), person = registry.profiles.muster_a;
        person.meta.id = 'eigene-einzelperson'; person.meta.name = 'Eigene Person';
        const state = JSON.parse(originals[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2025';
        person.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        originals[CONFIG.STORAGE.LS_KEY] = person.data[CONFIG.STORAGE.LS_KEY];
        originals.rs_profiles_v1 = JSON.stringify({ version: 1, profiles: { 'eigene-einzelperson': person } });
        originals.rs_current_profile = originals.rs_active_profile = 'eigene-einzelperson';
        originals.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
        const adapter = await backend(originals); let c = await boot(adapter);
        await c.start(() => ({ source: 'copy', testDate: '2026-11-02' })); c = await boot(adapter);
        const current = model();
        assertEqual(current.scope.ids.join(','), 'eigene-einzelperson', 'Übersicht verwendet tatsächliche Einzelkennung');
        const { year, month } = current.expenses;
        const csv = generateExampleExpensesCsv({ controller: c, ids: current.scope.ids, profileId: current.activeId, year, month,
            basis: resolveExampleExpensesBasis({ year, ids: current.scope.ids }) });
        await importExpenses({ controller: c, confirm: async () => true, targets: [{ year, month, profileId: current.activeId, source: EXAMPLE_SOURCE, text: async () => csv }] });
        assert(model().expenses.complete, 'Ein tatsächliches Einzelprofil genügt für vollständige Monatspräsenz');
        assertEqual(Object.keys(JSON.parse(adapter.values.balance_expenses_v1).years[year].months[month].profiles).join(','), current.activeId, 'Kein erfundenes default-Profil');
        await c.end(() => true);
    }
    // Januar-Durchstich und Kopie: alle Endrecords entstehen durch echte CSVs.
    for (const source of ['demo', 'copy']) {
        const originals = createMusterHaushaltRecords('2026-11-02');
        if (source === 'copy') {
            // Eigener offener Bestand, unabhängig von den vorbereiteten Muster-Monatshaken.
            const registry = JSON.parse(originals.rs_profiles_v1);
            for (const profile of Object.values(registry.profiles)) profile.data.overview_month_provision_v1 = JSON.stringify({ version: 1, entries: {} });
            originals.overview_month_provision_v1 = registry.profiles.muster_a.data.overview_month_provision_v1;
            originals.rs_profiles_v1 = JSON.stringify(registry);
        }
        const existing = JSON.parse(originals.balance_expenses_v1);
        existing.years[2026].months[10].profiles.muster_a.categories = { 'Eigener Altbestand': -321.09 };
        originals.balance_expenses_v1 = JSON.stringify(existing);
        const adapter = await backend(originals), rawBefore = bytes(adapter.values);
        let c = await boot(adapter);
        await A.createSnapshot({ id: 'beispiel-vorher', label: 'Vorhanden', records: { balance_expenses_v1: originals.balance_expenses_v1 } });
        const archiveBefore = JSON.stringify(await A.readSnapshot('beispiel-vorher'));
        await c.start(() => ({ source, testDate: source === 'demo' ? '2026-12-15' : '2027-01-02' })); c = await boot(adapter);
        if (source === 'demo') {
            assertEqual(model().occasion.kind, 'play', 'Frischer Dezemberstart ruhig');
            await c.changeDate('2027-01-02'); c = await boot(adapter);
        } else {
            const copied = JSON.parse(storage.getItem('rs_profiles_v1'));
            for (const id of ['muster_a', 'muster_b']) for (const key of [CONFIG.STORAGE.LS_KEY, 'overview_month_provision_v1', 'profile_geburtsdatum', 'profile_rentenbeginn']) {
                const expected = JSON.parse(originals.rs_profiles_v1).profiles[id].data[key];
                assertEqual(copied.profiles[id].data[key], expected, 'Kopie erhält Originalperioden und Personen ohne Musterinjektion');
            }
        }
        assertEqual(model().occasion.closingYear, 2026, 'Januar schließt 2026');
        assertEqual(model().occasion.planningYear, 2027, 'Januar plant 2027');
        assertEqual(model().occasion.kind, 'annual', `${source}: Januar öffnet Jahresanlass`);
        const active = model(), ids = active.scope.ids;
        const basis = resolveExampleExpensesBasis({ year: 2026, ids });
        const fillMonth = async month => {
            const csvs = ids.map(profileId => generateExampleExpensesCsv({ controller: c, ids, profileId, year: 2026, month, basis }));
            const imported = await importExpenses({ controller: c, confirm: async () => true,
                targets: ids.map((profileId, index) => ({ profileId, year: 2026, month, source: EXAMPLE_SOURCE, text: async () => csvs[index] })) });
            assertEqual(imported.status, 'saved', `${source}: Monat ${month} bestätigt`);
            const persistent = JSON.parse(adapter.values.balance_expenses_v1);
            ids.forEach((id, index) => assertEqual(JSON.stringify(persistent.years[2026].months[month].profiles[id].categories), JSON.stringify(parseCategoryCsv(csvs[index])), 'Dauerhafte Kategorien stammen aus echtem Parser'));
        };
        await fillMonth(12);
        assertEqual(JSON.parse(storage.getItem('balance_expenses_v1')).years[2026].months[12].profiles.muster_a.source, EXAMPLE_SOURCE, 'Jahresaktion zielt auf Dezember');
        for (let month = 1; month < 12; month++) await fillMonth(month);
        assert(model().expenses.complete, 'Importdienst vervollständigt gültiges Planungsjahr');
        const olderMonths = Object.fromEntries(Object.entries(JSON.parse(storage.getItem('rs_profiles_v1')).profiles).map(([id, profile]) => [id, profile.data.overview_month_provision_v1]));
        await closeYear('muster_a', 2026); await closeYear('muster_b', 2026);
        c = await boot(adapter);
        assertEqual(model().occasion.kind, 'monthly', 'Nach echtem Jahreskoordinator ist Dezember abschließbar');
        const december = model();
        assert(await storeMonthProvision({ month: december.occasion.month, scope: december.scope, expectedProfileId: december.activeId }), 'Bestehender Monatsweg bestätigt Dezember');
        assertEqual(model().occasion.kind, 'play', 'Nach Jahres- und Monatsabschluss wieder ruhig');
        await c.changeDate('2027-02-02'); c = await boot(adapter);
        for (const [id, raw] of Object.entries(olderMonths)) {
            const current = JSON.parse(JSON.parse(storage.getItem('rs_profiles_v1')).profiles[id].data.overview_month_provision_v1);
            for (const [key, entry] of Object.entries(JSON.parse(raw).entries)) assertEqual(JSON.stringify(current.entries[key]), JSON.stringify(entry), 'Ältere Monatsbelege bleiben unverändert');
        }
        await c.end(() => true);
        assertEqual(bytes(adapter.values), rawBefore, `${source}: ursprüngliche Fachrecords und eigene Ausgaben bytegleich`);
        await boot(adapter); assertEqual(JSON.stringify(await A.readSnapshot('beispiel-vorher')), archiveBefore, `${source}: vorhandener Archivpunkt bytegleich`);
    }
    for (const source of ['demo', 'copy']) {
        const originals = createMusterHaushaltRecords('2026-11-01');
        originals[OVERVIEW_BACKUP_KEY] = '2026-10-01T12:00:00.000Z';
        originals.profile_tagesgeld = '090000'; // Rohstringformat wird beim Rückweg erhalten.
        const adapter = await backend(originals), originalBytes = bytes(adapter.values);
        let c = await boot(adapter);
        const payload = buildFullPersistenceBackup();
        assert(normalizeFullPersistenceBackup(payload).ok, `${source}: Importpayload vor Start fachlich gültig`);
        await A.createSnapshot({ id: 'alt', label: 'Vorher', records: { profile_tagesgeld: '090000' } });
        const oldPoint = JSON.stringify(await A.readSnapshot('alt'));
        await c.start(({ demoAvailable }) => { assert(demoAvailable, 'Standardloader verfügbar'); return { source, testDate: '2027-07-01' }; });
        c = await boot(adapter);
        if (source === 'demo') {
            assertEqual(model().members.map(person => `${person.id}:${person.name}`).join(','), 'muster_a:Max,muster_b:Erika', 'Musterstart/Readback: unveränderte IDs mit Max und Erika');
            const household = model().household;
            assert(Math.abs(household.assets - 790000) < 0.01, 'Musterstart/Readback: Gesamtvermögen 790.000 € ohne Doppelsummen');
            assertEqual(household.allocation.cash, 30000, 'Musterstart/Readback: 30.000 € Tagesgeld');
            assert(Math.abs(household.allocation.geldmarkt - 60000) < 0.01, 'Musterstart/Readback: 60.000 € Geldmarkt');
            assertEqual(adapter.values.profile_tagesgeld, '18000', 'Musterstart: persönlicher Cash dauerhaft bestätigt');
            const needs = JSON.parse(adapter.values.household_simulator_needs_v1).values;
            assertEqual(JSON.stringify(needs), JSON.stringify({ startFloorBedarf: '30000', startFlexBedarf: '30000', minimumFlexAnnual: '7500' }), 'Musterstart: Simulatorbedarf dauerhaft bestätigt');
        }
        assertEqual(storage.getItem(OVERVIEW_BACKUP_KEY), source === 'copy' ? originals[OVERVIEW_BACKUP_KEY] : null, `${source}: erwarteter Zeitrecord im aktiven Bestand`);
        await verifyBackupBlocked(adapter, c, payload, `${source} aktiv`);
        if (source === 'demo') {
            storage.setItem(OVERVIEW_BACKUP_KEY, originals[OVERVIEW_BACKUP_KEY]); await P.flush();
            await verifyBackupBlocked(adapter, c, payload, 'demo mit vorhandenem Zeitrecord');
        }
        assertEqual(model().occasion.annualState, source === 'demo' ? 'done' : 'open', 'Frischer Musterstart und fortgesetzte Kopie unterscheiden sich');
        await runStartupPriceRefresh({ operation: { controller: new AbortController(), check() {}, commit() {} } });
        await runHistoryFetch({ firstPlanningYear: 2026, fetchImpl: globalThis.fetch });
        if (source === 'demo') {
            assertEqual(model().occasion.kind, 'play', 'Frischer Julistart ohne offene Abschlüsse');
            for (const date of ['2027-08-01', '2027-09-01']) {
                if (c.state.testDate !== date) { await c.changeDate(date); c = await boot(adapter); }
                const current = model();
                assert(await storeMonthProvision({ month: current.occasion.month, scope: current.scope, expectedProfileId: 'muster_a' }), 'Echter Monatsabschluss nach Kalenderwechsel');
                assertEqual(model().occasion.kind, 'play', 'Bestätigter Monat schließt Anlass');
                assertEqual(adapter.values.overview_month_provision_v1, storage.getItem('overview_month_provision_v1'), 'Monatsrecord dauerhaft bestätigt');
            }
            const lot = JSON.parse(storage.getItem('depot_tranchen'))[1];
            const sale = await commitTrancheReconciliation({ profileId: 'muster_a', expectedTranchesRaw: storage.getItem('depot_tranchen'),
                action: { actionId: 'muster_verkauf_1', profileId: 'muster_a', trancheId: lot.trancheId, executedAt: appNow().toISOString().slice(0, 10), sharesSold: 10, grossProceeds: lot.currentPrice * 10, fees: 5 } });
            assertEqual(sale.status, 'applied', 'Echte Verkaufsfunktion angewendet');
            assertEqual(projectReconciliationCashStatuses(storage.getItem('rs_profiles_v1'))[0].cashStatus, 'pending_manual_posting', 'Verkauf mit ausstehendem Cash');
            const values = loadProfileAssetValues();
            saveProfileAssetValues({ ...values, tagesgeld: values.tagesgeld + 2500 }, storage, { recordCashChange: true });
            saveCurrentProfileFromLocalStorage(); await P.flush();
            await commitCashPostingConfirmation({ profileId: 'muster_a', targetActionId: 'muster_verkauf_1', cashBalanceAfterPostingEur: values.tagesgeld + 2500,
                confirmedAt: appNow().toISOString(), expectedRegistryRaw: storage.getItem('rs_profiles_v1') });
            assertEqual(projectReconciliationCashStatuses(storage.getItem('rs_profiles_v1'))[0].cashStatus, 'confirmed_manual_posting', 'Cashzustand über echte Bestätigung');
            await c.changeDate('2028-01-01'); c = await boot(adapter);
            assertEqual(model().occasion.kind, 'annual', 'Januarwechsel öffnet bestehenden Jahresabschluss');
            await closeYear('muster_a', 2027); await closeYear('muster_b', 2027);
        }
        c = await boot(adapter);
        await c.changeDate('2027-06-01'); c = await boot(adapter);
        const prices = JSON.parse(storage.getItem('rs_daily_prices_v1'));
        assert(Object.values(prices.symbols).every(curve => curve.days.every(day => day * 86400000 <= Date.parse('2027-06-01T00:00:00Z'))), 'Rückwärtssprung entfernt alle späteren gespeicherten Kurse');
        const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
        assert(Object.values(registry.profiles).every(profile => JSON.parse(profile.data.depot_tranchen).every(lot => lot.asOf * 1000 <= appNow().getTime())), 'Alle Profilquotes erneuert, ohne spätere Stichtage');
        const testBytes = bytes(adapter.values);
        assertEqual((await c.end(() => false)).status, 'cancelled', 'Abbruch der Enderückfrage');
        assertEqual(bytes(adapter.values), testBytes, 'Endabbruch verändert Testbestand nicht');
        await c.end(() => true);
        assertEqual(bytes(adapter.values), originalBytes, `${source}: sämtliche ursprünglichen Rohrecords bytegleich`);
        await boot(adapter); assertEqual(JSON.stringify(await A.readSnapshot('alt')), oldPoint, 'Vorheriger Archivpunkt bytegleich');
        assertEqual((await A.listSnapshots()).length, 1, 'Nur alter Punkt bleibt');
        assertEqual(storage.getItem('rs_probelauf_state_v1'), null, 'Kein Testzustand als Echtbestand');
        c = await boot(adapter);
        await verifyBackupNormal(adapter, payload, `${source} nach Beenden und Initialisieren`);
    }
    // Durchstich über alle Produktionsadapter, beide Quellen und echte Abschlusswriter.
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) for (const source of ['copy', 'demo']) {
        const f = await playFixture(kind, createMusterHaushaltRecords('2026-12-15'));
        let c = await f.boot();
        await A.createSnapshot({ id: 'echt-vorher', records: { profile_tagesgeld: 'unverändert' } });
        const before = f.realBytes();
        const unchanged = label => assert(f.realBytes() === before, `${kind}/${source}: ${label} erhält echte Daten, Sicherungspunkte und Metadaten bytegleich`);
        await c.start(() => ({ source, testDate: '2026-12-15' })); c = await f.boot(); unchanged('Start');
        const current = model();
        assert(await storeMonthProvision({ month: '2026-11', scope: current.scope, expectedProfileId: current.activeId, guard: null }), 'Produktiver Monatswriter im Spielbereich');
        unchanged('Monatsabschluss');
        await c.changeDate('2027-01-02'); c = await f.boot(); unchanged('Datumssprung');
        await closeYear('muster_a', 2026); await closeYear('muster_b', 2026); unchanged('Jahresabschluss');
        c = await f.boot(); unchanged('Neustart');
        assertEqual(StorageManager.loadState().annualPeriodMetadata.lastCommittedPeriod, 'calendar-year:2026', 'Neustart behält Jahresbeleg');
        await c.end(() => true); unchanged('Beenden');
        await f.boot(); unchanged('Echter Neustart');
    }
    // SB-3: Stand heute → Gold über die produktiven Saver → beide Rechenwege
    // → echte Kurswriter → Datumssprung und Rücksprung → bytegleich verwerfen.
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
        const today = localCalendarDate(), originals = createMusterHaushaltRecords(today);
        delete originals.rs_daily_prices_v1;
        const f = await playFixture(kind, originals);
        let c = await f.boot();
        await A.createSnapshot({ id: 'vor-gold', records: { profile_gold_aktiv: 'false' } });
        f.session.setItem('rs_startup_prices_session_v1', 'echte Kurssitzung');
        const real = f.realBytes();
        const unchanged = label => assertEqual(f.realBytes(), real, `${kind}: Stand heute / ${label}: echte Records, Archive, Sitzungen und Metadaten bytegleich`);
        await c.start(() => ({ source: 'copy', testDate: null })); c = await f.boot();
        assertEqual(c.state.testDate, null, 'Stand heute hat kein Testdatum');
        assertEqual(c.state.hasDateJump, false, 'Steuerdatensatz hält fehlenden Sprung fest');
        assert(!isSyntheticPriceMode(), 'Stand heute öffnet echte Kurswege'); unchanged('Start');
        assertEqual((await c.changeDate(today)).status, 'cancelled', 'Heute erneut wählen ist kein Datumssprung');
        saveProfileAssetValues({ ...loadProfileAssetValues(), goldAktiv: true, goldZiel: 10, goldFloor: 5,
            tagesgeld: 22000, renteMonatlich: 2400 }, storage, { recordCashChange: true });
        const gold = { schemaVersion: 2, trancheId: 'spiel_gold_1', type: 'gold', category: 'gold', name: 'Testgold',
            ticker: '4GLD.DE', isin: 'DE000A0S9GB0', shares: 10, purchasePrice: 200, currentPrice: 200,
            purchaseDate: today, tqf: 0, taxExempt: false };
        saveTranchesToStorage([...JSON.parse(storage.getItem('depot_tranchen')), gold]);
        assert(saveCurrentProfileFromLocalStorage(), 'Gold und Kauf werden im aktiven Profil gespeichert'); await P.flush();
        const initial = buildBalanceEngineInputFromStorage({ storage });
        await patchHouseholdPlan({ scope: initial.scope, patch: { floorBedarf: 32000, liquidityRunwayYears: 4,
            decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 4, drawdownTrigger: 15, bondRefillThreshold: null } } });
        const balance = buildBalanceEngineInputFromStorage({ storage });
        assert(balance.inputData.goldAktiv && balance.inputData.goldWert === 2000, 'Balance-Eingaben enthalten neue Gold-Tranche');
        assertEqual(balance.inputData.decumulation.mode, '3_bucket_jilge', 'Anleihenstrategie im Spielbereich bedienbar');
        assertEqual(balance.inputData.floorBedarf, 32000, 'Bedarf im Spielbereich bedienbar');
        assertEqual(balance.inputData.liquidityRunwayYears, 4, 'Liquiditätsziel im Spielbereich bedienbar');
        const simulator = buildSimulatorInputsFromProfileData(P.exportAllSync().records);
        assert(simulator.goldAktiv && simulator.detailledTranches.some(lot => lot.trancheId === gold.trancheId), 'Simulator-Eingaben enthalten neue Gold-Tranche');
        assertEqual(simulator.startFloorBedarf, 32000, 'Simulator liest geänderten Bedarf');
        assert(EngineAPI.simulateSingleYear(balance.engineInput, balance.engineLastState).ui, 'Balance rechnet mit Gold');
        unchanged('Gold, Bedarf, Rente und Strategie');

        const requests = [];
        globalThis.fetch = async url => {
            const request = new URL(url); requests.push(request);
            if (request.href.includes('yale.edu')) return { ok: true,
                text: async () => `${today.slice(0, 7).replace('-', '.')} foo bar 28.1` };
            const symbol = request.searchParams.get('symbol');
            if (request.pathname === '/quote') return { ok: true, json: async () => ({ symbol, price: symbol === '4GLD.DE' ? 210 : 123.45,
                currency: 'EUR', asOf: Math.floor(Date.now() / 1000), source: 'Gefälschter Kursdienst' }) };
            if (request.pathname === '/chart') return { ok: true, json: async () => ({ chart: { result: [{
                meta: { symbol, currency: 'EUR', exchangeTimezoneName: 'UTC' },
                timestamp: [Number(request.searchParams.get('period1'))], indicators: { quote: [{ close: [111.25] }] }
            }], error: null } }) };
            throw new Error('Unerwarteter Datenabruf: ' + url);
        };
        const quotes = await runStartupPriceRefresh({ operation: { controller: new AbortController(), check() {}, commit() {} } });
        assert(quotes.updated > 0 && requests.some(url => url.pathname === '/quote'), 'Stand heute ruft gefälschten echten Kursdienst auf');
        const persisted = await P.readPersistedRecords(key => key === 'depot_tranchen');
        assertEqual(JSON.parse(persisted.depot_tranchen).find(lot => lot.trancheId === gold.trancheId).currentPrice, 210, 'Echter Kurswriter bestätigt Goldkurs nur im Spielbereich');
        unchanged('Kursabruf');
        const history = await runHistoryFetch({ firstPlanningYear: new Date().getFullYear(), fetchImpl: globalThis.fetch });
        assert(history.completed > 0 && requests.some(url => url.pathname === '/chart'), 'Stand heute lädt echten Kursverlauf');
        assert(Object.values(JSON.parse((await P.readPersistedRecords(key => key === 'rs_daily_prices_v1')).rs_daily_prices_v1).symbols)
            .some(curve => curve.closes.includes(111.25)), 'Verlaufswriter bestätigt Dienstkurs im Spielbereich'); unchanged('Kursverlauf');
        const annual = createMarketdataHandlers({ dom: { inputs: { capeRatio: { value: '' } }, controls: {} }, appState: {},
            debouncedUpdate() {}, navigationLifecycle: createAnnualNavigationLifecycle({ guard: null }) });
        const cape = await annual.handleFetchCapeAuto({ nested: true }); await P.flush();
        assertEqual(cape.capeFetchStatus, 'ok_primary', 'Stand heute verwendet echte CAPE-Quelle');
        assertEqual(JSON.parse((await P.readPersistedRecords(key => key === CONFIG.STORAGE.LS_KEY))[CONFIG.STORAGE.LS_KEY]).capeMeta.capeRatio,
            28.1, 'Jahresmarktdatenwriter bestätigt Dienstwert im Spielbereich'); unchanged('Jahresmarktdaten');
        const sold = await commitTrancheReconciliation({ profileId: 'muster_a', expectedTranchesRaw: storage.getItem('depot_tranchen'),
            action: { actionId: 'spiel_gold_verkauf', profileId: 'muster_a', trancheId: gold.trancheId, executedAt: today, sharesSold: 1, grossProceeds: 210, fees: 0 } });
        assertEqual(sold.status, 'applied', 'Verkauf bleibt im Spielbereich bedienbar'); unchanged('Verkauf');
        c = await f.boot(); assert(!isSyntheticPriceMode(), 'Neustart erhält Stand heute');
        await c.changeDate(advanceCalendarDate(today, 'day')); c = await f.boot();
        assert(c.state.hasDateJump && isSyntheticPriceMode(), 'Datumssprung bleibt im Steuerdatensatz gespeichert');
        await c.changeDate(today); c = await f.boot();
        assert(c.state.hasDateJump && isSyntheticPriceMode(), 'Rücksprung auf heute bleibt synthetisch');
        const count = requests.length;
        await runStartupPriceRefresh({ operation: { controller: new AbortController(), check() {}, commit() {} } });
        await runHistoryFetch({ firstPlanningYear: new Date().getFullYear(), fetchImpl: globalThis.fetch });
        assertEqual((await annual.prepareCape()).capeFetchStatus, 'ok_synthetic', 'Nach Datumssprung bleibt CAPE synthetisch');
        assertEqual(requests.length, count, 'Nach Sprung und Rücksprung kein Kursnetz'); unchanged('Datumssprünge');
        await c.end(() => true); unchanged('Beenden'); await f.boot(); unchanged('Echter Neustart');
        assertEqual(storage.getItem('profile_gold_aktiv'), 'false', 'Echte Daten bleiben ohne Goldaktivierung');
        assert(!JSON.parse(storage.getItem('depot_tranchen')).some(lot => lot.type === 'gold'), 'Echte Daten bleiben ohne Gold-Tranche');
        globalThis.fetch = () => { net++; throw new Error('Kein Kursnetz im Musterlauf.'); };
    }
} finally { Object.assign(globalThis, { fetch: before.fetch }); UIRenderer.toast = before.toast; UIRenderer.handleActionError = before.error; StorageManager.renderSnapshots = before.render; P.resetPersistenceForTests(); setAppTestDate(null); }

P.resetPersistenceForTests(); setAppTestDate(null); restoreAnnualLocks();
