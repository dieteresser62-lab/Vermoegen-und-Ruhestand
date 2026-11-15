// VK-3 (FR-79 Punkt 9 mit Ergänzung 1, Nachträge 1 und 2): „Tranche im Detail“. Nur synthetische Daten: Musterhaushalte Max und Erika,
// Martin und Petra, Testdatum 23.10.2026, Spielkurse.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite, prepareTrancheDetailWrite } from '../app/tranches/household-sale-writer.js';
import { readReconciliationHistory, projectReconciliationCashStatuses, projectBuyCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { trancheDetailFigures, trancheHistory, trancheDeletion, planReference, tqfChoice } from '../app/tranches/tranche-detail-model.js';
import { renderTqfChoices, exactShares } from '../app/tranches/tranche-detail-view.js';
import { readFlowBuys } from '../app/tranches/buy-flow-model.js';
import { euro } from '../app/tranches/sale-flow-steps.js';

const DATE = '2026-10-23';
const MAX = 'muster_a', MARTIN = 'muster_martin';
setAppTestDate(DATE);
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-3-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const lots = id => JSON.parse(registry().profiles[id].data.depot_tranchen);

// Kennzahlen (Sollfall FR-79): Max, Neubestand nach dem Verkauf aus VK-1, 1.180,935 Stück zu 121,42 €, Kurs 144,47 € am 23.10.
{
    const figures = trancheDetailFigures({ shares: 1180.935, purchasePrice: 121.42, currentPrice: 144.47, category: 'equity', type: 'aktien_neu', tqf: 0.3 });
    assertEqual(euro(figures.costBasis), '143.389 €', 'Einstand 143.389 €');
    assertEqual(euro(figures.marketValue), '170.610 €', 'Marktwert 170.610 € (144,47 €)');
    assertEqual(euro(figures.gain), '27.221 €', 'Gewinn +27.221 €');
    assertEqual((figures.gainPct * 100).toFixed(1), '19.0', 'Gewinn +19,0 %');
    assertEqual(euro(figures.tax), '5.026 €', 'Steuer, wenn alles verkauft ≈ 27.221 × 0,7 × 26,375 % = 5.026 €');
    assertEqual(exactShares(1180.935), '1.180,935', 'Stück genau');
    assertEqual(trancheDetailFigures({ shares: 10, purchasePrice: 100, currentPrice: 150, category: 'equity', tqf: 0.3, taxExempt: true }).tax, 0, 'ganz steuerfrei: 0 €');
    assertEqual(trancheDetailFigures({ shares: 10, purchasePrice: 100, currentPrice: 80, category: 'equity', tqf: 0.3 }).tax, 0, 'Verlust: 0 €');
    assertEqual(Math.round(trancheDetailFigures({ shares: 10, purchasePrice: 100, currentPrice: 150, category: 'money_market', type: 'geldmarkt', tqf: 0.3 }).tax * 100) / 100, 131.88,
        'Geldmarkt ohne Teilfreistellung: 500 × 26,375 % = 131,88 €');
    // VK-3b (Fable P3-3): „Kurs fehlt“ ist nach dem Tranchenvertrag nicht erreichbar (gespeicherter Bestand hat immer einen positiven Kurs).
    assert(!('priceEstimated' in trancheDetailFigures({ shares: 10, purchasePrice: 100, currentPrice: 100, category: 'equity', tqf: 0 })), 'kein Zweig „Kurs fehlt“ mehr');
}

// Verlauf und Planbezug mit echtem Schreibweg: Max verkauft 65 Stück zu 144,52 € (VK-1), Gutschrift 9.388,90 € bestätigt.
{
    const records = createMusterHaushaltRecords(DATE, 'max-erika', 'grund');
    const entry = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    await freshArea(records);
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ sales: [{ profileId: MAX, actionId: 'vk3-max', executedAt: DATE,
        parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], cashValue: 27388.9 }] }));
    const tranche = lots(MAX).find(lot => lot.trancheId === 'muster_a_lot_2');
    assertEqual(exactShares(Math.round(tranche.shares * 1000) / 1000), '1.180,935', 'Neubestand nach dem Verkauf 1.180,935 Stück');
    const figures = trancheDetailFigures({ ...tranche, currentPrice: 144.47 });
    // Gespeichert ist der ungerundete Kaufpreis 121,41709 €; der Sollfall rechnete mit dem angezeigten 121,42 € (3 € Unterschied).
    assertEqual(euro(figures.costBasis), '143.386 €', 'Einstand mit dem gespeicherten Kaufpreis 143.386 € (Sollfall mit 121,42 €: 143.389 €)');
    assertEqual(euro(figures.marketValue), '170.610 €', 'Marktwert 170.610 €');
    assertEqual(euro(figures.tax), '5.026 €', 'Steuer ≈ 5.026 €');
    const reg = registry(), all = [...readReconciliationHistory(reg)];
    const history = trancheHistory({ tranche, profileId: MAX, records: all, cashStatuses: [...projectReconciliationCashStatuses(reg, MAX)],
        buyStatuses: [...projectBuyCashStatuses(reg, MAX)], references: [planReference(entry, [MAX, 'muster_b'])] });
    assertEqual(history.map(row => row.kind).join(), 'sale,buy', 'Verlauf: neueste oben (Verkauf, dann Kauf)');
    const [sale, buy] = history;
    assertEqual(`${sale.date} ${sale.shares} ${sale.price.toFixed(2)} ${sale.amount}`, '2026-10-23 65 144.52 9388.9', 'Verkauf 65 Stück × 144,52 € · Gutschrift 9.388,90 €');
    assertEqual(sale.plan, 2026, 'Verkauf „aus dem Plan 2026“ (Datum im Planjahr, Person und Anlageklasse passen)');
    assertEqual(sale.cash, 'confirmed', 'Gutschrift auf dem Tagesgeld bestätigt');
    assertEqual(`${buy.date} ${exactShares(Math.round(buy.shares * 1000) / 1000)} ${buy.price.toFixed(2)}`, '2020-05-18 1.245,935 121.42', 'Kauf 1.245,935 Stück × 121,42 €');
    assertEqual(buy.plan, null, 'Kauf von 2020 ohne Planbezug');
    const deletion = trancheDeletion(tranche, MAX, all);
    assert(!deletion.allowed && /Verkauf/.test(deletion.reason), 'Löschen gesperrt: Ein Verkaufsbeleg hängt an der Tranche');
    assert(trancheDeletion(lots(MAX).find(lot => lot.trancheId === 'muster_a_lot_1'), MAX, all).allowed, 'Tranche ohne Belege: Löschen erlaubt');

    // Korrigieren (Nachtrag 2): Stückzahl über den gemeinsamen Schreiber, der Vermögensverlauf vermerkt die Korrektur statt „unbekannt“.
    const corrected = { ...lots(MAX).find(lot => lot.trancheId === 'muster_a_lot_1') };
    corrected.shares = 2000;
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MAX, tranche: corrected, correction: true }));
    const lot = JSON.parse(registry().profiles[MAX].data.profile_wealth_history_lots_v1).lots.muster_a_lot_1;
    assertEqual(`${lot.status} ${lot.remainingShares} ${lot.manualCorrectionAt}`, `present 2000 ${DATE}`, 'Korrektur: Los „present“ mit Korrekturdatum (vorher „unknown“)');
    assertEqual(lots(MAX).find(item => item.trancheId === 'muster_a_lot_1').shares, 2000, 'Korrektur: Tranche mit neuer Stückzahl');
}

// Teilfreistellung (Nachtrag 1): Auswahl nur bei Aktien; ein gespeicherter Wert 60 % erscheint als „eigener Wert 60 %“ und bleibt.
{
    assertEqual(JSON.stringify(tqfChoice(0.6)), JSON.stringify({ value: 0.6, custom: true }), '0,6 ist ein eigener Wert');
    assertEqual(tqfChoice(0.15).custom, false, '15 % ist eine Option');
    const element = tag => ({ tagName: tag, children: [], dataset: {}, hidden: false, value: '', textContent: '', className: '',
        append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; }, addEventListener() {} });
    const nodes = Object.fromEntries(['trancheTqfChoices', 'trancheTqfFixed', 'tqf'].map(id => [id, element('div')]));
    const doc = { createElement: element, getElementById: id => nodes[id] || null };
    renderTqfChoices(doc, 'equity', 0.6, () => {});
    const radios = doc.getElementById('trancheTqfChoices').children[0].children;
    assertEqual(radios.length, 4, 'Vier Optionen: eigener Wert, 30 %, 15 %, 0 %');
    assertEqual(radios.find(radio => radio.selected)?.value, '0.6', '„eigener Wert 60 %“ gewählt');
    assertEqual(doc.getElementById('tqf').value, '0.6', 'Speichern ohne Änderung lässt 0,6 stehen');
    renderTqfChoices(doc, 'money_market', 0.6, () => {});
    assert(doc.getElementById('trancheTqfChoices').hidden && doc.getElementById('tqf').value === '0', 'Geldmarkt: 0 % fest, keine Auswahl');
}

// Löschen mit eigenem Kaufbeleg (Nachtrag 2): „Kauf rückgängig“ – Tranche weg, Storno im Abgleich, der Stand der Käufe zeigt wieder „offen“.
{
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const tranche = { schemaVersion: 2, trancheId: 'vk3_buy', name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', isin: 'IE00BK5BQT80',
        shares: 685, purchasePrice: 98930.75 / 685, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' };
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: MARTIN, actionId: 'vk3-buy', executedAt: DATE, assetClass: 'equity', tranche,
        shares: 685, gross: 98920.85, fees: 9.9, cashValue: null }] }));
    assertEqual(readFlowBuys(registry(), [MARTIN]).length, 1, 'Kauf eingetragen (Abbuchung offen)');
    const deletion = trancheDeletion(tranche, MARTIN, [...readReconciliationHistory(registry())]);
    assertEqual(`${deletion.allowed} ${deletion.cancelBuy}`, 'true vk3-buy', 'Nur der eigene Kaufbeleg hängt daran: Löschen als „Kauf rückgängig“');
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3_buy', cancelBuy: 'vk3-buy' }));
    assert(!lots(MARTIN).some(lot => lot.trancheId === 'vk3_buy'), 'Tranche gelöscht');
    assert(readReconciliationHistory(registry()).some(record => record.eventType === 'buy_cancelled' && record.targetActionId === 'vk3-buy'), 'Storno-Ereignis zum Kaufbeleg');
    assertEqual(readFlowBuys(registry(), [MARTIN]).length, 0, 'Stand der Käufe zählt den Kauf nicht mehr (wieder „offen“)');
    assertEqual(projectBuyCashStatuses(registry()).length, 0, 'keine offene Abbuchung mehr');
    assert(!JSON.parse(registry().profiles[MARTIN].data.profile_wealth_history_lots_v1).lots.vk3_buy, 'Vermögensverlauf: Los verworfen, nicht „unbekannt“');
}
