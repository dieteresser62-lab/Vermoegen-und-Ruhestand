import { analyzeScenario } from './log-analysis-events.js';
import { buildLogAnalysisView, logAnalysisHtml, renderLogAnalysis } from './log-analysis-view.js';

const presentation = {
    hostId: 'scenarioLogAnalysis',
    yearPrefix: 'scenario-year-', yearAttribute: 'data-scenario-analysis-year', logId: 'scenarioLogOutput', mc: true
};

/** Ausschließlich der ausgewählte Laufbeleg und sein eingefrorener Kontext. */
export function buildScenarioAnalysisView(scenario, options = {}) {
    if (!Array.isArray(scenario?.logDataRows) || !scenario.logDataRows.length) return null;
    const model = analyzeScenario(scenario, options);
    const index = model.sourceIdentity?.absoluteRunIndex;
    const run = Number.isSafeInteger(index) && index >= 0 ? `Pfad ${index + 1}` : 'Pfadnummer unbekannt';
    const dated = scenario.logDataRows.map(row => row?.jahr).filter(Number.isInteger);
    const period = dated.length ? `Simulationsjahr ${dated[0]}–${dated.at(-1)}` : 'Simulationsjahre unbekannt';
    return buildLogAnalysisView(model, { rows: scenario.logDataRows, startYear: options.startYear,
        source: `${scenario.label || 'Gewählter Pfad'} · ${run} · ${period} · aus dem Jahresprotokoll` });
}

export const scenarioAnalysisHtml = view => logAnalysisHtml(view, presentation);
export const renderScenarioAnalysis = (doc, scenario, options) => renderLogAnalysis(doc, buildScenarioAnalysisView(scenario, options), presentation);
