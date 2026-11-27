/** KR-1 Teil C (NG-5), Schritt 1: Rechentest auf simulateOneYear mit Ist und Soll, nur synthetische Zahlen.
 * node scripts/measure-kr1-ng5.mjs <Quellordner> [Ausgabe.json]
 * 1 Mio. €, Aktienrendite 10 %, Cash-Zins 5 %, Inflation 5 %; Einstand über dem Kurswert, damit kein Verkauf Steuer auslöst.
 * Zeitregel des Modells: Erst wird die Rendite des Jahres gebucht, dann wird am Jahresende für das Folgejahr entschieden.
 * Soll: Jeder Euro bekommt im Jahr genau eine Rendite, Aktien die Aktienrendite, Cash den Cash-Zins, jeweils auf den Bestand
 * vor der Umschichtung; Umschichtung und Auszahlung wirken erst im Folgejahr.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output] = process.argv.slice(2);
if (!root) throw new Error('Quellordner erforderlich.');
const load = file => import(pathToFileURL(resolve(root, file)).href);
const { simulateOneYear } = await load('app/simulator/simulator-engine-wrapper.js');
const { EngineAPI } = await load('engine/index.mjs');
globalThis.window ||= {};
globalThis.window.EngineAPI = EngineAPI;
const rA = 0.10, rC = 0.05;
const yearData = { jahr: 2000, rendite: rA, inflation: 5, zinssatz: rC * 100, gold_eur_perf: 0 };

function run(equity, cash, floor) {
    const inputs = { startAlter: 65, rentAdjPct: 0, accumulationPhase: { enabled: false }, zielLiquiditaet: 20000,
        startFloorBedarf: floor, startFlexBedarf: 0, goldAktiv: false, partner: { aktiv: false }, targetEq: 90,
        startSPB: 1000, marketCapeRatio: 20, risikoprofil: 'sicherheits-dynamisch', kirchensteuerSatz: 0,
        rebalBand: 20, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5 };
    const state = { portfolio: { depotTranchesAktien: [{ marketValue: equity, costBasis: equity * 1.2, type: 'aktien_neu' }],
        depotTranchesGold: [], liquiditaet: cash },
        baseFloor: floor, baseFlex: 0, lastState: null, currentAnnualPension: 0, widowPensionP1: 0, widowPensionP2: 0,
        marketDataHist: { endeVJ: 100, endeVJ_1: 90, endeVJ_2: 80, ath: 100, jahreSeitAth: 0, capeRatio: 20 } };
    const result = simulateOneYear(state, inputs, yearData, 0);
    if (result.kind !== 'success') throw new Error(`Jahr nicht gerechnet: ${result.kind}`);
    return result.logData;
}

const cases = [
    { name: 'Umschichtung Aktien → Cash', equity: 900000, cash: 100000, floor: 40000 },
    { name: 'Zukauf Cash → Aktien', equity: 700000, cash: 300000, floor: 20000 }
];
const rows = cases.map(c => {
    const log = run(c.equity, c.cash, c.floor);
    const trace = Object.fromEntries(log.balance_trace.map(entry => [entry.phase, entry]));
    const payout = log.entnahme_effektiv;
    const row = { name: c.name, start: { equity: c.equity, cash: c.cash },
        sale: trace.after_action_sales.plannedSaleBrutto, purchase: trace.after_action_sales.cashSpend, payout,
        interestIst: log.cashInterestEarned, interestSoll: c.cash * rC,
        equityEnd: log.wertAktien, cashBeforeTaxIst: log.liqEnd,
        wealthBeforeTaxIst: log.wertAktien + log.liqEnd,
        wealthBeforeTaxSoll: c.equity * (1 + rA) + c.cash * (1 + rC) - payout,
        phases: log.balance_trace.map(entry => entry.phase) };
    row.confirmsFinding = Math.abs(row.interestIst - row.interestSoll) > 0.01;
    return row;
});
if (output) writeFileSync(output, JSON.stringify({ root: resolve(root), yearData, rows }, null, 2) + '\n');
for (const row of rows) {
    console.log(`${row.name}: Verkauf ${row.sale} €, Zukauf ${row.purchase} €, Auszahlung ${row.payout} €; `
        + `Cash-Zins Ist ${row.interestIst} €, Soll ${row.interestSoll} €; Vermögen vor Steuer Ist ${row.wealthBeforeTaxIst} €, `
        + `Soll ${row.wealthBeforeTaxSoll} €${row.confirmsFinding ? ' (Befund bestätigt)' : ''}`);
}
