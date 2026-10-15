import { analyzeBacktest } from './log-analysis-events.js';
import { backtestChartSeries } from './simulator-crises.js';

const markerLabels = {
    ruin: 'Abbruch', floor_shortfall: 'Grundbedarf ungedeckt', technical_error: 'Lauffehler',
    below_minimum_flex_phase: 'Unter Mindest-Flex', minimum_real_year_end_wealth: 'Reales Tief',
    real_wealth_recovery: 'Real erholt', liquidity_below_target: 'Liquidität unter Ziel',
    policy_state_change: 'Leitplanke/Alarm', forced_liquidity_coverage: 'Notverkauf',
    unmet_liquidity: 'Liquidität fehlt', health_reserve_use: 'Pflegereserve genutzt',
    tax_peak: 'Steuer', large_sale: 'Großer Verkauf', market_regime_change: 'Marktphasenwechsel'
};

/** Anzeigeauswahl aus LA-1; keine zusätzliche Finanz- oder Ereignisrechnung. */
export function buildBacktestChartAnnotations(data) {
    const model = analyzeBacktest(data);
    const chartYears = new Set(backtestChartSeries(data?.result ?? data).filter(point => point.total !== null).map(point => point.year));
    const bands = model.events.filter(event => event.type === 'decision_flex_cut_phase'
        && Number.isInteger(event.evidence.startYear) && Number.isInteger(event.evidence.endYear))
        .map(event => ({ ...event, startYear: event.evidence.startYear, endYear: event.evidence.endYear,
            label: `Flex gekürzt ${event.evidence.startYear}–${event.evidence.endYear}` }));
    const markers = [], types = new Set(), years = new Set();
    // Wiederholungen bündeln; bei mehreren Ereignissen im selben Jahr hat LA-1 Vorrang.
    for (const event of model.prioritizedEvents) {
        if (!markerLabels[event.type] || !Number.isInteger(event.year) || !chartYears.has(event.year)
            || types.has(event.type) || years.has(event.year)) continue;
        markers.push({ ...event, label: `${markerLabels[event.type]} ${event.year}` });
        types.add(event.type); years.add(event.year);
        if (markers.length === 5) break;
    }
    return { bands, markers, missingCutYears: model.cuts.missingYears };
}

/** Beschriftungen bleiben im Plot und teilen sich nur bei freiem Abstand eine Zeile. */
export function layoutBacktestChartLabels(items, xFor, left, right) {
    const lanes = [];
    return items.map(item => {
        const labelWidth = item.label.length * 8 + 20;
        const center = Math.max(left + labelWidth / 2, Math.min(right - labelWidth / 2, xFor(item)));
        const start = center - labelWidth / 2, end = center + labelWidth / 2;
        let lane = lanes.findIndex(intervals => intervals.every(interval => end + 12 <= interval.start || start >= interval.end + 12));
        if (lane < 0) { lane = lanes.length; lanes.push([]); }
        lanes[lane].push({ start, end });
        return { ...item, center, labelWidth, lane };
    });
}
