import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { applyProfileManagementAction, validateProfileManagementAction } from '../app/profile/profile-manager-bindings.js';
import { recordIdentity } from '../app/shared/snapshot-restore.js';
import { renderManagerPeople, syncManagerPeopleControls, projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerProfiles } from '../app/tranches/tranchen-manager-renderer.js';
import { householdMemberCount, HOUSEHOLD_MINIMUM_REASON, HOUSEHOLD_CURRENT_LIMIT_MESSAGE } from '../app/profile/profile-registry.js';
import { readBalancePersonStatus, readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { EXPENSES_STORAGE_KEY } from '../app/balance/balance-expenses-storage.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';

async function fixture(change = () => {}) {
    const records = createMusterHaushaltRecords('2026-09-01');
    const registry = JSON.parse(records.rs_profiles_v1);
    change(registry, records);
    records.rs_profiles_v1 = JSON.stringify(registry);
    const points = new Map(), batches = [];
    P.resetPersistenceForTests({ name: 'synthetic-ph-1c', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batches.push(batch); batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async point => points.set(point.id, point), readSnapshot: async id => points.get(id),
        listSnapshots: async () => [...points.values()], deleteSnapshot: async id => points.delete(id) });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { records, points, batches };
}
// SV-1: Wie die Personenverwaltung: prüfen, anwenden, speichern; ein Wiederherstellungspunkt entsteht nicht mehr.
async function execute(request) {
    validateProfileManagementAction(request);
    assert(applyProfileManagementAction(request), request.kind + ': Aktion ausgeführt');
    await P.flush();
}
function people(records) {
    const nodes = Object.fromEntries(['managerPeopleList', 'managerPersonCreateBtn', 'managerPeopleForm', 'managerPersonRenameBtn'].map(id => [id, {}]));
    renderManagerPeople({ getElementById: id => nodes[id] }, records.rs_current_profile);
    return nodes.managerPeopleList.innerHTML;
}

// F7: Eine Haushaltsperson; Altflag `true` und fehlendes Flag gelten gleich.
for (const explicit of [true, false]) {
    const { records, points, batches } = await fixture(registry => {
        delete registry.profiles.muster_b;
        if (explicit) registry.profiles.muster_a.meta.belongsToHousehold = true;
        else delete registry.profiles.muster_a.meta.belongsToHousehold;
    });
    const before = recordIdentity(records);
    const rows = people(records).split('</article>');
    assert(/button[^>]*disabled[^>]*title="Ein Haushalt braucht mindestens eine Person\."[^>]*data-person-action="delete"/.test(rows[0]), 'F7: Letzter Löschknopf ist gesperrt und erklärt');
    assertEqual((rows[0].match(/data-person-disabled-reason=/g) || []).length, 1, 'F7: Löschknopf behält seinen fachlichen Sperrgrund');
    let message;
    try { await execute({ kind: 'delete', profileId: 'muster_a' }); } catch (error) { message = error.message; }
    assertEqual(message, HOUSEHOLD_MINIMUM_REASON, 'F7: Untergrenze vor Rückkehrpunkt');
    assertEqual(points.size, 0, 'F7: Abweisung erzeugt keinen Punkt');
    assertEqual(batches.length, 0, 'F7: Abweisung schreibt nichts');
    assertEqual(recordIdentity(records), before, 'F7: Abweisung erhält alle Bytes');
    assertEqual(householdMemberCount(JSON.parse(records.rs_profiles_v1)), 1, 'F7: Haushaltsperson erhalten');
}
{
    const controls = [
        { dataset: { personDisabledReason: HOUSEHOLD_MINIMUM_REASON }, disabled: true },
        { dataset: { personDisabledReason: HOUSEHOLD_MINIMUM_REASON }, disabled: true },
        { dataset: {}, disabled: false }
    ];
    const doc = { getElementById: () => ({ querySelectorAll: () => controls }) };
    syncManagerPeopleControls(doc, true);
    assert(controls.every(control => control.disabled), 'F7: Laufender Schreibauftrag sperrt alle Personenaktionen');
    syncManagerPeopleControls(doc, false);
    assert(controls[0].disabled && controls[1].disabled && !controls[2].disabled, 'F7: Freigabe erhält Untergrenzensperren und gibt übrige Aktionen frei');
}

// F4a: Ein fremder beschädigter Record darf keine Personenaktion sperren.
for (const key of ['rs_data_backup_summary_v1', HOUSEHOLD_PLAN_KEY, EXPENSES_STORAGE_KEY, 'rs_daily_prices_v1']) {
    const { records, points } = await fixture((registry, records) => { records[key] = '{"fremd":true}'; });
    await execute({ kind: 'delete', profileId: 'muster_b' });
    assertEqual(records[key], '{"fremd":true}', 'F4a: Fremder Record bleibt bytegleich: ' + key);
    assertEqual(points.size, 0, 'SV-1: Personenaktion legt keinen Punkt an');
    assert(!JSON.parse(records.rs_profiles_v1).profiles.muster_b, 'F4a: Personenaktion trotz Fremdschaden gespeichert');
}

// Ein fremdes Profil wird unverändert mitgeführt; sein Fachinhalt gehört nicht zur Aktion (Altbestand mit drei Personen).
{
    const { records } = await fixture(registry => {
        registry.profiles.other = { meta: { id: 'other', name: 'Musterperson 3' }, data: { profile_tagesgeld: 'kaputt' } };
    });
    const foreign = JSON.stringify(JSON.parse(records.rs_profiles_v1).profiles.other);
    await execute({ kind: 'delete', profileId: 'muster_b' });
    assertEqual(JSON.stringify(JSON.parse(records.rs_profiles_v1).profiles.other), foreign, 'F4a: Unbeteiligte Person bleibt unverändert');
}

// Betroffene Daten und die nach aktiver Löschung geladene Person bleiben geprüft.
for (const bad of ['target', 'live', 'fallback', 'identity', 'registry']) {
    const { records, points, batches } = await fixture((registry, records) => {
        if (bad === 'target') registry.profiles.muster_b.data.profile_tagesgeld = 'kaputt';
        if (bad === 'live') records.profile_tagesgeld = 'kaputt';
        if (bad === 'fallback') registry.profiles.muster_b.data.profile_tagesgeld = 'kaputt';
        if (bad === 'identity') records.rs_active_profile = 'fehlt';
        if (bad === 'registry') registry.profiles.muster_b.meta.belongsToHousehold = 'kaputt';
    });
    const before = recordIdentity(records);
    let rejected = false;
    try { await execute({ kind: 'delete', profileId: bad === 'target' ? 'muster_b' : 'muster_a' }); } catch { rejected = true; }
    assert(rejected && points.size === 0 && batches.length === 0, 'F4a: Betroffener Schaden wird vor Punkt und Write abgewiesen: ' + bad);
    assertEqual(recordIdentity(records), before, 'F4a: Betroffene Schäden erhalten alle Bytes');
}
{
    const { records } = await fixture();
    await execute({ kind: 'delete', profileId: 'muster_a' });
    assertEqual(records.rs_current_profile, 'muster_b', 'F7: Bei zwei Mitgliedern bleibt aktive Löschung mit Personenwechsel möglich');
    assertEqual(records.rs_active_profile, 'muster_b', 'F7: Geladene Person stimmt mit aktueller Person überein');
}

// Der Hinweis zählt alle Personen.
for (const count of [3, 4]) {
    const { records } = await fixture(registry => {
        for (let i = 2; i < count; i++) registry.profiles['member' + i] = { meta: { id: 'member' + i, name: 'Musterperson ' + i }, data: {} };
    });
    const registry = JSON.parse(records.rs_profiles_v1), expected = HOUSEHOLD_CURRENT_LIMIT_MESSAGE(count);
    assert(expected.startsWith(`Dein Haushalt hat ${count} Personen;`), '3: Meldung nennt die tatsächliche Zahl');
    const storage = { getItem: key => records[key] ?? null };
    for (const read of [readBalancePersonStatus, readHouseholdPersonStatus]) assertEqual(read({ storage, win: null }).message, expected, '3: Balance und Simulatorstatus zählen Mitglieder');
    assertEqual(projectOverview({ registry, activeId: records.rs_current_profile, liveData: records }).householdLimit, expected, '3: Übersicht zählt Mitglieder');
    let message; try { combineSimulatorProfiles(Array.from({ length: count }, () => ({}))); } catch (error) { message = error.message; }
    assertEqual(message, expected, '3: Simulatoraggregation zählt Mitglieder');
    const host = { innerHTML: '' };
    renderManagerProfiles({ getElementById: id => id === 'managerHousehold' ? host : null }, projectManagerProfiles(registry, records.rs_current_profile));
    assert(host.innerHTML.includes(expected), '3: Haushaltskarte zählt Mitglieder');
}
// SV-1: Punkte vor dem Löschen aller Tranchen sind mit der Archivleerung entfallen.
