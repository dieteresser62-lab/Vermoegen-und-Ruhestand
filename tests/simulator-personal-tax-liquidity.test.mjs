import { initializePortfolio, sumDepot } from '../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { personalProfiles } from '../app/simulator/simulator-personal-accounts.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs } from './extended/parity-replay-fixture.mjs';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';

const rate = .26375;
const person = (profileId, tagesgeld = 0, allowance = 0) => ({ profileId, tagesgeld,
    sparerPauschbetrag: allowance, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } });
const lot = (profileId, value, cost = 0, category = 'equity', id = category) => ({ schemaVersion: 2,
    sourceProfileId: profileId, trancheId: id, marketValue: value, costBasis: cost,
    shares: value, purchasePrice: cost / value, currentPrice: 1, purchaseDate: '2020-01-01',
    tqf: 0, taxExempt: false, category, type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu' });
const portfolioFor = (people, lots = []) => initializePortfolio({ simulationSourceProfileId: people[0].profileId,
    simulationPeople: people, tagesgeld: people.reduce((sum, person) => sum + person.tagesgeld, 0), detailledTranches: lots });
function settle(portfolio, book, mode = 'tax_optimized', plannedActionFlow = null) {
    const action = {};
    const result = settlePersonalTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: action,
        inputs: { householdWithdrawalMode: mode }, plannedActionFlow, regularSaleScale: 0, forcedTaxReserved: 0,
        spendingNewState: {}, didForcedSale: false });
    return { ...result, action };
}
function verifyWealth(portfolio, before, result) {
    assertClose(sumDepot(portfolio) + portfolio.liquiditaet, before + result.taxCashAdjustment, 1e-7,
        'Tax funding preserves wealth apart from actual tax payments');
    assert(portfolio.personAccounts.every(account => account.tagesgeld >= 0 && account.geldmarktEtf >= 0),
        'No personal balance turns negative');
}

{
    const portfolio = portfolioFor([person('a'), person('b', 2000)], [lot('a', 1000)]);
    const balance = attributeHouseholdAction({ profiles: personalProfiles(portfolio), householdAction: {
        type: 'TRANSACTION', verwendungen: { liquiditaet: 736.25 }, quellen: [{
            sourceProfileId: 'a', trancheId: 'a:equity', category: 'equity', kind: 'aktien_neu',
            brutto: 1000, realizedGainSigned: 1000, taxableAfterTqfSigned: 1000, tqf: 0 }] } });
    assertClose(balance.finalAction.steuer, 263.75, 1e-7, 'Balance reserves tax directly from sale proceeds');
    assertClose(balance.profileActions[0].action.nettoErlös, 736.25, 1e-7, 'Balance allocates only net sale proceeds');
    assertEqual(portfolio.personAccounts[1].tagesgeld, 2000, 'Balance planning never executes another person cash debit');
}
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    // A owes tax on 1,000 of already consumed proceeds. Its remaining asset
    // has a 50% gain. FR-16 uses B's cash before creating another taxable gain.
    const portfolio = portfolioFor([person('a'), person('b', 2000)], [lot('a', 10000, 5000)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const before = sumDepot(portfolio) + portfolio.liquiditaet;
    const result = settle(portfolio, book, mode);
    assertClose(result.totalTaxesThisYear, 263.75, 1e-7, `${mode}: partner cash avoids additional sale tax`);
    assertEqual(result.action.personalAnnualTaxes[0].taxFundingGross, 0, `${mode}: no own emergency sale`);
    assertEqual(sumDepot(portfolio), 10000, `${mode}: A keeps its investments`);
    assertClose(portfolio.personAccounts[1].tagesgeld, 1736.25, 1e-7, `${mode}: B cash covers A tax first`);
    assertClose(result.action.personalAnnualTaxes[0].householdTaxFunding[0].amount, 263.75, 1e-7,
        `${mode}: partner contribution belongs to A tax book`);
    assert(!result.taxShortfall, `${mode}: partner cash covers tax`);
    verifyWealth(portfolio, before, result);
}
{
    const portfolio = portfolioFor([person('a'), person('b', 2000)], [lot('a', 10000, 5000)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = .01;
    const result = settle(portfolio, book);
    const expectedTax = .01 * rate;
    assertClose(result.totalTaxesThisYear, expectedTax, 1e-10, 'Sub-cent tax still uses partner liquidity');
    assertEqual(result.action.personalAnnualTaxes[0].taxFundingGross, 0, 'Planner cent rounding must not trigger an own sale');
    assertEqual(sumDepot(portfolio), 10000, 'Sub-cent liability preserves own investments');
    assertClose(result.action.personalAnnualTaxes[0].householdTaxFunding[0].amount, expectedTax, 1e-10,
        'Actual partner payment remains unrounded');
    verifyWealth(portfolio, 12000, result);
}
{
    const portfolio = portfolioFor([person('a'), person('b')], [lot('a', 10000, 5000)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book);
    const expectedTax = 1000 * rate / (1 - .5 * rate);
    assertClose(result.totalTaxesThisYear, expectedTax, 1e-7, 'No partner liquidity: own gain and sale tax settle together');
    assertClose(result.action.personalAnnualTaxes[0].taxFundingGross, expectedTax, 1e-7,
        'Own emergency sale covers tax when household cash is exhausted');
    assert(!result.taxShortfall, 'Own investments still prevent ruin');
    verifyWealth(portfolio, 10000, result);
}
{
    const portfolio = portfolioFor([person('a'), person('b', 100)],
        [lot('a', 10000, 5000), lot('b', 5000, 5000)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book);
    const expectedSale = (263.75 - 100) / (1 - .5 * rate);
    assertClose(result.action.personalAnnualTaxes[0].householdTaxFunding[0].amount, 100, 1e-7,
        'Exhaust partner liquidity before selling own investments');
    assertClose(result.action.personalAnnualTaxes[0].taxFundingGross, expectedSale, 1e-7,
        'Own sale funds only the residual including its new tax');
    assertClose(result.totalTaxesThisYear, 100 + expectedSale, 1e-7, 'Residual sale gain is taxed in the same year');
    assertEqual(portfolio.personAccounts[1].tagesgeld, 0, 'Partner cash is exhausted');
    assertEqual(portfolio.depotTranchesAktien.find(lot => lot.sourceProfileId === 'b').marketValue, 5000,
        'Partner assistance never sells partner investments');
    assert(!result.taxShortfall, 'Partial partner payment and own sale prevent ruin');
    verifyWealth(portfolio, 15100, result);
}
{
    const portfolio = portfolioFor([person('a', 10), person('b', 2000, 1000)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book);
    assertClose(result.totalTaxesThisYear, 263.75, 1e-8, 'B allowance never reduces A liability');
    assertEqual(portfolio.personAccounts[0].tagesgeld, 0, 'Own cash is used first');
    assertClose(portfolio.personAccounts[1].tagesgeld, 1746.25, 1e-8, 'B pays the remaining A tax');
    assertClose(result.action.personalAnnualTaxes[0].householdTaxFunding[0].amount, 253.75, 1e-8,
        'The helper is recorded separately from the taxpayer');
    verifyWealth(portfolio, 2010, result);
}
for (const payer of ['a', 'b']) {
    // Test both processing orders: the helper may already have been settled.
    const helper = payer === 'a' ? 'b' : 'a';
    const portfolio = portfolioFor([person('a'), person('b')],
        [lot(payer, 10000, 5000), lot(helper, 2000, 1000, 'money_market')]);
    const book = beginPersonalTaxYear(portfolio);
    book.find(row => row.profileId === payer).rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book);
    const helperTax = 263.75 * .5 * rate / (1 - .5 * rate);
    assertClose(result.totalTaxesThisYear, 263.75 + helperTax, 1e-7, 'Helper MM gain is taxed on the helper');
    const taxes = result.action.personalAnnualTaxes;
    assertClose(taxes.find(row => row.profileId === payer).taxDue, 263.75, 1e-8, 'Taxpayer liability stays personal');
    assertClose(taxes.find(row => row.profileId === helper).taxDue, helperTax, 1e-7, 'Revisit a helper already settled');
    assertEqual(taxes.find(row => row.profileId === payer).taxFundingGross, 0, 'Partner MM precedes own emergency sale');
    assertEqual(sumDepot(portfolio), 10000, 'Partner MM preserves taxpayer investments');
    verifyWealth(portfolio, 12000, result);
}
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    // Deliberately reverse helper IDs: tax_optimized sorts b before c, the other
    // Balance modes keep household input order. Each helper uses its cash before MM.
    const portfolio = portfolioFor([person('a'), person('c', 40), person('b', 100)],
        [lot('a', 10000, 5000), lot('c', 60, 60, 'money_market'), lot('b', 100, 100, 'money_market')]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book, mode);
    const funding = result.action.personalAnnualTaxes[0].householdTaxFunding;
    const first = mode === 'tax_optimized' ? 'b' : 'c';
    const second = first === 'b' ? 'c' : 'b';
    const firstAmount = first === 'b' ? 200 : 100;
    assertEqual(funding.map(row => row.profileId).join(','), `${first},${second}`, `${mode}: household plan orders helpers`);
    assertClose(funding[0].amount, firstAmount, 1e-8, `${mode}: first helper liquidity exhausted`);
    assertClose(funding[1].amount, 263.75 - firstAmount, 1e-8, `${mode}: second helper covers the remainder`);
    assert(portfolio.personAccounts.every(account => account.tagesgeld === 0), `${mode}: each helper uses TG before MM`);
    assertEqual(portfolio.personAccounts.find(account => account.profileId === first).geldmarktEtf, 0,
        `${mode}: first helper MM exhausted before next account`);
    assertClose(portfolio.personAccounts.find(account => account.profileId === second).geldmarktEtf, 36.25, 1e-8,
        `${mode}: second helper retains unused MM`);
    assertEqual(result.action.personalAnnualTaxes[0].taxFundingGross, 0, `${mode}: all helpers precede own sale`);
    assertEqual(sumDepot(portfolio), 10000, `${mode}: taxpayer investments remain`);
    assert(!result.taxShortfall, `${mode}: three-person household covers tax`);
    verifyWealth(portfolio, 10300, result);
}
{
    const portfolio = portfolioFor([person('a'), person('b', 1000)], [lot('a', 100, 100)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settle(portfolio, book);
    assertEqual(sumDepot(portfolio), 100, 'Household assistance preserves limited own assets');
    assertEqual(result.action.personalAnnualTaxes[0].taxFundingGross, 0, 'No sale when partner cash suffices');
    assertClose(portfolio.personAccounts[1].tagesgeld, 736.25, 1e-8, 'Household cash covers the whole tax');
    assert(!result.taxShortfall, 'Partner cash is sufficient');
    verifyWealth(portfolio, 1100, result);
}
{
    const portfolio = portfolioFor([person('a'), person('b')]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    book[1].reserved = 300;
    const result = settle(portfolio, book);
    assert(!result.taxShortfall, 'Another person refund becomes available before declaring ruin');
    assertClose(portfolio.liquiditaet, 36.25, 1e-8, 'Refund and household payment reconcile');
}
{
    const portfolio = portfolioFor([person('a', 10), person('b', 20)]);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const planned = { quellen: [], steuer: 0 };
    const result = settle(portfolio, book, 'tax_optimized', planned);
    assertClose(result.taxShortfall, 233.75, 1e-8, 'Exhausted household returns financial shortfall');
    assertEqual(portfolio.liquiditaet, 0, 'Insufficient household cash is fully consumed');
    assert(!result.action.taxSettlement.executedTaxContract, 'An unpaid tax is never marked reconciled');
    verifyWealth(portfolio, 30, result);
}
{
    // A tax debt generated by a real MM payout, through the full year adapter.
    const input = { ...structuredClone(inputs), dynamicFlex: false, simulationSourceProfileId: 'a',
        simulationPeople: [person('a'), person('b')], goldStrategyDiagnostics: undefined,
        startVermoegen: 1000, depotwertAlt: 0, einstandAlt: 0, tagesgeld: 0, geldmarktEtf: 1000,
        startFloorBedarf: 1000, startFlexBedarf: 0, minimumFlexAnnual: 0, renteMonatlich: 0,
        partner: { aktiv: false }, zielLiquiditaet: 0, startSPB: 0,
        detailledTranches: [lot('a', 1000, 0, 'money_market')] };
    const year = { jahr: 2000, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 };
    const result = simulateOneYear(initMcRunState(input, 100), input, year, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'ruin', 'Uncovered tax uses the ordinary financial ruin outcome');
    assertEqual(result.isRuin, true, 'Ruin flags agree');
    assertClose(result.ruinDetails.taxShortfallNominal, 263.75, 1e-8, 'Ruin identifies the unpaid tax');
    assertEqual(result.ruinDetails.shortfallNominal, 0, 'An already paid floor is not reported as unpaid');
    assertEqual(result.logData.terminal_reason, 'personal_tax_shortfall', 'Terminal diagnostic explains tax ruin');
    const invalid = simulateOneYear(initMcRunState(input, 100), input, { ...year, zinssatz: NaN }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(invalid.kind, 'technical_error', 'Malformed market data remains a technical error');
    const mc = await runMonteCarloChunk({ inputs: input, monteCarloParams: { anzahl: 1, maxDauer: 1,
        blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
        widowOptions: normalizeWidowOptions(input.widowOptions), useCapeSampling: false, engine: EngineAPI });
    assertEqual(mc.financialMetricsValid, true, 'Financial failure remains evaluable in MC');
    assertEqual(mc.totals.outcomeRuinCount, 1, 'MC counts uncovered tax as ruin');
    assertEqual(mc.technicalInventory.technicalError, 0, 'MC tax ruin is no technical error');
}
{
    const input = { ...structuredClone(inputs), ...dynamicFlexPresetPatch('offensiv') };
    const mc = await runMonteCarloChunk({ inputs: input, monteCarloParams: { anzahl: 100, maxDauer: 26,
        blockSize: 3, seed: 12345, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
        runRange: { start: 16, count: 1 }, widowOptions: normalizeWidowOptions(input.widowOptions),
        useCapeSampling: true, engine: EngineAPI });
    assertEqual(mc.financialMetricsValid, true, 'PA-A8 Offensiv run 16 completes without the year 21 exception');
    assertEqual(mc.technicalInventory.financiallyEvaluable, 1, 'Reproduced run is financially evaluable');
    assertEqual(mc.totals.outcomeAllDeadCount, 1, 'Reproduced run reaches the all-dead terminal outcome');
    assert(mc.totals.totalSimulatedYears > 21, 'Reproduced run passes the formerly failing year');
}
