import fs from 'node:fs';
import strictAssert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { parseExpensesTarget, expensesHref, expensesDestination, navigateExpenses, applyExpensesTarget } from '../app/shared/expenses-navigation.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { UIBinder } from '../app/balance/balance-binder.js';
import { functionSource } from './designsystem-selection-dom.mjs';
for (const hash of ['#ausgaben', '#ausgaben-import', '']) {
    for (const search of ['?year=1900', '?year=2026&month=9', '?year=9999&month=12']) {
        const request = parseExpensesTarget({ hash, search });
        assert(request, 'Gültige Jahres-/Monatsvariante: ' + hash + search);
        const url = new URL(expensesHref(request), 'https://suite.invalid/');
        assertEqual(url.search, search, 'Jahr und Monat kommen unverändert an');
        assertEqual(url.hash, hash || '#ausgaben', 'Importabsicht bleibt erhalten');
    }
}
for (const hash of ['#ausgaben', '#ausgaben-import']) {
    assertEqual(expensesHref(parseExpensesTarget({ hash })), 'Ausgaben.html' + hash, 'Parameterloses Altziel ergänzt keine Periode');
}
for (const search of ['?year=1899', '?year=10000', '?year=2026&year=2027', '?year=2026&month=1&month=2', '?month=1', '?year=2026&month=0', '?year=2026&month=13', '?year=2026&month=01', '?year=', '?year=2026&fremd=1']) {
    assertEqual(parseExpensesTarget({ hash: '#ausgaben', search }), null, 'Ungültige oder doppelte Parameter wirken nicht: ' + search);
}
for (const hash of ['#abschluss', '#jahresabschluss', '#handlungsanweisung', '#unbekannt']) {
    assertEqual(parseExpensesTarget({ hash, search: '?year=2026' }), null, 'Andere Ziele bleiben erhalten: ' + hash);
    const href = 'Balance.html?year=2026' + hash;
    assertEqual(expensesDestination(href), href, 'Kein Plan-/Abschlusslink wird zum Ausgabenlink');
}
assertEqual(expensesDestination('Balance.html?year=2026&month=9#ausgaben-import'), 'Ausgaben.html?year=2026&month=9#ausgaben-import', 'Dynamische Altlinkproduzenten erhalten direkte Ziele');
const source = fs.readFileSync(new URL('../app/balance/balance-main.js', import.meta.url), 'utf8');
assert(source.includes('await UIBinder.initializeExpensesNavigation?.({ doc: document, win: window })'), 'Main wartet vor der Planmigration auf den produktiven Binder-Navigationsstart');
assert(source.indexOf('if (initialExpensesTarget)') < source.indexOf('let planRefreshReady'), 'Initialer Altlink verlässt Balance vor Planmigration');
assert(source.indexOf('if (initialExpensesTarget)') < source.indexOf('engineHandshake = initVersionHandshake'), 'Initialer Altlink verlässt Balance vor Engineberechnung');
assert(!source.includes('initExpensesTab') && !source.includes('updateExpensesBudget') && !source.includes('expensesPageStorage'), 'Balance initialisiert und schreibt keine Ausgabenansicht');
const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
assert(!/id="(?:tab-expenses|expensesCsvInput|expensesDetailDialog)"/.test(html), 'Kein verborgenes Ausgabenpanel oder Dateifeld in Balance');
assertEqual([...html.matchAll(/role="tab"/g)].length, 3, 'Balance besitzt drei Hauptreiter');
for (const outcome of ['initial', 'denied', 'normal']) {
    const events = new Map(), navigations = [];
    const win = { location: outcome === 'normal' ? { hash: '', search: '' } : { hash: '#ausgaben-import', search: '?year=2025&month=3' },
        addEventListener: (event, callback) => events.set(event, callback) };
    const doc = {};
    const navigate = async (request, options) => { navigations.push({ request, options }); return outcome !== 'denied'; };
    assertEqual(await UIBinder.initializeExpensesNavigation({ doc, win, navigate }), outcome !== 'normal',
        outcome + ': gültiges Altziel stoppt Balance auch bei verweigerter Navigation');
    assertEqual(navigations.length, outcome === 'normal' ? 0 : 1, outcome + ': Normalstart navigiert nicht');
    if (navigations.length) {
        assertEqual(JSON.stringify(navigations[0].request), JSON.stringify({ target: 'ausgaben-import', year: 2025, month: 3 }), outcome + ': Initiales Ziel bleibt exakt erhalten');
        assertEqual(navigations[0].options.replace, true, outcome + ': Initiales Ziel ersetzt den Altlink');
    }
    win.location = { hash: '#ausgaben', search: '?year=2027' };
    events.get('hashchange')();
    const later = navigations.at(-1);
    assertEqual(later.request.year, 2027, outcome + ': späterer Hashwechsel liest die aktuelle Anfrage');
    assertEqual(typeof later.options.beforeLeave, 'function', outcome + ': späterer Wechsel bestätigt ausstehende Balance-Eingaben');
    assertEqual(later.options.replace, undefined, outcome + ': späterer Wechsel erhält den Zurückweg');
}
const browserSource = fs.readFileSync(new URL('./browser-smoke.test.mjs', import.meta.url), 'utf8');
function smokeSection(source, start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
    strictAssert(from >= 0 && to > from, 'Nichtleere Quellgrenzen: ' + start + ' / ' + end);
    strictAssert.equal(source.indexOf(start, from + start.length), -1, 'Eindeutige Startgrenze: ' + start);
    strictAssert.equal(source.indexOf(end, to + end.length), -1, 'Eindeutige Endgrenze: ' + end);
    return source.slice(from, to);
}
const exampleFlow = smokeSection(browserSource, 'async function runProbelaufExampleExpenses(', 'async function runProbelaufAnnualOffline(');
assert(exampleFlow.includes('await page.goto(`${baseUrl}/Balance.html`); await waitForWealthBrowserStartup(page);'), 'Browser-Spielbereich wartet beim Normalstart auf Balance-Bereitschaft');
assert(!exampleFlow.includes('.tab-btn[data-tab="overview"]'), 'Browser-Spielbereich verwendet auf der Ausgabenseite keinen Balance-Reiterlocator');
assert(exampleFlow.includes("await activateSuiteSection(page, 'overview');\n                await page.locator('#jahresabschlussBtn').click();"), 'Browser-Spielbereich wechselt vor dem Jahresabschluss zurück zu Balance');
assert(browserSource.includes("await page.waitForURL(url => url.pathname.endsWith('/Ausgaben.html'));"), 'Ausgaben-Bereitschaft wird erst auf der tatsächlichen Zielseite geprüft');
// Die echten Smoke-Sequenzen mit verzögerter Altlinkweiterleitung ausführen.
// Falsche Bereitschaftshelfer und Balance-Locatoren auf Ausgaben schlagen sofort fehl.
const suiteSectionSource = smokeSection(browserSource, 'async function activateSuiteSection(', 'async function withBalancePanel(');
const finishYearSource = smokeSection(exampleFlow, 'const finishYear = async year => {', '\n        try {');
const prepareBrowserCloseSource = smokeSection(browserSource, 'async function prepareBrowserClose(', 'async function startCloseProbelauf(');
const normalStartSource = smokeSection(exampleFlow, '\n        try {', '// Ausgangsbestand').slice('\n        try {'.length);
for (const year of [2026, 2027]) {
    let currentUrl = 'https://suite.invalid/index.html', redirectUrl = null;
    const events = [];
    const preparationSteps = ['prices', 'expenses', 'budget', 'cash', 'market', 'preview'];
    const visited = new Set(['prices']);
    let cashConfirmed = false, resultConfirmed = false, dialogClosed = false;
    let completionReads = 0;
    const dialogRoot = {
        async waitFor() { assertEqual(new URL(currentUrl).pathname, '/Balance.html', 'Vorbereitung bleibt im Balance-Jahresdialog'); },
        locator(selector) {
            if (selector === '[data-tagesgeld-apply]') return { async all() { return []; } };
            if (selector === '[data-tagesgeld-confirm]') return {
                async all() { return [{ async isVisible() { return !cashConfirmed; }, async click() {
                    assert(visited.has('cash'), 'Stand stimmt folgt dem sichtbaren Tagesgeldschritt');
                    cashConfirmed = true; events.push('cash-confirmed');
                } }]; },
                async count() { return 1; },
                async click() {
                    assert(visited.has('cash'), 'Stand stimmt folgt dem sichtbaren Tagesgeldschritt');
                    cashConfirmed = true; events.push('cash-confirmed');
                }
            };
            if (selector === '[data-close-dialog-step="cash"] .close-dialog-step-pill') return {
                async textContent() { return cashConfirmed ? 'eingetragen' : 'offen'; }
            };
            if (selector === '[data-close-dialog-step]:not([data-visited="true"]):not([data-locked="true"]) [data-close-dialog-activate]') return {
                async evaluateAll(project) { return project(preparationSteps.filter(id => !visited.has(id))
                    .map(id => ({ dataset: { closeDialogActivate: id } }))); },
                // Playwright all() liefert dynamische nth-Locatoren. Ein Besuch
                // verschiebt deren Liste; die alte Schleife muss hier scheitern.
                async all() { return preparationSteps.filter(id => !visited.has(id)).map((_, index) => ({
                    async click() {
                        const id = preparationSteps.filter(id => !visited.has(id))[index];
                        strictAssert(id, 'Positionsgebundener Vorbereitungsklick hat kein Ziel mehr');
                        return page.locator(`[data-close-dialog-activate="${id}"]`).click();
                    }
                })); }
            };
            if (/^\[data-close-dialog-activate="[^"]+"\]$/.test(selector)) return page.locator(selector);
            throw new Error('Unerwarteter Jahresdialog-Locator: ' + selector);
        }
    };
    const page = {
        url: () => currentUrl,
        async goto(href) {
            currentUrl = href;
            redirectUrl = new URL(href).hash === '#ausgaben' ? href.replace('/Balance.html', '/Ausgaben.html') : null;
        },
        async waitForURL(predicate) {
            if (redirectUrl) { currentUrl = redirectUrl; redirectUrl = null; }
            assert(predicate(new URL(currentUrl)), 'Altlink erreicht Ausgaben mit unverändertem Jahr und Hash');
        },
        async reload() { assert(new URL(currentUrl).pathname === '/Ausgaben.html', 'Profilneustart bleibt auf Ausgaben'); },
        async evaluate() {
            if (new URL(currentUrl).pathname === '/Balance.html') {
                assert(resultConfirmed, 'Schreibfreiheitsprobe liest erst das bestätigte Ergebnis');
                completionReads++;
                return { records: [['synthetic-receipt', 'confirmed']], snapshots: [{ id: 'synthetic-year' }, { id: 'synthetic-month' }] };
            }
            assert(new URL(currentUrl).pathname === '/Ausgaben.html', 'Profilwechsel erfolgt auf Ausgaben');
        },
        locator(selector) {
            if (selector === '[data-close-dialog-host][open]') return { first: () => dialogRoot };
            const expenses = selector.startsWith('#expensesYearSegments');
            const expected = expenses ? '/Ausgaben.html' : '/Balance.html';
            return {
                async count() { return 0; },
                filter({ hasText }) {
                    assert(selector === '#annualConfirmBtn' && hasText.test('Fertig') && !hasText.test('Abschluss starten'), 'Ergebnisaktion verlangt ausdrücklich Fertig');
                    return this;
                },
                async isVisible() { return resultConfirmed && selector === '#annualConfirmBtn'; },
                async isEnabled() { return resultConfirmed && selector === '#annualConfirmBtn'; },
                async click() {
                    assertEqual(new URL(currentUrl).pathname, expected, 'Locator auf der zugehörigen Seite: ' + selector);
                    strictAssert(selector !== '#annualCloseBtn' || !resultConfirmed, 'Verborgener Schließenknopf ist nach Ergebnis C unbedienbar');
                    const step = selector.match(/^\[data-close-dialog-activate="([^"]+)"\]$/)?.[1];
                    if (step) {
                        assert(preparationSteps.includes(step), 'Vorbereitung öffnet ausschließlich Schritte 1–6');
                        visited.add(step);
                    }
                    if (selector === '#annualConfirmBtn' && resultConfirmed) {
                        dialogClosed = true; events.push('#annualConfirmBtn:Fertig'); return;
                    }
                    if (selector === '#annualConfirmBtn') {
                        assert(visited.size === 6 && cashConfirmed, 'Jahresbestätigung folgt sechs Besuchen und Tagesgeldbestätigung');
                        resultConfirmed = true;
                    }
                    events.push(selector);
                },
                async waitFor({ state } = {}) {
                    assertEqual(new URL(currentUrl).pathname, expected, 'Jahresdialog wartet auf Balance');
                    if (selector === '[data-annual-combined-result="C"]') assert(resultConfirmed && state === 'visible', 'Fertig folgt dem sichtbaren kombinierten Ergebnis');
                    if (selector === '#balanceAnnualClose' && state === 'hidden') assert(dialogClosed, 'Fertig entfernt den bestätigten Dialog');
                }
            };
        }
    };
    const context = {
        page, baseUrl: 'https://suite.invalid', annualFixtures: {}, URL, assert,
        waitExpensesBrowser: async () => {
            assertEqual(new URL(currentUrl).pathname, '/Ausgaben.html', 'Ausgaben-Bereitschaft erst nach tatsächlicher Ankunft');
            events.push('expenses-ready');
        },
        waitForWealthBrowserStartup: async () => {
            assertEqual(new URL(currentUrl).pathname, '/Balance.html', 'Normalstart und Rückkehr warten auf Balance');
            events.push('balance-ready');
        },
        waitForPageCondition: async () => {
            assertEqual(new URL(currentUrl).pathname, '/Balance.html', 'Abschlussbestätigung wartet auf Balance');
        },
        idle: async () => {}
    };
    await runInNewContext(`(async () => { ${normalStartSource} })()`, context);
    assertEqual(events.join(','), 'balance-ready,expenses-ready', 'Normalbetrieb prüft Balance und Beispielimport-Abwesenheit am echten Ausgabenhost');
    events.length = 0;
    await runInNewContext(`(async () => { ${suiteSectionSource} ${prepareBrowserCloseSource} ${finishYearSource} await finishYear(${year}); })()`, context);
    assertEqual(context.annualFixtures.targetYear, year, 'Jahresabschluss verwendet das angeforderte Jahr');
    const preparationEvents = [...preparationSteps.slice(1), 'cash'].map(id => `[data-close-dialog-activate="${id}"]`).join(',');
    assertEqual(events.join(','), `expenses-ready,expenses-ready,#expensesYearSegments [data-balance-year="${year}"],balance-ready,.tab-btn[data-tab="overview"],#jahresabschlussBtn,${preparationEvents},cash-confirmed,#annualConfirmBtn,#annualConfirmBtn:Fertig`, 'Altlink, Profilneustart, Rückkehr und sichtbare Vorbereitung stehen vor dem Jahresabschluss mit Fertig');
    assertEqual(completionReads, 2, 'Fertig vergleicht Finanzrecords und Sicherungen vor und nach dem Schließen');
    currentUrl = 'https://suite.invalid/Balance.html';
    await strictAssert.rejects(() => page.locator('#annualCloseBtn').click(), /Verborgener Schließenknopf/);
    assert(true, 'Gegenprobe lehnt die alte verborgene Ergebnisaktion ab');
    currentUrl = 'https://suite.invalid/Balance.html';
    visited.clear(); visited.add('prices'); cashConfirmed = false;
    const positionalPreparation = prepareBrowserCloseSource.replace(/const unseen = await root\.locator\(([\s\S]+?)\)\s*\.evaluateAll\([\s\S]+?for \(const id of unseen\) \{\s*await root\.locator\(`[^`]+`\)\.click\(\);/,
        'for (const button of await root.locator($1).all()) { await button.click();');
    strictAssert.notEqual(positionalPreparation, prepareBrowserCloseSource, 'Gegenprobe ersetzt die echte Klickschleife');
    await strictAssert.rejects(() => runInNewContext(`(async () => { ${positionalPreparation} await prepareBrowserClose(page); })()`, context),
        /Positionsgebundener Vorbereitungsklick hat kein Ziel mehr/);
    assert(true, 'Dynamische Besuchsliste weist die ursprüngliche nth-Klickschleife zurück');
}
for (const failure of ['none', 'guard', 'flush', 'export', 'ready', 'changed', 'input']) {
    const status = { hidden: true }, doc = { getElementById: () => status };
    const win = { name: 'vorher', location: { href: '', replace(href) { this.replaced = href; } } };
    const guard = createNavigationGuard();
    const owner = failure === 'guard' ? guard.register('write', { read: () => ({ phase: 'commit' }) }) : null;
    let exports = 0, flushes = 0;
    const result = await navigateExpenses({ target: 'ausgaben-import', year: 2026, month: 9 }, {
        doc, win, guard, replace: true, beforeLeave: async () => failure !== 'input', ready: async () => failure !== 'ready',
        exporter: async () => { exports++; win.name = 'übergabe'; if (failure === 'export') throw new Error('export'); },
        flush: async () => { flushes++; if (failure === 'changed') guard.register('new-write', { read: () => ({ phase: 'commit' }) }); return failure !== 'flush'; }
    });
    assertEqual(result, failure === 'none', failure + ': Navigation nur nach bestätigtem Guard, Profil und Flush');
    assertEqual(win.location.replaced || '', failure === 'none' ? 'Ausgaben.html?year=2026&month=9#ausgaben-import' : '', failure + ': Initiale Navigation ersetzt Historie nur bei Erfolg');
    assertEqual(win.location.href, '', 'Initiale Weiterleitung erzeugt keinen Zurücklink');
    if (failure !== 'none') assertEqual(win.name, 'vorher', failure + ': Abgebrochene Übergabe erhält Fensternamen');
    if (['guard', 'ready', 'input'].includes(failure)) assertEqual(exports + flushes, 0, failure + ': Keine Übergabe hinter gesperrter Bereitschaft');
    owner?.unregister();
}
let selected, focused = 0;
const target = { focus() { focused++; } }, selectors = [];
const doc = { getElementById(id) { return id === 'expensesTable' ? { querySelector(selector) { selectors.push(selector); return target; } } : null; } };
assert(applyExpensesTarget({ selectYear: year => { selected = year; } }, { search: '?year=2025&month=8', hash: '#ausgaben-import' }, doc), 'Lesende Ankunft akzeptiert gültiges Ziel');
assertEqual(selected, 2025, 'Ankunft übernimmt das Ansichtsjahr');
assertEqual(focused, 1, 'Ankunft fokussiert ohne Dateidialog oder Import');
assertEqual(selectors[0], 'button[data-action="import"][data-month="8"]', 'Importziel fokussiert die passende Monatsaktion');

// Die Seitengrenzen werden mit echten Smoke-Quellen betrieben. Das DOM-Double
// kennt drei Ausgabenregionen, geschlossene Jahreswerte, Bereitschaft und den
// vor jedem Dokumentstart installierten Observer. Layoutwerte sind synthetisch;
// die tatsächliche Layout-/Browserabnahme bleibt extern.
const expensesWaitSource = smokeSection(browserSource, 'async function waitExpensesBrowser(', 'async function assertExpensesBrowserRegions(');
const regionsSource = smokeSection(browserSource, 'async function assertExpensesBrowserRegions(', 'async function activateSuiteSection(');
const startupSource = smokeSection(browserSource, 'async function waitForWealthBrowserStartup(', '// page.evaluate serialisiert diese Funktion');
const visibilityFunction = smokeSection(browserSource, 'async function assertWealthBrowserVisibility(', 'async function waitExpensesBrowser(');
const absenceSource = smokeSection(visibilityFunction, "    assert(await page.locator('#expensesHistoryChart,", '\n}');
const designFunction = smokeSection(browserSource, 'async function runDesignsystemBalance(', 'async function runDesignsystemSimulatorResults(');
const designOpening = smokeSection(designFunction, '    const smoke = await openSmokePage(', '\n    try {');
const designMeasurements = smokeSection(designFunction, '        for (const width of [1920, 2560]) {', '        const checkOrigins = async () => {');
const dataFunction = smokeSection(browserSource, 'async function runDesignsystemDataLayout(', '// Beobachtung wird vor Produktinitialisierung');
const dataOpening = smokeSection(dataFunction, '    const smoke = await openSmokePage(', '    const noPageOverflow = async label => {');
const overflowSource = smokeSection(dataFunction, '    const noPageOverflow = async label => {', '    const fulltext = async selector => {');
const scrollSource = smokeSection(dataFunction, '    const scrollByKeyboard = async selector => {', '\n    try {');
const dataMeasurements = smokeSection(dataFunction, "        await page.goto(`${baseUrl}/Balance.html`, { waitUntil: 'load' });", '        smoke.assertNoErrors();');
const commonSmokeSources = expensesWaitSource + regionsSource + suiteSectionSource + startupSource;

function createSmokeVm() {
    let currentUrl = 'https://suite.invalid/index.html', redirectUrl = null;
    let ready = false, observer = false, historyActive = false, media = 'screen';
    let viewportWidth = null;
    const events = [], wealthTransitions = [], window = {}, document = { documentElement: { dataset: {}, scrollWidth: 1300, clientWidth: 1366 }, activeElement: null };
    let nodes = new Map(), details;
    const onPage = expected => {
        strictAssert.equal(new URL(currentUrl).pathname, '/' + expected, 'Falsche Seite: ' + expected);
        strictAssert(ready, 'Locator/Prüfung vor Seitenbereitschaft');
    };
    const expenses = () => new URL(currentUrl).pathname === '/Ausgaben.html';
    function load(href) {
        currentUrl = href; ready = false; historyActive = false; nodes = new Map(); details = { open: false };
        document.activeElement = null; document.documentElement.dataset.expensesReady = 'false';
        delete window.__smokeChartStable;
        if (observer) window.__wealthPendingUpdates = new Set();
        else delete window.__wealthPendingUpdates;
        const ids = expenses() ? ['expensesTable', 'expensesHistoryChart', 'expensesHistoryTable', 'expensesYearSelect']
            : ['miniSummary', 'wealthHistoryChart', 'wealthHistoryTable', 'handlungsanweisung', 'print-footer', 'wealthHistoryScrollHint', 'tab-history', 'tab-overview', 'actionDetailsDialog', 'openDiagnosisBtn'];
        ids.forEach((id, order) => nodes.set(id, {
            id, order, parentElement: { id }, dataset: id === 'tab-history' || id === 'tab-overview' ? { tab: id.slice(4) } : {}, style: {}, scrollLeft: 0, clientWidth: 500, scrollWidth: 1000,
            getBoundingClientRect() { return { width: id.startsWith('wealth') ? 2510 : 3710, height: id.startsWith('wealth') ? 360 : 270 }; },
            viewBox: { baseVal: { width: id.startsWith('wealth') ? 2510 : 3710 } },
            compareDocumentPosition(other) { return this.order < other.order ? 4 : 0; },
            closest: () => details,
            focus() { document.activeElement = this; },
            getAttribute(name) {
                if (name === 'aria-selected' && this.dataset.tab) return String(this.dataset.tab === 'history' ? historyActive : !historyActive);
                return name === 'id' ? id : name === 'tabindex' ? '0' : null;
            }
        }));
        if (expenses()) {
            nodes.set('matrix', { ...nodes.get('expensesTable'), id: 'matrix' });
        }
        events.push('load:' + new URL(href).pathname);
    }
    function resolve(selector) {
        if (selector.includes(',')) return selector.split(',').flatMap(part => resolve(part.trim()));
        if (selector === '.expenses-table-region') return expenses() ? ['matrix', 'expensesHistoryChart', 'expensesHistoryTable'].map(id => nodes.get(id)) : [];
        if (selector === '.expenses-table-region[aria-label="Monatsausgaben"]') return expenses() ? [nodes.get('matrix')] : [];
        if (selector.startsWith('#expensesTable tbody tr')) return Array(12).fill(nodes.get('expensesTable'));
        if (selector.startsWith('#expensesHistoryTable tbody tr')) return Array(24).fill(nodes.get('expensesHistoryTable'));
        if (selector.startsWith('#wealthHistoryChart svg')) return historyActive ? [nodes.get('wealthHistoryChart')].filter(Boolean) : [];
        if (selector.startsWith('#expensesHistoryChart svg')) return [nodes.get('expensesHistoryChart')].filter(Boolean);
        if (selector.includes('.tab-btn[data-tab="expenses"]') || selector === '#tab-expenses') return [];
        if (selector.startsWith('.tab-btn[data-tab=')) return [nodes.get('tab-' + selector.match(/data-tab="([\w-]+)"/)?.[1])].filter(Boolean);
        if (['.form-column', '.tab-buttons'].includes(selector)) return [nodes.get('miniSummary')].filter(Boolean);
        if (selector === '.value') return [nodes.get('miniSummary')].filter(Boolean);
        if (selector.includes('.ds-scroll-hint')) return [nodes.get('wealthHistoryScrollHint')].filter(Boolean);
        return [nodes.get(selector.match(/^#([\w-]+)/)?.[1])].filter(Boolean);
    }
    const vmContext = { document, window, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
        getComputedStyle: () => ({ overflowX: 'auto' }), Date };
    const evaluate = (fn, arg) => runInNewContext(`(${fn.toString()})(argument)`, { ...vmContext, argument: arg });
    document.getElementById = id => nodes.get(id) || null;
    document.querySelector = selector => resolve(selector)[0] || null;
    function locator(selector, named = null) {
        const expectedPage = selector.includes('expenses') || named ? 'Ausgaben.html' : 'Balance.html';
        const matches = () => named ? (expenses() ? [nodes.get({ Monatsausgaben: 'matrix', Jahresdiagramm: 'expensesHistoryChart', Jahreswerte: 'expensesHistoryTable' }[named])].filter(Boolean)
            .filter(node => node.id !== 'expensesHistoryTable' || details.open) : []) : resolve(selector);
        const single = () => {
            onPage(expectedPage);
            strictAssert.equal(matches().length, 1, 'Mehrdeutiger/fehlender Locator: ' + (named || selector));
            return matches()[0];
        };
        return {
            count: async () => { strictAssert(ready, 'Count vor Bereitschaft'); return matches().length; },
            evaluate: async (fn, arg) => evaluateNode(fn, single(), arg),
            getAttribute: async name => single().getAttribute(name),
            isVisible: async () => { single(); return media === 'print' ? ['#print-footer', '#actionDetailsDialog', '#handlungsanweisung'].includes(selector) : true; },
            isHidden: async () => { single(); return media === 'print'; },
            focus: async () => { single().focus(); events.push('focus:' + (named || selector)); },
            press: async () => { single().scrollLeft = 40; },
            click: async () => { const node = single(); if (selector.startsWith('.tab-btn')) historyActive = node.dataset.tab === 'history'; events.push('click:' + selector); },
            waitFor: async () => { single(); },
            innerHTML: async () => { single(); return '<svg />'; },
            textContent: async () => { single(); return '100,0\u00a0% → 200,0\u00a0%'; },
            filter() { return this; },
            locator(child) {
                if (child === '#expensesTable') return { count: async () => { onPage('Ausgaben.html'); return matches()[0]?.id === 'matrix' ? 1 : 0; } };
                return locator(child);
            },
            first() { return this; }
        };
    }
    function evaluateNode(fn, node, arg) {
        return runInNewContext(`(${fn.toString()})(node, argument)`, { ...vmContext, node, argument: arg });
    }
    const page = {
        url: () => currentUrl,
        async goto(href) {
            load(href);
            redirectUrl = href.includes('/Balance.html?year=') && new URL(href).hash === '#ausgaben' ? href.replace('/Balance.html', '/Ausgaben.html') : null;
        },
        async waitForURL(predicate) {
            if (redirectUrl) { load(redirectUrl); redirectUrl = null; events.push('redirect-arrived'); }
            strictAssert(predicate(new URL(currentUrl)), 'Ziel-URL noch nicht erreicht');
        },
        async reload() { load(currentUrl); },
        locator,
        getByRole(role, { name, exact }) {
            strictAssert.equal(role, 'region'); strictAssert.equal(exact, true);
            return locator('.expenses-table-region', name);
        },
        async setViewportSize({ width }) { viewportWidth = width; events.push('width:' + width); },
        async emulateMedia({ media: next }) { onPage('Balance.html'); media = next; events.push('print:Balance'); },
        async waitForFunction(fn, arg) {
            strictAssert.notEqual(fn.constructor.name, 'AsyncFunction', 'Keine asynchronen Browserpolls');
            strictAssert(ready, 'Browserpoll vor Seitenbereitschaft');
            // Der Diagrammpoll wartet tatsächlich auf zwei identische Messungen.
            const first = evaluate(fn, arg);
            strictAssert(first || evaluate(fn, arg), 'Browserbedingung unerfüllt');
        },
        async evaluate(fn, arg) {
            strictAssert(ready, 'Evaluate vor Seitenbereitschaft');
            if (arg?.kind) {
                onPage(arg.kind === 'expenses' ? 'Ausgaben.html' : 'Balance.html');
                events.push(`chart:${arg.kind}:${arg.count}`);
                return { scales: [[1, 1]], markers: [[2, 2]], live: [{ empty: true, hidden: false, display: 'block', visibility: 'visible', margin: '0px' }], width: 1000, height: 500, ratio: 2, minWidth: 1000 };
            }
            if (fn.toString().includes('import(')) { events.push('flush/read'); return 2026; }
            return evaluate(fn, arg);
        }
    };
    const context = {
        page, URL, assert: strictAssert, baseUrl: 'https://suite.invalid', browser: {}, storage: { expenses: '{}' }, EXPENSES_KEY: 'expenses',
        chartFixture: { state: { wealthHistory: { entries: [] } }, storage: { expenses: '{}' } },
        state: { wealthHistory: { entries: Array(24).fill({}) } }, names: {},
        async openSmokePage(_browser, baseUrl, entry, options) {
            observer = options.observeWealthUpdates === true;
            events.push('observer:' + observer);
            load(baseUrl + '/' + entry); ready = true;
            return { page };
        },
        async waitForPageCondition(_page, fn) {
            strictAssert(expenses(), 'Ausgabenbereitschaft auf falscher Seite');
            if (fn.toString().includes('expensesReady')) {
                ready = true; document.documentElement.dataset.expensesReady = 'true'; events.push('expenses-ready');
                strictAssert(evaluate(fn));
            } else {
                onPage('Ausgaben.html'); strictAssert(fn.toString().includes('getPageNavigationGuard'), 'Erwarteter Guardpoll'); events.push('expenses-guard');
            }
        },
        async waitBalanceHouseholdList() { strictAssert(!expenses(), 'Balancebereitschaft auf falscher Seite'); ready = true; events.push('balance-ready'); },
        async openBalanceHouseholdList() { onPage('Balance.html'); },
        async assertProfilverbundGeometry() { onPage('Balance.html'); },
        async activateWealthBrowserTab(_page, expanded) {
            onPage('Balance.html');
            strictAssert(window.__wealthPendingUpdates instanceof Set, 'Observer vor lokalem Tabwechsel');
            const before = historyActive;
            if (expanded) strictAssert.equal(historyActive, false, 'VM vor lokaler Verlaufseröffnung: Verlauf muss inaktiv sein');
            historyActive = expanded;
            wealthTransitions.push({ width: viewportWidth, expanded, before, after: historyActive });
            events.push('local-wealth-tab');
            await runInNewContext(`(async () => { ${absenceSource} })()`, context);
        },
        async assertWealthBrowserTable() { onPage('Balance.html'); },
        async assertExpensesBrowserTable() { onPage('Ausgaben.html'); strictAssert(details.open, 'Jahreswerte vor Öffnung'); }
    };
    return { context, events, wealthTransitions, onPage };
}

async function executeSmokeVm(code, initialPage = null) {
    const vm = createSmokeVm();
    const setup = initialPage ? `await openSmokePage(browser, baseUrl, '${initialPage}', { observeWealthUpdates: true });` : '';
    await runInNewContext(`(async () => { ${commonSmokeSources} ${setup} ${code} })()`, vm.context);
    return vm;
}
async function rejectsSmoke(code, expected, initialPage = null) {
    let error;
    try { await executeSmokeVm(code, initialPage); } catch (caught) { error = caught; }
    assert(error && expected.test(error.message), 'Gegenprobe schlägt aus erwartetem Grund fehl: ' + expected + ' (' + error?.message + ')');
}

const designSequence = designOpening + designMeasurements;
const designVm = await executeSmokeVm(designSequence);
assertEqual(designVm.events.filter(event => event.startsWith('chart:')).length, 4, 'Echte Ausgabenmatrix: zwei Breiten × zwei Recordzahlen');
designVm.onPage('Balance.html');
assert(designVm.events.indexOf('observer:true') < designVm.events.indexOf('load:/Balance.html'), 'Observer wird vor Produktstart gewählt');
await rejectsSmoke(designSequence.replace("        await activateSuiteSection(page, 'overview');", "        await page.locator('.tab-btn[data-tab=\"overview\"]').click();"), /Falsche Seite/);
await rejectsSmoke(designSequence.replace('observeWealthUpdates: true', 'observeWealthUpdates: false'), /size/);

const dataSequence = dataOpening + overflowSource + scrollSource + dataMeasurements;
const dataVm = await executeSmokeVm(dataSequence);
assertEqual(dataVm.events.filter(event => event.startsWith('width:')).join(','), 'width:1366,width:1920,width:2560', 'Datenlayout führt alle bestehenden Breiten aus');
assertEqual(dataVm.events.filter(event => event === 'local-wealth-tab').length, 0, 'Abgelöste Balance-Verlaufhosts werden nicht mehr bedient');
strictAssert.deepEqual(dataVm.wealthTransitions.filter(({ expanded }) => expanded),
    [],
    'Datenlayout öffnet kein abgelöstes Balance-Verlaufspanel');
assertEqual(dataVm.events.filter(event => event === 'focus:Monatsausgaben').length, 3, 'Jede Datenlayoutbreite fokussiert die Monatsmatrix');
assert(dataVm.events.includes('print:Balance'), 'Seitenbezogene DOM-Reihenfolge und Druck werden bis Balance ausgeführt');
function mutateDataSequence(anchor, replacement) {
    const from = dataSequence.indexOf(anchor);
    strictAssert(from >= 0, 'Mutationsanker vorhanden: ' + anchor);
    strictAssert.equal(dataSequence.indexOf(anchor, from + anchor.length), -1, 'Mutationsanker eindeutig: ' + anchor);
    const mutated = dataSequence.replace(anchor, replacement);
    strictAssert.notEqual(mutated, dataSequence, 'Mutation verändert die Quellkopie');
    return mutated;
}
const overviewPreparation = "            await activateSuiteSection(page, 'overview');\n            await noPageOverflow";
await rejectsSmoke(mutateDataSequence(overviewPreparation, '            await noPageOverflow'), /Falsche Seite/);

await rejectsSmoke(dataSequence.replace('.expenses-table-region[aria-label="Monatsausgaben"]', '.expenses-table-region'), /Mehrdeutiger/);

const absentVm = await executeSmokeVm(absenceSource, 'Balance.html');
assert(absentVm.events.includes('load:/Balance.html'), 'Echter Sichtbarkeitsabschnitt akzeptiert Balance ohne entfernte Ausgabenhosts');
await rejectsSmoke(absenceSource, /Balance enthält/, 'Ausgaben.html');
await rejectsSmoke("await activateSuiteSection(page, 'expenses'); await expensesMonthlyRegion(page);" + '\n' +
    "await page.locator('.expenses-table-region').evaluate(node => node.scrollLeft);", /Mehrdeutiger/, 'Balance.html');
await rejectsSmoke("await activateSuiteSection(page, 'expenses'); await assertExpensesBrowserRegions(page);".replace("await activateSuiteSection(page, 'expenses');", "await waitExpensesBrowser(page);"), /Geöffnete Ausgabenregion/, 'Ausgaben.html');
await rejectsSmoke(regionsSource.replace("name: 'Monatsausgaben'", "name: 'Jahreswerte'") + "await activateSuiteSection(page, 'expenses'); await expensesMonthlyRegion(page);", /Monatsmatrix/, 'Balance.html');

// Auch die vorhandene echte Probelaufsequenz bleibt bei verzögerter Weiterleitung
// korrekt; Mutationen entfernen jeweils Ankunft oder Bereitschaft.
// Der Abschlussdialog selbst ist im obigen Bestandsfall für beide Jahre geprüft;
// hier wird der echte Ankunftsabschnitt vor der profilspezifischen Mutation ausgeführt.
const arrivalSource = smokeSection(finishYearSource, '                await page.goto(`${baseUrl}/Balance.html?year=${year}#ausgaben`);', '                await page.evaluate(async id => {');
const arrivalVm = await executeSmokeVm('const year = 2026;' + arrivalSource, 'Balance.html');
assert(arrivalVm.events.indexOf('redirect-arrived') < arrivalVm.events.indexOf('expenses-ready'), 'Verzögerter Altlink erreicht zuerst die Zielseite, dann Bereitschaft');
await rejectsSmoke(expensesWaitSource.replace("    await page.waitForURL(url => url.pathname.endsWith('/Ausgaben.html'));\n", '') + 'const year = 2026;' + arrivalSource.replace(/                await page.waitForURL\([\s\S]*?String\(year\) && url.hash === '#ausgaben'\);/, ''), /Ausgabenbereitschaft auf falscher Seite/, 'Balance.html');
await rejectsSmoke('const year = 2026;' + arrivalSource.replace('                await waitExpensesBrowser(page);', "                await page.locator('#expensesYearSelect').getAttribute('id');"), /Locator\/Prüfung vor Seitenbereitschaft/, 'Balance.html');

const widthsFunction = smokeSection(browserSource, 'async function runSuiteFrameWidths(', 'async function initializeBrowserSmokeNavigationGuard(');
const widthsExpenses = smokeSection(widthsFunction, "                if (source === 'Ausgaben.html') {", "                if (source === 'depot-tranchen-manager.html') {");
const widthsVm = await executeSmokeVm("const source = 'Ausgaben.html'; for (const width of [900, 700]) {" + widthsExpenses + '}', 'Ausgaben.html');
assertEqual(widthsVm.events.filter(event => event === 'focus:Monatsausgaben').length, 2, 'Echter Suite-Breitenabschnitt bedient die Monatsmatrix bei 900 und 700 px einschließlich Scrollassertion');
await rejectsSmoke(regionsSource.replace("page.getByRole('region', { name: 'Monatsausgaben', exact: true })", "page.locator('.expenses-table-region')") + "const source = 'Ausgaben.html', width = 700;" + widthsExpenses, /Genau eine Monatsmatrix/, 'Ausgaben.html');
const directFunction = smokeSection(browserSource, 'async function runExpensesPageSmoke(', 'async function runExpensesNavigationSmoke(');
const directFocus = smokeSection(directFunction, '                    await expensesMonthlyRegion(page);', '                await page.locator(\'[data-balance-year="2025"]\').click();').split('\n')[0];
const directVm = await executeSmokeVm(directFocus, 'Ausgaben.html');
assert(directVm.events.includes('focus:Monatsausgaben'), 'Direkter Ausgaben-Smoke verwendet den tatsächlich ausgeführten eindeutigen Fokushelfer');

const balancePanelSource = smokeSection(browserSource, 'async function withBalancePanel(', 'async function assertExpensesBrowserTable(');
const roundtripCode = balancePanelSource + "await withBalancePanel(page, 'history', async () => { await page.locator('#wealthHistoryChart').focus(); });";
const roundtripVm = await executeSmokeVm(roundtripCode, 'Ausgaben.html');
roundtripVm.onPage('Ausgaben.html');
assertEqual(roundtripVm.events.filter(event => event.startsWith('load:')).join(','), 'load:/Ausgaben.html,load:/Balance.html,load:/Ausgaben.html', 'Tatsächlicher gemeinsamer Helfer kehrt nach Wealth-Inspektion zur Ausgabenseite zurück');
await rejectsSmoke(roundtripCode.replace('await page.goto(oldUrl);', ''), /Ziel-URL noch nicht erreicht/, 'Ausgaben.html');
await rejectsSmoke(suiteSectionSource.replace('        await waitForWealthBrowserStartup(page);', '') + roundtripCode, /Locator\/Prüfung vor Seitenbereitschaft/, 'Ausgaben.html');
await rejectsSmoke(regionsSource.replace('        await region.focus();', '') + "await activateSuiteSection(page, 'expenses'); await assertExpensesBrowserRegions(page);", /tatsächlichen Fokus/, 'Balance.html');

// Die folgenden Gegenproben betreiben echte Smoke-Assertions mit synthetischen
// Eingaben. Sie sind keine Browsermessung und ersetzen die externe Abnahme nicht.
const importContract = smokeSection(browserSource, 'function assertCommittedExpenseImport(', 'async function runBalanceExpensesWealthCapture(');
const wealthContracts = smokeSection(browserSource, 'function assertWealthScrollRegions(', 'const WEALTH_TAB_SINGLE_ROW_MIN_WIDTH');
const recoveryContract = smokeSection(browserSource, 'function assertCareRecoveryErrors(', 'async function runBalanceCorruptProfileHealthSmoke(');
const frameContract = smokeSection(browserSource, 'function assertSuiteFrameIcons(', 'async function runSuiteFramePrint(');
const profileContracts = smokeSection(browserSource, 'function suiteHistoryPageKind(', 'async function assertSuiteExpensesProfile(');
const gates = runInNewContext(importContract + wealthContracts + recoveryContract + frameContract + profileContracts +
    '\n({ assertCommittedExpenseImport, assertWealthScrollRegions, assertBalanceTabInventory, assertCareRecoveryErrors, assertSuiteFrameIcons, suiteHistoryPageKind, assertSuiteExpensesContent })',
    { assert: strictAssert, UIUtils: { formatBalanceCurrency: value => `${value} €` } });
const rejectsGate = (call, expected) => {
    strictAssert.throws(call, expected);
    assert(true, 'Smoke-Gegenprobe weist falschen Vertrag zurück: ' + expected);
};
const imported = { years: { 2025: { months: { 2: { profiles: { 'import-quote': { categories: {} } } } } } } };
gates.assertCommittedExpenseImport(imported, 2025, 2, 'import-quote');
rejectsGate(() => gates.assertCommittedExpenseImport(imported, 2026, 2, 'import-quote'), /Zieljahr/);
rejectsGate(() => gates.assertCommittedExpenseImport(imported, 2025, 3, 'import-quote'), /Zielmonat/);
rejectsGate(() => gates.assertCommittedExpenseImport(imported, 2025, 2, 'andere-person'), /Zielperson/);
const layoutProbe = { form: { width: 500 }, regions: [
    { id: 'wealthHistoryChart', name: 'Vermögensdiagramm', scroll: 800, client: 500, start: 0, position: 300, overflow: 'auto', width: 500 },
    { id: 'wealthHistoryTable', name: 'Tabelle der Vermögensstände', scroll: 900, client: 500, start: 0, position: 400, overflow: 'auto', width: 500 }
] };
gates.assertWealthScrollRegions(layoutProbe, 'Gegenprobenfixture');
for (const mutate of [probe => probe.regions.pop(), probe => probe.regions.push({ ...probe.regions[0] }),
    probe => { probe.regions[0].name = 'Monatsausgaben'; }]) {
    const changed = structuredClone(layoutProbe); mutate(changed);
    rejectsGate(() => gates.assertWealthScrollRegions(changed, 'Gegenprobe'), /beiden wirklichen/);
}
for (const mutate of [probe => { probe.regions[1].position = 0; }, probe => { probe.regions[0].start = 300; },
    probe => { probe.regions[0].scroll = 500; }, probe => { probe.regions[0].overflow = 'visible'; }]) {
    const changed = structuredClone(layoutProbe); mutate(changed);
    rejectsGate(() => gates.assertWealthScrollRegions(changed, 'Gegenprobe'), /scrollt tatsächlich/);
}
const tabsProbe = [['balanceTabOverview', 'Überblick'], ['balanceTabStrategy', 'Bedarf & Strategie'],
    ['balanceTabHistory', 'Verlauf'], ['openDiagnosisBtn', 'Diagnose']].map(([id, label]) => ({ id, label }));
gates.assertBalanceTabInventory(tabsProbe, 'Gegenprobenfixture');
rejectsGate(() => gates.assertBalanceTabInventory(tabsProbe.map(tab => ({ ...tab, label: 'Auswertung' })), 'Gegenprobe'), /Tabinventar/);
const expectedErrors = [
    '[console.error] Update-Fehler: ProfilverbundProfileStateError: Profilverbund: Profil Browserprofil Pflege-Recovery ist im Bereich profile_health_bucket fehlerhaft.',
    '[console.error] Update-Fehler: ProfileRecoveryError: Profil Browserprofil Pflege-Recovery: Der Pflegebucket ist korrupt und blockiert die Profilnutzung.'
];
gates.assertCareRecoveryErrors(expectedErrors);
for (const errors of [[expectedErrors[1].replace('Browserprofil Pflege-Recovery', 'Fremdes Profil')],
    [expectedErrors[1] + ' Weiterer Fehler'], [...expectedErrors, '[console.error] fremder Fehler'],
    [expectedErrors[1].replace('Pflegebucket', 'Goldbereich')], [expectedErrors[1].replace('[console.error]', '[pageerror]')]]) {
    rejectsGate(() => gates.assertCareRecoveryErrors(errors), /Unerwartete Recovery/);
}
const frameProbe = {
    links: [['index.html', 'house'], ['depot-tranchen-manager.html', 'wallet'], ['Ausgaben.html', 'wallet'], ['Balance.html', 'scale'],
        ['Simulator.html', 'chart-no-axes-combined'], ['Handbuch.html', 'book-open'], ['Daten-Sicherung.html', 'landmark']]
        .map(([href, name]) => ({ href, icons: [{ name, svg: true }] })),
    brand: [{ name: 'landmark', svg: true }], toggle: [{ name: 'panel-left-close', svg: true }, { name: 'panel-left', svg: true }]
};
gates.assertSuiteFrameIcons(frameProbe);
for (const mutate of [probe => probe.links.pop(), probe => probe.links.reverse(), probe => probe.links.push(probe.links[0]),
    probe => { probe.links[2].icons[0].svg = false; }, probe => probe.brand.pop(),
    probe => { probe.toggle[1].svg = false; }]) {
    const changed = structuredClone(frameProbe); mutate(changed);
    rejectsGate(() => gates.assertSuiteFrameIcons(changed), /Rahmenlinks|Sidebarumschaltersymbole/);
}
for (const [source, kind] of [['Ausgaben.html', 'expenses'], ['Balance.html', 'balance'], ['Simulator.html', 'simulator'], ['depot-tranchen-manager.html', 'manager']]) {
    assertEqual(gates.suiteHistoryPageKind(source), kind, 'Historienzweig ist ausdrücklich der richtigen Seite zugeordnet');
}
rejectsGate(() => gates.suiteHistoryPageKind('unbekannt.html'), /Unbekannte Historienseite/);
const ownExpenses = { ids: ['', 'suite-a', 'suite-b'], selected: ['suite-b'], context: 'Berechnet für: Synthetisch B',
    spent: '202 €', categories: 'Ausgabe B' };
gates.assertSuiteExpensesContent(ownExpenses, 'suite-b');
rejectsGate(() => gates.assertSuiteExpensesContent({ ...ownExpenses, selected: ['suite-a'] }, 'suite-b'), /Personenfilter/);
rejectsGate(() => gates.assertSuiteExpensesContent({ ...ownExpenses, ids: ['suite-b'] }, 'suite-b'), /Personenfilter/);
rejectsGate(() => gates.assertSuiteExpensesContent({ ...ownExpenses, context: 'Berechnet für: Synthetisch A' }, 'suite-b'), /eigene Personeninhalte/);
rejectsGate(() => gates.assertSuiteExpensesContent({ ...ownExpenses, categories: 'Ausgabe A' }, 'suite-b'), /eigene Personeninhalte/);

// Den ganzen tatsächlichen Ausgaben-Historienzweig ausführen: falsche Locator-
// Zweige scheitern im Double statt als generisches else durchzugehen.
const profileFlow = smokeSection(browserSource, 'async function runSuiteFrameProfileHistory(', 'async function runSuiteFrameBfcache(');
let currentProfile = 'suite-a', currentPath = 'Ausgaben.html';
const historyEvents = [];
const profilePage = {
    async goto(url) { currentPath = new URL(url).pathname.split('/').pop(); },
    async waitForURL() {}, async goBack() {}, async goForward() {},
    locator(selector) {
        strictAssert.ok(selector.startsWith('.suite-navigation a[href='), 'Ausgaben verwendet keine Simulator-/Balance-/Tranchen-Locatoren: ' + selector);
        return { async click() { historyEvents.push(selector); } };
    }
};
await runInNewContext(profileContracts + profileFlow.replace("['Balance.html', 'Ausgaben.html', 'Simulator.html', 'depot-tranchen-manager.html']", "['Ausgaben.html']") +
    "\nrunSuiteFrameProfileHistory({}, 'http://suite.test')", {
    assert, EXPENSES_KEY: 'balance_expenses_v1', suiteProfileFixture: () => ({ rs_profiles_v1: JSON.stringify({ profiles: { 'suite-b': { meta: {} } } }) }),
    createPage: async () => ({ page: profilePage, assertNoErrors() {}, async close() {} }),
    waitSuiteIdentity: async (_page, id) => { assertEqual(currentProfile, id, 'Historienzweig verlangt die echte aktive Profilidentität'); },
    switchBrowserProfile: async (_page, id) => { currentProfile = id; }, navigateCleanly: async (_page, locator) => locator.click(),
    assertSuiteExpensesProfile: async (_page, id) => { assertEqual(currentProfile, id, 'Ausgabeninhalt gehört zum aktuellen Profil'); historyEvents.push('expenses:' + id); }
});
assertEqual(historyEvents.filter(event => event === 'expenses:suite-a').length, 1, 'A-Vorbedingung prüft echte Ausgabenseitenart');
assertEqual(historyEvents.filter(event => event === 'expenses:suite-b').length, 4, 'B-Inhalte werden nach Übergabe und allen Historienrückkehren geprüft');
assertEqual(currentPath, 'Ausgaben.html', 'Historienfall beginnt auf Ausgaben');
assert(!/waitForFunction\(\s*async\b/.test(browserSource), 'Keine asynchronen waitForFunction-Prädikate im Smoke');

currentProfile = 'suite-a';
await strictAssert.rejects(() => runInNewContext(profileContracts.replace("'Ausgaben.html': 'expenses'", "'Ausgaben.html': 'manager'") +
    profileFlow.replace("['Balance.html', 'Ausgaben.html', 'Simulator.html', 'depot-tranchen-manager.html']", "['Ausgaben.html']") +
    "\nrunSuiteFrameProfileHistory({}, 'http://suite.test')", {
    assert: strictAssert, EXPENSES_KEY: 'balance_expenses_v1', suiteProfileFixture: () => ({}),
    createPage: async () => ({ page: profilePage, assertNoErrors() {}, async close() {} }),
    waitSuiteIdentity: async () => {}
}), /keine Simulator-\/Balance-\/Tranchen-Locatoren/);
assert(true, 'Echte Historiensequenz weist die falsche Ausgaben-Managerzuordnung zurück');

// Nur den geprüften Funktionskörper auswerten; der frühere Bereich schloss fremde Helfer und deren ES-Modul-Exports ein.
const arrivalFocusContract = 'async ' + functionSource('tests/browser-smoke.test.mjs', 'assertExpensesArrivalFocus');
const focusProbe = { dataset: { action: 'import', month: '9', profile: 'muster_a' }, disabled: false };
const focusDocument = { activeElement: focusProbe, getElementById: () => ({ contains: button => button === focusProbe }) };
const arrivalGate = runInNewContext(arrivalFocusContract + '\nassertExpensesArrivalFocus', { assert: strictAssert, document: focusDocument });
await arrivalGate({ evaluate: callback => callback() }, '9', 'import');
assert(true, 'Ankunftsassertion liest den tatsächlichen DOM-Fokus ohne Testfokussierung');
for (const mutate of [node => { node.disabled = true; }, node => { node.dataset.month = '8'; },
    node => { node.dataset.action = 'details'; }, node => { node.dataset.profile = ''; }]) {
    focusProbe.dataset = { action: 'import', month: '9', profile: 'muster_a' }; focusProbe.disabled = false; mutate(focusProbe);
    await strictAssert.rejects(() => arrivalGate({ evaluate: callback => callback() }, '9', 'import'), /Ankunftsfokus/);
    assert(true, 'Fokusgegenprobe weist gesperrte oder falsche Monatsaktion zurück');
}

// Der produktive Browserhelfer muss den Reload bereits beobachten, bevor die
// Aktion ihn auslöst, und darf erst im neuen Dokument die Bereitschaft abfragen.
const reloadHelperSource = 'async ' + functionSource('tests/browser-smoke.test.mjs', 'waitForProbelaufReload');
const reloadEvents = [];
let completeReload;
const reloadGate = new Promise(resolve => { completeReload = resolve; });
let reloaded = false;
const reloadHelper = runInNewContext(reloadHelperSource + '\nwaitForProbelaufReload', {
    waitForPageCondition: async (_page, predicate, date) => {
        strictAssert.equal(reloaded, true, 'Keine Seitenabfrage im alten Dokument');
        strictAssert.equal(date, '2027-01-02', 'Bereitschaft bindet das gewünschte Fachdatum');
        strictAssert.equal(predicate.constructor.name, 'AsyncFunction', 'Asynchrone Modulbedingungen nutzen die abwartende Hilfe');
        reloadEvents.push('ready');
    }
});
const reloadTask = reloadHelper({ waitForNavigation: options => {
    strictAssert.equal(options.waitUntil, 'load'); reloadEvents.push('observe'); return reloadGate;
}, evaluate: async () => { strictAssert.equal(reloaded, true); reloadEvents.push('flush'); }
}, async () => { reloadEvents.push('click'); }, '2027-01-02');
await Promise.resolve(); await Promise.resolve();
assertEqual(reloadEvents.join(','), 'observe,click', 'Klickabschluss allein erlaubt keine Seitenabfrage');
reloaded = true; completeReload(); await reloadTask;
assertEqual(reloadEvents.join(','), 'observe,click,ready,flush', 'Erst abgeschlossener Reload erlaubt neue Kontextabfrage und Persistenzflush');
await strictAssert.rejects(() => reloadHelper({ waitForNavigation: async () => { throw new Error('Synthetischer Reloadfehler'); } },
    async () => {}, '2027-01-02'), /Synthetischer Reloadfehler/);
assert(true, 'Reloadfehler bleiben sichtbar und erzeugen keine erfolgreiche Bereitschaft');

// Der echte Rahmenmesshelfer darf ein zusätzliches, noch ungeladenes
// Inhaltssymbol nicht in sein Rahmeninventar aufnehmen.
const frameMeasurement = smokeSection(browserSource, 'async function measureSuiteFrameIcons(', 'function assertSuiteFrameIcons(');
const iconNode = icon => ({ dataset: { suiteIcon: icon.name }, querySelector: selector => selector === 'svg' && icon.svg ? {} : null });
const frameNodes = {
    links: frameProbe.links.map(link => ({ getAttribute: name => name === 'href' ? link.href : null,
        querySelectorAll: selector => selector === '[data-suite-icon]' ? link.icons.map(iconNode) : [] })),
    brand: frameProbe.brand.map(iconNode), toggle: frameProbe.toggle.map(iconNode)
};
const frameDocument = { querySelectorAll(selector) {
    if (selector === '.suite-navigation a') return frameNodes.links;
    if (selector === '.suite-header .suite-brand [data-suite-icon]') return frameNodes.brand;
    if (selector === '#suiteSidebarToggle [data-suite-icon]') return frameNodes.toggle;
    const frameIcons = [...frameNodes.brand, ...frameNodes.toggle, ...frameProbe.links.flatMap(link => link.icons.map(iconNode))];
    if (selector === '.suite-header [data-suite-icon], .suite-navigation [data-suite-icon]') return frameIcons;
    if (selector === '[data-suite-icon]') return [...frameIcons, iconNode({ name: 'content-probe', svg: false })];
    throw new Error('Unerwarteter Rahmen-Messselektor: ' + selector);
} };
const measureFrame = runInNewContext(frameMeasurement + '\nmeasureSuiteFrameIcons', { document: frameDocument });
const measuredFrame = await measureFrame({ waitForFunction: async callback => strictAssert(callback()), evaluate: callback => callback() });
gates.assertSuiteFrameIcons(measuredFrame);
assert(true, 'Echter Rahmenmesshelfer besteht trotz zusätzlichem ungeladenem Inhaltssymbol');
