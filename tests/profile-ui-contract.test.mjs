import { installPageDialogDom, respondPageDialog } from './helpers/page-dialog-dom.mjs';
import { functionSource } from './designsystem-selection-dom.mjs';
import { getLastProfileBootstrapResult } from '../app/profile/profile-storage.js';
import { initProfileIndexLifecycle } from '../app/profile/profile-navigation.js';
import { renderProfileRecovery } from '../app/profile/profile-recovery-ui.js';
import { getPageNavigationGuard, reloadGuardedPage } from '../app/shared/navigation-guard-dialog.js';
import { renderSuiteProfile } from '../app/shared/suite-frame.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildProfilverbundAssetSummary,
    buildProfilverbundProfileSummaries
} from '../app/profile/profilverbund-balance.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';

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

    console.log('Test 5: Echter Recoveryreset erhält Exportpflicht, Schutzentscheidung und Wiederholung');
    {
        const doc = new MockDocument(), storage = createLocalStorageMock();
        doc.register(new MockElement('profileStatus', 'div')); installGlobals(doc, storage);
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
        await initProfileIndexLifecycle();
        const bootstrapResult = getLastProfileBootstrapResult();
        assertEqual(bootstrapResult?.action, 'recovery', 'Korrupte Registry führt beim Start in die Recovery');
        const status = doc.getElementById('profileStatus');
        renderProfileRecovery({ statusEl: status, recovery: bootstrapResult.recovery, controls: [], win: window, doc });
        const message = status.children[0];
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
        doc.register(new MockElement('profileStatus', 'div')); installGlobals(doc, storage);
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
