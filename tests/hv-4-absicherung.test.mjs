import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { MemoryWebStorage, fakeAreaIndexedDB, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';

// HV-4 Absicherung (Härtungsliste H-HV1/H-HV2): veraltete Seiten und zweite Fenster schreiben in der
// Windows-App nichts mehr (Generationsprüfung in Rust, hier mit der Attrappe nachgebildet); das Verzeichnis
// verliert bei gleichzeitigem Anlegen keinen Eintrag; ein dritter Haushalt und Sitzungsdaten bleiben getrennt.
const oldRecords = { ...balanceStorageFixture('Altbestand').records, rs_current_profile: 'default', profile_tagesgeld: ' 12000.00 ' };

function environment() {
    const local = new MemoryWebStorage(), session = new MemoryWebStorage(), tauri = fakeAreaTauri(), indexedDB = fakeAreaIndexedDB();
    const window = { localStorage: local, sessionStorage: session, name: '', __TAURI__: {} };
    const options = { window, localStorage: local, indexedDB, invoke: tauri.invoke, installLifecycleHooks: false };
    return { local, session, tauri, options, restart: async () => { persistence.resetPersistenceRuntimeForTests(); await persistence.init(options); } };
}
const rejects = async (action, text, code) => {
    let error = null;
    try { await action(); } catch (cause) { error = cause; }
    assert(error && (!code || error.code === code || String(error.message).includes(code)), `${text}${error ? ` (${error.code || error.message})` : ''}`);
};

// 1. Veraltete Seite: ihr Adapter schreibt nach einem Wechsel in einem anderen Dokument nicht mehr.
{
    const env = environment();
    const seed = createPersistenceAreas(env.options).makeAdapter('echt');
    await seed.open(); await seed.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    const stale = await createPersistenceAreas(env.options).resolve();
    const liveBefore = env.tauri.files.get('live');
    await env.restart();
    await persistence.createHousehold('Lena');
    await rejects(() => stale.adapter.saveBatch({ upserts: [['profile_tagesgeld', 'veraltet']], deletes: [] }), 'alte Seite schreibt nach dem Anlegen nicht mehr', 'PERSISTENCE_RELOAD_REQUIRED');
    assertEqual(env.tauri.files.get('live'), liveBefore, 'Haushalt 1 unverändert');
}

// 2. Zwei Fenster legen gleichzeitig an: das Verzeichnis verliert keinen Eintrag, der zweite Bereich wird wieder entfernt.
{
    const env = environment();
    const first = createPersistenceAreas(env.options), second = createPersistenceAreas(env.options);
    await first.resolve(); await second.resolve();
    const a = await first.createHousehold('Anna');
    await rejects(() => second.createHousehold('Ben'), 'zweites Fenster mit veraltetem Verzeichnis wird abgewiesen');
    const registry = JSON.parse(env.tauri.files.get('households'));
    assertEqual(registry.households.map(entry => entry.name).join(','), ',Anna', 'nur Anna im Verzeichnis, kein Eintrag verloren');
    assert(registry.households.some(entry => entry.id === a), 'Anna mit ihrer Kennung verzeichnet');
    const orphans = [...env.tauri.files.keys()].filter(key => key.startsWith('hh/') && !key.startsWith(`hh/${a}/`));
    assertEqual(orphans.length, 0, 'kein verwaister Bereich des abgewiesenen Fensters');
}

// 3. Drei Haushalte: Arbeit in C (auch Sitzung und Spiel) lässt Haushalt 1 und B bytegleich, Sitzungen eingeschlossen.
{
    const env = environment();
    const seed = createPersistenceAreas(env.options).makeAdapter('echt');
    await seed.open(); await seed.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    await env.restart();
    const b = await persistence.createHousehold('Ben');
    await env.restart();
    persistence.setItemSync('profile_tagesgeld', '700.00'); await persistence.flush();
    areaSessionStorage(env.session).setItem('balance.annual-retry.once', 'ben');
    const c = await persistence.createHousehold('Clara');
    await env.restart();
    const snapshot = () => JSON.stringify({
        files: [...env.tauri.files].filter(([key]) => !key.startsWith(`hh/${c}/`) && key !== 'households' && key !== 'control').sort(),
        session: [...env.session.records].filter(([key]) => !key.includes(`${c}:`)).sort(),
        local: [...env.local.records].filter(([key]) => !key.includes(`${c}:`) && !key.startsWith('rs_households_v1') && key !== 'rs_storage_area_control_v1').sort()
    });
    const before = snapshot();
    persistence.setItemSync('profile_tagesgeld', '300.00'); await persistence.flush();
    areaSessionStorage(env.session).setItem('balance.annual-retry.once', 'clara');
    await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords(), snapshots: [] });
    await env.restart();
    persistence.setItemSync('profile_tagesgeld', '1.00'); await persistence.flush();
    await persistence.discardPlayArea();
    await env.restart();
    assertEqual(snapshot(), before, 'Haushalt 1 und B bleiben bei Arbeit, Sitzung und Spiel in C bytegleich');
    assertEqual(persistence.getHouseholds().households.length, 3, 'drei Haushalte verzeichnet');
    assert(b !== c, 'eigene Kennungen');
}

// 4. Steuerung nennt einen Spielbereich eines anderen Haushalts: er endet, seine Daten bleiben liegen, geöffnet bleibt der echte Bereich.
{
    const env = environment();
    await env.restart();
    const b = await persistence.createHousehold('Ben');
    await env.restart();
    const other = 'zzz999yyy888';
    env.tauri.files.set(`hh/${other}/spiel`, '{"schemaVersion":1,"records":{},"metadata":{}}');
    env.tauri.files.set('control', JSON.stringify({ version: 1, activeArea: 'spiel', source: 'copy', startedAt: '2026-11-04T20:00:00.000Z', id: 'fremd', phase: 'active', household: other }));
    await env.restart();
    const status = persistence.getPersistenceStatus();
    assertEqual(status.activeArea, 'echt', 'fremder Spielbereich wird nicht geöffnet');
    assertEqual(status.storageArea, `hh:${b}`, 'geöffnet bleibt der echte Bereich von B');
    assertEqual(status.areaWarning?.code, 'storage-area-incomplete', 'mit Warnung');
    assert(env.tauri.files.has(`hh/${other}/spiel`), 'Daten des fremden Spielbereichs bleiben liegen');
}

// 5. Befund Codex HV34-1: Steht der neue Haushalt trotz gescheiterter Bestätigung im Verzeichnis, bleiben seine Daten.
{
    const env = environment();
    const manager = createPersistenceAreas(env.options);
    await manager.resolve();
    const original = env.tauri.invoke;
    let sabotage = true;
    // Nach dem erfolgreichen Verzeichniswrite ändert ein „anderes Fenster“ das Verzeichnis, die Bestätigung scheitert.
    env.options.invoke = async (command, args = {}) => {
        const result = await original(command, args);
        if (sabotage && command === 'save_app_state' && args.target === 'households') {
            sabotage = false;
            const registry = JSON.parse(env.tauri.files.get('households'));
            env.tauri.files.set('households', JSON.stringify({ ...registry, generation: registry.generation + 1, households: registry.households.map(entry => entry.id === 'h1' ? { ...entry, name: 'Umbenannt' } : entry) }));
        }
        return result;
    };
    const late = createPersistenceAreas(env.options);
    await late.resolve();
    const id = await late.createHousehold('Lena', undefined, { profile_tagesgeld: '42.00' });
    assert(JSON.parse(env.tauri.files.get('households')).households.some(entry => entry.id === id), 'Haushalt bleibt verzeichnet');
    assert(env.tauri.files.get(`hh/${id}/live`)?.includes('42.00'), 'seine Daten bleiben erhalten');
}

// 6. Befund Codex HV34-7: Weist die Windows-App einen automatischen Write ab, verlangt die Seite sichtbar ein Neuladen.
{
    const env = environment();
    await env.restart();
    const other = createPersistenceAreas(env.options);
    await other.resolve();
    await other.createHousehold('Zweites Fenster');
    persistence.setItemSync('profile_tagesgeld', 'nach dem Wechsel');
    let failed = false;
    try { await persistence.flush(); } catch { failed = true; }
    assert(failed, 'veralteter Flush wird abgewiesen');
    assert(persistence.getPersistenceStatus().reloadRequired, 'Seite verlangt Neuladen');
}

// 7. Befund Codex HV34N2-8: Startet ein anderes Fenster während der Übernahme einen neuen Spielbereich,
// schreibt die abgebrochene Übernahme weder alte Spieldaten noch die alte Steuerung zurück.
{
    const env = environment();
    const seed = createPersistenceAreas(env.options).makeAdapter('echt');
    await seed.open(); await seed.saveBatch({ upserts: Object.entries(oldRecords), deletes: [] });
    await env.restart();
    await persistence.activatePlayArea({ source: 'copy', records: await persistence.readRealRecords(), snapshots: [] });
    persistence.resetPersistenceRuntimeForTests();
    const original = env.tauri.invoke;
    const newPlay = '{"schemaVersion":1,"records":{"profile_tagesgeld":"neues Spiel"},"metadata":{}}';
    let newControl = null;
    env.options.invoke = async (command, args = {}) => {
        if (command === 'delete_play_state' && !newControl) {
            newControl = JSON.stringify({ ...JSON.parse(env.tauri.files.get('control')), activeArea: 'spiel', source: 'copy', id: 'anderes-fenster', phase: 'active', startedAt: '2026-11-05T00:00:00.000Z' });
            env.tauri.files.set('control', newControl);
            env.tauri.files.set('spiel', newPlay);
        }
        return original(command, args);
    };
    const manager = createPersistenceAreas(env.options);
    const { adapter } = await manager.resolve();
    await rejects(() => manager.finishTransfer(adapter), 'Übernahme bricht mit Neuladen ab', 'PERSISTENCE_RELOAD_REQUIRED');
    assertEqual(env.tauri.files.get('spiel'), newPlay, 'neuer Spielbereich des anderen Fensters bleibt');
    assertEqual(env.tauri.files.get('control'), newControl, 'Steuerung des anderen Fensters bleibt');
}
persistence.resetPersistenceRuntimeForTests();
