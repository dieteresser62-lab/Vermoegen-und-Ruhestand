import fs from 'node:fs';
import { readSources, validateCompletePresentation } from './designsystem-source-contract.mjs';
import { initSuiteFrame } from '../app/shared/suite-frame.js';
import { resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { whenProfilePageReady, whenProfileDisplayReady } from '../app/profile/profile-navigation.js';

const pageKinds = {
    'Ausgaben.html': 'expenses', 'index.html': 'index', 'Balance.html': 'balance', 'Simulator.html': 'simulator',
    'depot-tranchen-manager.html': 'manager', 'Handbuch.html': 'handbook', 'Daten-Sicherung.html': 'data'
};
const pages = Object.keys(pageKinds);
function replacementErrors(html, page) {
    const errors = [];
    const navigation = html.match(/<nav class="suite-navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    if (!navigation.includes('href="index.html" data-profile-handoff')) errors.push('Rückweg');
    let content = html.split('<main class="suite-content"')[1] || '';
    if (page === 'Balance.html') {
        const adopted = content.match(/<section\b[^>]*aria-labelledby="h-strategy-adopt"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
        const editLink = '<a href="depot-tranchen-manager.html#personen" data-profile-handoff data-profile-handoff-export="false">In Personen &amp; Vermögen ändern</a>';
        if (adopted.split(editLink).length !== 2) errors.push('Profilbearbeitung');
        // Nur der geschützte Bearbeitungsweg in „Übernommen“ ist eine Fachaktion.
        // Weitere Startlinks im Inhalt bleiben doppelte Rahmennavigation.
        content = content.replace(adopted, adopted.replace(editLink, ''));
    }
    if (page === 'Balance.html' || page === 'Simulator.html') {
        if (/<a\b[^>]*href="index.html"/.test(content)) errors.push('Altlink');
        if (!/<a\b[^>]*href="Handbuch.html"[^>]*target="_blank"/.test(content)) errors.push('Hilfe');
    }
    if (page === 'Balance.html') {
        for (const anchor of ['class="app-header balance-head ds-page-head"', 'id="jahresabschlussBtn"', 'id="openDiagnosisBtn"', 'id="print-footer"', 'data-profile-handoff-export="false"']) {
            if (!content.includes(anchor)) errors.push(anchor);
        }
    }
    if (page === 'depot-tranchen-manager.html') {
        const back = navigation.match(/<a\b[^>]*id="managerBackLink"[^>]*>/)?.[0] || '';
        if ((html.match(/id="managerBackLink"/g) || []).length !== 1 || !back.includes('href="index.html" data-profile-handoff')) errors.push('Managerbindung');
        for (const anchor of ['href="Daten-Sicherung.html#fullBackupImportBtn"', 'id="trancheRecoveryActions"']) if (!content.includes(anchor)) errors.push(anchor);
        if (/manager-navigation|manager-back-link/.test(html)) errors.push('Manageraltanteil');
    }
    if (page === 'Handbuch.html') {
        if (/class="(?:navbar|nav-brand|back-link)"|\.(?:navbar|nav-brand|back-link)\b/.test(html)) errors.push('Handbuchaltanteil');
        for (const anchor of ['<h1>Wobei brauchst du Hilfe?</h1>', 'id="inhaltsverzeichnis"', 'id="quickstart"', 'id="manual"', 'id="ueberblick"']) if (!content.includes(anchor)) errors.push(anchor);
    }
    return errors;
}
function frameErrors(html, page) {
    const errors = [];
    const htmlRoot = html.match(/<html\b[^>]*>/)?.[0] || '';
    if (htmlRoot.match(/\bdata-suite-page="([^"]*)"/)?.[1] !== pageKinds[page]) errors.push('Seitenkennung');
    const navigation = html.match(/<nav class="suite-navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    const links = [...navigation.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    if (links.length !== 7) errors.push('Linkzahl');
    for (const target of pages) {
        const link = links.find(([, attrs]) => attrs.includes(`href="${target}"`));
        if (!link || !link[1].includes('data-profile-handoff') || !/<span>[^<]+(?:<small[^>]*>[^<]+<\/small>)?<\/span>/.test(link[2])) errors.push(target);
        if (link && link[1].includes('aria-current="page"') !== (target === page)) errors.push('Aktivzustand');
    }
    const expectedOrder = ['index.html', 'depot-tranchen-manager.html', 'Ausgaben.html', 'Balance.html', 'Simulator.html', 'Handbuch.html', 'Daten-Sicherung.html'];
    if (links.map(([, attrs]) => attrs.match(/href="([^"]+)"/)?.[1]).join(',') !== expectedOrder.join(',')) errors.push('Reihenfolge');
    if (!links.find(([, attrs]) => attrs.includes('href="depot-tranchen-manager.html"') && attrs.includes('data-profile-handoff-export="false"'))) errors.push('Managerexport');
    if (!html.includes('id="suiteNavigationStatus" class="suite-navigation-status" role="alert" hidden')) errors.push('Fehlerhost');
    if (!html.includes('href="#suiteMain"') || !html.includes('id="suiteMain" tabindex="-1"')) errors.push('Sprungziel');
    if (!html.includes('id="suiteProfileContext"') || !html.includes('aria-live="polite" hidden></span>')) errors.push('Profilanzeige');
    const header = html.match(/<header class="suite-header">([\s\S]*?)<\/header>/)?.[1] || '';
    const start = header.match(/<button\b[^>]*id="probelaufStart"[^>]*>Spielbereich starten …<\/button>/)?.[0];
    if (!start || !start.includes('disabled') || !start.includes('aria-describedby="probelaufStatus"')
        || (html.match(/id="probelaufStart"/g) || []).length !== 1
        || header.indexOf('id="probelaufStart"') < Math.max(header.indexOf('id="suiteProfileContext"'), header.indexOf('id="suiteHouseholdContext"'))) errors.push('Probelaufkopf');
    if ((html.match(/id="probelaufStatus"/g) || []).length !== 1 || !html.includes('id="probelaufStatus" class="suite-probelauf-status" role="status" aria-live="polite" hidden')) errors.push('Probelaufstatus');
    if (!html.includes('id="suiteSidebarToggle"') || !html.includes('aria-controls="suiteNavigation"')) errors.push('Leistentaste');
    if ((html.match(/id="suiteSidebarToggle"/g) || []).length !== 1
        || header.includes('id="suiteSidebarToggle"')
        || !/^\s*<button\b[^>]*id="suiteSidebarToggle"/.test(navigation)) errors.push('Leistenposition');
    if (['Balance.html', 'Simulator.html'].includes(page) !== html.includes('id="suiteHouseholdContext"')) errors.push('Haushaltsanzeige');
    return errors;
}
for (const page of pages) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assertEqual(frameErrors(html, page).join(','), '', `${page}: statischer Rahmen mit benannten echten Links`);
    assert(frameErrors(html.replace(/(<nav class="suite-navigation"[^>]*>)/, '$1<a href="#">Davor</a>'), page).includes('Leistenposition'), `${page}: Leistenknopf muss direkt über Übersicht stehen`);
    assertEqual(html.includes('src="app/shared/suite-frame.js"'), true, `${page}: gemeinsames Modul angeschlossen`);
    assertEqual(html.includes('href="css/suite-frame.css"'), true, `${page}: lokales Stylesheet angeschlossen`);
    assertEqual(replacementErrors(html, page).join(','), '', `${page}: Endgültige Navigation erhält Hilfe, Fachaktionen und Recovery`);
    if (['Balance.html', 'Simulator.html'].includes(page)) {
        assertEqual(replacementErrors(html.replace('target="_blank"', ''), page).includes('Hilfe'), true, 'Gegenprobe erkennt verlorene Hilfe im neuen Tab');
        assertEqual(replacementErrors(html.replace('<main class="suite-content"', '<main class="suite-content"><a href="index.html">Altlink</a><div'), page).includes('Altlink'), true, 'Gegenprobe erkennt doppelte native Startnavigation');
    }
    if (page === 'Balance.html') {
        const editLink = '<a href="depot-tranchen-manager.html#personen" data-profile-handoff data-profile-handoff-export="false">In Personen &amp; Vermögen ändern</a>';
        assertEqual(replacementErrors(html.replace(editLink, editLink + editLink), page).includes('Profilbearbeitung'), true, 'Gegenprobe erkennt doppelte Profilbearbeitung');
        assertEqual(replacementErrors(html.replace(editLink, editLink.replace(' data-profile-handoff', '')), page).includes('Profilbearbeitung'), true, 'Gegenprobe erkennt ungeschützten Profilbearbeitungsweg');
        assertEqual(replacementErrors(html.replace(editLink, ''), page).includes('Profilbearbeitung'), true, 'Gegenprobe erkennt verlorenen Profilbearbeitungsweg');
        assertEqual(replacementErrors(html.replace(editLink, editLink.replace('In Personen &amp; Vermögen ändern', '')), page).includes('Profilbearbeitung'), true, 'Gegenprobe erkennt verlorenen sichtbaren Namen des Bearbeitungslinks');
    }
    if (page === 'depot-tranchen-manager.html') {
        assertEqual(replacementErrors(html.replace('href="Daten-Sicherung.html#fullBackupImportBtn"', 'href="index.html#fullBackupImportBtn"'), page).includes('href="Daten-Sicherung.html#fullBackupImportBtn"'), true, 'Gegenprobe erkennt das veraltete Recoveryziel auf der Startseite');
        assertEqual(replacementErrors(html.replace('id="managerBackLink"', ''), page).includes('Managerbindung'), true, 'Gegenprobe erkennt abgetrennte Manager-Profilbindung');
        const backLink = html.match(/<a\b[^>]*\bid="managerBackLink"[^>]*>[\s\S]*?<\/a>/)?.[0];
        assert(backLink, 'Gegenprobe findet den tatsächlichen Manager-Rücklink als Mutationsanker');
        const duplicateBackLinkHtml = html.replace(backLink, `${backLink}${backLink}`);
        assertEqual((duplicateBackLinkHtml.match(/id="managerBackLink"/g) || []).length, 2, 'Gegenprobe erzeugt tatsächlich zwei Manager-IDs');
        assertEqual(replacementErrors(duplicateBackLinkHtml, page).includes('Managerbindung'), true, 'Gegenprobe erkennt doppelte Manager-ID');
    }
    assert(frameErrors(html.replace('id="probelaufStart"', 'id="fehlenderStart"'), page).includes('Probelaufkopf'), 'Gegenprobe erkennt verlorenen Kopfstart');
    assert(frameErrors(html.replace('</header>', '<button id="probelaufStart">Doppelt</button></header>'), page).includes('Probelaufkopf'), 'Gegenprobe erkennt doppelten Kopfstart');
    assert(frameErrors(html.replace('id="probelaufStatus"', 'id="fehlenderStatus"'), page).includes('Probelaufstatus'), 'Gegenprobe erkennt verlorenen sichtbaren Statushost');
    const pageAttribute = ` data-suite-page="${pageKinds[page]}"`;
    assertEqual(frameErrors(html.replace(pageAttribute, ''), page).join(','), 'Seitenkennung', `${page}: Gegenprobe erkennt fehlende Seitenkennung`);
    assertEqual(frameErrors(html.replace(pageAttribute, ' data-suite-page="falsch"'), page).join(','), 'Seitenkennung', `${page}: Gegenprobe erkennt falsche Seitenkennung`);
    const nav = html.match(/<nav class="suite-navigation"[^>]*>[\s\S]*?<\/nav>/)[0];
    assertEqual(frameErrors(html.replace(nav, nav.replace(' data-profile-handoff-export="false"', '')), page).length > 0, true, 'Gegenprobe: fehlender Managerexportverzicht wird erkannt');
    assertEqual(frameErrors(html.replace(nav, nav.replace('aria-current="page"', '')), page).length > 0, true, 'Gegenprobe: falscher Aktivzustand wird erkannt');
}
const sources = readSources();
assertEqual(validateCompletePresentation(sources).join('\n'), '', 'Rahmenstylesheet besteht die gemeinsame Farb-/Quellenprüfung');
const css = sources['css/suite-frame.css'];
assert(css.includes('.suite-sidebar-toggle { width: 2.5rem; justify-self: center;'), 'Leistenknopf bleibt in offener und kompakter Navigation gleich breit und zentriert');
assertEqual(/!important|overflow-x:\s*(hidden|clip)/.test(css), false, 'Neue Rahmenregeln ohne Prioritätsübersteuerung oder Abschneiden');
assertEqual(css.includes('@media print') && css.includes('.suite-header, .suite-navigation, .suite-skip, .suite-navigation-status { display: none; }'), true, 'Druck blendet ausschließlich den Rahmen aus');
assertEqual(css.includes('container-type: normal'), true, 'Druck hebt Containerzwänge auf');
assertEqual(css.includes('@container suite-shell (width < 82rem)'), true, 'Automatik misst ausschließlich äußeren Container unter 82rem');
assertEqual(css.includes('grid-template-columns: 4rem minmax(0, 1fr)') && css.includes('grid-template-columns: 12rem minmax(0, 1fr)'), true, 'Breitenbudget gibt kompakt acht Rem Hauptinhalt zurück');
assertEqual(sources['css/balance.css'].includes('@container suite-content (max-width: 1250px)'), true, 'Balance misst verfügbaren Inhalt');
assertEqual(sources['depot-tranchen-manager.html'].includes('@container manager (max-width: 980px)'), true, 'Manager misst seinen inneren Container');
assertEqual(sources['simulator.css'].includes('@container simulator-panel (max-width: 1000px)') && sources['simulator.css'].includes('@container simulator-panel (max-width: 899px)'), true, 'Simulator misst betroffene Panels');
assertEqual(sources['Balance.html'].includes('id="print-footer"') && sources['css/balance.css'].includes('.suite-content > :not(.balance-action-dialog) { display: none; }'), true, 'Balance-Druckanker bleiben erhalten');
assertEqual(sources['Simulator.html'].includes('id="monteCarloResults"') && sources['simulator.css'].includes('.mc-view-panel[hidden]'), true, 'Simulator-Druckanker bleiben erhalten');

// Echte Modulbindung mit DOM-Grenzadapter: keine Symbolantwort darf den Binder sperren.
resetPersistenceForTests({ name: 'test', loadAll: async () => ({}), saveBatch: async () => {} });
const events = [], win = { addEventListener: type => events.push(type) };
const managerLabel = { textContent: 'Personen & Vermögen', children: [], appendChild(node) { this.children.push(node); } };
const managerAttributes = new Map([['href', 'depot-tranchen-manager.html']]);
const managerLink = { setAttribute: (name, value) => managerAttributes.set(name, value), querySelector: () => managerLabel };
const backupNavigation = { children: [], querySelector() { return this.children.find(node => node.href === 'Daten-Sicherung.html'); }, appendChild(node) { this.children.push(node); } };
const doc = { documentElement: { dataset: { suitePage: 'handbook' } }, defaultView: win,
    addEventListener: type => events.push(type), contains: () => false,
    createElement: () => ({ textContent: '', dataset: {}, children: [], attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); }, appendChild(node) { this.children.push(node); } }),
    getElementById: id => id === 'suiteNavigation' ? backupNavigation : null, querySelectorAll: selector => selector === 'a[href="depot-tranchen-manager.html"]' ? [managerLink] : [{ dataset: { suiteIcon: 'nicht-erlaubt' } }] };
assertEqual(initSuiteFrame(doc), true, 'Rahmen installiert tatsächliche Bindung');
assertEqual(managerLabel.textContent, 'Personen & Vermögen', 'Alle Rahmen erhalten den neuen Managernamen');
assertEqual(managerLabel.children.length, 0, 'Laufzeit ergänzt keinen zweiten statischen Untertitel');
assertEqual(managerAttributes.size, 1, 'Laufzeit verändert die statischen Linkattribute nicht');
assertEqual(managerAttributes.get('href'), 'depot-tranchen-manager.html', 'Managerroute bleibt unverändert');
assertEqual(events.join(','), 'pageshow,click', 'Delegierter Klicklistener steht vor Persistenzbereitschaft bereit');
assertEqual(initSuiteFrame(doc), false, 'Rahmenstart ist idempotent');
assertEqual(managerLabel.children.length, 0, 'Wiederholte Rahmeninitialisierung verdoppelt keinen Untertitel');
assertEqual(backupNavigation.children.length, 0, 'Rahmen erzeugt keine zusätzlichen Navigationslinks');
await new Promise(resolve => setTimeout(resolve, 0));
assertEqual(events.join(','), 'pageshow,click,pageshow', 'Symbolfehler verhindert weder Navigation noch BFCachebindung');
resetPersistenceForTests();

// Der echte Modul-Autostart liest die Kennung aus der Balance-Quelle.
const originalDocument = globalThis.document;
try {
    resetPersistenceForTests({ name: 'test', loadAll: async () => ({}), saveBatch: async () => {} });
    const balanceHtml = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
    const balanceEvents = [], listeners = new Map();
    const balanceWin = { addEventListener: type => balanceEvents.push(type) };
    const balanceDoc = {
        documentElement: { dataset: { suitePage: balanceHtml.match(/<html\b[^>]*\bdata-suite-page="([^"]*)"/)?.[1] } },
        readyState: 'loading', defaultView: balanceWin, contains: () => false,
        addEventListener(type, listener) { balanceEvents.push(type); listeners.set(type, listener); },
        getElementById: () => null, querySelectorAll: () => []
    };
    globalThis.document = balanceDoc;
    const balanceFrame = await import('../app/shared/suite-frame.js?balance-autostart');
    assertEqual(balanceEvents.join(','), 'DOMContentLoaded', 'Balance startet den Rahmen automatisch nach DOM-Bereitschaft');
    balanceDoc.readyState = 'interactive';
    listeners.get('DOMContentLoaded')();
    assertEqual(balanceEvents.join(','), 'DOMContentLoaded,pageshow,click', 'Balance-Autostart bindet die Übergabe vor Persistenzbereitschaft');
    await whenProfilePageReady(balanceDoc);
    assertEqual(balanceWin.__rsProfileSubpageLifecycleInitialized, true, 'Balance-Autostart nutzt weiterhin den Unterseiten-Lifecycle');
    assertEqual(['pagehide', 'visibilitychange', 'pageshow'].every(type => balanceEvents.includes(type)), true, 'Balance behält Speicher- und BFCachehooks');
    assertEqual(balanceFrame.initSuiteFrame(balanceDoc), false, 'Automatisch gestarteter Balance-Rahmen bleibt idempotent');
} finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    resetPersistenceForTests();
}

// Reales Rendern wartet auf die abgeschlossene Persistenzinitialisierung.
let release, writes = 0;
const loaded = new Promise(resolve => { release = resolve; });
resetPersistenceForTests({ name: 'verzögert', loadAll: () => loaded, saveBatch: async () => { writes++; } });
const profileHost = { dataset: {}, textContent: '' };
const delayedDoc = { documentElement: { dataset: { suitePage: 'handbook' } },
    defaultView: { addEventListener() {} }, addEventListener() {}, contains: () => false,
    getElementById: id => id === 'suiteProfileContext' ? profileHost : null, querySelectorAll: () => [] };
initSuiteFrame(delayedDoc);
await Promise.resolve();
assertEqual(profileHost.textContent, '', 'Anzeige liest nicht vor Persistenzbereitschaft');
release({ rs_profiles_v1: JSON.stringify({ version: 1, profiles: { b: { meta: { id: 'b', name: 'Bereites B' }, data: {} } } }),
    rs_current_profile: 'b', rs_active_profile: 'b' });
await whenProfileDisplayReady(delayedDoc);
await Promise.resolve();
assertEqual(profileHost.dataset.profileName, 'Bereites B', 'Nach Bereitschaft bleibt die tatsächliche Identität intern lesbar');
assertEqual(profileHost.textContent, '', 'Keine Angabe Aktives Profil im Kopf');
assertEqual(profileHost.hidden, true, 'Der geladene Profilkontext bleibt unsichtbar');
assertEqual(writes, 0, 'Handbuch-Reader und Rendern sichern keinen Snapshot und schreiben nichts');
resetPersistenceForTests();

// Auch bei gültiger Registry bleibt ein fehlgeschlagener Fachbootstrap neutral.
// Die Person ist bereits umgestellt; ausschließlich das beschädigte Gesundheitsbudget
// soll hier den Fachbootstrap-Recovery auslösen, keine vorgelagerte Migration.
resetPersistenceForTests({ name: 'Recovery', loadAll: async () => ({
    rs_profiles_v1: JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Beschädigtes A' }, data: { profile_person_schema_version: '1', profile_health_bucket: '{' } } } }),
    rs_current_profile: 'a', rs_active_profile: 'a'
}), saveBatch: async () => { writes++; } });
const recoveryHost = { dataset: {}, textContent: '' };
const recoveryDoc = { documentElement: { dataset: { suitePage: 'balance' } },
    defaultView: { addEventListener() {} }, addEventListener() {}, contains: () => false,
    getElementById: id => id === 'suiteProfileContext' ? recoveryHost : null, querySelectorAll: () => [] };
initSuiteFrame(recoveryDoc);
assertEqual(await whenProfileDisplayReady(recoveryDoc), false, 'Fehlgeschlagener Profilbootstrap ist keine Identitätsbereitschaft');
await Promise.resolve();
assertEqual(recoveryHost.textContent, 'Profil nicht verfügbar', 'Rahmen überschreibt Recovery nicht mit einem scheinbar aktuellen Profilnamen');
resetPersistenceForTests();

for (const page of pages) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    for (const id of ['navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        assertEqual((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${page}: eindeutiger Schutzdialoganker ${id}`);
    }
    assert(html.includes('<dialog id="navigationGuardDialog"') && html.includes('aria-describedby="navigationGuardDescription"'), 'Statischer benannter nativer Dialog auf jedem Einstieg');
}

const frameCss = fs.readFileSync(new URL('../css/suite-frame.css', import.meta.url), 'utf8');
const bodyRule = frameCss.match(/html\[data-suite-page\] body\s*\{([^}]+)\}/)?.[1] || '';
for (const declaration of ['font-family: var(--font-sans)', 'background: var(--page)', 'color: var(--text-main)']) {
    assert(bodyRule.includes(declaration), 'Gemeinsame Suite-Grundregel: ' + declaration);
}

const navigationRule = frameCss.match(/\.suite-navigation\s*\{([^}]+)\}/)?.[1] || '';
for (const declaration of ['position: sticky', 'align-self: start', 'max-height: calc(100dvh', 'overflow-y: auto']) assert(navigationRule.includes(declaration), 'Seitliche Navigation: ' + declaration);
assert(frameCss.includes('position: static; max-height: none; overflow-y: visible'), 'Oberes schmales Band setzt Sticky und Höhenlimit zurück');

// Aufschubkopf: eigenständiger Zustand und genau ein nativer Wiederholungsbutton.
{
    const { renderSuiteProfile } = await import('../app/shared/suite-frame.js');
    const { completeProfilePageReadiness } = await import('../app/profile/profile-navigation.js');
    let reloads = 0;
    const win = { __personMigrationDeferred: true, addEventListener() {}, location: { reload() { reloads++; } } };
    const host = { dataset: {}, children: [], _text: '',
        set textContent(value) { this._text = value; this.children = []; }, get textContent() { return this._text; },
        appendChild(node) { this.children.push(node); } };
    const doc = { defaultView: win, getElementById: id => id === 'suiteProfileContext' ? host : null,
        addEventListener() {}, removeEventListener() {}, createElement: tag => ({ tagName: tag, dataset: {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } }) };
    resetPersistenceForTests({ name: 'bestätigtes-Profil', loadAll: async () => ({ rs_current_profile: 'a', rs_active_profile: 'a',
        rs_profiles_v1: JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Muster A' }, data: { profile_person_schema_version: '1', profile_aktuelles_alter: '67' } } } }) }), saveBatch: async () => { throw new Error('UNEXPECTED_PERSON_WRITE'); } });
    const { PersistenceFacade } = await import('../app/shared/persistence-facade.js');
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    completeProfilePageReadiness(doc, null, false);
    renderSuiteProfile(doc); renderSuiteProfile(doc);
    assertEqual(host.textContent, 'Umstellung der Personendaten ausstehend', 'Aufschub nennt keine technische Nichtverfügbarkeit');
    assertEqual(host.dataset.profileState, 'deferred', 'Aufschub hat eigenen Kopfzustand');
    assertEqual(host.children.length, 1, 'Wiederholte Kopfprojektion verdoppelt keine Aktion');
    const button = host.children[0];
    assertEqual(button.type, 'button', 'Jetzt übernehmen ist nativ tastaturbedienbar');
    assertEqual(button.textContent, 'Jetzt übernehmen', 'Wiederholungsweg ist verständlich benannt');
    const first = button.handlers.click(); await button.handlers.click(); await first;
    assertEqual(reloads, 1, 'Bestätigter Wiederholungsweg erzeugt genau einen geschützten Neustart');
    assert(win.__personMigrationDeferred, 'Suitekopf gibt den alten Rechner vor Neustart nicht frei');
    renderSuiteProfile(doc, { status: 'unavailable' });
    assertEqual(host.textContent, 'Profil nicht verfügbar', 'Technischer Fehler behält gesperrten Kopfzustand');
    assertEqual(host.children.length, 0, 'Technischer Fehler bietet keine Umstellungsfreigabe');
    resetPersistenceForTests();
}

// Reale Quellnavigation jedes Einstiegs wird vom produktiven Rahmen ergänzt.
for (const page of pages) {
    resetPersistenceForTests({ name: 'navigation-reader', loadAll: async () => ({}), saveBatch: async () => {} });
    const html = fs.readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    const sourceNav = html.match(/<nav class="suite-navigation"[^>]*>([\s\S]*?)<\/nav>/)[1];
    const links = [...sourceNav.matchAll(/<a\b([^>]*)>/g)].map(([, text]) => ({
        href: text.match(/href="([^"]+)"/)[1], attributes: new Map([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] || '']))
    }));
    const nav = { children: links,
        querySelector(selector) { const href = selector.match(/href="([^"]+)"/)?.[1]; return this.children.find(link => link.href === href); },
        appendChild(node) { this.children.push(node); },
        insertBefore(node, next) { this.children.splice(this.children.indexOf(next), 0, node); }
    };
    const subDoc = { documentElement: { dataset: { suitePage: pageKinds[page] } }, defaultView: { addEventListener() {} },
        addEventListener() {}, contains: () => false, querySelectorAll: () => [],
        getElementById: id => id === 'suiteNavigation' ? nav : null,
        createElement: () => ({ children: [], dataset: {}, attributes: new Map(), appendChild(node) { this.children.push(node); }, setAttribute(name, value) { this.attributes.set(name, value); } }) };
    initSuiteFrame(subDoc); initSuiteFrame(subDoc);
    assertEqual(nav.children.map(link => link.href).join(','), 'index.html,depot-tranchen-manager.html,Ausgaben.html,Balance.html,Simulator.html,Handbuch.html,Daten-Sicherung.html', page + ': alle sieben Ziele bleiben nach Rahmenstart in der vorgeschriebenen Reihenfolge');
    assertEqual(nav.children.filter(link => link.attributes.get('aria-current') === 'page').length, 1, page + ': genau ein aktiver Eintrag nach Rahmenstart');
    const target = nav.children.filter(link => link.href === 'Daten-Sicherung.html');
    assertEqual(target.length, 1, page + ': genau ein echter Sicherungslink nach produktiver Initialisierung');
    assertEqual(target[0].attributes.has('data-profile-handoff'), true, page + ': Sicherungsnavigation schützt Profilübergabe');
    assertEqual(target[0].attributes.get('aria-current') === 'page', page === 'Daten-Sicherung.html', page + ': nur Zielseite ist aktiver Sicherungspunkt');
    assertEqual(nav.children.indexOf(target[0]) > nav.children.findIndex(link => link.href === 'Handbuch.html'), true, page + ': Sicherung steht nach Handbuch am Ende');
    await whenProfilePageReady(subDoc);
    resetPersistenceForTests();
}

assert(fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8').includes('data-suite-backup'), 'Sicherungslink hat eigenen stabilen Elementanker');

for (const page of pages) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert(html.match(/<title>(.*?)<\/title>/)?.[1].includes('Vermögen &amp; Ruhestand'), page + ': neuer Name im Seitentitel');
    assert(html.match(/<a class="suite-brand"[^>]*>(.*?)<\/a>/)?.[1].includes('Vermögen &amp; Ruhestand'), page + ': neuer Name im Markenkopf');
    assert(!html.includes('Ruhestand-Suite'), page + ': alter Markenname entfernt');
    assert(!html.match(/<header class="suite-header">([\s\S]*?)<\/header>/)?.[1].includes('Aktives Profil'), page + ': keine Profilangabe im Kopf');
}
const desktopConfig = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
assert(desktopConfig.app.windows.every(win => win.title === 'Vermögen & Ruhestand'), 'Neuer Fenstertitel in Tauri');
assertEqual(desktopConfig.productName, 'Vermögen & Ruhestand Entwicklung', 'Technischer Produktname kennzeichnet die Entwicklung');
