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
import { getAppTestDate } from '../shared/app-clock.js';
import { renderProbelaufPriceInfo } from '../shared/probelauf-price-ui.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const allocationNames = { aktien: 'Aktien', anleihe: 'Anleihen', geldmarkt: 'Geldmarkt', gold: 'Gold', cash: 'Tagesgeld' };
const displayDate = date => date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Jahresgrenzstände sind eine andere Quelle als die Tageskurve. Schema 1
// belegt den damaligen Personen-/Haushaltsumfang nicht; kein Zukunftsversprechen.
function wealthComparisonBasis(comparison, year, retrospective = false) {
    if (Number.isFinite(comparison?.delta)) return `${retrospective ? `im Jahr ${year} · ` : ''}seit Jahresendstand ${year - 1}`;
    return comparison?.reason === 'Kein vollständiger Stand an den Jahresgrenzen'
        ? `Kein vollständiger Jahresgrenzstand für ${year}` : `Jahresendvergleich ${year - 1} nicht belegbar`;
}

function actionOriginHtml(origin) {
    return `<p class="ds-source" data-action-origin>${escapeHtml(origin.label)} · ${escapeHtml(origin.previewLabel)} · <a href="Balance.html#handlungsanweisung" data-profile-handoff>Handlungsanzeige in Balance →</a></p>`;
}

// Ein brauchbarer gespeicherter Kursstand belegt keinen heutigen Abruf.
// Die fachliche Frischeprüfung bleibt für Rechen- und Abschlussschritte unverändert.
function todaysPricesConfirmed(model) {
    if (getAppTestDate() !== null) return false;
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
    set('overviewQuoteDate', `Bestand am ${displayDate(model.now)} · ${overviewQuoteLabel(model)}`);
    set('overviewAssets', Number.isFinite(model.household?.assets) ? formatDisplayNumber(model.household.assets, { fractionDigits: 0 }) : '—');
    const unit = doc.getElementById('overviewAssetUnit'); if (unit) unit.hidden = !Number.isFinite(model.household?.assets);
    const assetStatus = !model.available ? 'Profildaten nicht verfügbar' : !members.length ? 'Keine Haushaltsauswahl' : !model.complete ? 'Haushaltsbestand unvollständig' : '';
    set('overviewAssetStatus', assetStatus);
    const statusNode = doc.getElementById('overviewAssetStatus'); if (statusNode) statusNode.hidden = !assetStatus;
    const assetBasis = doc.getElementById('overviewAssetBasis'); if (assetBasis) assetBasis.hidden = Boolean(assetStatus);
    const comparison = model.comparison;
    const period = wealthComparisonBasis(comparison, model.annual?.year || model.year, model.annual?.retrospective);
    set('overviewComparison', Number.isFinite(comparison?.delta) ? `${comparison.delta > 0 ? '+' : ''}${money(comparison.delta)}${Number.isFinite(comparison.percent) ? ' · ' + formatDisplayNumber(comparison.percent, { unit: 'percent', fractionDigits: 1 }) : ''} · ${period}`
        : period);
    set('overviewPeopleStand', `Bestände und Alter am ${displayDate(model.now)} · Rente: erfasster Monatsbetrag`);
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
    const stalePreview = planView.previewStatus === 'stale';
    const previewDate = new Date(preview?.createdAt ?? NaN);
    const previewTime = Number.isFinite(previewDate.getTime()) ? `gerechnet am ${displayDate(previewDate)}` : 'Rechendatum unbekannt';
    set('overviewBudgetTitle', fixed || !hasPreview ? 'Monatsbudget' : 'Vorläufiges Monatsbudget');
    set('overviewBudgetValue', fixed ? budgetRow?.plan || '—' : hasPreview ? budgetRow?.preview || '—' : '—');
    set('overviewBudgetSource', fixed ? planView.planLabel
        : planView.recordStatus === 'invalid' ? 'Jahresbeleg beschädigt · Sicherung prüfen'
            : hasPreview ? `Für ${planView.year} · ${previewTime} · ${stalePreview ? 'Vorschau veraltet' : 'Jahresabschluss-Vorschau'}`
                : `Für ${planView.year} in Balance rechnen`);
    set('overviewBudgetLink', fixed ? 'Budget in Balance ansehen →'
        : planView.recordStatus === 'invalid' ? 'Sicherung prüfen →'
            : hasPreview && !stalePreview ? 'Vorschau in Balance ansehen →' : 'Vorschau in Balance rechnen →');
    doc.getElementById('overviewBudgetLink')?.setAttribute('href', planView.recordStatus === 'invalid' ? 'Daten-Sicherung.html' : 'Balance.html');
    set('overviewPlanMetricValue', fixed ? 'Plan festgeschrieben' : planView.recordStatus === 'invalid' ? 'Planbeleg prüfen' : 'Noch kein Jahresplan');
    set('overviewPlanMetricYear', String(planView.year));
    set('overviewPlanMetricSource', fixed ? planView.adjusted ? 'Im Jahresabschluss bewusst angepasst' : 'Im Jahresabschluss beschlossen'
        : planView.recordStatus === 'invalid' ? 'Jahresbeleg beschädigt · Sicherung prüfen'
            : hasPreview ? stalePreview ? 'Vorschau veraltet · noch vorläufig' : 'Vorschau vorhanden · noch vorläufig' : 'Entsteht im nächsten Jahresabschluss');
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
    renderProbelaufPriceInfo(doc);
}

function renderYearMonth(month, year, maximum, budget, budgetStatus) {
    const name = calendarMonth(year, month.month);
    const labels = { complete: 'vollständig', partial: 'unvollständig', missing: 'Import fehlt', open: 'noch offen' };
    const detail = `${name}: ${labels[month.state]}${month.spent === null ? '' : ' · ' + money(month.spent)}${month.overBudget ? ' · über Budget' : ''}`;
    const height = month.spent === null ? 0 : Math.max(2, month.spent / maximum * 100);
    return `<div class="overview-year-month" data-overview-year-month="${month.month}" data-state="${month.state}" title="${escapeHtml(detail)}">
        <div class="overview-bar-space">${budget === null ? '' : `<i class="overview-budget-line" data-budget-status="${budgetStatus}" style="bottom:${budget / maximum * 100}%" aria-hidden="true"></i>`}<span class="overview-month-bar${month.overBudget ? ' is-over' : ''}" style="height:${height}%" aria-hidden="true"></span></div>
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
    const provisional = annual.budgetStatus !== 'adopted';
    const budgetStatus = provisional ? 'provisional' : 'adopted';
    const budgetName = provisional ? 'Vorläufiges Monatsbudget' : 'Monatsbudget';
    const staleBudget = provisional && annual.budgetPreviewStatus !== 'current';
    set('overviewYearBudget', annual.budget === null ? '' : `${budgetName} ${money(annual.budget)} · ${annual.year}${staleBudget ? ' · Vorschau veraltet' : ''}`);
    const budgetLabel = doc.getElementById('overviewYearBudget'); if (budgetLabel) budgetLabel.hidden = annual.budget === null;
    const legend = doc.getElementById('overviewYearLegend');
    if (legend) legend.innerHTML = [
        ['complete', annual.budget === null ? 'Ausgaben' : 'Im Budget'], ...(annual.budget === null ? [] : [['over', 'Über Budget']]),
        ['partial', 'Teilweise'], ['open', 'Offen'], ['missing', 'Import fehlt']
    ].map(([state, label]) => `<span><i class="overview-year-key is-${state}" aria-hidden="true"></i>${label}</span>`).join('')
        + (annual.budget === null ? '' : `<span><i class="overview-year-budget-key" data-budget-status="${budgetStatus}" aria-hidden="true"></i>${budgetName}${staleBudget ? ' · Vorschau veraltet' : ''}</span>`);
    const maximum = Math.max(1, annual.budget || 0, ...annual.months.map(month => month.spent || 0)) * 1.15;
    if (budgetLabel && annual.budget !== null) budgetLabel.style.top = `calc(150px * ${1 - annual.budget / maximum})`;
    if (chart) chart.innerHTML = annual.months.map(month => renderYearMonth(month, annual.year, maximum, annual.budget, budgetStatus)).join('');
    const comparison = annual.comparison;
    const wealthValue = Number.isFinite(comparison?.delta) ? money(comparison.delta) : '';
    const wealthDetail = wealthComparisonBasis(comparison, annual.year, annual.retrospective)
        + (Number.isFinite(comparison?.percent) ? ' · ' + formatDisplayNumber(comparison.percent, { unit: 'percent', fractionDigits: 1 }) : '');
    const expensePeriod = annual.lastMonth ? `01.01.${annual.year} bis ${displayDate(new Date(annual.year, annual.lastMonth, 0))}` : `Noch kein abgeschlossener Monat ${annual.year}`;
    const sumDetail = annual.budgetPercent === null ? 'noch ohne Budget' : `${Math.round(annual.budgetPercent)} % des ${annual.retrospective ? 'Jahresbudgets' : 'Budgets bis Vormonat'}`;
    const highest = annual.highest ? `Höchster: ${calendarMonth(annual.year, annual.highest.month)} · ${money(annual.highest.spent)}` : 'Kein importierter Monat';
    const rows = annual.retrospective ? [
        ['Ausgaben', money(annual.total), `${expensePeriod} · ${sumDetail}${annual.complete ? '' : ' · unvollständig'}`],
        ['Vermögen', wealthValue, wealthDetail],
        ['Monate über Budget', annual.overBudgetCount === null ? '—' : `${annual.overBudgetCount} von ${annual.lastMonth}${annual.complete ? '' : ' · unvollständig'}`, `${expensePeriod} · ${highest}${annual.budget === null ? ' · noch ohne Budget' : ''}`],
        ['Verkäufe', Number.isFinite(annual.sales?.count) ? String(annual.sales.count) : '—', `Im Jahr ${annual.year} · ` + (Number.isFinite(annual.sales?.net) ? `${money(annual.sales.net)} netto ins Tagesgeld${annual.sales.unconfirmed ? ' · ' + annual.sales.unconfirmed + ' unbestätigt' : ''}` : 'Verkaufsnachweise nicht verfügbar')]
    ] : [
        ['Ausgaben bis Vormonat', money(annual.total), `${expensePeriod} · ${annual.complete ? sumDetail : 'Es fehlen noch Ausgaben · ' + sumDetail}`],
        ['Hochrechnung', money(annual.forecast), `Für ${annual.year} · ` + (annual.forecast === null ? 'Noch nicht genug vollständige Monate' : `aus ${expensePeriod}${annual.forecastIncomplete ? ' · unvollständig' : ''}`)],
        ['Vermögen', wealthValue, wealthDetail],
        ['Jahresabschluss', `Januar ${annual.year + 1}`, `für ${annual.year} · in ${annual.weeksToJanuary} Wochen`]
    ];
    if (metrics) metrics.innerHTML = rows.map(row => renderYearMetric(...row)).join('');
}

const calendarMonth = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
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
            title: `Jahresabschluss ${closingYear} wiederherstellen.`,
            lead: 'Der Jahresabschluss ist unvollständig. Prüfe zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung.',
            stepTitle: 'Wiederherstellung öffnen',
            stepDetail: 'Der Jahresabschluss ist unvollständig. Prüfe zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung.'
        },
        unavailable: {
            title: `Daten für ${closingYear} prüfen.`,
            lead: 'Die Profildaten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.',
            stepTitle: 'Daten prüfen',
            stepDetail: 'Die Profildaten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.'
        }
    }[annualState];
}

/** Datenhaken sind Anzeigen. Nur die ausdrücklich bestätigte Bereitstellung schreibt. */
export function renderOverviewFocus(doc, model) {
    const host = doc.getElementById('overviewFocus');
    if (!host || !model.occasion) return;
    const occasion = model.occasion, annual = occasion.kind === 'annual', play = ['play', 'start'].includes(occasion.kind);
    const annualStatus = annual && ['unclear', 'recovery', 'unavailable'].includes(occasion.annualState);
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
    if (lead) lead.textContent = firstYear ? `Erstes Planungsjahr ${occasion.firstPlanningYear} · erster Jahresabschluss Anfang ${occasion.firstPlanningYear + 1}.` : annualStatus ? 'Prüfe zuerst den Jahresstatus in der Karte unten.' : annual ? annualText.lead
        : play ? previousName + ' ist abgeschlossen' + (todaysPricesConfirmed(model) ? ', die Kurse sind von heute.' : '.')
            : 'Vier kurze Schritte, dann ist der Monat erledigt. Danach siehst du, wie das Jahr bisher läuft.';
    if (open.length && lead && !annual) lead.innerHTML = (play && !firstYear ? '' : escapeHtml(lead.textContent) + ' ') + open.map(step => `<a href="${escapeHtml(expensesDestination(step.href))}" data-profile-handoff data-next-step="${escapeHtml(step.id)}">${escapeHtml(step.title)}</a>`).join(' · ');
    const next = new Date(model.now.getFullYear(), model.now.getMonth() + 1, 1).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
    const warnings = (occasion.kind === 'monthly' ? [] : model.cashWarnings || []).map(person =>
        `<p class="overview-cash-warning" data-tagesgeld-warning="${escapeHtml(person.id)}">${escapeHtml(person.name)}: Tagesgeld zuletzt am ${escapeHtml(cashDateDisplay(person.date))} aktualisiert · <a class="overview-card-link" href="depot-tranchen-manager.html?person=${encodeURIComponent(person.id)}#profileTagesgeld" data-profile-handoff>Tagesgeld prüfen</a></p>`).join('');
    if (play) {
        host.className = 'overview-reminders';
        host.removeAttribute('aria-labelledby');
        host.innerHTML = '<p class="overview-muted">Nächster Monatsabschluss: ' + next + ' · Jahresabschluss: Januar.</p>' + warnings;
        return;
    }
    const title = annualStatus ? annualText.title.replace(/\.$/, '') : annual ? previousName + ' und Jahr ' + occasion.closingYear + ' abschließen' : previousName + ' abschließen';
    const why = annualStatus ? annualText.lead : annual ? 'Bis dahin gelten Monatsbetrag und Handlungsanweisung als vorläufig.'
            : 'Nach dem Import hält die App den Vermögensstand automatisch fest, wenn die Kurse frisch sind.';
    host.setAttribute('aria-labelledby', 'overviewFocusTitle');
    const icon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="'
        + 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' + '"/></svg>';
    const header = '<header class="overview-focus-top"><span class="overview-focus-icon">' + icon + '</span><div><div class="overview-card-heading"><span class="overview-muted">'
        + (annualStatus ? 'Jahresstatus' : annual ? model.now.getMonth() === 0 ? 'Zum Jahresanfang' : 'Zum Monatsanfang' : 'Zum Monatsanfang') + '</span><span class="ds-badge' + (annual && occasion.annualState === 'open' ? ' overview-year-badge' : '') + '">'
        + (annual ? { open: 'mit Jahresabschluss', unclear: 'Klärung nötig', recovery: 'Wiederherstellung nötig', unavailable: 'Daten fehlen' }[occasion.annualState] : 'offen') + '</span></div>' + renderFocusTitle(title)
        + '<p class="overview-focus-why">' + escapeHtml(why) + '</p></div>'
        + (annual ? renderFocusAnnualButton(occasion.annualState) : renderFocusMonthButton()) + '</header>';
    if (annualStatus) {
        host.className = 'ds-card overview-focus is-annual';
        host.innerHTML = header + '<div class="overview-annual-status-actions"><span class="overview-muted">Vorher eine Vollsicherung erstellen.</span>' + renderFocusBackupButton() + '</div>' + warnings;
        return;
    }
    const steps = projectOverviewMonthSteps(model);
    const closeSteps = annual ? [...steps.slice(0, 3),
        { id: 'cash', title: 'Tagesgeld', state: 'open' }, { id: 'market', title: 'Marktdaten', state: 'open' },
        { id: 'plan', title: 'Plan ' + occasion.planningYear, state: 'open' }, { id: 'month', title: 'Monatsbetrag', state: 'open' }] : steps;
    const row = step => `<div class="overview-close-step${annual && ['market', 'plan'].includes(step.id) ? ' overview-year-step' : ''}" data-overview-close-step="${step.id}" data-state="${step.state}"><span aria-hidden="true">${step.state === 'done' ? '✓' : '○'}</span><b>${escapeHtml(step.title)}</b><span class="overview-step-detail">${escapeHtml(step.id === 'expenses' && model.members?.length > 4 && !step.done ? `Ausgaben fehlen noch · ${model.members.length} Personen` : step.result || 'Wird im Jahresdialog geprüft.')}</span></div>`;
    const completed = closeSteps.filter(step => step.state === 'done');
    const wasOpen = host.querySelector?.('[data-overview-completed]')?.open;
    let content = '<div class="overview-close-steps">' + closeSteps.filter(step => step.state !== 'done').map(row).join('') + '</div>'
        + (completed.length ? renderFocusCompleted(completed, row, wasOpen) : '');
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
