import { computeHouseholdNeedsStats, computeSpent, hasCategoryNeeds, hasExpenseImport } from '../balance/balance-expenses-metrics.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { readHouseholdPlan, memberPlanScope } from '../profile/household-plan.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { appNow } from '../shared/app-clock.js';

/** Nur Anzeige: Jahresbeleg vor aktuellem Plan; niemals ein fremdes Jahresbudget ableiten. */
/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Passender Jahresplan oder null ohne belastbare Jahresquelle.
 */
export function readExpenseNeedsPlan({ year, scope, storage = persistenceStorage }) {
    if (!scope) return null;
    const record = /** @type {import("../../typcheck/profile-ui.js").ReadAnnualPlan} */ (readAnnualPlanRecord)({ year, scope, storage });
    if (record?.status === 'invalid') return null;
    if (record) return record.adopted.snapshot?.plan ?? null;
    const current = readHouseholdPlan({ scope, storage }).entry;
    // Der aktuelle Plan ist kein historischer Beleg. Sein Jahr folgt dem letzten
    // Abschluss, ersatzweise dem aktuellen Kalenderjahr wie die Plananzeige.
    try {
        const registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null');
        const activeId = storage.getItem('rs_current_profile');
        const years = scope.ids.map(id => {
            const raw = id === activeId || !registry ? storage.getItem(CONFIG.STORAGE.LS_KEY) : registry.profiles?.[id]?.data?.[CONFIG.STORAGE.LS_KEY];
            const state = JSON.parse(raw || 'null');
            const period = state?.annualPeriodMetadata?.lastCommittedPeriod ?? state?.balanceStateLifecycle?.lastCommittedPeriod;
            return period ? Number(period.slice(-4)) + 1 : appNow().getFullYear();
        });
        return years.every(value => value === year) ? current?.values ?? null : null;
    } catch { return null; }
}

/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Bedarfsstatistik mit Planvergleich und unlesbaren Aufteilungen.
 */
export function projectExpenseNeeds({ yearData, profileIds, forecastMonths = null, floorPlan = null, annualBudget = null }) {
    const stats = computeHouseholdNeedsStats({ yearData, profileIds, forecastMonths });
    const invalidBreakdowns = Object.entries(yearData?.months || {}).flatMap(([month, data]) => Object.entries(data.profiles || {})
        .filter(([id, entry]) => profileIds.includes(id) && entry && Object.hasOwn(entry, 'categoryNeeds') && !hasCategoryNeeds(entry))
        .map(([profileId]) => ({ month: Number(month), profileId })));
    const floor = Number.isFinite(floorPlan) ? floorPlan : null;
    const flex = floor !== null && Number.isFinite(annualBudget) ? annualBudget - floor : null;
    const plans = { floor, flex, total: annualBudget };
    const compare = (actual, plan) => ({ actual, plan,
        difference: actual !== null && plan !== null ? actual - plan : null,
        percent: actual !== null && plan > 0 ? (actual - plan) / plan * 100 : null });
    return { ...stats, plans, invalidBreakdowns,
        comparisons: Object.fromEntries(['floor', 'flex', 'total'].map(key => [key, compare(stats.annualForecast[key], plans[key])])) };
}

/** Kategorien bleiben wie bisher einschließlich Geplanter Ausgaben. */
/**
 * @param yearData Monatsrecords des Anzeigejahrs.
 * @param profileIds Kennungen der ausgewählten Personen.
 * @returns Floor-/Flex-Summen je Kategorie mit unzugeordneten Beträgen.
 */
export function projectCategoryNeeds(yearData, profileIds) {
    const categories = new Map();
    for (const month of Object.values(yearData?.months || {})) {
        const entries = Object.entries(month.profiles || {}).filter(([id, entry]) => profileIds.includes(id) && hasExpenseImport(entry));
        const split = entries.length > 0 && entries.length === profileIds.length && entries.every(([, entry]) => hasCategoryNeeds(entry));
        for (const [, entry] of entries) {
            const direction = computeSpent(entry.categories).sum < 0 ? -1 : 1;
            for (const [name, amount] of Object.entries(entry.categories)) {
                const row = categories.get(name) || { floor: 0, flex: 0, unallocated: 0 };
                if (split) { row.floor += entry.categoryNeeds[name].floor * direction; row.flex += entry.categoryNeeds[name].flex * direction; }
                else row.unallocated += Number(amount) * direction;
                categories.set(name, row);
            }
        }
    }
    return categories;
}

/** Der Dialog liest dieselben Quellen wie Ausgaben, ohne das Übersichtsmodell zu ändern. */
/**
 * @param model Bereits gelesene Anzeigeprojektion.
 * @param year Kalenderjahr der Projektion.
 * @param monthlyBudget Passendes Monatsbudget in Euro.
 * @param storage Speicherzugang des vorhandenen Besitzers.
 * @returns Bedarfsvergleich des Abschlussjahrs oder null ohne lesbare Quellen.
 */
export function readCloseExpenseNeeds(model, year, monthlyBudget, storage = persistenceStorage) {
    if (!model.scope?.ids?.length) return null;
    const scope = memberPlanScope(model.scope.ids, storage, model.members?.some(person => person.belongs) ?? true);
    const plan = readExpenseNeedsPlan({ year, scope, storage });
    const loaded = loadExpensesStoreResult(storage);
    if (loaded.status === 'corrupt') return null;
    const now = model.now ?? appNow();
    const lastMonth = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth();
    return { ...projectExpenseNeeds({ yearData: loaded.store.years?.[year], profileIds: model.scope.ids,
        forecastMonths: Array.from({ length: lastMonth }, (_, index) => index + 1),
        floorPlan: plan?.floorBedarf, annualBudget: Number.isFinite(monthlyBudget) ? monthlyBudget * 12 : null }),
        wish: plan?.flexBedarf ?? null };
}

/**
 * @param actual Tatsächlicher Betrag in Euro.
 * @param plan Vergleichsbetrag des Plans in Euro.
 * @param money Formatter für Eurobeträge.
 * @param reference Bezeichnung der Vergleichsbasis.
 * @returns Formatierte Planabweichung oder Hinweis auf eine fehlende Vergleichsbasis.
 */
export function expenseDeviation(actual, plan, money, reference = 'Plan') {
    if (!Number.isFinite(actual) || !Number.isFinite(plan)) return 'Kein passender Plan verfügbar';
    const delta = actual - plan;
    if (delta === 0) return `genau im ${reference}`;
    const percent = plan > 0 ? ` · ${(Math.abs(delta) / plan * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : '';
    return `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}${percent} ${delta > 0 ? 'über' : 'unter'} ${reference}`;
}

/**
 * @param needs Bedarfsstatistik mit den zugehörigen Planwerten.
 * @returns Beschreibung der belegten Monate mit Bedarfssplit.
 */
export function expenseNeedsCoverage(needs) {
    return `Floor und Flex aus ${needs.monthsWithBreakdown} von ${needs.monthsWithBreakdown + needs.monthsWithoutBreakdown} Monaten mit Aufteilung.`;
}
