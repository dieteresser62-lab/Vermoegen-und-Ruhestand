// Bisherige direkte Ladeabhängigkeit vor den Teilmodulen erhalten.
export {} from './simulator-data.js';

export { canonicalizeHistoricalContractValue, sha256Hex, computeHistoricalDatasetHash } from './historical-backtest-contract/values.js';
export { HISTORICAL_YEAR_RECORD_SCHEMA_VERSION, HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION, HISTORICAL_TEMPORAL_CONVENTION_ID, HISTORICAL_ASSIGNMENT_INVENTORY_V1 } from './historical-backtest-contract/schema.js';
export { HistoricalDataContractError, validateHistoricalDataManifest } from './historical-backtest-contract/validation.js';
export { buildHistoricalYearRecord, validateHistoricalYearRecord } from './historical-backtest-contract/year-record.js';
export { createHistoricalBacktestContractProvider } from './historical-backtest-contract/provider.js';
