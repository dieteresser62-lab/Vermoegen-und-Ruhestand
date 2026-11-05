// Ausschließlich synthetische Eingaben mit runden Beträgen.
export const ffgInput = {
    depotwertAlt: 1000000, depotwertNeu: 0, tagesgeld: 200000, geldmarktEtf: 0,
    floorBedarf: 24000, flexBedarf: 30000, minimumFlexAnnual: 0, inflation: 0,
    renteAktiv: true, renteMonatlich: 2500, goldAktiv: false,
    dynamicFlex: true, goGoActive: true, goGoMultiplier: 1.2,
    horizonYears: 20, aktuellesAlter: 65, liquidityRunwayYears: 5,
    maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
    endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, ath: 100, jahreSeitAth: 0,
    risikoprofil: 'sicherheits-dynamisch'
};

export function unchangedFFG(engine) {
    const staticResults = [false, true].flatMap(goGoActive => [0, 24000, 36000].flatMap(pension =>
        [100, 70, 110].map(level => engine.simulateSingleYear({ ...ffgInput,
            dynamicFlex: false, goGoActive, renteMonatlich: pension / 12,
            endeVJ: level, ath: 100, jahreSeitAth: level < 100 ? 3 : 0
        }, null, { includeFlexTrace: true }))));
    const dynamicUnaffected = [false, true].flatMap(goGoActive => [
        // Geschützte Quote über 2 %: bisherige S-Kurve unverändert.
        { floorBedarf: 60000, minimumFlexAnnual: 30000, renteAktiv: false },
        // Keine Vermögensdämpfung und damit keine S-Kurven-Kürzung.
        { depotwertAlt: 10000000 },
        // Dynamischer Bedarf unter Wunsch-Flex: FR-32 bleibt unverändert.
        { flexBedarf: 120000, horizonYears: 40 }
    ].map(patch => engine.simulateSingleYear({ ...ffgInput, goGoActive, ...patch }, null,
        { includeFlexTrace: true })));
    return { staticResults, dynamicUnaffected };
}
