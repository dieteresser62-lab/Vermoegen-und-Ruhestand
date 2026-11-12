/** @import {CareMeta,Random,SimulatorInputs} from '../../typcheck/rechenkern' */
/** Lebensereignisse und Heimzähler für Monte Carlo und die festgehaltene heutige Pflege.
 * Reine Preise und Bedarfsbestandteile liegen in shared/care-needs.js. */
import { officialResidentialShare } from '../shared/household-care-values.js';
import { initialResidentialYear, replacesHomeFloor, residentialAnnualCosts } from '../shared/care-needs.js';
import { localCalendarDate } from '../shared/app-clock.js';
export { RESIDENTIAL_OWN_EXPENSES_MONTHLY_DEFAULT, residentialOwnExpensesMonthly, residentialOwnExpensesInputPatch,
    livesInResidentialCare, replacesHomeFloor, residentialAnnualCosts, residentialNeedForYear,
    nextYearCareState, nextYearResidentialNeed, residentialSpending } from '../shared/care-needs.js';
import { careFormForPerson } from '../shared/care-benefits.js';

/** Punkt 4: Die heutige Pflegeform ist „im Heim“; der Anfangszähler kommt aus „im Heim seit“.
 *
 * @param {Partial<SimulatorInputs>} inputs Wirksame Simulationseingaben.
 * @param {CareMeta|null|undefined} care Pflege-Metadaten der Person.
 * @param {number} personIndex 0 für P1, 1 für P2.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function isTodayResidential(inputs, care, personIndex) {
    const grade = Number(care?.initialGrade) || 0;
    return grade > 0 && careFormForPerson(inputs, grade, personIndex) === 'residential';
}

/** Punkt 7: „Amtlich“ mit gezogener Form, also nur in Monte Carlo.
 *
 * @param {Partial<SimulatorInputs>} inputs Wirksame Simulationseingaben.
 * @param {CareMeta|null|undefined} care Pflege-Metadaten der Person.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function drawsOfficialCareForm(inputs, care) {
    return inputs?.pflegeKostenStaffelPreset === 'amtlich' && typeof care?.heimZufall === 'number' && Number.isFinite(care.heimZufall);
}

/** Punkt 7: Zufallszahl U einer Person. Eine bekannte heutige Form legt fest, auf welcher Seite des Heimanteils
 * des heutigen Grads U liegt; U bleibt darin gleichverteilt. So gilt die heutige Form bis zum ersten
 * Gradwechsel, und ein Heim bleibt bei steigendem Grad erhalten.
 *
 * @param {CareMeta|null} care Pflege-Metadaten der Person.
 * @param {Partial<SimulatorInputs>} inputs Wirksame Simulationseingaben.
 * @param {number} personIndex 0 für P1, 1 für P2.
 * @param {number} draw Gleichverteilte Zahl aus dem eigenen Strom, 0 ≤ draw < 1.
 * @returns {void}
 */
function assignOfficialCareDraw(care, inputs, personIndex, draw) {
    if (!care) return;
    const grade = Number(care.initialGrade) || 0;
    if (!grade) {
        care.heimZufall = draw;
        return;
    }
    const share = officialResidentialShare(grade);
    care.heimZufall = careFormForPerson(inputs, grade, personIndex) === 'residential' ? draw * share : share + draw * (1 - share);
}

/** Punkt 7: Einmal beim Anlegen eines Monte-Carlo-Laufs je Person U aus dem eigenen Strom `CARE_FORM`.
 * fork() verbraucht nichts; Markt-, Grad- und Todesziehungen bleiben gleich. P1 zieht zuerst, auch ohne
 * eigene Metadaten, damit U von P2 nicht von P1 abhängt. Replay und Fortsetzung übernehmen die Metadaten.
 *
 * @param {Partial<SimulatorInputs>} inputs Wirksame Simulationseingaben.
 * @param {Random} rand Zufallsstrom des Laufs.
 * @param {CareMeta|null} careP1 Pflege-Metadaten von P1.
 * @param {CareMeta|null} careP2 Pflege-Metadaten von P2.
 * @returns {void}
 */
export function assignOfficialCareDraws(inputs, rand, careP1, careP2) {
    if (inputs.pflegeKostenStaffelPreset !== 'amtlich' || (!careP1 && !careP2)) return;
    const stream = rand.fork('CARE_FORM');
    const drawP1 = stream(), drawP2 = stream();
    assignOfficialCareDraw(careP1, inputs, 0, drawP1);
    assignOfficialCareDraw(careP2, inputs, 1, drawP2);
}

const RESIDENTIAL_STATE_KEYS = ['heimBestand', 'heimStartJahr', 'heimJahr', 'heimZuschuss', 'heimKosten', 'heimEigeneAusgaben'];

/** @param {CareMeta} care */
function clearResidentialCareState(care) {
    for (const key of RESIDENTIAL_STATE_KEYS) if (Object.hasOwn(care, key)) delete care[key];
}

/** Punkte 1, 4, 15 und 16: tatsächliche Form nach dem Angehörigenausfall bestimmen und ablegen.
 * Das erste Simulationsjahr im Heim ist Heimjahr 1; das Heimjahr folgt allein aus dem Jahresindex,
 * wiederholte Aufrufe im selben Jahr zählen also nicht weiter. Verlässt die Person das Heim
 * (Ende akuter Pflege, andere Zeilenform), endet der Zustand.
 *
 * @param {CareMeta|null} care Pflege-Metadaten der Person.
 * @param {SimulatorInputs} inputs Wirksame Simulationseingaben.
 * @param {number} personIndex 0 für P1, 1 für P2.
 * @param {{p1Alive?: boolean; p2Alive?: boolean; care?: {p1?: CareMeta|null; p2?: CareMeta|null}}} household Haushalt nach Grad und Tod.
 * @param {number} yearIndex Nullbasierter Index des Simulationsjahrs.
 * @returns {void}
 */
export function updateResidentialCareState(care, inputs, personIndex, household, yearIndex) {
    if (!care) return;
    const form = care.active === true ? careFormForPerson(inputs, care.grade, personIndex, household) : null;
    const usesResidentialRules = inputs.pflegeKostenStaffelPreset !== 'amtlich' || Number(care.initialGrade) > 0 || drawsOfficialCareForm(inputs, care);
    // Die tatsächlich verwendete Form speichern; Protokoll und Replay ziehen sie nicht nochmals.
    // Außerhalb der Heimregeln bleiben bestehende Zustandsbytes erhalten.
    if (form && usesResidentialRules && (form === 'residential' || drawsOfficialCareForm(inputs, care))) care.careForm = form;
    else if (Object.hasOwn(care, 'careForm')) delete care.careForm;
    // Punkt 7: Bei „Amtlich“ nur mit gezogener Form; careFormForPerson liest sie aus `household`.
    const residential = care.active === true && usesResidentialRules && form === 'residential';
    if (!residential) {
        clearResidentialCareState(care);
        return;
    }
    // Ausschließlich aus alten gespeicherten Läufen: deren Bestandsvertrag weiter lesen.
    // Neue Initialisierungen setzen heimBestand nie.
    if (care.heimBestand === true) return;
    // Historische Heimjahre beeinflussen nur den Zuschuss, nie Verlauf oder Preisindex.
    if (yearIndex === 0 && isTodayResidential(inputs, care, personIndex) && care.heimStartJahr == null) {
        const today = personIndex === 0 ? inputs.careToday : inputs.partner?.careToday;
        care.heimStartJahr = 1 - initialResidentialYear(today?.residentialSince, inputs.careReferenceDate || localCalendarDate(),
            today?.residentialFirstYear, inputs.careReferenceYear);
    }
    const start = Number(care.heimStartJahr);
    if (!Number.isInteger(start) || start > yearIndex) care.heimStartJahr = yearIndex;
    care.heimJahr = yearIndex - Number(care.heimStartJahr) + 1;
}

/** Preise des laufenden Heimjahrs nach den Todesziehungen; ohne Heimjahr bleibt die Metadaten unverändert.
 *
 * @param {CareMeta|null} care Pflege-Metadaten der Person.
 * @param {SimulatorInputs} inputs Wirksame Simulationseingaben.
 * @param {number} inflationFactor Kumulierte Inflation zu Jahresbeginn (Jahr 1: 1).
 * @param {number} yearIndex Nullbasierter Index des Simulationsjahrs.
 * @returns {void}
 */
export function priceResidentialCare(care, inputs, inflationFactor, yearIndex) {
    if (!replacesHomeFloor(care)) return;
    const prices = residentialAnnualCosts(/** @type {CareMeta} */ (care), inputs, { yearIndex, heimJahr: Number(care?.heimJahr),
        inflationFactor });
    Object.assign(/** @type {CareMeta} */ (care), { heimZuschuss: prices.subsidy, heimKosten: prices.costs,
        heimEigeneAusgaben: prices.ownExpenses });
}
