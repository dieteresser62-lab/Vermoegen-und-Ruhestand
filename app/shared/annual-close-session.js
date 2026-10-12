import { validateAnnualPreparationValue } from './annual-marketdata.js';

/** Flüchtiger Entwurf. Keine Finanzwrites und keine Jahreslease während Vorbereitung. */
export function createAnnualCloseSession({ readContext, fetchers, showPreparation,
    getImports = () => null, guard = null, schedule = setInterval, unschedule = clearInterval } = {}) {
    let active = null, revision = 0;
    const fingerprint = () => JSON.stringify(readContext());
    const owner = Symbol('balance-close-draft');
    const invalidate = () => { active?.controller.abort(); active?.dialog?.close(false); };
    const lease = guard?.register(owner, {
        // idle/dirty ist der vorhandene Monatsentwurfsvertrag: Importfolgejobs bleiben frei.
        read: () => ({ phase: 'idle', dirty: Boolean(active?.dirty), revision,
            message: 'Ungespeicherte Eingaben im Jahresdialog.' }),
        cancel: () => { invalidate(); return true; }
    });
    const check = state => {
        state.controller.signal.throwIfAborted();
        if (fingerprint() !== state.context) {
            invalidate();
            throw new Error('Profil, Umfang, Datum oder Jahresquellen wurden geändert. Bitte den Dialog erneut öffnen.');
        }
    };
    const executeLoad = async state => {
        const missing = Object.keys(fetchers).filter(type => !state.values[type]);
        await Promise.all(missing.map(async type => {
            try {
                const value = await fetchers[type]({ targetYear: state.targetYear, signal: state.controller.signal });
                check(state);
                if (type === 'cape' && value?.capeFetchStatus === 'error_no_source_no_stored') throw new Error('Keine CAPE-Quelle verfügbar und kein lokaler Stand vorhanden.');
                state.values[type] = validateAnnualPreparationValue(type, value, state.targetYear); delete state.errors[type];
            } catch (error) {
                if (state.controller.signal.aborted) return;
                state.errors[type] = error.message;
            }
        }));
        check(state);
        state.dialog?.updateMarketData({ values: state.values, errors: state.errors });
    };
    const load = state => {
        if (state.loading) return state.loading;
        state.loading = executeLoad(state).finally(() => { state.loading = null; });
        return state.loading;
    };
    return {
        invalidate,
        contextFingerprint: fingerprint,
        refresh() {
            if (!active) return;
            try { check(active); active.dialog?.update(active.getModel?.() || {}); } catch { invalidate(); }
        },
        get active() { return Boolean(active); },
        async prepare(options) {
            if (active) return null;
            const state = { context: fingerprint(), targetYear: options.targetYear, controller: new AbortController(), values: {}, errors: {}, dirty: false, getModel: options.getModel };
            active = state;
            const timer = schedule(() => { if (active === state && fingerprint() !== state.context) invalidate(); }, 200);
            try {
                const accepted = await showPreparation({ ...options, signal: state.controller.signal,
                    retryMarketData: () => load(state),
                    onReady(dialog) {
                        state.dialog = dialog; getImports()?.bindRoot(dialog.root, state.controller.signal, dialog);
                        void load(state).catch(error => { if (!state.controller.signal.aborted) dialog.setStatus(error.message); });
                    },
                    onDirty(value) { state.dirty = value; revision++; lease?.notify(); },
                    confirmDiscard: async () => {
                        if (!guard) return false;
                        const attempt = await guard.prepare({ owners: [owner], intent: 'discard', signal: state.controller.signal });
                        if (!attempt) return false;
                        const valid = guard.validate(attempt); guard.end(attempt); return valid;
                    },
                    onClose: async () => { getImports()?.abort(); await getImports()?.wait(); return true; }
                });
                if (!accepted) return null;
                await getImports()?.wait();
                check(state);
                // Ein laufender Vorababruf wird vor der Übergabe beendet; kein zweiter Abruf.
                if (state.loading) await state.loading;
                const preparedMarketData = { ...state.values, ...accepted.preparedMarketData };
                if (accepted.manualPrice !== undefined) delete preparedMarketData.etf;
                return { ...accepted, preparedMarketData };
            } finally {
                unschedule(timer); state.controller.abort(); active = null; revision++; lease?.notify();
            }
        },
        dispose() { invalidate(); lease?.unregister(); }
    };
}
import { storeMonthProvision, OVERVIEW_MONTH_KEY, readOverviewSummary, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';
import { captureCashPeople } from '../profile/profile-cash-update.js';
import { SnapshotArchive } from './snapshot-archive.js';
import { PersistenceFacade, persistenceStorage } from './persistence-facade.js';

/** Der bestätigte Haushaltsplan kann bei einem geöffneten Außenprofil nur in
 * den Mitgliedsrecords liegen; alle Ablagen werden aus dem Backend gelesen. */
export async function confirmAnnualMonthSummary({ targetYear, scope, expectedProfileId, persistence = PersistenceFacade } = {}) {
    if (!scope?.ids?.length) return false;
    const records = await persistence.readPersistedRecords();
    if (records.rs_current_profile !== expectedProfileId) return false;
    const registry = JSON.parse(records.rs_profiles_v1);
    const summaries = scope.ids.map(id => readOverviewSummary(id === expectedProfileId ? records[OVERVIEW_SUMMARY_KEY]
        : registry.profiles[id]?.data?.[OVERVIEW_SUMMARY_KEY], targetYear + 1, scope));
    return summaries.every(item => item?.status === 'fest' && JSON.stringify(item) === JSON.stringify(summaries[0]));
}

/** Automatischer Monatsteil mit erneut erzeugbarer Sitzung; Retry schreibt nie das Jahr. */
export async function finalizeAnnualMonth({ createSession = createAnnualMonthSession, options } = {}) {
    let session = null, busy = false;
    const retry = async () => {
        if (busy) return false;
        busy = true;
        try {
            session ||= await createSession(options);
            return await session.save();
        } finally { busy = false; }
    };
    let error = null;
    try { if (!await retry()) throw new Error('Der Monatsabschluss wurde nicht bestätigt.'); }
    catch (failure) { error = failure; }
    return { get session() { return session; }, error, retry };
}

/** Erst nach Jahresfinalisierung und bestätigter Planpersistenz erzeugen. */
export async function createAnnualMonthSession({ targetYear, annualSnapshotId, cash, readModel, annualLease,
    readPending = () => null, readContext = () => null, guard,
    confirmSummary = async () => true, store = storeMonthProvision,
    capturePeople = model => captureCashPeople({ ids: model.scope.ids, activeId: model.activeId }),
    archive = SnapshotArchive } = {}) {
    let phase = 'preparing', monthSnapshotId = null;
    if (await confirmSummary() === false) throw new Error('Der neue Plan konnte nicht dauerhaft bestätigt werden. Das Jahr bleibt gespeichert.');
    const model = readModel();
    const blocked = () => readPending() || readModel().recovery || guard?.isBusy()
        || guard?.reasons().some(reason => ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase));
    if (blocked() || model.occasion?.annualState !== 'done' || model.occasion?.kind !== 'monthly'
        || model.summary?.status !== 'fest' || model.summary?.year !== targetYear + 1
        || model.summary?.scope?.key !== model.scope?.key
        || !Number.isFinite(model.summary?.monthlyWithdrawal) || !Number.isFinite(model.summary?.monthlyBudget)) {
        throw new Error('Das Jahr ist gespeichert. Ein passender bestätigter Plan für die Monatsbereitstellung fehlt oder der Speicher ist gesperrt.');
    }
    const people = structuredClone(capturePeople(model));
    if (!cash || people.some(person => person.error || person.value !== cash.values[person.id])
        || JSON.stringify(people.map(person => person.id).sort()) !== JSON.stringify(cash.people.map(person => person.id).sort())) {
        throw new Error('Die bestätigten Tagesgeldwerte wurden zwischenzeitlich geändert. Bitte den Monatsabschluss neu öffnen.');
    }
    // Neue Rohbelege nach dem Jahreswrite, dieselben einmal bestätigten Zahlen.
    const request = { month: model.occasion.month, scope: structuredClone(model.scope), expectedProfileId: model.activeId,
        cash: { people: structuredClone(people), values: { ...cash.values } } };
    const context = JSON.stringify(readContext()), summary = JSON.stringify(model.summary);
    const same = () => {
        const next = readModel();
        return next.activeId === model.activeId && next.scope?.key === model.scope.key
            && next.now?.toDateString() === model.now?.toDateString() && next.occasion?.month === request.month
            && next.occasion?.annualState === 'done' && !next.recovery && !readPending()
            && (phase === 'writing' || next.occasion?.kind === 'monthly')
            && JSON.stringify(next.summary) === summary && JSON.stringify(readContext()) === context
            && JSON.stringify(capturePeople(next)) === JSON.stringify(people);
    };
    phase = 'ready';
    return { model: structuredClone(model), request, annualSnapshotId,
        get phase() { return phase; },
        async save() {
            if (phase !== 'ready' || blocked() || !same()) return false;
            phase = 'writing';
            const owner = Symbol('annual-month-close');
            const controller = new AbortController();
            const lease = guard?.register(owner, { read: () => ({ phase: 'commit', message: 'Monat wird gespeichert – bitte warten.' }) });
            const operation = { controller, owns: candidate => candidate === owner && phase === 'writing',
                check() { if (phase !== 'writing' || !same()) throw new Error('Der Monatskontext wurde geändert.'); },
                commit() { this.check(); lease?.notify(); } };
            let before = [];
            try {
                before = await archive.listSnapshots(); operation.check();
                // Nach dem Schließen wurde der Jahresbesitz freigegeben. Ein
                // Monatsretry erwirbt ihn erneut über den bestehenden Writer.
                const ok = await store(request, { guard, navigationOperation: operation,
                    annualLease: annualLease?.released ? undefined : annualLease });
                operation.check();
                if (!ok) return false;
                const snapshots = await archive.listSnapshots();
                const receipt = snapshots.find(entry => entry.label === `Monatsabschluss ${request.month}`
                    && !before.some(old => old.id === entry.id))
                    || snapshots.find(entry => entry.id === monthSnapshotId);
                if (!receipt) throw new Error('Der Monatswiederherstellungspunkt konnte nicht eindeutig zugeordnet werden. Bitte den dauerhaften Monatsstand prüfen.');
                phase = 'done';
                this.result = { annualSnapshotId, monthSnapshotId: receipt?.id, model: this.model, cash: request.cash };
                return this.result;
            } catch (error) {
                try {
                    monthSnapshotId = (await archive.listSnapshots()).find(entry => entry.label === `Monatsabschluss ${request.month}`
                        && !before.some(old => old.id === entry.id))?.id || monthSnapshotId;
                } catch { /* Der Writer bleibt maßgeblich; ein Archivfehler bestätigt keinen Monat. */ }
                if (error?.code === 'rollback_failed') {
                    phase = 'recovery';
                    const recovery = { snapshotId: monthSnapshotId, release: null, block() {
                        this.release ||= PersistenceFacade.blockSyncWrites(['rs_profiles_v1', 'rs_current_profile', 'rs_active_profile'],
                            'Monatswiederherstellung erforderlich. Bitte den Monatswiederherstellungspunkt laden.',
                            { prefixes: ['profile_', 'balance_', 'overview_', 'depot_'] });
                    }, unblock() { this.release?.(); this.release = null; },
                    async restore({ opener, reload = () => globalThis.location.reload() } = {}) {
                        // Monatscash ist identisch zum Jahrescash. Nur die beiden
                        // Monatsrecords zurücknehmen, einschließlich aller Haushaltsmarker.
                        const snapshot = await archive.readSnapshot(this.snapshotId);
                        if (snapshot.activeProfileId !== request.expectedProfileId
                            || persistenceStorage.getItem('rs_current_profile') !== request.expectedProfileId) throw new Error('Der Wiederherstellungspunkt passt nicht zum Monatsprofil.');
                        const keys = ['rs_profiles_v1', OVERVIEW_MONTH_KEY];
                        // Vollständiges Ersatzziel für beide erlaubten Schlüssel:
                        // Fehlt der Monatsrecord im Snapshot, löscht der begrenzte
                        // replaceRecordsTransactional ihn aus Backend und Cache.
                        const records = Object.fromEntries(keys.filter(key => snapshot.records[key] !== undefined).map(key => [key, snapshot.records[key]]));
                        let written = false;
                        try {
                            const restored = await guard.reload({ opener, reload, flush: () => PersistenceFacade.flush(),
                                mutate: async navigationOperation => {
                                    await PersistenceFacade.replaceRecordsTransactional(records, {
                                        probelaufDomainWrite: true, navigationOperation, allowKey: key => keys.includes(key)
                                    });
                                    written = true;
                                    return true;
                                } });
                            return { status: restored ? 'restored' : 'reload_required' };
                        } catch (error) {
                            if (written) return { status: 'reload_required', error };
                            throw error;
                        } finally { this.block(); }
                    } };
                    recovery.block();
                    if (globalThis.window) globalThis.window.__balanceMonthRecovery = recovery;
                }
                throw error;
            } finally { if (phase === 'writing') phase = 'ready'; lease?.unregister(); }
        }
    };
}
