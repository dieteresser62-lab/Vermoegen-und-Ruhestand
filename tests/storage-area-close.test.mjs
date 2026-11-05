import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { fakeAreaTauri, MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
const tick = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
for (const buffered of ['none', 'upsert', 'delete']) for (const changed of [false, true]) {
    const { doc } = createDialogFixture();
    for (const [tag, id] of [['p', 'suiteNavigationStatus'], ['dialog', 'navigationGuardDialog'],
        ['h2', 'navigationGuardTitle'], ['p', 'navigationGuardDescription'], ['button', 'navigationGuardStay'], ['button', 'navigationGuardLeave']]) {
        const node = doc.createElement(tag); node.id = id; doc.body.append(node);
    }
    const backend = fakeAreaTauri(), replies = [], local = new MemoryWebStorage();
    let listener, reloads = 0;
    const win = { localStorage: local, sessionStorage: new MemoryWebStorage(), location: { reload() { reloads++; } },
        addEventListener() {}, removeEventListener() {},
        __TAURI__: { event: { async listen(name, callback) { listener = callback; return () => {}; } },
            core: { async invoke(command, args) { if (command === 'confirm_app_close') { replies.push(args.response); return true; }
                return backend.invoke(command, args); } } } };
    doc.defaultView = win;
    persistence.resetPersistenceRuntimeForTests();
    await persistence.init({ doc, window: win, installLifecycleHooks: false, installTauriCloseHook: true });
    const guard = getPageNavigationGuard(doc, win);
    guard.register('form', { read: () => ({ dirty: buffered !== 'none' }) });
    if (buffered !== 'none') persistence.setItemSync('profile_tagesgeld', '10000');
    if (buffered === 'delete') persistence.removeItemSync('profile_tagesgeld');
    if (changed) backend.files.set('control', JSON.stringify({ version: 1, activeArea: 'spiel', source: 'demo',
        startedAt: '2026-01-01T00:00:00.000Z', id: 'synthetic', phase: 'active' }));
    await tick();
    if (buffered === 'none') {
        assertEqual(await persistence.flush(), true, 'Bereich geändert und leerer Puffer: Flush bestätigt ohne Schreibprüfung');
        await listener({ payload: { attemptId: '1' } });
        assertEqual(replies.join(','), 'hold,allow', 'Leerer Puffer gibt Tauri-Schließen ohne Verlustnachfrage frei');
        assert(!doc.getElementById('navigationGuardDialog').open, 'Keine Nachfrage ohne ungespeicherte Eingaben');
        persistence.resetPersistenceRuntimeForTests();
        continue;
    }
    let attempt = listener({ payload: { attemptId: '1' } }); await tick();
    assert(doc.getElementById('navigationGuardDialog').open, 'Schließen fragt vor Datenverlust');
    if (changed) {
        assertEqual(doc.getElementById('navigationGuardDescription').textContent,
            'Nicht gespeicherte Eingaben gehen verloren – trotzdem schließen?', 'Geänderter Bereich erklärt den Verlust');
        const button = doc.getElementById('storageAreaReloadNotice').children.find(node => node.textContent === 'Jetzt neu laden');
        assert(button, 'Speicherhinweis hat Reloadknopf');
        doc.getElementById('suiteNavigationStatus').textContent = 'Navigation abgebrochen';
        assert(doc.getElementById('storageAreaReloadNotice').contains(button), 'Navigationsfehler entfernt den Ausweg nicht');
        await button.fire('click'); assertEqual(reloads, 1, 'Knopf lädt das Fenster neu');
    }
    await doc.getElementById('navigationGuardStay').fire('click'); await attempt;
    assertEqual(replies.join(','), 'hold,reject', 'Nein schließt nicht');
    attempt = listener({ payload: { attemptId: '2' } }); await tick();
    await doc.getElementById('navigationGuardLeave').fire('click'); await attempt;
    assertEqual(replies.join(','), 'hold,reject,hold,allow', 'Ja bestätigt Rust-Schließfreigabe');
    assertEqual(persistence.getPersistenceStatus().reloadRequired, changed, 'Nur der geänderte Bereich braucht Reload');
    assertEqual(backend.files.has('live') && JSON.parse(backend.files.get('live')).records?.profile_tagesgeld === '10000', !changed && buffered === 'upsert',
        'Speicherbarer Zustand wird geflusht; fremder Bereich erhält keine Eingaben');
    persistence.resetPersistenceRuntimeForTests();
}
