import { readRNG1Hash } from './helpers/rng-1-expectations.mjs';
import { readNR1Hash } from './helpers/nr-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { runFixture } from './extended/parity-replay-fixture.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { beginPersonalTaxYear, coverPersonalPayout } from '../app/simulator/simulator-personal-tax.js';
import { householdInput, syntheticLot, marketYear, unchangedHouseholdSamples, unchangedPayoutPaths } from './helpers/ff-c-scenarios.mjs';
const run = input => {
    const state = initMcRunState(input);
    Object.assign(state.marketDataHist, { endeVJ: 50, endeVJ_1: 90, endeVJ_2: 100, ath: 100, jahreSeitAth: 3 });
    return simulateOneYear(state, input, marketYear, 0, null, 0, null, 1, EngineAPI);
};
for (const cashB of [400000, 20000]) {
    const input = householdInput(30000, cashB);
    const result = run(input), row = result.logData;
    assertEqual(result.kind, 'success', 'FR-27: synthetisches Haushaltsjahr auswertbar');
    assertEqual(row.Regime, 'bear_deep', 'Bärenmarkt im synthetischen Befund');
    assertEqual(row.entscheidung.jahresEntnahme, 60000, 'Auszahlung bleibt 60.000 Euro');
    assertEqual(row.executedSaleEq, cashB === 400000 ? 0 : 10000, 'Nur die Haushaltslücke wird verkauft');
    assertEqual(row.vk.vkAkt, row.executedSaleEq, 'Verkauf zur Auszahlung steht in vkAkt');
    assertEqual(row.vk.stAkt, 0, 'Verlustverkauf bleibt steuerfrei');
    assertEqual(row.liquiditaet, cashB === 400000 ? 370000 : 0, 'Haushaltsliquidität deckt Auszahlung zuerst');
    assertEqual(row.personalPayout.items.find(item => item.profileId === 'a').amount, cashB === 400000 ? 30000 : 40000, 'A zahlt Liquidität plus nur nötigen Verkauf');
    assertEqual(row.personalPayout.items.find(item => item.profileId === 'b').amount, cashB === 400000 ? 30000 : 20000, 'B zahlt den Liquiditätsrest');
    assertClose(row.portfolio_flow_delta, 0, .01, 'Vermögensfluss stimmt');
    const b = result.newState.portfolio.depotTranchesAktien.find(lot => lot.sourceProfileId === 'b');
    assertEqual(b.marketValue, 1000000, 'B verkauft keine Gewinntranchen');
    if (cashB === 20000) {
        assert(row.aktionUndGrund.includes('Verkauf für die Auszahlung'), 'Aktion nennt den Deckungsverkauf');
        assert(!row.aktionUndGrund.includes('Kein Handlungsbedarf'), 'Verkauf und Nichtstun schließen sich aus');
    }
}
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    // Reihenfolge absichtlich entgegen den Profil-IDs; je Person TG vor MM.
    const input = householdInput(10000, 10000);
    input.simulationPeople.reverse();
    input.detailledTranches.push(syntheticLot('b', 20000, 20000, 'money_market'), syntheticLot('a', 30000, 30000, 'money_market'));
    const portfolio = initMcRunState(input).portfolio;
    const plan = personalWithdrawalPlan(personalProfiles(portfolio), 50000, mode);
    assertEqual(plan.items[0].profileId, 'b', `${mode}: Reihenfolge aus Haushalt & Plan`);
    assertEqual(plan.items[0].tagesgeldUsed, 10000, `${mode}: Tagesgeld zuerst`);
    assertEqual(plan.items[0].geldmarktUsed, mode === 'tax_optimized' ? 20000 : mode === 'proportional' ? 14879.23 : 15000, `${mode}: danach eigenes Geldmarktguthaben`);
    assertEqual(plan.items.reduce((sum, item) => sum + item.sellAmount, 0), 0, `${mode}: kein Verkauf bei genug Haushaltsliquidität`);
    beginPersonalTaxYear(portfolio);
    const coverage = coverPersonalPayout(portfolio, plan, {});
    assertEqual(coverage.raised, 0, `${mode}: auch Ausführung verkauft nichts`);
    const paid = debitPersonalLiquidity(portfolio, 50000, plan);
    assertEqual(paid.total, 50000, `${mode}: gesamte Auszahlung gedeckt`);
    assertEqual(portfolio.personAccounts.find(person => person.profileId === 'a').tagesgeld, 0, `${mode}: Tagesgeld der ersten Person genutzt`);
    assertClose(portfolio.liquiditaet, 20000, 1e-8, `${mode}: nur der Auszahlungsbetrag verlässt die Konten`);
}
// Vor FF-C gemessene vollständige Ergebnisse, ohne Feldfilter oder Rundung.
const unchanged = unchangedHouseholdSamples({ initMcRunState, simulateOneYear, engine: EngineAPI });
for (const result of unchanged) {
    assertEqual(result.kind, 'success', 'Unbetroffener Haushalt läuft');
    assertEqual(result.logData.executedSaleEq, 0, 'Erste Person hat eigene Liquidität');
    assertEqual(result.logData.personalPayout.items[1].amount, 0, 'Zweite Person wird nicht benötigt');
    assert(!result.logData.SurvivorDeathYear && !result.logData.WidowBenefitP1 && !result.logData.WidowBenefitP2, 'Ohne Tod und Hinterbliebenenrente');
}
assertEqual(createHash('sha256').update(JSON.stringify(unchanged)).digest('hex'),
    'f3a6f21d17f4590e7b7ba0c9376c60b3fe88351089445397be1368f1da3179d5', 'Drei vollständige Haushaltsjahre nach BK-2 auf Referenz');
for (const grade of [4, 5]) {
    const input = { ...householdInput(200000, 400000), startFloorBedarf: 20000, startFlexBedarf: 60000,
        minimumFlexAnnual: 0, dynamicFlex: true };
    const state = initMcRunState(input);
    Object.assign(state.lastState, { initialized: true, flexRate: 100, vpwSafetyStage: 2, vpwLastDynamicFlex: 300000 });
    const care = { active: true, grade, flexFactor: 0, zusatzFloorZiel: 10000 };
    const result = simulateOneYear(state, input, marketYear, 0, care, 10000,
        { p1Alive: true, p2Alive: false, care: { p1: care } }, 0, EngineAPI);
    assertEqual(result.kind, 'success', 'Null-Flex mit Pflege läuft');
    assertEqual(result.logData.flex_wunsch_haushalt_nominal, 0, 'Pflegegrad setzt Wunsch-Flex auf null');
    assertEqual(result.logData.entscheidung.kuerzungProzent, 0, 'Null-Wunsch wird nicht gekürzt');
    assertEqual(result.logData.entscheidung.anmerkung, `kein Flex (Pflegegrad ${grade})`, 'Pflegegrund statt irreführender Kürzung');
    assert(!result.ui.vpw.enabled && result.ui.vpw.wishFlexCapApplied, 'Sicherheitsboden wird bei ausgeschaltetem Dynamic Flex begrenzt');
    assert(result.logData.aktionUndGrund.includes('Sicherheitsboden begrenzt'), 'Protokoll benennt Sicherheitsboden');
    assert(!result.logData.aktionUndGrund.includes('Dynamic-Flex-Obergrenze'), 'Kein Dynamic-Flex-Text bei ausgeschalteter Dynamik');
}

const paths = await unchangedPayoutPaths({ runFixture, runMonteCarloChunk, engine: EngineAPI });
assertEqual(paths.backtest.outcome.kind, 'completed', 'Unbetroffener Backtest 2000–2002 vollständig');
for (const rows of [paths.backtest.rows.map(entry => entry.row), paths.mc]) {
    assertEqual(rows.length, 3, 'Vollständiger Dreijahrespfad');
    for (const row of rows) {
        assertEqual(row.Person1Alive, 1, 'Kein Todesfall im Vergleichspfad');
        assertEqual(row.executedSaleEq, 0, 'Kein Verkauf für den Vergleichspfad');
        assertEqual(row.personalPayout.items[1].amount, 0, 'Erste gewählte Person deckt Auszahlung allein');
    }
}
assertEqual(createHash('sha256').update(JSON.stringify(paths)).digest('hex'),
    readRNG1Hash(readNR1Hash('518735a217b66489dbfdc7872e71d8c7941662a32b1b024b6986209ea3d0d1f3')),
    'Vollständige Backtest-/MC-Jahreslogs samt Backtest-Ende nach FR-30 gegen BK-2-Referenz');
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    const input = householdInput(0, 0);
    input.detailledTranches = [syntheticLot('a', 1000000, 1200000), syntheticLot('b', 1000000, 1200000)];
    const portfolio = initMcRunState(input).portfolio;
    beginPersonalTaxYear(portfolio);
    const plan = personalWithdrawalPlan(personalProfiles(portfolio), 60000, mode);
    const coverage = coverPersonalPayout(portfolio, plan, {});
    const paid = debitPersonalLiquidity(portfolio, 60000, plan);
    assertEqual(coverage.raised, 60000, `${mode}: ohne Liquidität wird genau der Bedarf verkauft`);
    for (const item of plan.items) assertEqual(paid.items.find(row => row.profileId === item.profileId).amount,
        item.withdrawalAmount, `${mode}: Ausführung hält die gemeinsame Balance-Verteilung ein`);
}
{
    const input = householdInput(0, 0);
    input.detailledTranches = [syntheticLot('a', 1000000, 800000), syntheticLot('b', 1000000, 200000)];
    input.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; });
    const result = run(input);
    assertEqual(result.kind, 'success', 'Steuerpflichtiger Deckungsverkauf bleibt auswertbar');
    assert(result.logData.vk.stAkt > 0, 'Steuer des Deckungsverkaufs erscheint in stAkt');
    assertClose(result.logData.vk.stAkt, result.ui.action.personalAnnualTaxes.reduce((sum, row) => sum + row.saleTaxDue, 0), 1e-8,
        'stAkt enthält die endgültige persönliche Verkaufssteuer');
    assertClose(result.logData.portfolio_flow_delta, 0, .01, 'Steuerpflichtige Deckung erhält den Vermögensfluss');
}
