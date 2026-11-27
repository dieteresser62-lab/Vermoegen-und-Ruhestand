import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import strict from 'node:assert/strict';
import { syncSelectionText } from '../app/shared/designsystem-selection-text.js';
import { bindHouseholdPlanField, readBoundHouseholdPlanField, writeBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { parseOverviewTarget } from '../app/overview/overview-model.js';
import HISTORICAL_DATENSTAND from '../app/simulator/historical-datenstand.js';
import { createSelectionDocument, addField, simulatorSelectOptions, functionSource, selectionVariant } from './designsystem-selection-dom.mjs';

{
    const previousDocument = globalThis.document;
    const { refreshDynamicFlexControls, syncDynamicFlexPresetSelection } = await import('../app/simulator/simulator-main-dynamic-flex.js');
    try {
        globalThis.document = undefined;
        strict.doesNotThrow(() => { refreshDynamicFlexControls(); syncDynamicFlexPresetSelection(); });
        assertEqual(globalThis.document, undefined, 'Dynamikrefresh ohne Dokument erzeugt keine Sitzung mit ungültigem WeakMap-Schlüssel');
    } finally { globalThis.document = previousDocument; }
}

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
    toggle(name, force = !this.contains(name)) {
        if (force) this.add(name); else this.remove(name);
        return force;
    }
}

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = String(tagName).toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.checked = false;
        this.disabled = false;
        this.type = '';
        this.dataset = {};
        this.style = { display: '', color: '' };
        this.listeners = {};
        this.children = [];
        this.parentNode = null;
        this.classList = new MockClassList();
        this.validationMessage = '';
        this.reportValidityCalls = 0;
        this.attributes = new Map();
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

    dispatchEvent(event) {
        const nextEvent = event || { type: '' };
        nextEvent.target = nextEvent.target || this;
        (this.listeners[nextEvent.type] || []).forEach(handler => handler(nextEvent));
        return true;
    }

    click() {
        this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
    }

    setCustomValidity(message) {
        this.validationMessage = String(message || '');
    }

    reportValidity() {
        this.reportValidityCalls += 1;
        return this.validationMessage === '';
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.get(String(name)) ?? null;
    }

    removeAttribute(name) {
        this.attributes.delete(String(name));
    }

    querySelectorAll(selector) {
        if (selector === 'input, select') {
            return this.children.filter(child => child.tagName === 'INPUT' || child.tagName === 'SELECT');
        }
        return [];
    }

    closest(selector) {
        return null;
    }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.listeners = {};
        this.visibilityState = 'visible';
    }

    createElement(tagName) {
        return new MockElement('', tagName);
    }

    register(element) {
        this.elements.set(element.id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    querySelectorAll(selector) {
        if (selector === '.tab-btn') {
            return Array.from(this.elements.values()).filter(element => element.classList.contains('tab-btn'));
        }
        if (selector === '.tab-panel') {
            return Array.from(this.elements.values()).filter(element => element.classList.contains('tab-panel'));
        }
        return [];
    }

    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter(existing => existing !== handler);
    }
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

function installBrowserGlobals(documentRef, localStorageRef) {
    global.document = documentRef;
    global.window = {
        addEventListener() {},
        removeEventListener() {},
        localStorage: localStorageRef,
        location: { reload() {} }
    };
    global.localStorage = localStorageRef;
    global.location = global.window.location;
    global.confirm = () => true;
    global.alert = () => {};
    global.Event = class {
        constructor(type) {
            this.type = type;
        }
    };
}

function registerElement(documentRef, id, options = {}) {
    const element = documentRef.register(new MockElement(id, options.tagName || 'input'));
    element.value = options.value ?? '';
    element.checked = Boolean(options.checked);
    element.type = options.type || '';
    element.dataset = { ...(options.dataset || {}) };
    if (options.className) {
        options.className.split(/\s+/).filter(Boolean).forEach(name => element.classList.add(name));
    }
    return element;
}

const previousGlobals = {
    document: global.document,
    window: global.window,
    localStorage: global.localStorage,
    location: global.location,
    confirm: global.confirm,
    alert: global.alert,
    Event: global.Event
};

async function runSimulatorUiOrchestrationTests() {
    const openTarget = new Function('parseOverviewTarget', 'activateSimulatorTab', 'window',
        functionSource('app/simulator/simulator-main.js', 'openSimulatorOverviewTarget').split('// Globale Funktionen')[0] + '\nreturn openSimulatorOverviewTarget;')(
        parseOverviewTarget, () => { throw new Error('Unbeabsichtigte Aktivierung'); }, {});
    const activated = [];
    for (const [hash, tab] of [['backtest', 'backtesting'], ['monte-carlo', 'montecarlo'], ['annahmen', 'annahmen']]) {
        assertEqual(openTarget({ hash: '#' + hash }, { ready: true, activate: value => { activated.push(value); return true; } }), true, 'Simulatorziel öffnet vorhandenen Tab: ' + hash);
        assertEqual(activated.at(-1), tab, 'Simulatorziel ordnet bestehenden Tabnamen zu');
    }
    assertEqual(openTarget({ hash: '#backtest' }, { ready: false }), false, 'Simulatorziel wartet auf Bereitschaft');
    assertEqual(openTarget({ hash: '#backtest' }, { ready: true, blocked: true }), false, 'Simulatorziel löst bei Recovery nichts aus');
    assertEqual(openTarget({ hash: '#unbekannt' }, { ready: true }), false, 'Simulator ignoriert fremde Hashes');
    assertEqual(openTarget({ hash: '#werkstatt' }, { ready: true }), false, 'Das Ziel der entfernten Werkstatt öffnet nichts');
    assertEqual(openTarget({ hash: '#backtest', search: '?year=2026' }, { ready: true }), false, 'Simulatorziel akzeptiert keine fremden Parameter');
    assertEqual(activated.length, 3, 'Simulatorziele aktivieren ausschließlich die drei gewählten Ansichten');
    console.log('--- Simulator UI Orchestration Tests ---');

    const documentRef = new MockDocument();
    const localStorageRef = createLocalStorageMock();
    installBrowserGlobals(documentRef, localStorageRef);
    PersistenceFacade.resetPersistenceRuntimeForTests();

    const [
        mainModule,
        tabsModule,
        partnerModule,
        stressModule,
        persistModule,
        monteCarloUiModule,
        backtestUiModule,
        householdNeedsModule,
        profileSelectionModule
    ] = await Promise.all([
        import('../app/simulator/simulator-main.js'),
        import('../app/simulator/simulator-main-tabs.js'),
        import('../app/simulator/simulator-main-partner.js'),
        import('../app/simulator/simulator-main-stress.js'),
        import('../app/simulator/simulator-main-input-persist.js'),
        import('../app/simulator/monte-carlo-ui.js'),
        import('../app/simulator/simulator-backtest.js'),
        import('../app/simulator/simulator-household-needs-persistence.js'),
        import('../app/simulator/simulator-main-profiles.js')
    ]);

    void mainModule;

    console.log('Test 1: simulator-main exposes legacy browser entry points');
    {
        assert(mainModule.simulatorDocumentReady instanceof Promise, 'Simulator startet über dokumentbezogenes Bereitschaftspromise');
        assertEqual(window.onload, undefined, 'Simulator überschreibt keinen globalen onload-Slot');
        assertEqual(typeof window.runMonteCarlo, 'function', 'Monte-Carlo Handler wird global verdrahtet');
        assertEqual(typeof window.runBacktest, 'function', 'Backtest Handler wird global verdrahtet');
        assertEqual(typeof window.simulateOneYear, 'function', 'Legacy simulateOneYear Handler bleibt verfuegbar');
    }

    console.log('Test 2: tab buttons activate exactly one target panel');
    {
        const overviewButton = registerElement(documentRef, 'tab-ergebnis-button', { tagName: 'button', className: 'tab-btn' });
        overviewButton.dataset.tab = 'ergebnis';
        overviewButton.classList.add('active');
        const targetButton = registerElement(documentRef, 'tab-montecarlo-button', { tagName: 'button', className: 'tab-btn' });
        targetButton.dataset.tab = 'montecarlo';
        const overviewPanel = registerElement(documentRef, 'tab-ergebnis', { className: 'tab-panel' });
        overviewPanel.classList.add('active');
        const targetPanel = registerElement(documentRef, 'tab-montecarlo', { className: 'tab-panel' });

        tabsModule.initTabSwitching();
        targetButton.click();

        assert(!overviewButton.classList.contains('active'), 'Vorheriger Tab-Button wird deaktiviert');
        assert(targetButton.classList.contains('active'), 'Geklickter Tab-Button wird aktiviert');
        assert(!overviewPanel.classList.contains('active'), 'Vorheriges Panel wird deaktiviert');
        assert(targetPanel.classList.contains('active'), 'Ziel-Panel wird aktiviert');
    }

    console.log('Test 4: central simulator controls persist and update visible state');
    {
        let confirmCalls = 0;
        global.confirm = () => {
            confirmCalls += 1;
            return true;
        };
        registerElement(documentRef, 'p1StartAlter', { value: '67' });
        const partnerToggle = registerElement(documentRef, 'chkPartnerAktiv', { type: 'checkbox' });
        const partnerSection = registerElement(documentRef, 'sectionRente2');
        partnerModule.initPartnerToggle();
        partnerToggle.checked = true;
        partnerToggle.dispatchEvent({ type: 'change' });

        assertEqual(partnerSection.style.display, 'block', 'Partner-Sektion wird sichtbar geschaltet');
        assertEqual(persistenceStorage.getItem('sim_partnerAktiv'), null, 'Partner-Aktiv-Flag ist kein zweiter Personenspeicher');
        assertEqual(confirmCalls, 0, 'Partner-Toggle fragt nicht unnoetig nach Bestaetigung');

        persistenceStorage.removeItem(householdNeedsModule.HOUSEHOLD_SIMULATOR_NEEDS_STORAGE_KEY);
        persistenceStorage.setItem('sim_startFloorBedarf', '24002');
        persistenceStorage.setItem('sim_startFlexBedarf', '150000');
        persistenceStorage.setItem('sim_minimumFlexAnnual', '60000');
        householdNeedsModule.initializeHouseholdSimulatorNeeds({
            status: 'candidate',
            values: {
                startFloorBedarf: '24002',
                startFlexBedarf: '150000',
                minimumFlexAnnual: '60000'
            }
        });
        const floorInput = registerElement(documentRef, 'startFloorBedarf', { value: '24000' });
        const flexInput = registerElement(documentRef, 'startFlexBedarf', { value: '60000' });
        const minimumFlexInput = registerElement(documentRef, 'minimumFlexAnnual', { value: '30000' });
        const mcRunsInput = registerElement(documentRef, 'mcAnzahl', { value: '1000' });
        [
            ['displayPortfolioBreakdown', 'div'],
            ['simStartVermoegen', 'input'],
            ['depotwertAlt', 'input'],
            ['einstandAlt', 'input'],
            ['tagesgeld', 'input'],
            ['geldmarktEtf', 'input'],
            ['goldAllokationAktiv', 'select'],
            ['goldAllokationProzent', 'input'],
            ['goldFloorProzent', 'input'],
            ['goldSteuerfrei', 'select'],
            ['einstandNeu', 'input'],
            ['depotwertGesamt', 'input'],
            ['goldWert', 'input'],
            ['initialBondBucket', 'input']
        ].forEach(([id, tagName]) => registerElement(documentRef, id, { tagName }));
        persistModule.initInputPersistence();
        assertEqual(floorInput.value, '24002', 'Persistierter Haushalts-Floor wird wiederhergestellt');
        assertEqual(flexInput.value, '150000', 'Persistierter Haushalts-Flex wird wiederhergestellt');
        assertEqual(minimumFlexInput.value, '60000', 'Persistierter Haushalts-Mindest-Flex wird wiederhergestellt');
        assertEqual(mcRunsInput.value, '10000', 'new/empty persistence uses the central 10,000-run default');
        persistenceStorage.setItem('sim_mcAnzahl', '7777');
        persistModule.initInputPersistence();
        assertEqual(mcRunsInput.value, '7777', 'an explicit persisted valid run count is not overwritten');
        flexInput.value = '';
        floorInput.value = '30000';
        floorInput.dispatchEvent({ type: 'input' });

        const persistedHouseholdNeeds = householdNeedsModule.readHouseholdSimulatorNeedsState().values;
        assertEqual(persistedHouseholdNeeds.startFloorBedarf, '30000', 'Input-Persistenz speichert geaenderten Haushalts-Floor');
        assertEqual(persistedHouseholdNeeds.startFlexBedarf, '150000', 'Input-Persistenz behaelt den Haushalts-Flex');
        assertEqual(persistedHouseholdNeeds.minimumFlexAnnual, '60000', 'Input-Persistenz behaelt den Haushalts-Mindest-Flex');
        assertEqual(persistenceStorage.getItem('sim_startFloorBedarf'), '24002', 'Legacy-Profilwert wird nicht mit dem Haushaltswert ueberschrieben');

        flexInput.dispatchEvent({ type: 'input' });
        assert(flexInput.validationMessage.includes('nicht gespeichert'),
            'Ungueltige bearbeitete Bedarfseingabe wird direkt am Feld gemeldet');
        assertEqual(flexInput.reportValidityCalls, 0,
            'Laufende Tastatureingabe wird nicht durch reportValidity unterbrochen');
        flexInput.dispatchEvent({ type: 'change' });
        assert(flexInput.reportValidityCalls >= 1, 'Feldnahe Browsermeldung wird beim Abschluss ausgeloest');
        flexInput.value = '150000';
        flexInput.dispatchEvent({ type: 'input' });
        assertEqual(flexInput.validationMessage, '', 'Eine gueltige Korrektur entfernt die Feldwarnung');

        minimumFlexInput.value = '';
        minimumFlexInput.dispatchEvent({ type: 'input' });
        flexInput.value = '70000';
        flexInput.dispatchEvent({ type: 'input' });
        assertEqual(householdNeedsModule.readHouseholdSimulatorNeedsState().values.startFlexBedarf, '70000',
            'Gueltiger Flex wird trotz leerem Mindest-Flex gegen dessen letzten wirksamen Wert gespeichert');
        minimumFlexInput.value = '60000';
        minimumFlexInput.dispatchEvent({ type: 'input' });
        const repairedHouseholdNeeds = householdNeedsModule.readHouseholdSimulatorNeedsState().values;
        assertEqual(repairedHouseholdNeeds.startFlexBedarf, '70000',
            'Korrektur des Nachbarfelds behaelt die zuvor gespeicherte Flex-Aenderung');
        assertEqual(repairedHouseholdNeeds.minimumFlexAnnual, '60000',
            'Korrigierter Mindest-Flex wird ebenfalls gespeichert');

        persistenceStorage.setItem(householdNeedsModule.HOUSEHOLD_SIMULATOR_NEEDS_STORAGE_KEY, '{kaputt');
        const corruptHouseholdNeeds = householdNeedsModule.readHouseholdSimulatorNeedsState();
        assertEqual(corruptHouseholdNeeds.values, null, 'Defekter Haushalts-Override faellt kontrolliert aus');
        assert(corruptHouseholdNeeds.warning.includes('beschädigt'), 'Defekter Haushalts-Override erzeugt ein sichtbares Warnsignal');
    }

    console.log('Test 5: stress UI renders visible presets');
    {
        const stressSelect = registerElement(documentRef, 'stressPreset', { tagName: 'select' });
        stressModule.initStressPresetOptions();
        assert(stressSelect.children.length > 0, 'Stress-Presets werden in das Select geschrieben');

        registerElement(documentRef, 'dynamicFlex', { type: 'checkbox' });
        registerElement(documentRef, 'horizonMethod', { tagName: 'select', value: 'survival_quantile' });
        registerElement(documentRef, 'goGoActive', { type: 'checkbox' });
        registerElement(documentRef, 'dynamicFlexPreset', { tagName: 'select', value: 'off' });
    }

    console.log('Test 7: Monte-Carlo controls expose method semantics and CAPE precedence');
    {
        const methodSelect = registerElement(documentRef, 'mcMethode', { tagName: 'select', value: 'regime_markov' });
        const blockSizeInput = registerElement(documentRef, 'mcBlockSize', { value: '5' });
        const blockSizeLabel = registerElement(documentRef, 'mcBlockSizeLabel', { tagName: 'label' });
        const startYearMode = registerElement(documentRef, 'mcStartYearMode', { tagName: 'select', value: 'FILTER' });
        const filterRow = registerElement(documentRef, 'mcStartYearFilterRow', { tagName: 'div' });
        const halfLifeRow = registerElement(documentRef, 'mcStartYearHalfLifeRow', { tagName: 'div' });
        const filterValue = registerElement(documentRef, 'mcStartYearFilterValue', { tagName: 'span' });
        const halfLifeValue = registerElement(documentRef, 'mcStartYearHalfLifeValue', { tagName: 'span' });
        registerElement(documentRef, 'mcStartYearFilter', { value: '1970' });
        registerElement(documentRef, 'mcStartYearHalfLife', { value: '20' });
        const capeToggle = registerElement(documentRef, 'useCapeSampling', { type: 'checkbox', checked: true });
        const capeWarning = registerElement(documentRef, 'mcStartYearCapeWarning', { tagName: 'div' });
        // GH-1 Punkt 11: eine bewusst eingetragene 35 bleibt nach dem Neuladen stehen.
        const durationInput = registerElement(documentRef, 'mcDauer', { value: '' });
        persistenceStorage.setItem('sim_mcDauer', '35'); persistenceStorage.setItem('sim_mcDauerBewusst', 'true');

        persistModule.initInputPersistence();
        assertEqual(durationInput.value, '35', 'GH-1 Punkt 11: markierte 35 bleibt nach dem Neuladen');
        durationInput.value = '40';
        durationInput.dispatchEvent({ type: 'change' });
        assertEqual(persistenceStorage.getItem('sim_mcDauerBewusst'), null, 'GH-1 Punkt 11: anderer Wert entfernt die Markierung');
        monteCarloUiModule.initMonteCarloMethodControls();
        monteCarloUiModule.initMonteCarloStartYearControls();
        assertEqual(blockSizeInput.disabled, true, 'Regime-Methoden deaktivieren Blocklaengenfeld');
        assertEqual(blockSizeLabel.textContent, 'Blockgröße', 'Regime-Methoden behalten neutrales Blockgroessenlabel');
        assertEqual(filterRow.style.display, 'block', 'FILTER zeigt das Startjahrfeld');
        assertEqual(halfLifeRow.style.display, 'none', 'FILTER blendet die Recency-Halbwertszeit aus');
        assertEqual(filterValue.textContent, '1970', 'FILTER-Ausgabewert wird synchronisiert');
        assertEqual(halfLifeValue.textContent, '20', 'Recency-Ausgabewert wird synchronisiert');
        assertEqual(capeWarning.style.display, 'block', 'CAPE plus Gewichtung zeigt den sichtbaren Vorranghinweis');
        assertEqual(startYearMode.disabled, true, 'GH-1 Punkt 4: CAPE graut die Daten-Gewichtung aus');

        capeToggle.checked = false;
        capeToggle.dispatchEvent({ type: 'change' });
        assertEqual(capeWarning.style.display, 'none', 'Der Vorranghinweis verschwindet ohne CAPE-Sampling');
        assertEqual(startYearMode.disabled, false, 'GH-1 Punkt 4: ohne CAPE ist die Daten-Gewichtung wieder wählbar');

        methodSelect.value = 'stationary';
        methodSelect.dispatchEvent({ type: 'change' });
        assertEqual(blockSizeInput.disabled, false, 'Stationary Bootstrap aktiviert Blocklaengenfeld');
        assertEqual(blockSizeLabel.textContent, 'Erwartete Blocklänge', 'Stationary Bootstrap zeigt erwartete Blocklaenge');
        assert(blockSizeInput.title.includes('1-30'), 'Stationary Tooltip nennt erlaubten Parameterbereich');

        methodSelect.dispatchEvent({ type: 'change' });
        assertEqual(persistenceStorage.getItem('sim_mcMethode'), 'stationary', 'MC-Methode wird persistiert');
        assertEqual(persistenceStorage.getItem('sim_mcMethodeQuelle'), 'nutzer', 'MS-1: Wahl im Formular setzt das Merkmal „nutzer“');
    }

    console.log('Test 8: Monte-Carlo cancel UI exposes running and cancelling states');
    {
        const startButton = registerElement(documentRef, 'mcButton', { tagName: 'button' });
        const cancelButton = registerElement(documentRef, 'mcCancelButton', { tagName: 'button' });
        cancelButton.hidden = true;
        const progressContainer = registerElement(documentRef, 'mc-progress-bar-container', { tagName: 'div' });
        registerElement(documentRef, 'mc-progress-bar', { tagName: 'div' });
        const compareResults = registerElement(documentRef, 'mc-compare-results', { tagName: 'div' });
        let cancelCalls = 0;
        const ui = monteCarloUiModule.createMonteCarloUI();
        ui.bindCancel(() => { cancelCalls += 1; });

        ui.beginRun();
        assertEqual(startButton.getAttribute('data-field-state'), null, 'Busy-Sperre wird nicht als fachlich inactive klassifiziert');
        assertEqual(startButton.disabled, true, 'MC start remains disabled while a run is active');
        assertEqual(cancelButton.disabled, false, 'MC cancel is enabled for the active run');
        assertEqual(cancelButton.hidden, false, 'MC cancel is visible for the active run');
        cancelButton.click();
        assertEqual(cancelCalls, 1, 'MC cancel dispatches exactly one bound action per click');

        ui.beginCancelling();
        assertEqual(startButton.disabled, true, 'MC start remains disabled while cancellation completes');
        assertEqual(cancelButton.disabled, true, 'duplicate MC cancel is disabled while cancellation completes');
        assert(cancelButton.textContent.includes('Abbruch'), 'cancelling state is visible on the cancel button');
        ui.showCancelled();
        assertEqual(compareResults.style.display, 'block', 'cancelled status is visibly rendered');

        ui.unbindCancel();
        ui.finishRun();
        assertEqual(startButton.disabled, false, 'MC start is restored after lifecycle completion');
        assertEqual(cancelButton.hidden, true, 'MC cancel is hidden after lifecycle completion');
        assertEqual(progressContainer.style.display, '', 'lifecycle state does not mutate progress visibility directly');
    }

    {
        const exportActions = registerElement(documentRef, 'mcRunExportActions', { tagName: 'div' });
        const exportButton = registerElement(documentRef, 'exportMonteCarloRunJson', { tagName: 'button' });
        registerElement(documentRef, 'mcRunExportStatus', { tagName: 'span' });
        const error = registerElement(documentRef, 'mc-error-container', { tagName: 'div' });
        registerElement(documentRef, 'mc-error-message', { tagName: 'pre' });
        const ui = monteCarloUiModule.createMonteCarloUI();
        const download = { content: '{}', filename: 'synthetic.json' };
        for (const stage of ['disableStart', 'beginRun', 'beginCancelling', 'showCancelled', 'showError']) {
            assertEqual(ui.publishRunExport(download), true, 'Veröffentlichbares Ergebnis erlaubt Export');
            assertEqual(exportButton.disabled, false, 'Veröffentlichtes Ergebnis hat bedienbare Exportaktion');
            ui[stage](stage === 'showError' ? 'Synthetischer Fehler' : undefined);
            assertEqual(exportActions.hidden, true, `${stage}: alte Exportaktion bleibt verborgen`);
            assertEqual(exportButton.disabled, true, `${stage}: alte Exportaktion bleibt gesperrt`);
            assertEqual(exportButton.onclick, null, `${stage}: alte Downloadbindung wird entfernt`);
        }
        assertEqual(error.style.display, 'block', 'Fehler bleibt in der gemeinsamen Karte sichtbar');
        ui.hideError();
        assertEqual(error.style.display, 'none', 'Schließen versteckt die Fehlerbox');
        assertEqual(exportButton.disabled, true, 'Fehler schließen gibt keinen veralteten Export frei');
        ui.beginRun();
        ui.publishRunExport(download);
        ui.showError('Technischer Abschluss mit aktuellem Diagnoseexport');
        assertEqual(exportButton.disabled, false, 'Vollständiger aktueller Diagnoseexport bleibt bei technischem Laufabschluss verfügbar');
        assertEqual(exportActions.hidden, false, 'Technischer Abschluss erhält seinen aktuellen Export statt eines Alt-Downloads');
        ui.finishRun();
    }

    console.log('Test 9: Backtest controls receive bounds and exactly one module handler');
    {
        const startButton = registerElement(documentRef, 'btButton', { tagName: 'button' });
        const startYear = registerElement(documentRef, 'simStartJahr', { value: '2000' });
        const endYear = registerElement(documentRef, 'simEndJahr', { value: '2025' });
        const datasetHint = registerElement(documentRef, 'backtestDatasetHint', { tagName: 'p' });
        registerElement(documentRef, 'simStartJahrError', { tagName: 'p' });
        registerElement(documentRef, 'simEndJahrError', { tagName: 'p' });
        registerElement(documentRef, 'toggle-backtest-detail', { type: 'checkbox' });
        registerElement(documentRef, 'exportBacktestJson', { tagName: 'button' });
        registerElement(documentRef, 'exportBacktestCsv', { tagName: 'button' });

        backtestUiModule.initializeBacktestUI();
        backtestUiModule.initializeBacktestUI();

        assert(Number.isInteger(Number(startYear.min)) && Number(startYear.min) <= 2000, 'Backtest start input receives provider minimum');
        // JD-2a: Das Maximum ist das Endjahr des Datenstands (jahresrobust).
        assertEqual(endYear.max, String(HISTORICAL_DATENSTAND.endYear), 'Backtest end input receives provider maximum');
        assert(datasetHint.textContent.includes('Daten') && datasetHint.textContent.includes(String(HISTORICAL_DATENSTAND.endYear)), 'Backtest dataset hint is visible');
        assertEqual(startButton.listeners.click.length, 1, 'Backtest start button has exactly one module click handler');
    }

    console.log('Test 10: missing profile selection fails closed while migration remains pending');
    {
        const profileStatus = registerElement(documentRef, 'simProfileStatus');
        profileSelectionModule.initSimulatorProfileSelection();
        assert(window.__profileRecoveryBlocker?.message.includes('Bedarfsmigration bleibt ausstehend'),
            'Fehlender Profilverbund setzt einen expliziten Recovery-Blocker');
        assertEqual(documentRef.getElementById('mcButton').disabled, true,
            'Fehlender Profilverbund blockiert Monte-Carlo');
        assertEqual(documentRef.getElementById('btButton').disabled, true,
            'Fehlender Profilverbund blockiert Backtest');
        assertEqual(documentRef.getElementById('mcButton').getAttribute('data-field-state'), null,
            'Recovery-Sperre wird nicht pauschal als fachlich inactive klassifiziert');
        assert(profileStatus.textContent.includes('Profil-Recovery erforderlich'),
            'Fehlender Profilverbund wird sichtbar gemeldet');
    }

    await runSelectionTextOrchestrationTests();
    console.log('Simulator UI orchestration tests passed');
    console.log('--- Simulator UI Orchestration Tests Completed ---');
}

async function runSelectionTextOrchestrationTests() {
    console.log('Test 11: Auswahlvolltext nach tatsächlichen Simulator-Produktaktionen und Gegenproben');
    const dynamic = await import('../app/simulator/simulator-main-dynamic-flex.js');
    const rent = await import('../app/simulator/simulator-main-rent-adjust.js');
    const partner = await import('../app/simulator/simulator-main-partner.js');
    const bucket = await import('../app/simulator/simulator-main-3bucket.js');
    const { setFieldState } = await import('../app/shared/field-state.js');
    const { initInputPersistence } = await import('../app/simulator/simulator-main-input-persist.js');
    const saved = { document: globalThis.document, localStorage: globalThis.localStorage, window: globalThis.window };
    const storageSnapshot = storage => JSON.stringify(Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort().map(key => [key, storage.getItem(key)]));
    const broken = await selectionVariant('value-off');
    const results = {};
    try {
        for (const mode of ['original', 'value-off']) {
            const doc = createSelectionDocument();
            const storage = createLocalStorageMock();
            installBrowserGlobals(doc, storage);
            PersistenceFacade.resetPersistenceRuntimeForTests();
            const bind = mode === 'original' ? syncSelectionText : broken.syncSelectionText;
            const fields = {
                dynamicFlexPreset: 'off', horizonMethod: 'survival_quantile', longevityMode: 'buffer_years',
                p1Geschlecht: 'm', p1KirchensteuerPct: '0', rentAdjMode: 'fix', r2Geschlecht: 'w'
            };
            for (const [id, value] of Object.entries(fields)) addField(doc, id, value, simulatorSelectOptions(id));
            for (const [id, value] of Object.entries({
                horizonYears: '30', survivalQuantile: '0.85', goGoMultiplier: '1',
                longevityQuantileShift: '0.03', longevityRelativePct: '10', longevityBufferYears: '3',
                dynamicFlex: '', dynamicFlexShowAdvanced: '', goGoActive: '',
                rentAdjPct: '2', p1StartAlter: '67', chkPartnerAktiv: '', sectionRente2: '',
                startFloorBedarf: '', simStartVermoegen: '',
                dynamicFlexConfigGroup: '', dynamicFlexAdvancedToggleRow: ''
            })) addField(doc, id, value);
            for (const id of ['dynamicFlex', 'dynamicFlexShowAdvanced', 'goGoActive', 'chkPartnerAktiv']) doc.getElementById(id).type = 'checkbox';
            let events = 0;
            for (const field of doc.querySelectorAll('select[id]')) {
                field.addEventListener('input', () => events++);
                field.addEventListener('change', () => events++);
            }
            storage.setItem('unbeteiligt', 'bytegleich');
            const beforeBind = storageSnapshot(storage);
            doc.querySelectorAll('select[id]').forEach(bind);
            doc.querySelectorAll('select[id]').forEach(bind);
            assertEqual(storageSnapshot(storage), beforeBind, `${mode}: reine Volltextsynchronisierung hält den Speicher bytegleich`);
            assertEqual(events, 0, `${mode}: Bindung erzeugt keine Selectevents`);
            const field = id => doc.getElementById(id);
            const text = id => doc.getElementById(`${id}-fulltext`).textContent;
            const equal = id => strict.equal(text(id), field(id).selectedOptions[0]?.textContent || '', 'Auswahlvolltext entspricht unmittelbar der Auswahl');
            const expectSelection = (ids, oldTexts) => {
                for (const id of ids) {
                    if (mode === 'original') { equal(id); assertEqual(text(id), field(id).selectedOptions[0].textContent, `${id}: sofortige Auswahltextgleichheit`); }
                    else {
                        assertEqual(text(id), oldTexts[id], `${id}: Gegenprobe behält alten Volltext`);
                        strict.throws(() => equal(id), strict.AssertionError);
                        assert(text(id) !== field(id).selectedOptions[0].textContent, `${id}: dieselbe Gleichheitsassertion scheitert bei korrekter neuer Auswahl`);
                    }
                }
            };
            const floorBinding = bindHouseholdPlanField({ doc, field: field('startFloorBedarf'), path: 'floorBedarf' });
            floorBinding.project(10000);
            const applyCombined = new Function('writeBoundHouseholdPlanField', 'syncSelectionText', 'syncDynamicFlexPresetSelection', 'refreshDynamicFlexControls', 'refreshThreeBucketControls', 'resolveHouseholdSimulatorNeed', 'setFieldState', 'refreshRentAdjustmentPresentation', 'refreshPartnerPresentation', `${functionSource('app/simulator/simulator-main-profiles.js', 'applyCombinedInputsToUI')}\nreturn applyCombinedInputsToUI;`)(
                writeBoundHouseholdPlanField,
                bind, dynamic.syncDynamicFlexPresetSelection, dynamic.refreshDynamicFlexControls, bucket.refreshThreeBucketControls,
                (id, value, overrides) => overrides?.[id] ?? value, setFieldState,
                rent.refreshRentAdjustmentPresentation, partner.refreshPartnerPresentation);
            const originalWrite = persistenceStorage.setItem;
            const writes = [];
            persistenceStorage.setItem = (key, value) => { writes.push([key, String(value)]); return originalWrite.call(persistenceStorage, key, value); };
            try {
                const profileIds = ['p1Geschlecht', 'p1KirchensteuerPct', 'rentAdjMode', 'r2Geschlecht'];
                const oldProfiles = Object.fromEntries(profileIds.map(id => [id, text(id)]));
                const beforeProfiles = storageSnapshot(storage);
                applyCombined({ startFloorBedarf: 30600.125, startVermoegen: 123456, geschlecht: 'w', kirchensteuerSatz: 0.09, rentAdjMode: 'wage', rentAdjPct: 3, partner: { geschlecht: 'm' } }, 2, {});
                assertEqual(field('startFloorBedarf').value, '30.600,13 €', `${mode}: setValue projiziert das gebundene Planfeld über den Zahlenadapter`);
                assertEqual(readBoundHouseholdPlanField(field('startFloorBedarf')), 30600.125, `${mode}: Adapterprojektion erhält den kanonischen Wert ohne Anzeigerundung`);
                assertEqual(readBoundHouseholdPlanField(field('simStartVermoegen')), undefined, `${mode}: Vermögensfeld bleibt ungebunden`);
                assertEqual(field('simStartVermoegen').value, 123456, `${mode}: setValue setzt das ungebundene Feld weiterhin direkt über el.value`);
                for (const [id, value] of [['p1Geschlecht', 'w'], ['p1KirchensteuerPct', '9'], ['rentAdjMode', 'wage'], ['r2Geschlecht', 'm']]) assertEqual(field(id).value, value, `${mode}: Profilaggregation setzt ${id}`);
                expectSelection(profileIds, oldProfiles);
                for (const id of ['p1Geschlecht', 'rentAdjMode', 'rentAdjPct', 'chkPartnerAktiv', 'p1StartAlter']) assert(field(id).disabled && field(id).dataset.fieldState === 'adopted', `${mode}: bisherige Profilsperre ${id}`);
                const reasons = (field('rentAdjMode').getAttribute('aria-describedby') || '').split(/\s+/).map(id => doc.getElementById(id)?.textContent || '').join(' ');
                assert(reasons.includes('Lohnentwicklung') && reasons.includes('Haushaltsprofilen'), `${mode}: Rentenmodusgrund passt zur neuen Auswahl`);
                assert(field('chkPartnerAktiv').checked && field('sectionRente2').style.display === 'block', 'Zwei Profile aktivieren die vorhandene Partneransicht');
                assertEqual(storageSnapshot(storage), beforeProfiles, `${mode}: reine UI-Profilübernahme schreibt keinen Speicher`);
                assertEqual(events, 0, `${mode}: Profilübernahme erzeugt keine Selectevents`);
                applyCombined({ geschlecht: 'm', kirchensteuerSatz: 0, rentAdjMode: 'cpi' }, 1, {});
                assert(!field('chkPartnerAktiv').checked && field('chkPartnerAktiv').disabled && field('sectionRente2').style.display === 'none', 'Ein Profil behält Sperre und verbirgt Partneransicht');
                assertEqual(field('r2Geschlecht').value, 'w', 'Ein Profil stellt bisheriges Partnergeschlecht wieder her');
                assertEqual(field('p1KirchensteuerPct').value, '0', 'Ein Profil übernimmt Kirchensteuer weiterhin numerisch');
                if (mode === 'original') profileIds.forEach(id => { equal(id); assertEqual(text(id), field(id).selectedOptions[0].textContent, 'Rückwechsel zeigt aktuelle Auswahl'); });

                dynamic.initDynamicFlexControls();
                // Das betroffene Select erhält weder Ereignis noch Testrefresh.
                const oldPresetTargets = Object.fromEntries(['horizonMethod', 'longevityMode'].map(id => [id, text(id)]));
                field('dynamicFlexPreset').value = 'offensiv';
                const eventsBeforePreset = events;
                field('dynamicFlexPreset').dispatchEvent({ type: 'change' });
                assertEqual(field('horizonMethod').value, 'mean', `${mode}: offensiv setzt tatsächlich mean`);
                assertEqual(field('longevityMode').value, 'none', `${mode}: offensiv setzt Langlebigkeitsmodus none`);
                expectSelection(['horizonMethod', 'longevityMode'], oldPresetTargets);
                assertEqual(events, eventsBeforePreset + 1, 'Nur das echte Preset-change wird zugestellt');
                for (const [id, value] of [['horizonYears', '25'], ['survivalQuantile', '0.75'], ['goGoMultiplier', '1.2']]) assertEqual(String(field(id).value), value, 'Übrige offensive Presetwerte unverändert');
                assert(field('dynamicFlex').checked && field('goGoActive').checked && field('horizonMethod').disabled, 'Offensives Preset behält Flags und Detailsperre');
                field('dynamicFlexShowAdvanced').checked = true;
                field('dynamicFlexShowAdvanced').dispatchEvent({ type: 'change' });
                assert(!field('horizonMethod').disabled && field('horizonYears').dataset.fieldState === 'inactive', 'Detailfreigabe erhält bisherige Sperren und aktuarische Nichtanwendbarkeit');
                const oldCustom = { dynamicFlexPreset: text('dynamicFlexPreset') };
                // In der Gegenprobe wurde der normale Benutzer-change-Refresh
                // am Preset bereits zugestellt, deshalb zeigt es offensiv.
                assertEqual(text('dynamicFlexPreset'), field('dynamicFlexPreset').selectedOptions[0].textContent, 'Vor manueller Änderung steht der Volltext eines anderen Presets');
                const eventsBeforeCustom = events;
                field('horizonYears').value = '26';
                field('horizonYears').dispatchEvent({ type: 'input' });
                assertEqual(field('dynamicFlexPreset').value, 'custom', `${mode}: echter horizonYears-input setzt custom`);
                expectSelection(['dynamicFlexPreset'], oldCustom);
                assertEqual(events, eventsBeforeCustom, 'Customerkennung erzeugt kein Presetevent');
                assertEqual(persistenceStorage.getItem('sim_dynamicFlexPreset'), 'custom', 'Bestehender Speicheraufruf speichert custom');
                assertEqual(persistenceStorage.getItem('sim_horizonYears'), '26', 'Bestehender Speicheraufruf speichert neue Horizontjahre');
                results[mode] = { writes: JSON.stringify(writes), storage: storageSnapshot(storage) };
            } finally { persistenceStorage.setItem = originalWrite; floorBinding.dispose(); }

            if (mode === 'original') {
                persistenceStorage.setItem('sim_p1Geschlecht', 'w');
                persistenceStorage.setItem('sim_rentAdjMode', 'wage');
                persistenceStorage.setItem('sim_horizonMethod', 'survival_quantile');
                persistenceStorage.setItem('sim_longevityMode', 'buffer_years');
                const previousPerson = [field('p1Geschlecht').value, field('rentAdjMode').value];
                initInputPersistence();
                assertEqual(JSON.stringify([field('p1Geschlecht').value, field('rentAdjMode').value]), JSON.stringify(previousPerson), 'Personenwerte werden nicht aus entfernten Simulatorquellen geladen');
                for (const [id, value] of [['horizonMethod', 'survival_quantile'], ['longevityMode', 'buffer_years']]) {
                    assertEqual(field(id).value, value, 'initInputPersistence stellt abweichenden Selectwert wieder her');
                    equal(id); assertEqual(text(id), field(id).selectedOptions[0].textContent, 'Persistenzwiederherstellung synchronisiert sofort');
                }
            }
        }
        assertEqual(results.original.writes, results['value-off'].writes, 'Produktaktionen haben mit und ohne Volltextsynchronisierung identische Speicheraufrufe');
        assertEqual(results.original.storage, results['value-off'].storage, 'Produktaktionen haben identische resultierende Speicherwerte');
    } finally {
        Object.assign(globalThis, saved);
        PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}

function shouldRun() {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const requestedTest = process.argv[2] ? path.resolve(process.argv[2]) : '';
    return entry === __filename
        || (entry.endsWith(`${path.sep}run-single.mjs`) && requestedTest === __filename);
}

if (shouldRun()) {
    try {
        await runSimulatorUiOrchestrationTests();
    } finally {
        PersistenceFacade.resetPersistenceRuntimeForTests();
        Object.entries(previousGlobals).forEach(([key, value]) => {
            if (value === undefined) delete global[key];
            else global[key] = value;
        });
    }
}

// Beide tatsächlichen Persistenzinitialisierer plus Partnerbinder mit erneutem
// Backendlesen nach echten input/change-Ereignissen, einschließlich Altaliases.
{
    const saved = { document: globalThis.document, window: globalThis.window };
    const { LEGACY_PERSON_KEYS } = await import('../app/profile/profile-person-migration.js');
    const { PERSON_VALUE_KEYS } = await import('../app/profile/profile-person-data.js');
    const { initInputPersistence } = await import('../app/simulator/simulator-main-input-persist.js');
    const { initRente2ConfigWithLocalStorage } = await import('../app/simulator/simulator-ui-rente.js');
    const { initPartnerToggle } = await import('../app/simulator/simulator-main-partner.js');
    const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
        profile_rente_monatlich: '1234.567', profile_sparer_pauschbetrag: '0', profile_kirchensteuer_pct: '9' };
    const registry = JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a' }, data: person } } });
    const backend = { ...person, rs_profiles_v1: registry, rs_current_profile: 'a', rs_active_profile: 'a' };
    const nodes = new Map([...new Set([...LEGACY_PERSON_KEYS.map(key => key.slice(4)), 'chkPartnerAktiv', 'sectionRente2'])]
        .map(id => [id, new MockElement(id, 'input')]));
    const doc = { getElementById: id => nodes.get(id) ?? null };
    const adapter = { name: 'synthetische-Personenevents', async open() {}, async loadAll() { return { ...backend }; },
        async saveBatch({ deletes, upserts }) { deletes.forEach(key => delete backend[key]); upserts.forEach(([key, value]) => { backend[key] = value; }); } };
    try {
        globalThis.document = doc; globalThis.window = {};
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        initInputPersistence(); initRente2ConfigWithLocalStorage(); initPartnerToggle();
        for (const node of nodes.values()) {
            node.value = '9999'; node.checked = true;
            node.dispatchEvent({ type: 'input', target: node }); node.dispatchEvent({ type: 'change', target: node });
        }
        await PersistenceFacade.flush(); const durable = await adapter.loadAll();
        assert(LEGACY_PERSON_KEYS.every(key => !Object.hasOwn(durable, key)), 'Echte Personenereignisse erzeugen nach beiden Initialisierern keine alten sim_Personenkeys');
        for (const key of [...Object.values(PERSON_VALUE_KEYS), 'profile_rente_monatlich']) assertEqual(durable[key], person[key], 'Backendread nach Personenereignissen erhält ' + key);
        assertEqual(durable.rs_profiles_v1, registry, 'Personenereignisse verändern keine Registrybytes');
    } finally { PersistenceFacade.resetPersistenceRuntimeForTests(); Object.assign(globalThis, saved); }
}
