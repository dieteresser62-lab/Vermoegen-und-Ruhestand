import { appNow } from '../shared/app-clock.js';
// @ts-check

import { CONFIG } from './balance-config.js';
import { StorageManager } from './balance-storage.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_STORAGE_KEYS, PROFILE_TRANCHES_KEY, PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { getProfileRegistry } from '../profile/profile-registry.js';
import { BALANCE_UPDATE_MODE } from './balance-update-pipeline.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { prepareHouseholdCash } from '../profile/profile-cash-update.js';
import { localHistoryDate } from '../tranches/tranchen-history-store.js';
import {
    createAnnualWealthHistoryEntry,
    createManualWealthHistoryEntry,
    readWealthHistory,
    upsertAnnualWealthHistory,
    upsertManualWealthHistory,
    formatLocalWealthHistoryDate
} from '../../types/wealth-history-contract.js';

const coordinators = new WeakMap();

// Historiewrites sind keine neue Vorschauquelle. Alle übrigen Live- und
// Registryquellen, einschließlich Haushaltsmitgliedschaft, bleiben gebunden.
function sourceFingerprint(storage, replacement = null) {
    const withoutHistory = raw => {
        if (!raw) return raw;
        try { const { wealthHistory, ...state } = JSON.parse(raw); return state; }
        catch { return raw; }
    };
    const registry = JSON.parse(replacement ? JSON.stringify(replacement.registry)
        : storage.getItem(PROFILE_STORAGE_KEYS.registry) || 'null');
    if (registry?.profiles) for (const profile of Object.values(registry.profiles)) {
        if (profile.data?.[CONFIG.STORAGE.LS_KEY]) {
            profile.data[CONFIG.STORAGE.LS_KEY] = withoutHistory(profile.data[CONFIG.STORAGE.LS_KEY]);
        }
    }
    return JSON.stringify([
        withoutHistory(replacement ? JSON.stringify(replacement.state) : storage.getItem(CONFIG.STORAGE.LS_KEY)),
        replacement ? replacement.tranches : storage.getItem(PROFILE_TRANCHES_KEY), registry,
        PROFILE_SCOPED_FIXED_KEYS.filter(key => key.startsWith('profile_')).map(key => [key, storage.getItem(key)])
    ]);
}

/** Ein Provider je Persistenz; eine Queuegeneration bleibt bis zum letzten Handler erhalten. */
function bindNavigation(coordinator, guard) {
    if (!guard || coordinator.guard === guard) return;
    // Die Persistenz kann länger leben als das Dokument. Einen alten Seitenguard
    // nur im Leerlauf ersetzen; laufende Jobs behalten ihren bisherigen Besitzer.
    if (coordinator.jobs.size) throw new Error('WEALTH_HISTORY_NAVIGATION_GUARD_CHANGED');
    coordinator.registration?.unregister();
    coordinator.guard = guard;
    coordinator.owner = Symbol('balance-wealth-history');
    coordinator.registration = guard.register(coordinator.owner, {
        read() {
            const jobs = [...coordinator.jobs].filter(job => !job.borrowed);
            const phase = jobs.some(job => job.operation.phase === 'commit') ? 'commit'
                : jobs.some(job => job.operation.controller.signal.aborted) ? 'cancelling'
                    : jobs.length ? 'preparing' : 'idle';
            return { phase, revision: coordinator.generation,
                operationId: jobs.length ? coordinator.generation : null,
                message: phase === 'commit' ? 'Vermögensstand wird geschrieben – bitte warten.'
                    : 'Vermögensstand wird vorbereitet – beim Wechsel wird die Erfassung abgebrochen.' };
        },
        async cancel({ operationId }) {
            if (operationId !== coordinator.generation) return false;
            const jobs = [...coordinator.jobs].filter(job => !job.borrowed);
            if (jobs.some(job => job.operation.phase === 'commit')) return false;
            // Erst alle abbrechen, dann warten: kein Job wartet auf sein eigenes Queueende.
            jobs.forEach(job => job.operation.controller.abort());
            coordinator.registration.notify();
            await Promise.all(jobs.map(job => job.ended));
            return jobs.every(job => !job.failed);
        }
    });
}

/** Gemeinsame Sperre auch für mehrere Dienstinstanzen mit derselben Persistenz. */
export function createBalanceWealthHistoryService({
    storage = persistenceStorage,
    persistence = PersistenceFacade,
    loadState = () => StorageManager.loadState(),
    loadRegistry = () => getProfileRegistry(storage),
    guard = globalThis.document ? getPageNavigationGuard() : null
} = {}) {
    if (!coordinators.has(storage)) coordinators.set(storage, {
        tail: Promise.resolve(), annual: 0, jobs: new Set(), operations: new WeakSet(), generation: 0
    });
    const coordinator = coordinators.get(storage);
    bindNavigation(coordinator, guard);
    const stateKey = CONFIG.STORAGE.LS_KEY;
    const registryKey = PROFILE_STORAGE_KEYS.registry;

    function captureContext() {
        const current = storage.getItem(PROFILE_STORAGE_KEYS.current);
        const active = storage.getItem(PROFILE_STORAGE_KEYS.active);
        if (!current || active !== current || !loadRegistry().profiles[current]) {
            throw new Error('Die Verlaufserfassung benötigt ein eindeutiges aktives Profil.');
        }
        return { current, active };
    }

    function assertContext(context) {
        if (storage.getItem(PROFILE_STORAGE_KEYS.current) !== context.current
            || storage.getItem(PROFILE_STORAGE_KEYS.active) !== context.active) {
            throw new Error('Das Profil wurde während der Verlaufserfassung gewechselt.');
        }
    }

    function assertNavigationReady(ownedOverviewOwner = null) {
        if (coordinator.guard?.isBusy() || coordinator.guard?.reasons().some(reason =>
            reason.owner !== coordinator.owner && reason.owner !== ownedOverviewOwner && ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase))) {
            const error = new Error('Eine andere Aktion oder Navigation läuft bereits. Bitte warten.');
            error.code = 'NAVIGATION_WRITE_BUSY';
            throw error;
        }
    }

    function enqueue(execute, navigationOperation, cleanupOnPreparationError = false, prepare = null) {
        if (!navigationOperation) assertNavigationReady();
        if (!coordinator.jobs.size) coordinator.generation += 1;
        let finish;
        const job = { borrowed: Boolean(navigationOperation), ended: new Promise(resolve => { finish = resolve; }) };
        const operation = navigationOperation || {
            phase: 'preparing', controller: new AbortController(),
            owns: owner => owner === coordinator.owner && coordinator.operations.has(operation),
            check() {
                if (this.controller.signal.aborted) {
                    const error = new Error('Die Verlaufsvorbereitung wurde abgebrochen.');
                    error.name = 'AbortError';
                    throw error;
                }
            },
            commit() { this.check(); this.phase = 'commit'; coordinator.registration?.notify(); }
        };
        job.operation = operation;
        coordinator.operations.add(operation);
        coordinator.jobs.add(job);
        coordinator.registration?.notify();
        let prepared, preparationError;
        // Klickquellen vor dem ersten Queuewarten fixieren, bereits unter eigenem Guardgrund.
        try { prepared = prepare?.(operation); } catch (error) { preparationError = error; }
        const result = coordinator.tail.then(async () => {
            try {
                operation.check();
                if (!navigationOperation) assertNavigationReady(prepared?.result?.overviewNavigationOwner
                    || prepared?.result?.overviewPersistence?.navigationOwner);
                if (preparationError) throw preparationError;
            } catch (error) {
                if (!cleanupOnPreparationError) throw error;
                preparationError = error;
            }
            // Auch vor dem Callback gekündigte UI-Jobs beenden ihren Cleanup unter Queuebesitz.
            const value = await execute(operation, preparationError, prepared);
            job.failed = value?.status === 'failed' || value?.ok === false && value?.status !== 'cancelled';
            return value;
        }).catch(error => {
            job.failed = error?.name !== 'AbortError';
            throw error;
        }).finally(() => {
            coordinator.operations.delete(operation);
            coordinator.jobs.delete(job);
            coordinator.registration?.notify();
            finish();
        });
        coordinator.tail = result.catch(() => {});
        return result;
    }

    async function persistEntry({ context, entry, metadata, expectedPending, validateSource = () => {}, navigationOperation, cash, annualInput, targetYear }) {
        const check = () => { navigationOperation.check(); assertContext(context); validateSource(); };
        check();
        if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        check();
        // Erst nach dem Warten lesen: keine Historie aus einem veralteten Candidate übernehmen.
        const state = loadState();
        const history = readWealthHistory(state);
        if (entry?.reason === 'manual' && state.annualPeriodMetadata?.pendingCommit) {
            throw new Error('Vor einer manuellen Erfassung muss der Jahresabschluss wiederhergestellt werden.');
        }
        if (expectedPending && JSON.stringify(state.annualPeriodMetadata) !== JSON.stringify(expectedPending)) {
            throw new Error('Der ausstehende Jahresabschluss wurde während der Erfassung verändert.');
        }
        const registry = loadRegistry();
        if (!registry.profiles[context.current]) throw new Error('Das erfasste Profil existiert nicht mehr.');
        const members = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
        const cashUpdate = cash ? prepareHouseholdCash({ storage, registry, activeId: context.current,
            ids: members.length ? members : [context.current], checkMembership: members.length > 0, cash, date: localHistoryDate() }) : null;
        if (cashUpdate && targetYear >= 2026) entry = createAnnualWealthHistoryEntry({ ...annualInput, tagesgeld: cashUpdate.total }, targetYear);
        const nextState = {
            ...state,
            ...(entry ? { wealthHistory: entry.reason === 'manual'
                ? upsertManualWealthHistory(history, entry)
                : upsertAnnualWealthHistory(history, entry) } : {}),
            ...(metadata ? { annualPeriodMetadata: metadata } : {})
        };
        const serialized = JSON.stringify(nextState);
        const cashRegistry = cashUpdate?.registry || registry;
        const nextRegistry = {
            ...cashRegistry,
            profiles: {
                ...cashRegistry.profiles,
                [context.current]: {
                    ...cashRegistry.profiles[context.current],
                    data: { ...cashRegistry.profiles[context.current].data, [stateKey]: serialized }
                }
            }
        };
        const records = { ...(cashUpdate?.records || {}), [stateKey]: serialized, [registryKey]: JSON.stringify(nextRegistry) };
        const keys = new Set(Object.keys(records));
        const previous = Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]));
        // Die Facade wartet intern erneut. Ihre Key-Prüfung prüft deshalb auch unmittelbar
        // vor dem Replace den Kontext und die beiden betroffenen Cache-Records.
        const allowKey = key => {
            navigationOperation.check();
            assertContext(context);
            validateSource({ state: nextState, registry: nextRegistry });
            for (const affected of keys) {
                const raw = storage.getItem(affected);
                if (raw !== previous[affected] && raw !== records[affected]) {
                    throw new Error('Der Balance-Zustand wurde während der Verlaufsschreibung verändert.');
                }
            }
            return keys.has(key);
        };
        await persistence.replaceRecordsTransactional(records, {
            probelaufDomainWrite: true, navigationOperation,
            allowKey,
            expectedRecords: Object.fromEntries(Object.entries(previous).filter(([, raw]) => raw !== null)),
            postValidate: confirmed => {
                assertContext(context);
                validateSource({ state: nextState, registry: nextRegistry });
                if (confirmed[stateKey] !== serialized || confirmed[registryKey] !== records[registryKey]) {
                    throw new Error('Der Vermögensverlauf konnte nicht dauerhaft bestätigt werden.');
                }
                return true;
            }
        });
        navigationOperation.check();
        assertContext(context);
        return nextState;
    }

    return {
        captureContext,
        assertContext,
        bindPreviewSource(result) {
            const fingerprint = sourceFingerprint(storage);
            const tranches = storage.getItem(PROFILE_TRANCHES_KEY);
            const inputFingerprint = JSON.stringify(result.inputData);
            return replacement => {
                result.validateWealthHistorySource?.();
                const current = sourceFingerprint(storage);
                if (JSON.stringify(result.inputData) !== inputFingerprint || (current !== fingerprint && (!replacement
                    || current !== sourceFingerprint(storage, { ...replacement, tranches })))) {
                    throw new Error('Die Vorschauquellen wurden während der Verlaufserfassung verändert.');
                }
            };
        },
        async waitForOverview({ result, context, validateSource, navigationOperation }) {
            const owner = result.overviewNavigationOwner || result.overviewPersistence?.navigationOwner;
            let conflicted = false;
            const observe = () => {
                if (coordinator.guard?.isBusy() || coordinator.guard?.reasons().some(reason =>
                    reason.owner !== owner && reason.owner !== coordinator.owner
                    && ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase))) conflicted = true;
            };
            observe();
            const unwatch = coordinator.guard?.subscribe(observe);
            const signal = navigationOperation?.controller.signal;
            let abort;
            const cancelled = signal && new Promise((resolve, reject) => {
                abort = () => { try { navigationOperation.check(); } catch (error) { reject(error); } };
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
            });
            try {
                const completion = cancelled ? Promise.race([result.overviewPersistence, cancelled]) : result.overviewPersistence;
                if (await completion === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                navigationOperation?.check();
                assertContext(context);
                validateSource();
                if (conflicted) {
                    const error = new Error('Eine andere Aktion oder Navigation hat die Verlaufsvorbereitung verändert.');
                    error.code = 'NAVIGATION_WRITE_BUSY';
                    throw error;
                }
                assertNavigationReady();
                this.assertManualReady();
            } finally { unwatch?.(); if (abort) signal.removeEventListener('abort', abort); }
        },
        assertManualReady() {
            if (coordinator.annual) throw new Error('Der Jahresabschluss läuft bereits.');
            if (loadState().annualPeriodMetadata?.pendingCommit) {
                throw new Error('Vor einer manuellen Erfassung muss der Jahresabschluss wiederhergestellt werden.');
            }
        },
        runManual(operation, { cleanupOnPreparationError = false, prepare = null } = {}) {
            return enqueue(operation, undefined, cleanupOnPreparationError, prepare);
        },
        runAnnual(operation, { navigationOperation } = {}) {
            const context = captureContext();
            coordinator.annual += 1;
            try {
                return enqueue(async owner => {
                    assertContext(context);
                    coordinator.annualOperation = owner;
                    try { return await operation(context, owner); }
                    finally { coordinator.annualOperation = null; }
                }, navigationOperation).finally(() => { coordinator.annual -= 1; });
            } catch (error) {
                coordinator.annual -= 1;
                throw error;
            }
        },
        // Wird ausschließlich innerhalb von runAnnual aufgerufen; kein zweiter Engine-Commit.
        finalizeAnnual({ context, result, targetYear, metadata, expectedPending, navigationOperation, cash }) {
            if (!result?.ok) throw result?.error || new Error('Der Balance-Periodencommit ist fehlgeschlagen.');
            const entry = targetYear >= 2026 ? createAnnualWealthHistoryEntry(result.inputData, targetYear) : null;
            const owner = navigationOperation || coordinator.annualOperation;
            if (!owner || owner !== coordinator.annualOperation) throw new Error('WEALTH_HISTORY_OPERATION_INVALID');
            return persistEntry({ context, entry, metadata, expectedPending, navigationOperation: owner, cash, annualInput: result.inputData, targetYear });
        },
        captureManual({ result, asOf, context = captureContext(), validateSource, navigationOperation }) {
            if (coordinator.annual) return Promise.reject(new Error('Der Jahresabschluss läuft bereits.'));
            assertContext(context);
            if (!result?.ok) return Promise.reject(result?.error || new Error('Aktuelle gültige Balance-Eingaben fehlen.'));
            const entry = createManualWealthHistoryEntry(result.inputData, asOf);
            if (navigationOperation) {
                if (!coordinator.operations.has(navigationOperation)) throw new Error('WEALTH_HISTORY_OPERATION_INVALID');
                return persistEntry({ context, entry, validateSource, navigationOperation });
            }
            return enqueue(owner => persistEntry({ context, entry, validateSource, navigationOperation: owner }));
        }
    };
}

/** Beide unterjährigen Auslöser lesen genau dieselbe frische PREVIEW. */
export function previewWealthHistory({ service, update, context, navigationOperation }) {
    service.assertContext(context);
    const result = update({ mode: BALANCE_UPDATE_MODE.PREVIEW, ...(navigationOperation ? { navigationOperation } : {}) });
    service.assertContext(context);
    if (!result?.ok) throw result?.error || new Error('Aktuelle gültige Balance-Eingaben fehlen.');
    return result;
}

/** UI-Koordination hält Klickdatum und frische Vorschau vor dem ersten Warten fest. */
export function createManualWealthHistoryController({ service, update, refresh, button, status,
    annualButtons = [], now = appNow, toast = () => {} }) {
    let manualBusy = false;
    let annualBusy = 0;
    const syncControls = () => {
        if (button) button.disabled = manualBusy || annualBusy > 0;
        annualButtons.forEach(control => { if (control) control.disabled = manualBusy || annualBusy > 0; });
    };
    const message = text => { if (status) status.textContent = text; };
    return {
        async capture() {
            if (manualBusy || annualBusy) return { status: 'in_flight' };
            manualBusy = true;
            syncControls();
            message('Stand wird geprüft und gespeichert …');
            try {
                const asOf = formatLocalWealthHistoryDate(now());
                // Queuebesitz beginnt synchron am Klick und umfasst Vorschau, Warten und UI-Cleanup.
                return await service.runManual(async (navigationOperation, preparationError, prepared) => {
                    try {
                        if (preparationError) throw preparationError;
                        const { context, result, validateSource, overviewReady } = prepared;
                        if (overviewReady) await overviewReady;
                        navigationOperation.check();
                        await service.captureManual({ result, asOf, context, validateSource, navigationOperation });
                        service.assertContext(context);
                        refresh();
                        message('Stand gesichert');
                        toast('Aktueller Vermögensstand gespeichert.');
                        return { status: 'saved' };
                    } catch (error) {
                        refresh();
                        message(`Stand nicht bestätigt: ${error.message || error}`);
                        return { status: error?.name === 'AbortError' ? 'cancelled' : 'failed', error };
                    } finally {
                        manualBusy = false;
                        syncControls();
                    }
                }, { cleanupOnPreparationError: true, prepare: navigationOperation => {
                    const context = service.captureContext();
                    const result = previewWealthHistory({ service, update, context, navigationOperation });
                    const validateSource = service.bindPreviewSource(result);
                    // Fremde Gründe auch während des ersten Queuewartens beobachten.
                    const overviewReady = result.overviewPersistence
                        ? service.waitForOverview({ result, context, validateSource, navigationOperation }) : null;
                    overviewReady?.catch(() => {}); // Die Queue verarbeitet den Fehler unter ihrem UI-Besitz.
                    return { context, result, validateSource, overviewReady };
                } });
            } catch (error) {
                refresh();
                message(`Stand nicht bestätigt: ${error.message || error}`);
                return { status: error?.name === 'AbortError' ? 'cancelled' : 'failed', error };
            } finally {
                manualBusy = false;
                syncControls();
            }
        },
        async withAnnual(operation) {
            if (manualBusy) return { status: 'in_flight' };
            annualBusy += 1;
            syncControls();
            message('');
            try { return await operation(); }
            finally {
                annualBusy -= 1;
                refresh();
                syncControls();
            }
        }
    };
}
