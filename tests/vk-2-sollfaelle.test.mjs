// VK-2 (FR-79 Punkte 5–8, 10, 11 mit Ergänzung 1; Nachträge 1–3): Sollfälle des geführten Kaufs, der Kursprüfung und des Stands der
// Käufe. Nur synthetische Daten: Musterhaushalt Martin und Petra, Testdatum 23.10.2026, Spielkurse.
import strict from 'node:assert/strict';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { suggestBuyShares, estimateBuy, settleBuy, buyRestLimit, restBuyQuestionAmount, annualBuyLines, projectBuyFlowState } from '../app/tranches/buy-flow-model.js';
import { buyFlowPlanFromConfirmed, readBuyFlowPlan, projectBuyFlowCard, suggestedSecurity } from '../app/tranches/buy-flow-dialog.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { readReconciliationHistory, projectBuyCashStatuses, projectReconciliationCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { searchSecurities } from '../app/tranches/tranchen-price-service.js';
import { pendingDebitTotal, debitUnderwayText, pendingCreditTotal } from '../app/tranches/sale-underway.js';
import { ironCashReserve } from '../app/balance/balance-play-execution.js';
import { oneCarriesMode } from '../app/profile/household-withdrawal-mode.js';
import { annualCloseBuyProgress } from '../app/shared/annual-close-result.js';
import { createPlanProgressNote, createPlanDetails } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23';
const MARTIN = 'muster_martin', PETRA = 'muster_petra';
const cents = value => Math.round(value * 100) / 100;
setAppTestDate(DATE);

// 1 · Stückvorschlag mit Kurspuffer und Gebührenannahme (Ergänzung 1 Punkt 3, Nachtrag 3), alter Vorschlag als Gegenprobe.
assertEqual(suggestBuyShares(100000, 144.47), 685, 'Martin ⌊(100.000 − 10) ÷ (144,47 × 1,01)⌋ = 685');
assertEqual(suggestBuyShares(22000, 144.47), 150, 'Petra ⌊21.990 ÷ 145,9147⌋ = 150');
assertEqual(Math.floor(100000 / 144.47), 692, 'Gegenprobe Entwurf ohne Puffer: 692');
assertEqual(suggestBuyShares(22000, 144.46978), 150, 'gerechnet mit dem angezeigten Kurs (2 Nachkommastellen)');
{
    const martin = estimateBuy(685, 144.47), petra = estimateBuy(150, 144.47);
    assertEqual(martin.gross, 98961.95, '685 × 144,47 = 98.961,95 €');
    assertEqual(Math.round(martin.debit), 98972, '≈ Belastung 98.972 €');
    assertEqual(Math.round(100000 - martin.debit), 1028, 'Tagesgeld Martin danach ≈ 1.028 €');
    assertEqual(petra.debit, 21680.5, 'Petra ≈ 21.680,50 €');
    assertEqual(cents(30000 - petra.debit), 8319.5, 'Tagesgeld Petra danach ≈ 8.319,50 €');
    const reserve = ironCashReserve(null, { floorBedarf: 36000, flexBedarf: 12000 });
    assertEqual(reserve, 8000, 'Mindest-Liquidität 8.000 € (2 Monate von 36.000 + 12.000 €)');
    assert(100000 - martin.debit + 30000 - petra.debit >= reserve, 'zusammen ≈ 9.348 € ≥ 8.000 € → Reserve gedeckt');
}

// 2 · Abrechnung Martin, Kaufpreis je Stück ungerundet (VKR P1), Erledigt-Grenze bei Käufen (Nachtrag 3).
{
    const result = settleBuy({ shares: 685, price: 144.41, fees: 9.9 });
    assertEqual(result.debit, 98930.75, '685 × 144,41 € + 9,90 € = 98.930,75 €');
    assertClose(result.pricePerShare, 144.4244525547445, 1e-9, 'Kaufpreis je Stück mit Gebühren gespeichert 144,4245…');
    assertEqual(Math.round(result.pricePerShare * 100) / 100, 144.42, 'angezeigt 144,42 €');
    assertEqual(cents(685 * result.pricePerShare), 98930.75, 'Einstand = Belastung genau');
    assertEqual(cents(100000 - result.debit), 1069.25, 'Tagesgeld-Vorschlag 1.069,25 €');
    assertEqual(buyRestLimit(100000, 144.47), 5000, 'Erledigt-Grenze 100.000 €: max(1 Stück 145,91 €; halbe Stufe 5.000 €)');
    assertEqual(restBuyQuestionAmount({ restAmount: 100000, amount: 100000, price: 144.47 }, result.debit), null, 'Rest 1.069,25 € unter der Grenze: erledigt ohne Frage');
    assertEqual(restBuyQuestionAmount({ restAmount: 100000, amount: 100000, price: 144.47 }, 60000), 40000, 'Rest 40.000 €: Rest-Frage');
    assertEqual(buyRestLimit(600, 121.48), 500, 'kleiner Kauf: halbe Engine-Stufe 500 € (Stufe 1.000 €)');
    assertEqual(buyRestLimit(5000, 2000), 2020, 'teures Stück: ein Stück mit Puffer 2.020 € über der halben Stufe');
}

// 3 · Kaufzeilen aus dem Jahresbeleg: wer zahlt aus welchem Tagesgeld, je Person und Anlageklasse (Nachtrag 1 und 3).
const records = createMusterHaushaltRecords(DATE, 'martin-petra', 'grund');
const entry = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
const registry0 = JSON.parse(records.rs_profiles_v1);
{
    const lines = annualBuyLines(entry.adopted.action, [MARTIN, PETRA]);
    assertEqual(lines.map(line => `${line.profileId}:${line.assetClass}:${line.amount}`).join(), `${MARTIN}:equity:100000,${PETRA}:equity:22000`, 'Beleg: Martin 100.000 €, Petra 22.000 € Aktien');
    const plan = buyFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MARTIN, PETRA], registry0, 'tax_optimized');
    assertEqual(plan.lines.length, 2, 'steueroptimiert: zwei Kaufzeilen');
    const carried = buyFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MARTIN, PETRA], registry0, oneCarriesMode(MARTIN));
    assertEqual(carried.lines.map(line => `${line.profileId}:${line.amount}`).join(), `${MARTIN}:122000`, 'Eine Person trägt (Nachtrag 2): nur Martin, alter Beleg zusammengefasst');
    // Ein Altbeleg hat weder Personen an den Quellen noch persönliche Verwendungen.
    const { personalUses: _personal, ...oldAction } = entry.adopted.action;
    const old = { ...oldAction, quellen: entry.adopted.action.quellen.map(source => ({ ...source, sourceProfileId: undefined })) };
    assertEqual(annualBuyLines(old, [MARTIN, PETRA]).map(line => line.profileId).join(), MARTIN, 'Altbeleg ohne Person: Rückfall beim Lesen auf die erste Person');
    const security = suggestedSecurity(registry0, plan.people, 'equity');
    assertEqual(`${security.name} · ${security.isin} · ${security.ticker}`, 'Muster Aktien-ETF · IE00BK5BQT80 · VWCE.DE', 'Vorschlag: Wertpapier derselben Klasse, das der Haushalt hat');
    assertEqual(security.holders.map(row => `${row.name} ${row.shares.toFixed(3)}`).join(', '), 'Martin 3460.931, Petra 484.530', 'Habt ihr schon: Martin 3.460,931, Petra 484,530 Stück');
}

// 4 · Kursprüfung über die vorhandene Suche (FR-79 Punkt 6, Nachtrag 3): Treffer, andere Währung, kein Treffer, Fehler, veraltet.
{
    const found = await searchSecurities('IE00BK5BQT80');
    assertEqual(found.isin, 'IE00BK5BQT80', 'Suche mit ISIN übernimmt die ISIN');
    assertEqual(found.hits[0].symbol, 'VWCE.DE', 'Treffer VWCE.DE');
    assert(found.hits[0].available && found.hits[0].currency === 'EUR' && found.hits[0].exchange === 'Xetra', 'Treffer → „✓ Kurs abrufbar“ mit Börse und Währung');
    const other = found.hits.find(hit => hit.symbol === 'VWRA.L');
    assert(other && other.status === 'currency' && !other.available, 'anderer Treffer in USD: „andere Währung, kein Kursabruf in €“');
    assertEqual((await searchSecurities('muster geld')).hits[0]?.symbol, 'XEON.DE', 'Spielbereich auch für Namen mit Leerzeichen');
    assertEqual((await searchSecurities('XYZ12345')).hits.length, 0, 'unbekannt → kein Treffer (Meldung, Kauf ohne Kursabruf möglich)');
    setAppTestDate(null);
    await strict.rejects(searchSecurities('VWCE', { fetchImpl: async () => { throw new Error('offline'); } }), error => error?.code === 'PROXY_UNREACHABLE', 'Fehler des Kursdienstes → Meldung, kein Absturz');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stale = await searchSecurities('VWCE', { nowSeconds, fetchImpl: async url => ({ ok: true, status: 200, json: async () => String(url).includes('/search')
        ? { quotes: [{ symbol: 'VWCE.DE', shortname: 'Synthetischer ETF', exchDisp: 'XETRA', quoteType: 'ETF' }] }
        : { symbol: 'VWCE.DE', price: 100, currency: 'EUR', asOf: nowSeconds - 10 * 24 * 3600, source: 'synthetisch' } }) });
    assertEqual(stale.hits[0].status, 'stale', 'veralteter Kurs (> 7 Tage) → Hinweis, nicht „✓ Kurs abrufbar“');
    assertEqual(stale.hits[0].assetClass, 'equity', 'Anlageform aus dem Typ (ETF → Aktien)');
    setAppTestDate(DATE);
}

// 5 · Gemeinsamer Schreiber: Kauf als `buy_reconciled`, neue Tranche, sofortige Abbuchung in einem Commit; Doppelschutz; offene Abbuchung.
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-2-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const tranche = (id, trancheId) => ({ schemaVersion: 2, trancheId, name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', isin: 'IE00BK5BQT80',
    shares: 685, purchasePrice: 98930.75 / 685, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' });
const martinBuy = (overrides = {}) => ({ profileId: MARTIN, actionId: 'vk2-martin-1', executedAt: DATE, assetClass: 'equity', tranche: tranche(MARTIN, 'vk2_martin_lot'),
    shares: 685, gross: 98920.85, fees: 9.9, cashValue: 1069.25, ...overrides });
{
    setAppTestDate(DATE);
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [martinBuy()] }));
    const reg = registry();
    const record = readReconciliationHistory(reg).find(item => item.actionId === 'vk2-martin-1');
    assertEqual(record.eventType, 'buy_reconciled', 'Kauf als eigenes Ereignis im Abgleich');
    assertEqual(record.actual.netCashDebited, 98930.75, 'Beleg trägt die Belastung');
    const lots = JSON.parse(reg.profiles[MARTIN].data.depot_tranchen);
    const lot = lots.find(item => item.trancheId === 'vk2_martin_lot');
    assert(lot && lot.shares === 685, 'jeder Kauf eine eigene Tranche (685 Stück)');
    assertClose(lot.costBasis, 98930.75, 0.005, 'Einstand = Belastung');
    assertEqual(Number(reg.profiles[MARTIN].data.profile_tagesgeld), 1069.25, 'sofortige Abbuchung im selben Commit: Tagesgeld 1.069,25 €');
    assert(lots.every(item => item.schemaVersion === 2 && Number.isFinite(item.shares)), 'depot_tranchen bleibt schemaVersion 2 mit shares (Handy-QR)');
    const before = JSON.stringify(registry());
    const again = await prepareSaleFlowWrite({ buys: [martinBuy()] });
    assert(again.unchanged, 'gleiche Wiederholung: duplicate, nichts geschrieben');
    await commitSaleFlowWrite(again);
    assertEqual(JSON.stringify(registry()), before, 'Wiederholung ändert keine Bytes');
    await strict.rejects(prepareSaleFlowWrite({ buys: [martinBuy({ cashValue: 1000 })] }), error => error?.code === 'RECONCILIATION_ACTION_CONFLICT', 'abweichender Abbuchungsstand ist Konflikt');
    await strict.rejects(prepareSaleFlowWrite({ buys: [martinBuy({ actionId: 'vk2-null', shares: 0 })] }), error => error?.code === 'BUY_FLOW_INVALID', 'kein Kauf mit 0 Stück');
    // Petra: Abbuchung kommt noch → offene Abbuchung, Hinweis „Abbuchung unterwegs“, keine Gutschrift-Erinnerung.
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: PETRA, actionId: 'vk2-petra-1', executedAt: DATE, assetClass: 'equity',
        tranche: { ...tranche(PETRA, 'vk2_petra_lot'), shares: 150, purchasePrice: 21677.5 / 150 }, shares: 150, gross: 21667.6, fees: 9.9, cashValue: null }] }));
    assertEqual(Number(registry().profiles[PETRA].data.profile_tagesgeld), 30000, 'Kommt noch: Tagesgeld unverändert');
    assertEqual(pendingDebitTotal(registry()), 21677.5, 'offene Abbuchung 21.677,50 €');
    assertEqual(debitUnderwayText(pendingDebitTotal(registry())), 'Abbuchung unterwegs: Vermögen um 21.677,50 € zu hoch.', 'Hinweis mit Betrag und Richtung');
    assertEqual(pendingCreditTotal(registry()), 0, 'Kauf erzeugt keine „Gutschrift nachtragen“');
    assertEqual(projectReconciliationCashStatuses(registry()).length, 0, 'Gutschriftstände nur für Verkäufe');
    // Stand der Käufe: Martin erledigt (Rest 1.069,25 €), Petra erledigt (Rest 322,50 € < 1 Stück? nein: halbe Stufe 500 €).
    const plan = buyFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MARTIN, PETRA], registry(), 'tax_optimized');
    const read = readBuyFlowPlan({ plan, registry: registry(), prices: Object.fromEntries(plan.lines.map(line => [line.key, 144.47])) });
    assertEqual(read.lines.map(line => `${line.name} ${line.status}`).join(', '), 'Martin erledigt, Petra erledigt', 'Zeilenstand nach der Erledigt-Grenze');
    const card = projectBuyFlowCard({ plan, registry: registry() });
    assertEqual(card.next, 4, 'Karte: „Weiter mit Schritt 4“ bis zur Abbuchung');
    assertEqual(card.pending[0]?.who, 'Petra', 'Karte nennt die offene Abbuchung von Petra');
    // Abbuchung bestätigen (vorhandener Cashweg, Ziel ist der Kauf).
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ debits: [{ profileId: PETRA, targetActionIds: ['vk2-petra-1'], value: 8322.5 }] }));
    assertEqual(Number(registry().profiles[PETRA].data.profile_tagesgeld), 8322.5, 'Abbuchung bestätigt: Tagesgeld 8.322,50 €');
    assertEqual(projectBuyCashStatuses(registry()).filter(status => status.isPending).length, 0, 'keine offene Abbuchung mehr');
    assertEqual(projectBuyFlowCard({ plan, registry: registry() }).next, null, 'Kauf abgeschlossen');
}

// 6 · Teilkauf und „Rest bleibt auf dem Tagesgeld“ (FR-79 Punkt 11 für Käufe).
{
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const plan = buyFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MARTIN, PETRA], registry(), 'tax_optimized');
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [martinBuy({ actionId: 'vk2-teil', shares: 400, gross: 57764, tranche: { ...tranche(MARTIN, 'vk2_teil'), shares: 400, purchasePrice: 57773.9 / 400 }, cashValue: null })] }));
    let lines = readBuyFlowPlan({ plan, registry: registry(), prices: { [`buy:${MARTIN}:equity`]: 144.47, [`buy:${PETRA}:equity`]: 144.47 } }).lines;
    const martin = lines.find(line => line.profileId === MARTIN);
    assertEqual(`${martin.status} ${martin.restAmount}`, 'teilweise 42226.1', 'Teilkauf: teilweise, 42.226,10 € offen');
    assertEqual(projectBuyFlowState(lines).next, 3, '„Weiter mit Schritt 3“');
    // VN-3 (Fable P2-3, Codex F03): Jahresabschluss und „Details & Drucken“ nennen den Kaufstand wie die Karte (vorher „— von 122.000 € gekauft“
    // bzw. keine Standzeile für Käufe).
    {
        const doc = new MockDocument(), flat = node => (node.textContent ?? '').replaceAll('\u202f', ' ').replaceAll('\u00a0', ' ');
        const buy = annualCloseBuyProgress(entry, 2026, [MARTIN, PETRA], registry());
        const note = flat(createPlanProgressNote(doc, { year: 2026, status: 'offen', soldNet: 0, planNet: 0, lines: [], buy }));
        assert(note.includes('57.774 € von 122.000 € gekauft'), `VN-3: Jahresabschluss nennt den Kaufstand (${note})`);
        const card = projectBuyFlowCard({ plan, registry: registry() });
        const details = createPlanDetails(doc, { year: 2026, decidedOn: '', rows: [], destinations: [], status: null, buyFlow: card }, { type: 'TRANSACTION', quellen: [] }, [{ id: MARTIN, name: 'Martin' }]);
        assert(details.text.replaceAll('\u202f', ' ').replaceAll('\u00a0', ' ').includes('Stand: 57.774 € von 122.000 € gekauft.'), `VN-3: Details & Drucken mit Standzeile der Käufe (${details.text})`);
    }
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ resolution: { year: 2026, ids: [MARTIN, PETRA], line: { key: martin.key, decision: 'keep_in_depot', reason: 'Tagesgeld bleibt' } } }));
    lines = readBuyFlowPlan({ plan, registry: registry() }).lines;
    const kept = lines.find(line => line.profileId === MARTIN);
    assert(kept.status === 'erledigt' && kept.keptCash && kept.keptReason === 'Tagesgeld bleibt', '„Erledigt · Rest bleibt auf dem Tagesgeld“ mit Warum');
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ resolution: { year: 2026, ids: [MARTIN, PETRA], line: { key: kept.key, decision: null } } }));
    assertEqual(readBuyFlowPlan({ plan, registry: registry() }).lines.find(line => line.profileId === MARTIN).status, 'teilweise', '„Rest doch kaufen“ nimmt die Entscheidung zurück');
}
