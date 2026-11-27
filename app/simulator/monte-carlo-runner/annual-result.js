// @ts-check
/** @import {YearSuccess} from '../../../typcheck/rechenkern' */
import { resolveSimulatorCumulativeInflationFactor } from '../simulator-engine-wrapper.js';
import { recordEuroHealthBucketYear, recordEuroZeroWithdrawal } from '../mc-euro-metrics.js';
import { advancePostRuinCarePricing } from './post-ruin.js';
import { recordWealthFanYear } from '../wealth-fan-aggregation.js';
import { recordMonteCarloStressRuin, recordMonteCarloStressZeroWithdrawal } from '../mc-stress-tracker.js';
import { buildMonteCarloRuinLogRow } from '../mc-log-builder.js';
import { BREAK_ON_RUIN } from '../simulator-data.js';
import { recordSuccessfulYear } from './annual-success.js';
import { normalizeTechnicalPathError } from './batch.js';
/** @param {import('./path-state.js').YearContext} context */
export function recordAnnualResult(context) {

    if (context.result?.kind === 'ruin' || /** @type {boolean} */ (context.result?.isRuin) === true) {
        context.failed = true;
        if (context.personEventYears) context.personEventYears.failure ??= context.simulationsJahr;
        if (context.result.logData?.health_bucket_enabled) {
            const startFactor = resolveSimulatorCumulativeInflationFactor(context.simState);
            recordEuroHealthBucketYear(context.euroTracker, context.result.logData, startFactor,
                Number.isFinite(context.yearData.inflation) ? startFactor * (1 + context.yearData.inflation / 100) : NaN);
        }
        if (context.inputs.pflegefallLogikAktivieren || context.inputs.careToday?.grade || context.inputs.partner?.careToday?.grade) {
            context.postRuinCarePricing = advancePostRuinCarePricing(context.simState, context.yearData.inflation);
        }
        if (context.displayHomeValuePath) {
            const home = /** @type {number} */ (context.result.logData?.immobilien_wert_end);
            // @ts-expect-error Muster: Fehlende Inflation wird hier NaN und im Fan als fehlende Beobachtung behandelt.
            const factor = context.result.logData?.inflation_factor_cum * (1 + context.yearData.inflation / 100);
            context.displayHomeValuePath.nominal[context.simulationsJahr + 1] = Number.isFinite(home) ? home : NaN;
            context.displayHomeValuePath.real[context.simulationsJahr + 1] = Number.isFinite(home) && factor > 0 ? home / factor : NaN;
            const self = /** @type {number} */ (context.result.logData?.immobilien_selbst_end);
            context.displayHomeValuePath.selfNominal[context.simulationsJahr + 1] = Number.isFinite(self) ? self : NaN;
            context.displayHomeValuePath.selfReal[context.simulationsJahr + 1] = Number.isFinite(self) && factor > 0 ? self / factor : NaN;
        }
        recordWealthFanYear(context.wealthFanPath, context.simulationsJahr + 1, 0, 0, true);
        recordMonteCarloStressRuin(context.stressTracker, context.simulationsJahr);
        if (!context.isAccumulation) {
            context.realWithdrawalsThisRun.push(0);
            recordEuroZeroWithdrawal(context.euroTracker, context.simulationsJahr);
            recordMonteCarloStressZeroWithdrawal(context.stressTracker, context.simulationsJahr);
        }
        // Bei Ruin ist das Depot definitiv erschöpft - setze Alter
        if (!context.depotErschoepfungAlterGesetzt) {
            context.alterBeiErschoepfung[context.i] = context.ageP1;
            context.alterBeiErschoepfungMissingness[context.i] = 1;
            context.depotErschoepfungAlterGesetzt = true;
        }
        if (context.currentRunLog) context.currentRunLog.push(buildMonteCarloRuinLogRow(/** @type {Parameters<typeof buildMonteCarloRuinLogRow>[0]} */ ({
            result: context.result,
            simulationsJahr: context.simulationsJahr,
            yearData: context.yearData,
            inputs: context.inputs,
            lifeLogContext: context.lifeLogContext,
            tailRiskOverlay: context.tailRiskOverlay
        })));
        if (BREAK_ON_RUIN) return true;
    } else if ((context.result?.kind === undefined || context.result.kind === 'success')
        && context.result?.newState?.portfolio
        && context.result?.logData) {
        recordSuccessfulYear(/** @type {import('./path-state.js').YearContext & {result:import('../../../typcheck/rechenkern').YearSuccess}} */ (context));
    } else {
        context.technicalPathError = normalizeTechnicalPathError(context.result, context.runIdx, context.simulationsJahr);
        return true;
    }
}
