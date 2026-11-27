/** @import {InheritanceNetProceeds, TestamentEstate} from '../../typcheck/simulator-ui.js' */
/** FR-48/49/51: Nachlass nach den Jahresbuchungen, ohne Verkauf des externen Anteils. */
import { inheritanceTariff, inheritanceTaxable, inheritancePercent, inheritsHomeAndTax, homeAndTaxEstate, hasTestament, testamentRule, testamentEstate, residenceAnnualValue, hasInheritanceHomes, equalizationAllowance, maritalPropertyRegime, pensionAllowance, hasTestamentHomeSale, deductibleEstateCosts } from '../profile/household-partnership.js';
import { initializePortfolio } from './simulator-portfolio-init.js';
import { personalAssetValues } from './simulator-unmarried.js';
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { payPersonalExtraCost, realizeInheritedTaxCash, personalExtraSaleTax } from './simulator-personal-tax.js';
import { GERMAN_CPI_INFLATION_RATES } from './german-cpi-chain.js';
import { inheritanceNetProceeds } from '../profile/household-inheritance-sale.js';
import { isInResidentialCare } from '../shared/care-benefits.js';
import { personDisplayAge } from '../profile/profile-person-data.js';
import { homeKey } from './simulator-home-sale.js';
import { isInPermanentResidentialCare } from './simulator-rent-bequest.js';

/**
 * @param home
 * @param inputs Wirksame Simulationseingaben.
 * @param inflationFactor
 * @returns {number} Ergebnis der Operation.
 */
export function homeValueAtDeath(home, inputs, inflationFactor) {
    return home.wert * inheritanceReferenceFactor(home.stand, inputs, inflationFactor);
}

/**
 * @param stand
 * @param inputs Wirksame Simulationseingaben.
 * @param inflationFactor
 * @returns Ergebnis der Operation.
 */
export function inheritanceReferenceFactor(stand, inputs, inflationFactor) {
    const reference = inputs.homeReferenceYear ?? inputs.referenceYear ?? inputs.fixedIncomeReferenceYear ?? inputs.plannedInflowsReferenceYear;
    const standYear = Number(stand.slice(0, 4)), standMonth = Number(stand.slice(5));
    let factor = inflationFactor;
    // Jahresmodell: historischer Stand bis zum Rechenbeginn, danach die gezogenen Inflationsjahre.
    for (let year = standYear; year < reference; year++) {
        factor *= (1 + (GERMAN_CPI_INFLATION_RATES[year] || 0) / 100) ** (year === standYear ? (13 - standMonth) / 12 : 1);
    }
    return factor;
}

/**
 * @param {object} options
 * @param options.portfolio
 * @param options.transition
 * @param options.inputs
 * @param options.inflationFactor
 * @param options.pension
 * @param options.personalInterest
 * @param options.actionResult
 * @param options.household
 * @param {number} [options.historicalYear] Kalenderjahr des Backtests.
 * @param [options.reserveTarget]
 * @returns Ergebnis der Operation.
 */
export function applyUnmarriedInheritance({ portfolio, transition, inputs, inflationFactor, pension, personalInterest, actionResult, household, historicalYear,
    reserveTarget = null }) {
    if (!transition?.deathThisYear) return null;
    const { partnership } = inputs, status = partnership?.status;
    const { deceasedProfileId, survivorProfileId } = transition.survivor;
    const percent = inheritancePercent(inputs.partnership, deceasedProfileId);
    const account = portfolio.personAccounts.find(row => row.profileId === survivorProfileId);
    const deceased = portfolio.personAccounts.find(row => row.profileId === deceasedProfileId);
    const assets = personalAssetValues(portfolio).find(row => row.profileId === deceasedProfileId)?.value || 0;
    const healthAssets = (portfolio.healthBucketTranches || []).filter(lot => lot.sourceProfileId === deceasedProfileId)
        .reduce((sum, lot) => sum + lot.marketValue, 0) + (portfolio.healthBucketCashOwners || [])
        .filter(row => row.profileId === deceasedProfileId).reduce((sum, row) => sum + row.amount, 0);
    const homes = (inputs.home || []).filter((row, index) => row.profileId === deceasedProfileId
        && !portfolio.homeSales?.includes(JSON.stringify([row.profileId, row.id ?? index])));
    const hasHomes = hasInheritanceHomes(inputs.home, deceasedProfileId);
    const familyHome = Math.max(0, ...homes.filter(row => row.nutzung === 'selbst').map(row => homeValueAtDeath(row, inputs, inflationFactor)));
    const proceeds = inheritsHomeAndTax(inputs.partnership, deceasedProfileId, hasHomes)
        ? Math.min(assets, (deceased.homeSaleProceeds || []).reduce((sum, row) => sum + row.amount, 0)) : 0;
    const home = homes
        .reduce((sum, row) => sum + homeValueAtDeath(row, inputs, inflationFactor), 0) + proceeds;
    let gains;
    if (status === 'married' && maritalPropertyRegime(partnership) === 'community') {
        // Dieselbe Initialisierung wie am Planstart, einschließlich Pflegereserve
        // und Altformaten. Keine zusätzlichen Zustandsbytes bei alten Steuerfällen.
        const initial = personalAssetValues(initializePortfolio(inputs));
        const homeSum = (profileId, factor, onlyUnsold) => (inputs.home || [])
            .filter((row, index) => row.profileId === profileId && (!onlyUnsold
                || !portfolio.homeSales?.includes(JSON.stringify([row.profileId, row.id ?? index]))))
            .reduce((sum, row) => sum + homeValueAtDeath(row, inputs, factor), 0);
        gains = {
            deceasedAssets: assets + homeSum(deceasedProfileId, inflationFactor, true),
            survivorAssets: (personalAssetValues(portfolio).find(row => row.profileId === survivorProfileId)?.value || 0)
                + homeSum(survivorProfileId, inflationFactor, true),
            deceasedInitialAssets: (initial.find(row => row.profileId === deceasedProfileId)?.value || 0) + homeSum(deceasedProfileId, 1, false)
                + (portfolio.equalizationInflows?.[deceasedProfileId] || 0),
            survivorInitialAssets: (initial.find(row => row.profileId === survivorProfileId)?.value || 0) + homeSum(survivorProfileId, 1, false)
                + (portfolio.equalizationInflows?.[survivorProfileId] || 0),
            inflationFactor
        };
    }
    const rule = testamentRule(inputs.partnership, deceasedProfileId);
    const moveOutYears = rule.home === 'housing-capital' ? rule.moveOutYears ?? 0 : 0;
    const survivorIndex = inputs.simulationPeople?.findIndex(person => person.profileId === survivorProfileId);
    const deathYearIndex = transition.survivor.deathYearIndex || 0;
    const referenceYear = inputs.residenceReferenceYear ?? inputs.homeReferenceYear ?? inputs.referenceYear;
    const valuationYear = historicalYear ?? (referenceYear + deathYearIndex);
    const deathAge = personDisplayAge({ profile_geburtsdatum: inputs.simulationPeople?.[survivorIndex]?.geburtsdatum },
        new Date(referenceYear + deathYearIndex, 6, 1));
    const partnerAge = deathAge.status === 'valid' ? deathAge.age
        : (survivorIndex === 0 ? inputs.startAlter : inputs.partner?.startAlter) + deathYearIndex;
    const partnerGender = inputs.simulationPeople?.[survivorIndex]?.residenceGenderUnknown ? undefined
        : survivorIndex === 0 ? inputs.geschlecht : inputs.partner?.geschlecht;
    const residenceEligible = household?.[survivorIndex === 0 ? 'p1Alive' : 'p2Alive'] !== false
        && !isInResidentialCare(inputs, survivorIndex, household);
    // ER-2e (Befund 1825): Wohnkapital nur, wenn die überlebende Person lebt und nicht dauerhaft im Heim ist, auch bei „Auszug nach 0“.
    const housingCapitalEligible = household?.[survivorIndex === 0 ? 'p1Alive' : 'p2Alive'] !== false
        && !isInPermanentResidentialCare(inputs, survivorIndex, household);
    // VB-1 (FR-51, § 17 ErbStG): Hinterbliebenenrente und Sterbevierteljahr so, wie das Rentenjahr sie rechnet; Alter und Geschlecht wie beim Wohnrecht.
    const survivorSlot = survivorIndex === 0 ? 'P1' : 'P2';
    const pensionRelief = pensionAllowance(status, { annualPension: pension?.[`survivorAnnual${survivorSlot}`],
        lumpSum: pension?.[`bereavementQuarter${survivorSlot}`], age: partnerAge, gender: partnerGender, valuationYear });
    // NK-2 (FR-84 Punkt 17, Gutachten NK1C2 Befund 2): Offene Steuer der verstorbenen Person ist Nachlassverbindlichkeit. Sie mindert den
    // Erwerb vor der Erbschaftsteuer und geht mit dem Erbanteil auf die lebende Person über; der Rest geht mit dem übrigen Nachlass.
    const estateDebt = Math.max(0, Number(deceased.openTax) || 0);
    const estateAdjustment = rule.estateCosts > 0 || rule.childrenProtected;
    const testamentFor = (/** @type {number} */ estate, debt = 0) => /** @type {TestamentEstate} */ (testamentEstate)(estate, home,
        homes.filter(row => row.nutzung === 'selbst').reduce((sum, row) => sum + homeValueAtDeath(row, inputs, inflationFactor), 0),
        percent, rule, { status, maritalPropertyRegime: maritalPropertyRegime(partnership), gains, partnerAge, partnerGender, valuationYear, residenceEligible, housingCapitalEligible, familyHome,
            pensionAllowance: pensionRelief.amount, inflationFactor, estateDebt: debt,
            residenceValue: homes.filter(row => row.nutzung === 'selbst').reduce((sum, row) => {
                const factor = inheritanceReferenceFactor(row.stand, inputs, inflationFactor);
                return sum + residenceAnnualValue(row.wert * factor, row.ortsueblicheMiete === undefined ? undefined : row.ortsueblicheMiete * factor);
            }, 0),
            minimumFactor: rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, inputs, inflationFactor) : 1 });
    const testament = hasTestament(inputs.partnership, deceasedProfileId, hasHomes) ? testamentFor(assets, estateAdjustment ? estateDebt : 0) : null;
    const homeAndTax = home > 0 && inheritsHomeAndTax(inputs.partnership, deceasedProfileId, hasHomes);
    // Der Hauserlös steckt bereits im Geldvermögen: für FR-54 einmalig umordnen.
    const remainingAssets = assets - proceeds;
    const estateCosts = homeAndTax ? deductibleEstateCosts(remainingAssets, rule, inflationFactor) : testament?.estateCosts || 0;
    const netAssets = remainingAssets - estateCosts;
    const keys = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches'];
    const estateLots = keys.flatMap(key => portfolio[key] || [])
        .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === deceasedProfileId);
    const reserveCash = (portfolio.healthBucketCashOwners || []).filter(row => row.profileId === deceasedProfileId)
        .reduce((sum, row) => sum + row.amount, 0);
    if (reserveCash > 0) estateLots.push({ trancheId: 'estate-reserve-cash', type: 'anleihe', category: 'bonds',
        marketValue: reserveCash, costBasis: reserveCash, taxExempt: true });
    const netProceeds = homeAndTax ? /** @type {InheritanceNetProceeds} */ (inheritanceNetProceeds)({ cash: deceased.tagesgeld,
        tranches: estateLots, reservedHomeProceeds: proceeds, estateCosts, kirchensteuerSatz: account.kirchensteuerSatz,
        saleTax: personalExtraSaleTax(portfolio, survivorProfileId, personalInterest, actionResult) }) : null;
    const special = homeAndTax ? homeAndTaxEstate(netAssets, home, percent, netProceeds, rule.childrenProtected) : null;
    // FR-96: Die Kosten gehen zuerst vom freien Tagesgeld ab. Ein Rest mindert Depot und Pflegereserve anteilig.
    const cashCosts = special ? Math.min(estateCosts, Math.max(0, deceased.tagesgeld - proceeds)) : 0;
    const netCash = deceased.tagesgeld - cashCosts;
    const depot = assets - deceased.tagesgeld;
    const netDepotShare = special && estateCosts > cashCosts && depot > 0 ? 1 - (estateCosts - cashCosts) / depot : 1;
    const cashForTax = special ? Math.min(netCash, proceeds + special.taxCash) : 0;
    const taxDepotShare = special && depot > 0 ? (proceeds + special.taxCash - cashForTax) / depot : 0;
    // Der Zusatzanteil gilt für den Rest nach Hauserlös und Steuergeld; die Pflichtteils-Sicherung kürzt nur ihn.
    const cutShare = special?.childrenMoneyCut > 0 && netAssets > special.taxCash
        ? (special.inherited - special.taxCash) / (netAssets - special.taxCash) : 0;
    const additional = (/** @type {number} */ amount) => special?.childrenMoneyCut > 0 ? amount * cutShare : amount * percent / 100;
    // Hauserlös und X zuerst aus Tagesgeld; nur der Rest aus Depot/Pflegereserve.
    // Danach gilt die zusätzliche Quote für jeden verbliebenen Bestand.
    const share = special ? taxDepotShare + additional(netDepotShare - taxDepotShare) : testament?.share ?? percent / 100;
    const homeShare = homeAndTax ? 1 : testament?.homeShare ?? share;
    const housingCapital = moveOutYears === 0 ? testament?.housingCapital || 0 : 0;
    if (testament) {
        if (testament.residenceTax) portfolio.residenceTax = { ...testament.residenceTax, profileId: survivorProfileId };
        // ER-2: Beim Wohnkapital zahlt die überlebende Person dieselbe fortgeschriebene Miete selbst.
        if (testament.rentBequestAnnual > 0 || housingCapital > 0) {
            portfolio.rentBequest = { profileId: survivorProfileId, annualAmount: testament.rentBequestAnnual || rule.monthlyRent * 12,
                rentEnded: isInPermanentResidentialCare(inputs, survivorIndex, household), ...(housingCapital > 0 ? { selfPaid: true } : {}) };
            // Verkauft wird nur der Anteil der verstorbenen Person; ein eigener Anteil der überlebenden Person bleibt.
            const sold = (inputs.home || []).flatMap((row, index) => homes.includes(row)
                && row.nutzung === 'selbst' && row.wert > 0 ? [homeKey(row, index)] : []);
            portfolio.homeSales = [...new Set([...(portfolio.homeSales || []), ...sold])];
        }
        portfolio.homeInheritance = { ...(portfolio.homeInheritance || {}) };
        (inputs.home || []).forEach((row, index) => {
            if (homes.includes(row)) portfolio.homeInheritance[JSON.stringify([row.profileId, row.id ?? index])] = {
                share: testament.mode === 'money' || (hasTestamentHomeSale(rule) && row.nutzung === 'vermietet') ? homeShare
                    : testament.mode === 'life-estate' && row.nutzung === 'selbst' ? 1 : 0,
                mode: testament.mode,
                ...(testament.mode === 'residence' && row.nutzung === 'selbst' ? { residenceActive: residenceEligible } : {})
            };
        });
    }
    if (!testament && !homeShare && status !== 'married' && homes.length) {
        portfolio.homeSales = [...(portfolio.homeSales || []), ...(inputs.home || []).flatMap((row, index) =>
            homes.includes(row) ? [JSON.stringify([row.profileId, row.id ?? index])] : [])];
    }
    const exemptHome = familyHome * share;
    const inherited = special?.inherited ?? testament?.inherited ?? assets * share, leaves = netAssets - inherited;
    const exemptGain = testament ? testament.exemptGain || 0
        : equalizationAllowance(inputs.partnership, { ...gains, acquisition: inherited + home * homeShare, exemptHome });
    const taxTestament = testament && estateDebt > 0 && !estateAdjustment ? testamentFor(Math.max(0, assets - estateDebt)) : testament;
    if (taxTestament?.housingCapitalTaxBasis) {
        const homeKeys = (inputs.home || []).flatMap((row, index) => homes.includes(row)
            && row.nutzung === 'selbst' && row.wert > 0 ? [homeKey(row, index)] : []);
        portfolio.pendingHousingCapital = { profileId: survivorProfileId, homeKeys, moveOutYearIndex: deathYearIndex + moveOutYears + 1,
            percent: rule.housingCapitalPercent, annualRent: rule.monthlyRent * 12, ...taxTestament.housingCapitalTaxBasis };
    }
    // Familienheimabzug, wie ihn die Steuer rechnet; das Protokoll-ⓘ liest ihn aus dem Nachlass.
    const familyHomeExemption = status !== 'married' || special ? 0 : taxTestament?.exemptHome ?? exemptHome;
    const taxAcquisition = (estateDebt > 0 ? Math.max(0, inherited - estateDebt * share) : inherited) + home * homeShare;
    // HP-4: Steuer und steuerpflichtiger Erwerb aus derselben Rechnung; inheritanceTaxable rundet auf volle 100 € ab.
    const taxEstate = special && estateDebt > 0 ? homeAndTaxEstate(Math.max(0, netAssets - estateDebt), home, percent, netProceeds, rule.childrenProtected) : special || taxTestament;
    const taxable = taxEstate ? taxEstate.taxable
        : inheritanceTaxable(taxAcquisition, { status, exemptHome, exemptGain, pensionAllowance: pensionRelief.amount });
    const tax = taxEstate ? taxEstate.tax : inheritanceTariff(taxable, status).tax;
    // Der Versorgungsfreibetrag steht nur im Nachlass, wenn nach den übrigen Abzügen ein steuerpflichtiger Erwerb bleibt; sonst bleiben die Bytes wie bisher.
    const pensionReliefUsed = !special && status === 'married' && inheritanceTaxable(taxTestament
        ? (estateAdjustment && estateDebt > 0 ? Math.max(0, inherited - estateDebt * share) : taxTestament.inherited)
            + taxTestament.home + taxTestament.residenceCapital + (moveOutYears === 0 ? taxTestament.housingCapital || 0 : 0) : taxAcquisition, { status: 'married',
        exemptHome: taxTestament ? taxTestament.exemptHome : exemptHome, exemptGain: taxTestament ? taxTestament.exemptGain || 0 : exemptGain }) > 0;
    if (estateDebt > 0 && share > 0) account.openTax = (account.openTax || 0) + estateDebt * share;
    account.tagesgeld += special ? cashForTax + additional(netCash - cashForTax) : deceased.tagesgeld * share;
    // ER-2: Das Wohnkapital geht im Todesjahr aufs Tagesgeld der überlebenden Person; der übrige Erlös verlässt den Haushalt.
    if (housingCapital > 0) account.tagesgeld += housingCapital;
    portfolio.personAccounts = portfolio.personAccounts.filter(row => row !== deceased);
    const ids = new Set(keys.flatMap(key => portfolio[key] || []).filter(lot => lot.sourceProfileId === survivorProfileId).map(lot => lot.trancheId));
    const taxLots = [];
    const taxShare = special && depot > 0 ? (Math.max(0, proceeds + special.taxCash - netCash)
        - Math.max(0, proceeds - netCash)) / depot : 0;
    for (const key of keys) portfolio[key] = (portfolio[key] || []).flatMap(lot => {
        if ((lot.sourceProfileId || portfolio.simulationSourceProfileId) !== deceasedProfileId) return [lot];
        if (!share) return [];
        let trancheId = lot.trancheId;
        while (trancheId && ids.has(trancheId)) trancheId = `inherited:${encodeURIComponent(deceasedProfileId)}:${trancheId}`;
        ids.add(trancheId);
        const inheritedLot = { ...lot, trancheId, sourceProfileId: survivorProfileId, marketValue: lot.marketValue * share,
            costBasis: lot.costBasis * share, ...(Number.isFinite(lot.shares) ? { shares: lot.shares * share } : {}) };
        if (taxShare > 0 && inheritedLot.marketValue > 0) taxLots.push({ lot: inheritedLot, share: taxShare / share });
        return [inheritedLot];
    });
    portfolio.healthBucketCashOwners = (portfolio.healthBucketCashOwners || []).flatMap(row => row.profileId !== deceasedProfileId ? [row]
        : share ? [{ ...row, profileId: survivorProfileId, amount: row.amount * share }] : []);
    if (status === 'unmarried' || share !== 1) {
        portfolio.healthBucketCashAmount = portfolio.healthBucketCashOwners.reduce((sum, row) => sum + row.amount, 0);
        portfolio.healthBucketGeldmarkt = portfolio.healthBucketCashAmount + portfolio.healthBucketTranches.reduce((sum, row) => sum + row.marketValue, 0);
    }
    portfolio.simulationSourceProfileId = survivorProfileId;
    syncPersonalLiquidity(portfolio);
    const taxSources = realizeInheritedTaxCash(portfolio, survivorProfileId, taxLots);
    if (special && reserveCash * taxShare > 0) {
        let release = reserveCash * taxShare;
        for (const row of portfolio.healthBucketCashOwners) if (row.profileId === survivorProfileId) {
            const take = Math.min(row.amount, release); row.amount -= take; release -= take;
            account.tagesgeld += take;
        }
    }
    if (taxShare > 0) {
        portfolio.healthBucketCashAmount = portfolio.healthBucketCashOwners.reduce((sum, row) => sum + row.amount, 0);
        portfolio.healthBucketGeldmarkt = portfolio.healthBucketCashAmount + portfolio.healthBucketTranches.reduce((sum, row) => sum + row.marketValue, 0);
        syncPersonalLiquidity(portfolio);
    }
    const protectsReserve = tax > 0 && reserveTarget && [...portfolio.depotTranchesAktien, ...portfolio.depotTranchesGold]
        .some(lot => lot.sourceProfileId === survivorProfileId && lot.marketValue > 1e-9);
    const payment = status !== 'unmarried' && tax === 0
        ? { paidCost: 0, extraTax: 0, paidTax: 0, sources: [], shortfall: 0 }
        : payPersonalExtraCost(portfolio, survivorProfileId, tax, personalInterest, actionResult,
            { cashAlreadyRaised: Boolean(special), jointAssessment: inputs.jointAssessment === true,
                ...(protectsReserve ? { liquidityReserve: reserveTarget(), inheritedTaxCash: special?.taxCash || 0 } : {}) });
    payment.sources.unshift(...taxSources);
    if (payment.funding) {
        const inheritedSaleGross = taxSources.reduce((sum, source) => sum + source.brutto, 0);
        payment.funding.saleGross += inheritedSaleGross;
        const cashUsed = Math.max(0, payment.funding.liquidityUsed - inheritedSaleGross);
        // FR-54: geerbtes Bargeld samt freigegebener Pflegereserve vor eigener Liquidität.
        if (special) payment.funding.inheritedTaxCashUsed = Math.min(cashUsed,
            Math.max(0, special.taxCash - inheritedSaleGross));
        payment.funding.liquidityUsed = cashUsed - (payment.funding.inheritedTaxCashUsed || 0);
        payment.funding.saleUsed = payment.paidCost + payment.paidTax - payment.funding.liquidityUsed
            - (payment.funding.inheritedTaxCashUsed || 0);
    }
    const children = /** @type {{childrenMoneyCut?: number, childrenShortfall?: number}} */ (testament || special || {});
    return { abgang_erben: leaves, healthLeaves: healthAssets * (1 - share), erbschaftsteuer: tax, inheritancePayment: payment,
        ...(housingCapital > 0 ? { wohnkapital: housingCapital } : {}),
        inheritance: { deceasedProfileId, survivorProfileId, percent, assets: remainingAssets, home, inherited, inheritedHome: testament?.home ?? home * homeShare,
            ...(familyHomeExemption > 0 ? { exemptHome: familyHomeExemption } : {}),
            ...(exemptGain > 0 ? { exemptGain } : {}),
            ...(pensionReliefUsed ? { pensionAllowance: { amount: pensionRelief.amount, capital: pensionRelief.capital,
                ...(pensionRelief.missingAge ? { missingAge: true } : {}) } } : {}),
            ...(payment.funding ? { funding: { ...payment.funding, saleTax: payment.extraTax } } : {}),
            ...(testament ? { homeMode: testament.mode, residenceCapital: testament.residenceCapital, moneyShare: share } : {}),
            // FR-96: Kosten und Pflichtteil gelten im Testament und bei Immobilien und Steuergeld.
            ...(estateCosts > 0 ? { estateCosts } : {}),
            ...(children.childrenMoneyCut > 0 ? { childrenMoneyCut: children.childrenMoneyCut } : {}),
            ...(children.childrenShortfall > 0 ? { childrenShortfall: children.childrenShortfall } : {}),
            ...(testament ? {
                ...(testament.rentBequestAnnual > 0 ? { rentBequestAnnual: testament.rentBequestAnnual * inflationFactor } : {}),
                ...(housingCapital > 0 ? { housingCapital, housingCapitalPercent: rule.housingCapitalPercent } : {}),
                ...(portfolio.pendingHousingCapital ? { moveOutYears } : {}),
                ...(testament.mode === 'housing-capital' && !housingCapitalEligible && familyHome > 0 ? { housingCapitalCancelled: true } : {}),
                ...(testament.mode === 'residence' && !residenceEligible ? { residenceIneligible: true } : {}),
                ...(testament.residenceTax ? { residenceTax: { ...testament.residenceTax } } : {}),
                minimumNominal: (rule.minimum || 0) * (rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, inputs, inflationFactor) : 1) } : {}),
            ...(proceeds > 0 ? { homeSaleProceeds: deceased.homeSaleProceeds.map(row => ({ ...row })), inheritedSaleProceeds: proceeds } : {}),
            ...(special ? { taxCash: special.taxCash, taxCashSaleTax: special.taxCashSaleTax, homeAndTax: true } : {}),
            leaves, tax, ...(taxable > 0 ? { taxable } : {}), pensionEnds: deceasedProfileId === inputs.simulationPeople?.[0]?.profileId
                ? pension.rente1BruttoEigen * 2 : pension.rente2BruttoEigen * 2 } };
}
