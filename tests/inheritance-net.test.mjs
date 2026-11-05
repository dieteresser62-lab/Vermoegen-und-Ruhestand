import { inheritancePreview, homeAndTaxEstate, FAMILY_HOME_CONDITIONS } from '../app/profile/household-partnership.js';
import { inheritanceNetProceeds } from '../app/profile/household-inheritance-sale.js';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { personalAssetValues } from '../app/simulator/simulator-unmarried.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { beginPersonalTaxYear, recordPersonalDisposal } from '../app/simulator/simulator-personal-tax.js';
import { homeWasSold, sellHomesForEmergency } from '../app/simulator/simulator-home-sale.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';

const home = { id: 'haus', profileId: 'muster_a', wert: 800000, stand: '2026-10', nutzung: 'selbst' };
const lot = { trancheId: 'estate-equity', sourceProfileId: 'muster_a', type: 'aktien_alt', category: 'equity',
    marketValue: 1000000, costBasis: 500000, tqf: 0, taxExempt: false };
const inputsFor = () => ({ ...structuredClone(fixture), home: [{ ...home }], homeReferenceYear: 2026,
    partnership: { status: 'unmarried', inheritance: { muster_a: 0 }, homeAndTaxInheritance: { muster_a: true } } });
function portfolioFor(cash, own, tranches = [lot]) {
    const portfolio = initMcRunState(inputsFor()).portfolio;
    for (const account of portfolio.personAccounts) Object.assign(account, { tagesgeld: account.profileId === 'muster_a' ? cash : own,
        sparerPauschbetrag: 0, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } });
    Object.assign(portfolio, { depotTranchesAktien: structuredClone(tranches), depotTranchesGold: [], depotTranchesGeldmarkt: [],
        healthBucketTranches: [], healthBucketCashOwners: [], healthBucketCashAmount: 0, healthBucketGeldmarkt: 0 });
    syncPersonalLiquidity(portfolio);
    return portfolio;
}
function inherit(portfolio, inputs = inputsFor(), actionResult = { steuer: 0 }) {
    return applyUnmarriedInheritance({ portfolio, inputs, transition: { deathThisYear: true,
        survivor: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b' } }, inflationFactor: 1,
        pension: { rente1BruttoEigen: 0, rente2BruttoEigen: 0 }, personalInterest: { items: [] }, actionResult });
}
for (const cash of [0, 200000]) for (const own of [0, 100000]) {
    const portfolio = portfolioFor(cash, own), result = inherit(portfolio), estate = result.inheritance;
    // X - (X - Tagesgeld) * 0,5 * 26,375 % = (800.000 + X - 20.000) * 30 %.
    const expectedX = (234000 - cash * .5 * .26375) / (.7 - .5 * .26375);
    assertClose(estate.taxCash, expectedX, .001, 'Handrechnung Netto-X einschließlich Verkaufssteuer');
    assertClose(estate.taxCash - result.inheritancePayment.extraTax, estate.tax, 1, 'X deckt Erbschaft- und Verkaufssteuer');
    assertClose(result.inheritancePayment.shortfall, 0, .001, 'Keine ungedeckte Steuer');
    assertClose(personalAssetValues(portfolio)[0].value, own, 1, 'Eigenes Geld nach Zahlung erhalten');
    const preview = inheritancePreview(1000000 + cash, 800000, 0, { homeAndTax: true, cash, tranches: [lot] });
    assertClose(preview.taxCash, estate.taxCash, .001, 'Vorschau und Simulator: dasselbe X');
    assertClose(preview.tax, estate.tax, .001, 'Vorschau und Simulator: dieselbe Erbschaftsteuer');
    const html = renderProtocolTable([{ jahr: 1, inheritance: estate, erbschaftsteuer: estate.tax, abgang_erben: estate.leaves }],
        { source: 'mc', inputs: inputsFor() });
    assert(html.includes('für Steuern beim Verkauf von Wertpapieren'), 'Protokoll schlüsselt Verkaufssteuer auf X auf');
}
for (const [cash, tranches] of [[1000000, []], [0, [{ ...lot, costBasis: 1000000 }]]]) {
    const estate = inherit(portfolioFor(cash, 0, tranches)).inheritance;
    assertClose(estate.taxCash, 334285.7142857143, .001, 'Nur Tagesgeld oder Depot ohne Gewinn: X wie bisher');
    assertEqual(estate.taxCashSaleTax, 0, 'Ohne Verkaufsgewinn keine Zusatzsteuer');
}
const missing = inheritancePreview(1000000, 800000, 0, { homeAndTax: true });
assert(missing.missingCostBasis && missing.taxCash > 411881, 'Fehlender Einstand wird vorsichtig als null gerechnet');
for (const lossCarry of [0, 200000]) {
    const portfolio = portfolioFor(0, 100000), survivor = portfolio.personAccounts[1];
    survivor.sparerPauschbetrag = 1000; survivor.taxState = { lossCarry };
    const estate = inherit(portfolio).inheritance;
    const expected = lossCarry ? 334285.7142857143 : (234000 - 1000 * .26375) / (.7 - .5 * .26375);
    assertClose(estate.taxCash, expected, .001, 'Kleinstes X nutzt verfügbaren Freibetrag und Verlustvortrag');
    assertClose(personalAssetValues(portfolio)[0].value, 100000, 1, 'Kein überschüssiges X durch doppelte Jahressteuerreserve');
    const preview = inheritancePreview(1000000, 800000, 0, { homeAndTax: true, tranches: [lot],
        sparerPauschbetrag: 1000, taxStatePrev: { lossCarry } });
    assertClose(preview.taxCash, estate.taxCash, .001, 'Vorschaugleichheit einschließlich Freibetrag und Verlustvortrag');
}
{
    const portfolio = portfolioFor(0, 100000); portfolio.personAccounts[1].sparerPauschbetrag = 1000;
    beginPersonalTaxYear(portfolio);
    recordPersonalDisposal(portfolio, { sourceProfileId: 'muster_b', tqf: 0 }, 2000, 1000);
    const result = inherit(portfolio, inputsFor(), { steuer: 0, personalAnnualTaxes: [{ profileId: 'muster_b', taxDue: 0,
        saleTaxDue: 0, taxCashAdjustment: 0, details: {} }] });
    assertClose(result.inheritance.taxCash, 411881.1881188119, .001, 'Bereits verbrauchter Freibetrag wird nicht nochmals für X genutzt');
    assertClose(result.inheritancePayment.shortfall, 0, .001, 'Zahlung trotz verbrauchtem Freibetrag gedeckt');
}
{
    const portfolio = portfolioFor(0, 100000);
    portfolio.depotTranchesAktien.push({ ...lot, trancheId: 'own-equity', sourceProfileId: 'muster_b', marketValue: 200000, costBasis: 200000 });
    inherit(portfolio);
    assertClose(personalAssetValues(portfolio)[0].value, 300000, 1, 'Auch eigenes Depot mit günstigerer Steuer bleibt erhalten');
    assertEqual(portfolio.depotTranchesAktien.find(row => row.trancheId === 'own-equity').marketValue, 200000, 'Kein Verkauf eigener Wertpapiere für X');
}
for (const tqf of [0, .3]) for (const taxExempt of [false, true]) {
    const tranches = [{ ...lot, tqf, taxExempt }];
    const net = inheritanceNetProceeds({ cash: 10000, tranches });
    assertClose(net(110000), 110000 - (taxExempt ? 0 : 100000 * .5 * (1 - tqf) * .26375), .001, 'Teilfreistellung und Steuerfreiheit aus Verkaufsengine');
}
// VF-1: Auch die Steuerabbuchung selbst verkauft gewinnhaltigen Geldmarkt.
{
    const portfolio = portfolioFor(200000, 0, []);
    portfolio.depotTranchesGeldmarkt = [{ trancheId: 'own-money-market', sourceProfileId: 'muster_b',
        type: 'geldmarkt', category: 'money_market', marketValue: 500000, costBasis: 250000, tqf: 0 }];
    syncPersonalLiquidity(portfolio);
    const result = inherit(portfolio);
    const payment = result.inheritancePayment;
    const ownCost = result.erbschaftsteuer - result.inheritance.taxCash;
    const expectedExtraTax = ownCost * .5 * .26375 / (1 - .5 * .26375);
    assert(ownCost > 0 && expectedExtraTax > 0, 'Nachlass lässt einen Steuerrest für eigenes Geld');
    assertClose(payment.shortfall, 0, 1e-7, 'Geldmarktsteuer auf Steuerabbuchungen wird vollständig bezahlt');
    assertClose(payment.extraTax, expectedExtraTax, 1e-7, 'Mehrsteuer einschließlich aller Folgegewinne');
    assertClose(payment.paidTax, payment.extraTax, 1e-7, 'Kein Steuerrest nach letzter Abbuchung');
    assertClose(personalAssetValues(portfolio)[0].value, 500000 - ownCost - expectedExtraTax, 1e-7,
        'Eigenes Depot der Überlebenden bezahlt Steuerrest und Mehrsteuer');
    assert(!homeWasSold(portfolio, home, 0), 'Haus bleibt im Nachlass erhalten');
}
for (const ownMoneyMarket of [false, true]) {
    const input = inputsFor(); Object.assign(input, { startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0,
        renteMonatlich: 0, fixedIncome: [], plannedInflows: [], plannedExpenses: [], pflegefallLogikAktivieren: false,
        tagesgeld: 0, geldmarktEtf: 0, startVermoegen: 1000000, detailledTranches: [structuredClone(lot)],
        depotwertAlt: 1000000, einstandAlt: 500000, depotwertNeu: 0, goldWert: 0 });
    for (const person of input.simulationPeople) Object.assign(person, { tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0 });
    Object.assign(input.partner, { monatsrente: 0, brutto: 0 });
    const state = initMcRunState(input);
    state.portfolio = ownMoneyMarket ? portfolioFor(200000, 0, []) : portfolioFor(0, 0);
    if (ownMoneyMarket) {
        state.portfolio.depotTranchesGeldmarkt = [{ trancheId: 'own-money-market', sourceProfileId: 'muster_b',
            type: 'geldmarkt', category: 'money_market', marketValue: 500000, costBasis: 250000, tqf: 0 }];
        syncPersonalLiquidity(state.portfolio);
    }
    const result = simulateOneYear(state, input, { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Gegenprobe endet im Simulator ohne Abbruch');
    assertClose(result.logData.portfolio_flow_delta, 0, .01, 'Nachlass und Verkaufssteuer bilanziert');
    assert(!result.logData.immobilien_notverkauf, 'Gedeckter Steuerrest löst im Todesjahr keinen Notverkauf aus');
    assert(!result.logData.immobilienverkauf, 'Haus bleibt bei ausreichendem eigenen Geld erhalten');
}
{
    const input = inputsFor(); delete input.partnership.homeAndTaxInheritance;
    const portfolio = portfolioFor(0, 100000), result = inherit(portfolio, input);
    assert(homeWasSold(portfolio, home, 0), 'Immobilie an Dritte verlässt Bestand sofort im Erbfall');
    assert(!portfolio.homeRent && !result.inheritance.inheritedHome, 'Kein Erlös und keine Miete beim Abgang an Dritte');
    const sale = sellHomesForEmergency({ portfolio, state: { survivor: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b' } },
        inputs: input, household: { p1Alive: false, p2Alive: true }, yearIndex: 1, inflationFactor: 1, requiredFloor: 1000000 });
    assertEqual(sale, null, 'Abgegangenes Haus löst keinen späteren Verkauf aus');
}
for (const status of ['married', 'unmarried']) for (const self of [false, true]) for (const percent of [0, 100]) {
    const inputs = inputsFor(); inputs.partnership = { status }; inputs.home[0].nutzung = self ? 'selbst' : 'vermietet';
    const estate = { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b', assets: 1000000, home: 800000,
        inheritedHome: 800000 * percent / 100, inherited: 1000000 * percent / 100, percent, tax: 0, leaves: 0, pensionEnds: 0 };
    const html = renderProtocolTable([{ jahr: 1, inheritance: estate, erbschaftsteuer: 0, abgang_erben: 0 }], { source: 'mc', inputs });
    assertEqual(html.includes('Familienheim-Befreiung angenommen'), status === 'married' && self && percent > 0, 'Hinweis nur bei wirksamer Befreiung');
    if (status === 'married' && self && percent) assert(html.includes(FAMILY_HOME_CONDITIONS), 'Familienheim-Bedingungen im Steuer-ⓘ');
}
for (const sale of [false, true]) for (const level of ['normal', 'detailed']) {
    const entry = { jahr: 2000, row: sale ? { immobilienverkauf: 720000, immobilienverkauf_jahr: 2000 } : {} };
    const columns = getProtocolColumns({ source: 'backtest', logDetailLevel: level,
        rows: [entry] });
    assertEqual(columns.some(column => column.id === 'home-sale'), sale, 'Backtest-Verkaufsspalte folgt dem tatsächlichen Verkauf');
    assertEqual(columns.some(column => column.id === 'home-sale-year'), sale, 'Backtest-Verkaufsjahr folgt dem tatsächlichen Verkauf');
    if (sale) {
        assertEqual(readProtocolValue(columns.find(column => column.id === 'home-sale'), entry, { source: 'backtest' }), 720000, 'Backtest-Spalte liest den Verkaufserlös');
        assertEqual(readProtocolValue(columns.find(column => column.id === 'home-sale-year'), entry, { source: 'backtest' }), 2000, 'Backtest-Spalte liest das Verkaufsjahr');
    }
}
{
    const inputs = inputsFor(); inputs.partnership = { status: 'married' };
    inputs.home.push({ ...home, id: 'zweites-haus' });
    const death = { jahr: 2, abgang_erben: 0, erbschaftsteuer: 0, inheritance: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b',
        assets: 1000000, inherited: 1000000, home: 1600000, inheritedHome: 1600000, percent: 100, tax: 0, leaves: 0, pensionEnds: 0 } };
    assert(renderProtocolTable([death], { inputs }).includes('Steuerfrei ist nur das Familienheim – bei mehreren selbst genutzten Immobilien die wertvollste.'), 'Protokoll erklärt die einzige begünstigte Immobilie');
    inputs.home.pop(); inputs.home.push({ ...home, id: 'wohnung', nutzung: 'vermietet' });
    const sale = { jahr: 1, immobilienverkauf: 720000, immobilienverkauf_personen: [{ profileId: 'muster_a', homeId: 'haus', amount: 720000 }] };
    death.inheritance.home = death.inheritance.inheritedHome = 800000;
    assert(!renderProtocolTable([sale, death], { inputs }).includes('Familienheim-Befreiung angenommen'), 'Nach Verkauf des Familienheims kein Hinweis für die verbleibende Mietwohnung');
}
