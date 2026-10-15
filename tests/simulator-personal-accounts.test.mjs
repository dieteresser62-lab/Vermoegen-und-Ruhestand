import { simulateOneYear as importYear } from '../app/simulator/simulator-engine-wrapper.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { buildInputsCtxFromPortfolio, applySaleToPortfolio, buyStocksNeu } from '../app/simulator/simulator-portfolio-tranches.js';
import { personalProfiles, personalWithdrawalPlan, debitPersonalLiquidity, applyPersonalInterest,
    applyPersonalTaxAdjustment, creditPersonalSale, snapshotPersonalInvestments, personalPurchaseFunding } from '../app/simulator/simulator-personal-accounts.js';
import { applyHealthBucketCoverage } from '../app/simulator/simulator-health-bucket.js';
import { createParityReplayCollector } from '../app/simulator/parity-replay-collector.js';
import { evaluateParityBalanceReplayYear } from '../app/balance/parity-balance-replay.js';
import { runFixture, inputs, records, source } from './extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../engine/index.mjs';

const lot = (id, profileId, value, cost, category = 'equity') => ({ schemaVersion: 2, trancheId: id, sourceProfileId: profileId,
    marketValue: value, costBasis: cost, shares: value, purchasePrice: cost / value, currentPrice: 1,
    type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu', category,
    purchaseDate: '2020-01-01', tqf: 0, taxExempt: false });
const fixture = () => initializePortfolio({ tagesgeld: 300, simulationSourceProfileId: 'a',
    simulationPeople: [{ profileId: 'a', tagesgeld: 100 }, { profileId: 'b', tagesgeld: 200 }],
    detailledTranches: [lot('a-eq', 'a', 400, 200), lot('b-eq', 'b', 800, 800),
        lot('a-mm', 'a', 200, 150, 'money_market'), lot('b-mm', 'b', 400, 400, 'money_market')] });
const assertAccounts = portfolio => {
    assertClose(portfolio.liquiditaet, portfolio.tagesgeld + portfolio.geldmarktEtf, 1e-8, 'Pool equals continued components');
    assertClose(portfolio.liquiditaet, portfolio.personAccounts.reduce((sum, p) => sum + p.tagesgeld + p.geldmarktEtf, 0), 1e-8, 'Personal balances reconcile');
    for (const p of portfolio.personAccounts) assert(p.tagesgeld >= 0 && p.geldmarktEtf >= 0, 'Personal accounts remain nonnegative');
};
for (const [mode, expected] of [['tax_optimized', [0, 300]], ['proportional', [100, 200]], ['runway_first', [150, 150]]]) {
    const portfolio = fixture();
    const profiles = personalProfiles(portfolio);
    const plan = personalWithdrawalPlan(profiles, 300, mode);
    const payout = debitPersonalLiquidity(portfolio, 300, plan);
    for (let i = 0; i < 2; i++) {
        const id = ['a', 'b'][i], row = payout.items.find(row => row.profileId === id);
        assertClose(row.amount, expected[i], 1e-8, `${mode}: payout for ${id}`);
        assertClose(row.tagesgeldUsed, Math.min([100, 200][i], expected[i]), 1e-8, `${mode}: Tagesgeld first`);
        assertClose(row.geldmarktUsed, Math.max(0, expected[i] - [100, 200][i]), 1e-8, `${mode}: money market second`);
    }
    assert(!payout.restCause, 'Sufficient personal liquidity needs no reallocation');
    assertAccounts(portfolio);
}
{
    const portfolio = fixture();
    const payout = debitPersonalLiquidity(portfolio, 700, personalWithdrawalPlan(personalProfiles(portfolio), 700, 'tax_optimized'));
    assertEqual(payout.restCause, 'personal_payout_exceeds_owned_liquidity', 'Liquidity-driven deviation names the remaining source-selection cause');
    assertClose(payout.total, 700, 1e-8, 'No money fabricated or lost during fallback');
    const money = portfolio.depotTranchesGeldmarkt.find(lot => lot.sourceProfileId === 'b');
    assertEqual(money.marketValue, 0, 'Fully spent MM lot is exhausted');
    assertEqual(money.costBasis, 0, 'Sold MM cost basis is exhausted');
    assertEqual(money.shares, 0, 'Sold MM shares are exhausted');
    assertAccounts(portfolio);
    debitPersonalLiquidity(portfolio, portfolio.liquiditaet);
    const ctx = buildInputsCtxFromPortfolio({ tagesgeld: 300, geldmarktEtf: 600 }, portfolio, {});
    assertEqual(ctx.tagesgeld, 0, 'Zero cash never falls back to initial cash');
    assertEqual(ctx.geldmarktEtf, 0, 'Zero MM never falls back to initial MM');
}
{
    const portfolio = fixture();
    const interest = applyPersonalInterest(portfolio, 0.1);
    assertClose(interest.interest, 90, 1e-8, 'Interest equals all current personal liquidity');
    assertClose(portfolio.personAccounts[0].tagesgeld, 110, 1e-8, 'Cash interest stays with owner');
    assertClose(portfolio.personAccounts[1].geldmarktEtf, 440, 1e-8, 'MM interest stays with owner');
    assertEqual(portfolio.depotTranchesGeldmarkt[0].costBasis, 150, 'MM interest does not increase acquisition cost');
    applyPersonalTaxAdjustment(portfolio, -9, interest);
    assertClose(portfolio.personAccounts[0].tagesgeld, 107, 1e-8, 'Pooled interest tax booked to source accounts');
    assertClose(portfolio.personAccounts[1].tagesgeld, 214, 1e-8, 'Pooled interest tax follows interest origin');
    applyPersonalInterest(portfolio, -0.1);
    assertAccounts(portfolio);
}
{
    const portfolio = fixture();
    const before = snapshotPersonalInvestments(portfolio);
    const sources = [{ trancheId: 'a-eq', sourceProfileId: 'a', kind: 'aktien_neu', brutto: 100, steuer: 10 },
        { trancheId: 'b-eq', sourceProfileId: 'b', kind: 'aktien_neu', brutto: 100, steuer: 0 }];
    applySaleToPortfolio(portfolio, { breakdown: sources });
    const funding = creditPersonalSale(portfolio, before, 190, sources);
    assertClose(portfolio.personAccounts[0].tagesgeld, 190, 1e-8, 'Seller receives their own net proceeds');
    assertClose(portfolio.personAccounts[1].tagesgeld, 300, 1e-8, 'Other seller receives their net proceeds');
    for (const row of personalPurchaseFunding(portfolio, 95, funding)) buyStocksNeu(portfolio, row.amount, row.profileId);
    const purchases = portfolio.depotTranchesAktien.filter(lot => lot.trancheId.startsWith('simlot:'));
    assertClose(purchases.find(lot => lot.sourceProfileId === 'a').marketValue, 45, 1e-8, 'Reinvestment belongs to financing owner a');
    assertClose(purchases.find(lot => lot.sourceProfileId === 'b').marketValue, 50, 1e-8, 'Reinvestment belongs to financing owner b');
    applyPersonalTaxAdjustment(portfolio, 10, { items: [] }, funding);
    assertClose(portfolio.personAccounts[0].tagesgeld, 155, 1e-8, 'Sale tax refund returns to the reserving seller');
    assertClose(portfolio.personAccounts[1].tagesgeld, 250, 1e-8, 'No unrelated personal refund');
    assertAccounts(portfolio);
}
{
    const before = JSON.stringify(records);
    const collector = createParityReplayCollector({ source, initialRecords: records });
    const run = runFixture({ collector });
    const log = collector.toLog();
    assertEqual(run.outcome.kind, 'completed', 'Real multi-year household runner completes');
    for (const year of log.years) {
        const replay = evaluateParityBalanceReplayYear(log, year.yearIndex, { engineApi: EngineAPI });
        assert(replay.calculation && replay.householdResult, 'Personal accounts replay through actual Balance');
        assertClose(year.cashAndLots.componentCash.tagesgeld + year.cashAndLots.componentCash.geldmarktEtf,
            year.engineInput.aktuelleLiquiditaet, 1e-8, 'Next-year components equal actual pool');
        for (const person of year.cashAndLots.cashOwnership.persons) {
            const profile = replay.calculation.profiles.find(p => p.profileId === person.profileId);
            assertClose(profile.inputs.tagesgeld, person.tagesgeld, 1e-8, 'Balance receives actual personal cash');
            assertClose(profile.inputs.geldmarktEtf, person.geldmarktEtf, 1e-8, 'Balance receives actual personal MM');
        }
        assertClose(run.rows[year.yearIndex].row.portfolio_flow_delta, 0, 0.01, 'Year flow remains balanced');
    }
    assertEqual(JSON.stringify(records), before, 'Saved profile records stay unchanged');
    const accumulation = runFixture({ input: { ...inputs, accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 2 } });
    assertEqual(accumulation.outcome.kind, 'completed', 'Accumulation transitions into withdrawal with same accounts');
    for (const { row } of accumulation.rows) assertClose(row.portfolio_flow_delta, 0, 0.01, 'Accumulation/withdrawal flow reconciles');
}
{
    const legacy = initializePortfolio({ startVermoegen: 100, depotwertAlt: 0, tagesgeld: 0, geldmarktEtf: 0.5 });
    assertEqual(legacy.geldmarktEtf, 0.5, 'Sub-euro legacy MM balance remains readable');
    assertAccounts(legacy);
    const portfolio = initializePortfolio({ tagesgeld: 300, simulationSourceProfileId: 'a', detailledTranches: [],
        simulationPeople: [{ profileId: 'a', tagesgeld: 100 }, { profileId: 'b', tagesgeld: 200 }],
        healthBucket: { enabled: true, initialAmount: 200, triggerMinGrade: 4 } });
    assertEqual(portfolio.personAccounts[0].tagesgeld, 0, 'Reserved personal cash leaves operating account');
    assertEqual(portfolio.personAccounts[1].tagesgeld, 100, 'Remaining reserve comes from actual second account');
    const result = applyHealthBucketCoverage({ portfolio, forcedShortfall: 200, careFloorAddition: 200,
        pflegeMeta: { active: true, grade: 4, zusatzFloorZiel: 200 } });
    assertClose(result.consumedCash.reduce((sum, row) => sum + row.amount, 0), 200, 1e-8, 'Reserve payout retains personal cash provenance');
}

{
    const portfolio = fixture();
    debitPersonalLiquidity(portfolio, 400, personalWithdrawalPlan(personalProfiles(portfolio), 400, 'tax_optimized'));
    const money = portfolio.depotTranchesGeldmarkt.find(lot => lot.sourceProfileId === 'b');
    assertEqual(money.marketValue, 200, 'Partial MM payout reduces actual value');
    assertEqual(money.costBasis, 200, 'Partial MM payout reduces cost basis proportionally');
    assertEqual(money.shares, 200, 'Partial MM payout reduces shares proportionally');
    const before = portfolio.liquiditaet;
    const payout = debitPersonalLiquidity(portfolio, 100.126, personalWithdrawalPlan(personalProfiles(portfolio), 100.126, 'proportional'));
    assertClose(payout.total, 100.126, 1e-8, 'Cent allocation never overpays an unrounded debit');
    assertClose(portfolio.liquiditaet, before - 100.126, 1e-8, 'Subcent debit reconciles exactly');
}

{
    const retained = [];
    runFixture({ simulate(state, ...args) {
        if (state.portfolio.personAccounts) retained.push({ portfolio: state.portfolio,
            accounts: JSON.stringify(state.portfolio.personAccounts), liquidity: state.portfolio.liquiditaet });
        return importYear(state, ...args);
    } });
    for (const row of retained) {
        assertEqual(JSON.stringify(row.portfolio.personAccounts), row.accounts, 'Following years leave prior account snapshots intact');
        assertEqual(row.portfolio.liquiditaet, row.liquidity, 'Following years leave prior liquidity totals intact');
    }
}
