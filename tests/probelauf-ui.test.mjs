import fs from 'node:fs';
import { bindOverviewBackupTargets } from '../app/overview/overview-renderer.js';
import { bindProbelaufUI, renderProbelaufUI, requestProbelaufDate, requestProbelaufEnd } from '../app/shared/probelauf-ui.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createProbelaufController, PROBELAUF_SESSION_KEYS } from '../app/shared/probelauf-state.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate, getAppTestDate, localCalendarDate } from '../app/shared/app-clock.js';
import { loadMusterHaushalt } from '../app/demo/muster-haushalt.js';
import { PROBELAUF_PRICE_LABEL, PROBELAUF_PRICE_EXPLANATION, renderProbelaufPriceInfo } from '../app/shared/probelauf-price-ui.js';
import { renderManagerQuoteContext } from '../app/tranches/tranchen-manager-renderer.js';

function documentDouble() {
    const nodes = [];
    const doc = { activeElement: null, defaultView: { confirm: () => true },
        createElement(tag) { const node = new Node(tag); nodes.push(node); return node; },
        getElementById(id) { return nodes.find(node => node.id === id) || null; },
        querySelectorAll(selector) { return nodes.filter(node => selector === '[data-probelauf-action]' && node.dataset.probelaufAction); } };
    class Node {
        constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = {}; this.hidden = true; }
        setAttribute(key, value) { this.attributes[key] = value; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
        focus() { doc.activeElement = this; }
        addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
        removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
        fire(type, detail = {}) { const event = { currentTarget: this, target: this, preventDefault() {}, stopImmediatePropagation() {}, ...detail }; [...this.listeners.get(type) || []].forEach(fn => fn(event)); }
        closest(selector) { return selector === '[data-probelauf-action]' && this.dataset.probelaufAction ? this : null; }
        showModal() { this.open = true; }
        close() { this.open = false; this.fire('close'); }
    }
    doc.body = doc.createElement('body');
    for (const id of ['probelaufBand', 'probelaufBandText', 'probelaufStart', 'probelaufStatus', 'overviewWelcomeDemo']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
    for (const action of ['day', 'month', 'date', 'end']) { const node = doc.createElement('button'); node.dataset.probelaufAction = action; doc.getElementById('probelaufBand').appendChild(node); }
    return { doc, nodes, dialog: () => nodes.findLast(node => node.tagName === 'dialog') };
}
{
    const env = documentDouble();
    for (const id of ['suiteContext', 'managerQuoteContext', 'managerQuoteDetails']) {
        const host = env.doc.createElement('span'); host.id = id; env.doc.body.appendChild(host);
    }
    const reportHost = env.doc.createElement('div'), report = env.doc.createElement('p');
    reportHost.id = 'startupPriceStatus'; reportHost.querySelector = () => report;
    report.textContent = 'Kurse aktualisiert · 1 von 1 · heute 21:05'; reportHost.appendChild(report);
    let redraw, observations = 0, disconnected = 0;
    env.doc.defaultView.MutationObserver = class {
        constructor(callback) { redraw = callback; }
        observe(host) { assertEqual(host.id, 'suiteContext', 'Nur der vorhandene Kopfkontext wird beobachtet'); observations++; }
        disconnect() { disconnected++; }
    };
    const controller = { runtime: { canStart: true, canContinue: true }, state: null };
    const lots = [{ asOf: Math.floor(Date.now() / 1000), currentPrice: 100 }], before = JSON.stringify(lots);
    renderManagerQuoteContext(env.doc, lots);
    const real = env.doc.getElementById('managerQuoteContext').textContent;
    renderProbelaufUI(env.doc, controller);
    assertEqual(env.doc.getElementById('managerQuoteContext').textContent, real, 'Außerhalb des Probelaufs bleibt der Kursstand unverändert');
    for (const source of ['copy', 'demo']) {
        controller.state = { phase: 'active', source, testDate: '2026-10-13' };
        renderProbelaufUI(env.doc, controller);
        assertEqual(env.doc.getElementById('managerQuoteContext').textContent, PROBELAUF_PRICE_LABEL, source + ': derselbe kurze Testkurshinweis im Manager');
        assertEqual(env.doc.getElementById('managerQuoteDetails').textContent, PROBELAUF_PRICE_EXPLANATION, source + ': vorhandenes ⓘ erklärt Testkurse und Datenherkunft');
        assert(report.textContent.startsWith(PROBELAUF_PRICE_LABEL + ' · ') && report.textContent.includes('1 von 1'), 'Vorhandener Kursbericht kennzeichnet Testkurse und erhält sein Ergebnis');
        renderManagerQuoteContext(env.doc, lots); redraw();
        assertEqual(env.doc.getElementById('managerQuoteContext').textContent, PROBELAUF_PRICE_LABEL, source + ': Kennzeichnung bleibt nach Seitenrenderer erhalten');
    }
    assertEqual(observations, 1, 'Wiederholtes Rendern erzeugt keinen zweiten Beobachter');
    controller.state = null; renderProbelaufUI(env.doc, controller);
    assertEqual(disconnected, 1, 'Beenden entfernt die Probelaufbindung');
    assertEqual(env.doc.getElementById('managerQuoteContext').textContent, real, 'Beenden stellt den echten Kursstand wieder her');
    assertEqual(report.textContent, 'Kurse aktualisiert · 1 von 1 · heute 21:05', 'Nach Probelauf bleibt der ursprüngliche Kursbericht erhalten');
    assertEqual(JSON.stringify(lots), before, 'Gemeinsamer Anzeigeadapter verändert keine Tranchen');
}
{
    const env = documentDouble(), infos = [], previousDate = getAppTestDate();
    const all = env.doc.querySelectorAll;
    env.doc.querySelectorAll = selector => selector === '[data-probelauf-price-info]' || selector === '.ds-info' ? infos : all(selector);
    env.doc.addEventListener = () => {};
    for (const label of ['Kopfzeile', 'Vermögenskarte']) {
        const host = env.doc.createElement('span'), explanation = env.doc.createElement('span'), button = env.doc.createElement('button');
        host.querySelector = selector => selector === '.ds-info-button' ? button : explanation;
        host.append(button, explanation); infos.push(host);
        renderProbelaufPriceInfo(env.doc);
        assert(host.hidden, label + ': außerhalb des Probelaufs kein zusätzlicher Hinweis');
    }
    try {
        setAppTestDate('2026-10-13'); renderProbelaufPriceInfo(env.doc);
        for (const host of infos) {
            assert(!host.hidden, 'Probelauf zeigt vorhandenes ⓘ-Muster');
            assertEqual(host.children[1].textContent, PROBELAUF_PRICE_EXPLANATION, 'Kopf und Karte erklären dieselben Testkurse und Daten');
            host.children[0].fire('click'); assertEqual(host.dataset.visible, 'true', 'Maus öffnet Erklärung');
            host.fire('keydown', { key: 'Escape' }); assertEqual(host.dataset.visible, 'false', 'Escape schließt Erklärung');
            host.fire('focusin'); assertEqual(host.dataset.visible, 'true', 'Tastaturfokus öffnet Erklärung');
        }
    } finally { setAppTestDate(previousDate); }
    renderProbelaufPriceInfo(env.doc);
    assert(infos.every(host => host.hidden), 'Nach Probelauf verschwinden beide zusätzlichen ⓘ-Hinweise');
}
for (const page of ['Ausgaben.html', 'index.html', 'Balance.html', 'Simulator.html', 'Handbuch.html', 'depot-tranchen-manager.html', 'Daten-Sicherung.html']) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assertEqual((html.match(/id="probelaufBand"/g) || []).length, 1, `${page}: genau ein Bandhost`);
    assert(/id="probelaufBand"[^>]*hidden/.test(html), `${page}: Band anfangs verborgen`);
    for (const action of ['day', 'month', 'date', 'end']) assert(html.includes(`data-probelauf-action="${action}"`), `${page}: Aktion ${action}`);
}
assert(fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8').includes('Probelauf – Änderungen ausprobieren'), 'Handbuch beschreibt den allgemeinen Probelauf');
const env = documentDouble();
const calls = [];
const controller = { runtime: { canStart: false, canContinue: false }, state: null, busy: false, blocked: false,
    start: async choose => { calls.push('start'); return choose({ testDate: '2027-01-31' }); },
    changeDate: async date => calls.push(date), end: async confirm => { if (await confirm()) calls.push('end'); } };
renderProbelaufUI(env.doc, controller);
assert(env.doc.getElementById('probelaufStart').disabled && env.doc.getElementById('probelaufBand').hidden, 'Unbekannte Laufzeit sperrt Start und verbirgt Band');
controller.runtime = { canStart: true, canContinue: true };
bindProbelaufUI(env.doc, controller, { dateDialog: async () => null });
assert(!env.doc.getElementById('probelaufStart').disabled, 'Bekannte Laufzeit erlaubt Start');
assertEqual(bindProbelaufUI(env.doc, controller), false, 'Wiederholte Bindung idempotent');
controller.state = { testDate: '2027-01-31', phase: 'active' }; renderProbelaufUI(env.doc, controller);
assertEqual(env.doc.getElementById('probelaufBandText').textContent, 'Probelauf · Testdatum 31.01.2027 · keine echten Daten', 'Bandtext mit lokalem Datum');
assert(!env.doc.getElementById('probelaufBand').hidden, 'Aktiver Lauf zeigt Band');
const button = action => env.nodes.find(node => node.dataset.probelaufAction === action);
env.doc.getElementById('probelaufBand').fire('click', { target: button('day') });
await Promise.resolve(); assert(calls.includes('2027-02-01'), '+1 Tag verwendet Kalenderrechnung');
env.doc.getElementById('probelaufBand').fire('click', { target: button('month') });
await Promise.resolve(); assert(calls.includes('2027-02-28'), '+1 Monat begrenzt Monatsende');
controller.busy = true; renderProbelaufUI(env.doc, controller);
assert(env.nodes.filter(node => node.dataset.probelaufAction).every(node => node.disabled), 'Busy sperrt alle Bandaktionen');
controller.busy = false; controller.blocked = true; renderProbelaufUI(env.doc, controller);
assert(button('day').disabled && !button('end').disabled, 'Recovery erlaubt ausschließlich Beenden');
for (const action of ['accept', 'enter', 'cancel', 'escape', 'close', 'native-cancel']) {
    const env = documentDouble(), opener = env.doc.getElementById('probelaufStart'); opener.focus();
    const pending = requestProbelaufDate({ doc: env.doc, testDate: '2027-01-31', starting: true, opener });
    const dialog = env.dialog(), input = env.nodes.find(node => node.tagName === 'input');
    const buttons = dialog.children.flatMap(node => node.children).filter(node => node.tagName === 'button');
    assertEqual(env.doc.activeElement, input, 'Datumdialog fokussiert Eingabe');
    assert(dialog.attributes['aria-labelledby'], 'Dialog besitzt zugänglichen Namen');
    assert(!env.nodes.some(node => node.textContent?.includes('mit Muster-Haushalt')), 'Kein bedienbares Muster ohne Loader');
    dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, buttons[0], 'Tastaturfokus bleibt im Dialog');
    if (action === 'enter') { input.value = '2027-02-28'; input.focus(); dialog.fire('keydown', { key: 'Enter' }); }
    else if (action === 'accept') {
        input.value = '2027-02-29'; buttons[1].fire('click'); assert(dialog.open, 'Ungültiges Datum bleibt im Dialog');
        input.value = '2027-02-28'; buttons[1].fire('click');
    } else if (action === 'cancel') buttons[0].fire('click');
    else if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
    else dialog.fire(action === 'native-cancel' ? 'cancel' : 'close');
    const result = await pending;
    assertEqual(result?.testDate ?? null, ['accept', 'enter'].includes(action) ? '2027-02-28' : null, `${action}: Auswahl/Abbruch korrekt`);
    assertEqual(env.doc.activeElement, opener, 'Fokus kehrt zum Öffner zurück');
    assert(!dialog.parentNode, 'Dialog entfernt');
}
{
    const env = documentDouble(), create = env.doc.createElement;
    env.doc.createElement = tag => { const node = create(tag); if (tag === 'dialog') node.showModal = () => { throw new Error('Datumdialog nicht verfügbar'); }; return node; };
    let failed = false;
    try { await requestProbelaufDate({ doc: env.doc, testDate: '2027-01-31' }); } catch { failed = true; }
    assert(failed, 'Datumdialogfehler bleibt sichtbarer Fehler statt scheinbarem Abbruch');
}
for (const accept of [false, true]) {
    const env = documentDouble();
    const pending = requestProbelaufEnd({ doc: env.doc });
    const dialog = env.dialog();
    const button = env.nodes.find(node => accept ? node.dataset.pageChoiceAccept === '' : node.dataset.pageChoiceCancel === '');
    assert(env.nodes.some(node => node.textContent === 'Ausgangsbestand wiederherstellen?'), 'Enderückfrage benennt Wiederherstellung');
    assertEqual(button.textContent, accept ? 'Probelauf beenden' : 'Weiter testen', 'Enderückfrage benennt die Handlung');
    button.fire('click');
    assertEqual(await pending, accept, 'Enderückfrage respektiert Zustimmung und Abbruch');
    assert(!dialog.parentNode, 'Enderückfrage entfernt Dialog');
}
// Reale Guard-/Facadeintegration: Dialogabbruch, Commit, Jobs und Reloadschutz.
const values = {}, points = new Map();
const adapter = { name: 'indexeddb', async loadAll() { return { ...values }; }, async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete values[key]); upserts.forEach(([key, value]) => values[key] = value); }, async listSnapshots() { return [...points.values()]; }, async writeSnapshot(snapshot) { points.set(snapshot.id, snapshot); }, async readSnapshot(id) { return points.get(id); } };
P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
const sessions = new Map(PROBELAUF_SESSION_KEYS.map(key => [key, 'old']));
const session = { getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value), removeItem: key => sessions.delete(key) };
const win = { location: { href: 'http://localhost/index.html?probelauf=1' } };
let decision = true, reloads = 0;
const guard = createNavigationGuard({ decide: async () => decision });
let elapsed = 0;
let c = createProbelaufController({ win, guard, session, clock: () => elapsed, wait: async ms => { elapsed += ms; }, reload: () => { reloads++; } }); await c.initialize();
const dirty = guard.register('dirty-dialog', { read: () => ({ phase: 'idle', dirty: true }) });
 decision = false;
 assertEqual((await c.start(() => ({ source: 'copy', testDate: '2027-01-31' }))).status, 'cancelled', 'Abbruch bei dirty-Dialog verändert keine Daten');
 assertEqual(points.size, 0, 'Dirty-Abbruch legt keinen Rückkehrpunkt an');
 dirty.unregister(); decision = true;
const lease = guard.register('commit', { read: () => ({ phase: 'commit' }) });
assertEqual((await c.start(() => ({ source: 'copy', testDate: '2027-01-31' }))).status, 'cancelled', 'Laufender Commit verhindert Start');
assertEqual(points.size, 0, 'Gesperrter Start schreibt keinen Snapshot'); lease.unregister();
assertEqual((await c.start(() => null)).status, 'failed', 'Dialogabbruch ohne Startmutation');
assertEqual(Object.keys(values).length, 0, 'Dialogabbruch verändert keine Fachdaten');
await c.start(() => ({ source: 'copy', testDate: '2027-01-31' }));
assertEqual(reloads, 1, 'Bestätigter Start lädt einmal');
P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
const secondGuard = createNavigationGuard({ decide: async () => decision });
let running = true, ended = false;
secondGuard.register('job', { read: () => ({ phase: running ? 'running' : 'idle' }), cancel: async () => { running = false; ended = true; } });
c = createProbelaufController({ win, guard: secondGuard, session, reload: () => { assert(ended, 'Jobende vor Datumsreload'); throw new Error('Reload fehlgeschlagen'); } }); await c.initialize();
decision = false;
assertEqual((await c.changeDate('2027-02-01')).status, 'cancelled', 'Verweigerter Schutzdialog behält Datum');
assertEqual(getAppTestDate(), '2027-01-31', 'Abbruch behält Uhr');
decision = true;
const changed = await c.changeDate('2027-02-01');
assertEqual(changed.status, 'reload_required', 'Reloadfehler nach Datumssprung sichtbar');
assert(PROBELAUF_SESSION_KEYS.every(key => !sessions.has(key)), 'Datumssprung entfernt Kurs-/History-/Retrykontexte');
let rejected = false; try { P.setItemSync('profile_tagesgeld', 'write'); } catch { rejected = true; }
assert(rejected, 'Altes Dokument bleibt nach Reloadfehler für Writes gesperrt');
P.resetPersistenceForTests(); setAppTestDate(null);

// Erststart nutzt denselben gesicherten Musterstart, ohne den Kopfdialog zu öffnen.
{
    const records = { profile_tagesgeld: '00123' }, archive = new Map();
    const backend = { name: 'indexeddb', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); },
        async listSnapshots() { return [...archive.values()]; },
        async writeSnapshot(point) { archive.set(point.id, structuredClone(point)); },
        async readSnapshot(id) { return structuredClone(archive.get(id)); } };
    P.resetPersistenceForTests(backend); await P.init({ installLifecycleHooks: false });
    const env = documentDouble(); let loaded = 0, reloads = 0, dialogs = 0, finished;
    const done = new Promise(resolve => finished = resolve);
    const today = localCalendarDate();
    const c = createProbelaufController({ win, session: null,
        guard: createNavigationGuard({ decide: async () => { dialogs++; return false; } }),
        reload() { reloads++; }, demoLoader: async options => {
            loaded++;
            assertEqual(options.testDate, today, 'Direkter Musterstart verwendet heutiges Datum der App-Uhr');
            assertEqual([...archive.values()][0]?.records.profile_tagesgeld, '00123', 'Vor Probelauf sichert Ausgangsdaten auch ohne Dialog');
            await loadMusterHaushalt(options);
        }, notify(controller, error) {
            renderProbelaufUI(env.doc, controller, error);
            if (loaded && !controller.busy && !controller.waiting) finished();
        } });
    await c.initialize();
    assert(c.demoAvailable, 'Direktstart und Startdialog verwenden dieselbe Loaderverfügbarkeit');
    bindProbelaufUI(env.doc, c, { dateDialog: async () => { dialogs++; throw new Error('Kein Startdialog beim Erststart'); } });
    const option = env.doc.getElementById('overviewWelcomeDemo'); option.fire('click'); option.fire('click');
    await done;
    assertEqual(dialogs, 0, 'Erststart läuft mit echtem Guard ohne Popup');
    assertEqual(loaded, 1, 'Doppelklick lädt den Muster-Haushalt nur einmal');
    assertEqual(reloads, 1, 'Direktstart nutzt den vorhandenen Reloadweg');
    assertEqual(c.state.source, 'demo', 'Direktstart persistiert vorhandene Musterquelle');
    assertEqual(getAppTestDate(), today, 'Aktiver Musterlauf stellt die App-Uhr auf heute');
    assertEqual(JSON.parse(records.rs_profiles_v1).profiles.muster_a.meta.name, 'Max', 'Direktstart lädt den bestehenden Muster-Haushalt');
    assert(option.hidden, 'Aktiver Probelauf verbirgt die Erststartoption');
    P.resetPersistenceForTests(); setAppTestDate(null);
}

// Befund 1: identische Renderingmatrix vor und nach der Produktkorrektur.
for (const [action, message, phases] of [
    ['start', 'Probelauf wird gestartet …', ['starting', 'active']],
    ['date', 'Testdatum wird umgestellt …', ['active', 'starting']],
    ['end', 'Ausgangsbestand wird wiederhergestellt …', ['active', 'restoring']]
]) {
    for (const phase of phases) {
        const f = documentDouble();
        const c = { runtime: { canContinue: true }, state: { phase, testDate: '2027-07-01' },
            busy: true, action, blocked: action === 'end' };
        renderProbelaufUI(f.doc, c);
        const text = f.doc.getElementById('probelaufBandText').textContent;
        assert(text.includes(message), `Befund 1: ${action}/${phase} zeigt eigenen Fortschritt`);
        assert(!text.includes('Wiederherstellung erforderlich'), 'Eigene Arbeit erzeugt keine Recoverywarnung');
        assert(text.includes('01.07.2027') && text.includes('keine echten Daten'), 'Fortschritt erhält Datum und Testkennzeichnung');
    }
}
for (const phase of ['starting', 'restoring', 'active']) {
    for (const busy of [false, true]) {
        const f = documentDouble();
        const c = { runtime: { canContinue: false, canRecover: true }, state: { phase, testDate: '2027-07-01' },
            busy, action: null, blocked: phase !== 'active' };
        renderProbelaufUI(f.doc, c);
        assertEqual(f.doc.getElementById('probelaufBand').hidden, phase === 'active', 'Recoveryfreigabe zeigt ausschließlich Zwischenphasen');
        if (phase !== 'active') {
            assert(f.doc.getElementById('probelaufBandText').textContent.includes('Wiederherstellung erforderlich'), 'Zwischenphase ohne eigene Aktion bleibt Recovery');
            const buttons = f.nodes.filter(node => node.dataset.probelaufAction);
            assert(buttons.filter(node => node.dataset.probelaufAction !== 'end').every(node => node.disabled), 'Recovery sperrt Datumssprünge');
            assertEqual(buttons.find(node => node.dataset.probelaufAction === 'end').disabled, busy, 'Recovery erlaubt Beenden außerhalb Busy');
        }
        c.runtime = { canContinue: false, canRecover: false };
        renderProbelaufUI(f.doc, c);
        assert(f.doc.getElementById('probelaufBand').hidden, 'Nicht freigegebene Runtime zeigt auch mit Zwischenphase kein Band');
    }
}

// Bedienbare Musterwahl erscheint erst nach dauerhaftem Rückkehrpunkt und Readback.
for (const selectedSource of ['copy', 'demo']) for (const accepted of [false, true]) {
    const records = { profile_tagesgeld: '00123' }, archive = new Map(), events = [];
    const backend = { name: 'indexeddb', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); },
        async listSnapshots() { return [...archive.values()]; },
        async writeSnapshot(point) { events.push('snapshot-write'); archive.set(point.id, structuredClone(point)); },
        async readSnapshot(id) { events.push('snapshot-read'); return structuredClone(archive.get(id)); } };
    P.resetPersistenceForTests(backend); await P.init({ installLifecycleHooks: false });
    const env = documentDouble(); let loaded = 0;
    let finish; const finished = new Promise(resolve => finish = resolve);
    let started = false;
    const c = createProbelaufController({ win, session: null, reload() {}, demoLoader: async options => { loaded++; await loadMusterHaushalt(options); },
        notify(controller, error) { renderProbelaufUI(env.doc, controller, error); if (controller.busy) started = true; if (started && !controller.busy && !controller.waiting) finish(); } });
    await c.initialize();
    assert(!env.nodes.some(node => node.tagName === 'select'), 'Keine Musterwahl vor Sicherung');
    let dialogOpened;
    const opened = new Promise(resolve => dialogOpened = resolve);
    bindProbelaufUI(env.doc, c, { dateDialog: context => {
        assert(events.includes('snapshot-write') && events.includes('snapshot-read'), 'Musterwahl nach dauerhaftem Snapshot und Readback');
        assert([...archive.values()].some(point => point.label === 'Vor Probelauf'), 'Bestätigter Punkt trägt Vor Probelauf');
        const answer = requestProbelaufDate(context); dialogOpened(); return answer;
    } });
    const headStart = env.doc.getElementById('probelaufStart'); headStart.focus();
    headStart.fire('click'); headStart.fire('click');
    await opened;
    assertEqual(env.nodes.filter(node => node.tagName === 'dialog').length, 1, 'Kopfdoppelklick öffnet genau einen echten Dialog');
    const select = env.nodes.find(node => node.tagName === 'select');
    assert(select && select.children.some(option => option.value === 'demo' && option.textContent === 'mit Muster-Haushalt'), 'Bedienbare Musteroption mit verfügbarem Loader');
    select.value = selectedSource;
    env.nodes.find(node => node.tagName === 'input').value = '2027-07-01';
    const actions = env.dialog().children.find(node => node.className === 'ds-actions').children;
    actions[accepted ? 1 : 0].fire('click'); await finished;
    assertEqual(loaded, accepted && selectedSource === 'demo' ? 1 : 0, 'Musterloader nur bei bestätigter Musterwahl');
    assertEqual(env.doc.activeElement, headStart, 'Echter Kopfstartdialog führt Fokus zurück');
    if (accepted && selectedSource === 'demo') assertEqual(JSON.parse(records.rs_profiles_v1).profiles.muster_a.meta.name, 'Max', 'Ausgewählter Loader schreibt validierten Muster-Haushalt');
    if (accepted && selectedSource === 'copy') assertEqual(records.profile_tagesgeld, '00123', 'Kopie behält bestehende Rohdaten');
    if (!accepted) {
        assertEqual(JSON.stringify(records), '{"profile_tagesgeld":"00123"}', 'Dialogabbruch erhält Fachrecords und inaktiven Zustand');
        assertEqual(archive.size, 1, 'Vor Probelauf bleibt nach Dialogabbruch erhalten');
        assertEqual(getAppTestDate(), null, 'Dialogabbruch aktiviert keine Uhr');
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);

// Nur der eigene vorübergehende Hinweis darf beim Wiederholungsversuch verschwinden.
for (const fallback of [false, true]) {
    const f = documentDouble(), status = f.doc.getElementById('probelaufStatus');
    if (fallback) status.id = 'suiteNavigationStatus';
    const c = { runtime: { canContinue: true }, state: { phase: 'active', testDate: '2027-07-01' }, busy: false, blocked: false, action: null };
    const error = new Error('Daten werden gespeichert – bitte gleich erneut versuchen.'); error.code = 'PROBELAUF_COMMIT_BUSY';
    renderProbelaufUI(f.doc, c, error);
    renderProbelaufUI(f.doc, c);
    assertEqual(status.textContent, error.message, 'Neutrales Rendering erhält lesbare Ablehnung');
    c.busy = true; c.action = 'date'; renderProbelaufUI(f.doc, c);
    assertEqual(status.textContent, 'Testdatum wird umgestellt …', 'Eigener Wiederholungsbeginn ersetzt Ablehnung durch Fortschritt');
    assert(!status.hidden, 'Eigener Fortschritt ist sichtbar');
    c.busy = false; c.action = null;
    renderProbelaufUI(f.doc, c, error);
    status.textContent = 'Fremde Statusmeldung'; status.hidden = false;
    c.busy = true; c.action = 'date'; renderProbelaufUI(f.doc, c);
    assertEqual(status.textContent, 'Fremde Statusmeldung', 'Wiederholung erhält inzwischen gesetzte fremde Meldung');
    assertEqual(status.hidden, false, 'Fremde Meldung bleibt sichtbar');
    c.busy = false; c.action = null;
    renderProbelaufUI(f.doc, c, new Error('Anderer Fehler'));
    c.busy = true; c.action = 'date'; renderProbelaufUI(f.doc, c);
    assertEqual(status.textContent, 'Anderer Fehler', 'Andere Fehler werden nicht pauschal gelöscht');
}

async function drainUntil(check, label) {
    for (let i = 0; i < 1000 && !check(); i++) await Promise.resolve();
    assert(check(), label);
}
// Tatsächliche Altankerbindung: Anfrage vor Bereitschaft und spätere Navigation.
for (const initial of [false, true]) {
    const f = documentDouble(), events = {};
    f.doc.defaultView = { location: { hash: initial ? '#probelaufControls' : '' }, addEventListener(type, fn) { events[type] = fn; } };
    let calls = 0, settled = 0;
    const c = { runtime: { canStart: true, canContinue: true, canRecover: true }, state: null,
        start: async choose => { calls++; const choice = await choose({ testDate: '2027-07-01', demoAvailable: true }); settled++; return choice; } };
    bindOverviewBackupTargets(f.doc);
    bindOverviewBackupTargets(f.doc);
    events.hashchange();
    await Promise.resolve();
    assertEqual(calls, 0, 'Altanker wartet auf sichere UI-Bindung');
    bindProbelaufUI(f.doc, c);
    if (!initial) { f.doc.defaultView.location.hash = '#probelaufControls'; events.hashchange(); }
    await drainUntil(() => f.dialog()?.open, 'Altanker öffnet gemeinsamen Dialog nach Bindung');
    assert(f.nodes.find(node => node.tagName === 'select'), 'Altankerdialog enthält beide Quellen');
    events.hashchange(); bindOverviewBackupTargets(f.doc); bindProbelaufUI(f.doc, c);
    // Auch ein erneuter Hashwechsel während des Dialogs teilt die laufende Aktion.
    f.doc.defaultView.location.hash = ''; events.hashchange();
    f.doc.defaultView.location.hash = '#probelaufControls'; events.hashchange();
    assertEqual(calls, 1, 'Wiederholung und offener Dialog erzeugen keinen zweiten Start');
    f.dialog().fire('keydown', { key: 'Escape' });
    await drainUntil(() => settled === 1, 'Altankerdialog lässt sich abbrechen');
    await Promise.resolve(); await Promise.resolve();
    assertEqual(f.doc.activeElement, f.doc.getElementById('probelaufStart'), 'Altanker führt Fokus zum Kopfzugang zurück');
    f.doc.getElementById('probelaufStart').fire('click');
    await drainUntil(() => calls === 2, 'Normaler Kopfstart bleibt nach Altankerabbruch bedienbar');
    f.dialog().fire('cancel'); await drainUntil(() => settled === 2, 'Zweiter Versuch beendet');
}
for (const phase of ['active', 'starting', 'restoring']) {
    const f = documentDouble(); let calls = 0, scrolled = 0;
    f.doc.getElementById('probelaufBand').scrollIntoView = () => scrolled++;
    const c = { state: { phase, testDate: '2027-07-01' }, blocked: phase !== 'active', runtime: { canStart: true, canContinue: true, canRecover: true }, start: () => calls++ };
    bindOverviewBackupTargets(f.doc, { location: { hash: '#probelaufControls' }, addEventListener() {} });
    bindProbelaufUI(f.doc, c);
    assertEqual(calls, 0, 'Aktiver/Recoverylauf startet über Altanker nichts Neues');
    assertEqual(scrolled, 1, 'Altanker führt zum vorhandenen Band');
    assert(f.doc.getElementById('probelaufStart').hidden, 'Vorhandener Zustand ersetzt Kopfknopf durch Band');
}
for (const page of ['Ausgaben.html', 'index.html', 'Balance.html', 'Simulator.html', 'Handbuch.html', 'depot-tranchen-manager.html', 'Daten-Sicherung.html']) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const header = html.match(/<header class="suite-header">([\s\S]*?)<\/header>/)[1];
    assertEqual((html.match(/id="probelaufStart"/g) || []).length, 1, `${page}: genau ein Kopfstart`);
    assert(header.includes('disabled>Probelauf …</button>'), `${page}: sichtbarer Kopfknopf bis Initialisierung gesperrt`);
    assert(header.indexOf('id="probelaufStart"') > Math.max(header.indexOf('id="suiteProfileContext"'), header.indexOf('id="suiteHouseholdContext"')), `${page}: Start nach Profil-/Haushaltskontext`);
    assertEqual((html.match(/id="probelaufStatus"/g) || []).length, 1, `${page}: ein Live-Statushost`);
    assert(!/<details\b[^>]*>[\s\S]*?id="probelaufStatus"[\s\S]*?<\/details>/.test(html), `${page}: Status außerhalb eingeklappter Container`);
    const f = documentDouble();
    const c = { runtime: { canStart: true, canContinue: true, canRecover: true }, state: null };
    bindProbelaufUI(f.doc, c);
    assert(!f.doc.getElementById('probelaufStart').hidden && !f.doc.getElementById('probelaufStart').disabled, `${page}: Start nach Bindung bereit`);
    c.busy = true; c.action = 'start'; renderProbelaufUI(f.doc, c);
    assertEqual(f.doc.getElementById('probelaufStatus').textContent, 'Probelauf wird gestartet …', `${page}: sichtbarer Startfortschritt vor Zustand`);
    c.busy = false; c.action = null; renderProbelaufUI(f.doc, c);
    assert(f.doc.getElementById('probelaufStatus').hidden, `${page}: eigener beendeter Fortschritt entfernt`);
    c.waiting = true; renderProbelaufUI(f.doc, c);
    assertEqual(f.doc.getElementById('probelaufStatus').textContent, 'Speichert noch …', `${page}: sichtbare Warteanzeige`);
    c.waiting = false; c.state = { phase: 'active', testDate: '2027-07-01' }; renderProbelaufUI(f.doc, c);
    assert(f.doc.getElementById('probelaufStart').hidden && !f.doc.getElementById('probelaufBand').hidden, `${page}: aktives Band ersetzt Start`);
}
