import { syncSelectionText, observeSelectionText } from '../app/shared/designsystem-selection-text.js';
import { bindManagerHistoryStartUI, bindTrancheHistoryUI } from '../app/tranches/tranchen-history-ui.js';
import { bindManagerPersonCards } from '../app/tranches/tranchen-manager-person-cards.js';
import { createSelectionDocument, addField, source, functionSource } from './designsystem-selection-dom.mjs';

const doc = createSelectionDocument();
const form = doc.body.appendChild(doc.createElement('form'));
const long = 'Synthetischer vollständiger Auswahltext '.repeat(8);
const a = addField(doc, 'a', 'long', [['short', 'Kurz'], ['long', long]], form);
a.setAttribute('aria-describedby', 'fremder-grund');
a.disabled = true;
let events = 0;
for (const type of ['input', 'change']) a.addEventListener(type, () => events++);
const observer = observeSelectionText(doc.body);
const text = doc.getElementById('a-fulltext');
assertEqual(text.textContent, long, 'Init erhält den gesamten langen Auswahltext');
assert(!text.hidden && a.getAttribute('aria-describedby').includes('a-fulltext'), 'Tatsächliche Kürzung hat sichtbaren verknüpften Volltext');
a.value = 'short';
assert(text.hidden && text.textContent === 'Kurz', 'Passender Kurztext bleibt aktuell, aber wird nicht sichtbar wiederholt');
assertEqual(a.getAttribute('aria-describedby'), 'fremder-grund', 'Nur eigene ARIA-Referenz wird entfernt');
a.selectedIndex = 1;
assert(!text.hidden && text.textContent === long, 'Nativer Indexsetter aktualisiert Sichtbarkeit unmittelbar');
a.value = 'short';
a.options[0].textContent = long;
a.dispatchEvent({ type: 'change' });
assert(!text.hidden && text.textContent === long, 'Change synchronisiert auch geänderte Optionstexte');
a.options[0].textContent = 'Kurz';
doc.measurements.mutation([{ target: a.options[0], type: 'characterData', addedNodes: [] }]);
assert(text.hidden && text.textContent === 'Kurz', 'Optionsmutation erneuert Inhalt und Kürzungsentscheidung');
a.clientWidth = 40;
doc.measurements.resize(a);
assert(!text.hidden, 'Padding und nativer Auswahlindikator reduzieren den verfügbaren Textbereich');
a.clientWidth = 180;
doc.measurements.resize(a);
assert(text.hidden, 'Resize entfernt passende Wiederholung');
a.fontSize = 100;
doc.measurements.fontsLoaded();
assert(!text.hidden, 'Spätere Schriftladung wird mit tatsächlicher Schrift neu gemessen');
a.fontSize = 16;
doc.measurements.fontsLoaded();
assert(text.hidden, 'Kleinere Schrift entfernt Zusatztext wieder');
a.value = 'long'; form.hidden = true;
doc.measurements.mutation([{ target: form, type: 'attributes', attributeName: 'hidden' }]);
assert(text.hidden && text.textContent === long, 'Verborgene Controls werden nicht als messbare Kürzung ausgegeben');
form.hidden = false;
doc.measurements.mutation([{ target: form, type: 'attributes', attributeName: 'hidden' }]);
assert(!text.hidden, 'Sichtbarwerden erneuert die Messung');
const listenerCount = a.listeners.change.length;
const setter = Object.getOwnPropertyDescriptor(a, 'value').set;
for (let i = 0; i < 4; i++) { syncSelectionText(a); observeSelectionText(doc.body); }
assertEqual(a.listeners.change.length, listenerCount, 'Idempotente Bindung ergänzt keine Listener');
assertEqual(Object.getOwnPropertyDescriptor(a, 'value').set, setter, 'Idempotente Bindung ergänzt keine Setterwrapper');
assertEqual(doc.measurements.mutations.length, 1, 'Genau ein Observer je Root');
assertEqual(doc.measurements.resizes.length, 1, 'Genau ein ResizeObserver je Dokument');
assertEqual(doc.measurements.fontListeners.length, 1, 'Genau ein Fontlistener je Dokument');
assertEqual(observeSelectionText(doc.body), observer, 'Mehrfache Initialisierung erhält denselben Beobachter');
let reads = 0;
const query = doc.body.querySelectorAll.bind(doc.body);
doc.body.querySelectorAll = selector => { reads++; return query(selector); };
doc.measurements.mutation([{ target: text, type: 'childList', addedNodes: [{ nodeType: 3 }] },
    { target: text, type: 'attributes', attributeName: 'hidden' }]);
assertEqual(reads, 0, 'Eigene Spans erzeugen keine Observer-Schleife');
assertEqual(doc.getElementById('a-fulltext'), text, 'Kein doppelter Zusatzknoten');
assert(a.disabled && a.value === 'long', 'Messung erhält Sperre und Auswahl');
assertEqual(events, 1, 'Nur das ausdrücklich ausgelöste Change erzeugt ein Ereignis');
form.reset();
await Promise.resolve();
assertEqual(a.value, 'short', 'Nativer Formularreset erhält den voreingestellten Wert');
assert(text.hidden && text.textContent === 'Kurz', 'Reset liest nach nativer Wirkung die passende kurze Auswahl');
a.value = 'unbekannt';
assert(text.hidden && text.textContent === '', 'Leere Auswahl hinterlässt keinen alten Zusatztext');
const replacement = doc.createElement('option'); replacement.value = 'replacement'; replacement.textContent = long;
a.replaceChildren(); a.appendChild(replacement);
doc.measurements.mutation([{ target: a, type: 'childList', addedNodes: [replacement] }]);
assertEqual(text.textContent, long, 'Optionsersatz aktualisiert den Volltext');
assert(!text.hidden && a.value === 'replacement', 'Optionsersatz bewahrt native Auswahlsemantik');
const later = addField(doc, 'later', 'long', [['long', long]]);
doc.measurements.mutation([{ target: doc.body, type: 'childList', addedNodes: [later] }]);
assert(!doc.getElementById('later-fulltext').hidden, 'Später erzeugtes Select wird automatisch angeschlossen');
const unmeasurable = addField(doc, 'unmeasurable', 'long', [['long', long]]);
unmeasurable.clientWidth = 0;
syncSelectionText(unmeasurable);
assert(doc.getElementById('unmeasurable-fulltext').hidden, 'Fehlende Geometrie ist kein Kürzungsnachweis');
unmeasurable.clientWidth = 180; doc.measurements.resize(unmeasurable);
assert(!doc.getElementById('unmeasurable-fulltext').hidden, 'Später messbares Control wird aktualisiert');

const oldHost = doc.body.appendChild(doc.createElement('div'));
const oldSelect = addField(doc, 'reused-id', 'old', [['old', 'Vorheriger Text']], oldHost);
syncSelectionText(oldSelect);
oldHost.remove();
const newSelect = addField(doc, 'reused-id', 'new', [['new', long]]);
syncSelectionText(newSelect);
doc.measurements.resize(oldSelect);
assertEqual(doc.getElementById('reused-id-fulltext').textContent, long, 'Später Resize eines ersetzten Selects überschreibt keinen aktuellen Volltext');
assert(!doc.measurements.resizes[0].targets.has(oldSelect), 'Entfernter Select wird nicht dauerhaft weiter beobachtet');

// Echter Manager-Initialisierer: der Anschluss muss nach dem Rendern erfolgen.
const managerDoc = createSelectionDocument();
const managerForm = managerDoc.body.appendChild(managerDoc.createElement('form'));
const html = source('depot-tranchen-manager.html');
const ids = [...html.matchAll(/<select\b[^>]*id="([^"]+)"/g)].map(m => m[1]);
// Cashstatus kann statisch im HTML oder erst beim Rendern vorhanden sein.
const managerIds = [...new Set([...ids, 'reconcileCashStatus'])];
for (const id of ids) addField(managerDoc, id, 'short', [['short', 'Kurz'], ['long', long]], managerForm);
let state = { boundDocument: null, profileId: 'fixture' };
const savedDocument = globalThis.document;
try {
    globalThis.document = managerDoc;
    const init = new Function('state', 'resolveActiveProfileId', 'resetRuntimeState', 'byId', 'loadTranchesFromStorage',
        'applyLoadResult', 'applyProfileAssetValuesToDom', 'loadProfileAssetValues', 'updateActiveProfileLabel',
        'bindProfileValueInputs', 'bindControls', 'render', 'renderPersistenceState', 'observeSelectionText',
        'managerInputSignature', 'RECONCILIATION_INPUT_IDS', 'PROFILE_INPUT_IDS', 'getPageNavigationGuard', 'createNavigationOperationLifecycle',
        'bindManagerHistoryStartUI', 'saveManagerHistoryStart', 'bindTrancheHistoryUI', 'renderDepotHistory', 'processingIsBlocked', 'bindManagerPersonCards', 'flushManagerCashInput',
        `${functionSource('app/tranches/tranchen-manager-page.js', 'initTranchenManagerPage')}\nreturn initTranchenManagerPage;`)(
        state, () => 'fixture', () => {}, () => null, () => ({ status: 'empty' }), () => {}, () => {}, () => ({}),
        () => {}, () => {}, () => {}, () => {
            if (!managerDoc.getElementById('reconcileCashStatus')) addField(managerDoc, 'reconcileCashStatus', 'short', [['short', 'Kurz'], ['long', long]], managerForm);
        }, () => {}, observeSelectionText, () => '', [], [],
        () => ({ subscribe: () => () => {}, register: () => ({ notify() {}, unregister() {} }), registerBeforeLeave: () => () => {} }),
        () => ({ isBlocked: () => false }),
        // Echte Verlaufsbinder; die Auswahltext-Fixture enthält keine Verlaufshosts.
        bindManagerHistoryStartUI, () => {}, bindTrancheHistoryUI, () => {}, () => false, bindManagerPersonCards, () => true);
    init(); init();
    for (const id of managerIds) {
        const select = managerDoc.getElementById(id), node = managerDoc.getElementById(`${id}-fulltext`);
        assert(node.hidden && node.textContent === 'Kurz', `${id}: passende Auswahl nach Init ohne Wiederholung`);
        select.value = 'long';
        assert(!node.hidden && node.textContent === long, `${id}: lange programmatische Auswahl vollständig lesbar`);
    }
    for (const id of ['profileHealthBucketTargetMode', 'profileHealthBucketAssetSource', 'reconcileCashStatus']) {
        const select = managerDoc.getElementById(id), node = managerDoc.getElementById(`${id}-fulltext`);
        select.selectedIndex = 0;
        assert(node.hidden, `${id}: unabhängiger Kurztextgegenfall`);
        const counts = { input: 0, change: 0 };
        for (const type of ['input', 'change']) select.addEventListener(type, () => counts[type]++);
        for (const disabled of [false, true]) {
            select.disabled = disabled;
            const value = select.value;
            const option = select.selectedOptions[0];
            // textContent ersetzt Textknoten (childList); Text.data meldet characterData.
            for (const type of ['childList', 'characterData']) {
                const target = type === 'childList' ? option : { nodeType: 3, parentElement: option };
                for (const label of [long, 'Kurz']) {
                    option.textContent = label;
                    managerDoc.measurements.mutation([{ target, type, addedNodes: [] }]);
                    assertEqual(node.textContent, label, `${id}/${type}: reine Textmutation aktualisiert den gesamten Auswahltext`);
                    assertEqual(node.hidden, label === 'Kurz', `${id}/${type}: Lang-/Kurztext hat die passende Sichtbarkeit`);
                    assert(select.value === value && select.disabled === disabled, `${id}/${type}: Observer erhält Wert und Sperre`);
                    assertEqual(JSON.stringify(counts), '{"input":0,"change":0}', `${id}/${type}: reine Textmutation bleibt ereignisfrei`);
                }
            }
            for (const width of [40, 180]) {
                select.clientWidth = width;
                managerDoc.measurements.resize(select);
                assertEqual(node.hidden, width === 180, `${id}: Resize erneuert die Kürzungsentscheidung`);
                assertEqual(node.textContent, 'Kurz', `${id}: Resize erhält den vollständigen Auswahltext`);
            }
            for (let refresh = 0; refresh < 3; refresh++) {
                syncSelectionText(select);
                observeSelectionText(managerDoc.body);
            }
            assert(select.value === value && select.disabled === disabled, `${id}: Resize und wiederholter Refresh erhalten Wert und Sperre`);
            assertEqual(JSON.stringify(counts), '{"input":0,"change":0}', `${id}: Resize und wiederholter Refresh bleiben ereignisfrei`);
        }
        // Getrennte positive Kontrolle: nur das ausdrücklich ausgelöste Ereignis zählt.
        select.disabled = false;
        select.value = 'long';
        select.dispatchEvent({ type: 'change' });
        assert(!node.hidden && node.textContent === long, `${id}: ausdrückliche Benutzeränderung behält den vollständigen Auswahltext`);
        assertEqual(counts.change, 1, `${id}: ausdrückliches Benutzerereignis bleibt beobachtbar`);
        assertEqual(counts.input, 0, `${id}: Benutzer-change erzeugt kein zusätzliches input`);
        const option = managerDoc.createElement('option'); option.value = 'short'; option.textContent = 'Kurz';
        select.replaceChildren(); select.appendChild(option);
        managerDoc.measurements.mutation([{ target: select, type: 'childList', addedNodes: [option] }]);
        assert(node.hidden && node.textContent === 'Kurz', `${id}: unabhängiger Optionsersatz ohne Doppeltext`);
        const second = managerDoc.createElement('option'); second.value = 'long'; second.textContent = long;
        select.appendChild(second); select.value = 'long';
    }
    managerForm.reset();
    await Promise.resolve();
    for (const id of managerIds) {
        const select = managerDoc.getElementById(id), node = managerDoc.getElementById(`${id}-fulltext`);
        assert(select.value === 'short' && node.hidden && node.textContent === 'Kurz', `${id}: nativer Managerreset synchronisiert Kurztext`);
    }
    assertEqual(managerDoc.measurements.mutations.length, 1, 'Wiederholte Managerinitialisierung erzeugt keinen zweiten Observer');
} finally {
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument;
}

// Befund 5: Bildschirm -> Druck -> nach Ereignis wiederhergestellte Geometrie.
{
    const printDoc = createSelectionDocument();
    const metric = addField(printDoc, 'sweepMetric', 'long', [['long', 'Eine besonders lange Auswahl für den Sweep'], ['short', 'Kurz']]);
    metric.setAttribute('aria-describedby', 'fremde-hilfe');
    observeSelectionText(printDoc.body);
    for (let cycle = 0; cycle < 3; cycle++) {
        metric.clientWidth = 1000; printDoc.measurements.resize(metric);
        assertEqual(metric.getAttribute('aria-describedby'), 'fremde-hilfe', 'Druckbreite benötigt keine Volltext-ID');
        printDoc.measurements.windowEvent('afterprint');
        // afterprint kann noch Druckgeometrie sehen. Erst der nächste Frame liest Bildschirmbreite.
        metric.clientWidth = 180; printDoc.measurements.paint();
        assertEqual(metric.getAttribute('aria-describedby'), 'fremde-hilfe sweepMetric-fulltext', 'Tatsächliche Rückkehr stellt Volltext-ID ohne Resize wieder her');
        metric.clientWidth = 0; printDoc.measurements.resize(metric);
        assertEqual(metric.getAttribute('aria-describedby'), 'fremde-hilfe', 'Fehlende Geometrie erfindet keine Kürzung');
        printDoc.measurements.mediaChange(false);
        metric.clientWidth = 180; printDoc.measurements.paint();
        assert(metric.getAttribute('aria-describedby').includes('sweepMetric-fulltext'), 'Medienrückkehr misst nach Layoutwiederherstellung');
    }
    metric.value = 'short'; printDoc.measurements.windowEvent('afterprint'); printDoc.measurements.paint();
    assertEqual(metric.getAttribute('aria-describedby'), 'fremde-hilfe', 'Ungekürzte Auswahl erhält nur fremde IDs');
    assertEqual(printDoc.measurements.windowListeners.filter(e => e.type === 'afterprint').length, 1, 'Ein Drucklistener pro Dokument');
    metric.remove(); printDoc.measurements.windowEvent('afterprint'); printDoc.measurements.paint();
    assert(!printDoc.measurements.resizes[0].targets.has(metric), 'Entfernte Controls werden beim Drucknachlauf aus Beobachtung genommen');
}
