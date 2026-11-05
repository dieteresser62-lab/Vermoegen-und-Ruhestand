import * as facade from '../app/simulator/historical-backtest-runner.js';
import * as schema from '../app/simulator/historical-backtest-runner/schema.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner/entry.js';

const expected = {
    BACKTEST_REQUEST_SCHEMA_VERSION: schema.BACKTEST_REQUEST_SCHEMA_VERSION,
    BACKTEST_RESULT_SCHEMA_VERSION: schema.BACKTEST_RESULT_SCHEMA_VERSION,
    BACKTEST_OUTCOME_KINDS: schema.BACKTEST_OUTCOME_KINDS,
    BACKTEST_TECHNICAL_ERROR_CODES: schema.BACKTEST_TECHNICAL_ERROR_CODES,
    runHistoricalBacktest
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Die Fassade erhält die fünf öffentlichen Runnernamen');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
