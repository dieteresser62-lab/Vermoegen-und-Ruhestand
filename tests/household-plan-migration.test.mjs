import { CONFIG } from '../app/balance/balance-config.js';
import { analyzeHouseholdPlanMigration, chooseMigrationValues, addDirectHouseholdPlans, migrateHouseholdPlans } from '../app/profile/household-plan-migration.js';
import { HOUSEHOLD_PLAN_KEY, assertHouseholdPlanRecord } from '../app/profile/household-plan.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { SnapshotArchive as A } from '../app/shared/snapshot-archive.js';
import { isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { requestHouseholdPlanMigration } from '../app/profile/household-plan-dialog.js';
import { documentDouble } from './helpers/page-dialog-dom.mjs';

function fixture({ inputs = {}, shared = {}, sim = {}, override, active = 'z' } = {}) {
    const state = JSON.stringify({ inputs: { floorBedarf: 30000, flexBedarf: 20000, minimumFlexAnnual: 5000, flexBudgetAnnual: 7000, ...inputs }, profilverbundHouseholdInputs: shared });
    const data = { [CONFIG.STORAGE.LS_KEY]: state, ...sim };
    const registry = { version: 1, profiles: {
        z: { meta: { belongsToHousehold: true }, data }, a: { meta: { belongsToHousehold: true }, data: { ...data } },
        outside: { meta: { belongsToHousehold: false }, data: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 9000 } }) } }
    } };
    return { rs_profiles_v1: JSON.stringify(registry), rs_current_profile: active, rs_active_profile: active,
        ...registry.profiles[active].data, ...(override ? { household_simulator_needs_v1: JSON.stringify(override) } : {}) };
}
const household = records => analyzeHouseholdPlanMigration(records).analyses.find(analysis => analysis.scope.kind === 'household');
const first = household(fixture());
assertEqual(first.sourceId, 'z', 'Hauptprofil folgt Profilreihenfolge, nicht sortiertem Bereich');
assertEqual(first.conflicts.length, 0, 'Identische Mitgliedskopien ohne gespeicherte Simulatordefaults still');
for (const [field, expected] of [['floorBedarf', 30000], ['flexBedarf', 20000], ['minimumFlexAnnual', 5000], ['flexBudgetAnnual', 7000]]) assertEqual(first.values[field], expected, 'Haushalt übernimmt einmal: ' + field);
assertEqual(household(fixture({ active: 'outside' })).values.floorBedarf, 30000, 'Aktive Außenperson verdrängt die Hauptprofilquelle nicht');
assertEqual(household(fixture({ shared: { floorBedarf: 31000 } })).values.floorBedarf, 31000, 'Explizite Haushaltsquelle hat Vorrang');
const override = { schemaVersion: 1, mode: 'override', source: 'manual', overriddenFields: ['startFloorBedarf'], values: { startFloorBedarf: '32000' } };
const difference = household(fixture({ override }));
assertEqual(difference.conflicts.length, 1, 'Teiloverride erzeugt nur tatsächlichen Feldkonflikt');
const selected = chooseMigrationValues(difference, { floorBedarf: 'simulator' });
assertEqual(selected.floorBedarf, 32000, 'Simulatorauswahl wird übernommen');
assertEqual(selected.flexBedarf, 20000, 'Teiloverride erhält übrige Mitgliedswerte');
const zero = household(fixture({ inputs: { minimumFlexAnnual: 0, capeRatio: 0, dynamicFlex: false }, sim: { sim_dynamicFlex: 'false', sim_marketCapeRatio: '0' } }));
assertEqual(zero.conflicts.length, 0, '0 und false sind vorhanden und vergleichbar');
assertEqual(zero.fields.find(field => field.path === 'cape.value').balance.status, 'present', 'Gespeicherte CAPE-Null hat Rohpräsenz');
const aliases = household(fixture({ inputs: { runwayTargetMonths: 37, decumulation: { mode: 'vpw' } }, sim: { sim_runwayTargetMonths: '37', sim_entnahmeStrategie: 'guardrails' } }));
assertEqual(aliases.values.liquidityRunwayYears, 3.5, 'Alte Monatsreichweite wird ohne Altwrite auf halbe Jahre aufgelöst');
assertEqual(aliases.values.decumulation.mode, 'standard', 'Bekannte Altstrategien normalisiert');
assertEqual(aliases.conflicts.length, 0, 'Normalisierte Altwerte bleiben still');
const broken = household(fixture({ sim: { sim_entnahmeStrategie: 'future', sim_horizonYears: 'kaputt' } }));
assert(broken.warnings.length >= 2 && broken.conflicts.length === 0, 'Unlesbare Aliase werden genannt und nicht zu Defaults-Konflikten');
const onlySim = fixture(); const registry = JSON.parse(onlySim.rs_profiles_v1);
for (const id of ['z', 'a']) registry.profiles[id].data = { sim_startFloorBedarf: '12345', sim_startFlexBedarf: '999', sim_minimumFlexAnnual: '0' };
onlySim.rs_profiles_v1 = JSON.stringify(registry); delete onlySim[CONFIG.STORAGE.LS_KEY]; Object.assign(onlySim, registry.profiles.z.data);
assertEqual(household(onlySim).values.floorBedarf, 12345, 'Nur Simulator übernimmt gespeicherte Quelle');
assertEqual(household(onlySim).conflicts.length, 0, 'Fehlende Balance erzeugt keinen Defaultkonflikt');
const invalidCoupling = household(fixture({ inputs: { minimumFlexAnnual: 25000 } }));
let invalid = false; try { chooseMigrationValues(invalidCoupling); } catch { invalid = true; }
assert(invalid, 'Ungültige Kopplung wird ohne Clamping zurückgewiesen');
const direct = addDirectHouseholdPlans(fixture({ override }), { now: () => new Date('2026-10-09') });
assertEqual(assertHouseholdPlanRecord(direct[HOUSEHOLD_PLAN_KEY]).entries[first.scope.key].values.floorBedarf, 30000, 'Kopie wählt Balance ohne Rückfrage');
assertEqual(addDirectHouseholdPlans(direct)[HOUSEHOLD_PLAN_KEY], direct[HOUSEHOLD_PLAN_KEY], 'Direkter Plan beim Datumssprung idempotent');
assert(!Object.hasOwn(direct, 'annual_plan_record_v1'), 'Migration erzeugt niemals einen Jahresbeleg');
const membership = structuredClone(direct); const changedRegistry = JSON.parse(membership.rs_profiles_v1);
changedRegistry.profiles.new = { meta: { belongsToHousehold: true }, data: {} }; membership.rs_profiles_v1 = JSON.stringify(changedRegistry);
const enlarged = addDirectHouseholdPlans(membership);
assertEqual(Object.keys(assertHouseholdPlanRecord(enlarged[HOUSEHOLD_PLAN_KEY]).entries).length, 3, 'Neue Mitgliedschaft übernimmt eindeutigen Haushaltsplan und bewahrt Historie/Außenperson');

async function boot(records) {
    const map = new Map(Object.entries(records));
    const backend = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
    P.resetPersistenceForTests(createLocalStorageAdapter(backend)); await P.init({ installLifecycleHooks: false });
}
// Getrennt gespeicherte Quellen können ohne Feldkonflikt eine ungültige Kopplung ergeben.
for (const flex of [20000, undefined]) for (const action of ['later', 'escape', 'accept']) {
    const before = fixture({ inputs: { flexBedarf: flex, minimumFlexAnnual: undefined }, sim: { sim_minimumFlexAnnual: '25000' } });
    const item = household(before), sourceValues = JSON.stringify(item.values);
    assertEqual(item.conflicts.length, 0, 'Ungültige Standardkopplung benötigt keinen Feldkonflikt');
    assertEqual(item.coupledFields.join(','), 'flexBedarf,minimumFlexAnnual', 'Beide gekoppelten Felder sind ausdrücklich korrigierbar');
    const copied = addDirectHouseholdPlans(before);
    assertEqual(JSON.stringify(copied), JSON.stringify(before), 'Direkte Kopie bleibt startfähig, ohne Ersatzwerte oder Teilplan');
    let foreignCorrection = false;
    try { chooseMigrationValues(item, { corrections: { floorBedarf: 1 } }); } catch { foreignCorrection = true; }
    assert(foreignCorrection, 'Manuelle Auflösung kann keine fremden Planfelder ändern');
    await boot(before);
    const env = documentDouble(); let choices = 0;
    const pending = migrateHouseholdPlans({ isBlocked: () => false, choose: analysis => {
        choices++; return requestHouseholdPlanMigration(analysis, { doc: env.doc });
    } });
    for (let i = 0; i < 100 && !env.dialog()?.open; i++) await Promise.resolve();
    assert(env.dialog()?.open, 'Ungültige Kopplung öffnet auch ohne Feldkonflikt den echten Dialog');
    const correction = path => env.nodes.find(node => node.dataset.householdPlanCorrection === path);
    const accept = env.nodes.find(node => node.dataset.householdPlanAccept !== undefined);
    assert(env.nodes.some(node => node.textContent?.includes('Mindest-Flex ≤ Flex-Bedarf')), 'Dialog erklärt die gemeinsame Bedingung und den Ausweg');
    accept.fire('click');
    assert(env.dialog().open, 'Ungültiger Vorschlag kann nicht bestätigt werden');
    const minimum = correction('minimumFlexAnnual');
    minimum.value = ''; minimum.fire('input'); accept.fire('click');
    assert(env.dialog().open, 'Leeres Korrekturfeld wird nicht still zu Null');
    minimum.value = '25000'; minimum.fire('input');
    assertEqual((await A.listSnapshots()).length, 0, 'Offene Auswahl erzeugt keinen Wiederherstellungspunkt');
    if (action === 'later') env.nodes.find(node => node.dataset.householdPlanLater !== undefined).fire('click');
    if (action === 'escape') env.dialog().fire('keydown', { key: 'Escape' });
    if (action === 'accept') {
        // Beide fachlich gültigen Wege: Mindest-Flex senken oder Flex-Bedarf erhöhen.
        const input = correction(flex === undefined ? 'flexBedarf' : 'minimumFlexAnnual');
        input.value = flex === undefined ? '27000' : '15000'; input.fire('input'); accept.fire('click');
    }
    const result = await pending;
    assertEqual(choices, 1, 'Korrektur erfolgt in einer bedienbaren Auswahl');
    assertEqual(result.status, action === 'accept' ? 'migrated' : 'deferred', action + ': kontrollierter Abschluss');
    for (const [key, raw] of Object.entries(before)) assertEqual(P.getItemSync(key), raw, action + ': Altquelle bleibt bytegleich: ' + key);
    assertEqual(JSON.stringify(item.values), sourceValues, 'Korrektur verändert die Analysequelle nicht');
    if (action === 'accept') {
        const values = assertHouseholdPlanRecord(P.getItemSync(HOUSEHOLD_PLAN_KEY)).entries[item.scope.key].values;
        assertEqual(values.minimumFlexAnnual, flex === undefined ? 25000 : 15000, 'Explizite Mindest-Flex-Entscheidung ohne Clamping');
        assertEqual(values.flexBedarf, flex === undefined ? 27000 : 20000, 'Explizite Flex-Bedarf-Entscheidung ohne Clamping');
        assertEqual((await A.listSnapshots()).length, 1, 'Bestätigung besitzt genau einen gesicherten Altbestand');
    } else {
        assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), null, action + ': kein Planwrite');
        assertEqual((await A.listSnapshots()).length, 0, action + ': kein Snapshotwrite');
    }
    assert(env.cleaned(), action + ': Dialoglistener vollständig entfernt');
}
P.resetPersistenceRuntimeForTests();
for (const fault of ['', 'flush', 'snapshot', 'readback', 'write', 'context', 'deferred']) {
    const before = fixture({ override }); await boot(before);
    const events = []; let asks = 0;
    const persistence = { ...P,
        async flush(options) { events.push('flush'); if (fault === 'flush') return false; return P.flush(options); },
        async replaceRecordsTransactional(records, options) {
            events.push('planwrite');
            assert(events.indexOf('flush') < events.indexOf('snapshot-read'), 'Flush geht dem Punktreadback voraus');
            assert(events.indexOf('snapshot-read') < events.indexOf('planwrite'), 'Zurückgelesener Punkt geht jedem Planwrite voraus');
            if (fault === 'write') throw new Error('synthetischer Writefehler');
            return P.replaceRecordsTransactional(records, options);
        } };
    const archive = {
        async createSnapshot(args, options) { events.push('snapshot-write'); assertEqual(args.label, 'Vor Umstellung Haushalt & Plan', 'Benannter Recoverypunkt'); assertEqual(args.kind, 'household-plan-migration-recovery', 'Neue Umstellung verwendet dauerhafte Snapshot-Art'); if (fault === 'snapshot') throw new Error('Punktfehler'); return A.createSnapshot(args, options); },
        async readSnapshot(id, options) { events.push('snapshot-read'); const value = await A.readSnapshot(id, options); if (fault === 'readback') value.records.rs_current_profile = 'fremd'; if (fault === 'context') P.setItemSync('rs_current_profile', 'outside'); return value; }
    };
    const options = { storage: persistenceStorage, persistence, archive, isBlocked: () => false,
        choose: async () => { asks++; return fault === 'deferred' ? null : {}; } };
    let result, error;
    const pending = migrateHouseholdPlans(options), concurrent = migrateHouseholdPlans(options);
    try { result = await pending; await concurrent; } catch (caught) { error = caught; await concurrent.catch(() => {}); }
    assertEqual(asks, 1, 'Doppelte Bestätigung teilt eine Quellenentscheidung');
    if (!fault) {
        assertEqual(result.status, 'migrated', 'Produktive Transaktion mit Backendreadback bestätigt');
        const raw = P.getItemSync(HOUSEHOLD_PLAN_KEY);
        assertEqual((await migrateHouseholdPlans(options)).status, 'unchanged', 'Reload migriert bestätigte Bereiche nicht erneut');
        assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), raw, 'Reload erhält Rohrecord/Zeitstempel');
        for (const [key, value] of Object.entries(before)) assertEqual(P.getItemSync(key), value, 'Alte Quellen bleiben bytegleich: ' + key);
    } else {
        assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), null, fault + ': kein ungesicherter/fremder Teilplan');
        assert(fault === 'deferred' ? result.status === 'deferred' && !events.includes('planwrite') : Boolean(error), fault + ': kein Erfolgsstatus');
    }
}
assert(isAllowedSnapshotCaptureKey(HOUSEHOLD_PLAN_KEY), 'Plan gehört zum gesicherten Rohumfang');

// Tatsächliche Adapterfehler nach Writebeginn müssen den gesicherten Altbestand zurückholen.
for (const fault of ['ack-without-write', 'partial-write', 'plan-readback', 'context-after-write']) {
    const before = fixture({ override }), values = { ...before }, points = new Map();
    let injected = false;
    const adapter = { name: 'H1-Fehleradapter',
        async loadAll() {
            if (fault === 'plan-readback' && values[HOUSEHOLD_PLAN_KEY] && !injected) { injected = true; return { ...values, [HOUSEHOLD_PLAN_KEY]: '{"version":1,"entries":{}}' }; }
            return { ...values };
        },
        async saveBatch({ deletes, upserts }) {
            const planWrite = upserts.some(([key]) => key === HOUSEHOLD_PLAN_KEY);
            if (planWrite && !injected && fault === 'ack-without-write') { injected = true; return; }
            deletes.forEach(key => delete values[key]); upserts.forEach(([key, raw]) => values[key] = raw);
            if (planWrite && !injected && fault === 'partial-write') { injected = true; throw new Error('Write nach Anwendung fehlgeschlagen'); }
            if (planWrite && !injected && fault === 'context-after-write') { injected = true; P.setItemSync('rs_current_profile', 'outside'); }
        },
        async writeSnapshot(point) { points.set(point.id, structuredClone(point)); },
        async readSnapshot(id) { return structuredClone(points.get(id)); }, async listSnapshots() { return [...points.values()]; }
    };
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
    let failed = false;
    try { await migrateHouseholdPlans({ choose: async () => ({}), isBlocked: () => false }); } catch { failed = true; }
    assert(failed && injected, fault + ': echter Write-/Readbackfehler wird nicht bestätigt');
    assertEqual(values[HOUSEHOLD_PLAN_KEY], undefined, fault + ': bestätigter Rollback entfernt neuen Plan im Backend');
    assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), null, fault + ': Cache aktiviert keinen Teilplan');
    assertEqual(values[CONFIG.STORAGE.LS_KEY], before[CONFIG.STORAGE.LS_KEY], fault + ': alte Balancequelle bytegleich');
    assertEqual(values.rs_profiles_v1, before.rs_profiles_v1, fault + ': Registry und fremde Profilquellen bleiben erhalten');
    assertEqual(points.size, 1, fault + ': gesicherter Rückkehrpunkt bleibt verfügbar');
}
for (const raw of ['{', '{"version":2,"entries":{}}']) {
    const records = { ...fixture(), [HOUSEHOLD_PLAN_KEY]: raw }; await boot(records);
    let failed = false;
    try { await migrateHouseholdPlans(); } catch { failed = true; }
    assert(failed, 'Beschädigter oder zukünftiger Plan startet keine neue Umstellung');
    assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), raw, 'Vorhandener ungültiger Planrohrecord wird niemals überschrieben');
    assertEqual((await A.listSnapshots()).length, 0, 'Ungültiger Plan erzeugt keinen vorbereitenden Umstellungspunkt');
}
P.resetPersistenceRuntimeForTests();

// Aufschub in einem zweiten Bereich darf den bereits gewählten ersten nicht veröffentlichen.
{
    const records = fixture({ override });
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles.outside.data.sim_dynamicFlex = 'false';
    const state = JSON.parse(registry.profiles.outside.data[CONFIG.STORAGE.LS_KEY]);
    state.inputs.dynamicFlex = true;
    registry.profiles.outside.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    records.rs_profiles_v1 = JSON.stringify(registry);
    await boot(records); let choices = 0;
    const result = await migrateHouseholdPlans({ choose: async () => ++choices === 1 ? {} : null });
    assertEqual(choices, 2, 'Haushalts- und Außenpersonkonflikt werden getrennt entschieden');
    assertEqual(result.status, 'deferred', 'Aufschub eines weiteren Bereichs vertagt die gemeinsame Transaktion');
    assertEqual(P.getItemSync(HOUSEHOLD_PLAN_KEY), null, 'Auch der zuvor gewählte Haushaltsbereich bleibt ohne Teilplan');
    for (const [key, raw] of Object.entries(records)) assertEqual(P.getItemSync(key), raw, 'Bereichsübergreifender Aufschub erhält Altquelle: ' + key);
    assertEqual((await A.listSnapshots()).length, 0, 'Bereichsaufschub erzeugt keinen unnötigen Wiederherstellungspunkt');
}
P.resetPersistenceRuntimeForTests();

// Unbestätigte Rücknahme sperrt Folgeschreiber über die vorhandene Recoverymechanik.
{
    const before = fixture({ override }), values = { ...before }, points = new Map();
    const adapter = { name: 'H1-Rollbackfehler', async loadAll() { return { ...values }; },
        async saveBatch({ deletes, upserts }) {
            if (deletes.includes(HOUSEHOLD_PLAN_KEY)) throw new Error('Rücknahme nicht möglich');
            deletes.forEach(key => delete values[key]); upserts.forEach(([key, raw]) => values[key] = raw);
            if (upserts.some(([key]) => key === HOUSEHOLD_PLAN_KEY)) throw new Error('Write nach Anwendung fehlgeschlagen');
        },
        async writeSnapshot(point) { points.set(point.id, structuredClone(point)); },
        async readSnapshot(id) { return structuredClone(points.get(id)); }, async listSnapshots() { return [...points.values()]; }
    };
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
    let error;
    try { await migrateHouseholdPlans({ choose: async () => ({}) }); } catch (cause) { error = cause; }
    assertEqual(error?.code, 'rollback_failed', 'Unbestätigte Rücknahme wird ausdrücklich als Recoveryfall gemeldet');
    assert(P.hasSyncWriteBlocks(), 'Rollbackfehler hält die vorhandene Schreibsperre aktiv');
    for (const key of [HOUSEHOLD_PLAN_KEY, CONFIG.STORAGE.LS_KEY, 'rs_current_profile', 'sim_dynamicFlex']) {
        let blocked = false; try { P.setItemSync(key, 'veraltet'); } catch (cause) { blocked = cause.code === 'PERSISTENCE_RELOAD_REQUIRED'; }
        assert(blocked, 'Recovery verhindert veralteten Folgeschreiber: ' + key);
    }
    assertEqual([...points.values()][0].records.rs_profiles_v1, before.rs_profiles_v1, 'Bestätigter Punkt enthält den ursprünglichen Rohbestand für Recovery');
}
P.resetPersistenceRuntimeForTests();
