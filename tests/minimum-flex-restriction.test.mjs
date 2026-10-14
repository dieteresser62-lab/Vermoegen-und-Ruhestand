import { EngineAPI } from '../engine/index.mjs';
import { deriveMinimumFlexPath, buildMinimumFlexRestriction, summarizeMinimumFlexPaths } from '../app/simulator/minimum-flex-metrics.js';
import { deriveHistoricalBacktestMetrics, HISTORICAL_BACKTEST_METRIC_DESCRIPTOR_BY_ID } from '../app/simulator/historical-backtest-metrics.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { simulateOneYear, initMcRunState as initializePortfolio } from '../app/simulator/simulator-engine-direct.js';
import { initMcRunState, prepareHistoricalDataOnce, getDataVersion, compileScenario } from '../app/simulator/simulator-engine-helpers.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { runMonteCarloChunk, runMonteCarloSimulation, buildMonteCarloAggregates } from '../app/simulator/monte-carlo-runner.js';
import { annualData } from '../app/simulator/simulator-data.js';
import { createMonteCarloRunRequestV1, createMonteCarloRunResultV1, projectMonteCarloRunResultV2 } from '../app/simulator/monte-carlo-contracts.js';
import { MONTE_CARLO_MISSINGNESS_CODE as codes, createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1, finalizeMonteCarloChunkAccumulatorV1, assertMonteCarloChunkResultV1, recordMonteCarloPathSummaryV1 } from '../app/simulator/monte-carlo-chunk-result.js';

const row = (paid, minimum = 30000, desired = 45000) => ({
    recordType: 'financial_year', minimumFlexAnnual: minimum,
    flex_haushalt_erfuellt: paid, flex_wunsch_haushalt_nominal: desired,
    flex_brutto_haushalt: desired, flex_haushalt_basis: 'static_input'
});
const pathA = deriveMinimumFlexPath([row(40000), row(28000), row(35000)]);
assertEqual(pathA.affectedYearCount, 1, 'Nur 28.000 € liegen unter Mindest-Flex');
assertEqual(pathA.observationCount, 3, 'Alle drei Entnahmejahre stehen im Nenner');
assertClose(pathA.yearSharePct, 100 / 3, 1e-12, 'Einzelpfad: 33⅓ %');
assertEqual(pathA.paidMedianNominalEur, 35000, 'Typisch bezahlt: 35.000 €');
assertEqual(pathA.desiredMedianNominalEur, 45000, 'Wunsch: 45.000 €');
assertEqual(pathA.paidMinimumNominalEur, 28000, 'Schwächstes Jahr: 28.000 €');
const pathB = deriveMinimumFlexPath([row(30000), row(30000)]);
const multiple = buildMinimumFlexRestriction([pathA, pathB], 30000);
assertClose(multiple.yearSharePctP50, 100 / 6, 1e-12, 'Median der Pfadanteile: 16⅔ %');
assert(multiple.yearSharePctP50 !== 20, 'Gepoolter Jahresanteil ist ausgeschlossen');
assertEqual(multiple.affectedRunSharePct, 50, '50 % der Läufe sind betroffen');
assertEqual(multiple.paidMedianNominalEurP50, 32500, 'Median der Lauf-Mediane: 32.500 €');
assertEqual(multiple.paidMinimumNominalEurP50, 29000, 'Median der Lauf-Minima: 29.000 €');
assertEqual(multiple.observationCount.observedYears, 5, 'Beobachtungszahl bleibt erkennbar');
assertEqual(deriveMinimumFlexPath([row(0, 0), row(30000), row(32999.999, 33000)]).affectedYearCount, 1,
    'Mindest-Flex 0 und Gleichheit zählen nicht; strenger Vergleich ohne Cent-Toleranz');
const excluded = [{ ...row(0), Regime: 'accumulation' }, { ...row(0), recordType: 'terminal_death' },
    { ...row(0), recordType: 'terminal_ruin' }, { ...row(0), Regime: 'BANKRUPT' }];
assertEqual(JSON.stringify(deriveMinimumFlexPath([...excluded, row(40000), row(28000), row(35000)])),
    JSON.stringify(pathA), 'Anspar- und terminale Zeilen verändern weder Nenner noch Beträge');
assertEqual(deriveMinimumFlexPath(excluded).yearSharePct, null, 'Ohne Entnahmejahr keine erfundene 0-%-Aussage');
for (const field of ['minimumFlexAnnual', 'flex_haushalt_erfuellt', 'flex_wunsch_haushalt_nominal']) {
    for (const badValue of [undefined, null, NaN, Infinity, '', -1]) {
        const missing = deriveMinimumFlexPath([row(40000), { ...row(30000), [field]: badValue }]);
        assertEqual(missing.missingReason, 'missing_year_values', `${field}: fehlende Beträge bleiben fehlend`);
        assertEqual(missing.observationCount, 1, 'Eine vollständige Beobachtung bleibt dokumentiert');
        assertEqual(missing.yearSharePct, null, 'Unvollständiger Lauf liefert keinen günstigeren Anteil');
        assertEqual(missing.paidMedianNominalEur, null, 'Unvollständiger Lauf liefert keinen Teilmedian');
    }
}
const syntheticHistorical = {
    outcome: { kind: 'completed' }, request: { inputs: { minimumFlexAnnual: 30000 } },
    rows: [40000, 28000, 35000].map((paid, index) => ({ row: {
        ...row(paid), flex_haushalt_basis: index === 1 ? 'effective_vpw_plus_pension_surplus' : 'static_input'
    } }))
};
const historicalMetrics = deriveHistoricalBacktestMetrics(syntheticHistorical);
assertEqual(JSON.stringify(historicalMetrics.minimumFlexRestriction.path), JSON.stringify(pathA),
    'Historischer Pfad verwendet denselben Leser trotz wechselnder Zielbasis');
assertEqual(historicalMetrics.values.flex_reduction_years_gte_10_pct, null, 'Alter gemischter Kürzungsvertrag bleibt erhalten');
assertEqual(historicalMetrics.values.minimum_flex_restriction_years, 1, 'Neue historische Rohkennzahl hat denselben Zähler');
const ruinedHistorical = deriveHistoricalBacktestMetrics({ ...syntheticHistorical, outcome: { kind: 'ruin' },
    rows: [...syntheticHistorical.rows, { row: { Regime: 'BANKRUPT' } }] });
assertEqual(JSON.stringify(ruinedHistorical.minimumFlexRestriction.path), JSON.stringify(pathA),
    'Ruin behält beobachtete vorherige Entnahmejahre ohne terminale Null-Auszahlung');
const missingHistorical = deriveHistoricalBacktestMetrics({ ...syntheticHistorical,
    rows: [{ row: { ...row(0), flex_haushalt_erfuellt: null } }] });
assertEqual(missingHistorical.values.minimum_flex_restriction_share_pct, null,
    'Historische fehlende Auszahlung erzeugt keine scheinbar erfüllte Untergrenze');
assertEqual(buildMinimumFlexRestriction([pathA, deriveMinimumFlexPath([], { technicalError: true })], 30000).paidMedianNominalEurP50,
    null, 'Auch ein gemischter technischer Batch invalidiert neue Finanzwerte');
for (const id of ['minimum_flex_restriction_years', 'minimum_flex_restriction_share_pct',
    'minimum_flex_paid_median_nominal_eur', 'minimum_flex_desired_median_nominal_eur', 'minimum_flex_paid_minimum_nominal_eur']) {
    assert(HISTORICAL_BACKTEST_METRIC_DESCRIPTOR_BY_ID[id], `${id}: neuer Deskriptor vorhanden`);
}

const inputs = {
    startAlter: 65, geschlecht: 'm', startVermoegen: 1300000,
    depotwertAlt: 900000, einstandAlt: 720000, depotwertNeu: 0, einstandNeu: 0, tagesgeld: 400000,
    zielLiquiditaet: 50000, startFloorBedarf: 24000, startFlexBedarf: 45000, minimumFlexAnnual: 30000,
    flexBudgetAnnual: 0, flexBudgetRecharge: 0, targetEq: 60, rebalBand: 5,
    maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, runwayMinMonths: 24, runwayTargetMonths: 36,
    goldAktiv: false, goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: true,
    startSPB: 1000, kirchensteuerSatz: 0, rentAdjMode: 'fix', rentAdjPct: 0,
    renteAktiv: false, renteMonatlich: 0, renteStartOffsetJahre: 0, dynamicFlex: false,
    horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85,
    goGoActive: false, goGoMultiplier: 1, marketCapeRatio: 20, stressPreset: 'NONE',
    pflegefallLogikAktivieren: false, partner: { aktiv: false },
    accumulationPhase: { enabled: false }, transitionYear: 0, risikoprofil: 'sicherheits-dynamisch'
};
prepareHistoricalDataOnce();
let state = initMcRunState(inputs, 0);
const annualRows = [];
for (let index = 0; index < 2; index++) {
    const result = simulateOneYear(state, inputs, { jahr: 2000 + index, rendite: 0, gold_eur_perf: 0,
        zinssatz: 0, inflation: 10, capeRatio: 20 }, index, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Echter Jahrespfad läuft erfolgreich');
    annualRows.push(result.logData);
    state = result.newState;
}
assertEqual(annualRows[0].minimumFlexAnnual, 30000, 'Startjahr verwendet 30.000 €');
assertEqual(annualRows[1].minimumFlexAnnual, 33000, 'Folgejahr verwendet bereits fortgeschriebene 33.000 €');
assertClose(annualRows[1].flex_wunsch_haushalt_nominal, 49500, 1e-8, 'Wunsch-Flex kommt aus dem aufbereiteten Jahresinput');
const inflationComparison = annualRows.map((entry, index) => ({ ...entry, flex_haushalt_erfuellt: index ? 32000 : 40000 }));
assertEqual(deriveMinimumFlexPath(inflationComparison).affectedYearCount, 1, '32.000 € unter protokollierten 33.000 €');
inflationComparison[1].flex_haushalt_erfuellt = 33000;
assertEqual(deriveMinimumFlexPath(inflationComparison).affectedYearCount, 0, 'Genau 33.000 € sind erfüllt, ohne zweite Fortschreibung');
for (const entry of annualRows) {
    assertEqual(entry.flex_unter_mindestflex, entry.minimumFlexAnnual > 0 && entry.flex_haushalt_erfuellt < entry.minimumFlexAnnual,
        'Jahresmerkmal stimmt mit dem gemeinsamen Vergleich überein');
}
const pensionInputs = { ...inputs, renteAktiv: true, renteMonatlich: 4500 };
const pensionYear = simulateOneYear(initMcRunState(pensionInputs, 0), pensionInputs,
    { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, capeRatio: 20 }, 0, null, 0, null, 1, EngineAPI);
assertEqual(pensionYear.kind, 'success', 'Rentenüberschuss-Pfad ist erfolgreich');
assert(pensionYear.logData.flex_haushalt_erfuellt > pensionYear.logData.flex_erfuellt_nominal,
    'Gezahlter Haushalts-Flex enthält den Rentenbeitrag zusätzlich zum Depotflex');
assertEqual(deriveMinimumFlexPath([pensionYear.logData]).paidMedianNominalEur, pensionYear.logData.flex_haushalt_erfuellt,
    'Mindest-Auswertung verwendet den Haushaltsbetrag');
for (const minimum of [0, 45000]) {
    const coveredInputs = { ...pensionInputs, renteMonatlich: 5750, minimumFlexAnnual: minimum };
    const coveredYear = simulateOneYear(initMcRunState(coveredInputs, 0), coveredInputs,
        { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, capeRatio: 20 }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(coveredYear.logData.minimumFlexAnnual, minimum, 'Echte Jahresquelle erhält 0 bzw. Grenzgleichheit');
    assertEqual(coveredYear.logData.flex_haushalt_erfuellt, 45000, 'Rentenüberschuss erfüllt genau 45.000 € Haushalts-Flex');
    assertEqual(coveredYear.logData.flex_unter_mindestflex, false, 'Echtes Jahresmerkmal bleibt bei 0 und Grenzgleichheit negativ');
}

const historical = runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2002 },
    historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
    computeAdjustmentPct: () => 0, resolveHorizon: () => ({ horizonYears: 30 }), totalPortfolio: portfolioTotal,
    simulateYear: (s, i, y, n) => simulateOneYear(s, i, y, n, null, 0, null, 1, EngineAPI) });
assertEqual(historical.outcome.kind, 'completed', 'Echter historischer Dreijahrespfad ist erfolgreich');
assertClose(historical.portfolioEnd, 763461.6973450086, 1e-8, 'Backtest-Endvermögen bleibt gegenüber dem Basis-Commit unverändert');
assertClose(historical.summary.totalTaxes, 4080.145762565786, 1e-8, 'Backtest-Steuern bleiben gegenüber dem Basis-Commit unverändert');
assertEqual(JSON.stringify(historical.minimumFlexRestriction.path), JSON.stringify(deriveMinimumFlexPath(historical.rows)),
    'Echter Backtest reicht den identischen Jahresvertrag durch');

const monteCarloParams = { anzahl: 6, maxDauer: 5, blockSize: 5, seed: 87654, methode: 'block', rngMode: 'per-run-seed' };
const widowOptions = { enabled: false };
const chunk = await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling: false, engine: EngineAPI });
const referenceWealth = [1544731.084012704, 3059015.7017268026, 1029320.9289668835, 1365776.7017136544, 2050032.687092856, 1713502.1612978654];
const referenceTaxes = [15525.434168938064, 27352.82052600671, 7005.276385396084, 6547.155430744508, 30234.784064798536, 21609.863005624502];
for (let index = 0; index < 6; index++) {
    assertClose(chunk.buffers.finalOutcomes[index], referenceWealth[index], 1e-8, 'Kurzer MC-Pfad: Vermögen des Basis-Commits bleibt erhalten');
    assertClose(chunk.buffers.taxOutcomes[index], referenceTaxes[index], 1e-8, 'Kurzer MC-Pfad: Steuern des Basis-Commits bleiben erhalten');
}
const aggregate = value => buildMonteCarloAggregates({ inputs, totalRuns: 6, ...value });
const full = aggregate(chunk).minimumFlexRestriction;
const fromLogs = buildMinimumFlexRestriction(chunk.runMeta.map(meta => deriveMinimumFlexPath(meta.logDataRows)), inputs.minimumFlexAnnual);
assertEqual(JSON.stringify(full), JSON.stringify(fromLogs), 'Alle echten Laufstatistiken stimmen mit sämtlichen Jahreslogs überein');
const noLogChunk = await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling: false,
    engine: EngineAPI, logIndices: [] });
assertEqual(JSON.stringify(aggregate(noLogChunk).minimumFlexRestriction), JSON.stringify(full),
    'Neue Kennzahlen benötigen kein repräsentatives Szenario-Log');
const direct = await runMonteCarloSimulation({ inputs, monteCarloParams, widowOptions, useCapeSampling: false, engine: EngineAPI });
assertEqual(JSON.stringify(direct.aggregatedResults.minimumFlexRestriction), JSON.stringify(full), 'Direkter MC-Pfad führt alle Pfadstatistiken mit');
for (const cuts of [[1, 2, 3], [4, 2]]) {
    const accumulator = createMonteCarloChunkAccumulatorV1(6);
    let start = 0;
    const pieces = [];
    for (const count of cuts) {
        pieces.push(await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling: false,
            runRange: { start, count }, engine: EngineAPI, logIndices: [] }));
        start += count;
    }
    for (const piece of pieces.reverse()) mergeMonteCarloChunkResultV1(accumulator, structuredClone(piece));
    const merged = finalizeMonteCarloChunkAccumulatorV1(accumulator);
    assertEqual(JSON.stringify(aggregate(merged).minimumFlexRestriction), JSON.stringify(full),
        'Anderer Chunkzuschnitt und umgekehrte Merge-Reihenfolge liefern identische neue Aggregate');
    assertEqual(JSON.stringify(Array.from(merged.buffers.finalOutcomes)), JSON.stringify(Array.from(chunk.buffers.finalOutcomes)),
        'Chunkzuschnitt verändert keine Vermögenswerte');
}
// Mehrpfad-Rechenbeispiel und Missingness passieren auch die echte Chunkgrenze.
const synthetic = structuredClone(chunk);
const cases = [pathA, pathB, deriveMinimumFlexPath(excluded),
    deriveMinimumFlexPath([row(40000), { ...row(0), flex_haushalt_erfuellt: null }]), pathA, pathB];
for (let index = 0; index < cases.length; index++) recordMonteCarloPathSummaryV1({
    pathSummaries: synthetic.pathSummaries, pathMissingness: synthetic.pathMissingness, localIndex: index,
    globalRunIndex: index, outcomeCode: synthetic.pathSummaries.outcomeCode[index], minimumFlexRestriction: cases[index]
});
assertMonteCarloChunkResultV1(synthetic);
const syntheticBlock = summarizeMinimumFlexPaths(synthetic.pathSummaries, synthetic.pathMissingness, 6, codes, 30000);
assertEqual(syntheticBlock.sampleSize, 4, 'Nur vollständige Pfade sind auswertbar');
assertEqual(syntheticBlock.missingness.no_observations, 1, 'Leerer Pfad hat einen Fehlgrund');
assertEqual(syntheticBlock.missingness.missing_year_values, 1, 'Fehlende Jahresbeträge haben einen eigenen Fehlgrund');
assertClose(syntheticBlock.yearSharePctP50, multiple.yearSharePctP50, 1e-12, 'Mehrpfad-Beispiel passiert Float64-Chunkvertrag');
const syntheticAccumulator = createMonteCarloChunkAccumulatorV1(6);
for (const start of [3, 0]) {
    const part = await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling: false,
        runRange: { start, count: 3 }, engine: EngineAPI, logIndices: [] });
    for (let localIndex = 0; localIndex < 3; localIndex++) recordMonteCarloPathSummaryV1({
        pathSummaries: part.pathSummaries, pathMissingness: part.pathMissingness, localIndex,
        globalRunIndex: start + localIndex, outcomeCode: part.pathSummaries.outcomeCode[localIndex],
        minimumFlexRestriction: cases[start + localIndex]
    });
    mergeMonteCarloChunkResultV1(syntheticAccumulator, structuredClone(part));
}
assertEqual(JSON.stringify(aggregate(finalizeMonteCarloChunkAccumulatorV1(syntheticAccumulator)).minimumFlexRestriction),
    JSON.stringify(syntheticBlock), 'Zusammenführung erhält Mehrpfadwerte einschließlich Fehlgründen und Beobachtungszahl');
const badChunk = structuredClone(chunk);
badChunk.pathSummaries.minimumFlexYearShareRatio[0] = 0.99;
let rejected = false;
try { assertMonteCarloChunkResultV1(badChunk); } catch { rejected = true; }
assert(rejected, 'Widersprüchliche neue Chunkstatistiken werden abgewiesen');
const technical = await runMonteCarloChunk({ inputs, monteCarloParams, widowOptions, useCapeSampling: false,
    engine: { ...EngineAPI, simulateSingleYear() { throw new Error('synthetischer technischer Fehler'); } } });
assertEqual(technical.technicalInventory.technicalError, 6, 'Technischer Fehler bleibt invalidiert');
assertEqual(aggregate(technical).minimumFlexRestriction.yearSharePctP50, null, 'Technischer Batch liefert keinen zuverlässigen neuen Anteil');
assertEqual(aggregate(technical).minimumFlexRestriction.missingness.technical_error, 6, 'Technische Fehlgründe bleiben erhalten');

const { scenarioKey } = compileScenario(inputs, widowOptions, 'block', false, 'NONE');
const request = createMonteCarloRunRequestV1({ inputs, widowOptions, monteCarloParams, useCapeSampling: false,
    samplingDiagnostics: direct.samplingDiagnostics, dataVersion: getDataVersion(), execution: { mode: 'single' }, scenarioKey });
const v1 = createMonteCarloRunResultV1({ aggregatedResults: direct.aggregatedResults,
    samplingDiagnostics: direct.samplingDiagnostics, executionDiagnostics: request.execution });
assertEqual(JSON.stringify(v1.kpis.minimumFlexRestriction), JSON.stringify(full), 'V1-KPI-Projektion erhält den additiven Block');
assertEqual(JSON.stringify(projectMonteCarloRunResultV2(v1).kpis.minimumFlexRestriction), JSON.stringify(full),
    'V2-KPI-Projektion erhält den Block ohne zweite Rechnung');

// Wenige echte MC-Läufe: konstante reale Planbedarfe, positive Inflation,
// Rentenüberschuss und wahlweise VPW. Historische Quelldaten danach restaurieren.
const originalAnnualData = annualData.slice();
try {
    annualData.splice(0, annualData.length, ...originalAnnualData.map(year => ({
        ...year, inflation: 5, rendite: 0.08, zinssatz: 2, capeRatio: 20
    })));
    for (const dynamicFlex of [false, true]) {
        const syntheticInputs = { ...inputs, startVermoegen: 3000000, depotwertAlt: 2300000,
            einstandAlt: 1840000, tagesgeld: 700000, renteAktiv: true, renteMonatlich: 4500, dynamicFlex };
        const syntheticChunk = await runMonteCarloChunk({ inputs: syntheticInputs,
            monteCarloParams: { ...monteCarloParams, anzahl: 3, maxDauer: 4, blockSize: 2 },
            widowOptions, useCapeSampling: false, engine: EngineAPI });
        const syntheticMetrics = buildMonteCarloAggregates({ inputs: syntheticInputs, totalRuns: 3, ...syntheticChunk }).minimumFlexRestriction;
        assertEqual(syntheticMetrics.sampleSize, 3, 'Synthetischer Inflations-MC wertet alle drei Läufe aus');
        assertEqual(syntheticMetrics.observationCount.observedYears, 12, 'Bezahlter und Wunsch-Flex nutzen dieselben zwölf Entnahmejahre');
        for (const meta of syntheticChunk.runMeta) {
            meta.logDataRows.forEach((entry, index) => {
                assertClose(entry.flex_wunsch_haushalt_nominal, 45000 * 1.05 ** index, 1e-8,
                    'MC-Wunsch-Flex wird bei konstantem Realbedarf nominal mit 5 % fortgeschrieben');
                assertClose(entry.minimumFlexAnnual, 30000 * 1.05 ** index, 1e-8,
                    'MC-Mindest-Flex verwendet denselben nominalen Jahresfaktor');
                const pensionFlex = Math.max(0, 54000 - 24000 * 1.05 ** index);
                assertClose(entry.flex_haushalt_erfuellt, entry.flex_erfuellt_nominal + pensionFlex, 1e-8,
                    'MC-Haushalts-Ist enthält Depotflex und Rentenüberschuss genau einmal');
                assert(entry.flex_wunsch_haushalt_nominal > pensionFlex,
                    'MC-Wunsch-Flex ist der Brutto-Haushaltsplan vor Abzug des Rentenbeitrags');
                assert(dynamicFlex ? entry.flex_haushalt_erfuellt > entry.flex_wunsch_haushalt_nominal
                    : entry.flex_haushalt_erfuellt <= entry.flex_wunsch_haushalt_nominal,
                    'Nur aktives VPW darf im synthetischen MC mehr als den Wunsch-Flex laut Plan bezahlen');
                assertEqual(entry.flex_haushalt_basis, dynamicFlex ? 'effective_vpw_plus_pension_surplus' : 'static_input',
                    'MC-Jahreslog benennt den wirksamen statischen oder dynamischen Haushaltsbedarf');
            });
        }
        assertEqual(JSON.stringify(syntheticMetrics), JSON.stringify(buildMinimumFlexRestriction(
            syntheticChunk.runMeta.map(meta => deriveMinimumFlexPath(meta.logDataRows)), 30000)),
            'Synthetischer MC aggregiert bezahlten und Wunsch-Flex aus identischen Jahreslogs');
        console.log(`Inflations-MC (VPW ${dynamicFlex ? 'an' : 'aus'}): bezahlt ${syntheticMetrics.paidMedianNominalEurP50}, Wunsch laut Plan ${syntheticMetrics.desiredMedianNominalEurP50}, 12 Jahre.`);
    }
} finally {
    annualData.splice(0, annualData.length, ...originalAnnualData);
}
console.log('Mindest-Flex-Auswertung geprüft.');
