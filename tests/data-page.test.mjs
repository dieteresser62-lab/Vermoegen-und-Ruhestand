import fs from 'node:fs';
import { projectDataModel, readDataModel } from '../app/data/data-model.js';
import { renderDataPage, backupChangesTitle } from '../app/data/data-renderer.js';
import { initDataPage, dataBackupStatus } from '../app/data/data-page.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBackupSummary, DATA_BACKUP_SUMMARY_KEY } from '../app/data/data-backup-summary.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } from '../app/tranches/tranchen-history-store.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PersistenceFacade, resetPersistenceForTests, getDirtyState } from '../app/shared/persistence-facade.js';
import { buildSnapshot } from '../app/shared/snapshot-archive.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { PROBELAUF_RESTORE_HINT } from '../app/shared/probelauf-runtime.js';
const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
assert(!html.includes('id="dataBackupTop"') && (html.match(/>Jetzt sichern<\/button>/g) || []).length === 1
    && /id="daten-sicherung"[\s\S]*?id="fullBackupBtn"[^>]*>Jetzt sichern<\/button>/.test(html),
    'Jetzt sichern bleibt ausschließlich in der Vollsicherungskarte');
assert(!html.includes('dataTrialTitle') && !html.includes('Ausprobieren ohne Risiko')
    && !html.includes('Spielbereich mit Muster-Haushalt oder einer Kopie deiner Daten:')
    && /class="suite-header"[\s\S]*?id="probelaufStart"/.test(html),
    'Probelaufkarte entfällt; Einstieg bleibt in der Kopfzeile');
const time = '2026-09-01T12:00:00.000Z', now = new Date('2026-10-02T12:00:00.000Z');
const doc = createPresentationTestDocument();
const createElement = doc.createElement.bind(doc);
doc.createElement = tag => { const node = createElement(tag); node.dataset = {}; return node; };
for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])) { const node = doc.createElement('div'); node.id = id; node.dataset = {}; doc.body.appendChild(node); }
const model = await projectDataModel({ records: { overview_last_full_backup_v1: time }, now, backend: 'IndexedDB' });
renderDataPage(doc, model);
assertEqual(doc.getElementById('dataBackupAge').textContent, 'vor 31 Tagen', 'Zustand 02 liest tatsächliche Sicherungszeit');
assertEqual(doc.getElementById('dataBackupTile').dataset.state, 'warning', 'Überfällige Sicherung zeigt Warnzustand');
assert(doc.getElementById('dataBackupChanges').hidden && doc.getElementById('dataBackupChanges').textContent === '', 'Altbackup ohne Vergleichsbasis lässt die Änderungszeile weg');
assertEqual(doc.getElementById('dataBackupTitle').textContent, 'Vollsicherung als Datei', 'Hauptblock wiederholt ohne Basis keine Sicherungszeit');
assert(doc.getElementById('dataStorageTechnical').textContent.includes('IndexedDB ruhestand-suite'), 'Speicher nennt den tatsächlichen Backendvertrag nur in Details');
assert(doc.getElementById('dataStorageTechnical').textContent.includes('Gespeicherte Einträge: 1'), 'Eintragszahl steht auf Daten & Sicherung in den Speicherdetails');
renderDataPage(doc, await projectDataModel({ records: { overview_last_full_backup_v1: time }, now: new Date('2026-09-30T12:00:00.000Z') }));
assertEqual(doc.getElementById('dataBackupTile').dataset.state, 'ok', 'Zustand 01 bleibt bis 29 Tage ruhig');
const futureTime = new Date(now.getTime() + 86400000).toISOString();
renderDataPage(doc, await projectDataModel({ records: { overview_last_full_backup_v1: futureTime }, now }));
assertEqual(doc.getElementById('dataBackupAge').textContent, 'heute', 'Künftige bestätigte Sicherung gilt als heute');
assertEqual(doc.getElementById('dataBackupTile').dataset.state, 'ok', 'Künftige bestätigte Sicherung erzeugt keine Warnung');
assertEqual(doc.getElementById('dataBackupDate').textContent,
    new Date(futureTime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }),
    'Künftige bestätigte Sicherung zeigt ihre echte Zeit');
renderDataPage(doc, await projectDataModel({ records: {}, now }));
renderDataPage(doc, { ...model, trialActive: true });
assertEqual(doc.getElementById('dataSnapshotList').children[0]?.textContent, PROBELAUF_RESTORE_HINT, 'SV-1: Spielbereich zeigt keine Punkte, nur den Grund');
for (const id of ['fullBackupBtn', 'fullBackupImportBtn']) assert(doc.getElementById(id).disabled, id + ': Vollsicherung im Spielbereich sichtbar gesperrt');
assertEqual(doc.getElementById('dataBackupReason').textContent, 'Im Spielbereich nicht möglich. Deine echten Daten bleiben unverändert.', 'Graue Zeile erklärt beide Sicherungssperren');
assert(!doc.getElementById('dataBackupReason').hidden, 'Sperrgrund ist im Spielbereich sichtbar');
assertEqual(doc.getElementById('dataBackupDate').textContent, 'Deine echten Daten bleiben unverändert.', 'Spielbereich gibt keinen Sicherungsrat');
assertEqual(doc.getElementById('dataBackupAge').textContent, 'Im Spielbereich gesperrt', 'Die Kachel zeigt im Spielbereich die Sperre');
assertEqual(doc.getElementById('dataBackupContext').textContent, 'Vollsicherung im Spielbereich gesperrt', 'Der Kopf nennt die Sperre für Vollsicherungen');
renderDataPage(doc, await projectDataModel({ records: {}, now }));
assertEqual(doc.getElementById('dataBackupAge').textContent, 'Noch keine Vollsicherung', 'Fehlende Sicherung zeigt echten Leerzustand');
for (const id of ['fullBackupBtn', 'fullBackupImportBtn']) assert(!doc.getElementById(id).disabled, id + ': außerhalb des Spielbereichs bedienbar');
assert(doc.getElementById('dataBackupReason').hidden && doc.getElementById('dataBackupReason').textContent === '', 'Sicherungsgrund außerhalb des Spielbereichs verborgen');
doc.getElementById('fullBackupBtn').disabled = true;
renderDataPage(doc, model);
assert(doc.getElementById('fullBackupBtn').disabled, 'Lesende Aktualisierung hebt laufende Sicherungssperre außerhalb des Spielbereichs nicht auf');
doc.getElementById('fullBackupBtn').disabled = false;
assert(doc.getElementById('dataBackupTile').dataset.state !== 'ok', 'Fehlende Sicherung behauptet keinen grünen Erfolg');
for (const href of ['index.html', 'Handbuch.html', 'Daten-Sicherung.html']) assert(html.includes(`href="${href}" data-profile-handoff`), 'Echter geschützter Rückweg, Hilfe und Ziel: ' + href);
assert(html.includes('href="Daten-Sicherung.html" data-profile-handoff data-suite-backup aria-current="page"'), 'Zielseite hat genau einen aktiven Navigationspunkt');
let writes = 0, readFailure = false;
resetPersistenceForTests({ name: 'test', loadAll: async () => { if (readFailure) throw new Error('IndexedDB kv SYNTHETIC_READ_FAILED'); return {}; }, saveBatch: async () => { writes++; }, listSnapshots: async () => [] });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const before = writes;
await readDataModel(PersistenceFacade, { now });
assertEqual(writes, before, 'Bestätigte Datenprojektion erzeugt keine Renderwrites');
// Echter Start inklusive Rahmen und Importbinder, ohne brauchbaren Profilbestand.
const events = new Map();
doc.documentElement = { dataset: { suitePage: 'data' } };
doc.defaultView = { addEventListener() {} };
doc.addEventListener = (type, fn) => events.set(type, fn);
doc.removeEventListener = () => {};
doc.contains = () => false;
doc.querySelectorAll = () => [];
doc.getElementById('suiteNavigation').querySelector = () => ({ href: 'Daten-Sicherung.html' });
const task = initDataPage(doc, doc.defaultView);
assertEqual(initDataPage(doc, doc.defaultView), task, 'Echter Seitenstart ist idempotent');
await task;
assertEqual(doc.documentElement.dataset.dataReady, 'true', 'Seiteninitialisierung ohne Profilbestand ist erreichbar');
assert(doc.getElementById('fullBackupImportBtn').events.has('click'), 'Import bleibt ohne Profilbestand gebunden');
assert(doc.getElementById('fullBackupImportFile').events.has('change'), 'Echter Importbinder verarbeitet Dateiauswahl');
assert(events.has('overview-backup-changed'), 'Dateiausgabe aktualisiert die Datenanzeige');
readFailure = true;
await events.get('overview-backup-changed')();
assertEqual(doc.getElementById('dataStorageTile').dataset.state, 'unknown', 'Echter Readfehler entfernt veralteten grünen Speicherstatus');
assertEqual(doc.getElementById('dataPriceTile').dataset.state, 'unknown', 'Echter Readfehler entfernt veralteten grünen Kursstatus');
assert(!doc.getElementById('dataPageStatus').textContent.includes('IndexedDB'), 'Echter Lesefehler zeigt eine alltagssprachliche Seitenmeldung');
assert(doc.getElementById('dataPageTechnical').textContent.includes('SYNTHETIC_READ_FAILED'), 'Echte Lesefehlerursache bleibt in Details erhalten');
let firstWarningRead = true, warningReadFailure = false;
resetPersistenceForTests({ name: 'Tauri JSON File', loadAll: async () => {
    if (firstWarningRead) {
        firstWarningRead = false;
        throw Object.assign(new Error('Synthetischer beschädigter Datenbestand.'), { code: 'tauri-state-corrupt' });
    }
    if (warningReadFailure) throw new Error('SYNTHETIC_RECOVERY_READ_FAILED');
    return {};
}, saveBatch: async () => { writes++; }, listSnapshots: async () => [] });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const warningBefore = PersistenceFacade.getPersistenceStatus().migrationWarning;
const warningWrites = writes;
const recoveryModel = await readDataModel(PersistenceFacade, { now });
assertEqual(recoveryModel.recordCount, 0, 'Leerer Recoverybestand meldet die echte Eintragszahl null');
renderDataPage(doc, recoveryModel);
assert(doc.getElementById('dataStorageTechnical').textContent.includes(warningBefore.message), 'Reale Facade-Migrationswarnung bleibt vollständig auf Daten & Sicherung lesbar');
assert(doc.getElementById('dataStorageTechnical').textContent.includes('ruhestand_suite_data.json'), 'Recoverybestand zeigt weiterhin das reale Speicherbackend');
warningReadFailure = true;
await events.get('overview-backup-changed')();
assert(doc.getElementById('dataStorageTechnical').textContent.includes(warningBefore.message)
    && doc.getElementById('dataStorageTechnical').textContent.includes('SYNTHETIC_RECOVERY_READ_FAILED'),
    'Lesefehler erhält Migrationswarnung neben der aktuellen Fehlerursache');
assertEqual(PersistenceFacade.getPersistenceStatus().migrationWarning, warningBefore, 'Darstellung verändert den Recoveryzustand nicht');
assertEqual(writes, warningWrites, 'Anzeige der Speicherwarnung schreibt keine Daten');
renderDataPage(doc, model);
assert(!doc.getElementById('dataStorageTechnical').textContent.includes(warningBefore.message), 'Neuer fehlerfreier Stand entfernt veralteten Warntext');
resetPersistenceForTests();
for (const path of ['AGENTS.md', 'README.md', 'docs/reference/TECHNICAL.md']) assert(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8').includes('Daten-Sicherung.html'), path + ': sechster Einstieg dokumentiert');
for (const path of ['CLAUDE.md', 'CODEX.md', 'GEMINI.md']) assert(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8').includes('AGENTS.md'), path + ': gemeinsame Projektregeln bleiben referenziert');
const overviewSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const balanceSource = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
const managerSource = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
assert(!overviewSource.includes('id="fullBackupImportBtn"') && !overviewSource.includes('id="fullBackupBtn"'), 'Entfernte Startseitenknöpfe haben keine versteckten Ersatzanker');
assert(!balanceSource.includes('id="snapshot-management"') && !balanceSource.includes('id="balanceRecoveryLink"'), 'Balance enthält keine Sicherungskarte oder verwaisten Recoveryanker');
assert(managerSource.includes('href="Daten-Sicherung.html#fullBackupImportBtn"'), 'Vermögen-Technik und Recovery verweisen auf konkrete Sicherungsziele');
assert(!html.includes('clearTranchesBtn') && !html.includes('dataTranchesStatus'), 'Tranchengesamtlöschung ist entfernt');
assert(html.includes('Handbuch.html#daten-sicherung') && fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8').includes('id="daten-sicherung-title"'), 'Hilfe besitzt einen konkreten Handbuchanker');
assert(!/id="(?:austausch|balance-austausch|dataPerson\w*|dataBalance\w*|dataLegacyFolder|dataExchange\w*)"/.test(html), 'AK-1: Karte „Austausch“ ist entfernt');

// Die fünf Karten, einschließlich dynamischer Fehler- und Vorschauzustände.
const mainIds = ['error-container', 'dataPageStatus', 'dataHouseholdContext', 'dataBackupContext', 'dataBackupAge', 'dataBackupDate',
    'dataBackupTitle', 'dataBackupChanges', 'dataContent', 'fullBackupStatus',
    'dataPriceCount', 'dataPriceDetail', 'dataPriceServiceText', 'dataPriceRows', 'dataPriceActionStatus', 'dataRestoreStatus', 'dataSnapshotList', 'dataRestorePointsNotice', 'dataStorageSize', 'dataStorageSummary', 'dataStorageBackend', 'dataStorageDetail', 'dataStorageLocationStatus'];
const textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');
const technicalWords = /IndexedDB|localStorage|UTF-8|Quota|\bSHA(?:-256)?\b|Fingerabdruck|serialisiert|\b(?:kv|metadata|snapshots|ruhestand-suite)\b|(?:rs_|profile_|snapshot_|overview_|balance_)[\w-]+|\b[A-Z]+(?:_[A-Z]+)+\b|Store|Browser-Dateidialog/i;
const checkMainText = text => !technicalWords.test(text);
const mainText = () => mainIds.map(id => textOf(doc.getElementById(id))).join(' ');
const topSource = html.slice(html.indexOf('<div class="data-page">'), html.indexOf('<section class="data-section ds-card" id="wiederherstellung"'));
const storageSource = html.slice(html.indexOf('<section class="data-section ds-card" aria-labelledby="dataStorageTitle"'), html.indexOf('<section class="data-section ds-card" id="austausch"'));
const visibleText = source => source.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '').replace(/<[^>]*>/g, ' ');
assert(checkMainText(visibleText(html.slice(html.indexOf('<div class="data-page">'), html.indexOf('<script type="module" src="app/data/data-page.js"')))), 'Statische Haupttexte enthalten keine technischen Ersatztexte');
assert(!checkMainText(visibleText(topSource + '<p>IndexedDB kv</p>' + storageSource)), 'Gegenmutation mit technischem Haupttext wird abgewiesen');
assert(checkMainText(visibleText(topSource + '<details><summary>Technische Details</summary><p>IndexedDB kv</p></details>' + storageSource)), 'Technischer Text ist ausschließlich innerhalb der Details erlaubt');
for (const id of ['dataBackupDetails', 'dataStorageDetails', 'dataRestoreDetails', 'dataPriceDetails']) assert(new RegExp(`<details id="${id}"[^>]*><summary>Technische Details</summary>`).test(html), id + ': standardmäßig geschlossen und verständlich benannt');
for (const [id, host] of [['dataModelTechnical', 'dataBackupDetails'], ['dataBackupTechnical', 'dataBackupDetails'], ['dataPageTechnical', 'dataBackupDetails'], ['dataStorageTechnical', 'dataStorageDetails'], ['dataStorageLocationTechnical', 'dataStorageDetails'], ['dataRestoreTechnical', 'dataRestoreDetails'], ['dataPriceTechnical', 'dataPriceDetails'], ['dataPriceIssues', 'dataPriceDetails']]) {
    const block = html.match(new RegExp(`<details id="${host}"[\\s\\S]*?</details>`))[0];
    assert(block.includes(`id="${id}"`), id + ': technische Ursache gehört zum richtigen Detailhost');
}
assert(html.includes('Alles, was die App speichert, liegt auf diesem Rechner.'), 'Kopfeinleitung entspricht dem Entwurf');
assert(html.includes('Die Startseite erinnert dich, wenn die letzte Vollsicherung älter als 30 Tage ist.'), 'Neutrale Erinnerung erklärt die unveränderte 30-Tage-Regel');
for (const [id, label] of [['dataRetentionDetails', 'Wie lange bleiben Punkte erhalten?'], ['dataStorageLocationDetails', 'Speicherort anzeigen']]) {
    assert(new RegExp(`<details id="${id}"[^>]*><summary[^>]*>${label.replace('?', '\\?')}</summary>`).test(html)
        && !new RegExp(`<details id="${id}"[^>]*\\bopen\\b`).test(html), id + ': vorhandene Einzelheiten sind zunächst zugeklappt');
}
const css = fs.readFileSync(new URL('../css/daten-sicherung.css', import.meta.url), 'utf8');
assert(css.includes('.data-page > #error-container:empty') && css.includes('.data-page > #dataPageStatus:empty'), 'Leere Alert-/Livehosts erzeugen keine oberen Flexabstände');

const synthetic = createMusterHaushaltRecords('2026-10-02');
synthetic.overview_last_full_backup_v1 = time;
synthetic[DATA_BACKUP_SUMMARY_KEY] = JSON.stringify(await buildBackupSummary(synthetic, time));
// Genau bekannte Kurszahl und bewusst unsortierte Punkte, ohne Archivwrites.
synthetic[DAILY_PRICES_KEY] = JSON.stringify({ version: 1, symbols: { 'TEST.DE': { ...emptyHistorySymbol(), currency: 'EUR',
    days: [historyDay('2026-09-01'), historyDay('2026-09-02')], closes: [100, 101] } } });
const projected = await projectDataModel({ records: synthetic, now, snapshots: [
    { id: 'old', label: 'Erster Stand', createdAt: '2026-01-01T12:00:00Z' },
    { id: 'new', label: 'Neuer Stand', createdAt: '2026-09-01T12:00:00Z' }
], archiveBytes: 3000000, backend: 'IndexedDB' });
renderDataPage(doc, projected);
assertEqual(doc.getElementById('dataHouseholdContext').textContent, 'Haushalt: Max + Erika', 'Kontext benutzt echte Haushaltsnamen');
assertEqual(doc.getElementById('dataBackupContext').textContent, 'Gesichert am 01.09.2026', 'Kontextchip benutzt echte Sicherungszeit');
// SV-1: Ohne Zähler; Punkte anderer (alter) Arten erscheinen nicht in der Liste.
assertEqual(doc.getElementById('dataSnapshotTile'), null, 'Keine Punktkachel mehr');
assertEqual(doc.getElementById('dataSnapshotList').children[0]?.textContent, 'Noch keine Wiederherstellungspunkte.', 'Alte Arten erscheinen nicht');
const listed = await projectDataModel({ records: synthetic, now, snapshots: [
    { id: 'jahr', kind: 'annual-close-pre-mutation', label: 'Max', createdAt: '2026-01-10T12:00:00Z' },
    { id: 'monat', kind: 'monthly-close-pre-mutation', label: 'Monatsabschluss 2026-09', createdAt: '2026-09-01T12:00:00Z' },
    { id: 'kaputt', kind: 'full-backup-import-recovery', label: 'Vor dem Zurückholen', createdAt: '2026-09-02T12:00:00Z' }
], damagedSnapshotIds: ['kaputt'] });
renderDataPage(doc, listed);
const rows = doc.getElementById('dataSnapshotList').children;
assertEqual(rows.map(row => row.children[0].textContent).join(' | '), 'Vor dem Zurückholen | Vor dem Monatsabschluss September 2026 | Vor dem Jahresabschluss 2025', 'Liste nennt Anlass, neueste zuerst');
assert(rows[0].children.some(node => node.textContent === 'beschädigt – nicht zurückholbar') && rows[0].children.find(node => node.dataset?.restorePoint)?.disabled, 'Beschädigter Punkt ist markiert und gesperrt');
assert(!rows[1].children.find(node => node.dataset?.restorePoint)?.disabled, 'Lesbarer Punkt lässt sich zurückholen');
renderDataPage(doc, projected);
assertEqual(doc.getElementById('dataContent').children.length, 6, 'Passender Bestand liefert sechs fachliche Chiparten');
assert(textOf(doc.getElementById('dataContent')).includes('2 Tageskurse'), 'Chip zählt wirkliche Tageskurse statt Musterwert');
assert(!doc.getElementById('dataBackupChanges').hidden
    && doc.getElementById('dataBackupChanges').textContent === 'Keine Änderungen in Monatsabschlüssen, Tagesgeld-Einträgen, Tranchen, Haushalt & Plan, Einkünften, Partnerschaft und Erbe sowie Pflege.', 'Bekannter identischer Bestand zeigt ausdrücklich unveränderte Vergleichsbereiche');
// AK-1 Punkt 4: Die Überschrift passt zum Text darunter.
assertEqual(doc.getElementById('dataBackupTitle').textContent, 'Seit der letzten Sicherung unverändert', 'Ohne Änderungen passt die Überschrift zu „Keine Änderungen …“');
renderDataPage(doc, { ...projected, changes: { ...projected.changes, tranches: { ...projected.changes.tranches, added: 1 } } });
assertEqual(doc.getElementById('dataBackupTitle').textContent, 'Seit der letzten Sicherung geändert:', 'Mit Änderungen erscheint die bisherige Überschrift');
assert(doc.getElementById('dataBackupChanges').textContent.startsWith('1 Tranche neu.'), 'Text nennt die Änderung unter der Überschrift');
assertEqual(backupChangesTitle({ months: {}, cash: {}, tranches: {}, areas: null }), 'Vollsicherung als Datei', 'Alte Basis ohne genannte Änderung behauptet weder „geändert“ noch „unverändert“');
assertEqual(backupChangesTitle({ tranches: { removed: 2 }, areas: null }), 'Seit der letzten Sicherung geändert:', 'Alte Basis mit genannter Änderung zeigt „geändert“');
assertEqual(backupChangesTitle(null), 'Vollsicherung als Datei', 'Ohne Vollsicherung bleibt die allgemeine Überschrift');
renderDataPage(doc, projected);
assert(!html.includes('id="dataStorageBar"'), 'Speicherzusammensetzung wird ohne Füllstandsbalken angezeigt');
assertEqual(doc.getElementById('dataStorageTotal').textContent, doc.getElementById('dataStorageSize').textContent + ' lokal gespeichert', 'Kompakte Speicherangabe benutzt die unveränderte Gesamtgröße');
assertEqual(doc.getElementById('dataStorageDetail').children[2].textContent, 'Wiederherstellungspunkte 3,0 MB', 'MB-Legende verwendet dezimale Umrechnung mit deutschem Komma');
assertEqual(doc.getElementById('dataStorageDetail').children[1].textContent, 'Tageskurse < 0,1 MB', 'Kleine positive Bestände werden in der Legende nicht als Null angezeigt');
assert(checkMainText(mainText()), 'Gerenderte synthetische Haupttexte sind alltagssprachlich');
const sampleProfile = Object.values(JSON.parse(synthetic.rs_profiles_v1).profiles)[0];
const cashOnly = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
    [sampleProfile.meta.id]: { meta: sampleProfile.meta, data: { profile_cash_history_v1: sampleProfile.data.profile_cash_history_v1 } }
} }) };
renderDataPage(doc, await projectDataModel({ records: cashOnly, now }));
assert(textOf(doc.getElementById('dataContent')).includes('Tagesgeld-Historie'), 'Reiner Historienbestand zeigt den passenden Chip');
assert(!textOf(doc.getElementById('dataContent')).includes('Pläne & Annahmen'), 'Tagesgeld-Historie allein erfindet keinen Plan-Chip');
for (const key of ['profile_geburtsdatum', 'profile_wealth_history_lots_v1', 'overview_balance_summary_v1', 'overview_month_provision_v1']) {
    const registry = JSON.parse(cashOnly.rs_profiles_v1);
    registry.profiles[sampleProfile.meta.id].data[key] = sampleProfile.data[key];
    renderDataPage(doc, await projectDataModel({ records: { rs_profiles_v1: JSON.stringify(registry) }, now }));
    assert(!textOf(doc.getElementById('dataContent')).includes('Pläne & Annahmen'), key + ': andere Fachbereiche erzeugen keinen Plan-Chip');
}
const profileWithPlan = JSON.parse(cashOnly.rs_profiles_v1);
profileWithPlan.profiles[sampleProfile.meta.id].data[CONFIG.STORAGE.LS_KEY] = sampleProfile.data[CONFIG.STORAGE.LS_KEY];
for (const records of [
    { rs_profiles_v1: JSON.stringify(profileWithPlan) },
    { ...cashOnly, [CONFIG.STORAGE.LS_KEY]: synthetic[CONFIG.STORAGE.LS_KEY] },
    { ...cashOnly, household_simulator_needs_v1: synthetic.household_simulator_needs_v1 }
]) {
    renderDataPage(doc, await projectDataModel({ records, now }));
    assert(textOf(doc.getElementById('dataContent')).includes('Tagesgeld-Historie'), 'Planschlüssel erhält den Historien-Chip');
    assert(textOf(doc.getElementById('dataContent')).includes('Pläne & Annahmen'), 'Echte Profil- oder Haushaltsplandaten erzeugen den Plan-Chip');
}
const diff = { months: { added: 1, changed: 2, removed: 3 }, cash: { added: 2, changed: 1, removed: 1 }, tranches: { added: 3, changed: 1, removed: 2 } };
renderDataPage(doc, { ...projected, changes: diff });
const changesText = doc.getElementById('dataBackupChanges').textContent;
assert(changesText.includes('Geprüft: Monatsabschlüsse, Tagesgeld-Einträge und Tranchen.'), 'Änderungszeile grenzt den tatsächlich geprüften Datenumfang ein');
for (const phrase of ['1 Monatsabschluss neu', '2 Monatsabschlüsse geändert', '3 Monatsabschlüsse entfernt', '1 Tagesgeld-Eintrag geändert', '2 Tranchen entfernt']) assert(changesText.includes(phrase), 'Fachlicher Aktivitätstext erhält ' + phrase);
assert(checkMainText(mainText()), 'Aktivitätstexte enthalten keine technischen Bezeichner');

const expenseGap = structuredClone(synthetic); expenseGap.balance_expenses_v1 = JSON.stringify({ version: 1, years: { 2024: {}, 2026: {} } });
renderDataPage(doc, await projectDataModel({ records: expenseGap, now }));
assert(textOf(doc.getElementById('dataContent')).includes('Ausgaben 2024, 2026') && !textOf(doc.getElementById('dataContent')).includes('2024–2026'), 'Jahreslücke wird nicht als vorhandenes Zwischenjahr dargestellt');

for (const records of [{}, { overview_last_full_backup_v1: 'kaputt' }, { rs_profiles_v1: '{kaputt' }, { [DAILY_PRICES_KEY]: '{kaputt' }, { balance_expenses_v1: '{kaputt' }]) {
    const unknown = await projectDataModel({ records, now, archiveError: 'IndexedDB snapshots SYNTHETIC_READ_FAILED', points: null });
    renderDataPage(doc, unknown);
    assert(checkMainText(mainText()), 'Leer-/Fehlerhaupttexte enthalten keine technischen Ursachen');
    assert(doc.getElementById('dataRestoreStatus').textContent.includes('nicht verlässlich lesbar'), 'Archivfehler wird kein leerer Nullbestand');
    assertEqual(doc.getElementById('dataStorageTile').dataset.state, 'unknown', 'Unbekannte Archivgröße erzeugt keinen grünen Gesamtwert');
    assertEqual(doc.getElementById('dataStorageTotal').textContent, 'Speichergröße nicht vollständig verfügbar', 'Unbekannte Teilgröße behauptet keinen vollständigen Speicherwert');
    assert(doc.getElementById('dataBackupChanges').hidden && !doc.getElementById('dataBackupChanges').textContent, 'Fehlende oder fehlerhafte Vergleichsbasis entfernt auch einen vorherigen Änderungsstand');
    assert(doc.getElementById('dataStorageTechnical').textContent.includes('IndexedDB snapshots'), 'Archivursache bleibt in Speicherdetails erreichbar');
}
renderDataPage(doc, { ...projected, priceCoverage: { state: 'current', quoteCount: 5, updatedCount: 5, total: 12, openIntervals: 0, quoteAt: Date.parse(time), rows: [] } });
assertEqual(doc.getElementById('dataPriceCount').textContent, '5 von 5 aktuell', 'Kachel nennt ausschließlich bestätigte Aktualisierungen');
assert(doc.getElementById('dataPriceDetail').textContent.includes('Tageskurse vollständig'), 'Vollständigkeit stammt aus bestätigten Zeiträumen');
const healthOnly = await projectDataModel({ records: synthetic, now, serviceReport: { status: 'available', attemptedAt: now.getTime() } });
renderDataPage(doc, healthOnly);
assertEqual(doc.getElementById('dataPriceCount').textContent, 'Kursdaten fehlen oder sind unbrauchbar', 'Bloße Diensterreichbarkeit behebt keine fehlenden Tageskurse');
assertEqual(doc.getElementById('dataPriceTile').dataset.state, 'error', 'Bloßer Healthcheck macht fehlende Tageskurse nicht grün');

const storedCoverage = { state: 'offline', quoteCount: 1, usableQuoteCount: 1, total: 1, openIntervals: 0,
    quoteAt: Date.parse(time), attemptedAt: now.getTime(), rows: [], issues: [] };
renderDataPage(doc, { ...projected, priceCoverage: storedCoverage });
assertEqual(doc.getElementById('dataPriceTile').dataset.state, 'warning', 'Fehlgeschlagener Abruf bei vollständigen brauchbaren Kursen ist gelb');
assertEqual(doc.getElementById('dataPriceCount').textContent, 'Letzter Kursabruf fehlgeschlagen', 'Kursstatus benennt den fehlgeschlagenen Abruf');
assertEqual(doc.getElementById('dataPriceDetail').textContent, 'Gespeicherte Kurse vom 01.09.2026 · Tageskurse vollständig', 'Gespeicherter Stand benutzt Kursdatum statt Versuchsdatum');
assert(doc.getElementById('dataPriceServiceText').hidden && !doc.getElementById('dataPriceServiceText').textContent, 'Abruffehler erscheint nicht nochmals unter der Statuskachel');
for (const patch of [{ usableQuoteCount: 0 }, { missingHistory: true }, { unreadable: true, total: null }]) {
    renderDataPage(doc, { ...projected, priceCoverage: { ...storedCoverage, ...patch } });
    assertEqual(doc.getElementById('dataPriceTile').dataset.state, 'error', 'Fehlende oder unlesbare Kursdaten werden rot angezeigt');
}
renderDataPage(doc, { ...projected, priceCoverage: { ...storedCoverage, openIntervals: 1 } });
assert(!doc.getElementById('dataPriceDetail').textContent.includes('vollständig'), 'Offene Zeiträume werden nicht als vollständige Tageskurse ausgegeben');
renderDataPage(doc, { ...projected, priceCoverage: { ...storedCoverage, issues: ['Ticker fehlt'] } });
assert(doc.getElementById('dataPriceDetail').textContent.includes('nicht prüfbar'), 'Ungeklärte Wertpapiere erzeugen keine vollständige Tageskursmeldung');
doc.getElementById('dataPriceActionStatus').textContent = 'Kursdienst nicht erreichbar. Bitte versuche es später erneut.';
renderDataPage(doc, { ...projected, priceCoverage: { ...storedCoverage, serviceReport: { status: 'offline', kind: 'health' } } });
assertEqual(doc.getElementById('dataPriceCount').textContent, 'Kursdienst nicht erreichbar', 'Gescheiterte Dienstprüfung behauptet keinen gescheiterten Kursabruf');
assertEqual(doc.getElementById('dataPriceActionStatus').textContent, '', 'Dienstfehler steht nur einmal im Haupttext');

// SV-1: Auch ein Punkt einer gelöschten Person bleibt zurückholbar; der Haushalt kehrt ganz zurück.
const availablePoint = { id: 'full', kind: 'full-backup-import-recovery', label: 'Vollbackup-Import Recovery 2026-10-13T12:00:00Z', createdAt: time };
const formerPersonPoint = { id: 'removed', kind: 'annual-close-pre-mutation', activeProfileId: 'deleted-person', createdAt: time };
renderDataPage(doc, { ...projected, snapshots: [availablePoint, formerPersonPoint] });
const descendants = node => [node, ...node.children.flatMap(descendants)];
const pointRows = descendants(doc.getElementById('dataSnapshotList')).filter(node => node.className === 'data-timeline-row');
assert(pointRows.some(row => row.children[0].textContent === 'Vor dem Einspielen einer Sicherung'), 'Technischer Importname wird nur für die Anzeige verständlich benannt');
assert(pointRows.every(row => !row.children.find(node => node.dataset?.restorePoint)?.disabled), 'Alle lesbaren Punkte sind zurückholbar');
renderDataPage(doc, { ...projected, snapshots: [{ ...availablePoint, kind: 'probelauf-before' }] });
assertEqual(doc.getElementById('dataSnapshotList').children[0]?.textContent, 'Noch keine Wiederherstellungspunkte.', 'Alter Spielbereichspunkt erscheint nicht');

const backupStatus = dataBackupStatus(doc);
for (const raw of ['IndexedDB kv rs_profiles_v1 SYNTHETIC_WRITE_FAILED', 'Quota UTF-8 SHA-Fingerabdruck serialisiert', 'Store metadata snapshots Browser-Dateidialog']) {
    backupStatus.dataset.kind = 'error'; backupStatus.textContent = raw;
    assert(checkMainText(mainText()), 'Sicherungsfehler hält technische Wörter aus dem Haupttext fern');
    assertEqual(doc.getElementById('dataBackupTechnical').textContent, raw, 'Sicherungsfehler bleibt unverändert in Details');
}
backupStatus.textContent = 'Spielbereich gesperrt';
assert(doc.getElementById('fullBackupStatus').textContent.includes('Spielbereich beenden'), 'Probelaufsperre bleibt verständlich und handlungsfähig');
backupStatus.textContent = 'Die Rückkehr wurde nicht bestätigt. In Daten & Sicherung mit dem Wiederherstellungspunkt wiederherstellen.';
assert(doc.getElementById('fullBackupStatus').textContent.includes('nicht bestätigt') && doc.getElementById('fullBackupStatus').textContent.includes('wiederherstellen'), 'Unbestätigter Rückweg verliert keinen nötigen Wiederherstellungshinweis');
backupStatus.dataset.kind = 'ok'; backupStatus.textContent = 'Komplettes fachliches Backup erstellt (12 Eintraege). Dateiausgabe der Vollsicherung angestoßen. 3 UI-/Layout-Einstellungen sind nicht enthalten.';
assertEqual(doc.getElementById('fullBackupStatus').textContent, 'Vollsicherung erstellt. Sie liegt im Download-Ordner des Browsers; wähle einen sicheren Ablageort.', 'Erfolg behauptet keinen bestätigten Dateipfad und verlagert Ausschlüsse in Details');
assert(checkMainText(mainText()), 'Auch Erfolgsmeldung bleibt frei von technischen Ersatztexten');
// SD-1/Befund 1908: Die Desktop-App nennt den im Dialog „Speichern unter“ gewählten Pfad samt Dateinamen.
backupStatus.dataset.kind = 'ok'; backupStatus.textContent = 'Komplettes fachliches Backup gespeichert unter D:\\Sync\\Vollsicherung_2026-11-26.json (12 Einträge). 3 UI-/Layout-Einstellungen sind nicht enthalten.';
assertEqual(doc.getElementById('fullBackupStatus').textContent, 'Vollsicherung gespeichert unter D:\\Sync\\Vollsicherung_2026-11-26.json.', 'Desktop-App: Meldung nennt Ordner und Dateinamen');

// Fünf fachliche Spalten und verborgene Rohursachen in allen Kurszuständen.
for (const state of ['current', 'partial', 'unknown', 'offline']) {
    renderDataPage(doc, { ...projected, priceCoverage: { state, total: 2, updatedCount: state === 'current' ? 1 : 0, quoteCount: 1,
        startDate: '2026-01-01', attemptedAt: now.getTime(), openIntervals: 1, issues: ['HTTP_503 IndexedDB kv'],
        rows: [{ names: 'Synthetischer Fonds', symbol: 'TEST.DE', count: 2, first: '2026-09-01', requested: [['2026-01-01', '2026-09-30']],
            gaps: [['2026-09-03', '2026-09-04']], confirmed: true, error: 'HTTP_503 IndexedDB kv' }] } });
    const cells = doc.getElementById('dataPriceRows').children[0].children;
    assertEqual(cells.length, 5, state + ': fünf getrennte Kursspalten');
    assertEqual(cells[0].textContent, 'Synthetischer Fonds', state + ': Wertpapiername ohne Profilmetadaten');
    assertEqual(cells[1].textContent, 'TEST.DE', state + ': eigener Ticker');
    assertEqual(cells[3].textContent, '01.09.2026', state + ': deutsches Datum statt Abrufintervall');
    assertEqual(cells[4].textContent, '1 offener Zeitraum', state + ': Lücken sind keine erfundenen fehlenden Tage');
    assert(checkMainText(mainText()), state + ': dynamische Kursfehler bleiben aus allen Haupttexten');
    assert(doc.getElementById('dataPriceIssues').textContent.includes('HTTP_503'), state + ': rohe Abrufdetails sind erhalten');
}
renderDataPage(doc, { ...projected, archiveError: 'IndexedDB kv ARCHIVE_FAILED' });
assert(checkMainText(mainText()), 'Auch dynamischer Archivfehler enthält keinen technischen Haupttext');
assert(doc.getElementById('dataRestoreTechnical').textContent.includes('ARCHIVE_FAILED'), 'Archivursache bleibt in Details erhalten');

// Echter Seitenstart mit Recovery-ID: Delegation und asynchrone Vorschau bleiben echt.
function recoveryPageDocument(search, onPreviewClick = () => {}, onDialog = () => {}) {
    const page = createPresentationTestDocument(), pendingClicks = [], previewClicks = [];
    const listeners = new WeakMap();
    const listen = (target, type, handler) => {
        if (!listeners.has(target)) listeners.set(target, new Map());
        const events = listeners.get(target);
        if (!events.has(type)) events.set(type, []);
        events.get(type).push(handler);
    };
    const fire = (target, type, event) => (listeners.get(target)?.get(type) || []).map(handler => handler(event));
    const make = page.createElement.bind(page);
    page.createElement = tag => {
        const node = make(tag); node.dataset = {};
        node.addEventListener = (type, handler) => listen(node, type, handler);
        node.removeEventListener = () => {};
        if (tag === 'dialog') {
            node.showModal = () => { node.open = true; onDialog(node); };
            node.close = () => { node.open = false; };
        }
        node.closest = selector => {
            for (let current = node; current; current = current.parentNode) {
                if (selector === 'li' && current.tagName === 'li') return current;
                if (selector === '[data-restore-point]' && current.dataset?.restorePoint) return current;
            }
            return null;
        };
        node.focus = () => { page.activeElement = node; };
        node.scrollIntoView = options => { page.scrolledElement = node; page.scrollOptions = options; };
        node.click = () => {
            if (node.disabled) return;
            if (node.dataset.restorePoint) { previewClicks.push(node.dataset.restorePoint); onPreviewClick(); }
            const event = { target: node, preventDefault() {} };
            for (let current = node; current; current = current.parentNode) {
                event.currentTarget = current;
                pendingClicks.push(...fire(current, 'click', event));
            }
        };
        return node;
    };
    for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])) {
        const node = page.createElement('div'); node.id = id; page.body.appendChild(node);
    }
    page.documentElement = { dataset: { suitePage: 'data' } };
    page.addEventListener = (type, handler) => listen(page, type, handler);
    page.removeEventListener = () => {};
    page.contains = () => false;
    page.querySelectorAll = selector => {
        const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
        return selector === '[data-restore-point]' ? descendants(page.body).filter(node => node.dataset?.restorePoint) : [];
    };
    page.getElementById('suiteNavigation').querySelector = () => ({ href: 'Daten-Sicherung.html' });
    const win = { location: { search, hash: '#wiederherstellung' }, addEventListener: (type, handler) => listen(win, type, handler) };
    page.defaultView = win;
    return { page, win, previewClicks,
        hasListener: (id, type) => (listeners.get(page.getElementById(id))?.get(type) || []).length > 0,
        settle: async () => { await Promise.all(pendingClicks.splice(0)); },
        changeHash: async hash => { win.location.hash = hash; await Promise.all(fire(win, 'hashchange', { type: 'hashchange' })); } };
}
for (const search of ['?punkt=p1', '', '?punkt=', '?punkt=unbekannt']) {
    const records = createMusterHaushaltRecords('2026-10-02');
    const point = buildSnapshot({ id: 'p1', kind: 'monthly-close-pre-mutation', label: 'Monatsabschluss 2026-08', activeProfileId: records.rs_current_profile,
        createdAt: time, records: { ...records, profile_tagesgeld: '321' } });
    const archive = new Map([[point.id, point]]);
    let targetWrites = 0, archiveWrites = 0, flushes = 0;
    resetPersistenceForTests({ name: 'synthetic', open: async () => {}, loadAll: async () => ({ ...records }),
        saveBatch: async ({ upserts, deletes }) => {
            targetWrites++; deletes.forEach(key => { delete records[key]; }); upserts.forEach(([key, value]) => { records[key] = value; });
        },
        readSnapshot: async id => archive.get(id), listSnapshots: async () => [...archive.values()],
        writeSnapshot: async snapshot => { archiveWrites++; archive.set(snapshot.id, snapshot); } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const originalFlush = PersistenceFacade.flush;
    PersistenceFacade.flush = async (...args) => { flushes++; return originalFlush.apply(PersistenceFacade, args); };
    try {
        let beforePreview, restoreNotice;
        const fixture = recoveryPageDocument(search, () => {
            // Bootstrap hat ggf. Registry-Metadaten vorgemerkt; der echte Vorschauflush
            // darf diese bestätigen, aber keinen anderen (Restore-)Stand schreiben.
            beforePreview = { records: JSON.stringify(Object.entries(Object.fromEntries(PersistenceFacade.keysSync()
                .map(key => [key, PersistenceFacade.getItemSync(key)]))).sort()), flushes };
        }, dialog => {
            restoreNotice = descendants(dialog).find(node => node.className === 'ds-note')?.textContent;
            descendants(dialog).find(node => Object.hasOwn(node.dataset, 'pageDialogCancel')).click();
        }), { page, win, previewClicks } = fixture;
        const task = initDataPage(page, win);
        assertEqual(initDataPage(page, win), task, search + ': konkurrierender Seitenstart bleibt idempotent');
        assertEqual(await task, true, search + ': synthetischer Profilbestand startet vollständig');
        await fixture.settle();
        // SV-1: Der Recovery-Link markiert den Punkt und setzt den Fokus; zurückgeholt wird erst nach eigenem Klick und Rückfrage.
        const automatic = search === '?punkt=p1';
        const button = page.querySelectorAll('[data-restore-point]').find(node => node.dataset.restorePoint === 'p1');
        assert(button, search + ': Punkt steht in der Liste');
        assertEqual(button.parentNode.dataset.selected === 'true', automatic, search + ': nur die bekannte konkrete ID markiert den Punkt');
        assertEqual(page.activeElement === button, automatic, search + ': Fokus liegt auf „Zurückholen …“ des Punkts');
        assertEqual(previewClicks.length, 0, search + ': kein automatischer Klick');
        const completedFlushes = flushes, completedWrites = targetWrites;
        const completedRecords = JSON.stringify(records), completedArchive = JSON.stringify([...archive]);
        assertEqual(initDataPage(page, win), task, search + ': abgeschlossener Seitenstart bleibt idempotent');
        for (const hash of ['#suiteMain', '#wiederherstellung', '#kursdienst']) {
            await fixture.changeHash(hash); await fixture.settle();
            assertEqual(previewClicks.length, 0, search + hash + ': kein Punktklick');
            assertEqual(flushes, completedFlushes, search + hash + ': kein weiterer Vorschauflush');
            assertEqual(page.activeElement, page.getElementById(hash.slice(1)), search + hash + ': Fokus gehört dem Hashziel');
            assertEqual(page.scrolledElement, page.activeElement, search + hash + ': Scroll gehört dem Hashziel');
            assertEqual(page.scrollOptions.block, 'start', search + hash + ': bisheriger Scrollvertrag bleibt erhalten');
        }
        assertEqual(targetWrites, completedWrites, search + ': Navigation und Schließen erzeugen keinen Zielwrite');
        assertEqual(records.profile_tagesgeld, createMusterHaushaltRecords('2026-10-02').profile_tagesgeld, search + ': Vorschau schreibt den Zielstand nicht');
        assertEqual(JSON.stringify(records), completedRecords, search + ': spätere Navigation erhält Backendbytes');
        assertEqual(archiveWrites, 0, search + ': kein Recoverypunktwrite');
        assertEqual(JSON.stringify([...archive]), completedArchive, search + ': Archiv bleibt bytegleich');
        assertEqual(archive.size, 1, search + ': nur der synthetische Ausgangspunkt bleibt vorhanden');
        if (automatic) {
            button.click(); await fixture.settle();
            assertEqual(restoreNotice, 'Monatsausgaben, erfasste Vermögensstände und der Haushaltsplan gehen für alle Personen auf diesen Stand zurück.',
                'Rückfrage nennt die Haushaltsdaten im Hinweisbaustein');
        }
    } finally {
        PersistenceFacade.flush = originalFlush;
        resetPersistenceForTests();
    }
}

// Der echte Seitenstart bestätigt seine Writes an der abschließenden Flush-Grenze. SP-1: Der Profilstart bestätigt einen eigenen
// Registrywrite schon vor der Profilbereitschaft; die abschließende Grenze bestätigt, was danach noch vorgemerkt ist.
for (const outcome of ['confirmed', 'false', 'reject']) {
    const records = createMusterHaushaltRecords('2026-10-02');
    const fixture = recoveryPageDocument(''), { page, win } = fixture;
    let release, started, saved, expectedRecords, beforeFlush, finalFlush = false, writes = 0, flushes = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const flushStarted = new Promise(resolve => { started = resolve; });
    const batchStarted = new Promise(resolve => { saved = resolve; });
    resetPersistenceForTests({ name: 'synthetic-start', open: async () => {},
        loadAll: async () => ({ ...records }), listSnapshots: async () => [],
        saveBatch: async ({ upserts, deletes }) => {
            if (finalFlush) { saved(); await gate; }
            deletes.forEach(key => { delete records[key]; });
            upserts.forEach(([key, value]) => { records[key] = value; });
            writes++;
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const originalFlush = PersistenceFacade.flush;
    PersistenceFacade.flush = async (...args) => {
        if (!fixture.hasListener('fullBackupImportFile', 'change')) return originalFlush.apply(PersistenceFacade, args);
        finalFlush = true;
        flushes++;
        beforeFlush = { records: JSON.stringify(records), writes, dirty: getDirtyState().dirtyKeys.length };
        expectedRecords = Object.fromEntries(PersistenceFacade.keysSync().map(key => [key, PersistenceFacade.getItemSync(key)]));
        started();
        if (outcome === 'confirmed') return originalFlush.apply(PersistenceFacade, args);
        await gate;
        if (outcome === 'reject') throw new Error('IndexedDB kv SYNTHETIC_START_FLUSH_REJECTED');
        return false;
    };
    try {
        const task = initDataPage(page, win);
        assertEqual(initDataPage(page, win), task, outcome + ': Start bleibt während Flush idempotent');
        await flushStarted;
        if (outcome === 'confirmed' && beforeFlush.dirty) await batchStarted;
        assert(page.documentElement.dataset.dataReady !== 'true', outcome + ': offener Startflush behauptet keine Bereitschaft');
        assertEqual(JSON.stringify(records), beforeFlush.records, outcome + ': offener Startflush hat keine bestätigten Backendwrites');
        assert(fixture.hasListener('fullBackupImportBtn', 'click') && fixture.hasListener('fullBackupImportFile', 'change'),
            outcome + ': Vollimport bleibt an der Flush-Grenze gebunden');
        release();
        assertEqual(await task, outcome === 'confirmed', outcome + ': Startresultat folgt der Flush-Bestätigung');
        assertEqual(flushes, 1, outcome + ': echter Seitenstart wartet genau einen abschließenden Flush ab');
        assertEqual(initDataPage(page, win), task, outcome + ': beendeter Seitenstart bleibt idempotent');
        if (outcome === 'confirmed') {
            assertEqual(page.documentElement.dataset.dataReady, 'true', 'Bestätigter Startflush setzt erst nach Backendwrite die Bereitschaft');
            assert(beforeFlush.writes > 0, 'SP-1: Der Profilstart hat seinen Registrywrite schon vor der Bereitschaft bestätigt');
            assert(writes > beforeFlush.writes || !beforeFlush.dirty, 'Bestätigter Startflush speichert die noch vorgemerkten Startwrites');
            assertEqual(JSON.stringify(Object.entries(records).sort()), JSON.stringify(Object.entries(expectedRecords).sort()),
                'Bestätigter Startflush bestätigt alle vorgemerkten Records im Backend');
        } else {
            assert(page.documentElement.dataset.dataReady !== 'true', outcome + ': fehlgeschlagener Startflush setzt keinen Erfolgsmarker');
            assertEqual(page.getElementById('dataRestoreStatus').dataset.kind, 'error', outcome + ': Startflushfehler nutzt den Wiederherstellungsreporter');
            assert(page.getElementById('dataRestoreStatus').textContent.includes('Startdaten konnten nicht vollständig gespeichert werden'),
                outcome + ': Startflushfehler zeigt eine verständliche Hauptmeldung');
            assert(checkMainText(page.getElementById('dataRestoreStatus').textContent), outcome + ': Hauptmeldung enthält keine technische Ursache');
            assert(page.getElementById('dataRestoreTechnical').textContent.includes(outcome === 'false' ? 'PERSISTENCE_FLUSH_FAILED' : 'SYNTHETIC_START_FLUSH_REJECTED'),
                outcome + ': technische Startflushursache bleibt erhalten');
            assertEqual(writes, beforeFlush.writes, outcome + ': fehlgeschlagener Startflush bestätigt keine Startwrites');
        }
        await fixture.changeHash('#kursdienst');
        assertEqual(page.activeElement, page.getElementById('kursdienst'), outcome + ': Hashnavigation bleibt nach Flush erreichbar');
    } finally {
        release(); PersistenceFacade.flush = originalFlush; resetPersistenceForTests();
    }
}

// SV-1: Eine Liste ohne Gruppen, Zähler und Spielarchiv; der Spielbereich zeigt keine Punkte.
assert(!html.includes('dataSnapshotDisclosure') && !html.includes('dataSnapshotSummary'), 'Keine Gruppen und keine Zusammenfassung mit Zähler');
const mixed = [
    { ...availablePoint, id: 'month-old', kind: 'monthly-close-pre-mutation', label: 'Monatsabschluss 2026-08', createdAt: '2026-09-01T12:00:00Z' },
    { ...availablePoint, id: 'month-new', kind: 'monthly-close-pre-mutation', label: 'Monatsabschluss 2026-09', createdAt: '2026-10-01T12:00:00Z' },
    { ...availablePoint, id: 'archive', kind: 'probelauf-before' }, availablePoint,
    { ...availablePoint, id: 'delete', kind: 'profile-management-before', label: 'Vor dem Löschen aller Tranchen' },
    { ...availablePoint, id: 'intern', kind: 'internal-recovery', label: 'Balance-Import' }
];
renderDataPage(doc, { ...projected, snapshots: mixed });
const flat = doc.getElementById('dataSnapshotList').children;
assertEqual(flat.map(row => row.children[0].textContent).join('|'), 'Vor dem Monatsabschluss September 2026|Vor dem Monatsabschluss August 2026|Vor dem Einspielen einer Sicherung',
    'Nur sichtbare Arten, neueste zuerst, mit lesbarem Monat');
assertEqual(mixed[1].label, 'Monatsabschluss 2026-09', 'Gespeicherter Titel bleibt unverändert');
const activeModel = await projectDataModel({ records: { ...synthetic, rs_probelauf_state_v1: JSON.stringify({ active: true }) }, snapshots: mixed });
renderDataPage(doc, activeModel);
assert(!descendants(doc.getElementById('dataSnapshotList')).some(node => node.dataset?.restorePoint), 'Spielbereich zeigt keine Punkte');

for (const [totalBytes, expected] of [[0, '0,0 MB'], [1, '< 0,1 MB'], [99999, '< 0,1 MB'], [100000, '0,1 MB']]) {
    renderDataPage(doc, { ...projected, totalBytes });
    assertEqual(doc.getElementById('dataStorageSize').textContent, expected, 'Speicherkachel trennt leeren, kleinen und gerundeten Bestand');
}
