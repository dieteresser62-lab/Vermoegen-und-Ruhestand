import { areaSessionStorage } from './persistence-area-storage.js';
import { withAnnualWriteAccess } from './annual-operation-lock.js';
import { rebuildSyntheticPriceRecords, validateMusterTestDate } from '../demo/muster-haushalt-prices.js';
import { CONFIG } from '../balance/balance-config.js';
import { appNow, localCalendarDate, parseCalendarDate, setAppTestDate } from './app-clock.js';
import { PersistenceFacade } from './persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PROBELAUF_STATE_KEY, STRESS_REPLAY_ACTIVE_STORAGE_KEY, isProbelaufRecordKey } from './persistence-key-policy.js';
import { resolveProbelaufRuntime } from './probelauf-runtime.js';
import { probelaufDomainChecksum, projectProbelaufDomain } from './probelauf-records.js';
import { calculateProbelaufEndReview, probelaufMonteCarloRuns, probelaufEndNeedsComparison } from './probelauf-comparison.js';
import { musterHaushalt } from '../demo/muster-haushalte.js';

export { PROBELAUF_STATE_KEY };
export const PROBELAUF_SESSION_KEYS = ['rs_startup_prices_session_v1', 'rs_history_fetch_session_v1', 'balance.annual-retry.once'];
// Die Jahresrechnung des Musters lädt die Engine erst bei bestätigter Musterwahl.
const loadMusterHaushaltRecords = async (testDate, householdId) => {
    const { createMusterHaushaltRecords } = await import('../demo/muster-haushalt.js');
    return createMusterHaushaltRecords(testDate, householdId);
};
const RELOAD_MESSAGE = 'Spielbereich-Zustand geändert. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.';
const sameRecords = (a, b) => {
    const keys = Object.keys(a).sort(), other = Object.keys(b).sort();
    return keys.length === other.length && keys.every((key, i) => key === other[i] && a[key] === b[key]);
};
export function validateProbelaufState(raw) {
    if (raw === null) return null;
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (state?.version === 2) {
        if (state.active !== true || !['starting', 'active'].includes(state.phase)
            || !['copy', 'demo'].includes(state.source) || !['browser', 'tauri'].includes(state.runtime)) throw new Error('Beschädigter Spielbereich-Zustand. Bitte den Spielbereich beenden.');
    } else if (state?.version !== 1 || state.active !== true || !['starting', 'active', 'restoring'].includes(state.phase)
        || !state.snapshotId || !['copy', 'demo'].includes(state.source) || !['browser', 'tauri'].includes(state.runtime)
        || !Array.isArray(state.archiveIds) || state.archiveIds.some(id => typeof id !== 'string' || !id)
        || new Set(state.archiveIds).size !== state.archiveIds.length || !state.sessions || typeof state.sessions !== 'object'
        || PROBELAUF_SESSION_KEYS.some(key => state.sessions[key] !== null && typeof state.sessions[key] !== 'string')) throw new Error('Alter Spielbereich-Zustand beschädigt; Rückkehr zum Ausgangsbestand erforderlich.');
    if (state.version === 1 || state.testDate !== null) parseCalendarDate(state.testDate);
    if (state.version === 2 && (state.hasDateJump !== undefined && typeof state.hasDateJump !== 'boolean'
        || state.hasDateJump === true && state.testDate === null || state.hasDateJump === false && state.testDate !== null)) {
        throw new Error('Beschädigter Kursmodus im Spielbereich. Bitte den Spielbereich beenden.');
    }
    // Fehlend bedeutet Max und Erika. Alte Rohbytes bleiben für Readback und Rückweg erhalten.
    if (state.householdId !== undefined) musterHaushalt(state.householdId);
    return state;
}

/** Ein Koordinator pro Dokument. Alle dauerhaften Phasen werden rückgelesen. */
export function createProbelaufController({ persistence = PersistenceFacade, archive = SnapshotArchive,
    win = globalThis.window, session, runtimeResolver = resolveProbelaufRuntime,
    guard = null, saveProfile = async () => {}, reload = () => win.location.reload(),
    restoreReload = () => win.location.replace('index.html'), notify = () => {}, demoLoader = loadMusterHaushaltRecords, clock = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10000 } = {}) {
    if (session === undefined) { try { session = areaSessionStorage(win?.sessionStorage); } catch { session = null; } }
    let state = null, runtime = null, busy = false, action = null, blocked = false, release = null, initialization = null, recoveryError = null;
    let waiting = false, expectedRaw = null;
    const owner = Symbol('probelauf-coordinator');
    const ownOptions = operation => ({ navigationOperation: operation, probelaufOwner: owner });
    const capture = () => Object.fromEntries(persistence.keysSync().filter(isProbelaufRecordKey).map(key => [key, persistence.getItemSync(key)]));
    const lock = () => { if (!release) release = persistence.blockSyncWrites([], RELOAD_MESSAGE, { predicate: key => isProbelaufRecordKey(key) || key === PROBELAUF_STATE_KEY }); };
    const unlock = () => { release?.(); release = null; };
    const protect = () => persistence.setProbelaufProtection?.({
        ownsWrites: options => busy && options?.probelaufOwner === owner,
        async checkCurrent() {
            if (busy) return;
            // Der frühe Schutz wartet auf denselben vollständig gelesenen Start.
            await controller.initialize();
            if (busy) return;
            if (blocked || await persistedState() !== expectedRaw) {
                blocked = true; lock(); throw new Error(RELOAD_MESSAGE);
            }
        },
        mutation(options) {
            if (options.probelaufOwner === owner) return;
            const replayWrite = !busy && !blocked && state && typeof options.allowKey === 'function'
                && options.allowKey(STRESS_REPLAY_ACTIVE_STORAGE_KEY) && !options.allowKey('rs_profiles_v1')
                && !options.allowKey(CONFIG.STORAGE.LS_KEY) && !options.allowKey(PROBELAUF_STATE_KEY);
            if (busy || blocked || state && !options.probelaufDomainWrite && !replayWrite) throw new Error('Import/Wiederherstellung im Spielbereich gesperrt.');
        },
        snapshot(id, options) {
            if (options.probelaufOwner === owner) return;
            if (blocked || busy || state?.snapshotId === id || state?.archiveIds?.includes(id)) throw new Error('Der Rückkehrpunkt und ursprüngliche Archivpunkte sind geschützt.');
        }
    });
    async function persistedState() {
        const records = await persistence.readPersistedRecords(key => key === PROBELAUF_STATE_KEY);
        return records[PROBELAUF_STATE_KEY] ?? null;
    }
    async function assertCurrent() {
        const actual = await persistedState();
        if (actual !== expectedRaw) { blocked = true; lock(); throw new Error('Spielbereich wurde in einer anderen Seite verändert. Bitte neu laden.'); }
        const checked = await runtimeResolver({ win, state });
        if (state ? !checked.canContinue && !(state.phase !== 'active' && checked.canRecover) : !checked.canStart) throw new Error('Diese Laufzeit erlaubt keinen Spielbereich.');
    }
    async function writeState(next, operation) {
        const records = next ? { [PROBELAUF_STATE_KEY]: JSON.stringify(next) } : {};
        await persistence.replaceRecordsTransactional(records, { ...ownOptions(operation), allowKey: key => key === PROBELAUF_STATE_KEY,
            expectedRecords: state ? { [PROBELAUF_STATE_KEY]: JSON.stringify(state) } : {} });
        state = next;
        expectedRaw = next ? JSON.stringify(next) : null;
        win?.__rsProbelaufChannel?.postMessage?.('changed');
        notify(controller);
    }
    async function snapshotForState() {
        const snapshot = await archive.readSnapshot(state.snapshotId, { storage: persistence });
        if (snapshot.kind !== SNAPSHOT_KINDS.probelaufBefore || snapshot.label !== 'Vor Probelauf'
            || Object.keys(snapshot.records).some(key => !isProbelaufRecordKey(key))) throw new Error('Ungültiger Spielbereich-Rückkehrpunkt.');
        return snapshot;
    }
    // Ausschließlich für die einmalige Ablösung des alten Ersetzen-Verfahrens.
    async function restoreLegacy(operation) {
        const snapshot = await snapshotForState();
        await writeState({ ...state, phase: 'restoring' }, operation);
        await persistence.replaceRecordsTransactional(snapshot.records, { ...ownOptions(operation), allowKey: isProbelaufRecordKey });
        const keep = new Set([...state.archiveIds, state.snapshotId]);
        for (const entry of await archive.listSnapshots({ storage: persistence })) {
            if (!keep.has(entry.id)) await archive.deleteSnapshot(entry.id, { storage: persistence, ...ownOptions(operation) });
        }
        for (const id of keep) await archive.readSnapshot(id, { storage: persistence });
        if (!sameRecords(snapshot.records, await persistence.readPersistedRecords(isProbelaufRecordKey)) || !sameRecords(snapshot.records, capture())) throw new Error('Rückkehrbestand ist nicht bytegleich.');
        PROBELAUF_SESSION_KEYS.forEach(key => session?.removeItem(key));
        await writeState(null, operation);
        setAppTestDate(null);
    }
    async function initialize() {
        protect();
        try {
            const cached = persistence.getItemSync(PROBELAUF_STATE_KEY);
            const raw = cached === null ? null : await persistedState();
            expectedRaw = raw;
            if (raw !== cached) throw new Error('Persistenz hat sich während des Seitenstarts geändert. Bitte neu laden.');
            state = validateProbelaufState(raw);
            runtime = await runtimeResolver({ win, state });
            const area = persistence.getPersistenceStatus?.().activeArea;
            if (state?.version === 1) {
                if (area === 'spiel') throw new Error('Alter Rückkehrzustand liegt im Spielbereich. Bitte den Spielbereich beenden.');
                busy = true; action = 'end'; lock(); notify(controller);
                try {
                    await withAnnualWriteAccess(() => persistence.withProbelaufOperation(async () => {
                        await assertCurrent();
                        await restoreLegacy({ check() {}, commit() {} });
                    }, win), { locks: win?.navigator?.locks });
                    unlock();
                } catch (cause) {
                    recoveryError = new Error(`Der alte Spielbereich konnte nicht beendet werden: ${cause.message} Sicherung und Import bleiben gesperrt. Bitte „Spielbereich beenden“ erneut versuchen.`);
                    throw recoveryError;
                } finally { busy = false; action = null; }
            } else if (area === 'spiel') {
                if (!state || state.version !== 2) throw new Error('Spielbereich-Zustand fehlt. Bitte den Spielbereich beenden.');
                if (!runtime.canContinue) throw new Error('Diese Laufzeit erlaubt keinen Spielbereich.');
                setAppTestDate(state.testDate);
                if (state.phase !== 'active') { blocked = true; lock(); }
            } else if (state) throw new Error('Spielbereich-Zustand ohne getrennten Speicherbereich. Bitte neu laden.');
            else setAppTestDate(null);
        } catch (error) {
            if (persistence.getPersistenceStatus?.().activeArea === 'spiel' && !state) {
                state = { version: 2, active: true, phase: 'starting', source: persistence.getPersistenceStatus().areaControl.source,
                    testDate: localCalendarDate(appNow()), runtime: runtime?.kind || 'browser' };
                runtime ??= await runtimeResolver({ win, state });
            }
            blocked = true; lock(); notify(controller, error); throw error;
        }
        notify(controller);
        return controller;
    }
    async function executeTransition({ choose, confirm, date, ending = false, opener, onTransferred } = {}) {
        if (busy) throw new Error('Eine Spielbereich-Aktion läuft bereits.');
        if (blocked && !ending) throw new Error(RELOAD_MESSAGE);
        // starting bezeichnet sowohl Start als auch Datumssprung. Der eigene
        // Fortschritt gehört nur diesem Dokument, niemals dem dauerhaften Zustand.
        action = ending ? 'end' : state ? 'date' : 'start';
        busy = true; notify(controller);
        let completed = false, adoption = null, adopted = null;
        const finishReload = async () => {
            if (adopted) await onTransferred?.(adopted);
            return (ending ? restoreReload : reload)();
        };
        const mutate = async operation => {
            await assertCurrent();
            // Sperre auch fachliche Saver, während der Koordinator auf I/O wartet.
            lock();
            if (!state) {
                const selection = await choose({ testDate: localCalendarDate(appNow()), demoAvailable: controller.demoAvailable });
                if (!selection) return false;
                const today = localCalendarDate(appNow());
                const testDate = selection.testDate == null || selection.testDate === today ? null : selection.testDate;
                if (testDate !== null) parseCalendarDate(testDate);
                if (!['copy', 'demo'].includes(selection.source)) throw new Error('Unbekannte Datenquelle im Spielbereich.');
                const household = selection.source === 'demo' ? musterHaushalt(selection.householdId) : null;
                if (household && !demoLoader) throw new Error(`Beispielhaushalt ${household.name} ist noch nicht verfügbar.`);
                if (selection.source === 'demo') validateMusterTestDate(testDate || today);
                await assertCurrent();
                const realRecords = await persistence.readRealRecords();
                let records = selection.source === 'demo' ? await demoLoader(testDate || today, household.id)
                    : realRecords;
                const next = { version: 2, active: true, phase: 'active', source: selection.source,
                    ...(household ? { householdId: household.id } : {}),
                    testDate, hasDateJump: testDate !== null, runtime: runtime.kind,
                    startedAt: new Date(clock()).toISOString(), realDomainChecksum: probelaufDomainChecksum(realRecords),
                    initialMonteCarloRuns: probelaufMonteCarloRuns(records), initialDomain: projectProbelaufDomain(records) };
                if (testDate !== null && selection.source === 'copy') records = rebuildSyntheticPriceRecords(records, testDate);
                // Musterkurse sind nur Startwerte. Der echte Verlauf wird frisch
                // abgerufen und darf keine synthetischen Abfrageintervalle erben.
                if (testDate === null && selection.source === 'demo') delete records.rs_daily_prices_v1;
                const snapshots = selection.source === 'copy' ? await persistence.readRealSnapshots() : [];
                // Der Steuerrecord liegt nur in der Spielkopie. Echt bleibt auch
                // bei Abbruch oder fehlgeschlagenem Readback vollständig unberührt.
                await persistence.activatePlayArea({ source: selection.source, snapshots,
                    records: { ...records, [PROBELAUF_STATE_KEY]: JSON.stringify(next) } }, ownOptions(operation));
                state = next;
                expectedRaw = JSON.stringify(next);
                win?.__rsProbelaufChannel?.postMessage?.('changed');
            } else if (ending) {
                if (adoption) {
                    adopted = await persistence.adoptPlayArea({ state, expectedPlayChecksum: adoption.review.playDomainChecksum, now: appNow() }, ownOptions(operation));
                    state = null; expectedRaw = null; setAppTestDate(null);
                    win?.__rsProbelaufChannel?.postMessage?.('changed');
                } else if (state.version === 1) await restoreLegacy(operation);
                else {
                    await persistence.discardPlayArea(ownOptions(operation));
                    state = null;
                    expectedRaw = null;
                    setAppTestDate(null);
                    win?.__rsProbelaufChannel?.postMessage?.('changed');
                }
            } else {
                if (blocked || state.phase !== 'active') throw new Error('Zuerst den Ausgangsbestand wiederherstellen.');
                parseCalendarDate(date);
                if (state.testDate === null && date === localCalendarDate(appNow())) return false;
                // starting macht einen abgebrochenen Generationenwechsel beim Neustart sichtbar.
                await writeState({ ...state, phase: 'starting', testDate: date, hasDateJump: true }, operation);
                await persistence.replaceRecordsTransactional(rebuildSyntheticPriceRecords(capture(), date), { ...ownOptions(operation), allowKey: isProbelaufRecordKey });
                await writeState({ ...state, phase: 'active', testDate: date }, operation);
                setAppTestDate(date);
                PROBELAUF_SESSION_KEYS.forEach(key => session?.removeItem(key));
            }
            blocked = true; completed = true;
            return true;
        };
        const ready = async () => {
            await assertCurrent();
            if (!ending || adoption) {
                if (state && await saveProfile() === false) return false;
                // Alle Seitenwrites noch im bisherigen Bereich bestätigen.
                // Nach activate/discard darf selbst der Flush nichts mehr lesen.
                if (await persistence.flush(ownOptions()) === false) return false;
            }
            return true;
        };
        try {
            if (ending) {
                const choice = state && await confirm(state);
                if (!choice) return { status: 'cancelled' };
                if (choice.action === 'transfer') { adoption = choice; action = 'transfer'; notify(controller); }
            }
            if (!ending && state && !date) throw new Error('Testdatum fehlt.');
            if (guard) {
                const result = await guard.reload({ opener, returnResult: true,
                    ready, mutate, finalizeDocument: true, reload: () => adopted ? undefined : finishReload(),
                    subscribeChanges: notifyChange => {
                        const change = event => { if (!event.target?.closest?.('[data-probelauf-dialog]')) notifyChange(); };
                        win?.document?.addEventListener?.('input', change, true);
                        win?.document?.addEventListener?.('change', change, true);
                        return () => { win?.document?.removeEventListener?.('input', change, true); win?.document?.removeEventListener?.('change', change, true); };
                    }, completionMessage: RELOAD_MESSAGE });
                if (result.status === 'failed' && result.error && state && (!adoption || result.error.code === 'rollback_failed')) {
                    blocked = true; recoveryError = result.error; lock(); notify(controller, result.error);
                }
                if (adopted) await finishReload();
                return result;
            }
            const operation = { check() {}, commit() {} };
            if (await ready() === false) return { status: 'cancelled' };
            if (!await mutate(operation)) return { status: 'cancelled' };
            await finishReload();
            return { status: 'reloaded' };
        } catch (error) {
            notify(controller, error);
            if (completed) return { status: 'reload_required', error };
            if (state && (!adoption || error.code === 'rollback_failed')) { blocked = true; recoveryError = error; lock(); }
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
        if (busy) throw new Error('Eine Spielbereich-Aktion läuft bereits.');
        if (waiting) return { status: 'cancelled', error: new Error('Eine Spielbereich-Aktion läuft bereits.') };
        const expected = state ? JSON.stringify(state) : null;
        const expectedDate = localCalendarDate(appNow());
        const expectedBlocked = blocked;
        const deadline = clock() + timeoutMs;
        const busyError = () => Object.assign(new Error('Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.'), { code: 'PROBELAUF_COMMIT_BUSY' });
        const check = () => {
            if ((state ? JSON.stringify(state) : null) !== expected || blocked !== expectedBlocked || localCalendarDate(appNow()) !== expectedDate)
                throw new Error('Spielbereich-Kontext geändert. Bitte erneut starten.');
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
        initialize() { initialization ??= initialize(); return initialization; },
        start(choose, options = {}) {
            if (state || blocked) return Promise.reject(new Error('Bitte zuerst den Spielbereich beenden.'));
            return transition({ ...options, choose });
        },
        changeDate: (date, options = {}) => transition({ ...options, date }),
        end: (confirm, options = {}) => transition({ ...options, confirm, ending: true }),
        async readEndReview() {
            const realRecords = probelaufEndNeedsComparison(state) ? await persistence.readRealRecords() : undefined;
            return calculateProbelaufEndReview({ state, realRecords, playRecords: capture(), now: appNow() });
        },
        invalidate() { blocked = true; lock(); notify(controller); },
        get waiting() { return waiting; },
        get demoAvailable() { return Boolean(demoLoader); },
        get blockReason() { return blocked ? recoveryError?.message || (state && state.phase !== 'active' ? 'Spielbereich unvollständig. Bitte den Spielbereich beenden.' : RELOAD_MESSAGE) : null; },
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
    win?.addEventListener?.('storage', event => { if (event.key === PROBELAUF_STATE_KEY || event.key === 'rs_storage_area_control_v1') controller.invalidate(); });
    win?.addEventListener?.('pageshow', event => { if (event.persisted) controller.invalidate(); });
    return controller;
}
