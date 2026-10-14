import { getBalancePlanTrial } from '../app/balance/balance-plan-trial.js';
import { renderBalanceInflationSource } from '../app/balance/balance-inflation-source.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { stripBalancePlanInputs } from '../app/profile/household-plan.js';
import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate, getAppTestDate, appNow } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { HOUSEHOLD_PLAN_KEY, PLAN_DEFAULTS, PLAN_FIELDS, BALANCE_PLAN_INPUT_KEYS, planScope,
    buildPlanRecord, readBalanceHouseholdPlan, stageBalancePlanPatch, projectPlanToBalance } from '../app/profile/household-plan.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { evaluateBalanceFileInputs, exportBalanceFile, importBalanceFile } from '../app/balance/balance-file-service.js';
import { normalizeBalanceImportDocument } from '../app/balance/balance-binder-imports.js';
import { createBalanceCommitBaseFingerprint, assertBalanceCandidateFresh, prepareEngineLastState,
    projectBalancePlanHistory, persistBalanceUpdate } from '../app/balance/balance-update-pipeline.js';
import { StorageManager, initStorageManager } from '../app/balance/balance-storage.js';
import { initializeHouseholdPlanPage } from '../app/profile/household-plan-dialog.js';
import { migrateHouseholdPlans } from '../app/profile/household-plan-migration.js';
import { documentDouble } from './helpers/page-dialog-dom.mjs';
import { buildBalanceOverviewSummary } from '../app/overview/overview-model.js';
import { createMarketdataHandlers } from '../app/balance/balance-annual-marketdata.js';
import { assertAnnualPlanRecord, annualPlanEntryKey } from '../app/profile/annual-plan-record.js';
import * as pipeline from '../app/balance/balance-update-pipeline.js';
import { createProfileSyncHandlers } from '../app/balance/balance-main-profile-sync.js';
import { readBalancePersonStatus, showPersonDataStatus } from '../app/shared/person-data-status.js';
import { PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { postprocessBalanceAction } from '../app/balance/balance-action-postprocessor.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { functionSource, createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { initDynamicFlexControls, refreshDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initThreeBucketControls } from '../app/simulator/simulator-main-3bucket.js';

const oldWindow = globalThis.window, oldDocument = globalThis.document, oldDate = getAppTestDate();
const json = JSON.stringify;
const throws = (job, label) => { let failed = false; try { job(); } catch { failed = true; } assert(failed, label); };
const recordKey = CONFIG.STORAGE.LS_KEY;
const historicalScope = planScope('household', ['muster_a', 'muster_b']);
const historicalOutcome = { monthlyWithdrawal: 1500, monthlyBudget: 3000,
    action: { type: 'NONE', title: 'Kein Handlungsbedarf' }, liquidityBefore: 100, liquidityAfter: 80, marketPhase: 'Bär', flexRate: 70 };
const annualBytes = json({ version: 1, entries: { [annualPlanEntryKey(2026, historicalScope)]: {
    year: 2026, scope: historicalScope, periodId: 'calendar-year:2026', committedAt: '2026-01-02T12:00:00Z',
    recommended: historicalOutcome, adopted: { ...historicalOutcome,
        snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2, ageByPerson: { muster_a: 67, muster_b: 64 } } },
    adjusted: false, adjustedFields: [] } } });
assertAnnualPlanRecord(annualBytes);
const values = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30000, flexBedarf: 30000,
    minimumFlexAnnual: 7500, dynamicFlex: true, cape: { value: 25, asOf: null, source: null } };
function backend(records) {
    const map = new Map(Object.entries(records));
    return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
function form(inputs, planValues) {
    const projection = projectPlanToBalance(planValues);
    const all = { ...inputs, ...projection, aktuellesAlter: 67, renteAktiv: 'ja', renteMonatlich: 0,
        'profilverbund-withdrawal-mode': planValues.householdWithdrawalMode };
    const currency = new Set(['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetRecharge',
        'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'goldWert', 'costBasisAlt', 'costBasisNeu', 'goldCost', 'renteMonatlich']);
    const fields = Object.fromEntries(Object.entries(all).filter(([, value]) => typeof value !== 'object' || value === null)
        .map(([key, value]) => [key, { value: value === null ? '' : String(value), checked: value === true,
            type: typeof value === 'boolean' ? 'checkbox' : 'input', classList: { contains: cls => cls === 'currency' && currency.has(key) } }]));
    const dom = { inputs: fields, controls: {} };
    initUIReader(dom); UIReader.applyStoredInputs(all);
    return dom;
}
async function install(records, planValues = values) {
    P.resetPersistenceForTests(createLocalStorageAdapter(backend(records)));
    await P.init({ installLifecycleHooks: false });
    const state = JSON.parse(storage.getItem(recordKey));
    const dom = form(state.inputs, planValues);
    const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
    return { dom, handlers };
}
function calculate(handlers) {
    const inputData = UIReader.readAllInputs(), profiles = loadProfilverbundProfiles();
    handlers.updateProfilverbundGlobals(profiles, inputData);
    const state = StorageManager.loadState(), plan = readBalanceHouseholdPlan();
    const history = projectBalancePlanHistory(state, profiles, plan);
    const result = evaluateBalanceFileInputs({ inputData, persistentState: history.persistentState,
        profiles: history.profiles, profileId: storage.getItem('rs_current_profile'), profilverbundHandlers: handlers, engineApi: EngineAPI });
    const summary = buildBalanceOverviewSummary({ modelResult: result.modelResult, monthlyBudget: 5000,
        metadata: state.annualPeriodMetadata, scope: plan.scope, now: appNow(), profileActions: window.__profilverbundActionResults });
    return { ...result, inputData, profiles, state, plan, summary };
}
function fixture(planValues, { outsider = false, synthetic = false } = {}) {
    const records = createMusterHaushaltRecords('2026-10-09');
    delete records[HOUSEHOLD_PLAN_KEY];
    const registry = JSON.parse(records.rs_profiles_v1);
    if (outsider) {
        const own = registry.profiles.muster_a;
        own.meta.belongsToHousehold = false;
        registry.profiles = { muster_a: own };
    }
    if (synthetic) {
        registry.profiles.muster_a.data.profile_gold_rebal_band = '18';
        registry.profiles.muster_a.data.profile_rente_monatlich = '1100';
        if (registry.profiles.muster_b) registry.profiles.muster_b.data.profile_gold_rebal_band = '33';
    }
    const projection = projectPlanToBalance(planValues);
    // Historischer Altbestand mit derselben effektiven Planentscheidung.
    for (const person of Object.values(registry.profiles)) {
        const state = JSON.parse(person.data[recordKey]);
        const supported = Object.fromEntries(Object.entries(projection).filter(([key]) => PLAN_FIELDS.includes(key) || ['capeRatio', 'marketCapeRatio'].includes(key)));
        state.inputs = { ...state.inputs, ...supported };
        state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...supported };
        state.lastState.taxState = { lossCarry: 1234 };
        person.data[recordKey] = json(state);
    }
    records.rs_profiles_v1 = json(registry);
    Object.assign(records, registry.profiles.muster_a.data);
    records.annual_plan_record_v1 = annualBytes;
    return records;
}
try {
    // Balance-DOM mit gültigem Plan, echten Fachkontrollen und ohne Versuchs-UI.
    {
        setAppTestDate('2026-10-09');
        globalThis.window = { EngineAPI };
        globalThis.document = { getElementById: () => null };
        const planValues = { ...values, goGoActive: true, longevityMode: 'buffer_years',
            decumulation: { ...values.decumulation, mode: '3_bucket_jilge', bondRefillThreshold: 2 } };
        const records = fixture(planValues), scope = historicalScope, outside = planScope('single', ['outside']);
        records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values: planValues }, { scope: outside, values: PLAN_DEFAULTS }]).raw;
        const { dom } = await install(records, planValues);
        const doc = createSelectionDocument(); globalThis.document = doc;
        const inputs = Object.fromEntries(Object.entries(dom.inputs).map(([id, original]) => {
            const field = addField(doc, id, original.value);
            field.type = original.type; field.checked = original.checked;
            return [id, field];
        }));
        for (const id of ['dynamicFlexPreset', 'dynamicFlexShowAdvanced', 'dynamicFlexConfigGroup', 'threeBucketConfigGroup'])
            inputs[id] = addField(doc, id);
        inputs.dynamicFlexPreset.value = 'custom';
        inputs.dynamicFlexShowAdvanced.type = 'checkbox'; inputs.dynamicFlexShowAdvanced.checked = true;
        initUIReader({ ...dom, inputs }); UIReader.applyHouseholdPlanInputs();
        const protectedBytes = json(Object.fromEntries(Object.entries(P.exportAllSync().records).filter(([key]) => key !== HOUSEHOLD_PLAN_KEY)));
        const outsideBytes = json(JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[outside.key]);
        assert(!doc.getElementById('simPlanTrialStart'), 'Balance-Fixture besitzt keine Simulator-Versuchs-UI');
        initDynamicFlexControls({ enableLocalPersistence: false }); initThreeBucketControls();
        const controls = ['entnahmeStrategie', 'dynamicFlexPreset', 'dynamicFlex', 'minimumFlexAnnual',
            'flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge', 'liquidityRunwayYears', 'marketCapeRatio',
            'maxSkimPctOfEq', 'maxBearRefillPctOfEq', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold',
            'floorBedarf', 'flexBedarf', 'horizonMethod', 'horizonYears', 'survivalQuantile', 'goGoActive', 'goGoMultiplier',
            'longevityMode', 'longevityBufferYears'];
        for (let pass = 1; pass <= 2; pass++) {
            refreshDynamicFlexControls();
            for (const id of controls) {
                assert(!inputs[id].disabled && inputs[id].dataset.planTrialReadonly !== 'true', `Balance-Refresh ${pass}: fachlich anwendbares Feld bleibt editierbar: ${id}`);
                assert(inputs[id].dataset.fieldState !== 'adopted', `Balance-Refresh ${pass}: keine Simulator-Planherkunft: ${id}`);
            }
        }
        assert(inputs.longevityQuantileShift.disabled && inputs.longevityRelativePct.disabled, 'Balance erhält inaktive Langlebigkeitsfelder');
        assertEqual(inputs.longevityQuantileShift.dataset.fieldState, 'inactive', 'Balance erhält den fachlichen Inaktivitätsgrund');
        for (const [id, value] of Object.entries({ floorBedarf: '32000', flexBedarf: '36000', minimumFlexAnnual: '8000',
            flexBudgetAnnual: '9000', flexBudgetYears: '4', flexBudgetRecharge: '6000', liquidityRunwayYears: '4',
            marketCapeRatio: '28', maxSkimPctOfEq: '12', maxBearRefillPctOfEq: '7', bondTargetFactor: '6', drawdownTrigger: '17', bondRefillThreshold: '3' })) {
            inputs[id].value = value; inputs[id].dispatchEvent({ type: 'change' });
        }
        inputs.dynamicFlexPreset.value = 'offensiv'; inputs.dynamicFlexPreset.dispatchEvent({ type: 'change' });
        refreshDynamicFlexControls();
        assertEqual(inputs.horizonMethod.value, 'mean', 'Produktiver Balance-Presetlistener übernimmt die Horizontmethode ohne Rückprojektion');
        assertEqual(Number(inputs.horizonYears.value), 25, 'Produktiver Balance-Presetlistener übernimmt den Horizont');
        assertEqual(Number(inputs.flexBedarf.value), 36000, 'Balance-Presetlistener erhält vorherige Bedarfsänderung');
        assert(!inputs.dynamicFlex.disabled && !inputs.entnahmeStrategie.disabled && !inputs.bondTargetFactor.disabled, 'Balance-Preset erzeugt keine Versuchssperre');
        stageBalancePlanPatch({ scope, patch: UIReader.readHouseholdPlanPatch() });
        await P.flush();
        const saved = readBalanceHouseholdPlan().entry.values;
        for (const [key, expected] of Object.entries({ floorBedarf: 32000, flexBedarf: 36000, minimumFlexAnnual: 8000,
            flexBudgetAnnual: 9000, flexBudgetYears: 4, flexBudgetRecharge: 6000, liquidityRunwayYears: 4,
            maxSkimPctOfEq: 12, maxBearRefillPctOfEq: 7, horizonMethod: 'mean', horizonYears: 25, goGoMultiplier: 1.2 }))
            assertEqual(saved[key], expected, 'Balance-Reader und bestehender Planpatch bestätigen Eingabe: ' + key);
        assertEqual(saved.decumulation.bondTargetFactor, 6, 'Balance bestätigt verschachtelte Strategieeingabe');
        assertEqual(saved.cape.value, 28, 'Balance bestätigt manuelle CAPE-Eingabe');
        assertEqual(json(JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[outside.key]), outsideBytes, 'Balance-Bedienung erhält fremden Scope bytegleich');
        assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, 'Balance-Bedienung erhält Jahresbelegbytes');
        assertEqual(json(Object.fromEntries(Object.entries(P.exportAllSync().records).filter(([key]) => key !== HOUSEHOLD_PLAN_KEY))), protectedBytes,
            'Balance-Bedienung schreibt keine Simulator-Altwerte und erhält alle anderen Speicherbytes nach Flush');
    }
    // Produktiver Seitenstart und echter Wiederöffner; nur fachfremde Anzeige-
    // und Profilstarthelfer werden injiziert. Reader, Koordinator, Dialog,
    // Rechnung, Planpatch und bestätigter Speicher bleiben produktiv.
    for (const start of ['later', 'accept', 'silent', 'engine_failure']) {
        setAppTestDate('2026-10-09');
        const records = fixture(values);
        delete records[HOUSEHOLD_PLAN_KEY];
        if (start === 'silent') delete records.annual_plan_record_v1;
        if (start !== 'silent') {
            const override = JSON.parse(records.household_simulator_needs_v1);
            override.values.startFloorBedarf = '31000';
            records.household_simulator_needs_v1 = json(override);
        }
        const confirmedBackend = backend(records);
        P.resetPersistenceForTests(createLocalStorageAdapter(confirmedBackend));
        await P.init({ installLifecycleHooks: false });
        const env = documentDouble(), doc = env.doc;
        const createElement = doc.createElement.bind(doc);
        const decorate = node => {
            node.ownerDocument = doc;
            node.getAttribute = key => node.attributes[key] ?? null;
            node.hasAttribute = key => Object.hasOwn(node.attributes, key);
            node.removeAttribute = key => { delete node.attributes[key]; };
            node.insertBefore = (child, next) => {
                child.remove(); node.children.splice(next ? node.children.indexOf(next) : node.children.length, 0, child);
                child.parentNode = node; return child;
            };
            return node;
        };
        decorate(doc.body);
        doc.createElement = tag => decorate(createElement(tag));
        doc.getElementById = id => env.nodes.find(node => node.id === id && node.isConnected) || null;
        doc.querySelector = () => null;
        const fieldValues = { ...JSON.parse(records[recordKey]).inputs, ...projectPlanToBalance(values),
            aktuellesAlter: 67, renteAktiv: 'ja', renteMonatlich: 0, 'profilverbund-withdrawal-mode': 'joint' };
        const fields = Object.entries(fieldValues).filter(([, value]) => typeof value !== 'object' || value === null).map(([id, value]) => {
            const node = doc.createElement('input'); node.id = id;
            node.value = value === null ? '' : String(value); node.checked = value === true;
            node.type = typeof value === 'boolean' ? 'checkbox' : 'input';
            node.classList = { contains: () => false };
            doc.body.appendChild(node); return node;
        });
        doc.querySelectorAll = selector => selector === 'input, select' ? fields : [];
        const dom = { inputs: {}, controls: {}, outputs: { printFooter: { dataset: {} } },
            containers: {}, wealthHistory: {}, expensesHistory: {}, expenses: {} };
        const errors = [], calls = [], seen = [];
        const engine = { ...EngineAPI, simulateSingleYear(input, state) {
            seen.push(structuredClone(input));
            return EngineAPI.simulateSingleYear(input, state);
        } };
        globalThis.document = doc;
        globalThis.window = { EngineAPI: engine, location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
        let readerReady = false, planApplies = 0, bindings = 0;
        const reader = new Proxy(UIReader, { get(target, key) {
            if (key === 'applyHouseholdPlanInputs') return () => {
                assert(readerReady, start + ': Planbefüllung erst nach Readerinitialisierung');
                planApplies++; return target.applyHouseholdPlanInputs();
            };
            return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        } });
        const renderer = { clearError() {}, renderContext() {}, renderBedarfAnpassungUI() {}, render() {},
            formatDiagnosisPayload() { return null; }, renderDiagnosis() {}, handleError(error) { errors.push(error); } };
        const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
        handlers.initProfilverbundBalance = () => {};
        const state = {};
        const deps = { getBalancePlanTrial, renderBalanceInflationSource, initBalancePlanTrial() {}, syncDynamicFlexPresetSelection() {}, refreshDynamicFlexControls() {}, ...pipeline, buildBalanceEngineInputFromStorage, stripBalancePlanInputs, persistenceStorage: storage, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' }, evaluateBalanceFileInputs, readBalanceHouseholdPlan, stageBalancePlanPatch,
            dom, UIReader: reader, UIUtils, StorageManager: { ...StorageManager, initSnapshots() {} }, UIRenderer: renderer,
            readBalancePersonStatus, showPersonDataStatus, loadProfilverbundProfiles,
            getCurrentProfileId: () => storage.getItem('rs_current_profile'), appState: state,
            profileSyncHandlers: createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }), profilverbundHandlers: handlers,
            refreshBalanceWealthHistory() {}, refreshBalanceExpensesHistory() {}, postprocessBalanceAction,
            withGuardrailCardValues: value => value, ANNUAL_MARKET_DATA_META_KEY: 'annualMarketDataMeta',
            updateExpensesBudget() {}, overviewScope, buildBalanceOverviewSummary,
            storeOverviewSummary: () => Promise.resolve(true), initPersistence: () => P.init({ installLifecycleHooks: false }),
            initializeProfilePage: async () => true, initializeHouseholdPlanPage, migrateHouseholdPlans,
            openBalanceDataTarget() {}, consumeAnnualRetry: () => null, getPersistenceStatus: () => ({}),
            initVersionHandshake() {
                if (start === 'engine_failure') throw new Error('Synthetischer Engine-Startfehler');
                return state.engineHandshake = pipeline.createEngineHandshake(engine, '');
            }, renderPersistenceStartupWarning() {}, initializeBalanceWealthHistory() {},
            initUIReader(refs) { initUIReader(refs); readerReady = true; }, initStorageManager,
            initUIRenderer() {}, initUIBinder() {}, initExpensesTab() {}, expensesPageStorage: {},
            syncTranchenToInputs() {}, initDynamicFlexControls() {}, UIBinder: { bindUI() { bindings++; } },
            debouncedUpdate() {}, tranchenStorageBound: false, HOUSEHOLD_PLAN_KEY,
            parseOverviewTarget: () => null, PersistenceFacade: P };
        const productiveUpdate = new Function(...Object.keys(deps), functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(...Object.values(deps));
        deps.update = options => {
            const before = storage.getItem(HOUSEHOLD_PLAN_KEY), balanceBefore = storage.getItem(recordKey), registryBefore = storage.getItem('rs_profiles_v1');
            const result = productiveUpdate(options);
            calls.push({ mode: options.mode, result, before, after: storage.getItem(HOUSEHOLD_PLAN_KEY),
                balanceBefore, balanceAfter: storage.getItem(recordKey), registryBefore, registryAfter: storage.getItem('rs_profiles_v1') });
            return result;
        };
        const initSource = 'async ' + functionSource('app/balance/balance-main.js', 'init').split('\n// ==================================================================================')[0];
        const init = new Function(...Object.keys(deps), initSource + '\nreturn init;')(...Object.values(deps));
        const wait = async predicate => {
            for (let i = 0; i < 500; i++) { if (predicate()) return; await Promise.resolve(); }
            throw new Error('Balance-Seitenfixture wurde nicht fertig.');
        };
        const node = key => env.nodes.findLast(item => item.isConnected && item.dataset[key] !== undefined);
        const respond = async action => {
            await wait(() => env.dialog()?.open);
            if (action === 'accept') {
                const floor = env.nodes.findLast(item => item.isConnected && item.dataset.householdPlanField === 'floorBedarf');
                assertEqual(floor.dataset.householdPlanField, 'floorBedarf', 'Synthetischer Konflikt betrifft Floor');
                floor.value = 'simulator'; floor.fire('change'); node('householdPlanAccept').fire('click');
            } else if (action === 'escape') env.dialog().fire('keydown', { key: 'Escape' });
            else node('householdPlanLater').fire('click');
        };
        const starting = init();
        if (start !== 'silent') await respond(start === 'accept' ? 'accept' : 'later');
        const started = await starting;
        if (start === 'engine_failure') {
            assert(!started.ok && !readerReady, 'Enginefehler beendet Start vor Readerinitialisierung');
            node('householdPlanOpen').fire('click'); await respond('accept');
            await wait(() => doc.getElementById('householdPlanNotice').hidden);
            assertEqual(planApplies, 0, 'Fehlgeschlagener Seitenstart aktiviert keinen Erfolgsrefresh');
            assertEqual(calls.length, 0, 'Fehlgeschlagener Start erzeugt auch später keine Vorschau');
            continue;
        }
        assert(started.ok && bindings === 1, start + ': Produktiver init bindet bedienbare Seite mit erfolgreicher Vorschau');
        assertEqual(planApplies, 1, start + ': Erststart verwendet genau die reguläre Planbefüllung');
        if (start !== 'later') {
            assertEqual(UIReader.readAllInputs().floorBedarf, start === 'silent' ? 30000 : 31000, start + ': Erstmigration vor regulärer Befüllung');
            assertEqual(calls.length, 1, start + ': Kein zusätzlicher Migrationsrefresh beim Erststart');
            if (start === 'silent') assertEqual(storage.getItem('annual_plan_record_v1'), null, 'Erstmigration und Vorschau erfinden keinen Jahresbeleg');
        } else {
            assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), null, 'Später lässt den gemeinsamen Plan fehlen');
            assertEqual(UIReader.planFormSource, null, 'Später startet ohne Planformularbaseline');
            assertEqual(UIReader.readAllInputs().floorBedarf, 30000, 'Später erhält bedienbaren Altformularweg');
            await started.overviewPersistence; await P.flush();
            for (const action of ['later', 'escape', 'failure', 'accept']) {
                const applyCount = planApplies, updateCount = calls.length;
                const opener = node('householdPlanOpen');
                opener.fire('click');
                if (action === 'failure') {
                    await wait(() => env.dialog()?.open);
                    // Echter Koordinator weist einen zwischenzeitlichen Quellenwechsel zurück.
                    storage.setItem('sim_horizonYears', '41');
                }
                await respond(action === 'failure' ? 'accept' : action);
                await wait(() => action === 'accept' ? doc.getElementById('householdPlanNotice').hidden
                    : node('householdPlanOpen') !== opener && !env.dialog()?.isConnected
                        && (action !== 'failure' || doc.getElementById('householdPlanNotice').children[0].textContent.includes('nicht bestätigt')));
                if (action !== 'accept') {
                    assertEqual(planApplies, applyCount, action + ': Keine erfolgreiche Formularbefüllung');
                    assertEqual(calls.length, updateCount, action + ': Kein Erfolgsrefresh');
                    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), null, action + ': Kein Teilplan');
                    if (action === 'failure') {
                        if (records.sim_horizonYears == null) storage.removeItem('sim_horizonYears');
                        else storage.setItem('sim_horizonYears', records.sim_horizonYears);
                        await P.flush();
                    }
                } else {
                    assertEqual(planApplies, applyCount + 1, 'Wiederöffnung befüllt das Planformular genau einmal');
                    assertEqual(calls.length, updateCount + 1, 'Wiederöffnung erzeugt genau eine Vorschau');
                }
            }
            const plan = readBalanceHouseholdPlan();
            assertEqual(UIReader.readAllInputs().floorBedarf, 31000, 'Wiederöffnung aktualisiert Floor ohne Reload');
            assertEqual(UIUtils.parseCurrency(dom.inputs.floorBedarf.value), 31000, 'Sichtbares Floorfeld zeigt sofort 31000');
            assertEqual(UIReader.planFormSource.scopeKey, plan.scope.key, 'Wiederöffnung setzt Baseline für bestätigten Bereich');
            assertEqual(plan.entry.values.floorBedarf, 31000, 'Wiederöffnung bestätigt die Simulatorwahl');
            assertEqual(seen.at(-1).floorBedarf, 31000, 'Produktive Vorschau verwendet bestätigten Floor');
            const preview = calls.at(-1);
            assert(preview.result.ok && preview.mode === 'preview', 'Wiederöffnung verwendet erfolgreiche produktive Vorschau');
            assertEqual(preview.before, preview.after, 'Wiederöffnungsvorschau führt keinen weiteren Planpatch aus');
            assertEqual(preview.balanceBefore, preview.balanceAfter, 'Wiederöffnungsvorschau erhält Balance-Rohbytes');
            assertEqual(preview.registryBefore, preview.registryAfter, 'Wiederöffnungsvorschau erhält alle Personen-Rohbytes');
            assert(!preview.result.persistence?.persisted, 'Wiederöffnungsvorschau schreibt keinen Balancezustand');
            await preview.result.overviewPersistence; await P.flush();
            assertEqual(confirmedBackend.getItem('annual_plan_record_v1'), annualBytes, 'Wiederöffnung erhält bestätigte Jahresbelegbytes');
            const trial = getBalancePlanTrial(document); trial.start(); trial.update({ flexBedarf: 35000 });
            await trial.adopt(() => ['flexBedarf']);
            UIReader.applyHouseholdPlanInputs();
            dom.inputs.flexBedarf.value = '35000';
            const written = deps.update({ mode: 'persist_inputs' });
            assert(written.ok && written.persistence.persisted, 'Erste Flex-Änderung nach Übernahme wird produktiv gespeichert');
            await written.overviewPersistence; await P.flush();
            assertEqual(UIReader.readAllInputs().flexBedarf, 35000, 'Erste Flex-Änderung bleibt im Formular erhalten');
            assertEqual(readBalanceHouseholdPlan().entry.values.flexBedarf, 35000, 'Erste Flex-Änderung erreicht bestätigten Plan');
            assertEqual(JSON.parse(confirmedBackend.getItem(HOUSEHOLD_PLAN_KEY)).entries[plan.scope.key].values.flexBedarf, 35000,
                'Erste Flex-Änderung erreicht zurückgelesenes Backend');
            UIReader.applyHouseholdPlanInputs();
            assertEqual(UIReader.readAllInputs().flexBedarf, 35000, 'Erneute Planbefüllung erhält erste Flex-Änderung');
            assertEqual(confirmedBackend.getItem('annual_plan_record_v1'), annualBytes, 'Flexwrite erhält bestätigte Jahresbelegbytes');
        }
        assertEqual(errors.length, 0, start + ': Keine verdeckten Rechen- oder Formularfehler');
        assert(calls.every(call => call.mode === 'preview' || call.mode === 'persist_inputs'), 'Planübernahme erzeugt keinen Jahresabschluss');
    }
    globalThis.document = { getElementById: () => null };
    globalThis.window = { EngineAPI };
    setAppTestDate('2026-10-09');
    globalThis.window = { EngineAPI };
    globalThis.document = { getElementById: () => null };
    for (const kind of ['Muster', 'synthetische Echtform', 'Außenperson']) for (const strategy of ['standard', '3_bucket_jilge']) for (const cape of [0, 25]) {
        const selected = { ...structuredClone(values), cape: { value: cape, asOf: null, source: null },
            decumulation: { mode: strategy, bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null } };
        const records = fixture(selected, { outsider: kind === 'Außenperson', synthetic: kind === 'synthetische Echtform' });
        const { handlers } = await install(records, selected);
        const before = calculate(handlers);
        const scope = before.plan.scope;
        const planRaw = buildPlanRecord(null, [{ scope, values: selected }], { now: appNow }).raw;
        storage.setItem(HOUSEHOLD_PLAN_KEY, planRaw);
        UIReader.applyHouseholdPlanInputs();
        const after = calculate(handlers), label = `${kind}/${strategy}/CAPE ${cape}`;
        assertEqual(json(after.inputData), json(before.inputData), label + ': vollständige Readerbytes gleich');
        assertEqual(json(after.modelResult), json(before.modelResult), label + ': vollständige Enginebytes gleich');
        const computedRuns = runs => runs?.map(({ balanceState, ...computed }) => computed) ?? null;
        assertEqual(json(computedRuns(after.profilverbundRuns)), json(computedRuns(before.profilverbundRuns)), label + ': Attribution und Personenstates gleich');
        assertEqual(json(after.summary), json(before.summary), label + ': Jahreszusammenfassung gleich');
        assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, label + ': Öffnungsvorschau erhält Jahresbelegbytes');
        assertEqual(after.inputData.dynamicFlex, cape > 0, label + ': bestehendes CAPE-Gate bleibt wirksam');
        assertEqual(after.plan.entry.values.dynamicFlex, true, label + ': Checkboxentscheidung bleibt unbeschnitten');
        persistBalanceUpdate({ mode: 'persist_inputs', profilverbundRuns: after.profilverbundRuns, profilverbundHandlers: handlers,
            storageManager: StorageManager, persistentState: after.state, inputData: after.inputData, modelResult: after.modelResult, householdPlan: after.plan });
        const ownStates = Object.values(JSON.parse(storage.getItem('rs_profiles_v1')).profiles).map(p => JSON.parse(p.data[recordKey]));
        if (after.profilverbundRuns) for (const state of ownStates) for (const key of BALANCE_PLAN_INPUT_KEYS) {
            assert(!Object.hasOwn(state.inputs, key), label + ': neuer Mitgliedswrite ohne ' + key);
            assert(!Object.hasOwn(state.profilverbundHouseholdInputs || {}, key), label + ': neuer Haushaltsinputwrite ohne ' + key);
        }
        assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), planRaw, label + ': gleichwertige Eingaben erhalten Planzeitstempel');
        assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, label + ': unterjähriger Write erhält Jahresbelegbytes');
        const fresh = calculate(handlers);
        fresh.state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic-recovery', phase: 'validating' };
        persistBalanceUpdate({ mode: 'commit_period', periodId: 'calendar-year:2026', profilverbundRuns: fresh.profilverbundRuns,
            profilverbundHandlers: handlers, storageManager: StorageManager, persistentState: fresh.state,
            inputData: fresh.inputData, modelResult: fresh.modelResult, householdPlan: fresh.plan });
        assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, label + ': H1-Abschluss erzeugt keinen H3-Beleg');
        if (fresh.profilverbundRuns) for (const person of Object.values(JSON.parse(storage.getItem('rs_profiles_v1')).profiles)) {
            const state = JSON.parse(person.data[recordKey]);
            assert(BALANCE_PLAN_INPUT_KEYS.every(key => !Object.hasOwn(state.inputs, key) && !Object.hasOwn(state.profilverbundHouseholdInputs, key)), label + ': auch Periodenwrite ohne Plankopien');
        }
    }

    // Geöffnete Außenperson A neben zwei angehakten Mitgliedern B/C:
    // Der bestehende Rechenvertrag verwendet B/C, fremde Planänderungen sind gesperrt.
    {
        const records = fixture(values), registry = JSON.parse(records.rs_profiles_v1);
        registry.profiles.muster_a.meta.belongsToHousehold = false;
        registry.profiles.muster_c = structuredClone(registry.profiles.muster_b);
        registry.profiles.muster_c.meta.id = 'muster_c';
        registry.profiles.muster_c.meta.name = 'Synthetisch C';
        registry.profiles.muster_b.data.profile_tagesgeld = '13500';
        records.rs_profiles_v1 = json(registry);
        const scope = planScope('household', ['muster_b', 'muster_c']);
        const ownScope = planScope('single', ['muster_a']);
        records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values },
            { scope: ownScope, values: { ...structuredClone(values), floorBedarf: 1234 } }], { now: appNow }).raw;
        const { dom, handlers } = await install(records);
        const doc = createSelectionDocument();
        doc.createDocumentFragment = () => doc.createElement('div');
        globalThis.document = doc;
        dom.inputs = Object.fromEntries(Object.entries(dom.inputs).map(([key, original]) => {
            const field = addField(doc, key);
            Object.assign(field, { value: original.value, checked: original.checked, type: original.type,
                className: original.classList.contains('currency') ? 'currency' : '' });
            return [key, field];
        }));
        initUIReader(dom); UIReader.applyHouseholdPlanInputs();
        const planBytes = storage.getItem(HOUSEHOLD_PLAN_KEY), seen = [];
        const metadataTime = 1760000000000;
        const engine = { ...EngineAPI, simulateSingleYear(input, state) {
            seen.push(structuredClone(input));
            if (input.depotLastUpdate === metadataTime) assertEqual(JSON.parse(storage.getItem(recordKey)).inputs.depotLastUpdate, metadataTime, 'Metadaten sind vor dem Engine-Aufruf bestätigt');
            return EngineAPI.simulateSingleYear(input, state);
        } };
        window.EngineAPI = engine;
        const errors = [], summaries = [];
        const deps = { getBalancePlanTrial, renderBalanceInflationSource, initBalancePlanTrial() {}, syncDynamicFlexPresetSelection() {}, refreshDynamicFlexControls() {}, ...pipeline, buildBalanceEngineInputFromStorage, stripBalancePlanInputs, persistenceStorage: storage, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' }, evaluateBalanceFileInputs, readBalanceHouseholdPlan, stageBalancePlanPatch,
            dom, UIReader, UIUtils, StorageManager,
            UIRenderer: { clearError() {}, renderContext() {}, renderBedarfAnpassungUI() {}, render() {},
                formatDiagnosisPayload() { return null; }, renderDiagnosis() {}, handleError(error) { errors.push(error); } },
            readBalancePersonStatus, showPersonDataStatus, loadProfilverbundProfiles,
            getCurrentProfileId: () => storage.getItem('rs_current_profile'),
            appState: { engineHandshake: pipeline.createEngineHandshake(engine, ''), pendingInputMetadata: { depotLastUpdate: metadataTime } },
            profileSyncHandlers: createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }), profilverbundHandlers: handlers,
            refreshBalanceWealthHistory() {}, refreshBalanceExpensesHistory() {}, postprocessBalanceAction,
            withGuardrailCardValues: value => value, ANNUAL_MARKET_DATA_META_KEY: 'annualMarketDataMeta',
            updateExpensesBudget() {}, overviewScope, buildBalanceOverviewSummary,
            storeOverviewSummary(summary) { summaries.push(summary); return Promise.resolve(true); } };
        const update = new Function(...Object.keys(deps), functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(...Object.values(deps));
        StorageManager.loadState(); // Technische Bestandsmigration erfolgt vor dem Kandidatenlauf wie beim Seitenstart.
        assertEqual(readBalanceHouseholdPlan().scope.key, scope.key, 'Außenpersonöffnung behält den ausgewählten Haushaltsrechenbereich');
        assertEqual(readBalanceHouseholdPlan({ profileId: 'muster_a' }).scope.key, ownScope.key, 'Ausdrücklicher Personenleser trennt den eigenen Einzelbereich');
        assertEqual(UIReader.readAllInputs().floorBedarf, 30000, 'Reader verwendet Haushaltsbedarf statt Außenpersonenbedarf 1234');
        assertEqual(json(UIReader.readHouseholdPlanPatch()), '{}', 'Personenänderung erzeugt keinen Planpatch');
        const priorLastStates = Object.fromEntries(Object.entries(JSON.parse(storage.getItem('rs_profiles_v1')).profiles)
            .map(([id, profile]) => [id, json(JSON.parse(profile.data[recordKey]).lastState)]));
        const mainLastState = json(StorageManager.loadState().lastState);
        const inputWrite = update({ mode: 'persist_inputs' });
        assert(inputWrite.ok && inputWrite.persistence.persisted, 'Produktiver Main persistiert bei geöffneter Außenperson und leerem Planpatch');
        await inputWrite.overviewPersistence;
        await P.flush();
        const written = JSON.parse(storage.getItem('rs_profiles_v1'));
        for (const [id, profile] of Object.entries(written.profiles)) assertEqual(json(JSON.parse(profile.data[recordKey]).lastState), priorLastStates[id], 'Produktiver Eingabewrite schreibt keinen Profil-LastState fort: ' + id);
        assertEqual(json(StorageManager.loadState().lastState), mainLastState, 'Produktiver Eingabewrite schreibt keinen Haupt-LastState fort');
        assertEqual(JSON.parse(written.profiles.muster_b.data[recordKey]).inputs.tagesgeld, 13500, 'Geänderter personenbezogener Cashwert erreicht die Fachpersistenz');
        assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), planBytes, 'Personenwrite erhält alle Haushalts- und Einzelplanrohbytes');
        assertEqual(seen[0].depotLastUpdate, metadataTime, 'Engine erhält bestätigte Metadaten aus ihrem Speicherbesitzer');
        assertEqual(seen[0].floorBedarf, 30000, 'Produktive Rechnung verwendet denselben Bereich wie der Reader');
        assertEqual(summaries[0].scope.key, scope.key, 'Jahreszusammenfassung bindet den ausgewählten Haushalt B/C');
        assertEqual(storage.getItem('rs_current_profile'), 'muster_a', 'Fachwrite erhält die geöffnete Außenpersonidentität');
        const beforeRejected = json(P.exportAllSync().records), summaryCount = summaries.length;
        dom.inputs.floorBedarf.value = '35000';
        const rejected = update({ mode: 'persist_inputs' });
        assert(rejected.ok, 'Lesende Planprojektion ignoriert eine programmatische Fremdbelegung');
        assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), planBytes, 'Programmatische Fremdbelegung schreibt keinen Planpatch');
        assertEqual(summaries.length, summaryCount + 1, 'Reguläre Planrechnung aktualisiert nur die Planvorschau');
        UIReader.applyHouseholdPlanInputs();
        const periodState = StorageManager.loadState();
        periodState.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic-recovery', phase: 'validating' };
        StorageManager.saveState(periodState);
        const committed = update({ mode: 'commit_period', periodId: 'calendar-year:2026' });
        assert(committed.ok && committed.persistence.persisted, 'Auch produktiver Periodenwrite lässt leeren Außenpersonenpatch passieren');
        await committed.overviewPersistence;
        await P.flush();
        assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), planBytes, 'Periodenwrite erhält gemeinsame und eigene Planbytes');
        assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, 'Außenpersonenperiodenwrite verändert keinen H3-Beleg');

        addField(doc, 'profilverbund-profile-list');
        const errorBox = addField(doc, 'errorDisplay');
        dom.containers = { error: errorBox };
        const bound = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
        UIReader.applyHouseholdPlanInputs();
        bound.initProfilverbundBalance();
        const modeSelect = dom.inputs['profilverbund-withdrawal-mode'];
        const beforeMode = json(P.exportAllSync().records);
        modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
        assertEqual(errorBox.textContent, '', 'Gleiches Modusereignis der Außenperson löst keinen Abbruch aus');
        modeSelect.value = 'proportional';
        modeSelect.dispatchEvent({ type: 'change', target: modeSelect });
        assert(errorBox.textContent.includes('Außenperson'), 'Produktiver Moduslistener weist fremde Entnahmemodusänderung ausdrücklich ab');
        assertEqual(json(P.exportAllSync().records), beforeMode, 'Moduslistener schreibt weder Plan noch alten Moduskey teilweise');

        const outsideOnly = JSON.parse(storage.getItem('rs_profiles_v1'));
        outsideOnly.profiles.muster_b.meta.belongsToHousehold = false;
        outsideOnly.profiles.muster_c.meta.belongsToHousehold = false;
        storage.setItem('rs_profiles_v1', json(outsideOnly));
        UIReader.applyHouseholdPlanInputs();
        assertEqual(UIReader.readAllInputs().floorBedarf, 1234, 'Ohne Auswahl verwendet der Reader den eigenen Außenpersonenplan');
        const ownTrial = getBalancePlanTrial(document); ownTrial.start(); ownTrial.update({ floorBedarf: 2345 });
        await ownTrial.adopt(() => ['floorBedarf']); UIReader.applyHouseholdPlanInputs();
        dom.inputs.floorBedarf.value = '2345';
        const ownWrite = update({ mode: 'persist_inputs' });
        assert(ownWrite.ok, 'Produktiver Main schreibt ohne Mitglieder den eigenen Außenpersonenbereich');
        await ownWrite.overviewPersistence;
        await P.flush();
        const ownChanged = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY));
        assertEqual(ownChanged.entries[ownScope.key].values.floorBedarf, 2345, 'Ausdrücklicher Planpatch erreicht ausschließlich den eigenen Bereich');
        assertEqual(json(ownChanged.entries[scope.key]), json(JSON.parse(planBytes).entries[scope.key]), 'Eigener Außenpersonenwrite erhält den fremden Haushaltsbereich bytegleich');
        globalThis.document = { getElementById: () => null };
        globalThis.window = { EngineAPI };
    }

    const records = fixture(values), { dom, handlers } = await install(records);
    const scope = readBalanceHouseholdPlan().scope, outsideScope = planScope('single', ['outside']);
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, [{ scope, values }, { scope: outsideScope, values: structuredClone(PLAN_DEFAULTS) }], { now: appNow }).raw);
    UIReader.applyHouseholdPlanInputs();
    const initialPlan = storage.getItem(HOUSEHOLD_PLAN_KEY);
    stageBalancePlanPatch({ scope, patch: { floorBedarf: 30000 } });
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), initialPlan, 'Identischer produktiver Patch erhält Rohbytes');
    const memberPlan = readBalanceHouseholdPlan({ profileId: 'muster_b' });
    assertEqual(memberPlan.scope.key, scope.key, 'Beide Mitglieder lesen denselben Haushaltsbereich');
    dom.inputs.minimumFlexAnnual.value = '30001';
    throws(() => UIReader.readAllInputs(), 'Ungültiger Mindest-Flex wird ohne Clamping abgewiesen');
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), initialPlan, 'Invalidität schreibt keinen Plan');
    dom.inputs.minimumFlexAnnual.value = '7500';
    dom.inputs.liquidityRunwayYears.value = '3.1';
    throws(() => UIReader.readAllInputs(), 'Ungültige Reichweite wird nicht still auf Readerdefault beschränkt');
    UIReader.applyHouseholdPlanInputs();
    window.__profileRecoveryBlocker = true;
    throws(() => stageBalancePlanPatch({ scope, patch: { flexBedarf: 35000 } }), 'Recovery sperrt synchronen Formularwrite');
    delete window.__profileRecoveryBlocker;
    dom.inputs.floorBedarf.value = '30.000';
    stageBalancePlanPatch({ scope, patch: UIReader.readHouseholdPlanPatch() });
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), initialPlan, 'Gleichwertige lokalisierte Formulareingabe erhält updatedAt');
    UIReader.applyHouseholdPlanInputs();
    dom.inputs['profilverbund-withdrawal-mode'].value = 'proportional';
    assertEqual(UIReader.readHouseholdPlanPatch().householdWithdrawalMode, 'proportional', 'Entnahmemodus ist ein ausdrücklicher Formularpatch');
    assertEqual(calculate(handlers).profilverbundRuns.distribution.mode, 'proportional', 'Vorschau verwendet den ungespeicherten Entnahmemodus');
    UIReader.applyHouseholdPlanInputs();
    const candidate = calculate(handlers);
    const fingerprint = plan => createBalanceCommitBaseFingerprint({ persistentState: candidate.state, profilverbundProfiles: candidate.profiles,
        householdPlan: { scope: plan.scope, values: plan.entry.values } });
    const baseFingerprint = fingerprint(candidate.plan);
    const stale = structuredClone(candidate.state); stale.inputs.floorBedarf = 999999;
    const staleProfiles = structuredClone(candidate.profiles); staleProfiles[1].balanceState.inputs.floorBedarf = 999999;
    assertEqual(createBalanceCommitBaseFingerprint({ persistentState: stale, profilverbundProfiles: staleProfiles,
        householdPlan: { scope, values } }), baseFingerprint, 'Veraltete Mitgliedsplanwerte verändern Kandidatenfingerabdruck nicht');
    const evidenceState = { ...candidate.state, balanceStateLifecycle: { planInputEvidence: { [scope.key]: { floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500,
        flexBudgetAnnual: 7000, flexBudgetYears: 5, flexBudgetRecharge: 5000 } } } };
    const staleHistory = projectBalancePlanHistory(evidenceState, staleProfiles, candidate.plan);
    const normalHistory = projectBalancePlanHistory(evidenceState, candidate.profiles, candidate.plan);
    assertEqual(json(staleHistory.profiles[1].balanceState.inputs), json(normalHistory.profiles[1].balanceState.inputs), 'Veraltete Mitgliedskopie beeinflusst auch Reseteingabe nicht');
    const historic = { ...candidate.state, lastState: { marker: 'Guardrail', taxState: { lossCarry: 1234 } } };
    const changedValues = { ...values, floorBedarf: 35000 };
    const changedPlan = { ...candidate.plan, entry: { ...candidate.plan.entry, values: changedValues } };
    const migrationHistory = projectBalancePlanHistory(historic, candidate.profiles, changedPlan);
    assertEqual(json(prepareEngineLastState(migrationHistory.persistentState, { ...candidate.inputData, floorBedarf: 35000 })), '{"taxState":{"lossCarry":1234}}', 'Bewusste geänderte Übernahme setzt Guardrail zurück und erhält Verlustvortrag');
    const postHistory = projectBalancePlanHistory({ ...evidenceState, lastState: historic.lastState }, candidate.profiles, changedPlan);
    assertEqual(json(prepareEngineLastState(postHistory.persistentState, { ...candidate.inputData, floorBedarf: 35000 })), '{"taxState":{"lossCarry":1234}}', 'Späterer Simulatorbedarf nutzt exakt bestehenden Resetvertrag');
    stageBalancePlanPatch({ scope, patch: { floorBedarf: 35000 } });
    throws(() => assertBalanceCandidateFresh(baseFingerprint, fingerprint(readBalanceHouseholdPlan())), 'Nach Kandidatenbildung geänderter Plan macht Kandidaten veraltet');
    const householdBytes = json(readBalanceHouseholdPlan().entry);
    stageBalancePlanPatch({ scope: outsideScope, patch: { floorBedarf: 999 } });
    assertEqual(json(readBalanceHouseholdPlan().entry), householdBytes, 'Außenpersonenpatch verändert nur seinen eigenen Bereich');

    UIReader.applyHouseholdPlanInputs();
    storage.setItem('sim_marketCapeRatio', '19');
    const market = createMarketdataHandlers({ dom, appState: {}, debouncedUpdate() {}, applyAnnualInflation() {},
        navigationLifecycle: { run: (_options, callback) => callback({ controller: new AbortController(), check() {}, commit() {} }) } });
    await market.handleFetchCapeAuto({ preparedResult: { capeRatio: 31.27, capeAsOf: '2026-12-31', capeSource: 'synthetic-test', capeFetchStatus: 'ok_synthetic' } });
    const patch = UIReader.readHouseholdPlanPatch();
    assertEqual(json(patch.cape), '{"value":31.3,"asOf":"2026-12-31","source":"synthetic-test"}', 'Bestätigter Jahres-CAPE samt Provenienz folgt bestehender Anzeigepräzision');
    stageBalancePlanPatch({ scope, patch });
    UIReader.applyHouseholdPlanInputs();
    assertEqual(UIReader.readAllInputs().capeRatio, 31.3, 'Reloadprojektion verwendet Jahres-CAPE statt alten Simulator-CAPE');
    assertEqual(storage.getItem('annual_plan_record_v1'), annualBytes, 'CAPE-Weg erhält Jahresbelegbytes');

    const forExport = calculate(handlers);
    persistBalanceUpdate({ mode: 'persist_inputs', profilverbundRuns: forExport.profilverbundRuns, profilverbundHandlers: handlers,
        storageManager: StorageManager, persistentState: forExport.state, inputData: forExport.inputData, modelResult: forExport.modelResult, householdPlan: forExport.plan });
    const exported = exportBalanceFile();
    assertEqual(exported.validationWarnings, undefined, 'Produktiver Export ohne Plankopien erfüllt weiterhin Dateivertrag');
    assertEqual(normalizeBalanceImportDocument(exported).payload.inputs.floorBedarf, 35000, 'Export projiziert bestätigten Bedarf');
    const previousPlan = storage.getItem(HOUSEHOLD_PLAN_KEY), previousState = storage.getItem(recordKey);
    let rolledBack = 0;
    const navigationOperation = { phase: 'prepare', check() {}, commit() { this.phase = 'commit'; } };
    let failed = false;
    try {
        await importBalanceFile(exported, { navigationOperation, applyInputs: inputs => UIReader.applyStoredInputs(inputs),
            update: async mode => {
                if (mode === 'preview') return { ok: true };
                stageBalancePlanPatch({ scope, patch: { floorBedarf: 45000 } });
                storage.setItem(recordKey, '{"inputs":{}}');
                return { ok: false };
            }, replace: async () => ({ recoverySnapshotId: 'synthetic-recovery' }),
            rollback: async () => { rolledBack++; storage.setItem(recordKey, previousState); } });
    } catch (error) { failed = error.code === 'post_replace_validation_failed'; }
    assert(failed && rolledBack === 1, 'Fehlgeschlagene Importabschlussprüfung ruft bestehenden Rollback auf');
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), previousPlan, 'Importrollback erhält gemeinsame Planrohbytes');
    assertEqual(storage.getItem(recordKey), previousState, 'Importrollback erhält Balancebytes');
    storage.setItem(HOUSEHOLD_PLAN_KEY, '{"version":2,"entries":{}}');
    throws(() => UIReader.readAllInputs(), 'Zukünftiger Plan sperrt Rechnung statt Altkopien zu lesen');
    throws(() => exportBalanceFile(), 'Beschädigter Plan wird auch im Export nicht als fehlend behandelt');
    storage.removeItem(HOUSEHOLD_PLAN_KEY);
    UIReader.applyHouseholdPlanInputs();
    dom.inputs.floorBedarf.value = '12345';
    assertEqual(UIReader.readAllInputs().floorBedarf, 12345, 'Ohne Plan nach Später bleibt der bisherige Readerweg aktiv');
} finally {
    initUIReader({ inputs: {}, controls: {} });
    P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate);
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
}

const balanceSource = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
assert(balanceSource.includes('<span id="balanceNeedSource">aus Haushalt &amp; Plan</span>') && balanceSource.includes('>Im Plan ändern</a>'), 'Balance benennt gemeinsame Planwirkung');
assert(balanceSource.indexOf('id="balancePlanSource"') < balanceSource.indexOf('id="floorBedarf"'), 'Hinweis steht vor lesenden Planfeldern');
assertEqual((balanceSource.match(/id="balancePlanSource"/g) || []).length, 1, 'Gemeinsame Balanceherkunft hat genau einen Hinweisanker');
assert(/href="depot-tranchen-manager.html#haushalt-plan" data-profile-handoff data-profile-handoff-export="false"/.test(balanceSource), 'Balance-Link nutzt bewachten vorhandenen Profilhandoff');
