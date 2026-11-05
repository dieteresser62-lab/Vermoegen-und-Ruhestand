import { readImmobilien, immobilienIncome } from '../profile/profile-immobilien.js';
import { syncRentalIncome } from './tranchen-manager-immobilien.js';
import { appNow } from '../shared/app-clock.js';
import { readIncome, writeIncome, incomeErrors, incomeMonthInput, incomeMonthDisplay, fixedMonthlyIncome } from '../profile/profile-income.js';
import { canonicalDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';
import { editorMonth, bindEditorCommit, editorCell, showEditorErrors, editorEmpty } from './tranchen-manager-income-fields.js';

const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const draft = doc => readIncome(doc.getElementById('profileEinkuenfte')?.value, { draft: true });
const emit = (field, doc) => field?.dispatchEvent(new (doc.defaultView?.Event || Event)('input', { bubbles: true }));
const monthNow = () => `${appNow().getFullYear()}-${String(appNow().getMonth() + 1).padStart(2, '0')}`;

function summaries(entries, doc) {
    const rentals = immobilienIncome(readImmobilien(doc.getElementById('profileImmobilien')?.value));
    syncRentalIncome(doc);
    const errors = incomeErrors(entries), now = monthNow();
    showEditorErrors(doc, doc.getElementById('managerIncomeBody'), errors);
    const status = doc.getElementById('profileIncomeStatus');
    if (status) status.textContent = errors.length ? 'Noch nicht gespeichert. Prüfe die markierten Felder.' : '';
    const pension = Number(canonicalDecimalInput(doc.getElementById('profileRenteMonatlich')?.value || '0', doc.getElementById('profileRenteMonatlich'))) || 0;
    const start = incomeMonthInput(doc.getElementById('profileRentenbeginn')?.value);
    const fixed = month => fixedMonthlyIncome([...entries.filter(entry => Number.isFinite(entry.betragMonat)), ...rentals], month) + (!start || start <= month ? pension : 0);
    const changes = entries.filter(entry => entry.art === 'sonstige').flatMap(entry => {
        const end = entry.bis && new Date(`${entry.bis}-01T12:00:00Z`);
        if (end && Number.isFinite(end.getTime())) end.setUTCMonth(end.getUTCMonth() + 1);
        return [entry.ab, end && Number.isFinite(end.getTime()) ? end.toISOString().slice(0, 7) : null];
    }).concat(start).filter(month => month && month > now).sort();
    const next = changes[0];
    for (const [id, text] of Object.entries({
        profileIncomeCurrentLabel: `Fest ${appNow().getFullYear()}`,
        profileIncomeCurrent: `${money(fixed(now))} / Monat`,
        profileIncomeNextLabel: next ? `Fest ab ${incomeMonthDisplay(next)}` : 'Fest künftig',
        profileIncomeNext: next ? `${money(fixed(next))} / Monat` : '—',
        profileIncomeOnce: money(entries.filter(entry => !entry.art).reduce((sum, entry) => sum + (Number(entry.betrag) || 0), 0))
    })) { const el = doc.getElementById(id); if (el) el.textContent = text; }
    const parts = [];
    if (pensionPresent(doc)) parts.push(`Rente ${money(pension)}/Monat${start ? ` ${start <= now ? 'seit' : 'ab'} ${incomeMonthDisplay(start)}` : ''}`);
    for (const entry of entries.filter(entry => entry.art)) parts.push(`${entry.bezeichnung || 'Sonstige Einkünfte'} ${money(entry.betragMonat || 0)}/Monat${entry.ab ? ` ab ${incomeMonthDisplay(entry.ab)}` : ''}${entry.bis ? ` bis ${incomeMonthDisplay(entry.bis)}` : ''}`);
    rentals.forEach(entry => parts.push(`${entry.bezeichnung} ${money(entry.betragMonat)}/Monat`));
    const once = entries.filter(entry => !entry.art);
    if (once.length) parts.push(`${once.length} ${once.length === 1 ? 'einmalige Einkunft' : 'einmalige Einkünfte'} ${money(once.reduce((sum, entry) => sum + (Number(entry.betrag) || 0), 0))}${once.length === 1 && once[0].monat ? ` (${incomeMonthDisplay(once[0].monat)})` : ''}`);
    const summary = doc.getElementById('managerIncomeSummary');
    if (summary) summary.textContent = parts.join(' · ') || 'Keine Einkünfte erfasst';
    editorEmpty(doc, 'profileFixedIncomeEmpty', !rentals.length && !pensionPresent(doc) && !entries.some(entry => entry.art), 'profileFixedIncomeHeadings');
    editorEmpty(doc, 'profileOneTimeIncomeEmpty', !once.length, 'profileOneTimeIncomeHeadings');
    const dates = doc.getElementById('profileIncomeOnceDates');
    if (dates) dates.textContent = once.map(entry => incomeMonthDisplay(entry.monat)).filter(Boolean).join(' · ') || 'Keine Einmalbeträge geplant';
}


function update(entries, doc, rerender = false, notify = true, newEntryId = null) {
    const field = doc.getElementById('profileEinkuenfte');
    field.value = writeIncome(entries);
    if (rerender) applyPersonIncomeToDom(entries, doc, true, newEntryId);
    else {
        field.dataset.rendered = field.value;
        summaries(entries, doc);
    }
    if (notify) emit(field, doc);
}

function pensionPresent(doc) {
    return doc.getElementById('profilePensionRow')?.dataset.added === 'true'
        || Number(canonicalDecimalInput(doc.getElementById('profileRenteMonatlich')?.value || '0', doc.getElementById('profileRenteMonatlich'))) > 0
        || Boolean(doc.getElementById('profileRentenbeginn')?.value);
}

/** @param {import("../../typcheck/tranches-ui.js").IncomeDraft[]} entries
 * @param doc Dokument mit Einkünftefeldern.
 * @param {boolean} [force]
 * @param {string|null} [newEntryId]
 * @returns {void} */
export function applyPersonIncomeToDom(entries, doc, force = false, newEntryId = null) {
    const field = doc.getElementById('profileEinkuenfte');
    if (!field) return;
    field.value = writeIncome(entries);
    const pensionRow = doc.getElementById('profilePensionRow');
    if (pensionRow) pensionRow.hidden = !pensionPresent(doc);
    if (!force && field.dataset.rendered === field.value) { summaries(entries, doc); return; }
    field.dataset.rendered = field.value;
    const fixed = doc.getElementById('profileFixedIncomeRows'), once = doc.getElementById('profileOneTimeIncomeRows');
    if (!fixed || !once) return;
    fixed.replaceChildren(); once.replaceChildren();
    entries.forEach((entry, index) => {
        const line = doc.createElement('div');
        line.className = 'pv-income-row';
        line.dataset.incomeKind = entry.art ? 'fixed' : 'once';
        const host = entry.art ? fixed : once;
        const add = (key, label, options) => {
            if (key === 'anpassung') {
                const group = doc.createElement('div'); group.className = 'pv-person-segments';
                group.setAttribute('role', 'group'); group.setAttribute('aria-label', `Anpassung, Einkünfte ${index + 1}`);
                for (const [value, text] of options) {
                    const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-button ds-button-secondary';
                    button.textContent = text; button.setAttribute('aria-pressed', String(entry[key] === value));
                    if (value === 'lohn') button.title = 'wie Löhne · sinkt nominal nie';
                    button.addEventListener('click', () => {
                        if (field.disabled) return;
                        const current = draft(doc); current[index][key] = value;
                        for (const sibling of group.children) sibling.setAttribute('aria-pressed', String(sibling === button));
                        update(current, doc);
                    });
                    group.appendChild(button);
                }
                line.appendChild(editorCell(doc, group)); return;
            }
            const input = doc.createElement(options ? 'select' : 'input');
            input.id = `income-${index}-${key}`; input.className = options ? 'ds-select' : 'ds-input';
            input.setAttribute('aria-label', `${label}, Einkünfte ${index + 1}`);
            if (options) for (const [value, text] of options) {
                const option = doc.createElement('option'); option.value = value; option.textContent = text;
                if (key === 'art' && value === 'rente') option.disabled = pensionPresent(doc);
                input.appendChild(option);
            }
            const amount = ['betrag', 'betragMonat'].includes(key), month = ['ab', 'bis', 'monat'].includes(key);
            if (!options) input.type = 'text';
            if (amount) { input.setAttribute('inputmode', 'decimal'); input.setAttribute('lang', 'de'); input.setAttribute('data-money-input', ''); }
            if (month) input.placeholder = 'MM.JJJJ';
            if (key === 'bezeichnung') input.maxLength = 60;
            input.value = amount ? displayDecimalInput(entry[key] ?? '', input) : month ? incomeMonthDisplay(entry[key]) : entry[key] ?? '';
            const change = () => {
                if (field.disabled) return;
                const current = draft(doc);
                if (key === 'art' && input.value === 'rente') {
                    if (pensionPresent(doc)) return;
                    const row = current[index];
                    if (pensionRow) pensionRow.dataset.added = 'true';
                    if (doc.getElementById('profileRenteBezeichnung')) doc.getElementById('profileRenteBezeichnung').value = row.bezeichnung || '';
                    doc.getElementById('profileRenteMonatlich').value = displayDecimalInput(row.betragMonat || 0, doc.getElementById('profileRenteMonatlich'));
                    doc.getElementById('profileRentenbeginn').value = incomeMonthDisplay(row.ab);
                    doc.getElementById('profileRentenanpassungArt').value = row.anpassung === 'lohn' ? 'wage' : row.anpassung === 'inflation' ? 'cpi' : 'fix';
                    doc.getElementById('profileRentenanpassungPct').value = '0';
                    current.splice(index, 1); update(current, doc, true);
                    if (pensionRow) pensionRow.hidden = false;
                    return;
                }
                current[index][key] = amount ? Number(canonicalDecimalInput(input.value, input) || 'NaN') : month ? editorMonth(input.value) : input.value;
                input.removeAttribute('aria-invalid');
                update(current, doc, false, !amount);
            };
            input.addEventListener(options ? 'change' : 'input', change);
            bindEditorCommit(input, { amount, month, openMonth: ['ab', 'bis'].includes(key), fresh: entry.id === newEntryId,
                commit: () => { if (!field.disabled) emit(field, doc); } });
            if (amount) {
                const frame = doc.createElement('div'); frame.className = 'ds-unit-frame';
                const euro = doc.createElement('span'); euro.textContent = '€';
                frame.appendChild(input); frame.appendChild(euro); line.appendChild(editorCell(doc, frame));
            } else line.appendChild(editorCell(doc, input));
        };
        if (entry.art) {
            add('art', 'Art', [['sonstige', 'Sonstige Einkünfte'], ['rente', 'Gesetzliche Rente']]);
            add('bezeichnung', 'Bezeichnung'); add('betragMonat', 'Betrag pro Monat'); add('ab', 'ab'); add('bis', 'bis');
            add('anpassung', 'Anpassung', [['keine', 'keine'], ['inflation', 'Inflation'], ['lohn', 'wie Löhne']]);
        } else { add('monat', 'Monat/Jahr'); add('betrag', 'Betrag'); add('bezeichnung', 'Bezeichnung'); }
        const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'ds-button ds-button-secondary';
        remove.textContent = '×'; remove.setAttribute('aria-label', `Einkünfte ${index + 1} entfernen`);
        remove.addEventListener('click', () => { if (field.disabled) return; const current = draft(doc); current.splice(index, 1); update(current, doc, true); });
        line.appendChild(remove); host.appendChild(line);
    });
    summaries(entries, doc);
}

const bound = new WeakSet();
/** @param doc Dokument mit Einkünftefeldern.
 * @returns {void} */
export function bindPersonIncome(doc) {
    if (bound.has(doc) || !doc.getElementById('profileEinkuenfte')) return;
    bound.add(doc);
    for (const [id, fixed] of [['profileFixedIncomeAdd', true], ['profileOneTimeIncomeAdd', false]]) doc.getElementById(id)?.addEventListener('click', () => {
        if (doc.getElementById('profileEinkuenfte').disabled) return;
        const entries = draft(doc), id = globalThis.crypto?.randomUUID?.() || `income-${Date.now()}-${Math.random()}`;
        entries.push(fixed ? { id, art: 'sonstige', bezeichnung: '', betragMonat: 0, ab: null, bis: null, anpassung: 'keine' }
            : { id, monat: null, betrag: 0, bezeichnung: '' });
        update(entries, doc, true, true, id);
        doc.getElementById(`income-${entries.length - 1}-bezeichnung`)?.focus?.();
    });
    for (const id of ['profileRenteMonatlich', 'profileRentenbeginn', 'profileRenteBezeichnung', 'profileRentenanpassungPct']) {
        const input = doc.getElementById(id); if (!input) continue;
        if (id === 'profileRentenbeginn') input.addEventListener('input', () => {
            const value = editorMonth(input.value);
            if (/^\d{4}-\d{2}$/.test(value || '')) input.value = incomeMonthDisplay(value);
        });
        input.addEventListener('input', () => summaries(draft(doc), doc));
        bindEditorCommit(input, { amount: id === 'profileRenteMonatlich', month: id === 'profileRentenbeginn', commit: () => {
            if (id === 'profileRenteMonatlich') input.dispatchEvent(new (doc.defaultView?.Event || Event)('change', { bubbles: true }));
            else emit(input, doc);
        } });
    }
}
