import { householdInput, syntheticLot } from './ff-c-scenarios.mjs';

// Nur die historischen Jahreskennungen stammen aus dem Befund. Personen,
// Eigentumsverteilung, Steuerbasis und alle Geldwerte sind synthetisch.
export const fffHistoricalYears = [2010, 2014, 1980, 1999, 2002, 2001, 1988];
export const fffMonteCarloParameters = { anzahl: 2000, maxDauer: 7, blockSize: 1, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };

export function fffHousehold() {
    const input = { ...householdInput(50000, 0), startVermoegen: 3850000,
        depotwertNeu: 3400000, einstandNeu: 1700000, geldmarktEtf: 400000,
        startFloorBedarf: 24000, startFlexBedarf: 60000, minimumFlexAnnual: 0,
        renteMonatlich: 10000 / 12, rentAdjMode: 'wage',
        partner: { aktiv: true, startAlter: 63, geschlecht: 'w', monatsrente: 10000 / 12, brutto: 10000, rentAdjPct: 0 },
        liquidityRunwayYears: 5, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
        kirchensteuerSatz: .09, dynamicFlex: true, horizonYears: 25,
        detailledTranches: [
            { ...syntheticLot('b', 3400000, 1700000), tqf: .3 },
            syntheticLot('a', 400000, 200000, 'money_market')
        ] };
    input.simulationPeople.forEach(person => { person.kirchensteuerSatz = .09; });
    return input;
}

// Gegenprobe mit anfangs vollständig gedecktem Grundbedarf und einem kleinen
// eigenen Depot: auf ba789814 entsteht genau im siebten Jahr ein Steuer-Ruin.
export function fffYearSevenHousehold() {
    const input = fffHousehold();
    input.renteMonatlich = 12000 / 12;
    input.partner.brutto = 12000;
    input.partner.monatsrente = 12000 / 12;
    input.tagesgeld = 0;
    input.geldmarktEtf = 450000;
    input.simulationPeople[0].tagesgeld = 0;
    input.detailledTranches = [
        { ...syntheticLot('b', 3200000, 1600000), tqf: .3 },
        syntheticLot('a', 450000, 225000, 'money_market'),
        { ...syntheticLot('a', 200000, 100000), tqf: .3 }
    ];
    return input;
}

export function fffHistory({ engine, initMcRunState, simulateOneYear, annualData, computeRentAdjRate }, input = fffHousehold()) {
    let state = initMcRunState(input, annualData.findIndex(year => year.jahr === 2010));
    const results = [];
    for (const [index, year] of fffHistoricalYears.entries()) {
        const data = annualData.find(row => row.jahr === year);
        const result = simulateOneYear(state, { ...input, rentAdjPct: computeRentAdjRate(input, data) },
            data, index, null, 0, null, 1, engine);
        results.push(result);
        state = result.newState;
        if (result.kind !== 'success') break;
    }
    return results;
}

export function fffDynamicEngineSamples(engine) {
    return [0, 6000, 12000].map(pension => engine.simulateSingleYear({
        depotwertAlt: 3400000, depotwertNeu: 0, tagesgeld: 450000, geldmarktEtf: 0,
        floorBedarf: 24000, flexBedarf: 60000, minimumFlexAnnual: 0, inflation: 0,
        goldAktiv: false, renteAktiv: pension > 0, renteMonatlich: pension / 12,
        liquidityRunwayYears: 5, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
        risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
        ath: 100, jahreSeitAth: 0, dynamicFlex: true, goGoActive: false,
        aktuellesAlter: 65, capeRatio: 25, horizonYears: 25
    }, null, { includeFlexTrace: true }));
}
