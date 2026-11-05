import { PersistenceFacade } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { isAllowedPersistenceImportKey } from '../shared/persistence-key-policy.js';
import { recordIdentity } from '../shared/snapshot-restore.js';

/** Vollständiger Rückkehrpunkt erhält auch gelöschte Personen und gemeinsame Verträge.
 * @param {string} label
 * @param {{persistence?: typeof PersistenceFacade, archive?: typeof SnapshotArchive, navigationOperation?: import('../../typcheck/runtime-contracts.js').NavigationOperation, expectedRecords?: Record<string, string>}} [options]

 * @returns Bytegleich bestätigter Wiederherstellungspunkt.
 */
export async function createProfileManagementRecovery(label, { persistence = PersistenceFacade, archive = SnapshotArchive, navigationOperation, expectedRecords } = {}) {
    if (await persistence.flush({ navigationOperation }) === false) throw new Error('Der aktuelle Stand konnte nicht gespeichert werden.');
    navigationOperation?.check();
    const records = await persistence.readPersistedRecords(isAllowedPersistenceImportKey);
    if (expectedRecords && recordIdentity(records) !== recordIdentity(expectedRecords)) throw new Error('Der Personenbestand hat sich geändert. Bitte erneut prüfen.');
    const activeId = records.rs_current_profile || records.rs_active_profile || '';
    const point = await archive.createSnapshot({ id: `person_management_${globalThis.crypto.randomUUID()}`,
        label, kind: SNAPSHOT_KINDS.profileManagementBefore, records, activeProfileId: activeId,
        activeProfileName: JSON.parse(records.rs_profiles_v1 || '{"profiles":{}}').profiles[activeId]?.meta?.name || '',
        restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'full-import' }
    }, { storage: persistence, navigationOperation });
    const confirmed = await archive.readSnapshot(point.id, { storage: persistence });
    navigationOperation?.check();
    if (JSON.stringify(point) !== JSON.stringify(confirmed)
        || recordIdentity(records) !== recordIdentity(await persistence.readPersistedRecords(isAllowedPersistenceImportKey))) {
        throw new Error('Der Wiederherstellungspunkt konnte nicht bestätigt werden. Es wurde nichts geändert.');
    }
    return point;
}
