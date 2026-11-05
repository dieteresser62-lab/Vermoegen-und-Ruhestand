import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas, HOUSEHOLD_CORRUPT_KEY } from '../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX, areaSessionStorage, scopeWebStorage, resolveLocalArea, setStorageArea } from '../app/shared/persistence-area-storage.js';
import { storageBackendText } from '../app/data/data-storage.js';
import { HOUSEHOLD_REGISTRY_KEY, HOUSEHOLD_STORAGE_PREFIX, validateHouseholdRegistry, normalizeHouseholdName } from '../app/shared/household-registry.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { exportProfilesBundleToWindowName, importProfilesBundleFromWindowName } from '../app/profile/profile-bundle-io.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { registerHooks } from 'node:module';

// HV-1 Trennungsnachweis: Arbeit in Haushalt B berührt kein Byte von Haushalt 1 (Records, Punkte, Metadaten,
// Altkopien, Sitzungsmerker), in allen drei Speicherarten.

async function importOldPage(kind) {
    const modules = new URL('../app/shared/persistence-facade/', import.meta.url).href;
    const isolation = registerHooks({ resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (context.parentURL?.includes('?hv-old-page-') && resolved.url.startsWith(modules)) {
            const url = new URL(resolved.url);
            url.search = new URL(context.parentURL).search;
            return { ...resolved, url: url.href };
        }
        return resolved;
    } });
    try { return await import(`../app/shared/persistence-facade.js?hv-old-page-${kind}`); }
    finally { isolation.deregister(); }
}

const legacyKey = `${CONFIG.STORAGE.SNAPSHOT_PREFIX}alter-stand`;
const oldRecords = {
    ...balanceStorageFixture('Altbestand').records,
    [CONFIG.STORAGE.LS_KEY]: ' {"inputs":{"alter":67},"lastState":null} ',
    rs_current_profile: 'default',
    profile_tagesgeld: ' 12000.00 ',
    [legacyKey]: JSON.stringify({ snapshotType: 'full-localstorage', timestamp: '2025-01-01T12:00:00.000Z', localStorage: { profile_tagesgeld: '123.00' } })
};
const archivePoint = SnapshotArchive.buildSnapshot({ id: 'real-point', activeProfileId: 'default',
    createdAt: '2025-01-02T12:00:00.000Z', records: { profile_tagesgeld: ' 12000.00 ' } });

async function fixture(kind) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    const indexedDB = kind === 'indexeddb' ? fakeAreaIndexedDB() : null;
    const tauri = kind === 'tauri' ? fakeAreaTauri() : null;
    const window = { localStorage: local, sessionStorage: session, name: '', ...(tauri ? { __TAURI__: {} } : {}) };
    const options = { window, localStorage: local, indexedDB, invoke: tauri?.invoke, installLifecycleHooks: false };
    const real = createPersistenceAreas(options).makeAdapter('echt');
    await real.open();
    await real.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    if (real.writeSnapshot) await real.writeSnapshot(archivePoint);
    else local.setItem('rs_snapshot_archive_v1', JSON.stringify({ schemaVersion: 1, snapshots: [archivePoint], savedAt: 'old timestamp' }));
    await real.writeMetadata('synthetic-original', { savedAt: 'original metadata timestamp' });
    real.close?.();
    // Altkopien im unpräfigierten localStorage gehören Haushalt 1 und dürfen nie in B landen.
    if (kind !== 'localstorage') local.setItem('profile_tagesgeld', 'very old migration copy');
    local.setItem('featureFlags', '{"synthetic":true}');
    session.setItem('balance.annual-retry.once', 'real retry');
    const reserved = key => key === AREA_CONTROL_KEY || key.startsWith(HOUSEHOLD_REGISTRY_KEY) || key.startsWith(PLAY_STORAGE_PREFIX) || key.startsWith(HOUSEHOLD_STORAGE_PREFIX);
    const firstBytes = () => JSON.stringify({
        local: [...local.records].filter(([key]) => !reserved(key)),
        session: [...session.records].filter(([key]) => !reserved(key)),
        backend: tauri ? [tauri.files.get('live'), tauri.files.get('snapshots')]
            : indexedDB ? [indexedDB.bytes('ruhestand-suite'), indexedDB.bytes('snapshotDB')] : null
    });
    const restart = async () => { persistence.resetPersistenceRuntimeForTests(); await persistence.init(options); };
    return { kind, local, session, indexedDB, tauri, window, options, firstBytes, restart };
}

for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    console.log(`Haushalte: ${kind}`);
    const f = await fixture(kind), before = f.firstBytes();
    await f.restart();
    let status = persistence.getPersistenceStatus();
    assertEqual(status.householdId, 'h1', `${kind}: ohne Verzeichnis ist Haushalt 1 offen`);
    assertEqual(status.storageArea, 'echt', `${kind}: Haushalt 1 nutzt den bisherigen Bereich`);
    assertEqual(persistence.getHouseholds().households.length, 1, `${kind}: nur Haushalt 1`);
    assertEqual(f.firstBytes(), before, `${kind}: Start ohne Verzeichnis schreibt nichts an Haushalt 1`);

    const oldPage = await importOldPage(kind);
    await oldPage.init(f.options);
    const id = await persistence.createHousehold('  Lena  ');
    assert(/^[a-z0-9]{12}$/.test(id), `${kind}: neue Kennung`);
    assert(persistence.getPersistenceStatus().reloadRequired, `${kind}: nach dem Anlegen ist ein Neustart nötig`);
    oldPage.setItemSync('profile_tagesgeld', 'stale page');
    let blocked = false;
    try { await oldPage.flush(); } catch { blocked = true; }
    assert(blocked, `${kind}: eine vor dem Anlegen geöffnete Seite schreibt nicht mehr`);
    oldPage.resetPersistenceForTests();

    await f.restart();
    status = persistence.getPersistenceStatus();
    assertEqual(status.householdId, id, `${kind}: neuer Haushalt ist offen`);
    assertEqual(status.storageArea, `hh:${id}`, `${kind}: eigener Speicherbereich`);
    assertEqual(status.activeArea, 'echt', `${kind}: weiterer Haushalt ist echt, nicht Spiel`);
    assertEqual(persistence.getHouseholds().households[1].name, 'Lena', `${kind}: Name bereinigt gespeichert`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), null, `${kind}: neuer Haushalt startet leer, ohne Altmigration`);
    assertEqual(persistence.getItemSync(legacyKey), null, `${kind}: keine Altsicherung aus Haushalt 1`);
    persistence.setItemSync('profile_tagesgeld', '5000.00');
    persistence.setItemSync('rs_current_profile', 'default');
    await persistence.flush();
    const point = await SnapshotArchive.createSnapshot({ id: 'lena-punkt', records: persistence.exportAllSync().records, activeProfileId: 'default' });
    assertEqual((await SnapshotArchive.readSnapshot(point.id)).records.profile_tagesgeld, '5000.00', `${kind}: Wiederherstellungspunkt in B`);
    assertEqual((await persistence.listSnapshots()).some(entry => entry.id === 'real-point'), false, `${kind}: Punkte von Haushalt 1 sind in B unsichtbar`);
    areaSessionStorage(f.session).setItem('balance.annual-retry.once', 'lena retry');
    assertEqual(f.session.getItem('balance.annual-retry.once'), 'real retry', `${kind}: Sitzungsmerker getrennt`);
    // HV-2: Die Echtleser des Spielbereichs lesen den geöffneten Haushalt, nie Haushalt 1.
    assertEqual((await persistence.readRealRecords()).profile_tagesgeld, '5000.00', `${kind}: Echtleser in B lesen B`);
    assert(!(await persistence.readRealSnapshots()).some(entry => entry.id === 'real-point'), `${kind}: Echtpunkte in B ohne Haushalt 1`);
    assert(exportProfilesBundleToWindowName({ windowRef: f.window }), `${kind}: Seitenübergabe aus B`);
    assertEqual(f.firstBytes(), before, `${kind}: Arbeit in B lässt Haushalt 1 bytegleich`);
    if (f.tauri) assert(f.tauri.files.get(`hh/${id}/live`)?.includes('5000.00'), `${kind}: B liegt im eigenen Ordner`);
    if (f.indexedDB) assert(f.indexedDB.bytes(`ruhestand-suite-hh-${id}`).includes('5000.00'), `${kind}: B hat eine eigene Datenbank`);
    if (kind === 'localstorage') assertEqual(f.local.getItem(`${HOUSEHOLD_STORAGE_PREFIX}${id}:profile_tagesgeld`), '5000.00', `${kind}: B hat einen eigenen Präfix`);

    assertEqual(await persistence.switchHousehold('h1'), true, `${kind}: Wechsel zurück`);
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().householdId, 'h1', `${kind}: Haushalt 1 wieder offen`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), oldRecords.profile_tagesgeld, `${kind}: Haushalt 1 unverändert`);
    const handoff = importProfilesBundleFromWindowName({ windowRef: f.window });
    assertEqual(handoff.ok, false, `${kind}: Seitenübergabe aus B wird in Haushalt 1 verworfen`);
    assertEqual(f.window.name, '', `${kind}: verworfene Übergabe wird geleert`);
    assertEqual(f.firstBytes(), before, `${kind}: Rückkehr lässt Haushalt 1 bytegleich`);
    // Befund Codex 1: Haushalt 1 sieht und bereinigt keine Sitzungsmerker anderer Haushalte.
    const h1Session = areaSessionStorage(f.session);
    const listed = Array.from({ length: h1Session.length }, (_, i) => h1Session.key(i));
    assert(!listed.some(key => key.startsWith(HOUSEHOLD_STORAGE_PREFIX)), `${kind}: Sitzung von Haushalt 1 zählt keine B-Schlüssel auf`);
    h1Session.clear();
    assertEqual(f.session.getItem(`${HOUSEHOLD_STORAGE_PREFIX}${id}:balance.annual-retry.once`), 'lena retry', `${kind}: Bereinigung in Haushalt 1 lässt B-Sitzung stehen`);
    f.session.setItem('balance.annual-retry.once', 'real retry');

    // Fehlt der Bereich eines verzeichneten Haushalts, öffnet die App Haushalt 1 mit Warnung statt leer.
    await persistence.switchHousehold(id);
    if (f.tauri) f.tauri.files.delete(`hh/${id}/live`);
    else if (f.indexedDB) f.indexedDB.databases.delete(`ruhestand-suite-hh-${id}`);
    else scopeWebStorage(f.local, `hh:${id}`).clear();
    await f.restart();
    status = persistence.getPersistenceStatus();
    assertEqual(status.householdId, 'h1', `${kind}: fehlender Bereich öffnet Haushalt 1`);
    assertEqual(status.areaWarning?.code, 'household-area-missing', `${kind}: mit Warnung`);
    assertEqual(persistence.getHouseholds().households.length, 2, `${kind}: Eintrag bleibt im Verzeichnis`);

    // Beschädigtes Verzeichnis: gesichert, Haushalt 1 mit Warnung.
    const corrupt = '{"version":1,"active":"h1"';
    if (f.tauri) f.tauri.files.set('households', corrupt); else f.local.setItem(HOUSEHOLD_REGISTRY_KEY, corrupt);
    await f.restart();
    status = persistence.getPersistenceStatus();
    assertEqual(status.areaWarning?.code, 'household-registry-invalid', `${kind}: beschädigtes Verzeichnis gemeldet`);
    assertEqual(status.householdId, 'h1', `${kind}: Haushalt 1 offen`);
    assertEqual(f.tauri ? f.tauri.files.get('households.corrupt.json') : f.local.getItem(HOUSEHOLD_CORRUPT_KEY), corrupt, `${kind}: beschädigtes Verzeichnis gesichert`);
    assertEqual(f.firstBytes(), before, `${kind}: auch die Reparatur lässt Haushalt 1 bytegleich`);
    assert(persistence.getHouseholds().generation > 0, `${kind}: Reparatur nutzt eine neue, zufällige Generation`);
    // Befund Codex 8: ein vorhandenes leeres Verzeichnis ist beschädigt (Tauri: Rust meldet die leere Datei als Fehler).
    if (!f.tauri) {
        f.local.setItem(HOUSEHOLD_REGISTRY_KEY, '');
        await f.restart();
        assertEqual(persistence.getPersistenceStatus().areaWarning?.code, 'household-registry-invalid', `${kind}: leeres Verzeichnis wird gemeldet`);
    }
}

// Befund Codex 9: der synchrone Ersatzweg prüft den Fertigmarker und bereinigt Spielreste nur in Haushalt 1.
{
    const storage = new MemoryWebStorage();
    const b = 'abc123def456';
    storage.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify({ version: 1, active: b, generation: 3,
        households: [{ id: 'h1', name: '', createdAt: null }, { id: b, name: 'Jonas', createdAt: '2026-11-04T18:00:00.000Z' }] }));
    storage.setItem(`${PLAY_STORAGE_PREFIX}profile_tagesgeld`, 'liegengebliebener Spielrest');
    const missing = resolveLocalArea(storage);
    assertEqual(missing.area, 'echt', 'Ersatzweg: ohne Fertigmarker zurück zu Haushalt 1');
    assertEqual(missing.warning?.code, 'household-area-missing', 'Ersatzweg: mit Warnung');
    storage.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify({ ...JSON.parse(storage.getItem(HOUSEHOLD_REGISTRY_KEY)), active: b }));
    storage.setItem(`${HOUSEHOLD_STORAGE_PREFIX}${b}:metadata.householdReady`, JSON.stringify({ id: b }));
    storage.setItem(`${PLAY_STORAGE_PREFIX}profile_tagesgeld`, 'liegengebliebener Spielrest');
    storage.setItem(`${HOUSEHOLD_STORAGE_PREFIX}${b}:metadata.householdReady`, '{broken');
    assertEqual(resolveLocalArea(storage).warning?.code, 'household-area-missing', 'Ersatzweg: beschädigter Fertigmarker fällt zurück statt abzustürzen');
    storage.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify({ ...JSON.parse(storage.getItem(HOUSEHOLD_REGISTRY_KEY)), active: b }));
    storage.setItem(`${HOUSEHOLD_STORAGE_PREFIX}${b}:metadata.householdReady`, JSON.stringify({ id: b }));
    storage.setItem(`${PLAY_STORAGE_PREFIX}profile_tagesgeld`, 'liegengebliebener Spielrest');
    const ready = resolveLocalArea(storage);
    assertEqual(ready.area, `hh:${b}`, 'Ersatzweg: mit Fertigmarker öffnet B');
    assertEqual(storage.getItem(`${PLAY_STORAGE_PREFIX}profile_tagesgeld`), 'liegengebliebener Spielrest', 'Ersatzweg: B bereinigt keine Spielreste von Haushalt 1');
    setStorageArea(null);
}

// Befund Codex 11: Speicherortanzeige nennt den Ort des geöffneten Haushalts.
assert(storageBackendText('Tauri JSON File', '', 'hh:abc123def456').includes('households/abc123def456/ruhestand_suite_data.json'), 'Tauri-Ort von B');
assert(storageBackendText('IndexedDB', '', 'hh:abc123def456').includes('ruhestand-suite-hh-abc123def456'), 'IndexedDB-Ort von B');
assertEqual(storageBackendText('Tauri JSON File', '', 'echt'), 'Tauri: ruhestand_suite_data.json und ruhestand_suite_snapshots.json im App-Datenordner', 'Haushalt 1 unverändert');

// Verzeichnisformat.
assertEqual(validateHouseholdRegistry(null).active, 'h1', 'Fehlendes Verzeichnis = Haushalt 1');
for (const raw of ['{}', '{"version":1,"active":"x","generation":0,"households":[{"id":"h1","name":"","createdAt":null}]}',
    '{"version":1,"active":"h1","generation":-1,"households":[{"id":"h1","name":"","createdAt":null}]}',
    '{"version":1,"active":"h1","generation":0,"households":[{"id":"h1","name":"","createdAt":null},{"id":"../etc","name":"x","createdAt":null}]}',
    '{"version":1,"active":"h1","generation":0,"households":[{"id":"h1","name":"","createdAt":null},{"id":"abc123def456","name":" ","createdAt":null}]}']) {
    let rejected = false;
    try { validateHouseholdRegistry(raw); } catch (error) { rejected = error.code === 'household-registry-invalid'; }
    assert(rejected, `Verzeichnis abgewiesen: ${raw.slice(0, 60)}`);
}
let tooLong = false;
try { normalizeHouseholdName('x'.repeat(41)); } catch { tooLong = true; }
assert(tooLong, 'Name höchstens 40 Zeichen');
persistence.resetPersistenceRuntimeForTests();
