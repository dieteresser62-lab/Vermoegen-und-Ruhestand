import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { runStartupPriceRefresh } from '../app/tranches/tranchen-startup-prices.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { fetchHistoryChart } from '../app/tranches/tranchen-history-fetch.js';
import { syntheticDay } from '../app/shared/probelauf-prices.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import fs from 'node:fs';
import { bindOverviewBackupTargets } from '../app/overview/overview-renderer.js';
import { bindProbelaufUI, renderProbelaufUI, requestProbelaufDate, requestProbelaufEnd } from '../app/shared/probelauf-ui.js';
import { createNavigationOperationLifecycle, createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createProbelaufController, PROBELAUF_SESSION_KEYS } from '../app/shared/probelauf-state.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate, getAppTestDate, localCalendarDate } from '../app/shared/app-clock.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, DEFAULT_MUSTER_HAUSHALT, HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { PROBELAUF_PRICE_LABEL, PROBELAUF_PRICE_EXPLANATION, renderProbelaufPriceInfo } from '../app/shared/probelauf-price-ui.js';
import { renderManagerQuoteContext } from '../app/tranches/tranchen-manager-renderer.js';
import { buildProbelaufEndReview, calculateProbelaufEndReview } from '../app/shared/probelauf-comparison.js';
import { probelaufDomainChecksum, projectProbelaufDomain } from '../app/shared/probelauf-records.js';
import { showProbelaufTransferred } from '../app/shared/probelauf-end-dialog.js';

function documentDouble() {
    const nodes = [];
    const doc = { activeElement: null, defaultView: { confirm: () => true }, addEventListener() {},
        createElement(tag) { const node = new Node(tag); nodes.push(node); return node; },
        getElementById(id) { return nodes.find(node => node.id === id) || null; },
        querySelectorAll(selector) { return nodes.filter(node => selector === '[data-probelauf-action]' && node.dataset.probelaufAction); } };
    class Node {
        constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = {}; this.hidden = true; }
        setAttribute(key, value) { this.attributes[key] = value; }
        getAttribute(key) { return this.attributes[key] ?? null; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        insertBefore(child, before) { child.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; return child; }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        replaceChildren(...children) { [...this.children].forEach(child => child.remove()); this.append(...children); }
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
    assertEqual(env.doc.getElementById('managerQuoteContext').textContent, real, 'Außerhalb des Spielbereichs bleibt der Kursstand unverändert');
    controller.state = { phase: 'active', source: 'copy', testDate: null };
    renderProbelaufUI(env.doc, controller);
    assertEqual(env.doc.getElementById('managerQuoteContext').textContent, real, 'Stand heute behält echte Kursanzeige');
    assertEqual(env.doc.getElementById('probelaufBandText').textContent, 'Spielbereich · echte Kurse von heute', 'Kurzes Band für Stand heute');
    assert(env.doc.getElementById('probelaufBandInfo').children[1].textContent.includes('Alle gespeicherten Abrufe bleiben im Spielbereich'), 'Banddetails erklären isolierte echte Abrufe');
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
    assertEqual(report.textContent, 'Kurse aktualisiert · 1 von 1 · heute 21:05', 'Nach Spielbereich bleibt der ursprüngliche Kursbericht erhalten');
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
        assert(host.hidden, label + ': außerhalb des Spielbereichs kein zusätzlicher Hinweis');
    }
    try {
        setAppTestDate('2026-10-13'); renderProbelaufPriceInfo(env.doc);
        for (const host of infos) {
            assert(!host.hidden, 'Spielbereich zeigt vorhandenes ⓘ-Muster');
            assertEqual(host.children[1].textContent, PROBELAUF_PRICE_EXPLANATION, 'Kopf und Karte erklären dieselben Testkurse und Daten');
            host.children[0].fire('click'); assertEqual(host.dataset.visible, 'true', 'Maus öffnet Erklärung');
            host.fire('keydown', { key: 'Escape' }); assertEqual(host.dataset.visible, 'false', 'Escape schließt Erklärung');
            host.fire('focusin'); assertEqual(host.dataset.visible, 'true', 'Tastaturfokus öffnet Erklärung');
        }
    } finally { setAppTestDate(previousDate); }
    renderProbelaufPriceInfo(env.doc);
    assert(infos.every(host => host.hidden), 'Nach Spielbereich verschwinden beide zusätzlichen ⓘ-Hinweise');
}
for (const page of ['Ausgaben.html', 'index.html', 'Balance.html', 'Simulator.html', 'Handbuch.html', 'depot-tranchen-manager.html', 'Daten-Sicherung.html']) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assertEqual((html.match(/id="probelaufBand"/g) || []).length, 1, `${page}: genau ein Bandhost`);
    assert(/id="probelaufBand"[^>]*hidden/.test(html), `${page}: Band anfangs verborgen`);
    for (const action of ['day', 'month', 'date', 'end']) assert(html.includes(`data-probelauf-action="${action}"`), `${page}: Aktion ${action}`);
}
assert(fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8').includes('Im Spielbereich ausprobieren'), 'Handbuch beschreibt den allgemeinen Spielbereich');
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
assertEqual(env.doc.getElementById('probelaufBandText').textContent, 'Spielbereich · Testdatum 31.01.2027 · Spielkurse', 'Bandtext mit lokalem Datum');
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
    const buttons = env.nodes.filter(node => node.tagName === 'button' && ['Abbrechen', 'Spielbereich starten'].includes(node.textContent));
    const mode = env.nodes.find(node => node.attributes['aria-label'] === 'Spielkurse');
    assert(env.nodes.find(node => node.attributes['aria-label'] === 'Echte Kurse von heute').checked, 'Stand heute ist Standard');
    assert(input.disabled && !input.required, 'Testdatum ist freiwillig');
    mode.fire('change'); input.focus();
    assert(!input.disabled && input.required, 'Gewähltes Testdatum wird validiert');
    assert(dialog.attributes['aria-labelledby'], 'Dialog besitzt zugänglichen Namen');
    assert(!env.nodes.some(node => node.textContent?.includes('mit Muster-Haushalt')), 'Kein bedienbares Muster ohne Loader');
    dialog.fire('keydown', { key: 'Tab' }); assertEqual(env.doc.activeElement, env.nodes.find(node => node.attributes['aria-label'] === 'Echte Kurse von heute'), 'Kopie überspringt den ausgeblendeten Handbuchknopf');
    if (action === 'enter') { input.value = '2027-01-30'; input.focus(); dialog.fire('keydown', { key: 'Enter' }); }
    else if (action === 'accept') {
        input.value = '2027-02-29'; buttons[1].fire('click'); assert(dialog.open, 'Ungültiges Datum bleibt im Dialog');
        input.value = '2027-01-30'; buttons[1].fire('click');
    } else if (action === 'cancel') buttons[0].fire('click');
    else if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
    else dialog.fire(action === 'native-cancel' ? 'cancel' : 'close');
    const result = await pending;
    assertEqual(result?.testDate ?? null, ['accept', 'enter'].includes(action) ? '2027-01-30' : null, `${action}: Auswahl/Abbruch korrekt`);
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
    assert(env.nodes.some(node => node.textContent === 'Spielbereich beenden'), 'Enderückfrage benennt Beenden');
    assertEqual(button.textContent, accept ? 'Verwerfen' : 'Weiter spielen', 'Enderückfrage benennt die Handlung');
    const transfer = env.nodes.find(node => node.textContent === 'Übernehmen …');
    assert(!transfer, 'Ohne Startbeleg gibt es keinen Übernehmen-Knopf');
    assert(!env.nodes.find(node => node.tagName === 'details').open, 'Änderungsübersicht bleibt anfangs zugeklappt');
    button.fire('click');
    assertEqual(await pending, accept, 'Enderückfrage respektiert Zustimmung und Abbruch');
    assert(!dialog.parentNode, 'Enderückfrage entfernt Dialog');
}
// Der alte Rückkehrfall verspricht erst nach erfolgreicher Ablösung unveränderte echte Daten.
for (const reason of ['eligible', 'date', 'demo', 'real-changed']) {
    const env = documentDouble();
    const state = { source: reason === 'demo' ? 'demo' : 'copy', testDate: reason === 'date' ? '2027-01-02' : null,
        hasDateJump: reason === 'date', startedAt: '2026-10-15T08:40:00Z',
        realDomainChecksum: reason === 'real-changed' ? 'a'.repeat(64) : probelaufDomainChecksum({}) };
    const review = buildProbelaufEndReview({ state, realRecords: {}, playRecords: {}, now: new Date('2026-10-15T10:00:00Z') });
    review.madeChanges = { planChangeCount: 3, closes: ['Oktober bis Dezember 2026', 'Jahr 2026'] };
    let reads = 0;
    const pending = requestProbelaufEnd({ doc: env.doc, state, loadReview: () => { reads++; return review; } });
    await drainUntil(() => env.dialog()?.dataset.comparisonStatus === 'ready', 'Vergleich geladen');
    assertEqual(reads, 1, `${reason}: genau ein lesender Vergleichszugang`);
    const transfer = env.nodes.find(node => node.textContent === 'Übernehmen …');
    const comparison = !['date', 'demo'].includes(reason);
    if (reason === 'eligible') assert(transfer && !transfer.disabled, 'Übernehmbare Kopie bietet Übernehmen');
    else assert(!transfer, `${reason}: kein Übernehmen-Knopf`);
    const table = env.dialog().children[1].children.find(node => node.tagName === 'table');
    if (comparison) {
        assert(env.nodes.some(node => node.textContent?.includes('gestartet') && node.textContent.includes(new Date(state.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))), `${reason}: Kopf nennt Startzeit`);
        assertEqual(table.children[1].children.length, 4, `${reason}: alle vier Vergleichszeilen`);
        assert(env.nodes.some(node => node.textContent === 'Deine Änderungen'), `${reason}: Änderungsübersicht bleibt`);
    } else {
        assert(!table && !env.nodes.some(node => node.textContent === 'Deine Änderungen'), `${reason}: weder Vergleich noch Deine Änderungen`);
        assert(env.nodes.some(node => node.textContent === 'Spielbereich beenden?'), `${reason}: kurzer Bestätigungstitel`);
        assert(env.nodes.some(node => node.textContent === 'Alles im Spielbereich wird verworfen. Deine Daten bleiben unverändert.'), `${reason}: erklärt Verwerfen und unveränderte Daten`);
        assertEqual(env.dialog().children[2].children[0].children.map(n => n.textContent).join(','), 'Weiter spielen,Spielbereich beenden', `${reason}: genau die beiden vorgesehenen Knöpfe`);
    }
    if (reason !== 'eligible') assert(env.nodes.some(node => node.textContent === 'Im Spielbereich gemacht'), `${reason}: Zusammenfassung der Spielsitzung`);
    if (reason !== 'eligible') assert(env.nodes.some(node => node.textContent === 'Oktober bis Dezember 2026 · Jahr 2026'), `${reason}: lesbare Abschlusszusammenfassung`);
    if (reason === 'real-changed') {
        assert(env.nodes.some(node => node.textContent?.includes('seit dem Start des Spielbereichs geändert')), 'Fremdwrite steht mit Grund über dem Vergleich');
        assertEqual(env.dialog().children[1].children[0].className, 'probelauf-end-warning', 'Sperrgrund steht oben');
    }
    env.nodes.find(node => node.dataset.pageChoiceCancel === '').fire('click');
    assertEqual(await pending, false, `${reason}: Weiter spielen schließt ohne Bereichswechsel`);
}
{
    const env = documentDouble(), records = createMusterHaushaltRecords('2026-10-15'), play = { ...records,
        profile_gold_aktiv: 'true', profile_gold_ziel_pct: '10', profile_tagesgeld: '20000' };
    const plan = JSON.parse(play.household_plan_v1); Object.values(plan.entries)[0].values.flexBedarf = 32000; play.household_plan_v1 = JSON.stringify(plan);
    const review = await calculateProbelaufEndReview({ realRecords: records, playRecords: play, now: new Date('2026-10-15T10:00:00Z') });
    review.play.fixedPlan = { monthlyBudget: 5000, liquidityBefore: 77, committedAt: '2026-01-02T12:00:00Z',
        action: { type: 'NONE', title: 'Nichts tun' } };
    let complete;
    const loaded = new Promise(resolve => complete = resolve);
    const pending = requestProbelaufEnd({ doc: env.doc, loadReview: () => loaded });
    assert(env.dialog().open, 'Dialog öffnet vor der Rechnung');
    assertEqual(env.dialog().dataset.comparisonStatus, 'pending', 'Ladezustand ist am offenen Dialog erkennbar');
    assert(env.nodes.some(n => n.textContent === 'wird gerechnet …'), 'Vergleichswerte zeigen wird gerechnet');
    assert(!env.nodes.find(n => n.dataset.pageChoiceCancel === '').disabled, 'Weiter spielen bleibt während der Rechnung bedienbar');
    complete(review);
    await drainUntil(() => env.dialog().dataset.comparisonStatus === 'ready', 'Frische Vorschau im Dialog');
    assert(env.nodes.some(n => n.textContent === 'Monatsbudget (Vorschau heute) 2026'), 'Budgetzeile nennt Vorschau heute');
    assert(env.nodes.some(n => n.textContent?.includes('100,00') && n.textContent.includes('mehr')), 'Dialog zeigt die frische Budgetdifferenz');
    assert(env.nodes.some(n => n.textContent?.includes('Gold kaufen') && n.textContent.includes('40.000')), 'Dialog zeigt Gold-Handlungsanweisung mit Betrag ohne Balancebesuch');
    assert(env.nodes.some(n => n.className === 'ds-info-pop' && n.textContent.includes('festgeschrieben') && n.textContent.includes('5.000')), 'Abweichender festgeschriebener Plan steht im Info-Popover');
    assert(env.nodes.some(n => n.textContent === 'Liquidität (Vorschau heute)'), 'Liquidität benennt ihren Bezug');
    env.nodes.find(n => n.dataset.pageChoiceCancel === '').fire('click'); await pending;
}
for (const earlyClose of [false, true]) {
    const env = documentDouble(); let fail;
    const loaded = new Promise((resolve, reject) => { fail = reject; });
    const pending = requestProbelaufEnd({ doc: env.doc, loadReview: () => loaded });
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = env.dialog();
    if (earlyClose) env.nodes.find(n => n.dataset.pageChoiceCancel === '').fire('click');
    fail(new Error('Speicher nicht lesbar'));
    if (earlyClose) {
        await pending; await new Promise(resolve => setTimeout(resolve, 0));
        assert(!dialog.parentNode, 'Später Lesefehler öffnet abgebrochenen Dialog nicht erneut');
    } else {
        await drainUntil(() => dialog.dataset.comparisonStatus === 'error', 'Lesefehler angezeigt');
        assert(env.nodes.some(n => n.textContent === 'nicht berechenbar'), 'Lesefehler zeigt nicht berechenbar');
        assert(env.nodes.some(n => n.className === 'ds-info-pop' && n.textContent.includes('Speicher nicht lesbar')), 'Fehlergrund steht im Info-Popover');
        env.nodes.find(n => n.dataset.pageChoiceCancel === '').fire('click'); await pending;
    }
}
{
    const f = await playFixture('tauri', createMusterHaushaltRecords('2026-10-15'));
    let c = await f.boot(); await c.start(() => ({ source: 'copy', testDate: null }));
    let navigations = 0;
    c = await f.boot({ guard: createNavigationGuard(), restoreReload: () => { navigations++; } });
    P.setItemSync('profile_gold_aktiv', 'true'); await P.flush();
    const before = f.realBytes(), env = documentDouble();
    const pending = requestProbelaufEnd({ doc: env.doc, state: c.state, loadReview: () => c.readEndReview() });
    await drainUntil(() => env.dialog()?.dataset.comparisonStatus === 'ready', 'Vergleich geöffnet');
    env.nodes.findLast(n => n.textContent === 'Übernehmen …').fire('click');
    await drainUntil(() => env.nodes.some(n => n.textContent === 'Jetzt übernehmen'), 'Bestätigung geöffnet');
    assert(env.nodes.some(n => n.textContent?.includes('Vor Übernahme aus dem Spielbereich')), 'Bestätigung nennt Wiederherstellungspunkt');
    assert(env.nodes.some(n => n.textContent?.startsWith('Danach ist der Spielbereich geschlossen')), 'Bestätigung erklärt Schließen');
    assert(env.nodes.some(n => n.tagName === 'li' && n.textContent.includes('Gold: aus → an')), 'Bestätigung zeigt vorher und nachher aus Vergleichsbaustein');
    assertEqual(f.realBytes(), before, 'Bestätigungsansicht bleibt vollständig lesend');
    env.nodes.findLast(n => n.textContent === 'Zurück').fire('click');
    await drainUntil(() => env.dialog()?.open && env.dialog().dataset.comparisonStatus === 'ready', 'Zurück zum Vergleich');
    assertEqual(f.realBytes(), before, 'Zurück verändert echte Daten nicht');
    env.nodes.findLast(n => n.textContent === 'Übernehmen …').fire('click');
    await drainUntil(() => env.dialog()?.open && env.dialog().children[0].children.some(n => n.textContent === 'Änderungen übernehmen?'), 'Erneute Bestätigung');
    env.nodes.findLast(n => n.textContent === 'Jetzt übernehmen').fire('click');
    const choice = await pending;
    assertEqual(choice.action, 'transfer', 'Erst Jetzt übernehmen erteilt Übernahmeauftrag');
    const adopting = c.end(() => choice, { onTransferred: result => showProbelaufTransferred({ doc: env.doc, result }) });
    await drainUntil(() => env.nodes.some(n => n.textContent === 'Zur Startseite'), 'Erfolgsansicht geöffnet');
    assertEqual(navigations, 0, 'Erfolg bleibt bis Zur Startseite sichtbar');
    assertEqual(c.state, null, 'Erfolg zeigt geschlossenen Spielbereich');
    assert(env.nodes.some(n => n.textContent === 'Alles übernommen. Der Spielbereich ist geschlossen.'), 'Erfolg bestätigt Speicherung');
    assert(env.nodes.some(n => n.tagName === 'dt' && n.textContent.startsWith('Monatsbudget')), 'Erfolg zeigt Monatsbudget');
    let blocked = false; try { P.setItemSync('profile_tagesgeld', 'bad'); } catch { blocked = true; }
    assert(blocked, 'Alte Seite kann während Erfolgsansicht nicht mehr schreiben');
    env.nodes.findLast(n => n.textContent === 'Zur Startseite').fire('click');
    await adopting; assertEqual(navigations, 1, 'Zur Startseite öffnet Startseite genau einmal');
    await f.boot(); P.resetPersistenceForTests(); setAppTestDate(null);
}
{
    const f = documentDouble();
    renderProbelaufUI(f.doc, { runtime: { canContinue: true }, state: { version: 1, phase: 'active', testDate: '2027-01-02' }, blocked: true });
    const text = f.doc.getElementById('probelaufBandText').textContent;
    assert(text.includes('Rückkehr zum Ausgangsbestand erforderlich') && !text.includes('echte Daten unverändert'), 'Alte Recovery ist vom getrennten Spielbereich unterscheidbar');
}

// Erststart bleibt unabhängig vom Besuchstag beim vollständigen Handbuchbeispiel.
for (const day of ['2026-11-07', '2027-01-01', '2028-06-15']) {
    const restoreClock = installRealClock(day);
    const f = await playFixture('tauri');
    const env = documentDouble(); let loaded = 0, reloads = 0, dialogs = 0, finish;
    const done = new Promise(resolve => finish = resolve);
    const c = await f.boot({ reload() { reloads++; }, demoLoader: async testDate => {
        loaded++; assertEqual(testDate, HANDBOOK_MUSTER_DATE, day + ': Muster wird am Handbuchdatum angelegt');
        return createMusterHaushaltRecords(testDate);
    }, notify(controller, error) {
        renderProbelaufUI(env.doc, controller, error);
        if (loaded && !controller.busy && !controller.waiting) finish();
    } });
    const before = f.realBytes();
    bindProbelaufUI(env.doc, c, { dateDialog: () => { dialogs++; throw new Error('Kein Popup beim Erststart'); } });
    const option = env.doc.getElementById('overviewWelcomeDemo'); option.fire('click'); option.fire('click');
    await done;
    assertEqual(dialogs, 0, 'Erst ausprobieren ohne Eingaben');
    assertEqual(loaded, 1, 'Doppelklick lädt nur einmal');
    assertEqual(reloads, 1, 'Erststart lädt einmal neu');
    assert(f.realBytes() === before, 'Leere echte Begrüßung bleibt bytegleich');
    const active = await f.boot();
    assertEqual(getAppTestDate(), HANDBOOK_MUSTER_DATE, day + ': Erststart verwendet die feste Fachuhr');
    assertEqual(active.state.hasDateJump, true, 'Erststart mit Spielkursen');
    renderProbelaufUI(env.doc, active);
    assert(env.doc.getElementById('probelaufBandText').textContent.includes('Testdatum 23.10.2026 · Spielkurse'), day + ': Band zeigt Testdatum');
    const fetchBefore = globalThis.fetch; let requests = 0;
    globalThis.fetch = () => { requests++; throw new Error('Kein Kursdienst im Test'); };
    try {
        const guard = createNavigationGuard();
        const report = await createNavigationOperationLifecycle({ guard }).run({}, operation => runStartupPriceRefresh({ operation }));
        assertEqual(report.status, 'complete', day + ': Spielkurse ohne Kursdienst');
        const records = P.exportAllSync().records;
        const view = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1),
            activeId: records.rs_current_profile, liveData: records });
        assertEqual(view.household.assets, 790000, day + ': Gesamtvermögen 790.000 € am Testdatum');
        const chart = await fetchHistoryChart('VWRL.DE', [syntheticDay('2026-01-01'), syntheticDay(HANDBOOK_MUSTER_DATE)]);
        assert(chart.closes.length > 0 && view.history.points.length > 0, day + ': Kurs- und Vermögensverlauf gefüllt');
        assertEqual(requests, 0, day + ': keine Kursnetzanfrage');
    } finally { globalThis.fetch = fetchBefore; }

    assertEqual(active.state.source, 'demo', 'Erststart verwendet Max und Erika');
    assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles.muster_a.meta.name, 'Max', 'Musterhaushalt im Spielbereich');
    await active.end(() => true); await f.boot();
    assertEqual(P.getItemSync('rs_profiles_v1'), null, 'Beenden führt zur leeren Begrüßung zurück');
    P.resetPersistenceForTests(); setAppTestDate(null); restoreClock();
}

// Alte Beispielbereiche mit echten Kursen bleiben gültig, einschließlich Neustart und Variante.
{
    const restoreClock = installRealClock('2026-11-07');
    const f = await playFixture('tauri');
    let c = await f.boot();
    const before = f.realBytes();
    await c.start(() => ({ source: 'demo', testDate: null }));
    c = await f.boot();
    const env = documentDouble();
    renderProbelaufUI(env.doc, c);
    assert(env.doc.getElementById('probelaufBandText').textContent.includes('echte Kurse von heute'), 'Altes Beispiel mit null öffnet im bisherigen Kursmodus');
    await c.restart(() => true, { variantId: 'immobilien' });
    c = await f.boot();
    assertEqual(c.state.variantId, 'immobilien', 'Altes Beispiel erlaubt Variantenwechsel');
    assertEqual(c.state.testDate, null, 'Variantenwechsel erhält alten Kursmodus');
    await c.restart(() => true);
    c = await f.boot();
    assertEqual(c.state.testDate, null, 'Neustart erhält alten Kursmodus');
    const review = await c.readEndReview();
    assertEqual(review.transfer.eligible, false, 'Beispiele bleiben unabhängig vom Kursmodus von Übernahme ausgeschlossen');
    await c.end(() => true); await f.boot();
    assertEqual(f.realBytes(), before, 'Altes Beispiel beendet sich ohne Änderung echter Bytes');
    P.resetPersistenceForTests(); setAppTestDate(null); restoreClock();
}

// Befund 1: identische Renderingmatrix vor und nach der Produktkorrektur.
for (const [action, message, phases] of [
    ['start', 'Spielbereich wird gestartet …', ['starting', 'active']],
    ['date', 'Testdatum wird umgestellt …', ['active', 'starting']],
    ['end', 'Spielbereich wird beendet …', ['active', 'restoring']]
]) {
    for (const phase of phases) {
        const f = documentDouble();
        const c = { runtime: { canContinue: true }, state: { phase, testDate: '2027-07-01' },
            busy: true, action, blocked: action === 'end' };
        renderProbelaufUI(f.doc, c);
        const text = f.doc.getElementById('probelaufBandText').textContent;
        assert(text.includes(message), `Befund 1: ${action}/${phase} zeigt eigenen Fortschritt`);
        assert(!text.includes('Bitte Spielbereich beenden'), 'Eigene Arbeit erzeugt keine Recoverywarnung');
        assert(text.includes('01.07.2027') && text.includes('Spielkurse'), 'Fortschritt erhält Datum und Kursmodus');
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
            assert(f.doc.getElementById('probelaufBandText').textContent.includes('Bitte Spielbereich beenden'), 'Zwischenphase ohne eigene Aktion bleibt Recovery');
            const buttons = f.nodes.filter(node => node.dataset.probelaufAction);
            assert(buttons.filter(node => node.dataset.probelaufAction !== 'end').every(node => node.disabled), 'Recovery sperrt Datumssprünge');
            assertEqual(buttons.find(node => node.dataset.probelaufAction === 'end').disabled, busy, 'Recovery erlaubt Beenden außerhalb Busy');
        }
        c.runtime = { canContinue: false, canRecover: false };
        renderProbelaufUI(f.doc, c);
        assert(f.doc.getElementById('probelaufBand').hidden, 'Nicht freigegebene Runtime zeigt auch mit Zwischenphase kein Band');
    }
}

// Beide Quellen nutzen denselben Startdialog; Abbruch legt keinen Spielbereich an.
for (const selectedSource of ['copy', 'demo', 'renate', 'jan-lena']) for (const accepted of [false, true]) {
    const f = await playFixture('tauri', { profile_tagesgeld: '00123' });
    const env = documentDouble(); let finish, open, started = false;
    const done = new Promise(resolve => finish = resolve), opened = new Promise(resolve => open = resolve);
    const c = await f.boot({ notify(controller, error) {
        renderProbelaufUI(env.doc, controller, error);
        if (controller.busy) started = true;
        if (started && !controller.busy && !controller.waiting) finish();
    } });
    const before = f.realBytes();
    bindProbelaufUI(env.doc, c, { dateDialog: context => { const answer = requestProbelaufDate(context); open(); return answer; } });
    env.doc.getElementById('probelaufStart').fire('click'); env.doc.getElementById('probelaufStart').fire('click');
    await opened;
    assertEqual(env.nodes.filter(node => node.tagName === 'dialog').length, 1, 'Ein Dialog bei Doppelklick');
    assert(env.nodes.some(node => node.textContent?.includes('Deine echten Daten bleiben unverändert.')), 'Start erklärt getrennte Daten');
    const cards = env.nodes.filter(node => node.dataset.probelaufSource);
    assertEqual(cards.map(c => c.children[0].textContent).join('|'), ['Kopie meiner Daten', ...MUSTER_HAUSHALTE.map(h => h.name)].join('|'), 'Kopie und sechs Haushalte benannt');
    cards.find(c => c.dataset.probelaufSource === (selectedSource === 'demo' ? DEFAULT_MUSTER_HAUSHALT : selectedSource)).fire('click');
    await drainUntil(() => !env.nodes.find(node => node.tagName === 'button' && node.textContent === 'Spielbereich starten').disabled, 'Steckbrief geladen');
    env.nodes.findLast(node => node.textContent === (accepted ? 'Spielbereich starten' : 'Abbrechen')).fire('click');
    await done;
    assert(f.realBytes() === before, 'Dialog und Start erhalten echte Bytes');
    const active = await f.boot();
    assertEqual(P.getPersistenceStatus().activeArea, accepted ? 'spiel' : 'echt', 'Quelle erst nach Bestätigung aktiv');
    if (accepted && selectedSource === 'copy') assertEqual(P.getItemSync('profile_tagesgeld'), '00123', 'Kopie erhält Rohwert');
    if (accepted && selectedSource !== 'copy') {
        const householdId = selectedSource === 'demo' ? DEFAULT_MUSTER_HAUSHALT : selectedSource;
        const name = MUSTER_HAUSHALTE.find(h => h.id === householdId).name;
        assertEqual(active.state.householdId, householdId, 'Dialogwahl bleibt nach Neustart erhalten');
        renderProbelaufUI(env.doc, active);
        assert(env.doc.getElementById('probelaufBandText').textContent.includes(name), 'Band nennt den gewählten Haushalt');
        assert(env.doc.getElementById('probelaufBandInfo').children[1].textContent.includes(name), 'Bandhinweis nennt den gewählten Haushalt');
        const pending = requestProbelaufEnd({ doc: env.doc, state: active.state });
        assert(env.nodes.some(node => node.className === 'close-dialog-subtitle' && node.textContent === name), 'Ende-Dialog nennt den gewählten Haushalt');
        assert(!env.nodes.some(node => node.parentNode && node.textContent === 'Übernehmen …'), 'Kein Beispielhaushalt ist übernehmbar');
        env.nodes.findLast(node => node.dataset.pageChoiceCancel === '').fire('click'); await pending;
    }
    if (!accepted) assertEqual(f.points.size, 0, 'Abbruch erzeugt keinen Sicherungspunkt');
    P.resetPersistenceForTests(); setAppTestDate(null);
}

// Der Startdialog verwirft keine ausdrückliche Spielkurswahl zugunsten echter Kurse.
for (const source of ['copy', 'max-erika']) for (const startDate of ['2026-10-23', '2026-10-25']) {
    const f = documentDouble(); let settled = false;
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-10-24', starting: true, demoAvailable: true });
    pending.then(() => { settled = true; });
    const input = f.nodes.find(n => n.type === 'date');
    const accept = f.nodes.find(n => n.tagName === 'button' && n.textContent === 'Spielbereich starten');
    f.nodes.find(n => n.dataset.probelaufSource === source).fire('click');
    f.nodes.find(n => n.attributes['aria-label'] === 'Spielkurse').fire('change');
    await drainUntil(() => !accept.disabled, 'Spielkursvorschau geladen');
    assertEqual(input.value, '2026-10-23', 'Vorgabe für Spielkurse bleibt gestern');
    input.value = '2026-10-24'; input.fire('change');
    await drainUntil(() => !accept.disabled, 'Vorschau für heute geladen');
    accept.fire('click'); await Promise.resolve();
    assert(f.dialog().open && !settled, `${source}: kein Start mit Spielkursen und heute`);
    const error = f.nodes.find(n => n.attributes.role === 'alert');
    assert(!error.hidden && error.textContent === (source === 'copy'
        ? 'Heute gibt es nur echte Kurse. Für Spielkurse bitte ein anderes Testdatum wählen, sonst ‚Echte Kurse von heute‘.'
        : 'Für Spielkurse bitte ein anderes Testdatum als heute wählen.'), 'Fehler nennt eine für die Datenquelle verfügbare Kurswahl');
    input.value = startDate; input.fire('change');
    await drainUntil(() => !accept.disabled, 'Vorschau für gewähltes Testdatum geladen');
    accept.fire('click');
    assertEqual((await pending).testDate, startDate, `${source}/${startDate}: Spielkurse starten mit gestern oder morgen`);
}
{
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-10-25', starting: true, demoAvailable: true });
    const input = f.nodes.find(n => n.type === 'date'), button = f.doc.getElementById('probelaufHandbookDate');
    const hint = f.nodes.find(n => n.textContent === 'gleiche Zahlen wie im Handbuch');
    assert(button.hidden && button.disabled && hint.hidden, 'Kopie mit echten Kursen zeigt weder Handbuchknopf noch Hinweis');
    f.nodes.find(n => n.attributes['aria-label'] === 'Spielkurse').fire('change');
    assertEqual(input.value, '2026-10-24', 'Vorgabe bleibt gestern, unabhängig vom Handbuchdatum');
    input.value = HANDBOOK_MUSTER_DATE; input.fire('change');
    assert(button.hidden && button.disabled && hint.hidden, 'Kopie mit Spielkursen und Handbuchdatum zeigt weder Knopf noch Hinweis');
    f.nodes.find(n => n.dataset.probelaufSource === 'max-erika').fire('click');
    const accept = f.nodes.find(n => n.tagName === 'button' && n.textContent === 'Spielbereich starten');
    await drainUntil(() => !accept.disabled, 'Beispiel mit Handbuchdatum geladen');
    assert(!button.hidden && !button.disabled && !hint.hidden, 'Kartenwechsel zum Beispiel zeigt Handbuchknopf und Gleichheitshinweis');
    input.value = '2026-10-24'; input.fire('input');
    assert(hint.hidden, 'Anderes Datum zeigt kein Gleichheitsversprechen');
    button.fire('click');
    assertEqual(input.value, HANDBOOK_MUSTER_DATE, 'Handbuchknopf setzt das zentrale Handbuchdatum');
    assert(!hint.hidden, 'Nur am Handbuchdatum erscheint gleiche Zahlen wie im Handbuch');
    input.value = '2026-10-22'; input.fire('input'); assert(hint.hidden, 'Manuelle Datumseingabe entfernt Gleichheitsversprechen sofort');
    input.value = HANDBOOK_MUSTER_DATE; input.fire('change'); assert(!hint.hidden, 'Auch manuelle Wahl des Handbuchdatums zeigt den Satz');
    const today = f.nodes.find(n => n.attributes['aria-label'] === 'Echte Kurse von heute');
    assert(today.disabled && today.parentNode.hidden && !button.disabled && !hint.hidden, 'Beispiel behält Spielkurse und Handbuchhinweis; echte Kurse sind verborgen');
    f.nodes.find(n => n.dataset.probelaufSource === 'copy').fire('click');
    assert(button.hidden && hint.hidden, 'Kartenwechsel zurück zur Kopie verbirgt Handbuchknopf und Hinweis');
    f.nodes.find(n => n.attributes['aria-label'] === 'Spielkurse').fire('change');
    assert(button.hidden && hint.hidden, 'Kopie behält bei Spielkursen und Handbuchdatum beide Elemente verborgen');
    f.nodes.find(n => n.attributes['aria-label'] === 'Echte Kurse von heute').fire('change');
    accept.fire('click');
    assertEqual((await pending).testDate, null, 'Echte Kurse starten mit Testdatum null');
}

for (const [date, years] of [['2026-10-23', '2027 und 2028'], ['2031-06-15', '2032 und 2033']]) {
    const f = documentDouble(), records = createMusterHaushaltRecords(date, 'max-erika');
    const c = { runtime: { canContinue: true }, state: { version: 2, phase: 'active', source: 'demo',
        householdId: 'max-erika', variantId: 'grund', testDate: date, initialDomain: projectProbelaufDomain(records) } };
    renderProbelaufUI(f.doc, c);
    const panel = f.doc.getElementById('probelaufSteckbriefPanel');
    assert(panel.children.some(n => n.tagName === 'label' && n.children[1].textContent.includes(`die Jahre ${years}`)), `${date}: Bandübung folgt Erikas ursprünglichem Rentenbeginn`);
}

// Karten zeigen aus Records berechnete Steckbriefe und wählen passende Kurse vor.
for (const household of MUSTER_HAUSHALTE) {
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-10-24', starting: true, demoAvailable: true });
    const game = f.nodes.find(n => n.attributes['aria-label'] === 'Spielkurse');
    const today = f.nodes.find(n => n.attributes['aria-label'] === 'Echte Kurse von heute');
    const input = f.nodes.find(n => n.type === 'date');
    const accept = f.nodes.find(n => n.tagName === 'button' && n.textContent === 'Spielbereich starten');
    f.nodes.find(n => n.dataset.probelaufSource === household.id).fire('click');
    await drainUntil(() => !accept.disabled, 'Steckbrief aus Musterdaten geladen');
    const brief = f.nodes.find(n => n.className === 'household-plan-group probelauf-steckbrief').innerHTML;
    assert(brief.includes(household.title) && brief.includes('Beobachte:') && brief.includes('Unverändert neu starten:'), `${household.id}: gewählter Steckbrief sichtbar`);
    assert(game.checked && !input.disabled && input.value === '2026-10-23', 'Beispiel wählt gestern und Spielkurse vor');
    assert(today.disabled && today.parentNode.hidden && !today.checked, 'Beispiel bietet ausschließlich Spielkurse');
    accept.fire('click');
    assertEqual(JSON.stringify(await pending), JSON.stringify({ source: 'demo', householdId: household.id, variantId: 'grund', testDate: '2026-10-23' }), 'Kartenwahl liefert kompatible Quelle, Haushalt und Testdatum');
}

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
    for (let i = 0; i < 1000 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 0));
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
    assert(f.nodes.find(node => node.dataset.probelaufSource === 'copy'), 'Altankerdialog enthält Datenkarte');
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
    assert(header.includes('disabled>Spielbereich starten …</button>'), `${page}: sichtbarer Kopfknopf bis Initialisierung gesperrt`);
    assert(header.indexOf('id="probelaufStart"') > Math.max(header.indexOf('id="suiteProfileContext"'), header.indexOf('id="suiteHouseholdContext"')), `${page}: Start nach Profil-/Haushaltskontext`);
    assertEqual((html.match(/id="probelaufStatus"/g) || []).length, 1, `${page}: ein Live-Statushost`);
    assert(!/<details\b[^>]*>[\s\S]*?id="probelaufStatus"[\s\S]*?<\/details>/.test(html), `${page}: Status außerhalb eingeklappter Container`);
    const f = documentDouble();
    const c = { runtime: { canStart: true, canContinue: true, canRecover: true }, state: null };
    bindProbelaufUI(f.doc, c);
    assert(!f.doc.getElementById('probelaufStart').hidden && !f.doc.getElementById('probelaufStart').disabled, `${page}: Start nach Bindung bereit`);
    c.busy = true; c.action = 'start'; renderProbelaufUI(f.doc, c);
    assertEqual(f.doc.getElementById('probelaufStatus').textContent, 'Spielbereich wird gestartet …', `${page}: sichtbarer Startfortschritt vor Zustand`);
    c.busy = false; c.action = null; renderProbelaufUI(f.doc, c);
    assert(f.doc.getElementById('probelaufStatus').hidden, `${page}: eigener beendeter Fortschritt entfernt`);
    c.waiting = true; renderProbelaufUI(f.doc, c);
    assertEqual(f.doc.getElementById('probelaufStatus').textContent, 'Speichert noch …', `${page}: sichtbare Warteanzeige`);
    c.waiting = false; c.state = { phase: 'active', testDate: '2027-07-01' }; renderProbelaufUI(f.doc, c);
    assert(f.doc.getElementById('probelaufStart').hidden && !f.doc.getElementById('probelaufBand').hidden, `${page}: aktives Band ersetzt Start`);
}

// Der Mittelteil scrollt; Kopf und Aktionsleiste bleiben außerhalb.
{
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-10-24', starting: true, demoAvailable: true });
    const dialog = f.dialog(), body = f.nodes.find(n => n.className === 'probelauf-start-body');
    const footer = f.nodes.find(n => n.className === 'probelauf-start-footer');
    assert(body.parentNode === dialog && footer.parentNode === dialog, 'Aktionsleiste liegt außerhalb des scrollenden Mittelteils');
    assert(dialog.children.indexOf(footer) > dialog.children.indexOf(body), 'Aktionsleiste folgt dem Mittelteil');
    const css = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
    assert(/\.probelauf-start-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/.test(css), 'Nur Mittelteil erhält senkrechten Scrollbereich');
    assert(/\.probelauf-start-dialog\s*\{[^}]*max-height: calc\(100dvh - 2rem\)/.test(css), 'Dialoghöhe folgt dem Fenster');
    f.nodes.find(n => n.textContent === 'Abbrechen').fire('click'); await pending;
}
// Die Kurswahl gehört zur Kopie; Beispielhaushalte bieten ausschließlich Spielkurse.
{
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-11-07', starting: true, demoAvailable: true });
    const today = f.nodes.find(n => n.attributes['aria-label'] === 'Echte Kurse von heute');
    assert(!today.disabled && !today.parentNode.hidden, 'Kopie bietet echte Kurse');
    for (const household of MUSTER_HAUSHALTE) {
        f.nodes.find(n => n.dataset.probelaufSource === household.id).fire('click');
        assert(today.disabled && today.parentNode.hidden, household.id + ': echte Kurse weder angeboten noch fokussierbar');
    }
    f.nodes.find(n => n.dataset.probelaufSource === 'copy').fire('click');
    assert(!today.disabled && !today.parentNode.hidden && today.checked, 'Rückkehr zur Kopie stellt echte Kurse bereit');
    f.nodes.find(n => n.textContent === 'Abbrechen').fire('click'); await pending;
}
// Varianten sind mit Knöpfen wählbar und werden an den Controller weitergegeben.
{
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2026-10-24', starting: true, demoAvailable: true });
    const accept = f.nodes.find(n => n.tagName === 'button' && n.textContent === 'Spielbereich starten');
    f.nodes.find(n => n.dataset.probelaufSource === 'helga-werner').fire('click');
    await drainUntil(() => !accept.disabled, 'Grundfall für Variantenwahl geladen');
    f.nodes.findLast(n => n.dataset.musterVariant === 'haus-pg3').fire('click');
    await drainUntil(() => !accept.disabled, 'Pflegevariante geladen');
    const html = f.nodes.find(n => n.className === 'household-plan-group probelauf-steckbrief').innerHTML;
    assert(html.includes('36.000 € ohne Pflege') && html.includes('18.000 €') && html.includes('Anders als im Grundfall:'), 'Variantensteckbrief folgt den geladenen Werten');
    accept.fire('click');
    assertEqual((await pending).variantId, 'haus-pg3', 'Dialog übergibt gewählte Variante');
    const c = { runtime: { canStart: true, canContinue: true }, state: { version: 2, phase: 'active', source: 'demo', householdId: 'helga-werner', variantId: 'haus-pg3', testDate: '2026-10-23' } };
    renderProbelaufUI(f.doc, c);
    assert(f.doc.getElementById('probelaufBandText').textContent.includes('Helga und Werner · Mit Haus, Werner Pflegegrad 3'), 'Band zeigt Beispiel und Variante');
    const button = f.doc.getElementById('probelaufSteckbrief'), panel = f.doc.getElementById('probelaufSteckbriefPanel');
    button.fire('click'); assert(!panel.hidden, 'Bandknopf öffnet Steckbrief');
    assert(panel.children.some(n => n.textContent === 'Was finanziert die Pflege heute, und wann hilft das Haus?'), 'Band verwendet dieselbe Variantenfrage');
    assert(panel.children.some(n => n.textContent?.includes('gewünschter Bedarf') && n.textContent.includes('„Warum?“')), 'Auch der Band-Steckbrief erklärt die Budgetkürzung der Pflegevariante');
    assertEqual(panel.children.filter(n => n.tagName === 'label').length, 2, 'Zwei abhakbare Übungen');
    c.state = { ...c.state, source: 'copy', householdId: undefined, variantId: undefined };
    renderProbelaufUI(f.doc, c);
    assert(button.hidden && f.doc.getElementById('probelaufRestart').hidden && panel.hidden, 'Kopie zeigt keine Beispielknöpfe und keinen Steckbrief');
}

// NB-1: Grenzen und Feldmeldung im echten Datumsdialog, ohne Dialogschluss.
{
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-30T12:00:00'])); } };
    try {
        const env = documentDouble();
        const pending = requestProbelaufDate({ doc: env.doc, testDate: '2026-10-28' });
        const input = env.nodes.find(node => node.type === 'date');
        assertEqual(input.min, '0001-01-01', 'Datumsdialog erhält bisherige Untergrenze');
        assertEqual(input.max, '2027-10-30', 'Datumsdialog erhält echte Jahresgrenze');
        input.value = '2207-01-02';
        env.nodes.find(node => node.textContent === 'Datum übernehmen').fire('click');
        const error = env.nodes.find(node => node.attributes.role === 'alert');
        assertEqual(error.textContent, 'Bitte ein Datum bis spätestens 30.10.2027 wählen.', '2207 zeigt Feldmeldung im offenen Dialog');
        assert(!error.hidden && env.dialog().open, 'Fehler behält Dialog und Eingabe');
        env.nodes.find(node => node.textContent === 'Abbrechen').fire('click');
        assertEqual(await pending, null, 'Datumsdialog kann nach Fehler abgebrochen werden');
    } finally { globalThis.Date = RealDate; }
}

// NB-1b: Auch die Detailfläche nennt bei unzulässigem Datum keine falsche Untergrenze.
{
    const f = documentDouble();
    const pending = requestProbelaufDate({ doc: f.doc, testDate: '2207-01-02', starting: true, demoAvailable: true });
    const detail = f.nodes.find(n => n.className === 'household-plan-group probelauf-steckbrief');
    f.nodes.find(n => n.dataset.probelaufSource === 'max-erika').fire('click');
    await drainUntil(() => detail.textContent === 'Bitte ein zulässiges Testdatum wählen.', 'Neutrale Datumsmeldung im Steckbrief');
    assertEqual(detail.textContent, 'Bitte ein zulässiges Testdatum wählen.', 'NB-1b: Detailfläche nennt keine irreführende Untergrenze');
    f.nodes.find(n => n.textContent === 'Abbrechen').fire('click'); await pending;
}
