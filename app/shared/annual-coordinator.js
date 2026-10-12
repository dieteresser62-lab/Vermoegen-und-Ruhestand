import { deriveAnnualCloseEvidence, readAnnualCloseSnapshots } from './annual-close-evidence.js';
import { appNow } from './app-clock.js';
import { PersistenceFacade, persistenceStorage } from './persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { annualEngineLoader } from './annual-engine-loader.js';
import { createAnnualOperationLock } from './annual-operation-lock.js';
import { prepareAnnualMarketData, createAnnualMarketDataReaders, createManualAnnualQuote } from './annual-marketdata.js';
import { captureAnnualRecords, computeAnnualPlanUpdate } from '../balance/balance-annual-storage.js';
import { commitAnnualPlanUpdate } from '../balance/balance-annual-storage-commit.js';
import { buildBalanceEngineInputFromStorage } from '../balance/balance-input-storage.js';
import { CONFIG } from '../balance/balance-config.js';
import { createAnnualPeriodPlan, deriveCompletedCalendarYear, resolveLegacyAnnualPeriod,
    startAnnualPeriodCommit } from '../balance/balance-annual-period.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { captureCashPeople } from '../profile/profile-cash-update.js';
import { projectOverviewFromRecords } from '../overview/overview-model.js';
const annualOperations = new WeakSet();

/** Flüchtiger Besitzer: Kündigung umfasst auch Hilfswrites und Handler-Cleanup. */
export function createAnnualNavigationLifecycle({
    guard = null,
    flush = async () => true
} = {}) {
    let active = null, generation = 0;
    const read = () => active
        ? { phase: active.phase, annualPhase: active.annualPhase, operationId: active.id, revision: generation,
            message: active.phase === 'commit' ? 'Der Jahresprozess schreibt – bitte warten.' : 'Der Jahresprozess wird vorbereitet – beim Wechsel wird er abgebrochen.' }
        : { phase: 'idle', operationId: null, revision: generation };
    const registration = guard?.register(Symbol('balance-annual'), {
        read,
        async cancel({ operationId }) {
            const operation = active;
            if (!operation || operation.id !== operationId) return;
            if (operation.phase === 'commit') return false;
            operation.phase = 'cancelling';
            operation.controller.abort();
            registration.notify();
            await operation.ended;
            return !operation.failed;
        }
    });
    return {
        read,
        isBlocked: () => Boolean(active || guard?.isBusy() || guard?.reasons().some(reason => reason.phase === 'commit')),
        async run({ navigationOperation } = {}, execute) {
            if (navigationOperation) {
                if (!annualOperations.has(navigationOperation) || navigationOperation.phase !== 'commit') {
                    throw new Error('ANNUAL_OPERATION_INVALID');
                }
                navigationOperation.check();
                return execute(navigationOperation);
            }
            if (active || guard?.isBusy() || guard?.reasons().some(reason => ['commit', 'preparing', 'cancelling'].includes(reason.phase))) {
                return { ok: false, status: 'in_flight' };
            }
            let finish;
            const operation = {
                id: ++generation, phase: 'preparing', controller: new AbortController(),
                ended: new Promise(resolve => { finish = resolve; }),
                check() {
                    if (this.controller.signal.aborted) {
                        const error = new Error('Die Jahresvorbereitung wurde abgebrochen.');
                        error.name = 'AbortError';
                        throw error;
                    }
                },
                commit(annualPhase = this.annualPhase || 'writes_started') {
                    this.check();
                    this.phase = 'commit';
                    this.annualPhase = annualPhase;
                    registration?.notify();
                }
            };
            annualOperations.add(operation);
            active = operation;
            registration?.notify();
            try {
                const result = await execute(operation);
                operation.failed = result?.ok === false || ['invalid', 'incomplete_recovery'].includes(result?.status);
                return result;
            } catch (error) {
                operation.failed = error?.name !== 'AbortError';
                if (error?.name === 'AbortError') return { ok: false, status: 'cancelled' };
                throw error;
            }
            finally {
                try {
                    if (operation.phase === 'commit') {
                        try {
                            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                        } catch (error) {
                            operation.failed = true;
                            throw error;
                        }
                    }
                } finally {
                    annualOperations.delete(operation);
                    active = null;
                    registration?.notify();
                    finish();
                }
            }
        }
    };
}


export const ANNUAL_RETRY_SESSION_KEY = 'balance.annual-retry.once';
const RETRY_PROOF_KEY = `${ANNUAL_RETRY_SESSION_KEY}.proof`;
const RETRY_MAX_AGE_MS = 5 * 60 * 1000;
const consumedRetries = new WeakMap();
const retryEncoding = request => JSON.stringify(request);
function assertRetryShape(request, now) {
    if (!request || typeof request.token !== 'string' || !request.token
        || typeof request.profileId !== 'string' || !request.profileId
        || typeof request.snapshotId !== 'string' || !request.snapshotId
        || request.instrument !== 'VWCE.DE' || !Number.isInteger(request.targetYear)
        || request.periodId !== `calendar-year:${request.targetYear}`
        || !Number.isFinite(request.createdAt) || now < request.createdAt
        || now - request.createdAt > RETRY_MAX_AGE_MS) throw new Error('ANNUAL_RETRY_INVALID');
    createManualAnnualQuote(request.price, request.periodId);
}

/** Synchron konsumieren, bevor Seiteninitialisierung erstmals wartet. */
export function consumeAnnualRetry(storage = globalThis.sessionStorage, now = Date.now()) {
    try {
        const raw = storage?.getItem(ANNUAL_RETRY_SESSION_KEY);
        const proof = storage?.getItem(RETRY_PROOF_KEY);
        storage?.removeItem(ANNUAL_RETRY_SESSION_KEY);
        storage?.removeItem(RETRY_PROOF_KEY);
        if (!raw || proof !== raw) return null;
        const request = JSON.parse(raw);
        assertRetryShape(request, now);
        consumedRetries.set(request, raw);
        return request;
    } catch { return null; }
}

function readState(storage) {
    const raw = storage.getItem(CONFIG.STORAGE.LS_KEY);
    if (!raw) throw new Error('Der bestätigte Balancestand fehlt.');
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Der Balancestand ist ungültig.');
    return state;
}
const profileIdentity = storage => storage.getItem('rs_current_profile');

export async function validateAnnualRetry(request, { storage = persistenceStorage, archive = SnapshotArchive,
    getProfileId = () => profileIdentity(storage), getReferenceDate = appNow, now = Date.now(), scope } = {}) {
    try {
        assertRetryShape(request, now);
        if (consumedRetries.get(request) !== retryEncoding(request)
            || request.profileId !== getProfileId() || request.targetYear !== deriveCompletedCalendarYear(getReferenceDate())) return false;
        const ready = source => {
            const input = buildBalanceEngineInputFromStorage({ storage: source, scope, referenceYear: request.targetYear });
            const evidence = deriveAnnualCloseEvidence({ targetYear: request.targetYear, scope: input.scope,
                activeId: request.profileId, records: captureAnnualRecords(source) });
            return evidence.status === 'ready' && createAnnualPeriodPlan({ targetYear: request.targetYear,
                currentAge: input.inputData.aktuellesAlter,
                metadata: input.persistentState.annualPeriodMetadata ?? evidence.metadata,
                birthDate: source.getItem('profile_geburtsdatum') }).status === 'ready';
        };
        if (!ready(storage)) return false;
        const snapshot = await archive.readSnapshot(request.snapshotId);
        if (snapshot?.id !== request.snapshotId || snapshot.records?.rs_current_profile !== request.profileId
            || snapshot.kind !== SNAPSHOT_KINDS.annualClosePreMutation) return false;
        // Restore muss den vollständigen H3-Quellsatz bestätigt haben, nicht nur seine Periode.
        const liveSource = captureAnnualRecords(storage);
        const liveRecords = archive.captureCurrentRecords({ keys: Object.keys(liveSource), getItem: key => liveSource[key] });
        if (Object.keys(liveRecords).length !== Object.keys(snapshot.records).length
            || Object.keys(snapshot.records).some(key => liveRecords[key] !== snapshot.records[key])) return false;
        const source = { getItem: key => snapshot.records[key] ?? null };
        return ready(source) && ready(storage) && request.profileId === getProfileId();
    } catch { return false; }
}

/** Vollständiger H3-Rückkehrpunkt mit Payloadvergleich; IDs/Zeit injizierbar. */
export async function createAnnualSnapshot({ storage, archive, profileId, label, date, check, navigationOperation, snapshotId }) {
    const records = captureAnnualRecords(storage);
    const captured = archive.captureCurrentRecords({ keys: Object.keys(records), getItem: key => records[key] });
    check();
    const created = await archive.createSnapshot({ ...(snapshotId ? { id: snapshotId } : {}), label,
        createdAt: date.toISOString(), kind: SNAPSHOT_KINDS.annualClosePreMutation, records: captured, activeProfileId: profileId,
        restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'snapshot-full' }
    }, { navigationOperation });
    check();
    const saved = created?.id && await archive.readSnapshot(created.id);
    check();
    if (!saved || saved.id !== created.id || saved.records?.rs_current_profile !== profileId
        || JSON.stringify(saved.records) !== JSON.stringify(captured)) throw new Error('Der Wiederherstellungspunkt wurde nicht bytegleich bestätigt.');
    return saved.id;
}

/** Einziger produktiver Jahresablauf. Alle Seitenaktionen sind injizierte Anschlüsse. */
export function createAnnualCoordinator({ storage = persistenceStorage, persistence = PersistenceFacade, archive = SnapshotArchive,
    now = appNow, clock = Date.now, engineLoader = annualEngineLoader, operationLock = createAnnualOperationLock(),
    navigationLifecycle = createAnnualNavigationLifecycle(), scope,
    getProfileId = () => profileIdentity(storage),
    getPlanningStatus = date => projectOverviewFromRecords({ registry: JSON.parse(storage.getItem('rs_profiles_v1')), activeId: getProfileId(),
        liveData: captureAnnualRecords(storage), now: date, balanceSingleFallback: true }),
    confirmAnnual = async () => null, getLegacyDecision = async () => 'cancel',
    flushLiveState = () => persistence.flush(), validateLiveState = () => ({ ok: true }),
    prepareMarketData = options => prepareAnnualMarketData({ ...options, now, readers: createAnnualMarketDataReaders({ storage, now }) }),
    prepareAnnualDraft = computeAnnualPlanUpdate,
    createSnapshot = createAnnualSnapshot, snapshotId,
    commit = options => commitAnnualPlanUpdate({ ...options, storage, persistence, now }),
    projectAnnualState = () => {}, reportError = () => {}, clearError = () => {}, showPlanningStart = () => {},
    sessionStore = () => globalThis.sessionStorage, reload = () => globalThis.location.reload(),
    confirmRestore = async () => false,
    restoreSnapshot = async () => { throw new Error('Der geschützte Snapshotrestore ist nicht konfiguriert.'); }
} = {}) {
    let active = false;
    const report = error => { try { reportError(error); } catch { /* Anzeige bestätigt oder verwirft keinen Write. */ } };
    const inspectPeriod = async (options, operation) => {
        const targetYear = deriveCompletedCalendarYear(now()), profileId = getProfileId();
        const before = JSON.stringify(captureAnnualRecords(storage));
        const planningStatus = getPlanningStatus(now());
        const liveMetadata = readState(storage).annualPeriodMetadata;
        const pending = liveMetadata?.pendingCommit ? liveMetadata
            : planningStatus.periodSource?.metadata?.find(meta => meta?.pendingCommit);
        if (pending) return { ...createAnnualPeriodPlan({ targetYear, currentAge: 0, metadata: pending }), metadata: pending };
        if (planningStatus.recovery || planningStatus.occasion?.annualState === 'recovery') return { status: 'invalid', metadata: null,
            errors: [{ message: 'Der Jahresstand ist für Wiederherstellung gesperrt. Bitte zuerst den vorhandenen Wiederherstellungsweg verwenden.' }] };
        if (readState(storage).annualPeriodMetadata != null) return deriveAnnualCloseEvidence({ targetYear,
            scope: scope || planningStatus.scope, activeId: profileId, records: captureAnnualRecords(storage) });
        if (planningStatus.periodSource?.reason === 'contradictory') return { status: 'invalid', metadata: null, errors: [{ message: 'Die Jahresperiodenquellen widersprechen sich. Bitte zuerst den Jahresstand klären.' }] };
        if (options.resume && !await validateAnnualRetry(options.resume, { storage, archive, getProfileId, getReferenceDate: now, scope, now: clock() })) return { status: 'invalid', errors: [{ message: 'Die Wiederaufnahme ist nicht mehr gültig.' }], metadata: null };
        const sourceRecords = captureAnnualRecords(storage);
        const authoritative = planningStatus.periodSource?.metadata?.find(meta => meta != null);
        if (readState(storage).annualPeriodMetadata == null && authoritative
            && createAnnualPeriodPlan({ targetYear, currentAge: 0, metadata: authoritative }).status === 'already_committed') sourceRecords[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ ...readState(storage), annualPeriodMetadata: authoritative });
        const evidenceScope = scope || planningStatus.scope;
        const scopeKey = JSON.stringify(evidenceScope);
        const checkSources = () => {
            operation.check();
            if (before !== JSON.stringify(captureAnnualRecords(storage)) || profileId !== getProfileId()
                || targetYear !== deriveCompletedCalendarYear(now()) || persistence.hasSyncWriteBlocks?.()
                || scopeKey !== JSON.stringify(scope || getPlanningStatus(now()).scope)) {
                throw new Error('Die Jahresquellen wurden während der Belegprüfung geändert. Bitte erneut vorbereiten.');
            }
        };
        const snapshots = await readAnnualCloseSnapshots({ archive, targetYear, activeId: profileId,
            excludeSnapshotId: options.resume?.snapshotId, check: checkSources });
        const evidence = deriveAnnualCloseEvidence({ targetYear, scope: evidenceScope, activeId: profileId,
            records: sourceRecords, snapshots });
        checkSources();
        let resolved = evidence;
        if (evidence.status === 'legacy_confirmation_required' && options.clarify) {
            const decision = await getLegacyDecision(targetYear, { signal: operation.controller.signal, opener: options.opener });
            checkSources();
            if (decision === 'cancel' || decision == null) return { status: 'cancelled', metadata: null };
            // Undatierte Altmarker und isolierte markerlose Vorabpunkte können noch offen sein.
            if (decision !== 'already_committed' && !(decision === 'not_committed' && evidence.allowOpenConfirmation)) return evidence;
            resolved = resolveLegacyAnnualPeriod({ targetYear, decision });
        }
        if ((resolved.status === 'already_committed'
            || resolved.status === 'ready' && evidence.status === 'legacy_confirmation_required')
            && readState(storage).annualPeriodMetadata == null) {
            checkSources(); operation.commit('metadata_adoption');
            const raw = JSON.stringify({ ...readState(storage), annualPeriodMetadata: resolved.metadata });
            const baseRecords = JSON.parse(before), stateKey = CONFIG.STORAGE.LS_KEY;
            await persistence.replaceRecordsTransactional({ [stateKey]: raw }, {
                probelaufDomainWrite: true, navigationOperation: operation,
                expectedRecords: { [stateKey]: baseRecords[stateKey] },
                allowKey: key => {
                    operation.check();
                    const current = captureAnnualRecords(storage);
                    if (getProfileId() !== profileId || targetYear !== deriveCompletedCalendarYear(now())
                        || Object.keys(current).length !== Object.keys(baseRecords).length
                        || Object.keys(baseRecords).some(source => current[source] !== baseRecords[source]
                            && !(source === stateKey && current[source] === raw))) {
                        throw new Error('Die Jahresquellen wurden vor der Metadatenübernahme geändert.');
                    }
                    return key === stateKey;
                }
            });
        }
        return resolved;
    };
    const execute = async (options, operation) => {
        let metadata, started = false, completedResult, results, profileId, targetYear, confirmedDecision;
        const date = now();
        const context = () => JSON.stringify([getProfileId(), storage.getItem('rs_active_profile'), scope?.key]);
        const capturedContext = context();
        const check = () => { operation.check(); if (context() !== capturedContext
            || deriveCompletedCalendarYear(now()) !== deriveCompletedCalendarYear(date)
            || persistence.hasSyncWriteBlocks?.()) throw new Error('Der Jahreskontext ist geändert oder für Recovery gesperrt.'); };
        const persistMetadata = async next => {
            check();
            storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ ...readState(storage), annualPeriodMetadata: next }));
            if (await persistence.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            check();
        };
        try {
            check();
            targetYear = deriveCompletedCalendarYear(date);
            profileId = getProfileId();
            const status = getPlanningStatus(date);
            if (status.recovery) throw new Error('Der Speicher ist für Wiederherstellung gesperrt.');
            if (status.planning?.errors.length === 0 && status.firstPlanningYear > targetYear
                && status.occasion?.annualState === 'not_applicable' && !readState(storage).annualPeriodMetadata?.pendingCommit) {
                showPlanningStart({ firstPlanningYear: status.firstPlanningYear, opener: options.opener });
                return { status: 'not_applicable', firstPlanningYear: status.firstPlanningYear };
            }
            const evidence = await inspectPeriod({ ...options, clarify: true }, operation);
            if (evidence.status === 'cancelled') return evidence;
            if (evidence.status === 'invalid') { report(new Error(evidence.errors.map(entry => entry.message).join(' '))); return evidence; }
            const storedPeriod = createAnnualPeriodPlan({ targetYear, currentAge: 0, metadata: evidence.metadata });
            if (evidence.status === 'legacy_confirmation_required') { report(new Error(evidence.errors.map(entry => entry.message).join(' '))); return evidence; }
            if (['already_committed', 'incomplete_recovery', 'invalid'].includes(storedPeriod.status)) {
                if (storedPeriod.status !== 'already_committed') report(new Error(storedPeriod.errors?.map(error => error.message).join(' ')));
                return storedPeriod;
            }
            const expenses = loadExpensesStoreResult(storage);
            if (expenses.status !== 'ok' || !Number.isInteger(expenses.store.activeYear)
                || ![targetYear, targetYear + 1].includes(expenses.store.activeYear)) throw expenses.error || new Error('Der Ausgabenstore passt nicht zur Jahresperiode.');
            const input = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: targetYear });
            if (input.householdPlan.status !== 'valid') throw new Error('Der gemeinsame Plan muss bestätigt sein.');
            metadata = evidence.metadata;
            let planning = createAnnualPeriodPlan({ targetYear, currentAge: input.inputData.aktuellesAlter, metadata,
                birthDate: storage.getItem('profile_geburtsdatum') });
            if (planning.status === 'already_committed') return planning;
            if (!['ready', 'legacy_confirmation_required'].includes(planning.status)) { report(new Error(planning.errors?.map(e => e.message).join(' '))); return planning; }
            if (options.resume) {
                if (!await validateAnnualRetry(options.resume, { storage, archive, getProfileId, getReferenceDate: now, scope, now: clock() })) return { status: 'cancelled' };
                // Nur der tatsächliche Start verbraucht die Freigabe, Validierung darf mehrfach lesen.
                consumedRetries.delete(options.resume);
            }
            const base = JSON.stringify(captureAnnualRecords(storage));
            const confirmation = options.confirmedPreparation || await confirmAnnual({ targetYear, plan: planning.plan,
                label: input.inputData.profilName,
                people: captureCashPeople({ storage, ids: input.scope.ids, activeId: profileId }),
                signal: operation.controller.signal, cancel: () => operation.controller.abort() });
            check();
            if (!confirmation) return { status: 'cancelled' };
            // Nur den bestätigten Beschluss mitnehmen, keine Abrufresultate oder UI-Sitzung.
            confirmedDecision = structuredClone({ cash: confirmation.cash,
                adoptedPlanPatch: options.adoptedPlanPatch ?? confirmation.adoptedPlanPatch });
            if (base !== JSON.stringify(captureAnnualRecords(storage))) throw new Error('Die Jahresquellen wurden während der Bestätigung geändert.');
            clearError();
            const api = await engineLoader.load();
            check();
            if (base !== JSON.stringify(captureAnnualRecords(storage))) throw new Error('Die Jahresquellen wurden vor dem Speicherstart geändert.');
            const validation = await validateLiveState();
            check(); if (!validation?.ok) throw validation?.error || new Error('Die Jahresvorprüfung ist fehlgeschlagen.');
            if (await flushLiveState({ sync: true }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            check();
            const point = options.resume?.snapshotId || await createSnapshot({ storage, archive, profileId, label: input.inputData.profilName, date,
                check, navigationOperation: operation, snapshotId });
            check();
            const beginning = startAnnualPeriodCommit({ plan: planning.plan, metadata, snapshotId: point });
            if (!beginning.metadata) throw new Error('Der Jahresperiodenstart ist ungültig.');
            metadata = beginning.metadata; started = true;
            operation.commit('snapshot_confirmed'); await persistMetadata(metadata);
            metadata = { ...metadata, pendingCommit: { ...metadata.pendingCommit, phase: 'writes_started' } };
            operation.commit('writes_started'); await persistMetadata(metadata);
            const sources = JSON.stringify(captureAnnualRecords(storage));
            const prepared = await prepareMarketData({ targetYear, manualPrice: options.resume?.price ?? confirmation.manualPrice ?? options.manualPrice,
                preparedMarketData: confirmation.preparedMarketData, signal: operation.controller.signal, navigationOperation: operation, onProgress: options.onProgress });
            results = prepared?.results && { ...prepared.results, targetYear };
            check();
            if (sources !== JSON.stringify(captureAnnualRecords(storage))) throw new Error('Die Jahresquellen wurden während des Abrufs geändert.');
            if (!prepared?.ok) throw prepared?.error || new Error('Die Jahresdaten konnten nicht vollständig vorbereitet werden.');
            metadata = { ...metadata, pendingCommit: { ...metadata.pendingCommit, phase: 'validating' } };
            operation.commit('validating'); await persistMetadata(metadata);
            const draft = prepareAnnualDraft({ targetYear, marketData: prepared.marketData, scope, storage, now: () => date });
            const committed = await commit({ draft, cash: confirmation.cash, adoptedPlanPatch: options.adoptedPlanPatch ?? confirmation.adoptedPlanPatch,
                engineApi: api, navigationOperation: operation, now: () => date, isCurrent: () => context() === capturedContext });
            if (!committed.completed?.metadata || JSON.stringify(readState(storage).annualPeriodMetadata) !== JSON.stringify(committed.completed.metadata)) throw new Error('Der Jahresreadback wurde nicht bestätigt.');
            results = { ...results, ...committed.results, targetYear, endTime: date.getTime(), confirmed: true };
            committed.results = results;
            completedResult = { ...committed.completed, snapshotId: point, results };
            projectAnnualState(committed);
            return completedResult;
        } catch (error) {
            if (error.name !== 'AbortError') report(error);
            if (completedResult) return completedResult;
            if (started) return { status: 'incomplete_recovery', error, results, recovery: metadata.pendingCommit,
                retryContext: results?.errors?.some(entry => entry.step === 'ETF & Nachrücken')
                    ? { profileId, targetYear, periodId: metadata.pendingCommit.periodId, snapshotId: metadata.pendingCommit.snapshotId,
                        instrument: 'VWCE.DE', ...confirmedDecision } : null };
            return { status: error.name === 'AbortError' ? 'cancelled' : 'invalid', error };
        }
    };
    return {
        async reconcilePeriod(options = {}) {
            return operationLock.run(() => navigationLifecycle.run({}, operation => inspectPeriod(options, operation)), options.annualLease);
        },
        async close(options = {}) {
            if (active) return { status: 'in_flight' };
            active = true;
            try {
                const result = await operationLock.run(() => navigationLifecycle.run({}, operation => execute(options, operation)), options.annualLease);
                if (result?.status === 'in_flight') report(result.error || new Error('Der Jahresabschluss läuft bereits.'));
                return result;
            } catch (error) { report(error); return { status: 'invalid', error }; }
            finally { active = false; }
        },
        async retryAnnualWithManualPrice(context, price, options = {}) {
            try {
                const result = await operationLock.run(async () => {
                    const store = sessionStore();
                    const clear = () => { store.removeItem(ANNUAL_RETRY_SESSION_KEY); store.removeItem(RETRY_PROOF_KEY); };
                    try {
                        clear();
                        createManualAnnualQuote(price, context?.periodId);
                        const pending = readState(storage).annualPeriodMetadata?.pendingCommit;
                        if (context?.profileId !== getProfileId() || context.instrument !== 'VWCE.DE'
                            || pending?.periodId !== context.periodId || pending.snapshotId !== context.snapshotId
                            || context.targetYear !== deriveCompletedCalendarYear(now())) return { status: 'cancelled' };
                        // Ablage vor jedem Restorewrite prüfen.
                        store.setItem(RETRY_PROOF_KEY, 'probe');
                        if (store.getItem(RETRY_PROOF_KEY) !== 'probe') throw new Error('SESSION_STORAGE_UNAVAILABLE');
                        clear();
                        const original = await archive.readSnapshot(context.snapshotId);
                        if (original?.id !== context.snapshotId || original.records?.rs_current_profile !== context.profileId) throw new Error('Der Wiederherstellungspunkt passt nicht zum Profil.');
                        if (!await confirmRestore(context.snapshotId, options)) return { status: 'cancelled' };
                        if (JSON.stringify(await archive.readSnapshot(context.snapshotId)) !== JSON.stringify(original)
                            || JSON.stringify(readState(storage).annualPeriodMetadata?.pendingCommit) !== JSON.stringify(pending)
                            || context.profileId !== getProfileId()) throw new Error('Der Wiederherstellungskontext wurde geändert.');
                        const result = await restoreSnapshot(context.snapshotId, { ...options, reload: async () => {
                            if (context.profileId !== getProfileId()) throw new Error('Der Profilkontext wurde geändert.');
                            const request = { ...context, price, token: globalThis.crypto.randomUUID(), createdAt: clock() };
                            const raw = retryEncoding(request);
                            store.setItem(ANNUAL_RETRY_SESSION_KEY, raw); store.setItem(RETRY_PROOF_KEY, raw);
                            if (store.getItem(ANNUAL_RETRY_SESSION_KEY) !== raw || store.getItem(RETRY_PROOF_KEY) !== raw) throw new Error('SESSION_STORAGE_UNAVAILABLE');
                            if (await reload() === false) throw new Error('RELOAD_REFUSED');
                        } });
                        if (result?.status !== 'restored') clear();
                        return result;
                    } catch (error) { clear(); throw error; }
                }, options.annualLease);
                if (result?.status === 'in_flight') report(result.error);
                return result;
            } catch (error) { report(error); return { status: error.name === 'AbortError' ? 'cancelled' : 'invalid', error }; }
        }
    };
}
