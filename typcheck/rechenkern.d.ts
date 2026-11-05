/** Jahresrechnung und Monte-Carlo-Grenzen. Nur Typen; keine Laufzeitnormalisierung.
 * Euro/Prozent/Anteil bleiben Zahlen wie in den gespeicherten Verträgen.
 * Endlichkeit und erlaubte Werte besitzen weiterhin die Laufzeitvalidatoren.
 */
import type { Euro, SignedEuro, Cent, PlanValues, Tranche } from './datenvertraege';
export type { Euro, SignedEuro, Cent } from './datenvertraege';
/** Kalenderjahr, davon getrennter nullbasierter Pfadindex. */
export type CalendarYear = number;
export type YearIndex = number;
export type Percent = number;
export type Ratio = number;
export type StrategyOptions = PlanValues['decumulation'];
export interface Needs { floor: Euro; flex: Euro; }
export type MarketKey = 'peak_hot'|'peak_stable'|'recovery'|'bear_deep'|'corr_young'|'side_long'|'recovery_in_bear';
export type RunwayProfile = { isDynamic: boolean; minRunwayMonths: number; runway: Record<string, {total: number}> };
export type Decision = {key?:string;message?:string;step: string; impact: string; status: string; severity: string};
export type AddDecision = (step: string, impact: string, status: string, severity?: string) => void;
export type Trace = ReturnType<typeof import('../engine/planners/flex-trace.mjs').createFlexTraceCollector>;
export type Market = ReturnType<typeof import('../engine/analyzers/MarketAnalyzer.mjs').MarketAnalyzer.analyzeMarket>;
export interface TaxState { lossCarry?: Euro; }
export interface RawTaxAggregate { [key:string]:number|undefined;sumRealizedGainSigned?: SignedEuro; sumTaxableAfterTqfSigned?: SignedEuro;}
export interface TaxYearParameters {taxStatePrev?: TaxState|null; rawAggregate?: RawTaxAggregate|null; sparerPauschbetrag?: Euro; kirchensteuerSatz?: Ratio;}
export interface EngineTranche extends Partial<Omit<Tranche,'name'|'isin'|'type'>> { name?:string|null;isin?:string|null;type?:string;marketValue: Euro; costBasis: Euro; sourceProfileId?: string; instrumentId?: string; kind?: string; }
export interface EngineInput {
 floorBedarf: Euro; flexBedarf: Euro;
 depotwertAlt?: Euro; depotwertNeu?: Euro; tagesgeld?: Euro; geldmarktEtf?: Euro; goldWert?: Euro; anleihenWert?: Euro;
 costBasisAlt?: Euro; costBasisNeu?: Euro; goldCost?: Euro; sparerPauschbetrag?: Euro; kirchensteuerSatz?: Ratio;
 aktuelleLiquiditaet?: Euro; aktuellesAlter?: number; startAlter?: number; inflation?: Percent; liquidityRunwayYears?: number;
 runwayMinMonths?: number; runwayTargetMonths?: number; targetEq?: Percent; rebalBand?: Percent; rebalancingBand?: Percent;
 budgetInflationBoost?:Percent; maxSkimPctOfEq?: Percent; maxBearRefillPctOfEq?: Percent; capeRatio?: number; marketCapeRatio?: number;
 dynamicFlex?: boolean; horizonMethod?: PlanValues['horizonMethod']; survivalQuantile?: Ratio; horizonYears?: number;
 longevityMode?: PlanValues['longevityMode']; longevityQuantileShift?: Ratio; longevityRelativePct?: Ratio; longevityBufferYears?: number;
 goGoActive?: boolean; goGoMultiplier?: number; goGoAge?: number; partnerAlter?: number;
 minimumFlexAnnual?: Euro; flexBudgetAnnual?: Euro; flexBudgetYears?: number; flexBudgetRecharge?: Euro;
 plannedExpenseLiquidityReserve?: Euro; lockedHealthBucketAmount?: Euro;
 decumulation?: Partial<StrategyOptions>; lastState?: EngineState|null;
 tqfAlt?:Ratio;tqfNeu?:Ratio;taxExemptAlt?:boolean;taxExemptNeu?:boolean;longevityHorizonDiagnostics?:LongevityDiagnostics|null; renteAktiv?: boolean; renteMonatlich?: Euro; goldAktiv?: boolean; goldZielProzent?: Percent; goldFloorProzent?: Percent;
 goldSteuerfrei?: boolean; minCashBufferMonths?: number; risikoprofil?: string;
 endeVJ?: number; endeVJ_1?: number; endeVJ_2?: number; endeVJ_3?: number; ath?: number; jahreSeitAth: number;
 detailledTranches?: readonly EngineTranche[]|null; returnPolicy?: string;
 finalizeThreeBucketAction?: boolean; deferTaxSettlement?: boolean;
}
export interface EngineState {
 [key:string]:unknown;
 initialized?: boolean; flexRate?: Percent; flexRateSmoothingReference?: Percent; lastMarketSKey?: string;
 lastTotalBudget?: Euro; peakRealVermoegen?: Euro; peakLockedHealthBucketReal?: Euro;
 cumulativeInflationFactor?: number; alarmActive?: boolean; lastInflationAppliedAtAge?: number; lastEntnahmeReal?: Euro;
 flexBudgetBalanceYears?: number; flexBudgetBalance?: number; taxState?: TaxState;
}
export interface SpendingParameters {
 input: NormalizedEngineInput; lastState?: EngineState|null; market: Market; inflatedBedarf: Needs; staticFlexBaseline?: Euro;
 runwayMonate: number; profil: RunwayProfile; gesamtwert: Euro; depotwertGesamt: Euro; renteJahr: Euro;
}
export interface AlarmStatus {active: boolean|undefined; newlyTriggered: boolean;}
export interface WithdrawalCandidate {source: string; status: 'valid'|'invalid'; value: unknown;}
export type ValidWithdrawalCandidate = WithdrawalCandidate & {status:'valid'; value:Euro};
export type WithdrawalResolution = {status:'resolved'; annualWithdrawal:Euro; source:string; candidates:ValidWithdrawalCandidate[]}
 | {status:'invalid'|'missing'|'conflict'; annualWithdrawal:null; source:null; candidates:WithdrawalCandidate[]};
export interface WithdrawalInput {spendingResult?: {details?: {endgueltigeEntnahme?: unknown}; monatlicheEntnahme?: unknown}; annualPlan?: unknown;}
export interface InflationOptions {allowMissing?:boolean; defaultValue?:number; path?:string;}
export type RunwayInput = {liquidityRunwayYears?:unknown;runwayTargetMonths?:unknown;runwayMinMonths?:unknown;targetEq?:unknown};
export interface NormalizedEngineInput extends EngineInput {
 depotwertAlt: Euro; depotwertNeu: Euro; tagesgeld: Euro; geldmarktEtf: Euro; goldWert: Euro;
 costBasisAlt: Euro; costBasisNeu: Euro; goldCost: Euro; sparerPauschbetrag: Euro; kirchensteuerSatz: Ratio;
 aktuellesAlter: number; startAlter: number; inflation: Percent; liquidityRunwayYears: number; rebalancingBand: Percent;
 maxSkimPctOfEq: Percent; maxBearRefillPctOfEq: Percent; dynamicFlex:boolean; horizonMethod: PlanValues['horizonMethod'];
 survivalQuantile:Ratio; goGoActive:boolean; goGoMultiplier:number; minimumFlexAnnual:Euro; decumulation:StrategyOptions;
}
export interface PlannerState extends EngineState {
 flexRate:number; keyParams:KeyParams;
}
export interface KeyParams {
 [key:string]:unknown;
 peakRealVermoegen:number; currentRealVermoegen:number; cumulativeInflationFactor:number; entnahmequoteDepot:number; realerDepotDrawdown:number;
 previousActualFlexRate?:number; previousFlexRateSmoothingReference?:number; wealthReductionFactor?:number; entnahmequoteUsed?:number;
 withdrawalBurdenFactor?:number|null; baseAlarmCutPct?:number; effectiveAlarmCutPct?:number; nextFlexRateSmoothingReferencePct?:number;
 aktuelleFlexRate?:number;flexRate?:number;endgueltigeEntnahme?:number;minFlexRatePct?:number; minimumFlexAnnual?:number; minimumFlexPensionContributionAnnual?:number; minimumFlexHouseholdFlexAnnual?:number;
 minimumFlexEffectiveFinal?:number; minimumFlexEffectiveAfter?:number; minimumFlexRequiredRate?:number; minimumFlexDepotAnnual?:number;
}
export interface GuardrailMetric {rule:string; type:string; threshold:number; value:number; details?:{budgetFloorBlocked:boolean};}
export interface GuardrailDiagnostics {cautionBudgetFloor?:GuardrailMetric; budgetFloor?:GuardrailMetric; rateCap?:{rateCapApplied:boolean;inputFlexRatePct:number|null;outputFlexRatePct:number|null;tolerancePct:number};}
export type InitialPolicy = ReturnType<typeof import('../engine/planners/flex-rate-policy.mjs').calculateFlexRate>;
export type PolicyResult = ReturnType<typeof import('../engine/planners/spending-policy-pipeline.mjs').applySpendingPolicyPipeline>;
export type MinimumFlexContext = Partial<SpendingParameters> & {state?:PlannerState;alarmStatus?:Partial<AlarmStatus>;kuerzungQuelle?:string};
export interface SignalDefinition {source:string;severity0Value:number;severity1Value:number;scale:string;hardBoundary:boolean;}
export type SignalContract = Record<string,SignalDefinition>;
export interface SafetyCandidate {source:string;candidateFlexRatePct:number;anchorStage:string;evidence:object;}
export interface VpwReturnContext extends Partial<typeofConfigCape> {capeRatio?:number;marketCapeRatio?:number;equityWeightPct?:Percent;goldWeightPct?:Percent;goldAktiv?:boolean;safeRealReturn?:Ratio;goldRealReturn?:Ratio;returnPolicy?:string;}
type typeofConfigCape = typeof import('../engine/config.mjs').CONFIG.CAPE_CONTINUOUS;
/** Diese nativen Prädikate akzeptieren keine Zahlenstrings. Nach true liegt
 * tatsächlich number vor; NaN/Infinity bleiben ohne erfolgreiche Prüfung möglich.
 * Anders als Number(...) wird hier nichts konvertiert.
 */
declare global {
 interface NumberConstructor {
  isFinite(value:unknown): value is number;
  isInteger(value:unknown): value is number;
  isSafeInteger(value:unknown): value is number;
 }
}
export interface ActionSource {
 [field:string]:unknown; kind:string; brutto:Euro; netto:Euro; steuer:Euro; tqf?:Ratio; taxExempt?:boolean;
 category?:string|null; trancheId?:string|null; sourceProfileId?:string|null; name?:string|null; isin?:string|null; purchaseDate?:string|null;
 spbUsed?:Euro; realizedGainSigned?:SignedEuro; taxableAfterTqfSigned?:SignedEuro; gainQuotePlan?:Ratio;gainQuoteSigned?:Ratio;
}
export type ActionUses = Record<string,Euro>;
export interface Action {
 [field:string]:unknown; type:string;title:string;quellen?:ActionSource[];verwendungen?:Record<string,Euro>;steuer?:Euro;
 nettoErlös?:Euro;bruttoVerkaufGesamt?:Euro;taxRawAggregate?:RawTaxAggregate;taxSettlement?:Partial<ReturnType<typeof import('../engine/tax-settlement.mjs').settleTaxYear>['details']> & {deferred?:boolean;reason?:string;taxPlanDue?:number;taxCashAdjustment?:number;saleTaxDue?:number;executedTaxContract?:{saleTaxDue:number};[key:string]:unknown};
 details?:Record<string,unknown>;anweisungKlasse?:string;diagnosisEntries?:(Decision|DiagnosticNotice)[];bondPayoutProtection?:boolean;transactionDiagnostics?:TransactionDiagnostics;
}
export interface SaleContext {forceGrossSellAmount?:Euro;minGold?:Euro;saleBudgets?:Record<string,Euro>;maxEquityBudgetTotal?:Euro;ignoreGoldFloor?:boolean;}
export interface SaleLot extends EngineTranche {kind:string;}
export interface SaleResult {steuerGesamt:Euro;bruttoVerkaufGesamt:Euro;achievedRefill:Euro;breakdown:ActionSource[];pauschbetragVerbraucht:Euro;sumRealizedGainSigned:Euro;sumTaxableAfterTqfSigned:Euro;taxRawAggregate:RawTaxAggregate;}
export interface ActionDetails {bedarf:Euro;title:string;diagnosisEntries:(Decision|DiagnosticNotice)[];isCapped:boolean;type?:string;bondPayoutProtection?:boolean;}
export interface TransactionDiagnostics {
 wasTriggered:boolean;blockReason:string;blockedAmount:Euro;
 equityThresholds:{[key:string]:unknown;allocationPolicy:string;maxSkimPctOfEq:number};
 goldThresholds:{[key:string]:unknown;currentGoldValue:Euro;minGoldReserve:Euro;targetGoldValue:Euro;targetPct:Percent;maxBearRefillPctOfEq:Percent};
 potentialTrade:Record<string,number|string|boolean|null>;plannedAnnualWithdrawal?:{amount:Euro;source:string};[field:string]:unknown;
}
export interface TransactionParameters {
 aktuelleLiquiditaet:Euro;depotwertGesamt:Euro;zielLiquiditaet:Euro;market:Market;spending?:{monatlicheEntnahme:number;details:KeyParams};
 minGold:Euro;profil:RunwayProfile;input:NormalizedEngineInput;isSavingsYear?:boolean;
}
export type TransactionHelpers = Pick<typeof import('../engine/transactions/TransactionEngine.mjs').TransactionEngine,'calculateSaleAndTax'> & {
 computeAppliedMinTradeGate:typeof import('../engine/transactions/transaction-utils.mjs').computeAppliedMinTradeGate;
 computeCappedRefill:typeof import('../engine/transactions/transaction-utils.mjs').computeCappedRefill;
 quantizeAmount:typeof import('../engine/transactions/transaction-utils.mjs').quantizeAmount;
};
export interface ActionEntry {name?:string;action:Action;input:EngineInput & {taxStatePrev?:TaxState};}
export interface TrancheFieldError {code:string;field:string;index:number;trancheId:string|null;message:string;value?:unknown;}
export interface TrancheContext {index:number;trancheId:string|null;}
export interface TrancheOptions {mode?:'engine'|'persisted';index?:number;allowLegacy?:boolean;}
export interface CanonicalTranche extends Omit<Tranche,'purchaseDate'> {purchaseDate:string;marketValue:Euro;costBasis:Euro;instrumentId:string;sourceProfileId?:string;id?:string;kind?:string;}
export interface PlannedActionOptions { action?:Action|null;allowedUseKeys?:string[];detailedTranches?:readonly EngineTranche[]|null;legacyTaxMetadata?:Record<string,unknown>;legacyCapacities?:Record<string,number>;[key:string]:unknown;}
export interface SafetySignals {alarmActive?:boolean;entnahmequoteDepot?:number;realerDepotDrawdown?:number;runwayMonate?:number;minRunwayMonths?:number;kuerzungProzent?:number;safetyStage?:number;threeBucketActive?:boolean;}
export interface LongevityDiagnostics {longevityMode?:string;horizonYearsRaw?:number;longevityApplied?:boolean;longevityAppliedShift?:number;longevityAppliedBufferYears?:number;longevityRelativePct?:number;longevityClampReason?:string|null;survivalQuantileRaw?:number|null;survivalQuantileAdjusted?:number|null;longevityTransitionSmoothingApplied?:boolean;longevityTransitionSmoothingFloor?:number;}
export interface SpendingResult {monatlicheEntnahme:Euro;kuerzungProzent:Percent;kuerzungQuelle:string;anmerkung:string;details:KeyParams;flexTrace?:ReturnType<Trace['snapshot']>;}
export interface Diagnosis {decisionTree:(Decision|DiagnosticNotice)[];guardrails:({name:string}&GuardrailMetric)[];keyParams:KeyParams;general:Record<string,unknown>;transactionDiagnostics?:TransactionDiagnostics;}
export interface VpwDiagnostics { [key:string]:unknown; enabled:boolean;dynamicFlex?:Euro;dynamicFlexBeforeWishCap?:Euro;rawDynamicFlex?:Euro;reentryApplied?:boolean;reentryBlendWeight?:number;reentryRemainingBefore?:number;horizonYears?:number|null; }
export interface EngineUi {depotwertGesamt:Euro;neuerBedarf:Euro;minGold:Euro;zielLiquiditaet:Euro;market:Market;spending:SpendingResult;action:Action;threeBucket:ThreeBucketState|null;liquiditaet:{deckungVorher:number;deckungNachher:number};runway:{months:number;status:string};vpw:VpwDiagnostics;}
export interface EngineSuccess {input:NormalizedEngineInput;newState:EngineState;diagnosis:Diagnosis;ui:EngineUi;error?:never;}
export interface EngineFailure {error:Error;input?:never;newState?:never;diagnosis?:never;ui?:never;}
export type EngineResult = EngineSuccess|EngineFailure;
export type SamplingMethod = 'block'|'stationary'|'regime_markov'|'regime_iid';
export type RngMode = 'per-run-seed'|'legacy-stream';
export type StartYearMode = 'UNIFORM'|'FILTER'|'RECENCY';
export interface MonteCarloParameters {anzahl:number;maxDauer:number;blockSize:number;seed:number;methode:SamplingMethod;rngMode:RngMode;startYearMode:StartYearMode;startYearFilter:CalendarYear;startYearHalfLife:number;excludeEstimatedHistory:boolean;}
export type MonteCarloParametersInput = {[K in keyof MonteCarloParameters]?:unknown};
export interface MonteCarloAgeInput {startAlter?:unknown;partner?:{aktiv?:boolean;startAlter?:unknown};}
export interface MonteCarloParameterContext {inputs?:MonteCarloAgeInput|null;historicalRecordCount?:number|null;}
export interface SweepRequestInput extends MonteCarloParametersInput {schemaVersion?:string;monteCarloParameters?:MonteCarloParametersInput;anzahlRuns?:unknown;baseSeed?:unknown;requestedSamplingMethod?:SamplingMethod;appliedSamplingMethod?:SamplingMethod;samplingMethodResolution?:string;useCapeSampling?:unknown;}
export type McBuffers = ReturnType<typeof import('../app/simulator/monte-carlo-runner-utils.js').createMonteCarloBuffers>;
export type NumericArray = Float64Array|Float32Array|Uint32Array|Uint8Array|Uint16Array|number[];
export interface WorstRun {finalVermoegen:Euro;comboIdx?:number;runIdx?:number;log?:unknown[];[field:string]:unknown;}
export interface HintMeasurement {successRatio?:number|null;completed:boolean;comparableKey:string|null;elapsedMs:number;runs:number;years:number;}
export type HintModel = {visible:false;valid:boolean;runs?:never;durationMs?:never;estimates?:never;severe?:never;ratioKnown?:never}
 | {visible:true;valid:true;runs:number;years:number;durationMs:number|null;estimates:ReturnType<typeof import('../app/simulator/monte-carlo-statistics.js').buildBinaryProportionEstimate>[];severe:boolean;ratioKnown:boolean};
export interface MinimumFlexResult {rate:number;applied:boolean;status:string;minimumFlexAnnual:number;minimumFlexDepotAnnual:number;pensionFlexContributionAnnual:number;householdFlexAnnual:number;flexAnnual:number;requiredRate:number;requiredRateUnbounded:number;targetUnattainableAtFullFlex:boolean;effectiveFlexBefore:number;effectiveFlexAfter:number;blockReason:string|null;emergency?:{blocked:boolean;reason:string|null;floorPlusMinimumFlex:number;minRunwayMonths:number;requiredWealthForRunway:number;totalWealth:number};}
export type PlannedActionFailure = {status:'invalid';reason:string;context:Record<string,unknown>};
export interface PlannedActionSuccess {status:'resolved';action:Action;sources:ActionSource[];uses:Record<string,number>;assetSources:ActionSource[];cashSources:ActionSource[];assetSourceNet:number;cashSourceGross:number;sourceFundingTotal:number;sourcePlanTax:number;sourceRealizedGainSigned?:number;sourceTaxableAfterTqfSigned?:number;useTotal:number;plannedLiquidityInflow:number;hasAssetSale:boolean;}
export type PlannedActionResolution = PlannedActionFailure|PlannedActionSuccess;
export type GenerationId = number|string|null;
export interface WorkerEnvelope<T=unknown> {runRange?:{start:number;count:number};comboRange?:{start:number;count:number};pct?:number;completedUnits?:number;type:string;jobId?:number;generationId?:GenerationId;result?:T;message?:string;stack?:string;[key:string]:unknown;}
export interface WorkerPayload {type:string;generationId?:GenerationId;runRange?:{start:number;count:number};comboRange?:{start:number;count:number};monteCarloParams?:MonteCarloParameters;[key:string]:unknown;}
export interface WorkerJob<T=unknown> {jobId:number;payload:WorkerPayload;transferables:Transferable[];generationId:GenerationId;resolve:(message:WorkerEnvelope<T>)=>void;reject:(error:Error)=>void;worker?:Worker|null;startedAt?:number;queuedAt?:number;}
export interface WorkerPoolOptions {workerUrl?:string|URL;size?:number;type?:WorkerType;onProgress?:((message:WorkerEnvelope)=>void)|null;onError?:((error:Error)=>void)|null;telemetryName?:string;}
export interface WorkerJobOptions {generationId?:GenerationId;}
export interface WorkerTiming {jobsCompleted:number;jobsFailed:number;totalTime:number;idleTime:number;lastJobEnd:number|null;}
export interface TelemetryStart {start:number;workerId:string;payload:WorkerPayload;}
export interface MemorySnapshot {timestamp:number;usedMB:number;totalMB:number;limitMB:number;}
export interface TelemetryError {timestamp:number;workerId:string;message:string;stack:string;}
export interface JobDetail {elapsedMs:number;runCount:number;msPerRun:number;}
export interface WorkerFailure extends Error {filename?:string;lineno?:number;colno?:number;}
declare global {
 var __workerTelemetryRegistry: Map<string, import('../workers/worker-telemetry.js').WorkerTelemetry>|undefined;
 interface Window {__workerTelemetryRegistry?:Map<string, import('../workers/worker-telemetry.js').WorkerTelemetry>;}
 interface Performance {memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number};}
}
export type TypedNumbers = Float64Array<ArrayBuffer>|Float32Array<ArrayBuffer>|Uint32Array<ArrayBuffer>|Uint8Array<ArrayBuffer>|Uint16Array<ArrayBuffer>;
export type NumericBuffers = Record<string,TypedNumbers>;
export interface EuroTracker { [key:string]:unknown;stressYears:number;valid:boolean;taxPaidRealEur:number;taxSavedRealEur:number;healthBucketUsedRealEur:number;healthBucketEndRealEur:number;healthBucketTargetGapRealEur:number;withdrawals:number[];stressWithdrawals:number[];paid:number[];desired:number[];}
export interface SimulationLog { [key:string]:unknown; FlexRatePct?:number;immobilien_wert_end?:number;immobilien_selbst_end?:number;pflege_flex_faktor?:number;immobilienverkauf_personen?:Record<string,unknown>[];Regime?:string;inflation_factor_cum?:number;entnahme_effektiv?:number;taxSavedByLossCarry?:number;health_bucket_used?:number;health_bucket_end?:number;health_bucket_target_gap?:number;entnahmequote?:number;flex_wunsch_haushalt_nominal?:number;entscheidung?:Partial<SpendingResult> & {jahresEntnahme?:number};jahresentnahme_real?:number; }
export interface StressTracker {stressYears:number;portfolioValues:number[]|null;yearsAbove45:number;cutYears:number;realWithdrawals:number[]|null;postStressRecoveryYears:number|null;}
export interface SimulationPortfolio { [key:string]:unknown;depotTranchesAktien:EngineTranche[];depotTranchesGold:EngineTranche[];depotTranchesGeldmarkt:EngineTranche[];liquiditaet:Euro;tagesgeld?:Euro;geldmarktEtf?:Euro;simulationSourceProfileId?:string;simulationDate?:string;personAccounts?:PersonalAccount[];healthBucketCashOwners?:Record<string,unknown>[];healthBucketConfig?:import('./datenvertraege').HealthBucket;homeRent?:{startYear:number;active:boolean};healthBucketGeldmarkt?:Euro; }
export interface SimulationState { [key:string]:unknown;portfolio:SimulationPortfolio;cumulativeInflationFactor:number;baseFloor:Euro;baseFlex:Euro;baseMinimumFlexAnnual:Euro;baseFlexBudgetAnnual:Euro;baseFlexBudgetRecharge:Euro;lastState:EngineState;currentAnnualPension:Euro;currentAnnualPension2:Euro;marketDataHist:MarketData;samplerState:SamplerState;widowPensionP1:Euro;widowPensionP2:Euro;transitionYear:number;}
export interface MarketData { [key:string]:number|undefined;endeVJ:number;endeVJ_1:number;endeVJ_2:number;endeVJ_3:number;ath:number;jahreSeitAth:number;inflation:number;capeRatio?:number;}
export interface HistoricalYear { [key:string]:unknown;jahr:CalendarYear;inflation:number;rendite:number;gold_eur_perf:number;zinssatz:number;capeRatio?:number;regime:string;}
export interface SimulatorInputs extends Omit<EngineInput,'floorBedarf'|'flexBedarf'|'jahreSeitAth'> { [key:string]:unknown;startAlter:number;geschlecht:string;startFloorBedarf:Euro;startFlexBedarf:Euro;startVermoegen:Euro;
 pflegefallLogikAktivieren?:boolean;careToday?:{grade?:number;[key:string]:unknown};partner?:{aktiv:boolean;startAlter:number;geschlecht?:string;careToday?:{grade?:number;[key:string]:unknown};brutto?:Euro};partnership?:{status?:string};
 widowOptions?:unknown;stressPreset?:string;simulationSourceProfileId?:string;home?:{wert:number;nutzung:string;[key:string]:unknown}[];fixedIncome?:unknown[];rente1?:number;rente2?:number;plannedExpenses?:import('./datenvertraege').PlannedExpense[];plannedExpensesReferenceYear?:number;simulationPeople?:{profileId:string;name?:string;[key:string]:unknown}[];householdWithdrawalMode?:string;accumulationPhase?:{enabled:boolean};transitionYear?:number;}
export type Random = (()=>number) & {fork(label:string):Random;comparisonPhase?(phase:string):void};

export interface RunMeta {logDataRows?:SimulationLog[];stressReplayCapture?:ReplayCapture;index:number;endVermoegen:number;failed:boolean;lebensdauer:number;[field:string]:unknown;}
export interface RunMetrics {failCount:number;pflegeTriggeredCount:number;p1TriggeredCount:number;p2TriggeredCount:number;shortfallWithCareCount:number;shortfallNoCareProxyCount:number;runsSafetyStage1Triggered:number;runsSafetyStage2Triggered:number;totalSimulatedYears:number;totalYearsQuoteAbove45:number;totalYearsSafetyStage1plus:number;totalYearsSafetyStage2:number;totalTaxSavedByLossCarry:number;healthBucketEnabledCount:number;healthBucketUsedCount:number;healthBucketDepletedCount:number;totalHealthBucketUsed:number;tailRiskRunsActiveCount:number;tailRiskRunsAppliedCount:number;tailRiskEventCount:number;tailRiskEvaluatedYears:number;tailRiskActiveYears:number;tailRiskAppliedYears:number;tailRiskSkippedHistoricalCrisisYears:number;entryAges:number[];entryAgesP2:number[];p1CareAdditionalNeedRealEur:number[];p2CareAdditionalNeedRealEur:number[];totalCareAdditionalNeedRealEur:number[];endWealthWithCareRealEur:number[];endWealthNoCareRealEur:number[];healthBucketUsedAmounts:number[];healthBucketEndAmounts:number[];healthBucketCoveragePct:number[];healthBucketTargetGaps:number[];healthBucketInterestAmounts:number[];p1CareYearsTriggered:number[];p2CareYearsTriggered:number[];bothCareYearsOverlapTriggered:number[];maxAnnualCareAdditionalNeedRealEur:number[];allRealWithdrawalsSample:number[];runMeta:RunMeta[];worstRun:WorstRun|null|undefined;worstRunCare:WorstRun|null|undefined;}
type LegacyReturnAssessment = ReturnType<typeof import('../engine/planners/vpw-return-policy.mjs').deriveCAPELegacyStepReturn>;
type ContinuousReturnAssessment = ReturnType<typeof import('../engine/planners/vpw-return-policy.mjs').deriveCAPEContinuousReturn>;
export type VpwReturnAssessment = Omit<LegacyReturnAssessment,'expectedReturnCape'> & {expectedReturnCape?:number} & Partial<Omit<ContinuousReturnAssessment,keyof LegacyReturnAssessment>>;
export interface Sampler {indices:number[];cdf:number[]|null;}
export interface SamplingConfig {mode:string;allowedIndices:number[];allowedIndexSet:Set<number>;allSampler:Sampler|null;blockSampler:Sampler|null;blockStartIndices:number[];maxStartIndex:number;regimeSamplers:Record<string,Sampler|null>;weightsByIndex:number[];}
export interface SamplingPublicContract {schemaVersion:string;method:string;startSource:string;requestedStartYearMode:string;capeSamplingRequested:boolean;capeSamplingEffective:boolean;excludeEstimatedHistory:boolean;ignoredOptions:string[];warnings:string[];initialCandidateCount:number;firstRecordPolicy:string;fixedBlockPolicy:string;stationaryRestartPolicy:string;regimePolicy:string;emptyRegimePoolPolicy?:string;drawableRegimes?:string[];precedence:string[];}
export interface SamplingResolution {contract:SamplingPublicContract;initialStartSampler:Sampler;blockStartSampler:Sampler|null;effectiveYearSamplingConfig:SamplingConfig;}
export interface SamplingDiagnostics {modelContracts?:{householdLife:object;demographyCareSurvivor:ReturnType<typeof import('../app/simulator/monte-carlo-runner.js').createDemographyCareSurvivorDiagnosticsV1>};schemaVersion:string;contract:SamplingPublicContract;dataVersion:Record<string,unknown>;requestedRuns:number;sampledYears:number;initialStartYearCounts:Record<string,number>;historicalYearCounts:Record<string,number>;sourceCounts:Record<string,number>;regimeCounts:Record<string,number>;stationaryRestartCounts:Record<string,number>;tailRisk:Record<string,number>;}
export interface SamplerState {yearSampling?:SamplingConfig;blockStartIndex?:number;yearInBlock?:number;contractInitialStartIndex?:number;contractInitialRecordPending?:boolean;currentRegime?:string;stationaryBootstrap?:ReturnType<import('./rechenkern-integration').CreateStationaryBootstrapSampler>;}
export interface StressContext {type:string;preset?:{years?:number;[key:string]:unknown};remainingYears:number;pickableIndices?:number[];[key:string]:unknown;}
export interface TechnicalPathError {runIndex?:number;simulationYearIndex?:number;errors?:TechnicalPathError[];code:string;message:string;details?:unknown;cause?:unknown;}
export interface TechnicalInventory {requested:number;financiallyEvaluable:number;technicalError:number;errors:TechnicalPathError[];}
export type WealthFan = ReturnType<typeof import('../app/simulator/wealth-fan-aggregation.js').createWealthFan>;
export type HomeWealthFan = ReturnType<typeof import('../app/simulator/wealth-home-fan.js').createHomeWealthFan>;
export interface MonteCarloChunkResult {schemaVersion:string;runRange:{start:number;count:number};buffers:NumericBuffers;pathSummaries:NumericBuffers;pathMissingness:NumericBuffers;heatmap:Uint32Array[];bins:number[];totals:Record<string,number>;lists:Record<string,number[]>;allRealWithdrawalsSample:number[];technicalInventory:TechnicalInventory;samplingDiagnostics:SamplingDiagnostics;worstRun?:WorstRun|null;worstRunCare?:WorstRun|null;runMeta:RunMeta[];wealthFan?:WealthFan|null;displayHomeValueFan?:HomeWealthFan|null;batchStatus?:string;financialMetricsValid?:boolean;}
export type ChunkContribution = Pick<MonteCarloChunkResult,'runRange'|'totals'|'heatmap'|'allRealWithdrawalsSample'|'technicalInventory'|'samplingDiagnostics'|'worstRun'|'worstRunCare'>;
export interface ChunkAccumulator {schemaVersion:string;totalRuns:number;bins:number[];heatmapRows:number;buffers:NumericBuffers;pathSummaries:NumericBuffers;pathMissingness:NumericBuffers;mergedRuns:Uint8Array;retainRunMeta:boolean;runMetaByIndex:(RunMeta|undefined)[]|null;samplingDiagnostics:SamplingDiagnostics|null;wealthFan:WealthFan|null;displayHomeValueFan?:HomeWealthFan|null;wealthFanMissing:boolean;contributions:Map<number,ChunkContribution>;}
export interface YearSuccess {kind:'success';isRuin:false;newState:SimulationState;logData:FinancialLog;totalTaxesThisYear:number;ui?:EngineUi;error?:never;portfolio?:SimulationPortfolio;[key:string]:unknown;}
export interface YearRuin {ui?:EngineUi;kind:'ruin';isRuin:true;portfolio?:SimulationPortfolio;logData:SimulationLog;newState:SimulationState;totalTaxesThisYear?:number;error?:never;[key:string]:unknown;}
export interface YearTechnicalError {kind:'technical_error';ui?:never;isRuin:false;error:TechnicalPathError;logData?:never;newState?:never;portfolio?:never;totalTaxesThisYear?:never;}
export type YearOutcome = YearSuccess|YearRuin|YearTechnicalError;
export type EuroPathField = 'taxPaidRealEur'|'taxSavedRealEur'|'withdrawalP10NominalEur'|'stressWithdrawalP10NominalEur'|'minimumFlexPaidMedianRealEur'|'minimumFlexDesiredMedianRealEur'|'minimumFlexPaidMinimumRealEur'|'healthBucketUsedRealEur'|'healthBucketEndRealEur'|'healthBucketTargetGapRealEur';
export type EuroPath = Record<EuroPathField,number> & {valid:boolean};
export interface DiagnosticNotice {key:string;severity:string;message:string;}
export interface CareMeta { [key:string]:unknown;active:boolean;triggered:boolean;startAge:number;durationYears:number;currentYearInCare:number;zusatzFloorZiel:number;zusatzFloorDelta:number;flexFactor:number;kumulierteKosten:number;floorAtTrigger:number;flexAtTrigger:number;maxFloorAtTrigger:number;grade:number|null;gradeLabel:string;mortalityFactor:number;personGender:string;}
export interface HouseholdContext {p1Alive:boolean;p2Alive:boolean;widowBenefits:{p1FromP2:boolean;p2FromP1:boolean;p1FromP2Percent:number;p2FromP1Percent:number};care?:{p1?:CareMeta|null;p2?:CareMeta|null};careMetaP1?:CareMeta|null;careMetaP2?:CareMeta|null;}
export interface LifeLogContext {hasPartner:boolean;p1Alive:boolean;p2Alive:boolean;careMetaP1?:CareMeta|null;careMetaP2?:CareMeta|null;deathThisYear?:boolean;effectiveFlexFactor?:number;p1ActiveThisYear?:boolean;p2ActiveThisYear?:boolean;includeLegacyCareGrade?:boolean;}
export interface ReplayCollector {beginYear(state:SimulationState,index:number,data:HistoricalYear):unknown;beforeEngine(year:unknown,value:unknown):void;afterEngine(year:unknown,value:unknown):void;}
export type FinancialLog = SimulationLog & {entnahmequote:number;flex_wunsch_haushalt_nominal:number;entscheidung:SpendingResult;jahresentnahme_real:number;};
export type TaxResolution = {status:'resolved';expected:ReturnType<typeof import('../engine/tax-settlement.mjs').settleTaxYear>;reason?:never;context?:never}|{status:'invalid';reason:string;context?:Record<string,unknown>};
export interface RuinOptions {currentState:SimulationState;inflowLog?:Record<string,unknown>|null;expenseLog?:Record<string,unknown>|null;portfolio:SimulationPortfolio;liquiditaet:number;marketDataCurrentYear?:MarketData;reason:string;requiredFloorNominal:number;coveredFloorNominal:number;effectiveWithdrawalNominal:number;depotValueNominal:number;taxReconciliation?:{totalTaxesThisYear:number;taxShortfall?:number}|null;personalTaxFunding?:{reason:string;shortfall:number}|null;healthBucketLog?:Record<string,unknown>|null;}
export interface WidowOptions {mode:string;percent:number;marriageOffsetYears:number;minMarriageYears:number;}
export interface DeathLogContext {jahr:number;histJahr:number|null;inflation:number|null;tailRiskOverlay?:TailRiskOverlay|null;}
export interface LifeYear {ageP1:number;ageP2:number;effectiveTransitionYear:number;triggeredAge:number|null;careEverActive:boolean;isAccumulation:boolean|undefined;totalCareFloor:number;effectiveFlexFactor:number;householdContext:HouseholdContext|null;}
export interface MonteCarloLifeState {careMetaP1:CareMeta|null;careMetaP2:CareMeta|null;hasPartner:boolean;rngCareP1:Random;rngCareP2:Random|null;singleNoCareFastPath:boolean;p1Alive:boolean;p2Alive:boolean;p1CareYears:number;p2CareYears:number;bothCareYears:number;triggeredAgeP2:number|null;runEndedBecauseAllDied:boolean;deathLogContext:DeathLogContext|null;p1ActiveThisYear:boolean|undefined;p2ActiveThisYear:boolean|undefined;widowBenefitActiveForP1:boolean;widowBenefitActiveForP2:boolean;householdContext:HouseholdContext;year:LifeYear;}
export interface TailRiskOverlay {tailRiskActive:boolean;tailRiskApplied:boolean;tailRiskSkippedReason?:string|null;tailRiskEventType?:string|null;tailRiskEventId?:string|null;tailRiskEventYearOffset?:number|null;tailRiskReturnShockPct?:number;tailRiskInflationShockPct?:number;historicalReturnPct?:number|null;effectiveReturnPct?:number|null;historicalInflationPct?:number|null;effectiveInflationPct?:number|null;historicalCrisis?:boolean;historicalCrisisReasons?:string[];}
export interface ReplayHouseholdEvent {type:string;p1Alive:number|boolean;p2Alive:number|boolean|null;p1CareActive:boolean;p2CareActive:boolean;careMetaP1:CareMeta|null;careMetaP2:CareMeta|null;effectiveFlexFactor?:number;totalCareFloorEur?:number;widowBenefitActiveForP1?:boolean;widowBenefitActiveForP2?:boolean;effectiveTransitionYear?:number;}
export interface ReplayAnnualRecord {yearIndex:number;recordType:string;financiallyEvaluable:boolean;historicalYear:number|null;stressEvents:unknown[]|null;tailRiskEvents:TailRiskOverlay[];householdEvents:ReplayHouseholdEvent[];continuation:boolean;equityReturnPct?:number;goldReturnPct?:number;cashReturnPct?:number;inflationPct?:number;wageGrowthPct?:number;capeRatio?:number;regime?:string;}
export interface ComparisonPairing {mode:string;tapes:Map<number,Map<string,number[]>>;continuationYears:Map<number,number>;onYear?:(event:{runIndex:number;yearIndex:number;historicalYear:number|null;p1Alive:boolean;p2Alive:boolean;careP1:number;careP2:number})=>void;onFinancialYear?:(runIndex:number,log:SimulationLog|undefined,year:number)=>void;}
export interface MonteCarloChunkOptions {inputs:SimulatorInputs;monteCarloParams:MonteCarloParametersInput;widowOptions:WidowOptions;useCapeSampling:boolean;runRange?:{start:number;count:number}|null;onProgress?:(pct:number,details?:{phase:string;completedRuns:number;totalRuns:number})=>void;logIndices?:number[]|null;stressReplayCapture?:{schemaVersion:string;runIndices:readonly number[]}|null;signal?:AbortSignal|null;engine?:typeof import('../engine/index.mjs').EngineAPI|null;collectWealthFan?:boolean;comparisonPairing?:ComparisonPairing|null;}
export type DeepPartial<T> = T extends readonly(infer V)[] ? DeepPartial<V>[] : T extends object ? {[K in keyof T]?:DeepPartial<T[K]>} : T;
export type Portable<T> = T extends Date ? string : T extends (...args:never[])=>unknown ? symbol
    : T extends readonly(infer V)[] ? (Exclude<Portable<V>,symbol>|(symbol extends Portable<V>?null:never))[]
    : T extends object ? {[K in keyof T as T[K] extends undefined|symbol|((...args:never[])=>unknown)?never:K]:Exclude<Portable<T[K]>,symbol>}
    : unknown extends T ? import('./datenvertraege').Json|symbol : T extends undefined|symbol ? symbol : T extends bigint ? never : T;
export type ContractClone<T> = Exclude<Portable<T>,symbol> | (T extends undefined|symbol|((...args:never[])=>unknown)?null:never);
export interface Fingerprint {algorithm:string;value:string;}
export interface ExecutionContract {mode?:string;compareModeRequested?:boolean;workerCount?:number;timeBudgetMs?:number|null;chunkConfiguration?:{strategy?:string;minChunkRuns?:number|null;baseTimeoutMs?:number|null;stallTimeoutMs?:number|null};}
export type AggregateMetrics = ReturnType<typeof import('../app/simulator/monte-carlo-aggregates.js').buildMonteCarloAggregates> & {batchStatus:string;financialMetricsValid:boolean;technicalInventory:TechnicalInventory;outcomeInventory:ReturnType<typeof import('../app/simulator/monte-carlo-chunk-result.js').buildMonteCarloOutcomeInventoryV1>};
export type RunRequestV1 = ReturnType<typeof import('../app/simulator/monte-carlo-contracts.js').createMonteCarloRunRequestV1>;
export type RunResultV1 = ReturnType<typeof import('../app/simulator/monte-carlo-contracts.js').createMonteCarloRunResultV1>;
export type RunResultV2 = ReturnType<typeof import('../app/simulator/monte-carlo-contracts.js').projectMonteCarloRunResultV2>;
export interface PersonalAccount {profileId:string;name?:string;liquiditaet:number;tagesgeld:number;geldmarktEtf:number;taxState?:TaxState;[key:string]:unknown;}
export interface SimulatorAction extends Action {quellen:ActionSource[];verwendungen:Record<string,number>;nettoErlös:number;steuer:number;
 cashInvestmentRules?:{minimum:number;isSavingsYear:boolean};personalAnnualTaxes?:{profileId?:string;saleTaxDue:number;taxFundingGross:number;[key:string]:unknown}[];
 personalPayoutSale?:{gross:number;sources:ActionSource[];persons?:{profileId:string;gross:number}[]};householdTaxSale?:{sources:ActionSource[]};
 personalPlannedActions?:{profileId:string;action:Action}[];personalTaxFunding?:{reason:string;shortfall:number};}
export type ThreeBucketState = ReturnType<typeof import('../engine/transactions/three-bucket-logic.mjs').finalizeThreeBucketAction>['threeBucketState'];
export type ReplayCall = ['beginYear',[SimulationState,number,HistoricalYear]]|['beforeEngine'|'afterEngine',unknown];
export interface LegacyYearRuin extends Omit<YearRuin,'kind'|'newState'> {kind?:undefined;newState?:SimulationState;}
export interface SweepParameters {liquidityRunwayYears:number;goldRebalancingBand?:number;maxSkimPct?:number;maxBearRefillPct?:number;goldTargetPct?:number;horizonYears?:number;survivalQuantile?:number;goGoMultiplier?:number;[key:string]:unknown;}
export type SweepRequest = ReturnType<typeof import('../app/simulator/monte-carlo-parameters.js').normalizeSweepRequestV1>;
export interface SweepFingerprintTrace {runIndex:number;historicalYearIndices:number[];}
export interface SweepFingerprint {hash:number;publicValue:{schemaVersion:string;hashAlgorithm:string;hash:string|null;combinationIndex:number;requestedSamplingMethod:string;appliedSamplingMethod:string;tracedRuns:SweepFingerprintTrace[];truncated:boolean};}
export interface SweepRiskTrace {runIndex:number;tailRiskSchedule:{valid:boolean;horizonYears:number|null;scheduledEvents:object[];truncated:boolean;errors:object[]};events:Record<string,unknown>[];truncated:boolean;}
export interface SweepRiskDiagnostics {schemaVersion:string;runsEvaluated:number;yearsEvaluated:number;household:{p1DeathEvents:number;p2DeathEvents:number;allDeadRuns:number;p1CareActiveYears:number;p2CareActiveYears:number;bothCareActiveYears:number;widowP1ActiveYears:number;widowP2ActiveYears:number;totalCareFloorNominalEur:number;minimumTemporaryFlexFactor:number|null};horizon:{resolutionCount:number;invalidResolutionCount:number;minimumYears:number|null;maximumYears:number|null};tailRisk:Record<string,number>;tracedRuns:SweepRiskTrace[];}
export type SweepMetrics = ReturnType<typeof import('../app/simulator/simulator-results.js').aggregateSweepMetrics> & {invalidCombination?:boolean;invalidReason?:string;warningR2Varies?:boolean};
export interface SweepChunkResult {results:{comboIdx:number;params:SweepParameters;metrics:SweepMetrics;provenance:Record<string,unknown>}[];p2VarianceCount:number;sweepRequest:SweepRequest;}
export interface SweepChunkOptions {baseInputs:SimulatorInputs;paramCombinations:SweepParameters[];comboRange?:{start:number;count:number};sweepRequest?:SweepRequestInput|null;sweepConfig?:SweepRequestInput|null;refP2Invariants?:object|null;engine?:typeof import('../engine/index.mjs').EngineAPI|null;onProgress?:(completedUnits:number)=>void;now?:()=>number;yieldToEventLoop?:()=>Promise<unknown>;signal?:AbortSignal;}
export interface CompiledScenario {inputs:SimulatorInputs;widowOptions:WidowOptions;methode:SamplingMethod;useCapeSampling:boolean;}
export interface WorkerCommand {jobId:number;generationId?:GenerationId;}
export type McWorkerRequest = WorkerCommand & (
 {type:'init';scenarioKey:string;compiledScenario:CompiledScenario;dataVersion:{annualDataHash:string;regimeHash:string}}
 |{type:'dispose'}|{type:'sweep-init';baseInputs:SimulatorInputs;paramCombinations:SweepParameters[]}
 |{type:'job';scenarioKey:string;runRange:{start:number;count:number};monteCarloParams:MonteCarloParametersInput;useCapeSampling?:boolean;logIndices?:number[];collectWealthFan?:boolean;dataVersion?:{annualDataHash:string;regimeHash:string}}
 |{type:'sweep';sweepRequest?:SweepRequestInput;sweepConfig?:SweepRequestInput;comboRange:{start:number;count:number};refP2Invariants?:object});
/** Exportierte Personenabweichungen enthalten ausschließlich skalare Annahmen. */
export interface PersonDataContext {schemaVersion:1;referenceYear:number;ageRule:'january-1-completed-years';deviationApplied:boolean;persons:{profileId:string;role:'primary'|'partner';changes:{field:string;profileValue:null|string|boolean|number;effectiveValue:null|string|boolean|number}[]}[];}
export interface ExportBuildOptions {request:RunRequestV1;result:RunResultV1|RunResultV2;engine?:Record<string,unknown>|null;app?:{applicationId:string;packageVersion:string;desktopBundleVersion?:string};exportedAt?:Date|string|number;personDataContext?:PersonDataContext|null;}
export type ExportV1 = ExportDocument<RunResultV1> & {schemaVersion:'MonteCarloExportV1'};
export type ExportV2 = ExportDocument<RunResultV2> & {schemaVersion:'MonteCarloExportV2'};
export interface LegacyAliasTelemetry {event:string;field?:string;path?:string;replacement?:string;removalTarget?:string;}
export interface ExportReadOptions {verifyFingerprint?:boolean;onTelemetry?:((event:LegacyAliasTelemetry)=>void)|null;}
export interface ScenarioSourceRow extends SimulationLog {recordType:string;financiallyEvaluable:boolean;entscheidung?:Partial<SpendingResult> & {jahresEntnahme?:number};QuoteEndPct?:number;}
export type ScenarioMeasurements = Record<'realReturnEquityRatio'|'realReturnGoldRatio'|'nominalReturnEquityRatio'|'nominalReturnGoldRatio'|'realizedWithdrawalRatePct'|'preDecisionWithdrawalRatePct'|'minimumFlexConfiguredAnnualEur'|'minimumFlexPolicyEffectiveAnnualEur'|'minimumFlexFulfilledAnnualEur',number|null>;
export interface MeasurementMissingness {reason:string|null;observationCount:{observations:number};}
export type ScenarioExportRow = Record<string,unknown> & ScenarioMeasurements & {recordType:string;financiallyEvaluable:boolean;measurementMissingness:Record<string,MeasurementMissingness>};
export interface ScenarioLogDocument {schemaVersion:string;personDataContext?:PersonDataContext|null;unitContract:{schemaVersion:string;ratioFields:Record<string,string>;percentagePointFields:Record<string,{numerator:string;denominator:string;measurementTime:string;description?:string}>;annualMoneyFields:Record<string,string>;minimumFlexRestriction:Record<string,string>;terminalRecordPolicy:string};materializationContract:{scope:string;input:string;streaming:boolean};records:ScenarioExportRow[];}

export interface ExportDocument<R> {schemaId:string;schemaVersion:string;exportedAtUtc:string;personDataContext?:PersonDataContext|null;app:{applicationId:string;packageVersion:string;desktopBundleVersion?:string};engine:Record<string,unknown>;snapshotPolicy:typeof import('../app/simulator/monte-carlo-contracts.js').MONTE_CARLO_SNAPSHOT_POLICY;request:RunRequestV1;result:R;identifiers:{requestId:string;runId:string};fingerprint:Fingerprint & {excludes:string[]};compatibility:{forwardPolicy:string;newExportsWriteDeprecatedAliases:boolean;unknownSchemaVersions:string;deprecatedReadAliases?:object[];readablePredecessors?:string[]};privacy:Record<string,unknown>;}

export interface PlannedActionFlow {schemaVersion:string;contractStatus:string;type:string;quellen:readonly ActionSource[];verwendungen:Readonly<Record<string,number>>;nettoErlös?:number;steuer?:number;taxRawAggregate:RawTaxAggregate;}
export interface ReplayCapture {schemaVersion:string;seed:number;runSeed:number;rngMode:string;absoluteRunIndex:number;horizonYears:number;startYearIndex:number;breakOnRuin:boolean;initialMarketDataHist:MarketData;years:ReplayAnnualRecord[];sourcePrefixLength:number;terminalStatus:string|null;continuation:{schemaVersion:string;active:boolean;domain:string;shadowSeed:number|null;startsAtYearIndex:number|null;careInflationPolicy:string};}
