import fs from 'node:fs';

console.log('--- Slice 02 Risk Display Copy Contract Tests ---');

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const resultsMetrics = ['dashboard', 'stress', 'care'].map(part =>
    read(`app/simulator/results-metrics/${part}.js`)).join('\n');
const heatmap = read('app/simulator/simulator-heatmap.js');
const scenarioAnalyzer = read('app/simulator/scenario-analyzer.js');

assert(
    resultsMetrics.includes('Zeitanteil realisierte Entnahmequote > 4,5 %')
        && resultsMetrics.includes('nur eine Berichtsreferenz')
        && resultsMetrics.includes('keine Alarm- oder Leitplanken-Schwelle'),
    'Result cards should bind the 4.5-percent KPI to realized rate, strict > and reporting-only role'
);

assert(
    heatmap.includes('realisierte Entnahmequote ≥ 4,5 % (gezählt je Quotenstufe)')
        && heatmap.includes('nur eine Berichtsreferenz')
        && heatmap.includes('keine Alarm- oder Leitplanken-Schwelle'),
    'Heatmap copy should bind the overlay to realized rate, bin-based >= and reporting-only role'
);

assert(
    scenarioAnalyzer.includes("p10: 'P10 des Geldendvermögens'"),
    'Scenario selector should name the P10 path selection criterion'
);

assert(
    resultsMetrics.includes("'Geldvermögen: Gruppenmedian-Differenz (nicht kausal)'"),
    'Care group comparison should state non-causality in the visible title'
);

console.log('--- Slice 02 Risk Display Copy Contract Tests Completed ---');
