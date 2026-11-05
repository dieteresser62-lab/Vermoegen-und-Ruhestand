/** Vorhandene Formularelemente und UI-Brücken des Simulators; keine Laufzeitwerte. */
import type * as R from './rechenkern';
/** Gemeinsame Oberfläche von input, select und textarea; checked nur bei input. */
export type SimulatorControl = (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) & { checked?: boolean };
export interface ValidationEntry { fieldId: string; message: string; }
export interface ValidationIssue { name?: string; message?: string; code?: string; errors?: ValidationEntry[]; cause?: ValidationIssue; }
export type TrancheOverride = R.EngineTranche[] & { simulationSourceProfileId?: string };
export type MinimumFlexProfile = { profileId?: string; minimumFlexAnnual: number; [key: string]: unknown };
export interface ProfileBlocker { status?: string; message?: string; }
export type SweepRow = R.SweepChunkResult['results'][number];
export interface SweepExecution {
    schemaVersion: string; personDataContext?: R.PersonDataContext | null; request: R.SweepRequest;
    metricMetadata: unknown; comparisonRandomness: unknown; results: SweepRow[];
}
export interface BacktestData {
    automatic: boolean; personDataContext: R.PersonDataContext | null;
    personDisplayContext: ReturnType<typeof import('../app/simulator/protocol-columns.js').createProtocolPersonContext>;
    result: ReturnType<typeof import('../app/simulator/historical-backtest-runner.js').runHistoricalBacktest>;
    rows: BacktestData['result']['rows']; startJahr: number; schemaVersion: string; outcome: BacktestData['result']['outcome'];
    requestedYears: number; completedYears: number; breakOnRuin: boolean; decumulationMode: string;
    goldAktiv?: boolean; minimumFlexProfiles: MinimumFlexProfile[];
}
declare global {
    interface Window {
        __profilverbundPreferAggregates?: boolean;
        __profilverbundTranchenOverride?: TrancheOverride | null;
        __profilverbundMinimumFlexProfiles?: MinimumFlexProfile[] | null;
        __profilverbundMinFlexProfilesOverride?: MinimumFlexProfile[] | null;
        __personDataBlocker?: ProfileBlocker | null;
        __profileRecoveryActionGuardsInstalled?: boolean;
        __profileRecoveryLocalActionGuardsInstalled?: boolean;
        __profileRecoveryBlockedActionCount?: number;
        __profileRecoveryAutoOptimizeObserver?: MutationObserver;
        __simulatorOpeningBacktestError?: unknown;
        __simulatorOpeningBacktestDone?: boolean;
        simulateOneYear?: typeof import('../app/simulator/simulator-engine-wrapper.js').simulateOneYear;
        simulateOneYearDirect?: typeof import('../app/simulator/simulator-engine-direct.js').simulateOneYear;
        annualData?: typeof import('../app/simulator/simulator-data.js').annualData;
        runMonteCarlo?: typeof import('../app/simulator/simulator-monte-carlo.js').runMonteCarlo;
        runBacktest?: typeof import('../app/simulator/simulator-backtest.js').runBacktestWithRuntimeProvenance;
        runParameterSweep?: typeof import('../app/simulator/simulator-sweep.js').runParameterSweep;
        displaySweepResults?: typeof import('../app/simulator/simulator-sweep.js').displaySweepResults;
        formatCurrency?: typeof import('../app/simulator/simulator-utils.js').formatCurrency;
        runSweepSelfTest?: typeof import('../app/simulator/simulator-main-sweep-selftest.js').runSweepSelfTest;
        renderBacktestLog?: typeof import('../app/simulator/simulator-backtest.js').renderBacktestLog;
        exportBacktestLogData?: typeof import('../app/simulator/simulator-backtest.js').exportBacktestLogData;
        cancelParameterSweep?: typeof import('../app/simulator/simulator-sweep.js').cancelParameterSweep;
        findAndDisplayBest?: () => void;
        showSensitivityAnalysis?: () => void;
        showParetoDialog?: () => Promise<void>;
        runMultiObjectiveDemo?: () => void;
        runConstraintBasedDemo?: () => void;
        globalBacktestData?: BacktestData | null;
        sweepResults?: SweepRow[];
        sweepParamRanges?: Record<string, number[]>;
        sweepExecution?: SweepExecution;
        paretoMetrics?: { metric1: string; metric2: string };
    }
}

export type BoundFieldValue<K extends string> = string extends K ? string | number | boolean
    : K extends 'dynamicFlex' | 'goGoActive' ? boolean
    : K extends 'horizonMethod' | 'longevityMode' | 'entnahmeStrategie' ? string
    : K extends 'startFloorBedarf' | 'startFlexBedarf' | 'minimumFlexAnnual' | 'flexBudgetAnnual' | 'flexBudgetYears' | 'flexBudgetRecharge'
        | 'liquidityRunwayYears' | 'maxSkimPctOfEq' | 'maxBearRefillPctOfEq' | 'marketCapeRatio' | 'horizonYears'
        | 'survivalQuantile' | 'goGoMultiplier' | 'longevityQuantileShift' | 'longevityRelativePct' | 'longevityBufferYears'
        | 'bondTargetFactor' | 'drawdownTrigger' | 'bondRefillThreshold' ? number | null : string;
export type BacktestOptions = Partial<Pick<Parameters<typeof import('../app/simulator/historical-backtest-runner.js').runHistoricalBacktest>[0],
    'historicalDataProvider' | 'simulateYear' | 'initializePortfolio' | 'computeAdjustmentPct' | 'resolveHorizon' | 'totalPortfolio' | 'breakOnRuin'>> & {
    focus?: boolean; automatic?: boolean; opening?: boolean; beforeRun?: () => unknown | Promise<unknown>; isBlocked?: () => boolean;
    validateInputs?: typeof import('../app/simulator/simulator-input-validation.js').validateSimulatorInputs;
    getInputs?: typeof import('../app/simulator/simulator-portfolio-inputs.js').getCommonInputs;
    beginSimulationSummary?: typeof import('../app/simulator/simulator-overview-summary.js').beginSimulationSummary;
    completeSimulationSummary?: typeof import('../app/simulator/simulator-overview-summary.js').completeSimulationSummary;
    engineApi?: typeof import('../engine/index.mjs').EngineAPI;
    runSinglePath?: typeof import('../app/simulator/historical-backtest-runner.js').runHistoricalBacktest;
    runtimeBuildProvenance?: unknown;
    loadRuntimeBuildProvenance?: typeof import('../app/shared/runtime-build-provenance.js').loadRuntimeBuildProvenance;
};
export interface BacktestColumn {
    cellClass?: (value: any, row?: import("./runtime-contracts").JsonRecord) => string;
    header: string; exportHeader?: string; width?: number; key?: string; align?: string;
    // Protokollspalten wählen frei verschachtelte, versionsabhängige JSON-Felder.
    extractor?: (row: import('./runtime-contracts').JsonRecord) => any;
    valueFormatter?: (value: any, row?: import('./runtime-contracts').JsonRecord) => any;
    fmt?: (value: any, row?: import('./runtime-contracts').JsonRecord) => any;
}
export type CareAllowanceAnnual = (options?: {grade?: number; preset?: string; careForm?: string; inflationFactor?: number; lifeFactor?: number;
    careValues?: Parameters<typeof import('../app/shared/care-benefits.js').careAllowanceAnnual>[0]['careValues']}) => number;
export type PageChoice = (options?: Partial<Parameters<typeof import('../app/shared/page-choice-dialog.js').requestPageChoice>[0]> & {title?: string})
    => ReturnType<typeof import('../app/shared/page-choice-dialog.js').requestPageChoice>;
export type BindInfoPopovers = (doc?: Pick<Document, 'querySelectorAll' | 'addEventListener' | 'activeElement'>,
    options?: {root?: ParentNode; listen?: (node: Element, type: string, callback: EventListener) => void}) => void;
export type SharedPlanOptions = {
    readPlan?: typeof import('../app/profile/household-plan.js').readSimulatorHouseholdPlan;
    writePlan?: typeof import('../app/profile/household-plan.js').patchHouseholdPlan;
    profile?: () => string | null; changed?: () => void; readLocal?: () => Record<string, unknown>;
    projectLocal?: (values: Record<string, unknown>) => void; validateBeforeUpdate?: boolean;
};
export type CreateSharedPlanTrial = (options?: SharedPlanOptions) => ReturnType<typeof import('../app/shared/plan-trial.js').createPlanTrial>;
export type SourceFingerprint = (options: Omit<Parameters<typeof import('../app/overview/overview-simulation-summary.js').sourceFingerprint>[0], 'referenceYear'>
    & {referenceYear?: number}) => string | null;
/** Jobs liefern je nach Payload MC-Chunks oder Sweep-Ergebnisse. */
export type WorkerJobConstructor = new (options: Omit<import('./simulator-analysis.js').WorkerRunnerOptions, 'mergeResult'> & {
    // Jobtyp und Validator bestimmen die offene Nachricht erst an der jeweiligen Merge-Grenze.
    mergeResult: (result: any, start: number, count: number) => void;
})
    => import('../app/simulator/worker-job-runner.js').WorkerJobRunner<import('./runtime-contracts.js').JsonRecord>;
export type SummaryCard = import('../app/simulator/results-metrics.js').KpiDescriptor & {
    displayValue?: string; moneyDetail?: string; otherBasisLine?: string; countText?: string;
};
export type BuildSummaryData = (options: Parameters<typeof import('../app/simulator/results-metrics.js').buildSummaryData>[0] & {moneyBasis?: string}) => SummaryCard[];
export type PrepareMonteCarloViewModel = (options: Parameters<typeof import('../app/simulator/results-metrics.js').prepareMonteCarloViewModel>[0] & {moneyBasis?: string})
    => ReturnType<typeof import('../app/simulator/results-metrics.js').prepareMonteCarloViewModel>;
export type TestamentOptions = Partial<Parameters<typeof import('../app/profile/household-partnership.js').testamentEstate>[5]> & {
    partnerAge?: number; partnerGender?: string; residenceValue?: number; maritalPropertyRegime?: string;
    gains?: {deceasedAssets: number; survivorAssets: number; deceasedInitialAssets: number; survivorInitialAssets: number; inflationFactor: number};
};
export type ResidenceTax = {annualValue: number; rate: number; annualTax: number; allowanceRemaining: number; immediateComparison: number};
export type TestamentEstate = (...args: [...args: Parameters<typeof import('../app/profile/household-partnership.js').testamentEstate> extends [...infer P, unknown?] ? P : never, options?: TestamentOptions])
    => ReturnType<typeof import('../app/profile/household-partnership.js').testamentEstate> & {residenceTax?: ResidenceTax};
export type InheritanceNetProceeds = (options: Partial<Parameters<typeof import('../app/profile/household-inheritance-sale.js').inheritanceNetProceeds>[0]>) => (amount: number) => number;
export type BindScenarioLogView = (options: Omit<Parameters<typeof import('../app/simulator/scenario-log-view.js').bindScenarioLogView>[0], 'comparisonContext'> & {comparisonContext?: object}) => void;
export interface CurrentScenarioData {personDataContext: R.PersonDataContext | null; rows: R.ScenarioSourceRow[]; caR_Threshold: number;}
declare global {
    interface Window {
        globalScenarioLogs?: object | null;
        globalScenarioCarThreshold?: number | null;
        globalCurrentScenarioData?: CurrentScenarioData | null;
    }
}

/** Rohwerte vor der Validierung; readonly Tranchen werden ausschließlich gelesen. */
export interface ValidationInputs {
    [key: string]: unknown; partner?: R.SimulatorInputs['partner']; minimumFlexAnnual?: unknown; startFlexBedarf?: unknown;
    survivorFloorPercent?: unknown; survivorFlexPercent?: unknown; survivorMinimumFlexPercent?: unknown;
    liquidityRunwayYears?: unknown; runwayTargetMonths?: unknown; runwayMinMonths?: unknown;
    tailRiskHorizonYears?: unknown; tailRiskValidationErrors?: {fieldId: string; message?: string}[];
}
export interface PensionFields {
    startAlter: number; geschlecht: string; startSPB: number; kirchensteuerSatz: number; renteMonatlich: number;
    renteStartOffsetJahre: number; renteStartMonate?: number; renteKalenderbeginn?: string;
    rentAdjMode: string; rentAdjPct: number; renteIndexierungsart: string; renteFesterSatz: number;
    personDataStatus?: {ready: boolean; status?: string; message?: string};
}
