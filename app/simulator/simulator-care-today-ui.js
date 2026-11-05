/** Ausschließlich Lesezeilen; die Eingaben bleiben in der Personenkarte.
 *
 * @param doc Zugehöriges Simulatordokument.
 * @param inputs Wirksame Simulationseingaben.
 * @returns {void}
 */
export function renderCareTodaySummary(doc, inputs) {
    const host = doc.getElementById('simCareTodaySummary');
    if (!host) return;
    const rows = [
        [inputs.careToday, inputs.simulationPeople?.[0]?.name || 'Person 1'],
        [inputs.partner?.aktiv ? inputs.partner.careToday : null, inputs.simulationPeople?.[1]?.name || 'Person 2']
    ].filter(([care]) => care?.grade).map(([care, name]) => {
        return `${name} Grad ${care.grade}`;
    });
    host.hidden = !rows.length;
    host.textContent = rows.length ? `Pflegegrad heute: ${rows.join(' · ')} (aus Personen & Vermögen)` : '';
}
