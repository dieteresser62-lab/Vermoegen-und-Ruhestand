import fs from "node:fs";
import { tokenizeHTML } from './funktionsinventar-contract.mjs';

// Bestand vor Slice 1: Ausnahmen sind an Quelle, Selektor und Deklaration gebunden.
export const PRIORITY_EXCEPTIONS = [
  [
    "Simulator.html",
    ".log-export-buttons button",
    "width: auto !important"
  ],
  [
    "Simulator.html",
    ".log-export-buttons button",
    "min-width: 0 !important"
  ],
  [
    "Simulator.html",
    ".log-export-buttons button",
    "flex: 0 0 auto !important"
  ],
  [
    "Simulator.html",
    ".ao-preset-btn:hover",
    "border-color: var(--secondary-color) !important"
  ],
  [
    "Simulator.html",
    ".form-grid, .form-grid-three-col, .form-grid-four-col, .form-grid-compact",
    "grid-template-columns: minmax(0, 1fr) !important"
  ],
  [
    "Simulator.html",
    ".care-sections, .care-section-grid, .care-duration-group, .care-grade-row",
    "grid-template-columns: minmax(0, 1fr) !important"
  ],
  [
    "depot-tranchen-manager.html",
    "[aria-invalid=\"true\"]",
    "border-color: var(--bad) !important"
  ],
  [
    "depot-tranchen-manager.html",
    "[aria-invalid=\"true\"]",
    "box-shadow: 0 0 0 3px var(--bad) !important"
  ],
  [
    "css/balance.css",
    ".input-error",
    "border-color: var(--danger-color) !important"
  ],
  [
    "css/balance.css",
    ".input-error",
    "box-shadow: 0 0 0 3px var(--bad) !important"
  ],
  [
    "css/balance.css",
    ".tab-panel",
    "display: block !important"
  ],
  [
    "simulator.css",
    ".mc-setup-disclosure:not([open]) > .mc-setup-content > :not(#mcButton)",
    "display: none !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "position: absolute !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "width: 1px !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "height: 1px !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "padding: 0 !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "margin: -1px !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "overflow: hidden !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "clip: rect(0, 0, 0, 0) !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "white-space: nowrap !important"
  ],
  [
    "simulator.css",
    ".visually-hidden",
    "border: 0 !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel[hidden], [data-stress-replay-comparison-panel][hidden]",
    "display: block !important"
  ],
  [
    "simulator.css",
    ".stress-replay-diagnostics > dl",
    "display: grid !important"
  ],
  [
    "simulator.css",
    ".mc-view-nav, .tab-buttons, .mc-settings-actions, .stress-replay-comparison-tabs, .stress-replay-expert-toggle, #mcShowReplayButton, #mcShowScenarioLogsButton",
    "display: none !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll",
    "width: auto !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll",
    "max-width: 100% !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll",
    "height: auto !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll",
    "max-height: none !important"
  ],
  [
    "simulator.css",
    "#mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll",
    "overflow: visible !important"
  ],
  [
    "simulator.css",
    "#tab-montecarlo th",
    "position: static !important"
  ],
  [
    "simulator.css",
    "#simulationLog table, #scenarioLogOutput table, .stress-replay-table-scroll table",
    "width: 100% !important"
  ],
  [
    "simulator.css",
    "#simulationLog table, #scenarioLogOutput table, .stress-replay-table-scroll table",
    "min-width: 0 !important"
  ],
  [
    "simulator.css",
    "#simulationLog th, #simulationLog td, #scenarioLogOutput th, #scenarioLogOutput td, .stress-replay-table-scroll th, .stress-replay-table-scroll td",
    "min-width: 0 !important"
  ],
  [
    "simulator.css",
    "#simulationLog th, #simulationLog td, #scenarioLogOutput th, #scenarioLogOutput td, .stress-replay-table-scroll th, .stress-replay-table-scroll td",
    "white-space: normal !important"
  ],
  // Eng gebundene Druckausnahmen für verschobene Replayahnen und geschlossenes Setup.
  ["simulator.css", "#tab-montecarlo, #tab-werkstatt, #workshopReplayPanel[hidden], #workshopReplayPanel, #tab-sweep, #tab-sweep[hidden], #tab-auto-optimize, #tab-auto-optimize[hidden]", "display: block !important"],
  ["simulator.css", ".sim-workshop-cards", "display: none !important"],
  ["simulator.css", "#stressReplayExpertFields[hidden]", "display: grid !important"],
  ["simulator.css", "#tab-werkstatt .ds-table-scroll, #tab-werkstatt .ds-tool-output", "overflow: visible !important"],
  ["simulator.css", "#tab-werkstatt .ds-table-scroll, #tab-werkstatt .ds-tool-output", "max-height: none !important"],
  ["simulator.css", "#tab-werkstatt > .sim-page-head, #tab-werkstatt button", "display: none !important"],
  ["simulator.css", "#mcSetupDisclosure::details-content, .stress-replay-diagnostics::details-content", "display: contents !important"],
  ["simulator.css", "#mcSetupDisclosure::details-content, .stress-replay-diagnostics::details-content", "content-visibility: visible !important"],
  ["simulator.css", "#mcSetupDisclosure:not([open]) > .mc-setup-content > :not(button)", "display: block !important"],
  ["simulator.css", "#mcSetupDisclosure:not([open]) > .mc-setup-content", "display: grid !important"],
  ["simulator.css", "#tab-montecarlo .kpi-description, #tab-montecarlo .summary-description", "display: block !important"],
  ["simulator.css", ".mc-more-metrics > :not(summary)", "display: block !important"],
  ["simulator.css", ".mc-more-metrics::details-content", "display: contents !important"],
  ["simulator.css", ".mc-more-metrics::details-content", "content-visibility: visible !important"],
  ["simulator.css", "#tab-montecarlo .ds-info, .mc-settings-actions, #mcRunHead button, #mcSetupDisclosure #mcRecalculateButton", "display: none !important"],
  ["simulator.css", ".ds-info-pop", "display: none !important"],
  ["simulator.css", ".stress-replay-table-scroll th", "position: static !important"]
];

export const PAGES = ['Ausgaben.html', 'Daten-Sicherung.html', 'Balance.html', 'Simulator.html', 'index.html', 'Handbuch.html', 'depot-tranchen-manager.html'];
export const BALANCE_RENDERERS = ['annual-marketdata', 'annual-modal', 'diagnosis-keyparams', 'expenses-renderer', 'main-profile-sync', 'renderer-action', 'renderer-summary'].map(name => `app/balance/balance-${name}.js`);
export const SIMULATOR_FIELD_RENDERERS = ['monte-carlo-ui', 'simulator-main-3bucket', 'simulator-main-accumulation', 'simulator-main-dynamic-flex', 'simulator-main-partner', 'simulator-main-profiles', 'simulator-main-rent-adjust', 'simulator-portfolio-display', 'simulator-ui-pflege', 'simulator-ui-rente'].map(name => `app/simulator/${name}.js`);
export const SIMULATOR_RESULT_RENDERERS = ['results-renderers', 'simulator-results', 'stress-replay-renderer', 'simulator-result-overview'].map(name => `app/simulator/${name}.js`);
export const TOOL_RENDERERS = ['auto-optimize-renderer', 'auto_optimize_ui', 'simulator-heatmap', 'simulator-main-sweep-selftest', 'simulator-main-sweep-ui', 'simulator-optimizer', 'simulator-portfolio-chart', 'simulator-sweep', 'simulator-ui-pflege', 'simulator-visualization'].map(name => `app/simulator/${name}.js`);
export const MANAGER_RENDERERS = ['app/profile/profile-asset-values.js', 'app/profile/profile-recovery-ui.js', ...['depot-tranchen-status', 'tranchen-manager-modal', 'tranchen-manager-page', 'tranchen-manager-profiles', 'tranchen-manager-renderer', 'tranchen-manager-sale-dialog'].map(name => `app/tranches/${name}.js`)];
export const SOURCE_PATHS = [...new Set([...PAGES, 'css/daten-sicherung.css', 'app/data/data-renderer.js', 'app/balance/balance-storage.js', 'app/balance/balance-reader.js', 'app/profile/profilverbund-balance-ui.js', 'app/shared/security-utils.js', 'app/simulator/simulator-backtest.js', 'app/simulator/simulator-main-init.js', 'app/profile/profile-manager.js', 'app/profile/profile-manager-bindings.js', 'app/profile/profile-recovery-ui.js', 'app/tranches/tranchen-manager-profiles.js', 'app/tranches/tranchen-startup-prices.js', 'css/personen-vermoegen.css', 'css/overview.css', 'app/overview/overview-renderer.js', 'app/shared/designsystem-selection-text.js', 'app/shared/designsystem-number-format.js', 'app/balance/balance-wealth-history-renderer.js', 'app/balance/balance-wealth-history-metrics.js', 'app/balance/balance-expenses-history-renderer.js', 'css/suite-frame.css', 'css/tokens.css', 'css/fonts.css', 'css/balance.css', 'simulator.css', 'app/balance/balance-main.js', 'app/shared/designsystem-icons.js', 'css/components.css', 'app/shared/field-state.js', 'app/shared/designsystem-chart-colors.js', ...BALANCE_RENDERERS, ...SIMULATOR_FIELD_RENDERERS, ...SIMULATOR_RESULT_RENDERERS, ...TOOL_RENDERERS, ...MANAGER_RENDERERS])];
export const COLORS = {
    page: '#f1f2ee', surface: '#ffffff', 'surface-sunken': '#f4f5f1',
    'text-main': '#1d2830', 'text-muted': '#56626a', accent: '#7a5a1f',
    'accent-soft': '#f2e9d4', 'accent-line': '#b8954f', good: '#2b6e50',
    'good-soft': '#dcefe5', warn: '#8a5a12', 'warn-soft': '#f6e7cc',
    bad: '#9c3b33', 'bad-soft': '#f5dcd8', border: '#d8dbd3', 'border-strong': '#c3c8bf'
};
export const CONTRAST_PAIRS = [
    ...['text-main', 'text-muted'].flatMap(fg => ['page', 'surface', 'surface-sunken', 'accent-soft', 'good-soft', 'warn-soft', 'bad-soft'].map(bg => [fg, bg])),
    ...['accent', 'good', 'warn', 'bad'].flatMap(fg => ['page', 'surface', 'surface-sunken', `${fg}-soft`].map(bg => [fg, bg])),
    ...['text-main', 'accent', 'good', 'warn', 'bad'].map(bg => ['surface', bg])
];

// Grundbild aus Slice 1; Komponenten aus Slice 2 werden separat validiert.
export const FOUNDATION_ROLES = {
    'css/components.css': { '.ds-plan-card': [null, 'surface'] },
    'css/balance.css': { body: ['text-main', 'page'], '#btnJahresUpdate': ['text-main', 'surface'], '.btn.ds-button-primary': ['surface', 'text-main'], '.tranchen-warning': ['warn', null] },
    'simulator.css': { body: ['text-main', 'page'], '.panel': [null, 'surface'], fieldset: [null, 'surface-sunken'], 'button:not([class*="ds-"]):not(.tab-btn):not(.scenario-list-item)': ['surface', 'text-main'], 'button:not([class*="ds-"]):not(.tab-btn):not(.scenario-list-item):disabled': ['text-muted', 'surface-sunken'], '.tranchen-warning': ['warn', null] },
    'css/overview.css': { '.overview-page': ['text-main', null], '.overview-pill': ['text-main', 'surface'] },
    'Handbuch.html': { body: ['text-main', 'page'], '.hb-article': [null, 'surface'], '.hb-search': [null, 'surface'], '.step-number': ['surface', 'text-main'] },
    'css/suite-frame.css': { '.suite-header': [null, 'surface'], '.suite-brand': ['text-main', null], '.suite-navigation': [null, 'surface'], '.suite-navigation a': ['text-main', null], '.suite-navigation a[aria-current="page"]': [null, 'surface-sunken'], '.suite-navigation-status': ['bad', 'surface'] },
    'depot-tranchen-manager.html': { body: ['text-main', 'page'], '.container': [null, 'surface'], '.stat-card': ['text-main', 'surface-sunken'], '.stat-label': ['text-muted', null], '.btn-primary': ['surface', 'text-main'], '.btn-success': ['surface', 'good'], '.btn-danger': ['surface', 'bad'], '.btn-secondary': ['surface', 'text-main'], 'button:disabled': ['text-muted', 'surface-sunken'] }
};
const PARENT_SELECTORS = ['html', 'body', '*', '.main-layout', '.form-column', '.container', '.hero', '.page-header', '.apps-grid', '.overview-heading p'];
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
export function readSources() {
    return Object.fromEntries(SOURCE_PATHS.map(path => [path, fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]));
}

const STATES = ['adopted', 'editable', 'inactive', 'empty', 'unrated', 'warning', 'error'];
export const COMPONENT_CLASSES = ['ds-button', 'ds-button-primary', 'ds-button-secondary', 'ds-button-quiet', 'ds-button-danger', 'ds-icon-button', 'ds-input', 'ds-select', 'ds-checkbox', 'ds-card', 'ds-card-warning', 'ds-card-error', 'ds-tab', 'ds-table', 'ds-table-scroll', 'ds-note', 'ds-note-warning', 'ds-note-error', 'ds-badge', 'ds-metrics', 'ds-metric', 'ds-metric-primary'];
function validateNavigationGuardPresentation(sources) {
    const errors = [];
    const parsed = rules('css/components.css', sources['css/components.css']);
    // Die Basisregel steht vor der gesonderten Druckregel; nicht per Object.fromEntries zusammenfalten.
    for (const [selector, expected] of [
        ['.navigation-guard-dialog', { margin: 'auto', padding: 'var(--space-6)', color: 'var(--text-main)', background: 'var(--surface)' }],
        ['.navigation-guard-dialog::backdrop', { background: 'var(--backdrop)' }]
    ]) {
        const base = parsed.find(rule => rule.selector === selector);
        for (const [property, value] of Object.entries(expected)) {
            if (base?.declarations[property] !== value) errors.push(`Navigationsdarstellung: ${selector} ${property} muss ${value} sein`);
        }
    }
    return errors;
}
export function validateComponents(sources) {
    const errors = validateNavigationGuardPresentation(sources);
    const check = (condition, message) => { if (!condition) errors.push(message); };
    const css = sources['css/components.css'];
    for (const name of COMPONENT_CLASSES) check(css.includes(`.${name}`), `Komponente fehlt: ${name}`);
    check(/:focus-visible\s*\{[^}]*outline:\s*var\(--ring-width\) solid var\(--ring-color\);[^}]*outline-offset:\s*var\(--ring-offset\)/s.test(css), 'Tokenbasierter Fokusring fehlt');
    for (const page of PAGES) {
        const loads = [...sources[page].split('</head>')[0].matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>|<style\b/gi)].map(m => m[0]);
        check(loads[2]?.includes('href="css/components.css"'), `Komponenten-Ladefolge: ${page}`);
    }
    for (const state of STATES) {
        check(css.includes(`[data-field-state="${state}"]`), `Zustandsstil fehlt: ${state}`);
        check(sources['app/shared/field-state.js'].includes(`'${state}'`), `Zustandsvertrag fehlt: ${state}`);
    }
    for (const [path, source] of Object.entries(sources)) {
        for (const match of source.matchAll(/data-field-state\s*=\s*["']([^"']+)["']/g)) {
            check(STATES.includes(match[1]), `Ungültiger Zustandswert: ${path} ${match[1]}`);
        }
        for (const match of source.matchAll(/<button\b([^>]*class=["'][^"']*\bds-icon-button\b[^"']*["'][^>]*)>/gi)) {
            check(/aria-label=["'][^"']*\S[^"']*["']/.test(match[1]), `Namenlose Symboltaste: ${path}`);
        }
        for (const match of source.matchAll(/\w+\.className\s*=\s*(['"])([^'"']*\bds-icon-button\b[^'"']*)\1/g)) {
            const name = match[0].split('.')[0];
            check(new RegExp(`${name}\\.setAttribute\\(['"]aria-label['"],\\s*['"][^'"]*\\S[^'"]*['"]\\)`).test(source) || new RegExp(`${name}\\.ariaLabel\\s*=\\s*['"][^'"]*\\S[^'"]*['"]`).test(source), `Namenlose Symboltaste: ${path} ${name}`);
        }
    }
    for (const path of ['css/components.css', 'css/overview.css', 'index.html', 'Handbuch.html']) {
        for (const rule of rules(path, sources[path])) {
            check(rule.declarations.opacity === undefined || Number(rule.declarations.opacity) === 1, `Text-/Elterndeckkraft: ${path} ${rule.selector}`);
            if (rule.declarations.color) {
                check(/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(rule.declarations.color), `Nichttokenisierte Textfarbe: ${path} ${rule.selector}`);
                try {
                    const foreground = resolveValue(rule.declarations.color, { ...variables(sources['css/tokens.css']), ...variables(cssSource(path, sources[path])) });
                    check(!/rgba?\(|transparent|color-mix/i.test(foreground), `Transparente Textfarbe: ${path} ${rule.selector}`);
                } catch { /* Fehlende Aliase werden im Grundlagenvertrag diagnostiziert. */ }
            }
        }
        const source = withoutComments(sources[path]);
        for (const match of source.matchAll(/style=["']([^"']*)["']/g)) {
            check(!/opacity\s*:\s*(?:0?\.\d+|0)\b/.test(match[1]), `Inline-Textdeckkraft: ${path}`);
            for (const color of match[1].matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)) check(/^var\(--[\w-]+\)$/.test(color[1].trim()), `Nichttokenisierte Inline-Textfarbe: ${path}`);
        }
        check(!/\.style\.opacity\s*=|opacity\s*:\s*(?:0?\.\d+|0)\b/.test(source), `JS-Textdeckkraft: ${path}`);
    }
    return errors;
}

// Kleine DOM-Doppel für Node-Darstellungstests; echte DOM-Abnahme im Browserfall.
export function createPresentationTestDocument() {
    const doc = {
        nodes: [],
        createElement(tagName) { const node = new Element(tagName); this.nodes.push(node); return node; },
        createTextNode(text) { const node = this.createElement('#text'); node.textContent = text; return node; },
        createDocumentFragment() { return this.createElement('#fragment'); },
        getElementById(id) { return this.nodes.find(node => node.id === id) || null; },
        querySelector(selector) { return selector === '.hero' ? this.hero : null; }
    };
    class Element {
        constructor(tagName) {
            this.tagName = tagName; this.ownerDocument = doc; this.children = []; this.attributes = new Map();
            this.style = {}; this.dataset = {}; this.events = new Map(); this.writes = 0; this.textContent = ''; this.className = '';
        }
        get id() { return this.getAttribute('id') || ''; }
        set id(value) { this.setAttribute('id', value); }
        get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
        getAttribute(name) { return this.attributes.get(name) ?? null; }
        hasAttribute(name) { return this.attributes.has(name); }
        setAttribute(name, value) { this.writes++; this.attributes.set(name, String(value)); }
        removeAttribute(name) { this.writes++; this.attributes.delete(name); }
        appendChild(node) { return this.insertBefore(node, null); }
        append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
        replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); }
        replaceChild(node, old) { this.insertBefore(node, old); old.remove(); return old; }
        cloneNode() {
            const node = doc.createElement(this.tagName);
            node.className = this.className; node.textContent = this.textContent;
            for (const [name, value] of this.attributes) node.setAttribute(name, value);
            return node;
        }
        insertBefore(node, next) {
            node.remove(); this.writes++;
            const index = next ? this.children.indexOf(next) : this.children.length;
            if (index < 0) throw new Error('Unbekannter Nachbarknoten');
            this.children.splice(index, 0, node); node.parentNode = this; return node;
        }
        remove() {
            if (this.parentNode) {
                this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
                this.parentNode.writes++; this.parentNode = null;
            }
        }
        addEventListener(type, handler) { this.events.set(type, handler); }
        click() { this.clickCount = (this.clickCount || 0) + 1; this.events.get('click')?.(); }
    }
    doc.body = doc.createElement('body');
    return doc;
}
function cssSource(path, source) {
    return path.endsWith('.html') ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n') : source;
}
export function rules(path, source) {
    return [...withoutComments(cssSource(path, source)).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
        selector: m[1].trim().replace(/\s+/g, ' '),
        entries: m[2].split(';').filter(d => d.includes(':')).map(d => {
            const colon = d.indexOf(':');
            return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
        }),
        declarations: Object.fromEntries(m[2].split(';').filter(d => d.includes(':')).map(d => {
            const colon = d.indexOf(':');
            return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
        }))
    }));
}
export function variables(source) {
    return Object.fromEntries([...withoutComments(source).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(m => [m[1], m[2].trim()]));
}

// Lokale Quellgegenprobe; tatsächliche Geometrie und Bedienung prüft der Browser.
export function validateBalanceSimulatorRefinement(sources) {
    const errors = [];
    const declarations = (path, selector) => Object.assign({}, ...rules(path, sources[path])
        .filter(rule => rule.selector === selector).map(rule => rule.declarations));
    for (const [selector, expected] of [
        ['.sim-toggle-row > input', { width: '1px', height: '1px', 'clip-path': 'inset(50%)', border: '0' }],
        ['.sim-toggle-row', { border: '0', background: 'transparent' }],
        ['.sim-toggle-row small', { display: 'block', color: 'var(--text-muted)' }],
        ['#simProfileList [data-profile-role-id]', { 'white-space': 'nowrap', 'overflow-wrap': 'normal', flex: '0 0 auto' }],
        ['.sim-field-grid > .sim-dynamic-flex-field', { 'grid-column': '1 / -1' }],
        ['.sim-dynamic-flex-field .sim-select-segment > button', { 'white-space': 'nowrap' }],
        ['.sim-parameters[hidden]', { display: 'none' }],
        ['.sim-result-grid .sim-outcome-metrics > .ds-row', { display: 'grid', 'grid-template-rows': 'subgrid', 'grid-row': 'span 3', 'align-items': 'start' }],
        ['.sim-result-grid .sim-cut-note', { display: 'block', margin: '0', padding: '0', border: '0', 'border-radius': '0', background: 'transparent', color: 'var(--text-muted)', 'font-size': 'var(--balance-help)' }],
        ['.sim-backtest-grid .sim-backtest-chart', { 'grid-column': '1 / -1', width: '100%' }]
    ]) {
        const actual = declarations('simulator.css', selector);
        for (const [property, value] of Object.entries(expected)) {
            if (actual[property] !== value) errors.push(`${selector}: ${property} muss ${value} sein`);
        }
    }
    const input = declarations('simulator.css', '.sim-toggle-row > input');
    if (input.inset || input['z-index']) errors.push('Schalterinput überlagert die Zeile');
    const caption = declarations('css/balance.css', '.balance-action-table caption');
    if (caption['clip-path'] !== 'inset(50%)' || caption.display || caption.visibility) errors.push('Dialogcaption muss nur visuell verborgen sein');
    const hot = declarations('css/balance.css', '.balance-market-segment.phase-0');
    const peak = declarations('css/balance.css', '.balance-market-segment.phase-1, .balance-market-segment.phase-2');
    if (hot.background !== 'var(--warn-soft)' || hot['--phase-color'] !== 'var(--warn)' || peak.background !== 'var(--good-soft)' || peak['--phase-color'] !== 'var(--good)') errors.push('Warn- und Zielstatusfarben der Marktphasen weichen ab');
    return errors;
}
export function resolveValue(value, vars, visited = []) {
    return value.replace(/var\(\s*(--[\w-]+)(?:\s*,\s*([^()]*))?\s*\)/g, (_, name, fallback) => {
        if (visited.includes(name)) throw new Error(`Aliaszyklus: ${name}`);
        if (!(name in vars)) throw new Error(`Fehlender Alias: ${name}`);
        return resolveValue(vars[name] ?? fallback, vars, [...visited, name]);
    });
}
export function contrast(foreground, background) {
    const luminance = hex => {
        const channels = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
// Begrenzte Kaskadenprobe am realen Dialogbaum (kein Browserersatz).
// Erfasst Tags, Klassen, Kennungen, Attribute, :is, Kind-/Nachfahrenselektoren
// sowie Spezifität, Priorität, Vererbung und tatsächliche Stylesheetreihenfolge.
export function validatePageChoiceTypography(sources) {
    const errors = [];
    const expand = selector => {
        const match = selector.match(/:is\(([^()]*)\)/);
        return match ? match[1].split(',').flatMap(part => expand(selector.replace(match[0], part.trim()))) : selector.split(',').map(s => s.trim());
    };
    const simpleMatches = (selector, node) => {
        selector = selector.replace(':root', 'html');
        if (/[:()+~]/.test(selector)) return false;
        const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
        if (tag && tag !== node.tag) return false;
        for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
        for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!node.classes.includes(name)) return false;
        for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
            if (!(name in node.attrs) || value !== undefined && node.attrs[name] !== value) return false;
        }
        return true;
    };
    const matches = (selector, node) => {
        const parts = selector.replace(/\s*>\s*/g, ' > ').split(/\s+/);
        let current = node;
        if (!simpleMatches(parts.pop(), current)) return false;
        while (parts.length) {
            const direct = parts.at(-1) === '>';
            if (direct) parts.pop();
            const part = parts.pop(); current = current.parent;
            if (!direct) while (current && !simpleMatches(part, current)) current = current.parent;
            if (!current || !simpleMatches(part, current)) return false;
        }
        return true;
    };
    const specificity = selector => {
        const ids = (selector.match(/#[\w-]+/g) || []).length;
        const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
        const tags = (selector.replace(/\[[^\]]+\]|[.#][\w-]+/g, '').match(/\b[a-z][\w-]*\b/gi) || []).length;
        return ids * 10000 + classes * 100 + tags;
    };
    for (const page of ['index.html', 'Balance.html', 'Simulator.html', 'depot-tranchen-manager.html']) {
        const html = sources[page];
        const attrs = tag => Object.fromEntries([...(html.match(new RegExp('<' + tag + '\\b[^>]*>'))?.[0] || '').matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        const node = (tag, parent, classes = [], id = '', attributes = {}) => ({ tag, parent, classes, id, attrs: attributes });
        const root = node('html', null, [], '', attrs('html'));
        const body = node('body', root, (attrs('body').class || '').split(/\s+/));
        const dialog = node('dialog', body, ['page-choice-dialog', 'ds-plan-card'], 'pageChoiceDialog');
        const card = node('label', node('fieldset', dialog, ['page-choice-group']), ['page-choice-card']);
        const cases = [[dialog, 'var(--text-base)'], [node('p', dialog, [], 'pageChoiceDescription'), 'var(--text-base)'],
            [card, 'var(--text-base)'], [node('span', card), 'var(--text-base)'],
            [node('h2', dialog, [], 'pageChoiceTitle'), 'var(--text-title)'],
            [node('button', node('div', dialog, ['ds-actions']), ['ds-button', 'ds-button-primary']), 'var(--text-sm)']];
        const ordered = [...html.matchAll(/<link[^>]*href="([^"]+)"[^>]*>|<style[^>]*>([\s\S]*?)<\/style>/g)]
            .flatMap(m => rules(m[1] || page, m[1] ? sources[m[1]] || '' : m[2]));
        const size = target => {
            let winner = null, order = 0;
            for (const rule of ordered) for (const selector of expand(rule.selector)) {
                order++;
                const value = rule.declarations['font-size'] || rule.declarations.font?.match(/var\(--[\w-]+\)|\d+(?:\.\d+)?(?:px|rem|em)/)?.[0];
                if (!value || !matches(selector, target)) continue;
                const score = (value.includes('!important') ? 1000000 : 0) + specificity(selector);
                if (!winner || score > winner.score || score === winner.score && order > winner.order) winner = { value: value.replace(/\s*!important/, ''), score, order };
            }
            return winner?.value === 'inherit' || !winner ? target.parent && size(target.parent) : winner.value;
        };
        for (const [target, expected] of cases) {
            const actual = size(target);
            if (actual !== expected) errors.push(`Seitendialog: wirksame Options-/Textschrift ${page}/${target.tag} erwartet ${expected}, ist ${actual}`);
        }
    }
    return errors;
}

export function validateFoundation(sources) {
    const errors = validatePageChoiceTypography(sources);
    const check = (condition, message) => { if (!condition) errors.push(message); };
    const dialogRules = rules('css/components.css', sources['css/components.css']);
    const dialogHas = (selector, property, value) => dialogRules.some(rule => rule.selector === selector && rule.declarations[property] === value);
    for (const [selector, property, value] of [
        ['.page-choice-dialog', 'inset', '0'], ['.page-choice-dialog', 'margin', 'auto'],
        ['.page-choice-dialog', 'font-family', 'var(--font-sans)'], ['.page-choice-dialog', 'font-size', 'var(--text-base)'],
        ['.page-choice-dialog h2', 'font-family', 'var(--font-serif)'], ['.page-choice-dialog h2', 'font-size', 'var(--text-title)'],
        ['.page-choice-dialog button', 'font-size', 'var(--text-sm)'],
        ['.page-choice-dialog label.page-choice-card', 'font-size', 'var(--text-base)'],
        ['.page-choice-dialog .page-choice-card > span', 'font-size', 'var(--text-base)'],
        ['.page-choice-dialog .ds-actions', 'display', 'flex'], ['.page-choice-dialog .ds-actions', 'gap', 'var(--space-3)']
    ]) check(dialogHas(selector, property, value), `Seitendialog: ${property} in ${selector} fehlt`);
    const tokens = variables(sources['css/tokens.css']);
    const backdropDefinitions = rules('css/tokens.css', sources['css/tokens.css'])
        .flatMap(rule => rule.entries.filter(([name]) => name === '--backdrop').map(([, value]) => ({ selector: rule.selector, value })));
    check(backdropDefinitions.length === 1 && backdropDefinitions[0].selector === ':root'
        && backdropDefinitions[0].value === 'color-mix(in srgb, var(--text-main) 45%, transparent)', 'Grafiktoken: --backdrop muss einmal kanonisch in :root definiert sein');
    for (const [name, color] of Object.entries(COLORS)) check(tokens[`--${name}`] === color, `Tokenwert: ${name}`);
    for (const page of PAGES) {
        const head = sources[page].split('</head>')[0];
        const loads = [...head.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>|<style\b/gi)].map(m => m[0]);
        check(loads[0]?.includes('href="css/tokens.css"') && loads[1]?.includes('href="css/fonts.css"'), `Ladefolge: ${page}`);
    }
    for (const [path, source] of Object.entries(sources)) {
        check(!/(?:https?:)?\/\/[^\s"'<>)]*(?:fonts\.|\.woff2?|\.ttf|\.otf|lucide|icons?\b)|@import\b|(?:src|href)\s*=\s*["']https?:[^"']*\.(?:svg|css)["']/i.test(withoutComments(source)), `Externe Font-/Symbolquelle: ${path}`);
        check(!/designsystem-overlay|ds-overlay|prototyp\//i.test(withoutComments(source)), `Designoverlay: ${path}`);
        const vars = { ...tokens, ...variables(sources['css/components.css']), ...variables(cssSource(path, source)) };
        if (path !== 'css/tokens.css') {
            for (const name of Object.keys(variables(cssSource(path, source)))) check(!(name in tokens), `Tokenüberschreibung: ${path} ${name}`);
        }
        const context = path === 'Balance.html' || path.startsWith('app/balance/') ? { ...tokens, ...variables(sources['css/components.css']), ...variables(sources['css/balance.css']) } : path === 'Simulator.html' || path.startsWith('app/simulator/') ? { ...tokens, ...variables(sources['css/components.css']), ...variables(sources['simulator.css']) } : vars;
        try {
            for (const value of Object.values(vars)) resolveValue(value, vars);
            for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) resolveValue(`var(${match[1]})`, context);
        } catch (error) { errors.push(`Alias: ${path} ${error.message}`); }
        const parsed = rules(path, source);
        const exceptions = PRIORITY_EXCEPTIONS.filter(e => e[0] === path).map(e => `${e[1]}|${e[2]}`);
        for (const rule of parsed) {
            for (const [property, value] of rule.entries) {
                if (/!\s*important/i.test(value)) {
                    const signature = `${rule.selector}|${property}: ${value}`;
                    const index = exceptions.indexOf(signature);
                    check(index !== -1, `Zusätzliche Priorität: ${path} ${signature}`);
                    if (index !== -1) exceptions.splice(index, 1);
                }
            }
            const migrated = rule.selector.split(',').some(selector => PARENT_SELECTORS.includes(selector.trim()) || selector.trim() in (FOUNDATION_ROLES[path] || {}) || /(?:^|\s)h[1-4](?:$|[ :])/.test(selector) || ['.app-title', '.btn', 'input', 'select'].includes(selector.trim()));
            if (migrated) {
                const opacity = rule.declarations.opacity;
                check(opacity === undefined || Number(opacity) === 1, `Textdeckkraft: ${path} ${rule.selector}`);
                try {
                    check(!/rgba\([^)]*,\s*(?:0?\.\d+|0)\s*\)|transparent|color-mix/i.test(resolveValue(rule.declarations.color || '', vars)), `Textfarbe mit Deckkraft: ${path} ${rule.selector}`);
                } catch { /* Aliasdiagnose oben. */ }
            }
        }
        // Zusätzliche Priorität auch in Inline-Attributen und JS-Zuweisungen verhindern.
        if (path.endsWith('.html')) {
            const rest = source.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            check(!/!\s*important/i.test(rest), `Inline-Priorität: ${path}`);
            check(!/style=["'][^"']*opacity\s*:\s*(?:0?\.\d+|0)(?:\s*;|["'])/i.test(rest), `Inline-Textdeckkraft: ${path}`);
        }
        if (path === 'app/balance/balance-main.js') {
            check(!/\.style\.opacity\s*=|opacity\s*:/i.test(source), `JS-Textdeckkraft: ${path}`);
            for (const [target, fg, bg] of [['alertBanner', 'bad', 'bad-soft'], ['target', 'warn', 'warn-soft']]) {
                check(source.includes(`${target}.style.color = 'var(--${fg})'`) && source.includes(`${target}.style.backgroundColor = 'var(--${bg})'`), `JS-Kontrastpaar: ${target}`);
            }
        }
        if (path === 'Balance.html') check(/id="engine-version-alert"[^>]*style="[^"']*background-color: var\(--warn-soft\); color: var\(--warn\);/.test(source), 'Inline-Kontrastpaar: Balance-Startmeldung');
        for (const [selector, [fg, bg]] of Object.entries(FOUNDATION_ROLES[path] || {})) {
            const declarations = parsed.find(rule => rule.selector === selector)?.declarations || {};
            for (const [property, expected] of [['color', fg], ['background', bg]]) {
                if (!expected) continue;
                const value = declarations[property] ?? declarations[`${property}-color`];
                try { check(value?.includes('var(') && resolveValue(value, vars) === COLORS[expected], `Grundrolle/Kontrast: ${path} ${selector} ${property}`); }
                catch { errors.push(`Grundrolle/Alias: ${path} ${selector}`); }
            }
        }
    }
    for (const [fg, bg] of CONTRAST_PAIRS) check(contrast(tokens[`--${fg}`] || '#ffffff', tokens[`--${bg}`] || '#ffffff') >= 4.5, `Kontrast: ${fg}/${bg}`);
    for (const alias of ['input-bg', 'card-shadow', 'text-color', 'hover-color', 'green-text', 'amber-text', 'red-text']) check(alias && `--${alias}` in variables(sources['css/balance.css']), `Balance-Alias: ${alias}`);
    const faces = rules('css/fonts.css', sources['css/fonts.css']).filter(rule => rule.selector === '@font-face');
    const expectedFaces = [
        ['Newsreader', 'newsreader', 400, 'normal'], ['Newsreader', 'newsreader', 500, 'normal'], ['Newsreader', 'newsreader', 400, 'italic'],
        ['IBM Plex Sans', 'ibm-plex-sans', 400, 'normal'], ['IBM Plex Sans', 'ibm-plex-sans', 500, 'normal'], ['IBM Plex Sans', 'ibm-plex-sans', 600, 'normal'],
        ['IBM Plex Mono', 'ibm-plex-mono', 400, 'normal'], ['IBM Plex Mono', 'ibm-plex-mono', 500, 'normal']
    ];
    check(faces.length === 8, 'Acht lokale Fontfaces');
    for (const [family, slug, weight, style] of expectedFaces) {
        const face = faces.find(rule => rule.declarations['font-family'] === `"${family}"` && rule.declarations['font-weight'] === String(weight) && rule.declarations['font-style'] === style)?.declarations;
        const asset = `../assets/fonts/${slug}-latin-${weight}-${style}.woff2`;
        check(face?.src === `url("${asset}") format("woff2")` && face?.['font-display'] === 'swap', `Fontface: ${slug} ${weight} ${style}`);
        check(fs.existsSync(new URL(`../assets/fonts/${slug}-latin-${weight}-${style}.woff2`, import.meta.url)), `Fontdatei: ${asset}`);
    }
    return errors;
}

// Slice 3: genau benannte Balance-Textconsumer; Grafikpalette folgt in Slice 6.
export function validateBalance(sources) {
    const errors = [];
    const check = (ok, message) => { if (!ok) errors.push(message); };
    const css = sources['css/balance.css'].replace(/@media print\s*\{[\s\S]*?\n\}/g, '');
    for (const rule of rules('css/balance.css', css)) {
        if (rule.declarations.color) {
            check(/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(rule.declarations.color), `Balance-Textfarbe: ${rule.selector}`);
        }
        const opacity = rule.declarations.opacity;
        const graphic = ['.basiswerte-divider'].includes(rule.selector);
        const hiddenTooltip = rule.selector === '.help-tooltip .tooltip-text' && rule.declarations.visibility === 'hidden' && Number(opacity) === 0;
        check(opacity === undefined || Number(opacity) === 1 || graphic || hiddenTooltip, `Balance-Textdeckkraft: ${rule.selector}`);
    }
    for (const path of ['Balance.html', 'app/balance/balance-main.js', ...BALANCE_RENDERERS]) {
        const source = withoutComments(sources[path]);
        check(!/\.style\.opacity\s*=|opacity\s*:\s*(?:0?\.\d+|0)\b/.test(source), `Balance-JS-/Inline-Deckkraft: ${path}`);
        for (const color of source.matchAll(/\.style\.color\s*=\s*(['"])([^'"]+)\1/g)) {
            check(/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(color[2]), `Balance-JS-Textfarbe: ${path}`);
        }
        for (const color of source.matchAll(/(?:^|[;"'])\s*color\s*:\s*([^;"']+)/g)) {
            check(/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(color[1].trim()), `Balance-Inline-Textfarbe: ${path}`);
        }
    }
    for (const name of ['ds-input', 'ds-select', 'ds-checkbox', 'ds-button', 'ds-tab', 'ds-card']) {
        check(sources['Balance.html'].includes(name), `Balance-Rolle fehlt: ${name}`);
    }
    return errors;
}

// Slice 4: Feldconsumer und erzeugte Startallokation, keine Werkzeugpalette.
export function validateSimulatorFields(sources) {
    const errors = [];
    for (const path of SIMULATOR_FIELD_RENDERERS) {
        const source = withoutComments(sources[path]);
        if (/\.style\.opacity\s*=|opacity\s*:\s*(?:0?\.\d+|0)\b/.test(source)) errors.push(`Feld-Textdeckkraft: ${path}`);
        if (/#[\da-f]{3,8}\b|rgba?\(/i.test(source)) errors.push(`Feldfarbe ohne Token: ${path}`);
    }
    for (const match of sources['Simulator.html'].matchAll(/<(input|select)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
        // Attributwerte dürfen Schrägstriche enthalten; außerhalb ist nur der Abschluss zulässig.
        const attributes = match[2].replace(/=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, '');
        if (/\/\s*\S/.test(attributes)) errors.push(`Simulator-Feldsyntax: Schrägstrich vor weiteren Attributen: ${match[0]}`);
        if (/type="hidden"/.test(match[2])) continue;
        const role = match[1] === 'select' ? 'ds-select' : /type="(?:checkbox|radio)"/.test(match[2]) ? 'ds-checkbox' : 'ds-input';
        if (!new RegExp(`class="[^"]*\\b${role}\\b`).test(match[2])) errors.push(`Simulator-Feldrolle fehlt: ${match[0]}`);
    }
    const portfolio = sources['app/simulator/simulator-portfolio-display.js'];
    if (!portfolio.includes('calculated-display ds-metric')) errors.push('Startallokation: additive Kennzahlrolle fehlt');
    return errors;
}

// Slice 5: Ergebnistext und erzeugtes Markup; Grafik-/Werkzeugpalette folgt in Slice 6.
export function validateSimulatorResultMarkup(html) {
    const errors = [];
    for (const tag of html.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
        const classes = tag[2].match(/class="([^"]*)"/)?.[1].split(/\s+/) || [];
        const has = name => classes.includes(name);
        const requireRole = name => { if (!has(name)) errors.push(`Ergebnisrolle fehlt: ${classes.join(' ')} ${name}`); };
        if (has('kpi-card') || has('summary-item') || has('stress-replay-highlight')) {
            requireRole('ds-card'); requireRole('ds-metric');
        }
        if (has('stress-replay-table-scroll')) requireRole('ds-table-scroll');
        if (tag[1] === 'table') requireRole('ds-table');
        if (tag[1] === 'button') requireRole(/role="tab"/.test(tag[2]) ? 'ds-tab' : 'ds-button');
        if (has('stress-replay-message')) requireRole('ds-note');
        if (has('stress-replay-message-error')) requireRole('ds-note-error');
        if (has('stress-replay-message-warning')) requireRole('ds-note-warning');
    }
    for (const style of html.matchAll(/style="([^"]*)"/g)) {
        for (const [, prop, value] of style[1].matchAll(/(?:^|;)\s*(color|background(?:-color)?|border-color|opacity)\s*:\s*([^;]+)/g)) {
            if (prop === 'opacity' ? Number(value) !== 1 : !/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(value.trim())) errors.push(`Ergebnis-Inline-Stil: ${prop} ${value}`);
        }
    }
    return errors;
}
export function validateSimulatorResults(sources, fragments = []) {
    const errors = [];
    const scoped = selector => /(?:summary-|kpi-|unified-kpi|drawdown-pair|reporting-reference|details-card|simulationLog|scenarioLogOutput|stress-replay|mc-view|log-export-buttons)/.test(selector);
    for (const path of ['simulator.css', 'Simulator.html']) {
        for (const rule of rules(path, sources[path])) {
            if (!scoped(rule.selector)) continue;
            for (const [property, value] of rule.entries) {
                if (/^(?:color|background(?:-color)?|border-color|border-left-color)$/.test(property) && !/^(?:var\(--[\w-]+\)|inherit|currentColor|transparent)$/.test(value)) errors.push(`Ergebnisfarbe: ${path} ${rule.selector} ${property}`);
                if (property === 'opacity' && Number(value) !== 1) errors.push(`Ergebnis-Textdeckkraft: ${path} ${rule.selector}`);
                if (property === 'text-overflow' && value === 'ellipsis') errors.push(`Ergebnistext abgeschnitten: ${rule.selector}`);
            }
        }
    }
    for (const path of SIMULATOR_RESULT_RENDERERS) {
        const source = withoutComments(sources[path]);
        if (/\.style\.opacity\s*=|opacity\s*:\s*(?:0?\.\d+|0)\b/.test(source)) errors.push(`Ergebnis-JS-Deckkraft: ${path}`);
        for (const [, color] of source.matchAll(/(?:^|[;"'])\s*color\s*:\s*([^;"']+)/g)) {
            if (!/^(?:var\(--[\w-]+\)|inherit|currentColor)$/.test(color.trim())) errors.push(`Ergebnis-JS-Farbe: ${path}`);
        }
    }
    const manifest = {
        '.summary-item': ['text-main', 'surface-sunken'],
        '.summary-item > span': ['text-main', null],
        '.summary-description': ['text-muted', null],
        '.summary-item.is-warning': [null, 'warn-soft'],
        '.summary-item.is-warning > span': ['warn', null],
        '.summary-item.is-danger': [null, 'bad-soft'],
        '.summary-item.is-danger > span': ['bad', null],
        '.kpi-card': [null, 'surface-sunken'],
        '.kpi-card .value-line': ['text-main', null],
        '.kpi-card .kpi-description': ['text-muted', null],
        '.stress-replay-message-error': ['bad', 'bad-soft'],
        '.stress-replay-message-warning': ['warn', 'warn-soft'],
        '.stress-replay-comparison-tabs [role="tab"][aria-selected="true"]': ['surface', 'text-main'],
        '#simulationLog, #scenarioLogOutput': ['text-main', 'surface']
    };
    const vars = { ...variables(sources['css/tokens.css']), ...variables(sources['simulator.css']) };
    const parsed = rules('simulator.css', sources['simulator.css']);
    for (const [selector, roles] of Object.entries(manifest)) {
        const declarations = parsed.find(rule => rule.selector === selector)?.declarations || {};
        for (const [index, property] of ['color', 'background'].entries()) {
            if (!roles[index]) continue;
            const value = declarations[property] ?? declarations[`${property}-color`];
            try { if (!value?.includes('var(') || resolveValue(value, vars) !== COLORS[roles[index]]) errors.push(`Ergebnis-Kontrastrolle: ${selector} ${property}`); }
            catch { errors.push(`Ergebnis-Alias: ${selector}`); }
        }
    }
    for (const [fg, bg] of [['text-main', 'surface-sunken'], ['text-muted', 'surface-sunken'], ['text-muted', 'good-soft'], ['text-muted', 'warn-soft'], ['text-muted', 'bad-soft'], ['warn', 'warn-soft'], ['bad', 'bad-soft'], ['accent', 'surface'], ['surface', 'text-main']]) {
        if (contrast(vars[`--${fg}`], vars[`--${bg}`]) < 4.5) errors.push(`Ergebnis-Kontrast: ${fg}/${bg}`);
    }
    for (const html of fragments) errors.push(...validateSimulatorResultMarkup(html));
    return errors;
}

// Slice 6: sämtliche Werkzeugquellen, auch cssText, Styleblöcke und SVG-Attribute.
const TEXT_ONLY_FORBIDDEN = /var\(--(?:chart-\d|heatmap-(?:low|mid|high)|accent-line|border(?:-strong)?)\)/;
export function validateToolMarkup(html, allowTemplates = false) {
    const errors = [];
    for (const [, tag, attrs] of html.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
        if (/class="(?:cell-label-bg|sweep-label-bg)"/.test(attrs)) {
            const fill = attrs.match(/fill="([^"]*)"/)?.[1];
            errors.push('Heatmap-Labelplatte ist unzulässig');
            if (/(?:opacity|fill-opacity)="(?!1")/.test(attrs)) errors.push('Labelunterlage mit Deckkraft');
        }
        if (!['circle', 'rect', 'path', 'line', 'stop'].includes(tag) && /(?:opacity|fill-opacity)="(?!1")/.test(attrs)) errors.push('Grafiktext mit Deckkraft');
        const style = attrs.match(/style="([^"]*)"/)?.[1] || '';
        for (const [, property, value] of style.matchAll(/(?:^|;)\s*(color|opacity)\s*:\s*([^;]+)/g)) {
            if (allowTemplates && value.trim().startsWith('${')) continue;
            if (property === 'opacity' && Number(value) !== 1) errors.push('Werkzeugtext mit Deckkraft');
            if (property === 'color' && (!/^(var\(--[\w-]+\)|inherit|currentColor)$/.test(value.trim()) || TEXT_ONLY_FORBIDDEN.test(value))) errors.push('Werkzeug-Textfarbe');
        }
        if (tag === 'text') {
            if (/class="[^"]*(?:cell-label-text|sweep-cell-text)/.test(attrs) && /(?:stroke=|paint-order=)/.test(attrs)) errors.push('Heatmap-Textstroke ist unzulässig');
            const fill = attrs.match(/fill="([^"]*)"/)?.[1];
            if (allowTemplates && fill?.startsWith('${')) continue;
            if (fill && (!/^var\(--[\w-]+\)$/.test(fill) || TEXT_ONLY_FORBIDDEN.test(fill))) errors.push('Grafiklabel-Farbe');
        }
    }
    return errors;
}
export function validateTools(sources, fragments = []) {
    const errors = [];
    const helper = sources['app/shared/designsystem-chart-colors.js'];
    if (!/textFill: 'var\(--text-main\)', bgFill: 'var\(--surface\)'/.test(helper)) errors.push('Opakes Grafiklabel-Paar fehlt');
    for (const path of [...TOOL_RENDERERS, 'app/shared/designsystem-chart-colors.js']) {
        const source = withoutComments(sources[path]);
        if (/(?<!&)#[\da-f]{3,8}\b|rgba?\(\s*\d|hsl\(\s*\d|(?:color|background(?:-color)?|fill|stroke)\s*:\s*(?:white|black|red|green)\b/i.test(source)) errors.push(`Werkzeug-Altpalette: ${path}`);
        if (/\.style\.opacity\s*=|(?:^|[;"'])\s*opacity\s*:/.test(source)) errors.push(`Werkzeug-Textdeckkraft: ${path}`);
        if (/(?:color\s*:\s*|\.style\.color\s*=\s*['"])var\(--(?:chart-\d|accent-line|border(?:-strong)?)\)/.test(source)) errors.push(`Werkzeug-Serientext: ${path}`);
        errors.push(...validateToolMarkup(source, true));
    }
    const section = sources['Simulator.html'].split('<div id="tab-werkstatt"')[1]?.split('<script type="module" src="app/profile/profile-bridge.js"')[0] || '';
    if (/#[\da-f]{3,8}\b|rgba?\(/i.test(section)) errors.push('Werkzeug-HTML-Altpalette');
    errors.push(...validateToolMarkup(section));
    const generatedStyle = sources['app/simulator/simulator-heatmap.js'].match(/HEATMAP_V4_STYLE = `([\s\S]*?)`;/)?.[1] || '';
    for (const rule of rules('simulator.css', generatedStyle.replace(/<\/?style[^>]*>/g, ''))) {
        for (const [property, value] of rule.entries) {
            if (['opacity', 'fill-opacity'].includes(property) && Number(value) !== 1 && !(rule.selector === '.heatmap-v4-svg .critical-overlay' && property === 'fill-opacity' && Number(value) === .12)) errors.push(`Erzeugte Grafikdeckkraft: ${rule.selector}`);
            if (property === 'fill' && /label|text/.test(rule.selector) && TEXT_ONLY_FORBIDDEN.test(value)) errors.push(`Erzeugter Grafik-Serientext: ${rule.selector}`);
        }
    }
    for (const path of ['simulator.css', 'css/balance.css']) {
        for (const rule of rules(path, sources[path])) {
            if (!/(?:chart-|heatmap-|backtest-|wealth-|expenses-year-bar|ds-tool|ao-)/.test(rule.selector)) continue;
            for (const [property, value] of rule.entries) {
                if (/^(?:color|fill|stroke|background(?:-color)?|border-color|border-left-color)$/.test(property) && !/^(?:var\(--[\w-]+\)|none|inherit|currentColor|transparent)$/.test(value)) errors.push(`Grafikfarbe ohne Token: ${rule.selector}`);
                if ((property === 'color' || property === 'fill' && /(?:text|label)/.test(rule.selector)) && TEXT_ONLY_FORBIDDEN.test(value)) errors.push(`Grafik-Serientext: ${rule.selector}`);
                if (property === 'opacity' && Number(value) !== 1 && rule.selector !== '.chart-svg .area-band') errors.push(`Grafik-Textdeckkraft: ${rule.selector}`);
            }
        }
    }
    for (const fragment of fragments) errors.push(...validateToolMarkup(fragment));
    return errors;
}

// Slice 7: Manager, dynamische Dialoge und gemeinsame Tranchenstatusanzeige.
export function validateManagerMarkup(html) {
    const errors = [];
    for (const [, tag, attrs] of html.matchAll(/<([\w-]+)\b([^>]*)>/g)) {
        const classes = attrs.match(/class="([^"]*)"/)?.[1].split(/\s+/) || [];
        const role = name => { if (!classes.includes(name)) errors.push(`Managerrolle fehlt: ${tag} ${name}`); };
        if (tag === 'button') role('ds-button');
        if (tag === 'select') role('ds-select');
        if (tag === 'input' || tag === 'textarea') role(/type="checkbox"/.test(attrs) ? 'ds-checkbox' : 'ds-input');
        if (tag === 'table') role('ds-table');
        for (const [base, required] of [['stat-card', 'ds-metric'], ['stat-label', 'ds-metric-label'], ['stat-value', 'ds-metric-value'], ['table-scroll', 'ds-table-scroll'], ['modal-content', 'ds-card'], ['empty-state', 'ds-note']]) {
            if (classes.includes(base)) role(required);
        }
        if (classes.includes('icon-action') || classes.includes('ds-icon-button')) {
            role('ds-icon-button');
            if (!/aria-label="[^"\s][^"]*"/.test(attrs)) errors.push('Manager-Symbolaktion ohne Namen');
        }
    }
    if (/(?<!&)#[\da-f]{3,8}\b|rgba?\(\s*\d|(?:^|[;"'])\s*opacity\s*:/i.test(html)) errors.push('Manager-Markup mit Altfarbe oder Textdeckkraft');
    if (/(?:(?<![\w-])color\s*:\s*|\.style\.color\s*=\s*['"`])var\(\s*--border(?:-[\w-]+)?\s*\)/i.test(html)) errors.push('Manager-Rahmentoken als Textfarbe');
    return errors;
}
export function validateManagerRente(field) {
    const errors = [];
    if (field.getAttribute('data-field-state') !== 'adopted') errors.push('Rentenstatus ohne Übernahmezustand');
    const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const reasons = descriptions.map(id => field.ownerDocument.getElementById(id)).filter(node => node?.className.split(/\s+/).includes('ds-field-reason'));
    if (reasons.length !== 1) errors.push('Rentenstatus benötigt genau eine verknüpfte Begründung');
    if (field.ownerDocument.getElementById('profileRenteHelp') || descriptions.includes('profileRenteHelp')) errors.push('Veraltete doppelte Rentenerklärung');
    const reason = reasons[0];
    if (!reason?.textContent.trim() || reason.hidden || reason.getAttribute('aria-hidden') === 'true') errors.push('Rentenstatus ohne sichtbare verknüpfte Begründung');
    if (!field.disabled) errors.push('Rentenstatus ist nicht gesperrt');
    return errors;
}
export function validateManager(sources, fragments = []) {
    const errors = [];
    for (const path of ['depot-tranchen-manager.html', ...MANAGER_RENDERERS]) {
        const source = withoutComments(sources[path]);
        if (/(?<!&)#[\da-f]{3,8}\b|rgba?\(\s*\d|hsl\(\s*\d|(?:color|background(?:-color)?)\s*:\s*(?:white|black|red|green)\b/i.test(source)) errors.push(`Manager-Altpalette: ${path}`);
        if (/\.style\.opacity\s*=|(?:^|[;"'])\s*opacity\s*:/.test(source)) errors.push(`Manager-Textdeckkraft: ${path}`);
        for (const [, color] of source.matchAll(/\.style\.(?:color|backgroundColor)\s*=\s*['"]([^'"]+)['"]/g)) {
            if (!/^var\(--[\w-]+\)$/.test(color)) errors.push(`Manager-Farbzuweisung: ${path}`);
        }
        errors.push(...validateManagerMarkup(source));
    }
    for (const fragment of fragments) errors.push(...validateManagerMarkup(fragment));
    return errors;
}

// Anzeigevertrag von Slice 8; bestehende Viewportgrenzen bleiben separat geschützt.
export function validateDataLayout(sources) {
    const errors = [];
    const check = (condition, message) => { if (!condition) errors.push(message); };
    const has = (path, selector, property, value) => rules(path, sources[path]).some(rule =>
        rule.selector.split(/,\s*/).includes(selector) && rule.declarations[property] === value);
    for (const selector of ['.form-column', '.balance-diagnosis-grid > *', '.key-param-card', '.summary-item']) {
        check(has('css/balance.css', selector, 'min-width', '0'), `Schrumpfbare Balance-Spalte fehlt: ${selector}`);
    }
    for (const selector of ['.overview-assets', '.overview-plan']) check(has('css/overview.css', selector, 'min-width', '0'), 'Schrumpfbare Übersichtskarten fehlen');
    for (const path of ['index.html', 'css/overview.css']) {
        for (const rule of rules(path, sources[path])) {
            if (/^(html|body)$/.test(rule.selector)) check(!/hidden|clip/.test(rule.declarations['overflow-x'] || rule.declarations.overflow || ''), `Globales Abschneiden: ${path}`);
            if (rule.selector === '.overview-grid') check(!/\b\d+(?:\.\d+)?px\b/.test(rule.declarations['grid-template-columns'] || ''), `Feste Seitenspalte: ${path}`);
        }
    }
    for (const [path, container] of [['css/balance.css', 'balance-form'], ['depot-tranchen-manager.html', 'manager']]) {
        check(sources[path].includes(`container: ${container} / inline-size;`) && sources[path].includes(`@container ${container}`), `Containerregel fehlt: ${container}`);
        for (const rule of rules(path, sources[path])) {
            if (/^(html|body)$/.test(rule.selector)) check(!/hidden|clip/.test(rule.declarations['overflow-x'] || rule.declarations.overflow || ''), `Globales Abschneiden: ${path}`);
            if (['.form-column', '.apps-grid', '.stats'].includes(rule.selector)) {
                const columns = rule.declarations['grid-template-columns'] || '';
                check(!/\b\d+(?:\.\d+)?px\b/.test(columns) || /^repeat\(auto-(fit|fill), minmax\(/.test(columns), `Feste Seitenspalte: ${path}`);
                check(!/\b\d+(?:\.\d+)?px\b/.test(rule.declarations.width || ''), `Feste Spaltenbreite: ${path}`);
            }
        }
    }
    check(has('css/balance.css', '.wealth-scroll', 'overflow-x', 'auto'), 'Verlauf ohne Scrollkapsel');
    check(has('css/balance.css', '.expenses-table-wrap', 'overflow', 'auto'), 'Ausgaben ohne Scrollkapsel');
    check(has('depot-tranchen-manager.html', '.table-scroll', 'overflow-x', 'auto'), 'Manager ohne Scrollkapsel');
    for (const id of ['managerWealthTable', 'expensesHistoryChart', 'expensesHistoryTable']) {
        const tag = sources[id.startsWith('expenses') ? 'Ausgaben.html' : 'depot-tranchen-manager.html'].match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0] || '';
        check( /class="[^"]*\b(?:ds-table-scroll|expenses-table-region)\b/.test(tag) && tag.includes('tabindex="0"') && tag.includes('role="region"') && tag.includes('aria-label='), `Unbedienbare Verlaufskapsel: ${id}`);
    }
    for (const path of ['Handbuch.html', 'app/tranches/tranchen-manager-renderer.js']) check(sources[path].includes('ds-scroll-hint'), `Fortsetzungshinweis fehlt: ${path}`);
    check(sources['Handbuch.html'].includes('<div class="ds-table-scroll" tabindex="0" role="region"'), 'Handbuchtabelle ohne Scrollkapsel');
    check(/<div class="table-scroll ds-table-scroll"[^>]*role="region"[^>]*tabindex="0"/.test(sources['app/tranches/tranchen-manager-renderer.js']), 'Managerregion nicht per Tastatur bedienbar');
    for (const path of ['app/balance/balance-wealth-history-renderer.js', 'app/balance/balance-expenses-history-renderer.js']) {
        const geometry = path.includes('wealth-history') ? sources['app/balance/balance-wealth-history-metrics.js'] : sources[path];
        check(sources[path].includes('width="${width}"') && sources[path].includes('min-width:${width}px') && /rows\.length \* \d+/.test(geometry), `Datenabhängige Diagrammbreite fehlt: ${path}`);
        check(sources[path].includes('preserveAspectRatio="xMidYMid meet"'), `Diagramm verzerrt Koordinaten: ${path}`);
    }
    check(has('css/balance.css', '.wealth-scroll svg', 'min-width', '640px')
        && has('css/balance.css', '.wealth-scroll svg text', 'font-size', 'var(--text-dense)')
        && has('css/tokens.css', ':root', '--text-dense', '14px'), 'Diagramm ohne Mindestbreite oder echte Pixelschrift');
    check(sources['app/balance/balance-wealth-history-renderer.js'].includes('height="360"')
        && sources['app/balance/balance-expenses-history-renderer.js'].includes('height="270"'), 'Definierte Diagrammhöhen fehlen');
    for (const rule of rules('css/balance.css', sources['css/balance.css'])) {
        if (/(?:wealth-scroll|wealthHistoryChart|expensesHistoryChart).*\bsvg\b/.test(rule.selector)
            && (rule.declarations.height || rule.declarations.width)) {
            check(false, 'CSS überschreibt die explizite SVG-Pixelgeometrie');
        }
        if (/wealth-scroll.*:empty/.test(rule.selector)) {
            check(!/none/.test(rule.declarations.display || '') && !/hidden|collapse/.test(rule.declarations.visibility || ''), 'Leere Verlaufskapsel nicht zugänglich');
        }
        if (/wealth-history\s+p|wealthHistory(?:Status|Hint)|expensesHistoryHint|aria-live|role\s*=\s*["']?status|(?:^|,\s*)p:empty/.test(rule.selector)) {
            check(!/^none(?:\s*!important)?$/.test(rule.declarations.display || '')
                && !/^(?:hidden|collapse)(?:\s*!important)?$/.test(rule.declarations.visibility || ''),
            `Live-Region aus dem Accessibility-Baum entfernt: ${rule.selector}`);
        }
    }
    for (const id of ['expensesHistoryHint']) {
        const tag = sources[id.startsWith('expenses') ? 'Ausgaben.html' : 'depot-tranchen-manager.html'].match(new RegExp(`<p[^>]*id="${id}"[^>]*>`))?.[0] || '';
        check(tag.includes('aria-live="polite"') && !/\shidden(?:\s|=|>)/.test(tag)
            && !/style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)/.test(tag), `Live-Region nicht dauerhaft vorhanden: ${id}`);
    }
    check(has('css/balance.css', '.balance-page .wealth-history p:empty', 'margin', '0')
        && has('css/balance.css', '.balance-page #expensesHistoryHint:empty', 'margin', '0'), 'Leere Live-Regionen behalten unnötigen Abstand');
    check(has('css/balance.css', '.wealth-line', 'stroke', 'var(--accent)')
        && has('css/balance.css', '.wealth-area', 'fill', 'var(--accent-soft)'), 'Nominale Linie/Fläche ohne Grafikrollen');
    check(has('css/balance.css', '.balance-page .expenses-table thead th', 'overflow-wrap', 'anywhere'), 'Profilname der Importmatrix wird abgeschnitten');
    check(!sources['Balance.html'].includes('id="expensesImportCard"') && /<select id="expensesYearSelect"[^>]* hidden/.test(sources['Ausgaben.html']), 'Jahresbrücke nicht verborgen oder zweiter Importweg erhalten');
    check(sources['css/overview.css'].includes('@container suite-content'), 'Übersicht misst den vorhandenen Rahmencontainer');
    for (const [path, id] of [['depot-tranchen-manager.html', 'reconcileTrancheId']]) {
        check(sources[path].includes(`<span id="${id}-fulltext" class="ds-selection-text">`), `Sichtbarer Auswahlvolltext fehlt: ${id}`);
    }
    check(has('css/components.css', '.ds-selection-text', 'white-space', 'normal') && has('css/components.css', '.ds-selection-text', 'overflow-wrap', 'anywhere') && has('css/components.css', '.ds-selection-text', 'display', 'block'), 'Auswahlvolltext nicht sichtbar umbrechend');
    check(sources['app/tranches/tranchen-manager-page.js'].includes('observeSelectionText(document.body)'), 'Managerauswahlen ohne vollständigen Anschluss');
    check(has('css/components.css', '.ds-selection-text[hidden]', 'display', 'none'), 'Passende Kurztexte werden sichtbar wiederholt');
    for (const path of ['app/profile/profile-manager.js', 'app/tranches/tranchen-manager-page.js']) check(sources[path].includes('syncSelectionText(select'), `Optionsrefresh ohne Volltext: ${path}`);
    return errors;
}


// Abschluss: exakte Bestandsausnahmen und ausdrücklich neue grafische Ausnahme, kein Kontingent.
export const PRESENTATION_EXCEPTIONS = [
    ['css/components.css', '.navigation-guard-dialog::backdrop', 'background', 'var(--backdrop)', 'Neue grafische Ausnahme: textfreier Navigations-Backdrop; keine Text- oder Elterndeckkraft.'],
    ['css/balance.css', '.btn:not(:disabled):not(.ds-button-primary):not(.ds-button-danger):hover', 'box-shadow', '0 4px 12px rgba(197, 160, 89, 0.15)', 'Bestehender Dekorschatten außerhalb der Textfläche.'],
    ['css/balance.css', '.expenses-dialog', 'box-shadow', '0 24px 60px rgba(0, 0, 0, 0.35)', 'Bestehender Dialogschatten.'],
    ['css/balance.css', '.expenses-dialog::backdrop', 'background', 'rgba(0, 0, 0, 0.45)', 'Grafischer Dialoghintergrund ohne Text.'],
    ['css/balance.css', '.annual-update-steps .step-dot', 'box-shadow', 'inset 0 0 0 1px rgba(0, 0, 0, 0.08)', 'Rein grafischer Fortschrittspunkt.'],
    ['css/balance.css', '.help-tooltip .tooltip-text', 'box-shadow', '0 8px 24px rgba(0, 0, 0, 0.3)', 'Bestehender Tooltipschatten.'],
    ['css/balance.css', '.profilverbund-header-group', 'background', 'linear-gradient(to right, rgba(197, 160, 89, 0.05), transparent)', 'Bestehende opake Textdarstellung über minimalem Dekor auf heller Fläche.'],
    ['css/balance.css', '.basiswerte-divider', 'opacity', '0.6', 'Leere dekorative Trennlinie.'],
    ['css/balance.css', '.help-tooltip .tooltip-text', 'opacity', '0', 'Bestehender verborgener Tooltip; im Hoverzustand Deckkraft 1.'],
    ['simulator.css', '.chart-svg .area-band', 'opacity', '0.15', 'Reine Datenfläche ohne Textkinder.'],
];
export function validateSimulatorLayout(sources) {
    const errors = [];
    const check = (ok, message) => { if (!ok) errors.push(message); };
    const css = sources['simulator.css'];
    const parsed = rules('simulator.css', css);
    const has = (selector, prop, value) => parsed.some(rule => rule.selector.split(/,\s*/).includes(selector) && rule.declarations[prop] === value);
    for (const selector of ['.main-layout', '.panel', '.form-group', '.form-grid > *', '.summary-grid > *', '.kpi-grid > *']) {
        check(has(selector, 'min-width', '0'), `Simulator-Schrumpfregel fehlt: ${selector}`);
    }
    check(css.includes('container: simulator-panel / inline-size;') && css.includes('@container simulator-panel'), 'Simulator-Containerbezug fehlt');
    check(has('.ds-chart-scroll', 'overflow-x', 'auto'), 'Grafikscrollkapsel fehlt');
    check(css.includes('@media screen {\n    svg.chart-native-svg.chart-native-svg { display: block; width: auto; height: auto; min-width: 0; max-width: none; box-sizing: content-box; }'), 'Native SVG-Pixelmaße fehlen');
    for (const selector of ['.heatmap-v4-svg', '.ds-pareto-svg']) check(parsed.some(rule => rule.selector === selector && /px$/.test(rule.declarations['min-width'] || '')), `Grafikmindestbreite fehlt: ${selector}`);
    for (const rule of parsed) {
        if (/^(?:body|html)$/.test(rule.selector)) check(!/hidden|clip/.test(rule.declarations['overflow-x'] || rule.declarations.overflow || ''), 'Simulator global abgeschnitten');
        if (/^\.(?:form-grid(?:-three-col|-four-col)?|main-layout|panel)$/.test(rule.selector)) {
            const columns = rule.declarations['grid-template-columns'] || '';
            check(!/\d+px/.test(columns) || /^repeat\(auto-(?:fit|fill), minmax\(/.test(columns), `Feste Simulator-Spalten: ${rule.selector}`);
            check(!/\d+px/.test(rule.declarations.width || ''), `Feste Simulatorbreite: ${rule.selector}`);
        }
    }
    for (const id of ['simulationLog', 'scenarioLogOutput', 'portfolioCompositionChart']) {
        const tag = sources['Simulator.html'].match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))?.[0] || '';
        check(tag.includes('role="region"') && tag.includes('tabindex="0"') && /aria-label(?:ledby)?=/.test(tag), `Unbenannte Simulatorregion: ${id}`);
        check(new Set([...tag.matchAll(/\b(class|role|tabindex|aria-label)=/g)].map(m => m[1])).size === [...tag.matchAll(/\b(class|role|tabindex|aria-label)=/g)].length, `Doppelte Simulatorattribute: ${id}`);
    }
    check(sources['Simulator.html'].includes('observeSelectionText(document.body)'), 'Simulatorauswahl ohne Volltextinitialisierung');
    check(sources['app/simulator/simulator-results.js'].includes('onSelect: renderSelectedScenario')
        && !sources['app/simulator/simulator-results.js'].includes('scenarioSelect'), 'Szenarioauswahl ohne direkte Quellbindung');
    check(sources['Simulator.html'].includes('id="scenarioList" class="scenario-list" role="listbox"')
        && sources['Simulator.html'].includes('id="scenarioSelectionSummary"')
        && sources['Simulator.html'].includes('id="scenarioSelectedHeading"'), 'Szenarioauswahl ohne einheitliche Listbox und Volltextkopf');
    for (const path of ['app/simulator/simulator-heatmap.js', 'app/simulator/simulator-visualization.js', 'app/simulator/simulator-optimizer.js', 'app/simulator/stress-replay-renderer.js']) {
        check(sources[path].includes('role="region" tabindex="0"') && sources[path].includes('ds-scroll-hint'), `Werkzeug ohne bedienbare Scrollregion: ${path}`);
    }
    return errors;
}

export function validateScrollableMarkup(html) {
    const errors = [], stack = [];
    for (const [, closing, tag, attrs] of html.matchAll(/<(\/?)([\w-]+)\b([^>]*)>/g)) {
        if (closing) { const index = stack.map(node => node.tag).lastIndexOf(tag); if (index >= 0) stack.splice(index); continue; }
        const scroll = /class="[^"]*\bds-(?:chart|table)-scroll\b/.test(attrs);
        if (scroll && !(/role="region"/.test(attrs) && /tabindex="0"/.test(attrs) && /aria-label(?:ledby)?="[^"\s][^"]*"/.test(attrs))) errors.push('Scrollregion ohne Tastatur/Namen');
        if (['svg', 'table'].includes(tag) && !stack.some(node => node.scroll)) errors.push(`Ungekapselte Datenausgabe: ${tag}`);
        if (!/\/\s*$/.test(attrs) && !['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push({ tag, scroll });
    }
    return errors;
}

export function validateCompletePresentation(sources) {
    const errors = [validateFoundation, validateComponents, validateBalance, validateSimulatorFields,
        validateSimulatorResults, validateTools, validateManager, validateDataLayout, validateSimulatorLayout, validatePersonenVermoegenLayout].flatMap(validate => validate(sources));
    for (const path of SOURCE_PATHS) {
        if (!(path in sources)) errors.push(`Quellmanifest unvollständig: ${path}`);
    }
    for (const [path, source] of Object.entries(sources)) {
        if (path.startsWith('docs/design/')) errors.push(`Referenz im Laufzeitmanifest: ${path}`);
        const clean = withoutComments(source);
        if (path.endsWith('.js')) {
            if (/(?<!&)#[\da-f]{3,8}\b|rgba?\(\s*\d/i.test(clean)) errors.push(`JS-Altpalette: ${path}`);
            if (/\.style\.opacity\s*=|(?:^|[;"'])\s*opacity\s*:\s*(?!1(?:[;\s]|$))/m.test(clean)) errors.push(`JS-Textdeckkraft: ${path}`);
        }
        const tokens = variables(sources['css/tokens.css']);
        const context = { ...tokens, ...variables(sources['css/components.css']),
            ...variables(sources[path.startsWith('app/balance/') || path === 'Balance.html' ? 'css/balance.css' : path.startsWith('app/simulator/') || path === 'Simulator.html' ? 'simulator.css' : path]),
            ...variables(cssSource(path, source)) };
        if (path.endsWith('.js')) {
            for (const [, value] of clean.matchAll(/(?:(?<![\w-])color\s*:\s*|\.style\.color\s*=\s*['"])(var\(--[\w-]+\))/g)) {
                try {
                    const resolved = resolveValue(value, context);
                    if ([COLORS.border, COLORS['border-strong'], COLORS['accent-line']].includes(resolved) || TEXT_ONLY_FORBIDDEN.test(value)) errors.push(`JS-Textrollenalias: ${path}`);
                } catch { errors.push(`JS-Textalias: ${path}`); }
            }
        }
        for (const rule of rules(path, source)) {
            const fg = rule.declarations.color, bg = rule.declarations.background || rule.declarations['background-color'];
            try {
                const foreground = fg && resolveValue(fg, context), background = bg && resolveValue(bg, context);
                if (/^#[\da-f]{6}$/i.test(foreground || '') && /^#[\da-f]{6}$/i.test(background || '') && contrast(foreground, background) < 4.5) errors.push(`Unzulässiges Kontrastpaar: ${path} ${rule.selector}`);
                if (fg?.includes('var(') && [COLORS.border, COLORS['border-strong'], COLORS['accent-line']].includes(foreground) && !PRESENTATION_EXCEPTIONS.some(([p, sel, prop, val]) => p === path && sel === rule.selector && prop === 'color' && val === fg)) errors.push(`Alias mit Rahmenrolle als Text: ${path} ${rule.selector}`);
                if (foreground && /rgba?\(|transparent|color-mix/.test(foreground)) errors.push(`Transparente Textfarbe: ${path} ${rule.selector}`);
            } catch { errors.push(`Farbpaar-Alias: ${path} ${rule.selector}`); }
            for (const [property, value] of rule.entries) {
                const exception = PRESENTATION_EXCEPTIONS.some(([p, selector, prop, val]) => p === path && selector === rule.selector && prop === property && val === value);
                if (property === 'opacity' && Number(value) !== 1 && !exception) errors.push(`Text-/Elterndeckkraft: ${path} ${rule.selector}`);
                if (/^(?:color|fill)$/.test(property) && /var\(--(?:border(?:-strong)?|accent-line|chart-\d|heatmap-(?:low|mid|high))\)/.test(value) && !(property === 'fill' && !/text|label/.test(rule.selector))) errors.push(`Unzulässige Textrolle: ${path} ${rule.selector}`);
                if (/^(?:color|background(?:-color)?|border(?:-[\w-]+)?)$/.test(property) && /#[\da-f]{3,8}\b|rgba?\(\s*\d/.test(value) && path !== 'css/tokens.css' && !exception) errors.push(`CSS-Altpalette: ${path} ${rule.selector} ${property}`);
            }
        }
    }
    return errors;
}

export function validatePersonenVermoegenLayout(sources) {
    const errors = [], css = sources['css/personen-vermoegen.css'];
    if (!css || !sources['depot-tranchen-manager.html'].includes('href="css/personen-vermoegen.css"')) errors.push('Personenseite: Stylesheet fehlt');
    for (const rule of rules('css/personen-vermoegen.css', css || '')) {
        if (rule.declarations['font-size'] && !/^var\(--(?:balance-|value-|text-)/.test(rule.declarations['font-size'])) errors.push('Personenseite: Typografietoken fehlt');
    }
    if (!css?.includes('var(--value-xl)') || !css.includes('var(--value-lg)') || !css.includes('var(--value-md)')) errors.push('Personenseite: Werttoken fehlt');
    const html = sources['depot-tranchen-manager.html'];
    if (/<div[^>]*class="container\s+ds-card"/.test(html)) errors.push('Personenseite: äußerer Kartenrahmen');
    const heading = html.match(/<header class="pv-heading ds-page-head">[\s\S]*?<\/header>/)?.[0] || '';
    for (const id of ['managerPageTitle', 'updatePricesBtn']) {
        if (!heading.includes(`id="${id}"`)) errors.push(`Personenseite: Kopfhost fehlt: ${id}`);
    }
    for (const id of ['addTrancheBtn', 'openSaleEntryBtn']) {
        if (html.includes(`id="${id}"`)) errors.push(`Personenseite: doppelter Depotzugang: ${id}`);
    }
    const elements = tokenizeHTML(html).elements;
    const node = id => elements.find(element => element.attrs.id === id);
    const within = (element, ancestor) => {
        if (!ancestor) return false;
        for (let parent = element?.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
        return false;
    };
    const tabs = node('managerSectionNav'), opener = node('managePeopleBtn');
    const planPanel = node('managerPlanPanel'), personPanel = node('managerPersonPanel');
    if (tabs?.attrs.role !== 'tablist' || elements.filter(element => element.attrs.role === 'tablist').length !== 1
        || node('managerProfileTabs')) errors.push('Personenseite: einzige Ansichtsreiterliste fehlt');
    if (!opener || within(opener, tabs) || within(opener, planPanel) || within(opener, personPanel)) errors.push('Personenseite: Verwaltungsöffner außerhalb der Reiter fehlt');
    if (!node('managerHousehold') || !tabs || !node('managerProfileValues')
        || !(elements.indexOf(tabs) < elements.indexOf(node('managerHousehold'))
        && elements.indexOf(tabs) < elements.indexOf(node('managerProfileValues')))) errors.push('Personenseite: Reiter vor Haushalts-/Profilkarten fehlen');
    for (const panel of [planPanel, personPanel, node('managerHistoryPanel')]) {
        if (panel?.attrs.role !== 'tabpanel' || !Object.hasOwn(panel.attrs, 'hidden')) errors.push('Personenseite: verborgenes Ansichtspanel fehlt');
    }
    for (const id of ['managerHouseholdPlan', 'managerPlanComparisonCard']) {
        if (!within(node(id), planPanel)) errors.push(`Personenseite: Planhost außerhalb des Planpanels: ${id}`);
    }
    for (const id of ['managerProfileValues', 'managerDepotTitle', 'reconciliationTitle', 'managerTechnical']) {
        if (!within(node(id), personPanel)) errors.push(`Personenseite: Personenhost außerhalb des Personenpanels: ${id}`);
    }
    if (!within(node('managerWealthHistory'), node('managerHistoryPanel'))
        || within(node('managerWealthHistory'), personPanel) || within(node('managerWealthHistory'), planPanel)) errors.push('Personenseite: Verlauf nur im eigenen Ansichtspanel');
    for (const id of ['managerWealthContext', 'managerWealthDailyNote']) {
        if (!within(node(id), node('managerWealthInfo'))) errors.push('Personenseite: Verlaufserklärung außerhalb des Infofelds');
    }
    if (!within(node('managerHousehold'), planPanel) || within(node('managerHousehold'), personPanel)) errors.push('Personenseite: Haushaltskarten außerhalb des Planpanels');
    if (/from\s+['"][^'"]*profile-manager\.js/.test(sources['app/tranches/tranchen-manager-page.js'])) errors.push('Personenseite: Startseitenbootstrap importiert');
    for (const id of ['managerDepotTitle', 'managerDepotProfileName', 'trancheModalDescription', 'trancheFormPreview', 'dismissTrancheModalBtn', 'saveTrancheBtn', 'saleModal', 'saleStep1', 'saleStep2', 'saleStep3', 'saleBackBtn', 'saleNextBtn', 'retrySaleSaveBtn', 'managerPeopleModal', 'managePeopleBtn', 'managerPeopleList', 'managerPersonName']) {
        if (!html.includes(`id="${id}"`)) errors.push(`Personenseite: Depot-/Dialoghost fehlt: ${id}`);
    }
    for (const id of ['category', 'type']) {
        if (!new RegExp(`<select[^>]*id="${id}"[^>]*\\bhidden\\b`).test(html)) errors.push('Personenseite: nativer Segmentwertträger fehlt');
    }
    for (const id of ['profileGoldAktiv', 'profileGoldSteuerfrei', 'profileHealthBucketEnabled']) {
        if (!new RegExp(`<select[^>]*id="${id}"[^>]*\\bhidden\\b`).test(html)
            || !new RegExp(`<input[^>]*role="switch"[^>]*id="${id}Toggle"`).test(html)) errors.push(`Personenseite: Schalterwertträger fehlt: ${id}`);
    }
    if (!/<input[^>]*id="profileRenteAktiv"[^>]*type="hidden"[^>]*\bdisabled\b/.test(html)) errors.push('Personenseite: abgeleitete Rente nicht gesperrt');
    if (/<select[^>]*id="profileRenteAktiv"/.test(html)) errors.push('Personenseite: entfernter Rentenstatus-Select wieder eingeführt');
    for (const id of ['depotAddTrancheBtn', 'depotOpenSaleEntryBtn', 'profileManagePeopleBtn', 'managerCareActive', 'managerDepotCount']) {
        if (!html.includes(`id="${id}"`)) errors.push(`Personenseite: Bedienhost fehlt: ${id}`);
    }
    for (const role of ['pv-dialog-fields', 'pv-depot-group', 'pv-quote-date']) {
        if (!css?.includes(`.${role}`)) errors.push(`Personenseite: Depot-/Dialogrolle fehlt: ${role}`);
    }
    return errors;
}

export function validateSimulatorOverviewFrame(sources) {
    const errors = [];
    const css = sources['simulator.css'];
    if (!/\.tab-content\s*\{\s*container:\s*simulator-content\s*\/\s*inline-size;/.test(css)) errors.push('Simulator: Inhaltscontainer fehlt');
    const wide = css.split('@container simulator-content (min-width: 2300px) {')[1]?.split('@container')[0] ?? '';
    if (!wide.includes('.sim-overview-backtest { grid-column: span 8; }') || !wide.includes('.sim-overview-mc { grid-column: span 4; }')
        || !wide.includes('.sim-crisis-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }')) errors.push('Simulator: breites Ergebnisraster ab 2300 px fehlt');
    for (const rule of rules('simulator.css', css)) {
        if (!rule.selector.includes('.sim-')) continue;
        if (rule.declarations['font-size'] && !/^var\(--(?:balance-|value-(?:lg|md)\)|text-(?:base|dense)\))/.test(rule.declarations['font-size'])) errors.push('Simulator: Typografietoken fehlt');
    }
    if (!css.includes('@media screen {\n    svg.chart-native-svg.chart-native-svg { display: block; width: auto; height: auto; min-width: 0; max-width: none; box-sizing: content-box; }')) errors.push('Simulator: native SVG-Pixelmaße fehlen');
    return errors;
}
