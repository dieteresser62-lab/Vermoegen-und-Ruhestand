import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
import { readFileSync } from 'node:fs';
import { parityChunk, resultHashes, characteristicIndices } from './helpers/md-2-parity.mjs';
import { ScenarioAnalyzer, WEALTH_SCENARIO_LABELS } from '../app/simulator/scenario-analyzer.js';
import { buildScenarioEntries, renderScenarioWealthChart } from '../app/simulator/scenario-wealth-chart.js';
import { renderScenarioList } from '../app/simulator/scenario-log-view.js';
import { renderScenarioComparison } from '../app/simulator/scenario-comparison.js';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/md-2-parity-before.json', import.meta.url), 'utf8'));
const equalization = JSON.parse(readFileSync(new URL('./fixtures/zg-1b-expectation-deltas.json', import.meta.url), 'utf8'));
for (const [name, before] of Object.entries(baseline.cases)) {
    const [method, home] = name.split('/');
    const chunk = await parityChunk(method, home === 'home');
    assertEqual(chunk.technicalInventory.technicalError, 0, `${name}: 50 Läufe ohne technischen Fehler`);
    // Bytebelege gelten auf der erfassten Plattform; die Verhaltensproben laufen überall.
    if (process.platform === equalization.runtime.platform && process.version === equalization.runtime.node) {
        assertEqual(JSON.stringify(equalization.cases[name].before), JSON.stringify(readEV1bReferences(before.hashes)), `${name}: vollständige Referenz vor ZG-1b bleibt erhalten`);
        assertEqual(JSON.stringify(resultHashes(chunk)), JSON.stringify(equalization.cases[name].after), `${name}: totals/lists/pathSummaries/heatmap mit belegter Familienheimkürzung`);
        const selected = characteristicIndices(chunk.runMeta);
        const typical = new ScenarioAnalyzer(50);
        chunk.runMeta.forEach(run => typical.addRun(run));
        const typicalIndex = typical.buildScenarioLogs().characteristic.find(pick => pick.key === 'typicalMarket').sourceIdentity.absoluteRunIndex;
        assert(before.characteristicIndices.every(index => selected.includes(index)), `${name}: alle bisherigen Protokollpfade bleiben ausgewählt`);
        assert(selected.filter(index => !before.characteristicIndices.includes(index)).every(index => index === typicalIndex), `${name}: höchstens der neue Marktpfad kommt hinzu`);
    }
    for (const run of chunk.runMeta) {
        const years = run.logDataRows.filter(row => row.recordType === 'financial_year');
        const expected = years.length ? Math.expm1(years.reduce((sum, row) => sum + Math.log1p(row.NominalReturnEquityPct), 0) / years.length) : null;
        assertEqual(run.equityCagr, expected, `${name}/${run.index}: CAGR nur aus Finanzjahren, ohne Todes-/Ruinzeile`);
    }
    if (home === 'no-home' && ['stationary', 'regime_markov'].includes(method)) {
        const unlogged = await parityChunk(method, false, []);
        assert(unlogged.runMeta.every(run => run.logDataRows.length === 0), `${method}: kein zusätzlicher Protokollspeicher`);
        assertEqual(JSON.stringify(unlogged.runMeta.map(run => run.equityCagr)), JSON.stringify(chunk.runMeta.map(run => run.equityCagr)), `${method}: Kennzahl auch ohne Protokolle identisch`);
        assertEqual(JSON.stringify(resultHashes(unlogged)), JSON.stringify(resultHashes(chunk)), `${method}: Logwahl ändert keine Gesamtergebnisse`);
    }
}
const stationaryHome = await parityChunk('stationary', true);
assertEqual(stationaryHome.technicalInventory.technicalError, 0, 'Stationary mit Immobilie: 50 Läufe ohne Fehler');
assertEqual(stationaryHome.runMeta.length, 50, 'Stationary mit Immobilie: alle 50 Läufe liefern ein Ergebnis');
assert(stationaryHome.runMeta.every(run => run.logDataRows.length > 0), 'Stationary mit Immobilie: echte Protokolle vorhanden');

// 101 synthetische Läufe: Vermögensmedian und Renditemedian liegen auseinander.
const analyzer = new ScenarioAnalyzer(101);
for (let index = 100; index >= 0; index--) analyzer.addRun({ index, equityCagr: index / 1000,
    endVermoegen: index === 50 ? 1e6 : index, failed: false, lebensdauer: 20,
    careEverActive: false, maxKuerzung: 0, logDataRows: [{ recordType: 'financial_year', jahr: 1,
        portfolio_total_end: index, inflation_factor_cum: 1, inflation: 0 }] });
const logs = analyzer.buildScenarioLogs();
const typical = logs.characteristic.find(pick => pick.key === 'typicalMarket');
assertEqual(typical.sourceIdentity.absoluteRunIndex, 50, 'Typischer Marktverlauf hat Renditerang 50 von 100');
assertEqual(typical.sourceIdentity.selectionMetric, 'nominal_equity_cagr', 'Auswahlherkunft benennt Aktien-CAGR');
assert(logs.characteristic.find(pick => pick.key === 'p50').sourceIdentity.absoluteRunIndex !== 50, 'Vermögensmedian bleibt unabhängig');
assertEqual(logs.characteristic[logs.characteristic.findIndex(pick => pick.key === 'p50') - 1].key, 'typicalMarket', 'Marktpfad steht direkt vor Median');
assert(analyzer.getCharacteristicIndices().includes(50), 'Log-Nachzug enthält denselben Marktpfad');
const entries = buildScenarioEntries(logs);
assertEqual(entries.find(entry => entry.id === 'char_typicalMarket').group, 'wealth', 'Marktpfad erscheint in derselben Szenariogruppe');
const list = renderScenarioList(entries, 'char_typicalMarket', 'nominal');
const chart = renderScenarioWealthChart(entries, { mode: 'nominal', initialWealth: 100 });
for (const [key, label] of Object.entries(WEALTH_SCENARIO_LABELS)) {
    assertEqual(logs.characteristic.find(pick => pick.key === key).label, label, `${key}: Exportname nennt Geldendvermögen`);
    assert(list.includes(label), `${key}: sichtbare Liste nennt Geldendvermögen`);
    assert(chart.includes(label), `${key}: Kurventitel nennt Geldendvermögen`);
}
assert(list.includes('Typischer Marktverlauf') && chart.includes('char_typicalMarket'), 'Marktpfad in Liste und Vermögensdiagramm');
const comparison = renderScenarioComparison(entries, ['char_typicalMarket', 'char_p50', 'char_p90'], { chips: [] });
assert(comparison.includes('Typischer Marktverlauf') && comparison.includes('Median des Geldendvermögens'), 'Vergleichsauswahl zeigt Marktpfad und vollständige Vermögensnamen');
const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
assert(html.includes('id="scenarioSelectionInfo"') && html.includes('Erbteile an Dritte und Steuern'), 'Szenarioauswahl besitzt das erklärende Designsystem-ⓘ');

// Gleichstand nach Index, unabhängig von Registrierungsreihenfolge; fehlende
// Finanzjahre werden nicht als Rendite null eingereiht.
const tied = new ScenarioAnalyzer(5);
for (const index of [4, 3, 2, 1, 0]) tied.addRun({ index, equityCagr: index === 4 ? null : .05,
    endVermoegen: 0, lebensdauer: 0, maxKuerzung: 0 });
assertEqual(tied.buildScenarioLogs().characteristic.find(pick => pick.key === 'typicalMarket').sourceIdentity.absoluteRunIndex, 2, 'Gerade Laufzahl und Renditegleichstand werden nach Index aufgelöst');
const empty = new ScenarioAnalyzer(1);
empty.addRun({ index: 0, equityCagr: null, endVermoegen: 0, lebensdauer: 0, maxKuerzung: 0 });
assert(!empty.buildScenarioLogs().characteristic.some(pick => pick.key === 'typicalMarket'), 'Ohne Finanzjahr entsteht kein erfundener Marktpfad');
