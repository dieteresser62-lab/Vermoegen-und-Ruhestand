/// <reference lib="es2023.array" />
// findLast wird im bestehenden Laufzeitcode genutzt; die Projektbasis ist noch ES2022.
/** Tageskurse und lesende Verlaufsprojektionen; Tage sind UTC-Tagesnummern, Beträge Euro. */
import type * as D from './datenvertraege.js';
import type * as R from './rechenkern.js';
import type * as I from './speicher-integration.js';
export interface HistoryStart {version: number; startDate: string; confirmed?: boolean;}
export type Interval = number[];
export interface PriceRecord {currency: string|null; days: number[]; closes: number[]; queried: Interval[]; failures: number; lastError: string|null;}
export interface DailyPrices {version: number; symbols: Record<string, PriceRecord>;}
export type PriceResult = {currency: string; days: number[]; closes: number[]; interval: Interval; error?: never}
    | {error: string; currency?: never; days?: never; closes?: never; interval?: never};
export interface CommitOptions {storage?: D.RecordStorage; flush?: ()=>Promise<boolean|void>; operation?: I.Operation; valid?: ()=>boolean;}
export interface InitOptions extends CommitOptions {today?: string;}
export interface FetchOptions {fetchImpl?: typeof fetch; proxyBase?: string; signal?: AbortSignal; deadline?: number; now?: ()=>number; valid?: ()=>boolean; schedule?: typeof setTimeout; unschedule?: typeof clearTimeout;}
export interface RunOptions extends FetchOptions, InitOptions {firstPlanningYear?: number; withOperation?: <T>(execute: (operation: I.Operation|null)=>Promise<T>)=>Promise<T>;}
export interface FetchReport {status: string; completed?: number; issues?: {profileId: string; trancheId: string; reason: string}[]; hints?: string[]; reason?: string;}
export interface BindFetchOptions {doc?: Document; win?: Window & typeof globalThis; afterStartup?: Promise<unknown>; firstPlanningYear?: number|(()=>number);
    guard?: ReturnType<typeof import('../app/shared/navigation-guard-dialog.js').getPageNavigationGuard>; coordinator?: (options: RunOptions)=>Promise<FetchReport>;
    session?: D.RecordWriter; storage?: D.RecordStorage; onReport?: (report: FetchReport)=>void;}
export interface HistoryEvent {eventType: string; profileId: string; trancheId?: string; actionId: string; executedAt: string;
    actual?: {sharesSold?: number; grossProceeds?: number}; result?: {beforeShares?: number; remainingShares?: number}; source?: string;}
/** Das Modell liest sowohl kanonische Lots als auch umhüllte, gespeicherte Verlaufslots. */
export type HistoryLot = Partial<Omit<R.CanonicalTranche, "type">> & {type?: string; tranche?: R.CanonicalTranche & {source?: string}; source?: string; remainingShares?: number; status?: string;
    uncertainty?: {fromDate: string; originalTranche: R.CanonicalTranche}; manualCorrectionAt?: string;};
export interface HistoryProfile {id: string; belongsToHousehold?: boolean; error?: string; lots?: HistoryLot[]; currentCash?: number; cashHistory?: Pick<D.CashHistory, 'baselineValue'|'entries'>;}
export interface ModelOptions {profiles: HistoryProfile[]; prices?: Pick<DailyPrices, 'symbols'>; events?: HistoryEvent[]; startDate: string; today: string;
    period?: string; profileId?: string|null; assetType?: string|null; includeAssetDetails?: boolean;}
export interface Point {day: number; date?: string; total: number|null; known?: number|null; allocation?: Record<string, number|null>;
    byProfile?: Record<string, {allocation: Record<string, number|null>; total: number|null; known: number|null}>;
    quality?: string[]; gap?: boolean; assumedCash?: boolean; assetDetails?: Record<string, {quality: string[]; gap: boolean}>;
    totalWithHomes?: number|null; moneyTotal?: number|null; property?: {self?: number; rented?: number; total: number}; evaluated?: boolean;}
export interface ChartOptions {title?: string; description?: string; width?: number; height?: number;}
export type ShareChain = ReturnType<typeof import('../app/tranches/tranchen-history-model.js').reconstructHistoryShares>;
export type History = ReturnType<typeof import('../app/tranches/tranchen-history-model.js').evaluateWealthHistory>;
export type Course = ReturnType<typeof import('../app/tranches/tranchen-history-model.js').evaluateHistoryCourse>;
export type Context = ReturnType<typeof import('../app/tranches/tranchen-history-ui.js').readManagerHistoryContext>;
export type TrancheHistory = ReturnType<typeof import('../app/tranches/tranchen-history-ui.js').projectTrancheHistory>;
export interface RecoveryRequest {profileId: string; trancheId: string; kind: string;}
export type PreparedRecovery = ReturnType<typeof import('../app/tranches/tranchen-history-recovery.js').prepareHistoryRecovery>;
export type RecoveryCandidate = ReturnType<typeof import('../app/tranches/tranchen-history-recovery.js').projectHistoryRecovery>[number];
export interface ReturnPoint {day: number; date: string; total: number; baseline: boolean; deposit: number; withdrawal: number; rate: number|null;}
export type Returns = ReturnType<typeof import('../app/tranches/tranchen-history-returns.js').evaluateHistoryReturns>;
export type ReturnMetrics = ReturnType<typeof import('../app/tranches/tranchen-history-returns.js').historyReturnMetrics>;
export type MonthlyRows = ReturnType<typeof import('../app/tranches/tranchen-history-returns.js').historyMonthlyReturns>;
