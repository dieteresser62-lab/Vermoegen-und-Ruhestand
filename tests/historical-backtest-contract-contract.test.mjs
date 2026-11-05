import * as facade from '../app/simulator/historical-backtest-contract.js';
import * as schema from '../app/simulator/historical-backtest-contract/schema.js';
import * as values from '../app/simulator/historical-backtest-contract/values.js';
import * as validation from '../app/simulator/historical-backtest-contract/validation.js';
import * as yearRecord from '../app/simulator/historical-backtest-contract/year-record.js';
import * as providerModule from '../app/simulator/historical-backtest-contract/provider.js';

const facadeBindings = {
    HISTORICAL_YEAR_RECORD_SCHEMA_VERSION: schema.HISTORICAL_YEAR_RECORD_SCHEMA_VERSION,
    HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION: schema.HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION,
    HISTORICAL_TEMPORAL_CONVENTION_ID: schema.HISTORICAL_TEMPORAL_CONVENTION_ID,
    HISTORICAL_ASSIGNMENT_INVENTORY_V1: schema.HISTORICAL_ASSIGNMENT_INVENTORY_V1,
    canonicalizeHistoricalContractValue: values.canonicalizeHistoricalContractValue,
    sha256Hex: values.sha256Hex,
    computeHistoricalDatasetHash: values.computeHistoricalDatasetHash,
    HistoricalDataContractError: validation.HistoricalDataContractError,
    validateHistoricalDataManifest: validation.validateHistoricalDataManifest,
    buildHistoricalYearRecord: yearRecord.buildHistoricalYearRecord,
    validateHistoricalYearRecord: yearRecord.validateHistoricalYearRecord,
    createHistoricalBacktestContractProvider: providerModule.createHistoricalBacktestContractProvider
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(facadeBindings).sort()),
    'Die Fassade erhält die zwölf öffentlichen Vertragsnamen');
for (const [name, value] of Object.entries(facadeBindings)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}

const events = [];
const provider = facade.createHistoricalBacktestContractProvider();
const providerFromModule = providerModule.createHistoricalBacktestContractProvider({
    instrumentation: { onCacheHit: event => events.push(event) }
});
assert(providerFromModule === provider, 'Fassade und Definitionsmodul verwenden denselben Provider-Cache');
assertEqual(events.length, 1, 'Der zweite Zugang trifft den bereits validierten Cache genau einmal');
