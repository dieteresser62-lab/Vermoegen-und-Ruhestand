export const marketYear = { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 };
export const syntheticLot = (profileId, marketValue, costBasis, category = 'equity') => ({ schemaVersion: 2,
    sourceProfileId: profileId, trancheId: `${profileId}:${category}`, marketValue, costBasis,
    shares: marketValue, purchasePrice: costBasis / marketValue, currentPrice: 1, purchaseDate: '2020-01-01',
    tqf: 0, taxExempt: false, category, type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu' });
export function householdInput(cashA = 30000, cashB = 400000) {
    return { startAlter: 65, startVermoegen: 2000000 + cashA + cashB, depotwertAlt: 0, depotwertNeu: 2000000,
        einstandNeu: 2000000, tagesgeld: cashA + cashB, geldmarktEtf: 0,
        startFloorBedarf: 0, startFlexBedarf: 60000, minimumFlexAnnual: 60000,
        flexBudgetAnnual: 0, flexBudgetRecharge: 0, renteMonatlich: 0, renteStartOffsetJahre: 0, rentAdjPct: 0,
        goldAktiv: false, goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: false,
        risikoprofil: 'sicherheits-dynamisch', rebalancingBand: 25, liquidityRunwayYears: 1,
        maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0, marketCapeRatio: 25, capeRatio: 25,
        kirchensteuerSatz: 0, startSPB: 2000, dynamicFlex: false, goGoActive: false,
        pflegefallLogikAktivieren: false, geschlecht: 'm', partner: { aktiv: false }, accumulationPhase: { enabled: false },
        householdWithdrawalMode: 'tax_optimized', simulationSourceProfileId: 'a',
        simulationPeople: [cashA, cashB].map((tagesgeld, index) => ({ profileId: index ? 'b' : 'a',
            name: index ? 'Erika Mustermann' : 'Max Mustermann', tagesgeld, sparerPauschbetrag: 1000,
            kirchensteuerSatz: 0, taxState: { lossCarry: 0 } })),
        detailledTranches: [syntheticLot('a', 1000000, 1200000), syntheticLot('b', 1000000, 800000)] };
}
export function unchangedHouseholdSamples({ initMcRunState, simulateOneYear, engine }) {
    return [0, 2, 4].map(inflation => {
        const input = householdInput(200000, 400000);
        const state = initMcRunState(input);
        Object.assign(state.marketDataHist, { endeVJ: 80, endeVJ_1: 90, endeVJ_2: 100, ath: 100, jahreSeitAth: 3 });
        return simulateOneYear(state, input, { ...marketYear, inflation }, 0, null, 0, null, 1, engine);
    });
}
export async function unchangedPayoutPaths({ runFixture, runMonteCarloChunk, engine }) {
    const input = { ...householdInput(300000, 300000), liquidityRunwayYears: 10 };
    const backtest = runFixture({ input, selectedPeriod: { startYear: 2000, endYear: 2002 } });
    const mc = await runMonteCarloChunk({ inputs: input, widowOptions: { mode: 'none', percent: 0 },
        monteCarloParams: { anzahl: 1, maxDauer: 3, methode: 'regime_markov', seed: 12345 },
        runRange: { start: 0, count: 1 }, logIndices: [0], useCapeSampling: false, engine });
    return { backtest: { rows: backtest.rows, outcome: backtest.outcome }, mc: mc.runMeta[0].logDataRows };
}
