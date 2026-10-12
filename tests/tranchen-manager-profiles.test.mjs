import { completePageDialog, respondPageDialog } from './helpers/page-dialog-dom.mjs';
import { applyManagerBirthDate, manageManagerPerson, switchManagerProfile, repairManagerHistory, initTranchenManagerPage, startTranchenManagerPage, selectManagerView, openManagerOverviewTarget, resolveManagerTarget } from '../app/tranches/tranchen-manager-page.js';
import { renderManagerProfiles, getManagerView } from '../app/tranches/tranchen-manager-renderer.js';
import { projectManagerProfiles, syncManagerProfileControls, bindManagerProfileControls } from '../app/tranches/tranchen-manager-profiles.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { buildPlanRecord, planScope, PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createTranchenPageDom, createLocalStorageMock, installGlobals, MockElement, waitFor, addManagerDialogDom } from './tranchen-manager-page.test.mjs';

const savedGlobals = Object.fromEntries(['document', 'window', 'localStorage', 'confirm', 'alert', 'fetch', 'URL', 'Blob'].map(key => [key, globalThis[key]]));
const originalFlush = PersistenceFacade.flush;
const lot = { schemaVersion: 2, trancheId: 'person-a-lot', name: 'Synthetischer Bestand A', shares: 2,
    purchasePrice: 80, currentPrice: 120, ticker: 'TEST.DE', isin: '', purchaseDate: '',
    category: 'equity', type: 'aktien_neu', tqf: 0.3, taxExempt: false, notes: '' };
async function setup({ outside = false, extraData = {} } = {}) {
    const doc = createTranchenPageDom();
    addManagerDialogDom(doc);
    for (const id of ['managerWealthHistory', 'managerWealthTitle', 'managerWealthChart', 'managerWealthContext', 'managerWealthMetrics', 'managerWealthTable', 'managerWealthHint', 'managerWealthLegend', 'managerWealthDailyNote', 'managerWealthStatus', 'managerCaptureWealthBtn']) doc.register(new MockElement(id));
    for (const id of ['managerProfileRecovery', 'suiteProfileContext']) doc.register(new MockElement(id));
    doc.getElementById('managerProfileRecovery').hidden = true;
    for (const id of ['managerBirthSupplement', 'managerBirthDate', 'managerBirthApply', 'managerBirthSuggestion', 'managerBirthError', 'profilePersonDateStatus', 'managerPensionStatus', 'managerPersonSummary', 'managerAssetsSummary', 'managerCareSummary', 'managerCardsToggleAll', ...['Person', 'Assets', 'Care'].flatMap(card => [`manager${card}Toggle`, `manager${card}Body`])]) doc.register(new MockElement(id));
    installGlobals(doc, createLocalStorageMock());
    for (const id of ['navigationGuardDialog', 'navigationGuardStay', 'navigationGuardLeave', 'navigationGuardTitle', 'navigationGuardDescription']) doc.register(new MockElement(id));
    const dialog = doc.getElementById('navigationGuardDialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    for (const el of [dialog, doc.getElementById('navigationGuardStay'), doc.getElementById('navigationGuardLeave'), doc]) {
        el.removeEventListener = (type, fn) => { el.listeners[type] = (el.listeners[type] || []).filter(handler => handler !== fn); };
    }
    const backend = new Map(), holds = [], batches = [];
    let holding = false;
    PersistenceFacade.flush = originalFlush;
    PersistenceFacade.resetPersistenceForTests({
        name: 'synthetic-person-backend', async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch(batch) {
            batches.push(batch);
            if (holding) await new Promise((resolve, reject) => holds.push({ batch, resolve, reject }));
            for (const key of batch.deletes) backend.delete(key);
            for (const [key, value] of batch.upserts) backend.set(key, String(value));
        }
    });
    await PersistenceFacade.init();
    const registry = { version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Person A' }, data: { profile_person_schema_version: '1', depot_tranchen: JSON.stringify([lot]), profile_tagesgeld: '100', profile_aktuelles_alter: '67', ...extraData } },
        b: { meta: { id: 'b', name: 'Person B', belongsToHousehold: !outside }, data: { profile_person_schema_version: '1', depot_tranchen: JSON.stringify([{ ...lot, trancheId: 'person-b-lot', name: 'Synthetischer Bestand B', currentPrice: 90 }]), profile_tagesgeld: '200', profile_aktuelles_alter: '64' } }
    } };
    for (const [key, value] of Object.entries(registry.profiles.a.data)) persistenceStorage.setItem(key, value);
    persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
    const scopes = [...new Map(Object.keys(registry.profiles).map(id => { const scope = registry.profiles[id].meta.belongsToHousehold === false ? planScope('single', [id]) : planScope('household', Object.keys(registry.profiles).filter(member => registry.profiles[member].meta.belongsToHousehold !== false)); return [scope.key, scope]; })).values()];
    persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, scopes.map(scope => ({ scope, values: structuredClone(PLAN_DEFAULTS) }))).raw);
    persistenceStorage.setItem('rs_current_profile', 'a'); persistenceStorage.setItem('rs_active_profile', 'a');
    await originalFlush.call(PersistenceFacade);
    initTranchenManagerPage({ profileId: 'a' });
    return { doc, backend, holds, batches, registry, hold: () => { holding = true; }, release: () => { holding = false; holds.forEach(item => item.resolve()); } };
}
function choose(doc, id, host = 'managerSectionNav') {
    const html = doc.getElementById(host).innerHTML;
    assert(html.includes(`data-manager-profile="${id}"`), 'Zielknopf stammt aus dem tatsächlichen Renderer');
    const button = new MockElement('', 'button'); button.dataset.managerProfile = id;
    button.closest = selector => selector === '[data-manager-profile]' ? button : null;
    return doc.getElementById(host).listeners.click.map(handler => handler({ target: button })).find(Boolean);
}
function chooseHistory(doc, id = null, host = 'managerHistorySwitch') {
    const html = doc.getElementById(host).innerHTML;
    const attribute = host === 'managerHousehold' ? 'data-manager-history-profile' : 'data-manager-profile';
    assert(html.includes(id ? `${attribute}="${id}"` : 'data-manager-history-scope="household"'), 'Verlaufswahl stammt aus dem tatsächlichen Renderer');
    const button = new MockElement('', host === 'managerHousehold' ? 'a' : 'button');
    button.dataset.managerView = 'history';
    button.dataset.managerHistoryScope = id ? 'person' : 'household';
    if (id) button.dataset[host === 'managerHousehold' ? 'managerHistoryProfile' : 'managerProfile'] = id;
    button.closest = selector => selector === '[data-manager-view]' ? button : null;
    return doc.getElementById(host).listeners.click.map(handler => handler({ target: button, preventDefault() {} })).find(Boolean);
}
function input(doc, id, value) {
    const field = doc.getElementById(id); field.value = value;
    return field.listeners.input[0]({ target: field });
}
function answer(doc, leave) {
    return doc.getElementById(leave ? 'navigationGuardLeave' : 'navigationGuardStay').click();
}

console.log('Zugängliche Schalter spiegeln Wertträger und Sperren ohne Nebenwirkungen');
{
    const doc = createTranchenPageDom();
    for (const id of ['profileGoldAktiv', 'profileGoldSteuerfrei', 'profileHealthBucketEnabled']) doc.getElementById(id).value = 'false';
    const field = doc.getElementById('profileGoldAktiv'), toggle = doc.getElementById('profileGoldAktivToggle');
    let changes = 0; field.addEventListener('change', () => changes++);
    bindManagerProfileControls(doc); bindManagerProfileControls(doc);
    assertEqual(changes, 0, 'Initialisierung und Wiederholung lösen keine Saves aus');
    toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    assertEqual(field.value, 'true', 'Schalter schreibt weiterhin den booleschen Stringwert');
    assertEqual(changes, 1, 'Benutzerwechsel dispatcht genau ein vorhandenes Ereignis');
    field.disabled = true; field.value = 'false'; syncManagerProfileControls(doc);
    assert(toggle.disabled && !toggle.checked && doc.getElementById('profileRenteAktiv').disabled, 'Sperre und zurückgeschriebener Wert werden sichtbar gespiegelt; Rente bleibt gesperrt');
    toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    assertEqual(changes, 1, 'Gesperrter Schalter speichert nicht');
    const care = doc.getElementById('profileHealthBucketEnabled'); care.value = 'true'; syncManagerProfileControls(doc);
    assert(!doc.getElementById('managerCareActive').hidden, 'Pflege-Chip folgt ausschließlich aktivierter Reserve');
    care.value = 'false'; syncManagerProfileControls(doc);
    assert(doc.getElementById('managerCareActive').hidden, 'Inaktive Reserve hat keinen aktiv-Chip');
}

try {
    {
        const { doc, registry } = await setup();
        registry.profiles.c = { meta: { id: 'c', name: 'Clara „C“' }, data: { ...registry.profiles.a.data } };
        registry.profiles.outside = { meta: { id: 'outside', name: 'Außen < & >', belongsToHousehold: false }, data: { ...registry.profiles.a.data } };
        registry.profiles = { outside: registry.profiles.outside, a: registry.profiles.a, b: registry.profiles.b, c: registry.profiles.c };
        registry.profiles.a.meta.name = 'Anna & Änne'; registry.profiles.b.meta.name = 'Béla <B>';
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        const scopes = [planScope('household', ['a', 'b', 'c']), planScope('single', ['outside'])];
        persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, scopes.map(scope => ({ scope, values: structuredClone(PLAN_DEFAULTS) }))).raw);
        await originalFlush.call(PersistenceFacade);
        initTranchenManagerPage({ profileId: 'a' });
        const nav = doc.getElementById('managerSectionNav');
        assertEqual(nav.children.map(tab => tab.dataset.managerProfile || tab.dataset.managerView).join(','), 'plan,a,b,c,outside,history', 'Ansichtsreiter ordnen Haushalt stabil vor einer zuerst registrierten Außenperson');
        assert(nav.children[1].textContent.includes('Anna & Änne') && nav.children[2].textContent.includes('Béla <B>'), 'Sonderzeichennamen werden im echten Reiter-DOM als Namen dargestellt');
        assertEqual(await choose(doc, 'b'), true, 'Vor dem nächsten Start lässt sich Person 2 bestätigt öffnen');
        globalThis.window.location.hash = '#verlauf';
        assertEqual(resolveManagerTarget(globalThis.window.location).profileId, 'b', 'Verlaufsziel übernimmt aktives Profil statt Standardperson');
        await startTranchenManagerPage();
        assertEqual(getManagerView(doc).profileId, 'b', 'Frischer Verlaufseinstieg erhält übergebenes Profil B');
        assert(doc.getElementById('managerWealthContext').textContent.includes('bei Béla'), 'Verlaufskarte erneuert den tatsächlichen Profilbezug');
        assertEqual(doc.getElementById('managerCaptureWealthBtn').listeners.click.length, 1, 'Produktiver Seitenstart bindet den Captureknopf genau einmal');
        globalThis.window.location.hash = '';
        await startTranchenManagerPage();
        assertEqual(getManagerView(doc).profileId, 'a', 'Frischer Start ohne Ziel öffnet Person 1 nach zuvor aktiver Person 2');
        await selectManagerView({ kind: 'plan', profileId: 'a' });
        await startTranchenManagerPage();
        assertEqual(getManagerView(doc).kind, 'person', 'Frischer Start übernimmt keine vorherige Planansicht');
        const focused = nav.children[2]; focused.focus();
        registry.profiles.b.meta.name = 'Béla & neuer Name';
        renderManagerProfiles(doc, projectManagerProfiles(registry, 'a'));
        assertEqual(doc.activeElement.dataset.managerProfile, 'b', 'Namensänderung und Rerender erhalten den fokussierten Personenreiter');
        assertEqual(nav.querySelector('[aria-selected="true"]').dataset.managerProfile, 'a', 'Namensänderung aktiviert keine andere Person');
        assertEqual(nav.children.filter(tab => tab.getAttribute('tabindex') === '0').length, 1, 'Rerender erhält genau einen roving Tabstopp');
    }
    {
        const { doc, registry } = await setup({ outside: true });
        delete registry.profiles.a;
        registry.profiles.b.meta.name = 'Solo & Name';
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        persistenceStorage.setItem('rs_current_profile', 'b'); persistenceStorage.setItem('rs_active_profile', 'b');
        for (const [key, value] of Object.entries(registry.profiles.b.data)) persistenceStorage.setItem(key, value);
        await originalFlush.call(PersistenceFacade);
        initTranchenManagerPage({ profileId: 'b' });
        await startTranchenManagerPage();
        const tabs = doc.getElementById('managerSectionNav').children;
        assertEqual(tabs.length, 3, 'Einzelprofil ohne Haushalt erhält Plan, Person und Verlauf');
        assertEqual(tabs[0].textContent, 'Plan · Solo & Name', 'Einzelplanreiter verwendet denselben Profilnamen');
        assertEqual(getManagerView(doc).profileId, 'b', 'Einzelprofil startet in seiner Personenansicht');
    }
    {
        const { doc, backend } = await setup();
        const nav = doc.getElementById('managerSectionNav');
        const before = JSON.stringify([...backend]);
        assertEqual(nav.getAttribute('role'), 'tablist', 'Eine einzige Ansichtsreiterliste verwendet den tatsächlichen DOM-Host');
        assert(!doc.getElementById('managerPersonPanel').hidden && doc.getElementById('managerPlanPanel').hidden, 'Personenstart versteckt das vollständige Planpanel');
        assertEqual(await selectManagerView({ kind: 'plan', profileId: 'a' }), true, 'Planansicht ist unabhängig vom bearbeiteten Profil');
        assert(doc.getElementById('managerPersonPanel').hidden && doc.getElementById('managerPersonPanel').inert && !doc.getElementById('managerPlanPanel').hidden, 'Planansicht entfernt Personeninhalte aus Fokus- und Accessibility-Reihenfolge');
        assertEqual(JSON.stringify([...backend]), before, 'Reiner Ansichtswechsel schreibt keine Finanz- oder Profilwerte');
        assertEqual(await openManagerOverviewTarget({ hash: '#managerDepotTitle', search: '' }, { ready: true }), true, 'Depot-Sprung verwendet den bestehenden geschützten Ansichtsweg');
        assertEqual(getManagerView(doc).profileId, 'a', 'Depot-Sprung bleibt bei derselben Person');
        assertEqual(doc.activeElement.id, 'managerDepotTitle', 'Depot-Sprung erreicht den richtigen sichtbaren Depotkopf');
        assertEqual(JSON.stringify([...backend]), before, 'Depot-Sprung schreibt keine Fach- oder Registrywerte');
        await selectManagerView({ kind: 'plan', profileId: 'a' });
        assertEqual(await choose(doc, 'a', 'managerHousehold'), true, 'Öffnen der bereits bearbeiteten Person verlässt den Planmodus');
        assertEqual(nav.querySelectorAll('[aria-selected="true"]').length, 1, 'Genau ein Ansichtsreiter ist ausgewählt');
        const tabs = nav.querySelectorAll('[role="tab"]');
        const keyboard = (tab, key) => nav.listeners.keydown[0]({ target: tab, key, preventDefault() {} });
        const selected = getManagerView(doc);
        keyboard(tabs[1], 'ArrowRight'); assertEqual(doc.activeElement, tabs[2], 'Rechts bewegt den Fokus zur nächsten Person');
        assertEqual(getManagerView(doc), selected, 'Fokusbewegung aktiviert kein Profil');
        keyboard(tabs[2], 'Home'); assertEqual(doc.activeElement, tabs[0], 'Home fokussiert den Planreiter');
        keyboard(tabs[0], 'ArrowLeft'); assertEqual(doc.activeElement, tabs[3], 'Links läuft vom ersten zum letzten Reiter um');
        keyboard(tabs[2], 'End'); assertEqual(doc.activeElement, tabs[3], 'End fokussiert den letzten Reiter');
        await keyboard(tabs[2], 'Enter');
        assertEqual(getManagerView(doc).profileId, 'b', 'Enter bestätigt die fokussierte Person');
        initTranchenManagerPage({ profileId: 'b' });
        assertEqual(nav.querySelector('[aria-selected="true"]').dataset.managerProfile, 'b', 'Erneutes Rendern erhält den bestätigten internen Personenwechsel');
        assertEqual(doc.getElementById('managerPersonPanel').getAttribute('aria-labelledby'), nav.querySelector('[aria-selected="true"]').id, 'Personenpanel ist mit dem ausgewählten Reiter verknüpft');
        await keyboard(nav.children[0], ' ');
        assertEqual(getManagerView(doc).kind, 'plan', 'Leertaste aktiviert die Planansicht');
        await choose(doc, 'b');
        assertEqual(getManagerView(doc).kind, 'person', 'Reiter derselben Person verlässt ebenfalls den Planmodus');
        assertEqual(await openManagerOverviewTarget({ hash: '#profileTagesgeld', search: '?person=a' }, { ready: true }), true, 'Profilbezogener Tagesgeldlink wählt erst die richtige Person');
        assert(!doc.getElementById('managerAssetsBody').hidden && !doc.getElementById('managerPersonPanel').hidden, 'Tagesgeldlink öffnet die sichtbare Vermögensregion');
        assertEqual(doc.activeElement.id, 'profileTagesgeld', 'Tagesgeldlink fokussiert das sichtbare native Feld');
        for (const location of [{ hash: '#profileTagesgeld', search: '?person=fremd' }, { hash: '#haushalt-plan', search: '?person=a&person=b' }, { hash: '#unbekannt', search: '?person=b' }]) {
            assertEqual(await openManagerOverviewTarget(location, { ready: true }), false, 'Ungültiges Ziel wechselt kein fremdes Profil');
            assertEqual(getManagerView(doc).profileId, 'a', 'Ungültiges Ziel erhält die bestätigte Auswahl');
        }
        assertEqual(await openManagerOverviewTarget({ hash: '#haushalt-plan', search: '?person=b' }, { ready: true }), true, 'Profilbezogener Planlink wählt Profil und Planpanel');
        assertEqual(getManagerView(doc).kind, 'plan', 'Planlink öffnet ausschließlich das Planpanel');
        assertEqual(doc.activeElement.id, 'haushalt-plan', 'Planlink fokussiert eine sichtbare Überschrift');
    }
    {
        const { doc, backend } = await setup();
        const historyPanel = doc.getElementById('managerHistoryPanel');
        assert(historyPanel.hidden, 'Personenreiter zeigt keine Verlaufskarte');
        await selectManagerView({ kind: 'plan', profileId: 'a' });
        assert(historyPanel.hidden, 'Haushalt & Plan zeigt keine Verlaufskarte');
        await doc.getElementById('managerSectionNav').listeners.click[0]({ target: doc.getElementById('managerHistoryTab'), preventDefault() {} });
        assertEqual(getManagerView(doc).kind, 'history', 'Verlaufsreiter öffnet die eigene Ansicht');
        assert(!historyPanel.hidden && doc.getElementById('managerPersonPanel').hidden && doc.getElementById('managerPlanPanel').hidden, 'Verlauf ist das einzige sichtbare Panel');
        assert(doc.getElementById('managerHistorySwitch').innerHTML.includes('Haushalt'), 'Verlauf enthält die Haushaltswahl');
        doc.getElementById('managerWealthStatus').textContent = 'Vermögensstand gesichert';
        await chooseHistory(doc, 'b');
        assertEqual(backend.get('rs_current_profile'), 'b', 'Verlaufsumschalter wechselt das dauerhafte aktive Profil');
        assertEqual(getManagerView(doc).historyScope, 'person', 'Personenwahl bleibt im Verlauf bei der Person');
        assertEqual(doc.getElementById('managerWealthStatus').textContent, '', 'Personenwechsel leert die Statusmeldung');
        doc.getElementById('managerWealthStatus').textContent = 'Vermögensstand gesichert';
        await chooseHistory(doc);
        assertEqual(getManagerView(doc).historyScope, 'household', 'Haushaltswahl zeigt die Haushaltslinie');
        assertEqual(doc.getElementById('managerWealthStatus').textContent, '', 'Ansichtswechsel leert die Statusmeldung');
        assertEqual(backend.get('rs_current_profile'), 'b', 'Haushaltswahl erhält das aktive Profil');
        for (const id of ['a', 'b', null]) {
            await selectManagerView({ kind: 'plan', profileId: 'b' });
            await chooseHistory(doc, id, 'managerHousehold');
            assertEqual(getManagerView(doc).kind, 'history', 'Kartenlink öffnet den Verlaufsreiter');
            assertEqual(getManagerView(doc).historyScope, id ? 'person' : 'household', 'Kartenlink wählt Haushalt bzw. Person vor');
            if (id) assertEqual(backend.get('rs_current_profile'), id, 'Personenlink wählt das passende aktive Profil');
        }
        for (const hash of ['#verlauf', '#managerWealthHistory', '#managerWealthTitle']) {
            assertEqual(await openManagerOverviewTarget({ hash, search: '?person=a' }, { ready: true }), true, 'Alter Verlaufsanker öffnet den eigenen Reiter');
            assertEqual(getManagerView(doc).kind, 'history', 'Verlaufsanker zeigt die Verlaufskarte');
            assertEqual(getManagerView(doc).profileId, 'a', 'Verlaufsanker übernimmt das angegebene Profil');
        }
    }
    {
        const { doc, backend, hold, release, holds } = await setup();
        await selectManagerView({ kind: 'plan', profileId: 'a' });
        hold(); const pending = choose(doc, 'b');
        await waitFor(() => holds.length > 0, 'Ansichtswechsel wartet auf den bestätigten Profilflush');
        assertEqual(getManagerView(doc).kind, 'plan', 'Während verzögertem Flush bleibt das Ursprungsplanpanel ausgewählt');
        assert(doc.getElementById('managerPersonPanel').hidden, 'Während Flush wird kein unbestätigtes Personenpanel gezeigt');
        assertEqual(choose(doc, 'b'), pending, 'Doppelklick teilt denselben delegierten Auftrag');
        release(); assertEqual(await pending, true, 'Erst bestätigter Flush veröffentlicht die Personenansicht');
        assertEqual(getManagerView(doc).profileId, 'b', 'Nach bestätigtem Flush stimmen Profil und Ansichtsreiter überein');
        assertEqual(backend.get('rs_current_profile'), 'b', 'Bestätigte Ansicht entspricht dem dauerhaften Profil');
    }
    {
        const { doc, backend } = await setup();
        await selectManagerView({ kind: 'plan', profileId: 'a' });
        const before = JSON.stringify([...backend]);
        let first = true;
        PersistenceFacade.flush = async () => { if (first) { first = false; throw new Error('synthetischer Ansichtsflushfehler'); } return originalFlush.call(PersistenceFacade); };
        assertEqual(await choose(doc, 'b'), false, 'Schreibfehler veröffentlicht keine Zielansicht');
        assertEqual(getManagerView(doc).kind, 'plan', 'Rollback erhält die ausgewählte Ursprungsansicht');
        assertEqual(getManagerView(doc).profileId, 'a', 'Rollback erhält die bearbeitete Person');
        assertEqual(JSON.stringify([...backend]), before, 'Rollback erhält bestätigte Profilbytes');
    }
    {
        const { doc, backend, hold, release, holds } = await setup({ extraData: { profile_gold_aktiv: 'true', profile_gold_ziel_pct: '7.51234567', profile_gold_floor_pct: '1', profile_gold_rebal_band: '25', profile_gold_steuerfrei: 'false', profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 80, entries: [{ date: '2026-01-03', value: 100 }] }) } });
        const before = Object.fromEntries(backend), originProfile = JSON.parse(before.rs_profiles_v1).profiles.a;
        assert(!doc.getElementById('managerBirthSupplement').hidden, 'Fehlendes Datum zeigt Ergänzungshinweis');
        for (const bad of ['1958-02-29', '1958-03', '2029-01-01', '']) {
            doc.getElementById('managerBirthDate').value = bad;
            assertEqual(await applyManagerBirthDate(), false, 'Ungültiger Geburtsdatumentwurf wird blockiert: ' + bad);
            assertEqual(JSON.stringify(Object.fromEntries(backend)), JSON.stringify(before), 'Ungültiger Entwurf verändert keine Backendbytes');
            assertEqual(doc.activeElement.id, 'managerBirthDate', 'Fehler hält Fokus an der Eingabe');
        }
        doc.getElementById('managerBirthDate').value = '1960-02-29';
        const original = PersistenceFacade.flush; let calls = 0;
        PersistenceFacade.flush = async () => { if (++calls === 1) throw new Error('synthetischer Datumsflush'); return original.call(PersistenceFacade); };
        assertEqual(await doc.getElementById('managerBirthApply').click(), undefined, 'Echter Ergänzungsknopf durchläuft den Binder');
        assertEqual(JSON.stringify(Object.fromEntries(backend)), JSON.stringify(before), 'Fehlflush schreibt Datum und Registry bytegleich zurück');
        assertEqual(doc.getElementById('managerBirthDate').value, '1960-02-29', 'Fehlflush behält vollständigen Entwurf');
        assert(doc.getElementById('managerBirthError').textContent.includes('erneut') && !doc.getElementById('managerBirthSupplement').hidden, 'Fehler bleibt sichtbar und erlaubt kontrollierten Retry');
        PersistenceFacade.flush = original; hold();
        const action = applyManagerBirthDate();
        assertEqual(await applyManagerBirthDate(), false, 'Doppelklick startet keinen zweiten Write');
        await waitFor(() => holds.length > 0, 'Geburtstag wartet Backendflush ab');
        assert(!doc.getElementById('managerBirthSupplement').hidden, 'Vor Flush verschwindet Ergänzungshinweis nicht');
        assert(doc.getElementById('managerBirthDate').readOnly && doc.activeElement.id === 'managerBirthDate', 'Laufender Datumsflush hält Fokus und schützt den übernommenen Entwurf');
        assertEqual(holds.length, 1, 'Doppelklick erzeugt genau einen laufenden Backendwrite');
        assertEqual(await switchManagerProfile('b'), false, 'Profilwechsel überholt laufende Datumsergänzung nicht');
        release(); assertEqual(await action, true, 'Retry bestätigt gültigen Schalttag');
        const after = Object.fromEntries(backend), registry = JSON.parse(after.rs_profiles_v1);
        assertEqual(after.profile_geburtsdatum, '1960-02-29', 'Nur gewählte Person erhält Geburtsdatum');
        assertEqual(registry.profiles.a.data.profile_geburtsdatum, after.profile_geburtsdatum, 'Livebestand und Registry sind bestätigt identisch');
        assertEqual(JSON.stringify(registry.profiles.b), JSON.stringify(JSON.parse(before.rs_profiles_v1).profiles.b), 'Außenprofilbytes bleiben erhalten');
        for (const [key, raw] of Object.entries(before)) if (!['profile_geburtsdatum', 'rs_profiles_v1'].includes(key)) assertEqual(after[key], raw, 'Datumsergänzung erhält Backendrecord ' + key);
        const data = { ...registry.profiles.a.data }; delete data.profile_geburtsdatum;
        assertEqual(Object.keys(data).sort().join(','), Object.keys(originProfile.data).sort().join(','), 'Datumsergänzung legt keine Vermögens-/Historienkeys an');
        for (const [key, raw] of Object.entries(originProfile.data)) assertEqual(data[key], raw, 'Cashhistorie, Tranchen und Goldeinstellungen bleiben bytegleich: ' + key);
        assert(doc.getElementById('managerBirthSupplement').hidden && doc.activeElement.id === 'profileGeburtsdatum', 'Bestätigte Ergänzung fokussiert geöffnete Personkarte');
        assertEqual(doc.getElementById('managerPersonToggle').getAttribute('aria-expanded'), 'true', 'Erfolgsfokus steht in einer geöffneten Region');
        assert(!doc.getElementById('managerPersonBody').hidden && doc.getElementById('managerAssetsBody').hidden && doc.getElementById('managerCareBody').hidden, 'Geburtstagsergänzung öffnet genau die Personregion');
        assertEqual(doc.getElementById('managerCardsToggleAll').getAttribute('aria-expanded'), 'false', 'Geburtstagsergänzung hält Gesamt-ARIA im gemischten Zustand');
        assertEqual(doc.getElementById('managerCardsToggleAll').textContent, 'Alle aufklappen', 'Geburtstagsergänzung aktualisiert Gesamttext anhand Regionen');
        const frozen = JSON.stringify(Object.fromEntries(backend));
        await doc.getElementById('managerAssetsToggle').click(); await doc.getElementById('managerCardsToggleAll').click();
        await originalFlush.call(PersistenceFacade);
        assertEqual(JSON.stringify(Object.fromEntries(backend)), frozen, 'Reines Klappen ändert keine Backendbytes');
    }
    {
        const { doc, backend } = await setup({ outside: true });
        persistenceStorage.setItem('rs_current_profile', 'b');
        await originalFlush.call(PersistenceFacade);
        doc.getElementById('managerBirthDate').value = '1958-03-14';
        const before = JSON.stringify(Object.fromEntries(backend));
        assertEqual(await applyManagerBirthDate(), false, 'Abweichende Speicheridentität blockiert Datumsergänzung');
        assertEqual(JSON.stringify(Object.fromEntries(backend)), before, 'Kontextwechsel schreibt kein fremdes Geburtsdatum');
    }
    {
        const { doc, backend } = await setup();
        const field = doc.getElementById('profileGoldAktiv'), toggle = doc.getElementById('profileGoldAktivToggle');
        const original = PersistenceFacade.flush;
        let calls = 0;
        PersistenceFacade.flush = async () => { if (++calls === 1) throw new Error('synthetischer Schalterflush'); return original.call(PersistenceFacade); };
        toggle.checked = !toggle.checked; toggle.dispatchEvent(new Event('change'));
        assert(doc.getElementById('tranchePersistenceStatus').textContent.includes('wartet auf automatisches Speichern'), 'Schon die Autosavewartezeit behauptet keinen Erfolg');
        await waitFor(() => doc.getElementById('tranchePersistenceStatus').textContent.includes('nicht dauerhaft'), 'Schalterautosave meldet Fehlflush');
        assertEqual(toggle.checked, field.value === 'true', 'Fehlflush synchronisiert den sichtbar zurückgeschriebenen Schalter');
        assertEqual(backend.get('profile_gold_aktiv') ?? null, null, 'Fehlflush verändert keinen bestätigten Goldwert');
        PersistenceFacade.flush = original;
        await doc.getElementById('retryTrancheSaveBtn').click();
        assertEqual(persistenceStorage.getItem('profile_gold_aktiv'), 'true', 'Retry bestätigt denselben booleschen Wert');
        assert(toggle.checked && field.value === 'true', 'Retry zeigt den dauerhaft bestätigten Schalterwert');
        await choose(doc, 'b');
        assertEqual(toggle.checked, field.value === 'true', 'Vollständiger Personenwechsel synchronisiert den Zielschalter');
    }
    {
        const { doc, backend } = await setup();
        const before = JSON.stringify([...backend]);
        await doc.getElementById('depotAddTrancheBtn').click();
        assert(doc.getElementById('trancheModal').classList.contains('active'), 'Depotkauf bedient den bestehenden Kaufdialog');
        await doc.getElementById('closeTrancheModalBtn').click();
        assertEqual(doc.activeElement.id, 'depotAddTrancheBtn', 'Depotkauf erhält den tatsächlichen Rückfokus');
        await doc.getElementById('depotOpenSaleEntryBtn').click();
        assert(doc.getElementById('saleModal').classList.contains('active'), 'Depotverkauf bedient den bestehenden Verkaufsdialog');
        await doc.getElementById('saleCancelBtn').click();
        assertEqual(doc.activeElement.id, 'depotOpenSaleEntryBtn', 'Depotverkauf erhält den tatsächlichen Rückfokus');
        await doc.getElementById('profileManagePeopleBtn').click();
        assert(doc.getElementById('managerPeopleModal').classList.contains('active'), 'Feldkartenmenü bedient die bestehende Verwaltung');
        await doc.getElementById('dismissPeopleModalBtn').click();
        assertEqual(doc.activeElement.id, 'profileManagePeopleBtn', 'Feldkartenmenü erhält den tatsächlichen Rückfokus');
        assertEqual(JSON.stringify([...backend]), before, 'Zusätzliche Dialogöffner und Abbruch schreiben keine Bestandsdaten');
    }
    console.log('Lesende Kartenprojektion und vollständiger Personenwechsel');
    {
        const { doc, registry } = await setup({ outside: true });
        const before = persistenceStorage.getItem('rs_profiles_v1');
        const projection = projectManagerProfiles(registry, 'a');
        assertEqual(projection.household.assets, 340, 'Vermögen zählt Tranchenmarktwert plus Tagesgeld');
        assertEqual(projection.household.gain, 80, 'Buchgewinn bezieht sich ausschließlich auf den Bestand');
        assertEqual(projection.profiles.length, 2, 'Auch Nichtmitglied besitzt einen Reiter');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Kartenprojektion hat keine Speicherwirkung');
        renderManagerProfiles(doc, projection);
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Kartenrendern hat keine Speicherwirkung');
        const switchedProjection = projectManagerProfiles(registry, 'b');
        assertEqual(switchedProjection.profiles[0].householdRole, 'Hauptprofil im Haushalt', 'Hauptprofilbezug ist von aktiver Auswahl unabhängig');
        assertEqual(switchedProjection.profiles[1].householdRole, 'Außerhalb Haushalt', 'Nichtmitglied wird nicht durch Aktivierung zum Hauptprofil');
        const invalid = structuredClone(registry); invalid.profiles.a.data.profile_tagesgeld = 'kaputt';
        assertEqual(projectManagerProfiles(invalid, 'a').household, null, 'Ungültige Werte ergeben keine scheinbar vollständige Haushaltssumme');
        const invalidFallback = structuredClone(registry);
        delete invalidFallback.profiles.a.data.profile_tagesgeld;
        invalidFallback.profiles.a.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ inputs: { tagesgeld: 'kaputt' } });
        assertEqual(projectManagerProfiles(invalidFallback, 'a').household, null, 'Ungültiger bestehender Inputfallback wird nicht zur Vollsumme normalisiert');
        const overflow = structuredClone(registry);
        for (const profile of Object.values(overflow.profiles)) {
            profile.meta.belongsToHousehold = true;
            profile.data.profile_tagesgeld = String(Number.MAX_VALUE);
        }
        assertEqual(projectManagerProfiles(overflow, 'a').household, null, 'Überlauf der Haushaltssumme bleibt ausdrücklich unvollständig');
        assert(doc.getElementById('managerHousehold').innerHTML.includes('Außerhalb Haushalt'), 'Haushaltsmitgliedschaft ist vom aktiven Profil getrennt');
    }
    {
        const { doc, backend, holds, hold, release } = await setup();
        input(doc, 'profileTagesgeld', '321'); // Timer bleibt noch offen (300 ms).
        hold();
        const switching = choose(doc, 'b');
        const duplicate = choose(doc, 'b', 'managerHousehold');
        assertEqual(duplicate, switching, 'Reiter und Öffnen sind Singleflight');
        await waitFor(() => holds.length === 1, 'Adapter hält Ursprungsautosave');
        assertEqual(persistenceStorage.getItem('rs_current_profile'), 'a', 'Offener Autosave behält Ursprungskennung');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Backend bleibt vor Ursprungsflush bei A');
        holds[0].resolve();
        await waitFor(() => holds.length === 2, 'Adapter hält getrennten Wechselflush');
        const durable = JSON.parse(backend.get('rs_profiles_v1'));
        assertEqual(durable.profiles.a.data.profile_tagesgeld, '321', 'Ursprungswerte sind vor Kennungswechsel dauerhaft gespeichert');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Zielkennung ist vor Wechselflush nicht dauerhaft bestätigt');
        assert(doc.getElementById('suiteProfileContext').dataset.profileName.includes('Person A'), 'Keine optimistisch bestätigte Zielanzeige');
        release();
        assertEqual(await switching, true, 'Bestätigter Wechsel ist erfolgreich');
        assertEqual(backend.get('rs_current_profile'), 'b', 'Zielkennung ist dauerhaft bestätigt');
        assertEqual(window.tranchen[0].trancheId, 'person-b-lot', 'Vollständiger Zielbestand geladen');
        assertEqual(String(doc.getElementById('profileTagesgeld').value), '200', 'Zielformular geladen');
        assert(doc.getElementById('suiteProfileContext').dataset.profileName.includes('Person B'), 'Profilanzeige zeigt B');
        assert(doc.getElementById('suiteProfileContext').dataset.profileName.includes('Person B'), 'Suiteanzeige zeigt B');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Neue Baselines sind sauber, keine Wechselreservierung bleibt');
        assertEqual(doc.getElementById('managerSectionNav').listeners.click.length, 1, 'Profilwechsel verdoppelt keine Reiterlistener');
        assertEqual(doc.getElementById('profileTagesgeld').listeners.input.length, 1, 'Profilwechsel verdoppelt keine Autosavelistener');
    }
    {
        const { doc, backend, holds, hold, release } = await setup();
        const before = backend.get('rs_profiles_v1');
        await doc.getElementById('depotOpenSaleEntryBtn').click();
        const actionId = doc.getElementById('reconcileActionId').value;
        assert(actionId.startsWith('sale-'), 'Öffnen erzeugt eine stabile Ausführungs-Kennung ohne Write');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Dialogöffnung schreibt weder Registry noch Audit');
        const options = doc.getElementById('reconcileTrancheId').children;
        assert(options.some(option => option.textContent.includes('Synthetischer Bestand A')), 'Alle aktiven Tranchen sind namentlich auswählbar');
        for (const [id, value] of Object.entries({ reconcileTrancheId: lot.trancheId, reconcileExecutedAt: '2026-10-06', reconcileSharesSold: '1', reconcileGrossProceeds: '120', reconcileFees: '2' })) doc.getElementById(id).value = value;
        await doc.getElementById('saleNextBtn').click();
        assertEqual(doc.getElementById('saleStep2').hidden, false, 'Cash ist als zweiter Schritt erreichbar');
        await doc.getElementById('saleBackBtn').click();
        assertEqual(doc.getElementById('reconcileActionId').value, actionId, 'Schrittrückkehr erhält die Ausführungs-Kennung');
        await doc.getElementById('saleNextBtn').click();
        doc.getElementById('reconcileCashStatus').value = 'confirmed_already_reflected';
        await doc.getElementById('reconcileCashStatus').listeners.change[0]();
        assertEqual(doc.getElementById('reconciliationForm').listeners.submit[0]({ preventDefault() {} }), false, 'Cash Ja ohne bestätigten Stand erreicht keine Vorschau');
        doc.getElementById('reconcileInitialCashBalance').value = '218';
        assertEqual(doc.getElementById('reconciliationForm').listeners.submit[0]({ preventDefault() {} }), true, 'Cash Ja mit Stand erreicht die schreibfreie Vorschau');
        assertEqual(doc.getElementById('saleStep3').hidden, false, 'Vorschau ist als dritter Schritt erreichbar');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Vorschau schreibt weder Livebestand noch Registry/Audit');
        const realFlush = PersistenceFacade.flush;
        let fail = true;
        PersistenceFacade.flush = async () => { if (fail) { fail = false; return false; } return realFlush.call(PersistenceFacade); };
        await completePageDialog(doc.getElementById('reconciliationConfirmBtn').click(), doc);
        assertEqual(doc.getElementById('reconcileActionId').value, actionId, 'Speicherfehler erhält die Kennung für Retry');
        assertEqual(doc.getElementById('retrySaleSaveBtn').hidden, false, 'Retry ist im offenen Verkaufsdialog erreichbar');
        hold();
        const retry = doc.getElementById('retrySaleSaveBtn').click();
        await waitFor(() => holds.length > 0, 'Verkaufsretry hält den bestätigten Speicherabschluss');
        await doc.getElementById('dismissSaleModalBtn').click();
        assert(doc.getElementById('saleModal').classList.contains('active'), 'Laufender Verkaufswrite sperrt Dialogschluss');
        release(); await retry;
        const saved = JSON.parse(backend.get('rs_profiles_v1'));
        assertEqual(saved.trancheReconciliation.actions.length, 1, 'Nur separate Bestätigung und Retry schreiben genau einen Verkauf');
        assertEqual(saved.trancheReconciliation.actions[0].actionId, actionId, 'Retry benutzt unverändert die ursprüngliche Kennung');
        assertEqual(saved.trancheReconciliation.actions[0].cashBalanceAfterPostingEur, 218, 'Cash Ja dokumentiert den bestätigten Stand');
        assertEqual(backend.get('profile_tagesgeld'), '100', 'Verkauf erhöht Tagesgeld niemals automatisch');
        assertEqual(doc.getElementById('saleModal').classList.contains('active'), false, 'Bestätigter Verkauf schließt seinen Dialog');
        assertEqual(doc.activeElement.id, 'depotOpenSaleEntryBtn', 'Verkauf gibt Fokus an den Öffner zurück');
        PersistenceFacade.flush = realFlush;
        await doc.getElementById('depotOpenSaleEntryBtn').click();
        for (const [id, value] of Object.entries({ reconcileActionId: actionId, reconcileTrancheId: lot.trancheId, reconcileExecutedAt: '2026-10-06', reconcileSharesSold: '1', reconcileGrossProceeds: '120', reconcileFees: '2' })) doc.getElementById(id).value = value;
        await doc.getElementById('saleNextBtn').click();
        assertEqual(doc.getElementById('reconciliationForm').listeners.submit[0]({ preventDefault() {} }), true, 'Exakte Wiederholung erreicht eine reine Duplikatvorschau');
        initTranchenManagerPage({ profileId: 'a' });
        assertEqual(doc.getElementById('reconciliationConfirmBtn').disabled, true, 'Persistenzrender erhält die Duplikatsperre');
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).trancheReconciliation.actions.length, 1, 'Exakte Wiederholung erzeugt keinen weiteren Auditwrite');
    }
    {
        const { doc, backend } = await setup();
        const host = doc.getElementById('managerHousehold');
        const openMenu = id => {
            assert(host.innerHTML.includes(`data-manager-people="${id}"`), 'Kartenmenü stammt aus dem tatsächlichen Renderer');
            const opener = new MockElement('', 'button'); opener.dataset.managerPeople = id;
            opener.closest = selector => selector === '[data-manager-people]' ? opener : null;
            for (const handler of host.listeners.click) handler({ target: opener });
            return opener;
        };
        const before = backend.get('rs_profiles_v1');
        const listenerCount = host.listeners.click.length;
        const opener = openMenu('b');
        assert(doc.getElementById('managerPeopleModal').classList.contains('active'), 'Kartenmenü öffnet denselben Verwaltungsdialog');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Kartenmenüöffnung schreibt weder Profil noch Registry');
        await doc.getElementById('dismissPeopleModalBtn').click();
        assertEqual(doc.activeElement, opener, 'Kartenmenü erhält den Rückfokus am tatsächlichen Öffner');
        const detached = openMenu('b');
        doc.getElementById('managerPeopleList').listeners.click[0]({ target: Object.assign(new MockElement('', 'button'), { dataset: { personAction: 'rename', personId: 'b' } }) });
        doc.getElementById('managerPersonName').value = 'Umbenannt B';
        await doc.getElementById('managerPersonRenameBtn').click();
        detached.isConnected = false; detached.focus = () => {}; // Wie beim entfernten echten DOM-Knoten.
        const replacement = new MockElement('', 'button'); replacement.dataset.managerPeople = 'b';
        host.querySelectorAll = () => [replacement];
        await doc.getElementById('dismissPeopleModalBtn').click();
        assertEqual(doc.activeElement, replacement, 'Rückfokus findet das Kartenmenü nach bestätigtem Rerender');
        assertEqual(host.listeners.click.length, listenerCount, 'Rerender verdoppelt keinen Verwaltungslistener');
        openMenu('b');
        await doc.getElementById('dismissPeopleModalBtn').click();
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).profiles.b.meta.name, 'Umbenannt B', 'Delegiertes Kartenmenü nutzt den bestehenden bestätigten Verwaltungswrite');
    }
    {
        const { doc, backend, holds, hold, release } = await setup();
        await doc.getElementById('managePeopleBtn').click();
        const inactiveBefore = JSON.stringify(JSON.parse(backend.get('rs_profiles_v1')).profiles.b.data);
        input(doc, 'profileTagesgeld', '333');
        doc.getElementById('managerPersonName').value = 'Neue Person';
        hold();
        const creating = doc.getElementById('managerPeopleForm').listeners.submit[0]({ preventDefault() {} });
        await waitFor(() => holds.length === 1, 'Verwaltung wartet auf aktiven Profilautosave');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Verwaltung aktiviert vor Autosaveabschluss kein neues Profil');
        holds[0].resolve();
        await waitFor(() => holds.length === 2, 'Verwaltungsflush bleibt geschützt');
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).profiles.a.data.profile_tagesgeld, '333', 'Aktive Werte sind vor Verwaltungswrite dauerhaft abgeschlossen');
        await doc.getElementById('dismissPeopleModalBtn').click();
        assert(doc.getElementById('managerPeopleModal').classList.contains('active'), 'Verwaltungswrite sperrt Dialogschluss');
        release(); assertEqual(await creating, true, 'Anlegen aktiviert und lädt die neue Person');
        const createdId = backend.get('rs_current_profile');
        assert(createdId !== 'a', 'Anlegen lädt die tatsächlich bestätigte neue Kennung');
        assertEqual(window.tranchen.length, 0, 'Neue Person erbt keinen alten Tranchenbestand');
        assertEqual(String(doc.getElementById('profileTagesgeld').value), '0', 'Neue Person erhält neue Formularwerte');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Anlegen bestätigt neue Baselines ohne alte Entwürfe');
        assertEqual(JSON.stringify(JSON.parse(backend.get('rs_profiles_v1')).profiles.b.data), inactiveBefore, 'Verwaltung schreibt keine inaktiven Finanzwerte');
        assertEqual(await choose(doc, 'b'), true, 'Reiterwechsel nach Anlegen lädt bestehenden Zielbestand');
        await doc.getElementById('managePeopleBtn').click();
        const rowAction = (kind, id) => {
            const button = new MockElement('', 'button'); button.dataset.personAction = kind; button.dataset.personId = id;
            return doc.getElementById('managerPeopleList').listeners.click[0]({ target: button });
        };
        rowAction('rename', 'b'); doc.getElementById('managerPersonName').value = 'Person B neu';
        await doc.getElementById('managerPersonRenameBtn').click();
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).profiles.b.meta.name, 'Person B neu', 'Personendialog benennt das gewählte Profil um');
        const member = new MockElement('', 'input'); member.dataset.personMembership = 'b'; member.checked = false;
        await doc.getElementById('managerPeopleList').listeners.change[0]({ target: member });
        assertEqual(JSON.parse(backend.get('rs_profiles_v1')).profiles.b.meta.belongsToHousehold, false, 'Personendialog setzt die bestehende Haushaltsmitgliedschaft');
        assertEqual(await completePageDialog(rowAction('delete', 'b'), doc, 'cancel'), false, 'Abgelehnte Löschbestätigung erhält die Person');
        assertEqual(await completePageDialog(rowAction('delete', 'b'), doc), true, 'Bestätigte Löschung lädt den Speicherfallback');
        assertEqual(window.tranchen[0].trancheId, lot.trancheId, 'Löschen des aktiven Profils lädt tatsächlich den Fallbackbestand');
        assertEqual(String(doc.getElementById('profileTagesgeld').value), '333', 'Fallback lädt seine eigenen Profilwerte');
        assertEqual(await choose(doc, createdId), true, 'Reiterwechsel nach Löschen bleibt vollständig');
        assertEqual(window.tranchen.length, 0, 'Reiter nach Löschen zeigt keine alten Bestände');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Nach Löschen und Wechsel bleiben neue Baselines sauber');
    }
    {
        const { doc, backend } = await setup();
        const before = backend.get('rs_profiles_v1');
        await doc.getElementById('depotOpenSaleEntryBtn').click();
        const modal = doc.getElementById('saleModal');
        doc.getElementById('reconcileSharesSold').value = '1';
        modal.listeners.keydown[0]({ key: 'Escape', preventDefault() {} });
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Escape fragt nach Verwerfen des Verkaufsentwurfs');
        await answer(doc, false);
        assert(modal.classList.contains('active'), 'Escape mit Bleiben erhält den Verkaufsentwurf');
        assertEqual(doc.getElementById('reconcileSharesSold').value, '1', 'Bleiben erhält tatsächliche Verkaufseingaben');
        modal.listeners.click[0]({ target: modal });
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Overlay benutzt dieselbe Verwerfentscheidung');
        await answer(doc, true);
        await waitFor(() => !modal.classList.contains('active'), 'Bestätigtes Verwerfen schließt den Verkauf');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Verwerfen schreibt weder Bestand noch Audit');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Verwerfen entfernt unbestätigte Schritte und alte Baselines');
        assertEqual(doc.activeElement.id, 'depotOpenSaleEntryBtn', 'Verwerfen gibt Fokus an den ursprünglichen Öffner zurück');
    }
    {
        const { doc, backend } = await setup();
        await doc.getElementById('managePeopleBtn').click();
        const submit = () => doc.getElementById('managerPeopleForm').listeners.submit[0]({ preventDefault() {} });
        const before = backend.get('rs_profiles_v1');
        assertEqual(await submit(), false, 'Leerer Personenname schreibt kein Profil');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Namensvalidierung erhält alle Profile');
        doc.getElementById('managerPersonName').value = 'Flushfehler Person';
        const realFlush = PersistenceFacade.flush;
        let first = true;
        PersistenceFacade.flush = async () => { if (first) { first = false; return false; } return realFlush.call(PersistenceFacade); };
        assertEqual(await submit(), false, 'Unbestätigte Personenanlage meldet keinen Erfolg');
        assertEqual(backend.get('rs_profiles_v1'), before, 'Verwaltungsflushfehler schreibt ursprüngliche Registry dauerhaft zurück');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Verwaltungsflushfehler erhält die bestätigte Identität');
        assertEqual(window.tranchen[0].trancheId, lot.trancheId, 'Verwaltungsfehler erhält die bestätigte Ursprungsansicht');
        assertEqual(doc.getElementById('managerPersonName').value, 'Flushfehler Person', 'Fehler erhält den Verwaltungsentwurf zur Wiederholung');
        PersistenceFacade.flush = realFlush;
        assertEqual(await submit(), true, 'Verwaltungsentwurf kann nach Rückschreiben erneut bestätigt werden');
    }
    for (const host of ['managerSectionNav', 'managerHousehold']) {
        const { doc, backend } = await setup();
        doc.getElementById('reconcileActionId').value = 'offener-entwurf';
        const pending = choose(doc, 'b', host);
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Verwerfentscheidung geöffnet');
        await answer(doc, false); assertEqual(await pending, false, 'Bleiben erhält Ursprungsprofil');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Bleiben speichert keine Zielkennung');
        assertEqual(doc.getElementById('reconcileActionId').value, 'offener-entwurf', 'Bleiben erhält Abgleichentwurf');
        const accepted = choose(doc, 'b', host);
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Erneute Entscheidung');
        await answer(doc, true); assertEqual(await accepted, true, 'Öffnen und Reiter verwenden denselben Verwerfweg');
        assertEqual(doc.getElementById('reconcileActionId').value, '', 'Verwerfen setzt den Ursprungsabgleich zurück');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Verwerfen lädt neue saubere Baselines');
    }
    {
        const { doc, backend } = await setup();
        doc.getElementById('reconcileActionId').value = 'offener-entwurf';
        const switching = choose(doc, 'b');
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Entscheidung für neue Eingaben geöffnet');
        assertEqual(doc.getElementById('profileTagesgeld').disabled, true, 'Profilfelder sind während der Verlustentscheidung gesperrt');
        input(doc, 'profileTagesgeld', '777'); // synthetische Umgehung der nativen Sperre
        await answer(doc, true);
        assertEqual(await switching, false, 'Neue Eingabe entwertet frühere Zustimmung');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Entwertete Zustimmung erhält Ursprungsprofil');
    }
    {
        const { doc, backend } = await setup();
        input(doc, 'profileTagesgeld', '-1');
        assertEqual(await choose(doc, 'b'), false, 'Ungültige Eingabe verhindert Wechsel');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Ungültige Eingabe erhält Ursprung');
    }
    for (const autosave of [false, true]) {
        const { doc, backend } = await setup();
        if (autosave) input(doc, 'profileTagesgeld', '321');
        let first = true;
        PersistenceFacade.flush = async () => { if (first) { first = false; return false; } return originalFlush.call(PersistenceFacade); };
        assertEqual(await choose(doc, 'b'), false, 'Flushfehler verhindert Personenwechsel');
        assertEqual(persistenceStorage.getItem('rs_current_profile'), 'a', 'Flushfehler stellt Ursprungskennung wieder her');
        assertEqual(backend.get('rs_current_profile'), 'a', 'Flushfehler erhält dauerhaftes Ursprungsprofil');
        assert(window.tranchen[0].name.includes(' A'), 'Fehler erhält bestätigte Ursprungsansicht');
    }
    {
        const { doc, backend } = await setup();
        const requests = [];
        globalThis.fetch = url => new Promise(resolve => requests.push({ url, resolve }));
        const batch = doc.getElementById('updatePricesBtn').click();
        await waitFor(() => requests.length === 1, 'Kursjob gestartet');
        let ended = false;
        const switching = choose(doc, 'b').then(value => { ended = true; return value; });
        await waitFor(() => doc.getElementById('navigationGuardDialog').open, 'Kursabbruchentscheidung geöffnet');
        await answer(doc, true);
        for (let i = 0; i < 12; i++) await Promise.resolve();
        assertEqual(ended, false, 'Wechsel wartet auch bei ignoriertem AbortSignal auf Jobende');
        requests[0].resolve({ ok: true, json: async () => ({ symbol: 'TEST.DE', price: 999, currency: 'EUR', asOf: Math.floor(Date.now() / 1000), source: 'synthetic' }) });
        await batch;
        assertEqual(await switching, true, 'Personenwechsel nach bestätigtem Kursabbruch');
        assertEqual(window.tranchen[0].currentPrice, 90, 'Keine späte Kursübernahme des alten Profils');
        assertEqual(JSON.parse(JSON.parse(backend.get('rs_profiles_v1')).profiles.a.data.depot_tranchen)[0].currentPrice, 120, 'Abgebrochener Kursjob verändert auch Ursprung nicht');
    }
    {
        const { doc } = await setup();
        const setItem = persistenceStorage.setItem;
        let failed = false;
        persistenceStorage.setItem = (key, value) => {
            if (!failed && key === 'rs_current_profile' && value === 'b') { failed = true; throw new Error('synthetic-switch-IO'); }
            return setItem(key, value);
        };
        try {
            assertEqual(await choose(doc, 'b'), false, 'Geworfener Speicherwechsel bleibt kontrolliert');
            assertEqual(doc.getElementById('managerProfileRecovery').hidden, false, 'Wechselfehler bietet unabhängige Manager-Recovery');
            assert(doc.getElementById('managerProfileRecovery').children[1].children.some(button => button.dataset.profileRecoveryAction === 'retry'), 'Technischer Wechselfehler bietet geschützten Retry');
            assertEqual(persistenceStorage.getItem('rs_current_profile'), 'a', 'Geworfener Wechsel erhält Ursprung');
        } finally { persistenceStorage.setItem = setItem; }
    }
    {
        const { doc } = await setup();
        persistenceStorage.setItem('rs_profiles_v1', 'synthetisch-kaputt');
        await originalFlush.call(PersistenceFacade);
        await startTranchenManagerPage();
        const recovery = doc.getElementById('managerProfileRecovery');
        assertEqual(recovery.hidden, false, 'Manager-Recovery funktioniert ohne Startseiten-DOM');
        assert(recovery.children[1].children.some(button => button.dataset.profileRecoveryAction === 'export'), 'Bootstrap-Recovery bietet echten Export');
    }
    // Sichtbarer Knopf ist noch kein dauerhaft abgeschlossener Profilbootstrap.
    // Derselbe Ladeflush wird mit und ohne abgebrochene Reparatur beobachtet.
    for (const removed of [false, true]) for (const cancel of [false, true]) {
        const { captureWealthLots, PROFILE_WEALTH_LOTS_KEY, PROFILE_CASH_HISTORY_KEY } = await import('../app/profile/profile-wealth-history.js');
        const { doc, backend, hold, release, holds, batches } = await setup();
        const current = removed ? [] : [{ ...lot, shares: 3, purchaseDate: '2026-01-05' }];
        const copies = captureWealthLots(JSON.stringify(captureWealthLots(null, [{ ...lot, purchaseDate: '2026-01-02' }], '2026-01-03')), current, '2026-01-06');
        delete copies.lots[lot.trancheId].uncertainty;
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        registry.profiles.a.meta.updatedAt = '2026-01-01T00:00:00.000Z';
        Object.assign(registry.profiles.a.data, { depot_tranchen: JSON.stringify(current),
            [PROFILE_WEALTH_LOTS_KEY]: JSON.stringify(copies),
            [PROFILE_CASH_HISTORY_KEY]: JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-01-01', value: 100 }] }) });
        for (const [key, raw] of Object.entries(registry.profiles.a.data)) persistenceStorage.setItem(key, raw);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        await originalFlush.call(PersistenceFacade);
        const keys = ['rs_profiles_v1', 'depot_tranchen', PROFILE_WEALTH_LOTS_KEY, PROFILE_CASH_HISTORY_KEY, 'profile_tagesgeld'];
        const snapshot = () => Object.fromEntries(keys.map(key => [key, backend.get(key) ?? null]));
        const early = snapshot();
        const setItem = persistenceStorage.setItem, removeItem = persistenceStorage.removeItem;
        const writes = [];
        persistenceStorage.setItem = (key, raw) => { writes.push(key); return setItem(key, raw); };
        persistenceStorage.removeItem = key => { writes.push(key); return removeItem(key); };
        hold();
        let loadingFlush;
        try {
            await startTranchenManagerPage();
            assert(doc.getElementById('managerHousehold').innerHTML.includes('data-history-recovery='), 'Reparaturknopf sichtbar vor dauerhaftem Ladeflush');
            assert(writes.includes('rs_profiles_v1'), 'Regulärer Profilbootstrap schreibt die aktive Registrykopie');
            const loadedRegistry = persistenceStorage.getItem('rs_profiles_v1');
            assert(loadedRegistry !== early.rs_profiles_v1, 'Ladebootstrap aktualisiert Registry vor der Nachfrage im Cache');
            loadingFlush = originalFlush.call(PersistenceFacade);
            await waitFor(() => holds.length > 0, 'Regulärer Ladeflush erreicht die kontrollierte Adapterbarriere');
            const batchCount = batches.length;
            assertEqual(JSON.stringify(snapshot()), JSON.stringify(early), 'Gehaltene Ladeschreibung ist noch nicht im Backend angekommen');
            assertEqual(JSON.stringify(holds[0].batch.upserts.map(([key]) => key)), '["rs_profiles_v1"]', 'Verzögerter Ladebatch betrifft ausschließlich rs_profiles_v1');
            writes.length = 0;
            const request = { trancheId: lot.trancheId, kind: removed ? 'discard' : 'correct' };
            if (cancel) assertEqual(await repairManagerHistory(request, { confirmCorrection: () => false }), false, 'Abbruch während Ladeflush bleibt erfolglos');
            else initTranchenManagerPage({ profileId: 'a' });
            assertEqual(writes.length, 0, 'Kontrollfall und Nachfrageabbruch erzeugen null Schreibaufrufe');
            assertEqual(batches.length, batchCount, 'Kontrollfall und Nachfrageabbruch starten keinen weiteren Adapterbatch');
            release(); await loadingFlush;
            const settled = snapshot();
            assertEqual(settled.rs_profiles_v1, loadedRegistry, 'Früher Bytevergleich sieht allein den bereits vorbereiteten Ladebootstrap');
            for (const key of keys.filter(key => key !== 'rs_profiles_v1')) assertEqual(settled[key], early[key], `Ladeabschluss erhält ${key} bytegleich`);
            const status = doc.register(new MockElement('managerHistoryRecoveryStatus'));
            const button = new MockElement('', 'button');
            button.dataset = { historyRecovery: lot.trancheId, historyRecoveryKind: request.kind };
            button.closest = selector => selector === '[data-history-recovery]' ? button : null;
            const host = doc.getElementById('managerHousehold');
            host.querySelectorAll = selector => selector === '[data-history-recovery]' ? [button] : [];
            writes.length = 0;
            const stableBatchCount = batches.length;
            button.focus();
            if (cancel) {
                await completePageDialog(Promise.all(host.listeners.click.map(handler => handler({ target: button }))), doc, 'cancel');
                assertEqual(doc.activeElement, button, 'Nachfrageabbruch wartet auf Rerender und Rückfokus des Aktionsknopfs');
                assertEqual(status.textContent, '', 'Abbruch behauptet keinen Reparaturerfolg');
            } else initTranchenManagerPage({ profileId: 'a' });
            assertEqual(writes.length, 0, 'Nach vollständigem Ladeabschluss bleiben Fokus, Kontrollrender und Nachfrageabbruch schreibfrei');
            await originalFlush.call(PersistenceFacade);
            assertEqual(batches.length, stableBatchCount, 'Abbruch hinterlässt auch keinen verzögerten Write');
            for (const key of keys) assertEqual(snapshot()[key], settled[key], `Nachfrageabbruch nach Ladeabschluss erhält ${key} bytegleich`);
            assertEqual(JSON.stringify(JSON.parse(settled.rs_profiles_v1).profiles.b), JSON.stringify(registry.profiles.b), 'Ladebootstrap und Abbruch erhalten Fremdprofilbytes');
            assertEqual(JSON.stringify(JSON.parse(settled.rs_profiles_v1).trancheReconciliation), JSON.stringify(registry.trancheReconciliation), 'Ladebootstrap und Abbruch erhalten Auditbytes');
        } finally {
            release(); if (loadingFlush) await loadingFlush;
            persistenceStorage.setItem = setItem; persistenceStorage.removeItem = removeItem;
            globalThis.confirm = savedGlobals.confirm;
        }
    }
    // Echter Controller samt Dialogentscheidung, Lifecycle und injiziertem Backend.
    for (const removed of [false, true]) {
        const { captureWealthLots, PROFILE_WEALTH_LOTS_KEY } = await import('../app/profile/profile-wealth-history.js');
        const { doc, backend, hold, release, holds } = await setup();
        const original = { ...lot, purchaseDate: '2026-01-02' };
        const current = removed ? [] : [{ ...original, shares: 3, purchaseDate: '2026-01-05' }];
        const copies = captureWealthLots(JSON.stringify(captureWealthLots(null, [original], '2026-01-03')), current, '2026-01-06');
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        registry.profiles.a.data.depot_tranchen = JSON.stringify(current);
        registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY] = JSON.stringify(copies);
        for (const [key, raw] of Object.entries(registry.profiles.a.data)) persistenceStorage.setItem(key, raw);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        await originalFlush.call(PersistenceFacade);
        const status = doc.register(new MockElement('managerHistoryRecoveryStatus'));
        initTranchenManagerPage({ profileId: 'a' });
        const request = { trancheId: lot.trancheId, kind: removed ? 'discard' : 'correct' };
        assert(doc.getElementById('managerHousehold').innerHTML.includes(removed ? 'Fehleingabe aus dem Verlauf verwerfen' : 'Korrigierten Bestand für den Verlauf bestätigen'), 'Aktive Personenkarte bietet passenden nativen Reparaturknopf');
        const before = JSON.stringify([...backend]);
        assertEqual(await repairManagerHistory(request, { confirmCorrection: () => false }), false, 'Abgebrochene Nachfrage meldet keinen Erfolg');
        assertEqual(JSON.stringify([...backend]), before, 'Nachfrageabbruch erhält alle Backendbytes');
        hold();
        const failing = repairManagerHistory(request, { confirmCorrection: () => true });
        await waitFor(() => holds.length > 0, 'Reparaturfehlflush erreicht injiziertes Backend');
        holds[0].reject(new Error('synthetischer Reparaturfehlflush')); release();
        assertEqual(await failing, false, 'Fehlflush zeigt keinen Erfolg');
        assert(status.textContent.includes('nicht repariert'), 'Fehlflush nennt erneute Bestätigung als Retryweg');
        assertEqual(JSON.stringify([...backend]), before, 'Controllerfehlflush rollt beide Records zurück');
        assertEqual(persistenceStorage.getItem(PROFILE_WEALTH_LOTS_KEY), registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY], 'Livekopie nach Fehlflush zurückgerollt');
        holds.splice(0);
        let confirmation, questions = 0;
        const action = repairManagerHistory(request, { confirmCorrection: () => { questions++; return new Promise(resolve => { confirmation = resolve; }); } });
        const guard = getPageNavigationGuard(doc);
        assert(guard.reasons().some(reason => reason.phase === 'preparing'), 'Nachfrage besitzt den echten Vorbereitungslifecycle');
        assertEqual(await repairManagerHistory(request, { confirmCorrection: () => { questions++; return true; } }), false, 'Doppelklick öffnet keine konkurrierende Nachfrage');
        assertEqual(questions, 1, 'Genau eine Bestätigungsnachfrage');
        hold(); confirmation(true);
        await waitFor(() => holds.length > 0, 'Reparatur erreicht kontrollierten Backendflush');
        assertEqual(status.textContent.includes('bestätigt'), false, 'Vor Flush kein falscher Erfolgsstatus');
        assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Reparatur hält Commitbesitz bis Backendabschluss');
        release(); assertEqual(await action, true, 'Bestätigte Reparatur erfolgreich');
        assert(status.textContent.includes(removed ? 'verworfen' : 'vorläufig'), 'Aktueller DOM-Status nennt Ergebnis und manuelle Vorläufigkeit');
        assertEqual(doc.activeElement, status, 'Entfernter Aktionsknopf gibt Fokus an den Ergebnisstatus zurück');
        assertEqual(backend.get(PROFILE_WEALTH_LOTS_KEY), JSON.parse(backend.get('rs_profiles_v1')).profiles.a.data[PROFILE_WEALTH_LOTS_KEY], 'Controller bestätigt Live- und Registryrecord atomar');
        assertEqual(JSON.stringify(JSON.parse(backend.get('rs_profiles_v1')).profiles.b), JSON.stringify(registry.profiles.b), 'Controller erhält fremde Profilbytes');
        const repaired = backend.get(PROFILE_WEALTH_LOTS_KEY);
        initTranchenManagerPage({ profileId: 'a' });
        assertEqual(backend.get(PROFILE_WEALTH_LOTS_KEY), repaired, 'Lesender Reload erzeugt keinen Reparaturwrite');
        assert(!doc.getElementById('managerHousehold').innerHTML.includes('data-history-recovery='), 'Reparierte Kopie bietet keinen wiederholbaren Schreibknopf');
    }
    for (const lost of ['document', 'profile', 'source']) {
        const { captureWealthLots, PROFILE_WEALTH_LOTS_KEY } = await import('../app/profile/profile-wealth-history.js');
        const { doc, backend } = await setup();
        const original = { ...lot, purchaseDate: '2026-01-02' };
        const current = [{ ...original, shares: 3 }];
        const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        registry.profiles.a.data.depot_tranchen = JSON.stringify(current);
        registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY] = JSON.stringify(captureWealthLots(JSON.stringify(captureWealthLots(null, [original])), current));
        for (const [key, raw] of Object.entries(registry.profiles.a.data)) persistenceStorage.setItem(key, raw);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        await originalFlush.call(PersistenceFacade); initTranchenManagerPage({ profileId: 'a' });
        let resolve;
        const action = repairManagerHistory({ trancheId: lot.trancheId, kind: 'correct' }, { confirmCorrection: () => new Promise(done => { resolve = done; }) });
        if (lost === 'document') global.document = createTranchenPageDom();
        if (lost === 'profile') initTranchenManagerPage({ profileId: 'b' });
        if (lost === 'source') persistenceStorage.setItem('depot_tranchen', JSON.stringify(current) + ' ');
        const before = persistenceStorage.getItem(PROFILE_WEALTH_LOTS_KEY), oldRegistry = persistenceStorage.getItem('rs_profiles_v1');
        resolve(true); assertEqual(await action, false, 'Kontext-/Quellwechsel während Nachfrage verhindert Reparatur');
        assertEqual(persistenceStorage.getItem(PROFILE_WEALTH_LOTS_KEY), before, 'Verlorene Nachfrage verändert keine Lotbytes');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), oldRegistry, 'Verlorene Nachfrage verändert keine Registrybytes');
        assertEqual(backend.get(PROFILE_WEALTH_LOTS_KEY), before, 'Kein Reparaturwrite im Backend nach Kontextverlust');
        global.document = doc;
    }
    // Der Abgleich wartet mit derselben Action-ID auf eine ausdrückliche Entscheidung.
    for (const outcome of ['cancel', 'accept', 'stale', 'profile-change']) {
        const { doc, backend, batches } = await setup();
        await doc.getElementById('depotOpenSaleEntryBtn').click();
        for (const [id, value] of Object.entries({ reconcileTrancheId: lot.trancheId, reconcileExecutedAt: '2026-10-06',
            reconcileSharesSold: '1', reconcileGrossProceeds: '120', reconcileFees: '2', reconcileCashStatus: 'pending_manual_posting' })) doc.getElementById(id).value = value;
        await doc.getElementById('saleNextBtn').click();
        assertEqual(doc.getElementById('reconciliationForm').listeners.submit[0]({ preventDefault() {} }), true, 'Abgleichvorschau ist schreibfrei bereit');
        await originalFlush.call(PersistenceFacade);
        const before = persistenceStorage.getItem('rs_profiles_v1'), count = batches.length;
        const pending = doc.getElementById('reconciliationConfirmBtn').click();
        await Promise.resolve(); await doc.getElementById('reconciliationConfirmBtn').click();
        assertEqual(doc.pageDialogs.length, 1, 'Abgleichdoppelklick öffnet nur eine Rückfrage');
        assertEqual(batches.length, count, 'Wartender Abgleich startet keinen Adapterwrite');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Wartender Abgleich ändert weder Audit noch Registry');
        let newer = before;
        if (outcome === 'stale') {
            const registry = JSON.parse(before); registry.profiles.b.meta.name = 'Neuer Bestand';
            newer = JSON.stringify(registry); persistenceStorage.setItem('rs_profiles_v1', newer);
        }
        if (outcome === 'profile-change') persistenceStorage.setItem('rs_active_profile', 'b');
        await respondPageDialog(doc, outcome === 'cancel' ? 'escape' : 'accept'); await pending;
        if (outcome === 'accept') {
            const audit = JSON.parse(backend.get('rs_profiles_v1')).trancheReconciliation.actions;
            assertEqual(audit.length, 1, 'Zustimmung dokumentiert genau eine Ausführung');
            assertEqual(backend.get('profile_tagesgeld'), '100', 'Abgleich bestätigt keine automatische Cashbuchung');
        } else assertEqual(persistenceStorage.getItem('rs_profiles_v1'), newer, 'Abgleichabbruch oder Quellwechsel erhalten die Registry');
    }

    // Ein bereits geplanter Autosave pausiert während der Löschentscheidung und bleibt bei Abbruch erhalten.
    for (const outcome of ['escape', 'cancel', 'stale', 'abort']) {
        const { doc, backend, batches } = await setup();
        await originalFlush.call(PersistenceFacade);
        const before = persistenceStorage.getItem('rs_profiles_v1'), count = batches.length;
        assertEqual(input(doc, 'profileTagesgeld', '321'), true, 'Profileingabe plant einen echten Autosave');
        const pending = manageManagerPerson({ kind: 'delete', profileId: 'b' });
        // Länger als die reguläre Entprellzeit warten: während der Frage bleiben auch verzögerte Writes aus.
        await new Promise(resolve => setTimeout(resolve, 350));
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '100', 'Vor Löschentscheidung kein Cashwrite');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Vor Löschentscheidung kein Registrywrite');
        assertEqual(batches.length, count, 'Vor Löschentscheidung kein Autosavebatch');
        if (outcome === 'stale') {
            const registry = JSON.parse(before); registry.profiles.b.meta.name = 'Inzwischen geändert';
            persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        }
        if (outcome === 'abort') {
            const guard = getPageNavigationGuard(doc);
            const owners = guard.reasons().filter(reason => reason.phase === 'preparing').map(reason => reason.owner);
            assertEqual(owners.length, 1, 'Löschrückfrage besitzt einen abbrechbaren Vorbereitungslifecycle');
            const attempt = await guard.prepare({ owners, decide: async () => true });
            if (attempt) guard.end(attempt);
        } else await respondPageDialog(doc, outcome === 'stale' ? 'accept' : outcome);
        assertEqual(await pending, false, 'Abbruch oder Quellwechsel lehnt die Löschung ab');
        await waitFor(() => backend.get('profile_tagesgeld') === '321', 'Nach Abbruch wird der ausstehende Autosave dauerhaft gespeichert');
        const registry = JSON.parse(backend.get('rs_profiles_v1'));
        assertEqual(registry.profiles.a.data.profile_tagesgeld, '321', 'Autosave bestätigt den eingegebenen Wert auch im Ursprungsprofil');
        assertEqual(registry.profiles.b.meta.name, outcome === 'stale' ? 'Inzwischen geändert' : 'Person B', 'Autosave erhält die fremde Person samt neuer Quellwerte');
    }

    // Wartende Profillöschung: kein Autosave, kein Doppelklick und kein Löschen neuer Registrydaten.
    for (const outcome of ['cancel', 'accept', 'stale', 'profile-change']) {
        const { doc, backend, batches } = await setup();
        await originalFlush.call(PersistenceFacade);
        const before = persistenceStorage.getItem('rs_profiles_v1'), count = batches.length;
        const pending = manageManagerPerson({ kind: 'delete', profileId: 'b' });
        await Promise.resolve();
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Vor Entscheidung keine Profillöschung oder Autosave');
        assertEqual(batches.length, count, 'Vor Entscheidung keine Adapterwrites');
        assertEqual(await manageManagerPerson({ kind: 'delete', profileId: 'b' }), false, 'Doppelklick während Rückfrage bleibt gesperrt');
        let newer = before;
        if (outcome === 'stale') {
            const registry = JSON.parse(before); registry.profiles.b.meta.name = 'Inzwischen geändert';
            newer = JSON.stringify(registry); persistenceStorage.setItem('rs_profiles_v1', newer);
        }
        if (outcome === 'profile-change') {
            persistenceStorage.setItem('rs_current_profile', 'b'); persistenceStorage.setItem('rs_active_profile', 'b');
            initTranchenManagerPage({ profileId: 'b' }); newer = persistenceStorage.getItem('rs_profiles_v1');
        }
        await respondPageDialog(doc, outcome === 'cancel' ? 'escape' : 'accept');
        assertEqual(await pending, outcome === 'accept', 'Nur aktuelle ausdrückliche Zustimmung löscht das Profil');
        if (outcome !== 'accept') assertEqual(persistenceStorage.getItem('rs_profiles_v1'), newer, 'Abbruch und Quellwechsel erhalten Registrybytes');
        else assert(!JSON.parse(backend.get('rs_profiles_v1')).profiles.b, 'Bestätigte Löschung ist dauerhaft');
    }
} finally {
    PersistenceFacade.flush = originalFlush;
    PersistenceFacade.resetPersistenceForTests();
    Object.assign(globalThis, savedGlobals);
}
