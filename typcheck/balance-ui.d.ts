/** Typen für Balance-Anzeige, Formulare und Workflowgrenzen; keine Laufzeitwerte. */
import type * as D from './datenvertraege.js';
import type * as R from './rechenkern.js';
import { EXPENSE_CSV_IMPORT_SUMMARY, EXPENSE_CSV_CATEGORY_NEEDS } from '../app/balance/balance-expenses-csv.js';
export interface YearStatsOptions {yearData: D.ExpensesYearAlt; annualBudget?: number; monthlyBudget?: number; includePlanned?: boolean; forecastMonths?: number[];}
export interface YearStats {annualUsed: number; annualRemaining: number; ytdUsed: number; ytdBudget: number; ytdDelta: number; annualForecast: number; avgMonthly: number; medianMonthly: number; monthsWithData: number;}
export interface NeedsStats {months: {month: number; withBreakdown: boolean; floor: number|null; flex: number|null; total: number; planned: number}[]; monthsWithBreakdown: number; monthsWithoutBreakdown: number; avgMonthly: {floor: number|null; flex: number|null; total: number}; annualForecast: Record<string, number|null>;}
export interface ExpenseHistoryRow {year: number; annualUsed: number; monthsWithData: number; avgMonthly: number; isCurrentPartialYear: boolean; segments?: {floor: number; flex: number; unallocated: number};}
export type CategoryCsv = Record<string, number> & {
    [EXPENSE_CSV_IMPORT_SUMMARY]?: {totalRows: number; importedRows: number; rejectedRows: number};
    [EXPENSE_CSV_CATEGORY_NEEDS]?: Record<string, D.CategoryNeeds>;
};
export interface PeriodOptions {targetYear?: number; currentAge?: number; metadata?: D.AnnualPeriodMetadata;}
export interface PeriodPlan {schemaVersion: number; periodId: string; targetYear: number; age: {before: number; after: number; birthDate: string|null; referenceYear: number}; inflation: {year: number}; marketData: {year: number}; expenses: {closingYear: number; nextYear: number}; steps: string[];}
export interface PeriodResult {status: 'ready'|'already_committed'|'incomplete_recovery'|'legacy_confirmation_required'|'invalid'; periodId: string|null; errors: {code: string; field: string; message: string}[]; proposedTargetYear?: number; recovery?: D.AnnualPeriodMetadata['pendingCommit'];}
export interface PlanSourceOptions {storage?: D.RecordReader; scope?: D.PlanScope; referenceYear?: number;}
export interface Input extends Partial<R.EngineInput> {healthBucket?: D.HealthBucket; sonstigeEinkuenfte?: number; minimumTagesgeld?: number; personalTagesgeldTarget?: number;}
export interface CashTransfer {from: string; to: string; amount: number; netto?: number;}
export interface Action extends Partial<R.Action> {internalCashRebalance?: CashTransfer; automaticExecutionBlocked?: boolean; cashOutflowSales?: R.ActionSource[]; liquidityInflowToMoneyMarket?: number;}
export interface ActionEntry {profileId?: string; name?: string; action: Action; input?: Input; spending?: Partial<R.SpendingResult>; targetLiquidity?: number; tagesgeldTarget?: number; cashSplit?: {fromGeldmarkt?: number; zielTagesgeld?: number};}
export interface Summary {verb: string; amount: number|null; note: string; purpose: string; transferDetails?: (CashTransfer & {name: string})[]; goldPurchaseAmount?: number; amountUnit?: string; extraTransfer: number;}
export interface Ui extends Partial<Omit<R.EngineUi, 'action'|'spending'>> {input?: Input; action?: Action; spending?: Partial<R.SpendingResult>; healthBucketDiagnostics?: HealthDiagnostics; nextYearBudget?: {rule?: {components?: {kind: string; amount: number}[]}} | null;}
export interface Budget {income: number; withdrawal: number; budget: number|null; saving: number|null;}
export interface FlexTrace extends Budget {grossNeed: number|null; cut: number|null; householdFlex: number|null; financedHouseholdFlex: number|null; householdFlexRate: number|null; netFloor: number|null; rows: {label: string; value: number; kind: string; left: number; width: number}[]; reason: string|null;}
export interface Reserves {before: {tagesgeld: number; geldmarkt: number; liquidity: number|null}; after: {tagesgeld: number; geldmarkt: number; liquidity?: number}|null; targets: {name: string; target: number}[]; target: number;}
export interface HealthDiagnostics {enabled: boolean; definition: D.HealthBucket; releasePolicy: string; releaseAllowed: boolean; releaseReason: string; releasedAmount: number; grossLiquidity: number; requestedAmount: number; lockedAmount: number; lockedFromMoneyMarket: number; lockedFromCash: number; operativeLiquidity: number; nominalGap: number; targetInflationAdjusted: number; targetCoveragePct: number|null; targetGap: number; warning: string|null;}
export interface ProfileInput {profileId: string; name?: string; inputs: Input; tranches?: readonly R.EngineTranche[]; balanceState?: D.BalanceState;}
export type PersonStatus = ReturnType<typeof import('../app/shared/person-data-status.js').readBalancePersonStatus>;
export type PersonEntry = PersonStatus['entries'][number];
export type PlannedPost = D.PlannedPosts['items'][number];
export interface PaymentChoice extends D.ExpensePayment {selected: boolean;}
export interface PlannedPostsOptions {storage?: D.RecordReader; scope: D.PlanScope; year: number; people?: PersonEntry[];}
export interface PlannedImportOptions extends Omit<PlannedPostsOptions, 'people'> {month: number; profileId: string; store: D.ExpensesStoreAlt;}
export interface InflationResult {rate: number; year: number; source: string; dataAsOf: string; fetchStatus: string; metric: string;}
export interface InflationReaderOptions {fetchImpl?: typeof fetch; now?: ()=>Date; timeoutMs?: number; setTimeoutImpl?: typeof setTimeout; clearTimeoutImpl?: typeof clearTimeout;}
export interface AnnualDom {inputs: Record<string, HTMLInputElement>; controls: Record<string, HTMLButtonElement>;}
export interface InflationHandlerOptions extends InflationReaderOptions {dom: AnnualDom; update: (options?: object)=>unknown; debouncedUpdate: ()=>void; navigationLifecycle?: import('./speicher-integration.js').Lifecycle;}
export interface RunwaySmoothing {targetMonths?: number; rawTargetMonths?: number; lowerTargetMonths?: number; upperTargetMonths?: number; hardMinimumMonths?: number; minRunwayMonths?: number; severityPct?: number; severity?: number; smoothingActive?: boolean; smoothingApplied?: boolean; smoothingFallback?: boolean; fallbackReason?: string;}
export type CreateAnnualLifecycle = (options?: {guard?: import('./speicher-integration.js').Guard; flush?: ()=>Promise<boolean|void>})=>ReturnType<typeof import('../app/shared/annual-coordinator.js').createAnnualNavigationLifecycle>;
export interface AnnualPreviewOptions {targetYear?: number; inputs?: Record<string, {value: unknown}>; inflation?: Partial<InflationResult>; entries?: PersonEntry[]; careValues?: D.HouseholdCareValues; storage?: D.RecordReader; confirmed?: boolean;}
export interface ComputeAnnualOptions {targetYear?: number; yearHigh?: D.YearHighChoice; marketData?: {inflation?: InflationResult; etf?: object; cape?: object}; scope?: D.PlanScope; storage?: D.RecordStorage; now?: ()=>Date;}
export interface Occasion {kind?: string; closingYear?: number; annualState?: string; firstPlanningYear?: number; monthApplicable?: boolean; monthCompleted?: boolean;}
export interface NextStepsOptions {occasion?: Occasion; actionBasis?: unknown; basisCurrent?: boolean; cashStatus?: {state: string; pendingCount?: number}; recovery?: boolean; expenses?: {beforePlanning?: boolean; year?: number; missingMonths?: {month: number}[]; month?: number; complete?: boolean}; monthlyWithdrawal?: number;}
declare global {interface Window {__profilverbundPersonSPB?: number; showDirectoryPicker?(): Promise<{requestPermission(options: {mode: string}): Promise<string>; [key: string]: unknown}>;}}
export type AnnualReaders = Omit<ReturnType<typeof import('../app/shared/annual-marketdata.js').createAnnualMarketDataReaders>, 'prepareCape'> & {prepareCape(options?: {targetYear?: number; signal?: AbortSignal}): ReturnType<ReturnType<typeof import('../app/shared/annual-marketdata.js').createAnnualMarketDataReaders>['prepareCape']>};
export type AnnualModalOptions = Omit<Parameters<typeof import('../app/shared/annual-close-dialog.js').createAnnualCloseDialog>[0], 'onError'|'onNotice'> & {
    dom?: {inputs: Record<string, {value: unknown}>};
    evaluatePlan?: (options: object)=>Promise<unknown>; priceActions?: unknown;
    onError?: (error: Error, action?: string)=>void; onNotice?: (text: string)=>void;
};
export type CreateAnnualDialog = (options?: AnnualModalOptions)=>ReturnType<typeof import('../app/shared/annual-close-dialog.js').createAnnualCloseDialog>;
export interface MarketExecuteOptions {nested?: boolean; manualPrice?: number; preparedResult?: Partial<Awaited<ReturnType<AnnualReaders['fetchVanguardETFPrice']>>>;}
export interface CapeExecuteOptions {nested?: boolean; preparedResult?: Awaited<ReturnType<AnnualReaders['prepareCape']>>;}
export interface ValidationEntry {field?: string; fieldId?: string; code?: string; message: string;}
export interface UpdateRequest {mode?: 'preview'|'persist_inputs'|'commit_period'; periodId?: string; navigationOperation?: import('./speicher-integration.js').Operation; persist?: unknown;}
export type ProfileRun = {profileId: string; name?: string; input: R.EngineInput; persistedInput?: R.EngineInput; ui: Partial<R.EngineUi>; newState: R.EngineState; balanceState?: D.BalanceState};
export type ProfileRuns = ProfileRun[] & {householdResult?: R.EngineSuccess; householdInput?: R.EngineInput; finalAction?: R.Action; threeBucketDiagnosis?: R.ThreeBucketState|null; distribution?: ReturnType<typeof import('../app/profile/profilverbund-balance.js').calculateWithdrawalDistribution>; taxSettlements?: unknown};
declare global {
    interface Window {
        __profilverbundDistribution?: ReturnType<typeof import('../app/profile/profilverbund-balance.js').calculateWithdrawalDistribution>|null;
        __profilverbundProfileSummaries?: ReturnType<typeof import('../app/profile/profilverbund-balance.js').buildProfilverbundProfileSummaries>|null;
        __profilverbundActionResults?: (ActionEntry & {spending?: Partial<R.SpendingResult>; targetLiquidity?: number})[]|null;
        __balanceMonthRecovery?: {snapshotId?: string; restore(options: {opener?: HTMLElement}): Promise<{status: string}>};
    }
    interface Document {getElementById<K extends keyof BalanceElements>(id: K): BalanceElements[K]|null;}
}
export interface BalanceElements {'balanceAnnualClose': HTMLDialogElement; 'actionDetailsDialog': HTMLDialogElement; 'balanceAllParameters': HTMLDetailsElement; 'profilverbund-withdrawal-mode': HTMLSelectElement; 'balancePlayExecute': HTMLButtonElement; 'balancePlayCredit': HTMLButtonElement;}
export interface PreviewResult {ok?: boolean; error?: unknown; inputData?: Input; overviewPersistence?: Promise<unknown>;}
export type OverviewBase = ReturnType<typeof import('../app/overview/overview-model.js').projectOverview>;
export type OverviewAvailable = Extract<OverviewBase, {scope: unknown}>;
export type OverviewModel = Pick<OverviewBase, 'available'|'year'|'now'|'lastBackup'|'priceReport'|'occasion'> & Partial<Omit<OverviewAvailable, 'householdLimit'|'expenses'>> & {householdLimit?: string; expenses?: Partial<OverviewAvailable["expenses"]>};
export type ProjectOverview = (options: Omit<Parameters<typeof import('../app/overview/overview-model.js').projectOverview>[0], 'annualTargetYear'> & {annualTargetYear?: number})=>OverviewModel;
export type ProjectOverviewWithArchive = (options: Parameters<ProjectOverview>[0], archive?: {reader?: object; onChange?: ()=>void})=>OverviewModel;
export type AnnualCoordinatorOptions = Omit<NonNullable<Parameters<typeof import('../app/shared/annual-coordinator.js').createAnnualCoordinator>[0]>, 'flushLiveState'|'prepareMarketData'|'restoreSnapshot'|'commit'> & {
    commit?: (options: import("./speicher-integration.js").AnnualCommitOptions)=>ReturnType<typeof import("../app/balance/balance-annual-storage-commit.js").commitAnnualPlanUpdate>;
    flushLiveState?: (options?: {sync?: boolean})=>Promise<boolean|void>;
    prepareMarketData?: (options: object)=>Promise<{ok: boolean; results?: unknown; marketData?: unknown}>;
    restoreSnapshot?: (id: string, options: object)=>Promise<{status: string; message?: string}>;
};
export type CreateAnnualCoordinator = (options: AnnualCoordinatorOptions)=>ReturnType<typeof import('../app/shared/annual-coordinator.js').createAnnualCoordinator>;
export type WithOptions<F extends (...args: never[])=>unknown, O> = (options: Omit<NonNullable<Parameters<F>[0]>, keyof O> & O)=>ReturnType<F>;
export interface UpdateHooks {persistence?: ReturnType<typeof import('../app/balance/balance-update-pipeline.js').persistBalanceUpdate>; overviewPersistence?: Promise<boolean>; overviewNavigationOwner?: symbol; validateWealthHistorySource?: ()=>void;}
export interface PreparedAnnual {manualPrice?: number; yearHigh?: D.YearHighChoice; adoptedPlanPatch?: Partial<D.PlanValues>; careValues?: D.HouseholdCareValues; careToday?: Record<string, number>; cash?: import('./speicher-integration.js').Cash; preparedMarketData?: object; displayPreview?: unknown;}
export interface AnnualEntryOptions {opener?: HTMLElement; annualLease?: Awaited<ReturnType<ReturnType<typeof import('../app/shared/annual-operation-lock.js').createAnnualOperationLock>['acquire']>>; targetYear?: number; confirmedPreparation?: PreparedAnnual; manualPrice?: number; onProgress?: (...args: unknown[])=>unknown; preparationFirst?: boolean;}
export type PlayController = ReturnType<typeof import('../app/shared/probelauf-state.js').getProbelaufController>;
export interface UpdateSuccessResult extends UpdateHooks {ok: boolean; status: 'success'; inputData?: Input; modelResult?: R.EngineSuccess; updateMode?: UpdateRequest['mode']; fingerprints?: Record<string, string>; [key: string]: unknown;}
export type WealthServiceBase = ReturnType<typeof import('../app/balance/balance-wealth-history.js').createBalanceWealthHistoryService>;
export type WealthService = Omit<WealthServiceBase, 'waitForOverview'|'captureManual'> & {
    waitForOverview: WithOptions<WealthServiceBase['waitForOverview'], {navigationOperation?: import('./speicher-integration.js').Operation}>;
    captureManual: WithOptions<WealthServiceBase['captureManual'], {navigationOperation?: import('./speicher-integration.js').Operation}>;
};
export interface ParityOptions {engineApi?: typeof import('../engine/index.mjs').EngineAPI; expectedSource?: Record<string, unknown>; hashValue?: (value: unknown)=>string; id?: string;}
export type ParityMeasurement = (value: unknown, options?: {phase?: string; path?: string; status?: string; reason?: string; zeroWithdrawal?: boolean})=>ReturnType<typeof import('../app/shared/parity-compare.js').parityMeasurement>;
export type CompareParityField = (options: Partial<Parameters<typeof import('../app/shared/parity-compare.js').compareParityField>[0]> & {id: string; simulator: ReturnType<ParityMeasurement>; balance: ReturnType<ParityMeasurement>})=>ReturnType<typeof import('../app/shared/parity-compare.js').compareParityField>;
export interface ParityBoundary {engineInput?: R.EngineInput; engineLastState?: R.EngineState; options?: object; decision?: R.EngineResult;}
export interface ParityReplayBase {replayable: boolean; comparisonEligible: boolean; status: string; basis: string; yearIndex: number; issues: {status: string; path: string; reason: string}[]; storage: ReturnType<typeof import('../app/balance/parity-balance-records.js').createReadonlyParityStorage>|null; calculation: ReturnType<typeof import('../app/balance/balance-input-storage.js').buildBalanceEngineInputFromStorage>|null; provenance?: unknown; resetEvidence?: unknown;}
export type ValidateParityLog = (log: unknown, options?: ParityOptions)=>ReturnType<typeof import('../app/simulator/parity-replay-contract.js').validateParityReplayLog>;
/** update wird ausschließlich als PREVIEW aufgerufen; der Writer bleibt beim Dienst. */
export type PreviewWealthHistory = (options: {service: WealthServiceBase; update: (options: object)=>PreviewResult; context: unknown; navigationOperation?: import('./speicher-integration.js').Operation})=>PreviewResult;
