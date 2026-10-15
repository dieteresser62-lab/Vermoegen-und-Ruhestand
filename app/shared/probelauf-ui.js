import { requestPageChoice } from './page-choice-dialog.js';
import { advanceCalendarDate, parseCalendarDate, localCalendarDate } from './app-clock.js';
import { bindProbelaufQuoteContext } from './probelauf-price-ui.js';
import { bindInfoPopovers, createInfoPopover } from './designsystem-info-popover.js';
import { requestProbelaufEndDialog, showProbelaufTransferred } from './probelauf-end-dialog.js';
import { renderTimeLapseUI } from './probelauf-timelapse-ui.js';

const bindings = new WeakMap();
const queuedStarts = new WeakSet();
const rejectionStatuses = new WeakMap();
const progressStatuses = new WeakMap();
const progressMessages = { start: 'Spielbereich wird gestartet …', date: 'Testdatum wird umgestellt …', end: 'Spielbereich wird beendet …', transfer: 'Änderungen werden übernommen …' };

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
        title.textContent = starting ? 'Spielbereich starten' : 'Testdatum wählen';
        const description = doc.createElement('p');
        description.textContent = starting ? 'Deine echten Daten bleiben unverändert. Beim Beenden kannst du verwerfen oder eine Kopie ohne Datumssprung als Ganzes übernehmen. Stand heute verwendet echte Kursabrufe. Mit einem anderen Testdatum gelten Spielkurse ohne Netz.' : 'Ein Datumssprung schaltet dauerhaft auf Spielkurse ohne Netz. Auch beim Zurückstellen auf heute bleiben die Spielkurse bis zum Beenden aktiv. Bestätigte Testabschlüsse bleiben erhalten.';
        const label = doc.createElement('label'); label.textContent = 'Testdatum';
        const input = doc.createElement('input'); input.type = 'date'; input.value = testDate;
        input.setAttribute('aria-label', 'Testdatum'); input.required = true;
        label.appendChild(input);
        let mode = null, modeLabel = null;
        if (starting) {
            modeLabel = doc.createElement('label'); modeLabel.textContent = 'Kursmodus';
            mode = doc.createElement('select'); mode.setAttribute('aria-label', 'Kursmodus');
            for (const [value, text] of [['today', 'Stand heute'], ['date', 'Testdatum wählen']]) {
                const option = doc.createElement('option'); option.value = value; option.textContent = text; mode.appendChild(option);
            }
            mode.value = 'today'; modeLabel.appendChild(mode);
            const updateDate = () => { label.hidden = input.disabled = mode.value === 'today'; input.required = !input.disabled; };
            mode.addEventListener('change', updateDate); updateDate();
        }
        let source = null, sourceLabel = null;
        if (starting && demoAvailable) {
            sourceLabel = doc.createElement('label'); sourceLabel.textContent = 'Datenquelle';
            source = doc.createElement('select'); source.setAttribute('aria-label', 'Datenquelle');
            for (const [value, text] of [['copy', 'Kopie meiner Daten'], ['demo', 'Max und Erika']]) {
                const option = doc.createElement('option'); option.value = value; option.textContent = text; source.appendChild(option);
            }
            source.value = 'copy'; sourceLabel.appendChild(source);
        }
        const error = doc.createElement('p'); error.setAttribute('role', 'alert');
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
        const accept = doc.createElement('button'); accept.type = 'button'; accept.textContent = starting ? 'Spielbereich starten' : 'Datum übernehmen'; accept.className = 'ds-button ds-button-primary';
        actions.append(cancel, accept); dialog.append(title, description); if (sourceLabel) dialog.appendChild(sourceLabel); if (modeLabel) dialog.appendChild(modeLabel); dialog.append(label, error, actions);
        const finish = (value, failure = null) => {
            if (settled) return; settled = true;
            dialog.removeEventListener('cancel', aborted); dialog.removeEventListener('close', closed);
            dialog.removeEventListener('keydown', keys); cancel.removeEventListener('click', closed); accept.removeEventListener('click', accepted);
            if (dialog.open) dialog.close(); dialog.remove(); opener?.focus?.(); if (failure) reject(failure); else resolve(value);
        };
        const aborted = event => { event.preventDefault(); finish(null); };
        const closed = () => finish(null);
        const accepted = () => {
            const date = starting && mode.value === 'today' ? null : input.value;
            try { if (date !== null) parseCalendarDate(date); } catch (cause) { error.textContent = cause.message; input.focus(); return; }
            finish(starting ? { source: source?.value || 'copy', testDate: date } : date);
        };
        const keys = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
            if (event.key === 'Enter' && doc.activeElement === input) { event.preventDefault(); accepted(); }
            if (event.key === 'Tab') {
                event.preventDefault(); const controls = [source, mode, input, cancel, accept].filter(control => control && !control.disabled); const index = controls.indexOf(doc.activeElement);
                controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
            }
        };
        dialog.addEventListener('cancel', aborted); dialog.addEventListener('close', closed); dialog.addEventListener('keydown', keys);
        cancel.addEventListener('click', closed); accept.addEventListener('click', accepted);
        try { doc.body.appendChild(dialog); dialog.showModal(); (source || mode || input).focus(); } catch (cause) { finish(null, cause); }
    });
}

export function renderProbelaufUI(doc, controller, error = null) {
    const state = controller.state;
    bindProbelaufQuoteContext(doc, state);
    const progress = controller.waiting ? 'Speichert noch …' : controller.busy && progressMessages[controller.action];
    const band = doc.getElementById('probelaufBand');
    const text = doc.getElementById('probelaufBandText');
    const start = doc.getElementById('probelaufStart');
    const demoStart = doc.getElementById('overviewWelcomeDemo');
    const end = doc.getElementById('probelaufEnd');
    if (end) end.hidden = !state;
    const allowed = controller.runtime?.canContinue || state?.phase !== 'active' && controller.runtime?.canRecover;
    if (band) band.hidden = !state || !allowed;
    if (text && state && allowed) text.textContent = state.version === 1
        ? `Alter Spielbereich · Rückkehr zum Ausgangsbestand erforderlich${progress ? ` · ${progress}` : ''}`
        : `Spielbereich · ${state.testDate === null ? 'echte Kurse von heute' : `Testdatum ${state.testDate.split('-').reverse().join('.')} · Spielkurse`}${state.source === 'demo' ? ' · Beispieldaten' : ''}${progress ? ` · ${progress}` : state.phase !== 'active' ? ' · Bitte Spielbereich beenden' : ''}`;
    if (band && state && allowed) {
        const details = state.version === 1 ? 'Der alte Spielbereich muss zuerst über seinen Rückkehrpunkt beendet werden.'
            : `${state.testDate === null ? 'Stand heute: Startkurse, Kursverlauf und Jahresmarktdaten werden wie im echten Betrieb abgerufen. Alle gespeicherten Abrufe bleiben im Spielbereich.' : 'Spielkurse: Kurse, Inflation und CAPE sind synthetisch. Es gibt keine Kursnetzanfragen. Der Datumssprung lässt sich bis zum Beenden nicht zurücknehmen.'} Bis zur bestätigten Übernahme bleiben deine echten Daten und Sicherungspunkte unverändert. Verwerfen löscht alles im Spielbereich.${state.source === 'demo' ? ' Max und Erika verwenden Beispieldaten. Eigene Daten kannst du nach dem Beenden anlegen.' : ''}`;
        let info = doc.getElementById('probelaufBandInfo');
        if (!info) { info = createInfoPopover(doc, 'Spielbereich und Kursmodus erklären', details); info.id = 'probelaufBandInfo'; (band.querySelector?.('.ds-actions') || band).appendChild(info); }
        else info.children[1].textContent = details;
        bindInfoPopovers(doc);
    }
    if (start) { start.hidden = Boolean(state); start.disabled = !controller.runtime?.canStart || controller.busy || controller.waiting || controller.blocked; }
    if (demoStart) {
        demoStart.hidden = !controller.demoAvailable || Boolean(state);
        demoStart.disabled = !controller.demoAvailable || !controller.runtime?.canStart || controller.busy || controller.waiting || controller.blocked;
    }
    const reason = controller.waiting ? 'Speichert noch …' : controller.busy ? 'Eine Spielbereich-Aktion läuft – bitte den Speicherabschluss abwarten.'
        : !allowed ? 'Diese Laufzeit erlaubt keine Spielbereich-Aktion.'
            : controller.blocked ? controller.blockReason || 'Spielbereich gesperrt: Bitte neu laden oder den Ausgangsbestand wiederherstellen.' : '';
    if (start) start.title = start.disabled ? reason : '';
    if (demoStart) demoStart.title = demoStart.disabled ? reason : '';
    for (const button of (doc.querySelectorAll?.('[data-probelauf-action]') || [])) {
        button.disabled = controller.busy || controller.waiting || !allowed || (controller.blocked || state?.phase !== 'active') && button.dataset.probelaufAction !== 'end';
        button.title = button.disabled ? reason : '';
    }
    renderTimeLapseUI(doc, controller);
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
        status.textContent = (error?.message || progress || controller.blockReason || (state?.phase !== 'active' && state ? 'Spielbereich-Recovery: Bitte den Ausgangsbestand wiederherstellen.' : 'Zustand gespeichert. Bitte neu laden; Eingaben sind gesperrt.')) + (state && controller.blocked ? state.snapshotId ? ` Rückkehrpunkt: ${state.snapshotId}` : '' : '');
        if (error?.code === 'PROBELAUF_COMMIT_BUSY') rejectionStatuses.set(status, status.textContent);
        else rejectionStatuses.delete(status);
        if (progress && !error && !controller.blocked) progressStatuses.set(status, status.textContent);
        else progressStatuses.delete(status);
    }
}

export function requestProbelaufEnd({ doc, opener = doc?.activeElement, legacy = false, state, loadReview } = {}) {
    if (!legacy) return requestProbelaufEndDialog({ doc, opener, state, loadReview });
    return requestPageChoice({ doc, opener, confirmLabel: 'Spielbereich beenden', cancelLabel: 'Weiter spielen', danger: true, title: 'Spielbereich beenden?',
        description: legacy ? 'Der alte Spielbereich wird über seinen Rückkehrpunkt beendet. Dabei wird dein Ausgangsbestand wiederhergestellt.'
            : 'Alles im Spielbereich wird verworfen. Deine echten Daten sind unverändert.' }).then(result => result !== null);
}

export function bindProbelaufUI(doc, controller, { dateDialog = requestProbelaufDate,
    confirmEnd = () => requestProbelaufEnd({ doc, legacy: controller.state?.version === 1, state: controller.state,
        loadReview: controller.readEndReview ? () => controller.readEndReview() : undefined }) } = {}) {
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
                ? { source: 'demo', testDate: null }
                : dateDialog({ doc, testDate, demoAvailable, starting: true, opener }), { opener });
            else if (action === 'end') result = await controller.end(confirmEnd, { opener,
                onTransferred: result => showProbelaufTransferred({ doc, result }) });
            else {
                if (!controller.state || controller.blocked) return;
                const currentDate = controller.state.testDate || localCalendarDate();
                const date = action === 'date' ? await dateDialog({ doc, testDate: currentDate, opener })
                    : advanceCalendarDate(currentDate, action);
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
