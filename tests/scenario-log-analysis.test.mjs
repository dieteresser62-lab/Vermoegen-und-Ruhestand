import { buildScenarioAnalysisView, scenarioAnalysisHtml, renderScenarioAnalysis } from '../app/simulator/scenario-log-analysis.js';
import { buildBacktestAnalysisView } from '../app/simulator/backtest-log-analysis.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

const row = (jahr, patch = {}) => ({ jahr, histJahr: 1970 + jahr,
    recordType: 'financial_year', financiallyEvaluable: true,
    entscheidung: { kuerzungProzent: 20 }, minimumFlexAnnual: 100, flex_wunsch_haushalt_nominal: 200,
    flex_haushalt_erfuellt: 100, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20,
    inflation: 0, inflation_factor_cum: 1, portfolio_total_end: 1000, steuern_gesamt: 0,
    RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePct: 90,
    runway_after_transaction_before_payout_months: 24,
    Person1Alive: 1, Person2Alive: 1, CareP1_Active: 0, CareP2_Active: 0, ...patch });
const path = rows => ({ key: 'p50', label: 'Median', sourceIdentity: { absoluteRunIndex: 22 },
    endVermoegen: 1000, failed: false, logDataRows: rows });
const options = { initialWealth: 1200, startYear: 2026, inputs: { partner: { aktiv: true } },
    personDisplayContext: { persons: [{ name: 'Max Mustermann' }, { name: 'Erika Mustermann' }] } };
const scenario = path([row(1), row(2), row(3, { entscheidung: { kuerzungProzent: 0 } }), row(4)]);
const before = JSON.stringify({ scenario, options });
const view = buildScenarioAnalysisView(scenario, options);
assertEqual(view.cards.map(point => point.type).join(), 'minimum_flex_held,decision_flex_cut_phase,minimum_real_year_end_wealth', 'MC verwendet dieselben drei priorisierten Karten wie der Backtest');
assertEqual(view.cards[1].valueText, '2 Jahre · Simulationsjahr 1–2', 'Phasendauer nennt ausschließlich Simulationsjahre');
assert(view.source.includes('Median · Pfad 23 · Simulationsjahr 1–4'), 'Auswahlname, echte Pfadnummer und Zeitraum bleiben sichtbar');
assertEqual(view.badge.text, 'Grundbedarf in allen 4 Jahren gedeckt', 'Grundbedarf bezieht sich auf die Entnahmejahre des einen Pfads');
const html = scenarioAnalysisHtml(view);
assertEqual((html.match(/<article /g) || []).length, 3, 'Genau drei Karten offen');
assert(html.includes('<summary>Weitere') && !html.includes('<details open') && html.includes(`Als Text: ${view.model.summary}`), 'Weitere und Zusammenfassung beginnen geschlossen');
assert(html.includes('data-scenario-analysis-protocol') && html.includes('Zum Jahresprotokoll →'), 'Pfadansicht hat den direkten Protokolllink');
assert(html.includes('href="#scenario-year-1"') && html.includes('Simulationsjahr 1 im Protokoll'), 'Jahreslink verwendet den Simulationsjahresanker');
assert(html.includes('gezogenes Datenjahr 1971') && /role="tooltip">Simulationsjahr 1: gezogenes Datenjahr 1971/.test(html), 'Gezogenes Datenjahr steht im Infofenster des verlinkten Jahres');
assert(!html.includes('8 von 32') && !html.includes('32 Pfade'), 'Karten erhalten keine Gesamtanteile');
assertEqual(JSON.stringify({ scenario, options }), before, 'Anzeige verändert weder Rohbeleg noch eingefrorenen Kontext');
const backtest = buildBacktestAnalysisView({ rows: scenario.logDataRows.map(entry => ({ jahr: entry.jahr, row: entry })),
    portfolioStart: 1200, outcome: { kind: 'completed' } });
assertEqual(view.cards.map(point => point.type).join(), backtest.cards.map(point => point.type).join(), 'Beide Betriebsarten verwenden dieselbe Kartenprojektion');
assertEqual(buildScenarioAnalysisView(null), null, 'Keine Auswahl ergibt keine alten Karten');
assertEqual(buildScenarioAnalysisView(path([])), null, 'Leerer Beleg zeigt keinen geratenen Verlauf');
assertEqual(scenarioAnalysisHtml(null), '', 'Kein Lauf erzeugt kein leeres Markup');
const unknown = buildScenarioAnalysisView(path([row(1, { minimumFlexAnnual: null, entscheidung: null, portfolio_total_end: null, histJahr: null })]));
assertEqual(unknown.cards.map(point => point.valueText).join(), 'unbekannt,unbekannt,unbekannt', 'Fehlende Finanzwerte bleiben unbekannt');
const missingHistory = scenarioAnalysisHtml(buildScenarioAnalysisView(path([row(1, { histJahr: null })])));
assert(missingHistory.includes('gezogenes Datenjahr unbekannt'), 'Fehlendes Datenjahr wird nicht aus Startjahr oder Zeilenposition erraten');
const noNumber = buildScenarioAnalysisView({ ...scenario, sourceIdentity: null });
assert(noNumber.source.includes('Pfadnummer unbekannt'), 'Fehlende Quellidentität erfindet keine Nummer');
for (const patch of [{ flex_haushalt_erfuellt: 100 }, { minimumFlexAnnual: 0, flex_haushalt_erfuellt: 0 }]) {
    const result = buildScenarioAnalysisView(path([row(1, patch)]));
    assertEqual(result.cards[0].type, 'minimum_flex_held', 'Gleichheit und Mindest-Flex 0 zählen nicht als Einschränkung');
}
const restricted = buildScenarioAnalysisView(path([row(1, { flex_haushalt_erfuellt: 99.99 })]));
assertEqual(restricted.cards[0].type, 'below_minimum_flex_phase', 'Strenge Unterschreitung bleibt vor Kürzung priorisiert');
const gap = buildScenarioAnalysisView(path([row(1), row(3)]));
assertEqual(gap.cards[1].evidence.durationYears, 1, 'Datenlücke verbindet Kürzungsphasen nicht');
assertEqual(gap.cards[1].count, 2, 'Weitere getrennte Phasen bleiben als Anzahl erhalten');

const life = path([row(1), row(2, { CareP1_Active: 1, CareP2_Active: 1, CareP1_Grade: 2, CareP2_Grade: 3 }),
    row(3, { CareP1_Active: 1, CareP2_Active: 1, CareP1_Grade: 3, CareP2_Grade: 4,
        Person1Alive: 0, steuern_gesamt: 5000 }),
    { jahr: 4, recordType: 'terminal_death', financiallyEvaluable: false, Person1Alive: 0, Person2Alive: 0,
        CareP1_Active: 0, CareP2_Active: 0, portfolio_total_end: 0, flex_haushalt_erfuellt: 0 }]);
const lifeView = buildScenarioAnalysisView(life, options);
const points = [...lifeView.cards, ...lifeView.more];
for (const type of ['care_phase', 'care_grade_change', 'person_death']) {
    assertEqual(points.filter(point => point.type === type).length, 2, `${type}: beide Personen bleiben getrennte Punkte`);
}
for (const name of ['Max Mustermann', 'Erika Mustermann']) {
    assert(points.some(point => point.type === 'care_phase' && point.label === `Pflege ${name}`), 'Pflege verwendet den eingefrorenen Namen');
    assert(points.some(point => point.type === 'person_death' && point.label === `Tod ${name}`), 'Tod wird neutral benannt');
}
assert(points.some(point => point.type === 'household_end' && point.year === 4), 'Haushaltsende bleibt ein neutrales Terminalereignis');
assert(points.some(point => point.type === 'tax_peak' && point.valueText.includes('Simulationsjahr 3')), 'Steuerspitze verwendet dieselbe Regel und die MC-Zeitachse');
assertEqual(lifeView.model.financialYears, 3, 'Todeszeile zählt nicht als Finanzjahr');
assertEqual(lifeView.model.minimumFlex.affectedYearCount, 0, 'Künstliche Terminalnull erzeugt keine Einschränkung');
assertEqual(lifeView.model.realEndWealth, 1000, 'Terminalnull ersetzt keinen realen Jahresendstand');
assert(!scenarioAnalysisHtml(lifeView).includes('is-warning'), 'Pflege und Tod erhalten keine Warnbewertung');
const ruin = buildScenarioAnalysisView({ ...life, failed: true, logDataRows: [row(1),
    { jahr: 2, histJahr: 1999, recordType: 'terminal_ruin', financiallyEvaluable: false, portfolio_total_end: 0, GuardNote: 'Pflege als erfundene Ursache' }] }, options);
assertEqual(ruin.cards[0].type, 'ruin', 'Finanzieller Abbruch steht zuerst');
assertEqual(ruin.badge.tone, 'warning', 'Nur finanzieller Abbruch erzeugt Warnhinweis');
assert(ruin.cards[0].text.includes('nicht verfügbar') && !ruin.cards[0].text.includes('erfundene Ursache'), 'MC-Ruingrund wird nicht aus anderen Feldern behauptet');
assertEqual(ruin.cards[0].year, 2, 'Ruinlink zeigt zur belegten Terminalzeile');
const noTerminalYear = buildScenarioAnalysisView({ ...scenario, failed: true });
assertEqual(noTerminalYear.cards[0].year, null, 'Ohne belegtes Ruinjahr kein falscher Jahreslink');
const technical = buildScenarioAnalysisView(path([{ jahr: 1, recordType: 'technical_error', financiallyEvaluable: false }]));
assertEqual(technical.cards[0].type, 'technical_error', 'Technischer Fehler bleibt vom Ruin getrennt');
assertEqual(technical.badge.tone, 'unknown', 'Technischer Fehler behauptet keine Grundbedarfsdeckung');
const escaped = scenarioAnalysisHtml(buildScenarioAnalysisView({ ...scenario, label: '<img src=x>' }, options));
assert(!escaped.includes('<img') && escaped.includes('&lt;img'), 'Pfadnamen sind HTML-sicher');
const protocol = renderProtocolTable(life.logDataRows, { source: 'mc', ...options });
assert(protocol.includes('id="scenario-year-4" tabindex="-1"'), 'Auch Todeszeile hat den aktuellen MC-Jahresanker');
assert(!protocol.includes('backtest-year-'), 'MC- und Backtestanker bleiben getrennt');

class Element {
    constructor() { this.listeners = []; this.classes = new Set(); this.scrollLeft = 99;
        this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; }
    addEventListener(type, handler) { this.listeners.push(handler); }
    contains() { return true; }
    scrollIntoView(options) { this.scrolled = options; }
    focus() { this.focused = true; }
}
const host = new Element(), table = new Element(), heading = new Element();
let target = new Element();
const doc = { getElementById: id => ({ scenarioLogAnalysis: host, scenarioLogOutput: table,
    scenarioProtocolHeading: heading, 'scenario-year-1': target })[id] ?? null };
const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
const timers = new Map(); let next = 0;
const click = attribute => {
    let prevented = false;
    const link = { getAttribute: () => '1' };
    host.listeners[0]({ target: { closest: selector => selector === `[${attribute}]` ? link : null },
        preventDefault() { prevented = true; } });
    return prevented;
};
try {
    globalThis.setTimeout = callback => { timers.set(++next, callback); return next; };
    globalThis.clearTimeout = id => timers.delete(id);
    renderScenarioAnalysis(doc, scenario, options);
    assert(!host.hidden && host.innerHTML.includes('Was im gewählten Pfad auffällt'), 'Gewählter Pfad veröffentlicht den gemeinsamen Baustein');
    assert(click('data-scenario-analysis-year') && target.scrolled && target.focused, 'Jahreslink führt zur aktuellen MC-Protokollzeile');
    assert(target.classes.has('backtest-analysis-highlight') && table.scrollLeft === 0, 'Zieljahr bleibt hervorgehoben und links sichtbar');
    [...timers.values()][0]();
    assert(!target.classes.has('backtest-analysis-highlight'), 'Hervorhebung endet nach Zeitgeber');
    target = new Element();
    assert(click('data-scenario-analysis-year') && target.focused, 'Tabellenneuaufbau verwendet die neue Zielzeile');
    assert(click('data-scenario-analysis-protocol') && heading.scrolled && heading.focused, 'Allgemeiner Protokolllink führt zum Protokollkopf');
    renderScenarioAnalysis(doc, { ...scenario, label: 'Anderer Pfad' }, options);
    assert(host.innerHTML.includes('Anderer Pfad') && !target.classes.has('backtest-analysis-highlight'), 'Pfadwechsel ersetzt Inhalt und räumt alte Hervorhebung auf');
    assertEqual(host.listeners.length, 1, 'Neuauswahl verdoppelt keine Listener');
    renderScenarioAnalysis(doc, null);
    assert(host.hidden && host.innerHTML === '' && timers.size === 0, 'Fehlende Auswahl entfernt Inhalt und laufende Zeitgeber');
} finally { globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
