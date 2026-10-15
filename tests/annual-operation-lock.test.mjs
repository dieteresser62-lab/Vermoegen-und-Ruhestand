import { createAtomicLockProvider, annualServiceFixture, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualOperationLock, withAnnualWriteAccess, ANNUAL_OPERATION_LOCK } from '../app/shared/annual-operation-lock.js';
import { storeMonthProvision } from '../app/overview/overview-storage.js';
import { createProbelaufController } from '../app/shared/probelauf-state.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createAnnualNavigationLifecycle } from '../app/shared/annual-coordinator.js';
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
const locks = createAtomicLockProvider(), restoreLocks = installAnnualLocks(locks);
try {
    const firstPage = createAnnualOperationLock({ locks: locks.page() }), secondPage = createAnnualOperationLock({ locks: locks.page() });
    const lease = await firstPage.acquire();
    assert(locks.held.has(ANNUAL_OPERATION_LOCK), 'Atomarer Provider hält den Seitenbesitz');
    assertEqual(await secondPage.acquire(), null, 'Unabhängige zweite Seite erhält keine Lease');
    let writes = 0, blocked;
    try { await withAnnualWriteAccess(() => { writes++; }, { locks: locks.page() }); } catch (error) { blocked = error; }
    assertEqual(blocked.code, 'ANNUAL_OPERATION_BUSY', 'Fremder Monats-/Probelaufwriter meldet sichtbare Sperre');
    assertEqual(writes, 0, 'Fremder Writer überschreitet keine Writegrenze');
    await withAnnualWriteAccess(() => { writes++; }, { annualLease: lease, locks: locks.page() });
    assertEqual(writes, 1, 'Eigene Monatsfortsetzung darf die aktive Jahreslease übernehmen');
    let spoofed = false;
    try { await withAnnualWriteAccess(() => { writes++; }, { annualLease: { released: false }, locks: locks.page() }); } catch { spoofed = true; }
    assert(spoofed, 'Fremder Guard oder nachgebauter Besitzer umgeht Besitzprüfung nicht');
    await lease.release();
    let reused = false;
    try { await firstPage.run(() => { writes++; }, lease); } catch { reused = true; }
    assert(reused, 'Freigegebene Lease darf nicht erneut verwendet werden');
    const replacement = await secondPage.acquire(); assert(replacement, 'Freigabe erlaubt neuen bewussten Start'); await replacement.release();

    const env = await annualServiceFixture({ locks }), entered = deferred(), gate = deferred();
    const first = env.create({ confirmAnnual: async () => { entered.resolve(); return gate.promise; } });
    const second = env.create({ operationLock: createAnnualOperationLock({ locks: locks.page() }) });
    const running = first.close(); await entered.promise;
    assertEqual((await second.close()).status, 'in_flight', 'Zwei Dienstinstanzen konkurrieren um denselben Bestand');
    assert(env.reports.some(error => error.message.includes('Jahresbesitz')), 'Konkurrierender Dienst meldet die Sperre');
    assertEqual((await first.close()).status, 'in_flight', 'Doppelklick startet keine zweite Vorbereitung');
    assertEqual(env.snapshots.size, 0, 'Zweiter Start erreicht keinen Snapshot');
    let monthError;
    try { await storeMonthProvision({}, { locks: locks.page(), flush: () => { writes++; } }); } catch (error) { monthError = error; }
    assertEqual(monthError?.code, 'ANNUAL_OPERATION_BUSY', 'Produktiver Monatsstore prüft den Seitenbesitz vor seinem ersten Write');
    const probelauf = createProbelaufController({ win: { navigator: { locks: locks.page() } }, persistence: env.persistence,
        runtimeResolver: async () => ({ canStart: true, kind: 'browser' }), reload: () => {}, notify() {} });
    const snapshots = env.snapshots.size, batches = env.batches.length;
    for (const action of [() => probelauf.start(async () => ({ source: 'copy', testDate: '2027-01-02' })),
        () => probelauf.end(async () => true)]) {
        const result = await action(); assertEqual(result.status, 'cancelled', 'Probelaufbeginn/-ende umgehen Jahresbesitz nicht');
        assertEqual(result.error.code, 'ANNUAL_OPERATION_BUSY', 'Spielbereich zeigt denselben Sperrgrund');
    }
    assertEqual(env.snapshots.size, snapshots, 'Gesperrter Spielbereich erzeugt keinen Snapshot');
    assertEqual(env.batches.length, batches, 'Gesperrter Spielbereich erzeugt keinen Backendwrite');
    gate.resolve(null); assertEqual((await running).status, 'cancelled', 'Abbruch löst den Jahresbesitz');
    assertEqual((await second.close()).status, 'already_committed', 'Neuer bewusster Start nach Abbruch bestätigt die Periode');
    assertEqual(env.snapshots.size, 1, 'Genau ein konkurrierender Start erreicht Snapshot und Fachwrite');
    assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === 'annual_plan_record_v1')).length, 1, 'Genau ein Jahresfachbatch');

    const unsupported = await annualServiceFixture();
    const result = await unsupported.create({ operationLock: createAnnualOperationLock({ locks: null }) }).close();
    assertEqual(result.error.code, 'ANNUAL_LOCK_UNAVAILABLE', 'Fehlender atomarer Provider führt zum sichtbaren Startfehler');
    assertEqual(unsupported.batches.length + unsupported.snapshots.size, 0, 'Kein ungeschützter Jahreswrite ohne Provider');
    const foreignGuard = createNavigationGuard();
    const registration = foreignGuard.register(Symbol('foreign'), { read: () => ({ phase: 'commit' }) });
    const guarded = unsupported.create({ navigationLifecycle: createAnnualNavigationLifecycle({ guard: foreignGuard }) });
    assertEqual((await guarded.close()).status, 'in_flight', 'Fremder aktiver Guard bleibt zusätzlich wirksam');
    registration.unregister();
} finally { restoreLocks(); PersistenceFacade.resetPersistenceRuntimeForTests(); }
