import { MockDocument, MockEvent } from './helpers/balance-page-fixture.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageManager } from '../app/balance/balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { BALANCE_UPDATE_DEBOUNCE_MS, ValidationError } from '../app/balance/balance-config.js';
import { initUIRenderer, UIRenderer } from '../app/balance/balance-renderer.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { readBalancePersonStatus } from '../app/shared/person-data-status.js';
import { UIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { RESET_RELOAD_REQUIRED_MESSAGE } from '../app/shared/navigation-guard.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { OVERVIEW_SUMMARY_KEY, readOverviewSummaries } from '../app/overview/overview-storage.js';
import { EXPENSES_STORAGE_KEY } from '../app/balance/balance-expenses-storage.js';
import { balanceStorageFixture, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { captureCashPeople, CASH_KEYS } from '../app/profile/profile-cash-update.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { getBalancePlanTrial, renderBalancePlanTrial } from '../app/balance/balance-plan-trial.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("--- Balance App Smoke Test (No JSDOM) ---");

// Setup Global Context
const localStorageData = new Map([['profile_person_schema_version', '1'], ['profile_aktuelles_alter', '65']]);
const storageWrites = [];
const localStorageMock = {
    getItem: key => localStorageData.get(String(key)) ?? null,
    setItem: (key, value) => {
        localStorageData.set(String(key), String(value));
        storageWrites.push(String(key));
    },
    removeItem: key => localStorageData.delete(String(key)),
    key: index => Array.from(localStorageData.keys())[index] ?? null,
    get length() { return localStorageData.size; }
};

const restoreAnnualLocks = installAnnualLocks();
const savedGlobals = Object.fromEntries(['window', 'document', 'localStorage', 'Event', 'confirm']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;

try {
global.window = {
    addEventListener: () => { },
    localStorage: localStorageMock,
    location: { href: 'http://localhost/' }
};
global.localStorage = localStorageMock; // Explicit global assignment
global.document = new MockDocument();
global.Event = MockEvent;

// Mock EngineAPI
let simulateCallCount = 0;
let engineFailure = null;
const compatibleEngine = {
    getVersion: () => ({ api: "31.0", build: "TEST-BUILD" }),
    getConfig: () => ({
        THRESHOLDS: {
            STRATEGY: { cashRebalanceThreshold: 2500 },
            ALARM: { withdrawalRate: 0.055, realDrawdown: 0.25 },
            CAUTION: { withdrawalRate: 0.045 }
        }
    }),
    simulateSingleYear: (input, lastState) => {
        simulateCallCount++;
        if (engineFailure) throw engineFailure;
        return {
            input,
            newState: {},
            ui: {
                liquiditaet: {
                    deckungVorher: 100,
                    deckungNachher: 110
                },
                depotwertGesamt: 200000 + input.floorBedarf + input.endeVJ,
                neuerBedarf: 30000,
                minGold: 0,
                zielLiquiditaet: 50000,
                runway: { months: 48, status: 'ok' },
                spending: {
                    monatlicheEntnahme: input.floorBedarf / 12,
                    details: { flexRate: 1.0, entnahmequoteDepot: 0.04, realerDepotDrawdown: 0 },
                    kuerzungQuelle: '-'
                },
                market: { szenarioText: 'Normaler Markt' },
                // Legacy support
                output: {
                    liquiditaet: 50000
                },
                action: {
                    type: "test",
                    summary: "Test Action",
                    title: `Test Action Title ${input.floorBedarf}/${input.endeVJ}`,
                    transactionDiagnostics: [],
                    details: {
                        regel: "Test",
                        params: {}
                    },
                    transactions: { verkaufAktien: 0, verkaufGold: 0 },
                    verwendungen: { liquiditaet: 0 }
                },
                diagnosis: { details: [] }
            },
            diagnosis: {
                general: {
                    runwayMonate: 48,
                    runwayStatus: 'ok',
                    marketSzenario: 'Normaler Markt',
                    alarmActive: false,
                    runwayTargetMonate: 60,
                    runwayTargetQuelle: 'User',
                    deckungVorher: 100,
                    deckungNachher: 110
                },
                keyParams: {
                    entnahmequoteDepot: 0.04,
                    realerDepotDrawdown: 0
                },
                details: []
            }
        };
    }
};
global.window.EngineAPI = compatibleEngine;

// Mock console
console.error = (...args) => {
    // Suppress expected errors during init if mocks aren't perfect
    // or log them if critical
    // originalConsoleError(...args);
};
console.info = () => { };

// --- 2. Import Module ---
const modulePath = path.join(rootDir, 'app', 'balance', 'balance-main.js');
const moduleUrl = new URL(`file:///${modulePath.replace(/\\/g, '/')}`).href;

let balanceMain;
try {
    balanceMain = await import(moduleUrl);
} catch (e) {
    originalConsoleError("Failed to import module:", e);
    throw e;
}
// --- 3. Trigger Init ---
console.log("Triggering Application Init via DOMContentLoaded...");

// Pre-fill critical inputs to pass validation in update()
document.getElementById('aktuellesAlter').value = "65";
document.getElementById('floorBedarf').value = "30000";
document.getElementById('flexBedarf').value = "24000";
document.getElementById('minimumFlexAnnual').value = "0";
document.getElementById('rebalancingBand').value = "5";

const loadEvent = new MockEvent('DOMContentLoaded');
document.dispatchEvent(loadEvent);

// Wait for async init
await new Promise(resolve => setTimeout(resolve, 100));

// --- 4. Verify ---

// Verify Engine was called (init calls update())
assertEqual(simulateCallCount, 1, 'EngineAPI.simulateSingleYear should run exactly once during init');

// Verify Footer
const footer = document.getElementById('print-footer');
assert(footer.textContent.includes('Rechenkern 31.0'), `Der Druckfuß nennt „Rechenkern 31.0“ (${footer.textContent})`);
assertEqual(document.engineScript.src, 'engine.js', 'Engine script source should remain stable after handshake');
for (const id of ['fixedIncomeAnnual', 'tagesgeld', 'geldmarktEtf', 'depotwertGesamt', 'goldWert', 'costBasisAlt', 'costBasisNeu', 'goldCost']) {
    const field = document.getElementById(id);
    assertEqual(field.getAttribute('data-field-state'), 'adopted', `${id}: echter Start stellt Profilherkunft dar`);
    const reason = document.getElementById(field.getAttribute('aria-describedby'));
    assert(reason?.textContent.includes('Pflege im') && field.nextSibling === reason,
        `${id}: echter Start verbindet einen sichtbaren Herkunftsgrund mit dem Feld`);
}
for (const id of ['renteAktiv', 'renteMonatlich', 'aktuellesAlter', 'depotwertAlt', 'depotwertNeu']) {
    assert(!document.getElementById(id).hasAttribute('data-field-state'), `${id}: verborgene Brücke bleibt ohne Herkunftsdarstellung`);
}

// --- 5. Test Interaction ---
console.log("Testing Input Change Trigger...");
const visibleToastText = () => document.getElementById('toast-container').children
    .find(child => child.className === 'toast-text')?.textContent || '';
const notification = 'Ausgaben-Check auf 2027 umgestellt. Vermögensstand gesichert.';
UIRenderer.toast(notification);
UIRenderer.clearError();
assertEqual(visibleToastText(), notification, 'Echter Renderer: clearError erhält den Toast');

// Get an input that we served via querySelectorAll
const inputEl = document.getElementById('p1StartAlter');
// Simulate change
inputEl.value = "67";

// Dispatch 'input' event on element
const evt = new MockEvent('input');
evt.target = inputEl;

// bubbling on .form-column which we mapped to 'balanceInputs'
const formCheck = document.getElementById('balanceInputs');
formCheck.dispatchEvent(evt);

// Wait for debounce (300ms)
await new Promise(resolve => setTimeout(resolve, 310));

assertEqual(simulateCallCount, 2, 'Debounced input should trigger exactly one additional engine call');
assertEqual(visibleToastText(), notification, 'Echtes debouncedUpdate erhält den Toast');

// Das echte Formularereignis darf keine eigene persistente Personenquelle
// erzeugen; der Legacyadapter schreibt direkt in diesen injizierten Backendbestand.
await PersistenceFacade.flush();
const savedPersonlessInputs = JSON.parse(localStorageData.get(CONFIG.STORAGE.LS_KEY)).inputs;
const savedPersonlessFields = JSON.parse(localStorageData.get(CONFIG.STORAGE.LS_KEY)).balanceInputFields;
for (const key of ['aktuellesAlter', 'renteMonatlich', 'sonstigeEinkuenfte', 'renteAktiv', 'sparerPauschbetrag', 'kirchensteuerSatz']) {
    assert(!Object.hasOwn(savedPersonlessInputs, key), 'Backendread nach echtem Balanceinput enthält keine eigene Personenkopie ' + key);
    assert(!Object.hasOwn(savedPersonlessFields, key), 'Regulärer Personenpfad speichert keinen Personenrohwert ' + key);
}
assertEqual(localStorageData.get('profile_aktuelles_alter'), '65', 'Balanceinput überschreibt keinen belegten zentralen Altersfallback');

console.log("Testing machine-readable update results and fail-closed persistence...");

const successResult = balanceMain.update({ mode: 'preview' });
if (!successResult.ok || successResult.status !== 'success') {
    throw new Error(`Successful update returned unexpected result: ${JSON.stringify(successResult)}\n${successResult.error?.stack || ''}`);
}
assertEqual(visibleToastText(), notification, 'Echtes erfolgreiches update erhält den Toast');
await successResult.overviewPersistence;

const assertMinimumFlexReject = (rawValue, expectedMessages) => {
    assert(getBalancePlanTrial(document).start(), 'Ungültigen Mindest-Flex ausdrücklich im flüchtigen Versuch prüfen');
    const input = document.getElementById('minimumFlexAnnual');
    input.value = rawValue;
    const validationCallsBefore = simulateCallCount;
    const writesBeforeValidation = storageWrites.length;
    const validationResult = balanceMain.update();
    assert(
        !validationResult.ok && validationResult.status === 'validation_error',
        `Invalid minimum flex ${rawValue || '<leer>'} should return validation_error`
    );
    assertEqual(simulateCallCount, validationCallsBefore, `Invalid minimum flex ${rawValue || '<leer>'} should not call the engine`);
    assertEqual(storageWrites.length, writesBeforeValidation, `Invalid minimum flex ${rawValue || '<leer>'} should not persist data`);
    assertEqual(input.value, rawValue, `Invalid minimum flex ${rawValue || '<leer>'} should remain visible without clamping`);
    const messages = validationResult.error?.errors?.map(entry => entry.message) || [];
    expectedMessages.forEach(message => {
        assert(messages.includes(message), `Invalid minimum flex ${rawValue || '<leer>'} should include message: ${message}`);
    });
    assert(
        document.getElementById('error-container').textContent.includes('Einige Eingaben sind ungültig'),
        'Validation error should use the normal UI error path'
    );
};

assertMinimumFlexReject('-1', ['Mindest-Flex p.a. darf nicht negativ sein.']);
assertMinimumFlexReject('', ['Mindest-Flex p.a. darf nicht leer sein.']);
assertMinimumFlexReject('Infinity', ['Mindest-Flex p.a. muss eine endliche Zahl sein.']);
assertMinimumFlexReject('24001', [
    'Mindest-Flex p.a. darf nicht größer als Flex-Bedarf p.a. sein.',
    'Flex-Bedarf p.a. ist die Obergrenze für Mindest-Flex.'
]);
assertEqual(visibleToastText(), notification, 'Echtes Validierungsfehler-update erhält den Toast');
document.getElementById('minimumFlexAnnual').value = '0';
UIRenderer.handleActionError(new Error('Unabhängige Aktion'), 'expenses-import');
const corrected = balanceMain.update();
assert(corrected.ok, 'Korrigierte Eingaben führen zum erfolgreichen echten Update: ' + corrected.error?.message);
await corrected.overviewPersistence;
assertEqual(document.getElementById('error-container').textContent, '', 'Echtes Update beseitigt Berechnungsfehler und Liste');
assert(!document.getElementById('minimumFlexAnnual').classList.contains('input-error'), 'Echtes Update entfernt Feldmarkierungen');
assertEqual(visibleToastText(), notification, 'Korrektur erhält gleichzeitigen Toast');
assert(document.getElementById('action-error-container').textContent.includes('Unabhängige Aktion'), 'Korrektur erhält Aktionsfehler');

engineFailure = new Error('Simulierter Engine-Fehler');
const engineResult = balanceMain.update();
assert(!engineResult.ok && engineResult.status === 'engine_error', 'Engine failures should return engine_error');
assert(
    document.getElementById('error-container').textContent.includes('Simulierter Engine-Fehler'),
    'Engine error should use the normal UI error path'
);
assertEqual(visibleToastText(), notification, 'Enginefehler und Toast bleiben gleichzeitig sichtbar');
engineFailure = null;
getBalancePlanTrial(document).reset();
UIReader.applyHouseholdPlanInputs();

// Reale Import-/Snapshot-/Annualhandler mit echtem Renderer und Main-Debounce.
const actionContainer = document.getElementById('action-error-container');
const scopedEntry = scope => actionContainer.children.find(entry => entry.dataset.scope === scope);
const actionText = scope => scopedEntry(scope)?.children[0].textContent || '';
// Manueller Abschluss mit echtem Main: kein Engineaufruf, Write oder entprelltes Update.
{
    UIRenderer.handleActionError(new Error('Fokusprüfung A'), 'focus-a');
    UIRenderer.handleActionError(new Error('Fokusprüfung B'), 'focus-b');
    const first = scopedEntry('focus-a');
    const second = scopedEntry('focus-b');
    // Writes des vorangegangenen echten Updates vor der Messung abschließen.
    await PersistenceFacade.flush();
    const callsBefore = simulateCallCount;
    const writesBefore = storageWrites.length;
    assertEqual(first.children[1].getAttribute('aria-label'), 'Fehlermeldung schließen', 'Echter Renderer verwendet den exakten zugänglichen Namen');
    assertEqual(first.children[1].getAttribute('aria-describedby'), first.children[0].id, 'Echter Renderer beschreibt den Knopf mit dem eigenen Fehlertext');
    first.children[1].focus();
    first.children[1].dispatchEvent(new MockEvent('click'));
    assertEqual(document.activeElement, second.children[1], 'Schließen fokussiert den nächsten echten Meldungsknopf');
    second.children[1].dispatchEvent(new MockEvent('click'));
    assertEqual(document.activeElement, scopedEntry('expenses-import').children[1], 'Schließen am Listenende fokussiert den verbleibenden Knopf');
    scopedEntry('expenses-import').children[1].dispatchEvent(new MockEvent('click'));
    assertEqual(document.activeElement, document.getElementById('openDiagnosisBtn'), 'Letzte echte Meldung fokussiert Diagnose');
    await new Promise(resolve => setTimeout(resolve, BALANCE_UPDATE_DEBOUNCE_MS + 50));
    assertEqual(simulateCallCount, callsBefore, 'Schließen löst auch verzögert keine Berechnung aus');
    assertEqual(storageWrites.length, writesBefore, 'Schließen löst keinen Speicherwrite aus');
    UIRenderer.handleActionError(new Error('Unabhängige Aktion'), 'expenses-import');
}
// Die entfernte Sicherungskarte besitzt auch im echten Main keinen Ersatzknopf.
assertEqual(document.getElementById('connectFolderBtn'), null, 'Balance bindet keinen entfernten Ordnerknopf');
assertEqual(document.getElementById('snapshot-management'), null, 'Balance enthält keine versteckte Sicherungskarte');

// Bereits vorgemerkte Writes des vorigen echten Updates zuerst abschließen.
await PersistenceFacade.flush();
assert(getBalancePlanTrial(document).start(), 'Dateieventprobe nutzt einen ausdrücklichen Planversuch');
document.getElementById('minimumFlexAnnual').value = '-1';
balanceMain.update({ mode: 'preview' });
const fileEventError = document.getElementById('error-container').textContent;
const callsBeforeFiles = simulateCallCount;
const writesBeforeFiles = storageWrites.length;
const originalClearError = UIRenderer.clearError;
let fileEventClears = 0;
UIRenderer.clearError = (...args) => { fileEventClears++; return originalClearError.apply(UIRenderer, args); };
try {
for (const id of ['syntheticFileInput']) {
    const fileInput = document.getElementById(id);
    fileInput.type = 'file';
    formCheck.dispatchEvent({ type: 'input', target: fileInput });
    formCheck.dispatchEvent({ type: 'change', target: fileInput });
}
await new Promise(resolve => setTimeout(resolve, 310));
assertEqual(simulateCallCount, callsBeforeFiles, 'Reale Main-/Formbindung berechnet für sämtliche Dateievents exakt null Mal');
assertEqual(storageWrites.length, writesBeforeFiles, 'Dateievents schreiben nicht im Hintergrund');
assertEqual(fileEventClears, 0, 'Dateievents rufen clearError exakt null Mal auf');
assertEqual(document.getElementById('error-container').textContent, fileEventError, 'Dateievents erhalten den Berechnungsfehler');
assert(document.getElementById('minimumFlexAnnual').classList.contains('input-error'), 'Dateievents erhalten die Feldmarkierung');
} finally { UIRenderer.clearError = originalClearError; }
document.getElementById('minimumFlexAnnual').value = '0';
getBalancePlanTrial(document).reset();
UIReader.applyHouseholdPlanInputs();
await balanceMain.update({ mode: 'preview' }).overviewPersistence;

const previousRestore = StorageManager.restoreSnapshot;
try {
    // AK-1: Der Balance-Import ist entfallen; ein Kopierfehler vertritt den ersten Aktionsbereich.
    UIRenderer.handleActionError(new Error('Synthetischer Kopierfehler'), 'copyAction');
    const copyText = actionText('copyAction');
    assert(copyText.includes('Synthetischer Kopierfehler'), 'Aktionsfehler wird im eigenen Bereich angezeigt');
    formCheck.dispatchEvent({ type: 'input', target: inputEl });
    await new Promise(resolve => setTimeout(resolve, 310));
    assertEqual(actionText('copyAction'), copyText, 'Aktionsfehler überlebt den echten Main-Debounce');

    let confirmed = false;
    const oldConfirm = globalThis.confirm;
    const annualSourceExpenses = persistenceStorage.getItem(EXPENSES_STORAGE_KEY);
    globalThis.confirm = () => confirmed;
    try {
        // Der Fehlerkanaltest braucht einen fälligen Legacy-Abschluss, keinen
        // Erststart ohne Vorjahresbelege. Die echte Planungsregel bleibt aktiv.
        persistenceStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify({ version: 1, activeYear: 2025,
            years: { 2025: { months: { 6: { profiles: {
                [persistenceStorage.getItem('rs_current_profile')]: { categories: { total: 100 } }
            } } } } } }));
        UIRenderer.handleActionError(new Error('Vorheriger Snapshotfehler'), 'snapshots');
        const snapshotText = actionText('snapshots');
        // Der echte Toastablauf und vorgemerkte Updates sind vor der Messung abgeschlossen.
        await balanceMain.update({ mode: 'preview' }).overviewPersistence;
        await new Promise(resolve => setTimeout(resolve, 6100));
        const callsBeforeClose = simulateCallCount;
        const writesBeforeClose = storageWrites.length;
        const loadStateBeforeClose = StorageManager.loadState;
        const getItemBeforeClose = localStorageMock.getItem;
        let storageReads = 0;
        StorageManager.loadState = (...args) => { storageReads++; return loadStateBeforeClose(...args); };
        localStorageMock.getItem = (...args) => { storageReads++; return getItemBeforeClose(...args); };
        try {
            const entriesBeforeClose = actionContainer.children;
            const closingEntry = scopedEntry('copyAction');
            const expectedFocus = entriesBeforeClose[entriesBeforeClose.indexOf(closingEntry) + 1].children[1];
            closingEntry.children[1].focus();
            scopedEntry('copyAction').children[1].dispatchEvent({ type: 'click' });
            assertEqual(document.activeElement, expectedFocus, 'Aktionsfehler übergibt beim Schließen Fokus an den nächsten Bereich');
            await new Promise(resolve => setTimeout(resolve, 310));
            assertEqual(storageReads, 0, 'Schließen greift auch lesend nicht auf den Speicher zu');
        } finally {
            StorageManager.loadState = loadStateBeforeClose;
            localStorageMock.getItem = getItemBeforeClose;
        }
        assertEqual(actionText('copyAction'), '', 'Echter Schließenknopf entfernt seinen Fehler');
        assertEqual(actionText('snapshots'), snapshotText, 'Schließen erhält anderen Bereich');
        await new Promise(resolve => setTimeout(resolve, 310));
        assertEqual(simulateCallCount, callsBeforeClose, 'Schließen verursacht weder direkte noch entprellte Berechnung');
        assertEqual(storageWrites.length, writesBeforeClose, 'Schließen verursacht keinen Speicherzugriff');
    } finally {
        if (annualSourceExpenses === null) persistenceStorage.removeItem(EXPENSES_STORAGE_KEY);
        else persistenceStorage.setItem(EXPENSES_STORAGE_KEY, annualSourceExpenses);
        if (oldConfirm === undefined) delete globalThis.confirm;
        else globalThis.confirm = oldConfirm;
    }
} finally {
    StorageManager.restoreSnapshot = previousRestore;
}

// VS-2: Balance hat weder Matriximport noch Vermögenserfassung nach einem Ausgabenimport.
console.log('VS-2: kein Ausgabenimport und keine Vermögenserfassung in Balance');
{
    assertEqual(document.getElementById('expensesTable'), null, 'Balance hat keinen verbliebenen Matriximport');
    assertEqual(document.getElementById('expensesCsvInput'), null, 'Balance hat keinen versteckten Ausgaben-Dateieingang');
    assertEqual(typeof UIBinder.handleExpensesImported, 'undefined', 'Balance erfasst nach einem Ausgabenimport keinen Vermögensstand');
}

console.log('Regression R-01/R-02: gültige Formularkorrektur und editierbare Demo-Personenwerte');
{
    const recordsBefore = PersistenceFacade.exportAllSync().records;
    const formBefore = Object.fromEntries(Object.entries(document.elements).map(([id, field]) =>
        [id, { value: field.value, checked: field.checked }]));
    const planSourceBefore = UIReader.planFormSource;
    try {
        const initialInputs = UIReader.readAllInputs();
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        const profile = structuredClone(Object.values(registry.profiles)[0]);
        // Demobetrieb gilt nur für den Platzhalter „Default“ der Erstinstallation (DP-1).
        profile.meta = { ...profile.meta, id: 'default', name: 'Default', belongsToHousehold: true };
        profile.data = {};
        for (const key of Object.keys(recordsBefore)) persistenceStorage.removeItem(key);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify({ ...registry, profiles: { default: profile } }));
        persistenceStorage.setItem('rs_current_profile', 'default');
        persistenceStorage.setItem('rs_active_profile', 'default');
        persistenceStorage.setItem(CONFIG.STORAGE.MIGRATION_FLAG, 'true');
        // Beim Wechsel zum unbestätigten Demo-Bestand auch die numerischen
        // Planbindungen wie beim produktiven UI-Refresh zurücknehmen.
        renderBalancePlanTrial(document, { project: true });
        const state = { inputs: { ...initialInputs, aktuellesAlter: 65, renteMonatlich: 1000, sparerPauschbetrag: 1000 },
            lastState: { taxState: { lossCarry: 1234 }, marker: 'historische Basis' } };
        persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
        UIReader.planFormSource = null;
        assertEqual(readBalancePersonStatus().status, 'demo', 'Fixture nutzt ausdrücklich den Demo-Personenpfad');
        for (const [id, value] of Object.entries({ aktuellesAlter: '67', renteMonatlich: '1.234,56',
            sparerPauschbetrag: '1.100', kirchensteuerSatz: '0.09', minimumFlexAnnual: '7.500',
            floorBedarf: '30.000', flexBedarf: '24.000', flexBudgetAnnual: '7.000', flexBudgetRecharge: '5.000' })) {
            document.getElementById(id).value = value;
        }
        delete window.__profilverbundTranchenOverride;
        delete window.__profilverbundPersonSPB;
        const oracle = JSON.stringify(UIReader.readAllInputs());
        for (const badState of [
            { ...state, balanceInputFields: { minimumFlexAnnual: { value: '24001', checked: false } } },
            { ...state, balanceInputFields: { flexBudgetRecharge: { value: 'defekt', checked: false } } },
            { ...state, inputs: { ...state.inputs, renteMonatlich: 'defekt' } }
        ]) {
            persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(badState));
            let storedError;
            try { buildBalanceEngineInputFromStorage({ storage: persistenceStorage }); } catch (error) { storedError = error; }
            assert(storedError instanceof ValidationError, 'Der unkorrigierte Altstand verletzt nachweislich den Eingabevertrag');
            const result = balanceMain.update({ mode: 'persist_inputs' });
            await result.overviewPersistence;
            assertEqual(result.ok, true, 'Gültiges Formular korrigiert den ungültigen gespeicherten Altstand');
            const built = buildBalanceEngineInputFromStorage({ storage: persistenceStorage });
            assertEqual(JSON.stringify(built.readerInputData), oracle, 'Demo-Reader bleibt vollständig bytegleich zum DOM-Orakel');
            for (const [id, expected] of Object.entries({ aktuellesAlter: 67, renteMonatlich: 1234.56, sparerPauschbetrag: 1100,
                kirchensteuerSatz: 0.09, minimumFlexAnnual: 7500, flexBudgetAnnual: 7000, flexBudgetRecharge: 5000 })) {
                assertEqual(result.modelResult.input[id], expected, `${id}: korrigierter Wert erreicht den tatsächlichen Engine-Aufruf`);
                assertEqual(built.inputData[id], expected, `${id}: korrigierter Wert ist aus dem Speicher rekonstruierbar`);
                assertEqual(built.persistentState.balanceInputFields[id].value, document.getElementById(id).value,
                    `${id}: Formularrohwert liegt im bestehenden Speicherbesitzer`);
            }
            assertEqual(JSON.stringify(built.persistentState.lastState), JSON.stringify(state.lastState), 'Eingabebestätigung schreibt keinen Engine-Neustate');
        }
        const stateBeforePreview = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const profileFinancialRecords = () => Object.fromEntries(Object.entries(
            JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles.default.data)
            .filter(([key]) => key !== OVERVIEW_SUMMARY_KEY));
        const registryBeforePreview = JSON.stringify(profileFinancialRecords());
        document.getElementById('aktuellesAlter').value = '68';
        const preview = balanceMain.update({ mode: 'preview' });
        await preview.overviewPersistence;
        assertEqual(preview.ok, true, 'Demo-Vorschau mit weiterem Formularentwurf bleibt erfolgreich');
        assertEqual(preview.inputData.aktuellesAlter, 68, 'Demo-Vorschau verwendet den isolierten Personenentwurf');
        assertEqual(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY), stateBeforePreview, 'PREVIEW erhält fachlichen Balance-State bytegleich');
        assertEqual(JSON.stringify(profileFinancialRecords()), registryBeforePreview, 'PREVIEW erhält fachliche Profilrecords bytegleich');
        assertEqual(persistenceStorage.getItem('household_plan_v1'), null, 'PREVIEW erzeugt keinen H1-Plan');
    } finally {
        for (const key of Object.keys(PersistenceFacade.exportAllSync().records)) persistenceStorage.removeItem(key);
        for (const [key, value] of Object.entries(recordsBefore)) persistenceStorage.setItem(key, value);
        for (const [id, values] of Object.entries(formBefore)) Object.assign(document.elements[id], values);
        UIReader.planFormSource = planSourceBefore;
        UIReader.applyHouseholdPlanInputs();
        await PersistenceFacade.flush();
    }
}

// Echter Main-Start mit Altlink: nach Bereitschaft ohne Engine-/Plan-/Ausgabenwrite ersetzen.
{
    const oldLocation = window.location, oldName = window.name;
    const before = Object.fromEntries(['household_plan_v1', 'annual_plan_record_v1', EXPENSES_STORAGE_KEY, CONFIG.STORAGE.LS_KEY].map(key => [key, persistenceStorage.getItem(key)]));
    const calls = simulateCallCount;
    let destination = null;
    try {
        window.location = { hash: '#ausgaben-import', search: '?year=2025&month=3', href: 'http://localhost/Balance.html?year=2025&month=3#ausgaben-import',
            replace(href) { destination = href; } };
        const result = await balanceMain.init();
        assertEqual(result.reason, 'expenses_navigation', 'Echter initialer Altlink endet vor Balanceinitialisierung');
        assertEqual(destination, 'Ausgaben.html?year=2025&month=3#ausgaben-import', 'Echter Altlink ersetzt die historische URL');
        assertEqual(simulateCallCount, calls, 'Initialer Altlink startet exakt keine Balanceberechnung');
        for (const [key, raw] of Object.entries(before)) assertEqual(persistenceStorage.getItem(key), raw, 'Initialer Altlink erhält Fachrecord: ' + key);
    } finally { window.location = oldLocation; window.name = oldName; }
}

let incompatibleCalls = 0;
global.window.EngineAPI = {
    getVersion: () => ({ api: '30.9', build: 'OLD-BUILD' }),
    simulateSingleYear: () => {
        incompatibleCalls++;
        return {};
    }
};
const writesBeforeBlocked = storageWrites.length;
const blockedResult = balanceMain.update();
assert(
    !blockedResult.ok && blockedResult.status === 'blocked' && blockedResult.reason === 'contract_changed',
    'Incompatible engine should return the contract_changed block reason'
);
assertEqual(incompatibleCalls, 0, 'Incompatible EngineAPI should not execute simulateSingleYear');
assertEqual(storageWrites.length, writesBeforeBlocked, 'Blocked engine update should not persist Balance or profile state');

delete global.window.EngineAPI;
const missingResult = balanceMain.update();
assert(!missingResult.ok && missingResult.status === 'blocked', 'Missing engine should block the update');
assertEqual(storageWrites.length, writesBeforeBlocked, 'Missing engine update should not persist Balance or profile state');

global.window.EngineAPI = compatibleEngine;

console.log("✅ Balance App Smoke Test Completed Successfully.");

} finally {
    restoreAnnualLocks();
    // Beendet den echten Toasttimer auch bei fehlgeschlagenen Assertions.
    initUIRenderer(null, null);
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
    for (const [key, descriptor] of Object.entries(savedGlobals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
}
