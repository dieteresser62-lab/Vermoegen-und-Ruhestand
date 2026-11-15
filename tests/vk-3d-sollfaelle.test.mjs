// VK-3d (Bedien-Durchlauf 13.11.2026). Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 23.10.2026, Spielkurse.
import { strict } from 'node:assert';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';

const DATE = '2026-10-23';
const ERIKA = 'muster_b';
setAppTestDate(DATE);
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-3d-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const snapshot = () => JSON.stringify(Object.fromEntries(P.keysSync().sort().map(key => [key, P.getItemSync(key)])));
const sales = () => (registry().trancheReconciliation?.actions || []).filter(item => item.eventType === 'sale_reconciled' && item.profileId === ERIKA);
const lotShares = () => JSON.parse(registry().profiles[ERIKA].data.depot_tranchen).find(item => item.trancheId === 'muster_b_lot_2').shares;

// Punkt 3: Zweite Teilausführung derselben Order am selben Tag. Erika verkauft 400 Stück (Ordernummer ORD-B6, Gutschrift „Schon da“),
// danach 160 Stück mit derselben Ordernummer. Kennung wie im Verkaufsablauf: `order-<Person>-<Tag>-<Ordernummer>`, `bankOrder` wie dort.
// Ohne Ordernummer (interne Kennung) bleibt eine abweichende Abrechnung ein Konflikt (tests/vk-1-sollfaelle.test.mjs).
{
    await freshArea(createMusterHaushaltRecords(DATE, 'max-erika', 'grund'));
    const order = `order-${ERIKA}-${DATE}-ORD-B6`;
    const before = lotShares();
    const first = { profileId: ERIKA, actionId: order, bankOrder: true, executedAt: DATE, cashValue: 69264.07,
        parts: [{ trancheId: 'muster_b_lot_2', shares: 400, gross: 57752, fees: 9.9, taxes: 478.03 }] };
    const second = { profileId: ERIKA, actionId: order, bankOrder: true, executedAt: DATE, cashValue: null,
        parts: [{ trancheId: 'muster_b_lot_2', shares: 160, gross: 23100.8, fees: 9.9, taxes: 350 }] };
    const write = async request => { const prepared = await prepareSaleFlowWrite({ sales: [request] }); await commitSaleFlowWrite(prepared); return prepared.results[0]; };
    assertEqual((await write(first)).actionId, order, 'erste Teilausführung mit der Kennung der Order');
    const part = await write(second);
    assert(part.status === 'applied' && part.actionId === `${order}~t2`, `zweite Teilausführung angenommen, Folgekennung ~t2 (${part.status} ${part.actionId})`);
    assertEqual(sales().length, 2, 'zwei Abrechnungen im Verlauf');
    assertEqual(Math.round((before - lotShares()) * 1000) / 1000, 560, 'Bestand um 400 + 160 Stück kleiner');
    // Nur dieselbe Abrechnung zweimal ist ein Duplikat; nichts wird doppelt geschrieben.
    const written = snapshot();
    for (const [request, label] of [[first, 'erste'], [second, 'zweite']]) {
        const again = await prepareSaleFlowWrite({ sales: [request] });
        assert(again.unchanged && again.results[0].status === 'duplicate', `${label} Abrechnung noch einmal: Duplikat`);
        await commitSaleFlowWrite(again);
    }
    assertEqual(snapshot(), written, 'Duplikate ändern nichts');
    // Gleiche Abrechnung mit anderem Kontostand bleibt ein Konflikt (Gutachten VK-1 P2-02), keine dritte Teilausführung.
    await strict.rejects(prepareSaleFlowWrite({ sales: [{ ...first, cashValue: 70000 }] }), error => error?.code === 'RECONCILIATION_ACTION_CONFLICT');
    // Eine dritte, andere Teilausführung bekommt ~t3.
    assertEqual((await write({ ...second, parts: [{ ...second.parts[0], shares: 5, gross: 721.9, fees: 1, taxes: 0 }] })).actionId, `${order}~t3`, 'dritte Teilausführung ~t3');
}

// Punkt 2: Passt Max' gespeichertes Tagesgeld nicht zum Verlauf (nicht nachgestellter Ausgangsstand des Bedien-Durchlaufs), nimmt
// „Schon abgegangen“ den eingetragenen Kontostand trotzdem an; danach passen Betrag und Verlauf wieder zueinander.
{
    const MAX = 'muster_a';
    const { readCashPerson } = await import('../app/profile/profile-cash-update.js');
    const records = createMusterHaushaltRecords(DATE, 'max-erika', 'grund');
    const broken = JSON.parse(records.rs_profiles_v1);
    broken.profiles[MAX].data.profile_tagesgeld = '17500';
    records.rs_profiles_v1 = JSON.stringify(broken);
    records.profile_tagesgeld = '17500';
    await freshArea(records);
    assert(readCashPerson(MAX, '', { profile_tagesgeld: storage.getItem('profile_tagesgeld'), profile_cash_history_v1: storage.getItem('profile_cash_history_v1') }).error,
        'Ausgangsstand: Betrag und Verlauf widersprechen sich');
    const tranche = { schemaVersion: 2, trancheId: 'vk3d_buy', name: 'Muster Geldmarkt', type: 'geldmarkt', category: 'money_market', ticker: 'XEON.DE',
        isin: 'LU0290358497', shares: 77, purchasePrice: (77 * 121.48 + 4.9) / 77, currentPrice: 121.48, purchaseDate: DATE, tqf: 0, taxExempt: false, notes: '' };
    const prepared = await prepareSaleFlowWrite({ buys: [{ profileId: MAX, actionId: 'vk3d-buy', executedAt: DATE, assetClass: 'money_market', tranche,
        shares: 77, gross: 9353.96, fees: 4.9, cashValue: 8641.14 }] });
    await commitSaleFlowWrite(prepared);
    const live = readCashPerson(MAX, '', { profile_tagesgeld: storage.getItem('profile_tagesgeld'), profile_cash_history_v1: storage.getItem('profile_cash_history_v1') });
    const saved = readCashPerson(MAX, '', registry().profiles[MAX].data);
    assert(!live.error && live.value === 8641.14 && !saved.error && saved.value === 8641.14, `eingetragener Stand gespeichert, ohne Widerspruch (${live.error || live.value})`);
    assertEqual(JSON.parse(storage.getItem('profile_cash_history_v1')).entries.at(-1).value, 8641.14, 'Verlauf endet mit dem eingetragenen Stand');
}
