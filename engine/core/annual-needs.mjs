// @ts-check
/** @import {NormalizedEngineInput,EngineState,Market} from '../../typcheck/rechenkern' */
import { CONFIG, DYNAMIC_FLEX_SAFETY_DEFAULTS } from '../config.mjs';
import { _clamp, _berechneEntnahmeRate, _calculateExpectedRealReturn, _buildLongevityDiagnostics } from './vpw-return.mjs';
/** @param {{normalizedInput:NormalizedEngineInput;lastState?:EngineState|null;
 * vpwSafetyState:ReturnType<typeof import('./vpw-safety.mjs')._loadVpwSafetyState>;
 * vpwEffectiveSettings:ReturnType<typeof import('./vpw-safety.mjs')._deriveEffectiveDynamicFlexSettings>;
 * market:Market;equityWeightPct:number;goldWeightPct:number;gesamtwert:number}} params */
export function calculateAnnualNeeds({
    normalizedInput, lastState, vpwSafetyState,
    vpwEffectiveSettings, market, equityWeightPct,
    goldWeightPct, gesamtwert
}) {
    // 5. Inflationsangepassten Bedarf berechnen
    // Bedarf wird um Renteneinkünfte reduziert (netto)
    const renteJahr = normalizedInput.renteAktiv ? (/** @type {number} */ (normalizedInput.renteMonatlich) * 12) : 0;
    // Fix: Überschussrente auf den Flex-Bedarf anrechnen
    // Überschussrente reduziert zuerst den Flex-Bedarf (Floor bleibt geschützt).
    const pensionSurplus = Math.max(0, renteJahr - normalizedInput.floorBedarf);

    const inflatedBedarf = {
        floor: Math.max(0, normalizedInput.floorBedarf - renteJahr),  // Grundbedarf (essentiell)
        flex: normalizedInput.flexBedarf                              // Flexibler Bedarf (optional)
    };

    if (pensionSurplus > 0) {
        inflatedBedarf.flex = Math.max(0, inflatedBedarf.flex - pensionSurplus);
    }
    const staticFlexBaseline = Math.max(0, inflatedBedarf.flex);
    const dynamicFlexCfg = CONFIG.SPENDING_MODEL.DYNAMIC_FLEX;
    const dynamicFlexSafetyCfg = { ...DYNAMIC_FLEX_SAFETY_DEFAULTS, ...CONFIG.SPENDING_MODEL.DYNAMIC_FLEX_SAFETY };
    let vpwExpectedRealReturn = Number.isFinite(lastState?.vpwExpectedRealReturn)
        ? lastState.vpwExpectedRealReturn
        : null;
    let vpwDiagnostics = /** @type {import('../../typcheck/rechenkern').VpwDiagnostics|null} */ (null);
    if (vpwEffectiveSettings.effectiveDynamicFlex && Number.isFinite(normalizedInput.horizonYears) && normalizedInput.horizonYears > 0) {
        const horizonYears = _clamp(
            normalizedInput.horizonYears,
            dynamicFlexCfg.MIN_HORIZON_YEARS,
            dynamicFlexCfg.MAX_HORIZON_YEARS
        );
        const vpwReturnPolicy = _calculateExpectedRealReturn({
            returnPolicy: normalizedInput.returnPolicy,
            capeRatio: normalizedInput.capeRatio,
            marketCapeRatio: normalizedInput.marketCapeRatio,
            expectedReturnCape: market.expectedReturnCape,
            inflation: normalizedInput.inflation,
            equityWeightPct,
            goldAktiv: normalizedInput.goldAktiv,
            goldWeightPct,
            lastExpectedRealReturn: vpwExpectedRealReturn
        });
        const expectedRealReturn = vpwReturnPolicy.expectedRealReturn;
        vpwExpectedRealReturn = expectedRealReturn;
        const vpwRate = _berechneEntnahmeRate(expectedRealReturn, horizonYears);
        let vpwTotal = gesamtwert * vpwRate;
        const goGoMultiplier = vpwEffectiveSettings.effectiveGoGo
            ? _clamp(normalizedInput.goGoMultiplier, 1.0, dynamicFlexCfg.MAX_GO_GO_MULTIPLIER)
            : 1.0;
        vpwTotal *= goGoMultiplier;

        // VPW setzt den Flex-Anteil neu auf Basis von Netto-Floor (nach Rentenabzug).
        // Die statische Basis bleibt für Wunschschutz und Wiedereinstieg erhalten.
        const rawDynamicFlex = Math.max(0, vpwTotal - inflatedBedarf.floor);
        const reentryRampYears = Math.max(1, Number(dynamicFlexSafetyCfg.REENTRY_RAMP_YEARS) || DYNAMIC_FLEX_SAFETY_DEFAULTS.REENTRY_RAMP_YEARS);
        const reentryRemaining = Math.max(0, Number(vpwSafetyState?.reentryRemaining) || 0);
        let reentryApplied = false;
        let reentryBlendWeight = 1;
        if (vpwEffectiveSettings.stage === 1 && reentryRemaining > 0 && reentryRampYears > 0) {
            const yearsDone = Math.max(0, reentryRampYears - reentryRemaining);
            reentryBlendWeight = _clamp((yearsDone + 1) / reentryRampYears, 0, 1);
            inflatedBedarf.flex = staticFlexBaseline + ((rawDynamicFlex - staticFlexBaseline) * reentryBlendWeight);
            reentryApplied = true;
        } else {
            inflatedBedarf.flex = rawDynamicFlex;
        }
        vpwDiagnostics = {
            enabled: true,
            status: 'active',
            gesamtwert: Math.round(gesamtwert),
            horizonYears,
            ..._buildLongevityDiagnostics(normalizedInput, horizonYears),
            horizonMethod: normalizedInput.horizonMethod,
            survivalQuantile: normalizedInput.survivalQuantile,
            goGoActive: vpwEffectiveSettings.effectiveGoGo,
            goGoMultiplier,
            goGoRequested: vpwEffectiveSettings.requestedGoGo,
            goGoSuppressed: vpwEffectiveSettings.goGoSuppressed,
            dynamicFlexRequested: vpwEffectiveSettings.requestedDynamicFlex,
            dynamicFlexSuppressed: vpwEffectiveSettings.dynamicFlexSuppressed,
            safetyStage: vpwEffectiveSettings.stage,
            safetyStageLabel: vpwEffectiveSettings.stageLabel,
            reentryApplied: false,
            reentryBlendWeight: 1,
            reentryRemainingBefore: Math.max(0, Number(vpwSafetyState?.reentryRemaining) || 0),
            returnPolicy: vpwReturnPolicy.returnPolicy,
            expectedReturnSource: vpwReturnPolicy.expectedReturnSource,
            capeRatioUsed: Number.isFinite(market?.capeRatio) ? market.capeRatio : null,
            expectedReturnCape: Number.isFinite(vpwReturnPolicy.expectedReturnCape)
                ? vpwReturnPolicy.expectedReturnCape
                : (Number.isFinite(market?.expectedReturnCape) ? market.expectedReturnCape : null),
            capePolicyRatioUsed: Number.isFinite(vpwReturnPolicy.capeRatioUsed) ? vpwReturnPolicy.capeRatioUsed : null,
            capeInputStatus: vpwReturnPolicy.capeInputStatus || null,
            safeRealReturn: vpwReturnPolicy.safeRealReturn,
            safeRealReturnSource: vpwReturnPolicy.safeRealReturnSource,
            goldRealReturn: vpwReturnPolicy.goldRealReturn,
            goldRealReturnSource: vpwReturnPolicy.goldRealReturnSource,
            portfolioWeightSource: 'actual_engine_portfolio',
            equityWeight: vpwReturnPolicy.equityWeight,
            goldWeight: vpwReturnPolicy.goldWeight,
            safeWeight: vpwReturnPolicy.safeWeight,
            expectedRealReturnRaw: vpwReturnPolicy.expectedRealReturnRaw,
            expectedRealReturnClamped: vpwReturnPolicy.expectedRealReturnClamped,
            expectedRealReturnBeforeSmoothing: vpwReturnPolicy.expectedRealReturnBeforeSmoothing,
            smoothingAlpha: vpwReturnPolicy.smoothingAlpha,
            expectedRealReturn,
            vpwRate,
            vpwTotal,
            dynamicFlex: inflatedBedarf.flex,
            rawDynamicFlex,
            staticFlexBaseline,
            // @ts-expect-error Muster: JavaScript überschreibt hier bewusst den früheren Diagnose-Startwert.
            reentryApplied,
            // @ts-expect-error Muster: JavaScript überschreibt hier bewusst den früheren Diagnose-Startwert.
            reentryBlendWeight,
            // @ts-expect-error Muster: JavaScript überschreibt hier bewusst den früheren Diagnose-Startwert.
            reentryRemainingBefore: reentryRemaining
        };
    }
    if (!vpwEffectiveSettings.effectiveDynamicFlex && vpwEffectiveSettings.stage >= 2 && vpwEffectiveSettings.requestedDynamicFlex) {
        const floorBasedMin = Math.max(0, inflatedBedarf.floor * Math.max(0, Number(dynamicFlexSafetyCfg.STAGE2_MIN_FLEX_OF_FLOOR_RATIO) || 0));
        const prevDynamicFlex = Math.max(0, Number(lastState?.vpwLastDynamicFlex) || 0);
        const prevDynamicBasedMin = Math.max(0, prevDynamicFlex * Math.max(0, Number(dynamicFlexSafetyCfg.STAGE2_MIN_FLEX_OF_PREV_DYNAMIC_RATIO) || 0));
        const stage2MinFlex = Math.max(inflatedBedarf.flex, floorBasedMin, prevDynamicBasedMin);
        inflatedBedarf.flex = stage2MinFlex;
    }
    // Feste Haushaltsobergrenze, auch nach Go-Go, Wiedereinstieg und Sicherheitsboden.
    // Der Rentenanteil am Flex verbraucht denselben Rahmen wie der Depotanteil.
    const dynamicFlexWishCap = Math.max(0, 2 * normalizedInput.flexBedarf - pensionSurplus);
    const dynamicFlexWishCapApplied = vpwEffectiveSettings.requestedDynamicFlex
        && inflatedBedarf.flex > dynamicFlexWishCap;
    if (dynamicFlexWishCapApplied) {
        if (vpwDiagnostics) Object.assign(vpwDiagnostics, {
            dynamicFlexBeforeWishCap: inflatedBedarf.flex,
            wishFlexCapAnnual: 2 * normalizedInput.flexBedarf,
            wishFlexCapApplied: true,
            dynamicFlex: dynamicFlexWishCap
        });
        inflatedBedarf.flex = dynamicFlexWishCap;
    }
    const neuerBedarf = inflatedBedarf.floor + inflatedBedarf.flex;

    return { renteJahr, inflatedBedarf, staticFlexBaseline, dynamicFlexSafetyCfg, vpwExpectedRealReturn, vpwDiagnostics, dynamicFlexWishCapApplied, neuerBedarf };
}
