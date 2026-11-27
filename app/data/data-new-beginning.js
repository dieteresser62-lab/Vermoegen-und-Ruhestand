import { PersistenceFacade } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS, SNAPSHOT_SCOPES, IMPORT_POINT_LABELS } from '../shared/snapshot-archive.js';
import { pruneRestorePoints } from '../shared/snapshot-retention.js';
import { assertFullBackupAllowed, validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { isAllowedPersistenceImportKey, isNewBeginningRecordKey } from '../shared/persistence-key-policy.js';
import { recordIdentity } from '../shared/snapshot-restore.js';
import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { CONFIG } from '../balance/balance-config.js';
import { clearProfilesBundleHandoff } from '../profile/profile-bundle-io.js';

/**
 * @param {import("../../typcheck/data-ui.js").NewBeginningSelection} [options]
 * @returns {boolean} Bestätigung vollständig.
 */
export function canConfirmNewBeginning({ backupSaved = false, withoutBackup = false, confirmed = false, busy = false } = {}) {
    return !busy && confirmed && (backupSaved || withoutBackup);
}

/**
 * @param {import("../../typcheck/data-ui.js").NewBeginningOptions} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export async function assertNewBeginningAllowed({ persistence = PersistenceFacade, archive = SnapshotArchive,
    probelaufController, recovery = false, window: win = globalThis.window } = {}) {
    await assertFullBackupAllowed({ persistence, probelaufController });
    const status = persistence.getPersistenceStatus();
    if (!status.initialized || status.lastFlushError) throw new Error('Der Speicher ist nicht sicher lesbar. Bitte zuerst den Speicherfehler klären.');
    if (recovery || status.migrationWarning || persistence.hasSyncWriteBlocks() || win?.__profileRecoveryBlocker || win?.__personMigrationDeferred) {
        throw new Error('Eine Wiederherstellung oder Recovery ist offen. Bitte zuerst abschließen.');
    }
    const records = await persistence.readPersistedRecords(isNewBeginningRecordKey);
    const validation = validatePersistenceDomainRecords(Object.fromEntries(Object.entries(records).filter(([key]) => isAllowedPersistenceImportKey(key))));
    if (!validation.ok) throw new Error('Der Speicher ist beschädigt oder nicht lesbar. ' + validation.message);
    const registry = JSON.parse(records.rs_profiles_v1 || '{"profiles":{}}');
    const states = [records[CONFIG.STORAGE.LS_KEY], ...Object.values(registry.profiles).map(profile => profile.data?.[CONFIG.STORAGE.LS_KEY])];
    if (states.some(raw => raw && JSON.parse(raw)?.annualPeriodMetadata?.pendingCommit)) throw new Error('Eine Jahresabschluss-Recovery ist offen. Bitte zuerst abschließen.');
    const points = await archive.listSnapshots({ storage: persistence });
    // Läuft bei Seitenstart, Klick und Fensterfokus: Punkte gesammelt lesen (H-DS-1).
    if (archive.readSnapshots) await archive.readSnapshots(points.map(point => point.id), { storage: persistence });
    else for (const point of points) await archive.readSnapshot(point.id, { storage: persistence });
    return { records, points, names: Object.values(registry.profiles).map(profile => profile.meta?.name?.trim() || 'Name unbekannt') };
}

/** Eine Löschbestätigung umfasst Punkt, Readback, transaktionalen Leerbestand und Navigation.
 *
 * @param {import("../../typcheck/data-ui.js").NewBeginningControllerOptions} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function createNewBeginningController({ persistence = PersistenceFacade, archive = SnapshotArchive,
    guard, window: win = globalThis.window, probelaufController, recovery = () => false,
    navigate = () => win.location.replace('index.html') } = {}) {
    let busy = false, blocked = false;
    const options = () => ({ persistence, archive, window: win, probelaufController, recovery: recovery() });
    return {
        get busy() { return busy; }, get blocked() { return blocked; },
        async inspect() {
            if (blocked) throw new Error('Bitte neu laden oder den Wiederherstellungspunkt zurückholen.');
            return assertNewBeginningAllowed(options());
        },
        /** @param {import("../../typcheck/data-ui.js").NewBeginningSelection} [selection] @param {HTMLElement} [opener] */
        async execute(selection = {}, opener) {
            if (busy || blocked || !canConfirmNewBeginning(selection)) return { status: 'not_confirmed' };
            busy = true;
            let snapshotId, deletionStarted = false, cleared = false, /** @type {(()=>void)|undefined} */ release;
            /** @type {string[]} */
            const warnings = [];
            try {
                const result = await withAnnualWriteAccess(() => guard.reload({ opener, returnResult: true,
                    mutate: async operation => {
                        await assertNewBeginningAllowed(options());
                        if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                        const { records } = await assertNewBeginningAllowed(options());
                        release = persistence.blockSyncWrites([], 'Neu beginnen läuft. Bitte bis zum Neuladen keine Daten ändern.', { predicate: isNewBeginningRecordKey });
                        operation.commit();
                        // SV-1: „Neu beginnen“ ersetzt den Stand wie ein Einspielen und legt deshalb einen Punkt dieser Art an.
                        // SV-1b: Er umfasst alles, was danach gelöscht wird, auch Tageskurse, Sicherungszeit und technische Werte.
                        const snapshot = await archive.createSnapshot({ id: `new_beginning_${globalThis.crypto.randomUUID()}`,
                            label: IMPORT_POINT_LABELS.newBeginning, kind: SNAPSHOT_KINDS.fullBackupImportRecovery, scope: SNAPSHOT_SCOPES.all,
                            records, activeProfileId: records.rs_current_profile || records.rs_active_profile || ''
                        }, { storage: persistence, navigationOperation: operation });
                        const readback = await archive.readSnapshot(snapshot.id, { storage: persistence });
                        if (JSON.stringify(snapshot) !== JSON.stringify(readback)) throw new Error('Der Punkt „Vor Neu beginnen“ konnte nicht bytegleich bestätigt werden. Es wurde nichts gelöscht.');
                        snapshotId = snapshot.id;
                        clearProfilesBundleHandoff(win);
                        // Optimistischer Vergleich vor dem einzigen Hauptspeicher-Batch. Nimmt er sich bestätigt zurück, ist nichts gelöscht.
                        try {
                            await persistence.replaceRecordsTransactional({}, { allowKey: isNewBeginningRecordKey,
                                expectedRecords: records, navigationOperation: operation });
                        } catch (error) {
                            deletionStarted = /** @type {{code?: string}} */ (error)?.code === 'rollback_failed';
                            throw error;
                        }
                        deletionStarted = true; cleared = true;
                        // Ab hier ist der Haushalt gelöscht. Reste in Browser- und Sitzungsspeicher sind nur noch eine Warnung.
                        const warn = async (/** @type {string} */ text, /** @type {() => Promise<unknown>} */ step) => {
                            try { await step(); } catch (error) { warnings.push(`${text} ${/** @type {Error} */ (error)?.message || ''}`.trim()); }
                        };
                        await warn('Browser- und Sitzungsreste konnten nicht vollständig entfernt werden.',
                            async () => persistence.resetNewBeginningBrowserStorage?.({ window: win, navigationOperation: operation }));
                        await warn('Der leere Hauptspeicher konnte nicht bestätigt werden.', async () => {
                            if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                            if (recordIdentity(await persistence.readPersistedRecords(isNewBeginningRecordKey)) !== recordIdentity({})) throw new Error('Der Hauptspeicher ist nicht vollständig leer.');
                        });
                        await pruneRestorePoints(SNAPSHOT_KINDS.fullBackupImportRecovery, { storage: persistence, archive,
                            protectedIds: [snapshot.id], records: {}, navigationOperation: operation });
                    }, flush: () => persistence.flush(),
                    // SV-1c: Mit einer Warnung bleibt die Seite stehen, damit sie den Nutzer erreicht; der Dialog nennt sie und den Weg zur Übersicht.
                    reload: () => { if (warnings.length) throw new Error('NEW_BEGINNING_WARNING_SHOWN'); navigate(); }
                }), { locks: win?.navigator?.locks });
                blocked = deletionStarted;
                if (!deletionStarted) release?.();
                const warning = warnings.length ? warnings.join(' ') : undefined;
                return { status: cleared && result.status === 'reloaded' ? 'restarted' : cleared ? 'reload_required' : result.error ? 'failed' : 'cancelled',
                    snapshotId, error: cleared ? undefined : result.error, warning, deletionStarted };
            } catch (error) {
                blocked = deletionStarted;
                if (!deletionStarted) release?.();
                return { status: cleared ? 'reload_required' : 'failed', snapshotId, error, deletionStarted };
            } finally { busy = false; }
        }
    };
}
