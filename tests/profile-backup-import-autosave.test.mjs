import { PersistenceFacade as persistence, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createPersistenceAreas } from '../app/shared/persistence-areas.js';
import { installProfilePersistenceHooks } from '../app/profile/profile-navigation.js';
import { bootstrapProfileContext, PROFILE_LIVE_BASE_KEY, createProfileOwnedBalanceState, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { bindFullBackupImport, buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { bindDataExchange } from '../app/data/data-exchange.js';
import { previewPersonExport } from '../app/profile/profile-person-file.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { MemoryWebStorage, fakeAreaTauri } from './helpers/persistence-area-backends.mjs';

const tick = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
const previous = { document: globalThis.document, window: globalThis.window, FileReader: globalThis.FileReader };

async function fixture(kind) {
    persistence.resetPersistenceRuntimeForTests();
    const records = createMusterHaushaltRecords('2026-10-23', 'helga-werner');
    // Haushaltsmetadaten bleiben live; der Personenstand enthält nur den eigenen Anteil.
    const state = { inputs: {}, lastInflationAppliedAtYear: 2026 };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles[records.rs_current_profile].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(createProfileOwnedBalanceState(state));
    registry.profiles[records.rs_current_profile].meta.updatedAt = '2025-01-01T12:00:00.000Z';
    records.rs_profiles_v1 = JSON.stringify(registry);
    const backup = buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records }) } });
    const local = new MemoryWebStorage(), native = kind === 'tauri' ? fakeAreaTauri() : null;
    const timers = new Map(), listeners = new Map(), windowListeners = new Map();
    let sequence = 0, now = 0, saves = 0;
    const win = { localStorage: local, sessionStorage: new MemoryWebStorage(), ...(native ? { __TAURI__: {} } : {}),
        addEventListener(type, fn) { const list = windowListeners.get(type) || []; list.push(fn); windowListeners.set(type, list); },
        removeEventListener() {},
        setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, due: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); } };
    const options = { window: win, localStorage: local, indexedDB: null, invoke: native?.invoke,
        installLifecycleHooks: false, debounceMs: 60000 };
    const real = createPersistenceAreas(options).makeAdapter('echt');
    await real.open(); await real.saveBatch({ upserts: Object.entries(records), deletes: [] }); real.close?.();
    await persistence.init(options);
    bootstrapProfileContext({ preserveLiveProfileData: true });
    await persistence.flush();
    const doc = createSelectionDocument(); doc.defaultView = win;
    doc.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
    doc.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn));
    globalThis.document = doc; globalThis.window = win;
    installProfilePersistenceHooks({ win, doc, saver() { saves++; return saveCurrentProfileFromLocalStorage(); } });
    const file = addField(doc, 'fullBackupImportFile'); file.type = 'file'; file.files = [{}];
    const button = doc.createElement('button'), status = { dataset: {}, textContent: '' };
    let confirm, downloads = 0, reloads = 0;
    globalThis.FileReader = class { readAsText() { this.result = JSON.stringify(backup); this.onload(); } };
    bindFullBackupImport({ document: doc, button, fileInput: file, status,
        confirmImport: () => new Promise(resolve => { confirm = resolve; }),
        createRecoveryBackup: async () => { downloads++; return { skipped: false }; }, reload: () => { reloads++; } });
    const emit = (target, type = 'change') => {
        for (const handler of listeners.get(type) || []) handler({ type, target });
    };
    return { doc, win, file, status, emit, backup,
        get saves() { return saves; }, get reloads() { return reloads; }, get downloads() { return downloads; },
        async advance(ms) {
            now += ms;
            for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); }
            await tick();
        },
        async begin() {
            confirm = null;
            const task = file.listeners.change[0]();
            emit(file); // Der Dateihandler läuft vor dem Bubble-Ereignis des Dokuments.
            await tick();
            assert(typeof confirm === 'function', 'Der echte Vollimportbinder erreicht die Entscheidung');
            return { task, confirm };
        }
    };
}

try {
    for (const kind of ['tauri', 'localstorage']) {
        for (const pending of [false, true]) {
            const f = await fixture(kind);
            if (pending) {
                persistenceStorage.setItem('sim_mcSeed', 'eb1-eingabe');
                f.emit(addField(f.doc, 'mcSeed'), 'input');
            }
            const { task, confirm } = await f.begin();
            const decisionRegistry = persistence.getItemSync('rs_profiles_v1');
            const decisionBase = persistence.getItemSync(PROFILE_LIVE_BASE_KEY);
            if (!pending) assertEqual(decisionBase, null, 'H-1b Import-Vorschau ohne Eingabe erzeugt keine Ladebasis');
            if (pending) assertEqual(JSON.parse(decisionRegistry).profiles[persistence.getItemSync('rs_current_profile')].data.sim_mcSeed,
                'eb1-eingabe', 'Eine ausstehende echte Eingabe ist vor der Importentscheidung dauerhaft gesichert');
            await f.advance(250);
            await persistence.flush();
            assertEqual(persistence.getItemSync(PROFILE_LIVE_BASE_KEY), decisionBase, 'H-1b Ladebasis bleibt während der Importentscheidung unverändert');
            const unchanged = persistence.getItemSync('rs_profiles_v1') === decisionRegistry;
            confirm(true); await task;
            assertEqual(f.reloads, 1, `${kind}: Vollsicherung gelingt beim ersten Versuch trotz normalisiertem Personenstand`);
            assert(unchanged, 'Während der Entscheidung ändert kein alter Eingabetimer die Vergleichsbasis');
            assertEqual(f.downloads, 1, 'Erfolg erstellt vorher genau eine Wiederherstellungssicherung');
            assertEqual(f.status.dataset.kind, 'ok', 'Erfolg meldet sich am echten Sicherungsstatus');
            assertEqual(persistence.getItemSync(CONFIG.STORAGE.LS_KEY), f.backup.records[CONFIG.STORAGE.LS_KEY], 'Vollimport übernimmt die Balancebytes der Sicherung');
        }
        {
            const f = await fixture(kind);
            const first = await f.begin();
            // Fremde Änderungen müssen weiterhin stoppen, auch ohne Formularevent.
            persistenceStorage.setItem('sim_mcSeed', 'fremde-aenderung');
            await persistence.flush();
            await f.advance(250); first.confirm(true); await first.task;
            assertEqual(f.reloads, 0, 'Eine echte fremde Änderung stoppt vor dem Ersetzen');
            assert(f.status.textContent.includes('Livebestand'), 'Fremde Änderung erhält den Bestandswarnhinweis');
            assertEqual(f.downloads, 0, 'Veraltete Zustimmung erstellt keinen Recoveryexport');
            assertEqual(persistence.getItemSync('sim_mcSeed'), 'fremde-aenderung', 'Abbruch erhält die fremde Änderung');
            const second = await f.begin();
            await f.advance(250); second.confirm(true); await second.task;
            assertEqual(f.reloads, 1, `${kind}: Zweiter Versuch gelingt ohne erneuten Eingabewrite durch die Dateiauswahl`);
            assertEqual(f.status.dataset.kind, 'ok', 'Die Wiederholung endet erfolgreich');
        }
        {
            const f = await fixture(kind), before = persistence.getItemSync('rs_profiles_v1');
            const dialog = f.doc.body.appendChild(f.doc.createElement('dialog'));
            dialog.className = 'page-dialog';
            const choice = addField(f.doc, 'pageDialogInput', '', null, dialog);
            f.emit(f.file); f.emit(choice, 'input'); f.emit(choice);
            await f.advance(250);
            assert(persistence.getItemSync('rs_profiles_v1') === before, 'Datei- und Dialogfelder sichern trotz normalisiertem Personenstand keine Registry');
            const form = f.doc.body.appendChild(f.doc.createElement('dialog'));
            const field = addField(f.doc, 'mcSeed', '', null, form);
            persistenceStorage.setItem('sim_mcSeed', 'eb1-formulareingabe'); f.emit(field, 'input');
            await f.advance(250);
            assertEqual(f.saves, 1, 'Ein gewöhnlicher Formulardialog sichert gespeicherte Eingaben weiterhin');
        }
        {
            const f = await fixture(kind);
            const id = persistence.getItemSync('rs_current_profile');
            const { file: personFile } = await previewPersonExport(id);
            let dialog;
            const createElement = f.doc.createElement.bind(f.doc);
            f.doc.createElement = tag => {
                const node = createElement(tag);
                node.append = (...children) => children.forEach(child => node.appendChild(child));
                node.focus = () => {};
                node.close = () => { node.open = false; };
                node.showModal = () => { node.open = true; dialog = node; };
                return node;
            };
            for (const key of ['dataPersonImport', 'dataExchangeStatus', 'dataExchangeTechnical']) {
                const node = f.doc.body.appendChild(f.doc.createElement('button')); node.id = key;
            }
            const file = addField(f.doc, 'dataPersonFile'); file.type = 'file';
            file.files = [{ text: async () => JSON.stringify(personFile) }];
            persistenceStorage.setItem('sim_mcSeed', 'eb1-personeneingabe');
            f.emit(addField(f.doc, 'mcSeed'), 'input');
            const controller = bindDataExchange(f.doc, { win: f.win });
            file.listeners.change[0]({ target: file }); f.emit(file);
            for (let i = 0; i < 100 && !dialog; i++) await new Promise(resolve => setImmediate(resolve));
            assert(dialog?.open, 'Personenimport erreicht den echten Seitendialog');
            await f.advance(250);
            assertEqual(f.saves, 1, 'Personenimport holt nur die wartende Eingabe vor seiner Vorschau nach');
            dialog.querySelectorAll('*').find(node => node.dataset.pageDialogAccept === '').listeners.click[0]();
            for (let i = 0; i < 100 && controller.busy; i++) await new Promise(resolve => setImmediate(resolve));
            const profiles = JSON.parse(persistence.getItemSync('rs_profiles_v1')).profiles;
            assertEqual(Object.keys(profiles).length, 3, `${kind}: Personenimport gelingt trotz unterschiedlicher Live- und Personenstände`);
            assertEqual(persistence.getItemSync('rs_current_profile'), id, 'Personenimport erhält die aktive Auswahl');
            assertEqual(profiles[id].data.sim_mcSeed, 'eb1-personeneingabe', 'Personenimport erhält die vorher gesicherte echte Eingabe');
        }
    }
} finally {
    persistence.resetPersistenceRuntimeForTests();
    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}
