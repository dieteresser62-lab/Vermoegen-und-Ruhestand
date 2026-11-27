// KR-1c (NG-5): Geldbewegungen im Jahr. Jeder Bestand bekommt die Rendite des Jahres auf seinen Stand vor der Umschichtung:
// Aktien die Aktienrendite, Tagesgeld und Geldmarkt den Zins. Auszahlung, Verkauf und Zukauf wirken erst danach.
// 1 Mio. €, Aktienrendite 10 %, Cash-Zins 5 %, Inflation 5 %, Einstand über dem Kurswert (kein steuerpflichtiger Gewinn).
import { simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';

const yearData = { jahr: 2000, rendite: 0.10, inflation: 5, zinssatz: 5, gold_eur_perf: 0 };

function runYear(equity, cash, floor) {
    const inputs = { startAlter: 65, rentAdjPct: 0, accumulationPhase: { enabled: false }, zielLiquiditaet: 20000,
        startFloorBedarf: floor, startFlexBedarf: 0, goldAktiv: false, partner: { aktiv: false }, targetEq: 90,
        startSPB: 1000, marketCapeRatio: 20, risikoprofil: 'sicherheits-dynamisch', kirchensteuerSatz: 0,
        rebalBand: 20, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5 };
    const state = { portfolio: { depotTranchesAktien: [{ marketValue: equity, costBasis: equity * 1.2, type: 'aktien_neu' }],
        depotTranchesGold: [], liquiditaet: cash },
        baseFloor: floor, baseFlex: 0, lastState: null, currentAnnualPension: 0, widowPensionP1: 0, widowPensionP2: 0,
        marketDataHist: { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 80, ath: 100, jahreSeitAth: 0, capeRatio: 20 } };
    const result = simulateOneYear(state, inputs, yearData, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', `Jahr gerechnet (${result.kind})`);
    return result.logData;
}

const cases = [
    { name: 'Umschichtung Aktien → Cash', equity: 900000, cash: 100000, floor: 40000, interest: 5000, wealthBeforeTax: 1055000 },
    { name: 'Zukauf Cash → Aktien', equity: 700000, cash: 300000, floor: 20000, interest: 15000, wealthBeforeTax: 1065000 }
];
for (const c of cases) {
    const log = runYear(c.equity, c.cash, c.floor);
    const phases = log.balance_trace.map(entry => entry.phase);
    const at = phase => log.balance_trace[phases.indexOf(phase)];
    // Die Umschichtung findet tatsächlich statt (Verkauf bzw. Zukauf in der Entscheidung).
    const moved = c.cash < 200000 ? at('after_action_sales').plannedSaleBrutto : at('after_action_sales').cashSpend;
    assert(moved > 50000, `${c.name}: Umschichtung findet statt (${moved} €)`);
    assertClose(log.cashInterestEarned, c.interest, 0.01, `${c.name}: Zins auf den Stand vor der Umschichtung`);
    // Vermögen vor Steuer: letzter Stand vor der Steuerabrechnung am Jahresende.
    const beforeTax = log.balance_trace[phases.indexOf('after_tax_reconciliation') - 1];
    assertClose(beforeTax.total, c.wealthBeforeTax, 0.01, `${c.name}: Vermögen vor Steuer`);
    // Zeitlage: Zins vor der Entscheidung, Steuerabrechnung am Jahresende.
    assert(phases.indexOf('after_cash_interest') >= 0 && phases.indexOf('after_cash_interest') < phases.indexOf('after_action_sales')
        && phases.indexOf('after_action_sales') < phases.indexOf('after_payout'), `${c.name}: Zins vor Umschichtung und Auszahlung`);
    assertEqual(phases.at(-1), 'after_tax_reconciliation', `${c.name}: Steuerabrechnung bleibt am Jahresende`);
    // Diagnosefelder behalten ihre Bedeutung.
    assertClose(log.liqStart, c.cash, 0.01, `${c.name}: liqStart ist der Stand am Jahresanfang vor dem Zins`);
    assertClose(log.liq_after_interest, c.cash + c.interest, 0.01, `${c.name}: liq_after_interest liegt unmittelbar nach dem Zins`);
    assertClose(log.liqEnd, beforeTax.cash, 0.01, `${c.name}: liqEnd ist der Stand am Jahresende nach allen Bewegungen`);
    assert(Math.abs(log.portfolio_flow_delta) < 0.05, `${c.name}: Flussidentität bleibt geschlossen (${log.portfolio_flow_delta})`);
}
console.log('KR-1c: Zins des Jahres auf den Stand vor der Entscheidung.');
