import { PersistenceFacade } from '../../shared/persistence-facade.js';
import { canGenerateExampleExpenses } from '../../demo/beispielausgaben.js';
import { getProbelaufController } from '../../shared/probelauf-state.js';
import { computeYearStats } from '../balance-expenses-metrics.js';
import { getExpensesMonthData, getExpensesYearData, listExpensesYears, setExpensesActiveYear } from '../balance-expenses-storage.js';
import { EXPENSE_MONTHS, refreshExpensesTableValues, renderExpensesDetails, renderExpensesSummary, renderExpensesTableStructure, renderExpensesYearSelect } from '../balance-expenses-renderer.js';
import { context, state } from './context.js';
import { notifyExpensesChange, readExpensesStoreForUi, formatCurrency, getProfiles } from './helpers.js';

export function createExpensesView({ renderCorruptExpensesState }) {
    function renderYearSelect() {
        if (!context.dom?.expenses?.yearSelect) return;
        if (state.corruption) {
            context.dom.expenses.yearSelect.disabled = true;
            (0, context.refreshYearSegments)();
            return;
        }
        const store = readExpensesStoreForUi();
        if (!store) {
            renderCorruptExpensesState();
            return;
        }
        context.dom.expenses.yearSelect.disabled = false;
        renderExpensesYearSelect({
            select: context.dom.expenses.yearSelect,
            years: listExpensesYears({ store, activeYear: state.year }),
            activeYear: state.year
        });
        if (context.dom.expenses.yearLabel) context.dom.expenses.yearLabel.textContent = String(state.year);
        (0, context.refreshYearSegments)();
    }

    function updateSummary(store) {
        if (!context.dom?.expenses) return;
        const safeStore = store || readExpensesStoreForUi();
        if (!safeStore) {
            renderCorruptExpensesState();
            return;
        }
        if (context.adapters.renderSummary) { context.adapters.renderSummary(safeStore, state.year); return; }
        const yearData = getExpensesYearData(safeStore, state.year);
        const stats = computeYearStats({
            yearData,
            annualBudget: state.annualBudget,
            monthlyBudget: state.monthlyBudget
        });
        renderExpensesSummary({
            refs: context.dom.expenses,
            stats,
            annualBudget: state.annualBudget,
            monthlyBudget: state.monthlyBudget,
            formatCurrency
        });
    }

    function refreshTableValues() {
        if (!context.dom?.expenses?.table) return;
        const store = readExpensesStoreForUi();
        if (!store) {
            renderCorruptExpensesState();
            return;
        }
        const yearData = getExpensesYearData(store, state.year);
        refreshExpensesTableValues({
            host: context.dom.expenses.table,
            yearData,
            profileIds: state.profileIds,
            monthlyBudget: state.monthlyBudget,
            formatCurrency, missingLabel: context.adapters.missingLabel,
            dueMonth: context.adapters.dueMonth?.(state.year)
        });
        updateSummary(store);
    }

    function renderTable() {
        const probelauf = getProbelaufController(globalThis.document);
        if (probelauf?.busy || probelauf?.blocked
            || PersistenceFacade.isInitialized() && PersistenceFacade.getPersistenceStatus().reloadRequired) return;
        // Auch gemeinsame Observer ersetzen die Matrix außerhalb des Seitenrefreshs.
        // Der Seitenadapter schützt den Fokus bereits vor dem nativen focusout.
        if (context.adapters.preserveMatrixFocus) return context.adapters.preserveMatrixFocus(renderTableContent);
        return renderTableContent();
    }

    function renderTableContent() {
        if (!context.dom?.expenses?.table) return;
        if (state.corruption) {
            renderCorruptExpensesState();
            return;
        }
        const profiles = getProfiles();
        if (context.dom.expenses.profileCount) context.dom.expenses.profileCount.textContent = `${profiles.length} ${profiles.length === 1 ? 'Profil' : 'Profile'}`;
        const profileIds = profiles.map(p => p.profileId);
        const visible = canGenerateExampleExpenses(getProbelaufController(globalThis.document), { allowBusy: true });
        const needsRebuild = profileIds.join('|') !== state.profileIds.join('|') || visible !== context.exampleVisible;

        if (needsRebuild) {
            state.profileIds = profileIds;
            context.exampleVisible = visible;
            renderExpensesTableStructure({
                host: context.dom.expenses.table,
                profiles, examples: visible, deleteInDetails: context.adapters.deleteInDetails
            });
        }

        refreshTableValues();
    }

    function setYear(year) {
        if (!Number.isFinite(year) || state.corruption) return;
        try {
            state.year = year;
            if (!context.adapters.readOnlySelection) setExpensesActiveYear(year, context.recoveryOptions?.storage);
            renderYearSelect();
            renderTable();
            notifyExpensesChange();
        } catch {
            readExpensesStoreForUi();
            renderCorruptExpensesState();
        }
    }

    function openDetails(month, profileId) {
        if (!context.dom?.expenses?.detailDialog || state.corruption) return;
        const store = readExpensesStoreForUi();
        if (!store) {
            renderCorruptExpensesState();
            return;
        }
        const yearData = getExpensesYearData(store, state.year);
        const monthData = getExpensesMonthData(yearData, month);
        const profileData = monthData.profiles?.[profileId];
        const categories = profileData?.categories || {};
        const profileName = getProfiles().find(p => p.profileId === profileId)?.name || profileId;

        context.detailTarget = { month, profileId, year: state.year };
        if (context.dom.expenses.detailDelete) {
            context.dom.expenses.detailDelete.dataset.month = String(month);
            context.dom.expenses.detailDelete.dataset.profile = profileId;
            context.dom.expenses.detailDelete.disabled = !profileData;
        }
        renderExpensesDetails({
            refs: context.dom.expenses,
            monthName: EXPENSE_MONTHS[month - 1],
            profileName,
            categories,
            categoryNeeds: profileData?.categoryNeeds,
            source: profileData?.source,
            plannedExpenses: profileData?.plannedExpenses
        });
    }

    return { renderYearSelect, refreshTableValues, renderTable, setYear, openDetails };
}
