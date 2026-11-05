import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { resolveTargetTagesgeld, withProfileLiquidityTargets, priceMoneyMarketTransfers, selectMoneyMarketSales,
    preparePlayAction, annualLiquidityInflowRouting, splitPlayLiquidity } from '../app/balance/balance-play-execution.js';
import { settleHouseholdTaxYear } from '../engine/tax-settlement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createAnnualActionResult } from '../app/shared/annual-close-result.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { prepareCashRecords } from '../app/profile/profile-cash-update.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { createPlanTrial } from '../app/shared/plan-trial.js';
import { PLAN_DEFAULTS, assertPlanValues } from '../app/profile/household-plan.js';
import { balancePlanFormPatch } from '../app/balance/balance-plan-trial.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';

globalThis.window = { EngineAPI };
const r = new ActionRenderer({});
const plan = { liquidityRunwayYears: 5, liquidityCashMonths: 12, minCashBufferMonths: 2, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 };
const lot = (id, gain = .2) => ({ schemaVersion: 2, trancheId: id, type: 'geldmarkt', category: 'money_market',
    name: 'Erfundener Geldmarkt', shares: 1000, currentPrice: 100, purchasePrice: 100 * (1 - gain), purchaseDate: '2020-01-01', tqf: 0, taxExempt: false });
const input = (cash, gain = .2) => ({ ...plan, tagesgeld: cash, geldmarktEtf: 100000, detailledTranches: [lot('mm', gain)] });
const none = () => ({ type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0, taxSettlement: { sumTaxableAfterTqfSigned: 0, lossCarryStart: 0 } });
const sale = (gross, taxable, tax = 0) => ({ type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', trancheId: 'eq', brutto: gross,
    steuer: tax, netto: gross - tax, taxableAfterTqfSigned: taxable }], verwendungen: { liquiditaet: gross - tax }, nettoErlös: gross - tax,
    steuer: tax, taxSettlement: { sumTaxableAfterTqfSigned: taxable, lossCarryStart: 0 } });
const entry = (profileId, cash, action = none(), gain = .2) => ({ profileId, name: profileId, input: input(cash, gain), action,
    spending: { monatlicheEntnahme: profileId === 'muster_a' ? 5000 : 0 }, targetLiquidity: null });
const finalCash = e => e.input.tagesgeld - (e.cashSplit?.fromTagesgeld || 0)
    + (e.action.verwendungen?.liquiditaet || 0) - (e.action.liquidityInflowToMoneyMarket || 0) - (e.action.cashOutflowTax || 0);

// B-1 / D-1: max(15.000 / 60 * 12, 36.000 / 12 * 2) = 6.000; bei voller Rente ebenfalls 6.000.
for (const [pension, target] of [[2750, 15000], [3000, 6000]]) {
    assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 3000 - pension }, target,
        { ...plan, floorBedarf: 12000, flexBedarf: 24000, renteAktiv: true, renteMonatlich: pension }), 6000, 'B-1: eiserne Reserve bleibt vollständig Tagesgeld');
}
const reservePair = withProfileLiquidityTargets([entry('muster_a', 50000), entry('muster_b', 50000)].map(e => ({ ...e,
    input: { ...e.input, floorBedarf: 12000, flexBedarf: 24000 } })), 6000);
assertEqual(reservePair.reduce((sum, e) => sum + resolveTargetTagesgeld(e.spending, e.targetLiquidity, e.input), 0), 6000, 'Persönliche eiserne Reserven verdoppeln den Haushaltsbedarf nicht');

// B1: jeweils 50.000 - 30.000 = 20.000 Abschöpfung; A legt zusätzlich 30.000 Erlös im Geldmarkt an.
const b1 = r.prepareExecutionEntries([entry('muster_a', 50000, sale(30000, 0)), entry('muster_b', 50000)], 300000);
assertEqual(b1.reduce((sum, e) => sum + finalCash(e), 0), 60000, 'B1: 60.000 statt 70.000 Euro Tagesgeld im Haushalt');
assert(b1.every(e => resolveTargetTagesgeld(e.spending, e.targetLiquidity, e.input) === 30000), 'P-2: auch ohne Entnahme persönliches Ziel 30.000 Euro');
assert(b1.every(e => e.action.internalCashRebalance.amount === 20000), 'P-1: 20.000 Euro Überschuss je Person');

// D: A fehlen 20.000, B fehlt nichts. (4.000 Gewinn - 1.000 Freibetrag) * .26375 = 791,25.
const d = r.prepareExecutionEntries([entry('muster_a', 10000), entry('muster_b', 30000)], 300000);
assertEqual(d[0].action.internalCashRebalance.amount, 20000, 'D: allein A verkauft 20.000 Geldmarkt');
assertEqual(d[1].action.internalCashRebalance, undefined, 'D: B am Ziel verkauft nichts und zahlt keine unnötige Steuer');
assertEqual(d[0].action.internalCashRebalance.steuer, 791.25, 'D: A nutzt eigenen Pauschbetrag');
assertClose(d.reduce((sum, e) => sum + finalCash(e), 0), 60000, 2500, 'Paarbestand nach Eintragung bleibt innerhalb der Schwelle um das Haushaltsziel');

// C: vorher (3.000 - 2.000) * .26375 = 263,75; nachher (5.000 - 2.000) * .26375 = 791,25.
const baseline = settleHouseholdTaxYear([3000, 0].map(value => ({ rawAggregate: { sumTaxableAfterTqfSigned: value }, sparerPauschbetrag: 1000 })), true);
const joint = [entry('muster_a', 10000, sale(10000, 3000, 263.75), .1), entry('muster_b', 30000)];
joint.forEach((e, i) => { e.input.jointAssessment = true; e.action.taxSettlement = baseline[i].details; });
const c = priceMoneyMarketTransfers(joint.map((e, i) => ({ ...e, amount: i ? 0 : 20000 })));
assertEqual(c[0].sources.reduce((sum, q) => sum + q.steuer, 0), 527.5, 'C: Transfermehrsteuer 527,50 statt 791,25');
assertEqual(c[0].settlement.taxDue + c[1].settlement.taxDue, 791.25, 'C: beide Personen gemeinsam abgerechnet');
const partnerLoss = structuredClone(joint); partnerLoss[1].action.taxSettlement.lossCarryStart = 1000;
assertEqual(priceMoneyMarketTransfers(partnerLoss.map((e, i) => ({ ...e, amount: i ? 0 : 20000 })))[0].settlement.taxDue, 527.5, 'S-1: Partnerverlust wird ebenfalls verrechnet');
// Verbraucht B den zuvor an A geliehenen Freibetrag, steigt die Steuer von A auf den Aktienverkauf.
const shifted = [entry('muster_a', 30000, sale(10000, 2000)), entry('muster_b', 10000, none(), .1)];
const beforeShift = settleHouseholdTaxYear([2000, 0].map(value => ({ rawAggregate: { sumTaxableAfterTqfSigned: value }, sparerPauschbetrag: 1000 })), true);
shifted.forEach((e, i) => { e.input.jointAssessment = true; e.action.taxSettlement = beforeShift[i].details; });
const afterShift = priceMoneyMarketTransfers(shifted.map((e, i) => ({ ...e, amount: i ? 10000 : 0 })));
const shiftedA = r._integrateCashRebalance(shifted[0].action, null, shifted[0].input, {}, 300000, afterShift[0]);
assertEqual(shiftedA.quellen[0].steuer, 263.75, 'S-1: verbrauchter Partnerfreibetrag erhöht die richtige persönliche Verkaufssteuer');
assertEqual(shiftedA.verwendungen.liquiditaet, 9736.25, 'S-1: veränderte persönliche Steuer mindert auch den verfügbaren Erlös');

// E: Transfer (8.000 - 1.000) * .26375 = 1.846,25; Kaufdeckung zusätzlich 2.000 * .26375 = 527,50.
const buy = { ...none(), type: 'TRANSACTION', quellen: [{ kind: 'liquiditaet', brutto: 10000, netto: 10000, steuer: 0 }], verwendungen: { aktien: 10000 } };
const e = { ...entry('muster_a', 15000, buy), targetLiquidity: 300000 };
e.cashSplit = splitPlayLiquidity(e.input, buy, e.spending, 300000);
e.action = r._integrateCashRebalance(buy, { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 40000 }, e.input, e.spending, 300000);
assertEqual(e.action.internalCashRebalance.amount, 40000, 'E: gerundeter Transfer 40.000');
assertEqual(e.action.internalCashRebalance.steuer, 1846.25, 'E: Transfersteuer ohne Kaufdeckung');
assertEqual(e.action.cashOutflowTax, 527.5, 'E: Kaufdeckungssteuer separat');
assertEqual(e.action.internalCashRebalance.netto, 38153.75, 'E: richtiger Nettozufluss des Transfers');

// F: 3.000 Aktiengewinn - 4.000 Geldmarktverlust => Jahressteuer null, Ersparnis 527,50.
const f = r._integrateCashRebalance(sale(10000, 3000, 527.5), { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 20000 }, input(10000, -.2), {}, 300000);
assertEqual(f.steuer, 0, 'F: Verlust senkt Jahressteuer auf null');
assertEqual(f.moneyMarketTaxReduction, 527.5, 'F: erklärte Steuerminderung 527,50');
assert(r._actionWithoutInternalTransfer(f).taxSettlement, 'F: Verkaufsanzeige behält das Settlement');
assertEqual(f.quellen[0].steuer, 0, 'F: Aktienzeile zeigt dieselbe finale Null');

const estimatedBase = sale(10000, 3000, 527.5); delete estimatedBase.taxSettlement; delete estimatedBase.quellen[0].taxableAfterTqfSigned;
const estimated = r._integrateCashRebalance(estimatedBase, { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 20000 }, input(10000), {}, 300000);
assert(estimated.taxEstimated, 'priorTaxable: fehlende Gewinnbasis mit vorhandener Steuer ausdrücklich geschätzt');
assertEqual(estimated.internalCashRebalance.steuer, 1055, 'priorTaxable: rekonstruierte Basis 3.000 statt still null');
const ordered = selectMoneyMarketSales([{ trancheId: 'zero', category: 'money_market', marketValue: 0, costBasis: 1 },
    { trancheId: 'high', category: 'money_market', marketValue: 100, costBasis: 50 },
    { trancheId: 'low', category: 'money_market', marketValue: 100, costBasis: 90 }], 100);
assertEqual(ordered[0].lot.trancheId, 'low', 'Nullwerttranche beeinflusst die steuerarme Sortierung nicht');
const fractional = r.prepareExecutionEntries([entry('muster_a', 50001), entry('muster_b', 50000)], 300000);
assert(fractional.every(e => Math.abs(e.action.internalCashRebalance.amount * 100 - Math.round(e.action.internalCashRebalance.amount * 100)) < 1e-7), 'Persönliche Transferbeträge auf Cent');
assertEqual(fractional.reduce((sum, e) => sum + e.action.internalCashRebalance.amount, 0), 40000, 'Letzte Person erhält den Centrest');

const legacy = r._integrateCashRebalance(none(), { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 20000 }, { ...input(10000), detailledTranches: null }, {}, 300000);
assertEqual(legacy.internalCashRebalance.notice, 'Steuer nicht ermittelbar – Einstand im Vermögen fehlt', 'S-4: Altbestand zeigt Anweisung mit verständlichem Hinweis');

const { doc } = createDialogFixture();
const receipt = { year: 2027, text: 'Aktien verkaufen', action: sale(40000, 0) };
const receiptBytes = JSON.stringify(receipt);
assert(dialogElements(createAnnualActionResult({ doc, result: receipt })).some(n => n.textContent.includes('Liquidität (Tagesgeld bis zum Ziel, Rest Geldmarkt)')), 'B-2: Beleg ohne Bestand nennt Liquidität statt Tagesgeld');
const context = { input: input(120000), spending: { monatlicheEntnahme: 5000 }, targetLiquidity: 300000 };
const annual = createAnnualActionResult({ doc, result: { ...receipt, liquidityContext: context } });
assert(dialogElements(annual).some(n => n.textContent.replaceAll('\u00a0', ' ') === 'davon Geldmarkt 40.000,00 €'), 'B-2: Beleganzeige mit Bestand nennt konkretes Routing');
assertEqual(JSON.stringify(receipt), receiptBytes, 'Jahresbeleg bleibt unverändert');
const pairRouting = annualLiquidityInflowRouting({ ...sale(30000, 0), quellen: [{ ...sale(30000, 0).quellen[0], sourceProfileId: 'muster_a' }] },
    { entries: [entry('muster_a', 50000), entry('muster_b', 50000)], targetLiquidity: 300000 });
assertEqual(pairRouting.geldmarkt, 30000, 'Paarbeleg nutzt persönliche Ziele wie die Eintragung');

const values = { ...structuredClone(PLAN_DEFAULTS), liquidityCashMonths: 24 };
let notifications = 0;
const trial = createPlanTrial({ validateBeforeUpdate: true, readPlan: () => ({ status: 'valid', scope: { key: 'test' }, entry: { values } }), changed: () => notifications++ });
trial.start(); const before = JSON.stringify(trial.read()), count = notifications;
let message; try { trial.update({ liquidityRunwayYears: 1 }); } catch (error) { message = error.message; }
assertEqual(message, 'davon im Tagesgeld (24 Monate) ist größer als die Reichweite (12 Monate) – eines davon anpassen', 'A-1: Meldung nennt beide Felder und Werte');
assertEqual(JSON.stringify(trial.read()), before, 'A-1: abgelehnte Änderung übernimmt keinen Entwurf');
assertEqual(notifications, count, 'A-1: abgelehnte Änderung meldet keine Übernahme');
let managerMessage; try { assertPlanValues({ ...values, liquidityRunwayYears: 1 }); } catch (error) { managerMessage = error.message; }
assertEqual(managerMessage, message, 'A-1: Manager und Versuch verwenden dieselbe Validierung');

const oldDocument = globalThis.document;
try {
    globalThis.document = doc;
    const host = doc.createElement('div'), transfer = doc.createElement('p'); doc.body.append(host);
    const view = new ActionRenderer({ outputs: { handlungsanweisung: host, balanceActionTransfer: transfer } });
    const a = sale(40000, 0), above = { ...input(120000), geldmarktEtf: 150000 };
    view.renderAction(a, above, { monatlicheEntnahme: 5000 }, 300000);
    const routing = transfer.children.map(row => row.children.map(cell => cell.textContent).join(' ')).join(' · ').replaceAll('\u00a0', ' ');
    assert(routing.includes('in den Geldmarkt · Rest der Reserve 40.000 €'), 'B-2: Kartenzeilen nennen die vollständige Erlösaufteilung');
    const copy = view.getActionCopyText();
    assert(copy.replaceAll('\u00a0', ' ').includes('davon Geldmarkt | 40.000,00 €'), 'B-2: Kopiertext nennt 40.000 Euro Geldmarkt zusätzlich zum Transfer');
    assert(dialogElements(host).some(n => n.textContent === 'davon Tagesgeld') && dialogElements(host).some(n => n.textContent === 'davon Geldmarkt'), 'B-2: Dialog zeigt beide Erlösanteile');
    const details = (action, input) => {
        [...host.children].forEach(child => child.remove());
        view._renderDetails(host, view._projectTransaction(action, input, {}, 300000), action, action, view._summarizeAction(action, action), {});
        return view.getActionCopyText().replaceAll('\u00a0', ' ');
    };
    const coverageText = details(e.action, e.input);
    assert(coverageText.includes('1.846,25') && coverageText.includes('527,50') && coverageText.includes('Steuer Kaufdeckung aus Geldmarkt'), 'S-2: Dialog und Kopie trennen Transfersteuer 1.846,25 und Kaufdeckung 527,50');
    const lossText = details(f, input(10000, -.2));
    assert(lossText.includes('Geldmarktverlust mindert die Steuer um 527,50 €') && lossText.includes('Steuern (final, Settlement)')
        && !lossText.includes('Steuern (geschätzt)'), 'S-3: Verlustanzeige erklärt Null und verwendet durchgehend das finale Settlement');
    const tables = dialogElements(host).filter(n => n.tag === 'table');
    for (const table of tables) {
        const hints = dialogElements(table).filter(n => n.className === 'ds-info-pop' && n.textContent.startsWith('Gerechnet mit vollem'));
        assert(hints.length <= 1, 'Steuerhinweis höchstens einmal je Tabelle');
        assert(!dialogElements(table).some(n => n.tag === 'td' && dialogElements(n).some(child => child.className === 'ds-info-pop')), 'Steuerhinweis steht nie an einzelnen Zellen');
    }
    assert(details(estimated, input(10000)).includes('Steuer geschätzt'), 'priorTaxable: Schätzhinweis sichtbar und kopierbar');
    view.renderAction(none(), { ...input(10000), detailledTranches: null }, {}, 300000);
    assert(view.getActionCopyText().includes('Steuer nicht ermittelbar – Einstand im Vermögen fehlt'), 'S-4: Altbestand bricht renderAction nicht ab');
    const runway = doc.createElement('input'); runway.id = 'liquidityRunwayYears'; runway.value = '1';
    const cashMonths = doc.createElement('input'); cashMonths.id = 'liquidityCashMonths'; cashMonths.value = '24'; doc.body.append(runway, cashMonths);
    balancePlanFormPatch(doc, ['liquidityRunwayYears']);
    assertEqual(cashMonths.max, '12', 'A-1: max des Balance-Felds folgt der Reichweite');
} finally { globalThis.document = oldDocument; }
for (const kind of ['unavailable', 'failed', 'incomplete']) {
    const guard = createNavigationGuard({ decide: async () => true });
    guard.register('test', { read: () => ({ phase: 'running', operationId: 1 }),
        ...(kind === 'unavailable' ? {} : { cancel: async () => kind !== 'failed' }) });
    let error; try { await guard.prepare({ confirmBeforeClose: true }); } catch (caught) { error = caught; }
    assert(error && !error.message.includes('NAVIGATION_CANCEL_'), 'Verwerf-Rückfrage erklärt ' + kind + ' in Klartext');
}

// Echte Spielvorschau je Gutachtenfall mit ausschließlich erfundenen Tranchen.
const oldDate = getAppTestDate();
try {
    for (const [label, entries] of [['B1', b1], ['D', d], ['E', [e]], ['F', [{ ...entry('muster_a', 10000), input: input(10000, -.2), action: f }]],
        ['C', joint.map((entry, i) => ({ ...entry, action: r._integrateCashRebalance(entry.action, i ? null : { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 20000 }, entry.input, entry.spending, 300000, c[i]) }))]]) {
        const seed = createMusterHaushaltRecords('2026-10-23'), registry = JSON.parse(seed.rs_profiles_v1);
        for (const id of Object.keys(registry.profiles)) if (!entries.some(e => e.profileId === id)) delete registry.profiles[id];
        for (const entry of entries) {
            const profile = registry.profiles[entry.profileId];
            Object.assign(profile.data, prepareCashRecords(profile.data, entry.input.tagesgeld, '2026-10-23'));
            const stock = entry.action.quellen?.find(source => source.kind === 'aktien_neu');
            const gain = stock ? stock.taxableAfterTqfSigned / stock.brutto / .7 : 0;
            profile.data.depot_tranchen = JSON.stringify([...entry.input.detailledTranches, { ...lot('eq', gain), type: 'aktien_neu', category: 'equity', tqf: .3 }]);
        }
        seed.rs_profiles_v1 = JSON.stringify(registry); Object.assign(seed, registry.profiles.muster_a.data);
        const fixture = await playFixture('indexeddb', seed);
        let controller = await fixture.boot(); await controller.start(() => ({ source: 'copy', testDate: '2026-10-23' })); controller = await fixture.boot();
        const prepared = await preparePlayAction({ entries, controller, id: `lq1b-${label}` });
        for (const entry of entries) {
            const posted = prepared.batch.people.find(p => p.profileId === entry.profileId);
            assertClose(posted.finalCash, finalCash(entry), .01, `${label}: Buchung stimmt mit persönlicher Anweisung überein`);
            assertClose(prepared.lines.filter(line => line.profileId === entry.profileId && line.kind === 'sale').reduce((sum, line) => sum + line.taxes, 0),
                entry.action.steuer || 0, .01, `${label}: Eintragung nutzt dieselbe Jahressteuer`);
        }
        if (label === 'B1') assertEqual(prepared.batch.people.reduce((sum, p) => sum + p.finalCash, 0), 60000, 'B1: echte Spielvorschau trifft Haushaltsziel genau');
        if (label === 'E') {
            let refused = false; try { await preparePlayAction({ entries: [{ ...entries[0], action: legacy }], controller }); } catch (error) { refused = error.message.includes('Einstand im Vermögen fehlt'); }
            assert(refused, 'S-4: unbekannte Steuer wird nicht automatisch gebucht');
        }
        P.resetPersistenceRuntimeForTests();
    }
} finally { P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate); }
