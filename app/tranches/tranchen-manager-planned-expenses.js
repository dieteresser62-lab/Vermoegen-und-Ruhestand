/** @import * as D from "../../typcheck/datenvertraege.js" */
import { appNow } from '../shared/app-clock.js';
import { persistenceStorage, PersistenceFacade } from '../shared/persistence-facade.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { plannedExpenseErrors, readPlannedExpenses, savePlannedExpenses, isFixedExpense } from '../profile/household-planned-expenses.js';
import { incomeMonthDisplay } from '../profile/profile-income.js';
import { canonicalDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';
import { editorMonth, bindEditorCommit, editorCell, showEditorErrors, editorEmpty } from './tranchen-manager-income-fields.js';

const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const currentMonth = () => `${appNow().getFullYear()}-${String(appNow().getMonth() + 1).padStart(2, '0')}`;

/** @param {D.PlannedExpense[]} items
 * @param doc Dokument mit Ausgabefeldern.
 * @returns {void} */
export function renderPlannedExpenseSummary(items, doc) {
    const now = currentMonth(), fixed = items.filter(isFixedExpense), once = /** @type {D.PlannedExpenseOnce[]} */ (items.filter(item => !isFixedExpense(item)));
    const monthly = month => fixed.filter(item => (!item.ab || item.ab <= month) && (!item.bis || item.bis >= month)).reduce((sum, item) => sum + (Number(item.betragMonat) || 0), 0);
    const changes = fixed.flatMap(item => {
        const end = item.bis && new Date(`${item.bis}-01T12:00:00Z`);
        if (end && Number.isFinite(end.getTime())) end.setUTCMonth(end.getUTCMonth() + 1);
        return [item.ab, end && Number.isFinite(end.getTime()) ? end.toISOString().slice(0, 7) : null];
    }).filter(month => month && month > now).sort();
    const next = [...once].filter(item => item.monat >= now).sort((a, b) => a.monat.localeCompare(b.monat))[0];
    for (const [id, text] of Object.entries({
        managerExpenseFixedLabel: `Fest ${appNow().getFullYear()}`, managerExpenseFixed: `${money(monthly(now))} / Monat`,
        managerExpenseFixedNext: changes[0] ? `ab ${incomeMonthDisplay(changes[0])}: ${money(monthly(changes[0]))} / Monat` : 'Keine Änderung geplant',
        managerExpenseOnce: money(once.reduce((sum, item) => sum + (Number(item.betrag) || 0), 0)),
        managerExpenseYears: [...new Set(once.map(item => item.monat?.slice(0, 4)).filter(Boolean))].sort().join(', '),
        managerExpenseNext: next ? money(next.betrag || 0) : '—',
        managerExpenseNextLabel: next ? `${incomeMonthDisplay(next.monat)} · ${next.bezeichnung}` : 'Keine Zahlung geplant'
    })) { const el = doc.getElementById(id); if (el) el.textContent = text; }
    const summary = doc.getElementById('managerExpensesSummary');
    if (summary) summary.textContent = items.map(item => `${item.bezeichnung || 'Geplante Ausgabe'} ${money((isFixedExpense(item) ? item.betragMonat : item.betrag) || 0)}${isFixedExpense(item) ? `/Monat${item.ab ? ` ab ${incomeMonthDisplay(item.ab)}` : ''}${item.bis ? ` bis ${incomeMonthDisplay(item.bis)}` : ''}` : item.monat ? ` (${incomeMonthDisplay(item.monat)})` : ''}`).join(' · ') || 'Keine geplanten Ausgaben';
    editorEmpty(doc, 'managerFixedExpenseEmpty', !fixed.length, 'managerFixedExpenseHeadings');
    editorEmpty(doc, 'managerOneTimeExpenseEmpty', !once.length, 'managerOneTimeExpenseHeadings');
}


/** Eigenständiger Haushaltsrecord, derselbe Navigations- und Transaktionsbesitzer wie die Planfelder.
 * @param {{doc?: Document, getProfileId?: () => string, runOperation?: (execute: Function) => Promise<unknown>, notify?: () => void, blocked?: () => boolean, storage?: typeof persistenceStorage, persistence?: typeof PersistenceFacade, schedule?: typeof setTimeout, unschedule?: typeof clearTimeout}} [options]
 * @returns Controller mit Entwurf, Speicherbestätigung und Navigation. */
export function createManagerPlannedExpenses({ doc, getProfileId, runOperation, notify = () => {}, blocked = () => false,
    storage = persistenceStorage, persistence = PersistenceFacade, schedule = setTimeout, unschedule = clearTimeout } = {}) {
    const host = doc.getElementById('managerPlannedExpenses');
    let items = [], baseline = '[]', scope = null, origin = null, revision = 0, epoch = 0, timer = null, writing = null, error = '', disposed = false;
    const node = id => doc.getElementById(id);
    const dirty = () => JSON.stringify(items) !== baseline;
    const pause = () => { if (timer !== null) unschedule(timer); timer = null; };
    const current = (key = scope?.key, id = origin, generation = epoch) => {
        if (disposed || generation !== epoch || id !== getProfileId()) return false;
        try { return readBalanceHouseholdPlan({ storage, profileId: id }).scope?.key === key; } catch { return false; }
    };
    function syncBlocked(external = blocked()) {
        const locked = !scope || Boolean(writing) || external || persistence.hasSyncWriteBlocks?.() || Boolean(globalThis.window?.__profileRecoveryBlocker);
        for (const el of /** @type {NodeListOf<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>} */ (host?.querySelectorAll?.('input, select, button[data-expense-action]')) || []) el.disabled = locked;
    }
    function status() {
        const errors = plannedExpenseErrors(items);
        showEditorErrors(doc, host, errors);
        if (node('managerExpenseStatus')) node('managerExpenseStatus').textContent = errors.length ? 'Noch nicht gespeichert. Prüfe die markierten Felder.'
            : error ? `Nicht gespeichert: ${error}` : writing ? 'Wird gespeichert …' : dirty() ? 'Änderungen warten auf Bestätigung …' : scope ? 'Gespeichert' : 'Planbereich noch nicht bestätigt.';
        if (node('managerExpenseRetry')) node('managerExpenseRetry').hidden = !error;
        renderPlannedExpenseSummary(items, doc); syncBlocked(); notify();
    }
    function changed() { revision++; error = ''; status(); arm(); }
    function render(newEntryId = null) {
        const fixed = node('managerFixedExpenseRows'), once = node('managerOneTimeExpenseRows');
        if (!fixed || !once) return;
        fixed.replaceChildren(); once.replaceChildren();
        items.forEach((item, index) => {
            const line = doc.createElement('div'); line.className = isFixedExpense(item) ? 'pv-fixed-expense-row' : 'pv-once-income-row';
            const add = (key, label, options) => {
                if (options) {
                    const group = doc.createElement('div'); group.className = 'pv-person-segments'; group.id = `expense-${index}-${key}`;
                    group.setAttribute('role', 'group'); group.setAttribute('aria-label', `${label}, geplante Ausgaben ${index + 1}`);
                    for (const [value, text] of options) {
                        const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-button ds-button-secondary';
                        button.dataset.expenseAction = 'adjustment'; button.textContent = text; button.setAttribute('aria-pressed', String(item[key] === value));
                        button.addEventListener('click', () => {
                            if (button.disabled || !current()) return;
                            item[key] = value;
                            for (const sibling of group.children) sibling.setAttribute('aria-pressed', String(sibling === button));
                            changed();
                        });
                        group.appendChild(button);
                    }
                    line.appendChild(editorCell(doc, group)); return;
                }
                const field = doc.createElement('input'); field.className = 'ds-input';
                field.id = `expense-${index}-${key}`; field.setAttribute('aria-label', `${label}, geplante Ausgaben ${index + 1}`);
                const amount = ['betrag', 'betragMonat'].includes(key), month = ['ab', 'bis', 'monat'].includes(key);
                field.type = 'text';
                if (amount) { field.setAttribute('inputmode', 'decimal'); field.setAttribute('lang', 'de'); field.setAttribute('data-money-input', ''); }
                if (month) field.placeholder = 'MM.JJJJ';
                if (key === 'bezeichnung') field.maxLength = 60;
                field.value = amount ? displayDecimalInput(item[key] ?? '', field) : month ? incomeMonthDisplay(item[key]) : item[key] ?? '';
                field.addEventListener('input', () => {
                    if (field.disabled || !current()) return;
                    item[key] = amount ? Number(canonicalDecimalInput(field.value, field) || 'NaN') : month ? editorMonth(field.value) : field.value;
                    changed();
                });
                bindEditorCommit(field, { amount, month, openMonth: ['ab', 'bis'].includes(key), fresh: item.id === newEntryId,
                    commit: () => { if (!field.disabled && current()) arm(); } });
                if (amount) { const frame = doc.createElement('div'); frame.className = 'ds-unit-frame'; const euro = doc.createElement('span'); euro.textContent = '€'; frame.append(field, euro); line.appendChild(editorCell(doc, frame)); }
                else line.appendChild(editorCell(doc, field));
            };
            if (isFixedExpense(item)) { add('bezeichnung', 'Bezeichnung'); add('betragMonat', 'Betrag pro Monat'); add('ab', 'ab'); add('bis', 'bis'); add('anpassung', 'Anpassung', [['keine', 'keine'], ['inflation', 'Inflation']]); }
            else { add('monat', 'Monat/Jahr'); add('betrag', 'Betrag'); add('bezeichnung', 'Bezeichnung'); }
            const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'ds-button ds-button-secondary'; remove.dataset.expenseAction = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Geplante Ausgaben ${index + 1} entfernen`);
            remove.addEventListener('click', () => { if (remove.disabled || !current()) return; items.splice(index, 1); render(); changed(); });
            line.appendChild(remove); (isFixedExpense(item) ? fixed : once).appendChild(line);
        });
        status();
    }
    function arm() {
        pause();
        if (dirty() && !writing && !error && !blocked() && !plannedExpenseErrors(items).length) {
            const generation = epoch, id = origin, key = scope?.key;
            timer = schedule(() => { if (current(key, id, generation)) { timer = null; void flush(); } }, 300);
        }
    }
    async function drain() {
        if (!scope || !current() || plannedExpenseErrors(items).length) return false;
        const batch = structuredClone(items), generation = epoch, id = origin, key = scope.key;
        try {
            await runOperation(async operation => { operation.check(); operation.commit(); await savePlannedExpenses({ scope, items: batch, storage, persistence,
                navigationOperation: operation, isCurrent: () => current(key, id, generation) }); });
            baseline = JSON.stringify(batch); return true;
        } catch (caught) { error = caught.message; return false; }
    }
    function flush() {
        pause();
        if (writing) return writing;
        if (!dirty()) return Promise.resolve(!error);
        if (plannedExpenseErrors(items).length) return Promise.resolve(false);
        writing = Promise.resolve().then(drain).finally(() => { writing = null; status(); }); status(); return writing;
    }
    function refresh() {
        if (writing || dirty() || disposed) return;
        pause(); epoch++; origin = getProfileId(); scope = null; error = ''; items = [];
        try { const plan = readBalanceHouseholdPlan({ storage, profileId: origin }); if (plan.status === 'valid') { scope = plan.scope; items = readPlannedExpenses({ storage, scope }); } }
        catch (caught) { scope = null; error = caught.message; }
        baseline = JSON.stringify(items); render();
    }
    function discard() { if (writing) return false; pause(); items = JSON.parse(baseline); error = ''; epoch++; render(); return true; }
    for (const [id, fixed] of [['managerFixedExpenseAdd', true], ['managerOneTimeExpenseAdd', false]]) node(id)?.addEventListener('click', () => {
        if (node(id).disabled || !scope || !current()) return;
        const itemId = globalThis.crypto?.randomUUID?.() || `expense-${Date.now()}-${Math.random()}`;
        items.push(fixed ? { id: itemId, bezeichnung: '', betragMonat: 0, ab: null, bis: null, anpassung: 'keine' } : { id: itemId, monat: null, betrag: 0, bezeichnung: '' }); render(itemId); changed();
        node(`expense-${items.length - 1}-bezeichnung`)?.focus?.();
    });
    node('managerExpensesToggle')?.addEventListener('click', () => {
        const body = node('managerExpensesBody'); if (!body) return;
        body.hidden = !body.hidden; node('managerExpensesToggle').setAttribute('aria-expanded', String(!body.hidden));
        node('managerExpensesAction').textContent = body.hidden ? '▸ zeigen' : '▾ ausblenden';
    });
    node('managerExpenseRetry')?.addEventListener('click', () => { error = ''; void flush(); });
    refresh();
    return { refresh, flush, discard, pause, resume: arm, syncBlocked, read: () => ({ revision, dirty: dirty(), writing: Boolean(writing), error, scope: scope?.key }),
        dispose: () => { disposed = true; pause(); } };
}
