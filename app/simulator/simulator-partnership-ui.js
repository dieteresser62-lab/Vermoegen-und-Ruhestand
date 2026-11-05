import { PARTNERSHIP_KEY, readPartnership, inheritsHomeAndTax, hasTestament, testamentRule, testamentDescription, hasInheritanceHomes } from '../profile/household-partnership.js';
import { persistenceStorage } from '../shared/persistence-facade.js';

/** Erbquoten anzeigen und bei Nicht verheiratet den Renteneditor sperren.
 *
 * @param doc Zugehöriges Simulatordokument.
 * @param inputs Wirksame Simulationseingaben.
 * @param [storage] Bestehender Speicheradapter.
 * @returns {void}
 */
export function renderPartnershipSummary(doc, inputs, storage = persistenceStorage) {
    const host = doc.getElementById('simPartnershipNotice'); if (!host) return;
    const partnership = readPartnership(storage.getItem(PARTNERSHIP_KEY));
    const people = inputs.simulationPeople || [];
    const unmarried = people.length === 2 && partnership.status === 'unmarried';
    host.hidden = !unmarried;
    doc.getElementById('simPartnershipPending').hidden = !unmarried;
    if (unmarried) {
        const text = people.map((person, index) => `${people[1 - index].name} ${inheritsHomeAndTax(partnership, person.profileId, hasInheritanceHomes(inputs.home, person.profileId))
            ? `Immobilien + Steuer und ${partnership.inheritance[person.profileId] ?? 0} % vom übrigen Geldvermögen`
            : `${partnership.inheritance[person.profileId] ?? 0} %`}${hasTestament(partnership, person.profileId, hasInheritanceHomes(inputs.home, person.profileId)) ? ' vom Geldvermögen · ' + testamentDescription(testamentRule(partnership, person.profileId)) : ''} von ${person.name}`).join(', ');
        doc.getElementById('simPartnershipText').textContent = `Nicht verheiratet: keine Hinterbliebenenrente. Im Todesfall erbt ${text}.`;
    }
    for (const id of ['widowPensionMode', 'widowPensionPct', 'widowMarriageOffsetYears', 'widowMinMarriageYears']) {
        const field = doc.getElementById(id); if (!field) continue;
        field.disabled = unmarried;
        if (id === 'widowPensionMode' || id === 'widowPensionPct') {
            field.hidden = unmarried;
            const display = doc.getElementById(id === 'widowPensionMode' ? 'simUnmarriedPensionMode' : 'simUnmarriedPensionPct');
            if (display) display.hidden = !unmarried;
        }
        /** @type {HTMLElement} */ (field.closest('.ds-field, .household-plan-field'))?.classList.toggle('sim-partnership-locked', unmarried);
    }
}
