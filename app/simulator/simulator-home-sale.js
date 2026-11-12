/** FR-53/61/62: einmaliger Verkauf und anschließende Haushaltsmiete. */
import { careFormForPerson, isInResidentialCare } from '../shared/care-benefits.js';
import { inheritancePercent, inheritsHomeAndTax, testamentRule, hasTestament, testamentMoney, hasInheritanceHomes } from '../profile/household-partnership.js';
import { homeValueAtDeath, inheritanceReferenceFactor } from './simulator-inheritance.js';
import { personalAssetValues } from './simulator-unmarried.js';
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { livesInResidentialCare } from './simulator-residential-care.js';

/**
 * @param home
 * @param index
 * @returns {string} Ergebnis der Operation.
 */
export const homeKey = (home, index) => JSON.stringify([home.profileId, home.id ?? index]);
/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param home
 * @param index
 * @returns {boolean} Ergebnis der Operation.
 */
export const homeWasSold = (portfolio, home, index) => portfolio.homeSales?.includes(homeKey(home, index)) === true;
export const HOME_SALE_MIN_CARE_GRADE = 4;
export const EMERGENCY_HOME_SALE_THRESHOLD_YEARS = 1;
export const EMERGENCY_HOME_RENT_RATE = .04;

/** Tod oder Heimpflege beendet das Wohnrecht ohne Auszahlung oder neue Miete.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param survivor
 * @param household
 * @returns {void}
 */
export function endResidenceRights(portfolio, inputs, survivor, household) {
    if (!portfolio.homeInheritance || !survivor) return;
    const index = inputs.simulationPeople?.findIndex(person => person.profileId === survivor.survivorProfileId);
    if (index !== 0 && index !== 1) return;
    const dead = household?.[index === 0 ? 'p1Alive' : 'p2Alive'] === false;
    if (!dead && !isInResidentialCare(inputs, index, household)) return;
    portfolio.homeInheritance = { ...portfolio.homeInheritance };
    for (const [key, value] of Object.entries(portfolio.homeInheritance)) if (value.mode === 'residence' && value.residenceActive) {
        portfolio.homeInheritance[key] = { ...value, residenceActive: false };
    }
}

/** Gespeicherter Erbbruchteil; im vorzeitig beendeten Todesjahr aus dem Nachlass ableiten.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param survivor
 * @param home
 * @param index
 * @param {number} [inflationFactor]
 * @returns Ergebnis der Operation.
 */
export function inheritedHomeShare(inputs, portfolio, survivor, home, index, inflationFactor = 1) {
    const saved = portfolio.homeInheritance?.[homeKey(home, index)];
    if (saved) return saved.share;
    if (survivor?.deceasedProfileId !== home.profileId) return 1;
    const rule = testamentRule(inputs.partnership, home.profileId);
    const hasHomes = hasInheritanceHomes(inputs.home, home.profileId);
    if (hasTestament(inputs.partnership, home.profileId, hasHomes)) {
        if (rule.home === 'residence') return 0;
        if (rule.home === 'life-estate') return home.nutzung === 'selbst' ? 1 : 0;
        const assets = personalAssetValues(portfolio).find(row => row.profileId === home.profileId)?.value || 0;
        return testamentMoney(assets, inheritancePercent(inputs.partnership, home.profileId), rule,
            rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, inputs, inflationFactor) : 1).share;
    }
    return inputs.partnership && !inheritsHomeAndTax(inputs.partnership, home.profileId, hasHomes)
        ? inheritancePercent(inputs.partnership, home.profileId) / 100 : 1;
}

/** Reiner Anzeigewert nach Jahresabschluss, mit derselben Bewertung wie Verkauf und Erbe.
 *
 * @param {object} options
 * @param options.inputs
 * @param options.portfolio
 * @param options.survivor
 * @param options.inflationFactor
 * @param [options.household]
 * @returns Ergebnis der Operation.
 */
export function homeValueAtYearEnd({ inputs, portfolio, survivor, inflationFactor, household = null }) {
    if (household?.p1Alive === false && (!inputs.partner?.aktiv || household.p2Alive === false)) return 0;
    if (!survivor && inputs.partner?.aktiv && household && household.p1Alive !== household.p2Alive) {
        survivor = { deceasedProfileId: inputs.simulationPeople?.[household.p1Alive ? 1 : 0]?.profileId };
    }
    return (inputs.home || []).reduce((sum, home, index) => {
        if (homeWasSold(portfolio, home, index)) return sum;
        const share = inheritedHomeShare(inputs, portfolio, survivor, home, index, inflationFactor);
        return sum + homeValueAtDeath(home, inputs, inflationFactor) * share;
    }, 0);
}

/** Anzeigeklassen aus derselben Bewertung, ohne den Portfoliozustand zu ändern.
 *
 * @param {object} options
 * @returns Ergebnis der Operation.
 */
export function homeValuesByUseAtYearEnd(options) {
    const total = homeValueAtYearEnd(options);
    const subset = use => homeValueAtYearEnd({ ...options, inputs: { ...options.inputs,
        home: (options.inputs.home || []).map((home, index) => ({ ...home, id: home.id ?? index, wert: home.nutzung === use ? home.wert : 0 })) } });
    return { total, self: subset('selbst'), rented: subset('vermietet') };
}

/**
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @returns {boolean} Ergebnis der Operation.
 */
export function allLivingInExternalCare(inputs, household) {
    const living = [{ alive: household.p1Alive, care: household.care?.p1, index: 0 },
        ...(inputs.partner?.aktiv ? [{ alive: household.p2Alive, care: household.care?.p2, index: 1 }] : [])].filter(person => person.alive);
    return living.length > 0 && living.every(({ care, index }) => care?.active && care.grade >= HOME_SALE_MIN_CARE_GRADE
        && careFormForPerson(inputs, care.grade, index, household) === 'residential');
}

/** FR-62 nach FR-72 Punkt 14: Alle Lebenden wohnen tatsächlich im Heim, unabhängig vom Grad.
 * Den Heimzustand legt nur Monte Carlo ab; ohne ihn gilt die bisherige Grenze.
 *
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @returns {boolean} Ergebnis der Operation.
 */
export function allLivingInResidence(inputs, household) {
    const living = [{ alive: household.p1Alive, care: household.care?.p1 },
        ...(inputs.partner?.aktiv ? [{ alive: household.p2Alive, care: household.care?.p2 }] : [])].filter(person => person.alive);
    return living.length > 0 && living.every(({ care }) => livesInResidentialCare(care));
}

function isPartnerDeathYear(state, inputs, household, yearIndex) {
    return inputs.partner?.aktiv && household.p1Alive !== household.p2Alive
        && (!state.survivor || state.survivor.deathYearIndex === yearIndex);
}

/**
 * @param {object} options
 * @returns Ergebnis der Operation.
 */
export function sellHomesForExternalCare(options) {
    const { state, inputs, household, yearIndex } = options;
    // Der Nachlass wird erst am Jahresende verteilt. Im Todesjahr keinen
    // Jahresanfangsverkauf vorwegnehmen; geerbte Anteile stehen ab dem Folgejahr fest.
    if (isPartnerDeathYear(state, inputs, household, yearIndex) || !allLivingInExternalCare(inputs, household)) return null;
    return sellHomes(options);
}

/**
 * @param {object} options
 * @returns Ergebnis der Operation.
 */
export function sellHomesForEmergency(options) {
    const { portfolio, state, inputs, household, yearIndex, requiredFloor, beforeRuin = false } = options;
    if (!inputs.home?.length || (!household.p1Alive && (!inputs.partner?.aktiv || !household.p2Alive))) return null;
    // Die zweite Prüfung darf auch im Todesjahr verkaufen. Dann geht der Erlös
    // zunächst an den ursprünglichen Eigentümer und erst am Jahresende ins Erbe.
    if (!beforeRuin && (isPartnerDeathYear(state, inputs, household, yearIndex)
        || moneyAssets(portfolio) >= requiredFloor * EMERGENCY_HOME_SALE_THRESHOLD_YEARS)) return null;
    return sellHomes({ ...options, emergency: true });
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @returns Ergebnis der Operation.
 */
export function moneyAssets(portfolio) {
    return (portfolio.liquiditaet || 0) + ['depotTranchesAktien', 'depotTranchesGold', 'healthBucketTranches']
        .reduce((sum, key) => sum + (portfolio[key] || []).reduce((total, lot) => total + lot.marketValue, 0), 0)
        + (portfolio.healthBucketCashAmount || 0);
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param household
 * @param inflationFactor
 * @param [state] Zustand des Simulationspfads.
 * @param {number} [yearIndex] Nullbasierter Index des Simulationsjahrs.
 * @returns {number} Ergebnis der Operation.
 */
export function homeRentForYear(portfolio, inputs, household, inflationFactor, state = {}, yearIndex = -1) {
    const rent = portfolio.homeRent;
    if (!rent) return 0;
    const factor = homeRentLifeFactor(inputs, household, state, yearIndex);
    const active = factor > 0;
    portfolio.homeRent = { ...rent, active: Boolean(active) };
    return factor * rent.amount * inflationFactor / rent.inflationFactor;
}

function homeRentLifeFactor(inputs, household, state, yearIndex) {
    const rentEnds = context => allLivingInExternalCare(inputs, context) || allLivingInResidence(inputs, context);
    const after = (household.p1Alive || (inputs.partner?.aktiv && household.p2Alive)) && !rentEnds(household) ? 1 : 0;
    if (yearIndex < 0 || !isPartnerDeathYear(state, inputs, household, yearIndex)) return after;
    const before = !rentEnds({ ...household, p1Alive: true, p2Alive: true }) ? 1 : 0;
    return (before + after) / 2;
}

function sellHomes({ portfolio, state, inputs, household, yearIndex, inflationFactor, emergency = false,
    requiredFloor = 0, requiredFloorForPortfolio = null, beforeRuin = false, maxSales = Infinity }) {
    if (!inputs.home?.length) return null;
    const sales = [], hints = [], sold = [...(portfolio.homeSales || [])];
    let rent = 0;
    const deceasedId = isPartnerDeathYear(state, inputs, household, yearIndex)
        ? inputs.simulationPeople?.[household.p1Alive ? 1 : 0]?.profileId : null;
    const homes = inputs.home.map((home, index) => ({ home, index }));
    if (emergency) homes.sort((a, b) => Number(b.home.profileId === deceasedId) - Number(a.home.profileId === deceasedId)
        || Number(a.home.nutzung === 'selbst') - Number(b.home.nutzung === 'selbst') || a.index - b.index);
    for (const { home, index } of homes) {
        if (emergency && sales.length && (sales.length >= maxSales || (!beforeRuin && moneyAssets(portfolio)
            >= ((requiredFloorForPortfolio?.() ?? requiredFloor) + rent * homeRentLifeFactor(inputs, household, state, yearIndex))
                * EMERGENCY_HOME_SALE_THRESHOLD_YEARS))) break;
        if (homeWasSold(portfolio, home, index)) continue;
        const inherited = state.survivor?.deceasedProfileId != null && state.survivor.deceasedProfileId === home.profileId;
        const mode = hasTestament(inputs.partnership, home.profileId, hasInheritanceHomes(inputs.home, home.profileId)) ? testamentRule(inputs.partnership, home.profileId).home : 'money';
        if ((inherited || home.profileId === deceasedId) && (mode === 'residence' || mode === 'life-estate')) continue;
        let profileId = inherited ? state.survivor.survivorProfileId : home.profileId;
        const share = inheritedHomeShare(inputs, portfolio, state.survivor, home, index, inflationFactor);
        if (!share) { sold.push(homeKey(home, index)); continue; }
        let account = portfolio.personAccounts.find(person => person.profileId === profileId);
        if (!account && !inputs.partner?.aktiv && portfolio.personAccounts.length === 1) {
            account = portfolio.personAccounts[0];
            profileId = account.profileId;
        }
        if (!account) {
            hints.push(`Immobilie „${home.bezeichnung || home.id || index + 1}“: Eigentümer nicht zugeordnet; kein Verkauf.`);
            continue;
        }
        const value = homeValueAtDeath(home, inputs, inflationFactor) * share;
        const amount = value * .9;
        if (emergency && home.nutzung === 'selbst') rent += value * EMERGENCY_HOME_RENT_RATE;
        account.tagesgeld += amount;
        // FR-56: nominale Zuordnung, unabhängig von späterem Verbrauch oder Anlage.
        account.homeSaleProceeds = [...(account.homeSaleProceeds || []), { homeId: home.id ?? index, amount,
            year: (inputs.homeReferenceYear ?? inputs.referenceYear ?? inputs.fixedIncomeReferenceYear ?? 2026) + yearIndex }];
        sold.push(homeKey(home, index));
        sales.push({ profileId, homeId: home.id ?? index, amount });
        if (emergency) {
            portfolio.homeSales = sold;
            syncPersonalLiquidity(portfolio);
        }
    }
    if (sold.length) portfolio.homeSales = sold;
    if (!sales.length && !hints.length) return null;
    if (sales.length) {
        portfolio.homeSales = sold;
        if (rent > 0) portfolio.homeRent = { amount: rent + (portfolio.homeRent
            ? portfolio.homeRent.amount * inflationFactor / portfolio.homeRent.inflationFactor : 0), startYear: portfolio.homeRent?.startYear ?? (inputs.homeReferenceYear ?? inputs.referenceYear
            ?? inputs.fixedIncomeReferenceYear ?? 2026) + yearIndex, inflationFactor,
            active: homeRentLifeFactor(inputs, household, state, yearIndex) > 0 };
        syncPersonalLiquidity(portfolio);
    }
    return { ...(sales.length ? { immobilienverkauf: sales.reduce((sum, sale) => sum + sale.amount, 0),
        ...(emergency ? { immobilien_notverkauf: true } : {}),
        immobilienverkauf_jahr: (inputs.homeReferenceYear ?? inputs.referenceYear ?? inputs.fixedIncomeReferenceYear ?? 2026) + yearIndex,
        immobilienverkauf_personen: sales } : {}),
        ...(hints.length ? { immobilienverkauf_hinweis: hints.join(' ') } : {}) };
}
