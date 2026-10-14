import { createTranchenPageDom, createLocalStorageMock, installGlobals, waitFor } from './tranchen-manager-page.test.mjs';
import { initTranchenManagerPage, switchManagerProfile } from '../app/tranches/tranchen-manager-page.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const globals = Object.fromEntries(['document', 'window', 'localStorage', 'confirm', 'alert', 'URL', 'Blob'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const oldDate = getAppTestDate();
async function fixture({ tauri = false } = {}) {
    const doc = createTranchenPageDom();
    const cash = doc.getElementById('profileTagesgeld');
    cash.type = 'text'; cash.setAttribute('inputmode', 'decimal');
    installGlobals(doc, createLocalStorageMock());
    globalThis.URL = globals.URL.value;
    const win = window;
    const data = { depot_tranchen: '[]', profile_tagesgeld: '8000', profile_cash_history_v1:
        JSON.stringify({ version: 1, baselineValue: 9000, entries: [{ date: '2026-05-09', value: 8000 }] }) };
    const registry = { version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Max Mustermann' }, data: { ...data } },
        b: { meta: { id: 'b', name: 'Erika Mustermann' }, data: { depot_tranchen: '[]', profile_tagesgeld: '500' } }
    } };
    const backend = new Map(Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' }));
    let closeHandler, failSave = false;
    const writes = [];
    const closeReplies = [];
    if (tauri) win.__TAURI__ = {
        event: { async listen(name, handler) { closeHandler = handler; return () => {}; } },
        core: { async invoke(command, args) {
            closeReplies.push(args.response);
            if (args.response === 'allow') assertEqual(backend.get('profile_tagesgeld'), '12345', 'EXE schließt erst nach dauerhaftem Speichern des offenen Tagesgelds');
            return true;
        } }
    };
    P.resetPersistenceForTests({ name: 'Tagesgeld-Eingabetest', async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch({ deletes, upserts }) {
            if (failSave) { failSave = false; throw new Error('Synthetischer Speicherfehler'); }
            writes.push({ deletes, upserts });
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, raw]) => backend.set(key, raw));
        } });
    await P.init({ doc, window: win, installLifecycleHooks: false, installTauriCloseHook: tauri });
    setAppTestDate('2026-05-10');
    await initTranchenManagerPage({ profileId: 'a' });
    const guard = getPageNavigationGuard(doc, win);
    const type = value => { cash.value = value; cash.dispatchEvent({ type: 'input', target: cash }); };
    const saved = value => waitFor(() => backend.get('profile_tagesgeld') === value && !cash.disabled, 'Tagesgeldwrite wird dauerhaft bestätigt');
    return { doc, win, backend, cash, guard, type, saved, writes, failNextSave: () => { failSave = true; },
        close: () => closeHandler({ payload: { attemptId: '1' } }), closeReplies,
        history: () => JSON.parse(backend.get('profile_cash_history_v1')) };
}

try {
    {
        const f = await fixture();
        const focus = () => { f.cash.focus(); f.doc.listeners.focusin.forEach(fn => fn({ target: f.cash })); };
        const leave = () => {
            f.doc.activeElement = f.doc.body;
            f.cash.dispatchEvent({ type: 'change', target: f.cash });
            f.doc.listeners.focusout.forEach(fn => fn({ target: f.cash }));
        };
        const before = JSON.stringify([...f.backend]), count = f.writes.length;
        assertEqual(f.cash.value, '8.000', 'Gespeichertes Tagesgeld erscheint mit Tausenderpunkt');
        for (let i = 0; i < 3; i++) { focus(); leave(); }
        assertEqual(f.cash.value, '8.000', 'Reine Fokusfolge erhält die formatierte Anzeige');
        const attempt = await f.guard.prepare();
        if (attempt) f.guard.end(attempt);
        assertEqual(f.writes.length, count, 'Formatierung und unverändertes change erzeugen keinen Backendwrite');
        assertEqual(JSON.stringify([...f.backend]), before, 'Formatierung erhält sämtliche gespeicherten Bytes und Verlaufseinträge');
        focus(); f.type('98000,25'); leave();
        await f.saved('98000.25');
        assertEqual(f.cash.value, '98.000,25', 'Verlassen speichert und zeigt Tausenderpunkt mit Cent');
        assertEqual(f.writes.length, count + 1, 'Geänderter Tagesgeldwert erzeugt genau einen Backendwrite');
        assertEqual(f.history().entries.length, 2, 'Geänderter Tagesgeldwert fügt genau den heutigen Stand hinzu');
        assertEqual(typeof f.history().entries.at(-1).value, 'number', 'Verlauf speichert weiterhin Zahlen');
        for (let i = 0; i < 3; i++) { focus(); leave(); }
        assertEqual(f.writes.length, count + 1, 'Erneutes Formatieren erzeugt keinen weiteren Write');
        focus(); f.type('99000,5'); leave(); await f.saved('99000.5');
        assertEqual(f.history().entries.length, 2, 'Zweite Änderung ersetzt den Eintrag desselben Tages');
        assertEqual(f.history().entries.at(-1).value, 99000.5, 'Tagesverlauf enthält den letzten Zahlenwert');
        focus(); f.type('8000'); leave(); await f.saved('8000');
        assertEqual(f.history().entries.length, 1, 'Rückkehr zum Vortagesstand entfernt den heutigen Eintrag');
    }
    {
        const f = await fixture();
        const oldHistory = f.backend.get('profile_cash_history_v1');
        for (let length = 1; length <= 5; length++) {
            f.type('12345'.slice(0, length));
            await new Promise(resolve => setTimeout(resolve, 450));
            assertEqual(f.backend.get('profile_tagesgeld'), '8000', 'Langsames Tippen speichert keinen Zwischenstand');
            assertEqual(f.backend.get('profile_cash_history_v1'), oldHistory, 'Langsames Tippen schreibt keinen Verlauf');
        }
        f.cash.dispatchEvent({ type: 'change', target: f.cash });
        await f.saved('12345');
        assertEqual(JSON.stringify(f.history().entries), '[{"date":"2026-05-09","value":8000},{"date":"2026-05-10","value":12345}]',
            'Langsame Eingabe von 12345 ergibt genau einen Eintrag am Testdatum');
        f.type('13579');
        f.cash.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
        await f.saved('13579');
        assertEqual(f.history().entries.at(-1).value, 13579, 'Enter bestätigt den letzten Tagesgeldstand');
        assertEqual(f.history().entries.length, 2, 'Enter ersetzt denselben Tageseintrag');
    }
    {
        const f = await fixture();
        f.type('12');
        const rent = f.doc.getElementById('profileRenteMonatlich');
        rent.value = '1400'; rent.dispatchEvent({ type: 'input', target: rent });
        await waitFor(() => f.backend.get('profile_rente_monatlich') === '1400' && !rent.disabled, 'Andere Profilfelder behalten ihren Autosave');
        assertEqual(f.backend.get('profile_tagesgeld'), '8000', 'Fremder Profilautosave übernimmt keinen offenen Tagesgeldentwurf');
        assertEqual(String(f.cash.value), '12', 'Fremder Profilautosave bewahrt den Tagesgeldentwurf im Feld');
        f.type('12345');
        assertEqual(await switchManagerProfile('b'), true, 'Personenwechsel sichert offenen Tagesgeldwert');
        assertEqual(JSON.parse(f.backend.get('rs_profiles_v1')).profiles.a.data.profile_tagesgeld, '12345', 'Wert gehört dauerhaft zur verlassenen Person');
        assertEqual(storage.getItem('profile_tagesgeld'), '500', 'Neue Person behält ihren eigenen Tagesgeldstand');
    }
    {
        const f = await fixture();
        f.type('12345');
        const link = f.doc.getElementById('managerBackLink');
        link.isConnected = true; link.closest = () => link;
        link.hasAttribute = key => link.attributes.has(key);
        f.doc.contains = node => node === link;
        bindProfileNavigationHandoff({ root: f.doc, win: f.win, ready: () => true, exporter: () => true });
        await f.doc.listeners.click[0]({ target: link, preventDefault() {} });
        assertEqual(f.win.location.href, 'index.html', 'Seitenwechsel wartet auf Speicherung des offenen Tagesgelds');
        assertEqual(f.backend.get('profile_tagesgeld'), '12345', 'Seitenwechsel erhält den offenen Betrag');
        f.guard.revokeNative();
    }
    {
        const f = await fixture({ tauri: true });
        f.type('12345');
        await f.close();
        assertEqual(f.closeReplies.join(','), 'hold,allow', 'EXE-Schließweg bestätigt den offenen Wert ohne Verlustentscheidung');
    }
    {
        const f = await fixture();
        f.type('12345');
        let held = false;
        f.guard.beforeUnload({ preventDefault() { held = true; } });
        assert(held, 'Browser hält Schließen während des Tagesgeldwrites zurück');
        await f.saved('12345');
        held = false;
        f.guard.beforeUnload({ preventDefault() { held = true; } });
        assertEqual(held, false, 'Bestätigter Tagesgeldwert blockiert das spätere Schließen nicht');
    }
    {
        const f = await fixture();
        f.type('12345'); f.failNextSave();
        assertEqual(await f.guard.prepare(), null, 'Speicherfehler verhindert den Seitenwechsel');
        assertEqual(f.backend.get('profile_tagesgeld'), '8000', 'Speicherfehler bewahrt den bestätigten Betrag');
        await f.doc.getElementById('retryTrancheSaveBtn').click();
        await f.saved('12345');
        assertEqual(f.history().entries.length, 2, 'Retry übernimmt den offenen Wert ohne doppelte Tageseinträge');
    }
} finally {
    P.resetPersistenceForTests(); setAppTestDate(oldDate);
    for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
}
