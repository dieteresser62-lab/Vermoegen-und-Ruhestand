import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { createTimeLapse } from '../app/shared/probelauf-timelapse.js';
import { createTimeLapseServices } from '../app/overview/overview-timelapse.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { preparePlayAction, commitPlayAction, preparePlayCredit, pendingPlayActions } from '../app/balance/balance-play-execution.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

const oldDate = getAppTestDate(), restoreLocks = installAnnualLocks();
// Der Spieltag muss auch am echten 02.11. ein ausdrückliches Testdatum bleiben.
const restoreRealClock = installRealClock('2026-11-03');
const seed = createMusterHaushaltRecords('2026-11-02');
const registry = JSON.parse(seed.rs_profiles_v1);
const ids = Object.keys(registry.profiles);
ids.forEach((id, index) => {
    registry.profiles[id].data.profile_tagesgeld = index ? '100000' : '10000';
    delete registry.profiles[id].data.profile_cash_history_v1;
});
seed.rs_profiles_v1 = JSON.stringify(registry);
seed.profile_tagesgeld = '10000'; delete seed.profile_cash_history_v1;
const endings = [];
try {
    for (const automatic of [false, true]) {
        const fixture = await playFixture('tauri', seed);
        let controller = await fixture.boot();
        await controller.start(() => ({ source: 'copy', testDate: '2026-11-02' }));
        controller = await fixture.boot();
        const real = fixture.realBytes();
        const profiles = () => JSON.parse(storage.getItem('rs_profiles_v1')).profiles;
        const blockedBefore = JSON.stringify(profiles()[ids[0]]);
        const entries = new ActionRenderer({}).prepareExecutionEntries(ids.map((id, index) => ({ profileId: id,
            input: { floorBedarf: 30000, flexBedarf: 30000, liquidityRunwayYears: 5, liquidityCashMonths: 12,
                minCashBufferMonths: 2, tagesgeld: index ? 100000 : 10000, geldmarktEtf: 100000,
                personalTagesgeldTarget: 30000, jointAssessment: false, detailledTranches: null },
            action: { type: 'NONE', quellen: [], verwendungen: {}, steuer: 0 }, spending: {} })), 300000);
        assert(entries[0].action.automaticExecutionBlocked, 'F-1: fehlender Einstand sperrt Max vor beiden Ausführungswegen');
        assertEqual(entries[1].action.internalCashRebalance.amount, 50000, 'F-1: Erika hat eine ausführbare steuerfreie Abschöpfung');
        if (automatic) {
            const services = createTimeLapseServices({ controller, win: fixture.win });
            const runner = createTimeLapse({ controller, session: areaSessionStorage(fixture.session), yieldStep: async () => {}, services: {
                preparePeriod: async () => ({ label: 'Testmonat', actions: entries }), closePeriod: async () => {},
                executeAction: period => services.executeAction(period)
            } });
            runner.start({ start: '2026-11-02', end: '2026-11-02' }); await runner.run();
            assertEqual(runner.state.status, 'done', 'F-1: Zeitraffer läuft mit gesperrter Person weiter');
            assert(runner.state.message.includes(`${registry.profiles[ids[0]].meta.name}: ausgelassen`) && runner.state.message.includes('Einstand im Vermögen fehlt'), 'F-1: Fortschritt nennt ausgelassene Person und Grund');
            const restored = createTimeLapse({ controller, session: areaSessionStorage(fixture.session) });
            assertEqual(restored.restore().message, runner.state.message, 'F-1: Hinweis bleibt nach Neuladen lesbar');
        } else {
            // Exakt die Auswahl der Balance-Eintragung; danach deren normale Buchungsdienste.
            const executable = entries.filter(entry => !entry.action?.automaticExecutionBlocked);
            const prepared = await preparePlayAction({ controller, entries: executable.length ? executable : entries });
            await commitPlayAction(prepared, { controller });
            if (pendingPlayActions().length) await commitPlayAction(await preparePlayCredit(prepared.batch.id, { controller }), { controller });
        }
        assertEqual(JSON.stringify(profiles()[ids[0]]), blockedBefore, 'F-1: ausgelassene Person bleibt bytegleich');
        assertEqual(Number(profiles()[ids[1]].data.profile_tagesgeld), 50000, 'F-1: andere Person wird tatsächlich gebucht');
        assertEqual(pendingPlayActions().length, 0, 'F-1: keine offene Gutschrift');
        assertEqual(fixture.realBytes(), real, 'F-1: echte Daten bleiben bytegleich');
        endings.push(ids.map(id => ({ cash: profiles()[id].data.profile_tagesgeld,
            purchases: JSON.parse(profiles()[id].data.depot_tranchen).filter(lot => lot.source === 'spielwert').map(lot => ({ type: lot.type, shares: lot.shares, price: lot.currentPrice })) })));
        P.resetPersistenceForTests();
    }
    assertEqual(JSON.stringify(endings[0]), JSON.stringify(endings[1]), 'F-1: Balance-Eintragung und Zeitraffer ergeben dieselben Personenbestände');
} finally { P.resetPersistenceForTests(); setAppTestDate(oldDate); restoreLocks(); restoreRealClock(); }
