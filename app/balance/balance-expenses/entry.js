import { bindBalanceYearSegments } from '../balance-presentation-controls.js';
import { EXPENSES_STORE_STATUS, loadExpensesStoreResult, setExpensesActiveYear, resolveExpensesInitialYear } from '../balance-expenses-storage.js';
import { context, state } from './context.js';
import { createDefaultRecoveryOptions, renderProfileRecoveryBlocker } from './helpers.js';
import { createExpensesRecovery } from './recovery.js';
import { createExpensesView } from './view.js';
import { createExpensesActions } from './actions.js';

// Die gegenseitigen Anzeigeaufrufe werden einmal verbunden, ohne Importkreis.
const view = {};
const recovery = createExpensesRecovery(view);
const display = createExpensesView(recovery);
Object.assign(view, display);
const { renderYearSelect, renderTable, setYear } = display;
const { renderCorruptExpensesState } = recovery;
const { handleTableClick, handleFileChange } = createExpensesActions(display, recovery);

function bindEvents() {
    if (context.dom?.expenses?.table) {
        context.dom.expenses.table.addEventListener('click', handleTableClick);
    }
    if (context.dom?.expenses?.csvInput) {
        context.dom.expenses.csvInput.addEventListener('change', handleFileChange);
    }
    if (context.dom?.expenses?.yearSelect) {
        context.dom.expenses.yearSelect.addEventListener('change', (event) => {
            const year = Number(event.target.value);
            setYear(year);
        });
    }
    if (context.dom?.expenses?.detailDelete) {
        context.dom.expenses.detailDelete.dataset.action = 'delete';
        context.dom.expenses.detailDelete.addEventListener('click', async event => {
            if (!context.detailTarget || context.detailTarget.year !== state.year) return;
            await handleTableClick(event);
            context.dom.expenses.detailDialog.close();
        });
    }
    if (context.dom?.expenses?.detailClose) {
        context.dom.expenses.detailClose.addEventListener('click', () => context.dom.expenses.detailDialog.close());
    }
    if (context.dom?.expenses?.detailDialog) {
        context.dom.expenses.detailDialog.addEventListener('click', (event) => {
            if (event.target === context.dom.expenses.detailDialog) context.dom.expenses.detailDialog.close();
        });
    }
}

/**
 * @param domRefs Eingabe für die bestehende Projektion.
 * @param options Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function initExpensesTab(domRefs, options = {}) {
    context.generation++;
    context.dom = domRefs;
    context.adapters = options;
    context.detailTarget = null;
    context.recoveryOptions = createDefaultRecoveryOptions(options);
    context.onChange = typeof options.onChange === 'function' ? options.onChange : null;
    context.onImportSuccess = typeof options.onImportSuccess === 'function' ? options.onImportSuccess : null;
    context.pendingImport = null;
    state.profileIds = [];
    state.recoveryExported = false;
    state.recoveryCancelled = false;

    context.refreshYearSegments = bindBalanceYearSegments(context.dom?.expenses?.yearSelect, context.dom?.expenses?.yearSegments);

    const initialResult = loadExpensesStoreResult(context.recoveryOptions.storage);
    if (initialResult.status === EXPENSES_STORE_STATUS.CORRUPT) {
        state.corruption = initialResult;
        state.year = context.recoveryOptions.now().getFullYear();
        bindEvents();
        renderCorruptExpensesState();
        return initialResult;
    }

    state.corruption = null;
    state.year = options.initialYear || Number(initialResult.store?.activeYear) || context.recoveryOptions.now().getFullYear();
    if (!context.adapters.readOnlySelection) setExpensesActiveYear(state.year, context.recoveryOptions.storage);
    bindEvents();
    const band = globalThis.document?.getElementById?.('probelaufBand');
    if (band && globalThis.MutationObserver) new MutationObserver(() => renderTable()).observe(band, { subtree: true, childList: true, attributes: true });
    try {
        renderYearSelect();
        renderTable();
    } catch (error) {
        return {
            ...initialResult,
            ...renderProfileRecoveryBlocker(error)
        };
    }
    return initialResult;
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function updateExpensesBudget({ monthlyBudget, annualBudget }) {
    state.monthlyBudget = Number.isFinite(monthlyBudget) ? monthlyBudget : 0;
    state.annualBudget = Number.isFinite(annualBudget) ? annualBudget : 0;
    renderTable();
}

/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function rollExpensesYear() {
    if (state.corruption) return state.year;
    const nextYear = state.year + 1;
    setYear(nextYear);
    return nextYear;
}

/** Nach dem bestätigten Jahreswrite ausschließlich aus dem Speicher anzeigen. */
/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function projectCommittedExpensesYear() {
    state.year = resolveExpensesInitialYear(context.recoveryOptions?.storage);
    renderYearSelect();
    renderTable();
    return state.year;
}

/** Adapter für reine Auswahlzustände der eigenständigen Seite. */
/**
 * @param year Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function selectExpensesYear(year) { setYear(year); return state.year; }

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function refreshExpensesView({ invalidateContext = false } = {}) {
    if (invalidateContext) { context.generation++; context.pendingImport = null; }
    renderYearSelect(); renderTable();
}

/**
 * @returns Ergebnis der bestehenden Operation.
 */
export function getExpensesViewYear() { return state.year; }
