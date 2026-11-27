import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { calculateCareNeeds } from '../app/shared/care-needs.js';
import { makeDefaultCareMeta } from '../app/simulator/simulator-engine-helpers.js';
import { allLivingInExternalCare } from '../app/simulator/simulator-home-sale.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

// PFLEGE.md: Max und Erika, Jahresbeträge ohne Preisfortschreibung.
const inputs = await measurementInputs(0, 'max-erika', '2026-11-15');
Object.assign(inputs, { pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, pflegeMaxFloor: 120000 });
inputs.partner.careToday = { grade: 2, form: 'family', progression: 'usual' };
assertEqual(inputs.startFloorBedarf, 30000, 'Grundbedarf aus dem Beispielhaushalt');
assertEqual(inputs.pflegeGradeConfigs[2].zusatz, 6000, 'Grad-2-Staffel des Beispiels');
assertEqual(inputs.pflegeGradeConfigs[3].zusatz, 18000, 'Grad-3-Staffel des Beispiels');
const erika = makeDefaultCareMeta(false, inputs.partner.geschlecht, inputs.partner.careToday,
    inputs.partner.startAlter, inputs);
const household = { p1Alive: true, p2Alive: true, care: { p1: null, p2: erika } };
const before = JSON.stringify(household);
const today = calculateCareNeeds({ inputs, household, referenceDate: '2026-11-15' });
const max = { active: true, grade: 3, currentYearInCare: 1 };
const laterHousehold = { ...household, care: { ...household.care, p1: max } };
const later = calculateCareNeeds({ inputs, household: laterHousehold, referenceDate: '2026-11-15' });
for (const result of [today.current, today.next]) {
    assertEqual(result.homeFloor, 30000, 'Heute: Grundbedarf ohne Pflege');
    assertEqual(result.persons[0].homeCareAddition, 0, 'Heute: Max ohne Pflegezusatz');
    assertEqual(result.persons[1].homeCareAddition, 6000, 'Heute: Erikas Pflegezusatz automatisch addiert');
    assertEqual(result.total, 36000, 'Heute: Grundbedarf und Pflege');
    assertEqual(result.careAllowance, 4164, 'Heute: Pflegegeld separat als Einnahme');
    assertEqual(result.total - result.careAllowance, 31836, 'Heute: nach Pflegegeld zu decken');
}
for (const result of [later.current, later.next]) {
    assertEqual(result.homeFloor, 30000, 'Später: unveränderter Grundbedarf');
    assertEqual(result.persons[0].homeCareAddition, 18000, 'Später: Max mit Grad 3');
    assertEqual(result.persons[1].homeCareAddition, 6000, 'Später: Erikas Zusatz unverändert');
    assertEqual(result.persons[1].form, 'home-support', 'Später: externe Unterstützung für Erika');
    assertEqual(result.total, 54000, 'Später: Grundbedarf und beide Pflegezusätze');
    assertEqual(result.careAllowance, 0, 'Später: Pflegegeld entfällt');
    assertEqual(result.total - result.careAllowance, 54000, 'Später: nach Pflegegeld zu decken');
}
assertEqual(later.current.total - later.current.careAllowance
    - (today.current.total - today.current.careAllowance), 22164, 'Mehrbedarf einschließlich Max: 22.164 Euro');
assertEqual(today.current.careAllowance - later.current.careAllowance, 4164, 'Angehörigenausfall allein: 4.164 Euro');
assert(!allLivingInExternalCare(inputs, laterHousehold), 'Externe Unterstützung löst keinen Heimverkauf aus');
assertEqual(JSON.stringify(household), before, 'Beispielrechnung verändert den heutigen Pflegezustand nicht');
setAppTestDate(null);
