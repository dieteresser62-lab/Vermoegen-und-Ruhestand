import { projectBacktestEuroMetrics, projectBacktestChartSeries } from '../app/simulator/backtest-euro-display.js';
import { buildBacktestAnalysisView } from '../app/simulator/backtest-log-analysis.js';
import { buildBacktestChartAnnotations } from '../app/simulator/backtest-chart-annotations.js';
import { renderBacktestEuroResults } from '../app/simulator/simulator-backtest.js';
import { bindEuroMode, getEuroMode } from '../app/simulator/euro-display.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';

const row = (jahr, factor, patch = {}) => ({ jahr, inflationVJ: 100, wertAktien: 800, wertGold: 100,
    liquiditaet: 100, entscheidung: { jahresEntnahme: jahr === 2000 ? 200 : 800 },
    row: { recordType: 'financial_year', financiallyEvaluable: true, inflation_factor_cum: factor,
        portfolio_total_end: jahr === 2000 ? 1200 : 2000, health_bucket_end: 1000,
        steuern_gesamt: jahr === 2000 ? 20 : 80, bondBucketAfter: 200,
        entscheidung: { kuerzungProzent: 20 }, minimumFlexAnnual: 400, flex_haushalt_erfuellt: 0,
        flex_wunsch_haushalt_nominal: 800, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20,
        ...patch } });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const result = freeze({ rows: [row(2000, 1), row(2001, 2)], portfolioStart: 1600, portfolioEnd: 2000,
    request: { startYear: 2000, endYear: 2001 }, outcome: { kind: 'completed' }, requestedYears: 2, completedYears: 2,
    summary: { healthBucket: { enabled: true, end: 1000, targetGap: 400, realCoveragePct: 50 } },
    metrics: { values: { wealth_start_nominal_eur: 1600, wealth_end_nominal_eur: 2000,
        withdrawal_total_nominal_eur: 1000, tax_total_nominal_eur: 100, health_bucket_end_nominal_eur: 1000,
        flex_reduction_years_gte_10_pct: 2, flex_reduction_longest_streak_gte_10_pct: 2 } } });
const bytes = JSON.stringify(result);
const { nominal, real } = projectBacktestEuroMetrics(result);
assertEqual(real.wealth_start_nominal_eur, 1600, 'Startvermögen bleibt in Euro des Startjahrs gleich');
assertEqual(real.wealth_end_nominal_eur, 500, 'Reales Endvermögen verwendet den protokollierten Endfaktor 4');
assertEqual(real.withdrawal_total_nominal_eur, 300, 'Entnahmen werden jährlich deflationiert: 200/2 + 800/4');
assertEqual(real.tax_total_nominal_eur, 30, 'Steuern werden jährlich deflationiert: 20/2 + 80/4');
assertEqual(real.health_bucket_end_nominal_eur, 250, 'Pflegereserve verwendet den Endfaktor');
assertEqual(real.health_bucket_target_gap, 100, 'Pflegeziellücke verwendet den Endfaktor');
assertEqual(nominal.withdrawal_total_nominal_eur, 1000, 'Nominale Summen bleiben unverändert genau');
assertEqual(real.flex_reduction_years_gte_10_pct, nominal.flex_reduction_years_gte_10_pct, 'Jahreszahlen bleiben gleich');

const series = projectBacktestChartSeries(result, 'real');
assertEqual(series[0].total, 500, 'Realer Verlauf deflationiert denselben Bestand ohne Pflegereserve');
assertEqual(series[1].etf, 150, 'ETF ohne Bondpuffer wird mit dem Jahresfaktor umgerechnet');
assertEqual(series[1].bond, 50, 'Bondpuffer folgt derselben Basis');
assertEqual(series[1].gold, 25, 'Gold folgt derselben Basis');
assertEqual(series[1].liq, 25, 'Liquidität folgt derselben Basis');
assertEqual(series[1].year, 2001, 'Kalenderjahre ändern sich nicht');
assertEqual(projectBacktestChartSeries(result)[1].total, 1000, 'Chart startet nominal');

for (const moneyBasis of ['nominal', 'real']) {
    const view = buildBacktestAnalysisView(result, { moneyBasis });
    const points = [...view.cards, ...view.more];
    assert(points.find(point => point.type === 'minimum_real_year_end_wealth').valueText.includes(moneyBasis === 'real' ? '500 €' : '2.000 €'), 'Auffälliges zeigt den gewählten Betrag im selben Kaufkraft-Tiefjahr');
    assert(points.find(point => point.type === 'below_minimum_flex_phase').text.includes(moneyBasis === 'real' ? '200 €' : '400 €'), 'Auch Fehlbeträge im Erklärungstext folgen dem Schalter');
    assert(points.find(point => point.type === 'end_wealth').valueText.includes(moneyBasis === 'real' ? '500 €' : '2.000 €'), 'Auffälliges-Endstand folgt dem Schalter');
    assert(view.source.includes(moneyBasis === 'real' ? 'Euro von 2000' : 'nominal'), 'Auffälliges nennt die Basis im Kopf');
}
const identity = view => view.model.events.map(event => [event.id, event.year, event.type]);
assertEqual(JSON.stringify(identity(buildBacktestAnalysisView(result))), JSON.stringify(identity(buildBacktestAnalysisView(result, { moneyBasis: 'real' }))), 'Ereignisse und Schwellen bleiben beim Wechsel gleich');
assertEqual(JSON.stringify(buildBacktestChartAnnotations(result).markers.map(marker => marker.id)), JSON.stringify(buildBacktestChartAnnotations(result, { moneyBasis: 'real' }).markers.map(marker => marker.id)), 'Chartmarken bleiben an denselben Ereignisjahren');

const missing = { ...result, rows: [row(2000, null), row(2001, 2)] };
const unknown = projectBacktestEuroMetrics(missing);
for (const id of ['wealth_end_nominal_eur', 'withdrawal_total_nominal_eur', 'tax_total_nominal_eur', 'health_bucket_end_nominal_eur', 'health_bucket_target_gap']) {
    assertEqual(unknown.real[id], null, `${id}: fehlende Inflationsbelege bleiben unbekannt`);
    assertEqual(unknown.nominal[id], nominal[id], `${id}: nominal bleibt bei fehlender Inflation verfügbar`);
}
assertEqual(projectBacktestChartSeries(missing, 'real')[1].total, null, 'Nach fehlender Inflation wird kein realer Verlauf geraten');
assertEqual(projectBacktestEuroMetrics({ ...result, rows: [] }).real.withdrawal_total_nominal_eur, null, 'Ohne Jahresbelege keine reale Entnahmesumme');
const deflation = { ...result, rows: [{ ...row(2000, 1), inflationVJ: -20 }] };
assertEqual(projectBacktestEuroMetrics(deflation).real.wealth_end_nominal_eur, 2500, 'Auch Deflation wird unverändert aus dem Log gelesen');

const annual = { ...row(2001, 2, { rente1: 60, rente2: 40, renteSum: 100, lossCarryEnd: 40,
    entnahme_effektiv: 800, jahresentnahme_real: 400 }), netA: 320, netG: -160 };
const realColumns = getProtocolColumns({ source: 'backtest', moneyBasis: 'real', logDetailLevel: 'detailed' });
for (const [id, expected] of [['rente1', '15 €'], ['rente2', '10 €'], ['rentesum', '25 €'],
    ['steuern-gesamt', '20 €'], ['losscarryend', '10 €'], ['neta', 'verkauft 80 €'], ['netg', 'gekauft 40 €'],
    ['entnahme-effektiv', '200 €'], ['jahresentnahme-real', '200 €']]) {
    const column = realColumns.find(column => column.id === id);
    assertEqual(column.valueFormatter(readProtocolValue(column, annual, { source: 'backtest' }), annual), expected,
        id + ': Personenrenten, Steuern und Handel folgen dem protokollierten Inflationsfaktor');
}

class Element {
    constructor() { this.innerHTML = ''; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type) { this.listeners.delete(type); }
    querySelectorAll() { return []; }
    querySelector() { return null; }
}
const elements = Object.fromEntries(['simulationSummary', 'backtestResultHeading', 'backtestChartHeading', 'backtestEuroHint', 'simulationLog', 'backtestProtocolSummary', 'backtestAnalysis', 'portfolioCompositionChart'].map(id => [id, new Element()]));
const doc = { getElementById: id => elements[id] ?? null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
const host = () => {
    const node = new Element();
    node.buttons = ['real', 'nominal'].map(mode => { const button = new Element(); button.setAttribute('data-wealth-mode', mode); return button; });
    node.querySelectorAll = () => node.buttons;
    node.click = mode => node.listeners.get('click')({ target: { closest: () => node.buttons.find(button => button.getAttribute('data-wealth-mode') === mode) } });
    return node;
};
const saved = { document: globalThis.document, window: globalThis.window };
const cleanup = [];
try {
    globalThis.document = doc;
    globalThis.window = { globalBacktestData: { result, rows: result.rows } };
    elements.simulationLog.innerHTML = renderProtocolTable(result.rows, { source: 'backtest', startYear: 2000 });
    elements.backtestProtocolSummary.innerHTML = 'Jahresprotokoll · nominale Euro';
    const protocol = elements.simulationLog.innerHTML;
    const bt = host(), mc = host();
    cleanup.push(bindEuroMode(doc, bt, renderBacktestEuroResults), bindEuroMode(doc, mc, () => {}));
    assertEqual(getEuroMode(doc), 'nominal', 'Beide Reiter starten nominal');
    mc.click('real');
    assertEqual(bt.buttons[0].getAttribute('aria-pressed'), 'true', 'Monte-Carlo-Wahl aktualisiert Backtest-Schalter');
    assertEqual(elements.backtestResultHeading.textContent, 'Kennzahlen · Euro von 2000', 'Überschrift folgt Sitzung und eingefrorenem Startjahr');
    assertEqual(elements.backtestChartHeading.textContent, 'Portfolioverlauf · Euro von 2000', 'Chartkopf folgt Sitzung');
    assert(elements.simulationSummary.innerHTML.includes('data-display-value="500"') && elements.simulationSummary.innerHTML.includes('data-display-value="300"'), 'Beide Hauptkennzahlen schalten um');
    assert(elements.simulationSummary.innerHTML.includes('data-display-value="30"') && elements.simulationSummary.innerHTML.includes('data-display-value="250"'), 'Weitere Geldkennzahlen schalten um');
    assertEqual((elements.simulationSummary.innerHTML.match(/class="sim-other-basis"/g) ?? []).length, 2, 'Nur Endvermögen und Gesamtentnahmen bekommen den Gegenwert');
    assert(elements.simulationSummary.innerHTML.includes('nominal etwa 2.000') && elements.simulationSummary.innerHTML.includes('nominal etwa 1.000'), 'Reale Hauptwerte zeigen nominale Gegenwerte');
    assert(elements.backtestAnalysis.innerHTML.includes('Euro von 2000'), 'Auffälliges wird bei MC-Wahl neu projiziert');
    assert(elements.simulationLog.innerHTML !== protocol && elements.simulationLog.innerHTML.includes('500 €'), 'Jahresprotokoll zeigt den realen Endstand');
    assert(elements.backtestProtocolSummary.innerHTML.includes('Euro von 2000') && elements.backtestProtocolSummary.innerHTML.includes('500 €'), 'Protokollkopf und Endwert folgen der gewählten Basis');
    bt.click('nominal');
    assertEqual(elements.simulationLog.innerHTML, protocol, 'Zurück auf Nominal erhält die ursprüngliche Jahrestabelle');
    assertEqual(mc.buttons[1].getAttribute('aria-pressed'), 'true', 'Backtest-Wahl aktualisiert Monte-Carlo-Schalter');
    assert(elements.simulationSummary.innerHTML.includes('in Kaufkraft von 2000 etwa 500') && elements.simulationSummary.innerHTML.includes('in Kaufkraft von 2000 etwa 300'), 'Nominale Hauptwerte zeigen reale Gegenwerte');
    mc.click('real');
    renderBacktestEuroResults();
    assertEqual(getEuroMode(doc), 'real', 'Neuer Render erhält die gemeinsame Sitzungswahl');
    assertEqual(getEuroMode({}), 'nominal', 'Neue Seitensitzung beginnt nominal');
    assertEqual(JSON.stringify(window.globalBacktestData.result), bytes, 'Umschalten verändert weder Runnerdaten noch Exportquelle');
} finally {
    cleanup.forEach(dispose => dispose());
    globalThis.document = saved.document;
    globalThis.window = saved.window;
}
assertEqual(JSON.stringify(result), bytes, 'Alle Projektionen lassen den eingefrorenen Laufbeleg bytegleich');
