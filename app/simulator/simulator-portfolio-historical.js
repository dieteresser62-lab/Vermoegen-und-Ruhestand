/**
 * Module: Simulator Portfolio Historical
 * Purpose: Preparing and analyzing historical market data.
 *          Calculates returns, inflation, and market regimes from raw data.
 * Usage: Called by simulator-portfolio.js facade.
 * Dependencies: simulator-data.js, historical-backtest-contract.js
 */
"use strict";

import {
    annualData,
    assertHistoricalRegimeContract,
    simulatorDataContractError
} from './simulator-data.js';
import { createHistoricalBacktestContractProvider } from './historical-backtest-contract.js';

/**
 * Dieselbe Prüfung wie beim Backtest: Inhaltshash und Randjahre der Jahressätze gegen den Datenstand.
 * Dazu müssen die Stichprobenjahre genau den Zeitraum des Datenstands abdecken.
 */
function assertHistoricalDataStatus() {
    let bounds;
    try {
        bounds = createHistoricalBacktestContractProvider().bounds;
    } catch (error) {
        const contractError = simulatorDataContractError('SIMULATOR_HISTORICAL_DATA_CONTRACT',
            `Historical data do not match the data status (${error?.code || 'unknown'}): ${error?.message || String(error)}`);
        contractError.cause = error;
        throw contractError;
    }
    const firstYear = annualData[0]?.jahr, lastYear = annualData[annualData.length - 1]?.jahr;
    if (firstYear !== bounds.datasetStartYear || lastYear !== bounds.datasetEndYear) {
        throw simulatorDataContractError('SIMULATOR_HISTORICAL_DATA_CONTRACT',
            `Sampling years ${firstYear}-${lastYear} do not match the data status ${bounds.datasetStartYear}-${bounds.datasetEndYear}.`);
    }
}

/**
 * Bereitet historische Daten auf und prüft sie vor jedem Monte-Carlo-Start:
 * Inhaltshash und Randjahre gegen den Datenstand, danach die Regimeverteilung.
 *
 * @returns Ergebnis der Operation.
 */
export function prepareHistoricalData() {
    if (!Array.isArray(annualData) || annualData.length === 0) {
        throw simulatorDataContractError(
            'SIMULATOR_HISTORICAL_DATA_UNAVAILABLE',
            'Canonical historical data must be initialized before simulation.'
        );
    }
    assertHistoricalDataStatus();
    assertHistoricalRegimeContract();
    return annualData;
}
