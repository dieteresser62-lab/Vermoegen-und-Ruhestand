import { CARE_FORMS } from '../shared/care-benefits.js';

/** Ausschließlich Lesezeilen; die Eingaben bleiben in der Personenkarte.
 * Der Simulator berechnet heutige Pflege automatisch aus dem Haushaltszustand.
 *
 * @param doc Zugehöriges Simulatordokument.
 * @param inputs Wirksame Simulationseingaben.
 * @returns {void}
 */
export function renderCareTodaySummary(doc, inputs) {
    const host = doc.getElementById('simCareTodaySummary');
    if (!host) return;
    const people = [
        [inputs.careToday, inputs.simulationPeople?.[0]?.name || 'Person 1'],
        [inputs.partner?.aktiv ? inputs.partner.careToday : null, inputs.simulationPeople?.[1]?.name || 'Person 2']
    ].filter(([care]) => care?.grade);
    // FR-73 Punkt 13: ein eigener Wert für Pflege zu Hause heute steht neben Grad und Form, nur wo er wirkt (nicht bei „Amtlich“, Argon FR73A B4).
    const ownApplies = care => care.form !== 'residential' && inputs.pflegeKostenStaffelPreset !== 'amtlich' && Number.isFinite(care.homeCostsMonthly);
    const rows = people.map(([care, name]) => `${name} Grad ${care.grade}${CARE_FORMS[care.form] ? ` ${CARE_FORMS[care.form]}` : ''}${care.form === 'residential' && care.residentialSince ? ` seit ${care.residentialSince.slice(5)}/${care.residentialSince.slice(0, 4)}` : ''}${ownApplies(care) ? ` (eigener Wert ${care.homeCostsMonthly.toLocaleString('de-DE')} €/Monat)` : ''}`);
    const residential = people.some(([care]) => care.form === 'residential');
    host.hidden = !rows.length;
    if (host.dataset) host.dataset.homeCareGrades = people.filter(([care]) => care.form !== 'residential').map(([care]) => care.grade).join(',');
    host.textContent = rows.length ? `Pflegegrad heute: ${rows.join(' · ')} (aus Personen & Vermögen).${residential
        ? ' Heimkosten und eigene Ausgaben berechnet der Simulator aus den Pflegewerten und dem Heimjahr.' : ' Pflegekosten und Flex-Level berechnet der Simulator aus der Staffel.'}` : '';
    host.dispatchEvent?.(new Event('care-today-change'));
}
