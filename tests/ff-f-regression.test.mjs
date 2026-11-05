import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readJB2Hash } from './helpers/jb-2-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { capitalGainsTaxRate } from '../engine/tax-settlement.mjs';
import { TransactionEngine } from '../engine/transactions/TransactionEngine.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { annualData } from '../app/simulator/simulator-data.js';
import { computeRentAdjRate } from '../app/simulator/simulator-portfolio-pension.js';
import { initializePortfolio, sumDepot } from '../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { buildMonteCarloRuinLogRow, buildStressReplayLogRow } from '../app/simulator/mc-log-builder.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { personalProfiles } from '../app/simulator/simulator-personal-accounts.js';
import { householdInput, syntheticLot, marketYear } from './helpers/ff-c-scenarios.mjs';
import { unchangedFFD } from './helpers/ff-d-scenarios.mjs';
import { fffHousehold, fffYearSevenHousehold, fffHistory, fffHistoricalYears, fffMonteCarloParameters, fffDynamicEngineSamples } from './helpers/ff-f-scenarios.mjs';

const api = { engine: EngineAPI, initMcRunState, simulateOneYear, annualData, computeRentAdjRate };
const history = fffHistory(api);
assertEqual(history.length, 7, 'FF-F: vollständige historische Jahresfolge');
for (const [index, result] of history.entries()) {
    assertEqual(result.kind, 'success', `FF-F Jahr ${index + 1}: kein Ruin trotz vorhandenem Haushaltsdepot`);
    assert(result.logData.liquiditaet > 0, 'Jahresende hat bei vorhandenem Aktienvermögen Liquidität');
    assert(sumDepot(result.newState.portfolio) > 0, 'Synthetischer Haushalt besitzt weiter Aktien');
    const annualNeed = Math.max(result.logData.entnahme_plan,
        result.logData.floor_brutto + result.logData.flex_wunsch_haushalt_nominal - result.logData.pension_annual, 0);
    assertEqual(result.ui.zielLiquiditaet, Math.ceil(annualNeed * 5 / 100) * 100,
        'FR-30: fünf Jahre des höheren Jahresbedarfs, mit bisheriger Hunderterrundung');
    assertEqual(annualData.find(row => row.jahr === fffHistoricalYears[index]).jahr, fffHistoricalYears[index], 'Historische Jahreskennung bleibt erhalten');
}
for (const result of fffHistory(api, fffYearSevenHousehold())) {
    assertEqual(result.kind, 'success', 'Synthetische Jahr-7-Steuerlücke tritt nach der Korrektur nicht mehr auf');
    assert(result.logData.liquiditaet > 0, 'Auch die Jahr-7-Gegenprobe behält Liquidität');
}

{
    const params = { aktuelleLiquiditaet: 205000, depotwertGesamt: 3400000, zielLiquiditaet: 600000,
        market: { sKey: 'recovery_in_bear', szenarioText: 'Erholung im Bär' },
        spending: { monatlicheEntnahme: 10000, details: { endgueltigeEntnahme: 120000 } }, minGold: 0, profil: {},
        input: { floorBedarf: 24000, flexBedarf: 60000, renteAktiv: true, renteMonatlich: 26000 / 12,
            liquidityRunwayYears: 5, depotwertAlt: 3400000, depotwertNeu: 0, costBasisAlt: 1700000,
            goldWert: 0, goldAktiv: false, maxBearRefillPctOfEq: 5, maxSkimPctOfEq: 10,
            tagesgeld: 205000, sparerPauschbetrag: 2000, kirchensteuerSatz: .09 } };
    assertEqual(TransactionEngine.determineAction(params).type, 'NONE',
        'Bestandsregel: 20,5 Monate ohne Notfüllung, wenn die Rente den Floor deckt und Cash über 10.000 liegt');
    const uncovered = structuredClone(params);
    uncovered.input.renteMonatlich = 20000 / 12;
    assertEqual(TransactionEngine.determineAction(uncovered).type, 'TRANSACTION',
        'Gegenprobe: ungedeckter Floor aktiviert bei 20,5 Monaten die Notfüllung');
}

// Derselbe Core entscheidet auch für die Balance-Haushaltsprojektion.
{
    const input = fffHousehold(), profiles = personalProfiles(initMcRunState(input).portfolio, input);
    const engineInput = { depotwertAlt: 0, depotwertNeu: 3400000, tagesgeld: 450000,
        floorBedarf: 24000, flexBedarf: 60000, minimumFlexAnnual: 0, inflation: 0,
        goldAktiv: false, renteAktiv: true, renteMonatlich: 20000 / 12,
        liquidityRunwayYears: 5, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
        risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
        ath: 100, jahreSeitAth: 0, dynamicFlex: true, aktuellesAlter: 65, capeRatio: 25, horizonYears: 25 };
    const result = evaluateStoredAnnualHousehold(engineInput, profiles, null,
        { engineApi: EngineAPI, withdrawalMode: 'tax_optimized' }).householdResult;
    const planned = result.ui.spending.monatlicheEntnahme * 12;
    assertEqual(result.ui.zielLiquiditaet, Math.ceil(Math.max(planned, 64000) * 5 / 100) * 100,
        'Balance verwendet die präzisierte FR-30-Basis');
}

for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    for (const payer of ['a', 'b']) {
        const helper = payer === 'a' ? 'b' : 'a';
        const input = householdInput(0, 0);
        input.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; person.kirchensteuerSatz = .09; });
        input.detailledTranches = [syntheticLot(helper, 10000, 5000)];
        const portfolio = initializePortfolio(input), book = beginPersonalTaxYear(portfolio), action = {};
        book.find(row => row.profileId === payer).rawAggregate.sumTaxableAfterTqfSigned = 1000;
        const settled = settlePersonalTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: action,
            inputs: { householdWithdrawalMode: mode }, plannedActionFlow: null, regularSaleScale: 0,
            forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false });
        const taxes = action.personalAnnualTaxes;
        const taxpayer = taxes.find(row => row.profileId === payer), seller = taxes.find(row => row.profileId === helper);
        assert(!settled.taxShortfall, `${mode}/${payer}: Partnerdepot verhindert Steuer-Ruin`);
        assertClose(taxpayer.taxDue, 1000 * capitalGainsTaxRate(.09), 1e-8, 'Ursprüngliche Steuer bleibt beim Steuerpflichtigen');
        assertEqual(taxpayer.taxFundingGross, 0, 'Person ohne Depot verkauft keine erfundenen Tranchen');
        assert(seller.taxFundingGross > 0, 'Andere Person verkauft tatsächliches Eigentum');
        assert(seller.taxDue > 0, 'Zusätzlicher Verkaufsgewinn wird beim Verkäufer versteuert, auch bei umgekehrter Buchreihenfolge');
        assertClose(sumDepot(portfolio) + portfolio.liquiditaet, 10000 - settled.totalTaxesThisYear, 1e-7,
            'Haushaltsvermögen sinkt exakt um die tatsächlichen Steuern');
        assert(action.householdTaxSale.sources.every(source => source.sourceProfileId === helper), 'Verkaufsbeleg erhält den Eigentümer');
        assertClose(action.householdTaxSale.gross, seller.taxFundingGross, 1e-8,
            'Handlungsbeleg umfasst auch die Verkäufe zur Steuer auf neue Verkaufsgewinne');
        assert(portfolio.personAccounts.every(account => account.tagesgeld >= 0), 'Keine negativen Konten');
    }
}

{
    const input = householdInput(0, 0);
    input.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; });
    input.detailledTranches = [syntheticLot('b', 1000, 1000)];
    const portfolio = initializePortfolio(input), book = beginPersonalTaxYear(portfolio), action = {};
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 10000;
    const settled = settlePersonalTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: action,
        inputs: {}, plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0,
        spendingNewState: {}, didForcedSale: false });
    assertClose(settled.taxShortfall, 1637.5, 1e-8, 'Echte Haushaltslücke bleibt nach Ausschöpfen des Partnerdepots ein Ruin-Grund');
    assertEqual(sumDepot(portfolio) + portfolio.liquiditaet, 0, 'Erst das vollständig verbrauchte Haushaltsvermögen reicht nicht mehr');
}

for (const threeBuckets of [false, true]) {
    const input = { ...householdInput(0, 0), startFloorBedarf: 12000, startFlexBedarf: 0,
        minimumFlexAnnual: 0, liquidityRunwayYears: 5, depotwertNeu: 1000000, einstandNeu: 1000000,
        startVermoegen: 1000000, detailledTranches: [syntheticLot('b', 1000000, 1000000)],
        ...(threeBuckets ? { decumulation: '3_bucket_jilge', stockYears: 5, bondYears: 2 } : {}) };
    const state = initMcRunState(input);
    Object.assign(state.marketDataHist, { endeVJ: 60, endeVJ_1: 80, endeVJ_2: 100, ath: 100, jahreSeitAth: 3 });
    const result = simulateOneYear(state, input, { ...marketYear, rendite: -.2 }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Auch im Bär deckt das Partnerdepot die Auszahlung');
    assert(result.logData.entnahme_effektiv >= 12000, 'Auch ohne Anleihen wird der Floor im Haushalt ausgezahlt');
    assert(result.logData.vk.vkAkt > 0, 'Notverkauf aus dem Partnerdepot ist sichtbar');
}

{
    // Der vormals scheiternde MC-Pfad wird einzeln geprüft; der 2.000er-Vergleich
    // gehört in die separate Messung, nicht in die Standardsuite.
    const mc = await runMonteCarloChunk({ inputs: fffHousehold(), monteCarloParams: fffMonteCarloParameters,
        runRange: { start: 169, count: 1 }, logIndices: [169], widowOptions: { mode: 'none', percent: 0 },
        useCapeSampling: false, engine: EngineAPI });
    assertEqual(mc.technicalInventory.technicalError, 0, 'Ehemaliger Steuer-Ruin ist technisch auswertbar');
    assertEqual(mc.totals.outcomeRuinCount, 0, 'Ehemaliger Steuer-Ruin erreicht regulär sein Laufende');
}

{
    const reason = 'Steuer im Haushalt ungedeckt (300 EUR)';
    const result = { kind: 'ruin', isRuin: true, reason, logData: { ruin_reason: reason } };
    const lifeLogContext = { hasPartner: true, p1Alive: true, p2Alive: true };
    const row = buildMonteCarloRuinLogRow({ result, simulationsJahr: 6, yearData: { jahr: 1988, inflation: 0 },
        inputs: {}, lifeLogContext });
    assert(row.aktionUndGrund.includes(reason), 'Szenario-Log nennt den konkreten Ruin-Grund');
    assert(renderProtocolTable([row], { source: 'mc' }).includes(reason), 'Grund bleibt im sichtbaren Protokoll und Info erhalten');
    const replay = buildStressReplayLogRow({ record: { yearIndex: 6, historicalYear: 1988,
        recordType: 'terminal_ruin', householdEvents: [{ type: 'household_state', p1Alive: true, p2Alive: true }] }, result, inputs: {} });
    assertEqual(replay.aktionUndGrund, row.aktionUndGrund, 'Replay erhält den Grund auch ohne Zufluss');
}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unchanged = unchangedFFD(api);
for (const [key, expected] of Object.entries({
    engines: 'b67d8f07fcffa09faf1cf7a83652a266364263ffa132bd7285cf4d27f00bb343',
    households: 'b36aa608d5c0451332c75efad00f8a1c6cb6d7f5a1cd5be66097494e1e0e545d',
    singles: 'c836f6a70bd12b327acff8ff09dea88a0963ea8624dfe7c0190cf258dba9b697'
})) assertEqual(hash(unchanged[key]), readGL1References(readAN1Hash(readJB2Hash(expected))), `${key}: vollständige Ergebnisse ohne Dynamik nach BK-2`);
const dynamic = fffDynamicEngineSamples(EngineAPI);
for (const [key, expected] of Object.entries({
    input: '15aba1519cedc2e2f0403478f640753afe558ef271caf8317b335714ea0639d1',
    newState: 'b2be0fbc49d047565d168d90ea642c2651a12bf11199b11f6617bc9807cd0b4c',
    action: '2847958a523feb324af1ded3d423886c736807b13d4f95d551b58b430550c20f'
})) assertEqual(hash(dynamic.map(row => key === 'action' ? row.ui.action : row[key])), readGL1References(readAN1Hash(expected)),
    `Dynamic Flex ohne Kürzung: vollständiges ${key}-Objekt nach FR-33/34; Aktionen separat`);
