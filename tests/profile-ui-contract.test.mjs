import { installPageDialogDom, respondPageDialog } from './helpers/page-dialog-dom.mjs';
import path from 'node:path';
import strict from 'node:assert/strict';
import { syncSelectionText } from '../app/shared/designsystem-selection-text.js';
import { createSelectionDocument, addField, functionSource } from './designsystem-selection-dom.mjs';
import { createProfile, getCurrentProfileId, listProfiles, renameProfile } from '../app/profile/profile-storage.js';
import { fileURLToPath } from 'node:url';
import {
    renderProfilverbundProfileSelector,
    toggleProfilverbundMode
} from '../app/profile/profilverbund-balance-ui.js';
import {
    buildProfilverbundAssetSummary,
    buildProfilverbundProfileSummaries
} from '../app/profile/profilverbund-balance.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { getPageNavigationGuard, reloadGuardedPage } from '../app/shared/navigation-guard-dialog.js';
import { renderSuiteProfile } from '../app/shared/suite-frame.js';

const __filename = fileURLToPath(import.meta.url);

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(name) { this.classes.add(name); }
    contains(name) { return this.classes.has(name); }
}

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = String(tagName).toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.checked = false;
        this.dataset = {};
        this.style = { display: '' };
        this.listeners = {};
        this.children = [];
        this.classList = new MockClassList();
    }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    dispatch(type, event = {}) {
        return Promise.all((this.listeners[type] || []).map(handler => handler({ type, target: this, ...event })));
    }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.listeners = {};
        this.readyState = 'loading';
        this.visibilityState = 'visible';
    }
    createElement(tagName) {
        return new MockElement('', tagName);
    }
    register(element) {
        this.elements.set(element.id, element);
        return element;
    }
    getElementById(id) {
        return this.elements.get(id) || null;
    }
    querySelectorAll(selector) {
        if (selector === '.profilverbund-toggle-target') {
            return Array.from(this.elements.values()).filter(el => el.classList.contains('profilverbund-toggle-target'));
        }
        if (selector === 'a[href][data-profile-handoff]') return [];
        return [];
    }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }
    removeEventListener(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter(fn => fn !== handler);
    }
    async dispatch(type, event = {}) {
        const handlers = this.listeners[type] || [];
        await Promise.all(handlers.map(handler => handler({ type, ...event })));
    }
}


function installResetDialog(doc) {
    for (const id of ['navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave', 'suiteNavigationStatus']) {
        const el = doc.register(new MockElement(id, 'button'));
        el.isConnected = true;
        el.focus = () => { doc.activeElement = el; };
        el.showModal = () => { el.open = true; };
        el.close = () => { el.open = false; (el.listeners.close || []).slice().forEach(fn => fn()); };
        el.removeEventListener = (type, fn) => { el.listeners[type] = (el.listeners[type] || []).filter(current => current !== fn); };
    }
    return id => (doc.getElementById(id).listeners.click || []).slice().forEach(fn => fn());
}

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: key => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: key => { store.delete(String(key)); },
        clear: () => { store.clear(); },
        key: index => Array.from(store.keys())[index] || null,
        get length() { return store.size; }
    };
}

function registerProfileManagerDom(doc) {
    [
        'profileSelect',
        'profileNameInput',
        'profileCreateBtn',
        'profileRenameBtn',
        'profileDeleteBtn',
        'profileSaveBtn',
        'activeProfileBadge',
        'profileStatus'
    ].forEach(id => {
        const tagName = id === 'profileSelect' ? 'select' : (id.endsWith('Btn') ? 'button' : 'input');
        doc.register(new MockElement(id, tagName));
    });
}

const previousGlobals = {
    document: global.document,
    window: global.window,
    localStorage: global.localStorage,
    confirm: global.confirm
};

function installGlobals(doc, storage) {
    global.document = doc;
    global.localStorage = storage;
    global.confirm = () => true;
    global.window = {
        name: 'RUHESTAND_PROFILE_BUNDLE:not-json',
        location: { reload() {} },
        addEventListener(type, handler) {
            if (!this.listeners) this.listeners = {};
            if (!this.listeners[type]) this.listeners[type] = [];
            this.listeners[type].push(handler);
        },
        listeners: {}
    };
}

function shouldRun() {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const requestedTest = process.argv[2] ? path.resolve(process.argv[2]) : '';
    return entry === __filename
        || (entry.endsWith(`${path.sep}run-single.mjs`) && requestedTest === __filename);
}

async function runProfileUiContractTests() {
    console.log('--- Profile UI Contract Tests ---');

    console.log('Test 1: Profilverbund selector renders one row per profile and toggles targets');
    {
        const doc = new MockDocument();
        global.document = doc;
        const container = doc.register(new MockElement('profilverbund-profile-list'));
        const target = doc.register(new MockElement('target'));
        target.classList.add('profilverbund-toggle-target');

        renderProfilverbundProfileSelector([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B', belongsToHousehold: false }
        ]);
        toggleProfilverbundMode(true);

        assertEqual(container.children.length, 2, 'Selector should render exactly one row per profile');
        assertEqual(container.children[0].children[0].checked, true, 'Household profiles should be checked by default');
        assertEqual(container.children[1].children[0].checked, false, 'Opted-out profiles should be unchecked');
        assertEqual(target.style.display, 'block', 'Toggle target should be visible in Profilverbund mode');

        toggleProfilverbundMode(false);
        assertEqual(target.style.display, 'none', 'Toggle target should be hidden outside Profilverbund mode');
    }
    console.log('✓ Profilverbund selector UI OK');

    console.log('Test 2: Profilverbund summaries prefer detailed tranches over aggregate fields');
    {
        const profiles = [{
            profileId: 'a',
            inputs: {
                tagesgeld: 10,
                geldmarktEtf: 999,
                depotwertAlt: 999,
                depotwertNeu: 999,
                goldWert: 999,
                costBasisAlt: 999,
                costBasisNeu: 999,
                goldCost: 999
            },
            tranches: [
                { trancheId: 'alt', marketValue: 100, costBasis: 70, type: 'aktien_alt' },
                { trancheId: 'neu', marketValue: 50, costBasis: 45, type: 'aktien_neu' },
                { trancheId: 'gold', marketValue: 20, costBasis: 15, type: 'gold', category: 'gold' },
                { trancheId: 'mm', marketValue: 30, costBasis: 30, type: 'geldmarkt', category: 'money_market' }
            ]
        }];

        const summary = buildProfilverbundAssetSummary(profiles);
        const profileSummary = buildProfilverbundProfileSummaries(profiles)[0];

        assertEqual(summary.totalDepotAlt, 100, 'Asset summary should use detailed alt tranches');
        assertEqual(summary.totalDepotNeu, 50, 'Asset summary should use detailed neu tranches');
        assertEqual(summary.totalGold, 20, 'Asset summary should use detailed gold tranches');
        assertEqual(summary.totalGeldmarkt, 30, 'Asset summary should use detailed money-market tranches');
        assertEqual(profileSummary.totalAssets, 210, 'Profile summary should not double-count aggregate fallback fields');

        const explicitEmpty = [{
            profileId: 'empty',
            inputs: { tagesgeld: 10, depotwertAlt: 999, depotwertNeu: 999, goldWert: 999, geldmarktEtf: 999 },
            tranches: [],
            hasExplicitTrancheOverride: true
        }];
        const emptySummary = buildProfilverbundAssetSummary(explicitEmpty);
        const emptyProfileSummary = buildProfilverbundProfileSummaries(explicitEmpty)[0];
        assertEqual(emptySummary.totalDepotAlt, 0, 'Explicit empty tranches must suppress aggregate equity fallback');
        assertEqual(emptySummary.totalGeldmarkt, 0, 'Explicit empty tranches must suppress aggregate money-market fallback');
        assertEqual(emptySummary.mergedTranches.length, 0, 'Explicit empty tranches must not synthesize household lots');
        assertEqual(emptyProfileSummary.totalAssets, 10, 'Explicit empty tranches should retain only non-tranche cash');
    }
    console.log('✓ Profilverbund asset double-count guard OK');

    console.log('Test 3: profile-manager handles missing profiles without throwing');
    {
        const doc = new MockDocument();
        const storage = createLocalStorageMock();
        installGlobals(doc, storage);
        registerProfileManagerDom(doc);
        PersistenceFacade.resetPersistenceRuntimeForTests();

        await import('../app/profile/profile-manager.js');
        await doc.dispatch('DOMContentLoaded');

        const select = doc.getElementById('profileSelect');
        const status = doc.getElementById('profileStatus');
        select.value = 'missing-profile';
        await select.dispatch('change');

        assertEqual(status.textContent, 'Profil konnte nicht geladen werden.', 'Missing profile switch should render controlled error');
        assertEqual(status.dataset.kind, 'error', 'Missing profile switch should mark error status');
    }
    console.log('✓ profile-manager missing profile handling OK');

    console.log('Test 4: Echter Profilhandler trennt Anzeige, Cache und bestätigten Adapter');
    {
        const doc = new MockDocument(), selectionDoc = createSelectionDocument();
        installGlobals(doc, createLocalStorageMock());
        registerProfileManagerDom(doc);
        doc.register(new MockElement('suiteProfileContext'));
        const select = addField(selectionDoc, 'profileSelect', '', []);
        doc.register(select);
        doc.createElement = selectionDoc.createElement;
        const originalGet = doc.getElementById.bind(doc);
        doc.getElementById = id => originalGet(id) || selectionDoc.getElementById(id);
        const confirmed = new Map();
        let gate = null, writes = 0, flushes = 0;
        const adapter = {
            name: 'Kontrollierter Adapter',
            async init() {},
            async loadAll() { return Object.fromEntries(confirmed); },
            async saveBatch(batch) {
                writes++;
                if (gate) { gate.enter(); await gate.promise; }
                for (const key of batch.deletes) confirmed.delete(key);
                for (const [key, value] of batch.upserts) confirmed.set(key, value);
            }
        };
        const timers = new Map();
        const nativeTimeout = global.setTimeout, nativeClear = global.clearTimeout;
        global.setTimeout = fn => { const token = {}; timers.set(token, fn); return token; };
        global.clearTimeout = token => timers.delete(token);
        const realFlush = PersistenceFacade.flush;
        try {
            PersistenceFacade.resetPersistenceForTests(adapter);
            await import('../app/profile/profile-manager.js?controlled-handler');
            await doc.dispatch('DOMContentLoaded');
            const nameB = 'Synthetisches Profil B – ' + 'Langer vollständiger Name '.repeat(12);
            const b = createProfile('Profil B'), c = createProfile('Profil C');
            renameProfile(b.id, nameB);
            new Function('listProfiles', 'syncSelectionText', `${functionSource('app/profile/profile-manager.js', 'renderProfiles')}\nreturn renderProfiles;`)(listProfiles, syncSelectionText)(select, getCurrentProfileId());
            await realFlush(); // Nur Fixtureaufbau, niemals die Wechselaktion.
            const a = getCurrentProfileId();
            const status = doc.getElementById('profileStatus');
            const writeGuard = getPageNavigationGuard(doc, window);
            let statusText = status.textContent;
            Object.defineProperty(status, 'textContent', { configurable: true, get: () => statusText, set: value => {
                if (String(value).startsWith('Profil gewechselt') || String(value).startsWith('Profil konnte nicht geladen')) {
                    assert(writeGuard.reasons().some(reason => reason.phase === 'commit'), 'Profil-Erfolgs-/Fehlerfortsetzung bleibt bis zur Statusanzeige im eigenen Commit');
                }
                statusText = value;
            } });
            const badge = doc.getElementById('activeProfileBadge');
            const change = () => Promise.all(select.listeners.change.map(fn => fn({ target: select })));
            const measure = () => ({
                selection: select.value,
                fulltext: selectionDoc.getElementById('profileSelect-fulltext').textContent,
                current: getCurrentProfileId(), badge: badge.textContent,
                header: doc.getElementById('suiteProfileContext').textContent,
                cache: ['rs_current_profile', 'rs_active_profile'].map(key => PersistenceFacade.getItemSync(key)),
                backend: ['rs_current_profile', 'rs_active_profile'].map(key => confirmed.get(key)),
                status: status.textContent, kind: status.dataset.kind
            });
            const openWrite = () => {
                const next = {};
                next.promise = new Promise((yes, no) => { next.resolve = yes; next.reject = no; });
                next.entered = new Promise(yes => { next.enter = yes; });
                return next;
            };
            gate = openWrite();
            const bWrite = gate;
            PersistenceFacade.flush = () => { flushes++; return realFlush(); };
            status.textContent = 'Vorheriger Erfolg'; status.dataset.kind = 'ok';
            select.value = b.id;
            const pending = change();
            await bWrite.entered;
            const guard = getPageNavigationGuard(doc, window);
            assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Echter Profilwechsel schützt den gesamten offenen Adapterwrite');
            assertEqual(await guard.prepare(), null, 'Navigation kann den echten Profilwechselwrite nicht überholen');
            const before = measure();
            console.log('Profilgrenzen bei offenem Write:', JSON.stringify(before));
            strict.equal(before.selection, b.id); strict.equal(before.fulltext, nameB);
            strict.equal(before.current, b.id); strict.ok(before.badge.includes(nameB));
            assertEqual(before.header, '', 'Kopf zeigt kein „Aktives Profil“ mehr (Nutzer 11.10.2026, D6); Badge trägt die lokale Identität');
            strict.deepEqual(before.cache, [b.id, b.id]); strict.deepEqual(before.backend, [a, a]);
            strict.equal(before.status, ''); strict.notEqual(before.kind, 'ok');
            const writesBefore = writes;
            select.value = c.id; await change();
            const competing = measure();
            strict.equal(competing.selection, b.id); strict.equal(competing.fulltext, nameB);
            strict.equal(competing.current, b.id); strict.ok(competing.badge.includes(nameB));
            assertEqual(competing.header, before.header, 'Abgewehrter zweiter Wechsel verändert die Kopfidentität nicht');
            strict.deepEqual(competing.backend, [a, a]); strict.equal(competing.status, '');
            strict.equal(writes, writesBefore); strict.equal(flushes, 1);
            gate = null; bWrite.resolve(); await pending;
            assertEqual(guard.reasons().length, 0, 'Erfolgreiche Profilfortsetzung quittiert nur ihren eigenen Commit');
            strict.equal(status.dataset.kind, 'ok');
            strict.deepEqual(measure().backend, [b.id, b.id]);
            assertEqual(flushes, 1, 'Erfolg folgt genau einem Produktflush, kein zusätzlicher C-Flush');
            assertEqual(writes, writesBefore, 'C-Versuch erzeugt keinen zusätzlichen Adapterwrite');
            // Unmittelbarer Reload liest nur den bestätigten Adapter, ohne Testflush.
            const reloadDoc = new MockDocument(), reloadSelection = createSelectionDocument();
            registerProfileManagerDom(reloadDoc);
            const reloadedSelect = addField(reloadSelection, 'profileSelect', '', []);
            reloadDoc.register(reloadedSelect); reloadDoc.createElement = reloadSelection.createElement;
            const reloadGet = reloadDoc.getElementById.bind(reloadDoc);
            reloadDoc.getElementById = id => reloadGet(id) || reloadSelection.getElementById(id);
            installGlobals(reloadDoc, createLocalStorageMock());
            PersistenceFacade.resetPersistenceForTests(adapter);
            await import('../app/profile/profile-manager.js?immediate-reload');
            await reloadDoc.dispatch('DOMContentLoaded');
            assertEqual(reloadedSelect.value, b.id, 'Sofortiger Reload erhält die dauerhaft bestätigte Auswahl B');
            assertEqual(reloadSelection.getElementById('profileSelect-fulltext').textContent, nameB, 'Sofortiger Reload erhält den langen Volltext B');
            assertEqual(getCurrentProfileId(), b.id, 'Sofortiger Reload erhält unabhängig die aktuelle ID B');
            installGlobals(doc, createLocalStorageMock());
            {
                // Flushablehnung und anschließender Wechsel belegen das finally der Wache.
                gate = openWrite();
                const cWrite = gate;
                select.value = c.id; const failed = change();
                await cWrite.entered;
                strict.equal(status.textContent, '');
                gate = null; cWrite.reject(new Error('Synthetischer Speicherfehler')); await failed;
                assertEqual(guard.reasons().length, 0, 'Profilflushfehler gibt den Schreibbesitzer erst nach Fehlerende frei');
                strict.equal(status.dataset.kind, 'error'); strict.ok(status.textContent.includes('Synthetischer'));
                select.value = b.id; await change();
                strict.equal(status.dataset.kind, 'ok'); strict.equal(getCurrentProfileId(), b.id);
                const missing = doc.createElement('option'); missing.value = 'missing-profile'; select.appendChild(missing);
                select.value = 'missing-profile'; await change();
                strict.equal(status.dataset.kind, 'error');
                select.value = c.id; await change(); strict.equal(status.dataset.kind, 'ok');
                // Recovery beim Zielprofil löst die Wache ebenfalls, ohne erfolgreichen Write.
                const registry = JSON.parse(PersistenceFacade.getItemSync('rs_profiles_v1'));
                registry.profiles[b.id].data['ruhestandsmodellValues_v29_guardrails'] = '{synthetisch-korrupt';
                PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify(registry));
                select.value = b.id; await change();
                strict.equal(status.dataset.kind, 'error');
                strict.ok(status.dataset.profileRecovery);
                registry.profiles[b.id].data['ruhestandsmodellValues_v29_guardrails'] = null;
                PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify(registry));
                select.value = b.id; await change(); strict.equal(status.dataset.kind, 'ok');
                // Andere Writes bleiben entprellt.
                const count = writes;
                PersistenceFacade.setItemSync('profile_tagesgeld', '123');
                await Promise.resolve(); strict.equal(writes, count); strict.ok(timers.size > 0);
            }
        } finally {
            PersistenceFacade.flush = realFlush;
            PersistenceFacade.resetPersistenceForTests();
            global.setTimeout = nativeTimeout; global.clearTimeout = nativeClear;
        }
    }

    // Beide Zustände des echten Startseitenhandlers: Entscheidung vor jedem Write.
    for (const outcome of ['cancel', 'accept', 'selection', 'registry']) {
        const doc = new MockDocument(), storage = createLocalStorageMock();
        registerProfileManagerDom(doc); installGlobals(doc, storage); installPageDialogDom(doc);
        const registry = { version: 1, profiles: {
            default: { meta: { id: 'default', name: 'Synthetischer Standard' }, data: {} },
            b: { meta: { id: 'b', name: 'Synthetische Person B' }, data: {} }
        } };
        storage.setItem('rs_profiles_v1', JSON.stringify(registry));
        storage.setItem('rs_current_profile', 'default'); storage.setItem('rs_active_profile', 'default');
        PersistenceFacade.resetPersistenceForTests();
        await import(`../app/profile/profile-manager.js?deletion-${outcome}`); await doc.dispatch('DOMContentLoaded');
        await PersistenceFacade.flush();
        const select = doc.getElementById('profileSelect'), button = doc.getElementById('profileDeleteBtn');
        select.value = 'b';
        const before = PersistenceFacade.getItemSync('rs_profiles_v1');
        const pending = button.dispatch('click'); await Promise.resolve();
        await button.dispatch('click');
        assertEqual(doc.pageDialogs.length, 1, 'Doppelklick öffnet nur eine Profillöschfrage');
        assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), before, 'Offene Profillöschfrage verändert keine Registry');
        let newer = before;
        if (outcome === 'selection') select.value = 'default';
        if (outcome === 'registry') {
            const changed = JSON.parse(before); changed.profiles.b.meta.name = 'Neuer Name';
            newer = JSON.stringify(changed); PersistenceFacade.setItemSync('rs_profiles_v1', newer);
        }
        await respondPageDialog(doc, outcome === 'cancel' ? 'cancel' : 'accept'); await pending;
        if (outcome === 'accept') assert(!JSON.parse(PersistenceFacade.getItemSync('rs_profiles_v1')).profiles.b, 'Zustimmung löscht genau das ursprünglich gewählte Profil');
        else assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), newer, 'Abbruch oder geänderte Auswahl/Registry erhalten Profilbytes');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Profilentscheidung räumt Operationsbesitz auf');
        PersistenceFacade.resetPersistenceForTests();
    }

    console.log('Test 5: Echter Recoveryreset erhält Exportpflicht, Schutzentscheidung und Wiederholung');
    {
        const doc = new MockDocument(), storage = createLocalStorageMock();
        registerProfileManagerDom(doc); installGlobals(doc, storage);
        doc.body = new MockElement('body');
        const createElement = doc.createElement.bind(doc);
        let exports = 0, reloads = 0, flushes = 0;
        doc.createElement = tag => {
            const el = createElement(tag);
            if (tag === 'a') { el.click = () => exports++; el.remove = () => {}; }
            return el;
        };
        installPageDialogDom(doc);
        storage.setItem('rs_profiles_v1', '{synthetisch-korrupt');
        PersistenceFacade.resetPersistenceForTests();
        await import('../app/profile/profile-manager.js?guarded-recovery');
        await doc.dispatch('DOMContentLoaded');
        const status = doc.getElementById('profileStatus'), message = status.children[0];
        const actions = status.children[1].children;
        const exportButton = actions.find(el => el.dataset.profileRecoveryAction === 'export');
        const resetButton = actions.find(el => el.dataset.profileRecoveryAction === 'reset');
        const realFlush = PersistenceFacade.flush;
        const guard = getPageNavigationGuard(doc, window), choose = installResetDialog(doc);
        window.location.reload = () => { reloads++; guard.revokeNative(); };
        const reason = guard.register('recovery-result', { read: () => ({ result: true }) });
        try {
            PersistenceFacade.flush = async () => { flushes++; return true; };
            await resetButton.dispatch('click');
            assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), '{synthetisch-korrupt', 'Recoveryreset ohne Export erhält korrupte Rohbytes');
            await exportButton.dispatch('click');
            assertEqual(exports, 1, 'Recoveryexport ist Voraussetzung des echten Resethandlers');
            const question = resetButton.dispatch('click');
            await resetButton.dispatch('click'); await exportButton.dispatch('click');
            assertEqual(doc.pageDialogs.length, 1, 'Resetdoppelklick öffnet nur eine Rückfrage');
            assert(resetButton.disabled && exportButton.disabled, 'Export und Reset sind schon während der Rückfrage gesperrt');
            assertEqual(exports, 1, 'Wartende Rückfrage erzeugt keinen zweiten Export');
            assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), '{synthetisch-korrupt', 'Vor Resetentscheidung keine Mutation');
            await respondPageDialog(doc, 'escape'); await question;
            assertEqual(flushes, 0, 'Escape startet weder Resetflush noch Navigation');
            assert(!resetButton.disabled && !exportButton.disabled, 'Escape gibt exportgebundenen Retry frei');
            const declined = resetButton.dispatch('click'); await respondPageDialog(doc); choose('navigationGuardStay'); await declined;
            assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), '{synthetisch-korrupt', 'Recovery-Bleiben erhält alle Rohbytes');
            assertEqual(flushes, 0, 'Recovery-Bleiben startet keinen Writeflush');
            assertEqual(reloads, 0, 'Recovery-Bleiben startet keinen Reload');
            let finish;
            PersistenceFacade.flush = () => new Promise(resolve => { finish = resolve; });
            const writing = resetButton.dispatch('click'); await respondPageDialog(doc); choose('navigationGuardLeave');
            for (let i = 0; i < 20; i++) await Promise.resolve();
            assert(guard.reasons().some(reason => reason.phase === 'commit'), 'Echter Recoveryreset schützt Mutation bis Flushende');
            assertEqual(await guard.prepare(), null, 'Navigation überholt den Recoveryresetflush nicht');
            finish(false); await writing;
            assertEqual(reloads, 0, 'Recovery-Flush-false verhindert Reload');
            assert(message.textContent.includes('nicht dauerhaft'), 'Recoveryflushfehler bleibt im bestehenden Recoveryhost');
            assertEqual(resetButton.disabled, false, 'Recoveryflushfehler erlaubt Wiederholung ohne zweiten Export');
            PersistenceFacade.flush = async () => true;
            const retry = resetButton.dispatch('click'); await respondPageDialog(doc); choose('navigationGuardLeave'); await retry;
            assertEqual(reloads, 1, 'Recoverywiederholung bestätigt bereits mutierte Daten und lädt genau einmal neu');
            assertEqual(exports, 1, 'Recoveryreload erzeugt weder zweiten Export noch Profilbundle');
        } finally { reason.unregister(); PersistenceFacade.flush = realFlush; PersistenceFacade.resetPersistenceForTests(); }
    }

    console.log('Test 6: Technisch nicht lesbares Recovery bietet nur geschützten Retry');
    {
        const doc = new MockDocument(), storage = createLocalStorageMock();
        registerProfileManagerDom(doc); installGlobals(doc, storage);
        const status = doc.getElementById('profileStatus'), choose = installResetDialog(doc);
        const guard = getPageNavigationGuard(doc, window);
        const render = new Function('renderSuiteProfile', 'reloadGuardedPage', 'flushProfileWrites',
            `${functionSource('app/profile/profile-recovery-ui.js', 'setProfileControlsDisabled')}\n${functionSource('app/profile/profile-recovery-ui.js', 'renderProfileRecovery')}\nreturn renderProfileRecovery;`)(
            renderSuiteProfile, reloadGuardedPage, async () => { if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED'); });
        render({ doc, win: window, statusEl: status, controls: [], recovery: { status: 'unavailable', canReset: false, message: 'Synthetisch nicht lesbar' } });
        const retry = status.children[1].children[0];
        let reloads = 0, flushes = 0;
        const realFlush = PersistenceFacade.flush;
        window.location.reload = () => { reloads++; guard.revokeNative(); };
        const reason = guard.register('retry-result', { read: () => ({ result: true }) });
        try {
            PersistenceFacade.flush = () => { flushes++; return false; };
            const declined = retry.dispatch('click'); choose('navigationGuardStay'); await declined;
            assertEqual(flushes, 0, 'Recoveryretry-Bleiben beginnt keinen Speicherflush');
            assertEqual(reloads, 0, 'Recoveryretry-Bleiben lädt nicht neu');
            const failed = retry.dispatch('click'); choose('navigationGuardLeave'); await failed;
            assertEqual(reloads, 0, 'Recoveryretry-Flush-false lädt nicht neu');
            assert(status.children[0].textContent.includes('fehlgeschlagen'), 'Recoveryretry meldet Speicherfehler am bestehenden Recoveryhost');
            assertEqual(retry.disabled, false, 'Recoveryretry ist nach Speicherfehler erneut bedienbar');
            PersistenceFacade.flush = () => true;
            const success = retry.dispatch('click'); choose('navigationGuardLeave'); await success;
            assertEqual(reloads, 1, 'Recoveryretry lädt ausschließlich nach eigener erneuter Zustimmung und Flush neu');
        } finally { reason.unregister(); PersistenceFacade.flush = realFlush; }
    }

    console.log('Test 7: profile-bridge tolerates invalid handoff data and installs lifecycle hooks');
    {
        const doc = new MockDocument();
        const storage = createLocalStorageMock();
        installGlobals(doc, storage);
        PersistenceFacade.resetPersistenceRuntimeForTests();

        await import('../app/profile/profile-bridge.js');
        await doc.dispatch('DOMContentLoaded');

        assertEqual(window.__rsProfilePersistenceHooksInstalled, true, 'Profile bridge should install persistence hooks');
        assertEqual(window.__rsProfileBfcacheRefreshInstalled, true, 'Profile bridge should install BFCache refresh hook');
    }
    console.log('✓ profile-bridge invalid handoff handling OK');

    console.log('✅ Profile UI contracts validated');
    console.log('--- Profile UI Contract Tests Completed ---');
}

if (shouldRun()) {
    try {
        await runProfileUiContractTests();
    } finally {
        PersistenceFacade.resetPersistenceForTests();
        Object.entries(previousGlobals).forEach(([key, value]) => {
            if (value === undefined) delete global[key];
            else global[key] = value;
        });
    }
}
