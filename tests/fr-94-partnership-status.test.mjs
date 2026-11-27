import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';

console.log('FR-94: Erbvorschau für einen Paarhaushalt ohne Partnerschaftsstatus');
const records = {};
P.resetPersistenceForTests({ async loadAll() { return records; }, async saveBatch() {} });
try {
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    assertEqual(P.getItemSync(PARTNERSHIP_KEY), null, 'Der synthetische Paarhaushalt hat keinen Partnerschaftsrecord');
    const profiles = [{ id: 'a', name: 'Anna', assets: 100000 }, { id: 'b', name: 'Bert', assets: 80000 }]
        .map(person => ({ ...person, belongs: true, valid: true, values: { tagesgeld: person.assets }, tranches: [] }));
    const nodes = Object.fromEntries(['managerPartnership', 'managerInheritance', 'managerPartnershipMarried', 'managerPartnershipSummary', 'managerPartnershipStatus']
        .map(id => [id, { innerHTML: '', textContent: '', querySelectorAll: () => [] }]));
    renderManagerPartnership({ getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {} }, { profiles });
    assertEqual(nodes.managerPartnershipStatus.textContent, '', 'Erbvorschau wird berechnet');
    assert(nodes.managerPartnershipSummary.textContent.startsWith('Partnerschaftsstatus fehlt ·'), 'Kurzstand meldet den fehlenden Status');
    assert(nodes.managerInheritance.innerHTML.includes('20.000\u00a0€ Freibetrag'), 'Vorschau verwendet den persönlichen Freibetrag der Steuerklasse III');
    assert(nodes.managerInheritance.innerHTML.includes('24.000\u00a0€'), 'Auf 80.000 € steuerpflichtiges Erbe fallen 24.000 € Steuer an');
} finally {
    P.resetPersistenceForTests();
}
