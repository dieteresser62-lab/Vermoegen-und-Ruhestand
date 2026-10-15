import { initializePortfolio, applySaleToPortfolio } from '../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, recordPersonalSales, settlePersonalTaxYear, attributeSimulatorAction,
    coverPersonalPayout } from '../app/simulator/simulator-personal-tax.js';
import { debitPersonalLiquidity, snapshotPersonalInvestments, applyPersonalInterest } from '../app/simulator/simulator-personal-accounts.js';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { inputs, runFixture } from './extended/parity-replay-fixture.mjs';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { records } from './extended/parity-replay-fixture.mjs';

const lot = (owner, id, value, cost, tqf = .3, category = 'equity') => ({ schemaVersion: 2,
    sourceProfileId: owner, trancheId: id, marketValue: value, costBasis: cost,
    shares: value, purchasePrice: cost / value, currentPrice: 1, purchaseDate: '2020-01-01',
    tqf, taxExempt: false, category, type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu' });
const person = (id, cash, spb, carry = 0, church = 0) => ({ profileId: id, tagesgeld: cash,
    sparerPauschbetrag: spb, kirchensteuerSatz: church, taxState: { lossCarry: carry } });
const finish = (portfolio, book, interest = { items: [] }) => {
    const actionResult = {};
    const result = settlePersonalTaxYear({ portfolio, book, personalInterest: interest, actionResult,
        plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false });
    return { ...result, action: actionResult };
};

for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    const people = [{ ...person('a', 1000, 1000), liquidityRunwayYears: 3 },
        { ...person('b', 1000, 0), liquidityRunwayYears: 7 }];
    const portfolio = initializePortfolio({ tagesgeld: 2000, simulationSourceProfileId: 'a', simulationPeople: people,
        detailledTranches: [lot('a', 'gain', 10000, 0), lot('b', 'neutral', 10000, 10000)] });
    beginPersonalTaxYear(portfolio);
    const action = attributeSimulatorAction(portfolio, { type: 'TRANSACTION', verwendungen: { liquiditaet: 5000 },
        quellen: [{ sourceProfileId: 'b', trancheId: 'neutral', kind: 'aktien_neu', category: 'equity',
            brutto: 5000, netto: 5000, steuer: 0, tqf: .3, gainQuoteSigned: 0, taxableAfterTqfSigned: 0 }] },
    { householdWithdrawalMode: mode });
    const grossA = action.quellen.filter(source => source.sourceProfileId === 'a').reduce((sum, row) => sum + row.brutto, 0);
    const grossB = action.quellen.filter(source => source.sourceProfileId === 'b').reduce((sum, row) => sum + row.brutto, 0);
    const expectedTax = mode === 'tax_optimized' ? 0 : mode === 'proportional'
        ? (.7 * ((5000 - 263.75) / (2 - .7 * .26375)) - 1000) * .26375
        : (5000 * .3 * .7 - 1000) * .26375 / (1 - .3 * .7 * .26375);
    assertClose(action.steuer, expectedTax, 1e-7, `${mode}: Balance source planner preserves personal allowance`);
    assertClose(action.nettoErlös, 5000, 1e-7, `${mode}: personal taxes preserve the household use`);
    if (mode === 'tax_optimized') { assertEqual(grossA, 0, 'Tax optimization uses the zero-gain owner'); assertClose(grossB, 5000, 1e-7, 'Selected original ID is executable'); }
    else assertClose(grossA / (grossA + grossB), mode === 'proportional' ? .5 : .3, 1e-7, `${mode}: sale ownership follows Balance weights`);
}

{
    // A realizes 4,000 gain, 30% exempt, with 300 carry and 1,000 allowance.
    // B's 9,000 loss must never reduce A's 1,500 tax base.
    const portfolio = initializePortfolio({ tagesgeld: 20000, simulationSourceProfileId: 'a',
        simulationPeople: [person('a', 10000, 1000, 300, .08), person('b', 10000, 1000)],
        detailledTranches: [lot('a', 'gain', 10000, 6000), lot('b', 'loss', 10000, 19000, 0)] });
    const book = beginPersonalTaxYear(portfolio);
    const before = snapshotPersonalInvestments(portfolio);
    applySaleToPortfolio(portfolio, { breakdown: [
        { sourceProfileId: 'a', trancheId: 'gain', kind: 'aktien_neu', brutto: 10000 },
        { sourceProfileId: 'b', trancheId: 'loss', kind: 'aktien_neu', brutto: 10000 }] });
    recordPersonalSales(portfolio, before);
    const result = finish(portfolio, book);
    assertClose(result.totalTaxesThisYear, 1500 * .25 * (1 + .055 + .08), 1e-8, 'Personal church tax, TQF, allowance and carry');
    assertClose(portfolio.personAccounts[0].tagesgeld, 10000 - 425.625, 1e-8, 'Tax charged only to gain owner');
    assertEqual(portfolio.personAccounts[0].taxState.lossCarry, 0, 'A consumes only own carry');
    assertEqual(portfolio.personAccounts[1].taxState.lossCarry, 9000, 'B carries own loss into next year');
    assertEqual(portfolio.personAccounts[1].tagesgeld, 10000, 'Other person funds no tax');
    const next = finish(portfolio, beginPersonalTaxYear(portfolio));
    assertEqual(next.totalTaxesThisYear, 0, 'New annual allowance does not create a carry refund');
    assertEqual(portfolio.personAccounts[1].taxState.lossCarry, 9000, 'Carry persists across years');
}
{
    const portfolio = initializePortfolio({ tagesgeld: 1000, simulationSourceProfileId: 'a',
        simulationPeople: [person('a', 1000, 100), person('b', 0, 1000, 500)],
        detailledTranches: [lot('a', 'money', 2000, 1000, 0, 'money_market')] });
    const book = beginPersonalTaxYear(portfolio);
    const payout = debitPersonalLiquidity(portfolio, 1500, { mode: 'proportional',
        items: [{ profileId: 'a', withdrawalAmount: 1500 }, { profileId: 'b', withdrawalAmount: 0 }] });
    const result = finish(portfolio, book);
    // MM tax itself is paid by realizing more of the same 50%-gain lot.
    const tax = (250 - 100) * .26375 / (1 - .5 * .26375);
    assertClose(result.totalTaxesThisYear, tax, 1e-7, 'Money-market realization and its tax funding settle once');
    assertClose(portfolio.liquiditaet, 1500 - tax, 1e-7, 'Tax leaves actual owned liquidity');
    assertClose(payout.total, 1500, 1e-8, 'Tax settlement preserves actual payout');
    assertEqual(portfolio.personAccounts[1].taxState.lossCarry, 500, 'MM never uses another person carry');
    assertClose(portfolio.depotTranchesGeldmarkt[0].shares, portfolio.liquiditaet, 1e-7, 'MM shares follow tax-funded disposal');
}
{
    const portfolio = initializePortfolio({ tagesgeld: 1000, simulationSourceProfileId: 'a',
        simulationPeople: [person('a', 1000, 0), person('b', 0, 0)],
        detailledTranches: [lot('a', 'money', 1000, 1000, 0, 'money_market')] });
    const book = beginPersonalTaxYear(portfolio);
    const interest = applyPersonalInterest(portfolio, .1);
    const result = finish(portfolio, book, interest);
    assertClose(result.totalTaxesThisYear, 100 * .26375, 1e-8, 'Cash interest taxed now; unrealized MM growth stays in cost-based lot');
    assertEqual(portfolio.depotTranchesGeldmarkt[0].costBasis, 1000, 'MM growth retains acquisition basis');
}
{
    const portfolio = initializePortfolio({ tagesgeld: 1000, simulationSourceProfileId: 'a',
        simulationPeople: [person('a', 1000, 0), person('b', 0, 1000)],
        detailledTranches: [lot('b', 'owned', 10000, 10000)] });
    beginPersonalTaxYear(portfolio);
    coverPersonalPayout(portfolio, { items: [{ profileId: 'b', withdrawalAmount: 2000 }] }, {});
    const paid = debitPersonalLiquidity(portfolio, 2000, { mode: 'tax_optimized',
        items: [{ profileId: 'b', withdrawalAmount: 2000 }, { profileId: 'a', withdrawalAmount: 0 }] });
    assertEqual(paid.items[0].amount, 2000, 'Payout owner sells own investments even when other owner has cash');
    assertEqual(portfolio.personAccounts[0].tagesgeld, 1000, 'Unrelated cash owner remains intact');
    assert(!paid.restCause, 'Personal sale covers the planned payout');
}
{
    const registry = JSON.parse(records.rs_profiles_v1);
    const entry = registry.profiles.muster_b;
    const stateKey = 'ruhestandsmodellValues_v29_guardrails';
    const data = { ...entry.data };
    const state = JSON.parse(data[stateKey]);
    state.lastState.taxState = { lossCarry: 2345 };
    data[stateKey] = JSON.stringify(state);
    const projected = buildSimulatorInputsFromProfileData(data, { referenceYear: 2026 });
    assertEqual(projected.taxState.lossCarry, 2345, 'Existing Balance personal loss carry feeds the simulator');
    const combined = combineSimulatorProfiles([{ profileId: 'b', inputs: projected }], 'b').combined;
    assertEqual(combined.simulationPeople[0].taxState.lossCarry, 2345, 'Profile merge preserves personal carry');
}
{
    const run = runFixture();
    assertEqual(run.outcome.kind, 'completed', 'Household backtest completes');
    for (const { row } of run.rows) {
        assertClose(row.portfolio_flow_delta, 0, .01, 'Personal annual settlement reconciles wealth');
        assertEqual(row.personalTaxModel, 'personal_annual_settlement', 'Log identifies actual personal model');
    }
    const accumulation = runFixture({ input: { ...inputs, accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 2 } });
    assertEqual(accumulation.outcome.kind, 'completed', 'Accumulation and withdrawal use personal taxes');
    for (const { row } of accumulation.rows) assertClose(row.portfolio_flow_delta, 0, .01, 'Accumulation flow includes interest tax');
    const params = { anzahl: 4, maxDauer: 12, blockSize: 3, seed: 12345, methode: 'block',
        rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    const mc = await runMonteCarloChunk({ inputs, monteCarloParams: params,
        widowOptions: normalizeWidowOptions(inputs.widowOptions), useCapeSampling: true, engine: EngineAPI });
    assertEqual(mc.financialMetricsValid, true, 'MC personal tax books remain evaluable');
    const sweep = await runSweepChunk({ baseInputs: inputs, paramCombinations: [{ liquidityRunwayYears: 3 }, { liquidityRunwayYears: 5 }],
        sweepConfig: { ...params, anzahl: 2, useCapeSampling: true }, engine: EngineAPI });
    assertEqual(sweep.results.length, 2, 'Sweep returns both combinations with personal settlement');
}
