import { MockDocument, MockEvent } from './helpers/balance-page-fixture.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImportExportHandlers, createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { createSnapshotHandlers } from '../app/balance/balance-binder-snapshots.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { BALANCE_UPDATE_DEBOUNCE_MS, ValidationError } from '../app/balance/balance-config.js';
import { initUIRenderer, UIRenderer } from '../app/balance/balance-renderer.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { readBalancePersonStatus } from '../app/shared/person-data-status.js';
import { createBalanceWealthHistoryService } from '../app/balance/balance-wealth-history.js';
import { createExpensesWealthCaptureController } from '../app/balance/balance-expenses-wealth-capture.js';
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

// Wait for async init (StorageManager.initSnapshots is async promise chain)
await new Promise(resolve => setTimeout(resolve, 100));

// --- 4. Verify ---

// Verify Engine was called (init calls update())
assertEqual(simulateCallCount, 1, 'EngineAPI.simulateSingleYear should run exactly once during init');

// Verify Footer
const footer = document.getElementById('print-footer');
assert(footer.textContent.includes("Engine 31.0"), `Footer should expose Engine 31.0, got '${footer.textContent}'`);
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
// Picker-, Berechtigungs- und Handlefehler werden am zentralen Dienst in
// data-exchange.test.mjs sowie den unveränderten Fachfällen in
// balance-ui-orchestration.test.mjs geprüft.
const inputRefs = Object.fromEntries(document.querySelectorAll('input, select').map(el => [el.id, el]));
const handlerDom = { inputs: inputRefs, outputs: { snapshotList: document.getElementById('snapshotList') },
    controls: {}, expenses: {} };
const imports = createImportExportHandlers({ dom: handlerDom, update: balanceMain.update, debouncedUpdate: () => formCheck.dispatchEvent({ type: 'input', target: inputEl }) });
const importFile = document.getElementById('importFile');
importFile.files = [{ text: async () => '{kein-json' }];
await imports.handleImport({ target: importFile });
const rejectedText = actionText('balance-import');
assert(rejectedText.includes('kein gültiges JSON'), 'Realer Importhandler rendert sichere Ablehnung');
assert(rejectedText.includes('unveränderte Balance-Exportdatei'), 'Ablehnung behält Handlungsoption');
UIRenderer.clearError();
await balanceMain.update({ mode: 'preview' }).overviewPersistence;
formCheck.dispatchEvent({ type: 'input', target: inputEl });
await new Promise(resolve => setTimeout(resolve, 310));
assertEqual(actionText('balance-import'), rejectedText, 'Ablehnung überlebt clearError und echte direkte/entprellte Updates');
importFile.files = [];
await imports.handleImport({ target: importFile });
assertEqual(actionText('balance-import'), rejectedText, 'Leere Dateiauswahl löscht den vorherigen Fehler nicht');

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
for (const id of ['importFile']) {
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

// Beobachtbare Ergebnisse des echten Renderers mit echten Main-Updates.
const readResults = () => ({
    depot: document.getElementById('displayDepotwert').textContent,
    withdrawal: document.getElementById('monatlicheEntnahme').textContent,
    action: document.getElementById('handlungsanweisung').children.find(el => el.id === 'handlungContent')?.textContent
});
const regressionReplace = StorageManager.replaceStateFromImport;
const regressionRollback = StorageManager.rollbackImportReplace;
const regressionRead = UIReader.captureStorageDraft;
const regressionActionError = UIRenderer.handleActionError;
// Diese Rückkehrmatrix prüft den weiter unterstützten Legacy-Import ohne H1-Plan.
// Bestätigte Planfelder sind außerhalb eines Versuchs keine Formulareingaben.
const regressionState = StorageManager.loadState();
const regressionPlan = persistenceStorage.getItem('household_plan_v1');
const regressionInputs = UIReader.readAllInputs();
persistenceStorage.removeItem('household_plan_v1');
renderBalancePlanTrial(document, { project: true });
StorageManager.saveState({ ...regressionState, inputs: { ...regressionState.inputs, ...regressionInputs } });
await PersistenceFacade.flush();
try {
    const originalState = JSON.stringify(StorageManager.loadState());
    const baselineFields = Object.fromEntries(Object.entries(handlerDom.inputs).map(([id, el]) => [id, el.value]));
    const baseline = readResults();
    const foreignActionError = actionText('expenses-import');
    const differentDoc = createBalanceExportDocument(StorageManager.loadState());
    differentDoc.payload.inputs.floorBedarf += 17000;
    differentDoc.payload.inputs.endeVJ = 432;
    for (const failure of ['dry', 'replace', 'final', 'preview']) {
        let updates = 0;
        let replacements = 0;
        let rollbacks = 0;
        const modes = [];
        const summaryWrites = [];
        await PersistenceFacade.flush();
        const writesBefore = storageWrites.length;
        const recordsBefore = new Map(localStorageData);
        StorageManager.replaceStateFromImport = async () => {
            replacements++;
            assert(JSON.stringify(readResults()) !== JSON.stringify(baseline), `${failure}: echte Dry-Run-Ergebnisse unterscheiden sich von der Baseline`);
            assertEqual(localStorageData.get(OVERVIEW_SUMMARY_KEY), recordsBefore.get(OVERVIEW_SUMMARY_KEY), `${failure}: Kandidatenvorschau ersetzt keinen gespeicherten Plan`);
            if (failure === 'replace') throw new Error('Synthetischer Replacefehler');
            document.getElementById('minimumFlexAnnual').value = '-1';
            return { recoverySnapshotId: 'renderer-recovery' };
        };
        StorageManager.rollbackImportReplace = async () => { rollbacks++; };
        UIRenderer.handleActionError = function (error, scope) {
            assertEqual(document.getElementById('error-container').textContent, '', `${failure}: Importdaten-Berechnungsfehler ist vor Aktionsfehler entfernt`);
            assert(!document.getElementById('minimumFlexAnnual').classList.contains('input-error'), `${failure}: verworfene Feldmarkierung ist entfernt`);
            if (failure !== 'preview') assertEqual(JSON.stringify(readResults()), JSON.stringify(baseline), `${failure}: KPI und Handlungsanweisung vor Aktionsfehler wiederhergestellt`);
            return regressionActionError.call(this, error, scope);
        };
        if (failure === 'dry') UIReader.captureStorageDraft = () => {
            UIReader.captureStorageDraft = regressionRead;
            const data = regressionRead.call(UIReader);
            data.calculation.inputData.minimumFlexAnnual = -1;
            return data;
        };
        const handlers = createImportExportHandlers({ dom: handlerDom, update: options => {
            updates++;
            modes.push(options.mode);
            if (failure === 'preview' && updates === 3) throw new Error('Synthetischer Wiederherstellungsvorschaufehler');
            const result = balanceMain.update(options);
            if (result.overviewPersistence) summaryWrites.push(result.overviewPersistence);
            if (!result.ok) assert(document.getElementById('minimumFlexAnnual').classList.contains('input-error'), `${failure}: echter Main-Pfad markiert abgelehnte Eingaben`);
            return result;
        }, debouncedUpdate: () => {} });
        importFile.files = [{ text: async () => JSON.stringify(differentDoc) }];
        await handlers.handleImport({ target: importFile });
        await Promise.all(summaryWrites);
        await PersistenceFacade.flush();
        assertEqual(modes.join(','), ['final', 'preview'].includes(failure) ? 'preview,persist_inputs,preview' : 'preview,preview', `${failure}: ausschließlich PREVIEW zur Wiederherstellung`);
        assertEqual(replacements, failure === 'dry' ? 0 : 1, `${failure}: echte Handler-Replaceversuche`);
        assertEqual(rollbacks, ['final', 'preview'].includes(failure) ? 1 : 0, `${failure}: echte Handler-Rollbackversuche`);
        assertEqual(JSON.stringify(StorageManager.loadState()), originalState, `${failure}: persistierter Ausgangsstand erhalten`);
        const previewWrites = storageWrites.slice(writesBefore);
        assert(previewWrites.every(key => [OVERVIEW_SUMMARY_KEY, 'rs_profiles_v1'].includes(key)), `${failure}: Vorschau schreibt ausschließlich die Plananzeige und ihre Registrykopie`);
        const withoutSummary = raw => {
            const registry = JSON.parse(raw);
            for (const profile of Object.values(registry.profiles)) delete profile.data[OVERVIEW_SUMMARY_KEY];
            return JSON.stringify(registry);
        };
        for (const key of new Set([...recordsBefore.keys(), ...localStorageData.keys()])) {
            if (key === OVERVIEW_SUMMARY_KEY) continue;
            assertEqual(key === 'rs_profiles_v1' ? withoutSummary(localStorageData.get(key)) : localStorageData.get(key),
                key === 'rs_profiles_v1' ? withoutSummary(recordsBefore.get(key)) : recordsBefore.get(key),
                `${failure}: ${key} bleibt bis auf den neuen Anzeigeeintrag bytegleich`);
        }
        const confirmedSummaryWrites = (await Promise.all(summaryWrites)).filter(Boolean).length;
        if (confirmedSummaryWrites) {
            assert(previewWrites.includes(OVERVIEW_SUMMARY_KEY), `${failure}: erfolgreiche Vorschau bestätigt tatsächlich eine Summary`);
            const entries = Object.values(readOverviewSummaries(localStorageData.get(OVERVIEW_SUMMARY_KEY)));
            assert(entries.length > 0 && entries.every(entry => entry.status === 'vorläufig'), `${failure}: Vorschau macht den Plan nicht fest`);
        }
        if (failure === 'preview') {
            assertEqual(confirmedSummaryWrites, 0, 'Gescheiterte Wiederherstellungsvorschau bestätigt keine Summary');
            assertEqual(localStorageData.get(OVERVIEW_SUMMARY_KEY), recordsBefore.get(OVERVIEW_SUMMARY_KEY), 'Gescheiterte Wiederherstellungsvorschau erhält Summary bytegleich');
            assertEqual(localStorageData.get('rs_profiles_v1'), recordsBefore.get('rs_profiles_v1'), 'Gescheiterte Wiederherstellungsvorschau erhält auch die Summary im Profilverbund bytegleich');
        }
        for (const id of ['floorBedarf', 'endeVJ', 'minimumFlexAnnual']) assertEqual(handlerDom.inputs[id].value, baselineFields[id], `${failure}: ${id} zurückgesetzt`);
        assert(actionText('balance-import').includes(failure === 'dry' ? 'Engine-Prüfung' : failure === 'replace' ? 'nicht sicher abgeschlossen' : 'automatisch wiederhergestellt'), `${failure}: ursprünglicher Importaktionsfehler sichtbar`);
        assertEqual(actionText('expenses-import'), foreignActionError, `${failure}: fremder Aktionsfehler bleibt bestehen`);
        await balanceMain.update({ mode: 'preview' }).overviewPersistence;
    }

    UIRenderer.handleActionError = regressionActionError;
    document.getElementById('minimumFlexAnnual').value = '-1';
    await PersistenceFacade.flush();
    const summaryBeforeInvalidBaseline = localStorageData.get(OVERVIEW_SUMMARY_KEY);
    const registryBeforeInvalidBaseline = localStorageData.get('rs_profiles_v1');
    let invalidBaselineRollbacks = 0;
    StorageManager.replaceStateFromImport = async () => {
        assertEqual(localStorageData.get(OVERVIEW_SUMMARY_KEY), summaryBeforeInvalidBaseline, 'Gültiger Importkandidat ersetzt bei ungültigem Ausgangsstand keine Summary');
        document.getElementById('minimumFlexAnnual').value = '-1';
        return { recoverySnapshotId: 'invalid-baseline-recovery' };
    };
    StorageManager.rollbackImportReplace = async () => { invalidBaselineRollbacks++; };
    importFile.files = [{ text: async () => JSON.stringify(differentDoc) }];
    await imports.handleImport({ target: importFile });
    await PersistenceFacade.flush();
    assertEqual(invalidBaselineRollbacks, 1, 'Gültiger Kandidat führt beim späten Fehler zum Rollback auf den ungültigen Ausgangsstand');
    assertEqual(localStorageData.get(OVERVIEW_SUMMARY_KEY), summaryBeforeInvalidBaseline, 'Ungültiger wiederhergestellter Ausgangsstand erhält Summary bytegleich');
    assertEqual(localStorageData.get('rs_profiles_v1'), registryBeforeInvalidBaseline, 'Ungültiger wiederhergestellter Ausgangsstand erhält Summary in der Registry bytegleich');
    assert(document.getElementById('error-container').textContent.includes('Einige Eingaben sind ungültig'), 'Ein echter Fehler des wiederhergestellten Standes bleibt nach der Vorschau sichtbar');
    assert(document.getElementById('minimumFlexAnnual').classList.contains('input-error'), 'Ungültiger Ausgangsstand erhält seine eigene neue Feldmarkierung');
    document.getElementById('minimumFlexAnnual').value = '0';
    await balanceMain.update({ mode: 'preview' }).overviewPersistence;
} finally {
    StorageManager.replaceStateFromImport = regressionReplace;
    StorageManager.rollbackImportReplace = regressionRollback;
    UIReader.captureStorageDraft = regressionRead;
    UIRenderer.handleActionError = regressionActionError;
    StorageManager.saveState(regressionState);
    persistenceStorage.setItem('household_plan_v1', regressionPlan);
    UIReader.applyHouseholdPlanInputs();
    await PersistenceFacade.flush();
}

const exportDoc = createBalanceExportDocument(StorageManager.loadState());
const previousReplace = StorageManager.replaceStateFromImport;
const previousRollback = StorageManager.rollbackImportReplace;
const previousRestore = StorageManager.restoreSnapshot;
let replaceCalls = 0;
let rollbackCalls = 0;
try {
    StorageManager.replaceStateFromImport = async () => {
        replaceCalls++;
        assertEqual(actionText('balance-import'), '', 'Neuer Import entfernt seinen alten Fehler vor der Arbeit');
        engineFailure = new Error('Synthetischer UI-Fehler nach Replace');
        return { recoverySnapshotId: 'synthetischer-recovery' };
    };
    StorageManager.rollbackImportReplace = async receipt => {
        assertEqual(receipt.recoverySnapshotId, 'synthetischer-recovery', 'Rollback erhält den bestätigten Recoverypunkt');
        rollbackCalls++;
        engineFailure = null;
    };
    importFile.files = [{ text: async () => JSON.stringify(exportDoc) }];
    await imports.handleImport({ target: importFile });
    const rollbackText = actionText('balance-import');
    assertEqual(replaceCalls, 1, 'Realer Import führt genau ein Replace aus');
    assertEqual(rollbackCalls, 1, 'Realer Import führt genau einen Rollback aus');
    assert(rollbackText.includes('automatisch wiederhergestellt'), 'Realer Rollback rendert seinen unveränderten Recoveryhinweis');
    formCheck.dispatchEvent({ type: 'input', target: inputEl });
    await new Promise(resolve => setTimeout(resolve, 310));
    assertEqual(actionText('balance-import'), rollbackText, 'Rollbackhinweis überlebt den echten Main-Debounce');

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
        StorageManager.restoreSnapshot = async () => { throw new Error('Synthetischer Snapshotfehler'); };
        let startValidation;
        let releaseValidation;
        const validationStarted = new Promise(resolve => { startValidation = resolve; });
        const validationGate = new Promise(resolve => { releaseValidation = resolve; });
        const snapshots = createSnapshotHandlers({ decide: async () => confirmed, confirmAnnual: async () => confirmed ? {} : null, dom: handlerDom, appState: {},
            getTargetYear: () => 2025, getReferenceDate: () => new Date('2026-10-03'),
            getLegacyDecision: () => 'not_committed',
            validateLiveState: async () => {
                startValidation();
                await validationGate;
                return { ok: false, error: new ValidationError([{ fieldId: 'minimumFlexAnnual', message: 'Annual-Vorprüfung' }]) };
            },
            flushLiveState: async () => {}, applyAnnualInflation: () => {} });
        await (await import('../app/shared/snapshot-archive.js')).SnapshotArchive.createSnapshot({ id: 'synthetisch.json', kind: 'manual', records: { synthetic: '{}' } });
        const restoreEvent = { target: { closest: selector => selector === '.restore-snapshot' ? { dataset: { key: 'synthetisch.json' } } : null } };
        UIRenderer.handleActionError(new Error('Vorheriger Snapshotfehler'), 'snapshots');
        await snapshots.handleSnapshotActions(restoreEvent);
        assert(actionText('snapshots').includes('Vorheriger'), 'Abgebrochene Snapshotbestätigung erhält den Fehler');
        confirmed = true;
        await snapshots.handleSnapshotActions(restoreEvent);
        const snapshotText = actionText('snapshots');
        assert(snapshotText.includes('Snapshot-Aktion fehlgeschlagen'), 'Realer Snapshothandler rendert StorageError im Aktionskanal');
        UIRenderer.handleActionError(new Error('Vorheriger Jahresfehler'), 'annual');
        confirmed = false;
        await snapshots.handleJahresabschluss();
        assert(actionText('annual').includes('Vorheriger Jahresfehler'), 'Abgebrochene Jahresbestätigung erhält ihren Fehler');
        confirmed = true;
        const pendingAnnual = snapshots.handleJahresabschluss();
        await validationStarted;
        assertEqual(actionText('annual'), '', 'Angenommener Jahresprozess entfernt vorherigen Jahresfehler');
        UIRenderer.handleActionError(new Error('Fehler während Jahresaktion'), 'annual');
        const reentrant = await snapshots.handleJahresabschluss();
        assertEqual(reentrant.status, 'in_flight', 'Realer Jahresprozess weist Reentranz ab');
        assert(actionText('annual').includes('Fehler während Jahresaktion'), 'Abgewiesene Reentranz löscht keinen Jahresfehler');
        releaseValidation();
        const annualResult = await pendingAnnual;
        assertEqual(annualResult.status, 'invalid', 'Annualvalidierung behält ihren bisherigen Status');
        const annualText = actionText('annual');
        assert(annualText.includes('Annual-Vorprüfung'), 'ValidationError aus echtem Annualhandler gehört zum Aktionskanal');
        assert(!document.getElementById('minimumFlexAnnual').classList.contains('input-error'), 'Annualvalidierung markiert keine Berechnungsfelder');
        UIRenderer.toast('Zeitlicher Nachweis');
        await balanceMain.update({ mode: 'preview' }).overviewPersistence;
        formCheck.dispatchEvent({ type: 'input', target: inputEl });
        await new Promise(resolve => setTimeout(resolve, 6100));
        for (const [scope, text] of [['balance-import', rollbackText], ['snapshots', snapshotText], ['annual', annualText]]) {
            assertEqual(actionText(scope), text, `${scope} überlebt echte Updates und den echten Toastablauf`);
        }
        const callsBeforeClose = simulateCallCount;
        const writesBeforeClose = storageWrites.length;
        const loadStateBeforeClose = StorageManager.loadState;
        const getItemBeforeClose = localStorageMock.getItem;
        let storageReads = 0;
        StorageManager.loadState = (...args) => { storageReads++; return loadStateBeforeClose(...args); };
        localStorageMock.getItem = (...args) => { storageReads++; return getItemBeforeClose(...args); };
        try {
            const entriesBeforeClose = actionContainer.children;
            const closingEntry = scopedEntry('balance-import');
            const expectedFocus = entriesBeforeClose[entriesBeforeClose.indexOf(closingEntry) + 1].children[1];
            closingEntry.children[1].focus();
            scopedEntry('balance-import').children[1].dispatchEvent({ type: 'click' });
            assertEqual(document.activeElement, expectedFocus, 'Echter Importfehler übergibt beim Schließen Fokus an den nächsten Bereich');
            await new Promise(resolve => setTimeout(resolve, 310));
            assertEqual(storageReads, 0, 'Schließen greift auch lesend nicht auf den Speicher zu');
        } finally {
            StorageManager.loadState = loadStateBeforeClose;
            localStorageMock.getItem = getItemBeforeClose;
        }
        assertEqual(actionText('balance-import'), '', 'Echter Schließenknopf entfernt seinen Fehler');
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
    engineFailure = null;
    StorageManager.replaceStateFromImport = previousReplace;
    StorageManager.rollbackImportReplace = previousRollback;
    StorageManager.restoreSnapshot = previousRestore;
}

// Produktiver CSV-Bedienweg mit echtem Binder, Reader, Main und Verlaufsschreiber.
console.log('CSV → Binder → echte PREVIEW → bestätigter Tagesstand');
{
    const savedRecords = new Map(Array.from({ length: persistenceStorage.length }, (_, i) => { const key = persistenceStorage.key(i); return [key, persistenceStorage.getItem(key)]; })), savedRead = UIReader.captureStorageDraft, savedToast = UIRenderer.toast;
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : ['2026-10-08T10:00:00Z'])); }
        static now() { return new RealDate('2026-10-08T10:00:00Z').getTime(); }
    };
    const messages = [];
    let reads = 0;
    try {
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        const id = persistenceStorage.getItem('rs_current_profile');
        const tranches = [{ trancheId: 'csv-fixture', name: 'Synthetische Tranche', category: 'equity', type: 'aktien_neu', shares: 2, purchasePrice: 80, tqf: 0,
            currentPrice: 100, purchaseDate: '2025-01-01', asOf: 1791028800 }];
        persistenceStorage.setItem('depot_tranchen', JSON.stringify(tranches));
        registry.profiles[id].data.depot_tranchen = JSON.stringify(tranches);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        await PersistenceFacade.flush();
        const before = StorageManager.loadState().wealthHistory?.entries.length || 0;
        UIReader.captureStorageDraft = (...args) => { reads++; return savedRead.apply(UIReader, args); };
        UIRenderer.toast = text => messages.push(text);
        const calls = simulateCallCount;
        assertEqual(document.getElementById('expensesTable'), null, 'Balance hat keinen verbliebenen Matriximport');
        assertEqual(document.getElementById('expensesCsvInput'), null, 'Balance hat keinen versteckten Ausgaben-Dateieingang');
        // Echte CSV-Vorschau, bestätigter Import und Tagespunkt stehen in expenses-page.test.mjs.
        const capture = createExpensesWealthCaptureController({ service: createBalanceWealthHistoryService(), update: balanceMain.update,
            now: () => new Date(), toast: text => messages.push(text) });
        const captureResult = await capture.afterImport();
        assertEqual(captureResult.status, 'saved', 'Produktiver Balance-Captureadapter bestätigt Tagesstand: ' + (captureResult.error?.message || ''));
        assertEqual(reads, 1, 'Balance-Captureadapter liest UIReader.captureStorageDraft genau einmal');
        assertEqual(simulateCallCount - calls, 1, 'Balance-Captureadapter berechnet genau eine PREVIEW');
        assertEqual(StorageManager.loadState().wealthHistory.entries.length, before + 1, 'Balance-Captureadapter sichert genau einen neuen Tagesstand');
        for (const change of ['direkter Rohwert', 'nicht entprelltes Inputevent']) {
            const oldFlush = PersistenceFacade.flush, oldReplace = PersistenceFacade.replaceRecordsTransactional;
            const field = document.getElementById('floorBedarf'), oldValue = field.value;
            let release, enter, writes = 0;
            const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
            const controller = createExpensesWealthCaptureController({ service: createBalanceWealthHistoryService(),
                update: balanceMain.update, now: () => new Date(), reportError() {} });
            PersistenceFacade.flush = async () => { enter(); await gate; return oldFlush(); };
            PersistenceFacade.replaceRecordsTransactional = (...args) => { writes++; return oldReplace(...args); };
            try {
                const capture = controller.afterImport();
                await entered;
                field.value = String(Number(oldValue) + 1);
                if (change === 'nicht entprelltes Inputevent') formCheck.dispatchEvent({ type: 'input', target: field });
                release();
                assertEqual((await capture).status, 'failed', change + ': echter PREVIEW-Validator erkennt Formularänderung während Übersichtflush');
                assertEqual(writes, 0, change + ': kein Verlaufwrite');
                assertEqual(StorageManager.loadState().wealthHistory.entries.length, before + 1, change + ': bestätigter Tagesstand unverändert');
            } finally {
                release(); PersistenceFacade.flush = oldFlush; PersistenceFacade.replaceRecordsTransactional = oldReplace;
                field.value = oldValue;
                if (change === 'nicht entprelltes Inputevent') await new Promise(resolve => setTimeout(resolve, 310));
                await oldFlush();
            }
        }

    } finally {
        UIReader.captureStorageDraft = savedRead; UIRenderer.toast = savedToast; globalThis.Date = RealDate;
        for (const key of Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i))) if (!savedRecords.has(key)) persistenceStorage.removeItem(key);
        for (const [key, value] of savedRecords) persistenceStorage.setItem(key, value);
        await PersistenceFacade.flush();
    }
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
        profile.meta = { ...profile.meta, id: 'default', name: 'Synthetischer Demo-Bestand', belongsToHousehold: false };
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
        preview.validateWealthHistorySource();
        assertEqual(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY), stateBeforePreview, 'PREVIEW erhält fachlichen Balance-State bytegleich');
        assertEqual(JSON.stringify(profileFinancialRecords()), registryBeforePreview, 'PREVIEW erhält fachliche Profilrecords bytegleich');
        assertEqual(persistenceStorage.getItem('household_plan_v1'), null, 'PREVIEW erzeugt keinen H1-Plan');
        document.getElementById('sparerPauschbetrag').value = '1.200';
        let staleError;
        try { preview.validateWealthHistorySource(); } catch (error) { staleError = error; }
        assert(staleError instanceof Error, 'Vorschau erkennt weiterhin direkte Formularänderungen');
    } finally {
        for (const key of Object.keys(PersistenceFacade.exportAllSync().records)) persistenceStorage.removeItem(key);
        for (const [key, value] of Object.entries(recordsBefore)) persistenceStorage.setItem(key, value);
        for (const [id, values] of Object.entries(formBefore)) Object.assign(document.elements[id], values);
        UIReader.planFormSource = planSourceBefore;
        UIReader.applyHouseholdPlanInputs();
        await PersistenceFacade.flush();
    }
}

// R-05: kompletter produktiver Binderweg mit aufzeichnendem Backend.
// Die Probe zählt auch isolierte State-/Plan-/Registry-/Summary-/Cashwrites ohne Beleg.
{
    await PersistenceFacade.flush();
    const binding = preserveUIBinderStateForTests();
    const formBefore = Object.fromEntries(Object.entries(document.elements)
        .map(([id, field]) => [id, { value: field.value, checked: field.checked }]));
    const planSourceBefore = UIReader.planFormSource;
    const NativeDate = globalThis.Date;
    const oldTestDate = getAppTestDate();
    const oldEngine = window.EngineAPI;
    const oldMetadata = binding.appState.pendingInputMetadata;
    const sample = balanceStorageFixture('Muster-Haushalt');
    const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    sample.records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    sample.records[EXPENSES_STORAGE_KEY] = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: {} } } });
    const backend = new Map(Object.entries(sample.records));
    const snapshots = new Map();
    const batches = [];
    let started = false, timerFired = false, confirmedEngineCalls = 0, engineCallsAtCommit = null;
    const fachkeys = new Set([CONFIG.STORAGE.LS_KEY, 'household_plan_v1', 'annual_plan_record_v1',
        'rs_profiles_v1', EXPENSES_STORAGE_KEY, OVERVIEW_SUMMARY_KEY, ...CASH_KEYS]);
    const withoutMetadata = raw => {
        const value = JSON.parse(raw);
        delete value.annualPeriodMetadata;
        return JSON.stringify(value);
    };
    const adapter = { async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async listSnapshots() { return [...snapshots.values()].map(snapshot => structuredClone(snapshot)); },
        async readSnapshot(id) { return structuredClone(snapshots.get(id)); },
        async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); return true; },
        async saveBatch({ upserts, deletes }) {
            const nextState = upserts.find(([key]) => key === CONFIG.STORAGE.LS_KEY)?.[1];
            const phase = nextState ? JSON.parse(nextState).annualPeriodMetadata?.pendingCommit?.phase ?? null : null;
            if (['writes_started', 'validating'].includes(phase)) started = true;
            const technical = deletes.length === 0 && upserts.length === 1 && nextState
                && ['snapshot_confirmed', 'writes_started', 'validating'].includes(phase)
                && withoutMetadata(nextState) === withoutMetadata(backend.get(CONFIG.STORAGE.LS_KEY));
            const touchesFachkey = [...upserts.map(([key]) => key), ...deletes].some(key => fachkeys.has(key));
            batches.push({ upserts: structuredClone(upserts), deletes: [...deletes], started, technical, touchesFachkey, phase });
            deletes.forEach(key => backend.delete(key));
            upserts.forEach(([key, raw]) => backend.set(key, raw));
            if (upserts.some(([key]) => key === 'annual_plan_record_v1')) {
                engineCallsAtCommit = confirmedEngineCalls;
                // Ein während des Backendwrites übrig gebliebener Eingabetimer
                // muss von der echten Projektion storniert werden.
                binding.appState.pendingInputMetadata = { depotLastUpdate: 123 };
                binding.appState.debounceTimer = setTimeout(() => {
                    timerFired = true;
                    balanceMain.update({ mode: 'persist_inputs' });
                }, BALANCE_UPDATE_DEBOUNCE_MS);
            }
        } };
    try {
        setAppTestDate(null);
        globalThis.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : ['2027-01-02T12:00:00Z'])); }
            static now() { return new NativeDate('2027-01-02T12:00:00Z').getTime(); }
            static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
        };
        window.EngineAPI = { ...EngineAPI, simulateSingleYear(...args) {
            confirmedEngineCalls++;
            return EngineAPI.simulateSingleYear(...args);
        } };
        balanceMain.initVersionHandshake();
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false, debounceMs: 20 });
        UIReader.applyStoredInputs(state.inputs);
        UIReader.applyHouseholdPlanInputs();
        assertEqual(binding.dom.expenses, undefined, 'Balance startet vollständig ohne Ausgaben-DOM');
        const people = captureCashPeople({ ids: sample.scope.ids, activeId: sample.records.rs_current_profile });
        const cash = { people, values: Object.fromEntries(people.map(person => [person.id, String(person.value + 100)])) };
        const preparedMarketData = {
            inflation: { rate: 2.14, year: 2026, source: 'ECB (HICP)', dataAsOf: '2027-01-01',
                fetchStatus: 'ok_primary_ecb', metric: 'consumer_prices_all_items_annual_average_growth_pct' },
            etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: 2026 },
            cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls',
                capeFetchStatus: 'ok_primary', capeUpdatedAt: new Date().toISOString() }
        };
        const result = await binding.handlers.snapshots.handleJahresabschluss({ confirmedPreparation: { cash, preparedMarketData } });
        if (!result.results?.confirmed) throw new Error('Produktiver Jahresabschluss nicht bestätigt: ' + JSON.stringify(result) + '\n' + result.error?.stack);
        const fachbatches = () => batches.filter(batch => batch.started && batch.touchesFachkey && !batch.technical);
        assertEqual(fachbatches().length, 1, 'Produktiver Handler: genau ein Fachbatch nach writes_started/validating');
        const keys = fachbatches()[0].upserts.map(([key]) => key);
        for (const key of fachkeys) assert(keys.includes(key), 'Gemeinsamer Jahresbatch enthält ' + key);
        assertEqual(fachbatches()[0].phase, null, 'Gemeinsamer Jahresbatch schließt die Periode vollständig ab');
        assert(batches.some(batch => batch.technical && batch.phase === 'writes_started')
            && batches.some(batch => batch.technical && batch.phase === 'validating'), 'Technische Phasenwrites werden separat und inhaltsgebunden erkannt');
        assertEqual(binding.appState.debounceTimer, null, 'Produktive Projektion löscht den ausstehenden Eingabetimer');
        assertEqual(JSON.stringify(binding.appState.pendingInputMetadata), '{}', 'Produktive Projektion verwirft ausstehende Eingabemetadaten');
        assertEqual(JSON.parse(persistenceStorage.getItem(EXPENSES_STORAGE_KEY)).activeYear, 2027, 'Jahresdienst schreibt gespeichertes Ausgabenjahr ohne Ansichts-DOM fort');
        assertEqual(UIReader.readAllInputs().endeVJ, 160.2, 'Produktiver Reader zeigt den bestätigten Kurs');
        assertEqual(UIReader.readAllInputs().floorBedarf, 30000 * 1.0214, 'Produktiver Reader zeigt den fortgeschriebenen Haushaltsplan');
        assertEqual(binding.appState.diagnosisData.keyParams.marketDataProvenance.targetYear, 2026, 'Produktive bestätigte Vorschau rendert die Jahresprovenienz');
        assert(window.__profilverbundActionResults?.length === 2, 'Produktive bestätigte Vorschau veröffentlicht beide bestätigten Profilaktionen');
        assertEqual(confirmedEngineCalls, engineCallsAtCommit, 'Bestätigte Vorschau verwendet das Commit-Ergebnis ohne zusätzliche Enginerechnung');
        const confirmedBytes = JSON.stringify(Object.fromEntries(backend));
        const callsAfterClose = confirmedEngineCalls;
        await new Promise(resolve => setTimeout(resolve, BALANCE_UPDATE_DEBOUNCE_MS + 50));
        await PersistenceFacade.flush();
        assert(!timerFired, 'Nach Projektion läuft kein ausstehender Eingabetimer mehr');
        assertEqual(fachbatches().length, 1, 'Timer und finaler Flush erzeugen keinen zweiten Fachbatch, auch ohne Belegkey');
        assertEqual(JSON.stringify(Object.fromEntries(backend)), confirmedBytes, 'Nachlauf erhält alle bestätigten Backendrohbytes');
        assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), confirmedBytes, 'Persistenter Readback bestätigt den vollständigen Backendstand');
        assertEqual(confirmedEngineCalls, callsAfterClose, 'Nachlauf startet keine weitere Enginerechnung');
    } finally {
        clearTimeout(binding.appState.debounceTimer);
        binding.appState.debounceTimer = null;
        binding.appState.pendingInputMetadata = oldMetadata;
        globalThis.Date = NativeDate;
        setAppTestDate(oldTestDate);
        window.EngineAPI = oldEngine;
        balanceMain.initVersionHandshake();
        PersistenceFacade.resetPersistenceForTests(createLocalStorageAdapter(localStorageMock));
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        for (const [id, values] of Object.entries(formBefore)) Object.assign(document.elements[id], values);
        UIReader.planFormSource = planSourceBefore;
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

// Echter Main-Start mit Altlink: nach Bereitschaft ohne Engine-/Plan-/Ausgabenwrite ersetzen.
{
    getPageNavigationGuard(document, window).restoreDocument();
    const oldLocation = window.location, oldName = window.name;
    const before = Object.fromEntries(['household_plan_v1', 'annual_plan_record_v1', EXPENSES_STORAGE_KEY, CONFIG.STORAGE.LS_KEY].map(key => [key, persistenceStorage.getItem(key)]));
    const calls = simulateCallCount;
    let destination = null;
    try {
        window.location = { hash: '#verlauf', search: '', href: 'http://localhost/Balance.html#verlauf',
            replace(href) { destination = href; } };
        const result = await balanceMain.init();
        assertEqual(result.reason, 'wealth_history_navigation', 'Echter initialer Verlaufsaltlink endet vor Balanceinitialisierung');
        assertEqual(destination, 'depot-tranchen-manager.html#verlauf', 'Echter Verlaufsaltlink ersetzt die historische URL');
        assertEqual(simulateCallCount, calls, 'Initialer Verlaufsaltlink startet exakt keine Balanceberechnung');
        for (const [key, raw] of Object.entries(before)) assertEqual(persistenceStorage.getItem(key), raw, 'Initialer Verlaufsaltlink erhält Fachrecord: ' + key);
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
