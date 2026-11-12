import { EngineAPI } from '../engine/index.mjs';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, prepareHistoricalDataOnce, getDataVersion } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { plannedExpensesForYear } from '../app/profile/household-planned-expenses.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';
import { createStressReplayVariantV1 } from '../app/simulator/stress-replay-variant.js';
import { getProtocolColumns, PROTOCOL_COLUMNS, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { backtest } from './helpers/ek-1b-measurement.mjs';
import { serializeHistoricalBacktestCsv } from '../app/simulator/historical-backtest-export.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';

const fixed = (patch = {}) => ({ id: 'kredit', bezeichnung: 'Kredit', betragMonat: 450, ab: '2026-10', bis: '2027-03', anpassung: 'keine', ...patch });
const once = (patch = {}) => ({ id: 'auto', bezeichnung: 'Auto', monat: '2028-04', betrag: 35000, ...patch });
const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_geschlecht: 'w', profile_rentenbeginn: '2026-01-01',
    profile_rente_monatlich: '0', profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '0', profile_tagesgeld: '200000', sim_simStartVermoegen: '200000' };
const single = buildSimulatorInputsFromProfileData(person, { referenceYear: 2026, planValues: null });
const combined = combineSimulatorProfiles([{ profileId: 'max', inputs: single }], 'max', { planValues: null }).combined;
const inputs = { ...combined, startFloorBedarf: 12000, startFlexBedarf: 6000, minimumFlexAnnual: 0, dynamicFlex: false,
    maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0, goldAktiv: false, pflegefallLogikAktivieren: false, healthBucket: { enabled: false } };
const year = (state, input = inputs, index = 0, data = {}) => simulateOneYear(state, input,
    { jahr: 2000 + index, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0, ...data }, index, null, 0, null, 1, EngineAPI);
const close = (a, b, text) => assertClose(a, b, 1e-6, text);
const same = (a, b, text) => assertEqual(JSON.stringify(a), JSON.stringify(b), text);
prepareHistoricalDataOnce();

// AQ-1/FR-57: Auto und Puffer bleiben reserviert; nur der freie Rest wird angelegt.
for (const [cash, minCashBufferMonths, netSale, remainingCash, equityBuy] of [[20000, 2, 0, 6000, 1000], [10000, 0, 3000, 0, 0], [10000, 2, 9000, 6000, 0]]) {
    const scenario = { ...inputs, startVermoegen: cash + 100000, tagesgeld: cash,
        startFloorBedarf: 24000, startFlexBedarf: 12000, minCashBufferMonths,
        simulationPeople: [{ ...inputs.simulationPeople[0], tagesgeld: cash, sparerPauschbetrag: 0 }],
        detailledTranches: [{ schemaVersion: 2, trancheId: 'etf', sourceProfileId: 'max', name: 'ETF', type: 'aktien_neu', category: 'equity',
            shares: 1000, purchasePrice: 50, currentPrice: 100, marketValue: 100000, costBasis: 50000, purchaseDate: '2020-01-01', tqf: .3, taxExempt: false }],
        fixedIncomeReferenceYear: 2026, fixedIncome: [{ id: 'gehalt', profileId: 'max', art: 'sonstige', bezeichnung: 'Gehalt',
            betragMonat: 4000, ab: null, bis: null, anpassung: 'keine' }],
        plannedExpensesReferenceYear: 2026, plannedExpenses: [once({ monat: '2026-04', betrag: 25000 })] };
    let action, reserve;
    const spy = { ...EngineAPI, simulateSingleYear(input, state) {
        reserve = input.plannedExpenseLiquidityReserve;
        const result = EngineAPI.simulateSingleYear(input, state); action = result.ui.action; return result;
    } };
    const result = simulateOneYear(initMcRunState(scenario, 0), scenario,
        { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 }, 0, null, 0, null, 1, spy);
    assertEqual(result.kind, 'success', 'Auto wird vollständig bezahlt');
    close(reserve, 25000, 'Engine erhält den später tatsächlich bezahlten Betrag als Reserve');
    close(result.logData.geplante_ausgaben, 25000, 'Auto wird genau einmal abgebucht');
    close(result.logData.portfolio_flow_delta, 0, 'Reserve und Zahlung erzeugen keinen doppelten Vermögensfluss');
    close(action.verwendungen?.aktien || 0, equityBuy, 'FR-57 legt nur den Überschuss über Auto und Reserve an');
    close(action.verwendungen?.gold || 0, 0, 'Vor dem Auto keine Goldkäufe');
    close(action.nettoErlös || 0, netSale + equityBuy, 'Transaktion vor Zahlung deckt die Lücke oder legt ausschließlich den freien Rest an');
    close(result.newState.portfolio.liquiditaet, remainingCash, 'Restliquidität entspricht Einkommen minus Bedarf und Auto plus notwendiger Auffüllung');
    if (cash === 20000) {
        close(result.logData.steuern_gesamt, 0, 'Astras Fall hat keine vermeidbare Verkaufssteuer');
        close(result.logData.eq_after_buys, 100000 + equityBuy, 'FR-57 kauft Aktien aus dem freien Rest ohne Aktienverkauf');
    } else {
        assert(result.logData.steuern_gesamt > 0, 'Nur die notwendige Lücke löst Verkaufssteuer aus');
        close(100000 - result.logData.eq_after_buys, netSale + result.logData.steuern_gesamt, 'Bruttoverkauf ist Nettolücke plus Steuer');
    }
}

for (const [year, amount] of [[2025, 0], [2026, 1350], [2027, 1350], [2028, 0]]) close(plannedExpensesForYear([fixed()], year), amount, 'Feste Ausgaben zählen einschließlich der Monatsgrenzen');
{
    same(year(initMcRunState(inputs, 0)), year(initMcRunState(inputs, 0), { ...inputs, plannedExpenses: [], plannedExpensesReferenceYear: 2026 }), 'Ohne geplante Ausgaben bleibt das vollständige Jahresresultat bytegleich');
    const withExpenses = { ...inputs, plannedExpenses: [fixed()], plannedExpensesReferenceYear: 2026 };
    let state = initMcRunState(withExpenses, 0);
    for (let index = 0; index < 3; index++) {
        const ordinary = year(structuredClone(state), inputs, index), paid = year(state, withExpenses, index);
        assertEqual(paid.kind, 'success', 'Ausgabenjahr kann vollständig bezahlt werden');
        // FR-43 (11.11.2026): Feste Ausgaben erhöhen den Grundbedarf ihrer Monate und laufen nicht als eigene Zahlung.
        // Der höhere Grundbedarf wirkt auch auf den Flex-Anteil (S-Kurve); das Vermögen sinkt um die Mehrentnahme.
        close(paid.logData.floor_brutto - ordinary.logData.floor_brutto, index < 2 ? 1350 : 0, 'FR-43: Grundbedarf enthält die feste Ausgabe');
        assert(!paid.logData.geplante_ausgaben, 'FR-43: Feste Ausgabe erscheint nicht als geplante Ausgabe');
        close(portfolioTotal(ordinary.newState.portfolio) - portfolioTotal(paid.newState.portfolio),
            paid.logData.jahresentnahme_real - ordinary.logData.jahresentnahme_real, 'Das Vermögen sinkt um die höhere Jahresentnahme');
        if (index === 2) same(paid.logData.floor_brutto, ordinary.logData.floor_brutto, 'Nach dem Zeitraum ist die feste Ausgabe weg');
        close(paid.logData.portfolio_flow_delta, 0, 'Zusätzliche Ausgaben sind im Vermögensfluss erklärt');
        state = paid.newState;
    }
}
{
    const expenseInputs = { ...inputs, plannedExpenses: [once(), fixed({ id: 'indexiert', betragMonat: 100, ab: '2028-11', bis: '2028-12', anpassung: 'inflation' })], plannedExpensesReferenceYear: 2026 };
    const first = year(initMcRunState(expenseInputs, 0), expenseInputs, 0, { inflation: 2 });
    assert(!first.logData.geplante_ausgaben, 'Vor dem Zahlungsjahr kein Abzug und keine neuen Protokollfelder');
    const second = year(first.newState, expenseInputs, 1, { inflation: 3 });
    const ordinary = year(structuredClone(second.newState), inputs, 2);
    const paid = year(second.newState, expenseInputs, 2);
    close(paid.logData.geplante_ausgaben, 35000 * 1.02 * 1.03, 'Einmalige Ausgaben nutzen die verkettete Inflation ab dem Folgejahr');
    close(paid.logData.floor_brutto - ordinary.logData.floor_brutto, 200 * 1.02 * 1.03, 'Indexierte feste Ausgaben stehen im Grundbedarf mit derselben Inflation');
    const extraWithdrawal = (paid.logData.jahresentnahme_real - ordinary.logData.jahresentnahme_real) * paid.logData.inflation_factor_cum;
    close(portfolioTotal(ordinary.newState.portfolio) - portfolioTotal(paid.newState.portfolio), paid.logData.geplante_ausgaben + extraWithdrawal, 'Ohne Verkäufe entspricht der genaue Vermögensabzug der einmaligen Zahlung plus höherer Jahresentnahme');
}
for (const dynamicFlex of [false, true]) {
    const noCash = { ...inputs, startVermoegen: 200000, depotwertAlt: 0, einstandAlt: 0, tagesgeld: 0, geldmarktEtf: 0,
        simulationPeople: [{ ...inputs.simulationPeople[0], tagesgeld: 0, sparerPauschbetrag: 0 }], dynamicFlex,
        detailledTranches: [{ schemaVersion: 2, trancheId: 'etf', sourceProfileId: 'max', name: 'ETF', type: 'aktien_neu', category: 'equity',
            shares: 2000, purchasePrice: 50, currentPrice: 100, marketValue: 200000, costBasis: 100000, purchaseDate: '2020-01-01', tqf: .3, taxExempt: false }] };
    const withExpense = { ...noCash, plannedExpenses: [once({ monat: '2026-04' })], plannedExpensesReferenceYear: 2026 };
    const plain = year(initMcRunState(noCash, 0), noCash), paid = year(initMcRunState(withExpense, 0), withExpense);
    assertEqual(paid.kind, 'success', 'Verkauf deckt die zusätzliche Ausgabe');
    const taxDifference = paid.logData.steuern_gesamt - plain.logData.steuern_gesamt;
    assert(taxDifference > 0, 'Zusätzlicher steuerpflichtiger Verkauf erhöht die Jahressteuer');
    close(portfolioTotal(plain.newState.portfolio) - portfolioTotal(paid.newState.portfolio), 35000 + taxDifference, 'Vermögen sinkt um Auszahlung und zusätzliche Steuer');
    for (const key of ['CutReason', 'Alarm', 'entnahmequote', 'QuoteEndPct', 'FlexRatePct', 'flex_haushalt_erfuellt', 'floor_brutto']) same(paid.logData[key], plain.logData[key], `${key}: Ausgabe verzerrt auch bei Dynamic Flex die Jahresentscheidung nicht`);
    same(paid.ui.vpw, plain.ui.vpw, 'VPW sieht die unveränderte Vermögensbasis des Zahlungsjahres');
    close(paid.logData.portfolio_flow_delta, 0, 'Auch Verkaufssteuern sind vollständig erklärt');
    if (!dynamicFlex) {
        const bear = { ...withExpense, entnahmeStrategie: '3_bucket_jilge', decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }, startFlexBedarf: 0 };
        const result = year(initMcRunState(bear, 0), bear, 0, { rendite: -.25 });
        assertEqual(result.kind, 'success', 'Auch 3-Töpfe im Bärenjahr bezahlt eine große Ausgabe aus vorhandenem Vermögen');
        assertEqual(result.logData.threeBucket.isBadYear, true, 'Test erreicht tatsächlich den Anleihenschutz im Bärenjahr');
        const without = { ...bear }; delete without.plannedExpenses; delete without.plannedExpensesReferenceYear;
        const ordinary = year(initMcRunState(without, 0), without, 0, { rendite: -.25 });
        for (const key of ['CutReason', 'Alarm', 'entnahmequote', 'QuoteEndPct', 'floor_brutto', 'flex_haushalt_erfuellt']) same(result.logData[key], ordinary.logData[key], `3-Töpfe im Bär: ${key} bleibt außerhalb der zusätzlichen Zahlung`);
        close(result.logData.geplante_ausgaben, 35000, '3-Töpfe bezahlt den zusätzlichen Betrag vollständig');
        close(result.logData.portfolio_flow_delta, 0, 'Zusätzlicher Deckungsverkauf bleibt im Vermögensfluss erklärt');
    }
}
{
    const tooLarge = { ...inputs, plannedExpenses: [once({ monat: '2026-01', betrag: 1000000 })], plannedExpensesReferenceYear: 2026 };
    const result = year(initMcRunState(tooLarge, 0), tooLarge);
    assertEqual(result.kind, 'ruin', 'Ungedeckte geplante Ausgabe gilt als Ruin');
    assert(result.reason.includes('Geplante Ausgaben'), 'Ruin nennt die ungedeckte zusätzliche Ausgabe');
    close(result.logData.geplante_ausgaben, 1000000, 'Terminales Jahr protokolliert den fälligen Betrag');
    const history = backtest(tooLarge, 2000, 2001);
    close(history.rows[0].row.geplante_ausgaben, 1000000, 'Backtest behält den Betrag auch in der terminalen Ruinzeile');
    const captured = await runMonteCarloChunk({ inputs: tooLarge, monteCarloParams: { anzahl: 1, maxDauer: 4, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed' },
        widowOptions: tooLarge.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 1 }, logIndices: [0], stressReplayCapture: createStressReplayCaptureRequest([0]), engine: EngineAPI });
    const run = captured.runMeta[0];
    assertEqual(captured.totals.failCount, 1, 'MC-Erfolgsquote zählt eine ungedeckte große Ausgabe als Ruin');
    close(run.logDataRows[0].geplante_ausgaben, 1000000, 'Auch die terminale MC-Zeile enthält den fälligen Betrag');
    assert(run.stressReplayCapture.years.length > run.logDataRows.length, 'MC hält nach Ausgabenruin den Schattenpfad für Replay fest');
}
{
    const baseline = { ...inputs, startFloorBedarf: 500000, plannedExpenses: [once({ monat: '2027-05' })], plannedExpensesReferenceYear: 2026 };
    const params = { anzahl: 1, maxDauer: 4, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed' };
    const request = { inputs: baseline, monteCarloParams: params, widowOptions: baseline.widowOptions, useCapeSampling: false };
    const capture = await runMonteCarloChunk({ ...request, runRange: { start: 0, count: 1 }, logIndices: [0], stressReplayCapture: createStressReplayCaptureRequest([0]), engine: EngineAPI });
    const meta = capture.runMeta[0];
    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows, sourceRequest: request,
        dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }), engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version }), scenarioKey: 'ga-shadow', selectionMetric: 'nominal_terminal_wealth_eur' });
    const variant = createStressReplayVariantV1({ id: 'kleiner-bedarf', label: 'Kleiner Bedarf', baselineInputs: baseline, patch: { strategy: { startFloorBedarf: 12000 } } });
    const replay = runStressReplayPathV1({ path, baselineInputs: baseline, variant, engine: EngineAPI });
    const second = replay.scenarioLog.records.find(row => row.jahr === 2);
    assert(second?.geplante_ausgaben > 0, 'Replay bezahlt künftige Ausgaben auch in einem Jahr aus dem Schattenpfad nach ursprünglichem Ruin');
}
for (const patch of [{ plannedExpenses: [fixed({ betragMonat: -1 })] }, { plannedExpenses: [once({ monat: '2026-13' })] },
    { plannedExpenses: [fixed({ anpassung: 'lohn' })] }, { plannedExpenses: [once()], plannedExpensesReferenceYear: null }, { plannedExpenses: {} }]) {
    let error; try { validateSimulatorInputs({ ...inputs, plannedExpensesReferenceYear: 2026, ...patch }); } catch (caught) { error = caught; }
    assertEqual(error?.name, 'SimulatorValidationError', 'Ungültige Ausgabe blockiert den Lauf sichtbar');
}
{
    const scenario = { ...inputs, plannedExpenses: [fixed({ ab: '2026-01', bis: '2027-12' }), once({ monat: '2026-05' })], plannedExpensesReferenceYear: 2026 };
    const historyRow = backtest(scenario, 2000, 2001).rows[0].row;
    close(historyRow.geplante_ausgaben, 35000, 'Backtest ordnet die einmalige Zahlung relativ zum Planjahr zu');
    close(historyRow.floor_brutto, 12000 + 5400, 'Backtest zählt die feste Ausgabe des Planjahrs zum Grundbedarf');
    const params = { anzahl: 2, maxDauer: 4, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    const request = { inputs: scenario, widowOptions: scenario.widowOptions, monteCarloParams: params, useCapeSampling: false };
    const source = await runMonteCarloChunk({ ...request, runRange: { start: 0, count: 2 }, logIndices: [0, 1], stressReplayCapture: createStressReplayCaptureRequest([0]), engine: EngineAPI });
    assertEqual(source.technicalInventory.technicalError, 0, 'Monte Carlo verarbeitet die Ausgaben ohne technische Fehler');
    const meta = source.runMeta.find(run => run.index === 0);
    close(meta.logDataRows[0].geplante_ausgaben, 35000, 'MC nutzt denselben Ausgabenbetrag');
    close(meta.logDataRows[0].floor_brutto, 12000 + 5400, 'MC zählt die feste Ausgabe zum Grundbedarf');
    const mcCsv = serializeScenarioLogCsvV2(projectScenarioLogV2(meta.logDataRows));
    assert(mcCsv.split('\r\n')[0].split(';').includes('geplante_ausgaben'), 'Vollständiger MC-CSV-Download enthält die zusätzliche Ausgabe');
    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows, sourceRequest: request,
        dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }), engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version }), scenarioKey: 'ga-1a', selectionMetric: 'nominal_terminal_wealth_eur' });
    assertEqual(runStressReplayPathV1({ path, baselineInputs: scenario, sourceScenarioLog: meta.logDataRows, engine: EngineAPI }).reconciliation.matched, true, 'Schatten-/Replaypfad rechnet dieselben Ausgaben');
    const sweep = runSweepChunk({ baseInputs: scenario, paramCombinations: [{ liquidityRunwayYears: 5 }], sweepConfig: { anzahlRuns: 2, maxDauer: 4, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed' }, engine: EngineAPI });
    assertEqual(sweep.results[0].metrics.comparison.runCount, 2, 'Sweep verarbeitet beide Ausgabenpfade');
    const noExpenseSweep = runSweepChunk({ baseInputs: inputs, paramCombinations: [{ liquidityRunwayYears: 5 }], sweepConfig: { anzahlRuns: 2, maxDauer: 4, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed' }, engine: EngineAPI });
    assert(JSON.stringify(sweep.results[0].metrics) !== JSON.stringify(noExpenseSweep.results[0].metrics), 'Die Ausgaben verändern auch die tatsächlich berechneten Sweep-Ergebnisse');
    const definition = PROTOCOL_COLUMNS.find(column => column.id === 'planned-expenses');
    assertEqual(definition.label, 'Geplante Ausgaben', 'Vollständiger Download enthält die benannte Protokollspalte');
    close(readProtocolValue(definition, meta.logDataRows[0], { source: 'mc' }), 35000, 'MC-Spalte liest den zusätzlichen Betrag');
    const historical = backtest(scenario, 2000, 2001);
    const btCsv = serializeHistoricalBacktestCsv(historical);
    const csvLines = btCsv.split('\n').map(line => line.split(';'));
    const expenseIndex = csvLines[0].indexOf('planned_expenses_nominal_eur');
    assert(expenseIndex >= 0 && Number(csvLines[1][expenseIndex]) === 35000, 'Vollständiger Backtest-CSV-Download enthält den Nominalbetrag');
    close(readProtocolValue(definition, historical.rows[0], { source: 'backtest' }), 35000, 'Backtest-Spalte liest den zusätzlichen Betrag');
    assert(!getProtocolColumns({ source: 'mc', rows: meta.logDataRows }).some(column => column.id === definition.id), 'Normaler Protokolldialog bleibt kompakt');
    assert(getProtocolColumns({ source: 'mc', logDetailLevel: 'detailed', rows: meta.logDataRows }).some(column => column.id === definition.id), 'Detaillierter Dialog enthält Geplante Ausgaben');
}
