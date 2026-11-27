// Sicherungsstatus der Vollsicherung: Ohne bestätigtes Schreiben (Browser ohne Speicherdialog; die Desktop-App fragt seit SD-1) heißt er
// „Sicherung angestoßen – bitte Ablage prüfen“ und zählt für die Erinnerung. Mit Speicherdialog zählt erst das bestätigte
// Schreiben; ein Abbruch ändert nichts und ist kein Fehler. Alte Stände ohne Art gelten wie bisher. Nur synthetische Daten.
import fs from 'node:fs';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { OVERVIEW_BACKUP_KEY } from '../app/overview/overview-storage.js';
import { overviewBackupStatus, overviewBackupAge } from '../app/overview/overview-model.js';
import { deliverBackupFile, downloadFullPersistenceBackup, downloadRecoveryPersistenceBackup, bindFullBackupButton,
    normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY, readLastFullBackupStatus, assertBackupSummary, backupDeliveryRecord, buildBackupSummary } from '../app/data/data-backup-summary.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { householdBackupState } from '../app/data/data-households.js';
import { projectDataModel } from '../app/data/data-model.js';
import { renderDataPage } from '../app/data/data-renderer.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { buildRecoveryPersistenceBackup, buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { buildHouseholdTransfer } from '../app/shared/household-transfer.js';
import { importFullPersistenceBackup } from '../app/shared/persistence-backup.js';

const TRIGGERED = 'Sicherung angestoßen – bitte Ablage prüfen';
const anchorDocument = () => {
    const clicks = [];
    return { clicks, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }), body: { appendChild() {} } };
};
const pickerWindow = ({ abort = false, fail = null, writeFail = false } = {}) => {
    const calls = { picker: 0, written: null, aborted: false };
    return { calls, navigator: {}, async showSaveFilePicker(options) {
        calls.picker++; calls.suggestedName = options.suggestedName;
        if (abort) throw Object.assign(new Error('Abgebrochen'), { name: 'AbortError' });
        if (fail) throw Object.assign(new Error(fail), { name: 'SecurityError' });
        return { async createWritable() { return {
            async write(text) { if (writeFail) throw new Error('Platte voll'); calls.written = text; },
            async close() {}, async abort() { calls.aborted = true; } }; } };
    } };
};

// Dateiausgabe: Browser ohne Dialog übergibt nur, mit Dialog wird auf das Schreiben gewartet.
// SD-1: Die Desktop-App öffnet „Speichern unter“ (eigener Befehl) und meldet den gewählten Pfad.
{
    const doc = anchorDocument();
    const tauri = pickerWindow(), invoked = [];
    tauri.__TAURI__ = { core: { invoke: async (command, args) => { invoked.push({ command, ...args }); return 'C:\\Sicher\\voll.json'; } } };
    assertEqual(JSON.stringify(await deliverBackupFile({ a: 1 }, 'voll.json', doc, tauri)), JSON.stringify({ delivery: 'bestaetigt', path: 'C:\\Sicher\\voll.json' }), 'Desktop-App: bestätigt mit gewähltem Pfad');
    assertEqual(`${invoked[0].command} ${invoked[0].defaultName} ${invoked[0].extensions} ${invoked[0].content}`, `save_file_with_dialog voll.json json ${JSON.stringify({ a: 1 }, null, 2)}`, 'Desktop-App: eigener Befehl mit Dateinamen, Filter und Inhalt');
    assertEqual(tauri.calls.picker + doc.clicks.length, 0, 'Desktop-App: weder Browserdialog noch Download');
    tauri.__TAURI__.core.invoke = async () => null;
    assertEqual((await deliverBackupFile({ a: 1 }, 'voll.json', doc, tauri)).delivery, 'abgebrochen', 'Desktop-App: Abbruch im Dialog');
    assertEqual((await deliverBackupFile({ a: 1 }, 'voll.json', doc, { navigator: {} })).delivery, 'angestossen', 'Browser ohne showSaveFilePicker: angestoßen');
    const automated = pickerWindow({ abort: true }); automated.navigator.webdriver = true;
    assertEqual((await deliverBackupFile({ a: 1 }, 'voll.json', doc, automated)).delivery, 'abgebrochen', 'Automatisierung ändert die Regel nicht: Dialog zuerst');
    assertEqual(doc.clicks.length, 1, 'Ohne Dialog: je eine Dateiübergabe');
    const browser = pickerWindow();
    assertEqual(JSON.stringify(await deliverBackupFile({ a: 1 }, 'voll.json', anchorDocument(), browser)), JSON.stringify({ delivery: 'bestaetigt', path: null }), 'Mit Speicherdialog: bestätigt nach dem Schreiben');
    assertEqual(`${browser.calls.suggestedName} ${browser.calls.written}`, `voll.json ${JSON.stringify({ a: 1 }, null, 2)}`, 'Dialog schlägt den Dateinamen vor und schreibt den Inhalt');
    const cancelDoc = anchorDocument();
    assertEqual((await deliverBackupFile({ a: 1 }, 'voll.json', cancelDoc, pickerWindow({ abort: true }))).delivery, 'abgebrochen', 'Abbruch im Dialog');
    assertEqual(cancelDoc.clicks.length, 0, 'Abbruch löst keine zweite Dateiausgabe aus');
    let failed = '';
    try { await deliverBackupFile({ a: 1 }, 'voll.json', anchorDocument(), pickerWindow({ fail: 'Gesperrt' })); } catch (error) { failed = error.message; }
    assertEqual(failed, 'Gesperrt', 'Anderer Dialogfehler bleibt ein Fehler');
    const broken = pickerWindow({ writeFail: true }); failed = '';
    try { await deliverBackupFile({ a: 1 }, 'voll.json', anchorDocument(), broken); } catch (error) { failed = error.message; }
    assert(failed === 'Platte voll' && broken.calls.aborted, 'Schreibfehler wird gemeldet und das Schreiben abgebrochen');
}

// Gespeicherter Status je Weg; der Abbruch ändert weder Zeit noch Vergleichsbasis noch Art.
const backend = new Map();
PersistenceFacade.resetPersistenceForTests({ name: 'ga-3a-backup', async open() {}, async loadAll() { return Object.fromEntries(backend); },
    async saveBatch({ deletes, upserts }) { deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); } });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const data = { depot_tranchen: '[]', profile_tagesgeld: '100' };
const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'A' }, data: { ...data } } } };
for (const [key, value] of Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' })) persistenceStorage.setItem(key, value);
const oldTime = '2026-10-01T10:00:00.000Z';
persistenceStorage.setItem(OVERVIEW_BACKUP_KEY, oldTime);
await PersistenceFacade.flush();
const status = () => readLastFullBackupStatus(persistenceStorage);
const P_records = () => Object.fromEntries(PersistenceFacade.keysSync().map(key => [key, PersistenceFacade.getItemSync(key)]));
assertEqual(JSON.stringify(status()), JSON.stringify({ at: oldTime, delivery: null }), 'Alter Stand ohne Art gilt weiter, Art unbekannt');
const now = new Date('2026-10-02T12:00:00.000Z');
assertEqual(`${overviewBackupStatus(now, oldTime).label} ${overviewBackupStatus(now, oldTime).value}`, 'Letzte Sicherung gestern', 'Alter Stand: Anzeige nach Kalendertag');

const events = [];
const documentStub = { dispatchEvent: event => { events.push(event.type); return true; }, defaultView: { Event } };
const cancelled = await downloadFullPersistenceBackup({ document: documentStub, download: () => 'abgebrochen' });
assertEqual(cancelled.delivery, 'abgebrochen', 'Abbruch meldet sich ohne Fehler');
assertEqual(backend.get(OVERVIEW_BACKUP_KEY), oldTime, 'Abbruch: Sicherungszeit unverändert');
assert(!backend.has(DATA_BACKUP_SUMMARY_KEY), 'Abbruch: keine Vergleichsbasis und keine Art');
assertEqual(events.length, 0, 'Abbruch meldet keine neue Sicherung');

let file;
const triggered = await downloadFullPersistenceBackup({ document: documentStub, download: backup => { file = structuredClone(backup); return true; } });
assertEqual(triggered.delivery, 'angestossen', 'Dateiübergabe ohne Bestätigung: angestoßen');
assertEqual(backend.get(OVERVIEW_BACKUP_KEY), triggered.backup.exportedAt, 'Angestoßen zählt: Sicherungszeit gesetzt');
assertEqual(backend.get(BACKUP_DELIVERY_KEY), backupDeliveryRecord(triggered.backup.exportedAt, 'angestossen'), 'Art „angestoßen“ zur Sicherungszeit gespeichert');
assertEqual(backend.get(DATA_BACKUP_SUMMARY_KEY), file.records[DATA_BACKUP_SUMMARY_KEY], 'Vergleichsbasis bleibt im bisherigen Format, gleich der Datei');
assert(!Object.hasOwn(assertBackupSummary(JSON.parse(backend.get(DATA_BACKUP_SUMMARY_KEY))), 'delivery'), 'Vergleichsbasis ohne Zusatzfeld');
assert(!Object.hasOwn(file.records, BACKUP_DELIVERY_KEY) && file.recordCount === Object.keys(file.records).length, 'Die Datei nennt ihre Ausgabeart nicht');
assert(normalizeFullPersistenceBackup(file).ok, 'Datei bleibt importierbar');
assertEqual(events.length, 1, 'Angestoßene Sicherung aktualisiert die Anzeigen');
const triggeredStatus = status();
const shown = overviewBackupStatus(new Date(triggeredStatus.at), triggeredStatus.at, triggeredStatus.delivery);
assertEqual(`${shown.label} ${shown.value}`, `Letzte Sicherung heute · ${TRIGGERED}`, 'Übersicht: Letzte Sicherung heute · Sicherung angestoßen – bitte Ablage prüfen');
assert(!shown.recommended && !shown.warning && !overviewBackupAge(new Date(triggeredStatus.at), triggeredStatus.at).recommended, 'Erinnerung zählt die angestoßene Sicherung');

const confirmed = await downloadFullPersistenceBackup({ document: documentStub, download: () => 'bestaetigt' });
assertEqual(status().delivery, 'bestaetigt', 'Bestätigtes Schreiben: bestätigt');
const confirmedShown = overviewBackupStatus(new Date(confirmed.backup.exportedAt), confirmed.backup.exportedAt, 'bestaetigt');
assertEqual(`${confirmedShown.label} ${confirmedShown.value}`, 'Letzte Sicherung heute', 'Bestätigt: Anzeige wie bisher');
assertEqual(JSON.stringify(overviewBackupStatus(now, null)), JSON.stringify({ ...overviewBackupAge(now, null), whole: null, when: null, triggered: false, label: '', value: 'Noch keine Vollsicherung' }), 'Ohne Sicherung unverändert');

// Eine Art zu einer anderen Zeit (etwa nach dem Einspielen einer Datei) gilt nicht.
assertEqual(readLastFullBackupStatus({ getItem: key => ({ [OVERVIEW_BACKUP_KEY]: oldTime, [BACKUP_DELIVERY_KEY]: backend.get(BACKUP_DELIVERY_KEY) })[key] ?? null }).delivery, null,
    'Art gilt nur zur eigenen Sicherungszeit');

// Recovery-Export vor einem Import setzt den Status nicht.
const metadata = () => JSON.stringify([OVERVIEW_BACKUP_KEY, DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY].map(key => persistenceStorage.getItem(key)));
const before = metadata();
await downloadRecoveryPersistenceBackup({ document: anchorDocument() });
assertEqual(metadata(), before, 'Recovery-Export ändert den Sicherungsstatus nicht');

// Keine externe Datei nennt die Sicherungsart: Vollsicherung, Recovery-Export und Haushaltsübergabe; Recordzahl und Alias stimmen.
{
    assert(persistenceStorage.getItem(BACKUP_DELIVERY_KEY) !== null, 'Bestand trägt die Sicherungsart');
    const transfer = buildHouseholdTransfer({ id: 'h1', name: 'Haushalt 1', records: P_records() });
    for (const [label, file] of [['Vollsicherung', buildFullPersistenceBackup()], ['Recovery-Export', buildRecoveryPersistenceBackup()], ['Haushaltsübergabe', transfer]]) {
        assert(!Object.hasOwn(file.records, BACKUP_DELIVERY_KEY), `${label}: ohne Sicherungsart`);
        assert(file.recordCount === Object.keys(file.records).length && file.localStorage === file.records, `${label}: Recordzahl und Alias stimmen`);
        assert(normalizeFullPersistenceBackup(file).ok, `${label}: einspielbar`);
    }
}

// Eigener Schlüssel wie die Sicherungszeit: im Bestand geprüft, nicht in Wiederherstellungspunkten; die Vergleichsbasis bleibt streng.
assert(isAllowedPersistenceImportKey(BACKUP_DELIVERY_KEY) && !isAllowedSnapshotCaptureKey(BACKUP_DELIVERY_KEY), 'Art folgt der Schlüsselregel der Sicherungszeit');
assert(!validatePersistenceDomainRecords({ [BACKUP_DELIVERY_KEY]: JSON.stringify({ version: 1, at: oldTime, delivery: 'gesichert' }) }).ok, 'Unbekannte Art wird abgewiesen');
assert(validatePersistenceDomainRecords({ [BACKUP_DELIVERY_KEY]: backupDeliveryRecord(oldTime, 'bestaetigt') }).ok, 'Gültige Art wird angenommen');
const basis = JSON.parse(backend.get(DATA_BACKUP_SUMMARY_KEY));
assert(!validatePersistenceDomainRecords({ [OVERVIEW_BACKUP_KEY]: basis.exportedAt, [DATA_BACKUP_SUMMARY_KEY]: JSON.stringify({ ...basis, delivery: 'bestaetigt' }) }).ok, 'Vergleichsbasis nimmt kein Zusatzfeld an');

// Statuszeile am Knopf „Jetzt sichern“ (Daten & Sicherung, Jahresabschluss) je Weg.
for (const [result, expected, kind] of [['abgebrochen', 'Speichern abgebrochen – keine Sicherung erstellt.', ''], [true, TRIGGERED, 'ok'], ['bestaetigt', 'Komplettes fachliches Backup gespeichert', 'ok']]) {
    const listeners = {}, status = { dataset: {}, textContent: '' };
    const button = { disabled: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
    bindFullBackupButton({ document: documentStub, button, status, download: () => result });
    await listeners.click();
    assert(status.textContent.includes(expected), `Statuszeile ${String(result)}: ${expected}`);
    assertEqual(status.dataset.kind, kind, `Statuszeile ${String(result)}: kein Fehler`);
    if (kind) assert(/\(\d+ Einträge\)/.test(status.textContent), `Statuszeile ${String(result)}: „Einträge“ mit Umlaut`);
}

// Daten & Sicherung: Kachel, Kontext und Haushaltstabelle nennen die angestoßene Sicherung.
{
    const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
    const doc = createPresentationTestDocument();
    const createElement = doc.createElement.bind(doc);
    doc.createElement = tag => { const node = createElement(tag); node.dataset = {}; return node; };
    for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])) { const node = doc.createElement('div'); node.id = id; node.dataset = {}; doc.body.appendChild(node); }
    const time = '2026-10-02T09:00:00.000Z';
    const records = { [OVERVIEW_BACKUP_KEY]: time, [BACKUP_DELIVERY_KEY]: backupDeliveryRecord(time, 'angestossen') };
    const model = await projectDataModel({ records, now });
    assertEqual(model.backupDelivery, 'angestossen', 'Datenmodell liest die Art');
    renderDataPage(doc, model);
    assert(doc.getElementById('dataBackupDate').textContent.endsWith(` · ${TRIGGERED}`), 'Kachel nennt „Sicherung angestoßen – bitte Ablage prüfen“');
    assertEqual(doc.getElementById('dataBackupContext').textContent, 'Sicherung angestoßen am 02.10.2026', 'Kontext nennt die angestoßene Sicherung');
    assertEqual(doc.getElementById('dataBackupTile').dataset.state, 'ok', 'Angestoßene Sicherung zählt ohne Warnung');
    renderDataPage(doc, await projectDataModel({ records: { [OVERVIEW_BACKUP_KEY]: time }, now }));
    assertEqual(doc.getElementById('dataBackupContext').textContent, 'Gesichert am 02.10.2026', 'Alter Stand: Kontext wie bisher');
    assertEqual(householdBackupState(time, now, 'angestossen').text, 'heute (angestoßen)', 'Haushaltstabelle kennzeichnet die angestoßene Sicherung');
    assertEqual(householdBackupState(time, now, null).text, 'heute', 'Haushaltstabelle ohne Art wie bisher');
}
{
    const doc = createPresentationTestDocument();
    const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) { const node = doc.createElement('div'); node.id = id; doc.body.append(node); }
    // ST7-FIX (Gutachten ST7 P2-1): Eine echte Vollsicherung trägt ihr Dateidatum auch als Sicherungszeit (download.js).
    const asFile = async (exportedAt, backupTime) => {
        const base = buildFullPersistenceBackup(), records = { ...base.records };
        delete records[OVERVIEW_BACKUP_KEY]; delete records[DATA_BACKUP_SUMMARY_KEY];
        if (backupTime) Object.assign(records, { [OVERVIEW_BACKUP_KEY]: backupTime, [DATA_BACKUP_SUMMARY_KEY]: JSON.stringify(await buildBackupSummary(records, backupTime)) });
        return { ...base, exportedAt, records, localStorage: records, recordCount: Object.keys(records).length };
    };
    const file = await asFile('2026-09-03T12:00:00.000Z', '2026-09-03T12:00:00.000Z');
    const archive = { writeSnapshot: async point => { archive.point = point; },
        readSnapshot: async () => archive.point, listSnapshots: async () => [] };
    const day = now => now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const started = new Date();
    const imported = await importFullPersistenceBackup(file, { snapshotStorage: archive });
    assert(imported.ok, `Vollsicherung ist eingespielt: ${imported.ok ? '' : imported.technical || imported.message}`);
    renderDataPage(doc, await projectDataModel({ records: P_records() }));
    const header = () => doc.getElementById('dataBackupContext').textContent;
    assert([started, new Date()].some(now => header() === `Sicherung vom 03.09.2026 eingespielt am ${day(now)}`),
        'Der Kopf nennt das Dateidatum und den Tag des Einspielens');
    await downloadFullPersistenceBackup({ document: documentStub, download: () => 'abgebrochen' });
    renderDataPage(doc, await projectDataModel({ records: P_records() }));
    assert(header().includes('eingespielt'), 'Abgebrochene Sicherung erhält den Kopftext');
    await downloadFullPersistenceBackup({ document: documentStub, download: () => 'bestaetigt' });
    renderDataPage(doc, await projectDataModel({ records: P_records() }));
    assert(header().startsWith('Gesichert am '), 'Eigene Vollsicherung setzt den Kopftext zurück');
    // Gegenfall 3: Eine Datei ohne Vollsicherungszeit zählt nicht als Vollsicherung. Kopf und Karte nennen beide keine Vollsicherung.
    const bare = await importFullPersistenceBackup(await asFile('2026-09-04T12:00:00.000Z', null), { snapshotStorage: archive });
    assert(bare.ok, `Datei ohne Sicherungszeit ist eingespielt: ${bare.ok ? '' : bare.message}`);
    renderDataPage(doc, await projectDataModel({ records: P_records() }));
    assert([started, new Date()].some(now => header() === `Datei vom 04.09.2026 eingespielt am ${day(now)} · noch keine Vollsicherung`),
        `Gegenfall 3: Der Kopf nennt die Datei und keine Vollsicherung (${header()})`);
    assertEqual(doc.getElementById('dataBackupAge').textContent, 'Noch keine Vollsicherung', 'Gegenfall 3: Die Karte sagt dasselbe');
}
// ST7-B (Befund 1047): „heute“, „gestern“ und „vor n Tagen“ zählen Kalendertage in Europe/Berlin, nicht 24 Stunden.
// Karte, Haushaltsliste und Übersicht sagen dasselbe. Zeiten in UTC, Berliner Winterzeit = UTC + 1.
{
    const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
    const doc = createPresentationTestDocument();
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) { const node = doc.createElement('div'); node.id = id; doc.body.append(node); }
    for (const [backup, view, expected, label] of [
        ['2026-11-24T22:50:00.000Z', '2026-11-24T23:10:00.000Z', 'gestern', '23:50 gesichert, 00:10 angesehen'],
        ['2026-11-24T09:58:00.000Z', '2026-11-25T09:45:00.000Z', 'gestern', 'Gestern 10:58 heißt am nächsten Morgen nicht „heute“'],
        ['2026-11-24T23:05:00.000Z', '2026-11-25T22:55:00.000Z', 'heute', 'Derselbe Berliner Tag bleibt „heute“'],
        ['2026-11-22T22:59:00.000Z', '2026-11-23T23:01:00.000Z', 'vor 2 Tagen', 'Zwei Mitternächte in gut 24 Stunden heißen „vor 2 Tagen“']]) {
        const at = new Date(view);
        renderDataPage(doc, await projectDataModel({ records: { [OVERVIEW_BACKUP_KEY]: backup }, now: at }));
        assertEqual(doc.getElementById('dataBackupAge').textContent, expected, `Karte: ${label}`);
        assertEqual(householdBackupState(backup, at).text, expected, `Haushaltsliste: ${label}`);
        assertEqual(overviewBackupStatus(at, backup).value, expected, `Übersicht: ${label}`);
    }
}
PersistenceFacade.resetPersistenceForTests();
