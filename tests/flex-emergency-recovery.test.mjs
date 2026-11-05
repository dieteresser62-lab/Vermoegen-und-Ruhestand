import { EngineAPI } from '../engine.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';

// Synthetischer Haushalt: Die Rally vom Tief bleibt unter dem alten Hoch.
const input = {
    depotwertAlt: 900000, depotwertNeu: 0, tagesgeld: 100000, geldmarktEtf: 0, goldWert: 0,
    floorBedarf: 24000, flexBedarf: 60000, minimumFlexAnnual: 30000, inflation: 0,
    renteAktiv: false, renteMonatlich: 0, goldAktiv: false, liquidityRunwayYears: 5,
    maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, rebalancingBand: 25,
    risikoprofil: 'sicherheits-dynamisch', dynamicFlex: false,
    endeVJ: 70, endeVJ_1: 70, endeVJ_2: 60, endeVJ_3: 50, ath: 100, jahreSeitAth: 3
};
const lastState = {
    initialized: true, flexRate: 80, peakRealVermoegen: 1600000,
    cumulativeInflationFactor: 1, lastMarketSKey: 'bear_deep'
};
const balance = evaluateStoredAnnualHousehold(input, [{
    profileId: 'synthetic', name: 'Max Mustermann', inputs: input, tranches: []
}], structuredClone(lastState), { engineApi: EngineAPI, withdrawalMode: 'tax_optimized' }).householdResult;
assertEqual(balance.diagnosis.general.marketSKey, 'recovery_in_bear', 'Balance erreicht die Erholung im Bärenmarkt');
assertEqual(balance.diagnosis.general.severeFlexEmergencyActive, true, 'Balance aktiviert FR-20 in der Erholung');
assertEqual(balance.diagnosis.general.marketExtremeBear, false, 'Erholung ist kein Extrembär-Diagnosejahr');
assertEqual(balance.ui.spending.monatlicheEntnahme * 12, 34800, 'Balance erhält tragfähigen Teil-Flex nach Rundung');
assert(balance.diagnosis.decisionTree.some(row => row.step === 'Schwere Flex-Notlage'
    && row.impact.includes('Erholung im Bärenmarkt')), 'Engine-Wrapper nennt die Erholung im Notlagegrund');

const simulatorInputs = {
    ...input, startAlter: 65, geschlecht: 'm', startVermoegen: 1000000,
    startFloorBedarf: 24000, startFlexBedarf: 60000, partner: { aktiv: false },
    pflegefallLogikAktivieren: false
};
const state = initMcRunState(simulatorInputs);
state.lastState = structuredClone(lastState);
Object.assign(state.marketDataHist, {
    endeVJ: 70, endeVJ_1: 60, endeVJ_2: 50, endeVJ_3: 100, ath: 100, jahreSeitAth: 3
});
const simulator = simulateOneYear(state, simulatorInputs, {
    jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0
}, 0, null, 0, null, 1, EngineAPI);
assertEqual(simulator.kind, 'success', 'Simulator führt das Erholungsjahr aus');
assertEqual(simulator.logData.Regime, 'recovery_in_bear', 'Simulator erreicht die Erholung im Bärenmarkt');
assertEqual(simulator.logData.SevereFlexEmergencyActive, true, 'Simulator aktiviert FR-20 in der Erholung');
assertEqual(simulator.logData.MarketExtremeBear, false, 'Simulator protokolliert Erholung getrennt vom Extrembären');
assert(simulator.logData.entnahme_effektiv >= input.floorBedarf, 'Simulator schützt den Grundbedarf');
assertEqual(simulator.logData.entnahme_effektiv, balance.ui.spending.monatlicheEntnahme * 12,
    'Balance und Simulator zahlen in der Erholung denselben tragfähigen Teil-Flex');
