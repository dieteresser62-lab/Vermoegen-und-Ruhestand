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
import { appNow, getAppTestDate, setAppTestDate, advanceCalendarDate } from '../app/shared/app-clock.js';
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

function backend(records) {
    const values = { ...records }, points = new Map();
    return { values, points, writes: 0, snapshotWrites: 0, fail: false, async loadAll() { return { ...values }; },
        async saveBatch({ deletes, upserts }) { this.writes++; if (this.fail) { this.fail = false; throw new Error('Test-Commitfehler'); } deletes.forEach(key => delete values[key]); upserts.forEach(([key, value]) => values[key] = value); },
        async listSnapshots() { return [...points.values()].map(({ records, ...point }) => point); },
        async readSnapshot(id) { if (!points.has(id)) throw new Error('missing'); return structuredClone(points.get(id)); },
        async writeSnapshot(point) { this.snapshotWrites++; points.set(point.id, structuredClone(point)); }, async deleteSnapshot(id) { points.delete(id); } };
}
const win = { location: { href: 'http://localhost/index.html?probelauf=1' } };
const makeController = () => createProbelaufController({ win, reload() {}, restoreReload() {}, session: null });
async function boot(adapter) { P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false }); const c = makeController(); await c.initialize(); return c; }
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
    assert(error?.message.includes('Probelauf'), `${label}: verständlicher Sperrgrund`);
}
function bindImport(dom, extra = {}) {
    bindFullBackupImport({ document: dom.doc, guard: createNavigationGuard({ decide: async () => true }),
        confirmImport: () => true, createRecoveryBackup: async () => { dom.count.recovery++; return { skipped: false }; },
        reload: () => { dom.count.reloads++; }, ...extra });
}
function blockedStatus(dom, label) {
    assertEqual(dom.nodes.fullBackupStatus.dataset.kind, 'error', `${label}: kein Backup-Erfolgsstatus`);
    assert(dom.nodes.fullBackupStatus.textContent.includes('Probelauf'), `${label}: sichtbarer Probelaufhinweis`);
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
            assertEqual(archiveBytes(adapter), points, `${label}: sämtliche Archivpunkte einschließlich Vor Probelauf bytegleich`);
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
        assertEqual(text().split('Probelauf · synthetisch').length - 1, 3, 'Gemeinsamer Renderer zeigt Herkunft aller drei Werte');
        await doc.getElementById('annualCloseBtn').fire('click');
        assert(!doc.getElementById('balanceAnnualClose'), 'Ergebnisdialog ist vor dem erneuten Protokollaufruf entfernt');
        renderer.handleShowUpdateLog(true);
        assertEqual(text().split('Probelauf · synthetisch').length - 1, 3, 'Erneut geöffnetes Protokoll erhält Jahresherkunft');
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
        for (const step of ['inflation', 'etf']) assertEqual(committed.results[step].source, 'Probelauf · synthetisch', 'Ergebnis nennt Jahresherkunft');
        assertEqual(committed.results.cape.sourceLabel, 'Probelauf · synthetisch', 'CAPE-Ergebnislabel');
        assertEqual(final.annualPeriodMetadata.pendingCommit, null, 'Dauerhafter Abschluss ohne Recoverymarker');
        assertEqual(final.annualMarketDataMeta.inflation.year, targetYear, 'Inflationsmeta überlebt ETF-Aufbau und Backendreadback');
        assertEqual(final.annualMarketDataMeta.inflation.source, 'Probelauf · synthetisch', 'Persistierte Inflationsherkunft');
        assertEqual(final.annualMarketDataMeta.source, 'Probelauf · synthetisch', 'Persistierte ETF-Herkunft');
        assertEqual(final.capeMeta.capeSource, 'Probelauf · synthetisch', 'Persistierte CAPE-Herkunft');
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
        const adapter = backend(createMusterHaushaltRecords('2026-12-15'));
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
        assertEqual((await A.listSnapshots()).length, 1, 'Nur erlaubter Punkt Vor Probelauf verbleibt');
    }
    {
        const adapter = backend(createMusterHaushaltRecords('2026-12-15'));
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
        const adapter = backend(createMusterHaushaltRecords('2026-11-02'));
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
        const adapter = backend(originals); let c = await boot(adapter);
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
        const adapter = backend(originals), rawBefore = bytes(adapter.values);
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
        assertEqual(JSON.stringify(await A.readSnapshot('beispiel-vorher')), archiveBefore, `${source}: vorhandener Archivpunkt bytegleich`);
    }
    for (const source of ['demo', 'copy']) {
        const originals = createMusterHaushaltRecords('2026-11-01');
        originals[OVERVIEW_BACKUP_KEY] = '2026-10-01T12:00:00.000Z';
        originals.profile_tagesgeld = '090000'; // Rohstringformat wird beim Rückweg erhalten.
        const adapter = backend(originals), originalBytes = bytes(adapter.values);
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
        assertEqual(JSON.stringify(await A.readSnapshot('alt')), oldPoint, 'Vorheriger Archivpunkt bytegleich');
        assertEqual((await A.listSnapshots()).length, 2, 'Nur alter Punkt und Vor Probelauf bleiben');
        assertEqual(storage.getItem('rs_probelauf_state_v1'), null, 'Kein Testzustand als Echtbestand');
        c = await boot(adapter);
        await verifyBackupNormal(adapter, payload, `${source} nach Beenden und Initialisieren`);
    }
    // Steuerrecord allein sperrt auch ohne Fachuhr und ohne Dokumentkoordinator.
    for (const phase of ['starting', 'active', 'restoring', 'beschädigt']) for (const location of ['cache', 'backend']) {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01'));
        P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false }); setAppTestDate(null);
        const payload = buildFullPersistenceBackup();
        const raw = phase === 'beschädigt' ? '{kaputt' : JSON.stringify({ version: 1, active: true, phase });
        if (location === 'cache') { storage.setItem(PROBELAUF_STATE_KEY, raw); await P.flush(); delete adapter.values[PROBELAUF_STATE_KEY]; }
        else adapter.values[PROBELAUF_STATE_KEY] = raw;
        await verifyBackupBlocked(adapter, undefined, payload, `${phase} nur ${location}, Systemuhr`);
    }
    for (const flag of ['state', 'busy', 'blocked']) {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01'));
        await boot(adapter);
        const payload = buildFullPersistenceBackup(), coordinator = { [flag]: flag === 'state' ? { phase: 'starting' } : true };
        await withBackupDOM(payload, async dom => {
            const options = { document: dom.doc, probelaufController: coordinator };
            await rejectedDownload(downloadFullPersistenceBackup, options, `Koordinator ${flag}`);
            await rejectedDownload(downloadRecoveryPersistenceBackup, options, `Koordinator ${flag} Recovery`);
            assertEqual((await importFullPersistenceBackup(payload, options)).code, 'probelauf_backup_blocked', `${flag}: Koordinator sperrt Direktimport`);
            bindFullBackupButton(options); await dom.nodes.fullBackupBtn.click(); blockedStatus(dom, flag);
            bindImport(dom, { probelaufController: coordinator });
            await dom.nodes.fullBackupImportBtn.click(); await dom.nodes.fullBackupImportFile.handlers.change(); blockedStatus(dom, flag);
            assertEqual(dom.count.downloads + dom.count.recovery + dom.count.reloads + dom.count.reads + dom.count.choosers, 0, `${flag}: Binder und APIs ohne Nebenwirkungen`);
            assertEqual(adapter.snapshotWrites, 0, `${flag}: kein Recovery-Snapshot`);
        });
    }
    // Zustand kann auch erst während des verifizierenden Backendreads eintreten.
    {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01')); await boot(adapter);
        const payload = buildFullPersistenceBackup(), read = P.readPersistedRecords;
        await withBackupDOM(payload, async dom => {
            P.readPersistedRecords = async () => { setAppTestDate('2027-07-01'); return {}; };
            try { await rejectedDownload(downloadFullPersistenceBackup, { document: dom.doc }, 'Fachuhr während Backendread'); }
            finally { P.readPersistedRecords = read; setAppTestDate(null); }
            assertEqual(dom.count.downloads, 0, 'Erneute Fachuhrprüfung nach Backendread verhindert Download');
            P.readPersistedRecords = async () => { throw new Error('Test-Readfehler'); };
            try {
                let error; try { await downloadRecoveryPersistenceBackup({ document: dom.doc }); } catch (caught) { error = caught; }
                assertEqual(error?.code, 'probelauf_backup_state_unavailable', 'Backendlesefehler sperrt Recovery');
                const result = await importFullPersistenceBackup(payload, { guard: null });
                assertEqual(result.code, 'probelauf_backup_state_unavailable', 'Backendlesefehler sperrt Import');
                bindImport(dom); await dom.nodes.fullBackupImportFile.handlers.change(); blockedStatus(dom, 'Backendlesefehler');
            } finally { P.readPersistedRecords = read; }
            assertEqual(dom.count.downloads + dom.count.recovery + dom.count.reloads + dom.count.reads, 0, 'Lesefehler gibt keinen Nebenwirkungsweg frei');
            assertEqual(adapter.snapshotWrites, 0, 'Lesefehler schreibt keinen Snapshot');
        });
    }
    for (const action of ['export', 'recovery', 'import']) {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01')), c = await boot(adapter);
        const payload = buildFullPersistenceBackup(), flush = P.flush;
        await withBackupDOM(payload, async dom => {
            let afterStart;
            P.flush = async () => {
                P.flush = flush;
                await c.start(() => ({ source: 'copy', testDate: '2027-07-01' }));
                afterStart = { records: JSON.stringify(adapter.values), points: archiveBytes(adapter), writes: adapter.writes, snapshots: adapter.snapshotWrites };
                return true;
            };
            try {
                if (action === 'import') assertEqual((await importFullPersistenceBackup(payload, { guard: null })).code, 'probelauf_backup_blocked', 'Start während Importflush sperrt vor Snapshot');
                else await rejectedDownload(action === 'export' ? downloadFullPersistenceBackup : downloadRecoveryPersistenceBackup, { document: dom.doc }, `Start während ${action}-Flush`);
            } finally { P.flush = flush; }
            assert(afterStart && c.state?.phase === 'active', `${action}: echter Probelauf im Vorflush gestartet`);
            assertEqual(dom.count.downloads, 0, `${action}: kein Download nach Vorflush`);
            assertEqual(adapter.writes, afterStart.writes, `${action}: keine zusätzlichen Writes nach Start`);
            assertEqual(adapter.snapshotWrites, afterStart.snapshots, `${action}: nur Vor Probelauf, kein Importsnapshot`);
            assertEqual(JSON.stringify(adapter.values), afterStart.records, `${action}: Startbestand bytegleich`);
            assertEqual(archiveBytes(adapter), afterStart.points, `${action}: Startarchiv bytegleich`);
        });
    }
    for (const stage of ['file', 'confirm', 'callback']) {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01')), c = await boot(adapter);
        const payload = buildFullPersistenceBackup();
        await withBackupDOM(payload, async dom => {
            let afterStart;
            const start = async () => {
                await c.start(() => ({ source: 'demo', testDate: '2027-07-01' }));
                afterStart = { records: JSON.stringify(adapter.values), points: archiveBytes(adapter), writes: adapter.writes, snapshots: adapter.snapshotWrites };
            };
            const options = { probelaufController: c };
            if (stage === 'file') dom.onRead = start;
            if (stage === 'confirm') options.confirmImport = () => { setAppTestDate('2027-07-01'); return true; };
            if (stage === 'callback') options.createRecoveryBackup = async () => { dom.count.recovery++; await start(); return { skipped: false }; };
            bindImport(dom, options);
            await dom.nodes.fullBackupImportFile.handlers.change(); blockedStatus(dom, `Start während ${stage}`);
            assertEqual(dom.count.reads, 1, `${stage}: Dateilesen tatsächlich erreicht`);
            assertEqual(dom.count.recovery, stage === 'callback' ? 1 : 0, `${stage}: Recoverycallback kann Vorabprüfung nicht umgehen`);
            assertEqual(dom.count.downloads + dom.count.reloads, 0, `${stage}: kein Dateidownload oder Reload`);
            assertEqual(dom.nodes.fullBackupImportFile.value, '', `${stage}: Dateifeld nach Sperre zurückgesetzt`);
            if (afterStart) {
                assertEqual(adapter.writes, afterStart.writes, `${stage}: keine zusätzlichen Transaktionswrites`);
                assertEqual(adapter.snapshotWrites, afterStart.snapshots, `${stage}: kein zusätzlicher Importsnapshot`);
                assertEqual(JSON.stringify(adapter.values), afterStart.records, `${stage}: Backendrecords bytegleich`);
                assertEqual(archiveBytes(adapter), afterStart.points, `${stage}: Archivpunkte bytegleich`);
            } else assertEqual(adapter.snapshotWrites, 0, 'Fachuhr während Bestätigung sperrt vor Recovery');
        });
    }
    {
        const adapter = backend(createMusterHaushaltRecords('2026-11-01')); await boot(adapter);
        await verifyBackupNormal(adapter, buildFullPersistenceBackup(), 'Nur URL-Parameter bei leerem Steuerzustand und Systemuhr');
    }
    const adapter = backend(createMusterHaushaltRecords('2026-11-01'));
    let c = await boot(adapter);
    const originals = bytes(adapter.values);
    await c.start(() => ({ source: 'demo', testDate: '2027-07-01' })); c = await boot(adapter);
    const guard = createNavigationGuard({ decide: async () => true });
    const lifecycle = createNavigationOperationLifecycle({ guard });
    let entered, jobEnded = false;
    const jobReady = new Promise(resolve => entered = resolve);
    const job = lifecycle.run({}, operation => runStartupPriceRefresh({ operation, commit: async () => {
        entered();
        await new Promise(resolve => operation.controller.signal.addEventListener('abort', resolve, { once: true }));
        operation.check();
    } }).finally(() => jobEnded = true));
    await jobReady;
    c = createProbelaufController({ win, guard, session: null, reload: () => assert(jobEnded, 'Echter Kursjob endet vor Datumsreload'), restoreReload() {} });
    await c.initialize();
    await c.changeDate('2027-07-02'); await job; c = await boot(adapter);
    assertEqual(c.state.testDate, '2027-07-02', 'Datumssprung mit laufendem Kursjob bestätigt');
    adapter.fail = true;
    let failed = false; try { await c.changeDate('2027-06-01'); } catch { failed = true; }
    assert(failed && c.blocked && c.state.snapshotId, 'Commitfehler blockiert mit Rückkehrpunkt');
    c = await boot(adapter); await c.end(() => true);
    assertEqual(bytes(adapter.values), originals, 'Commitfehler hinterlässt keine Testrecords nach Recovery');
    assertEqual(net, 0, 'Start-, Chart- und Jahreskurswege erreichen nie die werfende Netzwerkfunktion');
} finally { Object.assign(globalThis, { fetch: before.fetch }); UIRenderer.toast = before.toast; UIRenderer.handleActionError = before.error; StorageManager.renderSnapshots = before.render; P.resetPersistenceForTests(); setAppTestDate(null); }

// Alltags-Tauri mit fremder Kennung: echter Musterloader, Neustart, Schutz und Rohrestore.
{
    const alltagsWin = { location: { href: 'tauri://localhost/index.html' }, __TAURI__: { app: { getIdentifier: async () => 'com.fremd.alltag' } } };
    const original = { ...createMusterHaushaltRecords('2026-11-01'), profile_tagesgeld: '00123.40', unrelated: 'bewahren' };
    const adapter = backend(original);
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
    await A.createSnapshot({ id: 'alltag-alt', label: 'Ursprünglicher Punkt', records: { profile_tagesgeld: '00123.40' } });
    const originalPoints = new Map([...adapter.points].map(([id, point]) => [id, JSON.stringify(point)]));
    const options = { win: alltagsWin, session: null, reload() {}, restoreReload() {} };
    const alltagsPayload = buildFullPersistenceBackup();
    assert(normalizeFullPersistenceBackup(alltagsPayload).ok, 'Alltagsimportgegenprobe verwendet fachlich gültige Vollsicherung');
    let c = createProbelaufController(options); await c.initialize();
    assertEqual(c.runtime.kind, 'tauri', 'Fremde Alltagskennung bleibt Tauri');
    const result = await c.start(() => ({ source: 'demo', testDate: '2027-07-01' }));
    assertEqual(result.status, 'reloaded', 'Fremde Alltagskennung startet echten Muster-Haushalt');
    const beforeId = c.state.snapshotId;
    assertEqual(JSON.parse(adapter.values.rs_profiles_v1).profiles.muster_a.meta.name, 'Max', 'Alltagsstart benutzt echten Musterloader');
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
    c = createProbelaufController(options); await c.initialize();
    assertEqual(c.state.phase, 'active', 'Alltagslauf nach Neustart aktiv');
    assertEqual(c.state.testDate, '2027-07-01', 'Alltagslauf setzt Testdatum fort');
    await verifyBackupBlocked(adapter, c, alltagsPayload, 'Fremdes Alltags-Tauri');
    P.setItemSync('profile_tagesgeld', 'Testwert'); await P.flush();
    await A.createSnapshot({ id: 'alltag-test', label: 'Testpunkt', records: {} });
    await c.end(() => true);
    assertEqual(JSON.stringify(adapter.values), JSON.stringify(original), 'Alle ursprünglichen Alltags-Rohrecords bytegleich, Steuerkey und Testrecords entfernt');
    assertEqual(getAppTestDate(), null, 'Alltagsende entfernt Testdatum');
    assertEqual(adapter.points.size, originalPoints.size + 1, 'Nur Vor Probelauf kommt zum ursprünglichen Archiv hinzu');
    for (const [id, bytes] of originalPoints) assertEqual(JSON.stringify(adapter.points.get(id)), bytes, 'Ursprünglicher Alltagsarchivpunkt bytegleich');
    assertEqual(adapter.points.get(beforeId).label, 'Vor Probelauf', 'Verlangter neuer Rückkehrpunkt bleibt erhalten');
    assert(!adapter.points.has('alltag-test'), 'Alltagstestpunkt entfernt');
}
P.resetPersistenceForTests(); setAppTestDate(null); restoreAnnualLocks();
