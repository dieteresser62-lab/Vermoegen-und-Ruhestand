import { createManagerHouseholdPlan } from '../app/tranches/tranchen-manager-household-plan.js';
import { detectDynamicFlexPreset, dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { PLAN_DEFAULTS, planScope, buildPlanRecord, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { readHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { flushManagerHouseholdPlan, switchManagerProfile } from '../app/tranches/tranchen-manager-page.js';
import { installPageDialogDom, respondPageDialog, completePageDialog } from './helpers/page-dialog-dom.mjs';
import { renderManagerQuoteContext } from '../app/tranches/tranchen-manager-renderer.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { describeLegacyTaxMigration, initTranchenManagerPage, openManagerOverviewTarget, getManagerCashPostingDiagnostics } from '../app/tranches/tranchen-manager-page.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { loadTranchesFromStorage } from '../app/tranches/tranchen-manager-state.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { bindCashPostingModalLifecycle, closeCashPostingModal, captureManagerModalSubmission, isManagerModalSubmissionCurrent, finishManagerModalSubmission } from '../app/tranches/tranchen-manager-modal.js';
import { canonicalDecimalInput } from '../app/tranches/tranchen-manager-decimal-input.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { WEALTH_HISTORY_START_KEY } from '../app/tranches/tranchen-history-store.js';
import { commitCashPostingConfirmation, commitCashPostingCorrection } from '../app/tranches/tranche-reconciliation.js';
import { functionSource } from './designsystem-selection-dom.mjs';

const __filename = fileURLToPath(import.meta.url);
const decimalFinishSource = ['managerDecimalSignatureValue', 'finishManagerDecimalSubmission']
    .map(name => functionSource('app/tranches/tranchen-manager-page.js', name)).join('\n');

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(name) { this.classes.add(name); }
    remove(name) { this.classes.delete(name); }
    contains(name) { return this.classes.has(name); }
}

export class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = String(tagName).toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.type = '';
        this.dataset = {};
        this.style = { display: '' };
        this.listeners = {};
        this.children = [];
        this.attributes = new Map();
        this.options = [];
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
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { if (global.document) global.document.activeElement = this; }
    querySelectorAll() { return []; }
    dispatchEvent(event) {
        for (const handler of this.listeners[event.type] || []) handler(event);
        return true;
    }
    async click() {
        const results = (this.listeners.click || []).map(handler => handler({ target: this, preventDefault() {} }));
        await Promise.all(results);
    }
    closest(selector) {
        if (selector === '[data-action]' && this.dataset.action) return this;
        if (selector === '[data-cash-action]' && this.dataset.cashAction) return this;
        if (selector === '[data-person-action]' && this.dataset.personAction) return this;
        if (selector === '[data-person-membership]' && this.dataset.personMembership) return this;
        return null;
    }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.created = [];
        this.listeners = {};
        this.visibilityState = 'visible';
        this.activeElement = null;
        // Dynamische Dialogelemente entstehen ausschließlich aus dem von der
        // Produktion angehängten Markup, nicht aus vorab bereitgestellten IDs.
        this.body = { appendChild: element => {
            this.register(element);
            for (const match of element.innerHTML.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
                const child = this.register(new MockElement(match[3], match[1]));
                child.hidden = /\bhidden\b/.test(match[2]);
                child.required = /\brequired\b/.test(match[2]);
                element.appendChild(child);
            }
            for (const form of element.innerHTML.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
                const fields = Array.from(form[2].matchAll(/<(?:input|textarea|select)\b[^>]*id="([^"]+)"/g), match => this.getElementById(match[1]));
                this.getElementById(form[1]).reset = () => {
                    for (const handler of this.getElementById(form[1]).listeners.reset || []) handler({ type: 'reset' });
                    fields.forEach(field => { field.value = ''; });
                };
            }
            return element;
        } };
    }
    createElement(tagName) {
        const element = new MockElement('', tagName);
        this.created.push(element);
        return element;
    }
    register(element) {
        this.elements.set(element.id, element);
        return element;
    }
    getElementById(id) {
        return this.elements.get(id) || null;
    }
    addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }
}

export function createLocalStorageMock() {
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

const profileInputIds = [
    'profileGeburtsdatum', 'profileGeschlecht', 'profileRentenbeginn', 'profileRentenanpassungArt',
    'profileRentenanpassungPct', 'profileKirchensteuerPct', 'profileSparerPauschbetrag', 'profileRenteSteuerquotePct',
    'profileTagesgeld',
    'profileAlter',
    'profileRenteMonatlich',
    'profileSonstigeEinkuenfte',
    'profileGoldAktiv',
    'profileGoldZiel',
    'profileGoldFloor',
    'profileGoldBand',
    'profileGoldSteuerfrei',
    'profileHealthBucketEnabled',
    'profileHealthBucketInitialAmount',
    'profileHealthBucketAssetSource',
    'profileHealthBucketTriggerMinGrade',
    'profileHealthBucketTriggerMode',
    'profileHealthBucketCoverageMode',
    'profileHealthBucketReturnMode',
    'profileHealthBucketTargetMode'
];

export function createTranchenPageDom() {
    const doc = new MockDocument();
    [
        'suiteProfileContext',
        'managerDepotCount',
        'managerPersonProfileName',
        'managerCareActive',
        'profileRenteAktiv',
        'profileManagePeopleBtn',
        'managerTechnicalProfile',
        'managerBackLink',
        'stats',
        'tranchenTable',
        'priceUpdateStatus',
        'tranchePersistenceStatus',
        'profileValidationStatus',
        'trancheRecoveryActions',
        'corruptPayloadPreview',
        'modalTitle',
        'trancheModal',
        'trancheForm',
        'trancheFormError',
        'name',
        'isin',
        'ticker',
        'shares',
        'purchasePrice',
        'currentPrice',
        'purchaseDate',
        'category',
        'type',
        'tqf',
        'taxExempt',
        'notes',
        'reconciliationForm',
        'reconciliationStatus',
        'reconciliationCashChoice',
        'reconciliationCashStatuses',
        'reconcileCashStatus',
        'reconcileInitialCashBalanceGroup',
        'reconcileInitialCashBalance'
    ].forEach(id => doc.register(new MockElement(id)));
    // Dieselbe ID liegt jetzt am tatsächlichen Rahmenlink, nicht an einem zweiten Inhaltslink.
    const managerHtml = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    assert(managerHtml.includes('class="persistence-panel ds-note"'), 'Speicherbandadapter verwendet die tatsächliche Sektion');
    doc.persistencePanel = new MockElement('', 'section');
    doc.getElementById('tranchePersistenceStatus').closest = selector => selector === '.persistence-panel' ? doc.persistencePanel : null;
    const backMarkup = managerHtml.match(/<nav class="suite-navigation"[^>]*>[\s\S]*?(<a\b[^>]*id="managerBackLink"[^>]*>)/)?.[1];
    assert(backMarkup?.includes('href="index.html" data-profile-handoff'), 'Manager-Testadapter verwendet den tatsächlich gebundenen Rahmenlink');
    const backLink = new MockElement('managerBackLink', 'a');
    backLink.setAttribute('href', 'index.html');
    backLink.setAttribute('data-profile-handoff', '');
    doc.register(backLink);
    [
        'depotAddTrancheBtn',
        'updatePricesBtn',
        'proxyHealthBtn',
        'clearTranchesBtn',
        'closeTrancheModalBtn',
        'revealCorruptPayloadBtn',
        'copyCorruptPayloadBtn',
        'resetCorruptPayloadBtn',
        'retryTrancheLoadBtn',
        'retryTrancheSaveBtn',
        'retryTrancheDialogSaveBtn',
        'reconciliationPreviewBtn',
        'reconciliationConfirmBtn',
        'reconciliationCancelBtn'
    ].forEach(id => doc.register(new MockElement(id, 'button')));
    profileInputIds.forEach(id => {
        const tagName = id.includes('Aktiv') || id.includes('Steuerfrei') || id.includes('Mode') || id.includes('Source') || id.includes('Enabled') ? 'select' : 'input';
        doc.register(new MockElement(id, tagName));
    });
    for (const id of ['profileGoldAktivToggle', 'profileGoldSteuerfreiToggle', 'profileHealthBucketEnabledToggle']) {
        assert(managerHtml.includes(`id="${id}"`), 'Schalteradapter verwendet den tatsächlichen Markupanker');
        doc.register(new MockElement(id, 'input'));
    }
    doc.getElementById('category').value = 'equity';
    doc.getElementById('trancheForm').reset = () => {
        for (const id of ['name', 'isin', 'ticker', 'shares', 'purchasePrice', 'currentPrice', 'purchaseDate', 'notes']) doc.getElementById(id).value = '';
    };
    doc.getElementById('type').value = 'aktien_neu';
    doc.getElementById('reconcileCashStatus').value = 'pending_manual_posting';
    doc.getElementById('type').options = ['aktien_alt', 'aktien_neu', 'anleihe', 'geldmarkt', 'gold']
        .map(value => ({ value, disabled: false, hidden: false }));
    installManagerViewDom(doc);
    return installPageDialogDom(doc);
}

/** Statische Hosts aus SOURCE, dynamische Buttons als DOM-Elemente mit Fokus/ARIA. */
export function installManagerViewDom(doc) {
    const html = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    for (const id of ['managerSectionNav', 'managerPlanPanel', 'managerPersonPanel', 'managerHistoryPanel', 'managerHistorySwitch', 'managerHousehold', 'managerProfileValues', 'managerDepotTitle', 'haushalt-plan']) {
        const markup = html.match(new RegExp(`<([\\w-]+)\\b([^>]*id="${id}"[^>]*)>`));
        assert(markup, 'Ansichtshost existiert im ausgelieferten DOM: ' + id);
        const element = doc.getElementById(id) || doc.register(new MockElement(id, markup[1]));
        for (const [, name, value] of markup[2].matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(name, value);
        element.hidden = /\bhidden\b/.test(markup[2]);
    }
    for (const hostId of ['managerSectionNav', 'managerHistorySwitch']) {
    const nav = doc.getElementById(hostId);
    let current = '';
    const decode = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    Object.defineProperty(nav, 'innerHTML', { configurable: true, get: () => current, set(html) {
        current = html;
        for (const child of nav.children) child.isConnected = false;
        nav.children = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, content]) => {
            const button = new MockElement('', 'button'); button.isConnected = true;
            for (const [, name, raw] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
                const value = decode(raw); button.setAttribute(name, value);
                if (name === 'id') button.id = value;
                if (name.startsWith('data-')) button.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            }
            button.textContent = decode(content.replace(/<[^>]*>/g, ''));
            button.closest = selector => selector === '[role="tab"]' || selector === '[data-manager-profile]' && button.dataset.managerProfile
                || selector === '[data-manager-view]' && button.dataset.managerView ? button : null;
            doc.register(button); return button;
        });
    } });
    nav.querySelectorAll = selector => nav.children.filter(button => selector === '[role="tab"]'
        || selector.includes('[data-manager-profile]') && button.dataset.managerProfile
        || selector.includes('[data-manager-view]') && button.dataset.managerView
        || selector === '[aria-selected="true"]' && button.getAttribute('aria-selected') === 'true');
    nav.querySelector = selector => nav.querySelectorAll(selector)[0] || null;
    }
}

export function createCashSale(overrides = {}) {
    return {
        schemaVersion: 1,
        eventType: 'sale_reconciled',
        actionId: 'page-cash-sale',
        profileId: 'page-cash-profile',
        trancheId: 'page-cash-lot',
        executedAt: '2026-07-14',
        actual: { sharesSold: 1, grossProceeds: 100, fees: 5, netProceeds: 95 },
        cashStatus: 'confirmed_already_reflected',
        cashBalanceAfterPostingEur: 5000,
        cashConfirmedAt: '2026-07-14T12:00:00.000Z',
        result: { beforeShares: 2, remainingShares: 1, trancheRemoved: false },
        reconciledAt: '2026-07-14T12:00:00.000Z',
        ...overrides
    };
}

/** Neue Dialogfelder ausschließlich aus dem tatsächlich ausgelieferten Markup. */
export function addManagerDialogDom(doc) {
    const html = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    const dialogs = html.slice(html.indexOf('    <div class="modal" id="saleModal"'), html.indexOf('    <!-- Modal für Tranche'));
    for (const match of dialogs.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const element = doc.getElementById(match[3]) || doc.register(new MockElement(match[3], match[1]));
        element.hidden = /\bhidden\b/.test(match[2]);
        element.required = /\brequired\b/.test(match[2]);
        element.reportValidity = () => !element.required || element.value !== '';
    }
    for (const id of ['managePeopleBtn', 'depotOpenSaleEntryBtn']) doc.register(new MockElement(id, 'button'));
    for (const step of [1, 2]) {
        const fragment = dialogs.match(new RegExp(`<fieldset id="saleStep${step}"[\\s\\S]*?</fieldset>`))[0];
        const fields = [...fragment.matchAll(/<(?:input|select)\b[^>]*id="([^"]+)"/g)].map(match => doc.getElementById(match[1]));
        doc.getElementById(`saleStep${step}`).querySelectorAll = () => fields;
    }
    doc.getElementById('reconciliationForm').reset = () => {
        for (const match of dialogs.matchAll(/<(?:input|select)\b[^>]*id="(reconcile[^"]+)"/g)) doc.getElementById(match[1]).value = '';
        doc.getElementById('reconcileFees').value = '0';
        doc.getElementById('reconcileCashStatus').value = 'pending_manual_posting';
    };
    doc.getElementById('reconciliationForm').reset();
}

export function createCashRegistry(actions) {
    return {
        version: 1,
        profiles: {
            'page-cash-profile': {
                meta: {
                    id: 'page-cash-profile',
                    name: 'Cashprofil',
                    createdAt: '2026-07-14T00:00:00.000Z',
                    updatedAt: '2026-07-14T00:00:00.000Z',
                    belongsToHousehold: true
                },
                data: {}
            }
        },
        trancheReconciliation: { schemaVersion: 1, actions }
    };
}

export async function waitFor(predicate, message, timeoutMs = 1500) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

export function installGlobals(documentRef, storageRef) {
    global.document = documentRef;
    global.window = {
        tranchen: null,
        listeners: {},
        addEventListener(type, handler) {
            if (!this.listeners[type]) this.listeners[type] = [];
            if (!this.listeners[type].includes(handler)) this.listeners[type].push(handler);
        },
        removeEventListener(type, handler) {
            this.listeners[type] = (this.listeners[type] || []).filter(listener => listener !== handler);
        },
        localStorage: storageRef,
        location: {
            reloadCount: 0,
            reload() { this.reloadCount += 1; }
        }
    };
    global.localStorage = storageRef;
    global.confirm = global.alert = () => { throw new Error('NATIVE_DIALOG_FORBIDDEN'); };
    global.URL = {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {}
    };
    global.Blob = class {
        constructor(parts, options) {
            this.parts = parts;
            this.options = options;
        }
    };
}

const previousGlobals = {
    document: global.document,
    window: global.window,
    localStorage: global.localStorage,
    confirm: global.confirm,
    alert: global.alert,
    URL: global.URL,
    Blob: global.Blob
};

function shouldRun() {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const requestedTest = process.argv[2] ? path.resolve(process.argv[2]) : '';
    return entry === __filename
        || (entry.endsWith(`${path.sep}run-single.mjs`) && requestedTest === __filename);
}

/** Nur aus dem produktiv gerenderten Haushaltsmarkup entstehen Infohosts und Knöpfe. */
function installHouseholdInfoDom(doc) {
    const household = doc.getElementById('managerHousehold');
    const decode = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const element = (tag, attrs) => {
        const node = new MockElement('', tag);
        for (const [, name, raw] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
            const value = decode(raw);
            node.setAttribute(name, value);
            if (name === 'id') node.id = value;
            if (name === 'class') value.split(/\s+/).forEach(name => node.classList.add(name));
        }
        node.contains = target => node === target || node.children.some(child => child.contains(target));
        node.querySelectorAll = selector => node.children.filter(child => child.classList.contains(selector.slice(1)));
        node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
        return node;
    };
    let current = '';
    Object.defineProperty(household, 'innerHTML', { configurable: true, get: () => current, set(html) {
        current = html;
        household.children = [...html.matchAll(/<span\b([^>]*class="[^"]*\bds-info\b[^"]*"[^>]*)><button\b([^>]*)>[\s\S]*?<\/button><span\b([^>]*)>([\s\S]*?)<\/span><\/span>/g)]
            .map(([, hostAttrs, buttonAttrs, popAttrs, content]) => {
                const host = element('span', hostAttrs);
                const button = element('button', buttonAttrs);
                const pop = element('span', popAttrs);
                pop.textContent = decode(content.replace(/<[^>]*>/g, ''));
                host.appendChild(button); host.appendChild(pop);
                return host;
            });
    } });
    household.querySelectorAll = selector => household.children.filter(host => host.classList.contains(selector.slice(1)));
    doc.querySelectorAll = selector => household.querySelectorAll(selector);
}

// SOURCE: echter Seitencontroller, echter Profilwriter und separate dauerhafte Rohrecords.
async function createMonthlyCashScenario() {
    const id = 'page-cash-profile';
    const doc = createTranchenPageDom();
    installGlobals(doc, createLocalStorageMock());
    // Statischer Schutzdialog aus dem echten Manager-DOM für Dirty-Abbruch.
    const html = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    for (const id of ['navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        assert(html.includes(`id="${id}"`), 'Schutzdialogadapter verwendet vorhandenen DOM-Anker');
        const element = doc.register(new MockElement(id));
        element.removeEventListener = (type, handler) => { element.listeners[type] = (element.listeners[type] || []).filter(fn => fn !== handler); };
    }
    const guardDialog = doc.getElementById('navigationGuardDialog');
    guardDialog.showModal = () => { guardDialog.open = true; };
    guardDialog.close = () => { guardDialog.open = false; };
    doc.removeEventListener = (type, handler) => { doc.listeners[type] = (doc.listeners[type] || []).filter(fn => fn !== handler); };
    const sale = createCashSale({ executedAt: '2026-03-10', cashStatus: 'pending_manual_posting' });
    delete sale.cashBalanceAfterPostingEur;
    delete sale.cashConfirmedAt;
    const registry = createCashRegistry([sale]);
    const data = { depot_tranchen: '[]', profile_tagesgeld: '9000',
        profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 9000, entries: [] }),
        profile_wealth_history_lots_v1: JSON.stringify({ version: 1, lots: {} }) };
    registry.profiles[id].data = { ...data };
    registry.profiles.fremd = { meta: { id: 'fremd', name: 'Synthetische zweite Person', belongsToHousehold: false },
        data: { profile_tagesgeld: '321', depot_tranchen: '[]', fremder_beleg: 'unverändert' } };
    const backend = new Map(Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry),
        rs_current_profile: id, rs_active_profile: id, fremder_record: 'unverändert' }));
    const adapter = { name: 'Monatlicher-Cashdialog-Test', async open() {},
        async loadAll() { return Object.fromEntries(backend); },
        async saveBatch({ deletes, upserts }) {
            deletes.forEach(key => backend.delete(key));
            upserts.forEach(([key, raw]) => backend.set(key, raw));
        } };
    PersistenceFacade.resetPersistenceForTests(adapter);
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate('2026-03-10');
    await initTranchenManagerPage({ profileId: id });
    const open = mode => {
        const button = new MockElement('monthly-cash-action', 'button');
        button.dataset.cashAction = mode;
        button.dataset.targetActionId = sale.actionId;
        return doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: button });
    };
    const submit = () => doc.getElementById('cashPostingForm').listeners.submit[0]({ preventDefault() {} });
    open('confirm');
    doc.getElementById('cashPostingBalance').value = '10000';
    assertEqual(await submit(), true, 'Märzbestätigung läuft über den echten Seitenauftrag');
    setAppTestDate('2026-04-10');
    const input = doc.getElementById('profileTagesgeld');
    input.value = '8000';
    input.listeners.input[0]({ target: input });
    await waitFor(() => backend.get('profile_tagesgeld') === '8000'
        && !input.disabled && !doc.getElementById('profileGoldZiel').disabled,
    'Echte April-Profilspeicherung muss dauerhaft abgeschlossen sein');
    await PersistenceFacade.flush();
    const history = JSON.parse(backend.get('profile_cash_history_v1'));
    assertEqual(JSON.stringify(history.entries), JSON.stringify([
        { date: '2026-03-10', value: 10000 }, { date: '2026-04-10', value: 8000 }
    ]), 'Aprilwrite erhält Märzbeleg und erzeugt genau den Aprilbeleg');
    setAppTestDate('2026-05-10');
    const snapshot = () => ({ cache: Object.fromEntries([...backend.keys()].map(key => [key, persistenceStorage.getItem(key)])),
        backend: Object.fromEntries(backend) });
    return { id, doc, backend, adapter, open, submit, snapshot };
}

async function runTranchenManagerPageTests() {
    const targetDoc = createTranchenPageDom();
    installGlobals(targetDoc, createLocalStorageMock());
    assertEqual(await openManagerOverviewTarget({ hash: '#personen' }, { ready: false, blocked: false }), false, 'Personenziel wartet auf Bereitschaft');
    assertEqual(await openManagerOverviewTarget({ hash: '#personen' }, { ready: true, blocked: true }), false, 'Personenziel respektiert Recovery-/Commitblocker');
    assertEqual(await openManagerOverviewTarget({ hash: '#fremd' }, { ready: true, blocked: false }), false, 'Manager ignoriert unbekannte Hashes');
    addManagerDialogDom(targetDoc);
    PersistenceFacade.resetPersistenceForTests({ name: 'navigation-target', async open() {}, async loadAll() { return {}; }, async saveBatch() {} });
    await PersistenceFacade.init();
    persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([])));
    persistenceStorage.setItem('rs_current_profile', 'page-cash-profile');
    persistenceStorage.setItem('rs_active_profile', 'page-cash-profile');
    initTranchenManagerPage({ profileId: 'page-cash-profile' });
    assertEqual(await openManagerOverviewTarget({ hash: '#personen' }, { ready: true, blocked: false }), true, 'Personenziel öffnet vorhandenen Verwaltungsdialog');
    assert(targetDoc.getElementById('managerPeopleModal').classList.contains('active'), 'Personenziel verwendet den bestehenden Verwaltungsdialog im Personenkontext');
    PersistenceFacade.resetPersistenceForTests();

    console.log('--- Tranchen Manager Page Tests ---');

    console.log('R-03: Seitenrender bindet Verlaufsinfos für Haushalt und zwei Personen auch nach Knotenersatz');
    {
        const doc = createTranchenPageDom();
        installHouseholdInfoDom(doc);
        installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests();
        await PersistenceFacade.init();
        setAppTestDate('2026-10-11');
        const registry = { version: 1, profiles: Object.fromEntries(['a', 'b'].map((id, index) => [id, {
            meta: { id, name: `Synthetische Person ${id}`, belongsToHousehold: true },
            data: { profile_person_schema_version: '1', depot_tranchen: '[]', profile_tagesgeld: String(1000 + index * 500),
                profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 1000 + index * 500, entries: [] }) }
        }])) };
        for (const [key, value] of Object.entries(registry.profiles.a.data)) persistenceStorage.setItem(key, value);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        persistenceStorage.setItem('rs_current_profile', 'a');
        persistenceStorage.setItem('rs_active_profile', 'a');
        persistenceStorage.setItem(WEALTH_HISTORY_START_KEY, JSON.stringify({ version: 1, startDate: '2026-10-08' }));
        assertEqual(doc.querySelectorAll('.ds-info').length, 0, 'Vor dem Seitenstart sind keine erfundenen Infohosts vorhanden');
        let previousButtons = [];
        for (let render = 1; render <= 2; render++) {
            if (render === 2) {
                registry.profiles.b.meta.name = 'Synthetische Person b neu';
                persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
            }
            // Ausschließlich der echte Seitencontroller ruft Renderer und Binder auf.
            initTranchenManagerPage({ profileId: 'a' });
            const hosts = doc.getElementById('managerHousehold').querySelectorAll('.pv-history-info');
            assertEqual(hosts.length, 3, `Render ${render}: Haushalt und beide Personen besitzen Verlaufsinfos`);
            const buttons = hosts.map(host => host.querySelector('.ds-info-button'));
            const controls = buttons.map(button => button.getAttribute('aria-controls'));
            assertEqual(new Set(controls).size, 3, `Render ${render}: Alle Verlaufsinfo-IDs sind eindeutig`);
            for (const [index, host] of hosts.entries()) {
                const button = buttons[index], pop = host.querySelector('.ds-info-pop');
                assert(!previousButtons.includes(button), `Render ${render}: Der Knopf stammt aus dem neuen Haushaltsmarkup`);
                assertEqual(pop.id, controls[index], 'aria-controls erreicht das Infofenster desselben Hosts');
                assert(pop.textContent.includes('Messbeginn 08.10.2026') && pop.textContent.includes('Messstatus: vorläufig')
                    && pop.textContent.includes('Zeitraum 08.10.2026 bis 10.10.2026'), 'Die erreichbare Info enthält Messbeginn, Status und Originalzeitraum: ' + pop.textContent);
                assertEqual(button.listeners.click?.length, 1, `Render ${render}: Genau ein Klickhandler je Verlaufsinfoknopf`);
                assertEqual(host.dataset.visible, 'false', 'Info beginnt geschlossen');
                await button.click();
                assertEqual(host.dataset.visible, 'true', 'Seitengebundener Klick öffnet die Verlaufsinfo');
                assertEqual(button.getAttribute('aria-expanded'), 'true', 'Geöffnete Info meldet ihren Zustand');
                await button.click();
                assertEqual(host.dataset.visible, 'false', 'Zweiter Klick schließt die Verlaufsinfo');
                assertEqual(button.getAttribute('aria-expanded'), 'false', 'Geschlossene Info meldet ihren Zustand');
            }
            previousButtons = buttons;
            assertEqual(doc.listeners.click.length, 1, 'Wiederholtes Seitenrender erzeugt keinen zweiten Popover-Dokumenthandler');
        }
        setAppTestDate(null);
        PersistenceFacade.resetPersistenceForTests();
    }

    console.log('Gespeicherter Kurskontext trennt unbekannte, gemischte und ältere Stände von Abrufzeit');
    {
        const context = new MockElement('context'), host = new MockElement('managerQuoteContext');
        const doc = { querySelector: () => context, getElementById: () => host };
        renderManagerQuoteContext(doc, []);
        assert(host.textContent.includes('Keine Kurse vorhanden'), 'Leerer gespeicherter Bestand besitzt keinen erfundenen Kursstand');
        renderManagerQuoteContext(doc, [{ currentPrice: 100 }]);
        assert(host.textContent.includes('Kursdatum unbekannt'), 'Manueller Preis ohne Provenienz wird nicht aus Abrufzeit datiert');
        const now = Math.floor(Date.now() / 1000);
        renderManagerQuoteContext(doc, [{ asOf: now - 60 }, { currentPrice: 100 }]);
        assert(host.textContent.includes('Teilweise unbekannt'), 'Gemischter belegter/unbelegter Bestand bleibt erkennbar');
        renderManagerQuoteContext(doc, [{ asOf: now - 60 }, { asOf: now - 8 * 86400 }]);
        assert(host.textContent.includes('Gemischte Kursstände') && host.textContent.includes('ältere Kurse'), 'Verschiedene gespeicherte Stände und Offlinealtkurse bleiben sichtbar');
        assert(host.textContent.includes('Abrufzeit ist kein Kursdatum'), 'Kontext unterscheidet Kursdatum von Abrufzeit');
    }

    console.log('Test 1a: legacy tax migration is quantified and visible');
    {
        const warning = describeLegacyTaxMigration(JSON.stringify([
            { schemaVersion: 1, category: 'equity', type: 'aktien_alt', tqf: 0.3 },
            { schemaVersion: 1, category: 'gold', type: 'gold', tqf: 1 },
            { category: 'money_market', type: 'geldmarkt', tqf: 0.3 }
        ]));
        assert(warning.includes('3 Legacy-Tranche(n)'), 'Migration warning quantifies every affected legacy lot');
        assert(warning.includes('1 alte Gold-TQF-1-Kodierung(en)'), 'Migration warning quantifies converted Gold exemptions');
        assert(warning.includes('1 unbelegte Nicht-Aktien-TQF'), 'Migration warning quantifies reset non-equity TQF values');
        assert(warning.includes('rechnet die Simulation mit diesen konservativen Annahmen'),
            'Migration warning states the active calculation consequence until confirmation');
        assertEqual(describeLegacyTaxMigration(JSON.stringify([{ schemaVersion: 2, taxExempt: false }])), '',
            'Current schema does not display a migration warning');
    }

    console.log('Test 1: page initializes empty storage without crashing');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();

        await initTranchenManagerPage();
        await PersistenceFacade.flush();

        assertEqual(window.tranchen.length, 0, 'Empty storage should expose empty tranche list');
        assert(doc.getElementById('tranchenTable').innerHTML.includes('Keine Tranchen vorhanden'), 'Empty state should be rendered');
        assert(doc.getElementById('stats').innerHTML.includes('Gesamtwert'), 'Stats container should be rendered');
        assert(doc.persistencePanel.hidden, 'Normaler Ladeleerzustand zeigt keine dauerhafte Ladekarte');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), null, 'Pure empty load must not create a tranche key');
        assertEqual(doc.getElementById('reconciliationPreviewBtn').disabled, true, 'Persistenzrender erhält die Previewsperre ohne Tranchen');
        assertEqual(doc.getElementById('reconciliationConfirmBtn').disabled, true, 'Persistenzrender sperrt Bestätigung ohne ready-Vorschau');
    }
    console.log('✓ empty storage initialization OK');

    console.log('Test: Gruppierte Aktionen treffen die stabile ID, Öffnen und Abbruch schreiben nicht');
    {
        const doc = createTranchenPageDom();
        installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests();
        const base = { schemaVersion: 2, shares: 2, purchasePrice: 100, currentPrice: 120,
            isin: '', ticker: '', tqf: 0, taxExempt: false, notes: '' };
        const raw = JSON.stringify([
            { ...base, trancheId: 'gold-first', name: 'Gold', category: 'gold', type: 'gold', purchaseDate: '2020-01-01' },
            { ...base, trancheId: 'equity-later', name: 'Später', category: 'equity', type: 'aktien_neu', purchaseDate: '2024-01-01' },
            { ...base, trancheId: 'equity-earlier', name: 'Früher', category: 'equity', type: 'aktien_alt', purchaseDate: '' }
        ]);
        persistenceStorage.setItem('depot_tranchen', raw);
        await initTranchenManagerPage(); await PersistenceFacade.flush();
        assert(doc.persistencePanel.hidden, 'Normal geladener Bestand zeigt keine dauerhafte Ladekarte');
        const html = doc.getElementById('tranchenTable').innerHTML;
        assert(html.indexOf('data-tranche-id="equity-earlier"') < html.indexOf('data-tranche-id="equity-later"')
            && html.indexOf('data-tranche-id="equity-later"') < html.indexOf('data-tranche-id="gold-first"'), 'Gruppen und Kaufdatum ordnen nur die Anzeige');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Rendern normalisiert keinen Rohspeicher');
        const action = (kind, id) => {
            const target = new MockElement('row-action', 'button');
            target.dataset = { action: kind, trancheId: id, index: '0' }; // absichtlich falscher Anzeigeindex
            doc.getElementById('tranchenTable').listeners.click[0]({ target });
        };
        action('edit-tranche', 'equity-earlier');
        assertEqual(doc.getElementById('name').value, 'Früher', 'Bearbeiten trifft trotz falschem Zeilenindex die ID');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Öffnen schreibt keinen Bestand');
        await doc.getElementById('closeTrancheModalBtn').click();
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Sauberer Abbruch schreibt keinen Bestand');
        action('edit-tranche', 'equity-earlier');
        doc.getElementById('name').value = 'Früher bearbeitet';
        for (const id of ['shares', 'purchasePrice', 'currentPrice', 'tqf']) doc.getElementById(id).value = String(doc.getElementById(id).value);
        await doc.getElementById('trancheForm').listeners.submit[0]({ preventDefault() {} });
        assertEqual(window.tranchen.map(t => t.trancheId).join(','), 'gold-first,equity-later,equity-earlier', 'Edit erhält Speicherreihenfolge und Identitäten');
        assertEqual(window.tranchen[2].name, 'Früher bearbeitet', 'Nur die gewählte Tranche wird geändert');
        const confirmed = persistenceStorage.getItem('depot_tranchen');
        action('delete-tranche', 'equity-later');
        assert(doc.pageDialogs.at(-1).open, 'Löschen öffnet eine ausdrückliche Rückfrage');
        await respondPageDialog(doc, 'cancel');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), confirmed, 'Abgelehntes Löschen erhält Bestand');
        action('delete-tranche', 'equity-later');
        await respondPageDialog(doc);
        await waitFor(() => window.tranchen.length === 2, 'ID-Löschcommit abgeschlossen');
        assertEqual(window.tranchen.map(t => t.trancheId).join(','), 'gold-first,equity-earlier', 'Löschen trifft ausschließlich die gewählte ID');
        action('edit-tranche', 'nicht-mehr-vorhanden');
        assertEqual(doc.getElementById('trancheModal').classList.contains('active'), false, 'Veraltete Aktion öffnet keine andere Tranche');
    }

    console.log('Test 2: page initializes valid storage and preserves local data when price service is offline');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        persistenceStorage.setItem('depot_tranchen', JSON.stringify([{
            trancheId: 't1',
            name: 'ETF',
            ticker: 'ETF',
            shares: 10,
            purchasePrice: 100,
            currentPrice: 120,
            category: 'equity',
            type: 'aktien_neu',
            tqf: 0.3
        }]));
        persistenceStorage.setItem('profile_tagesgeld', '12345');

        const previousFetch = global.fetch;
        global.fetch = async () => {
            throw new Error('offline');
        };
        try {
            await initTranchenManagerPage();
            await doc.getElementById('updatePricesBtn').listeners.click[0]();
            await PersistenceFacade.flush();
        } finally {
            if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
        }

        assertEqual(window.tranchen.length, 1, 'Valid storage should load one tranche');
        assertEqual(window.tranchen[0].currentPrice, 120, 'Offline price update must preserve existing local price');
        assert(doc.getElementById('tranchePersistenceStatus').textContent.includes('1 Legacy-Tranche(n)'),
            'Loaded legacy storage must surface the tax-contract migration before user confirmation');
        const offlineStatus = doc.getElementById('priceUpdateStatus').textContent;
        assert(offlineStatus.startsWith('Kurse konnten nicht aktualisiert werden.'), 'Offline update should render a concise failure status');
        assert(offlineStatus.includes('ETF: Lokaler Kursproxy nicht erreichbar'), 'Offline update should name the affected tranche and understandable reason');
        assertEqual(doc.getElementById('profileTagesgeld').value, 12345, 'Profile values should be applied to DOM');
        assertEqual(doc.getElementById('suiteProfileContext').textContent, '', 'Aktives Profil entfällt im Seitenkopf');
        assertEqual(doc.getElementById('suiteProfileContext').hidden, true, 'Profilkontext bleibt unsichtbar');
        assertEqual(doc.getElementById('suiteProfileContext').dataset.profileName, 'Default', 'Tatsächlicher Name bleibt interne Metadaten');
        assertEqual(doc.getElementById('suiteProfileContext').dataset.profileId, 'default', 'Profilanzeige bewahrt die tatsächliche technische Identität im Datenattribut');
        assertEqual(doc.getElementById('managerTechnicalProfile').textContent, 'Profil-Kennung: default', 'Technikansicht zeigt die tatsächliche geladene Profilkennung');
        assertEqual(doc.getElementById('managerBackLink').dataset.profileId, 'default', 'Rahmen-Rücklink erhält dieselbe aktive Profil-ID wie das Inhaltslabel');
        assertEqual(doc.getElementById('managerBackLink').getAttribute('aria-label'), 'Zurück zur Profilübersicht für Default (default)', 'Rahmen-Rücklink beschreibt Profilname und Handoffidentität unabhängig vom sichtbaren Label');
        assertEqual(doc.getElementById('managerBackLink').getAttribute('data-profile-handoff'), '', 'Profilanzeige erhält die delegierte Rahmenbindung');
    }
    console.log('✓ valid storage and offline price degradation OK');

    console.log('Test 3: mixed quote batch is single-flight, fail-closed and persisted exactly once');
    {
        const now = Math.floor(Date.now() / 1000);
        const initialTranches = [
            {
                trancheId: 'eur-a', name: 'EUR A', ticker: 'SAME.DE', shares: 2,
                purchasePrice: 100, currentPrice: 125, asOf: now - 1000, category: 'equity', type: 'aktien_neu', tqf: 0.3
            },
            {
                trancheId: 'eur-b', name: 'EUR B', ticker: 'SAME.DE', shares: 3,
                purchasePrice: 90, currentPrice: 90, category: 'equity', type: 'aktien_neu', tqf: 0.3
            },
            {
                trancheId: 'usd', name: 'USD Lot', ticker: 'USD.DE', shares: 1,
                purchasePrice: 80, currentPrice: 80, asOf: now - 2000, category: 'equity', type: 'aktien_neu', tqf: 0.3
            }
        ];
        const adapterStore = new Map([['depot_tranchen', JSON.stringify(initialTranches)]]);
        let trancheWriteBatches = 0;
        const adapter = {
            name: 'quote-batch-memory',
            async open() {},
            async loadAll() { return Object.fromEntries(adapterStore); },
            async saveBatch(batch) {
                if (batch.upserts.some(([key]) => key === 'depot_tranchen')) trancheWriteBatches += 1;
                batch.deletes.forEach(key => adapterStore.delete(key));
                batch.upserts.forEach(([key, value]) => adapterStore.set(key, String(value)));
            }
        };
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init();
        await initTranchenManagerPage({ profileId: 'default' });

        let releaseEurQuote;
        const eurQuoteGate = new Promise(resolve => { releaseEurQuote = resolve; });
        const quoteCalls = new Map();
        const previousFetch = global.fetch;
        global.fetch = async url => {
            const parsed = new NodeURL(String(url));
            if (parsed.pathname === '/search') {
                const query = parsed.searchParams.get('q');
                return { ok: true, status: 200, json: async () => ({ quotes: [{ symbol: query }] }) };
            }
            const symbol = parsed.searchParams.get('symbol');
            quoteCalls.set(symbol, (quoteCalls.get(symbol) || 0) + 1);
            if (symbol === 'SAME.DE') {
                await eurQuoteGate;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        symbol,
                        price: 125,
                        currency: 'EUR',
                        asOf: now,
                        source: 'yahoo-chart'
                    })
                };
            }
            return {
                ok: false,
                status: 422,
                json: async () => ({
                    status: 'error',
                    code: 'UNSUPPORTED_CURRENCY',
                    message: 'Waehrung USD wird nicht unterstuetzt.'
                })
            };
        };

        try {
            const firstClick = doc.getElementById('updatePricesBtn').listeners.click[0]();
            const secondClick = doc.getElementById('updatePricesBtn').listeners.click[0]();
            await waitFor(() => quoteCalls.get('SAME.DE') === 1, 'Duplicate symbol should start exactly one active quote request');
            assertEqual(doc.getElementById('updatePricesBtn').disabled, true, 'Active quote batch should disable repeated UI action');
            releaseEurQuote();
            await Promise.all([firstClick, secondClick]);
            await PersistenceFacade.flush();
        } finally {
            if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
        }

        assertEqual(quoteCalls.get('SAME.DE'), 1, 'Same symbol across lots and double click must remain single-flight');
        assertEqual(window.tranchen.find(item => item.trancheId === 'eur-a').currentPrice, 125, 'First EUR lot should update');
        assertEqual(window.tranchen.find(item => item.trancheId === 'eur-b').currentPrice, 125, 'Second EUR lot should share result');
        assertEqual(window.tranchen.find(item => item.trancheId === 'usd').currentPrice, 80, 'Rejected USD lot must retain old price');
        assertEqual(trancheWriteBatches, 1, 'Mixed successful batch should persist tranche state exactly once');
        const confirmed = JSON.parse(adapterStore.get('rs_profiles_v1')).profiles.default.data.depot_tranchen;
        const registryTranches = JSON.parse(confirmed);
        const reloaded = loadTranchesFromStorage({ getItem: key => adapterStore.get(key) ?? null }).tranches;
        for (const collection of [window.tranchen, JSON.parse(persistenceStorage.getItem('depot_tranchen')),
            registryTranches, reloaded]) {
            for (const id of ['eur-a', 'eur-b']) {
                const lot = collection.find(item => item.trancheId === id);
                assertEqual(lot.asOf, now, 'Auch gleicher Preis und geteiltes Symbol erhalten exakt quote.asOf');
                assertEqual(lot.currentPrice, 125, 'Preis bleibt an Kurszeit gebunden');
                assertEqual(lot.ticker, 'SAME.DE', 'Aufgelöster Ticker wird mitgespeichert');
            }
            assertEqual(collection.find(item => item.trancheId === 'usd').asOf, now - 2000,
                'Teilfehler erhält den alten Kurszeitpunkt');
        }
        assertEqual(JSON.parse(adapterStore.get('depot_tranchen')).find(item => item.trancheId === 'usd').currentPrice, 80, 'Persisted rejected lot should retain old price');
        const batchStatus = doc.getElementById('priceUpdateStatus').textContent;
        assert(batchStatus.startsWith('Kurse teilweise aktualisiert (2 von 3).'), 'Mixed outcome should remain concise and unambiguous');
        assert(batchStatus.includes('USD Lot: Waehrung USD wird nicht unterstuetzt.'), 'Rejected tranche and understandable reason should remain visible');
        assert(!batchStatus.includes('yahoo-chart') && !batchStatus.includes('Stichtag'), 'Successful quote metadata should not clutter the status');
        assertEqual(doc.getElementById('updatePricesBtn').disabled, false, 'Completed batch should re-enable controls');
    }
    console.log('✓ quote batch resilience contract OK');

    console.log('Test 4: late quote response after profile switch is ignored');
    {
        const now = Math.floor(Date.now() / 1000);
        const initialRaw = JSON.stringify([{
            trancheId: 'late', name: 'Late Quote', ticker: 'LATE.DE', shares: 1,
            purchasePrice: 100, currentPrice: 100, category: 'equity', type: 'aktien_neu', tqf: 0.3
        }]);
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        persistenceStorage.setItem('depot_tranchen', initialRaw);
        await PersistenceFacade.flush();
        await initTranchenManagerPage({ profileId: 'default' });

        let releaseQuote;
        let notifyStarted;
        const quoteGate = new Promise(resolve => { releaseQuote = resolve; });
        const started = new Promise(resolve => { notifyStarted = resolve; });
        const previousFetch = global.fetch;
        global.fetch = async () => {
            notifyStarted();
            await quoteGate;
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    symbol: 'LATE.DE', price: 150, currency: 'EUR', asOf: now, source: 'yahoo-chart'
                })
            };
        };

        try {
            const oldBatch = doc.getElementById('updatePricesBtn').listeners.click[0]();
            await started;
            initTranchenManagerPage({
                profileId: 'other',
                loader: () => ({ status: 'empty', tranches: [], raw: null })
            });
            releaseQuote();
            await oldBatch;
        } finally {
            if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
        }

        assertEqual(window.tranchen.length, 0, 'Late result must not repopulate the newly selected empty profile');
        assertEqual(JSON.parse(persistenceStorage.getItem('depot_tranchen'))[0].currentPrice, 100, 'Late result must not persist into the previous profile state');
        assert(!('asOf' in JSON.parse(persistenceStorage.getItem('depot_tranchen'))[0]),
            'Abbruch und Profilwechsel dürfen keine Kurszeit persistieren');
        assertEqual(doc.getElementById('priceUpdateStatus').textContent, '', 'Late result must not overwrite the new profile status');
        assertEqual(doc.getElementById('updatePricesBtn').disabled, false, 'Profile switch should release quote-batch controls');
    }
    console.log('✓ late quote invalidation OK');

    console.log('Test 4b: Kursflush-Rollback, Retry und echte Formlistener erhalten Preisprovenienz');
    {
        const now = Math.floor(Date.now() / 1000);
        const initialRaw = JSON.stringify([{
            schemaVersion: 2, trancheId: 'dated', name: 'ETF', isin: 'DE000TEST001', ticker: '',
            shares: 2, purchasePrice: 100, currentPrice: 120, category: 'equity', type: 'aktien_neu',
            tqf: 0.3, taxExempt: false, asOf: now - 1000
        }]);
        const adapterStore = new Map([['depot_tranchen', initialRaw]]);
        let failSave = false;
        const adapter = {
            name: 'quote-rollback-memory', async open() {},
            async loadAll() { return Object.fromEntries(adapterStore); },
            async saveBatch(batch) {
                if (failSave) throw new Error('offline');
                batch.deletes.forEach(key => adapterStore.delete(key));
                batch.upserts.forEach(([key, value]) => adapterStore.set(key, String(value)));
            }
        };
        const doc = createTranchenPageDom();
        installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init();
        await initTranchenManagerPage({ profileId: 'default' });
        await PersistenceFacade.flush();
        const oldRegistry = adapterStore.get('rs_profiles_v1');
        failSave = true;
        const previousFetch = global.fetch;
        global.fetch = async url => ({ ok: true, status: 200,
            json: async () => new NodeURL(String(url)).pathname === '/search'
                ? { quotes: [{ symbol: 'RESOLVED.DE' }] }
                : { symbol: 'RESOLVED.DE', price: 120, currency: 'EUR', asOf: now, source: 'yahoo-chart' }
        });
        try { await doc.getElementById('updatePricesBtn').click(); }
        finally { if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch; }
        assertEqual(window.tranchen[0].asOf, now - 1000, 'Fehlgeschlagener Flush zeigt nur die bestätigte Kurszeit');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), initialRaw, 'Live-Store wird bytegleich zurückgesetzt');
        assertEqual(adapterStore.get('depot_tranchen'), initialRaw, 'Adapter erhält keinen falschen Kurszeitpunkt');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), oldRegistry, 'Registry-Rollback erhält bestätigte Kopie');
        assertEqual(adapterStore.get('rs_profiles_v1'), oldRegistry, 'Adapterregistry bleibt unverändert');

        failSave = false;
        await doc.getElementById('retryTrancheSaveBtn').click();
        assertEqual(window.tranchen[0].asOf, now, 'Erfolgreicher Retry übernimmt die ursprüngliche Quotezeit');
        assertEqual(window.tranchen[0].ticker, 'RESOLVED.DE', 'Aufgelöster Ticker wird gemeinsam übernommen');
        const edit = async changes => {
            const target = new MockElement('edit', 'button');
            target.dataset = { action: 'edit-tranche', trancheId: window.tranchen[0].trancheId };
            doc.getElementById('tranchenTable').listeners.click[0]({ target });
            for (const field of ['currentPrice', 'tqf']) {
                doc.getElementById(field).value = String(doc.getElementById(field).value);
            }
            for (const [field, value] of Object.entries(changes)) {
                if (field === 'taxExempt') doc.getElementById(field).checked = value;
                else doc.getElementById(field).value = value;
            }
            await doc.getElementById('trancheForm').listeners.submit[0]({ preventDefault() {} });
        };
        await edit({ shares: '3', notes: 'Notiz', taxExempt: true });
        assertEqual(window.tranchen[0].asOf, now, 'Reale Anteils-/Notiz-/Steuerlistener erhalten die Kurszeit');
        await edit({ currentPrice: '130' });
        assert(!('asOf' in window.tranchen[0]), 'Manuelle Preisänderung löscht Kursprovenienz');
        await edit({ currentPrice: '120' });
        assert(!('asOf' in window.tranchen[0]), 'Früherer Preis bringt keine alte Kurszeit zurück');
        const loaded = loadTranchesFromStorage({ getItem: key => adapterStore.get(key) ?? null }).tranches[0];
        assert(!('asOf' in loaded), 'Persistierter manuell geänderter Kurs lädt undatiert');
    }

    console.log('Test 5: corrupt storage remains untouched until explicit recovery');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();

        const corruptRaw = '{bad json';
        persistenceStorage.setItem('depot_tranchen', corruptRaw);

        await initTranchenManagerPage();
        await PersistenceFacade.flush();

        assertEqual(window.tranchen.length, 0, 'Corrupt profile must not expose processable tranches');
        assert(persistenceStorage.getItem('depot_tranchen') === corruptRaw, 'Corrupt storage must remain byte-for-byte unchanged');
        assertEqual(doc.getElementById('trancheRecoveryActions').hidden, false, 'Corrupt state should expose reviewed recovery actions');
        assertEqual(doc.getElementById('retryTrancheLoadBtn').hidden, true, 'Corrupt state should not use unavailable retry');
        assertEqual(doc.getElementById('depotAddTrancheBtn').disabled, true, 'Corrupt state should block normal processing');
        assertEqual(doc.getElementById('corruptPayloadPreview').hidden, true, 'Raw payload must not be shown automatically');
        assertEqual(doc.getElementById('corruptPayloadPreview').textContent, '', 'Raw payload must not enter DOM before local action');

        await doc.getElementById('revealCorruptPayloadBtn').click();
        assert(doc.getElementById('corruptPayloadPreview').textContent === corruptRaw, 'Explicit reveal should show unchanged raw payload');

        await completePageDialog(doc.getElementById('resetCorruptPayloadBtn').click(), doc);
        assertEqual(persistenceStorage.getItem('depot_tranchen'), '[]', 'Explicit confirmed reset should persist an empty override');
        assertEqual(doc.getElementById('trancheRecoveryActions').hidden, true, 'Successful reset should leave recovery mode');
    }
    console.log('✓ corrupt storage recovery contract OK');

    console.log('Test 6: unavailable reload preserves last confirmed state and listeners');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        persistenceStorage.setItem('depot_tranchen', JSON.stringify([{
            trancheId: 'confirmed',
            name: 'Confirmed',
            shares: 1,
            purchasePrice: 100,
            currentPrice: 100,
            category: 'equity',
            type: 'aktien_neu',
            tqf: 0.3
        }]));

        await initTranchenManagerPage({ profileId: 'default' });
        const listenerCount = doc.getElementById('depotAddTrancheBtn').listeners.click.length;
        await initTranchenManagerPage({
            profileId: 'default',
            loader: () => ({ status: 'unavailable', tranches: null, raw: null })
        });

        assertEqual(window.tranchen.length, 1, 'Unavailable reload should retain last confirmed visible state');
        assertEqual(window.tranchen[0].trancheId, 'confirmed', 'Unavailable reload must not switch profile data');
        assertEqual(doc.getElementById('retryTrancheLoadBtn').hidden, false, 'Unavailable state should expose retry');
        assertEqual(doc.getElementById('trancheRecoveryActions').hidden, true, 'Unavailable state must not expose reset');
        assertEqual(doc.getElementById('depotAddTrancheBtn').listeners.click.length, listenerCount, 'Repeated init must not duplicate listeners');

        doc.visibilityState = 'hidden';
        doc.listeners.visibilitychange[0]();
        doc.visibilityState = 'visible';
        doc.listeners.visibilitychange[0]();
        await waitFor(() => window.location.reloadCount === 1, 'Return from another tab should reload manager context once');
        assertEqual(window.location.reloadCount, 1, 'Return from another tab should reload manager context once');
    }
    console.log('✓ unavailable and lifecycle contract OK');

    console.log('Test 7: failed flush keeps confirmed state and supports retry');
    {
        const initialRaw = JSON.stringify([{
            trancheId: 'persisted',
            schemaVersion: 1,
            name: 'Persisted',
            isin: '',
            ticker: '',
            shares: 1,
            purchasePrice: 100,
            currentPrice: 100,
            purchaseDate: '',
            category: 'equity',
            type: 'aktien_neu',
            tqf: 0.3,
            notes: '',
            costBasis: 100,
            marketValue: 100,
            gainLoss: 0,
            gainLossPct: 0
        }]);
        const adapterStore = new Map([['depot_tranchen', initialRaw]]);
        let failSave = true;
        const adapter = {
            name: 'retry-memory',
            async open() {},
            async loadAll() { return Object.fromEntries(adapterStore); },
            async saveBatch(batch) {
                if (failSave) throw new Error('offline');
                batch.deletes.forEach(key => adapterStore.delete(key));
                batch.upserts.forEach(([key, value]) => adapterStore.set(key, String(value)));
            }
        };
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init();

        await initTranchenManagerPage({ profileId: 'default' });
        await completePageDialog(doc.getElementById('clearTranchesBtn').click(), doc);

        assertEqual(window.tranchen.length, 1, 'Flush rejection should keep confirmed tranche visible');
        assertEqual(adapterStore.get('depot_tranchen'), initialRaw, 'Flush rejection must not change confirmed adapter state');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, false, 'Flush rejection should expose retry');
        assert(!doc.getElementById('tranchePersistenceStatus').textContent.includes('dauerhaft gelöscht'), 'Flush rejection must not report success');

        failSave = false;
        await doc.getElementById('retryTrancheSaveBtn').click();
        assertEqual(window.tranchen.length, 0, 'Successful retry should apply pending delete');
        assertEqual(adapterStore.get('depot_tranchen'), '[]', 'Successful retry should durably persist empty state');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, true, 'Successful retry should clear pending action');

        failSave = true;
        doc.getElementById('profileTagesgeld').value = '777';
        doc.getElementById('profileTagesgeld').listeners.input[0]();
        await waitFor(
            () => doc.getElementById('retryTrancheSaveBtn').hidden === false,
            'Debounced profile flush rejection should expose retry'
        );
        assertEqual(doc.getElementById('profileTagesgeld').value, 0, 'Profile flush rejection should restore confirmed visible value');
        assert(!doc.persistencePanel.hidden, 'Fehlflush bleibt als sichtbares Speicherband außerhalb Technik erhalten');
        assertEqual(adapterStore.has('profile_tagesgeld'), false, 'Profile flush rejection must not change adapter state');
        assertEqual(persistenceStorage.getItem('profile_cash_history_v1'), null, 'Cashfehlflush rollt auch die Livehistorie zurück');
        assertEqual(adapterStore.has('profile_cash_history_v1'), false, 'Cashfehlflush erzeugt keine bestätigte Historie');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, false, 'Profile flush rejection should expose retry');

        failSave = false;
        await doc.getElementById('retryTrancheSaveBtn').click();
        assertEqual(adapterStore.get('profile_tagesgeld'), '777', 'Profile retry should durably persist pending value');
        const cash = JSON.parse(adapterStore.get('profile_cash_history_v1'));
        assertEqual(cash.baselineValue, 0, 'Retry erhält ursprüngliche Cashbasis');
        assertEqual(cash.entries.length, 1, 'Retry dupliziert Cashänderung nicht');
        assertEqual(cash.entries[0].value, 777, 'Retry bestätigt historisierten Betrag');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, true, 'Profile retry should clear pending action');
        assert(!doc.persistencePanel.hidden, 'Bestätigter Retry behält sein sichtbares Speicherband');
    }
    console.log('✓ flush failure recovery OK');

    console.log('Test 8: profile input gate ignores invalid intermediates and commits only latest valid value');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();

        await initTranchenManagerPage({ profileId: 'default' });
        const input = doc.getElementById('profileTagesgeld');
        input.value = '';
        input.listeners.input[0]();
        await new Promise(resolve => setTimeout(resolve, 350));
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), null, 'Blank intermediate value must not be persisted');
        assertEqual(doc.getElementById('profileValidationStatus').hidden, false, 'Invalid intermediate should be announced');

        input.value = '100';
        input.listeners.input[0]();
        input.value = '200';
        input.listeners.input[0]();
        await waitFor(
            () => persistenceStorage.getItem('profile_tagesgeld') === '200',
            'Latest debounced profile value should be persisted'
        );
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '200', 'Rapid input should commit only the latest complete value');
        assertEqual(doc.getElementById('profileValidationStatus').hidden, true, 'Valid values should clear validation status');

        input.value = '-5';
        input.listeners.input[0]();
        await new Promise(resolve => setTimeout(resolve, 350));
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '200', 'Negative input must leave confirmed state unchanged');
    }
    console.log('✓ profile validation and debounce gate OK');

    console.log('Test 9: valid input queued during a slow flush is committed automatically');
    {
        const adapterStore = new Map();
        let saveCalls = 0, firstCashStarted = false;
        let releaseFirstSave;
        const firstSaveGate = new Promise(resolve => { releaseFirstSave = resolve; });
        const adapter = {
            name: 'slow-profile-memory',
            async open() {},
            async loadAll() { return Object.fromEntries(adapterStore); },
            async saveBatch(batch) {
                saveCalls += 1;
                if (!firstCashStarted && batch.upserts.some(([key, value]) => key === 'profile_tagesgeld' && value === '100')) {
                    firstCashStarted = true; await firstSaveGate;
                }
                batch.deletes.forEach(key => adapterStore.delete(key));
                batch.upserts.forEach(([key, value]) => adapterStore.set(key, String(value)));
            }
        };
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init();
        await initTranchenManagerPage({ profileId: 'default' });

        const input = doc.getElementById('profileTagesgeld');
        input.value = '100';
        input.listeners.input[0]();
        await waitFor(() => firstCashStarted, 'First debounced profile flush should start');
        input.value = '200';
        input.listeners.input[0]();
        await new Promise(resolve => setTimeout(resolve, 350));
        releaseFirstSave();
        await waitFor(
            () => saveCalls >= 2 && adapterStore.get('profile_tagesgeld') === '200',
            'Queued profile value should flush after the in-flight commit'
        );
        assertEqual(adapterStore.get('profile_tagesgeld'), '200', 'Queued profile value should become the confirmed value');
        const cash = JSON.parse(adapterStore.get('profile_cash_history_v1'));
        assertEqual(cash.baselineValue, 0, 'Langsamer Flush bewahrt frühere Basis');
        assertEqual(JSON.stringify(cash.entries.map(entry => entry.value)), '[100,200]', 'Zwei bestätigte Änderungen am gleichen Tag bleiben geordnet');
        assertEqual(doc.getElementById('retryTrancheSaveBtn').hidden, true, 'Successful queued save should not require manual retry');
    }
    console.log('✓ slow-flush profile queue OK');

    console.log('Test 9b: active decimal autosave and blur preserve canonical records without dirty warning');
    {
        const adapterStore = new Map();
        let saveCalls = 0, releaseSave, rejectNext = false;
        const saveGate = new Promise(resolve => { releaseSave = resolve; });
        const adapter = {
            name: 'decimal-profile-memory', async open() {}, async loadAll() { return Object.fromEntries(adapterStore); },
            async saveBatch(batch) {
                saveCalls++;
                if (batch.upserts.some(([key, value]) => key === 'profile_gold_ziel_pct' && String(value) === '6.5')) await saveGate;
                if (rejectNext) { rejectNext = false; throw new Error('DECIMAL_PROFILE_FLUSH_REJECTED'); }
                batch.deletes.forEach(key => adapterStore.delete(key));
                batch.upserts.forEach(([key, value]) => adapterStore.set(key, String(value)));
            }
        };
        const doc = createTranchenPageDom();
        const input = doc.getElementById('profileGoldZiel');
        input.tagName = 'INPUT'; input.type = 'text'; input.setAttribute('inputmode', 'decimal');
        installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init();
        await initTranchenManagerPage({ profileId: 'default' });
        await PersistenceFacade.flush(); saveCalls = 0;
        input.focus(); input.value = '6.5'; input.listeners.input[0]();
        await waitFor(() => saveCalls === 1 && getPageNavigationGuard(doc).reasons().some(reason => reason.phase === 'commit'), 'Autosave starts with active decimal input');
        assertEqual(input.disabled, false, 'Aktives Dezimalfeld bleibt beim Autosave bearbeitbar und fokussiert');
        assertEqual(doc.getElementById('profileGoldFloor').disabled, true, 'Andere Profilfelder behalten die vorhandene Savesperre');
        assert(getPageNavigationGuard(doc).reasons().some(reason => reason.phase === 'commit'), 'Aktive Dezimaleingabe hebt Commit-/Navigationsschutz nicht auf');
        input.value = '7.5'; input.listeners.input[0](); releaseSave();
        await waitFor(() => adapterStore.get('profile_gold_ziel_pct') === '7.5'
            && doc.getElementById('tranchePersistenceStatus').textContent === 'Profilwerte dauerhaft gespeichert.', 'Neueste aktive Dezimaleingabe ist bestätigt');
        assertEqual(input.value, '7.5', 'Aktive Eingabe bleibt auch nach abgeschlossenem Autosave Punkttext');
        assertEqual(saveCalls, 2, 'Eingabe während Flush nutzt genau einen vorhandenen Folgesave');
        const before = JSON.stringify([...adapterStore]);
        doc.activeElement = null;
        doc.listeners.focusout[0]({ target: input });
        assertEqual(input.value, '7,5', 'Verlassen stellt Anzeige auf Komma um');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Reine Formatierung erzeugt keinen ungespeicherten Navigationshinweis');
        await new Promise(resolve => setTimeout(resolve, 350));
        assertEqual(saveCalls, 2, 'Reine Formatierung erzeugt keinen Save');
        assertEqual(JSON.stringify([...adapterStore]), before, 'Formatierung verändert keine bestätigten Exportrecords');
        assertEqual(doc.listeners.focusout.length, 1, 'Manager bindet den Dezimalformatter genau einmal');
        rejectNext = true;
        input.focus(); input.value = '8.5'; input.listeners.input[0]();
        await waitFor(() => doc.getElementById('retryTrancheSaveBtn').hidden === false, 'Dezimaler Fehlflush stellt Retry bereit');
        assertEqual(input.value, '7,5', 'Fehler-Rollback projiziert bestätigten Stand auch bei aktivem Dezimalfeld');
        assertEqual(adapterStore.get('profile_gold_ziel_pct'), '7.5', 'Fehlflush behält kanonischen bestätigten Wert');
        await doc.getElementById('retryTrancheSaveBtn').click();
        assertEqual(adapterStore.get('profile_gold_ziel_pct'), '8.5', 'Retry bestätigt den ausstehenden Dezimalwert');
        assertEqual(input.value, '8,5', 'Retry überschreibt abweichenden sichtbaren Rollbackwert');
        assertEqual(getPageNavigationGuard(doc).reasons().length, 0, 'Retry bestätigt erneut eine saubere Baseline');
        input.value = '9.5';
        await initTranchenManagerPage({ profileId: 'other-decimal-person' });
        assertEqual(input.value, '8,5', 'Profilinitialisierung verwendet weiter die bestätigte Defaultprojektion');
        assertEqual(doc.listeners.focusout.length, 1, 'Profilwechsel installiert keinen zweiten Formatierungspfad');
        const finishDecimal = new Function('byId', 'canonicalDecimalInput', 'isManagerModalSubmissionCurrent',
            'captureManagerModalSubmission', 'finishManagerModalSubmission', decimalFinishSource + '\nreturn finishManagerDecimalSubmission;')(
                id => doc.getElementById(id), canonicalDecimalInput, isManagerModalSubmissionCurrent,
                captureManagerModalSubmission, finishManagerModalSubmission);
        const shares = doc.getElementById('shares');
        shares.tagName = 'INPUT'; shares.type = 'text'; shares.setAttribute('inputmode', 'decimal');
        await doc.getElementById('depotAddTrancheBtn').click();
        shares.value = '7.5';
        const sameSubmission = captureManagerModalSubmission('tranche');
        const originalSignature = sameSubmission.signature;
        doc.listeners.focusout[0]({ target: shares });
        const dialogRecords = JSON.stringify([...adapterStore]);
        assertEqual(finishDecimal('tranche', sameSubmission), true, 'Bestätigter Dialogabschluss akzeptiert alleinige Punkt-/Kommaformatierung nach Retry');
        assertEqual(doc.getElementById('trancheModal').classList.contains('active'), false, 'Reine Formatierung hinterlässt keinen falschen offenen Dirty-Dialog');
        assertEqual(sameSubmission.signature, originalSignature, 'Formatvergleich verändert den gespeicherten UI-Auftrag nicht');
        await doc.getElementById('depotAddTrancheBtn').click();
        shares.value = '7.5'; const changedSubmission = captureManagerModalSubmission('tranche');
        shares.value = '8,5';
        assertEqual(finishDecimal('tranche', changedSubmission), false, 'Echte spätere Dialogwertänderung wird nicht als Formatierung geschlossen');
        assertEqual(doc.getElementById('trancheModal').classList.contains('active'), true, 'Spätere Dialogeingabe bleibt sichtbar geschützt');
        assert(getPageNavigationGuard(doc).reasons().some(reason => reason.dirty), 'Spätere Dialogwertänderung bleibt Dirty');
        assertEqual(JSON.stringify([...adapterStore]), dialogRecords, 'Dialogformatvergleich erzeugt keinen Fachwrite');
        await finishManagerModalSubmission('tranche', captureManagerModalSubmission('tranche'));
    }

    console.log('Test 10: stale cash-correction dialog is blocked before confirmation and preserves the newer audit');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        const sale = createCashSale();
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([sale])));

        await initTranchenManagerPage({ profileId: 'page-cash-profile' });
        const actionButton = new MockElement('correct-page-cash', 'button');
        actionButton.dataset.cashAction = 'correct';
        actionButton.dataset.targetActionId = sale.actionId;
        doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: actionButton });
        assert(doc.getElementById('cashPostingModalSummary').textContent.includes('Nächste Korrekturrevision: 1'),
            'Correction dialog should pin the displayed revision');
        assert(doc.getElementById('cashPostingModalSummary').textContent.includes('cash-correction:v1:page-cash-sale:1'),
            'Correction dialog should pin the displayed canonical action id');

        const registryAfterOtherTab = createCashRegistry([sale, {
            schemaVersion: 1,
            eventType: 'cash_posting_corrected',
            actionId: 'cash-correction:v1:page-cash-sale:1',
            correctionActionId: 'cash-correction:v1:page-cash-sale:1',
            targetActionId: sale.actionId,
            correctsActionId: sale.actionId,
            correctionRevision: 1,
            profileId: sale.profileId,
            confirmedNetProceedsEur: 95,
            cashBalanceAfterPostingEur: 4000,
            correctionReason: 'Parallel in Tab B korrigiert',
            correctedAt: '2026-07-15T09:00:00.000Z'
        }]);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registryAfterOtherTab));
        doc.getElementById('cashPostingBalance').value = '4500';
        doc.getElementById('cashPostingReason').value = 'Veraltete Annahme aus Tab A';
        let confirmCalls = 0;
        global.confirm = () => { confirmCalls += 1; return true; };

        const submitted = await doc.getElementById('cashPostingForm').listeners.submit[0]({ preventDefault() {} });
        const persisted = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        assertEqual(submitted, false, 'Stale correction dialog should be rejected');
        assertEqual(confirmCalls, 0, 'Stale correction must fail before the final confirmation dialog');
        assertEqual(persisted.trancheReconciliation.actions.length, 2,
            'Stale correction must not append a silently re-derived revision');
        assertEqual(persisted.trancheReconciliation.actions[1].cashBalanceAfterPostingEur, 4000,
            'Newer effective cash balance must remain unchanged');
        assertEqual(doc.getElementById('cashPostingFormError').hidden, false,
            'Stale correction should expose an actionable modal error');
        assert(doc.getElementById('cashPostingFormError').textContent.includes('abweichenden Payload')
            || doc.getElementById('cashPostingFormError').textContent.includes('aktuellen Stand'),
        'Stale correction error should explain the conflict or request a current reload');
    }
    console.log('✓ stale cash-dialog gate OK');

    console.log('Test 11: unreadable cash audit renders an incomplete-list warning instead of an empty history');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([{
            ...createCashSale(),
            eventType: 'unknown_future_event'
        }])));

        await initTranchenManagerPage({ profileId: 'page-cash-profile' });
        const panel = doc.getElementById('reconciliationCashStatuses').innerHTML;
        assert(panel.includes('Cashstatus-Audit nicht lesbar – die Liste ist unvollständig'),
            'Manager panel should expose its unreadable audit state');
        assert(!panel.includes('Noch keine dokumentierten Realverkäufe'),
            'Unreadable audit must not be rendered as an empty sale history');
        assert(doc.getElementById('reconciliationStatus').textContent.includes('blockiert'),
            'Manager form should keep cash confirmation and correction visibly blocked');
    }
    console.log('✓ unreadable cash-audit panel contract OK');

    console.log('Test 12: cash confirmation uses the page orchestrator and appends exactly one audit event');
    {
        const storageRef = createLocalStorageMock();
        const doc = createTranchenPageDom();
        installGlobals(doc, storageRef);
        PersistenceFacade.resetPersistenceForTests();
        await PersistenceFacade.init();
        const pendingSale = createCashSale({ cashStatus: 'pending_manual_posting' });
        delete pendingSale.cashBalanceAfterPostingEur;
        delete pendingSale.cashConfirmedAt;
        const registry = createCashRegistry([pendingSale]);
        const saleBefore = JSON.stringify(registry.trancheReconciliation.actions[0]);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        persistenceStorage.setItem('rs_current_profile', 'page-cash-profile');
        persistenceStorage.setItem('rs_active_profile', 'page-cash-profile');

        await initTranchenManagerPage({ profileId: 'page-cash-profile' });
        const actionButton = new MockElement('confirm-page-cash', 'button');
        actionButton.dataset.cashAction = 'confirm';
        actionButton.dataset.targetActionId = pendingSale.actionId;
        doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: actionButton });
        doc.getElementById('cashPostingBalance').value = '5095';
        let confirmationText = '';
        global.confirm = message => { confirmationText = message; return true; };

        const submitted = await doc.getElementById('cashPostingForm').listeners.submit[0]({ preventDefault() {} });
        const persisted = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
        assertEqual(submitted, true, 'Page orchestrator should commit a confirmed cash posting');
        assertEqual(confirmationText, '', 'Die ausdrückliche Seitendialogbestätigung braucht keine zweite native Rückfrage');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '5095', 'Cashnachtrag übernimmt den absoluten Tagesgeldstand');
        assertEqual(String(doc.getElementById('profileTagesgeld').value), '5095', 'Manager zeigt den bestätigten Stand ohne zweite Eingabe');
        assertEqual(persisted.trancheReconciliation.actions.length, 2,
            'Page orchestrator should append exactly one confirmation event');
        assertEqual(JSON.stringify(persisted.trancheReconciliation.actions[0]), saleBefore,
            'Page orchestrator must preserve the original sale record exactly');
        assertEqual(persisted.trancheReconciliation.actions[1].eventType, 'cash_posting_confirmed',
            'Page orchestrator should persist the explicit confirmation event');
        assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), false,
            'Successful confirmation should close the cash modal');
    }
    console.log('✓ cash page orchestration contract OK');

    console.log('Cashnachtrag verweigert ungespeicherte fremde Profilfelder vor jedem Write');
    for (const mode of ['confirm', 'correct']) {
        const doc = createTranchenPageDom();
        installGlobals(doc, createLocalStorageMock());
        const backend = new Map();
        let writes = 0;
        PersistenceFacade.resetPersistenceForTests({
            name: 'cash-profile-dirty', async open() {}, async loadAll() { return Object.fromEntries(backend); },
            async saveBatch({ deletes, upserts }) {
                writes += 1;
                deletes.forEach(key => backend.delete(key));
                upserts.forEach(([key, value]) => backend.set(key, value));
            }
        });
        await PersistenceFacade.init();
        const sale = createCashSale(mode === 'confirm' ? {
            cashStatus: 'pending_manual_posting', cashBalanceAfterPostingEur: undefined, cashConfirmedAt: undefined
        } : {});
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([sale])));
        persistenceStorage.setItem('rs_current_profile', 'page-cash-profile');
        persistenceStorage.setItem('rs_active_profile', 'page-cash-profile');
        await initTranchenManagerPage({ profileId: 'page-cash-profile' });
        await PersistenceFacade.flush();
        const recordsBefore = JSON.stringify([...backend]);
        const writesBefore = writes;
        const input = doc.getElementById('profileGoldZiel');
        const baseline = input.value;
        input.value = '17,5';
        const button = new MockElement('dirty-profile-cash', 'button');
        button.dataset.cashAction = mode;
        button.dataset.targetActionId = sale.actionId;
        doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: button });
        doc.getElementById('cashPostingBalance').value = '5095';
        doc.getElementById('cashPostingReason').value = 'Synthetischer Zahlendreher';
        assertEqual(await doc.getElementById('cashPostingForm').listeners.submit[0]({ preventDefault() {} }), false,
            mode + ': Ungespeicherte Profileingabe verhindert Cashnachtrag');
        assertEqual(writes, writesBefore, mode + ': Verweigerung erfolgt vor jedem Backendwrite');
        assertEqual(JSON.stringify([...backend]), recordsBefore, mode + ': Dauerhafte Fachbytes bleiben unverändert');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), backend.get('rs_profiles_v1'), mode + ': Auch Registrycache bleibt unverändert');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), null, mode + ': Kein Livecashwrite');
        assertEqual(persistenceStorage.getItem('profile_cash_history_v1'), null, mode + ': Kein Historienwrite');
        assertEqual(input.value, '17,5', mode + ': Fremde Profileingabe bleibt erhalten');
        assertEqual(doc.getElementById('cashPostingFormError').hidden, false, mode + ': Verweigerung ist sichtbar');
        assert(doc.getElementById('cashPostingFormError').textContent.includes('Profiländerungen dauerhaft speichern'),
            mode + ': Hinweis nennt die erforderliche Profilbestätigung');
        assert(getPageNavigationGuard(doc).reasons().some(reason => reason.owner === 'manager-retry-inputs' && reason.dirty),
            mode + ': Seitennavigationsschutz bleibt dirty');
        input.value = baseline;
        assert(!getPageNavigationGuard(doc).reasons().some(reason => reason.owner === 'manager-retry-inputs' && reason.dirty),
            mode + ': Ursprüngliche Profilbaseline bleibt erhalten');
        assertEqual(await doc.getElementById('cashPostingForm').listeners.submit[0]({ preventDefault() {} }), true,
            mode + ': Nach bewusster Rücknahme ist derselbe Cashnachtrag möglich');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '5095', mode + ': Erfolgreicher Nachtrag übernimmt absoluten Stand');
    }

    console.log('Test 13: Dynamische Cashfelder melden Ereignisse unmittelbar an den Seitenguard');
    for (const mode of ['confirm', 'correct']) {
        const doc = createTranchenPageDom();
        installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests();
        await PersistenceFacade.init();
        const sale = createCashSale(mode === 'confirm' ? {
            cashStatus: 'pending_manual_posting', cashBalanceAfterPostingEur: undefined, cashConfirmedAt: undefined
        } : {});
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([sale])));
        persistenceStorage.setItem('rs_current_profile', 'page-cash-profile');
        persistenceStorage.setItem('rs_active_profile', 'page-cash-profile');
        for (const id of ['cashPostingModal', 'cashPostingBalance', 'cashPostingReason', 'cashPostingForm']) {
            assertEqual(doc.getElementById(id), null, 'Cashmarkup fehlt vor der Pageinitialisierung');
        }
        await initTranchenManagerPage({ profileId: 'page-cash-profile' });
        const guard = getPageNavigationGuard(doc);
        const snapshots = [];
        const unsubscribe = guard.subscribe(reasons => snapshots.push(reasons));
        const installed = () => (window.listeners.beforeunload || []).includes(guard.beforeUnload);
        const button = new MockElement('cash-status-action', 'button');
        button.dataset.cashAction = mode;
        button.dataset.targetActionId = sale.actionId;
        const open = () => doc.getElementById('reconciliationCashStatuses').listeners.click[0]({ target: button });
        open();
        assert(!snapshots.at(-1).some(reason => reason.owner === 'manager-dialog-cash' && reason.dirty),
            'Unveränderte Cashöffnung meldet keinen Dirty-Grund');
        assertEqual(installed(), false, 'Saubere Öffnung bindet guard.beforeUnload nicht');
        const registryBefore = persistenceStorage.getItem('rs_profiles_v1');
        const modal = doc.getElementById('cashPostingModal');
        assert(doc.created.includes(modal), 'ensureCashPostingModal erzeugt das Dialogelement über createElement');
        // Zuerst ausschließlich die Bindung durch Pageinitialisierung und Öffnung prüfen.
        for (const id of ['cashPostingBalance', 'cashPostingReason']) for (const event of ['input', 'change']) {
            assertEqual(doc.getElementById(id).listeners[event]?.length, 1,
                'Der Produktionspfad bindet jeden Cashfeldlistener genau einmal');
        }
        for (const id of ['cashPostingBalance', 'cashPostingReason']) {
            const field = doc.getElementById(id), baseline = field.value;
            for (const event of ['input', 'change']) {
                const notificationsBefore = snapshots.length;
                field.value = id === 'cashPostingBalance' ? '5095' : 'Synthetische Korrektur';
                field.listeners[event].forEach(handler => handler({ type: event, target: field }));
                assertEqual(snapshots.length, notificationsBefore + 1, 'Ein DOM-Ereignis benachrichtigt den Subscriber genau einmal');
                assert(snapshots.at(-1).some(reason => reason.owner === 'manager-dialog-cash' && reason.dirty === true),
                    'Der Subscriber erhält Dirty ohne explizites Lesen oder Refresh des Guards');
                assertEqual(installed(), true, 'Dasselbe guard.beforeUnload ist sofort am Testfenster installiert');
                field.value = baseline;
                field.listeners[event].forEach(handler => handler({ type: event, target: field }));
                assertEqual(installed(), false, 'Baseline-Rückänderung entfernt den Nachfragehandler');
            }
        }
        // Erst nach dem Produktionsnachweis die Idempotenz separat prüfen.
        for (let repeat = 0; repeat < 3; repeat++) bindCashPostingModalLifecycle(doc);
        for (const id of ['cashPostingBalance', 'cashPostingReason']) for (const event of ['input', 'change']) {
            assertEqual(doc.getElementById(id).listeners[event]?.length, 1,
                'Wiederholte Bindung erzeugt keinen weiteren Cashfeldlistener');
        }
        const form = doc.getElementById('cashPostingForm');
        assertEqual(form.listeners.reset.length, 1, 'Resetlistener wird nur einmal gebunden');
        const balance = doc.getElementById('cashPostingBalance'), baseline = balance.value;
        balance.value = '5095';
        balance.listeners.input[0]({ target: balance });
        const resetNotifications = snapshots.length;
        form.reset();
        await Promise.resolve();
        assertEqual(snapshots.length, resetNotifications + 1, 'Reset benachrichtigt nach dem Zurücksetzen genau einmal');
        assertEqual(installed(), baseline !== '', 'Reset bewertet die tatsächlichen Werte gegen die aktuelle Öffnungsbaseline');
        balance.value = baseline;
        balance.listeners.change[0]({ target: balance });
        assertEqual(closeCashPostingModal(doc), true, 'Sauberer Schluss erfolgt ohne Nachfrage');
        assertEqual(installed(), false, 'Sauberer Schluss hinterlässt keinen Nachfragehandler');
        open();
        assertEqual(form.listeners.reset.length, 1, 'Erneute Öffnung verdoppelt keinen Formularlistener');
        assertEqual(balance.listeners.input.length, 1, 'Erneute Öffnung verdoppelt keinen Feldlistener');
        balance.value = '5096';
        balance.listeners.input[0]({ target: balance });
        assertEqual(installed(), true, 'Auch nach erneutem Öffnen meldet input sofort Dirty');
        assertEqual(persistenceStorage.getItem('rs_profiles_v1'), registryBefore,
            'Bloße Dialogeingaben erhalten sämtliche gespeicherten Cashaktionen und IDs bytegleich');
        balance.value = baseline;
        balance.listeners.input[0]({ target: balance });
        closeCashPostingModal(doc);
        await doc.getElementById('depotAddTrancheBtn').click();
        const name = doc.getElementById('name');
        name.value = 'Synthetische Tranche';
        name.listeners.input[0]({ target: name });
        assert(snapshots.at(-1).some(reason => reason.owner === 'manager-dialog-tranche' && reason.dirty),
            'Trancheneingaben melden weiterhin unmittelbar Dirty an denselben Subscriber');
        assertEqual(installed(), true, 'Trancheneingaben installieren denselben Nachfragehandler');
        name.value = '';
        name.listeners.input[0]({ target: name });
        await doc.getElementById('closeTrancheModalBtn').click();
        assertEqual(installed(), false, 'Sauberer Tranchenschluss entfernt den Nachfragehandler');
        unsubscribe();
    }
    console.log('✓ dynamische Cashfelder und unveränderte Tranchenanbindung OK');

    console.log('Herkunftsbestätigung: produktiver Autosave mit dauerhaftem Readback und Flushfehler');
    {
        const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_geschlecht: 'm',
            profile_person_migration_v1: JSON.stringify({ sources: { geschlecht: ['angenommen'] } }), depot_tranchen: '[]' };
        const backend = { ...data, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1,
            profiles: { a: { meta: { id: 'a', name: 'Muster A' }, data } } }) };
        let writes = 0, release = null, failNext = false;
        const adapter = { name: 'Herkunft', async init() {}, async loadAll() { return { ...backend }; },
            async saveBatch({ upserts, deletes }) {
                writes++;
                if (release === 'pause') await new Promise(resolve => { release = resolve; });
                if (failNext) { failNext = false; throw new Error('SYNTHETIC_GENDER_FLUSH_FAILED'); }
                deletes.forEach(k => delete backend[k]); upserts.forEach(([k, v]) => backend[k] = v);
            } };
        const doc = createTranchenPageDom();
        doc.register(new MockElement('profileGenderStatus'));
        const gender = doc.getElementById('profileGeschlecht'); gender.tagName = 'SELECT';
        installGlobals(doc, createLocalStorageMock()); PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        initTranchenManagerPage({ profileId: 'a' });
        const assumed = () => JSON.parse(backend.profile_person_migration_v1).sources.geschlecht.includes('angenommen');
        assert(assumed(), 'Rendern bestätigt angenommenes Geschlecht nicht');
        const cash = doc.getElementById('profileTagesgeld'); cash.value = '100'; cash.dispatchEvent({ type: 'input', target: cash });
        await waitFor(() => writes > 0 && doc.getElementById('tranchePersistenceStatus').textContent.includes('dauerhaft gespeichert'), 'Anderes Feld wurde gespeichert');
        assert(assumed(), 'Speichern eines anderen Feldes erhält Herkunft');
        failNext = true;
        gender.dispatchEvent({ type: 'change', target: gender });
        await waitFor(() => doc.getElementById('tranchePersistenceStatus').textContent.includes('Retry'), 'Herkunftsflushfehler erreicht Rollback');
        assert(assumed(), 'Fehlgeschlagener Flush entfernt Herkunft nicht');
        release = 'pause';
        const retry = doc.getElementById('retryTrancheSaveBtn').click();
        await waitFor(() => typeof release === 'function', 'Bestätigungsretry pausiert im produktiven Flush');
        assert(assumed(), 'Vor dauerhaftem Flush ist derselbe Wert m nicht bestätigt');
        release(); await retry;
        assert(!assumed(), 'Bewusste Bestätigung desselben m entfernt Herkunft erst nach erfolgreichem Speichern');
        assertEqual(backend.profile_geschlecht, 'm', 'Bestätigung ändert den wirksamen Rechenwert nicht');
        assert(!JSON.parse(backend.rs_profiles_v1).profiles.a.data.profile_person_migration_v1.includes('angenommen'), 'Registry und Live-Herkunft sind gemeinsam dauerhaft bestätigt');
    }

    console.log('SOURCE: März-Audit und aktueller Aprilstand bleiben im Mai getrennt');
    for (const inputAmount of ['8000', '8000,00', '10100']) {
        const amount = Number(canonicalDecimalInput(inputAmount));
        const scenario = await createMonthlyCashScenario();
        const { id, doc, backend, adapter, open, submit, snapshot } = scenario;
        const before = snapshot();
        open('correct');
        const summary = doc.getElementById('cashPostingModalSummary').textContent;
        assert(summary.includes('Aktueller Tagesgeld-Stand: 8.000,00')
            && summary.includes('Historischer Auditbetrag (letzter Nachweis): 10.000,00'),
        'Mai zeigt aktuellen Aprilstand und historischen Märzbetrag getrennt');
        assertEqual(Number(canonicalDecimalInput(doc.getElementById('cashPostingBalance').value)), 8000,
            'Mai belegt ausschließlich den aktuellen Aprilbetrag numerisch vor');
        assertEqual(JSON.stringify(snapshot()), JSON.stringify(before), 'Öffnen verändert weder Cache noch Backend');
        assertEqual(closeCashPostingModal(doc), true, 'Unveränderter Korrekturdialog lässt sich abbrechen');
        assertEqual(JSON.stringify(snapshot()), JSON.stringify(before), 'Abbruch erhält sämtliche Aprilrohbytes');
        open('correct');
        assert(doc.getElementById('cashPostingSubmitBtn').textContent.includes('Aktuellen Tagesgeld-Stand übernehmen'),
            'Submit benennt die Übernahme des aktuellen Standes ausdrücklich');
        doc.getElementById('cashPostingBalance').value = inputAmount;
        doc.getElementById('cashPostingReason').value = 'Synthetische bewusste Maibestätigung';
        assertEqual(JSON.stringify(snapshot()), JSON.stringify(before), 'Auch eine bewusste Eingabe allein schreibt nichts');
        assertEqual(await submit(), true, 'Ausdrücklicher Submit bestätigt die Maikorrektur');
        const statusText = doc.getElementById('reconciliationStatus').textContent;
        const persistenceText = doc.getElementById('tranchePersistenceStatus').textContent;
        if (amount === 8000) {
            assertEqual(statusText, 'Nur der Korrektur-Auditnachweis wurde append-only gespeichert; Verkauf und frühere Nachweise blieben unverändert.', 'Gleichwertige Eingabe meldet ausschließlich Auditappend');
            assertEqual(persistenceText, 'Nur der Auditnachweis wurde dauerhaft ergänzt.', 'Persistenzmeldung nennt ausschließlich Auditappend');
            for (const message of [statusText, persistenceText]) assert(!/Tagesgeld|übernommen|Cashhistorie/.test(message), 'Reiner Auditappend behauptet keine Cashwirkung');
        } else {
            assertEqual(statusText, 'Neuer Tagesgeld-Stand übernommen und Korrektur-Auditnachweis append-only gespeichert; Verkauf und frühere Nachweise blieben unverändert.', 'Änderung meldet ausdrücklich den übernommenen neuen Stand');
            assertEqual(persistenceText, 'Neuer Tagesgeld-Stand übernommen und Auditnachweis gemeinsam dauerhaft gespeichert.', 'Persistenzmeldung bestätigt neuen Stand und Audit gemeinsam');
        }
        const after = snapshot();
        const oldRegistry = JSON.parse(before.backend.rs_profiles_v1);
        const registry = JSON.parse(after.backend.rs_profiles_v1);
        const records = registry.trancheReconciliation.actions;
        assertEqual(records.length, 3, 'Mai hängt genau einen Folge-Auditrecord an');
        assertEqual(JSON.stringify(records.slice(0, 2)), JSON.stringify(oldRegistry.trancheReconciliation.actions),
            'Verkauf und Märzbestätigung bleiben unverändert');
        assertEqual(records[2].confirmedNetProceedsEur, 95, 'Nettoerlös bleibt unverändert und wird nicht addiert');
        assertEqual(records[2].cashBalanceAfterPostingEur, amount, 'Audit dokumentiert ausschließlich den ausdrücklich bestätigten Betrag');
        assertEqual(JSON.stringify(registry.profiles.fremd), JSON.stringify(oldRegistry.profiles.fremd), 'Fremde Person bleibt unverändert');
        const otherProfileData = data => Object.fromEntries(Object.entries(data).filter(([key]) => !['profile_tagesgeld', 'profile_cash_history_v1'].includes(key)));
        assertEqual(JSON.stringify(otherProfileData(registry.profiles[id].data)), JSON.stringify(otherProfileData(oldRegistry.profiles[id].data)),
            'Alle übrigen profilgebundenen Records bleiben unverändert');
        assertEqual(JSON.stringify(registry.profiles[id].meta), JSON.stringify(oldRegistry.profiles[id].meta), 'Auditappend ändert keine Personenmetadaten');
        for (const key of Object.keys(before.backend).filter(key => !['rs_profiles_v1', 'profile_tagesgeld', 'profile_cash_history_v1'].includes(key))) {
            assertEqual(after.backend[key], before.backend[key], key + ': fremder Record oder Lots bleiben bytegleich');
            assertEqual(after.cache[key], before.cache[key], key + ': Cache bleibt bytegleich');
        }
        const cashHistory = JSON.parse(after.backend.profile_cash_history_v1);
        if (amount === 8000) for (const key of ['profile_tagesgeld', 'profile_cash_history_v1']) {
            assertEqual(after.backend[key], before.backend[key], key + ': unveränderter Betrag erhält Backendrohbytes');
            assertEqual(after.cache[key], before.cache[key], key + ': unveränderter Betrag erhält Cacherohbytes');
        }
        else {
            assertEqual(after.backend.profile_tagesgeld, '10100', 'Bewusste Änderung wird absolut übernommen');
            assertEqual(cashHistory.entries.length, 3, 'Bewusste Änderung ergänzt genau einen Cashbeleg');
            assertEqual(JSON.stringify(cashHistory.entries.at(-1)), JSON.stringify({ date: '2026-05-10', value: 10100 }),
                'Maiänderung ist datiert und nicht rückwirkend');
        }
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        await initTranchenManagerPage({ profileId: id });
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), String(amount), 'Backendreadback und Neustart bestätigen den absoluten Maibetrag');
        assertEqual(Number(canonicalDecimalInput(doc.getElementById('profileTagesgeld').value)), amount, 'Neustart zeigt den bestätigten Tagesgeldstand');
        assertEqual(persistenceStorage.getItem('profile_cash_history_v1'), after.backend.profile_cash_history_v1, 'Neustart lädt die bestätigte Cashhistorie bytegleich');
        // Ein weiterer echter Profilwrite darf alte, identische Aufträge nicht reaktivieren.
        setAppTestDate('2026-06-10');
        const input = doc.getElementById('profileTagesgeld');
        input.value = '7000'; input.listeners.input[0]({ target: input });
        await waitFor(() => backend.get('profile_tagesgeld') === '7000'
            && !doc.getElementById('profileGoldZiel').disabled, 'Juniprofilwrite wird bestätigt');
        const june = snapshot();
        for (const [commit, record] of [[commitCashPostingConfirmation, records[1]], [commitCashPostingCorrection, records[2]]]) {
            const result = await commit({ ...record, profileId: id, expectedRegistryRaw: before.backend.rs_profiles_v1,
                expectedCashRecords: { profile_tagesgeld: '8000', profile_cash_history_v1: before.backend.profile_cash_history_v1 },
                confirmedAt: '2026-06-10T12:00:00.000Z', correctedAt: '2026-06-10T12:00:00.000Z' });
            assertEqual(result.status, 'duplicate', 'Identische Wiederholung bleibt trotz späterem Profilwrite ein No-op');
            assertEqual(result.cashRecordsChanged, false, 'Alter identischer Auftrag meldet keine Cashänderung');
            assertEqual(JSON.stringify(snapshot()), JSON.stringify(june), 'No-op erhält jeden Rohrecord und ursprünglichen Auditzeitpunkt');
        }
        PersistenceFacade.resetPersistenceForTests(adapter);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '7000', 'Neustart lädt den letzten echten Profilwrite');
        assertEqual(JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).trancheReconciliation.actions[2].cashBalanceAfterPostingEur,
            amount, 'Neustart erhält separat den bestätigten Mai-Auditbetrag');
    }

    console.log('SOURCE: Einzelne Cashrohbyteänderungen verweigern den alten Dialog vor jedem Domainwrite');
    for (const key of ['profile_tagesgeld', 'profile_cash_history_v1']) for (const phase of ['vor Submit', 'im Vorflush']) {
        const { doc, backend, open, submit, snapshot } = await createMonthlyCashScenario();
        open('correct');
        doc.getElementById('cashPostingReason').value = 'Veralteter Mai-Auftrag';
        const registryBefore = backend.get('rs_profiles_v1');
        const originalFlush = PersistenceFacade.flush;
        const originalReplace = PersistenceFacade.replaceRecordsTransactional;
        let release, entered = false, writes = 0;
        PersistenceFacade.replaceRecordsTransactional = (...args) => { writes++; return originalReplace(...args); };
        const mutate = async () => {
            // Nur EIN Record, Registry und der andere Cashrecord bleiben unangetastet.
            persistenceStorage.setItem(key, key === 'profile_tagesgeld' ? '7999'
                : JSON.stringify({ version: 1, baselineValue: 9000, entries: [{ date: '2026-04-11', value: 8000 }] }));
            await originalFlush();
        };
        try {
            let submitted;
            if (phase === 'vor Submit') { await mutate(); submitted = submit(); }
            else {
                PersistenceFacade.flush = async () => { entered = true; await new Promise(resolve => { release = resolve; }); return originalFlush(); };
                submitted = submit();
                await waitFor(() => entered, 'Korrekturauftrag wartet im gehaltenen Vorflush');
                await mutate();
            }
            const newer = snapshot();
            release?.();
            assertEqual(await submitted, false, key + ' ' + phase + ': alter Auftrag wird verweigert');
            assertEqual(writes, 0, 'Stale-Auftrag erreicht keinen Domainwriter');
            assertEqual(JSON.stringify(snapshot()), JSON.stringify(newer), 'Neuere Rohbytes bleiben in Cache und Backend erhalten');
            assertEqual(backend.get('rs_profiles_v1'), registryBefore, 'Stale-Auftrag hängt keinen Auditrecord an');
            assert(doc.getElementById('cashPostingFormError').textContent.includes('aktuellen Stand'),
                'Dialog verlangt sichtbar einen aktuellen Stand');
            assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), true, 'Stale-Editor bleibt sichtbar');
            assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, true, 'Stale-Auftrag bietet keinen irreführenden technischen Retry');
            assertEqual(getManagerCashPostingDiagnostics().pendingCashPosting, null, 'Stale-Auftrag hält keinen Cashretryauftrag fest');
            assertEqual(closeCashPostingModal(doc, { confirmed: true }), true, 'Stale-Editor lässt sich für eine neue Quellenaufnahme schließen');
            open('correct');
            assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), true, 'Verweigerung blockiert keinen neu geöffneten Dialog');
        } finally { PersistenceFacade.flush = originalFlush; PersistenceFacade.replaceRecordsTransactional = originalReplace; }
    }

    console.log('SOURCE: Technische Transaktionsfehler erhalten Editor und ursprünglichen Retryauftrag');
    for (const fault of ['Speicherfehler', 'Readbackabweichung']) {
        const { doc, backend, adapter, open, submit, snapshot } = await createMonthlyCashScenario();
        open('correct');
        doc.getElementById('cashPostingBalance').value = '10100';
        doc.getElementById('cashPostingReason').value = 'Synthetischer sicherer Retry';
        const before = snapshot(), saveBatch = adapter.saveBatch;
        let injected = false;
        adapter.saveBatch = async batch => {
            const registryRaw = batch.upserts.find(([key]) => key === 'rs_profiles_v1')?.[1];
            const target = registryRaw && JSON.parse(registryRaw).trancheReconciliation?.actions.length === 3;
            if (target && !injected) {
                injected = true;
                if (fault === 'Speicherfehler') throw new Error('Synthetischer Backendwritefehler');
                await saveBatch(batch);
                backend.set('profile_tagesgeld', '10101');
                return;
            }
            return saveBatch(batch);
        };
        assertEqual(await submit(), false, fault + ': Transaktion meldet keinen Erfolg');
        assert(injected, fault + ': Fehler wird im echten Backendpfad ausgelöst');
        assertEqual(JSON.stringify(snapshot()), JSON.stringify(before), fault + ': bestätigter Rollback stellt alle Originalbytes wieder her');
        assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), true, 'Fehler erhält offenen Editor');
        assertEqual(doc.getElementById('cashPostingBalance').value, '10100', 'Fehler erhält bewusste Eingabe');
        assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, false, 'Technischer Fehler bietet sicheren Retry');
        assertEqual(getManagerCashPostingDiagnostics().pendingCashPosting, 'pending', 'Technischer Fehler erhält ursprünglichen Auftrag');
        setAppTestDate('2026-05-11');
        await doc.getElementById('retryCashPostingSaveBtn').click();
        const records = JSON.parse(backend.get('rs_profiles_v1')).trancheReconciliation.actions;
        assertEqual(records.length, 3, 'Retry hängt genau einen Auditrecord an');
        assert(records[2].correctedAt.startsWith('2026-05-10T'), 'Retry erhält den ursprünglichen Auftrag und Nachweiszeitpunkt');
        assertEqual(backend.get('profile_tagesgeld'), '10100', 'Retry bestätigt den ursprünglichen Betrag');
        assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), false, 'Bestätigter Retry schließt ursprünglichen Editor');
        assertEqual(getManagerCashPostingDiagnostics().pendingCashPosting, null, 'Bestätigter Retry entfernt ursprünglichen Auftrag');
    }

    console.log('SOURCE: Beschädigte und widersprüchliche Livequellen werden fachlich ohne Retry verweigert');
    for (const [raw, historyRaw] of [['null', null], ['kaputt', null], ['8000', 'null'], ['8000', 'kaputt'],
        ['8000', JSON.stringify({ version: 1, baselineValue: 9000, entries: [{ date: '2026-04-10', value: 7999 }] })]]) {
        const { doc, open, submit, snapshot } = await createMonthlyCashScenario();
        const valid = snapshot();
        if (historyRaw === null) persistenceStorage.removeItem('profile_cash_history_v1');
        else persistenceStorage.setItem('profile_cash_history_v1', historyRaw);
        persistenceStorage.setItem('profile_tagesgeld', raw);
        await PersistenceFacade.flush();
        const before = snapshot(), replace = PersistenceFacade.replaceRecordsTransactional;
        let calls = 0;
        PersistenceFacade.replaceRecordsTransactional = (...args) => { calls++; return replace(...args); };
        try {
            open('correct');
            const error = doc.getElementById('cashPostingFormError');
            assertEqual(error.hidden, false, 'Fachliche Ablehnung ist bereits beim Öffnen sichtbar');
            assert(error.textContent.includes('Tagesgeldquelle ist beschädigt oder widersprüchlich'), 'Fehler benennt die Quelle');
            assertEqual(doc.getElementById('cashPostingBalance').value, '', 'Keine historische Ersatzvorbelegung');
            assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, true, 'Ungültige Öffnungsquelle sperrt Submit');
            await doc.getElementById('retryTrancheLoadBtn').click(); // Echter Seitenrender ohne Finanzwrite.
            assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, true, 'Seitenrender erhält fachliche Submit-Sperre');
            doc.getElementById('cashPostingBalance').value = '10100';
            doc.getElementById('cashPostingReason').value = 'Synthetische verweigerte Korrektur';
            doc.getElementById('cashPostingBalance').listeners.input[0]({ target: doc.getElementById('cashPostingBalance') });
            assertEqual(await submit(), false, 'Echter Submitlistener verweigert beschädigte Quellen');
            assertEqual(calls, 0, 'Fachlicher Fehler startet keine Transaktion');
            assertEqual(JSON.stringify(snapshot()), JSON.stringify(before), 'Cache und Backend einschließlich Registry/Audit bleiben bytegleich');
            assert(!/Retry ist möglich|wiederhergestellt|Wiederherstellung/.test(error.textContent), 'Keine technische Retry- oder Rollbackbehauptung');
            assertEqual(doc.getElementById('retryCashPostingSaveBtn').hidden, true, 'Kein technischer Retry');
            assertEqual(getManagerCashPostingDiagnostics().pendingCashPosting, null, 'Kein ausstehender Cashauftrag');
            assert(Object.isFrozen(getManagerCashPostingDiagnostics()), 'Diagnose gibt nur einen eingefrorenen Marker heraus');
            const cancelling = doc.getElementById('cashPostingCancelBtn').click();
            assertEqual(doc.getElementById('cashPostingModal').classList.contains('active'), true, 'Dirty-Abbruch wartet auf Verwerfentscheidung');
            await doc.getElementById('navigationGuardLeave').click();
            await cancelling;
            await waitFor(() => !doc.getElementById('cashPostingModal').classList.contains('active'), 'Bestätigter Abbruch schließt den Dialog');
            assertEqual(doc.getElementById('profileTagesgeld').disabled, false, 'Profilfeld bleibt nach Abbruch bedienbar');
            assertEqual(doc.getElementById('depotAddTrancheBtn').disabled, false, 'Weiterer Managerknopf bleibt bedienbar');
            for (const key of ['profile_tagesgeld', 'profile_cash_history_v1']) persistenceStorage.setItem(key, valid.backend[key]);
            await PersistenceFacade.flush();
            open('correct');
            assertEqual(error.hidden, true, 'Gültiges Wiederöffnen löscht den Fehler');
            assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, false, 'Gültiges Wiederöffnen erlaubt Submit');
            closeCashPostingModal(doc);
        } finally { PersistenceFacade.replaceRecordsTransactional = replace; }
    }

    console.log('SOURCE: Fehlende Quelle und numerische Null bleiben ausdrücklich bestätigbar');
    for (const raw of [null, '0']) {
        const { doc, open, submit } = await createMonthlyCashScenario();
        persistenceStorage.removeItem('profile_cash_history_v1');
        if (raw === null) persistenceStorage.removeItem('profile_tagesgeld');
        else persistenceStorage.setItem('profile_tagesgeld', raw);
        await PersistenceFacade.flush();
        open('correct');
        assertEqual(doc.getElementById('cashPostingBalance').value, raw ?? '', 'Fehlende Quelle bleibt leer, numerische Null bleibt gültig');
        assertEqual(doc.getElementById('cashPostingFormError').hidden, true, 'Fehlende Quelle ohne Fehler wird nicht pauschal abgelehnt');
        assertEqual(doc.getElementById('cashPostingSubmitBtn').disabled, false, 'Explizite Eingabe bleibt möglich');
        doc.getElementById('cashPostingBalance').value = '0';
        doc.getElementById('cashPostingReason').value = 'Synthetischer expliziter Nullstand';
        assertEqual(await submit(), true, 'Expliziter Nullstand lässt sich bestätigen');
        assertEqual(persistenceStorage.getItem('profile_tagesgeld'), '0', 'Numerische Null wird übernommen beziehungsweise erhalten');
    }
    setAppTestDate(null);
    for (const kind of ['single', 'all', 'corrupt']) for (const outcome of ['cancel', 'accept', 'stale', 'profile-change']) {
        const doc = createTranchenPageDom(), storage = createLocalStorageMock();
        installGlobals(doc, storage); PersistenceFacade.resetPersistenceForTests();
        const raw = kind === 'corrupt' ? '{synthetisch-korrupt' : JSON.stringify([{
            trancheId: 'decision-lot', name: 'Synthetische Entscheidung', type: 'aktien_neu', category: 'equity',
            shares: 2, purchasePrice: 50, currentPrice: 60, tqf: 0.3, taxExempt: false
        }]);
        persistenceStorage.setItem('depot_tranchen', raw); initTranchenManagerPage(); await PersistenceFacade.flush();
        const request = () => {
            if (kind !== 'single') return doc.getElementById(kind === 'all' ? 'clearTranchesBtn' : 'resetCorruptPayloadBtn').click();
            const target = new MockElement('', 'button'); target.dataset = { action: 'delete-tranche', trancheId: 'decision-lot' };
            doc.getElementById('tranchenTable').listeners.click[0]({ target });
        };
        const pending = request(); await Promise.resolve();
        const count = doc.pageDialogs.length;
        await request();
        assertEqual(doc.pageDialogs.length, count, 'Doppelklick öffnet nur eine Bestandsrückfrage');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), raw, 'Offene Bestandsrückfrage startet keinen Write');
        let newer = raw;
        if (outcome === 'stale') { newer = kind === 'corrupt' ? '{neuer-rohbestand' : '[]'; persistenceStorage.setItem('depot_tranchen', newer); }
        if (outcome === 'profile-change') persistenceStorage.setItem('rs_current_profile', 'inzwischen-anders');
        await respondPageDialog(doc, outcome === 'cancel' ? 'escape' : 'accept'); await pending;
        await waitFor(() => !getPageNavigationGuard(doc).reasons().some(reason => ['preparing', 'commit'].includes(reason.phase)), 'Entscheidung und etwaiger Write abgeschlossen');
        assertEqual(persistenceStorage.getItem('depot_tranchen'), outcome === 'accept' ? '[]' : newer, 'Nur aktuelle Zustimmung ändert den ursprünglich erfragten Bestand');
    }

    // Echter Seitenkoordinator mit statischen Planfeldern und produktivem Backendwriter.
    {
        const doc = createTranchenPageDom(), backend = createLocalStorageMock();
        installGlobals(doc, backend); PersistenceFacade.resetPersistenceForTests();
        const registry = createCashRegistry([]);
        const id = 'page-cash-profile', other = 'plan-outside';
        registry.profiles[other] = { meta: { id: other, name: 'Außen', belongsToHousehold: false }, data: {} };
        const household = planScope('household', [id]), single = planScope('single', [other]);
        const raw = buildPlanRecord(null, [{ scope: household, values: structuredClone(PLAN_DEFAULTS) },
            { scope: single, values: { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 9000 } }]).raw;
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
        persistenceStorage.setItem('rs_current_profile', id); persistenceStorage.setItem('rs_active_profile', id);
        persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, raw); await PersistenceFacade.flush();
        const source = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
        for (const name of ['managerHouseholdPlan', 'managerPlanScope', 'managerPlanStatus', 'managerPlanRetry', 'managerPlanResume', 'managerPlanComparison', 'managerPlanCape', 'managerPlanCapeOrigin', 'managerPlanInflation', 'haushalt-plan']) doc.register(new MockElement(name));
        const fields = [...source.matchAll(/<(?:(?:input)|(?:select))[^>]*id="(managerPlan_[^"]+)"[^>]*data-manager-plan-field="([^"]+)"[^>]*>/g)].map(match => {
            const field = doc.register(new MockElement(match[1], 'input')); field.dataset.managerPlanField = match[2];
            field.type = /type="checkbox"/.test(match[0]) ? 'checkbox' : 'text';
            field.closest = selector => selector === '[data-manager-plan-field]' ? field : null; return field;
        });
        doc.getElementById('managerHouseholdPlan').querySelectorAll = () => fields;
        initTranchenManagerPage({ profileId: id });
        const floor = doc.getElementById('managerPlan_floorBedarf'), host = doc.getElementById('managerHouseholdPlan');
        floor.value = '13500'; host.dispatchEvent({ type: 'input', target: floor });
        initTranchenManagerPage({ profileId: id });
        assertEqual(floor.value, '13500', 'Manager-Neuzeichnen erhält Pending-Planfeld');
        assertEqual(host.listeners.input.length, 1, 'Erneutes Init bindet Planfelder genau einmal');
        assertEqual(await openManagerOverviewTarget({ hash: '#haushalt-plan', search: '' }, { ready: true }), true, 'Direktlink öffnet statischen Planabschnitt');
        assertEqual(doc.activeElement.id, 'haushalt-plan', 'Direktlink fokussiert Überschrift');
        assertEqual(await switchManagerProfile(other), true, 'Profilwechsel schließt Planautosave vorher dauerhaft ab');
        const committed = JSON.parse((await PersistenceFacade.readPersistedRecords())[HOUSEHOLD_PLAN_KEY]);
        assertEqual(committed.entries[household.key].values.floorBedarf, 13500, 'Echter Wechsel persistiert ursprünglichen Haushaltsplan');
        assertEqual(floor.value, '9.000 €', 'Nach Wechsel zeigt das statische Feld den Außenplan');
        assertEqual(readHouseholdPlanField(floor, 'floorBedarf'), 9000, 'Nach Wechsel bleibt der projizierte Außenplanwert kanonisch 9000');
        floor.value = ''; host.dispatchEvent({ type: 'input', target: floor });
        assertEqual(await flushManagerHouseholdPlan(), false, 'Leerer Zahlenentwurf wird an realer Seitengrenze nicht gespeichert');
        floor.value = '9500'; host.dispatchEvent({ type: 'input', target: floor });
        assertEqual(await flushManagerHouseholdPlan(), true, 'Korrigierter Außenplan lässt sich bestätigen');
        assertEqual(JSON.parse((await PersistenceFacade.readPersistedRecords())[HOUSEHOLD_PLAN_KEY]).entries[single.key].values.floorBedarf, 9500, 'Manager schreibt ausschließlich Einzelplan');
    }

    // Presetbedienung mit echten DOM-Ereignissen und dem produktiven Backendwriter.
    async function presetFixture(values) {
        const { doc } = createDialogFixture(), backend = createLocalStorageMock();
        installGlobals(doc, backend); PersistenceFacade.resetPersistenceForTests();
        const id = 'page-cash-profile', scope = planScope('household', [id]);
        persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(createCashRegistry([])));
        persistenceStorage.setItem('rs_current_profile', id); persistenceStorage.setItem('rs_active_profile', id);
        persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, [{ scope, values }]).raw);
        await PersistenceFacade.flush();
        const host = doc.createElement('section'); host.id = 'managerHouseholdPlan'; doc.body.append(host);
        for (const name of ['managerPlanStatus', 'managerPlanRetry', 'managerPlanResume']) {
            const node = doc.createElement(name.endsWith('Status') ? 'p' : 'button'); node.id = name; host.append(node);
        }
        const presets = doc.createElement('div'); presets.dataset.planDynamicPresetsHost = ''; host.append(presets);
        const details = doc.createElement('div'); details.dataset.planDynamicDetails = ''; host.append(details);
        const source = fs.readFileSync(new NodeURL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
        const detailSource = source.slice(source.indexOf('<div data-plan-dynamic-details'), source.indexOf('data-manager-plan-field="longevityBufferYears"'));
        for (const [markup, tag, fieldId, path] of source.matchAll(/<(input|select)[^>]*id="(managerPlan_[^"]+)"[^>]*data-manager-plan-field="([^"]+)"[^>]*>/g)) {
            const row = doc.createElement('div'); row.className = 'pv-plan-field household-plan-field';
            const field = doc.createElement(tag); field.id = fieldId; field.dataset.managerPlanField = path;
            field.type = markup.includes('type="checkbox"') ? 'checkbox' : 'text';
            row.append(field); (detailSource.includes('id="' + fieldId + '"') ? details : host).append(row);
        }
        let active = id, locked = false, fail = false, gate = null, writes = [], timer = null;
        const persistence = {
            hasSyncWriteBlocks: () => locked || PersistenceFacade.hasSyncWriteBlocks(),
            async replaceRecordsTransactional(records, options) {
                writes.push(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values);
                if (gate) await gate;
                if (fail) throw new Error('Synthetischer Speicherfehler');
                return PersistenceFacade.replaceRecordsTransactional(records, options);
            }
        };
        const start = () => createManagerHouseholdPlan({ doc, getProfileId: () => active, storage: persistenceStorage, persistence,
            runOperation: fn => fn({ check() {}, commit() {} }),
            schedule: (fn, delay) => { assertEqual(delay, 300, 'Produktiver Autosave verwendet normalen Debounce'); timer = fn; return fn; }, unschedule: handle => { if (timer === handle) timer = null; } });
        let controller = start();
        const click = async key => {
            const button = presets.querySelector('[data-plan-dynamic-preset="' + key + '"]'), previous = doc.activeElement;
            if (previous?.tag === 'input') { await previous.fire('change'); await previous.fire('blur'); }
            button.focus(); await button.fire('focus'); await button.fire('click');
        };
        const read = async () => JSON.parse((await PersistenceFacade.readPersistedRecords())[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values;
        return { doc, details, presets, click, read, writes, get controller() { return controller; },
            reload() { controller.dispose(); controller = start(); },
            setFail(value) { fail = value; }, setGate(value) { gate = value; }, setLocked(value) { locked = value; controller.syncBlocked(); },
            setActive(value) { active = value; }, tick() { const fn = timer; timer = null; fn?.(); } };
    }
    {
        const original = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'), goGoMultiplier: 1.2 };
        const fixture = await presetFixture(original);
        const field = fixture.doc.getElementById('managerPlan_goGoMultiplier');
        const open = label => {
            assert(!fixture.details.hidden && !field.disabled, label + ': Faktor bleibt bedienbar');
            assertEqual(fixture.presets.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), 'true', label + ': Custom gedrückt');
            assert(fixture.doc.querySelector('[data-plan-dynamic-hint]').hidden, label + ': Hinweis verborgen');
        };
        open('Aktiver individueller Ausgangsplan ohne Customklick');
        field.focus();
        for (const text of ['1,1', '1,15']) {
            field.value = text; await field.fire('input');
            open(text);
            assert(fixture.doc.activeElement === field, text + ': Faktor behält Fokus');
            assertEqual(field.value, text, text + ': Eingabetext unverändert');
            assertEqual(fixture.controller.refresh(), false, 'Refresh mit offenen Eingaben abgewiesen');
            fixture.controller.syncBlocked(); open('Abgewiesenes Refresh und Status');
            assertEqual(fixture.writes.length, 0, 'Vor Debounce kein Write');
            assertEqual(JSON.stringify(await fixture.read()), JSON.stringify(original), 'Vor Debounce bestätigter Plan unverändert');
        }
        fixture.tick(); assertEqual(await fixture.controller.flush(), true, 'Normaler Debounce bestätigt letzten Eingabewert');
        assertEqual(fixture.writes.length, 1, 'Genau ein vollständiger Write');
        assertEqual(JSON.stringify(fixture.writes[0]), JSON.stringify({ ...original, goGoMultiplier: 1.15 }), 'Write enthält vollständigen Plan mit 1,15');
        assertEqual((await fixture.read()).goGoMultiplier, 1.15, 'Backend bestätigt 1,15');
        open('Autosavebenachrichtigung');
        // Rücknahme auf individuelle bestätigte Basis öffnet erneut Custom.
        field.value = '1,1'; await field.fire('input');
        assert(fixture.controller.discard(), 'Rücknahme möglich'); open('Individuelle Basis nach Verwerfen');
        // Gewolltes Schließen muss auch ohne vorherigen Browserklick den Fokus verlagern.
        field.focus(); await fixture.click('ausgewogen');
        assert(fixture.details.hidden && !fixture.doc.querySelector('[data-plan-dynamic-hint]').hidden, 'Ausdrückliche Presetwahl schließt Details');
        assert(!fixture.details.contains(fixture.doc.activeElement), 'Kein Fokus in verborgenen Details');
        fixture.tick(); await fixture.controller.flush();
        const revision = fixture.controller.read().revision, count = fixture.writes.length;
        await fixture.click('custom'); open('Ausdrückliche Customöffnung bei passenden Werten');
        assertEqual(fixture.controller.read().revision, revision, 'Anzeigeöffnung erzeugt keine Revision');
        await fixture.controller.flush(); assertEqual(fixture.writes.length, count, 'Anzeigeöffnung schreibt nicht');
        assert(fixture.controller.discard() && fixture.details.hidden, 'Verwerfen auf passende Basis schließt');
        await fixture.click('custom'); fixture.reload();
        assert(fixture.details.hidden, 'Neue Managerbindung erkennt passende Basis');
        // Auch ein bestätigter Zwischenwert und Refresh erhalten die lokale Auswahl bis zur Neubindung.
        await fixture.click('custom'); field.value = '1,2'; await field.fire('input'); await fixture.controller.flush();
        field.value = '1,1'; await field.fire('input'); fixture.tick(); await fixture.controller.flush();
        open('Bestätigter Zwischenwert 1,1');
        assertEqual((await fixture.read()).goGoMultiplier, 1.1, 'Zwischenwert bestätigt');
        assert(fixture.controller.refresh(), 'Erfolgreiches Refresh derselben Sitzung'); open('Refresh derselben Sitzung erhält Customabsicht');
        await fixture.click('custom'); fixture.reload();
        assert(fixture.details.hidden, 'Neubindung nach Zwischenwert erkennt Ausgewogen');
        fixture.controller.dispose();
    }
    for (const matching of [false, true, 'active']) {
        const original = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'),
            dynamicFlex: matching === 'active', goGoMultiplier: matching === 'active' ? 1.2 : matching ? 1.1 : 1.17 };
        const fixture = await presetFixture(original);
        const before = JSON.stringify(await PersistenceFacade.readPersistedRecords());
        for (const [path, value, message] of [['minimumFlexAnnual', '999999', 'Mindest-Flex'],
            ['minimumFlexAnnual', 'unlesbar', 'lesbare Zahl'], ['goGoMultiplier', 'unlesbar', 'lesbare Zahl']]) {
            if (path === 'goGoMultiplier') await fixture.click('custom');
            const field = fixture.doc.getElementById('managerPlan_' + path);
            field.focus(); await field.fire('focus'); field.value = value; await field.fire('input');
            for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv', 'custom']) {
                await fixture.click(key); fixture.tick();
                assertEqual(await fixture.controller.flush(), false, key + ': ungültiger Batch sperrt auch expliziten Flush');
                assertEqual(field.value, value, matching + '/' + key + ': ungültiger Text nach Fokusverlust exakt erhalten');
                assertEqual(field.getAttribute('aria-invalid'), 'true', key + ': ungültiges Feld markiert');
                const error = field.parent.querySelector('.household-plan-error');
                assert(!error.hidden && error.textContent.includes(message), key + ': sichtbare Feldmeldung');
                assertEqual(fixture.writes.length, 0, key + ': keine Backendtransaktion nach Timer und Flush');
                assertEqual(JSON.stringify(await PersistenceFacade.readPersistedRecords()), before, key + ': gesamter Backendbestand bytegleich');
            }
            assert(fixture.controller.discard(), 'Ungültigen Entwurf ausdrücklich verwerfen');
        }
        await fixture.click('ausgewogen'); await fixture.controller.flush();
        const count = fixture.writes.length, revision = fixture.controller.read().revision;
        await fixture.click('custom');
        const custom = () => {
            assert(!fixture.details.hidden && fixture.doc.querySelector('[data-plan-dynamic-hint]').hidden, 'Custom zeigt Details ohne Presethinweis');
            assertEqual(fixture.presets.querySelectorAll('button').filter(button => button.getAttribute('aria-pressed') === 'true').length, 1, 'Ausschließlich Custom markiert');
            assertEqual(fixture.presets.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), 'true', 'Custommarkierung unabhängig von Werterkennung');
        };
        custom();
        assertEqual(fixture.controller.read().revision, revision, 'Aktive Customöffnung ohne Revision');
        fixture.controller.syncBlocked(); fixture.controller.refresh(); custom();
        fixture.tick(); await fixture.controller.flush(); custom();
        assertEqual(fixture.writes.length, count, 'Reine Customöffnung und Rückmeldungen speichern nichts');
        fixture.reload();
        assert(fixture.details.hidden, 'Neubindung erkennt ausgewogene Fachwerte');
        assertEqual(detectDynamicFlexPreset(await fixture.read()), 'ausgewogen', 'Keine persistierte Auswahlkennung');
        // Alle vier vollständigen Wertpatches an derselben produktiven Transaktionsgrenze.
        const preserved = await fixture.read();
        for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
            await fixture.click(key); fixture.tick(); await fixture.controller.flush();
            assertEqual(JSON.stringify(await fixture.read()), JSON.stringify({ ...preserved, ...dynamicFlexPresetPatch(key) }), key + ': vollständiger Patch mit unveränderten übrigen Feldern und CAPE');
            assert(fixture.details.hidden && !fixture.doc.querySelector('[data-plan-dynamic-hint]').hidden, key + ': Details geschlossen und Hinweis sichtbar');
        }
        fixture.controller.dispose();
    }
    for (const matching of [false, true]) {
        const original = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'), dynamicFlex: false,
            goGoMultiplier: matching ? 1.1 : 1.17, longevityQuantileShift: .07 };
        const fixture = await presetFixture(original);
        assertEqual(fixture.presets.querySelectorAll('button').length, 5, 'Manager enthält genau fünf Presetsegmente');
        assert(fixture.details.hidden, 'Aus verbirgt sämtliche Detailfelder');
        const floor = fixture.doc.getElementById('managerPlan_floorBedarf'); floor.value = '13500';
        await fixture.click('custom');
        assertEqual(fixture.controller.read().revision, 1, 'Custom und noch ungemeldeter Text sind eine Revision');
        assert(!fixture.details.hidden, 'Aus → Custom öffnet Details');
        assertEqual((await fixture.read()).dynamicFlex, false, 'Vor Autosave keine isolierte Aktivierung');
        fixture.tick(); assertEqual(await fixture.controller.flush(), true, 'Debounce und Flush bestätigen den vollständigen Batch');
        const committed = await fixture.read();
        assertEqual(JSON.stringify(committed), JSON.stringify({ ...original, dynamicFlex: true, floorBedarf: 13500 }), 'Einschalten erhält alle Details und übernimmt offenen Betrag');
        assertEqual(fixture.writes.length, 1, 'Ein vollständiger Autosave, kein Zwischenstand');
        assertEqual(fixture.presets.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), 'true', 'Öffnungsabsicht bleibt nach Autosave erhalten');
        fixture.reload();
        const recognized = matching ? 'ausgewogen' : 'custom';
        assertEqual(fixture.presets.querySelector('[data-plan-dynamic-preset="' + recognized + '"]').getAttribute('aria-pressed'), 'true', 'Neuladen erkennt erhaltene aktive Werte');
        assertEqual(detectDynamicFlexPreset(await fixture.read()), recognized, 'Neuladen ist niemals Aus');
        const revision = fixture.controller.read().revision, count = fixture.writes.length;
        await fixture.click('custom');
        assert(!fixture.details.hidden && !fixture.controller.read().dirty, 'Bereits aktive Dynamik öffnet nur Details');
        assertEqual(fixture.controller.read().revision, revision, 'Reine Detailöffnung revisioniert nicht');
        await fixture.controller.flush(); assertEqual(fixture.writes.length, count, 'Reine Detailöffnung speichert nicht');
        fixture.controller.dispose();
    }
    {
        const fixture = await presetFixture({ ...structuredClone(PLAN_DEFAULTS), dynamicFlex: false });
        const before = JSON.stringify(await fixture.read());
        fixture.doc.getElementById('managerPlan_minimumFlexAnnual').value = '999999';
        await fixture.click('custom');
        assertEqual(await fixture.controller.flush(), false, 'Ungültiger offener Mindest-Flex verhindert isolierten Einschaltwrite');
        assertEqual(fixture.writes.length, 0, 'Keine Transaktion für ungültigen Batch');
        assertEqual(JSON.stringify(await fixture.read()), before, 'Ungültige Aktivierung erhält bestätigten Plan');
        assertEqual(fixture.doc.getElementById('managerPlan_minimumFlexAnnual').value, '999999', 'Keine stille Begrenzung oder Verwerfung');
        fixture.controller.discard(); assert(fixture.details.hidden, 'Rücknahme erkennt Aus');
        fixture.setFail(true); await fixture.click('custom');
        assertEqual(await fixture.controller.flush(), false, 'Speicherfehler bleibt wiederholbar');
        assertEqual(JSON.stringify(await fixture.read()), before, 'Fehler erhält bestätigten ausgeschalteten Plan');
        fixture.setFail(false); await fixture.doc.getElementById('managerPlanRetry').fire('click');
        assertEqual(await fixture.controller.flush(), true, 'Retry übernimmt vollständige Aktivierung');
        assertEqual((await fixture.read()).dynamicFlex, true, 'Retry persistiert Einschalten');
        fixture.setFail(true); await fixture.click('off'); await fixture.controller.flush();
        fixture.controller.discard();
        assertEqual((await fixture.read()).dynamicFlex, true, 'Rücknahme fehlgeschlagenen Ausschaltens erhält aktiven Plan');
        fixture.setLocked(true); const count = fixture.writes.length;
        await fixture.click('off'); assert(!fixture.controller.read().dirty, 'Globale Sperre verhindert Presetänderung');
        assert(fixture.presets.querySelectorAll('button').every(button => button.disabled), 'Sperre gilt für alle Segmente');
        fixture.setLocked(false); fixture.setActive('anderer-bereich'); await fixture.click('off');
        assertEqual(fixture.writes.length, count, 'Scopewechsel erlaubt keine fremden Presetwrites');
        fixture.controller.dispose();
    }
    {
        const fixture = await presetFixture(structuredClone(PLAN_DEFAULTS));
        let release; fixture.setGate(new Promise(resolve => { release = resolve; }));
        await fixture.click('konservativ'); const pending = fixture.controller.flush();
        await Promise.resolve(); await Promise.resolve();
        await fixture.click('offensiv');
        fixture.setGate(null); release(); assertEqual(await pending, true, 'Presetwechsel während Write wird anschließend vollständig bestätigt');
        assertEqual(fixture.writes.length, 2, 'Zwei gewählte vollständige Presets, keine Teilwrites');
        for (const [index, key] of ['konservativ', 'offensiv'].entries()) {
            for (const [path, value] of Object.entries(dynamicFlexPresetPatch(key))) assertEqual(fixture.writes[index][path], value, 'Write ' + index + ': vollständiges ' + path);
        }
        assertEqual(detectDynamicFlexPreset(await fixture.read()), 'offensiv', 'Letzte Wahl gewinnt nach verzögertem Write');
        fixture.controller.dispose();
    }

    console.log('✅ Tranchen manager page contract validated');
    console.log('--- Tranchen Manager Page Tests Completed ---');
}

if (shouldRun()) {
    try {
        await runTranchenManagerPageTests();
    } finally {
        setAppTestDate(null);
        PersistenceFacade.resetPersistenceForTests();
        Object.entries(previousGlobals).forEach(([key, value]) => {
            if (value === undefined) delete global[key];
            else global[key] = value;
        });
    }
}
