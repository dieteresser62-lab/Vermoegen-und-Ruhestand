import { DATA_BACKUP_SUMMARY_KEY, BACKUP_DELIVERY_KEY, backupProfileData, buildBackupSummary, compareBackupSummaries, readBackupImport, readLastFullBackupStatus } from './data-backup-summary.js';
import { overviewBackupAge } from '../overview/overview-model.js';
import { DAILY_PRICES_KEY, assertDailyPrices, requireHistoryRecord } from '../tranches/tranchen-history-store.js';
import { isAllowedPersistenceImportKey } from '../shared/persistence-key-policy.js';
import { validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { SnapshotArchive, isVisibleRestorePoint } from '../shared/snapshot-archive.js';
import { restorePointDamage } from '../shared/snapshot-restore.js';
import { projectDataPrices } from './data-prices.js';
import { measureDataStorage } from './data-storage.js';
import { PROBELAUF_STATE_KEY } from '../shared/persistence-key-policy.js';
import { appNow } from '../shared/app-clock.js';
import { CONFIG } from '../balance/balance-config.js';
import { isRestorePointNoticeOpen, RESTORE_POINTS_RESET_KEY } from '../shared/snapshot-reset.js';

/**
 * @param {import("../../typcheck/data-ui.js").DataProjectionOptions} options
 * @returns {Promise<import("../../typcheck/data-ui.js").DataModel>} Gelesener Datenbestand.
 */
export async function projectDataModel({ records, snapshots = [], archiveBytes = null, backend = 'unbekannt', recordCount = Object.keys(records).length, migrationWarning = null, now = appNow(), startupReport = null, serviceReport = null, points = null, archiveError = null, trialStateRaw = records[PROBELAUF_STATE_KEY], allRecords = records, damagedSnapshotIds = [], restoreReset = null }) {
    let trialActive = false;
    try { trialActive = Boolean(JSON.parse(trialStateRaw || 'null')?.active); } catch { /* Kein lesbarer Spielbereich. */ }
    const lastBackup = records.overview_last_full_backup_v1 || null;
    const age = overviewBackupAge(now, lastBackup);
    const measurement = measureDataStorage(records, points, { archiveError });
    // Reine Projektionen ohne gelesene Punkte können eine vorab gemessene Archivgröße übernehmen.
    if (points === null && archiveBytes !== null) {
        measurement.archiveBytes = archiveBytes;
        const values = [measurement.liveBytes, measurement.priceBytes, archiveBytes];
        measurement.totalBytes = values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
        measurement.knownBytes = values.reduce((a, b) => a + (b || 0), 0);
        measurement.shares = measurement.totalBytes ? values.map(value => value / measurement.totalBytes * 100) : null;
    }
    /** @type {import("../../typcheck/data-ui.js").DataModel} */
    const model = { lastBackup: age.days === null ? null : lastBackup, backupUnknown: Boolean(lastBackup) && age.days === null, age,
        backupImport: readBackupImport(records[BACKUP_DELIVERY_KEY]),
        backupDelivery: readLastFullBackupStatus({ getItem: key => records[key] ?? null }).delivery, backend, recordCount, migrationWarning, snapshots, trialActive, ...measurement,
        damagedSnapshotIds, restoreNotice: !trialActive && isRestorePointNoticeOpen(restoreReset, allRecords),
        priceCoverage: projectDataPrices(records, { now, startupReport, serviceReport }) };
    const validation = validatePersistenceDomainRecords(records);
    if (!validation.ok) return { ...model, liveBytes: null, liveError: validation.message, totalBytes: null, shares: null,
        knownBytes: (model.priceBytes || 0) + (model.archiveBytes || 0), error: validation.message, changes: null };
    const current = await buildBackupSummary(records, now.toISOString());
    let basis = null;
    try { basis = JSON.parse(records[DATA_BACKUP_SUMMARY_KEY] || 'null'); } catch { /* ausdrücklich unbekannt */ }
    model.changes = age.days === null ? null : compareBackupSummaries(basis, current, lastBackup);
    const profiles = backupProfileData(records);
    model.profileIds = Object.keys(profiles);
    model.activeProfileId = records.rs_current_profile || '';
    const counts = { persons: Object.keys(profiles).length, months: 0, cash: 0, tranches: 0, prices: 0 };
    for (const profile of Object.values(current.profiles)) {
        counts.months += Object.keys(profile.months).length;
        counts.cash += Object.keys(profile.cash).length;
        counts.tranches += Object.keys(profile.tranches).length;
    }
    // Ausgabe nennt nur vorhandene Bereiche, keine erfundenen Jahre oder Speicherorte.
    counts.persons = records.rs_profiles_v1 ? Object.keys(JSON.parse(records.rs_profiles_v1).profiles).length : 0;
    const prices = requireHistoryRecord(records[DAILY_PRICES_KEY], assertDailyPrices, { version: 1, symbols: {} });
    model.prices = Object.entries(prices.symbols).map(([symbol, data]) => ({ symbol, count: data.days.length, failed: data.failures > 0, error: data.lastError }));
    counts.prices = model.prices.reduce((sum, item) => sum + item.count, 0);
    model.counts = counts;
    const registry = records.rs_profiles_v1 ? JSON.parse(records.rs_profiles_v1) : { profiles: {} };
    model.householdNames = Object.values(registry.profiles)
        .map(profile => profile.meta?.name?.trim() || 'Name unbekannt');
    const expenses = JSON.parse(records.balance_expenses_v1 || '{"years":{}}');
    model.expenseYears = Object.keys(expenses.years || {}).filter(year => /^\d{4}$/.test(year)).map(Number).sort((a, b) => a - b);
    model.hasCashHistory = Object.values(profiles).some(data => Object.hasOwn(data, 'profile_cash_history_v1'));
    model.hasPlans = Object.keys(records).some(key => key === CONFIG.STORAGE.LS_KEY || key === 'household_simulator_needs_v1')
        || Object.values(profiles).some(data => Object.hasOwn(data, CONFIG.STORAGE.LS_KEY));
    return model;
}

/**
 * @param {import("../../typcheck/data-ui.js").Persistence} persistence
 * @param {Omit<import("../../typcheck/data-ui.js").DataProjectionOptions, "records">} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export async function readDataModel(persistence, options = {}) {
    // Bestätigte Quelle lesen; keine Renderwrites und keine künstlichen Abschlussbelege.
    const allRecords = await persistence.readPersistedRecords(() => true);
    const trialStateRaw = allRecords[PROBELAUF_STATE_KEY];
    const records = Object.fromEntries(Object.entries(allRecords).filter(([key]) => isAllowedPersistenceImportKey(key)));
    let snapshots = [], points = null, archiveError = null, damagedSnapshotIds = [];
    try {
        snapshots = await SnapshotArchive.listSnapshots({ storage: persistence });
        ({ points, damagedSnapshotIds } = await readPointsTolerant(snapshots.map(point => point.id), persistence));
    } catch (error) { archiveError = error.message; }
    const { backend, recordCount, migrationWarning } = persistence.getPersistenceStatus();
    let restoreReset = null;
    try { restoreReset = await persistence.getMetadata?.(RESTORE_POINTS_RESET_KEY) ?? null; } catch { /* Ohne lesbare Markierung kein Hinweis. */ }
    const model = await projectDataModel({ ...options, records, snapshots, points, archiveError, backend, recordCount, migrationWarning, trialStateRaw, allRecords, damagedSnapshotIds, restoreReset });
    return { ...model, archiveError: model.archiveError || archiveError };
}

/** SV-1: Ein beschädigter Punkt sperrt nicht die ganze Liste; er erscheint als „beschädigt“ und lässt sich nicht zurückholen.
 * @param {string[]} ids @param {import("../../typcheck/data-ui.js").Persistence} persistence */
async function readPointsTolerant(ids, persistence) {
    /** @type {import("../../typcheck/datenvertraege.js").Snapshot[]} */
    let points = [];
    const damagedSnapshotIds = [];
    try {
        points = /** @type {import("../../typcheck/datenvertraege.js").Snapshot[]} */ (await SnapshotArchive.readSnapshots(ids, { storage: persistence, checkStoredTypes: true }));
    } catch {
        for (const id of ids) {
            try { points.push(/** @type {import("../../typcheck/datenvertraege.js").Snapshot} */ (await SnapshotArchive.readSnapshot(id, { storage: persistence, checkStoredTypes: true }))); }
            catch { damagedSnapshotIds.push(id); }
        }
    }
    // SV-1b: Lesbare Punkte prüft die Liste mit derselben Domänenprüfung wie das Zurückholen.
    points.forEach(point => { if (isVisibleRestorePoint(point) && restorePointDamage(point)) damagedSnapshotIds.push(point.id); });
    return { points, damagedSnapshotIds };
}
