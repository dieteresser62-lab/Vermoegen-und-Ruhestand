import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { createTimeLapse, timeLapseDates } from '../app/shared/probelauf-timelapse.js';
import { createTimeLapseServices } from '../app/overview/overview-timelapse.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { preparePlayAction, commitPlayAction, preparePlayCredit, pendingPlayActions } from '../app/balance/balance-play-execution.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { normalizeTrancheCollection } from '../types/tranche-contract.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope } from '../app/profile/household-plan.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { resolveTargetTagesgeld } from '../app/balance/balance-play-execution.js';

const restoreRealClock = installRealClock('2026-11-03');
const oldDate = getAppTestDate(), restoreLocks = installAnnualLocks();
const selection = { start: '2026-11-02', end: '2027-11-02' };
const seed = createMusterHaushaltRecords(selection.start);
const scope = planScope('household', Object.keys(JSON.parse(seed.rs_profiles_v1).profiles));
// Bestätigter 60-Monats-Input für A-2; beide Jahreswege laufen mit 12 und 60.
const originalPlan = JSON.parse(seed[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values;
seed[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(seed[HOUSEHOLD_PLAN_KEY], [{ scope, values: { ...originalPlan, liquidityCashMonths: 60 } }]).raw;

// A-2: Der Planwert reist mit dem Input; ein späterer Plan ersetzt keinen bestätigten Input.
const records = structuredClone(seed), read = () => buildBalanceEngineInputFromStorage({ scope, storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
const confirmedInput = structuredClone(read().inputData);
assertEqual(confirmedInput.liquidityCashMonths, 60, 'A-2: gespeicherter Planwert im Balance-Input');
records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(records[HOUSEHOLD_PLAN_KEY], [{ scope, values: { ...originalPlan, liquidityCashMonths: 12 } }]).raw;
assertEqual(read().inputData.liquidityCashMonths, 12, 'A-2: heutiger Planwert separat lesbar');
assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 1000 }, 60000, confirmedInput), 60000, 'A-2: bestätigter Input behält 60 Monate trotz heutigem Plan mit 12');

const balances = () => Object.fromEntries(Object.entries(JSON.parse(storage.getItem('rs_profiles_v1')).profiles).map(([id, profile]) => {
    const lots = normalizeTrancheCollection(JSON.parse(profile.data.depot_tranchen || '[]'), { mode: 'persisted' });
    const assets = {};
    for (const lot of lots) assets[lot.category] = (assets[lot.category] || 0) + lot.marketValue;
    return [id, { cash: Number(profile.data.profile_tagesgeld), assets: Object.fromEntries(Object.entries(assets).sort().map(([key, value]) => [key, Math.round(value * 100) / 100])) }];
}));
try {
    for (const cashMonths of [12, 60]) {
    const yearlySeed = structuredClone(seed);
    yearlySeed[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(seed[HOUSEHOLD_PLAN_KEY], [{ scope, values: { ...originalPlan, liquidityCashMonths: cashMonths } }]).raw;
    const endings = [];
    for (const automatic of [false, true]) {
        const f = await playFixture('indexeddb', yearlySeed);
        let controller = await f.boot();
        await controller.start(() => ({ source: 'copy', testDate: selection.start })); controller = await f.boot();
        const real = f.realBytes();
        if (automatic) {
            const boot = () => createTimeLapse({ controller, session: areaSessionStorage(f.session),
                services: createTimeLapseServices({ controller, win: f.win }), yieldStep: async () => {} });
            let runner = boot(); runner.start(selection);
            for (let i = 0; i < 15; i++) {
                await runner.run();
                if (runner.state.status !== 'running') break;
                controller = await f.boot(); runner = boot(); runner.restore();
            }
            assertEqual(runner.state.status, 'done', 'B-3: Ein Jahr durchspielen vollständig abgeschlossen: ' + runner.state.message);
        } else {
            let periods = 0, bookings = 0;
            for (const date of timeLapseDates({ ...selection, current: selection.start })) {
                if (controller.state.testDate !== date) {
                    await controller.changeDate(date); controller = await f.boot();
                }
                const services = createTimeLapseServices({ controller, win: f.win });
                const period = await services.preparePeriod(); await services.closePeriod(period); periods++;
                if (!period.actions?.length) continue;
                // Dieselbe Spiel-Eintragung und ausdrückliche Gutschrift wie im Handlungsdialog.
                const prepared = await preparePlayAction({ entries: period.actions, controller });
                await commitPlayAction(prepared, { controller }); bookings++;
                if (pendingPlayActions().length) await commitPlayAction(await preparePlayCredit(prepared.batch.id, { controller }), { controller });
            }
            assertEqual(periods, 13, 'B-3: monatlicher Weg umfasst alle 13 Stichtage eines Jahres');
            assert(bookings > 0, 'B-3: Vergleich führt die Jahresanweisung tatsächlich aus');
        }
        assertEqual(pendingPlayActions().length, 0, 'B-3: alle Erlöse gutgeschrieben');
        endings.push(balances());
        assertEqual(f.realBytes(), real, 'B-3: Jahresvergleich erhält echte Daten bytegleich');
        P.resetPersistenceRuntimeForTests();
    }
    assertEqual(JSON.stringify(endings[1]), JSON.stringify(endings[0]), 'B-3: ein Jahr Zeitraffer ergibt je Person dieselben Tagesgeld- und Wertpapierbestände wie Eintragung Monat für Monat');
    }
} finally { restoreLocks(); P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate); }
restoreRealClock();
