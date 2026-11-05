import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { preparePlayAction } from '../app/balance/balance-play-execution.js';
import { initializePortfolio, buyStocksNeu, calculateTrancheTax } from '../app/simulator/simulator-portfolio.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { EngineAPI } from '../engine/index.mjs';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { equityPurchaseTemplate } from '../types/tranche-contract.js';

const stock = (trancheId, tqf, purchaseDate = '2024-01-01') => ({ schemaVersion: 2, trancheId,
    name: trancheId, ticker: 'TEST.DE', isin: '', type: 'aktien_neu', category: 'equity',
    shares: 100, purchasePrice: 100, currentPrice: 100, purchaseDate, tqf, taxExempt: false });
const cases = [
    async function personalTemplates() {
      const tied = [stock('z', .3), stock('a', 0)];
      assertEqual(equityPurchaseTemplate(tied).trancheId, 'a', 'QS-E 1: gleiche Kaufdaten werden durch die stabile ID entschieden');
      assertEqual(equityPurchaseTemplate([...tied].reverse()).trancheId, 'a', 'QS-E 1: ID-Entscheidung unabhängig von Eingabereihenfolge');
      for (const reordered of [false, true]) {
        const seed = createMusterHaushaltRecords('2026-11-02');
        const registry = JSON.parse(seed.rs_profiles_v1), ids = Object.keys(registry.profiles);
        const lots = [[stock('a-only', 0)], [stock('b-newer', .3, '2025-01-01'), ...(reordered ? [stock('b-older', 0)] : [])]];
        ids.forEach((id, i) => { registry.profiles[id].data.depot_tranchen = JSON.stringify(lots[i]); });
        seed.rs_profiles_v1 = JSON.stringify(registry);
        seed.depot_tranchen = registry.profiles[seed.rs_current_profile].data.depot_tranchen;
        const fixture = await playFixture('localstorage', seed);
        let controller = await fixture.boot();
        await controller.start(async () => ({ source: 'copy', testDate: '2026-11-02' }));
        controller = await fixture.boot();
        const prepared = await preparePlayAction({ controller, id: 'qs-e', entries: ids.map(profileId => ({ profileId,
            action: { quellen: [], verwendungen: { aktien: 1000 } } })) });
        const next = JSON.parse(prepared.records.rs_profiles_v1);
        const portfolio = initializePortfolio({ tagesgeld: 0, simulationSourceProfileId: ids[0],
            simulationPeople: ids.map(profileId => ({ profileId, tagesgeld: 0 })),
            detailledTranches: lots.flatMap((rows, i) => rows.map(lot => ({ ...lot, sourceProfileId: ids[i] }))) });
        for (const id of ids) {
            const balanceLot = JSON.parse(next.profiles[id].data.depot_tranchen).find(lot => lot.trancheId === `qs-e-${id}-buy-aktien`);
            const simLot = buyStocksNeu(portfolio, 1000, id);
            assertEqual(balanceLot.tqf, simLot.tqf, 'QS-E 1: persönliche Teilfreistellung in Balance und Simulator gleich');
            assertEqual(balanceLot.tqf, id === ids[0] || reordered ? 0 : .3, 'QS-E 1: persönliche Neubestand-Vorlage bestimmt den Kauf');
            assertEqual(balanceLot.name, id === ids[0] ? 'a-only' : reordered ? 'b-older' : 'b-newer', 'QS-E 1: Balance kauft das persönliche Instrument');
        }
        portfolio.depotTranchesAktien.reverse();
        const again = buyStocksNeu(portfolio, 1000, ids[1]);
        assertEqual(again.tqf, reordered ? 0 : .3, 'QS-E 1: Zwischensortierung ändert die festgelegte Vorlage nicht');
        portfolio.depotTranchesAktien = [];
        assertEqual(buyStocksNeu(portfolio, 1000, ids[1]).tqf, reordered ? 0 : .3, 'QS-E 1: Vorlage bleibt nach vollständigem Verkauf erhalten');
      }
    },
    async function legacyTemplates() {
        const portfolio = initializePortfolio({ startVermoegen: 100000, depotwertAlt: 100000,
            einstandAlt: 100000, tqfAlt: 0, tqfNeu: .3, tagesgeld: 0, geldmarktEtf: 0, goldAktiv: false });
        const bought = buyStocksNeu(portfolio, 10000);
        assertEqual(bought.tqf, .3, 'QS-E 2: aggregiertes Altformat behält tqfNeu beim Nachkauf');
        bought.marketValue = 20000;
        assertClose(calculateTrancheTax(bought, 20000, 0, 0).steuer, 1846.25, .001,
            'QS-E 2: späterer Verkauf besteuert den Gewinn mit der konfigurierten Teilfreistellung');
        const mixed = initializePortfolio({ startVermoegen: 200000, depotwertAlt: 100000,
            einstandAlt: 100000, tqfAlt: 0, tqfNeu: .3, tagesgeld: 0, geldmarktEtf: 0, goldAktiv: false });
        mixed.depotTranchesAktien = mixed.depotTranchesAktien.filter(lot => lot.type === 'aktien_alt');
        assertEqual(buyStocksNeu(mixed, 1000).tqf, .3, 'QS-E 2: tqfNeu gilt auch nach vollständigem Verkauf des bisherigen Neubestands');
        for (const people of [undefined, [{ profileId: 'single', tagesgeld: 0 }]]) {
            const detailed = initializePortfolio({ tagesgeld: 0, simulationPeople: people,
                detailledTranches: [stock('ownerless', 0)] });
            const lot = buyStocksNeu(detailed, 1000, people?.[0].profileId);
            assertEqual(lot.tqf, 0, 'QS-E 2: eigentümerlose Einzelperson behält vorhandene Steuermerkmale');
            assertEqual(lot.sourceProfileId, people?.[0].profileId || 'simulation', 'QS-E 2: Einzelperson bestimmt Eigentümer');
            assertEqual(detailed.depotTranchesAktien[0].sourceProfileId, lot.sourceProfileId,
                'QS-E 2: Eigentümer wird bereits am Detailbestand ergänzt');
        }
    },
    async function accumulationTax() {
        const base = await measurementInputs(0, 'sophie', '2026-10-23');
        const money = { ...stock('money', 0), type: 'geldmarkt', category: 'money_market', shares: 1000 };
        const year = { jahr: 2000, rendite: 0, gold_eur_perf: 0, bond_return: 0, inflation: 0, zinssatz: 4, lohn: 0 };
        for (const invest of [false, true]) {
            const results = [];
            for (const personal of [false, true]) {
                const inputs = { ...base, startFloorBedarf: invest ? 0 : 30000, startFlexBedarf: 0,
                    minimumFlexAnnual: 0, dynamicFlex: false, liquidityRunwayYears: 5,
                    renteAktiv: false, renteMonatlich: 0, partner: { aktiv: false },
                    detailledTranches: [money], simulationSourceProfileId: 'single', tagesgeld: 0,
                    simulationPeople: personal ? [{ profileId: 'single', tagesgeld: 0, sparerPauschbetrag: 1000 }] : undefined,
                    plannedExpenses: [], startSPB: 1000, kirchensteuerSatz: 0, accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 3 };
                const result = simulateOneYear(initMcRunState(inputs, 4), inputs, year, 0, null, 0, null, 1, EngineAPI);
                assertEqual(result.kind, 'success', 'QS-E 3: Anspargegenprobe abgeschlossen');
                results.push(result);
                if (!invest) {
                    assertEqual(result.totalTaxesThisYear, 0, 'QS-E 3: unveräußerte Geldmarktgewinne bleiben steuerfrei');
                    assertEqual(result.logData.portfolio_total_end, 104000, 'QS-E 3: 104000 Euro bleiben vollständig im Geldmarkt');
                    assertEqual(result.newState.portfolio.depotTranchesGeldmarkt[0].shares, 1000, 'QS-E 3: unveränderter Anteilbestand');
                    if (!personal) {
                        const state = initMcRunState(inputs, 4);
                        state.lastState = { taxState: { lossCarry: 5000 } };
                        const carry = simulateOneYear(state, inputs, year, 0, null, 0, null, 1, EngineAPI);
                        assertEqual(carry.newState.lastState.taxState.lossCarry, 5000,
                            'QS-E 3: unveräußerte Gewinne verbrauchen auch im Folgejahreszustand keinen Verlustvortrag');
                    }
                }
            }
            assertClose(results[0].totalTaxesThisYear, results[1].totalTaxesThisYear, .000001,
                'QS-E 3: auch realisierte Geldmarktgewinne werden in beiden Formaten gleich besteuert');
            assertClose(results[0].logData.portfolio_total_end, results[1].logData.portfolio_total_end, .01,
                'QS-E 3: Endvermögen unabhängig von persönlichen Pauschbetragsdaten');
            if (invest) assert(results[0].totalTaxesThisYear > 791, 'QS-E 3: realisierte Geldmarktgewinne sind steuerpflichtig');
        }
    }
];
const oldDate = getAppTestDate(), saved = { document: globalThis.document, window: globalThis.window };
const failures = [];
try {
    for (const run of cases) {
        try { await run(); } catch (error) { failures.push(error); }
        P.resetPersistenceRuntimeForTests();
    }
} finally { Object.assign(globalThis, saved); setAppTestDate(oldDate); }
if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'));
