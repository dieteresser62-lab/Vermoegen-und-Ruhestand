import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { AREA_CONTROL_KEY, PLAY_STORAGE_PREFIX, PLAY_DB_NAME, areaSessionStorage, scopeWebStorage } from '../app/shared/persistence-area-storage.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { renderStorageAreaNotice } from '../app/profile/profile-navigation.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { registerHooks } from 'node:module';

async function importOldPage(kind) {
    const modules = new URL('../app/shared/persistence-facade/', import.meta.url).href;
    // Eine zweite Seite braucht nach der Zerlegung einen eigenen gesamten
    // Modulsatz; ein Query nur auf der Re-Export-Fassade trennt keinen Zustand.
    const isolation = registerHooks({ resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (context.parentURL?.includes('?old-page-') && resolved.url.startsWith(modules)) {
            const url = new URL(resolved.url);
            url.search = new URL(context.parentURL).search;
            return { ...resolved, url: url.href };
        }
        return resolved;
    } });
    try { return await import(`../app/shared/persistence-facade.js?old-page-${kind}`); }
    finally { isolation.deregister(); }
}

const legacyKey = `${CONFIG.STORAGE.SNAPSHOT_PREFIX}alter-stand`;
const oldRecords = {
    ...balanceStorageFixture('Altbestand').records,
    [CONFIG.STORAGE.LS_KEY]: ' {"inputs":{"alter":67},"lastState":null} ',
    rs_current_profile: 'default',
    profile_tagesgeld: ' 12000.00 ',
    sim_dynamicFlex: 'true',
    [legacyKey]: JSON.stringify({ snapshotType: 'full-localstorage', timestamp: '2025-01-01T12:00:00.000Z', localStorage: { profile_tagesgeld: '123.00' } })
};
const archivePoint = SnapshotArchive.buildSnapshot({ id: 'real-point', activeProfileId: 'default',
    createdAt: '2025-01-02T12:00:00.000Z', records: { profile_tagesgeld: ' 12000.00 ' } });

async function fixture(kind) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    const indexedDB = kind === 'indexeddb' ? fakeAreaIndexedDB() : null;
    const tauri = kind === 'tauri' ? fakeAreaTauri() : null;
    const window = { localStorage: local, sessionStorage: session, ...(tauri ? { __TAURI__: {} } : {}) };
    const options = { window, localStorage: local, indexedDB, invoke: tauri?.invoke, installLifecycleHooks: false };
    const areas = createPersistenceAreas(options);
    const real = areas.makeAdapter('echt');
    await real.open();
    await real.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    if (real.writeSnapshot) await real.writeSnapshot(archivePoint);
    else local.setItem('rs_snapshot_archive_v1', JSON.stringify({ schemaVersion: 1, snapshots: [archivePoint], savedAt: 'old timestamp' }));
    await real.writeMetadata('synthetic-original', { savedAt: 'original metadata timestamp' });
    real.close?.();
    // Original migration copies and technical preferences must stay byte-identical too.
    if (kind !== 'localstorage') local.setItem('profile_tagesgeld', 'very old migration copy');
    local.setItem('featureFlags', '{"synthetic":true}');
    session.setItem('balance.annual-retry.once', 'real retry');
    session.setItem('rs_startup_prices_session_v1', 'real quote report');
    const realBytes = () => JSON.stringify({
        local: Object.entries(Object.fromEntries(local.records)).filter(([key]) => key !== AREA_CONTROL_KEY && !key.startsWith(PLAY_STORAGE_PREFIX)),
        session: [...session.records].filter(([key]) => !key.startsWith(PLAY_STORAGE_PREFIX)),
        backend: tauri ? [tauri.files.get('live'), tauri.files.get('snapshots')]
            : indexedDB ? [indexedDB.bytes('ruhestand-suite')] : null
    });
    const restart = async () => { persistence.resetPersistenceRuntimeForTests(); await persistence.init(options); };
    const setControl = raw => tauri ? tauri.files.set('control', raw) : local.setItem(AREA_CONTROL_KEY, raw);
    return { kind, local, session, indexedDB, tauri, options, areas, realBytes, restart, setControl };
}

for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    console.log(`Spielbereich: ${kind}`);
    const f = await fixture(kind), before = f.realBytes();
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().activeArea, 'echt', `${kind}: fehlende Steuerung bedeutet echt`);
    const other = await importOldPage(kind);
    await other.init(f.options);
    const copy = await persistence.readRealRecords();
    assertEqual(copy.profile_tagesgeld, oldRecords.profile_tagesgeld, `${kind}: ausdrücklich lesender Echtzugriff erhält Rohwerte`);
    await persistence.activatePlayArea({ source: 'copy', records: copy });
    other.setItemSync('profile_tagesgeld', 'stale real page');
    for (const action of [() => other.flush(), () => other.listSnapshots(), () => other.readSnapshot('real-point')]) {
        let blocked = false;
        try { await action(); } catch { blocked = true; }
        assert(blocked, `${kind}: alte Echtseite darf weder schreiben noch das Archiv lesen`);
    }
    other.resetPersistenceForTests();
    let staleBlocked = false;
    try { persistence.setItemSync('profile_tagesgeld', 'stale'); } catch { staleBlocked = true; }
    assert(staleBlocked, `${kind}: alte Fassade schreibt nach Aktivierung nicht mehr`);
    for (const read of [() => persistence.listSnapshots(), () => persistence.readSnapshot('real-point'), () => persistence.readPersistedRecords()]) {
        let blocked = false;
        try { await read(); } catch { blocked = true; }
        assert(blocked, `${kind}: aktivierende Fassade liest nach dem Wechsel keine echten Records mehr`);
    }
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().activeArea, 'spiel', `${kind}: vor dem ersten Lesen im Spielbereich`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), oldRecords.profile_tagesgeld, `${kind}: Spielkopie geladen`);
    persistence.setItemSync('profile_tagesgeld', '9999.00');
    persistence.setItemSync('profile_gold_aktiv', 'true');
    persistence.setItemSync('depot_tranchen', '[{"trancheId":"synthetic-gold","type":"gold","shares":1}]');
    await persistence.flush();
    const point = await SnapshotArchive.createSnapshot({ id: 'spiel-abschluss', records: persistence.exportAllSync().records,
        activeProfileId: 'default', kind: SNAPSHOT_KINDS.annualClosePreMutation });
    assertEqual((await SnapshotArchive.readSnapshot(point.id)).records.profile_tagesgeld, '9999.00', `${kind}: Abschluss-Sicherungspunkt im Spielbereich`);
    areaSessionStorage(f.session).setItem('rs_startup_prices_session_v1', 'play quotes');
    areaSessionStorage(f.session).removeItem('balance.annual-retry.once');
    await persistence.resetNewBeginningBrowserStorage({ window: f.options.window });
    assertEqual(f.realBytes(), before, `${kind}: Eingaben, Gold, Tranche, Abschluss und Leerstart lassen echte Bytes gleich`);
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().activeArea, 'spiel', `${kind}: Absturz/Neustart bleibt im Spielbereich`);
    assertEqual(persistence.getItemSync('profile_tagesgeld'), '9999.00', `${kind}: Neustart erhält Spieldaten`);
    assert((await SnapshotArchive.listSnapshots()).some(entry => entry.id === point.id), `${kind}: Neustart erhält Spiel-Abschluss`);
    assertEqual((await persistence.readRealRecords()).profile_tagesgeld, oldRecords.profile_tagesgeld, `${kind}: Vergleich liest ausschließlich echten Stand`);
    assertEqual(f.realBytes(), before, `${kind}: Neustart, Archivliste und Vergleich verändern echte Bytes nicht`);
    persistence.setItemSync('profile_tagesgeld', 'unflushed play edit');
    await persistence.discardPlayArea();
    assertEqual(f.realBytes(), before, `${kind}: Verwerfen verändert echte Daten und Archivpunkte nicht`);
    assert(![...f.local.records.keys(), ...f.session.records.keys()].some(key => key.startsWith(PLAY_STORAGE_PREFIX)), `${kind}: Spielschlüssel und Spiel-Sitzungen entfernt`);
    if (f.tauri) assert(!f.tauri.files.has('spiel') && !f.tauri.files.has('spielsnapshots'), 'Tauri: beide Spieldateien gelöscht');
    if (f.indexedDB) assert(!f.indexedDB.databases.has(PLAY_DB_NAME), 'IndexedDB: Spieldatenbank gelöscht');
    await f.restart();
    assertEqual(persistence.getPersistenceStatus().activeArea, 'echt', `${kind}: Neustart nach Verwerfen ist echt`);
    assertEqual(f.realBytes(), before, `${kind}: auch nach Rückkehr echte Metadaten und Altbestand bytegleich`);

    for (const failure of ['broken-json', 'unknown-version', 'half-created', 'orphan']) {
        const broken = await fixture(kind), unchanged = broken.realBytes();
        const play = broken.areas.makeAdapter('spiel');
        await play.open(); await play.saveBatch({ upserts: [['profile_tagesgeld', 'partial play']], deletes: [] }); play.close?.();
        if (failure !== 'orphan') broken.setControl(failure === 'broken-json' ? '{broken'
            : JSON.stringify({ version: failure === 'unknown-version' ? 2 : 1, activeArea: 'spiel', phase: 'active', source: 'copy', startedAt: '2026-10-15T12:00:00.000Z', id: 'missing-ready' }));
        await broken.restart();
        assertEqual(persistence.getPersistenceStatus().activeArea, 'echt', `${kind}/${failure}: startet sicher in echt`);
        if (failure !== 'orphan') {
            assert(persistence.getPersistenceStatus().areaWarning?.message, `${kind}/${failure}: ruhiger Hinweis vorhanden`);
            assertEqual(persistence.getPersistenceStatus().migrationWarning, null, `${kind}/${failure}: Spielhinweis löst keine echte Speicher-Recovery aus`);
        }
        if (failure !== 'orphan') {
            assert((await SnapshotArchive.listSnapshots()).some(point => point.id === 'real-point'), `${kind}/${failure}: echtes Archiv bleibt lesbar, ohne Altschlüssel zu migrieren`);
        }
        assertEqual(persistence.getItemSync('profile_tagesgeld'), oldRecords.profile_tagesgeld, `${kind}/${failure}: erster Read enthält echte Daten`);
        assertEqual(broken.realBytes(), unchanged, `${kind}/${failure}: echte Daten einschließlich Altbestand unverändert`);
        assert(![...broken.local.records.keys()].some(key => key.startsWith(PLAY_STORAGE_PREFIX)), `${kind}/${failure}: Spielrest verworfen`);
        if (broken.indexedDB) assert(!broken.indexedDB.databases.has(PLAY_DB_NAME), `${kind}/${failure}: Spiel-DB verworfen`);
        if (broken.tauri) assert(!broken.tauri.files.has('spiel'), `${kind}/${failure}: Spieldatei verworfen`);
    }

    for (const phase of ['starting', 'active', 'restoring']) {
        const old = await fixture(kind);
        const real = old.areas.makeAdapter('echt'); await real.open();
        const raw = JSON.stringify({ version: 1, active: true, phase, source: 'copy', snapshotId: 'old-return-point' });
        await real.saveBatch({ upserts: [['rs_probelauf_state_v1', raw]], deletes: [] }); real.close?.();
        const unchanged = old.realBytes(); await old.restart();
        assertEqual(persistence.getItemSync('rs_probelauf_state_v1'), raw, `${kind}: alter Spielbereich ${phase} bleibt für bisherigen Rückkehrweg verfügbar`);
        assertEqual(old.realBytes(), unchanged, `${kind}: alter Spielbereich ${phase} wird von Bereichsauflösung nicht verändert`);
    }
}

{
    const f = await fixture('tauri'), before = f.realBytes(); await f.restart();
    persistence.setItemSync('profile_tagesgeld', 'unsaved real input');
    let blocked = false;
    try { await persistence.activatePlayArea({ source: 'copy', records: oldRecords }); } catch { blocked = true; }
    assert(blocked, 'Aktivierung verlangt gespeicherte echte Eingaben, ohne selbst echte Daten zu flushen');
    assertEqual(f.realBytes(), before, 'Abgewiesene Aktivierung erhält echte Daten und Zeitstempel');
}

// Beschädigte native Spieldateien dürfen nur sich selbst quarantinieren.
for (const target of ['spiel', 'spielsnapshots']) {
    const f = await fixture('tauri'), before = f.realBytes(); await f.restart();
    await persistence.activatePlayArea({ source: 'copy', records: oldRecords });
    f.tauri.files.set(target, '{broken play JSON');
    if (target === 'spiel') {
        await f.restart();
        assertEqual(persistence.getPersistenceStatus().activeArea, 'echt', 'Beschädigte Spieldaten werden beim Neustart verworfen');
    } else {
        await f.restart();
        let rejected = false;
        try { await SnapshotArchive.readSnapshot('broken'); } catch (error) { rejected = error.code === 'tauri-snapshots-corrupt'; }
        assert(rejected, 'Beschädigtes Spielarchiv meldet seinen Fehler auch beim direkten Readback');
    }
    assert(f.tauri.files.has(`${target}.corrupt.json`), `${target}: beschädigte Spieldatei quarantiniert`);
    assert(!f.tauri.calls.some(call => call.command === 'quarantine_app_state' && ['live', 'snapshots'].includes(call.target)), `${target}: keine echte Datei quarantiniert`);
    assertEqual(f.realBytes(), before, `${target}: Beschädigungsbehandlung erhält echte Bytes`);
}

// Auch eine noch ausstehende localStorage-Migration darf nur Spielmarker schreiben.
for (const kind of ['tauri', 'indexeddb']) {
    const f = await fixture(kind), before = f.realBytes(); await f.restart();
    await persistence.activatePlayArea({ source: 'demo', records: {} });
    scopeWebStorage(f.local, 'spiel').setItem('sim_dynamicFlex', 'copied legacy value');
    await f.restart();
    assertEqual(persistence.getItemSync('sim_dynamicFlex'), 'copied legacy value', `${kind}: Migration liest nur Spiel-Altschlüssel`);
    assertEqual(f.local.getItem(`${PLAY_STORAGE_PREFIX}ruhestandsapp_migrated_to_target`), kind === 'tauri' ? 'tauri-json-file' : 'indexeddb', `${kind}: Migrationsmarker liegen nur im Spielbereich`);
    assertEqual(f.realBytes(), before, `${kind}: ausstehende Migration erhält echte Bytes`);
}

// Direkter Archivzugriff initialisiert die Fassade ebenfalls vor dem ersten Read.
{
    const f = await fixture('indexeddb'), before = f.realBytes(); await f.restart();
    // SV-1: Der Spielbereich startet ohne Punkte; ein eigener Punkt liegt nur in seinem Archiv.
    await persistence.activatePlayArea({ source: 'demo', records: { profile_tagesgeld: '3' } });
    await f.restart();
    await persistence.writeSnapshot({ ...archivePoint, id: 'only-play' });
    persistence.resetPersistenceRuntimeForTests();
    // Runtime dependencies are explicit here while sharing the same public facade.
    const starting = persistence.init(f.options);
    const points = await SnapshotArchive.listSnapshots(); await starting;
    assert(points.some(point => point.id === 'only-play') && !points.some(point => point.id === 'real-point'), 'Archiv löst vor seinem ersten Lesen den Spielbereich auf');
    assertEqual(f.realBytes(), before, 'Archivstart lässt echte Bytes gleich');
}
persistence.resetPersistenceRuntimeForTests();

// NG-1: Eine gescheiterte Übernahme in einen frischen Haushalt (noch ohne echte Daten) hinterlässt den Stand von vorher.
// In der EXE heißt das: keine leere Hauptdatei, denn Rust lehnt danach jedes Speichern ab.
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage();
    const indexedDB = kind === 'indexeddb' ? fakeAreaIndexedDB() : null;
    const base = kind === 'tauri' ? fakeAreaTauri() : null;
    const isObject = raw => { try { const value = JSON.parse(raw); return value !== null && typeof value === 'object' && !Array.isArray(value); } catch { return false; } };
    // Wie save_state_file_with_replace: Eine vorhandene, aber unlesbare Hauptdatei sperrt jedes Speichern.
    const invoke = base && (async (command, args = {}) => {
        const target = args.household ? `hh/${args.household}/${args.target || 'live'}` : args.target || 'live';
        if (command === 'save_app_state' && base.files.has(target) && !isObject(base.files.get(target))) throw new Error('Hauptdatei ist nicht lesbar; Rettungsdateien bleiben erhalten.');
        return base.invoke(command, args);
    });
    const window = { localStorage: local, sessionStorage: session, ...(base ? { __TAURI__: {} } : {}) };
    const areas = createPersistenceAreas({ window, localStorage: local, indexedDB, invoke, installLifecycleHooks: false });
    await areas.resolve();
    await areas.activate({ records: { profile_tagesgeld: '777.00' }, source: 'demo' });
    await areas.resolve();
    const before = await areas.readRealRecords();
    if (base) assert(!base.files.has('live'), 'tauri: frischer Haushalt hat noch keine Hauptdatei');
    const transfer = await areas.openRealTransfer();
    await transfer.adapter.saveBatch({ upserts: [['profile_tagesgeld', '1000.00']], deletes: [] });
    let rollbackError = null;
    try { await transfer.rollback(); } catch (error) { rollbackError = error; }
    transfer.close();
    assertEqual(rollbackError?.message ?? null, null, `${kind}: Rücknahme in frischen Haushalt gelingt`);
    if (base) {
        assert(!base.files.has('live'), 'tauri: Rücknahme entfernt die Hauptdatei statt sie leer zu schreiben');
        assertEqual(await base.invoke('load_app_state', { target: 'live' }), '', 'tauri: Nachprüfung liest wieder den leeren Rohbestand');
    }
    assertEqual(JSON.stringify(await areas.readRealRecords()), JSON.stringify(before), `${kind}: nach der Rücknahme dieselben Fachrecords wie vorher`);
    const real = areas.makeAdapter('echt'); await real.open();
    let saveError = null;
    try { await real.saveBatch({ upserts: [['profile_tagesgeld', '5.00']], deletes: [] }); } catch (error) { saveError = error; }
    real.close?.();
    assertEqual(saveError?.message ?? null, null, `${kind}: späteres Speichern gelingt`);
    assertEqual((await areas.readRealRecords()).profile_tagesgeld, '5.00', `${kind}: späterer Wert ist gespeichert`);
    if (base) assert(isObject(base.files.get('live')), 'tauri: Hauptdatei ist danach ein JSON-Objekt');
}

// NG-1: Der Löschbefehl prüft wie jedes verändernde Kommando die Generation und trifft nur die Hauptdatei seines Haushalts.
{
    const tauri = fakeAreaTauri();
    tauri.files.set('households', JSON.stringify({ generation: 3 }));
    for (const key of ['live', 'snapshots', 'hh/abc123def456/live', 'hh/abc123def456/snapshots']) tauri.files.set(key, '{}');
    let stale = '';
    try { await tauri.invoke('delete_live_state', { household: 'abc123def456', expectedGeneration: 2 }); } catch (error) { stale = String(error.message); }
    assert(stale.startsWith('HOUSEHOLD_CONTEXT_CHANGED'), 'Veraltete Generation wird abgewiesen');
    assert(tauri.files.has('hh/abc123def456/live'), 'Abgewiesener Löschbefehl lässt die Hauptdatei liegen');
    await tauri.invoke('delete_live_state', { household: 'abc123def456', expectedGeneration: 3 });
    assertEqual([...tauri.files.keys()].sort().join(','), 'hh/abc123def456/snapshots,households,live,snapshots', 'Nur die Hauptdatei dieses Haushalts ist entfernt');
    let invalid = '';
    try { await tauri.invoke('save_app_state', { target: 'live', content: '' }); } catch (error) { invalid = String(error.message); }
    assert(invalid.includes('kein JSON-Objekt'), 'Leerer Inhalt wird wie in Rust abgelehnt');
}
{
    let displayed;
    const doc = {
        getElementById: () => ({ insertAdjacentElement: (_where, node) => { displayed = node; } }),
        createElement: () => ({ dataset: {}, setAttribute(key, value) { this[key] = value; } })
    };
    renderStorageAreaNotice(doc, { message: 'Spielbereich verworfen. Deine echten Daten bleiben erhalten.' });
    assertEqual(displayed.role, 'status', 'Beschädigte Bereichssteuerung meldet einen ruhigen Status');
    assertEqual(displayed.className, 'ds-note', 'Hinweis verwendet den vorhandenen Hinweisstil');
    assert(displayed.textContent.includes('echten Daten bleiben erhalten'), 'Hinweis erklärt die sichere Rückkehr');
}
