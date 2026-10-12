import { readBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
const formNumber = field => readBoundHouseholdPlanField(field) ?? Number(field.value);
import { getSimulatorPlanTrial, initSimulatorPlanTrial, renderSimulatorPlanTrial, updateSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { initializeHouseholdPlanPage } from '../app/profile/household-plan-dialog.js';
import { migrateHouseholdPlans } from '../app/profile/household-plan-migration.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord, readHouseholdPlan,
    readSimulatorHouseholdPlan, SIMULATOR_PLAN_FIELD_MAP, SIMULATOR_LEGACY_PLAN_FIELDS,
    projectPlanToSimulator, projectSimulatorPlanForm, stageBalancePlanPatch } from '../app/profile/household-plan.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { buildSimulatorEngineInput } from '../app/simulator/simulator-engine-input.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { clearHouseholdSimulatorNeeds, readHouseholdSimulatorNeedsState } from '../app/simulator/simulator-household-needs-persistence.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createSelectionDocument, addField, simulatorSelectOptions } from './designsystem-selection-dom.mjs';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';

const values = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 31001, flexBedarf: 17002,
    minimumFlexAnnual: 3003, flexBudgetAnnual: 4004, flexBudgetYears: 3, flexBudgetRecharge: 1005,
    liquidityRunwayYears: 4, minCashBufferMonths: 7, maxSkimPctOfEq: 11, maxBearRefillPctOfEq: 6,
    dynamicFlex: true, horizonYears: 37, longevityMode: 'buffer_years', longevityBufferYears: 4,
    decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 6, drawdownTrigger: 17, bondRefillThreshold: 2 },
    cape: { value: 23, asOf: '2026-10-09', source: 'Synthetisch' } };
const scope = planScope('household', ['a', 'b', 'c']);
const outside = planScope('single', ['x']);
const raw = buildPlanRecord(null, [{ scope, values }, { scope: outside, values: { ...values, floorBedarf: 9900 } }]).raw;
const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
    profile_rente_aktiv: 'true', profile_rente_monatlich: '1000', profile_tagesgeld: '50000', depot_tranchen: '[]',
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 1, flexBedarf: 2, minimumFlexAnnual: 900 } }) };
const spyData = { ...data };
for (const field of SIMULATOR_LEGACY_PLAN_FIELDS) Object.defineProperty(spyData, `sim_${field}`, {
    enumerable: true, get() { throw new Error('Altplan gelesen: ' + field); }
});
const profileInput = buildSimulatorInputsFromProfileData(spyData, { referenceYear: 2026, planValues: values });
assertEqual(profileInput.startFloorBedarf, 31001, 'Profilgrenze ignoriert alte Bedarfskopien');
const entries = ['a', 'b', 'c'].map(id => ({ profileId: id, inputs: { ...profileInput, startFloorBedarf: 800,
    startFlexBedarf: 2, minimumFlexAnnual: 999, liquidityRunwayYears: 10, maxSkimPctOfEq: 25 } }));
const combined = combineSimulatorProfiles(entries, 'b', { planValues: values }).combined;
for (const [field, expected] of Object.entries({ startFloorBedarf: 31001, startFlexBedarf: 17002,
    minimumFlexAnnual: 3003, flexBudgetAnnual: 4004, flexBudgetYears: 3, flexBudgetRecharge: 1005,
    liquidityRunwayYears: 4, minCashBufferMonths: 7, maxSkimPctOfEq: 11, maxBearRefillPctOfEq: 6,
    dynamicFlex: true, horizonYears: 37, longevityMode: 'buffer_years', longevityBufferYears: 4 })) {
    assertEqual(combined[field], expected, 'Drei Personen verwenden genau einen Plan: ' + field);
}
assertEqual(combined.startVermoegen, 150000, 'Vermögen bleibt aggregiert');
assertEqual(combined.renteMonatlich + combined.partner.monatsrente, 3000, 'Einkommen bleibt aggregiert');
assertEqual(combined.minimumFlexProfiles, undefined, 'Keine erfundene Mindest-Flex-Aufteilung');
assertEqual(combineSimulatorProfiles([{ profileId: 'a', inputs: { ...profileInput, trancheInputState: 'corrupt' } }], 'a', { planValues: values }).errorCode,
    'SIMULATOR_PROFILE_TRANCHES_CORRUPT', 'Beschädigte Tranchen bleiben sichtbar');
assertEqual(combineSimulatorProfiles([{ profileId: 'a', inputs: profileInput }, { profileId: 'b', inputs: { ...profileInput,
    detailledTranches: null, trancheInputState: 'absent', depotwertAlt: 100 } }], 'a', { planValues: values }).errorCode,
    'SIMULATOR_PROFILE_ASSET_PROVENANCE_MISSING', 'Plan unterdrückt keinen Provenienzfehler');

const prior = { document: globalThis.document, window: globalThis.window };
let backend;
// Vorbestätigung: dieselben produktiven Binder wie beim Seitenstart, echte
// Elternknoten und zugängliche Gründe; keine nachträgliche Testfreigabe.
try {
    const legacyData = { ...data, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: {
        floorBedarf: 24000, flexBedarf: 12000, minimumFlexAnnual: 2000
    } }) };
    const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Muster A', belongsToHousehold: true }, data: legacyData }
    } }), rs_current_profile: 'a', rs_active_profile: 'a', ...legacyData,
        sim_dynamicFlexPreset: 'custom', sim_dynamicFlexShowAdvanced: 'false', sim_mcSeed: '0042' };
    PersistenceFacade.resetPersistenceForTests({ name: 'Altformular vor Bestätigung', async init() {},
        async loadAll() { return { ...records }; }, async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value);
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createSelectionDocument(); doc.addEventListener = () => {};
    const createElement = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = createElement(tag); node.append = (...nodes) => nodes.forEach(child => node.appendChild(child)); return node;
    };
    globalThis.document = doc; globalThis.window = {};
    const defaults = projectPlanToSimulator(PLAN_DEFAULTS);
    const selects = new Set(['dynamicFlexPreset', 'entnahmeStrategie', 'horizonMethod', 'longevityMode', 'p1Geschlecht', 'r2Geschlecht']);
    for (const id of [...Object.keys(SIMULATOR_PLAN_FIELD_MAP), 'simProfileList', 'simProfileStatus', 'suiteHouseholdContext',
        'p1StartAlter', 'p1Geschlecht', 'r2StartAlter', 'r2Geschlecht', 'chkPartnerAktiv', 'simStartVermoegen',
        'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'einstandAlt', 'dynamicFlexPreset', 'dynamicFlexShowAdvanced',
        'threeBucketConfigGroup', 'dynamicFlexConfigGroup', 'displayPortfolioBreakdown', 'simPlanTrialStart', 'simPlanTrialBand']) {
        const field = addField(doc, id, defaults[id] ?? '', selects.has(id) ? simulatorSelectOptions(id) : null);
        if (typeof defaults[id] === 'boolean' || ['dynamicFlexShowAdvanced', 'chkPartnerAktiv'].includes(id)) {
            field.type = 'checkbox'; field.checked = defaults[id] === true;
        }
    }
    initInputPersistence(); initDynamicFlexControls();
    const refresh = initSimulatorProfileSelection();
    initSimulatorPlanTrial({ doc });
    const trial = getSimulatorPlanTrial(doc);
    const needsAndPreset = ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'dynamicFlexPreset'];
    const reason = field => (field.getAttribute('aria-describedby') || '').split(/\s+/)
        .map(id => doc.getElementById(id)?.textContent || '').join(' ');
    const assertLegacyEditable = label => {
        for (const id of needsAndPreset) {
            const field = doc.getElementById(id);
            assertEqual(field.disabled, false, `${label}: Altformular bleibt bedienbar: ${id}`);
            assertEqual(field.dataset.planTrialReadonly, 'false', `${label}: keine Planlesesperre: ${id}`);
            assert(!reason(field).includes('aus Haushalt & Plan'), `${label}: keine falsche Planherkunft: ${id}`);
        }
        assert(!trial.read().active && !trial.read().scope && !trial.read().confirmed, `${label}: kein bestätigter Versuchsbereich`);
        assert(doc.getElementById('simPlanTrialStart').disabled && doc.getElementById('simPlanTrialBand').hidden,
            `${label}: kein Versuch ohne Plan`);
        assertEqual(window.__profileRecoveryBlocker, null, `${label}: intakter Profilkontext`);
    };
    assertLegacyEditable('Produktiver Start');
    assert(doc.getElementById('goGoMultiplier').disabled, 'Bestehende Go-Go-Inaktivität bleibt vor Bestätigung gesperrt');
    assert(reason(doc.getElementById('goGoMultiplier')).length > 0, 'Fachlicher Inaktivitätsgrund bleibt zugänglich');
    assert(reason(doc.getElementById('entnahmeStrategie')).includes('Standardstrategie'), 'Strategiegrund wird nicht zur Planherkunft umgeschrieben');

    await PersistenceFacade.flush();
    const failed = await initializeHouseholdPlanPage({ doc, win: window, migrate: options => migrateHouseholdPlans({
        ...options, choose: async () => ({}), archive: { async createSnapshot() { throw new Error('Synthetischer Archivfehler vor Veröffentlichung'); } }
    }) });
    assertEqual(failed.status, 'failed', 'Umstellungsfehler vor Veröffentlichung wird behandelt');
    refresh();
    assertLegacyEditable('Gescheiterte Umstellung');
    assert(doc.getElementById('householdPlanNotice').children[0].textContent.includes('Synthetischer Archivfehler'),
        'Fehlerhinweis bietet die spätere Wiederöffnung an');

    for (const [id, value] of Object.entries({ startFloorBedarf: '26000', startFlexBedarf: '14000', minimumFlexAnnual: '2500' })) {
        const field = doc.getElementById(id); field.value = value;
        field.dispatchEvent({ type: 'input' }); field.dispatchEvent({ type: 'change' });
    }
    const preset = doc.getElementById('dynamicFlexPreset'); preset.value = 'offensiv'; preset.dispatchEvent({ type: 'change' });
    const withoutAutosave = ['liquidityRunwayYears', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq'];
    const oldAutosave = Object.fromEntries(withoutAutosave.map(id => [id, persistenceStorage.getItem('sim_' + id)]));
    for (const id of withoutAutosave) {
        const field = doc.getElementById(id); field.value = '7';
        field.dispatchEvent({ type: 'input' }); field.dispatchEvent({ type: 'change' });
    }
    await PersistenceFacade.flush();
    const input = getCommonInputs(), override = JSON.parse(records.household_simulator_needs_v1);
    for (const [id, expected] of Object.entries({ startFloorBedarf: 26000, startFlexBedarf: 14000, minimumFlexAnnual: 2500 })) {
        assertEqual(Number(override.values[id]), expected, 'Altbedarf erreicht das Backend: ' + id);
        assertEqual(input[id], formNumber(doc.getElementById(id)), 'Altformular und Laufeingabe stimmen überein: ' + id);
    }
    assertEqual(records.sim_dynamicFlexPreset, 'offensiv', 'Preset verwendet weiterhin sim_*');
    for (const [id, expected] of Object.entries({ dynamicFlex: true, horizonYears: 25, horizonMethod: 'mean',
        survivalQuantile: 0.75, goGoActive: true, goGoMultiplier: 1.2, longevityMode: 'none' })) {
        assertEqual(records['sim_' + id], String(expected), 'Dynamik-Altwert erreicht das Backend: ' + id);
        assertEqual(input[id], expected, 'Preset erreicht den bisherigen Reader: ' + id);
    }
    for (const id of withoutAutosave) assertEqual(persistenceStorage.getItem('sim_' + id), oldAutosave[id], 'Kein neuer Autosave: ' + id);
    assertEqual(records[HOUSEHOLD_PLAN_KEY], undefined, 'Altbedienung veröffentlicht keinen gemeinsamen Plan');

    const legacyBytes = JSON.stringify(records);
    const confirmedValues = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 41000, flexBedarf: 22000,
        minimumFlexAnnual: 4000, dynamicFlex: true, horizonYears: 35, survivalQuantile: 0.9,
        goGoActive: false, goGoMultiplier: 1, longevityMode: 'none' };
    const published = buildPlanRecord(null, [{ scope: planScope('household', ['a']), values: confirmedValues }]).raw;
    await PersistenceFacade.replaceRecordsTransactional({ [HOUSEHOLD_PLAN_KEY]: published }, {
        probelaufDomainWrite: true, allowKey: key => key === HOUSEHOLD_PLAN_KEY, expectedRecords: {}
    });
    refresh();
    for (const id of needsAndPreset) {
        const field = doc.getElementById(id);
        assert(field.disabled && field.dataset.planTrialReadonly === 'true', 'Produktiver Refresh bindet lesend: ' + id);
        assert(reason(field).includes('aus Haushalt & Plan'), 'Produktiver Refresh kennzeichnet Planherkunft: ' + id);
    }
    assertEqual(formNumber(doc.getElementById('startFloorBedarf')), 41000, 'Refresh zeigt bestätigten Floor');
    assertEqual(formNumber(doc.getElementById('startFlexBedarf')), 22000, 'Refresh zeigt bestätigten Flex');
    assertEqual(formNumber(doc.getElementById('minimumFlexAnnual')), 4000, 'Refresh zeigt bestätigten Mindest-Flex');
    assertEqual(preset.value, 'konservativ', 'Refresh synchronisiert das bestätigte Preset');
    assertEqual(getCommonInputs().startFloorBedarf, 41000, 'Reader folgt dem nachträglich bestätigten Plan');
    assert(trial.read().confirmed && trial.read().scope && !trial.read().active, 'Bestätigung aktiviert keinen Versuch');
    refresh(); renderSimulatorPlanTrial(doc, { project: true });
    await PersistenceFacade.flush();
    assertEqual(records[HOUSEHOLD_PLAN_KEY], published, 'Refresh und Render erhalten bestätigte Planrohbytes');
    const { [HOUSEHOLD_PLAN_KEY]: ignored, ...retainedLegacy } = records;
    assertEqual(JSON.stringify(retainedLegacy), legacyBytes, 'Refresh und Render erhalten sämtliche Altwerte bytegleich');

    // Baseline erst nach Bestätigung und Flush: dieselben Listener wie beim
    // Altstart, echte Backendrohbytes einschließlich des sim_*-Schlüsselbestands.
    const simBytes = () => JSON.stringify(Object.fromEntries(Object.keys(records)
        .filter(key => key.startsWith('sim_')).sort().map(key => [key, records[key]])));
    const confirmedSimBytes = simBytes(), confirmedBytes = JSON.stringify(records);
    const details = doc.getElementById('dynamicFlexShowAdvanced');
    const assertConfirmedBytes = label => {
        assertEqual(records.sim_dynamicFlexPreset, 'offensiv', label + ': alte Presetrohbytes bleiben erhalten');
        assertEqual(records.sim_dynamicFlexShowAdvanced, 'false', label + ': alte Detailrohbytes bleiben erhalten');
        assertEqual(simBytes(), confirmedSimBytes, label + ': alle sim_*-Schlüssel und Rohwerte bleiben bytegleich');
        assertEqual(JSON.stringify(records), confirmedBytes, label + ': auch Plan-, Bedarfs- und Profilbestand bleiben bytegleich');
    };
    preset.value = 'off'; preset.dispatchEvent({ type: 'change' });
    details.checked = true; details.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    assertConfirmedBytes('Synthetische Ereignisse im Lesemodus');
    assertEqual(preset.value, 'konservativ', 'Lesemodus projiziert das bestätigte Preset zurück');
    assertEqual(getCommonInputs().dynamicFlex, true, 'Lesemodus behält die bestätigte Laufeingabe');
    assert(details.checked && !details.disabled, 'Details sind auch im Lesemodus seitenlokal bedienbar');
    assertEqual(doc.getElementById('dynamicFlexConfigGroup').style.display, 'grid', 'Detaildarstellung wird lokal eingeblendet');
    assert(trial.read().confirmed && !trial.read().active, 'Darstellungsereignisse öffnen keinen Versuch');

    assert(trial.start(), 'Ausdrücklicher Versuchsstart nach Bestätigung im selben Dokument');
    renderSimulatorPlanTrial(doc, { project: true });
    preset.value = 'ausgewogen'; preset.dispatchEvent({ type: 'change' });
    const trialInput = getCommonInputs();
    for (const [id, expected] of Object.entries({ dynamicFlex: true, horizonYears: 30,
        horizonMethod: 'survival_quantile', survivalQuantile: 0.85, goGoActive: true, goGoMultiplier: 1.1 })) {
        const field = doc.getElementById(id);
        assertEqual(field.type === 'checkbox' ? field.checked : String(readBoundHouseholdPlanField(field) ?? field.value),
            typeof expected === 'boolean' ? expected : String(expected), 'Versuchspreset wirkt im Formular: ' + id);
        assertEqual(trialInput[id], expected, 'Versuchspreset erreicht getCommonInputs: ' + id);
    }
    assertEqual(preset.value, 'ausgewogen', 'Lokales Versuchspreset bleibt ausgewählt');
    details.checked = false; details.dispatchEvent({ type: 'change' });
    assert(!details.checked && !details.disabled, 'Detaildarstellung bleibt im Versuch lokal bedienbar');
    assertEqual(doc.getElementById('dynamicFlexConfigGroup').style.display, 'none', 'Detaildarstellung wird lokal ausgeblendet');
    assert(trial.read().active && trial.read().differences.length > 0, 'Preset erzeugt eine lokale Planabweichung');
    await PersistenceFacade.flush();
    assertConfirmedBytes('Aktive Versuchsbedienung');

    persistenceStorage.removeItem(HOUSEHOLD_PLAN_KEY);
    renderSimulatorPlanTrial(doc);
    await PersistenceFacade.flush();
    const lostBytes = JSON.stringify(records);
    assert(trial.read().confirmed && !trial.read().scope && !trial.start(), 'Verlorener Plan bleibt hinter der Bestätigungsgrenze');
    for (const id of needsAndPreset) assert(doc.getElementById(id).disabled, 'Planverlust gibt das Altformular nicht frei: ' + id);
    doc.getElementById('startFloorBedarf').value = '27000';
    doc.getElementById('startFloorBedarf').dispatchEvent({ type: 'change' });
    doc.getElementById('dynamicFlex').checked = false;
    doc.getElementById('dynamicFlex').dispatchEvent({ type: 'change' });
    preset.value = 'off'; preset.dispatchEvent({ type: 'change' });
    details.checked = true; details.dispatchEvent({ type: 'change' });
    let lostPlanRejected = false;
    try { getCommonInputs(); } catch (error) { lostPlanRejected = error.message.includes('nicht mehr verfügbar'); }
    assert(lostPlanRejected, 'Verlorener bestätigter Plan sperrt Rechnen mit Altwerten');
    await PersistenceFacade.flush();
    assertEqual(JSON.stringify(records), lostBytes, 'Planverlust erlaubt keine Bedarfs- oder Dynamik-Fallbackwrites');

    const registry = JSON.parse(persistenceStorage.getItem('rs_profiles_v1'));
    registry.profiles.b = { meta: { id: 'b', name: 'Muster B', belongsToHousehold: true }, data: legacyData };
    persistenceStorage.setItem('rs_profiles_v1', JSON.stringify(registry));
    refresh();
    assertLegacyEditable('Echter Scopewechsel nach Planverlust');
    for (const [id, value] of Object.entries({ startFloorBedarf: '28000', startFlexBedarf: '16000', minimumFlexAnnual: '3000' })) {
        const field = doc.getElementById(id); field.value = value; field.dispatchEvent({ type: 'change' });
    }
    preset.value = 'offensiv'; preset.dispatchEvent({ type: 'change' });
    assertEqual(getCommonInputs().startFlexBedarf, 16000, 'Neuer unbestätigter Bereich liest wieder lokale Altformulareingaben');
    assertEqual(getCommonInputs().horizonYears, 25, 'Neuer unbestätigter Bereich bedient das bisherige Preset');
    const nextScope = planScope('household', ['a', 'b']);
    const nextValues = { ...confirmedValues, flexBedarf: 18000 };
    await PersistenceFacade.flush();
    await PersistenceFacade.replaceRecordsTransactional({ [HOUSEHOLD_PLAN_KEY]: buildPlanRecord(null, [{ scope: nextScope, values: nextValues }]).raw }, {
        probelaufDomainWrite: true, allowKey: key => key === HOUSEHOLD_PLAN_KEY, expectedRecords: {}
    });
    refresh();
    assert(trial.read().confirmed && trial.read().scope.key === nextScope.key && !trial.read().active,
        'Bestätigung im neuen Bereich bindet ohne Reload und ohne alten Versuch');
    assertEqual(getCommonInputs().startFlexBedarf, 18000, 'Spätere Bestätigung ersetzt lokale Altformulareingabe durch neuen Plan');
    assert(doc.getElementById('startFlexBedarf').disabled && !doc.getElementById('simPlanTrialStart').disabled,
        'Neuer bestätigter Bereich sperrt Planfelder und erlaubt den ausdrücklichen Versuchsstart');
} finally {
    await PersistenceFacade.flush();
    globalThis.document = prior.document; globalThis.window = prior.window;
    PersistenceFacade.resetPersistenceForTests();
}

try {
    const profiles = Object.fromEntries(['a', 'b', 'c', 'x'].map(id => [id, { meta: { id, name: 'Muster ' + id,
        belongsToHousehold: id !== 'x' }, data: { ...data } }]));
    backend = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: 'a', rs_active_profile: 'a',
        ...data, [HOUSEHOLD_PLAN_KEY]: raw, household_simulator_needs_v1: '{beschädigt',
        sim_dynamicFlex: 'false', sim_horizonYears: '1', sim_maxSkimPctOfEq: '25', sim_mcSeed: '4242' };
    PersistenceFacade.resetPersistenceForTests({ name: 'Planregression', async init() {}, async loadAll() { return { ...backend }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete backend[key]); upserts.forEach(([key, value]) => backend[key] = value); } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const reads = [];
    const spy = { getItem(key) { reads.push(key); if (key === 'household_simulator_needs_v1' || key.startsWith('sim_')) throw new Error('Altquelle gelesen'); return persistenceStorage.getItem(key); } };
    assertEqual(readHouseholdSimulatorNeedsState(spy).values.startFloorBedarf, '31001', 'Bedarfsreader nutzt Plan trotz kaputtem Altdatensatz');
    assert(!reads.includes('household_simulator_needs_v1') && !reads.some(key => key.startsWith('sim_')), 'Read-Spion: keine Altplanquelle');
    assertEqual(readSimulatorHouseholdPlan({ profileId: 'x' }).entry.values.floorBedarf, 9900, 'Außenperson hat eigenen Planbereich');
    assertEqual(buildSimulatorInputsFromProfileData(spyData).startFloorBedarf, 31001, 'Sekundärer Personenreader verwendet Plan ohne Altplanreads');
    assertEqual(combineSimulatorProfiles(entries.slice(0, 2), 'a').combined.minimumFlexAnnual, 3003, 'Zwei Personen verwenden denselben einzelnen Mindest-Flex');
    assertEqual(clearHouseholdSimulatorNeeds().source, 'household_plan_v1', 'Simulatorreset löscht keinen gemeinsamen Plan');
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), raw, 'Resethelper erhält Planrohbytes');
    const fingerprintData = Object.defineProperties({ ...backend }, Object.getOwnPropertyDescriptors(spyData));
    const fp = sourceFingerprint({ registry: { profiles }, activeId: 'a', liveData: fingerprintData, scope, kind: 'backtest' });
    assert(typeof fp === 'string' && fp.length === 64, 'Fingerabdruck ignoriert alte sim-Plan-Getter und kaputte Haushaltskopie');

    const doc = createSelectionDocument();
    doc.addEventListener = () => {};
    globalThis.document = doc; globalThis.window = {};
    const startTrial = () => { const started = getSimulatorPlanTrial(document).start(); renderSimulatorPlanTrial(document, { project: true }); return started; };
    const adoptTrial = async () => { updateSimulatorPlanTrial(document); await getSimulatorPlanTrial(document).adopt(async () => true); startTrial(); };
    const projected = projectPlanToSimulator(values);
    for (const id of [...Object.keys(SIMULATOR_PLAN_FIELD_MAP), 'simProfileList', 'simProfileStatus', 'suiteHouseholdContext',
        'p1StartAlter', 'p1Geschlecht', 'r2StartAlter', 'r2Geschlecht', 'chkPartnerAktiv', 'simStartVermoegen', 'tagesgeld',
        'geldmarktEtf', 'depotwertAlt', 'einstandAlt', 'dynamicFlexPreset', 'dynamicFlexShowAdvanced', 'mcSeed', 'displayPortfolioBreakdown', 'simPlanTrialStart']) {
        const field = addField(doc, id);
        if (typeof projected[id] === 'boolean' || id === 'dynamicFlexShowAdvanced' || id === 'chkPartnerAktiv') field.type = 'checkbox';
    }
    initInputPersistence(); initDynamicFlexControls(); const refresh = initSimulatorProfileSelection();
    assertEqual(window.__profileRecoveryBlocker, null, 'Drei bestätigte Mitglieder initialisieren ohne Altbedarf-Recovery');
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), raw, 'Initialisierung überschreibt keinen Plan und keine Zeitstempel');
    assertEqual(formNumber(doc.getElementById('flexBudgetAnnual')), 4004, 'Budget erscheint einmal im Formular');
    assertEqual(formNumber(doc.getElementById('horizonYears')), 37, 'Planhorizont ersetzt alte Rahmendatenkopie');
    assertEqual(doc.getElementById('mcSeed').value, '4242', 'Simulatorannahmen bleiben separat');
    startTrial();
    doc.getElementById('startFloorBedarf').value = '32000';
    assertEqual(getCommonInputs().startFloorBedarf, 32000, 'Noch ungespeicherte Formularänderung gewinnt beim Lesen');
    assertEqual(getCommonInputs().minCashBufferMonths, 7, 'Unsichtbare Mindest-Liquidität kommt aus dem Plan');
    doc.getElementById('startFloorBedarf').dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    await adoptTrial();
    assertEqual(readHouseholdPlan({ scope }).entry.values.floorBedarf, 32000, 'Bewusst übernommene Formularänderung persistiert im gemeinsamen Plan');
    assertEqual(readHouseholdPlan({ scope: outside }).entry.values.floorBedarf, 9900, 'Haushaltswrite verändert keinen Außenplan');
    doc.getElementById('minimumFlexAnnual').value = '999999';
    const beforeInvalid = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    doc.getElementById('minimumFlexAnnual').dispatchEvent({ type: 'change' });
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeInvalid, 'Ungültiger Mindest-Flex bleibt ungespeichert statt gekappt');
    assertEqual(doc.getElementById('minimumFlexAnnual').dataset.householdNeedPersistenceError, 'true', 'Ungültige Planänderung ist sichtbar');
    doc.getElementById('minimumFlexAnnual').value = '3003';
    const preset = doc.getElementById('dynamicFlexPreset'); preset.value = 'konservativ'; preset.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    await adoptTrial();
    assertEqual(readHouseholdPlan({ scope }).entry.values.horizonYears, 35, 'Preset patcht gemeinsamen Horizont');
    assertEqual(persistenceStorage.getItem('sim_horizonYears'), '1', 'Preset schreibt keine neue alte Plankopie');
    doc.getElementById('startFlexBedarf').value = '18000';
    doc.getElementById('startFlexBedarf').dispatchEvent({ type: 'input' });
    refresh();
    assertEqual(formNumber(doc.getElementById('startFlexBedarf')), 18000, 'Gleiche Scopeprojektion erhält den flüchtigen Versuch');
    doc.getElementById('startFlexBedarf').value = '17002';
    doc.getElementById('startFlexBedarf').dispatchEvent({ type: 'input' });
    const beforeDisplay = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    doc.getElementById('dynamicFlexShowAdvanced').checked = true;
    doc.getElementById('dynamicFlexShowAdvanced').dispatchEvent({ type: 'change' });
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeDisplay, 'Darstellungswechsel erhält Planrohbytes');
    const request = getCommonInputs();
    const { engineInput } = buildSimulatorEngineInput({ inputs: request, portfolio: { liquiditaet: 150000 },
        marketDataCurrentYear: {}, marketDataHist: {}, yearData: { inflation: 0 }, yearIndex: 0, liquiditaet: 150000,
        effectiveBaseFloor: request.startFloorBedarf, baseFlex: request.startFlexBedarf, baseMinimumFlexAnnual: request.minimumFlexAnnual,
        temporaryFlexFactor: 1, baseFlexBudgetAnnual: request.flexBudgetAnnual, baseFlexBudgetRecharge: request.flexBudgetRecharge,
        pensionAnnual: 36000, resolvedCapeRatio: request.capeRatio });
    for (const [field, expected] of Object.entries({ minCashBufferMonths: 7, liquidityRunwayYears: 4, floorBedarf: 32000,
        flexBedarf: 17002, minimumFlexAnnual: 3003, flexBudgetAnnual: 4004, flexBudgetYears: 3, flexBudgetRecharge: 1005,
        maxSkimPctOfEq: 11, maxBearRefillPctOfEq: 6, horizonYears: 35, horizonMethod: 'survival_quantile', survivalQuantile: 0.9,
        goGoActive: false, goGoMultiplier: 1, longevityBufferYears: 2, householdWithdrawalMode: 'tax_optimized',
        capeRatio: 23, marketCapeRatio: 23 })) {
        assertEqual(engineInput[field], expected, 'Unveränderte Engine erhält wirksamen Plan: ' + field);
    }
    assertEqual(engineInput.decumulation.mode, '3_bucket_jilge', 'Drei-Töpfe-Strategie erreicht Enginegrenze');
    assertEqual(engineInput.dynamicFlex, true, 'Dynamikentscheidung erreicht Enginegrenze');
    assertEqual(engineInput.longevityMode, 'none', 'Preset-Langlebigkeit erreicht Enginegrenze');
    doc.getElementById('entnahmeStrategie').value = 'standard';
    doc.getElementById('entnahmeStrategie').dispatchEvent({ type: 'change' });
    assertEqual(getCommonInputs().decumulation.mode, 'standard', 'Standardstrategie wird über denselben Planweg gelesen');
    doc.getElementById('entnahmeStrategie').value = '3_bucket_jilge';
    doc.getElementById('entnahmeStrategie').dispatchEvent({ type: 'change' });
    assertEqual(backend.sim_mcSeed, '4242', 'Planwrite bewahrt gültige Simulatorannahme');
    getSimulatorPlanTrial(document).reset();
    initInputPersistence();
    assertEqual(formNumber(doc.getElementById('startFloorBedarf')), 32000, 'Reloadleser zeigt bestätigten gemeinsamen Bedarf');
    assertEqual(readHouseholdPlan({ scope }).entry.values.floorBedarf, 32000, 'Reloadreader erhält Plan');
    doc.getElementById('startFloorBedarf').value = '1';
    const beforeRefresh = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    refresh();
    assertEqual(formNumber(doc.getElementById('startFloorBedarf')), 32000, 'Nachträgliche Planbestätigung aktualisiert bestehende Formularbinder');
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeRefresh, 'Erneute Profilprojektion schreibt keinen Plan');
    const invalid = { ...values, minimumFlexAnnual: 99000 };
    let rejected = false; try { projectSimulatorPlanForm(invalid, { getElementById() { return null; } }); } catch { rejected = true; }
    assert(rejected, 'Lesegrenze validiert Mindest-Flex ohne Begrenzung');

    stageBalancePlanPatch({ scope, patch: { flexBedarf: 30000, minimumFlexAnnual: 7500 } });
    const coupledDoc = createSelectionDocument();
    addField(coupledDoc, 'displayPortfolioBreakdown');
    addField(coupledDoc, 'p1StartAlter', '68');
    const coupledValues = projectPlanToSimulator(readHouseholdPlan({ scope }).entry.values);
    for (const [id, value] of Object.entries(coupledValues)) {
        const field = addField(coupledDoc, id, value);
        if (typeof value === 'boolean') { field.type = 'checkbox'; field.checked = value; }
        field.setCustomValidity = message => { field.validationMessage = message; };
    }
    globalThis.document = coupledDoc;
    initInputPersistence();
    startTrial();
    const flexField = coupledDoc.getElementById('startFlexBedarf');
    const minimumField = coupledDoc.getElementById('minimumFlexAnnual');
    const beforeCoupled = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    flexField.value = '5000'; flexField.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeCoupled, 'Abgewiesene Flexsenkung verändert keinen Plan');
    assertEqual(backend[HOUSEHOLD_PLAN_KEY], beforeCoupled, 'Abgewiesene Flexsenkung erreicht auch nach Flush nicht das Backend');
    for (const field of [flexField, minimumField]) {
        assertEqual(field.dataset.householdNeedPersistenceError, 'true', 'Relationsfehler markiert beide gekoppelten Felder: ' + field.id);
        assert(field.validationMessage.includes('Mindest-Flex'), 'Relationsfehler ist aktuell sichtbar: ' + field.id);
    }
    let coupledRejected = false; try { getCommonInputs(); } catch (error) { coupledRejected = error.message.includes('Mindest-Flex'); }
    assert(coupledRejected, 'Ungültige gekoppelte Formularwerte sperren die Laufeingabe');
    minimumField.value = '4000'; minimumField.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    await adoptTrial();
    const savedCoupled = JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values;
    assertEqual(savedCoupled.flexBedarf, 5000, 'Flex-Änderung überlebt die Nachbarkorrektur dauerhaft');
    assertEqual(savedCoupled.minimumFlexAnnual, 4000, 'Nachbarkorrektur persistiert zusammen mit der Flex-Änderung');
    for (const field of [flexField, minimumField]) {
        assertEqual(field.dataset.householdNeedPersistenceError, 'false', 'Nachbarkorrektur aktualisiert beide Fehlerzustände: ' + field.id);
        assertEqual(field.validationMessage, '', 'Nachbarkorrektur löscht veraltete Feldfehler: ' + field.id);
    }
    assertEqual(getCommonInputs().startFlexBedarf, savedCoupled.flexBedarf, 'Lauf und bestätigtes Backend verwenden denselben Flex');
    assertEqual(getCommonInputs().minimumFlexAnnual, savedCoupled.minimumFlexAnnual, 'Lauf und bestätigtes Backend verwenden denselben Mindest-Flex');
    minimumField.value = '';
    flexField.value = '6000'; flexField.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    minimumField.value = '4000';
    await adoptTrial();
    assertEqual(readHouseholdPlan({ scope }).entry.values.flexBedarf, 6000, 'Leerer Nachbar blockiert keine gültige Einzeländerung');
    assertEqual(readHouseholdPlan({ scope }).entry.values.minimumFlexAnnual, 4000, 'Leerer Nachbar überschreibt keinen bestätigten Planwert');
    flexField.value = '123'; minimumField.value = '456';
    getSimulatorPlanTrial(document).reset();
    initInputPersistence();
    assertEqual(formNumber(flexField), 6000, 'Reloadleser erhält gemeinsam gespeicherten Flex');
    assertEqual(formNumber(minimumField), 4000, 'Reloadleser erhält gemeinsam gespeicherten Mindest-Flex');

    // Eigene Formularinstanz und bestätigte Fixture: keine zusätzlichen Listener
    // und keine veränderten CAPE-Orakel für die vorherige Enginegrenzprüfung.
    persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, raw);
    await PersistenceFacade.flush();
    const capeDoc = createSelectionDocument();
    addField(capeDoc, 'displayPortfolioBreakdown');
    addField(capeDoc, 'p1StartAlter', '68');
    for (const [id, value] of Object.entries(projectPlanToSimulator(values))) {
        const field = addField(capeDoc, id, value);
        if (typeof value === 'boolean') { field.type = 'checkbox'; field.checked = value; }
        field.setCustomValidity = message => { field.validationMessage = message; };
    }
    globalThis.document = capeDoc;
    const assertCapeAtStorageBoundary = (expected, label) => {
        const planCape = readHouseholdPlan({ scope }).entry.values.cape;
        const backendCape = JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values.cape;
        for (const [field, value] of Object.entries(expected)) {
            assertEqual(planCape[field], value, `${label}: Plan cape.${field}`);
            assertEqual(backendCape[field], value, `${label}: Backend cape.${field}`);
        }
    };
    initInputPersistence();
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), raw, 'CAPE-Initialisierung erhält Planrohbytes');
    assertEqual(backend[HOUSEHOLD_PLAN_KEY], raw, 'CAPE-Initialisierung schreibt keine Herkunft ins Backend');
    assertEqual(getCommonInputs().capeRatio, 23, 'Reiner Formularleser liefert bestätigten CAPE');
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), raw, 'getCommonInputs erhält CAPE-Herkunft und Planrohbytes');
    assertEqual(backend[HOUSEHOLD_PLAN_KEY], raw, 'getCommonInputs verändert auch nach Flush kein Backend');
    startTrial();
    const capeFloor = capeDoc.getElementById('startFloorBedarf');
    capeFloor.value = '32000'; capeFloor.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    await adoptTrial();
    assertEqual(readHouseholdPlan({ scope }).entry.values.floorBedarf, 32000, 'Getrennter Nicht-CAPE-Write bestätigt Floor');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values.floorBedarf, 32000, 'Getrennter Floor-Write erreicht Backend');
    assertCapeAtStorageBoundary(values.cape, 'Nicht-CAPE-Write erhält Herkunft');

    const capeField = capeDoc.getElementById('marketCapeRatio');
    capeField.value = '31';
    const beforeCapeRead = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    assertEqual(getCommonInputs().capeRatio, 31, 'Ungespeicherter CAPE erreicht reinen Formularleser');
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeCapeRead, 'Lesen eines CAPE-Entwurfs bereinigt keine Herkunft');
    assertEqual(backend[HOUSEHOLD_PLAN_KEY], beforeCapeRead, 'CAPE-Entwurfslesen bleibt auch im Backend schreibfrei');
    capeField.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    await adoptTrial();
    assertCapeAtStorageBoundary({ value: 31, asOf: null, source: null }, 'Bewusst übernommenes CAPE-change setzt Herkunft zurück');
    assertEqual(capeField.dataset.householdNeedPersistenceError, 'false', 'Gültiges CAPE-change meldet Erfolg');

    // input muss vorhandene Herkunft selbst löschen, nicht nur null erhalten.
    stageBalancePlanPatch({ scope, patch: { cape: values.cape } });
    await PersistenceFacade.flush();
    assertCapeAtStorageBoundary(values.cape, 'Neue bestätigte Herkunft vor input');
    getSimulatorPlanTrial(document).reset(); startTrial(); renderSimulatorPlanTrial(document, { project: true });
    capeField.value = '32'; capeField.dispatchEvent({ type: 'input' });
    await PersistenceFacade.flush();
    await adoptTrial();
    assertCapeAtStorageBoundary({ value: 32, asOf: null, source: null }, 'Bewusst übernommenes CAPE-input setzt Herkunft zurück');

    stageBalancePlanPatch({ scope, patch: { cape: values.cape } });
    await PersistenceFacade.flush();
    getSimulatorPlanTrial(document).reset(); startTrial(); renderSimulatorPlanTrial(document, { project: true });
    const beforeInvalidCape = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    for (const eventType of ['input', 'change']) {
        capeField.value = '-1'; capeField.dispatchEvent({ type: eventType });
        await PersistenceFacade.flush();
        assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeInvalidCape, `Ungültiges CAPE-${eventType} erhält bestätigten Planrohrecord`);
        assertEqual(backend[HOUSEHOLD_PLAN_KEY], beforeInvalidCape, `Ungültiges CAPE-${eventType} erreicht auch nach Flush kein Backend`);
        assertEqual(capeField.dataset.householdNeedPersistenceError, 'true', `Ungültiges CAPE-${eventType} zeigt Feldfehler`);
        assert(capeField.validationMessage.length > 0, `Ungültiges CAPE-${eventType} besitzt Fehlermeldung`);
        assertCapeAtStorageBoundary(values.cape, `Ungültiges CAPE-${eventType} erhält Herkunft`);
    }
    capeField.value = '31'; capeField.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    assertEqual(capeField.dataset.householdNeedPersistenceError, 'false', 'CAPE-Korrektur löscht Fehlerstatus');
    assertEqual(capeField.validationMessage, '', 'CAPE-Korrektur löscht Fehlermeldung');
    await adoptTrial();
    assertCapeAtStorageBoundary({ value: 31, asOf: null, source: null }, 'CAPE-Korrektur bestätigt manuellen Wert');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[outside.key].values.cape.source, 'Synthetisch', 'Manuelle Haushalts-CAPE-Eingabe erhält Herkunft im Außenplan');
    globalThis.document = doc;
    persistenceStorage.removeItem(HOUSEHOLD_PLAN_KEY);
    const legacySkim = persistenceStorage.getItem('sim_maxSkimPctOfEq');
    initInputPersistence();
    doc.getElementById('maxSkimPctOfEq').value = '7';
    doc.getElementById('maxSkimPctOfEq').dispatchEvent({ type: 'change' });
    assertEqual(persistenceStorage.getItem('sim_maxSkimPctOfEq'), legacySkim, 'Vor Umstellung erzeugt der neue Strategiebinder keine zusätzlichen Altkopien');
} finally {
    await PersistenceFacade.flush();
    globalThis.document = prior.document; globalThis.window = prior.window;
    PersistenceFacade.resetPersistenceForTests();
}

// Tatsächliche Profilprojektion nach bereits gebundenem, bestätigtem Plan.
for (const [expectedPreset, dynamicValues] of [
    ['off', { dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: .85, goGoActive: false, goGoMultiplier: 1 }],
    ['offensiv', { dynamicFlex: true, horizonMethod: 'mean', horizonYears: 25, survivalQuantile: .75, goGoActive: true, goGoMultiplier: 1.2 }],
    ['custom', { dynamicFlex: true, horizonMethod: 'mean', horizonYears: 29.25, survivalQuantile: .873456789, goGoActive: true, goGoMultiplier: 1.23456789 }]
]) {
    try {
        const planValues = { ...structuredClone(PLAN_DEFAULTS), ...dynamicValues,
            floorBedarf: 30600.254987, flexBedarf: 22000.123456, minimumFlexAnnual: 3000.123456 };
        const planBytes = buildPlanRecord(null, [{ scope, values: planValues }]).raw;
        const profiles = Object.fromEntries(['a', 'b', 'c'].map(id => [id, {
            meta: { id, name: 'Synthetisch ' + id, belongsToHousehold: true }, data: { ...data }
        }]));
        const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }),
            rs_current_profile: 'a', rs_active_profile: 'a', [HOUSEHOLD_PLAN_KEY]: planBytes,
            annual_plan_record_v1: 'synthetische unveränderte Belegbytes' };
        let writes = 0;
        PersistenceFacade.resetPersistenceForTests({ name: 'Profilprojektion', async init() {}, async loadAll() { return { ...records }; },
            async saveBatch({ upserts, deletes }) { writes++; deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); } });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = createSelectionDocument(); doc.addEventListener = () => {};
        const create = doc.createElement.bind(doc);
        doc.createElement = tag => { const node = create(tag); node.append = (...nodes) => nodes.forEach(child => node.appendChild(child)); return node; };
        globalThis.document = doc; globalThis.window = {};
        const projected = projectPlanToSimulator(planValues);
        const selects = new Set(['dynamicFlexPreset', 'horizonMethod', 'longevityMode', 'entnahmeStrategie', 'p1Geschlecht', 'r2Geschlecht']);
        for (const id of [...Object.keys(SIMULATOR_PLAN_FIELD_MAP), 'dynamicFlexPreset', 'dynamicFlexShowAdvanced',
            'dynamicFlexConfigGroup', 'dynamicFlexAdvancedToggleRow', 'threeBucketConfigGroup', 'simPlanTrialStart', 'simPlanTrialBand',
            'simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'p1StartAlter', 'r2StartAlter', 'p1Geschlecht', 'r2Geschlecht',
            'chkPartnerAktiv', 'simStartVermoegen', 'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'einstandAlt', 'displayPortfolioBreakdown']) {
            const field = addField(doc, id, projected[id] ?? '', selects.has(id) ? simulatorSelectOptions(id) : null);
            if (typeof projected[id] === 'boolean' || ['dynamicFlexShowAdvanced', 'chkPartnerAktiv'].includes(id)) {
                field.type = 'checkbox'; field.checked = projected[id] === true;
            }
        }
        initInputPersistence(); initDynamicFlexControls();
        const refresh = initSimulatorProfileSelection(); initSimulatorPlanTrial({ doc });
        for (const profileId of ['b', 'c', 'a']) {
            persistenceStorage.setItem('rs_current_profile', profileId); persistenceStorage.setItem('rs_active_profile', profileId);
            await PersistenceFacade.flush(); const count = writes;
            for (const showAdvanced of [false, true]) {
                const details = doc.getElementById('dynamicFlexShowAdvanced'); details.checked = showAdvanced;
                details.dispatchEvent({ type: 'change' });
                refresh();
                assertEqual(doc.getElementById('dynamicFlexPreset').value, expectedPreset, profileId + ': bestätigtes Preset nach Profilwechsel');
                const expectedDetails = expectedPreset === 'off' ? false : showAdvanced;
                assertEqual(details.checked, expectedDetails, profileId + ': Detailzustand nach Profilwechsel');
                assertEqual(doc.getElementById('dynamicFlexConfigGroup').style.display,
                    expectedDetails || expectedPreset === 'custom' ? 'grid' : 'none', profileId + ': Detailansicht folgt bestätigtem Preset');
                const input = getCommonInputs();
                for (const [id, expected] of Object.entries(projected)) {
                    if (typeof expected === 'number' && Object.hasOwn(input, id)) assertEqual(input[id], expected, profileId + ': kanonische Recheneingabe ' + id);
                }
                for (const id of ['startFloorBedarf', 'goGoMultiplier', 'survivalQuantile']) {
                    const field = doc.getElementById(id); field.selectionStart = field.selectionEnd = 0;
                    field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
                    field.dispatchEvent({ type: 'focus' });
                    assertEqual(field.selectionStart, 0, id + ': Fokus markiert ab Anfang');
                    assertEqual(field.selectionEnd, field.value.length, id + ': Fokus markiert bis Ende');
                    field.dispatchEvent({ type: 'blur' });
                    assertEqual(getCommonInputs()[id], projected[id], id + ': Fokus/Blur erhält kanonische Präzision');
                }
                await PersistenceFacade.flush();
                assertEqual(writes, count, 'Projektion und Lesen erzeugen keine Writes');
                assertEqual(records[HOUSEHOLD_PLAN_KEY], planBytes, 'Profilwechsel erhält Planbytes');
                assertEqual(records.annual_plan_record_v1, 'synthetische unveränderte Belegbytes', 'Profilwechsel erhält Belegbytes');
            }
        }
    } finally {
        await PersistenceFacade.flush(); globalThis.document = prior.document; globalThis.window = prior.window;
        PersistenceFacade.resetPersistenceForTests();
    }
}

// Der echte Mitgliedschaftshandler muss synchron invalidieren und asynchrone
// Fehler sowie abgebaute Dokumente ohne unbehandelte Rejection abschließen.
for (const scenario of ['legacy', 'initialization-error', 'discard-error', 'discard-cancel', 'navigation-busy', 'detached-discard', 'detached-initialization']) {
    try {
        const profiles = Object.fromEntries(['a', 'b', 'c'].map(id => [id, {
            meta: { id, name: 'Muster ' + id, belongsToHousehold: true }, data: { ...data }
        }]));
        const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: 'a', rs_active_profile: 'a',
            ...(scenario === 'legacy' ? {} : { [HOUSEHOLD_PLAN_KEY]: raw }) };
        PersistenceFacade.resetPersistenceForTests({ name: 'Mitgliedschaftsfortsetzung', async init() {}, async loadAll() { return { ...records }; },
            async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); } });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = createSelectionDocument(); doc.addEventListener = () => {};
        for (const id of ['simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'mcButton', 'btButton', 'p1StartAlter',
            'r2StartAlter', 'p1Geschlecht', 'r2Geschlecht', 'chkPartnerAktiv', 'simStartVermoegen', 'displayPortfolioBreakdown',
            'startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'einstandAlt']) addField(doc, id);
        globalThis.document = doc; globalThis.window = {};
        let initializeCalls = 0, release;
        const gate = new Promise(resolve => { release = resolve; });
        initSimulatorProfileSelection({ initializePlanPage: async () => {
            initializeCalls++;
            if (scenario === 'detached-initialization') await gate;
            else throw new Error('synthetischer Planinitialisierungsfehler');
        } });
        const list = doc.getElementById('simProfileList');
        list.querySelectorAll = selector => list.children.flatMap(row => row.children)
            .filter(node => node.type === 'checkbox' && (!selector.includes(':checked') || node.checked));
        const target = list.querySelectorAll('input').find(node => node.value === 'b');
        if (scenario.includes('discard')) {
            const trial = getSimulatorPlanTrial(doc); trial.start(); trial.update({ flexBedarf: 18000 });
            getPageNavigationGuard(doc).prepare = async () => {
                if (scenario === 'discard-error') throw new Error('synthetischer Verwerffehler');
                if (scenario === 'detached-discard') await gate;
                return null;
            };
        }
        const before = persistenceStorage.getItem('rs_profiles_v1');
        const foreignNavigation = scenario === 'navigation-busy' ? getPageNavigationGuard(doc).prepare({ owners: [] }) : null;
        target.checked = false;
        const pending = list.listeners.change[0]({ target });
        if (scenario === 'legacy') {
            assertEqual(JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles.b.meta.belongsToHousehold, false,
                'Ohne Versuch erfolgt der Mitgliedschaftswechsel vor der ersten asynchronen Fortsetzung');
        }
        if (scenario.startsWith('detached')) {
            globalThis.document = undefined; globalThis.window = undefined;
            release();
        }
        await pending;
        if (foreignNavigation) {
            getPageNavigationGuard(doc).end(await foreignNavigation);
            assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, 'Offene fremde Navigation verhindert auch ohne Versuch den Mitgliedschaftswrite');
            assertEqual(target.checked, true, 'Offene fremde Navigation stellt die Mitgliedschaftscheckbox zurück');
        }
        if (scenario.includes('discard')) {
            assertEqual(persistenceStorage.getItem('rs_profiles_v1'), before, scenario + ': keine Mitgliedschaftsmutation vor Verwerffreigabe');
            assertEqual(initializeCalls, 0, scenario + ': keine Planinitialisierung');
            assert(getSimulatorPlanTrial(doc).read().active, scenario + ': Versuch bleibt erhalten');
        }
        if (scenario === 'discard-cancel') assertEqual(target.checked, true, 'Abbruch stellt die Mitgliedschaftscheckbox zurück');
        if (scenario.endsWith('error')) {
            assert(doc.getElementById('simProfileStatus').textContent.includes('synthetischer'), scenario + ': Fehler wird sichtbar gemeldet');
            assert(doc.getElementById('mcButton').disabled && doc.getElementById('btButton').disabled, scenario + ': fehlerhafte Auswahl sperrt Rechnen');
        }
        if (scenario.startsWith('detached')) {
            assertEqual(globalThis.document, undefined, scenario + ': Fortsetzung verwendet keinen fremden Dokumentkontext');
            assert(!doc.getElementById('simProfileStatus').textContent.includes('Recovery'), scenario + ': kein nachträglicher Recoveryfehler');
        }
    } finally {
        await PersistenceFacade.flush();
        globalThis.document = prior.document; globalThis.window = prior.window;
        PersistenceFacade.resetPersistenceForTests();
    }
}
