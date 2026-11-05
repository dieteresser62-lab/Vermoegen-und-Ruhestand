import { PersistenceFacade as P } from '../shared/persistence-facade.js';
import { FIRST_HOUSEHOLD, HOUSEHOLD_NAME_MAX } from '../shared/household-registry.js';
import { changeWithGuard, householdLabel, householdTitle, openNewHouseholdDialog } from '../shared/household-switcher.js';
import { buildHouseholdTransfer, householdTransferFilename } from '../shared/household-transfer.js';
import { downloadJsonFile } from '../shared/persistence-backup.js';

// HV-2: Abschnitt „Haushalte“ auf Daten & Sicherung (Entwurf H5/H7): öffnen, umbenennen, endgültig löschen,
// fehlenden Bereich wieder anlegen. Namen gelangen nur als Text ins Dokument.

/** @param {Document} doc @param {string} tag @param {string} [text] @param {string} [className] */
function node(doc, tag, text = '', className = '') {
    const el = doc.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
}
/** @param {Document} doc @param {string} text @param {string} className */
function button(doc, text, className = 'ds-button ds-button-secondary') {
    const el = /** @type {HTMLButtonElement} */ (node(doc, 'button', text, className)); el.type = 'button'; return el;
}
const dateText = value => value ? new Date(value).toLocaleDateString('de-DE') : '';

/** Kleiner Dialog im Stil der App; liefert den eingegebenen Text oder null.
 * @param {Document} doc @param {{title: string, text: string, label: string, value?: string, acceptLabel: string, danger?: boolean, warning?: string, requireValue?: string}} spec */
function askText(doc, spec) {
    return new Promise(resolve => {
        const dialog = /** @type {HTMLDialogElement} */ (node(doc, 'dialog', '', 'page-choice-dialog household-dialog'));
        const title = node(doc, 'h2', spec.title); title.id = 'householdActionTitle';
        dialog.setAttribute('aria-labelledby', title.id);
        const text = node(doc, 'p', spec.text);
        const warning = spec.warning ? node(doc, 'p', spec.warning, 'ds-note household-dialog-warning') : null;
        const label = node(doc, 'label', spec.label);
        const input = /** @type {HTMLInputElement} */ (node(doc, 'input', '', 'ds-input'));
        input.type = 'text'; input.maxLength = HOUSEHOLD_NAME_MAX; input.autocomplete = 'off'; input.value = spec.value || '';
        label.append(input);
        const actions = node(doc, 'div', '', 'ds-actions');
        const cancel = button(doc, spec.danger ? 'Behalten' : 'Abbrechen');
        const accept = button(doc, spec.acceptLabel, `ds-button ${spec.danger ? 'ds-button-danger' : 'ds-button-primary'}`);
        accept.dataset.householdConfirm = '';
        const sync = () => { if (spec.requireValue !== undefined) accept.disabled = input.value.replace(/\s+/g, ' ').trim() !== spec.requireValue; };
        actions.append(cancel, accept);
        dialog.append(title, text, ...(warning ? [warning] : []), label, actions);
        doc.body.appendChild(dialog);
        const done = value => { dialog.close(); dialog.remove(); resolve(value); };
        cancel.addEventListener('click', () => done(null));
        dialog.addEventListener('cancel', event => { event.preventDefault(); done(null); });
        accept.addEventListener('click', () => { if (!accept.disabled) done(input.value); });
        input.addEventListener('input', sync);
        input.addEventListener('keydown', event => { if (event.key === 'Enter' && !accept.disabled) { event.preventDefault(); done(input.value); } });
        sync();
        dialog.showModal?.();
        input.focus();
    });
}

/** HV-3 Entwurf H6: Übergabedatei erklären und erst auf Bestätigung erstellen. @param {Document} doc @param {string} name @returns {Promise<boolean>} */
function confirmTransfer(doc, name) {
    return new Promise(resolve => {
        const dialog = /** @type {HTMLDialogElement} */ (node(doc, 'dialog', '', 'page-choice-dialog household-dialog'));
        const title = node(doc, 'h2', `${householdTitle(name)} als Datei weitergeben`); title.id = 'householdTransferTitle';
        dialog.setAttribute('aria-labelledby', title.id);
        const lists = node(doc, 'div', '', 'household-transfer-lists');
        const list = (heading, items) => { const box = node(doc, 'div', '', 'household-transfer-list'); const ul = node(doc, 'ul'); for (const item of items) ul.append(node(doc, 'li', item)); box.append(node(doc, 'b', heading), ul); return box; };
        lists.append(list('In der Datei', ['Personen, Renten und Vermögen', 'Ausgaben aller Monate', 'Pläne, Jahresabschlüsse, Handlungsanweisungen', 'Tageskurse und Vermögensverlauf']),
            list('Nicht in der Datei', ['Wiederherstellungspunkte (bleiben hier)', 'Spielbereich', 'alle anderen Haushalte']));
        const filename = householdTransferFilename(name);
        const warning = node(doc, 'p', 'Nicht verschlüsselt, wie die Sicherungen heute. Gib die Datei direkt weiter, etwa per USB-Stick, und lösche sie danach vom Stick.', 'ds-note household-dialog-warning');
        const actions = node(doc, 'div', '', 'ds-actions');
        const cancel = button(doc, 'Abbrechen'), accept = button(doc, 'Datei erstellen …', 'ds-button ds-button-primary');
        accept.dataset.householdTransferConfirm = '';
        actions.append(cancel, accept);
        dialog.append(title, node(doc, 'p', 'Wer die Datei bekommt, spielt sie in seiner App ein: als neuen Haushalt über „Neuer Haushalt …“ oder in einer neuen App über „Sicherung einspielen“.'),
            lists, node(doc, 'p', `Dateiname: ${filename}`, 'data-muted'), warning, node(doc, 'p', `${name} bleibt hier erhalten.`, 'data-muted'), actions);
        doc.body.appendChild(dialog);
        const done = value => { dialog.close(); dialog.remove(); resolve(value); };
        cancel.addEventListener('click', () => done(false));
        dialog.addEventListener('cancel', event => { event.preventDefault(); done(false); });
        accept.addEventListener('click', () => done(true));
        dialog.showModal?.();
        accept.focus();
    });
}

/** @param {Document} doc @param {unknown} error */
function report(doc, error) {
    const host = doc.getElementById('dataHouseholdsStatus');
    if (host) { host.textContent = /** @type {Error} */ (error)?.message || String(error); host.hidden = false; }
}

/** @param {Document} doc */
export function renderDataHouseholds(doc = globalThis.document) {
    const host = doc?.getElementById('dataHouseholdsTable');
    const registry = P.getHouseholds?.();
    if (!host || !registry) return false;
    const playing = P.getPersistenceStatus().activeArea === 'spiel';
    const win = doc.defaultView;
    const stay = () => win?.location.reload();
    const table = node(doc, 'table', '', 'ds-table data-households-table');
    const head = node(doc, 'thead'), headRow = node(doc, 'tr');
    for (const title of ['Haushalt', 'Angelegt', 'Aktionen']) headRow.append(node(doc, 'th', title));
    head.append(headRow);
    const body = node(doc, 'tbody');
    for (const entry of registry.households) {
        const row = node(doc, 'tr'); row.dataset.householdRow = entry.id;
        const name = node(doc, 'td');
        const label = node(doc, 'span', '', 'data-household-name');
        label.append(node(doc, 'span', (householdLabel(entry).trim()[0] || 'H').toLocaleUpperCase('de-DE'), 'household-badge'),
            node(doc, 'b', householdLabel(entry)),
            node(doc, 'small', [entry.id === FIRST_HOUSEHOLD && entry.name ? 'Haushalt 1' : '', entry.id === registry.active ? 'geöffnet' : '', entry.missing ? 'Bereich fehlt' : ''].filter(Boolean).join(' · ')));
        name.append(label);
        const actions = node(doc, 'td'), group = node(doc, 'span', '', 'data-household-actions');
        if (entry.missing) {
            const rebuild = button(doc, 'Wieder anlegen …'); rebuild.dataset.householdRebuild = entry.id;
            rebuild.addEventListener('click', async () => {
                const ok = await askText(doc, { title: `${householdLabel(entry)} wieder anlegen`, text: 'Der Bereich dieses Haushalts fehlte beim Öffnen. Die App legt ihn neu an und öffnet ihn. Danach kannst du dort eine Vollsicherung dieses Haushalts einspielen.',
                    label: 'Zum Bestätigen den Namen eintippen', acceptLabel: 'Wieder anlegen und öffnen', requireValue: entry.name });
                if (ok === null) return;
                try { await changeWithGuard(doc, rebuild, () => P.rebuildHousehold(entry.id), () => { if (win) { win.name = ''; win.location.replace('Daten-Sicherung.html'); } }); }
                catch (error) { report(doc, error); }
            });
            group.append(rebuild);
        } else if (entry.id !== registry.active) {
            const open = button(doc, 'Öffnen'); open.dataset.householdOpen = entry.id;
            open.addEventListener('click', async () => {
                try { await changeWithGuard(doc, open, () => P.switchHousehold(entry.id)); } catch (error) { report(doc, error); }
            });
            group.append(open);
        }
        const rename = button(doc, 'Umbenennen …'); rename.dataset.householdRename = entry.id;
        rename.addEventListener('click', async () => {
            const value = await askText(doc, { title: 'Haushalt umbenennen', text: 'Der Name steht im Kopf jeder Seite. Daten und Personen bleiben unverändert.',
                label: 'Neuer Name', value: entry.name || householdLabel(entry), acceptLabel: 'Umbenennen' });
            if (value === null) return;
            try { await changeWithGuard(doc, rename, () => P.renameHousehold(entry.id, value), stay); } catch (error) { report(doc, error); }
        });
        group.append(rename);
        if (!entry.missing) {
            const transfer = button(doc, 'Als Datei weitergeben …'); transfer.dataset.householdTransfer = entry.id;
            transfer.addEventListener('click', async () => {
                if (!await confirmTransfer(doc, householdLabel(entry))) return;
                try {
                    const records = await P.readHouseholdRecords(entry.id);
                    const file = buildHouseholdTransfer({ id: entry.id, name: householdLabel(entry), records });
                    downloadJsonFile(file, householdTransferFilename(householdLabel(entry)), doc);
                } catch (error) { report(doc, error); }
            });
            group.append(transfer);
        }
        if (entry.id !== FIRST_HOUSEHOLD && entry.id !== registry.active) {
            const remove = button(doc, 'Löschen …', 'ds-button ds-button-quiet data-household-delete'); remove.dataset.householdDelete = entry.id;
            remove.addEventListener('click', async () => {
                const value = await askText(doc, { title: `${householdTitle(householdLabel(entry))} löschen?`, danger: true,
                    text: `Gelöscht werden alle Daten von ${householdLabel(entry)} in dieser App: Personen, Vermögen, Ausgaben, Pläne, Tageskurse, Sicherungen, Wiederherstellungspunkte und Spielbereich. Andere Haushalte bleiben unberührt.`,
                    warning: `Endgültig: Gelöscht ist gelöscht. Willst du die Daten behalten, gib ${householdLabel(entry)} vorher als Datei weiter.`,
                    label: 'Zum Bestätigen den Namen eintippen', acceptLabel: `${householdTitle(householdLabel(entry))} löschen`, requireValue: entry.name });
                if (value === null) return;
                try { await changeWithGuard(doc, remove, () => P.deleteHousehold(entry.id, value), stay); } catch (error) { report(doc, error); }
            });
            group.append(remove);
        }
        if (playing) for (const control of group.querySelectorAll('button')) { control.disabled = true; control.title = 'Im Spielbereich nicht verfügbar.'; }
        actions.append(group);
        row.append(name, node(doc, 'td', dateText(entry.createdAt)), actions);
        body.append(row);
    }
    table.append(head, body);
    host.replaceChildren(table);
    const create = /** @type {HTMLButtonElement | null} */ (doc.getElementById('dataHouseholdNew'));
    if (create && !create.dataset.bound) {
        create.dataset.bound = '1';
        create.addEventListener('click', () => { if (!create.disabled) openNewHouseholdDialog(doc); });
    }
    if (create) { create.disabled = playing; create.title = playing ? 'Im Spielbereich nicht verfügbar.' : ''; }
    return true;
}
