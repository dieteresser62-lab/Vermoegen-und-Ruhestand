import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { bindProfileNavigationHandoff, installProfilePersistenceHooks, registerProfileInputFlush, installProfileBfcacheRefresh } from '../app/profile/profile-navigation.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createSelectionDocument } from './designsystem-selection-dom.mjs';
import { bindManagerProfileControls, syncManagerProfileControls } from '../app/tranches/tranchen-manager-profiles.js';
import { UIBinder, initUIBinder } from '../app/balance/balance-binder.js';
import { navigateExpenses } from '../app/shared/expenses-navigation.js';
import { navigateWealthHistory } from '../app/shared/wealth-history-navigation.js';

const tick = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
function events(target) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => listeners.set(type, [...listeners.get(type) || [], fn]);
    target.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
    target.fire = (type, event = {}) => Promise.all((listeners.get(type) || []).map(fn => fn(event)));
    return target;
}
async function fixture(failure, { realFlush = false } = {}) {
    const stored = {};
    let failWrites = false;
    persistence.resetPersistenceForTests({ name: 'hs1b-memory', async loadAll() { return {}; }, async saveBatch({ upserts, deletes }) {
        if (failWrites) throw new Error('Synthetischer Adapterfehler');
        deletes.forEach(key => delete stored[key]);
        Object.assign(stored, Object.fromEntries(upserts));
    } });
    await persistence.init({ installLifecycleHooks: false, debounceMs: 60000 });
    const doc = events(createSelectionDocument());
    const win = events({ name: '', location: { href: 'http://localhost/Balance.html', reload() { win.reloads++; } }, reloads: 0 });
    doc.defaultView = win; doc.contains = node => node.isConnected;
    let closes = 0, exports = 0, saves = 0, prompts = 0, closeHandler;
    const replies = [];
    win.__TAURI__ = { event: { listen(name, fn) { closeHandler = fn; return () => {}; } },
        core: { async invoke(command, { response }) { replies.push(response); if (response === 'allow') closes++; return true; } } };
    const add = (id, tag = 'div') => { const el = doc.createElement(tag); el.id = id; doc.body.appendChild(el); return el; };
    for (const id of ['suiteNavigationStatus', 'navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) add(id);
    const dialog = doc.getElementById('navigationGuardDialog');
    dialog.showModal = () => { dialog.open = true; prompts++; };
    dialog.close = () => { dialog.open = false; dialog.dispatchEvent({ type: 'close' }); };
    for (const el of doc.body.querySelectorAll('*')) el.focus = () => { doc.activeElement = el; };
    const field = add('syntheticInput', 'input'); field.value = 'ungültig';
    const link = add('suiteLink', 'a'); link.setAttribute('href', 'Simulator.html'); link.setAttribute('data-profile-handoff', '');
    link.closest = () => link;
    let valid = failure === 'none';
    registerProfileInputFlush(doc, () => valid ? { ok: true, overviewPersistence: Promise.resolve(true) }
        : failure.startsWith('overview') ? { ok: true, overviewPersistence: failure === 'overview-value' ? false
            : failure === 'overview-reject' ? Promise.reject(new Error('Synthetischer Speicherfehler')) : Promise.resolve(false) }
            : ['saver-throws', 'saver-false', 'flush'].includes(failure) ? { ok: true }
                : { ok: false, error: new Error(failure === 'blocked' ? 'Die Eingabe ist gesperrt.' : 'Bitte einen gültigen Betrag eingeben.') });
    installProfilePersistenceHooks({ doc, win, saver() {
        saves++;
        if (!valid && failure === 'saver-throws') throw new Error('Personenstand konnte nicht gespeichert werden.');
        return valid || failure !== 'saver-false';
    }, flusher: () => valid || failure !== 'flush' });
    const guard = getPageNavigationGuard(doc, win);
    bindProfileNavigationHandoff({ root: doc, win, guard, ready: () => true, exporter() { exports++; return true; }, flusher: () => realFlush ? persistence.flush() : true });
    persistence.bindTauriClose(doc, win); await tick();
    return { doc, win, dialog, field, guard, replies, stored, failWrites() { failWrites = true; },
        get closes() { return closes; }, get exports() { return exports; }, get saves() { return saves; }, get prompts() { return prompts; },
        leave(exit, id = '1') { return exit === 'x' ? closeHandler({ payload: { attemptId: id } })
            : doc.fire('click', { target: link, button: 0, preventDefault() {} }); },
        answer(accept) { doc.getElementById(accept ? 'navigationGuardLeave' : 'navigationGuardStay').dispatchEvent({ type: 'click' }); },
        correct() { valid = true; field.value = '100'; return doc.fire('input', { target: field }); }
    };
}

try {
    // HS-1c: Native Schalter senden input vor change. Guard-Abonnenten dürfen
    // die Benutzerauswahl dazwischen nicht aus dem alten Wertträger zurücksetzen.
    {
        const f = await fixture('none');
        const field = f.doc.createElement('input'); field.id = 'profileGoldAktiv'; field.value = 'false'; f.doc.body.appendChild(field);
        const toggle = f.doc.createElement('input'); toggle.id = 'profileGoldAktivToggle'; toggle.type = 'checkbox'; f.doc.body.appendChild(toggle);
        let changes = 0; field.addEventListener('change', () => changes++);
        bindManagerProfileControls(f.doc);
        const unsubscribe = f.guard.subscribe(() => syncManagerProfileControls(f.doc));
        toggle.checked = true;
        toggle.dispatchEvent({ type: 'input' });
        await f.doc.fire('input', { target: toggle });
        toggle.dispatchEvent({ type: 'change' });
        await f.doc.fire('change', { target: toggle });
        assertEqual(field.value, 'true', 'HS-1c: input/Guard/change übernimmt die neue Goldauswahl');
        assertEqual(toggle.checked, true, 'HS-1c: sichtbarer Goldschalter bleibt eingeschaltet');
        assertEqual(changes, 1, 'HS-1c: genau ein kanonischer change startet den Save');
        unsubscribe();
    }
    for (const exit of ['x', 'suite']) for (const broken of [false, true]) {
        const f = await fixture('invalid', { realFlush: true });
        persistence.setItemSync('rs_hs1c_valid', 'synthetisch übernommen');
        if (broken) f.failWrites();
        const leaving = f.leave(exit); await tick();
        assertEqual(f.dialog.open, true, `HS-1c ${exit}: ungültige Eingabe fragt nach`);
        f.answer(true); await leaving;
        assertEqual(f.saves, 0, 'HS-1c: Trotzdem wiederholt den ungültigen Formularsave nicht');
        if (broken) {
            assertEqual(f.closes, 0, 'HS-1c: Adapterfehler schließt auch nach Trotzdem nicht');
            assertEqual(f.win.location.href, 'http://localhost/Balance.html', 'HS-1c: Adapterfehler verhindert den Seitenwechsel');
            assert(f.doc.getElementById('suiteNavigationStatus').textContent.length > 0, 'HS-1c: Adapterfehler bleibt sichtbar');
        } else {
            assertEqual(f.stored.rs_hs1c_valid, 'synthetisch übernommen', `HS-1c ${exit}: gesunder dirty Schlüssel erreicht vor dem Verlassen den Adapter`);
            assertEqual(f.closes, exit === 'x' ? 1 : 0, 'HS-1c: erfolgreicher Schlussflush erlaubt erstes X');
            assertEqual(f.win.location.href, exit === 'suite' ? 'Simulator.html' : 'http://localhost/Balance.html', 'HS-1c: erfolgreicher Schlussflush erlaubt ersten Link');
        }
    }
    const globals = { document: globalThis.document, window: globalThis.window };
    try {
        for (const target of ['expenses', 'wealth', 'overview']) for (const input of ['failed', 'pending', 'overview']) for (const accept of [false, true]) {
            const f = await fixture('invalid');
            globalThis.document = f.doc; globalThis.window = f.win;
            const state = { debounceTimer: input === 'failed' ? null : setTimeout(() => {}, 60000),
                unsavedInput: input === 'failed' ? 'Bitte einen gültigen Betrag eingeben.' : null };
            let updates = 0;
            initUIBinder({ controls: {} }, state, () => {
                updates++;
                return input === 'overview' ? { ok: true, overviewPersistence: Promise.resolve(false) }
                    : { ok: false, error: new Error('Bitte einen gültigen Betrag eingeben.') };
            }, () => {});
            let exports = 0, leaving;
            const options = { doc: f.doc, win: f.win, guard: f.guard, ready: async () => true,
                exporter: () => { exports++; return true; }, flush: () => persistence.flush() };
            if (target === 'expenses') {
                let hashchange;
                f.win.addEventListener = (type, fn) => { if (type === 'hashchange') hashchange = fn; };
                f.win.location.hash = '';
                await UIBinder.initializeExpensesNavigation({ doc: f.doc, win: f.win,
                    navigate: (request, supplied) => (leaving = navigateExpenses(request, { ...options, ...supplied })) });
                f.win.location.hash = '#ausgaben'; f.win.location.search = '?year=2025'; hashchange();
            } else if (target === 'wealth') {
                let hashchange;
                f.win.addEventListener = (type, fn) => { if (type === 'hashchange') hashchange = fn; };
                f.win.location.hash = '';
                await UIBinder.initializeWealthHistoryNavigation({ doc: f.doc, win: f.win,
                    navigate: supplied => (leaving = navigateWealthHistory({ ...options, ...supplied })) });
                f.win.location.hash = '#verlauf'; hashchange();
            } else {
                // Nach Bleiben besteht der Sicherungsgrund schon vor dem nächsten Hashziel.
                await f.guard.prepare({ decide: async () => false });
                leaving = UIBinder.openOverviewTarget({ hash: '#ausgaben', search: '?year=2025' }, { ready: true,
                    navigate: (request, supplied) => navigateExpenses(request, { ...options, ...supplied }) });
            }
            await tick();
            assertEqual(f.dialog.open, true, `HS-1c ${target}: Hashziel fragt statt still abzubrechen`);
            assert(f.doc.getElementById('navigationGuardDescription').textContent.includes(input === 'overview' ? 'Plananzeige' : 'gültigen Betrag'), 'HS-1c: Hashrückfrage nennt den Sicherungsgrund');
            f.answer(accept);
            assertEqual(await leaving, accept, `HS-1c ${target}: erste Entscheidung gilt`);
            assertEqual(f.win.location.href, accept ? target === 'wealth' ? 'depot-tranchen-manager.html#verlauf' : 'Ausgaben.html?year=2025#ausgaben' : 'http://localhost/Balance.html', 'HS-1c: Trotzdem wechselt, Bleiben erhält das Dokument');
            assertEqual(exports, 0, 'HS-1c: Hashwechsel wiederholt die fehlgeschlagene Profilsicherung nicht');
            assertEqual(updates, input === 'failed' ? 0 : 1, 'HS-1c: wartende Eingabe wird einmal vor der Entscheidung geprüft');
            assertEqual(state.debounceTimer, null, 'HS-1c: nach der Prüfung bleibt keine tote Timer-ID');
        }
    } finally { Object.assign(globalThis, globals); }
    for (const exit of ['x', 'suite']) for (const failure of ['invalid', 'blocked', 'overview', 'overview-value', 'overview-reject', 'saver-throws', 'saver-false', 'flush', 'none']) {
        const f = await fixture(failure);
        const leaving = f.leave(exit); await tick();
        if (failure !== 'none') {
            assertEqual(f.dialog.open, true, `${exit}/${failure}: erster Versuch zeigt die Rückfrage`);
            const text = f.doc.getElementById('navigationGuardDescription').textContent;
            assert(text.includes('nicht gespeichert') && text.includes('gehen verloren') && text.includes(exit === 'x' ? 'schließen?' : 'wechseln?'), `${exit}/${failure}: Grund und Verlustfrage sichtbar`);
            if (failure === 'invalid') assert(text.includes('gültigen Betrag'), 'Validierungsgrund bleibt sichtbar');
            f.answer(true);
        }
        await leaving;
        if (exit === 'suite') {
            let prevented = false;
            const saves = f.saves;
            await f.win.fire('beforeunload', { preventDefault() { prevented = true; } });
            assertEqual(prevented, false, 'Bestätigter Suite-Link fragt beim Entladen nicht erneut');
            assertEqual(f.saves, saves, 'Der bestätigte Wechsel wiederholt den fehlgeschlagenen Save auch beim Entladen nicht');
        }
        assertEqual(f.closes, exit === 'x' ? 1 : 0, `${exit}/${failure}: erstes X schließt nach Zustimmung`);
        assertEqual(f.win.location.href, exit === 'suite' ? 'Simulator.html' : 'http://localhost/Balance.html', `${exit}/${failure}: erster Suite-Link wechselt nach Zustimmung`);
        assertEqual(f.prompts, failure === 'none' ? 0 : 1, `${exit}/${failure}: genau eine Verlustentscheidung`);
        assertEqual(f.exports, exit === 'suite' && failure === 'none' ? 1 : 0, 'Bestätigter Verlust startet keinen erneuten fehlschlagenden Snapshot');
    }
    for (const exit of ['x', 'suite']) {
        const f = await fixture('invalid');
        const leaving = f.leave(exit); await tick(); f.answer(false); await leaving;
        assertEqual(f.field.value, 'ungültig', 'Bleiben erhält die Eingabe');
        assertEqual(f.closes + f.exports, 0, 'Bleiben schließt und exportiert nicht');
        assertEqual(f.win.location.href, 'http://localhost/Balance.html', 'Bleiben erhält das Dokument');
        await f.correct();
        await f.leave(exit, '2');
        assertEqual(f.prompts, 1, 'Korrigierte gespeicherte Eingabe braucht keine weitere Rückfrage');
    }
    {
        const f = await fixture('none');
        installProfileBfcacheRefresh({ doc: f.doc, win: f.win, guard: f.guard, ready: () => false });
        await f.win.fire('pageshow', { persisted: true });
        const notice = f.doc.getElementById('documentReloadNotice');
        assert(notice && !notice.hidden, 'Gesperrtes Dokument zeigt einen dauerhaften Hinweis');
        assert(notice.textContent.includes('veraltet'), 'Hinweis erklärt die Dokumentsperre');
        const button = notice?.children.find(el => el.tagName === 'BUTTON');
        assertEqual(button?.textContent, 'Jetzt neu laden', 'Sperrhinweis enthält den vorhandenen Reloadknopf');
        const attempt = await f.guard.prepare();
        f.guard.restoreDocument(); f.guard.validate(attempt); f.guard.end(attempt);
        assertEqual(f.doc.getElementById('documentReloadNotice'), notice, 'Spätere Guardstatusmeldung ersetzt den Sperrhinweis nicht');
        button?.dispatchEvent({ type: 'click' });
        assertEqual(f.win.reloads, 1, 'Knopf ruft den echten location.reload-Weg auf');
    }
} finally { persistence.resetPersistenceForTests(); }
