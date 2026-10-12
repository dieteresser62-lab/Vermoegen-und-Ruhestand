import { showNavigationGuardDialog, getPageNavigationGuard, isNavigationGuardDialogOpen } from '../app/shared/navigation-guard-dialog.js';
function fixture() {
    const docListeners = new Map(), winListeners = new Map(), elements = new Map();
    const doc = { activeElement: null, getElementById: id => elements.get(id),
        addEventListener(type, fn, capture) { docListeners.set(type, { fn, capture }); },
        removeEventListener(type) { docListeners.delete(type); } };
    const win = { addEventListener(type, fn) { winListeners.set(type, fn); }, removeEventListener(type) { winListeners.delete(type); } };
    doc.defaultView = win;
    for (const id of ['navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardStay', 'navigationGuardLeave', 'navigationGuardDescription', 'opener', 'suiteNavigationStatus']) {
        const listeners = new Map();
        elements.set(id, { id, listeners, textContent: '', isConnected: true,
            focus() { doc.activeElement = this; },
            addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
            showModal() { this.open = true; this.modal = true; }, close() { this.open = false; listeners.get('close')?.(); } });
    }
    function key(value, shiftKey = false) {
        const event = { key: value, shiftKey, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        docListeners.get('keydown')?.fn(event); return event;
    }
    return { doc, win, elements, docListeners, winListeners, key };
}
{
    const f = fixture(), opener = f.elements.get('opener'); opener.focus();
    const reasons = [{ result: true }, { phase: 'running' }, { dirty: true }];
    const promise = showNavigationGuardDialog({ reasons, opener }, f.doc);
    assertEqual(f.elements.get('navigationGuardTitle').textContent, 'Seite verlassen?', 'Navigation benennt den Seitenwechsel im zugänglichen Titel');
    assertEqual(f.elements.get('navigationGuardLeave').textContent, 'Trotzdem wechseln', 'Navigation behält den Wechselknopf');
    assertEqual(showNavigationGuardDialog({ reasons, opener }, f.doc), promise, 'Dokument öffnet höchstens eine Nachfrage');
    assertEqual(f.doc.activeElement.id, 'navigationGuardStay', 'Anfangsfokus liegt auf Bleiben');
    assertEqual(f.elements.get('navigationGuardDialog').modal, true, 'Nachfrage nutzt nativen modalen Top-Layer');
    assertEqual(f.docListeners.get('keydown').capture, true, 'Tastatur wird vor darunterliegenden Dialogen übernommen');
    assert(f.elements.get('navigationGuardDescription').textContent.includes('Ergebnis geht verloren – trotzdem wechseln?'), 'Ergebnisverlust wird klar benannt');
    assert(f.elements.get('navigationGuardDescription').textContent.includes('Rechnung wird abgebrochen'), 'Abbruch wird klar benannt');
    f.key('Tab'); assertEqual(f.doc.activeElement.id, 'navigationGuardLeave', 'Tab erreicht Wechseln');
    f.key('Tab'); assertEqual(f.doc.activeElement.id, 'navigationGuardStay', 'Tab bleibt im Dialog');
    f.key('Tab', true); assertEqual(f.doc.activeElement.id, 'navigationGuardLeave', 'Shift+Tab bleibt im Dialog');
    opener.focus(); f.key('Tab'); assertEqual(f.doc.activeElement.id, 'navigationGuardStay', 'Fremder Fokus wird zurück in Dialog geführt');
    const event = f.key('Escape');
    assertEqual(event.stopped && event.defaultPrevented, true, 'Escape erreicht keinen darunterliegenden Dialog');
    assertEqual(await promise, false, 'Escape bedeutet Bleiben');
    assertEqual(f.doc.activeElement, opener, 'Fokus kehrt zum konkreten Auslöser zurück');
    assertEqual(isNavigationGuardDialogOpen(f.doc), false, 'Nachfrage räumt Zustand und Listener auf');
}
for (const button of ['navigationGuardStay', 'navigationGuardLeave']) {
    const f = fixture(); const promise = showNavigationGuardDialog({ reasons: [{ dirty: true }] }, f.doc);
    f.elements.get(button).listeners.get('click')();
    assertEqual(await promise, button === 'navigationGuardLeave', 'Nur Wechseln erteilt Zustimmung');
    assertEqual(f.docListeners.has('keydown'), false, 'Schließen entfernt Capturelistener');
}
{
    const f = fixture(), field = f.elements.get('navigationGuardDescription'), link = f.elements.get('opener');
    const editor = { contains: node => node === field };
    field.closest = () => editor;
    field.focus();
    const prompt = showNavigationGuardDialog({ reasons: [{ dirty: true }], opener: link }, f.doc);
    f.key('Escape');
    assertEqual(await prompt, false, 'Programmatische Hintergrundnavigation bleibt nach Escape im Dokument');
    assertEqual(f.doc.activeElement, field, 'Hintergrundauslöser verdrängt nach Bleiben nicht den Fachdialogfokus');
}
for (const button of ['navigationGuardStay', 'navigationGuardLeave']) {
    const f = fixture(), guard = getPageNavigationGuard(f.doc, f.win);
    guard.register('form', { read: () => ({ dirty: true, message: 'Ungespeicherte Eingaben gehen verloren – trotzdem wechseln?' }) });
    const discard = guard.prepare({ intent: 'discard' });
    assertEqual(f.elements.get('navigationGuardTitle').textContent, 'Änderungen verwerfen?', 'Verwerfen benennt den tatsächlichen Zweck im zugänglichen Titel');
    assertEqual(f.elements.get('navigationGuardLeave').textContent, 'Verwerfen', 'Verwerfen erhält eine eindeutige Bestätigung');
    assertEqual(f.elements.get('navigationGuardDescription').textContent, 'Ungespeicherte Eingaben gehen verloren – trotzdem verwerfen?', 'Verwerfen übernimmt keinen Seitenwechselhinweis des Providers');
    f.elements.get(button).listeners.get('click')();
    const attempt = await discard;
    assertEqual(!!attempt, button === 'navigationGuardLeave', 'Nur Verwerfen bestätigt den Schließversuch');
    if (attempt) guard.end(attempt);
    const navigation = guard.prepare({ opener: f.elements.get('opener') });
    assertEqual(f.elements.get('navigationGuardTitle').textContent, 'Seite verlassen?', 'Spätere Linknavigation stellt den Seitenwechseltitel wieder her');
    assertEqual(f.elements.get('navigationGuardLeave').textContent, 'Trotzdem wechseln', 'Spätere Linknavigation stellt den Wechselknopf wieder her');
    assertEqual(f.elements.get('navigationGuardDescription').textContent, 'Ungespeicherte Eingaben gehen verloren – trotzdem wechseln?', 'Spätere Navigation verwendet wieder den Wechselhinweis');
    f.elements.get('navigationGuardStay').listeners.get('click')();
    assertEqual(await navigation, null, 'Bleiben verhindert auch nach Verwerfen den Wechsel');
}
{
    const f = fixture(), guard = getPageNavigationGuard(f.doc, f.win);
    assertEqual(getPageNavigationGuard(f.doc, f.win), guard, 'Ein Schutzkern pro Dokument');
    assertEqual(f.winListeners.has('beforeunload'), false, 'Saubere Seite besitzt keinen nativen Nachfragehandler');
    let state = { dirty: false };
    const registration = guard.register('form', { read: () => state });
    state = { dirty: true }; registration.notify();
    assertEqual(f.winListeners.get('beforeunload'), guard.beforeUnload, 'Dirty installiert den zentralen nativen Handler');
    state = { dirty: false }; registration.notify();
    assertEqual(f.winListeners.has('beforeunload'), false, 'Rückänderung entfernt nativen Handler');
    state = { phase: 'commit' }; registration.notify();
    assertEqual(f.winListeners.has('beforeunload'), true, 'Commit aktiviert nativen Schutz ohne Dirty');
    registration.unregister();
    assertEqual(f.winListeners.has('beforeunload'), false, 'Letzter Besitzer räumt nativen Schutz auf');
    state = { result: true }; guard.register('result', { read: () => state });
    const attempt = await guard.prepare({ decide: () => true }); guard.commitNavigation(attempt, () => {});
    f.winListeners.get('pageshow')({ persisted: true });
    let prevented = false; guard.beforeUnload({ preventDefault() { prevented = true; }, returnValue: null });
    assertEqual(prevented, true, 'BFCache-Rückkehr widerruft alte native Freigabe');
}
{
    const f = fixture(), controller = new AbortController(), opener = f.elements.get('opener');
    const promise = showNavigationGuardDialog({ reasons: [{ dirty: true }], opener, intent: 'close', signal: controller.signal }, f.doc);
    assertEqual(f.elements.get('navigationGuardTitle').textContent, 'Anwendung schließen?', 'EXE-Nachfrage benennt den tatsächlichen Fensterschluss');
    assertEqual(f.elements.get('navigationGuardLeave').textContent, 'Trotzdem schließen', 'EXE-Knopf bestätigt den Schluss');
    controller.abort();
    assertEqual(await promise, false, 'Cleanup lehnt die eigene Nachfrage ab');
    assertEqual(f.elements.get('navigationGuardDialog').open, false, 'Cleanup schließt den eigenen Dialog');
    assertEqual(f.docListeners.has('keydown'), false, 'Cleanup räumt den Tastaturhandler auf');
    assertEqual(f.doc.activeElement, opener, 'Cleanup stellt den vorherigen Fokus wieder her');
    assertEqual(await showNavigationGuardDialog({ reasons: [], signal: controller.signal }, f.doc), false, 'Bereits widerrufene Bindung öffnet keinen neuen Dialog');
}
