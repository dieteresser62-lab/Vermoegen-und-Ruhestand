import { documentDouble } from './helpers/page-dialog-dom.mjs';
import { requestPageChoice } from '../app/shared/page-choice-dialog.js';


const rows = [{ id: 'person:amount', label: 'Synthetische Person · Rente', options: [{ value: '0', label: '0 · Profil' }, { value: '1', label: '1234.567 · Simulator' }] }];
const previous = { confirm: globalThis.confirm, prompt: globalThis.prompt };
globalThis.confirm = globalThis.prompt = () => { throw new Error('NATIVE_DIALOG_FORBIDDEN'); };
try {
    for (const action of ['accept', 'cancel', 'escape', 'native-cancel', 'abort', 'close']) {
        const env = documentDouble(), controller = new AbortController();
        const pending = requestPageChoice({ title: 'Quellen prüfen', rows, doc: env.doc, signal: controller.signal });
        const dialog = env.dialog(), [select, cancel, accept] = env.controls();
        assert(dialog.open && dialog.attributes['aria-modal'] === 'true', action + ': echter modaler Baustein');
        assertEqual(env.doc.activeElement, select, action + ': erster Auswahlfokus');
        dialog.fire('keydown', { key: 'Tab', shiftKey: true }); assertEqual(env.doc.activeElement, accept, 'Shift+Tab zyklisch');
        dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, select, 'Tab zyklisch');
        dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, cancel, 'Tab erreicht Abbruch');
        assertEqual(await requestPageChoice({ doc: env.doc }), null, 'Doppelöffnung erzeugt keinen zweiten Dialog');
        select.value = '1';
        if (action === 'accept') accept.fire('click');
        if (action === 'cancel') cancel.fire('click');
        if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
        if (action === 'native-cancel') assert(dialog.fire('cancel').prevented, 'Cancel verhindert nativen Automatismus');
        if (action === 'abort') controller.abort();
        if (action === 'close') dialog.close();
        assertEqual(JSON.stringify(await pending), JSON.stringify(action === 'accept' ? { 'person:amount': '1' } : null), action + ': genau ein Ergebnis');
        assert(!dialog.open && !dialog.isConnected && env.cleaned(), action + ': Dialog und Listener entfernt');
        assertEqual(env.doc.activeElement, env.opener, 'Rückfokus zum Öffner');
        const reopened = requestPageChoice({ title: 'Erneut', rows, doc: env.doc });
        env.dialog().fire('keydown', { key: 'Escape' }); assertEqual(await reopened, null, 'Erneute Öffnung nach Cleanup');
    }
    for (const fault of ['show', 'missing']) {
        const env = documentDouble({ fault }); let error;
        try { await requestPageChoice({ title: 'Technische Gegenprobe', rows, doc: env.doc }); } catch (caught) { error = caught; }
        assert(error instanceof Error && env.cleaned(), fault + ': technische Ablehnung samt Cleanup');
        assertEqual(env.doc.activeElement, env.opener, 'Fehler erhält Rückfokus');
    }
    const env = documentDouble();
    const mapping = { id: 'mapping:a', label: 'Partner zuordnen', required: true, refreshRows: true, options: [{ value: '', label: 'Auswählen' }, { value: 'b', label: 'Person B' }] };
    const pending = requestPageChoice({ title: 'Zuordnung', rows: [mapping], doc: env.doc,
        updateRows: () => [mapping, ...rows] });
    const [first, , accept] = env.controls(); accept.fire('click');
    assert(env.dialog().open && env.doc.activeElement === first, 'Ungewählte Identität verhindert Zustimmung');
    first.value = 'b'; first.fire('change');
    assertEqual([...first.listeners.values()][0].size, 0, 'Rerender entfernt alte Auswahl-Listener sofort');
    const controls = env.controls(); assertEqual(env.doc.activeElement, controls[0], 'Zuordnungswechsel erhält Fokus');
    controls.at(-1).fire('click');
    assertEqual((await pending)['mapping:a'], 'b', 'Eine gemeinsame Zuordnungs-/Quellentscheidung');
    assert(env.cleaned(), 'Rerendercleanup vollständig');
    const replacement = env.doc.createElement('button'); env.doc.body.appendChild(replacement);
    const retry = requestPageChoice({ title: 'Ersatzöffner', rows, doc: env.doc, returnFocus: () => replacement.focus() });
    env.dialog().fire('keydown', { key: 'Escape' }); await retry;
    assertEqual(env.doc.activeElement, replacement, 'Rückfokus nach ersetztem Öffner');
} finally { Object.assign(globalThis, previous); }

// Radiokarten: Label, Pfeile, Fokusumlauf, Aufschub und Cleanup.
for (const action of ['accept', 'later', 'escape', 'abort']) {
    const env = documentDouble(), controller = new AbortController();
    const cards = [{ ...rows[0], kind: 'radio', selected: '0', options: rows[0].options.map((o, i) => ({ ...o, suggested: i === 0 })) }];
    const pending = requestPageChoice({ title: 'Zwei Angaben', rows: cards, doc: env.doc, signal: controller.signal });
    const radios = env.nodes.filter(n => n.type === 'radio'), dialog = env.dialog();
    assertEqual(radios.length, 2, 'Alle Kandidaten sind als Radio vorhanden');
    assert(radios[0].checked && env.doc.activeElement === radios[0], 'Profilvorschlag erhält Erstfokus');
    assertEqual(radios[0].parentNode.children.at(-1).textContent, 'Vorschlag', 'Profilvorschlag ist sichtbar markiert');
    radios[1].parentNode.fire('click');
    assert(radios[1].checked && !radios[0].checked, 'Labelklick wählt ausschließlich zweiten Kandidaten');
    radios[1].fire('keydown', { key: 'ArrowRight' });
    assert(radios[0].checked && env.doc.activeElement === radios[0], 'Pfeilumlauf wählt ersten Kandidaten');
    radios[0].fire('keydown', { key: 'ArrowLeft' });
    assert(radios[1].checked && env.doc.activeElement === radios[1], 'Pfeilumlauf rückwärts wählt zweiten Kandidaten');
    const cancel = env.nodes.find(n => n.dataset.pageChoiceCancel !== undefined), accept = env.nodes.find(n => n.dataset.pageChoiceAccept !== undefined);
    assertEqual(cancel.textContent, 'Später', 'Aufschubaktion heißt Später');
    dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, cancel, 'Tab verlässt Radiogruppe');
    dialog.fire('keydown', { key: 'Tab', shiftKey: true }); assertEqual(env.doc.activeElement, radios[1], 'Shift+Tab kehrt zum gewählten Radio zurück');
    if (action === 'accept') accept.fire('click');
    if (action === 'later') cancel.fire('click');
    if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
    if (action === 'abort') controller.abort();
    assertEqual(JSON.stringify(await pending), action === 'accept' ? JSON.stringify({ 'person:amount': '1' }) : 'null', 'Radioentscheidung wird genau einmal geliefert');
    assert(env.cleaned(), 'Alle Kartenlistener werden entfernt');
    assertEqual(env.doc.activeElement, env.opener, 'Radioabbruch erhält Rückfokus');
}

// Optionale asynchrone Bestätigung hält Modalität, Auswahl und Fokus bis Readback.
for (const outcome of ['success', 'error', 'abort']) {
    const env = documentDouble(), controller = new AbortController();
    let resolve, reject, calls = 0, frozen;
    const hold = new Promise((done, fail) => { resolve = done; reject = fail; });
    const pending = requestPageChoice({ title: 'Dauerhaft übernehmen', rows, doc: env.doc, signal: controller.signal,
        onConfirm: result => { calls++; frozen = result; return hold; } });
    const caught = pending.catch(error => error);
    const dialog = env.dialog(), [select, cancel, accept] = env.controls();
    select.value = '1'; accept.fire('click'); await Promise.resolve();
    assert(dialog.open && dialog.isConnected && env.doc.activeElement === dialog, 'Bestätigungsbarriere hält Dialogfokus');
    assert(select.disabled && cancel.disabled && accept.disabled, 'Auswahl und Aktionen eingefroren');
    select.value = '0'; accept.fire('click'); cancel.fire('click');
    dialog.fire('cancel'); dialog.fire('keydown', { key: 'Escape' });
    dialog.fire('keydown', { key: 'Tab' });
    assert(dialog.open && env.doc.activeElement === dialog, 'Escape/Später/Tab schließen die Bestätigungsphase nicht');
    assertEqual(calls, 1, 'Bestätigung startet genau einmal');
    assert(Object.isFrozen(frozen) && frozen['person:amount'] === '1', 'Bestätigung bewahrt die angenommene Auswahl');
    if (outcome === 'error') reject(new Error('SYNTHETIC_READBACK_FAILURE'));
    else if (outcome === 'abort') { controller.abort(); const error = new Error('Abgebrochen'); error.name = 'AbortError'; reject(error); }
    else resolve();
    const result = await caught;
    if (outcome === 'error') {
        assert(result instanceof Error && dialog.open && dialog.isConnected, 'Fehler bleibt sichtbar und endet nicht erfolgreich');
        assert(env.nodes.some(node => node.textContent?.includes('SYNTHETIC_READBACK_FAILURE')), 'Readbackfehler im Dialog erklärt');
        cancel.fire('click');
    } else assertEqual(JSON.stringify(result), JSON.stringify(outcome === 'abort' ? null : { 'person:amount': '1' }), 'Ergebnis erst nach Bestätigungsende');
    assert(!dialog.isConnected && env.cleaned(), 'Bestätigtes Ende räumt Dialog und Listener auf');
    assertEqual(env.doc.activeElement, env.opener, 'Bestätigtes Ende stellt Rückfokus wieder her');
}
