import { SnapshotArchive } from '../shared/snapshot-archive.js';
import { previewPersonExport, confirmPersonExport, previewPersonImport, importPersonFile } from '../profile/profile-person-file.js';
import { exportBalanceFile, importBalanceFile, evaluateBalanceFileInputs, connectLegacySnapshotFolder } from '../balance/balance-file-service.js';
import { UIReader, initUIReader } from '../balance/balance-reader.js';
import { createProfileSyncHandlers } from '../balance/balance-main-profile-sync.js';
import { createProfilverbundHandlers } from '../balance/balance-main-profilverbund.js';
import { StorageManager } from '../balance/balance-storage.js';
import { loadProfilverbundProfiles } from '../profile/profilverbund-balance.js';
import { PROFILE_VALUE_KEYS } from '../profile/profile-state.js';
import { REQUIRED_ENGINE_API_VERSION_PREFIX } from '../balance/balance-config.js';
import { createEngineHandshake, validateBalanceInputs, persistBalanceUpdate } from '../balance/balance-update-pipeline.js';
import { postprocessBalanceAction } from '../balance/balance-action-postprocessor.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { assertFullBackupAllowed, downloadJsonFile } from '../shared/persistence-backup.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { requestPageConfirmation } from '../shared/page-dialog.js';
import { previewSnapshotRetention } from '../shared/snapshot-retention.js';
import { reportDataRestoration } from './data-restoration.js';

/** Ein Besitzer für Dateilesen, Dialog und Write; Abbruch bleibt schreibfrei. */
export function createDataExchangeController(options = {}) {
    let busy = false, blocked = false;
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard });
    return {
        get busy() { return busy; },
        async run(work) {
            if (busy || blocked) return { status: 'in_flight' };
            busy = true;
            try { return await lifecycle.run({}, work); }
            catch (error) { if (error.code === 'rollback_failed') { blocked = true; PersistenceFacade.blockSyncWrites([], 'Import-Rollback nicht bestätigt. Bitte den bisherigen Stand unter Daten & Sicherung zurückholen.', { predicate: () => true }); } throw error; }
            finally { busy = false; }
        }
    };
}
/** Echte Balance-Eingaben und ihre Defaults aus SOURCE, ohne zweites Formular
 * oder kopierten Reader. Der Reader bleibt dokumentlokal auf dieser Seite. */
export async function createDataBalanceContext(doc, win) {
    const response = await win.fetch('Balance.html');
    if (!response.ok) throw new Error('Balance-Eingabevertrag konnte nicht geladen werden.');
    const template = new win.DOMParser().parseFromString(await response.text(), 'text/html');
    const inputs = Object.fromEntries([...template.querySelectorAll('input[id], select[id]')].map(node => [node.id, node]));
    const dom = { inputs, controls: {}, outputs: {}, containers: {} };
    initUIReader(dom);
    const profileSync = createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS });
    const profilverbundHandlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
    const { EngineAPI } = await import('../../engine/index.mjs');
    const engineApi = win.EngineAPI || EngineAPI;
    createEngineHandshake(engineApi, REQUIRED_ENGINE_API_VERSION_PREFIX);
    win.EngineAPI = engineApi;
    return {
        applyInputs: values => UIReader.applyStoredInputs(values),
        async update(mode) {
            if (!profileSync.syncProfileDerivedInputs()) return { ok: false };
            const inputData = UIReader.readAllInputs(); validateBalanceInputs(inputData);
            const profiles = loadProfilverbundProfiles(); profilverbundHandlers.updateProfilverbundGlobals(profiles, inputData);
            if (!inputData.aktuellesAlter) return { ok: false };
            const persistentState = StorageManager.loadState();
            if (inputData.depotLastUpdate === undefined && Object.hasOwn(persistentState.inputs || {}, 'depotLastUpdate')) inputData.depotLastUpdate = persistentState.inputs.depotLastUpdate;
            const { profilverbundRuns, modelResult } = evaluateBalanceFileInputs({ inputData, persistentState, profiles,
                profileId: PersistenceFacade.getItemSync('rs_current_profile'), profilverbundHandlers, engineApi });
            postprocessBalanceAction({ inputData, modelResult, profilverbundRuns, mergeProfilverbundActions: profilverbundHandlers.mergeProfilverbundActions });
            persistBalanceUpdate({ mode, profilverbundRuns, profilverbundHandlers, storageManager: StorageManager, persistentState, inputData, modelResult });
            return { ok: true };
        }
    };
}
export function bindDataExchange(doc, { win = doc.defaultView, refresh = async () => {}, ...options } = {}) {
    const guard = options.guard || getPageNavigationGuard(doc, win);
    const controller = createDataExchangeController({ guard });
    const status = doc.getElementById('dataExchangeStatus');
    const currentOptions = () => ({ ...options, guard, probelaufController: getProbelaufController(doc) });
    const allowed = () => assertFullBackupAllowed({ document: doc, window: win, probelaufController: getProbelaufController(doc) });
    const report = error => {
        const detail = doc.getElementById('dataExchangeTechnical'); if (detail) detail.textContent = error.message;
        if (status) status.textContent = error.name === 'AbortError' ? 'Austausch abgebrochen.'
            : /Probelauf/.test(error.message) ? 'Beende bitte zuerst den Probelauf.'
                : 'Der Austausch konnte nicht abgeschlossen werden. Weitere Hinweise findest du unter „Technische Details“.';
    };
    const run = (task, reporter = report) => controller.run(task).catch(reporter);
    const reportDelete = error => reportDataRestoration(doc, {
        message: error.name === 'AbortError' ? 'Punktlöschen abgebrochen.'
            : error.code === 'point_protected' ? 'Dieser Punkt ist dauerhaft oder noch nicht abgedeckt und bleibt erhalten.'
                : /Probelauf/.test(error.message) ? 'Beende bitte zuerst den Probelauf.'
                    : /Das Archiv hat sich geändert/.test(error.message) ? 'Das Archiv hat sich geändert. Bitte erneut prüfen.'
                        : 'Der Punkt konnte nicht entfernt werden. Weitere Hinweise findest du unter „Technische Details“.',
        technical: error.message
    });
    const select = doc.getElementById('dataPersonSelect');
    function renderPeople() {
        if (!select) return;
        const previous = select.value; select.replaceChildren();
        try {
            const registry = JSON.parse(PersistenceFacade.getItemSync('rs_profiles_v1') || '{"profiles":{}}');
            for (const [id, profile] of Object.entries(registry.profiles || {})) {
                const node = doc.createElement('option'); node.value = id; node.textContent = profile.meta?.name || 'Name unbekannt'; select.appendChild(node);
            }
            select.value = registry.profiles?.[previous] ? previous : PersistenceFacade.getItemSync('rs_current_profile') || '';
        } catch { /* Beschädigte Profile sperrt der Dienst, Vollimport bleibt erreichbar. */ }
    }
    renderPeople();
    const confirmExchange = (operation, opener, title, description, confirmLabel, danger = false) => requestPageConfirmation({ doc, opener, title, description, confirmLabel, danger, signal: operation.controller.signal });
    doc.getElementById('dataPersonExport')?.addEventListener('click', event => {
        const opener = event.currentTarget;
        return run(async operation => {
        await allowed(); operation.check();
        const selectedId = select.value;
        const preview = await previewPersonExport(selectedId, currentOptions()); operation.check();
        if (!await confirmExchange(operation, opener, 'Person exportieren', `${preview.name}: Nur diese Person mit Depot, Personendaten und Tagesgeld-Historie exportieren? Gemeinsame Einstellungen und andere Personen bleiben erhalten.`, 'Person exportieren')) return;
        operation.check();
        if (select.value !== selectedId) throw new Error('Die Personenauswahl hat sich geändert.');
        const file = await confirmPersonExport(preview, currentOptions()); operation.check();
        downloadJsonFile(file, 'ruhestand-person.json', doc); status.textContent = 'Dateiausgabe der gewählten Person angestoßen.';
        });
    });
    function bindFile(buttonId, fileId, task) {
        const file = doc.getElementById(fileId);
        doc.getElementById(buttonId)?.addEventListener('click', () => run(async operation => { await allowed(); operation.check(); file.click(); }));
        file?.addEventListener('change', event => {
            const chosen = event.target.files?.[0]; if (!chosen) return;
            if (controller.busy) { event.target.value = ''; return; }
            void run(async operation => {
                try {
                    await allowed(); operation.check();
                    const text = await chosen.text(); operation.check();
                    let parsed;
                    try { parsed = JSON.parse(text); }
                    catch { throw new Error('Die Datei konnte nicht gelesen werden.'); }
                    await task(parsed, operation, doc.getElementById(buttonId));
                }
                finally { file.value = ''; }
            });
        });
    }
    bindFile('dataPersonImport', 'dataPersonFile', async (file, operation, opener) => {
        const preview = await previewPersonImport(file, currentOptions()); operation.check();
        if (!await confirmExchange(operation, opener, 'Neue Person importieren', `${preview.name} wird als neue Person außerhalb des Haushalts angelegt. Bestehende Personen, aktive Auswahl und Tageskurse bleiben erhalten. Die Haushaltsmitgliedschaft kannst du danach in Personen & Vermögen ändern.`, 'Neue Person anlegen')) return;
        operation.check();
        const result = await importPersonFile(preview, { ...currentOptions(), navigationOperation: operation });
        status.textContent = `Neue Außenperson „${result.name}“ dauerhaft angelegt. Die aktive Auswahl bleibt erhalten.`; renderPeople(); await refresh();
    });
    doc.getElementById('dataBalanceExport')?.addEventListener('click', event => run(async operation => {
        await assertFullBackupAllowed({ document: doc, window: win, probelaufController: getProbelaufController(doc) }); operation.check();
        const file = exportBalanceFile(); downloadJsonFile(file, 'balancing-export.json', doc);
        const warning = file.validationWarnings?.[0];
        status.textContent = 'Balance-Dateiausgabe angestoßen.' + (warning ? ' Bitte beachte die Hinweise unter „Technische Details“.' : '');
        const detail = doc.getElementById('dataExchangeTechnical'); if (detail) detail.textContent = warning ? `${warning.code}: ${warning.message}` : '';
    }));
    bindFile('dataBalanceImport', 'dataBalanceFile', async (file, operation, opener) => {
        await assertFullBackupAllowed({ document: doc, window: win, probelaufController: getProbelaufController(doc) }); operation.check();
        const before = JSON.stringify(await PersistenceFacade.readPersistedRecords());
        const context = await createDataBalanceContext(doc, win); operation.check();
        // Formatprüfung vor dem Seitendialog, keine Eingaben oder Zielwrites.
        const { normalizeBalanceImportDocument } = await import('../balance/balance-binder-imports.js'); normalizeBalanceImportDocument(file);
        if (!await confirmExchange(operation, opener, 'Balance-Datei importieren', 'Der Balance-Zustand des aktuellen Rechenkontexts wird ersetzt. Vorher und nachher wird der Stand geprüft. Vor dem Ersetzen entsteht ein Wiederherstellungspunkt. Personenverwaltung und Vollsicherung sind eigene Austauschwege.', 'Balance importieren')) return;
        operation.check();
        if (JSON.stringify(await PersistenceFacade.readPersistedRecords()) !== before) throw new Error('Der Bestand hat sich seit der Vorschau geändert.');
        try {
            await importBalanceFile(file, { ...context, navigationOperation: operation });
        } catch (error) {
            // Auch ein zurückgenommener Import kann einen bestätigten Punkt hinterlassen.
            // Die ursprüngliche Importmeldung bleibt gegenüber Refreshfehlern maßgeblich.
            try { await refresh(); } catch { /* Importfehler unten weitergeben. */ }
            throw error;
        }
        status.textContent = 'Balance eingespielt und geprüft. Der vorherige Stand wurde gesichert.'; await refresh();
    });
    doc.getElementById('dataLegacyFolder')?.addEventListener('click', () => run(async operation => {
        await assertFullBackupAllowed({ document: doc, window: win, probelaufController: getProbelaufController(doc) }); operation.check();
        await connectLegacySnapshotFolder(win, operation); status.textContent = 'Bisheriger Ordner verbunden. Wiederherstellungspunkte bleiben in der App gespeichert.';
    }));
    doc.getElementById('dataSnapshotList')?.addEventListener('click', event => {
        const button = event.target.closest('[data-delete-point]'); if (!button) return;
        void run(async operation => {
            await allowed(); operation.check();
            const preview = await previewSnapshotRetention(); operation.check();
            const point = preview.remove.find(point => point.id === button.dataset.deletePoint);
            if (!point) throw Object.assign(new Error('Dieser Punkt wird dauerhaft oder als Recovery benötigt und bleibt erhalten.'), { code: 'point_protected' });
            if (!await confirmExchange(operation, button, 'Punkt löschen', 'Nur diesen durch einen jüngeren Punkt gleichen Umfangs abgedeckten Wiederherstellungspunkt endgültig löschen?', 'Punkt löschen', true)) {
                reportDataRestoration(doc, { message: 'Punktlöschen abgebrochen.' });
                return;
            }
            // Gemeinsamer Löschplan prüft Referenzen und Deckung erneut.
            const current = await previewSnapshotRetention({ now: preview.now }); operation.check();
            if (current.identity !== preview.identity || !current.remove.some(item => item.id === point.id)) throw new Error('Das Archiv hat sich geändert. Bitte erneut prüfen.');
            operation.commit(); await SnapshotArchive.deleteSnapshot(point.id, { navigationOperation: operation });
            if ((await SnapshotArchive.listSnapshots()).some(item => item.id === point.id)) throw new Error('Das Löschen wurde nicht bestätigt.');
            await refresh();
            reportDataRestoration(doc, { message: 'Punkt entfernt.', kind: 'ok' });
        }, reportDelete);
    });
    return controller;
}
