import { createTimeLapse, canRunTimeLapse, timeLapseDefaults, timeLapseDates } from './probelauf-timelapse.js';
import { areaSessionStorage } from './persistence-area-storage.js';
import { localCalendarDate } from './app-clock.js';
import { createInfoPopover, bindInfoPopovers } from './designsystem-info-popover.js';
import { runPageDialog } from './page-dialog.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';

const bindings = new WeakMap();
const explanation = 'Der Zeitraffer spielt Beispielausgaben ein, übernimmt Tagesgeld-Spielwerte und verwendet die normalen Monats- und Jahresabschlüsse. Fällige Handlungsanweisungen werden über die normalen Buchungswege samt Gutschrift eingetragen. Im Januar werden Plan und Handlungsanweisung des neuen Jahres festgeschrieben. Anhalten beendet den laufenden Speicherschritt; danach kannst du von Hand weiterspielen. Echte Daten bleiben unverändert.';

export function requestTimeLapse({ doc, controller, opener } = {}) {
    const defaults = timeLapseDefaults(controller.state.testDate || localCalendarDate());
    const today = controller.state.testDate === null;
    return runPageDialog({ doc, opener, id: 'probelaufTimeLapseDialog', title: 'Ein Jahr durchspielen',
        description: today ? 'Der erste Schritt springt zum Startdatum, bei Start heute einen Tag weiter. Damit gelten Spielkurse ohne Netz. Danach ist Übernehmen bis zum Beenden gesperrt. Mit dem Start bestätigst du diesen Datumssprung.'
            : 'Monat für Monat automatisch bis zum gewählten Ende. Im Januar folgt der Jahresabschluss mit Spielmarktdaten.' },
    ({ dialog, listen, finish }) => {
        const fields = {};
        for (const [key, text] of [['start', 'Start'], ['end', 'Ende']]) {
            const label = doc.createElement('label'); label.textContent = text;
            const input = doc.createElement('input'); input.type = 'date'; input.required = true; input.value = defaults[key];
            input.dataset.timeLapseDate = key; input.setAttribute('aria-label', text); label.append(input); dialog.append(label); fields[key] = input;
        }
        const status = doc.createElement('p'); status.setAttribute('role', 'alert');
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'ds-button ds-button-secondary'; cancel.textContent = 'Abbrechen';
        const accept = doc.createElement('button'); accept.type = 'button'; accept.className = 'ds-button ds-button-primary';
        accept.textContent = today ? 'Datumssprung bestätigen und starten' : 'Zeitraffer starten'; accept.dataset.timeLapseStart = '';
        listen(cancel, 'click', () => finish());
        const submit = () => {
            const selection = { start: fields.start.value, end: fields.end.value };
            try { timeLapseDates({ ...selection, todayMode: today }); finish(selection); }
            catch (error) { status.textContent = error.message; }
        };
        listen(accept, 'click', submit);
        for (const input of Object.values(fields)) listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
        actions.append(cancel, accept); dialog.append(status, actions);
        return { controls: () => [...Object.values(fields), cancel, accept] };
    });
}

/** Der Zugang sitzt auf allen Seiten im bestehenden Spielbereich-Band. Ausführung auf der Übersicht. */
export function renderTimeLapseUI(doc, controller) {
    const band = doc.getElementById('probelaufBand');
    const win = doc.defaultView || globalThis.window;
    if (!band || !win?.sessionStorage || !controller.state) return;
    let binding = bindings.get(doc);
    if (!binding) {
        let session;
        try { session = areaSessionStorage(win.sessionStorage); } catch { return; }
        const start = doc.createElement('button'); start.type = 'button'; start.className = 'ds-button ds-button-secondary';
        start.id = 'probelaufTimeLapse'; start.textContent = 'Ein Jahr durchspielen …';
        const stop = doc.createElement('button'); stop.type = 'button'; stop.className = 'ds-button ds-button-secondary';
        stop.id = 'probelaufTimeLapseStop'; stop.textContent = 'Anhalten';
        const progress = doc.createElement('span'); progress.id = 'probelaufTimeLapseProgress'; progress.setAttribute('role', 'status');
        const info = createInfoPopover(doc, 'Zeitraffer erklären', explanation);
        const actions = band.querySelector?.('.ds-actions') || band;
        const end = actions.querySelector?.('[data-probelauf-action="end"]');
        for (const element of [start, info, stop]) actions.insertBefore(element, end || null);
        actions.append(progress); bindInfoPopovers(doc);
        const runner = createTimeLapse({ controller, session, notify: () => renderTimeLapseUI(doc, controller),
            loadServices: async () => (await import('../overview/overview-timelapse.js')).createTimeLapseServices({ controller, win, guard: getPageNavigationGuard(doc, win) }) });
        binding = { start, stop, progress, runner, controller, locked: new Map(), ready: null, refresh: () => {}, handoff: false, pending: false };
        bindings.set(doc, binding); runner.restore();
        start.addEventListener('click', async () => {
            if (start.disabled || binding.pending) return;
            binding.pending = true;
            try {
                const selection = await requestTimeLapse({ doc, controller, opener: start });
                if (!selection || !canRunTimeLapse(controller)) return;
                runner.start(selection);
                if (doc.documentElement?.dataset.suitePage === 'index') await resumeTimeLapse(doc);
                else {
                    binding.handoff = true;
                    const link = doc.createElement('a'); link.href = 'index.html'; link.setAttribute('href', 'index.html');
                    link.setAttribute('data-profile-handoff', ''); link.setAttribute('data-profile-handoff-export', 'false');
                    link.hidden = true; doc.body.append(link); link.click(); link.remove();
                }
            } catch (error) { runner.stop(); progress.textContent = `Zeitraffer angehalten: ${error.message}`; }
            finally { binding.pending = false; }
        });
        stop.addEventListener('click', () => runner.stop());
        win.addEventListener?.('pagehide', () => {
            if (!binding.handoff && !(runner.state?.stage === 'date' && controller.blocked)) runner.stop();
        });
    }
    const { start, stop, progress, runner } = binding;
    const running = runner.state?.status === 'running', locked = running || runner.busy;
    const update = (node, property, value) => { if (node[property] !== value) node[property] = value; };
    update(start, 'hidden', locked); update(start, 'disabled', !canRunTimeLapse(controller)
        || doc.documentElement?.dataset.suitePage === 'index' && !binding.ready);
    update(stop, 'hidden', !locked); update(stop, 'disabled', !running);
    update(progress, 'textContent', runner.state?.message || '');
    for (const button of band.querySelectorAll?.('[data-probelauf-action]') || []) update(button, 'disabled', locked || controller.busy || controller.waiting
        || !controller.runtime?.canContinue || (controller.blocked || controller.state.phase !== 'active') && button.dataset.probelaufAction !== 'end');
    // Eingaben während der automatischen Schritte verhindern; das Band bleibt bedienbar.
    const main = doc.getElementById('suiteMain');
    if (locked) for (const element of main?.children || []) {
        if (element === band || binding.locked.has(element)) continue;
        binding.locked.set(element, Boolean(element.inert)); element.inert = true;
    }
    else { for (const [element, previous] of binding.locked) element.inert = previous; binding.locked.clear(); }
}

export async function resumeTimeLapse(doc, { ready, refresh } = {}) {
    const binding = bindings.get(doc);
    if (!binding) return;
    if (ready) binding.ready = ready;
    if (refresh) binding.refresh = refresh;
    if (ready) renderTimeLapseUI(doc, binding.controller);
    if (binding.runner.state?.status !== 'running') return;
    try { await binding.ready?.(); await binding.runner.run(); binding.refresh(); }
    catch (error) { binding.runner.fail(error); }
}
