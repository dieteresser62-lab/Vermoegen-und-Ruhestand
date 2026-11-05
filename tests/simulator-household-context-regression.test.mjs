import { runBacktest, runBacktestWithRuntimeProvenance, whenBacktestIdle, initializeBacktestUI, exportBacktestLogData } from '../app/simulator/simulator-backtest.js';
import { EngineAPI } from '../engine/index.mjs';
import { createHistoricalBacktestDownload } from '../app/simulator/historical-backtest-export.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initializeResultOverview, enableOverviewRevisions, readOverviewAssumptions, beginOverviewRun, completeOverviewRun } from '../app/simulator/simulator-result-overview.js';
import { simulatorRunAssumptions as heads } from '../app/simulator/simulator-run-assumptions.js';
import { personDataContextFor } from '../app/simulator/simulator-person-overrides.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { HOUSEHOLD_PLAN_KEY, PLAN_DEFAULTS, SIMULATOR_PLAN_FIELD_MAP, planScope, buildPlanRecord } from '../app/profile/household-plan.js';
import { getSimulatorPlanTrial, renderSimulatorPlanTrial, initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';

const previous = { window: globalThis.window, document: globalThis.document };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
try {
    const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '1000', profile_tagesgeld: '100000', depot_tranchen: '[]' };
    const profiles = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { meta: { id, name: 'Muster ' + id, belongsToHousehold: id === 'a' }, data: { ...data } }]));
    let backend = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: 'a', rs_active_profile: 'a' };
    PersistenceFacade.resetPersistenceForTests({ name: 'Haushaltsregression', async init() {}, async loadAll() { return { ...backend }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(k => delete backend[k]); upserts.forEach(([k,v]) => backend[k] = v); } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createSelectionDocument(); const listeners = new Map();
    doc.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
    doc.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
    doc.dispatchEvent = event => { for (const fn of listeners.get(event.type) || []) fn(event); };
    doc.querySelector = selector => doc.body.querySelector(selector);
    for (const id of ['displayPortfolioBreakdown', 'simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'p1StartAlter', 'r2StartAlter', 'p1Geschlecht', 'r2Geschlecht',
        'chkPartnerAktiv', 'simStartVermoegen', 'depotwertAlt', 'einstandAlt', 'btButton', 'mcButton', 'startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'tagesgeld', 'geldmarktEtf', 'simStartJahr', 'simEndJahr']) addField(doc, id);
    doc.getElementById('simStartJahr').value = '2000'; doc.getElementById('simEndJahr').value = '2025';
    // Ohne aktive Ergebniskarte: echter Hauptreiter "Annahmen".
    const tab = doc.body.appendChild(doc.createElement('section')); tab.id = 'tab-ergebnis';
    const overview = doc.body.appendChild(doc.createElement('section')); overview.id = 'overviewBacktest';
    overview.querySelector = () => null;
    globalThis.document = doc; globalThis.window = { addEventListener() {}, removeEventListener() {} };
    let planGate = null, planEntered = false;
    const refreshSelection = initSimulatorProfileSelection({ initializePlanPage: async () => {
        planEntered = true; if (planGate) await planGate; return { status: 'deferred' };
    } });
    assertEqual(window.__profileRecoveryBlocker, null, 'Auswahlstart ohne Recovery: ' + doc.getElementById('simProfileStatus').textContent);
    const initial = readOverviewAssumptions('backtest');
    const result = { outcome: { kind: 'completed' }, request: initial.settings, rows: [], metrics: { values: {} } };
    const first = beginOverviewRun('backtest', initial); completeOverviewRun('backtest', first, result);
    await tick();
    const runs = [];
    let realReplacement = null;
    initializeResultOverview({ activateTab() {}, rerunBacktest: async () => {
        await whenBacktestIdle();
        if (realReplacement) return realReplacement();
        const values = readOverviewAssumptions('backtest');
        runs.push(values);
        const token = beginOverviewRun('backtest', values);
        completeOverviewRun('backtest', token, result);
    } }, doc);
    enableOverviewRevisions();
    const before = PersistenceFacade.getItemSync('rs_profiles_v1');
    const list = doc.getElementById('simProfileList');
    assertEqual(list.textContent, 'Haushalt: Muster a', 'Annahmen zeigen den Haushalt aus Personen & Vermögen');
    assertEqual((list.listeners.change || []).length, 0, 'Simulator besitzt keinen Haushaltscheckboxhandler');
    refreshSelection(); await tick();
    assertEqual(PersistenceFacade.getItemSync('rs_profiles_v1'), before, 'Auch erneute Übernahme schreibt keine Mitgliedschaft');
    assertEqual(personDataContextFor(getCommonInputs()).persons.map(p => p.profileId).join(','), 'a', 'Recheneingaben bleiben an den gespeicherten Haushalt gebunden');

} finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
