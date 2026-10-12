import { createCloseDialog, dialogElements } from '../app/shared/close-dialog.js';

/** DOM-Mechanik allein wird gedoppelt; alle Fachtests verwenden die Produktdienste. */
export function createDialogFixture() {
    let failure = null;
    const nodes = [], doc = { activeElement: null };
    const attrName = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const matches = (node, selector) => {
        if (selector.includes(',')) return selector.split(',').some(part => matches(node, part.trim()));
        if (selector.includes(':not')) { const [base, excluded] = selector.split(':not('); return matches(node, base) && !matches(node, excluded.slice(0, -1)); }
        if (selector.startsWith('#')) return node.id === selector.slice(1);
        if (selector.startsWith('.')) return (node.className || '').split(' ').includes(selector.slice(1));
        const m = selector.match(/^(\w+)?(?:\[([^=\]]+)(?:="?([^"\]]+)"?)?\])?$/);
        if (!m) return false;
        return (!m[1] || node.tag === m[1]) && (!m[2] || node.hasAttribute(m[2]) && (m[3] === undefined || node.getAttribute(m[2]) === m[3]));
    };
    doc.createElement = tag => {
        if (failure === 'create-dialog' && tag === 'dialog' || failure === 'create-title' && tag === 'h2') throw new Error('Dialogfehler');
        const listeners = new Map(), node = { tag, children: [], dataset: {}, attributes: {}, textContent: '', open: false, disabled: false, hidden: false,
            ownerDocument: doc,
            get classList() { return { toggle: (name, enabled) => {
                const names = new Set((this.className || '').split(' ').filter(Boolean));
                if (enabled) names.add(name); else names.delete(name); this.className = [...names].join(' ');
            } }; },
            dispatchEvent(event) { void this.fire(event.type); return true; },
            get isConnected() { return this === doc.body || Boolean(this.parent?.isConnected); },
            contains(child) { return dialogElements(this).includes(child); },
            setAttribute(key, value) { this.attributes[key] = String(value); if (key.startsWith('data-')) this.dataset[attrName(key.slice(5))] = String(value); },
            removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[attrName(key.slice(5))]; },
            getAttribute(key) { return key.startsWith('data-') ? this.dataset[attrName(key.slice(5))] ?? null : this.attributes[key] ?? null; },
            hasAttribute(key) { return key === 'open' ? this.open : this.getAttribute(key) !== null; },
            closest(selector) { return matches(this, selector) ? this : this.parent?.closest(selector) || null; },
            append(...children) { children.forEach(child => this.appendChild(child)); },
            appendChild(child) { child.remove(); child.parent = this; this.children.push(child); return child; },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
            querySelectorAll(selector) { return dialogElements(this).slice(1).filter(node => matches(node, selector)); },
            querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
            addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
            removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
            fire(type, fields = {}) {
                const event = { target: this, prevented: false, defaultPrevented: false, preventDefault() { this.prevented = true; this.defaultPrevented = true; }, stopPropagation() {}, ...fields };
                const jobs = []; for (let node = this; node; node = ['click', 'input', 'change'].includes(type) ? node.parent : null) for (const fn of [...node.listeners.get(type) || []]) jobs.push(fn(event));
                return Promise.all(jobs);
            },
            listeners, focus() { doc.activeElement = this; },
            showModal() { this.open = true; if (failure === 'showModal') throw new Error('Dialogfehler'); },
            close() { this.open = false; void this.fire('close'); }
        };
        if (tag === 'dialog' && failure === 'missing-showModal') delete node.showModal;
        nodes.push(node); return node;
    };
    doc.body = doc.createElement('body');
    doc.getElementById = id => dialogElements(doc.body).find(node => node.id === id) || null;
    doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
    doc.querySelector = selector => doc.body.querySelector(selector);
    const events = doc.createElement('document');
    doc.addEventListener = events.addEventListener.bind(events); doc.removeEventListener = events.removeEventListener.bind(events);
    doc.dispatchEvent = event => { void events.fire(event.type); return true; };
    return { doc, nodes, setFailure: value => { failure = value; } };
}

/** FR-4/FR-5: bestehende Speichertests führen echte Besuchs- und Bestätigungsklicks aus. */
export async function prepareCloseFixture(doc) {
    const findRoot = () => dialogElements(doc.body).find(node => Object.hasOwn(node.dataset || {}, 'closeDialogHost'));
    for (let turn = 0; turn < 400 && !findRoot(); turn++) await new Promise(resolve => setTimeout(resolve, 1));
    const root = findRoot();
    if (!root || root.getAttribute('aria-busy') === 'true') return;
    const elements = () => [...new Set(dialogElements(root))];
    for (const row of elements().filter(node => node.dataset?.closeDialogStep)) {
        if (row.dataset.visited !== 'true' && row.dataset.locked !== 'true') await dialogElements(row).find(node => node.dataset?.closeDialogActivate)?.fire('click');
    }
    const cash = elements().find(node => node.dataset?.closeDialogStep === 'cash');
    const pill = cash && dialogElements(cash).find(node => node.className === 'close-dialog-step-pill');
    if (pill?.textContent !== 'eingetragen') await elements().find(node => Object.hasOwn(node.dataset || {}, 'tagesgeldConfirm'))?.fire('click');
}

// Fixtureimporte führen keine fremden Assertions vor deren eigenem Suiteeintrag aus.
if (!new URL(import.meta.url).searchParams.has('fixture')) {

{
    const f = createDialogFixture(), returned = f.doc.createElement('button');
    const body = f.doc.createElement('div'), first = f.doc.createElement('input'); body.append(first);
    const handle = createCloseDialog({ doc: f.doc, id: 'testClose', title: 'Abschluss', returnFocus: () => returned.focus(),
        steps: [{ id: 'a', title: 'Erledigt', done: true, result: 'Gespeichert' }, { id: 'b', title: 'Aktuell', content: body }, { id: 'c', title: 'Offen' }] });
    assertEqual(handle.root.getAttribute('aria-labelledby'), 'testCloseTitle', 'Gemeinsamer Dialog hat sichtbaren ARIA-Titel');
    assertEqual(f.doc.querySelector('[data-close-dialog-step="b"]').dataset.state, 'open', 'Verborgener zweiter Schritt bleibt unbesucht');
    assertEqual(f.doc.querySelector('[data-close-dialog-step="a"]').dataset.state, 'done', 'Erledigt hat eigenen Zustand');
    assertEqual(f.doc.querySelector('[data-close-dialog-step="c"]').dataset.state, 'open', 'Weitere Schritte offen');
    assertEqual(createCloseDialog({ doc: f.doc }), null, 'Nur ein Abschlussdialog pro Dokument');
    handle.activate('b');
    const last = f.doc.createElement('button'); body.append(last); last.focus();
    await handle.root.fire('keydown', { key: 'Tab' });
    assert(f.doc.activeElement === f.doc.querySelector('[data-close-dialog-next="b"]'), 'Dynamische Fokusziele folgen DOM-Reihenfolge einschließlich Weiter');
    await handle.root.fire('keydown', { key: 'Tab', shiftKey: true }); assert(f.doc.activeElement === last, 'Shift+Tab berücksichtigt dynamische Ziele');
    last.disabled = true; first.focus(); await handle.root.fire('keydown', { key: 'Tab' }); assert(f.doc.activeElement !== last, 'Deaktivierte Ziele sind ausgeschlossen');
    const preview = f.doc.createElement('dialog'); f.doc.body.append(preview); preview.showModal();
    await handle.root.fire('keydown', { key: 'Escape' }); assert(handle.root.open, 'Escape gehört ausschließlich dem überlagerten Dialog');
    preview.close(); preview.remove();
    handle.setBusy(true); await handle.root.fire('keydown', { key: 'Escape' }); assert(handle.root.open, 'Commit sperrt Escape');
    handle.setBusy(false); await handle.root.fire('keydown', { key: 'Escape' }); await handle.closed;
    assert(f.doc.activeElement === returned && !f.doc.body.children.length, 'Cleanup entfernt Host und gibt Fokus zurück');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Komponentenlistener vollständig entfernt');
}
{
    const f = createDialogFixture(), returned = f.doc.createElement('button');
    let finished = false;
    const handle = createCloseDialog({ doc: f.doc, id: 'nativeClose', title: 'Abschluss', returnFocus: () => returned.focus() });
    handle.closed.then(() => { finished = true; });
    handle.setBusy(true); handle.root.close();
    await Promise.resolve();
    assert(!finished && handle.root.isConnected, 'Nativer Close während Commit wartet mit Cleanup auf dessen Abschluss');
    assertEqual(createCloseDialog({ doc: f.doc }), null, 'Nativer Close gibt den laufenden Commitbesitzer nicht vorzeitig frei');
    handle.setBusy(false);
    assertEqual(await handle.closed, false, 'Nativer Close wird nach Commit als Abbruch abgeschlossen');
    assert(!handle.root.isConnected && !f.doc.body.children.length, 'Nachgeholtes Cleanup entfernt den geschlossenen Host');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Nachgeholtes Cleanup entfernt alle Listener');
    assert(f.doc.activeElement === returned, 'Nachgeholtes Cleanup setzt den Rückfokus');
    const next = createCloseDialog({ doc: f.doc, id: 'retryNativeClose', title: 'Erneut' });
    assert(next.root.open, 'Nach nativem Close und Commitende ist eine erneute Öffnung möglich');
    next.close(false); await next.closed;
}
{
    const f = createDialogFixture(), action = f.doc.createElement('button'); action.className = 'ds-button ds-button-primary';
    const steps = [{ id: 'a', title: 'Kurse', content: f.doc.createElement('p') },
        { id: 'b', title: 'Budget', state: 'not_applicable', content: f.doc.createElement('p') },
        { id: 'c', title: 'Ausgaben', done: true, content: f.doc.createElement('p') },
        { id: 'd', title: 'Tagesgeld', content: f.doc.createElement('input') }];
    const before = JSON.stringify(steps.map(({ content, ...step }) => step));
    const h = createCloseDialog({ doc: f.doc, id: 'navigation', title: 'Abschluss', steps, actions: [action] });
    await f.doc.querySelector('[data-close-dialog-next="a"]').fire('click');
    assertEqual(f.doc.querySelector('[data-close-dialog-activate="b"]').getAttribute('aria-expanded'), 'true', 'Weiter zeigt auch entfallenden Vorbereitungsschritt');
    await f.doc.querySelector('[data-close-dialog-next="b"]').fire('click');
    await f.doc.querySelector('[data-close-dialog-next="c"]').fire('click');
    assertEqual(JSON.stringify(steps.map(({ content, ...step }) => step)), before, 'Weiter ändert keinen fachlichen Zustand');
    assert(!f.doc.querySelector('[data-close-dialog-next="d"]'), 'Letzter Schritt hat keinen leeren Weiterknopf');
    await f.doc.querySelector('[data-close-dialog-activate="b"]').fire('click');
    const neutral = f.doc.querySelector('[data-close-dialog-step="b"]');
    assertEqual(neutral.dataset.state, 'not_applicable', 'Entfällt bleibt neutral auch bei Wiederöffnung');
    assertEqual(neutral.querySelector('.close-dialog-step-symbol').textContent, '–', 'Entfällt hat keinen Haken');
    h.setBusy(true); await f.doc.querySelector('[data-close-dialog-next="b"]').fire('click');
    assertEqual(neutral.children[0].getAttribute('aria-expanded'), 'true', 'Busy sperrt Weiter');
    h.setBusy(false); h.close(false);
}
{
    const f = createDialogFixture();
    const steps = ['prices', 'expenses', 'budget', 'cash'].map(id => ({ id, title: id, content: f.doc.createElement('p') }));
    const h = createCloseDialog({ doc: f.doc, id: 'forward', title: 'Abschluss', steps });
    await f.doc.querySelector('[data-close-dialog-activate="expenses"]').fire('click');
    h.updateSteps(steps.map(step => ({ ...step, done: step.id === 'expenses' })));
    assertEqual(f.doc.querySelector('[data-close-dialog-step="expenses"]').dataset.state, 'done', 'Hintergrundupdate hält den geöffneten Schritt');
    h.close(false);
}
{
    const f = createDialogFixture(), action = f.doc.createElement('button'); action.className = 'ds-button ds-button-primary';
    let writes = 0; action.addEventListener('click', () => { writes++; });
    const h = createCloseDialog({ doc: f.doc, id: 'annualPrepared', title: 'Jahr', progressNames: 'A + B', actions: [action],
        steps: [{ id: 'cash', title: 'Tagesgeld', state: 'entered', result: 'Erst beim Jahresabschluss gespeichert' },
            { id: 'market', title: 'Marktdaten', done: true },
            { id: 'preview', title: 'Plan', done: true, nextAction: true, nextLabel: 'Weiter: Jahr 2026 abschließen' },
            { id: 'month', title: 'Januar', awaitingYear: true }] });
    const cash = f.doc.querySelector('[data-close-dialog-step="cash"]');
    assertEqual(cash.querySelector('.close-dialog-step-pill').textContent, 'eingetragen', 'Vorbereiteter Cashentwurf hat eigene Beschriftung');
    assertEqual(cash.querySelector('.close-dialog-step-symbol').textContent, '✓', 'Gültiger Entwurf hat einen Haken mit eigener Eingetragen-Beschriftung');
    h.activate('preview');
    assertEqual(f.doc.getElementById('annualPreparedSubtitle').textContent, 'A + B · 2 von 3 Schritten angesehen', 'Fortschritt zählt sichtbare Vorbereitung ohne Ergebnisbereich');
    assert(!f.doc.querySelector('[data-close-dialog-next="preview"]') && writes === 0, 'Letzte Vorbereitung hat keinen Weiterknopf und schreibt nichts');
    h.activate('month'); assertEqual(f.doc.querySelector('[data-close-dialog-activate="month"]').getAttribute('aria-expanded'), 'true', 'Monatsansicht vor Jahreswrite bleibt zugänglich');
    h.updateSteps([{ id: 'cash', title: 'Tagesgeld', state: 'skipped', result: 'Ungeprüft' }]);
    assertEqual(cash.querySelector('.close-dialog-step-pill').textContent, 'übersprungen', 'Unerfüllte Empfehlung bleibt neutral übersprungen');
    assertEqual(cash.querySelector('.close-dialog-step-symbol').textContent, '–', 'Übersprungen behauptet keinen Prüferfolg');
    h.close(false);
}
for (const failure of ['create-dialog', 'create-title', 'showModal', 'missing-showModal']) {
    const f = createDialogFixture(); f.setFailure(failure); let error;
    try { createCloseDialog({ doc: f.doc, id: 'failure', title: 'Fehler' }); } catch (caught) { error = caught; }
    assert(error instanceof Error, failure + ': technischer Öffnungsfehler bleibt sichtbar');
    assertEqual(f.doc.body.children.length, 0, failure + ': unvollständiger Host entfernt');
    f.setFailure(null); const next = createCloseDialog({ doc: f.doc, id: 'retry', title: 'Erneut' });
    assert(next.root.open, failure + ': Öffnungssperre nach Fehler frei'); next.close(false);
}

{
    const f = createDialogFixture(); let release, calls = 0;
    const handle = createCloseDialog({ doc: f.doc, id: 'concurrentClose', title: 'Abschluss',
        onClose: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
    const first = handle.requestClose(); await handle.requestClose();
    assertEqual(calls, 1, 'Gleichzeitige Schließwege starten nur eine Rückfrage');
    release(false); await first; assert(handle.root.open, 'Abgelehnter Schließversuch erhält die Instanz');
    handle.setBusy(true); await handle.requestClose();
    assertEqual(calls, 1, 'Commit startet keine Verlustnachfrage');
    handle.setBusy(false); handle.close(false); await handle.closed;
}

{
    const f = createDialogFixture();
    const handle = createCloseDialog({ doc: f.doc, id: 'grouped', title: 'Jahresabschluss', groupBefore: { market: 'Jahresschritte' },
        steps: [{ id: 'cash', title: 'Tagesgeld' }, { id: 'market', title: 'Marktdaten' }, { id: 'month', title: 'Monat', locked: true }] });
    assertEqual(f.doc.querySelector('[data-close-dialog-group="market"]').textContent, 'Jahresschritte', 'Optionale Gruppentrennung vor Marktdaten');
    handle.activate('month'); assertEqual(f.doc.querySelector('[data-close-dialog-step="month"]').dataset.state, 'open', 'Gesperrter Schritt bleibt auch programmatisch unzugänglich');
    handle.setResult(f.doc.createElement('section')); handle.setResult(f.doc.createElement('section'));
    assertEqual(handle.content.children.length, 1, 'Erneute Ergebnisanzeige ersetzt alte Ergebnisse und Entwurfshooks');
    handle.close(false);
}
{
    const f = createDialogFixture(); const bodies = ['a', 'b', 'c'].map(() => f.doc.createElement('p'));
    const steps = [ { id: 'a', title: 'Erledigt', done: true, result: 'Belegt', content: bodies[0] },
        { id: 'b', title: 'Aktuell', result: 'Offen', content: bodies[1] }, { id: 'c', title: 'Weiter', content: bodies[2] } ];
    const h = createCloseDialog({ doc: f.doc, id: 'states', title: 'Abschluss', progressNames: 'A + B', steps });
    const row = id => f.doc.querySelector(`[data-close-dialog-step="${id}"]`);
    const pill = id => dialogElements(row(id)).find(node => node.className === 'close-dialog-step-pill');
    const summary = id => dialogElements(row(id)).find(node => node.className === 'close-dialog-step-result');
    assertEqual(pill('a').textContent, 'erledigt', 'Erledigter Schritt besitzt Zustandspille');
    assertEqual(pill('b').textContent, 'offen', 'Aktueller unerledigter Schritt besitzt offene Pille');
    h.activate('b');
    assert(!summary('a').hidden && summary('b').hidden, 'Zusammenfassung sichtbar ausschließlich bei eingeklappter Karte');
    h.activate('a'); assertEqual(row('a').children[0].getAttribute('aria-expanded'), 'true', 'Erledigter Schritt lässt sich mit korrektem ARIA wieder öffnen');
    assert(summary('a').hidden && !summary('b').hidden, 'Wiederöffnung wechselt die sichtbare Ergebnisfläche');
    h.activate('b'); const input = f.doc.createElement('input'); bodies[1].append(input); input.focus();
    h.updateSteps(steps.map(step => ({ ...step, done: step.id !== 'c' })));
    assertEqual(row('b').children[0].getAttribute('aria-expanded'), 'true', 'Hintergrundbereitschaft erhält die geöffnete Eingabe');
    assert(f.doc.activeElement === input, 'Hintergrundbereitschaft erhält Eingabefokus');
    assertEqual(f.doc.getElementById('statesSubtitle').textContent, 'A + B · 2 von 3 Schritten angesehen', 'Fortschritt folgt dem nächsten offenen Schritt');
    h.setBusy(true); h.activate('a'); assertEqual(row('b').children[0].getAttribute('aria-expanded'), 'true', 'Busy sperrt auch programmatische Aktivierung');
    h.setBusy(false); h.close(false);
}

{
    const f = createDialogFixture(); let release, called = 0;
    const h = createCloseDialog({ doc: f.doc, id: 'messageClose', title: 'Vorprüfung',
        onClose: () => new Promise(resolve => { release = resolve; }) });
    h.setMessage('Jahr wählen', { kind: 'hint', action: { label: 'Ausgaben öffnen', onActivate: async isCurrent => {
        if (await h.requestClose() && isCurrent()) called++;
    } } });
    const action = f.doc.querySelector('[data-close-dialog-message-action]');
    assertEqual(action.getAttribute('aria-describedby'), 'messageCloseMessage', 'Dialogaktion beschreibt ihren konkreten Hinweis');
    h.setStatus('Fortschritt'); h.setResult(f.doc.createElement('section'));
    assertEqual(f.doc.getElementById('messageCloseMessage').textContent, 'Jahr wählen', 'Fortschritt und Ergebnis erhalten konkrete Meldung');
    h.setBusy(true); await action.fire('click'); assertEqual(called, 0, 'Busy sperrt Meldungsaktion'); h.setBusy(false);
    let clicking = action.fire('click'); await action.fire('click'); release(false); await clicking;
    assert(h.root.open && called === 0, 'Abgelehnter Guard erhält Hinweis ohne Folgeaktion');
    clicking = action.fire('click');
    h.setMessage('Neue technische Meldung'); release(true); await clicking;
    assertEqual(called, 0, 'Ersetzte Aktion während Schließrückfrage bleibt wirkungslos');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Auch Meldungslistener werden beim Schließen entfernt');
    await action.fire('click'); assertEqual(called, 0, 'Entfernter alter Knopf hat keinen Listener');
}

{
    const f = createDialogFixture();
    const steps = ['prices', 'expenses', 'budget', 'cash', 'market', 'preview', 'month'].map(id => ({ id, title: id,
        prepared: id !== 'cash', done: id !== 'cash', locked: id === 'month', awaitingYear: id === 'month', content: f.doc.createElement('p') }));
    const h = createCloseDialog({ doc: f.doc, id: 'visits', title: 'Jahr', progressNames: 'A + B', steps });
    assert(h.hasVisited('prices') && h.firstUnvisited().id === 'expenses', 'Vorbereitete Daten überspringen den initialen Inhalt nicht');
    // Das DOM-Doppel unterstützt keine zusammengesetzten Selektoren.
    const state = id => f.doc.querySelector(`[data-close-dialog-step="${id}"]`).querySelector('.close-dialog-step-pill').textContent;
    assertEqual(state('prices'), 'geprüft', 'Sichtbarer vorbereiteter Kursstand ist geprüft');
    assertEqual(state('market'), 'bereit', 'Verborgene Marktdaten sind lediglich bereit');
    h.updateSteps(steps); assert(!h.hasVisited('market'), 'Hintergrundupdate markiert keine Marktdatenbesuche');
    for (const id of ['expenses', 'budget', 'cash', 'market', 'preview']) h.activate(id);
    assert(!h.firstUnvisited() && !h.hasVisited('month'), 'Alle sechs Vorbereitungsschritte genügen ohne gesperrten Ergebnisbesuch');
    assertEqual(f.doc.getElementById('visitsSubtitle').textContent, 'A + B · 6 von 6 Schritten angesehen', 'Jahreszähler schließt Ergebnisbereich aus');
    h.activate('month'); assert(!h.hasVisited('month'), 'Gesperrter Ergebnisbereich kann keinen Besuch erhalten');
    h.close(false);
}

}
