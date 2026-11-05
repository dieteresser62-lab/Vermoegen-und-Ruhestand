import { trySurplusRebalance } from '../engine/transactions/transaction-surplus.mjs';
import { quantizeAmount } from '../engine/transactions/transaction-utils.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { monthlyOtherIncome } from '../app/profile/profile-income.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { readFileSync } from 'node:fs';

const surplus = (cash, patch = {}, market = {}) => trySurplusRebalance({
    aktuelleLiquiditaet: cash, zielLiquiditaet: 5000, depotwertGesamt: 100000,
    investiertesKapital: 100000 + cash, input: { goldAktiv: false, depotwertNeu: 100000, maxSkimPctOfEq: 0, ...patch },
    market: { sKey: 'peak_stable', abstandVomAthProzent: 0, ...market }, quantizeAmount, transactionDiagnostics: {} });
assertEqual(surplus(5000 + 15000), null, '15.000 Euro im ersten Sparjahr liegen unter dem Mindesthandel');
assertEqual(surplus(5000 + 25000), null, 'Die vorhandene strenge Mindesthandelsgrenze bleibt erhalten');
const second = surplus(5000 + 2 * 15000);
assertEqual(second.verwendungen.aktien, 30000, 'Zweites Sparjahr: 30.000 Euro Aktienkauf trotz Abschöpfen 0 %');
assertEqual(35000 - second.nettoErlös, 5000, 'Liquiditätsziel von 5.000 Euro bleibt erhalten');
assertEqual(surplus(35000, { depotwertNeu: 0 }).verwendungen.aktien, 30000, 'Erster Aktienkauf ist auch ohne bisherigen Aktienbestand möglich');
for (const market of [{ sKey: 'bear' }, { sKey: 'crash' }, { abstandVomAthProzent: 16 }]) {
    assertEqual(surplus(35000, {}, market), null, 'Marktschutz sperrt Überschusskäufe weiter');
}
const gold = surplus(105000, { goldAktiv: true, goldZielProzent: 10, goldWert: 0 });
assert(gold.verwendungen.gold > 0 && gold.verwendungen.aktien > 0, 'Goldziel wird vor dem übrigen Aktienkauf bedient');
assert(gold.nettoErlös <= 100000, 'Gerundete Käufe überschreiten den verfügbaren Überschuss nicht');

for (const [cap, expected] of [[0, 0], [3, 30000], [10, 45000]]) {
    const result = EngineAPI.simulateSingleYear({ depotwertAlt: 1000000, depotwertNeu: 0,
        costBasisAlt: 1000000, costBasisNeu: 0, tagesgeld: 155000, geldmarktEtf: 0,
        inflation: 0, floorBedarf: 40000, flexBedarf: 0, startAlter: 65, aktuellesAlter: 65,
        renteAktiv: false, goldAktiv: false, goldWert: 0, liquidityRunwayYears: 5, minCashBufferMonths: 0,
        maxSkimPctOfEq: cap, maxBearRefillPctOfEq: 5, kursAktuell: 100, kursVJ: 100, kursMA: 100,
        kursATH: 100, marketData: { eqPrices: [100, 100, 100, 100, 100] }, dynamicFlex: false });
    assertClose(result.ui.action.bruttoVerkaufGesamt, expected, 1e-6, `${cap} % begrenzen reguläre Auffüllverkäufe weiter`);
}
const income = [{ id: 'lohn', art: 'sonstige', betragMonat: 1000, ab: null, bis: null, anpassung: 'lohn' }];
assertEqual(monthlyOtherIncome(income, 2027, { baseYear: 2026, wagePct: -9.7 }), 1000, 'Auch der gemeinsame Planleser schützt Einkünfte vor nominalem Lohnrückgang');
assertEqual(monthlyOtherIncome(income, 2027, { baseYear: 2026, wagePct: 2 }), 1020, 'Planleser erhöht Einkünfte bei positivem Lohn');
assertEqual(monthlyOtherIncome([{ ...income[0], anpassung: 'inflation' }], 2027,
    { baseYear: 2026, inflationPct: -2 }), 980, 'Inflationsanpassung bleibt unverändert');
for (const id of ['max-erika', 'renate', 'jan-lena', 'helga-werner']) {
    const records = createMusterHaushaltRecords('2026-10-16', id);
    const [plan] = Object.values(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries);
    assertEqual(plan.values.maxSkimPctOfEq, 0, `${id}: Abschöpfen bleibt bei 0 %`);
    assertEqual(plan.values.maxBearRefillPctOfEq, 0, `${id}: Bärenauffüllung bleibt bei 0 %`);
}
const evidence = JSON.parse(readFileSync(new URL('./fixtures/an-1-measurement.json', import.meta.url)));
assertEqual(evidence.parameters.anzahl, 2000, 'Alt-/Neu-Beleg verwendet 2.000 Pfade je Muster und Stand');
assertEqual(evidence.parameters.seed, 12345, 'Alt-/Neu-Beleg verwendet den beauftragten Seed');
assertEqual(evidence.byteControls.length, 8, 'Acht vollständige Kontrolljahre sind belegt');
for (const row of evidence.byteControls) assertEqual(row.beforeHash, row.afterHash, 'Ohne Lohnanpassung und oberhalb/unterhalb des Mindesthandels unter der alten Kaufgrenze bytegleich');
for (const versions of Object.values(evidence.scenarios)) for (const run of Object.values(versions)) {
    assertEqual(run.technicalErrors, 0, 'MC-Beleg ohne technische Fehler');
    assert(run.maxAbsFlowDelta < 1e-6, 'MC-Beleg ohne ungeklärten Vermögensfluss');
}
