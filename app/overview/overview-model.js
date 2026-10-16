import { personDisplayAge } from '../profile/profile-person-data.js';
import { annualCloseArchiveReader, deriveAnnualCloseEvidence } from '../shared/annual-close-evidence.js';
import { readExpensesBudget } from '../expenses/expenses-model.js';
import { HOUSEHOLD_OWNED_BALANCE_STATE_KEYS } from '../profile/profile-storage.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { memberPlanScope, readHouseholdPlan } from '../profile/household-plan.js';
import { projectHouseholdPlanComparison } from '../profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../balance/balance-action-origin.js';
import { derivePlanningStart, resolvePlanningPeriodSource } from '../shared/planning-start.js';
import { appNow, getAppTestDate } from '../shared/app-clock.js';
import { PROBELAUF_PRICE_LABEL } from '../shared/probelauf-price-ui.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { deriveBalanceNextSteps } from '../balance/balance-next-steps.js';
import { sourceFingerprint, OVERVIEW_SIMULATION_KEY } from './overview-simulation-summary.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, requireHistoryRecord, assertHistoryStart, assertDailyPrices, localHistoryDate } from '../tranches/tranchen-history-store.js';
import { projectProfileWealthHistory } from '../profile/profile-wealth-history.js';
import { readCashPerson } from '../profile/profile-cash-update.js';
import { projectManagerProfiles } from '../tranches/tranchen-manager-profiles.js';
import { PROFILE_SCOPED_FIXED_KEYS, loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { CONFIG } from '../balance/balance-config.js';
import { overviewScope, readOverviewSummary, readOverviewSummaries, OVERVIEW_SUMMARY_KEY, OVERVIEW_MONTH_KEY, readMonthProvision } from './overview-storage.js';
import { summarizeBalanceAction } from '../balance/balance-action-summary.js';
import { preflightAnnualPeriod } from '../balance/balance-annual-period.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { computeSpent, computeYearStats } from '../balance/balance-expenses-metrics.js';
import { readWealthHistory } from '../../types/wealth-history-contract.js';
import { readReconciliationHistory, projectReconciliationCashStatuses } from '../tranches/tranche-reconciliation.js';

const stockTypes = ['aktien_alt', 'aktien_neu'];
/** Reine Anzeige: fehlende Segmente nur bei explizit eingeschränkter Typenliste als Null. */
export function overviewAllocationView(allocation, types = null) {
    const view = {};
    for (const type of types || Object.keys(allocation)) {
        if (!stockTypes.includes(type)) { view[type] = allocation[type]; continue; }
        if (Object.hasOwn(view, 'aktien')) continue;
        const values = stockTypes.map(key => Object.hasOwn(allocation, key) ? allocation[key] : types && !types.includes(key) ? 0 : null);
        view.aktien = values.every(Number.isFinite) ? values[0] + values[1] : null;
    }
    return view;
}

/** Ansichtskopie; Rohpunkte, Personenwerte und Kennzahlen behalten ihren Fachvertrag. */
export function overviewHistoryView(history) {
    const types = [...new Set(history.types.map(type => stockTypes.includes(type) ? 'aktien' : type))];
    const pointView = point => ({ ...point, allocation: overviewAllocationView(point.allocation, history.types) });
    const points = history.points.map(pointView);
    const endIndex = history.points.indexOf(history.end);
    const end = endIndex >= 0 ? points[endIndex] : history.end ? pointView(history.end) : history.end;
    return { ...history, types, points, end };
}

export function planningYear(metadata, now = appNow()) {
    const period = metadata?.pendingCommit?.periodId || metadata?.lastCommittedPeriod;
    const match = /^calendar-year:(\d{4})$/.exec(period || '');
    return match ? Math.max(now.getFullYear(), Number(match[1]) + 1) : now.getFullYear();
}

export function isPlanFixed(metadata, year) {
    return metadata?.schemaVersion === 1 && metadata.pendingCommit === null
        && metadata.lastCommittedPeriod === `calendar-year:${year - 1}`;
}

export function buildBalanceOverviewSummary({ modelResult, monthlyBudget, metadata, scope, now = appNow(), profileActions = null, sourceFingerprint: source = null, captureSources = false, activeId = null }) {
    if (captureSources) {
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        source = sourceFingerprint({ registry: loadProfileRegistry().value, activeId, liveData, scope, kind: 'balance' });
    }
    const year = planningYear(metadata, now);
    const ui = modelResult.ui || {};
    const action = summarizeBalanceAction(ui.action || {}, ui.action || {}, profileActions);
    return { year, scope, monthlyWithdrawal: ui.spending?.monatlicheEntnahme, monthlyBudget,
        action: { verb: action.verb, amount: action.amount, amountUnit: action.amountUnit, note: action.note },
        actionBasis: { material: ui.action && typeof ui.action === 'object' ? action.verb !== 'Nichts tun' : null, sourceFingerprint: source, fingerprintVersion: 1 },
        liquidityBefore: Number.isFinite(ui.liquiditaet?.deckungVorher) ? ui.liquiditaet.deckungVorher : null,
        liquidityAfter: Number.isFinite(ui.liquiditaet?.deckungNachher) ? ui.liquiditaet.deckungNachher : null,
        liquidityCoverage: Number.isFinite(ui.liquiditaet?.deckungNachher) ? ui.liquiditaet.deckungNachher : null,
        marketPhase: ui.market?.szenarioText || null,
        status: isPlanFixed(metadata, year) ? 'fest' : 'vorläufig', createdAt: now.toISOString() };
}

/** Reine Projektion. Aktives Profil aus Livebestand, übrige aus Registry; kein Flush. */
export function projectOverview({ registry, activeId, liveData = {}, now = appNow(), lastBackup = null, priceReport = null, recovery = false, balanceSingleFallback = false, historyPeriod = 'all', historyReport = null, snapshots = [], annualArchive = null }) {
    if (!registry?.profiles?.[activeId]) return { available: false, year: now.getFullYear(), lastBackup, now, priceReport,
        occasion: deriveOverviewOccasion({ now, dataAvailable: false, recovery }) };
    const projectedRegistry = structuredClone(registry);
    const active = projectedRegistry.profiles[activeId];
    // Fehlende Livekeys bedeuten beim aktiven Profil fehlende Daten, keine Registryfallbacks.
    for (const key of [...PROFILE_SCOPED_FIXED_KEYS, CONFIG.STORAGE.LS_KEY]) {
        delete active.data[key];
        if (Object.hasOwn(liveData, key)) active.data[key] = liveData[key];
    }
    const projection = projectManagerProfiles(projectedRegistry, activeId);
    // Ansichtsdatum nur auf Anzeigekopien anwenden; Planungswerte bleiben unverändert.
    projection.profiles = projection.profiles.map(person => {
        const today = personDisplayAge(projectedRegistry.profiles[person.id].data, now);
        return { ...person, personDates: { ...person.personDates, todayAge: today.age, todayAgeStatus: today.status } };
    });
    const members = projection.profiles.filter(p => p.belongs);
    if (balanceSingleFallback && !members.length) {
        const current = projection.profiles.find(person => person.id === activeId);
        if (current) members.push(current);
        projection.complete = Boolean(current?.valid);
    }
    const scope = overviewScope(members.length === 1 && members[0].id === activeId ? 'single' : 'household', members.map(p => p.id));
    const cashPeople = members.map(person => readCashPerson(person.id, person.name, projectedRegistry.profiles[person.id].data));
    const cashWarnings = projectCashFreshness(cashPeople, localHistoryDate(now));
    const states = members.map(p => loadStoredBalanceStateFromData(projectedRegistry.profiles[p.id].data));
    const metadata = states.map(state => state.value?.annualPeriodMetadata ?? null);
    const periodSource = resolvePlanningPeriodSource({ writerId: activeId, scope,
        records: Object.entries(projectedRegistry.profiles).map(([id, profile]) => ({ id,
            state: loadStoredBalanceStateFromData(profile.data),
            // Frühere Anzeigen einer inzwischen außenstehenden Person sind
            // keine aktuelle Haushaltsquelle. Den geöffneten Writer weiterhin
            // berücksichtigen, insbesondere während seines Pending-Commits.
            scopeMatches: Object.values(readOverviewSummaries(profile.data[OVERVIEW_SUMMARY_KEY])).some(item => scope
                && (id === activeId || item?.year === now.getFullYear())
                && readOverviewSummary(profile.data[OVERVIEW_SUMMARY_KEY], item?.year, scope)) })) });
    const annualEvidence = deriveAnnualCloseEvidence({ targetYear: now.getFullYear() - 1, scope, activeId, records: liveData, snapshots });
    const periodMetadata = periodSource.metadata.every(meta => meta == null) && annualEvidence.metadata
        ? [annualEvidence.metadata] : periodSource.metadata;
    const year = Math.max(now.getFullYear(), ...periodMetadata.map(meta => planningYear(meta, now)));
    const summaries = scope ? members.map(p => readOverviewSummary(projectedRegistry.profiles[p.id].data[OVERVIEW_SUMMARY_KEY], year, scope)) : [];
    // Genau ein gemeinsamer Stand, niemals Summe von Haushaltsergebnissen.
    const summary = projection.complete && summaries.length && summaries.every(item => item && JSON.stringify(item) === JSON.stringify(summaries[0]))
        ? { ...summaries[0], status: periodSource.available && periodMetadata.length > 0 && periodMetadata.every(meta => isPlanFixed(meta, year)) ? 'fest' : 'vorläufig' } : null;
    const priceTranches = members.flatMap(p => { try { const raw = JSON.parse(projectedRegistry.profiles[p.id].data.depot_tranchen || '[]'); return (Array.isArray(raw) ? raw : raw.tranches || []).map(t => ({ ...t, profileId: p.id })); } catch { return []; } });
    const tranches = priceTranches;
    const dates = tranches.map(t => Number.isInteger(t.asOf) && t.asOf > 0 ? new Date(t.asOf * 1000).getTime() : NaN);
    const quoteDate = tranches.length && dates.every(Number.isFinite) ? new Date(Math.min(...dates)).toISOString() : null;
    const provisions = members.map(p => projectedRegistry.profiles[p.id].data[OVERVIEW_MONTH_KEY]);
    const expenseResult = loadExpensesStoreResult({ getItem: key => liveData[key] ?? null });
    const memberIds = members.map(person => person.id);
    const planning = deriveOverviewPlanningStart({ now, scope, memberIds, metadata, states: states.map(state => state.value),
        summarySources: members.map(person => projectedRegistry.profiles[person.id].data[OVERVIEW_SUMMARY_KEY]),
        store: expenseResult.store, sourceErrors: [
            ...states.flatMap((state, index) => state.status === 'corrupt' ? [{ id: memberIds[index], source: 'balance' }] : []),
            ...(expenseResult.status === 'corrupt' ? [{ source: 'expenses' }] : [])
        ] });
    let occasion = deriveOverviewOccasion({ now, scope, memberIds, metadata, provisions, planning,
        annualEvidence, periodMetadata, periodSourceReason: periodSource.reason, dataAvailable: projection.complete && periodSource.available && states.every(state => state.status !== 'corrupt'), recovery });
    if (annualArchive && annualArchive.status !== 'loaded'
        && loadStoredBalanceStateFromData(liveData).value?.annualPeriodMetadata == null && occasion.annualState === 'open') {
        occasion = { ...occasion, annualState: 'unclear', annualReason: 'archive_' + annualArchive.status };
    }
    if (summary && occasion.annualState !== 'done') summary.status = 'vorläufig';
    const expenseYear = occasion.kind === 'annual' ? occasion.closingYear : occasion.previousYear;
    const expenseMonth = occasion.kind === 'annual' ? 12 : occasion.previousMonth;
    const beforePlanning = expenseYear < planning.firstPlanningYear;
    const expenses = beforePlanning ? { year: expenseYear, month: expenseMonth, rows: [], missingMonths: [],
        complete: false, spent: null, beforePlanning: true } : projectFocusExpenses(expenseResult.store, scope, expenseYear, expenseMonth);
    const comparisonStorage = { getItem: key => liveData[key] ?? null };
    const planArea = memberPlanScope(memberIds, comparisonStorage, members.some(person => person.belongs));
    const budgetContext = { registry: projectedRegistry, activeId, liveData: { ...liveData }, scope, receiptScope: planArea };
    const expenseBudgetSource = overviewExpenseBudget(budgetContext, expenseYear, beforePlanning);
    const expenseBudgetSources = { [expenseYear]: expenseBudgetSource,
        [occasion.previousYear]: overviewExpenseBudget(budgetContext, occasion.previousYear, occasion.previousYear < planning.firstPlanningYear) };
    const expenseBudget = expenseBudgetSource.monthly;
    if (occasion.kind === 'annual') {
        expenses.missingMonths = Array.from({ length: 12 }, (_, index) => projectFocusExpenses(expenseResult.store, scope, expenseYear, index + 1))
            .flatMap(month => month.rows.filter(row => !row.present).map(row => ({ id: row.id, month: month.month })));
        expenses.complete = Boolean(scope) && expenses.missingMonths.length === 0;
    }
    const firstStart = !recovery && !metadata.some(meta => meta?.pendingCommit) && projection.profiles.every(person => person.valid)
        && !projection.profiles.some(person => person.count > 0 || person.assets > 0 || person.values.renteMonatlich > 0 || person.values.sonstigeEinkuenfte > 0)
        && !Object.values(projectedRegistry.profiles).some(profile => hasOverviewRecords(profile.data))
        && !projectedRegistry.trancheReconciliation
        && !Object.values(expenseResult.store?.years || {}).some(value => Object.values(value?.months || {}).some(month =>
            Object.values(month?.profiles || {}).some(entry => entry?.categories && typeof entry.categories === 'object')))
        && expenseResult.status !== 'corrupt';
    const retrospective = now.getMonth() === 0 && occasion.kind === 'annual';
    const bandYear = retrospective ? now.getFullYear() - 1 : now.getFullYear();
    const bandSummaries = scope ? members.map(person => readOverviewSummary(projectedRegistry.profiles[person.id].data[OVERVIEW_SUMMARY_KEY], bandYear, scope)) : [];
    const bandSummary = projection.complete && bandSummaries.length && bandSummaries.every(item => item && JSON.stringify(item) === JSON.stringify(bandSummaries[0])) ? bandSummaries[0] : null;
    const comparison = projectOverviewWealth({ states: states.map(state => state.value), members, scope,
        comparisonScope: bandSummary?.scope, year: bandYear, retrospective, currentAssets: projection.household?.assets });
    const history = projectOverviewHistory({ registry: projectedRegistry, profiles: projection.profiles, liveData, today: localHistoryDate(now), period: historyPeriod });
    const fingerprintContext = { registry: projectedRegistry, activeId, liveData, scope };
    const source = sourceFingerprint({ ...fingerprintContext, kind: 'balance' });
    const planEntry = readHouseholdPlan({ scope: planArea, storage: comparisonStorage }).entry;
    const planComparison = projectHouseholdPlanComparison({ year, scope: planArea, storage: comparisonStorage,
        preview: summary, sourceFingerprint: source, planUpdatedAt: planEntry?.updatedAt, now });
    // Karte und Budgetlinie zeigen dieselbe Quelle: Jahresbeleg vor Vorschau.
    // Für den Januar-Rückblick bleibt das Budget an das Vorjahr gebunden.
    const bandReceipt = readAnnualPlanRecord({ year: bandYear, scope: planArea, storage: comparisonStorage });
    const bandComparison = bandYear === year ? planComparison : projectHouseholdPlanComparison({ year: bandYear,
        scope: planArea, storage: comparisonStorage, preview: bandSummary, sourceFingerprint: source, planUpdatedAt: planEntry?.updatedAt, now });
    const fixedBand = bandReceipt && bandReceipt.status !== 'invalid';
    const bandBudgetSummary = fixedBand ? { year: bandYear, scope, monthlyBudget: bandReceipt.adopted.monthlyBudget,
        createdAt: bandReceipt.committedAt } : bandReceipt?.status === 'invalid' ? null : bandSummary;
    const annual = projectOverviewYear({ store: expenseResult.store, scope, now, retrospective, budgetSummary: bandBudgetSummary,
        budgetStatus: fixedBand ? 'adopted' : 'provisional', budgetPreviewStatus: bandComparison.previewStatus });
    annual.comparison = comparison;
    annual.sales = projectOverviewSales(projectedRegistry, scope, bandYear, now);
    const actionOrigin = projectBalanceActionOrigin({ comparison: planComparison, year: now.getFullYear(), scope, occasion });
    let cashStatus;
    try {
        const statuses = scope?.ids.flatMap(id => projectReconciliationCashStatuses(projectedRegistry, id));
        cashStatus = statuses ? { state: 'valid', pendingCount: statuses.filter(item => item.isPending).length } : { state: 'not_loaded' };
    } catch { cashStatus = { state: 'error' }; }
    const receipt = readAnnualPlanRecord({ year, scope: planArea, storage: comparisonStorage });
    const adopted = receipt?.status !== 'invalid' && occasion.annualState === 'done' ? receipt?.adopted : null;
    const adoptedAction = adopted ? summarizeBalanceAction(adopted.action, adopted.action) : null;
    const confirmedSummary = adopted ? { ...summary, ...adopted, year, scope, status: 'fest',
        action: adoptedAction, createdAt: receipt.committedAt } : summary;
    const nextSteps = deriveBalanceNextSteps({ occasion, actionBasis: adopted ? { material: adoptedAction.verb !== 'Nichts tun' } : summary?.actionBasis,
        basisCurrent: Boolean(adopted || source && summary?.actionBasis?.fingerprintVersion === 1 && summary.actionBasis.sourceFingerprint === source), cashStatus, recovery, expenses, monthlyWithdrawal: confirmedSummary?.monthlyWithdrawal });
    // Heutige Rechnung separat anbieten; die feste Startseitenanzeige bleibt beim Beleg.
    return { available: true, planComparison, actionOrigin, previewSummary: summary, activeId, recovery, cashPeople, cashWarnings, nextSteps, cashStatus, history, historyReport, historyPeriod, ...projection, members, scope, metadata, periodSource, annualEvidence, annualArchive, year, summary: confirmedSummary, now, lastBackup, priceReport, quoteDate, priceTranches, expenseBudgetSources, expenseBudgetSource,
        firstPlanningYear: planning.firstPlanningYear, planning, occasion, expenses, expenseBudget, firstStart, annual, comparison };
}

/** Lokale Kalendertage: DST und Uhrzeit ändern die 35-Tage-Grenze nicht. */
export function projectCashFreshness(people, today) {
    const day = date => Date.UTC(...date.split('-').map((part, index) => Number(part) - (index === 1 ? 1 : 0))) / 86400000;
    const latest = person => [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
    return people.filter(person => !person.error && person.value !== null && latest(person)
        && day(today) - day(latest(person)) > 35).map(person => ({ id: person.id, name: person.name, date: person.lastDate,
            ...(person.confirmedDate ? { confirmedDate: person.confirmedDate } : {}) }));
}

/** Jahresdialog: tatsächlicher Vormonat und getrennte Auswertung des Abschlussjahres. */
export function projectAnnualClosePreparation(model, { store, annualBudgetSummary } = {}) {
    // Die anschließende Monatsphase braucht denselben Jahresrückblick im Beleg.
    if (!model.scope || !(model.occasion?.kind === 'annual' || model.occasion?.annualState === 'done')) return model;
    const { previousYear, previousMonth, closingYear } = model.occasion;
    const expenses = previousYear < model.planning?.firstPlanningYear
        ? { year: previousYear, month: previousMonth, rows: [], complete: false, spent: null, beforePlanning: true }
        : projectFocusExpenses(store, model.scope, previousYear, previousMonth);
    return { ...model, expenses,
        expenseBudget: model.expenseBudgetSources?.[previousYear] ? model.expenseBudgetSources[previousYear].monthly
            : previousYear === closingYear ? model.expenseBudget : model.summary?.year === previousYear ? model.summary.monthlyBudget : null,
        expenseBudgetSource: model.expenseBudgetSources?.[previousYear] || model.expenseBudgetSource,
        annual: projectOverviewYear({ store, scope: model.scope, now: model.now, retrospective: true, budgetSummary: annualBudgetSummary }) };
}

/** Kompatibler Adapter auf die gemeinsame P6c-Regel. */
export function deriveOverviewPlanningStart(options) {
    return derivePlanningStart({ ...options, readSummary: readOverviewSummary,
        readSummaries: readOverviewSummaries, projectExpenses: projectFocusExpenses });
}
const periodYear = period => /^calendar-year:[1-9]\d{3}$/.test(period || '') ? Number(period.slice(14)) : null;

function hasOverviewRecords(data) {
    try {
        const state = loadStoredBalanceStateFromData(data);
        if (state.status === 'corrupt' || readWealthHistory(state.value).entries.length) return true;
        if (state.value?.annualPeriodMetadata?.lastCommittedPeriod || state.value?.annualPeriodMetadata?.pendingCommit
            || ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'goldWert', 'renteMonatlich', 'sonstigeEinkuenfte'].some(key => state.value?.inputs?.[key] > 0)) return true;
        return [OVERVIEW_SUMMARY_KEY, OVERVIEW_SIMULATION_KEY].some(key => Object.keys(JSON.parse(data[key] || '{}').entries || {}).length > 0);
    } catch { return true; }
}

/** Zwölf Kalendermonate; nur abgeschlossene Monate gehören in die Kennzahlen. */
export function projectOverviewYear({ store, scope, now, retrospective = false, budgetSummary = null,
    budgetStatus = 'provisional', budgetPreviewStatus = 'stale' }) {
    const year = now.getFullYear() - (retrospective ? 1 : 0);
    const lastMonth = retrospective ? 12 : now.getMonth();
    const budget = budgetSummary?.year === year && budgetSummary.scope?.key === scope?.key
        && Number.isFinite(budgetSummary.monthlyBudget) && budgetSummary.monthlyBudget >= 0 ? budgetSummary.monthlyBudget : null;
    const months = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1, source = projectFocusExpenses(store, scope, year, month);
        const presentRows = source.rows.filter(row => row.present);
        const spent = presentRows.length ? presentRows.reduce((sum, row) => sum + row.spent, 0) : null;
        const closed = month <= lastMonth;
        return { month, spent: closed ? spent : null, complete: source.complete && closed,
            missingPersonIds: closed ? source.rows.filter(row => !row.present).map(row => row.id) : [],
            state: !closed ? 'open' : source.complete ? 'complete' : presentRows.length ? 'partial' : 'missing',
            overBudget: closed && spent !== null && budget !== null ? spent > budget : null };
    });
    const recorded = months.filter(month => month.spent !== null);
    const complete = lastMonth > 0 && months.slice(0, lastMonth).every(month => month.complete);
    // Bestehende Median-/Durchschnittsregel auf vollständigen, gefilterten Monaten.
    const yearData = { months: Object.fromEntries(months.filter(month => month.complete).map(month =>
        [month.month, { profiles: { selected: { categories: { total: month.spent } } } }])) };
    const stats = computeYearStats({ yearData });
    const reliable = months.some(month => month.complete);
    const total = recorded.length ? recorded.reduce((sum, month) => sum + month.spent, 0) : null;
    return { year, retrospective, lastMonth, months, complete, total, budget, budgetCreatedAt: budget === null ? null : budgetSummary.createdAt,
        budgetStatus: budget === null ? 'missing' : budgetStatus, budgetPreviewStatus,
        forecast: reliable && (stats.annualForecast > 0 || complete) ? stats.annualForecast : null, forecastIncomplete: !complete,
        highest: recorded.reduce((best, month) => !best || month.spent > best.spent ? month : best, null),
        overBudgetCount: budget === null || !recorded.length ? null : recorded.filter(month => month.overBudget).length,
        budgetPercent: budget > 0 && total !== null ? total / (budget * (retrospective ? 12 : lastMonth)) * 100 : null,
        weeksToJanuary: Math.ceil((new Date(now.getFullYear() + 1, 0, 1) - now) / (7 * 86400000)) };
}

/** Kein neuer Verlauf: ohne belegten Umfang oder volle Vergleichsbasis keine Gesamtänderung. */
export function projectOverviewWealth({ states, members, scope, comparisonScope, year, retrospective, currentAssets }) {
    const missing = reason => ({ delta: null, percent: null, reason });
    if (!scope || scope.key !== comparisonScope?.key || states.length !== scope.ids.length
        || members.length !== scope.ids.length || members.some(person => !scope.ids.includes(person.id) || !person.valid)) return missing('Kein belegter Vergleichsumfang');
    if (members.some(person => person.allocation?.gold > 0 || person.allocation?.anleihe > 0)) return missing('Gold oder Anleihen fehlen im gespeicherten Verlauf');
    try {
        const histories = states.map(readWealthHistory);
        const starts = histories.map(history => history.entries.find(entry => entry.id === `annual:${year - 1}`)
            || history.entries.find(entry => entry.asOf === `${year}-01-01`));
        const ends = retrospective ? histories.map(history => history.entries.find(entry => entry.id === `annual:${year}`)) : [];
        if (starts.some(entry => !entry) || (retrospective && ends.some(entry => !entry))) return missing('Kein vollständiger Stand an den Jahresgrenzen');
        if (!retrospective && !Number.isFinite(currentAssets)) return missing('Aktueller Bestand unvollständig');
        // Schema 1 belegt weder den damaligen Umfang noch die Mitgliedschaft.
        // Profilgebundene Einträge können Haushaltssummen enthalten; auch eine
        // passende heutige Plan-Summary beweist keinen historischen Einzelstand.
        return missing('Kein eindeutiger Vergleichsstand für diesen Profil-/Haushaltsumfang');
    } catch { return missing('Gespeicherter Vermögensverlauf ungültig'); }
}

/** Bestätigungen und Korrekturen sind Nachweise desselben Verkaufs, keine Erlöse. */
export function projectOverviewSales(registry, scope, year, now) {
    if (!scope) return { count: null, net: null, unconfirmed: null };
    try {
        const actions = readReconciliationHistory(registry);
        const statuses = new Map(projectReconciliationCashStatuses(registry).map(status => [status.targetActionId, status]));
        const ids = new Set();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const sales = actions.filter(action => {
            // executedAt ist ein validierter Kalendertag, kein UTC-Zeitpunkt.
            if (action.eventType !== 'sale_reconciled' || !scope.ids.includes(action.profileId) || Number(action.executedAt.slice(0, 4)) !== year
                || action.executedAt > today || ids.has(action.actionId)) return false;
            ids.add(action.actionId); return true;
        });
        const confirmed = sales.filter(sale => statuses.get(sale.actionId)?.isConfirmed);
        return { count: sales.length, net: confirmed.reduce((sum, sale) => sum + statuses.get(sale.actionId).confirmedNetProceedsEur, 0),
            unconfirmed: sales.length - confirmed.length };
    } catch { return { count: null, net: null, unconfirmed: null }; }
}

/** Lokale Kalendertage, ohne Annahmen über Börsenfeiertage. */
export function overviewPricesDone(model) {
    const now = model.now, report = model.priceReport;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || model.complete === false) return false;
    if (report && report.status !== 'complete') return false;
    const tranches = model.priceTranches || [];
    const identity = t => JSON.stringify([t.profileId, String(t.trancheId || t.id || '')]);
    if (!tranches.length || tranches.some(t => !t.profileId || !(t.trancheId || t.id))
        || new Set(tranches.map(identity)).size !== tranches.length) return false;
    const times = tranches.map(t => Number.isInteger(t.asOf) && t.asOf > 0 ? t.asOf * 1000 : NaN);
    const quote = new Date(model.quoteDate || NaN);
    if (!Number.isFinite(quote.getTime()) || quote > now || times.some(t => !Number.isFinite(t) || t > now.getTime())) return false;
    const oldest = new Date(Math.min(quote.getTime(), ...times));
    let relevant = [];
    if (report) {
        if (!Array.isArray(report.results)) return false;
        const ids = new Set(tranches.map(t => t.profileId));
        relevant = (report.results || []).filter(r => ids.has(r.profileId));
        if (relevant.length !== tranches.length || relevant.some(r => r.status !== 'updated')
            || new Set(relevant.map(identity)).size !== relevant.length
            || tranches.some(t => !relevant.some(r => identity(r) === identity(t)))
            || !Number.isInteger(report.updated) || report.updated < relevant.length
            || report.updated !== report.results.filter(r => r.status === 'updated').length) return false;
        if (relevant.some(r => {
            const asOf = r.quote?.asOf ?? r.asOf;
            return asOf !== undefined && (!Number.isInteger(asOf) || asOf <= 0 || asOf * 1000 > now.getTime()
                || asOf !== tranches.find(t => identity(t) === identity(r)).asOf);
        })) return false;
        const retrieved = new Date(report.retrievedAt ?? NaN);
        if (Number.isFinite(retrieved.getTime()) && retrieved > now) return false;
        if (Number.isFinite(retrieved.getTime()) && retrieved <= now && retrieved.toDateString() === now.toDateString()) return true;
    }
    const day = date => localHistoryDate(date);
    const previousWeekday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    while ([0, 6].includes(previousWeekday.getDay())) previousWeekday.setDate(previousWeekday.getDate() - 1);
    if (day(oldest) >= day(previousWeekday)) return true;
    const occasion = model.occasion || {};
    const year = occasion.kind === 'annual' ? occasion.closingYear : occasion.previousYear;
    const month = occasion.kind === 'annual' ? 12 : occasion.previousMonth;
    const end = new Date(year, month, 0);
    return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
        && day(end) < day(now) && day(oldest) >= day(end);
}

/** Budgetvertrag der Ausgabenseite; beschädigte/abweichende Summaryquellen bleiben erkennbar. */
function overviewExpenseBudget(context, year, beforePlanning = false) {
    if (beforePlanning) return { monthly: null, status: 'missing' };
    const storage = { getItem: key => context.liveData?.[key] ?? null };
    let budget;
    try { budget = readExpensesBudget({ ...context, storage, year }); }
    catch { return { monthly: null, status: 'invalid' }; }
    if (budget.status !== 'missing') return budget;
    const rawSources = (context.scope?.ids || []).map(id => id === context.activeId
        ? storage.getItem(OVERVIEW_SUMMARY_KEY) : context.registry?.profiles?.[id]?.data?.[OVERVIEW_SUMMARY_KEY]);
    try {
        if (rawSources.some(raw => {
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            return parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)
                || Object.values(parsed.entries).some(item => item?.year === year && item?.scope?.key === context.scope?.key);
        }))
            return { monthly: null, status: 'invalid' };
    } catch { return { monthly: null, status: 'invalid' }; }
    return budget;
}

/** Marktzeit stammt ausschließlich aus dem ältesten belegten Kursdatum. */
export function overviewQuoteLabel(model) {
    if (getAppTestDate() !== null) return PROBELAUF_PRICE_LABEL;
    const date = new Date(model.quoteDate);
    if (!model.quoteDate || !Number.isFinite(date.getTime())) return 'Kurszeit unbekannt';
    return date.toDateString() === model.now.toDateString() ? 'Kurse von heute'
        : `Kurse vom ${date.toLocaleDateString('de-DE')}`;
}

export function overviewPriceLabel(model) {
    if (getAppTestDate() !== null) return PROBELAUF_PRICE_LABEL;
    const report = model.priceReport;
    const results = report?.results?.filter(result => !model.scope?.ids || !result.profileId || model.scope.ids.includes(result.profileId));
    if (['waiting', 'started', 'loading', 'running'].includes(report?.status)) return 'Kurse werden aktualisiert …';
    if (['recovery', 'unavailable'].includes(report?.status)) return 'Kurse nicht verfügbar';
    if (report?.status === 'storage-failed') return 'Kursspeicherung nicht bestätigt';
    const stand = overviewQuoteLabel(model);
    const retry = stand === 'Kurse von heute' ? 'erneuter Abruf' : 'Abruf';
    if (['offline', 'timeout'].includes(report?.status) && !report.updated) return `${stand} · ${retry} fehlgeschlagen`;
    if (['changed', 'cancelled'].includes(report?.status) && !report.updated) return `${stand} · Abruf unvollständig`;
    if (results?.some(result => result.status !== 'updated')) return `${stand} · ${report.updated > 0 ? 'teilweise aktualisiert' : retry + ' fehlgeschlagen'}`;
    const retrieved = report?.retrievedAt === null || report?.retrievedAt === undefined ? null : new Date(report.retrievedAt);
    if (report?.status === 'complete' && report.updated > 0
        && retrieved && Number.isFinite(retrieved.getTime())) {
        const day = retrieved.toDateString() === model.now.toDateString() ? 'heute' : retrieved.toLocaleDateString('de-DE');
        return `Kurse aktualisiert · ${day} ${retrieved.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return model.quoteDate ? `Gespeicherte Kurse · ${overviewQuoteLabel(model)}` : 'Kurszeit unbekannt';
}

export function previousOverviewMonth(now) {
    const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { previousYear: date.getFullYear(), previousMonth: date.getMonth() + 1,
        month: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') };
}

/** Ausschließlich Argumente, lokale Kalendergrenzen und bestehender Periodenvertrag. */
export function deriveOverviewOccasion({ now, scope = null, memberIds = scope?.ids || [], metadata = [], provisions = [], dataAvailable = true, recovery = false,
    planning = deriveOverviewPlanningStart({ now, scope, memberIds, metadata }), periodMetadata = metadata, periodSourceReason = null, annualEvidence = null }) {
    const previous = previousOverviewMonth(now);
    const closingYear = now.getFullYear() - 1;
    const monthCompleted = Boolean(scope) && provisions.length === scope.ids.length
        && provisions.every(raw => readMonthProvision(raw, previous.month, scope));
    const monthApplicable = previous.previousYear >= planning.firstPlanningYear;
    const context = { ...previous, monthCompleted, monthApplicable, closingYear, planningYear: now.getFullYear(), firstPlanningYear: planning.firstPlanningYear };
    const monthOccasion = annualState => {
        if (!monthApplicable) return { ...context, kind: 'start', annualState };
        const completed = Boolean(scope) && provisions.length === scope.ids.length
            && provisions.every(raw => readMonthProvision(raw, previous.month, scope));
        return { ...context, kind: completed ? 'play' : 'monthly', annualState };
    };
    if (recovery || periodMetadata.some(meta => meta?.pendingCommit)) return { ...context, kind: 'annual', annualState: 'recovery' };
    if (periodSourceReason === 'contradictory') return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'contradictory_metadata' };
    if (!dataAvailable || !scope || periodMetadata.length === 0) return { ...context, kind: 'annual', annualState: 'unavailable' };
    const statuses = periodMetadata.map(meta => preflightAnnualPeriod({ targetYear: closingYear, currentAge: 0, metadata: meta }).status);
    if (statuses.includes('invalid')) return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'contradictory_metadata' };
    if (annualEvidence?.status === 'legacy_confirmation_required') return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'ambiguous_evidence' };
    const unmarkedClose = !annualEvidence && planning.evidence.some(entry => entry.kind === 'annual' && entry.year <= closingYear
        && (periodYear(metadata[memberIds.indexOf(entry.id)]?.lastCommittedPeriod) ?? -Infinity) < entry.year);
    if (unmarkedClose) return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'missing_commit' };
    if (statuses.every(status => status === 'already_committed')) return monthOccasion('done');
    if (planning.errors.length && planning.firstPlanningYear > closingYear) return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'invalid_evidence' };
    if (planning.firstPlanningYear > closingYear) return monthOccasion('not_applicable');
    if ((statuses.includes('legacy_confirmation_required') || metadata.some(meta => meta == null)) && planning.errors.length) {
        return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'invalid_evidence' };
    }
    const olderClose = planning.evidence.some(entry => ['annual', 'committed'].includes(entry.kind) && entry.year < closingYear);
    if (!annualEvidence && (unmarkedClose || (statuses.includes('legacy_confirmation_required')
        && (planning.firstPlanningYear !== closingYear || olderClose)))) {
        return { ...context, kind: 'annual', annualState: 'unclear', annualReason: 'missing_commit' };
    }
    return { ...context, kind: 'annual', annualState: 'open' };
}

export function overviewBackupAge(now, lastBackup) {
    const parsed = Date.parse(lastBackup);
    const days = Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / 86400000) : null;
    return { days, warning: days === null || days >= 30, recommended: days === null || days > 7 };
}

export function projectFocusExpenses(store, scope, year, month) {
    const entries = store?.years?.[year]?.months?.[month]?.profiles;
    const rows = (scope?.ids || []).map(id => {
        const categories = entries?.[id]?.categories;
        const present = categories && typeof categories === 'object' && !Array.isArray(categories)
            && Object.values(categories).every(value => typeof value === 'number' && Number.isFinite(value));
        return { id, present: Boolean(present), categories: present ? { ...categories } : null, spent: present ? computeSpent(categories).spent : null };
    });
    return { year, month, rows, complete: rows.length > 0 && rows.every(row => row.present),
        partialSpent: rows.some(row => row.present) ? rows.filter(row => row.present).reduce((sum, row) => sum + row.spent, 0) : null,
        spent: rows.length && rows.every(row => row.present) ? rows.reduce((sum, row) => sum + row.spent, 0) : null };
}

/** Kleine feste Liste lesender Ziele. Ungültige oder doppelte Parameter sind kein Auftrag. */
export function parseOverviewTarget(page, location) {
    const allowed = { balance: ['abschluss', 'jahresabschluss', 'ausgaben', 'ausgaben-import', 'handlungsanweisung'],
        simulator: ['backtest', 'monte-carlo', 'annahmen', 'werkstatt'], manager: ['personen', 'profileTagesgeld', 'haushalt-plan'] };
    const target = (location?.hash || '').slice(1);
    if (!allowed[page]?.includes(target)) return null;
    const params = new URLSearchParams(location?.search || '');
    if (page === 'manager' && ['profileTagesgeld', 'haushalt-plan'].includes(target)) {
        if ([...params.keys()].some(key => key !== 'person') || params.getAll('person').length > 1 || params.get('person') === '') return null;
        return { target, person: params.get('person'), year: null, month: null };
    }
    const yearRaw = params.get('year'), monthRaw = params.get('month');
    if (target === 'handlungsanweisung' && (yearRaw !== null || monthRaw !== null)) return null;
    if ([...params.keys()].some(key => page !== 'balance' || !['year', 'month'].includes(key))
        || params.getAll('year').length > 1 || params.getAll('month').length > 1) return null;
    if (yearRaw !== null && (!/^[1-9]\d{3}$/.test(yearRaw) || Number(yearRaw) < 1900)) return null;
    if (monthRaw !== null && (!/^(?:[1-9]|1[0-2])$/.test(monthRaw) || yearRaw === null || ['abschluss', 'jahresabschluss'].includes(target))) return null;
    return { target: target === 'abschluss' ? 'jahresabschluss' : target, year: yearRaw === null ? null : Number(yearRaw), month: monthRaw === null ? null : Number(monthRaw) };
}

/** Liest neue Records ausschließlich aus der bereits überlagerten Profilprojektion. */
export function projectOverviewHistory({ registry, profiles, liveData, today, period = 'all' }) {
    try {
        const start = requireHistoryRecord(liveData[WEALTH_HISTORY_START_KEY], assertHistoryStart);
        if (!start) return { status: 'missing', error: null };
        const prices = requireHistoryRecord(liveData[DAILY_PRICES_KEY], assertDailyPrices, { version: 1, symbols: {} });
        const events = readReconciliationHistory(registry);
        const history = projectProfileWealthHistory(registry, profiles, { prices, events, startDate: start.startDate, today, period });
        const hints = Object.entries(prices.symbols).filter(([, record]) => record.failures >= 3)
            .map(([symbol, record]) => `${symbol}: ${record.lastError}`);
        return { status: 'ready', ...history, startDate: start.startDate, hints };
    } catch (error) { return { status: 'corrupt', error: error.message }; }
}

/** Haushaltsfelder liegen live; Profilwechsel entfernt sie absichtlich aus Registrykopien. */
export function projectOverviewFromRecords(options) {
    const registry = options.registry ? structuredClone(options.registry) : null;
    const live = loadStoredBalanceStateFromData(options.liveData).value;
    if (registry && live) {
        const shared = Object.fromEntries(HOUSEHOLD_OWNED_BALANCE_STATE_KEYS.filter(key => Object.hasOwn(live, key)).map(key => [key, live[key]]));
        for (const profile of Object.values(registry.profiles)) {
            if (profile.meta.belongsToHousehold === false) continue;
            const loaded = loadStoredBalanceStateFromData(profile.data);
            // Beschädigte Quellen bleiben für die bestehende Recoveryprojektion sichtbar.
            if (loaded.status === 'valid') profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ ...loaded.value, ...shared });
        }
    }
    return projectOverview({ ...options, balanceSingleFallback: options.balanceSingleFallback ?? true, registry });
}

// Beide Seiten teilen nur bestätigte Archivpayloads, niemals einen Finanzquellsatz.
const archiveReads = new WeakMap();
export function projectOverviewWithAnnualArchive(options, { reader = annualCloseArchiveReader, onChange } = {}) {
    const base = projectOverviewFromRecords(options);
    if (!base.scope?.ids?.length || !base.activeId) return base;
    const context = { targetYear: base.now.getFullYear() - 1, activeId: base.activeId, scope: base.scope };
    const archive = reader.read(context);
    const key = JSON.stringify(context);
    if (archive.status === 'loading') {
        let request = archiveReads.get(reader);
        if (!request || request.key !== key) {
            request = { key, listeners: new Set() };
            archiveReads.set(reader, request);
            reader.refresh(context).then(result => {
                if (archiveReads.get(reader) !== request) return;
                archiveReads.delete(reader);
                if (result.status !== 'stale') for (const notify of request.listeners) notify();
            });
        }
        if (onChange) request.listeners.add(onChange);
    }
    return projectOverviewFromRecords({ ...options,
        snapshots: archive.status === 'loaded' ? archive.snapshots : [],
        annualArchive: { status: archive.status, error: archive.error } });
}
