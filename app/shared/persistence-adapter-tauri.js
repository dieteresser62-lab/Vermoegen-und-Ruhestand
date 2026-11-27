
import { areaHousehold, isPlayArea } from './household-registry.js';

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

/** @param {(command: string, args: object) => Promise<unknown>} invoke @param {object} args */
export async function saveTauriState(invoke, args) {
    const saveId = globalThis.crypto.randomUUID();
    const report = async active => {
        try { await invoke('report_app_save', { saveId, active }); }
        catch { /* Die Meldung steuert nur die Schließfrist. */ }
    };
    await report(true);
    try { await invoke('save_app_state', { ...args, saveId }); }
    finally { await report(false); }
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

export function createTauriJsonFileAdapter(options = {}) {
    // Weitere Haushalte: Rust bildet den Ordner households/<Kennung>/ selbst, die Oberfläche liefert keinen Pfad.
    const household = areaHousehold(options.area);
    const scope = household ? { household } : {};
    const play = isPlayArea(options.area);
    // HV-4: Jeder native Write nennt die Verzeichnis-Generation dieses Dokuments; Rust weist veraltete ab.
    const generation = () => { const value = options.expectedGeneration?.(); return Number.isSafeInteger(value) ? { expectedGeneration: value } : {}; };
    const saveState = async args => {
        try { await saveTauriState(invoke, { ...args, ...generation() }); }
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
    let writeChain = Promise.resolve();

    /** @template T @param {() => Promise<T>} write */
    function queueWrite(write) {
        const result = writeChain.then(write);
        writeChain = result.then(() => {}, () => {});
        return result;
    }

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
        const archive = await loadSnapshotArchive();
        if (snapshotsOpened) return;
        snapshotArchive = archive;
        snapshotsOpened = true;
    }

    async function persistSnapshots() {
        await saveState({
            target: snapshotTarget,
            ...scope,
            content: serializeSnapshotArchive(snapshotArchive)
        });
    }

    async function replaceSnapshots(snapshots) {
        const previousArchive = snapshotArchive;
        snapshotArchive = { ...snapshotArchive, snapshots };
        try {
            await persistSnapshots();
        } catch (error) {
            snapshotArchive = previousArchive;
            throw error;
        }
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
            const point = (await loadSnapshotArchive()).snapshots.find(entry => entry.id === String(id || ''));
            if (!point) throw new Error(`Snapshot ${id} wurde nicht gefunden.`);
            return point;
        },
        async readPersistedSnapshots() {
            if (!invoke) invoke = getInvoke(options);
            return (await loadSnapshotArchive()).snapshots;
        },
        saveBatch(batch) {
            return queueWrite(async () => {
                if (!opened) await this.open();
                const records = state.records;
                const previousRecords = { ...records };
                try {
                    batch.deletes.forEach(key => { delete records[String(key)]; });
                    batch.upserts.forEach(([key, value]) => {
                        if (value === null || value === undefined) return;
                        records[String(key)] = String(value);
                    });
                    await persist();
                } catch (error) {
                    Object.keys(records).forEach(key => { delete records[key]; });
                    Object.assign(records, previousRecords);
                    throw error;
                }
            });
        },
        async readMetadata(key) {
            return state.metadata[String(key)] ?? null;
        },
        writeMetadata(key, value) {
            return queueWrite(async () => {
                const metadata = state.metadata;
                const name = String(key);
                const previousValue = metadata[name];
                const hadValue = Object.hasOwn(metadata, name);
                metadata[name] = value;
                try {
                    await persist();
                } catch (error) {
                    if (hadValue) metadata[name] = previousValue;
                    else delete metadata[name];
                    throw error;
                }
            });
        },
        async listSnapshots() {
            await ensureSnapshotsOpen();
            return snapshotArchive.snapshots.map(toSnapshotIndexEntry);
        },
        async readSnapshot(id) {
            await ensureSnapshotsOpen();
            const snapshotId = String(id || '');
            const snapshot = snapshotArchive.snapshots.find(entry => String(entry?.id || '') === snapshotId);
            if (!snapshot) {
                throw new Error(`Snapshot ${snapshotId} wurde nicht gefunden.`);
            }
            return snapshot;
        },
        writeSnapshot(snapshot) {
            return queueWrite(async () => {
                await ensureSnapshotsOpen();
                const snapshotId = String(snapshot?.id || '');
                if (!snapshotId) throw new Error('Snapshot-ID fehlt.');
                const snapshots = snapshotArchive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
                snapshots.push(snapshot);
                await replaceSnapshots(snapshots);
                return true;
            });
        },
        deleteSnapshot(id) {
            return queueWrite(async () => {
                await ensureSnapshotsOpen();
                const snapshotId = String(id || '');
                const snapshots = snapshotArchive.snapshots.filter(entry => String(entry?.id || '') !== snapshotId);
                if (snapshots.length === snapshotArchive.snapshots.length) return false;
                await replaceSnapshots(snapshots);
                return true;
            });
        },
        async quarantine() {
            if (!invoke) invoke = getInvoke(options);
            return invoke('quarantine_app_state', { ...liveTarget, ...generation() });
        }
    };
}

export default createTauriJsonFileAdapter;
