// FR-88: Dynamic Flex rechnet die VPW-Rate vorschüssig, r / ((1 + r)(1 − (1 + r)^−n)).
// Über die öffentliche EngineAPI: Die Rate selbst gehört nicht zur Core-Fassade (core-contract, module-boundaries).
import { EngineAPI } from '../engine/index.mjs';

const input = { depotwertAlt: 500000, depotwertNeu: 0, goldWert: 0, tagesgeld: 100000, geldmarktEtf: 0,
    inflation: 2, floorBedarf: 20000, flexBedarf: 20000, minimumFlexAnnual: 10000,
    goldAktiv: false, goldFloorProzent: 0, renteAktiv: false, renteMonatlich: 0,
    liquidityRunwayYears: 5, rebalancingBand: 25, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 5,
    risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
    endeVJ_3: 100, ath: 100, jahreSeitAth: 0, marketCapeRatio: 25, dynamicFlex: true };
const vpw = horizonYears => {
    const result = EngineAPI.simulateSingleYear({ ...input, horizonYears });
    assert(!result.error, `Engine rechnet Dynamic Flex mit Horizont ${horizonYears}`);
    return result.ui.vpw;
};

const one = vpw(1);
assertEqual(one.horizonYears, 1, 'Horizont 1 Jahr kommt unverändert an');
assert(one.expectedRealReturn > 0.01, 'Erwartete Realrendite ist positiv');
assertClose(one.vpwRate, 1.00, 1e-12, 'n = 1: das ganze Vermögen zu Jahresbeginn, nicht 1 + r');

const twenty = vpw(20);
const r = twenty.expectedRealReturn;
assertEqual(twenty.horizonYears, 20, 'Horizont 20 Jahre kommt unverändert an');
assertClose(r, 0.0383333, 1e-6, 'CAPE 25: erwartete Realrendite 3,83 %');
assertClose(twenty.vpwRate, r / ((1 + r) * (1 - Math.pow(1 + r, -20))), 1e-12, 'n = 20: vorschüssige Rate');
assertClose(twenty.vpwRate, 0.069823, 5e-6, 'n = 20, r = 3,83 %: 6,982 %');
assertClose(twenty.vpwRate * (1 + r), r / (1 - Math.pow(1 + r, -20)), 1e-12, 'Die nachschüssige Rate wäre um den Faktor 1 + r größer');
console.log('FR-88: vorschüssige VPW-Rate geprüft.');
