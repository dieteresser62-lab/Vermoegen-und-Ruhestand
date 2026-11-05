/** @import {InheritanceNetProceeds, TestamentEstate} from '../../typcheck/simulator-ui.js' */
/** FR-48/49/51: Nachlass nach den Jahresbuchungen, ohne Verkauf des externen Anteils. */
import { inheritanceTax, inheritancePercent, inheritsHomeAndTax, homeAndTaxEstate, hasTestament, testamentRule, testamentEstate, residenceAnnualValue, hasInheritanceHomes, equalizationAllowance, maritalPropertyRegime } from '../profile/household-partnership.js';
import { initializePortfolio } from './simulator-portfolio-init.js';
import { personalAssetValues } from './simulator-unmarried.js';
import { syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { payPersonalExtraCost, realizeInheritedTaxCash, personalExtraSaleTax } from './simulator-personal-tax.js';
import { GERMAN_CPI_INFLATION_RATES } from './german-cpi-chain.js';
import { inheritanceNetProceeds } from '../profile/household-inheritance-sale.js';
import { isInResidentialCare } from '../shared/care-benefits.js';
import { personDisplayAge } from '../profile/profile-person-data.js';

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
 * @param [options.reserveTarget]
 * @returns Ergebnis der Operation.
 */
export function applyUnmarriedInheritance({ portfolio, transition, inputs, inflationFactor, pension, personalInterest, actionResult, household,
    reserveTarget = null }) {
    if (!transition?.deathThisYear) return null;
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
    if (inputs.partnership.status === 'married' && maritalPropertyRegime(inputs.partnership) === 'community') {
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
    const survivorIndex = inputs.simulationPeople?.findIndex(person => person.profileId === survivorProfileId);
    const deathYearIndex = transition.survivor.deathYearIndex || 0;
    const referenceYear = inputs.residenceReferenceYear ?? inputs.homeReferenceYear ?? inputs.referenceYear;
    const deathAge = personDisplayAge({ profile_geburtsdatum: inputs.simulationPeople?.[survivorIndex]?.geburtsdatum },
        new Date(referenceYear + deathYearIndex, 6, 1));
    const partnerAge = deathAge.status === 'valid' ? deathAge.age
        : (survivorIndex === 0 ? inputs.startAlter : inputs.partner?.startAlter) + deathYearIndex;
    const partnerGender = inputs.simulationPeople?.[survivorIndex]?.residenceGenderUnknown ? undefined
        : survivorIndex === 0 ? inputs.geschlecht : inputs.partner?.geschlecht;
    const residenceEligible = household?.[survivorIndex === 0 ? 'p1Alive' : 'p2Alive'] !== false
        && !isInResidentialCare(inputs, survivorIndex, household);
    const testament = hasTestament(inputs.partnership, deceasedProfileId, hasHomes) ? /** @type {TestamentEstate} */ (testamentEstate)(assets, home,
        homes.filter(row => row.nutzung === 'selbst').reduce((sum, row) => sum + homeValueAtDeath(row, inputs, inflationFactor), 0),
        percent, rule, { status: inputs.partnership.status, maritalPropertyRegime: maritalPropertyRegime(inputs.partnership), gains, partnerAge, partnerGender, residenceEligible, familyHome,
            residenceValue: homes.filter(row => row.nutzung === 'selbst').reduce((sum, row) => {
                const factor = inheritanceReferenceFactor(row.stand, inputs, inflationFactor);
                return sum + residenceAnnualValue(row.wert * factor, row.ortsueblicheMiete === undefined ? undefined : row.ortsueblicheMiete * factor);
            }, 0),
            minimumFactor: rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, inputs, inflationFactor) : 1 }) : null;
    const homeAndTax = home > 0 && inheritsHomeAndTax(inputs.partnership, deceasedProfileId, hasHomes);
    // Der Hauserlös steckt bereits im Geldvermögen: für FR-54 einmalig umordnen.
    const remainingAssets = assets - proceeds;
    const keys = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches'];
    const estateLots = keys.flatMap(key => portfolio[key] || [])
        .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === deceasedProfileId);
    const reserveCash = (portfolio.healthBucketCashOwners || []).filter(row => row.profileId === deceasedProfileId)
        .reduce((sum, row) => sum + row.amount, 0);
    if (reserveCash > 0) estateLots.push({ trancheId: 'estate-reserve-cash', type: 'anleihe', category: 'bonds',
        marketValue: reserveCash, costBasis: reserveCash, taxExempt: true });
    const netProceeds = homeAndTax ? /** @type {InheritanceNetProceeds} */ (inheritanceNetProceeds)({ cash: deceased.tagesgeld,
        tranches: estateLots, reservedHomeProceeds: proceeds, kirchensteuerSatz: account.kirchensteuerSatz,
        saleTax: personalExtraSaleTax(portfolio, survivorProfileId, personalInterest, actionResult) }) : null;
    const special = homeAndTax ? homeAndTaxEstate(remainingAssets, home, percent, netProceeds) : null;
    const cashForTax = special ? Math.min(deceased.tagesgeld, proceeds + special.taxCash) : 0;
    const taxDepotShare = special && assets > deceased.tagesgeld
        ? (proceeds + special.taxCash - cashForTax) / (assets - deceased.tagesgeld) : 0;
    // Hauserlös und X zuerst aus Tagesgeld; nur der Rest aus Depot/Pflegereserve.
    // Danach gilt die zusätzliche Quote für jeden verbliebenen Bestand.
    const share = special ? taxDepotShare + (1 - taxDepotShare) * percent / 100 : testament?.share ?? percent / 100;
    const homeShare = homeAndTax ? 1 : share;
    if (testament) {
        if (testament.residenceTax) portfolio.residenceTax = { ...testament.residenceTax, profileId: survivorProfileId };
        portfolio.homeInheritance = { ...(portfolio.homeInheritance || {}) };
        (inputs.home || []).forEach((row, index) => {
            if (homes.includes(row)) portfolio.homeInheritance[JSON.stringify([row.profileId, row.id ?? index])] = {
                share: testament.mode === 'money' ? share : testament.mode === 'life-estate' && row.nutzung === 'selbst' ? 1 : 0,
                mode: testament.mode,
                ...(testament.mode === 'residence' && row.nutzung === 'selbst' ? { residenceActive: residenceEligible } : {})
            };
        });
    }
    if (!testament && !homeShare && inputs.partnership.status === 'unmarried' && homes.length) {
        portfolio.homeSales = [...(portfolio.homeSales || []), ...(inputs.home || []).flatMap((row, index) =>
            homes.includes(row) ? [JSON.stringify([row.profileId, row.id ?? index])] : [])];
    }
    const exemptHome = familyHome * share;
    const inherited = special?.inherited ?? testament?.inherited ?? assets * share, leaves = remainingAssets - inherited;
    const exemptGain = testament ? testament.exemptGain || 0
        : equalizationAllowance(inputs.partnership, { ...gains, acquisition: inherited + home * homeShare, exemptHome });
    const tax = special?.tax ?? testament?.tax ?? inheritanceTax(inherited + home * homeShare, { status: inputs.partnership.status, exemptHome, exemptGain });
    account.tagesgeld += special ? cashForTax + (deceased.tagesgeld - cashForTax) * percent / 100 : deceased.tagesgeld * share;
    portfolio.personAccounts = portfolio.personAccounts.filter(row => row !== deceased);
    const ids = new Set(keys.flatMap(key => portfolio[key] || []).filter(lot => lot.sourceProfileId === survivorProfileId).map(lot => lot.trancheId));
    const taxLots = [];
    const taxShare = special && assets > deceased.tagesgeld ? (Math.max(0, proceeds + special.taxCash - deceased.tagesgeld)
        - Math.max(0, proceeds - deceased.tagesgeld)) / (assets - deceased.tagesgeld) : 0;
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
    if (inputs.partnership.status !== 'married' || share !== 1) {
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
    const payment = inputs.partnership.status === 'married' && tax === 0
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
    return { abgang_erben: leaves, healthLeaves: healthAssets * (1 - share), erbschaftsteuer: tax, inheritancePayment: payment,
        inheritance: { deceasedProfileId, survivorProfileId, percent, assets: remainingAssets, home, inherited, inheritedHome: testament?.home ?? home * homeShare,
            ...(exemptGain > 0 ? { exemptGain } : {}),
            ...(payment.funding ? { funding: { ...payment.funding, saleTax: payment.extraTax } } : {}),
            ...(testament ? { homeMode: testament.mode, residenceCapital: testament.residenceCapital, moneyShare: share,
                ...(testament.mode === 'residence' && !residenceEligible ? { residenceIneligible: true } : {}),
                ...(testament.residenceTax ? { residenceTax: { ...testament.residenceTax } } : {}),
                minimumNominal: (rule.minimum || 0) * (rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, inputs, inflationFactor) : 1) } : {}),
            ...(proceeds > 0 ? { homeSaleProceeds: deceased.homeSaleProceeds.map(row => ({ ...row })), inheritedSaleProceeds: proceeds } : {}),
            ...(special ? { taxCash: special.taxCash, taxCashSaleTax: special.taxCashSaleTax, homeAndTax: true } : {}),
            leaves, tax, pensionEnds: deceasedProfileId === inputs.simulationPeople?.[0]?.profileId
                ? pension.rente1BruttoEigen * 2 : pension.rente2BruttoEigen * 2 } };
}
