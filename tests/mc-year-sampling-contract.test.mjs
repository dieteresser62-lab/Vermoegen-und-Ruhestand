import * as facade from '../app/simulator/mc-year-sampling.js';
import * as schema from '../app/simulator/mc-year-sampling/schema.js';
import * as samplers from '../app/simulator/mc-year-sampling/samplers.js';
import * as configuration from '../app/simulator/mc-year-sampling/configuration.js';
import * as contract from '../app/simulator/mc-year-sampling/contract.js';
import * as runtime from '../app/simulator/mc-year-sampling/runtime.js';
import * as diagnostics from '../app/simulator/mc-year-sampling/diagnostics.js';
import * as startYear from '../app/simulator/mc-year-sampling/start-year.js';

{
    const expected = {
        MIN_START_YEAR_INDEX: schema.MIN_START_YEAR_INDEX,
        MONTE_CARLO_SAMPLING_CONTRACT_VERSION: schema.MONTE_CARLO_SAMPLING_CONTRACT_VERSION,
        MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION: schema.MONTE_CARLO_SAMPLING_DIAGNOSTICS_VERSION,
        buildCdfFromIndices: samplers.buildCdfFromIndices,
        pickFromSampler: samplers.pickFromSampler,
        resolveMinStartYearIndex: configuration.resolveMinStartYearIndex,
        buildYearSamplingConfig: configuration.buildYearSamplingConfig,
        buildStartYearCdf: configuration.buildStartYearCdf,
        resolveMonteCarloSamplingContractV1: contract.resolveMonteCarloSamplingContractV1,
        initializeMonteCarloSamplingStateV1: runtime.initializeMonteCarloSamplingStateV1,
        sampleMonteCarloYearV1: runtime.sampleMonteCarloYearV1,
        createMonteCarloSamplingDiagnosticsV1: diagnostics.createMonteCarloSamplingDiagnosticsV1,
        recordMonteCarloSamplingStartV1: diagnostics.recordMonteCarloSamplingStartV1,
        recordMonteCarloSampledYearV1: diagnostics.recordMonteCarloSampledYearV1,
        finalizeMonteCarloSamplingDiagnosticsV1: diagnostics.finalizeMonteCarloSamplingDiagnosticsV1,
        assertMonteCarloSamplingDiagnosticsV1: diagnostics.assertMonteCarloSamplingDiagnosticsV1,
        mergeMonteCarloSamplingDiagnosticsV1: diagnostics.mergeMonteCarloSamplingDiagnosticsV1,
        pickStartYearIndex: startYear.pickStartYearIndex,
        pickMonteCarloStartYearIndex: startYear.pickMonteCarloStartYearIndex
    };
    assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
        'Fassade erhält alle 19 öffentlichen Namen und hält interne Helfer privat');
    for (const [name, value] of Object.entries(expected)) {
        assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
    }
}
