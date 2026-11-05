// @ts-check
/** @import {EngineSuccess,SimulationPortfolio} from '../../../typcheck/rechenkern' */

/** @param {SimulationPortfolio} portfolio */
export function captureEngineBoundaryPortfolio(portfolio) {
    /** @param {import('../../../typcheck/rechenkern').EngineTranche[]|null|undefined} tranches */
    const captureTranches = tranches => Array.isArray(tranches)
        ? tranches.map(tranche => ({
            marketValue: tranche?.marketValue,
            hasTrancheId: Object.prototype.hasOwnProperty.call(tranche || {}, 'trancheId'),
            trancheId: tranche?.trancheId
        }))
        : [];
    return {
        equityTranches: captureTranches(portfolio?.depotTranchesAktien),
        goldTranches: captureTranches(portfolio?.depotTranchesGold),
        moneyMarketTranches: captureTranches(portfolio?.depotTranchesGeldmarkt),
        hasSimulationDate: Object.prototype.hasOwnProperty.call(portfolio || {}, 'simulationDate'),
        simulationDate: portfolio?.simulationDate,
        hasSourceProfileId: Object.prototype.hasOwnProperty.call(portfolio || {}, 'simulationSourceProfileId'),
        simulationSourceProfileId: portfolio?.simulationSourceProfileId
    };
}

/** @param {SimulationPortfolio} portfolio
 * @param {ReturnType<typeof captureEngineBoundaryPortfolio>} snapshot */
export function restoreEngineBoundaryPortfolio(portfolio, snapshot) {
    /** @param {import('../../../typcheck/rechenkern').EngineTranche[]|null|undefined} tranches
 * @param {ReturnType<typeof captureEngineBoundaryPortfolio>["equityTranches"]} trancheSnapshots */
    const restoreTranches = (tranches, trancheSnapshots) => {
        if (!Array.isArray(tranches)) return;
        for (let i = 0; i < tranches.length && i < trancheSnapshots.length; i++) {
            const trancheSnapshot = trancheSnapshots[i];
            tranches[i].marketValue = trancheSnapshot.marketValue;
            if (trancheSnapshot.hasTrancheId) tranches[i].trancheId = trancheSnapshot.trancheId;
            else delete tranches[i].trancheId;
        }
    };
    restoreTranches(portfolio?.depotTranchesAktien, snapshot.equityTranches);
    restoreTranches(portfolio?.depotTranchesGold, snapshot.goldTranches);
    restoreTranches(portfolio?.depotTranchesGeldmarkt, snapshot.moneyMarketTranches);
    if (snapshot.hasSimulationDate) portfolio.simulationDate = snapshot.simulationDate;
    else delete portfolio.simulationDate;
    if (snapshot.hasSourceProfileId) portfolio.simulationSourceProfileId = snapshot.simulationSourceProfileId;
    else delete portfolio.simulationSourceProfileId;
}

/** @param {Record<string,unknown>|null|undefined} target
 * @param {string} key
 * @param {number} scale */
export function scaleFiniteRealValue(target, key, scale) {
    if (!target || !Number.isFinite(target[key])) return;
    target[key] *= scale;
}

/** @param {EngineSuccess} fullResult
 * @param {number} cumulativeInflationFactor */
export function alignEngineInflationContract(fullResult, cumulativeInflationFactor) {
    const spendingNewState = fullResult?.newState;
    if (!spendingNewState) return;

    const engineFactor = Number(spendingNewState.cumulativeInflationFactor);
    const validEngineFactor = Number.isFinite(engineFactor) && engineFactor > 0
        ? engineFactor
        : 1;
    const realValueScale = validEngineFactor / cumulativeInflationFactor;

    scaleFiniteRealValue(spendingNewState, 'peakRealVermoegen', realValueScale);
    scaleFiniteRealValue(spendingNewState, 'lastEntnahmeReal', realValueScale);
    spendingNewState.cumulativeInflationFactor = cumulativeInflationFactor;

    const spendingDetails = fullResult.ui?.spending?.details;
    scaleFiniteRealValue(spendingDetails, 'peakRealVermoegen', realValueScale);
    scaleFiniteRealValue(spendingDetails, 'currentRealVermoegen', realValueScale);
    if (spendingDetails) {
        spendingDetails.cumulativeInflationFactor = cumulativeInflationFactor;
    }

    const diagnosisKeyParams = fullResult.diagnosis?.keyParams;
    scaleFiniteRealValue(diagnosisKeyParams, 'peakRealVermoegen', realValueScale);
    scaleFiniteRealValue(diagnosisKeyParams, 'currentRealVermoegen', realValueScale);
    if (diagnosisKeyParams) {
        diagnosisKeyParams.cumulativeInflationFactor = cumulativeInflationFactor;
    }
}
