
import { MarketAnalyzer } from '../engine/analyzers/MarketAnalyzer.mjs';
import { getStartYearCandidates } from '../app/shared/cape-utils.js';
import { HISTORICAL_DATA, annualData } from '../app/simulator/simulator-data.js';

console.log('--- Market Analyzer Tests ---');

function assertReasonCount(result, reason, expected, message) {
    assertEqual(result.reasons.filter(entry => entry === reason).length, expected, message);
}

// --- Helper: Basic Input Data ---
function getBaseMarketInput() {
    return {
        endeVJ: 100,
        endeVJ_1: 90,
        endeVJ_2: 85,
        endeVJ_3: 80,
        ath: 100,
        jahreSeitAth: 0,
        inflation: 2.0,
        capeRatio: 20
    };
}

// --- TEST 1: ATH & Scenario Detection ---
{
    // Case 1: New ATH (Stable)
    const inputPeak = getBaseMarketInput();
    inputPeak.endeVJ = 100;
    inputPeak.ath = 100;
    inputPeak.endeVJ_1 = 95; // Perf 5%

    const resPeak = MarketAnalyzer.analyzeMarket(inputPeak);
    assert(resPeak.sKey === 'peak_stable', `Expect peak_stable, got ${resPeak.sKey}`);
    assertEqual(resPeak.marketDataStatus, 'complete', 'Peak input should have complete market data');
    assertClose(resPeak.abstandVomAthProzent, 0, 0.1, 'ATH distance 0%');

    // Case 2: Deep Bear (30% Drawdown)
    const inputBear = getBaseMarketInput();
    inputBear.endeVJ = 70;
    inputBear.ath = 100;
    inputBear.jahreSeitAth = 1;

    const resBear = MarketAnalyzer.analyzeMarket(inputBear);
    assert(resBear.sKey === 'bear_deep', `Expect bear_deep, got ${resBear.sKey}`);
    assertEqual(resBear.marketDataStatus, 'complete', 'Bear input should have complete market data');
    assertClose(resBear.abstandVomAthProzent, 30, 0.1, 'ATH distance 30%');
    assertClose(resBear.regimeSignalSeverities.drawdownSeverity, 1, 1e-12, 'MarketAnalyzer exposes drawdown severity without changing regime');
    assertEqual(resBear.regimeSmoothingFactors.drawdownSeverity.source, 'abstandVomAthProzent', 'MarketAnalyzer exposes drawdown smoothing source');

    console.log('✅ Scenario Detection Logic Passed');
}

const marketPhaseCases = [
    [7, 15, 12, 'corr_young', 'Hoch im laufenden Jahr, seitdem gefallen'],
    [11.94, 15, 12, 'corr_young', 'Hoch im laufenden Jahr, seitdem gefallen'],
    [11.95, 15, 12, 'recovery', 'Starkes Momentum nach Korrektur'],
    [14, 15, 12, 'recovery', 'Starkes Momentum nach Korrektur'],
    [4, 12, 12, 'corr_young', 'Kürzliche, leichte Korrektur'],
    [8, 25, 12, 'bear_deep', 'ATH-Abstand > 20% (25.0%)'],
    [9, 18, 16, 'recovery_in_bear', 'Starkes Momentum nach Korrektur'],
    [9, 18, 12, 'recovery_in_bear', 'Starkes Momentum nach Korrektur', 60],
    [0, 15, 12, 'recovery', 'Starkes Momentum nach Korrektur']
];
for (const [months, drawdown, performance, phase, reason, earlierLow] of marketPhaseCases) {
    const endeVJ = 100 - drawdown;
    const endeVJ_1 = endeVJ / (1 + performance / 100);
    const result = MarketAnalyzer.analyzeMarket({ ...getBaseMarketInput(), endeVJ, endeVJ_1,
        endeVJ_2: earlierLow ?? endeVJ_1, endeVJ_3: endeVJ_1, jahreSeitAth: months / 12 });
    const context = `FR-90: Hochalter ${months} Monate, Abstand ${drawdown} %, Jahresplus ${performance} %`;
    assertEqual(result.sKey, phase, context);
    assertEqual(result.reasons[0], reason, `${context}, Begründung`);
}

// --- TEST 2: Missing and Partial Market Data Contract ---
{
    const missing = MarketAnalyzer.analyzeMarket({
        endeVJ: 0,
        endeVJ_1: 0,
        endeVJ_2: 0,
        endeVJ_3: 0,
        ath: 0,
        jahreSeitAth: 0,
        inflation: 2,
        capeRatio: 36
    });
    assertEqual(missing.marketDataStatus, 'missing', 'All-zero prices should be marked missing');
    assertEqual(missing.sKey, 'side_long', 'Missing market data should use side_long fallback');
    assertEqual(missing.abstandVomAthProzent, null, 'Missing ATH distance should remain unknown');
    assertEqual(missing.seiATH, null, 'Missing ATH ratio should remain unknown');
    assertEqual(missing.perf1Y, 0, 'Missing performance basis should return neutral diagnostic value');
    assert(!missing.reasons.includes('Neues Allzeithoch'), 'Missing market data must not diagnose a new ATH');
    assert(!missing.reasons.some(reason => reason.includes('Momentum') || reason.includes('Erholung')), 'Missing market data must not diagnose momentum or recovery');
    assertReasonCount(missing, 'Marktdaten fehlen; neutraler Fallback aktiv', 1, 'Missing-data reason should occur exactly once');
    assertEqual(missing.valuationSignal, 'extreme_overvalued', 'Valid CAPE should remain independent from missing prices');
    assertEqual(missing.regimeSmoothingFactors.drawdownSeverity.rawValue, null, 'Missing drawdown should stay unknown in smoothing diagnostics');

    const missingCurrent = MarketAnalyzer.analyzeMarket({
        ...getBaseMarketInput(),
        endeVJ: 0
    });
    assertEqual(missingCurrent.marketDataStatus, 'missing', 'Invalid current value should dominate otherwise complete data');
    assertEqual(missingCurrent.sKey, 'side_long', 'Missing current value should use side_long fallback');
    assertEqual(missingCurrent.perf1Y, 0, 'Missing current value should suppress performance calculation');

    const missingCurrentOnly = MarketAnalyzer.analyzeMarket({
        ...getBaseMarketInput(),
        ath: 0,
        endeVJ_1: 0
    });
    assertEqual(missingCurrentOnly.marketDataStatus, 'missing', 'Current value without ATH and previous value should be missing');
    assertReasonCount(missingCurrentOnly, 'Marktdaten fehlen; neutraler Fallback aktiv', 1, 'Current-only input should emit missing reason exactly once');

    const partialAth = MarketAnalyzer.analyzeMarket({
        ...getBaseMarketInput(),
        endeVJ: 70,
        endeVJ_1: 0,
        ath: 100,
        jahreSeitAth: 1
    });
    assertEqual(partialAth.marketDataStatus, 'partial', 'Current value plus ATH should be partial without previous value');
    assertEqual(partialAth.sKey, 'bear_deep', 'Partial ATH basis should still allow drawdown classification');
    assertClose(partialAth.abstandVomAthProzent, 30, 0.1, 'Partial ATH basis should calculate drawdown');
    assertEqual(partialAth.perf1Y, 0, 'Partial ATH basis should not invent momentum');
    assert(!partialAth.reasons.some(reason => reason.includes('Momentum') || reason.includes('Erholung')), 'Partial ATH basis should not diagnose momentum or recovery');

    const partialPrevious = MarketAnalyzer.analyzeMarket({
        ...getBaseMarketInput(),
        endeVJ: 90,
        endeVJ_1: 75,
        ath: 0
    });
    assertEqual(partialPrevious.marketDataStatus, 'partial', 'Current plus previous value should be partial without ATH');
    assertEqual(partialPrevious.sKey, 'side_long', 'Partial input without ATH should use side_long fallback');
    assertClose(partialPrevious.perf1Y, 20, 0.001, 'Partial input may expose performance as diagnosis');
    assertEqual(partialPrevious.abstandVomAthProzent, null, 'Partial input without ATH should keep drawdown unknown');
    assertEqual(partialPrevious.seiATH, null, 'Partial input without ATH should keep ATH ratio unknown');
    assert(!partialPrevious.reasons.some(reason => reason.includes('Momentum') || reason.includes('Erholung')), 'Performance-only diagnosis must not drive momentum regime');

    console.log('✅ Missing and Partial Market Data Contract Passed');
}

// --- TEST 3: CAPE Valuation Analysis ---
{
    const input = getBaseMarketInput();

    // Case 1: Undervalued (e.g. 10)
    input.capeRatio = 10;
    const resUnder = MarketAnalyzer.analyzeMarket(input);
    assert(resUnder.valuationSignal === 'undervalued', 'Expect undervalued');

    // Case 2: Overvalued (Threshold is 30)
    input.capeRatio = 31;
    const resOver = MarketAnalyzer.analyzeMarket(input);
    assert(resOver.valuationSignal === 'overvalued', `Expect overvalued for CAPE 31 (Got ${resOver.valuationSignal})`);
    assertClose(resOver.regimeSignalSeverities.capeSeverity, 0.6, 1e-12, 'MarketAnalyzer exposes CAPE severity');

    // Case 3: Extreme (e.g. 36)
    input.capeRatio = 36;
    const resExt = MarketAnalyzer.analyzeMarket(input);
    assert(resExt.valuationSignal === 'extreme_overvalued', 'Expect extreme_overvalued');

    console.log('✅ CAPE Valuation Logic Passed');
}

// --- TEST 4: CAPE Utils (Historical Filtering) ---
{
    // Test getStartYearCandidates using real HISTORICAL_DATA (if available)
    // Check if 2000 is returned for High CAPE
    if (HISTORICAL_DATA && Object.keys(HISTORICAL_DATA).length > 0) {

        // Mock data structure expected by util: Array of objects {jahr, ...}
        // Actually, getStartYearCandidates expects `data` to be annualData array (for valid years list)
        // and uses HISTORICAL_DATA global for values. 
        // We can pass a mock "valid years list" as data.
        const mockData = Object.keys(HISTORICAL_DATA).map(y => ({ jahr: parseInt(y) }));

        // Target CAPE 30 (Dotcom bubble level)
        const candidatesHigh = getStartYearCandidates(30, mockData, 0.2); // 24-36 range

        // Check known years: 1929 or 2000 approx?
        // 2000 CAPE was ~44(?). 1929 ~30.
        // Let's explicitly check years we know.
        // Or just ensure we get SOME years.

        // Let's try Target 15 (Average).
        const candidatesAvg = getStartYearCandidates(15, mockData, 0.2); // 12-18
        assert(candidatesAvg.length > 0, 'Should find years for CAPE 15');

        // Target 99 (Unrealistic) -> Should trigger fallback to Wide or All
        const candidatesNone = getStartYearCandidates(99, mockData, 0.1);
        // 89-109. Likely none. Fallback logic: Wide -> All?
        // Fallback: If < 5 candidates, try wide (0.5). 99 +/- 50% = 49-148. Still none?
        // If wide empty -> returns ALL validYears.
        assert(candidatesNone.length === mockData.length, 'Should fallback to ALL years for impossible CAPE');

        console.log('✅ CAPE Utils Filtering Passed');

    } else {
        console.warn('⚠️ Skipped CAPE Utils checks (HISTORICAL_DATA missing)');
    }
}

console.log('--- Market Analyzer Tests Completed ---');
