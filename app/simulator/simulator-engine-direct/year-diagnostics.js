// @ts-check
/** @import {SimulatorInputs,SimulationPortfolio,HistoricalYear,RuinOptions} from '../../../typcheck/rechenkern' */
import { sumDepot } from '../simulator-portfolio.js';
import { euros, signedEuros } from '../simulator-engine-direct-utils.js';
import { sumBondBucketValuation } from '../../../engine/transactions/three-bucket-logic.mjs';
import { applyHealthBucketInterest, buildHealthBucketDiagnostics } from '../simulator-health-bucket.js';
import { buildRuinOutcome } from './outcomes.js';
/** @type {((result: any, yearIndex: number) => void)|null} */
let yearOutcomeObserver = null;
/** Nur für Tests und Messungen: beobachtet das endgültige Ergebnis jedes Simulationsjahrs (auch Ruin mit `basicCoverage`).
 * @param {((result: any, yearIndex: number) => void)|null} observer */
export function observeYearOutcomesForTests(observer) { yearOutcomeObserver = observer; }
/** @param {any} result @param {number} yearIndex */
export function notifyYearOutcome(result, yearIndex) { if (yearOutcomeObserver) yearOutcomeObserver(result, yearIndex); }
/** @typedef {(phase: 'begin'|'market'|'payout'|'end', context: any) => void} YearContextObserver */
/** @type {YearContextObserver|null} */
let yearContextObserver = null;
/** NK-3: Nur für Tests (Geldbilanz je Person). Sieht den Jahreskontext zu Beginn, nach den Marktrenditen, nach der Auszahlung und am Ende
 * eines vollständigen Jahresversuchs; ohne Beobachter rechnet nichts anders. @param {YearContextObserver|null} observer */
export function observeYearContextForTests(observer) { yearContextObserver = observer; }
/** @param {'begin'|'market'|'payout'|'end'} phase @param {any} context */
export function notifyYearContext(phase, context) { if (yearContextObserver) yearContextObserver(phase, context); }
/** FR-84: Geldvermögen des Haushalts und Grundbedarf ohne Pflege (nach Renten und Einkünften) am Ruin vermerken, nicht aufzählbar,
 * damit Ergebnisse und Prüfsummen unverändert bleiben. @param {any} outcome @param {any} context */
export function withBasicCoverage(outcome, context) {
    if (outcome?.isRuin && context?.basicCoverage && !Object.hasOwn(outcome, 'basicCoverage')) {
        Object.defineProperty(outcome, 'basicCoverage', { value: context.basicCoverage, enumerable: false });
    }
    return outcome;
}
/** KR-1c (NG-5): `yearEnd` misst die Pflegerücklage in Preisen des Folgejahres (Ruin in der Abrechnung am Jahresende oder im
 * Ansparjahr). Früher hing das am gebuchten Zins; der Zins steht jetzt vor der Entscheidung, die Fortschreibung bleibt gleich.
 * @param {RuinOptions} options
 * @param {{inputs:SimulatorInputs;cumulativeInflationFactor:number;yearData:HistoricalYear;
 * healthBucketInterest:Pick<ReturnType<typeof applyHealthBucketInterest>,'startAmount'|'interest'>|null;
 * healthBucketCoverage:ReturnType<import('../../../typcheck/rechenkern-integration').ApplyHealthBucketCoverage>|null;
 * yearEnd?:boolean}} context */
export function ruinOutcome(options, { inputs, cumulativeInflationFactor, healthBucketInterest, yearData, healthBucketCoverage, yearEnd = false }) {
    const diagnostics = buildHealthBucketDiagnostics({ inputs, portfolio: options.portfolio,
        cumulativeInflationFactor: yearEnd
            ? cumulativeInflationFactor * (1 + yearData.inflation / 100) : cumulativeInflationFactor });
    return buildRuinOutcome({ ...options, healthBucketLog: diagnostics.enabled ? {
        health_bucket_enabled: true,
        // KR-1c: Start ist der Stand vor dem Zins; die Deckung sieht den Topf erst nach dem Zins.
        health_bucket_start: euros(healthBucketInterest?.startAmount ?? healthBucketCoverage?.startAmount ?? diagnostics.currentAmount),
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
