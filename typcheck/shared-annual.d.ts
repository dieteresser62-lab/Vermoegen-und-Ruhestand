/** Vorbereitung und flüchtige Zustände des bestehenden Jahresablaufs. */
import type * as D from './datenvertraege.js';
import type * as I from './speicher-integration.js';
import type * as B from './balance-ui.js';
export type Archive = typeof import('../app/shared/snapshot-archive.js').SnapshotArchive;
export type Persistence = typeof import('../app/shared/persistence-facade.js').PersistenceFacade;
export type Guard = ReturnType<typeof import('../app/shared/navigation-guard.js').createNavigationGuard>;
export interface FetchOperation {check(): void; controller: {signal?: AbortSignal};}
export interface AnnualFetchOptions {targetYear?: number; signal?: AbortSignal;}
export interface EvidenceOptions {targetYear?: number; activeId?: string; scope?: D.PlanScope; records?: D.StringRecords; snapshots?: D.Snapshot[];}
export interface SnapshotReadOptions extends EvidenceOptions {archive?: Archive; excludeSnapshotId?: string; check?: ()=>void;}
export interface PrepareMarketOptions extends AnnualFetchOptions {manualPrice?: number; preparedMarketData?: Record<string, unknown>;
    onProgress?: (message: string)=>void; readers?: ReturnType<typeof import('../app/shared/annual-marketdata.js').createAnnualMarketDataReaders>; now?: ()=>Date;
    navigationOperation?: I.Operation;
}
export interface PlanPreviewOptions extends I.AnnualOptions {targetYear?: number; storage?: D.RecordStorage; choiceVariant?: "year_end"|"year_high";
    marketData?: B.ComputeAnnualOptions['marketData'] & {manualPrice?: number}; engineLoader?: typeof import('../app/shared/annual-engine-loader.js').annualEngineLoader; signal?: AbortSignal;}
export type PlanPreview = Awaited<ReturnType<typeof import('../app/shared/annual-plan-editor.js').evaluateAnnualPlanPreview>>;
export interface PlanDraftOptions {evaluate?: (patch: import('./profile-ui.js').PlanPatch|undefined)=>Promise<PlanPreview>; notify?: (state: PlanDraftState)=>void;}
export interface PlanEditorOptions extends PlanDraftOptions {doc?: Document; listen?: (node: EventTarget, type: string, callback: (event: FocusEvent)=>unknown)=>void;
    getPreview?: ()=>ReturnType<typeof import("../app/balance/balance-annual-preview.js").projectAnnualPreview>; getAnnualExpenses?: ()=>{needsReview?: ReturnType<typeof import("../app/expenses/expenses-needs.js").readCloseExpenseNeeds>}; onState?: (state: PlanDraftState)=>void; budgetNote?: ()=>string|null;}
export interface RetryOptions {storage?: D.RecordStorage; archive?: Archive; getProfileId?: ()=>string; getReferenceDate?: ()=>Date; now?: number; scope?: D.PlanScope;}
export interface AnnualRetry {token?: string; profileId: string; snapshotId: string; instrument: string; targetYear: number; periodId: string; createdAt?: number; price?: number;}
export interface CoordinatorRequest extends Partial<Omit<B.PreparedAnnual,"adoptedPlanPatch">> {targetYear?: number; resume?: AnnualRetry; clarify?: boolean; opener?: HTMLElement;
    annualLease?: object; adoptedPlanPatch?: import("./profile-ui.js").PlanPatch; confirmedPreparation?: B.PreparedAnnual & {preparedMarketData?: Record<string,unknown>}; onProgress?: (message: string)=>void;}
export interface CoordinatorOptions {
    storage?: D.RecordStorage; persistence?: Persistence; archive?: Archive; now?: ()=>Date; clock?: ()=>number;
    engineLoader?: typeof import('../app/shared/annual-engine-loader.js').annualEngineLoader;
    operationLock?: ReturnType<typeof import('../app/shared/annual-operation-lock.js').createAnnualOperationLock>;
    navigationLifecycle?: ReturnType<typeof import('../app/shared/annual-coordinator.js').createAnnualNavigationLifecycle>; scope?: D.PlanScope;
    getProfileId?: ()=>string; getPlanningStatus?: (date: Date)=>ReturnType<typeof import('../app/overview/overview-model.js').projectOverviewFromRecords>;
    confirmAnnual?: (options: object)=>Promise<B.PreparedAnnual & {preparedMarketData?: Record<string,unknown>}|null>;
    getLegacyDecision?: (year: number, options: {signal: AbortSignal; opener?: HTMLElement})=>Promise<string|null>;
    flushLiveState?: (options?: {sync?: boolean})=>Promise<boolean|void>; validateLiveState?: ()=>{ok: boolean; error?: Error}|Promise<{ok: boolean; error?: Error}>;
    prepareMarketData?: (options: PrepareMarketOptions)=>Promise<{ok: boolean; error?: Error; results?: object; marketData?: B.ComputeAnnualOptions['marketData']}>;
    prepareAnnualDraft?: typeof import('../app/balance/balance-annual-storage.js').computeAnnualPlanUpdate;
    createSnapshot?: typeof import('../app/shared/annual-coordinator.js').createAnnualSnapshot; snapshotId?: string;
    commit?: (options: I.AnnualCommitOptions)=>Promise<AnnualCommit>;
    projectAnnualState?: (committed: AnnualCommit & {nextYear: number})=>void; reportError?: (error: Error)=>void; clearError?: ()=>void; showPlanningStart?: (options: {firstPlanningYear?: number; nextYear?: number; opener?: HTMLElement})=>void;
    sessionStore?: ()=>D.RecordStorage; reload?: ()=>unknown; confirmRestore?: (id: string, options: {opener?: HTMLElement; signal?: AbortSignal})=>Promise<boolean>;
    restoreSnapshot?: (id: string, options: object)=>Promise<{status: string}>;
}
export type Model = Partial<B.OverviewModel>;
export type PreparationHandle = NonNullable<ReturnType<typeof import('../app/shared/close-dialog.js').createCloseDialog>> & {
    update(model: Model): void; updateMarketData(data: {values: Record<string,unknown>; errors: Record<string,string>}): void;
    setImportActive(value: boolean): void; syncReady(): void; isReady?(): boolean; dirty(): boolean;
};
export interface PreparationOptions {targetYear?: number; validatePrice?: (value: string)=>B.PreparedAnnual; signal?: AbortSignal; opener?: HTMLElement;
    people?: import('./overview-ui.js').CashPerson[]; model?: Model; getModel?: ()=>Model; onReady?: (handle: PreparationHandle)=>void;
    onDirty?: (dirty: boolean)=>void; confirmDiscard?: ()=>Promise<boolean>; onClose?: ()=>boolean|Promise<boolean>; retryMarketData?: ()=>Promise<unknown>;
}
export interface AnnualDialogOptions {document?: Document; getLastUpdateResults?: ()=>object; getModel?: ()=>Model;
    priceActions?: ReturnType<typeof import('../app/shared/close-price-actions.js').createClosePriceActions>;
    projectMarketReadings?: typeof import('../app/balance/balance-annual-market-preview.js').projectAnnualMarketReadings;
    projectPreview?: typeof import('../app/balance/balance-annual-preview.js').projectAnnualPreview;
    /** WT-1: Umsetzungsstand des Plans für das abzuschließende Jahr (Schritt „Plan“ und Ergebnis). */
    readPlanProgress?: typeof import('../app/shared/annual-close-dialog.js').readAnnualClosePlanProgress;
    evaluatePlan?: typeof import('../app/shared/annual-plan-editor.js').evaluateAnnualPlanPreview;
    onError?: (error: Error, action?: string)=>void; onClearError?: ()=>void; onNotice?: (text: string)=>void; isCommitActive?: ()=>boolean;
}
export interface CloseSessionOptions {readContext?: ()=>unknown; fetchers?: Record<string, (options: AnnualFetchOptions)=>Promise<unknown>>;
    showPreparation?: (options: PreparationOptions)=>Promise<(B.PreparedAnnual & {preparedMarketData?: Record<string,unknown>})|null>;
    getImports?: ()=>{bindRoot(root: HTMLElement, signal: AbortSignal, handle: PreparationHandle): void; abort(): void; wait(): Promise<unknown>};
    guard?: Guard; schedule?: typeof setInterval; unschedule?: typeof clearInterval;
}
export interface DraftSessionState {context: string; targetYear: number; controller: AbortController; values: Record<string,unknown>; errors: Record<string,string>;
    dirty: boolean; getModel?: ()=>Model; loading?: Promise<void>|null; dialog?: PreparationHandle;}
export interface MonthSessionOptions {targetYear?: number; annualSnapshotId?: string; cash?: I.Cash; readModel?: ()=>Model; annualLease?: {released?: boolean};
    readPending?: ()=>unknown; readContext?: ()=>unknown; guard?: Guard; confirmSummary?: ()=>Promise<boolean>;
    store?: typeof import('../app/overview/overview-storage.js').storeMonthProvision;
    capturePeople?: (model: Model)=>ReturnType<typeof import('../app/profile/profile-cash-update.js').captureCashPeople>; archive?: Archive;
}
export interface ClosePriceOptions {doc?: Document; win?: Window & typeof globalThis; guard?: Guard; getModel?: ()=>Model; onReport?: (report: unknown)=>void;
    source?: typeof import('../app/tranches/tranchen-startup-prices.js').captureStartupPriceSource;
    coordinator?: typeof import('../app/tranches/tranchen-startup-prices.js').runStartupPriceRefresh;
    waitStartup?: ()=>Promise<unknown>; publish?: (report: unknown)=>unknown;
}
export interface PlanDraftState {revision: number; values: D.PlanValues|null; result: PlanPreview|null; error: string; pending: boolean; valid: boolean; dirty: boolean;}
export interface AnnualEvidence {status: string; periodId: string; metadata: D.AnnualPeriodMetadata|null; errors: {message: string}[];
    reason?: string; allowOpenConfirmation?: boolean; committedAt?: string|null;}
export type AnnualCommit = Partial<Omit<Extract<Awaited<ReturnType<typeof import('../app/balance/balance-annual-storage-commit.js').commitAnnualPlanUpdate>>, {completed: unknown}>, "periodId"|"results">> & {status: string; periodId?: string; results?: Partial<MarketResults> & {confirmed?: boolean; liquidityContext?: object; targetYear?: number}};
export type MarketResults = NonNullable<B.ComputeAnnualOptions['marketData']> & {startTime: number; endTime?: number; errors: {step: string; error: string}[]};
