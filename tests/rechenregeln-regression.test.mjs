import { capitalGainsTaxRate, settleTaxYear } from '../engine/tax-settlement.mjs';
import { calculateTrancheTax } from '../app/simulator/simulator-portfolio-tranches.js';
import { computePensionNext, computeRentAdjRate, computeYearlyPension } from '../app/simulator/simulator-portfolio-pension.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';

for (const [kiSt, percent] of [[0, 26.375], [.08, 27.8186], [.09, 27.9951]]) {
    const rate = capitalGainsTaxRate(kiSt);
    assertEqual(Number((rate * 100).toFixed(4)), percent, 'Gemeinsamer Steuersatz nach § 32d Abs. 1 EStG');
    const tax = settleTaxYear({ rawAggregate: { sumTaxableAfterTqfSigned: 10000 }, sparerPauschbetrag: 1000, kirchensteuerSatz: kiSt });
    assertClose(tax.taxDue, 9000 * rate, 1e-9, 'Jahresabrechnung nutzt denselben Satz nach Pauschbetrag');
    const sale = calculateTrancheTax({ marketValue: 20000, costBasis: 10000, tqf: 0 }, 20000, 1000, kiSt);
    assertClose(sale.steuer, tax.taxDue, 1e-9, 'Simulatorverkauf und Engineabrechnung stimmen überein');
}
for (const [mode, lohn, inflation, expected] of [['wage', -.9, 1, 0], ['wage', 2, 1, 2], ['cpi', 1, -.5, 0], ['cpi', 1, 2, 2], ['fix', 2, 2, -1]]) {
    const rate = computeRentAdjRate({ rentAdjMode: mode, rentAdjPct: -1 }, { lohn, inflation });
    assertEqual(rate, expected, `${mode}: Anpassung mit Rentengarantie; feste Eingabe bleibt erhalten`);
    assertClose(computePensionNext(12000, false, 12000, rate), 12000 * (1 + expected / 100), 1e-9, 'Jahresrente');
    assertEqual(computeAdjPctForYear({ inputs: { rentAdj: { mode, pct: -1 } }, series: { startYear: 2000, wageGrowth: [lohn], inflationPct: [inflation] }, simStartYear: 2000 }, 0), expected, 'Backtest nutzt dieselbe Garantie');
    const legacyMode = { wage: 'lohn', cpi: 'inflation', fix: 'fest' }[mode];
    assertClose(computeYearlyPension({ yearIndex: 1, baseMonthly: 1000, startOffset: 0, lastAnnualPension: 12000,
        indexierungsArt: legacyMode, inflRate: inflation, lohnRate: lohn, festerSatz: -1 }), 12000 * (1 + expected / 100), 1e-9, 'Auch alter Rentenhelfer hält die Garantie ein');
}
let pension = 12000;
for (const lohn of [-.9, 2]) pension = computePensionNext(pension, false, 12000, computeRentAdjRate({ rentAdjMode: 'wage' }, { lohn }));
assertEqual(pension, 12240, 'Keine nachgeholte Kürzung im positiven Folgejahr');
