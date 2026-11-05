import { previousLiquidityInput } from './lq-1b-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../../engine/index.mjs';
import { balanceStorageFixture, recordStorage, STORAGE_FIXTURE_KINDS } from './balance-storage-fixtures.mjs';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { setAppTestDate } from '../../app/shared/app-clock.js';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function balanceMeasurement() {
    setAppTestDate('2026-10-21');
    return STORAGE_FIXTURE_KINDS.flatMap(kind => ['standard', '3_bucket_jilge'].map(strategy => {
        const { records, scope } = balanceStorageFixture(kind, strategy);
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) profile.data.profile_tagesgeld = '200000';
        records.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(records, registry.profiles[records.rs_current_profile].data);
        const calc = buildBalanceEngineInputFromStorage({ storage: recordStorage(records), scope, referenceYear: 2026 });
        const result = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
        if (result.error) throw result.error;
        return { kind, strategy, input: hash(previousLiquidityInput(calc.inputData)), result: hash(previousLiquidityInput(result)) };
    }));
}
