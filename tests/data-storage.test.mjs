import { measureDataStorage, storageBackendText } from '../app/data/data-storage.js';
import { readDataModel } from '../app/data/data-model.js';
import { DAILY_PRICES_KEY, emptyHistorySymbol } from '../app/tranches/tranchen-history-store.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { PersistenceFacade, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { createTauriJsonFileAdapter } from '../app/shared/persistence-adapter-tauri.js';
const prices = JSON.stringify({ version: 1, symbols: { 'TEST.DE': emptyHistorySymbol() } });
const records = { profile_tagesgeld: '123', overview_last_full_backup_v1: '2026-01-01T12:00:00.000Z', [DAILY_PRICES_KEY]: prices };
const point = SnapshotArchive.buildSnapshot({ id: 'storage-point', label: 'Älterer Öl-Übergang', createdAt: '2026-01-01T12:00:00.000Z', records });
const fach = Buffer.byteLength(JSON.stringify(['profile_tagesgeld', '123']), 'utf8') + Buffer.byteLength(JSON.stringify(['overview_last_full_backup_v1', records.overview_last_full_backup_v1]), 'utf8');
const priceBytes = Buffer.byteLength(JSON.stringify([DAILY_PRICES_KEY, prices]), 'utf8');
const pointBytes = Buffer.byteLength(JSON.stringify(point), 'utf8');
const measured = measureDataStorage({ ...records, rs_snapshot_archive_v1: JSON.stringify({ snapshots: [point] }), snapshot_legacy_x: JSON.stringify(point) }, [point, point]);
assertEqual(measured.liveBytes, fach, 'Unabhängiges UTF-8-Orakel zählt Fachdaten einmal');
assertEqual(measured.priceBytes, priceBytes, 'Unabhängiges UTF-8-Orakel zählt Kursrecord samt Schlüssel');
assertEqual(measured.archiveBytes, pointBytes, 'Umlaute und Kurssicherungen zählen vollständig zu Punkten');
assertEqual(measured.totalBytes, fach + priceBytes + pointBytes, 'Summe zählt weder Archivcontainer noch doppelte Punkt-ID');
assert(Math.abs(measured.shares.reduce((a, b) => a + b, 0) - 100) < 1e-10, 'Balken und Kategorien haben dieselbe Größenbasis');
assertEqual(measureDataStorage({}, []).totalBytes, 0, 'Leerer Bestand ist bekannt null Bytes');
assertEqual(measureDataStorage({}, [{ ...point, recordCount: 999 }]).archiveBytes, null, 'Defekter Punkt ist unbekannt statt leer');
assertEqual(measureDataStorage({ [DAILY_PRICES_KEY]: '{kaputt' }, []).priceBytes, null, 'Defekte Kurse sind unbekannt statt leer');
assertEqual(measureDataStorage(null, [], { liveError: 'Readback fehlgeschlagen' }).totalBytes, null, 'Fehlendes Readback erzeugt keinen Gesamtwert');
const map = new Map(Object.entries(records));
const local = { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
let tauriLive = JSON.stringify({ records }), tauriArchive = JSON.stringify({ schemaVersion: 1, snapshots: [point] });
const adapters = [
    { name: 'IndexedDB', loadAll: async () => records, saveBatch: async () => true, listSnapshots: async () => [point], readSnapshot: async () => point },
    createLocalStorageAdapter(local),
    createTauriJsonFileAdapter({ invoke: async (command, args) => {
        if (command === 'load_app_state') return args?.target === 'snapshots' ? tauriArchive : tauriLive;
        if (command === 'save_app_state') { if (args?.target === 'snapshots') tauriArchive = args.content; else tauriLive = args.content; }
    } })
];
for (const adapter of adapters) {
    if (adapter.name === 'localStorage') map.set('rs_snapshot_archive_v1', JSON.stringify({ schemaVersion: 1, snapshots: [point] }));
    resetPersistenceForTests(adapter); await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const model = await readDataModel(PersistenceFacade);
    assertEqual(model.liveBytes, fach, adapter.name + ': bestätigte Records entsprechen UTF-8-Orakel');
    assertEqual(model.priceBytes, priceBytes, adapter.name + ': Tageskurse entsprechen UTF-8-Orakel');
    assertEqual(model.archiveBytes, pointBytes, adapter.name + ': vollständiger Archivpunkt entspricht UTF-8-Orakel');
    assertEqual(model.totalBytes, fach + priceBytes + pointBytes, adapter.name + ': kein doppelter Archivcontainer');
}
resetPersistenceForTests();
assert(storageBackendText('IndexedDB', 'http://localhost:8000').includes('http://localhost:8000'), 'Browser erklärt adressgebundenen Speicher');
assert(storageBackendText('Tauri JSON File').includes('ruhestand_suite_snapshots.json'), 'EXE nennt beide realen Dateien');
