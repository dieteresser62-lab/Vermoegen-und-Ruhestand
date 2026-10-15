import { applySaleToPortfolio } from './simulator-portfolio.js';
import { buildDetailedTranchesFromPortfolio } from './simulator-engine-direct-utils.js';
import { addTaxRawAggregate } from './simulator-tax-recompute.js';
import { appendBondReplenishment, isBondCategory, sumBondBucketValuation } from '../../engine/transactions/three-bucket-logic.mjs';

export const BOND_REFILL_PATCH_VERSION = 'bond-refill-equity-sale-guard-20260531-1';

function findOrCreateBondTranche(depotTranchesAktien, sourceProfileId = null) {
    let bondTranche = depotTranchesAktien.find(t => (isBondCategory(t.type) || isBondCategory(t.category))
        && (!sourceProfileId || t.sourceProfileId === sourceProfileId));
    if (!bondTranche) {
        bondTranche = {
            type: 'anleihe',
            category: 'bonds',
            trancheId: depotTranchesAktien.some(lot => lot.trancheId === 'BOND_BUCKET_AUTO')
                ? `BOND_BUCKET_AUTO:${sourceProfileId}` : 'BOND_BUCKET_AUTO',
            sourceProfileId,
            marketValue: 0,
            costBasis: 0,
            isin: 'BOND_BUCKET_AUTO',
            name: 'Auto-Bond-Puffer'
        };
        depotTranchesAktien.push(bondTranche);
    }
    return bondTranche;
}

// Die Jahresaktion enthält bereits Verkauf und Steuerreserve. Hier nur kaufen.
export function buyPlannedBonds(portfolio, amount, profileId = portfolio.simulationSourceProfileId) {
    if (!(amount > 0)) return;
    const tranche = findOrCreateBondTranche(portfolio.depotTranchesAktien, profileId);
    tranche.marketValue += amount;
    tranche.costBasis += amount;
    if (tranche.simulationLotStatus === 'sold') tranche.simulationLotStatus = 'open';
}

/**
 * Compatibility adapter for isolated callers. The annual simulator executes the
 * complete engine action instead; planning stays in appendBondReplenishment.
 */
export function applyBondRefillPostprocessing({
    is3Bucket,
    isBadYear,
    threeBucketInput,
    jahresEntnahmeTarget,
    netFloorYear,
    portfolio,
    depotTranchesAktien,
    engineInput,
    market,
    combinedTaxRawAggregate,
    captureTransactions = false
}) {
    if (!(is3Bucket && !isBadYear && threeBucketInput.bondTargetFactor > 0)) {
        return {
            bondRefillGrossDelta: 0,
            bondRefillNetDelta: 0,
            bondRefillTaxDelta: 0,
            didForcedSale: false,
            ...(captureTransactions ? { transactionDiagnostic: null } : {})
        };
    }

    const detailedTranches = buildDetailedTranchesFromPortfolio(portfolio);
    const planned = appendBondReplenishment(
        detailedTranches,
        { ...engineInput,
            floorBedarf: netFloorYear,
            renteAktiv: false,
            decumulation: { mode: '3_bucket_jilge',
                bondTargetFactor: threeBucketInput.bondTargetFactor,
                drawdownTrigger: -15,
                bondRefillThreshold: threeBucketInput.bondRefillThresholdPct } },
        { type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0 },
        0, jahresEntnahmeTarget, sumBondBucketValuation(depotTranchesAktien), market
    );
    const delta = planned.addedActionDelta;
    if (!delta) return {
        bondRefillGrossDelta: 0, bondRefillNetDelta: 0, bondRefillTaxDelta: 0,
        didForcedSale: false,
        ...(captureTransactions ? { transactionDiagnostic: null } : {})
    };
    const refillBreakdown = delta.quellen;
    const refillNet = planned.bondReplenishmentAmount;
    const refillSale = {
        bruttoVerkaufGesamt: refillBreakdown.reduce((sum, source) => sum + source.brutto, 0),
        steuerGesamt: delta.steuer,
        achievedRefill: delta.nettoErlös,
        breakdown: refillBreakdown
    };
    applySaleToPortfolio(portfolio, refillSale);
    buyPlannedBonds(portfolio, refillNet);
    portfolio.liquiditaet = (Number(portfolio.liquiditaet) || 0) + delta.verwendungen.liquiditaet;
    addTaxRawAggregate(combinedTaxRawAggregate, delta.taxRawAggregate);
    const saleShortfallGross = 0;

    const transactionBreakdown = refillBreakdown.map(item => ({
        assetClass: item?.category || item?.kind || 'equity',
        grossEur: Number(item?.brutto) || 0,
        netEur: typeof item?.netto === 'number' && Number.isFinite(item.netto) && item.netto >= 0
            ? item.netto
            : null,
        taxEur: typeof item?.steuer === 'number' && Number.isFinite(item.steuer) && item.steuer >= 0
            ? item.steuer
            : null
    }));
    const transactionMissingness = transactionBreakdown.flatMap((item, breakdownIndex) => [
        ...(item.netEur === null ? [{
            scope: 'breakdown',
            breakdownIndex,
            assetClass: item.assetClass,
            field: 'netEur',
            reason: 'bond_refill_breakdown_net_not_reported'
        }] : []),
        ...(item.taxEur === null ? [{
            scope: 'breakdown',
            breakdownIndex,
            assetClass: item.assetClass,
            field: 'taxEur',
            reason: 'bond_refill_breakdown_tax_not_reported'
        }] : [])
    ]);

    return {
        bondRefillGrossDelta: Number(refillSale.bruttoVerkaufGesamt) || 0,
        bondRefillNetDelta: refillNet,
        bondRefillTaxDelta: Number(refillSale.steuerGesamt) || 0,
        didForcedSale: true,
        debugVersion: BOND_REFILL_PATCH_VERSION,
        saleShortfallGross,
        ...(captureTransactions ? { transactionDiagnostic: {
            class: 'bond_refill_sale',
            phase: 'after_bond_refill',
            oracle: 'bond_refill_sale_result_v1',
            requestedNetEur: refillNet,
            grossEur: Number(refillSale.bruttoVerkaufGesamt) || 0,
            netEur: refillNet,
            taxEur: Number(refillSale.steuerGesamt) || 0,
            breakdown: transactionBreakdown,
            missingness: transactionMissingness
        } } : {})
    };
}
