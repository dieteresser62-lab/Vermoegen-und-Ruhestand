/** Lesemodelle der Datenseite und bestehende Grenzen ihrer Schreibaktionen. */
import type * as D from './datenvertraege.js';
import type * as I from './speicher-integration.js';
export type Persistence = typeof import('../app/shared/persistence-facade.js').PersistenceFacade;
export type Archive = typeof import('../app/shared/snapshot-archive.js').SnapshotArchive;
export type Guard = ReturnType<typeof import('../app/shared/navigation-guard-dialog.js').getPageNavigationGuard>;
export type PriceCoverage = Partial<ReturnType<typeof import('../app/data/data-prices.js').projectDataPrices>>;
export interface DataProjectionOptions {
    records: D.StringRecords; snapshots?: D.SnapshotIndex[]; points?: D.Snapshot[]|null; archiveBytes?: number|null;
    backend?: string; recordCount?: number; migrationWarning?: ReturnType<Persistence['getPersistenceStatus']>['migrationWarning'];
    now?: Date; startupReport?: ReturnType<typeof import('../app/tranches/tranchen-startup-prices.js').readStartupPriceReport>;
    serviceReport?: {status: string; kind?: string; attemptedAt?: number}; archiveError?: string|null; trialStateRaw?: string;
    retentionRecords?: D.StringRecords;
}
export interface DataModel {
    age: {days: number|null; warning: boolean}; lastBackup?: string|null; backupUnknown?: boolean; backend: string; recordCount: number;
    migrationWarning?: DataProjectionOptions['migrationWarning']; snapshots: D.SnapshotIndex[]; activeTrialSnapshotId?: string|null; trialActive?: boolean;
    liveBytes: number|null; priceBytes: number|null; archiveBytes: number|null; totalBytes: number|null; knownBytes: number|null;
    liveError?: string|null; priceError?: string|null; archiveError?: string|null; shares: number[]|null; error?: string;
    priceCoverage: PriceCoverage; changes?: ReturnType<typeof import('../app/data/data-backup-summary.js').compareBackupSummaries>;
    profileIds?: string[]; activeProfileId?: string; prices?: {symbol: string; count: number; failed: boolean; error: string|null}[];
    counts?: {persons: number; months: number; cash: number; tranches: number; prices: number}; householdNames?: string[];
    expenseYears?: number[]; hasCashHistory?: boolean; hasPlans?: boolean;
    retention?: ReturnType<typeof import('../app/shared/snapshot-retention.js').projectSnapshotRetention>|null;
}
export interface DataBindingOptions {win?: Window & typeof globalThis; refresh?: ()=>Promise<void>; guard?: Guard;}
export interface NewBeginningSelection {backupSaved?: boolean; withoutBackup?: boolean; confirmed?: boolean; busy?: boolean; deleteSnapshots?: boolean;}
export interface NewBeginningOptions {
    persistence?: Persistence; archive?: Archive; probelaufController?: I.BackupOptions['probelaufController']; window?: Window & typeof globalThis;
    recovery?: boolean;
}
export interface NewBeginningControllerOptions extends Omit<NewBeginningOptions,'recovery'> {guard?: Guard; recovery?: ()=>boolean; navigate?: ()=>unknown;}
export interface DataPriceOptions extends DataBindingOptions {storage?: D.RecordStorage; persistence?: Persistence;
    coordinator?: (options: import('./tranches-history.js').RunOptions)=>Promise<import('./tranches-history.js').FetchReport & {error?: Error}>;
    probe?: (options?: {signal?: AbortSignal; deadline?: number; proxyBase?: string})=>ReturnType<typeof import('../app/tranches/tranchen-price-service.js').probeProxyHealth>;
    readModel?: ()=>Promise<DataModel>; now?: ()=>Date;
}
