// RK-2 (Ergänzung 1 FR-80, Gutachten zu TR-2): Bei „Eine Person trägt“ bekommt die andere Person auch mit beschlossenem Plan und beim
// Tagesgeld-Auffüllen keinen Auftrag; liegt ihr Tagesgeld unter ihrem Ziel, steht ein sichtbarer Hinweis in „Was zu tun ist“.
// Nur Musterhaushalte (Martin und Petra, Martin trägt), Testdatum 23.10.2026.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { evaluateBalanceCurrentYear } from '../app/balance/balance-reserve-today.js';
import { currentYearActionSource, projectBalanceReserves } from '../app/balance/balance-reserves.js';
import { prepareReserveSource } from '../app/balance/balance-reserve-source.js';
import { projectCashRefill, cashRefillPeople, heldBelowCashTarget } from '../app/balance/annual-todo.js';
import { createHeldCashNotes, HELD_BELOW_TARGET_TEXT } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';
setAppTestDate(DATE);
async function currentYear(variant, cash) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', variant);
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const [id, value] of Object.entries(cash)) registry.profiles[id].data.profile_tagesgeld = String(value);
    data.rs_profiles_v1 = JSON.stringify(registry);
    if (cash[data.rs_current_profile] !== undefined) data.profile_tagesgeld = String(cash[data.rs_current_profile]);
    P.resetPersistenceForTests({ name: 'rk-2', loadAll: async () => ({ ...data }), async saveBatch() {},
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const year = evaluateBalanceCurrentYear({ storage, engineApi: EngineAPI, profileId: storage.getItem('rs_current_profile') });
    const entry = Object.values(JSON.parse(data.annual_plan_record_v1).entries).find(item => item.year === 2026);
    const adopted = entry.adopted || entry.recommended;
    const confirmed = { year: 2026, action: adopted.action, ...(adopted.householdWithdrawal ? { householdWithdrawal: adopted.householdWithdrawal } : {}), progress: null };
    return { year, confirmed };
}
const reserves = (year, confirmed) => {
    const result = prepareReserveSource(year, currentYearActionSource(year, confirmed));
    return { prepared: result.prepared, view: projectBalanceReserves(year, result.prepared, { targetEntries: result.source.targetEntries, settled: result.source.settled }) };
};

// Punkt 2 (Gemini TR2-2, Fable P2-1): „Deine Reserven“ mit beschlossenem Plan. Martin trägt, Tagesgeld 10.000 / 110.000 €, Beleg 77.800,50 € netto
// bei Martin. Vorher wurde der Haushalt zu einem Eintrag zusammengelegt: Tagesgeld 120.000 € → 30.000 €. Soll: Petras 110.000 € bleiben stehen.
{
    const { year, confirmed } = await currentYear('traegt', { [MARTIN]: 10000, [PETRA]: 110000 });
    const { prepared, view } = reserves(year, confirmed);
    const petra = prepared.find(row => row.profileId === PETRA);
    assert(petra && petra.action.carrierHold === true && !petra.action.internalCashRebalance, 'Beleg: Petra ohne Umschichtung, als nicht tragend gekennzeichnet');
    assert(view.after.tagesgeld >= 110000 + 10000, `Beleg: Tagesgeld danach mit Petras 110.000 € (${view.after.tagesgeld})`);
    // LZ-1: Der Beleg der Variante füllt Martins eigene Liquidität auf (vorher 77.800,50 € netto); Erlös aus dem Beleg selbst.
    const proceeds = (confirmed.action.quellen || []).filter(source => source.kind !== 'liquiditaet').reduce((sum, source) => sum + source.netto, 0);
    assert(proceeds > 77800.50, `Beleg: Martins Erlös größer als vorher (${proceeds})`);
    assertClose(view.after.tagesgeld + view.after.geldmarkt, view.before.tagesgeld + view.before.geldmarkt + proceeds, 1, 'Beleg: Liquidität danach = heute + Erlös');
    // Gegenprobe: Ohne Beleg rechnet die Vorschau gleich (Petra bleibt stehen).
    const preview = reserves(year, null).view;
    assertClose(view.after.tagesgeld, preview.after.tagesgeld, 1, 'Beleg und Vorschau: gleiches Tagesgeld danach');
    // Der Modus kommt aus dem Beleg: Beleg steueroptimiert → Haushaltseintrag wie bisher, auch wenn heute „Martin trägt“ gilt.
    const { householdWithdrawal, ...decidedDefault } = confirmed;
    assertEqual(currentYearActionSource(year, decidedDefault).entries.length, 1, 'Beleg steueroptimiert: ein Haushaltseintrag wie bisher');
    // Umgekehrt: heute steueroptimiert, Beleg „Martin trägt“ → Petras Tagesgeld bleibt stehen.
    const base = await currentYear('grund', { [MARTIN]: 10000, [PETRA]: 110000 });
    const decided = reserves(base.year, confirmed);
    assert(!decided.prepared.find(row => row.profileId === PETRA).action.internalCashRebalance && decided.view.after.tagesgeld > 110000,
        `heute steueroptimiert, Beleg „Martin trägt“: Petras Tagesgeld bleibt (${decided.view.after.tagesgeld})`);
}

// Punkt 3 (Gemini TR2-1): „Tagesgeld auffüllen“ ohne offenen Planverkauf. Gegenrechnung aus dem Gutachten: Basis 4.000 €/Monat
// (Schwelle 24.000 €), Martin 10.000 € (Ziel 15.000 €, Geldmarkt 0 €), Petra 5.000 € (Ziel 15.000 €, Geldmarkt 40.000 €). Vorher 9.000 € für Petra.
{
    const people = [{ profileId: MARTIN, name: 'Martin', tagesgeld: 10000, geldmarkt: 0, target: 15000 },
        { profileId: PETRA, name: 'Petra', tagesgeld: 5000, geldmarkt: 40000, target: 15000, carrierHold: true }];
    assertEqual(projectCashRefill({ people, monthlyBase: 4000, cashMonths: 6, planOpen: false }), null, 'Martin trägt: keine Umschichtung für Petra');
    const free = projectCashRefill({ people: people.map(({ carrierHold, ...person }) => person), monthlyBase: 4000, cashMonths: 6, planOpen: false });
    assertClose(free.rows.find(row => row.profileId === PETRA).amount, 9000, 0.01, 'Vorgabemodus: Petra 9.000 € wie bisher');
    // Mit dem Musterhaushalt: Kennzeichen aus der Rechnung des laufenden Jahres bzw. aus dem Beleg.
    const { year, confirmed } = await currentYear('traegt', { [MARTIN]: 10000, [PETRA]: 0 });
    for (const [label, source] of [['ohne Beleg', null], ['mit Beleg', confirmed]]) {
        const rows = cashRefillPeople(year, () => JSON.parse(storage.getItem('rs_profiles_v1')), null, source);
        assertEqual(rows.find(row => row.profileId === PETRA)?.carrierHold, true, `${label}: Petra gekennzeichnet`);
        assert(!rows.find(row => row.profileId === MARTIN)?.carrierHold, `${label}: Martin ohne Kennzeichen`);
    }
}

// Punkt 4 (Fable P2-2): Der Hinweis steht sichtbar in „Was zu tun ist“; Wortlaut an einer Stelle.
{
    const { year, confirmed } = await currentYear('traegt', { [MARTIN]: 20000, [PETRA]: 0 });
    for (const source of [null, confirmed]) {
        const held = heldBelowCashTarget(cashRefillPeople(year, () => JSON.parse(storage.getItem('rs_profiles_v1')), null, source));
        assertEqual(held.map(person => person.name).join(), 'Petra', `Hinweis für Petra (${source ? 'mit' : 'ohne'} Beleg)`);
        const doc = new MockDocument();
        const notes = createHeldCashNotes(doc, held);
        assert(notes.length === 1 && notes[0].textContent === HELD_BELOW_TARGET_TEXT('Petra'), 'Hinweistext aus einer Stelle');
    }
    const above = await currentYear('traegt', { [MARTIN]: 10000, [PETRA]: 110000 });
    assertEqual(heldBelowCashTarget(cashRefillPeople(above.year, () => JSON.parse(storage.getItem('rs_profiles_v1')))).length, 0, 'Petra über ihrem Ziel: kein Hinweis');
    const base = await currentYear('grund', { [MARTIN]: 20000, [PETRA]: 0 });
    assertEqual(heldBelowCashTarget(cashRefillPeople(base.year, () => JSON.parse(storage.getItem('rs_profiles_v1')), null, base.confirmed)).length, 0, 'Vorgabemodus: kein Hinweis');
}
// P3 (Fable P3-6): Martins Umschichtung hängt an seinem Ziel, nicht am Haushaltsziel mit Petra. Martin 20.000 € (Ziel 14.400 €), Petra 0 €:
// vorher 0 €, weil das Haushaltstagesgeld unter dem Haushaltsziel lag.
{
    const { year } = await currentYear('traegt', { [MARTIN]: 20000, [PETRA]: 0 });
    const prepared = reserves(year, null).prepared;
    assert(prepared.find(row => row.profileId === MARTIN).action.internalCashRebalance?.amount > 0, 'Martin schichtet seinen Überschuss um');
    assert(!prepared.find(row => row.profileId === PETRA).action.internalCashRebalance, 'Petra bleibt ohne Auftrag');
}
P.resetPersistenceForTests(); setAppTestDate(null);
