import { DATA_BACKUP_SUMMARY_KEY, backupProfileData, buildBackupSummary, compareBackupSummaries } from './data-backup-summary.js';
import { overviewBackupAge } from '../overview/overview-model.js';
import { DAILY_PRICES_KEY, assertDailyPrices, requireHistoryRecord } from '../tranches/tranchen-history-store.js';
import { isAllowedPersistenceImportKey } from '../shared/persistence-key-policy.js';
import { validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { SnapshotArchive } from '../shared/snapshot-archive.js';
import { projectDataPrices } from './data-prices.js';
import { measureDataStorage } from './data-storage.js';
import { appNow } from '../shared/app-clock.js';
import { CONFIG } from '../balance/balance-config.js';

export async function projectDataModel({ records, snapshots = [], archiveBytes = null, backend = 'unbekannt', recordCount = Object.keys(records).length, migrationWarning = null, now = appNow(), startupReport = null, serviceReport = null, points = null, archiveError = null }) {
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
    const model = { lastBackup: age.days === null ? null : lastBackup, backupUnknown: Boolean(lastBackup) && age.days === null, age, backend, recordCount, migrationWarning, snapshots, ...measurement,
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
        .filter(profile => profile.meta?.belongsToHousehold !== false)
        .map(profile => profile.meta?.name?.trim() || 'Name unbekannt');
    const expenses = JSON.parse(records.balance_expenses_v1 || '{"years":{}}');
    model.expenseYears = Object.keys(expenses.years || {}).filter(year => /^\d{4}$/.test(year)).map(Number).sort((a, b) => a - b);
    model.hasCashHistory = Object.values(profiles).some(data => Object.hasOwn(data, 'profile_cash_history_v1'));
    model.hasPlans = Object.keys(records).some(key => key === CONFIG.STORAGE.LS_KEY || key === 'household_simulator_needs_v1')
        || Object.values(profiles).some(data => Object.hasOwn(data, CONFIG.STORAGE.LS_KEY));
    return model;
}

export async function readDataModel(persistence, options = {}) {
    // Bestätigte Quelle lesen; keine Renderwrites und keine künstlichen Abschlussbelege.
    const records = await persistence.readPersistedRecords(isAllowedPersistenceImportKey);
    let snapshots = [], points = null, archiveError = null;
    try {
        snapshots = await SnapshotArchive.listSnapshots({ storage: persistence });
        points = await Promise.all(snapshots.map(point => SnapshotArchive.readSnapshot(point.id, { storage: persistence })));
    } catch (error) { archiveError = error.message; }
    const { backend, recordCount, migrationWarning } = persistence.getPersistenceStatus();
    const model = await projectDataModel({ ...options, records, snapshots, points, archiveError, backend, recordCount, migrationWarning });
    return { ...model, archiveError: model.archiveError || archiveError };
}
