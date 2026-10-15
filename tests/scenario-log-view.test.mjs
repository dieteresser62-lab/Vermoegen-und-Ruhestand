import { bindScenarioLogView, disposeScenarioLogView, renderScenarioList, scenarioGroupEntries, focusSelectedScenario } from '../app/simulator/scenario-log-view.js';
import { buildScenarioEntries, renderScenarioWealthChart } from '../app/simulator/scenario-wealth-chart.js';
import { displayMonteCarloResults, WORST_LOG_DETAIL_KEY } from '../app/simulator/simulator-results.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { persistenceStorage } from '../app/shared/persistence-facade.js';

class Element {
    constructor(id) { this.id = id; this.value = ''; this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.children = []; this.focusCount = 0; this.focusCalls = []; this.scrollCalls = []; this.checked = false; this.writes = 0; this.classList = { add() {}, remove() {} }; }
    addEventListener(type, handler) { const handlers = this.listeners.get(type) || new Set(); handlers.add(handler); this.listeners.set(type, handlers); }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatch(type, target = this, key) { let prevented = false; for (const handler of [...(this.listeners.get(type) || [])]) handler({ target, currentTarget: this, key, preventDefault() { prevented = true; } }); return prevented; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    closest(selector) { return this.attributes[selector.slice(1, -1)] !== undefined ? this : null; }
    querySelectorAll(selector) { return this.children.filter(e => selector === '[role="option"]' ? e.getAttribute('role') === 'option' : selector === '[data-scenario-group]' ? e.getAttribute('data-scenario-group') : true); }
    contains(node) { return this.children.includes(node); }
    getBoundingClientRect() { return this.rect || { top: 0, bottom: 100 }; }
    focus(options) { this.focusCount++; this.focusCalls.push(options); this.onFocus?.(); doc.activeElement = this; }
    scrollIntoView(options) { this.scrollCalls.push(options); }
    set innerHTML(value) { this.markup = value; this.writes++; this.children = [...value.matchAll(/<button ([^>]+)>/g)].map(match => {
        const e = new Element('option'); for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(attr[1], attr[2]); return e;
    }); }
    get innerHTML() { return this.markup || ''; }
    appendChild(node) { this.children.push(node); node.parentNode = this; }
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); }
    click() { downloads++; }
}
const ids = ['monteCarloPersonNotice', 'scenarioGroups', 'scenarioSelectionDisclosure', 'scenarioSelectionSummary', 'scenarioSelectedHeading', 'scenarioPrevious', 'scenarioNext', 'scenarioList', 'scenarioWealthChart', 'mcWealthMode', 'scenarioLogContainer', 'scenarioSelector', 'scenarioLogOutput', 'scenarioProtocolSummary', 'scenarioExportButtons', 'exportScenarioLogJson', 'exportScenarioLogCsv', 'toggle-log-detail', 'toggle-care-details', 'monteCarloResults', 'wealthDistribution', 'toastContainer', 'stressReplayFixButton', 'stressReplayStatus', 'stressReplaySelectedScenarioEmpty', 'stressReplaySelectedScenarioDetails', 'stressReplaySelectedScenarioLabel', 'stressReplaySelectedScenarioWealth', 'stressReplaySelectedScenarioCare'];
const hosts = Object.fromEntries(ids.map(id => [id, new Element(id)]));
for (const id of ['scenarioComparison', 'scenarioComparisonChart', 'scenarioComparisonChartBasis', 'scenarioLogAnalysis']) hosts[id] = new Element(id);
const doc = { getElementById: id => hosts[id] || null, createElement: () => new Element('download'), body: new Element('body') };
for (const id of ['mcWealthMode']) hosts[id].children = ['real', 'nominal'].map(mode => { const e = new Element(mode); e.setAttribute('data-wealth-mode', mode); return e; });
const pick = id => { const e = new Element('button'); e.setAttribute('data-scenario-id', id); return e; };
const row = { jahr: 1, recordType: 'financial_year', financiallyEvaluable: true, portfolio_total_end: 100, inflation_factor_cum: 1.25, entscheidung: { jahresEntnahme: 10 }, aktionUndGrund: 'Halten', Person1Alive: 1 };
const worst = { key: 'worst', label: 'Worst Case', sourceIdentity: { absoluteRunIndex: 0 }, endVermoegen: 100, failed: false, logDataRows: [row] };
const median = { ...worst, key: 'p50', label: 'Median', logDataRows: [{ ...row, portfolio_total_end: 200 }] };
const logs = { characteristic: [worst, median], random: [{ ...worst, key: 'random_0' }] };
const entries = buildScenarioEntries(logs);
const list = renderScenarioList(entries, 'char_worst', 'real');
assert(list.includes('role="option"') && list.includes('aria-selected="true"'), 'Eine aktive Gruppe besitzt echte Optionen');
assertEqual((list.match(/tabindex="0"/g) || []).length, 1, 'Genau eine Option ist Tab-Einstieg');
assert(!list.includes('rand_random_0') && !list.includes('scenario-sample-chip'), 'Nur aktive Gruppe, keine Chips');
const careEmpty = renderScenarioList(entries, '', 'real', { activeGroup: 'care' });
assert(careEmpty.includes('Keine beobachteten Pflegefälle'), 'Leere Pflegegruppe bleibt ehrlich');
const chartMarkup = renderScenarioWealthChart(entries);
for (const entry of entries) {
    const rows = renderScenarioList(entries, entry.id, 'real');
    const button = rows.split(`data-scenario-id="${entry.id}"`)[1].split('</button>')[0];
    const line = chartMarkup.split(`data-scenario-id="${entry.id}"`)[1].split('</g>')[0];
    assert(button.includes(`--scenario-color:${entry.color}`) && line.includes(`stroke="${entry.color}"`), `${entry.id}: identische Linienfarbe`);
}
const fifteen = renderScenarioList(buildScenarioEntries({ random: Array.from({ length: 15 }, (_, index) => ({ ...worst, key: `sample_${index}` })) }), '', 'real');
assertEqual((fifteen.match(/role="option"/g) || []).length, 15, 'Alle Stichproben sind gleichwertige Zeilen');
assert(!fifteen.includes('#15') && fifteen.includes('Worst Case'), 'Stichproben behalten Quellnamen statt Nummern');
const ruinedList = renderScenarioList(buildScenarioEntries({ characteristic: [{ ...worst, failed: true, logDataRows: [{ jahr: 3, recordType: 'terminal_ruin' }] }] }), 'char_worst', 'real', { startYear: 2026 });
assert(ruinedList.includes('<small class="scenario-value is-ruin">Ruin 2028</small>'), 'Ruinlauf zeigt Kalenderjahr im rechten Wertbereich');
let selectionCalls = [], modeCalls = [];
let binding;
for (let iteration = 0; iteration < 3; iteration++) binding = bindScenarioLogView({ document: doc, logs, onSelect: (id, source) => selectionCalls.push({ id, source }), onMode: mode => modeCalls.push(mode), chartOptions: { initialWealth: 80 } });
for (const [id, event] of [['scenarioGroups', 'click'], ['scenarioList', 'click'], ['scenarioWealthChart', 'click'], ['mcWealthMode', 'click']]) assertEqual(hosts[id].listeners.get(event).size, 1, `${id}: Neuveröffentlichung belässt genau einen Listener`);
const initialCalls = selectionCalls.length;
hosts.scenarioList.dispatch('click', pick('char_p50'));
assertEqual(selectionCalls.length - initialCalls, 1, 'Listenklick rendert genau ein Protokoll');
assert(selectionCalls.at(-1).source === median, 'Listenklick bewahrt das Quellobjekt');
assertEqual(hosts.scenarioList.getAttribute('data-selected-id'), 'char_p50', 'Liste trägt die aktuelle Kennung');
hosts.scenarioWealthChart.dispatch('click', pick('rand_random_0'));
assertEqual(hosts.scenarioList.getAttribute('data-selected-id'), 'rand_random_0', 'SVG wählt denselben Lauf auch bei mehrfach referenzierter Quelle');
hosts.scenarioList.dispatch('click', pick('char_p50'));
assert(selectionCalls.at(-1).source === median, 'Zugängliche Alternative nutzt denselben Auswahlweg');
const beforeMode = selectionCalls.length;
hosts.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
assertEqual(selectionCalls.length, beforeMode, 'Maßstabwechsel erzeugt keine zweite Protokoll-/Exportprojektion');
assertEqual(hosts.scenarioList.getAttribute('data-selected-id'), 'char_p50', 'Maßstabwechsel erhält die Kennung');
assertEqual(hosts.mcWealthMode.children[1].getAttribute('aria-pressed'), 'true', 'Gemeinsamer Maßstabschalter zeigt den gewählten Modus');
const focused = hosts.scenarioList.children.find(e => e.getAttribute('data-scenario-id') === 'char_p50'); doc.activeElement = focused;
hosts.scenarioList.dispatch('click', focused);
assert(doc.activeElement.focusCount > 0, 'Tastaturfokus bleibt bei Listenwahl erreichbar');
binding.switchGroup('care');
assertEqual(selectionCalls.at(-1).source, null, 'Leerauswahl gibt keinen alten Quelllauf zurück');
disposeScenarioLogView(doc);
assertEqual(hosts.scenarioGroups.listeners.get('click').size, 0, 'Dispose entfernt den Gruppenlistener');

// Echter Ergebnisbinder und echte Blobdownloads: Modus, Linie, Liste, Details,
// neuer Batch und Fehler dürfen die semantische Exportprojektion nicht verändern.
const saved = Object.fromEntries(['document', 'window', 'console', 'requestAnimationFrame', 'setTimeout'].map(key => [key, globalThis[key]]));
const preferences = [WORST_LOG_DETAIL_KEY, 'showCareDetails', 'logDetailLevel'].map(key => [key, persistenceStorage.getItem(key)]);
const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
let downloads = 0, blobs = [];
try {
    globalThis.document = doc; globalThis.window = {};
    globalThis.requestAnimationFrame = () => {}; globalThis.setTimeout = () => 0;
    globalThis.console = { ...saved.console, error() {} };
    URL.createObjectURL = blob => { blobs.push(blob); return 'blob:probe'; }; URL.revokeObjectURL = () => {};
    const run = batch => displayMonteCarloResults({}, 1, 0, null, {}, {}, 0, { startAlter: 62 }, null, batch, { startYear: 2026 });
    const draft = { startAlter: 62, startVermoegen: 1200, minimumFlexAnnual: 100,
        partner: { aktiv: true }, pflegefallLogikAktivieren: true };
    const names = { persons: [{ name: 'Max Mustermann' }, { name: 'Erika Mustermann' }] };
    const carePath = { ...worst, key: 'p10', label: 'Pflegepfad', logDataRows: [
        { ...row, inflation: 0, minimumFlexAnnual: 100, flex_haushalt_erfuellt: 100,
            Person2Alive: 1, CareP1_Active: 0, CareP2_Active: 0 },
        { ...row, jahr: 2, inflation: 0, minimumFlexAnnual: 100, flex_haushalt_erfuellt: 99,
            Person2Alive: 1, CareP1_Active: 1, CareP1_Grade: 2, CareP2_Active: 0 },
        { jahr: 3, recordType: 'terminal_death', financiallyEvaluable: false,
            Person1Alive: 0, Person2Alive: 0, portfolio_total_end: 0 }
    ] };
    const careBatch = { characteristic: [carePath], random: [] }, careBefore = JSON.stringify(careBatch);
    displayMonteCarloResults({}, 1, 0, null, {}, {}, 0, draft, null, careBatch,
        { startYear: 2026, personDisplayContext: names });
    const originalCards = hosts.scenarioLogAnalysis.innerHTML;
    assert(originalCards.includes('Pflege Max Mustermann') && originalCards.includes('Tod Erika Mustermann'), 'Durchstich zeigt Pflege und Terminalereignisse mit Laufnamen');
    assert(hosts.scenarioComparison.innerHTML.includes('<td>2</td>'), 'Durchstich zählt im Vergleich zwei Entnahmejahre ohne Todeszeile');
    draft.minimumFlexAnnual = 9999; draft.startVermoegen = 1; draft.partner.aktiv = false;
    names.persons[0].name = 'Geänderter Entwurf';
    hosts['toggle-log-detail'].dispatch('change');
    assertEqual(hosts.scenarioLogAnalysis.innerHTML, originalCards, 'Geänderte Eingaben und Detailneuaufbau erhalten Karten samt eingefrorenen Personen');
    hosts.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
    assertEqual(hosts.scenarioLogAnalysis.innerHTML, originalCards, 'Euro-Wechsel nach Eingabeänderung behält die Geldbasis der Karten');
    assert(window.globalCurrentScenarioData.rows === carePath.logDataRows, 'Veraltete Eingaben ersetzen keine Protokollquelle');
    assertEqual(JSON.stringify(careBatch), careBefore, 'Durchstich lässt Pflege- und Terminalbeleg unverändert');
    const ruinPath = { ...worst, label: 'Neuer Ruinpfad', failed: true, endVermoegen: 0,
        logDataRows: [carePath.logDataRows[0], { jahr: 2, recordType: 'terminal_ruin', financiallyEvaluable: false,
            portfolio_total_end: 0, flex_haushalt_erfuellt: 0 }] };
    run({ characteristic: [ruinPath], random: [] });
    assert(hosts.scenarioLogAnalysis.innerHTML.includes('Neuer Ruinpfad') && !hosts.scenarioLogAnalysis.innerHTML.includes('Pflege Max Mustermann'), 'Neuer Lauf entfernt Pflegekarten des alten Laufs');
    assert(hosts.scenarioLogAnalysis.innerHTML.includes('data-scenario-analysis-year="2"')
        && hosts.scenarioLogOutput.innerHTML.includes('id="scenario-year-2"'), 'Neuer Ruinlink und Protokoll zeigen dieselbe Terminalzeile');
    run(logs); run(logs); run(logs);
    const jsonOracle = serializeScenarioLogExportV2(projectScenarioLogV2(worst.logDataRows));
    const csvOracle = serializeScenarioLogCsvV2(projectScenarioLogV2(worst.logDataRows));
    for (const source of ['list', 'svg', 'navigation']) {
        if (source === 'navigation') hosts.scenarioList.dispatch('click', pick('char_p50'));
        const writes = hosts.scenarioLogOutput.writes;
        if (source === 'list') hosts.scenarioList.dispatch('click', pick('char_worst'));
        else if (source === 'svg') hosts.scenarioWealthChart.dispatch('click', pick('rand_random_0'));
        else hosts.scenarioPrevious.dispatch('click');
        assertEqual(hosts.scenarioLogOutput.writes - writes, 2, `${source}: genau eine Invalidierung und eine Protokolldarstellung`);
        assert(window.globalCurrentScenarioData.rows === worst.logDataRows, `${source}: Download verwendet exakt die aktuellen Rohzeilen`);
        assert(!hosts.scenarioLogAnalysis.hidden && hosts.scenarioLogAnalysis.innerHTML.includes('Worst Case · Pfad 1'), `${source}: Auffälliges folgt derselben Quelle`);
        assertEqual(hosts.stressReplaySelectedScenarioLabel.textContent, 'Worst Case', `${source}: Replayprojektion folgt derselben Auswahl`);
        hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
        assertEqual(await blobs.at(-2).text(), jsonOracle, `${source}: vollständiger JSON-Download bleibt bytegleich`);
        assertEqual(await blobs.at(-1).text(), csvOracle, `${source}: vollständiger CSV-Download bleibt bytegleich`);
    }
    const personContext = { schemaVersion: 1, referenceYear: 2027, ageRule: 'january-1-completed-years', deviationApplied: true,
        persons: [{ profileId: 'a', role: 'primary', changes: [{ field: 'profile_rente_monatlich', profileValue: 1000, effectiveValue: 2000 }] }] };
    displayMonteCarloResults({}, 1, 0, null, {}, {}, 0, { startAlter: 62 }, null, logs, { startYear: 2027, personDataContext: personContext });
    const frozenPersonOracle = structuredClone(personContext);
    personContext.persons[0].changes[0].effectiveValue = 9999;
    for (const id of ['char_worst', 'char_p50', 'rand_random_0']) {
        hosts.scenarioList.dispatch('click', pick(id));
        assert(hosts.monteCarloPersonNotice.innerHTML.includes('Abweichung · nur diese Rechnung') && hosts.scenarioProtocolSummary.innerHTML.includes('2000'), 'Echter Ergebnis-/Protokollbinder zeigt eigenen eingefrorenen Hinweis');
        assert(!hosts.scenarioProtocolSummary.innerHTML.includes('9999'), 'Späterer Entwurf verändert keine Szenarioprotokolle');
        hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
        assertEqual(JSON.parse(await blobs.at(-2).text()).personDataContext.persons[0].changes[0].effectiveValue, 2000, 'Szenario/Worst/Pflege-Rebind exportiert eingefrorenen Personenwert');
        assertEqual(await blobs.at(-2).text(), serializeScenarioLogExportV2(projectScenarioLogV2(window.globalCurrentScenarioData.rows, { personDataContext: frozenPersonOracle })), 'Personen-JSON bleibt vollständig bytegleich');
        assertEqual(await blobs.at(-1).text(), serializeScenarioLogCsvV2(projectScenarioLogV2(window.globalCurrentScenarioData.rows, { personDataContext: frozenPersonOracle })), 'Personen-CSV bleibt vollständig bytegleich');
        assert((await blobs.at(-1).text()).includes('personDataChanges'), 'Tatsächlicher CSV-Download enthält additive Kontextspalten');
    }
    run(logs);
    assertEqual(hosts.monteCarloPersonNotice.innerHTML, '', 'Zweiter regulärer Ergebnisbatch entfernt falschen Alternativhinweis');
    const writes = hosts.scenarioLogOutput.writes;
    const analysisBeforeMode = hosts.scenarioLogAnalysis.innerHTML;
    hosts.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
    assertEqual(hosts.scenarioLogOutput.writes, writes, 'Real-/Nominalwechsel verändert das nominale Rohprotokoll nicht');
    assertEqual(hosts.scenarioLogAnalysis.innerHTML, analysisBeforeMode, 'Euro-Wechsel erhält Pfadkarten und ihre benannte Geldbasis');
    for (const detail of [false, true]) for (const care of [false, true]) {
        hosts['toggle-log-detail'].checked = detail; hosts['toggle-log-detail'].dispatch('change');
        hosts['toggle-care-details'].checked = care; hosts['toggle-care-details'].dispatch('change');
        hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
        assertEqual(await blobs.at(-2).text(), jsonOracle, 'Modus und Detail-/Pflegewechsel verändern JSON nicht');
        assertEqual(await blobs.at(-1).text(), csvOracle, 'Modus und Detail-/Pflegewechsel verändern CSV nicht');
    }
    hosts.scenarioList.dispatch('click', pick('char_p50'));
    assert(window.globalCurrentScenarioData.rows === median.logDataRows, 'Andere Kennung wechselt die Exportquelle auf ihren eigenen Lauf');
    assert(hosts.scenarioLogAnalysis.innerHTML.includes('Median · Pfad 1'), 'Andere Kennung aktualisiert auch die Ereigniskarten');
    // B vor dem regulären Rebind publizieren; keine künstliche Listeoption nach Bindung.
    const invalidRows = [{ ...row, invalidExportProbe: Number.NaN }];
    const badB = { ...median, key: 'bad_b', label: 'B', logDataRows: invalidRows };
    run({ characteristic: [worst, median, badB], random: [] });
    for (const scenario of [worst, median]) {
        hosts.scenarioList.dispatch('click', pick('char_' + scenario.key));
        assert(window.globalCurrentScenarioData.rows === scenario.logDataRows, 'Gültiger Listenwechsel erhält exakte Rohquelle');
        assertEqual(hosts.stressReplaySelectedScenarioLabel.textContent, scenario.label, 'Replayquelle folgt gültigem Listewechsel');
        hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
        assertEqual(await blobs.at(-2).text(), serializeScenarioLogExportV2(projectScenarioLogV2(scenario.logDataRows)), 'Gültiger Listenwechsel erhält vollständiges V2-JSON');
        assertEqual(await blobs.at(-1).text(), serializeScenarioLogCsvV2(projectScenarioLogV2(scenario.logDataRows)), 'Gültiger Listenwechsel erhält vollständiges V2-CSV');
    }
    hosts.scenarioList.dispatch('click', pick('char_bad_b'));
    assert(window.globalCurrentScenarioData.rows === invalidRows, 'B wird exakt aktuelle Rohquelle');
    assert(!Object.hasOwn(window.globalCurrentScenarioData, 'exportDocument'), 'Auswahl legt keinen Projektionscache an');
    const downloadsBeforeB = downloads, blobsBeforeB = blobs.length;
    hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
    assertEqual(downloads, downloadsBeforeB, 'Projektionsfehler erzeugt keinen JSON-/CSV-Download von A');
    assertEqual(blobs.length, blobsBeforeB, 'Projektionsfehler serialisiert keine Teildaten');
    assert(hosts.toastContainer.children.some(node => node.textContent?.includes('Szenario-Export nicht möglich')), 'Projektionsfehler bleibt sichtbar');
    assertEqual(hosts.scenarioList.getAttribute('data-selected-id'), 'char_bad_b', 'Exportfehler erhält B-Auswahl');
    assert(window.globalCurrentScenarioData.rows === invalidRows, 'Exportfehler erhält Bs Rohquelle');
    hosts.scenarioList.dispatch('click', pick('char_unknown'));
    assertEqual(window.globalCurrentScenarioData, null, 'Unbekannte ID invalidiert weiter die Quelle');
    assert(hosts.scenarioLogAnalysis.hidden && !hosts.scenarioLogAnalysis.innerHTML, 'Unbekannte ID entfernt alte Ereigniskarten');
    run({ characteristic: [worst, { ...median, key: 'empty', logDataRows: [] }], random: [] });
    hosts.scenarioWealthChart.dispatch('click', pick('char_empty'));
    assertEqual(window.globalCurrentScenarioData, null, 'Fehlende Logs entfernen die alte Exportquelle');
    assert(hosts.scenarioLogAnalysis.hidden, 'Leerer Pfad zeigt keine alten Auffälligkeiten');
    const beforeMissing = downloads; hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
    assertEqual(downloads, beforeMissing, 'Fehlende Logs erzeugen keinen alten Download');
    const invalid = { characteristic: [{ ...worst, logDataRows: [{ ...row, get aktionUndGrund() { throw new Error('synthetischer Renderfehler'); } }] }], random: [] };
    run(invalid);
    assertEqual(window.globalCurrentScenarioData, null, 'Darstellungsfehler invalidiert den alten Exportpfad');
    assert(hosts.scenarioLogAnalysis.hidden, 'Darstellungsfehler entfernt alte Pfadkarten');
    assertEqual(hosts.stressReplaySelectedScenarioDetails.hidden, true, 'Darstellungsfehler entfernt die alte Replayprojektion');
    const previousDownloads = downloads; hosts.exportScenarioLogJson.onclick();
    assertEqual(downloads, previousDownloads, 'Fehler erzeugt keinen Download des alten Laufs');
    run(logs); run(null);
    assertEqual(window.globalCurrentScenarioData, null, 'Neuer Batch ohne Logs invalidiert alle Auswahlflächen');
    assert(hosts.scenarioLogAnalysis.hidden && !hosts.scenarioLogAnalysis.innerHTML, 'Neuer Batch ohne Logs entfernt Ereigniskarten');
    assertEqual(hosts.exportScenarioLogJson.onclick, null, 'Neuer leerer Batch entfernt alte Downloadclosure');
    assertEqual(hosts.scenarioGroups.listeners.get('click').size, 1, 'Leerer Batch hat nur den aktuellen leeren Auswahlweg');
} finally {
    disposeScenarioLogView(doc);
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    for (const [key, value] of preferences) if (value === null) persistenceStorage.removeItem(key); else persistenceStorage.setItem(key, value);
}

// Hostgeometrie: Resize zeichnet nur neu, ohne Auswahl-/Export-/Modusereignis.
{
    const nodes = Object.fromEntries(['scenarioGroups', 'scenarioSelectionDisclosure', 'scenarioSelectionSummary', 'scenarioSelectedHeading', 'scenarioPrevious', 'scenarioNext', 'scenarioList', 'scenarioWealthChart', 'mcWealthMode'].map(id => [id, new Element(id)]));
    const observers = new Set();
    class Observer {
        constructor(callback) { this.callback = callback; observers.add(this); }
        observe(node) { this.node = node; }
        disconnect() { observers.delete(this); }
    }
    const sizedDoc = { getElementById: id => nodes[id], defaultView: Object.assign(new Element('window'), { ResizeObserver: Observer, innerWidth: 1920, getComputedStyle: () => ({ paddingLeft: '12px', paddingRight: '8px' }) }) };
    nodes.scenarioWealthChart.clientWidth = 900;
    const rawBefore = JSON.stringify(logs);
    const exportsBefore = entries.map(entry => [serializeScenarioLogExportV2(projectScenarioLogV2(entry.scenario.logDataRows)),
        serializeScenarioLogCsvV2(projectScenarioLogV2(entry.scenario.logDataRows))]);
    let selected = 0, modes = 0;
    const bind = () => bindScenarioLogView({ document: sizedDoc, logs, onSelect: () => selected++, onMode: () => modes++ });
    try {
        bind(); const binding = bind();
        binding.choose('char_p50');
        nodes.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
        assertEqual(observers.size, 1, 'Neubindung entfernt den bisherigen Größenbeobachter');
        const selectionBefore = selected, modeBefore = modes;
        for (const width of [0, 1200, 768, 650, 1500]) {
            nodes.scenarioWealthChart.clientWidth = width;
            for (const observer of observers) observer.callback();
            assert(nodes.scenarioWealthChart.innerHTML.includes(`viewBox="0 0 ${width > 20 ? width - 20 : 1100} 470"`), 'Resize projiziert die aktuelle Hostbreite');
            assertEqual(selected, selectionBefore, 'Resize startet keine neue Szenarioauswahl');
            assertEqual(modes, modeBefore, 'Resize startet keinen Maßstabwechsel');
            assertEqual(binding.selectedId, 'char_p50', 'Resize erhält aktive Szenariokennung');
            assertEqual(binding.mode, 'nominal', 'Resize erhält nominalen Modus');
        }
        const chartWrites = nodes.scenarioWealthChart.writes, listWrites = nodes.scenarioList.writes;
        for (const observer of observers) observer.callback();
        assertEqual(nodes.scenarioWealthChart.writes, chartWrites, 'Unveränderte Inhaltsbreite erzeugt keine Größenrückkopplung');
        assertEqual(nodes.scenarioList.writes, listWrites, 'Resize ersetzt weder Listeneinträge noch deren Fokus/Scrollzustand');
        assertEqual(JSON.stringify(logs), rawBefore, 'Resize erhält vollständige Rohlogs und Quellidentitäten');
        assertEqual(JSON.stringify(entries.map(entry => [serializeScenarioLogExportV2(projectScenarioLogV2(entry.scenario.logDataRows)),
            serializeScenarioLogCsvV2(projectScenarioLogV2(entry.scenario.logDataRows))])), JSON.stringify(exportsBefore), 'Resize erhält sämtliche JSON-/CSV-Exportprojektionen');
    } finally { disposeScenarioLogView(sizedDoc); }
    assertEqual(observers.size, 0, 'Dispose entfernt auch den Größenbeobachter');
    assertEqual(sizedDoc.defaultView.listeners.get('resize').size, 0, 'Dispose entfernt Fensterlistener auch bei vorhandenem Observer');
    for (const node of Object.values(nodes)) assert([...node.listeners.values()].every(handlers => !handlers.size), 'Dispose entfernt alle dokumentlokalen Listener');
}

const eventScenario = { label: 'Ereignisprobe', careEverActive: true, logDataRows: [
    { jahr: 1, Person1Alive: 1, Person2Alive: 1, CareP2_Active: 0 },
    { jahr: 2, Person1Alive: 1, Person2Alive: 1, CareP2_Active: 1, CareP2_Grade: 3 },
    { jahr: 3, Person1Alive: 0, Person2Alive: 1 },
    { jahr: 4, recordType: 'terminal_death', Person1Alive: 0, Person2Alive: 0 }
] };
const eventBefore = JSON.stringify(eventScenario);
const eventList = renderScenarioList([{ id: 'char_events', group: 'wealth', color: 'gray', scenario: eventScenario }], 'char_events', 'nominal', { startYear: 2039 });
for (const event of ['Person 2 Pflege 2040 · † 2042', 'Person 1 † 2041'])
    assert(eventList.includes(event), 'Szenarioliste erhält Lebensereignis: ' + event);
assertEqual(JSON.stringify(eventScenario), eventBefore, 'Lebensereignisse verändern keine Szenariozeile');

assert(!eventList.includes(' · Pflege ·') && !eventList.includes('>Pflege</small>'), 'Vermögensname enthält keinen redundanten Pflegezusatz');
assert(eventList.includes('class="scenario-details"') && eventList.includes('class="scenario-value"'), 'Detailzeile und rechtsbündiger Wert sind getrennt');
const careNames = renderScenarioList(buildScenarioEntries({ characteristic: [{ ...eventScenario, key: 'highestCareNeed', label: 'Höchster realer Pflege-Mehrbedarf' }] }), '', 'nominal');
assert(careNames.includes('data-scenario-group="care"') && careNames.includes('Höchster realer Pflege-Mehrbedarf'), 'Pflegegruppenkennung und Fachbezeichnung bleiben erhalten');

// Echte Binder-Ereignisse: Fokus getrennt von Auswahl, Scrollsichtbarkeit,
// Gruppenmerker, Leergruppe, Navigation und Replayöffnung.
{
    const b = bindScenarioLogView({ document: doc, logs, onSelect: (id, source) => selectionCalls.push({ id, source }), onMode() {}, chartOptions: { startYear: 2026 } });
    const option = id => hosts.scenarioList.children.find(e => e.getAttribute('data-scenario-id') === id);
    for (const [key, from, to] of [
        ['ArrowDown', 'char_worst', 'char_p50'], ['ArrowUp', 'char_p50', 'char_worst'],
        ['Home', 'char_p50', 'char_worst'], ['End', 'char_worst', 'char_p50']
    ]) for (const [edge, rect, expectedScroll] of [
        ['oberhalb', { top: -20, bottom: 30 }, 80],
        ['unterhalb', { top: 110, bottom: 160 }, 160]
    ]) {
        doc.activeElement = option(from);
        hosts.scenarioList.dispatch('focusin', option(from));
        for (const node of hosts.scenarioList.children) { node.focusCalls = []; node.scrollCalls = []; }
        hosts.scenarioList.scrollCalls = [];
        option(to).rect = rect;
        hosts.scenarioList.scrollTop = 100;
        const callsBefore = selectionCalls.length;
        assert(hosts.scenarioList.dispatch('keydown', option(from), key), `${key} ${edge}: Standardereignis unterdrückt`);
        assert(doc.activeElement === option(to) && b.focusedId === to, `${key} ${edge}: Zieloption erhält Fokus`);
        assertEqual(option(to).focusCalls.length, 1, `${key} ${edge}: genau ein Fokusaufruf`);
        assertEqual(JSON.stringify(option(to).focusCalls[0]), '{"preventScroll":true}', `${key} ${edge}: Fokus verhindert Seitenscrollen`);
        assert([hosts.scenarioList, ...hosts.scenarioList.children].every(node => node.scrollCalls.length === 0), `${key} ${edge}: kein scrollIntoView an Liste oder Option`);
        assertEqual(b.selectedId, 'char_worst', `${key} ${edge}: Auswahl unverändert`);
        assertEqual(selectionCalls.length, callsBefore, `${key} ${edge}: kein Auswahlcallback`);
        assertEqual(hosts.scenarioList.scrollTop, expectedScroll, `${key} ${edge}: ausschließlich innere Scrollkorrektur`);
    }
    option('char_worst').rect = { top: 0, bottom: 50 };
    hosts.scenarioList.dispatch('focusin', option('char_worst'));
    option('char_p50').rect = { top: 110, bottom: 160 };
    hosts.scenarioList.scrollTop = 0;
    option('char_worst').focus();
    assert(hosts.scenarioList.dispatch('keydown', option('char_worst'), 'ArrowDown'), 'Pfeil verhindert Seiten-Scroll');
    assertEqual(b.focusedId, 'char_p50', 'Pfeil bewegt Fokus');
    assertEqual(b.selectedId, 'char_worst', 'Pfeil verändert Auswahl nicht');
    assertEqual(hosts.scenarioList.scrollTop, 60, 'Fokus wird ausschließlich in innere Scrollfläche geholt');
    hosts.scenarioList.dispatch('keydown', option('char_p50'), 'Home');
    assertEqual(b.focusedId, 'char_worst', 'Home fokussiert Anfang');
    hosts.scenarioList.dispatch('keydown', option('char_worst'), 'End');
    hosts.scenarioList.dispatch('keydown', option('char_p50'), 'Enter');
    assertEqual(b.selectedId, 'char_p50', 'Enter wählt fokussierte Option');
    hosts.scenarioList.dispatch('keydown', option('char_p50'), 'ArrowUp');
    hosts.scenarioList.dispatch('keydown', option('char_worst'), ' ');
    assertEqual(b.selectedId, 'char_worst', 'Leertaste übernimmt Fokus');
    assert(hosts.scenarioPrevious.disabled && !hosts.scenarioNext.disabled, 'Navigation ist am Anfang begrenzt');
    hosts.scenarioNext.dispatch('click');
    assertEqual(b.selectedId, 'char_p50', 'Nächstes wählt innerhalb aktiver Gruppe');
    assert(hosts.scenarioNext.disabled, 'Navigation ist am Ende begrenzt');
    const group = name => { const e = new Element(name); e.setAttribute('data-scenario-group', name); hosts.scenarioGroups.dispatch('click', e); };
    group('sample'); assertEqual(b.selectedId, 'rand_random_0', 'Gruppenwechsel wählt ersten Eintrag');
    group('wealth'); assertEqual(b.selectedId, 'char_p50', 'Gruppenmerker stellt Auswahl wieder her');
    group('care'); assertEqual(selectionCalls.at(-1).source, null, 'Leergruppe gibt keine alte Quelle aus');
    assertEqual(hosts.scenarioList.getAttribute('tabindex'), '0', 'Leere Listbox hat einen Tab-Einstieg');
    assert(hosts.scenarioPrevious.disabled && hosts.scenarioNext.disabled, 'Leergruppe sperrt Navigation');
    hosts.scenarioWealthChart.dispatch('click', pick('char_p50'));
    assertEqual(b.activeGroup, 'wealth', 'Linienklick aktiviert passende Gruppe');
    hosts.scenarioSelectionDisclosure.open = false;
    const replayOption = option(b.selectedId), callsBeforeReplay = selectionCalls.length;
    replayOption.focusCalls = []; replayOption.scrollCalls = [];
    replayOption.onFocus = () => assert(hosts.scenarioSelectionDisclosure.open, 'Direkter Replay-Rückweg öffnet die Auswahl vor dem Fokus');
    assert(focusSelectedScenario(doc) && hosts.scenarioSelectionDisclosure.open, 'Replay öffnet dieselbe Auswahl');
    assertEqual(doc.activeElement.getAttribute('data-scenario-id'), b.selectedId, 'Replay fokussiert aktuelle Option');
    assertEqual(replayOption.focusCalls.length, 1, 'Direkter Replay-Rückweg fokussiert einmal');
    assert(replayOption.focusCalls[0]?.preventScroll !== true, 'Direkter Replay-Rückweg erlaubt Seitenscrollen zur aktuellen Option');
    assertEqual(selectionCalls.length, callsBeforeReplay, 'Replayfokus löst keine neue Auswahl aus');
    assert(hosts.scenarioSelectedHeading.innerHTML.includes('>Startjahr: 2026</span>') && hosts.scenarioSelectedHeading.innerHTML.includes('>1 Logzeilen</span>'), 'Kopf zeigt echtes Startjahr und Loganzahl');
    assert(hosts.scenarioSelectionSummary.textContent.includes('Median'), 'Schmale Zusammenfassung folgt Auswahl');
    disposeScenarioLogView(doc);
}
{
    const source = { absoluteRunIndex: 4 };
    const samples = [
        { ...worst, key: 'missing', endVermoegen: null },
        { ...worst, key: 'z', endVermoegen: 20, sourceIdentity: source },
        { ...worst, key: 'a', endVermoegen: 20, sourceIdentity: source },
        { ...worst, key: 'first', endVermoegen: 20, sourceIdentity: { absoluteRunIndex: 1 } },
        { ...worst, key: 'low', endVermoegen: -5 }
    ];
    const before = JSON.stringify(samples), e = buildScenarioEntries({ random: samples });
    assertEqual(scenarioGroupEntries(e, 'sample').map(x => x.id).join(','), 'rand_low,rand_first,rand_a,rand_z,rand_missing', 'Nominal aufsteigend, Quellindex und Kennung lösen Gleichstand, fehlende Werte zuletzt');
    assertEqual(JSON.stringify(samples), before, 'Sortierung verändert kein Quellarray');
    assert(scenarioGroupEntries(e, 'sample')[2].scenario.sourceIdentity === source, 'Mehrere Kennungen desselben Quelllaufs bleiben erhalten');
    const real = renderScenarioList(e, 'rand_low', 'real'), nominal = renderScenarioList(e, 'rand_low', 'nominal');
    assertEqual([...real.matchAll(/data-scenario-id="([^"]+)"/g)].map(x => x[1]).join(','), [...nominal.matchAll(/data-scenario-id="([^"]+)"/g)].map(x => x[1]).join(','), 'Moduswechsel erhält nominale Reihenfolge');
    assert(real.includes('Messung fehlt'), 'Fehlende Endwerte bleiben fehlend');
}

// Eine Personenprojektion für Liste und tatsächlichen Binderkopf.
{
    const eventRows = Array.from({ length: 15 }, (_, index) => ({ jahr: index + 1,
        Person1Alive: index < 14, Person2Alive: index < 2, CareP1_Active: index >= 9,
        portfolio_total_end: 100, inflation_factor_cum: 1, inflation: 0 }));
    const events = { ...worst, label: '<Ereignislauf>', logDataRows: eventRows };
    const render = (scenario, startYear) => renderScenarioList(buildScenarioEntries({ characteristic: [scenario] }), 'char_worst', 'nominal', { startYear });
    const calendar = render(events, 2026);
    for (const text of ['Person 1 Pflege 2035 · † 2040', 'Person 2 † 2028']) assert(calendar.includes(`class="scenario-person-mark">${text}</span>`), 'Personenmarke enthält beobachtete Kalenderereignisse: ' + text);
    for (const text of ['Person 1 Pflege Jahr 10 · † Jahr 15', 'Person 2 † Jahr 3']) assert(render(events).includes(text), 'Ohne Startjahr bleibt das relative Ereignisjahr erhalten');
    assert(!render(worst, 2026).includes('scenario-details') && !render(worst, 2026).includes('scenario-person-mark'), 'Ereignislose Liste erzeugt keinen leeren Personenbereich');
    assert(render({ ...worst, logDataRows: [{ jahr: 1, Person1Alive: false, CareP2_Active: true }] }, 2026).includes('Person 1 † 2026'), 'Ereignis im ersten Jahr ist beobachtet');
    assert(render({ ...worst, logDataRows: [{ jahr: 1, Person1Alive: false, CareP2_Active: true }] }).includes('Person 2 Pflege Jahr 1'), 'Erstes Pflegejahr ohne Kalenderbasis bleibt relativ');
    for (const logDataRows of [[{ jahr: 3, Person1Alive: 0, CareP2_Active: 1 }],
        [{ jahr: 1, Person1Alive: 1, CareP2_Active: 0 }, { jahr: 3, Person1Alive: 0, CareP2_Active: 1 }],
        [{ jahr: 1 }, { jahr: 2, Person1Alive: 0, CareP2_Active: 1 }]]) {
        const html = render({ ...worst, logDataRows }, 2026);
        assert(html.includes('Person 1 † Jahr unbekannt') && html.includes('Person 2 Pflege Jahr unbekannt'), 'Unbeobachteter Übergang behauptet kein Kalenderjahr');
    }
    assert(!render({ ...worst, logDataRows: [{ jahr: 1, Person1Alive: '0', CareP2_Active: '1' }] }).includes('scenario-person-mark'), 'Unbekannte Personenfelder erfinden kein Ereignis');
    assert(render({ ...worst, failed: false, endVermoegen: 0 }).includes('>0\u00a0€') && !render({ ...worst, failed: false, endVermoegen: 0 }).includes('is-ruin'), 'Nullvermögen ohne Ruin bleibt ein Betrag');
    assert(render({ ...worst, endVermoegen: null }).includes('>Messung fehlt</small>'), 'Fehlender Wert bleibt ausdrücklich fehlend');
    assert(render({ ...worst, failed: true, logDataRows: [{ jahr: 3, recordType: 'terminal_ruin' }] }).includes('scenario-value is-ruin">Ruin Jahr 3'), 'Ruin ohne Kalenderbasis ersetzt den Betrag');
    const middle = { ...median, key: 'p25', label: 'Zwischenlauf' };
    const eventLogs = { characteristic: [worst, middle, events.key === worst.key ? { ...events, key: 'p50' } : events], random: [{ ...worst, key: 'sample' }] };
    let callbacks = [];
    const b = bindScenarioLogView({ document: doc, logs: eventLogs, chartOptions: { startYear: 2026 }, onSelect: (id, source) => callbacks.push([id, source]), onMode() {} });
    const expectNavigation = (previous, next, previousAria, nextAria) => {
        assertEqual(hosts.scenarioPrevious.textContent, previous, 'Vorheriges nennt den tatsächlichen Nachbarn');
        assertEqual(hosts.scenarioNext.textContent, next, 'Nächstes nennt den tatsächlichen Nachbarn');
        assertEqual(hosts.scenarioPrevious.getAttribute('aria-label'), previousAria, 'Vorheriges hat ehrlichen zugänglichen Namen');
        assertEqual(hosts.scenarioNext.getAttribute('aria-label'), nextAria, 'Nächstes hat ehrlichen zugänglichen Namen');
    };
    expectNavigation('‹ Vorheriges', 'Zwischenlauf ›', 'Vorheriges', 'Nächstes: Zwischenlauf');
    hosts.scenarioNext.dispatch('click');
    expectNavigation('‹ Worst Case', '<Ereignislauf> ›', 'Vorheriges: Worst Case', 'Nächstes: <Ereignislauf>');
    const before = callbacks.length;
    hosts.scenarioNext.dispatch('click');
    assertEqual(callbacks.length - before, 1, 'Benannte Navigation wählt genau einen Nachbarlauf');
    assert(callbacks.at(-1)[1] === eventLogs.characteristic[2], 'Navigation erhält das Originalquellobjekt');
    expectNavigation('‹ Zwischenlauf', 'Nächstes ›', 'Vorheriges: Zwischenlauf', 'Nächstes');
    assert(hosts.scenarioNext.disabled && !hosts.scenarioPrevious.disabled, 'Ende sperrt nur die Randaktion');
    const heading = hosts.scenarioSelectedHeading.innerHTML;
    assert(heading.includes('Ausgewählt · Nach Endvermögen') && heading.includes('&lt;Ereignislauf&gt;'), 'Auswahlkopf enthält Gruppeneyebrow und sicheren Originalnamen');
    assert(heading.includes('Person 1 Pflege 2035 · † 2040') && heading.includes('Person 2 † 2028') && heading.includes('>15 Logzeilen</span>'), 'Auswahlkopf enthält dieselben Personenmarken und tatsächliche Rohzeilenanzahl');
    assert(!heading.includes('ds-note'), 'Auswahlkopf enthält kompakte Marken statt Notizkästen');
    assert(hosts.scenarioGroups.innerHTML.includes('class="scenario-group-count">3</span>') && hosts.scenarioGroups.innerHTML.includes('class="scenario-group-count">0</span>'), 'Gruppensegmente geben echte separate Anzahlen aus');
    for (const button of hosts.scenarioGroups.children) assertEqual(button.getAttribute('aria-pressed'), String(button.getAttribute('data-scenario-group') === 'wealth'), 'Vier Segmente besitzen den richtigen gedrückten Zustand');
    b.switchGroup('sample');
    expectNavigation('‹ Vorheriges', 'Nächstes ›', 'Vorheriges', 'Nächstes');
    assert(!hosts.scenarioSelectedHeading.innerHTML.includes('scenario-selected-events'), 'Ereignisloser Auswahlkopf enthält keinen leeren Ereignisbereich');
    b.switchGroup('wealth'); assertEqual(b.selectedId, 'char_p50', 'Gruppenmerker bleibt bei benannter Navigation erhalten');
    b.switchGroup('care');
    assert(!hosts.scenarioSelectedHeading.innerHTML.includes('Logzeilen') && !hosts.scenarioSelectedHeading.innerHTML.includes('Ereignislauf'), 'Leergruppe entfernt alte Namen, Werte und Metadaten');
    expectNavigation('‹ Vorheriges', 'Nächstes ›', 'Vorheriges', 'Nächstes');
    b.choose('char_worst');
    assert(hosts.scenarioSelectedHeading.innerHTML.includes('80,00') && hosts.scenarioSelectedHeading.innerHTML.includes('>heutige Euro</span>'), 'Auswahlkopf zeigt unveränderten Realwert und aktuellen Modus');
    const callbacksBeforeMode = callbacks.length;
    hosts.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
    assert(hosts.scenarioSelectedHeading.innerHTML.includes('100,00') && hosts.scenarioSelectedHeading.innerHTML.includes('>nominale Euro</span>'), 'Auswahlkopf wechselt zum unveränderten nominalen Originalwert');
    assertEqual(callbacks.length, callbacksBeforeMode, 'Kopfmodus löst keinen neuen Auswahlcallback aus');
    disposeScenarioLogView(doc);
    const ruined = { ...worst, failed: true, logDataRows: [row, { jahr: 3, recordType: 'terminal_ruin' }, { ...row, jahr: 4 }] };
    bindScenarioLogView({ document: doc, logs: { characteristic: [ruined] }, chartOptions: { startYear: 2026 }, onSelect() {}, onMode() {} });
    assert(hosts.scenarioSelectedHeading.innerHTML.includes('class="is-ruin">Ruin 2028') && hosts.scenarioSelectedHeading.innerHTML.includes('>3 Logzeilen</span>'), 'Ruinkopf behält Ruinjahr und zählt sämtliche Rohzeilen einschließlich Terminal-/Schattenzeilen');
    disposeScenarioLogView(doc);
}

// LA-4: Vergleichsauswahl, Liste, Randmarken und Protokoll teilen denselben Binder.
{
    const compareLogs = { characteristic: ['worst', 'p10', 'p50', 'p90', 'best', 'highestCareNeed', 'maxCut'].map((key, index) => ({
        ...worst, key, label: key, sourceIdentity: { absoluteRunIndex: index === 3 ? 1 : index }
    })) };
    const before = JSON.stringify(compareLogs);
    const callbacks = [];
    const bind = () => bindScenarioLogView({ document: doc, logs: compareLogs,
        onSelect: (id, scenario) => callbacks.push([id, scenario]), onMode() {} });
    let b = bind();
    assertEqual(b.comparisonSelection.join(), 'char_p10,char_p50,char_p90', 'Vergleich startet mit P10, Median und P90');
    assert(hosts.scenarioComparison.innerHTML.includes('Gleicher Quellpfad wie Spalte'), 'Doppelte Quellen sind auch im gebundenen Vergleich sichtbar');
    const select = new Element('scenarioCompare2'); select.setAttribute('data-comparison-column', '1'); select.value = 'char_highestCareNeed';
    hosts.scenarioComparison.dispatch('change', select);
    assertEqual(b.selectedId, 'char_highestCareNeed', 'Pflegeauswahl im Vergleich wählt denselben Pfad im Protokoll');
    assertEqual(b.activeGroup, 'care', 'Vergleich öffnet die passende Szenariogruppe');
    assertEqual(hosts.scenarioList.getAttribute('data-selected-id'), 'char_highestCareNeed', 'Liste folgt Vergleichsauswahl');
    assert(callbacks.at(-1)[1] === compareLogs.characteristic[5], 'Vergleich reicht das identische Quellobjekt weiter');
    const selected = b.comparisonSelection.join(), calls = callbacks.length;
    hosts.mcWealthMode.dispatch('click', hosts.mcWealthMode.children[1]);
    assertEqual(b.comparisonSelection.join(), selected, 'Euro-Wechsel erhält alle drei nominalen Rangwahlen');
    assertEqual(b.selectedId, 'char_highestCareNeed', 'Euro-Wechsel erhält die gewählte Quellidentität');
    assertEqual(callbacks.length, calls, 'Euro-Wechsel löst keine Pfadneuberechnung oder neue Protokollauswahl aus');
    assertEqual(hosts.scenarioComparisonChartBasis.textContent, 'Nominale Euro', 'Vergleichsgrafik nennt die gewählte Geldbasis');
    hosts.scenarioComparisonChart.dispatch('click', pick('char_p90'));
    assertEqual(b.selectedId, 'char_p90', 'Vergleichslinie/Legende wählt denselben Pfad');
    hosts.scenarioWealthChart.dispatch('click', pick('char_maxCut'));
    assertEqual(b.selectedId, 'char_maxCut', 'Bestehende Linie/Randmarke bleibt derselbe Auswahlweg');
    assertEqual(b.comparisonSelection.join(), selected, 'Randmarke überschreibt keine der drei Vergleichsspalten');
    const inspect = new Element('link'); inspect.setAttribute('data-comparison-inspect', 'char_p10');
    const beforeInspect = callbacks.length;
    assert(hosts.scenarioComparison.dispatch('click', inspect), 'Vergleichslink verhindert unabhängigen Ankersprung');
    assertEqual(callbacks.length - beforeInspect, 1, 'Was hier auffällt wählt genau einmal');
    assertEqual(b.selectedId, 'char_p10', 'Vergleichslink wählt seinen Quellpfad');
    assert(hosts.scenarioLogAnalysis.scrollCalls.length > 0, 'Link führt zu den Auffälligkeiten des gewählten Pfads');
    b = bind();
    assertEqual(b.comparisonSelection.join(), selected, 'Sitzung behält eigene Spaltenwahl auch bei erneuter Ergebnisveröffentlichung');
    for (const [id, event] of [['scenarioComparison', 'change'], ['scenarioComparison', 'click'], ['scenarioComparisonChart', 'click']])
        assertEqual(hosts[id].listeners.get(event).size, 1, 'Rebind hält genau einen Vergleichslistener: ' + id + ' ' + event);
    const preset = new Element('button'); preset.setAttribute('data-comparison-preset', 'extremes');
    hosts.scenarioComparison.dispatch('click', preset);
    assertEqual(b.comparisonSelection.join(), 'char_worst,char_p50,char_best', 'Schnellwahl setzt Schwächster, Median, Stärkster');
    assertEqual(b.selectedId, 'char_worst', 'Schnellwahl wählt den ersten Vergleichspfad im gemeinsamen Binder');
    preset.setAttribute('data-comparison-preset', 'default'); hosts.scenarioComparison.dispatch('click', preset);
    assertEqual(b.comparisonSelection.join(), 'char_p10,char_p50,char_p90', 'Standard-Schnellwahl stellt P10, Median, P90 wieder her');
    assertEqual(JSON.stringify(compareLogs), before, 'Sämtliche Vergleichsaktionen lassen Rohlogs unverändert');
    disposeScenarioLogView(doc);
    for (const id of ['scenarioComparison', 'scenarioComparisonChart'])
        assert([...hosts[id].listeners.values()].every(handlers => !handlers.size), 'Dispose entfernt Vergleichslistener: ' + id);
}
