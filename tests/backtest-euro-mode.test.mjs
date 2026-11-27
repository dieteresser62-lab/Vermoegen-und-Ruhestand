import { projectBacktestEuroMetrics, projectBacktestChartSeries } from '../app/simulator/backtest-euro-display.js';
import { buildBacktestAnalysisView } from '../app/simulator/backtest-log-analysis.js';
import { buildBacktestChartAnnotations } from '../app/simulator/backtest-chart-annotations.js';
import { renderBacktestEuroResults } from '../app/simulator/simulator-backtest.js';
import { bindEuroMode, getEuroMode } from '../app/simulator/euro-display.js';
import { initializeResultOverview } from '../app/simulator/simulator-result-overview.js';
import { renderProtocolTable, protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { formatProtocolValue, getProtocolColumns, PROTOCOL_COLUMNS, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { deriveHistoricalBacktestMetrics } from '../app/simulator/historical-backtest-metrics.js';

const row = (jahr, factor, patch = {}) => ({ jahr, inflationVJ: 100, wertAktien: 800, wertGold: 100,
    liquiditaet: 100, entscheidung: { jahresEntnahme: jahr === 2000 ? 200 : 800 },
    row: { recordType: 'financial_year', financiallyEvaluable: true, inflation_factor_cum: factor,
        portfolio_total_end: jahr === 2000 ? 1200 : 2000, health_bucket_end: 1000,
        steuern_gesamt: jahr === 2000 ? 20 : 80, bondBucketAfter: 200,
        entscheidung: { kuerzungProzent: 20 }, minimumFlexAnnual: 400, flex_haushalt_erfuellt: 0,
        flex_wunsch_haushalt_nominal: 800, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20,
        ...patch } });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const result = freeze({ rows: [row(2000, 1), row(2001, 2, { minimumFlexAnnual: 1000 })], portfolioStart: 1600, portfolioEnd: 2000,
    request: { startYear: 2000, endYear: 2001 }, outcome: { kind: 'completed' }, requestedYears: 2, completedYears: 2,
    summary: { healthBucket: { enabled: true, end: 1000, targetGap: 400, realCoveragePct: 50 } },
    metrics: { values: { wealth_start_nominal_eur: 1600, wealth_end_nominal_eur: 2000,
        withdrawal_total_nominal_eur: 1000, tax_total_nominal_eur: 100, health_bucket_end_nominal_eur: 1000,
        flex_reduction_years_gte_10_pct: 2, flex_reduction_longest_streak_gte_10_pct: 2 } } });
const bytes = JSON.stringify(result);
const { nominal, real } = projectBacktestEuroMetrics(result);
assertEqual(real.wealth_start_nominal_eur, 1600, 'Startvermögen bleibt in Euro des Startjahrs gleich');
assertEqual(real.wealth_end_nominal_eur, 500, 'Reales Endvermögen verwendet den protokollierten Endfaktor 4');
assertEqual(real.withdrawal_total_nominal_eur, 600, 'Entnahmen werden mit dem Faktor am Jahresanfang deflationiert: 200/1 + 800/2');
assertEqual(real.tax_total_nominal_eur, 60, 'Steuern werden mit dem Faktor am Jahresanfang deflationiert: 20/1 + 80/2');
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
    assert(points.find(point => point.type === 'below_minimum_flex_phase').text.includes(moneyBasis === 'real' ? '500 €' : '1.000 €'), 'Auch Fehlbeträge im Erklärungstext folgen dem Schalter, real mit dem Faktor am Jahresanfang');
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

// ST7-FIX (Gutachten ST7 P2-2): Ruin mit Restvermögen (geschützte Pflegereserve). Die Ruin-Zeile trägt keinen Preisfaktor. Real gilt der
// letzte bekannte, der Jahresendfaktor des Vorjahrs (2). Reserve, Ziellücke und Gesamtvermögen zeigen einen Wert statt „—“ oder 0 €.
const ruinRow = { jahr: 2001, inflationVJ: 50, entscheidung: { jahresEntnahme: 0 }, row: { Regime: 'BANKRUPT', aktionUndGrund: '>>> RUIN <<< Testfall',
    portfolio_total_start: 1200, portfolio_total_end: 300, health_bucket_end: 300, immobilien_wert_end: 1000, steuern_gesamt: 0 } };
const ruin = freeze({ ...result, rows: [row(2000, 1), ruinRow], portfolioEnd: 300, outcome: { kind: 'ruin' }, completedYears: 1,
    summary: { healthBucket: { enabled: true, end: 300, targetGap: 400, realCoveragePct: 40 } },
    metrics: { values: { ...result.metrics.values, wealth_end_nominal_eur: 300, health_bucket_end_nominal_eur: 300 } } });
const ruinReal = projectBacktestEuroMetrics(ruin).real;
assertEqual([ruinReal.wealth_end_nominal_eur, ruinReal.health_bucket_end_nominal_eur, ruinReal.health_bucket_target_gap].join(' · '), '150 · 150 · 200',
    'Ruin-Zeile: Geldvermögen, Pflegereserve und Ziellücke mit dem Jahresendfaktor des Vorjahrs');
assertEqual(projectBacktestEuroMetrics({ ...ruin, rows: [{ ...ruinRow, jahr: 2000 }] }).real.wealth_end_nominal_eur, 300, 'Ruin im ersten Jahr: Faktor 1');
assertEqual(projectBacktestEuroMetrics({ ...ruin, rows: [row(2000, 1), { ...ruinRow, jahr: 2002 }] }).real.wealth_end_nominal_eur, null, 'Nach einer Lücke bleibt der Faktor unbekannt');

const annual = { ...row(2001, 2, { rente1: 60, rente2: 40, renteSum: 100, lossCarryEnd: 40,
    entnahme_effektiv: 800, jahresentnahme_real: 400 }), netA: 320, netG: -160 };
const realColumns = getProtocolColumns({ source: 'backtest', moneyBasis: 'real', logDetailLevel: 'detailed' });
for (const [id, expected] of [['rente1', '30 €'], ['rente2', '20 €'], ['rentesum', '50 €'],
    ['steuern-gesamt', '40 €'], ['losscarryend', '10 €'], ['neta', 'verkauft 160 €'], ['netg', 'gekauft 80 €'],
    ['entnahme-effektiv', '400 €'], ['jahresentnahme-real', '400 €']]) {
    const column = realColumns.find(column => column.id === id);
    assertEqual(column.valueFormatter(readProtocolValue(column, annual, { source: 'backtest' }), annual), expected,
        id + ': Renten, Steuern und Handel mit dem Faktor am Jahresanfang (2), der Verlusttopf am Jahresende mit dem Endfaktor (4)');
}

// ST7-FIX (Gutachten ST7 P2-3): Im Handlungs-ⓘ sind Bruttovermögen, offene Steuerschuld und „Tagesgeld danach“ Bestände am Jahresende.
// Real nehmen sie den Endfaktor (4) wie „Geldvermögen“: brutto 600 € minus Steuer 100 € ergibt die 500 € der Zeile.
{
    const debtYear = { ...row(2001, 2, { steuer_offen: 400, portfolio_total_brutto: 2400, aktionUndGrund: 'Profilverbund-Transaktionen',
        personAccounts: [{ profileId: 'a', name: 'Anna', tagesgeld: 800 }, { profileId: 'b', name: 'Ben', tagesgeld: 400 }] }) };
    const options = { source: 'backtest', moneyBasis: 'real', rows: [row(2000, 1), debtYear] };
    const info = protocolActionExplanation(debtYear, options).replace(/\s/gu, ' ');
    const total = PROTOCOL_COLUMNS.find(item => item.id === 'total');
    assertEqual(formatProtocolValue(total, readProtocolValue(total, debtYear, options), debtYear, options).replace(/\s/gu, ' '), '500 €', 'Geldvermögen der Zeile mit dem Endfaktor');
    assert(info.includes('Steuer offen: 100 €') && info.includes('(brutto 600 €)'), `Steuerschuld und Bruttovermögen mit dem Endfaktor (${info})`);
    assert(info.includes('Tagesgeld danach: Anna 200 €, Ben 100 €'), `Tagesgeld nach dem Jahr mit dem Endfaktor (${info})`);
}

const reserveRows = [row(2000, 1, { health_bucket_enabled: true, health_bucket_start: 60000,
    health_bucket_end: 62472, health_bucket_interest: 2472, cashInterestEarned: 1013 }), row(2001, 1.013, {
    health_bucket_enabled: true, health_bucket_start: 62472, liqStart: 20260,
    eq_before_return: 101300, gold_before_return: 10130 })];
reserveRows[0].inflationVJ = 1.3;
reserveRows[1].inflationVJ = 2;
const protocolOptions = { source: 'backtest', moneyBasis: 'real', logDetailLevel: 'detailed', rows: reserveRows };
const reserveColumns = getProtocolColumns(protocolOptions);
const reserveCell = (id, entry, options = protocolOptions) => {
    const column = PROTOCOL_COLUMNS.find(item => item.id === id);
    return formatProtocolValue(column, readProtocolValue(column, entry, options), entry, options);
};
assert(reserveColumns.some(column => column.id === 'health-bucket-start'), 'Die aktive Pflegereserve erscheint in den Backtest-Details');
assertEqual(reserveCell('health-bucket-start', reserveRows[0]), '60.000 €', 'Pflegereserve zu Beginn des Startjahrs bleibt beim Startwert');
assertEqual(reserveCell('health-bucket-start', reserveRows[1]), reserveCell('health-bucket-end', reserveRows[0]), 'Pflegereserve am Jahresanfang entspricht dem Vorjahresende');
for (const [id, expected] of [['liqstart', '20.000 €'], ['eq-before-return', '100.000 €'], ['gold-before-return', '10.000 €']]) {
    assertEqual(reserveCell(id, reserveRows[1]), expected, `${id} verwendet den Faktor am Jahresanfang`);
}
// ST7-FIX (Gutachten ST7 P3-1): Zinsen werden am Jahresende gutgeschrieben und nehmen wie vor ST7-A den Jahresendfaktor (1,013).
assertEqual(reserveCell('health-bucket-interest', reserveRows[0]), '2.440 €', 'Zinsen der Pflegereserve verwenden den Faktor am Jahresende');
assertEqual(reserveCell('cashinterestearned', reserveRows[0]), '1.000 €', 'Liquiditätszinsen verwenden den Faktor am Jahresende');
assertEqual(reserveCell('health-bucket-end', reserveRows[0]), '61.670 €', 'Endbestand verwendet weiter den Jahresendfaktor');
const nominalOptions = { ...protocolOptions, moneyBasis: 'nominal' };
assertEqual(['health-bucket-start', 'health-bucket-interest', 'health-bucket-end'].map(id => reserveCell(id, reserveRows[0], nominalOptions)).join(' · '),
    '60.000 € · 2.472 € · 62.472 €', 'Die nominale Pflegereserve geht innerhalb des Jahres auf');
assertEqual(reserveCell('health-bucket-start', reserveRows[1], { ...protocolOptions, moneyBasis: 'nominal' }), '62.472 €', 'Nominal bleibt der Anfangsbestand gleich');

// ST7-A (H-BT-REAL-FLUSS): Konstanter realer Grundbedarf von 24.000 € bei 2 % und 3 % Inflation. Real zeigen alle Jahre
// 24.000 €, das Vermögen am Jahresende bleibt mit dem Endfaktor umgerechnet, nominal ändert sich nichts.
{
    let factor = 1;
    const flowRows = [2, 3, 2].map((inflation, index) => {
        const floor = 24000 * factor, end = factor * (1 + inflation / 100);
        const entry = { jahr: 2010 + index, inflationVJ: inflation, entscheidung: { jahresEntnahme: floor },
            row: { recordType: 'financial_year', financiallyEvaluable: true, inflation_factor_cum: factor,
                floor_brutto: floor, ausgaben_gesamt: floor, steuern_gesamt: 0, portfolio_total_end: 1000000 * end } };
        factor = end;
        return entry;
    });
    const plainText = text => text.replaceAll(' ', ' ');
    const cell = (id, entry, moneyBasis) => {
        const column = PROTOCOL_COLUMNS.find(item => item.id === id), options = { source: 'backtest', moneyBasis };
        return plainText(formatProtocolValue(column, readProtocolValue(column, entry, options), entry, options));
    };
    for (const id of ['floor-brutto', 'expense-total', 'withdrawal'])
        assertEqual(flowRows.map(entry => cell(id, entry, 'real')).join(' · '), '24.000 € · 24.000 € · 24.000 €', `${id}: real zeigt in jedem Jahr 24.000 €`);
    assertEqual(flowRows.map(entry => cell('total', entry, 'real')).join(' · '), '1.000.000 € · 1.000.000 € · 1.000.000 €', 'Vermögen am Jahresende bleibt mit dem Jahresendfaktor umgerechnet');
    assertEqual(flowRows.map(entry => cell('floor-brutto', entry, 'nominal')).join(' · '), '24.000 € · 24.480 € · 25.214 €', 'Nominal bleibt unverändert');
    const flowMetrics = projectBacktestEuroMetrics({ rows: flowRows, request: { startYear: 2010 }, metrics: { values: { withdrawal_total_nominal_eur: 73694.4 } } });
    assertEqual(Math.round(flowMetrics.real.withdrawal_total_nominal_eur), 72000, 'Die reale Entnahmesumme sind drei Jahre zu 24.000 €');
    assertEqual(flowMetrics.nominal.withdrawal_total_nominal_eur, 73694.4, 'Die nominale Entnahmesumme bleibt unverändert');
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
const elements = Object.fromEntries(['simulationSummary', 'backtestResultHeading', 'backtestChartHeading', 'backtestLogHeading', 'backtestEuroHint', 'simulationLog', 'backtestProtocolSummary', 'backtestAnalysis', 'portfolioCompositionChart'].map(id => [id, new Element()]));
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
    const bt = host(), mc = host(), overview = host();
    elements.overviewWealthMode = overview; elements.overviewBacktest = new Element();
    initializeResultOverview({ rerunBacktest() {}, activateTab() {}, runMonteCarlo() {} }, doc);
    cleanup.push(bindEuroMode(doc, bt, renderBacktestEuroResults), bindEuroMode(doc, mc, () => {}));
    assertEqual(getEuroMode(doc), 'real', 'Beide Reiter starten real');
    overview.click('nominal');
    assertEqual(getEuroMode(doc), 'nominal', 'Ergebnis-Schalter setzt denselben Zustand');
    assertEqual(bt.buttons[1].getAttribute('aria-pressed'), 'true', 'Ergebnis-Wahl aktualisiert Backtest');
    assertEqual(mc.buttons[1].getAttribute('aria-pressed'), 'true', 'Ergebnis-Wahl aktualisiert Monte-Carlo');
    mc.click('real');
    assertEqual(overview.buttons[0].getAttribute('aria-pressed'), 'true', 'Monte-Carlo aktualisiert Ergebnis');
    assertEqual(bt.buttons[0].getAttribute('aria-pressed'), 'true', 'Monte-Carlo-Wahl aktualisiert Backtest-Schalter');
    assertEqual(elements.backtestResultHeading.textContent, 'Kennzahlen · Euro von 2000', 'Überschrift folgt Sitzung und eingefrorenem Startjahr');
    assertEqual(elements.backtestChartHeading.textContent, 'Gesamtvermögensverlauf · Euro von 2000', 'Chartkopf folgt Sitzung');
    assert(elements.simulationSummary.innerHTML.includes('data-display-value="500"') && elements.simulationSummary.innerHTML.includes('data-display-value="600"'), 'Beide Hauptkennzahlen schalten um');
    assert(elements.simulationSummary.innerHTML.includes('data-display-value="60"') && elements.simulationSummary.innerHTML.includes('data-display-value="250"'), 'Weitere Geldkennzahlen schalten um');
    assertEqual((elements.simulationSummary.innerHTML.match(/class="sim-other-basis"/g) ?? []).length, 2, 'Nur Endvermögen und Gesamtentnahmen bekommen den Gegenwert');
    assert(elements.simulationSummary.innerHTML.includes('nominal etwa 2.000') && elements.simulationSummary.innerHTML.includes('nominal etwa 1.000'), 'Reale Hauptwerte zeigen nominale Gegenwerte');
    assert(elements.backtestAnalysis.innerHTML.includes('Euro von 2000'), 'Auffälliges wird bei MC-Wahl neu projiziert');
    assert(elements.simulationLog.innerHTML !== protocol && elements.simulationLog.innerHTML.includes('500 €'), 'Jahresprotokoll zeigt den realen Endstand');
    assert(elements.backtestLogHeading.textContent === 'Backtest-Protokoll · Euro von 2000' && elements.backtestProtocolSummary.innerHTML.includes('Gesamtvermögen · Euro von 2000') && elements.backtestProtocolSummary.innerHTML.includes('500 €'), 'Protokollkopf und Endwert folgen der gewählten Basis');
    bt.click('nominal');
    assertEqual(overview.buttons[1].getAttribute('aria-pressed'), 'true', 'Backtest aktualisiert Ergebnis');
    assertEqual(elements.simulationLog.innerHTML, protocol, 'Zurück auf Nominal erhält die ursprüngliche Jahrestabelle');
    assertEqual(mc.buttons[1].getAttribute('aria-pressed'), 'true', 'Backtest-Wahl aktualisiert Monte-Carlo-Schalter');
    assert(elements.simulationSummary.innerHTML.includes('Euro von 2000 etwa 500') && elements.simulationSummary.innerHTML.includes('Euro von 2000 etwa 600'), 'Nominale Hauptwerte zeigen reale Gegenwerte');
    mc.click('real');
    renderBacktestEuroResults();
    assertEqual(getEuroMode(doc), 'real', 'Neuer Render erhält die gemeinsame Sitzungswahl');
    assertEqual(getEuroMode({}), 'real', 'Neue Seitensitzung beginnt real');
    assertEqual(JSON.stringify(window.globalBacktestData.result), bytes, 'Umschalten verändert weder Runnerdaten noch Exportquelle');

    // Befund 1039: Gemischte Flex-Basis (Sicherheitsbremse im Krisenjahr). Statt eines Strichs zeigen beide Kürzungskarten
    // den kurzen Grund, das ⓘ erklärt ihn und nennt die Zahl aus dem Jahresprotokoll.
    const mixedRows = [row(2000, 1), row(2001, 2, { flex_haushalt_basis: 'effective_vpw_plus_pension_surplus' })];
    const mixed = { ...result, rows: mixedRows };
    mixed.metrics = deriveHistoricalBacktestMetrics(mixed);
    assertEqual(mixed.metrics.values.flex_reduction_years_gte_10_pct, null, 'Gemischte Flex-Basis lässt die Jahre mit Kürzung offen');
    window.globalBacktestData = { result: mixed, rows: mixedRows };
    renderBacktestEuroResults();
    const cutSummary = elements.simulationSummary.innerHTML;
    assert(!cutSummary.includes('— von') && !cutSummary.includes('— Jahre'), 'Kein Strich ohne Erklärung bei den Kürzungszahlen');
    assertEqual((cutSummary.match(/<span>nicht auswertbar<\/span>/g) ?? []).length, 2, 'Beide Kürzungskarten nennen den kurzen Grund wie der Reiter Ergebnis');
    assert(cutSummary.includes('In Krisenjahren schaltet die Sicherheitsbremse die dynamische Entnahme ab.')
        && cutSummary.includes('Das Jahresprotokoll zählt jede Kürzung, auch kleinere, und kommt auf 2 Jahre mit einer Kürzung.'), 'Das ⓘ erklärt den Grund und nennt die Zahl aus dem Protokoll');
    assert(elements.backtestProtocolSummary.innerHTML.includes('<strong class="ds-metric-value">2</strong><span class="ds-metric-label">Jahre mit einer Kürzung</span>'), 'Das Protokoll zeigt dieselbe Zahl');

    // ST7-FIX (Gutachten ST7 P2-2): Die Karte zeigt real Geldvermögen und Immobilien der Ruin-Zeile mit dem Faktor vom Vorjahresende.
    window.globalBacktestData = { result: ruin, rows: ruin.rows };
    renderBacktestEuroResults();
    const ruinSummary = elements.simulationSummary.innerHTML.replace(/\s/gu, ' ');
    const card = id => ruinSummary.match(new RegExp(`data-metric-id="${id}"[^>]*><strong>[^<]*(?:<span class="ds-info".*?</span></span>)?</strong><span aria-hidden="true">([^<]*)</span>`))?.[1];
    assertEqual(card('wealth_end_nominal_eur'), '650 €', 'Gesamtvermögen: 150 € Geldvermögen und 500 € Immobilien');
    assert(ruinSummary.includes('davon Geldvermögen 150 € · Immobilien 500 €') && ruinSummary.includes('nominal etwa 1.300 €'), 'Aufteilung und nominaler Gegenwert');
    assertEqual(card('health_bucket_end_nominal_eur'), '150 €', 'Pflegereserve am Laufende zeigt einen Wert');
    assert(/data-result-field="health_bucket_target_gap"[^>]*>200 €</u.test(ruinSummary), 'Ziellücke zeigt einen Wert');
} finally {
    cleanup.forEach(dispose => dispose());
    globalThis.document = saved.document;
    globalThis.window = saved.window;
}
assertEqual(JSON.stringify(result), bytes, 'Alle Projektionen lassen den eingefrorenen Laufbeleg bytegleich');
