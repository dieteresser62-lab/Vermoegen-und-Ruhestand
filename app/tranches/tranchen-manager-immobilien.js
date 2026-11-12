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
const node = (doc, id) => doc.getElementById(id);
const field = doc => node(doc, 'profileImmobilien');
const entries = doc => readImmobilien(field(doc)?.value);
const button = (action, label, secondary = true) => `<button type="button" class="ds-button ${secondary ? 'ds-button-secondary' : 'ds-button-primary'}" data-home-action="${action}">${label}</button>`;
const HOME_GROUPS = [['homeSelf', 'selbst', 'Immobilien selbst genutzt'], ['homeRented', 'vermietet', 'Immobilien vermietet']];
const HOME_CONTROLS = '[data-home-open], [data-home-action], [data-home-choice], [data-home-field]';
const MONEY_FIELDS = ['wert', 'mieteNetto', 'ortsueblicheMiete'];
// Findet dasselbe Bedienelement nach dem Neuaufbau der Tabelle wieder.
const controlKey = el => [el.id, el.dataset?.homeOpen, el.dataset?.homeAction, el.dataset?.homeChoice, el.dataset?.value].join('|');
function stateFor(doc) {
    if (!states.has(doc)) states.set(doc, { draft: null, raw: {}, open: null, fresh: false, reveal: null, focusHome: null, notify: () => {}, blocked: () => false, refresh: () => {} });
    return states.get(doc);
}
// Ein halb getippter Stand bleibt beim Neuaufbau lesbar.
const standText = stand => /^\d{4}-\d{2}$/.test(stand || '') ? incomeMonthDisplay(stand) : stand || '';
const segments = (key, value, options) => `<div class="pv-person-segments" role="group" aria-label="${key === 'nutzung' ? 'Nutzung' : 'Anpassung der Miete'}">${options.map(([id, text]) => `<button type="button" class="ds-button ds-button-secondary" data-home-choice="${key}" data-value="${id}" aria-pressed="${id === value}">${text}</button>`).join('')}</div>`;
function editor(entry) {
    const input = (key, label, value, amount = false) => `<div class="ds-field"><label for="home-${key}">${label}</label>${amount ? '<div class="ds-unit-frame">' : ''}<input class="ds-input" id="home-${key}" data-home-field="${key}" type="text" ${amount ? 'inputmode="decimal" lang="de" data-money-input' : key === 'stand' ? 'placeholder="MM.JJJJ"' : 'maxlength="60"'} value="${esc(amount ? displayDecimalInput(value) : value)}">${amount ? '<span>€</span></div>' : ''}<small class="pv-field-error" data-home-error="${key}"></small></div>`;
    return `<div class="pv-home-editor"><div class="pv-home-fields">${input('bezeichnung', 'Bezeichnung', entry.bezeichnung)}<div class="ds-field"><label>Nutzung</label>${segments('nutzung', entry.nutzung, [['selbst', 'selbst genutzt'], ['vermietet', 'vermietet']])}</div>${input('wert', 'Wert (dein Anteil)', entry.wert, true)}${input('stand', 'Stand', standText(entry.stand))}</div><div class="pv-home-rent" ${entry.nutzung === 'vermietet' ? '' : 'hidden'}>${input('mieteNetto', 'Mieteinnahmen netto pro Monat', entry.mieteNetto, true)}<div class="ds-field"><label>Anpassung</label>${segments('anpassung', entry.anpassung, [['keine', 'keine'], ['inflation', 'Inflation']])}</div><p class="ds-help">Nach Kosten und Steuern. Zählt automatisch als Einkunft dieser Person – nicht zusätzlich unter Einkünfte eintragen.</p></div><div class="pv-home-residence" ${entry.nutzung === 'selbst' ? '' : 'hidden'}>${input('ortsueblicheMiete', 'ortsübliche Miete pro Monat (optional) ' + infoPopoverHtml('Ortsübliche Miete', 'Für die Erbschaftsteuer auf ein Wohnrecht; Mietspiegel. Leer: 4 % des Immobilienwerts pro Jahr. Höchstens Wert/18,6. Ändert die Miete nach Notverkauf nicht.'), entry.ortsueblicheMiete ?? '', true)}</div><div class="ds-actions">${button('save', 'Speichern', false)}${button('cancel', 'Abbrechen')}<span class="pv-home-spacer"></span>${entry.id ? button('remove', 'Immobilie entfernen') : ''}</div><p class="ds-help" id="home-save-status" role="status"></p></div>`;
}
// Detailzeile wie bei den Tranchen; der Pfeil öffnet darunter den Editor.
function row(entry, draft) {
    const name = esc(entry.bezeichnung || 'Neue Immobilie'), expanded = Boolean(draft);
    return `<tr class="pv-home-row"><td><strong>${name}</strong></td><td>${entry.nutzung === 'vermietet' ? money(entry.mieteNetto) + '/Monat' : '—'}</td><td>${money(entry.wert)}</td><td>${esc(standText(entry.stand))}</td>`
        + `<td><button type="button" class="ds-button ds-button-quiet pv-home-toggle" data-home-open="${esc(entry.id)}" aria-expanded="${expanded}" aria-label="Immobilie ${name} ${expanded ? 'schließen' : 'bearbeiten'}">${expanded ? '▾' : '▸'}</button></td></tr>`
        + (expanded ? `<tr class="pv-home-edit-row"><td colspan="5">${editor(draft)}</td></tr>` : '');
}
const homeTable = (rows, label) => `<div class="pv-home-table-box"><table class="ds-table pv-home-table"><caption class="visually-hidden">${label}</caption><thead><tr><th>Bezeichnung</th><th>Mieteinnahmen netto</th><th>Wert</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
/** Immobilien als aufklappbare Anlageformen, je Nutzung eine Gruppe wie bei den Tranchen.
 * @param {ReturnType<typeof readImmobilien>} homes Immobilien der Person.
 * @param {{summary: (key: string, label: string, count: number, value: number, expandable?: boolean) => string, opened: Set<string>,
 *   view?: {open?: string|null, draft?: object|null, fresh?: boolean, reveal?: string|null}}} options Zeilenkopf und Editorzustand.
 * @returns {string} */
export function buildHomeGroupsHtml(homes, { summary, opened, view = {} }) {
    return HOME_GROUPS.map(([key, nutzung, label]) => {
        const list = homes.filter(entry => entry.nutzung === nutzung);
        if (!list.length) return '';
        const open = opened.has(key) || list.some(entry => entry.id === view.open || entry.id === view.reveal);
        return `<details class="pv-asset-group" data-asset-group="${key}" ${open ? 'open' : ''}><summary class="pv-asset-row">${summary(key, label, list.length, list.reduce((sum, entry) => sum + entry.wert, 0), true)}</summary><div class="pv-asset-tranches">${homeTable(list.map(entry => row(entry, entry.id === view.open ? view.draft : null)).join(''), label)}</div></details>`;
    }).join('') + (view.fresh ? `<div class="pv-asset-tranches" data-home-new>${homeTable(row(view.draft, view.draft), 'Neue Immobilie')}</div>` : '');
}
// Die Tabelle gehört der Seite; Editorzustände erscheinen über deren Neuaufbau.
function render(doc) {
    const state = stateFor(doc);
    state.refresh?.();
    state.reveal = null;
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
/** Die nächste Tabellenaktualisierung der Seite zeigt die übernommene Liste.
 * @param {ReturnType<typeof readImmobilien>} homes
 * @param doc Dokument mit Immobilienfeldern.
 * @returns {void} */
export function applyPersonImmobilienToDom(homes, doc) {
    if (!field(doc)) return;
    field(doc).value = writeImmobilien(homes);
    syncRentalIncome(doc);
}
/** @param doc Dokument mit Immobilienfeld und Tabelle der Anlageformen.
 * @param {{notify?: ()=>void; blocked?: ()=>boolean; refresh?: ()=>void}} [options] refresh baut die Tabelle der Anlageformen neu.
 * @returns Zustand und Entwurfssteuerung oder null ohne Formular oder Tabelle. */
export function bindPersonImmobilien(doc, options = {}) {
    const state = stateFor(doc); Object.assign(state, options);
    const host = node(doc, 'tranchenTable');
    if (!field(doc) || !host) return null;
    if (state.bound) return state;
    state.bound = true;
    const dirty = () => Boolean(state.draft && (state.fresh || JSON.stringify(state.draft) !== JSON.stringify(entries(doc).find(entry => entry.id === state.open))));
    const status = text => { const el = node(doc, 'home-save-status'); if (el) { el.textContent = text; el.scrollIntoView?.({ block: 'nearest' }); } };
    function close(focusHome = null) { state.open = null; state.draft = null; state.raw = {}; state.fresh = false; state.focusHome = focusHome; render(doc); state.notify(); }
    function collect() {
        if (!state.draft) return;
        for (const input of host.querySelectorAll('[data-home-field]')) {
            const key = input.dataset.homeField;
            // Der Text bleibt für den Neuaufbau erhalten; der Entwurf hält den geprüften Zahlenwert.
            state.raw[key] = input.value;
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
        if (state.draft && state.open !== id) { status('Bitte zuerst speichern oder abbrechen.'); return; }
        if (state.open === id) { if (dirty()) status('Bitte zuerst speichern oder abbrechen.'); else close(id); return; }
        state.open = id; state.draft = { ...entries(doc).find(entry => entry.id === id) }; state.raw = {}; state.fresh = false; render(doc); state.notify();
    }
    async function action(name) {
        if (state.blocked() || field(doc).disabled) return;
        if (name === 'cancel') { close(state.open); return; }
        if (name === 'add') {
            if (state.draft) { status('Bitte zuerst speichern oder abbrechen.'); return; }
            const now = appNow();
            state.open = null; state.fresh = true; state.raw = {}; state.draft = { id: globalThis.crypto.randomUUID(), bezeichnung: '', nutzung: 'selbst', wert: 0, stand: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, mieteNetto: 0, anpassung: 'keine' };
            render(doc); node(doc, 'home-bezeichnung')?.focus(); state.notify(); return;
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
            for (const el of host.querySelectorAll('[data-home-error]')) el.textContent = errors.find(error => error.field === `immobilie-0-${el.dataset.homeError}`)?.message || '';
            if (errors.length) return;
            if (state.fresh) homes.push({ ...state.draft }); else homes[index] = { ...state.draft };
            // Die Gruppe der gespeicherten Immobilie bleibt nach dem Neuaufbau offen.
            state.reveal = state.draft.id;
        } else return;
        field(doc).value = writeImmobilien(homes);
        close(state.reveal);
        field(doc).dispatchEvent(new (doc.defaultView?.Event || Event)('input', { bubbles: true }));
    }
    host.addEventListener('click', event => {
        const choice = event.target.closest('[data-home-choice]');
        if (choice && state.draft && !state.blocked() && !field(doc).disabled) {
            collect(); const key = choice.dataset.homeChoice; state.draft[key] = choice.dataset.value;
            for (const sibling of choice.parentElement.children) sibling.setAttribute('aria-pressed', String(sibling === choice));
            host.querySelector('.pv-home-rent').hidden = state.draft.nutzung !== 'vermietet';
            host.querySelector('.pv-home-residence').hidden = state.draft.nutzung !== 'selbst';
            state.notify(); return;
        }
        const target = event.target.closest('[data-home-action], [data-home-open]');
        if (target?.dataset.homeAction) void action(target.dataset.homeAction);
        else if (target) open(target.dataset.homeOpen);
    });
    node(doc, 'depotAddHomeBtn')?.addEventListener('click', () => void action('add'));
    host.addEventListener('input', event => { if (event.target.closest('[data-home-field]')) { collect(); state.notify(); } });
    host.addEventListener('focusout', event => {
        const input = event.target.closest('[data-home-field]');
        if (input && MONEY_FIELDS.includes(input.dataset.homeField)) input.value = displayDecimalInput(canonicalDecimalInput(input.value, input), input);
        if (input?.dataset.homeField === 'stand') { const month = editorMonth(input.value); if (/^\d{4}-\d{2}$/.test(month || '')) input.value = incomeMonthDisplay(month); }
        if (input && state.draft) state.raw[input.dataset.homeField] = input.value;
    });
    host.addEventListener('keydown', event => {
        if (!state.draft || !event.target.closest('.pv-home-table')) return;
        if (event.key === 'Escape') { event.preventDefault(); close(state.open); }
        if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); void action('save'); }
    });
    node(doc, 'profileRentalIncome')?.addEventListener('click', event => {
        const target = event.target.closest('[data-rental-home]'); if (!target) return;
        if (state.open !== target.dataset.rentalHome) open(target.dataset.rentalHome);
        host.querySelector('.pv-home-editor')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    state.read = () => ({ dirty: dirty(), draft: state.draft });
    state.discard = () => { if (state.draft) close(); };
    state.homes = () => entries(doc);
    state.view = () => ({ open: state.open, draft: state.draft, fresh: state.fresh, reveal: state.reveal });
    state.beforeRender = () => {
        const active = doc.activeElement;
        return active?.closest?.('.pv-home-table') ? { key: controlKey(active), start: active.selectionStart, end: active.selectionEnd } : null;
    };
    state.afterRender = focus => {
        for (const input of host.querySelectorAll('[data-home-field]')) {
            const key = input.dataset.homeField;
            // Gruppierte Anzeige an das neue Feld binden; angefangener Text wie „12,“ hat Vorrang.
            if (MONEY_FIELDS.includes(key)) input.value = displayDecimalInput(state.draft?.[key] ?? (key === 'ortsueblicheMiete' ? '' : 0), input);
            if (Object.hasOwn(state.raw, key)) input.value = state.raw[key];
        }
        bindInfoPopovers(doc, { root: host });
        const controls = [...host.querySelectorAll(HOME_CONTROLS)];
        const target = [focus?.key, state.focusHome && controlKey({ dataset: { homeOpen: state.focusHome } })].map(key => key && controls.find(el => controlKey(el) === key)).find(Boolean);
        state.focusHome = null;
        target?.focus();
        if (target && typeof focus?.start === 'number') target.setSelectionRange?.(focus.start, focus.end);
    };
    syncRentalIncome(doc);
    return state;
}
