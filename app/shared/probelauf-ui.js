import { requestPageChoice } from './page-choice-dialog.js';
import { advanceCalendarDate, parseCalendarDate } from './app-clock.js';

const bindings = new WeakMap();
const queuedStarts = new WeakSet();
const rejectionStatuses = new WeakMap();
const progressStatuses = new WeakMap();
const progressMessages = { start: 'Probelauf wird gestartet …', date: 'Testdatum wird umgestellt …', end: 'Ausgangsbestand wird wiederhergestellt …' };

/** Altanker teilen den Kopfzugang und warten bei Bedarf auf dessen sichere Bindung. */
export function requestProbelaufStart(doc) {
    const start = bindings.get(doc);
    if (start) start();
    else queuedStarts.add(doc);
}
/** Datumsdialog mit Fokusführung, Escape und Abbruch ohne Mutation. */
export function requestProbelaufDate({ doc, testDate, starting = false, demoAvailable = false, opener = doc?.activeElement } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const dialog = doc.createElement('dialog'); dialog.className = 'page-choice-dialog ds-plan-card'; dialog.setAttribute('data-probelauf-dialog', '');
        dialog.setAttribute('aria-labelledby', 'probelaufDialogTitle');
        const title = doc.createElement('h2'); title.id = 'probelaufDialogTitle';
        title.textContent = starting ? 'Probelauf starten' : 'Testdatum wählen';
        const description = doc.createElement('p');
        description.textContent = starting ? 'Der dauerhafte Sicherungspunkt „Vor Probelauf“ ist bestätigt. Beim Beenden wird der vollständige Ausgangsbestand wiederhergestellt.' : 'Das Datum ändert nur das fachliche Jetzt. Bestätigte Testabschlüsse bleiben erhalten.';
        const label = doc.createElement('label'); label.textContent = 'Testdatum';
        const input = doc.createElement('input'); input.type = 'date'; input.value = testDate;
        input.setAttribute('aria-label', 'Testdatum'); input.required = true;
        label.appendChild(input);
        let source = null, sourceLabel = null;
        if (starting && demoAvailable) {
            sourceLabel = doc.createElement('label'); sourceLabel.textContent = 'Datenquelle';
            source = doc.createElement('select'); source.setAttribute('aria-label', 'Datenquelle');
            for (const [value, text] of [['copy', 'mit meinen Daten (Kopie)'], ['demo', 'mit Muster-Haushalt']]) {
                const option = doc.createElement('option'); option.value = value; option.textContent = text; source.appendChild(option);
            }
            source.value = 'copy'; sourceLabel.appendChild(source);
        }
        const error = doc.createElement('p'); error.setAttribute('role', 'alert');
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
        const accept = doc.createElement('button'); accept.type = 'button'; accept.textContent = starting ? 'Probelauf starten' : 'Datum übernehmen'; accept.className = 'ds-button ds-button-primary';
        actions.append(cancel, accept); dialog.append(title, description); if (sourceLabel) dialog.appendChild(sourceLabel); dialog.append(label, error, actions);
        const finish = (value, failure = null) => {
            if (settled) return; settled = true;
            dialog.removeEventListener('cancel', aborted); dialog.removeEventListener('close', closed);
            dialog.removeEventListener('keydown', keys); cancel.removeEventListener('click', closed); accept.removeEventListener('click', accepted);
            if (dialog.open) dialog.close(); dialog.remove(); opener?.focus?.(); if (failure) reject(failure); else resolve(value);
        };
        const aborted = event => { event.preventDefault(); finish(null); };
        const closed = () => finish(null);
        const accepted = () => {
            try { parseCalendarDate(input.value); } catch (cause) { error.textContent = cause.message; input.focus(); return; }
            finish(starting ? { source: source?.value || 'copy', testDate: input.value } : input.value);
        };
        const keys = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
            if (event.key === 'Enter' && doc.activeElement === input) { event.preventDefault(); accepted(); }
            if (event.key === 'Tab') {
                event.preventDefault(); const controls = [source, input, cancel, accept].filter(Boolean); const index = controls.indexOf(doc.activeElement);
                controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
            }
        };
        dialog.addEventListener('cancel', aborted); dialog.addEventListener('close', closed); dialog.addEventListener('keydown', keys);
        cancel.addEventListener('click', closed); accept.addEventListener('click', accepted);
        try { doc.body.appendChild(dialog); dialog.showModal(); input.focus(); } catch (cause) { finish(null, cause); }
    });
}

export function renderProbelaufUI(doc, controller, error = null) {
    const state = controller.state;
    const progress = controller.waiting ? 'Speichert noch …' : controller.busy && progressMessages[controller.action];
    const band = doc.getElementById('probelaufBand');
    const text = doc.getElementById('probelaufBandText');
    const start = doc.getElementById('probelaufStart');
    const demoStart = doc.getElementById('overviewWelcomeDemo');
    const end = doc.getElementById('probelaufEnd');
    if (end) end.hidden = !state;
    const allowed = controller.runtime?.canContinue || state?.phase !== 'active' && controller.runtime?.canRecover;
    if (band) band.hidden = !state || !allowed;
    if (text && state && allowed) text.textContent = `Probelauf · Testdatum ${state.testDate.split('-').reverse().join('.')} · keine echten Daten${progress ? ` · ${progress}` : state.phase !== 'active' ? ' · Wiederherstellung erforderlich' : ''}`;
    if (start) { start.hidden = Boolean(state); start.disabled = !controller.runtime?.canStart || controller.busy || controller.waiting || controller.blocked; }
    if (demoStart) {
        demoStart.hidden = !controller.demoAvailable || Boolean(state);
        demoStart.disabled = !controller.demoAvailable || !controller.runtime?.canStart || controller.busy || controller.waiting || controller.blocked;
    }
    const reason = controller.waiting ? 'Speichert noch …' : controller.busy ? 'Eine Probelauf-Aktion läuft – bitte den Speicherabschluss abwarten.'
        : !allowed ? 'Diese Laufzeit erlaubt keine Probelauf-Aktion.'
            : controller.blocked ? controller.blockReason || 'Probelauf gesperrt: Bitte neu laden oder den Ausgangsbestand wiederherstellen.' : '';
    if (start) start.title = start.disabled ? reason : '';
    if (demoStart) demoStart.title = demoStart.disabled ? reason : '';
    for (const button of (doc.querySelectorAll?.('[data-probelauf-action]') || [])) {
        button.disabled = controller.busy || controller.waiting || !allowed || (controller.blocked || state?.phase !== 'active') && button.dataset.probelaufAction !== 'end';
        button.title = button.disabled ? reason : '';
    }
    const status = doc.getElementById('probelaufStatus') || doc.getElementById('suiteNavigationStatus');
    // Nur unseren noch unveränderten Ablehnungshinweis beim bewussten nächsten
    // Versuch entfernen. Andere Features nutzen denselben alternativen Host.
    if (status && progress && rejectionStatuses.has(status)) {
        if (status.textContent === rejectionStatuses.get(status)) { status.textContent = ''; status.hidden = true; }
        rejectionStatuses.delete(status);
    }
    if (status && !progress && progressStatuses.has(status)) {
        if (status.textContent === progressStatuses.get(status)) { status.textContent = ''; status.hidden = true; }
        progressStatuses.delete(status);
    }
    if (status && (error || controller.blocked || progress)) {
        // Ein fremder oder dauerhafter Hinweis hat Vorrang vor bloßem Fortschritt.
        if (!error && !controller.blocked && progress && status.textContent && !status.hidden && !progressStatuses.has(status)) return;
        status.hidden = false;
        status.textContent = (error?.message || progress || controller.blockReason || (state?.phase !== 'active' && state ? 'Probelauf-Recovery: Bitte den Ausgangsbestand wiederherstellen.' : 'Zustand gespeichert. Bitte neu laden; Eingaben sind gesperrt.')) + (state && controller.blocked ? ` Rückkehrpunkt: ${state.snapshotId}` : '');
        if (error?.code === 'PROBELAUF_COMMIT_BUSY') rejectionStatuses.set(status, status.textContent);
        else rejectionStatuses.delete(status);
        if (progress && !error && !controller.blocked) progressStatuses.set(status, status.textContent);
        else progressStatuses.delete(status);
    }
}

export function requestProbelaufEnd({ doc, opener = doc?.activeElement } = {}) {
    return requestPageChoice({ doc, opener, confirmLabel: 'Probelauf beenden', cancelLabel: 'Weiter testen', danger: true, title: 'Ausgangsbestand wiederherstellen?',
        description: 'Probelauf beenden und den vollständigen Ausgangsbestand wiederherstellen. Alle Änderungen und neuen Sicherungspunkte des Probelaufs werden entfernt; Vor Probelauf bleibt erhalten.' }).then(result => result !== null);
}

export function bindProbelaufUI(doc, controller, { dateDialog = requestProbelaufDate,
    confirmEnd = () => requestProbelaufEnd({ doc }) } = {}) {
    if (bindings.has(doc)) { renderProbelaufUI(doc, controller); return false; }
    let pending = false;
    const run = async (action, opener, demo = false) => {
        if (pending || controller.busy || controller.waiting) return;
        if (action === 'start' && (controller.state || controller.blocked || !controller.runtime?.canStart)) return;
        if (demo && !controller.demoAvailable) return;
        pending = true;
        try {
            let result;
            if (action === 'start') result = await controller.start(({ testDate, demoAvailable }) => demo
                ? { source: 'demo', testDate }
                : dateDialog({ doc, testDate, demoAvailable, starting: true, opener }), { opener });
            else if (action === 'end') result = await controller.end(confirmEnd, { opener });
            else {
                if (!controller.state || controller.blocked) return;
                const date = action === 'date' ? await dateDialog({ doc, testDate: controller.state.testDate, opener })
                    : advanceCalendarDate(controller.state.testDate, action);
                if (date === null) return;
                result = await controller.changeDate(date, { opener });
            }
            renderProbelaufUI(doc, controller, result?.error);
        } catch (error) { renderProbelaufUI(doc, controller, error); }
        finally { pending = false; }
    };
    const start = () => {
        const opener = doc.getElementById('probelaufStart');
        if (controller.state) { doc.getElementById('probelaufBand')?.scrollIntoView?.({ block: 'center' }); return; }
        if (pending || controller.busy || controller.waiting) return;
        opener?.focus?.();
        void run('start', opener);
    };
    bindings.set(doc, start);
    doc.getElementById('probelaufStart')?.addEventListener('click', event => { if (!event.currentTarget.disabled) void run('start', event.currentTarget); });
    doc.getElementById('overviewWelcomeDemo')?.addEventListener('click', event => { if (!event.currentTarget.disabled) void run('start', event.currentTarget, true); });
    doc.getElementById('probelaufEnd')?.addEventListener('click', event => { if (!event.currentTarget.disabled) void run('end', event.currentTarget); });
    doc.getElementById('probelaufBand')?.addEventListener('click', event => {
        const button = event.target.closest?.('[data-probelauf-action]');
        if (button && !button.disabled) void run(button.dataset.probelaufAction, button);
    });
    renderProbelaufUI(doc, controller);
    if (queuedStarts.delete(doc)) start();
    return true;
}
