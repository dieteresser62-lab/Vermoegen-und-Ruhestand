import { withAnnualWriteAccess } from './annual-operation-lock.js';
import { loadMusterHaushalt, rebuildSyntheticPriceRecords, validateMusterTestDate } from '../demo/muster-haushalt.js';
import { CONFIG } from '../balance/balance-config.js';
import { appNow, localCalendarDate, parseCalendarDate, setAppTestDate } from './app-clock.js';
import { PersistenceFacade } from './persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PROBELAUF_STATE_KEY, STRESS_REPLAY_ACTIVE_STORAGE_KEY, isProbelaufRecordKey } from './persistence-key-policy.js';
import { resolveProbelaufRuntime } from './probelauf-runtime.js';

export { PROBELAUF_STATE_KEY };
export const PROBELAUF_SESSION_KEYS = ['rs_startup_prices_session_v1', 'rs_history_fetch_session_v1', 'balance.annual-retry.once'];
const RELOAD_MESSAGE = 'Probelauf-Zustand geändert. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.';
const sameRecords = (a, b) => {
    const keys = Object.keys(a).sort(), other = Object.keys(b).sort();
    return keys.length === other.length && keys.every((key, i) => key === other[i] && a[key] === b[key]);
};
export function validateProbelaufState(raw) {
    if (raw === null) return null;
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (state?.version !== 1 || state.active !== true || !['starting', 'active', 'restoring'].includes(state.phase)
        || !state.snapshotId || !['copy', 'demo'].includes(state.source) || !['browser', 'tauri'].includes(state.runtime)
        || !Array.isArray(state.archiveIds) || state.archiveIds.some(id => typeof id !== 'string' || !id)
        || new Set(state.archiveIds).size !== state.archiveIds.length || !state.sessions || typeof state.sessions !== 'object'
        || PROBELAUF_SESSION_KEYS.some(key => state.sessions[key] !== null && typeof state.sessions[key] !== 'string')) throw new Error('Beschädigter Probelauf-Zustand; Wiederherstellung erforderlich.');
    parseCalendarDate(state.testDate);
    return state;
}

/** Ein Koordinator pro Dokument. Alle dauerhaften Phasen werden rückgelesen. */
export function createProbelaufController({ persistence = PersistenceFacade, archive = SnapshotArchive,
    win = globalThis.window, session, runtimeResolver = resolveProbelaufRuntime,
    guard = null, saveProfile = async () => {}, reload = () => win.location.reload(),
    restoreReload = () => win.location.replace('index.html'), notify = () => {}, demoLoader = loadMusterHaushalt, clock = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10000 } = {}) {
    if (session === undefined) { try { session = win?.sessionStorage; } catch { session = null; } }
    let state = null, runtime = null, busy = false, action = null, blocked = false, release = null, initialization = null, recoveryError = null;
    let waiting = false;
    const owner = Symbol('probelauf-coordinator');
    const ownOptions = operation => ({ navigationOperation: operation, probelaufOwner: owner });
    const capture = () => Object.fromEntries(persistence.keysSync().filter(isProbelaufRecordKey).map(key => [key, persistence.getItemSync(key)]));
    const lock = () => { if (!release) release = persistence.blockSyncWrites([], RELOAD_MESSAGE, { predicate: key => isProbelaufRecordKey(key) || key === PROBELAUF_STATE_KEY }); };
    const unlock = () => { release?.(); release = null; };
    const protect = () => persistence.setProbelaufProtection?.({
        ownsWrites: options => busy && options?.probelaufOwner === owner,
        async checkCurrent() {
            // Der frühe Schutz wartet auf denselben vollständig gelesenen Start.
            await controller.initialize();
            if (busy) return;
            if (blocked || await persistedState() !== (state ? JSON.stringify(state) : null)) {
                blocked = true; lock(); throw new Error(RELOAD_MESSAGE);
            }
        },
        mutation(options) {
            if (options.probelaufOwner === owner) return;
            const replayWrite = !busy && !blocked && state && typeof options.allowKey === 'function'
                && options.allowKey(STRESS_REPLAY_ACTIVE_STORAGE_KEY) && !options.allowKey('rs_profiles_v1')
                && !options.allowKey(CONFIG.STORAGE.LS_KEY) && !options.allowKey(PROBELAUF_STATE_KEY);
            if (busy || blocked || state && !options.probelaufDomainWrite && !replayWrite) throw new Error('Import/Wiederherstellung während des Probelaufs gesperrt.');
        },
        snapshot(id, options) {
            if (options.probelaufOwner === owner) return;
            if (blocked || busy || state?.snapshotId === id || state?.archiveIds.includes(id)) throw new Error('Der Rückkehrpunkt und ursprüngliche Archivpunkte sind geschützt.');
        }
    });
    async function persistedState() {
        const records = await persistence.readPersistedRecords(key => key === PROBELAUF_STATE_KEY);
        return records[PROBELAUF_STATE_KEY] ?? null;
    }
    async function assertCurrent() {
        const actual = await persistedState();
        const expected = state ? JSON.stringify(state) : null;
        if (actual !== expected) { blocked = true; lock(); throw new Error('Probelauf wurde in einer anderen Seite verändert. Bitte neu laden.'); }
        const checked = await runtimeResolver({ win, state });
        if (state ? !checked.canContinue && !(state.phase !== 'active' && checked.canRecover) : !checked.canStart) throw new Error('Diese Laufzeit erlaubt keinen Probelauf.');
    }
    async function writeState(next, operation) {
        const records = next ? { [PROBELAUF_STATE_KEY]: JSON.stringify(next) } : {};
        await persistence.replaceRecordsTransactional(records, { ...ownOptions(operation), allowKey: key => key === PROBELAUF_STATE_KEY,
            expectedRecords: state ? { [PROBELAUF_STATE_KEY]: JSON.stringify(state) } : {} });
        state = next;
        win?.__rsProbelaufChannel?.postMessage?.('changed');
        notify(controller);
    }
    async function snapshotForState() {
        const snapshot = await archive.readSnapshot(state.snapshotId, { storage: persistence });
        if (snapshot.kind !== SNAPSHOT_KINDS.probelaufBefore || snapshot.label !== 'Vor Probelauf'
            || Object.keys(snapshot.records).some(key => !isProbelaufRecordKey(key))) throw new Error('Ungültiger Probelauf-Rückkehrpunkt.');
        return snapshot;
    }
    async function initialize() {
        protect();
        try {
            const cached = persistence.getItemSync(PROBELAUF_STATE_KEY);
            const raw = cached === null ? null : await persistedState();
            if (raw !== cached) {
                state = validateProbelaufState(cached);
                throw new Error('Persistenz hat sich während des Seitenstarts geändert. Bitte neu laden.');
            }
            state = validateProbelaufState(raw);
            runtime = await runtimeResolver({ win, state });
            protect();
            if (state) {
                if (!runtime.canContinue && !(state.phase !== 'active' && runtime.canRecover)) throw new Error('Probelauf-Recovery: Diese Laufzeit ist gesperrt.');
                setAppTestDate(state.testDate);
                await snapshotForState();
                if (state.phase !== 'active') { blocked = true; lock(); }
            } else setAppTestDate(null);
        } catch (error) { blocked = true; lock(); notify(controller, error); throw error; }
        notify(controller);
        return controller;
    }
    async function executeTransition({ choose, confirm, date, ending = false, opener } = {}) {
        if (busy) throw new Error('Eine Probelauf-Aktion läuft bereits.');
        if (blocked && !ending) throw new Error(RELOAD_MESSAGE);
        // starting bezeichnet sowohl Start als auch Datumssprung. Der eigene
        // Fortschritt gehört nur diesem Dokument, niemals dem dauerhaften Zustand.
        action = ending ? 'end' : state ? 'date' : 'start';
        busy = true; notify(controller);
        let completed = false;
        const mutate = async operation => {
            await assertCurrent();
            // Sperre auch fachliche Saver, während der Koordinator auf I/O wartet.
            lock();
            if (!state) {
                if (await persistence.flush(ownOptions(operation)) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                const records = capture();
                if (!sameRecords(records, await persistence.readPersistedRecords(isProbelaufRecordKey))) throw new Error('Ausgangsbestand ist nicht dauerhaft bestätigt.');
                const archiveIds = (await archive.listSnapshots({ storage: persistence })).map(entry => entry.id);
                const sessions = Object.fromEntries(PROBELAUF_SESSION_KEYS.map(key => [key, session?.getItem(key) ?? null]));
                const snapshot = await archive.createSnapshot({ label: 'Vor Probelauf', kind: SNAPSHOT_KINDS.probelaufBefore,
                    id: `probelauf_${globalThis.crypto.randomUUID()}`, records }, { storage: persistence, ...ownOptions(operation) });
                const readback = await archive.readSnapshot(snapshot.id, { storage: persistence });
                if (!sameRecords(records, readback.records) || JSON.stringify(snapshot) !== JSON.stringify(readback)) throw new Error('Rückkehrpunkt konnte nicht bytegleich bestätigt werden.');
                const selection = await choose({ testDate: localCalendarDate(appNow()), demoAvailable: controller.demoAvailable });
                if (!selection) return false;
                parseCalendarDate(selection.testDate);
                if (!['copy', 'demo'].includes(selection.source) || selection.source === 'demo' && !demoLoader) throw new Error('Muster-Haushalt ist noch nicht verfügbar.');
                if (selection.source === 'demo') validateMusterTestDate(selection.testDate);
                await assertCurrent();
                if (!sameRecords(records, capture()) || !sameRecords(records, await persistence.readPersistedRecords(isProbelaufRecordKey))) throw new Error('Ausgangsbestand wurde während der Auswahl verändert. Bitte erneut starten.');
                await writeState({ version: 1, active: true, phase: 'starting', source: selection.source,
                    testDate: selection.testDate, snapshotId: snapshot.id, archiveIds, sessions, runtime: runtime.kind }, operation);
                if (selection.source === 'demo') await demoLoader({ persistence, testDate: selection.testDate, ...ownOptions(operation) });
                else await persistence.replaceRecordsTransactional(rebuildSyntheticPriceRecords(capture(), selection.testDate), { ...ownOptions(operation), allowKey: isProbelaufRecordKey });
                setAppTestDate(state.testDate);
                await writeState({ ...state, phase: 'active' }, operation);
                PROBELAUF_SESSION_KEYS.forEach(key => session?.removeItem(key));
            } else if (ending) {
                const snapshot = await snapshotForState();
                await writeState({ ...state, phase: 'restoring' }, operation);
                await persistence.replaceRecordsTransactional(snapshot.records, { ...ownOptions(operation), allowKey: isProbelaufRecordKey });
                const keep = new Set([...state.archiveIds, state.snapshotId]);
                for (const entry of await archive.listSnapshots({ storage: persistence })) {
                    if (!keep.has(entry.id)) await archive.deleteSnapshot(entry.id, { storage: persistence, ...ownOptions(operation) });
                }
                // Nach der Bereinigung müssen alle geschützten Archivpunkte noch lesbar sein.
                for (const id of keep) await archive.readSnapshot(id, { storage: persistence });
                if (!sameRecords(snapshot.records, await persistence.readPersistedRecords(isProbelaufRecordKey)) || !sameRecords(snapshot.records, capture())) throw new Error('Rückkehrbestand ist nicht bytegleich.');
                // Die Übersicht soll echte Kurse neu abrufen, ohne alte Sitzungssperren.
                PROBELAUF_SESSION_KEYS.forEach(key => session?.removeItem(key));
                await writeState(null, operation);
                setAppTestDate(null);
            } else {
                if (blocked || state.phase !== 'active') throw new Error('Zuerst den Ausgangsbestand wiederherstellen.');
                parseCalendarDate(date);
                // starting macht einen abgebrochenen Generationenwechsel beim Neustart sichtbar.
                await writeState({ ...state, phase: 'starting' }, operation);
                await persistence.replaceRecordsTransactional(rebuildSyntheticPriceRecords(capture(), date), { ...ownOptions(operation), allowKey: isProbelaufRecordKey });
                await writeState({ ...state, phase: 'active', testDate: date }, operation);
                setAppTestDate(date);
                PROBELAUF_SESSION_KEYS.forEach(key => session?.removeItem(key));
            }
            blocked = true; completed = true;
            return true;
        };
        try {
            if (ending && (!state || !await confirm(state))) return { status: 'cancelled' };
            if (!ending && state && !date) throw new Error('Testdatum fehlt.');
            if (guard) {
                const result = await guard.reload({ opener, returnResult: true,
                    ready: async () => { await assertCurrent(); if (!ending && await saveProfile() === false) return false; return true; },
                    mutate, flush: () => persistence.flush(ownOptions()), reload: ending ? restoreReload : reload,
                    subscribeChanges: notifyChange => {
                        const change = event => { if (!event.target?.closest?.('[data-probelauf-dialog]')) notifyChange(); };
                        win?.document?.addEventListener?.('input', change, true);
                        win?.document?.addEventListener?.('change', change, true);
                        return () => { win?.document?.removeEventListener?.('input', change, true); win?.document?.removeEventListener?.('change', change, true); };
                    }, completionMessage: RELOAD_MESSAGE });
                if (result.status === 'failed' && result.error && state) {
                    blocked = true; recoveryError = result.error; lock(); notify(controller, result.error);
                }
                return result;
            }
            const operation = { check() {}, commit() {} };
            if (!ending && await saveProfile() === false) return { status: 'cancelled' };
            if (!await mutate(operation)) return { status: 'cancelled' };
            await (ending ? restoreReload : reload)();
            return { status: 'reloaded' };
        } catch (error) {
            notify(controller, error);
            if (completed) return { status: 'reload_required', error };
            if (state) { blocked = true; recoveryError = error; lock(); }
            throw error;
        } finally {
            busy = false;
            action = null;
            if (!blocked && !state) unlock();
            else if (!blocked && state?.phase === 'active') unlock();
            notify(controller);
        }
    }
    async function transition(options) {
        if (busy) throw new Error('Eine Probelauf-Aktion läuft bereits.');
        if (waiting) return { status: 'cancelled', error: new Error('Eine Probelauf-Aktion läuft bereits.') };
        const expected = state ? JSON.stringify(state) : null;
        const expectedDate = localCalendarDate(appNow());
        const expectedBlocked = blocked;
        const deadline = clock() + timeoutMs;
        const busyError = () => Object.assign(new Error('Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.'), { code: 'PROBELAUF_COMMIT_BUSY' });
        const check = () => {
            if ((state ? JSON.stringify(state) : null) !== expected || blocked !== expectedBlocked || localCalendarDate(appNow()) !== expectedDate)
                throw new Error('Probelauf-Kontext geändert. Bitte erneut starten.');
        };
        const occupied = () => guard?.isBusy() || guard?.reasons().some(reason => reason.phase === 'commit');
        const progress = () => notify(controller, Object.assign(new Error('Speichert noch …'), { code: 'PROBELAUF_COMMIT_BUSY' }));
        const retry = Symbol('occupied-during-acquire');
        const pause = async () => {
            check();
            if (clock() >= deadline) throw busyError();
            progress(); await wait(Math.min(50, deadline - clock()));
            check();
            if (clock() >= deadline) throw busyError();
        };
        waiting = true;
        try {
            const execute = async () => {
                check();
                if (clock() >= deadline) throw busyError();
                if (occupied()) return retry;
                waiting = false;
                return executeTransition(options);
            };
            for (;;) {
                while (occupied()) await pause();
                const result = await withAnnualWriteAccess(async () => persistence.withProbelaufOperation
                    ? await persistence.withProbelaufOperation(execute, win, { check, onWait: progress, clock, wait, timeoutMs: Math.max(0, deadline - clock()) })
                    : win?.navigator?.locks?.request
                        ? await win.navigator.locks.request('rs-probelauf-operation', { mode: 'exclusive', ifAvailable: true }, lock => lock ? execute() : retry)
                        : await execute(), { locks: win?.navigator?.locks });
                if (result !== retry) return result;
                // Lock vor dem Warten freigeben; Erwerbsrennen und Legacybesitz
                // gehören weiterhin zur selben Episode mit unveränderter Frist.
                await pause();
            }
        } catch (error) {
            if (['PROBELAUF_COMMIT_BUSY', 'PROBELAUF_OTHER_PAGE', 'ANNUAL_OPERATION_BUSY'].includes(error.code)) return { status: 'cancelled', error };
            throw error;
        } finally { waiting = false; notify(controller); }
    }
    const controller = {
        initialize() { initialization ??= initialize(); return initialization; }, start: (choose, options = {}) => transition({ ...options, choose }),
        changeDate: (date, options = {}) => transition({ ...options, date }),
        end: (confirm, options = {}) => transition({ ...options, confirm, ending: true }),
        invalidate() { blocked = true; lock(); notify(controller); },
        get waiting() { return waiting; },
        get demoAvailable() { return Boolean(demoLoader); },
        get blockReason() { return blocked ? recoveryError?.message || (state && state.phase !== 'active' ? 'Probelauf-Recovery: Bitte den Ausgangsbestand wiederherstellen.' : RELOAD_MESSAGE) : null; },
        get state() { return state; }, get runtime() { return runtime; }, get busy() { return busy; }, get action() { return action; }, get blocked() { return blocked; }
    };
    return controller;
}

const pageControllers = new WeakMap();
export function getProbelaufController(doc) { return pageControllers.get(doc); }
export async function initializeProbelaufPage({ doc, win, guard, saveProfile, notify } = {}) {
    if (pageControllers.has(doc)) return pageControllers.get(doc).initialize();
    const controller = createProbelaufController({ doc, win, guard, saveProfile, notify });
    pageControllers.set(doc, controller);
    await controller.initialize();
    if (controller.runtime?.kind === 'unknown') return controller;
    if (typeof win?.BroadcastChannel === 'function') {
        const channel = new win.BroadcastChannel('rs-probelauf-state');
        win.__rsProbelaufChannel = channel;
        channel.addEventListener('message', () => controller.invalidate());
        win.addEventListener('pagehide', event => { if (!event.persisted) channel.close(); });
    }
    win?.addEventListener?.('storage', event => { if (event.key === PROBELAUF_STATE_KEY) controller.invalidate(); });
    win?.addEventListener?.('pageshow', event => { if (event.persisted) controller.invalidate(); });
    return controller;
}
