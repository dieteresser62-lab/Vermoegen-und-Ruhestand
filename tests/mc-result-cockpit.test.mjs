import { bindScenarioLogView, disposeScenarioLogView } from '../app/simulator/scenario-log-view.js';
import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import {
    activateMonteCarloResultView,
    activateStressReplayComparisonView,
    completeMonteCarloCockpitRun,
    initMonteCarloResultCockpit,
    syncMonteCarloCockpitStartState,
    updateMonteCarloReplayVariantBadge,
    updateMonteCarloSetupSummary
} from '../app/simulator/mc-result-cockpit.js';

class FakeElement {
    constructor(id, properties = {}) {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.open = false;
        this.hidden = false;
        this.focusCount = 0;
        this.focusCalls = [];
        this.scrollCalls = [];
        this.containedElements = new Set();
        this.classList = { toggle: (name, active) => { this[name] = active; }, contains: name => this[name] === true };
        this.querySelector = () => null;
        this.listeners = new Map();
        this.attributes = new Map();
        this.clickCount = 0;
        Object.assign(this, properties);
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(h => h !== handler)); }
    dispatch(type, event = {}) {
        for (const handler of this.listeners.get(type) || []) handler({ preventDefault() {}, ...event });
    }

    click() {
        this.clickCount += 1;
        this.dispatch('click');
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(element) { return this.containedElements.has(element); }
    focus(options) { this.focusCount += 1; this.focusCalls.push(options); this.onFocus?.(); }
    scrollIntoView(options) { this.scrollCalls.push(options); }
    querySelectorAll(selector) {
        if (this.queryResults?.has(selector)) return this.queryResults.get(selector);
        return selector === 'li[data-variant-id]' ? Array.from({ length: this.variantItems || 0 }, () => ({})) : [];
    }
}

function createDocument() {
    const elements = new Map();
    const register = (id, properties) => {
        const element = new FakeElement(id, properties);
        elements.set(id, element);
        return element;
    };
    const methodOptions = [
        { value: 'regime_markov', textContent: 'Regime-Sampling (Markov-Chain)' },
        { value: 'stationary', textContent: 'Stationary Bootstrap' }
    ];
    register('mcSetupDisclosure', { open: true });
    register('mcSettingsToggle');
    register('mcButton');
    register('mcAdvancedDisclosure', { open: true });
    register('mcAdvancedSummary');
    register('rngMode', { value: 'per-run-seed' });
    register('mcWorkerCount', { value: '8' });
    register('mcWorkerBudget', { value: '500' });
    register('mcCompareMode', { checked: false });
    register('telemetryToggle', { checked: false });
    register('mcShowReplayButton');
    register('mcShowScenarioLogsButton');
    register('mcAnzahl', { value: '10000' });
    register('mcDauer', { value: '35' });
    register('mcSeed', { value: '12345' });
    register('stressPreset', { value: 'NONE', options: [{ value: 'NONE', textContent: 'Kein Stress' }, { value: 'TEST', textContent: 'Teststress' }] });
    register('tailRiskEnabled', { checked: false });
    register('mcSetupSummaryStress');
    register('mcSetupSummaryTailRisk');
    register('mcMethode', { value: 'regime_markov', options: methodOptions });
    for (const id of ['mcSetupSummaryRuns', 'mcSetupSummaryDuration', 'mcSetupSummaryMethod', 'mcSetupSummarySeed']) {
        register(id);
    }
    const mainPanels = ['montecarlo', 'werkstatt'].map(id => register('tab-' + id));
    const toolPanels = ['replay', 'sweep', 'optimize'].map(id => register(id === 'replay' ? 'workshopReplayPanel' : id === 'sweep' ? 'tab-sweep' : 'tab-auto-optimize', { hidden: id !== 'replay' }));
    const selectorElements = new Map();
    for (const viewId of ['overview', 'risk', 'care', 'logs']) {
        const capitalized = viewId[0].toUpperCase() + viewId.slice(1);
        const tab = register(`mcViewTab${capitalized}`);
        const panel = register(`mcViewPanel${capitalized}`, { hidden: viewId !== 'overview' });
        selectorElements.set(`[role="tab"][data-mc-view="${viewId}"]`, tab);
        selectorElements.set(`[role="tabpanel"][data-mc-view-panel="${viewId}"]`, panel);
    }
    register('mcReplayVariantBadge', { hidden: true });
    register('stressReplayVariantList', { variantItems: 0 });
    register('stressReplayComparison', { queryResults: new Map() });
    register('stressReplayStatus');
    register('stressReplaySelectedScenario');
    register('stressReplayFixButton', { disabled: true });
    return {
        elements,
        getElementById: id => elements.get(id) || null,
        querySelectorAll: selector => selector === '.tab-panel' ? mainPanels : selector === '[data-workshop-panel]' ? toolPanels : [],
        querySelector: selector => selectorElements.get(selector) || null
    };
}

console.log('Test 1: cockpit initialization is idempotent and projects raw setup values');
{
    const documentRef = createDocument();
    const first = initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    const second = initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    assert(first === second, 'cockpit is initialized exactly once per document');
    assertEqual(documentRef.getElementById('mcViewTabOverview').listeners.get('click').length, 1,
        'repeated initialization does not duplicate result-tab listeners');
    assertEqual(documentRef.getElementById('mcShowReplayButton').listeners.get('click').length, 1,
        'repeated initialization does not duplicate the replay-link listener');
    assertEqual(documentRef.getElementById('mcShowScenarioLogsButton').listeners.get('click').length, 1,
        'repeated initialization does not duplicate the scenario-log-link listener');
    assertEqual(documentRef.getElementById('mcSetupSummaryRuns').textContent, '10000', 'run count is projected without normalization');
    assertEqual(documentRef.getElementById('mcSetupSummaryDuration').textContent, '35', 'duration is projected without normalization');
    assertEqual(documentRef.getElementById('mcSetupSummaryMethod').textContent, 'Regime-Sampling (Markov-Chain)', 'selected method label is projected');
    assertEqual(documentRef.getElementById('mcSetupSummarySeed').textContent, '12345', 'seed is projected without normalization');

    assertEqual(documentRef.getElementById('mcSetupSummaryStress').textContent, 'Kein Stressmodus', 'Kein Stress ist ein tatsächlicher Zustand');
    const stress = documentRef.getElementById('stressPreset');
    stress.value = 'TEST'; stress.dispatch('change');
    assertEqual(documentRef.getElementById('mcSetupSummaryStress').textContent, 'Teststress', 'Zusammenfassung zeigt gewähltes Stresspreset');
    const tail = documentRef.getElementById('tailRiskEnabled'); tail.checked = true; tail.dispatch('change');
    assertEqual(documentRef.getElementById('mcSetupSummaryTailRisk').textContent, 'Tail-Risk aktiv', 'Tail-Risk bleibt vom Stress getrennt');
    const runs = documentRef.getElementById('mcAnzahl');
    runs.value = '00042';
    runs.dispatch('input');
    assertEqual(documentRef.getElementById('mcSetupSummaryRuns').textContent, '00042', 'summary preserves the current UI string');
}

console.log('Test 2: ein Kopfknopf und technische Abweichungen');
{
    const documentRef = createDocument();
    assert(initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null }), 'Cockpit benötigt keinen zweiten Startknopf');
    assertEqual(documentRef.getElementById('mcRecalculateButton'), null, 'Keine delegierende Startaktion');
    assert(!documentRef.getElementById('mcSetupDisclosure').open && !documentRef.getElementById('mcAdvancedDisclosure').open, 'Initialisierung schließt beide Klappen');
    const output = documentRef.getElementById('mcAdvancedSummary');
    assertEqual(output.textContent, 'Standard', 'Technische Defaults sind keine Abweichungen');
    const worker = documentRef.getElementById('mcWorkerCount');
    worker.value = '0'; worker.dispatch('input');
    assertEqual(output.textContent, 'Prozesse: 0', 'Zusammenfassung meldet nur tatsächliche Abweichung');
    worker.value = '8'; worker.dispatch('change');
    documentRef.getElementById('telemetryToggle').checked = true;
    documentRef.getElementById('telemetryToggle').dispatch('change');
    assertEqual(output.textContent, 'Telemetrie aktiv', 'Telemetrie aktualisiert Zusammenfassung ohne Lauf');
    const primary = documentRef.getElementById('mcButton');
    primary.disabled = true; primary.setAttribute('aria-busy', 'true');
    syncMonteCarloCockpitStartState({ documentRef });
    assert(primary.disabled && primary.getAttribute('aria-busy') === 'true', 'Cockpit verändert die kanonische Runsperre nicht');
}

console.log('Test 3: only successful completion closes setup and refreshes its summary');
{
    const documentRef = createDocument();
    initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    const disclosure = documentRef.getElementById('mcSetupDisclosure');
    disclosure.open = true;
    syncMonteCarloCockpitStartState({ documentRef });
    assert(disclosure.open, 'run-state synchronization does not close setup');
    documentRef.getElementById('mcSeed').value = '9876';
    completeMonteCarloCockpitRun({ documentRef });
    assert(!disclosure.open, 'successful completion closes setup');
    assertEqual(documentRef.getElementById('mcSetupSummarySeed').textContent, '9876', 'completion refreshes the visible summary');
}

console.log('Test 4: Simulator DOM keeps cockpit contracts and ordering');
{
    const html = fs.readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../simulator.css', import.meta.url), 'utf8');
    const resultsSource = fs.readFileSync(new URL('../app/simulator/simulator-results.js', import.meta.url), 'utf8');
    for (const id of ['mcButton', 'mcCancelButton', 'mcRunStatus', 'monteCarloResults', 'stressReplayWorkspace', 'scenarioSelector', 'print-footer']) {
        assertEqual((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} remains unique`);
    }
    assert(!/<details id="mcSetupDisclosure"[^>]* open>/.test(html), 'Einstellungen starten geschlossen');
    const tree = tokenizeHTML(html);
    const setupHost = tree.elements.find(node => node.attrs.id === 'mcSetupDisclosure');
    const insideSetup = node => { for (let parent = node.parent; parent; parent = parent.parent) if (parent === setupHost) return true; return false; };
    const setup = html.slice(html.indexOf('<details id="mcSetupDisclosure"'), html.indexOf('<div id="mcRunHead"'));
    assertEqual(tree.elements.filter(node => node.tag === 'fieldset' && insideSetup(node)).length, 4, 'Monte-Carlo-Einstellungen enthalten Simulation, Zeitraum & Daten, Stresstest und Extremereignisse');
    assert(tree.elements.some(node => node.attrs.id === 'mcAnzahl' && insideSetup(node))
        && tree.elements.some(node => node.attrs.id === 'mcDauer' && insideSetup(node)), 'Anzahl und Zeitraum stehen im Monte-Carlo-Parameterbereich');
    assert(!setup.includes('id="mcButton"') && !html.includes('id="mcRecalculateButton"') && !html.includes('id="overviewRunMonteCarlo"'), 'Einzige Startaktion liegt im Seitenkopf');
    assert(!setup.includes('max-height'), 'setup disclosure has no fixed clipping height');
    assert(html.indexOf('id="monteCarloResults"') < html.indexOf('id="stressReplayWorkspace"'), 'results precede replay deep-dive');
    assertEqual((html.match(/class="[^"]*\btab-btn\b[^"]*"/g) || []).length, 5, 'Simulator keeps exactly five main tabs');
    assertEqual((html.match(/class="(?:[^"]*\s)?mc-view-tab(?:\s[^"]*)?"/g) || []).length, 4, 'cockpit exposes exactly four dedicated result tabs');
    assertEqual((html.match(/class="mc-view-panel"/g) || []).length, 4, 'cockpit exposes exactly four dedicated result panels');
    const logsPanel = html.match(/id="mcViewPanelLogs"[\s\S]*?<\/section>\s*<div id="print-footer"/)?.[0] || '';
    assertEqual((html.match(/id="scenarioSelector"/g) || []).length, 1, 'scenario selector container remains unique');
    assert(logsPanel.includes('id="scenarioSelector"')
        && logsPanel.indexOf('id="scenarioSelector"') < logsPanel.indexOf('id="scenarioLogOutput"'),
    'scenario selector lives next to and before the controlled log output');
    assert(!html.includes('data-mc-view="replay"') && !html.includes('mcViewPanelReplay'), 'Kein fünftes Replaypanel verbleibt');
    const printRules = [...css.matchAll(/@media print\s*\{([\s\S]*?)\n\}/g)]
        .map(match => match[1]).join('\n');
    assert(/#tab-montecarlo, #tab-werkstatt, #workshopReplayPanel\[hidden\], #workshopReplayPanel, #tab-sweep, #tab-sweep\[hidden\], #tab-auto-optimize, #tab-auto-optimize\[hidden\]\s*\{\s*display:\s*block\s*!important;/s.test(printRules),
        'Druck öffnet MC-/Werkstattahnen und Replay auch mit hidden');
    assert(/#tab-werkstatt > \.sim-page-head, #tab-werkstatt button\s*\{\s*display:\s*none\s*!important;/s.test(printRules),
        'Druck blendet Werkzeugkopf und Aktionen aus');
    assert(/#tab-sweep\[hidden\].*#tab-auto-optimize\[hidden\].*display: block !important/.test(printRules),
        'Druck zeigt auch geschlossene Werkzeuge; DOM-Auswahl bleibt erhalten');
    assert(html.includes('id="mcShowReplayButton"'), 'scenario logs expose the replay navigation action');
    assert(logsPanel.indexOf('id="mcShowReplayButton"') < logsPanel.indexOf('id="scenarioLogContainer"'),
        'replay navigation remains visible before the legacy scenario-log container is populated');
    for (const id of ['stressReplaySelectedScenario', 'stressReplaySelectedScenarioLabel',
        'stressReplaySelectedScenarioWealth', 'stressReplaySelectedScenarioCare', 'mcShowScenarioLogsButton']) {
        assertEqual((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} remains unique`);
    }
    assert(html.includes('id="mcSettingsToggle" aria-expanded="false" aria-controls="mcSetupDisclosure"'), 'Separater Einstellungenknopf steuert die native Klappe ohne verschachtelte Interaktion');
    assertEqual((html.match(/<dt>/g) || []).length >= 7, true, 'replay banner retains all diagnostic terms');
    assert(/id="stressReplayVariantFields"[\s\S]*?<div class="stress-replay-editor-grid">/.test(html),
        'focused replay editor grid remains a direct fieldset child');
    assert(/\.stress-replay-editor-grid\s+\[data-active-when\]\[hidden\]\s*\{[^}]*display:\s*none;/s.test(css),
        'conditional replay fields keep their hidden state against the editor label layout');
    assert(/projectStressReplayScenario\(scenario\);\s*selectStressReplayScenario\(scenario\);/s.test(resultsSource),
        'the read-only projection and replay controller consume the same resolved scenario in one path');
    assert((resultsSource.match(/projectStressReplayScenario\(null\)/g) || []).length >= 4,
        'initial, empty, unresolved and logless paths all clear the read-only projection');
}

console.log('Test 5: result tabs use one activation path for view ids and contained targets');
{
    const documentRef = createDocument();
    const overviewTarget = new FakeElement('overviewTarget');
    documentRef.getElementById('mcViewPanelOverview').containedElements.add(overviewTarget);
    initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });

    assertEqual(activateMonteCarloResultView('logs', { documentRef }), 'logs', 'view id activates logs');
    assertEqual(documentRef.getElementById('mcViewTabLogs').getAttribute('aria-selected'), 'true', 'active tab is selected');
    assertEqual(documentRef.getElementById('mcViewTabLogs').getAttribute('tabindex'), '0', 'active tab owns the roving tabindex');
    assert(!documentRef.getElementById('mcViewPanelLogs').hidden, 'active panel is exposed');
    assert(documentRef.getElementById('mcViewPanelOverview').hidden, 'inactive panel is hidden');

    assertEqual(activateMonteCarloResultView('replay', { documentRef }), null, 'Replay besitzt keine fünfte MC-Ansicht');
    assertEqual(activateMonteCarloResultView(overviewTarget, { documentRef }), 'overview', 'contained target resolves its panel');
    documentRef.getElementById('mcViewTabOverview').dispatch('keydown', { key: 'End' });
    assertEqual(documentRef.getElementById('mcViewTabLogs').focusCount, 1, 'End activates and focuses the final result tab');
    documentRef.getElementById('mcViewTabLogs').dispatch('keydown', { key: 'Home' });
    assertEqual(documentRef.getElementById('mcViewTabOverview').getAttribute('aria-selected'), 'true', 'Home erreicht Überblick auf der Viereranzahl');
    documentRef.getElementById('mcViewTabOverview').dispatch('keydown', { key: 'ArrowLeft' });
    assertEqual(documentRef.getElementById('mcViewTabLogs').getAttribute('aria-selected'), 'true', 'ArrowLeft umläuft auf die vierte Ansicht');
    documentRef.getElementById('mcViewTabLogs').dispatch('keydown', { key: 'ArrowRight' });
    assertEqual(documentRef.getElementById('mcViewTabOverview').focusCount, 2, 'ArrowRight wraps and focuses the first result tab');
}

console.log('Test 6: replay variant badge reports alternatives only');
{
    const documentRef = createDocument();
    const list = documentRef.getElementById('stressReplayVariantList');
    const badge = documentRef.getElementById('mcReplayVariantBadge');
    list.variantItems = 1;
    assertEqual(updateMonteCarloReplayVariantBadge({ documentRef }), 0, 'baseline alone is not counted as a variant');
    assert(badge.hidden, 'zero alternatives keep the badge hidden');
    list.variantItems = 3;
    assertEqual(updateMonteCarloReplayVariantBadge({ documentRef }), 2, 'alternatives are derived from the rendered workspace list');
    assert(!badge.hidden, 'positive alternative count exposes the badge');
    assertEqual(badge.textContent, '2', 'badge displays the alternative count');
}

console.log('Test 7: cross-panel scenario navigation focuses only targets in the activated panel');
{
    const documentRef = createDocument();
    const replayPanel = documentRef.getElementById('workshopReplayPanel');
    const logsPanel = documentRef.getElementById('mcViewPanelLogs');
    const option = new FakeElement('option');
    option.setAttribute('data-scenario-id', 'char_worst');
    const list = new FakeElement('scenarioList');
    list.queryResults = new Map([['[role="option"]', [option]]]);
    const disclosure = new FakeElement('scenarioSelectionDisclosure');
    documentRef.elements.set('scenarioList', list);
    documentRef.elements.set('scenarioSelectionDisclosure', disclosure);
    logsPanel.containedElements.add(option);
    bindScenarioLogView({ document: documentRef, logs: { characteristic: [{ key: 'worst', label: 'Worst', logDataRows: [] }] }, onSelect() {}, onMode() {} });
    disclosure.open = false;
    initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    activateMonteCarloResultView('logs', { documentRef });
    const querySelector = documentRef.querySelector;
    delete documentRef.querySelector;
    documentRef.getElementById('mcShowReplayButton').click();
    documentRef.querySelector = querySelector;
    assert(!replayPanel.hidden && documentRef.getElementById('tab-werkstatt').classList.contains('active'), 'backlink opens the workshop before focusing replay');
    assertEqual(documentRef.getElementById('stressReplaySelectedScenario').focusCount, 1,
        'backlink focuses the replay projection before a selectable run exists');
    assertEqual(option.focusCount, 0, 'backlink never focuses the Option hidden in the logs panel');

    documentRef.getElementById('stressReplayFixButton').disabled = false;
    activateMonteCarloResultView('logs', { documentRef });
    documentRef.getElementById('mcShowReplayButton').click();
    assertEqual(documentRef.getElementById('stressReplayFixButton').focusCount, 1,
        'backlink prefers the enabled fixation action for a valid run');

    option.focusCalls = [];
    option.scrollCalls = [];
    option.onFocus = () => {
        assert(!logsPanel.hidden && documentRef.getElementById('tab-montecarlo').classList.contains('active'),
            'Beim Fokusaufruf sind MC und Logs bereits aktiviert');
        assert(disclosure.open, 'Beim Fokusaufruf ist die Aufklappliste bereits geöffnet');
    };
    documentRef.getElementById('mcShowScenarioLogsButton').click();
    assert(!logsPanel.hidden && documentRef.getElementById('tab-montecarlo').classList.contains('active'), 'return opens Monte-Carlo and the scenario logs before focusing');
    assertEqual(option.focusCount, 1, 'replay return action focuses the aktuelle Option');
    assertEqual(option.focusCalls.length, 1, 'Rückweg fokussiert genau die gewählte Option');
    assert(option.focusCalls[0]?.preventScroll !== true,
        'Replay-Rückweg erlaubt dem Browser, die Option im Seitenviewport sichtbar zu scrollen');

    assert(disclosure.open, 'Replayrückweg öffnet die schmale Auswahl');
    disposeScenarioLogView(documentRef);
    documentRef.getElementById('mcShowReplayButton').click();
    documentRef.getElementById('mcShowScenarioLogsButton').click();
    assertEqual(documentRef.getElementById('mcShowReplayButton').focusCount, 1,
        'replay return action focuses a visible logs-panel fallback before a run');
}

console.log('Test 8: delegated comparison tabs survive rerender and keep an independent roving focus');
{
    const documentRef = createDocument();
    const root = documentRef.getElementById('stressReplayComparison');
    const tabSelector = '[role="tab"][data-stress-replay-comparison-view]';
    const panelSelector = '[role="tabpanel"][data-stress-replay-comparison-panel]';
    const renderComparison = suffix => {
        const tabs = ['kpi', 'delta', 'year'].map(viewId => new FakeElement(`${viewId}-${suffix}`, {
            dataset: { stressReplayComparisonView: viewId }
        }));
        const panels = ['kpi', 'delta', 'year'].map((viewId, index) => new FakeElement(`${viewId}-panel-${suffix}`, {
            dataset: { stressReplayComparisonPanel: viewId }, hidden: index !== 0
        }));
        for (const tab of tabs) tab.closest = selector => selector === tabSelector ? tab : null;
        root.queryResults.set(tabSelector, tabs);
        root.queryResults.set(panelSelector, panels);
        return { tabs, panels };
    };

    const firstRender = renderComparison('first');
    const first = initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    const second = initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    assert(first === second, 'comparison delegation shares the cockpit document initialization guard');
    assertEqual(root.listeners.get('click').length, 1, 'comparison click delegation is registered exactly once');
    assertEqual(root.listeners.get('keydown').length, 1, 'comparison keyboard delegation is registered exactly once');
    root.dispatch('click', { target: firstRender.tabs[1] });
    assert(!firstRender.panels[1].hidden && firstRender.panels[0].hidden, 'pointer activation exposes only Delta');

    const secondRender = renderComparison('second');
    root.dispatch('keydown', { target: secondRender.tabs[0], key: 'End' });
    assert(!secondRender.panels[2].hidden && secondRender.panels[0].hidden, 'delegated End resolves the current rerendered panels');
    assertEqual(secondRender.tabs[2].focusCount, 1, 'keyboard activation focuses the current rerendered tab');
    root.dispatch('keydown', { target: secondRender.tabs[2], key: 'ArrowRight' });
    assert(!secondRender.panels[0].hidden, 'comparison ArrowRight wraps independently to Kennzahlen');
    assertEqual(secondRender.tabs[0].focusCount, 1, 'wrapped comparison tab receives focus');
    assertEqual(documentRef.getElementById('mcViewTabOverview').getAttribute('aria-selected'), 'true',
        'comparison keyboard handling does not change the Monte-Carlo view tabs');
    assertEqual(activateStressReplayComparisonView('unknown', { documentRef }), null,
        'unknown comparison views fail closed');
}

updateMonteCarloSetupSummary({ documentRef: null });
assert(true, 'summary update tolerates an unavailable document');

{
    const documentRef = createDocument();
    initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    initMonteCarloResultCockpit({ documentRef, MutationObserverCtor: null });
    const toggle = documentRef.getElementById('mcSettingsToggle'), setup = documentRef.getElementById('mcSetupDisclosure');
    assertEqual(toggle.listeners.get('click').length, 1, 'Einstellungenknopf wird je Dokument einmal gebunden');
    assertEqual(toggle.textContent, 'Einstellungen anzeigen', 'Frische Initialisierung zeigt geschlossenen Zustand');
    toggle.click();
    assertEqual(setup.open, true, 'Erste Aktion öffnet Einstellungen');
    toggle.click();
    assertEqual(setup.open, false, 'Separater Knopf schließt ausschließlich die Einstellungen');
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'Schließen synchronisiert ARIA ohne Startaktion');
    assertEqual(toggle.textContent, 'Einstellungen anzeigen', 'Geschlossene Klappe hat eindeutige Aktion');
    assertEqual(documentRef.getElementById('mcButton').clickCount, 0, 'Einstellungen anzeigen startet keinen Lauf');
    toggle.click();
    assertEqual(setup.open, true, 'Derselbe Knopf öffnet die vorhandenen Einstellungen');
    completeMonteCarloCockpitRun({ documentRef });
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'Erfolgreicher Abschluss synchronisiert den Knopf auch vor dem nativen toggle-Ereignis');
}
