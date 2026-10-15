import { EngineAPI } from '../engine/index.mjs';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { migrateHouseholdPlans } from '../app/profile/household-plan-migration.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { projectBalancePlanHistory, prepareEngineLastState } from '../app/balance/balance-update-pipeline.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { STORAGE_FIXTURE_KINDS, balanceStorageFixture, recordStorage, installBalanceStorageForm } from './helpers/balance-storage-fixtures.mjs';

const oldWindow = globalThis.window, oldDocument = globalThis.document, oldDate = getAppTestDate();
const json = JSON.stringify;
const fail = job => { try { job(); return false; } catch { return true; } };
try {
    setAppTestDate('2026-10-09');
    for (const kind of [...STORAGE_FIXTURE_KINDS, 'zweites geöffnetes Mitglied', 'ein ausgewähltes Fremdmitglied']) for (const strategy of ['standard', '3_bucket_jilge']) for (const cape of [0, 25]) {
        const { records, values, scope } = balanceStorageFixture(kind, strategy, cape);
        const map = new Map(Object.entries(records));
        const backend = { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } };
        P.resetPersistenceForTests(createLocalStorageAdapter(backend)); await P.init({ installLifecycleHooks: false });
        globalThis.document = { getElementById: () => null }; globalThis.window = { EngineAPI };
        if (kind === 'Altbestand') {
            const migrated = await migrateHouseholdPlans({ choices: { [scope.key]: {} } });
            assert(migrated.status === 'migrated' || migrated.status === 'unchanged', `Bestätigte Altmigration (${process.env.ALT || '0'})`);
        }
        const state = StorageManager.loadState();
        // Beide Orakel lesen denselben bestätigten Stand nach der Einmalmigration.
        StorageManager.saveState(state);
        const dom = installBalanceStorageForm(state.inputs, values);
        const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
        const profiles = loadProfilverbundProfiles();
        // Explizite alte Seitenprojektion: globale Overridequelle gehört ausschließlich dem Orakel.
        const { buildProfilverbundAssetSummary } = await import('../app/profile/profilverbund-balance.js');
        if (profiles.length) window.__profilverbundTranchenOverride = buildProfilverbundAssetSummary(profiles).mergedTranches;
        const reader = UIReader.readAllInputs();
        const inputData = structuredClone(reader); handlers.updateProfilverbundGlobals(profiles, inputData);
        const plan = readBalanceHouseholdPlan(), history = projectBalancePlanHistory(state, profiles, plan);
        const calls = [];
        const engineApi = { ...EngineAPI, simulateSingleYear(input, lastState) {
            calls.push(structuredClone({ input, lastState })); return EngineAPI.simulateSingleYear(input, lastState);
        } };
        window.EngineAPI = engineApi;
        const legacy = evaluateBalanceFileInputs({ inputData, persistentState: history.persistentState, profiles: history.profiles,
            profileId: storage.getItem('rs_current_profile'), profilverbundHandlers: handlers, engineApi, planInputs: plan.entry.values });
        const oldCalls = json(calls); calls.length = 0;
        const snapshot = P.exportAllSync().records, bytes = json(snapshot);
        delete globalThis.window; delete globalThis.document;
        const built = buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(snapshot) });
        const label = `${kind}/${strategy}/CAPE=${cape}`;
        assertEqual(json(built.readerInputData), json(reader), label + ': komplette Readerausgabe');
        assertEqual(json(built.inputData), json(inputData), label + ': komplette Haushaltseingaben');
        const fresh = evaluateBalanceFileInputs({ inputData: built.inputData, persistentState: built.history.persistentState,
            profiles: built.profiles, profileId: built.profileId, engineApi, planInputs: built.householdPlan.entry.values,
            profilverbundHandlers: { runProfilverbundProfileSimulations: (...args) => handlers.runProfilverbundProfileSimulations(...args,
                { engineApi, withdrawalMode: built.householdPlan.entry.values.householdWithdrawalMode }) } });
        assertEqual(json(calls), oldCalls, label + ': sämtliche Engineargumente einschließlich LastState und Extras');
        assertEqual(json({ input: built.engineInput, lastState: built.engineLastState }), json(calls[0]), label + ': direkter vollständiger Aufrufvertrag des Speicherlesers');
        assertEqual(json(fresh.modelResult), json(legacy.modelResult), label + ': Ergebnis einschließlich Leitplanken');
        assertEqual(json(snapshot), bytes, label + ': Rohrecords unverändert');
        assertEqual(json(prepareEngineLastState({ ...built.history.persistentState, inputs: { ...built.history.persistentState.inputs, ...built.history.persistentState.personInputEvidence } }, built.inputData, built.householdPlan.entry.values)), json(built.lastState), label + ': isolierter Basis-LastState');
        globalThis.window = { __profilverbundTranchenOverride: [], __profilverbundPersonSPB: 99999 };
        assertEqual(json(buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(snapshot) })), json(built), label + ': Fensteraggregate ohne Einfluss');
        assert(fail(() => buildBalanceEngineInputFromStorage({ scope: { ...scope, key: 'falsch' }, storage: recordStorage(snapshot) })), 'Ungültiger Umfang wird abgewiesen');
        built.inputData.floorBedarf = 1;
        if (built.lastState) built.lastState.marker = 'Mutation';
        assertEqual(json(snapshot), bytes, 'Ausgabemutation erhält Speicherbasis');
    }
    // Quellenprioritäten und Fehlerverträge zusätzlich zur vollständigen Matrix.
    for (const trancheMode of ['nicht geladen', 'explizit leer', 'beschädigt']) {
        const { records, scope } = balanceStorageFixture('Einzelprofil');
        const key = 'ruhestandsmodellValues_v29_guardrails';
        const registry = JSON.parse(records.rs_profiles_v1), own = registry.profiles.muster_a.data;
        if (trancheMode === 'nicht geladen') { delete own.depot_tranchen; delete records.depot_tranchen; }
        else own.depot_tranchen = records.depot_tranchen = trancheMode === 'explizit leer' ? '[]' : '{defekt';
        records.rs_profiles_v1 = json(registry);
        if (trancheMode === 'beschädigt') {
            assert(fail(() => buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) })), 'Beschädigte beteiligte Tranchen werden abgewiesen');
            continue;
        }
        const result = buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) });
        assertEqual(result.inputData.detailledTranches, null, trancheMode + ': bestehender Einzelprofil-Fallback ohne Override');
        assert(result.inputData.depotwertAlt > 0, trancheMode + ': Altwertfallback bleibt erhalten');
        assertEqual(records[key], balanceStorageFixture('Einzelprofil').records[key], 'Tranchenlesen schreibt keine Eingaben');
    }
    {
        const { records, scope } = balanceStorageFixture('aktive Außenperson');
        records.depot_tranchen = '{defekt';
        assert(buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) }).inputData.detailledTranches.length > 0,
            'Nicht beteiligte Außenpersontranchen ersetzen oder sperren den ausgewählten Haushalt nicht');
    }
    {
        const { records, scope } = balanceStorageFixture('Muster-Haushalt');
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) profile.data.depot_tranchen = '[]';
        records.rs_profiles_v1 = json(registry); records.depot_tranchen = '[]';
        const built = buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) });
        assertEqual(json(built.inputData.detailledTranches), '[]', 'Explizit leerer Haushalt bleibt kanonisch leer');
        assertEqual(built.inputData.depotwertAlt + built.inputData.depotwertNeu, 0, 'Leerer Override fällt nicht auf historische Depotwerte zurück');
    }
    {
        const { records, scope } = balanceStorageFixture('Einzelprofil');
        const registry = JSON.parse(records.rs_profiles_v1), own = registry.profiles.muster_a.data;
        own.profile_tagesgeld = '18000.25';
        own.profile_rente_monatlich = '1100.75'; own.profile_rentenbeginn = '2026-07-01';
        own.profile_sonstige_einkuenfte = '123.45'; own.profile_kirchensteuer_pct = '9';
        records.rs_profiles_v1 = json(registry); Object.assign(records, own);
        const built = buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) });
        assertEqual(built.inputData.tagesgeld, 18000.25, 'Profilgeld wird nicht durch Anzeigenrundung ersetzt');
        assertEqual(built.inputData.renteMonatlich, 1100.75 / 2 + 123.45, 'Unterjährige Rentenmonate und sonstiges Einkommen erhalten ihre Bruchteile');
        assertEqual(built.inputData.kirchensteuerSatz, 0.09, 'Persönlicher Steuerwert bleibt maßgeblich');
        assert(fail(() => buildBalanceEngineInputFromStorage({ scope: { kind: 'single', ids: ['fremd'], key: json(['single', ['fremd']]) }, storage: recordStorage(records) })), 'Gültiger, aber fremder Umfang wird nicht still ersetzt');
        const stateKey = 'ruhestandsmodellValues_v29_guardrails', state = JSON.parse(records[stateKey]);
        state.lastState = { marker: 'Guardrail', taxState: { lossCarry: 1234 } };
        state.balanceStateLifecycle = { planInputEvidence: { [scope.key]: { floorBedarf: 29000, flexBedarf: 30000, minimumFlexAnnual: 7500,
            flexBudgetAnnual: 7000, flexBudgetYears: 5, flexBudgetRecharge: 5000 } } };
        records[stateKey] = json(state);
        assertEqual(json(buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) }).lastState), '{"taxState":{"lossCarry":1234}}',
            'Planreset erhält Verlustverrechnung im Speicherweg');
        const stale = JSON.parse(records[stateKey]);
        stale.inputs.minimumFlexAnnual = 'defekt'; stale.balanceInputFields = { minimumFlexAnnual: { value: 'defekt', checked: false } };
        records[stateKey] = json(stale);
        assertEqual(buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) }).inputData.minimumFlexAnnual, 7500,
            'Veraltete Planfeldkopien und Rohfelder verdrängen den bestätigten H1-Plan nicht');
        const plan = JSON.parse(records[HOUSEHOLD_PLAN_KEY]); plan.entries[scope.key].values.minimumFlexAnnual = 30001;
        records[HOUSEHOLD_PLAN_KEY] = json(plan);
        assert(fail(() => buildBalanceEngineInputFromStorage({ scope, storage: recordStorage(records) })), 'Ungültiger gespeicherter Mindest-Flex wird abgewiesen statt begrenzt');
    }

} finally {
    P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate);
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
}
