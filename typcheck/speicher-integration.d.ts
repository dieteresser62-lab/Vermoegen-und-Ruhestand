import type * as D from './datenvertraege.js';
export interface AppError extends Error { code?: string; quarantinePath?: string; recoverySnapshotId?: string; rollbackError?: unknown; recovery?: D.ProfileRecovery; }
export interface Operation { check(): void; commit(phase?: string): void; controller: AbortController; owns?(owner?: symbol): boolean; }
export interface Reason { phase?: string; owner?: symbol; message?: string; }
export interface Guard {
    reasons(): Reason[]; isBusy(): boolean;
    register(owner: symbol, options: { read(): Reason }): { unregister(): void };
    prepare(options: object): Promise<Attempt | null>; validate(attempt: Attempt): boolean; end(attempt: Attempt): void;
    reload(options: { opener?: HTMLElement; subscribeChanges?: (notify: () => void) => unknown; mutate(operation: Operation): Promise<boolean>; flush(): Promise<boolean>; reload(): unknown }): Promise<boolean>;
}
export interface Attempt { discardedSave?: boolean; }
export interface LifecycleOptions { guard?: Guard | null; navigationOperation?: Operation | null; }
export interface Lifecycle { run<T>(options: LifecycleOptions, work: (operation: Operation) => T | Promise<T>): Promise<Awaited<T>>; isBlocked(): boolean; }
export type CreateLifecycle = (options?: { guard?: Guard | null }) => Lifecycle;
export type RegistryResult = {status: 'valid' | 'missing' | 'empty'; value: D.ProfileRegistry; raw: string | null; error: null} | {status: 'corrupt' | 'unavailable'; value: null; raw: string | null; error: {code?: string; message?: string}};
export type LoadRegistry = (storage?: D.RecordReader) => RegistryResult;
export interface ReplaceOptions extends LifecycleOptions {
    probelaufOwner?: symbol;
    allowKey?: (key: string, options?: ReplaceOptions) => boolean; expectedRecords?: D.StringRecords;
    postValidate?: (records: D.StringRecords) => unknown | Promise<unknown>;
    deleteKeys?: string[]; upserts?: [string, string][]; replace?: boolean;
    probelaufDomainWrite?: boolean; restoreLock?: boolean;
}
export interface Facade {
    getItemSync(key: string): string | null; exportAllSync(): { records: D.StringRecords };
    getPersistenceStatus(): { activeArea: string }; readPersistedRecords(policy?: D.KeyPolicy): Promise<D.StringRecords>;
    flush(): Promise<boolean>; replaceRecordsTransactional(records: D.StringRecords, options?: ReplaceOptions): Promise<unknown>;
    hasSyncWriteBlocks?(): boolean; blockSyncWrites?(keys: string[], message: string): unknown;
}
export interface BackupOptions extends LifecycleOptions {
    persistence?: Facade; storage?: (Facade & Partial<D.RecordStorage>) | (D.RecordStorage & {exportAllSync?: () => {records: D.StringRecords}}); snapshotStorage?: unknown;
    probelaufController?: { state?: unknown; busy?: boolean; blocked?: boolean };
    window?: Window & typeof globalThis; document?: Document; filename?: string; reason?: string;
    download?: (data: D.FullBackup, filename: string, doc: Document) => unknown | Promise<unknown>;
    preparedRecovery?: { recoverySnapshotId: string; previousRecords: D.StringRecords };
    validateAfterLoad?: (records: D.StringRecords, backup: D.NormalizedFullBackup) => unknown;
    button?: HTMLButtonElement; status?: HTMLElement; fileInput?: HTMLInputElement;
    confirmImport?: (description: string) => boolean | Promise<boolean>;
    createRecoveryBackup?: (options: BackupOptions) => Promise<{ skipped: boolean }>;
    reload?: () => unknown;
}
export interface OverviewOptions extends LifecycleOptions {
    annualLease?: object;
    expectedProfileId?: string; storage?: D.RecordStorage; flush?: () => Promise<boolean>; now?: () => Date;
    locks?: LockManager; isBlocked?: () => boolean; isCurrent?: () => boolean; persistence?: Facade; archive?: typeof import('../app/shared/snapshot-archive.js').SnapshotArchive;
}
export interface Cash { people: {id: string; cashRaw: string | null; historyRaw: string | null; confirmationRaw?: string | null}[]; values: Record<string, string | number>; playValues?: D.PlayMonthValues; [key: string]: unknown; }
export interface MonthRequest { month: string; scope: D.PlanScope; expectedProfileId: string; cash?: Cash; }
export interface ProfileOptions { registryRaw?: unknown; scope?: string; preservePersonInputs?: boolean; }
export interface RecoveryOptions { storage?: D.RecordStorage; recoveryDocument?: D.ProfileRecoveryDocument | null; confirmed?: boolean; captureProfileData?: () => D.StringRecords; exportedAt?: string; backend?: string; }
export interface QuotePatch { profileId: string; raw: string; updates: { index: number; trancheId: string; quote: { price: number; asOf: number; currency: string; symbol: string } }[]; }
export interface ProbelaufProtection { ownsWrites?(options: ReplaceOptions): boolean; checkCurrent?(): unknown; mutation?(options: ReplaceOptions): unknown; snapshot?(id: string, options: ReplaceOptions): unknown; }
export interface InitOptions { adapter?: import('./runtime-contracts.js').PersistenceAdapter; debounceMs?: number; window?: Window & typeof globalThis; doc?: Document; localStorage?: D.RecordStorage | null; installLifecycleHooks?: boolean; installTauriCloseHook?: boolean; }
export interface Warning { code: string; message: string; quarantinePath?: string; }
export interface CloseRequest { id: string; controller: AbortController; guard: Guard | null; attempt: Attempt | null; held?: boolean; }
export interface CloseBinding { pending: CloseRequest | null; lastId: bigint; disposed: boolean; unlisten: (() => void) | null;
    rejections: Map<string, { promise: Promise<void> | null; timer: ReturnType<typeof setTimeout> | null }>;
    reject(id: string): Promise<void> | null; cancelPending(): void; dispose(): void; }

export interface AnnualDraft { status: string; yearHigh?: D.YearHighChoice; records: D.StringRecords; baseRecords: D.StringRecords; periodId: string;
    targetYear: number; planningYear: number; scope: D.PlanScope; profileId: string; values: D.PlanValues;
    ageByPerson: Record<string, number>; results?: Record<string, unknown>; inflation?: import("./balance-ui.js").InflationResult; }
export interface AnnualOptions { yearHigh?: D.YearHighChoice; engineApi?: typeof import('../engine/index.mjs').EngineAPI; adoptedPlanPatch?: import("./profile-ui.js").PlanPatch;
    careValues?: unknown; careToday?: Record<string, number>; cash?: Cash; now?: () => Date; }
export interface AnnualCommitOptions extends AnnualOptions { draft?: AnnualDraft; targetYear?: number; marketData?: import("./balance-ui.js").ComputeAnnualOptions["marketData"]; scope?: D.PlanScope;
    storage?: D.RecordStorage; persistence?: Facade; navigationOperation?: Operation; isCurrent?: () => boolean; }
export type StoredCalculation = Omit<ReturnType<typeof import('../app/balance/balance-input-storage.js').buildBalanceEngineInputFromStorage>, 'householdPlan'> & {householdPlan: import('./profile-ui.js').PlanRead & {status: 'valid'; entry: import('./profile-ui.js').PlanEntry} & {scope: D.PlanScope}};
export type HouseholdRuns = NonNullable<ReturnType<typeof import('../app/balance/balance-main-profilverbund.js').evaluateStoredAnnualHousehold>> & {householdResult: import('./rechenkern.js').EngineSuccess};

/** Gemeinsame Grenze zum Cashwriter; keine clear()-Fähigkeit für diese Operation erforderlich. */
export type PrepareHouseholdCash = (options: {storage: D.RecordStorage; registry: D.ProfileRegistry; activeId: string; ids: string[];
    checkMembership: boolean; cash: Cash; date: string; recordConfirmation: boolean}) => {registry: D.ProfileRegistry; records: D.StringRecords; total: number};
