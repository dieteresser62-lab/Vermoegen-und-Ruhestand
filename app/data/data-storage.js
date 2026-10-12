import { DAILY_PRICES_KEY, assertDailyPrices } from '../tranches/tranchen-history-store.js';
import { isAllowedPersistenceImportKey, isLegacySnapshotKey } from '../shared/persistence-key-policy.js';
import { validateSnapshot } from '../shared/snapshot-archive.js';

const utf8 = value => new TextEncoder().encode(JSON.stringify(value)).length;
/** Summe einzelner serialisierter [Key, Rohstring]-Records und vollständiger Punkte.
 * Container/Legacykopien zählen nicht nochmals; Archivkurse gehören zu Punkten.
 */
export function measureDataStorage(records, points, { liveError = null, archiveError = null } = {}) {
    let liveBytes = 0, priceBytes = 0, archiveBytes = 0, priceError = null;
    if (liveError || !records) liveBytes = priceBytes = null;
    else for (const [key, raw] of Object.entries(records)) {
        if (!isAllowedPersistenceImportKey(key) || isLegacySnapshotKey(key) || key === 'rs_snapshot_archive_v1') continue;
        if (typeof raw !== 'string') { liveError = 'Record ist kein bestätigter Rohstring.'; liveBytes = null; continue; }
        if (key === DAILY_PRICES_KEY) {
            try { assertDailyPrices(JSON.parse(raw)); priceBytes += utf8([key, raw]); }
            catch (error) { priceError = error.message; priceBytes = null; }
        } else if (liveBytes !== null) liveBytes += utf8([key, raw]);
    }
    if (archiveError || !points) archiveBytes = null;
    else {
        const ids = new Set();
        try {
            for (const point of points) {
                validateSnapshot(point);
                if (ids.has(point.id)) continue;
                ids.add(point.id); archiveBytes += utf8(point);
            }
        } catch (error) { archiveError = error.message; archiveBytes = null; }
    }
    const categories = [liveBytes, priceBytes, archiveBytes];
    const complete = categories.every(value => value !== null);
    const knownBytes = categories.reduce((sum, value) => sum + (value || 0), 0);
    return { liveBytes, priceBytes, archiveBytes, totalBytes: complete ? knownBytes : null, knownBytes,
        shares: complete && knownBytes > 0 ? categories.map(value => value / knownBytes * 100) : null,
        liveError, priceError, archiveError };
}
export function storageBackendText(backend, origin = '') {
    return backend === 'Tauri JSON File' ? 'Tauri: ruhestand_suite_data.json und ruhestand_suite_snapshots.json im App-Datenordner'
        : backend === 'IndexedDB' ? `Browser: IndexedDB ruhestand-suite (kv, metadata, snapshots)${origin ? ' · ' + origin : ''}`
            : backend === 'localStorage' ? `Browser: localStorage-Fallback${origin ? ' · ' + origin : ''}` : `Speicherbackend: ${backend}`;
}
