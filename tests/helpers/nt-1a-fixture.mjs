// Nur synthetische App-Muster; derselbe Eingabeweg wie im Simulator.
import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../../app/shared/persistence-facade.js';
import { setAppTestDate } from '../../app/shared/app-clock.js';
import { simulatorDocument } from '../simulator-page-fixture.mjs';
import { initInputPersistence } from '../../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../../app/simulator/simulator-main-dynamic-flex.js';
import { initSimulatorProfileSelection } from '../../app/simulator/simulator-main-profiles.js';
import { initSimulatorPlanTrial } from '../../app/simulator/simulator-plan-trial.js';
import { getCommonInputs } from '../../app/simulator/simulator-portfolio.js';
import { prepareHistoricalDataOnce } from '../../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../../engine/index.mjs';

export async function ntInputs(householdId = 'helga-werner', { singleBondOwner = false } = {}) {
    const date = '2026-10-23';
    const records = createMusterHaushaltRecords(date, householdId);
    if (singleBondOwner) {
        const registry = JSON.parse(records.rs_profiles_v1);
        const data = registry.profiles.muster_werner.data;
        data.depot_tranchen = JSON.stringify(JSON.parse(data.depot_tranchen).filter(lot => lot.category !== 'bonds'));
        records.rs_profiles_v1 = JSON.stringify(registry);
    }
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'NT-1a synthetic', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) {
            for (const key of deletes) store.delete(key);
            for (const [key, value] of upserts) store.set(key, value);
        } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate(date);
    globalThis.document = simulatorDocument();
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    initInputPersistence();
    initDynamicFlexControls({ enableLocalPersistence: false });
    initSimulatorProfileSelection();
    initSimulatorPlanTrial();
    if (window.__profileRecoveryBlocker) throw new Error(JSON.stringify(window.__profileRecoveryBlocker));
    prepareHistoricalDataOnce();
    return getCommonInputs();
}
