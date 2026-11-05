import { PARTNERSHIP_KEY, migratePartnershipRecord } from './household-partnership.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';

/** Nur den echten Livebestand umstellen; im Spielbereich bis zur Rückkehr aufschieben. */
/**
 * @param persistence Bestehender Persistenzbesitzer.
 * @returns Ob die Vorrangzuordnung dauerhaft übernommen wurde.
 */
export async function migrateStoredPartnership(persistence = PersistenceFacade) {
    try {
        if (persistence.getPersistenceStatus?.()?.activeArea === 'spiel') return false;
        const raw = persistence.getItemSync(PARTNERSHIP_KEY);
        if (!raw) return false;
        const migrated = migratePartnershipRecord(raw);
        if (migrated === raw) return false;
        await persistence.replaceRecordsTransactional({ [PARTNERSHIP_KEY]: migrated }, {
            allowKey: key => key === PARTNERSHIP_KEY, expectedRecords: { [PARTNERSHIP_KEY]: raw }
        });
        return true;
    } catch (error) {
        console.warn('[Profile] Partnerschaftsübernahme aufgeschoben:', error);
        return false;
    }
}
