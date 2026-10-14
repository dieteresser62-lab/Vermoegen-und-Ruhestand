import fs from 'node:fs';
import strictAssert from 'node:assert/strict';
import { MockDocument, MockElement, createBalancePageFixture } from './helpers/balance-page-fixture.mjs';
import { readyAnnualFixture, annualServiceFixture } from './helpers/balance-storage-fixtures.mjs';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { initExpensesPage } from '../app/expenses/expenses-main.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { readWealthHistory, createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { renderExpensesPage } from '../app/expenses/expenses-renderer.js';
import { refreshExpensesView } from '../app/balance/balance-expenses.js';
import { applyExpensesTarget } from '../app/shared/expenses-navigation.js';

const html = fs.readFileSync(new URL('../Ausgaben.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/expenses.css', import.meta.url), 'utf8');
function assertHeadingWeight(source) {
    let weight;
    for (const [, selectors, declarations] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (selectors.split(',').some(selector => selector.trim() === '.expenses-page h1')) {
            const value = declarations.match(/font-weight:\s*(\d+)/)?.[1];
            if (value) weight = value;
        }
    }
    strictAssert.equal(weight, '500', 'Newsreader-h1 verwendet 500');
}
assertHeadingWeight(css);
assert(true, 'Quell-CSS setzt Newsreader-h1 ausdrücklich auf 500');
strictAssert.throws(() => assertHeadingWeight(css.replace('h1 { font-weight: 500;', 'h1 { font-weight: 600;')), /Newsreader-h1/);
assert(true, 'Typografie-Gegenprobe weist h1 mit 600 zurück');
const walk = node => [node, ...node.children.flatMap(walk)];
function matches(node, selector) {
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    const last = parts.pop();
    if (last.startsWith('#')) { if (node.id !== last.slice(1)) return false; }
    else {
        const tag = last.match(/^\w+/)?.[0];
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        for (const [, attr, value] of last.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
            if (!node.hasAttribute(attr) || value !== undefined && node.getAttribute(attr) !== value) return false;
        }
        if (!tag && !last.includes('[')) return false;
    }
    if (!parts.length) return true;
    for (let parent = node.parentNode; parent; parent = parent.parentNode) if (matches(parent, parts.join(' '))) return true;
    return false;
}
MockElement.prototype.matches = function(selector) { return selector.split(',').some(part => matches(this, part)); };
MockElement.prototype.querySelectorAll = function(selector) { return walk(this).slice(1).filter(node => node.matches(selector)); };
MockElement.prototype.querySelector = function(selector) { return this.querySelectorAll(selector)[0] || null; };
// Browsernahe Fokusgrenze: gesperrte Knöpfe fokussieren nicht; entfernte
// Unterbäume verlieren den Fokus. Das allgemeine Fixture modelliert dies nicht.
MockElement.prototype.focus = function(options) {
    if (!this.disabled) { this.ownerDocument.activeElement = this; this.lastFocusOptions = options; }
};
const replaceChildren = MockElement.prototype.replaceChildren;
MockElement.prototype.replaceChildren = function(...children) {
    if (this.contains(this.ownerDocument.activeElement)) {
        const focused = this.ownerDocument.activeElement;
        this.ownerDocument.activeElement = this.ownerDocument.body;
        // Native Entfernung kann focusout auslösen, während der alte Knoten
        // noch verbunden ist. Erst danach wird der Unterbaum ausgehängt.
        this.ownerDocument.dispatchEvent({ type: 'focusout', target: focused, relatedTarget: null });
    }
    this.children.forEach(child => { child.parentNode = null; });
    return replaceChildren.call(this, ...children);
};
MockDocument.prototype.querySelectorAll = function(selector) { return this.body.querySelectorAll(selector); };
MockDocument.prototype.querySelector = function(selector) { return this.body.querySelector(selector); };
const previousDate = getAppTestDate();
const rawStore = JSON.stringify({ version: 1, activeYear: 2025, years: { 2025: { months: { 1: { profiles: { muster_a: { categories: { Wohnen: -80 } } } } } } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let fixture, service;
const faults = {};
try {
    setAppTestDate('2026-10-10');
    fixture = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/Ausgaben.html?year=2025&month=1#ausgaben-import' });
    const { doc, win } = fixture;
    doc.htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const [, tag, id] of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) doc.getElementById(id).tagName = tag.toUpperCase();
    doc.documentElement = doc.createElement('html'); doc.documentElement.dataset.suitePage = 'expenses';
    const windowEvents = new Map(), addWindowListener = win.addEventListener.bind(win);
    win.addEventListener = (event, callback) => { windowEvents.set(event, callback); addWindowListener(event, callback); };
    win.sessionStorage = globalThis.sessionStorage;
    const sample = readyAnnualFixture(); sample.records.balance_expenses_v1 = rawStore;
    delete sample.records.overview_month_provision_v1;
    const registry = JSON.parse(sample.records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) delete profile.data.overview_month_provision_v1;
    const actualStateKey = CONFIG.STORAGE.LS_KEY;
    for (const profile of Object.values(registry.profiles)) {
        const state = JSON.parse(profile.data[actualStateKey]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null };
        profile.data[actualStateKey] = JSON.stringify(state);
    }
    sample.records[actualStateKey] = registry.profiles.muster_a.data[actualStateKey];
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    service = await annualServiceFixture({ sample, faults });
    let confirmations = 0, accept = true, previews = [], exportFails = true, resetAllowed = false;
    const closeRequests = [];
    const controller = await initExpensesPage(doc, win, { closeOptions: { months: { confirm: async request => { closeRequests.push(request.model); return null; } } }, actions: {
        downloadRecovery: async record => { if (exportFails) throw new Error('Synthetischer Exportfehler'); assertEqual(record.raw, '{synthetic-corrupt', 'Recoveryexport erhält Originalrohbytes'); },
        confirmReset: async () => resetAllowed,
        confirmImport: async (targets, context) => {
            confirmations++; previews = targets;
            const before = storage.getItem('balance_expenses_v1');
            const result = requestExpensesPreview(targets, { ...context, doc });
            const preview = doc.getElementById('expensesImportPreview');
            assert(preview?.open, 'Echter Zelllistener öffnet die D5-Vorschau');
            assert(controller.close.imports.pending, 'Zellimport gehört zum gemeinsamen Abschluss-Importbesitzer');
            assert(table.querySelectorAll('button[data-month][data-profile]').every(button => button.disabled), 'Offene Vorschau sperrt sämtliche Matrixaktionen');
            assertEqual(storage.getItem('balance_expenses_v1'), before, 'Offene echte Vorschau schreibt keine Records');
            await preview.querySelector(accept ? '[data-expenses-preview-accept]' : '[data-expenses-preview-cancel]').fire('click');
            return result;
        }
    } });
    assert(controller !== false, 'Eigenständiger Einstieg startet mit echten Persistenz-/Profilquellen');
    // Der echte Seitenstart initialisiert den Probelauf und setzt ohne aktiven
    // Versuch die Fachuhr zurück. Erst danach das Datum des Testfalls binden.
    assertEqual(getAppTestDate(), null, 'Seitenstart ohne Probelauf stellt die echte Fachuhr her');
    setAppTestDate('2026-10-10');
    assertEqual(doc.documentElement.dataset.expensesReady, 'true', 'Bereitschaft wird erst nach Controllerstart gemeldet');
    assertEqual(storage.getItem('balance_expenses_v1'), rawStore, 'Direktstart schreibt keinen Ausgabenrecord und keine Auswahl');
    const plan = storage.getItem('household_plan_v1');
    const title = doc.getElementById('expensesHeading');
    assert(title.textContent.includes('2025'), 'Initiale Ankunft übernimmt das angegebene Ausgabenjahr');
    assertEqual(doc.activeElement?.dataset.month, '1', 'Initiale Ankunft fokussiert den angegebenen Monatsimport ohne Dateidialog');
    assert(doc.getElementById('expensesContext').textContent.includes('Max'), 'Kopf verwendet echte Profilnamen');
    const table = doc.getElementById('expensesTable');
    assertEqual(table.querySelectorAll('button[data-action="delete"]').length, 0, 'Löschen bleibt in den Monatsdetails statt zusätzlicher Matrixaktion');
    assertEqual(table.querySelectorAll('tbody tr').length, 12, 'Neue Seite zeigt vollständige zwölfmonatige Matrix');
    for (const cell of table.querySelectorAll('td[data-month][data-profile]')) {
        const [value, actions] = cell.children[0].children;
        assertEqual(value.className, 'expense-value', 'Ausgaben-Seite zeigt je Person zuerst den Betrag');
        assertEqual(actions.className, 'expense-actions', 'Ausgaben-Seite zeigt danach die eigenen Symbole');
        assertEqual(actions.children.map(button => button.dataset.action).join(','), 'import,details', 'Ausgaben-Seite behält Import und Details hinter dem Betrag');
    }
    assert(doc.getElementById('expensesHistoryTable').innerHTML.includes('2025'), 'Jahresvergleich ohne Balancepanel aktiv');
    const arrival = doc.activeElement;
    // Ein weiteres berechtigtes Profil erzwingt den echten Matrixersatz.
    const changedRegistry = JSON.parse(storage.getItem('rs_profiles_v1'));
    changedRegistry.profiles.focus_probe = structuredClone(changedRegistry.profiles.muster_b);
    changedRegistry.profiles.focus_probe.meta.id = 'focus_probe';
    changedRegistry.profiles.focus_probe.meta.name = 'Fokusprobe';
    storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry));
    controller.refresh();
    assert(doc.activeElement !== arrival && !table.contains(arrival), 'Echter Refresh ersetzt die fokussierte Matrixaktion');
    assertEqual(doc.activeElement?.dataset.action, 'import', 'Refresh erhält Importfokus nach Matrixersatz');
    assertEqual(doc.activeElement?.dataset.month, '1', 'Refresh erhält Zielmonat');
    assertEqual(doc.activeElement?.dataset.profile, arrival.dataset.profile, 'Refresh erhält Zielperson');
    delete changedRegistry.profiles.focus_probe;
    storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry)); controller.refresh();
    const emptyDetails = table.querySelector('button[data-action="details"][data-month="3"]');
    assert(emptyDetails.disabled, 'Datenlose Monatszelle hat keine aktive Detailsaktion');
    const beforeAbsent = storage.getItem('balance_expenses_v1');
    await table.fire('click', { target: emptyDetails });
    assert(!doc.getElementById('expensesDetailDialog').open, 'Datenlose Zelle öffnet keine Löschmöglichkeit');
    assertEqual(storage.getItem('balance_expenses_v1'), beforeAbsent, 'Datenlose Details erzeugen keinen Write');
    win.location.hash = '#ausgaben'; win.location.search = '?year=2025&month=3';
    windowEvents.get('hashchange')();
    assertEqual(doc.activeElement?.dataset.action, 'import', 'Normales datenloses Monatsziel fokussiert freigegebenen Import');
    assertEqual(doc.activeElement?.dataset.month, '3', 'Monatsziel behält den angefragten Monat');
    const heading = doc.getElementById('expensesHeading'); heading.focus(); controller.refresh();
    assertEqual(doc.activeElement, heading, 'Normaler Refresh stiehlt den Benutzerfokus nicht');
    // B3: Ziel während einer echten Commitsperre; Fokus erst nach Freigabe.
    const navigationGuard = getPageNavigationGuard(doc, win);
    // R-05: Ein bewusster Blur auf body beendet den alten Matrixfokus.
    for (const change of ['refresh', 'disabled', 'rebuild']) {
        const button = table.querySelector('button[data-action="import"][data-month="3"]');
        button.focus(); doc.dispatchEvent({ type: 'focusin', target: button });
        assert(button.isConnected && !button.disabled, `${change}: Nutzer verlässt einen verbundenen, freigegebenen Knoten`);
        doc.activeElement = doc.body;
        doc.dispatchEvent({ type: 'focusout', target: button, relatedTarget: null });
        if (change === 'refresh') controller.refresh();
        if (change === 'disabled') {
            const lease = navigationGuard.register('user-blur-probe', { read: () => ({ phase: 'commit' }) });
            assert(button.disabled, 'Echte Commitsperre deaktiviert die verlassene Monatsaktion');
            assertEqual(doc.activeElement, doc.body, 'Commitsperre übernimmt nach Nutzer-Blur keinen Fokus');
            lease.unregister();
            assert(!button.disabled, 'Freigabe aktiviert die verlassene Monatsaktion wieder');
        }
        if (change === 'rebuild') {
            changedRegistry.profiles.focus_probe = structuredClone(changedRegistry.profiles.muster_b);
            changedRegistry.profiles.focus_probe.meta.id = 'focus_probe';
            storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry));
            refreshExpensesView();
            assert(!table.contains(button), 'Matrixneuaufbau ersetzt tatsächlich die vom Nutzer verlassene Aktion');
            delete changedRegistry.profiles.focus_probe;
            storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry)); controller.refresh();
        }
        assertEqual(doc.activeElement, doc.body, `${change}: Nach Nutzer-Blur bleibt der Fokus auf body`);
    }
    // Sperrenbedingter Fokusverlust ist weiterhin wiederherstellbar.
    const disabledFocus = table.querySelector('button[data-action="import"][data-month="3"]');
    disabledFocus.focus(); doc.dispatchEvent({ type: 'focusin', target: disabledFocus });
    const disabledLease = navigationGuard.register('disabled-focus-probe', { read: () => ({ phase: 'commit' }) });
    assert(disabledFocus.disabled, 'Sperrenbedingter Blur trifft einen deaktivierten Knoten');
    doc.activeElement = doc.body;
    doc.dispatchEvent({ type: 'focusout', target: disabledFocus, relatedTarget: null });
    disabledLease.unregister();
    assertEqual(doc.activeElement, disabledFocus, 'Freigabe stellt durch Deaktivierung verlorenen Matrixfokus wieder her');
    assertEqual(disabledFocus.lastFocusOptions?.preventScroll, true, 'Automatische Fokuswiederherstellung verhindert einen Scrollsprung');
    heading.focus(); doc.dispatchEvent({ type: 'focusin', target: heading });
    let locked = true;
    const arrivalLease = navigationGuard.register('arrival-probe', { read: () => ({ phase: locked ? 'commit' : 'idle' }) });
    controller.applyTarget({ target: 'ausgaben', year: 2025, month: 1 });
    assertEqual(doc.activeElement, heading, 'Gesperrtes Ankunftsziel fokussiert keinen deaktivierten Knoten');
    locked = false; arrivalLease.unregister(); controller.refresh();
    assertEqual(doc.activeElement?.dataset.action, 'details', 'Freigabe fokussiert das ausstehende vorhandene Monatsdetail');
    assertEqual(doc.activeElement?.dataset.month, '1', 'Verzögerte Freigabe erhält die Zielperiode');
    locked = true;
    const newMonthLease = navigationGuard.register('arrival-new-month', { read: () => ({ phase: locked ? 'commit' : 'idle' }) });
    controller.applyTarget({ target: 'ausgaben-import', year: 2025, month: 3 });
    locked = false; newMonthLease.unregister(); controller.refresh();
    assertEqual(doc.activeElement?.dataset.month, '3', 'Neues gesperrtes Ziel ersetzt nach Freigabe den bisherigen Matrixfokus');
    locked = true;
    const invalidLease = navigationGuard.register('arrival-invalid', { read: () => ({ phase: locked ? 'commit' : 'idle' }) });
    controller.applyTarget({ target: 'ausgaben-import', year: 2025, month: 4 });
    assertEqual(applyExpensesTarget(controller, { search: '?year=2025&month=13', hash: '#ausgaben' }, doc), false, 'Ungültiger Folgehash beendet den ausstehenden Ankunftsauftrag');
    locked = false; invalidLease.unregister(); controller.refresh();
    assertEqual(doc.activeElement?.dataset.month, '3', 'Ungültiges Folgeziel führt nach Freigabe zu keiner Monatsaktion');
    locked = true;
    const cancelledArrival = navigationGuard.register('arrival-cancel-probe', { read: () => ({ phase: locked ? 'commit' : 'idle' }) });
    doc.activeElement = doc.body;
    controller.applyTarget({ target: 'ausgaben-import', year: 2025, month: 3 });
    heading.focus(); doc.dispatchEvent({ type: 'focusin', target: heading });
    locked = false; cancelledArrival.unregister(); controller.refresh();
    assertEqual(doc.activeElement, heading, 'Nutzerfokus während der Sperre beendet den verspäteten Ankunftsauftrag');
    // Der gemeinsame Renderer darf ebenfalls neue Knoten erzeugen.
    controller.applyTarget({ target: 'ausgaben-import', year: 2025, month: 3 });
    doc.dispatchEvent({ type: 'focusin', target: doc.activeElement });
    const bypassFocus = doc.activeElement;
    changedRegistry.profiles.focus_probe = structuredClone(changedRegistry.profiles.muster_b);
    changedRegistry.profiles.focus_probe.meta.id = 'focus_probe';
    storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry));
    refreshExpensesView();
    assert(doc.activeElement !== bypassFocus && !table.contains(bypassFocus), 'Gemeinsamer Matrixaufbau ersetzt tatsächlich den fokussierten Knoten');
    assertEqual(doc.activeElement?.dataset.profile, bypassFocus.dataset.profile, 'Gemeinsamer Matrixaufbau erhält die Zielperson außerhalb controller.refresh');
    assertEqual(doc.activeElement?.dataset.month, '3', 'Gemeinsamer Matrixaufbau erhält den Zielmonat');
    delete changedRegistry.profiles.focus_probe;
    storage.setItem('rs_profiles_v1', JSON.stringify(changedRegistry)); controller.refresh();
    // B12: echtes Modell und echter Renderer, keine nachgebildete Prozentformel.
    const categoryView = projectExpenses({ store: { years: { 2025: { months: { 1: { profiles: { a: {
        categories: { Ausgabe: -10000, Zweit: -5000, Winzig: -0.01, Null: 0, Erstattung: 20 }
    } } } } } } }, year: 2025, people: [{ id: 'a', name: 'A' }], now: new Date(2026, 9, 10) });
    renderExpensesPage(doc, categoryView);
    const categoryRows = [...doc.getElementById('expensesCategories').children];
    const categoryRow = name => categoryRows.find(row => row.children[0].textContent === name);
    assertEqual(categoryRow('Ausgabe').children[1].children[0].style.width, '100%', 'Größte Kategorie füllt die gesamte Spur');
    assertEqual(categoryRow('Zweit').children[1].children[0].style.width, '50%', 'Halber Kategoriebetrag füllt die halbe Spur');
    assert(categoryRow('Ausgabe').textContent.endsWith(' · 67 %') && categoryRow('Zweit').textContent.endsWith(' · 33 %'),
        'Relative Balken erhalten rechts die echten Anteile an den Ausgaben');
    assertEqual(categoryRow('Null').children[1].children[0].style.width, '0%', 'Nullbetrag erzeugt keinen Kategorienbalken');
    assertEqual(categoryRow('Erstattung · Erstattung').children[1].children[0].style.width, '0%', 'Negative Erstattung erzeugt keinen positiven Balken');
    assert(categoryRows.find(row => row.children[0].textContent === 'Winzig').textContent.endsWith(' · < 1 %'), 'Positiver Kleinstanteil wird sichtbar statt auf echte Null gerundet');
    assert(categoryRows.find(row => row.children[0].textContent === 'Null').textContent.endsWith(' · 0 %'), 'Echte Null bleibt 0 %');
    const refundText = categoryRows.find(row => row.children[0].textContent === 'Erstattung · Erstattung').textContent;
    assert(/[−-]20/.test(refundText), 'Erstattung behält Kennzeichnung und negatives Vorzeichen');
    controller.refresh();
    controller.selectYear(2025);
    assertEqual(storage.getItem('balance_expenses_v1'), rawStore, 'Jahresfilter schreibt keine Records');
    const personButtons = doc.getElementById('expensesPersonSegments').querySelectorAll('button');
    await personButtons[1].fire('click');
    assertEqual(controller.view.ids.length, 1, 'Personensegment filtert Darstellung');
    assertEqual(storage.getItem('household_plan_v1'), plan, 'Anzeige und Filter erhalten den Jahresplan');
    const field = doc.getElementById('expensesCsvInput');
    const importMonth = async (month, text = async () => 'Kategorie;Betrag\nWohnen;-100\nErstattung;20') => {
        const button = table.querySelector(`button[data-action="import"][data-month="${month}"]`);
        await table.fire('click', { target: button });
        field.files = [{ text }]; return field.fire('change');
    };
    accept = false;
    await importMonth(2);
    assertEqual(storage.getItem('balance_expenses_v1'), rawStore, 'Vorschauabbruch am neuen Zelllistener schreibt nichts');
    assertEqual(confirmations, 1, 'Zellimport erreicht D5-Vorschauvertrag');
    assertEqual(previews[0].year, 2025, 'Vorschau erhält ausgewähltes Jahr');
    accept = true;
    const expectedWealth = createManualWealthHistoryEntry(controller.capture.update({ mode: 'preview' }).inputData, '2026-10-10');
    await importMonth(2);
    const captured = readWealthHistory(JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY))).entries.filter(entry => entry.asOf === '2026-10-10');
    assertEqual(captured.length, 1, 'Bestätigter Seitenimport erfasst genau einen Tagespunkt');
    assertEqual(JSON.stringify(captured[0]), JSON.stringify(expectedWealth), 'Automatische Erfassung sichert exakt den bestehenden Vermögensstand');
    assertEqual(controller.view.stats.annualUsed, 160, 'Bestätigter echter Import aktualisiert Kacheln und Modell');
    assert(doc.getElementById('expensesCategories').textContent.includes('Erstattung'), 'Import aktualisiert Kategorien');
    const committed = storage.getItem('balance_expenses_v1');
    faults.write = () => { throw new Error('Synthetischer Schreibfehler'); };
    await importMonth(2, async () => 'Kategorie;Betrag\nAusgabe;-9999');
    assertEqual(storage.getItem('balance_expenses_v1'), committed, 'Dauerhafter Schreibfehler schützt ursprüngliche Records');
    delete faults.write;
    const held = deferred(); const reading = importMonth(3, () => held.promise);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert(table.querySelectorAll('button[data-month][data-profile]').every(button => button.disabled), 'Dateilesen sperrt auch vorhandene Monatsdetails');
    controller.close.sync();
    assert(table.querySelectorAll('button[data-month][data-profile]').every(button => button.disabled), 'Abschlusssynchronisation umgeht laufende Importsperre nicht');
    controller.selectYear(2026); held.resolve('Kategorie;Betrag\nAusgabe;-500'); await reading;
    assertEqual(storage.getItem('balance_expenses_v1'), committed, 'Jahreswechsel während Dateilesen schützt Originalrecords');
    controller.selectYear(2025);
    const heldPerson = deferred(); const readingPerson = importMonth(3, () => heldPerson.promise);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await personButtons[2].fire('click'); heldPerson.resolve('Kategorie;Betrag\nAusgabe;-700'); await readingPerson;
    assertEqual(storage.getItem('balance_expenses_v1'), committed, 'Personenwechsel während Dateilesen schützt Originalrecords');
    await doc.getElementById('expensesDueImport').fire('click');
    assertEqual(controller.view.year, 2026, 'Hinweisimport wählt fachliches Jahr statt Historienjahr');
    assertEqual(doc.activeElement.dataset.month, '9', 'Hinweisimport fokussiert fachlichen Vormonat');
    assertEqual(controller.close.read().expenses.year, 2026, 'Abschlusskontext bleibt vom sichtbaren Jahr unabhängig');
    assertEqual(controller.close.read().expenses.month, 9, 'Abschlusskontext nennt September');
    controller.selectYear(2025);
    const beforeClose = storage.getItem('balance_expenses_v1');
    const trigger = doc.getElementById('expensesClose');
    await Promise.all([doc.getElementById('overviewFocus').fire('click', { target: trigger }), doc.getElementById('overviewFocus').fire('click', { target: trigger })]);
    assertEqual(doc.activeElement.id, 'expensesClose', 'Abschlussabbruch gibt Fokus an neuen Hinweisbandknopf zurück');
    assertEqual(closeRequests.length, 1, 'Doppelklick am neuen Hinweisband öffnet nur eine Monatsrückfrage');
    assertEqual(closeRequests[0].expenses.year, 2026, 'Neue Monatsrückfrage verwendet Fachjahr statt sichtbarem Historienjahr');
    assertEqual(closeRequests[0].expenses.month, 9, 'Neue Monatsrückfrage verwendet fachlichen September');
    assertEqual(storage.getItem('balance_expenses_v1'), beforeClose, 'Abschlussabbruch verändert Imports nicht');
    setAppTestDate('2027-01-02'); controller.selectYear(2020);
    assertEqual(controller.close.read().occasion.closingYear, 2026, 'Januarwechsel verwendet gemeinsames Abschlussjahr statt Anzeigefilter');
    assertEqual(controller.close.read().expenses.month, 12, 'Januarabschluss importiert Dezember');
    setAppTestDate('2026-10-10'); controller.refresh();
    assertEqual(table.querySelectorAll('[data-expenses-example]').length, 0, 'Ohne freigegebenen Probelauf keine Beispielaktionen');
    assertEqual(getPageNavigationGuard(doc, win).reasons().length, 0, 'Importbesitzer werden vollständig freigegeben');
    controller.selectYear(2025); await personButtons[1].fire('click');
    const showDetails = async () => {
        const button = table.querySelector('button[data-action="details"][data-month="2"]');
        await table.fire('click', { target: button });
        assert(doc.getElementById('expensesDetailDialog').open, 'Monatsdetails öffnen am neuen Ort');
        assert(doc.getElementById('expensesDetailTitle').textContent.includes('Februar'), 'Monatsdetails erhalten Zielidentität');
        const body = doc.getElementById('expensesDetailBody');
        assert(!walk(body).some(node => (node.className || '').split(' ').includes('expense-top')), 'Echte Monatsdetails enthalten keinen Top-3-Block');
        assertEqual(body.children.length, 1, 'Echte Monatsdetails zeigen nur eine Kategorientabelle');
        assertEqual(body.children[0].children[0].children.map(row => row.children[0].textContent).join(','), 'Wohnen,Erstattung', 'Echte Monatsdetails behalten alle importierten Kategorien in Betragsreihenfolge');
    };
    await showDetails();
    const remove = doc.getElementById('expensesDetailDelete');
    const respond = async (job, choice) => {
        let dialog;
        for (let i = 0; i < 100 && !dialog; i++) { dialog = doc.getElementById('pageDialog'); await Promise.resolve(); }
        assert(dialog?.open, 'Löschung erfordert echte Bestätigungsrückfrage');
        assertEqual(getPageNavigationGuard(doc, win).reasons().filter(reason => reason.phase === 'commit').length, 1, 'Navigation schützt registrierte Löschentscheidung');
        await dialog.querySelector(choice).fire('click'); await job;
    };
    await respond(remove.fire('click'), '[data-page-dialog-cancel]');
    assertEqual(storage.getItem('balance_expenses_v1'), committed, 'Abgebrochene Löschung erhält Originalrecords');
    await showDetails();
    await respond(remove.fire('click'), '[data-page-dialog-accept]');
    assert(!JSON.parse(storage.getItem('balance_expenses_v1')).years[2025].months[2].profiles.muster_a, 'Bestätigte Löschung entfernt genau den Zielrecord');
    assert(table.querySelector('button[data-action="details"][data-month="2"]').disabled, 'Löschung entzieht exakt dem Zielrecord die Detailsberechtigung');
    assert(!table.querySelector('button[data-action="details"][data-month="1"]').disabled, 'Andere vorhandene Monatsdetails bleiben freigegeben');
    // Gültige Präsenz ist unabhängig von Vorzeichen oder Nettobetrag.
    for (const [month, categories] of [[4, {}], [5, { Erstattung: 50 }], [6, { Ausgabe: -50, Erstattung: 50 }]]) {
        const current = JSON.parse(storage.getItem('balance_expenses_v1'));
        current.years[2025].months[month] = { profiles: { muster_a: { categories } } };
        storage.setItem('balance_expenses_v1', JSON.stringify(current)); await P.flush(); controller.refresh();
        const details = table.querySelector(`button[data-action="details"][data-month="${month}"]`);
        assert(!details.disabled, `${month}: Null-/Erstattungsimport besitzt freigegebene Details`);
        await table.fire('click', { target: details });
        assert(doc.getElementById('expensesDetailDialog').open && !remove.disabled, `${month}: echte Details erlauben bestätigbare Löschung`);
        await respond(remove.fire('click'), '[data-page-dialog-accept]');
        assert(table.querySelector(`button[data-action="details"][data-month="${month}"]`).disabled, `${month}: bestätigte Löschung sperrt Details wieder`);
    }
    const guard = getPageNavigationGuard(doc, win);
    const closing = guard.register('synthetic-close', { read: () => ({ phase: 'commit' }) });
    controller.close.sync(); controller.refresh();
    assert(table.querySelectorAll('button[data-month][data-profile]').every(button => button.disabled), 'Fremder Abschlussbesitz bleibt nach Sync und Refresh gesperrt');
    closing.unregister(); controller.close.sync();
    assert(!table.querySelector('button[data-action="import"][data-month="2"]').disabled
        && table.querySelector('button[data-action="details"][data-month="2"]').disabled,
        'Abschlussfreigabe entsperrt Import und erhält Datenpräsenzsperre');
    storage.setItem('balance_expenses_v1', '{synthetic-corrupt'); await P.flush(); controller.refresh();
    const recovery = table.querySelector('[data-expenses-recovery="corrupt"]');
    assert(Boolean(recovery), 'Beschädigter Bestand zeigt Recovery statt Leeransicht');
    assertEqual(doc.getElementById('expensesHistoryTable').innerHTML, '', 'Recovery entfernt veraltete Jahreswerte');
    assertEqual(doc.getElementById('expensesSpent').textContent, '—', 'Recovery entfernt veraltete Kacheln');
    const recoveryAction = action => table.querySelector(`[data-action="expenses-recovery-${action}"]`);
    assertEqual(recoveryAction('reset').disabled, true, 'Reset vor erfolgreichem Export gesperrt');
    await recoveryAction('export').fire('click');
    assertEqual(storage.getItem('balance_expenses_v1'), '{synthetic-corrupt', 'Exportfehler verändert Rohbestand nicht');
    assertEqual(recoveryAction('reset').disabled, true, 'Exportfehler schaltet Reset nicht frei');
    exportFails = false; await recoveryAction('export').fire('click');
    assertEqual(recoveryAction('reset').disabled, false, 'Erfolgreicher Export erlaubt Bestätigungsrückfrage');
    await recoveryAction('reset').fire('click');
    assertEqual(storage.getItem('balance_expenses_v1'), '{synthetic-corrupt', 'Unbestätigter Reset verändert Rohbestand nicht');
    resetAllowed = true; await recoveryAction('reset').fire('click');
    assertEqual(Object.keys(JSON.parse(storage.getItem('balance_expenses_v1')).years).length, 0, 'Bestätigter Reset leert alle Jahre und Personen');
    assertEqual(doc.getElementById('expensesHistoryTable').innerHTML, '', 'Leerer Bestand lässt keine veralteten Jahreswerte stehen');
} finally {
    P.resetPersistenceForTests(); fixture?.restore(); setAppTestDate(previousDate);
}

// Auch der echte Seitenstart mit normalem Monatsziel respektiert die neue
// Präsenzgrenze; ungültige und parameterlose Ankünfte erzwingen keinen Monatsfokus.
for (const target of ['?year=2025&month=1#ausgaben', '?year=2025&month=3#ausgaben', '', '?year=2025&month=13#ausgaben']) for (const loading of
    target.includes('month=1#') ? [false, true, 'user-focus', 'invalid-target', 'guard'] : [false, true]) {
    let startFixture;
    try {
        setAppTestDate('2026-10-10');
        startFixture = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/Ausgaben.html' + target });
        const { doc, win } = startFixture;
        doc.htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
        for (const [, tag, id] of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) doc.getElementById(id).tagName = tag.toUpperCase();
        doc.documentElement = doc.createElement('html'); doc.documentElement.dataset.suitePage = 'expenses';
        doc.readyState = loading ? 'interactive' : 'complete';
        const loadListeners = new Set(), addListener = win.addEventListener.bind(win);
        win.addEventListener = (type, callback, options) => {
            if (type === 'load') loadListeners.add(callback);
            addListener(type, callback, options);
        };
        win.sessionStorage = globalThis.sessionStorage;
        const sample = readyAnnualFixture(); sample.records.balance_expenses_v1 = rawStore;
        await annualServiceFixture({ sample });
        const controller = await initExpensesPage(doc, win);
        assert(controller !== false, 'Echter Start akzeptiert vorhandene Profilquellen: ' + target);
        let lease;
        const heading = doc.getElementById('expensesHeading');
        if (loading) {
            // Native Fragmentnavigation liegt außerhalb des Controllerstarts.
            // Der nicht fokussierbare Host #ausgaben lässt activeElement auf body.
            const previousFocus = doc.activeElement;
            doc.activeElement = doc.body;
            if (previousFocus !== doc.body) doc.dispatchEvent({ type: 'focusout', target: previousFocus, relatedTarget: null });
            if (loading === 'user-focus') { heading.focus(); doc.dispatchEvent({ type: 'focusin', target: heading }); }
            if (loading === 'invalid-target') applyExpensesTarget(controller, { search: '?year=2025&month=13', hash: '#ausgaben' }, doc);
            if (loading === 'guard') lease = getPageNavigationGuard(doc, win).register('loading-arrival', { read: () => ({ phase: 'commit' }) });
            const beforeLoad = doc.activeElement;
            controller.refresh();
            assertEqual(doc.activeElement, beforeLoad, 'Refresh vor load übernimmt keinen Ankunftsfokus: ' + loading);
            doc.readyState = 'complete';
            for (const listener of loadListeners) listener({ type: 'load' });
            if (lease) {
                assertEqual(doc.activeElement, doc.body, 'load umgeht keine aktive Commitsperre');
                lease.unregister();
                assertEqual(doc.activeElement?.dataset.month, '1', 'Verzögerter Ankunftsauftrag behält den richtigen Monat');
                assertEqual(doc.activeElement?.dataset.profile, 'muster_a', 'Verzögerter Ankunftsauftrag behält die richtige Person');
            }
        }
        if (loading === 'user-focus' || loading === 'invalid-target') {
            assertEqual(doc.activeElement, loading === 'user-focus' ? heading : doc.body, loading + ': load reaktiviert keinen widerrufenen Ankunftsauftrag');
        } else if (target.includes('month=3')) {
            assertEqual(doc.activeElement?.dataset.action, 'import', 'Datenloses normales Ankunftsziel erhält freigegebenen Importfokus');
            assertEqual(doc.activeElement?.dataset.month, '3', 'Echter Start erhält Zielmonat ohne Dateidialog');
        } else if (target.includes('month=1#')) {
            assertEqual(doc.activeElement?.dataset.action, 'details', 'Vorhandenes normales Monatsziel fokussiert Details');
            assert(!doc.activeElement.disabled, 'Ankunftsdetails sind tatsächlich freigegeben');
        } else assert(!doc.activeElement?.dataset?.month, 'Parameterlose/ungültige Ankunft erzwingt keinen Monatsfokus');
        assertEqual(storage.getItem('balance_expenses_v1'), rawStore, 'Lesender Ankunftsstart erhält Rohbytes');
    } finally { P.resetPersistenceForTests(); startFixture?.restore(); setAppTestDate(previousDate); }
}

// Dieselben drei Korruptionsbestände wie im Browserverlauf: Bereitschaft zum
// Lesen bedeutet weder Datenfreigabe noch einen hängenden Navigationsauftrag.
for (const { raw, storeCorrupt } of [{ raw: '{synthetic-corrupt', storeCorrupt: true },
    { raw: JSON.stringify({ version: 1, years: [] }), storeCorrupt: true },
    { raw: JSON.stringify({ version: 1, years: { '2026': { months: [] } } }), storeCorrupt: false }]) {
    let corruptFixture;
    try {
        corruptFixture = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/Ausgaben.html?year=2026#ausgaben' });
        const { doc, win } = corruptFixture;
        doc.htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
        for (const [, tag, id] of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) doc.getElementById(id).tagName = tag.toUpperCase();
        doc.documentElement = doc.createElement('html'); doc.documentElement.dataset.suitePage = 'expenses';
        win.sessionStorage = globalThis.sessionStorage;
        const sample = readyAnnualFixture(); sample.records.balance_expenses_v1 = raw;
        await annualServiceFixture({ sample });
        const controller = await initExpensesPage(doc, win);
        assert(controller && doc.documentElement.dataset.expensesReady === 'true', 'Korruptionsstart lädt den lesenden Controller');
        const guard = getPageNavigationGuard(doc, win);
        assert(!guard.isBusy() && !guard.reasons().length, 'Korruptionsstart hinterlässt keinen Navigationsbesitzer');
        const lease = guard.register('corrupt-start-probe', { read: () => ({ phase: 'commit' }) });
        lease.unregister(); controller.refresh(); await P.flush();
        assert(!guard.isBusy() && !guard.reasons().length, 'Guardbenachrichtigung und Refresh geben alle Korruptionsstartbesitzer frei');
        // Der Store prüft JSON und years; die strengere Verlaufprojektion
        // diagnostiziert zusätzlich months. Bestehende Speichersemantik erhalten.
        if (storeCorrupt) assert(doc.getElementById('expensesTable').querySelector('[data-expenses-recovery="corrupt"]'), 'Korruptionsstart zeigt weiterhin die Store-Recovery');
        assert(doc.getElementById('expensesHistoryHint').textContent.includes('Recovery'), 'Ungültiger Bestand behält die sichere Recoverydiagnose im Verlauf');
        assertEqual(doc.getElementById('expensesHistoryTable').innerHTML, '', 'Korruptionsstart zeigt keine veralteten Jahreswerte');
        assertEqual(storage.getItem('balance_expenses_v1'), raw, 'Korruptionsstart und Guardprüfung erhalten Originalrohbytes');
    } finally { P.resetPersistenceForTests(); corruptFixture?.restore(); setAppTestDate(previousDate); }
}

// Ein echter fehlgeschlagener Profilstart darf keinen Mustercontroller erzeugen.
let unavailableFixture;
try {
    unavailableFixture = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/Ausgaben.html' });
    const { doc, win } = unavailableFixture;
    doc.htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    doc.documentElement = doc.createElement('html'); doc.documentElement.dataset.suitePage = 'expenses';
    win.sessionStorage = globalThis.sessionStorage;
    const sample = readyAnnualFixture(); sample.records.rs_profiles_v1 = '{synthetic-profile-corrupt';
    await annualServiceFixture({ sample });
    const raw = storage.getItem('balance_expenses_v1');
    const result = await initExpensesPage(doc, win);
    assertEqual(result, false, 'Beschädigte Profilquelle verhindert echten Seitenstart');
    assertEqual(doc.documentElement.dataset.expensesReady, undefined, 'Kein vorgetäuschter Bereitschaftsstatus');
    assertEqual(storage.getItem('balance_expenses_v1'), raw, 'Fehlender Profilstart verändert Ausgabenbestand nicht');
    assertEqual(doc.getElementById('expensesRecoveryLinks').hidden, false, 'Fehlender Profilstart zeigt sichere Sicherungs- und Personenwege');
} finally { P.resetPersistenceForTests(); unavailableFixture?.restore(); setAppTestDate(previousDate); }
