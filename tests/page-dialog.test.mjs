import { requestPageConfirmation, showPageAlert, requestPageInput } from '../app/shared/page-dialog.js';
import { requestPageChoice } from '../app/shared/page-choice-dialog.js';
import { documentDouble } from './helpers/page-dialog-dom.mjs';

const walk = node => [node, ...node.children.flatMap(walk)];
const control = (env, key) => env.nodes.findLast(node => node.dataset[key] !== undefined);
for (const kind of ['confirmation', 'alert', 'input']) for (const action of ['accept', 'cancel', 'escape', 'abort', 'close']) {
    const env = documentDouble(), controller = new AbortController();
    const options = { doc: env.doc, title: '<b>Prüfen</b>', description: 'Ein Absatz.\n\n- Erster Punkt\n- <script>Text</script>', signal: controller.signal,
        confirmLabel: 'Bewusst anwenden', danger: true, label: 'Wert', value: 'gültig', required: true };
    const pending = kind === 'confirmation' ? requestPageConfirmation(options) : kind === 'alert' ? showPageAlert(options) : requestPageInput(options);
    const dialog = env.dialog(), accept = control(env, 'pageDialogAccept'), cancel = control(env, 'pageDialogCancel');
    const heading = env.nodes.find(node => node.id === dialog.attributes['aria-labelledby']);
    const description = env.nodes.find(node => node.id === dialog.attributes['aria-describedby']);
    assert(heading.textContent === '<b>Prüfen</b>' && description.children[0].tagName === 'p', 'Titel sicher und Absatz tatsächlich gegliedert');
    assertEqual(description.children[1].tagName, 'ul', 'Aufzählung besitzt echte Liste');
    assertEqual(description.children[1].children[1].textContent, '<script>Text</script>', 'Listentext wird nicht als HTML interpretiert');
    assertEqual(env.doc.activeElement, kind === 'confirmation' ? cancel : kind === 'input' ? control(env, 'pageDialogInput') : accept, 'Formabhängiger sicherer Erstfokus');
    dialog.fire('keydown', { key: 'Tab', shiftKey: true }); assertEqual(env.doc.activeElement, accept, 'Shift+Tab umschließt alle Felder');
    dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, kind === 'input' ? control(env, 'pageDialogInput') : cancel || accept, 'Tab umläuft Modalität');
    assertEqual(await requestPageChoice({ doc: env.doc }), null, 'Auswahl kann aktive Rückfrage nicht bestätigen');
    if (action === 'accept') accept.fire('click');
    if (action === 'cancel') { if (cancel) cancel.fire('click'); else dialog.fire('cancel'); }
    if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
    if (action === 'abort') controller.abort();
    if (action === 'close') dialog.close();
    assertEqual(await pending, action === 'accept' ? kind === 'confirmation' ? true : kind === 'input' ? 'gültig' : undefined : kind === 'confirmation' ? false : kind === 'input' ? null : undefined, 'Nur ausdrückliche Bestätigung liefert Zustimmung/Wert');
    assert(!dialog.isConnected && env.cleaned(), 'Cleanup löst Modalität und Listener');
    assertEqual(env.doc.activeElement, env.opener, 'Rückfokus am Öffner');
}
for (const fieldKind of ['text', 'select']) {
    const env = documentDouble();
    const pending = requestPageInput({ doc: env.doc, required: true, value: '', options: fieldKind === 'select' ? [{ value: '', label: 'Bitte wählen' }, { value: 'ok', label: 'Gültig' }] : undefined,
        validate: value => value === 'ok' || 'Nur gültige Eingabe übernehmen.' });
    const field = control(env, 'pageDialogInput'), accept = control(env, 'pageDialogAccept');
    for (const value of ['', 'ungültig']) {
        field.value = value; accept.fire('click');
        assert(env.dialog().open && field.attributes['aria-invalid'] === 'true', 'Ungültiger Wert bleibt offen und sichtbar erklärt');
    }
    field.value = 'ok'; accept.fire('click'); assertEqual(await pending, 'ok', 'Geprüfter Wert wird geliefert');
}
{
    const env = documentDouble(), pending = requestPageConfirmation({ doc: env.doc });
    env.opener.remove(); control(env, 'pageDialogCancel').fire('click'); await pending;
    assertEqual(env.doc.activeElement, env.doc.body, 'Entfernter Öffner erhält verbundenes Rückfokusziel');
    for (const fault of ['show', 'missing']) {
        const broken = documentDouble({ fault }); let error;
        try { await requestPageConfirmation({ doc: broken.doc }); } catch (caught) { error = caught; }
        assert(error instanceof Error && broken.cleaned(), 'Öffnungsfehler liefert keine Zustimmung und entfernt Listener');
    }
    let error;
    try { await requestPageConfirmation({ doc: null }); } catch (caught) { error = caught; }
    assert(error instanceof Error, 'Fehlendes DOM ist niemals Zustimmung');
    const controller = new AbortController(); controller.abort();
    assertEqual(await requestPageConfirmation({ doc: env.doc, signal: controller.signal }), false, 'Bereits abgebrochenes Signal stimmt nicht zu');
    const again = requestPageConfirmation({ doc: env.doc }); control(env, 'pageDialogAccept').fire('click'); assertEqual(await again, true, 'Neuer Dialog nach Cleanup möglich');
}
{
    const env = documentDouble();
    const question = requestPageConfirmation({ doc: env.doc });
    const notice = showPageAlert({ doc: env.doc, title: 'Folgehinweis' });
    assertEqual(env.nodes.filter(node => node.tagName === 'dialog').length, 1, 'Konkurrierender Hinweis überlagert keine Rückfrage');
    control(env, 'pageDialogCancel').fire('click'); await question; await Promise.resolve();
    assert(env.dialog().open && env.nodes.some(node => node.textContent === 'Folgehinweis'), 'Folgehinweis wird nach Ende der Rückfrage sichtbar');
    control(env, 'pageDialogAccept').fire('click'); await notice;
}
