import { annualServiceFixture, readyAnnualFixture } from './helpers/balance-storage-fixtures.mjs';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { RESET_RELOAD_REQUIRED_MESSAGE } from '../app/shared/navigation-guard.js';
import { bindProfileNavigationHandoff, installProfilePersistenceHooks } from '../app/profile/profile-navigation.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UIBinder, initUIBinder, trackBalanceInputSave } from '../app/balance/balance-binder.js';
import { bindBalanceInfoPopups } from '../app/balance/balance-renderer-diagnosis.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { CONFIG, ValidationError } from '../app/balance/balance-config.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { UIRenderer, initUIRenderer } from '../app/balance/balance-renderer.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import {
    BALANCE_UPDATE_MODE,
    BALANCE_UPDATE_STATUS,
    persistBalanceUpdate,
    assertActiveEngineHandshake,
    createEngineHandshake,
    createUpdateFailureResult,
    createUpdateSuccessResult
} from '../app/balance/balance-update-pipeline.js';
import { ANNUAL_MARKET_DATA_META_KEY } from '../app/balance/balance-annual-marketdata.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';
import { EngineAPI } from '../engine/index.mjs';

const __filename = fileURLToPath(import.meta.url);

class MockClassList {
    constructor() {
        this.classes = new Set();
    }

    add(name) {
        this.classes.add(name);
    }

    remove(name) {
        this.classes.delete(name);
    }

    contains(name) {
        return this.classes.has(name);
    }

    toggle(name, force) {
        const shouldAdd = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (shouldAdd) this.classes.add(name);
        else this.classes.delete(name);
        return shouldAdd;
    }
}

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = String(tagName).toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerText = '';
        this.innerHTML = '';
        this.checked = false;
        this.disabled = false;
        this.style = { display: '' };
        this.dataset = {};
        this.type = '';
        this.listeners = {};
        this.children = [];
        this.parentNode = null;
        this.classList = new MockClassList();
    }

    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter(existing => existing !== handler);
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    replaceChildren(...nodes) { this.children = []; this.textContent = ''; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }

    replaceChild(nextChild, oldChild) {
        const index = this.children.indexOf(oldChild);
        if (index >= 0) this.children[index] = nextChild;
        nextChild.parentNode = this;
        oldChild.parentNode = null;
        return oldChild;
    }

    cloneNode() {
        const clone = new MockElement(this.id, this.tagName);
        clone.value = this.value;
        clone.textContent = this.textContent;
        clone.innerText = this.innerText;
        clone.innerHTML = this.innerHTML;
        clone.checked = this.checked;
        clone.disabled = this.disabled;
        clone.style = { ...this.style };
        clone.dataset = { ...this.dataset };
        clone.type = this.type;
        return clone;
    }

    setAttribute(name, value) { this[name] = String(value); }

    getAttribute(name) { return this[name] ?? null; }

    focus() { globalThis.document.activeElement = this; }

    click() {
        if (this.disabled) return;
        (this.listeners.click || []).forEach(handler => handler({ target: this, currentTarget: this, preventDefault() {} }));
    }

    matches(selector) {
        return selector === '.btn-apply-inflation' && this.classList.contains('btn-apply-inflation');
    }

    closest(selector) {
        if (selector === '.tab-btn' && this.classList.contains('tab-btn')) return this;
        if (selector === '.restore-snapshot' && this.classList.contains('restore-snapshot')) return this;
        if (selector === '.delete-snapshot' && this.classList.contains('delete-snapshot')) return this;
        return null;
    }

    querySelector(selector) {
        if (selector === '.active') {
            return this.children.find(child => child.classList.contains('active')) || null;
        }
        if (selector === '.modal-close') {
            return this.children.find(child => child.classList.contains('modal-close')) || null;
        }
        if (selector === '.modal-overlay') {
            return this.children.find(child => child.classList.contains('modal-overlay')) || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        return selector === '.tab-btn' ? this.children.filter(child => child.classList.contains('tab-btn')) : [];
    }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.listeners = {};
        this.visibilityState = 'visible';
    }

    createElement(tagName) {
        const element = new MockElement('', tagName);
        element.ownerDocument = this;
        return element;
    }

    createDocumentFragment() {
        return new MockElement('fragment', 'fragment');
    }

    createTextNode(text) {
        const node = new MockElement('', 'text');
        node.textContent = String(text);
        return node;
    }

    register(element) {
        element.ownerDocument = this;
        this.elements.set(element.id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    querySelectorAll(selector) {
        if (selector === 'input.currency') {
            return Array.from(this.elements.values()).filter(el => el.classList.contains('currency'));
        }
        if (selector === '.profilverbund-toggle-target') {
            return Array.from(this.elements.values()).filter(el => el.classList.contains('profilverbund-toggle-target'));
        }
        return [];
    }

    querySelector() {
        return null;
    }

    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter(existing => existing !== handler);
    }
}


function installResetDialog(doc) {
    for (const id of ['navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave', 'suiteNavigationStatus']) {
        const el = doc.register(new MockElement(id, 'button'));
        el.isConnected = true;
        el.focus = () => { doc.activeElement = el; };
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; (el.listeners.close || []).slice().forEach(fn => fn()); };
        el.removeEventListener = (type, fn) => { el.listeners[type] = (el.listeners[type] || []).filter(current => current !== fn); };
    }
    return id => (doc.getElementById(id).listeners.click || []).slice().forEach(fn => fn());
}

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: key => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: key => { store.delete(String(key)); },
        clear: () => { store.clear(); },
        key: index => Array.from(store.keys())[index] || null,
        get length() { return store.size; }
    };
}

function createDomRefs(documentRef) {
    const tabButtons = documentRef.register(new MockElement('tabButtons'));
    const activeTab = new MockElement('tab-overview-button', 'button');
    activeTab.classList.add('active');
    tabButtons.appendChild(activeTab);

    const tabPanel = documentRef.register(new MockElement('tab-overview'));
    tabPanel.classList.add('active');

    const form = documentRef.register(new MockElement('input-form-container'));
    const currencyInput = documentRef.register(new MockElement('currencyInput', 'input'));
    currencyInput.classList.add('currency');

    const controls = {
        copyAction: documentRef.register(new MockElement('copyAction', 'button')),
        btnJahresUpdate: documentRef.register(new MockElement('btnJahresUpdate', 'button')),
        btnNachruecken: documentRef.register(new MockElement('btnNachruecken', 'button')),
        btnUndoNachruecken: documentRef.register(new MockElement('btnUndoNachruecken', 'button')),
        btnCsvImport: documentRef.register(new MockElement('btnCsvImport', 'button')),
        csvFileInput: documentRef.register(new MockElement('csvFileInput', 'input')),
        annualTestOpener: documentRef.register(new MockElement('annualTestOpener', 'button')),
        snapshotStatus: documentRef.register(new MockElement('snapshotStatus'))
    };

    const diagnosis = {
        openBtn: documentRef.register(new MockElement('diagnosisOpen', 'button')),
        copyBtn: documentRef.register(new MockElement('diagnosisCopy', 'button')),
        filterToggle: documentRef.register(new MockElement('diagnosisFilter', 'input')),
        content: documentRef.register(new MockElement('diagnosisContent'))
    };

    documentRef.register(new MockElement('handlungContent')).innerText = 'Aktion';

    return {
        inputs: {
            profilName: documentRef.register(new MockElement('profilName', 'input')),
            tagesgeld: documentRef.register(new MockElement('tagesgeld', 'input')),
            renteAktiv: documentRef.register(new MockElement('renteAktiv', 'select')),
            renteMonatlich: documentRef.register(new MockElement('renteMonatlich', 'input')),
            fixedIncomeAnnual: documentRef.register(new MockElement('fixedIncomeAnnual', 'input')),
            aktuellesAlter: documentRef.register(new MockElement('aktuellesAlter', 'input')),
            marketCsvMode: documentRef.register(new MockElement('marketCsvMode', 'select')),
            marketCsvTargetYear: documentRef.register(new MockElement('marketCsvTargetYear', 'input')),
            marketCsvExpectedAsOf: documentRef.register(new MockElement('marketCsvExpectedAsOf', 'input')),
            marketCsvInstrument: documentRef.register(new MockElement('marketCsvInstrument', 'input')),
            endeVJ: documentRef.register(new MockElement('endeVJ', 'input')),
            endeVJ_1: documentRef.register(new MockElement('endeVJ_1', 'input')),
            endeVJ_2: documentRef.register(new MockElement('endeVJ_2', 'input')),
            endeVJ_3: documentRef.register(new MockElement('endeVJ_3', 'input')),
            ath: documentRef.register(new MockElement('ath', 'input')),
            jahreSeitAth: documentRef.register(new MockElement('jahreSeitAth', 'input'))
        },
        outputs: {
            snapshotList: documentRef.register(new MockElement('snapshotList')),
            marketDataProvenance: documentRef.register(new MockElement('marketDataProvenance'))
        },
        controls,
        containers: {
            form,
            tabButtons,
            tabPanels: [tabPanel],
            bedarfAnpassung: documentRef.register(new MockElement('bedarfAnpassung'))
        },
        diagnosis
    };
}

function installBrowserGlobals(documentRef, localStorageRef) {
    global.document = documentRef;
    global.window = {
        addEventListener() {},
        removeEventListener() {},
        localStorage: localStorageRef
    };
    global.localStorage = localStorageRef;
    Object.defineProperty(global, 'navigator', {
        configurable: true,
        value: {
        clipboard: {
            writeText: async () => true
        }
        }
    });
    global.location = { reload() {} };
    global.confirm = () => true;
    global.HTMLInputElement = MockElement;
    global.URL = {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {}
    };
    global.Blob = class {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
        }
    };
}

const prevDocument = global.document;
const prevWindow = global.window;
const prevLocalStorage = global.localStorage;
const prevNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
const prevLocation = global.location;
const prevConfirm = global.confirm;
const prevHTMLInputElement = global.HTMLInputElement;
const prevURL = global.URL;
const prevBlob = global.Blob;
const prevToast = UIRenderer.toast;
const prevHandleError = UIRenderer.handleActionError;
const prevLoadState = StorageManager.loadState;
const prevSaveState = StorageManager.saveState;
const prevResetState = StorageManager.resetState;
const prevApplyStoredInputs = UIReader.applyStoredInputs;

async function runBalanceUiOrchestrationTests() {
    console.log('--- Balance UI Orchestration Tests ---');
    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests();
        const refs = createDomRefs(documentRef);
        refs.expenses = { yearSelect: new MockElement('expensesYearSelect', 'select'), table: new MockElement('expensesTable') };
        refs.expenses.yearSelect.value = '2026';
        initUIBinder(refs, {}, () => ({ ok: true }), () => {});
        const savedSelect = UIBinder.selectTab, savedPreparation = UIBinder.openAnnualOverview;
        let selections = 0, preparations = 0, focused = 0;
        const importButton = new MockElement('monthImport', 'button');
        importButton.dataset.month = '9'; importButton.focus = () => { focused++; };
        refs.expenses.table.querySelectorAll = () => [importButton];
        try {
            UIBinder.selectTab = () => {};
            UIBinder.openAnnualOverview = () => { preparations++; return true; };
            assertEqual(UIBinder.openOverviewTarget({ hash: '#ausgaben', search: '?year=2026' }), false, 'Sprungziel wartet auf bestätigte Bereitschaft');
            assertEqual(UIBinder.openOverviewTarget({ hash: '#unbekannt' }, { ready: true }), false, 'Balance ignoriert unbekanntes Ziel');
            assertEqual(UIBinder.openOverviewTarget({ hash: '#ausgaben', search: '?year=2026&month=13' }, { ready: true }), false, 'Balance ignoriert ungültige Auswahl');
            assertEqual(selections, 0, 'Ungültige Sprünge verändern keine Ansicht');
            delete refs.expenses;
            assertEqual(refs.expenses, undefined, 'Balance-Abschluss benötigt keine Ausgabenansicht');
            assertEqual(preparations, 0, 'Ausgabenziele starten keinen Jahresprozess');
            // Das explizite Ziel gilt auch bei abweichender globaler Location.
            const previousLocation = globalThis.location;
            try {
                globalThis.location = { hash: '#ausgaben', search: '?year=2026&month=9' };
                const navigations = [];
                const pending = UIBinder.openOverviewTarget({ hash: '#ausgaben-import', search: '?year=2025&month=3' }, {
                    ready: true, navigate: async request => { navigations.push(request); return true; }
                });
                assert(pending instanceof Promise, 'Ausgabenziel liefert eine asynchrone Navigationsbestätigung');
                assertEqual(await pending, true, 'Aufrufer wartet auf bestätigten Seitenwechsel');
                assertEqual(JSON.stringify(navigations), JSON.stringify([{ target: 'ausgaben-import', year: 2025, month: 3 }]),
                    'Weiterleitung erhält exakt das übergebene Importziel statt der globalen Location');
                assertEqual(selections + focused, 0, 'Weiterleitung bedient kein entferntes Balance-Ausgabenpanel');
            } finally {
                if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
            }
            assertEqual(UIBinder.openOverviewTarget({ hash: '#jahresabschluss', search: '?year=' + (new Date().getFullYear() - 1) }, { ready: true }), true, 'Jahresziel öffnet Vorbereitung');
            assertEqual(preparations, 1, 'Jahresziel startet genau einen Vorbereitungseinstieg');
            window.__profileRecoveryBlocker = true;
            assertEqual(UIBinder.openOverviewTarget({ hash: '#jahresabschluss' }, { ready: true }), false, 'Profil-Recovery blockiert Sprungaktion');
            window.__profileRecoveryBlocker = false;
            const owner = getPageNavigationGuard().register(Symbol('commit-probe'), { read: () => ({ phase: 'commit' }) });
            assertEqual(UIBinder.openOverviewTarget({ hash: '#ausgaben' }, { ready: true }), false, 'Commitbesitzer blockiert Sprungaktion');
            owner.unregister();
        } finally {
            UIBinder.selectTab = savedSelect; UIBinder.openAnnualOverview = savedPreparation;
        }
        const savedError = UIRenderer.handleActionError, savedClear = UIRenderer.clearActionError;
        try {
            UIRenderer.handleActionError = () => {}; UIRenderer.clearActionError = () => {};
            for (const metadata of [undefined, { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null }]) {
                const sample = readyAnnualFixture(), stored = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
                stored.annualPeriodMetadata = metadata;
                sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(stored);
                const env = await annualServiceFixture({ sample });
                const before = JSON.stringify(Object.fromEntries(env.backend));
                let legacyPrompts = 0, dialogs = 0;
                const service = env.create({ getLegacyDecision: () => { legacyPrompts++; return 'cancel'; },
                    confirmAnnual: async () => { dialogs++; return null; } });
                assertEqual((await service.close()).status, 'cancelled', 'Abgebrochene Vorbereitung beendet Jahreslink');
                assertEqual(dialogs, 1, 'Vorbereitung wird genau einmal geöffnet');
                assertEqual(legacyPrompts + env.batches.length + env.snapshots.size, 0, 'Ohne Zustimmung kein Write, Snapshot oder Legacycommit');
                assertEqual(JSON.stringify(Object.fromEntries(env.backend)), before, 'Jahreslink erhält fachliche Rohrecords');
            }
            const sample = readyAnnualFixture(), stored = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
            delete stored.annualPeriodMetadata; sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(stored);
            const env = await annualServiceFixture({ sample });
            let confirmed = false, dialogs = 0, legacyPrompts = 0, validations = 0;
            const service = env.create({ confirmAnnual: async () => { dialogs++; confirmed = true; return {}; },
                getLegacyDecision: () => { assert(confirmed, 'Legacyklärung folgt ausdrücklicher Bestätigung'); legacyPrompts++; return 'not_committed'; },
                validateLiveState: () => { validations++; return { ok: false, error: new Error('Synthetischer Prüfstop vor Snapshot') }; } });
            assertEqual((await service.close()).status, 'invalid', 'Bestätigte Vorbereitung folgt Fachvorprüfung');
            assertEqual(dialogs, 1, 'Kein zweiter Bestätigungsdialog');
            assertEqual(legacyPrompts, 0, 'Ohne Abschlussindiz keine zusätzliche Periodenfrage');
            assertEqual(env.batches.length, 0, 'Prüfstop schreibt auch keine Legacy-Metadaten');
            assertEqual(validations, 1, 'Bestätigte Vorbereitung übernimmt Fachvorprüfung');
        } finally { UIRenderer.handleActionError = savedError; UIRenderer.clearActionError = savedClear; PersistenceFacade.resetPersistenceForTests(); }

    }

    console.log('Auswertung: echter Tablistener aktualisiert beide Abschnitte ausschließlich lesend');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        const dom = createDomRefs(documentRef);
        const updatePanel = documentRef.register(new MockElement('tab-overview'));
        updatePanel.classList.add('active');
        const evaluationPanel = documentRef.register(new MockElement('tab-history'));
        documentRef.register(new MockElement('tab-expenses'));
        dom.containers.tabPanels = [updatePanel, evaluationPanel];
        const updateButton = dom.containers.tabButtons.children[0];
        updateButton.classList.add('tab-btn');
        updateButton.dataset.tab = 'overview';
        const evaluationButton = new MockElement('evaluation-button', 'button');
        evaluationButton.classList.add('tab-btn');
        evaluationButton.dataset.tab = 'history';
        dom.containers.tabButtons.appendChild(evaluationButton);
        const expensesButton = new MockElement('expenses-button', 'button');
        expensesButton.classList.add('tab-btn'); expensesButton.dataset.tab = 'expenses';
        // Die Ausgabenansicht besitzt ihren eigenen Seitencontroller.
        StorageManager.loadState = () => ({ inputs: {} });
        localStorageRef.setItem('balance_expenses_v1', JSON.stringify({ version: 1, years: {
            '2025': { months: { '1': { profiles: { A: { categories: { Ausgabe: -100 } } } } } }
        } }));
        let updates = 0, writes = 0, clears = 0;
        const originalWrite = localStorageRef.setItem;
        const originalClear = UIRenderer.clearError, originalActionClear = UIRenderer.clearActionError;
        localStorageRef.setItem = (...args) => { writes++; return originalWrite(...args); };
        UIRenderer.clearError = UIRenderer.clearActionError = () => { clears++; };
        try {
            initUIBinder(dom, { pendingInputMetadata: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' } }, () => { updates++; }, () => { updates++; });
            UIBinder.bindUI();
            assert(updatePanel.classList.contains('active') && !evaluationPanel.classList.contains('active'), 'Initialisierung erhält Jahres-Update');
            const click = dom.containers.tabButtons.listeners.click[0];
            // VS-3a: Der alte Balance-Verlaufsrenderer ist entfernt; ein Tabwechsel zeichnet keinen Vermögensverlauf mehr.
            click({ target: evaluationButton });
            assert(evaluationPanel.classList.contains('active'), 'Tabwechsel aktiviert das gewählte Panel');
            click({ target: updateButton });
            assert(updatePanel.classList.contains('active') && !evaluationPanel.classList.contains('active'), 'Rückwechsel aktiviert wieder das Jahres-Update');
            click({ target: evaluationButton });
            assertEqual(dom.expensesHistory, undefined, 'Balance hat keinen Ausgabenhistorienhost');
            assertEqual(updates + writes + clears, 0, 'Tablistener berechnet, erfasst, schreibt und bereinigt keine Fehler');
        } finally {
            localStorageRef.setItem = originalWrite;
            UIRenderer.clearError = originalClear;
            UIRenderer.clearActionError = originalActionClear;
        }
    }

    // Auch Hashziele lassen ausstehende Eingaben über den gemeinsamen Guard sichern.
    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        const dom = createDomRefs(documentRef), state = { debounceTimer: null };
        let response, mode, calls = 0;
        const flush = PersistenceFacade.flush;
        PersistenceFacade.flush = async () => true;
        try {
            initUIBinder(dom, state, options => { calls++; mode = options.mode; return response; }, () => {});
            installProfilePersistenceHooks({ doc: documentRef, win: window, saver: () => true, flusher: () => PersistenceFacade.flush() });
            const guard = getPageNavigationGuard(documentRef, window);
            const prepare = async () => {
                if (!await UIBinder.prepareExpensesNavigation()) return false;
                const attempt = await guard.prepare({ decide: async () => false });
                if (!attempt) return false;
                guard.end(attempt);
                return true;
            };
            assert(await prepare(), 'Ohne ausstehende Eingaben ist Ausgabennavigation bereit');
            assertEqual(calls, 0, 'Lesender Ausgabenwechsel berechnet keine Balance');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: false };
            assert(!await prepare(), 'Ungültige ausstehende Eingaben bleiben nach Bleiben erhalten');
            assertEqual(mode, BALANCE_UPDATE_MODE.PERSIST_INPUTS, 'Navigation verarbeitet Eingaben im bestehenden Persistenzmodus');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: true, overviewPersistence: Promise.resolve(false) };
            assert(!await prepare(), 'Fehlgeschlagene Summarybestätigung bleibt nach Bleiben erhalten');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: true, overviewPersistence: Promise.resolve(true) };
            assert(await prepare(), 'Bestätigte ausstehende Eingaben erlauben Ausgabennavigation');
            state.debounceTimer = setTimeout(() => {}, 10000);
            PersistenceFacade.flush = async () => false;
            assert(!await prepare(), 'Fehlgeschlagener Eingabeflush bleibt nach Bleiben erhalten');
        } finally { clearTimeout(state.debounceTimer); PersistenceFacade.flush = flush; }
    }

    // HS-1a: echte Feldhandler, danach Übergabe vor Ablauf der Entprellung.
    for (const exit of ['suite', 'beforeunload', 'pagehide']) {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        const listeners = new Map();
        window.addEventListener = (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]);
        const dom = createDomRefs(documentRef), state = { debounceTimer: null };
        let live = 'alt', snapshot = 'alt';
        const field = documentRef.register(new MockElement('hs1Input', 'input'));
        initUIBinder(dom, state, ({ mode }) => {
            assertEqual(mode, BALANCE_UPDATE_MODE.PERSIST_INPUTS, 'HS-1a nutzt den Eingabewriter');
            live = field.value;
            return { ok: true, overviewPersistence: Promise.resolve(true) };
        }, () => { state.debounceTimer = setTimeout(() => {}, 10000); });
        installProfilePersistenceHooks({ doc: documentRef, win: window,
            saver: () => { snapshot = live; return true; }, flusher: () => true });
        try {
            field.value = 'letzte Eingabe';
            UIBinder.handleFormInput({ target: field });
            assertEqual(live, 'alt', 'HS-1a wartet zunächst auf die Entprellung');
            if (exit === 'suite') {
                const guard = getPageNavigationGuard(documentRef, window);
                const attempt = await guard.prepare();
                assert(attempt, 'HS-1a bestätigt die Suite-Übergabe');
                guard.end(attempt);
            } else for (const listener of listeners.get(exit) || []) await listener({ preventDefault() {} });
            assertEqual(live, 'letzte Eingabe', `HS-1a ${exit}: Formular vor Übergabe gespeichert`);
            assertEqual(snapshot, live, `HS-1a ${exit}: Personen-Snapshot enthält letzte Eingabe`);
        } finally { clearTimeout(state.debounceTimer); }
    }

    // HS-1b: Ungesicherte Eingabe statt gelöschter Timer-ID, auch nach Timerablauf.
    for (const timerExpired of [false, true]) {
        const doc = new MockDocument();
        installBrowserGlobals(doc, createLocalStorageMock());
        const state = { debounceTimer: null }, field = doc.register(new MockElement('hs1bInput', 'input'));
        let valid = false, decisions = 0;
        const save = () => ({ ok: valid, ...(valid ? { overviewPersistence: Promise.resolve(true) } : { error: new Error('Ungültiger Betrag') }) });
        initUIBinder(createDomRefs(doc), state, save, () => { state.debounceTimer = setTimeout(() => {}, 10000); });
        installProfilePersistenceHooks({ doc, win: window, saver: () => true, flusher: () => true });
        UIBinder.handleFormInput({ target: field });
        if (timerExpired) {
            clearTimeout(state.debounceTimer); state.debounceTimer = null;
            trackBalanceInputSave(state, save());
        }
        const guard = getPageNavigationGuard(doc, window);
        assertEqual(await guard.prepare({ decide: () => { decisions++; return false; } }), null, 'HS-1b Bleiben erhält den ungültigen Entwurf');
        assertEqual(decisions, 1, 'HS-1b Ungültige Eingabe fragt vor dem Verlassen');
        assertEqual(state.debounceTimer, null, 'HS-1b keine tote Timer-ID nach fehlgeschlagener Speicherung');
        assert(state.unsavedInput, 'HS-1b eigener Merker erhält den ungesicherten Zustand');
        const accepted = await guard.prepare({ decide: () => true });
        assert(accepted?.discardedSave, 'HS-1b Trotzdem überwindet denselben fehlgeschlagenen Save');
        guard.end(accepted);
        valid = true;
        UIBinder.handleFormInput({ target: field });
        assertEqual(state.unsavedInput, null, 'HS-1b neue Eingabe setzt den Fehlermerker zurück');
        const saved = await guard.prepare({ decide: () => { decisions++; return false; } });
        assert(saved && !state.unsavedInput, 'HS-1b gültige Folgespeicherung braucht keine Rückfrage');
        assertEqual(decisions, 1, 'HS-1b kein alter Verlustgrund nach erfolgreicher Speicherung');
        guard.end(saved);
    }

    // Derselbe Binder ohne alte Drawer- oder optionale Controlhosts.
    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        const dom = createDomRefs(documentRef);
        const actionDialog = documentRef.register(new MockElement('actionDetailsDialog', 'dialog'));
        actionDialog.open = false;
        actionDialog.showModal = () => { actionDialog.open = true; };
        actionDialog.close = () => { actionDialog.open = false; (actionDialog.listeners.close || []).forEach(handler => handler()); };
        actionDialog.getBoundingClientRect = () => ({ left: 20, right: 100, top: 20, bottom: 100 });
        const popupControls = Object.fromEntries(['openActionDetails', 'closeActionDetails', 'printAction'].map(id => [id, documentRef.register(new MockElement(id, 'button'))]));
        let printed = 0; window.print = () => { printed++; };
        const info = new MockElement('info-host');
        const infoButton = new MockElement('info-button', 'button'); info.appendChild(infoButton);
        info.querySelector = () => infoButton;
        info.contains = node => node === info || node === infoButton;
        const queryAll = documentRef.querySelectorAll.bind(documentRef);
        const infoList = [info];
        documentRef.querySelectorAll = selector => selector === '.ds-info' ? infoList : queryAll(selector);
        delete dom.controls;
        dom.containers.tabButtons.children = [];
        const buttons = ['overview', 'strategy', 'history', 'diagnosis'].map(tab => {
            const button = new MockElement(tab + '-button', 'button');
            button.classList.add('tab-btn'); button.dataset.tab = tab;
            dom.containers.tabButtons.appendChild(button); return button;
        });
        dom.containers.tabPanels = buttons.map(button => documentRef.register(new MockElement('tab-' + button.dataset.tab)));
        let updates = 0;
        initUIBinder(dom, {}, () => { updates++; }, () => { updates++; });
        UIBinder.bindUI(); UIBinder.bindUI();
        assertEqual(dom.containers.tabButtons.listeners.keydown.length, 1, 'Tastatur einmal gebunden ohne Drawer und Controlhost');
        const keydown = dom.containers.tabButtons.listeners.keydown[0];
        for (const [key, from, to] of [['ArrowRight', 0, 1], ['End', 1, 3], ['ArrowRight', 3, 0], ['ArrowLeft', 0, 3], ['Home', 3, 0]]) {
            let prevented = false;
            keydown({ key, target: buttons[from], preventDefault() { prevented = true; } });
            assert(prevented && documentRef.activeElement === buttons[to], key + ': Auswahl übernimmt Fokus');
            assertEqual(buttons.filter(button => button.classList.contains('active')).length, 1, key + ': genau ein Reiter aktiv');
            buttons.forEach((button, index) => {
                assertEqual(button['aria-selected'], String(index === to), key + ': ARIA entspricht Auswahl');
                assertEqual(button.tabindex, index === to ? '0' : '-1', key + ': roving tabindex');
                assertEqual(dom.containers.tabPanels[index].hidden, index !== to, key + ': nur zugeordnetes Panel sichtbar');
            });
        }
        assertEqual(updates, 0, 'Reiterbedienung ohne Berechnungs- oder Speicherauftrag');
        // WT-1: Der Planknopf entsteht mit der Karte neu; der Binder hört deshalb einmal am Dokument auf [data-action-details].
        popupControls.openActionDetails.dataset.actionDetails = 'preview';
        popupControls.openActionDetails.closest = selector => selector === '[data-action-details]' ? popupControls.openActionDetails : null;
        const detailsClicks = (documentRef.listeners.click || []);
        const openDetails = () => detailsClicks.forEach(handler => handler({ target: popupControls.openActionDetails }));
        openDetails(); const openCount = actionDialog.open ? 1 : 0; actionDialog.open = false;
        assertEqual(openCount, 1, 'Detailsauslöser einmal gebunden');
        openDetails();
        assert(actionDialog.open && documentRef.activeElement === popupControls.closeActionDetails, 'Dialog öffnet modal und fokussiert Schließen');
        popupControls.printAction.click();
        assertEqual(printed, 1, 'Popupdruck nutzt denselben vollständigen Plan');
        popupControls.closeActionDetails.click();
        assert(!actionDialog.open && documentRef.activeElement === popupControls.openActionDetails, 'Schließen führt zum Detailsauslöser zurück');
        openDetails();
        assert(actionDialog.open, 'Details lassen sich erneut öffnen');
        actionDialog.listeners.mousedown[0]({ target: actionDialog, clientX: 10, clientY: 10, preventDefault() {} });
        actionDialog.listeners.click[0]({ target: actionDialog, clientX: 10, clientY: 10 });
        assert(!actionDialog.open && documentRef.activeElement === popupControls.openActionDetails, 'Außenklick führt zum Detailsauslöser zurück');
        info.listeners.focusin[0]();
        assertEqual(infoButton.getAttribute('aria-expanded'), 'true', 'Info per Fokus geöffnet');
        infoButton.click();
        info.listeners.mouseleave[0]();
        assertEqual(info.dataset.visible, 'true', 'Klick hält Info nach Hoverende offen');
        let escaped = false;
        info.listeners.keydown[0]({ key: 'Escape', preventDefault() { escaped = true; } });
        assert(escaped && documentRef.activeElement === infoButton && info.dataset.visible === 'false', 'Info-Escape schließt und fokussiert Auslöser');
        info.listeners.mouseenter[0]();
        info.listeners.focusout[0]({ relatedTarget: buttons[0] });
        assertEqual(infoButton.getAttribute('aria-expanded'), 'false', 'Fokuswechsel schließt Info nachvollziehbar');
        // Derselbe Bedienfall nach Diagnose-Folgerendern: alte und neue Hosts.
        const dynamicInfo = new MockElement('dynamic-info');
        const dynamicButton = new MockElement('dynamic-info-button', 'button');
        dynamicInfo.appendChild(dynamicButton);
        dynamicInfo.querySelector = () => dynamicButton;
        dynamicInfo.contains = node => node === dynamicInfo || node === dynamicButton;
        infoList.push(dynamicInfo);
        const documentClicks = documentRef.listeners.click.length;
        bindBalanceInfoPopups(); bindBalanceInfoPopups();
        assertEqual(info.listeners.mouseenter.length, 1, 'Folgerendern bindet alten Infohost nicht doppelt');
        assertEqual(dynamicButton.listeners.click.length, 1, 'Dynamischer Infohost bekommt genau eine Klickbindung');
        assertEqual(documentRef.listeners.click.length, documentClicks, 'Folgerendern bindet Außenklick nicht doppelt');
        dynamicInfo.listeners.mouseenter[0]();
        assertEqual(dynamicButton.getAttribute('aria-expanded'), 'true', 'Dynamische Info per Maus geöffnet');
        dynamicButton.click(); dynamicInfo.listeners.mouseleave[0]();
        assertEqual(dynamicInfo.dataset.visible, 'true', 'Dynamische Info bleibt nach Klick offen');
        dynamicInfo.listeners.keydown[0]({ key: 'Escape', preventDefault() {} });
        assert(documentRef.activeElement === dynamicButton && dynamicInfo.dataset.visible === 'false', 'Dynamische Info schließt per Escape mit Rückfokus');
        dynamicInfo.listeners.focusin[0]();
        for (const handler of documentRef.listeners.click) handler({ target: buttons[0] });
        assertEqual(dynamicButton.getAttribute('aria-expanded'), 'false', 'Außenklick schließt dynamische Info');


    }

    console.log('VS-2: Balance-Binder erfasst nach einem Ausgabenimport keinen Vermögensstand');
    assertEqual(typeof UIBinder.handleExpensesImported, 'undefined', 'Kein Erfassungsanschluss nach Ausgabenimport');

    console.log('Test 1: UIBinder binds controls only once');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();

        let updateCalls = 0;
        let debouncedCalls = 0;
        let saveCalls = 0;
        StorageManager.loadState = () => ({ inputs: {} });
        StorageManager.saveState = () => { saveCalls += 1; };
        StorageManager.resetState = () => {};

        const dom = createDomRefs(documentRef);
        const binderState = { pendingInputMetadata: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' } };
        initUIBinder(dom, binderState, () => { updateCalls += 1; }, () => { debouncedCalls += 1; });

        UIBinder.bindUI();
        UIBinder.bindUI();

        assertEqual((documentRef.listeners.keydown || []).length, 0, 'AK-1: Balance bindet keine Tastenkürzel mehr');
        assertEqual((dom.containers.form.listeners.input || []).length, 1, 'Form-Input listener wird nur einmal gebunden');
        assertEqual((dom.controls.btnJahresUpdate.listeners.click || []).length, 0, 'Entfernter Jahresupdateknopf hat keinen Listener');

        // Bestehender Bindungsfall benutzt nun den echten Renderer-/Clipboardpfad.
        const actionHost = documentRef.register(new MockElement('handlungsanweisung'));
        const detailOutputs = { handlungsanweisung: actionHost };
        for (const id of ['actionDetailsTitle', 'actionDetailsAmount', 'actionDetailsAmountLabel', 'actionDetailsNote', 'actionManagerLink', 'actionPurposeContent', 'printFooter', 'balancePlanningYear']) detailOutputs[id] = documentRef.register(new MockElement(id));
        detailOutputs.balancePlanningYear.textContent = '2027';
        detailOutputs.printFooter.dataset.versions = 'UI: Test | Engine: Test';
        initUIRenderer({ outputs: detailOutputs }, { loadState: () => ({}) });
        const action = { type: 'TRANSACTION', title: 'Vollständiger Kopierplan',
            quellen: [{ kind: 'aktien_alt', name: '<Lange Tranche>', trancheId: 'synthetisch-1', brutto: 1250.75, netto: 1200.50, steuer: 50.25 }],
            verwendungen: { liquiditaet: 1200.50 }, nettoErlös: 1200.50, steuer: 50.25 };
        const rawAction = JSON.stringify(action);
        const copied = [], savedClipboard = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async text => { copied.push(text); };
        const clickCopy = dom.controls.copyAction.listeners.click[0];
        try {
            assertEqual(dom.controls.copyAction.listeners.click.length, 1, 'Kopierknopf bleibt genau einmal gebunden');
            for (const amount of [1200.50, 1100.25]) {
                UIRenderer.render({ action: { ...action, verwendungen: { liquiditaet: amount } }, input: {} });
                documentRef.getElementById('handlungContent').innerText = 'gerundeter DOMtext 1.251 €';
                await clickCopy();
                assert(copied.at(-1).includes('1.250,75') && copied.at(-1).includes(amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })), 'Gebundener Clipboardhandler kopiert die aktuelle centgenaue Projektion');
                assert(!copied.at(-1).includes('gerundeter DOMtext'), 'Clipboard liest keinen gerundeten DOMtext');
                assertEqual(detailOutputs.actionDetailsTitle.textContent, 'Vorläufige Vorschau · Jahresabschluss 2025 · Liquidität auffüllen', 'Dialogtitel nennt die Herkunft, die anstehende Abschlussperiode und Zweck');
                assertEqual(detailOutputs.actionManagerLink.textContent, 'Verkauf erfassen →', 'Verkaufsplan benennt den einzelnen Vermögenszugang');
            }
            const copiesBefore = copied.length;
            for (const ui of [null, {}, { action: [] }, { action: null }]) { UIRenderer.render(ui); await clickCopy(); }
            assertEqual(copied.length, copiesBefore, 'Fehlende oder ungültige Folgeaktion kopiert keinen alten Plan');
            assertEqual(JSON.stringify(action), rawAction, 'Clipboardprojektion mutiert keine Aktionsdaten');
            assertEqual(updateCalls + debouncedCalls + saveCalls, 0, 'Kopie startet weder Berechnung noch Finanzpersistenz');
        } finally { navigator.clipboard.writeText = savedClipboard; }

        dom.containers.form.listeners.input[0]({ target: { id: 'floorBedarf' } });
        assertEqual(debouncedCalls, 1, 'Ein Input-Event loest genau einen debounced Update aus');
        assertEqual(updateCalls, 0, 'Input-Event loest keinen direkten Update-Pfad aus');

        dom.containers.form.listeners.input[0]({ target: { id: 'depotwertAlt' } });
        assertEqual(saveCalls, 0, 'Depot-Input schreibt keinen State ausserhalb der Update-Pipeline');
        assert(Number.isFinite(binderState.pendingInputMetadata.depotLastUpdate),
            'Depot-Zeitstempel wird bis zum expliziten persist_inputs-Lauf vorgemerkt');

        const debounceCallsBeforeFileChange = debouncedCalls;
        const metadataBefore = JSON.stringify(binderState.pendingInputMetadata);
        for (const id of ['csvFileInput', 'expensesCsvInput', 'depotwertDatei']) {
            for (const type of ['input', 'change']) {
                dom.containers.form.listeners[type][0]({ target: { id, type: 'file' } });
            }
        }
        assertEqual(debouncedCalls, debounceCallsBeforeFileChange, 'Alle Dateievents planen null Updates');
        assertEqual(updateCalls, 0, 'Alle Dateievents lösen null direkte Updates aus');
        assertEqual(JSON.stringify(binderState.pendingInputMetadata), metadataBefore,
            'Dateievents verändern keine vorgemerkten Metadaten, auch bei Depot-ID');
        dom.containers.form.listeners.input[0]({ target: { id: 'goldWert' } });
        assert(Number.isFinite(binderState.pendingInputMetadata.depotLastUpdate), 'Gold behält seinen Zeitstempel');
        assertEqual(debouncedCalls, debounceCallsBeforeFileChange + 1, 'Gold plant weiterhin sein Update');


    }


    console.log('Test 2: Profilverbund init preserves membership and excludes opted-out profiles');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        let migratedMainStateLoads = 0;
        StorageManager.loadState = () => {
            migratedMainStateLoads += 1;
            return prevLoadState.call(StorageManager);
        };
        StorageManager.saveState = state => prevSaveState.call(StorageManager, state);

        const includedState = {
            inputs: {
                tagesgeld: 10000,
                depotwertAlt: 90000,
                costBasisAlt: 80000,
                renteAktiv: false,
                renteMonatlich: 0
            },
            lastState: {
                guardrailMarker: 'included-keep',
                cumulativeInflationFactor: 2.99,
                taxState: { lossCarry: 111 }
            },
            profilverbundHouseholdLastState: { householdGuardrail: 'household-keep' },
            annualPeriodMetadata: {
                schemaVersion: 1,
                lastCommittedPeriod: 'calendar-year:2024',
                pendingCommit: null
            },
            balanceStateLifecycle: { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2024' },
            ageAdjustedForInflation: 66
        };
        const partnerState = {
            inputs: {
                tagesgeld: 20000,
                depotwertAlt: 180000,
                costBasisAlt: 160000,
                renteAktiv: false,
                renteMonatlich: 0
            },
            lastState: { guardrailMarker: 'partner-keep', taxState: { lossCarry: 222 } }
        };
        const createdAt = '2026-01-01T00:00:00.000Z';
        localStorageRef.setItem('rs_profiles_v1', JSON.stringify({
            version: 1,
            profiles: {
                included: {
                    meta: { id: 'included', name: 'Im Haushalt', createdAt, updatedAt: createdAt, belongsToHousehold: true },
                    data: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' }
                },
                partner: {
                    meta: { id: 'partner', name: 'Partner', createdAt, updatedAt: createdAt, belongsToHousehold: true },
                    data: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' }
                }
            }
        }));
        localStorageRef.setItem('rs_current_profile', 'included');

        const modeSelect = documentRef.register(new MockElement('profilverbund-withdrawal-mode', 'select'));
        const profileList = documentRef.register(new MockElement('profilverbund-profile-list'));

        // Der verlustfreie Saver erhält die gültigen Personendaten. Deshalb
        // erreicht bereits die Initialisierung den echten Formularleser.
        const dom = createDomRefs(documentRef);
        for (const [id, value] of Object.entries({ floorBedarf: '1200', flexBedarf: '0', minimumFlexAnnual: '0' })) {
            dom.inputs[id] = documentRef.register(new MockElement(id, 'input'));
            dom.inputs[id].value = value;
        }
        initUIReader(dom);
        const handlers = createProfilverbundHandlers({
            dom,
            PROFILVERBUND_STORAGE_KEYS: { mode: 'profilverbund_mode_test' }
        });

        handlers.initProfilverbundBalance();
        handlers.initProfilverbundBalance();

        assertEqual((modeSelect.listeners.change || []).length, 1, 'Profilverbund-Modus wird nur einmal gebunden');
        assertEqual((profileList.listeners.change || []).length, 0, 'Balance bindet keine Mitgliedschaftsänderung');

        const registryAfterReload = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        assertEqual(registryAfterReload.profiles.included.data.profile_person_schema_version, '1',
            'Initialisierung erhält das Personenschema trotz fehlender Live-Personenschlüssel');
        assertEqual(registryAfterReload.profiles.included.data.profile_aktuelles_alter, '67',
            'Initialisierung erhält das Profilalter trotz fehlender Live-Personenschlüssel');
        assertEqual(UIReader.readAllInputs().floorBedarf, 1200,
            'Initialisierung verwendet einen echten Leser mit gültigem Formularbedarf');
        for (const profile of Object.values(registryAfterReload.profiles)) Object.assign(profile.data, { profile_person_schema_version: '1', profile_aktuelles_alter: '67', profile_rente_monatlich: '0' });
        assertEqual(profileList.children.length, 0, 'Balance rendert keine Haushaltscheckboxen');

        registryAfterReload.profiles.included.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(includedState);
        registryAfterReload.profiles.partner.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(partnerState);
        localStorageRef.setItem('rs_profiles_v1', JSON.stringify(registryAfterReload));
        localStorageRef.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            ...includedState,
            annualPeriodMetadata: {
                lastCommittedPeriod: null,
                pendingCommit: {
                    periodId: 'calendar-year:2025',
                    snapshotId: 'snapshot-multi',
                    phase: 'writes_started'
                }
            },
            ageAdjustedForInflation: 67
        }));

        const selectedProfiles = loadProfilverbundProfiles();
        assertEqual(selectedProfiles.length, 2, 'Beide Haushaltsprofile werden fuer den Profilverbund geladen');
        assertEqual(selectedProfiles[0].profileId, 'included', 'Erstes Haushaltsprofil steht vorn');
        assertEqual(selectedProfiles[1].profileId, 'partner', 'Zweites Haushaltsprofil bleibt im Profilverbund');

        const aggregateInput = {
            floorBedarf: 1200,
            flexBedarf: 0,
            flexBudgetAnnual: 0,
            flexBudgetYears: 0,
            flexBudgetRecharge: 0,
            depotLastUpdate: 123456
        };
        handlers.updateProfilverbundGlobals(selectedProfiles, aggregateInput);
        assertEqual(aggregateInput.tagesgeld, 30000, 'Haushaltsaggregat summiert das Vermoegen beider Profile');
        assertEqual(aggregateInput.renteMonatlich, 0, 'Haushaltsaggregat summiert das Einkommen beider Profile');

        const engineCalls = [];
        window.EngineAPI = {
            simulateSingleYear(input) {
                engineCalls.push({ ...input });
                return {
                    newState: { call: engineCalls.length },
                    diagnosis: {},
                    ui: {
                        spending: { monatlicheEntnahme: 100 },
                        action: {
                            type: 'NONE',
                            nettoErlös: 0,
                            steuer: 0,
                            verwendungen: {},
                            quellen: []
                        }
                    }
                };
            }
        };
        const runs = handlers.runProfilverbundProfileSimulations(aggregateInput, selectedProfiles);
        const mergedAction = handlers.mergeProfilverbundActions(runs);

        assertEqual(engineCalls.length, 1, 'Engine laeuft im Profilverbund ausschliesslich fuer den Haushalt');
        assertEqual(runs.length, 2, 'Je Haushaltsprofil genau ein Profil-Run');
        assertEqual(mergedAction.quellen.length, 0, 'Haushalt ohne Handlungsbedarf erhaelt keine erfundene Profilquelle');
        assertEqual(engineCalls[0].detailledTranches.length, 2, 'Haushaltslauf erhaelt synthetische Tranchen der zwei ausgewaehlten Profile');
        assert(engineCalls[0].detailledTranches.some(tranche => tranche.sourceProfileId === 'included'),
            'Erstes ausgewaehltes Profil besitzt eindeutige Quellenprovenienz');
        assert(engineCalls[0].detailledTranches.some(tranche => tranche.sourceProfileId === 'partner'),
            'Zweites ausgewaehltes Profil besitzt eindeutige Quellenprovenienz');

        runs[0].persistedInput = { ...runs[0].persistedInput, floorBedarf: 1300 };
        handlers.persistProfilverbundInputs(runs);
        const registryAfterInputPersistence = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        const includedAfterInputPersistence = JSON.parse(
            registryAfterInputPersistence.profiles.included.data[CONFIG.STORAGE.LS_KEY]
        );
        const partnerAfterInputPersistence = JSON.parse(
            registryAfterInputPersistence.profiles.partner.data[CONFIG.STORAGE.LS_KEY]
        );
        assertEqual(includedAfterInputPersistence.inputs.floorBedarf, 1300,
            'Input-only Persistenz speichert geaenderte Profileingaben');
        assertEqual(includedAfterInputPersistence.lastState.guardrailMarker, 'included-keep',
            'Input-only Persistenz erhaelt den ersten Profil-Guardrail-State');
        assertClose(includedAfterInputPersistence.lastState.taxState.lossCarry, 111, 0.001,
            'Input-only Persistenz erhaelt den ersten Verlustvortrag');
        assertClose(partnerAfterInputPersistence.lastState.taxState.lossCarry, 222, 0.001,
            'Input-only Persistenz erhaelt den zweiten Verlustvortrag');
        assertEqual(
            includedAfterInputPersistence.profilverbundHouseholdLastState.householdGuardrail,
            'household-keep',
            'Input-only Persistenz erhaelt den Household-Guardrail-State'
        );
        assertEqual(includedAfterInputPersistence.annualPeriodMetadata, undefined,
            'Profil-State uebernimmt keine haushaltsweite Pending-Periode');
        assertEqual(includedAfterInputPersistence.ageAdjustedForInflation, undefined,
            'Profil-State uebernimmt keine ausschliesslich im Haupt-State gefuehrte Inflationsmetadaten');
        assertEqual(includedAfterInputPersistence.inputs.depotLastUpdate, 123456,
            'Profilverbund persistiert den vorgemerkten Depot-Zeitstempel im aktiven Profil');
        const mainAfterInputPersistence = JSON.parse(localStorageRef.getItem(CONFIG.STORAGE.LS_KEY));
        assertEqual(
            mainAfterInputPersistence.annualPeriodMetadata.pendingCommit.phase,
            'writes_started',
            'Input-only Profilverbund-Write loescht die Pending-Periode nicht aus dem Haupt-State'
        );
        assertEqual(mainAfterInputPersistence.ageAdjustedForInflation, 67,
            'Input-only Profilverbund-Write erhaelt die Inflationsmetadaten im Haupt-State');
        assertEqual(mainAfterInputPersistence.inputs.depotLastUpdate, 123456,
            'Profilverbund persistiert den Depot-Zeitstempel auch im Haupt-State');
        assertEqual(mainAfterInputPersistence.lastState.cumulativeInflationFactor, 2.99,
            'Input-only Write erhaelt einen plausiblen kumulierten Inflationsfaktor bytegetreu');
        assert(migratedMainStateLoads > 0,
            'Aktiver Profilverbund-Write liest seine Merge-Basis ueber den migrierenden StorageManager');

        handlers.persistProfilverbundProfileStates(runs, {
            lifecycle: { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025' }
        });
        const registryAfterPersistence = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        const includedPersisted = JSON.parse(registryAfterPersistence.profiles.included.data[CONFIG.STORAGE.LS_KEY]);
        const partnerPersisted = JSON.parse(registryAfterPersistence.profiles.partner.data[CONFIG.STORAGE.LS_KEY]);
        assertEqual(includedPersisted.lastState.guardrailMarker, 'included-keep',
            'Persistenz erhaelt Profil-Guardrails statt eines technischen Profil-Engine-State');
        assertClose(includedPersisted.lastState.taxState.lossCarry, 111, 0.001,
            'Persistenz schreibt den attribuierten No-Sale-Steuerzustand des ersten Profils');
        assertClose(partnerPersisted.lastState.taxState.lossCarry, 222, 0.001,
            'Persistenz schreibt den attribuierten No-Sale-Steuerzustand des zweiten Profils');
        assertEqual(includedPersisted.profilverbundHouseholdLastState.call, 1,
            'Gemeinsamer Haushalts-Guardrail-State bleibt separat erhalten');
        assertClose(includedPersisted.profilverbundHouseholdLastState.taxState.lossCarry, 0, 0.001,
            'Nicht autoritativer Haushalts-Steuerzustand wird vor der Persistenz neutralisiert');
        assertEqual(includedPersisted.balanceStateLifecycle, undefined,
            'Profil-State uebernimmt keinen haushaltsweiten Lifecycle');
        assertEqual(includedPersisted.annualPeriodMetadata, undefined,
            'Profilverbund-Commit haelt Perioden-Metadaten aus den Profildaten heraus');
        const mainAfterCommit = JSON.parse(localStorageRef.getItem(CONFIG.STORAGE.LS_KEY));
        assertEqual(
            mainAfterCommit.annualPeriodMetadata.pendingCommit.periodId,
            'calendar-year:2025',
            'Realer Profilverbund-Commit erhaelt die Perioden-Metadaten im Haupt-State'
        );
        assertEqual(mainAfterCommit.balanceStateLifecycle.lastCommittedPeriod, 'calendar-year:2025',
            'Profilverbund-Commit speichert die gemeinsame Perioden-ID nur im Haupt-State');

        localStorageRef.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            ...mainAfterCommit,
            annualPeriodMetadata: {
                schemaVersion: 1,
                lastCommittedPeriod: 'calendar-year:2025',
                pendingCommit: null
            }
        }));
        const profileStatesAfterCommit = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        runs.forEach(run => {
            run.balanceState = JSON.parse(
                profileStatesAfterCommit.profiles[run.profileId].data[CONFIG.STORAGE.LS_KEY]
            );
        });
        handlers.persistProfilverbundInputs(runs);
        const mainAfterFollowingInput = JSON.parse(localStorageRef.getItem(CONFIG.STORAGE.LS_KEY));
        assertEqual(
            mainAfterFollowingInput.annualPeriodMetadata.lastCommittedPeriod,
            'calendar-year:2025',
            'Spaeterer Input-Write kann ein abgeschlossenes Haushaltsjahr nicht zuruecksetzen'
        );
        assertEqual(mainAfterFollowingInput.annualPeriodMetadata.pendingCommit, null,
            'Spaeterer Input-Write kann keinen Phantom-Pending-Commit wiederbeleben');
        const registryAfterFollowingInput = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        const includedAfterFollowingInput = JSON.parse(
            registryAfterFollowingInput.profiles.included.data[CONFIG.STORAGE.LS_KEY]
        );
        assertEqual(includedAfterFollowingInput.annualPeriodMetadata, undefined,
            'Auch der zweite reale Write haelt Haushaltsmetadaten aus dem Profil-State heraus');
    }

    // Geprüft bleibt die sichtbare Provenienz eines gespeicherten Markt-CSV-Imports.
    console.log('Test 3: gespeicherte Markt-CSV-Provenienz sichtbar');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        const dom = createDomRefs(documentRef);
        initUIReader(dom);
        // Der erhaltene Parservertrag verwendet einen DOM-freien Plan,
        // ohne die entfallene Markt-CSV-Bedienung nachzubilden.
        const csvTargetYear = new Date().getFullYear() - 1;
        const csvExpectedAsOf = `${csvTargetYear}-12-30`;
        const csvSourceFileName = `markt-${csvTargetYear}.csv`;
        const csvPlan = {
            engineValues: { endeVJ: 130, endeVJ_1: 110, endeVJ_2: 95, endeVJ_3: 80, ath: 0, jahreSeitAth: 0 },
            provenance: {
                schemaVersion: 1, acquisitionMode: 'manual_csv', periodMode: 'current',
                periodId: `calendar-year:${csvTargetYear}`, targetYear: csvTargetYear, price: 130,
                asOf: csvExpectedAsOf, ticker: 'VWCE.DE', instrument: 'VWCE.DE',
                source: `Manuelle CSV: ${csvSourceFileName}`, sourceType: 'manual_csv',
                sourceFileName: csvSourceFileName, importedAt: `${csvTargetYear + 1}-01-02T10:00:00.000Z`,
                coverage: { start: `${csvTargetYear - 3}-12-30`, end: csvExpectedAsOf,
                    calendarYears: [csvTargetYear - 3, csvTargetYear - 2, csvTargetYear - 1, csvTargetYear], rowCount: 4 },
                highScope: 'windowHigh',
                high: { scope: 'windowHigh', value: 130, asOf: csvExpectedAsOf, yearsSince: 0, verifiedAllTimeHighAvailable: false },
                engineReference: { policy: 'window_high_as_conservative_ath_lower_bound', sourceScope: 'windowHigh', applied: false, value: null, yearsSince: null },
                ath: { value: null, yearsSince: null, evaluatedAsOf: csvExpectedAsOf, lastHighAsOf: null, scope: 'unavailable_manual_window', engineAvailable: false }
            }
        };
        const csvStoredState = { inputs: { aktuellesAlter: 67, floorBedarf: 24000, flexBedarf: 12000, ...csvPlan.engineValues },
            [ANNUAL_MARKET_DATA_META_KEY]: csvPlan.provenance };
        UIReader.renderMarketDataProvenance(csvPlan.provenance);
        assertEqual(csvStoredState.inputs.ath, 0,
            'Ein Fensterhoch am letzten Kurs wird nicht als Allzeithoch gespeichert');
        assertEqual(csvStoredState.inputs.jahreSeitAth, 0,
            'Ohne gerichteten Fensterabstand bleibt die ATH-Referenz neutral');
        assertEqual(csvStoredState[ANNUAL_MARKET_DATA_META_KEY].sourceFileName, csvSourceFileName,
            'CSV-Dateiname bleibt als persistierte Quellenangabe erhalten');
        assertEqual(csvStoredState[ANNUAL_MARKET_DATA_META_KEY].periodId, `calendar-year:${csvTargetYear}`,
            'CSV-Provenienz bleibt an die explizite Zielperiode gebunden');
        assertEqual(csvStoredState[ANNUAL_MARKET_DATA_META_KEY].highScope, 'windowHigh',
            'CSV-Provenienz kennzeichnet das lokale Fensterhoch');
        assertEqual(
            csvStoredState[ANNUAL_MARKET_DATA_META_KEY].engineReference.policy,
            'window_high_as_conservative_ath_lower_bound',
            'CSV-Provenienz trennt die Engine-Untergrenze maschinenlesbar von einem echten ATH'
        );
        assertEqual(
            csvStoredState[ANNUAL_MARKET_DATA_META_KEY].engineReference.applied,
            false,
            'Die steigende CSV dokumentiert, dass ihre Untergrenze nicht als Engine-ATH angewendet wurde'
        );
        assertEqual(dom.outputs.marketDataProvenance.dataset.asOf, csvExpectedAsOf,
            'Erfolgreiche CSV rendert die persistierte Provenienz sichtbar');
        assertEqual(
            dom.outputs.marketDataProvenance.dataset.enginePolicy,
            'window_high_as_conservative_ath_lower_bound',
            'Die sichtbare Provenienz exponiert die konservative Engine-Policy maschinenlesbar'
        );
        assertEqual(
            dom.outputs.marketDataProvenance.dataset.engineReferenceApplied,
            'false',
            'Die sichtbare Provenienz zeigt die nicht angewendete Engine-Referenz maschinenlesbar'
        );
    }

    console.log('Test 4: Balance startup renders persistence migration warnings with backend and recovery guidance');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();

        const { renderPersistenceStartupWarning } = await import('../app/balance/balance-main.js');
        const warningTarget = new MockElement('persistenceWarning');
        const shown = renderPersistenceStartupWarning({
            backend: 'Tauri JSON Test',
            migrationWarning: {
                code: 'tauri-state-corrupt',
                message: 'Gespeicherter Zustand konnte nicht sicher geladen werden.',
                quarantinePath: 'quarantine-reference'
            }
        }, warningTarget);

        assertEqual(shown, true, 'MigrationWarning wird als sichtbarer Startup-Status behandelt');
        assertEqual(warningTarget.style.display, 'block', 'Startup-Warnung wird sichtbar geschaltet');
        assertEqual(warningTarget.dataset.kind, 'persistence-warning', 'Startup-Warnung ist maschinenlesbar typisiert');
        assert(warningTarget.textContent.includes('Gesamtspeicher'), 'Startup-Warnung nennt den betroffenen Datenbereich');
        assert(warningTarget.textContent.includes('Tauri JSON Test'), 'Startup-Warnung nennt das aktive Backend');
        assert(warningTarget.textContent.includes('quarantiniert'), 'Startup-Warnung verweist auf die vorhandene Adapterquarantaene');
        assert(warningTarget.textContent.includes('Recovery- oder Reset-Entscheidung'), 'Startup-Warnung nennt den sicheren Nutzerentscheid');
        assertEqual(warningTarget.textContent.includes('quarantine-reference'), false, 'Startup-Warnung leakt keinen lokalen Quarantaenepfad');
        assertEqual(
            renderPersistenceStartupWarning({ backend: 'IndexedDB', migrationWarning: null }, new MockElement()),
            false,
            'Ohne MigrationWarning wird kein falscher Warnzustand erzeugt'
        );
    }

    console.log('Test 5: Profilverbund globals are set and cleared without stale data');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        localStorageRef.setItem('profilverbund_mode_test', 'tax_optimized');

        const handlers = createProfilverbundHandlers({
            dom: { inputs: {} },
            PROFILVERBUND_STORAGE_KEYS: { mode: 'profilverbund_mode_test' }
        });
        const inputData = {
            floorBedarf: 40000,
            flexBedarf: 10000,
            flexBudgetAnnual: 0,
            flexBudgetYears: 0,
            flexBudgetRecharge: 0
        };
        const profiles = [{
            profileId: 'a',
            name: 'A',
            inputs: {
                tagesgeld: 50000,
                geldmarktEtf: 10000,
                depotwertAlt: 120000,
                depotwertNeu: 80000,
                costBasisAlt: 100000,
                costBasisNeu: 70000,
                goldWert: 30000,
                goldCost: 25000,
                renteAktiv: true,
                renteMonatlich: 1000
            },
            tranches: []
        }];

        handlers.updateProfilverbundGlobals(profiles, inputData);

        assertEqual(inputData.tagesgeld, 50000, 'Profilverbund schreibt aggregiertes Tagesgeld in Inputdaten');
        assertEqual(inputData.renteAktiv, true, 'Profilverbund aktiviert Rente bei positiver Profilrente');
        assert(window.__profilverbundDistribution?.items?.length === 1, 'Profilverbund-Verteilung wird gesetzt');
        assert(window.__profilverbundProfileSummaries?.length === 1, 'Profilverbund-Profilzusammenfassung wird gesetzt');

        const goldProfiles = [
            {
                profileId: 'gold',
                name: 'Gold',
                inputs: {
                    depotwertAlt: 100000,
                    depotwertNeu: 0,
                    goldWert: 0,
                    tagesgeld: 0,
                    geldmarktEtf: 0,
                    goldAktiv: true,
                    goldZielProzent: 8,
                    goldFloorProzent: 1,
                    rebalancingBand: 20,
                    goldSteuerfrei: true
                },
                tranches: []
            },
            {
                profileId: 'plain',
                name: 'Ohne Gold',
                inputs: {
                    depotwertAlt: 900000,
                    depotwertNeu: 0,
                    goldWert: 0,
                    tagesgeld: 0,
                    geldmarktEtf: 0,
                    goldAktiv: false,
                    goldZielProzent: 0,
                    goldFloorProzent: 0,
                    rebalancingBand: 50,
                    goldSteuerfrei: false
                },
                tranches: []
            }
        ];
        const goldInput = {
            floorBedarf: 0,
            flexBedarf: 0,
            flexBudgetAnnual: 0,
            flexBudgetYears: 0,
            flexBudgetRecharge: 0,
            goldZielProzent: 99
        };
        handlers.updateProfilverbundGlobals(goldProfiles, goldInput);
        assertEqual(goldInput.goldZielBetrag, 8000,
            'Balance globals should use the selected profiles absolute gold target');
        assertClose(goldInput.goldZielProzent, 0.8, 0.0000001,
            'Balance globals should replace the active DOM profile quote with the household quote');
        assertEqual(goldInput.goldStrategyDiagnostics.length, 2,
            'Balance globals should expose one gold diagnostic per selected profile');

        handlers.updateProfilverbundGlobals([], inputData);

        assertEqual(window.__profilverbundDistribution, null, 'Leerer Profilverbund loescht alte Distribution');
        assertEqual(window.__profilverbundProfileSummaries, null, 'Leerer Profilverbund loescht alte Profilzusammenfassung');
    }

    console.log('Test 6: Profilverbund decides household spending once and finances only allocated shares');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        localStorageRef.setItem('profilverbund_mode_test', 'proportional');

        const engineCalls = [];
        window.EngineAPI = {
            simulateSingleYear(input, lastState) {
                engineCalls.push({ input: { ...input }, lastState });
                const isHouseholdCall = engineCalls.length === 1;
                return {
                    newState: { call: engineCalls.length },
                    diagnosis: {},
                    ui: {
                        spending: { monatlicheEntnahme: isHouseholdCall ? 3000 : (input.floorBedarf / 12) },
                        action: { type: 'NONE', verwendungen: {}, quellen: [] }
                    }
                };
            }
        };

        const handlers = createProfilverbundHandlers({
            dom: { inputs: {} },
            PROFILVERBUND_STORAGE_KEYS: { mode: 'profilverbund_mode_test' }
        });
        const sharedInput = {
            floorBedarf: 40000,
            flexBedarf: 10000,
            renteAktiv: true,
            renteMonatlich: 1500,
            dynamicFlex: true,
            minimumFlexAnnual: 5000
        };
        const profiles = [
            {
                profileId: 'a',
                name: 'A',
                inputs: { depotwertAlt: 300000, renteAktiv: true, renteMonatlich: 1000 },
                tranches: [],
                balanceState: { inputs: {}, lastState: { taxState: { lossCarry: 100 } } }
            },
            {
                profileId: 'b',
                name: 'B',
                inputs: { depotwertAlt: 100000, renteAktiv: true, renteMonatlich: 500 },
                tranches: [],
                balanceState: { inputs: {}, lastState: { taxState: { lossCarry: 200 } } }
            }
        ];

        const runs = handlers.runProfilverbundProfileSimulations(sharedInput, profiles, { household: true });

        assertEqual(engineCalls.length, 1, 'Engine runs exactly once for the household');
        assertEqual(engineCalls[0].lastState.household, true, 'Household run receives household guardrail state');
        assertEqual(runs.householdResult.ui.spending.monatlicheEntnahme, 3000, 'Household result remains available to the main orchestrator');
        assertClose(runs.distribution.totalNeed, 36000, 0.001, 'Final household spending drives allocation');
        assertClose(runs[0].ui.spending.monatlicheEntnahme, 2250, 0.001, 'Profile A receives only a display attribution of household spending');
        assertClose(runs[1].ui.spending.monatlicheEntnahme, 750, 0.001, 'Profile B receives only a display attribution of household spending');
        assertClose(runs[0].input.floorBedarf, 40000, 0.001, 'Profile persistence is not replaced by an artificial funding floor');
        assertClose(runs[1].input.floorBedarf, 40000, 0.001, 'Second profile persistence is not replaced by an artificial funding floor');
        assertEqual(runs[0].input.dynamicFlex, true, 'No technical profile input disables household Dynamic Flex');
        assertEqual(runs[1].input.minimumFlexAnnual, 5000, 'No technical profile input clears the minimum flex contract');
        assertClose(runs[0].newState.taxState.lossCarry, 100, 0.001, 'Profile without sale preserves its own loss carry');
        assertClose(runs[1].newState.taxState.lossCarry, 200, 0.001, 'Second profile without sale preserves its own loss carry');
        assertEqual(runs[0].persistedInput.renteMonatlich, 1000, 'Original profile income remains in persisted inputs');
        assertEqual(runs[1].persistedInput.renteMonatlich, 500, 'Second profile income remains in persisted inputs');
    }

    console.log('Test 6b: Profilverbund applies bad-year 3-bucket replacement once at household level');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();
        localStorageRef.setItem('profilverbund_mode_test', 'tax_optimized');

        let engineCalls = 0;
        window.EngineAPI = {
            simulateSingleYear(input, lastState) {
                engineCalls += 1;
                assertEqual(input.finalizeThreeBucketAction, true,
                    'Household Engine input requests pre-settlement 3-bucket finalization');
                assertEqual(input.deferTaxSettlement, true,
                    'Household Engine input defers tax until profile attribution');
                assertEqual(input.anleihenWert, 50000, 'Household reports the bond subset of depotwertNeu');
                return EngineAPI.simulateSingleYear(input, lastState);
            }
        };
        const handlers = createProfilverbundHandlers({
            dom: { inputs: {} },
            PROFILVERBUND_STORAGE_KEYS: { mode: 'profilverbund_mode_test' }
        });
        const profiles = [
            {
                profileId: 'bond-owner',
                name: 'Bond Owner',
                inputs: { depotwertNeu: 50000, tagesgeld: 0, renteAktiv: false, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 },
                tranches: [{ trancheId: 'bond-1', schemaVersion: 2, type: 'anleihe', category: 'bonds', marketValue: 50000, costBasis: 50000, tqf: 0, taxExempt: false }],
                balanceState: { lastState: { taxState: { lossCarry: 0 } } }
            },
            {
                profileId: 'equity-owner',
                name: 'Equity Owner',
                inputs: { depotwertNeu: 100000, tagesgeld: 0, renteAktiv: false, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 },
                tranches: [{ trancheId: 'equity-1', schemaVersion: 2, type: 'aktien_neu', category: 'equity', marketValue: 100000, costBasis: 90000, tqf: 0.3, taxExempt: false }],
                balanceState: { lastState: { taxState: { lossCarry: 0 } } }
            }
        ];
        const runs = handlers.runProfilverbundProfileSimulations({
            floorBedarf: 12000,
            flexBedarf: 0,
            depotwertAlt: 0,
            depotwertNeu: 150000,
            aktuellesAlter: 65,
            inflation: 2,
            tagesgeld: 0,
            geldmarktEtf: 0,
            goldAktiv: false,
            goldWert: 0,
            goldFloorProzent: 0,
            goldZielProzent: 0,
            liquidityRunwayYears: 3,
            risikoprofil: 'sicherheits-dynamisch',
            endeVJ: 70,
            endeVJ_1: 100,
            endeVJ_2: 100,
            endeVJ_3: 100,
            ath: 100,
            jahreSeitAth: 1,
            decumulation: { mode: '3_bucket_jilge', drawdownTrigger: -0.15, bondTargetFactor: 5 },
            sparerPauschbetrag: 1000,
            kirchensteuerSatz: 0
        }, profiles);

        assertEqual(engineCalls, 1, '3-bucket Profilverbund performs no profile-engine reruns');
        assertEqual(runs.threeBucketDiagnosis.isBadYear, true, 'Household diagnosis records the bad-year replacement');
        assertEqual(runs.finalAction.quellen.length, 1, 'Household replacement produces one final source');
        assertEqual(runs.finalAction.quellen[0].sourceProfileId, 'bond-owner', 'Bond sale keeps exact profile ownership');
        assertEqual(runs.finalAction.quellen[0].kind, 'anleihe', 'Final action replaces the equity sale with a bond sale');
        assertEqual(runs.finalAction.quellen.some(source => source.kind === 'aktien_neu'), false,
            'No second profile action reintroduces the blocked equity sale');
    }

    console.log('Test 7: Engine handshake and update result contracts fail closed');
    {
        const compatibleEngine = {
            getVersion: () => ({ api: '31.7', build: 'test-build' }),
            simulateSingleYear: () => ({ newState: {}, ui: {}, diagnosis: {} })
        };
        const handshake = createEngineHandshake(compatibleEngine, '31.');
        assertEqual(handshake.version.api, '31.7', 'Kompatible Engine-Major-Version besteht den Handshake');
        assertEqual(assertActiveEngineHandshake(handshake, compatibleEngine), compatibleEngine,
            'Aktiver Handshake liefert exakt die gebundene Engine zurueck');

        const captureGateError = callback => {
            try {
                callback();
                return null;
            } catch (error) {
                return error;
            }
        };
        const missingEngine = captureGateError(() => createEngineHandshake(undefined, '31.'));
        assertEqual(missingEngine?.reason, 'missing_engine', 'Fehlende Engine wird fail-closed abgewiesen');

        const incompleteEngine = captureGateError(() => createEngineHandshake({
            getVersion: () => ({ api: '31.7' }),
            simulateSingleYear: () => ({})
        }, '31.'));
        assertEqual(incompleteEngine?.reason, 'invalid_version', 'Unvollstaendige Versionsantwort wird abgewiesen');

        const incompatibleEngine = captureGateError(() => createEngineHandshake({
            getVersion: () => ({ api: '30.9', build: 'old-build' }),
            simulateSingleYear: () => ({})
        }, '31.'));
        assertEqual(incompatibleEngine?.reason, 'incompatible_version', 'Inkompatible Engine-Major-Version wird abgewiesen');

        const replacedContract = captureGateError(() => assertActiveEngineHandshake(handshake, {
            ...compatibleEngine
        }));
        assertEqual(replacedContract?.reason, 'contract_changed', 'Engine-Austausch nach dem Handshake blockiert das Update');

        const validationResult = createUpdateFailureResult(
            new ValidationError([{ fieldId: 'floorBedarf', message: 'ungueltig' }]),
            { phase: 'validation' }
        );
        assertEqual(validationResult.status, BALANCE_UPDATE_STATUS.VALIDATION_ERROR,
            'Eingabefehler liefern validation_error');

        const engineResult = createUpdateFailureResult(new Error('Engine fehlgeschlagen'), { phase: 'engine' });
        assertEqual(engineResult.status, BALANCE_UPDATE_STATUS.ENGINE_ERROR,
            'Engine-Ausfuehrungsfehler liefern engine_error');

        const blockedResult = createUpdateFailureResult(replacedContract, { phase: 'engine_gate' });
        assertEqual(blockedResult.status, BALANCE_UPDATE_STATUS.BLOCKED,
            'Engine-Gate-Fehler liefern blocked');
        assertEqual(blockedResult.reason, 'contract_changed', 'Blocked-Ergebnis behaelt den maschinenlesbaren Gate-Grund');

        const successResult = createUpdateSuccessResult({ marker: true });
        assertEqual(successResult.status, BALANCE_UPDATE_STATUS.SUCCESS, 'Erfolgreiches Update liefert success');
        assertEqual(successResult.ok, true, 'Success-Status bleibt mit bestehendem ok-Contract kompatibel');
    }

    console.log('Balance UI orchestration tests passed');
    console.log('--- Balance UI Orchestration Tests Completed ---');
}

function shouldRun() {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const requestedTest = process.argv[2] ? path.resolve(process.argv[2]) : '';
    return entry === __filename
        || (entry.endsWith(`${path.sep}run-single.mjs`) && requestedTest === __filename);
}

const runRequested = shouldRun();

if (runRequested) {
    try {
        await runBalanceUiOrchestrationTests();
    } finally {
        if (prevLoadState === undefined) delete StorageManager.loadState; else StorageManager.loadState = prevLoadState;
        if (prevSaveState === undefined) delete StorageManager.saveState; else StorageManager.saveState = prevSaveState;
        if (prevResetState === undefined) delete StorageManager.resetState; else StorageManager.resetState = prevResetState;
        if (prevApplyStoredInputs === undefined) delete UIReader.applyStoredInputs; else UIReader.applyStoredInputs = prevApplyStoredInputs;
        UIRenderer.toast = prevToast;
        UIRenderer.handleActionError = prevHandleError;
        if (prevBlob === undefined) delete global.Blob; else global.Blob = prevBlob;
        if (prevURL === undefined) delete global.URL; else global.URL = prevURL;
        if (prevHTMLInputElement === undefined) delete global.HTMLInputElement; else global.HTMLInputElement = prevHTMLInputElement;
        if (prevConfirm === undefined) delete global.confirm; else global.confirm = prevConfirm;
        if (prevLocation === undefined) delete global.location; else global.location = prevLocation;
        if (prevNavigatorDescriptor) Object.defineProperty(global, 'navigator', prevNavigatorDescriptor);
        else delete global.navigator;
        if (prevLocalStorage === undefined) delete global.localStorage; else global.localStorage = prevLocalStorage;
        if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
        if (prevDocument === undefined) delete global.document; else global.document = prevDocument;
        PersistenceFacade.resetPersistenceForTests();
    }
}

// Zentrale Ziele durchlaufen den echten Handoff ohne alte Karten-/Knopfanker.
{
    const { openOverviewBackupTarget } = await import('../app/overview/overview-renderer.js');
    const { createNavigationGuard } = await import('../app/shared/navigation-guard.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    for (const source of ['overview']) for (const outcome of ['success', 'false', 'reject', 'blocked']) {
        const doc = createPresentationTestDocument(), events = new Map(), jobs = [];
        const win = { location: { href: 'http://localhost/' + (source.startsWith('balance') ? 'Balance.html' : 'index.html') }, name: '' };
        doc.addEventListener = (name, fn) => events.set(name, fn);
        doc.contains = node => Boolean(node.parentNode);
        const originalCreate = doc.createElement.bind(doc);
        doc.createElement = tag => {
            const node = originalCreate(tag); node.dataset = { profileHandoffExport: 'false' };
            Object.defineProperty(node, 'isConnected', { get: () => Boolean(node.parentNode) });
            node.closest = () => node;
            node.click = () => {
                assert(node.hasAttribute('data-profile-handoff'), 'Recoveryziel besitzt das geschützte Handoff-Attribut');
                assertEqual(node.getAttribute('data-profile-handoff-export'), 'false', 'Recoveryziel exportiert keinen Profilbundle');
                jobs.push(events.get('click')({ target: node, button: 0, preventDefault() { this.defaultPrevented = true; } }));
            };
            return node;
        };
        let release, flushes = 0, exports = 0, error;
        const gate = new Promise(resolve => release = resolve);
        const guard = createNavigationGuard();
        const unblock = outcome === 'blocked' ? guard.register({}, { read: () => ({ phase: 'commit' }) }) : null;
        bindProfileNavigationHandoff({ root: doc, win, guard, ready: async () => true,
            exporter: () => { exports++; }, onFailure: caught => error = caught,
            flusher: async () => { flushes++; await gate; if (outcome === 'reject') throw new Error('SYNTHETIC_FLUSH_FAILED'); return outcome !== 'false'; } });
        const before = win.location.href;
        openOverviewBackupTarget(doc, '#fullBackupImportBtn');
        for (let i = 0; i < 30; i++) await Promise.resolve();
        assertEqual(win.location.href, before, 'Zentraler Balancezugang wartet auf den geschützten Flush');
        assertEqual(flushes, outcome === 'blocked' ? 0 : 1, source + '/' + outcome + ': Commit sperrt den Navigationsflush');
        release(); await Promise.all(jobs);
        const expected = 'Daten-Sicherung.html#fullBackupImportBtn';
        assertEqual(win.location.href, outcome === 'success' ? expected : before, source + '/' + outcome + ': nur bestätigte Navigation erreicht das konkrete Ziel');
        assertEqual(exports, 0, source + '/' + outcome + ': lokaler Sicherungszugang exportiert keinen Profilbundle');
        assertEqual(Boolean(error), ['false', 'reject'].includes(outcome), source + '/' + outcome + ': Flushfehler bleibt sichtbar');
        assertEqual(doc.body.children.length, 0, source + '/' + outcome + ': keine unsichtbare Ersatzkarte');
        unblock?.unregister();
    }
}
