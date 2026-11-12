/** Typgrenzen benachbarter JavaScript-Module; Verwendung über lokale Zusicherungen. */
import type { NumericArray, HistoricalYear, Sampler, Random, SimulationState, SimulatorInputs,
    YearOutcome, SimulationPortfolio, WealthFan } from './rechenkern';

export type Quantile = (values: NumericArray,fraction: number) => number;

export type CreateStationaryBootstrapSampler = (options: {annualData:HistoricalYear[];expectedBlockLength?:number;blockSize?:number;mode?:string;cdf?:Sampler|null;startIndices?:number[];initialStartIndex?:number}) => {
        annualData:HistoricalYear[];mode:string;expectedBlockLength:number;restartProbability:number;startIndices:number[];
        startCdf:number[]|null;startSamplerObject:Sampler|null;initialStartIndex:number|null;currentIndex:number|null;
        yearsInCurrentBlock:number;restartCount:number;lastRestartReason:string|null;lastRestartDraw:number|null;
    };

export type NextYearSample = (state: ReturnType<CreateStationaryBootstrapSampler>,rand?:Random|null) => {yearData:HistoricalYear;isRestart:boolean;restartReason:string|null};

export type InitMcRunState = (inputs:SimulatorInputs,startYearIndex:number) => SimulationState;

export type SimulateOneYear = (currentState:SimulationState,inputs:SimulatorInputs,yearData:HistoricalYear,yearIndex:number,pflegeMeta?:unknown,careFloorAddition?:number,householdContext?:unknown,temporaryFlexFactor?:number,engineAPI?:typeof import('../engine/index.mjs').EngineAPI|null,replayCollector?:unknown,preparedGuardrailPlan?:unknown,preserveLogOrder?:boolean) => YearOutcome;

export type AssertWealthFan = (fan:WealthFan,count?:number) => WealthFan;

export type GetStartYearCandidates = (cape:number,data:HistoricalYear[],tolerance?:number,options?:{fallbackToAll?:boolean}) => number[];

export type MakeDefaultCareMeta = (enabled:boolean|undefined,personGender?:string,careToday?:unknown,startAge?:number,inputs?:SimulatorInputs) => import('./rechenkern').CareMeta|null;

export type BuildSimulatorYearResult = (options:object) => Omit<import('./rechenkern').YearSuccess,'kind'>;

export type SimulateAccumulationYear = (options:object) => ReturnType<typeof import("../app/simulator/simulator-accumulation-year.js").simulateAccumulationYear>;

export type ComparisonRandomSource = (source:Random,pairing:import('./rechenkern').ComparisonPairing|null,runIndex:number,runSeed:number) => Random;

export type ApplyTailRiskOverlay = (yearData:HistoricalYear,event:unknown,context?:object) => import('./rechenkern').TailRiskOverlay & {yearData:HistoricalYear};
export type NormalizeWidowOptions = (value:unknown) => import('./rechenkern').WidowOptions;
export type ComputeCareMortalityMultiplier = (care:import('./rechenkern').CareMeta|null,context?:SimulatorInputs) => number;
export type BuildCareLogFields = (context:import('./rechenkern').LifeLogContext) => ReturnType<typeof import('../app/simulator/simulator-care-log.js').buildCareLogFields>;
/** Ergänzt ausschließlich die von unannotierten Defaultwerten zu eng abgeleiteten Optionen. */
type WithOptions<F extends (...args:never[])=>unknown,O,R=ReturnType<F>> = (options:Omit<NonNullable<Parameters<F>[0]>,keyof O>&O)=>R;
export type CreditFixedIncomeSurplus = (...args:[SimulationPortfolio,unknown,unknown,number,number,boolean|undefined,SimulatorInputs,(ReturnType<typeof import('../app/simulator/simulator-fixed-income.js').creditFixedIncomeSurplus>|null)?])=>ReturnType<typeof import('../app/simulator/simulator-fixed-income.js').creditFixedIncomeSurplus>;
export type DebitPersonalLiquidity = (portfolio:SimulationPortfolio,value:number,plan?:{mode?:string;items:{profileId:string|null|undefined;withdrawalAmount:number}[]}|null)=>ReturnType<typeof import('../app/simulator/simulator-personal-accounts.js').debitPersonalLiquidity>;
export type ApplyHealthBucketCoverage = WithOptions<typeof import('../app/simulator/simulator-health-bucket.js').applyHealthBucketCoverage,{householdContext?:import('./rechenkern').HouseholdContext|null;pflegeMeta?:import('./rechenkern').CareMeta|null},Omit<ReturnType<typeof import('../app/simulator/simulator-health-bucket.js').applyHealthBucketCoverage>,'consumedTranches'|'consumedCash'> & {consumedTranches:import('./rechenkern').EngineTranche[];consumedCash:{profileId:string;amount:number}[]}>;
export type ApplyForcedSaleLiquidityCoverage = (options:{forcedShortfall:number;portfolio:SimulationPortfolio;engineInput:import('./rechenkern').NormalizedEngineInput;market:import('./rechenkern').Market;is3Bucket:boolean;isBadYear:boolean;depotTranchesAktien:import('./rechenkern').EngineTranche[];depotTranchesGold:import('./rechenkern').EngineTranche[];equityBeforeForced:number;goldBeforeForced:number;combinedTaxRawAggregate:import('./rechenkern').RawTaxAggregate;captureTransactions?:boolean;attributeAction?:((action:import('./rechenkern').Action)=>import('./rechenkern').Action)|null})=>{liquiditaetDelta:number;bondSaleAmountDelta:number;unmetLiquidityDelta:number;didForcedSale:boolean;forcedSaleScaleApplied:number|null;forcedTaxReservedDelta:number;sources?:import('./rechenkern').ActionSource[];transactionDiagnostic?:object|null};
export type TaxReconciliation = {totalTaxesThisYear:number;taxCashAdjustment:number;taxShortfall?:number};
export type ApplySimulatorTaxRecompute = (options:{didForcedSale:boolean;forceRecompute?:boolean;actionResult:import('./rechenkern').SimulatorAction;plannedActionFlow?:import('./rechenkern').PlannedActionFlow|null;spendingNewState:import('./rechenkern').EngineState;taxStatePrev:import('./rechenkern').TaxState;combinedTaxRawAggregate:import('./rechenkern').RawTaxAggregate;sparerPauschbetrag:number;kirchensteuerSatz:number;cashInterestIncomeSigned?:number;forcedSaleScaleApplied?:number|null;regularSaleScale?:number;forcedTaxReserved?:number})=>TaxReconciliation;
export type SettlePersonalTaxYear = (options:{portfolio:SimulationPortfolio;book:object[];personalInterest:object;actionResult:import('./rechenkern').SimulatorAction;plannedActionFlow:import('./rechenkern').PlannedActionFlow;regularSaleScale:number;forcedTaxReserved:number;spendingNewState:import('./rechenkern').EngineState;didForcedSale:boolean;inputs:SimulatorInputs})=>TaxReconciliation;
export type BuyPersonalAsset = (portfolio:SimulationPortfolio,amount:number,sourceProfileId?:string|null)=>void;
export type AttributeSimulatorAction = (portfolio:SimulationPortfolio,action:import('./rechenkern').Action,inputs:SimulatorInputs,options?:{followup?:boolean;onlyProfileId?:string|null;onlyProfileCash?:boolean;cashReserves?:{profileId:string;amount:number}[]|null})=>import('./rechenkern').Action;
export type ApplyUnmarriedInheritance = (options:{portfolio:SimulationPortfolio;transition:ReturnType<typeof import('../app/simulator/simulator-survivor.js').prepareSurvivorYear>;inputs:SimulatorInputs;inflationFactor:number;pension:object;personalInterest:object;actionResult:import('./rechenkern').SimulatorAction;household:import('./rechenkern').HouseholdContext;reserveTarget?:null|(()=>number)})=>ReturnType<typeof import('../app/simulator/simulator-inheritance.js').applyUnmarriedInheritance>;
export type PrepareSurvivorYear = (...args:Parameters<typeof import('../app/simulator/simulator-survivor.js').prepareSurvivorYear>)=>(NonNullable<ReturnType<typeof import('../app/simulator/simulator-survivor.js').prepareSurvivorYear>> & {inheritanceLog?:NonNullable<ReturnType<ApplyUnmarriedInheritance>>})|null;
export type InitStressContext = (...args:Parameters<typeof import('../app/simulator/simulator-portfolio-stress.js').buildStressContext>)=>import('./rechenkern').StressContext|null;
export type CloneStressContext = (context:import('./rechenkern').StressContext|null)=>import('./rechenkern').StressContext|null;
export interface DecisionComparisonRequest {inputs:SimulatorInputs;params:import('./rechenkern').MonteCarloParametersInput;useCapeSampling:boolean;runRange:{start:number;count:number};tapes?:import('./rechenkern').ComparisonPairing['tapes'];continuationYears?:Map<number,number>;record?:boolean;diagnosticRuns?:number;captureLogs?:boolean;}
export type RunDecisionComparisonRange = (request:DecisionComparisonRequest,options?:{engine?:typeof import('../engine/index.mjs').EngineAPI|null;signal?:AbortSignal;onProgress?:(pct:number)=>void})=>ReturnType<typeof import('../app/simulator/decision-comparison-runner.js').runDecisionComparisonRange>;

export type PriceCareMeta = (meta:import('./rechenkern').CareMeta|null,inputs:SimulatorInputs,currentState?:Partial<SimulationState>|null,yearIndex?:number,floorFactor?:number)=>void;
export type UpdateCareMeta = (meta:import('./rechenkern').CareMeta|null,inputs:SimulatorInputs,age:number,yearData:Partial<HistoricalYear>,rand:Random|null,currentState?:Partial<SimulationState>|null,yearIndex?:number,deferPricing?:boolean)=>void;
export type PersonalCashInvestmentProfiles = (portfolio:SimulationPortfolio,inputs:SimulatorInputs,reserves:{profileId:string;amount:number}[],rules?:{minimum:number;isSavingsYear:boolean})=>{profileId:string;capacity:number}[];
export type UnmarriedWithdrawalPlan = (shares:{profileId:string;share:number;care:number}[],gross:number,portfolio:SimulationPortfolio,includeCare?:boolean)=>{mode:string;fixedOwnership:boolean;totalNeed:number;items:{profileId:string;shared:number;care:number;withdrawalAmount:number}[]};
