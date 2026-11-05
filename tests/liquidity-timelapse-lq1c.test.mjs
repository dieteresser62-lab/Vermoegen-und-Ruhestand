import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { createTimeLapse } from '../app/shared/probelauf-timelapse.js';
import { createTimeLapseServices } from '../app/overview/overview-timelapse.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';

const restoreRealClock = installRealClock('2026-11-03');
const oldDate = getAppTestDate(), restoreLocks = installAnnualLocks();
const selection = { start: '2026-11-02', end: '2027-11-02' };
const balances = () => Object.values(JSON.parse(storage.getItem('rs_profiles_v1')).profiles).map(profile => ({
    name: profile.meta.name, cash: Number(profile.data.profile_tagesgeld) }));
try {
    for (const householdId of [null, 'renate', 'jan-lena', 'helga-werner', 'sophie', 'martin-petra']) {
        const label = householdId || 'max-erika';
        const fixture = await playFixture('tauri', createMusterHaushaltRecords(selection.start));
        let controller = await fixture.boot();
        await controller.start(() => ({ source: householdId ? 'demo' : 'copy', ...(householdId ? { householdId } : {}), testDate: selection.start }));
        controller = await fixture.boot();
        const real = fixture.realBytes();
        assertEqual(readBalanceHouseholdPlan().entry.values.liquidityCashMonths, 12, `${label}: ausgelieferte Vorgabe zwölf Monate`);
        const boot = () => createTimeLapse({ controller, session: areaSessionStorage(fixture.session),
            services: createTimeLapseServices({ controller, win: fixture.win }), yieldStep: async () => {} });
        let runner = boot(); runner.start(selection);
        for (let step = 0; step < 16; step++) {
            await runner.run();
            assert(balances().every(person => Number.isFinite(person.cash) && person.cash >= 0), `${label}: kein negatives Tagesgeld nach Schritt ${step + 1}`);
            assertEqual(fixture.realBytes(), real, `${label}: echte Rohbytes bleiben erhalten`);
            if (runner.state.status !== 'running') break;
            controller = await fixture.boot(); runner = boot(); runner.restore();
        }
        assertEqual(runner.state.status, 'done', `${label}: kein Abbruch bei Ein Jahr durchspielen: ${runner.state.message}`);
        assertEqual(controller.state.testDate, selection.end, `${label}: erreicht den 02.11.2027`);
        const plan = readBalanceHouseholdPlan().entry.values;
        const minimum = (plan.floorBedarf + plan.flexBedarf) / 12 * plan.minCashBufferMonths;
        assert(balances().reduce((sum, person) => sum + person.cash, 0) >= minimum, `${label}: Haushalt am Jahresende mindestens auf eiserner Reserve ${minimum}`);
        console.log('LQ-1c Jahresende', JSON.stringify({ household: label, people: balances(), aborted: false, minimum }));
        P.resetPersistenceRuntimeForTests();
    }
} finally { restoreLocks(); P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate); }
restoreRealClock();
