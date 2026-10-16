import { bindInfoPopovers, createInfoPopover } from './designsystem-info-popover.js';
import { formatDisplayNumber, formatDisplayDate } from './designsystem-number-format.js';
import { buildProbelaufEndReview, probelaufEndNeedsComparison } from './probelauf-comparison.js';
import { summarizeBalanceAction } from '../balance/balance-action-summary.js';
import { musterHaushalt } from '../demo/muster-haushalte.js';

const money = value => formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 });
const percent = value => formatDisplayNumber(value, { unit: 'percent', fractionDigits: 1, minimumFractionDigits: 0 });
const dateTime = raw => Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';

function appendChanges(doc, host, changes) {
    for (const group of changes.groups) {
        const section = doc.createElement('section'); section.className = 'probelauf-transfer-group';
        const title = doc.createElement('h3'); title.textContent = group.label;
        const list = doc.createElement('ul');
        for (const change of group.rows) {
            const row = doc.createElement('li'); row.textContent = `${change.label}: ${change.before} → ${change.after}`;
            if (change.detail) row.append(createInfoPopover(doc, 'Änderung im Detail', change.detail));
            list.append(row);
        }
        section.append(title, list); host.append(section);
    }
}

function transferDialog({ doc, opener, review, result }) {
    return new Promise((resolve, reject) => {
        const node = (tag, text, className) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
        const dialog = node('dialog', undefined, 'close-dialog probelauf-end-dialog');
        dialog.setAttribute('data-probelauf-dialog', ''); dialog.setAttribute('aria-labelledby', 'probelaufTransferTitle');
        const head = node('header', undefined, 'close-dialog-head');
        const title = node('h2', result ? 'Änderungen übernommen' : 'Änderungen übernehmen?'); title.id = 'probelaufTransferTitle';
        const changes = result?.changes || review.changes;
        const summary = `${changes.count} ${changes.count === 1 ? 'Änderung' : 'Änderungen'} in ${changes.areas.length} ${changes.areas.length === 1 ? 'Bereich' : 'Bereichen'}`;
        head.append(node('span', 'SPIELBEREICH', 'close-dialog-eyebrow'), title,
            node('div', result ? `gespeichert am ${dateTime(result.savedAt)}` : `${summary} · alles auf einmal`, 'close-dialog-subtitle'));
        const cross = node('button', '×', 'close-dialog-cross'); cross.type = 'button'; cross.setAttribute('aria-label', 'Schließen'); head.append(cross);
        const content = node('div', undefined, 'close-dialog-content');
        if (result) {
            content.append(node('p', 'Alles übernommen. Der Spielbereich ist geschlossen.', 'probelauf-transfer-success'));
            const facts = node('dl', undefined, 'close-dialog-facts');
            for (const [label, value] of [['Übernommen', `${summary}${changes.areas.length ? ' · ' + changes.areas.join(', ') : ''}`],
                ['Wiederherstellungspunkt', result.snapshotLabel], [`Monatsbudget (Vorschau heute) ${result.year}`, result.monthlyBudget === null ? 'nicht berechenbar' : money(result.monthlyBudget)]]) {
                facts.append(node('dt', label), node('dd', value));
            }
            content.append(facts, node('p', 'Balance und Übersicht rechnen ab jetzt mit den neuen Werten. Zurück geht es unter Daten & Sicherung mit dem Wiederherstellungspunkt.'));
        } else {
            appendChanges(doc, content, changes);
            const note = node('div', undefined, 'probelauf-transfer-note');
            note.append(node('p', 'Vorher legt die App den Wiederherstellungspunkt „Vor Übernahme aus dem Spielbereich“ an. Damit kommst du unter Daten & Sicherung zurück.'),
                node('p', 'Danach ist der Spielbereich geschlossen. Balance und Übersicht rechnen mit den neuen Werten.'));
            content.append(note);
        }
        const foot = node('footer', undefined, 'close-dialog-foot'), actions = node('div', undefined, 'close-dialog-actions');
        const back = node('button', 'Zurück', 'ds-button ds-button-secondary'); back.type = 'button';
        const accept = node('button', result ? 'Zur Startseite' : 'Jetzt übernehmen', 'ds-button ds-button-primary'); accept.type = 'button';
        if (!result) actions.append(back); actions.append(accept); foot.append(actions); dialog.append(head, content, foot);
        let settled = false; const listeners = [];
        const finish = value => { if (settled) return; settled = true; listeners.forEach(([n, t, fn]) => n.removeEventListener(t, fn)); if (dialog.open) dialog.close(); dialog.remove(); opener?.focus?.(); resolve(value); };
        back.addEventListener('click', () => finish(false)); cross.addEventListener('click', () => finish(Boolean(result)));
        accept.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(Boolean(result)); });
        dialog.addEventListener('close', () => finish(Boolean(result)));
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finish(Boolean(result)); } });
        try {
            doc.body.append(dialog);
            bindInfoPopovers(doc, { root: dialog, listen(n, t, fn) { listeners.push([n, t, fn]); n.addEventListener(t, fn); } });
            dialog.showModal(); (result ? accept : back).focus();
        } catch (error) { dialog.remove(); reject(error); }
    });
}

export const showProbelaufTransferred = options => transferDialog(options);

function openEndDialog({ doc, opener, review, loadReview }) {
    return new Promise((resolve, reject) => {
        let settled = false, loading = Boolean(loadReview), failure = null, timer;
        const listeners = [];
        const node = (tag, text, className) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
        const info = (label, text) => createInfoPopover(doc, label, text);
        const dialog = node('dialog', undefined, 'close-dialog probelauf-end-dialog');
        dialog.setAttribute('data-probelauf-dialog', ''); dialog.setAttribute('aria-labelledby', 'probelaufEndTitle');
        const head = node('header', undefined, 'close-dialog-head');
        const state = review.state || {};
        const comparison = probelaufEndNeedsComparison(state);
        const title = node('h2', comparison ? 'Spielbereich beenden' : 'Spielbereich beenden?'); title.id = 'probelaufEndTitle';
        const source = state.source === 'demo' ? musterHaushalt(state.householdId).name : 'Kopie deiner Daten';
        const mode = state.testDate == null ? 'echte Kurse von heute' : `Testdatum ${formatDisplayDate(state.testDate)} · Spielkurse`;
        head.append(node('span', 'SPIELBEREICH', 'close-dialog-eyebrow'), title);
        if (comparison) head.append(node('div', `${source} · gestartet ${dateTime(state.startedAt)} · ${mode}`, 'close-dialog-subtitle'));
        else if (state.source === 'demo') head.append(node('div', source, 'close-dialog-subtitle'));
        const cross = node('button', '×', 'close-dialog-cross'); cross.type = 'button'; cross.setAttribute('aria-label', 'Schließen'); head.append(cross);
        const content = node('div', undefined, 'close-dialog-content');
        const appendMade = () => {
            const madeChanges = review.madeChanges;
            const made = node('section', undefined, 'probelauf-end-made'); made.append(node('h3', 'Im Spielbereich gemacht'));
            const facts = node('dl', undefined, 'close-dialog-facts');
            facts.append(node('dt', 'Abschlüsse'), node('dd', madeChanges ? madeChanges.closes.join(' · ') || 'keine' : 'nicht erfasst'),
                node('dt', 'Änderungen an Plan und Beständen'), node('dd', madeChanges ? String(madeChanges.planChangeCount) : 'nicht erfasst'));
            if (review.play.monthlyBudget !== null) facts.append(node('dt', `Monatsbudget (Vorschau heute) ${review.play.year} im Spielbereich`), node('dd', money(review.play.monthlyBudget)));
            made.append(facts); content.append(made);
        };
        const renderContent = () => {
            content.replaceChildren();
            dialog.dataset.comparisonStatus = loading ? 'pending' : failure ? 'error' : 'ready';
            if (!comparison) {
                content.append(node('p', 'Alles im Spielbereich wird verworfen. Deine Daten bleiben unverändert.', 'probelauf-end-explanation'));
                if (loading) content.append(node('p', 'Zusammenfassung wird geladen …', 'ds-note'));
                else if (failure) content.append(node('p', `Zusammenfassung nicht verfügbar: ${failure.message}`, 'ds-note'));
                else appendMade();
                return;
            }
            if (failure) content.append(node('p', `Vergleich nicht verfügbar: ${failure.message}`, 'ds-note'));
            else if (loading) content.append(node('p', 'Vorschau heute wird gerechnet …', 'probelauf-end-explanation'));
            else if (review.transfer.eligible) content.append(node('p', 'So sähe es mit deinen Änderungen aus. Deine echten Daten sind bis jetzt unverändert.', 'probelauf-end-explanation'));
            else {
                const warning = node('div', undefined, 'probelauf-end-warning');
                const reason = !state.realDomainChecksum
                    ? ['Übernehmen geht hier nicht.', 'Für diesen Spielbereich fehlt der Startvergleich.', 'Die Sitzung wurde vor Einführung des Startvergleichs angelegt. Starte eine neue Kopie, um die Übernehmbarkeit prüfen zu können.']
                    : ['Übernehmen geht hier nicht mehr.', 'Deine echten Daten wurden seit dem Start des Spielbereichs geändert.', 'Zum Beispiel in einem zweiten Fenster. Sonst ginge diese Änderung verloren.'];
                warning.append(node('strong', reason[0]), node('span', reason[1]), info('Warum ist Übernehmen gesperrt?', reason[2])); content.append(warning);
                appendMade();
            }
            const table = node('table', undefined, 'probelauf-end-comparison'); table.setAttribute('aria-label', 'Vergleich Echt und Spielbereich');
            const thead = node('thead'), heading = node('tr');
            for (const text of ['', 'Echt', 'Spielbereich']) { const th = node('th', text); th.setAttribute('scope', 'col'); heading.append(th); }
            thead.append(heading); const tbody = node('tbody');
            const cell = (value, detail = '', explanation = '') => {
                const td = node('td'); td.append(node('span', value, 'probelauf-end-value'));
                if (detail) td.append(node('small', detail));
                if (explanation) td.append(info('Mehr zum Vergleichswert', explanation));
                return td;
            };
            const row = (label, a, b) => { const tr = node('tr'), th = node('th', label); th.setAttribute('scope', 'row'); tr.append(th, a, b); tbody.append(tr); };
            const { real, play, budgetDelta } = review;
            const unavailable = model => model.status === 'pending' && !failure ? 'wird gerechnet …' : 'nicht berechenbar';
            const error = model => model.error || failure?.message || '';
            const planInfo = (model, key) => {
                const fixed = model.fixedPlan;
                if (!fixed) return '';
                let value;
                if (key === 'action') {
                    const action = summarizeBalanceAction(fixed.action, fixed.action);
                    if (action.verb === model.action?.verb && action.amount === model.action?.amount && action.goldPurchaseAmount === model.action?.goldPurchaseAmount) return '';
                    value = `${action.verb}${Number.isFinite(action.amount) ? ' · ' + money(action.amount) + (action.amountUnit === '€ netto' ? ' netto' : '') : ''}`;
                    if (action.goldPurchaseAmount > 0 && action.verb !== 'Gold kaufen') value += ` · Gold kaufen: ${money(action.goldPurchaseAmount)}`;
                } else {
                    const amount = key === 'liquidity' ? fixed.liquidityBefore : fixed.monthlyBudget;
                    if (Number.isFinite(model[key]) && Math.abs(amount - model[key]) < 0.005) return '';
                    value = key === 'liquidity' ? percent(amount) + ' des Ziels' : money(amount);
                }
                return `Plan ${model.year}, festgeschrieben am ${dateTime(fixed.committedAt)}: ${value}. Die Vorschau heute ersetzt diesen Plan nicht.`;
            };
            const delta = budgetDelta === null ? '' : budgetDelta === 0 ? 'unverändert' : `${money(Math.abs(budgetDelta))} ${budgetDelta > 0 ? 'mehr' : 'weniger'}`;
            const budgetCell = (model, detail = '') => cell(model.monthlyBudget === null ? unavailable(model) : money(model.monthlyBudget), detail,
                [error(model), planInfo(model, 'monthlyBudget')].filter(Boolean).join(' '));
            row(`Monatsbudget (Vorschau heute) ${real.year}`, budgetCell(real), budgetCell(play, delta));
            const actionCell = model => {
                const td = cell(model.action?.verb || unavailable(model), '', [error(model), model.calculatedAt
                    ? `Frisch gerechnet am ${dateTime(model.calculatedAt)}. So sähe es aus, wenn heute Jahresabschluss wäre. ${model.action?.note || ''}` : '', planInfo(model, 'action')].filter(Boolean).join(' '));
                if (model.action) td.append(node('span', Number.isFinite(model.action.amount)
                    ? money(model.action.amount) + (model.action.amountUnit === '€ netto' ? ' netto' : '') : '–', 'probelauf-end-value probelauf-end-amount'));
                if (model.action?.goldPurchaseAmount > 0 && model.action.verb !== 'Gold kaufen') td.append(node('small', `Gold kaufen · ${money(model.action.goldPurchaseAmount)}`));
                return td;
            };
            row('Handlungsanweisung (Vorschau heute)', actionCell(real), actionCell(play));
            const liquidityCell = model => cell(model.liquidity === null ? unavailable(model) : percent(model.liquidity), model.liquidity === null ? '' : 'des Ziels vor Umsetzung',
                [error(model), planInfo(model, 'liquidity')].filter(Boolean).join(' '));
            row('Liquidität (Vorschau heute)', liquidityCell(real), liquidityCell(play));
            const mcCell = (model, playing) => cell(model.monteCarlo ? percent(model.monteCarlo.successPct) : 'nicht gerechnet',
                model.monteCarlo ? `letzter Lauf vom ${dateTime(model.monteCarlo.completedAt)}` : '',
                model.monteCarlo ? '' : playing ? 'Im Spielbereich wurde noch kein Monte-Carlo-Lauf für diesen Haushalt gerechnet. Ein aus den echten Daten kopierter Lauf zählt hier nicht.' : 'Für diesen Haushalt ist kein Monte-Carlo-Lauf gespeichert.');
            row('Erfolgsquote Monte Carlo', mcCell(real, false), mcCell(play, true));
            table.append(thead, tbody); content.append(table);
            const changes = node('details', undefined, 'probelauf-end-changes'), summary = node('summary');
            summary.append(node('strong', 'Deine Änderungen'), node('small', `${review.changes.count} ${review.changes.count === 1 ? 'Änderung' : 'Änderungen'}${review.changes.areas.length ? ' · ' + review.changes.areas.join(', ') : ''}`));
            changes.append(summary);
            appendChanges(doc, changes, review.changes);
            content.append(changes);
            if (!review.transfer.eligible) content.append(node('p', 'Beim Beenden wird alles im Spielbereich verworfen. Deine echten Daten werden dabei nicht verändert.', 'probelauf-end-explanation'));
        };
        renderContent();
        const foot = node('footer', undefined, 'close-dialog-foot');
        const actions = node('div', undefined, 'close-dialog-actions');
        const cancel = node('button', 'Weiter spielen', 'ds-button ds-button-secondary'); cancel.type = 'button'; cancel.dataset.pageChoiceCancel = '';
        const discard = node('button', comparison ? 'Verwerfen' : 'Spielbereich beenden', `ds-button ds-button-${comparison ? 'secondary' : 'primary'}`); discard.type = 'button'; discard.dataset.pageChoiceAccept = '';
        let transfer;
        const reason = node('small', review.transfer.eligible ? 'Übernehmen ist nur als Ganzes möglich.' : 'Übernehmen ist für diesen Spielbereich gesperrt.', 'probelauf-end-explanation'); reason.id = 'probelaufTransferReason';
        const updateTransfer = () => {
            actions.replaceChildren(cancel, discard);
            if (comparison && review.transfer.eligible) {
                if (!transfer) {
                    transfer = node('button', 'Übernehmen …', 'ds-button ds-button-primary'); transfer.type = 'button'; transfer.setAttribute('aria-describedby', 'probelaufTransferReason');
                    transfer.addEventListener('click', () => { if (!transfer.disabled) finish('transfer'); });
                }
                transfer.disabled = loading || Boolean(failure); transfer.title = 'Alle Änderungen übernehmen';
                actions.append(transfer);
            }
            reason.hidden = !comparison || !loading && !review.transfer.eligible;
            reason.textContent = loading ? 'Der Vergleich wird gerechnet …' : 'Übernehmen ist nur als Ganzes möglich.';
            note.hidden = !comparison;
            note.replaceChildren(node('span', review.transfer.eligible ? 'Verwerfen löscht den Spielbereich. Übernehmen ersetzt deine echten Daten.' : 'Verwerfen löscht den Spielbereich. Deine Daten bleiben unverändert.'));
            if (review.transfer.eligible) note.append(info('Mehr zu Verwerfen und Übernehmen', 'Verwerfen schließt den Spielbereich und öffnet die Startseite. Deine echten Daten und Sicherungspunkte bleiben erhalten. Übernehmen zeigt zuerst alle Änderungen zur Bestätigung und legt vor dem Ersetzen einen Wiederherstellungspunkt an.'));
        };
        const note = node('div', undefined, 'close-dialog-footnote');
        updateTransfer();
        foot.append(actions);
        if (comparison) foot.append(reason, note);
        dialog.append(head, content, foot);
        const finish = (accepted, error = null) => {
            if (settled) return; settled = true;
            clearTimeout(timer);
            listeners.forEach(([element, type, callback]) => element.removeEventListener(type, callback));
            if (dialog.open) dialog.close(); dialog.remove(); opener?.focus?.();
            if (error) reject(error); else resolve({ choice: accepted, review });
        };
        cancel.addEventListener('click', () => finish(false)); cross.addEventListener('click', () => finish(false));
        discard.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.addEventListener('close', () => finish(false));
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); finish(false); } });
        try {
            doc.body.append(dialog);
            bindInfoPopovers(doc, { root: dialog, listen(element, type, callback) { listeners.push([element, type, callback]); element.addEventListener(type, callback); } });
            dialog.showModal(); cancel.focus();
            // Erst nach einem sichtbaren Browserframe lesen und rechnen.
            if (loadReview) timer = setTimeout(async () => {
                try { const loaded = await loadReview(); if (settled) return; review = loaded; }
                catch (error) { if (settled) return; failure = error; }
                loading = false; renderContent(); updateTransfer();
                bindInfoPopovers(doc, { root: dialog, listen(element, type, callback) { listeners.push([element, type, callback]); element.addEventListener(type, callback); } });
            }, 32);
        } catch (error) { finish(false, error); }
    });
}

export async function requestProbelaufEndDialog({ doc, opener = doc?.activeElement, state, loadReview } = {}) {
    const empty = () => buildProbelaufEndReview({ state, realRecords: {}, playRecords: {},
        calculationError: loadReview ? undefined : new Error('Für den Vergleich fehlen die gespeicherten Bereiche.') });
    for (;;) {
        const { choice, review } = await openEndDialog({ doc, opener, review: empty(), loadReview });
        if (choice !== 'transfer') return choice;
        if (await transferDialog({ doc, opener, review })) return { action: 'transfer', review };
    }
}
