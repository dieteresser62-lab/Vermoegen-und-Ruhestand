// @ts-check
/** @import {SimulatorInputs,SimulationPortfolio,HistoricalYear,RuinOptions} from '../../../typcheck/rechenkern' */
import { sumDepot } from '../simulator-portfolio.js';
import { euros, signedEuros } from '../simulator-engine-direct-utils.js';
import { sumBondBucketValuation } from '../../../engine/transactions/three-bucket-logic.mjs';
import { applyHealthBucketInterest, buildHealthBucketDiagnostics } from '../simulator-health-bucket.js';
import { buildRuinOutcome } from './outcomes.js';
/** @param {RuinOptions} options
 * @param {{inputs:SimulatorInputs;cumulativeInflationFactor:number;yearData:HistoricalYear;
 * healthBucketInterest:Pick<ReturnType<typeof applyHealthBucketInterest>,'startAmount'|'interest'>|null;
 * healthBucketCoverage:ReturnType<import('../../../typcheck/rechenkern-integration').ApplyHealthBucketCoverage>|null}} context */
export function ruinOutcome(options, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage }) {
    const diagnostics = buildHealthBucketDiagnostics({ inputs, portfolio: options.portfolio,
        cumulativeInflationFactor: healthBucketInterest
            ? cumulativeInflationFactor * (1 + yearData.inflation / 100) : cumulativeInflationFactor });
    return buildRuinOutcome({ ...options, healthBucketLog: diagnostics.enabled ? {
        health_bucket_enabled: true,
        health_bucket_start: euros(healthBucketCoverage?.startAmount ?? healthBucketInterest?.startAmount ?? diagnostics.currentAmount),
        health_bucket_triggered: !!healthBucketCoverage?.triggered,
        health_bucket_reason: healthBucketCoverage?.reason || '',
        health_bucket_eligible_need: euros(healthBucketCoverage?.eligibleNeed),
        health_bucket_used: euros(healthBucketCoverage?.used),
        health_bucket_uncovered_need: euros(healthBucketCoverage?.uncoveredNeed),
        health_bucket_interest: signedEuros(healthBucketInterest?.interest),
        health_bucket_end: diagnostics.currentAmount,
        health_bucket_real_coverage_pct: diagnostics.realCoveragePct,
        health_bucket_target_gap: diagnostics.targetGap
    } : null });
}

/** @param {Record<string,unknown>[]} balanceTrace
 * @param {SimulationPortfolio['depotTranchesAktien']} depotTranchesAktien
 * @param {SimulationPortfolio['depotTranchesGold']} depotTranchesGold
 * @param {number} liquiditaet
 * @param {string} phase
 * @param {Record<string,unknown>} extra */
export function snapshotBalance(balanceTrace, depotTranchesAktien, depotTranchesGold, liquiditaet, phase, extra = {}) {
    const equityAndBonds = euros(sumDepot({ depotTranchesAktien }));
    const bonds = euros(sumBondBucketValuation(depotTranchesAktien));
    const gold = euros(sumDepot({ depotTranchesGold }));
    const cash = euros(liquiditaet);
    balanceTrace.push({
        phase,
        total: euros(equityAndBonds + gold + cash),
        equity: euros(equityAndBonds - bonds),
        bonds,
        gold,
        cash,
        ...extra
    });
}
