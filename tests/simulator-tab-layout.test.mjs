import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'Simulator.html'), 'utf8');

const tabButtons = [...html.matchAll(/<button\s+class="tab-btn(?: active)?"\s+data-tab="([^"]+)">([^<]+)<\/button>/g)]
    .map(([, id, label]) => ({ id, label: label.trim() }));
assert(JSON.stringify(tabButtons) === JSON.stringify([
    { id: 'ergebnis', label: 'Ergebnis' },
    { id: 'annahmen', label: 'Annahmen' },
    { id: 'backtesting', label: 'Backtest' },
    { id: 'montecarlo', label: 'Monte-Carlo' }
]), 'Simulator-Tab-Leiste enthält die vier Tabs in der vorgesehenen Reihenfolge');

const scriptsStart = html.indexOf('<script type="module" src="app/profile/profile-bridge.js">');
assert(scriptsStart > 0, 'Simulator.html lädt die Seitenskripte nach dem Markup');
assert(!/werkstatt|workshop|stressReplay|sweep|ao_/i.test(html.slice(0, scriptsStart)), 'Kein Markup der entfernten Werkstatt bleibt zurück');

const owners = ['ergebnis', 'annahmen', 'backtesting', 'montecarlo'];
const markup = html.slice(0, scriptsStart);
const panelIds = [...markup.matchAll(/<div id="([^"]+)" class="tab-panel(?: active)?"/g)].map(m => m[1]);
assertEqual(JSON.stringify(panelIds), JSON.stringify(owners.map(id => 'tab-' + id)), 'Genau vier Hauptpanels in Zielreihenfolge');
assert(markup.includes('id="tab-ergebnis" class="tab-panel active"'), 'Ergebnis ist initial aktiv');
assert(!markup.includes('sim-page-actions'), 'Kopfaktionen sind entfernt');
assert(/class="mc-settings-actions"[^]*?id="mcButton"/.test(markup), 'Start liegt in Einstellungen außerhalb der geschlossenen Details');
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assertEqual(ids.length, new Set(ids).size, 'Alle Bestandscontrols und Ergebnis-Hosts besitzen eindeutige IDs');
const controls = {
    ergebnis: ['overviewBacktest', 'overviewMonteCarlo', 'overviewCrises', 'overviewRunHeads'],
    annahmen: ['simProfileList', 'startFloorBedarf', 'minimumFlexAnnual', 'pflegePanel', 'simPlanParameters'],
    // AL-P: Die Parity-Entwicklerkarte (parity-smoketest-card) ist entfernt.
    backtesting: ['simStartJahr', 'simEndJahr', 'btButton', 'simulationSummary', 'simulationLog', 'exportBacktestJson'],
    montecarlo: [ 'mcButton', 'mcCancelButton', 'mcViewTabLogs', 'mcSetupDisclosure', 'mcAdvancedDisclosure', 'mcAnzahl', 'mcDauer', 'stressPreset']
};
for (let i = 0; i < owners.length; i++) {
    const start = markup.indexOf('<div id="tab-' + owners[i] + '"');
    const end = i + 1 < owners.length ? markup.indexOf('<div id="tab-' + owners[i + 1] + '"') : markup.length;
    const panel = markup.slice(start, end);
    for (const id of controls[owners[i]]) assert(panel.includes('id="' + id + '"'), id + ' gehört zum Hauptpanel ' + owners[i]);
}
const assumptionSource = fs.readFileSync(path.join(root, 'app/simulator/simulator-assumptions-ui.js'), 'utf8');
assert(assumptionSource.includes('input:not([type="hidden"]):not([type="checkbox"]), select') && assumptionSource.includes("host.addEventListener('input'") && assumptionSource.includes("host.addEventListener('change'"), 'Bestehende Füllindikatorbindung folgt den echten Annahmenfeldern');
assertEqual((markup.match(/data-assumption-step="[1-5]"/g) || []).length, 5, 'Fünf bestehende Annahmenbereiche bleiben zugeordnet');
assert(!markup.slice(markup.indexOf('id="tab-annahmen"'), markup.indexOf('id="tab-backtesting"')).includes('class="form-group"'), 'Annahmen verwenden Bausteinfelder');
assert(!html.includes('#tab-rahmendaten'), 'Kein Inlinebinder verweist auf die entfernte Besitzfläche');
// Die echte Ausgabe gruppiert Kennzahlen vor dem Chart; Ruin/Recoverytexte bleiben.
const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
const { tokenizeHTML, matchesSelector } = await import('./funktionsinventar-contract.mjs');
const { renderSimulatorOverview, setOverviewBacktestStatus } = await import('../app/simulator/simulator-result-overview.js');
const { simulatorRunAssumptions: heads } = await import('../app/simulator/simulator-run-assumptions.js');
const previousDocument = globalThis.document;
try {
    const doc = createPresentationTestDocument();
    doc.querySelectorAll = () => []; doc.addEventListener = () => {};
    doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
    const host = doc.createElement('section'); host.id = 'overviewBacktest'; host.querySelector = () => null;
    globalThis.document = doc;
    for (const outcome of ['completed', 'ruin']) {
        const result = { request: { startYear: 2020, endYear: 2020 }, outcome: { kind: outcome }, ruinYear: 2020,
            portfolioStart: 100000, completedYears: 1, metrics: { values: { wealth_end_nominal_eur: 80000, flex_reduction_longest_streak_gte_10_pct: 1 } },
            rows: [{ jahr: 2020, wertAktien: 80000, wertGold: 0, liquiditaet: 0, row: {
                health_bucket_start: 0, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20
            } }] };
        const values = { inputs: {}, settings: result.request };
        heads.observe('backtest', values); const token = heads.begin('backtest', values, {}); heads.complete('backtest', token, result);
        setOverviewBacktestStatus('completed'); renderSimulatorOverview();
        const output = tokenizeHTML(host.innerHTML);
        assert(matchesSelector(output, '.sim-card-status .sim-status-chip') && matchesSelector(output, '.sim-card-status .ds-info-button'), 'Statuschip und Info stehen gemeinsam im rechten Kartenkopf');
        assertEqual(output.elements.filter(node => matchesSelector({ elements: [node] }, '.sim-outcome-metrics .ds-row')).length, 3, 'Drei Nebenkennzahlen stehen neben dem Ergebnisblock');
        assert(matchesSelector(output, '.sim-cut-metric .ds-hint'), 'Kürzungsdauer steht innerhalb der Kürzungskennzahl');
        assert(matchesSelector(output, '.sim-outcome-primary .sim-hero-amount') && matchesSelector(output, '.sim-outcome-primary .sim-outcome-start'), 'Betrag, Endbezeichnung und Startbetrag bleiben zusammen');
        assertEqual(host.children.at(-1).id, 'overviewPortfolioChart', 'Chart wird nach dem Kennzahlenblock eingefügt');
        assert(host.innerHTML.includes(outcome === 'completed' ? 'Ja. Dein Plan' : 'Der Grundbedarf wäre'), 'Erfolg und Ruin behalten ihre bisherigen Aussagen');
    }
    for (const [phase, text] of [['loading', 'Profil wird geladen'], ['blocked', 'nicht rechenbar'], ['missing', 'Daten fehlen'], ['technical_error', 'technischer Fehler']]) {
        setOverviewBacktestStatus(phase); renderSimulatorOverview();
        assert(host.innerHTML.includes(text), `${phase}: bestehender Lade-/Recovery-/Fehlertext erhalten`);
    }
} finally { globalThis.document = previousDocument; }

// SE-2: kürzere Seiten – Risiko, Szenario-Logs und Backtest.
{
    const at = marker => { const index = html.indexOf(marker); assert(index >= 0, 'Markup enthält ' + marker); return index; };
    const risk = html.slice(at('id="mcViewPanelRisk"'), at('id="mcViewPanelCare"'));
    assert(risk.indexOf('id="riskKeyFigures"') < risk.indexOf('class="sim-risk-pair"')
        && risk.indexOf('id="wealthDistribution"') < risk.indexOf('id="wealthFanChart"')
        && risk.indexOf('class="sim-risk-pair"') < risk.indexOf('class="sim-risk-split"')
        && risk.indexOf('id="advancedKpiDashboard"') < risk.indexOf('id="riskKpiDashboard"'), 'Risiko: Kennzahlleiste, Verteilung neben Fächer, Heatmap neben Weitere Kennzahlen');
    const logs = html.slice(at('id="mcViewPanelLogs"'), at('id="mcViewPanelDecision"'));
    assert(logs.indexOf('id="scenarioComparison"') < logs.indexOf('id="scenarioChartView"')
        && logs.indexOf('id="scenarioChartView"') < logs.indexOf('id="scenarioSelector"')
        && /id="scenarioSelectedChartPanel" data-scenario-chart-panel="selected" hidden/.test(logs), 'Szenario-Logs: Vergleich oben, ein Diagramm mit Umschalter neben der Auswahl');
    assert(/<details id="scenarioProtocolDisclosure" class="[^"]*"\s*>/.test(logs) && logs.indexOf('id="scenarioProtocolDisclosure"') < logs.indexOf('id="scenarioLogOutput"'), 'Szenario-Protokoll ist anfangs zugeklappt');
    const backtest = html.slice(at('id="tab-backtesting"'), at('id="engine-mismatch-footer"'));
    assert(backtest.indexOf('id="simStartJahr"') < backtest.indexOf('id="backtestWealthMode"')
        && backtest.indexOf('id="backtestWealthMode"') < backtest.indexOf('id="simulationResults"'), 'Backtest: Zeitraum und Euro-Basis in einer Leiste');
    assert(backtest.indexOf('id="portfolioCompositionChart"') < backtest.indexOf('id="backtestAnalysis"')
        && backtest.indexOf('class="sim-backtest-split"') < backtest.indexOf('id="portfolioCompositionChart"'), 'Backtest: Verlauf neben „Was im Lauf auffällt“');
    assert(/<details id="backtestProtocolDisclosure" class="[^"]*">/.test(backtest)
        && /<summary[^>]*>[^]*id="exportBacktestJson"[^]*id="exportBacktestCsv"[^]*<\/summary>/.test(backtest), 'Backtest-Protokoll zugeklappt, JSON/CSV im Kopf');
}
{
    const { jumpToLogAnalysisYear } = await import('../app/simulator/log-analysis-view.js');
    const details = { open: false, parentElement: null };
    const row = { closest: selector => selector === 'details' ? details : null, scrollIntoView() {}, focus() {}, classList: { add() {}, remove() {} } };
    const previousTimeout = globalThis.setTimeout;
    globalThis.setTimeout = () => 0;
    try {
        assert(jumpToLogAnalysisYear({ getElementById: id => id === 'year-3' ? row : null }, 3, { yearPrefix: 'year-', logId: 'log' }) && details.open,
            'SE-2: Sprung ins Protokoll öffnet die zugeklappte Protokollzeile');
    } finally { globalThis.setTimeout = previousTimeout; }
}
{
    const { renderRiskKeyFigures } = await import('../app/simulator/results-renderers.js');
    const host = { innerHTML: '', hidden: true };
    const dashboard = { drawdownKpis: [{ title: 'Max. Rückgang nominal (Median)', value: '27,00 %' }, { title: 'Max. Rückgang real (Median)', value: '34,00 %' }],
        detailSections: [{ title: 'Risiko-Details', kpis: [{ title: 'Zeitanteil realisierte Entnahmequote > 4,5 %', value: '6,0 %' }] }] };
    renderRiskKeyFigures(host, { available: true, mode: 'real', p10: 900000, p25: 1600000, p50: 2800000, p75: 5200000 }, dashboard);
    assert(!host.hidden && host.innerHTML.includes('Gesamtvermögen am Laufende · Median') && host.innerHTML.includes('Schwache Läufe · P10')
        && host.innerHTML.includes('34,00 %') && host.innerHTML.includes('real · nominal 27,00 %') && host.innerHTML.includes('6,0 %')
        && host.innerHTML.includes('mittlere Hälfte'), 'SE-2: Kennzahlleiste zeigt Median, P10, Drawdown real/nominal und Zeitanteil über 4,5 %');
    renderRiskKeyFigures(host, { available: false, reason: 'Endwertverteilung fehlt. Bitte Monte-Carlo neu rechnen.' }, { drawdownKpis: [], detailSections: [] });
    assert(host.innerHTML.includes('Endwertverteilung fehlt') && !host.innerHTML.includes('NaN'), 'SE-2: Ohne Verteilung erklärt die Leiste den fehlenden Wert');
}
