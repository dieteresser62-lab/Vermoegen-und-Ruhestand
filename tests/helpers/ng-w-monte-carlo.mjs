// NG-W: synthetischer Einzelhaushalt für die Monte-Carlo-Statistik bei Ruin und Stress, keine Nutzerdaten.
import { EngineAPI } from '../../engine/index.mjs';
import { prepareHistoricalDataOnce } from '../../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloSimulation } from '../../app/simulator/monte-carlo-runner.js';

globalThis.window ||= {};
globalThis.window.EngineAPI = EngineAPI;
prepareHistoricalDataOnce();

export const base = () => ({
    startAlter: 65, geschlecht: 'm', startVermoegen: 750000, depotwertAlt: 250000, einstandAlt: 200000, zielLiquiditaet: 45000,
    startFloorBedarf: 24000, startFlexBedarf: 12000, rebalancingBand: 25, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
    liquidityRunwayYears: 3, goldAktiv: false, goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: true, startSPB: 1000,
    kirchensteuerSatz: 0, rentAdjMode: 'fix', rentAdjPct: 0, renteMonatlich: 0, renteStartOffsetJahre: 0, dynamicFlex: false,
    horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85, goGoActive: false, goGoMultiplier: 1.0,
    capeRatio: 0, marketCapeRatio: 0, stressPreset: 'NONE', pflegefallLogikAktivieren: false, partner: { aktiv: false },
    accumulationPhase: { enabled: false }, transitionYear: 0
});
// Grundbedarf weit über dem Vermögen: Jeder Lauf ist im ersten Jahr aufgebraucht.
export const ruinInFirstYear = stressPreset => ({ ...base(), startAlter: 20, startVermoegen: 1, depotwertAlt: 1, einstandAlt: 1,
    zielLiquiditaet: 0, startFloorBedarf: 1000000, startFlexBedarf: 0, stressPreset });
const widowOptions = { mode: 'stop', percent: 0, marriageOffsetYears: 0, minMarriageYears: 0 };
export const run = async (inputs, anzahl, maxDauer) => {
    const simulation = await runMonteCarloSimulation({ inputs, widowOptions, useCapeSampling: false, engine: EngineAPI,
        monteCarloParams: { anzahl, maxDauer, blockSize: 4, seed: 24680, methode: 'block', rngMode: 'per-run-seed' } });
    return Object.assign(simulation.aggregatedResults, { failCountForTest: simulation.failCount });
};
export const stressKey = 'STAGFLATION_70s';
