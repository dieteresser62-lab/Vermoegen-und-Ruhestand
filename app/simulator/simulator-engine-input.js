import { buildInputsCtxFromPortfolio } from './simulator-portfolio.js';
import { buildDetailedTranchesFromPortfolio } from './simulator-engine-direct-utils.js';
import { resolveLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';

/**
 * @param {object} options
 * @param options.inputs
 * @param options.portfolio
 * @param options.marketDataCurrentYear
 * @param options.marketDataHist
 * @param options.yearData
 * @param options.yearIndex
 * @param options.liquiditaet
 * @param options.effectiveBaseFloor
 * @param options.baseFlex
 * @param {number} [options.baseMinimumFlexAnnual]
 * @param options.temporaryFlexFactor
 * @param [options.temporaryMinimumFlexFactor]
 * @param options.baseFlexBudgetAnnual
 * @param options.baseFlexBudgetRecharge
 * @param options.pensionAnnual
 * @param options.resolvedCapeRatio
 * @param {boolean} [options.p1Alive]
 * @param {boolean} [options.p2Alive]
 * @param {boolean} [options.preserveInputShape]
 * @returns Ergebnis der Operation.
 */
export function buildSimulatorEngineInput({
    inputs,
    portfolio,
    marketDataCurrentYear,
    marketDataHist,
    yearData,
    yearIndex,
    liquiditaet,
    effectiveBaseFloor,
    baseFlex,
    baseMinimumFlexAnnual = 0,
    temporaryFlexFactor,
    temporaryMinimumFlexFactor = temporaryFlexFactor,
    baseFlexBudgetAnnual,
    baseFlexBudgetRecharge,
    pensionAnnual,
    resolvedCapeRatio,
    p1Alive = true,
    p2Alive = true,
    preserveInputShape = false
}) {
    const inputsCtx = buildInputsCtxFromPortfolio(inputs, portfolio, {
        pensionAnnual,
        marketData: marketDataCurrentYear
    });
    // FR-55 gehört zum Simulator. Die Engine erhält die daraus berechneten
    // Jahresbeträge. Nicht per delete entfernen: Das würde inputsCtx vor seiner
    // jährlichen Kopie in V8s langsamen Wörterbuchmodus versetzen (PE-1/MP-1).

    const detailedTranches = buildDetailedTranchesFromPortfolio(portfolio);
    const engineInput = {
        ...inputsCtx,
        aktuelleLiquiditaet: liquiditaet,
        ...(inputs.decumulation?.mode === '3_bucket_jilge' ? { finalizeThreeBucketAction: true } : {}),
        aktuellesAlter: inputs.startAlter + yearIndex,
        ...(inputs.goGoActive && inputs.partner?.aktiv && inputs.partner.startAlter + yearIndex > 80
            ? { partnerAlter: inputs.partner.startAlter + yearIndex } : {}),
        inflation: yearData.inflation,

        // Engine expects gross demand and total pension; it performs netting internally.
        floorBedarf: effectiveBaseFloor,
        flexBedarf: baseFlex * temporaryFlexFactor,
        minimumFlexAnnual: baseMinimumFlexAnnual * temporaryMinimumFlexFactor,
        flexBudgetAnnual: baseFlexBudgetAnnual,
        flexBudgetYears: inputs.flexBudgetYears ?? 0,
        flexBudgetRecharge: baseFlexBudgetRecharge,

        renteAktiv: pensionAnnual > 0,
        renteMonatlich: pensionAnnual / 12,

        capeRatio: resolvedCapeRatio,
        marketCapeRatio: resolvedCapeRatio,

        rebalancingBand: inputs.rebalancingBand ?? 35,
        goldZielProzent: inputs.goldAktiv ? (inputs.goldZielProzent ?? 10) : 0,
        maxSkimPctOfEq: inputs.maxSkimPctOfEq ?? 5,
        maxBearRefillPctOfEq: inputs.maxBearRefillPctOfEq ?? 5,
        liquidityRunwayYears: resolveLiquidityRunwayYears(inputs).years,
        minCashBufferMonths: inputs.minCashBufferMonths ?? 2,

        endeVJ: marketDataCurrentYear.endeVJ || 0,
        endeVJ_1: marketDataCurrentYear.endeVJ_1 || 0,
        endeVJ_2: marketDataCurrentYear.endeVJ_2 || 0,
        endeVJ_3: marketDataCurrentYear.endeVJ_3 || 0,
        ath: marketDataCurrentYear.ath || marketDataHist.ath || 0,
        jahreSeitAth: marketDataCurrentYear.jahreSeitAth ?? marketDataHist.jahreSeitAth ?? 0
    };

    // Die Engine liest diese Simulatorfelder nicht (auch nicht per in/hasOwn).
    engineInput.survivorFlexPercent = undefined;
    engineInput.survivorMinimumFlexPercent = undefined;

    // Ohne Todesfall gilt weiterhin die Altersprüfung der Engine aus beiden Altern.
    const anyAlive = p1Alive || (inputs.partner?.aktiv && p2Alive);
    if (anyAlive && (!p1Alive || (inputs.partner?.aktiv && !p2Alive))) {
        engineInput.goGoAge = Math.max(
            p1Alive ? inputs.startAlter + yearIndex : 0,
            inputs.partner?.aktiv && p2Alive ? inputs.partner.startAlter + yearIndex : 0
        );
    }

    // Eine leere aktuelle Liste ersetzt ebenfalls das ursprüngliche Startinventar.
    engineInput.detailledTranches = detailedTranches;

    // Paritäts-Replay unterscheidet fehlende und eigene undefined-Felder.
    // Nur dort die ursprüngliche Schlüsselmenge herstellen, ohne delete im
    // jährlichen Eingabepfad (PE-1/MP-1). Die Engine nutzt beide Felder nicht.
    if (preserveInputShape) {
        const replayInput = {};
        for (const key of Object.keys(engineInput)) {
            if (key !== 'survivorFlexPercent' && key !== 'survivorMinimumFlexPercent') replayInput[key] = engineInput[key];
        }
        return { engineInput: replayInput, detailedTranches };
    }
    return { engineInput, detailedTranches };
}
