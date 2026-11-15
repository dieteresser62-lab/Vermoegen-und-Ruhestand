// LZ-1 (Ergänzung 2 FR-80): Bei „Eine Person trägt“ zählen für Liquiditätsziel, Auffüllen und Anlegen nur Tagesgeld und Geldmarkt
// der tragenden Person. Martin trägt, Martin 10.000 € Tagesgeld, Petra 1.000 / 110.000 €. Nur Musterhaushalte, Testdatum 23.10.2026.
// Vorher: Martins Verkauf in der Vorschau 123.640 € bzw. 13.536 €, im Simulator (Jahr 1) hing er ebenso an Petras Tagesgeld.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { evaluateBalanceCurrentYear } from '../app/balance/balance-reserve-today.js';
import { reserveActionSource } from '../app/balance/balance-reserve-source.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';
const sum = (items, read) => items.reduce((total, item) => total + (Number(read(item)) || 0), 0);

async function preview(variant, petra) {
    setAppTestDate(DATE);
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', variant);
    const registry = JSON.parse(data.rs_profiles_v1);
    const cash = { [MARTIN]: 10000, [PETRA]: petra };
    for (const [id, value] of Object.entries(cash)) registry.profiles[id].data.profile_tagesgeld = String(value);
    data.rs_profiles_v1 = JSON.stringify(registry);
    data.profile_tagesgeld = String(cash[data.rs_current_profile]);
    P.resetPersistenceForTests({ name: 'lz-1', loadAll: async () => ({ ...data }), async saveBatch() {},
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const year = evaluateBalanceCurrentYear({ storage, engineApi: EngineAPI, profileId: storage.getItem('rs_current_profile') });
    const { prepared } = reserveActionSource(year, null);
    const row = id => {
        const entry = prepared.find(item => item.profileId === id), action = entry.action, uses = action.verwendungen || {};
        const sales = (action.quellen || []).filter(source => source.kind !== 'liquiditaet' && source.source !== 'Liquidität');
        const purchases = sum(['aktien', 'gold', 'bonds', 'geldmarkt'], key => uses[key] || 0) + (action.liquidityInflowToMoneyMarket || 0);
        return { sale: sum(sales, source => source.brutto), target: entry.input.personalTagesgeldTarget,
            cashAfter: entry.input.tagesgeld + sum(sales, source => source.netto) + sum(action.cashOutflowSales || [], source => source.netto) - purchases };
    };
    return { martin: row(MARTIN), petra: row(PETRA), hash: JSON.stringify(year.profileActionResults.map(item => item.action)) };
}

async function simulatorYear(variant, petra) {
    const inputs = await measurementInputs(0, 'martin-petra', DATE, variant);
    inputs.simulationPeople = inputs.simulationPeople.map(person => ({ ...person, tagesgeld: person.profileId === PETRA ? petra : 10000 }));
    inputs.tagesgeld = sum(inputs.simulationPeople, person => person.tagesgeld);
    const row = backtest(inputs, 2000, 2001).rows[0].row;
    return { sale: row.vk.vkGes, payout: row.personalPayout.items.find(item => item.profileId === MARTIN).amount,
        accounts: Object.fromEntries(row.personAccounts.map(account => [account.profileId, account.tagesgeld + account.geldmarktEtf])) };
}

// Balance-Vorschau ohne Beleg: Martins Verkauf hängt nicht mehr an Petras Tagesgeld; Petra bleibt stehen; Martin endet bei seinem Ziel.
{
    const low = await preview('traegt', 1000), high = await preview('traegt', 110000);
    assertClose(high.martin.sale, low.martin.sale, 1, `LZ-1: Martins Verkauf unabhängig von Petra (${low.martin.sale.toFixed(2)} / ${high.martin.sale.toFixed(2)} €)`);
    for (const [petra, view] of [[1000, low], [110000, high]]) {
        assertEqual(view.petra.sale, 0, `LZ-1: Petra verkauft nichts (Petra ${petra} €)`);
        assertClose(view.petra.cashAfter, petra, 0.005, `LZ-1: Petras Tagesgeld bleibt (Petra ${petra} €)`);
        assertClose(view.martin.cashAfter, view.martin.target, 0.5, `LZ-1: Martins Tagesgeld danach = sein Ziel (Petra ${petra} €)`);
    }
    console.log('✅ LZ-1: Vorschau – Martins Verkauf und Tagesgeld unabhängig von Petra');
}
// Simulator Jahr 1 (Backtest ab 2000): gleicher Verkauf und gleiche Liquidität bei Martin, Petra unverändert bis auf ihre eigenen Buchungen.
{
    const low = await simulatorYear('traegt', 1000), high = await simulatorYear('traegt', 110000);
    assertClose(high.sale, low.sale, 1, `LZ-1: Simulator – Martins Verkauf unabhängig von Petra (${low.sale.toFixed(2)} / ${high.sale.toFixed(2)} €)`);
    // Die Flex-Entscheidung rechnet weiter mit dem Haushalt (Petras Tagesgeld zählt für die Reichweite): Bei 1.000 € kürzt sie stärker.
    // Martins Liquidität unterscheidet sich deshalb nur um seine höhere Auszahlung (und Zinsen darauf), nicht um Petras Tagesgeld.
    assertClose(high.accounts[MARTIN] + high.payout, low.accounts[MARTIN] + low.payout, 150, 'LZ-1: Simulator – Martins Liquidität plus Auszahlung unabhängig von Petra');
    console.log('✅ LZ-1: Simulator – Martins Verkauf unabhängig von Petra');
}
// Gegenprobe Vorgabemodus: Petras Tagesgeld zählt weiter für den Haushalt. Byte-Gleichheit prüft measure-ph1.
{
    const low = await preview('grund', 1000), high = await preview('grund', 110000);
    assert(low.hash !== high.hash, 'LZ-1: Vorgabemodus rechnet weiter mit der Liquidität des Haushalts (Aktion hängt an Petras Tagesgeld)');
    console.log('✅ LZ-1: Vorgabemodus unverändert mit Haushaltsliquidität');
}
