import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { resolveTargetTagesgeld, splitPlayLiquidity, withProfileLiquidityTargets, priceMoneyMarketTransfer } from '../app/balance/balance-play-execution.js';
import { EngineAPI } from '../engine/index.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { preparePlayAction } from '../app/balance/balance-play-execution.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { prepareCashRecords } from '../app/profile/profile-cash-update.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { normalizeTrancheCollection } from '../types/tranche-contract.js';

globalThis.window = { EngineAPI };
const renderer = new ActionRenderer({});
const spending = { monatlicheEntnahme: 5000 };
const input = { liquidityRunwayYears: 5, liquidityCashMonths: 12, tagesgeld: 120000, geldmarktEtf: 150000 };
const action = { type: 'TRANSACTION', quellen: [{ kind: 'aktien_alt', brutto: 40000, netto: 40000, steuer: 0, taxableAfterTqfSigned: 0 }],
    verwendungen: { liquiditaet: 40000 }, nettoErlös: 40000, steuer: 0 };
assertEqual(resolveTargetTagesgeld(spending, 300000, input), 60000, 'FR-66: zwölf von sechzig Monaten ergeben 60.000 Euro Tagesgeldziel');
const rebalance = renderer.determineInternalCashRebalance(input, action, spending, 300000);
assertEqual(rebalance.from, 'Tagesgeld', 'a: kein Nachfüllen aus dem Geldmarkt');
assertEqual(rebalance.amount, 60000, 'a: 60.000 Euro Überschuss mit bestehender floor-Rundung');
const integrated = renderer._integrateCashRebalance(action, rebalance, input, spending, 300000);
const projection = renderer._projectTransaction(integrated, input, spending, 300000);
assertEqual(projection.displayNetto, 40000, 'd: Verkaufssumme enthält keinen internen Transfer');
assertEqual(renderer._summarizeAction(action, integrated).amount, projection.displayNetto, 'd: Karte und Dialog nennen denselben Verkaufserlös');
assertEqual(projection.useRows.find(row => row.label === 'Zugang Liquidität:').amount, 40000, 'd: Zugang enthält keinen Transfer');
assertEqual(integrated.liquidityInflowToMoneyMarket, 40000, 'a: Verkaufserlös fließt bei vollem Tagesgeld in den Geldmarkt');
const moneyMarketPurchase = integrated.verwendungen.geldmarkt + integrated.liquidityInflowToMoneyMarket;
assertEqual(input.tagesgeld + 40000 - moneyMarketPurchase, 60000, 'a: Tagesgeld nach Verkauf und interner Umschichtung 60.000 Euro');
assertEqual(input.geldmarktEtf + moneyMarketPurchase, 250000, 'a: Geldmarkt nach Verkauf und interner Umschichtung 250.000 Euro');
assertEqual(resolveTargetTagesgeld(spending, 300000, { ...input, liquidityCashMonths: 60 }), 300000, 'c: volle Reichweite entspricht dem Reserveziel');
assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 0 }, 10000, input), 2000, 'Mindestpuffer und Engine-Rundung sind in derselben Monatsbasis enthalten');
assertEqual(resolveTargetTagesgeld(spending, 300000, { ...input, liquidityCashMonths: 0 }), 10000, 'Null Tagesgeldmonate erhalten die eiserne Reserve');
assertEqual(splitPlayLiquidity(input, { quellen: [{ kind: 'liquiditaet', brutto: 10000 }] }, spending, 300000).zielTagesgeld, 60000, 'Spielaufteilung nutzt dasselbe Ziel');

const lot = { trancheId: 'mm', type: 'geldmarkt', category: 'money_market', name: 'Synthetischer Geldmarkt',
    shares: 1000, purchasePrice: 80, currentPrice: 100, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false };
const below = { ...input, tagesgeld: 15000, geldmarktEtf: 100000, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, detailledTranches: [lot] };
const equity = { ...action, quellen: [{ kind: 'aktien_neu', brutto: 2000, netto: 2000, steuer: 0, taxableAfterTqfSigned: 700 }],
    nettoErlös: 2000, verwendungen: { liquiditaet: 2000 }, taxSettlement: { lossCarryStart: 0 } };
const refill = renderer.determineInternalCashRebalance(below, equity, spending, 300000);
const taxed = renderer._integrateCashRebalance(equity, refill, below, spending, 300000);
const transfer = taxed.internalCashRebalance;
assertEqual(transfer.amount, 40000, 'b: Nachfüllen mit bestehender floor-Rundung');
assertClose(transfer.steuer, 2030.87, .01, 'b: 8.000 Euro Geldmarktgewinn plus 700 Euro Aktiengewinn teilen 1.000 Euro Pauschbetrag');
assertClose(transfer.netto, 37969.13, .01, 'b: Steuer vermindert Tagesgeldzufluss centgleich zur Eintragung');
assertEqual(taxed.quellen.find(q => q.kind === 'geldmarkt').trancheId, 'mm', 'Steuer stammt aus konkreter Geldmarkttranche');
const loss = renderer._integrateCashRebalance({ ...equity, taxSettlement: { lossCarryStart: 10000 } }, refill, below, spending, 300000);
assertEqual(loss.internalCashRebalance.steuer, 0, 'Vorhandener persönlicher Verlusttopf wirkt auf beide Verkäufe');
assertEqual(JSON.stringify(equity.quellen), JSON.stringify([{ kind: 'aktien_neu', brutto: 2000, netto: 2000, steuer: 0, taxableAfterTqfSigned: 700 }]), 'Projektion mutiert keine Enginequelle');

const entries = ['a', 'b'].map(profileId => ({ profileId, name: profileId, input: below, action: equity, spending, targetLiquidity: 300000 }));
const pair = renderer._integrateProfileCashRebalance(entries, { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: 80000 });
for (const entry of pair) assertClose(entry.action.internalCashRebalance.steuer, 2030.87, .01, 'e: jede Person nutzt ihren eigenen Pauschbetrag zusammen mit ihrem Aktienverkauf');
const personalTargets = withProfileLiquidityTargets(entries.map((entry, index) => ({ ...entry, targetLiquidity: null,
    spending: { monatlicheEntnahme: index === 0 ? 1000 : 4000 } })), 300000);
assertEqual(personalTargets.reduce((sum, entry) => sum + resolveTargetTagesgeld(entry.spending, entry.targetLiquidity, entry.input), 0),
    60000, 'Paar und Zeitraffer teilen dieselbe Reservebasis ohne zweiten Haushaltsbedarf');
const smallTax = priceMoneyMarketTransfer({ sparerPauschbetrag: 1000, detailledTranches: [3, 3, 3, 1].map((weight, index) => ({
    trancheId: `small-tax-${index}`, type: 'geldmarkt', category: 'money_market', purchaseDate: '2020-01-01',
    marketValue: weight * 10000, costBasis: weight * (10000 - 100.0076), tqf: 0, taxExempt: false })) }, { quellen: [] }, 100000);
assert(smallTax.sources.every(source => source.steuer >= 0), 'Vier Geldmarkttranchen knapp über dem Pauschbetrag erzeugen keine negative Rundungssteuer');
assertEqual(smallTax.sources.reduce((sum, source) => sum + source.steuer, 0), smallTax.settlement.taxDue,
    'Centverteilung auf Geldmarkttranchen erhält die gemeinsame Jahressteuer');

// Echte Erfassungsdienste, synthetischer Spielbestand: Anzeige und gespeicherte Vorschau stimmen überein.
const oldDate = getAppTestDate();
try {
    for (const people of [1, 2]) {
        const seed = createMusterHaushaltRecords('2026-10-23');
        const registry = JSON.parse(seed.rs_profiles_v1), ids = Object.keys(registry.profiles).slice(0, people);
        for (const id of Object.keys(registry.profiles)) if (!ids.includes(id)) delete registry.profiles[id];
        const equityLot = { ...lot, trancheId: 'equity', type: 'aktien_neu', category: 'equity', shares: 20, purchasePrice: 50, tqf: .3 };
        for (const profile of Object.values(registry.profiles)) {
            Object.assign(profile.data, prepareCashRecords(profile.data, 15000, '2026-10-23'));
            profile.data.depot_tranchen = JSON.stringify([{ ...lot, schemaVersion: 2 }, { ...equityLot, schemaVersion: 2 }]);
        }
        seed.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(seed, registry.profiles[ids[0]].data);
        const fixture = await playFixture('indexeddb', seed), originalBytes = fixture.realBytes();
        let controller = await fixture.boot();
        await controller.start(async () => ({ source: 'copy', testDate: '2026-10-23' }));
        controller = await fixture.boot();
        const actual = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        const entries = ids.map(profileId => {
            const lots = normalizeTrancheCollection(JSON.parse(actual.profiles[profileId].data.depot_tranchen), { mode: 'persisted' });
            const stock = lots.find(item => item.trancheId === 'equity');
            const base = { ...equity, quellen: [{ ...equity.quellen[0], trancheId: 'equity', brutto: stock.marketValue,
                netto: stock.marketValue, taxableAfterTqfSigned: (stock.marketValue - stock.costBasis) * .7 }],
                nettoErlös: stock.marketValue, verwendungen: { liquiditaet: stock.marketValue } };
            const personInput = { ...below, detailledTranches: lots };
            return { profileId, input: personInput, spending, targetLiquidity: 300000,
                action: renderer._integrateCashRebalance(base, refill, personInput, spending, 300000) };
        });
        const prepared = await preparePlayAction({ entries, controller, id: `lq1-${people}` });
        for (const entry of entries) {
            const taxes = prepared.lines.filter(line => line.profileId === entry.profileId && line.kind === 'sale').reduce((sum, line) => sum + line.taxes, 0);
            assertClose(taxes, entry.action.steuer, .01, 'b/e: angezeigte Steuer entspricht Eintragung je Person auf Cent');
            assertClose(prepared.batch.people.find(person => person.profileId === entry.profileId).finalCash,
                15000 + entry.action.quellen[0].netto + entry.action.internalCashRebalance.netto, .02,
                'b/e: Nachfüllen erreicht das Tagesgeld abzüglich Steuer');
        }
        assertEqual(fixture.realBytes(), originalBytes, 'Spielvorschau lässt echten Bestand bytegleich');
        PersistenceFacade.resetPersistenceRuntimeForTests();
    }
} finally { PersistenceFacade.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate); }
