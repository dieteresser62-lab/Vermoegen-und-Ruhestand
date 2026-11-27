import { appNow } from './app-clock.js';

import { PROFILE_STORAGE_KEYS } from '../profile/profile-state.js';
import { createNavigationOperationLifecycle } from './navigation-guard.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { PersistenceFacade } from './persistence-facade.js';
import { PROBELAUF_STATE_KEY, isAllowedSnapshotCaptureKey } from './persistence-key-policy.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_TYPE = 'persistence-records-v1';
// SV-1: Sichtbar sind nur drei Arten (Monatsabschluss, Jahresabschluss, vor dem Einspielen). Interne Rücksicherungen
// bleiben unsichtbar und werden nach Erfolg gelöscht. `probelaufBefore` liest nur noch den alten Spielbereich (Version 1).
export const SNAPSHOT_KINDS = Object.freeze({
    annualClosePreMutation: 'annual-close-pre-mutation',
    monthlyClosePreMutation: 'monthly-close-pre-mutation',
    fullBackupImportRecovery: 'full-backup-import-recovery',
    internalRecovery: 'internal-recovery',
    probelaufBefore: 'probelauf-before'
});
/** Bezeichnungen der Punkte vor dem Einspielen; sie teilen sich Art und Aufbewahrung. */
export const IMPORT_POINT_LABELS = Object.freeze({
    restore: 'Vor dem Zurückholen',
    playTransfer: 'Vor Übernahme der Spielkopie',
    newBeginning: 'Vor Neu beginnen'
});
/** SV-1b: Umfang eines Punkts. Ohne Angabe der Haushalt (Monats- und Jahresabschluss); Vollimport ersetzt alle importierbaren
 * Schlüssel, „Neu beginnen“ und die Übernahme der Spielkopie den ganzen Hauptspeicher. Zurückholen stellt genau diesen Umfang her. */
export const SNAPSHOT_SCOPES = Object.freeze({ household: 'household', import: 'import', all: 'all' });
/** Herkunft der Punkte dieser Version. Punkte ohne Herkunft stammen aus der Zeit vor der vereinfachten Sicherung. */
export const SNAPSHOT_ORIGIN = 'sv1';
/** @type {Set<string>} */
const VISIBLE_KINDS = new Set([SNAPSHOT_KINDS.annualClosePreMutation, SNAPSHOT_KINDS.monthlyClosePreMutation, SNAPSHOT_KINDS.fullBackupImportRecovery]);
/** @param {{kind?: string}} point @returns {boolean} Punkt erscheint auf Daten & Sicherung. */
export const isVisibleRestorePoint = point => VISIBLE_KINDS.has(String(point?.kind || ''));

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function asIsoDate(value, fieldName) {
    const date = value ? new Date(value) : appNow();
    if (!Number.isFinite(date.getTime())) {
        throw new Error(`Snapshot ${fieldName} ist ungueltig.`);
    }
    return date.toISOString();
}

function sanitizeIdPart(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function createSnapshotId(createdAt, label = '') {
    const timestamp = String(createdAt).replace(/[:.]/g, '-');
    const suffix = sanitizeIdPart(label);
    return suffix ? `snapshot_${timestamp}--${suffix}` : `snapshot_${timestamp}`;
}

/** @param {unknown} scope @returns {{scope?: string}} */
function scopeField(scope) {
    if (scope === undefined || scope === null || scope === '' || scope === SNAPSHOT_SCOPES.household) return {};
    if (!/** @type {string[]} */ (Object.values(SNAPSHOT_SCOPES)).includes(String(scope))) throw new Error(`Snapshot-Umfang ${scope} wird nicht unterstuetzt.`);
    return { scope: String(scope) };
}
/** @param {unknown} origin @returns {{origin?: string}} */
const originField = origin => origin ? { origin: String(origin) } : {};

function normalizeRecords(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
        throw new Error('Snapshot records muessen ein Objekt sein.');
    }
    const normalized = Object.create(null);
    Object.entries(records).forEach(([key, value]) => {
        if (key === PROBELAUF_STATE_KEY) return;
        if (value === null || value === undefined) return;
        normalized[String(key)] = String(value);
    });
    return normalized;
}

/** SV-1c: Prüfung vor jeder Umwandlung. Wie beim Einspielen einer Vollsicherung muss jeder gespeicherte Wert ein Text sein;
 * `validateSnapshot` wandelt sonst still um. @param {unknown} snapshot gelesener Rohpunkt @returns {string|null} Grund oder `null` */
export function storedRecordTypeDamage(snapshot) {
    const records = /** @type {{records?: unknown}|null} */ (snapshot)?.records;
    if (!records || typeof records !== 'object' || Array.isArray(records)) return null;
    const wrong = Object.entries(records).find(([, value]) => typeof value !== 'string');
    return wrong ? `Punktwert ${wrong[0]} muss als Text vorliegen.` : null;
}

/** @param {unknown} snapshot @param {{checkStoredTypes?: boolean}} options */
function assertStoredTypes(snapshot, options) {
    const damage = options.checkStoredTypes ? storedRecordTypeDamage(snapshot) : null;
    if (damage) throw Object.assign(new Error(damage), { code: 'restore_point_damaged' });
}

function getStorage(storage) {
    return storage || PersistenceFacade;
}

function requireStorageMethod(storage, methodName) {
    const activeStorage = getStorage(storage);
    const method = activeStorage?.[methodName];
    if (typeof method !== 'function') {
        throw new Error(`Snapshot-Archiv-Speicher unterstuetzt ${methodName}() nicht.`);
    }
    return method.bind(activeStorage);
}

/** @param {{keys?: string[] | (() => string[]), getItem?: (key: string) => unknown}} [options] */
export function captureCurrentRecords({ keys, getItem } = {}) {
    if (typeof getItem !== 'function') {
        throw new Error('Snapshot-Capture benoetigt getItem(key).');
    }
    const sourceKeys = typeof keys === 'function' ? keys() : keys;
    if (!Array.isArray(sourceKeys)) {
        throw new Error('Snapshot-Capture benoetigt eine Key-Liste.');
    }
    const records = Object.create(null);
    sourceKeys.forEach(key => {
        const normalizedKey = String(key || '');
        if (!isAllowedSnapshotCaptureKey(normalizedKey)) return;
        const value = getItem(normalizedKey);
        if (value === null || value === undefined) return;
        records[normalizedKey] = String(value);
    });
    return records;
}

/** @param {{id?: string, label?: string, kind?: string, records?: Record<string, string>, activeProfileId?: string, activeProfileName?: string, createdAt?: string | Date, scope?: string}} [options] */
export function buildSnapshot({
    id,
    label = '',
    kind = 'manual',
    records,
    activeProfileId,
    activeProfileName,
    createdAt,
    scope
} = {}) {
    const normalizedCreatedAt = asIsoDate(createdAt, 'createdAt');
    const normalizedRecords = normalizeRecords(records);
    const snapshot = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: id ? String(id) : createSnapshotId(normalizedCreatedAt, label),
        snapshotType: SNAPSHOT_TYPE,
        kind: String(kind || 'manual'),
        createdAt: normalizedCreatedAt,
        label: String(label || ''),
        activeProfileId: activeProfileId ? String(activeProfileId) : '',
        activeProfileName: activeProfileName ? String(activeProfileName) : '',
        recordCount: Object.keys(normalizedRecords).length,
        ...scopeField(scope),
        origin: SNAPSHOT_ORIGIN,
        records: normalizedRecords
    };
    return validateSnapshot(snapshot);
}

export function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Snapshot ist kein Objekt.');
    }
    if (Number(snapshot.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(`Snapshot-Schema ${snapshot.schemaVersion} wird nicht unterstuetzt.`);
    }
    if (snapshot.snapshotType !== SNAPSHOT_TYPE) {
        throw new Error(`Snapshot-Typ ${snapshot.snapshotType || ''} wird nicht unterstuetzt.`);
    }
    if (!snapshot.id) {
        throw new Error('Snapshot-ID fehlt.');
    }
    if (!snapshot.createdAt) throw new Error('Snapshot createdAt fehlt.');
    const createdAt = asIsoDate(snapshot.createdAt, 'createdAt');
    const records = normalizeRecords(snapshot.records);
    const recordCount = Object.keys(records).length;
    if (Number(snapshot.recordCount) !== recordCount) {
        throw new Error(`Snapshot recordCount ${snapshot.recordCount} passt nicht zu ${recordCount} Records.`);
    }
    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        id: String(snapshot.id),
        snapshotType: SNAPSHOT_TYPE,
        kind: String(snapshot.kind || 'manual'),
        createdAt,
        label: String(snapshot.label || ''),
        activeProfileId: snapshot.activeProfileId ? String(snapshot.activeProfileId) : '',
        activeProfileName: snapshot.activeProfileName ? String(snapshot.activeProfileName) : '',
        recordCount,
        ...scopeField(snapshot.scope),
        ...originField(snapshot.origin),
        records
    };
}

export function toSnapshotIndexEntry(snapshot) {
    const source = snapshot?.records ? validateSnapshot(snapshot) : snapshot;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('Snapshot-Indexeintrag ist kein Objekt.');
    }
    if (!source.id || !source.createdAt) throw new Error('Snapshot-ID oder Zeitpunkt fehlt.');
    return {
        id: String(source.id || ''),
        label: String(source.label || ''),
        kind: String(source.kind || 'manual'),
        createdAt: asIsoDate(source.createdAt, 'createdAt'),
        activeProfileId: source.activeProfileId ? String(source.activeProfileId) : '',
        activeProfileName: source.activeProfileName ? String(source.activeProfileName) : '',
        recordCount: Number(source.recordCount) || 0,
        ...scopeField(source.scope),
        ...originField(source.origin)
    };
}

export async function writeSnapshot(snapshot, options = {}) {
    const normalized = validateSnapshot(snapshot);
    const write = requireStorageMethod(options.storage, 'writeSnapshot');
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    await lifecycle.run(options, async navigationOperation => {
        if (!options.navigationOperation) navigationOperation.commit();
        if (await write(normalized, { ...options, navigationOperation }) === false) throw new Error('PERSISTENCE_SNAPSHOT_WRITE_FAILED');
    });
    return normalized.id;
}

export async function createSnapshot(snapshotInput, options = {}) {
    const snapshot = buildSnapshot(snapshotInput);
    await writeSnapshot(snapshot, options);
    return snapshot;
}

export async function readSnapshot(id, options = {}) {
    const read = requireStorageMethod(options.storage, 'readSnapshot');
    const snapshot = await read(String(id || ''));
    assertStoredTypes(snapshot, options);
    const normalized = validateSnapshot(snapshot);
    if (normalized.id !== String(id)) throw new Error('Snapshot-Readback liefert eine andere ID.');
    return normalized;
}

/** Mehrere Punkte mit derselben Prüfung wie readSnapshot; ohne Sammellesen des Speichers einzeln.
 * `checkStoredTypes` (Liste und Zurückholen): ein gespeicherter Wert, der kein Text ist, macht den Punkt beschädigt. */
export async function readSnapshots(ids, options = {}) {
    const storage = getStorage(options.storage);
    if (typeof storage?.readSnapshots !== 'function') return Promise.all(ids.map(id => readSnapshot(id, options)));
    const points = await storage.readSnapshots(ids.map(id => String(id || '')));
    if (!Array.isArray(points) || points.length !== ids.length) throw new Error('Snapshot-Readback ist unvollständig.');
    return points.map((point, index) => {
        assertStoredTypes(point, options);
        const normalized = validateSnapshot(point);
        if (normalized.id !== String(ids[index])) throw new Error('Snapshot-Readback liefert eine andere ID.');
        return normalized;
    });
}

export async function listSnapshots(options = {}) {
    const list = requireStorageMethod(options.storage, 'listSnapshots');
    const snapshots = await list();
    if (!Array.isArray(snapshots)) {
        throw new Error('Snapshot-Liste ist ungueltig.');
    }
    if (new Set(snapshots.map(point => point?.id)).size !== snapshots.length) throw new Error('Doppelte Snapshot-ID im Archiv.');
    return snapshots
        .map(toSnapshotIndexEntry)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export async function deleteSnapshot(id, options = {}) {
    const remove = requireStorageMethod(options.storage, 'deleteSnapshot');
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard ?? (globalThis.document ? getPageNavigationGuard() : null) });
    await lifecycle.run(options, async navigationOperation => {
        navigationOperation.commit();
        if (await remove(String(id || ''), { ...options, navigationOperation }) === false) throw new Error('PERSISTENCE_SNAPSHOT_DELETE_FAILED');
    });
    return true;
}

export function getActiveProfileIdFromRecords(records) {
    if (!records || typeof records !== 'object') return '';
    return String(records[PROFILE_STORAGE_KEYS.current] || records[PROFILE_STORAGE_KEYS.active] || '');
}

/** SV-1: Interne Rücksicherung innerhalb eines Vorgangs. Sie erscheint nicht in der Liste und wird nach Erfolg gelöscht.
 * @param {Record<string, string>} records @param {{label?: string, storage?: unknown, navigationOperation?: unknown}} [options] */
export async function createInternalRecovery(records, { label = '', storage, navigationOperation } = {}) {
    // Über das Archivobjekt, damit Prüfungen Speicherfehler einspielen können.
    const point = await SnapshotArchive.createSnapshot({ id: `internal_${globalThis.crypto.randomUUID()}`, kind: SNAPSHOT_KINDS.internalRecovery,
        label, records, activeProfileId: getActiveProfileIdFromRecords(records) }, { storage, navigationOperation });
    if (JSON.stringify(await SnapshotArchive.readSnapshot(point.id, { storage })) !== JSON.stringify(point)) {
        throw new Error('Die interne Rücksicherung konnte nicht bestätigt werden. Es wurde nichts geändert.');
    }
    return point;
}

/** Löscht eine interne Rücksicherung nach Erfolg. Ein Fehler hier ändert das Ergebnis des Vorgangs nicht; der Punkt bleibt dann
 * unsichtbar liegen. @param {string} id @param {{storage?: unknown, navigationOperation?: unknown}} [options] @returns {Promise<boolean>} */
export async function discardInternalRecovery(id, options = {}) {
    try { await SnapshotArchive.deleteSnapshot(id, options); return true; } catch { return false; }
}

export const SnapshotArchive = {
    captureCurrentRecords,
    buildSnapshot,
    createSnapshot,
    listSnapshots,
    readSnapshot,
    readSnapshots,
    writeSnapshot,
    deleteSnapshot,
    validateSnapshot,
    toSnapshotIndexEntry,
    getActiveProfileIdFromRecords,
    createInternalRecovery,
    discardInternalRecovery
};

export default SnapshotArchive;
