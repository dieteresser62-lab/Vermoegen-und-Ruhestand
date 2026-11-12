import { requestPageChoice } from './page-choice-dialog.js';
import { advanceCalendarDate, parseCalendarDate, localCalendarDate, appTestDateBounds, validateAppTestDate } from './app-clock.js';
import { bindProbelaufQuoteContext } from './probelauf-price-ui.js';
import { bindInfoPopovers, createInfoPopover } from './designsystem-info-popover.js';
import { requestProbelaufEndDialog, showProbelaufTransferred } from './probelauf-end-dialog.js';
import { renderTimeLapseUI } from './probelauf-timelapse-ui.js';
import { MUSTER_HAUSHALTE, musterHaushalt, musterVarianten, musterVariante, HANDBOOK_MUSTER_DATE } from '../demo/muster-haushalte.js';

import { musterSteckbrief, musterSteckbriefHtml, musterLesson } from '../demo/muster-steckbrief.js';

const bindings = new WeakMap();
const queuedStarts = new WeakSet();
const rejectionStatuses = new WeakMap();
const progressStatuses = new WeakMap();
const progressMessages = { restart: 'Beispiel wird neu gestartet …', start: 'Spielbereich wird gestartet …', date: 'Testdatum wird umgestellt …', end: 'Spielbereich wird beendet …', transfer: 'Änderungen werden übernommen …' };

/** Altanker teilen den Kopfzugang und warten bei Bedarf auf dessen sichere Bindung.
 *
 * @param doc Dokument der Seite.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function requestProbelaufStart(doc) {
    const start = bindings.get(doc);
    if (start) start();
    else queuedStarts.add(doc);
}
/** Datumsdialog mit Fokusführung, Escape und Abbruch ohne Mutation.
 *
 * @param {{doc?: Document; testDate?: string; starting?: boolean; demoAvailable?: boolean; opener?: HTMLElement}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function requestProbelaufDate({ doc, testDate, starting = false, demoAvailable = false, opener = /** @type {HTMLElement} */ (doc?.activeElement) } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const dialog = doc.createElement('dialog'); dialog.className = 'page-choice-dialog ds-plan-card'; dialog.setAttribute('data-probelauf-dialog', '');
        dialog.setAttribute('aria-labelledby', 'probelaufDialogTitle');
        const title = doc.createElement('h2'); title.id = 'probelaufDialogTitle';
        title.textContent = starting ? 'Spielbereich starten' : 'Testdatum wählen';
        const node = (tag, text, className) => {
            const element = doc.createElement(tag);
            if (text) element.textContent = text;
            if (className) element.className = className;
            return element;
        };
        const description = node('p', starting ? 'Deine echten Daten bleiben unverändert.' : 'Ein Datumssprung schaltet dauerhaft auf Spielkurse ohne Netz. Auch beim Zurückstellen auf heute bleiben die Spielkurse bis zum Beenden aktiv. Bestätigte Testabschlüsse bleiben erhalten.');
        const label = node('label', starting ? 'Spielkurse, Testdatum ' : 'Testdatum');
        const input = node('input'); input.type = 'date'; input.value = testDate;
        Object.assign(input, appTestDateBounds());
        input.setAttribute('aria-label', 'Testdatum'); input.required = true;
        label.appendChild(input);
        const error = node('p'); error.setAttribute('role', 'alert'); error.hidden = true;
        const actions = node('div', null, 'ds-actions');
        const cancel = node('button', 'Abbrechen', 'ds-button ds-button-secondary'); cancel.type = 'button';
        const accept = node('button', starting ? 'Spielbereich starten' : 'Datum übernehmen', 'ds-button ds-button-primary'); accept.type = 'button';
        actions.append(cancel, accept); dialog.append(title, description);
        let selected = 'copy', variantId = 'grund', mode = 'today', loading = false, selectionError = false;
        const controls = [], cards = [];
        let variantControls = [];
        if (starting) {
            dialog.className += ' probelauf-start-dialog';
            // Spielkurse starten mit jedem Testdatum außer heute; Vorgabe bleibt gestern.
            const yesterday = parseCalendarDate(testDate); yesterday.setDate(yesterday.getDate() - 1);
            input.value = localCalendarDate(yesterday);
            const handbookButton = node('button'); handbookButton.className = 'ds-mini-button';
            handbookButton.textContent = 'Handbuchdatum ' + HANDBOOK_MUSTER_DATE.split('-').reverse().join('.');
            handbookButton.type = 'button'; handbookButton.id = 'probelaufHandbookDate';
            const handbookHint = node('small', 'gleiche Zahlen wie im Handbuch');
            const updateHandbookHint = () => {
                handbookButton.hidden = selected === 'copy';
                handbookHint.hidden = selected === 'copy' || mode !== 'date' || input.value !== HANDBOOK_MUSTER_DATE;
            };
            const body = node('div', null, 'probelauf-start-body');
            const sources = node('div', null, 'probelauf-sources'); sources.setAttribute('aria-label', 'Datenquelle');
            sources.appendChild(node('span', 'Womit willst du spielen?', 'muster-caption'));
            const detail = node('section', null, 'household-plan-group probelauf-steckbrief');
            detail.setAttribute('aria-live', 'polite');
            let revision = 0;
            const updateBrief = async () => {
                const current = ++revision;
                selectionError = false; error.hidden = true;
                if (selected === 'copy') {
                    loading = false; accept.disabled = false;
                    detail.innerHTML = '<header><h3>Kopie meiner Daten</h3></header><p>Du spielst mit einer Kopie deiner gespeicherten Daten. Gut für Fragen wie „Was wäre, wenn wir heiraten?“ oder „Was ändert ein Pflegegrad?“. Echte Kurse von heute sind voreingestellt.</p><p class="muster-details">Beim Beenden verwirfst du alles oder übernimmst deine Änderungen.</p>';
                    return;
                }
                loading = true; accept.disabled = true;
                detail.textContent = 'Beispiel wird geladen …';
                try {
                    const date = mode === 'today' ? testDate : input.value;
                    validateAppTestDate(date);
                    const { createMusterHaushaltRecords } = await import('../demo/muster-haushalt.js');
                    if (settled || current !== revision) return;
                    const records = createMusterHaushaltRecords(date, selected, variantId);
                    const base = variantId === 'grund' ? null : createMusterHaushaltRecords(date, selected);
                    detail.textContent = '';
                    detail.innerHTML = musterSteckbriefHtml(musterSteckbrief(records, selected, date, variantId, base));
                    variantControls = [];
                    const variants = musterVarianten(selected);
                    if (variants.length > 1) {
                        const choices = node('div', null, 'muster-variants');
                        choices.setAttribute('aria-label', 'Variante');
                        for (const variant of variants) {
                            const button = node('button', variant.name, 'ds-button ds-button-secondary'); button.type = 'button';
                            button.dataset.musterVariant = variant.id;
                            button.setAttribute('aria-pressed', String(variant.id === variantId));
                            button.addEventListener('click', async () => { variantId = variant.id; await updateBrief(); variantControls.find(control => control.dataset.musterVariant === variantId)?.focus(); });
                            variantControls.push(button); choices.appendChild(button);
                        }
                        // Hinter Name und Leitfrage, vor der Erklärung der Abweichungen.
                        detail.insertBefore(choices, detail.children[1] || null);
                    }
                    loading = false; accept.disabled = false;
                } catch (cause) {
                    if (settled || current !== revision) return;
                    loading = false; selectionError = true; accept.disabled = true;
                    error.textContent = cause.message; error.hidden = false;
                    detail.textContent = 'Bitte ein zulässiges Testdatum wählen.';
                }
            };
            const game = node('input'); game.type = 'radio'; game.name = 'probelauf-kurse'; game.value = 'date'; game.setAttribute('aria-label', 'Spielkurse');
            const today = node('input'); today.type = 'radio'; today.name = game.name; today.value = 'today'; today.setAttribute('aria-label', 'Echte Kurse von heute');
            const updateMode = () => {
                game.checked = mode === 'date'; today.checked = mode === 'today';
                today.disabled = selected !== 'copy'; todayLabel.hidden = today.disabled;
                input.disabled = mode === 'today'; input.required = !input.disabled;
                handbookButton.disabled = selected === 'copy' || input.disabled; updateHandbookHint();
            };
            const addCard = (id, name, subtitle) => {
                const button = node('button', null, 'household-plan-group probelauf-source'); button.type = 'button';
                button.dataset.probelaufSource = id;
                const heading = node('strong', name);
                if (id !== 'copy') {
                    const count = musterVarianten(id).length - 1;
                    if (count) heading.appendChild(node('small', `${count} ${count === 1 ? 'Variante' : 'Varianten'}`));
                }
                button.append(heading, node('span', subtitle));
                button.setAttribute('aria-pressed', String(id === selected));
                button.addEventListener('click', () => {
                    selected = id; variantId = 'grund'; variantControls = []; mode = id === 'copy' ? 'today' : 'date';
                    cards.forEach(card => card.setAttribute('aria-pressed', String(card.dataset.probelaufSource === id)));
                    updateMode(); void updateBrief();
                });
                cards.push(button); controls.push(button); sources.appendChild(button);
            };
            addCard('copy', 'Kopie meiner Daten', 'Deine Daten ausprobieren, ohne sie zu ändern');
            if (demoAvailable) {
                sources.appendChild(node('span', 'Beispielhaushalte', 'muster-caption'));
                MUSTER_HAUSHALTE.forEach(h => addCard(h.id, h.name, h.title));
            }
            body.append(sources, detail); dialog.appendChild(body);
            const footer = node('div', null, 'probelauf-start-footer');
            const quotes = node('fieldset', null, 'probelauf-quotes'); quotes.appendChild(node('legend', 'Kurse', 'muster-caption'));
            label.className = 'probelauf-quote-choice';
            label.replaceChildren(game, node('span', 'Spielkurse, Testdatum'), input);
            const handbook = node('div', null, 'probelauf-handbook-date'); handbook.append(handbookButton, handbookHint);
            const todayLabel = node('label', null, 'probelauf-quote-choice'); todayLabel.append(today, node('span', 'Echte Kurse von heute'));
            quotes.append(label, handbook, todayLabel); footer.append(quotes, actions); dialog.append(error, footer);
            for (const radio of [game, today]) radio.addEventListener('change', () => { mode = radio.value; updateMode(); void updateBrief(); });
            handbookButton.addEventListener('click', () => { input.value = HANDBOOK_MUSTER_DATE; updateHandbookHint(); void updateBrief(); });
            input.addEventListener('input', updateHandbookHint);
            input.addEventListener('change', () => { updateHandbookHint(); void updateBrief(); });
            controls.push(game, input, handbookButton, today); updateMode(); void updateBrief();
        } else {
            dialog.append(label, error, actions); controls.push(input);
        }
        controls.push(cancel, accept);
        const finish = (value, failure = null) => {
            if (settled) return; settled = true;
            dialog.removeEventListener('cancel', aborted); dialog.removeEventListener('close', closed);
            dialog.removeEventListener('keydown', keys); cancel.removeEventListener('click', closed); accept.removeEventListener('click', accepted);
            if (dialog.open) dialog.close(); dialog.remove(); opener?.focus?.(); if (failure) reject(failure); else resolve(value);
        };
        const aborted = event => { event.preventDefault(); finish(null); };
        const closed = () => finish(null);
        const accepted = () => {
            if (loading || selectionError) return;
            const date = starting && mode === 'today' ? null : input.value;
            try {
                if (date !== null) validateAppTestDate(date);
                if (starting && date === testDate) throw new Error(selected === 'copy'
                    ? 'Heute gibt es nur echte Kurse. Für Spielkurse bitte ein anderes Testdatum wählen, sonst ‚Echte Kurse von heute‘.'
                    : 'Für Spielkurse bitte ein anderes Testdatum als heute wählen.');
            } catch (cause) { error.textContent = cause.message; error.hidden = false; input.focus(); return; }
            finish(starting ? { source: selected === 'copy' ? 'copy' : 'demo',
                ...(selected === 'copy' ? {} : { householdId: selected, variantId }), testDate: date } : date);
        };
        const keys = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(null); }
            if (event.key === 'Enter' && doc.activeElement === input) { event.preventDefault(); accepted(); }
            if (event.key === 'Tab') {
                event.preventDefault(); const enabled = [...controls.slice(0, cards.length), ...variantControls, ...controls.slice(cards.length)].filter(control => !control.disabled); const index = enabled.indexOf(doc.activeElement);
                enabled[(index + (event.shiftKey ? -1 : 1) + enabled.length) % enabled.length].focus();
            }
        };
        dialog.addEventListener('cancel', aborted); dialog.addEventListener('close', closed); dialog.addEventListener('keydown', keys);
        cancel.addEventListener('click', closed); accept.addEventListener('click', accepted);
        try { doc.body.appendChild(dialog); dialog.showModal(); controls[0].focus(); } catch (cause) { finish(null, cause); }
    });
}

/**
 * @param doc Dokument der Seite.
 * @param controller Besitzer des laufenden Vorgangs.
 * @param error Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderProbelaufUI(doc, controller, error = null) {
    const state = controller.state;
    const householdName = state?.source === 'demo' ? musterHaushalt(state.householdId).name : null;
    const variantName = householdName ? musterVariante(state.householdId, state.variantId).name : null;
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
        : `Spielbereich${householdName ? ` · ${householdName} · ${variantName}` : ''} · ${state.testDate === null ? 'echte Kurse von heute' : `Testdatum ${state.testDate.split('-').reverse().join('.')} · Spielkurse`}${householdName ? ' · Beispieldaten' : ''}${progress ? ` · ${progress}` : state.phase !== 'active' ? ' · Bitte Spielbereich beenden' : ''}`;
    if (band && state && allowed) {
        const details = state.version === 1 ? 'Der alte Spielbereich muss zuerst über seinen Rückkehrpunkt beendet werden.'
            : `${state.testDate === null ? 'Stand heute: Startkurse, Kursverlauf und Jahresmarktdaten werden wie im echten Betrieb abgerufen. Alle gespeicherten Abrufe bleiben im Spielbereich.' : 'Spielkurse: Kurse, Inflation und CAPE sind synthetisch. Es gibt keine Kursnetzanfragen. Der Datumssprung lässt sich bis zum Beenden nicht zurücknehmen.'} Bis zur bestätigten Übernahme bleiben deine echten Daten und Sicherungspunkte unverändert. Verwerfen löscht alles im Spielbereich.${householdName ? ` Beispieldaten von ${householdName}. Eigene Daten kannst du nach dem Beenden anlegen.` : ''}`;
        let info = doc.getElementById('probelaufBandInfo');
        if (!info) { info = createInfoPopover(doc, 'Spielbereich und Kursmodus erklären', details); info.id = 'probelaufBandInfo'; (band.querySelector?.('.ds-actions') || band).appendChild(info); }
        else info.children[1].textContent = details;
        bindInfoPopovers(doc);
    }
    renderMusterBand(doc, controller);
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

/**
 * @param {import("../../typcheck/shared-probelauf.js").EndDialogOptions & {legacy?: boolean}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function requestProbelaufEnd({ doc, opener = /** @type {HTMLElement} */ (doc?.activeElement), legacy = false, state, loadReview } = {}) {
    if (!legacy) return requestProbelaufEndDialog({ doc, opener, state, loadReview });
    return requestPageChoice({ doc, opener, confirmLabel: 'Spielbereich beenden', cancelLabel: 'Weiter spielen', danger: true, title: 'Spielbereich beenden?',
        description: legacy ? 'Der alte Spielbereich wird über seinen Rückkehrpunkt beendet. Dabei wird dein Ausgangsbestand wiederhergestellt.'
            : 'Alles im Spielbereich wird verworfen. Deine echten Daten sind unverändert.' }).then(result => result !== null);
}

function renderMusterBand(doc, controller) {
    const band = doc.getElementById('probelaufBand');
    if (!band) return;
    const example = controller.state?.version !== 1 && controller.state?.source === 'demo';
    let briefButton = doc.getElementById('probelaufSteckbrief');
    let restart = doc.getElementById('probelaufRestart');
    let panel = doc.getElementById('probelaufSteckbriefPanel');
    if (example && !briefButton) {
        const actions = band.querySelector?.('.ds-actions') || band;
        briefButton = doc.createElement('button'); briefButton.id = 'probelaufSteckbrief'; briefButton.type = 'button';
        briefButton.className = 'ds-button ds-button-secondary'; briefButton.textContent = 'Steckbrief';
        briefButton.setAttribute('aria-expanded', 'false'); briefButton.setAttribute('aria-controls', 'probelaufSteckbriefPanel');
        restart = doc.createElement('button'); restart.id = 'probelaufRestart'; restart.type = 'button';
        restart.className = 'ds-button ds-button-secondary'; restart.textContent = 'Beispiel neu starten'; restart.dataset.probelaufAction = 'restart';
        if (actions.insertBefore) { actions.insertBefore(restart, actions.children[0] || null); actions.insertBefore(briefButton, restart); }
        else actions.append(briefButton, restart);
        panel = doc.createElement('section'); panel.id = 'probelaufSteckbriefPanel'; panel.className = 'ds-plan-card muster-band-brief';
        panel.setAttribute('aria-label', 'Steckbrief'); panel.hidden = true;
        const household = musterHaushalt(controller.state.householdId), variant = musterVariante(household.id, controller.state.variantId);
        const people = Object.values(controller.state.initialDomain?.profiles || {});
        const lesson = musterLesson(household.id, variant.id, people[1]?.data.profile_rentenbeginn, people[0]?.data.profile_rentenbeginn);
        const title = doc.createElement('h3'); title.textContent = household.title;
        const close = doc.createElement('button'); close.type = 'button'; close.className = 'ds-button ds-button-secondary'; close.textContent = '×'; close.setAttribute('aria-label', 'Steckbrief schließen');
        const heading = doc.createElement('header'); heading.append(title, close);
        const name = doc.createElement('p'); name.className = 'muster-details'; name.textContent = `Variante: ${variant.name}`;
        const questionLabel = doc.createElement('span'); questionLabel.className = 'muster-caption'; questionLabel.textContent = 'Die Frage';
        const question = doc.createElement('p'); question.className = 'muster-question'; question.textContent = lesson.question;
        const exerciseLabel = doc.createElement('span'); exerciseLabel.className = 'muster-caption'; exerciseLabel.textContent = 'Erste Übungen';
        panel.append(heading, name, questionLabel, question, exerciseLabel);
        for (const exercise of lesson.exercises) {
            const label = doc.createElement('label'), check = doc.createElement('input'), text = doc.createElement('span');
            check.type = 'checkbox'; text.textContent = exercise; label.append(check, text); panel.appendChild(label);
        }
        const observe = doc.createElement('p'); observe.className = 'household-plan-group'; observe.textContent = `Beobachte: ${lesson.observe}`;
        const hint = doc.createElement('p'); hint.className = 'muster-details'; hint.textContent = '„Beispiel neu starten“ setzt alles auf den Anfang dieses Beispiels zurück, auch geänderte Annahmen.';
        panel.appendChild(observe);
        if (variant.id === 'haus-pg3') {
            const note = doc.createElement('p'); note.className = 'muster-details'; note.textContent = lesson.note;
            panel.appendChild(note);
        }
        panel.appendChild(hint); band.appendChild(panel);
        if (musterVarianten(household.id).length > 1) {
            const change = doc.createElement('button'); change.type = 'button'; change.id = 'probelaufVariant';
            change.className = 'ds-button ds-button-secondary'; change.textContent = 'Variante wechseln …';
            change.dataset.probelaufAction = 'variant'; panel.appendChild(change);
        }
        const toggle = open => { panel.hidden = !open; briefButton.setAttribute('aria-expanded', String(open)); };
        briefButton.addEventListener('click', () => toggle(panel.hidden)); close.addEventListener('click', () => { toggle(false); briefButton.focus(); });
    }
    if (briefButton) { briefButton.hidden = !example; briefButton.disabled = controller.busy || controller.waiting || controller.blocked; }
    if (restart) restart.hidden = !example;
    if (panel && !example) panel.hidden = true;
}

/**
 * @param doc Dokument der Seite.
 * @param controller Besitzer des laufenden Vorgangs.
 * @param options Optionen des Aufrufers.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function bindProbelaufUI(doc, controller, { dateDialog = requestProbelaufDate,
    confirmRestart = opener => requestPageChoice({ doc, opener, title: 'Beispiel neu starten?',
        description: 'Alle Änderungen im Spielbereich gehen verloren. Deine echten Daten und Sicherungspunkte bleiben unverändert.',
        confirmLabel: 'Beispiel neu starten', cancelLabel: 'Weiter spielen', danger: true }).then(result => result !== null),
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
                ? { source: 'demo', testDate: HANDBOOK_MUSTER_DATE }
                : dateDialog({ doc, testDate, demoAvailable, starting: true, opener }), { opener });
            else if (action === 'restart') result = await controller.restart(() => confirmRestart(opener), { opener });
            else if (action === 'variant') {
                const state = controller.state;
                if (state?.source !== 'demo' || controller.blocked) return;
                const variants = musterVarianten(state.householdId);
                const choice = await requestPageChoice({ doc, opener, title: 'Variante wechseln',
                    rows: [{ id: 'variantId', label: 'Variante', selected: state.variantId,
                        options: variants.map(variant => ({ value: variant.id, label: variant.name })) }],
                    confirmLabel: 'Weiter', cancelLabel: 'Weiter spielen' });
                if (!choice || choice.variantId === state.variantId) return;
                result = await controller.restart(() => confirmRestart(opener), { opener, variantId: choice.variantId });
            }
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
