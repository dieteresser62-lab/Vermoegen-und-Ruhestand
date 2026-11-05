/** Zusätzliche Analyse- und Anzeigeformen. Keine Laufzeitwerte oder Normalisierung. */
import type * as R from './rechenkern.js';
export interface TailRiskConfig {
    tailRiskEnabled: boolean; tailRiskModel: string; tailRiskAnnualProbabilityPct: number;
    tailRiskReturnShockPct: number; tailRiskInflationShockPct: number; tailRiskDurationYears: number; tailRiskCooldownYears: number;
    tailRiskValidationErrors: {fieldId: string; value: unknown; message: string}[]; tailRiskConfigValid: boolean;
}
export type ComparisonProgress = (pct: number, detail?: {completedRuns?: number; totalRuns?: number; comparison?: string; phase?: string; [key: string]: unknown}) => void;
export interface DecisionRangeResult {
    chunk: R.MonteCarloChunkResult; budgets: number[][]; diagnostics: Parameters<NonNullable<R.ComparisonPairing['onYear']>>[0][];
    tapes: R.ComparisonPairing['tapes']; continuationYears: Map<number, number>;
}
export interface WorkerRunnerOptions<T = import("./runtime-contracts.js").JsonRecord> {
    pool: import('../workers/worker-pool.js').WorkerPool; totalItems: number; workerCount: number; timeBudgetMs?: number;
    minChunk?: number; maxChunk?: number | null; onProgress?: (pct: number, counts?: {completedItems: number; totalItems: number}) => void;
    trackPartialProgress?: boolean; buildPayload: (start: number, count: number) => R.WorkerPayload;
    mergeResult: (result: T, start: number, count: number) => void;
    generationId?: R.GenerationId; signal?: AbortSignal | null; enableTelemetry?: boolean;
    enableStallDetection?: boolean; stallTimeoutMs?: number; baseTimeoutMs?: number;
}
export interface KpiDescriptor {
    title: string; value: string; description: string; tone: 'default' | 'success' | 'warning' | 'danger';
    secondaryLabel?: string; secondaryValue?: string; statusLine?: string; secondaryStatusLine?: string;
    layout?: 'exact-risk'; decisionCritical?: boolean; displayRole?: string; displayValue?: string;
    countText?: string; intervalText?: string; tooltip?: string; otherBasisLine?: string; moneyDetail?: string; priceBasis?: string;
    pairedMetrics?: {label: string; value: string; detail?: string}[]; requestedRuns?: number;
    outcomes?: {kind: string; label: string; count: number}[];
}
export interface StaticInventoryEntryInput {
    id: string; category: string; label: string; evidenceClass: string; implementationLocations: string[]; unit: string;
    embeddedValueHash: {status: string; value: unknown}; source?: {status: string; value: unknown};
    seriesIdentifier?: {status: string; value: unknown}; currency?: {status: string; value: unknown};
    yearConvention?: {status: string; value: unknown}; transformation?: {status: string; value: unknown};
    license?: {status: string; value: unknown}; retrievedAt?: {status: string; value: unknown};
    rawDataHash?: {status: string; value: unknown}; externalValidationStatus?: string; contractValue?: unknown;
}
export interface WealthFanQuantile {value: number | null; lower: number | null; upper: number | null; status: string; money?: number | null; homeSelf?: number | null;}
export interface WealthFanModel {
    available: boolean; mode: string; horizonYears?: number; validRuns?: number; technicalErrors?: number;
    years: {year: number; alive: number; ruined: number; alivePct: number; missing: number; quantiles: Record<string, WealthFanQuantile>}[];
    hasHomes?: boolean; hasHomeSelf?: boolean; hasHomeRented?: boolean;
}
declare global { interface Window { aoChampionResult?: {championCfg?: object} | null; } }
/** Native DOM-Setter konvertieren Zahlen nach String; Leser liefern Strings. */
export interface NumericInput extends Omit<HTMLInputElement, 'value' | 'min' | 'max' | 'step'> {
    get value(): string; set value(value: string | number);
    get min(): string; set min(value: string | number);
    get max(): string; set max(value: string | number);
    get step(): string; set step(value: string | number);
}
export interface AutoOptimizeBatchOptions {
    inputs: R.SimulatorInputs; widowOptions: R.WidowOptions; monteCarloParams: R.MonteCarloParameters;
    useCapeSampling: boolean; signal?: AbortSignal | null; generationId?: string; onProgress?: ComparisonProgress;
}
export interface KpiDashboard {
    primary: KpiDescriptor[]; detailSections: {title: string; kpis: KpiDescriptor[]}[];
    drawdownKpis?: KpiDescriptor[]; reportingReferenceNotice?: string;
}
export interface ScenarioChartOptions {
    startYear?: number; realByRun?: object; personDisplayContext?: ReturnType<typeof import('../app/simulator/protocol-columns.js').createProtocolPersonContext>;
    startAge?: number; startAgeP2?: number; initialWealth?: number; initialHomes?: number; initialHomeSelf?: number; wealthFan?: R.WealthFan;
    displayHomeValueFan?: R.HomeWealthFan;
}
export interface ReplayPersistenceOptions {
    backend?: {storage?: Pick<import('./datenvertraege.js').RecordStorage, 'getItem' | 'setItem' | 'removeItem'>; flush?: () => unknown | Promise<unknown>};
    currentCompatibility?: {contractVersion?: string; dataFingerprint?: R.Fingerprint; engineFingerprint?: R.Fingerprint};
    confirmReplace?: boolean; confirmDiscard?: boolean;
}
export type WealthFanPath = ReturnType<typeof import('../app/simulator/wealth-fan-aggregation.js').createWealthFanPath>;
export interface MinimumFlexTracker {completedYearCount: number; paid: number[]; desired: number[]; affectedYearCount: number;}
export interface MinimumFlexPathBase {completedYearCount: number; observationCount: number;}
export type MinimumFlexPath = MinimumFlexPathBase & (
    {missingReason: null; affectedYearCount: number; yearSharePct: number; affected: boolean; paidMedianNominalEur: number; desiredMedianNominalEur: number; paidMinimumNominalEur: number}
    | {missingReason: string; affectedYearCount: null; yearSharePct: null; affected: null; paidMedianNominalEur: null; desiredMedianNominalEur: null; paidMinimumNominalEur: null});
/** Rohdaten aus Puffern können trotz Fehlgrund noch numerische Platzhalter enthalten. */
export interface MinimumFlexPathRead extends MinimumFlexPathBase {
    missingReason: string | null; affectedYearCount: number | null; yearSharePct: number | null; affected: boolean | null;
    paidMedianNominalEur: number | null; desiredMedianNominalEur: number | null; paidMinimumNominalEur: number | null;
}
