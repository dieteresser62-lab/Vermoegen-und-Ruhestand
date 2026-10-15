import { deriveMinimumFlexPath, readMinimumFlexYear } from './minimum-flex-metrics.js';
import { adaptBacktestResult, adaptScenarioLog, adaptMonteCarloScenario,
    adjacent, amount, finite, moneyValue } from './log-analysis-adapters.js';
import { collectPhases, phaseEvidence } from './log-analysis-phases.js';
import { describeLogAnalysisEvent, summarizeLogAnalysis } from './log-analysis-texts.js';

export const LOG_ANALYSIS_RULE_VERSION = 'LogAnalysisRulesV1';

const refs = {
    cuts: 'app/simulator/simulator-year-result.js:entscheidung.kuerzungProzent',
    minimum: 'app/simulator/minimum-flex-metrics.js:readMinimumFlexYear',
    household: 'app/simulator/simulator-year-result.js:flex_haushalt_basis,flex_haushalt_kuerzung_pct',
    safety: 'app/simulator/simulator-year-result.js:SafetyCapActive,SafetyCapApplied,SevereFlexEmergencyActive,Alarm,safety_stage_current,safety_transition,CutReason,FinalLimitingPolicy',
    market: 'app/simulator/simulator-year-result.js:Regime,MarketExtremeBear',
    wealth: 'app/simulator/simulator-year-result.js:portfolio_total_end,inflation_factor_cum',
    inflation: 'app/simulator/scenario-wealth-chart.js:buildScenarioWealthPath',
    liquidity: 'app/simulator/simulator-year-result.js:RunwayCoveragePct,RunwayMeasurementPhase,runway_after_transaction_before_payout_months',
    forced: 'app/simulator/simulator-engine-direct.js:after_forced_sales',
    reserve: 'app/simulator/simulator-year-result.js:health_bucket_used,threeBucket.unmetLiquidity',
    sales: 'app/simulator/simulator-year-result.js:executedSaleEq,gold_after_return,gold_after_sales,bondSaleAmount',
    tax: 'app/simulator/simulator-year-result.js:steuern_gesamt',
    trades: 'app/simulator/simulator-year-result.js:kaufGld,bondRefillGross,bondSaleAmount',
    life: 'app/simulator/mc-log-builder.js:buildMonteCarloLifeLogFields,buildMonteCarloDeathLogRow',
    ruin: 'app/simulator/historical-backtest-runner.js:outcome,floor_shortfall_nominal',
    mcRuin: 'app/simulator/mc-log-builder.js:buildMonteCarloRuinLogRow',
    stress: 'app/simulator/mc-log-builder.js:buildTailRiskLogFields'
};

const PRIORITY = {
    ruin: 1, floor_shortfall: 2, floor_covered: 3, below_minimum_flex_phase: 10, minimum_flex_held: 11,
    decision_flex_cut_phase: 20, household_flex_cut_phase: 21, flex_basis_change: 22,
    minimum_real_year_end_wealth: 30, real_wealth_recovery: 31, real_wealth_unrecovered: 32,
    liquidity_below_target: 40, policy_state_change: 41, initial_policy_observation: 42,
    forced_liquidity_need: 50, forced_liquidity_coverage: 51, unmet_liquidity: 52, health_reserve_use: 53,
    tax_peak: 60, large_sale: 70, gold_purchase: 80, gold_sale: 81, bond_refill: 82, bond_sale: 83,
    market_regime_change: 90, extreme_bear: 91, care_phase: 100, care_grade_change: 101,
    person_death: 102, life_state_observation: 103, household_end: 104,
    tail_risk_overlay: 110, tail_risk_skipped: 111, technical_error: 4
};

const stateKnown = value => typeof value === 'boolean' || finite(value)
    || typeof value === 'string' && value !== '' && value !== 'unknown';
const bit = value => value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null;
const median = values => values.length
    ? (values[Math.floor((values.length - 1) / 2)] + values[Math.ceil((values.length - 1) / 2)]) / 2 : null;

/** Reine Verdichtung vorhandener Laufbelege; kein Runner, DOM oder Speicherzugriff. */
export function analyzeLogEvents(context) {
    const { rows, moneyBasis } = context;
    const financial = rows.filter(item => item.financial);
    const events = [], missingness = {};
    const missing = (rule, item) => (missingness[rule] ??= []).push(item.rowIndex);
    const add = (type, item, evidence, sourceKeys, extra = {}) => {
        const event = {
            id: `${type}:${item?.rowIndex ?? 'unknown'}:${events.length + 1}`,
            type, ruleVersion: LOG_ANALYSIS_RULE_VERSION, year: item?.year ?? null,
            historicalYear: item?.historicalYear ?? null, rowIndex: item?.rowIndex ?? null,
            source: context.kind, sourceRefs: sourceKeys.map(key => refs[key]),
            priority: PRIORITY[type], confidence: 'high', evidence, ...extra
        };
        events.push(event);
        return event;
    };
    const addAmount = (type, item, nominal, sourceKeys, evidence = {}, extra = {}) => add(type, item,
        { ...evidence, amount: moneyValue(nominal, item, moneyBasis, { yearStart: context.kind === 'monte_carlo' }) }, sourceKeys, extra);

    const minimumFlex = deriveMinimumFlexPath(financial.map(item => item.row));
    for (const item of rows) {
        if (item.year === null) missing('year', item);
        if (item.recordType === 'missing_row') missing('row', item);
        if (!item.financial) continue;
        if (readMinimumFlexYear(item.row)?.missing) missing('minimumFlex', item);
        if (!finite(item.row.entscheidung?.kuerzungProzent)) missing('decisionCuts', item);
        if (!finite(item.row.flex_haushalt_kuerzung_pct) || !stateKnown(item.row.flex_haushalt_basis)) missing('householdCuts', item);
        if (item.realWealthEur === null) missing('realWealth', item);
    }

    const cutPhases = collectPhases(rows, item => ({ value: item.row.entscheidung?.kuerzungProzent }), { threshold: 10 });
    for (const phase of cutPhases) add('decision_flex_cut_phase', phase.first,
        { ...phaseEvidence(phase), thresholdPct: 10, basis: 'planned_portfolio_flex_withdrawal' }, ['cuts']);
    for (const phase of collectPhases(rows, item => stateKnown(item.row.flex_haushalt_basis)
        ? { value: item.row.flex_haushalt_kuerzung_pct, basis: item.row.flex_haushalt_basis } : null,
    { threshold: 10, splitBasis: true })) add('household_flex_cut_phase', phase.first,
        { ...phaseEvidence(phase), thresholdPct: 10, basis: phase.basis }, ['household']);
    for (const phase of collectPhases(rows, item => {
        const value = readMinimumFlexYear(item.row);
        return value && !value.missing ? { value: value.below ? 1 : 0,
            minimumNominalEur: item.row.minimumFlexAnnual, paidNominalEur: value.paid,
            shortfallNominalEur: Math.max(0, item.row.minimumFlexAnnual - value.paid),
            shortfallRealEur: moneyValue(Math.max(0, item.row.minimumFlexAnnual - value.paid), item, 'real', { yearStart: context.kind === 'monte_carlo' }).valueEur } : null;
    })) add('below_minimum_flex_phase', phase.first, { ...phaseEvidence(phase),
        maximumShortfallNominalEur: Math.max(...phase.observations.map(value => value.shortfallNominalEur)),
        maximumShortfallRealEur: phase.observations.every(value => finite(value.shortfallRealEur))
            ? Math.max(...phase.observations.map(value => value.shortfallRealEur)) : null,
        comparison: 'paid_household_flex_lt_applied_positive_minimum' }, ['minimum']);
    if (minimumFlex.missingReason === null && minimumFlex.affectedYearCount === 0)
        add('minimum_flex_held', financial[0], { years: financial.length, comparison: 'FR-6' }, ['minimum']);

    const taxes = financial.map(item => amount(item.row.steuern_gesamt)).filter(value => value !== null).sort((a, b) => a - b);
    // Ein fehlendes Steuerjahr lässt den Laufmedian unbekannt, statt den Nenner zu ändern.
    const medianTax = taxes.length === financial.length ? median(taxes) : null;
    let previous = null;
    for (const item of financial) {
        const row = item.row;
        const contiguous = adjacent(previous, item);
        for (const field of ['SafetyCapActive', 'SafetyCapApplied', 'SevereFlexEmergencyActive', 'Alarm', 'safety_stage_current']) {
            if (!stateKnown(row[field])) { missing(`safety.${field}`, item); continue; }
            const knownPrevious = contiguous && stateKnown(previous.row[field]);
            const evidence = { field, from: knownPrevious ? previous.row[field] : null, to: row[field],
                cutReason: row.CutReason ?? null, finalLimitingPolicy: row.FinalLimitingPolicy ?? null,
                transition: row.safety_transition ?? null };
            if (knownPrevious && row[field] !== previous.row[field]) add('policy_state_change', item, evidence, ['safety']);
            else if (!knownPrevious && row[field] !== false && row[field] !== 0)
                add('initial_policy_observation', item, evidence, ['safety']);
        }
        for (const [field, type, source] of [['Regime', 'market_regime_change', 'market'], ['flex_haushalt_basis', 'flex_basis_change', 'household']]) {
            if (!stateKnown(row[field])) { missing(field, item); continue; }
            if (contiguous && stateKnown(previous.row[field]) && previous.row[field] !== row[field])
                add(type, item, { from: previous.row[field], to: row[field] }, [source]);
        }
        if (row.MarketExtremeBear === true && (!contiguous || previous.row.MarketExtremeBear !== true))
            add('extreme_bear', item, { classification: 'MarketExtremeBear', onsetObserved: contiguous && previous.row.MarketExtremeBear === false }, ['market']);
        if (typeof row.MarketExtremeBear !== 'boolean') missing('extremeBear', item);
        if (row.RunwayMeasurementPhase !== 'after_transaction_before_payout' || !finite(row.RunwayCoveragePct)) missing('liquidity', item);
        else if (row.RunwayCoveragePct < 100) {
            const months = amount(row.runway_after_transaction_before_payout_months);
            add('liquidity_below_target', item, { coveragePct: row.RunwayCoveragePct,
                targetGapPct: 100 - row.RunwayCoveragePct, runwayMonths: months,
                measurementPhase: row.RunwayMeasurementPhase }, ['liquidity']);
        }
        const forced = Array.isArray(row.balance_trace) ? row.balance_trace.find(trace => trace?.phase === 'after_forced_sales') : null;
        if (!forced || !finite(forced.forcedShortfall) || !finite(forced.liquiditaetDelta)) missing('forcedSales', item);
        if (amount(forced?.forcedShortfall) > 0) addAmount('forced_liquidity_need', item, forced.forcedShortfall, ['forced'],
            { meaning: 'need_after_reserve_before_forced_sales' });
        if (amount(forced?.liquiditaetDelta) > 0) addAmount('forced_liquidity_coverage', item, forced.liquiditaetDelta, ['forced'],
            { shortfallBeforeSalesNominalEur: amount(forced.forcedShortfall) });
        if (amount(row.health_bucket_used) > 0) addAmount('health_reserve_use', item, row.health_bucket_used, ['reserve']);
        if (amount(row.health_bucket_used) === null) missing('healthReserve', item);
        if (amount(row.threeBucket?.unmetLiquidity) > 0) addAmount('unmet_liquidity', item, row.threeBucket.unmetLiquidity, ['reserve']);
        if (amount(row.threeBucket?.unmetLiquidity) === null) missing('unmetLiquidity', item);

        const goldSale = finite(row.gold_after_return) && finite(row.gold_after_sales)
            ? Math.max(0, row.gold_after_return - row.gold_after_sales) : null;
        const equitySale = amount(row.executedSaleEq), bondSale = amount(row.bondSaleAmount);
        const sales = equitySale !== null && goldSale !== null && bondSale !== null ? equitySale + goldSale + bondSale : null;
        const previousWealth = previous ? contiguous ? previous.nominalWealthEur : null
            : item.rowIndex === 0 ? context.initialWealthEur : null;
        if (sales === null || previousWealth === null || previousWealth <= 0) missing('largeSales', item);
        else if (sales >= 0.1 * previousWealth) addAmount('large_sale', item, sales, ['sales'],
            { shareOfPreviousYearEnd: sales / previousWealth, thresholdRatio: 0.1,
                previousWealthNominalEur: previousWealth }, { confidence: 'heuristic' });
        if (amount(row.steuern_gesamt) === null || medianTax === null) missing('taxPeaks', item);
        else if (row.steuern_gesamt >= 2 * medianTax && row.steuern_gesamt > 1000)
            addAmount('tax_peak', item, row.steuern_gesamt, ['tax'],
                { medianTaxNominalEur: medianTax, multiplier: 2, minimumExclusiveNominalEur: 1000 }, { confidence: 'heuristic' });
        // Gegenläufige Aktionen bleiben als getrennte Belege erhalten.
        const goldSaleScope = goldSale !== null ? 'all_observed_sales' : 'regular_only';
        for (const [type, value] of [['gold_purchase', row.kaufGld], ['gold_sale', goldSale],
            ['bond_refill', row.bondRefillGross], ['bond_sale', row.bondSaleAmount]]) {
            const observed = type === 'gold_sale' && goldSale === null ? amount(row.vk?.vkGld) : amount(value);
            if (observed === null) missing(type, item);
            else if (observed > 0) addAmount(type, item, observed, ['trades', 'sales'],
                type === 'gold_sale' ? { scope: goldSaleScope } : {});
        }
        previous = item;
    }

    const realSeries = financial.filter(item => item.realWealthEur !== null);
    if (realSeries.length) {
        const low = realSeries.reduce((best, item) => item.realWealthEur < best.realWealthEur ? item : best);
        add('minimum_real_year_end_wealth', low, { amountRealEur: low.realWealthEur,
            amount: moneyValue(low.nominalWealthEur, low, moneyBasis),
            observedFinancialYears: realSeries.length, missingFinancialYears: financial.length - realSeries.length,
            includesHealthReserve: true, basis: 'year_end_purchasing_power_at_run_start' }, ['wealth', 'inflation']);
    }
    const startsAtRunBeginning = context.kind === 'monte_carlo' ? rows[0]?.year === 1
        : !context.period || rows[0]?.year === context.period.startYear;
    let peak = startsAtRunBeginning ? context.initialWealthEur : null, peakYear = 'start', underwater = null, priorReal = null;
    for (const item of rows) {
        if (!item.financial || item.realWealthEur === null || item.year === null || (priorReal && !adjacent(priorReal, item))) {
            if (underwater) add('real_wealth_unrecovered', priorReal, { ...underwater, observationEnd: priorReal.year,
                endReason: item.financial ? 'gap_or_missing_value' : 'terminal_or_not_evaluable', openAtEnd: false }, ['wealth', 'inflation']);
            underwater = null; peak = null;
        }
        if (!item.financial || item.realWealthEur === null || item.year === null) { priorReal = null; continue; }
        if (peak !== null && item.realWealthEur < peak && !underwater)
            underwater = { fromYear: item.year, peakYear, targetRealEur: peak,
                targetNominalEur: peakYear === 'start' ? context.initialWealthEur : financial.find(row => row.year === peakYear)?.nominalWealthEur ?? null };
        if (peak === null || item.realWealthEur >= peak) {
            if (underwater) add('real_wealth_recovery', item, { ...underwater,
                durationToRecoveryYears: item.year - underwater.fromYear + 1 }, ['wealth', 'inflation']);
            underwater = null; peak = item.realWealthEur; peakYear = item.year;
        }
        priorReal = item;
    }
    if (underwater) add('real_wealth_unrecovered', priorReal, { ...underwater, observationEnd: priorReal.year,
        endReason: 'end_of_observation', openAtEnd: true }, ['wealth', 'inflation']);

    // Lebensereignisse dürfen auf Endzeilen liegen, Finanzmessungen dagegen nie.
    for (const person of [1, ...(context.hasPartner ? [2] : [])]) {
        const active = `CareP${person}_Active`, grade = `CareP${person}_Grade`, alive = `Person${person}Alive`;
        const personName = context.personNames[person - 1];
        let prior = null;
        const lifeRows = rows.map(item => ({ ...item, financial: !['missing_row', 'technical_error'].includes(item.recordType) }));
        for (const phase of collectPhases(lifeRows, item => ({ value: bit(item.row[active]),
            grade: item.row[grade] ?? null, costNominalEur: amount(item.row[`CareP${person}_Cost`]) }))) {
            const before = rows[phase.first.rowIndex - 1];
            add('care_phase', phase.first, { ...phaseEvidence(phase), person, personName,
                onsetObserved: adjacent(before, phase.first) && bit(before.row[active]) === 0 }, ['life']);
        }
        for (const item of rows) {
            if (['missing_row', 'technical_error'].includes(item.recordType)) { prior = null; continue; }
            const contiguous = adjacent(prior, item);
            if (bit(item.row[alive]) === null || bit(item.row[active]) === null) missing(`life.person${person}`, item);
            if (contiguous && bit(prior.row[alive]) === 1 && bit(item.row[alive]) === 0)
                add('person_death', item, { person, personName, fromAlive: 1, toAlive: 0 }, ['life']);
            else if ((!contiguous || bit(prior.row[alive]) === null) && bit(item.row[alive]) === 0)
                add('life_state_observation', item, { person, personName, alive: 0, deathYearKnown: false }, ['life']);
            if (contiguous && bit(prior.row[active]) === 1 && bit(item.row[active]) === 1
                && stateKnown(prior.row[grade]) && stateKnown(item.row[grade]) && prior.row[grade] !== item.row[grade])
                add('care_grade_change', item, { person, personName, from: prior.row[grade], to: item.row[grade] }, ['life']);
            prior = item;
        }
    }
    for (const item of rows) {
        const row = item.row;
        if (item.recordType === 'terminal_death') add('household_end', item, { reason: 'all_persons_deceased' }, ['life']);
        if (item.recordType === 'technical_error') add('technical_error', item, { reason: row.reason ?? null }, ['mcRuin']);
        if (item.recordType === 'terminal_ruin') {
            const reason = context.kind === 'backtest' ? context.outcome?.reason ?? row.GuardNote ?? null : null;
            add('ruin', item, { reason, causeAvailable: !!reason }, [context.kind === 'backtest' ? 'ruin' : 'mcRuin']);
        }
        if (context.kind === 'backtest' && amount(row.floor_shortfall_nominal) > 0)
            addAmount('floor_shortfall', item, row.floor_shortfall_nominal, ['ruin'], {
                requiredNominalEur: amount(row.floor_coverage_required_nominal), coveredNominalEur: amount(row.floor_coverage_covered_nominal) });
        if (row.tailRiskApplied === true) add('tail_risk_overlay', item, { eventId: row.tailRiskEventId ?? null,
            returnShockPct: finite(row.tailRiskReturnShockPct) ? row.tailRiskReturnShockPct : null,
            inflationShockPct: finite(row.tailRiskInflationShockPct) ? row.tailRiskInflationShockPct : null }, ['stress']);
        else if (row.tailRiskApplied === false && row.tailRiskActive === true && row.tailRiskSkippedReason)
            add('tail_risk_skipped', item, { eventId: row.tailRiskEventId ?? null, reason: row.tailRiskSkippedReason }, ['stress']);
        if (item.financial && typeof row.tailRiskApplied !== 'boolean') missing('stress', item);
    }
    if (context.outcome?.kind === 'ruin' && !events.some(event => event.type === 'ruin')) {
        const item = rows.find(item => item.year === context.outcome.ruinYear);
        add('ruin', item, { reason: context.kind === 'backtest' ? context.outcome.reason ?? null : null,
            causeAvailable: context.kind === 'backtest' && !!context.outcome.reason }, [context.kind === 'backtest' ? 'ruin' : 'mcRuin']);
        events.at(-1).year = context.outcome.ruinYear ?? null;
    }
    if (context.outcome?.kind === 'technical_error' && !events.some(event => event.type === 'technical_error'))
        add('technical_error', null, { reason: context.outcome.error?.message ?? null }, [context.kind === 'backtest' ? 'ruin' : 'mcRuin']);
    const floorCovered = ['completed', 'no_ruin', 'all_dead'].includes(context.outcome?.kind)
        && !events.some(event => ['ruin', 'floor_shortfall', 'technical_error'].includes(event.type)) && financial.length > 0;
    if (floorCovered) add('floor_covered', financial[0], { years: financial.length }, [context.kind === 'backtest' ? 'ruin' : 'mcRuin']);

    const model = {
        schemaVersion: 'LogAnalysisV1', ruleVersion: LOG_ANALYSIS_RULE_VERSION,
        source: context.kind, sourceIdentity: context.sourceIdentity, moneyBasis,
        available: context.available, outcome: context.outcome, financialYears: financial.length,
        terminalRows: rows.filter(item => !item.financial).map(item => ({ rowIndex: item.rowIndex, year: item.year, recordType: item.recordType })),
        minimumFlex: { ...minimumFlex, observedBelowYears: financial.filter(item => readMinimumFlexYear(item.row)?.below).length },
        cuts: { observedYears: cutPhases.reduce((sum, phase) => sum + phase.durationYears, 0),
            longestYears: cutPhases.reduce((best, phase) => Math.max(best, phase.durationYears), 0),
            missingYears: missingness.decisionCuts?.length ?? 0 },
        floorCovered, missingness,
        realEndWealth: financial.at(-1)?.realWealthEur ?? null,
        nominalEndWealth: financial.at(-1)?.nominalWealthEur ?? null,
        terminalWealthNominalEur: context.terminalWealthNominalEur,
        initialWealthEur: context.initialWealthEur,
        yearRange: { start: financial[0]?.year ?? null, end: financial.at(-1)?.year ?? null },
        events: events.map(event => ({ ...event, ...describeLogAnalysisEvent(event, context) }))
    };
    // Chronologische Belege und priorisierte Auswahl sind zwei getrennte Ansichten.
    model.events.sort((a, b) => (a.rowIndex ?? Infinity) - (b.rowIndex ?? Infinity) || a.priority - b.priority || a.id.localeCompare(b.id));
    model.prioritizedEvents = [...model.events].sort((a, b) => a.priority - b.priority
        || (b.evidence.durationYears ?? 0) - (a.evidence.durationYears ?? 0)
        || (b.evidence.amount?.nominalEur ?? 0) - (a.evidence.amount?.nominalEur ?? 0)
        || (a.rowIndex ?? Infinity) - (b.rowIndex ?? Infinity));
    model.summarySentences = summarizeLogAnalysis(model);
    model.summary = model.summarySentences.join(' ');
    return model;
}

export const analyzeBacktest = (result, options) => analyzeLogEvents(adaptBacktestResult(result, options));
export const analyzeScenario = (scenario, options) => analyzeLogEvents(adaptScenarioLog(scenario, options));
export const analyzeMonteCarloScenario = (logs, selection, options) => analyzeLogEvents(adaptMonteCarloScenario(logs, selection, options));
