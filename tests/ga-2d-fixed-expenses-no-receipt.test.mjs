// GA-2d (Gutachten GA2C-FABLE): Jahr ohne Beleg (N1), robustes „Ist + Inflation“ (N2), Altbeleg ohne feste Posten (N4).
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { readExpenseNeedsPlan, readCloseExpenseNeeds } from '../app/expenses/expenses-needs.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { annualNeedSuggestions } from '../app/shared/annual-needs-review.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { plannedExpenseImportChoices } from '../app/balance/balance-planned-posts.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const kv = { id: 'kv', bezeichnung: 'Krankenversicherung', betragMonat: 1000, ab: '2027-07', bis: '2027-12', anpassung: 'keine' };
/** Sophie im Planjahr 2027; ohne Beleg oder mit eigenem Beleg; geplante Posten und Monatsimporte nach Wunsch. */
function sophie({ date = '2027-08-10', items = null, receipt = null, floors = null } = {}) {
    setAppTestDate(date);
    const records = createMusterHaushaltRecords('2027-08-10', 'sophie');
    const receipts = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(receipts.entries)[0];
    const scope = entry.scope, id = scope.ids[0];
    if (receipt) { Object.assign(entry, receipt); records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts); } else delete records[ANNUAL_PLAN_RECORD_KEY];
    if (items) records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [scope.key]: { scope, items } } });
    if (floors) records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2027, years: { 2027: { months: Object.fromEntries(Object.entries(floors)
        .map(([month, floor]) => [month, { profiles: { [id]: { categories: { Wohnen: floor, Reisen: 8000 },
            categoryNeeds: { Wohnen: { floor, flex: 0 }, Reisen: { floor: 0, flex: 8000 } } } } }])) } } });
    return { records, storage: { getItem: key => records[key] ?? null }, scope };
}
const months = (from, to, value) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, index) => [from + index, value]));
const closeNeeds = (env, now = '2028-01-10') => readCloseExpenseNeeds({ scope: env.scope, members: [{ belongs: true }], now: new Date(`${now}T12:00:00Z`) }, 2027, 10500, env.storage);
const fromActual = needs => annualNeedSuggestions({ inflation: { rate: 2 } }, { needsReview: needs }, 'floorBedarf', 24480).fromActual;

try {
    // N1: Sophie ohne Beleg, vorläufiges Budget 2.800 €: Plan-Grundbedarf 25.600 €, Flex nach Regeln 8.000 €.
    {
        const env = sophie();
        const plan = readExpenseNeedsPlan({ year: 2027, scope: env.scope, storage: env.storage });
        const view = projectExpenses({ store: { years: {} }, year: 2027, people: [{ id: env.scope.ids[0], name: 'Sophie' }],
            budget: { monthly: 2800, status: 'provisional' }, needsPlan: plan, now: new Date('2027-08-10T12:00:00Z') });
        assertEqual(view.needs.plans.floor, 25600, 'N1: Plan-Grundbedarf ohne Beleg mit Ratenkredit');
        assertEqual(view.needs.plans.flex, 8000, 'N1: Flex nach Regeln ohne Beleg');
    }
    // N1 + N2: S4 im ersten Jahresabschluss ohne Beleg; Floor Januar–Juni 2.000 €, Juli–Dezember 3.000 €.
    const s4 = floors => fromActual(closeNeeds(sophie({ items: [kv], floors })));
    assertEqual(s4({ ...months(1, 6, 2000), ...months(7, 12, 3000) }), 25000, 'N1: erster Abschluss ohne Beleg, „Ist + Inflation“ ohne feste Ausgabe');
    assertEqual(s4(months(7, 12, 3000)), 25000, 'N2: Aufteilung nur Juli–Dezember, Abzug anteilig');
    assertEqual(s4(months(1, 6, 2000)), 25000, 'N2: Aufteilung nur Januar–Juni, nichts abzuziehen');
    assertEqual(s4(months(1, 12, 300)), 0, 'N2: Ist-Floor unter der festen Ausgabe, Vorschlag nie negativ');
    // N2: feste Ausgabe nach dem Beschluss angelegt (neuer Beleg ohne feste Posten) wird ebenfalls abgezogen.
    {
        const receipt = { committedAt: '2026-12-31T12:00:00.000Z' };
        const env = sophie({ items: [kv], floors: { ...months(1, 6, 2000), ...months(7, 12, 3000) } });
        const receipts = JSON.parse(createMusterHaushaltRecords('2027-08-10', 'sophie')[ANNUAL_PLAN_RECORD_KEY]);
        const entry = Object.values(receipts.entries)[0];
        Object.assign(entry, receipt); delete entry.adopted.plannedPosts; entry.adopted.monthlyBudget = 10000;
        env.records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts);
        assertEqual(fromActual(closeNeeds(env)), 25000, 'N2: nach dem Beschluss angelegte feste Ausgabe wird abgezogen');
        // N4: derselbe Beleg vor dem 11.11.2026 beschlossen: Altbeleg, feste Ausgabe im Import angeboten.
        entry.committedAt = '2026-10-01T12:00:00.000Z';
        env.records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts);
        const choices = plannedExpenseImportChoices({ storage: env.storage, scope: env.scope, year: 2027, month: 7, profileId: env.scope.ids[0], store: null });
        assertEqual(JSON.stringify(choices.map(item => item.id)), '["kv"]', 'N4: Altbeleg ohne feste Posten, später angelegte feste Ausgabe im Import angeboten');
        entry.committedAt = '2026-12-31T12:00:00.000Z';
        env.records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts);
        assertEqual(plannedExpenseImportChoices({ storage: env.storage, scope: env.scope, year: 2027, month: 7, profileId: env.scope.ids[0], store: null }).length, 0,
            'N4: Beleg nach der Änderung ohne feste Posten: feste Ausgabe nicht angeboten');
    }
} finally { setAppTestDate(null); }
