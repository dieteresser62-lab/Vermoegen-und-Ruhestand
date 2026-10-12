import fs from 'node:fs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createAnnualNavigationLifecycle } from '../app/balance/balance-annual-orchestrator.js';
import { initializeProfilePage } from '../app/profile/profile-navigation.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const realFlush = PersistenceFacade.flush;
const originalError = console.error;

// Kontrolliertes Tauri-Doppel; Rustzustandstests prüfen die native Implementierung.
function nativeDouble() {
    let clock = 0, sequence = 0, active = null, closes = 0;
    const steps = [], timers = new Map();
    return {
        steps, get closes() { return closes; }, get active() { return active; },
        failClose: false,
        pageLoadStarted() { if (active?.phase !== 'closing') active = null; },
        start() {
            if (active) return active.id;
            const id = String(++sequence);
            active = { id, phase: 'waiting', deadline: clock + 3000 };
            timers.set(id, active.deadline);
            return id;
        },
        advance(ms) {
            clock += ms;
            for (const [id, deadline] of timers) {
                if (clock < deadline) continue;
                timers.delete(id);
                if (active?.id === id && active.phase === 'waiting') { active.phase = 'closing'; closes++; }
            }
        },
        reply(id, response) {
            steps.push(`${id}:${response}`);
            if (active?.id !== id) return false;
            if (response === 'hold' && active.phase === 'waiting' && clock < active.deadline) { active.phase = 'held'; return true; }
            if (response === 'reject' && active.phase === 'held') { active = null; return true; }
            if (response === 'allow' && active.phase === 'held') {
                active.phase = 'closing';
                if (this.failClose) { active = null; throw new Error('SYNTHETIC_CLOSE_ERROR'); }
                closes++; return true;
            }
            return false;
        }
    };
}
function target() {
    const listeners = new Map();
    return { listeners,
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
        removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
        fire(type, event = {}) { return Promise.all([...listeners.get(type) || []].map(handler => handler(event))); }
    };
}
async function fixture({ handbook = false, delayedInstall = false, holdAck, holdArrival, rejectAck, rejectFailures = 0, rejectAfterDelivery = false, saveGate, bind = true, nativeState } = {}) {
    PersistenceFacade.resetPersistenceForTests();
    PersistenceFacade.flush = realFlush;
    const native = nativeState || nativeDouble(), elements = new Map(), doc = target(), win = target(), batches = [], store = {};
    let handler, listens = 0, unlistens = 0, prompts = 0, events = 0, timerSequence = 0;
    const retries = new Map();
    const install = deferred();
    Object.assign(doc, { documentElement: { dataset: { suitePage: handbook ? 'handbook' : 'balance' } },
        contains: () => false, visibilityState: 'visible', getElementById: id => elements.get(id), defaultView: win });
    for (const id of ['suiteNavigationStatus', 'navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        const element = target();
        Object.assign(element, { id, hidden: true, textContent: '', open: false, isConnected: true,
            focus() { doc.activeElement = this; }, showModal() { this.open = true; prompts++; },
            close() { this.open = false; this.fire('close'); } });
        elements.set(id, element);
    }
    win.setTimeout = fn => { const id = ++timerSequence; retries.set(id, fn); return id; };
    win.clearTimeout = id => retries.delete(id);
    win.__TAURI__ = {
        core: { async invoke(command, payload) {
            assertEqual(command, 'confirm_app_close', 'Alle Antworten nutzen denselben bestehenden Command');
            assertEqual(typeof payload.attemptId, 'string', 'Kennung bleibt eine verlustfreie Dezimalzeichenkette');
            if (payload.response === 'hold' && holdArrival) await holdArrival.promise;
            if (payload.response === 'reject' && rejectFailures-- > 0) {
                if (rejectAfterDelivery) native.reply(payload.attemptId, payload.response);
                throw new Error('SYNTHETIC_REJECT_IPC_ERROR');
            }
            const accepted = native.reply(payload.attemptId, payload.response);
            if (payload.response === 'hold' && holdAck) await holdAck.promise;
            if (payload.response === 'reject' && rejectAck) await rejectAck.promise;
            return accepted;
        } },
        event: { async listen(name, fn) {
            assertEqual(name, 'ruhestand://close-requested', 'Bestehender Eventname bleibt erhalten');
            listens++; handler = fn;
            if (delayedInstall) await install.promise;
            return () => { unlistens++; };
        } }
    };
    const adapter = { name: 'close-test', async open() {}, async loadAll() { return { ...store }; },
        async saveBatch(batch) {
            native.steps.push('flush'); batches.push(batch);
            if (saveGate) await saveGate.promise;
            for (const [key, value] of batch.upserts) store[key] = value;
            for (const key of batch.deletes) delete store[key];
        } };
    PersistenceFacade.resetPersistenceForTests(adapter);
    if (handbook) await initializeProfilePage({ doc, win });
    else {
        await PersistenceFacade.init({ adapter, installLifecycleHooks: false });
        if (bind) PersistenceFacade.bindTauriClose(doc, win);
    }
    await tick();
    const guard = getPageNavigationGuard(doc, win);
    return { native, doc, win, guard, elements, install, batches, store,
        get prompts() { return prompts; }, get listens() { return listens; }, get unlistens() { return unlistens; },
        get events() { return events; }, get retries() { return retries.size; },
        async retry() {
            const callbacks = [...retries.values()]; retries.clear();
            for (const callback of callbacks) callback();
            await tick();
        },
        receive(id) { return handler({ payload: { attemptId: id } }); },
        request() {
            if (native.active) return { id: native.active.id, done: Promise.resolve() };
            const id = native.start(); events++;
            return { id, done: handler({ payload: { attemptId: id } }) };
        },
        button(id) { return elements.get(id).fire('click'); },
        provider(owner, initial, cancel) {
            let state = initial;
            const registration = guard.register(owner, { read: () => state, cancel });
            return { set(change) { state = { ...state, ...change }; registration.notify(); }, registration };
        }
    };
}
try {
    console.error = () => {}; // Nur erwartete, synthetische Fehler dieses Einzeltests.
    {
        const f = await fixture();
        const id = f.native.start();
        f.native.advance(2999);
        assertEqual(f.native.closes, 0, 'Nicht übernommener Versuch schließt vor der Frist nicht');
        f.native.advance(1); f.native.advance(9000);
        assertEqual(f.native.closes, 1, 'Nicht übernommener Versuch schließt nach drei Sekunden genau einmal');
        await f.receive(id);
        assertEqual(f.prompts, 0, 'Verspätete Übernahme startet keine Nachfrage');
        assertEqual(f.batches.length, 0, 'Verspätete Übernahme startet keinen Flush');
        assertEqual(f.native.steps.join(','), '1:hold', 'Verspätete Übernahme sendet keine finale Antwort');
    }
    for (const order of ['hold-first', 'timeout-first']) {
        const gate = deferred();
        const f = await fixture(order === 'hold-first' ? { holdAck: gate } : { holdArrival: gate });
        f.provider('form', { dirty: true });
        const request = f.request(); await tick();
        f.native.advance(4000);
        assertEqual(f.native.closes, order === 'hold-first' ? 0 : 1, 'Beide Übernahme-/Timeoutreihenfolgen respektieren die atomare Reservierung');
        assertEqual(f.prompts, 0, 'Ausstehende Übernahmebestätigung startet keinen Dialog');
        gate.resolve(); await tick();
        if (order === 'hold-first') {
            assertEqual(f.prompts, 1, 'Bestätigte Übernahme startet genau eine Nachfrage');
            await f.button('navigationGuardStay');
        }
        await request.done;
        assertEqual(f.batches.length, 0, 'Keine Speicherung nach Bleiben oder abgelehnter Übernahme');
    }
    {
        const f = await fixture(), gate = deferred();
        const lifecycle = createAnnualNavigationLifecycle({ guard: f.guard, flush: () => true });
        const job = lifecycle.run({}, async operation => { operation.commit('annual_close'); await gate.promise; return { ok: true }; });
        assertEqual(lifecycle.read().phase, 'commit', 'Echter Jahreslifecycle hält den tatsächlichen Schreibabschnitt');
        const request = f.request(); await request.done;
        f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Jahrescommit schließt auch nach mehr als drei Sekunden nicht');
        assertEqual(f.prompts, 0, 'Jahrescommit erzeugt keinen Verlustdialog');
        assertEqual(f.elements.get('suiteNavigationStatus').textContent, 'Jahresabschluss schreibt – bitte warten', 'Jahreshinweis steht am ortsfesten Fehlerhost');
        assertEqual(f.native.steps.join(','), '1:hold,1:reject', 'Jahrescommit sendet Übernahme und Ablehnung, keine Freigabe');
        gate.resolve(); await job;
        assertEqual(f.native.closes, 0, 'Sperrende schließt niemals automatisch');
        const next = f.request(); await next.done;
        assertEqual(f.native.closes, 1, 'Neue Kennung nach Jahrescommit darf normal schließen');
    }
    {
        const f = await fixture(); f.provider('result', { result: true });
        const request = f.request(); await tick();
        await f.receive(request.id); f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Offene Nachfrage bleibt über der Fallbackfrist offen');
        assertEqual(f.prompts, 1, 'Doppelte aktive Events erzeugen höchstens eine Nachfrage');
        assertEqual(f.batches.length, 0, 'Offene Nachfrage startet keinen Flush');
        await f.button('navigationGuardStay'); await request.done;
        f.native.advance(9000);
        assertEqual(f.native.closes, 0, 'Bleiben wird durch keinen alten Timer überholt');
        await f.receive(request.id);
        assertEqual(f.prompts, 1, 'Alte wiederholte Kennung startet keinen neuen Dialog');
        const next = f.request(); await tick();
        await f.button('navigationGuardLeave'); await next.done;
        assertEqual(f.native.closes, 1, 'Neue Kennung nach Bleiben schließt genau einmal');
        await f.receive(next.id);
        assertEqual(f.native.steps.filter(step => step.endsWith(':allow')).length, 1, 'Finale Freigabe ist einmalig');
    }
    for (const reason of ['Seitenwechsel', 'Reload', 'Rendererneustart']) {
        const f = await fixture(); f.provider('form', { dirty: true });
        const old = f.request(); await tick();
        assertEqual(f.native.active.phase, 'held', `${reason}: alte Nachfrage ist übernommen`);
        f.native.advance(100_000);
        assertEqual(f.native.closes, 0, `${reason}: lebende Nachfrage hat keinen Timeoutclose`);
        f.native.pageLoadStarted(); // Native Wiederherstellung ohne Antwort des alten Dokuments.
        assertEqual(f.native.active, null, `${reason}: Seitenladebeginn beseitigt die verwaiste Reservierung`);
        assertEqual(f.native.steps.join(','), `${old.id}:hold`, `${reason}: Wiederherstellung braucht keine alte JS-Antwort`);
        const nextDoc = await fixture({ nativeState: f.native });
        await old.done;
        const next = nextDoc.request(); await next.done;
        assert(BigInt(next.id) > BigInt(old.id), `${reason}: neues Dokument erhält eine neue Kennung`);
        assertEqual(nextDoc.events, 1, `${reason}: neuer nativer Schließversuch erzeugt genau ein Event`);
        assertEqual(f.native.reply(old.id, 'allow'), false, `${reason}: alte Freigabe ist wirkungslos`);
        assertEqual(f.native.reply(old.id, 'reject'), false, `${reason}: alte Ablehnung ist wirkungslos`);
        f.native.advance(9000); await nextDoc.receive(next.id);
        assertEqual(f.native.closes, 1, `${reason}: neues Dokument schließt genau einmal`);
        assertEqual(f.native.steps.filter(step => step === `${next.id}:allow`).length, 1, `${reason}: neue Freigabe ist einmalig`);
    }
    {
        const f = await fixture(); f.provider('form', { dirty: true });
        const old = f.request(); await tick();
        await f.win.fire('beforeunload', { preventDefault() {} });
        assertEqual(f.elements.get('navigationGuardDialog').open, true, 'Abgelehnter nativer Verlassenshinweis räumt keine Nachfrage auf');
        assertEqual(f.native.active.phase, 'held', 'Vor tatsächlichem Dokumentwechsel bleibt die Übernahme erhalten');
        await f.win.fire('pagehide'); await old.done;
        assertEqual(f.elements.get('navigationGuardDialog').open, false, 'Pagehide beendet die alte Nachfrage');
        assertEqual(f.guard.isBusy(), false, 'Pagehide gibt die alte Schutzreservierung frei');
        assertEqual(f.native.active, null, 'Pagehide lehnt den gehaltenen Versuch ab');
        assertEqual(f.native.closes, 0, 'Pagehide selbst bestätigt keinen Fensterschluss');
        await f.win.fire('pageshow', { persisted: true });
        const next = f.request(); await tick();
        assertEqual(f.events, 2, 'Auch nach BFCache-Rückkehr erzeugt der nächste Versuch ein neues Event');
        await f.button('navigationGuardLeave'); await next.done;
        assertEqual(f.native.closes, 1, 'Nach Pagehide kann dieselbe Bindung genau einmal schließen');
    }
    for (const rejectAfterDelivery of [false, true]) {
        const f = await fixture({ rejectFailures: 2, rejectAfterDelivery });
        f.provider('form', { dirty: true });
        const old = f.request(); await tick();
        await f.button('navigationGuardStay'); await old.done;
        assertEqual(f.retries, 1, 'Geworfene reject-IPC plant genau eine Wiederholung');
        f.native.advance(9000);
        assertEqual(f.native.closes, 0, 'Verlorene Ablehnung führt nie zu einem Timeoutclose');
        assertEqual(f.guard.isBusy(), false, 'Verlorene Ablehnung hält die JS-Schutzreservierung nicht');
        if (!rejectAfterDelivery) {
            assertEqual(f.native.active.phase, 'held', 'Nicht zugestellte Ablehnung lässt den nativen Versuch zunächst gehalten');
            await f.retry();
            assertEqual(f.retries, 1, 'Wiederholter IPC-Fehler behält genau eine Wiederholung');
            await f.retry();
            assertEqual(f.native.active, null, 'Erfolgreiche Wiederholung gibt den verwaisten Versuch frei');
        }
        const next = f.request(); await tick();
        assert(BigInt(next.id) > BigInt(old.id), 'Nach verlorener Ablehnung beginnt eine neue Kennung');
        assertEqual(f.events, 2, 'Nach verlorener Ablehnung erzeugt der nächste Versuch ein neues Event');
        if (rejectAfterDelivery) { await f.retry(); await f.retry(); }
        assertEqual(f.retries, 0, 'Bestätigte oder bereits ungültige Ablehnung beendet Wiederholungen');
        assertEqual(f.native.active.id, next.id, 'Alte Wiederholung verändert keine neue Reservierung');
        assertEqual(f.native.active.phase, 'held', 'Neue Nachfrage bleibt trotz alter Wiederholungen gehalten');
        await f.button('navigationGuardLeave'); await next.done;
        assertEqual(f.native.closes, 1, 'Nach geworfener reject-IPC schließt neue Zustimmung genau einmal');
        assertEqual(f.native.steps.filter(step => step === `${next.id}:allow`).length, 1, 'Nach IPC-Fehler gibt es genau eine neue Freigabe');
    }
    {
        const f = await fixture({ rejectFailures: 10 }); f.provider('form', { dirty: true });
        const old = f.request(); await tick();
        await f.button('navigationGuardStay'); await old.done;
        PersistenceFacade.unbindLifecycleFlush();
        assertEqual(f.retries, 0, 'Unbind entfernt ausstehende Ablehnungswiederholungen');
        assertEqual(f.win.listeners.get('pagehide').size, 0, 'Unbind entfernt den eigenen Pagehide-Schließhook');
        f.native.pageLoadStarted();
        const nextDoc = await fixture({ nativeState: f.native });
        const next = nextDoc.request(); await next.done;
        assertEqual(nextDoc.events, 1, 'Native Wiederherstellung nach dauerhaftem IPC-Ausfall erzeugt ein neues Event');
        assertEqual(f.native.closes, 1, 'Neues Dokument kann nach dauerhaftem IPC-Ausfall genau einmal schließen');
    }
    for (const failure of ['false', 'throw']) {
        const f = await fixture();
        PersistenceFacade.flush = async () => { if (failure === 'throw') throw new Error('SYNTHETIC_FLUSH_ERROR'); return false; };
        const old = f.request(); await old.done; f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Flush-false und Flushausnahme schließen nicht');
        assertEqual(f.elements.get('suiteNavigationStatus').hidden, false, 'Flushfehler wird ortsfest angezeigt');
        assert(f.elements.get('suiteNavigationStatus').textContent.includes('Schließen abgebrochen'), 'Fehler erklärt den abgebrochenen Close');
        PersistenceFacade.flush = realFlush;
        const next = f.request(); await next.done;
        assertEqual(f.native.reply(old.id, 'allow'), false, 'Alte finale Antwort beeinflusst keinen neuen Versuch');
        assertEqual(f.native.reply(old.id, 'reject'), false, 'Alte Ablehnung beeinflusst keinen neuen Versuch');
        assertEqual(f.native.closes, 1, 'Neue Kennung nach Flushfehler schließt normal');
    }
    {
        const ack = deferred(), f = await fixture({ rejectAck: ack });
        f.provider('form', { dirty: true });
        const old = f.request(); await tick();
        await f.button('navigationGuardStay'); await tick();
        assertEqual(f.native.active, null, 'Rust beendet den alten Versuch vor dessen verzögerter IPC-Antwort');
        const next = f.request(); await tick();
        assertEqual(f.prompts, 2, 'Neue Kennung wird trotz ausstehender alter Ablehnungsantwort übernommen');
        assertEqual(f.native.active.phase, 'held', 'Neuer Versuch wartet nicht unübernommen auf eine alte Antwort');
        f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Alter Timer und neue Fallbackfrist schließen die neue Nachfrage nicht');
        ack.resolve(); await old.done;
        assertEqual(f.guard.isBusy(), true, 'Alte Ablehnungsantwort beendet nicht die neue Schutzreservierung');
        assertEqual(f.native.reply(old.id, 'allow'), false, 'Alte Freigabe erreicht den neuen gehaltenen Versuch nicht');
        assertEqual(f.native.reply(old.id, 'reject'), false, 'Alte Ablehnung erreicht den neuen gehaltenen Versuch nicht');
        await f.button('navigationGuardLeave'); await next.done;
        assertEqual(f.native.closes, 1, 'Neue Zustimmung schließt nach verzögerter alter Antwort genau einmal');
    }
    for (const newReason of [false, true]) {
        const saveGate = deferred(), f = await fixture({ saveGate });
        PersistenceFacade.setItemSync('synthetic_backend_close', 'bestätigt');
        const request = f.request(); await tick();
        assertEqual(f.batches.length, 1, 'Echter Facadeflush erreicht die gehaltene Backendbarriere');
        assertEqual(f.store.synthetic_backend_close, undefined, 'Backendbestand ist vor Writeende noch unbestätigt');
        f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Tatsächlich laufender Backendwrite bleibt länger als drei Sekunden offen');
        if (newReason) f.provider('backend-new-write', { phase: 'commit' });
        saveGate.resolve(); await request.done;
        assertEqual(f.store.synthetic_backend_close, 'bestätigt', 'Backendwrite ist vor Schlussprüfung bestätigt');
        assertEqual(f.native.closes, newReason ? 0 : 1, 'Schlussprüfung nach echtem Backendwrite schützt neue Providergründe');
        assertEqual(f.native.steps.filter(step => step === '1:allow').length, newReason ? 0 : 1, 'Echter Backendflush führt höchstens zu einer finalen Freigabe');
    }
    for (const newReason of [false, true]) {
        const f = await fixture(), gate = deferred();
        const provider = f.provider('job', { phase: 'running', operationId: 'g1', revision: 1 }, async () => {
            f.native.steps.push('cancel-start'); await gate.promise;
            provider.set({ phase: 'idle', operationId: null }); f.native.steps.push('cancel-end'); return true;
        });
        PersistenceFacade.setItemSync('synthetic_close', '1');
        const request = f.request(); await tick();
        await f.button('navigationGuardLeave'); await tick();
        f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Nicht bestätigtes Abbruchende bleibt trotz Fallbackfrist offen');
        assertEqual(f.batches.length, 0, 'Vor Abbruchende kein Flush');
        gate.resolve();
        const flushGate = deferred();
        PersistenceFacade.flush = async () => { await flushGate.promise; return realFlush(); };
        await tick(); f.native.advance(4000);
        assertEqual(f.native.closes, 0, 'Gehaltener Flush bleibt länger als drei Sekunden offen');
        if (newReason) f.provider('new-write', { phase: 'commit' });
        flushGate.resolve(); await request.done;
        assertEqual(f.native.closes, newReason ? 0 : 1, 'Neue Providergründe nach Entscheidung verhindern finale Freigabe');
        const steps = f.native.steps;
        assert(steps.indexOf('cancel-end') < steps.indexOf('flush'), 'Bestätigtes Abbruchende liegt vor Flush');
        if (!newReason) assert(steps.indexOf('flush') < steps.indexOf('1:allow'), 'Bestätigter Flush liegt vor finaler Freigabe');
    }
    {
        const gate = deferred(), f = await fixture({ holdAck: gate });
        f.request(); await tick(); f.native.advance(100_000);
        assertEqual(f.native.closes, 0, 'Nach tatsächlicher Übernahme bleibt später ausgefallenes JS unbegrenzt offen');
        PersistenceFacade.unbindLifecycleFlush();
        gate.resolve(); await tick();
        assertEqual(f.prompts, 0, 'Aufgeräumte ausstehende Übernahme startet keinen Dialog');
        assertEqual(f.native.active, null, 'Verspätete bestätigte Übernahme wird beim Cleanup abgelehnt');
    }
    {
        const f = await fixture(); f.native.failClose = true;
        const failed = f.request(); await failed.done;
        assertEqual(f.native.closes, 0, 'Rust-Closefehler meldet keinen erfolgreichen Close');
        assertEqual(f.guard.isBusy(), false, 'Rust-Closefehler gibt die JS-Reservierung frei');
        f.native.failClose = false;
        const next = f.request(); await next.done;
        assertEqual(f.native.closes, 1, 'Neue Kennung nach Rust-Closefehler kann schließen');
    }
    {
        const f = await fixture({ handbook: true });
        assertEqual(PersistenceFacade.keysSync().length, 0, 'Handbuch legt keinen Profilbestand an');
        assertEqual(f.win.__rsProfilePersistenceHooksInstalled, undefined, 'Handbuch bindet keine Profilspeicherhooks');
        assertEqual(f.doc.listeners.has('visibilitychange'), false, 'Handbuch bindet keinen Hidden-Flush');
        await f.win.fire('pagehide');
        assertEqual(f.batches.length, 0, 'Handbuch-Pagehide-Schließcleanup startet keinen Speicherflush');
        const request = f.request(); await request.done;
        assertEqual(f.native.closes, 1, 'Handbuch verwendet denselben EXE-Schließhandler');
        assertEqual(f.batches.length, 0, 'Sauberes Handbuch schließt ohne Profilmutation');
    }
    {
        const f = await fixture({ delayedInstall: true });
        PersistenceFacade.bindTauriClose(f.doc, f.win);
        assertEqual(f.listens, 1, 'Ausstehende Listenerinstallation bleibt singleflight');
        PersistenceFacade.unbindLifecycleFlush(); f.install.resolve(); await tick();
        assertEqual(f.unlistens, 1, 'Cleanup entfernt auch erst später installierte Listener');
        const id = f.native.start(); await f.receive(id);
        assertEqual(f.native.steps.length, 0, 'Alte Listener übernehmen nach Cleanup keinen Versuch');
        f.native.advance(3000);
        assertEqual(f.native.closes, 1, 'Fehlender Listener behält den unübernommenen Fallback');
    }
    {
        const f = await fixture(); f.provider('form', { dirty: true });
        const request = f.request(); await tick();
        PersistenceFacade.unbindLifecycleFlush(); await request.done;
        assertEqual(f.elements.get('navigationGuardDialog').open, false, 'Unbind beendet eine eigene offene Nachfrage');
        assertEqual(f.guard.isBusy(), false, 'Unbind räumt die eigene Schutzreservierung auf');
        assertEqual(f.native.closes, 0, 'Cleanup bestätigt keinen Close');
        assertEqual(f.unlistens, 1, 'Installierter EXE-Listener wird genau einmal entfernt');
    }
    {
        const f = await fixture(), gate = deferred();
        PersistenceFacade.flush = () => gate.promise;
        const old = f.request(); await tick();
        PersistenceFacade.unbindLifecycleFlush(); await tick();
        assertEqual(f.native.active, null, 'Unbind lehnt übernommenen Versuch sofort trotz ausstehendem Flush ab');
        PersistenceFacade.bindTauriClose(f.doc, f.win); await tick();
        PersistenceFacade.flush = realFlush;
        const next = f.request(); await next.done;
        gate.resolve(true); await old.done;
        assertEqual(f.native.closes, 1, 'Alte Flushantwort beeinflusst nach Neubindung keinen neueren Close');
        assertEqual(f.native.steps.filter(step => step === `${old.id}:allow`).length, 0, 'Alte Bindung sendet keine finale Freigabe');
    }
    const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    const commands = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(name => name.trim()).filter(Boolean);
    assertEqual(commands.join(','), 'load_app_state,save_app_state,quarantine_app_state,get_app_data_directory,open_app_data_directory,confirm_app_close', 'Commandinventar enthält exakt die Persistenz-, Ordner- und Close-Kommandos');
    assert(rust.includes('protocol: Mutex<CloseProtocol>'), 'Native Phase und Freigabe stehen unter einem gemeinsamen Lock');
    for (const name of ['close_unclaimed_timeout_is_once_and_not_early', 'close_hold_and_timeout_both_lock_orders',
        'close_hold_timeout_race_has_exactly_one_winner', 'close_reject_and_old_responses_cannot_release_next_attempt',
        'close_page_load_recovers_held_attempt_without_renderer_reply', 'close_page_load_keeps_already_reserved_close_permission',
        'close_failure_discards_only_its_own_permission']) {
        assert(rust.includes(`fn ${name}(`), 'Native Rustzustandstests für Frist, Rennen, Kennungen und Fehler sind vorhanden');
    }
    assert(/\.on_page_load\([\s\S]*?matches!\(payload\.event\(\), tauri::webview::PageLoadEvent::Started\)[\s\S]*?\.page_load_started\(\)/.test(rust), 'Native Wiederherstellung ist an tatsächlichen Seitenladebeginn angeschlossen');
} finally {
    PersistenceFacade.flush = realFlush;
    PersistenceFacade.resetPersistenceForTests();
    console.error = originalError;
}
