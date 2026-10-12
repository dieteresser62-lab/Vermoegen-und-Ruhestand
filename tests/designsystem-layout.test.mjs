import { readSources, validateDataLayout, createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { syncSelectionText } from '../app/shared/designsystem-selection-text.js';
import strict from 'node:assert/strict';
import { createSelectionDocument, addField, SelectionSelect, selectionVariant, functionSource, source, installSelectionMeasurements } from './designsystem-selection-dom.mjs';

const sources = readSources();
assertEqual(validateDataLayout(sources).join('\n'), '', 'Container, Scrollregionen und sichtbarer Auswahlvolltext erfüllen den Anzeigevertrag');
for (const [path, before, after] of [
    ['css/balance.css', '.form-column {\n    min-width: 0;', '.form-column {'],
    ['css/overview.css', 'grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);', 'grid-template-columns: 320px 1fr;'],
    ['css/balance.css', 'max-width: 100%; overflow-x: auto;', 'max-width: 100%; overflow-x: visible;'],
    ['depot-tranchen-manager.html', '<span id="reconcileTrancheId-fulltext" class="ds-selection-text"></span>', '<span title="Nur Tooltip"></span>'],
    ['css/components.css', 'white-space: normal;', 'white-space: nowrap;'],
    ['depot-tranchen-manager.html', 'id="managerWealthTable" class="ds-table-scroll ds-table-box" tabindex="0"', 'id="managerWealthTable" class="ds-table-scroll ds-table-box"'],
    ['Ausgaben.html', 'id="expensesHistoryChart" class="expenses-table-region" tabindex="0"', 'id="expensesHistoryChart" class="expenses-table-region"'],
    ['app/balance/balance-wealth-history-renderer.js', 'width="${width}"', 'width="100%"'],
    ['app/balance/balance-wealth-history-renderer.js', 'preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="none"'],
    ['app/balance/balance-expenses-history-renderer.js', 'preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="none"'],
    ['css/balance.css', 'min-width: 640px; max-width: none;', 'min-width: 640px; height: 180px;'],
    ['css/balance.css', '.balance-page #expensesHistoryHint:empty { margin: 0; }', '.balance-page #expensesHistoryHint:empty { display: none; }'],
    ['css/balance.css', '.balance-page #expensesHistoryHint:empty { margin: 0; }', '.balance-page #expensesHistoryHint:empty { visibility: hidden; }'],
    ['Ausgaben.html', '<p id="expensesHistoryHint"', '<p hidden id="expensesHistoryHint"'],
    ['app/balance/balance-wealth-history-metrics.js', 'rows.length * 100', '100'],
    ['css/balance.css', '.wealth-area { fill: var(--accent-soft); }', '.wealth-area { fill: none; }'],
    ['Ausgaben.html', '<select id="expensesYearSelect" class="ds-select" hidden', '<select id="expensesYearSelect" class="ds-select"']
]) {
    assert(sources[path].includes(before), `${path}: Gegenprobe trifft die echte Quelle`);
    assert(validateDataLayout({ ...sources, [path]: sources[path].replace(before, after) }).length > 0, `${path}: Gegenprobe scheitert`);
}
assert(validateDataLayout({ ...sources, 'index.html': sources['index.html'].replace('</head>', '<style>body { overflow-x: hidden; }</style></head>') }).length > 0, 'Globales Abschneiden kaschiert keinen Überlauf');
for (const id of ['wealthHistoryChart', 'expensesHistoryChart']) {
    assert(validateDataLayout({ ...sources, 'css/balance.css': sources['css/balance.css'] + `\n#${id} svg { height: 180px; }` }).length > 0,
        `${id}: spezifische CSS-Höhe darf die Pixelgeometrie nicht überschreiben`);
}
for (const id of ['wealthHistoryStatus', 'wealthHistoryHint', 'expensesHistoryHint']) {
    for (const declaration of ['display: none', 'visibility: hidden']) {
        assert(validateDataLayout({ ...sources, 'css/balance.css': sources['css/balance.css'] + `\n#${id}:empty { ${declaration}; }` }).length > 0,
            `${id}: leere Live-Region bleibt bei ${declaration} geschützt`);
    }
}

const doc = createPresentationTestDocument();
installSelectionMeasurements(doc);
const select = doc.createElement('select');
select.clientWidth = 50; select.getClientRects = () => [{}];
select.id = 'probe'; select.value = 'a'; select.disabled = false;
select.selectedOptions = [{ textContent: 'Synthetischer langer Profilname '.repeat(12) }];
select.setAttribute('aria-describedby', 'vorhandener-hinweis');
doc.body.appendChild(select);
select.insertAdjacentElement = (position, node) => select.parentNode.insertBefore(node, select.nextSibling);
const initial = syncSelectionText(select);
assertEqual(initial.textContent, select.selectedOptions[0].textContent, 'Langer Name wird vollständig ausgegeben');
assertEqual(select.getAttribute('aria-describedby'), 'vorhandener-hinweis probe-fulltext', 'Bestehende Beschreibung bleibt additiv erhalten');
select.value = 'b'; select.selectedOptions = [{ textContent: 'Anderer synthetischer Profilname' }];
select.events.get('change')();
assertEqual(initial.textContent, select.selectedOptions[0].textContent, 'Auswahlwechsel aktualisiert sichtbaren Volltext');
select.selectedOptions[0].textContent = 'Nach Optionsrefresh';
syncSelectionText(select);
assertEqual(initial.textContent, 'Nach Optionsrefresh', 'Optionsrefresh ersetzt veralteten Volltext');
assertEqual(doc.body.children.length, 2, 'Wiederholtes Rendern erzeugt keine zusätzlichen Volltextknoten');
assert(select.value === 'b' && !select.disabled, 'Darstellung verändert weder Auswahl noch Sperre');
select.selectedOptions = [];
syncSelectionText(select);
assertEqual(initial.textContent, '', 'Leere Auswahl entfernt veralteten Volltext');

// Slice 9: vollständiger Vertrag und isolierte Quellkopien über alle fünf Seiten.
const { SOURCE_PATHS, PAGES, validateCompletePresentation, validateSimulatorLayout, validateScrollableMarkup } = await import('./designsystem-source-contract.mjs');
assertEqual(validateCompletePresentation(sources).join('\n'), '', 'Alle benannten Laufzeitconsumer erfüllen den vollständigen Vertrag');
for (const [path, before, after, diagnostic] of [
    ['css/components.css', 'margin: auto;', 'margin: 0;', 'Navigationsdarstellung: .navigation-guard-dialog margin'],
    ['css/components.css', '.navigation-guard-dialog { margin: auto; padding: var(--space-6);', '.navigation-guard-dialog { margin: auto;', 'Navigationsdarstellung: .navigation-guard-dialog padding'],
    ['css/components.css', 'background: var(--backdrop);', 'background: var(--surface-sunken);', 'Navigationsdarstellung: .navigation-guard-dialog::backdrop background'],
    ['css/tokens.css', '--backdrop: color-mix(in srgb, var(--text-main) 45%, transparent);', '', 'Grafiktoken: --backdrop'],
    ['css/components.css', '.navigation-guard-dialog {', '.navigation-guard-dialog { opacity: .5;', 'Text-/Elterndeckkraft'],
    ['css/components.css', /(\.navigation-guard-dialog \{[^}]*?)color: var\(--text-main\);/, '$1color: var(--backdrop);', 'Transparente Textfarbe']
]) {
    const changed = sources[path].replace(before, after);
    assert(changed !== sources[path], `Wirksame Abschlussgegenprobe: ${diagnostic}`);
    assert(validateCompletePresentation({ ...sources, [path]: changed }).some(error => error.includes(diagnostic)), `Vollständiger Vertrag bindet ${diagnostic} ein`);
}
assert(PAGES.every(path => SOURCE_PATHS.includes(path)) && !SOURCE_PATHS.some(path => path.startsWith('docs/design/')), 'Fünf Seiten erfasst, Referenzbild und Prototyp ausgeschlossen');
for (const path of ['app/balance/balance-storage.js', 'app/simulator/simulator-optimizer.js', 'app/profile/profilverbund-balance-ui.js']) assert(SOURCE_PATHS.includes(path), `Zusätzlicher tatsächlicher Consumer im Manifest: ${path}`);
for (const page of PAGES) {
    const mutated = { ...sources, [page]: sources[page].replace('</head>', '<style>.probe-parent { opacity: .8; }</style></head>') };
    assert(validateCompletePresentation(mutated).length > 0, `${page}: beliebige Texteltern mit Deckkraft werden erkannt`);
}
for (const path of SOURCE_PATHS.filter(path => path.endsWith('.js'))) {
    assert(validateCompletePresentation({ ...sources, [path]: sources[path] + "\nprobe.style.opacity = '.5';" }).length > 0, `${path}: JS-Deckkraft scheitert`);
}
for (const [path, before, after] of [
    ['simulator.css', '.form-group {\n    min-width: 0;', '.form-group {'],
    ['simulator.css', '@container simulator-panel', '@media'],
    ['simulator.css', 'repeat(auto-fit, minmax(200px, 1fr))', '320px 1fr'],
    ['simulator.css', '.heatmap-v4-svg { min-width: 980px; }', '.heatmap-v4-svg { width: 100%; }'],
    ['simulator.css', 'overflow-x: auto; }', 'overflow-x: visible; }'],
    ['Simulator.html', 'observeSelectionText(document.body)', 'void document.body'],
    ['Simulator.html', 'id="scenarioLogOutput" class="ds-table-scroll" tabindex="0" role="region"', 'id="scenarioLogOutput" class="ds-table-scroll"'],
    ['app/simulator/simulator-results.js', 'onSelect: renderSelectedScenario', 'onSelect: () => {}'],
    ['Simulator.html', 'id="scenarioList" class="scenario-list" role="listbox"', 'id="scenarioList" class="scenario-list" role="region"'],
    ['app/simulator/stress-replay-renderer.js', 'role="region" tabindex="0"', 'tabindex="-1"']
]) {
    assert(sources[path].includes(before), `Simulatorgegenprobe trifft Original: ${path}`);
    assert(validateSimulatorLayout({ ...sources, [path]: sources[path].replaceAll(before, after) }).length > 0, `Simulatorgegenprobe scheitert: ${path}`);
}
for (const [path, addition] of [
    ['simulator.css', 'body { overflow-x: hidden; }'],
    ['simulator.css', '.probe { --falsch: var(--border); color: var(--falsch); }'],
    ['simulator.css', '.probe { color: var(--warn); background: var(--bad); }'],
    ['simulator.css', '.probe { color: var(--accent-line); }'],
    ['simulator.css', '.probe { color: rgba(29,40,48,.5); }'],
    ['simulator.css', '.probe { --kreis-a: var(--kreis-b); --kreis-b: var(--kreis-a); color: var(--kreis-a); }'],
    ['Simulator.html', '<style>.probe { color: var(--text-main) !important; }</style>'],
    ['app/balance/balance-storage.js', "probe.style.color = 'var(--border)';"],
    ['app/simulator/simulator-results.js', 'probe.style.cssText = "opacity: .5; color: var(--text-main);";']
]) assert(validateCompletePresentation({ ...sources, [path]: sources[path] + '\n' + addition }).length > 0, `Abschlussgegenprobe scheitert: ${addition}`);
const legacyConsumerSources = { ...sources,
    'app/balance/balance-storage.js': sources['app/balance/balance-storage.js'] + "\nprobe.style.color = 'var(--muted-text)';" };
assertEqual(validateCompletePresentation(legacyConsumerSources).join('\n'), '', 'Synthetischer Legacyconsumer verwendet einen gültigen Textalias');
assert(validateCompletePresentation({ ...legacyConsumerSources, 'css/components.css': sources['css/components.css'].replace('--muted-text: var(--text-muted);', '') }).length > 0,
    'Fehlender Legacyalias wird bei tatsächlicher Verwendung erkannt');
const wrapped = '<div class="ds-chart-scroll" role="region" tabindex="0" aria-label="Daten"><svg><g><text>Probe</text></g></svg></div>';
assertEqual(validateScrollableMarkup(wrapped).join('\n'), '', 'Benannte SVG-Kapsel besteht');
for (const html of [wrapped.replace('role="region"', ''), wrapped.replace('tabindex="0"', ''), wrapped.replace('aria-label="Daten"', ''), '<svg></svg>', '<table><tr><td>1</td></tr></table>']) assert(validateScrollableMarkup(html).length > 0, 'Unbenannte oder ungekapselte Datenausgabe scheitert');
const { validateToolMarkup } = await import('./designsystem-source-contract.mjs');
assert(validateToolMarkup('<svg><g opacity=".5"><text>Probe</text></g></svg>').length > 0, 'SVG-Texteltern dürfen keine Deckkraft erben lassen');
const browserSource = (await import('node:fs')).readFileSync(new URL('./browser-smoke.test.mjs', import.meta.url), 'utf8');
assert(browserSource.includes("['Designsystem simulator layout', runDesignsystemSimulatorLayout]"), 'Simulatorbreitenfall ist im Browser-Smoke registriert');

const { observeSelectionText } = await import('../app/shared/designsystem-selection-text.js');
let notifyOptions, observedOptions, observerRefreshes = 0;
doc.defaultView = { MutationObserver: class {
    constructor(callback) { notifyOptions = callback; }
    observe(root, options) { observedOptions = options; }
} };
const root = { ownerDocument: doc, querySelectorAll() { observerRefreshes++; return [select]; } };
select.selectedOptions = [{ textContent: 'Optionsinitialisierung' }];
observeSelectionText(root);
assertEqual(initial.textContent, 'Optionsinitialisierung', 'Simulatorinitialisierung zeigt vorhandene Auswahl');
assert(observedOptions.childList && observedOptions.subtree && observedOptions.attributeFilter.includes('selected'), 'Beobachter erfasst Optionsrefresh und ausgewählte Attribute');
select.selectedOptions[0].textContent = 'Aktualisierter Optionsvolltext';
notifyOptions([{ target: { closest: () => select }, addedNodes: [] }]);
assertEqual(initial.textContent, 'Aktualisierter Optionsvolltext', 'Optionsmutation aktualisiert den sichtbaren Volltext');
const countBefore = observerRefreshes;
notifyOptions([{ target: {}, addedNodes: [{ nodeType: 3 }] }]);
assertEqual(observerRefreshes, countBefore, 'Eigene Textknoten lösen keine Beobachterschleife aus');
assert(select.value === 'b' && !select.disabled, 'Beobachteter Optionsrefresh erhält Auswahl und Sperre');

// Direkte Propertywechsel: jede Assertion liegt vor einer Observerzustellung.
const selectionDoc = createSelectionDocument();
const nativeDescriptors = Object.getOwnPropertyDescriptors(SelectionSelect.prototype);
const a = addField(selectionDoc, 'direct-a', 'a', [['a', 'Erste Option'], ['b', 'Zweite Option'], ['9', 'Neun']]);
const b = addField(selectionDoc, 'direct-b', 'b', [['a', 'Unabhängige erste Option'], ['b', 'Unabhängige zweite Option']]);
a.disabled = true;
a.setAttribute('aria-describedby', 'fremder-grund');
let artificialEvents = 0;
for (const type of ['change', 'input']) a.addEventListener(type, () => artificialEvents++);
syncSelectionText(a); syncSelectionText(b);
const firstSetter = Object.getOwnPropertyDescriptor(a, 'value').set;
for (let i = 0; i < 3; i++) syncSelectionText(a);
assertEqual(Object.getOwnPropertyDescriptor(a, 'value').set, firstSetter, 'Mehrfache Bindung wickelt den Setter nicht erneut ein');
assertEqual(a.listeners.change.length, 2, 'Mehrfache Bindung ergänzt genau einen change-Listener');
const equalSelection = field => strict.equal(selectionDoc.getElementById(`${field.id}-fulltext`).textContent, field.selectedOptions[0]?.textContent || '', 'Auswahlvolltext entspricht unmittelbar der Auswahl');
for (const [index, value] of [[1, 'b'], [0, 'a'], [-1, ''], [99, ''], [2, '9']]) {
    a.selectedIndex = index;
    assertEqual(a.selectedIndex, index === 99 ? -1 : index, 'Indexsetter erhält Auswahl und leere native Auswahl');
    assertEqual(a.value, value, 'Indexsetter erhält den erwarteten Wert');
    equalSelection(a);
    assertEqual(selectionDoc.getElementById('direct-b-fulltext').textContent, b.selectedOptions[0].textContent, 'Unabhängiges Select bleibt unverändert');
}
for (const value of ['b', 9, 'unbekannt', 'a', 'a']) {
    a.value = value;
    assertEqual(a.value, value === 'unbekannt' ? '' : String(value), 'Wertsetter delegiert Zahlen und unbekannte Werte');
    equalSelection(a);
}
assertEqual(artificialEvents, 0, 'Propertysynchronisierung erzeugt keine input-/change-Events');
assert(a.disabled && a.getAttribute('aria-describedby').includes('fremder-grund'), 'Sperre und fremde Beschreibung erhalten');
assertEqual(selectionDoc.body.querySelectorAll('*').filter(n => n.id.endsWith('-fulltext')).length, 2, 'Nur ein Volltextknoten pro Select');
for (const key of ['value', 'selectedIndex']) {
    const after = Object.getOwnPropertyDescriptor(SelectionSelect.prototype, key);
    assert(after.get === nativeDescriptors[key].get && after.set === nativeDescriptors[key].set, 'Globale DOM-Prototypen unverändert');
}
const indexVariant = await selectionVariant('index-off');
const brokenIndex = addField(selectionDoc, 'broken-index', 'a', [['a', 'Erste Option'], ['b', 'Zweite Option']]);
indexVariant.syncSelectionText(brokenIndex);
brokenIndex.selectedIndex = 1;
assert(brokenIndex.selectedIndex === 1 && brokenIndex.value === 'b', 'Indexgegenprobe wechselt die Auswahl korrekt');
assertEqual(selectionDoc.getElementById('broken-index-fulltext').textContent, 'Erste Option', 'Indexgegenprobe lässt alten Volltext stehen');
assert(strict.throws(() => equalSelection(brokenIndex), strict.AssertionError) === undefined, 'Nur fehlender Indexrefresh scheitert an derselben Gleichheitsassertion');

// Optionsauswahl und Reset umgehen Propertysetter. Echte Funktionsketten
// müssen daher ihren bestehenden expliziten Refresh selbst erreichen.
const originalDocument = globalThis.document;
try {
    globalThis.document = selectionDoc;
    const valueVariant = await selectionVariant('value-off');
    const profiles = addField(selectionDoc, 'profileSelect', 'old', [['old', 'Vorheriges Profil']]);
    valueVariant.syncSelectionText(profiles);
    const renderProfiles = new Function('listProfiles', 'syncSelectionText', `${functionSource('app/profile/profile-manager.js', 'renderProfiles')}\nreturn renderProfiles;`)(
        () => [{ id: 'first', name: 'Erstes Profil' }, { id: 'active', name: 'Aktives zweites Profil' }], valueVariant.syncSelectionText);
    renderProfiles(profiles, 'active');
    assertEqual(profiles.value, 'active', 'Produkt-renderProfiles wählt über option.selected das zweite Profil');
    assertEqual(profiles.selectedIndex, 1, 'Optionsrendern erhält Auswahl abseits der ersten Option');
    equalSelection(profiles);
    assertEqual(selectionDoc.getElementById('profileSelect-fulltext').textContent, profiles.selectedOptions[0].textContent, 'Expliziter Produktrefresh zeigt unmittelbar das ausgewählte Profil');

    const form = selectionDoc.body.appendChild(selectionDoc.createElement('form')); form.id = 'reconciliationForm';
    const tranche = addField(selectionDoc, 'reconcileTrancheId', 'lot-b', [['', 'Tranche über ID auswählen'], ['lot-b', 'Vorherige Tranche']], form);
    valueVariant.syncSelectionText(tranche);
    let resets = 0;
    const reset = form.reset.bind(form);
    form.reset = () => { resets++; reset(); };
    const state = { tranchen: [{ trancheId: 'lot-b', name: 'Aktualisierte Tranche' }], reconciliationStatus: '', reconciliationError: '', reconciliationPreview: {} };
    const paths = ['clearReconciliationPreview', 'renderReconciliationState', 'renderReconciliationOptions'];
    const bodies = paths.map(name => functionSource('app/tranches/tranchen-manager-page.js', name)).join('\n');
    const clear = new Function('state', 'byId', 'syncSelectionText', 'ensureReconciliationCashControls', 'syncInitialCashStatusControls', 'localIsoDate', 'processingIsBlocked', 'renderReconciliationPreview', 'renderReconciliationCashStatuses', 'setReconciliationStatus', 'managerInputSignature', 'RECONCILIATION_INPUT_IDS', `${bodies}\nreturn clearReconciliationPreview;`)(
        state, id => selectionDoc.getElementById(id), valueVariant.syncSelectionText,
        () => null, () => {}, () => '2026-10-04', () => false, () => {}, () => {}, () => {}, () => '', []);
    clear({ resetForm: true });
    assertEqual(resets, 1, 'Vollständige Produktkette setzt das Abgleichformular tatsächlich zurück');
    assertEqual(tranche.value, '', 'Reset hinterlässt die native leere Platzhalterauswahl');
    assertEqual(tranche.selectedIndex, 0, 'Reset und Optionsrendern erhalten Platzhalterindex');
    equalSelection(tranche);
    assertEqual(selectionDoc.getElementById('reconcileTrancheId-fulltext').textContent, tranche.selectedOptions[0].textContent, 'Explizite Reset-/Renderkette zeigt unmittelbar den Platzhaltervolltext');
    assertEqual(state.reconciliationPreview, null, 'Vorhandener Previewzustand wird zurückgesetzt');
} finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; }

// Manager-Modalresets sind angebunden; Simulator-Strategiefelder behalten ihren ID-Vertrag.
const managerHtml = source('depot-tranchen-manager.html');
const trancheForm = managerHtml.match(/<form id="trancheForm">([\s\S]*?)<\/form>/)[1];
assertEqual([...trancheForm.matchAll(/<select[^>]*id="([^"]+)"/g)].map(m => m[1]).sort().join(','), 'category,type', 'Tranche-Reset trifft nur category/type');
assert(sources['css/components.css'].includes('.ds-selection-text[hidden] { display: none; }'), 'Passende Modal-Kurztexte bleiben ohne sichtbare Wiederholung');
const managerSources = ['tranchen-manager-page.js', 'tranchen-manager-modal.js', 'tranchen-manager-renderer.js'].map(p => source(`app/tranches/${p}`)).join('\n');
assert(managerSources.includes('observeSelectionText(document.body)'), 'Manager bindet alle statischen und dynamischen Auswahlen');
assert(validateDataLayout({ ...sources, 'app/tranches/tranchen-manager-page.js': sources['app/tranches/tranchen-manager-page.js'].replace('observeSelectionText(document.body)', 'void document.body') }).length > 0, 'Entfernter Manageranschluss scheitert am Quellvertrag');
const simulatorHtml = source('Simulator.html');
const editor = simulatorHtml.match(/<form id="stressReplayVariantEditor">([\s\S]*?)<\/form>/)[1];
const editorSelects = [...editor.matchAll(/<select\b([^>]*)>/g)];
assertEqual(editorSelects.length, 5, 'Bestandsprüfung umfasst alle fünf Strategie-Selects');
assert(editorSelects.every(m => !/\bid=/.test(m[1])), 'Varianteneditor-Selects besitzen keine IDs');
const replaySources = ['stress-replay-ui.js', 'stress-replay-renderer.js'].map(p => source(`app/simulator/${p}`)).join('\n');
assert(!/\.id\s*=|setAttribute\(\s*['"]id['"]|syncSelectionText|observeSelectionText/.test(replaySources), 'Replay vergibt keine nachträglichen IDs oder zusätzlichen Volltextbindungen');

// Tatsächliche Messwerte und Observerzustellungen, unabhängig von der Jahreszahl.
{
    const { bindBalanceTableOverflow } = await import('../app/balance/balance-presentation-controls.js');
    let resizeCallback, contentCallback, resizeBindings = 0, contentBindings = 0;
    const view = {
        ResizeObserver: class { constructor(callback) { resizeCallback = callback; resizeBindings++; } observe() {} },
        MutationObserver: class { constructor(callback) { contentCallback = callback; contentBindings++; } observe() {} }
    };
    const region = { ownerDocument: { defaultView: view }, clientWidth: 1200, scrollWidth: 1200, innerHTML: '<table></table>' };
    const hint = { hidden: false };
    bindBalanceTableOverflow(region, hint);
    assert(hint.hidden, 'Breite Tabelle ohne Überlauf zeigt keinen Hinweis');
    region.scrollWidth = 1500; contentCallback();
    assert(!hint.hidden, 'Inhaltswechsel mit echtem Überlauf zeigt den Hinweis');
    region.clientWidth = 1600; resizeCallback();
    assert(hint.hidden, 'Breitenwechsel entfernt überholten Hinweis');
    region.clientWidth = 0; resizeCallback();
    assert(hint.hidden, 'Verborgener Tab zeigt keinen Hinweis');
    region.clientWidth = 1000; resizeCallback();
    assert(!hint.hidden, 'Wiederöffnung misst aktuellen Überlauf');
    region.innerHTML = ''; contentCallback();
    assert(hint.hidden, 'Aktive leere Region behält ihren Host ohne Scrollhinweis');
    for (let i = 0; i < 3; i++) bindBalanceTableOverflow(region, hint);
    assertEqual(resizeBindings, 1, 'Resizebindung je Tabellenhost genau einmal');
    assertEqual(contentBindings, 1, 'Inhaltsbindung je Tabellenhost genau einmal');
}

{
    const { validateSimulatorOverviewFrame } = await import('./designsystem-source-contract.mjs');
    assertEqual(validateSimulatorOverviewFrame(sources).join('\n'), '', 'Ergebnisraster misst nutzbare Inhalte ab 2300 px und nutzt Typografietokens');
    for (const [before, after] of [
        ['container: simulator-content / inline-size;', 'container: simulator-sidebar / inline-size;'],
        ['@container simulator-content (min-width: 2300px)', '@media (min-width: 2300px)'],
        ['.sim-overview-backtest { grid-column: span 8; }', '.sim-overview-backtest { grid-column: span 7; }'],
        ['.sim-overview-mc { grid-column: span 4; }', '.sim-overview-mc { grid-column: span 5; }'],
        ['font-size: var(--balance-h1); text-align: left;', 'font-size: 30px; text-align: left;'],
        ['svg.chart-native-svg.chart-native-svg { display: block; width: auto;', 'svg.chart-native-svg.chart-native-svg { display: block; width: 100%;']
    ]) {
        assert(sources['simulator.css'].includes(before), 'Simulator-Gegenprobe trifft die tatsächliche Raster-/Typografiequelle');
        assert(validateSimulatorOverviewFrame({ ...sources, 'simulator.css': sources['simulator.css'].replace(before, after) }).length > 0,
            'Simulator-Gegenprobe erkennt falsche Messfläche, Rastergrenze oder verkleinerte Schrift');
    }
}

// Native SVG-Regel schlägt prozentuale Bestandsregeln auf dem Bildschirm.
const nativeRule = 'svg.chart-native-svg.chart-native-svg { display: block; width: auto; height: auto; min-width: 0; max-width: none; box-sizing: content-box; }';
assert(sources['simulator.css'].includes('@media screen {\n    ' + nativeRule), 'Native Maße gelten ausdrücklich für Bildschirmkaskade');
assert(validateCompletePresentation({ ...sources, 'simulator.css': sources['simulator.css'].replace(nativeRule, nativeRule.replace('width: auto', 'width: 100%')) }).length > 0, 'Gegenprobe: erneut skalierende Diagrammbreite scheitert');
assert(sources['simulator.css'].includes('.chart-title { font: 600 var(--balance-h3)') && sources['simulator.css'].includes('.heatmap-v4-svg .chart-axis-title { font-size: var(--balance-help); }'), 'Titel 18 px und Achsentitel 14 px über vorhandene Rollen');
assert(sources['simulator.css'].includes('.heatmap-footer-pair span { min-width: 0; overflow-wrap: anywhere; }') && sources['simulator.css'].includes('.heatmap-footer-pair strong { white-space: nowrap;'), 'Fußbeschriftung darf umbrechen, Wert und Einheit bleiben zusammen');
