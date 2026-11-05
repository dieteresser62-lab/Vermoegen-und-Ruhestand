"use strict";



function sumTranches(tranches) {
    return Array.isArray(tranches)
        ? tranches.reduce((sum, tranche) => sum + (Number(tranche?.marketValue) || 0), 0)
        : 0;
}

export function readPortfolioParts(portfolio) {
    return {
        wertAktien: sumTranches(portfolio?.depotTranchesAktien),
        wertGold: sumTranches(portfolio?.depotTranchesGold),
        liquiditaet: Number(portfolio?.liquiditaet) || 0,
        healthBucketEnd: Number(portfolio?.healthBucketGeldmarkt) || 0
    };
}

function readHealthBucketTotal(portfolio) {
    const value = Number(portfolio?.healthBucketGeldmarkt);
    return Number.isFinite(value) ? value : 0;
}

export function computeCanonicalPortfolioTotal(computeActivePortfolioTotal, portfolio) {
    const activeTotal = Number(computeActivePortfolioTotal(portfolio));
    if (!Number.isFinite(activeTotal)) return null;
    return activeTotal + readHealthBucketTotal(portfolio);
}

// Bewusst unabhaengig von der injizierten totalPortfolio-Funktion: Dieser
// zweite Rechenweg ist die Evidenz fuer die Exportgrenzen.
export function computeIndependentPortfolioTotal(portfolio) {
    const hasDetailedShape = Array.isArray(portfolio?.depotTranchesAktien)
        || Array.isArray(portfolio?.depotTranchesGold)
        || Object.hasOwn(portfolio || {}, 'liquiditaet');
    const activeTotal = hasDetailedShape
        ? sumTranches(portfolio?.depotTranchesAktien)
            + sumTranches(portfolio?.depotTranchesGold)
            + (Number(portfolio?.liquiditaet) || 0)
        : (Number(portfolio?.value) || 0);
    return activeTotal + readHealthBucketTotal(portfolio);
}
