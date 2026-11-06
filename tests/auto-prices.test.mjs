// Kurse automatisch: Takt, Zeitfenster, Sperren und Sitzungsmerker ohne Browser.
import { bindAutoPrices, isAutoPriceHour, pageInUse, notePriceRound, AUTO_PRICE_INTERVAL_MS, AUTO_PRICE_RETRY_MS, AUTO_PRICE_FIRST_DELAY_MS,
    AUTO_PRICE_SESSION_KEY } from '../app/shared/auto-prices.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

// Donnerstag 05.11.2026 10:00 Ortszeit; die Uhrzeitprüfung bekommt eine eigene Uhr.
const thursday = new Date(2026, 10, 5, 10, 0), T0 = thursday.getTime();
function harness({ tauri = true, visibility = 'visible', session = new Map(), clock = () => thursday, lastRun = () => null, blocked = () => false,
    start = T0, readOnly = false } = {}) {
    let time = start, id = 0;
    const timers = new Map(), listeners = new Map(), runs = [];
    const doc = { visibilityState: visibility, activeElement: null, dialog: false,
        querySelectorAll: () => (doc.dialog ? [{ tagName: 'DIALOG' }] : []),
        addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
    const win = { ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
        setTimeout: (fn, ms) => { timers.set(++id, { fn, at: time + ms }); return id; }, clearTimeout: key => timers.delete(key),
        addEventListener: (type, fn) => listeners.set('win:' + type, fn) };
    const storage = { getItem: key => session.get(key) ?? null,
        setItem: (key, value) => { if (readOnly) throw new Error('Sitzungsspeicher voll'); session.set(key, String(value)); } };
    const binding = bindAutoPrices({ doc, win, run: () => { runs.push(time); }, lastRun, blocked, now: () => time, clock, session: storage });
    const next = () => [...timers.values()].sort((a, b) => a.at - b.at)[0];
    const advance = async ms => {
        const end = time + ms;
        for (let timer = next(); timer && timer.at <= end; timer = next()) {
            for (const [key, value] of timers) if (value === timer) timers.delete(key);
            time = timer.at; timer.fn();
            for (let i = 0; i < 20; i++) await Promise.resolve();
        }
        time = end;
    };
    return { doc, win, binding, runs, timers, session, storage, listeners, advance, now: () => time };
}

assertEqual(isAutoPriceHour(new Date(2026, 10, 5, 7, 59)), false, 'Vor 8 Uhr keine Runde');
assertEqual(isAutoPriceHour(new Date(2026, 10, 5, 8, 0)), true, 'Ab 8 Uhr');
assertEqual(isAutoPriceHour(new Date(2026, 10, 5, 21, 59)), true, 'Bis vor 22 Uhr');
assertEqual(isAutoPriceHour(new Date(2026, 10, 5, 22, 0)), false, 'Ab 22 Uhr keine Runde');
assertEqual(isAutoPriceHour(new Date(2026, 10, 7, 12, 0)), false, 'Samstag keine Runde');
assertEqual(isAutoPriceHour(new Date(2026, 10, 8, 12, 0)), false, 'Sonntag keine Runde');
const page = (dialogs, tagName = 'BODY') => ({ querySelectorAll: () => dialogs, activeElement: { tagName } });
const modal = (shown, hidden = false) => ({ tagName: 'DIV', hidden, getClientRects: () => (shown ? [{}] : []) });
assertEqual(pageInUse(page([], 'INPUT')), true, 'Fokus im Eingabefeld zählt als Benutzung');
assertEqual(pageInUse(page([{ tagName: 'DIALOG' }])), true, 'Offener Dialog zählt als Benutzung');
assertEqual(pageInUse(page([modal(true)])), true, 'Sichtbares Modal zählt als Benutzung');
assertEqual(pageInUse(page([modal(false), modal(true, true)])), false, 'Ausgeblendete Modale im Seitenbaum zählen nicht');
assertEqual(pageInUse(page([], 'BUTTON')), false, 'Knopf im Fokus ist keine Benutzung');

assertEqual(harness({ tauri: false }).binding, null, 'Browserfassung ohne automatische Runden');
setAppTestDate('2026-11-05');
assertEqual(harness().binding, null, 'Mit Testdatum keine automatischen Runden');
setAppTestDate(null);

{
    const h = harness();
    await h.advance(AUTO_PRICE_INTERVAL_MS - 1);
    assertEqual(h.runs.length, 0, 'Erste Runde erst nach 15 Minuten');
    await h.advance(1);
    assertEqual(h.runs.length, 1, 'Nach 15 Minuten eine Runde');
    assertEqual(Number(h.session.get(AUTO_PRICE_SESSION_KEY)), h.runs[0], 'Sitzungsmerker hält den Zeitpunkt der Runde');
    await h.advance(AUTO_PRICE_INTERVAL_MS * 2);
    assertEqual(h.runs.length, 3, 'Danach alle 15 Minuten');
    h.listeners.get('win:pagehide')();
    await h.advance(AUTO_PRICE_INTERVAL_MS * 2);
    assertEqual(h.runs.length, 3, 'Nach Seitenwechsel keine Runde mehr');
}
{
    // Seitenwechsel: die neue Seite übernimmt den Takt aus dem Sitzungsmerker statt neu zu beginnen.
    const session = new Map([[AUTO_PRICE_SESSION_KEY, String(T0 - 10 * 60 * 1000)]]);
    const h = harness({ session });
    await h.advance(5 * 60 * 1000 - 1);
    assertEqual(h.runs.length, 0, 'Restzeit aus der vorigen Seite gilt');
    await h.advance(1);
    assertEqual(h.runs.length, 1, 'Runde zur fälligen Zeit');
}
{
    const h = harness({ lastRun: () => T0 - AUTO_PRICE_INTERVAL_MS * 4 });
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS);
    assertEqual(h.runs.length, 1, 'Überfällige Runde kurz nach dem Seitenstart');
}
{
    let busy = true;
    const h = harness({ blocked: () => busy, lastRun: () => 1 });
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS + AUTO_PRICE_RETRY_MS * 3);
    assertEqual(h.runs.length, 0, 'Laufender Vorgang verschiebt die Runde');
    busy = false;
    await h.advance(AUTO_PRICE_RETRY_MS);
    assertEqual(h.runs.length, 1, 'Eine Minute nach dem Ende der Sperre läuft die Runde');
}
{
    const h = harness({ lastRun: () => 1 });
    h.doc.dialog = true;
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS + AUTO_PRICE_RETRY_MS);
    assertEqual(h.runs.length, 0, 'Offener Dialog verschiebt die Runde');
    h.doc.dialog = false;
    await h.advance(AUTO_PRICE_RETRY_MS);
    assertEqual(h.runs.length, 1, 'Nach dem Dialog läuft die Runde');
}
{
    const h = harness({ clock: () => new Date(2026, 10, 7, 12, 0), lastRun: () => 1 });
    await h.advance(AUTO_PRICE_INTERVAL_MS * 3);
    assertEqual(h.runs.length, 0, 'Am Wochenende keine Runde');
}
{
    const h = harness({ visibility: 'hidden', lastRun: () => 1 });
    await h.advance(AUTO_PRICE_INTERVAL_MS * 2);
    assertEqual(h.runs.length, 0, 'Verdeckte Seite ruft keine Kurse ab');
    h.doc.visibilityState = 'visible'; h.listeners.get('visibilitychange')();
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS);
    assertEqual(h.runs.length, 1, 'Wieder sichtbar: überfällige Runde läuft');
}
{
    // Ohne bisherigen Abruf hält der erste Seitenstart den Takt auch über einen Seitenwechsel (Gutachten KA, Befund 5).
    const session = new Map();
    const first = harness({ session });
    assertEqual(Number(session.get(AUTO_PRICE_SESSION_KEY)), T0, 'Erster Seitenstart setzt den Fälligkeitsanker');
    await first.advance(10 * 60 * 1000); first.listeners.get('win:pagehide')();
    const second = harness({ session, start: T0 + 10 * 60 * 1000 });
    await second.advance(5 * 60 * 1000 - 1);
    assertEqual(second.runs.length, 0, 'Neue Seite wartet nur die Restzeit');
    await second.advance(1);
    assertEqual(second.runs.length, 1, 'Runde 15 Minuten nach dem ersten Seitenstart');
}
{
    // Nicht beschreibbarer Sitzungsspeicher: die Seite merkt sich ihre Runde selbst (Befund 4).
    const h = harness({ readOnly: true, lastRun: () => 1 });
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS);
    assertEqual(h.runs.length, 1, 'Überfällige Runde läuft');
    h.doc.visibilityState = 'hidden'; h.listeners.get('visibilitychange')();
    h.doc.visibilityState = 'visible'; h.listeners.get('visibilitychange')();
    await h.advance(AUTO_PRICE_FIRST_DELAY_MS * 2);
    assertEqual(h.runs.length, 1, 'Rückkehr kurz danach ruft nicht erneut ab');
    await h.advance(AUTO_PRICE_INTERVAL_MS);
    assertEqual(h.runs.length, 2, 'Nächste Runde nach 15 Minuten');
}
{
    // Knopf „Kurse aktualisieren“ verschiebt die nächste Runde (Befund 3).
    const h = harness();
    await h.advance(14 * 60 * 1000);
    notePriceRound({ session: h.storage, now: h.now() });
    await h.advance(60 * 1000 + AUTO_PRICE_FIRST_DELAY_MS);
    assertEqual(h.runs.length, 0, 'Kein Abruf kurz nach dem Knopf');
    await h.advance(14 * 60 * 1000);
    assertEqual(h.runs.length, 1, 'Runde 15 Minuten nach dem Knopf');
    notePriceRound({ session: { setItem() { throw new Error('voll'); } } });
    assert(true, 'Werfender Sitzungsspeicher bricht den Knopf nicht ab');
}
