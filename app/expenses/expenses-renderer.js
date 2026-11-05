import { expenseDeviation } from './expenses-needs.js';
import { renderExpenseNeeds } from './expenses-needs-renderer.js';
import { UIUtils } from '../balance/balance-utils.js';
import { EXPENSE_MONTHS, createExpenseNeedsLegend } from '../balance/balance-expenses-renderer.js';
const euro = value => value === null ? '—' : UIUtils.formatBalanceCurrency(value).replace(/^-/, '−');
/**
 * @param doc Zieldokument der Seite.
 * @returns Vorhandene DOM-Ziele der Ausgabenseite.
 */
export function collectExpensesDom(doc) {
    const names = ['table', 'yearSelect', 'yearSegments', 'yearLabel', 'csvInput', 'detailDialog', 'detailTitle', 'detailBody', 'detailClose', 'detailDelete'];
    return { expenses: Object.fromEntries(names.map(name => [name, doc.getElementById(`expenses${name[0].toUpperCase()}${name.slice(1)}`)])) };
}
/**
 * @param doc Zieldokument der Seite.
 * @returns Meldungsausgaben im gemeinsamen Seitenstatus.
 */
export function createExpensesMessages(doc) {
    const status = text => { doc.getElementById('expensesStatus').textContent = text; };
    return { toast: status, clearActionError: () => status(''), handleError: error => status(error.message), handleActionError: error => status(error.message) };
}
/**
 * @param doc Zieldokument der Seite.
 * @param view Bereits berechnete Anzeigeprojektion.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Kein Rückgabewert; rendert die Ausgabenprojektion mit Abschlussauslöser.
 */
export function renderExpensesPage(doc, view, { corrupt = false, occasion = null } = {}) {
    const put = (id, text) => { const node = doc.getElementById(id); if (node) node.textContent = text; };
    put('expensesHeading', `Was ihr ${view.year} ausgegeben habt.`);
    put('expensesContext', `Berechnet für: ${view.personId ? '' : 'Haushalt · '}${view.selected.map(person => person.name).join(' + ')}`);
    put('expensesBudgetSource', view.budget.status === 'adopted' ? `Budget aus dem Plan ${view.year}` : view.budget.status === 'provisional' ? `Budget ${view.year} · vorläufig` : `Budget ${view.year} nicht verfügbar`);
    const available = !corrupt;
    renderExpenseNeeds(doc, view, available);
    const missing = (view.missingMonths || []).map(month => EXPENSE_MONTHS[month - 1]);
    const missingNote = missing.length ? `${missing.join(', ')} noch nicht erfasst` : '';
    const finalBalance = view.pastYear && view.completeMonths === 12 && view.annualBudget !== null;
    put('expensesRemainingLabel', view.pastYear ? finalBalance
        ? view.stats.annualRemaining === 0 ? 'Budget eingehalten' : `Budget ${view.stats.annualRemaining > 0 ? 'unterschritten' : 'überschritten'} um`
        : 'Vorläufige Budgetdifferenz' : 'Restbudget');
    put('expensesAnnualBudget', available ? euro(view.annualBudget) : '—');
    put('expensesSpent', available && view.hasData ? euro(view.stats.annualUsed) : '—');
    put('expensesRemaining', available && view.annualBudget !== null ? euro(finalBalance ? Math.abs(view.stats.annualRemaining) : view.stats.annualRemaining) : '—');
    put('expensesForecast', available && view.stats.monthsWithData ? euro(view.stats.annualForecast) : '—');
    put('expensesBudgetNote', view.budget.monthly !== null ? `${euro(view.budget.monthly)} im Monat` : view.budget.status === 'invalid' ? 'Budgetbeleg nicht lesbar. Bitte Sicherung prüfen.' : 'Kein passendes Budget. In Balance planen.');
    const planned = view.months.reduce((sum, month) => sum + Object.values(month.profiles).reduce((total, entry) => total + (entry.plannedExpenses || []).reduce((total, item) => total + item.amount, 0), 0), 0);
    put('expensesSpentNote', available ? `${view.completeMonths} von 12 Monaten vollständig erfasst${planned ? ` · zusätzlich ${euro(planned)} Geplante Ausgaben außerhalb des Budgets` : ''}` : 'Daten nicht lesbar');
    put('expensesRemainingNote', available ? view.pastYear
        ? finalBalance ? 'Jahressaldo · alle 12 Monate vollständig erfasst' : missingNote || 'Budget minus bestätigte Ausgaben'
        : `für ${view.remainingCalendarMonths} ${view.remainingCalendarMonths === 1 ? 'Monat' : 'Monate'}${missingNote ? ` · ${missingNote}` : ''} · Budget minus bestätigte Ausgaben` : 'Daten nicht lesbar');
    const difference = view.stats.annualForecast - view.annualBudget;
    const forecastMonths = view.personId
        ? view.stats.monthsWithData === 1 ? 'positivem Ausgabenmonat' : 'positiven Ausgabenmonaten'
        : view.stats.monthsWithData === 1 ? 'Monat' : 'Monaten';
    const forecastBasis = `Mittelwert aus ${view.stats.monthsWithData} ${forecastMonths} × 12`;
    const hasForecast = available && view.stats.monthsWithData > 0;
    put('expensesForecastNote', hasForecast ? forecastBasis : 'Noch keine Hochrechnung');
    put('expensesForecastDeviation', hasForecast && view.annualBudget !== null ? expenseDeviation(view.stats.annualForecast, view.annualBudget, euro, 'Budget') : '');
    const forecastTile = doc.getElementById('expensesForecast')?.parentElement;
    if (forecastTile) forecastTile.dataset.tone = hasForecast && view.annualBudget !== null && difference > 0 ? 'warning' : '';
    doc.getElementById('expensesRemaining')?.classList.toggle('expense-positive', available && view.annualBudget !== null && view.stats.annualRemaining >= 0);
    doc.getElementById('expensesRemaining')?.classList.toggle('expense-negative', available && view.annualBudget !== null && view.stats.annualRemaining < 0);
    put('expensesCategoriesTitle', `Wofür? ${view.year} nach Kategorien${planned ? ' · einschließlich Geplanter Ausgaben' : ''}`);
    const split = available && !view.personId && view.needs?.monthsWithBreakdown > 0;
    const legend = doc.getElementById('expensesCategoriesLegend');
    if (legend) { legend.hidden = !split; legend.replaceChildren(createExpenseNeedsLegend(doc)); }
    const totals = doc.getElementById('expensesCategoriesNeeds');
    if (totals) {
        totals.hidden = !split;
        const sum = key => view.categories.reduce((total, row) => total + (row[key] || 0), 0);
        const all = sum('floor') + sum('flex') + sum('unallocated');
        const portion = amount => all > 0 ? (amount / all * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '—';
        totals.textContent = split ? Object.entries({ floor: 'Floor', flex: 'Flex', unallocated: 'ohne Aufteilung' })
            .map(([key, label]) => ({ label, amount: sum(key) }))
            .filter(({ amount }) => amount !== 0)
            .map(({ label, amount }) => `${label} ${euro(amount)} (${portion(amount)} %)`)
            .join(' · ') : '';
    }
    const host = doc.getElementById('expensesCategories'); host.replaceChildren();
    const largestCategory = view.categories.reduce((maximum, category) => Math.max(maximum, category.amount), 0);
    if (available && view.categories.length) for (const category of view.categories) {
        const row = doc.createElement('div'); row.className = 'expense-category';
        const name = doc.createElement('span'); name.textContent = category.name + (category.amount < 0 ? ' · Erstattung' : '');
        const track = doc.createElement('span'); track.className = 'expense-category-track'; track.setAttribute('aria-hidden', 'true');
        const bar = doc.createElement('span');
        bar.style.width = `${largestCategory > 0 ? Math.max(0, category.amount) / largestCategory * 100 : 0}%`;
        if (split) {
            bar.className = 'expense-category-parts';
            track.removeAttribute('aria-hidden');
            track.title = `Floor ${euro(category.floor)} · Flex ${euro(category.flex)} · ohne Aufteilung ${euro(category.unallocated)}`;
            for (const key of ['floor', 'flex', 'unallocated']) {
                const part = doc.createElement('span'); part.className = `expense-category-${key}`;
                part.style.width = `${category.amount > 0 ? Math.max(0, category[key]) / category.amount * 100 : 0}%`; bar.append(part);
            }
        }
        track.appendChild(bar);
        const share = category.share > 0 && category.share < 0.5 ? '< 1' : Math.round(category.share);
        const value = doc.createElement('span'); value.className = 'expense-category-value'; value.textContent = euro(category.amount);
        const portion = doc.createElement('span'); portion.className = 'expense-category-share'; portion.textContent = `${share} %`;
        row.append(name, track, value, portion); host.appendChild(row);
    } else put('expensesCategories', corrupt ? 'Ausgabendaten nicht lesbar. Bitte Recovery verwenden.' : 'Noch keine Kategorien importiert.');
    const band = doc.getElementById('overviewFocus');
    const due = view.due;
    band.hidden = corrupt || !due.missing.length;
    put('expensesDueText', `${EXPENSE_MONTHS[due.month - 1]} ${due.year} fehlt noch bei ${due.missing.map(person => person.name).join(' und ')}. Der Monatsabschluss ist fällig.`);
    const close = doc.getElementById('expensesClose');
    delete close.dataset.overviewMonth; delete close.dataset.overviewAnnual;
    if (occasion?.kind === 'annual') close.dataset.overviewAnnual = '';
    else if (occasion?.kind === 'monthly') close.dataset.overviewMonth = '';
    close.disabled = !['annual', 'monthly'].includes(occasion?.kind);
}
