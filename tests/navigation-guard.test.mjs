import { createNavigationGuard } from '../app/shared/navigation-guard.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(options = {}) {
    const statuses = [], timers = new Map(); let timerId = 0;
    const guard = createNavigationGuard({ decide: async () => true, status: message => statuses.push(message),
        schedule: fn => { timers.set(++timerId, fn); return timerId; }, unschedule: id => timers.delete(id), ...options });
    function provider(owner, initial, cancel) {
        let state = initial;
        const registration = guard.register(owner, { read: () => state, cancel });
        return { set(next) { state = { ...state, ...next }; registration.notify(); }, registration };
    }
    return { guard, provider, statuses, expire() { for (const fn of [...timers.values()]) fn(); } };
}
function unload(guard) {
    let synchronous = true, prevented = false, value = null;
    const event = { preventDefault() { assertEqual(synchronous, true, 'Native Verhinderung erfolgt synchron'); prevented = true; },
        set returnValue(next) { assertEqual(synchronous, true, 'Native Rückgabe erfolgt synchron'); value = next; } };
    guard.beforeUnload(event); synchronous = false;
    return { prevented, value };
}
{
    const steps = [], ends = [deferred(), deferred()];
    const f = fixture({ decide: async () => { steps.push('Entscheidung'); return true; } });
    const a = f.provider('a', { phase: 'running', operationId: 'a1', revision: 1 }, async () => { await ends[0].promise; a.set({ phase: 'idle', operationId: null }); steps.push('Ende a'); });
    const b = f.provider('b', { phase: 'preparing', operationId: 'b1', revision: 1 }, async () => { await ends[1].promise; b.set({ phase: 'idle' }); steps.push('Ende b'); });
    const preparing = f.guard.prepare(); await tick();
    assertEqual(await f.guard.prepare(), null, 'Offener Versuch ist dokumentweit singleflight');
    ends[1].resolve(); await tick();
    assertEqual(steps.join(','), 'Entscheidung,Ende b', 'Vor vollständigem Abbruchende keine Übergabe');
    ends[0].resolve(); const attempt = await preparing;
    assert(attempt, 'Eigene Abbruchenden gleicher Generation erhalten Zustimmung');
    steps.push('Übergabe', 'Flush bestätigt');
    assertEqual(f.guard.validate(attempt), true, 'Schlussprüfung nach Flush erlaubt unveränderte Gründe');
    steps.push('Prüfung'); f.guard.commitNavigation(attempt, () => steps.push('Wechsel'));
    assertEqual(steps.join(','), 'Entscheidung,Ende b,Ende a,Übergabe,Flush bestätigt,Prüfung,Wechsel', 'Entscheidung → alle Enden → Übergabe → Flush → Prüfung → ein Wechsel');
}
for (const when of ['dialog', 'cancel', 'flush']) for (const change of ['revision', 'commit', 'generation']) {
    const hold = deferred();
    const f = fixture({ decide: () => when === 'dialog' ? hold.promise : true });
    const p = f.provider('job', { phase: when === 'cancel' ? 'running' : 'idle', operationId: 'g1', revision: 1, result: true }, async () => {
        await hold.promise; p.set({ phase: 'idle' }); return true;
    });
    const preparing = f.guard.prepare(); await tick();
    const attempt = when === 'flush' ? await preparing : null;
    p.set(change === 'revision' ? { revision: 2 } : change === 'commit' ? { phase: 'commit' } : { operationId: 'g2' });
    // Auch eine kurz gestartete und wieder beendete fremde Mutation invalidiert.
    if (change === 'commit') p.set({ phase: when === 'cancel' ? 'running' : 'idle' });
    hold.resolve(true);
    if (when === 'flush') assertEqual(f.guard.commitNavigation(attempt, () => { throw new Error('ZIELWRITE'); }), false, 'Neue Gründe während Flush verwerfen alte Zustimmung');
    else assertEqual(await preparing, null, 'Neue Revision/Commit/Generation während Nachfrage oder Abbruch verwirft Zustimmung');
}
{
    let cancels = 0; const f = fixture({ decide: () => false });
    f.provider('job', { phase: 'running' }, () => { cancels++; });
    assertEqual(await f.guard.prepare(), null, 'Bleiben beendet Versuch');
    assertEqual(cancels, 0, 'Bleiben kündigt keine Arbeit');
}
for (const failure of ['false', 'throw', 'incomplete']) {
    const f = fixture(); let otherEnded = false;
    f.provider('bad', { phase: 'running' }, () => { if (failure === 'throw') throw new Error('ABBRUCH'); return failure === 'false' ? false : true; });
    const other = f.provider('other', { phase: 'running', operationId: 2 }, async () => { await tick(); otherEnded = true; other.set({ phase: 'idle' }); });
    let rejected = false; try { await f.guard.prepare(); } catch { rejected = true; }
    assertEqual(rejected, true, 'Fehler und unbestätigtes Abbruchende lehnen Navigation ab');
    assertEqual(otherEnded, true, 'Auch bei Abbruchfehler alle anderen Enden abwarten');
    assertEqual(f.guard.isBusy(), false, 'Abbruchfehler gibt Versuch frei');
}
{
    let decisions = 0; const f = fixture({ decide: () => { decisions++; return true; } });
    const commit = f.provider('write', { phase: 'commit', message: 'Jahresabschluss schreibt – bitte warten' });
    assertEqual(await f.guard.prepare(), null, 'Commit sperrt bereits vor Entscheidung');
    assertEqual(decisions, 0, 'Commit öffnet keinen Verlustdialog');
    assertEqual(f.statuses[0], 'Jahresabschluss schreibt – bitte warten', 'Besitzerhinweis bleibt ortsfest');
    commit.set({ phase: 'idle', result: true });
    assertEqual(unload(f.guard).prevented, true, 'Ergebnis aktiviert nativen Schutz');
    const attempt = await f.guard.prepare(); f.guard.commitNavigation(attempt, () => {});
    assertEqual(unload(f.guard).prevented, false, 'Aktueller Wechsel konsumiert einmalige native Freigabe');
    assertEqual(unload(f.guard).prevented, true, 'Späterer manueller Reload erbt keine Freigabe');
    f.expire();
    const next = await f.guard.prepare(); f.guard.commitNavigation(next, () => {}); f.expire();
    assertEqual(unload(f.guard).prevented, true, 'Ausbleibender Wechsel widerruft native Freigabe');
    const third = await f.guard.prepare(); f.guard.commitNavigation(third, () => {}); commit.set({ revision: 2 });
    assertEqual(unload(f.guard).prevented, true, 'Neuer Schutzgrund widerruft Freigabe sofort');
}
{
    const f = fixture(); let writes = 0;
    f.provider('result', { result: true });
    await f.guard.reload({ mutate: async () => { writes++; assert(f.guard.reasons().some(s => s.phase === 'commit'), 'Eigener Reloadwrite hält echten Lease'); return true; },
        flush: () => true, reload: () => { writes++; } });
    assertEqual(writes, 2, 'Reload mutiert und wechselt genau einmal nach bestätigtem Flush');
    assertEqual(unload(f.guard).prevented, false, 'Reload behält Freigabe bis zum nativen Ereignis');
}
for (const stage of ['ready', 'mutate', 'flush']) {
    const f = fixture(); let navigations = 0;
    const ok = await f.guard.reload({ [stage]: () => false, reload: () => navigations++ }).catch(() => false);
    assertEqual(ok, false, 'Reload-Zwischenstufe false beendet Versuch');
    assertEqual(navigations, 0, 'Keine Navigation nach Bereitschafts-, Mutations- oder Flushfehler');
}

{
    const f = fixture(), attempt = await f.guard.prepare(); let writes = 0;
    assertEqual(f.guard.commitNavigation(attempt, () => writes++), true, 'Aktueller Versuch erlaubt einen Wechsel');
    assertEqual(f.guard.commitNavigation(attempt, () => writes++), false, 'Derselbe Versuch erlaubt keinen zweiten Zielwrite');
    assertEqual(writes, 1, 'Native Freigabe ist auch auf Kernebene einmalig');
}
{
    const f = fixture(); let writes = 0; const hold = deferred();
    f.provider('old-result', { result: true });
    const task = f.guard.reload({ mutate: () => hold.promise, flush: () => true, reload: () => writes++ });
    await tick(); const foreign = f.provider('foreign-write', { phase: 'commit', revision: 1 });
    foreign.set({ phase: 'idle' }); hold.resolve(true);
    assertEqual(await task, false, 'Fremder auch kurzzeitiger Write im eigenen Reloadlease wird nicht quittiert');
    assertEqual(writes, 0, 'Besitzergebundener Reload übergeht keine fremde Mutation');
}

{
    const f = fixture(); let ended = false;
    const good = f.provider('good', { phase: 'running' }, async () => { await tick(); good.set({ phase: 'idle' }); ended = true; });
    f.provider('missing', { phase: 'running' });
    await f.guard.prepare().catch(() => false);
    assertEqual(ended, true, 'Auch fehlende Abbruchfunktion lässt alle angeforderten Enden abwarten');
    assertEqual(f.guard.isBusy(), false, 'Fehlende Abbruchfunktion hinterlässt keinen offenen Versuch');
}
{
    const f = fixture(); f.provider('result', { result: true });
    const old = await f.guard.prepare(); f.guard.end(old);
    const current = await f.guard.prepare(); f.guard.commitNavigation(current, () => {}); f.guard.end(old);
    assertEqual(unload(f.guard).prevented, false, 'Altes Ende widerruft keine neuere native Freigabe');
    f.expire();
    assertEqual(f.guard.isBusy(), false, 'Auch konsumierte Freigabe räumt bei ausgebliebenem Wechsel den Versuch auf');
}
{
    const gate = deferred(), controller = new AbortController();
    const f = fixture({ decide: () => gate.promise }); f.provider('form', { dirty: true });
    const old = f.guard.prepare({ signal: controller.signal }); await tick();
    controller.abort();
    assertEqual(f.guard.isBusy(), false, 'Cleanup widerruft sofort die eigene offene Reservierung');
    const next = await f.guard.prepare({ decide: () => true });
    gate.resolve(true);
    assertEqual(await old, null, 'Verspätete alte Dialogantwort liefert keinen gültigen Versuch');
    assertEqual(f.guard.validate(next), true, 'Alte Dialogantwort beendet keine neuere Reservierung');
    f.guard.end(next);
    assertEqual(await f.guard.prepare({ signal: controller.signal }), null, 'Widerrufene Bindung reserviert keinen Schutzversuch');
}

{
    const f = fixture(), hold = deferred(); let reloads = 0, flushing = false;
    const task = f.guard.reload({ mutate: () => true, flush: async () => { flushing = true; await hold.promise; return true; }, reload: () => reloads++ });
    await tick();
    assert(flushing, 'Reload erreicht den letzten offenen Flush');
    assert(f.guard.reasons().some(reason => reason.phase === 'commit'), 'Eigener Reloadlease bleibt bis zum letzten Flush bestehen');
    assertEqual(unload(f.guard).prevented, true, 'Nativer Reload bleibt während letztem Flush geschützt');
    assertEqual(await f.guard.prepare(), null, 'Reservierter Reload verhindert zweiten App-Wechsel');
    hold.resolve(); assertEqual(await task, true, 'Bestätigter letzter Flush gibt Reload frei');
    assertEqual(reloads, 1, 'Letzter Flush führt zu genau einem Reload');
}

{
    const f = fixture();
    const attempt = await f.guard.prepare(); f.guard.commitNavigation(attempt, () => {});
    f.guard.revokeNative();
    assertEqual(f.guard.isBusy(), false, 'Widerruf einer quittierten Navigation löst auch deren Reservierung');
    const next = await f.guard.prepare(); assert(next, 'BFCache-Rückkehr ohne Dokumentwechsel erlaubt neue Aktion'); f.guard.end(next);
}
{
    const f = fixture(), hold = deferred(); let notify, removed = false, reloads = 0;
    const task = f.guard.reload({ mutate: () => hold.promise, flush: () => true, reload: () => reloads++,
        subscribeChanges: listener => { notify = listener; return () => { removed = true; }; } });
    await tick(); notify(); hold.resolve(true);
    assertEqual(await task, false, 'Neue gewöhnliche Eingaben ohne Dirty-Provider verwerfen Reloadzustimmung');
    assertEqual(reloads, 0, 'Neue Eingabe startet keinen Reload');
    assert(removed, 'Reloadende entfernt Eingabebeobachtung');
}
