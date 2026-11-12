/** @import {SimulatorInputs,SimulationState,SimulationPortfolio,SimulationLog,HistoricalYear,Random,CareMeta,HouseholdContext,LifeLogContext,MonteCarloLifeState,WidowOptions,DeathLogContext,TailRiskOverlay,ReplayAnnualRecord,ReplayHouseholdEvent,YearOutcome,YearSuccess,YearRuin,TechnicalInventory,NumericBuffers,SamplingDiagnostics} from '../../typcheck/rechenkern' */
import { sumDepot } from './simulator-portfolio.js';
import { buildCareLogFields } from './simulator-care-log.js';
import { endCareForDeceased } from './simulator-engine-helpers.js';

/** @param {TailRiskOverlay|null} tailRiskOverlay */
function buildTailRiskLogFields(tailRiskOverlay = null) {
    return {
        tailRiskActive: tailRiskOverlay?.tailRiskActive === true,
        tailRiskApplied: tailRiskOverlay?.tailRiskApplied === true,
        tailRiskSkippedReason: tailRiskOverlay?.tailRiskSkippedReason ?? null,
        tailRiskEventType: tailRiskOverlay?.tailRiskEventType ?? null,
        tailRiskEventId: tailRiskOverlay?.tailRiskEventId ?? null,
        tailRiskEventYearOffset: tailRiskOverlay?.tailRiskEventYearOffset ?? null,
        tailRiskReturnShockPct: tailRiskOverlay?.tailRiskReturnShockPct ?? 0,
        tailRiskInflationShockPct: tailRiskOverlay?.tailRiskInflationShockPct ?? 0,
        tailRiskHistoricalReturnPct: tailRiskOverlay?.historicalReturnPct ?? null,
        tailRiskEffectiveReturnPct: tailRiskOverlay?.effectiveReturnPct ?? null,
        tailRiskHistoricalInflationPct: tailRiskOverlay?.historicalInflationPct ?? null,
        tailRiskEffectiveInflationPct: tailRiskOverlay?.effectiveInflationPct ?? null,
        tailRiskHistoricalCrisis: tailRiskOverlay?.historicalCrisis === true,
        tailRiskHistoricalCrisisReasons: Array.isArray(tailRiskOverlay?.historicalCrisisReasons)
            ? tailRiskOverlay.historicalCrisisReasons.join(',')
            : ''
    };
}

/** @param {LifeLogContext} context */
function buildMonteCarloLifeLogFields(context) {
    const { hasPartner, p1Alive, p2Alive } = context;
    return {
        Person1Alive: p1Alive ? 1 : 0,
        Person2Alive: hasPartner ? (p2Alive ? 1 : 0) : null,
        .../** @type {import('../../typcheck/rechenkern-integration').BuildCareLogFields} */ (buildCareLogFields)(context)
    };
}

/** @param {{result?:YearRuin|null;simulationsJahr:number;yearData:{jahr:number|null;inflation:number|null|undefined};inputs:SimulatorInputs;lifeLogContext:LifeLogContext;tailRiskOverlay?:TailRiskOverlay|null}} options
 * @returns {SimulationLog} */
export function buildMonteCarloRuinLogRow({
    result = null,
    simulationsJahr,
    yearData,
    inputs,
    lifeLogContext,
    tailRiskOverlay = null
}) {
    return {
        ...Object.fromEntries(Object.entries(result?.logData || {}).filter(([key]) => key.startsWith('health_bucket_'))),
        ...(result?.logData?.residenceTaxPayment ? { wohnrechtsteuer: result.logData.wohnrechtsteuer,
            residenceTaxPayment: result.logData.residenceTaxPayment } : {}),
        ...(result?.logData?.immobilien_wert_end !== undefined ? { immobilien_wert_end: result.logData.immobilien_wert_end } : {}),
        ...(result?.logData?.immobilienverkauf_hinweis ? { immobilienverkauf_hinweis: result.logData.immobilienverkauf_hinweis } : {}),
        ...(result?.logData?.immobilien_notverkauf ? { immobilien_notverkauf: true } : {}),
        ...(result?.logData?.wohnmiete !== undefined ? { wohnmiete: result.logData.wohnmiete,
            wohnmiete_startjahr: result.logData.wohnmiete_startjahr, wohnmiete_aktiv: result.logData.wohnmiete_aktiv } : {}),
        ...(result?.logData?.immobilienverkauf !== undefined ? { immobilienverkauf: result.logData.immobilienverkauf,
            immobilienverkauf_jahr: result.logData.immobilienverkauf_jahr,
            immobilienverkauf_personen: result.logData.immobilienverkauf_personen } : {}),
        ...(result?.logData?.zufluss ? { zufluss: result.logData.zufluss, zufluss_personen: result.logData.zufluss_personen } : {}),
        ...(result?.logData?.inheritance ? { abgang_erben: result.logData.abgang_erben,
            erbschaftsteuer: result.logData.erbschaftsteuer, inheritance: result.logData.inheritance, SurvivorDeathYear: true } : {}),
        ...(result?.logData?.geplante_ausgaben ? { geplante_ausgaben: result.logData.geplante_ausgaben } : {}),
        recordType: 'terminal_ruin',
        financiallyEvaluable: false,
        jahr: simulationsJahr + 1,
        histJahr: yearData.jahr,
        inflation: yearData.inflation,
        ...buildTailRiskLogFields(tailRiskOverlay),
        aktionUndGrund: `>>> RUIN <<< ${result?.reason || result?.logData?.ruin_reason
            || result?.logData?.personal_tax_funding_reason || 'Bedarf im Haushalt ungedeckt'}${result?.logData?.immobilienverkauf_hinweis ? ` / ${result.logData.immobilienverkauf_hinweis}` : ''}`,
        ...(result?.reason || result?.logData?.ruin_reason ? { ruin_reason: result.reason || result.logData.ruin_reason } : {}),
        ...(result?.logData?.terminal_reason ? { terminal_reason: result.logData.terminal_reason,
            tax_shortfall: result.logData.tax_shortfall } : {}),
        ...(result?.logData?.personal_tax_funding_reason ? {
            personal_tax_funding_reason: result.logData.personal_tax_funding_reason,
            personal_tax_funding_shortfall: result.logData.personal_tax_funding_shortfall
        } : {}),
        wertAktien: 0,
        wertGold: 0,
        liquiditaet: 0,
        entscheidung: { jahresEntnahme: 0 },
        floor_brutto: 0,
        rente1: inputs.rente1 || 0,
        rente2: inputs.rente2 || 0,
        renteSum: (inputs.rente1 || 0) + (inputs.rente2 || 0),
        FlexRatePct: 0,
        flex_erfuellt_nominal: 0,
        QuoteEndPct: 0,
        RunwayCoveragePct: null,
        RunwayMeasurementPhase: 'not_applicable_terminal_ruin',
        RunwayCoveragePostPayoutEndOfYearPct: null,
        runway_after_transaction_before_payout_months: null,
        runway_post_payout_end_of_year_months: null,
        RealReturnEquityPct: 0,
        RealReturnGoldPct: 0,
        jahresentnahme_real: 0,
        ...buildMonteCarloLifeLogFields({
            ...lifeLogContext,
            includeLegacyCareGrade: true
        }),
        vpw: null
    };
}

/** @param {{simulationsJahr:number;yearData:{jahr:number|null;inflation:number|null|undefined};result:YearSuccess;lifeLogContext:LifeLogContext;tailRiskOverlay?:TailRiskOverlay|null}} options
 * @returns {SimulationLog} */
export function buildMonteCarloYearLogRow({
    simulationsJahr,
    yearData,
    result,
    lifeLogContext,
    tailRiskOverlay = null
}) {
    return {
        jahr: simulationsJahr + 1,
        histJahr: yearData.jahr,
        inflation: yearData.inflation,
        ...buildTailRiskLogFields(tailRiskOverlay),
        ...result.logData,
        recordType: 'financial_year',
        financiallyEvaluable: true,
        ...buildMonteCarloLifeLogFields(lifeLogContext),
        vpw: result.ui?.vpw || null
    };
}

/** @param {{deathLogContext:DeathLogContext|null;currentRunLogLength:number;portfolioSnapshot:Partial<SimulationPortfolio>;inputs:SimulatorInputs;lifeLogContext:LifeLogContext}} options
 * @returns {SimulationLog} */
export function buildMonteCarloDeathLogRow({
    deathLogContext,
    currentRunLogLength,
    portfolioSnapshot,
    inputs,
    lifeLogContext
}) {
    return {
        recordType: 'terminal_death',
        financiallyEvaluable: false,
        jahr: deathLogContext?.jahr ?? (currentRunLogLength + 1),
        histJahr: deathLogContext?.histJahr ?? null,
        inflation: deathLogContext?.inflation ?? null,
        ...buildTailRiskLogFields(deathLogContext?.tailRiskOverlay ?? null),
        aktionUndGrund: '>>> ENDE: Alle Personen verstorben <<<',
        wertAktien: sumDepot({ depotTranchesAktien: portfolioSnapshot.depotTranchesAktien }),
        wertGold: sumDepot({ depotTranchesGold: portfolioSnapshot.depotTranchesGold }),
        liquiditaet: portfolioSnapshot.liquiditaet ?? 0,
        entscheidung: { jahresEntnahme: 0 },
        floor_brutto: 0,
        rente1: inputs.rente1 || 0,
        rente2: inputs.rente2 || 0,
        renteSum: (inputs.rente1 || 0) + (inputs.rente2 || 0),
        FlexRatePct: 0,
        flex_erfuellt_nominal: 0,
        QuoteEndPct: 0,
        RunwayCoveragePct: null,
        RunwayMeasurementPhase: 'not_applicable_all_persons_deceased',
        RunwayCoveragePostPayoutEndOfYearPct: null,
        runway_after_transaction_before_payout_months: null,
        runway_post_payout_end_of_year_months: null,
        RealReturnEquityPct: 0,
        RealReturnGoldPct: 0,
        jahresentnahme_real: 0,
        ...buildMonteCarloLifeLogFields({
            ...lifeLogContext,
            includeLegacyCareGrade: true
        }),
        vpw: null
    };
}

/** @template T
 * @param {T} value
 * @returns {T} */
function cloneReplayLogValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Rebuilds the exact simulator-facing annual data shape from a materialized
 * replay record. No sampling or fallback return is allowed here.
 */
/** @param {ReplayAnnualRecord} record */
export function buildStressReplayYearData(record) {
    if (!record || typeof record !== 'object') {
        throw new TypeError('A materialized stress replay year is required.');
    }
    const financiallyRunnable = record.recordType === 'financial_year'
        || record.recordType === 'terminal_ruin';
    if (!financiallyRunnable) {
        return {
            jahr: record.historicalYear ?? null,
            inflation: record.inflationPct ?? null
        };
    }
    return {
        jahr: record.historicalYear,
        rendite: /** @type {number} */ (record.equityReturnPct) / 100,
        gold_eur_perf: record.goldReturnPct,
        zinssatz: record.cashReturnPct,
        inflation: record.inflationPct,
        lohn: record.wageGrowthPct,
        capeRatio: record.capeRatio,
        regime: record.regime
    };
}

/** Projects the stored household event into the existing MC log contract. */
/** @param {ReplayAnnualRecord} record
 * @param {SimulationLog} logData */
export function buildStressReplayLifeLogContext(record, logData = {}) {
    const event = Array.isArray(record?.householdEvents)
        ? record.householdEvents.find(candidate => candidate?.type === 'household_state')
        : null;
    if (!event) return null;
    const hasPartner = event.p2Alive !== null && event.p2Alive !== undefined;
    const careMetaP1 = cloneReplayLogValue(event.careMetaP1);
    const careMetaP2 = cloneReplayLogValue(event.careMetaP2);
    // Letzter Tod: wie im Hauptlauf vor der Jahresrechnung beenden, ohne halbe Pflegekosten.
    if (record.recordType === 'terminal_death') {
        endCareForDeceased(careMetaP1, false);
        endCareForDeceased(careMetaP2, false);
    }
    return {
        hasPartner,
        p1Alive: event.p1Alive === 1 || event.p1Alive === true,
        p2Alive: hasPartner && (event.p2Alive === 1 || event.p2Alive === true),
        careMetaP1,
        careMetaP2,
        deathThisYear: logData.SurvivorDeathYear === true
            || (!event.p1Alive && event.careMetaP1?.active === true)
            || (hasPartner && !event.p2Alive && event.careMetaP2?.active === true),
        effectiveFlexFactor: logData.pflege_flex_faktor,
        p1ActiveThisYear: event.p1CareActive === true,
        p2ActiveThisYear: event.p2CareActive === true
    };
}

/**
 * Builds ScenarioLog-compatible output without consulting an RNG or the DOM.
 */
/** @param {{record:ReplayAnnualRecord;result?:YearOutcome|null;inputs:SimulatorInputs;portfolioSnapshot?:Partial<SimulationPortfolio>;currentRunLogLength?:number}} options
 * @returns {SimulationLog} */
export function buildStressReplayLogRow({
    record,
    result = null,
    inputs,
    portfolioSnapshot = {},
    currentRunLogLength = 0
}) {
    const yearData = buildStressReplayYearData(record);
    const lifeLogContext = buildStressReplayLifeLogContext(record, result?.logData);
    if (!lifeLogContext) {
        const error = /** @type {TypeError & {code?:string}} */ (new TypeError('Stress replay household state is missing.'));
        error.code = 'STRESS_REPLAY_HOUSEHOLD_EVENT_MISSING';
        throw error;
    }
    const tailRiskOverlay = Array.isArray(record.tailRiskEvents) && record.tailRiskEvents.length > 0
        ? cloneReplayLogValue(record.tailRiskEvents.at(-1))
        : null;

    if (record.recordType === 'terminal_death') {
        return buildMonteCarloDeathLogRow({
            deathLogContext: {
                jahr: record.yearIndex + 1,
                histJahr: record.historicalYear ?? null,
                inflation: record.inflationPct ?? null,
                tailRiskOverlay
            },
            currentRunLogLength,
            portfolioSnapshot,
            inputs,
            lifeLogContext
        });
    }
    if (result?.kind === 'ruin' || /** @type {{isRuin?:boolean}|null} */ (result)?.isRuin === true) {
        return buildMonteCarloRuinLogRow({
            simulationsJahr: record.yearIndex,
            yearData,
            result,
            inputs,
            lifeLogContext,
            tailRiskOverlay
        });
    }
    return buildMonteCarloYearLogRow(/** @type {NonNullable<Parameters<typeof buildMonteCarloYearLogRow>[0]>} */ ({
        simulationsJahr: record.yearIndex,
        yearData,
        result,
        lifeLogContext,
        tailRiskOverlay
    }));
}
