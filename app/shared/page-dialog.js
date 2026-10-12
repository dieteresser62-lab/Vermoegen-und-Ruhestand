const activeDialogs = new WeakSet();
const dialogEnds = new WeakMap();

/** Text bleibt Text; Absätze und kurze Aufzählungen erhalten eigene Elemente. */
function appendDescription(host, description, doc) {
    for (const block of String(description || '').split(/\n\s*\n/).filter(Boolean)) {
        let list = null;
        for (const line of block.split('\n')) {
            const item = line.match(/^\s*[-•]\s+(.+)$/);
            if (item) {
                if (!list) { list = doc.createElement('ul'); host.appendChild(list); }
                const li = doc.createElement('li'); li.textContent = item[1]; list.appendChild(li);
            } else {
                list = null;
                const p = doc.createElement('p'); p.textContent = line; host.appendChild(p);
            }
        }
    }
}

/** Gemeinsamer dokumentlokaler Lebenszyklus, auch für den Auswahldialog. */
export function runPageDialog({ title, description = '', doc = globalThis.document, signal,
    opener = doc?.activeElement, returnFocus, id = 'pageDialog', cancelled = null, queue = false, createDialog } = {}, build) {
    if (!doc?.createElement || !doc?.body) return Promise.reject(new Error('Seitendialog benötigt ein verfügbares Dokument.'));
    if (signal?.aborted) return Promise.resolve(cancelled);
    if (activeDialogs.has(doc)) {
        if (!queue) return Promise.resolve(cancelled);
        return dialogEnds.get(doc).then(() => runPageDialog({ title, description, doc, signal, opener, returnFocus, id, cancelled, queue, createDialog }, build));
    }
    let release;
    dialogEnds.set(doc, new Promise(resolve => { release = resolve; }));
    activeDialogs.add(doc);
    return new Promise((resolve, reject) => {
        let dialog, settled = false, behavior;
        const cleanup = [];
        const listen = (node, type, handler, removers = cleanup) => {
            node.addEventListener(type, handler);
            const remove = () => node.removeEventListener(type, handler);
            removers.push(remove);
            if (removers !== cleanup) cleanup.push(remove);
        };
        const finish = (result = cancelled, error) => {
            if (settled) return;
            settled = true;
            behavior?.cleanup?.();
            cleanup.splice(0).forEach(remove => remove());
            try { if (dialog?.open) dialog.close(); } catch { /* Cleanup bleibt wirksam. */ }
            dialog?.remove(); activeDialogs.delete(doc); dialogEnds.delete(doc); release();
            try {
                if (returnFocus) returnFocus();
                else if (opener && opener.isConnected !== false) opener.focus?.();
                else { doc.body.setAttribute('tabindex', '-1'); doc.body.focus?.(); }
            } catch { /* Ein entfernter Öffner verhindert kein Ende. */ }
            if (error) reject(error); else resolve(result);
        };
        try {
            dialog = createDialog ? createDialog() : doc.createElement('dialog'); dialog.id = id;
            dialog.className = 'page-dialog page-choice-dialog ds-plan-card';
            const titleId = id === 'pageChoiceDialog' ? 'pageChoiceTitle' : `${id}Title`;
            const descriptionId = id === 'pageChoiceDialog' ? 'pageChoiceDescription' : `${id}Description`;
            dialog.setAttribute('aria-labelledby', titleId);
            dialog.setAttribute('aria-describedby', descriptionId);
            dialog.setAttribute('aria-modal', 'true');
            const heading = doc.createElement('h2'); heading.id = titleId; heading.textContent = title;
            const text = doc.createElement('div'); text.id = descriptionId;
            appendDescription(text, description, doc); dialog.append(heading, text);
            behavior = build({ dialog, doc, finish, listen, reject });
            const cancel = () => { if (!behavior.blocked?.()) finish(); };
            listen(dialog, 'cancel', event => { event.preventDefault(); cancel(); });
            listen(dialog, 'close', () => {
                if (behavior.blocked?.()) { try { dialog.showModal(); dialog.focus(); } catch (error) { finish(cancelled, error); } }
                else finish();
            });
            listen(dialog, 'keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
                if (event.key === 'Tab') {
                    event.preventDefault();
                    const controls = behavior.controls().filter(node => node && !node.disabled && !node.hidden);
                    if (!controls.length) { dialog.focus(); return; }
                    const current = controls.indexOf(doc.activeElement);
                    const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
                        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
                    controls[next].focus();
                }
            });
            if (signal) listen(signal, 'abort', cancel);
            doc.body.appendChild(dialog); dialog.showModal();
            (behavior.initialFocus || behavior.controls()[0] || dialog).focus();
        } catch (error) { finish(cancelled, error); }
    });
}

function requestSimpleDialog(options, kind) {
    const cancelled = kind === 'confirmation' ? false : kind === 'alert' ? undefined : null;
    return runPageDialog({ ...options, cancelled }, ({ dialog, doc, finish, listen }) => {
        const controls = [];
        let field, status;
        if (kind === 'input') {
            const label = doc.createElement('label'); label.textContent = options.label || 'Eingabe';
            field = doc.createElement(options.options ? 'select' : 'input');
            field.id = 'pageDialogInput'; field.dataset.pageDialogInput = '';
            field.setAttribute('aria-label', options.label || 'Eingabe');
            if (options.options) for (const option of options.options) {
                const item = doc.createElement('option'); item.value = String(option.value); item.textContent = option.label;
                field.appendChild(item);
            }
            field.value = String(options.value ?? options.defaultValue ?? options.options?.[0]?.value ?? '');
            label.appendChild(field); dialog.appendChild(label); controls.push(field);
            status = doc.createElement('p'); status.id = 'pageDialogValidation'; status.setAttribute('role', 'status');
            field.setAttribute('aria-describedby', status.id); status.hidden = true; dialog.appendChild(status);
        }
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        let cancel;
        if (kind !== 'alert') {
            cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.pageDialogCancel = '';
            cancel.textContent = options.cancelLabel || 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
            listen(cancel, 'click', () => finish()); actions.appendChild(cancel); controls.push(cancel);
        }
        const accept = doc.createElement('button'); accept.type = 'button'; accept.dataset.pageDialogAccept = '';
        accept.textContent = kind === 'alert' ? 'Verstanden' : options.confirmLabel || 'Übernehmen';
        accept.className = `ds-button ${options.danger ? 'ds-button-danger' : 'ds-button-primary'}`;
        listen(accept, 'click', () => {
            if (kind === 'input') {
                const value = field.value;
                let error = options.required && !value.trim() ? 'Bitte gib einen Wert ein.' : '';
                if (options.options && !options.options.some(item => String(item.value) === value)) error = 'Bitte wähle einen gültigen Wert.';
                if (!error && options.validate) {
                    try { const result = options.validate(value); if (result === false) error = 'Bitte prüfe Deine Eingabe.'; else if (typeof result === 'string') error = result; }
                    catch (caught) { error = caught.message; }
                }
                if (error) { status.hidden = false; status.textContent = error; field.setAttribute('aria-invalid', 'true'); field.focus(); return; }
                finish(value);
            } else finish(kind === 'confirmation' ? true : undefined);
        });
        actions.appendChild(accept); controls.push(accept); dialog.appendChild(actions);
        return { controls: () => controls, initialFocus: kind === 'confirmation' ? cancel : controls[0] };
    });
}

export function requestPageConfirmation(options = {}) { return requestSimpleDialog(options, 'confirmation'); }
export async function showPageAlert(options = {}) { await requestSimpleDialog({ ...options, queue: true }, 'alert'); }
export function requestPageInput(options = {}) { return requestSimpleDialog(options, 'input'); }
