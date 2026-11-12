// GA-2c (Gutachten GA2-FABLE): Floor/Flex-Vergleich mit festen Ausgaben im Plan-Grundbedarf, Monatsabschluss mit
// Jahresbudget aus dem Beleg, Altbelege behalten ihre Bedeutung (Import, Anzeige). Zahlen aus S4.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { readMonthCloseNeeds, monthlyNeedsTiles } from '../app/overview/overview-month-confirmation.js';
import { readExpenseNeedsPlan } from '../app/expenses/expenses-needs.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { annualNeedSuggestions } from '../app/shared/annual-needs-review.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { plannedExpenseImportChoices } from '../app/balance/balance-planned-posts.js';
import { createPlannedPostsView } from '../app/balance/balance-planned-posts-renderer.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const kv = month => ({ id: 'kv', month: `2027-${String(month).padStart(2, '0')}`, label: 'Krankenversicherung', amount: 1000, kind: 'expense', fixed: true, paid: false, paidAmount: 0 });
/** Sophie-Records mit Beleg 2027: Grundbedarf 24.000 €, Flex 96.000 €, Jahresbudget 126.000 €, KV 07–12/2027. */
function s4Records(date, { legacy = false } = {}) {
    setAppTestDate(date);
    const records = createMusterHaushaltRecords(date, 'sophie');
    const receipts = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(receipts.entries)[0];
    Object.assign(entry.adopted.snapshot.plan, { floorBedarf: 24000, flexBedarf: 96000 });
    entry.adopted.monthlyBudget = legacy ? 10000 : 10500;
    entry.adopted.plannedPosts = { year: 2027, reserve: legacy ? 6000 : 0, expenseTotal: legacy ? 6000 : 0, items: [7, 8, 9, 10, 11, 12].map(kv) };
    records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts);
    return { records, storage: { getItem: key => records[key] ?? null }, scope: entry.scope };
}
const same = (a, b, label) => assertEqual(JSON.stringify(a), JSON.stringify(b), label);

try {
    // Befund 1: Plan-Grundbedarf 30.000 €, Flex nach Regeln 96.000 €, Floor je Monat Januar 2.000 €, Juli 3.000 €.
    {
        const { storage, scope } = s4Records('2027-08-10');
        const plan = readExpenseNeedsPlan({ year: 2027, scope, storage });
        const view = projectExpenses({ store: { years: {} }, year: 2027, people: [{ id: scope.ids[0], name: 'Sophie' }],
            budget: { monthly: 10500, status: 'adopted' }, needsPlan: plan, now: new Date('2027-08-10T12:00:00Z') });
        assertEqual(view.needs.plans.floor, 30000, 'Ausgaben-Seite: Plan-Grundbedarf mit fester Ausgabe');
        assertEqual(view.needs.plans.flex, 96000, 'Ausgaben-Seite: Flex nach Regeln = Jahresbudget − Grundbedarf');
        assertEqual(view.needs.plans.floorMonths[0], 2000, 'Monatstabelle: Floor-Plan Januar');
        assertEqual(view.needs.plans.floorMonths[6], 3000, 'Monatstabelle: Floor-Plan Juli');
        const review = { ...view.needs, monthsWithBreakdown: 12, fixedInActual: 6000, annualForecast: { floor: 30000, flex: 96000, total: 126000 } };
        const suggestion = annualNeedSuggestions({ inflation: { rate: 2 } }, { needsReview: review }, 'floorBedarf', 24480);
        assertEqual(suggestion.fromActual, 25000, '„Ist + Inflation“ zieht die feste Ausgabe ab: (30.000 − 6.000) × 1,02, aufgerundet');
        assertEqual(suggestion.comparison, 'genau im Plan', 'Ist nach Plan liegt genau im Plan-Grundbedarf');
    }
    // Befund 2: Monatsabschluss nimmt das Jahresbudget aus dem Beleg; Flex-Kachel Januar und Juli je 8.000 €.
    for (const [date, month, floor] of [['2027-02-10', 1, '2.000,00 €'], ['2027-08-10', 7, '3.000,00 €']]) {
        const { records, storage } = s4Records(date);
        const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile,
            liveData: records, now: new Date(`${date}T12:00:00Z`) });
        const needs = readMonthCloseNeeds(model, 2027, storage);
        assertEqual(needs.plans.total, 126000, `Monatsabschluss ${month}: Jahresbudget aus dem Beleg`);
        const [floorTile, flexTile] = monthlyNeedsTiles(needs, { month, floor: 0, flex: 0 }, 2027);
        assert(flexTile.detail.replaceAll('\u00a0', ' ').includes('nach Regeln: 8.000,00 €'), `Monatsabschluss ${month}: Flex nach Regeln 8.000 € im Monat (${flexTile.detail})`);
        assert(floorTile.detail.replaceAll('\u00a0', ' ').includes(`Grundbedarf: ${floor}`), `Monatsabschluss ${month}: Grundbedarf ${floor} im Monat (${floorTile.detail})`);
    }
    // Befund 5: Im Jahr eines Altbelegs bietet der Import feste Ausgaben weiter an; Befund 1 bleibt dort ohne feste.
    {
        const items = [{ id: 'kv', bezeichnung: 'Krankenversicherung', betragMonat: 1000, ab: '2027-07', bis: '2027-12', anpassung: 'keine' }];
        for (const legacy of [true, false]) {
            const { records, storage, scope } = s4Records('2027-08-10', { legacy });
            records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [scope.key]: { scope, items } } });
            const choices = plannedExpenseImportChoices({ storage, scope, year: 2027, month: 7, profileId: scope.ids[0], store: null });
            same(choices.map(item => item.id), legacy ? ['kv'] : [], legacy ? 'Altbeleg: feste Ausgabe weiter zuordenbar' : 'Neuer Beleg: feste Ausgabe nicht angeboten');
            if (legacy) assertEqual(readExpenseNeedsPlan({ year: 2027, scope, storage }).floorBedarf, 24000, 'Altbeleg: Plan-Grundbedarf ohne feste Ausgabe');
        }
    }
    // Befund 4: Altbeleg zeigt Reserve und Zahlungsstand wie vorher, nicht „im Grundbedarf“.
    {
        const doc = { createElement: tag => ({ tag, dataset: {}, children: [], appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } }) };
        const text = node => [node.textContent || '', ...node.children.map(text)].join(' ');
        const legacy = text(createPlannedPostsView(doc, { year: 2027, reserve: 6000, expenseTotal: 6000, items: [7, 8].map(kv) }));
        assert(!legacy.includes('im Grundbedarf') && legacy.includes('reservieren'), 'Altbeleg: alter Text und Zahlungsstand');
        const current = text(createPlannedPostsView(doc, { year: 2027, reserve: 0, expenseTotal: 0, items: [7, 8].map(kv) }));
        assert(current.includes('im Grundbedarf und Monatsbudget'), 'Neuer Beleg: feste Posten im Grundbedarf');
    }
} finally { setAppTestDate(null); }
