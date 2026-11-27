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
import { estimateCareAidNet } from '../shared/care-aid.js';
import { activeCarrier } from '../profile/household-withdrawal-mode.js';
import { annualOtherIncome, effectiveIncomeFromRecord } from '../profile/profile-income.js';
import { computeRentAdjRate, householdPensionAdjustment } from '../shared/income-adjustment.js';
import { CARE_FLEX_DEFAULT_PERCENT, CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY, migrateCareFlexRecord } from '../simulator/simulator-care-flex.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { readImmobilien, IMMOBILIEN_KEY } from '../profile/profile-immobilien.js';

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
    const legacy = careSettingsStorage(storage);
    const read = key => legacy.getItem(key);
    // HL-1 (H-FLEX-ALT): Alte Flex-Vorgabe ohne Marke nur projizieren wie `care-price-fields.js` und der Simulator; nichts wird geschrieben.
    const flex = migrateCareFlexRecord(Object.fromEntries([...CARE_FLEX_FIELD_KEYS, CARE_FLEX_MIGRATION_KEY].map(key => [key, read(key)])));
    const number = (key, fallback, source = read) => {
        const raw = source(key), parsed = Number(String(raw ?? '').replace(',', '.'));
        return raw == null || String(raw).trim() === '' || !Number.isFinite(parsed) ? fallback : parsed;
    };
    const prices = resolveCarePrices(settings.careValues, legacy);
    const official = settings.preset === 'amtlich' ? officialCareCosts(settings.careValues) : null;
    const pflegeGradeConfigs = Object.fromEntries(GRADES.map(grade => [grade, {
        zusatz: official ? official[grade] : prices.costs[grade],
        flexCut: Math.min(1, Math.max(0, number(`sim_pflegeStufe${grade}FlexCut`, CARE_FLEX_DEFAULT_PERCENT[grade], key => flex[key]) / 100)),
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
        // FR-73 Punkt 8 geändert: Index 0 ist das Planjahr, die Hochrechnung ins Folgejahr nimmt dessen Rate.
        pflegeKostenDriftBis: prices.driftUntilYear, pflegeKostenDriftDanach: prices.driftAfterPercent / 100, pflegeKostenStartJahr: planYear,
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
    // NK-2b (Gutachten NK2C Befund 3): Folgejahreseinkünfte auch je Person (Hilfeschätzung Unverheirateter), Summe für das Liquiditätsziel.
    const nextIncomes = entries.map(entry => nextYearIncome(entry.data, planYear, balanceCareSettings(status, entry.profileId), rates, adjustment));
    const nextIncomeAnnual = nextIncomes.reduce((sum, value) => sum + value, 0);
    rows.forEach((row, index) => { /** @type {any} */ (row).nextIncome = nextIncomes[index] || 0; });
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

/** NK-2 (FR-84 Punkt 18): Lebt genau eine von zwei Personen im Heim, die Person zu Hause; sonst null.
 * @param {any} careNeeds Pflegeprojektion. @param {boolean} [following] Folgejahr statt Planjahr. @returns {string|null} */
export function homeAloneCarrier(careNeeds, following = false) {
    const persons = careNeeds?.persons || [];
    const inHome = persons.map((/** @type {any} */ person) => ((following ? person.next : person)?.residentialCosts || 0) > 0);
    return persons.length === 2 && inHome.filter(Boolean).length === 1 ? persons[inHome.indexOf(false)].profileId : null;
}

/** FR-84 Punkt 11, NK-2 (Codex 4 und 6): Hilfe zur Pflege im Planjahr aus der Pflegeprojektion, dem Geldvermögen netto (wie im
 * Simulator nach Verkaufssteuer) und den Einkünften je Person. Mit `nextYear` für das Folgejahr (Liquiditätsziel): Pflege und
 * Einkünfte des Folgejahrs; wer im Planjahr schon Hilfe bekommt, hat danach kein eigenes Geld mehr, sonst bleibt das Geld nach den
 * Ausgaben des Planjahrs aus dem Vermögen. `inputData.floorBedarf` ist dann schon um die Hilfe des Planjahrs gemindert.
 * @param {{careNeeds: any, profiles: any[], inputData: Record<string, any>, unmarried: boolean, mode: string, lossCarry?: number,
 *   nextYear?: {currentAid: import('../shared/care-aid.js').CareAidEstimate|null}|null}} options
 * @returns {import('../shared/care-aid.js').CareAidEstimate|null} */
export function estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried, mode, lossCarry = 0, nextYear = null }) {
    const careOf = (/** @type {any} */ need) => (need?.homeCareAddition || 0) + (need?.residentialCosts || 0) + (need?.residentialOwnExpenses || 0);
    const need = nextYear ? careNeeds?.next || {} : careNeeds?.current || {};
    const careTotal = careOf(need);
    if (!(careTotal > 0.005)) return null;
    const personal = (/** @type {string} */ id, /** @type {boolean} */ following) => {
        const person = (careNeeds.persons || []).find((/** @type {any} */ row) => row.profileId === id);
        return (following ? person?.next?.personal : person?.personal) || 0;
    };
    const income = (/** @type {any} */ values) => values?.renteAktiv ? (Number(values.renteMonatlich) || 0) * 12 : 0;
    const lotsOf = (/** @type {any} */ values, /** @type {any[]|undefined} */ tranches) => tranches?.length ? tranches : [
        { marketValue: Number(values?.depotwertAlt) || 0, costBasis: Number(values?.costBasisAlt) || 0, tqf: Number(values?.tqfAlt) || 0 },
        { marketValue: Number(values?.depotwertNeu) || 0, costBasis: Number(values?.costBasisNeu) || 0, tqf: Number(values?.tqfNeu) || 0 },
        { marketValue: Number(values?.goldWert) || 0, costBasis: Number(values?.goldCost) || 0, taxExempt: values?.goldSteuerfrei === true },
        { marketValue: Number(values?.geldmarktEtf) || 0, costBasis: Number(values?.geldmarktEtf) || 0 }];
    const source = profiles.length ? profiles.map(entry => ({ profileId: entry.profileId, name: entry.name, inputs: entry.inputs, tranches: entry.tranches,
        lossCarry: entry.balanceState?.lastState?.taxState?.lossCarry })) : [{ profileId: careNeeds.persons?.[0]?.profileId || 'haushalt', name: undefined,
        inputs: inputData, tranches: inputData.detailledTranches, lossCarry }];
    // Personen eines Jahres: Pflege und Einkünfte des Plan- oder Folgejahres; gemeinsame Kasse mit den Einkünften des ganzen Haushalts.
    const build = (/** @type {boolean} */ following) => {
        const list = source.map(entry => {
            const lots = lotsOf(entry.inputs, entry.tranches), cash = Number(entry.inputs?.tagesgeld) || 0;
            const row = (careNeeds.persons || []).find((/** @type {any} */ item) => item.profileId === entry.profileId);
            const money = cash + lots.reduce((sum, lot) => sum + (Number(lot.marketValue) || 0), 0);
            return { profileId: entry.profileId, ...(entry.name ? { name: entry.name } : {}), cash, lots, money, shareBasis: money,
                income: following && Number.isFinite(row?.nextIncome) ? row.nextIncome : income(entry.inputs),
                sparerPauschbetrag: entry.inputs?.sparerPauschbetrag, kirchensteuerSatz: entry.inputs?.kirchensteuerSatz, lossCarry: entry.lossCarry,
                care: profiles.length ? personal(entry.profileId, following) : careOf(following ? careNeeds.next : careNeeds.current) };
        });
        if (!unmarried || list.length < 2) {
            const household = following ? Number(careNeeds.next?.incomeAnnual) || 0 : income(inputData);
            list.forEach((person, index) => { person.income = index === 0 ? household : 0; });
        }
        // NK-2 (FR-84 Punkt 18): Ist eine von zwei unverheirateten Personen im Heim, trägt die andere den Grundbedarf zu Hause allein; NK-2c: die
        // Einkünfte der Person im Heim zahlen zuerst ihr Heim (`inHome`).
        const atHome = unmarried && list.length === 2 ? homeAloneCarrier(careNeeds, following) : null;
        for (const person of list) if (atHome && person.profileId !== atHome) Object.assign(person, { inHome: true });
        return { list, carrierId: atHome || activeCarrier(mode, profiles) };
    };
    const jointAssessment = inputData.jointAssessment === true;
    const planFloor = (Number(inputData.floorBedarf) || 0) + (nextYear?.currentAid?.total || 0) - careOf(careNeeds.current);
    const plan = build(false);
    if (!nextYear) return estimateCareAidNet({ persons: plan.list, basicFloor: planFloor, unmarried, carrierId: plan.carrierId, jointAssessment });
    // NK-2c (Gutachten NK2C2 Befund 2): Das Folgejahr beginnt mit dem echten Bestand nach dem Planjahr (bezahlte Verkaufssteuer, übrige Tranchen
    // mit Einstand), nicht mit dem Rest als steuerfreiem Bargeld.
    // NK-2d (Gutachten NK2C3 Befunde 4–6): mit bezahltem Flex des Planjahres, fortgeschriebenem Steuerzustand und den Anteilen am Grundbedarf
    // aus dem Bestand danach.
    const after = estimateCareAidNet({ persons: plan.list, basicFloor: planFloor, unmarried, carrierId: plan.carrierId, jointAssessment, withRemainder: true,
        flex: Math.max(0, Number(inputData.flexBedarf) || 0) });
    const next = build(true);
    for (const person of next.list) {
        Object.assign(person, after?.remainder?.get(person.profileId) || { cash: 0, lots: [], lossCarry: 0 });
        person.money = person.shareBasis = person.cash + person.lots.reduce((/** @type {number} */ sum, /** @type {any} */ lot) => sum + (Number(lot.marketValue) || 0), 0);
    }
    return estimateCareAidNet({ persons: next.list, basicFloor: (Number(need.total) || 0) - careTotal, unmarried, carrierId: next.carrierId, jointAssessment });
}


/** NK-2 (FR-84 Punkt 20, Nachtrag 17): Eigene Immobilie, die vor der Hilfe zur Pflege verkauft wird: vermietet, oder selbst genutzt, wenn
 * niemand mehr darin wohnt (alle Personen im Heim). Unlesbare Immobilienlisten gelten als keine.
 * @param {{profileId: string, data?: Record<string, string>}[]} entries @param {any} careNeeds @param {string} profileId @returns {boolean} */
export function saleableHome(entries, careNeeds, profileId) {
    let homes = [];
    try { homes = readImmobilien(entries.find(entry => entry.profileId === profileId)?.data?.[IMMOBILIEN_KEY]); } catch { homes = []; }
    const allInHome = (careNeeds?.persons || []).length > 0 && careNeeds.persons.every((/** @type {any} */ person) => (person.residentialCosts || 0) > 0);
    return homes.some(home => home.nutzung === 'vermietet' || (home.nutzung === 'selbst' && allInHome));
}
