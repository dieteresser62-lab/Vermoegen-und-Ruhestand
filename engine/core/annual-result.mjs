// @ts-check
/** @import {Market,SpendingResult,Action,ThreeBucketState,VpwDiagnostics,NormalizedEngineInput,EngineState,Diagnosis} from '../../typcheck/rechenkern' */
import { _buildLongevityDiagnostics } from './vpw-return.mjs';
/** @param {{depotwertGesamt:number;neuerBedarf:number;minGold:number;zielLiquiditaet:number;market:Market;
 * spendingResult:SpendingResult;action:Action;threeBucketDiagnosis:ThreeBucketState|null;deckungVorher:number;deckungNachher:number;
 * runwayMonths:number;runwayStatus:string;vpwDiagnostics:VpwDiagnostics|null;
 * vpwEffectiveSettings:ReturnType<typeof import('./vpw-safety.mjs')._deriveEffectiveDynamicFlexSettings>;
 * gesamtwert:number;normalizedInput:NormalizedEngineInput;dynamicFlexWishCapApplied:boolean;newState:EngineState;
 * safetyUpdate:ReturnType<typeof import('./vpw-safety.mjs').completeSafetyDiagnosis>['safetyUpdate'];nextReentryRemaining:number;
 * vpwExpectedRealReturn:number|null;taxSettlement:ReturnType<typeof import('./action-settlement.mjs').settleAnnualAction>['taxSettlement'];diagnosis:Diagnosis}} params
 * @returns {import('../../typcheck/rechenkern').EngineResult} */
export function buildAnnualResult({
    depotwertGesamt, neuerBedarf, minGold,
    zielLiquiditaet, market, spendingResult,
    action, threeBucketDiagnosis, deckungVorher,
    deckungNachher, runwayMonths, runwayStatus,
    vpwDiagnostics, vpwEffectiveSettings, gesamtwert,
    normalizedInput, dynamicFlexWishCapApplied, newState,
    safetyUpdate, nextReentryRemaining, vpwExpectedRealReturn,
    taxSettlement, diagnosis
}) {
    // 12. Ergebnis zusammenstellen
    // Struktur: {input, newState, diagnosis, ui}

    const resultForUI = {
        depotwertGesamt,
        neuerBedarf,
        minGold,
        zielLiquiditaet, // Explicitly check this!
        market,
        spending: spendingResult,
        action,
        threeBucket: threeBucketDiagnosis,
        liquiditaet: {
            deckungVorher,
            deckungNachher
        },
        runway: { months: runwayMonths, status: runwayStatus },
        // Stable schema for Dynamic-Flex contract (T01/T02).
        vpw: vpwDiagnostics || {
            enabled: vpwEffectiveSettings.effectiveDynamicFlex,
            gesamtwert: Math.round(gesamtwert),
            horizonYears: Number.isFinite(normalizedInput.horizonYears) ? normalizedInput.horizonYears : null,
            ..._buildLongevityDiagnostics(
                normalizedInput,
                Number.isFinite(normalizedInput.horizonYears) ? normalizedInput.horizonYears : null
            ),
            horizonMethod: normalizedInput.horizonMethod,
            survivalQuantile: Number.isFinite(normalizedInput.survivalQuantile) ? normalizedInput.survivalQuantile : null,
            goGoActive: vpwEffectiveSettings.effectiveGoGo,
            goGoMultiplier: vpwEffectiveSettings.effectiveGoGo
                ? (Number.isFinite(normalizedInput.goGoMultiplier) ? normalizedInput.goGoMultiplier : 1.0)
                : 1.0,
            goGoRequested: vpwEffectiveSettings.requestedGoGo,
            goGoSuppressed: vpwEffectiveSettings.goGoSuppressed,
            dynamicFlexRequested: vpwEffectiveSettings.requestedDynamicFlex,
            dynamicFlexSuppressed: vpwEffectiveSettings.dynamicFlexSuppressed,
            safetyStage: vpwEffectiveSettings.stage,
            safetyStageLabel: vpwEffectiveSettings.stageLabel,
            capeRatioUsed: Number.isFinite(market?.capeRatio) ? market.capeRatio : null,
            expectedReturnCape: Number.isFinite(market?.expectedReturnCape) ? market.expectedReturnCape : null,
            status: vpwEffectiveSettings.requestedDynamicFlex
                ? (vpwEffectiveSettings.effectiveDynamicFlex ? 'contract_ready' : 'safety_static_flex')
                : 'disabled'
        }
    };
    if (dynamicFlexWishCapApplied && !vpwDiagnostics) Object.assign(resultForUI.vpw, {
        wishFlexCapAnnual: 2 * normalizedInput.flexBedarf,
        wishFlexCapApplied: true
    });

    if (newState && typeof newState === 'object') {
        newState.vpwSafetyStage = safetyUpdate.stage;
        newState.vpwSafetyRiskStreak = safetyUpdate.riskStreak;
        newState.vpwSafetyStableStreak = safetyUpdate.stableStreak;
        newState.vpwSafetyReentryRemaining = nextReentryRemaining;
        if (vpwDiagnostics && Number.isFinite(vpwDiagnostics.rawDynamicFlex)) {
            newState.vpwLastDynamicFlex = vpwDiagnostics.rawDynamicFlex;
        }
        if (Number.isFinite(vpwExpectedRealReturn)) {
            newState.vpwExpectedRealReturn = vpwExpectedRealReturn;
        } else {
            delete newState.vpwExpectedRealReturn;
        }
        newState.taxState = taxSettlement.taxStateNext;
    }

    return {
        input: normalizedInput,
        newState,
        diagnosis,
        ui: resultForUI
    };
}
