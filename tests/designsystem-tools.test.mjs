import { createHash } from 'node:crypto';
import * as renderer from '../app/simulator/auto-optimize-renderer.js';
import { AUTO_OPTIMIZE_PARAMETER_REGISTRY } from '../app/simulator/auto-optimize-param-meta.js';
import { aggregateSweepMetrics } from '../app/simulator/simulator-results.js';
import { renderSweepHeatmapSVG } from '../app/simulator/simulator-heatmap.js';
import { readSources, validateTools, validateToolMarkup, validateFoundation, contrast, COLORS, TOOL_RENDERERS } from './designsystem-source-contract.mjs';

export const championFixture = stability => ({
    championCfg: { liquidityRunwayYears: 5, goldTargetPct: 7.5 },
    metricsTest: { successProbFloor: .95, worst5Drawdown: .21, medianEndWealth: 123456.78, timeShareWRgt45: .12 },
    deltaVsCurrent: { successRate: -.01, drawdownP90: -.02, endWealthP50: 1234.56, timeShareWRgt45: .03 },
    stability, optimizationContext: { dynamicFlexMode: 'inherit', dynamicFlexActive: true, safetyGuardsActive: false }
});
// Nur das entfernte dekorative Pokalsymbol auf den eingefrorenen Text zurückprojizieren.
// Fachtexte, Zahlen, Warnungen und die vier bisherigen Digests bleiben geschützt.
export const textDigest = html => createHash('sha256').update(html.replace(/(<h3\b[^>]*>)Champion Configuration/, '$1🏆 Champion Configuration').replace(/(\d)\u00a0%(?=\s*<\/div>)/g, '$1 %').replace(/<[^>]*>/g, '').replace(/(\d)\u00a0(?=%)/g, '$1').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim()).digest('hex');

// Prüfungen
const sources = readSources();
const seventyFiveSweep = [{ params: { liquidityRunwayYears: 3, goldRebalancingBand: 10 }, metrics: aggregateSweepMetrics(
    [false, false, false, true].map(failed => ({ finalVermoegen: failed ? 0 : 1000, failed, maxDrawdown: 20, minRunway: 24 }))
) }];
const sweepBefore = JSON.stringify(seventyFiveSweep);
assertEqual(seventyFiveSweep[0].metrics.successProbFloor, 75, 'Echte Sweepaggregation liefert 75 Prozentpunkte aus vier synthetischen Läufen');
assert(renderSweepHeatmapSVG(seventyFiveSweep, 'successProbFloor', 'liquidityRunwayYears', 'goldRebalancingBand', [3], [10]).includes('75,0\u00a0%'), 'Sweep zeigt 75 Prozent mit unverändert einer Nachkommastelle');
assertEqual(JSON.stringify(seventyFiveSweep), sweepBefore, '75-Prozent-Sweepanzeige verändert keine Metriken oder Parameter');
const seventyFiveChampion = {
    ...championFixture(.75),
    metricsTest: { successProbFloor: .75, worst5Drawdown: .75, medianEndWealth: 1000, timeShareWRgt45: .75 },
    deltaVsCurrent: { successRate: .75, drawdownP90: -.75, endWealthP50: 0, timeShareWRgt45: 0 }
};
const championBefore = JSON.stringify(seventyFiveChampion), championEl = { style: {} };
renderer.renderAutoOptimizeResult({ resultEl: championEl, result: seventyFiveChampion, objective: {} });
assert(championEl.innerHTML.includes('>75,0\u00a0%</span>'), 'Optimize zeigt 75 Prozent mit unverändert einer Nachkommastelle');
assert(championEl.innerHTML.includes('>75,00\u00a0%</span>') && championEl.innerHTML.includes('+75,00\u00a0%') && championEl.innerHTML.includes('-75,00\u00a0%'), 'Optimize bewahrt zweistellige Kennzahlen und signierte Differenzen');
assertEqual(JSON.stringify(seventyFiveChampion), championBefore, '75-Prozent-Optimizeanzeige verändert keine Ergebnisdaten');
assertEqual(JSON.stringify(validateTools(sources)), '[]', 'Benannte Werkzeugerzeuger sind vollständig tokenisiert');
for (const path of TOOL_RENDERERS) {
    for (const [label, addition, validator] of [
        ['Altpalette', '<p style="color: #123456;">Probe</p>', validateTools],
        ['Textdeckkraft', '<p style="opacity: .5;">Probe</p>', validateTools],
        ['Linienfarbe als Text', '<p style="color: var(--accent-line);">Probe</p>', validateTools],
        ['Alias', '<p style="color: var(--nicht-definiert);">Probe</p>', validateFoundation],
        ['Priorität', '<style>.probe { color: var(--text-main) !important; }</style>', validateFoundation]
    ]) {
        const mutated = { ...sources, [path]: sources[path] + '\n' + addition };
        assert(validator(mutated).length > 0, `${path}: scheiternde Gegenprobe ${label}`);
    }
}
assert(validateTools({ ...sources, 'simulator.css': sources['simulator.css'] + '\n.chart-svg .axis-label { fill: var(--chart-5); }' }).length > 0, 'Gegenprobe: Serientoken darf keine Grafiktextfarbe werden');
assert(validateToolMarkup('<svg><text fill="var(--text-main)" opacity=".8">Probe</text></svg>').length > 0, 'Gegenprobe: erzeugtes SVG-Textlabel ohne volle Deckkraft scheitert');
assert(validateToolMarkup('<div style="color: rgba(29,40,48,.5)">Probe</div>').length > 0, 'Gegenprobe: erzeugte transparente Textfarbe scheitert');
assert(validateToolMarkup('<rect class="sweep-label-bg" fill="var(--accent-line)" />').length > 0, 'Gegenprobe: Labelunterlage darf keine Palettenfarbe sein');
assert(validateTools({ ...sources, 'app/simulator/simulator-heatmap.js': sources['app/simulator/simulator-heatmap.js'].replace('.cell-label-text {', '.cell-label-text { opacity: .5;') }).length > 0, 'Gegenprobe: Deckkraft in erzeugtem HEATMAP_V4_STYLE scheitert');
assert(validateTools({ ...sources, 'app/shared/designsystem-chart-colors.js': sources['app/shared/designsystem-chart-colors.js'].replace("bgFill: 'var(--surface)'", "bgFill: 'var(--heatmap-mid)'") }).length > 0, 'Gegenprobe: opakes Labelpaar in der Farbhilfe ist verbindlich');
assert(contrast(COLORS['text-main'], COLORS['accent-line']) >= 4.5, 'Fortschrittstext ist auf Messinglinie und heller Restfläche lesbar');
assert(contrast(COLORS['text-muted'], COLORS['bad-soft']) >= 4.5, 'Hilfetext bleibt auf allen Werkzeugstatusflächen lesbar');
for (const bg of ['surface', 'surface-sunken', 'good-soft', 'warn-soft', 'bad-soft']) {
    for (const fg of ['text-main', 'text-muted']) assert(contrast(COLORS[fg], COLORS[bg]) >= 4.5, `Werkzeugtext ${fg}/${bg} mindestens 4,5:1`);
}
for (const status of ['good', 'warn', 'bad']) assert(contrast(COLORS.surface, COLORS[status]) >= 4.5, `Stabilitätslabel surface/${status} mindestens 4,5:1`);
for (const fg of ['good', 'bad']) for (const bg of ['good-soft', 'bad-soft']) assert(contrast(COLORS[fg], COLORS[bg]) >= 4.5, `Selbsttest-Einzelmeldung ${fg}/${bg} mindestens 4,5:1`);
// Basis cdef93e7: nur Dezimalzeichen und der neue Einheitenabstand vor Prozent normalisiert; Digests bleiben unverändert.
const baseline = ["3c720383951d5021a9d71919768fa402dfa31ed7f9a14d0aa9232bdff45ea008","fb38bafad2944aea23b71fa3da10e6e063ba86d0a9e4c7cd52fc8763ae5166f9","980325617e2cbc9c162f6472d54e062e23b1830fe92afb1c23159a605c98e28e","103c88cafb4ed520620f173b2c10f300f374c7c1ffadbdf430acfa27a61d9dab"];
const fragments = [];
for (const [i, stability] of [.59, .60, .79, .80].entries()) {
    const resultEl = { style: {} };
    const result = championFixture(stability), before = JSON.stringify(result);
    renderer.renderAutoOptimizeResult({ resultEl, result, objective: {} });
    fragments.push(resultEl.innerHTML);
    assert(resultEl.innerHTML.includes('95,0\u00a0%') && resultEl.innerHTML.includes('-1,00\u00a0%') && resultEl.innerHTML.includes('7,5'), 'Championwerte und Parametertabelle sind deutsch bei gleicher Präzision');
    assertEqual(textDigest(resultEl.innerHTML), baseline[i], 'Auto-Optimize-Zahlen, Warntexte und Stabilitätsgrenzen stimmen mit Basis cdef93e7 nach Textnormalisierung überein');
    assertEqual(JSON.stringify(result), before, 'Championrenderer verändert keine Ergebnis-/Übernahmeparameter');
    assert(resultEl.innerHTML.includes(`background: var(--${stability >= .8 ? 'good' : stability >= .6 ? 'warn' : 'bad'}); color: var(--surface)`), 'Stabilitätsfarbe verwendet dieselben Schwellen mit kontrastfestem Text');
    assert(resultEl.innerHTML.includes('<h4 style="margin: 0; color: var(--surface);">Stability Score:'), 'Stabilitätsüberschrift überschreibt die dunkle globale h4-Farbe');
    assert(resultEl.innerHTML.includes('data-auto-optimize-model-warning') && resultEl.innerHTML.includes('data-auto-optimize-model-status'), 'Warn- und Modellstatusanker bleiben erhalten');
    assertEqual(JSON.stringify(validateToolMarkup(resultEl.innerHTML)), '[]', 'Tatsächliches Championmarkup erfüllt den Textvertrag');
}
// Rohwert entscheidet: null/-0 neutral, auch Kleinstwerte behalten ihre Richtung.
for (const value of [0, -0, .01, -.01, 1e-12, -1e-12, NaN, Infinity, -Infinity]) {
    const result = championFixture(.8);
    for (const key of Object.keys(result.deltaVsCurrent)) result.deltaVsCurrent[key] = value;
    const before = structuredClone(result), resultEl = { style: {} };
    renderer.renderAutoOptimizeResult({ resultEl, result, objective: {} });
    const delta = resultEl.innerHTML.split('Delta vs. Current Configuration')[1].split('Stability Score:')[0];
    const colors = [...delta.matchAll(/color: (var\(--[\w-]+\));/g)].map(match => match[1]);
    const normal = value === 0 ? 'text-main' : value >= 0 ? 'good' : 'bad';
    const inverse = value === 0 ? 'text-main' : value <= 0 ? 'good' : 'bad';
    assertEqual(JSON.stringify(colors.slice(0, 4)), JSON.stringify([normal, inverse, normal, inverse].map(token => `var(--${token})`)), `Vier Optimize-Richtungen für ${Object.is(value, -0) ? '-0' : value}`);
    for (const key of Object.keys(result.deltaVsCurrent)) assert(Object.is(result.deltaVsCurrent[key], before.deltaVsCurrent[key]), 'Renderer erhält auch -0 und nichtfinite Rohwerte');
}
// Reale Parameterblöcke mit dokumentzugeordneten Listener-Zielen, Min/Max/Step
// und vorhandenen data-param-id-Ankern; der Adapter ergänzt keine Fachlogik.
const fields = Object.fromEntries(['key', 'min', 'max', 'step'].map(name => [`.ao-param-${name}`, { listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; } }]));
for (const field of Object.values(fields)) field.classList = { add: name => (field.classes ||= []).push(name) };
const units = [{}, {}, {}];
const block = { style: {}, querySelector: selector => fields[selector], querySelectorAll: () => units };
const doc = { createElement: () => block };
renderer.createAutoOptimizeParameterBlock({ paramId: 7, paramNumber: 2, defaults: { key: 'liquidityRunwayYears', min: 3, max: 5, step: .5 }, doc });
assertEqual(JSON.stringify(fields['.ao-param-key'].classes), '["ds-select"]', 'Keyfeld erhält die additive Selectrolle über den echten DOM-Consumer');
for (const name of ['min', 'max', 'step']) assertEqual(JSON.stringify(fields[`.ao-param-${name}`].classes), '["ds-input"]', 'Zahlenfeld erhält additive Inputrolle über den echten DOM-Consumer');
assert(block.innerHTML.includes('id="ao_param_7_key"') && block.innerHTML.includes('for="ao_param_7_key"'), 'Dynamische Parameterauswahl erhält stabile ID für den sichtbaren Volltext');
assertEqual((block.innerHTML.match(/data-ao-param-unit>Jahre/g) || []).length, 3, 'Minimum, Maximum und Schritt tragen die gewählte Einheit');
assertEqual(block.id, 'ao_param_7', 'Dynamischer Parameter-ID-Anker bleibt erhalten');
assert(block.className.split(' ').includes('ao-parameter-block') && block.className.split(' ').includes('ds-card'), 'Parameterklasse bleibt neben additiver Kartenrolle erhalten');
for (const name of ['key', 'min', 'max', 'step']) assert(new RegExp(`class="[^"]*ao-param-${name}" data-param-id="7"`).test(block.innerHTML), 'ao-param-Selektoren und data-param-id bleiben erhalten');
assert(block.innerHTML.includes('value="3"') && block.innerHTML.includes('value="5"') && block.innerHTML.includes('value="0.5"'), 'Parameterblock erhält übergebene Werte unverändert');
fields['.ao-param-key'].value = 'goldTargetPct'; fields['.ao-param-key'].listeners.change();
assert(units.every(unit => unit.textContent === '%'), 'Parameterwechsel aktualisiert alle Einheiten');
const domain = AUTO_OPTIMIZE_PARAMETER_REGISTRY.goldTargetPct.domain;
assertEqual(JSON.stringify([fields['.ao-param-min'].value, fields['.ao-param-max'].value, fields['.ao-param-step'].value]), JSON.stringify([domain.min, domain.max, domain.step]), 'Echter Key-Listener erhält Domainübernahme mit Min/Max/Step');

const oldDocument = globalThis.document, oldWindow = globalThis.window, oldAlert = globalThis.alert;
const nodes = {};
const node = id => nodes[id] ||= { innerHTML: '', style: {}, events: [], addEventListener(type, listener) { this.listener = listener; }, dispatchEvent(event) { this.events.push(event.type); } };
globalThis.document = { getElementById: node, addEventListener() {} };
globalThis.window = {};
globalThis.alert = () => {};
try {
    const optimizer = await import('../app/simulator/simulator-optimizer.js');
    const results = [1000, 2000].map((wealth, i) => ({ params: { liquidityRunwayYears: 3 + i, goldTargetPct: 5 }, metrics: aggregateSweepMetrics([{ finalVermoegen: wealth, failed: false, maxDrawdown: 20, minRunway: 24 }]) }));
    const before = JSON.stringify(results);
    const best = optimizer.findBestParameters(results, 'medianEndWealth');
    assertEqual(best.params.liquidityRunwayYears, 4, 'Ergebnisrangfolge bleibt unverändert');
    optimizer.displayBestParameters(best, 'medianEndWealth');
    fragments.push(nodes.optimizationResults.innerHTML);
    assert(nodes.optimizationResults.innerHTML.includes('id="applyOptimalParams"'), 'Sweep-Übernahmeanker bleibt erhalten');
    nodes.applyOptimalParams.listener();
    assertEqual(nodes.liquidityRunwayYears.value, 4, 'Echter Übernahmelistener schreibt denselben Runway');
    assertEqual(nodes.goldAllokationProzent.value, 5, 'Echter Übernahmelistener schreibt dieselbe Goldallokation');
    assertEqual(nodes.goldAllokationAktiv.value, 'true', 'Übernahme erhält den bestehenden Goldaktivzweig');
    assertEqual(JSON.stringify(nodes.liquidityRunwayYears.events), '["change"]', 'Übernahme erhält bestehenden Change-Listener-Vertrag');
    assertEqual(JSON.stringify(results), before, 'Ergebnisrangfolge und Übernahme mutieren keine Sweep-Daten');
} finally { globalThis.document = oldDocument; globalThis.window = oldWindow; globalThis.alert = oldAlert; }
assertEqual(JSON.stringify(validateTools(sources, fragments)), '[]', 'Erzeugte Champion- und Optimiererfragmente besitzen gültige Textfarben');

for (const html of [
    '<rect class="cell-label-bg" fill="var(--surface)" />',
    '<text class="sweep-cell-text" fill="var(--chart-label-dark)" stroke="var(--surface)" paint-order="stroke">75,0 %</text>',
    '<text class="cell-label-text" fill="var(--chart-label-light)" opacity=".5">1 %</text>'
]) assert(validateToolMarkup(html).length > 0, 'P16b-Gegenprobe: Labelplatte, Halo oder Textdeckkraft werden abgewiesen');
