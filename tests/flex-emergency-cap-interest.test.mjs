import { applySimulatorTaxRecompute } from '../app/simulator/simulator-tax-recompute.js';
import { settleTaxYear } from '../engine/tax-settlement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { SpendingPlanner } from '../engine/planners/SpendingPlanner.mjs';
import { inputs } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { applyPersonalInterest } from '../app/simulator/simulator-personal-accounts.js';
import { householdInput } from './helpers/ff-c-scenarios.mjs';
import { buildMonteCarloYearLogRow, buildMonteCarloDeathLogRow } from '../app/simulator/mc-log-builder.js';

function emergency(floor, flex = 60000, pension = 0) {
    return SpendingPlanner.determineSpending({
        lastState: { initialized: true, flexRate: 80, peakRealVermoegen: 1600000,
            cumulativeInflationFactor: 1, lastTotalBudget: floor + flex, lastMarketSKey: 'bear_deep' },
        market: { sKey: 'bear_deep', abstandVomAthProzent: 35 },
        inflatedBedarf: { floor, flex }, runwayMonate: 60, profil: {},
        depotwertGesamt: 900000, gesamtwert: 1000000, renteJahr: pension,
        input: { floorBedarf: floor + pension, flexBedarf: flex, minimumFlexAnnual: 30000,
            inflation: 0, liquidityRunwayYears: 5, flexBudgetAnnual: 0,
            endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100 }
    });
}
for (const pension of [0, 12000]) {
    const partial = emergency(24000, 60000, pension);
    assertEqual(partial.spendingResult.details.severeFlexEmergencyActive, true, 'FR-20: schwere Notlage aktiv');
    // 35.000 - 24.000 = 11.000; die bestehende Monatsrundung zahlt 10.800.
    assertClose(partial.spendingResult.details.safetyCapFlexRatePct, 11000 / 60000 * 100, 1e-10, 'FR-20: Teil-Flex bis zur 3,5-%-Grenze');
    assertEqual(partial.spendingResult.details.endgueltigeEntnahme, 34800, 'FR-20: Teil-Flex nach Monatsrundung');
    assert(partial.spendingResult.anmerkung.includes('10800.00'), 'FR-20: Begründung nennt bezahlten neuen Flex');
    assert(partial.diagnosis.decisionTree.some(row => row.step === 'Schwere Flex-Notlage' && row.impact.includes('11000.00')), 'FR-20: Diagnose nennt die Grenze');
}
assertEqual(emergency(40000).spendingResult.details.endgueltigeEntnahme, 40000, 'FR-20: Grundbedarf allein über Grenze lässt Flex null');
assertEqual(emergency(0, 20000).spendingResult.details.severeFlexEmergencyActive, false, 'FR-20: tragfähiger geschützter Bedarf löst keine Notlage aus');

const base = { depotwertAlt: 1000000, depotwertNeu: 0, goldWert: 0, tagesgeld: 200000, geldmarktEtf: 0,
    inflation: 0, floorBedarf: 24000, flexBedarf: 12000, goldAktiv: false, goldFloorProzent: 0,
    renteAktiv: false, renteMonatlich: 0, liquidityRunwayYears: 5, rebalancingBand: 25,
    maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, risikoprofil: 'sicherheits-dynamisch',
    endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: 0,
    dynamicFlex: true, horizonYears: 20, marketCapeRatio: 25 };
for (const patch of [{}, { goGoActive: true, goGoMultiplier: 1.5 }, { flexBedarf: 12600, inflation: 5 },
    { renteAktiv: true, renteMonatlich: 3000 }, { flexBedarf: 0 }]) {
    const input = { ...base, ...patch };
    const result = EngineAPI.simulateSingleYear(input, null);
    assert(!result.error, 'FR-26: gültige Eingaben');
    assertEqual(result.ui.vpw.wishFlexCapApplied, true, 'FR-26: Obergrenze greift');
    const pensionFlex = Math.max(0, input.renteMonatlich * 12 - input.floorBedarf);
    assertClose(result.ui.vpw.dynamicFlex + pensionFlex, 2 * input.flexBedarf, 1e-8, 'FR-26: inflationsfortgeschriebener Wunsch begrenzt Haushaltsflex einschließlich Rente');
    assert(result.diagnosis.decisionTree.some(row => row.step === 'Dynamic-Flex-Obergrenze'), 'FR-26: Eingriff steht in Diagnose');
    assert(result.ui.spending.monatlicheEntnahme * 12 - Math.max(0, input.floorBedarf - input.renteMonatlich * 12) + pensionFlex <= 2 * input.flexBedarf + 1e-8, 'FR-26: tatsächliche Zahlung bleibt im Rahmen');
}
const uncapped = EngineAPI.simulateSingleYear({ ...base, flexBedarf: 100000 }, null);
assert(!uncapped.ui.vpw.wishFlexCapApplied, 'FR-26: großer Wunsch-Flex lässt VPW unverändert');
for (const stage of [1, 2]) {
    const result = EngineAPI.simulateSingleYear(base, { initialized: true, flexRate: 100,
        vpwSafetyStage: stage, vpwLastDynamicFlex: 300000, vpwSafetyReentryRemaining: 3 });
    assert(result.ui.spending.monatlicheEntnahme * 12 - base.floorBedarf <= 2 * base.flexBedarf, 'FR-26: Wiedereinstieg und Sicherheitsboden umgehen die Grenze nicht');
}

const year = { jahr: 2000, rendite: 0, inflation: 0, zinssatz: 0, gold_eur_perf: 0, lohn: 0 };
const staticInputs = { ...structuredClone(inputs), dynamicFlex: false, pflegefallLogikAktivieren: false };
const runYear = (input = staticInputs, state = initMcRunState(input), marketYear = year) =>
    simulateOneYear(state, input, marketYear, 0, null, 0, null, 1, EngineAPI);
const state = initMcRunState(staticInputs);
state.portfolio.personAccounts.forEach((person, index) => person.taxState.lossCarry = 10000 * (index + 1));
const personal = runYear(staticInputs, state);
assertEqual(personal.kind, 'success', 'Logkorrekturen: echtes Personenjahr läuft');
assert(personal.logData.lossCarryEnd > 0, 'Log 2: tatsächlicher positiver Verlustvortrag');
assertEqual(personal.logData.lossCarryEnd, personal.logData.personAccounts.reduce((total, person) => total + person.taxState.lossCarry, 0), 'Log 2: Haushalt zeigt Summe der persönlichen Verlustvorträge');
const sale = personal.logData.balance_trace.find(row => row.phase === 'after_action_sales');
assert(sale.nettoErlos > 0 && sale.cashSpend === 0, 'Log 1: Verkauf zeigt Verkaufserlös getrennt vom Kauf');
const buyInputs = { ...staticInputs, startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0, maxSkimPctOfEq: 10 };
const purchaseState = initMcRunState(buyInputs);
Object.assign(purchaseState.marketDataHist, { endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, ath: 100, jahreSeitAth: 0 });
const purchase = runYear(buyInputs, purchaseState, { ...year, rendite: .2 });
const buy = purchase.logData.balance_trace.find(row => row.phase === 'after_action_sales');
assert(buy.cashSpend > 0 && buy.buyEqAmount > 0, 'Log 1: Kauf hat eigenen Cashabfluss und Kaufbetrag');
assertEqual(buy.nettoErlos, 0, 'Log 1: Kauf hat keinen Verkaufserlös');

for (const rate of [-2, 0]) {
    // Isolierte Zinsprobe: kein MM-Verkauf, dessen Gewinn sich mit Negativzinsen ändert.
    const interestInput = householdInput(200000, 400000);
    const result = runYear(interestInput, initMcRunState(interestInput), { ...year, zinssatz: rate });
    const zero = runYear(interestInput);
    assertClose(result.totalTaxesThisYear, zero.totalTaxesThisYear, 1e-8, 'FR-25: negative Zinsen ändern Jahressteuer nicht');
    assertEqual(result.logData.lossCarryEnd, zero.logData.lossCarryEnd, 'FR-25: negativer Zins verändert Verlustvortrag nicht');
    assertEqual(result.logData.cash_interest_taxable_signed, 0, 'FR-25: kein negativer Kapitalertrag');
    if (rate < 0) assert(result.logData.liquiditaet < zero.logData.liquiditaet, 'FR-25: Guthaben sinkt trotzdem');
}
for (const taxable of [-500, 2500]) {
    const params = { taxStatePrev: { lossCarry: 1000 }, rawAggregate: { sumTaxableAfterTqfSigned: taxable }, sparerPauschbetrag: 0 };
    const original = settleTaxYear(params), next = {}, action = { steuer: original.taxDue };
    const result = applySimulatorTaxRecompute({ didForcedSale: true, actionResult: action, spendingNewState: next,
        taxStatePrev: params.taxStatePrev, combinedTaxRawAggregate: params.rawAggregate, sparerPauschbetrag: 0,
        cashInterestIncomeSigned: -300 });
    assertEqual(result.totalTaxesThisYear, original.taxDue, 'FR-25: Sammelpfad mit negativem Zins hat unveränderte Steuer');
    assertEqual(next.taxState.lossCarry, original.taxStateNext.lossCarry, 'FR-25: Sammelpfad bildet keinen zusätzlichen Verlustvortrag');
}
// Zwei Personen mit unterschiedlichem Zinsvorzeichen: kein Ausgleich über Personen.
const portfolio = structuredClone(initMcRunState(staticInputs).portfolio);
const book = beginPersonalTaxYear(portfolio);
book[0].rawAggregate.sumTaxableAfterTqfSigned = 5000;
book[0].reserved = 5000;
const interest = applyPersonalInterest(portfolio, -.01);
interest.items[1].cashInterest = 2000;
const action = {};
settlePersonalTaxYear({ portfolio, book, personalInterest: interest, actionResult: action, plannedActionFlow: null,
    regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false });
assertEqual(action.personalAnnualTaxes[0].cashInterestIncomeSigned, 0, 'FR-25: negative Personenzinsen bleiben steuerlich null');
assertEqual(action.personalAnnualTaxes[1].cashInterestIncomeSigned, 2000, 'FR-25: positiver Zins anderer Person bleibt steuerpflichtig');

for (const patch of [{}, { dynamicFlex: true, horizonYears: 15, goGoActive: true, goGoMultiplier: 1.1 },
    { renteMonatlich: 5000 }, { startFlexBedarf: 15000 }]) {
    const input = { ...staticInputs, ...patch }, result = runYear(input);
    const log = result.logData;
    const expected = log.flex_haushalt_erfuellt / log.flex_wunsch_haushalt_nominal * 100;
    assertClose(log.FlexRatePct, expected, 1e-9, 'Log 4: FlexRatePct bezieht sich auf gezeigten Wunsch-Flex');
    assertClose(log.entscheidung.kuerzungProzent, Math.max(0, 100 - expected), 1e-9, 'Log 4: Kürzung bezieht sich auf gezeigten Wunsch-Flex');
    assert(expected >= 100 ? log.entscheidung.anmerkung === '' : log.entscheidung.anmerkung.startsWith(`(Flex um ${Math.max(0, 100 - expected).toFixed(0)}% `), 'Log 4: Kürzungstext und Prozentwert haben denselben Wunsch-Flex-Bezug');
    if (result.ui.vpw.wishFlexCapApplied) assert(log.aktionUndGrund.includes('Dynamic-Flex-Obergrenze'), 'FR-26: Obergrenze steht im Protokoll');
}
const safetyInput = { ...staticInputs, dynamicFlex: true, startFlexBedarf: 10000, minimumFlexAnnual: 0 };
const safetyState = initMcRunState(safetyInput);
Object.assign(safetyState.lastState, { initialized: true, flexRate: 100, vpwSafetyStage: 2, vpwLastDynamicFlex: 300000 });
const safetyLog = runYear(safetyInput, safetyState).logData;
assertClose(safetyLog.flex_haushalt_erfuellt, safetyLog.flex_aus_depot_erfuellt + safetyLog.flex_rentenueberschuss, 1e-9,
    'Log 4: Sicherheitsboden protokolliert tatsächlich bezahlten Flex ohne Clipping am Wunsch');
assertClose(safetyLog.FlexRatePct, safetyLog.flex_haushalt_erfuellt / safetyLog.flex_wunsch_haushalt_nominal * 100, 1e-9,
    'Log 4: auch Sicherheitsboden verwendet den angezeigten Wunsch als Nenner');
// Log 3: Pflege beider Personen, nur zweite Person und Abschlussjahr.
const care = grade => ({ active: true, grade, gradeLabel: `PG${grade}`, zusatzFloorZiel: grade * 1000,
    zusatzFloorDelta: grade * 100, flexFactor: .5, kumulierteKosten: grade * 2000,
    log_floor_anchor: 10000, log_maxfloor_anchor: 20000, log_cap_zusatz: 10000, log_delta_flex: 500 });
for (const [p1Alive, p2Alive] of [[true, true], [false, true], [false, false]]) {
    const context = { hasPartner: true, p1Alive, p2Alive, careMetaP1: care(1), careMetaP2: care(3) };
    const result = buildMonteCarloYearLogRow({ simulationsJahr: 0, yearData: year, result: personal, lifeLogContext: context });
    assertEqual(result.pflege_aktiv, p1Alive || p2Alive, 'Log 3: aktive Pflege bezieht beide Personen ein');
    assertEqual(result.pflege_zusatz_floor, result.CareP1_Cost + result.CareP2_Cost, 'Log 3: Haushaltskosten stimmen mit Personen überein');
    assertEqual(result.pflege_grade, p2Alive ? 3 : null, 'Log 3: höchster aktiver Grad, keine eingefrorenen Werte');
    if (!p1Alive) assertEqual(result.CareP1_Cost, 0, 'Log 3: verstorbene Person liefert keine Pflegekosten');
}
const terminal = buildMonteCarloDeathLogRow({ inputs: staticInputs, portfolioSnapshot: state.portfolio, currentRunLogLength: 2,
    lifeLogContext: { hasPartner: true, p1Alive: false, p2Alive: false, careMetaP1: care(1), careMetaP2: care(3) } });
assertEqual(terminal.pflege_grade, null, 'Log 3: Abschlussjahr enthält keinen alten Pflegegrad');
assertEqual(terminal.pflege_zusatz_floor, 0, 'Log 3: Abschlussjahr enthält keine alten Pflegekosten');
