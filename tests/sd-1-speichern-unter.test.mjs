// SD-1: Die Desktop-App speichert Sicherungen und Exporte über den Dialog „Speichern unter“ (Befehl save_file_with_dialog),
// der Browser lädt wie bisher herunter. Erst eine gespeicherte Datei zählt als Vollsicherung; ein Abbruch ändert nichts.
// Befund 1908: Die Erfolgsmeldung nennt in der Desktop-App den gewählten Pfad. Nur synthetische Daten, Tauri nur als Fake-invoke.
import { saveTextFile, lockWhileSaving, SAVE_CANCELLED_TEXT, BACKUP_SAVE_CANCELLED_TEXT } from '../app/shared/save-file.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { bindFullBackupButton, bindFullBackupImport, buildFullPersistenceBackup, downloadRecoveryPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { OVERVIEW_BACKUP_KEY } from '../app/overview/overview-storage.js';
import { DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY, readLastFullBackupStatus } from '../app/data/data-backup-summary.js';
import { dataBackupStatus } from '../app/data/data-page.js';

const PATH = 'D:\\Sync\\Sicherungen\\Vollsicherung.json';
const tauriWindow = answer => {
    const calls = [];
    return { calls, __TAURI__: { core: { invoke: async (command, args) => { calls.push({ command, ...args }); return typeof answer === 'function' ? answer() : answer; } } } };
};
const browserDocument = () => {
    const clicks = [];
    return { clicks, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { appendChild() {} } };
};
const browserUrl = () => { const blobs = []; return { blobs, createObjectURL: blob => { blobs.push(blob); return 'blob:sd-1'; }, revokeObjectURL() {} }; };

// Helfer, Desktop-App: Befehl mit Dateinamen, Filter und Inhalt; Pfad bzw. Abbruch; Fehler als Error.
{
    const doc = browserDocument();
    const win = tauriWindow(PATH);
    const saved = await saveTextFile({ filename: 'Export.csv', content: 'a;b', mime: 'text/csv', doc, win });
    assertEqual(JSON.stringify(saved), JSON.stringify({ saved: true, path: PATH }), 'Desktop-App: gespeichert mit gewähltem Pfad');
    assertEqual(JSON.stringify(win.calls[0]), JSON.stringify({ command: 'save_file_with_dialog', defaultName: 'Export.csv', content: 'a;b', filterName: 'CSV-Datei', extensions: ['csv'] }),
        'Desktop-App: Dateiname, Filter aus der Endung und Inhalt gehen an den Befehl');
    const named = tauriWindow(PATH);
    await saveTextFile({ filename: 'Sicherung.json', content: '{}', filterName: 'Vollsicherung', extensions: ['json'], doc, win: named });
    assertEqual(`${named.calls[0].filterName} ${named.calls[0].extensions}`, 'Vollsicherung json', 'Desktop-App: eigener Filter des Aufrufers');
    assertEqual(JSON.stringify(await saveTextFile({ filename: 'Export.csv', content: 'a', doc, win: tauriWindow(null) })), JSON.stringify({ saved: false }), 'Desktop-App: Abbruch im Dialog');
    let failure = null;
    try { await saveTextFile({ filename: 'Export.csv', content: 'a', doc, win: tauriWindow(() => Promise.reject('Datei konnte nicht gespeichert werden: Zugriff verweigert')) }); }
    catch (error) { failure = error; }
    assert(failure instanceof Error && failure.message.includes('Zugriff verweigert'), 'Desktop-App: Schreibfehler aus Rust kommt als Fehler mit Text');
    failure = null;
    try { await saveTextFile({ filename: 'Export.csv', content: 'a', doc, win: { __TAURI__: { core: {} } } }); } catch (error) { failure = error; }
    assert(failure?.message.includes('nicht verfügbar'), 'Desktop-App ohne invoke: klarer Fehler statt stiller Download');
    assertEqual(doc.clicks.length, 0, 'Desktop-App: kein Download über einen Link');
}

// Helfer, Browser: Download wie bisher, startet noch im Aufruf; kein Pfad.
{
    const doc = browserDocument(), urlApi = browserUrl();
    const pending = saveTextFile({ filename: 'Export.csv', content: 'a;b', mime: 'text/csv;charset=utf-8;', doc, win: { navigator: {} }, urlApi, BlobCtor: Blob });
    assertEqual(doc.clicks.join(), 'Export.csv', 'Browser: Download startet synchron mit dem vorgeschlagenen Namen');
    assertEqual(JSON.stringify(await pending), JSON.stringify({ saved: true, path: null }), 'Browser: gespeichert ohne Pfad');
    assert(urlApi.blobs[0].type === 'text/csv;charset=utf-8;' && await urlApi.blobs[0].text() === 'a;b', 'Browser: Inhalt und MIME bleiben');
}

// Exportknöpfe: gesperrt, solange der Dialog offen ist; ein vorher gesperrter Knopf bleibt gesperrt.
{
    let finish;
    const json = { disabled: false }, csv = { disabled: false }, other = { disabled: true };
    const saving = lockWhileSaving([json, csv, other, null], new Promise(resolve => { finish = resolve; }));
    assert(json.disabled && csv.disabled, 'Offener Dialog sperrt beide Exportknöpfe');
    finish({ saved: false });
    assertEqual(JSON.stringify(await saving), JSON.stringify({ saved: false }), 'Sperre reicht das Ergebnis durch');
    assert(!json.disabled && !csv.disabled && other.disabled, 'Nach dem Dialog frei; fremde Sperre bleibt');
}

// Vollsicherung in der Desktop-App: Abbruch bucht nichts, Erfolg bucht und nennt den Pfad.
const backend = new Map();
PersistenceFacade.resetPersistenceForTests({ name: 'sd-1-backup', async open() {}, async loadAll() { return Object.fromEntries(backend); },
    async saveBatch({ deletes, upserts }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); } });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const data = { depot_tranchen: '[]', profile_tagesgeld: '100' };
const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'A' }, data: { ...data } } } };
for (const [key, value] of Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' })) persistenceStorage.setItem(key, value);
const oldTime = '2026-10-01T10:00:00.000Z';
persistenceStorage.setItem(OVERVIEW_BACKUP_KEY, oldTime);
await PersistenceFacade.flush();

const pageDocument = () => {
    const nodes = { fullBackupStatus: { dataset: {}, textContent: '' }, dataBackupTechnical: { textContent: '' } };
    return { nodes, getElementById: id => nodes[id] || null, dispatchEvent: () => true, defaultView: { Event } };
};
const pressBackup = async win => {
    const page = pageDocument(), listeners = {};
    const button = { disabled: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
    bindFullBackupButton({ document: /** @type {any} */ (page), window: win, button, status: dataBackupStatus(page) });
    await listeners.click();
    return page.nodes;
};
{
    const cancelWindow = tauriWindow(null);
    const nodes = await pressBackup(cancelWindow);
    assertEqual(cancelWindow.calls[0]?.command, 'save_file_with_dialog', 'Jetzt sichern öffnet in der Desktop-App den Dialog');
    assertEqual(cancelWindow.calls[0].filterName, 'Vollsicherung', 'Dialogfilter heißt Vollsicherung');
    assertEqual(nodes.fullBackupStatus.textContent, BACKUP_SAVE_CANCELLED_TEXT, 'Abbruch: „Speichern abgebrochen – keine Sicherung erstellt.“');
    assert(nodes.fullBackupStatus.dataset.kind !== 'error', 'Abbruch ist kein Fehler');
    assertEqual(backend.get(OVERVIEW_BACKUP_KEY), oldTime, 'Abbruch: Datum der letzten Vollsicherung unverändert');
    assert(!backend.has(DATA_BACKUP_SUMMARY_KEY) && !backend.has(BACKUP_DELIVERY_KEY), 'Abbruch: keine Vergleichsbasis und keine Buchung');

    const savedWindow = tauriWindow(PATH);
    const saved = await pressBackup(savedWindow);
    assertEqual(saved.fullBackupStatus.textContent, `Vollsicherung gespeichert unter ${PATH}.`, 'Erfolg: Meldung nennt Ordner und Dateinamen (Befund 1908)');
    assertEqual(saved.fullBackupStatus.dataset.kind, 'ok', 'Erfolg ist als Erfolg gekennzeichnet');
    const written = JSON.parse(savedWindow.calls[0].content);
    assert(savedWindow.calls[0].defaultName.endsWith('.json') && written.records.depot_tranchen === '[]', 'Datei enthält die Vollsicherung unter vorgeschlagenem Namen');
    const status = readLastFullBackupStatus(persistenceStorage);
    assert(status.at === written.exportedAt && status.at !== oldTime, 'Erfolg: Datum der letzten Vollsicherung gebucht');
    assertEqual(status.delivery, 'bestaetigt', 'Erfolg: gilt als bestätigt, kein „bitte Ablage prüfen“');
    assertEqual(backend.get(DATA_BACKUP_SUMMARY_KEY), written.records[DATA_BACKUP_SUMMARY_KEY], 'Erfolg: Vergleichsbasis gleich der Datei');
}

// Rettungsdatei vor dem Import: Abbruch im Dialog liefert saved: false, der Import ersetzt dann nichts.
{
    const before = JSON.stringify([...backend]);
    const recovery = await downloadRecoveryPersistenceBackup({ document: /** @type {any} */ ({ defaultView: tauriWindow(null) }) });
    assert(recovery.saved === false && recovery.skipped === false, 'Rettungsdatei: Abbruch wird gemeldet');
    const handlers = {}, status = { dataset: {}, textContent: '' };
    const button = { addEventListener(type, handler) { handlers[`button:${type}`] = handler; } };
    const fileInput = { value: 'selected', files: [{}], addEventListener(type, handler) { handlers[`file:${type}`] = handler; }, click() {} };
    const file = buildFullPersistenceBackup(), oldReader = globalThis.FileReader;
    file.records.profile_tagesgeld = '250';
    globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(file); this.onload(); } };
    let reloads = 0;
    try {
        bindFullBackupImport({ document: /** @type {any} */ ({}), button, fileInput, status, guard: createNavigationGuard(), confirmImport: () => true,
            reload: () => { reloads++; }, createRecoveryBackup: async () => ({ skipped: false, saved: false }) });
        await handlers['file:change']();
    } finally { globalThis.FileReader = oldReader; }
    assertEqual(status.textContent, `${BACKUP_SAVE_CANCELLED_TEXT} Import abgebrochen; die gespeicherten Daten wurden nicht ersetzt.`, 'Import: Abbruch der Rettungsdatei hält den Import an');
    assertEqual(JSON.stringify([...backend]), before, 'Import: Bestand unverändert');
    assertEqual(reloads, 0, 'Import: kein Neuladen');
}
assertEqual(SAVE_CANCELLED_TEXT, 'Speichern abgebrochen – keine Datei erstellt.', 'Exporte melden den Abbruch ohne Fehler');
PersistenceFacade.resetPersistenceForTests();
