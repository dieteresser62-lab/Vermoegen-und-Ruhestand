/** @import * as O from "../../typcheck/overview-ui.js" */
import { createInfoPopover } from '../shared/designsystem-info-popover.js';
import { bindClosePriceActions } from '../shared/close-price-actions.js';
import { quoteIssueReason } from '../tranches/tranchen-startup-prices.js';
import { createTagesgeldFields, parseMonthlyCashInput } from '../shared/tagesgeld-fields.js';
import { createCloseDialog, createCloseResult, dialogElements, closeImportProgress, advanceCloseImport, closeReadinessText, createCloseTiles } from '../shared/close-dialog.js';
import { overviewPricesDone, overviewPriceLabel } from './overview-model.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { appendExampleExpensesIcon, exampleExpensesLabel } from '../shared/designsystem-icons.js';
import { createCashProposals } from './overview-cash-proposal.js';
import { computeSpent } from '../balance/balance-expenses-metrics.js';
import { readCloseExpenseNeeds, expenseDeviation, expenseNeedsCoverage } from '../expenses/expenses-needs.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
const monthName = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
export const nextCloseText = model => model.now
    ? `Nächster Monatsabschluss: ${new Date(model.now.getFullYear(), model.now.getMonth() + 1, 1).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}.` : '';

const monthCloseRules = 'Kurse, Ausgaben und Budget sind Empfehlungen und verhindern den Abschluss nicht. Alle Vorbereitungsschritte ansehen und gültiges Tagesgeld je Person eintragen; ungespeicherte Eingaben werden beim Schließen verworfen.';

/** Jahresbeleg wie auf Übersicht und Ausgaben; ein Vorschauwert belegt keinen Plan. */
function withdrawalSource(model) {
    const year = model.summary?.year ?? model.now?.getFullYear() ?? model.year ?? '—';
    const next = model.now?.toLocaleDateString('de-DE', { month: 'long' }) || 'Folgemonat';
    const comparison = model.planComparison;
    const fixed = comparison?.year === year && comparison?.recordStatus === 'valid';
    const source = fixed ? `festgeschriebener Plan ${year}`
        : comparison?.recordStatus === 'invalid' ? `Jahresplan ${year} nicht sicher lesbar`
            : `noch kein festgeschriebener Jahresplan ${year}`;
    return { fixed, source, detail: fixed ? `Monatsinformation aus dem festgeschriebenen Plan ${year}`
        : `Vorläufige Entnahme für ${next} · ${source}` };
}

/** Addiert bestätigte Dezimalwerte ohne binäre Additionsfehler, auch bei Exponentialdarstellung. */
/**
 * @param values Vorhandene Eingabe- oder Planwerte.
 * @returns Exakt addierte und formatierte Dezimalbeträge.
 */
export function cashTotalMoney(values) {
    if (!values.length || !values.every(Number.isFinite)) return '—';
    const decimals = values.map(value => {
        const [mantissa, exponent = '0'] = String(value).split('e');
        const [integer, fraction = ''] = mantissa.split('.');
        return { digits: BigInt(integer + fraction), scale: fraction.length - Number(exponent) };
    });
    const scale = Math.max(0, ...decimals.map(value => value.scale));
    const total = decimals.reduce((sum, value) => sum + value.digits * 10n ** BigInt(scale - value.scale), 0n);
    const unit = 10n ** BigInt(scale);
    const integer = new Intl.NumberFormat('de-DE').format(total / unit);
    const fraction = scale ? String(total % unit).padStart(scale, '0').replace(/0+$/, '') : '';
    return integer + (fraction ? ',' + fraction : '') + ' €';
}

/** Dieselben Anzeigequellen für Karte und Dialog; keine neuen Abschlussbedingungen. */
/**
 * @param model Bereits gelesene Anzeigeprojektion.
 * @returns Vorbereitungsschritte des Monatsabschlusses aus den Anzeigequellen.
 */
export function projectOverviewMonthSteps(model = {}) {
    const expenses = model.expenses || {}, summary = model.summary;
    const needs = model.expenseNeeds ?? readCloseExpenseNeeds(model, expenses.year ?? model.occasion?.previousYear, model.expenseBudget);
    const split = needs?.months.find(month => month.month === (expenses.month ?? model.occasion?.previousMonth));
    const previous = monthName(model.occasion?.previousYear, model.occasion?.previousMonth);
    const next = model.now?.toLocaleDateString('de-DE', { month: 'long' }) || 'Folgemonat';
    const source = withdrawalSource(model);
    const readable = model.planComparison?.recordStatus !== 'invalid';
    const amountText = summary ? `${source.fixed ? 'Geplante' : 'Vorläufige'} Entnahme aus dem Vermögen im ${next}: ${money(summary.monthlyWithdrawal)} · ${source.source}`
        : 'Noch kein passender Jahresplan und keine vorläufige Entnahme verfügbar.';
    const budgetStatus = model.expenseBudgetSource?.status || (Number.isFinite(model.expenseBudget) ? 'provisional' : 'missing');
    const budgetDone = Boolean(['adopted', 'provisional'].includes(budgetStatus) && expenses.complete
        && Number.isFinite(expenses.spent) && Number.isFinite(model.expenseBudget) && model.expenseBudget >= 0);
    const missing = (model.members || []).filter(person => !expenses.rows?.some(row => row.id === person.id && row.present)).map(person => person.name).join(', ');
    const difference = budgetDone ? expenses.spent - model.expenseBudget : null;
    const percentage = budgetDone && model.expenseBudget > 0
        ? ` · ${formatDisplayNumber(Math.abs(difference) / model.expenseBudget * 100, { fractionDigits: 1 })} %` : '';
    const count = (model.members || []).reduce((sum, person) => sum + (person.count || 0), 0);
    const steps = [
        { id: 'prices', chip: 'Kurse', title: 'Kurse prüfen', continueLabel: 'Weiter zu den Kursen', done: model.now ? overviewPricesDone(model) : false,
            result: model.now ? overviewPriceLabel(model) + (Number.isInteger(model.priceReport?.completed) ? ` · ${model.priceReport.completed} von ${model.priceReport.total} im Abruf bearbeitet` : ` · ${count} Tranchen`) : 'Kursstand unbekannt' },
        { id: 'expenses', chip: 'Ausgaben', title: `Ausgaben ${previous}`, continueLabel: 'Weiter zu den Ausgaben', done: Boolean(expenses.complete),
            result: expenses.complete ? `${money(expenses.spent)} · vollständig${split?.withBreakdown ? ` · Floor ${money(split.floor)} · Flex ${money(split.flex)}` : ''}` : `Ausgaben fehlen noch${missing ? ': ' + missing : ''}` },
        { id: 'budget', chip: 'Budgetvergleich', title: 'Mit dem Budget vergleichen', continueLabel: 'Weiter zum Budgetvergleich', done: budgetDone, state: budgetStatus === 'missing' ? 'not_applicable' : 'open',
            resultTone: budgetDone && difference > 0 ? 'warning' : '',
            result: budgetStatus === 'missing' ? `Entfällt: Für ${previous} ${expenses.year || model.occasion?.previousYear} ist kein passendes Budget vorhanden.`
                : budgetStatus === 'invalid' ? 'Budgetquelle nicht sicher lesbar oder widersprüchlich. Bitte prüfen.' : budgetDone ? difference === 0 ? `genau im Budget (${money(model.expenseBudget)})` : `${money(Math.abs(difference))} ${difference > 0 ? 'über' : 'unter'} Budget${percentage}`
                : 'Für den Vergleich fehlen vollständige Ausgaben oder ein passendes Budget.' },
        { id: 'cash', chip: 'Tagesgeld & Monatsbetrag', title: 'Tagesgeld prüfen', continueLabel: 'Weiter zum Tagesgeld', done: false,
            amountText, closeAmountText: !readable ? '' : summary ? `Entnahme im ${next}: ${money(summary.monthlyWithdrawal)} · ${source.fixed ? 'laut Plan ' + (model.summary?.year ?? model.now?.getFullYear()) : 'vorläufig'}` : amountText,
            result: summary ? `${amountText}. Tagesgeld bei Bedarf überschreiben; der Abschluss speichert den Feldwert.` : amountText }
    ];
    const current = steps.find(step => !step.done && step.state !== 'not_applicable')?.id;
    return steps.map(step => ({ ...step, prepared: step.id !== 'cash', state: step.done ? 'done' : step.state === 'not_applicable' ? 'not_applicable' : step.id === current ? 'current' : 'open' }));
}

function budgetSourceLabel(model) {
    const source = model.expenseBudgetSource;
    const status = source?.status || (Number.isFinite(model.expenseBudget) ? 'provisional' : 'missing');
    return status === 'adopted' ? `laut Plan ${source?.year ?? model.expenses?.year ?? model.occasion?.previousYear}`
        : status === 'provisional' ? 'vorläufig' : status === 'invalid' ? 'Quelle nicht sicher lesbar' : 'kein passendes Budget';
}

/** Anzeigeprojektion des angenommenen Monatsauftrags; keine Livequellen und keine Writes. */
/**
 * @param model Bereits gelesene Anzeigeprojektion.
 * @param cash Bestätigte Tagesgeldwerte und ihre Personenquellen.
 * @returns Formatierte Belegdaten des bestätigten Monatsauftrags.
 */
export function projectConfirmedMonthResult(model, cash = {}) {
    const steps = projectOverviewMonthSteps(model);
    return { month: monthName(model.occasion?.previousYear, model.occasion?.previousMonth),
        nextMonth: model.now?.toLocaleDateString('de-DE', { month: 'long' }) || 'Folgemonat',
        expenses: steps[1].result, budgetComparison: steps[2].result, budgetTone: steps[2].resultTone,
        people: (cash.people || []).map(person => ({ name: person.name,
            value: Number.isFinite(cash.values?.[person.id]) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 20 }).format(cash.values[person.id]) + ' €' : '—',
            status: cash.playValues?.[person.id] ? 'geändert · Spielwert' : cash.values?.[person.id] !== person.value ? 'geändert' : 'bestätigt' })),
        expensesAmount: money(model.expenses?.spent), budgetAmount: money(model.expenseBudget), budgetSource: budgetSourceLabel(model),
        withdrawalFixed: withdrawalSource(model).fixed,
        cashTotal: cashTotalMoney(Object.values(cash.values || {})), withdrawal: money(model.summary?.monthlyWithdrawal),
        withdrawalDetail: withdrawalSource(model).detail };
}

/** Lokale Monatsansicht: ausschließlich bereits gelesene Ausgabenrecords. */
function expensesDetails(doc, model) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const details = node('section'); details.dataset.closeExpensesDetails = '';
    details.append(node('h4', 'Ausgaben ansehen'));
    const expenses = model.expenses || {}, people = model.members || [];
    const table = node('table'); table.className = 'ds-table close-dialog-table';
    const head = node('thead'), headings = node('tr');
    for (const label of ['Kategorie', ...people.map(person => person.name), 'Summe']) headings.append(node('th', label));
    head.append(headings); const body = node('tbody');
    const rows = people.map(person => expenses.rows?.find(row => row.id === person.id));
    const categories = [...new Set(rows.flatMap(row => Object.keys(row?.categories || {})))];
    for (const category of categories) {
        const tr = node('tr'), amounts = rows.map(row => row?.present ? (computeSpent(row.categories).sum < 0 ? -1 : 1) * (row.categories?.[category] ?? 0) : null);
        tr.append(node('th', category), ...amounts.map(amount => node('td', amount === null ? 'Import fehlt' : money(amount))),
            node('td', money(amounts.reduce((sum, amount) => sum + (amount ?? 0), 0)))); body.append(tr);
    }
    const totals = rows.map(row => row?.present ? row.categories ? computeSpent(row.categories).spent : row.spent : null);
    const total = node('tr');
    total.append(node('th', 'Summe:'), ...totals.map(value => node('td', value === null ? 'Import fehlt' : money(value))),
        node('td', `${money(totals.reduce((sum, value) => sum + (value ?? 0), 0))}${expenses.complete ? '' : ' · unvollständig'}`));
    body.append(total); table.append(head, body); details.append(table);
    for (const [index, row] of rows.entries()) for (const item of row?.plannedExpenses || [])
        details.append(node('p', `Geplante Ausgabe bezahlt (${people[index].name}): ${item.label || 'ohne Bezeichnung'} · ${money(item.amount)} · außerhalb des Monatsbudgets`));
    if (rows.some(row => row?.plannedExpenses?.length)) details.append(node('p', `Für den Budgetvergleich: ${money(expenses.complete ? expenses.spent : expenses.partialSpent)} ohne bezahlte geplante Ausgaben.`));
    return details;
}

/** Gemeinsame Inhalte für Monats- und Jahresdialog, ohne Seitenwechsel. */
/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Schreibfreier Inhalt des gewählten Vorbereitungsschritts.
 */
export function createOverviewStepContent({ doc, model, step, status, wealthStatus }) {
    const node = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
    const button = text => { const el = node('button', text); el.type = 'button'; el.className = 'ds-button ds-button-secondary'; return el; };
    const body = node('div');
    const year = model.expenses?.year ?? model.occasion?.previousYear;
    const needs = model.expenseNeeds ?? readCloseExpenseNeeds(model, year, model.expenseBudget);
    const split = needs?.months.find(month => month.month === (model.expenses?.month ?? model.occasion?.previousMonth));

    if (step.id === 'prices') {
        body.className = 'close-dialog-columns';
        const overview = node('section');
        const refresh = button('Kurse aktualisieren'); refresh.dataset.closePricesRefresh = '';
        const details = node('section'); details.dataset.closePricesDetails = ''; details.append(node('h4', 'Tranchen'));
        const report = model.priceReport;
        const results = (report?.results || []).filter(result => !model.scope?.ids || model.scope.ids.includes(result.profileId));
        overview.append(node('p', `${results.filter(result => result.status === 'updated').length} von ${model.priceTranches?.length ?? results.length} Tranchen aktualisiert`));
        const retrieved = new Date(report?.retrievedAt ?? NaN);
        overview.append(node('p', `Abrufzeit: ${Number.isFinite(retrieved.getTime()) ? retrieved.toLocaleString('de-DE') : 'noch kein bestätigter Abruf'}`));
        const quote = new Date(model.quoteDate || NaN);
        overview.append(node('p', `Ältestes Kursdatum: ${Number.isFinite(quote.getTime()) ? quote.toLocaleString('de-DE') : 'unbekannt'}`), refresh);
        const table = node('table'); table.className = 'ds-table close-dialog-table';
        const head = node('thead'), headings = node('tr');
        for (const label of ['Person', 'Tranche', 'Kurs', 'Status']) headings.append(node('th', label));
        head.append(headings); const rows = node('tbody');
        // Vor dem ersten Abruf bleiben auch gespeicherte Tranchen sichtbar.
        const lots = results.length ? results : model.priceTranches || [];
        for (const result of lots) {
            const name = result.profileName || model.members?.find(p => p.id === result.profileId)?.name || 'Unbenannte Person';
            const stored = model.priceTranches?.find(lot => lot.profileId === result.profileId && lot.trancheId === result.trancheId);
            const row = node('tr'); row.append(node('td', name), node('td', result.trancheName || result.name || result.trancheId || 'Bestand'),
                node('td', money(result.quote?.price ?? result.tranche?.currentPrice ?? stored?.currentPrice ?? result.currentPrice)),
                node('td', result.status === 'updated' ? 'gespeichert' : result.status ? quoteIssueReason(result) : 'gespeicherter Stand')); rows.append(row);
        }
        table.append(head, rows); details.append(table);
        const technical = node('details'); technical.dataset.closePricesTechnical = ''; technical.append(node('summary', 'Technik'), node('pre', JSON.stringify({ status: report?.status, results: (report?.results || []).map(r => ({ profileId: r.profileId, trancheId: r.trancheId, status: r.status, code: r.code })) }, null, 2)));
        details.append(technical); body.append(overview, details);
    }

    if (step.id === 'expenses') {
        const expenses = model.expenses || {};
        const cards = node('div'); cards.className = 'close-dialog-person-cards'; body.append(cards);
        for (const person of model.members || []) {
            const row = node('div'); row.className = 'close-dialog-expense-person';
            const expense = expenses.rows?.find(row => row.id === person.id);
            row.dataset.importPresent = String(Boolean(expense?.present));
            const summary = node('div'); summary.className = 'close-dialog-expense-summary';
            const amount = node('strong', expense?.present ? money(expense.spent) : '—'); amount.className = 'close-dialog-expense-amount';
            const imported = node('small', expense?.present ? 'Import vorhanden' : 'Import fehlt');
            imported.className = 'close-dialog-expense-status'; imported.dataset.importPresent = String(Boolean(expense?.present));
            summary.append(node('span', person.name), amount, imported); row.append(summary);
            const file = node('input'); file.type = 'file'; file.accept = '.csv,text/csv'; file.dataset.overviewExpensesFile = person.id;
            file.id = `close-expenses-file-${person.id}`; file.hidden = true;
            file.setAttribute('aria-label', `CSV für ${person.name} auswählen`);
            const choose = button('CSV auswählen …'); choose.dataset.overviewExpensesChoose = person.id;
            choose.setAttribute('aria-label', `CSV für ${person.name} auswählen`);
            const filename = node('span', 'Keine CSV ausgewählt'); filename.className = 'close-dialog-file-name';
            filename.dataset.overviewExpensesFilename = person.id;
            const controls = node('div'); controls.className = 'close-dialog-file-row';
            controls.append(file, choose, filename);
            if (model.exampleExpensesAllowed) {
                const example = button(''); example.className += ' ds-icon-button';
                appendExampleExpensesIcon(example, doc);
                example.title = exampleExpensesLabel(model, person.name || person.id);
                example.setAttribute('aria-label', example.title);
                example.dataset.overviewExample = 'one'; example.dataset.overviewExampleTarget = person.id; controls.append(example);
            }
            if (expense?.present) {
                const replace = node('details'); replace.dataset.closeExpensesReplace = person.id;
                replace.append(node('summary', 'Import ersetzen …'), controls); row.append(replace);
            } else row.append(controls);
            cards.append(row);
        }
        if (model.exampleExpensesAllowed) {
            const all = button(''); appendExampleExpensesIcon(all, doc);
            all.append(node('span', 'Beispiele für alle'));
            all.title = exampleExpensesLabel(model);
            all.setAttribute('aria-label', all.title);
            all.dataset.overviewExample = 'all'; body.append(all);
        }
        body.append(status, wealthStatus, expensesDetails(doc, model));
    }
    if (step.id === 'budget') {
        const progress = closeImportProgress(model);
        const comparable = step.done, difference = comparable ? model.expenses.spent - model.expenseBudget : null;
        const percent = comparable && model.expenseBudget > 0 ? `${formatDisplayNumber(Math.abs(difference) / model.expenseBudget * 100, { fractionDigits: 1 })} %` : '';
        body.append(createCloseTiles({ doc, items: [
            { label: `Ausgaben ${monthName(model.occasion?.previousYear, model.occasion?.previousMonth)}`,
                value: money(model.expenses?.complete ? model.expenses.spent : model.expenses?.partialSpent),
                detail: model.expenses?.complete ? 'vollständig' : `unvollständig${progress.missing.length ? ' · ' + progress.missing.join(', ') + ' fehlt' : ''}` },
            { label: 'Monatsbudget', value: money(model.expenseBudget), detail: budgetSourceLabel(model) },
            { label: 'Abweichung', value: comparable ? `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${money(Math.abs(difference))}` : '—',
                detail: comparable ? difference === 0 ? 'genau im Budget' : `${percent}${percent ? ' ' : ''}${difference > 0 ? 'über' : 'unter'} Budget` : 'Vergleich unvollständig',
                tone: step.resultTone }
        ] }));
        if (split?.withBreakdown) {
            const tiles = createCloseTiles({ doc, items: monthlyNeedsTiles(needs, split, year) });
            tiles.className += ' close-dialog-needs-tiles'; body.append(tiles);
            body.append(node('p', `Ein einzelner Monat schwankt. Maßgeblich ist der Jahresdurchschnitt auf der Seite Ausgaben: Floor ${money(needs.avgMonthly.floor)} · Flex ${money(needs.avgMonthly.flex)} im Monat.${needs.monthsWithoutBreakdown ? ' ' + expenseNeedsCoverage(needs) : ''}`));
        }
        if (!model.expenses?.complete && step.state !== 'not_applicable') {
            const missing = (model.members || []).filter(p => !model.expenses?.rows?.some(r => r.id === p.id && r.present));
            body.append(node('p', `Import fehlt: ${missing.map(p => p.name).join(', ')}`));
            const jump = button('Zum Ausgabenimport'); jump.dataset.closeDialogJump = 'expenses'; body.append(jump);
        }
    }
    return body;
}

/**
 * @param needs Bedarfsstatistik mit den zugehörigen Planwerten.
 * @param month Kalendermonat von 1 bis 12.
 * @param year Kalenderjahr der Projektion.
 * @returns Floor-/Flex-Kacheln mit Monatsplanvergleich.
 */
export function monthlyNeedsTiles(needs, month, year) {
    return ['floor', 'flex'].map(key => {
        const plan = needs.plans[key] === null ? null : needs.plans[key] / 12;
        return { label: `${key === 'floor' ? 'Floor' : 'Flex'} ${monthName(year, month.month)}`, value: money(month[key]),
            detail: `${key === 'floor' ? 'Grundbedarf' : `Flex ${year} nach Regeln`}: ${money(plan)} im Monat · ${expenseDeviation(month[key], plan, money).replace('über Plan', 'darüber').replace('unter Plan', 'darunter')}`,
            tone: plan !== null && month[key] > plan ? 'warning' : '' };
    });
}

/** Bei Rerender bleiben geöffnete lokale Detailansichten geöffnet. */
/**
 * @param previous Bisherige Dialogwurzel oder bisheriger Zustand.
 * @param next Neue Dialogwurzel.
 * @returns Neue Dialogwurzel mit erhaltenen lokalen Detailzuständen.
 */
export function preserveCloseDetails(previous, next) {
    for (const selector of ['[data-close-prices-technical]']) {
        const old = previous?.querySelector(selector), replacement = next.querySelector(selector);
        if (old && replacement) replacement.open = old.open;
    }
    for (const field of previous?.querySelectorAll('[data-overview-expenses-filename]') || []) {
        const replacement = next.querySelector(`[data-overview-expenses-filename="${field.dataset.overviewExpensesFilename}"]`);
        if (replacement) { replacement.textContent = field.textContent; replacement.title = field.title || ''; }
    }
    for (const details of previous?.querySelectorAll('[data-close-expenses-replace]') || []) {
        const replacement = next.querySelector(`[data-close-expenses-replace="${details.dataset.closeExpensesReplace}"]`);
        if (replacement) replacement.open = details.open;
    }
    return next;
}

/** Langlebige Monatsbindung. Der Aufrufer besitzt Importjobs, Guard und Abschlussauftrag. */
/** @param {O.MonthOptions} [options] @returns {Promise<unknown>} */
export function requestOverviewMonthConfirmation({ doc = document, signal, returnFocus, people = [], model = {},
    onReady, onAccept, priceActions, getModel = () => model, onDirty = () => {}, isCommitActive = () => false, canClose = () => true, confirmDiscard = async () => false, onClose } = {}) {
    let handle;
    try {
        const node = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
        const accept = node('button'); accept.type = 'button'; accept.className = 'ds-button ds-button-primary'; accept.dataset.overviewMonthAccept = '';
        const cancel = node('button', 'Schließen'); cancel.type = 'button'; cancel.className = 'ds-button ds-button-secondary'; cancel.dataset.overviewMonthCancel = '';
        const proposals = next => createCashProposals({ doc, model: next, people });
        const cash = people.length ? createTagesgeldFields({ doc, people, proposals: proposals(model), prefix: 'overviewTagesgeld', monthly: true, closePresentation: true,
            asOfLabel: model.now ? `Kontostand heute, ${model.now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : 'Kontostand heute',
            explanation: 'Tagesgeldentwurf – wird erst mit dem Monatsabschluss gespeichert. Der Cashbeleg trägt den heutigen Bestätigungstag, nicht den letzten Tag des abgeschlossenen Monats. Fließt in den Vermögensverlauf ein.', title: '' }) : null;
        const cashReady = () => !cash || cash.ready;
        const initial = cash?.inputs.map(input => input.value) || [];
        const dirty = () => cash?.inputs.some((input, index) => {
            try { return parseMonthlyCashInput(input.value) !== parseMonthlyCashInput(initial[index]); }
            catch { return input.value !== initial[index]; }
        }) || false;
        const status = node('p'); status.id = 'overviewExampleExpensesStatus'; status.setAttribute('role', 'status');
        const wealthStatus = node('p'); wealthStatus.id = 'overviewExpensesWealthStatus'; wealthStatus.dataset.errorChannel = 'expenses-wealth'; wealthStatus.setAttribute('role', 'status');
        let currentModel = model, completed = false, importActive = false;
        const link = (href, text) => {
            const anchor = node('a', text); anchor.setAttribute('href', href); anchor.setAttribute('data-profile-handoff', '');
            anchor.className = 'ds-button ds-button-secondary';
            return anchor;
        };
        const contents = new Map();
        const project = nextModel => projectOverviewMonthSteps(nextModel).map(step => {
            const body = node('div');
            if (['prices', 'expenses', 'budget'].includes(step.id)) {
                body.append(createOverviewStepContent({ doc, model: nextModel, step, status, wealthStatus }));
                preserveCloseDetails(contents.get(step.id), body); contents.set(step.id, body);
            }
            if (step.id === 'cash') {
                // Cashquelle und Entwurf werden niemals durch einen Importrefresh neu gekoppelt.
                if (!contents.has('cash')) {
                    const recommendation = node('p', step.closeAmountText); recommendation.className = 'close-dialog-recommendation';
                    if (cash) body.append(cash.root); body.append(recommendation);
                    if (!nextModel.summary) body.append(link('Balance.html', 'Plan rechnen'));
                    contents.set('cash', body);
                }
                const recommendation = contents.get('cash').querySelector('.close-dialog-recommendation');
                Array.from(recommendation.children || []).forEach(child => child.remove());
                recommendation.textContent = step.closeAmountText;
                recommendation.hidden = !step.closeAmountText;
                if (step.closeAmountText && nextModel.summary) recommendation.append(createInfoPopover(doc, 'Herkunft der Entnahme', withdrawalSource(nextModel).detail));
            }
            return { ...step, progressByVisit: step.id !== 'cash', ...(step.id === 'cash' ? { state: !cash ? 'not_applicable' : cash.ready && handle?.hasVisited('cash') ? 'done' : 'open', done: Boolean(cash?.ready && handle?.hasVisited('cash')),
                statusLabel: !cash ? 'entfällt' : cash.ready ? handle?.hasVisited('cash') ? 'erledigt' : 'offen' : `${cash.openPeople.length} offen`,
                // Die Monatsinformation steht ausschließlich im sichtbaren Tagesgeldinhalt.
                result: !cash ? 'Entfällt: Keine Tagesgeldpersonen vorhanden.' : cash.ready ? 'Gültiger Tagesgeld-Stand je Person' : `Tagesgeld fehlt oder ist ungültig: ${cash.openPeople.join(', ')}`,
                onNext: () => cash?.focusInvalid() ?? true } : {}),
                contentOwnResult: true, content: step.id === 'cash' ? contents.get('cash') : body };
        });
        const isReady = () => Boolean(currentModel.summary && !currentModel.recovery && cashReady() && handle && !handle.busy && !isCommitActive() && !importActive && !handle.firstUnvisited());
        const syncReady = () => {
            if (completed) return;
            accept.disabled = !isReady();
            const unseen = handle?.firstUnvisited();
            const text = closeReadinessText({ unseen, action: accept.textContent,
                problem: !cashReady() ? `Tagesgeld ${cash.openPeople.join(', ')} gültig eintragen`
                    : !currentModel.summary ? 'Ein passender Plan fehlt.' : currentModel.recovery ? 'Wiederherstellung erforderlich.'
                    : importActive ? 'Ausgabenimport läuft – bitte warten.' : handle?.busy || isCommitActive() ? 'Speichervorgang läuft – bitte warten.' : '' });
            handle?.setStatus(text);
        };
        const update = nextModel => {
            const previousModel = currentModel;
            currentModel = nextModel;
            if (completed) return;
            cash?.updateProposals(proposals(nextModel));
            if (!accept.hasAttribute('data-overview-month-retry')) accept.textContent = `${monthName(nextModel.occasion?.previousYear, nextModel.occasion?.previousMonth)} abschließen`;
            accept.disabled = !isReady();
            const steps = project(nextModel);
            handle?.updateSteps(steps);
            advanceCloseImport(handle, previousModel, nextModel);
            syncReady();
            handle?.setProgressNames((nextModel.members || []).map(person => person.name).join(' + '));
            handle?.setFootnote(nextCloseText(nextModel), cash ? monthCloseRules : 'Kurse, Ausgaben und Budget sind Empfehlungen und verhindern den Abschluss nicht. Alle Vorbereitungsschritte ansehen.');
        };
        handle = /** @type {O.CreateCloseDialog} */ (createCloseDialog)({ doc, id: 'overviewMonthConfirmation', title: `${monthName(model.occasion?.previousYear, model.occasion?.previousMonth)} abschließen`,
            actions: [cancel, accept], steps: project(model), signal, returnFocus,
            onClose: async () => {
                if (!canClose()) return false;
                if (!completed && dirty() && !await confirmDiscard()) return false;
                return await onClose?.() !== false;
            } });
        if (!handle) return Promise.resolve(false);
        // Öffentlicher Überblicksvertrag bleibt am konkreten Adapter verankert.
        handle.root.id = 'overviewMonthConfirmation';
        const heading = dialogElements(handle.root).find(node => (node.tagName?.toLowerCase() || node.tag) === 'h2');
        heading.id = 'overviewMonthConfirmationTitle';
        handle.setOnVisit(() => { handle.updateSteps(project(currentModel)); syncReady(); });
        cash?.bind(handle.listen, () => { onDirty(dirty()); update(currentModel); });
        update(model);
        handle.listen(cancel, 'click', () => { void handle.requestClose(); });
        /** @type {O.BindPriceActions} */ (bindClosePriceActions)(handle, { actions: priceActions, getModel, update, signal });
        handle.listen(handle.root, 'input', () => onDirty(dirty()));
        handle.listen(accept, 'click', async () => {
            if (handle.busy || (!completed && !isReady()) || accept.disabled || signal?.aborted) return;
            if (completed) { handle.close(true); return; }
            let accepted;
            try { accepted = cash ? { cash: cash.read() } : true; }
            catch { return; }
            if (!onAccept) { handle.close(accepted); return; }
            const savedModel = currentModel;
            handle.setBusy(true); handle.setStatus('Monat wird gespeichert …');
            try {
                const ok = await onAccept(/** @type {O.MonthAccepted|boolean} */ (accepted));
                if (ok && !signal?.aborted) {
                    completed = true; handle.root.dataset.monthResult = 'confirmed'; onDirty(false);
                    const data = projectConfirmedMonthResult(savedModel, /** @type {O.MonthAccepted} */ (accepted).cash);
                    const result = /** @type {O.CreateCloseResult} */ (createCloseResult)({ doc, ...data, withdrawalLabel: `Entnahme ${data.nextMonth}` }); result.dataset.overviewMonthResult = '';
                    handle.setResult(result); handle.setStatus(nextCloseText(savedModel));
                    handle.setFootnote('');
                    handle.setTitle(`${data.month} abgeschlossen`);
                    handle.setSubtitle(`${(/** @type {O.MonthAccepted} */ (accepted).cash?.people || savedModel.members || []).map(person => person.name).join(' + ')} · gespeichert am ${savedModel.now?.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) || '—'}`);
                    cancel.hidden = true; accept.textContent = 'Fertig'; delete accept.dataset.overviewMonthRetry; accept.dataset.overviewMonthDone = '';
                }
                else { accept.textContent = 'Erneut versuchen'; accept.dataset.overviewMonthRetry = ''; handle.setStatus('Bereitstellung nicht bestätigt. Bitte Profil und Umfang erneut prüfen.'); }
            } catch (error) { handle.setStatus(error?.code === 'rollback_failed' || currentModel.recovery
                ? 'Wiederherstellung erforderlich: Rückschreiben nicht bestätigt. Bitte den Wiederherstellungspunkt prüfen.'
                : error?.message === 'PERSISTENCE_FLUSH_FAILED' ? 'Vorherige Änderungen konnten nicht gesichert werden. Ihre Eingaben bleiben erhalten. Bitte erneut versuchen.'
                    : String(error?.message).includes('SNAPSHOT') ? 'Wiederherstellungspunkt nicht bestätigt. Ihre Eingaben bleiben erhalten. Bitte erneut versuchen.'
                        : 'Speicherung nicht dauerhaft bestätigt. Ihre Eingaben bleiben erhalten. Bitte den Speicher prüfen und erneut versuchen.');
                accept.textContent = 'Erneut versuchen'; accept.dataset.overviewMonthRetry = ''; }
            finally {
                handle.setBusy(false);
                if (handle.root.open) {
                    // Der Store kann Recovery melden, während Busy den Modellrefresh sperrt.
                    // Vor der Retryfreigabe den inzwischen projizierten Zustand übernehmen.
                    if (!completed) update(getModel());
                    accept.disabled = !completed && !isReady();
                    if (completed) accept.focus();
                }
            }
        });
        onReady?.({ ...handle, get busy() { return handle.busy; }, update, syncReady, isReady, setImportActive(value) { importActive = value; syncReady(); }, dirty: () => !completed && dirty() });
        return handle.closed;
    } catch (error) { handle?.close(false); return Promise.reject(error); }
}
