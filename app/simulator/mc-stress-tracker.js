/** @import {EuroTracker,SimulationLog,StressTracker,NumericBuffers,NumericArray,SimulationState,SimulatorInputs} from '../../typcheck/rechenkern' */
import { quantile } from './simulator-utils.js';
import { computeRunStatsFromSeries } from './simulator-engine-wrapper.js';

/** @param {{preset?:{years?:number}}|null} stressCtxMaster
 * @param {number} initialPortfolioValue
 * @returns {StressTracker} */
export function createMonteCarloStressTracker(stressCtxMaster, initialPortfolioValue) {
    const stressYears = stressCtxMaster?.preset?.years ?? 0;
    return {
        stressYears,
        portfolioValues: stressYears > 0 ? [initialPortfolioValue] : null,
        yearsAbove45: 0,
        cutYears: 0,
        realWithdrawals: stressYears > 0 ? [] : null,
        postStressRecoveryYears: null,
        ruinedInStress: false
    };
}

/** NG-W (W3): Rückgang eines Laufs, dessen Vermögen aufgebraucht ist. */
export const RUIN_DRAWDOWN_PCT = 100;
/** NG-W (W4): Ein Lauf, dessen Entnahmerate bis zu seinem Ende nicht wieder unter 3,5 % fällt, hat keine Erholungsdauer. */
export const STRESS_NO_RECOVERY = -1;

/** @param {StressTracker} tracker
 * @param {number} simulationsJahr
 * @param {number} portfolioValue
 * @param {import('../../typcheck/rechenkern').FinancialLog} logData */
export function recordMonteCarloStressYear(
    tracker,
    simulationsJahr,
    portfolioValue,
    logData,
    { realWithdrawalObserved = true } = {}
) {
    if (tracker.stressYears <= 0) return;

    if (simulationsJahr < tracker.stressYears) {
        /** @type {number[]} */ (tracker.portfolioValues).push(portfolioValue);

        if (logData.entnahmequote * 100 > 4.5) {
            tracker.yearsAbove45++;
        }
        if (logData.flex_wunsch_haushalt_nominal > 0 && logData.entscheidung.kuerzungProzent > 10) {
            tracker.cutYears++;
        }
        if (realWithdrawalObserved && Number.isFinite(Number(logData.jahresentnahme_real))) {
            /** @type {number[]} */ (tracker.realWithdrawals).push(Number(logData.jahresentnahme_real));
        }
        return;
    }

    if (tracker.postStressRecoveryYears === null && logData.entnahmequote * 100 < 3.5) {
        tracker.postStressRecoveryYears = simulationsJahr - (tracker.stressYears - 1);
    }
}

/** NG-W (W3): Ist das Vermögen in der Stressphase aufgebraucht, zählt der Lauf dort mit 100 % Rückgang.
 * @param {StressTracker} tracker
 * @param {number} simulationsJahr */
export function recordMonteCarloStressRuin(tracker, simulationsJahr) {
    if (tracker?.stressYears > 0 && simulationsJahr < tracker.stressYears) tracker.ruinedInStress = true;
}

/** @param {StressTracker} tracker
 * @param {number} simulationsJahr */
export function recordMonteCarloStressZeroWithdrawal(tracker, simulationsJahr) {
    if (tracker?.stressYears > 0 && simulationsJahr < tracker.stressYears) {
        /** @type {number[]} */ (tracker.realWithdrawals).push(0);
    }
}

/** @param {StressTracker} tracker
 * @param {number} index
 * @param {NumericArray} stress_maxDrawdowns
 * @param {NumericArray} stress_timeQuoteAbove45
 * @param {NumericArray} stress_cutYears
 * @param {NumericArray} stress_CaR_P10_Real
 * @param {NumericArray} stress_recoveryYears */
export function writeMonteCarloStressMetrics(
    tracker,
    index,
    stress_maxDrawdowns,
    stress_timeQuoteAbove45,
    stress_cutYears,
    stress_CaR_P10_Real,
    stress_recoveryYears
) {
    if (tracker.stressYears > 0) {
        const { maxDDpct: stressMaxDD } = computeRunStatsFromSeries(tracker.portfolioValues);
        stress_maxDrawdowns[index] = tracker.ruinedInStress ? RUIN_DRAWDOWN_PCT : stressMaxDD;
        stress_timeQuoteAbove45[index] = (tracker.yearsAbove45 / tracker.stressYears) * 100;
        stress_cutYears[index] = tracker.cutYears;
        stress_CaR_P10_Real[index] = /** @type {number[]} */ (tracker.realWithdrawals).length > 0
            ? /** @type {import('../../typcheck/rechenkern-integration').Quantile} */ (quantile)(/** @type {number[]} */ (tracker.realWithdrawals), 0.10)
            : 0;
        stress_recoveryYears[index] = tracker.postStressRecoveryYears === null
            ? STRESS_NO_RECOVERY
            : tracker.postStressRecoveryYears;
        return;
    }

    stress_maxDrawdowns[index] = 0;
    stress_timeQuoteAbove45[index] = 0;
    stress_cutYears[index] = 0;
    stress_CaR_P10_Real[index] = 0;
    stress_recoveryYears[index] = 0;
}

/** NG-W (W4): Nur erholte Läufe gehen in den Median der Erholungsdauer ein; Läufe ohne Erholung zählen getrennt.
 * Ohne Stressphase bleibt das bisherige Ergebnis (Median 0).
 * @param {NumericArray} values Erholungsjahre je Lauf aus writeMonteCarloStressMetrics.
 * @param {boolean} stressActive
 * @returns {{p50: number|null, recoveredCount?: number, noRecoveryCount?: number}} */
export function summarizeStressRecovery(values, stressActive) {
    const median = /** @type {import('../../typcheck/rechenkern-integration').Quantile} */ (quantile);
    if (!stressActive) return { p50: median(values, 0.50) };
    const recovered = Array.from(values).filter(value => value > 0);
    const noRecoveryCount = Array.from(values).filter(value => value === STRESS_NO_RECOVERY).length;
    return { p50: recovered.length > 0 ? median(recovered, 0.50) : null, recoveredCount: recovered.length, noRecoveryCount };
}
