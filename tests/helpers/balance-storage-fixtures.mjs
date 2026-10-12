import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { CONFIG } from '../../app/balance/balance-config.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord, projectPlanToBalance } from '../../app/profile/household-plan.js';
import { UIReader, initUIReader } from '../../app/balance/balance-reader.js';

export const STORAGE_FIXTURE_KINDS = ['Muster-Haushalt', 'Einzelprofil', 'Haushalt mit Außenperson',
    'aktive Außenperson', 'synthetische Echtform', 'Altbestand'];
export function recordStorage(records) {
    return { getItem: key => records[key] ?? null };
}
export function balanceStorageFixture(kind, strategy = 'standard', cape = 25) {
    const records = createMusterHaushaltRecords('2026-10-09');
    const registry = JSON.parse(records.rs_profiles_v1);
    const values = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30000, flexBedarf: 30000,
        minimumFlexAnnual: 7500, dynamicFlex: true, cape: { value: cape, asOf: null, source: null } };
    values.decumulation.mode = strategy;
    if (kind === 'Einzelprofil') {
        registry.profiles = { muster_a: registry.profiles.muster_a };
        registry.profiles.muster_a.meta.belongsToHousehold = false;
    }
    if (['Haushalt mit Außenperson', 'aktive Außenperson', 'ein ausgewähltes Fremdmitglied'].includes(kind)) {
        registry.profiles.outside = structuredClone(registry.profiles.muster_a);
        registry.profiles.outside.meta = { ...registry.profiles.outside.meta, id: 'outside', name: 'Synthetische Außenperson', belongsToHousehold: false };
        registry.profiles.outside.data.profile_tagesgeld = '99999';
        if (kind === 'ein ausgewähltes Fremdmitglied') registry.profiles.muster_a.meta.belongsToHousehold = false;
        if (['aktive Außenperson', 'ein ausgewähltes Fremdmitglied'].includes(kind)) records.rs_current_profile = records.rs_active_profile = 'outside';
    }
    if (kind === 'zweites geöffnetes Mitglied') records.rs_current_profile = records.rs_active_profile = 'muster_b';
    if (kind === 'synthetische Echtform') {
        registry.profiles.muster_a.data.profile_gold_rebal_band = '18';
        registry.profiles.muster_a.data.profile_rente_monatlich = '1100';
        registry.profiles.muster_b.data.profile_gold_rebal_band = '33';
    }
    const projection = projectPlanToBalance(values);
    for (const profile of Object.values(registry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        state.inputs = { ...state.inputs, ...projection };
        state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...projection };
        state.lastState.taxState = { lossCarry: 1234 };
        profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    const ids = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
    const scope = ids.length ? planScope('household', ids) : planScope('single', [records.rs_current_profile]);
    delete records[HOUSEHOLD_PLAN_KEY];
    if (kind !== 'Altbestand') records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values },
        ...(registry.profiles.outside ? [{ scope: planScope('single', ['outside']), values: structuredClone(PLAN_DEFAULTS) }] : [])]).raw;
    return { records, values, scope };
}
export function installBalanceStorageForm(inputs, values) {
    const all = { ...inputs, ...projectPlanToBalance(values), 'profilverbund-withdrawal-mode': values.householdWithdrawalMode };
    const currencies = new Set(['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetRecharge',
        'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'goldWert', 'costBasisAlt', 'costBasisNeu', 'goldCost', 'renteMonatlich', 'sparerPauschbetrag']);
    const fields = Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v !== 'object' || v === null)
        .map(([key, value]) => [key, { value: value == null ? '' : String(value), checked: value === true,
            type: typeof value === 'boolean' ? 'checkbox' : 'input', classList: { contains: cls => cls === 'currency' && currencies.has(key) } }]));
    const dom = { inputs: fields, controls: {} };
    initUIReader(dom); UIReader.applyStoredInputs(all); UIReader.applyHouseholdPlanInputs();
    return dom;
}

/** Atomarer, wartender Provider: unabhängige Seiten bekommen getrennte Anschlüsse. */
export function createAtomicLockProvider() {
    const held = new Set(), queues = new Map();
    const request = async (name, options, execute) => {
        if (typeof options === 'function') { execute = options; options = {}; }
        if (held.has(name)) {
            if (options.ifAvailable) return execute(null);
            await new Promise(resolve => {
                const queue = queues.get(name) || []; queue.push(resolve); queues.set(name, queue);
            });
        } else held.add(name);
        try { return await execute({ name, mode: options.mode || 'exclusive' }); }
        finally {
            const next = queues.get(name)?.shift();
            if (next) next(); else held.delete(name);
        }
    };
    return { request, page: () => ({ request }), held };
}
export function installAnnualLocks(provider = createAtomicLockProvider()) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: provider.page() } });
    return () => {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator;
    };
}

export const annualTestNow = () => new Date('2027-01-02T12:00:00Z');
export const annualTestMarketData = {
    inflation: { rate: 2.14, year: 2026, source: 'ECB (HICP)', dataAsOf: '2027-01-01', fetchStatus: 'ok_primary_ecb',
        metric: 'consumer_prices_all_items_annual_average_growth_pct' },
    etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: 2026 },
    cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: annualTestNow().toISOString() }
};
export function readyAnnualFixture(kind = 'Muster-Haushalt', strategy = 'standard', cape = 25) {
    const sample = balanceStorageFixture(kind, strategy, cape), { records, scope, values } = sample;
    if (!records[HOUSEHOLD_PLAN_KEY]) records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope, values }], { now: annualTestNow }).raw;
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(registry.profiles[records.rs_current_profile].data, { [CONFIG.STORAGE.LS_KEY]: records[CONFIG.STORAGE.LS_KEY], balance_expenses_v1: records.balance_expenses_v1 });
    records.rs_profiles_v1 = JSON.stringify(registry);
    return sample;
}

import { PersistenceFacade as annualPersistence, persistenceStorage as annualStorage } from '../../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../../app/shared/snapshot-archive.js';
import { createAnnualCoordinator } from '../../app/shared/annual-coordinator.js';
import { createAnnualOperationLock } from '../../app/shared/annual-operation-lock.js';
import { EngineAPI } from '../../engine/index.mjs';
export async function annualServiceFixture({ sample = readyAnnualFixture(), faults = {}, locks = createAtomicLockProvider() } = {}) {
    const backend = new Map(Object.entries(sample.records)), snapshots = new Map(), batches = [], reports = [];
    const adapter = { name: 'annual-service', async open() {}, async loadAll() {
        const records = Object.fromEntries(backend); return faults.read?.(records) || records;
    }, async saveBatch(batch) {
        await faults.write?.(batch);
        batch.deletes.forEach(key => backend.delete(key)); batch.upserts.forEach(([key, raw]) => backend.set(key, raw));
        batches.push(structuredClone(batch));
    }, async listSnapshots() { return [...snapshots.values()]; }, async readSnapshot(id) {
        const snapshot = structuredClone(snapshots.get(id)); return faults.snapshotRead?.(snapshot) || snapshot;
    }, async writeSnapshot(snapshot) { await faults.snapshotWrite?.(snapshot); snapshots.set(snapshot.id, structuredClone(snapshot)); },
    async deleteSnapshot(id) { snapshots.delete(id); } };
    annualPersistence.resetPersistenceForTests(adapter);
    await annualPersistence.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const options = { storage: annualStorage, persistence: annualPersistence, archive: SnapshotArchive, now: annualTestNow,
        clock: () => annualTestNow().getTime(), snapshotId: 'annual-before',
        engineLoader: { load: async () => EngineAPI }, operationLock: createAnnualOperationLock({ locks: locks.page() }),
        confirmAnnual: async () => ({}), reportError: error => reports.push(error),
        prepareMarketData: async () => ({ ok: true, marketData: structuredClone(annualTestMarketData), results: { ...structuredClone(annualTestMarketData), errors: [] } }) };
    return { backend, snapshots, batches, reports, options, storage: annualStorage, persistence: annualPersistence,
        create: overrides => createAnnualCoordinator({ ...options, ...overrides }) };
}
