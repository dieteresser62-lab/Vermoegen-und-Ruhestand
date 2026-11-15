// TR-2 (Ergänzung 1 FR-80): Bei „Eine Person trägt“ bekommt die andere Person in der Planung keine Aufträge (keine Umschichtung
// Tagesgeld → Geldmarkt, keine Käufe), nur einen Hinweis. Manuelle Einträge bleiben für beide möglich. Nur Musterhaushalte, Testdatum 23.10.2026.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { evaluateBalanceCurrentYear } from '../app/balance/balance-reserve-today.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { withdrawalModeText, planModeChangeText } from '../app/shared/household-plan-fields.js';
import { createPlanDetails } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';
async function area(variant, cash) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', variant);
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const [id, value] of Object.entries(cash)) registry.profiles[id].data.profile_tagesgeld = String(value);
    data.rs_profiles_v1 = JSON.stringify(registry);
    if (cash[data.rs_current_profile] !== undefined) data.profile_tagesgeld = String(cash[data.rs_current_profile]);
    P.resetPersistenceForTests({ name: 'tr-2', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
setAppTestDate(DATE);
const transfers = async (variant, cash) => {
    await area(variant, cash);
    const year = evaluateBalanceCurrentYear({ storage, engineApi: EngineAPI, profileId: storage.getItem('rs_current_profile') });
    const prepared = new ActionRenderer({}).prepareExecutionEntries(year.profileActionResults, year.zielLiquiditaet) || [];
    const rows = new ActionRenderer({})._integrateProfileCashRebalance(year.profileActionResults, null, year.zielLiquiditaet);
    return { rows, prepared };
};

// Befund 1: Martin trägt, Tagesgeld 10.000 / 110.000 €: keine Umschichtung bei Petra (vorher „Tagesgeld → Geldmarkt Petra 100.000 €“).
{
    const { rows } = await transfers('traegt', { [MARTIN]: 10000, [PETRA]: 110000 });
    const petra = rows.find(row => row.profileId === PETRA);
    assert(petra && !petra.action.internalCashRebalance, 'Martin trägt: keine Umschichtung für Petra');
    assertEqual(petra.action.carrierHold, true, 'Petra ist als nicht tragende Person gekennzeichnet');
    assert(!rows.find(row => row.profileId === MARTIN).action.carrierHold, 'Martin bleibt ohne Kennzeichen');
    // Gegenprobe Vorgabemodus: gleiche Bestände, steueroptimiert → keine Kennzeichen, Rechnung wie bisher.
    const base = await transfers('grund', { [MARTIN]: 10000, [PETRA]: 110000 });
    assert(base.rows.every(row => !row.action.carrierHold && !row.heldBelowTarget), 'Vorgabemodus ohne Kennzeichen und Hinweis');
    // Martin trägt, 20.000 / 30.000 €: Martin schichtet seinen eigenen Überschuss um, Petra nicht (vorher 19.852,94 € bei Petra).
    const own = await transfers('traegt', { [MARTIN]: 20000, [PETRA]: 30000 });
    assert(own.rows.find(row => row.profileId === MARTIN).action.internalCashRebalance?.amount > 0, 'Martin: eigene Umschichtung bleibt');
    assert(!own.rows.find(row => row.profileId === PETRA).action.internalCashRebalance, 'Petra: keine Umschichtung');
}
// Liegt Petras Tagesgeld unter ihrem Ziel: nur Hinweis, kein Auftrag (keine Umschichtung Geldmarkt → Tagesgeld).
{
    const { rows } = await transfers('traegt', { [MARTIN]: 20000, [PETRA]: 0 });
    const petra = rows.find(row => row.profileId === PETRA);
    assert(!petra.action.internalCashRebalance, 'Petra unter Ziel: kein Auftrag');
    assertEqual(petra.heldBelowTarget, true, 'Petra unter Ziel: Hinweis');
}
// Manuelle Einträge bleiben möglich: Petra kauft im Modus „Martin trägt“ selbst Geldmarkt.
{
    await area('traegt', { [MARTIN]: 20000, [PETRA]: 30000 });
    const lot = { schemaVersion: 2, trancheId: 'tr2_petra_gm', name: 'Muster Geldmarkt', type: 'geldmarkt', category: 'money_market', ticker: 'XEON.DE',
        isin: 'LU0290358497', shares: 50, purchasePrice: 121.478441, currentPrice: 121.478441, purchaseDate: DATE, tqf: 0, taxExempt: false, notes: '' };
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: PETRA, actionId: 'tr2-petra-gm', executedAt: DATE, assetClass: 'money_market',
        tranche: lot, shares: 50, gross: 6073.92, fees: 0, cashValue: 30000 - 6073.92 }] }));
    const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
    assert(JSON.parse(registry.profiles[PETRA].data.depot_tranchen).some(item => item.trancheId === 'tr2_petra_gm'), 'Manueller Geldmarktkauf von Petra gespeichert');
    assertClose(Number(registry.profiles[PETRA].data.profile_tagesgeld), 23926.08, 0.005, 'Petras Tagesgeld nach ihrem eigenen Kauf');
}
// Befunde 2 und 3: Hinweis bei Moduswechsel nach dem Beschluss; „Details & Drucken“ nennt den Modus auch beim Vorgabemodus.
{
    const people = [{ id: MARTIN, name: 'Martin' }, { id: PETRA, name: 'Petra' }];
    assertEqual(withdrawalModeText('', people), 'Steueroptimiert', 'leer gilt als Vorgabe');
    assertEqual(withdrawalModeText(`one_carries:${MARTIN}`, people), 'Eine Person trägt · Martin', 'tragende Person mit Namen');
    assertEqual(planModeChangeText({ year: 2026, decidedMode: 'tax_optimized', currentMode: `one_carries:${MARTIN}`, people }),
        'Der Plan 2026 gilt wie beschlossen (Steueroptimiert). Die neue Verteilung gilt ab dem nächsten Jahresabschluss, die Vorschau rechnet schon damit.', 'Wechsel: Hinweis');
    assertEqual(planModeChangeText({ year: 2026, decidedMode: '', currentMode: 'tax_optimized', people }), '', 'ohne Wechsel kein Hinweis');
    const doc = new MockDocument();
    const details = createPlanDetails(doc, { year: 2026, decidedOn: '', rows: [], destinations: [], status: '', decidedModeText: 'Steueroptimiert' }, { type: 'NONE', quellen: [] }, people);
    assert(details.text.includes('Entnahme: Steueroptimiert'), '„Details & Drucken“: Entnahme: Steueroptimiert');
}
