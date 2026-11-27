// SP-1c (Nutzer 15.11.2026): Jahresabschluss warnt bei Geld unterwegs. Die Wiederherstellung einer Person ist mit SV-1 entfallen.
// Nur synthetische Daten: Max und Erika sowie Martin und Petra, Testdatum 23.10.2026.
import { PersistenceFacade as P, persistenceStorage as storage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { listMoneyUnderway, moneyUnderwayCloseText } from '../app/tranches/sale-underway.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const DATE = '2026-10-23', MAX = 'muster_a', ERIKA = 'muster_b', MARTIN = 'muster_martin', LS = CONFIG.STORAGE.LS_KEY;
let durable = {};
const archive = new Map();
async function boot(records = durable) {
    durable = records;
    resetPersistenceForTests({ name: 'sp-1c-synthetic', loadAll: async () => ({ ...durable }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete durable[key]); batch.upserts.forEach(([key, value]) => { durable[key] = value; }); },
        writeSnapshot: async snapshot => { archive.set(snapshot.id, structuredClone(snapshot)); }, readSnapshot: async id => structuredClone(archive.get(id) ?? null),
        listSnapshots: async () => [...archive.values()], deleteSnapshot: async id => archive.delete(id) });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
setAppTestDate(DATE);

// 1 · Erkennung offener Posten und Text je Zeile.
{
    const reg = JSON.parse(createMusterHaushaltRecords(DATE, 'max-erika', 'teilweise').rs_profiles_v1);
    const items = listMoneyUnderway(reg, [MAX, ERIKA]);
    assertEqual(items.map(item => `${item.kind}/${item.name}/${item.executedAt}/${item.amount}`).join(' '), 'credit/Erika/2026-09-02/30381', 'offene Gutschrift von Erika erkannt');
    assertEqual(moneyUnderwayCloseText(items[0]), 'Erst die offene Gutschrift von Erika bestätigen (Verkauf vom 02.09.2026, 30.381 €). Sonst rechnet der Jahresabschluss mit zu wenig Tagesgeld.', 'Zeile im Wortlaut');
    assertEqual(listMoneyUnderway(reg, [MAX]).length, 0, 'nur Personen des Abschlusses');
    assertEqual(listMoneyUnderway(JSON.parse(createMusterHaushaltRecords(DATE, 'max-erika', 'grund').rs_profiles_v1)).length, 0, 'ohne Belege keine Posten');
    assertEqual(listMoneyUnderway({ profiles: {}, trancheReconciliation: { schemaVersion: 1, actions: 'kaputt' } }).length, 0, 'unlesbarer Verlauf ergibt keine Posten');
}
{
    await boot(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const lot = JSON.parse(registry().profiles[MARTIN].data.depot_tranchen).find(item => item.name === 'Muster Aktien-ETF');
    const shares = 10000 / lot.currentPrice, cash = Number(registry().profiles[MARTIN].data.profile_tagesgeld);
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: MARTIN, actionId: 'sp1c-kauf', executedAt: DATE, assetClass: 'equity', shares, gross: 10000, fees: 4.9, cashValue: null,
        tranche: { schemaVersion: 2, trancheId: 'sp1c_kauf', name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: lot.ticker, isin: lot.isin, shares,
            purchasePrice: 10004.9 / shares, currentPrice: lot.currentPrice, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' } }] }));
    const [debit] = listMoneyUnderway(registry());
    assertEqual(moneyUnderwayCloseText(debit), 'Erst die offene Abbuchung von Martin bestätigen (Kauf vom 23.10.2026, 10.004,90 €). Sonst rechnet der Jahresabschluss mit zu viel Tagesgeld.', 'offene Abbuchung mit Cent');
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ debits: [{ profileId: MARTIN, targetActionIds: ['sp1c-kauf'], value: Math.round((cash - 10004.9) * 100) / 100 }] }));
    assertEqual(listMoneyUnderway(registry()).length, 0, 'nach der Bestätigung kein Posten mehr');
}

// 2 · Hinweis beim Start des Jahresabschlusses: je Posten eine Zeile mit Weg zur Bestätigung, „Trotzdem fortfahren“, keine Sperre.
for (const variant of ['teilweise', 'grund']) {
    await boot(createMusterHaushaltRecords(DATE, 'max-erika', variant));
    const { doc } = createDialogFixture();
    const model = { activeId: MAX, scope: { key: 'household', ids: [MAX, ERIKA] }, now: new Date(2027, 0, 2, 12), members: [{ id: MAX, name: 'Max', count: 1 }, { id: ERIKA, name: 'Erika', count: 1 }],
        occasion: { kind: 'monthly', previousYear: 2026, previousMonth: 12 }, expenses: { year: 2026, month: 12, complete: true, spent: 0, rows: [] }, expenseBudget: 0, summary: { monthlyWithdrawal: 500 } };
    const people = [{ id: MAX, name: 'Max', value: 18000, lastDate: null, error: null }, { id: ERIKA, name: 'Erika', value: 12000, lastDate: null, error: null }];
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    let handle;
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: value => { handle = value; } });
    const note = doc.querySelector('[data-annual-money-underway]');
    if (variant === 'grund') {
        assertEqual(note, null, 'ohne offenes Geld kein Hinweis');
    } else {
        assert(note && !note.hidden, 'Hinweis steht beim Start über dem ersten Schritt');
        assert(note.className.includes('ds-note-warning') && note.children[0].textContent === 'Geld unterwegs', 'Warnstil mit Wort');
        const rows = note.querySelectorAll('[data-annual-money-underway-item]');
        assertEqual(rows.map(row => row.textContent).join(' | '), 'Erst die offene Gutschrift von Erika bestätigen (Verkauf vom 02.09.2026, 30.381 €). Sonst rechnet der Jahresabschluss mit zu wenig Tagesgeld.', 'je Posten eine Zeile');
        const link = note.querySelector('a');
        assertEqual(`${link.textContent} → ${link.getAttribute('href')}`, `Gutschrift eintragen → depot-tranchen-manager.html?person=${ERIKA}#reconciliationCashStatuses`, 'Weg zur Bestätigung');
        handle.activate('expenses');
        assert(note.hidden, 'nur beim ersten Schritt sichtbar');
        handle.activate('prices');
        assert(!note.hidden, 'zurück am ersten Schritt wieder sichtbar');
        await note.querySelector('[data-annual-money-underway-proceed]').fire('click');
        assert(note.hidden, '„Trotzdem fortfahren“ blendet den Hinweis aus');
        handle.activate('expenses'); handle.activate('prices');
        assert(note.hidden, 'ausgeblendet bleibt ausgeblendet');
        assert(!doc.querySelector('[data-close-dialog-next="prices"]')?.disabled, 'der Abschluss bleibt bedienbar, keine Sperre');
    }
    handle.close(true); await pending.catch(() => null);
}
