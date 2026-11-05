import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, musterVarianten } from '../app/demo/muster-haushalte.js';
import { musterLesson } from '../app/demo/muster-steckbrief.js';
import { generateExampleExpensesCsv, resolveExampleExpensesBasis, resolveExampleExpensesFloor } from '../app/demo/beispielausgaben.js';
import { parseCategoryCsv, EXPENSE_CSV_CATEGORY_NEEDS } from '../app/balance/balance-expenses-csv.js';
import { computeHouseholdNeedsStats, hasCategoryNeeds } from '../app/balance/balance-expenses-metrics.js';

const controller = { initialize() {}, state: { active: true, phase: 'active', testDate: null }, runtime: { canContinue: true } };
const checkEntry = entry => hasCategoryNeeds(entry)
    && Object.entries(entry.categories).every(([name, amount]) =>
        Math.round((entry.categoryNeeds[name].floor + entry.categoryNeeds[name].flex) * 100) === Math.round(amount * 100))
    && Object.values(entry.categoryNeeds).some(pair => pair.floor < 0 && pair.flex < 0);
for (const household of MUSTER_HAUSHALTE) for (const variant of musterVarianten(household.id)) {
    const records = createMusterHaushaltRecords('2026-10-23', household.id, variant.id);
    const storage = { getItem: key => records[key] ?? null };
    const ids = Object.keys(JSON.parse(records.rs_profiles_v1).profiles);
    const expenses = JSON.parse(records.balance_expenses_v1);
    assert(Object.values(expenses.years).every(year => Object.values(year.months)
        .every(month => Object.values(month.profiles).every(checkEntry))), 'FF-3: alle Muster und Varianten mit Aufteilung');
    const basis = resolveExampleExpensesBasis({ year: 2026, ids, storage });
    const floorMonthly = resolveExampleExpensesFloor({ ids, storage });
    const generated = { months: {} };
    for (let month = 1; month <= 12; month++) {
        generated.months[month] = { profiles: Object.fromEntries(ids.map(profileId => {
            const csv = generateExampleExpensesCsv({ controller, ids, profileId, year: 2026, month, basis, floorMonthly });
            const categories = parseCategoryCsv(csv);
            return [profileId, { categories, categoryNeeds: categories[EXPENSE_CSV_CATEGORY_NEEDS] }];
        })) };
    }
    assert(Object.values(generated.months).every(month => Object.values(month.profiles).every(checkEntry)),
        `FF-3: ${household.id}/${variant.id}: CSV mit gemischter Kategorie und centgleichen Summen`);
    if (household.id === 'max-erika' && variant.id === 'grund') {
        for (const yearData of [expenses.years[2026], generated]) {
            const stats = computeHouseholdNeedsStats({ yearData, profileIds: ids });
            const floorRatio = stats.avgMonthly.floor / 2500;
            assert(floorRatio >= 1.05 && floorRatio <= 1.08, 'FF-3: Grundfall Floor-Mittel 5–8 Prozent über Plan');
            assert(stats.avgMonthly.flex < basis - 2500, 'FF-3: Grundfall Flex-Mittel unter finanziertem Plan');
        }
    }
}
const exercise = musterLesson('max-erika').exercises.join(' ');
assert(['Floor über Plan erkennen', 'Floor und Flex', '02.01.2027', 'Ist 2026 + Inflation', 'Monatsbudget']
    .every(text => exercise.includes(text)), 'FF-3: Steckbrief führt vom Floor-Vergleich zum neuen Monatsbudget');
