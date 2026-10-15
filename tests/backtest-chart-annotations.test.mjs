import { buildBacktestChartAnnotations, layoutBacktestChartLabels } from '../app/simulator/backtest-chart-annotations.js';

const row = (jahr, patch = {}) => ({ jahr, wertAktien: 1000, wertGold: 0, liquiditaet: 100,
    row: { recordType: 'financial_year', financiallyEvaluable: true,
        entscheidung: { kuerzungProzent: 0 }, minimumFlexAnnual: 100, flex_wunsch_haushalt_nominal: 200,
        flex_haushalt_erfuellt: 100, inflation: 0, inflation_factor_cum: 1,
        portfolio_total_end: 1100, steuern_gesamt: 100, ...patch } });
const result = rows => ({ rows, portfolioStart: 1200, outcome: { kind: 'completed' } });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const data = freeze(result([
    row(2000, { entscheidung: { kuerzungProzent: 10 } }), row(2001, { entscheidung: { kuerzungProzent: 20 } }),
    row(2002, { entscheidung: { kuerzungProzent: 9.999 } }), row(2003, { entscheidung: { kuerzungProzent: 10 } }),
    row(2004, { entscheidung: null }), row(2005, { entscheidung: { kuerzungProzent: 30 } }),
    row(2007, { entscheidung: { kuerzungProzent: 40 } }),
    row(2008, { recordType: 'terminal_ruin', financiallyEvaluable: false, entscheidung: { kuerzungProzent: 100 } })
]));
const before = JSON.stringify(data), annotations = buildBacktestChartAnnotations(data);
assertEqual(JSON.stringify(data), before, 'Chartauswahl verändert keine eingefrorenen Laufbelege');
assertEqual(annotations.bands.map(band => band.label).join('|'),
    'Flex gekürzt 2000–2001|Flex gekürzt 2003–2003|Flex gekürzt 2005–2005|Flex gekürzt 2007–2007',
    'Kürzungsbänder verwenden genau 10 %, trennen fehlende Werte und Jahre und ignorieren Terminalkürzungen');
assertEqual(annotations.missingCutYears, 1, 'Fehlende Kürzung bleibt unbekannt statt ohne Kürzung');
assertEqual(buildBacktestChartAnnotations(result([row(2000)])).bands.length, 0, 'Ohne Kürzung kein Band');
assertEqual(buildBacktestChartAnnotations(null).markers.length, 0, 'Ohne Lauf keine erfundenen Marken');
assert(!annotations.markers.some(marker => marker.type === 'minimum_flex_held'), 'Gehaltenes Mindest-Flex ist keine Ereignismarke');

const many = result([
    row(2000), row(2001, { portfolio_total_end: 500 }),
    row(2002, { flex_haushalt_erfuellt: 99 }),
    row(2003, { RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePct: 90 }),
    row(2004, { RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePct: 80 }),
    row(2005, { steuern_gesamt: 5000 }),
    row(2006, { executedSaleEq: 500, gold_after_return: 0, gold_after_sales: 0, bondSaleAmount: 0 }),
    row(2007, { floor_shortfall_nominal: 500 }),
    row(2008, { recordType: 'terminal_ruin', financiallyEvaluable: false })
]);
many.outcome = { kind: 'ruin', ruinYear: 2008 };
const selected = buildBacktestChartAnnotations(many).markers;
assertEqual(selected.length, 5, 'Höchstens fünf wichtigste Ereignisjahre');
assertEqual(selected[0].type, 'ruin', 'Ruin erhält die höchste Markenpriorität');
assertEqual(selected[1].type, 'floor_shortfall', 'Grundbedarf erhält Vorrang vor weiteren Ereignissen');
assert(selected.some(marker => marker.type === 'below_minimum_flex_phase'), 'Mindest-Flex bleibt von Entnahmekürzung getrennt');
assertEqual(new Set(selected.map(marker => marker.year)).size, selected.length, 'Mehrere Ereignisse desselben Jahres bilden eine Marke');
assertEqual(new Set(selected.map(marker => marker.type)).size, selected.length, 'Wiederholte Ereignisarten verdrängen keine anderen Marken');
const unknown = buildBacktestChartAnnotations(result([row(2000, { inflation: null, portfolio_total_end: null, entscheidung: null })]));
assert(!unknown.markers.some(marker => marker.type === 'minimum_real_year_end_wealth') && !unknown.bands.length,
    'Ohne Belege weder reales Tief noch Kürzungsband');
const unplotted = row(2000, { portfolio_total_end: 1 }); unplotted.wertAktien = null;
assert(!buildBacktestChartAnnotations(result([unplotted, row(2001)])).markers.some(marker => marker.year === 2000),
    'Ohne belegten Portfoliopunkt keine erfundene Markenposition');

for (const width of [672, 1400, 2000]) {
    const items = Array.from({ length: 5 }, (_, i) => ({ label: `Mindest-Flex ${2000 + i}`, year: i }));
    const positions = layoutBacktestChartLabels(items, item => 124 + item.year * 5, 124, 124 + width);
    assert(positions.every(item => item.center - item.labelWidth / 2 >= 124 && item.center + item.labelWidth / 2 <= 124 + width),
        'Beschriftungen bleiben auch bei dicht benachbarten Jahren vollständig im Plot');
    assert(positions.every((item, i) => positions.slice(i + 1).every(other => item.lane !== other.lane
        || Math.abs(item.center - other.center) >= (item.labelWidth + other.labelWidth) / 2 + 12)),
        'Beschriftungen teilen eine Zeile nur mit Abstand');
}
