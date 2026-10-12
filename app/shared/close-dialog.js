/** Schreibfreie Abschlusskomponente. Fachzustand und Speicherbesitz bleiben beim Aufrufer. */
const active = new WeakMap();
export function dialogElements(root) {
    return [root, ...Array.from(root.children || []).flatMap(dialogElements)];
}
export function createCloseDialog({ doc = document, id, title, eyebrow = 'Monatsabschluss',
    subtitle = '', progressNames = null, footnote = '', steps = [], actions = [], groupBefore = {}, signal, returnFocus, onClose = () => true } = {}) {
    if (active.has(doc) || signal?.aborted) return null;
    let dialog, ended = false, busy = false, closing = false, current = steps.find(step => !step.locked && !step.awaitingYear)?.id;
    const visited = new Set();
    let onVisit = () => {};
    let finish;
    const closed = new Promise(resolve => { finish = resolve; });
    const removers = [], stepRemovers = [], messageRemovers = [], rows = new Map(), disabled = new Map();
    let messageRevision = 0;
    const listen = (node, type, handler, list = removers) => {
        node.addEventListener(type, handler); list.push(() => node.removeEventListener(type, handler));
    };
    const element = (tag, className, text) => {
        const node = doc.createElement(tag); node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const close = value => {
        if (ended) return;
        ended = true; stepRemovers.splice(0).forEach(remove => remove()); messageRemovers.splice(0).forEach(remove => remove()); removers.splice(0).forEach(remove => remove());
        disabled.clear();
        try { if (dialog?.open) dialog.close(); } catch { /* Cleanup bleibt vollständig. */ }
        dialog?.remove(); active.delete(doc); finish(value);
        try { returnFocus?.(); } catch { /* Der Auslöser kann nach Refresh verschwunden sein. */ }
    };
    const topmost = () => {
        // Native Top-Layer-Reihenfolge folgt showModal(), nicht zwingend der DOM-Reihenfolge
        // (der dauerhaft angelegte Navigationsdialog kann zuletzt geöffnet worden sein).
        const focusedDialog = doc.activeElement?.closest?.('dialog');
        if (focusedDialog?.open && focusedDialog !== dialog) return false;
        return dialogElements(doc.body).filter(node => (node.tagName?.toLowerCase() || node.tag) === 'dialog' && node.open).at(-1) === dialog;
    };
    const requestClose = async () => {
        if (ended || busy || closing || !topmost()) return false;
        closing = true;
        try {
            if (await onClose() !== false && !busy && !ended) { close(false); return true; }
            return false;
        }
        finally { closing = false; }
    };
    try {
        dialog = element('dialog', 'close-dialog'); dialog.id = id; dialog.dataset.closeDialogHost = '';
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', `${id}Title`); dialog.setAttribute('aria-describedby', `${id}Subtitle`);
        dialog.tabIndex = -1;
        const header = element('header', 'close-dialog-head');
        const overline = element('p', 'close-dialog-eyebrow', eyebrow);
        const heading = element('h2', '', title); heading.id = `${id}Title`;
        const cross = element('button', 'close-dialog-cross', '×'); cross.type = 'button'; cross.dataset.closeDialogClose = '';
        cross.setAttribute('aria-label', 'Dialog schließen');
        const description = element('p', 'close-dialog-subtitle', subtitle); description.id = `${id}Subtitle`;
        header.append(overline, heading, cross, description);
        const content = element('div', 'close-dialog-content'); content.dataset.closeDialogContent = '';
        const status = element('p', 'close-dialog-status'); status.setAttribute('role', 'status');
        const message = element('section', 'ds-note'); message.hidden = true; message.dataset.closeDialogMessage = '';
        const footer = element('footer', 'close-dialog-foot'); footer.dataset.closeDialogFooter = '';
        const note = element('small', 'close-dialog-footnote', footnote); note.hidden = !footnote;
        footer.append(message, status, ...actions, note); dialog.append(header, content, footer);
        const activate = id => { if (busy || !rows.has(id) || rows.get(id).step.locked) return; current = id; visited.add(id); renderStates(); onVisit(id); rows.get(id).root.scrollIntoView?.({ block: 'nearest' }); rows.get(id).button.focus?.(); };
        const nextRow = row => row.step.nextAction ? null : [...rows.values()].find(candidate => candidate.index > row.index && !candidate.step.locked && !candidate.step.awaitingYear);
        const focusAction = () => {
            const action = actions.find(node => node.className?.includes('ds-button-primary') && !node.hidden) || actions.at(-1);
            action?.scrollIntoView?.({ block: 'nearest' }); action?.focus?.();
        };
        const renderStates = () => {
            for (const [id, row] of rows) {
                const neutral = ['not_applicable', 'skipped', 'entered'].includes(row.step.state);
                const label = row.step.preparing ? 'wird vorbereitet …' : row.step.prepared && row.step.done ? (visited.has(id) ? 'geprüft' : 'bereit') : row.step.done ? 'erledigt' : row.step.state === 'entered' ? 'eingetragen' : row.step.state === 'not_applicable' ? 'entfällt' : row.step.state === 'skipped' ? 'übersprungen' : 'offen';
                const state = row.step.done ? 'done' : neutral ? row.step.state : id === current ? 'current' : 'open';
                row.root.dataset.state = state;
                row.root.dataset.visited = String(visited.has(id));
                row.button.setAttribute('aria-expanded', String(id === current));
                row.button.setAttribute('aria-label', `${row.step.title} · ${label}${id === current ? ' · aktuell' : ''}`);
                row.symbol.textContent = row.step.done || row.step.state === 'entered' ? '✓' : neutral ? '–' : String(row.index + 1);
                row.body.hidden = id !== current;
                row.result.hidden = id === current || !row.step.result;
                row.pill.textContent = label;
                const next = nextRow(row);
                row.next.textContent = next ? `Weiter zu ${next.step.title}` : '';
                if (next) row.body.append(row.next); else row.next.remove();
                row.next.disabled = busy;
            }
            if (progressNames !== null && rows.size) {
                const preparation = [...rows.values()].filter(row => !row.step.locked && !row.step.awaitingYear);
                const progress = `${preparation.filter(row => visited.has(row.step.id)).length} von ${preparation.length} Schritten angesehen`;
                description.textContent = `${progressNames} · ${progress}`;
            }
        };
        const updateSteps = next => {
            if (ended) return;
            const oldFocus = doc.activeElement, scroll = content.scrollTop;
            // Hintergrundupdates ändern weder Besuchsmenge noch geöffnete Entwurfsarbeit.
            if (!next.some(step => step.id === current && !step.locked)) current = next.find(step => !step.locked && !step.awaitingYear)?.id;
            next.forEach((step, index) => {
                let row = rows.get(step.id);
                if (!row) {
                    if (groupBefore[step.id]) {
                        const group = element('h3', 'close-dialog-group', groupBefore[step.id]);
                        group.dataset.closeDialogGroup = step.id; content.append(group);
                    }
                    const root = element('section', 'close-dialog-step'); root.dataset.closeDialogStep = step.id;
                    const button = element('button', 'close-dialog-step-title'); button.type = 'button'; button.dataset.closeDialogActivate = step.id;
                    const symbol = element('span', 'close-dialog-step-symbol'); symbol.setAttribute('aria-hidden', 'true');
                    const pill = element('span', 'close-dialog-step-pill');
                    const name = element('span', 'close-dialog-step-name'), result = element('p', 'close-dialog-step-result'), body = element('div', 'close-dialog-step-body');
                    body.id = `${id}-${step.id}`; button.setAttribute('aria-controls', body.id); const chevron = element('span', 'close-dialog-step-chevron', '⌄'); chevron.setAttribute('aria-hidden', 'true');
                    button.append(symbol, name, pill, chevron);
                    root.append(button, result, body); content.append(root);
                    listen(button, 'click', () => { if (!busy && !row.step.locked) activate(step.id); }, stepRemovers);
                    const nextButton = element('button', 'ds-button ds-button-secondary close-dialog-next'); nextButton.type = 'button'; nextButton.dataset.closeDialogNext = step.id;
                    listen(nextButton, 'click', () => { if (busy) return; if (row.step.onNext && row.step.onNext() === false) return; const target = nextRow(row); if (target) activate(target.step.id); else focusAction(); }, stepRemovers);
                    row = { root, button, symbol, name, pill, result, body, next: nextButton }; rows.set(step.id, row);
                }
                row.button.disabled = busy || Boolean(step.locked);
                row.root.dataset.locked = String(Boolean(step.locked));
                row.step = step; row.index = index; row.name.textContent = step.title; row.result.textContent = step.result || '';
                if (step.content && row.content !== step.content) {
                    Array.from(row.body.children || []).forEach(child => child.remove());
                    row.summary = element('p', 'close-dialog-step-summary');
                    row.body.append(row.summary, step.content); row.content = step.content;
                }
                row.body.append(row.next);
                if (row.summary) { row.summary.textContent = step.result || ''; row.summary.hidden = !step.result || Boolean(step.contentOwnResult); }
            });
            renderStates(); content.scrollTop = scroll;
            if (oldFocus && dialogElements(dialog).includes(oldFocus)) {
                let hidden = false;
                for (let parent = oldFocus; parent && parent !== dialog; parent = parent.parentElement || parent.parent) hidden ||= Boolean(parent.hidden);
                const target = hidden ? rows.get(current)?.button : oldFocus;
                if (target !== doc.activeElement) target?.focus?.();
            }
        };
        const handle = { root: dialog, content, closed, close, requestClose, updateSteps, activate,
            hasVisited(id) { return visited.has(id); },
            firstUnvisited() { return [...rows.values()].find(row => !row.step.locked && !row.step.awaitingYear && !visited.has(row.step.id))?.step; },
            setOnVisit(callback) { onVisit = callback; },
            setResult(node) {
                stepRemovers.splice(0).forEach(remove => remove());
                Array.from(content.children || []).forEach(child => child.remove()); rows.clear();
                content.append(node); content.scrollTop = 0;
            },
            setStatus(text) { status.textContent = text; },
            setMessage(text, { kind = 'error', action } = {}) {
                if (ended) return;
                const revision = ++messageRevision;
                messageRemovers.splice(0).forEach(remove => remove());
                Array.from(message.children || []).forEach(child => child.remove());
                message.hidden = !text; message.dataset.messageKind = kind;
                message.className = `close-dialog-status ds-note ${kind === 'hint' ? 'ds-note-warning' : 'ds-note-error'}`;
                if (!text) return;
                const description = element('p', '', text); description.id = `${id}Message`;
                description.setAttribute('role', kind === 'hint' ? 'status' : 'alert'); message.append(description);
                if (!action) return;
                const button = element('button', 'ds-button ds-button-secondary', action.label); button.type = 'button';
                button.dataset.closeDialogMessageAction = ''; button.setAttribute('aria-describedby', description.id);
                button.disabled = busy;
                if (busy) disabled.set(button, false);
                message.append(button);
                let running = false;
                const isCurrent = () => revision === messageRevision && dialogElements(message).includes(button);
                listen(button, 'click', async () => {
                    if (ended || busy || closing || running || button.disabled || !button.isConnected || !isCurrent()) return;
                    running = true;
                    try { await action.onActivate(isCurrent); }
                    finally { running = false; }
                }, messageRemovers);
            },
            setSubtitle(text) { description.textContent = text; },
            setTitle(text) { heading.textContent = text; },
            setProgressNames(text) { progressNames = text; renderStates(); },
            setFootnote(text) { note.textContent = text; note.hidden = !text; },
            setBusy(value) {
                if (ended) return;
                busy = value; dialog.setAttribute('aria-busy', String(value));
                for (const node of dialogElements(dialog)) {
                    if (!['button', 'input', 'select', 'textarea'].includes(node.tagName?.toLowerCase() || node.tag)) continue;
                    if (value) { if (!disabled.has(node)) disabled.set(node, Boolean(node.disabled)); node.disabled = true; }
                    else if (disabled.has(node)) { node.disabled = disabled.get(node); disabled.delete(node); }
                }
                // Ein nativer Close kann trotz gesperrtem cancel den Modalzustand beenden.
                // Erst nach dem Commit aufräumen, damit der Auftrag seinen Besitzer behält.
                if (!busy && !dialog.open) close(false);
            },
            listen,
            get busy() { return busy; }
        };
        active.set(doc, handle); updateSteps(steps);
        listen(dialog, 'click', event => { const jump = event.target.closest?.('[data-close-dialog-jump]'); if (jump && !busy) activate(jump.dataset.closeDialogJump); });
        listen(cross, 'click', requestClose);
        listen(dialog, 'cancel', event => { event.preventDefault(); void requestClose(); });
        listen(dialog, 'close', () => { if (!busy) close(false); });
        listen(dialog, 'keydown', event => {
            if (!topmost()) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); void requestClose(); }
            if (event.key !== 'Tab') return;
            const focusable = dialogElements(dialog).filter(node => {
                const tag = node.tagName?.toLowerCase() || node.tag;
                if (!(['button', 'input', 'select', 'textarea'].includes(tag) || tag === 'a' && (node.href || node.getAttribute?.('href')) || node.tabIndex >= 0)) return false;
                if (node.disabled || node.hidden || tag === 'input' && node.type === 'hidden') return false;
                for (let parent = node.parentElement || node.parent; parent && parent !== dialog; parent = parent.parentElement || parent.parent) if (parent.hidden) return false;
                return !node.getClientRects || node.getClientRects().length > 0;
            });
            event.preventDefault();
            const index = focusable.indexOf(doc.activeElement), offset = event.shiftKey ? -1 : 1;
            (focusable.length ? focusable[(index + offset + focusable.length) % focusable.length] : dialog).focus();
        });
        if (signal) listen(signal, 'abort', () => close(false));
        doc.body.appendChild(dialog); dialog.showModal(); if (current) visited.add(current); renderStates(); cross.focus();
        return handle;
    } catch (error) { close(false); throw error; }
}

/** Gemeinsames Ergebnis C: ausschließlich bestätigte, bereits formatierte Belegdaten. */
export function createCloseResult({ doc = document, month, nextMonth, expenses, budgetComparison,
    people = [], cashTotal, withdrawal, planYear, actionSection, yearSection } = {}) {
    const node = (tag, text, className = '') => {
        const element = doc.createElement(tag); element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const root = node('section', undefined, 'close-dialog-result');
    const banner = node('div', undefined, 'close-dialog-success'); banner.setAttribute('role', 'status');
    const check = node('span', '✓', 'close-dialog-success-symbol'); check.setAttribute('aria-hidden', 'true');
    banner.append(check, node('strong', 'Alles gespeichert'), node('span', `${month} ist abgeschlossen.`));
    root.append(banner);
    if (actionSection) root.append(actionSection);
    if (yearSection) root.append(yearSection);
    root.append(node('h3', 'MONAT', 'close-dialog-result-heading'));
    const facts = node('dl', undefined, 'close-dialog-facts'); facts.dataset.closeDialogResultMonth = '';
    const fact = (label, value, detail) => {
        const term = node('dt', label), description = node('dd', value);
        if (detail) description.append(node('small', detail));
        facts.append(term, description);
    };
    fact(`Ausgaben ${month}`, expenses, budgetComparison);
    for (const person of people) fact(`Tagesgeld ${person.name}`, person.value);
    fact('Tagesgeld gesamt', `Cashsumme: ${cashTotal}`);
    fact(`Monatsbetrag ${nextMonth}`, withdrawal, planYear ? `Monatsinformation aus dem bestätigten Plan ${planYear}` : 'Monatsinformation aus dem bestätigten Plan');
    root.append(facts);
    return root;
}

/** Abschlussmonat, nicht Jahresvollständigkeit: vorhandene Nullrecords zählen mit. */
export function closeImportProgress(model = {}) {
    const missing = (model.members || []).filter(person =>
        !model.expenses?.rows?.some(row => row.id === person.id && row.present)).map(person => person.name);
    return { complete: Boolean(model.expenses?.rows?.length) && model.expenses.rows.every(row => row.present) && !missing.length, missing,
        notice: missing.length ? `Es fehlt noch: ${missing.join(', ')}.` : '' };
}
/** Die Startseitenkarte besitzt zusätzlich Jahresvollständigkeit; der Dialog prüft nur seinen Monat. */
export function projectCloseMonthModel(model) {
    if (!model.expenses?.rows?.length) return model;
    const complete = closeImportProgress(model).complete;
    return { ...model, expenses: { ...model.expenses, complete,
        spent: complete ? model.expenses.rows.reduce((sum, row) => sum + row.spent, 0) : null } };
}
export function advanceCloseImport(handle, before, after) {
    if (JSON.stringify(before.expenses) === JSON.stringify(after.expenses)) return;
    if (handle?.root.querySelector('[data-close-dialog-activate="expenses"]')?.getAttribute('aria-expanded') !== 'true') return;
    if (closeImportProgress(after).complete) handle.activate('budget');
}
export function closeReadinessText({ unseen, problem, action }) {
    return unseen ? `Bitte zuerst den Schritt ‚${unseen.title}‘ ansehen.`
        : problem || `Alles bereit – jetzt ‚${action}‘.`;
}
