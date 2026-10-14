/**
 * Module: Balance Expenses Renderer
 * Purpose: DOM rendering helpers for the expenses check.
 */
"use strict";

import { UIUtils } from './balance-utils.js';
import { bindBalanceTableOverflow } from './balance-presentation-controls.js';
import { appendExampleExpensesIcon } from '../shared/designsystem-icons.js';

import { computeSpent, sortExpenseEntries } from './balance-expenses-metrics.js';

export const EXPENSE_MONTHS = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// Rein darstellende Präsenz aus derselben Jahresprojektion wie die Matrix.
// refreshExpensesTableValues läuft im vorhandenen Ablauf vor der Summary.
const yearPresenceByHost = new WeakMap();

function refreshMatrixOverflow(host) {
    const region = host?.parentElement;
    const hint = host?.ownerDocument?.getElementById('expensesMatrixScrollHint');
    if (!region || !hint) return;
    bindBalanceTableOverflow(region, hint);
}

// Präsenz braucht einen gültigen Importrecord, keinen positiven Betrag.
function hasValidImport(record) {
    const categories = record?.categories;
    return record !== null && typeof record === 'object' && !Array.isArray(record)
        && categories !== null && typeof categories === 'object' && !Array.isArray(categories)
        && Object.values(categories).every(value => ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value)));
}

function appendActionIcon(button, action, doc) {
    const paths = {
        import: ['M12 16V4M7 9l5-5 5 5', 'M4 20h16'],
        details: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14', 'm20 20-3.5-3.5'],
        delete: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13']
    };
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18',
        fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'aria-hidden': 'true', focusable: 'false' })) {
        svg.setAttribute(key, value);
    }
    paths[action].forEach(d => {
        const path = doc.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });
    button.appendChild(svg);
}

function setBudgetStatusClass(el, actual, target, hasData = true) {
    el.classList.remove('budget-ok', 'budget-warn', 'budget-bad');
    if (!hasData || target <= 0) return;
    if (actual <= target) {
        el.classList.add('budget-ok');
    } else if (actual <= target * 1.05) {
        el.classList.add('budget-warn');
    } else {
        el.classList.add('budget-bad');
    }
}

export function renderExpensesYearSelect({ select, years, activeYear, doc = globalThis.document }) {
    if (!select) return;
    select.replaceChildren();
    years.forEach(year => {
        const option = doc.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        select.appendChild(option);
    });
    select.value = String(activeYear);
}

export function renderExpensesSummary({ refs, stats, annualBudget, monthlyBudget }) {
    if (!refs) return;
    const safeAnnualBudget = Number.isFinite(annualBudget) ? annualBudget : 0;
    const safeMonthlyBudget = Number.isFinite(monthlyBudget) ? monthlyBudget : 0;
    const hasData = yearPresenceByHost.get(refs.table) ?? stats.monthsWithData > 0;

    if (refs.annualBudget) {
        refs.annualBudget.textContent = safeAnnualBudget > 0 ? UIUtils.formatBalanceCurrency(safeAnnualBudget) : '—';
    }
    if (refs.monthlyBudget) {
        refs.monthlyBudget.textContent = safeMonthlyBudget > 0
            ? `Monatsbudget: ${UIUtils.formatBalanceCurrency(safeMonthlyBudget)}`
            : 'Monatsbudget: —';
    }
    if (refs.annualUsed) {
        refs.annualUsed.textContent = safeAnnualBudget > 0 && hasData
            ? `Verbraucht: ${UIUtils.formatBalanceCurrency(stats.annualUsed)}`
            : 'Verbraucht: —';
    }
    if (refs.annualRemaining) {
        refs.annualRemaining.textContent = safeAnnualBudget > 0 && hasData
            ? UIUtils.formatBalanceCurrency(Math.max(0, stats.annualRemaining))
            : '—';
    }
    if (refs.annualForecast) {
        refs.annualForecast.textContent = hasData ? UIUtils.formatBalanceCurrency(stats.annualForecast) : '—';
        setBudgetStatusClass(refs.annualForecast, stats.annualForecast, safeAnnualBudget, hasData);
    }
    if (refs.forecastSub) {
        if (hasData) {
            const baseLabel = stats.monthsWithData >= 2 ? 'Median/Monat' : 'Ø/Monat';
            const baseValue = stats.monthsWithData >= 2 ? stats.medianMonthly : stats.avgMonthly;
            refs.forecastSub.textContent = `${baseLabel}: ${UIUtils.formatBalanceCurrency(baseValue)} · Datenmonate: ${stats.monthsWithData}/12`;
        } else {
            refs.forecastSub.textContent = 'Ø/Monat: —';
        }
    }
    if (refs.ytdValue) {
        refs.ytdValue.textContent = hasData ? UIUtils.formatBalanceCurrency(stats.ytdUsed) : '—';
        setBudgetStatusClass(refs.ytdValue, stats.ytdUsed, stats.ytdBudget, hasData);
    }
    if (refs.ytdSub) {
        refs.ytdSub.textContent = stats.ytdBudget > 0
            ? `Soll: ${UIUtils.formatBalanceCurrency(stats.ytdBudget)} · Δ ${UIUtils.formatBalanceCurrency(stats.ytdDelta)}`
            : 'Soll: —';
    }
}

export function renderExpensesTableStructure({ host, profiles, examples = false, deleteInDetails = false, doc = globalThis.document }) {
    if (!host) return;
    const table = doc.createElement('table');
    const caption = doc.createElement('caption');
    caption.className = 'balance-table-caption';
    caption.textContent = 'Beträge in €';
    table.appendChild(caption);
    table.className = 'expenses-table ds-table';

    const thead = doc.createElement('thead');
    const headerRow = doc.createElement('tr');
    const monthHead = doc.createElement('th');
    monthHead.textContent = 'Monat';
    monthHead.scope = 'col';
    headerRow.appendChild(monthHead);

    profiles.forEach(profile => {
        const th = doc.createElement('th');
        th.className = 'profile-head';
        th.textContent = profile.name || profile.profileId;
        th.scope = 'col';
        headerRow.appendChild(th);
    });

    const totalHead = doc.createElement('th');
    totalHead.className = 'total-head';
    totalHead.textContent = 'Gesamt';
    totalHead.scope = 'col';
    headerRow.appendChild(totalHead);
    for (const label of ['Budget', 'Abweichung']) {
        const th = doc.createElement('th');
        th.textContent = label;
        th.scope = 'col';
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    for (let m = 1; m <= 12; m++) {
        const tr = doc.createElement('tr');
        const monthCell = doc.createElement('th');
        monthCell.scope = 'row';
        monthCell.className = 'month-cell';
        monthCell.textContent = EXPENSE_MONTHS[m - 1];
        tr.appendChild(monthCell);

        profiles.forEach(profile => {
            const td = doc.createElement('td');
            td.className = 'profile-cell';
            td.dataset.month = String(m);
            td.dataset.profile = profile.profileId;

            const inner = doc.createElement('div');
            inner.className = 'profile-cell-inner';

            const value = doc.createElement('div');
            value.className = 'expense-value';
            value.dataset.role = 'value';
            value.textContent = '—';

            const actions = doc.createElement('div');
            actions.className = 'expense-actions';

            const importBtn = doc.createElement('button');
            importBtn.type = 'button';
            importBtn.className = 'ds-button ds-button-secondary ds-icon-button';
            importBtn.dataset.action = 'import';
            importBtn.dataset.month = String(m);
            importBtn.dataset.profile = profile.profileId;
            appendActionIcon(importBtn, 'import', doc);
            importBtn.title = 'CSV importieren · erst Vorschau';
            importBtn.ariaLabel = 'CSV importieren';
            importBtn.ariaLabel += ` · ${EXPENSE_MONTHS[m - 1]} · ${profile.name || profile.profileId}`;

            const detailBtn = doc.createElement('button');
            detailBtn.type = 'button';
            detailBtn.className = 'ds-button ds-button-secondary ds-icon-button';
            detailBtn.dataset.action = 'details';
            detailBtn.dataset.month = String(m);
            detailBtn.dataset.profile = profile.profileId;
            appendActionIcon(detailBtn, 'details', doc);
            detailBtn.title = 'Kategorien ansehen · Monatsdaten löschen';
            detailBtn.ariaLabel = 'Details anzeigen';
            detailBtn.ariaLabel += ` · ${EXPENSE_MONTHS[m - 1]} · ${profile.name || profile.profileId}`;

            const deleteBtn = doc.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'ds-button ds-button-secondary ds-icon-button expense-delete';
            deleteBtn.dataset.action = 'delete';
            deleteBtn.dataset.month = String(m);
            deleteBtn.dataset.profile = profile.profileId;
            appendActionIcon(deleteBtn, 'delete', doc);
            deleteBtn.title = 'Monatsdaten löschen';
            deleteBtn.ariaLabel = 'Monatsdaten löschen';
            deleteBtn.ariaLabel += ` · ${EXPENSE_MONTHS[m - 1]} · ${profile.name || profile.profileId}`;
            deleteBtn.classList.add('btn-hidden');
            deleteBtn.tabIndex = -1;
            deleteBtn.ariaHidden = 'true';

            actions.append(importBtn, detailBtn);
            if (!deleteInDetails) actions.appendChild(deleteBtn);
            if (examples) {
                const example = doc.createElement('button'); example.type = 'button';
                example.className = 'ds-button ds-button-secondary ds-icon-button';
                example.dataset.action = 'example'; example.dataset.expensesExample = '';
                example.dataset.month = String(m); example.dataset.profile = profile.profileId;
                appendExampleExpensesIcon(example, doc);
                example.ariaLabel = 'Beispielausgaben einspielen';
                example.ariaLabel += ` · ${EXPENSE_MONTHS[m - 1]} · ${profile.name || profile.profileId}`;
                example.title = example.ariaLabel;
                actions.appendChild(example);
            }
            inner.append(value, actions);
            td.appendChild(inner);
            tr.appendChild(td);
        });

        const totalCell = doc.createElement('td');
        totalCell.className = 'total-cell';
        totalCell.dataset.monthTotal = String(m);
        const totalValue = doc.createElement('div');
        totalValue.className = 'expense-value';
        totalValue.dataset.role = 'total';
        totalValue.textContent = '—';
        totalCell.appendChild(totalValue);
        tr.appendChild(totalCell);
        const budgetCell = doc.createElement('td');
        budgetCell.dataset.role = 'budget';
        const deltaCell = doc.createElement('td');
        deltaCell.dataset.role = 'delta';
        for (const cell of [budgetCell, deltaCell]) {
            cell.className = 'expense-budget-cell';
            cell.dataset.month = String(m);
            cell.textContent = '—';
            tr.appendChild(cell);
        }
        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    host.replaceChildren(table);
    refreshMatrixOverflow(host);
}

export function refreshExpensesTableValues({ host, yearData, profileIds, monthlyBudget, formatCurrency, missingLabel = '—', dueMonth = 0 }) {
    if (!host) return;
    let hasYearData = false;
    for (let month = 1; month <= 12; month++) {
        const monthData = yearData?.months?.[String(month)] || { profiles: {} };
        if (Object.values(monthData.profiles || {}).some(Boolean)) hasYearData = true;
        let monthTotal = 0;
        let importedProfiles = 0;

        profileIds.forEach(profileId => {
            const profileData = monthData.profiles?.[profileId] || null;
            const imported = hasValidImport(profileData);
            if (imported) importedProfiles++;
            const categories = profileData?.categories || {};
            const { spent } = computeSpent(categories);
            monthTotal += spent;

            const cell = host.querySelector(`[data-month="${month}"][data-profile="${profileId}"] [data-role="value"]`);
            if (cell) cell.textContent = imported ? formatCurrency(spent) + (profileData?.source === 'probelauf-example' ? ' · Beispieldaten (Probelauf)' : '') : month <= dueMonth ? missingLabel : '—';
            const deleteButton = host.querySelector(`[data-month="${month}"][data-profile="${profileId}"] [data-action="delete"]`);
            if (deleteButton) {
                const hasProfileData = Boolean(profileData);
                deleteButton.classList[hasProfileData ? 'remove' : 'add']('btn-hidden');
                deleteButton.tabIndex = hasProfileData ? 0 : -1;
                deleteButton.ariaHidden = hasProfileData ? 'false' : 'true';
            }
        });

        const totalCell = host.querySelector(`[data-month-total="${month}"] [data-role="total"]`);
        if (totalCell) {
            totalCell.textContent = importedProfiles === profileIds.length && importedProfiles > 0
                ? formatCurrency(monthTotal) : importedProfiles > 0 ? 'unvollständig' : '—';
            totalCell.classList.remove('budget-ok', 'budget-warn', 'budget-bad');
            totalCell.classList[importedProfiles > 0 && importedProfiles < profileIds.length ? 'add' : 'remove']('expense-incomplete');
        }
        const budget = host.querySelector(`[data-month="${month}"][data-role="budget"]`);
        if (budget) budget.textContent = monthlyBudget > 0 ? formatCurrency(monthlyBudget) : '—';
        const delta = host.querySelector(`[data-month="${month}"][data-role="delta"]`);
        if (delta) {
            const comparable = importedProfiles > 0 && importedProfiles === profileIds.length && monthlyBudget > 0;
            const difference = monthTotal - monthlyBudget;
            delta.textContent = comparable
                ? `${difference < 0 ? '−' : difference > 0 ? '+' : ''}${UIUtils.formatBalanceCurrency(Math.abs(difference))}` : '—';
            delta.classList.remove('budget-ok', 'budget-warn', 'budget-bad');
            if (comparable && difference !== 0) delta.classList.add(difference < 0 ? 'budget-ok' : 'budget-warn');
        }
    }
    yearPresenceByHost.set(host, hasYearData);
    refreshMatrixOverflow(host);
}

export function renderExpensesDetails({ refs, monthName, profileName, categories, source, doc = globalThis.document, formatCurrency }) {
    if (!refs?.detailDialog) return;
    const entries = sortExpenseEntries(categories);

    if (refs.detailTitle) {
        refs.detailTitle.textContent = `${monthName} · ${profileName}${source === 'probelauf-example' ? ' · Beispieldaten (Probelauf)' : ''}`;
    }

    if (refs.detailBody) {
        refs.detailBody.replaceChildren();
        if (!entries.length) {
            const empty = doc.createElement('div');
            empty.className = 'expense-empty';
            empty.textContent = 'Keine Kategorien hinterlegt.';
            refs.detailBody.appendChild(empty);
        } else {
            const list = doc.createElement('table');
            list.className = 'expense-detail-table ds-table';
            const tbody = doc.createElement('tbody');
            entries.forEach(entry => {
                const row = doc.createElement('tr');
                const name = doc.createElement('td');
                name.textContent = entry.name;
                const value = doc.createElement('td');
                value.textContent = formatCurrency(entry.value);
                value.className = 'expense-detail-value';
                row.append(name, value);
                tbody.appendChild(row);
            });
            list.appendChild(tbody);
            refs.detailBody.appendChild(list);
        }
    }

    refs.detailDialog.showModal();
}
