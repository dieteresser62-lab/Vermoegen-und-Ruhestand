import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
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
// SV-1: Punkte vor Personenlöschung und Haushaltsänderung sind entfallen; geprüft bleibt die Personenliste.
await fixture();
const elements = Object.fromEntries(['managerPeopleList', 'managerPersonCreateBtn', 'managerPeopleForm', 'managerPersonRenameBtn'].map(id => [id, { hidden: true }]));
renderManagerPeople({ getElementById: id => elements[id] }, 'muster_a');
assert(elements.managerPersonCreateBtn.hidden && elements.managerPeopleForm.hidden, 'Bei zwei Haushaltspersonen kein Anlegen');
const registry = JSON.parse(P.getItemSync('rs_profiles_v1'));
// Altbestand mit drei Personen: Anlegen bleibt gesperrt, jede Person bleibt löschbar.
registry.profiles.third = { meta: { id: 'third', name: 'Dritte Person' }, data: {} };
P.setItemSync('rs_profiles_v1', JSON.stringify(registry));
renderManagerPeople({ getElementById: id => elements[id] }, 'muster_a');
const html = elements.managerPeopleList.innerHTML;
assert(elements.managerPersonCreateBtn.hidden && html.includes('Dritte Person'), 'Dritte Person: sichtbar, kein Anlegen');
assertEqual((html.match(/data-person-action="delete"/g) || []).length, 3, 'Dritte Person: drei Löschknöpfe');
assert(!html.includes('disabled'), 'Dritte Person: Löschen nicht gesperrt');
