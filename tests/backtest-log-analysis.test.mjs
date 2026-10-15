import { buildBacktestAnalysisView, backtestAnalysisHtml, renderBacktestAnalysis, jumpToBacktestYear } from '../app/simulator/backtest-log-analysis.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';

const row = (jahr, patch = {}) => ({ jahr, row: { recordType: 'financial_year', financiallyEvaluable: true,
    entscheidung: { kuerzungProzent: 20 }, minimumFlexAnnual: 100, flex_wunsch_haushalt_nominal: 200,
    flex_haushalt_erfuellt: 100, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20,
    inflation: 0, inflation_factor_cum: 1, portfolio_total_end: 1000, steuern_gesamt: 0,
    RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePct: 90,
    runway_after_transaction_before_payout_months: 24, ...patch } });
const result = rows => ({ rows, portfolioStart: 1200, portfolioEnd: 1000, outcome: { kind: 'completed' },
    request: { startYear: 2000, endYear: 2003, period: { startYear: 2000, endYear: 2003 },
        inputs: { ...dynamicFlexPresetPatch('ausgewogen') } } });
const data = { result: result([row(2000), row(2001), row(2002, { entscheidung: { kuerzungProzent: 0 } }), row(2003)]),
    personDisplayContext: { persons: [{ name: 'Max Mustermann' }, { name: 'Erika Mustermann' }] } };
const before = JSON.stringify(data);
const view = buildBacktestAnalysisView(data);
assertEqual(JSON.stringify(data), before, 'Anzeige lässt den Laufbeleg unverändert');
assertEqual(view.cards.map(point => point.type).join(), 'minimum_flex_held,decision_flex_cut_phase,minimum_real_year_end_wealth', 'Drei Karten: Mindest-Flex, längste Kürzung und reales Tief');
assertEqual(view.cards[1].valueText, '2 Jahre · 2000–2001', 'Leitwert nennt längste Phase und Kalenderjahre');
assert(view.source.includes('Max Mustermann, Erika Mustermann · 2000–2003 · Ausgewogen · aus dem Jahresprotokoll'), 'Herkunft verwendet eingefrorene Personen, Periode und Preset');
assertEqual(view.badge.text, 'Grundbedarf in allen 4 Jahren gedeckt', 'Grundbedarfsdeckung steht rechts als Hinweis');
assertEqual(view.more.filter(point => point.type === 'liquidity_below_target').length, 1, 'Wiederholte Liquiditätstreffer bilden einen Punkt');
assert(view.more.find(point => point.type === 'liquidity_below_target').valueText.startsWith('4 Jahre'), 'Gebündelter Punkt nennt Anzahl betroffener Jahre');
const html = backtestAnalysisHtml(view);
assertEqual((html.match(/<article /g) || []).length, 3, 'Genau drei sichtbare Ereigniskarten');
assert(html.includes('<details class="backtest-analysis-more"><summary>Weitere') && !html.includes('<details open'), 'Weitere Punkte und Text sind anfangs zugeklappt');
assert(html.includes(`Weitere ${view.more.length + 1} Punkte`) && html.includes(`Als Text: ${view.model.summary}`), 'Zähler umfasst weitere Punkte und vollständigen Zusammenfassungstext');
assert(html.includes('data-backtest-analysis-year="2000"') && html.includes('2000 im Protokoll →'), 'Karte verlinkt das belegte Kalenderjahr');
assert(html.includes('Wie die Punkte gefunden werden') && html.includes('ds-info-pop'), 'Regeln sind im vorhandenen Info-Baustein erreichbar');
assertEqual(buildBacktestAnalysisView(null), null, 'Ohne Lauf keine Anzeige');
assertEqual(backtestAnalysisHtml(null), '', 'Ohne Lauf kein leeres Kartenmarkup');

const missing = buildBacktestAnalysisView(result([row(2000, { minimumFlexAnnual: null, portfolio_total_end: null, entscheidung: null })]));
assertEqual(missing.cards.map(point => point.valueText).join(), 'unbekannt,unbekannt,unbekannt', 'Fehlende Messwerte bleiben in allen drei Karten unbekannt');
const noCuts = buildBacktestAnalysisView(result([row(2000, { entscheidung: { kuerzungProzent: 0 } })]));
assertEqual(noCuts.cards[1].valueText, 'Keine ab 10 %', 'Keine Kürzung ist von fehlender Beobachtung getrennt');
const below = buildBacktestAnalysisView(result([row(2000, { flex_haushalt_erfuellt: 99 })]));
assertEqual(below.cards[0].type, 'below_minimum_flex_phase', 'Unterschrittenes Mindest-Flex steht vor Kürzungsphase');
const ruinResult = { ...result([row(2000), { jahr: 2001, row: { recordType: 'terminal_ruin', financiallyEvaluable: false } }]),
    outcome: { kind: 'ruin', ruinYear: 2001, reason: '<img src=x onerror=alert(1)>' } };
const ruin = buildBacktestAnalysisView(ruinResult);
assertEqual(ruin.badge.tone, 'warning', 'Ruin verwendet Warnfarbe');
assertEqual(ruin.cards[0].type, 'ruin', 'Ruin erhält Vorrang in den Ereigniskarten');
assertEqual(ruin.cards[0].year, 2001, 'Ruinlink zeigt auf das Terminaljahr');
assert(!backtestAnalysisHtml(ruin).includes('<img'), 'Protokollierter Grund wird HTML-sicher angezeigt');
const market = buildBacktestAnalysisView(result([row(2000, { Regime: 'peak_stable' }), row(2001, { Regime: 'side_long' })]));
assert(market.more.find(point => point.type === 'market_regime_change').valueText.includes('Lange Seitwärtsbewegung'), 'Marktphasen verwenden dieselben lesbaren Namen wie das Protokoll');
const noRow = buildBacktestAnalysisView({ ...ruinResult, rows: [row(2000)], outcome: { kind: 'ruin', ruinYear: 2002 } });
assertEqual(noRow.cards[0].year, null, 'Ohne passende Zeile kein ins Leere führender Protokolllink');
const protocol = renderProtocolTable(data.result.rows, { source: 'backtest' });
assert(protocol.includes('id="backtest-year-2000" tabindex="-1"'), 'Backtestzeilen besitzen stabile Jahresanker');
assert(renderProtocolTable(ruinResult.rows, { source: 'backtest' }).includes('id="backtest-year-2001"'), 'Terminalzeile erhält ebenfalls ihren Jahresanker');
assert(!renderProtocolTable([{ jahr: 1 }], { source: 'mc' }).includes('id="backtest-year-'), 'MC-Protokoll erhält keine Backtestanker');

class Element {
    constructor() { this.hidden = true; this.innerHTML = ''; this.listeners = []; this.scrollLeft = 99; this.classes = new Set();
        this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
    addEventListener(type, handler) { this.listeners.push(handler); }
    contains() { return true; }
    scrollIntoView(options) { this.scrolled = options; }
    focus() { this.focused = true; }
}
const host = new Element(), table = new Element(), target = new Element();
const documentRef = { getElementById: id => ({ backtestAnalysis: host, simulationLog: table, 'backtest-year-2000': target })[id] ?? null };
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
const timers = new Map(); let nextTimer = 1;
try {
    globalThis.setTimeout = callback => { const id = nextTimer++; timers.set(id, callback); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    renderBacktestAnalysis(documentRef, data);
    assert(!host.hidden && host.innerHTML.includes('Was im Lauf auffällt'), 'Veröffentlichter Lauf baut die Karte auf');
    const link = { getAttribute: () => '2000' };
    let prevented = false;
    host.listeners[0]({ target: { closest: () => link }, preventDefault() { prevented = true; } });
    assert(prevented && target.scrolled && target.focused, 'Jahreslink scrollt zur Zeile und ist per Tastatur bedienbar');
    assert(target.classes.has('backtest-analysis-highlight') && table.scrollLeft === 0, 'Zielzeile hervorgehoben und Jahresspalte sichtbar');
    [...timers.values()][0]();
    assert(!target.classes.has('backtest-analysis-highlight'), 'Zeitgeber entfernt die Hervorhebung');
    assert(!jumpToBacktestYear(documentRef, 9999), 'Nicht vorhandenes Jahr wird nicht ersetzt');
    renderBacktestAnalysis(documentRef, { result: result([row(2000, { flex_haushalt_erfuellt: 90 })]) });
    assert(host.innerHTML.includes('Unter Mindest-Flex') && !host.innerHTML.includes('In keinem Jahr unterschritten'), 'Neuer Lauf ersetzt die alten Karten');
    assertEqual(host.listeners.length, 1, 'Neuaufbau verdoppelt keine Linkbindung');
    renderBacktestAnalysis(documentRef, null);
    assert(host.hidden && host.innerHTML === '' && timers.size === 0, 'Invalidierung entfernt Karte und laufende Hervorhebung');
} finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
