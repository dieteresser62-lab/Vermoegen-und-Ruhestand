/** Anzeige- und Integrationsgrenzen der Übersicht; keine Laufzeitwerte. */
import type * as D from './datenvertraege.js';
import type * as R from './rechenkern.js';
import type * as B from './balance-ui.js';
import type * as I from './speicher-integration.js';
export interface Summary extends D.BalanceSummary {status?: string; action?: Partial<B.Summary>; actionBasis?: {material?: boolean; sourceFingerprint?: string; fingerprintVersion?: number}; liquidityBefore?: number; liquidityAfter?: number; liquidityCoverage?: number; marketPhase?: string;}
export type ReadSummary = (...args: Parameters<typeof import('../app/overview/overview-storage.js').readOverviewSummary>)=>Summary|null;
export type FingerprintOptions = {registry: D.ProfileRegistry & {trancheReconciliation?: unknown}; activeId: string; liveData?: D.StringRecords; scope: D.PlanScope; kind: string; referenceYear?: number};
export interface ProjectionOptions {registry: D.ProfileRegistry & {trancheReconciliation?: unknown}; activeId: string; liveData?: D.StringRecords; now?: Date; annualTargetYear?: number; lastBackup?: string; priceReport?: unknown; recovery?: boolean; balanceSingleFallback?: boolean; historyPeriod?: string; historyReport?: unknown; snapshots?: D.Snapshot[]; annualArchive?: {status: string; error?: unknown};}
export type Model = B.OverviewModel;
export type CashPerson = ReturnType<typeof import('../app/profile/profile-cash-update.js').readCashPerson>;
export type CashProposalOptions = {doc?: Document; model?: Partial<Model>; people?: CashPerson[]; targetYear?: number; controller?: ReturnType<typeof import('../app/shared/probelauf-state.js').getProbelaufController>; storage?: D.RecordStorage & {clear(): void}};
export type CashProposal = Omit<D.PlayCashValue, 'source'> & {source: string};
export type CashProposals = Record<string, CashProposal|{error: string; value?: never}>;
export type WithOptions<F extends (...args: never[])=>unknown,O> = (options: Omit<NonNullable<Parameters<F>[0]>, keyof O> & O)=>ReturnType<F>;
export type CreateCloseSession = WithOptions<typeof import('../app/shared/annual-close-session.js').createAnnualCloseSession, {
    readContext?: ()=>unknown; fetchers?: object; showPreparation?: ReturnType<B.CreateAnnualDialog>['showAnnualPreparation'];
}>;
export type CreateMonthSession = WithOptions<typeof import('../app/shared/annual-close-session.js').createAnnualMonthSession, {
    targetYear?: number; annualSnapshotId?: string; cash?: I.Cash; readModel?: ()=>Model; annualLease?: {released?: boolean}; guard?: import("./shared-annual.js").Guard;
}>;
export type ConfirmMonthSummary = WithOptions<typeof import('../app/shared/annual-close-session.js').confirmAnnualMonthSummary, {targetYear?: number; scope?: D.PlanScope; expectedProfileId?: string}>;
export type FinalizeMonth = WithOptions<typeof import('../app/shared/annual-close-session.js').finalizeAnnualMonth, {createSession?: CreateMonthSession; options?: Parameters<CreateMonthSession>[0]}>;
export type AnnualDialog = (options: B.AnnualModalOptions & {document?: Document; priceActions?: ReturnType<CreatePriceActions>; evaluatePlan?: typeof import('../app/shared/annual-plan-editor.js').evaluateAnnualPlanPreview})=>ReturnType<B.CreateAnnualDialog>;
export type CreateCoordinator = (options: Omit<B.AnnualCoordinatorOptions, 'restoreSnapshot'> & {restoreSnapshot?: (id: string, options: object)=>Promise<unknown>})=>ReturnType<B.CreateAnnualCoordinator>;
export type CreatePriceActions = WithOptions<typeof import('../app/shared/close-price-actions.js').createClosePriceActions, {getModel?: ()=>Model; onReport?: (report: unknown)=>void}>;
export type BindHistoryFetch = WithOptions<typeof import('../app/tranches/tranchen-history-fetch.js').bindHistoryFetch, {afterStartup?: Promise<unknown>; firstPlanningYear?: ()=>number}>;
export type DeriveEvidence = WithOptions<typeof import('../app/shared/annual-close-evidence.js').deriveAnnualCloseEvidence, {targetYear?: number; scope?: D.PlanScope; activeId?: string}>;

export type RunPageDialog = (options: Partial<Parameters<typeof import('../app/shared/page-dialog.js').runPageDialog>[0]> & {title?: string; signal?: AbortSignal}, build: Parameters<typeof import('../app/shared/page-dialog.js').runPageDialog>[1])=>Promise<unknown>;
export type CloseHandle = ReturnType<typeof import('../app/shared/close-dialog.js').createCloseDialog>;
export type CreateCloseDialog = WithOptions<typeof import('../app/shared/close-dialog.js').createCloseDialog, {
    id?: string; title?: string; signal?: AbortSignal; returnFocus?: ()=>void; onClose?: ()=>boolean|Promise<boolean>;
}>;
export type BindPriceActions = (handle: CloseHandle, options?: {actions?: ReturnType<CreatePriceActions>; getModel?: ()=>Partial<Model>; update?: (model: Partial<Model>)=>void; signal?: AbortSignal; after?: ()=>void})=>void;
export type MonthAccepted = {cash?: I.Cash};
export interface MonthOptions {doc?: Document; signal?: AbortSignal; returnFocus?: ()=>void; people?: CashPerson[]; model?: Partial<Model>;
    onReady?: (handle: CloseHandle & {update(model: Model): void; syncReady(): void; isReady(): boolean; setImportActive(value: boolean): void; dirty(): boolean})=>void;
    onAccept?: (value: MonthAccepted|boolean)=>Promise<boolean>; priceActions?: ReturnType<CreatePriceActions>; getModel?: ()=>Partial<Model>; onDirty?: (dirty: boolean)=>void;
    isCommitActive?: ()=>boolean; canClose?: ()=>boolean; confirmDiscard?: ()=>Promise<boolean>; onClose?: ()=>boolean|Promise<boolean>;
}
export type CreateCloseResult = WithOptions<typeof import('../app/shared/close-dialog.js').createCloseResult, Partial<ReturnType<typeof import('../app/overview/overview-month-confirmation.js').projectConfirmedMonthResult>> & {withdrawalLabel?: string}>;
export interface AnnualOptions {doc?: Document; win?: Window & typeof globalThis; getModel?: ()=>Model; refresh?: ()=>void; getImports?: ()=>ReturnType<typeof import('../app/overview/overview-example-expenses.js').bindOverviewExampleExpenses>;
    priceActions?: ReturnType<CreatePriceActions>; storage?: D.RecordStorage & {clear(): void}; persistence?: typeof import('../app/shared/persistence-facade.js').PersistenceFacade; now?: ()=>Date;
    guard?: ReturnType<typeof import('../app/shared/navigation-guard-dialog.js').getPageNavigationGuard>;
    operationLock?: ReturnType<typeof import('../app/shared/annual-operation-lock.js').createAnnualOperationLock>; readers?: B.AnnualReaders;
    engineLoader?: typeof import('../app/shared/annual-engine-loader.js').annualEngineLoader;
    evaluatePlan?: typeof import('../app/shared/annual-plan-editor.js').evaluateAnnualPlanPreview; coordinatorOptions?: object; createMonthSession?: CreateMonthSession;
}
export type ImportOptions = Partial<Parameters<typeof import('../app/balance/balance-expenses-import.js').importExpenses>[0]>;
export type ImportExpenses = (options: ImportOptions)=>ReturnType<typeof import('../app/balance/balance-expenses-import.js').importExpenses>;
export interface ExpensesCloseOptions {imports?: Partial<Parameters<typeof import('../app/overview/overview-example-expenses.js').bindOverviewExampleExpenses>[0]>;
    months?: Partial<Parameters<typeof import('../app/overview/overview-main.js').bindOverviewMonthClose>[0]>; annual?: AnnualOptions;}

export interface Occasion {kind: string; annualState: string; annualReason?: string; month: string; previousYear: number; previousMonth: number; monthCompleted: boolean; monthApplicable: boolean; closingYear: number; planningYear: number; firstPlanningYear: number; catchUp?: boolean;}
export type PersonChoice = (options: Parameters<import('./simulator-ui.js').PageChoice>[0] & {updateRows?: (values: Record<string, string>)=>object[]; onConfirm?: (values: Record<string, string>)=>Promise<void>; signal?: AbortSignal})=>ReturnType<import('./simulator-ui.js').PageChoice>;
export interface MonthBinderOptions {doc: Document; win: Window & typeof globalThis; getModel: ()=>Model; refresh: ()=>void; store?: typeof import('../app/overview/overview-storage.js').storeMonthProvision; confirm?: typeof import('../app/overview/overview-month-confirmation.js').requestOverviewMonthConfirmation; priceActions?: ReturnType<CreatePriceActions>; getImports?: ()=>ReturnType<typeof import('../app/overview/overview-example-expenses.js').bindOverviewExampleExpenses>; host?: HTMLElement; returnFocus?: ()=>void;}
