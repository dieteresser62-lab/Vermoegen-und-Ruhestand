import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { resolveTargetTagesgeld, withProfileLiquidityTargets, priceMoneyMarketTransfers, liquidityDisplayContext } from '../app/balance/balance-play-execution.js';
import { createAnnualActionResult } from '../app/shared/annual-close-result.js';
import { settleHouseholdTaxYear } from '../engine/tax-settlement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { renderBalancePlanTrial } from '../app/balance/balance-plan-trial.js';

const r = new ActionRenderer({});
const plan = { liquidityRunwayYears: 5, liquidityCashMonths: 12, minCashBufferMonths: 2,
    floorBedarf: 30000, flexBedarf: 30000, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 };
const lot = (gain = .2) => ({ schemaVersion: 2, trancheId: 'mm', type: 'geldmarkt', category: 'money_market', name: 'Erfundener Geldmarkt',
    shares: 1000, currentPrice: 100, purchasePrice: 100 * (1 - gain), purchaseDate: '2020-01-01', tqf: 0, taxExempt: false });
const none = () => ({ type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0,
    taxSettlement: { sumTaxableAfterTqfSigned: 0, lossCarryStart: 0 } });
const buy = amount => ({ ...none(), type: 'TRANSACTION', quellen: [{ kind: 'liquiditaet', brutto: amount, netto: amount, steuer: 0 }], verwendungen: { aktien: amount } });
const sale = (taxable, tax) => ({ ...none(), type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', brutto: 10000,
    netto: 10000 - tax, steuer: tax, taxableAfterTqfSigned: taxable }], verwendungen: { liquiditaet: 10000 - tax },
    steuer: tax, taxSettlement: { sumTaxableAfterTqfSigned: taxable, lossCarryStart: 0 } });
const entry = (id, cash, action = none(), gain = .2) => ({ profileId: id, name: id, input: { ...plan, tagesgeld: cash,
    geldmarktEtf: 100000, detailledTranches: [lot(gain)] }, action, spending: { monatlicheEntnahme: 2500 } });
const cashAfter = e => e.input.tagesgeld - (e.cashSplit?.fromTagesgeld || 0) + (e.action.verwendungen?.liquiditaet || 0)
    - (e.action.liquidityInflowToMoneyMarket || 0) - (e.action.cashOutflowTax || 0);
const sumCash = rows => rows.reduce((sum, e) => sum + cashAfter(e), 0);

// N-1: die Zahlen der Martin/Petra-Jahresanweisung, ohne automatische Partnerüberträge.
const martin = entry('Martin', 101341.64, buy(101341.64)), petra = entry('Petra', 31540.7, buy(23340.7));
for (const e of [martin, petra]) Object.assign(e.input, { floorBedarf: 24000, flexBedarf: 25200, geldmarktEtf: 0, detailledTranches: [] });
const reserve = r.prepareExecutionEntries([martin, petra], 8200);
assertEqual(cashAfter(reserve[0]), 0, 'N-1: vorhandene Kaufattribution für Martin bleibt unverändert');
assertClose(cashAfter(reserve[1]), 8200, .01, 'N-1: Petra behält auch Martins ungedeckten Mindestanteil');
assertClose(sumCash(reserve), 8200, .01, 'N-1/N-9: Haushalt bleibt auf eiserner Reserve');
assert(!reserve.some(e => e.action.internalCashRebalance), 'N-1: keine Abschöpfung ohne Haushaltsüberschuss');

// P-A/P-B aus Gutachten: auch die Steuer mindert den abschöpfbaren Überschuss.
for (const b of [50000, 120000]) {
    const rows = r.prepareExecutionEntries([entry('P-A', 10000), entry('P-B', b)], 300000);
    assertEqual(rows[0].action.internalCashRebalance.amount, 20000, 'P-A/P-B: persönliches Nachfüllen 20.000 Euro');
    assertEqual(rows[0].action.internalCashRebalance.steuer, 791.25, 'P-A/P-B: eigene Steuer 791,25 Euro');
    assert(sumCash(rows) >= 60000, 'P-A/P-B: Abschöpfen lässt Haushalt nach Steuer mindestens auf Ziel');
    assertEqual(rows[1].action.internalCashRebalance.amount, b === 50000 ? 15000 : 80000, 'P-A/P-B: sichere Abschöpfung nach bestehender Handelsrundung');
}

// FR-66: vollständige Imports, Lücke, anteiliger Rentenbeginn, Mindestanteil und Nullbedarf.
const records = {}, storage = { getItem: key => records[key] ?? null };
const options = { storage, now: new Date(2027, 0, 2) };
const pair = [entry('A', 30000), entry('B', 30000)];
pair[0].personData = { profile_rente_monatlich: '2000' };
pair[1].personData = { profile_rente_monatlich: '0' };
let targets = withProfileLiquidityTargets(pair, 300000, options);
const target = e => resolveTargetTagesgeld(e.spending, e.targetLiquidity, e.input);
assertEqual(target(targets[0]), 10000, 'Bedarf A 6.000 von 36.000: Tagesgeldziel 10.000');
assertEqual(target(targets[1]), 50000, 'Person ohne Rente erhält das größere Ziel 50.000');
assertEqual(targets.reduce((sum, e) => sum + target(e), 0), 60000, 'Persönliche Ziele ergeben exakt Haushaltsziel');
assert(targets.every(e => e.liquidityTargetBasis.source.includes('Haushaltsbudget')), 'Fehlende Imports nutzen gleichen Anteil des Plans');
pair[0].personData.profile_rente_monatlich = '5000';
targets = withProfileLiquidityTargets(pair, 300000, options);
assertEqual(target(targets[0]), 5000, 'Rente deckt alles: Mindestanteil 5.000 bleibt');
assertEqual(target(targets[1]), 55000, 'Mindestanteil wird aus dem Haushaltsziel ausgeglichen');
pair[1].personData.profile_rente_monatlich = '5000';
targets = withProfileLiquidityTargets(pair, 300000, options);
assert(targets.every(e => target(e) === 30000), 'Bedarf beider null: gleiche Ziele');
pair[1].personData = { profile_rente_monatlich: '2000', profile_rentenbeginn: '2027-07-01' };
targets = withProfileLiquidityTargets(pair, 300000, options);
assertEqual(targets[1].liquidityTargetBasis.pension, 12000, 'Rentenbeginn im Juli zählt mit sechs Monaten');
const years = { 2026: { months: {} } };
for (let month = 1; month <= 12; month++) years[2026].months[month] = { profiles: {
    A: { categories: { Test: -1000 } }, B: { categories: { Test: -3000 } } } };
records.balance_expenses_v1 = JSON.stringify({ version: 1, years });
pair.forEach(e => { e.personData = {}; });
targets = withProfileLiquidityTargets(pair, 300000, options);
assertEqual(target(targets[0]), 15000, 'Vollständiger Import A: 12.000 Ausgaben, Zielanteil ein Viertel');
assertEqual(target(targets[1]), 45000, 'Vollständiger Import B: 36.000 Ausgaben, Zielanteil drei Viertel');
assert(targets.every(e => e.liquidityTargetBasis.source.startsWith('Importierte')), 'Ausgabenquelle nennt Imports');
delete years[2026].months[4].profiles.A;
records.balance_expenses_v1 = JSON.stringify({ version: 1, years });
targets = withProfileLiquidityTargets(pair, 300000, options);
assertEqual(targets[0].liquidityTargetBasis.annualExpenses, 30000, 'Ein fehlender Monat: nur A fällt auf Planbudget zurück');
assertEqual(targets[1].liquidityTargetBasis.annualExpenses, 36000, 'Vollständige Ausgaben von B bleiben erhalten');

// N-3 und Abschnitt 6: Steuerlücke bleibt ohne Zusammenveranlagung persönlich.
const missing = entry('A', 10000); missing.input.detailledTranches = null;
const separate = r.prepareExecutionEntries([missing, entry('B', 10000)], 300000);
assert(separate[0].action.automaticExecutionBlocked, 'N-3: fehlender Einstand sperrt A');
assert(!separate[1].action.automaticExecutionBlocked && separate[1].action.internalCashRebalance.steuer === 791.25, 'N-3: B bleibt unabhängig ausführbar und bepreist');
const uninvolved = entry('B', 30000, sale(3000, 123.45));
const independent = r.prepareExecutionEntries([entry('A', 10000), uninvolved], 300000);
assertEqual(independent[1].action.steuer, 123.45, 'Abschnitt 6: unbeteiligte Person behält ihre Engine-Steuer');
assertEqual(priceMoneyMarketTransfers([uninvolved])[0], null, 'Abschnitt 6: keine Neubepreisung ohne Geldmarktverkauf');

const beforeWindow = globalThis.window, beforeDoc = globalThis.document;
const { doc } = createDialogFixture();
const host = doc.createElement('div'); doc.body.append(host);
host.replaceChildren = (...children) => { [...host.children].forEach(child => child.remove()); host.append(...children); };
globalThis.window = { EngineAPI }; globalThis.document = doc;
try {
    const view = new ActionRenderer({ outputs: { handlungsanweisung: host, balanceActionTransfer: doc.createElement('p'), balanceActionAmount: doc.createElement('p') } });
    const details = rows => {
        view.profileActionResults = rows;
        host.replaceChildren();
        const first = rows[0];
        view._renderDetails(host, view._projectTransaction(first.action, first.input, first.spending, 300000), first.action,
            first.action, view._summarizeAction(first.action, first.action), {});
        return view.getActionCopyText().replaceAll('\u00a0', ' ');
    };
    const jointRows = (a, b) => {
        const rows = [a, b];
        const settlements = settleHouseholdTaxYear(rows.map(e => ({ rawAggregate: { sumTaxableAfterTqfSigned: e.action.taxSettlement.sumTaxableAfterTqfSigned }, sparerPauschbetrag: 1000 })), true);
        rows.forEach((e, i) => { e.input.jointAssessment = true; e.action.taxSettlement = settlements[i].details; });
        return rows;
    };
    const joint = r.prepareExecutionEntries(jointRows(entry('A', 30000, sale(3000, 263.75)), entry('B', 10000)), 300000);
    assertEqual(joint[0].action.partnerMoneyMarketTaxChange, 263.75, 'N-4: Änderung der Verkaufssteuer von A wird festgehalten');
    assert(details(joint).includes('A: Zusammenveranlagung: Pauschbetrag des Partners jetzt für den Geldmarktverkauf genutzt, Verkaufssteuer +263,75 €'), 'N-4: Satz erklärt den Partnereffekt bei A');
    const loss = r.prepareExecutionEntries(jointRows(entry('A', 10000, none(), -.2), entry('B', 30000, sale(3000, 527.5))), 300000);
    assert(details(loss).includes('Geldmarktverlust von A mindert die Steuer von B um 527,50 €'), 'N-5: Verlustinhaber und begünstigte Person werden beide genannt');
    const covered = r.prepareExecutionEntries([{ ...entry('A', 59000, buy(10000)), targetLiquidity: 300000 }], 300000);
    const text = details(covered);
    assertEqual(covered[0].action.cashOutflowTax, 263.75, 'N-6: Kaufdeckung ohne Transfer wird besteuert');
    assertEqual((text.match(/263,75/g) || []).length, 1, 'N-6: Kaufdeckungssteuer erscheint genau einmal');
    assert(!text.includes('Steuern (gesamt) | 263,75'), 'N-6: Quellenblock wiederholt die Kaufdeckungssteuer nicht');
    globalThis.window.__profilverbundActionResults = [entry('P-A', 10000), entry('P-B', 50000)];
    view.renderAction(none(), { ...plan, tagesgeld: 60000, geldmarktEtf: 200000 }, {}, 300000);
    const short = view.dom.outputs.balanceActionTransfer.children.map(row => row.children.map(cell => cell.textContent).join(' ')).join(' · ');
    assert(short.includes('P-A · interne Umschichtung · Geldmarkt → Tagesgeld') && short.includes('P-B · interne Umschichtung · Tagesgeld → Geldmarkt'), 'N-2: Karte nennt gegenläufige Transfers einzeln je Person');
    assertEqual(view.dom.outputs.balanceActionAmount.textContent, '', 'N-2: keine irreführende Summe gegenläufiger Transfers');
    globalThis.window.__profilverbundActionResults = [entry('P-A', 30000, sale(0, 0)), entry('P-B', 30000, sale(0, 0))];
    const routeBytes = JSON.stringify(globalThis.window.__profilverbundActionResults);
    view.renderAction(sale(0, 0), { ...plan, tagesgeld: 60000, geldmarktEtf: 200000 }, {}, 300000);
    const routeRows = view.dom.outputs.balanceActionTransfer.children.map(row => row.children.map(cell => cell.textContent.replaceAll('\u00a0', ' ')));
    for (const name of ['P-A', 'P-B']) {
        assertEqual(routeRows.filter(row => row[0] === `${name} · ins Tagesgeld · bis zum Tagesgeldziel`).length, 0, 'Gerundete Tagesgeld-Nullzeile entfällt je Person');
        assertEqual(routeRows.filter(row => row[0] === `${name} · in den Geldmarkt · Rest der Reserve`).length, 1, 'Geldmarktzeile steht genau einmal je Person');
    }
    assertEqual(routeRows.length, 2, 'Nur die beiden von Null verschiedenen persönlichen Erlöse stehen in der Karte');
    assert(routeRows.every(row => row.length === 2 && !/\d,\d{2}/.test(row[1])), 'Jede Erlöszeile trennt Beschriftung und ganze Euro');
    assertEqual(JSON.stringify(globalThis.window.__profilverbundActionResults), routeBytes, 'Erlöszeilen ändern keine persönlichen Finanzwerte');
    delete globalThis.window.__profilverbundActionResults;
    const receipt = { year: 2027, action: sale(0, 0) };
    const context = { input: { ...plan, tagesgeld: 50000, geldmarktEtf: 100000 }, targetLiquidity: 300000 };
    const annual = createAnnualActionResult({ doc, result: { ...receipt, liquidityContext: context } });
    const child = dialogElements(annual).find(n => n.textContent.replaceAll('\u00a0', ' ') === 'davon Tagesgeld 10.000,00 €');
    assert(child?.parent?.tag === 'ul' && child.parent.parent?.tag === 'li', 'Darstellung: Erlösaufteilung ist unter Liquidität eingerückt');
    const summary = new SummaryRenderer({ outputs: { balanceAnnualAction: host } });
    summary.renderAnnualAction({ confirmed: { ...receipt, liquidityContext: context }, label: 'Festgeschrieben' }, [], context);
    const historic = dialogElements(host).map(n => n.textContent).join(' ');
    assert(historic.includes('Liquidität (Tagesgeld bis zum Ziel, Rest Geldmarkt)') && !historic.includes('davon Tagesgeld'), 'N-7: Balance zeigt den Beleg auch mit heutigem Kontext ohne neue Aufteilung');
    const sourceReceipt = createAnnualActionResult({ doc, result: { year: 2027, action: buy(10000) } });
    assert(dialogElements(sourceReceipt).some(n => n.textContent.includes('· Liquidität:')), 'N-8: Quelle heißt schlicht Liquidität');
    const runway = doc.createElement('input'), cashMonths = doc.createElement('input');
    runway.id = 'liquidityRunwayYears'; cashMonths.id = 'liquidityCashMonths'; doc.body.append(runway, cashMonths);
    runway.value = 'ungültig'; renderBalancePlanTrial(doc);
    assertEqual(cashMonths.max, '120', 'Abschnitt 6: ungültige Reichweite erzeugt kein NaN-max');
    const snapshot = liquidityDisplayContext({ entries: withProfileLiquidityTargets(pair, 300000, options), targetLiquidity: 300000 });
    assert(snapshot.entries.every(e => Number.isFinite(e.input.personalTagesgeldTarget)), 'Abschlussdialog hält persönliche Ziele im flüchtigen Kontext fest');
} finally { globalThis.window = beforeWindow; globalThis.document = beforeDoc; }
