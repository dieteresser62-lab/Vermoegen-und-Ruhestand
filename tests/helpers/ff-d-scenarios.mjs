import { householdInput, marketYear } from './ff-c-scenarios.mjs';

// Keine Kürzung, keine Dynamik, kein Tod; Jahresbedarf exakt auf dem Auszahlungsraster.
export function unchangedFFD({ engine, initMcRunState, simulateOneYear }) {
    const engineInput = { depotwertAlt: 400000, depotwertNeu: 0, tagesgeld: 200000, geldmarktEtf: 0,
        floorBedarf: 12000, flexBedarf: 12000, minimumFlexAnnual: 12000, inflation: 0,
        goldAktiv: false, renteAktiv: false, liquidityRunwayYears: 5, maxSkimPctOfEq: 0,
        maxBearRefillPctOfEq: 0, risikoprofil: 'sicherheits-dynamisch',
        endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, ath: 100, jahreSeitAth: 0,
        dynamicFlex: false, goGoActive: false, aktuellesAlter: 70 };
    const engines = [0, 6000, 12000].map(pension => engine.simulateSingleYear({ ...engineInput,
        renteAktiv: pension > 0, renteMonatlich: pension / 12 }, null, { includeFlexTrace: true }));
    const households = [100000, 200000, 300000].map(cash => {
        const input = householdInput(cash, 400000);
        return simulateOneYear(initMcRunState(input), input, marketYear, 0, null, 0, null, 1, engine);
    });
    const singles = [0, 6000, 12000].map(pension => {
        const input = { ...householdInput(200000, 0), startFloorBedarf: 12000, startFlexBedarf: 12000,
            minimumFlexAnnual: 12000, renteMonatlich: pension / 12, liquidityRunwayYears: 5 };
        input.simulationPeople = input.simulationPeople.slice(0, 1);
        input.detailledTranches = input.detailledTranches.slice(0, 1);
        input.depotwertNeu = 1000000; input.startVermoegen = 1200000;
        return simulateOneYear(initMcRunState(input), input, marketYear, 0, null, 0, null, 1, engine);
    });
    return { engines, households, singles };
}
