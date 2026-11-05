import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { withProfileLiquidityTargets, resolveTargetTagesgeld } from '../app/balance/balance-play-execution.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { INCOME_KEY, writeIncome } from '../app/profile/profile-income.js';
import { calculateCashProposal } from '../app/overview/overview-cash-proposal.js';

const renderer = new ActionRenderer({});
const plan = { liquidityRunwayYears: 5, liquidityCashMonths: 12, minCashBufferMonths: 2,
    floorBedarf: 30000, flexBedarf: 30000, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 };
const none = () => ({ type: 'NONE', quellen: [], verwendungen: {}, steuer: 0,
    taxSettlement: { sumTaxableAfterTqfSigned: 0, lossCarryStart: 0 } });
const entry = (id, cash) => ({ profileId: id, name: id, input: { ...plan, tagesgeld: cash, geldmarktEtf: 100000,
    detailledTranches: [{ schemaVersion: 2, trancheId: 'mm', type: 'geldmarkt', category: 'money_market',
        shares: 1000, currentPrice: 100, purchasePrice: 100, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false }] },
    action: none(), spending: { monatlicheEntnahme: 2500 } });
const target = e => resolveTargetTagesgeld(e.spending, e.targetLiquidity, e.input);
const records = {}, storage = { getItem: key => records[key] ?? null };
const options = { storage, now: new Date(2026, 10, 2) };

// F-2: beschädigte Ausgaben lassen die Anweisung lesbar und verteilen das Ziel gleich.
const pair = [entry('Max', 30000), entry('Erika', 30000)];
pair[0].personData = { profile_rente_monatlich: '2000' };
pair[1].personData = {};
assertEqual(target(withProfileLiquidityTargets(pair, 300000, options)[0]), 10000, 'F-2: lesbarer Bereich verteilt weiter nach Bedarf');
records.balance_expenses_v1 = '{kaputt';
const fallback = withProfileLiquidityTargets(pair, 300000, options);
assert(fallback.every(e => target(e) === 30000), 'F-2: beschädigter Ausgabenbereich verteilt das Tagesgeldziel gleich');
assertEqual(fallback.reduce((sum, e) => sum + target(e), 0), 60000, 'F-2: Haushaltsziel bleibt erhalten');
assert(fallback.every(e => e.liquidityTargetBasis.notice.includes('kein gueltiges JSON')), 'F-2: Rückfall nennt den konkreten Grund');
const raw = records.balance_expenses_v1;
const previousDoc = globalThis.document;
const { doc } = createDialogFixture();
globalThis.document = doc;
try {
    const host = doc.createElement('div');
    const view = new ActionRenderer({ outputs: {} });
    view.profileActionResults = fallback;
    const first = fallback[0];
    view._renderDetails(host, view._projectTransaction(first.action, first.input, first.spending, 300000),
        first.action, first.action, view._summarizeAction(first.action, first.action), {});
    const info = dialogElements(host).map(node => node.textContent).join(' ');
    assert(info.includes('Ausgabenbereich beschädigt:') && info.includes('kein gueltiges JSON') && info.includes('Tagesgeldziele werden gleich verteilt'), 'F-2: Info nennt Korruption und gleiche Verteilung');
} finally { globalThis.document = previousDoc; }
assertEqual(records.balance_expenses_v1, raw, 'F-2: beschädigte Rohdaten werden nicht verändert');

// F-3: großer Fehlbetrag, aber nur 2.000 Euro im Geldmarkt; Schwelle bleibt 2.500 Euro.
const single = entry('Max', 40000);
single.input.geldmarktEtf = 2000;
const refill = renderer.prepareExecutionEntries([single], 300000)[0];
assertEqual(target(refill) - single.input.tagesgeld, 20000, 'F-3: persönlicher Fehlbetrag 20.000 Euro');
assertEqual(refill.action.internalCashRebalance.amount, 2000, 'F-3: kleiner verfügbarer Geldmarkt wird vollständig nachgefüllt');
assertEqual(renderer.determineInternalCashRebalance(entry('Max', 58000).input, none(), {}, 300000), null, 'F-3: Fehlbetrag unter der Schwelle bleibt ohne Transfer');

// F-5: nur Max ist ohne Einstand gesperrt; Erikas steuerfreie Abschöpfung bleibt möglich.
for (const joint of [false, true]) {
    const rows = [entry('Max', 10000), entry('Erika', 100000)];
    rows[0].input.detailledTranches = null;
    rows.forEach(e => { e.input.jointAssessment = joint; });
    const prepared = renderer._integrateProfileCashRebalance(rows, null, 300000);
    assert(prepared[0].action.automaticExecutionBlocked, 'F-5: fehlender Einstand sperrt Max');
    if (joint) {
        assert(prepared[1].action.automaticExecutionBlocked, 'F-5: Zusammenveranlagung sperrt auch Erika');
        assert(!prepared[1].action.internalCashRebalance, 'F-5: keine Abschöpfung bei ungeklärter gemeinsamer Steuer');
    } else {
        assert(!prepared[1].action.automaticExecutionBlocked, 'F-5: Erika bleibt unabhängig ausführbar');
        assertEqual(prepared[1].action.internalCashRebalance.amount, 50000, 'F-5: Abschöpfung schützt Haushalt ohne fiktive Nachfüllung von Max');
        assertEqual(prepared[1].action.internalCashRebalance.steuer, 0, 'F-5: Tagesgeld nach Geldmarkt ist steuerfrei');
        assertEqual(rows[0].input.tagesgeld + rows[1].input.tagesgeld - prepared[1].action.internalCashRebalance.amount, 60000, 'F-5: Haushalt bleibt auch bei ausgelassener Person auf dem Ziel');
    }
}

// F-4: dasselbe Monatsmodell für Zielbedarf und Spielwert, einschließlich der Randmonate.
delete records.balance_expenses_v1;
const incomeEntry = (id, ab, bis, betragMonat = 1000) => ({ id, art: 'sonstige', bezeichnung: 'Erfundene Einkünfte', betragMonat, ab, bis, anpassung: 'keine' });
for (const [label, ab, bis, expected] of [
    ['Ende Juni', null, '2027-06', 8000],
    ['Beginn März', '2027-03', null, 8000],
    ['Fenstergrenzen', '2026-11', '2027-10', 12000],
    ['außerhalb', '2027-11', null, 0],
    ['nur ein Monat', '2027-06', '2027-06', 1000]
]) {
    const people = [entry('Max', 30000), entry('Erika', 30000)];
    people[0].personData = {};
    people[1].personData = { [INCOME_KEY]: writeIncome([incomeEntry('test', ab, bis)]) };
    const projected = withProfileLiquidityTargets(people, 300000, options);
    assertEqual(projected[1].liquidityTargetBasis.income, expected, `F-4: ${label} zählt monatsgenau im Zwölfmonatsbedarf`);
    const cash = calculateCashProposal({ person: { id: 'Erika', name: 'Erika', value: 10000 }, data: people[1].personData,
        fallbackStart: '2026-11-01', end: '2027-10-31', expenses: {} });
    assertEqual(cash.income, expected, `F-4: ${label} nutzt dieselben Monatszuflüsse für den Spielwert`);
    if (label === 'Ende Juni') assertClose(target(projected[1]), 60000 * 22000 / 52000, .01, 'F-4: Ziel aus 22.000 statt 23.000 Euro persönlichem Bedarf');
}
