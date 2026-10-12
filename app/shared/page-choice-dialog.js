import { runPageDialog } from './page-dialog.js';

/** Auswahl ist dokumentlokal; null bedeutet Abbruch, technische Fehler lehnen ab. */
export function requestPageChoice({ title, description = '', rows = [], updateRows, onConfirm, doc = globalThis.document, signal, opener = doc?.activeElement, returnFocus, confirmLabel = 'Übernehmen', cancelLabel = 'Später', danger = false } = {}) {
    // Der registrierte Erzeugungsort bleibt hier; der gemeinsame Baustein besitzt Öffnung und Cleanup.
    const createDialog = () => {
        const dialog = doc.createElement('dialog');
        dialog.id = 'pageChoiceDialog';
        return dialog;
    };
    return runPageDialog({ title, description, doc, signal, opener, returnFocus, id: 'pageChoiceDialog', createDialog }, ({ dialog, finish, listen, reject }) => {
        let confirming = false, failed = false, settled = false;
        let actionControls = [];
        const rowCleanup = [], selections = new Map(), groups = new Map();
        const rowHost = doc.createElement('div'); rowHost.dataset.pageChoiceRows = '';
        dialog.appendChild(rowHost);
        const renderRows = (nextRows, selected = {}) => {
            const focusId = doc.activeElement?.dataset?.pageChoiceField;
            rowCleanup.splice(0).forEach(remove => remove());
            for (const node of [...selections.values()]) node.parentNode?.remove?.();
            rowHost.replaceChildren?.();
            selections.clear(); groups.clear(); rows = nextRows;
            for (const row of rows) {
                const preferred = selected[row.id] ?? row.selected ?? row.options[0]?.value ?? '';
                let select;
                if (row.kind === 'radio') {
                    const group = doc.createElement('fieldset'); group.className = 'page-choice-group';
                    const legend = doc.createElement('legend'); legend.textContent = row.label; group.appendChild(legend);
                    const radios = row.options.map((item, index) => {
                        const label = doc.createElement('label'); label.className = 'page-choice-card';
                        const radio = doc.createElement('input'); radio.type = 'radio';
                        radio.name = `page-choice-${rows.indexOf(row)}`;
                        radio.value = String(item.value); radio.dataset.pageChoiceField = row.id;
                        radio.checked = String(preferred) === radio.value;
                        const text = doc.createElement('span'); text.textContent = item.label;
                        label.append(radio, text);
                        if (item.suggested) {
                            const badge = doc.createElement('small'); badge.textContent = 'Vorschlag'; badge.className = 'page-choice-suggestion'; label.appendChild(badge);
                        }
                        const choose = () => {
                            if (confirming || failed) return;
                            radios.forEach(other => { other.checked = other === radio; });
                            selections.set(row.id, radio);
                        };
                        listen(radio, 'change', choose, rowCleanup);
                        listen(label, 'click', () => { if (confirming || failed) return; choose(); radio.focus(); }, rowCleanup);
                        listen(radio, 'keydown', event => {
                            if (confirming || failed) return;
                            const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
                            if (step) {
                                event.preventDefault();
                                const next = radios[(index + step + radios.length) % radios.length];
                                radios.forEach(other => { other.checked = other === next; });
                                selections.set(row.id, next);
                                next.focus();
                            }
                        }, rowCleanup);
                        group.appendChild(label); return radio;
                    });
                    select = radios.find(radio => radio.checked) || radios[0];
                    if (select) select.checked = true;
                    groups.set(row.id, radios); rowHost.appendChild(group);
                } else {
                    const label = doc.createElement('label'); label.textContent = row.label;
                    select = doc.createElement('select'); select.dataset.pageChoiceField = row.id;
                    select.setAttribute('aria-label', row.label);
                    for (const item of row.options) {
                        const option = doc.createElement('option'); option.value = String(item.value); option.textContent = item.label;
                        select.appendChild(option);
                    }
                    select.value = row.options.some(item => String(item.value) === String(preferred)) ? String(preferred) : String(row.options[0]?.value ?? '');
                    label.appendChild(select); rowHost.appendChild(label);
                }
                selections.set(row.id, select);
                if (updateRows && row.refreshRows) listen(select, 'change', () => {
                    if (confirming || failed) return;
                    try {
                        const values = Object.fromEntries([...selections].map(([id, field]) => [id, field.value]));
                        const next = updateRows(values);
                        renderRows(next, Object.fromEntries(Object.entries(values).filter(([id]) => id.startsWith('mapping:'))));
                    } catch (error) { finish(null, error); }
                }, rowCleanup);
            }
            if (focusId) selections.get(focusId)?.focus();
        };
        renderRows(rows);
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.pageChoiceCancel = ''; cancel.textContent = cancelLabel;
        const accept = doc.createElement('button'); accept.type = 'button'; accept.dataset.pageChoiceAccept = ''; accept.textContent = confirmLabel;
        cancel.className = 'ds-button ds-button-secondary'; accept.className = `ds-button ${danger ? 'ds-button-danger' : 'ds-button-primary'}`;
        actions.append(cancel, accept); dialog.appendChild(actions);
        actionControls = [cancel, accept];
        const status = doc.createElement('p'); status.dataset.pageChoiceStatus = ''; status.setAttribute('role', 'status');
        status.hidden = true; dialog.appendChild(status);
        const cancelChoice = () => { if (!confirming) finish(null); };
        listen(cancel, 'click', cancelChoice);
        listen(accept, 'click', () => {
            if (confirming || failed || settled) return;
            const result = Object.fromEntries([...selections].map(([id, select]) => [id, select.value]));
            const invalid = rows.find(row => (row.required && !result[row.id]) || !row.options.some(item => String(item.value) === result[row.id]));
            if (invalid) {
                status.hidden = false; status.textContent = 'Bitte wähle einen gültigen Wert.';
                selections.get(invalid.id)?.focus(); return;
            }
            if (!onConfirm) { finish(result); return; }
            confirming = true;
            dialog.setAttribute('aria-busy', 'true'); dialog.setAttribute('tabindex', '-1');
            for (const field of [...selections.values(), ...[...groups.values()].flat(), ...actionControls]) field.disabled = true;
            status.hidden = false; status.textContent = 'Angaben werden dauerhaft gespeichert – bitte warten.';
            dialog.focus();
            Promise.resolve().then(() => onConfirm(Object.freeze(result))).then(() => {
                confirming = false; finish(result);
            }, error => {
                confirming = false;
                if (error?.name === 'AbortError') { finish(null); return; }
                // Kein Erfolgsende bei unbestätigtem Bestand. Die Seite bleibt gesperrt;
                // der sichtbare Fehlerdialog lässt sich danach nur noch schließen.
                failed = true; dialog.setAttribute('aria-busy', 'false');
                status.textContent = `Übernahme nicht bestätigt: ${error.message}`;
                cancel.disabled = false; cancel.textContent = 'Schließen'; cancel.focus();
                reject(error);
            });
        });
        return {
            controls: () => confirming ? [] : failed ? [cancel] : [...selections.values(), ...actionControls],
            blocked: () => confirming,
            cleanup: () => { settled = true; rowCleanup.splice(0).forEach(remove => remove()); }
        };
    });
}

/** Ruhiger Hinweis ohne Modalität, Schreibzugriff oder Navigationsprovider. */
export function showPageNotice({ message, href, linkText = 'Geburtsdatum einmal ergänzen', doc = globalThis.document } = {}) {
    if (!doc?.body || !doc?.createElement) return null;
    let host = doc.getElementById?.('personDataNotice');
    if (!host) {
        host = doc.createElement('aside'); host.id = 'personDataNotice'; host.className = 'ds-note person-data-notice';
        host.setAttribute('role', 'status');
        (doc.querySelector?.('main') || doc.body).appendChild(host);
    }
    host.replaceChildren();
    const text = doc.createElement('span'); text.textContent = message;
    const link = doc.createElement('a'); link.href = href; link.textContent = linkText;
    host.append(text, link); host.hidden = false;
    return host;
}
