import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createProfileManagementRecovery } from '../app/profile/profile-management-recovery.js';
import { applyProfileManagementAction } from '../app/profile/profile-manager-bindings.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { previewSnapshotRestore, executeSnapshotRestore, recordIdentity } from '../app/shared/snapshot-restore.js';
import { isAllowedPersistenceImportKey } from '../app/shared/persistence-key-policy.js';
import { renderManagerPeople } from '../app/tranches/tranchen-manager-profiles.js';
const fixture = async () => {
    const data = createMusterHaushaltRecords('2026-09-01');
    const batches = [];
    P.resetPersistenceForTests({ name: 'localStorage', async loadAll() { return { ...data }; }, async saveBatch(batch) {
        batches.push(batch); for (const key of batch.deletes) delete data[key];
        for (const [key, value] of batch.upserts) data[key] = value;
    } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { data, batches };
};
for (const kind of ['delete', 'membership']) {
    const { data } = await fixture();
    const before = recordIdentity(await P.readPersistedRecords(isAllowedPersistenceImportKey));
    const point = await createProfileManagementRecovery(kind === 'delete' ? 'Vor dem Löschen von Erika' : 'Vor dem Ändern des Haushalts');
    applyProfileManagementAction({ kind, profileId: 'muster_b', belongs: false }); await P.flush();
    const points = await SnapshotArchive.listSnapshots();
    assert(points.some(p => p.id === point.id), kind + ': automatischer Punkt dauerhaft vorhanden');
    assertEqual(recordIdentity(point.records), before, kind + ': Punkt enthält vollständige alte Bytes');
    assert(recordIdentity(await P.readPersistedRecords(isAllowedPersistenceImportKey)) !== before, kind + ': Aktion ausgeführt');
    const preview = await previewSnapshotRestore(point.id);
    const result = await executeSnapshotRestore(preview, { reload: () => true });
    assertEqual(result.status, 'restored', kind + ': Punkt zurückgeholt');
    assertEqual(recordIdentity(await P.readPersistedRecords(isAllowedPersistenceImportKey)), before,
        kind + ': Person, Partnerschaft, Testament, gemeinsamer Plan und Ausgaben bytegleich wiederhergestellt');
}
await fixture();
const elements = Object.fromEntries(['managerPeopleList', 'managerPersonCreateBtn', 'managerPeopleForm', 'managerPersonRenameBtn'].map(id => [id, { hidden: true }]));
renderManagerPeople({ getElementById: id => elements[id] }, 'muster_a');
assert(elements.managerPersonCreateBtn.hidden && elements.managerPeopleForm.hidden, 'Bei zwei Haushaltspersonen kein Anlegen');
const registry = JSON.parse(P.getItemSync('rs_profiles_v1'));
registry.profiles.third = { meta: { id: 'third', name: 'Dritte Person', belongsToHousehold: false }, data: {} };
P.setItemSync('rs_profiles_v1', JSON.stringify(registry));
renderManagerPeople({ getElementById: id => elements[id] }, 'muster_a');
assert(elements.managerPeopleList.innerHTML.includes('input disabled') && elements.managerPeopleList.innerHTML.includes('Ein Haushalt hat höchstens zwei Personen.'), 'Dritte Person: Häkchen mit Grund gesperrt');
