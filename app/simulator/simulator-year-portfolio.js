/**
 * Module: Simulator Year Portfolio
 * Purpose: DOM-free market and portfolio progression helpers for one simulator year.
 */
"use strict";

import { sumDepot } from './simulator-portfolio.js';
import { resolveCapeRatio } from './simulator-engine-direct-utils.js';
import { isBondCategory, sumBondBucketValuation } from '../../engine/transactions/three-bucket-logic.mjs';
import { netEquityReturn } from '../../engine/planners/equity-cost.mjs';

/** FR-76: Vorgabe der laufenden Kosten eines breiten Welt-Aktien-ETF in % pro Jahr (Herleitung: DATA_SOURCES.md); liegt in einem leichten Modul. */
export { DEFAULT_EQUITY_COST_PCT } from '../shared/equity-cost-default.js';

/** FR-76: Aktienrendite eines Jahres nach Fondskosten, (1 + r) × (1 − k) − 1. Dieselbe Formel mindert in der Engine
 * die erwartete Rendite des Dynamic Flex. Fehlt der Wert in direkt gebauten Eingaben, gilt 0. */
export { netEquityReturn };

/**
 * @param [yearData] Historische Jahresdaten.
 * @param {unknown} [equityCostPct] Laufende Kosten Aktien-ETF in % pro Jahr (FR-76).
 * @returns Ergebnis der Operation.
 */
export function readYearReturnRates(yearData = {}, equityCostPct = 0) {
    return {
        // Einziger Ort, an dem aus der Marktreihe die Aktienrendite des Depots wird; Gold und Geldmarkt ohne Kosten.
        rA: netEquityReturn(isFinite(yearData.rendite) ? yearData.rendite : 0, equityCostPct),
        rG: isFinite(yearData.gold_eur_perf) ? yearData.gold_eur_perf / 100 : 0,
        rC: isFinite(yearData.zinssatz) ? yearData.zinssatz / 100 : 0
    };
}

/**
 * Mutates the passed portfolio by applying this year's equity/bond/gold returns.
 *
 * @param {object} options
 * @param options.portfolio
 * @param options.yearData
 * @param options.threeBucketInput
 * @param {unknown} [options.equityCostPct] Laufende Kosten Aktien-ETF in % pro Jahr.
 * @returns Ergebnis der Operation.
 */
export function applyAnnualReturnsToPortfolio({ portfolio, yearData, threeBucketInput, equityCostPct = 0 }) {
    const { rA, rG, rC } = readYearReturnRates(yearData, equityCostPct);
    const depotTranchesAktien = portfolio.depotTranchesAktien || [];
    const depotTranchesGold = portfolio.depotTranchesGold || [];
    const bondBucketBefore = sumBondBucketValuation(depotTranchesAktien);
    const equityBeforeReturn = sumDepot({ depotTranchesAktien });
    const goldBeforeReturn = sumDepot({ depotTranchesGold });

    for (let i = 0; i < depotTranchesAktien.length; i++) {
        const tranche = depotTranchesAktien[i];
        const isBond = isBondCategory(tranche.type) || isBondCategory(tranche.category);
        const trancheReturn = isBond ? rC : rA;
        tranche.marketValue *= (1 + trancheReturn);
    }
    for (let i = 0; i < depotTranchesGold.length; i++) {
        depotTranchesGold[i].marketValue *= (1 + rG);
    }

    return {
        rA,
        rG,
        rC,
        bondBucketBefore,
        equityBeforeReturn,
        goldBeforeReturn,
        equityAfterReturn: sumDepot({ depotTranchesAktien }),
        goldAfterReturn: sumDepot({ depotTranchesGold })
    };
}

/**
 * @param {object} options
 * @param options.yearData
 * @param options.inputs
 * @param options.marketDataHist
 * @param options.rA
 * @returns Ergebnis der Operation.
 */
export function buildCurrentYearMarketData({ yearData, inputs, marketDataHist, rA }) {
    const resolvedCapeRatio = resolveCapeRatio(
        yearData.capeRatio,
        inputs.capeRatio,
        inputs.marketCapeRatio ?? marketDataHist.capeRatio
    );
    const marketEnd = marketDataHist.endeVJ * (1 + rA);
    return {
        resolvedCapeRatio,
        marketEnd,
        marketDataCurrentYear: {
            ...marketDataHist,
            inflation: yearData.inflation,
            capeRatio: resolvedCapeRatio,
            endeVJ_3: marketDataHist.endeVJ_2,
            endeVJ_2: marketDataHist.endeVJ_1,
            endeVJ_1: marketDataHist.endeVJ,
            endeVJ: marketEnd,
            ath: Math.max(marketDataHist.ath ?? marketDataHist.endeVJ, marketEnd),
            jahreSeitAth: marketEnd >= (marketDataHist.ath ?? marketDataHist.endeVJ)
                ? 0 : (marketDataHist.jahreSeitAth ?? 0) + 1
        }
    };
}

/**
 * @param {object} options
 * @param options.marketDataHist
 * @param options.yearData
 * @param options.rA
 * @param options.resolvedCapeRatio
 * @returns Ergebnis der Operation.
 */
export function buildNextMarketDataHist({ marketDataHist, yearData, rA, resolvedCapeRatio }) {
    const marketEnd = marketDataHist.endeVJ * (1 + rA);
    const newAth = Math.max(marketDataHist.ath, marketEnd);
    return {
        endeVJ: marketEnd,
        endeVJ_1: marketDataHist.endeVJ,
        endeVJ_2: marketDataHist.endeVJ_1,
        endeVJ_3: marketDataHist.endeVJ_2,
        ath: newAth,
        jahreSeitAth: (marketEnd < newAth) ? marketDataHist.jahreSeitAth + 1 : 0,
        inflation: yearData.inflation,
        capeRatio: resolvedCapeRatio
    };
}
