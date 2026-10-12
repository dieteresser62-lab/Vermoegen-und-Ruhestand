import { expensesDestination, expensesHref } from '../shared/expenses-navigation.js';
import { requestProbelaufStart } from '../shared/probelauf-ui.js';
import { householdPlanComparisonHtml, projectHouseholdPlanComparison } from '../profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../balance/balance-action-origin.js';
import { deriveBalanceNextSteps } from '../balance/balance-next-steps.js';
import { renderOverviewHistory } from './overview-history.js';
import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { overviewPriceLabel, overviewPricesDone, overviewQuoteLabel, overviewBackupAge, overviewAllocationView } from './overview-model.js';
import { projectOverviewMonthSteps } from './overview-month-confirmation.js';
import { cashDateDisplay } from '../shared/tagesgeld-fields.js';
import { EXAMPLE_EXPENSES_ICON_HTML, exampleExpensesLabel } from '../shared/designsystem-icons.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const allocationNames = { aktien: 'Aktien', anleihe: 'Anleihen', geldmarkt: 'Geldmarkt', gold: 'Gold', cash: 'Tagesgeld' };

function actionOriginHtml(origin) {
    return `<p class="ds-source" data-action-origin>${escapeHtml(origin.label)} · ${escapeHtml(origin.previewLabel)} · <a href="Balance.html#handlungsanweisung" data-profile-handoff>Handlungsanzeige in Balance →</a></p>`;
}

// Ein brauchbarer gespeicherter Kursstand belegt keinen heutigen Abruf.
// Die fachliche Frischeprüfung bleibt für Rechen- und Abschlussschritte unverändert.
function todaysPricesConfirmed(model) {
    if (model.priceReport?.status !== 'complete' || !overviewPricesDone(model)) return false;
    const date = new Date(model.priceReport.retrievedAt ?? model.quoteDate ?? NaN);
    return Number.isFinite(date.getTime()) && date <= model.now && date.toDateString() === model.now.toDateString();
}

export function renderOverview(doc, model) {
    const set = (id, text) => { const host = doc.getElementById(id); if (host) host.textContent = text; };
    set('overviewDate', model.now.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }));
    set('overviewTitle', `Deine Übersicht im ${model.now.toLocaleDateString('de-DE', { month: 'long' })}`);
    set('overviewLead', 'Vermögen und zuletzt gerechneter Plan aus deinen gespeicherten Daten.');
    const members = model.members || [];
    const names = model.available ? members.length ? members.map(person => person.name).join(' + ') : 'Keine Auswahl' : 'nicht verfügbar';
    set('overviewHouseholdLabel', members.length === 1 ? 'Einzelprofil:' : 'Haushalt:');
    set('overviewHouseholdNames', names);
    doc.getElementById('overviewHouseholdNames')?.setAttribute('title', names);
    set('overviewPricesValue', overviewPriceLabel(model));
    set('overviewPlanningYearValue', `${model.year}${model.planComparison?.recordStatus === 'valid' ? '' : ' · Vorschau'}`);
    const backup = overviewBackupAge(model.now, model.lastBackup);
    const backupDays = backup.days === null ? null : Math.floor(backup.days);
    set('overviewBackupLabel', backup.days === null ? '' : 'Letzte Sicherung');
    set('overviewBackupValue', backupDays === null ? 'Noch keine Vollsicherung'
        : backupDays === 0 ? 'heute' : backupDays === 1 ? 'vor 1 Tag' : `vor ${backupDays} Tagen`);
    const backupPill = doc.getElementById('overviewBackup');
    if (backupPill) backupPill.dataset.warning = String(backup.warning);
    const reminder = doc.getElementById('overviewBackupReminder');
    if (reminder) reminder.hidden = !backup.warning;
    const pricesPill = doc.getElementById('overviewPrices');
    if (pricesPill) pricesPill.dataset.warning = String(['offline', 'timeout', 'changed', 'cancelled', 'storage-failed', 'recovery', 'unavailable'].includes(model.priceReport?.status)
        || Boolean(model.priceReport?.results?.some(result => result.status !== 'updated' && (!model.scope?.ids || !result.profileId || model.scope.ids.includes(result.profileId)))));
    set('overviewAssetTitle', members.length > 1 ? 'Euer Vermögen · Haushalt' : 'Dein Vermögen');
    set('overviewQuoteDate', overviewQuoteLabel(model));
    set('overviewAssets', Number.isFinite(model.household?.assets) ? formatDisplayNumber(model.household.assets, { fractionDigits: 0 }) : '—');
    const unit = doc.getElementById('overviewAssetUnit'); if (unit) unit.hidden = !Number.isFinite(model.household?.assets);
    const assetStatus = !model.available ? 'Profildaten nicht verfügbar' : !members.length ? 'Keine Haushaltsauswahl' : !model.complete ? 'Haushaltsbestand unvollständig' : '';
    set('overviewAssetStatus', assetStatus);
    const statusNode = doc.getElementById('overviewAssetStatus'); if (statusNode) statusNode.hidden = !assetStatus;
    const comparison = model.comparison;
    const period = model.annual?.retrospective ? `im Jahr ${model.annual.year}` : `seit Jahresanfang ${model.annual?.year || model.year}`;
    set('overviewComparison', Number.isFinite(comparison?.delta) ? `${comparison.delta > 0 ? '+' : ''}${money(comparison.delta)}${Number.isFinite(comparison.percent) ? ' · ' + formatDisplayNumber(comparison.percent, { unit: 'percent', fractionDigits: 1 }) : ''} · ${period}`
        : 'Veränderung erscheint nach dem ersten Jahresendstand');
    const allocation = doc.getElementById('overviewAllocation');
    const allocationView = model.household ? overviewAllocationView(model.household.allocation) : {};
    if (allocation) allocation.innerHTML = model.household?.assets > 0 ? Object.entries(allocationView).filter(([, value]) => value > 0).map(([key, value]) =>
        `<span class="overview-allocation-${key}" style="width:${value / model.household.assets * 100}%" title="${allocationNames[key]}: ${escapeHtml(money(value))}"></span>`).join('') : '';
    const legend = doc.getElementById('overviewLegend');
    if (legend) legend.innerHTML = model.household ? Object.entries(allocationView).filter(([, value]) => value > 0).map(([key, value]) =>
        `<span data-overview-allocation="${key}"><i class="overview-allocation-${key}"></i>${allocationNames[key]} ${Math.round(value / model.household.assets * 100)} %</span>`).join('') : '';
    const people = doc.getElementById('overviewPeople');
    if (people) people.innerHTML = members.map(person => {
        const initials = person.name.trim().split(/\s+/).slice(0, 2).map(part => part.slice(0, 1)).join('').toUpperCase();
        const details = [];
        if (Number.isFinite(person.personDates?.todayAge)) details.push(`${person.personDates.todayAge} Jahre`);
        if (person.personDates?.todayAgeStatus === 'fallback') details.push('Altalter, Geburtsdatum fehlt');
        if (Number.isFinite(person.values?.renteMonatlich)) details.push(`${money(person.values.renteMonatlich)} Rente / Monat`);
        return `<div class="overview-person" data-overview-person="${escapeHtml(person.id)}"><span class="overview-avatar" aria-hidden="true">${escapeHtml(initials)}</span><div>${escapeHtml(person.name)}<small>${escapeHtml(details.join(' · '))}</small></div><strong>${person.valid ? escapeHtml(money(person.assets)) : 'Bestand unvollständig'}</strong></div>`;
    }).join('');
    const summary = model.summary;
    const preview = Object.hasOwn(model, 'previewSummary') ? model.previewSummary : model.planComparison?.recordStatus === 'valid' ? null : summary;
    const planView = model.planComparison || projectHouseholdPlanComparison({ year: model.year, scope: null, preview });
    // Kennzahlen verwenden denselben Vergleich wie die vollständige Planansicht.
    // Kein zusätzlicher Speicherleser und keine eigene Budgetberechnung.
    const budgetRow = planView.rows.find(row => row.label === 'Monatsbudget');
    const fixed = planView.recordStatus === 'valid';
    const hasPreview = ['current', 'stale'].includes(planView.previewStatus);
    set('overviewBudgetValue', fixed ? budgetRow?.plan || '—' : hasPreview ? budgetRow?.preview || '—' : '—');
    set('overviewBudgetSource', fixed ? planView.planLabel
        : hasPreview ? `${planView.recordStatus === 'invalid' ? planView.notice + ' ' : ''}Vorschau · vorläufig · ${planView.previewNotice}`
            : planView.recordStatus === 'invalid' ? planView.notice : 'Noch kein passender Plan und keine Vorschau');
    set('overviewPlanMetricValue', fixed || hasPreview ? String(planView.year) : '—');
    set('overviewPlanMetricSource', fixed ? `${planView.planLabel}${planView.adjusted ? ' · bewusst angepasst' : ''}`
        : `${planView.notice}${hasPreview ? ' Vorschau · vorläufig' : ''}`);
    set('overviewPlanTitle', 'Dein Plan');
    set('overviewPlanStatus', planView.recordStatus === 'valid' ? 'festgeschrieben' : '');
    const badge = doc.getElementById('overviewPlanStatus'); if (badge) badge.hidden = planView.recordStatus !== 'valid';
    const comparisonHost = doc.getElementById('overviewPlanComparison');
    if (comparisonHost) {
        const origin = model.actionOrigin || projectBalanceActionOrigin({ comparison: planView, year: model.now.getFullYear(), scope: model.scope });
        comparisonHost.innerHTML = householdPlanComparisonHtml(planView) + actionOriginHtml(origin);
    }
    const rows = doc.getElementById('overviewPlanRows'); if (rows) rows.hidden = true;
    const empty = doc.getElementById('overviewPlanEmpty');
    if (empty) { empty.hidden = Boolean(comparisonHost); empty.textContent = planView.notice; }
    // Bestehende Anker bleiben für alte Direktverweise; sichtbar ist der gemeinsame Vergleich.
    set('overviewWithdrawal', summary ? (model.actionOrigin?.confirmed ? 'Beschlossener Plan: ' : 'Vorschau: ') + money(summary.monthlyWithdrawal) : '');
    set('overviewPlanBudget', summary ? `Monatsbudget mit festen Einkünften: ${money(summary.monthlyBudget)}` : '');
    set('overviewPlanAction', preview ? `Vorschau: ${preview.action?.verb || 'Handlung prüfen'} · vorläufig` : '');
    set('overviewPlanNote', summary?.action?.note || '');
    set('overviewLiquidity', summary ? overviewLiquidityText(summary) : '');
    set('overviewLiquidityNote', summary ? 'Rechenergebnis vorher / nachher; keine Ausführung unterstellt' : '');
    set('overviewMarket', summary?.marketPhase || '');
    set('overviewPlanTime', summary ? `Gerechnet am ${new Date(summary.createdAt).toLocaleString('de-DE')}` : '');
    renderOverviewFocus(doc, model);
    const first = Boolean(model.firstStart);
    for (const id of ['overviewNormal', 'overviewYearBand', 'overviewMonthStatus']) {
        const node = doc.getElementById(id); if (node) node.hidden = first;
    }
    const welcome = doc.getElementById('overviewWelcome'); if (welcome) welcome.hidden = !first;
    if (first) {
        set('overviewTitle', 'Plane deinen Ruhestand Jahr für Jahr.');
        set('overviewLead', 'Die Suite zeigt, was dir monatlich zur Verfügung steht und was als Nächstes zu tun ist. Deine Daten bleiben auf diesem Rechner.');
    }
    renderOverviewYear(doc, model);
    renderOverviewHistory(doc, model);
}

function renderYearMonth(month, year, maximum, budget) {
    const name = calendarMonth(year, month.month);
    const labels = { complete: 'vollständig', partial: 'unvollständig', missing: 'Import fehlt', open: 'noch offen' };
    const detail = `${name}: ${labels[month.state]}${month.spent === null ? '' : ' · ' + money(month.spent)}${month.overBudget ? ' · über Budget' : ''}`;
    const height = month.spent === null ? 0 : Math.max(2, month.spent / maximum * 100);
    return `<div class="overview-year-month" data-overview-year-month="${month.month}" data-state="${month.state}" title="${escapeHtml(detail)}">
        <div class="overview-bar-space">${budget === null ? '' : `<i class="overview-budget-line" style="bottom:${budget / maximum * 100}%" aria-hidden="true"></i>`}<span class="overview-month-bar${month.overBudget ? ' is-over' : ''}" style="height:${height}%" aria-hidden="true"></span></div>
        <b>${escapeHtml(name.slice(0, 3))}</b>
        <span class="ds-sr-only">${escapeHtml(detail)}</span></div>`;
}

function renderYearMetric(label, value, detail) {
    return `<div class="overview-year-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

/** Gespeicherte Monatswerte und vier Kennzahlen; keine Engine- oder Storageaufrufe. */
export function renderOverviewYear(doc, model) {
    const annual = model.annual;
    doc.getElementById('overviewYearExpensesLink')?.setAttribute('href', expensesHref({ year: annual?.year ?? null }));
    const set = (id, text) => { const node = doc.getElementById(id); if (node) node.textContent = text; };
    const chart = doc.getElementById('overviewYearChart'), metrics = doc.getElementById('overviewYearMetrics');
    if (!annual) {
        set('overviewYearNote', 'Die Jahresausgaben sind noch nicht verfügbar.');
        set('overviewYearStand', '');
        set('overviewYearBudget', '');
        for (const id of ['overviewYearStand', 'overviewYearBudget']) { const node = doc.getElementById(id); if (node) node.hidden = true; }
        const legend = doc.getElementById('overviewYearLegend'); if (legend) legend.innerHTML = '';
        if (chart) chart.innerHTML = '';
        if (metrics) metrics.innerHTML = '';
        return;
    }
    set('overviewYearTitle', `${annual.year}${annual.retrospective ? ' im Rückblick' : ' bisher'}`);
    const partial = annual.complete ? 'Alle abgeschlossenen Monate vollständig.' : 'Für einige Monate fehlen noch Ausgaben. Fehlende Imports bedeuten nicht, dass nichts ausgegeben wurde.';
    set('overviewYearNote', `${annual.retrospective ? 'Ausgaben je Monat' : 'Ausgaben bis einschließlich Vormonat'} · ${partial}`);
    set('overviewYearStand', annual.budget === null ? `Noch kein Budget für ${annual.year} – erscheint nach der ersten Balance-Rechnung.` : '');
    const yearHint = doc.getElementById('overviewYearStand'); if (yearHint) yearHint.hidden = annual.budget !== null;
    set('overviewYearBudget', annual.budget === null ? '' : `Monatsbudget ${money(annual.budget)}`);
    const budgetLabel = doc.getElementById('overviewYearBudget'); if (budgetLabel) budgetLabel.hidden = annual.budget === null;
    const legend = doc.getElementById('overviewYearLegend');
    if (legend) legend.innerHTML = [
        ['complete', annual.budget === null ? 'Ausgaben' : 'Im Budget'], ...(annual.budget === null ? [] : [['over', 'Über Budget']]),
        ['partial', 'Teilweise'], ['open', 'Offen'], ['missing', 'Import fehlt']
    ].map(([state, label]) => `<span><i class="overview-year-key is-${state}" aria-hidden="true"></i>${label}</span>`).join('');
    const maximum = Math.max(1, annual.budget || 0, ...annual.months.map(month => month.spent || 0)) * 1.15;
    if (budgetLabel && annual.budget !== null) budgetLabel.style.top = `calc(150px * ${1 - annual.budget / maximum})`;
    if (chart) chart.innerHTML = annual.months.map(month => renderYearMonth(month, annual.year, maximum, annual.budget)).join('');
    const comparison = annual.comparison;
    const wealthValue = Number.isFinite(comparison?.delta) ? money(comparison.delta) : '';
    const wealthDetail = Number.isFinite(comparison?.delta) ? `${annual.retrospective ? 'im Jahr' : 'seit Jahresanfang'} ${annual.year}${Number.isFinite(comparison.percent) ? ' · ' + formatDisplayNumber(comparison.percent, { unit: 'percent', fractionDigits: 1 }) : ''}`
        : 'erscheint nach dem ersten Jahresendstand';
    const sumDetail = annual.budgetPercent === null ? 'noch ohne Budget' : `${Math.round(annual.budgetPercent)} % des ${annual.retrospective ? 'Jahresbudgets' : 'Budgets bis Vormonat'}`;
    const highest = annual.highest ? `Höchster: ${calendarMonth(annual.year, annual.highest.month)} · ${money(annual.highest.spent)}` : 'Kein importierter Monat';
    const rows = annual.retrospective ? [
        ['Ausgaben', money(annual.total), sumDetail + (annual.complete ? '' : ' · unvollständig')],
        ['Vermögen', wealthValue, wealthDetail],
        ['Monate über Budget', annual.overBudgetCount === null ? '—' : `${annual.overBudgetCount} von ${annual.lastMonth}${annual.complete ? '' : ' · unvollständig'}`, highest + (annual.budget === null ? ' · noch ohne Budget' : '')],
        ['Verkäufe', Number.isFinite(annual.sales?.count) ? String(annual.sales.count) : '—', Number.isFinite(annual.sales?.net) ? `${money(annual.sales.net)} netto ins Tagesgeld${annual.sales.unconfirmed ? ' · ' + annual.sales.unconfirmed + ' unbestätigt' : ''}` : 'Verkaufsnachweise nicht verfügbar']
    ] : [
        ['Ausgaben bis Vormonat', money(annual.total), annual.complete ? sumDetail : 'Es fehlen noch Ausgaben · ' + sumDetail],
        ['Hochrechnung', money(annual.forecast), annual.forecast === null ? 'Noch nicht genug vollständige Monate' : `aus den bisherigen Monaten hochgerechnet${annual.forecastIncomplete ? ' · unvollständig' : ''}`],
        ['Vermögen', wealthValue, wealthDetail],
        ['Jahresabschluss', 'Januar', `in ${annual.weeksToJanuary} Wochen · vorgesehener Abschlusszeitraum`]
    ];
    if (metrics) metrics.innerHTML = rows.map(row => renderYearMetric(...row)).join('');
}

const calendarMonth = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
const expensesLink = (target, year, month) => 'Ausgaben.html?year=' + year + (month ? '&month=' + month : '') + '#' + target;
const focusLink = (href, label, primary = false) => '<a class="ds-button ' + (primary ? 'ds-button-primary' : 'ds-button-secondary')
    + '" href="' + escapeHtml(href) + '" data-profile-handoff>' + escapeHtml(label) + '</a>';
const focusStep = (number, title, detail, action, done = false, warning = false) =>
    '<div class="overview-step' + (done ? ' is-done' : '') + '"><span class="overview-step-symbol' + (warning ? ' is-warning' : '')
    + '" aria-label="' + (done ? 'erledigt' : 'Schritt ' + number) + '">' + (done ? '✓' : number)
    + '</span><div><div class="overview-step-title">' + escapeHtml(title) + '</div><div class="overview-step-detail">'
    + escapeHtml(detail) + '</div></div>' + (done ? '<span class="ds-badge">erledigt</span>' : action) + '</div>';

function renderFocusTitle(title) {
    return `<h2 id="overviewFocusTitle" tabindex="-1">${escapeHtml(title)}</h2>`;
}

function renderFocusMonthButton() {
    return '<button type="button" class="ds-button ds-button-primary" data-overview-month data-overview-month-confirm>Abschluss starten</button>';
}

function renderFocusAnnualButton(state) {
    const label = { open: 'Abschluss starten', unclear: 'Jahresstatus klären', recovery: 'Wiederherstellung öffnen', unavailable: 'Daten prüfen' }[state];
    return `<button type="button" class="ds-button ds-button-primary" data-overview-annual>${escapeHtml(label)}</button>`;
}

function renderFocusBackupButton() {
    return '<button type="button" class="ds-button ds-button-secondary" data-overview-backup>Jetzt sichern</button>';
}

function renderFocusCompleted(steps, row, open) {
    return `<details class="overview-completed" data-overview-completed=""${open ? ' open' : ''}><summary>Erledigt (${steps.length})</summary>${steps.map(row).join('')}</details>`;
}

export function overviewLiquidityText(summary) {
    const pct = value => formatDisplayNumber(value, { unit: 'percent', fractionDigits: 1 });
    const before = summary.liquidityBefore, after = summary.liquidityAfter;
    if (Number.isFinite(before)) {
        if (Number.isFinite(after) && (Math.abs(before - after) > .1 || summary.actionBasis?.material)) return `${pct(before)} heute · ${pct(after)} nach Umsetzung`;
        return `${pct(before)} des Ziels`;
    }
    const planned = Number.isFinite(after) ? after : summary.liquidityCoverage;
    return Number.isFinite(planned) ? `Heute unbekannt · ${pct(planned)} nach Umsetzung` : 'Noch nicht verfügbar';
}

function annualFocusText(model) {
    const { annualState, annualReason, closingYear, planningYear } = model.occasion;
    const unclearDetail = annualReason === 'contradictory_metadata'
        ? `Die Abschlussvermerke für ${closingYear} widersprechen sich. Bitte den Jahresstatus in der Balance prüfen.`
        : annualReason === 'invalid_evidence'
            ? `Gespeicherte Belege für ${closingYear} sind beschädigt. Bitte die Daten in der Balance prüfen.`
            : `Für ${closingYear} gibt es Daten, aber keinen Abschlussvermerk. Bitte den Jahresstatus im Abschlussdialog einmal bestätigen.`;
    return {
        open: {
            title: `${calendarMonth(model.occasion.previousYear, model.occasion.previousMonth)} und Jahr ${closingYear} abschließen`,
            lead: (todaysPricesConfirmed(model) ? 'Die Kurse sind von heute. ' : '') + `Schließ ${closingYear} ab – danach steht fest, was dir ${planningYear} monatlich zur Verfügung steht und was zu tun ist.`,
            stepTitle: `Jahr ${closingYear} abschließen`,
            stepDetail: `Inflation, ETF-Schlusskurs und Alter holen, prüfen, abschließen. Danach stehen Monatsbetrag und Handlungsanweisung für ${planningYear} fest.`
        },
        unclear: {
            title: `Jahresstatus ${closingYear} klären.`,
            lead: unclearDetail,
            stepTitle: 'Jahresstatus klären',
            stepDetail: unclearDetail
        },
        recovery: {
            title: `Wiederherstellung für den Jahresabschluss ${closingYear} nötig.`,
            lead: 'Der Jahresabschluss ist unvollständig. Prüfe zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung.',
            stepTitle: 'Wiederherstellung öffnen',
            stepDetail: 'Der Jahresabschluss ist unvollständig. Prüfe zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung.'
        },
        unavailable: {
            title: `Daten für den Jahresabschluss ${closingYear} fehlen.`,
            lead: 'Die Profildaten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.',
            stepTitle: 'Daten prüfen',
            stepDetail: 'Die Profildaten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.'
        }
    }[annualState];
}

/** Genaue Personenmonate bleiben im Modell; hier höchstens eine kurze Zusammenfassung. */
function focusExpenseDetail(model, annual) {
    const expenses = model.expenses;
    if (expenses?.beforePlanning) return `Dieser Monat liegt vor dem Planungsbeginn ${model.firstPlanningYear}. Kein Import nötig.`;
    if (expenses?.complete) return 'Alle Personen sind importiert · ' + money(expenses.spent);
    const records = annual && expenses?.missingMonths ? expenses.missingMonths
        : (expenses?.rows || []).filter(row => !row.present).map(row => ({ id: row.id, month: expenses.month }));
    if (!records.length) return 'Ausgabenstand nicht verfügbar.';
    const groups = new Map();
    for (const row of records) {
        if (!groups.has(row.id)) groups.set(row.id, new Set());
        groups.get(row.id).add(row.month);
    }
    const entries = [...groups].map(([id, months]) => ({ id, months: [...months].sort((a, b) => a - b) }));
    const name = id => {
        const full = model.members?.find(person => person.id === id)?.name || id;
        return full.length > 32 ? full.slice(0, 31) + '…' : full;
    };
    const first = entries[0].months;
    const identical = entries.every(entry => entry.months.join(',') === first.join(','));
    const contiguous = first.every((month, index) => index === 0 || month === first[index - 1] + 1);
    let detail;
    if (entries.length <= 2 && identical && contiguous) {
        const start = calendarMonth(expenses.year, first[0]);
        const range = first.length === 1 ? start : start + '–' + calendarMonth(expenses.year, first.at(-1));
        detail = entries.length === 1 ? `${name(entries[0].id)}: ${first.length === 1 ? range + ' fehlt.' : first.length + ' Monate (' + range + ') fehlen.'}`
            : `Für beide Personen ${first.length === 1 ? 'fehlt ' + range : 'fehlen ' + first.length + ' Monate (' + range + ')'}.`;
    } else if (entries.length <= 2) {
        detail = entries.map(entry => `${name(entry.id)}: ${entry.months.length} ${entry.months.length === 1 ? 'Monat' : 'Monate'}`).join(', ')
            + ' fehlen. Details im Import.';
    } else {
        detail = `Bei ${entries.length} Personen fehlen Ausgaben für insgesamt ${entries.reduce((sum, entry) => sum + entry.months.length, 0)} Monate. Details im Import.`;
    }
    return detail + (annual ? ' Der Abschluss geht trotzdem.' : ' CSV aus dem Bankkonto importieren.');
}

/** Datenhaken sind Anzeigen. Nur die ausdrücklich bestätigte Bereitstellung schreibt. */
export function renderOverviewFocus(doc, model) {
    const host = doc.getElementById('overviewFocus');
    if (!host || !model.occasion) return;
    const occasion = model.occasion, annual = occasion.kind === 'annual', play = ['play', 'start'].includes(occasion.kind);
    const firstYear = occasion.kind === 'start';
    const grid = doc.getElementById('overviewNormal');
    if (grid && host.parentNode === grid) {
        if (grid.children[0] !== host) grid.insertBefore(host, grid.children[0]);
        grid.dataset.occasion = occasion.kind;
    }
    const open = model.nextSteps || deriveBalanceNextSteps({ occasion, expenses: model.expenses, monthlyWithdrawal: model.summary?.monthlyWithdrawal });
    const annualText = annual ? annualFocusText(model) : null;
    const previousName = calendarMonth(occasion.previousYear, occasion.previousMonth);
    const titleNode = doc.getElementById('overviewTitle'), lead = doc.getElementById('overviewLead');
    if (titleNode) titleNode.textContent = annual ? annualText.title
        : play ? open.length === 0 ? 'Alles erledigt bis zum Monatsanfang.' : open.length === 1 ? 'Ein Schritt offen: ' + open[0].title : `${open.length} Schritte offen` : `Monatsabschluss ${previousName}.`;
    if (lead) lead.textContent = firstYear ? `Erstes Planungsjahr ${occasion.firstPlanningYear} · erster Jahresabschluss Anfang ${occasion.firstPlanningYear + 1}.` : annual ? annualText.lead
        : play ? previousName + ' ist abgeschlossen' + (todaysPricesConfirmed(model) ? ', die Kurse sind von heute.' : '.')
            : 'Vier kurze Schritte, dann ist der Monat erledigt. Danach siehst du, wie das Jahr bisher läuft.';
    if (open.length && lead && !(annual && occasion.annualState === 'open')) lead.innerHTML = (play && !firstYear ? '' : escapeHtml(lead.textContent) + ' ') + open.map(step => `<a href="${escapeHtml(expensesDestination(step.href))}" data-profile-handoff data-next-step="${escapeHtml(step.id)}">${escapeHtml(step.title)}</a>`).join(' · ');
    const next = new Date(model.now.getFullYear(), model.now.getMonth() + 1, 1).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
    const warnings = (occasion.kind === 'monthly' ? [] : model.cashWarnings || []).map(person =>
        `<p class="overview-cash-warning" data-tagesgeld-warning="${escapeHtml(person.id)}">${escapeHtml(person.name)}: Tagesgeld zuletzt am ${escapeHtml(cashDateDisplay(person.date))} aktualisiert · <a class="overview-card-link" href="depot-tranchen-manager.html?person=${encodeURIComponent(person.id)}#profileTagesgeld" data-profile-handoff>Tagesgeld prüfen</a></p>`).join('');
    if (play) {
        host.className = 'overview-reminders';
        host.removeAttribute('aria-labelledby');
        host.innerHTML = '<p class="overview-muted">Nächster Monatsabschluss: ' + next + ' · Jahresabschluss: Januar.</p>' + warnings;
        return;
    }
    const title = annual ? occasion.annualState === 'open' ? previousName + ' und Jahr ' + occasion.closingYear + ' abschließen' : previousName + ' · Jahresstatus ' + occasion.closingYear : previousName + ' abschließen';
    const why = annual ? occasion.annualState === 'recovery' ? 'Jahresabschluss unvollständig. Zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung prüfen.'
            : occasion.annualState === 'unclear' ? annualText.stepDetail
                : occasion.annualState === 'unavailable' ? 'Die Daten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.'
                : 'Bis dahin gelten Monatsbetrag und Handlungsanweisung als vorläufig.'
            : 'Nach dem Import hält die App den Vermögensstand automatisch fest, wenn die Kurse frisch sind.';
    host.setAttribute('aria-labelledby', 'overviewFocusTitle');
    const icon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="'
        + 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' + '"/></svg>';
    const header = '<header class="overview-focus-top"><span class="overview-focus-icon">' + icon + '</span><div><div class="overview-card-heading"><span class="overview-muted">'
        + (annual ? model.now.getMonth() === 0 ? 'Zum Jahresanfang' : 'Zum Monatsanfang' : 'Zum Monatsanfang') + '</span><span class="ds-badge' + (annual && occasion.annualState === 'open' ? ' overview-year-badge' : '') + '">'
        + (annual ? { open: 'mit Jahresabschluss', unclear: 'Klärung nötig', recovery: 'Wiederherstellung nötig', unavailable: 'Daten fehlen' }[occasion.annualState] : 'offen') + '</span></div>' + renderFocusTitle(title)
        + '<p class="overview-focus-why">' + escapeHtml(why) + '</p></div>'
        + (annual ? renderFocusAnnualButton(occasion.annualState) : renderFocusMonthButton()) + '</header>';
    const steps = projectOverviewMonthSteps(model);
    const closeSteps = annual ? [...steps.slice(0, 3),
        { id: 'cash', title: 'Tagesgeld', state: 'open' }, { id: 'market', title: 'Marktdaten', state: 'open' },
        { id: 'plan', title: 'Plan ' + occasion.planningYear, state: 'open' }, { id: 'month', title: 'Monatsbetrag', state: 'open' }] : steps;
    const row = step => `<div class="overview-close-step${annual && ['market', 'plan'].includes(step.id) ? ' overview-year-step' : ''}" data-overview-close-step="${step.id}" data-state="${step.state}"><span aria-hidden="true">${step.state === 'done' ? '✓' : '○'}</span><b>${escapeHtml(step.title)}</b><span class="overview-step-detail">${escapeHtml(step.id === 'expenses' && model.members?.length > 4 && !step.done ? `Ausgaben fehlen noch · ${model.members.length} Personen` : step.result || 'Wird im Jahresdialog geprüft.')}</span></div>`;
    const completed = closeSteps.filter(step => step.state === 'done');
    const wasOpen = host.querySelector?.('[data-overview-completed]')?.open;
    let content = '<div class="overview-close-steps">' + closeSteps.filter(step => step.state !== 'done').map(row).join('') + '</div>'
        + (completed.length ? renderFocusCompleted(completed, row, wasOpen) : '');
    if (annual && occasion.annualState !== 'open') {
        content += '<p>' + escapeHtml(steps[0].result) + '</p>' + focusLink('#kursdetails', 'Details ansehen');
        content += '<p class="overview-expense-detail">' + escapeHtml(focusExpenseDetail(model, true)) + '</p>' + focusLink(expensesLink('ausgaben-import', model.expenses?.year || occasion.previousYear, model.expenses?.missingMonths?.[0]?.month || model.expenses?.month || occasion.previousMonth), 'Import öffnen');
        content += '<p class="overview-year-action"><b class="overview-step-title">' + escapeHtml(annualText.stepTitle) + '</b><span class="overview-step-detail">' + escapeHtml(annualText.stepDetail) + '</span></p>' + renderFocusBackupButton();
        if (model.exampleExpensesAllowed) content += renderOverviewExampleActions(model);
    }
    content += '<footer class="overview-focus-foot"><span class="overview-muted">Rund ' + (annual ? '10' : '5') + ' Minuten · Nächster Monatsabschluss: ' + next + '.</span></footer>';
    host.className = 'ds-card overview-focus' + (annual ? ' is-annual' : '');
    host.innerHTML = header + content + warnings;
}

/** Tatsächlicher Recoveryrenderer; kein Write und keine zusätzliche Importsperre. */
export function renderOverviewPersistenceRecovery(doc, warning) {
    const host = doc.getElementById('overviewPersistenceRecovery');
    if (!host || !warning) return null;
    const banner = doc.createElement('div');
    banner.className = 'recovery-banner ds-note ds-note-warning';
    const title = doc.createElement('div'); title.className = 'recovery-title';
    title.textContent = 'Speicher-Wiederherstellung (Recovery-Modus)'; banner.appendChild(title);
    const message = doc.createElement('div'); message.className = 'recovery-message';
    message.textContent = warning.message + (warning.quarantinePath ? ` (Sicherungsdatei unter: ${warning.quarantinePath})` : '');
    banner.appendChild(message);
    const actions = doc.createElement('div'); actions.className = 'recovery-actions';
    const importButton = doc.createElement('button'); importButton.type = 'button';
    importButton.className = 'profile-button ds-button ds-button-primary'; importButton.textContent = 'Backup importieren';
    importButton.addEventListener('click', () => {
        openOverviewBackupTarget(doc, '#fullBackupImportBtn');
    });
    const dismissButton = doc.createElement('button'); dismissButton.type = 'button';
    dismissButton.className = 'profile-button secondary ds-button ds-button-secondary'; dismissButton.textContent = 'Schließen';
    dismissButton.addEventListener('click', () => { banner.style.display = 'none'; });
    actions.appendChild(importButton); actions.appendChild(dismissButton); banner.appendChild(actions); host.appendChild(banner);
    return banner;
}

/** Kurzlebiger echter Link durchläuft den gemeinsamen Handoff samt Flush und Guard. */
export function openOverviewBackupTarget(doc, target = '#daten-sicherung') {
    const link = doc.createElement('a'); link.setAttribute('href', 'Daten-Sicherung.html' + target);
    link.setAttribute('data-profile-handoff', ''); link.setAttribute('data-profile-handoff-export', 'false');
    link.hidden = true; doc.body.appendChild(link); link.click(); link.remove();
}

const boundTargetDocuments = new WeakSet();

export function bindOverviewBackupTargets(doc, win = doc.defaultView) {
    if (boundTargetDocuments.has(doc)) return;
    boundTargetDocuments.add(doc);
    const openPrices = () => {
        const card = doc.getElementById('kursdetails');
        if (card) { card.open = true; card.querySelector?.('summary')?.focus(); }
    };
    let lastHash;
    const open = () => {
        const hash = win?.location.hash;
        if (hash === lastHash) return;
        lastHash = hash;
        if (!['#daten-sicherung', '#fullBackupImportBtn', '#kursdetails', '#probelaufControls'].includes(win?.location.hash)) return;
        if (win.location.hash === '#kursdetails') { openPrices(); return; }
        if (win.location.hash === '#probelaufControls') { requestProbelaufStart(doc); return; }
        const target = win.location.hash === '#fullBackupImportBtn' ? 'fullBackupImportBtn' : 'fullBackupBtn';
        openOverviewBackupTarget(doc, '#' + target);
    };

    doc.getElementById('overviewWelcomeImport')?.addEventListener('click', () => { openOverviewBackupTarget(doc, '#fullBackupImportBtn'); });
    doc.getElementById('overviewPrices')?.addEventListener('click', openPrices);
    doc.getElementById('overviewFocus')?.addEventListener('click', event => {
        if (event.target.closest('a[href="#kursdetails"]')) openPrices();
    });
    win?.addEventListener('hashchange', open); open();
}

export function renderOverviewExampleActions(model = {}) {
    const personName = model.members?.length === 1 ? model.members[0].name || model.members[0].id : 'Person auswählen';
    const oneLabel = escapeHtml(exampleExpensesLabel(model, personName));
    const allLabel = escapeHtml(exampleExpensesLabel(model));
    return `<button type="button" class="ds-button ds-button-secondary ds-icon-button" title="${oneLabel}" aria-label="${oneLabel}" data-overview-example="one" data-overview-example-annual>${EXAMPLE_EXPENSES_ICON_HTML}</button><button type="button" class="ds-button ds-button-secondary" title="${allLabel}" aria-label="${allLabel}" data-overview-example="all" data-overview-example-annual>${EXAMPLE_EXPENSES_ICON_HTML}<span>Beispiele für alle</span></button><p id="overviewExampleExpensesStatus" role="status"></p>`;
}
