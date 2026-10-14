import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { appNow } from '../shared/app-clock.js';
import { OVERVIEW_SIMULATION_KEY, simulationEntryKey, assertSimulationRecord, readSimulationRecord } from './overview-simulation-summary.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { loadProfileRegistry, getCurrentProfileId } from '../profile/profile-registry.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { prepareHouseholdCash, liveCashData } from '../profile/profile-cash-update.js';
import { localHistoryDate } from '../tranches/tranchen-history-store.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';

export const OVERVIEW_BACKUP_KEY = 'overview_last_full_backup_v1';
export const OVERVIEW_SUMMARY_KEY = 'overview_balance_summary_v1';
export const OVERVIEW_MONTH_KEY = 'overview_month_provision_v1';
const monthWrites = new WeakMap();
const monthRecovery = new WeakMap();

/** Monatshaken und bestätigte Ist-Stände werden mit einem dauerhaften Replace bestätigt. */
async function storeMonthWithCash(request, { storage, flush, now, guard, navigationOperation, isBlocked,
    persistence = PersistenceFacade, archive = SnapshotArchive }) {
    const { month, scope, expectedProfileId, cash } = request;
    const lifecycle = createNavigationOperationLifecycle({ guard });
    return lifecycle.run({ navigationOperation }, async operation => {
        const check = () => {
            operation.check();
            if (isBlocked() || !matchesMonthContext(storage, expectedProfileId, scope)) throw new Error('OVERVIEW_CONTEXT_CHANGED');
        };
        check();
        if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        check();
        const registryRaw = storage.getItem('rs_profiles_v1');
        const registry = JSON.parse(registryRaw);
        if (scope.ids.every(id => readMonthProvision(id === expectedProfileId ? storage.getItem(OVERVIEW_MONTH_KEY)
            : registry.profiles[id].data[OVERVIEW_MONTH_KEY], month, scope))) return true;
        const date = now();
        // matchesMonthContext hat den Einzelprofil-Fallback bereits geprüft;
        // der gemeinsame Cashwriter prüft weiter Profil und sämtliche Rohwerte.
        const prepared = prepareHouseholdCash({ storage, registry, activeId: expectedProfileId, ids: scope.ids,
            checkMembership: scope.kind === 'household', cash, date: localHistoryDate(date), recordConfirmation: true });
        const record = { month, scope, completedAt: date.toISOString() };
        for (const id of scope.ids) {
            const data = prepared.registry.profiles[id].data;
            const raw = id === expectedProfileId ? storage.getItem(OVERVIEW_MONTH_KEY) : data[OVERVIEW_MONTH_KEY];
            data[OVERVIEW_MONTH_KEY] = JSON.stringify({ version: 1, entries: { ...readOverviewSummaries(raw), [JSON.stringify([month, scope.key])]: record } });
        }
        const records = { ...prepared.records, rs_profiles_v1: JSON.stringify(prepared.registry) };
        if (scope.ids.includes(expectedProfileId)) records[OVERVIEW_MONTH_KEY] = prepared.registry.profiles[expectedProfileId].data[OVERVIEW_MONTH_KEY];
        const keys = new Set(Object.keys(records));
        const expected = Object.fromEntries([...keys].map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
        // Der eigene Archivindex darf sich beim Anlegen des Vorabpunkts ändern.
        // Dieselbe Keypolicy wie im Punkt erhält sämtliche wiederherstellbaren
        // Finanzquellen und lässt ausschließlich Archiv-/Systemverwaltung aus.
        const captureSource = () => {
            const raw = liveCashData(storage);
            return archive.captureCurrentRecords({ keys: Object.keys(raw), getItem: key => raw[key] });
        };
        const source = captureSource();
        const retryKey = JSON.stringify([month, scope.key, expectedProfileId, cash, source]);
        let recovery = monthRecovery.get(storage);
        const assertSource = () => {
            check();
            if (JSON.stringify(captureSource()) !== JSON.stringify(source)) throw new Error('OVERVIEW_SOURCE_CHANGED');
        };
        assertSource();
        const archived = await archive.listSnapshots();
        if (recovery && !archived.some(entry => entry.id === recovery.id)) recovery = null;
        if (!recovery || recovery.key !== retryKey) {
            const saved = await archive.createSnapshot({ records: source,
                id: `month_${month}_${globalThis.crypto.randomUUID()}`,
                activeProfileId: expectedProfileId, activeProfileName: registry.profiles[expectedProfileId].meta.name,
                kind: SNAPSHOT_KINDS.monthlyClosePreMutation, label: `Monatsabschluss ${month}`, createdAt: date.toISOString() }, { navigationOperation: operation, guard });
            recovery = { key: retryKey, id: saved.id, records: saved.records };
            monthRecovery.set(storage, recovery);
        }
        const verified = await archive.readSnapshot(recovery.id);
        if (JSON.stringify(verified.records) !== JSON.stringify(recovery.records)) throw new Error('OVERVIEW_SNAPSHOT_READBACK_FAILED');
        assertSource();
        // Fremde Veränderungen an einem betroffenen Record dürfen auch im Rollback nicht ersetzt werden.
        const allowKey = key => {
            if (!keys.has(key)) return false;
            const raw = storage.getItem(key);
            if (raw !== (expected[key] ?? null) && raw !== records[key]) throw new Error('OVERVIEW_SOURCE_CHANGED');
            return true;
        };
        await persistence.replaceRecordsTransactional(records, { probelaufDomainWrite: true, navigationOperation: operation,
            allowKey, expectedRecords: expected, postValidate: () => { check(); return true; } });
        monthRecovery.delete(storage);
        return true;
    });
}

export function overviewScope(kind, ids) {
    if (!Array.isArray(ids)) return null;
    const members = [...new Set(ids)].sort();
    if (!['single', 'household'].includes(kind) || !members.length || members.some(id => typeof id !== 'string' || !id)
        || (kind === 'single' && members.length !== 1)) return null;
    return { kind, ids: members, key: JSON.stringify([kind, members]) };
}

export function readOverviewSummaries(raw) {
    try {
        const record = JSON.parse(raw);
        return record?.version === 1 && record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)
            ? record.entries : {};
    } catch { return {}; }
}

export function summaryEntryKey(year, scope) { return JSON.stringify([year, scope.key]); }

export function readOverviewSummary(raw, year, scope) {
    if (!scope) return null;
    const item = readOverviewSummaries(raw)[summaryEntryKey(year, scope)];
    if (!item || item.year !== year || item.scope?.key !== scope.key
        || !Number.isFinite(item.monthlyWithdrawal) || !Number.isFinite(item.monthlyBudget)
        || !Number.isFinite(Date.parse(item.createdAt))) return null;
    return item;
}

/** Nur der neue Anzeigeeintrag, auch beim Preview. Keine Fachstate-/Metadatenwrites. */
export function storeOverviewSummary(summary, { expectedProfileId, storage = persistenceStorage,
    flush = () => PersistenceFacade.flush(), guard = globalThis.document ? getPageNavigationGuard() : null,
    navigationOperation = null } = {}) {
    // Abbrechbare Datenvorbereitung (insbesondere Import-Dry-Runs) darf keinen
    // Anzeigeeintrag hinterlassen oder in einem Recovery-Snapshot verewigen.
    // Der bestätigte Import schreibt erst in seiner Commitphase.
    navigationOperation?.check();
    if (guard?.reasons().some(reason => ['preparing', 'cancelling'].includes(reason.phase)
        && !(reason.phase === 'preparing' && navigationOperation?.owns?.(reason.owner)))) return Promise.resolve(false);
    const scope = overviewScope(summary.scope?.kind, summary.scope?.ids || []);
    if (!scope || !Number.isInteger(summary.year) || !Number.isFinite(summary.monthlyWithdrawal)
        || !Number.isFinite(summary.monthlyBudget) || !Number.isFinite(Date.parse(summary.createdAt))
        || (scope.kind === 'single' && scope.ids[0] !== expectedProfileId)) return Promise.resolve(false);
    const loaded = loadProfileRegistry(storage);
    if (!expectedProfileId || getCurrentProfileId(storage) !== expectedProfileId || !loaded.value
        || scope.ids.some(id => !loaded.value.profiles[id])) return Promise.resolve(false);
    // Zwischen Identitätsprüfung und den Writes gibt es keinen asynchronen Wartepunkt.
    const record = { ...summary, scope };
    const registry = structuredClone(loaded.value);
    const encoded = data => JSON.stringify({ version: 1, entries: {
        ...readOverviewSummaries(data), [summaryEntryKey(record.year, scope)]: record
    } });
    const targets = scope.kind === 'household' ? scope.ids : [expectedProfileId];
    for (const id of targets) registry.profiles[id].data[OVERVIEW_SUMMARY_KEY] = encoded(id === expectedProfileId
        ? storage.getItem(OVERVIEW_SUMMARY_KEY) : registry.profiles[id].data[OVERVIEW_SUMMARY_KEY]);
    const navigationOwner = Symbol('overview-summary');
    const lease = guard?.register(navigationOwner, { read: () => ({ phase: 'commit', message: 'Plananzeige wird gespeichert – bitte warten.' }) });
    try {
        if (targets.includes(expectedProfileId)) storage.setItem(OVERVIEW_SUMMARY_KEY, registry.profiles[expectedProfileId].data[OVERVIEW_SUMMARY_KEY]);
        storage.setItem('rs_profiles_v1', JSON.stringify(registry));
        const completion = Promise.resolve().then(flush).then(ok => { if (ok === false) throw new Error('PERSISTENCE_FLUSH_FAILED'); return true; })
            .finally(() => lease?.unregister());
        // Nur dieser konkrete Folgewriter darf beim Warten als eigener gelten.
        completion.navigationOwner = navigationOwner;
        return completion;
    } catch (error) { lease?.unregister(); throw error; }
}

export function readLastFullBackup(storage = persistenceStorage) {
    const raw = storage.getItem(OVERVIEW_BACKUP_KEY);
    return typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? raw : null;
}

export function readMonthProvision(raw, month, scope) {
    if (!scope || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const entry = readOverviewSummaries(raw)[JSON.stringify([month, scope.key])];
    const entryScope = entry && overviewScope(entry.scope?.kind, entry.scope?.ids);
    return entry?.month === month && entry.scope?.key === scope.key && entryScope?.key === scope.key
        && typeof entry.completedAt === 'string' && Number.isFinite(Date.parse(entry.completedAt)) ? entry : null;
}

/** Die angezeigte Mitgliedschaft wird am Write nochmals aus der Registry geprüft. */
function matchesMonthContext(storage, expectedProfileId, scope) {
    const registry = loadProfileRegistry(storage).value;
    if (!registry?.profiles[expectedProfileId]) return false;
    if (storage.getItem('rs_current_profile') !== expectedProfileId) return false;
    const activeId = storage.getItem('rs_active_profile');
    if (activeId !== null && activeId !== expectedProfileId) return false;
    const ids = Object.entries(registry.profiles).filter(([, profile]) => profile.meta.belongsToHousehold !== false).map(([id]) => id);
    // Wie die Seitenprojektion: Ohne Haushaltsmitglieder gilt das geöffnete
    // Profil allein. Eine vorhandene Mitgliedschaft bleibt weiterhin maßgeblich.
    if (!ids.length) ids.push(expectedProfileId);
    const current = overviewScope(ids.length === 1 && ids[0] === expectedProfileId ? 'single' : 'household', ids);
    return current?.key === scope.key;
}

/** Ein bestätigter Haken für den Vormonat; keine Buchung und kein Jahrescommit. */
export function storeMonthProvision(request, options = {}) {
    return withAnnualWriteAccess(() => storeMonthProvisionOwned(request, options), options);
}

function storeMonthProvisionOwned({ month, scope: suppliedScope, expectedProfileId, cash }, {
    storage = persistenceStorage, flush = () => PersistenceFacade.flush(), now = appNow,
    guard = globalThis.document ? getPageNavigationGuard() : null,
    navigationOperation = null,
    isBlocked = () => PersistenceFacade.hasSyncWriteBlocks() || Boolean(globalThis.window?.__profileRecoveryBlocker),
    persistence = PersistenceFacade, archive = SnapshotArchive
} = {}) {
    if (monthWrites.has(storage)) return Promise.resolve(false);
    navigationOperation?.check();
    const reasons = guard?.reasons() || [];
    const ownsCommit = reason => reason.phase === 'commit' && navigationOperation?.owns?.(reason.owner);
    const scope = overviewScope(suppliedScope?.kind, suppliedScope?.ids || []);
    if (!scope || scope.key !== suppliedScope?.key || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
        || isBlocked() || guard?.isBusy() || reasons.some(reason => !ownsCommit(reason))
        || !matchesMonthContext(storage, expectedProfileId, scope)) return Promise.resolve(false);
    if (cash) {
        const job = storeMonthWithCash({ month, scope, expectedProfileId, cash }, { storage, flush, now, guard, navigationOperation, isBlocked, persistence, archive });
        monthWrites.set(storage, job);
        return job.finally(() => monthWrites.delete(storage));
    }
    // Ein geliehener Binderbesitz bleibt bis zu dessen Cleanup registriert.
    // Direkte Storeaufrufe halten weiterhin eine eigene Lease über beide Flushs.
    const lease = reasons.some(ownsCommit) ? null : guard?.register(Symbol('overview-month'), {
        read: () => ({ phase: 'commit', message: 'Monatshaken wird gespeichert – bitte warten.' })
    });
    const job = (async () => {
        let liveBefore, writtenLive, previous = {}, written = {};
        const restore = () => {
            // Nur eigene Records zurücknehmen, auch nach einem fremden Profilwechsel.
            if (writtenLive !== undefined && storage.getItem(OVERVIEW_MONTH_KEY) === writtenLive) {
                if (liveBefore === null) storage.removeItem(OVERVIEW_MONTH_KEY);
                else storage.setItem(OVERVIEW_MONTH_KEY, liveBefore);
            }
            const loaded = loadProfileRegistry(storage).value;
            if (!loaded) return;
            let changed = false;
            for (const id of Object.keys(written)) {
                const data = loaded.profiles[id]?.data;
                if (data?.[OVERVIEW_MONTH_KEY] !== written[id]) continue;
                if (previous[id] === undefined) delete data[OVERVIEW_MONTH_KEY];
                else data[OVERVIEW_MONTH_KEY] = previous[id];
                changed = true;
            }
            if (changed) storage.setItem('rs_profiles_v1', JSON.stringify(loaded));
        };
        try {
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            navigationOperation?.check();
            if (isBlocked() || !matchesMonthContext(storage, expectedProfileId, scope)) return false;
            const registry = structuredClone(loadProfileRegistry(storage).value);
            liveBefore = storage.getItem(OVERVIEW_MONTH_KEY);
            const sources = scope.ids.map(id => id === expectedProfileId ? liveBefore : registry.profiles[id].data[OVERVIEW_MONTH_KEY]);
            if (sources.every(raw => readMonthProvision(raw, month, scope))) return true;
            const record = { month, scope, completedAt: now().toISOString() };
            for (const id of scope.ids) {
                previous[id] = registry.profiles[id].data[OVERVIEW_MONTH_KEY];
                const raw = id === expectedProfileId ? liveBefore : previous[id];
                written[id] = JSON.stringify({ version: 1, entries: { ...readOverviewSummaries(raw), [JSON.stringify([month, scope.key])]: record } });
                registry.profiles[id].data[OVERVIEW_MONTH_KEY] = written[id];
            }
            // Keine asynchrone Lücke zwischen Identitätsprüfung und Writes.
            if (scope.ids.includes(expectedProfileId)) {
                writtenLive = written[expectedProfileId];
                storage.setItem(OVERVIEW_MONTH_KEY, writtenLive);
            }
            storage.setItem('rs_profiles_v1', JSON.stringify(registry));
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            navigationOperation?.check();
            if (isBlocked() || !matchesMonthContext(storage, expectedProfileId, scope)) throw new Error('OVERVIEW_CONTEXT_CHANGED');
            return true;
        } catch (error) {
            restore();
            if (Object.keys(written).length) {
                try { await flush(); } catch { /* Kein bestätigter Haken; UI meldet den Fehler. */ }
            }
            throw error;
        }
    })();
    monthWrites.set(storage, job);
    return job.finally(() => { monthWrites.delete(storage); lease?.unregister(); });
}

/** Ergebnisablage mit eigenem Navigationsbesitzer und bedingtem Rollback. */
export function storeSimulationSummary(summary, { expectedProfileId, storage = persistenceStorage,
    flush = () => PersistenceFacade.flush(), guard = globalThis.document ? getPageNavigationGuard() : null,
    isCurrent = () => true, isBlocked = () => PersistenceFacade.hasSyncWriteBlocks() || Boolean(globalThis.window?.__profileRecoveryBlocker)
} = {}) {
    const scope = overviewScope(summary?.scope?.kind, summary?.scope?.ids);
    if (!scope || scope.key !== summary.scope.key || !isCurrent() || isBlocked()
        || guard?.reasons().some(reason => ['preparing', 'cancelling'].includes(reason.phase))) return Promise.resolve(false);
    const matches = () => {
        if (!isCurrent() || isBlocked() || storage.getItem('rs_current_profile') !== expectedProfileId) return false;
        const active = storage.getItem('rs_active_profile');
        if (active !== null && active !== expectedProfileId) return false;
        const registry = loadProfileRegistry(storage).value;
        if (!registry?.profiles[expectedProfileId] || scope.ids.some(id => !registry.profiles[id])) return false;
        if (scope.kind === 'single') return scope.ids[0] === expectedProfileId;
        const ids = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
        return overviewScope('household', ids)?.key === scope.key;
    };
    if (!matches()) return Promise.resolve(false);
    summary = structuredClone({ ...summary, scope });
    const key = simulationEntryKey(scope, summary.kind);
    try { assertSimulationRecord({ version: 1, entries: { [key]: summary } }); } catch { return Promise.resolve(false); }
    const lease = guard?.register(Symbol('overview-simulation'), { read: () => ({ phase: 'commit', message: 'Simulationsergebnis wird gespeichert – bitte warten.' }) });
    return (async () => {
        const previous = {}, written = {};
        let liveBefore, liveWritten;
        // Auch einzelne Einträge fremder neuerer Records bleiben erhalten.
        const undo = (raw, before) => {
            const entries = readSimulationRecord(raw).entries;
            if (JSON.stringify(entries[key]) !== JSON.stringify(summary)) return raw;
            const old = readSimulationRecord(before).entries[key];
            if (old) entries[key] = old; else delete entries[key];
            return Object.keys(entries).length ? JSON.stringify({ version: 1, entries }) : before ?? null;
        };
        try {
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            if (!matches()) return false;
            const registry = structuredClone(loadProfileRegistry(storage).value);
            liveBefore = storage.getItem(OVERVIEW_SIMULATION_KEY);
            for (const id of scope.ids) {
                previous[id] = registry.profiles[id].data[OVERVIEW_SIMULATION_KEY];
                const raw = id === expectedProfileId ? liveBefore : previous[id];
                written[id] = JSON.stringify({ version: 1, entries: { ...readSimulationRecord(raw).entries, [key]: summary } });
                registry.profiles[id].data[OVERVIEW_SIMULATION_KEY] = written[id];
            }
            if (!matches()) return false;
            if (scope.ids.includes(expectedProfileId)) {
                liveWritten = written[expectedProfileId];
                storage.setItem(OVERVIEW_SIMULATION_KEY, liveWritten);
            }
            // Ein injizierter Speicher kann den Kontext auch synchron wechseln.
            if (!matches()) throw new Error('OVERVIEW_CONTEXT_CHANGED');
            storage.setItem('rs_profiles_v1', JSON.stringify(registry));
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            if (!matches()) throw new Error('OVERVIEW_CONTEXT_CHANGED');
            return true;
        } catch (error) {
            if (liveWritten !== undefined) {
                const raw = storage.getItem(OVERVIEW_SIMULATION_KEY), restored = undo(raw, liveBefore);
                if (restored !== raw) { if (restored === null) storage.removeItem(OVERVIEW_SIMULATION_KEY); else storage.setItem(OVERVIEW_SIMULATION_KEY, restored); }
            }
            const registry = loadProfileRegistry(storage).value;
            let changed = false;
            for (const id of Object.keys(written)) {
                const data = registry?.profiles[id]?.data;
                if (!data) continue;
                const raw = data[OVERVIEW_SIMULATION_KEY], restored = undo(raw, previous[id]);
                if (raw === restored) continue;
                if (restored === null || restored === undefined) delete data[OVERVIEW_SIMULATION_KEY]; else data[OVERVIEW_SIMULATION_KEY] = restored;
                changed = true;
            }
            if (changed) storage.setItem('rs_profiles_v1', JSON.stringify(registry));
            try { if (liveWritten || changed) await flush(); } catch { /* Unbestätigte Ablage; Fachresultat bleibt erhalten. */ }
            throw error;
        } finally { lease?.unregister(); }
    })();
}
