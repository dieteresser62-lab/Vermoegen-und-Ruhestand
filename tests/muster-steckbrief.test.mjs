import fs from 'node:fs';
import { MUSTER_HAUSHALTE, musterVarianten, musterVariante } from '../app/demo/muster-haushalte.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { musterSteckbrief, musterSteckbriefHtml, musterLesson } from '../app/demo/muster-steckbrief.js';
import { handbookMusterHtml, MUSTER_BLOCK } from '../scripts/docs-muster-steckbriefe.mjs';
import { personDisplayAge } from '../app/profile/profile-person-data.js';
import { parseCalendarDate, setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { readDocumentPersonInputs, createPersonOverrides } from '../app/simulator/simulator-person-overrides.js';
import { buildPlanOverview, resolvePlanOverviewRates } from '../app/simulator/simulator-plan-overview.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';

for (const date of ['2026-10-23', '2031-06-15']) for (const { id } of MUSTER_HAUSHALTE) {
    const records = createMusterHaushaltRecords(date, id), brief = musterSteckbrief(records, id, date), n = brief.numbers;
    const profiles = Object.values(JSON.parse(records.rs_profiles_v1).profiles);
    const wealth = profiles.reduce((sum, p) => sum + Number(p.data.profile_tagesgeld) + JSON.parse(p.data.depot_tranchen).reduce((s, lot) => s + lot.shares * lot.currentPrice, 0), 0);
    const plan = Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
    assertClose(n.wealth, wealth, 1e-7, `${id}: Geldvermögen aus allen erzeugten Beständen`);
    assertEqual(n.wealth, n.cash + n.depot + n.bonds + n.gold, `${id}: Geldvermögen enthält jede Anlageklasse einmal`);
    assertEqual(n.totalNeed, plan.floorBedarf + plan.flexBedarf, `${id}: Gesamtbedarf gleich Grundbedarf plus Wunschbedarf`);
    assert(brief.situation && brief.question && brief.observe && brief.exercises.length >= 1
        && brief.exercises.length <= (id === 'max-erika' ? 5 : ['helga-werner', 'renate'].includes(id) ? 4 : ['martin-petra', 'sophie'].includes(id) ? 3 : 2) && brief.restart, `${id}: vollständiger Steckbrief mit Neustartweg`);
    // RD-1: Max und Erika haben eine Übungszeile zur gerundeten Anzeige (FR-78).
    if (id === 'max-erika') assert(brief.exercises.some(text => text.includes('165.000 €') && text.includes('Details & Drucken')), 'Max und Erika: Übungszeile zur gerundeten Anzeige');
    if (id === 'martin-petra') assert(brief.exercises.some(text => text.includes('Todesjahrzeile') && text.includes('Herkunft')),
        'Martin und Petra: Übungszeile zur Finanzierung der Erbschaftsteuer');
    const html = musterSteckbriefHtml(brief);
    assert(html.includes('Grundbedarf') && html.includes('Wunschbedarf') && html.includes('Gesamtbedarf'), `${id}: dreiteiliger Bedarf`);
    if (id === 'renate') assertEqual(n.gap, 19200, 'Renate: 19.200 € vor Erträgen und Steuern');
    if (id === 'sophie') assertEqual(n.surplus, 7200, 'Sophie: 7.200 € vor Autoausgabe, nach 3.600 € Ratenkredit im Grundbedarf (GA-2)');
    if (id === 'sophie') assert(brief.exercises.some(text => text.includes('Ratenkredit')), 'Sophie: Übungszeile zur festen geplanten Ausgabe');
    if (id === 'jan-lena') {
        assertEqual(n.minimumFlexAnnual, 6750, 'Jan/Lena Mindest-Flex 6.750 €');
        assert(JSON.stringify(records).includes('Nettozahlung aus vereinbartem Verkauf'), 'Jan/Lena feste Nettozahlung richtig benannt');
    }
    if (id === 'max-erika') {
        assert(brief.exercises.some(text => text.includes('Güterstand') && text.includes('Erbschaftsteuer')), 'Max und Erika: Übung zum Güterstand und zur Simulatorsteuer');
        const years = date === '2026-10-23' ? '2027 und 2028' : '2032 und 2033';
        assert(brief.exercises[0].includes(`die Jahre ${years}`), `${date}: Rentenübung folgt Erikas Rentenbeginn`);
        const changed = JSON.parse(records.rs_profiles_v1);
        Object.values(changed.profiles)[1].data.profile_rentenbeginn = '2035-07-01';
        const changedBrief = musterSteckbrief({ ...records, rs_profiles_v1: JSON.stringify(changed) }, id, date);
        assert(changedBrief.exercises[0].includes('die Jahre 2035 und 2036'), 'Rentenübung liest den tatsächlichen Rentenbeginn aus den Records');
    }
    // Veränderung nur der erzeugten Records: Anzeige muss ihnen folgen, keiner zweiten Zahlentabelle.
    const registry = JSON.parse(records.rs_profiles_v1), first = Object.values(registry.profiles)[0];
    first.data.profile_tagesgeld = String(Number(first.data.profile_tagesgeld) + 1234);
    records.rs_profiles_v1 = JSON.stringify(registry);
    assertClose(musterSteckbrief(records, id, date).numbers.wealth, wealth + 1234, 1e-7, `${id}: Steckbrief folgt geladenen Daten`);
}
const block = fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8').match(MUSTER_BLOCK)[0];
assert(!musterLesson('renate', 'klein').exercises.some(text => /Wohnung|Immobilienverkauf/.test(text)),
    'QS-I 3: Renates Übungen verlangen keine im Beispiel fehlende Immobilie');
assertEqual(block, `<!-- muster-steckbriefe:start -->\n${handbookMusterHtml()}\n<!-- muster-steckbriefe:end -->`, 'Handbuch verweist mit aktueller Haushalts- und Variantenanzahl auf die Themensteckbriefe');

for (const date of ['2026-01-01', '2026-10-24']) for (const { id } of MUSTER_HAUSHALTE) for (const variant of musterVarianten(id)) {
    const records = createMusterHaushaltRecords(date, id, variant.id), brief = musterSteckbrief(records, id, date, variant.id);
    const people = Object.values(JSON.parse(records.rs_profiles_v1).profiles);
    const ages = people.map(p => personDisplayAge(p.data, parseCalendarDate(date)).age);
    if (['max-erika', 'martin-petra'].includes(id)) {
        people.forEach((p, i) => assert(brief.situation.includes(`${p.meta.name} (${ages[i]})`), `${id}: Alter am Testdatum wie in der Übersicht`));
    } else assert(brief.situation.includes(ages.join(' und ')), `${id}: Alter am Testdatum für alle Personen`);
    if (id === 'martin-petra' && date === '2026-10-24') assert(brief.situation.includes('Martin (67)') && brief.situation.includes('Petra (62)'), 'Martin und Petra am 24.10.2026: 67 und 62');
}
const care = createMusterHaushaltRecords('2026-10-24', 'helga-werner', 'haus-pg3');
const careFloor = Object.values(JSON.parse(care.household_plan_v1).entries)[0].values.floorBedarf;
assertEqual(careFloor, musterVariante('helga-werner', 'haus-pg3').floorBedarf, 'Grundbedarf der Pflegevariante stammt aus denselben Variantendaten wie die Übung');
// FR-73 (PFA-3): Der Grundbedarf der Variante ist ohne Pflege; die App rechnet Werners Pflege selbst.
assertEqual(careFloor, 36000, 'Pflegevariante: 36.000 € Grundbedarf ohne Pflege');
assert(musterLesson('helga-werner').exercises[0].includes(`${careFloor.toLocaleString('de-DE')} €`) && musterLesson('helga-werner').exercises[0].includes('rechnet die Pflege selbst')
    && musterLesson('helga-werner').exercises[0].includes('„Pflege Werner“ mit 1.500 €/Monat') && !musterLesson('helga-werner').exercises[0].includes('nicht von selbst'), 'Pflegeübung nennt den unveränderten Grundbedarf und die Pflegezeile in Balance');
// Neue Übung: Werner seit 01/2023 im Heim (Sollfall D, Testdatum 23.10.2026).
const heimWerner = musterLesson('helga-werner').exercises[2];
assert(heimWerner.includes('Pflegegrad heute 4') && heimWerner.includes('„im Heim“') && heimWerner.includes('01/2023') && heimWerner.includes('„Heim Werner“')
    && heimWerner.includes('2.611 €/Monat') && heimWerner.includes('Heimjahr 4') && heimWerner.includes('2.250 €/Monat'), 'Helga und Werner: Übung „Werner seit 01/2023 im Heim“ nennt Einstellung, Heimzeile, Heimjahr und Grundbedarf zu Hause');
assert(musterLesson('helga-werner', 'haus-pg3').note.includes('gewünschter Bedarf') && musterLesson('helga-werner', 'haus-pg3').note.includes('„Warum?“'), 'Pflegevariante erklärt finanziertes Budget und Kürzungsgrund in Balance');
assert(musterLesson('helga-werner').exercises[1].includes('zu Hause durch Angehörige') && musterLesson('helga-werner').exercises[1].includes('599 €/Monat kommt dazu'), 'Grundfall: Übung 2 wechselt von externer Unterstützung zu Pflegegeld');
// FR-72 Punkt 13 [A5]: Übung „beide Grad 4 im Heim“ mit Ort der Einstellung und sichtbarer Wirkung.
// FR-73 (H-HE2-5): beide heute Grad 4 im Heim, Sollfall S; die Übung braucht keinen gesuchten Zufallspfad mehr.
const heim = musterLesson('helga-werner').exercises[3];
assert(heim.startsWith('Beide Grad 4 im Heim') && heim.includes('Pflegegrad heute 4') && heim.includes('keinen Grundbedarf zu Hause')
    && heim.includes('92.736 €') && heim.includes('Heimjahr 1 bis 4') && heim.includes('eigenen Ausgaben im Heim'), 'Helga und Werner: Heimübung nennt Einstellung, Grundbedarf, Heimjahre und eigene Ausgaben');
assert(musterLesson('helga-werner').observe.includes('Übung 4'), 'Helga und Werner: Beobachtungsort der Heimübung');
assert(musterLesson('helga-werner', 'haus-pg3').exercises[1].includes('Grundbedarf zu Hause entfällt') && musterLesson('helga-werner', 'haus-pg3').exercises[1].includes('405.000 €'), 'Hausvariante: heute im Heim rechnet die App selbst und verkauft das Haus im ersten Jahr');
assert(musterLesson('helga-werner', 'haus-pg3').exercises[0].includes('externer Unterstützung') && musterLesson('helga-werner', 'haus-pg3').exercises[0].includes('fällt weg'), 'Hausvariante: Übung beginnt mit Angehörigenpflege und nimmt Pflegegeld heraus');

// Dieselbe Planprojektion wie in der sichtbaren Tabelle des Simulators.
const inputs = await measurementInputs(0, 'max-erika', '2026-10-23');
const persons = readDocumentPersonInputs(document), controls = createPersonOverrides(persons.entries, 'muster_a', 2026);
const rates = resolvePlanOverviewRates({ inflation: 2 });
const project = () => {
    const read = controls.read();
    return buildPlanOverview({ inputs: { ...inputs, ...read.combined }, entries: read.entries, referenceYear: 2026,
        inflationPct: rates.inflation.value, wagePct: rates.wage.value });
};
const before = project(); controls.activate(true); controls.set('muster_b', 'profile_rentenbeginn', '2028-07-01');
const after = project();
for (const [year, oldAmount, newAmount] of [[2027, 22800, 32400], [2028, 13200, 22800]]) {
    const old = before.rows.find(row => row.year === year), next = after.rows.find(row => row.year === year);
    const factor = Math.pow(1.02, year - 2026);
    assertEqual(Math.round(-old.result / factor), oldAmount, `${year}: Entnahme vorher in heutigen Euro`);
    assertEqual(Math.round(-next.result / factor), newAmount, `${year}: Entnahme nach Verschiebung in heutigen Euro`);
    assert(next.result < old.result, `${year}: fehlende Rente erhöht Entnahme aus dem Vermögen`);
}
assert(musterLesson('max-erika').exercises[0].includes('„Einkünfte, Ausgaben und Bedarf“') && musterLesson('max-erika').observe.includes('Balance'), 'Rentenübung verweist auf sichtbare Jahrestabelle, Wunschbedarf bleibt in Balance');
P.resetPersistenceForTests(); setAppTestDate(null);
