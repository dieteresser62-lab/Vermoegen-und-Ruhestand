// TRG-1 (FR-80): Steuerlast je Euro mit Teilfreistellung und Entnahmemodus „Eine Person trägt“.
// Nur synthetische Daten: Musterhaushalt Martin und Petra (unverheiratet), Testdatum 23.10.2026.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { calculateTaxPerEuro, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const DATE = '2026-10-23';
const MARTIN = 'muster_martin', PETRA = 'muster_petra';
setAppTestDate(DATE);

/** Balance-Personen wie in der Balance; Tagesgeld je Person für die Sollfälle. */
function profiles(cash = { [MARTIN]: 20000, [PETRA]: 5000 }) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra');
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const [id, value] of Object.entries(cash)) {
        registry.profiles[id].data.profile_tagesgeld = String(value);
        if (data.rs_current_profile === id) data.profile_tagesgeld = String(value);
    }
    data.rs_profiles_v1 = JSON.stringify(registry);
    return buildBalanceEngineInputFromStorage({ storage: { getItem: key => data[key] ?? null }, referenceYear: 2026 }).profiles;
}
const byId = (list, id) => list.find(item => item.profileId === id);

// Abschnitt 2 · Steuerlast je Euro wie die Tranchenwahl (FR-80 Punkt 8).
{
    const list = profiles();
    const martin = byId(list, MARTIN), petra = byId(list, PETRA);
    assertClose(35000 * calculateTaxPerEuro(petra.inputs, petra.tranches), 1031, 0.5, 'Petra 35.000 € Verkauf: Steuer 1.031 € (Gewinnanteil 15,96 %, Teilfreistellung 30 %)');
    assertClose(35000 * calculateTaxPerEuro(petra.inputs), 1473, 0.5, 'Gegenprobe ohne Tranchen wie bisher: 1.473 €');
    const proportional = 32437 * calculateTaxPerEuro(martin.inputs, martin.tranches) + 2563 * calculateTaxPerEuro(petra.inputs, petra.tranches);
    assertClose(proportional, 2471, 0.5, 'anteilig 32.437 / 2.563 €: Steuer nach neuer Kennzahl 2.471 € (vorher 3.530 €)');
    assertClose(32437 * calculateTaxPerEuro(martin.inputs) + 2563 * calculateTaxPerEuro(petra.inputs), 3530, 0.5, 'Gegenprobe anteilig alt 3.530 €');
    const exempt = petra.tranches.map(lot => ({ ...lot, taxExempt: true }));
    assertEqual(calculateTaxPerEuro(petra.inputs, exempt), 0, '„ganz steuerfrei“ ergibt 0 € je Euro');
    const distribution = calculateWithdrawalDistribution(list, { netWithdrawal: 60000 }, 'tax_optimized');
    assertClose(byId(distribution.items, PETRA).taxPerEuro * 35000, 1031, 0.5, 'Balance-Aufteilung nutzt die neue Kennzahl');
    assertEqual(byId(distribution.items, PETRA).sellAmount, 35000, 'steueroptimiert: Petra verkauft 35.000 € (Reihenfolge unverändert)');
}

// Abschnitt 3 · Modus „Eine Person trägt“ (FR-80 Punkte 1–7).
import { assertPlanValues, PLAN_DEFAULTS, readHouseholdPlan, planScope } from '../app/profile/household-plan.js';
import { oneCarriesMode, parseWithdrawalMode, isWithdrawalMode } from '../app/profile/household-withdrawal-mode.js';
import { unmarriedWithdrawalPlan } from '../app/simulator/simulator-unmarried.js';
import { carrierNoteText } from '../app/shared/annual-todo-view.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
const CARRIES = oneCarriesMode(MARTIN);
{
    const list = profiles();
    const result = calculateWithdrawalDistribution(list, { netWithdrawal: 60000 }, CARRIES);
    const martin = byId(result.items, MARTIN), petra = byId(result.items, PETRA);
    assertEqual(martin.tagesgeldUsed, 20000, 'Martin trägt: 20.000 € aus seinem Tagesgeld');
    assertEqual(martin.sellAmount, 40000, 'Martin trägt: 40.000 € Verkauf');
    assertClose(martin.taxEstimate, 2954, 0.5, 'Steuerschätzung 40.000 × 0,4000 × 0,7 × 0,26375 ≈ 2.954 €');
    assertEqual(petra.withdrawalAmount, 0, 'Petra 0 €');
    assertEqual(petra.tagesgeldUsed, 0, 'Petras Tagesgeld bleibt 5.000 €');
    assertEqual(result.attacked.length, 0, 'kein Hinweis, solange Martins Vermögen reicht');
    assertEqual(result.mode, CARRIES, 'Modus bleibt im Ergebnis erhalten');
    // Gegenprobe: steueroptimiert verkauft bei Petra.
    assertEqual(byId(calculateWithdrawalDistribution(list, { netWithdrawal: 60000 }, 'tax_optimized').items, PETRA).sellAmount, 35000, 'Gegenprobe steueroptimiert: Petra verkauft 35.000 €');
}
{
    // Rückfall: Martins Liquidität und Depot reichen nicht.
    const list = profiles();
    const martinAssets = byId(list, MARTIN).inputs, petraAssets = byId(list, PETRA).inputs;
    const martinTotal = 20000 + (martinAssets.depotwertAlt || 0) + (martinAssets.depotwertNeu || 0) + (martinAssets.goldWert || 0) + (martinAssets.geldmarktEtf || 0);
    const result = calculateWithdrawalDistribution(list, { netWithdrawal: martinTotal + 30000 }, CARRIES);
    assertClose(byId(result.items, MARTIN).withdrawalAmount, martinTotal, 1, 'Rückfall: Martin zahlt sein ganzes Vermögen');
    assertClose(byId(result.items, PETRA).withdrawalAmount, 30000, 1, 'Rückfall: Rest bei Petra');
    assertEqual(byId(result.items, PETRA).tagesgeldUsed, 5000, 'Rückfall wie steueroptimiert: Petras Liquidität zuerst');
    assertEqual(result.attacked.map(row => row.profileId).join(), PETRA, 'Rückfall: Petra steht im Hinweis');
    assertEqual(carrierNoteText(result), 'Vermögen von Petra wird angegriffen: Das Vermögen von Martin reicht für den gemeinsamen Anteil nicht mehr.', 'Hinweis in der Balance');
    void petraAssets;
}
{
    // Persönliche Pflegekosten einer pflegebedürftigen Petra trägt zuerst Petra (FR-72 Punkt 10), auch im neuen Modus.
    const list = profiles();
    // Petras Einkünfte (33.600 € im Jahr) decken zuerst ihre Pflegekosten von 50.000 €; den Rest zahlt sie aus ihrem Vermögen.
    const result = calculateWithdrawalDistribution(list, { netWithdrawal: 60000, personalNeeds: { [PETRA]: 50000 } }, CARRIES);
    const petra = byId(result.items, PETRA), martin = byId(result.items, MARTIN);
    assertClose(petra.withdrawalAmount, 50000 - byId(list, PETRA).inputs.renteMonatlich * 12, 0.01, 'Petra trägt ihre Pflegekosten selbst: 50.000 − 33.600 = 16.400 €');
    assertEqual(petra.tagesgeldUsed, 5000, 'Petra zahlt zuerst aus ihrem Tagesgeld');
    assertClose(martin.withdrawalAmount + petra.withdrawalAmount, 60000, 0.01, 'Summe bleibt die Haushaltsentnahme');
    assertEqual(result.attacked.length, 0, 'eigene Pflegekosten sind kein Angriff auf Petras Vermögen');
}
{
    // Stirbt die tragende Person, endet der Modus: ohne Martin gilt steueroptimiert.
    const petraOnly = profiles().filter(profile => profile.profileId === PETRA);
    const result = calculateWithdrawalDistribution(petraOnly, { netWithdrawal: 10000 }, CARRIES);
    assertEqual(result.attacked, undefined, 'ohne tragende Person kein Modus „Eine Person trägt“');
    assertEqual(byId(result.items, PETRA).withdrawalAmount, 10000, 'Petra zahlt allein');
}
{
    // Liquidität für Käufe und Planverkäufe: zuerst die tragende Person.
    const list = profiles();
    // Kauf aus Überschuss über die Haushaltsattribution: die Liquidität kommt zuerst von der tragenden Person.
    const buy = { type: 'TRANSACTION', quellen: [{ source: 'Liquidität', kind: 'liquiditaet', brutto: 21000, netto: 21000, steuer: 0 }],
        verwendungen: { liquiditaet: 0, gold: 0, aktien: 21000, geldmarkt: 0, bonds: 0 } };
    const paid = action => Object.fromEntries((action.quellen || []).filter(source => source.kind === 'liquiditaet').map(source => [source.sourceProfileId, source.brutto]));
    const carried = attributeHouseholdAction({ householdAction: buy, profiles: list, mode: CARRIES }).finalAction;
    assertEqual(JSON.stringify(paid(carried)), JSON.stringify({ [MARTIN]: 20000, [PETRA]: 1000 }), 'Kauf: Martin zahlt zuerst 20.000 €, Rest 1.000 € von Petra');
    const petraCarries = attributeHouseholdAction({ householdAction: buy, profiles: list, mode: oneCarriesMode(PETRA) }).finalAction;
    assertEqual(paid(petraCarries)[PETRA], 5000, 'Gegenprobe Petra trägt: zuerst Petras 5.000 €');
    // Planverkauf: zuerst die Tranchen der tragenden Person (steueroptimiert nähme Petras Tranche mit dem kleineren Gewinnanteil).
    const sale = { type: 'TRANSACTION', quellen: [{ source: 'Aktien', kind: 'aktien_neu', category: 'equity', brutto: 30000, netto: 29700, steuer: 300,
        sourceProfileId: PETRA, realizedGainSigned: 4800, taxableAfterTqfSigned: 3360, tqf: 0.3 }],
        verwendungen: { liquiditaet: 29000, gold: 0, aktien: 0, geldmarkt: 0, bonds: 0 } };
    const sellers = action => [...new Set((action.quellen || []).filter(source => source.kind !== 'liquiditaet').map(source => source.sourceProfileId))].join();
    assert(sellers(attributeHouseholdAction({ householdAction: sale, profiles: list, mode: 'tax_optimized' }).finalAction).includes(PETRA), 'Gegenprobe steueroptimiert: Planverkauf auch bei Petra (Pauschbeträge beider)');
    assertEqual(sellers(attributeHouseholdAction({ householdAction: sale, profiles: list, mode: CARRIES }).finalAction), MARTIN, 'Martin trägt: Planverkauf nur bei Martin');
    // Simulator (unverheiratet): gemeinsamer Anteil allein bei der tragenden Person, Rückfall mit Hinweis.
    const portfolio = { personAccounts: [{ profileId: MARTIN, tagesgeld: 1000 }, { profileId: PETRA, tagesgeld: 50000 }] };
    const plan = unmarriedWithdrawalPlan([{ profileId: MARTIN, share: 1, care: 0, carries: true }, { profileId: PETRA, share: 0, care: 0, carries: false }], 3000, portfolio);
    assertEqual(plan.items.map(item => item.withdrawalAmount).join('/'), '1000/2000', 'Simulator: Martin zahlt 1.000 €, Rest 2.000 € bei Petra');
    assertEqual(plan.attacked?.[0]?.profileId, PETRA, 'Simulator: Hinweis „Vermögen von Petra wird angegriffen“');
}
{
    // Speicher: neuer Wert im vorhandenen Feld; alte Daten ohne neuen Wert bleiben, nichts geschrieben.
    assertEqual(parseWithdrawalMode(CARRIES).carrierId, MARTIN, 'gespeicherter Wert nennt die tragende Person');
    assert(isWithdrawalMode('tax_optimized') && isWithdrawalMode(CARRIES), 'alte und neue Werte gültig');
    assert(!isWithdrawalMode('one_carries:') && !isWithdrawalMode('one_carries:a b') && !isWithdrawalMode('joint'), 'unvollständige Werte ungültig');
    assertPlanValues({ ...structuredClone(PLAN_DEFAULTS), householdWithdrawalMode: CARRIES });
    const data = createMusterHaushaltRecords(DATE, 'martin-petra');
    const before = JSON.stringify(data);
    const scope = planScope('household', [MARTIN, PETRA]);
    const read = readHouseholdPlan({ scope, storage: { getItem: key => data[key] ?? null, setItem: () => { throw new Error('geschrieben'); } } });
    assertEqual(read.entry.values.householdWithdrawalMode, 'tax_optimized', 'alter Stand liest seinen Modus wie gespeichert');
    assertEqual(JSON.stringify(data), before, 'Lesen schreibt nichts (keine Migration)');
}
