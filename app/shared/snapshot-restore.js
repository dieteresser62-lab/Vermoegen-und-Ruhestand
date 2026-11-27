import { SnapshotArchive, SNAPSHOT_KINDS, SNAPSHOT_SCOPES, SNAPSHOT_ORIGIN, IMPORT_POINT_LABELS, isVisibleRestorePoint, validateSnapshot, storedRecordTypeDamage } from './snapshot-archive.js';
import { PersistenceFacade } from './persistence-facade.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotRestoreLiveKey, isNewBeginningRecordKey, PROBELAUF_STATE_KEY } from './persistence-key-policy.js';
import { validatePersistenceDomainRecords } from './persistence-backup.js';
import { PROFILE_STORAGE_KEYS as P } from '../profile/profile-state.js';
import { OUTSIDE_PERSON_IMPORT_MESSAGE, OUTSIDE_PERSON_RESTORE_POINT_MESSAGE } from '../profile/profile-registry.js';
import { CONFIG } from '../balance/balance-config.js';
import { assertBalanceWealthHistory } from '../../types/wealth-history-contract.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from './navigation-guard.js';
import { pruneRestorePoints } from './snapshot-retention.js';

// SV-1: Zurückholen setzt immer den ganzen Haushalt auf den Stand des Punkts, über alle Schlüssel eines vollständigen Punkts.
// Bei Monats- und Jahrespunkten bleiben Tageskurse, Sicherungszeit und technische Einstellungen auf dem heutigen Stand.
// SV-1b: Punkte vor Vollimport, „Neu beginnen“ und Übernahme tragen ihren Umfang; Zurückholen stellt genau diesen wieder her.

/**
 * @param value Zu verarbeitender Wert.
 * @returns {string} Inhaltsvergleich unabhängig von der Schlüsselreihenfolge.
 */
export const recordIdentity = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
/** @type {Record<string, (key: string) => boolean>} */
const SCOPE_POLICIES = { [SNAPSHOT_SCOPES.household]: key => isAllowedSnapshotRestoreLiveKey(key),
    [SNAPSHOT_SCOPES.import]: key => isAllowedPersistenceImportKey(key), [SNAPSHOT_SCOPES.all]: key => isNewBeginningRecordKey(key) };
/** @param {{scope?: string}} point @returns {(key: string) => boolean} Schlüssel, die Anlegen und Zurückholen dieses Punkts umfassen. */
export const restorePointKeyPolicy = point => SCOPE_POLICIES[point?.scope || SNAPSHOT_SCOPES.household];
const allowKey = SCOPE_POLICIES[SNAPSHOT_SCOPES.household];
/** @param {Record<string, string>} records @param {(key: string) => boolean} [policy] */
const select = (records, policy = allowKey) => Object.fromEntries(Object.entries(records).filter(([key]) => policy(key)));
const parse = raw => raw ? JSON.parse(raw) : null;

/** Die Vermögensverläufe des Punkts müssen lesbar sein, sonst bleibt der heutige Stand. @param {{records: Record<string, string>}} snapshot */
function validateSnapshotWealthHistory(snapshot) {
    assertBalanceWealthHistory(parse(snapshot.records[CONFIG.STORAGE.LS_KEY]));
    Object.values(parse(snapshot.records[P.registry])?.profiles || {}).forEach(profile => {
        assertBalanceWealthHistory(parse(profile.data?.[CONFIG.STORAGE.LS_KEY]));
    });
}

/** SV-1c: Umfang, Art und Anlass müssen zusammenpassen. Einen eigenen Umfang (`import`, `all`) tragen nur Punkte vor dem Ersetzen
 * aus dieser Version; Monats- und Jahrespunkte und Punkte früherer Versionen halten den Haushalt. „Vor Neu beginnen“ und „Vor
 * Übernahme der Spielkopie“ halten immer den ganzen Hauptspeicher. Ein Record außerhalb des Umfangs passt ebenfalls nicht.
 * @param {{kind: string, label: string, scope?: string, origin?: string, records: Record<string, string>}} snapshot @returns {string|null} */
function scopeDamage(snapshot) {
    const scope = snapshot.scope || SNAPSHOT_SCOPES.household;
    const replaces = snapshot.kind === SNAPSHOT_KINDS.fullBackupImportRecovery && snapshot.origin === SNAPSHOT_ORIGIN;
    const expected = !replaces ? [SNAPSHOT_SCOPES.household]
        : /** @type {string[]} */ ([IMPORT_POINT_LABELS.newBeginning, IMPORT_POINT_LABELS.playTransfer]).includes(snapshot.label) ? [SNAPSHOT_SCOPES.all]
            : Object.values(SNAPSHOT_SCOPES);
    if (!/** @type {string[]} */ (expected).includes(scope)) return `Der Umfang ${scope} passt nicht zu diesem Punkt.`;
    if (scope === SNAPSHOT_SCOPES.household) return null;
    const policy = restorePointKeyPolicy(snapshot), outside = Object.keys(snapshot.records).find(key => !policy(key));
    return outside ? `Der Record ${outside} liegt außerhalb des Umfangs ${scope}.` : null;
}

/** SV-1b: Alle Records des Punkts durchlaufen dieselbe Domänenprüfung wie das Einspielen einer Vollsicherung. Ein Punkt mit einem
 * ungültigen Record gilt als beschädigt und lässt sich nicht zurückholen. SV-1c: ohne vorherige Typumwandlung, und der Umfang muss
 * zum Punkt passen.
 * @param input gelesener Punkt @returns {string|null} Grund oder `null` für einen unversehrten Punkt */
export function restorePointDamage(input) {
    try {
        const typeDamage = storedRecordTypeDamage(input);
        if (typeDamage) return typeDamage;
        const snapshot = validateSnapshot(input);
        const mismatch = scopeDamage(snapshot);
        if (mismatch) return mismatch;
        const records = select(snapshot.records, restorePointKeyPolicy(snapshot));
        // Wie beim Erstellen einer Vollsicherung ohne Personengrenze: Ein eigener Altbestand mit drei Mitgliedern bleibt zurückholbar.
        const domain = validatePersistenceDomainRecords(select(records, key => isAllowedPersistenceImportKey(key)), { householdLimit: false });
        // AP-1b: Die Meldung zur alten Außenperson nennt hier den Wiederherstellungspunkt statt der Sicherung.
        if (!domain.ok) return domain.message === OUTSIDE_PERSON_IMPORT_MESSAGE ? OUTSIDE_PERSON_RESTORE_POINT_MESSAGE : domain.message;
        validateSnapshotWealthHistory({ records });
        return null;
    } catch (error) { return /** @type {Error} */ (error)?.message || String(error); }
}

/** Reiner Plan: dieselbe Recordmenge dient dem Punkt „Vor dem Zurückholen“ und dem Zielwrite.
 * @param input gelesener Punkt @param {Record<string, string>} currentRecords heutiger Bestand */
export function buildSnapshotRestorePlan(input, currentRecords) {
    const snapshot = validateSnapshot(input);
    if (!isVisibleRestorePoint(snapshot)) throw new Error('Dieser Punkt lässt sich hier nicht zurückholen.');
    validateSnapshotWealthHistory(snapshot);
    const damage = restorePointDamage(snapshot);
    if (damage) throw Object.assign(new Error(`Dieser Punkt ist beschädigt und lässt sich nicht zurückholen. ${damage}`), { code: 'restore_point_damaged' });
    const policy = restorePointKeyPolicy(snapshot);
    const before = select(currentRecords, policy), records = select(snapshot.records, policy);
    const changes = [...new Set([...Object.keys(before), ...Object.keys(records)])].sort().filter(key => before[key] !== records[key])
        .map(key => ({ key, action: !(key in records) ? 'removed' : !(key in before) ? 'added' : 'changed' }));
    return { snapshot, allowKey: policy, scope: snapshot.scope, before, records, changes,
        identity: recordIdentity({ snapshot: JSON.stringify(snapshot), current: recordIdentity(before) }) };
}

/**
 * @param {string} id
 * @param {{persistence?: typeof PersistenceFacade; archive?: typeof SnapshotArchive; navigationOperation?: import("../../typcheck/speicher-integration.js").Operation}} [options]
 */
export async function previewSnapshotRestore(id, { persistence = PersistenceFacade, archive = SnapshotArchive, navigationOperation } = {}) {
    if (await persistence.flush({ navigationOperation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    // SV-1c: Rohwerte vor der Umwandlung prüfen; ein Wert, den die Vollsicherung ablehnt, macht den Punkt beschädigt.
    const snapshot = await archive.readSnapshot(id, { storage: persistence, checkStoredTypes: true });
    const records = await persistence.readPersistedRecords();
    if (records[PROBELAUF_STATE_KEY]) throw new Error('Zurückholen während des Spielbereichs gesperrt. Beende ihn zuerst über das Spielbereichsband.');
    return buildSnapshotRestorePlan(snapshot, records);
}

export const ROLLBACK_FAILED_MESSAGE = 'Zurückholen und Rücknahme sind unbestätigt. Bitte lade die Seite neu und hole unter Daten & Sicherung den Punkt „Vor dem Zurückholen“ zurück.';
export const HOUSEHOLD_RESTORE_NOTICE = 'Monatsausgaben, erfasste Vermögensstände und der Haushaltsplan gehen für alle Personen auf diesen Stand zurück.';
const activeRestores = new WeakSet();
/** Erst den Punkt „Vor dem Zurückholen“ dauerhaft zurücklesen, dann den ganzen Haushalt in einer Transaktion ersetzen.
 * Scheitert etwas vor dem Ersetzen, bleibt der heutige Stand; die Transaktion selbst nimmt sich bei einem Fehler zurück.
 * @param preview Plan aus `previewSnapshotRestore` @param options Optionen des Aufrufers */
export async function executeSnapshotRestore(preview, options = {}) {
    const persistence = options.persistence || PersistenceFacade, archive = options.archive || SnapshotArchive;
    if (activeRestores.has(persistence)) return { status: 'in_flight' };
    activeRestores.add(persistence);
    const guard = options.guard || createNavigationGuard();
    let written = false, /** @type {()=>void} */ release, recoverySnapshotId, /** @type {unknown} */ reloadResult;
    const message = 'Snapshot gespeichert; die Seite wurde nicht neu geladen. Bitte die Seite jetzt neu laden. Eingaben werden bis dahin nicht gespeichert.';
    try {
        const navigated = await guard.reload({ opener: options.opener,
            subscribeChanges: notify => persistence.observeInputChanges?.(notify, options.document || globalThis.document),
            mutate: async operation => {
                if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                operation.check();
                const fresh = await previewSnapshotRestore(preview.snapshot.id, { persistence, archive, navigationOperation: operation });
                operation.check();
                if (fresh.identity !== preview.identity) throw new Error('Der Bestand oder Punkt hat sich seit der Bestätigung geändert. Bitte erneut zurückholen.');
                release = persistence.blockSyncWrites([], message, { predicate: isAllowedPersistenceImportKey });
                const activeId = fresh.before[P.current] || fresh.before[P.active] || '';
                const recovery = await archive.createSnapshot({ id: `before_restore_${globalThis.crypto.randomUUID()}`,
                    label: IMPORT_POINT_LABELS.restore, kind: SNAPSHOT_KINDS.fullBackupImportRecovery, records: fresh.before, scope: fresh.scope,
                    activeProfileId: activeId, activeProfileName: parse(fresh.before[P.registry])?.profiles?.[activeId]?.meta?.name || ''
                }, { storage: persistence, navigationOperation: operation });
                const verified = await archive.readSnapshot(recovery.id, { storage: persistence });
                operation.check();
                if (JSON.stringify(verified) !== JSON.stringify(recovery)) throw new Error('Der Punkt „Vor dem Zurückholen“ konnte nicht bytegleich bestätigt werden.');
                const rechecked = await previewSnapshotRestore(preview.snapshot.id, { persistence, archive, navigationOperation: operation });
                operation.check();
                if (rechecked.identity !== preview.identity) throw new Error('Der Bestand oder Punkt hat sich während der Sicherung geändert. Bitte erneut zurückholen.');
                recoverySnapshotId = recovery.id;
                await persistence.replaceRecordsTransactional(fresh.records, { allowKey: fresh.allowKey,
                    expectedRecords: fresh.before, navigationOperation: operation });
                written = true;
                // Erst nach dem bestätigten Ersetzen kürzen; der Quellpunkt bleibt geschützt.
                await pruneRestorePoints(SNAPSHOT_KINDS.fullBackupImportRecovery, { storage: persistence, archive,
                    protectedIds: [preview.snapshot.id, recovery.id], records: fresh.records, navigationOperation: operation });
            }, flush: () => persistence.flush(),
            reload: () => {
                const reload = options.reload || (() => globalThis.location?.reload?.());
                reloadResult = reload();
                if (reloadResult === false) throw new Error('RELOAD_REFUSED');
            } });
        if (reloadResult && typeof /** @type {Promise<unknown>} */ (reloadResult).then === 'function' && await reloadResult === false) throw new Error('RELOAD_REFUSED');
        if (written && !navigated) return { status: 'reload_required', message, recoverySnapshotId };
        // Auch beim Reload-Doppel darf diese Dokumentgeneration nicht mehr schreiben.
        return { status: navigated ? 'restored' : 'cancelled', recoverySnapshotId };
    } catch (error) {
        if (written) return { status: 'reload_required', message, error, recoverySnapshotId };
        release?.();
        // SV-1b: Ist auch die Rücknahme unbestätigt, bleibt die Seite gesperrt; der Punkt „Vor dem Zurückholen“ bleibt zum Zurückholen.
        if (error.code === 'rollback_failed') persistence.blockSyncWrites([], ROLLBACK_FAILED_MESSAGE, { predicate: isAllowedPersistenceImportKey });
        if (recoverySnapshotId) error.recoverySnapshotId = recoverySnapshotId;
        throw error;
    } finally { activeRestores.delete(persistence); }
}

/**
 * @param id Kennung des Punkts.
 * @param options Optionen des Aufrufers.
 */
export async function restoreSnapshotById(id, options = {}) {
    const lifecycle = createNavigationOperationLifecycle({ guard: options.guard });
    const preview = options.preview || await lifecycle.run({}, async operation => {
        const plan = await previewSnapshotRestore(id, options); operation.check(); return plan;
    });
    return executeSnapshotRestore(preview, options);
}
