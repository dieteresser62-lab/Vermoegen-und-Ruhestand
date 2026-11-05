import { buildFullPersistenceBackup, normalizeFullPersistenceBackup } from './persistence-backup.js';
import { isLegacySnapshotKey } from './persistence-key-policy.js';

// Alte Wiederherstellungspunkte (ruhestandsmodell_snapshot_*) enthalten frühere Datenstände und gehen nie mit.
const withoutPoints = records => Object.fromEntries(Object.entries(records).filter(([key]) => !isLegacySnapshotKey(key)));

// HV-3: Übergabedatei eines Haushalts = Vollsicherung seiner Records plus Herkunft (Kennung, Name).
// Wiederherstellungspunkte gehören nicht hinein (Nutzerentscheidung 04.11.); die Vollsicherung enthält sie ohnehin nicht.
export const HOUSEHOLD_TRANSFER_PURPOSE = 'household-transfer';

/** @param {{id: string, name: string, records: Record<string, string>}} source */
export function buildHouseholdTransfer({ id, name, records }) {
    const storage = /** @type {NonNullable<import('../../typcheck/speicher-integration.js').BackupOptions['storage']>} */ (/** @type {unknown} */ ({ exportAllSync: () => ({ records: withoutPoints(records) }) }));
    const backup = buildFullPersistenceBackup({ storage });
    return { ...backup, backupPurpose: HOUSEHOLD_TRANSFER_PURPOSE, household: { id, name } };
}

/** @param {string} name @param {Date} [date] */
export function householdTransferFilename(name, date = new Date()) {
    const safe = String(name || 'Haushalt').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Haushalt';
    return `${/^haushalt\b/i.test(safe) ? '' : 'Haushalt-'}${safe}_${date.toISOString().slice(0, 10)}.json`;
}

/** Liest eine Übergabedatei oder eine Vollsicherung; prüft sie wie den Vollimport, bevor etwas gespeichert wird.
 * @param {string} text @returns {{records: Record<string, string>, name: string, transfer: boolean}} */
export function readHouseholdFile(text) {
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('Die Datei ist keine lesbare Übergabedatei.'); }
    const normalized = normalizeFullPersistenceBackup(payload);
    if (!normalized.ok) throw new Error(normalized.message);
    const household = /** @type {{household?: {name?: unknown}, backupPurpose?: unknown}} */ (/** @type {unknown} */ (normalized.backup));
    return { records: withoutPoints(normalized.backup.records), name: typeof household.household?.name === 'string' ? household.household.name : '',
        transfer: household.backupPurpose === HOUSEHOLD_TRANSFER_PURPOSE };
}
