import { UIUtils } from '../balance/balance-utils.js';
import { EXPENSE_MONTHS } from '../balance/balance-expenses-renderer.js';
const euro = value => value === null ? '—' : UIUtils.formatBalanceCurrency(value);
export function collectExpensesDom(doc) {
    const names = ['table', 'yearSelect', 'yearSegments', 'yearLabel', 'csvInput', 'detailDialog', 'detailTitle', 'detailBody', 'detailClose', 'detailDelete'];
    return { expenses: Object.fromEntries(names.map(name => [name, doc.getElementById(`expenses${name[0].toUpperCase()}${name.slice(1)}`)])) };
}
export function createExpensesMessages(doc) {
    const status = text => { doc.getElementById('expensesStatus').textContent = text; };
    return { toast: status, clearActionError: () => status(''), handleError: error => status(error.message), handleActionError: error => status(error.message) };
}
export function renderExpensesPage(doc, view, { corrupt = false, occasion = null } = {}) {
    const put = (id, text) => { const node = doc.getElementById(id); if (node) node.textContent = text; };
    put('expensesHeading', `Was ihr ${view.year} ausgegeben habt.`);
    put('expensesContext', `Berechnet für: ${view.personId ? '' : 'Haushalt · '}${view.selected.map(person => person.name).join(' + ')}`);
    put('expensesBudgetSource', view.budget.status === 'adopted' ? `Budget aus dem Plan ${view.year}` : view.budget.status === 'provisional' ? `Budget ${view.year} · vorläufig` : `Budget ${view.year} nicht verfügbar`);
    const available = !corrupt;
    put('expensesAnnualBudget', available ? euro(view.annualBudget) : '—');
    put('expensesSpent', available && view.hasData ? euro(view.stats.annualUsed) : '—');
    put('expensesRemaining', available && view.annualBudget !== null ? euro(view.stats.annualRemaining) : '—');
    put('expensesForecast', available && view.stats.monthsWithData ? euro(view.stats.annualForecast) : '—');
    put('expensesBudgetNote', view.budget.monthly !== null ? `${euro(view.budget.monthly)} im Monat` : view.budget.status === 'invalid' ? 'Budgetbeleg nicht lesbar. Bitte Sicherung prüfen.' : 'Kein passendes Budget. In Balance planen.');
    put('expensesSpentNote', available ? `${view.completeMonths} von 12 Monaten vollständig erfasst` : 'Daten nicht lesbar');
    put('expensesRemainingNote', available ? `für ${12 - view.completeMonths} Monate · Budget minus bestätigte Ausgaben` : 'Daten nicht lesbar');
    const difference = view.stats.annualForecast - view.annualBudget;
    put('expensesForecastNote', available && view.stats.monthsWithData ? `${view.stats.monthsWithData >= 2 ? 'Median' : 'Durchschnitt'} aus ${view.stats.monthsWithData} positiven Ausgabenmonaten${view.annualBudget !== null ? ` · ${euro(Math.abs(difference))} ${difference > 0 ? 'über' : 'unter'} Budget` : ''}` : 'Noch keine Hochrechnung');
    doc.getElementById('expensesRemaining')?.classList.toggle('expense-positive', available && view.annualBudget !== null && view.stats.annualRemaining >= 0);
    doc.getElementById('expensesRemaining')?.classList.toggle('expense-negative', available && view.annualBudget !== null && view.stats.annualRemaining < 0);
    put('expensesCategoriesTitle', `Wofür? ${view.year} nach Kategorien`);
    const host = doc.getElementById('expensesCategories'); host.replaceChildren();
    if (available && view.categories.length) for (const category of view.categories) {
        const row = doc.createElement('div'); row.className = 'expense-category';
        const name = doc.createElement('span'); name.textContent = category.name + (category.amount < 0 ? ' · Erstattung' : '');
        const track = doc.createElement('span'); track.className = 'expense-category-track'; track.setAttribute('aria-hidden', 'true');
        const bar = doc.createElement('span'); bar.style.width = `${category.bar}%`; track.appendChild(bar);
        const share = category.share > 0 && category.share < 0.5 ? '< 1' : Math.round(category.share);
        const value = doc.createElement('span'); value.className = 'expense-category-value'; value.textContent = `${euro(category.amount)} · ${share} %`;
        row.append(name, track, value); host.appendChild(row);
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
