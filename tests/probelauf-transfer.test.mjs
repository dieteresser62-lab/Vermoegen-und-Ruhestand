import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive as A, SNAPSHOT_KINDS } from '../app/shared/snapshot-archive.js';
import { previewSnapshotRestore, executeSnapshotRestore, recordIdentity } from '../app/shared/snapshot-restore.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { snapshotTitle, snapshotBlockReason } from '../app/data/data-snapshot-presentation.js';
import { buildSnapshotRetentionPlan } from '../app/shared/snapshot-retention.js';
import { areaSessionStorage, PLAY_STORAGE_PREFIX } from '../app/shared/persistence-area-storage.js';

const withoutArchive = records => Object.fromEntries(Object.entries(records).filter(([key]) => key !== 'rs_snapshot_archive_v1'));
const same = (a, b, message) => assertEqual(recordIdentity(a), recordIdentity(b), message);
const selection = async c => ({ action: 'transfer', review: await c.readEndReview() });
const edit = (key, mutate) => { const value = JSON.parse(P.getItemSync(key)); mutate(value); P.setItemSync(key, JSON.stringify(value)); };
const records = () => ({ ...createMusterHaushaltRecords('2026-10-15'), ui_theme: 'original', rs_daily_prices_v1: '{"real":true}',
    'rs_startup_prices_session_v1': 'real-session', etfProxyUrl: 'real-proxy', sim_showExtra: 'false' });
const change = async () => {
    P.setItemSync('profile_gold_aktiv', 'true');
    P.setItemSync('profile_gold_ziel_pct', '10');
    P.setItemSync('profile_tagesgeld', '20000');
    edit('depot_tranchen', lots => lots.push({ ...lots[0], trancheId: 'new-gold', type: 'gold', category: 'gold', name: 'Gold', shares: 5, purchasePrice: 100, purchaseDate: '2026-10-15', tqf: 0, taxExempt: true }));
    edit('household_plan_v1', plan => { Object.values(plan.entries)[0].values.flexBedarf = 32000; });
    P.setItemSync('ui_theme', 'play'); P.setItemSync('rs_daily_prices_v1', '{"play":true}');
    P.setItemSync('rs_startup_prices_session_v1', 'play-session'); P.setItemSync('etfProxyUrl', 'play-proxy'); P.setItemSync('sim_showExtra', 'true');
    await P.flush();
};
async function start(f, source = 'copy', options = {}) {
    let c = await f.boot(); await c.start(() => ({ source, testDate: null })); c = await f.boot(options); return c;
}
function failAfterRealWrite(f, phase) {
    let armed = true;
    const fail = () => { if (armed) { armed = false; throw new Error(`simuliert: ${phase}`); } };
    if (f.tauri) {
        const invoke = f.tauri.invoke;
        f.tauri.invoke = async (command, args = {}) => {
            const result = await invoke(command, args);
            if (phase === 'delete' && command === 'delete_play_state') fail();
            if (phase === 'readback' && armed && command === 'save_app_state' && (!args.target || args.target === 'live')) {
                armed = false; const data = JSON.parse(f.tauri.files.get('live')); data.records.profile_gold_aktiv = 'readback-error';
                f.tauri.files.set('live', JSON.stringify(data)); return result;
            }
            if (phase !== 'delete' && command === 'save_app_state' && (phase === 'control' ? args.target === 'control' && JSON.parse(args.content).activeArea === 'echt'
                : phase === 'snapshot' ? args.target === 'snapshots' : !args.target || args.target === 'live')) fail();
            return result;
        };
    } else if (f.indexedDB && phase === 'delete') {
        f.indexedDB.faults.afterDelete = name => { if (name === 'ruhestand-suite-spiel' && armed) { armed = false; return true; } };
    } else if (f.indexedDB && phase !== 'control') {
        f.indexedDB.faults.afterWrite = ({ name, storeName, key }) => {
            if (phase === 'readback') {
                if (armed && name === 'ruhestand-suite' && storeName === 'kv' && key === 'profile_gold_aktiv') {
                    armed = false; f.indexedDB.databases.get(name).stores.get('kv').get(key).value = 'readback-error';
                }
                return;
            }
            if (name === 'ruhestand-suite' && storeName === (phase === 'snapshot' ? 'snapshots' : 'kv')) fail();
        };
    } else {
        if (phase === 'delete') {
            const remove = f.local.removeItem.bind(f.local);
            f.local.removeItem = key => { remove(key); if (key.startsWith('rs_spiel_v1:')) fail(); };
            return;
        }
        const set = f.local.setItem.bind(f.local);
        f.local.setItem = (key, value) => {
            set(key, value);
            if (phase === 'readback' && armed && key === 'profile_gold_aktiv') { armed = false; set(key, 'readback-error'); return; }
            if (phase === 'control' ? key === 'rs_storage_area_control_v1' && JSON.parse(value).activeArea === 'echt'
                : phase === 'snapshot' ? key === 'rs_snapshot_archive_v1' : key === 'profile_gold_aktiv') fail();
        };
    }
}
function liveBytes(f) {
    return f.tauri ? f.tauri.files.get('live') : f.indexedDB ? JSON.stringify(JSON.parse(f.indexedDB.bytes('ruhestand-suite')).stores.filter(([name]) => name !== 'snapshots'))
        : recordIdentity([...f.local.records].filter(([key]) => !key.startsWith('rs_spiel_v1:') && !['rs_storage_area_control_v1', 'rs_snapshot_archive_v1'].includes(key)).reduce((a, [k,v]) => ({ ...a, [k]: v }), {}));
}
for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    for (const legacy of [false, true]) {
        const initial = records();
        if (legacy) Object.assign(initial, { sim_startFlexBedarf: '30750', 'sim.startView': 'legacy-ui',
            [CONFIG.STORAGE.SNAPSHOT_PREFIX + 'old']: '{"old":true}', ruhestandsapp_migrated_to_target: 'old', ui_old: 'keep' });
        const f = await playFixture(kind, initial);
        let restoredNavigations = 0, shown = 0;
        let c = await start(f, 'copy', { guard: createNavigationGuard(), restoreReload: () => { restoredNavigations++; } });
        const before = withoutArchive(await P.readRealRecords());
        await change();
        const expectedChanges = (await c.readEndReview()).changes.count;
        const result = await c.end(() => selection(c), { onTransferred(receipt) {
            shown++; assertEqual(receipt.changes.count, expectedChanges, `${kind}: Erfolg zählt die bestätigten Änderungen`);
            assertEqual(receipt.snapshotLabel, 'Vor Übernahme aus dem Spielbereich', `${kind}: Rückkehrpunkt im Erfolg`);
            assert(Number.isFinite(receipt.monthlyBudget), `${kind}: Erfolg nennt Monatsbudget`);
            assertEqual(c.state, null, `${kind}: Spielbereich vor Erfolg geschlossen`);
            assertEqual(restoredNavigations, 0, `${kind}: Erfolg vor Startseite`);
        } });
        assertEqual(result.status, 'reloaded', `${kind}: Übernahme erfolgreich${legacy ? ' mit Altschlüsseln' : ''}`);
        assertEqual(shown, 1, `${kind}: Erfolg genau einmal`); assertEqual(restoredNavigations, 1, `${kind}: Startseite nach Erfolg`);
        c = await f.boot();
        assertEqual(P.getPersistenceStatus().activeArea, 'echt', `${kind}: echter Bereich nach Neustart`);
        const after = withoutArchive(await P.readPersistedRecords());
        assertEqual(after.profile_gold_aktiv, 'true', `${kind}: Gold aktiv`);
        assertEqual(after.profile_gold_ziel_pct, '10', `${kind}: Goldziel übernommen`);
        assertEqual(after.profile_tagesgeld, '20000', `${kind}: Tagesgeld übernommen`);
        assert(JSON.parse(after.depot_tranchen).some(lot => lot.trancheId === 'new-gold'), `${kind}: neue Tranche übernommen`);
        assertEqual(Object.values(JSON.parse(after.household_plan_v1).entries)[0].values.flexBedarf, 32000, `${kind}: Flex übernommen`);
        const allowed = new Set(['profile_gold_aktiv', 'profile_gold_ziel_pct', 'profile_tagesgeld', 'depot_tranchen', 'household_plan_v1', 'rs_profiles_v1']);
        same(Object.fromEntries(Object.entries(after).filter(([key]) => !allowed.has(key))), Object.fromEntries(Object.entries(before).filter(([key]) => !allowed.has(key))), `${kind}: alle sonstigen Records bytegleich einschließlich Technik und Altschlüsseln`);
        const registryBefore = JSON.parse(before.rs_profiles_v1), registryAfter = JSON.parse(after.rs_profiles_v1);
        assertEqual(JSON.stringify(registryAfter.profiles.muster_b), JSON.stringify(registryBefore.profiles.muster_b), `${kind}: inaktive Person unverändert`);
        for (const key of ['profile_gold_aktiv', 'profile_gold_ziel_pct', 'profile_tagesgeld', 'depot_tranchen']) assertEqual(registryAfter.profiles.muster_a.data[key], after[key], `${kind}: Registry und Livewert ${key} konsistent`);
        const point = (await A.listSnapshots()).find(point => point.kind === SNAPSHOT_KINDS.probelaufTransferBefore);
        assert(point?.standardRestorable, `${kind}: Übernahmepunkt unter Daten & Sicherung zurückholbar`);
        assertEqual(snapshotTitle(point), 'Vor Übernahme aus dem Spielbereich', `${kind}: Anlass in Daten & Sicherung benannt`);
        assertEqual(snapshotBlockReason(point, { profileIds: [] }), null, `${kind}: Rückkehrpunkt bleibt bei geänderten Personen verfügbar`);
        assertEqual(buildSnapshotRetentionPlan([point], { now: new Date('2030-01-01') }).remove.length, 0, `${kind}: Rückkehrpunkt bleibt dauerhaft erhalten`);
        same((await A.readSnapshot(point.id)).records, before, `${kind}: Punkt enthält den bytegleichen gesamten Vorher-Stand`);
        const preview = await previewSnapshotRestore(point.id);
        const restored = await executeSnapshotRestore(preview, { reload() {} });
        assertEqual(restored.status, 'restored', `${kind}: normaler Zurückholen-Weg funktioniert`);
        same(withoutArchive(await P.readPersistedRecords()), before, `${kind}: Wiederherstellung bytegleich einschließlich Altschlüsseln`);
    }
    {
        const f = await playFixture(kind, records()); const c = await start(f);
        const original = JSON.parse(P.getItemSync('rs_profiles_v1'));
        const data = original.profiles.muster_b.data;
        for (const key of P.keysSync()) if (isProfileScopedKey(key)) P.removeItemSync(key);
        for (const [key, value] of Object.entries(data)) if (isProfileScopedKey(key)) P.setItemSync(key, value);
        P.setItemSync('rs_current_profile', 'muster_b'); P.setItemSync('rs_active_profile', 'muster_b');
        P.setItemSync('profile_tagesgeld', '22222'); await P.flush();
        await c.end(() => selection(c)); await f.boot();
        assertEqual(P.getItemSync('rs_current_profile'), 'muster_a', `${kind}: echte Profilauswahl bleibt bei Spiel-Profilwechsel erhalten`);
        assertEqual(P.getItemSync('profile_tagesgeld'), '18000', `${kind}: Livewerte gehören weiterhin zur echten Person`);
        assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles.muster_b.data.profile_tagesgeld, '22222', `${kind}: Änderung nach Profilwechsel wird Erika zugeordnet`);
    }
    {
        const legacy = { [CONFIG.STORAGE.LS_KEY]: ' { "inputs": {"floorBedarf":30000,"flexBedarf":30750} } ',
            sim_startFlexBedarf: '30750', profile_tagesgeld: '00123', ui_theme: 'old',
            [CONFIG.STORAGE.SNAPSHOT_PREFIX + 'legacy']: '{"old":true}' };
        const f = await playFixture(kind, legacy); const c = await start(f);
        const before = withoutArchive(await P.readRealRecords());
        P.setItemSync('profile_tagesgeld', '20000'); P.setItemSync('sim_startFlexBedarf', '32000'); await P.flush();
        await c.end(() => selection(c)); await f.boot();
        assertEqual(P.getItemSync('sim_startFlexBedarf'), '32000', `${kind}: profilfreier Altbestand übernimmt alten Fachschlüssel`);
        const point = (await A.listSnapshots()).find(point => point.kind === SNAPSHOT_KINDS.probelaufTransferBefore);
        assert(point.standardRestorable, `${kind}: profilfreier Rückkehrpunkt verfügbar`);
        await executeSnapshotRestore(await previewSnapshotRestore(point.id), { reload() {} });
        same(withoutArchive(await P.readPersistedRecords()), before, `${kind}: profilfreier Altbestand bytegleich zurückgeholt`);
    }
    for (const reason of ['date', 'demo', 'real-changed', 'play-changed']) {
        const f = await playFixture(kind, records()); let c = await start(f, reason === 'demo' ? 'demo' : 'copy');
        await change();
        if (reason === 'date') { await c.changeDate('2027-01-02'); c = await f.boot(); }
        const choice = await selection(c);
        if (reason === 'real-changed') {
            const real = f.areas.makeAdapter('echt'); await real.open(); await real.saveBatch({ upserts: [['profile_tagesgeld', '99']], deletes: [] }); real.close?.();
        }
        if (reason === 'play-changed') { P.setItemSync('profile_tagesgeld', '33333'); await P.flush(); }
        const before = f.realBytes(); let failed = false;
        try { await c.end(() => choice); } catch { failed = true; }
        assert(failed, `${kind}: ${reason} lehnt Übernahme ab`);
        assertEqual(f.realBytes(), before, `${kind}: ${reason} lässt gesamten echten Bereich bytegleich`);
        assertEqual(P.getPersistenceStatus().activeArea, 'spiel', `${kind}: ${reason} erhält Spielbereich`);
        assert(!c.blocked, `${kind}: ${reason} erlaubt Weiter spielen und erneuten Vergleich`);
        await c.end(() => true);
    }
    for (const phase of ['snapshot', 'replace', 'readback', 'control', 'delete']) {
        const f = await playFixture(kind, records()); let c = await start(f, 'copy', { guard: createNavigationGuard() });
        await change();
        await A.createSnapshot({ id: 'play-point', label: 'Nur im Spielbereich', records: withoutArchive(await P.readPersistedRecords()) });
        f.session.setItem('rs_startup_prices_session_v1', 'real-session');
        areaSessionStorage(f.session).setItem('rs_startup_prices_session_v1', 'play-session');
        const sessionBefore = JSON.stringify([...f.session.records]);
        const playBytes = () => f.tauri ? JSON.stringify([f.tauri.files.get('spiel'), f.tauri.files.get('spielsnapshots')])
            : f.indexedDB ? f.indexedDB.bytes('ruhestand-suite-spiel')
                : JSON.stringify([...f.local.records].filter(([key]) => key.startsWith(PLAY_STORAGE_PREFIX)).sort());
        const playPhysicalBefore = playBytes(), before = withoutArchive(await P.readRealRecords());
        // KV-Metadaten müssen bei Replace-/Wechselfehlern ebenfalls zurückkommen.
        const bytes = liveBytes(f), play = await P.readPersistedRecords();
        failAfterRealWrite(f, phase);
        let error;
        try { error = (await c.end(() => selection(c))).error; } catch (cause) { error = cause; }
        assert(error?.message.includes('Spielbereich bleibt erhalten'), `${kind}: ${phase} meldet den erhaltenen Spielbereich`);
        if (phase === 'readback') assertEqual(error.cause?.failureCode, 'persistence_readback_mismatch', `${kind}: fehlerhafter Backend-Readback erkannt`);
        same(withoutArchive(await P.readRealRecords()), before, `${kind}: ${phase} echte Records bytegleich`);
        assertEqual(liveBytes(f), bytes, `${kind}: ${phase} Backendbytes samt Metadaten zurückgeholt`);
        same(await P.readPersistedRecords(), play, `${kind}: ${phase} Spielrecords bytegleich erhalten`);
        assertEqual(playBytes(), playPhysicalBefore, `${kind}: ${phase} Spielarchiv und Fertigmarker bytegleich erhalten`);
        assertEqual(JSON.stringify([...f.session.records]), sessionBefore, `${kind}: ${phase} echte und Spiel-Sitzungen bytegleich erhalten`);
        assertEqual(P.getPersistenceStatus().activeArea, 'spiel', `${kind}: ${phase} aktive Steuerung erhalten`);
        assert(!c.blocked, `${kind}: ${phase} weiterhin bedienbar`);
        P.setItemSync('profile_tagesgeld', '20202'); await P.flush();
        // Ein neuer Seitenstart bestätigt die dauerhafte Spielsteuerung.
        c = await f.boot(); assertEqual(c.state.source, 'copy', `${kind}: ${phase} nach Neustart noch Spielbereich`);
        await c.end(() => selection(c)); await f.boot();
        assertEqual(P.getItemSync('profile_tagesgeld'), '20202', `${kind}: ${phase} erneuter Versuch erfolgreich`);
        assert((await A.listSnapshots()).every(point => point.id !== 'play-point'), `${kind}: Spielarchiv wird nicht ins echte Archiv übertragen`);
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);
