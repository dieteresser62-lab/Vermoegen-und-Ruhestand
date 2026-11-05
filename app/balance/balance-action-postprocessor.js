/**
 * Module: Balance Action Postprocessor
 * Purpose: Exposes the already finalized Balance action and 3-bucket diagnosis.
 */
"use strict";

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{inputData?: import('../../typcheck/balance-ui.js').Input, modelResult: import('../../typcheck/rechenkern.js').EngineSuccess, profilverbundRuns: import('../../typcheck/balance-ui.js').ProfileRuns, mergeProfilverbundActions: (runs: import('../../typcheck/balance-ui.js').ProfileRuns)=>import('../../typcheck/rechenkern.js').Action}} options @returns Diagnose der abgeschlossenen Aktion. */
export function postprocessBalanceAction({ modelResult, profilverbundRuns, mergeProfilverbundActions }) {
    if (profilverbundRuns && modelResult.ui) {
        modelResult.ui.action = mergeProfilverbundActions(profilverbundRuns);
        return { threeBucketDiagnosis: profilverbundRuns.threeBucketDiagnosis || null };
    }

    return { threeBucketDiagnosis: modelResult?.ui?.threeBucket || null };
}
