import * as facade from '../app/simulator/results-metrics.js';
import * as values from '../app/simulator/results-metrics/display-values.js';
import * as minimumFlex from '../app/simulator/results-metrics/minimum-flex.js';
import * as summary from '../app/simulator/results-metrics/summary.js';
import * as dashboard from '../app/simulator/results-metrics/dashboard.js';
import * as stress from '../app/simulator/results-metrics/stress.js';
import * as care from '../app/simulator/results-metrics/care.js';

const expected = {
    WITHDRAWAL_CARD_TITLE: values.WITHDRAWAL_CARD_TITLE,
    LEGACY_FLEX_RESTRICTION_LABEL: minimumFlex.LEGACY_FLEX_RESTRICTION_LABEL,
    hasTechnicalFinancialError: minimumFlex.hasTechnicalFinancialError,
    projectMinimumFlexDisplay: minimumFlex.projectMinimumFlexDisplay,
    buildMonteCarloAnswers: summary.buildMonteCarloAnswers,
    buildSummaryData: summary.buildSummaryData,
    WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE: dashboard.WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE,
    buildKpiDashboard: dashboard.buildKpiDashboard,
    prepareMonteCarloViewModel: dashboard.prepareMonteCarloViewModel,
    buildStressMetrics: stress.buildStressMetrics,
    buildCareMetrics: care.buildCareMetrics
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Fassade erhält die elf öffentlichen Anzeigenamen; interne Helfer bleiben privat');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
