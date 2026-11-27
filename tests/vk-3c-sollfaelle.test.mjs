// VK-3c (Nachschritt zu VK-3b, GH-1 und BV-1 aus den Gutachten VK3B und VK3B-FABLE). Nur synthetische Daten: Musterhaushalt Martin und
// Petra, Testdatum 23.10.2026, Spielkurse. Punkt 1 (Tagesgeldfeld der Seite) prüft tests/tranchen-manager-page-contract.test.mjs.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { prepareTrancheDetailWrite, prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';

const DATE = '2026-10-23';
const MARTIN = 'muster_martin';
setAppTestDate(DATE);
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-3c-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const buyTranche = id => ({ schemaVersion: 2, trancheId: id, name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', isin: 'IE00BK5BQT80',
    shares: 685, purchasePrice: 98930.75 / 685, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' });

// Fable P3-3, Gemini Befund 1: Bei sehr langer Kennung bleiben Folgezähler und Stornokennung eindeutig (Zähler am Ende der gekürzten
// Kennung). 120 Zeichen (längste Kennung aus dem geführten Kauf) und 128 Zeichen (Höchstlänge): Kauf, Storno, Wiedereintrag, zweites Storno.
for (const length of [120, 128]) {
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const order = `order-buy-${MARTIN}-${DATE}-`.padEnd(length, '7');
    const buy = trancheId => ({ profileId: MARTIN, actionId: order, executedAt: DATE, assetClass: 'equity', tranche: buyTranche(trancheId),
        shares: 685, gross: 98920.85, fees: 9.9, cashValue: null });
    const write = async request => { const prepared = await prepareSaleFlowWrite({ buys: [request] }); await commitSaleFlowWrite(prepared); return prepared.results[0]; };
    const actions = () => JSON.parse(storage.getItem('rs_profiles_v1')).trancheReconciliation.actions;
    assertEqual((await write(buy('vk3c_l1'))).actionId, order, `${length} Zeichen: Kauf mit voller Kennung`);
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3c_l1', cancelBuy: order }));
    const again = await write(buy('vk3c_l2'));
    assert(again.status === 'applied' && again.actionId.endsWith('~r2') && again.actionId.length <= 128, `${length} Zeichen: Wiedereintrag mit ~r2 (${again.actionId.length} Zeichen)`);
    let error = '';
    try { await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3c_l2', cancelBuy: again.actionId })); } catch (caught) { error = caught.code || caught.message; }
    assertEqual(error, '', `${length} Zeichen: zweites Storno gespeichert`);
    const cancels = actions().filter(item => item.eventType === 'buy_cancelled').map(item => item.actionId);
    assert(cancels.length === 2 && new Set(cancels).size === 2 && cancels[1].endsWith('~r2') && cancels.every(id => id.length <= 128),
        `${length} Zeichen: zwei verschiedene Stornokennungen, Zähler am Ende (${cancels.map(id => id.slice(-6)).join(' / ')})`);
    assertEqual((await write(buy('vk3c_l3'))).actionId.slice(-3), '~r3', `${length} Zeichen: dritter Eintrag mit ~r3`);
}

// Gemini, Randhinweis zu Frage 3: „ab MM/JJJJ“ nur, wenn der Beginnmonat nach dem heutigen Monat liegt; im Beginnmonat gilt die Rente als
// laufend (Erika, Beginn am 29.10.2026).
{
    const { pensionDetail } = await import('../app/overview/overview-renderer.js');
    const erika = status => ({ values: { renteMonatlich: 1600 }, personDates: { pensionStatus: status } });
    const text = (status, day) => pensionDetail(erika(status), new Date(`${day}T12:00:00`)).replace(/\s/g, ' ');
    assertEqual(text('Rente ab 29.10.2026', '2026-10-28'), '1.600 € Rente / Monat', 'Beginnmonat vor dem Starttag: laufend');
    assertEqual(text('Rente ab 01.11.2026', '2026-10-28'), '1.600 € Rente ab 11/2026', 'Beginn im nächsten Monat: „ab 11/2026“');
    assertEqual(text('Rente läuft seit 01.10.2026', '2026-10-28'), '1.600 € Rente / Monat', 'laufende Rente');
}

// SV-1: Die Gruppen der Wiederherstellungspunkte (Anlass, Bezeichnung) sind mit der einfachen Liste entfallen.
