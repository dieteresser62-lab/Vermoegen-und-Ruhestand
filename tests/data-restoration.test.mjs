import fs from 'node:fs';
import { createDataRestorationController, restorePreviewRows, reportDataRestoration } from '../app/data/data-restoration.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, buildSnapshot } from '../app/shared/snapshot-archive.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { renderDataPage } from '../app/data/data-renderer.js';
import { projectDataModel } from '../app/data/data-model.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
const registry = JSON.stringify({ version: 1, profiles: { a: { meta: { name: 'A' }, data: {} }, b: { meta: { name: '<img src=x>' }, data: {} } } });
const snapshot = buildSnapshot({ id: 'page-target', label: '<img src=x onerror=alert(1)>', activeProfileId: 'a',
    createdAt: '2026-01-01T12:00:00Z', records: { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a', profile_tagesgeld: '20' } });
let records, snapshots, writes;
async function init() {
    records = { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a', profile_tagesgeld: '10' };
    snapshots = new Map([[snapshot.id, snapshot]]); writes = 0;
    resetPersistenceForTests({ name: 'synthetic', open: async () => {}, loadAll: async () => ({ ...records }),
        saveBatch: async ({ upserts, deletes }) => { writes++; deletes.forEach(key => { delete records[key]; }); upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async snapshot => { writes++; snapshots.set(snapshot.id, snapshot); }, readSnapshot: async id => snapshots.get(id),
        listSnapshots: async () => [...snapshots.values()], deleteSnapshot: async id => { writes++; snapshots.delete(id); } });
    await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
await init();
let reloads = 0;
const controller = createDataRestorationController({ guard: createNavigationGuard(), reload: () => { reloads++; } });
const original = JSON.stringify(records);
const plan = await controller.preview(snapshot.id);
assertEqual(writes, 0, 'Echte Seitenvorschau bleibt schreibfrei');
assert(restorePreviewRows(plan).some(row => row.title === 'Tagesgeld' && row.detail === '10 € → 20 €'), 'Vorschau nennt tatsächliche Tagesgeldänderung');
controller.cancel();
assertEqual((await controller.executeRestore()).status, 'in_flight', 'Abbruch verwirft bestätigbaren Plan');
assertEqual(JSON.stringify(records), original, 'Abbruch lässt Records bytegleich');
assertEqual(snapshots.size, 1, 'Abbruch erzeugt keinen Punkt');
await controller.preview(snapshot.id);
const result = await controller.executeRestore();
assertEqual(result.status, 'restored', 'Tatsächliche Bestätigung führt gemeinsamen Restore aus');
assertEqual(reloads, 1, 'Bestätigung lädt genau einmal neu');
assertEqual(records.profile_tagesgeld, '20', 'Bestätigung schreibt Vorschauziel');
assertEqual(snapshots.size, 2, 'Bestätigung erzeugt genau einen Recoverypunkt');
assert(controller.blocked, 'Alte Dokumentgeneration bleibt nach Bestätigung gesperrt');
assertEqual((await controller.executeRestore()).status, 'in_flight', 'Erneute Bestätigung schreibt nicht doppelt');
await init();
const failedReload = createDataRestorationController({ guard: createNavigationGuard(), reload: () => false });
await failedReload.preview(snapshot.id);
assertEqual((await failedReload.executeRestore()).status, 'reload_required', 'Reloadfehler ist sichtbar statt falscher Erfolg');
assert(failedReload.blocked, 'Reloadfehler sperrt veraltete UI');
assertEqual(await failedReload.preview(snapshot.id), null, 'Gesperrte UI öffnet keine weitere Aktion');
await init();
const stale = createDataRestorationController({ guard: createNavigationGuard(), reload: () => true });
await stale.preview(snapshot.id);
p.setItemSync('rs_current_profile', 'b'); await p.flush();
let error; try { await stale.executeRestore(); } catch (caught) { error = caught; }
assert(error?.message.includes('seit der Vorschau geändert'), 'Profilwechsel invalidiert die eingebettete Vorschau');
assertEqual(snapshots.size, 1, 'Profilwechsel legt keinen Rückkehrpunkt an');
const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
const doc = createPresentationTestDocument();
for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])) {
    const element = doc.createElement('div'); element.id = id; element.dataset = {}; doc.body.appendChild(element);
}
// Präsentationsfake besitzt keine dataset-Initialisierung für neue dynamische Elemente.
const create = doc.createElement.bind(doc); doc.createElement = tag => { const node = create(tag); node.dataset = {}; return node; };
const index = await SnapshotArchive.listSnapshots();
const model = await projectDataModel({ records: {}, snapshots: index });
renderDataPage(doc, { ...model, profileIds: ['a'] });
const row = doc.getElementById('dataSnapshotList').children[0];
assertEqual(row.children[0].textContent, snapshot.label, 'Archivlabel wird als Text und nicht als HTML ausgegeben');
assertEqual(row.children[0].children.length, 0, 'Label erzeugt keine ausführbaren Kindknoten');
renderDataPage(doc, { ...model, profileIds: ['b'] });
assert(doc.getElementById('dataSnapshotList').children[0].children.find(node => node.tagName === 'button').disabled, 'Fehlende Profilzuordnung sperrt Vorschau sichtbar');
renderDataPage(doc, { ...model, archiveError: 'beschädigt' });
assert(doc.getElementById('dataRetentionPreview').disabled, 'Archivschaden sperrt Aufräumen');
assert(doc.getElementById('dataRestoreStatus').textContent.includes('gesperrt'), 'Archivschaden erzeugt sichtbaren Zustand');
resetPersistenceForTests();

// Anzeige folgt dem echten Scopeplan in allen drei bestehenden Modi.
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';
for (const mode of ['standard', 'full-import', 'snapshot-full']) {
    const before = { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a', profile_tagesgeld: '98000',
        depot_tranchen: '[]', balance_expenses_2025: '{}', rs_daily_prices_v1: 'daily-before' };
    const point = buildSnapshot({ id: 'scope-' + mode, activeProfileId: 'a',
        kind: mode === 'full-import' ? 'full-backup-import-recovery' : mode === 'snapshot-full' ? 'person-data-migration-recovery' : 'manual',
        ...(mode !== 'standard' ? { restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' } } : {}),
        records: { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a', profile_tagesgeld: '101000', depot_tranchen: '[]', rs_daily_prices_v1: 'daily-after' } });
    const rows = restorePreviewRows(buildSnapshotRestorePlan(point, before));
    assert(rows.some(row => row.title === 'Tagesgeld' && row.detail === '98.000 € → 101.000 €'), mode + ': Geld mit Tausenderpunkt und Euro');
    assert(rows.some(row => row.title === 'Tranchen' && row.action === 'unverändert (0)'), mode + ': unveränderte Menge fachlich erklärt');
    assert(rows.some(row => row.title === 'Ausgaben 2025' && row.action === 'entfällt' && row.removed), mode + ': entferntes Fachgebiet ist rot markierbar');
    assertEqual(rows.some(row => row.title === 'Tageskurse' && row.action === 'bleiben erhalten'), mode !== 'full-import', mode + ': erhaltene Tageskurse entsprechen der echten Keypolicy');
    assert(!rows.some(row => /rs_|profile_|→ a|→ b/.test(row.title + row.detail)), mode + ': keine Profil-IDs oder Speicherkeys als Fachbeschreibung');
}

// Echter Binder: Vorschau umschalten, Escape/Rückfokus und Null-Aufräumdialog.
import { bindDataRestoration } from '../app/data/data-restoration.js';
await init();
const ui = createPresentationTestDocument(), dialogs = [];
const makeNode = ui.createElement.bind(ui);
ui.createElement = tag => {
    const node = makeNode(tag); node.dataset = {};
    node.focus = () => { ui.activeElement = node; };
    node.removeEventListener = type => node.events.delete(type);
    node.closest = selector => selector === 'li' ? node.parentNode : node;
    node.close = () => { node.open = false; };
    node.showModal = () => {
        node.open = true;
        const controls = node.children.at(-1).children;
        dialogs.push({ title: node.children[0].textContent,
            controls: controls.filter(item => item.dataset?.pageDialogAccept === '').map(item => item.textContent) });
        queueMicrotask(() => controls.find(item => item.dataset?.pageDialogAccept === '').click());
    };
    return node;
};
for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])) { const node = ui.createElement('div'); node.id = id; ui.body.appendChild(node); }
const rowNode = ui.createElement('li'), buttonNode = ui.createElement('button');
buttonNode.dataset.restorePreview = snapshot.id; rowNode.appendChild(buttonNode); ui.getElementById('dataSnapshotList').appendChild(rowNode);
const bound = bindDataRestoration(ui, { guard: createNavigationGuard() });
const openPreview = () => ui.getElementById('dataSnapshotList').events.get('click')({ target: buttonNode });
await openPreview();
assertEqual(buttonNode.textContent, 'Vorschau schließen', 'Offene Zeile wechselt ihre Textaktion');
assertEqual(rowNode.dataset.selected, 'true', 'Offene Zeile besitzt beige Auswahlmarkierung');
assert(ui.getElementById('dataRestorePreviewTitle').textContent.endsWith('– was sich ändert'), 'Entwurfstitel beschreibt Vorschau');
await openPreview();
assert(ui.getElementById('dataRestorePreview').hidden, 'Zeilenaktion schließt die Vorschau');
assertEqual(ui.activeElement, buttonNode, 'Schließen gibt Fokus an die Zeilenaktion zurück');
await openPreview();
ui.getElementById('dataRestorePreview').events.get('keydown')({ key: 'Escape' });
assert(ui.getElementById('dataRestorePreview').hidden && ui.activeElement === buttonNode, 'Escape schließt und stellt Rückfokus her');
const oldFlush = p.flush;
p.flush = async () => false;
try {
    await openPreview();
    assert(ui.getElementById('dataRestorePreview').hidden, 'Flushfehler öffnet keine Seitenvorschau');
    assert(!ui.getElementById('dataRestoreStatus').textContent.includes('PERSISTENCE_FLUSH_FAILED'), 'Flushfehler bleibt im Hauptbereich verständlich');
    assert(ui.getElementById('dataRestoreTechnical').textContent.includes('PERSISTENCE_FLUSH_FAILED'), 'Flushfehlerursache bleibt in geschlossenen Details');
    assertEqual(snapshots.size, 1, 'Fehlgeschlagene Seitenvorschau erzeugt keine Recovery');
} finally { p.flush = oldFlush; }
reportDataRestoration(ui, { message: 'Punkt entfernt.', kind: 'ok' });
assertEqual(ui.getElementById('dataRestoreStatus').textContent, 'Punkt entfernt.', 'Gemeinsame Ausgabe setzt die fachliche Hauptmeldung');
assertEqual(ui.getElementById('dataRestoreStatus').dataset.kind, 'ok', 'Gemeinsame Ausgabe setzt die Statusart');
assertEqual(ui.getElementById('dataRestoreTechnical').textContent, '', 'Erfolg entfernt die technische Altmeldung des echten Restorefehlers');
const writeCount = writes;
await ui.getElementById('dataRetentionPreview').events.get('click')({ currentTarget: ui.getElementById('dataRetentionPreview') });
assertEqual(dialogs.at(-1).title, 'Nichts aufzuräumen', 'Nullplan zeigt einen reinen Informationsdialog');
assertEqual(JSON.stringify(dialogs.at(-1).controls), JSON.stringify(['Verstanden']), 'Nullplan bietet nur Verstanden an');
assertEqual(writes, writeCount, 'Nullplan ruft keinen Cleanupwrite auf');
assertEqual(snapshots.size, 1, 'Nullplan erhält alle Archivpunkte');
assert(!bound.busy, 'Dialogende gibt die Bedienung wieder frei');
snapshots.set('newer-covered', buildSnapshot({ ...snapshot, id: 'newer-covered', createdAt: '2026-01-02T12:00:00Z' }));
await ui.getElementById('dataRetentionPreview').events.get('click')({ currentTarget: ui.getElementById('dataRetentionPreview') });
assertEqual(dialogs.at(-1).title, 'Wiederherstellungspunkte aufräumen', 'Nichtleerer Plan verlangt echte Löschbestätigung');
assertEqual(JSON.stringify(dialogs.at(-1).controls), JSON.stringify(['Jetzt aufräumen']), 'Nichtleerer Plan behält den bestehenden Bestätigungsweg');
assert(!snapshots.has(snapshot.id) && snapshots.has('newer-covered'), 'Bestätigtes Aufräumen entfernt nur den tatsächlich abgedeckten Punkt');
assertEqual(writes, writeCount + 1, 'Nichtleerer Plan bestätigt genau einen Cleanupwrite');

resetPersistenceForTests();

const monthBefore = { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a',
    overview_month_provision_v1: JSON.stringify({ version: 1, entries: { syntheticScopeKey: { month: '2026-10', scope: { key: 'synthetic_person_ids' } } } }) };
const monthPoint = buildSnapshot({ id: 'month-diff', activeProfileId: 'a', records: { rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a' } });
assert(restorePreviewRows(buildSnapshotRestorePlan(monthPoint, monthBefore)).some(row => row.title === 'Monatsabschluss Oktober 2026' && row.action === 'entfällt'), 'Vorschau erklärt entfallende Monatsbelege ohne interne Scopekennungen');

{
const flexScope = { kind: 'single', ids: ['a'], key: JSON.stringify(['single', ['a']]) };
const flexCommon = { scope: flexScope, completedAt: '2026-10-12T12:00:00Z', priceBasis: 'nominal',
    fingerprintVersion: 2, sourceFingerprint: 'a'.repeat(64), runFingerprint: 'b'.repeat(64), deviationApplied: false };
const flexOld = { ...flexCommon, kind: 'backtest', statement: 'completed',
    metrics: { startYear: 2000, endYear: 2002, failureYear: null, endWealthReal: 100 } };
const flexNew = { ...flexCommon, kind: 'montecarlo', statement: 'Floor gedeckt bis Laufende',
    metrics: { runs: 2, covered: 2, successPct: 100, median: 10, p5: 1,
        minimumFlexStartNominalEur: 30000, minimumFlexYearSharePct: 100 / 6,
        minimumFlexAffectedRunSharePct: 50, flexPaidMedianNominalEur: 32500,
        flexDesiredMedianNominalEur: 45000, flexPaidMinimumNominalEur: 29000 } };
const flexRecord = JSON.stringify({ version: 1, entries: {
    [JSON.stringify([flexScope.key, 'backtest'])]: flexOld, [JSON.stringify([flexScope.key, 'montecarlo'])]: flexNew } });
const flexLegacyRecord = JSON.stringify({ version: 1, entries: { [JSON.stringify([flexScope.key, 'backtest'])]: flexOld } });
    await init();
    const withResults = buildSnapshot({ id: 'results-target', activeProfileId: 'a', createdAt: '2026-01-01T12:00:00Z',
        records: { ...snapshot.records, overview_simulation_summary_v1: flexRecord } });
    snapshots.set(withResults.id, withResults);
    p.setItemSync('overview_simulation_summary_v1', flexLegacyRecord); await p.flush();
    const restore = createDataRestorationController({ guard: createNavigationGuard(), reload: () => true });
    await restore.preview(withResults.id);
    assertEqual((await restore.executeRestore()).status, 'restored', 'Datenseitencontroller restauriert Alt-/Neu-Belege');
    assertEqual(records.overview_simulation_summary_v1, flexRecord, 'Datenseitenrestore löscht oder verändert keine Ergebniswerte');
}
