// VN-3 (Gutachten LDV-FABLE P2-1, Ergänzung 1 FR-80): Bei „Eine Person trägt“ ist Auffüllen kein Rückgriff. Reicht das Vermögen der
// tragenden Person nicht für ihr Liquiditätsziel, bleibt es unerreicht (Hinweis); die andere Person verkauft dafür nie.
// Nur Musterhaushalt Martin und Petra, Testdatum 23.10.2026.
// Vorher: Martin (Tagesgeld 10.000 €, Depot 80.000 €) verkaufte alles, Petra (Tagesgeld 110.000 €, Depot 500.000 €) zusätzlich rund
// 43.700 € aufs eigene Tagesgeld; im Simulator wuchs Petras Liquidität in Jahr 14 und 16 um 23.000 und 73.000 €.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { oneCarriesMode } from '../app/profile/household-withdrawal-mode.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';
const sum = (items, read) => items.reduce((total, item) => total + (Number(read(item)) || 0), 0);
const sold = action => sum((action.quellen || []).filter(source => source.kind !== 'liquiditaet'), source => source.brutto);

/** Balance mit dem echten Weg (Haushalts-Engine, Zuordnung, Auszahlungsverteilung); Depots auf die genannten Werte skaliert. */
function household(cash, depot) {
    setAppTestDate(DATE);
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', 'traegt');
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const id of [MARTIN, PETRA]) {
        const stored = registry.profiles[id].data;
        stored.profile_tagesgeld = String(cash[id]);
        const lots = JSON.parse(stored.depot_tranchen), total = sum(lots, lot => lot.shares * lot.currentPrice);
        for (const lot of lots) lot.shares *= depot[id] / total;
        stored.depot_tranchen = JSON.stringify(lots);
        if (data.rs_current_profile === id) Object.assign(data, { profile_tagesgeld: stored.profile_tagesgeld, depot_tranchen: stored.depot_tranchen });
    }
    data.rs_profiles_v1 = JSON.stringify(registry);
    const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => data[key] ?? null }, referenceYear: 2026 });
    return evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState, { engineApi: EngineAPI, withdrawalMode: oneCarriesMode(MARTIN) });
}
const person = (runs, id) => runs.find(run => run.profileId === id).ui.action;

// Balance: Martins Depot reicht nicht für sein Ziel. Er verkauft höchstens sein Depot, Petra verkauft und kauft nichts; Hinweis statt Rückgriff.
{
    const runs = household({ [MARTIN]: 10000, [PETRA]: 110000 }, { [MARTIN]: 80000, [PETRA]: 500000 });
    const martin = person(runs, MARTIN), petra = person(runs, PETRA);
    assertEqual(sold(petra), 0, `VN-3: Petra verkauft fürs Auffüllen nichts (vorher rund 43.700 €, jetzt ${sold(petra).toFixed(2)} €)`);
    assertEqual(sum(['aktien', 'gold', 'bonds', 'liquiditaet'], key => petra.verwendungen?.[key] || 0), 0, 'VN-3: Petra bekommt keinen Auftrag');
    assert(sold(martin) <= 80000 + 0.01, `VN-3: Martin verkauft höchstens sein Depot (${sold(martin).toFixed(2)} €)`);
    assertEqual(runs.distribution.attacked?.length || 0, 0, 'VN-3: kein Rückgriff-Hinweis, die Entnahme trägt Martin');
    assert(runs.distribution.carrierReserveShort?.amount > 1000 && runs.distribution.carrierReserveShort.profileId === MARTIN,
        'VN-3: Hinweis „Reserve von Martin unter Ziel“ mit Fehlbetrag');
}
// Gegenprobe: Mit Martins vollem Depot erreicht er sein Ziel, kein Hinweis.
{
    const runs = household({ [MARTIN]: 10000, [PETRA]: 110000 }, { [MARTIN]: 500000, [PETRA]: 70000 });
    assertEqual(sold(person(runs, PETRA)), 0, 'VN-3 Gegenprobe: Petra verkauft nichts');
    assert(!runs.distribution.carrierReserveShort, 'VN-3 Gegenprobe: kein Hinweis „unter Ziel“, Martins Vermögen reicht');
}
// Simulator (Backtest 2000–2025, „Martin trägt“, Petra 110.000 €): Petras Liquidität wächst nie durch Verkäufe fürs Auffüllen.
{
    const inputs = await measurementInputs(0, 'martin-petra', DATE, 'traegt');
    inputs.simulationPeople = inputs.simulationPeople.map(entry => ({ ...entry, tagesgeld: entry.profileId === PETRA ? 110000 : entry.tagesgeld }));
    inputs.tagesgeld = sum(inputs.simulationPeople, entry => entry.tagesgeld);
    const rows = backtest(inputs, 2000, 2025).rows.map(item => item.row);
    const petra = rows.map(row => { const account = row.personAccounts.find(entry => entry.profileId === PETRA); return account.tagesgeld + account.geldmarktEtf; });
    const jump = Math.max(...petra.slice(1).map((value, index) => value - petra[index]));
    assert(jump < 10000, `VN-3: Simulator – Petras Liquidität steigt je Jahr um höchstens ihre eigenen Zuflüsse (größter Anstieg ${Math.round(jump)} €, vorher 73.000 €)`);
    assert(rows.some(row => row.personalPayout?.carrierReserveShort?.amount > 0), 'VN-3: Simulator – Hinweis „unter Ziel“, sobald Martins Depot nicht mehr reicht');
    console.log('✅ VN-3: Simulator – kein Verkauf bei Petra fürs Auffüllen');
}
