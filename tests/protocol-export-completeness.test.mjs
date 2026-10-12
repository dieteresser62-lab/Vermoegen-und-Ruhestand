import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { captureHistoricalBacktestEngineProvenance, createHistoricalBacktestDownload } from '../app/simulator/historical-backtest-export.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderWorstRunLog } from '../app/simulator/simulator-results.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';

// Vollständiger synthetischer Jahreszeuge mit den bisherigen Log-/Detail-/Pflege-/Guardfeldern.
// Der Zusatzdiagnosezweig ist bewusst keine sichtbare Tabellenspalte.
const source = {
    recordType: 'financial_year', financiallyEvaluable: true, jahr: 1, histJahr: 1974, inflation: 2.75,
    entscheidung: { jahresEntnahme: 12345.67, kuerzungProzent: 20, details: { minimumFlexEffectiveFinal: 2345, minimumFlexEffectiveBefore: 2500, reason: 'synthetisch' } },
    RealReturnEquityPct: -.2, RealReturnGoldPct: .1, NominalReturnEquityPct: -.125, NominalReturnGoldPct: .05,
    entnahmequote: .0345, QuoteEndPct: 3.25, floor_brutto: 20000, floor_aus_depot: 8000,
    rente1: 8000, rente2: 4000, renteSum: 12000, FlexRatePct: 75, MinFlexRatePct: 60, WealthRedF: 20, WealthQuoteUsedPct: 5,
    flex_erfuellt_nominal: 8000, flex_haushalt_erfuellt: 9000, flex_haushalt_kuerzung_pct: 20,
    minimumFlexAnnual: 3000, minimumFlexEffectiveBefore: 2800, minimumFlexEffectiveAfter: 2500, minimumFlexEffectiveFinal: 2200,
    minimumFlexPolicyEffectiveAnnualEur: 2345, minimumFlexFulfilledAnnualEur: 2200, minimumFlexShortfallAnnual: 800,
    minimumFlexStatus: 'fulfilled', minimumFlexBlockReason: 'synthetisch',
    entnahme_plan: 12000, entnahme_effektiv: 11000, vpw_total: 25000, vpw_dynamic_flex: 5000, static_flex_baseline: 9000,
    vpw: { vpwRate: .0345, horizonYears: 25, status: 'active', safetyStage: 1, capeRatioUsed: 25.15,
        returnPolicy: 'cape_continuous', expectedReturnSource: 'synthetisch', capeInputStatus: 'present',
        expectedReturnCape: .05, expectedRealReturn: .04, expectedRealReturnRaw: .06, expectedRealReturnClamped: .04,
        safeRealReturn: .01, safeRealReturnSource: 'synthetisch' },
    jahresentnahme_real: 10500, Regime: 'bear', aktionUndGrund: 'Verkauf; "synthetisch"\nFortsetzung', CutReason: 'safety', Alarm: true,
    RunwayCoveragePct: 75, RunwayTargetSmoothedMonths: 36, RunwayTargetSeverityPct: 20,
    runway_after_transaction_before_payout_months: 30, runway_post_payout_end_of_year_months: 24,
    RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePostPayoutEndOfYearPct: 65,
    netTradeEq: -1200, netTradeGold: 100, vk: { vkAkt: 1000, vkGld: 500 }, kaufAkt: 2200, kaufGld: 400,
    steuern_gesamt: 100, wertAktien: 80000, wertGold: 10000, liquiditaet: 20000, bondBucketAfter: 10000,
    threeBucket: { bondSaleAmount: 2000, bondRefillGross: 3500, bondRefillNet: 3000, bondBucketAfter: 10000 },
    lossCarryEnd: 120, taxSavedByLossCarry: 30, liq_before_payout: 30000, liq_after_payout: 19000, liq_after_interest: 20000,
    portfolio_total_start: 130000, portfolio_total_before_payout: 124000, portfolio_active_end: 110000,
    portfolio_total_end: 113000, portfolio_flow_delta: 0,
    balance_trace: [{ phase: 'after_action_sales', total: 125000 }, { phase: 'after_payout', total: 114000 }, { phase: 'after_bond_refill', total: 113000 }],
    health_bucket_start: 3000, health_bucket_used: 100, health_bucket_interest: 100, health_bucket_end: 3000,
    health_bucket_target_inflation_adjusted: 6000, health_bucket_real_coverage_pct: 50, health_bucket_target_gap: 3000,
    health_bucket_triggered: true, health_bucket_warning: 'synthetisch', liqStart: 19000, cashInterestEarned: 1000, liqEnd: 20000, zielLiquiditaet: 36000,
    RunwayTargetRawMonths: 40, RunwayTargetHardMinMonths: 12, RunwayTargetSmoothingFallback: false,
    NeedLiq: 1200, GuardGold: 100, GuardEq: 1100, GuardNote: 'synthetisch',
    eq_before_return: 90000, eq_after_return: 81000, eq_after_sales: 80000, eq_after_buys: 80000,
    gold_before_return: 10000, gold_after_return: 10500, gold_after_sales: 10000, gold_after_buys: 10000,
    Person1Alive: 1, Person2Alive: 0, pflege_aktiv: true, pflege_grade: 2, pflege_grade_label: 'synthetisch',
    pflege_zusatz_floor: 5000, pflege_zusatz_floor_delta: 1000, pflege_flex_faktor: .75, pflege_kumuliert: 15000,
    pflege_floor_anchor: 20000, pflege_maxfloor_anchor: 30000, pflege_cap_zusatz: 10000, pflege_delta_flex: -1000,
    CareP1_Active: 1, CareP1_Cost: 5000, CareP1_Grade: 2, CareP1_GradeLabel: 'synthetisch',
    CareP2_Active: 0, CareP2_Cost: 0, CareP2_Grade: null, CareP2_GradeLabel: '',
    tailRiskActive: true, tailRiskApplied: true, tailRiskSkippedReason: null, tailRiskEventType: 'synthetisch',
    tailRiskEventId: 'synthetisch', tailRiskEventYearOffset: 0, tailRiskReturnShockPct: -5, tailRiskInflationShockPct: 2,
    tailRiskHistoricalReturnPct: -7.5, tailRiskEffectiveReturnPct: -12.5, tailRiskHistoricalInflationPct: .75,
    tailRiskEffectiveInflationPct: 2.75, tailRiskHistoricalCrisis: true, tailRiskHistoricalCrisisReasons: 'synthetisch',
    additionalInvisibleDiagnostic: { zero: 0, missing: null, enabled: false, levels: [{ text: '<img onerror="x">', values: [1.005, -2, null] }] }
};
const rows = [source, { ...structuredClone(source), jahr: 2, Regime: 'accumulation' },
    { ...structuredClone(source), jahr: 3, recordType: 'terminal_ruin', financiallyEvaluable: false },
    { ...structuredClone(source), jahr: 4, recordType: 'terminal_death', financiallyEvaluable: false }];
const before = JSON.stringify(rows);
const semanticFields = {
    RealReturnEquityPct: 'realReturnEquityRatio', RealReturnGoldPct: 'realReturnGoldRatio',
    NominalReturnEquityPct: 'nominalReturnEquityRatio', NominalReturnGoldPct: 'nominalReturnGoldRatio',
    entnahmequote: 'realizedWithdrawalRatePct', QuoteEndPct: 'preDecisionWithdrawalRatePct',
    minimumFlexAnnual: 'minimumFlexConfiguredAnnualEur', minimumFlexPolicyEffectiveAnnualEur: 'minimumFlexPolicyEffectiveAnnualEur',
    minimumFlexFulfilledAnnualEur: 'minimumFlexFulfilledAnnualEur'
};
function expectedRecord(row) {
    const expected = structuredClone(row), financial = row.recordType === 'financial_year', withdrawal = financial && row.Regime !== 'accumulation';
    for (const key of [...Object.keys(semanticFields), 'minimumFlexEffectiveBefore', 'minimumFlexEffectiveAfter', 'minimumFlexEffectiveFinal']) delete expected[key];
    delete expected.entscheidung.details.minimumFlexEffectiveFinal;
    for (const [from, to] of Object.entries(semanticFields)) {
        expected[to] = (to.includes('Return') ? financial : withdrawal) ? row[from] * (from === 'entnahmequote' ? 100 : 1) : null;
    }
    const state = (applicable, count) => ({ reason: !financial ? 'not_applicable_terminal_record' : !applicable ? 'not_applicable_accumulation_year' : null,
        observationCount: { observations: applicable ? count : 0 } });
    expected.measurementMissingness = { returnRatios: state(financial, 4), withdrawalRates: state(withdrawal, 2), minimumFlex: state(withdrawal, 3) };
    return expected;
}
function recursiveEqual(actual, expected, path) {
    if (expected !== null && typeof expected === 'object') {
        assert(actual !== null && typeof actual === 'object', `${path}: Objekt erhalten`);
        assertEqual(Array.isArray(actual), Array.isArray(expected), `${path}: Array-/Objektvertrag erhalten`);
        assertEqual(Object.keys(actual).sort().join(','), Object.keys(expected).sort().join(','), `${path}: vollständige rekursive Schlüsselmenge`);
        for (const key of Object.keys(expected)) recursiveEqual(actual[key], expected[key], `${path}.${key}`);
    } else assertEqual(actual, expected, `${path}: unveränderter Rohwert beziehungsweise explizite V2-Semantik`);
}
const document = projectScenarioLogV2(rows);
recursiveEqual(JSON.parse(serializeScenarioLogExportV2(document)).records, rows.map(expectedRecord), 'MC.records');
const baselineJson = serializeScenarioLogExportV2(document), baselineCsv = serializeScenarioLogCsvV2(document);
assert(baselineCsv.split('\r\n')[0].split(';').includes('additionalInvisibleDiagnostic'), 'CSV enthält auch die unsichtbare Zusatzdiagnose');
assert(baselineCsv.includes('minimumFlexConfiguredAnnualEur') && !baselineCsv.split('\r\n')[0].split(';').includes('minimumFlexAnnual'), 'CSV verwendet ausschließlich die vorhandenen V2-Namen');

const provenance = captureHistoricalBacktestEngineProvenance(EngineAPI, { schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40), sourceTreeStatus: 'clean', provider: 'synthetic_fixture' });
const backtestRows = rows.map((row, index) => ({ jahr: 2000 + index, row, entscheidung: row.entscheidung,
    wertAktien: row.wertAktien, wertGold: row.wertGold, liquiditaet: row.liquiditaet, netA: -1200, netG: 100, vpw: row.vpw,
    vpwFallbackHint: 'synthetisch', adjPct: 2, inflationVJ: 2.75, additionalOuterDiagnostic: { retained: true } }));
const result = { schemaVersion: 'BacktestRunResultV1', outcome: { kind: 'completed' }, rows: backtestRows,
    request: { startYear: 2000, endYear: 2003, engine: provenance, inputs: { startAlter: 62 } }, requestedYears: 4, completedYears: 4,
    metrics: { values: { wealth_start_nominal_eur: 130000, wealth_end_nominal_eur: 113000 } } };
const exportedAt = '2026-01-01T00:00:00.000Z';
const btJson = createHistoricalBacktestDownload(result, 'json', { exportedAt }).content;
const btCsv = createHistoricalBacktestDownload(result, 'csv', { exportedAt }).content;
recursiveEqual(JSON.parse(btJson).result.rows, backtestRows, 'Backtest.result.rows');
for (const caRThreshold of [undefined, 5000, 20000]) for (const logDetailLevel of ['normal', 'detailed']) for (const showCareDetails of [false, true]) {
    const options = { logDetailLevel, showCareDetails, strategyMode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE, startYear: 2026, inputs: { startAlter: 62 } };
    renderWorstRunLog(rows, caRThreshold, options);
    renderProtocolTable(backtestRows, { ...options, source: 'backtest', startYear: 2000, caRThreshold });
    assertEqual(serializeScenarioLogExportV2(projectScenarioLogV2(rows)), baselineJson, `${logDetailLevel}/${showCareDetails}: vollständiger MC-JSON-Inhalt unverändert`);
    assertEqual(serializeScenarioLogCsvV2(projectScenarioLogV2(rows)), baselineCsv, `${logDetailLevel}/${showCareDetails}: vollständiger MC-CSV-Inhalt unverändert`);
    assertEqual(createHistoricalBacktestDownload(result, 'json', { exportedAt }).content, btJson, `${logDetailLevel}/${showCareDetails}: kanonischer Backtest-JSON-Download unverändert`);
    assertEqual(createHistoricalBacktestDownload(result, 'csv', { exportedAt }).content, btCsv, `${logDetailLevel}/${showCareDetails}: kanonischer Backtest-CSV-Download unverändert`);
}
assertEqual(JSON.stringify(rows), before, 'Sämtliche Finanz-, Anspar-, Ruin- und Todesrohfelder bleiben unangetastet');
// Policy-/Erfüllungsfallback sind getrennt und behalten die bestehende Kollisionsregel.
const fallback = structuredClone(source); delete fallback.minimumFlexPolicyEffectiveAnnualEur; delete fallback.minimumFlexFulfilledAnnualEur;
const fallbackRecord = projectScenarioLogV2([fallback]).records[0];
assertEqual(fallbackRecord.minimumFlexPolicyEffectiveAnnualEur, 2345, 'Policyfallback kommt aus entscheidung.details');
assertEqual(fallbackRecord.minimumFlexFulfilledAnnualEur, 2200, 'Erfüllungsfallback kommt aus dem bisherigen finalen Rohfeld');
assert(!Object.hasOwn(fallbackRecord.entscheidung.details, 'minimumFlexEffectiveFinal'), 'Kollidierender alter Alias wird nicht wieder eingeführt');

// Derselbe Laufkontext begleitet alle Projektionen; Finanzorakel bleiben vollständig.
const personDataContext = { schemaVersion: 1, referenceYear: 2027, ageRule: 'january-1-completed-years', deviationApplied: true,
    persons: [{ profileId: 'synthetisch;"<&>\nA', role: 'primary', ageStatus: 'valid', profileAgeStatus: 'fallback', changes: [{ field: 'profile_geburtsdatum', profileValue: '', effectiveValue: '1958-01-01' }] }], sharedPensionAdjustment: { sourceProfileId: 'synthetisch;"<&>\nA', mode: 'wage', percent: null } };
function parseCsv(text) {
    const lines = [[]]; let value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
        else if (c === ';' && !quoted) { lines.at(-1).push(value); value = ''; }
        else if (c === '\n' && !quoted) { lines.at(-1).push(value.replace(/\r$/, '')); value = ''; lines.push([]); }
        else value += c;
    }
    lines.at(-1).push(value); return lines;
}
for (const logRows of [rows, [rows[2]], [rows[3]], []]) {
    const withContext = projectScenarioLogV2(logRows, { personDataContext });
    const contextJson = JSON.parse(serializeScenarioLogExportV2(withContext));
    recursiveEqual(contextJson.records, logRows.map(expectedRecord), 'MC.mitPersonen.records');
    recursiveEqual(contextJson.personDataContext, personDataContext, 'Szenario/Worst/Pflege-Laufbeleg');
    const parsedCsv = parseCsv(serializeScenarioLogCsvV2(withContext));
    for (const key of ['personDataReferenceYear','personDataDeviationApplied','personDataChanges']) assert(parsedCsv[0].includes(key), 'Additive CSV-Kontextspalte auch bei leerem Lauf: ' + key);
    for (const line of parsedCsv.slice(1)) {
        assertEqual(line[parsedCsv[0].indexOf('personDataReferenceYear')], '2027', 'CSV-Jahr stammt aus Laufbeleg');
        assertEqual(line[parsedCsv[0].indexOf('personDataDeviationApplied')], 'true', 'CSV-Abweichungsflag erhalten');
        recursiveEqual(JSON.parse(line[parsedCsv[0].indexOf('personDataChanges')]), personDataContext.persons, 'CSV-Sonderzeichen im Beleg verlustfrei');
    }
    assertEqual(parsedCsv.length - 1, logRows.length, 'Leere/terminale Fälle erfinden keine Finanzzeile');
}
const ctxDownload = createHistoricalBacktestDownload(result, 'json', { exportedAt, personDataContext });
recursiveEqual(JSON.parse(ctxDownload.content).result.rows, backtestRows, 'Backtest.mitPersonen.rows');
const oldBtCsv = parseCsv(btCsv), ctxBtCsv = parseCsv(createHistoricalBacktestDownload(result, 'csv', { exportedAt, personDataContext }).content);
for (let i = 1; i < oldBtCsv.length; i++) for (let col = 1; col < oldBtCsv[0].length; col++) assertEqual(ctxBtCsv[i][col], oldBtCsv[i][col], 'Alle alten Backtest-Finanzspalten bleiben unverändert: ' + oldBtCsv[0][col]);
recursiveEqual(JSON.parse(ctxBtCsv[1][ctxBtCsv[0].indexOf('personDataChanges')]), personDataContext.persons, 'Backtest-Kontext überlebt echtes CSV-Escaping');
