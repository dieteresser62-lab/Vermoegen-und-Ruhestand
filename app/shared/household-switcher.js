import { PersistenceFacade as P } from './persistence-facade.js';
import { FIRST_HOUSEHOLD, HOUSEHOLD_NAME_MAX } from './household-registry.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { readHouseholdFile } from './household-transfer.js';

// HV-1: Haushalt im Kopf jeder Seite, Wechsel und „Neuer Haushalt“ (das Band darunter ist seit dem Nutzertest 05.11. weg: kein Mehrwert neben dem Kopf).
// Nur konstantes Symbol-Markup; Namen kommen ausschließlich als Text in das Dokument.
const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"></path></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg>';

/** @param {{id: string, name: string}} entry */
export const householdLabel = entry => entry.id === FIRST_HOUSEHOLD ? entry.name || 'Haushalt 1' : entry.name;
/** „Haushalt Lena“, aber nie „Haushalt Haushalt 1“. @param {string} label */
export const householdTitle = label => /^haushalt\b/i.test(label) ? label : `Haushalt ${label}`;
/** @param {string} name */
const initialOf = name => (name.trim()[0] || 'H').toLocaleUpperCase('de-DE');

/** @param {Document} doc @param {string} tag @param {string} [text] @param {string} [className] */
function node(doc, tag, text = '', className = '') {
    const el = doc.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
}

/** @param {Document} doc @param {string} name */
function badge(doc, name) { return node(doc, 'span', initialOf(name), 'household-badge'); }

/** @param {Document} doc @param {unknown} error */
function showError(doc, error) {
    const host = doc.getElementById('suiteNavigationStatus') || doc.getElementById('probelaufStatus');
    if (!host) return;
    host.textContent = /** @type {Error} */ (error)?.message || String(error);
    host.hidden = false;
}

/** Neustart des Dokuments im gewählten Haushalt; eine alte Seitenübergabe darf nicht mitwandern. @param {Document} doc */
function reloadIntoHousehold(doc) {
    const win = doc.defaultView;
    if (!win) return;
    win.name = '';
    win.location.replace('index.html');
}

/** Wechsel und Anlegen laufen über die Verlassen-Prüfung der Seite: offene Entwürfe werden gesichert
 * oder bewusst verworfen, erst dann ändert sich das Verzeichnis; danach liest die alte Seite nichts mehr.
 * @param {Document} doc @param {HTMLElement} opener @param {() => Promise<unknown>} change @param {() => void} [navigate] */
export async function changeWithGuard(doc, opener, change, navigate = () => reloadIntoHousehold(doc)) {
    const guard = getPageNavigationGuard(doc, doc.defaultView);
    const result = await guard.reload({ opener, returnResult: true, finalizeDocument: true,
        ready: async () => (await P.flush()) !== false,
        mutate: async () => (await change()) !== false,
        reload: navigate });
    if (result.status === 'reload_required') throw new Error('Der Haushalt wurde gewechselt. Bitte die Seite neu laden.');
    if (result.status === 'failed' || result.error) throw result.error || new Error('Der Haushalt konnte nicht gewechselt werden.');
    return result.status;
}

/** @param {Document} doc @param {string} id @param {HTMLElement} opener */
async function switchTo(doc, id, opener) {
    try { await changeWithGuard(doc, opener, () => P.switchHousehold(id)); }
    catch (error) { showError(doc, error); }
}

/** @param {Document} doc */
export function openNewHouseholdDialog(doc) {
    const dialog = /** @type {HTMLDialogElement} */ (node(doc, 'dialog', '', 'page-choice-dialog household-dialog'));
    dialog.setAttribute('aria-labelledby', 'householdDialogTitle');
    const title = node(doc, 'h2', 'Neuer Haushalt'); title.id = 'householdDialogTitle';
    const label = node(doc, 'label', 'Name des Haushalts');
    const input = /** @type {HTMLInputElement} */ (node(doc, 'input', '', 'ds-input'));
    input.type = 'text'; input.maxLength = HOUSEHOLD_NAME_MAX; input.autocomplete = 'off'; input.dataset.householdName = '';
    label.append(input, node(doc, 'span', 'Steht im Kopf jeder Seite. Später änderbar.', 'household-dialog-help'));
    // HV-3: leer anlegen oder aus einer Übergabedatei (auch einer Vollsicherung); die Datei wird vor dem Speichern geprüft.
    const start = node(doc, 'fieldset', '', 'household-dialog-start');
    start.append(node(doc, 'legend', 'Wie fängt der Haushalt an?'));
    const choice = (value, title, text) => {
        const option = node(doc, 'label', '', 'household-dialog-option');
        const radio = /** @type {HTMLInputElement} */ (node(doc, 'input')); radio.type = 'radio'; radio.name = 'householdStart'; radio.value = value;
        radio.dataset.householdStart = value; radio.checked = value === 'empty';
        const copy = node(doc, 'span'); copy.append(node(doc, 'b', title), node(doc, 'small', text));
        option.append(radio, copy); start.append(option); return radio;
    };
    choice('empty', 'Leer anlegen', 'Personen, Rente, Tagesgeld und Depot trägst du danach ein.');
    const fromFile = choice('file', 'Übergabedatei einspielen', 'Einen Haushalt übernehmen, den jemand mit „Als Datei weitergeben …“ erstellt hat. Die Datei wird geprüft, bevor etwas gespeichert wird.');
    const file = /** @type {HTMLInputElement} */ (node(doc, 'input', '', 'household-dialog-file')); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; file.dataset.householdFile = '';
    start.append(file);
    /** @type {ReturnType<typeof readHouseholdFile> | null} */
    let parsed = null;
    start.addEventListener('change', () => { file.hidden = !fromFile.checked; });
    file.addEventListener('change', async () => {
        parsed = null; error.hidden = true;
        try {
            const chosen = file.files?.[0];
            if (!chosen) return;
            parsed = readHouseholdFile(await chosen.text());
            if (!input.value.trim() && parsed.name) input.value = parsed.name;
        } catch (cause) { error.textContent = /** @type {Error} */ (cause)?.message || String(cause); error.hidden = false; }
    });
    const note = node(doc, 'p', 'Der neue Haushalt ist vollständig getrennt: eigene Daten, eigene Sicherungen und Wiederherstellungspunkte, eigene Kurse. Aus dem geöffneten Haushalt wird nichts übernommen.', 'ds-hint household-dialog-note');
    const error = node(doc, 'p', '', 'household-dialog-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const actions = node(doc, 'div', '', 'ds-actions');
    const cancel = /** @type {HTMLButtonElement} */ (node(doc, 'button', 'Abbrechen', 'ds-button ds-button-secondary')); cancel.type = 'button';
    const accept = /** @type {HTMLButtonElement} */ (node(doc, 'button', 'Haushalt anlegen und öffnen', 'ds-button ds-button-primary'));
    accept.type = 'button'; accept.dataset.householdCreate = '';
    actions.append(cancel, accept);
    dialog.append(title, label, start, note, error, actions);
    doc.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    const submit = async () => {
        if (accept.disabled) return;
        accept.disabled = cancel.disabled = true; error.hidden = true;
        try {
            if (fromFile.checked && !parsed) throw new Error('Bitte zuerst eine gültige Übergabedatei wählen.');
            const records = fromFile.checked ? /** @type {NonNullable<typeof parsed>} */ (parsed).records : null;
            await changeWithGuard(doc, accept, () => records ? P.createHouseholdFromRecords(input.value, records) : P.createHousehold(input.value));
            if (dialog.isConnected) { accept.disabled = cancel.disabled = false; }
        } catch (cause) {
            error.textContent = /** @type {Error} */ (cause)?.message || String(cause); error.hidden = false;
            accept.disabled = cancel.disabled = false;
        }
    };
    accept.addEventListener('click', () => void submit());
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } });
    dialog.showModal?.();
    input.focus();
    return dialog;
}

/** @param {Document} doc */
export function renderHouseholdSwitcher(doc = globalThis.document) {
    const row = doc?.getElementById('suiteContext');
    const registry = P.getHouseholds?.();
    if (!row || !registry) return false;
    const status = P.getPersistenceStatus();
    const active = registry.households.find(entry => entry.id === registry.active) || registry.households[0];
    let wrap = doc.getElementById('householdSwitch');
    if (!wrap) { wrap = node(doc, 'span', '', 'household-switch'); wrap.id = 'householdSwitch'; row.prepend(wrap); }
    const button = /** @type {HTMLButtonElement} */ (node(doc, 'button', '', 'household-switch-button'));
    button.type = 'button'; button.dataset.householdSwitch = ''; button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    const chevron = node(doc, 'span', '', 'household-switch-chevron'); chevron.innerHTML = CHEVRON;
    // „Haushalt Haushalt 1“ vermeiden: das Vorwort nur vor einem eigenen Namen.
    const caption = /^haushalt\b/i.test(householdLabel(active)) ? [] : [node(doc, 'span', 'Haushalt', 'household-switch-caption')];
    button.append(badge(doc, householdLabel(active)), ...caption, node(doc, 'b', householdLabel(active)), chevron);
    if (active.id !== FIRST_HOUSEHOLD) button.dataset.householdOther = '';
    if (status.activeArea === 'spiel') { button.disabled = true; button.title = 'Im Spielbereich lässt sich der Haushalt nicht wechseln.'; }
    const menu = node(doc, 'div', '', 'household-menu'); menu.id = 'householdMenu'; menu.hidden = true; menu.setAttribute('role', 'menu');
    button.setAttribute('aria-controls', menu.id);
    menu.append(node(doc, 'span', 'Haushalt wechseln', 'household-menu-heading'));
    for (const entry of registry.households) {
        const item = /** @type {HTMLButtonElement} */ (node(doc, 'button', '', 'household-menu-item'));
        item.type = 'button'; item.setAttribute('role', 'menuitem'); item.dataset.householdId = entry.id;
        const text = node(doc, 'span', '', 'household-menu-text');
        text.append(node(doc, 'b', householdLabel(entry)), node(doc, 'small', entry.id === active.id ? 'geöffnet' : entry.missing ? 'Bereich fehlt – in der Verwaltung wieder anlegen' : entry.id === FIRST_HOUSEHOLD ? 'Haushalt 1' : 'weiterer Haushalt'));
        item.append(badge(doc, householdLabel(entry)), text);
        if (entry.id === active.id) item.setAttribute('aria-current', 'true');
        item.addEventListener('click', () => {
            menu.hidden = true; button.setAttribute('aria-expanded', 'false');
            if (entry.missing) manage.click();
            else if (entry.id !== active.id) void switchTo(doc, entry.id, button);
        });
        menu.append(item);
    }
    // HV-2: Verwaltung auf Daten & Sicherung; der Link läuft über die normale Seitenübergabe.
    const manage = /** @type {HTMLAnchorElement} */ (node(doc, 'a', 'Haushalte verwalten …', 'household-menu-item household-menu-manage'));
    manage.href = 'Daten-Sicherung.html#haushalte'; manage.setAttribute('role', 'menuitem'); manage.dataset.profileHandoff = ''; manage.dataset.householdManage = '';
    const create = /** @type {HTMLButtonElement} */ (node(doc, 'button', '', 'household-menu-item household-menu-new'));
    create.type = 'button'; create.setAttribute('role', 'menuitem'); create.dataset.householdNew = '';
    const plus = node(doc, 'span', '', 'household-menu-plus'); plus.innerHTML = PLUS;
    create.append(plus, node(doc, 'span', 'Neuer Haushalt …'));
    create.addEventListener('click', () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); openNewHouseholdDialog(doc); });
    menu.append(create, manage, node(doc, 'p', 'Beim Wechsel lädt die App neu und öffnet die Übersicht des gewählten Haushalts.', 'household-menu-note'));
    button.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    doc.addEventListener('click', event => {
        if (!menu.hidden && !wrap.contains(/** @type {Node} */ (event.target))) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    });
    wrap.replaceChildren(button, menu);
    const suffix = ` – ${householdLabel(active)}`;
    if (active.id !== FIRST_HOUSEHOLD && !doc.title.endsWith(suffix)) doc.title += suffix;
    return true;
}

/** Wartet auf die Fassade, ohne sie selbst mit fremden Optionen zu starten. @param {Document} doc */
export function initHouseholdSwitcher(doc = globalThis.document) {
    if (!doc) return;
    if (P.isInitialized?.()) { renderHouseholdSwitcher(doc); return; }
    (doc.defaultView || globalThis).addEventListener?.('persistence:initialized', () => renderHouseholdSwitcher(doc), { once: true });
}
