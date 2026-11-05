import { appNow } from '../shared/app-clock.js';
import { readImmobilien, writeImmobilien, immobilienErrors, immobilienIncome } from '../profile/profile-immobilien.js';
import { incomeMonthDisplay } from '../profile/profile-income.js';
import { editorMonth } from './tranchen-manager-income-fields.js';
import { canonicalDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';
import { escapeHtml as esc } from '../shared/security-utils.js';
import { infoPopoverHtml, bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { requestPageConfirmation } from '../shared/page-dialog.js';

const states = new WeakMap();
const money = value => `${value.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`;
const homeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/></svg>';
const node = (doc, id) => doc.getElementById(id);
const field = doc => node(doc, 'profileImmobilien');
const entries = doc => readImmobilien(field(doc)?.value);
const button = (action, label, secondary = true) => `<button type="button" class="ds-button ${secondary ? 'ds-button-secondary' : 'ds-button-primary'}" data-home-action="${action}">${label}</button>`;
function stateFor(doc) {
    if (!states.has(doc)) states.set(doc, { draft: null, open: null, fresh: false, notify: () => {}, blocked: () => false });
    return states.get(doc);
}
const segments = (key, value, options) => `<div class="pv-person-segments" role="group" aria-label="${key === 'nutzung' ? 'Nutzung' : 'Anpassung der Miete'}">${options.map(([id, text]) => `<button type="button" class="ds-button ds-button-secondary" data-home-choice="${key}" data-value="${id}" aria-pressed="${id === value}">${text}</button>`).join('')}</div>`;
function editor(entry) {
    const input = (key, label, value, amount = false) => `<div class="ds-field"><label for="home-${key}">${label}</label>${amount ? '<div class="ds-unit-frame">' : ''}<input class="ds-input" id="home-${key}" data-home-field="${key}" type="text" ${amount ? 'inputmode="decimal" lang="de" data-money-input' : key === 'stand' ? 'placeholder="MM.JJJJ"' : 'maxlength="60"'} value="${esc(amount ? displayDecimalInput(value) : value)}">${amount ? '<span>€</span></div>' : ''}<small class="pv-field-error" data-home-error="${key}"></small></div>`;
    return `<div class="pv-home-editor"><div class="pv-home-fields">${input('bezeichnung', 'Bezeichnung', entry.bezeichnung)}<div class="ds-field"><label>Nutzung</label>${segments('nutzung', entry.nutzung, [['selbst', 'selbst genutzt'], ['vermietet', 'vermietet']])}</div>${input('wert', 'Wert (dein Anteil)', entry.wert, true)}${input('stand', 'Stand', incomeMonthDisplay(entry.stand))}</div><div class="pv-home-rent" ${entry.nutzung === 'vermietet' ? '' : 'hidden'}>${input('mieteNetto', 'Mieteinnahmen netto pro Monat', entry.mieteNetto, true)}<div class="ds-field"><label>Anpassung</label>${segments('anpassung', entry.anpassung, [['keine', 'keine'], ['inflation', 'Inflation']])}</div><p class="ds-help">Nach Kosten und Steuern. Zählt automatisch als Einkunft dieser Person – nicht zusätzlich unter Einkünfte eintragen.</p></div><div class="pv-home-residence" ${entry.nutzung === 'selbst' ? '' : 'hidden'}>${input('ortsueblicheMiete', 'ortsübliche Miete pro Monat (optional) ' + infoPopoverHtml('Ortsübliche Miete', 'Für die Erbschaftsteuer auf ein Wohnrecht; Mietspiegel. Leer: 4 % des Immobilienwerts pro Jahr. Höchstens Wert/18,6. Ändert die Miete nach Notverkauf nicht.'), entry.ortsueblicheMiete ?? '', true)}</div><div class="ds-actions">${button('save', 'Speichern', false)}${button('cancel', 'Abbrechen')}<span class="pv-home-spacer"></span>${entry.id ? button('remove', 'Immobilie entfernen') : ''}</div><p class="ds-help" id="home-save-status" role="status"></p></div>`;
}
function row(entry, expanded = false) {
    return `<button type="button" class="pv-home-row ds-button ds-button-quiet" data-home-open="${esc(entry.id)}" aria-expanded="${expanded}">${homeIcon}<strong>${esc(entry.bezeichnung || 'Neue Immobilie')}</strong><span>${entry.nutzung === 'vermietet' ? 'vermietet' : 'selbst genutzt'}</span><span class="pv-home-number">${entry.nutzung === 'vermietet' ? money(entry.mieteNetto) + '/Monat' : '—'}</span><span class="pv-home-number">${money(entry.wert)}</span><span class="pv-home-number ds-help">${esc(incomeMonthDisplay(entry.stand))}</span><span>${expanded ? '▾' : '▸'}</span></button>`;
}
function render(doc) {
    const host = node(doc, 'managerImmobilienRows'); if (!host) return;
    const state = stateFor(doc), homes = entries(doc);
    host.innerHTML = homes.map(entry => `<div class="pv-home-item${state.open === entry.id ? ' is-open' : ''}">${row(entry, state.open === entry.id)}${state.open === entry.id ? editor(state.draft) : ''}</div>`).join('')
        + (state.fresh ? `<div class="pv-home-item is-open">${row(state.draft, true)}${editor(state.draft)}</div>` : '');
    node(doc, 'managerImmobilienHeadings').hidden = !homes.length && !state.fresh;
    node(doc, 'managerImmobilienEmpty').hidden = Boolean(homes.length || state.fresh);
    node(doc, 'managerImmobilienSum').textContent = money(homes.reduce((sum, entry) => sum + entry.wert, 0));
    for (const input of host.querySelectorAll('[data-home-field="wert"], [data-home-field="mieteNetto"], [data-home-field="ortsueblicheMiete"]')) input.value = displayDecimalInput(state.draft?.[input.dataset.homeField] ?? (input.dataset.homeField === 'ortsueblicheMiete' ? '' : 0), input);
    bindInfoPopovers(doc);
    syncRentalIncome(doc);
}
/** @param doc Dokument mit Immobilien- und Einkünftefeldern.
 * @returns {void} */
export function syncRentalIncome(doc) {
    const host = node(doc, 'profileRentalIncome'); if (!host) return;
    const rentals = immobilienIncome(entries(doc));
    host.innerHTML = rentals.map(entry => `<div class="pv-rental-income"><span>${esc(entry.bezeichnung)}</span><span>${money(entry.betragMonat)}/Monat</span><small>aus Immobilien · <button type="button" class="ds-button ds-button-quiet ds-text-link" data-rental-home="${esc(entry.id.slice('immobilie:'.length))}">ändern</button></small></div>`).join('');
    let income = [];
    try { income = JSON.parse(node(doc, 'profileEinkuenfte')?.value || '{}').entries || []; } catch { /* Einkünfteeditor zeigt Prüfmeldung. */ }
    const warning = node(doc, 'profileRentalWarning');
    if (warning) warning.hidden = !rentals.length || !income.some(entry => /miet/i.test(entry.bezeichnung || ''));
}
/** @param {ReturnType<typeof readImmobilien>} homes
 * @param doc Dokument mit Immobilienfeldern.
 * @returns {void} */
export function applyPersonImmobilienToDom(homes, doc) {
    if (!field(doc)) return;
    field(doc).value = writeImmobilien(homes);
    if (!stateFor(doc).draft) render(doc);
    else syncRentalIncome(doc);
}
/** @param doc Dokument mit Immobilienfeldern.
 * @param {{notify?: ()=>void; blocked?: ()=>boolean}} [options]
 * @returns Zustand und Entwurfssteuerung oder null ohne Formular. */
export function bindPersonImmobilien(doc, options = {}) {
    const state = stateFor(doc); Object.assign(state, options);
    if (!field(doc)) return null;
    if (state.bound) return state;
    state.bound = true;
    const dirty = () => Boolean(state.draft && (state.fresh || JSON.stringify(state.draft) !== JSON.stringify(entries(doc).find(entry => entry.id === state.open))));
    function close() { state.open = null; state.draft = null; state.fresh = false; render(doc); state.notify(); }
    function collect() {
        if (!state.draft) return;
        for (const input of node(doc, 'managerImmobilienRows').querySelectorAll('[data-home-field]')) {
            const key = input.dataset.homeField;
            if (key === 'ortsueblicheMiete') {
                if (input.value.trim() === '') delete state.draft[key];
                else state.draft[key] = Number(canonicalDecimalInput(input.value, input) || 'NaN');
                continue;
            }
            state.draft[key] = ['wert', 'mieteNetto'].includes(key) ? Number(canonicalDecimalInput(input.value, input) || 'NaN') : key === 'stand' ? editorMonth(input.value) : input.value;
        }
    }
    function open(id) {
        if (state.blocked() || field(doc).disabled) return;
        if (state.draft && state.open !== id) { node(doc, 'home-save-status').textContent = 'Bitte zuerst speichern oder abbrechen.'; return; }
        if (state.open === id) { if (dirty()) node(doc, 'home-save-status').textContent = 'Bitte zuerst speichern oder abbrechen.'; else close(); return; }
        state.open = id; state.draft = { ...entries(doc).find(entry => entry.id === id) }; state.fresh = false; render(doc); state.notify();
    }
    async function action(name) {
        if (state.blocked() || field(doc).disabled) return;
        if (name === 'cancel') { close(); return; }
        if (name === 'add') {
            if (state.draft) { node(doc, 'home-save-status').textContent = 'Bitte zuerst speichern oder abbrechen.'; return; }
            const now = appNow();
            state.open = null; state.fresh = true; state.draft = { id: globalThis.crypto.randomUUID(), bezeichnung: '', nutzung: 'selbst', wert: 0, stand: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, mieteNetto: 0, anpassung: 'keine' };
            render(doc); node(doc, 'home-bezeichnung').focus(); state.notify(); return;
        }
        if (!state.draft) return;
        collect();
        const homes = entries(doc), index = homes.findIndex(entry => entry.id === state.open);
        if (name === 'remove') {
            if (state.fresh) { close(); return; }
            const id = state.open;
            if (!await requestPageConfirmation({ title: 'Immobilie entfernen?', description: `${state.draft.bezeichnung} wird mit den zugehörigen Mieteinnahmen entfernt.`, confirmLabel: 'Entfernen' })) return;
            if (state.open !== id || state.blocked() || field(doc).disabled) return;
            homes.splice(index, 1);
        } else if (name === 'save') {
            const errors = immobilienErrors([state.draft]);
            for (const el of node(doc, 'managerImmobilienRows').querySelectorAll('[data-home-error]')) el.textContent = errors.find(error => error.field === `immobilie-0-${el.dataset.homeError}`)?.message || '';
            if (errors.length) return;
            if (state.fresh) homes.push({ ...state.draft }); else homes[index] = { ...state.draft };
        } else return;
        field(doc).value = writeImmobilien(homes);
        close();
        field(doc).dispatchEvent(new (doc.defaultView?.Event || Event)('input', { bubbles: true }));
    }
    node(doc, 'managerImmobilien').addEventListener('click', event => {
        const choice = event.target.closest('[data-home-choice]');
        if (choice && state.draft && !state.blocked() && !field(doc).disabled) {
            collect(); const key = choice.dataset.homeChoice; state.draft[key] = choice.dataset.value;
            for (const sibling of choice.parentElement.children) sibling.setAttribute('aria-pressed', String(sibling === choice));
            node(doc, 'managerImmobilienRows').querySelector('.pv-home-rent').hidden = state.draft.nutzung !== 'vermietet';
            node(doc, 'managerImmobilienRows').querySelector('.pv-home-residence').hidden = state.draft.nutzung !== 'selbst';
            state.notify(); return;
        }
        const target = event.target.closest('[data-home-action], [data-home-open]');
        if (target?.dataset.homeAction) void action(target.dataset.homeAction);
        else if (target) open(target.dataset.homeOpen);
    });
    node(doc, 'managerImmobilienRows').addEventListener('input', () => { collect(); state.notify(); });
    node(doc, 'managerImmobilienRows').addEventListener('focusout', event => {
        const input = event.target.closest('[data-home-field]');
        if (input && ['wert', 'mieteNetto', 'ortsueblicheMiete'].includes(input.dataset.homeField)) input.value = displayDecimalInput(canonicalDecimalInput(input.value, input), input);
        if (input?.dataset.homeField === 'stand') { const month = editorMonth(input.value); if (/^\d{4}-\d{2}$/.test(month || '')) input.value = incomeMonthDisplay(month); }
    });
    node(doc, 'managerImmobilienRows').addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); void action('save'); }
    });
    node(doc, 'profileRentalIncome')?.addEventListener('click', event => {
        const target = event.target.closest('[data-rental-home]'); if (!target) return;
        if (state.open !== target.dataset.rentalHome) open(target.dataset.rentalHome);
        node(doc, 'managerImmobilien').scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    state.read = () => ({ dirty: dirty(), draft: state.draft });
    state.discard = close;
    render(doc);
    return state;
}
