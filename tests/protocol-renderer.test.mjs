import fs from 'node:fs';
import { renderProtocolTable, renderProtocolSummary, protocolYearPresentation } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { renderWorstRunLog, displayMonteCarloResults, persistDetailLevel, WORST_LOG_DETAIL_KEY, BACKTEST_LOG_DETAIL_KEY, loadDetailLevel } from '../app/simulator/simulator-results.js';
import { persistenceStorage } from '../app/shared/persistence-facade.js';
import { initStressReplayUI, publishStressReplayMonteCarloContext, selectStressReplayScenario } from '../app/simulator/stress-replay-ui.js';

const danger = `<img src=x onerror="alert(1)"> & ' <CaR!`;
const rows = [{ jahr: 2, histJahr: danger, Regime: danger, aktionUndGrund: danger,
    Person1Alive: 0, Person2Alive: 1, CareP1_Active: 1, CareP1_Grade: 2,
    flex_haushalt_kuerzung_pct: 20, jahresentnahme_real: 0, portfolio_total_end: 0 }];
const before = JSON.stringify(rows);
const options = { source: 'mc', startYear: 2026, inputs: { startAlter: 62, partner: { aktiv: true, startAlter: 57 } } };
const html = renderProtocolTable(rows, { ...options, caption: danger, caRThreshold: 100 });
for (const forbidden of ['<img', '<CaR!', 'title="<', 'aria-label="<']) assert(!html.includes(forbidden), `Gefährlicher Datentext erzeugt kein Markup: ${forbidden}`);
for (const text of ['&lt;img', '&amp;', '&quot;', '&#39;', '&lt;CaR!', '2027', 'Simulationsjahr 2', 'Alter 63 † / 58', 'Gezogenes Jahr', 'Niedrige Entnahme', 'protocol-row-cut protocol-row-care'])
    assert(html.includes(text), `Sicheres Protokoll zeigt ${text}`);
assertEqual(JSON.stringify(rows), before, 'Escaping und Jahrprojektion verändern keine Rohzeile');
const columns = getProtocolColumns(options);
const hostileColumns = columns.map(column => ({ ...column, header: danger, title: danger, id: danger }));
const attributes = renderProtocolTable(rows, { ...options, columns: hostileColumns });
assert(!attributes.includes('<img') && attributes.includes('data-protocol-column="&lt;img'), 'Auch Titel und Attributkennungen werden escaped');
assertEqual((html.match(/scope="col"/g) || []).length, columns.length, 'Jede Einzelspalte hat scope=col');
assert(html.includes('scope="colgroup"') && html.includes('protocol-explain') && html.includes('protocol-legend'), 'Gemeinsamer Baustein hat Gruppenkopf, Erklärkopf und Legende');
assert(renderProtocolTable([{ jahr: 4, recordType: 'terminal_ruin' }], options).includes('protocol-row-ruin'), 'Terminalruin ist ein eigener Zeilenzustand');
assert(!renderProtocolTable([{ jahr: 4, recordType: 'terminal_death', wertAktien: 0 }], options).includes('protocol-row-ruin'), 'Tod und Nullbestand erzeugen keinen erfundenen Ruin');
assert(renderProtocolTable([{ jahr: 1, Regime: 'accumulation' }], options).includes('Ansparphase'), 'Ansparrecord bleibt lesbar');
for (const [entry, index, context, expected] of [
    [{ jahr: 3 }, 0, { source: 'mc', startYear: 2030, inputs: { startAlter: 70, partner: { aktiv: false, startAlter: 40 } } }, { calendarYear: 2032, simulationYear: 3, ages: '72' }],
    [{ jahr: 1, Person1Alive: 1, Person2Alive: 0 }, 0, { ...options, inputs: { startAlter: 50, partner: { aktiv: true, startAlter: 44 } } }, { calendarYear: 2026, simulationYear: 1, ages: '50 / 44 †' }],
    [{ jahr: 2003, row: { Person1Alive: 0, Person2Alive: 1 } }, 0, { source: 'backtest', startYear: 2000, inputs: { startAlter: 60, partner: { aktiv: true, startAlter: 55 } } }, { calendarYear: 2003, simulationYear: 4, ages: '63 † / 58' }],
    [{ jahr: 2, Regime: 'accumulation', histJahr: 1980 }, 0, { source: 'mc', startYear: 2035, inputs: { startAlter: 30 } }, { calendarYear: 2036, simulationYear: 2, ages: '31' }],
    [{ jahr: 7, recordType: 'terminal_ruin', Person1Alive: 1, Person2Alive: 0 }, 1, options, { calendarYear: 2032, simulationYear: 7, ages: '68 / 63 †' }],
    [{ jahr: 1995, row: { recordType: 'terminal_ruin', Person1Alive: 1 } }, 2, { source: 'backtest', startYear: 1990, inputs: { startAlter: 42 } }, { calendarYear: 1995, simulationYear: 6, ages: '47' }],
    [{ jahr: 4, histJahr: 1973 }, 0, { source: 'mc' }, { calendarYear: null, simulationYear: 4, ages: '' }]
]) assertEqual(JSON.stringify(protocolYearPresentation(entry, index, context)), JSON.stringify(expected), 'Kalender, Simulationsjahr, zwei Startalter und Tod folgen dem Laufkontext');
assert(renderProtocolSummary(rows, { outcome: 'completed', endWealth: 0, subtitle: danger }).includes('Endvermögen 0\u00a0€'), 'Beobachtetes Nullendvermögen bleibt Null');
assert(!renderProtocolSummary([], {}).includes('Vollständig'), 'Fehlender Outcome erzeugt keinen Erfolgsstatus');
assert(!renderProtocolSummary(rows, { subtitle: danger }).includes('<img'), 'Auch Kopfunterzeilen behandeln Daten als Text');
for (const [outcome, label] of [['ruin', 'Ruin'], ['all_dead', 'Haushalt verstorben'], ['horizon_exhausted', 'Horizont erreicht'], ['technical_error', 'Technischer Fehler']]) {
    const summary = renderProtocolSummary([], { outcome: { kind: outcome } });
    assert(summary.includes(label), 'Statuschip übernimmt den gerechneten Outcome');
    assert(!summary.includes('Endvermögen'), 'Ohne vorhandenen Vermögenswert kein erfundener Vermögenschip');
}
const boundaryCount = columns.slice(1).filter((column, index) => column.group !== columns[index].group).length;
assertEqual((html.match(/protocol-group-start/g) || []).length, boundaryCount * 2, 'Einzelköpfe und Zellen markieren jede fachliche Gruppengrenze');

// CaR gehört zur Entnahmeidentität, auch bei verschachtelten und alten Spalten.
const lowWithdrawalHint = 'Reale Entnahme unter dem 10-%-Wert aller simulierten Jahre (CaR)';
for (const source of ['mc', 'backtest']) for (const logDetailLevel of ['normal', 'detailed']) {
    const context = { source, logDetailLevel, caRThreshold: 100 };
    const catalogColumns = getProtocolColumns(context);
    const frozenRaw = Object.freeze({ jahresentnahme_real: 99, portfolio_total_end: 1000000 });
    const entry = Object.freeze({ jahr: 2026, entscheidung: Object.freeze({ jahresEntnahme: 900 }),
        ...(source === 'backtest' ? { row: frozenRaw } : frozenRaw) });
    for (const displayed of [catalogColumns, [...catalogColumns].reverse(),
        catalogColumns.filter(column => column.id !== 'withdrawal'),
        [{ header: 'Vermögen', key: 'portfolio_total_end' }, { header: 'Entn.', key: 'entscheidung.jahresEntnahme' },
            { header: 'Floor', key: 'floor_brutto' }]]) {
        const output = renderProtocolTable(Object.freeze([entry]), { ...context, columns: displayed });
        const cells = [...output.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
        const expectedIndex = displayed.findIndex(column => column.id === 'withdrawal' || column.header === 'Entn.');
        assertEqual(cells.filter(cell => cell.includes('Niedrige Entnahme')).length, expectedIndex < 0 ? 0 : 1,
            'Niedrige Entnahme erscheint genau einmal oder bei ausgeblendeter Entnahme gar nicht');
        assertEqual(cells.findIndex(cell => cell.includes('Niedrige Entnahme')), expectedIndex,
            'CaR-Kennzeichen folgt ausschließlich der Entnahme, nie Vermögen oder Floor');
        if (expectedIndex >= 0) for (const attribute of ['title', 'aria-label'])
            assert(cells[expectedIndex].includes(`${attribute}="${lowWithdrawalHint}"`), 'CaR-Hinweistext ist exakt');
    }
    for (const [real, threshold, nominal, wealth, marked] of [
        [99, 100, 900, 1000000, true], [0, 100, 900, 1000000, true],
        [100, 100, 1, 0, false], [101, 100, 1, 0, false],
        ...[undefined, null, NaN, Infinity, -Infinity, '99'].map(real => [real, 100, 1, 0, false]),
        ...[undefined, null, NaN, Infinity, -Infinity, '100'].map(threshold => [99, threshold, 1, 0, false])
    ]) {
        const raw = { jahresentnahme_real: real, portfolio_total_end: wealth };
        const probe = { jahr: 2026, entscheidung: { jahresEntnahme: nominal }, ...(source === 'backtest' ? { row: raw } : raw) };
        const rendered = renderProtocolTable([probe], { ...context, caRThreshold: threshold });
        assertEqual(rendered.includes('Niedrige Entnahme'), marked, 'Nur endliche reale Entnahme strikt unter endlicher Schwelle wird markiert');
        assertEqual(rendered.includes(' below-car'), marked, 'Zeilenkennzeichnung verwendet denselben strikten Realvergleich');
    }
}

// Echter Binder mit zählendem DOM-Doppel: anders als eine Map erlaubt dieses mehrere Listener.
const saved = { localStorage: globalThis.localStorage, window: globalThis.window, document: globalThis.document, console: globalThis.console, requestAnimationFrame: globalThis.requestAnimationFrame, setTimeout: globalThis.setTimeout };
const oldPreferences = [WORST_LOG_DETAIL_KEY, BACKTEST_LOG_DETAIL_KEY, 'showCareDetails', 'logDetailLevel'].map(key => [key, persistenceStorage.getItem(key)]);
let downloads = 0, blobs = [], writes = 0;
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
class NodeDouble {
    constructor() { this.style = {}; this.listeners = new Set(); this.clickListeners = new Set(); this.attributes = {}; this.value = ''; this.checked = false; this.dataset = {}; this.children = []; this.classList = { add() {}, remove() {} }; }
    addEventListener(event, handler) { if (event === 'change') this.listeners.add(handler); if (event === 'click') this.clickListeners.add(handler); }
    removeEventListener(event, handler) { if (event === 'change') this.listeners.delete(handler); if (event === 'click') this.clickListeners.delete(handler); }
    dispatch() { for (const handler of [...this.listeners]) handler({ currentTarget: this }); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    choose(id) { for (const handler of this.clickListeners) handler({ target: { closest: () => ({ getAttribute: () => id }) } }); }
    appendChild(node) { this.children.push(node); node.parentNode = this; }
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); }
    click() { downloads++; }
    set innerHTML(value) { this.markup = value; writes++; }
    get innerHTML() { return this.markup || ''; }
}
const hosts = Object.fromEntries(['scenarioLogContainer', 'scenarioSelector', 'scenarioList', 'scenarioGroups', 'scenarioLogOutput', 'scenarioExportButtons', 'scenarioProtocolSummary', 'toggle-care-details', 'toggle-log-detail', 'exportScenarioLogJson', 'exportScenarioLogCsv', 'monteCarloResults', 'toastContainer', 'stressReplayFixButton', 'stressReplayStatus', 'stressReplaySelectedScenarioEmpty', 'stressReplaySelectedScenarioDetails', 'stressReplaySelectedScenarioLabel', 'stressReplaySelectedScenarioWealth', 'stressReplaySelectedScenarioCare'].map(id => [id, new NodeDouble()]));
const scenario = { key: 'worst', label: danger, sourceIdentity: { runIndex: 0 }, endVermoegen: 12345, failed: false, logDataRows: [{ recordType: 'financial_year', financiallyEvaluable: true, jahr: 1, histJahr: 1974, Regime: 'normal', aktionUndGrund: 'Halten', entscheidung: { jahresEntnahme: 1000 } }] };
const batch = { characteristic: [scenario], random: [{ ...scenario, key: danger }] };
const run = (logs, inputs = { startAlter: 62 }, displayContext = { startYear: 2026 }) => displayMonteCarloResults({}, 1, 0, null, {}, {}, 0, inputs, null, logs, displayContext);
try {
    globalThis.window = {};
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
    globalThis.document = { getElementById: id => hosts[id] || null, createElement: () => new NodeDouble(), body: new NodeDouble() };
    globalThis.requestAnimationFrame = () => {};
    globalThis.setTimeout = () => 0;
    URL.createObjectURL = blob => { blobs.push(blob); return 'blob:synthetic'; };
    URL.revokeObjectURL = () => {};
    initStressReplayUI({
        documentRef: globalThis.document, windowRef: globalThis.window,
        readParameters: () => ({ rngMode: 'per-run-seed' }), resolveCompatibility: () => ({}),
        loadWorkspace: () => ({ status: 'empty', workspace: null }), renderViews() {}
    });
    persistenceStorage.setItem('logDetailLevel', 'detailed');
    persistenceStorage.removeItem(WORST_LOG_DETAIL_KEY); persistenceStorage.removeItem(BACKTEST_LOG_DETAIL_KEY);
    assertEqual(loadDetailLevel(WORST_LOG_DETAIL_KEY), 'detailed', 'Legacypräferenz bleibt lesbarer Fallback');
    persistDetailLevel(WORST_LOG_DETAIL_KEY, 'normal');
    persistDetailLevel(BACKTEST_LOG_DETAIL_KEY, 'detailed');
    run(batch); run(batch); run(batch);
    assert(hosts.scenarioProtocolSummary.innerHTML.includes('Kein Ruin') && !hosts.scenarioProtocolSummary.innerHTML.includes('Vollständig'), 'MC: failed=false belegt keinen Ruin, aber keinen unzensierten Lebensabschluss');
    assertEqual(hosts.stressReplayFixButton.disabled, false, 'Aktiver Replaycontroller erhält den neuen MC-Kontext und die Worst-Auswahl');
    assertEqual(hosts['toggle-log-detail'].listeners.size, 1, 'Wiederholtes Rendern hinterlässt genau einen Detaillistener');
    assertEqual(hosts['toggle-care-details'].listeners.size, 1, 'Wiederholtes Rendern hinterlässt genau einen Pflegelistener');
    assertEqual(hosts.scenarioList.clickListeners.size, 1, 'Auch bei identischem Listendoppel genau ein Auswahlweg');
    assert(!hosts.scenarioList.innerHTML.includes('<img') && hosts.scenarioList.innerHTML.includes('&lt;img'), 'Optionsbezeichnungen und Optionswerte sind sicher escaped');
    assert(hosts.scenarioLogOutput.innerHTML.includes('2026') && hosts.scenarioLogOutput.innerHTML.includes('Alter 62'), 'Binder verwendet den übergebenen Laufstart');
    const beforeWrites = writes;
    hosts['toggle-log-detail'].checked = true; hosts['toggle-log-detail'].dispatch();
    assertEqual(writes - beforeWrites, 4, 'Eine Detailaktion führt genau einen Renderweg aus');
    assertEqual(loadDetailLevel(BACKTEST_LOG_DETAIL_KEY), 'detailed', 'MC-Details verändern keine Backtestpräferenz');
    hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
    assertEqual(downloads, 2, 'Jeder echte Downloadknopf löst genau einen Download aus');
    const jsonBefore = await blobs[0].text(), csvBefore = await blobs[1].text();
    for (const detailed of [false, true]) for (const care of [false, true]) {
        hosts['toggle-log-detail'].checked = detailed; hosts['toggle-log-detail'].dispatch();
        hosts['toggle-care-details'].checked = care; hosts['toggle-care-details'].dispatch();
        const downloadStart = blobs.length;
        hosts.exportScenarioLogJson.onclick(); hosts.exportScenarioLogCsv.onclick();
        assertEqual(await blobs[downloadStart].text(), jsonBefore, 'Echter MC-JSON-Download bleibt bei Detail-/Pflegeschaltern bytegleich');
        assertEqual(await blobs[downloadStart + 1].text(), csvBefore, 'Echter MC-CSV-Download bleibt bei Detail-/Pflegeschaltern bytegleich');
    }
    const mutableInputs = { startAlter: 62, partner: { aktiv: true, startAlter: 60 }, pflegefallLogikAktivieren: true };
    const mutableDisplay = { startYear: 2026, personDisplayContext: { persons: [{ name: 'Gebundene Person' }, { name: 'Gebundener Partner' }] } };
    run(batch, mutableInputs, mutableDisplay);
    mutableInputs.partner.aktiv = false; mutableInputs.pflegefallLogikAktivieren = false;
    mutableDisplay.personDisplayContext.persons[0].name = 'Neues Profil'; mutableDisplay.startYear = 2099;
    hosts['toggle-log-detail'].checked = false; hosts['toggle-log-detail'].dispatch();
    assert(hosts.scenarioLogOutput.innerHTML.includes('Gebundene Person') && hosts.scenarioLogOutput.innerHTML.includes('Gebundener Partner')
        && hosts.scenarioLogOutput.innerHTML.includes('2026') && !hosts.scenarioLogOutput.innerHTML.includes('Neues Profil'), 'Schalter nach Profilwechsel beschriften den gebundenen Lauf nicht um');
    assert(!JSON.stringify(window.globalCurrentScenarioData).includes('Gebundene Person'), 'Anzeigenamen erweitern keinen Personen-Exportbeleg');
    const downloadsBeforeEmpty = downloads;
    hosts.scenarioGroups.choose('care');
    assertEqual(window.globalCurrentScenarioData, null, 'Leerauswahl invalidiert Exportgrundlage');
    hosts.exportScenarioLogJson.onclick(); assertEqual(downloads, downloadsBeforeEmpty, 'Leerauswahl lässt keinen Download des alten Pfads zu');
    hosts.scenarioList.choose('char_worst');
    assertEqual(hosts.stressReplaySelectedScenarioLabel.textContent, danger, 'Replayauswahl folgt dem aktuellen Szenario als Text');
    const invalid = { characteristic: [{ ...scenario, logDataRows: [{ ...scenario.logDataRows[0], get aktionUndGrund() { throw new Error('synthetischer Renderfehler'); } }] }], random: [] };
    globalThis.console = { ...saved.console, error() {} }; run(invalid);
    assertEqual(window.globalCurrentScenarioData, null, 'Renderfehler hinterlässt keinen exportierbaren Altpfad');
    assertEqual(hosts.scenarioExportButtons.style.display, 'none', 'Renderfehler verbirgt Downloads');
    assertEqual(hosts.stressReplaySelectedScenarioDetails.hidden, true, 'Renderfehler entfernt den Replayaltpfad');
    run(batch); run(null);
    assertEqual(window.globalCurrentScenarioData, null, 'Neuer Batch ohne Logs invalidiert alte Auswahl');
    assertEqual(hosts.exportScenarioLogJson.onclick, null, 'Batch ohne Logs entfernt alte Downloadcallback');
    assertEqual(hosts['toggle-log-detail'].listeners.size, 0, 'Batch ohne Logs entfernt alte Schalterclosure');
    assertEqual(hosts.scenarioList.clickListeners.size, 1, 'Batch ohne Logs belässt nur den aktuellen leeren Binder');
    assertEqual(window.globalScenarioLogs, null, 'Batch ohne Logs entfernt im eigenen Protokollhost die alte Loggrundlage');
    assertEqual(window.globalScenarioCarThreshold, null, 'Batch ohne Logs entfernt im eigenen Protokollhost die alte CaR-Grenze');
    assertEqual(hosts.stressReplayFixButton.disabled, true, 'Batch ohne Logs sperrt die alte Replayauswahl');
    assert(hosts.stressReplayStatus.textContent.includes('Ursprungslauf ist nicht mehr verfügbar'), 'Aktiver Replaycontroller invalidiert den alten Kontext ohne null-Destrukturierungsfehler');

    // Aufrufer ohne Protokollhost können Logs und Replaykontext selbst setzen.
    const lookup = globalThis.document.getElementById;
    globalThis.document.getElementById = id => id === 'scenarioLogContainer' ? null : lookup(id);
    window.globalScenarioLogs = batch;
    window.globalScenarioCarThreshold = 765;
    window.globalCurrentScenarioData = scenario;
    publishStressReplayMonteCarloContext({ inputs: { startAlter: 62 }, scenarioLogs: batch });
    selectStressReplayScenario(scenario);
    for (const suppliedLogs of [batch, null]) {
        run(suppliedLogs);
        assert(window.globalScenarioLogs === batch, 'Renderer ohne Protokollhost erhält die vom Aufrufer gesetzten Logs');
        assertEqual(window.globalScenarioCarThreshold, 765, 'Renderer ohne Protokollhost erhält die vom Aufrufer gesetzte CaR-Grenze');
        assert(window.globalCurrentScenarioData === scenario, 'Renderer ohne Protokollhost erhält die Auswahl des Aufrufers');
        selectStressReplayScenario(scenario);
        assertEqual(hosts.stressReplayFixButton.disabled, false, 'Renderer ohne Protokollhost erhält die Replayauswahl');
        assert(!hosts.stressReplayStatus.textContent.includes('Ursprungslauf ist nicht mehr verfügbar'), 'Renderer ohne Protokollhost erhält den veröffentlichten Replaykontext');
    }
    globalThis.document.getElementById = lookup;
} finally {
    Object.assign(globalThis, saved); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    for (const [key, value] of oldPreferences) value === null ? persistenceStorage.removeItem(key) : persistenceStorage.setItem(key, value);
}

const markup = fs.readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
for (const id of ['exportScenarioLogJson', 'exportScenarioLogCsv', 'exportBacktestJson', 'exportBacktestCsv'])
    assertEqual((markup.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id}: Export-ID bleibt eindeutig`);

// Personenstatus: Darstellung aus dem eingefrorenen Lauf, unabhängig von Detailpräferenzen.
const { createProtocolPersonContext, PROTOCOL_COLUMNS } = await import('../app/simulator/protocol-columns.js');
const { protocolPersonPresentation } = await import('../app/simulator/protocol-renderer.js');
const lifeInputs = { startAlter: 70, partner: { aktiv: true, startAlter: 68 }, pflegefallLogikAktivieren: true };
const names = [{ name: 'Synthetische Person' }, { name: 'Partner <Probe>' }];
const lifeContext = createProtocolPersonContext(lifeInputs, names);
const lifeRows = [
    { jahr: 1, histJahr: 1970, Person1Alive: 1, Person2Alive: 1 },
    { jahr: 2, histJahr: 1971, Person1Alive: 1, Person2Alive: 1, CareP1_Active: 1, CareP1_Grade: 3 },
    { jahr: 3, histJahr: 1972, Person1Alive: 0, Person2Alive: 1, CareP1_Active: 1, CareP1_Grade: 3 },
    { jahr: 4, histJahr: 1973, Person1Alive: 0, Person2Alive: null }
];
const lifeOptions = { source: 'mc', inputs: lifeInputs, startYear: 2039, personDisplayContext: lifeContext };
const person1 = getProtocolColumns(lifeOptions).find(c => c.id === 'person1-status');
assertEqual(person1.header, 'Synthetische Person', 'Personenkopf verwendet den berechneten Namen');
assertEqual(person1.label, 'Synthetische Person', 'Langkopf bewahrt vollständigen Namen');
assert(Object.isFrozen(lifeContext) && Object.isFrozen(lifeContext.persons[0]), 'Separater Anzeigekontext ist tief eingefroren');
names[0].name = 'Umbenannt';
assertEqual(lifeContext.persons[0].name, 'Synthetische Person', 'Spätere Namensänderung beschriftet keinen alten Lauf um');
for (const [index, text, title, tone] of [
    [0, '✓', 'Synthetische Person: lebt', 'alive'],
    [1, 'PG 3', 'Synthetische Person: Pflegegrad 3', 'care'],
    [2, '†', 'Synthetische Person: verstorben 2041', 'dead'],
    [3, '†', 'Synthetische Person: verstorben 2041', 'dead following']
]) {
    const state = protocolPersonPresentation(lifeRows, index, person1, lifeOptions);
    assertEqual(JSON.stringify(state), JSON.stringify({ text, tone, title }), 'Lebt, Pflege ersetzt Lebt, Todesjahr und gedämpfte Folgejahre');
}
for (const logDetailLevel of ['normal', 'detailed']) for (const showCareDetails of [false, true]) {
    const table = renderProtocolTable(lifeRows, { ...lifeOptions, logDetailLevel, showCareDetails });
    assertEqual((table.match(/data-protocol-column="person[12]-status"/g) || []).length, 2, 'Gebundener Partner sichtbar unabhängig von beiden Schaltern');
    assert(table.includes('title="Synthetische Person: Pflegegrad 3" aria-label="Synthetische Person: Pflegegrad 3"'), 'Status ist visuell, per Titel und ARIA verständlich');
    assert(!table.includes('>Historisches Jahr ') && table.includes('>Gezogenes Jahr<'), 'Gezogenes Jahr besitzt genau eine eigene Spalte');
    for (const c of PROTOCOL_COLUMNS.filter(c => c.visibility === 'export'))
        assert(!table.includes(`data-protocol-column="${c.id}"`), `${c.id} nie als sichtbare Spalte`);
}
const noCare = renderProtocolTable(lifeRows, { ...lifeOptions, personDisplayContext: createProtocolPersonContext({ ...lifeInputs, pflegefallLogikAktivieren: false }, names) });
assert(!noCare.includes('PG ') && noCare.includes('Umbenannt: lebt'), 'Pflege aus zeigt nur Lebensstatus, ohne Pflegekürzel');
const unknownColumn = getProtocolColumns({ source: 'mc' }).find(c => c.id === 'person1-status');
assertEqual(unknownColumn.header, 'Person 1', 'Nur bei fehlendem Namen steht eine Personennummer');
assertEqual(protocolPersonPresentation([{}], 0, unknownColumn).title, 'Person 1: Lebensstatus unbekannt', 'Fehlende Lebensdaten erfinden kein Lebt');
assertEqual(protocolPersonPresentation([{ Person1Alive: 0 }], 0, unknownColumn, { startYear: 2039 }).title, 'Person 1: verstorben · Todesjahr unbekannt', 'Fehlende Jahresdaten erfinden kein Todesjahr');
assertEqual(getProtocolColumns({ source: 'mc', inputs: { partner: { aktiv: false } } }).filter(c => c.group === 'persons').length, 1, 'Einzelperson besitzt genau eine Statusspalte');
// Ein historischer Kompatibilitätsaufrufer kann keine verborgenen Katalogspalten einschleusen.
const { buildAccessibleBacktestTableHtml } = await import('../app/simulator/historical-backtest-ui.js');
const compatibilityTable = buildAccessibleBacktestTableHtml([{ jahr: 2000, row: {} }],
    PROTOCOL_COLUMNS.map(c => ({ header: c.legacyHeader, key: c.backtestPath })), () => 'synthetisch');
for (const c of PROTOCOL_COLUMNS.filter(c => c.visibility === 'export' || c.group === 'care'))
    assert(!compatibilityTable.includes(`data-protocol-column="${c.id}"`), `Backtest-Kompatibilität verbirgt ${c.id}`);
assertEqual(protocolPersonPresentation([{ jahr: 7, Person1Alive: 0 }], 0, unknownColumn, { startYear: 2039 }).title,
    'Person 1: verstorben · Todesjahr unbekannt', 'Bereits verstorbene Person ohne vorangehenden Status erhält kein erfundenes Todesjahr');
assertEqual(protocolPersonPresentation([{ jahr: 1, Person1Alive: 1 }, { jahr: 4, Person1Alive: 0 }], 1, unknownColumn, { startYear: 2039 }).title,
    'Person 1: verstorben · Todesjahr unbekannt', 'Lücke zwischen Lebensstatuszeilen erfindet kein genaues Todesjahr');

// Befund 8: Kurzköpfe und assistive Namen aus dem gerechneten Kontext.
{
    const { createProtocolPersonContext } = await import('../app/simulator/protocol-columns.js');
    for (const [names, expected] of [
        [['Muster A', 'Muster B mit besonders langem Profilnamen'], ['MA', 'MB']],
        [['Muster A', 'Muster Anton'], ['P1', 'P2']],
        [['Änne Örtel', '𐐀name Beta'], ['ÄÖ', '𐐀B']],
        [['', ''], ['P1', 'P2']],
        [['Muster <B & \"Zitat\"', 'Andere Person'], ['M<', 'AP']]
    ]) {
        const people = names.map(name => ({ name }));
        const context = createProtocolPersonContext({ partner: { aktiv: true } }, people);
        people[0].name = 'Nachträglich geändert';
        const opts = { source: 'mc', personDisplayContext: context };
        const cols = getProtocolColumns(opts).filter(c => c.group === 'persons');
        assertEqual(cols.map(c => c.header).join('/'), names.map((name, i) => name || `Person ${i + 1}`).join('/'), 'Personenköpfe verwenden vollständige eingefrorene Namen');
        assert(cols.every(c => !c.header.includes('Nachträglich geändert')), 'Spätere Namensänderung verändert den Laufbeleg nicht');
        const markup = renderProtocolTable([{ jahr: 1, Person1Alive: 1, Person2Alive: 1 }], opts);
        for (const col of cols) {
            const safe = col.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
            assert(markup.includes(`title="${safe}"`) && markup.includes(`aria-label="${safe}"`), 'Vollständiger gerechneter Name escaped im echten Renderer');
        }
        assert(!markup.includes('Nachträglich geändert'), 'Laufkontext unabhängig von späteren Namensänderungen');
    }
}
