/** FR-73 Punkt 5: Balance rechnet heutige Pflege mit derselben Bedarfsfunktion wie der Simulator im ersten Jahr.
 * Grundlage sind die Bedarfsbasis ohne Pflege (bestätigter Haushaltsplan, sonst die gespeicherten Balance-Werte),
 * der heutige Pflegezustand der Personen und die Pflegepreise des Haushalts. Keine Todesfälle, keine Zufallsziehung,
 * keine Schreibzugriffe. */
import { calculateCareNeeds, careReference, survivorFloorPercent } from '../shared/care-needs.js';
import { resolveCarePrices } from '../shared/care-prices.js';
import { careSettingsStorage } from '../shared/care-profile-settings.js';
import { balanceCareSettings } from '../shared/person-data-status.js';
import { officialCareCosts } from '../shared/household-care-values.js';
import { defaultCareForm } from '../shared/care-benefits.js';
import { careTodayFromRecord } from '../profile/profile-care.js';
import { projectPerson } from '../profile/profile-person-data.js';
import { annualOtherIncome, effectiveIncomeFromRecord } from '../profile/profile-income.js';
import { computeRentAdjRate, householdPensionAdjustment } from '../shared/income-adjustment.js';
import { CARE_FLEX_DEFAULT_PERCENT } from '../simulator/simulator-care-flex.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';

const GRADES = [1, 2, 3, 4, 5];
const PERSON_KEYS = /** @type {const} */ (['p1', 'p2']);

/** Heutiger Pflegezustand als Metadaten des ersten Jahres, wie `makeDefaultCareMeta` im Simulator.
 *
 * @param {{grade?: number, homeCostsMonthly?: number|string}} care Heutige Pflege der Person.
 * @returns {object|null} Metadaten oder null ohne Pflegegrad.
 */
function careMetaToday(care) {
    const grade = Number(care?.grade) || 0;
    if (!grade) return null;
    return { active: true, triggered: true, startAge: -1, durationYears: 0, currentYearInCare: 1, zusatzFloorZiel: 0,
        zusatzFloorDelta: 0, flexFactor: 1, kumulierteKosten: 0, floorAtTrigger: 0, flexAtTrigger: 0, maxFloorAtTrigger: 0,
        grade, gradeLabel: '', mortalityFactor: 0, personGender: 'w', initialGrade: grade, initialProgressionFactor: 1,
        ...(Number.isFinite(care.homeCostsMonthly) ? { initialHomeCostsMonthly: care.homeCostsMonthly } : {}) };
}

/** Jahreseinkünfte einer Person im Folgejahr wie im Simulator (Gutachten PFA-4, Befund 1): Kalendergrenzen aus derselben
 * Personenprojektion wie die Balance-Einkünfte (Rentenbeginn, befristete Einkünfte) und die Fortschreibung des Folgejahrs –
 * Rente mit der Rentenanpassung des Haushalts (die des Hauptprofils wie im Simulator, Gutachten PFA-5 B1; fest, Inflation
 * oder Lohn, auch vor Rentenbeginn), feste Einkünfte nach ihrer Anpassung, Pflegegeld mit der Inflation. Inflation und
 * Lohnrate sind die Annahmen der Balance für das Folgejahr.
 *
 * @param {Record<string, string>} data Personenrecords.
 * @param {number} year Planjahr; projiziert wird das Jahr danach.
 * @param {object} settings Pflegeeinstellungen des Haushalts für diese Person.
 * @param {{inflationPercent: number, wagePercent: number}} rates Prozentsätze des Folgejahrs.
 * @param {{rentAdjMode?: string, rentAdjPct?: number}} adjustment Projektion des Hauptprofils mit der Haushalts-Rentenanpassung.
 * @returns {number} Euro im Folgejahr.
 */
function nextYearIncome(data, year, settings, { inflationPercent, wagePercent }, adjustment) {
    const person = projectPerson(data, year + 1, settings);
    const pensionAnnual = (person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12) * 12;
    const pensionRate = computeRentAdjRate(householdPensionAdjustment(adjustment, person), { inflation: inflationPercent, lohn: wagePercent });
    const other = annualOtherIncome(effectiveIncomeFromRecord(data), year + 1, { baseYear: year, inflationPct: inflationPercent, wagePct: wagePercent });
    return pensionAnnual * (1 + pensionRate / 100) + other + (person.pflegegeld || 0) * 12 * (1 + inflationPercent / 100);
}

/** Bedarf des laufenden Jahres und des Folgejahres aus dem heutigen Haushaltszustand.
 *
 * @param {object} options
 * @param {import('../../typcheck/balance-ui.js').PersonStatus} options.status Rechenumfang mit Personenrecords.
 * @param {import('../../typcheck/datenvertraege.js').RecordReader} options.storage Lesender Speicheradapter.
 * @param {{floorBedarf: number, flexBedarf: number, minimumFlexAnnual: number}} options.values Bedarfsbasis ohne Pflege.
 * @param {number} [options.referenceYear] Planjahr der Rechnung; der Heimjahr-Anker zählt danach, „seit“ nach heute (P7).
 * @param {number} [options.inflationPercent] Inflation für die Folgejahrespreise und -einkünfte.
 * @param {number} [options.wagePercent] Lohnrate für lohngebundene Folgejahreseinkünfte (Annahme der Balance).
 * @param {Date} [options.now] Heutiger Stichtag.
 * @returns {object|null} Bedarfsprojektion oder null ohne Pflegegrad heute.
 */
export function projectBalanceCareNeeds({ status, storage, values, referenceYear, inflationPercent = 0, wagePercent = 0, now = appNow() }) {
    const entries = status?.entries || [];
    if (!status?.ready || status.status === 'demo' || !entries.length || entries.length > 2) return null;
    const settings = balanceCareSettings(status);
    const persons = entries.map((entry, index) => ({ profileId: entry.profileId, name: entry.name || entry.profileId,
        key: PERSON_KEYS[index], care: careTodayFromRecord(entry.data, settings) }));
    if (!persons.some(person => person.care.grade > 0)) return null;
    const legacy = careSettingsStorage(storage, status.calculationProfileId ?? entries[0].profileId);
    const read = key => legacy.getItem(key);
    const number = (key, fallback) => {
        const raw = read(key), parsed = Number(String(raw ?? '').replace(',', '.'));
        return raw == null || String(raw).trim() === '' || !Number.isFinite(parsed) ? fallback : parsed;
    };
    const prices = resolveCarePrices(settings.careValues, legacy, { shared: !status.singleProfile });
    const official = settings.preset === 'amtlich' ? officialCareCosts(settings.careValues) : null;
    const pflegeGradeConfigs = Object.fromEntries(GRADES.map(grade => [grade, {
        zusatz: official ? official[grade] : prices.costs[grade],
        flexCut: Math.min(1, Math.max(0, number(`sim_pflegeStufe${grade}FlexCut`, CARE_FLEX_DEFAULT_PERCENT[grade]) / 100)),
        mortalityFactor: 0, ...(settings.forms[grade] !== defaultCareForm(grade) ? { careForm: settings.forms[grade] } : {}) }]));
    let floorPercent = 75;
    try { floorPercent = survivorFloorPercent(read('sim_survivorFloorPercent')); } catch { /* ungültiger Altwert: Vorgabe */ }
    const couple = persons.length === 2;
    // Rechnungstag wie im Simulator (P7, PFA-7): „seit“ zählt ab heute, der Anker nach dem Planjahr.
    const planYear = Number(referenceYear) || now.getFullYear();
    const reference = careReference(localCalendarDate(now), planYear), referenceDate = reference.careReferenceDate;
    const base = { floorBedarf: Number(values?.floorBedarf) || 0, flexBedarf: Number(values?.flexBedarf) || 0, minimumFlexAnnual: Number(values?.minimumFlexAnnual) || 0 };
    const inputs = { startFloorBedarf: base.floorBedarf, startFlexBedarf: base.flexBedarf, minimumFlexAnnual: base.minimumFlexAnnual,
        ...(persons[0].care.grade ? { careToday: persons[0].care } : {}),
        partner: { aktiv: couple, ...(couple && persons[1].care.grade ? { careToday: persons[1].care } : {}) },
        ...reference, survivorFloorPercent: floorPercent,
        ...(official ? { pflegeKostenStaffelPreset: 'amtlich' } : {}), pflegeGradeConfigs, pflegeMaxFloor: prices.maximumFloor,
        pflegeRampUp: 5, pflegeModellTyp: 'chronisch', pflegeKostenDrift: prices.driftPercent / 100,
        pflegeRegionalZuschlag: Math.max(0, number('sim_pflegeRegionalZuschlag', 0)) / 100,
        pflegeHeimEigeneAusgaben: prices.ownExpensesMonthly, careValues: settings.careValues };
    const household = { p1Alive: true, p2Alive: couple, care: { p1: careMetaToday(persons[0].care), p2: couple ? careMetaToday(persons[1].care) : null } };
    const needs = calculateCareNeeds({ inputs, household, referenceDate, yearIndex: 0, inflationFactor: 1,
        nextInflationFactor: 1 + (Number(inflationPercent) || 0) / 100, baseFloor: base.floorBedarf });
    const rows = persons.map((person, index) => ({ profileId: person.profileId, name: person.name, key: person.key,
        grade: person.care.grade, residentialSince: person.care.residentialSince || null, residentialFirstYear: person.care.residentialFirstYear || null,
        homeCostsMonthly: Number.isFinite(person.care.homeCostsMonthly) ? person.care.homeCostsMonthly : null, storedForm: person.care.form || null,
        ...pick(needs.current.persons[index]), next: pick(needs.next.persons[index]) }));
    // Gutachten PFA-2 Befund 2 und PFA-4 Befund 1: Das Liquiditätsziel braucht die Einkünfte des Folgejahrs mit Kalendergrenzen und Fortschreibung.
    const rates = { inflationPercent: Number(inflationPercent) || 0, wagePercent: Number(wagePercent) || 0 };
    // Gutachten PFA-5 B1: Im Haushalt gilt für beide Renten die Rentenanpassung des Hauptprofils (wie Profilkombination im Simulator).
    const adjustment = projectPerson(entries[0].data, planYear + 1, balanceCareSettings(status, entries[0].profileId));
    const nextIncomeAnnual = entries.reduce((sum, entry) => sum + nextYearIncome(entry.data, planYear, balanceCareSettings(status, entry.profileId), rates, adjustment), 0);
    return { referenceDate, referenceYear: reference.careReferenceYear, inflationPercent: Number(inflationPercent) || 0, prices: { origin: prices.origin, priceYear: prices.priceYear },
        preset: settings.preset || null, plan: base, persons: rows, current: totals(needs.current), next: { ...totals(needs.next), incomeAnnual: nextIncomeAnnual } };
}

function pick(person) {
    return { form: person.form, homeFloor: person.homeFloor, homeCareAddition: person.homeCareAddition, residentialCosts: person.residentialCosts,
        residentialOwnExpenses: person.residentialOwnExpenses, careAllowance: person.careAllowance, heimJahr: person.heimJahr, subsidy: person.subsidy,
        personal: person.homeCareAddition + person.residentialCosts + person.residentialOwnExpenses };
}

function totals(need) {
    return { total: need.total, homeFloor: need.homeFloor, homeFloorFactor: need.homeFloorFactor, homeCareAddition: need.homeCareAddition,
        residentialCosts: need.residentialCosts, residentialOwnExpenses: need.residentialOwnExpenses, flexFactor: need.flexFactor,
        minimumFlexFactor: need.minimumFlexFactor, careAllowance: need.careAllowance };
}

/** Engine-Eingaben wie im Simulator: voller Floor mit Pflege, Flex und Mindest-Flex mit absolutem Pflege-Level,
 * Liquiditätsziel aus dem Folgejahr mit Heimjahr + 1, Folgejahrespreisen und Folgejahreseinkünften.
 *
 * @param {Record<string, unknown>} inputData Balance-Eingaben des Rechenumfangs.
 * @param {ReturnType<typeof projectBalanceCareNeeds>} careNeeds Projektion aus {@link projectBalanceCareNeeds}.
 * @returns {Record<string, unknown>} Dieselben Eingaben, ergänzt.
 */
export function applyBalanceCareNeeds(inputData, careNeeds) {
    if (!careNeeds) return inputData;
    const priceFactor = 1 + careNeeds.inflationPercent / 100;
    inputData.floorBedarf = careNeeds.current.total;
    inputData.flexBedarf = careNeeds.plan.flexBedarf * careNeeds.current.flexFactor;
    inputData.minimumFlexAnnual = careNeeds.plan.minimumFlexAnnual * careNeeds.current.minimumFlexFactor;
    inputData.careLiquidityProjection = { floor: careNeeds.next.total, flex: careNeeds.plan.flexBedarf * priceFactor * careNeeds.next.flexFactor,
        income: careNeeds.next.incomeAnnual, priceFactor };
    return inputData;
}

/** Angesetzte Pflegekosten je Person für den Pflegehinweis (FR-73 Punkt 10; €/Monat, Jahr 1 ohne Flex). `own` nennt, ob
 * der eigene Wert „Pflegekosten heute über die Kasse hinaus“ statt der Staffel gilt (FR-73 Punkt 13).
 *
 * @param {ReturnType<typeof projectBalanceCareNeeds>} careNeeds Projektion aus derselben Bedarfsfunktion wie im Simulator.
 * @returns {{profileId: string, name: string, grade: number, residential: boolean, own: boolean, monthly: number|null}[]} Personen mit Pflegegrad heute.
 */
export function careHintPersons(careNeeds) {
    return (careNeeds?.persons || []).filter(person => person.grade > 0).map(person => {
        const residential = person.residentialCosts > 0 || person.form === 'residential';
        return { profileId: person.profileId, name: person.name, grade: person.grade, residential,
            own: !residential && careNeeds.preset !== 'amtlich' && Number.isFinite(person.homeCostsMonthly),
            monthly: (person.homeCareAddition + person.residentialCosts + person.residentialOwnExpenses) / 12 };
    });
}

/** Persönliche Pflegekosten je Person für die Finanzierungsverteilung unverheirateter Paare (FR-72 Punkt 10, B9).
 *
 * @param {ReturnType<typeof projectBalanceCareNeeds>} careNeeds Projektion.
 * @returns {Record<string, number>} Euro im Jahr je Profil.
 */
export function personalCareCosts(careNeeds) {
    return Object.fromEntries((careNeeds?.persons || []).map(person => [person.profileId, person.personal]));
}
