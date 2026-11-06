
import { areaHousehold, isPlayArea } from './household-registry.js';
import { CONFIG } from '../balance/balance-config.js';
import { isAllowedSnapshotCaptureKey, isLegacySnapshotKey } from './persistence-key-policy.js';

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_TYPE = 'persistence-records-v1';
const SNAPSHOT_KIND_MANUAL = 'manual';
const PROFILE_STORAGE_KEYS = Object.freeze({
    registry: 'rs_profiles_v1',
    current: 'rs_current_profile',
    active: 'rs_active_profile'
});
const DEFAULT_STATE = Object.freeze({
    schemaVersion: 1,
    records: {},
    metadata: {}
});
const DEFAULT_SNAPSHOT_ARCHIVE = Object.freeze({
    schemaVersion: 1,
    snapshots: []
});

function getInvoke(options = {}) {
    if (typeof options.invoke === 'function') return options.invoke;
    const invoke = globalThis.window?.__TAURI__?.core?.invoke
        || globalThis.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') {
        throw new Error('Tauri invoke API ist nicht verfuegbar.');
    }
    return invoke;
}

function normalizeState(raw) {
    if (!raw) return { ...DEFAULT_STATE, records: Object.create(null), metadata: Object.create(null) };
    const parsed = JSON.parse(String(raw));
    const records = Object.create(null);
    Object.entries(parsed.records || {}).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        records[String(key)] = String(value);
    });
    const metadata = Object.create(null);
    Object.entries(parsed.metadata || {}).forEach(([key, value]) => {
        metadata[String(key)] = value;
    });
    return {
        schemaVersion: Number(parsed.schemaVersion) || 1,
        records,
        metadata
    };
}

function serializeState(state) {
    return JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        records: state.records,
        metadata: state.metadata
    }, null, 2);
}

function normalizeSnapshotArchive(raw) {
    if (!raw) return { ...DEFAULT_SNAPSHOT_ARCHIVE, snapshots: [] };
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tauri-Snapshot-Archiv ist ungueltig.');
    }
    if (Number(parsed.schemaVersion) !== 1) {
        throw new Error(`Tauri-Snapshot-Archiv-Schema ${parsed.schemaVersion} wird nicht unterstuetzt.`);
    }
    if (!Array.isArray(parsed.snapshots)) {
        throw new Error('Tauri-Snapshot-Archiv enthaelt keine gueltige Snapshot-Liste.');
    }
    return {
        schemaVersion: 1,
        savedAt: parsed.savedAt ? String(parsed.savedAt) : '',
        snapshots: parsed.snapshots.filter(snapshot => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot))
    };
}

function serializeSnapshotArchive(archive) {
    return JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        snapshots: archive.snapshots || []
    }, null, 2);
}

function toSnapshotIndexEntry(snapshot) {
    const { records, ...indexEntry } = snapshot || {};
    return indexEntry;
}

function parseJsonObject(raw, fallback = null) {
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function parseLegacySnapshot(raw) {
    const parsed = parseJsonObject(raw, null);
    if (parsed?.snapshotType !== 'full-localstorage' || !parsed.localStorage || typeof parsed.localStorage !== 'object') {
        return null;
    }
    return parsed;
}

function getProfileNameFromLegacyRecords(records, activeProfileId) {
    const registry = parseJsonObject(records[PROFILE_STORAGE_KEYS.registry], null);
    return String(registry?.profiles?.[activeProfileId]?.meta?.name || '');
}

function resolveLegacyActiveProfileId(records) {
    const explicit = String(records[PROFILE_STORAGE_KEYS.current] || records[PROFILE_STORAGE_KEYS.active] || '');
    if (explicit) return explicit;
    if (!records[PROFILE_STORAGE_KEYS.registry]) return 'default';
    return '';
}

function asIsoDate(value) {
    const date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) return new Date().toISOString();
    return date.toISOString();
}

function buildCanonicalSnapshotFromLegacy(key, legacySnapshot) {
    const sourceRecords = legacySnapshot.localStorage || {};
    const records = Object.create(null);
    Object.entries(sourceRecords).forEach(([recordKey, value]) => {
        const normalizedKey = String(recordKey || '');
        if (!isAllowedSnapshotCaptureKey(normalizedKey)) return;
        if (value === null || value === undefined) return;
        records[normalizedKey] = String(value);
    });
    const activeProfileId = resolveLegacyActiveProfileId(sourceRecords);
    const label = legacySnapshot.label || String(key || '').replace(CONFIG.STORAGE.SNAPSHOT_PREFIX, '');
    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: String(key || '').replace(CONFIG.STORAGE.SNAPSHOT_PREFIX, 'snapshot_legacy_') || undefined,
        snapshotType: SNAPSHOT_TYPE,
        label,
        kind: SNAPSHOT_KIND_MANUAL,
        createdAt: asIsoDate(legacySnapshot.timestamp || legacySnapshot.createdAt),
        activeProfileId,
        activeProfileName: activeProfileId ? getProfileNameFromLegacyRecords(sourceRecords, activeProfileId) : '',
        recordCount: Object.keys(records).length,
        records,
        restoreScope: {
            profileRegistryMode: 'preserve-by-default',
            profileLiveDataMode: 'restore-only-if-active-profile-still-exists'
        }
    };
}

function getCanonicalLegacySnapshotId(id) {
    const normalized = String(id || '');
    return isLegacySnapshotKey(normalized)
        ? normalized.replace(CONFIG.STORAGE.SNAPSHOT_PREFIX, 'snapshot_legacy_')
        : normalized;
}

function createLegacyMigrationReport() {
    return {
        migratedCount: 0,
        skippedCount: 0,
        notStandardRestorableCount: 0,
        errors: []
    };
}

export function createTauriJsonFileAdapter(options = {}) {
    // Weitere Haushalte: Rust bildet den Ordner households/<Kennung>/ selbst, die Oberfläche liefert keinen Pfad.
    const household = areaHousehold(options.area);
    const scope = household ? { household } : {};
    const play = isPlayArea(options.area);
    // HV-4: Jeder native Write nennt die Verzeichnis-Generation dieses Dokuments; Rust weist veraltete ab.
    const generation = () => { const value = options.expectedGeneration?.(); return Number.isSafeInteger(value) ? { expectedGeneration: value } : {}; };
    const saveState = async args => {
        try { await invoke('save_app_state', { ...args, ...generation() }); }
        catch (error) {
            if (!String(error?.message || error).startsWith('HOUSEHOLD_CONTEXT_CHANGED')) throw error;
            throw Object.assign(new Error('Der Haushalt wurde inzwischen gewechselt. Bitte neu laden; Eingaben werden bis dahin nicht gespeichert.'), { code: 'PERSISTENCE_RELOAD_REQUIRED', cause: error });
        }
    };
    const liveTarget = play ? { target: 'spiel', ...scope } : { ...scope };
    const snapshotTarget = play ? 'spielsnapshots' : 'snapshots';
    let invoke = null;
    /** @type {{schemaVersion: number, records: Record<string, string>, metadata: Record<string, unknown>}} */
    let state = { ...DEFAULT_STATE, records: Object.create(null), metadata: Object.create(null) };
    /** @type {{schemaVersion: number, snapshots: import('../../typcheck/runtime-contracts.js').JsonRecord[], savedAt?: string}} */
    let snapshotArchive = { ...DEFAULT_SNAPSHOT_ARCHIVE, snapshots: [] };
    let opened = false;
    let snapshotsOpened = false;

    async function persist() {
        await saveState({ ...liveTarget, content: serializeState(state) });
    }

    async function loadSnapshotArchive() {
        if (!invoke) invoke = getInvoke(options);
        const raw = await invoke('load_app_state', { target: snapshotTarget, ...scope });
        try { return normalizeSnapshotArchive(raw); }
        catch (cause) {
            if (!play) throw cause;
            const quarantinePath = await invoke('quarantine_app_state', { target: snapshotTarget, ...scope, ...generation() });
            const error = new Error('Sicherungspunkte konnten nicht gelesen werden. Die beschädigte Datei wurde gesichert.');
            Object.assign(error, { code: 'tauri-snapshots-corrupt', quarantinePath, cause });
            throw error;
        }
    }

    async function ensureSnapshotsOpen() {
        if (snapshotsOpened) return;
        snapshotArchive = await loadSnapshotArchive();
        snapshotsOpened = true;
    }

    async function persistSnapshots() {
        await saveState({
            target: snapshotTarget,
            ...scope,
            content: serializeSnapshotArchive(snapshotArchive)
        });
    }

    return {
        name: 'Tauri JSON File',
        async open() {
            invoke = getInvoke(options);
            const raw = await invoke('load_app_state', liveTarget);
            try {
                state = normalizeState(raw);
            } catch (err) {
                let quarantinePath = '';
                try {
                    quarantinePath = await invoke('quarantine_app_state', { ...liveTarget, ...generation() });
                } catch (quarantineErr) {
                    /** @type {import('../../typcheck/runtime-contracts.js').AppError} */
                    const wrapped = new Error(`Tauri-Daten konnten nicht gelesen und nicht quarantiniert werden: ${quarantineErr?.message || quarantineErr}`);
                    wrapped.code = 'tauri-state-corrupt';
                    wrapped.cause = err;
                    throw wrapped;
                }
                /** @type {import('../../typcheck/runtime-contracts.js').AppError} */
                const wrapped = new Error('Tauri-Daten konnten nicht gelesen werden. Die beschaedigte Datei wurde gesichert.');
                wrapped.code = 'tauri-state-corrupt';
                wrapped.quarantinePath = quarantinePath;
                wrapped.cause = err;
                throw wrapped;
            }
            opened = true;
        },
        async loadAll() {
            return state.records;
        },
        async readPersistedRecords() {
            if (!invoke) invoke = getInvoke(options);
            return normalizeState(await invoke('load_app_state', liveTarget)).records;
        },
        async readPersistedSnapshot(id) {
            if (!invoke) invoke = getInvoke(options);
            const read = async () => (await loadSnapshotArchive()).snapshots.find(entry => entry.id === getCanonicalLegacySnapshotId(id));
            let point = await read();
            if (!point) { await this.migrateLegacySnapshotsIfNeeded(); point = await read(); }
            if (!point) throw new Error(`Snapshot ${id} wurde nicht gefunden.`);
            return point;
        },
        async readPersistedSnapshots() {
            if (!invoke) invoke = getInvoke(options);
            return (await loadSnapshotArchive()).snapshots;
        },
        async saveBatch(batch) {
            if (!opened) await this.open();
            batch.deletes.forEach(key => {
                delete state.records[String(key)];
            });
            batch.upserts.forEach(([key, value]) => {
                if (value === null || value === undefined) return;
                state.records[String(key)] = String(value);
            });
            await persist();
        },
        async readMetadata(key) {
            return state.metadata[String(key)] ?? null;
        },
        async writeMetadata(key, value) {
            state.metadata[String(key)] = value;
            await persist();
        },
        async listSnapshots() {
            await this.migrateLegacySnapshotsIfNeeded();
            await ensureSnapshotsOpen();
            return snapshotArchive.snapshots.map(toSnapshotIndexEntry);
        },
        async readSnapshot(id) {
            await ensureSnapshotsOpen();
            const snapshotId = String(id || '');
            let snapshot = snapshotArchive.snapshots.find(entry => String(entry?.id || '') === getCanonicalLegacySnapshotId(snapshotId));
            if (!snapshot) {
                await this.migrateLegacySnapshotsIfNeeded();
                snapshot = snapshotArchive.snapshots.find(entry => String(entry?.id || '') === getCanonicalLegacySnapshotId(snapshotId));
            }
            if (!snapshot) {
                throw new Error(`Snapshot ${snapshotId} wurde nicht gefunden.`);
            }
            return snapshot;
        },
        async writeSnapshot(snapshot) {
            await ensureSnapshotsOpen();
            const snapshotId = String(snapshot?.id || '');
            if (!snapshotId) {
                throw new Error('Snapshot-ID fehlt.');
            }
            const snapshots = snapshotArchive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
            snapshots.push(snapshot);
            snapshotArchive = { ...snapshotArchive, snapshots };
            await persistSnapshots();
            return true;
        },
        // DS-2: mehrere Punkte mit einem Schreiben der Punktedatei (Spielbereich-Start mit Kopie).
        async writeSnapshots(points) {
            await ensureSnapshotsOpen();
            const ids = new Set(points.map(point => String(point?.id || '')));
            if (ids.has('') || ids.size !== points.length) throw new Error('Snapshot-ID fehlt oder ist doppelt.');
            snapshotArchive = { ...snapshotArchive, snapshots: [...snapshotArchive.snapshots.filter(entry => !ids.has(String(entry?.id || ''))), ...points] };
            await persistSnapshots();
            return true;
        },
        async deleteSnapshot(id) {
            await ensureSnapshotsOpen();
            const snapshotId = String(id || '');
            const snapshots = snapshotArchive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
            if (snapshots.length === snapshotArchive.snapshots.length) return false;
            snapshotArchive = { ...snapshotArchive, snapshots };
            await persistSnapshots();
            return true;
        },
        async migrateLegacySnapshotsIfNeeded() {
            if (!opened) await this.open();
            await ensureSnapshotsOpen();
            const report = createLegacyMigrationReport();
            if (options.skipLegacySnapshotMigration) return report;
            const legacyKeys = Object.keys(state.records || {}).filter(isLegacySnapshotKey);
            const nextSnapshots = [...snapshotArchive.snapshots];
            const migratedLegacyKeys = [];

            legacyKeys.forEach(legacyKey => {
                try {
                    const legacySnapshot = parseLegacySnapshot(state.records[legacyKey]);
                    if (!legacySnapshot) {
                        report.skippedCount += 1;
                        return;
                    }
                    const canonical = buildCanonicalSnapshotFromLegacy(legacyKey, legacySnapshot);
                    const exists = nextSnapshots.some(entry => String(entry?.id || '') === canonical.id);
                    if (exists) {
                        report.skippedCount += 1;
                    } else {
                        nextSnapshots.push(canonical);
                        migratedLegacyKeys.push(legacyKey);
                        report.migratedCount += 1;
                    }
                    if (!canonical.activeProfileId) report.notStandardRestorableCount += 1;
                } catch (err) {
                    report.errors.push({ key: legacyKey, message: err?.message || String(err) });
                }
            });

            if (migratedLegacyKeys.length > 0) {
                const previousArchive = snapshotArchive;
                snapshotArchive = { ...snapshotArchive, snapshots: nextSnapshots };
                try {
                    await persistSnapshots();
                } catch (err) {
                    snapshotArchive = previousArchive;
                    throw err;
                }
                migratedLegacyKeys.forEach(legacyKey => {
                    delete state.records[legacyKey];
                });
                await persist();
            }
            return report;
        },
        async quarantine() {
            if (!invoke) invoke = getInvoke(options);
            return invoke('quarantine_app_state', { ...liveTarget, ...generation() });
        }
    };
}

export default createTauriJsonFileAdapter;
