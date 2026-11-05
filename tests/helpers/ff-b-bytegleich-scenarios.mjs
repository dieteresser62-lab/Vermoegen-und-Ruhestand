export function unchangedEngineSamples(engine) {
    const input = { depotwertAlt: 500000, depotwertNeu: 0, goldWert: 0, tagesgeld: 100000, geldmarktEtf: 0,
        inflation: 2, floorBedarf: 20000, flexBedarf: 20000, minimumFlexAnnual: 10000,
        goldAktiv: false, goldFloorProzent: 0, renteAktiv: false, renteMonatlich: 0,
        liquidityRunwayYears: 5, rebalancingBand: 25, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 5,
        risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
        endeVJ_3: 100, ath: 100, jahreSeitAth: 0, horizonYears: 30, marketCapeRatio: 25 };
    return [false, true].flatMap(dynamicFlex => [0, 2, 4].map(inflation =>
        engine.simulateSingleYear({ ...input, dynamicFlex, inflation }, null, { includeFlexTrace: true })));
}
export function unchangedSimulatorSamples({ initMcRunState, simulateOneYear, engine }) {
    const input = { startAlter: 65, startVermoegen: 600000, depotwertAlt: 500000, einstandAlt: 400000,
        tagesgeld: 100000, geldmarktEtf: 0, startFloorBedarf: 20000, startFlexBedarf: 20000, minimumFlexAnnual: 10000,
        flexBudgetAnnual: 0, flexBudgetRecharge: 0, renteMonatlich: 0, renteStartOffsetJahre: 0, rentAdjPct: 0,
        goldAktiv: false, goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: false,
        risikoprofil: 'sicherheits-dynamisch', rebalancingBand: 25, liquidityRunwayYears: 5,
        maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 5, marketCapeRatio: 25, capeRatio: 25,
        kirchensteuerSatz: 0, startSPB: 1000, dynamicFlex: false, goGoActive: false,
        pflegefallLogikAktivieren: false, geschlecht: 'm', partner: { aktiv: false }, accumulationPhase: { enabled: false } };
    return [0, 2, 4].map(inflation => simulateOneYear(initMcRunState(input), input,
        { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 1, inflation, lohn: 0 },
        0, null, 0, null, 1, engine));
}
