// @ts-check
/** @import {Action,Diagnosis} from '../../typcheck/rechenkern' */
import { FinancialCalculationError } from '../errors.mjs';
import { PLANNED_ACTION_FLOW_EPSILON } from '../../types/planned-action-contract.js';
/** @param {{action:Action;aktuelleLiquiditaet:number;zielLiquiditaet:number;
 * plannedAnnualNetNeed:number;neuerBedarf:number}} params */
export function calculateLiquidityRunway({ action, aktuelleLiquiditaet, zielLiquiditaet, plannedAnnualNetNeed, neuerBedarf }) {
    // 10. Liquidität nach Transaktion berechnen.
    // Zuflüsse aus Depotverkäufen und Abflüsse bei Überschussinvestitionen
    // müssen beide in die nachgelagerte Runway eingehen.
    const plannedLiquidityInflow = Number(action.verwendungen?.liquiditaet ?? 0);
    const cashFundingSources = Array.isArray(action?.quellen)
        ? action.quellen.filter(source => source?.kind === 'liquiditaet')
        : [];
    const invalidCashFundingSource = cashFundingSources.find(source => (
        typeof source?.brutto !== 'number' || !Number.isFinite(source.brutto) || source.brutto < 0
    ));
    if (!Number.isFinite(plannedLiquidityInflow) || plannedLiquidityInflow < 0 || invalidCashFundingSource) {
        throw new FinancialCalculationError(
            'Die geplanten Liquiditätsflüsse der Transaktion sind ungültig.',
            {
                contract: 'planned_liquidity_flow',
                plannedLiquidityInflow,
                invalidCashFundingSource: invalidCashFundingSource || null
            }
        );
    }
    const plannedLiquidityOutflow = cashFundingSources.reduce(
        (sum, source) => sum + source.brutto,
        0
    );
    const rawLiqNachTransaktion = aktuelleLiquiditaet
        + plannedLiquidityInflow
        - plannedLiquidityOutflow;
    if (
        !Number.isFinite(rawLiqNachTransaktion)
        || rawLiqNachTransaktion < -PLANNED_ACTION_FLOW_EPSILON
    ) {
        throw new FinancialCalculationError(
            'Die geplante Transaktion überbucht die verfügbare Liquidität.',
            {
                contract: 'planned_liquidity_flow',
                aktuelleLiquiditaet,
                plannedLiquidityInflow,
                plannedLiquidityOutflow,
                liqNachTransaktion: rawLiqNachTransaktion
            }
        );
    }
    const liqNachTransaktion = rawLiqNachTransaktion < 0 ? 0 : rawLiqNachTransaktion;

    // KPI: Liquiditätsdeckung relativ zum Zielwert vor/nach Transaktion
    // Wird als Diagnose-KPI und für die UI wiederverwendet, deshalb einmalig berechnet
    /** @param {number} liquiditaetWert */
    const computeCoverage = (liquiditaetWert) => (zielLiquiditaet > 0)
        ? (liquiditaetWert / zielLiquiditaet) * 100
        : 100;
    const deckungVorher = computeCoverage(aktuelleLiquiditaet);
    const deckungNachher = computeCoverage(liqNachTransaktion);

    // Neue Runway nach Transaktion berechnen
    const runwayMonths = (plannedAnnualNetNeed > 0)
        ? (liqNachTransaktion / (plannedAnnualNetNeed / 12))
        : Infinity;
    // Die Dynamic-Flex-Safety behält bewusst die vor Slice 17 kalibrierte
    // Rohbedarfsbasis. Eine Policy-Kürzung darf ihr eigenes Erholungssignal
    // nicht durch einen kleineren Nenner erzeugen.
    const safetyRunwayMonths = (neuerBedarf > 0)
        ? (liqNachTransaktion / (neuerBedarf / 12))
        : Infinity;

    return { liqNachTransaktion, deckungVorher, deckungNachher, runwayMonths, safetyRunwayMonths };
}

/** @param {{runwayMonths:number;liquidityRunwayPolicy:ReturnType<typeof import('../../types/liquidity-runway-contract.js').deriveLiquidityRunwayPolicy>;
 * diagnosis:Diagnosis;deckungVorher:number;deckungNachher:number;
 * targetLiquidityDetails:ReturnType<typeof import('../transactions/TransactionEngine.mjs').default.calculateTargetLiquidityDetails>}} params */
export function completeRunwayDiagnosis({
    runwayMonths, liquidityRunwayPolicy, diagnosis,
    deckungVorher, deckungNachher, targetLiquidityDetails
}) {
    // 11. Runway-Status bestimmen
    // - 'ok': Runway >= Ziel (z.B. 36+ Monate)
    // - 'warn': Runway >= Minimum aber < Ziel (z.B. 24-36 Monate)
    // - 'bad': Runway < Minimum (< 24 Monate) - kritisch!
    let runwayStatus = 'bad';
    if (runwayMonths >= liquidityRunwayPolicy.targetMonths) {
        runwayStatus = 'ok';
    } else if (runwayMonths >= liquidityRunwayPolicy.hardMinimumMonths) {
        runwayStatus = 'warn';
    }

    // Diagnose-Objekt mit finalem Runway-Status und Zielwert anreichern
    diagnosis.general = diagnosis.general || {};
    diagnosis.general.runwayStatus = runwayStatus;
    diagnosis.general.runwayMonate = runwayMonths;
    diagnosis.general.deckungVorher = deckungVorher;
    diagnosis.general.deckungNachher = deckungNachher;
    const runwayTargetSmoothing = targetLiquidityDetails.runwayTargetDiagnostics || null;
    const validInputRunwayTarget = (typeof liquidityRunwayPolicy.targetMonths === 'number' && isFinite(liquidityRunwayPolicy.targetMonths) && liquidityRunwayPolicy.targetMonths > 0)
        ? liquidityRunwayPolicy.targetMonths
        : null;
    const hasValidTarget = (typeof diagnosis.general.runwayTargetMonate === 'number' && isFinite(diagnosis.general.runwayTargetMonate));
    if (runwayTargetSmoothing?.targetMonths) {
        diagnosis.general.runwayTargetMonate = runwayTargetSmoothing.targetMonths;
    } else if (!hasValidTarget && validInputRunwayTarget) {
        diagnosis.general.runwayTargetMonate = validInputRunwayTarget;
    }
    if (runwayTargetSmoothing?.source) {
        diagnosis.general.runwayTargetQuelle = runwayTargetSmoothing.source;
    } else if (typeof diagnosis.general.runwayTargetQuelle !== 'string' || !diagnosis.general.runwayTargetQuelle.trim()) {
        diagnosis.general.runwayTargetQuelle = validInputRunwayTarget ? 'input' : 'legacy';
    }
    if (runwayTargetSmoothing) {
        diagnosis.general.runwayTargetSmoothing = runwayTargetSmoothing;
        diagnosis.general.regimeSmoothingApplied = runwayTargetSmoothing.smoothingApplied;
        diagnosis.general.regimeSmoothingFallback = runwayTargetSmoothing.smoothingFallback;
        diagnosis.general.regimeSmoothingFactors = {
            drawdownSeverity: runwayTargetSmoothing.severity,
            drawdownSeverityPct: runwayTargetSmoothing.severityPct,
            lowerTargetMonths: runwayTargetSmoothing.lowerTargetMonths,
            upperTargetMonths: runwayTargetSmoothing.upperTargetMonths,
            hardMinimumMonths: runwayTargetSmoothing.hardMinimumMonths
        };
        diagnosis.keyParams.runwayTargetSmoothing = runwayTargetSmoothing;
    }

    if (Array.isArray(diagnosis.guardrails)) {
        diagnosis.guardrails = diagnosis.guardrails.map(guardrail => {
            if (guardrail && guardrail.type === 'months' && guardrail.rule === 'min' && guardrail.name.startsWith('Runway')) {
                if (
                    guardrail.name.startsWith('Runway (vs. Ziel)') &&
                    Number.isFinite(runwayTargetSmoothing?.targetMonths)
                ) {
                    return { ...guardrail, value: runwayMonths, threshold: runwayTargetSmoothing.targetMonths };
                }
                return { ...guardrail, value: runwayMonths };
            }
            return guardrail;
        });
    }

    return { runwayStatus };
}
