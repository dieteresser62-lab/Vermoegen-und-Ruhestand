/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
/**
 * Module: Spending Planner
 * Purpose: Determines the annual spending strategy (Flex-Rate) based on market conditions, portfolio state, and guardrails.
 *          Implements the core "Variable Withdrawal Rate" logic, including smoothing and alarms.
 * Usage: Called by engine/core.mjs during the simulation loop.
 * Dependencies: engine/config.mjs
 */
import { CONFIG } from '../config.mjs';
import { createFlexTraceCollector } from './flex-trace.mjs';
import { evaluateAlarmConditions, shouldDeescalateInPeak, shouldDeescalateInRecovery } from './alarm-policy.mjs';
import { applyFinalRateLimits } from './final-rate-policy.mjs';
import { applyFlexBudgetCap } from './flex-budget-policy.mjs';
import { applyFlexShareCurve, calculateFlexRate } from './flex-rate-policy.mjs';
import { applyMinimumFlexFloor, finalizeMinimumFlexDiagnostics } from './minimum-flex-policy.mjs';
import { buildSpendingDiagnosis, resolveRunwayTarget } from './spending-diagnosis.mjs';
import { applyGuardrails } from './spending-guardrails.mjs';
import { applySpendingPolicyPipeline } from './spending-policy-pipeline.mjs';
import { calcFlexShare, calculateFinalWithdrawal, quantizeMonthly, smoothstep } from './spending-policy-helpers.mjs';
import { calculateWealthAdjustedReductionFactor } from './wealth-reduction.mjs';
import { resolveRuntimeCumulativeInflationFactor } from '../../types/cumulative-inflation-contract.js';

export const SpendingPlanner = {
    /** * Bestimmt die Ausgabenstrategie für ein Jahr.
     * */
    /** @param {number} amount */
    _quantizeMonthly(amount, mode = 'floor') {
        return quantizeMonthly(amount, mode);
    },

    /** @param {number} x */
    _smoothstep(x) {
        return smoothstep(x);
    },

    /** @param {SpendingParameters} params */
    _calculateWealthAdjustedReductionFactor(params) {
        return calculateWealthAdjustedReductionFactor(params);
    },

    /** @param {number} flexRate
 * @param {Needs} inflatedBedarf
 * @param {AddDecision} addDecision */
    _applyFlexShareCurve(flexRate, inflatedBedarf, addDecision, wealthFactor = 1) {
        return applyFlexShareCurve(flexRate, inflatedBedarf, addDecision, wealthFactor);
    },

    /** @param {Needs} inflatedBedarf */
    _calcFlexShare(inflatedBedarf) {
        return calcFlexShare(inflatedBedarf);
    },

    /** @param {number} flexRate
 * @param {Needs} inflatedBedarf
 * @param {EngineInput} input
 * @param {PlannerState} state
 * @param {Market} market
 * @param {AddDecision} addDecision */
    _applyFlexBudgetCap(flexRate, inflatedBedarf, input, state, market, addDecision) {
        return applyFlexBudgetCap(flexRate, inflatedBedarf, input, state, market, addDecision);
    },

    /** @param {number} flexRate
 * @param {import('../../typcheck/rechenkern').MinimumFlexContext} context
 * @param {AddDecision} addDecision */
    _applyMinimumFlexFloor(flexRate, context, addDecision) {
        return applyMinimumFlexFloor(flexRate, context, addDecision);
    },

    /** @param {number} prevFlexRate
 * @param {number} nextFlexRate
 * @param {Market} market
 * @param {AddDecision} addDecision */
    _applyFinalRateLimits(prevFlexRate, nextFlexRate, market, addDecision, wealthFactor = 1) {
        return applyFinalRateLimits(prevFlexRate, nextFlexRate, market, addDecision, wealthFactor);
    },

    /** @param {SpendingParameters} params */
    determineSpending(params, { includeFlexTrace = true } = {}) {
        const { lastState, inflatedBedarf } = params;
        const trace = createFlexTraceCollector(inflatedBedarf.flex, { collectEntries: includeFlexTrace });

        const decisionTree = /** @type {import('../../typcheck/rechenkern').Decision[]} */ ([]);

        const addDecision = /** @param {string} step
 * @param {string} impact
 * @param {string} status */
        (step, impact, status, severity = 'info') => {
            decisionTree.push({ step, impact, status, severity });
        };

        // 1. State initialisieren oder laden.
        const state = this._initializeOrLoadState(lastState, params, addDecision);

        // 2. Alarm-Bedingungen evaluieren.
        // Alarm > Guardrails: Im Alarmmodus werden Guardrails bewusst ausgesetzt,
        // damit der Sicherheitsmechanismus nicht durch Nebenregeln verwässert wird.
        const alarmStatus = this._evaluateAlarmConditions(state, params, addDecision);

        // 3. Flex-Rate berechnen (inkl. Glättung/Alarm-Verhalten).
        // Diese Rate ist die "Zentralsteuerung" der Flex-Entnahme.
        const initialPolicyResult = this._calculateFlexRate(
            state,
            alarmStatus,
            params,
            addDecision,
            trace
        );

        // 4. Policy-Pipeline anwenden: Guardrails, Flex-Budget und finale Limits.
        const policyResult = this._applySpendingPolicyPipeline(
            state,
            alarmStatus,
            params,
            addDecision,
            initialPolicyResult,
            trace
        );

        // 5. Endgültige Entnahme bestimmen.
        const { endgueltigeEntnahme, flexRate, quantization } = this._calculateFinalWithdrawal(
            inflatedBedarf,
            policyResult.flexRate
        );
        finalizeMinimumFlexDiagnostics(
            state,
            Math.max(0, endgueltigeEntnahme - inflatedBedarf.floor)
        );

        // 6. Ergebnisobjekte aufbauen.
        const { newState, spendingResult, diagnosisMetrics } = this._buildResults(
            state,
            endgueltigeEntnahme,
            alarmStatus,
            flexRate,
            policyResult.kuerzungQuelle,
            params,
            policyResult
        );

        // 7. Diagnose vervollständigen.
        const diagnosis = this._buildDiagnosis({
            decisionTree,
            state,
            alarmStatus,
            params,
            guardrailDiagnostics: policyResult.guardrailDiagnostics,
            policyDiagnostics: policyResult,
            diagnosisMetrics
        });

        trace?.record('quantization', policyResult.flexRate, flexRate, 'Rundung', {
            aktiviert: quantization.enabled,
            modus: quantization.mode,
            stufeEurMonat: quantization.stepMonthly,
            rohbetragEurJahr: quantization.rawAnnual,
            rohbetragEurMonat: quantization.rawMonthly,
            quantisiertEurMonat: quantization.quantizedMonthly,
            floorEurJahr: quantization.floorAnnual,
            floorGeschuetzt: quantization.floorProtectionApplied,
            endbetragEurJahr: quantization.finalAnnual,
            abschlagEurMonat: quantization.rawMonthly - quantization.finalAnnual / quantization.annualizationFactor,
            naechsterGlaettungsankerProzent: newState.flexRateSmoothingReference
        }, Math.max(0, endgueltigeEntnahme - quantization.floorAnnual) / 12);
        const pensionFlex = Math.min(Math.max(0, Number(params.input?.flexBedarf) || 0),
            Math.max(0, (Number(params.renteJahr) || 0) - (Number(params.input?.floorBedarf) || 0)));
        const paidHouseholdFlex = pensionFlex + Math.max(0, endgueltigeEntnahme - inflatedBedarf.floor);
        const wishFlex = Number(params.input?.flexBedarf ?? inflatedBedarf.flex);
        // Eine gesperrte Floor-Anhebung erklärt den Rückgang zum Vorjahr.
        const budgetFloorBlocked = policyResult.guardrailDiagnostics?.cautionBudgetFloor?.details?.budgetFloorBlocked === true;
        const emergencyDeterminesRate = policyResult.severeFlexEmergencyActive === true
            && policyResult.finalLimitingPolicy === 'safety_cap';
        const displayReductionSource = emergencyDeterminesRate
            ? 'Safety-Cap (schwere Flex-Notlage)'
            : trace.strongestReduction(flexRate, { budgetFloorBlocked,
                previousRate: state.keyParams?.previousActualFlexRate ?? 100 }) || spendingResult.kuerzungQuelle;
        if (flexRate < 100 && wishFlex > 0 && paidHouseholdFlex < wishFlex) {
            spendingResult.kuerzungQuelle = displayReductionSource;
            spendingResult.anmerkung = `(Flex um ${spendingResult.kuerzungProzent.toFixed(0)}% wg. ${spendingResult.kuerzungQuelle} gekürzt)`;
            if (policyResult.severeFlexEmergencyActive === true) {
                spendingResult.anmerkung += ` Flex nach Notlage: ${Math.max(0, endgueltigeEntnahme - inflatedBedarf.floor).toFixed(2)} € pro Jahr.`;
            }
        } else if (initialPolicyResult.dynamicSurplusLimited === true && flexRate < 100) {
            spendingResult.kuerzungQuelle = displayReductionSource;
            spendingResult.anmerkung = `(Dynamischer Flex-Anteil durch ${displayReductionSource} begrenzt)`;
        } else {
            spendingResult.anmerkung = '';
        }
        if (budgetFloorBlocked) spendingResult.kuerzungQuelle = displayReductionSource;
        if (spendingResult.kuerzungQuelle === 'Profil') spendingResult.kuerzungQuelle = 'keine Kürzung';
        if (includeFlexTrace) spendingResult.flexTrace = trace.snapshot();
        return { spendingResult, newState, diagnosis };
    },

    /** * Initialisiert den Persistenz-State oder lädt die Vorperioden-Werte.
     * */
    /** @param {EngineState|null|undefined} lastState
 * @param {SpendingParameters} params
 * @param {AddDecision} addDecision
 * @returns {PlannerState} */
    _initializeOrLoadState(lastState, params, addDecision) {
        const p = params;
        if (lastState && lastState.initialized) {
            const cumulativeInflationFactor = resolveRuntimeCumulativeInflationFactor(
                lastState.cumulativeInflationFactor,
                { path: 'lastState.cumulativeInflationFactor' }
            );
            const realVermögen = p.gesamtwert / cumulativeInflationFactor;
            const lockedHealthBucketReal = (p.input?.lockedHealthBucketAmount ?? 0) / cumulativeInflationFactor;
            // FR-35: Altstände führten den Peak brutto und haben daher die Basis 0.
            const previousLockedHealthBucketReal = lastState.peakLockedHealthBucketReal ?? 0;
            const previousPeak = lastState.peakRealVermoegen || realVermögen;
            const peakRealVermoegen = previousLockedHealthBucketReal !== lockedHealthBucketReal
                ? Math.max(0, previousPeak + (previousLockedHealthBucketReal - lockedHealthBucketReal))
                : previousPeak;
            const realerDepotDrawdown = (peakRealVermoegen > 0)
                ? (peakRealVermoegen - realVermögen) / peakRealVermoegen
                : 0;
            const previousActualFlexRate = Number.isFinite(lastState.flexRate)
                ? Math.max(0, Math.min(100, lastState.flexRate))
                : 100;
            const previousFlexRate = Number.isFinite(lastState.flexRateSmoothingReference)
                ? Math.max(0, Math.min(100, lastState.flexRateSmoothingReference))
                : previousActualFlexRate;
            const vorlaeufigeEntnahme = p.inflatedBedarf.floor +
                (p.inflatedBedarf.flex * (previousFlexRate / 100));
            const entnahmequoteDepot = p.depotwertGesamt > 0
                ? vorlaeufigeEntnahme / p.depotwertGesamt
                : 0;

            return {
                ...lastState,
                ...(lockedHealthBucketReal > 0 || lastState.peakLockedHealthBucketReal !== undefined
                    ? { peakLockedHealthBucketReal: lockedHealthBucketReal } : {}),
                flexRate: previousFlexRate,
                keyParams: {
                    peakRealVermoegen,
                    currentRealVermoegen: realVermögen,
                    cumulativeInflationFactor,
                    entnahmequoteDepot,
                    realerDepotDrawdown,
                    previousActualFlexRate,
                    previousFlexRateSmoothingReference: previousFlexRate
                }
            };
        }

        addDecision(
            'System-Initialisierung',
            'Starte mit 100% Flex-Rate und setze initialen Vermögens-Peak.',
            'active'
        );

        const initialWithdrawal = p.inflatedBedarf.floor + p.inflatedBedarf.flex;
        const initialWithdrawalRate = p.depotwertGesamt > 0
            ? initialWithdrawal / p.depotwertGesamt
            : 0;

        return {
            flexRate: 100,
            lastMarketSKey: p.market.sKey,
            lastTotalBudget: p.inflatedBedarf.floor + p.inflatedBedarf.flex + p.renteJahr,
            peakRealVermoegen: p.gesamtwert,
            ...((p.input?.lockedHealthBucketAmount ?? 0) > 0
                ? { peakLockedHealthBucketReal: p.input.lockedHealthBucketAmount } : {}),
            cumulativeInflationFactor: 1,
            initialized: true,
            alarmActive: false,
            lastInflationAppliedAtAge: 0,
            keyParams: {
                peakRealVermoegen: p.gesamtwert,
                currentRealVermoegen: p.gesamtwert,
                cumulativeInflationFactor: 1,
                entnahmequoteDepot: initialWithdrawalRate,
                realerDepotDrawdown: 0
            }
        };
    },

    /** * Prüft, ob ein aktiver Alarm im Peak-Szenario zurückgefahren werden kann.
     * */
    /** @param {boolean} alarmWarAktiv
 * @param {PlannerState} state
 * @param {SpendingParameters} params */
    _shouldDeescalateInPeak(alarmWarAktiv, state, params) {
        return shouldDeescalateInPeak(alarmWarAktiv, state, params);
    },

    /** * Prüft, ob ein aktiver Alarm im Recovery-Szenario zurückgefahren werden kann.
     * */
    /** @param {boolean} alarmWarAktiv
 * @param {PlannerState} state
 * @param {SpendingParameters} params */
    _shouldDeescalateInRecovery(alarmWarAktiv, state, params) {
        return shouldDeescalateInRecovery(alarmWarAktiv, state, params);
    },

    /** * Bewertet sämtliche Alarmbedingungen.
     * */
    /** @param {PlannerState} state
 * @param {SpendingParameters} params
 * @param {AddDecision} addDecision */
    _evaluateAlarmConditions(state, params, addDecision) {
        return evaluateAlarmConditions(state, params, addDecision);
    },

    /** * Berechnet die Flex-Rate unter Berücksichtigung von Alarmstatus und Glättung.
     * */
    /** @param {PlannerState} state
 * @param {AlarmStatus} alarmStatus
 * @param {SpendingParameters} params
 * @param {AddDecision} addDecision
 * @param {Trace} trace */
    _calculateFlexRate(state, alarmStatus, params, addDecision, trace) {
        return calculateFlexRate(state, alarmStatus, params, addDecision, trace);
    },

    /** * Wendet Guardrails auf die Flex-Rate an und liefert Diagnosedaten.
     * */
    /** @param {number} rate
 * @param {PlannerState} state
 * @param {SpendingParameters & {kuerzungQuelle:string}} params
 * @param {AddDecision} addDecision */
    _applyGuardrails(rate, state, params, addDecision) {
        return applyGuardrails(rate, state, params, addDecision);
    },

    /** * Wendet die Spending-Policy-Pipeline nach der initialen Flex-Rate an.
     * */
    /** @param {PlannerState} state
 * @param {AlarmStatus} alarmStatus
 * @param {SpendingParameters} params
 * @param {AddDecision} addDecision
 * @param {import('../../typcheck/rechenkern').InitialPolicy} initialPolicyResult
 * @param {Trace} trace */
    _applySpendingPolicyPipeline(state, alarmStatus, params, addDecision, initialPolicyResult, trace) {
        return applySpendingPolicyPipeline(state, alarmStatus, params, addDecision, initialPolicyResult, trace);
    },

    /** * Ermittelt final quantisierte Jahresentnahme und effektive Flex-Rate.
     * */
    /** @param {Needs} inflatedBedarf
 * @param {number} flexRate */
    _calculateFinalWithdrawal(inflatedBedarf, flexRate) {
        return calculateFinalWithdrawal(
            inflatedBedarf,
            flexRate,
            CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED
        );
    },

    /** * Baut finale Ergebnisobjekte inklusive Diagnosemetriken.
     * */
    /** @param {PlannerState} state
 * @param {number} endgueltigeEntnahme
 * @param {AlarmStatus} alarmStatus
 * @param {number} flexRate
 * @param {string} kuerzungQuelle
 * @param {SpendingParameters} params
 * @param {Partial<import('../../typcheck/rechenkern').PolicyResult>} policyResult */
    _buildResults(state, endgueltigeEntnahme, alarmStatus, flexRate, kuerzungQuelle, params, policyResult = {}) {
        const { market, renteJahr } = params;
        const { peakRealVermoegen, currentRealVermoegen, cumulativeInflationFactor } = state.keyParams;

        const finaleKuerzung = 100 - flexRate;
        const aktuellesGesamtbudgetFinal = endgueltigeEntnahme + renteJahr;

        const diagnosisMetrics = {
            flexRate,
            kuerzungProzent: finaleKuerzung,
            jahresentnahme: endgueltigeEntnahme
        };

        const entnahmeReal = endgueltigeEntnahme / cumulativeInflationFactor;
        // FR-34: Rundung senkt nur die Auszahlung, nicht den nächsten Anker.
        // Die bestehende Notlagenausnahme bewahrt die Rate vor dem Eingriff.
        const flexRateSmoothingReference = policyResult.severeFlexEmergencyActive === true
            && Number.isFinite(policyResult.nextFlexRateSmoothingReferencePct)
            ? Math.max(0, Math.min(100, policyResult.nextFlexRateSmoothingReferencePct))
            : (CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED && Number.isFinite(policyResult.flexRate)
                ? Math.max(0, Math.min(100, policyResult.flexRate))
                : flexRate);
        state.keyParams.nextFlexRateSmoothingReferencePct = flexRateSmoothingReference;
        // PE-1/MP-1: keyParams beim Kopieren auslassen. delete würde newState
        // in V8s Wörterbuchmodus versetzen und spätere Jahreskopien verteuern.
        const newState = /** @type {EngineState & Record<string, unknown>} */ ({});
        for (const key of Object.keys(state)) {
            if (key !== 'keyParams') newState[key] = state[key];
        }
        newState.flexRate = flexRate;
        newState.flexRateSmoothingReference = flexRateSmoothingReference;
        newState.lastMarketSKey = market.sKey;
        newState.lastTotalBudget = aktuellesGesamtbudgetFinal;
        newState.peakRealVermoegen = Math.max(peakRealVermoegen, currentRealVermoegen);
        newState.alarmActive = alarmStatus.active;
        newState.cumulativeInflationFactor = cumulativeInflationFactor;
        newState.lastInflationAppliedAtAge = state.lastInflationAppliedAtAge;
        newState.lastEntnahmeReal = entnahmeReal;

        const spendingResult = /** @type {{monatlicheEntnahme:number;kuerzungProzent:number;kuerzungQuelle:string;anmerkung:string;details:KeyParams;flexTrace?:ReturnType<Trace["snapshot"]>}} */ ({
            monatlicheEntnahme: endgueltigeEntnahme / 12,
            kuerzungProzent: finaleKuerzung,
            kuerzungQuelle: kuerzungQuelle,
            anmerkung: `(Flex um ${finaleKuerzung.toFixed(0)}% wg. ${kuerzungQuelle} gekürzt)`,
            details: copyKeyParams(state.keyParams)
        });
        spendingResult.details.flexRate = flexRate;
        spendingResult.details.endgueltigeEntnahme = endgueltigeEntnahme;
        if (policyResult.severeFlexEmergencyActive === true) {
            spendingResult.anmerkung += ` Flex nach Notlage: ${Math.max(0, endgueltigeEntnahme - params.inflatedBedarf.floor).toFixed(2)} € pro Jahr.`;
        }

        return { newState, spendingResult, diagnosisMetrics };
    },

    /** * Baut die finale Diagnose-Struktur.
     * */
    /** @param {Parameters<typeof buildSpendingDiagnosis>[0]} params */
    _buildDiagnosis(params) {
        return buildSpendingDiagnosis(params);
    },

    /** * Ermittelt das relevante Runway-Ziel (statisch oder dynamisch je Regime).
     * */
    /** @param {RunwayProfile} profil
 * @param {Market} market
 * @param {EngineInput} input */
    _resolveRunwayTarget(profil, market, input) {
        return resolveRunwayTarget(profil, market, input);
    }
};

// PE-1/MP-1: Spreads dieses großen internen Records liefen im generischen
// V8-Kopierpfad. Eigene skalare Felder in derselben Reihenfolge kopieren.
/** @param {KeyParams} keyParams
 * @returns {KeyParams} */
function copyKeyParams(keyParams) {
    const copy = /** @type {KeyParams} */ ({});
    for (const key of Object.keys(keyParams)) copy[key] = keyParams[key];
    return copy;
}

// Exporte
export default SpendingPlanner;
