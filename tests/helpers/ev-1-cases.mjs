// Ausschließlich erfundene Bestände für FR-67.
export function paymentPortfolio({ cash = 90000, moneyMarket = 60000, depot = 800000, gain = .5 } = {}) {
    const lot = (id, value, category) => ({ schemaVersion: 2, trancheId: id, sourceProfileId: 'erika',
        type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu', category,
        marketValue: value, costBasis: value * (1 - gain), shares: value, currentPrice: 1,
        purchasePrice: 1 - gain, purchaseDate: '2018-01-01', tqf: category === 'money_market' ? 0 : .3 });
    return { simulationSourceProfileId: 'erika', personAccounts: [{ profileId: 'erika', tagesgeld: cash,
        geldmarktEtf: moneyMarket, sparerPauschbetrag: 1000, taxState: { lossCarry: 0 }, kirchensteuerSatz: 0 }],
        depotTranchesAktien: depot ? [lot('aktien', depot, 'equity')] : [], depotTranchesGold: [],
        depotTranchesGeldmarkt: moneyMarket ? [lot('geldmarkt', moneyMarket, 'money_market')] : [],
        tagesgeld: cash, geldmarktEtf: moneyMarket, liquiditaet: cash + moneyMarket };
}
export const paymentInterest = { items: [{ profileId: 'erika', cashInterest: 0 }] };

export function noDepotInheritance(applyInheritance, beginTaxYear) {
    const portfolio = paymentPortfolio({ cash: 180000, moneyMarket: 0, depot: 0 });
    portfolio.personAccounts.push({ ...portfolio.personAccounts[0], profileId: 'max', tagesgeld: 240000 });
    portfolio.tagesgeld = portfolio.liquiditaet = 420000;
    portfolio.healthBucketTranches = [];
    portfolio.healthBucketCashOwners = [];
    beginTaxYear(portfolio);
    const action = { steuer: 0 };
    const result = applyInheritance({ portfolio, transition: { deathThisYear: true,
        survivor: { deceasedProfileId: 'max', survivorProfileId: 'erika', deathYearIndex: 0 } },
        inputs: { partnership: { status: 'unmarried', inheritance: { max: 50 } },
            simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }],
            referenceYear: 2026, startAlter: 70, partner: { aktiv: true, startAlter: 65 } },
        inflationFactor: 1, pension: { rente1BruttoEigen: 0 }, personalInterest: paymentInterest,
        actionResult: action, household: { p1Alive: false, p2Alive: true },
        reserveTarget: () => { throw new Error('Ohne Depot wird kein neues Reserveziel berechnet.'); } });
    return { portfolio, action, result };
}
