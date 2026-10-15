import { createNavigationGuard, RESET_RELOAD_REQUIRED_MESSAGE } from '../app/shared/navigation-guard.js';
import { reloadGuardedPage } from '../app/shared/navigation-guard-dialog.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(decide = () => true) {
    const statuses = [], steps = [], listeners = new Map();
    const guard = createNavigationGuard({ decide, status: text => statuses.push(text), schedule: () => 1, unschedule() {} });
    const doc = { addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener(type) { listeners.delete(type); } };
    const win = { name: 'kein Bundleexport', location: { reload() { steps.push('reload'); } } };
    const reload = options => reloadGuardedPage({ guard, doc, win,
        mutate: () => { steps.push('mutate'); }, flush: () => { steps.push('flush'); return true; }, ...options });
    return { guard, reload, steps, statuses, listeners, win };
}
// Nach bestätigtem Bereichswechsel ist der alte Dokumentkontext verbraucht.
// Seitenprovider und Subscriber würden jetzt auf den gesperrten Speicher zugreifen.
{
    const f = fixture();
    let switched = false, lateReads = 0, lateNotifications = 0;
    f.guard.register('page', { read: () => {
        if (switched) { lateReads++; throw new Error('Alter Speicher gesperrt'); }
        return { dirty: true };
    } });
    f.guard.subscribe(() => { if (switched) lateNotifications++; });
    const result = await f.reload({ finalizeDocument: true, returnResult: true, flush: undefined,
        mutate() {
            switched = true;
            f.listeners.get('input')();
            return true;
        } });
    assertEqual(result.status, 'reloaded', 'Bestätigter Bereichswechsel navigiert auch nach später Eingabe');
    assertEqual(lateReads, 0, 'Nach Bereichswechsel keine Providerabfrage');
    assertEqual(lateNotifications, 0, 'Nach Bereichswechsel keine Seitenbenachrichtigung');
    let saves = 0, prevented = false;
    f.guard.registerBeforeLeave(() => { saves++; });
    f.guard.beforeUnload({ preventDefault() { prevented = true; } });
    assert(!prevented && saves === 0, 'Kein später Saver oder nativer Navigationsstopp');
    assertEqual(await f.guard.prepare(), null, 'Alte Seite startet keine weitere Aktion');
}
for (const mutation of [() => false, () => { throw new Error('Wechsel fehlgeschlagen'); }]) {
    const f = fixture();
    const result = await f.reload({ finalizeDocument: true, returnResult: true, mutate: mutation });
    assertEqual(result.status, 'failed', 'Unbestätigter Wechsel bleibt ein Fehler');
    const attempt = await f.guard.prepare();
    assert(Boolean(attempt), 'Fehlgeschlagener Wechsel beendet das Dokument nicht');
    f.guard.end(attempt);
}
{
    const f = fixture(() => false);
    f.guard.register('result', { read: () => ({ result: true }) });
    assertEqual(await f.reload(), false, 'Bleiben verhindert Resetmutation und Reload');
    assertEqual(f.steps.length, 0, 'Ablehnung verändert keine Daten und startet keinen Flush');
    assertEqual(f.listeners.size, 0, 'Ablehnung räumt Eingabebeobachtung auf');
}
{
    const f = fixture(), ending = deferred(), flush = deferred();
    let phase = 'running';
    const job = f.guard.register('job', { read: () => ({ phase, operationId: 1 }),
        async cancel() { f.steps.push('cancel'); await ending.promise; phase = 'idle'; job.notify(); f.steps.push('ended'); } });
    const task = f.reload({ flush: () => { f.steps.push('flush'); return flush.promise; } });
    await tick();
    assertEqual(f.steps.join(','), 'cancel', 'Reset wartet das tatsächliche Abbruchende ab');
    ending.resolve(); await tick();
    assertEqual(f.steps.join(','), 'cancel,ended,mutate,flush', 'Abbruchende liegt vor Resetmutation und Flush');
    assert(f.guard.reasons().some(reason => reason.phase === 'commit'), 'Reloadlease bleibt bis bestätigtem Flush im Commit');
    assertEqual(await f.guard.prepare(), null, 'Fremde Appnavigation kann Resetflush nicht überholen');
    assert(f.statuses.some(text => text.includes('geschrieben')), 'Navigation während Resetcommit zeigt den ortsfesten Wartehinweis');
    assertEqual(await f.reload(), false, 'Doppelreset startet keine zweite Mutation');
    flush.resolve(true);
    assertEqual(await task, true, 'Bestätigter Reset führt nach Schlussprüfung genau einmal weiter');
    assertEqual(f.steps.join(','), 'cancel,ended,mutate,flush,reload', 'Erfolgreicher Reset besitzt genau einen Reload');
    assertEqual(f.win.name, 'kein Bundleexport', 'Reset exportiert kein Profilbundle');
    assertEqual(f.listeners.size, 0, 'Erfolg entfernt die Eingabebeobachtung');
}
for (const failure of ['false', 'throw']) {
    const f = fixture();
    let failed = false;
    try { await f.reload({ flush: () => { if (failure === 'throw') throw new Error('FLUSH'); return false; } }); }
    catch { failed = true; }
    assertEqual(failed, true, 'Flush-false und Ausnahme werden als Speicherfehler gemeldet');
    assertEqual(f.steps.join(','), 'mutate', 'Fehlgeschlagener Flush startet keinen Reload');
    assertEqual(f.guard.isBusy(), false, 'Speicherfehler gibt ausschließlich den eigenen Versuch frei');
    assertEqual(f.guard.reasons().length, 0, 'Speicherfehler räumt den eigenen Commit auf');
    assertEqual(await f.reload(), true, 'Nach Speicherfehler ist explizite Wiederholung möglich');
}
for (const stage of ['ready', 'mutate', 'flush']) for (const change of ['input', 'change', 'foreign']) {
    const f = fixture(), hold = deferred();
    const task = f.reload({ [stage]: () => { f.steps.push(stage); return hold.promise; } });
    await tick();
    if (change === 'foreign') {
        const foreign = f.guard.register('foreign', { read: () => ({ phase: 'commit' }) });
        foreign.unregister(); // Auch ein bereits beendeter fremder Write entwertet Zustimmung.
    } else f.listeners.get(change)();
    hold.resolve(true);
    assertEqual(await task, false, 'Neue Eingabe oder fremder Commit entwertet ursprüngliche Reset-Zustimmung');
    assertEqual(f.steps.includes('reload'), false, 'Geänderter Zustand verhindert den tatsächlichen Reload');
    assert(f.statuses.some(text => text.includes('Zustand hat sich geändert')), 'Verworfene Zustimmung meldet ortsfest einen erneuten Versuch');
    assertEqual(f.guard.isBusy(), false, 'Ungültige Zustimmung lässt Wiederholung zu');
}
{
    const f = fixture(), hold = deferred();
    const foreign = f.guard.register('foreign', { read: () => ({ phase: 'commit' }) });
    assertEqual(await f.reload(), false, 'Schon laufender fremder Commit sperrt Reset vor Mutation');
    assertEqual(f.steps.length, 0, 'Commitablehnung hat keine Resetnebenwirkung');
    foreign.unregister();
    const task = f.reload({ mutate: () => hold.promise }); await tick();
    f.listeners.get('input')();
    assert(f.guard.reasons().some(reason => reason.phase === 'commit'), 'Neue Eingabe gibt einen begonnenen Resetwrite nicht vorzeitig frei');
    hold.resolve(true); await task;
    assertEqual(f.steps.join(','), 'flush', 'Begonnener Reset wird trotz ungültiger Zustimmung geflusht, aber nicht neu geladen');
}

for (const phase of ['prepare', 'flush-false', 'flush-throw', 'reload-throw', 'success']) {
    const f = fixture();
    if (phase === 'prepare') f.guard.register('uncancellable', { read: () => ({ phase: 'running' }), cancel: () => false });
    const result = await f.reload({ returnResult: true, completionMessage: 'Reset gespeichert; nicht neu geladen. Bitte neu laden; Eingaben werden nicht gespeichert.',
        flush: () => { f.steps.push('flush'); if (phase === 'flush-throw') throw new Error('FLUSH'); return phase !== 'flush-false'; },
        reload: () => { if (phase === 'reload-throw') throw new Error('RELOAD'); f.steps.push('reload'); }
    });
    assertEqual(result.status, phase === 'prepare' ? 'cancelled' : phase.startsWith('flush') ? 'failed' : phase === 'reload-throw' ? 'reload_required' : 'reloaded', `${phase}: optionaler Statusvertrag unterscheidet Abschlussphase`);
    assertEqual(f.steps.includes('mutate'), phase !== 'prepare', `${phase}: Mutation erst nach Vorbereitung`);
    assertEqual(f.steps.includes('reload'), phase === 'success', `${phase}: genau erfolgreicher Schluss führt weiter`);
    assertEqual(f.listeners.size, 0, `${phase}: Schluss räumt Beobachtung auf`);
    assertEqual(f.guard.isBusy(), phase === 'success', `${phase}: nur Erfolg hält die einmalige native Reloadreservierung`);
    if (phase === 'prepare') assert(f.statuses.at(-1).includes('abgebrochen'), 'Vorbereitungsfehler erhält Rahmenabbruchhinweis');
    if (phase === 'reload-throw') assert(f.statuses.at(-1).includes('Reset gespeichert') && !f.statuses.at(-1).includes('abgebrochen'), 'Reloadcallbackfehler nach bestätigtem Flush meldet Speicherung');
}

// Reiner Flush: Die Fixturemutation ausdrücklich ausschalten.
{
    const f = fixture(), hold = deferred();
    const task = f.reload({ mutate: undefined, flush: () => hold.promise });
    await tick();
    assertEqual(f.steps.filter(step => step === 'mutate').length, 0, 'Reiner Flush beginnt keine Mutation');
    assertEqual(f.guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Reiner Flush hält genau einen Commitbesitzer');
    assertEqual(await f.guard.prepare(), null, 'Konkurrierende Appnavigation bleibt während reinem Flush gesperrt');
    f.listeners.get('input')();
    assertEqual(f.guard.isBusy(), true, 'Eingabeentwertung beendet offenen reinen Flush nicht');
    assertEqual(f.guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Reiner Flush behält nach Eingabe seinen Commitbesitzer');
    assertEqual(await f.guard.prepare(), null, 'Auch nach Eingabe wartet Appnavigation auf die reine Flushantwort');
    hold.resolve(true);
    assertEqual(await task, false, 'Entwerteter reiner Flush liefert boolesch false');
    assertEqual(f.steps.filter(step => step === 'reload').length, 0, 'Entwerteter reiner Flush ruft Reload niemals auf');
    const message = f.statuses.at(-1);
    assertEqual(message, 'Navigation abgebrochen: Der Zustand hat sich geändert. Bitte erneut versuchen.', 'Reiner Flush erhält exakt den bisherigen Abbruchhinweis');
    assertEqual(message.includes('nicht gespeichert'), false, 'Reiner Flush behauptet keinen Verlust nachfolgender Speicherung');
    assertEqual(/gesperrt|Schreibsperre|Schreibschutz/.test(message), false, 'Reiner Flush behauptet keine Eingabesperre');
    assertEqual(f.listeners.size, 0, 'Entwerteter reiner Flush räumt Eingabebeobachtung auf');
    assertEqual(f.guard.reasons().length, 0, 'Reine Flushantwort gibt den Commitbesitzer frei');
    assertEqual(f.guard.isBusy(), false, 'Reine Flushantwort beendet die Navigation');
}

// Generische Mutation ohne ausdrückliche Reset-Abschlussmeldung.
{
    const f = fixture(), hold = deferred();
    const task = f.reload({ flush: () => hold.promise });
    await tick();
    assertEqual(f.steps.filter(step => step === 'mutate').length, 1, 'Generischer Reload führt genau eine Mutation aus');
    assertEqual(f.guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Mutierender Flush hält genau einen Commitbesitzer');
    assertEqual(await f.guard.prepare(), null, 'Appnavigation überholt mutierenden Flush nicht');
    f.listeners.get('input')();
    assertEqual(f.guard.isBusy(), true, 'Eingabeentwertung beendet mutierenden Flush nicht');
    assertEqual(f.guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Mutierender Flush behält nach Eingabe seinen Commitbesitzer');
    assertEqual(await f.guard.prepare(), null, 'Auch nach Eingabe bleibt Appnavigation bis zur Mutationsflushantwort gesperrt');
    hold.resolve(true);
    assertEqual(await task, false, 'Entwerteter generischer Mutationsreload liefert boolesch false');
    assertEqual(f.steps.filter(step => step === 'mutate').length, 1, 'Flushantwort wiederholt die Mutation nicht');
    assertEqual(f.steps.filter(step => step === 'reload').length, 0, 'Entwerteter generischer Mutationsreload ruft Reload niemals auf');
    const message = f.statuses.at(-1);
    assert(message.includes('Daten geändert'), 'Generische Mutation meldet tatsächlich geänderte Daten');
    assert(message.includes('nicht neu geladen'), 'Generische Mutation erklärt den ausgebliebenen Reload');
    assertEqual(message.includes('nicht gespeichert'), false, 'Generische Mutation behauptet keine gesperrte Speicherung');
    assertEqual(/gesperrt|Schreibsperre|Schreibschutz/.test(message), false, 'Generische Mutation behauptet keine Eingabesperre');
    assertEqual(message.includes('Reset'), false, 'Generische Mutation behauptet keinen Reset');
    assertEqual(f.listeners.size, 0, 'Entwertete Mutation räumt Eingabebeobachtung auf');
    assertEqual(f.guard.reasons().length, 0, 'Bestätigte Mutation räumt Commitbesitzer auf');
    assertEqual(f.guard.isBusy(), false, 'Entwertete Mutation beendet ihren Versuch nach Flushantwort');
}

for (const returnResult of [false, true]) {
    const f = fixture(), failure = new Error('SYNTHETIC_RELOAD_FAILURE');
    let result, caught;
    try { result = await f.reload({ returnResult, reload: () => { f.steps.push('reload'); throw failure; } }); }
    catch (error) { caught = error; }
    assertEqual(f.steps.join(','), 'mutate,flush,reload', 'Callbackfehler tritt erst nach Mutation und bestätigtem Flush ein');
    if (returnResult) {
        assertEqual(result.status, 'reload_required', 'Generischer Callbackfehler liefert optional reload_required');
        assertEqual(result.error, failure, 'Optionaler Ergebnisvertrag erhält die Callbackausnahme');
        const message = f.statuses.at(-1);
        assert(message.includes('Daten geändert') && message.includes('nicht neu geladen'), 'Generischer Callbackfehler meldet geänderte Daten und ausgebliebenen Reload');
        assertEqual(message.includes('nicht gespeichert'), false, 'Generischer Callbackfehler behauptet keine ausgebliebene Speicherung');
        assertEqual(/gesperrt|Schreibsperre|Schreibschutz|Reset/.test(message), false, 'Generischer Callbackfehler behauptet weder Reset noch Sperre');
    } else assertEqual(caught, failure, 'Boolescher Reload behält bei Callbackfehler seinen Ausnahmenvertrag');
    assertEqual(f.listeners.size, 0, 'Callbackfehler räumt Eingabebeobachtung auf');
    assertEqual(f.guard.reasons().length, 0, 'Callbackfehler räumt Commitbesitzer auf');
    assertEqual(f.guard.isBusy(), false, 'Callbackfehler gibt den Versuch frei');
}

for (const outcome of ['input', 'reload-throw']) {
    const f = fixture(), hold = deferred();
    const task = f.reload({ returnResult: true, completionMessage: RESET_RELOAD_REQUIRED_MESSAGE,
        flush: () => hold.promise,
        reload: () => { f.steps.push('reload'); throw new Error('SYNTHETIC_RESET_RELOAD_FAILURE'); } });
    await tick();
    if (outcome === 'input') f.listeners.get('input')();
    hold.resolve(true);
    const result = await task;
    assertEqual(result.status, 'reload_required', `${outcome}: bestätigter Reset benötigt Reload`);
    assertEqual(f.statuses.at(-1), RESET_RELOAD_REQUIRED_MESSAGE, `${outcome}: ausdrückliche Reset-Abschlussmeldung bleibt wortgleich`);
    assertEqual(f.steps.filter(step => step === 'reload').length, outcome === 'input' ? 0 : 1, `${outcome}: Resetcallback nur mit gültiger Zustimmung`);
    assertEqual(f.listeners.size, 0, `${outcome}: Reset räumt Eingabebeobachtung auf`);
    assertEqual(f.guard.reasons().length, 0, `${outcome}: Reset räumt Commitbesitzer auf`);
}
