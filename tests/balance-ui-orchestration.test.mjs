import { annualServiceFixture, readyAnnualFixture, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { verifySamePageAnnualArchive, verifyAnnualFinalReadGuards } from './overview-annual-close.test.mjs?fixture';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { RESET_RELOAD_REQUIRED_MESSAGE } from '../app/shared/navigation-guard.js';
import { bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { readWealthHistory } from '../types/wealth-history-contract.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UIBinder, initUIBinder } from '../app/balance/balance-binder.js';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { bindBalanceInfoPopups } from '../app/balance/balance-renderer-diagnosis.js';
import {
    BALANCE_IMPORT_INPUT_SCHEMA_VERSION,
    BALANCE_EXPORT_APP_ID,
    BALANCE_EXPORT_SCHEMA,
    BALANCE_EXPORT_SCHEMA_VERSION,
    BalanceImportError,
    createBalanceExportDocument,
    createImportExportHandlers,
    createManualMarketCsvImportPlan,
    parseMarketDataCsv,
    normalizeBalanceImportDocument
} from '../app/balance/balance-binder-imports.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { CONFIG, ValidationError, StorageError } from '../app/balance/balance-config.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { UIRenderer, initUIRenderer } from '../app/balance/balance-renderer.js';
import { initStorageManager, StorageManager } from '../app/balance/balance-storage.js';
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

    const modal = documentRef.register(new MockElement('updateResultModal'));
    const closeX = new MockElement('modalCloseX', 'button');
    closeX.classList.add('modal-close');
    const overlay = new MockElement('modalOverlay');
    overlay.classList.add('modal-overlay');
    modal.appendChild(closeX);
    modal.appendChild(overlay);

    const form = documentRef.register(new MockElement('input-form-container'));
    const currencyInput = documentRef.register(new MockElement('currencyInput', 'input'));
    currencyInput.classList.add('currency');

    const controls = {
        copyAction: documentRef.register(new MockElement('copyAction', 'button')),
        btnJahresUpdate: documentRef.register(new MockElement('btnJahresUpdate', 'button')),
        btnJahresUpdateLog: documentRef.register(new MockElement('btnJahresUpdateLog', 'button')),
        btnNachruecken: documentRef.register(new MockElement('btnNachruecken', 'button')),
        btnUndoNachruecken: documentRef.register(new MockElement('btnUndoNachruecken', 'button')),
        importBtn: documentRef.register(new MockElement('importBtn', 'button')),
        importFile: documentRef.register(new MockElement('importFile', 'input')),
        btnCsvImport: documentRef.register(new MockElement('btnCsvImport', 'button')),
        csvFileInput: documentRef.register(new MockElement('csvFileInput', 'input')),
        jahresabschlussBtn: documentRef.register(new MockElement('jahresabschlussBtn', 'button')),
        connectFolderBtn: documentRef.register(new MockElement('connectFolderBtn', 'button')),
        snapshotStatus: documentRef.register(new MockElement('snapshotStatus'))
    };

    const diagnosis = {
        openBtn: documentRef.register(new MockElement('diagnosisOpen', 'button')),
        copyBtn: documentRef.register(new MockElement('diagnosisCopy', 'button')),
        filterToggle: documentRef.register(new MockElement('diagnosisFilter', 'input')),
        content: documentRef.register(new MockElement('diagnosisContent'))
    };

    documentRef.register(new MockElement('handlungContent')).innerText = 'Aktion';
    documentRef.register(new MockElement('modalTitle'));
    documentRef.register(new MockElement('modalResults'));
    documentRef.register(new MockElement('modalDuration'));
    const modalCloseBtn = documentRef.register(new MockElement('modalCloseBtn', 'button'));
    modal.appendChild(modalCloseBtn);

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
const prevConnectFolder = StorageManager.connectFolder;
const prevReplaceStateFromImport = StorageManager.replaceStateFromImport;
const prevRollbackImportReplace = StorageManager.rollbackImportReplace;
const prevApplyStoredInputs = UIReader.applyStoredInputs;

async function runBalanceUiOrchestrationTests() {
    console.log('--- Balance UI Orchestration Tests ---');
    await verifySamePageAnnualArchive('balance');
    await verifyAnnualFinalReadGuards('balance');

    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests();
        const refs = createDomRefs(documentRef);
        refs.expenses = { yearSelect: new MockElement('expensesYearSelect', 'select'), table: new MockElement('expensesTable') };
        refs.expenses.yearSelect.value = '2026';
        initUIBinder(refs, {}, () => ({ ok: true }), () => {});
        const savedOpenYear = UIBinder.openExpensesYear, savedSelect = UIBinder.selectTab, savedPreparation = UIBinder.openAnnualPreparation;
        let selections = 0, preparations = 0, focused = 0;
        const importButton = new MockElement('monthImport', 'button');
        importButton.dataset.month = '9'; importButton.focus = () => { focused++; };
        refs.expenses.table.querySelectorAll = () => [importButton];
        try {
            UIBinder.openExpensesYear = year => { selections++; refs.expenses.yearSelect.value = String(year); };
            UIBinder.selectTab = () => {};
            UIBinder.openAnnualPreparation = async () => { preparations++; };
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
            UIBinder.openExpensesYear = savedOpenYear; UIBinder.selectTab = savedSelect; UIBinder.openAnnualPreparation = savedPreparation;
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

    console.log('Überblick: Jahreszugang respektiert Kopfbuttonsperre, Navigation und manuelle Erfassung');
    {
        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        const dom = createDomRefs(documentRef);
        const nextAnnual = documentRef.register(new MockElement('balanceNextAnnual', 'button'));
        dom.controls.captureWealthBtn = documentRef.register(new MockElement('captureWealthBtn', 'button'));
        dom.wealthHistory = { status: new MockElement('wealthStatus') };
        const key = CONFIG.STORAGE.LS_KEY;
        const raw = JSON.stringify({ inputs: {}, lastState: { cumulativeInflationFactor: 1, taxState: { lossCarry: 0 } } });
        const backend = new Map([[key, raw], ['rs_current_profile', 'a'], ['rs_active_profile', 'a'],
            ['rs_profiles_v1', JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a' }, data: { [key]: raw } } } })]]);
        let writes = 0, annualCalls = 0, updates = 0, releaseWrite, writeEntered;
        const entered = new Promise(resolve => { writeEntered = resolve; });
        const held = new Promise(resolve => { releaseWrite = resolve; });
        const adapter = { name: 'overview-annual-memory', async open() {}, async loadAll() { return Object.fromEntries(backend); },
            async saveBatch({ upserts, deletes }) {
                writes++;
                if (writes === 1) { writeEntered(); await held; }
                deletes.forEach(k => backend.delete(k)); upserts.forEach(([k, v]) => backend.set(k, v));
            } };
        PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init();
        const savedAnnual = UIBinder.handleJahresabschluss, savedToast = UIRenderer.toast;
        const savedLoad = StorageManager.loadState;
        const annualEnds = [];
        let capture;
        try {
            StorageManager.loadState = prevLoadState;
            UIRenderer.toast = () => {};
            UIBinder.handleJahresabschluss = () => {
                annualCalls++;
                PersistenceFacade.setItemSync('overview-annual-probe', String(annualCalls));
                const end = PersistenceFacade.flush(); annualEnds.push(end); return end;
            };
            initUIBinder(dom, {}, () => {
                updates++;
                return { ok: true, inputData: { tagesgeld: 123, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 } };
            }, () => {});
            UIBinder.bindUI(); UIBinder.bindUI();
            const baseline = JSON.stringify([...backend]);
            const assertBlocked = label => {
                nextAnnual.click();
                assertEqual(annualCalls, 0, `${label}: kein Jahreshandleraufruf`);
                assertEqual(writes, 0, `${label}: kein Write`);
                assertEqual(updates, 0, `${label}: keine Vorschau oder Berechnung`);
                assertEqual(JSON.stringify([...backend]), baseline, `${label}: Backendbytes unverändert`);
            };
            dom.controls.jahresabschlussBtn.disabled = true;
            assertBlocked('Kopfbutton disabled');
            dom.controls.jahresabschlussBtn.disabled = false;
            const guard = getPageNavigationGuard();
            const attempt = await guard.prepare();
            assert(guard.isBusy(), 'Echter Navigationsschutz hält aktiven Versuch');
            assertBlocked('Navigationsschutz busy');
            guard.end(attempt);
            const lease = guard.register('overview-test-commit', { read: () => ({ phase: 'commit' }) });
            assertBlocked('Fremder Commit');
            lease.unregister();

            capture = UIBinder.handleCaptureWealth();
            assert(dom.controls.jahresabschlussBtn.disabled && dom.controls.btnJahresUpdate.disabled,
                'Echte manuelle Erfassung sperrt beide Bestandsbuttons');
            // Vor dem ersten asynchronen Write wirkt bereits die Buttonsperre.
            nextAnnual.click();
            assertEqual(annualCalls, 0, 'Manuelle Vorbereitung startet keinen Jahresprozess');
            await entered;
            nextAnnual.click(); nextAnnual.click();
            assertEqual(annualCalls, 0, 'Gehaltene manuelle Erfassung startet keinen Jahresprozess');
            assertEqual(writes, 1, 'Nur der gehaltene manuelle Write wurde begonnen');
            assertEqual(JSON.stringify([...backend]), baseline, 'Keine Backendänderung vor Freigabe');
            releaseWrite();
            assertEqual((await capture).status, 'saved', 'Echter manueller Verlaufwrite bestätigt');
            assertEqual(JSON.parse(backend.get(key)).wealthHistory.entries.length, 1, 'Genau ein manueller Stand');
            assert(!dom.controls.jahresabschlussBtn.disabled, 'Kopfbutton nach Erfassung wieder frei');
            const writesBeforeAnnual = writes;
            nextAnnual.click();
            await Promise.all(annualEnds);
            assertEqual(annualCalls, 1, 'Freigegebener Überblicksklick löst genau einen Jahreshandleraufruf aus');
            assertEqual(writes, writesBeforeAnnual + 1, 'Genau ein Write des freigegebenen Jahreshandlers');
            assertEqual(backend.get('overview-annual-probe'), '1', 'Handlerprobe erreicht das Backend nur nach Freigabe');
        } finally {
            releaseWrite();
            if (capture) await capture;
            UIBinder.handleJahresabschluss = savedAnnual;
            UIRenderer.toast = savedToast;
            StorageManager.loadState = savedLoad;
            PersistenceFacade.resetPersistenceForTests();
        }
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
        const expensesPanel = documentRef.register(new MockElement('tab-expenses'));
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
        let generated = 0;
        for (const section of ['wealthHistory']) {
            dom[section] = { panel: section === 'wealthHistory' ? evaluationPanel : expensesPanel, hint: { textContent: '' }, date: { textContent: '' } };
            for (const key of ['chart', 'table']) {
                let markup = '';
                dom[section][key] = { get innerHTML() { return markup; }, set innerHTML(value) {
                    assert((section === 'wealthHistory' ? evaluationPanel : expensesPanel).classList.contains('active') || value === '', 'Inaktiv keine Markuperzeugung durch Binder');
                    if (value) generated++;
                    markup = value;
                } };
            }
        }
        const entry = { id: 'manual:2026-10-03', asOf: '2026-10-03', reason: 'manual', periodId: null,
            tagesgeld: 12, geldmarktEtf: 23, depotwertAlt: 34, depotwertNeu: 45, aktienEtf: 79, total: 114 };
        let currentState = { inputs: {}, wealthHistory: { schemaVersion: 1, entries: [entry] } };
        StorageManager.loadState = () => currentState;
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
            click({ target: evaluationButton });
            assertEqual(generated, 2, 'Verlauf zeichnet ausschließlich Vermögen');
            click({ target: updateButton });
            assertEqual(generated, 2, 'Verlassen erzeugt keine dynamischen Inhalte');
            assertEqual(dom.wealthHistory.chart.innerHTML + dom.wealthHistory.table.innerHTML, '', 'Vermögenscontainer nach Verlassen leer');
            currentState = { inputs: {} };
            click({ target: evaluationButton });
            assertEqual(dom.wealthHistory.chart.innerHTML, '', 'Wiederöffnung liest frische Vermögensdaten');
            assertEqual(dom.expensesHistory, undefined, 'Balance hat keinen Ausgabenhistorienhost');
            assertEqual(updates + writes + clears, 0, 'Tablistener berechnet, erfasst, schreibt und bereinigt keine Fehler');
        } finally {
            localStorageRef.setItem = originalWrite;
            UIRenderer.clearError = originalClear;
            UIRenderer.clearActionError = originalActionClear;
        }
    }

    // Ausstehende Eingaben werden vor dem Seitenwechsel validiert und gespeichert.
    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        const dom = createDomRefs(documentRef), state = { debounceTimer: null };
        let response, mode, calls = 0;
        const flush = PersistenceFacade.flush;
        PersistenceFacade.flush = async () => true;
        try {
            initUIBinder(dom, state, options => { calls++; mode = options.mode; return response; }, () => {});
            assert(await UIBinder.prepareExpensesNavigation(), 'Ohne ausstehende Eingaben ist Ausgabennavigation bereit');
            assertEqual(calls, 0, 'Lesender Ausgabenwechsel berechnet keine Balance');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: false };
            assert(!await UIBinder.prepareExpensesNavigation(), 'Ungültige ausstehende Eingaben verhindern Ausgabennavigation');
            assertEqual(mode, BALANCE_UPDATE_MODE.PERSIST_INPUTS, 'Navigation verarbeitet Eingaben im bestehenden Persistenzmodus');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: true, overviewPersistence: Promise.resolve(false) };
            assert(!await UIBinder.prepareExpensesNavigation(), 'Fehlgeschlagene Summarybestätigung verhindert Ausgabennavigation');
            state.debounceTimer = setTimeout(() => {}, 10000);
            response = { ok: true, overviewPersistence: Promise.resolve(true) };
            assert(await UIBinder.prepareExpensesNavigation(), 'Bestätigte ausstehende Eingaben erlauben Ausgabennavigation');
            state.debounceTimer = setTimeout(() => {}, 10000);
            PersistenceFacade.flush = async () => false;
            assert(!await UIBinder.prepareExpensesNavigation(), 'Fehlgeschlagener Eingabeflush verhindert Ausgabennavigation');
        } finally { clearTimeout(state.debounceTimer); PersistenceFacade.flush = flush; }
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
        assertEqual(popupControls.openActionDetails.listeners.click.length, 1, 'Detailsauslöser einmal gebunden');
        popupControls.openActionDetails.listeners.click[0]({ currentTarget: popupControls.openActionDetails });
        assert(actionDialog.open && documentRef.activeElement === popupControls.closeActionDetails, 'Dialog öffnet modal und fokussiert Schließen');
        popupControls.printAction.click();
        assertEqual(printed, 1, 'Popupdruck nutzt denselben vollständigen Plan');
        popupControls.closeActionDetails.click();
        assert(!actionDialog.open && documentRef.activeElement === popupControls.openActionDetails, 'Schließen führt zum Detailsauslöser zurück');
        popupControls.openActionDetails.listeners.click[0]({ currentTarget: popupControls.openActionDetails });
        assert(actionDialog.open, 'Details lassen sich erneut öffnen');
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

    console.log('Ausgabenimport: Binder erhält Tab und aktualisiert beide Abschnitte aus bestätigten Daten');
    for (const open of [false, true]) {
        for (const outcome of ['fresh', 'old', 'unknown', 'none', 'error']) {
            const documentRef = new MockDocument();
            installBrowserGlobals(documentRef, createLocalStorageMock());
            const key = CONFIG.STORAGE.LS_KEY;
            const annual = { id: 'annual:2026', asOf: '2026-12-31', reason: 'annual_close', periodId: 'calendar-year:2026',
                tagesgeld: 1, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0, aktienEtf: 0, total: 1 };
            const raw = JSON.stringify({ inputs: {}, lastState: { cumulativeInflationFactor: 1, taxState: { lossCarry: 0 } },
                wealthHistory: { schemaVersion: 1, entries: [annual] } });
            const backend = new Map([[key, raw], ['rs_current_profile', 'a'], ['rs_active_profile', 'a'],
                ['rs_profiles_v1', JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a' }, data: { [key]: raw } } } })],
                ['balance_expenses_v1', JSON.stringify({ version: 1, years: { '2025': { months: {
                    '1': { profiles: { a: { categories: { Ausgabe: -250 } } } }
                } } } })]]);
            const adapter = { name: 'binder-capture-memory', async open() {}, async loadAll() { return Object.fromEntries(backend); },
                async saveBatch({ upserts, deletes }) { deletes.forEach(k => backend.delete(k)); upserts.forEach(([k, v]) => backend.set(k, v)); } };
            PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init();
            StorageManager.loadState = prevLoadState;
            const dom = createDomRefs(documentRef);
            const panel = new MockElement('tab-wealth'); if (open) panel.classList.add('active');
            for (const section of ['wealthHistory']) {
                dom[section] = { panel, date: { textContent: '' }, count: { textContent: '' },
                    chart: { innerHTML: '' }, table: { innerHTML: '' }, hint: { textContent: '' }, status: { textContent: '' } };
            }
            const source = { tagesgeld: 123, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: outcome === 'none' ? 0 : 200 };
            const asOf = outcome === 'unknown' ? undefined : Math.floor(Date.now() / 1000) - (outcome === 'old' ? 604801 : 10);
            const inputData = { ...source, detailledTranches: outcome === 'none' ? [] : [{
                category: 'equity', type: 'aktien_neu', shares: 2, currentPrice: 100, marketValue: 200, asOf
            }] };
            let previews = 0; const messages = [], errors = [];
            const savedToast = UIRenderer.toast, savedActionError = UIRenderer.handleActionError;
            UIRenderer.toast = (text, type) => messages.push({ text, type });
            UIRenderer.handleActionError = (error, scope) => errors.push({ error, scope });
            try {
                initUIBinder(dom, {}, options => {
                    previews++; assertEqual(options.mode, 'preview', 'Binder fordert PREVIEW an');
                    if (outcome === 'error') throw new Error('Vorschaufehler');
                    return { ok: true, inputData };
                }, () => {});
                const result = await UIBinder.handleExpensesImported();
                assertEqual(previews, 1, 'Genau eine Vorschau pro Binder-Import');
                assertEqual(panel.classList.contains('active'), open, 'Erfolg, Hinweis und Fehler erhalten Tabaktivität');
                assertEqual(dom.wealthHistory.date.textContent, 'Zuletzt erfasst am 31.12.2026', 'Maximaler bestätigter Stichtag bleibt maßgeblich');
                if (open) {
                    assertEqual(dom.expensesHistory, undefined, 'Ausgabenübersicht gehört zur eigenständigen Seite');
                    assert(dom.wealthHistory.table.innerHTML.includes('Jahresabschluss'), 'Aktiver Verlauf wird frisch gezeichnet');
                } else {
                    assertEqual(dom.wealthHistory.chart.innerHTML + dom.wealthHistory.table.innerHTML, '', 'Inaktive Container bleiben ungezeichnet');
                }
                if (['fresh', 'none'].includes(outcome)) {
                    assertEqual(result.status, 'saved', 'Binder bestätigt frische und kursfreie Erfassung');
                    assertEqual(messages[0].type, true, 'Bestätigte Erfassung als Erfolg');
                    assertEqual(JSON.parse(backend.get(key)).wealthHistory.entries.length, 2, 'Genau ein neuer unterjähriger Stand');
                } else {
                    assertEqual(JSON.parse(backend.get(key)).wealthHistory.entries.length, 1, 'Hinweis oder Fehler schreibt keinen Stand');
                    if (outcome === 'error') assertEqual(errors[0].scope, 'expenses-wealth', 'Fehler bleibt im Ausgabenaktionsbereich');
                    else assertEqual(messages[0].type, 'info', 'Alte und unbekannte Kurse sind Hinweise');
                }
            } finally {
                UIRenderer.toast = savedToast; UIRenderer.handleActionError = savedActionError;
                PersistenceFacade.resetPersistenceForTests();
            }
        }
    }

    console.log('Test 1: UIBinder binds controls only once and tolerates optional import/export controls');
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
        StorageManager.connectFolder = () => {};

        const dom = createDomRefs(documentRef);
        delete dom.controls.exportBtn;
        const binderState = { snapshotHandle: null, pendingInputMetadata: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' } };
        initUIBinder(dom, binderState, () => { updateCalls += 1; }, () => { debouncedCalls += 1; });

        UIBinder.bindUI();
        UIBinder.bindUI();

        assertEqual((documentRef.listeners.keydown || []).length, 1, 'Keyboard shortcut listener wird nur einmal gebunden');
        assertEqual((dom.containers.form.listeners.input || []).length, 1, 'Form-Input listener wird nur einmal gebunden');
        assertEqual((dom.controls.btnJahresUpdate.listeners.click || []).length, 1, 'Jahresupdate listener wird nur einmal gebunden');
        assertEqual((dom.controls.importBtn.listeners.click || []).length, 1, 'Import-Button listener bleibt trotz optionalem Export eindeutig');

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
        for (const id of ['importFile', 'csvFileInput', 'expensesCsvInput', 'depotwertDatei']) {
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
        const excludedState = {
            inputs: {
                tagesgeld: 900000,
                depotwertAlt: 900000,
                costBasisAlt: 100000,
                renteAktiv: true,
                renteMonatlich: 5000
            }
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
                },
                excluded: {
                    meta: { id: 'excluded', name: 'Ausgeschlossen', createdAt, updatedAt: createdAt, belongsToHousehold: false },
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
        assertEqual((profileList.listeners.change || []).length, 1, 'Profilverbund-Profilliste wird nur einmal gebunden');

        const registryAfterReload = JSON.parse(localStorageRef.getItem('rs_profiles_v1'));
        assertEqual(registryAfterReload.profiles.included.data.profile_person_schema_version, '1',
            'Initialisierung erhält das Personenschema trotz fehlender Live-Personenschlüssel');
        assertEqual(registryAfterReload.profiles.included.data.profile_aktuelles_alter, '67',
            'Initialisierung erhält das Profilalter trotz fehlender Live-Personenschlüssel');
        assertEqual(UIReader.readAllInputs().floorBedarf, 1200,
            'Initialisierung verwendet einen echten Leser mit gültigem Formularbedarf');
        for (const profile of Object.values(registryAfterReload.profiles)) Object.assign(profile.data, { profile_person_schema_version: '1', profile_aktuelles_alter: '67', profile_rente_monatlich: '0' });
        assertEqual(registryAfterReload.profiles.excluded.meta.belongsToHousehold, false,
            'Initialisierung erhaelt den gespeicherten Opt-out-Zustand');
        const excludedCheckbox = profileList.children
            .map(row => row.children[0])
            .find(checkbox => checkbox?.dataset?.profileId === 'excluded');
        assert(excludedCheckbox, 'Ausgeschlossenes Profil wird im Selektor dargestellt');
        assertEqual(excludedCheckbox.checked, false, 'Checkbox spiegelt den gespeicherten Opt-out-Zustand');

        registryAfterReload.profiles.included.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(includedState);
        registryAfterReload.profiles.partner.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(partnerState);
        registryAfterReload.profiles.excluded.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(excludedState);
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
        assertEqual(selectedProfiles.length, 2, 'Nur ausgewaehlte Profile werden fuer den Profilverbund geladen');
        assertEqual(selectedProfiles[0].profileId, 'included', 'Opt-out-Profil wird nicht in Aggregate uebernommen');
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
        assertEqual(aggregateInput.tagesgeld, 30000, 'Opt-out-Vermoegen beeinflusst das Haushaltsaggregat nicht');
        assertEqual(aggregateInput.renteMonatlich, 0, 'Opt-out-Einkommen beeinflusst das Haushaltsaggregat nicht');

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
        assertEqual(runs.length, 2, 'Opt-out-Profil erzeugt keinen Profil-Run');
        assertEqual(mergedAction.quellen.length, 0, 'Haushalt ohne Handlungsbedarf erhaelt keine erfundene Profilquelle');
        assertEqual(engineCalls[0].detailledTranches.length, 2, 'Haushaltslauf erhaelt synthetische Tranchen der zwei ausgewaehlten Profile');
        assert(engineCalls[0].detailledTranches.every(tranche => tranche.sourceProfileId !== 'excluded'),
            'Opt-out-Profil gelangt nicht in den Haushaltstranchenpool');
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

    console.log('Test 3: Balance import schema, legacy migration and fail-safe orchestration');
    {
        const validState = {
            inputs: {
                aktuellesAlter: 67,
                floorBedarf: 24000,
                flexBedarf: 12000,
                minimumFlexAnnual: 2000,
                tagesgeld: 50000
            },
            lastState: {
                cumulativeInflationFactor: 1.08,
                lastInflationAppliedAtAge: 66,
                taxState: { lossCarry: 500 }
            }
        };
        const currentDocument = createBalanceExportDocument(validState);
        assertEqual(currentDocument.appId, BALANCE_EXPORT_APP_ID, 'Export nutzt die stabile Balance-App-ID');
        assertEqual(currentDocument.schema, BALANCE_EXPORT_SCHEMA, 'Export benennt das Balance-State-Schema');
        assertEqual(currentDocument.schemaVersion, BALANCE_EXPORT_SCHEMA_VERSION, 'Export nutzt die aktuelle Schema-Version');
        assert(Number.isFinite(new Date(currentDocument.exportedAt).getTime()), 'Export enthaelt einen gueltigen ISO-Zeitpunkt');

        const normalizedCurrent = normalizeBalanceImportDocument(currentDocument);
        assertEqual(normalizedCurrent.sourceFormat, 'balance-state-v2', 'Aktuelles Exportformat wird eindeutig erkannt');
        assertEqual(normalizedCurrent.migrated, false, 'Aktuelles Exportformat wird nicht als Legacy markiert');
        assertEqual(normalizedCurrent.payload.inputs.floorBedarf, 24000, 'Validierung erhaelt gueltige Kernwerte');
        assertEqual(Object.hasOwn(normalizedCurrent.payload.inputs, 'dynamicFlex'), false,
            'Ein fehlendes optionales Booleanfeld bleibt fehlend und wird nicht aktiviert');
        assertEqual(BALANCE_IMPORT_INPUT_SCHEMA_VERSION, 2, 'Der vollständige Eingabevertrag ist explizit versioniert');

        const versionOneDocument = {
            ...currentDocument,
            schemaVersion: 1,
            inputSchemaVersion: 1,
            payload: {
                ...validState,
                inputs: {
                    ...validState.inputs,
                    aktuellesAlter: 0,
                    targetEq: 0,
                    runwayTargetMonths: 42,
                    runwayMinMonths: 24,
                    rebalBand: 0,
                    tqfAlt: 30,
                    kirchensteuerSatz: 0.08
                }
            }
        };
        const normalizedVersionOne = normalizeBalanceImportDocument(versionOneDocument);
        assertEqual(normalizedVersionOne.sourceFormat, 'balance-state-v1',
            'Bestehende Version-1-Sicherungen laufen über den benannten Aufwärtsmigrator');
        assertEqual(normalizedVersionOne.migrated, true, 'Version-1-Sicherungen werden sichtbar als migriert markiert');
        assertEqual(normalizedVersionOne.payload.inputs.liquidityRunwayYears, 3.5,
            'Der Version-1-Migrator übernimmt das frühere Runway-Ziel in Jahre');
        assertEqual(Object.hasOwn(normalizedVersionOne.payload.inputs, 'targetEq'), false,
            'Der Version-1-Migrator entfernt die nicht mehr wirksame Aktien-Zielquote');
        assertEqual(Object.hasOwn(normalizedVersionOne.payload.inputs, 'runwayTargetMonths'), false,
            'Der Version-1-Migrator emittiert kein altes Runway-Zielfeld');
        assertEqual(Object.hasOwn(normalizedVersionOne.payload.inputs, 'rebalBand'), false,
            'Der Version-1-Migrator entfernt das mehrdeutige alte Aktien-Rebalancing-Band');
        assertEqual(normalizedVersionOne.payload.inputs.tqfAlt, 0.3,
            'Eindeutige historische Prozentschreibweise wird symmetrisch in die Dezimalrate migriert');
        assertEqual(normalizedVersionOne.payload.inputs.kirchensteuerSatz, 0.08,
            'Der bereits versionierte Kirchensteuer-Enum bleibt ohne unbelegte Prozentheuristik erhalten');
        const normalizedOffGridVersionOne = normalizeBalanceImportDocument({
            ...versionOneDocument,
            payload: {
                ...versionOneDocument.payload,
                inputs: {
                    ...versionOneDocument.payload.inputs,
                    runwayTargetMonths: 25
                }
            }
        });
        assertEqual(normalizedOffGridVersionOne.payload.inputs.liquidityRunwayYears, 2.5,
            'Ein alter 25-Monats-Wert bleibt importierbar und wird sicherheitsorientiert auf das naechste Halbjahr aufgerundet');

        [
            { field: 'rebalancingBand', value: 0, expectsWarning: false },
            { field: 'aktuellesAlter', value: 0, expectsWarning: false },
            { field: 'inflation', value: 60, expectsWarning: true },
            { field: 'horizonYears', value: 30.5, expectsWarning: true },
            { field: 'profilName', value: 'P'.repeat(250), expectsWarning: true },
            { field: 'flexBudgetYears', value: 12, expectsWarning: true },
            { field: 'tqfAlt', value: 30, expectsWarning: true },
            { field: 'liquidityRunwayYears', value: 5000, expectsWarning: true },
            { field: 'liquidityRunwayYears', value: 1.25, expectsWarning: true }
        ].forEach(({ field, value, expectsWarning }) => {
            const exportWithReachableValue = createBalanceExportDocument({
                ...validState,
                inputs: { ...validState.inputs, [field]: value }
            });
            assertEqual(exportWithReachableValue.schemaVersion, 2,
                `Erreichbarer Livewert ${field} verhindert den Recovery-Export nicht`);
            assertEqual(Boolean(exportWithReachableValue.validationWarnings?.length), expectsWarning,
                `${field} wird entsprechend dem aktuellen Importvertrag als Hinweis inventarisiert`);
            if (expectsWarning) {
                assert(exportWithReachableValue.validationWarnings[0].message.includes(field),
                    `${field} bleibt im Exporthinweis konkret benannt`);
            }
        });
        const zeroBoundaryDocument = createBalanceExportDocument({
            ...validState,
            inputs: { ...validState.inputs, targetEq: 0, rebalBand: 0, rebalancingBand: 0 }
        });
        const normalizedZeroBoundary = normalizeBalanceImportDocument(zeroBoundaryDocument);
        assertEqual(Object.hasOwn(normalizedZeroBoundary.payload.inputs, 'targetEq'), false,
            'Aktueller Export-/Import-Roundtrip entfernt die wirkungslose Aktien-Zielquote');
        assertEqual(normalizedZeroBoundary.payload.inputs.liquidityRunwayYears, 5,
            'Aktueller Export-/Import-Roundtrip materialisiert den kanonischen Runway-Default');
        assertEqual(Object.hasOwn(normalizedZeroBoundary.payload.inputs, 'rebalBand'), false,
            'Aktueller Export-/Import-Roundtrip entfernt das alte Rebalancing-Feld');
        assertEqual(normalizedZeroBoundary.payload.inputs.rebalancingBand, 0,
            'Aktueller Export-/Import-Roundtrip erhält das kanonische Gold-Rebalancing-Band 0');
        for (const inflationBoundary of [-10, 50]) {
            const boundaryDocument = createBalanceExportDocument({
                ...validState,
                inputs: { ...validState.inputs, inflation: inflationBoundary }
            });
            assertEqual(boundaryDocument.validationWarnings?.length || 0, 0,
                `Inflationsgrenze ${inflationBoundary} bleibt im Export-/Importvertrag inklusive`);
            const normalizedBoundary = normalizeBalanceImportDocument(boundaryDocument);
            assertEqual(normalizedBoundary.payload.inputs.inflation, inflationBoundary,
                `Inflationsgrenze ${inflationBoundary} bleibt im Roundtrip erhalten`);
        }
        const rejectedHistoricalInflationDocument = createBalanceExportDocument({
            ...validState,
            inputs: { ...validState.inputs, inflation: -10.1 }
        });
        assertEqual(rejectedHistoricalInflationDocument.validationWarnings?.[0]?.code, 'invalid_input_bounds',
            'Balance export marks an inflation value below the live application boundary');
        let rejectedHistoricalInflation = null;
        try {
            normalizeBalanceImportDocument(rejectedHistoricalInflationDocument);
        } catch (error) {
            rejectedHistoricalInflation = error;
        }
        assertEqual(rejectedHistoricalInflation?.code, 'invalid_input_bounds',
            'Balance import rejects values that the annual live application path cannot consume');
        assert(rejectedHistoricalInflation?.message?.includes('Untergrenze -10'),
            'Balance import names the same lower boundary as the annual live application path');
        const goldDiagnosticInputs = {
            ...validState.inputs,
            goldBasisVermoegen: 100000,
            goldZielBetrag: 7500,
            goldFloorBetrag: 1000,
            goldStrategyDiagnostics: [{
                profileId: 'default',
                name: 'Standard',
                assetBase: 120000,
                operativeLiquidity: 30000,
                excludedHealthBucket: 20000,
                freeAssetBase: 100000,
                goldAktiv: true,
                goldZielProzent: 7.5,
                goldFloorProzent: 1,
                goldZielBetrag: 7500,
                goldFloorBetrag: 1000,
                rebalancingBand: 25,
                goldSteuerfrei: true
            }]
        };
        const normalizedGoldDiagnostics = normalizeBalanceImportDocument(
            createBalanceExportDocument({ ...validState, inputs: goldDiagnosticInputs })
        );
        assertEqual(normalizedGoldDiagnostics.payload.inputs.goldStrategyDiagnostics.length, 1,
            'Profilverbund-Golddiagnostik ist Teil des vollständigen persistierten Inputvertrags');
        const invalidGoldDiagnosticDocument = createBalanceExportDocument({
            ...validState,
            inputs: {
                ...goldDiagnosticInputs,
                goldStrategyDiagnostics: [{
                    ...goldDiagnosticInputs.goldStrategyDiagnostics[0],
                    freeAssetBase: 99999
                }]
            }
        });
        let invalidGoldDiagnosticError = null;
        try {
            normalizeBalanceImportDocument(invalidGoldDiagnosticDocument);
        } catch (error) {
            invalidGoldDiagnosticError = error;
        }
        assertEqual(invalidGoldDiagnosticError?.code, 'invalid_core_value',
            'Inkonsistente Profilverbund-Golddiagnostik wird vor DOM und Persistenz blockiert');

        const legacyDocument = {
            app: CONFIG.APP.NAME,
            version: 'v21.1 Refactored (Engine v31)',
            payload: {
                ...validState,
                lastState: {
                    cumulativeInflationFactor: 2.9,
                    lastInflationAppliedAtAge: null,
                    taxState: { lossCarry: -1 }
                }
            }
        };
        const normalizedLegacy = normalizeBalanceImportDocument(legacyDocument);
        assertEqual(normalizedLegacy.sourceFormat, 'legacy-balance-export-v0', 'Unterstuetztes Legacy-Format laeuft ueber explizite Migration');
        assertEqual(normalizedLegacy.migrated, true, 'Legacy-Import wird als migriert markiert');
        assertEqual(normalizedLegacy.payload.lastState.cumulativeInflationFactor, 2.9,
            'Legacy-Migration erhaelt einen plausiblen kumulierten Inflationsfaktor');
        assertEqual(normalizedLegacy.payload.lastState.lastInflationAppliedAtAge, 0, 'Legacy-Migration repariert das historische Inflationsalter');
        assertEqual(normalizedLegacy.payload.lastState.taxState.lossCarry, 0, 'Legacy-Migration repariert den historischen Verlustvortrag');

        const captureImportError = document => {
            try {
                normalizeBalanceImportDocument(document);
                return null;
            } catch (error) {
                return error;
            }
        };
        const wealthEntry = { id: 'manual:2026-12-31', asOf: '2026-12-31', reason: 'manual', periodId: null,
            tagesgeld: 12000, geldmarktEtf: 23000, depotwertAlt: 34000, depotwertNeu: 45000, aktienEtf: 79000, total: 114000 };
        const wealthHistory = { schemaVersion: 1, entries: [wealthEntry,
            { ...wealthEntry, id: 'annual:2026', reason: 'annual_close', periodId: 'calendar-year:2026' }] };
        const wealthDocument = createBalanceExportDocument({ ...validState, wealthHistory });
        assertEqual(wealthDocument.schemaVersion, 2, 'Das optionale Feld erhöht die äußere Balance-Version nicht');
        assertEqual(JSON.stringify(normalizeBalanceImportDocument(wealthDocument).payload.wealthHistory), JSON.stringify(wealthHistory), 'Balance-V2-Export und Import erhalten alle Verlauffelder');
        for (const supported of [currentDocument, versionOneDocument, legacyDocument]) {
            assertEqual(readWealthHistory(normalizeBalanceImportDocument(supported).payload).entries.length, 0, 'Unterstützte Exporte ohne Feld besitzen einen leeren Verlauf');
            for (const invalid of [null, undefined, { schemaVersion: 2, entries: [] }, { schemaVersion: 1, entries: [wealthEntry, wealthEntry] },
                { schemaVersion: 1, entries: [{ ...wealthEntry, total: -1 }] }]) {
                const error = captureImportError({ ...supported, payload: { ...supported.payload, wealthHistory: invalid } });
                assert(error instanceof BalanceImportError, 'Auch Legacy-Import prüft ein vorhandenes Verlauffeld strikt');
                assertEqual(error.code, 'invalid_wealth_history', 'Der Import meldet einen gezielten Verlauffehler');
            }
        }
        const warningExport = createBalanceExportDocument({ ...validState, wealthHistory: { schemaVersion: 1, entries: [{ ...wealthEntry, total: 1 }] } });
        assertEqual(warningExport.validationWarnings[0].code, 'invalid_wealth_history', 'Der bestehende Recovery-Export kann einen Validierungshinweis transportieren');
        assertEqual(warningExport.payload.wealthHistory.entries[0].total, 1, 'Der Warnungsexport repariert keine beschädigten Werte');

        const createVersionOneProbe = inputOverrides => ({
            ...currentDocument,
            schemaVersion: 1,
            inputSchemaVersion: 1,
            payload: {
                ...validState,
                inputs: {
                    ...validState.inputs,
                    ...inputOverrides
                }
            }
        });
        [
            {
                label: 'unbekannte Zusatzfelder',
                overrides: { unbekanntesFeld: 1 },
                code: 'unknown_input_field'
            },
            {
                label: 'Bereichsverletzungen',
                overrides: { liquidityRunwayYears: 5000 },
                code: 'invalid_input_bounds'
            },
            {
                label: 'freie Enums',
                overrides: { horizonMethod: 'wuerfeln' },
                code: 'invalid_input_value'
            },
            {
                label: 'ueberlange Strings',
                overrides: { profilName: 'P'.repeat(5000) },
                code: 'invalid_input_type'
            },
            {
                label: 'unbelegte Kirchensteuer-Prozentschreibweisen',
                overrides: { kirchensteuerSatz: 8 },
                code: 'invalid_input_bounds'
            }
        ].forEach(({ label, overrides, code }) => {
            const error = captureImportError(createVersionOneProbe(overrides));
            assertEqual(error?.code, code,
                `Version-1-Import blockiert ${label} nach der Migration am vollständigen V2-Vertrag`);
        });
        const wrongAppError = captureImportError({ ...currentDocument, appId: 'fremde-app' });
        assert(wrongAppError instanceof BalanceImportError, 'Falsche App-ID liefert einen kontrollierten Importfehler');
        assertEqual(wrongAppError.code, 'wrong_app', 'Falsche App-ID ist maschinenlesbar');
        const wrongVersionError = captureImportError({ ...currentDocument, schemaVersion: 99 });
        assertEqual(wrongVersionError?.code, 'unsupported_version', 'Nicht unterstuetzte Schema-Version wird blockiert');
        const wrongInputSchemaError = captureImportError({ ...currentDocument, inputSchemaVersion: 99 });
        assertEqual(wrongInputSchemaError?.code, 'unsupported_input_schema_version',
            'Nicht unterstuetzte Eingabevertragsversion wird blockiert');
        const wrongShapeError = captureImportError({ inputs: validState.inputs });
        assertEqual(wrongShapeError?.code, 'unknown_shape', 'Unversionierter Rohzustand wird nicht als Legacy erraten');
        const invalidCoreError = captureImportError({
            ...currentDocument,
            payload: { ...validState, inputs: { ...validState.inputs, floorBedarf: -1 } }
        });
        assertEqual(invalidCoreError?.code, 'invalid_input_bounds', 'Ungueltige finanzielle Kernwerte werden vor der Mutation blockiert');
        [0, -1, 20.0001, 99, Number.NaN, Number.POSITIVE_INFINITY].forEach(invalidFactor => {
            const invalidInflationError = captureImportError({
                ...currentDocument,
                payload: {
                    ...validState,
                    lastState: { cumulativeInflationFactor: invalidFactor }
                }
            });
            assertEqual(
                invalidInflationError?.code,
                'invalid_last_state',
                `Ungueltiger kumulierter Inflationsfaktor ${String(invalidFactor)} wird vor der Mutation blockiert`
            );
        });
        ['false', '0', 0, 1, null].forEach(value => {
            const invalidBooleanError = captureImportError({
                ...currentDocument,
                payload: {
                    ...validState,
                    inputs: { ...validState.inputs, dynamicFlex: value }
                }
            });
            assertEqual(invalidBooleanError?.code, 'invalid_boolean',
                `Aktuelles Schema blockiert den Nicht-Boolean ${JSON.stringify(value)}`);
        });
        const unknownInputError = captureImportError({
            ...currentDocument,
            payload: {
                ...validState,
                inputs: { ...validState.inputs, unbekanntesFeld: 1 }
            }
        });
        assertEqual(unknownInputError?.code, 'unknown_input_field', 'Nicht inventarisierte Eingabefelder werden fail-closed blockiert');
        const invalidTrancheError = captureImportError({
            ...currentDocument,
            payload: {
                ...validState,
                inputs: {
                    ...validState.inputs,
                    detailledTranches: [{ schemaVersion: 1, trancheId: 'broken' }]
                }
            }
        });
        assertEqual(invalidTrancheError?.code, 'invalid_input_value',
            'Komplexe Eingabefelder werden gegen ihren kanonischen Detailvertrag validiert');
        const unsupportedLegacyError = captureImportError({ ...legacyDocument, version: 'v20.0' });
        assertEqual(unsupportedLegacyError?.code, 'unsupported_legacy_version', 'Nicht explizit migrierbare Legacy-Version wird blockiert');
        const invalidLegacyFieldError = captureImportError({
            ...legacyDocument,
            payload: {
                ...validState,
                inputs: {
                    ...validState.inputs,
                    unbekanntesFeld: 1
                }
            }
        });
        assertEqual(invalidLegacyFieldError?.code, 'unknown_input_field',
            'Auch der Legacy-V0-Pfad endet nach der Migration am vollständigen Eingabevertrag');

        const legacyBooleanDocument = {
            ...legacyDocument,
            payload: {
                ...validState,
                inputs: {
                    ...validState.inputs,
                    renteAktiv: 'false',
                    goldAktiv: '0',
                    goldSteuerfrei: 0,
                    dynamicFlex: 'true',
                    goGoActive: '1',
                    healthBucketEnabled: 'ja',
                    decumulation: {
                        mode: '3_bucket_jilge',
                        bondTargetFactor: 5,
                        drawdownTrigger: 15,
                        bondRefillThresholdPct: 8
                    }
                }
            }
        };
        const normalizedLegacyBooleans = normalizeBalanceImportDocument(legacyBooleanDocument);
        assertEqual(normalizedLegacyBooleans.payload.inputs.renteAktiv, false, 'Legacy-String false wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.goldAktiv, false, 'Legacy-String 0 wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.goldSteuerfrei, false, 'Legacy-Zahl 0 wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.dynamicFlex, true, 'Legacy-String true wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.goGoActive, true, 'Legacy-String 1 wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.healthBucketEnabled, true, 'Legacy-String ja wird explizit migriert');
        assertEqual(normalizedLegacyBooleans.payload.inputs.decumulation.bondRefillThreshold, 8,
            'Legacy-Refill-Alias wird im benannten Legacy-Pfad kanonisiert');
        assertEqual(Object.hasOwn(normalizedLegacyBooleans.payload.inputs.decumulation, 'bondRefillThresholdPct'), false,
            'Legacy-Refill-Alias bleibt nicht parallel zum kanonischen Feld erhalten');
        let invalidExportError = null;
        try {
            createBalanceExportDocument({});
        } catch (error) {
            invalidExportError = error;
        }
        assertEqual(invalidExportError?.code, 'invalid_inputs', 'Export erzeugt keine formal aktuelle, aber fachlich ungueltige Datei');

        const documentRef = new MockDocument();
        const localStorageRef = createLocalStorageMock();
        installBrowserGlobals(documentRef, localStorageRef);
        PersistenceFacade.resetPersistenceForTests();

        const errors = [];
        const errorScopes = [];
        const toasts = [];
        UIRenderer.handleActionError = (error, scope) => { errors.push(error); errorScopes.push(scope); };
        UIRenderer.toast = message => { toasts.push(message); };
        StorageManager.saveState = () => {};
        StorageManager.loadState = () => ({ inputs: {} });
        let replaceCalls = 0;
        let rollbackCalls = 0;
        StorageManager.replaceStateFromImport = async payload => {
            replaceCalls += 1;
            assertEqual(payload.inputs.floorBedarf, 24000, 'Replace erhaelt nur den validierten Payload');
            return { ok: true, recoverySnapshotId: 'import-recovery-test' };
        };
        StorageManager.rollbackImportReplace = async receipt => {
            rollbackCalls += 1;
            assertEqual(receipt.recoverySnapshotId, 'import-recovery-test', 'Rollback nutzt den bestaetigten Recovery-Receipt');
            return { ok: true };
        };

        const dom = createDomRefs(documentRef);
        initUIReader(dom);
        dom.inputs.aktuellesAlter.value = '66';
        UIReader.applyStoredInputs = inputs => {
            dom.inputs.aktuellesAlter.value = String(inputs.aktuellesAlter);
            dom.inputs.tagesgeld.value = String(inputs.tagesgeld || 0);
        };
        let updateCalls = 0;
        const handlers = createImportExportHandlers({
            dom,
            update: () => { updateCalls += 1; return { ok: true, status: 'success' }; },
            debouncedUpdate: () => {}
        });

        StorageManager.loadState = () => ({});
        handlers.handleExport();
        assertEqual(errorScopes[0], 'balance-export', 'Exportfehler gehört zum Exportbereich');
        assert(errors[0].message.includes('[invalid_inputs]'),
            'Ein strukturell unmöglicher Export reicht den maschinenlesbaren Fehlercode durch');
        assert(errors[0].message.includes('inputs'),
            'Ein strukturell unmöglicher Export nennt den konkreten fehlenden Bereich');
        errors.length = 0;
        errorScopes.length = 0;
        StorageManager.loadState = () => ({ inputs: {} });

        let badJsonFileValue = 'C:\\fakepath\\invalid.json';
        const badJsonTarget = {
            type: 'file',
            files: [{ text: async () => '{bad json' }],
            get value() {
                return badJsonFileValue;
            },
            set value(nextValue) {
                if (nextValue !== '') {
                    throw new Error('File inputs may only be cleared programmatically.');
                }
                badJsonFileValue = nextValue;
            }
        };
        dom.inputs.importFile = badJsonTarget;
        await handlers.handleImport({ target: badJsonTarget });

        assertEqual(errors.length, 1, 'JSON-Importfehler wird über handleActionError gemeldet');
        assertEqual(errorScopes.join(','), 'balance-import', 'JSON-Import behält seinen Fehlerbereich');
        assert(errors[0].message.includes('kein gültiges JSON'), 'JSON-Import nennt sichere Ursache und Handlungsoption');
        assertEqual(badJsonTarget.value, '', 'JSON-Dateiauswahl wird nach Fehler zurückgesetzt');
        assertEqual(replaceCalls, 0, 'Syntaxfehler veraendern keine Live-Daten');
        assertEqual(updateCalls, 1, 'Syntaxfehler führen nur Wiederherstellungsvorschauen aus');

        errors.length = 0;
        const wrongAppTarget = {
            files: [{ text: async () => JSON.stringify({ ...currentDocument, appId: 'fremde-app' }) }],
            value: 'selected'
        };
        await handlers.handleImport({ target: wrongAppTarget });
        assertEqual(replaceCalls, 0, 'Falsche App-ID erreicht den Replace-Pfad nicht');
        assertEqual(updateCalls, 2, 'Falsche App-ID führt nur eine weitere Wiederherstellungsvorschau aus');
        assertEqual(dom.inputs.aktuellesAlter.value, '66', 'Abgewiesener Import laesst die sichtbaren Eingaben unveraendert');
        assert(errors[0].message.includes('gehört nicht zur Balance-App'), 'App-ID-Fehler enthaelt Ursache ohne Payload-Leak');

        errors.length = 0;
        const dryRunOptions = [];
        const dryRunFailHandlers = createImportExportHandlers({
            dom,
            update: options => {
                dryRunOptions.push(options);
                return { ok: dryRunOptions.length !== 1, status: 'engine_error' };
            },
            debouncedUpdate: () => {}
        });
        const dryRunFailTarget = {
            files: [{ text: async () => JSON.stringify(currentDocument) }],
            value: 'selected'
        };
        await dryRunFailHandlers.handleImport({ target: dryRunFailTarget });
        assertEqual(dryRunOptions.length, 2, 'Fehlgeschlagener Dry-Run berechnet den wiederhergestellten Stand erneut');
        assertEqual(dryRunOptions[1].mode, BALANCE_UPDATE_MODE.PREVIEW, 'Wiederherstellung bleibt ohne Persistenz');
        assertEqual(dryRunOptions[0].mode, BALANCE_UPDATE_MODE.PREVIEW,
            'Erste Engine-Pruefung ist explizit nicht persistent');
        assertEqual(replaceCalls, 0, 'Fehlgeschlagener Dry-Run schreibt keine Live-Daten');
        assertEqual(dom.inputs.aktuellesAlter.value, '66', 'Fehlgeschlagener Dry-Run stellt die sichtbaren Eingaben wieder her');
        assert(errors[0].message.includes('Live-Daten wurden nicht verändert'), 'Dry-Run-Fehler nennt den unveraenderten Zustand');

        errors.length = 0;
        const successUpdateOptions = [];
        const successHandlers = createImportExportHandlers({
            dom,
            update: options => {
                successUpdateOptions.push(options);
                return { ok: true, status: 'success' };
            },
            debouncedUpdate: () => {}
        });
        const successTarget = {
            files: [{ text: async () => JSON.stringify(currentDocument) }],
            value: 'selected'
        };
        await successHandlers.handleImport({ target: successTarget });
        assertEqual(successUpdateOptions.length, 2, 'Gueltiger Import durchlaeuft Dry-Run und persistentes Abschluss-Update');
        assertEqual(successUpdateOptions[0].mode, BALANCE_UPDATE_MODE.PREVIEW,
            'Gueltiger Import prueft zuerst ohne Persistenz');
        assertEqual(successUpdateOptions[1].mode, BALANCE_UPDATE_MODE.PERSIST_INPUTS,
            'Erst nach Recovery und Replace folgt ein explizites persist_inputs-Update');
        assertEqual(replaceCalls, 1, 'Gueltiger Import ersetzt den Balance-State genau einmal');
        assertEqual(rollbackCalls, 0, 'Erfolgreicher Import benoetigt keinen Rollback');
        assert(toasts.some(message => message.includes('Recovery-Snapshot')), 'Erfolgsmeldung bestaetigt den Recovery-Punkt');

        const jsonLoadState = StorageManager.loadState;
        const jsonReplaceStateFromImport = StorageManager.replaceStateFromImport;
        const jsonRollbackImportReplace = StorageManager.rollbackImportReplace;
        // Erhaltene Parser-/Exportverträge verwenden einen DOM-freien Plan,
        // ohne die entfallene Markt-CSV-Bedienung nachzubilden.
        const csvTargetYear = new Date().getFullYear() - 1;
        const csvExpectedAsOf = `${csvTargetYear}-12-30`;
        const csvSourceFileName = `markt-${csvTargetYear}.csv`;
        const csvRows = [
            'Datum;Schluss',
            `30.12.${csvTargetYear - 3};100`,
            `30.12.${csvTargetYear - 2};110`,
            `30.12.${csvTargetYear - 1};120`,
            `30.12.${csvTargetYear};130`
        ];
        const csvPlan = createManualMarketCsvImportPlan(parseMarketDataCsv(csvRows.join('\n')), {
            mode: 'current', targetYear: csvTargetYear, expectedAsOf: csvExpectedAsOf,
            instrument: 'VWCE.DE', sourceFileName: csvSourceFileName, currentPeriodYear: csvTargetYear });
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
        const csvExportDocument = createBalanceExportDocument(csvStoredState);
        assertEqual(
            csvExportDocument.payload[ANNUAL_MARKET_DATA_META_KEY].sourceFileName,
            csvSourceFileName,
            'JSON-Export erhält die persistierte CSV-Provenienz vollständig'
        );
        const versionOneCsvDocument = JSON.parse(JSON.stringify(csvExportDocument));
        versionOneCsvDocument.schemaVersion = 1;
        versionOneCsvDocument.inputSchemaVersion = 1;
        versionOneCsvDocument.payload.inputs.ath = 0;
        versionOneCsvDocument.payload.inputs.jahreSeitAth = 0;
        const versionOneMarketMeta = versionOneCsvDocument.payload[ANNUAL_MARKET_DATA_META_KEY];
        delete versionOneMarketMeta.engineReference;
        delete versionOneMarketMeta.high.verifiedAllTimeHighAvailable;
        versionOneMarketMeta.high.engineAthAvailable = false;
        const migratedVersionOneCsv = normalizeBalanceImportDocument(versionOneCsvDocument);
        assertEqual(migratedVersionOneCsv.payload.inputs.ath, 0,
            'Version-1-CSV-Provenienz ohne positiven Fensterabstand bleibt nach Migration ATH-neutral');
        assertEqual(
            migratedVersionOneCsv.payload[ANNUAL_MARKET_DATA_META_KEY].engineReference.policy,
            'window_high_as_conservative_ath_lower_bound',
            'Der Version-1-Migrator ergänzt die neue Engine-Referenz nachvollziehbar'
        );
        assertEqual(
            migratedVersionOneCsv.payload[ANNUAL_MARKET_DATA_META_KEY].engineReference.applied,
            false,
            'Der Version-1-Migrator leitet die gerichtete Anwendung aus Fensterhoch und Schlusskurs ab'
        );
        const correctedMarketState = JSON.parse(JSON.stringify(csvStoredState));
        correctedMarketState.inputs.endeVJ = 131;
        const correctedMarketExport = createBalanceExportDocument(correctedMarketState);
        assertEqual(correctedMarketExport.schemaVersion, 2,
            'Eine manuelle Marktdatenkorrektur verhindert den Recovery-Export nicht');
        assertEqual(correctedMarketExport.validationWarnings?.[0]?.code, 'invalid_market_provenance',
            'Eine manuelle Marktdatenkorrektur bleibt im Export als Provenienzabweichung sichtbar');
        assert(correctedMarketExport.validationWarnings[0].message.includes('Provenienz'),
            'Der Exporthinweis benennt die abweichende Provenienz statt den Zustand pauschal als beschädigt');
        const tamperedCsvExport = JSON.parse(JSON.stringify(csvExportDocument));
        tamperedCsvExport.payload[ANNUAL_MARKET_DATA_META_KEY].highScope = 'allTimeHigh';
        const tamperedCsvError = captureImportError(tamperedCsvExport);
        assertEqual(tamperedCsvError?.code, 'invalid_market_provenance',
            'Ein Export kann windowHigh nicht durch manipulierte Metadaten zum ATH hochstufen');
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

        StorageManager.loadState = jsonLoadState;
        StorageManager.replaceStateFromImport = jsonReplaceStateFromImport;
        StorageManager.rollbackImportReplace = jsonRollbackImportReplace;

        dom.inputs.aktuellesAlter.value = '66';
        errors.length = 0;
        let finalUpdateCall = 0;
        const finalFailureHandlers = createImportExportHandlers({
            dom,
            update: () => {
                finalUpdateCall += 1;
                return finalUpdateCall !== 2
                    ? { ok: true, status: 'success' }
                    : { ok: false, status: 'engine_error' };
            },
            debouncedUpdate: () => {}
        });
        const finalFailureTarget = {
            files: [{ text: async () => JSON.stringify(currentDocument) }],
            value: 'selected'
        };
        await finalFailureHandlers.handleImport({ target: finalFailureTarget });
        assertEqual(replaceCalls, 2, 'Spaeter Fehler tritt nach genau einem weiteren Replace auf');
        assertEqual(rollbackCalls, 1, 'Spaeter Abschlussfehler rollt den Import automatisch zurueck');
        assertEqual(dom.inputs.aktuellesAlter.value, '66', 'Rollback stellt auch die sichtbaren Eingaben wieder her');
        assert(errors[0].message.includes('automatisch wiederhergestellt'), 'Rollback-Erfolg nennt Ursache und Wiederherstellung');
        assertEqual(finalUpdateCall, 3, 'Nach Finalfehler folgt die Wiederherstellungsvorschau');

        // Echte JSON-Handler: erfolgreiche Vorschau, danach gezielte
        // Snapshot-/Storage-, Replace-, Final- und Rollbackfehler.
        for (const failure of ['snapshot', 'replace', 'final', 'rollback', 'preview']) {
            dom.inputs.aktuellesAlter.value = '66';
            dom.inputs.tagesgeld.value = '777';
            const baseline = { age: '66', cash: '777' };
            let rendered;
            const modes = [];
            const sequence = [];
            let replacements = 0;
            let rollbacks = 0;
            let writes = 0;
            StorageManager.saveState = () => { writes++; };
            StorageManager.replaceStateFromImport = async () => {
                replacements++;
                sequence.push('replace');
                if (failure === 'snapshot' || failure === 'preview') throw new StorageError('Synthetischer Snapshotfehler');
                if (failure === 'replace') throw new Error('Synthetischer Replacefehler');
                return { recoverySnapshotId: 'matrix-recovery' };
            };
            StorageManager.rollbackImportReplace = async () => {
                rollbacks++;
                sequence.push('rollback');
                if (failure === 'rollback') throw new Error('Synthetischer Rollbackfehler');
            };
            let reported;
            UIRenderer.handleActionError = (error, scope) => {
                reported = error;
                assertEqual(scope, 'balance-import', `${failure}: JSON-Bereich bleibt erhalten`);
                sequence.push('error');
                if (failure !== 'preview') assertEqual(JSON.stringify(rendered), JSON.stringify(baseline), `${failure}: Ergebnis ist vor dem Aktionsfehler wiederhergestellt`);
            };
            const matrixHandlers = createImportExportHandlers({ dom, update: async options => {
                modes.push(options.mode);
                sequence.push(options.mode);
                await Promise.resolve();
                if (options.mode === BALANCE_UPDATE_MODE.PERSIST_INPUTS) return { ok: false };
                if (modes.length > 1 && failure === 'preview') throw new Error('Synthetischer Vorschaufehler');
                rendered = { age: dom.inputs.aktuellesAlter.value, cash: dom.inputs.tagesgeld.value };
                if (modes.length === 1) assert(JSON.stringify(rendered) !== JSON.stringify(baseline), `${failure}: Dry-Run zeigt andere Importdaten`);
                return { ok: true };
            }, debouncedUpdate: () => {} });
            const target = { value: 'selected', files: [{ text: async () => JSON.stringify(currentDocument) }] };
            await matrixHandlers.handleImport({ target });
            assertEqual(modes.join(','), (failure === 'final' || failure === 'rollback') ? 'preview,persist_inputs,preview' : 'preview,preview', `${failure}: exakte Update-Modi`);
            assertEqual(sequence.slice(-2).join(','), 'preview,error', `${failure}: abgewartete Vorschau vor Aktionsfehler`);
            assertEqual(replacements, 1, `${failure}: genau ein Replaceversuch`);
            assertEqual(rollbacks, (failure === 'final' || failure === 'rollback') ? 1 : 0, `${failure}: Rollbackvertrag bleibt erhalten`);
            assertEqual(writes, 0, `${failure}: keine zusätzlichen Speicherwrites`);
            assertEqual(dom.inputs.aktuellesAlter.value, '66', `${failure}: ursprüngliches Alter`);
            assertEqual(dom.inputs.tagesgeld.value, '777', `${failure}: ursprüngliches Tagesgeld`);
            assertEqual(target.value, '', `${failure}: Dateifeld wird auch bei Vorschaufehler geleert`);
            assertEqual(reported.code, failure === 'rollback' ? 'rollback_failed' : failure === 'final' ? 'post_replace_validation_failed' : failure === 'replace' ? 'unexpected_import_error' : 'storage_failed', `${failure}: ursprünglicher Fehlercode`);
            if (failure === 'rollback') assert(reported.message.includes('matrix-recovery') && reported.message.includes('Daten & Sicherung'), 'Rollbackfehler nennt den Recoverypunkt und seinen bedienbaren Ort');
        }

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

    console.log('Ordnerknopf: echter Storage-Handler erhält Fehler bis zur bestätigten Verbindung');
    {
        const documentRef = new MockDocument();
        installBrowserGlobals(documentRef, createLocalStorageMock());
        const dom = createDomRefs(documentRef);
        dom.outputs.snapshotList = null;
        delete dom.controls.snapshotStatus;
        const state = { snapshotHandle: { name: 'bisheriger-ordner' } };
        const savedClear = UIRenderer.clearActionError;
        const savedToast = UIRenderer.toast;
        const savedError = UIRenderer.handleActionError;
        const savedSet = StorageManager._idbHelper.set;
        const savedConnect = StorageManager.connectFolder;
        const deferred = () => {
            let resolve, reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        };
        try {
            StorageManager.connectFolder = prevConnectFolder;
            initStorageManager(dom, state, UIRenderer);
            const savedGet = StorageManager._idbHelper.get, savedPicker = window.showDirectoryPicker;
            try {
                const oldHandle = state.snapshotHandle;
                delete window.showDirectoryPicker;
                await StorageManager.initSnapshots();
                assertEqual(state.snapshotHandle, oldHandle, 'Snapshotstart ohne Ordner-API benötigt keine Balance-Hosts');
                assertEqual(dom.controls.connectFolderBtn.style.display, 'none',
                    'Snapshotstart ohne Ordner-API blendet den vorhandenen Ordnerknopf auch ohne Statushost aus');
                initStorageManager(null, state, UIRenderer);
                await StorageManager.initSnapshots();
                assertEqual(state.snapshotHandle, oldHandle, 'Snapshotstart toleriert auch einen fehlenden Ordnerknopf');
                initStorageManager(dom, state, UIRenderer);
                window.showDirectoryPicker = async () => {};
                for (const permission of ['granted', 'denied']) {
                    const handle = { queryPermission: async options => {
                        assertEqual(options.mode, 'readwrite', 'Snapshotstart prüft bestehende Schreibberechtigung');
                        return permission;
                    } };
                    StorageManager._idbHelper.get = async key => {
                        assertEqual(key, 'snapshotDirHandle', 'Snapshotstart liest den bestehenden Handleschlüssel'); return handle;
                    };
                    const before = state.snapshotHandle;
                    await StorageManager.initSnapshots();
                    assertEqual(state.snapshotHandle, permission === 'granted' ? handle : before,
                        permission + ': Snapshotstart übernimmt nur ein berechtigtes gespeichertes Handle');
                }
            } finally {
                StorageManager._idbHelper.get = savedGet;
                if (savedPicker === undefined) delete window.showDirectoryPicker; else window.showDirectoryPicker = savedPicker;
            }
            initUIBinder(dom, state, () => {}, () => {});
            UIBinder.bindUI();
            const click = dom.controls.connectFolderBtn.listeners.click[0];
            for (const outcome of ['abort', 'denied', 'storage-error', 'success']) {
                const oldHandle = state.snapshotHandle;
                const oldError = { message: 'Bisheriger Snapshotfehler' };
                const foreignError = { message: 'Fremder Importfehler' };
                const errors = new Map([['snapshots', oldError], ['balance-import', foreignError]]);
                const clears = [], toasts = [], writes = [];
                const picker = deferred(), permission = deferred(), storage = deferred();
                const permissionStarted = deferred(), storageStarted = deferred();
                const handle = { requestPermission: options => {
                    assertEqual(options.mode, 'readwrite', `${outcome}: bestehender Berechtigungsmodus`);
                    permissionStarted.resolve();
                    return permission.promise;
                } };
                window.showDirectoryPicker = () => picker.promise;
                UIRenderer.clearActionError = scope => { clears.push(scope); errors.delete(scope); };
                UIRenderer.toast = message => { toasts.push(message); };
                UIRenderer.handleActionError = (error, scope) => { errors.set(scope, error); };
                StorageManager._idbHelper.set = (key, value) => {
                    writes.push({ key, value });
                    storageStarted.resolve();
                    return storage.promise;
                };
                const pending = click();
                const assertPending = phase => {
                    assertEqual(errors.get('snapshots'), oldError, `${outcome}/${phase}: Fehleridentität erhalten`);
                    assertEqual(clears.length, 0, `${outcome}/${phase}: kein clearActionError`);
                    assertEqual(toasts.length, 0, `${outcome}/${phase}: keine Erfolgsmeldung`);
                    assertEqual(state.snapshotHandle, oldHandle, `${outcome}/${phase}: altes Handle erhalten`);
                };
                assertPending('Dialog offen');
                if (outcome === 'abort') {
                    picker.reject(Object.assign(new Error('Auswahl abgebrochen'), { name: 'AbortError' }));
                } else {
                    picker.resolve(handle);
                    await permissionStarted.promise;
                    assertPending('Berechtigung offen');
                    permission.resolve(outcome === 'denied' ? 'denied' : 'granted');
                    if (outcome !== 'denied') {
                        await storageStarted.promise;
                        assertPending('Speicherung offen');
                        if (outcome === 'storage-error') storage.reject(new Error('Handle-Speicherfehler'));
                        else storage.resolve();
                    }
                }
                assertEqual(await pending, undefined, `${outcome}: Knopfbindung behält void-Rückgabe`);
                assertEqual(errors.get('balance-import'), foreignError, `${outcome}: fremder Bereich bleibt erhalten`);
                if (outcome === 'success') {
                    assertEqual(errors.has('snapshots'), false, 'Bestätigte Verbindung entfernt Snapshotfehler');
                    assertEqual(clears.join(','), 'snapshots', 'Erfolg bereinigt ausschließlich Snapshotbereich');
                    assertEqual(toasts.join(','), 'Snapshot-Ordner erfolgreich verbunden.', 'Bestehender Erfolgstext erhalten');
                    assertEqual(state.snapshotHandle, handle, 'Bestätigtes Handle im State');
                } else {
                    assertEqual(clears.length, 0, `${outcome}: kein vorzeitiges Bereinigen`);
                    assertEqual(toasts.length, 0, `${outcome}: kein Erfolg`);
                    assertEqual(state.snapshotHandle, oldHandle, `${outcome}: Handle unverändert`);
                    if (outcome === 'abort') assertEqual(errors.get('snapshots'), oldError, 'AbortError erhält identischen Fehler');
                    else {
                        assert(errors.get('snapshots') instanceof StorageError, `${outcome}: bestehender StorageError-Vertrag`);
                        assertEqual(errors.get('snapshots').message, 'Ordner konnte nicht verbunden werden.', `${outcome}: bestehender Fehlertext`);
                        assertEqual(errors.get('snapshots').context.originalError.message,
                            outcome === 'denied' ? 'Zugriff auf den Ordner wurde nicht gewährt.' : 'Handle-Speicherfehler',
                            `${outcome}: ursprüngliche Ursache erhalten`);
                    }
                }
                assertEqual(writes.length, ['success', 'storage-error'].includes(outcome) ? 1 : 0, `${outcome}: bestehender Speicherablauf`);
                if (writes.length) {
                    assertEqual(writes[0].key, 'snapshotDirHandle', `${outcome}: bestehender Persistenzschlüssel`);
                    assertEqual(writes[0].value, handle, `${outcome}: unverändertes Handle gespeichert`);
                }
            }
            assertEqual(await StorageManager.connectFolder(), undefined, 'Echtes connectFolder behält Promise<void> bei Erfolg');
            window.showDirectoryPicker = async () => { throw Object.assign(new Error('Abbruch'), { name: 'AbortError' }); };
            assertEqual(await StorageManager.connectFolder(), undefined, 'Echtes connectFolder behält Promise<void> bei Abbruch');
        } finally {
            UIRenderer.clearActionError = savedClear;
            UIRenderer.toast = savedToast;
            UIRenderer.handleActionError = savedError;
            StorageManager._idbHelper.set = savedSet;
            StorageManager.connectFolder = savedConnect;
            initStorageManager(null, null, null);
        }
    }

    console.log('Recovery-Folgeaktion: echter Binder meldet Fehler und navigiert erst nach Aktivierung und bestätigtem Flush');
    {
        const { preserveUIBinderStateForTests } = await import('../app/balance/balance-binder.js');
        const { SnapshotArchive } = await import('../app/shared/snapshot-archive.js');
        const { getAppTestDate, setAppTestDate } = await import('../app/shared/app-clock.js');
        const saved = { restoreBinder: preserveUIBinderStateForTests(), date: getAppTestDate(),
            create: StorageManager.createSnapshot, list: SnapshotArchive.listSnapshots, read: SnapshotArchive.readSnapshot,
            load: StorageManager.loadState, save: StorageManager.saveState, clear: UIRenderer.clearActionError,
            error: UIRenderer.handleActionError, toast: UIRenderer.toast, url: global.URL };
        const restoreAnnualLocks = installAnnualLocks();
        try {
            setAppTestDate('2027-01-15');
            for (const scenario of ['write-failure', 'pending', 'pending-no-id']) {
                const doc = new MockDocument();
                installBrowserGlobals(doc, createLocalStorageMock());
                global.URL = prevURL;
                const win = window;
                Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: (await import('./helpers/balance-storage-fixtures.mjs')).createAtomicLockProvider().page() } });
                win.EngineAPI = EngineAPI;
                win.location = { href: 'http://localhost/Balance.html' }; win.name = '';
                doc.defaultView = win; doc.body = new MockElement('body');
                doc.contains = node => Boolean(node.parentNode);
                const jobs = [], reports = [];
                const create = doc.createElement.bind(doc);
                doc.createElement = tag => {
                    const node = create(tag);
                    if (tag === 'a') {
                        node.dataset.profileHandoffExport = 'false';
                        Object.defineProperty(node, 'isConnected', { get: () => Boolean(node.parentNode) });
                        node.closest = () => node;
                        node.hasAttribute = name => node.getAttribute(name) !== null;
                        node.click = () => {
                            assert(node.hasAttribute('data-profile-handoff'), scenario + ': Recovery verwendet den produktiven Handoff');
                            assertEqual(node.getAttribute('data-profile-handoff-export'), 'false', scenario + ': Recovery exportiert keinen Profilbundle');
                            for (const click of doc.listeners.click || []) jobs.push(click({ target: node, button: 0,
                                preventDefault() { this.defaultPrevented = true; } }));
                        };
                    }
                    return node;
                };
                const id = scenario === 'pending-no-id' ? undefined : 'synthetic / ä & point';
                const raw = JSON.stringify({ inputs: { aktuellesAlter: 67 }, lastState: { cumulativeInflationFactor: 1 },
                    annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025',
                        pendingCommit: scenario === 'write-failure' ? null : { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: id } } });
                const sample = readyAnnualFixture();
                sample.records[CONFIG.STORAGE.LS_KEY] = raw;
                const records = new Map(Object.entries(sample.records)), points = new Map();
                let fail = scenario === 'write-failure';
                PersistenceFacade.resetPersistenceForTests({ name: 'binder-recovery-memory', async open() {},
                    async loadAll() { return Object.fromEntries(records); },
                    async listSnapshots() { return [...points.values()]; }, async readSnapshot(id) { return points.get(id); },
                    async writeSnapshot(point) { points.set(point.id, point); },
                    async saveBatch({ upserts, deletes }) {
                        if (fail && upserts.some(([key, value]) => key === CONFIG.STORAGE.LS_KEY && JSON.parse(value).annualPeriodMetadata?.pendingCommit)) {
                            fail = false; throw new Error('SYNTHETIC_ANNUAL_METADATA_WRITE_FAILED');
                        }
                        deletes.forEach(key => records.delete(key)); upserts.forEach(([key, value]) => records.set(key, value));
                    } });
                await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
                StorageManager.loadState = prevLoadState;
                StorageManager.saveState = prevSaveState;
                const archiveList = saved.list, archiveRead = saved.read;
                SnapshotArchive.listSnapshots = archiveList; SnapshotArchive.readSnapshot = archiveRead;
                UIRenderer.clearActionError = () => {}; UIRenderer.toast = () => {};
                UIRenderer.handleActionError = (error, scope, action) => reports.push({ error, scope, action });
                const refs = createDomRefs(doc);
                refs.inputs.profilName.value = 'A'; refs.inputs.aktuellesAlter.value = '67';
                refs.expenses = { yearSelect: { value: '2026' } };
                initUIBinder(refs, {}, () => ({ ok: true }), () => {});
                // Die Vorbereitung ist bestätigt; Recoverycallback und Jahreshandler
                // stammen vollständig aus der produktiven Binderverdrahtung.
                const bound = preserveUIBinderStateForTests().handlers;
                bound.closeCoordinator.prepare = async () => ({});
                bound.annual.showUpdateResultModal = result => {
                    assert(!result.confirmed, scenario + ': Recovery täuscht keine Jahresbestätigung vor');
                    assert(result.recovery, scenario + ': auch ohne Marktergebnisse bleibt der Wiederherstellungsweg sichtbar');
                };
                const result = await UIBinder.handleJahresabschluss({ confirmedPreparation: {} });
                assertEqual(result.status, scenario === 'pending-no-id' ? 'invalid' : 'incomplete_recovery', scenario + ': Periodenvertrag bleibt erhalten');
                assertEqual(bound.getAnnualModel().occasion.annualState, 'recovery', scenario + ': abschließende Lesung erhält Recoveryvorrang');
                assertEqual(points.size, scenario === 'write-failure' ? 1 : 0, scenario + ': bestehende Recovery erzeugt keinen zweiten Snapshot');
                assertEqual(reports.length, 1, scenario + ': genau eine Jahresfehlermeldung');
                assertEqual(reports[0].scope, 'annual', scenario + ': produktiver Jahresreporter');
                assertEqual(reports[0].action.label, 'Daten & Sicherung → Wiederherstellungspunkte', scenario + ': konkrete Folgeaktion');
                const recoveryId = scenario === 'write-failure' ? [...points.keys()][0] : id;
                if (scenario === 'write-failure') assert(reports[0].error.message.includes('SYNTHETIC_ANNUAL_METADATA_WRITE_FAILED'), 'Ursprünglicher Writefehler bleibt in der Recoverymeldung');
                let release, started;
                const gate = new Promise(resolve => { release = resolve; });
                const flushStarted = new Promise(resolve => { started = resolve; });
                bindProfileNavigationHandoff({ root: doc, win, guard: getPageNavigationGuard(), ready: async () => true,
                    exporter: () => { throw new Error('UNEXPECTED_PROFILE_EXPORT'); },
                    flusher: async () => { started(); await gate; return PersistenceFacade.flush(); } });
                const before = win.location.href;
                assertEqual(jobs.length, 0, scenario + ': Jahresfehler löst keine automatische Navigation aus');
                assertEqual(win.location.href, before, scenario + ': vor Aktivierung bleibt Balance geöffnet');
                reports[0].action.onActivate();
                await flushStarted;
                assertEqual(win.location.href, before, scenario + ': aktivierte Recovery wartet auf bestätigten Flush');
                release(); await Promise.all(jobs);
                assertEqual(win.location.href, 'Daten-Sicherung.html' + (recoveryId ? '?punkt=' + encodeURIComponent(recoveryId) : '') + '#wiederherstellung',
                    scenario + ': echte Binderfolgeaktion erreicht das bestätigte Recoveryziel');
                assertEqual(doc.body.children.length, 0, scenario + ': temporärer Navigationslink entfernt');
            }
        } finally {
            restoreAnnualLocks(); saved.restoreBinder(); setAppTestDate(saved.date); global.URL = saved.url;
            StorageManager.createSnapshot = saved.create; SnapshotArchive.listSnapshots = saved.list; SnapshotArchive.readSnapshot = saved.read;
            StorageManager.loadState = saved.load; StorageManager.saveState = saved.save;
            UIRenderer.clearActionError = saved.clear; UIRenderer.handleActionError = saved.error; UIRenderer.toast = saved.toast;
            PersistenceFacade.resetPersistenceForTests();
        }
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
        if (prevConnectFolder === undefined) delete StorageManager.connectFolder; else StorageManager.connectFolder = prevConnectFolder;
        if (prevReplaceStateFromImport === undefined) delete StorageManager.replaceStateFromImport; else StorageManager.replaceStateFromImport = prevReplaceStateFromImport;
        if (prevRollbackImportReplace === undefined) delete StorageManager.rollbackImportReplace; else StorageManager.rollbackImportReplace = prevRollbackImportReplace;
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

// Produktiver Export-/Importvertrag des bereinigten zentralen Personenbestands.
{
    const { stripBalancePersonInputs } = await import('../app/profile/profile-person-data.js');
    const state = stripBalancePersonInputs({ inputs: { aktuellesAlter: 67, renteMonatlich: 1234.567,
        sonstigeEinkuenfte: 0, renteAktiv: true, kirchensteuerSatz: .09, sparerPauschbetrag: 0,
        floorBedarf: 24000, flexBedarf: 6000, tagesgeld: 10000 }, lastState: { cumulativeInflationFactor: 1 } });
    const document = createBalanceExportDocument(state);
    assert(!document.validationWarnings?.length, 'Bereinigter Balance-Export erzeugt keine falsche Alterswarnung');
    const restored = normalizeBalanceImportDocument(document).payload;
    assert(!Object.hasOwn(restored.inputs, 'aktuellesAlter'), 'Zentraler Balance-Roundtrip erzeugt keine eigene Alterseingabe');
    assertEqual(restored.personInputEvidence.renteMonatlich, 1234.567, 'Balance-Roundtrip erhält den alten Ergebnisbeleg präzise');
    assertEqual(restored.inputs.floorBedarf, 24000, 'Zentraler Roundtrip erhält die bestehenden Fachinputs');
}

// Der echte Startkörper installiert Sicherungsnavigation erst nach Profilbereitschaft.
{
    const { functionSource } = await import('./designsystem-selection-dom.mjs');
    const body = functionSource('app/balance/balance-main.js', 'init');
    for (const outcome of ['ready', 'recovery', 'deferred']) {
        const listeners = new Map(), targets = [];
        const win = { location: { hash: '#snapshot-management' }, addEventListener: (name, fn) => listeners.set(name, fn) };
        const doc = { getElementById: () => null, addEventListener() {} };
        let release, releasePlan, profileStarted = false, planStarted = false;
        const profileReady = new Promise(resolve => { release = resolve; });
        const planReady = new Promise(resolve => { releasePlan = resolve; });
        const boundary = new Error('Synthetische Grenze nach Profilbereitschaft');
        const init = new Function('deps', `const { window, document, initPersistence, initializeProfilePage, initializeHouseholdPlanPage,
            createBlockedUpdateResult, showPersonDataStatus, readBalancePersonStatus,
            openBalanceDataTarget, consumeAnnualRetry, getPersistenceStatus, UIBinder } = deps;
            async ${body}; return init;`)({
            window: win, document: doc, initPersistence: async () => {}, UIBinder,
            initializeProfilePage: () => { profileStarted = true; return profileReady; },
            initializeHouseholdPlanPage: () => { planStarted = true; return planReady; },
            createBlockedUpdateResult: reason => ({ reason }),
            showPersonDataStatus: () => {}, readBalancePersonStatus: () => ({ ready: false }),
            openBalanceDataTarget: target => targets.push(target), consumeAnnualRetry: () => null,
            getPersistenceStatus: () => { throw boundary; }
        });
        const pending = init().catch(error => { if (error !== boundary) throw error; return { reason: 'past_profile_gate' }; });
        await Promise.resolve();
        assert(profileStarted, `${outcome}: Profilstart wurde erreicht`);
        assertEqual(listeners.size, 0, `${outcome}: ausstehender Profilstart installiert keinen Hashlistener`);
        assertEqual(targets.length, 0, `${outcome}: ausstehender Profilstart leitet keinen alten Sicherungshash weiter`);
        if (outcome === 'deferred') win.__personMigrationDeferred = true;
        release(outcome !== 'recovery');
        for (let i = 0; i < 10; i++) await Promise.resolve();
        assertEqual(planStarted, outcome === 'ready', `${outcome}: nur bestätigte Profilbereitschaft startet die Planumstellung`);
        assertEqual(listeners.size, outcome === 'ready' ? 1 : 0, `${outcome}: Ausgabenweiterleitung steht vor der Planumstellung bereit`);
        assertEqual(targets.length, 0, `${outcome}: ausstehende Planumstellung navigiert nicht`);
        releasePlan({ status: 'unchanged' });
        assertEqual((await pending).reason, outcome === 'ready' ? 'past_profile_gate' : outcome === 'recovery' ? 'profile_recovery' : 'person_data_deferred', `${outcome}: bestehende Startgrenze bleibt erhalten`);
        assertEqual(listeners.size, outcome === 'ready' ? 1 : 0, `${outcome}: nur bestätigte Profilbereitschaft installiert Navigation`);
        assertEqual(targets.join(','), outcome === 'ready' ? '#wiederherstellung' : '', `${outcome}: nur bestätigte Profilbereitschaft bedient den alten Sicherungshash`);
        if (outcome === 'ready') {
            listeners.get('hashchange')();
            assertEqual(targets.join(','), '#wiederherstellung,#wiederherstellung', 'Späterer Sicherungshash behält den zentralen Wiederherstellungsweg');
        }
    }
}

// Zentrale Ziele durchlaufen den echten Handoff ohne alte Karten-/Knopfanker.
{
    const { openBalanceDataTarget } = await import('../app/balance/balance-binder.js');
    const { openOverviewBackupTarget } = await import('../app/overview/overview-renderer.js');
    const { createNavigationGuard } = await import('../app/shared/navigation-guard.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    for (const source of ['balance', 'balance-no-id', 'overview']) for (const outcome of ['success', 'false', 'reject', 'blocked']) {
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
        if (source.startsWith('balance')) openBalanceDataTarget('#wiederherstellung', source === 'balance' ? 'synthetic & point' : undefined, doc);
        else openOverviewBackupTarget(doc, '#fullBackupImportBtn');
        for (let i = 0; i < 30; i++) await Promise.resolve();
        assertEqual(win.location.href, before, 'Zentraler Balancezugang wartet auf den geschützten Flush');
        assertEqual(flushes, outcome === 'blocked' ? 0 : 1, source + '/' + outcome + ': Commit sperrt den Navigationsflush');
        release(); await Promise.all(jobs);
        const expected = source === 'balance' ? 'Daten-Sicherung.html?punkt=synthetic%20%26%20point#wiederherstellung'
            : source === 'balance-no-id' ? 'Daten-Sicherung.html#wiederherstellung' : 'Daten-Sicherung.html#fullBackupImportBtn';
        assertEqual(win.location.href, outcome === 'success' ? expected : before, source + '/' + outcome + ': nur bestätigte Navigation erreicht das konkrete Ziel');
        assertEqual(exports, 0, source + '/' + outcome + ': lokaler Sicherungszugang exportiert keinen Profilbundle');
        assertEqual(Boolean(error), ['false', 'reject'].includes(outcome), source + '/' + outcome + ': Flushfehler bleibt sichtbar');
        assertEqual(doc.body.children.length, 0, source + '/' + outcome + ': keine unsichtbare Ersatzkarte');
        unblock?.unregister();
    }
}
