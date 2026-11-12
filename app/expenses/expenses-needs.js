import { computeHouseholdNeedsStats, computeSpent, hasCategoryNeeds, hasExpenseImport } from '../balance/balance-expenses-metrics.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { readHouseholdPlan, memberPlanScope } from '../profile/household-plan.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { appNow } from '../shared/app-clock.js';
import { fixedExpensesInBudget, isLegacyReceipt, readBalancePlannedPosts } from '../balance/balance-planned-posts.js';

/** Nur Anzeige: Jahresbeleg vor aktuellem Plan; niemals ein fremdes Jahresbudget ableiten. */
/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Passender Jahresplan oder null ohne belastbare Jahresquelle.
 */
export function readExpenseNeedsPlan({ year, scope, storage = persistenceStorage }) {
    if (!scope) return null;
    const record = /** @type {import("../../typcheck/profile-ui.js").ReadAnnualPlan} */ (readAnnualPlanRecord)({ year, scope, storage });
    if (record?.status === 'invalid') return null;
    if (record) {
        const plan = record.adopted.snapshot?.plan ?? null, fixed = plan && fixedExpensesInBudget(record.adopted.plannedPosts, year);
        // FR-43: Der Plan-Grundbedarf im Vergleich enthält die festen Ausgaben des Belegs wie dessen Budget.
        return fixed ? { ...plan, floorBedarf: plan.floorBedarf + fixed.total, fixedExpenseTotal: fixed.total, fixedExpenseMonths: fixed.months } : plan;
    }
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
        if (!years.every(value => value === year) || !current?.values) return null;
        // FR-43 (N1): Ohne Beleg rechnet das vorläufige Budget mit den heutigen festen Posten; der Vergleich ebenso.
        const fixed = fixedExpensesInBudget(readPostsSafely({ storage, scope, year }), year);
        return fixed ? { ...current.values, floorBedarf: current.values.floorBedarf + fixed.total, fixedExpenseTotal: fixed.total, fixedExpenseMonths: fixed.months } : current.values;
    } catch { return null; }
}

/** Beschädigte geplante Ausgaben zeigen ihre Fehler an anderer Stelle; der Vergleich rechnet dann ohne feste Posten. */
const readPostsSafely = ({ storage, scope, year }) => { try { return readBalancePlannedPosts({ storage, scope, year, people: [] }); } catch { return null; } };

/** FR-43 (N2): Feste Ausgaben, die im Ist eines Jahres als normale Ausgaben liegen: heutige feste Posten plus solche nur
 * im Beleg. Null ohne feste Posten und im Jahr eines Altbelegs (dort liefen sie über die Zuordnung außerhalb).
 * @param {{year: number, scope: import('../../typcheck/datenvertraege.js').PlanScope|null, storage: import('../../typcheck/datenvertraege.js').RecordReader}} options
 * @returns {number[]|null} Zwölf Monatsbeträge. */
export function readActualFixedExpenseMonths({ year, scope, storage }) {
    if (!scope) return null;
    const record = /** @type {any} */ (readAnnualPlanRecord({ year, scope, storage }));
    if (record?.status === 'invalid' || isLegacyReceipt(record)) return null;
    const current = (readPostsSafely({ storage, scope, year })?.items || []).filter(item => item.kind === 'expense' && item.fixed);
    const ids = new Set(current.map(item => item.id));
    const receipt = record?.adopted?.plannedPosts?.year === year ? record.adopted.plannedPosts.items.filter(item => item.kind === 'expense' && item.fixed && !ids.has(item.id)) : [];
    const items = [...current, ...receipt];
    if (!items.length) return null;
    return Array.from({ length: 12 }, (_, index) => items.filter(item => item.month === `${year}-${String(index + 1).padStart(2, '0')}`)
        .reduce((sum, item) => sum + item.amount, 0));
}

/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Bedarfsstatistik mit Planvergleich und unlesbaren Aufteilungen.
 */
export function projectExpenseNeeds({ yearData, profileIds, forecastMonths = null, floorPlan = null, annualBudget = null, fixedMonths = null, actualFixedMonths = null }) {
    const stats = computeHouseholdNeedsStats({ yearData, profileIds, forecastMonths });
    const invalidBreakdowns = Object.entries(yearData?.months || {}).flatMap(([month, data]) => Object.entries(data.profiles || {})
        .filter(([id, entry]) => profileIds.includes(id) && entry && Object.hasOwn(entry, 'categoryNeeds') && !hasCategoryNeeds(entry))
        .map(([profileId]) => ({ month: Number(month), profileId })));
    const floor = Number.isFinite(floorPlan) ? floorPlan : null;
    const flex = floor !== null && Number.isFinite(annualBudget) ? annualBudget - floor : null;
    const plans = { floor, flex, total: annualBudget };
    // FR-43: Floor-Plan je Monat = (Grundbedarf ohne feste) / 12 + feste Ausgaben des Monats; Summe ist der Jahreswert.
    if (floor !== null && Array.isArray(fixedMonths)) {
        const fixedTotal = fixedMonths.reduce((sum, amount) => sum + amount, 0);
        Object.assign(plans, { fixedTotal, floorMonths: fixedMonths.map(amount => (floor - fixedTotal) / 12 + amount) });
    }
    const compare = (actual, plan) => ({ actual, plan,
        difference: actual !== null && plan !== null ? actual - plan : null,
        percent: actual !== null && plan > 0 ? (actual - plan) / plan * 100 : null });
    // FR-43 (N2): Feste Ausgaben im Ist-Floor, anteilig für dieselben Monate mit Aufteilung wie die Hochrechnung.
    const splitMonths = stats.months.filter(month => month.withBreakdown && month.total > 0 && (forecastMonths === null || forecastMonths.includes(month.month)));
    const fixedInActual = Array.isArray(actualFixedMonths) && splitMonths.length
        ? splitMonths.reduce((sum, month) => sum + actualFixedMonths[month.month - 1], 0) / splitMonths.length * 12 : null;
    return { ...stats, plans, invalidBreakdowns, ...(fixedInActual === null ? {} : { fixedInActual }),
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
        floorPlan: plan?.floorBedarf, annualBudget: Number.isFinite(monthlyBudget) ? monthlyBudget * 12 : null, fixedMonths: /** @type {{fixedExpenseMonths?: number[]}} */ (plan ?? {}).fixedExpenseMonths,
        actualFixedMonths: readActualFixedExpenseMonths({ year, scope, storage }) }),
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
