import fs from 'node:fs';
import { initWorkshopUI, selectWorkshopTool, openWorkshopReplay } from '../app/simulator/simulator-workshop-ui.js';
import { activateSimulatorTab } from '../app/simulator/simulator-main-tabs.js';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { rules } from './designsystem-source-contract.mjs';

function fixture() {
    const nodes = new Map(), all = [];
    const doc = {
        activeElement: null, events: [], listeners: {},
        getElementById: id => nodes.get(id),
        querySelectorAll: selector => selector === '[data-workshop-panel]' ? panels
            : selector === '[data-workshop-tool]' ? buttons
            : selector === '.tab-btn' ? tabs : selector === '.tab-panel' ? mainPanels : [],
        querySelector: selector => selector.includes('aria-pressed') ? buttons.find(b => b.getAttribute('aria-pressed') === 'true')
            : selector === '.tab-buttons' ? bar : selector === '.sim-page-actions' ? actions : null,
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
        dispatchEvent(event) { this.events.push(event.detail); }
    };
    function node(id, dataset = {}) {
        const classes = new Set();
        const n = {
            id, dataset, hidden: false, attributes: {}, listeners: {}, textContent: '',
            classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
            setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name]; },
            addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
            fire(type, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; this.listeners[type]?.forEach(fn => fn(event)); },
            focus() { doc.activeElement = this; }, closest() { return this.card; },
            querySelector() { return this.head || null; },
            appendChild(child) { child.parent = this; }, insertBefore(child) { child.parent = this; },
            insertAdjacentElement(_where, child) { child.parent = this; }
        };
        nodes.set(id, n); all.push(n); return n;
    }
    const cards = node('workshopToolCards');
    const bar = node('bar'), actions = node('actions'); node('simulatorContextPills');
    const buttons = ['replay', 'sweep', 'optimize'].map(tool => {
        const b = node(`choose-${tool}`, { workshopTool: tool }); b.card = node(`card-${tool}`);
        b.setAttribute('aria-pressed', 'false'); return b;
    });
    cards.querySelectorAll = () => buttons;
    const panels = ['workshopReplayPanel', 'tab-sweep', 'tab-auto-optimize'].map(id => node(id));
    panels.forEach(p => { p.hidden = true; p.field = { value: 'Arbeitsstand' }; p.result = { text: 'Ergebnis' }; p.controller = { phase: 'running', starts: 1, cancels: 0 }; });
    const tabs = ['ergebnis', 'annahmen', 'backtesting', 'montecarlo', 'werkstatt'].map(tab => node(`choose-${tab}`, { tab }));
    const mainPanels = tabs.map(t => { const p = node('tab-' + t.dataset.tab); p.head = node('head-' + t.dataset.tab); return p; });
    return { doc, buttons, panels, cards, tabs, mainPanels, bar, actions };
}

const f = fixture();
initWorkshopUI(f.doc); initWorkshopUI(f.doc);
assert(f.buttons.every(b => b.listeners.click.length === 1) && f.cards.listeners.keydown.length === 1,
    'Wiederholtes Initialisieren bindet jeden Listener einmal');
assertEqual(f.doc.listeners.click.length, 1, 'Dokumentlistener wird einmal gebunden');
assert(!selectWorkshopTool('unknown', { documentRef: f.doc }), 'Unbekanntes Werkzeug verändert keinen Zustand');
for (let round = 1; round <= 3; round++) {
    for (const [i, b] of f.buttons.entries()) {
        activateSimulatorTab('ergebnis', { documentRef: f.doc });
        b.fire('click');
        assert(f.mainPanels[4].classList.contains('active'), 'Werkzeugwahl aktiviert den Hauptreiter als sichtbaren Ahnen');
        assert(!f.cards.hidden && f.panels.filter(p => !p.hidden).length === 1 && !f.panels[i].hidden,
            'Drei Auswahlkarten bleiben sichtbar; genau eine Fläche ist offen');
        assertEqual(b.textContent, 'Schließen', 'Aktiver Kartenknopf schließt');
        assert(b.card.classList.contains('is-active') && b.getAttribute('aria-expanded') === 'true'
            && b.getAttribute('aria-pressed') === 'true' && b.getAttribute('aria-label').endsWith('schließen'), 'Tönung und zugänglicher Zustand stimmen überein');
        assertEqual(f.doc.activeElement, f.panels[i], 'Öffnen fokussiert die Werkzeugfläche');
        b.fire('click');
        assert(f.panels.every(p => p.hidden) && !f.cards.hidden, 'Erneuter Klick schließt alle Flächen');
        assertEqual(f.doc.activeElement, b, 'Schließen führt Fokus zum Kartenknopf zurück');
        assertEqual(b.textContent, 'Öffnen', 'Geschlossener Knopf öffnet wieder');
        assert(!b.card.classList.contains('is-active') && b.getAttribute('aria-expanded') === 'false', 'Schließen entfernt Tönung und ARIA-Auswahl');
    }
}
const refs = f.panels.map(p => [p, p.field, p.result, p.controller]);
f.buttons[1].fire('click'); f.panels[1].field.value = '501';
f.buttons[2].fire('click'); f.buttons[0].fire('click'); f.buttons[1].fire('click');
assertEqual(f.panels[1].field.value, '501', 'Werkzeugwechsel erhält Eingabe');
for (const [i, ref] of refs.entries()) {
    assert(ref.every((value, index) => value === [f.panels[i], f.panels[i].field, f.panels[i].result, f.panels[i].controller][index]),
        'Felder, Ergebnis und Controller behalten ihre Identität');
    assert(f.panels[i].result.text === 'Ergebnis' && f.panels[i].controller.starts === 1 && f.panels[i].controller.cancels === 0,
        'Wechsel startet und stoppt keinen Lauf und löscht kein Ergebnis');
}
f.buttons[1].fire('click');
f.cards.fire('keydown', { target: f.buttons[0], key: 'End' });
assertEqual(f.doc.activeElement, f.buttons[2], 'End fokussiert die letzte Karte');
assert(!f.panels[2].hidden, 'Tastaturwechsel öffnet das zugehörige Werkzeug');
f.cards.fire('keydown', { target: f.buttons[2], key: 'ArrowRight' });
assertEqual(f.doc.activeElement, f.buttons[0], 'Pfeilnavigation umläuft die drei Karten');
assert(openWorkshopReplay({ documentRef: f.doc }), 'Rücklink aus Szenario-Logs öffnet Replay');
assert(f.mainPanels[4].classList.contains('active') && !f.panels[0].hidden && !f.cards.hidden, 'Rücklink aktiviert Werkstatt mit sichtbaren Auswahlkarten');
assertEqual(f.doc.activeElement, f.panels[0], 'Rücklink fokussiert Replay');
for (const tab of f.tabs) {
    assert(activateSimulatorTab(tab.dataset.tab, { documentRef: f.doc }), 'Alle fünf Hauptreiter sind erreichbar');
    assertEqual(f.tabs.filter(b => b.getAttribute('aria-selected') === 'true').length, 1, 'Genau ein Hauptreiter ausgewählt');
    assertEqual(f.mainPanels.filter(p => p.classList.contains('active')).length, 1, 'Genau ein Hauptpanel aktiv');
    const head = f.doc.getElementById('tab-' + tab.dataset.tab).head;
    assert(f.bar.parent === head && f.actions.parent === head, 'Bestehende Leiste und Aktionshost folgen dem Kopf');
}
const html = fs.readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../simulator.css', import.meta.url), 'utf8');
const sourceRules = rules('simulator.css', css);
const active = sourceRules.find(r => r.selector === '.tab-btn.active').declarations;
assert(active['font-weight'] === '600' && active['border-bottom-color'] === 'var(--secondary-color)' && !active.background,
    'Aktive Hauptreiter verwenden kräftige Schrift und Unterstrich ohne Füllung');
assert(sourceRules.some(r => r.selector === '.tab-btn:focus-visible' && r.declarations.outline), 'Fokusindikator bleibt unabhängig vom Unterstrich');
assert(html.includes('Selten gebrauchte Werkzeuge für Vergleiche und Parametersuche.')
    && html.includes('Übernommene Werte landen in den Annahmen und machen Ergebnisse veraltet.'), 'Lead und Hinweis erklären Übernahmefolgen');
const parsed = tokenizeHTML(html);
const workshop = parsed.elements.find(n => n.attrs.id === 'tab-werkstatt');
function inside(node, host) { for (let p = node; p; p = p.parent) if (p === host) return true; return false; }
for (const field of parsed.elements.filter(n => ['input', 'select'].includes(n.tag) && inside(n, workshop)
    && n.attrs.type !== 'hidden' && n.attrs.type !== 'file')) {
    assert(parsed.elements.some(n => n.tag === 'label' && n.attrs.for === field.attrs.id) || parsed.elements.some(n => n.tag === 'label' && inside(field, n)),
        `${field.attrs.id}: sichtbares Werkzeugfeld hat echtes Label`);
    assert(field.attrs.type === 'checkbox' || parsed.elements.some(n => (n.attrs.class || '').split(' ').includes('ds-field') && inside(field, n)),
        `${field.attrs.id}: Eingabefeld hat ds-field`);
}
assertEqual((html.match(/class="stress-replay-step"/g) || []).length, 3, 'Replay zeigt drei Abschnitte innerhalb einer äußeren Karte');

const second = fixture(); initWorkshopUI(second.doc); second.buttons[2].fire('click');
assert(!second.panels[2].hidden && !f.panels[0].hidden, 'Unabhängige Dokumente teilen keine Werkzeugauswahl');
assert(second.buttons.every(b => b.listeners.click.length === 1), 'Zweites Dokument erhält eigene einmalige Binder');

assert(!html.includes('ds-plan-card sim-optimize-section'), 'Optimize-Konfiguration bleibt innerhalb einer äußeren Karte ohne Kartenstapel');

// Alle drei Hosts sind direkte Geschwister unter dem vorhandenen Hauptreiter.
for (const id of ['workshopReplayPanel', 'tab-sweep', 'tab-auto-optimize']) {
    const panel = parsed.elements.find(node => node.attrs.id === id);
    assertEqual(panel.parent, workshop, id + ': kein verborgenes anderes Werkzeug als Ahn');
    for (let parent = panel.parent; parent; parent = parent.parent) {
        assert(!Object.hasOwn(parent.attrs, 'hidden') && !parent.attrs['data-workshop-panel'], id + ': Ahnen sind weder verborgen noch fremde Werkzeuge');
    }
}

// Der Browsercontroller verwendet absichtlich keinen querySelector.
const partial = fixture(); delete partial.doc.querySelector;
assert(openWorkshopReplay({ documentRef: partial.doc }), 'Partieller Browseradapter öffnet vorhandenen Replayhost ohne Einzelselektor');
assert(partial.mainPanels[4].classList.contains('active') && !partial.panels[0].hidden, 'Partieller Adapter aktiviert Hauptreiter und Replaypanel');
for (const corrupt of [{ getElementById: partial.doc.getElementById }, { ...partial.doc, querySelectorAll: () => null }]) {
    const before = JSON.stringify(partial.panels.map(panel => panel.hidden));
    assertEqual(openWorkshopReplay({ documentRef: corrupt }), false, 'Unbrauchbarer Adapter liefert false');
    assertEqual(JSON.stringify(partial.panels.map(panel => panel.hidden)), before, 'Unbrauchbarer Adapter verändert kein Panel teilweise');
}
