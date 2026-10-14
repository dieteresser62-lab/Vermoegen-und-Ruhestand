import fs from 'node:fs';
import { renderSuiteProfile, renderSuiteHousehold } from '../app/shared/suite-frame.js';
import { renderDataPage } from '../app/data/data-renderer.js';
import { projectDataModel } from '../app/data/data-model.js';
import { createPresentationTestDocument, rules } from './designsystem-source-contract.mjs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { renderOverview } from '../app/overview/overview-renderer.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { projectOverviewMonthSteps } from '../app/overview/overview-month-confirmation.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade, resetPersistenceForTests } from '../app/shared/persistence-facade.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const hosts = {
    'index.html': ['overviewHouseholdNames', 'overviewPrices', 'kursdetails', 'startupPriceStatus', 'overviewPlanningYearValue', 'overviewBackup'],
    'Balance.html': ['suiteHouseholdContext', 'balanceScope', 'balanceChangeScope', 'balancePlanningYearPill', 'balanceMarketDate'],
    'Simulator.html': ['suiteHouseholdContext', 'simulatorContextPills'],
    'depot-tranchen-manager.html': ['managerQuoteContext'],
    'Ausgaben.html': ['expensesContext', 'expensesBudgetSource'],
    'Daten-Sicherung.html': ['dataHouseholdContext', 'dataBackupContextChip', 'dataBackupContext'],
    'Handbuch.html': []
};
function contextErrors(html, ids) {
    const header = html.match(/<header class="suite-header">([\s\S]*?)<\/header>/)?.[1] || '';
    const errors = [];
    for (const id of ['suiteContext', 'suiteProfileContext', ...ids]) {
        if ((html.match(new RegExp(`id="${id}"`, 'g')) || []).length !== 1 || !header.includes(`id="${id}"`)) errors.push(id);
    }
    if (/class="(?:overview-context|balance-context-pills|pv-context|expenses-chips|data-context|sim-context-pills)"/.test(html)) errors.push('lokale Kontextzeile');
    return errors;
}
for (const [page, ids] of Object.entries(hosts)) {
    const html = read(page);
    assertEqual(contextErrors(html, ids).join(','), '', page + ': genau ein globaler Kontext und eindeutige Status-/Aktionshosts');
    assert(contextErrors(html.replace('id="suiteContext"', 'id="suiteContext"><span id="suiteContext"'), ids).includes('suiteContext'), page + ': doppelter Host wird erkannt');
    assert(contextErrors(html.replace('id="suiteProfileContext"', 'id="entfernt"'), ids).includes('suiteProfileContext'), page + ': fehlende Identität wird erkannt');
    if (ids.length) {
        const moved = html.replace(`id="${ids[0]}"`, 'id="verlagert"') + `<div id="${ids[0]}"></div>`;
        assert(contextErrors(moved, ids).includes(ids[0]), page + ': außerhalb des Kopfs verlagerter Status wird erkannt');
    }
}
const expenses = read('Ausgaben.html');
const expensesOrder = ['expenses-toolbar', 'expenses-kpis', 'expensesTable', 'expensesCategories', 'expensesHistoryTitle'];
for (let i = 1; i < expensesOrder.length; i++) assert(expenses.indexOf(expensesOrder[i - 1]) < expenses.indexOf(expensesOrder[i]), 'Ausgabenfolge bleibt erhalten: ' + expensesOrder[i]);
const data = read('Daten-Sicherung.html');
const dataOrder = ['data-stats', 'id="daten-sicherung"', 'id="wiederherstellung"', 'id="kursdienst"', 'id="dataStorageTitle"'];
for (let i = 1; i < dataOrder.length; i++) assert(data.indexOf(dataOrder[i - 1]) < data.indexOf(dataOrder[i]), 'Sicherungsbereiche behalten ihre Reihenfolge: ' + dataOrder[i]);
assert(/class="data-heading ds-page-head"[\s\S]*?class="ds-page-actions" href="Handbuch.html#daten-sicherung"/.test(data), 'Bestehende Datenhilfe steht als Kopfaktion bereit');
const css = read('css/suite-frame.css');
assert(css.includes('min-height: 56px') && css.includes('padding: var(--space-2) var(--space-4)'), 'Standardkopf verwendet kompaktes Tokenpadding und darf wachsen');
assert(css.includes('@container suite-content (width < 65rem)') && css.includes('grid-row: 2; align-self: center'), 'Aktionen stehen auf Titelhöhe und reagieren auf die Inhaltsbreite');

const doc = createPresentationTestDocument();
const create = doc.createElement.bind(doc);
doc.createElement = tag => { const node = create(tag); node.dataset = {}; return node; };
for (const id of [...data.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]).concat('suiteHouseholdContext')) {
    const node = doc.createElement('span'); node.id = id; doc.body.appendChild(node);
}
const name = 'Synthetische Anna Maria mit einem langen Familiennamen & Partner';
renderSuiteProfile(doc, { status: 'ready', id: 'muster-a', name });
renderSuiteHousehold([{ id: 'muster-a', name }], doc);
assertEqual(doc.getElementById('suiteProfileContext').textContent, '', 'Keine Anzeige „Aktives Profil“ mehr (Nutzer 11.10.2026, D6)');
assertEqual(doc.getElementById('suiteHouseholdContext').textContent, 'Haushalt: ' + name, 'Haushaltsanzeige übernimmt exakt den gelieferten Umfang');
renderSuiteHousehold(null, doc);
assertEqual(doc.getElementById('suiteHouseholdContext').textContent, 'Haushalt: nicht verfügbar', 'Fehler wird nicht zur leeren Auswahl');
renderSuiteHousehold([], doc);
assertEqual(doc.getElementById('suiteHouseholdContext').textContent, 'Haushalt: Keine Auswahl', 'Leere Auswahl bleibt unterscheidbar');
let writes = 0;
resetPersistenceForTests({ name: 'kontextprobe', loadAll: async () => ({}), saveBatch: async () => { writes++; } });
try {
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const records = { overview_last_full_backup_v1: '2026-09-01T12:00:00Z' }, before = JSON.stringify(records);
    const model = await projectDataModel({ records, now: new Date('2026-10-02T12:00:00Z') });
    renderDataPage(doc, model); renderDataPage(doc, model);
    assertEqual(doc.getElementById('dataBackupContextChip').dataset.state, 'warning', 'Überfälliger Sicherungsstatus bleibt im Kopf sichtbar');
    assert(doc.getElementById('dataBackupContext').textContent.includes('01.09.2026'), 'Kopf übernimmt das gespeicherte Sicherungsdatum');
    renderDataPage(doc, await projectDataModel({ records: {}, now: new Date('2026-10-02T12:00:00Z') }));
    assertEqual(doc.getElementById('dataBackupContext').textContent, 'Noch keine Vollsicherung', 'Fehlender Sicherungsbeleg bleibt ehrlich');
    assertEqual(JSON.stringify(records), before, 'Projektion und Rendering erhalten Quellwerte');
    assertEqual(writes, 0, 'Wiederholte Kontextprojektion erzeugt keine Speicherung');
} finally { resetPersistenceForTests(); }

// Kleines DOM aus dem echten Markup: native Details und bestehende Knoten,
// ohne Browserstart, Ersatz-Fachlogik oder Finanzwrites.
function overviewDocument(html) {
    const doc = createPresentationTestDocument();
    const create = doc.createElement.bind(doc);
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
    doc.getElementById = id => descendants(doc.body).find(node => node.id === id) || null;
    doc.querySelectorAll = () => [];
    function mount(html, parent) {
        const tree = tokenizeHTML(html);
        const add = (entry, target) => {
            const node = create(entry.tag); node.dataset = {};
            for (const [key, value] of Object.entries(entry.attrs)) {
                node.setAttribute(key, value);
                if (key === 'class') node.className = value;
                if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
            }
            node.open = Object.hasOwn(entry.attrs, 'open');
            node.querySelector = selector => descendants(node).find(child => child.hasAttribute(selector.slice(1, -1))) || null;
            target.appendChild(node);
            entry.children.forEach(child => add(child, node));
            return node;
        };
        tree.document.children.forEach(entry => add(entry, parent));
    }
    mount(html, doc.body);
    const focus = doc.getElementById('overviewFocus');
    Object.defineProperty(focus, 'innerHTML', {
        get() { return this.markup; },
        set(value) { this.markup = value; this.replaceChildren(); mount(value, this); }
    });
    return doc;
}
const overviewHtml = read('index.html');
const overviewDoc = overviewDocument(overviewHtml);
const grid = overviewDoc.getElementById('overviewNormal');
const order = () => grid.children.slice(0, 3).map(node => node.id).join(',');
assertEqual(order(), 'overviewFocus,overviewMetrics,overviewAssetDetails', 'Startseiten-DOM beginnt mit Fokus, Kennzahlen und Personen');
assert(overviewHtml.indexOf('id="overviewAssetDetails"') < overviewHtml.indexOf('id="overviewYearBand"')
    && overviewHtml.indexOf('id="overviewYearBand"') < overviewHtml.indexOf('id="overviewHistory"'), 'Personen und Ausgaben stehen vor dem Verlauf');
const metricCards = overviewDoc.getElementById('overviewMetrics').children;
assertEqual(metricCards.map(node => node.getAttribute('aria-labelledby')).join(','), 'overviewAssetTitle,overviewBudgetTitle,overviewPlanMetricTitle', 'Kennzahlenfolge Vermögen, Monatsbudget, Plan');
const brokenOrder = overviewDocument(overviewHtml);
brokenOrder.getElementById('overviewNormal').appendChild(brokenOrder.getElementById('overviewFocus'));
assert(brokenOrder.getElementById('overviewNormal').children[0].id !== 'overviewFocus', 'DOM-Gegenprobe erkennt den früheren Fokus am Ende');
const overviewCss = read('css/overview.css');
assert(!/@media\s*\((?:min|max)-width/.test(overviewCss), 'Übersicht entscheidet neue Breiten an suite-content');
assert(!overviewCss.includes('grid[data-occasion="play"]'), 'Kein Anlassraster verschiebt schlichte Hinweise ans Ende');
const finalRule = selector => Object.assign({}, ...rules('css/overview.css', overviewCss).filter(rule => rule.selector === selector).map(rule => rule.declarations));
assertEqual(finalRule('.overview-history .history-chart').height, '176px', 'Verlaufsfläche ist auf 176 px verkürzt');
assertEqual(finalRule('.overview-metrics').display, 'grid', 'Drei Kennzahlen besitzen ihren eigenen schrumpfbaren Container');
const balanceHtml = read('Balance.html'), balanceTree = tokenizeHTML(balanceHtml);
const hero = balanceTree.elements.find(node => node.attrs.class?.includes('ov-hero'));
const action = balanceTree.elements.find(node => node.attrs.class?.includes('ov-act'));
assertEqual(hero.parent, action.parent, 'Budget und vollständige Handlung stehen im gemeinsamen Raster');
assert(action.children.some(node => node.attrs.id === 'balanceAnnualAction'), 'Jahresbeschluss bleibt in der Handlungskarte');
assert(balanceTree.elements.some(node => node.attrs.class?.includes('balance-help-link') && node.attrs.href === 'Handbuch.html'
    && node.attrs['aria-label'] === 'Hilfe öffnen' && node.attrs['data-profile-handoff'] === ''), 'Hilfe-Symbol behält Ziel und geschützten Handoff');
const balanceCss = read('css/balance.css');
assert(balanceCss.includes('@container balance-page (max-width: 1180px)')
    && balanceCss.includes('.balance-overview > .ov-hero, .balance-overview > .ov-need { grid-column: span 7; }')
    && balanceCss.includes('.balance-overview > .ov-act, .balance-overview > .ov-next { grid-column: span 5; }'), 'Bei 1280 px bleiben Budget und Handlung nebeneinander');
assert(balanceCss.includes('.balance-page .tab-panel { margin-top: var(--space-3); }'), 'Reiter-/Panelabstand verwendet den reduzierten Token');

let overviewWrites = 0;
resetPersistenceForTests({ name: 'fokusprobe', loadAll: async () => ({}), saveBatch: async () => { overviewWrites++; } });
try {
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const records = createMusterHaushaltRecords('2027-07-01'), original = JSON.stringify(records);
    const base = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_active_profile,
        liveData: records, now: new Date(2027, 6, 1, 12) });
    const focus = overviewDoc.getElementById('overviewFocus');
    for (const kind of ['monthly', 'annual', 'play', 'start']) {
        const model = { ...base, occasion: { ...base.occasion, kind, annualState: 'open' } }, before = JSON.stringify(model);
        renderOverview(overviewDoc, model);
        assertEqual(order(), 'overviewFocus,overviewMetrics,overviewAssetDetails', kind + ': tatsächliche DOM-Reihenfolge bleibt stabil');
        assertEqual(JSON.stringify(model), before, kind + ': Modellbytes bleiben erhalten');
        if (['play', 'start'].includes(kind)) {
            assert(!focus.className.includes('ds-card') && !focus.innerHTML.includes('overview-play') && !focus.innerHTML.includes('Durchspielen'), kind + ': Hinweise ohne Fokuskarte oder Simulatorwerkzeuge');
            assert(focus.innerHTML.includes('Nächster Monatsabschluss:') && focus.innerHTML.includes('Jahresabschluss: Januar.'), kind + ': Abschlusstermine bleiben sichtbar');
        }
        if (['monthly', 'annual'].includes(kind)) {
            const tree = tokenizeHTML(focus.innerHTML), steps = tree.elements.filter(node => Object.hasOwn(node.attrs, 'data-overview-close-step'));
            const done = projectOverviewMonthSteps(model).slice(0, kind === 'annual' ? 3 : 4).filter(step => step.state === 'done');
            assertEqual(steps.length, kind === 'annual' ? 7 : 4, kind + ': alle Schritte genau einmal');
            assertEqual(new Set(steps.map(node => node.attrs['data-overview-close-step'])).size, steps.length, kind + ': keine doppelten Schritte');
            const details = tree.elements.find(node => Object.hasOwn(node.attrs, 'data-overview-completed'));
            assertEqual(Boolean(details), done.length > 0, kind + ': erledigte Gruppe nur mit erledigten Schritten');
            if (details) {
                assert(focus.innerHTML.includes(`Erledigt (${done.length})`), kind + ': korrekte Gruppenzahl');
                assert(steps.filter(node => node.attrs['data-state'] === 'done').every(node => node.parent === details), kind + ': erledigte Schritte ausschließlich in Details');
                assert(steps.filter(node => node.attrs['data-state'] !== 'done').every(node => node.parent !== details), kind + ': offene Schritte bleiben außerhalb der Gruppe');
                const group = focus.querySelector('[data-overview-completed]'); group.open = true;
                renderOverview(overviewDoc, model);
                assertEqual(focus.querySelector('[data-overview-completed]').open, true, kind + ': geöffnete Inhalte überstehen Aktualisierung');
                focus.querySelector('[data-overview-completed]').open = false;
            }
            const start = tree.elements.filter(node => Object.hasOwn(node.attrs, kind === 'annual' ? 'data-overview-annual' : 'data-overview-month-confirm'));
            assertEqual(start.length, 1, kind + ': genau ein unverändert angebundener Abschlussstart');
            assertEqual(start[0].parent.tag, 'header', kind + ': Abschlussstart steht im Kartenkopf');
        }
        assertEqual(overviewDoc.getElementById('overviewAssets').textContent,
            new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(model.household.assets), kind + ': Vermögenswert stammt aus bestehendem Modell');
    }
    for (const [state, label] of [['unclear', 'Jahresstatus klären'], ['recovery', 'Wiederherstellung öffnen'], ['unavailable', 'Daten prüfen']]) {
        renderOverview(overviewDoc, { ...base, occasion: { ...base.occasion, kind: 'annual', annualState: state } });
        assert(focus.innerHTML.includes(label) && focus.innerHTML.includes('data-overview-annual'), state + ': vorhandener Klärungs-/Recoveryweg bleibt beschriftet');
    }
    const fixed = { ...base.planComparison, recordStatus: 'valid', year: 2027, planLabel: 'Plan 2027 · festgeschrieben',
        rows: [{ label: 'Monatsbudget', plan: '1.234 €', preview: '9.999 €' }] };
    for (const [comparison, value, source] of [
        [fixed, '1.234 €', 'festgeschrieben'],
        [{ ...fixed, recordStatus: 'missing', previewStatus: 'current', notice: 'Noch kein festgeschriebener Plan', previewNotice: 'Gerechnet am 01.07.2027' }, '9.999 €', 'Jahresabschluss-Vorschau'],
        [{ ...fixed, recordStatus: 'missing', previewStatus: 'stale', notice: 'Noch kein festgeschriebener Plan', previewNotice: 'Vorschau noch nicht mit dem aktuellen Plan gerechnet' }, '9.999 €', 'Vorschau veraltet'],
        [{ ...fixed, recordStatus: 'invalid', previewStatus: 'current', notice: 'Der Jahresbeleg ist beschädigt.' }, '9.999 €', 'beschädigt'],
        [{ ...fixed, recordStatus: 'invalid', previewStatus: 'missing', notice: 'Der Jahresbeleg ist beschädigt.' }, '—', 'beschädigt'],
        [{ ...fixed, recordStatus: 'missing', previewStatus: 'missing', notice: 'Noch kein festgeschriebener Plan' }, '—', 'Für 2027 in Balance rechnen']
    ]) {
        renderOverview(overviewDoc, { ...base, planComparison: comparison });
        assertEqual(overviewDoc.getElementById('overviewBudgetValue').textContent, value, 'Budgetkennzahl priorisiert belegte Quelle: ' + source);
        assert(overviewDoc.getElementById('overviewBudgetSource').textContent.includes(source), 'Budgetkennzahl zeigt Herkunft/Leerstand: ' + source);
    }
    assertEqual(overviewDoc.getElementById('overviewPlanMetricValue').textContent, 'Noch kein Jahresplan', 'Leerer Plan zeigt den tatsächlichen Zustand');
    assertEqual(JSON.stringify(records), original, 'Gruppieren, Aufklappen und Kennzahlen erhalten Finanzrecords');
    await PersistenceFacade.flush();
    assertEqual(overviewWrites, 0, 'Rendering und native Details schreiben keine Fachdaten');
} finally { resetPersistenceForTests(); }

// Abschlussanordnung: die bestehenden Ansichtswege bleiben die einzige Navigation.
const managerTree = tokenizeHTML(read('depot-tranchen-manager.html'));
const managerNode = id => managerTree.elements.find(node => node.attrs.id === id);
const inside = (node, ancestor) => { for (let p = node?.parent; p; p = p.parent) if (p === ancestor) return true; return false; };
assert(managerTree.elements.indexOf(managerNode('managerSectionNav')) < managerTree.elements.indexOf(managerNode('managerHousehold')), 'Personenreiter stehen vor großen Inhaltskarten');
assert(inside(managerNode('managerHousehold'), managerNode('managerPlanPanel')), 'Haushalts- und Personenübersicht bleibt im bestehenden Planmodus zugänglich');
assert(managerTree.elements.indexOf(managerNode('managerPersonBody')) < managerTree.elements.indexOf(managerNode('managerWealthHistory')), 'Person & Einkommen beginnt vor dem ausführlichen Verlauf');
const depotLinks = managerTree.elements.filter(node => node.attrs.href === '#managerDepotTitle' && inside(node, managerNode('personendaten')));
assertEqual(depotLinks.length, 1, 'Genau ein Depot-Sprung im sichtbaren Personenansichtskopf');
assertEqual(managerNode('managerSectionNav').attrs.role, 'tablist', 'Keine zusätzliche Sprungleiste');
const managerCss = read('css/personen-vermoegen.css');
assert(managerCss.includes('.pv-plan-overview .pv-household-grid { grid-template-columns: repeat(3, minmax(0, 1fr))') && managerCss.includes('#managerPlanPanel { display: grid; grid-template-columns: minmax(0, 1fr)'), 'Vermögenskarten stehen nebeneinander, die Bedarfszeile folgt über volle Breite');
const simulatorTree = tokenizeHTML(read('Simulator.html'));
const resultAnswers = simulatorTree.elements.find(node => node.attrs.id === 'overviewMonteCarloAnswers');
const mcOverview = simulatorTree.elements.find(node => node.attrs.id === 'overviewMonteCarlo');
assert(resultAnswers.parent === mcOverview.parent && simulatorTree.elements.indexOf(resultAnswers) < simulatorTree.elements.indexOf(mcOverview), 'Beide vorhandenen MC-Kernantworten stehen oben vor den Deckungsdetails und Rechencontrols');
assertEqual(simulatorTree.elements.filter(node => node.attrs.id === 'monteCarloAnswers').length, 1, 'Detailreiter behält seinen eindeutigen Antwort-Host');
