// FI-1 (FR-82): Innerhalb derselben Person und ISIN verkauft die App wie die Bank die ältesten Stücke zuerst.
import { calculateSaleAndTax } from '../engine/transactions/sale-engine.mjs';
import { applyIsinFifo, bankOrderDateMissing } from '../types/sale-fifo.js';

const ISIN = 'IE00BK5BQT80';
const built = (tqf, patch = {}) => [['tranche_alt_40', 40, '2016-06-15'], ['tranche_mittel_80', 80, '2020-05-18'], ['tranche_neu_110', 110, '2025-02-14']]
    .map(([trancheId, price, purchaseDate]) => ({ schemaVersion: 2, trancheId, sourceProfileId: 'gebaut', name: 'Muster Aktien-ETF', isin: ISIN,
        type: 'aktien_neu', category: 'equity', shares: 300, purchasePrice: price, currentPrice: 100, purchaseDate,
        marketValue: 30000, costBasis: 300 * price, tqf, taxExempt: false, ...(patch[trancheId] || {}) }));
const sell = (net, tranches) => calculateSaleAndTax(net, { detailledTranches: tranches, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, goldAktiv: false },
    {}, { sKey: 'bull' }, false);

// Gebauter Fall aus auftrag/mess-fifo-vorher.json: „vorher“ = Wahl nach Steuerlast je Euro, Soll = FIFO-Spalte plus Zusatzverkauf.
const cases = [
    [0.3, 5000, { gross: 5000, tax: 0 }, { gross: 5326.26, tax: 326.27 }],
    [0.3, 10000, { gross: 10000, tax: 0 }, { gross: 10949.14, tax: 949.14 }],
    [0.3, 20000, { gross: 20000, tax: 0 }, { gross: 22194.89, tax: 2194.89 }],
    [0.3, 50000, { gross: 50492.95, tax: 492.95 }, { gross: 53943.62, tax: 3943.62 }],
    [0, 5000, { gross: 5000, tax: 0 }, { gross: 5626.67, tax: 626.67 }],
    [0, 10000, { gross: 10000, tax: 0 }, { gross: 11566.68, tax: 1566.68 }],
    [0, 20000, { gross: 20000, tax: 0 }, { gross: 23446.69, tax: 3446.69 }],
    [0, 50000, { gross: 50835.31, tax: 835.31 }, { gross: 55847.19, tax: 5847.19 }]
];
for (const [tqf, net, before, soll] of cases) {
    const sale = sell(net, built(tqf));
    const label = `${net} € netto, Teilfreistellung ${tqf * 100} %`;
    assertClose(sale.bruttoVerkaufGesamt, soll.gross, 1, `${label}: Brutto wie Bank (vorher ${before.gross} €)`);
    assertClose(sale.steuerGesamt, soll.tax, 1, `${label}: Steuer wie Bank (vorher ${before.tax} €)`);
    assertClose(sale.achievedRefill, net, 0.01, `${label}: Nettoauftrag gedeckt`);
    assertEqual(sale.breakdown[0].trancheId, 'tranche_alt_40', `${label}: zuerst die ältesten Stücke`);
}
{
    // Ohne Kaufdatum zählt eine Tranche als älteste.
    const sale = sell(5000, built(0, { tranche_neu_110: { purchaseDate: null } }));
    assertEqual(sale.breakdown[0].trancheId, 'tranche_neu_110', 'Ohne Kaufdatum gilt als älteste');
    assertEqual(sale.steuerGesamt, 0, 'Die älteste ist hier die verlustbringende Tranche');
    assert(bankOrderDateMissing(built(0, { tranche_neu_110: { purchaseDate: null } })), 'Hinweis bei fehlendem Kaufdatum in derselben ISIN');
    assert(!bankOrderDateMissing(built(0)), 'Kein Hinweis mit vollständigen Kaufdaten');
    assert(!bankOrderDateMissing([{ ...built(0)[0], purchaseDate: null }]), 'Kein Hinweis bei einer einzelnen Tranche');
    // Andere Person oder andere ISIN: weiter nach Steuerlast je Euro.
    const other = built(0).map((lot, i) => i === 2 ? { ...lot, sourceProfileId: 'andere' } : lot);
    assertEqual(sell(5000, other).breakdown[0].trancheId, 'tranche_neu_110', 'Andere Person: freie Wahl nach Steuerlast');
    const noIsin = built(0).map(lot => ({ ...lot, isin: '' }));
    assertEqual(sell(5000, noIsin).breakdown[0].trancheId, 'tranche_neu_110', 'Ohne ISIN: keine Einschränkung');
    // Dynamisch: Erst nach Verbrauch der ältesten rückt die nächste nach; dazwischen darf eine andere ISIN günstiger sein.
    const order = applyIsinFifo(['b', 'x', 'a'], key => ({ a: { isin: 'I1', purchaseDate: '2010-01-01' }, b: { isin: 'I1', purchaseDate: '2020-01-01' }, x: { isin: 'I2' } })[key]);
    assertEqual(order.join(','), 'x,a,b', 'Kandidaten: x (andere ISIN) und a (älteste); b erst nach a');
}

// Alle Auswahlwege: Haushaltsattribution (Balance und Simulator), Personenverkauf der Balance, Verkaufsdialog.
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { selectTranchesForSale } from '../app/profile/profilverbund-balance.js';
import { bankOrderGuessed, planBankOrderGuessed } from '../app/tranches/sale-flow-model.js';
{
    const personInputs = { kirchensteuerSatz: 0, sparerPauschbetrag: 1000, tagesgeld: 0, geldmarktEtf: 0 };
    const own = built(0).map(({ sourceProfileId, ...lot }) => lot);
    const profiles = [{ profileId: 'gebaut', name: 'Gebaut', inputs: personInputs, tranches: own },
        { profileId: 'andere', name: 'Andere', inputs: personInputs, tranches: [] }];
    const sale = sell(5000, built(0));
    const action = { type: 'TRANSACTION', quellen: sale.breakdown.map(row => ({ ...row, sourceProfileId: 'gebaut' })), verwendungen: { liquiditaet: 5000 } };
    for (const mode of ['tax_optimized', 'proportional']) {
        const attributed = attributeHouseholdAction({ householdAction: action, profiles, mode });
        const sources = attributed.finalAction.quellen;
        const ids = sources.filter(source => source.brutto > 0.005).map(source => String(source.trancheId));
        assert(ids.length > 0 && ids.every(id => id.endsWith('tranche_alt_40')), `Attribution ${mode}: nur die älteste Tranche (${ids.join(', ')})`);
    }
    const picks = selectTranchesForSale(own, 5000);
    assertEqual(picks[0].tranche.trancheId, 'tranche_alt_40', 'Personenverkauf der Balance: älteste Stücke zuerst');
    assertEqual(picks.length, 1, 'Personenverkauf: die nächste Tranche erst nach Verbrauch der ältesten');
    const guessed = own.map(lot => lot.trancheId === 'tranche_mittel_80' ? { ...lot, purchaseDate: null } : lot);
    assert(bankOrderGuessed(guessed, ISIN) && !bankOrderGuessed(own, ISIN), 'Verkaufsdialog: Hinweis nur bei fehlendem Kaufdatum');
    const registry = { profiles: { gebaut: { data: { depot_tranchen: JSON.stringify(guessed) } } } };
    assert(planBankOrderGuessed(registry, [{ sourceProfileId: 'gebaut', isin: ISIN }]), 'Details & Drucken: Hinweis aus den Tranchen der Person');
    assert(!planBankOrderGuessed(registry, [{ sourceProfileId: 'gebaut', isin: 'ANDERE' }]), 'Kein Hinweis für ein anderes Wertpapier');
}

// Beispiel „Nachkäufe desselben ETF“: Jahresbeleg (Balance) und Simulator verkaufen bei Erika dieselbe, älteste Tranche.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
{
    const records = createMusterHaushaltRecords('2026-10-23', 'max-erika', 'nachkauf');
    const entries = Object.values(JSON.parse(records.annual_plan_record_v1).entries);
    const erika = entries.flatMap(entry => (entry.adopted?.action || entry.recommended?.action || entry.action || {}).quellen || [])
        .filter(source => source.sourceProfileId === 'muster_b' && source.brutto > 0);
    assert(erika.length > 0 && erika.every(source => source.trancheId === 'muster_b:muster_b_lot_2'), 'Jahresbeleg: Erika verkauft die Tranche vom 16.03.2020');
    const inputs = await measurementInputs(0, 'max-erika', '2026-10-23', 'nachkauf');
    const start = initMcRunState(inputs, 2026);
    // RK-2 (Gemini Testhinweis): verkauft heißt, der Einstand der Tranche ist gesunken (Kursgewinne ändern ihn nicht).
    const before = new Map(start.portfolio.depotTranchesAktien.map(lot => [lot.trancheId, lot.costBasis]));
    const year = simulateOneYear(start, inputs, { jahr: 2026, inflation: 2, rendite: 0.05, gold_eur_perf: 0, zinssatz: 1 },
        0, null, 0, { p1Alive: true, p2Alive: true }, 1, EngineAPI);
    const lots = year.newState.portfolio.depotTranchesAktien.filter(lot => lot.sourceProfileId === 'muster_b' && lot.isin === ISIN);
    const sold = lots.filter(lot => lot.costBasis < before.get(lot.trancheId) - 1).map(lot => lot.trancheId);
    assertEqual(sold.join(), 'muster_b:muster_b_lot_2', 'Simulator: Erika verkauft dieselbe älteste Tranche (Parität)');
}

// RK-2 Punkt 1 (Gutachten Fable P2-3): Gold derselben Person und ISIN folgt im Rechenkern derselben Bankreihenfolge wie Aktien und
// Anleihen. Zwei Tranchen DE000A0S9GB0 je 600 Stück zu 100 €: Kauf 01.01.2015 zu 50 €, die zweite ohne Kaufdatum zu 120 €.
// Vorher verkaufte der Rechenkern die Tranche von 2015 (455,72 € Steuer), Zuordnung und Verkaufsdialog die ohne Datum (0 €).
{
    const gold = [['gold_2015', 50, '2015-01-01'], ['gold_ohne_datum', 120, null]].map(([trancheId, price, purchaseDate]) => ({ schemaVersion: 2,
        trancheId, sourceProfileId: 'gebaut', name: 'Muster Gold', isin: 'DE000A0S9GB0', type: 'gold', category: 'gold', shares: 600,
        purchasePrice: price, currentPrice: 100, purchaseDate, marketValue: 60000, costBasis: 600 * price, tqf: 0, taxExempt: false }));
    const input = { detailledTranches: gold, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, goldAktiv: true, goldZielProzent: 10 };
    for (const [label, market, emergency] of [['Notverkauf', { sKey: 'bull' }, true], ['Bärenmarkt', { sKey: 'bear_deep' }, false], ['Standard', { sKey: 'bull' }, false]]) {
        const sale = calculateSaleAndTax(5000, input, {}, market, emergency);
        assertEqual(sale.breakdown[0].trancheId, 'gold_ohne_datum', `Gold ${label}: zuerst die Tranche ohne Kaufdatum`);
        assertEqual(sale.steuerGesamt, 0, `Gold ${label}: 0 € Steuer wie Haushalt und Dialog (vorher 455,72 €)`);
    }
    // Zwei datierte Gold-Tranchen: älteste zuerst wie bisher.
    const dated = gold.map(lot => lot.trancheId === 'gold_ohne_datum' ? { ...lot, purchaseDate: '2020-01-01' } : lot);
    assertEqual(calculateSaleAndTax(5000, { ...input, detailledTranches: dated }, {}, { sKey: 'bull' }, true).breakdown[0].trancheId, 'gold_2015', 'Gold datiert: älteste zuerst');
}

// RK-2 P3 (Gemini FI1-2): Rückfallwege des Simulators verkaufen in derselben Bankreihenfolge, auch Gold; ungültige Daten ohne NaN.
import { reduceAcrossTranches } from '../app/simulator/simulator-forced-sale.js';
import { sortTranchesFIFO } from '../app/simulator/simulator-portfolio.js';
import { bankOrderFallback } from '../types/sale-fifo.js';
{
    const gold = () => [{ trancheId: 'g2015', sourceProfileId: 'p', isin: 'DE000A0S9GB0', purchaseDate: '2015-01-01', marketValue: 60000, costBasis: 30000 },
        { trancheId: 'gohne', sourceProfileId: 'p', isin: 'DE000A0S9GB0', purchaseDate: null, marketValue: 60000, costBasis: 72000 }];
    const lots = gold();
    reduceAcrossTranches(lots, 5000, true);
    assertEqual(lots.map(lot => lot.marketValue).join(), '60000,55000', 'Rückfall Gold: zuerst die Tranche ohne Kaufdatum');
    const listed = gold();
    reduceAcrossTranches(listed, 5000, false);
    assertEqual(listed.map(lot => lot.marketValue).join(), '60000,55000', 'Rückfall ohne Datumsfolge: je Person und ISIN trotzdem Bankreihenfolge');
    assertEqual(sortTranchesFIFO([{ trancheId: 'b', purchaseDate: '2020-01-01' }, { trancheId: 'a', purchaseDate: 'kein Datum' }]).map(lot => lot.trancheId).join(), 'a,b',
        'Ungültiges Datum zählt wie ohne Datum (zuerst), kein NaN');
    // Andere Person: Datumsfolge über alle Tranchen wie bisher.
    assertEqual(bankOrderFallback([{ trancheId: 'x', sourceProfileId: 'q', isin: 'I', purchaseDate: '2021-01-01' }, { trancheId: 'y', sourceProfileId: 'p', isin: 'I', purchaseDate: '2019-01-01' }])
        .map(lot => lot.trancheId).join(), 'y,x', 'Rückfall: älteste zuerst');
}

// RK-2 P3 (Fable P3-1): Verkaufsdialog. A (2016, 40 €), B (2020, 80 €), C (2025, 110 €), Kurs 110 €, Teilfreistellung 30 %. Zeile A ist erledigt,
// 24 Stücke blieben in A. Zeile B: Die Bank verkauft zuerst die 24 Stücke aus A (vorher „92 Stück aus B“ ohne Hinweis, Steuer nur aus B).
import { projectSaleFlowLines } from '../app/tranches/sale-flow-model.js';
{
    const lot = (id, price, date, shares) => ({ schemaVersion: 2, trancheId: id, name: 'Muster Aktien-ETF', isin: ISIN, type: 'aktien_neu', category: 'equity', shares,
        purchasePrice: price, currentPrice: 110, purchaseDate: date, tqf: 0.3, taxExempt: false });
    const registry = { profiles: { p: { data: { depot_tranchen: JSON.stringify([lot('A', 40, '2016-06-15', 24), lot('B', 80, '2020-05-18', 300), lot('C', 110, '2025-02-14', 300)]),
        profile_kirchensteuer_pct: '0' } } } };
    const action = { quellen: [{ trancheId: 'p:A', sourceProfileId: 'p', isin: ISIN, kind: 'aktien_neu', brutto: 30000, steuer: 2000, netto: 28000 },
        { trancheId: 'p:B', sourceProfileId: 'p', isin: ISIN, kind: 'aktien_neu', brutto: 10000, steuer: 500, netto: 9500 }] };
    const line = (index, key, id, planNet, restNet, status) => ({ index, key, profileId: 'p', trancheId: `p:${id}`, assetClass: 'equity', planNet, restNet, soldNet: planNet - restNet, status });
    const flow = progress => projectSaleFlowLines({ action, progress, registry, people: [{ id: 'p', name: 'P' }], year: 2026 })[1];
    const done = flow({ lines: [line(0, 'a', 'A', 28000, 0, 'erledigt'), line(1, 'b', 'B', 9500, 9500, 'offen')] });
    assertEqual(done.bank.parts.map(part => `${part.tranche.trancheId}${part.shares}`).join(), 'A24,B70', 'Dialog: Rest aus A zuerst, dann B');
    assert(done.bank.differs && done.bank.tax > 600, `Dialog: Steuer mit A (${done.bank.tax} €)`);
    // Ist Zeile A noch offen und verkauft alle Stücke aus A, beginnt Zeile B wie bisher bei B.
    const open = flow({ lines: [line(0, 'a', 'A', 2000, 2000, 'offen'), line(1, 'b', 'B', 9500, 9500, 'offen')] });
    assertEqual(open.bank.parts[0].tranche.trancheId, 'B', 'Dialog: A-Zeile offen und verkauft A ganz → B zuerst');
}
