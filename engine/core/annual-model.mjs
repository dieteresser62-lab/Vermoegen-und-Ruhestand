// @ts-check
/** @import {EngineInput,EngineState,RunwayProfile} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';
import { ValidationError, FinancialCalculationError } from '../errors.mjs';
import InputValidator from '../validators/InputValidator.mjs';
import MarketAnalyzer from '../analyzers/MarketAnalyzer.mjs';
import SpendingPlanner from '../planners/SpendingPlanner.mjs';
import TransactionEngine from '../transactions/TransactionEngine.mjs';
import { netPersonalAction } from '../transactions/net-action.mjs';
import { finalizeThreeBucketAction, calculateRealEquityReturn, sumBondBucketValuation } from '../transactions/three-bucket-logic.mjs';
import { decidedFixedIncomeSurplus } from '../planners/fixed-income-budget.mjs';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { deriveLiquidityRunwayPolicy } from '../../types/liquidity-runway-contract.js';
import { resolvePlannedAnnualWithdrawal } from '../../types/planned-withdrawal-contract.js';
import { _normalizeEngineInput } from './input-normalization.mjs';
import { _loadVpwSafetyState, _deriveEffectiveDynamicFlexSettings, completeSafetyDiagnosis } from './vpw-safety.mjs';
import { calculateAnnualNeeds } from './annual-needs.mjs';
import { _assertPlannedActionContract } from './action-contracts.mjs';
import { validateRawAction } from './action-validation.mjs';
import { settleAnnualAction } from './action-settlement.mjs';
import { calculateLiquidityRunway, completeRunwayDiagnosis } from './liquidity-runway.mjs';
import { buildAnnualResult } from './annual-result.mjs';
/** * Interne Orchestrierungsfunktion - Berechnet ein komplettes Jahresergebnis
 *
 * Diese Funktion orchestriert alle Engine-Module und führt die Jahresberechnung durch:
 * 1. Validiert Eingaben
 * 2. Berechnet Grundwerte (Portfolio, Liquidität, Bedarf)
 * 3. Analysiert Marktbedingungen
 * 4. Bestimmt Ausgabenstrategie (mit Guardrails)
 * 5. Berechnet notwendige Transaktionen
 * 6. Erstellt umfassende Diagnose
 * */

/** @param {EngineInput} input
 * @param {EngineState|null} [lastState]
 * @returns {import('../../typcheck/rechenkern').EngineResult} */
export function _internal_calculateModel(input, lastState, { includeFlexTrace = false } = {}) {
    const normalizedInput = _normalizeEngineInput(input);
    const taxStatePrev = {
        lossCarry: Math.max(0, Number(lastState?.taxState?.lossCarry) || 0)
    };
    const vpwSafetyState = _loadVpwSafetyState(lastState);
    const vpwEffectiveSettings = _deriveEffectiveDynamicFlexSettings(normalizedInput, vpwSafetyState);
    // 1. Validierung der Eingabedaten
    // Prüft alle Eingaben auf Plausibilität und Vollständigkeit
    // Harte Eingabevalidierung vor jeder Modellrechnung (fail-fast).
    const validationResult = InputValidator.validate(normalizedInput);
    if (!validationResult.valid) {
        // DEBUG: Log validation errors
        console.error('[VALIDATION ERROR] Invalid input fields:', validationResult.errors);
        return { error: new ValidationError(validationResult.errors) };
    }

    // 2. Grundwerte berechnen
    // Profil-Konfiguration laden (Runway-Ziele, Allokationsstrategie)
    // Profil-Konfiguration laden (Runway-Ziele, Allokationsstrategie)
    // Risikoprofil steuert Runway-Ziele, Guardrails und Entnahme-Logik.
    let profil = /** @type {Record<string,RunwayProfile>} */ (CONFIG.PROFIL_MAP)[/** @type {string} */ (normalizedInput.risikoprofil)];
    if (!profil) {
        // Fallback für Tests oder invalide Eingaben
        profil = CONFIG.PROFIL_MAP['sicherheits-dynamisch'];
    }


    // Aktuelle Liquidität = Tagesgeld + Geldmarkt-ETF (oder direkter Override)
    // Liquidität kann direkt überschrieben werden (z. B. Simulator/Tests).
    const aktuelleLiquiditaet = (normalizedInput.aktuelleLiquiditaet !== undefined)
        ? normalizedInput.aktuelleLiquiditaet
        : (normalizedInput.tagesgeld + normalizedInput.geldmarktEtf);

    // Gesamtes Depotvermögen (Aktien alt + neu + optional Gold)
    const depotwertGesamt = normalizedInput.depotwertAlt + normalizedInput.depotwertNeu +
        (normalizedInput.goldAktiv ? normalizedInput.goldWert : 0);

    // Gesamtvermögen = Depot + Liquidität
    const gesamtwert = depotwertGesamt + aktuelleLiquiditaet;
    // Bonds stay in depotwertNeu for all transaction/tax contracts; only the
    // Dynamic-Flex return forecast treats them as safe assets.
    const anleihenWert = normalizedInput.anleihenWert ?? 0;
    const equityValue = normalizedInput.depotwertAlt + normalizedInput.depotwertNeu - anleihenWert;
    const goldValue = normalizedInput.goldAktiv ? normalizedInput.goldWert : 0;
    const equityWeightPct = gesamtwert > 0 ? (equityValue / gesamtwert) * 100 : 0;
    const goldWeightPct = gesamtwert > 0 ? (goldValue / gesamtwert) * 100 : 0;
    const liquidityRunwayPolicy = deriveLiquidityRunwayPolicy(normalizedInput.liquidityRunwayYears);

    // 3. Marktanalyse durchführen
    // Bestimmt Marktszenario (Bär, Bulle, Seitwärts, etc.) basierend auf historischen Daten
    const marketAnalysis = MarketAnalyzer.analyzeMarket(normalizedInput);
    const realReturnEq = calculateRealEquityReturn(marketAnalysis.perf1Y, normalizedInput.inflation);
    const market = {
        ...marketAnalysis,
        realReturnEq
    };

    // 4. Gold-Floor berechnen (Mindestbestand)
    // Definiert minimalen Gold-Bestand als Prozentsatz des Gesamtvermögens
    // @ts-expect-error TP-Befund TP-3-1: Bei aktivem Gold lässt der Validator fehlenden Gold-Floor durch; es entsteht NaN.
    const goldFloorAbs = (normalizedInput.goldFloorProzent / 100) * gesamtwert;
    const minGold = normalizedInput.goldAktiv ? goldFloorAbs : 0;

    const {
        renteJahr, inflatedBedarf, staticFlexBaseline,
        dynamicFlexSafetyCfg, vpwExpectedRealReturn, vpwDiagnostics,
        dynamicFlexWishCapApplied, neuerBedarf
    } = calculateAnnualNeeds({
        normalizedInput, lastState, vpwSafetyState, vpwEffectiveSettings, market, equityWeightPct, goldWeightPct, gesamtwert
    });

    // 6. Vorläufige Runway für den SpendingPlanner berechnen.
    // Diese Schätzung muss den noch ungekürzten Bedarf verwenden, weil der
    // SpendingPlanner seine Guardrails erst daraus ableitet.
    const prePolicyRunwayMonths = (inflatedBedarf.floor + inflatedBedarf.flex) > 0
        ? (aktuelleLiquiditaet / ((inflatedBedarf.floor + inflatedBedarf.flex) / 12))
        : Infinity;

    // 7. Ausgabenplanung mit Guardrails
    // SpendingPlanner bestimmt die optimale Entnahmestrategie basierend auf:
    // - Marktsituation (Bär vs. Bulle)
    // - Runway-Status (kritisch, ok, gut)
    // - Historischem Peak (Drawdown-Berechnung)
    // - Entnahmequote und Alarmbedingungen
    const { spendingResult, newState, diagnosis } = SpendingPlanner.determineSpending({
        market,
        lastState,
        inflatedBedarf,
        staticFlexBaseline,
        runwayMonate: prePolicyRunwayMonths,
        profil,
        depotwertGesamt,
        gesamtwert,
        renteJahr,
        input: normalizedInput
    }, { includeFlexTrace });
    if (dynamicFlexWishCapApplied) diagnosis.decisionTree.push({
        step: vpwEffectiveSettings.effectiveDynamicFlex ? 'Dynamic-Flex-Obergrenze' : 'Sicherheitsboden begrenzt',
        impact: vpwEffectiveSettings.effectiveDynamicFlex
            ? `Dynamic Flex einschließlich Go-Go ist auf das Doppelte des inflationierten Wunsch-Flex begrenzt: ${(2 * normalizedInput.flexBedarf).toFixed(2)} € pro Jahr.`
            : `Der Sicherheitsboden der Stufe 2 ist auf das Doppelte des inflationierten Wunsch-Flex begrenzt: ${(2 * normalizedInput.flexBedarf).toFixed(2)} € pro Jahr.`,
        status: 'active',
        severity: 'guardrail'
    });

    // Die tatsächliche geplante Auszahlung bestimmt Transaktion und operativen
    // Runway; FR-30 hält das Liquiditätsziel unabhängig von Flex-Kürzungen.
    const plannedWithdrawalResolution = resolvePlannedAnnualWithdrawal({ spendingResult });
    if (plannedWithdrawalResolution.status !== 'resolved') {
        throw new FinancialCalculationError(
            'Das Ergebnis der Ausgabenplanung enthält keine eindeutige geplante Jahresentnahme.',
            {
                contract: 'planned_annual_withdrawal',
                status: plannedWithdrawalResolution.status,
                candidates: plannedWithdrawalResolution.candidates
            }
        );
    }
    const plannedAnnualNetNeed = plannedWithdrawalResolution.annualWithdrawal;
    const preTransactionRunwayMonths = plannedAnnualNetNeed > 0
        ? aktuelleLiquiditaet / (plannedAnnualNetNeed / 12)
        : Infinity;

    // 8. FR-30: Kürzungen senken das Ziel nicht; höhere geplante Auszahlungen
    // durch Dynamic Flex oder Go-Go müssen die gewählte Reichweite ebenfalls decken.
    // Der separate Brutto-Mindestpuffer bleibt in TransactionEngine erhalten.
    // FR-73: Pflegevorschau ersetzt die laufende Basis; zusätzliche beschlossene Flex-Auszahlung
    // bleibt mit Folgejahrespreisen gedeckt. Ohne Projektion gilt unverändert der bisherige Weg.
    const projection = normalizedInput.careLiquidityProjection;
    const projectedNeed = projection ? Math.max(0, projection.floor + projection.flex - projection.income)
        + Math.max(0, plannedAnnualNetNeed - Math.max(0, normalizedInput.floorBedarf + normalizedInput.flexBedarf - renteJahr)) * projection.priceFactor : null;
    const targetLiquidityDetails = TransactionEngine.calculateTargetLiquidityDetails(
        profil,
        market,
        projectedNeed ?? Math.max(plannedAnnualNetNeed, 0, normalizedInput.floorBedarf + normalizedInput.flexBedarf - renteJahr),
        projection ? { ...normalizedInput, floorBedarf: projection.floor, flexBedarf: projection.flex } : normalizedInput
    );
    // FR-44: Erst nach der Budgetentscheidung zusätzlich bereitstellen.
    const zielLiquiditaet = targetLiquidityDetails.targetLiquidity + (normalizedInput.plannedExpenseLiquidityReserve || 0);

    // 9. Transaktionsaktion bestimmen
    // Entscheidet, ob und welche Transaktionen notwendig sind:
    // - Depot-Verkauf zur Liquiditäts-Auffüllung
    // - Rebalancing (Aktien/Gold)
    // - Notfall-Verkäufe bei kritischem Runway
    // TJ-2: Der Simulator kann im Todesjahr eine eigene Sicht für Kauf und Auffüllung vorgeben (Liquidität und
    // Bestände, die nach dem Nachlass bei der überlebenden Person bleiben). Ausgaben, Ziel und Runway bleiben beim Haushalt.
    const transactionInput = normalizedInput.transactionView
        ? { ...normalizedInput, ...normalizedInput.transactionView } : normalizedInput;
    const transactionLiquidity = transactionInput === normalizedInput ? aktuelleLiquiditaet
        : /** @type {number} */ (transactionInput.aktuelleLiquiditaet);
    const transactionDepot = transactionInput === normalizedInput ? depotwertGesamt
        : transactionInput.depotwertAlt + transactionInput.depotwertNeu + (transactionInput.goldAktiv ? transactionInput.goldWert : 0);
    const transactionMinGold = transactionInput === normalizedInput ? minGold : transactionInput.goldAktiv
        ? (/** @type {number} */ (transactionInput.goldFloorProzent) / 100) * (transactionDepot + transactionLiquidity) : 0;
    let action = TransactionEngine.determineAction({
        aktuelleLiquiditaet: transactionLiquidity,
        depotwertGesamt: transactionDepot,
        zielLiquiditaet,
        market,
        spending: spendingResult,
        // FR-57: dieselbe beschlossene Einkommensgrenze wie Balance und Simulator.
        isSavingsYear: decidedFixedIncomeSurplus({ input: normalizedInput, spending: spendingResult,
            vpw: vpwDiagnostics || { enabled: vpwEffectiveSettings.effectiveDynamicFlex } }) > 0,
        minGold: transactionMinGold,
        profil,
        input: transactionInput
    });
    _assertPlannedActionContract(
        action,
        transactionInput,
        transactionLiquidity,
        'transaction_engine_output'
    );
    let threeBucketDiagnosis = null;
    if (
        normalizedInput.finalizeThreeBucketAction === true
        && normalizedInput.decumulation?.mode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE
    ) {
        const detailedTranches = Array.isArray(transactionInput.detailledTranches)
            ? transactionInput.detailledTranches
            : [];
        const finalized = finalizeThreeBucketAction({
            detailedTranches,
            engineInput: transactionInput,
            market,
            pendingAction: action,
            realReturnEq: market.realReturnEq,
            annualWithdrawalTarget: plannedAnnualNetNeed,
            currentBondValuation: sumBondBucketValuation(detailedTranches)
        });
        action = normalizedInput.deferTaxSettlement === true ? finalized.updatedAction : netPersonalAction(finalized.updatedAction);
        threeBucketDiagnosis = finalized.threeBucketState;
    }

    _assertPlannedActionContract(
        action,
        transactionInput,
        transactionLiquidity,
        'three_bucket_final'
    );

    const { hasAssetSale, rawSourcePlanFunding } = validateRawAction({
        action
    });

    // Diagnose-Einträge von Transaktion hinzufügen
    // Transaktionen können eigene Diagnose-Einträge erzeugen (z.B. Caps, Guardrails)
    if (Array.isArray(action.diagnosisEntries) && action.diagnosisEntries.length) {
        diagnosis.decisionTree.push(...action.diagnosisEntries);
    }
    if (action.transactionDiagnostics) {
        diagnosis.transactionDiagnostics = action.transactionDiagnostics;
    }

    const { taxSettlement } = settleAnnualAction({
        action, normalizedInput, taxStatePrev, hasAssetSale, rawSourcePlanFunding, diagnosis, threeBucketDiagnosis
    });

    const { liqNachTransaktion, deckungVorher, deckungNachher, runwayMonths, safetyRunwayMonths } = calculateLiquidityRunway({
        action, aktuelleLiquiditaet, zielLiquiditaet, plannedAnnualNetNeed, neuerBedarf
    });

    const { safetyUpdate, nextReentryRemaining } = completeSafetyDiagnosis({
        lastState, vpwEffectiveSettings, diagnosis,
        safetyRunwayMonths, liquidityRunwayPolicy, spendingResult,
        normalizedInput, dynamicFlexSafetyCfg, vpwSafetyState,
        neuerBedarf, plannedWithdrawalResolution, preTransactionRunwayMonths,
        vpwDiagnostics
    });

    const { runwayStatus } = completeRunwayDiagnosis({
        runwayMonths, liquidityRunwayPolicy, diagnosis, deckungVorher, deckungNachher, targetLiquidityDetails
    });

    return buildAnnualResult({
        depotwertGesamt, neuerBedarf, minGold,
        zielLiquiditaet, market, spendingResult,
        action, threeBucketDiagnosis, deckungVorher,
        deckungNachher, runwayMonths, runwayStatus,
        vpwDiagnostics, vpwEffectiveSettings, gesamtwert,
        normalizedInput, dynamicFlexWishCapApplied, newState,
        safetyUpdate, nextReentryRemaining, vpwExpectedRealReturn,
        taxSettlement, diagnosis
    });
}
