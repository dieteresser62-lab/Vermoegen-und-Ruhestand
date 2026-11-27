// SP-1 Teil B (H-BOOTSTRAP-WRITE, Diagnose TD1DIAG): Ein Seitenstart ohne Änderung schreibt nichts; ein Start mit Änderung
// schreibt die Registry einmal und bestätigt den Flush vor der Seitenbereitschaft. SP-1b: Laden und Wechseln der Person setzen nur
// abweichende Live-Schlüssel. Nur synthetische Daten: Max und Erika, 23.10.2026.
import { PersistenceFacade as P, persistenceStorage, getDirtyState } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { initProfileSubpageLifecycle, initProfileIndexLifecycle, whenProfilePageReady } from '../app/profile/profile-navigation.js';
import { switchProfile } from '../app/profile/profile-storage.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { CONFIG } from '../app/balance/balance-config.js';

const DATE = '2026-10-23';
setAppTestDate(DATE);
const durable = createMusterHaushaltRecords(DATE, 'max-erika', 'grund');
const target = () => ({ visibilityState: 'visible', name: '', location: { reload() {}, href: 'Balance.html' },
    addEventListener() {}, removeEventListener() {}, getElementById: () => null, contains: () => false, querySelectorAll: () => [] });

/** Ein Seitenstart mit zählendem setItem/removeItem (Fassade und Speicherobjekt) und Protokoll von Flush und Bereitschaft. */
async function start(kind) {
    const log = [];
    P.resetPersistenceForTests({ name: 'sp-1-start', loadAll: async () => ({ ...durable }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete durable[key]); batch.upserts.forEach(([key, value]) => { durable[key] = value; });
            log.push(`flush:${batch.upserts.map(([key]) => key).sort().join(',')}`); } });
    await P.init({ installLifecycleHooks: false, debounceMs: 60000 });
    const original = { set: persistenceStorage.setItem, setSync: P.setItemSync, remove: persistenceStorage.removeItem, removeSync: P.removeItemSync };
    persistenceStorage.setItem = (key, value) => { log.push(`set:${key}`); return original.set(key, value); };
    P.setItemSync = (key, value) => { log.push(`set:${key}`); return original.setSync(key, value); };
    persistenceStorage.removeItem = key => { log.push(`remove:${key}`); return original.remove(key); };
    P.removeItemSync = key => { log.push(`remove:${key}`); return original.removeSync(key); };
    const doc = target(), win = target();
    let registryAtReady = null;
    const ready = whenProfilePageReady(doc).then(() => { log.push('ready'); registryAtReady = durable.rs_profiles_v1; });
    try {
        await (kind === 'index' ? initProfileIndexLifecycle({ root: doc, win }) : initProfileSubpageLifecycle({ doc, win }));
        await ready;
    } finally { Object.assign(persistenceStorage, { setItem: original.set, removeItem: original.remove }); Object.assign(P, { setItemSync: original.setSync, removeItemSync: original.removeSync }); }
    const dirty = [...getDirtyState().dirtyKeys];
    await P.flush();
    return { log, dirty, registryAtReady, sets: log.filter(entry => entry.startsWith('set:')), removes: log.filter(entry => entry.startsWith('remove:')) };
}

// 1 · Erster Start nach dem Anlegen: Die Registry trägt noch Haushaltsfelder im Balance-Stand der Person (echte, einmalige Änderung).
{
    const run = await start('subpage');
    assertEqual(run.sets.filter(entry => entry === 'set:rs_profiles_v1').length, 1, 'Start mit Änderung: Registry genau einmal geschrieben');
    const flush = run.log.findIndex(entry => entry.startsWith('flush:') && entry.includes('rs_profiles_v1'));
    assert(flush >= 0 && flush < run.log.indexOf('ready'), 'Start mit Änderung: Flush bestätigt vor der Bereitschaft');
    assertEqual(run.log.filter(entry => entry.startsWith('flush:')).length, 1, 'genau ein Flush');
}
// 2 · Seitenstart ohne Änderung: kein einziger setItem- oder removeItem-Aufruf, kein Flush, Registry samt updatedAt bytegleich.
{
    const before = durable.rs_profiles_v1;
    const run = await start('subpage');
    assertEqual(run.sets.length, 0, 'Start ohne Änderung: kein setItem');
    assertEqual(run.removes.length, 0, 'Start ohne Änderung: kein removeItem');
    assertEqual(run.dirty.length, 0, 'Start ohne Änderung: nichts wartet auf Persistenz');
    assertEqual(run.log.filter(entry => entry.startsWith('flush:')).length, 0, 'Start ohne Änderung: kein Flush');
    assertEqual(durable.rs_profiles_v1, before, 'Registry einschließlich meta.updatedAt bytegleich');
}
// 3 · Livewert neuer als die Registry (z. B. Abbruch vor dem Personen-Snapshot): einmal schreiben, vor der Bereitschaft bestätigen.
{
    const id = durable.rs_current_profile, saved = JSON.parse(durable.rs_profiles_v1).profiles[id];
    durable.profile_tagesgeld = String(Number(saved.data.profile_tagesgeld) + 500);
    const run = await start('subpage');
    assertEqual(run.sets.filter(entry => entry === 'set:rs_profiles_v1').length, 1, 'geänderter Livewert: Registry genau einmal geschrieben');
    assert(run.log.findIndex(entry => entry.startsWith('flush:') && entry.includes('rs_profiles_v1')) < run.log.indexOf('ready'), 'Flush vor der Bereitschaft');
    const atReady = JSON.parse(run.registryAtReady).profiles[id];
    assertEqual(atReady.data.profile_tagesgeld, durable.profile_tagesgeld, 'bei Bereitschaft ist der neue Wert dauerhaft gespeichert');
    assert(atReady.meta.updatedAt !== saved.meta.updatedAt, 'echte Änderung setzt updatedAt neu');
    const again = await start('subpage');
    assertEqual(again.sets.length, 0, 'danach wieder kein Schreiben beim Start');
}
// 4 · Startseite (SP-1b): Das Laden der Person setzt nur abweichende Live-Schlüssel und löscht nur fehlende; ohne Änderung nichts.
{
    const before = durable.rs_profiles_v1;
    const run = await start('index');
    const live = entries => entries.filter(entry => isProfileScopedKey(entry.slice(entry.indexOf(':') + 1)));
    assertEqual(run.sets.filter(entry => entry === 'set:rs_profiles_v1').length, 0, 'Startseite ohne Änderung: Registry nicht geschrieben');
    assertEqual(live(run.sets).length, 0, 'SP-1b: Startseite ohne Änderung setzt keinen Live-Schlüssel');
    assertEqual(live(run.removes).length, 0, 'SP-1b: Startseite ohne Änderung löscht keinen Live-Schlüssel');
    assertEqual(`${run.sets.length}/${run.removes.length}/${run.dirty.length}`, '0/0/0', 'SP-1b: Startseite ohne Änderung schreibt überhaupt nichts');
    assertEqual(durable.rs_profiles_v1, before, 'Startseite: Registry bytegleich');
}
// 5 · Personenwechsel (SP-1b): genau die abweichenden Schlüssel setzen, genau die fehlenden löschen; Ergebnis wie vorher.
{
    await start('index');
    const reg = JSON.parse(durable.rs_profiles_v1), from = durable.rs_current_profile;
    const to = Object.keys(reg.profiles).find(id => id !== from);
    const liveNow = () => Object.fromEntries(P.keysSync().filter(isProfileScopedKey).map(key => [key, P.getItemSync(key)]));
    // Die Zielperson bekommt einen Schlüssel, der bei der aktuellen Person fehlt, und ihr fehlt einer, den die aktuelle Person hat.
    reg.profiles[to].data.profile_gold_ziel_pct = '7';
    delete reg.profiles[from].data.profile_gold_ziel_pct;
    P.removeItemSync('profile_gold_ziel_pct');
    assert(P.getItemSync('profile_gold_rebal_band') !== null, 'aktuelle Person hat ein Rebalancing-Band');
    delete reg.profiles[to].data.profile_gold_rebal_band;
    P.setItemSync('rs_profiles_v1', JSON.stringify(reg));
    await P.flush();
    const before = liveNow(), target = Object.fromEntries(Object.entries(reg.profiles[to].data).filter(([key]) => isProfileScopedKey(key)));
    const log = [], original = { set: persistenceStorage.setItem, remove: persistenceStorage.removeItem };
    persistenceStorage.setItem = (key, value) => { log.push(`set:${key}`); return original.set(key, value); };
    persistenceStorage.removeItem = key => { log.push(`remove:${key}`); return original.remove(key); };
    try { assertEqual(switchProfile(to), true, 'Personenwechsel gelingt'); }
    finally { Object.assign(persistenceStorage, { setItem: original.set, removeItem: original.remove }); }
    const after = liveNow(), scoped = prefix => log.filter(entry => entry.startsWith(prefix) && isProfileScopedKey(entry.slice(prefix.length))).map(entry => entry.slice(prefix.length));
    const expectedSets = Object.keys(after).filter(key => after[key] !== before[key]).sort();
    const expectedRemoves = Object.keys(before).filter(key => !(key in target)).sort();
    assert(expectedSets.length > 0 && expectedRemoves.length > 0, 'Sollfall hat abweichende und fehlende Schlüssel');
    assertEqual(JSON.stringify(scoped('set:').sort()), JSON.stringify(expectedSets), 'SP-1b: Wechsel setzt genau die abweichenden Schlüssel, jeden einmal');
    assertEqual(JSON.stringify(scoped('remove:').sort()), JSON.stringify(expectedRemoves), 'SP-1b: Wechsel löscht genau die fehlenden Schlüssel');
    assertEqual(JSON.stringify(Object.keys(after).sort()), JSON.stringify(Object.keys(target).sort()), 'Live-Schlüssel nach dem Wechsel sind die der Zielperson');
    for (const key of Object.keys(target).filter(key => key !== CONFIG.STORAGE.LS_KEY)) assertEqual(after[key], target[key], `Wechsel lädt ${key} der Zielperson`);
    assertEqual(after.profile_gold_ziel_pct, '7', 'eigener Schlüssel der Zielperson kommt hinzu');
    P.resetPersistenceForTests();
}
// 6 · Erster Startseitenstart mit unverändertem Beispielbestand, ohne vorherigen Unterseitenstart: Das Laden bereinigt die
// Balance-Eigentümerschaft und schreibt die Registry. Der Start meldet das und bestätigt den Flush vor der Bereitschaft.
{
    for (const key of Object.keys(durable)) delete durable[key];
    Object.assign(durable, createMusterHaushaltRecords(DATE, 'max-erika', 'grund'));
    const run = await start('index');
    assertEqual(run.sets.filter(entry => entry === 'set:rs_profiles_v1').length, 1, 'Erster Startseitenstart: Registry genau einmal geschrieben');
    const flush = run.log.findIndex(entry => entry.startsWith('flush:') && entry.includes('rs_profiles_v1'));
    assert(flush >= 0 && flush < run.log.indexOf('ready'), 'Erster Startseitenstart: Flush bestätigt vor der Bereitschaft');
    assertEqual(run.dirty.length, 0, 'Erster Startseitenstart: bei Bereitschaft wartet nichts auf Persistenz');
    assertEqual(JSON.stringify(JSON.parse(run.registryAtReady)), JSON.stringify(JSON.parse(durable.rs_profiles_v1)), 'Registry bei Bereitschaft dauerhaft gespeichert');
    const again = await start('index');
    assertEqual(again.sets.length + again.removes.length, 0, 'Zweiter Startseitenstart schreibt nichts');
    assertEqual(again.log.filter(entry => entry.startsWith('flush:')).length, 0, 'Zweiter Startseitenstart ohne Flush');
    P.resetPersistenceForTests();
}
