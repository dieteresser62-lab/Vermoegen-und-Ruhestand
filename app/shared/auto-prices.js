// @ts-check
// Kurse automatisch (Nutzerwunsch 06.11.2026): alle 15 Minuten werktags von 8 bis 22 Uhr, solange die Seite sichtbar ist.
// Nur in der EXE (die Browserfassung dient Entwicklung und Tests), nur im Echtbereich und ohne Testdatum. Eine Seite in Benutzung (Dialog, Eingabefeld, laufender Vorgang) verschiebt die Runde um eine Minute.
import { PersistenceFacade } from './persistence-facade.js';
import { areaSessionStorage } from './persistence-area-storage.js';
import { getAppTestDate } from './app-clock.js';
import { isTauriRuntime } from './runtime-env.js';

export const AUTO_PRICE_INTERVAL_MS = 15 * 60 * 1000;
export const AUTO_PRICE_RETRY_MS = 60 * 1000;
export const AUTO_PRICE_FIRST_DELAY_MS = 5000;
export const AUTO_PRICE_SESSION_KEY = 'rs_auto_prices_last_v1';

/** Werktags 8 bis 22 Uhr Ortszeit; außerhalb ändern sich die Kurse nicht. @param {Date} date */
export function isAutoPriceHour(date) {
    const day = date.getDay(), hour = date.getHours();
    return day >= 1 && day <= 5 && hour >= 8 && hour < 22;
}

/** Sichtbarer Dialog oder Fokus in einem Eingabefeld; Seiten halten ausgeblendete Modale im Baum. @param {Document} doc */
export function pageInUse(doc) {
    const active = doc.activeElement;
    const dialogs = [...doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')];
    return dialogs.some(dialog => dialog.tagName === 'DIALOG' || (!(/** @type {HTMLElement} */ (dialog).hidden) && dialog.getClientRects().length > 0))
        || Boolean(active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}

/** Jeder Kursabruf, auch über den Knopf, verschiebt die nächste automatische Runde.
 * @param {{win?: Window & typeof globalThis, session?: Storage | null, now?: number}} [options] */
export function notePriceRound({ win = globalThis.window, session, now = Date.now() } = {}) {
    try { (session || areaSessionStorage(win?.sessionStorage))?.setItem(AUTO_PRICE_SESSION_KEY, String(now)); } catch { /* Ohne Sitzungsspeicher zählt die Seite selbst. */ }
}

/**
 * Plant die Runden für ein Dokument. Der Zeitpunkt der letzten Runde liegt im Sitzungsspeicher des Bereichs,
 * damit ein Seitenwechsel weder eine Runde auslöst noch den Takt neu beginnt.
 * @param {{doc: Document, win: Window & typeof globalThis, run: () => unknown, lastRun?: () => number | null | undefined,
 *   blocked?: () => boolean, now?: () => number, clock?: () => Date, session?: Storage | null}} options
 * @returns {{ stop: () => void } | null}
 */
export function bindAutoPrices({ doc, win, run, lastRun = () => null, blocked = () => false, now = () => Date.now(), clock = () => new Date(), session }) {
    if (typeof win?.setTimeout !== 'function' || !isTauriRuntime(win) || getAppTestDate()) return null;
    try { session ||= areaSessionStorage(win.sessionStorage); } catch { session = null; }
    const stored = () => { try { return Number(session?.getItem(AUTO_PRICE_SESSION_KEY)) || 0; } catch { return 0; } };
    let local = 0;
    const note = (/** @type {number} */ time) => { local = time; notePriceRound({ win, session, now: time }); };
    const last = () => Math.max(stored(), Number(lastRun()) || 0, local);
    // Fälligkeitsanker: Ohne bekannten Abruf zählt der erste Seitenstart der Sitzung, auch über Seitenwechsel.
    if (!last()) note(now());
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let stopped = false, running = false;
    const plan = (/** @type {number} */ delay) => {
        win.clearTimeout(timer);
        if (stopped) return;
        timer = win.setTimeout(() => void tick(), Math.max(1000, delay));
        /** @type {{ unref?: () => void }} */ (/** @type {unknown} */ (timer))?.unref?.();
    };
    const tick = async () => {
        if (stopped || running || doc.visibilityState === 'hidden') return;
        const wait = last() + AUTO_PRICE_INTERVAL_MS - now();
        if (wait > 0) { plan(wait); return; }
        if (!isAutoPriceHour(clock()) || PersistenceFacade.getPersistenceStatus().activeArea !== 'echt') { plan(AUTO_PRICE_INTERVAL_MS); return; }
        if (blocked() || pageInUse(doc)) { plan(AUTO_PRICE_RETRY_MS); return; }
        running = true;
        note(now());
        try { await run(); } catch (error) { console.error('Automatischer Kursabruf fehlgeschlagen:', error); }
        finally { running = false; plan(AUTO_PRICE_INTERVAL_MS); }
    };
    const visible = () => { if (doc.visibilityState === 'visible' && !running) plan(AUTO_PRICE_FIRST_DELAY_MS); };
    const stop = () => { stopped = true; win.clearTimeout(timer); doc.removeEventListener('visibilitychange', visible); };
    doc.addEventListener('visibilitychange', visible);
    win.addEventListener('pagehide', stop, { once: true });
    plan(AUTO_PRICE_FIRST_DELAY_MS);
    return { stop };
}
