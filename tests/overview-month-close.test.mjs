import { bindOverviewMonthClose } from '../app/overview/overview-main.js';
import { overviewScope, storeMonthProvision, readMonthProvision, OVERVIEW_MONTH_KEY } from '../app/overview/overview-storage.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';

// Lokale Dokumente und lokaler Store: keine Globals, Singletonmocks oder Timer.
function fixture({ confirm = true, ask, store, complete = false, realConfirmation = false, dialogFailure = null } = {}) {
    const scope = overviewScope('household', ['a', 'b']);
    const registry = { version: 1, profiles: Object.fromEntries(['a', 'b'].map(id => [id, {
        meta: { id, name: id, belongsToHousehold: true }, data: { balance: '{"synthetisch":123}' }
    }])) };
    const values = new Map([['rs_profiles_v1', JSON.stringify(registry)], ['rs_current_profile', 'a'], ['rs_active_profile', 'a'], ['balance', '{"synthetisch":123}']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const base = { activeId: 'a', scope, summary: { monthlyWithdrawal: 500 }, expenses: { complete },
        occasion: { kind: 'monthly', month: '2026-09', previousYear: 2026, previousMonth: 9 } };
    let model = base, handler, controls, calls = 0, questions = 0;
    const status = { textContent: '' };
    // Der echte Dialog benötigt Selektoren und DOM-Verschiebungen beim Refresh.
    // Die gemeinsame Fixture ersetzt nur DOM-Mechanik, keine Produktionshelfer.
    const { doc, nodes, setFailure } = createDialogFixture();
    const setDialogFailure = value => setFailure(value === 'throw' ? 'showModal' : value === 'missing' ? 'missing-showModal' : null);
    setDialogFailure(dialogFailure);
    const focusTitle = doc.createElement('h2');
    let buttons = [];
    doc.getElementById = id => id === 'overviewMonthStatus' ? status : id === 'overviewFocus'
        ? { addEventListener: (_type, fn) => { handler = fn; } } : id === 'overviewFocusTitle' ? focusTitle : null;
    doc.querySelectorAll = selector => selector === '[data-overview-month]' ? buttons : [];
    doc.querySelector = selector => buttons[selector === '[data-overview-month-confirm]' ? 0 : 1];
    const refresh = () => {
        // Wie im Renderer entstehen neue Knöpfe; Rückfokus muss den aktuellen treffen.
        buttons = [true, false].map(primary => {
            const node = doc.createElement('button'); node.disabled = false;
            node.setAttribute('data-overview-month', '');
            if (primary) node.setAttribute('data-overview-month-confirm', '');
            return node;
        });
        const committed = readMonthProvision(storage.getItem(OVERVIEW_MONTH_KEY), base.occasion.month, base.scope);
        model = controls.projectModel({ ...base, occasion: { ...base.occasion, kind: committed ? 'play' : 'monthly' } });
        controls.syncButtons();
    };
    controls = bindOverviewMonthClose({ doc, win: {},
        ...(realConfirmation ? {} : { confirm: options => { questions++; return ask ? ask(options) : Promise.resolve(confirm); } }),
        getModel: () => model, refresh, store: request => { calls++; return store ? store(request, storage) : storeMonthProvision(request, { storage, flush: async () => true, guard: null, isBlocked: () => false }); } });
    refresh();
    return { base, storage, values, scope, status, doc, nodes, refresh, get buttons() { return buttons; },
        setDialogFailure,
        get dialog() { return doc.body.children.find(node => node.tag === 'dialog'); }, get model() { return model; }, get calls() { return calls; }, get questions() { return questions; },
        click: index => handler({ target: buttons[index] }) };
}

const cancelled = fixture({ confirm: false });
const untouched = JSON.stringify([...cancelled.values]);
await cancelled.click(0);
assertEqual(cancelled.calls, 0, 'Abbruch beginnt keinen Speicherauftrag');
assertEqual(JSON.stringify([...cancelled.values]), untouched, 'Abbruch erhält alle Bytes');
assert(cancelled.buttons.every(button => !button.disabled), 'Abbruch hinterlässt kein Pending');
for (const primary of [true, false]) {
    const f = fixture({ confirm: true });
    await f.click(primary ? 0 : 1);
    assertEqual(f.questions, 1, 'Beide Knöpfe fragen zurück');
    assertEqual(f.calls, 1, 'Ein Abschlussauftrag');
    assertEqual(f.status.textContent, 'September abgeschlossen ✓', 'Erfolg nach bestätigtem Speicherabschluss');
    assertEqual(f.model.occasion.kind, 'play', 'Bestätigter Monat öffnet ruhigen Anlass');
    const record = readMonthProvision(f.storage.getItem(OVERVIEW_MONTH_KEY), '2026-09', f.scope);
    assert(record && record.scope.key === f.scope.key, 'Bestehender Vormonat-/Scopevertrag');
    const profiles = JSON.parse(f.storage.getItem('rs_profiles_v1')).profiles;
    assert(['a', 'b'].every(id => profiles[id].data.balance === '{"synthetisch":123}'
        && readMonthProvision(profiles[id].data[OVERVIEW_MONTH_KEY], '2026-09', f.scope)), 'Beide Profile behalten Balancebytes und Monatshaken');
    assertEqual(f.storage.getItem('balance'), '{"synthetisch":123}', 'Livebalance bleibt bytegleich');
    f.refresh(); assertEqual(f.model.occasion.kind, 'play', 'Erneute Projektion liest dauerhaften Haken');
}

for (const outcome of ['success', 'failure', 'profile', 'scope']) {
    let release, reached, flushes = 0;
    const blocked = new Promise(resolve => { reached = resolve; });
    const f = fixture({ store: (request, storage) => storeMonthProvision(request, { storage, guard: null, isBlocked: () => false,
        flush: async () => {
            if (++flushes === 2) { reached(); return new Promise(resolve => { release = resolve; }); }
            return true;
        } }) });
    const job = f.click(0);
    try {
        await blocked;
        f.refresh();
        assert(f.buttons.every(button => button.disabled), outcome + ': beide Knöpfe gesperrt nach Re-Render');
        assertEqual(f.model.occasion.kind, 'monthly', outcome + ': Kandidat ist noch kein Erfolg');
        assert(!f.status.textContent.includes('abgeschlossen ✓'), outcome + ': kein früher Erfolg');
        await f.click(1); await f.click(0);
        assertEqual(f.calls, 1, outcome + ': Doppelklick startet keinen zweiten Auftrag');
        if (outcome === 'profile') {
            f.storage.setItem('rs_current_profile', 'b'); f.storage.setItem('rs_active_profile', 'b'); f.base.activeId = 'b';
        }
        if (outcome === 'scope') {
            const registry = JSON.parse(f.storage.getItem('rs_profiles_v1'));
            registry.profiles.b.meta.belongsToHousehold = false;
            f.storage.setItem('rs_profiles_v1', JSON.stringify(registry)); f.base.scope = overviewScope('single', ['a']);
        }
        release(outcome !== 'failure'); await job;
        assert(f.buttons.every(button => !button.disabled), outcome + ': Pending endet');
        if (outcome === 'success') assertEqual(f.status.textContent, 'September abgeschlossen ✓', 'Blockierter Flush bestätigt erst nach Freigabe');
        else {
            assert(!f.status.textContent.includes('abgeschlossen ✓'), outcome + ': kein falscher Erfolg');
            assertEqual(f.storage.getItem(OVERVIEW_MONTH_KEY), null, outcome + ': Kandidat zurückgenommen');
            if (outcome === 'failure') {
                await f.click(1);
                assertEqual(f.status.textContent, 'September abgeschlossen ✓', 'Retry nach Fehlflush nutzt direkten Schritt-4-Knopf');
            }
        }
    } finally { release?.(false); await job; }
}
const missingPlan = fixture(); missingPlan.base.summary = null; missingPlan.refresh(); await missingPlan.click(1);
assertEqual(missingPlan.calls, 0, 'Ohne Plan kein Abschlussauftrag');
const recovery = fixture(); recovery.base.recovery = true; recovery.refresh(); await recovery.click(0);
assertEqual(recovery.calls, 0, 'Recovery startet keinen Abschlussauftrag');

// Auch ein injizierter verspäteter Erfolg wird gegen den aktuellen Anzeigekontext geprüft.
let resolveStale;
const stale = fixture({ store: () => new Promise(resolve => { resolveStale = resolve; }) });
const staleJob = stale.click(1); await Promise.resolve(); stale.base.activeId = 'b'; stale.refresh(); resolveStale(true); await staleJob;
assert(!stale.status.textContent.includes('abgeschlossen ✓'), 'Verspätete Antwort eines verlassenen Profils meldet keinen Erfolg');

// Während der DOM-Nachfrage gelten dieselben Sperren, auch nach Projektionen.
for (const change of ['none', 'profile', 'scope', 'month', 'recovery', 'plan', 'error']) {
    let answer;
    const f = fixture({ ask: ({ signal }) => new Promise((resolve, reject) => {
        answer = change === 'error' ? () => reject(new Error('Dialogfehler')) : resolve;
        signal.addEventListener('abort', () => resolve(false), { once: true });
    }) });
    const before = JSON.stringify([...f.values]);
    const job = f.click(0);
    f.refresh();
    assert(f.buttons.every(button => button.disabled), change + ': Nachfrage sperrt beide Knöpfe nach Refresh');
    await f.click(0); await f.click(1);
    assertEqual(f.questions, 1, change + ': maximal eine Rückfrage');
    assertEqual(f.calls, 0, change + ': während der Nachfrage kein Speicherauftrag');
    if (change === 'profile') f.base.activeId = 'b';
    if (change === 'scope') f.base.scope = overviewScope('single', ['a']);
    if (change === 'month') f.base.occasion.month = '2026-10';
    if (change === 'recovery') f.base.recovery = true;
    if (change === 'plan') f.base.summary = null;
    f.refresh(); answer(true); await job;
    assertEqual(f.calls, change === 'none' ? 1 : 0, change + ': nur passende Bestätigung schreibt');
    if (change !== 'none') assertEqual(JSON.stringify([...f.values]), before, change + ': alle Speicherbytes erhalten');
    assert(f.buttons.every(button => !button.disabled), change + ': Nachfrage vollständig beendet');
    if (change === 'error') assertEqual(f.status.textContent, 'Monatsrückfrage konnte nicht geöffnet werden. Bitte erneut versuchen.', 'Injizierter Fehler ist Rückfragefehler');
}

const dialogErrorText = 'Monatsrückfrage konnte nicht geöffnet werden. Bitte erneut versuchen.';
function assertWriteFreeEnd(f, before, label) {
    assertEqual(f.calls, 0, label + ': kein Storeauftrag');
    assertEqual(JSON.stringify([...f.values]), before, label + ': vollständige Speicherwerte bytegleich');
    assertEqual(f.model.occasion.kind, 'monthly', label + ': Monatsanlass bleibt offen');
    assert(f.buttons.length === 2 && f.buttons.every(button => !button.disabled), label + ': zwei aktuelle Knöpfe freigegeben');
    assert(f.doc.activeElement === f.buttons[0], label + ': Rückfokus auf aktuellen Hauptknopf');
    assertEqual(f.doc.body.children.length, 0, label + ': kein Dialoghost');
    assert(f.nodes.every(node => [...node.listeners.values()].every(list => !list.size)), label + ': keine Dialoglistener');
}
for (const failure of ['throw', 'missing']) {
    // Kein confirm-Override: der Binder ruft seinen echten Produktionshelfer auf.
    const f = fixture({ realConfirmation: true, dialogFailure: failure });
    const before = JSON.stringify([...f.values]);
    await f.click(0);
    assertEqual(f.status.textContent, dialogErrorText, failure + ': festgelegte sichtbare Statusmeldung');
    assertWriteFreeEnd(f, before, failure);
    f.refresh();
    assertEqual(f.status.textContent, dialogErrorText, failure + ': Meldung übersteht weiteren Refresh im selben Kontext');
    f.setDialogFailure(null);
    const retry = f.click(0);
    try {
        assert(f.dialog?.open, failure + ': gleicher Dokumenthost kann erneut modal öffnen');
    } finally { f.dialog?.fire('cancel'); await retry; }
    assertWriteFreeEnd(f, before, failure + ': Retry');
    assertEqual(f.status.textContent, dialogErrorText, failure + ': regulärer Abbruch erzeugt keine neue Meldung');
    f.base.activeId = 'b'; f.refresh();
    assertEqual(f.status.textContent, '', failure + ': Kontextwechsel entfernt alte Fehlermeldung');
}
for (const outcome of ['cancel', 'escape', 'accept']) {
    const f = fixture({ realConfirmation: true });
    const before = JSON.stringify([...f.values]);
    assertEqual(f.status.textContent, '', outcome + ': leerer Ausgangsstatus');
    const job = f.click(0);
    try {
        assert(f.dialog?.open, outcome + ': echter Helfer öffnet Dialog');
        assert(f.buttons.every(button => button.disabled), outcome + ': Nachfrage sperrt beide Knöpfe');
        await f.click(0); await f.click(1);
        assertEqual(f.doc.body.children.length, 1, outcome + ': Reentranz erzeugt keinen weiteren Dialog');
        const all = node => [node, ...node.children.flatMap(all)];
        const accept = all(f.dialog).find(node => node.dataset.overviewMonthAccept !== undefined);
        const cancel = all(f.dialog).find(node => node.dataset.overviewMonthCancel !== undefined);
        if (outcome === 'accept') {
            assert(accept.disabled, 'Echter Helfer sperrt den Monatsauftrag vor den Pflichtbesuchen');
            await accept.fire('click');
            assertEqual(f.calls, 0, 'Unvorbereiteter Monatsauftrag bleibt schreibfrei');
            await prepareCloseFixture(f.doc);
            assertEqual(accept.disabled, false, 'Alle sichtbaren Vorbereitungsschritte geben den personenlosen Monatsauftrag frei');
            await accept.fire('click');
            assert(f.dialog?.open && f.dialog.dataset.monthResult === 'confirmed', 'Echter Helfer hält bestätigte Ergebnisinstanz offen');
            assertEqual(accept.textContent, 'Fertig', 'Echter Helfer bietet schreibfreien Fertigknopf');
            await accept.fire('click'); await job;
        }
        else if (outcome === 'cancel') cancel.fire('click');
        else f.dialog.fire('keydown', { key: 'Escape' });
    } finally { f.dialog?.fire('cancel'); await job; }
    if (outcome === 'accept') {
        assertEqual(f.calls, 1, 'Echte Bestätigung speichert genau einmal');
        assertEqual(f.status.textContent, 'September abgeschlossen ✓', 'Echte Bestätigung meldet dauerhaften Erfolg');
        assertEqual(f.model.occasion.kind, 'play', 'Echte Bestätigung schließt den Monat');
    } else {
        assertEqual(f.status.textContent, '', outcome + ': keine Fehlermeldung');
        assertWriteFreeEnd(f, before, outcome);
    }
}
