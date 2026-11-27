import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import {
    activateMonteCarloResultView,
    completeMonteCarloCockpitRun,
    initMonteCarloResultCockpit,
    revealMonteCarloResult,
    syncMonteCarloCockpitStartState,
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
    const setup = register('mcSetupDisclosure', { open: true });
    const toggle = register('mcSettingsToggle');
    register('mcSettingsAction');
    // Native summary activation and its toggle event are supplied by the DOM.
    toggle.click = () => { setup.open = !setup.open; setup.dispatch('toggle'); };
    register('mcButton');
    register('mcAdvancedDisclosure', { open: true });
    register('mcAdvancedSummary');
    register('rngMode', { value: 'per-run-seed' });
    register('mcWorkerCount', { value: '8' });
    register('mcWorkerBudget', { value: '500' });
    register('mcCompareMode', { checked: false });
    register('telemetryToggle', { checked: false });
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
    const selectorElements = new Map();
    for (const viewId of ['overview', 'risk', 'care', 'logs', 'decision']) {
        const capitalized = viewId[0].toUpperCase() + viewId.slice(1);
        const tab = register(`mcViewTab${capitalized}`);
        const panel = register(`mcViewPanel${capitalized}`, { hidden: viewId !== 'overview' });
        selectorElements.set(`[role="tab"][data-mc-view="${viewId}"]`, tab);
        selectorElements.set(`[role="tabpanel"][data-mc-view-panel="${viewId}"]`, panel);
    }
    return {
        elements,
        getElementById: id => elements.get(id) || null,
        querySelectorAll: () => [],
        querySelector: selector => selectorElements.get(selector) || null
    };
}

console.log('Test 1: cockpit initialization is idempotent and projects raw setup values');
{
    const documentRef = createDocument();
    const first = initMonteCarloResultCockpit({ documentRef });
    const second = initMonteCarloResultCockpit({ documentRef });
    assert(first === second, 'cockpit is initialized exactly once per document');
    assertEqual(documentRef.getElementById('mcViewTabOverview').listeners.get('click').length, 1,
        'repeated initialization does not duplicate result-tab listeners');
    assertEqual(documentRef.getElementById('mcSetupSummaryRuns').textContent, '10.000', 'Laufzahl wird im Kopf deutsch formatiert');
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
    assertEqual(documentRef.getElementById('mcSetupSummaryRuns').textContent, '42', 'Kopf formatiert nur die Anzeige der aktuellen Laufzahl');
}

console.log('Test 2: ein Kopfknopf und technische Abweichungen');
{
    const documentRef = createDocument();
    assert(initMonteCarloResultCockpit({ documentRef }), 'Cockpit benötigt keinen zweiten Startknopf');
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
    initMonteCarloResultCockpit({ documentRef });
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
    for (const id of ['mcButton', 'mcCancelButton', 'mcRunStatus', 'monteCarloResults', 'scenarioSelector', 'print-footer']) {
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
    assertEqual((html.match(/class="[^"]*\btab-btn\b[^"]*"/g) || []).length, 4, 'Simulator keeps exactly four main tabs');
    assertEqual((html.match(/class="(?:[^"]*\s)?mc-view-tab(?:\s[^"]*)?"/g) || []).length, 5, 'cockpit exposes exactly five dedicated result tabs');
    assertEqual((html.match(/class="mc-view-panel"/g) || []).length, 5, 'cockpit exposes exactly five dedicated result panels');
    const logsPanel = html.match(/id="mcViewPanelLogs"[\s\S]*?<\/section>\s*<section id="mcViewPanelDecision"/)?.[0] || '';
    assertEqual((html.match(/id="scenarioSelector"/g) || []).length, 1, 'scenario selector container remains unique');
    assert(logsPanel.includes('id="scenarioSelector"')
        && logsPanel.indexOf('id="scenarioSelector"') < logsPanel.indexOf('id="scenarioLogOutput"'),
    'scenario selector lives next to and before the controlled log output');
    assert(!html.includes('data-mc-view="replay"') && !html.includes('mcViewPanelReplay'), 'Kein fünftes Replaypanel verbleibt');
    const printRules = [...css.matchAll(/@media print\s*\{([\s\S]*?)\n\}/g)]
        .map(match => match[1]).join('\n');
    assert(/#tab-montecarlo\s*\{\s*display:\s*block\s*!important;/s.test(printRules), 'Druck öffnet den Monte-Carlo-Reiter auch verborgen');
    assert(!/werkstatt|workshop|stress-replay|tab-sweep|auto-optimize/.test(printRules), 'Druckregeln enthalten keine entfernten Werkstattflächen');
    assert(!html.includes('mcShowReplayButton') && !html.includes('stressReplay'), 'Szenario-Logs bieten keinen Weg in die entfernte Werkstatt');
    assert(html.includes('id="mcSettingsToggle" aria-expanded="false" aria-controls="mcSetupDisclosure"'), 'Nativer Einstellungenkopf behält ID und ARIA ohne verschachtelten Knopf');
}

console.log('Test 5: result tabs use one activation path for view ids and contained targets');
{
    const documentRef = createDocument();
    const overviewTarget = new FakeElement('overviewTarget');
    documentRef.getElementById('mcViewPanelOverview').containedElements.add(overviewTarget);
    initMonteCarloResultCockpit({ documentRef });

    assertEqual(activateMonteCarloResultView('logs', { documentRef }), 'logs', 'view id activates logs');
    assertEqual(documentRef.getElementById('mcViewTabLogs').getAttribute('aria-selected'), 'true', 'active tab is selected');
    assertEqual(documentRef.getElementById('mcViewTabLogs').getAttribute('tabindex'), '0', 'active tab owns the roving tabindex');
    assert(!documentRef.getElementById('mcViewPanelLogs').hidden, 'active panel is exposed');
    assert(documentRef.getElementById('mcViewPanelOverview').hidden, 'inactive panel is hidden');

    assertEqual(activateMonteCarloResultView('replay', { documentRef }), null, 'Replay besitzt keine fünfte MC-Ansicht');
    assertEqual(activateMonteCarloResultView(overviewTarget, { documentRef }), 'overview', 'contained target resolves its panel');
    documentRef.getElementById('mcViewTabOverview').dispatch('keydown', { key: 'End' });
    assertEqual(documentRef.getElementById('mcViewTabDecision').focusCount, 1, 'End activates and focuses the final result tab');
    documentRef.getElementById('mcViewTabDecision').dispatch('keydown', { key: 'Home' });
    assertEqual(documentRef.getElementById('mcViewTabOverview').getAttribute('aria-selected'), 'true', 'Home erreicht Überblick auf der Fünferanzahl');
    documentRef.getElementById('mcViewTabOverview').dispatch('keydown', { key: 'ArrowLeft' });
    assertEqual(documentRef.getElementById('mcViewTabDecision').getAttribute('aria-selected'), 'true', 'ArrowLeft umläuft auf die fünfte Ansicht');
    documentRef.getElementById('mcViewTabDecision').dispatch('keydown', { key: 'ArrowRight' });
    assertEqual(documentRef.getElementById('mcViewTabOverview').focusCount, 2, 'ArrowRight wraps and focuses the first result tab');
}

updateMonteCarloSetupSummary({ documentRef: null });
assert(true, 'summary update tolerates an unavailable document');

{
    const documentRef = createDocument();
    initMonteCarloResultCockpit({ documentRef });
    initMonteCarloResultCockpit({ documentRef });
    const toggle = documentRef.getElementById('mcSettingsToggle'), setup = documentRef.getElementById('mcSetupDisclosure');
    assertEqual(setup.listeners.get('toggle').length, 1, 'Nativer Klappkopf wird je Dokument einmal gebunden');
    assertEqual(documentRef.getElementById('mcSettingsAction').textContent, '▸ zeigen', 'Frische Initialisierung zeigt geschlossenen Zustand');
    toggle.click();
    assertEqual(setup.open, true, 'Erste Aktion öffnet Einstellungen');
    assertEqual(documentRef.getElementById('mcSettingsAction').textContent, '▾ ausblenden', 'Offener Kopf nennt ausblenden');
    toggle.click();
    assertEqual(setup.open, false, 'Separater Knopf schließt ausschließlich die Einstellungen');
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'Schließen synchronisiert ARIA ohne Startaktion');
    assertEqual(documentRef.getElementById('mcSettingsAction').textContent, '▸ zeigen', 'Geschlossene Klappe hat eindeutige Aktion');
    assertEqual(documentRef.getElementById('mcButton').clickCount, 0, 'Einstellungen anzeigen startet keinen Lauf');
    toggle.click();
    assertEqual(setup.open, true, 'Derselbe Knopf öffnet die vorhandenen Einstellungen');
    completeMonteCarloCockpitRun({ documentRef });
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'Erfolgreicher Abschluss synchronisiert den Knopf auch vor dem nativen toggle-Ereignis');
}

// OP-1 (Punkt 3): Nach dem Lauf stehen Reiterzeile des Simulators, Ergebnisreiter und Überschrift des Ergebnisses gleichzeitig im Bild.
// Lagen wie gemessen bei Max und Erika (Seitenkoordinaten): Reiter 309–358, Ergebnisreiter 668–714, Ergebnis ab 746, Überschrift bis 799.
for (const height of [1080, 1440, 400, 60]) {
    const box = (top, bottom) => ({ getBoundingClientRect: () => ({ top: top - win.scrollY, bottom: bottom - win.scrollY, height: bottom - top }) });
    const win = { scrollY: 746, innerHeight: height, scrollTo({ top }) { this.scrollY = top; } };
    const tabs = box(309, 358), nav = box(668, 714), heading = box(771, 799);
    const result = { ...box(746, 2339), querySelector: selector => selector === 'h2' ? heading : null };
    const documentRef = { defaultView: win, querySelector: selector => ({ '.tab-buttons': tabs, '.mc-view-nav': nav })[selector] || null };
    const moved = revealMonteCarloResult(result, { documentRef });
    const visible = element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= height; };
    if (height >= 1080) assert(moved && visible(tabs) && visible(nav) && visible(heading), `OP-1 Punkt 3: ${height} px zeigt Reiterzeile, Ergebnisreiter und Überschrift zugleich`);
    else if (height === 400) assert(moved && !visible(tabs) && visible(nav) && visible(heading), 'OP-1 Punkt 3: niedriges Fenster beginnt bei den Ergebnisreitern');
    else assertEqual(moved, false, 'OP-1 Punkt 3: passt nichts davon, bleibt das bisherige Fokus-Scrollen');
}

// OP-1 Nachtrag 3 (P2-1): Endet der Lauf, während ein anderer Simulator-Reiter offen ist, bleibt die Seite stehen.
for (const [active, height, expected, label] of [[false, 0, false, 'anderer Reiter offen'], [true, 0, false, 'Ergebnis verborgen'], [true, 1593, true, 'Monte-Carlo-Reiter offen']]) {
    const win = { scrollY: 120, innerHeight: 1080, scrollTo({ top }) { this.scrollY = top; } };
    const box = (top, bottom) => ({ getBoundingClientRect: () => ({ top: top - win.scrollY, bottom: bottom - win.scrollY, height: bottom - top }) });
    const panel = { classList: { contains: name => name === 'active' && active } };
    const result = { getBoundingClientRect: () => ({ top: 746 - win.scrollY, bottom: 746 + height - win.scrollY, height }),
        closest: selector => selector === '.tab-panel' ? panel : null, querySelector: () => null };
    const documentRef = { defaultView: win, querySelector: selector => ({ '.tab-buttons': box(309, 358), '.mc-view-nav': box(668, 714) })[selector] || null };
    assertEqual(revealMonteCarloResult(result, { documentRef }), expected, `OP-1 P2-1: ${label}`);
    assertEqual(win.scrollY, expected ? 293 : 120, `OP-1 P2-1: Scrollstand bei „${label}“`);
}
