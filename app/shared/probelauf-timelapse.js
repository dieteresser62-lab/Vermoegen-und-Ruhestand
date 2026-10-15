import { advanceCalendarDate, localCalendarDate, parseCalendarDate } from './app-clock.js';
import { canGenerateExampleExpenses } from '../demo/beispielausgaben.js';
import { PersistenceFacade as P, persistenceStorage } from './persistence-facade.js';

export const TIMELAPSE_SESSION_KEY = 'probelauf.timelapse.v1';
export function canRunTimeLapse(controller) {
    return controller?.state?.version === 2 && canGenerateExampleExpenses(controller)
        && P.getPersistenceStatus().activeArea === 'spiel';
}
export function timeLapseDefaults(date = localCalendarDate()) {
    const start = parseCalendarDate(date);
    return { start: date, end: `${start.getFullYear() + 1}-01-02` };
}

/** Ein Termin pro Monat, einschließlich Start und gewähltem Ende. */
export function timeLapseDates({ start, end, todayMode = false, current = localCalendarDate() }) {
    parseCalendarDate(start); parseCalendarDate(end);
    if (start < current || end < start) throw new Error('Start darf nicht vor dem Spieldatum liegen; Ende darf nicht vor dem Start liegen.');
    if (todayMode && start === current) start = advanceCalendarDate(start, 'day');
    if (end < start) throw new Error('Für den ersten Datumssprung muss das Ende nach heute liegen.');
    const dates = [start];
    while (dates.at(-1).slice(0, 7) < end.slice(0, 7)) {
        const next = advanceCalendarDate(dates.at(-1), 'month');
        dates.push(next.slice(0, 7) === end.slice(0, 7) ? end : next);
        if (dates.length > 13) throw new Error('Bitte höchstens ein Jahr auf einmal durchspielen.');
    }
    if (dates.at(-1) !== end) dates.push(end);
    return dates;
}

/** Nur Spiel-Sitzungsdaten. Finanzschritte besitzen ihre normalen Writer und Sicherungspunkte. */
export function createTimeLapse({ controller, session, notify = () => {},
    services, loadServices = async () => (await import('../overview/overview-timelapse.js')).createTimeLapseServices({ controller }),
    yieldStep = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    let state = null, inFlight = false;
    const save = () => { session.setItem(TIMELAPSE_SESSION_KEY, JSON.stringify(state)); notify(api); };
    const check = () => {
        if (!canRunTimeLapse(controller) || state.areaId !== P.getPersistenceStatus().areaControl?.id
            || state.profileId !== persistenceStorage.getItem('rs_current_profile')) throw new Error('Spielbereich oder Person wurde geändert.');
    };
    const step = async (message, execute) => {
        check();
        if (state.status !== 'running') return false;
        state.stage = 'working'; state.message = `${state.index} von ${state.dates.length} abgeschlossen · ${message}`; save();
        await yieldStep();
        if (state.status !== 'running') return false;
        await execute();
        await yieldStep();
        return state.status === 'running';
    };
    const api = {
        get state() { return state; },
        get busy() { return inFlight; },
        restore() {
            if (!canRunTimeLapse(controller) || !session) return null;
            const raw = session.getItem(TIMELAPSE_SESSION_KEY);
            if (!raw) return null;
            try {
                state = JSON.parse(raw); check();
                if (state.version !== 1 || !Array.isArray(state.dates) || !state.dates.length || state.dates.length > 13
                    || !Number.isInteger(state.index) || state.index < 0 || state.index > state.dates.length
                    || !['date', 'working'].includes(state.stage) || !['running', 'stopped', 'done', 'error'].includes(state.status)) throw new Error('Ungültiger Zeitrafferstand.');
                state.dates.forEach(parseCalendarDate);
                if (state.status === 'running' && state.stage === 'working') {
                    state.status = 'stopped'; state.message = 'Zeitraffer nach Neuladen angehalten. Bitte den erreichten Abschlussstand prüfen und von Hand fortsetzen.'; save();
                }
                return state;
            } catch { state = null; session.removeItem(TIMELAPSE_SESSION_KEY); return null; }
        },
        start(selection) {
            if (inFlight || !canRunTimeLapse(controller) || !session) throw new Error('Zeitraffer ist nur im aktiven Spielbereich verfügbar.');
            const dates = timeLapseDates({ ...selection, todayMode: controller.state.testDate === null });
            state = { version: 1, areaId: P.getPersistenceStatus().areaControl.id,
                profileId: persistenceStorage.getItem('rs_current_profile'), dates, index: 0,
                stage: 'date', status: 'running', message: 'Zeitraffer startet …' };
            save(); return state;
        },
        stop() {
            if (state?.status !== 'running') return;
            state.status = 'stopped'; state.message = inFlight ? 'Anhalten … der laufende Speicherschritt wird beendet.'
                : 'Zeitraffer angehalten. Du kannst von Hand weiterspielen.'; save();
        },
        fail(error) {
            if (!state) return;
            state.status = 'error'; state.message = `Zeitraffer angehalten: ${error.message} Du kannst den erreichten Stand prüfen und von Hand fortsetzen.`; save();
        },
        async run() {
            if (inFlight || state?.status !== 'running') return;
            inFlight = true; notify(api);
            try {
                check(); services ||= await loadServices();
                while (state.index < state.dates.length && state.status === 'running') {
                    check();
                    const date = state.dates[state.index];
                    if (controller.state.testDate !== date) {
                        state.stage = 'date'; state.message = `${state.index} von ${state.dates.length} abgeschlossen · Datum weiter auf ${date.split('-').reverse().join('.')} …`; save();
                        const result = await controller.changeDate(date);
                        if (result?.status !== 'reloaded') throw result?.error || new Error('Der Datumssprung wurde nicht bestätigt.');
                        return; // Derselbe reguläre Seitenstart setzt nach dem Datumssprung fort.
                    }
                    let period;
                    if (!await step('Beispielausgaben werden eingespielt …', async () => { period = await services.preparePeriod(); })) break;
                    if (!await step(period.annual ? 'Jahresabschluss mit Spielmarktdaten …' : `${period.label} wird abgeschlossen …`, () => services.closePeriod(period))) break;
                    if (!await step('Fällige Handlungsanweisung als Spielwert eintragen …', () => services.executeAction(period))) break;
                    state.index++; state.stage = 'date';
                    state.message = `${period.label} abgeschlossen · ${state.index} von ${state.dates.length}`; save();
                    await yieldStep();
                }
                if (state.status === 'running') { state.status = 'done'; state.message += ' · Zeitraffer fertig'; save(); }
            } catch (error) { api.fail(error); }
            finally {
                inFlight = false;
                if (state.status === 'stopped') { state.message = 'Zeitraffer angehalten. Du kannst von Hand weiterspielen.'; save(); }
                notify(api);
            }
        }
    };
    return api;
}
