import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { initializePortfolio, sumDepot } from '../app/simulator/simulator-portfolio.js';
import { beginAggregateTaxYear, settleAggregateTaxYear } from '../app/simulator/simulator-personal-tax.js';

const base = await measurementInputs(0, 'sophie', '2026-10-23');
const year = { jahr: 2000, rendite: 0, gold_eur_perf: 0, bond_return: 0, inflation: 0, zinssatz: 4, lohn: 0 };
for (const jointAssessment of [true, false]) for (const invest of [true, false]) for (const carry of [0, 3000, 5000]) {
    const results = [];
    for (const personal of [false, true]) {
        const input = { ...base, dynamicFlex: false, goldAktiv: false, startFloorBedarf: invest ? 0 : 30000,
            startFlexBedarf: 0, minimumFlexAnnual: 0, liquidityRunwayYears: 5, renteAktiv: false,
            renteMonatlich: 0, partner: { aktiv: false }, tagesgeld: 0, simulationSourceProfileId: 'a',
            simulationPeople: ['a', 'b'].map(profileId => ({ profileId, tagesgeld: 0,
                ...(personal ? { sparerPauschbetrag: profileId === 'a' || jointAssessment ? 1000 : 0,
                    taxState: { lossCarry: profileId === 'a' ? carry : 0 } } : {}) })),
            detailledTranches: [{ schemaVersion: 2, sourceProfileId: 'a', trancheId: 'mm', type: 'geldmarkt',
                category: 'money_market', marketValue: 100000, costBasis: 100000, shares: 100000,
                purchasePrice: 1, currentPrice: 1, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false }],
            plannedExpenses: [], jointAssessment, startSPB: jointAssessment ? 2000 : 1000, kirchensteuerSatz: 0,
            accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 3 };
        const state = initMcRunState(input, 4);
        state.lastState = { taxState: { lossCarry: carry } };
        const result = simulateOneYear(state, input, year, 0, null, 0, null, 1, EngineAPI);
        assertEqual(result.kind, 'success', 'QS-I 1: Paar-Ansparjahr ist berechenbar');
        const expectedTax = invest ? Math.max(0, 4000 - carry - input.startSPB) * .26375 : 0;
        assertClose(result.totalTaxesThisYear, expectedTax, .000001, 'QS-I 1: nur realisierte Gewinne werden besteuert');
        assertClose(result.logData.portfolio_total_end, 104000 - expectedTax, .01, 'QS-I 1: Steuer mindert Endvermögen');
        assertClose(result.logData.portfolio_flow_delta, 0, .01, 'QS-I 1: Steuerfinanzierung wahrt Vermögensfluss');
        if (!personal) assertEqual(result.newState.lastState.taxState.lossCarry, invest ? Math.max(0, carry - 4000) : carry,
            'QS-I 1: aggregierter Verlustvortrag bleibt für das Folgejahr erhalten');
        results.push(result);
    }
    assertClose(results[0].totalTaxesThisYear, results[1].totalTaxesThisYear, .000001, 'QS-I 1: beide Eingabeformate stimmen überein');
}

// Steuerdeckung nach Kauf bleibt auch ohne persönliche Steuerdaten nachvollziehbar.
const funded = [];
for (const personal of [false, true]) {
    const input = { ...base, dynamicFlex: false, goldAktiv: false, startFloorBedarf: 0, startFlexBedarf: 0,
        minimumFlexAnnual: 0, renteAktiv: false, renteMonatlich: 0, partner: { aktiv: false },
        tagesgeld: 0, simulationSourceProfileId: 'a', jointAssessment: true, startSPB: 2000, kirchensteuerSatz: 0,
        simulationPeople: ['a', 'b'].map(profileId => ({ profileId, tagesgeld: 0,
            ...(personal ? { sparerPauschbetrag: 1000, taxState: { lossCarry: 0 } } : {}) })),
        detailledTranches: ['money_market', 'equity'].map((category, index) => ({ schemaVersion: 2,
            sourceProfileId: 'a', trancheId: category, type: index ? 'aktien_neu' : 'geldmarkt', category,
            marketValue: 100000, costBasis: index ? 0 : 100000, shares: 100000,
            purchasePrice: index ? 0 : 1, currentPrice: 1, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false })),
        plannedExpenses: [], accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 3 };
    const result = simulateOneYear(initMcRunState(input, 4), input, year, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'QS-I 1: Steuerdeckung aus bestehenden Aktien gelingt');
    assertClose(result.totalTaxesThisYear, 527.5, .000001, 'QS-I 1: gewinnfreier Steuerverkauf erhält die korrekte Steuer');
    assert(result.logData.tax_funding_sale_gross > 0, 'QS-I 1: Steuerverkauf bleibt auch im Altformat nachvollziehbar');
    assertClose(result.logData.portfolio_total_end, 204000 - result.totalTaxesThisYear, .01,
        'QS-I 1: gesamte Verkaufssteuer mindert das Vermögen genau einmal');
    assertClose(result.logData.portfolio_flow_delta, 0, .01, 'QS-I 1: Steuerfinanzierung erzeugt kein Geld');
    funded.push(result);
}
assertClose(funded[0].totalTaxesThisYear, funded[1].totalTaxesThisYear, .000001,
    'QS-I 1: zusätzliche Steuerverkäufe werden mit und ohne persönliche Daten gleich besteuert');

{
    const portfolio = initializePortfolio({ tagesgeld: 0, simulationSourceProfileId: 'a',
        simulationPeople: [{ profileId: 'a', tagesgeld: 0 }, { profileId: 'b', tagesgeld: 0 }],
        detailledTranches: [{ schemaVersion: 2, sourceProfileId: 'a', trancheId: 'gain', type: 'aktien_neu', category: 'equity',
            marketValue: 100000, costBasis: 0, shares: 100000, purchasePrice: 0, currentPrice: 1,
            purchaseDate: '2020-01-01', tqf: 0, taxExempt: false }] });
    const book = beginAggregateTaxYear(portfolio);
    Object.assign(book[0].rawAggregate, { sumRealizedGainSigned: 4000, sumTaxableAfterTqfSigned: 4000 });
    const action = {}, next = {};
    const result = settleAggregateTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: action,
        spendingNewState: next, inputs: { startSPB: 2000, kirchensteuerSatz: 0 }, taxStatePrev: { lossCarry: 0 } });
    assert(result.totalTaxesThisYear > 527.5, 'QS-I 1: nötige Steuerverkäufe mit Gewinn werden erneut abgerechnet');
    assertClose(result.totalTaxesThisYear, (2000 + result.taxFundingSaleGross) * .26375, .000001,
        'QS-I 1: gesamte zusätzliche Verkaufssteuer steckt im selben Abschluss');
    assertClose(sumDepot(portfolio) + portfolio.liquiditaet, 100000 - result.totalTaxesThisYear, .000001,
        'QS-I 1: Verkauf und Steuerfinanzierung sind vermögensneutral bis auf Steuer');
    assert(!result.taxShortfall, 'QS-I 1: genügend Aktien decken die vollständige Steuer');
}
