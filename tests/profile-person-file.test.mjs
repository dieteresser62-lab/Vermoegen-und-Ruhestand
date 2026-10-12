import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { previewPersonExport, confirmPersonExport, normalizePersonFile, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { PROBELAUF_STATE_KEY } from '../app/shared/persistence-key-policy.js';
const canonical = records => JSON.stringify(Object.entries(records).sort());
async function fixture() {
    const records = createMusterHaushaltRecords('2026-09-01');
    const calls = []; const fail = {};
    const adapter = { name: 'person-test', loadAll: async () => {
            if (fail.readback && calls.length === 1) return { ...records, rs_profiles_v1: '{}' };
            return { ...records };
        }, saveBatch: async batch => {
            calls.push(batch);
            if (fail.rollback && calls.length > 1 || fail.write && calls.length === 1) throw new Error('SYNTHETIC_WRITE');
            for (const key of batch.deletes) delete records[key];
            for (const [key, value] of batch.upserts) records[key] = value;
            if (fail.gate) await fail.gate;
        } };
    resetPersistenceForTests(adapter); await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { records, calls, fail };
}
let f = await fixture(); const before = canonical(f.records);
const id = f.records.rs_current_profile, other = Object.keys(JSON.parse(f.records.rs_profiles_v1).profiles).find(key => key !== id);
const preview = await previewPersonExport(id);
assertEqual(canonical(f.records), before, 'Personenexportvorschau bleibt schreibfrei');
const file = await confirmPersonExport(preview);
assertEqual(Object.keys(file.registry.profiles).join(), id, 'Export enthält genau die gewählte Person');
assertEqual(file.registry.profiles[id].data.depot_tranchen, f.records.depot_tranchen, 'Export verwendet bestätigtes Live-Depot');
assertEqual(file.registry.profiles[id].data.profile_cash_history_v1, f.records.profile_cash_history_v1, 'Export enthält Cashhistorie');
assert(!file.registry.profiles[id].data.overview_month_provision_v1 && !Object.keys(file.registry.profiles[id].data).some(key => key.startsWith('ruhestandsmodellValues')), 'Ein-Person-Datei enthält keine Haushaltsbelege oder Balance-Gesamtwerte');
assertEqual(Object.keys(file.globals).length, 0, 'Personenexport enthält keine Haushaltsglobals');
const inactive = await previewPersonExport(other);
assertEqual(inactive.file.registry.profiles[other].data.depot_tranchen, JSON.parse(f.records.rs_profiles_v1).profiles[other].data.depot_tranchen, 'Inaktive Person verwendet eigenes Depot');
const incoming = structuredClone(file); incoming.registry.profiles[id].meta.partnerProfileId = other;
incoming.registry.profiles[id].data.sim_partnerAktiv = 'true'; incoming.registry.profiles[id].data.sim_p2StartAlter = '55';
const plan = await previewPersonImport(incoming);
assertEqual(f.calls.length, 0, 'Importvorschau und Abbruch schreiben nichts');
const result = await importPersonFile(plan);
assertEqual(result.status, 'imported', 'Neue Außenperson dauerhaft bestätigt');
const registry = JSON.parse(f.records.rs_profiles_v1), oldRegistry = JSON.parse(JSON.parse(before).find(([key]) => key === 'rs_profiles_v1')[1]);
assertEqual(Object.keys(registry.profiles).length, Object.keys(oldRegistry.profiles).length + 1, 'Genau eine Person hinzugefügt');
for (const [key, profile] of Object.entries(oldRegistry.profiles)) assertEqual(JSON.stringify(registry.profiles[key]), JSON.stringify(profile), 'Bestehende Person bytegleich: ' + key);
for (const [key, value] of JSON.parse(before)) if (key !== 'rs_profiles_v1') assertEqual(f.records[key], value, 'Live, aktive Auswahl und Globals bytegleich: ' + key);
assertEqual(registry.profiles[result.id].meta.belongsToHousehold, false, 'Import erzeugt Außenperson');
assert(result.id !== id && result.name !== file.registry.profiles[id].meta.name, 'ID- und Namenskollisionen werden aufgelöst');
assert(!registry.profiles[result.id].meta.partnerProfileId && !registry.profiles[result.id].data.sim_partnerAktiv && !registry.profiles[result.id].data.sim_p2StartAlter, 'Fremde Partnerreferenzen und P2-Daten nicht übernommen');
const collision = await previewPersonImport(file);
assert(collision.id !== result.id && collision.name !== result.name, 'Wiederholter Import bekommt neue ID und Namen');
for (const mutation of [
    copy => copy.schemaVersion++, copy => copy.profileVersion++, copy => copy.registry.profiles.other = structuredClone(copy.registry.profiles[id]),
    copy => copy.globals.etfProxyUrl = 'https://synthetic.invalid', copy => copy.registry.profiles[id].data.unknown = 'x',
    copy => copy.registry.profiles[id].data.profile_tagesgeld = 'NaN', copy => copy.registry.profiles[id].data.depot_tranchen = '[{"shares":-1}]'
]) {
    const copy = structuredClone(file); mutation(copy); let rejected = false;
    try { normalizePersonFile(copy); } catch { rejected = true; }
    assert(rejected, 'Kaputte Version, Mehrpersonenbestand, Keys und Finanzwerte abgewiesen');
}
for (const mode of ['context', 'write', 'readback', 'rollback', 'trial']) {
    f = await fixture(); const baseline = canonical(f.records); const draft = await previewPersonImport(file);
    if (mode === 'context') p.setItemSync('rs_current_profile', other);
    if (mode === 'trial') p.setItemSync(PROBELAUF_STATE_KEY, '{}');
    if (mode === 'write') f.fail.write = true;
    if (['readback', 'rollback'].includes(mode)) f.fail.readback = true;
    if (mode === 'rollback') f.fail.rollback = true;
    let error; try { await importPersonFile(draft); } catch (e) { error = e; }
    assert(error, mode + ': Importfehler sichtbar');
    if (['context', 'trial'].includes(mode)) assertEqual(f.calls.filter(call => call.upserts.some(([key]) => key === 'rs_profiles_v1')).length, 0, mode + ': keine Registrymutation');
    else if (mode === 'rollback') assertEqual(error.code, 'rollback_failed', 'Unbestätigter Rollback wird nicht als Erfolg gemeldet');
    else assertEqual(canonical(f.records), baseline, mode + ': vorherige Bytes nach Rollback bestätigt');
}
f = await fixture(); let release; f.fail.gate = new Promise(resolve => release = resolve);
const draft = await previewPersonImport(file), first = importPersonFile(draft);
assertEqual((await importPersonFile(draft)).status, 'in_flight', 'Doppelklick startet keinen zweiten Import');
release(); await first;
f = await fixture(); const stale = await previewPersonExport(id); p.setItemSync('profile_tagesgeld', '42'); await p.flush();
let staleError; try { await confirmPersonExport(stale); } catch (error) { staleError = error; }
assert(staleError, 'Exportbestätigung verwirft veränderten Livebestand');
for (const action of [() => previewPersonExport(id, { probelaufController: { state: {} } }), () => previewPersonImport(file, { probelaufController: { busy: true } })]) {
    let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, 'Probelaufsperre gilt vor Export und Importvorschau');
}
resetPersistenceForTests();
