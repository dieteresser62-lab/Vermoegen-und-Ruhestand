import { bindClosePriceActions } from '../shared/close-price-actions.js';
import { quoteIssueReason } from '../tranches/tranchen-startup-prices.js';
import { createTagesgeldFields, parseMonthlyCashInput } from '../shared/tagesgeld-fields.js';
import { createCloseDialog, createCloseResult, dialogElements, closeImportProgress, advanceCloseImport, closeReadinessText } from '../shared/close-dialog.js';
import { overviewPricesDone, overviewPriceLabel } from './overview-model.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { appendExampleExpensesIcon, exampleExpensesLabel } from '../shared/designsystem-icons.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';
const monthName = (year, month) => new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
const nextCloseText = model => model.now
    ? `Nächster Monatsabschluss: ${new Date(model.now.getFullYear(), model.now.getMonth() + 1, 1).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}.` : '';

/** Addiert bestätigte Dezimalwerte ohne binäre Additionsfehler, auch bei Exponentialdarstellung. */
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
export function projectOverviewMonthSteps(model = {}) {
    const expenses = model.expenses || {}, summary = model.summary;
    const previous = monthName(model.occasion?.previousYear, model.occasion?.previousMonth);
    const next = model.now?.toLocaleDateString('de-DE', { month: 'long' }) || 'Folgemonat';
    const amountText = summary ? `Geplante Entnahme aus dem Vermögen im ${next}: ${money(summary.monthlyWithdrawal)} · Plan ${summary.year ?? model.now?.getFullYear() ?? '—'}`
        : 'Noch kein passender Plan und kein bestätigter Monatsbetrag.';
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
            result: expenses.complete ? `${money(expenses.spent)} · vollständig` : `Ausgaben fehlen noch${missing ? ': ' + missing : ''}` },
        { id: 'budget', chip: 'Budget', title: 'Mit dem Budget vergleichen', continueLabel: 'Weiter zum Budgetvergleich', done: budgetDone, state: budgetStatus === 'missing' ? 'not_applicable' : 'open',
            resultTone: budgetDone && difference > 0 ? 'warning' : '',
            result: budgetStatus === 'missing' ? `Entfällt: Für ${previous} ${expenses.year || model.occasion?.previousYear} ist kein passendes Budget vorhanden.`
                : budgetStatus === 'invalid' ? 'Budgetquelle nicht sicher lesbar oder widersprüchlich. Bitte prüfen.' : budgetDone ? difference === 0 ? `genau im Budget (${money(model.expenseBudget)})` : `${money(Math.abs(difference))} ${difference > 0 ? 'über' : 'unter'} Budget${percentage}`
                : 'Für den Vergleich fehlen vollständige Ausgaben oder ein passendes Budget.' },
        { id: 'cash', chip: 'Tagesgeld & Monatsbetrag', title: 'Tagesgeld prüfen', continueLabel: 'Weiter zum Tagesgeld', done: false,
            amountText,
            result: summary ? `${amountText}. Tagesgeld ändern oder ‚Stand stimmt‘ bestätigen.` : amountText }
    ];
    const current = steps.find(step => !step.done && step.state !== 'not_applicable')?.id;
    return steps.map(step => ({ ...step, prepared: step.id !== 'cash', state: step.done ? 'done' : step.state === 'not_applicable' ? 'not_applicable' : step.id === current ? 'current' : 'open' }));
}

/** Anzeigeprojektion des angenommenen Monatsauftrags; keine Livequellen und keine Writes. */
export function projectConfirmedMonthResult(model, cash = {}) {
    const steps = projectOverviewMonthSteps(model);
    return { month: monthName(model.occasion?.previousYear, model.occasion?.previousMonth),
        nextMonth: model.now?.toLocaleDateString('de-DE', { month: 'long' }) || 'Folgemonat',
        expenses: steps[1].result, budgetComparison: steps[2].result, budgetTone: steps[2].resultTone,
        people: (cash.people || []).map(person => ({ name: person.name,
            value: Number.isFinite(cash.values?.[person.id]) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 20 }).format(cash.values[person.id]) + ' €' : '—' })),
        cashTotal: cashTotalMoney(Object.values(cash.values || {})), withdrawal: money(model.summary?.monthlyWithdrawal) };
}

/** Lokale Monatsansicht: ausschließlich bereits gelesene Ausgabenrecords. */
function expensesDetails(doc, model) {
    const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
    const details = node('details'); details.dataset.closeExpensesDetails = '';
    details.append(node('summary', 'Ausgaben ansehen'));
    const expenses = model.expenses || {};
    details.append(node('p', `${monthName(expenses.year, expenses.month)} ${expenses.year}`));
    for (const person of model.members || []) {
        const row = expenses.rows?.find(row => row.id === person.id);
        details.append(node('p', `${person.name}: ${row?.present ? money(row.spent) : 'Import fehlt'}`));
        if (row?.present) for (const [category, amount] of Object.entries(row.categories || {})) details.append(node('p', `${category}: ${money(amount)}`));
    }
    details.append(node('p', `Summe: ${money(expenses.spent)}`));
    return details;
}

/** Gemeinsame Inhalte für Monats- und Jahresdialog, ohne Seitenwechsel. */
export function createOverviewStepContent({ doc, model, step, status, wealthStatus }) {
    const node = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
    const button = text => { const el = node('button', text); el.type = 'button'; el.className = 'ds-button ds-button-secondary'; return el; };
    const body = node('div');
    const result = node('p', step.result);
    if (step.resultTone === 'warning') result.className = 'close-dialog-result-warning';
    body.append(result);
    if (step.id === 'prices') {
        const refresh = button('Kurse aktualisieren'); refresh.dataset.closePricesRefresh = ''; body.append(refresh);
        const details = node('details'); details.dataset.closePricesDetails = ''; details.append(node('summary', 'Details ansehen'));
        const report = model.priceReport;
        const results = (report?.results || []).filter(result => !model.scope?.ids || model.scope.ids.includes(result.profileId));
        details.append(node('p', `${results.filter(result => result.status === 'updated').length} von ${model.priceTranches?.length ?? results.length} Tranchen aktualisiert`));
        const retrieved = new Date(report?.retrievedAt ?? NaN);
        details.append(node('p', `Abrufzeit: ${Number.isFinite(retrieved.getTime()) ? retrieved.toLocaleString('de-DE') : 'noch kein bestätigter Abruf'}`));
        const quote = new Date(model.quoteDate || NaN);
        details.append(node('p', `Ältestes Kursdatum: ${Number.isFinite(quote.getTime()) ? quote.toLocaleString('de-DE') : 'unbekannt'}`));
        for (const result of report?.results || []) {
            if (model.scope?.ids && !model.scope.ids.includes(result.profileId)) continue;
            const name = result.profileName || model.members?.find(p => p.id === result.profileId)?.name || 'Unbenannte Person';
            details.append(node('p', `${name} / ${result.trancheName || result.trancheId || 'Bestand'}: ${result.status === 'updated' ? 'gespeichert' : quoteIssueReason(result)}`));
        }
        const technical = node('details'); technical.append(node('summary', 'Technik'), node('pre', JSON.stringify({ status: report?.status, results: (report?.results || []).map(r => ({ profileId: r.profileId, trancheId: r.trancheId, status: r.status, code: r.code })) }, null, 2)));
        details.append(technical); body.append(details);
    }
    if (step.id === 'expenses') {
        const expenses = model.expenses || {};
        for (const person of model.members || []) {
            const row = node('div'); row.className = 'close-dialog-expense-person';
            const expense = expenses.rows?.find(row => row.id === person.id);
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
            body.append(row);
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
        body.append(node('p', !progress.complete && Number.isFinite(model.expenses?.partialSpent)
            ? `Ausgaben bisher: ${money(model.expenses.partialSpent)} (${progress.missing.join(', ')} ${progress.missing.length === 1 ? 'fehlt' : 'fehlen'})`
            : `Ausgaben: ${money(model.expenses?.spent)}`));
        if (Number.isFinite(model.expenseBudget)) body.append(node('p', `Monatsbudget: ${money(model.expenseBudget)}`));
        if (!model.expenses?.complete && step.state !== 'not_applicable') {
            const missing = (model.members || []).filter(p => !model.expenses?.rows?.some(r => r.id === p.id && r.present));
            body.append(node('p', `Import fehlt: ${missing.map(p => p.name).join(', ')}`));
            const jump = button('Zum Ausgabenimport'); jump.dataset.closeDialogJump = 'expenses'; body.append(jump);
        }
    }
    return body;
}

/** Bei Rerender bleiben geöffnete lokale Detailansichten geöffnet. */
export function preserveCloseDetails(previous, next) {
    for (const selector of ['[data-close-prices-details]', '[data-close-expenses-details]']) {
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
export function requestOverviewMonthConfirmation({ doc = document, signal, returnFocus, people = [], model = {},
    onReady, onAccept, priceActions, getModel = () => model, onDirty = () => {}, isCommitActive = () => false, canClose = () => true, confirmDiscard = async () => false, onClose } = {}) {
    let handle;
    try {
        const node = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
        const accept = node('button'); accept.type = 'button'; accept.className = 'ds-button ds-button-primary'; accept.dataset.overviewMonthAccept = '';
        const cancel = node('button', 'Schließen'); cancel.type = 'button'; cancel.className = 'ds-button ds-button-secondary'; cancel.dataset.overviewMonthCancel = '';
        const cash = people.length ? createTagesgeldFields({ doc, people, prefix: 'overviewTagesgeld', monthly: true, closePresentation: true, requireConfirmation: true,
            asOfLabel: model.now ? `Kontostand heute (${model.now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })})` : 'Kontostand heute',
            explanation: 'Tagesgeldentwurf – wird erst mit dem Monatsabschluss gespeichert.', title: '' }) : null;
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
                    const recommendation = node('p', step.amountText); recommendation.className = 'close-dialog-recommendation';
                    body.append(recommendation); if (cash) body.append(cash.root);
                    if (!nextModel.summary) body.append(link('Balance.html', 'Plan rechnen'));
                    contents.set('cash', body);
                }
                contents.get('cash').children[0].textContent = step.amountText;
            }
            return { ...step, progressByVisit: step.id !== 'cash', ...(step.id === 'cash' ? { state: !cash ? 'not_applicable' : cash.ready ? 'entered' : 'open',
                // Die Monatsinformation steht ausschließlich im sichtbaren Tagesgeldinhalt.
                result: !cash ? 'Entfällt: Keine Tagesgeldpersonen vorhanden.' : cash.ready ? 'Eingetragen – noch nicht gespeichert.' : 'Tagesgeld noch nicht bestätigt.',
                onNext: () => cash?.focusConfirmation() ?? true } : {}),
                contentOwnResult: true, content: step.id === 'cash' ? contents.get('cash') : body };
        });
        const isReady = () => Boolean(currentModel.summary && !currentModel.recovery && cashReady() && handle && !handle.busy && !isCommitActive() && !importActive && !handle.firstUnvisited());
        const syncReady = () => {
            if (completed) return;
            accept.disabled = !isReady();
            const unseen = handle?.firstUnvisited();
            const text = closeReadinessText({ unseen, action: accept.textContent,
                problem: !cashReady() ? 'Tagesgeld ändern oder ‚Stand stimmt‘ bestätigen.'
                    : !currentModel.summary ? 'Ein passender Plan fehlt.' : currentModel.recovery ? 'Wiederherstellung erforderlich.'
                    : importActive ? 'Ausgabenimport läuft – bitte warten.' : handle?.busy || isCommitActive() ? 'Speichervorgang läuft – bitte warten.' : '' });
            handle?.setStatus(text);
        };
        const update = nextModel => {
            const previousModel = currentModel;
            currentModel = nextModel;
            if (completed) return;
            if (!accept.hasAttribute('data-overview-month-retry')) accept.textContent = `${monthName(nextModel.occasion?.previousYear, nextModel.occasion?.previousMonth)} abschließen`;
            accept.disabled = !isReady();
            const steps = project(nextModel);
            handle?.updateSteps(steps);
            advanceCloseImport(handle, previousModel, nextModel);
            syncReady();
            handle?.setProgressNames((nextModel.members || []).map(person => person.name).join(' + '));
            handle?.setFootnote(`${nextCloseText(nextModel)} Kurse, Ausgaben und Budget sind Empfehlungen und verhindern den Abschluss nicht. ${cash ? 'Alle Vorbereitungsschritte ansehen und Tagesgeld je Person ändern oder bestätigen; ungespeicherte Eingaben werden beim Schließen verworfen.' : 'Alle Vorbereitungsschritte ansehen.'}`.trim());
        };
        handle = createCloseDialog({ doc, id: 'overviewMonthConfirmation', title: `${monthName(model.occasion?.previousYear, model.occasion?.previousMonth)} abschließen`,
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
        handle.setOnVisit(syncReady);
        cash?.bind(handle.listen, () => update(currentModel));
        update(model);
        handle.listen(cancel, 'click', () => { void handle.requestClose(); });
        bindClosePriceActions(handle, { actions: priceActions, getModel, update, signal });
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
                const ok = await onAccept(accepted);
                if (ok && !signal?.aborted) {
                    completed = true; handle.root.dataset.monthResult = 'confirmed'; onDirty(false);
                    const data = projectConfirmedMonthResult(savedModel, accepted.cash);
                    const result = createCloseResult({ doc, ...data, withdrawalLabel: `Geplante Entnahme aus dem Vermögen im ${data.nextMonth}`, planYear: savedModel.summary?.year }); result.dataset.overviewMonthResult = '';
                    handle.setResult(result); handle.setStatus(`${data.month} abgeschlossen ✓`);
                    handle.setFootnote(nextCloseText(savedModel));
                    handle.setTitle(`${data.month} abgeschlossen`);
                    handle.setSubtitle(`${(accepted.cash?.people || savedModel.members || []).map(person => person.name).join(' + ')} · gespeichert am ${savedModel.now?.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) || '—'}`);
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
