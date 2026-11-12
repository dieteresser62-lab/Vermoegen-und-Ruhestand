/** @import {CareMeta,SimulatorInputs} from '../../typcheck/rechenkern' */
/** Reine Pflegebedarfsrechnung: keine Uhr, Zufallsziehung, Speicherung oder Zähleränderung. */
import { DEFAULT_CARE_VALUES, residentialComponents, residentialMonthly, residentialSubsidyRate } from './household-care-values.js';
import { careFormForPerson, careAllowanceAnnual, applyPartnerCareFallback } from './care-benefits.js';
/** Punkt 3: eigene Ausgaben im Heim, €/Monat je Person (G-V). */
export const RESIDENTIAL_OWN_EXPENSES_MONTHLY_DEFAULT = 500;
const RESIDENTIAL_STATE_KEYS = Object.freeze(['heimBestand', 'heimStartJahr', 'heimJahr', 'heimZuschuss',
    'heimKosten', 'heimEigeneAusgaben']);

/**
 * @param {Partial<SimulatorInputs>|null|undefined} inputs Wirksame Simulationseingaben.
 * @returns {number} Euro im Monat; ohne Eingabe gilt die Vorgabe.
 */
export function residentialOwnExpensesMonthly(inputs) {
    const value = Number(inputs?.pflegeHeimEigeneAusgaben);
    return inputs?.pflegeHeimEigeneAusgaben == null || !Number.isFinite(value)
        ? RESIDENTIAL_OWN_EXPENSES_MONTHLY_DEFAULT : Math.max(0, value);
}

/** Wie bei den Pflegewerten ergänzt erst ein abweichender Wert die Simulationseingaben.
 *
 * @param {unknown} value Gelesener Feldwert in €/Monat.
 * @returns {{pflegeHeimEigeneAusgaben?: number}} Eingabeergänzung.
 */
export function residentialOwnExpensesInputPatch(value) {
    const monthly = Number(value);
    if (value == null || value === '' || !Number.isFinite(monthly)) return {};
    const normalized = Math.max(0, monthly);
    return normalized === RESIDENTIAL_OWN_EXPENSES_MONTHLY_DEFAULT ? {} : { pflegeHeimEigeneAusgaben: normalized };
}

function clearResidentialCareState(care) {
    for (const key of RESIDENTIAL_STATE_KEYS) if (Object.hasOwn(care, key)) delete care[key];
}
/** Lebt die Person in diesem Jahr tatsächlich im Heim (neu oder als Bestand)?
 *
 * @param {CareMeta|null|undefined} care Pflege-Metadaten des Jahres.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function livesInResidentialCare(care) {
    return care?.active === true && (care.heimBestand === true || Number(care.heimJahr) > 0);
}

/** Heimpflege ersetzt den Grundbedarf; heimBestand bleibt ausschließlich für alte Replays lesbar.
 *
 * @param {CareMeta|null|undefined} care Pflege-Metadaten des Jahres.
 * @returns {boolean} Ergebnis der Prüfung.
 */
export function replacesHomeFloor(care) {
    return care?.active === true && care.heimBestand !== true && Number(care.heimJahr) > 0;
}


/** Punkte 2 und 3: Jahreskosten eines Heimjahrs. Kumulierte Inflation, Pflege-Kostenanstieg ab
 * Simulationsstart (t = yearIndex) und Regionalzuschlag wirken auf alle drei Bestandteile; die eigenen
 * Ausgaben folgen nur der Inflation.
 *
 * @param {CareMeta} care Pflege-Metadaten der Person (Grad).
 * @param {SimulatorInputs} inputs Wirksame Simulationseingaben.
 * @param {{inflationFactor: number; yearIndex: number; heimJahr: number}} options Preise und Heimjahr.
 * @returns {{subsidy: number; costs: number; ownExpenses: number}} Zuschussstufe und Jahresbeträge.
 */
export function residentialAnnualCosts(care, inputs, { inflationFactor, yearIndex, heimJahr }) {
    const careValues = /** @type {typeof DEFAULT_CARE_VALUES} */ (inputs.careValues ?? DEFAULT_CARE_VALUES);
    const components = residentialComponents(careValues.residential);
    const carePriceFactor = inflationFactor * Math.pow(1 + (Number(inputs.pflegeKostenDrift) || 0), yearIndex);
    const regionalMultiplier = 1 + Math.max(0, Number(inputs.pflegeRegionalZuschlag) || 0);
    const grade = Number(care.grade) || 2;
    return {
        subsidy: residentialSubsidyRate(heimJahr, { grade }),
        costs: residentialMonthly(components, heimJahr, { grade }) * 12 * carePriceFactor * regionalMultiplier,
        ownExpenses: residentialOwnExpensesMonthly(inputs) * 12 * inflationFactor
    };
}


/** Heimkosten und eigene Ausgaben je Person; Verstorbene zählen im Todesjahr halb, danach nicht.
 *
 * @param {{p1Alive?: boolean; p2Alive?: boolean; care?: {p1?: CareMeta|null; p2?: CareMeta|null}}} household Haushalt mit dem Pflegezustand des Jahres.
 * @param {boolean} deathThisYear Todesjahr nach FR-23.
 * @returns {{costs: number; ownExpenses: number; persons: {person: 'p1'|'p2'; weight: number; heimJahr: number; subsidy: number; costs: number; ownExpenses: number}[]}} Summen und Einzelposten.
 */
export function residentialNeedForYear(household, deathThisYear) {
    /** @type {{person: 'p1'|'p2'; weight: number; heimJahr: number; subsidy: number; costs: number; ownExpenses: number}[]} */
    const persons = [];
    for (const key of /** @type {const} */ (['p1', 'p2'])) {
        const care = household?.care?.[key];
        if (!replacesHomeFloor(care)) continue;
        const weight = household[key === 'p1' ? 'p1Alive' : 'p2Alive'] !== false ? 1 : deathThisYear ? .5 : 0;
        persons.push({ person: key, weight, heimJahr: Number(care?.heimJahr), subsidy: Number(care?.heimZuschuss) || 0,
            costs: (Number(care?.heimKosten) || 0) * weight, ownExpenses: (Number(care?.heimEigeneAusgaben) || 0) * weight });
    }
    return { costs: persons.reduce((sum, row) => sum + row.costs, 0),
        ownExpenses: persons.reduce((sum, row) => sum + row.ownExpenses, 0), persons };
}


/** Punkte 15/17: Sicheres akutes Heimende im Folgejahr, ohne Ziehung oder Änderung des Originals.
 * Alle übrigen Zustände behalten die bisherige Vorschau; heutige Pflege endet nicht durch die Akutdauer.
 *
 * @param {CareMeta|null|undefined} care Pflegezustand des laufenden Jahres.
 * @param {SimulatorInputs} inputs Wirksame Simulationseingaben.
 * @returns {CareMeta|null|undefined} Zustand für die Folgejahresvorschau.
 */
export function nextYearCareState(care, inputs) {
    if (!livesInResidentialCare(care) || care?.initialGrade || inputs.pflegeModellTyp !== 'akut'
        || !(care.currentYearInCare >= care.durationYears)) return care;
    const next = { ...care, active: false, grade: null, gradeLabel: '', zusatzFloorDelta: 0 };
    clearResidentialCareState(next);
    delete next.careForm;
    return next;
}

/** Punkt 17: Heimposten des Folgejahrs für das Liquiditätsziel, mit nächster Zuschussstufe und
 * Folgejahrespreisen. Liest nur; Heimzähler und Zufallszustände bleiben unberührt.
 *
 * @param {{p1?: CareMeta|null; p2?: CareMeta|null}} care Pflegezustand der Lebenden.
 * @param {SimulatorInputs} inputs Wirksame Simulationseingaben.
 * @param {number} inflationFactor Kumulierte Inflation zu Beginn des Folgejahrs.
 * @param {number} nextYearIndex Index des Folgejahrs.
 * @returns {number} Euro im Folgejahr.
 */
export function nextYearResidentialNeed(care, inputs, inflationFactor, nextYearIndex) {
    let total = 0;
    for (const current of [care.p1, care.p2]) {
        const meta = nextYearCareState(current, inputs);
        if (!replacesHomeFloor(meta)) continue;
        const prices = residentialAnnualCosts(/** @type {CareMeta} */ (meta), inputs,
            { inflationFactor, yearIndex: nextYearIndex, heimJahr: Number(meta?.heimJahr) + 1 });
        total += prices.costs + prices.ownExpenses;
    }
    return total;
}

/** Persönliche Heimposten einer Person (Heimkosten und eigene Ausgaben), etwa für FR-48 und Kennzahlen.
 *
 * @param {CareMeta|null|undefined} care Pflege-Metadaten des Jahres.
 * @returns {number} Euro im Jahr.
 */
export function residentialSpending(care) {
    return replacesHomeFloor(care) ? (Number(care?.heimKosten) || 0) + (Number(care?.heimEigeneAusgaben) || 0) : 0;
}

/**
 * Computes the effective household flex factor by splitting the flex budget across
 * all living persons and only cutting the portion that belongs to the person in care.
 *
 * @param {object} options
 * @param options.hasPartner
 * @param options.p1Alive
 * @param options.careMetaP1
 * @param options.p2Alive
 * @param options.careMetaP2
 * @returns {number} Ergebnis der Operation.
 */
export function computeHouseholdFlexFactor({
    hasPartner,
    p1Alive,
    careMetaP1,
    p2Alive,
    careMetaP2
}) {
    const f1 = p1Alive ? resolveIndividualFlexFactor(careMetaP1) : 0.0;

    if (hasPartner !== true) {
        return f1;
    }

    const f2 = p2Alive ? resolveIndividualFlexFactor(careMetaP2) : 0.0;
    const householdFactor = (0.5 * Math.max(f1, f2)) + (0.25 * f1) + (0.25 * f2);
    return householdFactor;
}

function resolveIndividualFlexFactor(careMeta) {
    if (!careMeta || !careMeta.active) {
        return 1.0;
    }
    const rawFactor = careMeta.flexFactor;
    if (typeof rawFactor !== 'number' || !Number.isFinite(rawFactor)) {
        return 1.0;
    }
    return Math.min(1, Math.max(0, rawFactor));
}


/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns {number} Ergebnis der Operation.
 */
export function survivorFloorPercent(value) {
    if (value == null) return 75;
    const percent = Number(value);
    if (value === '' || !Number.isFinite(percent) || percent < 40 || percent > 200) {
        throw new RangeError('Grundbedarf nach dem Tod einer Person muss zwischen 40 und 200 % liegen.');
    }
    return percent;
}

/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @param {string} [label]
 * @returns {number} Ergebnis der Operation.
 */
export function survivorFlexPercent(value, label = 'Wunsch-Flex') {
    if (value == null) return 50;
    const percent = Number(value);
    if (value === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new RangeError(`${label} nach dem Tod einer Person muss zwischen 0 und 100 % liegen.`);
    }
    return percent;
}

/** FR-55: getrennte Paarbezüge, Pflege zusätzlich; FR-23 mittelt das Todesjahr.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param deathThisYear
 * @returns Ergebnis der Operation.
 */
export function resolveSurvivorFlexFactors(inputs, household, deathThisYear) {
    if (!inputs.partner?.aktiv || household.p1Alive === household.p2Alive) return null;
    const { p1Alive, p2Alive, care } = household;
    const careFactor = /** @type {(context: Omit<Parameters<typeof computeHouseholdFlexFactor>[0], "p2Alive" | "careMetaP2"> & {p2Alive?: boolean; careMetaP2?: CareMeta}) => number} */ (computeHouseholdFlexFactor)({ hasPartner: false, p1Alive: true,
        careMetaP1: p1Alive ? care?.p1 : care?.p2 });
    const coupleFactor = deathThisYear ? computeHouseholdFlexFactor({ hasPartner: true,
        p1Alive: true, p2Alive: true, careMetaP1: care?.p1, careMetaP2: care?.p2 }) : 0;
    const annualFactor = percent => deathThisYear
        ? (coupleFactor + percent / 100 * careFactor) / 2 : percent / 100 * careFactor;
    return {
        flexFactor: annualFactor(survivorFlexPercent(inputs.survivorFlexPercent)),
        minimumFlexFactor: annualFactor(survivorFlexPercent(inputs.survivorMinimumFlexPercent, 'Mindest-Flex'))
    };
}

/** Gemeinsamer Grundbedarfsfaktor für Jahresrechnung und Pflegedeckel.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param deathThisYear
 * @returns {number} Ergebnis der Operation.
 */
export function resolveSurvivorFloorFactor(inputs, household, deathThisYear) {
    if (!inputs.partner?.aktiv || household.p1Alive === household.p2Alive) return 1;
    const percent = survivorFloorPercent(inputs.survivorFloorPercent) / 100;
    return deathThisYear ? (1 + percent) / 2 : percent;
}

/** Anteil des Grundbedarfs, der zu Hause bleibt. Heute und künftig im Heim lebende Personen
 * fallen heraus; nur alte Replays mit heimBestand behalten die frühere Rechnung. Paar: zwei zu Hause 1,
 * einer der Hinterbliebenenanteil, keiner 0; allein: 1 oder 0. Im Todesjahr zählen der Zustand vor
 * und nach dem Tod je halb. Ohne Heim gilt unverändert {@link resolveSurvivorFloorFactor}.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param {{p1Alive?: boolean; p2Alive?: boolean; care?: {p1?: CareMeta|null; p2?: CareMeta|null}}} household Haushalt mit dem Pflegezustand des Jahres, Verstorbene im Todesjahr vor dem Tod.
 * @param {boolean} deathThisYear
 * @returns {number} Ergebnis der Operation.
 */
export function resolveHomeFloorFactor(inputs, household, deathThisYear) {
    const couple = inputs.partner?.aktiv === true;
    const people = [{ alive: household.p1Alive !== false, care: household.care?.p1 },
        ...(couple ? [{ alive: household.p2Alive !== false, care: household.care?.p2 }] : [])];
    if (!people.some(person => replacesHomeFloor(person.care))) return resolveSurvivorFloorFactor(inputs, household, deathThisYear);
    const percent = couple ? survivorFloorPercent(inputs.survivorFloorPercent) / 100 : 1;
    const factor = atHome => atHome >= people.length ? 1 : atHome === 1 ? percent : 0;
    const after = factor(people.filter(person => person.alive && !replacesHomeFloor(person.care)).length);
    if (!deathThisYear) return after;
    return (factor(people.filter(person => !replacesHomeFloor(person.care)).length) + after) / 2;
}


/** FR-72 Punkt 0: Jahresbedarf aus getrennten Bestandteilen, erst danach addiert. Budget, Ruinprüfung,
 * beide Notverkaufsprüfungen und Protokoll verwenden diese Summe; die Miete nach FR-62 kommt beim
 * Aufrufer hinzu. Ohne Heim ergibt sich exakt der bisherige Wert.
 *
 * @param {object} options
 * @param options.inputs Wirksame Simulationseingaben.
 * @param {number} options.baseFloor Ursprünglicher Grundbedarf des Jahres (inflationiert).
 * @param {{p1Alive?: boolean; p2Alive?: boolean; care?: {p1?: CareMeta|null; p2?: CareMeta|null}}} options.household Haushalt mit dem Pflegezustand des Jahres.
 * @param {boolean} options.deathThisYear Todesjahr nach FR-23.
 * @param {number} options.careFloorAddition Pflegezusatz zu Hause, Verstorbene bereits halb.
 * @returns Bestandteile und Summe.
 */
export function composeYearNeed({ inputs, baseFloor, household, deathThisYear, careFloorAddition }) {
    const homeFloorFactor = resolveHomeFloorFactor(inputs, household, deathThisYear);
    const residential = residentialNeedForYear(household, deathThisYear);
    const homeFloor = baseFloor * homeFloorFactor;
    return { homeFloorFactor, homeFloor, homeCareAddition: careFloorAddition,
        residentialCosts: residential.costs, residentialOwnExpenses: residential.ownExpenses,
        residentialPersons: residential.persons,
        total: homeFloor + careFloorAddition + residential.costs + residential.ownExpenses };
}

/** Rechnungstag nach P7 für Balance und Simulator (Gutachten FR73F, PFA-7): „seit“ zählt ab dem echten Tagesdatum,
 * der Anker ohne „seit“ nach dem Planjahr. Nach einem frühen Jahresabschluss (ab 1.12.) liegt das Planjahr über
 * dem Kalenderjahr; das Datum wird dafür nicht verschoben.
 *
 * @param {string} today Echtes Tagesdatum (heute bzw. Testdatum), JJJJ-MM-TT.
 * @param {number|null} [referenceYear] Planjahr; ohne Angabe das Jahr des Tagesdatums.
 * @returns {{careReferenceDate: string, careReferenceYear: number}} Stichtag für „seit“ und Bezugsjahr für den Anker.
 */
export function careReference(today, referenceYear = null) {
    const year = Number(String(today).slice(0, 4));
    return { careReferenceDate: today, careReferenceYear: Math.max(year, Number(referenceYear) || year) };
}

/** P7: Kalendermonate seit Heimeintritt bis zum echten Stichtag, unabhängig vom historischen Marktjahr. Der Stichtag
 * ist Pflicht, sobald ein „seit“ gerechnet wird (Gutachten PFA-1, Befund 6). Ohne „seit“ gilt Heimjahr 1; hat der
 * Jahresabschluss diesen vorsichtigen Ansatz mit dem Planjahr verankert (`firstYear`), zählt das Heimjahr nach dem
 * Planjahr weiter: Planjahr − Anker + 1 (Gutachten PFA-2, Befund 1). `referenceYear` ist das Planjahr aus
 * {@link careReference}; alte Eingaben ohne Planjahr zählen ab dem Jahr des Stichtags. */
export function initialResidentialYear(since, referenceDate, firstYear = null, referenceYear = null) {
    if (since == null || since === '') {
        if (firstYear == null || firstYear === '') return 1;
        if (!/^\d{4}$/.test(String(firstYear)) || Number(firstYear) < 1900) throw new RangeError('Heimjahr-Anker: gültiges Jahr erwartet.');
        if (!/^\d{4}-\d{2}/.test(String(referenceDate ?? ''))) throw new RangeError('Stichtag fehlt.');
        const year = Number(referenceYear) || Number(String(referenceDate).slice(0, 4));
        return Math.max(1, year - Number(firstYear) + 1);
    }
    if (typeof since !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(since) || since.slice(0, 4) === '0000') {
        throw new RangeError('Im Heim seit: gültigen Monat und Jahr wählen.');
    }
    const date = referenceDate == null ? '' : String(referenceDate).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) throw new RangeError('Stichtag fehlt.');
    if (since > date) throw new RangeError('Im Heim seit darf nicht nach dem Stichtag liegen.');
    const [year, month] = since.split('-').map(Number), [nowYear, nowMonth] = date.split('-').map(Number);
    return Math.floor((12 * (nowYear - year) + nowMonth - month) / 12) + 1;
}

/** Staffel und Deckel zu wirksamen Preisen. Die Rampe entfällt nur im heutigen Grad; nach einem späteren
 * Gradanstieg gilt sie wie bei jedem Eintritt (Gutachten PFA-1, Befund 5). FR-73 Punkt 13: Ein eigener Wert
 * „Pflegekosten heute über die Kasse hinaus“ (`initialHomeCostsMonthly`, €/Monat) ersetzt im heutigen Grad
 * den Staffelbetrag, auch mit 0 €; er folgt Inflation und Kostenanstieg, nicht dem Regionalzuschlag. */
export function homeCareAnnualCosts(care, inputs, { baseFloor, inflationFactor = 1, yearIndex = 0,
    floorFactor = 1, gradeConfig = inputs.pflegeGradeConfigs?.[care?.grade] || {} }) {
    const price = inflationFactor * Math.pow(1 + (inputs.pflegeKostenDrift || 0), yearIndex);
    const anchor = baseFloor * floorFactor;
    const maximum = inputs.pflegeMaxFloor * price;
    const cap = Math.max(0, maximum - anchor);
    const withoutStaffel = care?.heimBestand === true || care?.heimJahr > 0
        || (inputs.pflegeKostenStaffelPreset === 'amtlich' && (care?.initialGrade || Number.isFinite(care?.heimZufall)));
    const todayGrade = care?.initialGrade > 0 && care.grade === care.initialGrade;
    const ownValue = todayGrade && Number.isFinite(care.initialHomeCostsMonthly) ? Math.max(0, care.initialHomeCostsMonthly) * 12 : null;
    const raw = withoutStaffel ? 0 : ownValue !== null ? ownValue * price
        : (gradeConfig.zusatz || 0) * price * (1 + Math.max(0, inputs.pflegeRegionalZuschlag || 0));
    const ramp = !todayGrade && raw > cap && cap > 0
        ? Math.min(1, care.currentYearInCare / Math.max(1, inputs.pflegeRampUp)) : 1;
    return { homeCareAddition: Math.min(cap, raw * ramp), floorAnchor: anchor, maximum, cap,
        flexFactor: care?.heimBestand === true ? care.flexFactor ?? 1 : gradeConfig.flexCut ?? 1 };
}

/** Laufendes Jahr und volle Folgejahresvorschau aus demselben Zustand. Preise sind wirksame Eingaben,
 * keine gespeicherten Altwerte. `priced` übernimmt im laufenden Jahr aufgezeichnete Preise für Replay.
 * Personenmetadaten werden kopiert; weder Originalzustand noch Zufallsströme werden verändert.
 * Der Aufrufer friert referenceDate am Simulationsbeginn ein. */
export function calculateCareNeeds({ inputs, household, referenceDate, yearIndex = 0, inflationFactor = 1,
    nextInflationFactor = inflationFactor, baseFloor = inputs.startFloorBedarf * inflationFactor,
    deathThisYear = false, priced = false, careFloorAddition = /** @type {number|null} */ (null) }) {
    const calculate = (next) => {
        const factor = next ? nextInflationFactor : inflationFactor;
        const index = yearIndex + (next ? 1 : 0);
        const h = { ...household, care: Object.fromEntries(['p1', 'p2'].map(key => {
            const current = household.care?.[key];
            const alive = household[key === 'p1' ? 'p1Alive' : 'p2Alive'] !== false;
            const meta = next ? (alive ? nextYearCareState(current, inputs) : null) : current;
            return [key, meta ? { ...meta, ...(next ? { currentYearInCare: meta.currentYearInCare + 1 } : {}) } : null];
        })) };
        applyPartnerCareFallback(inputs, h);
        const floor = next ? baseFloor * factor / inflationFactor : baseFloor;
        const death = !next && deathThisYear;
        const persons = ['p1', ...(inputs.partner?.aktiv ? ['p2'] : [])].map((key, personIndex) => {
            const meta = h.care[key];
            const alive = h[key === 'p1' ? 'p1Alive' : 'p2Alive'] !== false;
            const weight = alive ? 1 : death ? .5 : 0;
            const form = meta?.active ? careFormForPerson(inputs, meta.grade, personIndex, h) : null;
            if (meta?.active && meta.heimBestand !== true && (!priced || (next && (meta.zusatzFloorZiel != null || meta.heimJahr > 0)
                && !(form === 'residential' && !meta.heimJahr && !meta.initialGrade)))) {
                const today = personIndex === 0 ? inputs.careToday : inputs.partner?.careToday;
                const known = meta.initialGrade > 0;
                const residential = form === 'residential' && (!priced || meta.heimJahr > 0 || known) && (inputs.pflegeKostenStaffelPreset !== 'amtlich'
                    || known || Number.isFinite(meta.heimZufall));
                if (residential && meta.heimBestand !== true) {
                    meta.heimJahr = meta.heimJahr > 0 ? meta.heimJahr + (next ? 1 : 0)
                        : known ? initialResidentialYear(today?.residentialSince, referenceDate, today?.residentialFirstYear, inputs.careReferenceYear) + index : 1;
                    const prices = residentialAnnualCosts(meta, inputs, { inflationFactor: factor, yearIndex: index, heimJahr: meta.heimJahr });
                    Object.assign(meta, { heimKosten: prices.costs, heimEigeneAusgaben: prices.ownExpenses, heimZuschuss: prices.subsidy });
                }
                const costs = homeCareAnnualCosts(meta, inputs, { baseFloor: floor, inflationFactor: factor, yearIndex: index,
                    floorFactor: resolveSurvivorFloorFactor(inputs, h, death) });
                Object.assign(meta, { zusatzFloorZiel: costs.homeCareAddition, flexFactor: costs.flexFactor });
            }
            return { person: key, form, weight, homeCareAddition: (meta?.active ? meta.zusatzFloorZiel || 0 : 0) * weight,
                residentialCosts: replacesHomeFloor(meta) ? (meta.heimKosten || 0) * weight : 0,
                residentialOwnExpenses: replacesHomeFloor(meta) ? (meta.heimEigeneAusgaben || 0) * weight : 0,
                careAllowance: meta?.active ? careAllowanceAnnual({ grade: meta.grade, careForm: form,
                    preset: inputs.pflegeKostenStaffelPreset, careValues: inputs.careValues, inflationFactor: factor, lifeFactor: weight }) : 0,
                heimJahr: meta?.heimJahr || 0, subsidy: meta?.heimZuschuss || 0 };
        });
        const need = composeYearNeed({ inputs, baseFloor: floor, household: h, deathThisYear: death,
            careFloorAddition: !next && priced && careFloorAddition != null ? careFloorAddition
                : persons.reduce((sum, p) => sum + p.homeCareAddition, 0) });
        const flex = resolveSurvivorFlexFactors(inputs, h, death) || { flexFactor: computeHouseholdFlexFactor({
            hasPartner: inputs.partner?.aktiv === true, p1Alive: h.p1Alive !== false, p2Alive: h.p2Alive !== false,
            careMetaP1: h.care.p1, careMetaP2: h.care.p2 }) };
        const home = persons.filter(p => p.weight > 0 && !replacesHomeFloor(h.care[p.person]));
        return { ...need, ...flex, minimumFlexFactor: 'minimumFlexFactor' in flex ? flex.minimumFlexFactor : flex.flexFactor,
            careAllowance: persons.reduce((sum, p) => sum + p.careAllowance, 0),
            persons: persons.map(p => ({ ...p, homeFloor: home.includes(p) ? need.homeFloor * p.weight / home.reduce((sum, row) => sum + row.weight, 0) : 0 })) };
    };
    return { current: calculate(false), next: calculate(true) };
}

