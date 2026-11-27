/** @import * as P from "../../typcheck/profile-ui.js" */
import { inheritanceNetProceeds, HOME_SALE_NET_SHARE } from './household-inheritance-sale.js';
import { lifetimeUseMultiplier } from '../shared/life-expectancy.js';

export const PARTNERSHIP_KEY = 'household_partnership_v1';
export const MISSING_BEQUEST_RENT = 'Bitte die monatliche Miete für die überlebende Person eintragen.';
export const MISSING_SURVIVOR_RENT = 'Bitte die monatliche Miete der überlebenden Person eintragen.';
export const MISSING_HOUSING_CAPITAL = 'Bitte das Wohnkapital mit 1 bis 100 Prozent vom Nettoerlös eintragen.';
export const INVALID_MOVE_OUT_YEARS = 'Auszug: Bitte eine ganze Zahl von 0 bis 10 Jahren eingeben.';
/** Erbschaftsteuer, vereinfacht: persönliche Freibeträge (§ 16 ErbStG) je Steuerklasse in Euro, Steuerklasse I bei Ehe oder
 * eingetragener Partnerschaft. Einzige Stelle für Freibeträge und Tarife; Rechnung, Simulatorprotokoll und Vermögensbereich
 * lesen sie von hier. Bei fehlendem Status gilt steuerlich Klasse III. */
export const INHERITANCE_ALLOWANCES = Object.freeze({ classI: 500000, classIII: 20000 });
export const MISSING_PARTNERSHIP_STATUS = 'Partnerschaftsstatus fehlt';
/** Tarifstufen (§ 19 ErbStG) als [Obergrenze des steuerpflichtigen Erwerbs in Euro, Satz]; die letzte Stufe ist unbegrenzt. */
export const INHERITANCE_TARIFFS = Object.freeze({
    classI: Object.freeze([[75000, .07], [300000, .11], [600000, .15], [6000000, .19],
        [13000000, .23], [26000000, .27], [Infinity, .3]].map(tier => Object.freeze(tier))),
    classIII: Object.freeze([[6000000, .3], [Infinity, .5]].map(tier => Object.freeze(tier)))
});
/** Tarif der Steuerklasse III in Worten, etwa „Tarif 30 % bis 6 Mio. €, darüber 50 %“. */
export function inheritanceClassIIITariffText() {
    const [[limit, rate], [, topRate]] = INHERITANCE_TARIFFS.classIII;
    return `Tarif ${Math.round(rate * 100)} % bis ${limit / 1e6} Mio. €, darüber ${Math.round(topRate * 100)} %`;
}
export const inheritancePersonalAllowance = status => status === 'married' ? INHERITANCE_ALLOWANCES.classI : INHERITANCE_ALLOWANCES.classIII;
export const maritalPropertyRegime = partnership => partnership?.maritalPropertyRegime ?? 'community';
export const maritalPropertyLabel = partnership => maritalPropertyRegime(partnership) === 'separation'
    ? 'Gütertrennung' : 'Zugewinngemeinschaft (gesetzlich)';
/** § 17 Abs. 1 ErbStG: Versorgungsfreibetrag des überlebenden Ehe- oder Lebenspartners in Euro, vor der Kürzung. */
export const PENSION_ALLOWANCE = 256000;
const PENSION_ALLOWANCE_NOTE = 'Versorgungsfreibetrag (§ 17 ErbStG) gerechnet, vorsichtig gekürzt um die eingetragene Hinterbliebenenrente.';
/** HP-2: withPensionNote = false, wenn der Aufrufer den Versorgungsfreibetrag selbst mit Betrag nennt (Simulatorprotokoll). */
export const spouseTaxNote = (partnership, withPensionNote = true) => (maritalPropertyRegime(partnership) === 'separation'
    ? 'Kein Zugewinnausgleich (Gütertrennung).'
    : 'Zugewinnausgleich vereinfacht gerechnet (Zuwachs ab heute, um die Inflation bereinigt). Anfangsvermögen ist das Vermögen beim Planstart („Heirat = heute“); Ehejahre davor zählen nicht, daher kann die echte Steuer bei langer Ehe niedriger oder höher sein. Geplante Zuflüsse zählen zum Anfangsvermögen; ein steuerfreies Familienheim kürzt den Zugewinnabzug anteilig.')
    + (withPensionNote ? ` ${PENSION_ALLOWANCE_NOTE}` : '');
export const FAMILY_HOME_CONDITIONS = 'Gilt nur, wenn der Erbe selbst darin wohnt, grundsätzlich 10 Jahre lang (§ 13 Abs. 1 Nr. 4b ErbStG). Die App prüft das nicht.';

/**
 * @param raw Gespeicherter Rohwert.
 * @param {{forInheritance?: boolean}} [options] Die Erbvorschau belässt einen fehlenden Status offen.
 * @returns Geprüfte Partnerschaft mit den bestehenden Lesevorgaben.
 */
export function readPartnership(raw, { forInheritance = false } = {}) {
    if (raw == null || raw === '') return { schemaVersion: 1, status: forInheritance ? undefined : 'married', maritalPropertyRegime: 'community', inheritance: {} };
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || value.status !== undefined && !['married', 'unmarried'].includes(value.status)
        || !value.inheritance || typeof value.inheritance !== 'object' || Array.isArray(value.inheritance)) throw new Error('Partnerschaft: Die gespeicherten Angaben sind ungültig.');
    if (value.maritalPropertyRegime !== undefined && !['community', 'separation'].includes(value.maritalPropertyRegime)) throw new Error('Güterstand: Bitte Zugewinngemeinschaft oder Gütertrennung wählen.');
    for (const map of [value.inheritance, ...(value.marriedInheritance === undefined ? [] : [value.marriedInheritance])]) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Partnerschaft: Die gespeicherten Angaben sind ungültig.');
        for (const amount of Object.values(map)) if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error('Erbanteil: Bitte einen Wert von 0 bis 100 Prozent eingeben.');
    }
    if (value.homeAndTaxInheritance !== undefined && (!value.homeAndTaxInheritance || typeof value.homeAndTaxInheritance !== 'object'
        || Array.isArray(value.homeAndTaxInheritance) || Object.values(value.homeAndTaxInheritance).some(flag => typeof flag !== 'boolean'))) throw new Error('Immobilienerbe: Die gespeicherten Angaben sind ungültig.');
    if (value.activeInheritanceRule !== undefined && (!value.activeInheritanceRule || typeof value.activeInheritanceRule !== 'object'
        || Array.isArray(value.activeInheritanceRule) || Object.values(value.activeInheritanceRule).some(rule => !['testament', 'home-and-tax'].includes(rule)))) throw new Error('Erbregel: Die gespeicherte Auswahl ist ungültig.');
    if (value.testament !== undefined) {
        if (!value.testament || typeof value.testament !== 'object' || Array.isArray(value.testament)) throw new Error('Testament: Die gespeicherten Angaben sind ungültig.');
        for (const rule of Object.values(value.testament)) {
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('Testament: Die gespeicherten Angaben sind ungültig.');
            if (rule.minimum !== undefined && (typeof rule.minimum !== 'number' || !Number.isFinite(rule.minimum) || rule.minimum < 0
                || !/^\d{4}-(0[1-9]|1[0-2])$/.test(rule.minimumStand || ''))) throw new Error('Mindestbetrag: Bitte einen Betrag ab 0 und einen Stand MM/JJJJ eingeben.');
            if (rule.maximumPercent !== undefined && (typeof rule.maximumPercent !== 'number' || !Number.isFinite(rule.maximumPercent)
                || rule.maximumPercent < 0 || rule.maximumPercent > 100)) throw new Error('Höchstanteil: Bitte 0 bis 100 Prozent eingeben.');
            if (rule.estateCosts !== undefined && (typeof rule.estateCosts !== 'number' || !Number.isFinite(rule.estateCosts)
                || rule.estateCosts < 0)) throw new Error('Bestattungs- und Abwicklungskosten: Bitte einen Betrag ab 0 eingeben.');
            if (rule.childrenProtected !== undefined && typeof rule.childrenProtected !== 'boolean') throw new Error('Pflichtteilsberechtigte Kinder: Die gespeicherte Auswahl ist ungültig.');
            if (rule.home !== undefined && !['money', 'residence', 'life-estate', 'rent-bequest', 'housing-capital'].includes(rule.home)) throw new Error('Testament: Bitte die Immobilienregel wählen.');
            if (rule.home === 'rent-bequest' && !(Number.isFinite(rule.monthlyRent) && rule.monthlyRent > 0)) throw new Error(MISSING_BEQUEST_RENT);
            if (rule.home === 'housing-capital' && !(Number.isFinite(rule.housingCapitalPercent)
                && rule.housingCapitalPercent >= 1 && rule.housingCapitalPercent <= 100)) throw new Error(MISSING_HOUSING_CAPITAL);
            if (rule.home === 'housing-capital' && !(Number.isFinite(rule.monthlyRent) && rule.monthlyRent > 0)) throw new Error(MISSING_SURVIVOR_RENT);
            if (rule.moveOutYears !== undefined && (rule.home !== 'housing-capital' || !Number.isInteger(rule.moveOutYears)
                || rule.moveOutYears < 0 || rule.moveOutYears > 10)) throw new Error(INVALID_MOVE_OUT_YEARS);
            if (rule.residenceTax !== undefined && !['immediate', 'annual'].includes(rule.residenceTax)) throw new Error('Wohnrechtsteuer: Bitte sofort oder jährlich wählen.');
        }
    }
    const testament = Object.fromEntries(Object.entries(value.testament || {}).filter(([, rule]) =>
        containsTestament(rule) || rule.residenceTax !== undefined));
    const activeInheritanceRule = { ...value.activeInheritanceRule };
    // Vor AR-1 hatten Testamentangaben Vorrang. Nur eine ausdrücklich gespeicherte
    // neue Auswahl darf diese Angaben zugunsten von Immobilien + Steuer deaktivieren.
    for (const [id, enabled] of Object.entries(value.homeAndTaxInheritance || {})) {
        if (enabled && containsTestament(testament[id]) && !activeInheritanceRule[id]) activeInheritanceRule[id] = 'testament';
    }
    return { schemaVersion: 1, status: value.status, maritalPropertyRegime: maritalPropertyRegime(value), inheritance: { ...value.inheritance },
        ...(Object.keys(testament).length ? { testament: structuredClone(testament) } : {}),
        ...(Object.keys(activeInheritanceRule).length ? { activeInheritanceRule } : {}),
        ...(value.homeAndTaxInheritance === undefined ? {} : { homeAndTaxInheritance: { ...value.homeAndTaxInheritance } }),
        ...(value.marriedInheritance === undefined ? {} : { marriedInheritance: { ...value.marriedInheritance } }) };
}

/**
 * @param partnership Gespeicherte Partnerschaftsangaben.
 * @param profileId Kennung der betroffenen Person.
 * @returns Wirksamer Erbanteil in Prozent.
 */
export function inheritancePercent(partnership, profileId) {
    return partnership?.status === 'married' ? partnership.marriedInheritance?.[profileId] ?? 100
        : partnership?.inheritance?.[profileId] ?? (partnership?.status === 'unmarried' ? 0 : 100);
}

/** Nur die Vorrangzuordnung migrieren; der Güterstand bleibt eine Lesevorgabe. */
/**
 * @param raw Gespeicherter Rohwert.
 * @returns Unveränderter Rohrecord oder serialisierte Vorrangzuordnung.
 */
export function migratePartnershipRecord(raw) {
    const partnership = readPartnership(raw), previous = raw ? JSON.parse(raw) : {};
    return JSON.stringify(partnership.activeInheritanceRule) === JSON.stringify(previous.activeInheritanceRule)
        ? raw : JSON.stringify({ ...previous, activeInheritanceRule: partnership.activeInheritanceRule });
}

/** FR-51: vereinfachter § 5 Abs. 1, realer Zuwachs ab Planstart, vor Erbaufteilung. */
/**
 * @param partnership Gespeicherte Partnerschaftsangaben.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Steuerfreier Zugewinnausgleich in Euro.
 */
export function equalizationAllowance(partnership, { deceasedAssets = 0, survivorAssets = 0,
    deceasedInitialAssets = deceasedAssets, survivorInitialAssets = survivorAssets, inflationFactor = 1, acquisition = 0, exemptHome = 0 } = {}) {
    if (partnership?.status !== 'married' || maritalPropertyRegime(partnership) === 'separation') return 0;
    const deceasedGain = Math.max(0, deceasedAssets - deceasedInitialAssets * inflationFactor);
    const survivorGain = Math.max(0, survivorAssets - survivorInitialAssets * inflationFactor);
    const allowance = Math.min(Math.max(0, acquisition), Math.max(0, (deceasedGain - survivorGain) / 2));
    // § 5 Abs. 1 Satz 6 ErbStG: nur der Anteil ohne sachliche Befreiung ist frei.
    return exemptHome > 0 && deceasedAssets > 0
        ? allowance * Math.max(0, deceasedAssets - exemptHome) / deceasedAssets : allowance;
}

/** FR-51, Ergänzung 19.11.2026 (VB-1, vorsichtige Variante): Versorgungsfreibetrag nach § 17 ErbStG, nur bei Ehe, in jedem Güterstand.
 * Kapitalwert = Jahreswert der Hinterbliebenenrente × Vervielfältiger wie beim Wohnrecht (§ 14 BewG) + Summe des Sterbevierteljahrs
 * (R E 17 Abs. 3 ErbStR). Ohne Rente kein Tabellenaufruf; fehlt bei positiver Rente das Alter, gilt vorsichtig 0.
 * @param {string|undefined} status Partnerschaftsstatus.
 * @param {{annualPension?: number; lumpSum?: number; age?: number; gender?: string; valuationYear?: number}} [options] Jahreswert und Einmalbetrag in Euro, vollendetes Alter, Geschlecht und Stichtagsjahr.
 * @returns {{amount: number; capital: number; missingAge?: true}} Freibetrag und Kapitalwert in Euro.
 */
export function pensionAllowance(status, { annualPension = 0, lumpSum = 0, age, gender, valuationYear } = {}) {
    if (status !== 'married') return { amount: 0, capital: 0 };
    const annual = Math.max(0, Number(annualPension) || 0), once = Math.max(0, Number(lumpSum) || 0);
    if (annual > 0 && !(Number.isFinite(age) && age >= 0)) return { amount: 0, capital: 0, missingAge: true };
    const capital = (annual > 0 ? annual * lifetimeUseMultiplier(age, gender, valuationYear) : 0) + once;
    return { amount: Math.max(0, PENSION_ALLOWANCE - capital), capital };
}

export const testamentRule = (partnership, profileId) => partnership?.testament?.[profileId] || {};
export const moveOutDescription = years => `Auszug nach ${years} ${years === 1 ? 'Jahr' : 'Jahren'}`;
export const rentFreeThroughDescription = years => `Mietfrei bis Ende des ${years}. Jahres nach dem Todesjahr`;
export const HOUSING_CAPITAL_CANCELLED = 'Wohnkapital entfällt bei dauerhafter Heimpflege';
export const housingCapitalFromHome = (value, percent) => value * HOME_SALE_NET_SHARE * percent / 100;
export const inheritanceTaxableAfterAllowance = (acquisition, allowance) => Math.floor(Math.max(0, acquisition - allowance) / 100) * 100;

/** § 14 ErbStG: Gesamterwerb gemeinsam runden und die Steuer aus dem Todesjahr abziehen.
 * @param {number} amount Wohnkapital im Auszugsjahr.
 * @param {string|undefined} status Partnerschaftsstatus.
 * @param {P.HousingCapitalTaxBasis} basis Steuerdaten des Todesjahrs. */
export function housingCapitalTax(amount, status, { allowanceRemaining, priorTaxableUnrounded, priorTax }) {
    const combinedTaxable = inheritanceTaxableAfterAllowance(priorTaxableUnrounded + amount, allowanceRemaining);
    const priorTaxable = inheritanceTaxableAfterAllowance(priorTaxableUnrounded, 0);
    return { tax: inheritanceTariff(combinedTaxable, status).tax - priorTax, taxable: combinedTaxable - priorTaxable };
}

/** Beide Verkaufsoptionen betreffen den selbst genutzten Anteil der verstorbenen Person. */
export const hasTestamentHomeSale = rule => rule?.home === 'rent-bequest' || rule?.home === 'housing-capital';
export const hasInheritanceHomes = (homes, profileId) => homes?.some(home => (profileId === undefined || home.profileId === profileId) && home.wert > 0) === true;
const containsTestament = rule => Boolean(rule && (rule.minimum !== undefined || rule.maximumPercent !== undefined
    || rule.estateCosts > 0 || rule.childrenProtected || (rule.home && rule.home !== 'money')));
export const inheritsHomeAndTax = (partnership, profileId, hasHomes = true) => hasHomes && partnership?.status === 'unmarried'
    && partnership.homeAndTaxInheritance?.[profileId] === true
    && (partnership.activeInheritanceRule?.[profileId] === 'home-and-tax'
        || (!partnership.activeInheritanceRule?.[profileId] && !containsTestament(testamentRule(partnership, profileId))));
export const hasTestament = (partnership, profileId, hasHomes = true) => !inheritsHomeAndTax(partnership, profileId, hasHomes)
    && containsTestament(testamentRule(partnership, profileId));

/**
 * @param rule Gespeicherte Testamentregel.
 * @returns Beschreibung der gespeicherten Testamentregel.
 */
export function testamentDescription(rule) {
    const money = value => value.toLocaleString('de-DE', { maximumFractionDigits: 0 });
    return [rule.minimum !== undefined ? `mindestens ${money(rule.minimum)} € in Kaufkraft ${rule.minimumStand.slice(5)}/${rule.minimumStand.slice(0, 4)}, mit Inflation angepasst` : '',
        rule.maximumPercent !== undefined ? `höchstens ${rule.maximumPercent} %` : '',
        rule.home === 'rent-bequest' ? 'Verkauf, Miete auf Lebenszeit'
            : rule.home === 'housing-capital' ? `Verkauf mit Wohnkapital ${rule.housingCapitalPercent.toLocaleString('de-DE')} %, Miete ${money(rule.monthlyRent)} € im Monat`
            : rule.home === 'residence' ? `Wohnrecht auf Lebenszeit${rule.residenceTax === 'annual' ? ', Steuer jährlich (§ 23 ErbStG)' : ''}` : rule.home === 'life-estate' ? 'Eigentum auf Lebenszeit, danach an die Kinder' : 'Immobilien wie Geldvermögen'].filter(Boolean).join(' · ');
}

/** Derselbe Bruchteil überträgt Geld, Stücke und Einstandswerte. Der Höchstanteil hat Vorrang. */
/**
 * @param assets Geldvermögen in Euro.
 * @param percent Erbanteil in Prozent.
 * @param {P.TestamentRule} rule Gespeicherte Testamentregel.
 * @param minimumFactor Inflationsfaktor des testamentarischen Mindestbetrags.
 * @param inflationFactor Inflation seit Planstart für die Kosten.
 * @returns Übertragener Geldbetrag und zugehöriger Anteil.
 */
export function testamentMoney(assets, percent, rule = {}, minimumFactor = 1, inflationFactor = 1) {
    const estateCosts = deductibleEstateCosts(assets, rule, inflationFactor);
    const netAssets = assets - estateCosts;
    const inherited = Math.min(netAssets * (rule.maximumPercent ?? 100) / 100,
        Math.max(netAssets * percent / 100, (rule.minimum ?? 0) * minimumFactor));
    return { inherited, share: netAssets > 0 ? inherited / netAssets : Math.min(percent, rule.maximumPercent ?? 100) / 100,
        ...(estateCosts > 0 ? { estateCosts } : {}) };
}

/** @param {number} assets @param {P.TestamentRule} rule @param {number} [inflationFactor] */
export function deductibleEstateCosts(assets, rule, inflationFactor = 1) {
    return rule.estateCosts > 0 ? Math.min(Math.max(0, assets), rule.estateCosts * inflationFactor) : 0;
}

/** Jahreswert nur für die Wohnrechtsteuer; Ersatzmiete nach Notverkauf bleibt getrennt. */
/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @param monthlyRent Ortsübliche Monatsmiete in Euro.
 * @returns Jährlicher steuerlicher Wert des Wohnrechts.
 */
export function residenceAnnualValue(value, monthlyRent) {
    return Math.min(monthlyRent === undefined ? value * .04 : monthlyRent * 12, value / 18.6);
}

/** Freibetragsrest nach dem sofortigen Erwerb, auch bei jährlicher Zahlung nach § 23. */
function remainingInheritanceAllowance({ status, exemptHome, exemptGain, pensionAllowance }, taxMoney, home) {
    const allowance = status === 'married' ? inheritancePersonalAllowance(status) + exemptGain + pensionAllowance : inheritancePersonalAllowance(status);
    return Math.max(0, allowance + exemptHome - taxMoney - home);
}

/** @param {number} assets @param {number} homeValue @param {number} selfUsedHome @param {number} percent @param {P.TestamentRule} rule @param {P.EstateOptions} [options] @returns {P.Estate} */
export function testamentEstate(assets, homeValue, selfUsedHome, percent, rule, { minimumFactor = 1, partnerAge, partnerGender, valuationYear, status = 'unmarried', residenceValue, residenceEligible = true, housingCapitalEligible = true, familyHome = selfUsedHome, maritalPropertyRegime, gains, pensionAllowance = 0, inflationFactor = 1, estateDebt = 0 } = {}) {
    const money = testamentMoney(assets, percent, rule, minimumFactor, inflationFactor), mode = rule.home || 'money';
    const home = mode === 'residence' ? 0 : mode === 'life-estate' ? selfUsedHome
        : (hasTestamentHomeSale(rule) ? homeValue - selfUsedHome : homeValue) * money.share;
    // ER-2: Geldvermächtnis aus dem Nettoerlös des selbst genutzten Anteils; voller Betrag im Erwerb, ohne Kapitalwert und § 23.
    const delayed = mode === 'housing-capital' && rule.moveOutYears > 0;
    const housingCapital = mode === 'housing-capital' && selfUsedHome > 0 && housingCapitalEligible
        ? housingCapitalFromHome(selfUsedHome, rule.housingCapitalPercent) : 0;
    const rentBequestAnnual = mode === 'rent-bequest' && selfUsedHome > 0 ? rule.monthlyRent * 12 : 0;
    const annualValue = rentBequestAnnual > 0 ? rentBequestAnnual * inflationFactor
        : mode === 'residence' && residenceEligible && selfUsedHome > 0 ? residenceValue ?? residenceAnnualValue(selfUsedHome) : 0;
    const residenceCapital = annualValue > 0 ? annualValue * lifetimeUseMultiplier(partnerAge, partnerGender, valuationYear) : 0;
    const exemptHome = status === 'married' ? mode === 'life-estate' ? familyHome : mode === 'money' ? familyHome * money.share : 0 : 0;
    const estateValue = assets - (money.estateCosts || 0) + homeValue - estateDebt;
    // Die offene Steuer folgt dem übertragenen Anteil am ursprünglichen Geldvermögen.
    const grossShare = assets > 0 && money.estateCosts > 0 ? money.inherited / assets : money.share;
    const netMoney = estateDebt > 0 ? money.inherited - estateDebt * grossShare : money.inherited;
    // Für Gütertrennung fehlt die Kinderzahl. Auch hier gilt im Modell ein Viertel.
    const { childrenMoneyCut: netCut, childrenShortfall } = rule.childrenProtected && (estateDebt === 0 || estateValue > 0)
        ? protectChildren(estateValue, netMoney + home + residenceCapital + housingCapital, netMoney, status) : NO_CHILDREN_CUT;
    // Mit dem Geldanteil sinkt auch die übertragene Schuld. Die Kürzung für die Übertragung ist daher brutto.
    const childrenMoneyCut = estateDebt > 0 && netCut > 0 ? (netCut / netMoney) * money.inherited : netCut;
    const inherited = money.inherited - childrenMoneyCut;
    // Die Immobilie behält ihre Quote. Vom Bruttobestand gehen Kosten und Kürzung nur beim Geld ab.
    const share = assets > 0 && (money.estateCosts > 0 || childrenMoneyCut > 0) ? inherited / assets : money.share;
    const taxMoney = estateDebt > 0 ? Math.max(0, inherited - estateDebt * share) : inherited;
    const acquisition = taxMoney + home + residenceCapital + (delayed ? 0 : housingCapital);
    const exemptGain = equalizationAllowance({ status, maritalPropertyRegime }, {
        ...gains, acquisition: acquisition + (delayed ? housingCapital : 0), exemptHome });
    const deductions = { status, exemptHome, exemptGain, pensionAllowance };
    const taxableUnrounded = acquisition - inheritanceAllowance(deductions);
    const taxable = inheritanceTaxableAfterAllowance(taxableUnrounded, 0), tax = inheritanceTariff(taxable, status).tax;
    const details = { ...(exemptGain > 0 ? { exemptGain } : {}), ...(rentBequestAnnual > 0 ? { rentBequestAnnual } : {}),
        ...(housingCapital > 0 ? { housingCapital } : {}),
        ...(delayed && housingCapital > 0 ? { housingCapitalTaxBasis: { allowanceRemaining: Math.max(0, -taxableUnrounded),
            priorTaxableUnrounded: Math.max(0, taxableUnrounded), priorTax: tax } } : {}),
        ...(share !== money.share ? { homeShare: money.share } : {}),
        ...(childrenMoneyCut > 0 ? { childrenMoneyCut } : {}),
        ...(childrenShortfall > 0 ? { childrenShortfall } : {}) };
    if (residenceCapital > 0 && rule.residenceTax === 'annual') {
        // § 23: Der Versorgungsfreibetrag mindert wie der Zugewinnabzug Satz, Sofortsteuer und Freibetragsrest.
        // HP-4: Satz nach dem Gesamterwerb, Sofortsteuer auf den abgerundeten Geld- und Immobilienanteil; der Jahreswert bleibt ungerundet.
        // Beim Wohnrecht ist exemptHome stets 0; inheritanceTaxable rechnet hier wie die frühere Inline-Formel.
        const rate = inheritanceTariff(taxable, status).effectiveRate;
        const immediateTaxable = inheritanceTaxable(taxMoney + home, deductions);
        return { ...money, inherited, share, home, residenceCapital, exemptHome, tax: immediateTaxable * rate, taxable: immediateTaxable, mode, ...details,
            residenceTax: { annualValue, rate, annualTax: annualValue * rate,
                allowanceRemaining: remainingInheritanceAllowance(deductions, taxMoney, home), immediateComparison: tax } };
    }
    return { ...money, inherited, share, home, residenceCapital, exemptHome, tax, taxable, mode, ...details };
}

const NO_CHILDREN_CUT = { childrenMoneyCut: 0, childrenShortfall: 0 };
function protectChildren(estateValue, acquisition, money, status) {
    const gap = Math.max(0, estateValue * (status === 'married' ? .25 : .5) - (estateValue - acquisition));
    const childrenMoneyCut = Math.min(Math.max(0, money), gap);
    return { childrenMoneyCut, childrenShortfall: gap - childrenMoneyCut };
}

/** FR-54/96: Steuergeld zuerst, Prozentsatz nur vom übrigen Geldvermögen. */
/**
 * @param assets Geldvermögen nach Abwicklungskosten in Euro.
 * @param home Eigener Immobilienanteil in Euro.
 * @param percent Erbanteil in Prozent.
 * @param netProceeds Funktion für den Nettoerlös einer Geldveräußerung.
 * @param {boolean} [childrenProtected] Den Zusatzanteil bei Bedarf für den Pflichtteil kürzen.
 * @returns Erbaufteilung einschließlich der Finanzierung der Steuer.
 */
export function homeAndTaxEstate(assets, home, percent, netProceeds = amount => amount, childrenProtected = false) {
    const share = percent / 100;
    const split = cash => {
        const extra = (assets - cash) * share;
        const protection = childrenProtected ? protectChildren(assets + home, home + cash + extra, extra, 'unmarried') : NO_CHILDREN_CUT;
        return { extra, ...protection };
    };
    const taxFor = cash => {
        const { extra, childrenMoneyCut } = split(cash);
        return inheritanceTax(home + cash + extra - childrenMoneyCut);
    };
    let low = 0, high = Math.max(0, assets);
    // Bei zu kleinem Nachlass bleibt die ungedeckte Steuer sichtbar.
    if (taxFor(high) <= netProceeds(high)) {
        for (let i = 0; i < 80 && high - low > 1e-7; i++) {
            const mid = (low + high) / 2;
            if (taxFor(mid) > netProceeds(mid)) low = mid; else high = mid;
        }
    }
    const taxCash = high, { extra, childrenMoneyCut, childrenShortfall } = split(taxCash);
    const inherited = taxCash + extra - childrenMoneyCut, taxable = inheritanceTaxable(home + inherited, { status: 'unmarried' });
    return { taxCash, inherited, tax: inheritanceTariff(taxable, 'unmarried').tax, taxable, home,
        ...(childrenMoneyCut > 0 ? { childrenMoneyCut } : {}),
        ...(childrenShortfall > 0 ? { childrenShortfall } : {}),
        taxCashSaleTax: Math.max(0, taxCash - netProceeds(taxCash)) };
}

const { classI, classIII } = INHERITANCE_TARIFFS;
/**
 * @param taxable Steuerpflichtiger Erwerb in Euro.
 * @param status Partnerschaftsstatus.
 * @returns Wirksamer Erbschaftsteuersatz.
 */
export function inheritanceTaxRate(taxable, status) {
    if (!Number.isFinite(taxable)) {
        console.warn('[Inheritance] Ungültiger steuerpflichtiger Erwerb (nicht endlich); Steuersatz 0.');
        return 0;
    }
    return taxable <= 0 ? 0 : (status === 'married' ? classI : classIII).find(([limit]) => taxable <= limit)[1];
}
/** FR-51: § 19 Abs. 1 und 3 ErbStG mit Familienheim, zusätzlichem Zugewinnabzug und Versorgungsfreibetrag (§ 17). */
/**
 * @param estate Steuerlich zu bewertender Erwerb in Euro.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Erbschaftsteuer in Euro.
 */
export function inheritanceTax(estate, { status = 'unmarried', exemptHome = 0, exemptGain = 0, pensionAllowance = 0 } = {}) {
    const taxable = inheritanceTaxable(estate, { status, exemptHome, exemptGain, pensionAllowance });
    return inheritanceTariff(taxable, status).tax;
}

/** Steuerpflichtiger Erwerb; Familienheim, Zugewinnabzug und Versorgungsfreibetrag nur bei Ehe.
 * HP-4: Nach allen Abzügen auf volle 100 € abgerundet (§ 10 Abs. 1 Satz 6 ErbStG); die einzige Rundungsstelle für Simulator, Vorschau und Protokoll.
 * @param {number} estate Steuerlich zu bewertender Erwerb in Euro.
 * @param {{status?: string; exemptHome?: number; exemptGain?: number; pensionAllowance?: number}} options Abzüge in Euro.
 * @returns {number} Steuerpflichtiger Erwerb in Euro.
 */
export function inheritanceTaxable(estate, { status, exemptHome = 0, exemptGain = 0, pensionAllowance = 0 }) {
    return inheritanceTaxableAfterAllowance(estate, inheritanceAllowance({ status, exemptHome, exemptGain, pensionAllowance }));
}

function inheritanceAllowance({ status, exemptHome, exemptGain, pensionAllowance }) {
    return status === 'married' ? exemptHome + inheritancePersonalAllowance(status) + exemptGain + pensionAllowance : inheritancePersonalAllowance(status);
}

/** § 19 einschließlich Härteausgleich, auch für den festgehaltenen Satz nach § 23.
 * https://erbsth.bundesfinanzministerium.de/erbsth/2020/A-ErbStG-ErbStDV-BewG/ErbStG/III-Berechnung-der-Steuer/Paragraf-19/paragraf-19.html (H E 19)
 */
/**
 * @param taxable Steuerpflichtiger Erwerb in Euro.
 * @param status Partnerschaftsstatus.
 * @returns Steuerbetrag und wirksamer Steuersatz.
 */
export function inheritanceTariff(taxable, status) {
    const tiers = status === 'married' ? classI : classIII, index = tiers.findIndex(([limit]) => taxable <= limit);
    const tax = taxable * tiers[index][1];
    const [previousLimit, previousRate] = tiers[index - 1] || [0, 0];
    const relievedTax = !index ? tax : Math.min(tax, previousLimit * previousRate + (taxable - previousLimit) * (tiers[index][1] <= .3 ? .5 : .75));
    return { tax: relievedTax, effectiveRate: taxable <= 0 ? 0 : relievedTax < tax ? relievedTax / taxable : tiers[index][1] };
}

/** FR-48: Vorschau zu heutigen Werten mit demselben Tarif wie im Simulator. */
/** @param {number} assets @param {number} homeValue @param {number} percent @param {P.PreviewOptions} [options]
 * @returns Anzeigeprojektion der Erbaufteilung und verbleibender Beträge.
 */
export function inheritancePreview(assets, homeValue, percent, { status = 'unmarried', maritalPropertyRegime, exemptHome = 0, selfUsedHome = exemptHome, homeAndTax = false,
    cash = 0, tranches, kirchensteuerSatz = 0, sparerPauschbetrag = 0, taxStatePrev, testament, minimumFactor = 1, partnerAge, partnerGender, valuationYear, residenceValue, residenceEligible = true, familyHome = selfUsedHome,
    gains = { deceasedAssets: assets + homeValue, deceasedInitialAssets: assets + homeValue }, housingCapitalEligible = true } = {}) {
    if (testament && !(status === 'unmarried' && homeAndTax && homeValue > 0)) {
        const estate = testamentEstate(assets, homeValue, selfUsedHome, percent, testament, { status, maritalPropertyRegime, minimumFactor, partnerAge, partnerGender, valuationYear, residenceValue, residenceEligible, familyHome,
            gains, housingCapitalEligible });
        // HP-4b: steuerpflichtiger Erwerb wie im Nachlasslog; bei § 23 die Sofortbasis, der Satz kommt dann aus residenceTax.
        // ER-2: Das Wohnkapital ist Geld im Haushalt und trägt die Steuer mit.
        const deferred = estate.housingCapitalTaxBasis !== undefined;
        const cash = !deferred && estate.housingCapital > 0 ? estate.inherited + estate.housingCapital : estate.inherited;
        const moveOutTax = deferred ? housingCapitalTax(estate.housingCapital, status, estate.housingCapitalTaxBasis).tax : 0;
        return { ...estate, ...(deferred ? { moveOutTax } : {}),
            remains: Math.max(0, cash - estate.tax + (deferred ? estate.housingCapital - moveOutTax : 0)), leaves: assets - (estate.estateCosts || 0) - estate.inherited,
            rate: estate.residenceTax?.rate ?? inheritanceTaxRate(estate.taxable, status), shortfall: Math.max(0, estate.tax - cash) };
    }
    if (status === 'unmarried' && homeAndTax && homeValue > 0) {
        const missingCostBasis = !tranches ? assets > cash : tranches.some(lot => !Number.isFinite(lot.costBasis));
        const lots = tranches ?? (assets > cash ? [{ type: 'aktien_alt', category: 'equity', marketValue: assets - cash, costBasis: 0 }] : []);
        const estateCosts = deductibleEstateCosts(assets, testament || {});
        const netAssets = assets - estateCosts;
        const netProceeds = inheritanceNetProceeds({ cash, tranches: lots, estateCosts, kirchensteuerSatz, sparerPauschbetrag, taxStatePrev });
        const estate = homeAndTaxEstate(netAssets, homeValue, percent, netProceeds, testament?.childrenProtected);
        return { remains: Math.max(0, estate.inherited - estate.tax - estate.taxCashSaleTax), leaves: netAssets - estate.inherited,
            home: homeValue, tax: estate.tax, taxable: estate.taxable, rate: inheritanceTaxRate(estate.taxable, status),
            shortfall: Math.max(0, estate.tax - netProceeds(estate.inherited)), taxCash: estate.taxCash,
            // FR-96: Kosten und Pflichtteil auch bei Immobilien und Steuergeld.
            ...(estateCosts > 0 ? { estateCosts } : {}),
            ...(estate.childrenMoneyCut > 0 ? { childrenMoneyCut: estate.childrenMoneyCut } : {}),
            ...(estate.childrenShortfall > 0 ? { childrenShortfall: estate.childrenShortfall } : {}),
            taxCashSaleTax: estate.taxCashSaleTax, missingCostBasis };
    }
    const share = percent / 100, inherited = assets * share, home = homeValue * share;
    const exemptGain = equalizationAllowance({ status, maritalPropertyRegime }, {
        ...gains, acquisition: inherited + home, exemptHome: exemptHome * share });
    const taxable = inheritanceTaxable(inherited + home, { status, exemptHome: exemptHome * share, exemptGain });
    const rate = inheritanceTaxRate(taxable, status);
    const tax = inheritanceTax(inherited + home, { status, exemptHome: exemptHome * share, exemptGain });
    return { remains: Math.max(0, inherited - tax), leaves: assets - inherited, home, tax, taxable, rate,
        shortfall: Math.max(0, tax - inherited) };
}
