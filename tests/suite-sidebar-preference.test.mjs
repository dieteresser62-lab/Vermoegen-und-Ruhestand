import { createSuiteSidebarPreference, sidebarIsAutomatic, initSuiteSidebar, SUITE_SIDEBAR_KEY as key } from '../app/shared/suite-sidebar-preference.js';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { exportProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { captureCurrentRecords, buildSnapshot } from '../app/shared/snapshot-archive.js';

let writes = 0;
const records = new Map([[key, 'false'], ['profile_tagesgeld', '123']]);
const storage = { get length() { return records.size; }, key: i => [...records.keys()][i],
    getItem: key => records.get(key) ?? null, setItem(key, value) { writes++; records.set(key, value); } };
for (const [raw, expected] of [['true', true], ['false', false], ['kaputt', false], [null, false]]) {
    if (raw === null) records.delete(key); else records.set(key, raw);
    assertEqual(createSuiteSidebarPreference(() => storage).collapsed, expected, 'Nur kanonisches true klappt manuell ein');
}
assertEqual(writes, 0, 'Lesen und Normalisierung schreiben nichts');
const preference = createSuiteSidebarPreference(() => storage);
preference.choose(true);
assertEqual(records.get(key), 'true', 'Manuelle Aktion speichert ausschließlich die Gerätepräferenz');
assertEqual(sidebarIsAutomatic(1311.9), true, 'Unter 82rem automatisch kompakt');
assertEqual(sidebarIsAutomatic(1312), false, 'Genau 82rem erlaubt manuelle Wahl');
assertEqual(sidebarIsAutomatic(1639, 20), true, 'Grenze folgt der Remgröße');
const faulty = createSuiteSidebarPreference(() => { throw new Error('gesperrt'); });
assertEqual(faulty.collapsed, false, 'Lesefehler verwendet Standard');
assertEqual(faulty.choose(true), true, 'Schreibfehler erhält Wahl im Dokument ohne Ausnahme');

// Tatsächliche Bindung mit kontrollierter Containerbreite und ResizeObserver.
let width = 1334, resize;
const shell = { dataset: {}, getBoundingClientRect: () => ({ width }) };
const button = { dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { this.click = fn; } };
const doc = { querySelector: () => shell, getElementById: () => button, documentElement: {}, defaultView: {
    localStorage: storage, getComputedStyle: () => ({ fontSize: '16px' }),
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} }
} };
records.set(key, 'false'); writes = 0;
assertEqual(initSuiteSidebar(doc), true, 'Leistensteuerung bindet den echten äußeren Container');
assertEqual(button.attrs['aria-expanded'], 'true', 'Breiter Container startet ausgeklappt');
for (const viewport of [1366, 1920]) {
    width = viewport - 32; resize();
    assertEqual(button.disabled, false, `${viewport}px: äußeres Containerbudget erlaubt manuelle Wahl`);
    assertEqual(button.attrs['aria-expanded'], 'true', `${viewport}px: Gerätepräferenz bleibt ausgeklappt`);
}
width = 1100; resize();
assertEqual(button.disabled, true, 'Schmaler Container sperrt scheinbar wirksames Ausklappen');
button.click();
assertEqual(writes, 0, 'Laden, Resize und gesperrte Aktion schreiben nichts');
width = 1920; resize();
assertEqual(button.attrs['aria-expanded'], 'true', 'Wiederverbreitern stellt die manuelle Präferenz wieder her');
button.click();
assertEqual(writes, 1, 'Nur der manuelle Klick schreibt');
assertEqual(button.dataset.collapsed, 'true', 'Kompakter Zustand wählt das Ausklappsymbol');
assertEqual(button.title, 'Leiste ausklappen', 'Manuell kompakte Leiste bietet Ausklappen');
width = 900; resize(); width = 1920; resize();
assertEqual(button.attrs['aria-expanded'], 'false', 'Auch eingeklappte Gerätepräferenz bleibt nach Resize erhalten');
assertEqual(writes, 1, 'Automatische Wechsel schreiben weiter nichts');
const nextButton = { dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { this.click = fn; } };
initSuiteSidebar({ ...doc, getElementById: () => nextButton });
assertEqual(nextButton.attrs['aria-expanded'], 'false', 'Erneute Initialisierung übernimmt die gespeicherte Gerätepräferenz');
assertEqual(nextButton.title, 'Leiste ausklappen', 'Erneute Initialisierung erhält den passenden Tooltip');
assertEqual(writes, 1, 'Erneute Initialisierung schreibt keine Präferenz');
nextButton.click();
assertEqual(nextButton.dataset.collapsed, 'false', 'Offene Leiste wählt das Einklappsymbol');
assertEqual(nextButton.title, 'Leiste einklappen', 'Manuelles Öffnen aktualisiert den Tooltip');

// Fachliche Capture-/Bundle-/Backup-/Snapshotwege, keine bloße Präfixprüfung.
const captured = captureProfileData(storage);
assertEqual(captured[key], undefined, 'Profilcapture enthält keine Leistenpräferenz');
assertEqual(captured.profile_tagesgeld, '123', 'Gegenkontrolle: fachlicher Wert wird erfasst');
const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'Synthetisch' }, data: captured } } };
records.set('rs_profiles_v1', JSON.stringify(registry)); records.set('rs_current_profile', 'a'); records.set('rs_active_profile', 'a');
const bundle = exportProfilesBundle({ storage });
assertEqual(JSON.stringify(bundle).includes(key), false, 'Echter Bundleexport bleibt frei von Leistenpräferenz');
const backup = buildFullPersistenceBackup({ storage });
assertEqual(backup.records[key], undefined, 'Fachlicher Vollbackup exportiert keine Gerätepräferenz');
assertEqual(backup.records.profile_tagesgeld, '123', 'Vollbackup enthält weiter Fachwerte');
const snapshotRecords = captureCurrentRecords({ keys: [...records.keys()], getItem: storage.getItem });
const snapshot = buildSnapshot({ kind: 'manual', records: snapshotRecords });
assertEqual(snapshot.records[key], undefined, 'Echter Snapshotcapture bleibt frei von Leistenpräferenz');
