import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { resolveTrancheSplitTotals, buildProfileOwnedTranches } from './tranches.js';
import { aggregateProfileHealthBuckets } from '../profile-state.js';
import { calculateProfileGoldStrategy } from '../profile-asset-values.js';

// Aggregiere Profilverbund-Werte (Bedarf, Rente, Depot, etc.)
export function aggregateProfilverbundInputs(profileInputs, overrides = {}) {
    const list = Array.isArray(profileInputs) ? profileInputs : [];
    const totals = list.reduce((acc, entry) => {
        const inputs = entry.inputs || {};
        const floor = inputs.floorBedarf || 0;
        const flex = inputs.flexBedarf || 0;
        const flexBudgetAnnual = inputs.flexBudgetAnnual || 0;
        const flexBudgetRecharge = inputs.flexBudgetRecharge || 0;
        const flexBudgetYears = inputs.flexBudgetYears || 0;
        const renteMonatlich = inputs.renteAktiv ? (inputs.renteMonatlich || 0) : 0;
        acc.totalFloor += floor;
        acc.totalFlex += flex;
        acc.totalFlexBudgetAnnual += flexBudgetAnnual;
        acc.totalFlexBudgetRecharge += flexBudgetRecharge;
        acc.totalRenteMonatlich += renteMonatlich;
        acc.totalTagesgeld += inputs.tagesgeld || 0;
        acc.totalGeldmarkt += inputs.geldmarktEtf || 0;
        acc.totalDepotAlt += inputs.depotwertAlt || 0;
        acc.totalDepotNeu += inputs.depotwertNeu || 0;
        acc.totalGold += inputs.goldWert || 0;
        acc.liquidityRunwayYears = acc.liquidityRunwayYears === null
            ? resolveLiquidityRunwayYears(inputs).years
            : Math.min(acc.liquidityRunwayYears, resolveLiquidityRunwayYears(inputs).years);
        acc.flexBudgetYears = acc.flexBudgetYears === null ? flexBudgetYears : Math.min(acc.flexBudgetYears, flexBudgetYears || acc.flexBudgetYears || 0);
        return acc;
    }, {
        totalFloor: 0,
        totalFlex: 0,
        totalFlexBudgetAnnual: 0,
        totalFlexBudgetRecharge: 0,
        totalRenteMonatlich: 0,
        totalTagesgeld: 0,
        totalGeldmarkt: 0,
        totalDepotAlt: 0,
        totalDepotNeu: 0,
        totalGold: 0,
        liquidityRunwayYears: null,
        flexBudgetYears: null
    });

    const overrideFloor = Number.isFinite(overrides.floorBedarf) ? overrides.floorBedarf : null;
    const overrideFlex = Number.isFinite(overrides.flexBedarf) ? overrides.flexBedarf : null;
    const overrideFlexBudgetAnnual = Number.isFinite(overrides.flexBudgetAnnual) ? overrides.flexBudgetAnnual : null;
    const overrideFlexBudgetRecharge = Number.isFinite(overrides.flexBudgetRecharge) ? overrides.flexBudgetRecharge : null;
    const overrideFlexBudgetYears = Number.isFinite(overrides.flexBudgetYears) ? overrides.flexBudgetYears : null;
    const totalFloor = overrideFloor !== null ? overrideFloor : totals.totalFloor;
    const totalFlex = overrideFlex !== null ? overrideFlex : totals.totalFlex;
    const totalFlexBudgetAnnual = overrideFlexBudgetAnnual !== null ? overrideFlexBudgetAnnual : totals.totalFlexBudgetAnnual;
    const totalFlexBudgetRecharge = overrideFlexBudgetRecharge !== null ? overrideFlexBudgetRecharge : totals.totalFlexBudgetRecharge;
    const totalFlexBudgetYears = overrideFlexBudgetYears !== null ? overrideFlexBudgetYears : (totals.flexBudgetYears || 0);
    const totalBedarf = totalFloor + totalFlex;
    const totalRente = totals.totalRenteMonatlich * 12;
    const netWithdrawal = Math.max(0, totalBedarf - totalRente);
    const totalDepot = totals.totalDepotAlt + totals.totalDepotNeu + totals.totalGold;
    const totalLiquid = totals.totalTagesgeld + totals.totalGeldmarkt;
    const totalAssets = totalDepot + totalLiquid;

    return {
        profilesCount: list.length,
        totalFloor,
        totalFlex,
        totalFlexBudgetAnnual,
        totalFlexBudgetRecharge,
        totalFlexBudgetYears,
        totalBedarf,
        totalRenteMonatlich: totals.totalRenteMonatlich,
        totalRenteJahr: totalRente,
        netWithdrawal,
        totalDepotAlt: totals.totalDepotAlt,
        totalDepotNeu: totals.totalDepotNeu,
        totalGold: totals.totalGold,
        totalDepot,
        totalTagesgeld: totals.totalTagesgeld,
        totalGeldmarkt: totals.totalGeldmarkt,
        totalLiquid,
        totalAssets,
        liquidityRunwayYears: totals.liquidityRunwayYears ?? 5
    };
}

// Ermittelt den gemeinsamen Haushaltsbedarf, bevor Finanzierungsprofile betrachtet werden.
export function calculateHouseholdWithdrawalNeed(profileInputs, overrides = {}) {
    const aggregated = aggregateProfilverbundInputs(profileInputs, overrides);
    // FR-72 Punkt 10 / FR-73 B9: persönliche Pflegekosten unverheirateter Personen bleiben bei der Person.
    const personal = (Array.isArray(profileInputs) ? profileInputs : []).filter(entry => entry.personalCareNeed > 0);
    return {
        ...aggregated,
        grossNeed: aggregated.totalBedarf,
        incomeAnnual: aggregated.totalRenteJahr,
        netWithdrawal: Math.max(0, aggregated.totalBedarf - aggregated.totalRenteJahr),
        ...(personal.length ? { personalNeeds: Object.fromEntries(personal.map(entry => [entry.profileId, entry.personalCareNeed])) } : {})
    };
}

export function buildProfilverbundAssetSummary(profileInputs) {
    const list = Array.isArray(profileInputs) ? profileInputs : [];
    const goldProfileEntries = [];
    const summary = {
        totalTagesgeld: 0,
        totalGeldmarkt: 0,
        totalDepotAlt: 0,
        totalDepotNeu: 0,
        totalGold: 0,
        totalCostAlt: 0,
        totalCostNeu: 0,
        totalGoldCost: 0,
        totalRenteMonatlich: 0,
        mergedTranches: [],
        primaryHealthBucket: null
    };

    list.forEach(entry => {
        const inputs = entry.inputs || {};
        const tranches = Array.isArray(entry.tranches) ? entry.tranches : [];
        const split = resolveTrancheSplitTotals(tranches);
        const hasTranches = entry.hasExplicitTrancheOverride
            || (tranches.length > 0 && (split.altValue + split.neuValue + split.goldValue + split.moneyValue) > 0);

        summary.totalTagesgeld += inputs.tagesgeld || 0;
        summary.totalRenteMonatlich += inputs.renteAktiv ? (inputs.renteMonatlich || 0) : 0;

        if (hasTranches) {
            summary.totalDepotAlt += split.altValue;
            summary.totalDepotNeu += split.neuValue;
            summary.totalGold += split.goldValue;
            summary.totalGeldmarkt += split.moneyValue;
            summary.totalCostAlt += split.altCost;
            summary.totalCostNeu += split.neuCost;
            summary.totalGoldCost += split.goldCost;
        } else {
            summary.totalDepotAlt += inputs.depotwertAlt || 0;
            summary.totalDepotNeu += inputs.depotwertNeu || 0;
            summary.totalGold += inputs.goldWert || 0;
            summary.totalGeldmarkt += inputs.geldmarktEtf || 0;
            summary.totalCostAlt += inputs.costBasisAlt || 0;
            summary.totalCostNeu += inputs.costBasisNeu || 0;
            summary.totalGoldCost += inputs.goldCost || 0;
        }

        const profileTagesgeld = Math.max(0, Number(inputs.tagesgeld) || 0);
        const profileGeldmarkt = hasTranches
            ? split.moneyValue
            : Math.max(0, Number(inputs.geldmarktEtf) || 0);
        const profileAssetBase = (hasTranches
            ? split.altValue + split.neuValue + split.goldValue + split.moneyValue
            : (Number(inputs.depotwertAlt) || 0)
                + (Number(inputs.depotwertNeu) || 0)
                + (Number(inputs.goldWert) || 0)
                + profileGeldmarkt)
            + profileTagesgeld;
        goldProfileEntries.push({
            profileId: entry.profileId,
            name: entry.name,
            assetBase: profileAssetBase,
            operativeLiquidity: profileTagesgeld + profileGeldmarkt,
            healthBucket: entry.healthBucket || inputs.healthBucket,
            goldAktiv: inputs.goldAktiv,
            goldZielProzent: inputs.goldZielProzent,
            goldFloorProzent: inputs.goldFloorProzent,
            goldSteuerfrei: inputs.goldSteuerfrei,
            rebalancingBand: inputs.rebalancingBand
        });

        summary.mergedTranches.push(...buildProfileOwnedTranches(entry));
    });

    summary.primaryHealthBucket = aggregateProfileHealthBuckets(
        list.map(entry => entry.healthBucket || entry.inputs?.healthBucket)
    ).healthBucket;
    summary.goldStrategy = calculateProfileGoldStrategy(goldProfileEntries);
    return summary;
}

export function buildProfilverbundProfileSummaries(profileInputs) {
    const list = Array.isArray(profileInputs) ? profileInputs : [];
    return list.map(entry => {
        const inputs = entry.inputs || {};
        const tranches = Array.isArray(entry.tranches) ? entry.tranches : [];
        const split = resolveTrancheSplitTotals(tranches);
        const hasTranches = entry.hasExplicitTrancheOverride
            || (tranches.length > 0 && (split.altValue + split.neuValue + split.goldValue + split.moneyValue) > 0);

        const depotAlt = hasTranches ? split.altValue : (inputs.depotwertAlt || 0);
        const depotNeu = hasTranches ? split.neuValue : (inputs.depotwertNeu || 0);
        const gold = hasTranches ? split.goldValue : (inputs.goldWert || 0);
        const geldmarkt = hasTranches ? split.moneyValue : (inputs.geldmarktEtf || 0);
        const tagesgeld = inputs.tagesgeld || 0;
        const totalAssets = depotAlt + depotNeu + gold + geldmarkt + tagesgeld;

        return {
            profileId: entry.profileId,
            name: entry.name || entry.profileId,
            tagesgeld,
            geldmarkt,
            depotAlt,
            depotNeu,
            gold,
            totalAssets
        };
    });
}
