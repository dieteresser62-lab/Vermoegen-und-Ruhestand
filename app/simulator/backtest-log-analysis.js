import { analyzeBacktest } from './log-analysis-events.js';
import { detectDynamicFlexPreset, DYNAMIC_FLEX_OPTIONS } from '../shared/dynamic-flex-presets.js';
import { buildLogAnalysisView, logAnalysisHtml, renderLogAnalysis, jumpToLogAnalysisYear } from './log-analysis-view.js';

function sourceLine(data) {
    const result = data.result ?? data;
    const names = (data.personDisplayContext?.persons ?? data.personDataContext?.persons ?? [])
        .map(person => person.name).filter(name => typeof name === 'string' && name.trim());
    const period = result.request?.period ?? result.request;
    const preset = result.request?.inputs ? detectDynamicFlexPreset(result.request.inputs) : null;
    return [names.length ? `Haushalt: ${names.join(', ')}` : 'Aktueller Backtest',
        period?.startYear != null && period?.endYear != null ? `${period.startYear}–${period.endYear}` : 'Zeitraum unbekannt',
        preset === 'off' ? 'Dynamik aus' : DYNAMIC_FLEX_OPTIONS.find(([key]) => key === preset)?.[1], 'aus dem Jahresprotokoll']
        .filter(Boolean).join(' · ');
}

const presentation = {
    hostId: 'backtestAnalysis',
    yearPrefix: 'backtest-year-', yearAttribute: 'data-backtest-analysis-year', logId: 'simulationLog'
};

export function buildBacktestAnalysisView(data) {
    const result = data?.result ?? data;
    if (!result?.rows) return null;
    return buildLogAnalysisView(analyzeBacktest(data), { rows: result.rows, source: sourceLine(data),
        startYear: result.request?.period?.startYear ?? result.request?.startYear });
}

export const backtestAnalysisHtml = view => logAnalysisHtml(view, presentation);
export const jumpToBacktestYear = (doc, year, state = {}) => jumpToLogAnalysisYear(doc, year, presentation, state);
export const renderBacktestAnalysis = (doc, data) => renderLogAnalysis(doc, buildBacktestAnalysisView(data), presentation);
