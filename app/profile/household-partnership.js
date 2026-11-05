/** @import * as P from "../../typcheck/profile-ui.js" */
import { inheritanceNetProceeds } from './household-inheritance-sale.js';
import { lifetimeUseMultiplier } from '../shared/life-expectancy.js';

export const PARTNERSHIP_KEY = 'household_partnership_v1';
export const inheritancePersonalAllowance = status => status === 'married' ? 500000 : 20000;
export const maritalPropertyRegime = partnership => partnership?.maritalPropertyRegime ?? 'community';
export const maritalPropertyLabel = partnership => maritalPropertyRegime(partnership) === 'separation'
    ? 'Gütertrennung' : 'Zugewinngemeinschaft (gesetzlich)';
export const spouseTaxNote = partnership => maritalPropertyRegime(partnership) === 'separation'
    ? 'Kein Zugewinnausgleich (Gütertrennung). Ohne Versorgungsfreibetrag.'
    : 'Zugewinnausgleich vereinfacht gerechnet (Zuwachs ab heute, um die Inflation bereinigt). Anfangsvermögen ist das Vermögen beim Planstart („Heirat = heute“); Ehejahre davor zählen nicht, daher kann die echte Steuer bei langer Ehe niedriger oder höher sein. Geplante Zuflüsse zählen zum Anfangsvermögen; ein steuerfreies Familienheim kürzt den Zugewinnabzug anteilig. Ohne Versorgungsfreibetrag.';
export const FAMILY_HOME_CONDITIONS = 'Gilt nur, wenn der Erbe selbst darin wohnt, grundsätzlich 10 Jahre lang (§ 13 Abs. 1 Nr. 4b ErbStG). Die App prüft das nicht.';

/** Fehlender Record: verheiratet mit gesetzlichem Güterstand. */
/**
 * @param raw Gespeicherter Rohwert.
 * @returns Geprüfte Partnerschaft mit den bestehenden Lesevorgaben.
 */
export function readPartnership(raw) {
    if (raw == null || raw === '') return { schemaVersion: 1, status: 'married', maritalPropertyRegime: 'community', inheritance: {} };
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || !['married', 'unmarried'].includes(value.status)
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
            if (rule.home !== undefined && !['money', 'residence', 'life-estate'].includes(rule.home)) throw new Error('Testament: Bitte die Immobilienregel wählen.');
            if (rule.residenceTax !== undefined && !['immediate', 'annual'].includes(rule.residenceTax)) throw new Error('Wohnrechtsteuer: Bitte sofort oder jährlich wählen.');
        }
    }
    const testament = Object.fromEntries(Object.entries(value.testament || {}).filter(([, rule]) =>
        rule.minimum !== undefined || rule.maximumPercent !== undefined || (rule.home && rule.home !== 'money') || rule.residenceTax !== undefined));
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
        : partnership?.inheritance?.[profileId] ?? 0;
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

export const testamentRule = (partnership, profileId) => partnership?.testament?.[profileId] || {};
export const hasInheritanceHomes = (homes, profileId) => homes?.some(home => (profileId === undefined || home.profileId === profileId) && home.wert > 0) === true;
const containsTestament = rule => Boolean(rule && (rule.minimum !== undefined || rule.maximumPercent !== undefined || (rule.home && rule.home !== 'money')));
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
        rule.home === 'residence' ? `Wohnrecht auf Lebenszeit${rule.residenceTax === 'annual' ? ', Steuer jährlich (§ 23 ErbStG)' : ''}` : rule.home === 'life-estate' ? 'Eigentum auf Lebenszeit, danach an die Kinder' : 'Immobilien wie Geldvermögen'].filter(Boolean).join(' · ');
}

/** Derselbe Bruchteil überträgt Geld, Stücke und Einstandswerte. Der Höchstanteil hat Vorrang. */
/**
 * @param assets Geldvermögen in Euro.
 * @param percent Erbanteil in Prozent.
 * @param rule Gespeicherte Testamentregel.
 * @param minimumFactor Inflationsfaktor des testamentarischen Mindestbetrags.
 * @returns Übertragener Geldbetrag und zugehöriger Anteil.
 */
export function testamentMoney(assets, percent, rule = {}, minimumFactor = 1) {
    const inherited = Math.min(assets * (rule.maximumPercent ?? 100) / 100,
        Math.max(assets * percent / 100, (rule.minimum ?? 0) * minimumFactor));
    return { inherited, share: assets > 0 ? inherited / assets : Math.min(percent, rule.maximumPercent ?? 100) / 100 };
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

/** @param {number} assets @param {number} homeValue @param {number} selfUsedHome @param {number} percent @param {P.TestamentRule} rule @param {P.EstateOptions} [options] @returns {P.Estate} */
export function testamentEstate(assets, homeValue, selfUsedHome, percent, rule, { minimumFactor = 1, partnerAge, partnerGender, status = 'unmarried', residenceValue, residenceEligible = true, familyHome = selfUsedHome, maritalPropertyRegime, gains } = {}) {
    const money = testamentMoney(assets, percent, rule, minimumFactor), mode = rule.home || 'money';
    const home = mode === 'residence' ? 0 : mode === 'life-estate' ? selfUsedHome : homeValue * money.share;
    const annualValue = mode === 'residence' && residenceEligible && selfUsedHome > 0 ? residenceValue ?? residenceAnnualValue(selfUsedHome) : 0;
    const residenceCapital = annualValue > 0 ? annualValue * lifetimeUseMultiplier(partnerAge, partnerGender) : 0;
    const exemptHome = status === 'married' ? mode === 'life-estate' ? familyHome : mode === 'money' ? familyHome * money.share : 0 : 0;
    const acquisition = money.inherited + home + residenceCapital;
    const exemptGain = equalizationAllowance({ status, maritalPropertyRegime }, { ...gains, acquisition, exemptHome });
    const tax = inheritanceTax(acquisition, { status, exemptHome, exemptGain });
    const gainLog = exemptGain > 0 ? { exemptGain } : {};
    if (residenceCapital > 0 && rule.residenceTax === 'annual') {
        const allowance = status === 'married' ? inheritancePersonalAllowance(status) + exemptGain : inheritancePersonalAllowance(status);
        const taxable = Math.max(0, money.inherited + home + residenceCapital - exemptHome - allowance);
        const rate = inheritanceTariff(taxable, status).effectiveRate;
        const immediateTax = Math.max(0, money.inherited + home - exemptHome - allowance) * rate;
        return { ...money, home, residenceCapital, exemptHome, tax: immediateTax, mode, ...gainLog,
            residenceTax: { annualValue, rate, annualTax: annualValue * rate,
                allowanceRemaining: Math.max(0, allowance + exemptHome - money.inherited - home), immediateComparison: tax } };
    }
    return { ...money, home, residenceCapital, exemptHome, tax, mode, ...gainLog };
}

/** FR-54: Steuergeld zuerst, Prozentsatz nur vom übrigen Geldvermögen. */
/**
 * @param assets Geldvermögen in Euro.
 * @param home Eigener Immobilienanteil in Euro.
 * @param percent Erbanteil in Prozent.
 * @param netProceeds Funktion für den Nettoerlös einer Geldveräußerung.
 * @returns Erbaufteilung einschließlich der Finanzierung der Steuer.
 */
export function homeAndTaxEstate(assets, home, percent, netProceeds = amount => amount) {
    const share = percent / 100;
    const taxFor = cash => inheritanceTax(home + cash + (assets - cash) * share);
    let low = 0, high = Math.max(0, assets);
    // Bei zu kleinem Nachlass bleibt die ungedeckte Steuer sichtbar.
    if (taxFor(high) <= netProceeds(high)) {
        for (let i = 0; i < 80 && high - low > 1e-7; i++) {
            const mid = (low + high) / 2;
            if (taxFor(mid) > netProceeds(mid)) low = mid; else high = mid;
        }
    }
    const taxCash = high, inherited = taxCash + (assets - taxCash) * share;
    return { taxCash, inherited, tax: inheritanceTax(home + inherited), home,
        taxCashSaleTax: Math.max(0, taxCash - netProceeds(taxCash)) };
}

const classI = [[75000, .07], [300000, .11], [600000, .15], [6000000, .19],
    [13000000, .23], [26000000, .27], [Infinity, .3]];
const classIII = [[6000000, .3], [Infinity, .5]];
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
/** FR-51: § 19 Abs. 1 und 3 ErbStG mit Familienheim und zusätzlichem Zugewinnabzug. */
/**
 * @param estate Steuerlich zu bewertender Erwerb in Euro.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Erbschaftsteuer in Euro.
 */
export function inheritanceTax(estate, { status = 'unmarried', exemptHome = 0, exemptGain = 0 } = {}) {
    const taxable = inheritanceTaxable(estate, { status, exemptHome, exemptGain });
    return inheritanceTariff(taxable, status).tax;
}

function inheritanceTaxable(estate, { status, exemptHome = 0, exemptGain = 0 }) {
    return Math.max(0, estate - (status === 'married' ? exemptHome + inheritancePersonalAllowance(status) + exemptGain : inheritancePersonalAllowance(status)));
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
    cash = 0, tranches, kirchensteuerSatz = 0, sparerPauschbetrag = 0, taxStatePrev, testament, minimumFactor = 1, partnerAge, partnerGender, residenceValue, residenceEligible = true, familyHome = selfUsedHome,
    gains = { deceasedAssets: assets + homeValue, deceasedInitialAssets: assets + homeValue } } = {}) {
    if (testament) {
        const estate = testamentEstate(assets, homeValue, selfUsedHome, percent, testament, { status, maritalPropertyRegime, minimumFactor, partnerAge, partnerGender, residenceValue, residenceEligible, familyHome,
            gains });
        const taxable = inheritanceTaxable(estate.inherited + estate.home + estate.residenceCapital,
            { status, exemptHome: estate.exemptHome, exemptGain: estate.exemptGain });
        return { ...estate, remains: Math.max(0, estate.inherited - estate.tax), leaves: assets - estate.inherited,
            taxable, rate: estate.residenceTax?.rate ?? inheritanceTaxRate(taxable, status), shortfall: Math.max(0, estate.tax - estate.inherited) };
    }
    if (status === 'unmarried' && homeAndTax && homeValue > 0) {
        const missingCostBasis = !tranches ? assets > cash : tranches.some(lot => !Number.isFinite(lot.costBasis));
        const lots = tranches ?? (assets > cash ? [{ type: 'aktien_alt', category: 'equity', marketValue: assets - cash, costBasis: 0 }] : []);
        const netProceeds = inheritanceNetProceeds({ cash, tranches: lots, kirchensteuerSatz, sparerPauschbetrag, taxStatePrev });
        const estate = homeAndTaxEstate(assets, homeValue, percent, netProceeds);
        const taxable = Math.max(0, estate.inherited + homeValue - inheritancePersonalAllowance(status));
        return { remains: Math.max(0, estate.inherited - estate.tax - estate.taxCashSaleTax), leaves: assets - estate.inherited,
            home: homeValue, tax: estate.tax, taxable, rate: inheritanceTaxRate(taxable, status),
            shortfall: Math.max(0, estate.tax - netProceeds(estate.inherited)), taxCash: estate.taxCash,
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
