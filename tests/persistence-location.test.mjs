import { createPersistenceLocation, bindPersistenceLocation } from '../app/shared/persistence-location.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
const calls = [];
const location = createPersistenceLocation({ invoke: async (...args) => { calls.push(args); return 'C:\\App Daten\\Ruhestand'; } });
assertEqual((await location.read()).path, 'C:\\App Daten\\Ruhestand', 'Echter Bridgeaufruf liefert nativen Ordner');
assertEqual((await location.open()).status, 'opened', 'Echter Öffnungsaufruf bestätigt nur Anstoß');
assertEqual(JSON.stringify(calls), '[["get_app_data_directory"],["open_app_data_directory"]]', 'Bridge übergibt keine benutzerbestimmten Zielargumente');
for (const error of ['Pfad nicht lesbar', 'Explorer nicht vorhanden']) {
    const broken = createPersistenceLocation({ invoke: async () => { throw new Error(error); } });
    assertEqual((await broken.read()).status, 'error', 'Pfadfehler behauptet keinen Ordner');
    assertEqual((await broken.open()).error, error, 'Explorerfehler wird weitergegeben');
}
assertEqual((await createPersistenceLocation({ win: {} }).read()).status, 'browser', 'Browser hat keinen Dateipfad');
assertEqual((await createPersistenceLocation({ win: { __TAURI__: {} } }).open()).status, 'unavailable', 'Fehlender invoke ist keine erfolgreiche EXE-Bedienung');
assertEqual((await createPersistenceLocation({ invoke: async () => '' }).read()).status, 'error', 'Leere Pfadauskunft wird abgewiesen');
const doc = createPresentationTestDocument();
for (const id of ['dataStorageOpen', 'dataStorageLocation', 'dataStorageLocationDetails', 'dataStorageLocationStatus', 'dataStorageLocationTechnical']) { const node = doc.createElement('button'); node.id = id; doc.body.appendChild(node); }
await bindPersistenceLocation(doc, { win: {} });
assert(doc.getElementById('dataStorageOpen').hidden, 'Browser zeigt Erklärung statt wirkungslosem Ordnerknopf');
assert(doc.getElementById('dataStorageLocationDetails').hidden, 'Browser ohne Dateipfad zeigt keinen leeren Speicherort-Klappbereich');
assert(doc.getElementById('dataStorageLocation').hidden && doc.getElementById('dataStorageLocation').textContent === '', 'Browser erfindet keinen Pfad und verbirgt den Pfadhost');
assert(doc.getElementById('dataStorageLocationTechnical').textContent.includes('Der Browser verwaltet'), 'Browsererklärung steht nur in Details');
let opened = 0;
await bindPersistenceLocation(doc, { invoke: async command => { if (command === 'get_app_data_directory') return 'C:\\Suite'; opened++; throw new Error('Explorerfehler'); } });
const button = doc.getElementById('dataStorageOpen');
assert(!button.hidden && !button.disabled, 'Bestätigte Pfadauskunft schaltet EXE-Knopf frei');
assert(!doc.getElementById('dataStorageLocationDetails').hidden, 'Bestätigte Pfadauskunft bietet Speicherort-Klappbereich an');
button.click(); for (let i = 0; i < 12; i++) await Promise.resolve();
assertEqual(opened, 1, 'Seitenknopf ruft echte Bridge einmal auf');
assertEqual(doc.getElementById('dataStorageLocation').textContent, 'C:\\Suite', 'Öffnungsfehler überschreibt keinen bestätigten Pfad');
assert(doc.getElementById('dataStorageLocationStatus').textContent.includes('Versuche es erneut'), 'Öffnungsfehler nennt verständliche Wiederholung');
assert(doc.getElementById('dataStorageLocationTechnical').textContent.includes('Explorerfehler'), 'Technische Ursache steht nur in Details');
assert(!button.disabled, 'Explorerfehler erlaubt Wiederholung');
for (const options of [{ win: { __TAURI__: {} } }, { invoke: async () => { throw new Error('TAURI_INVOKE_FAILED IndexedDB kv'); } }]) {
    await bindPersistenceLocation(doc, options);
    assert(button.hidden && button.disabled, 'Fehlende Desktopauskunft gibt den Ordnerknopf nicht frei');
    assert(doc.getElementById('dataStorageLocationDetails').hidden, 'Fehlende Desktopauskunft verbirgt auch den Speicherort-Klappbereich');
    assert(doc.getElementById('dataStorageLocation').hidden && !doc.getElementById('dataStorageLocation').textContent, 'Fehlende Pfadauskunft erfindet keinen Ort');
    assert(!/TAURI|IndexedDB|invoke|kv/.test(doc.getElementById('dataStorageLocationStatus').textContent), 'Desktopfehler bleibt im Haupttext verständlich');
}
