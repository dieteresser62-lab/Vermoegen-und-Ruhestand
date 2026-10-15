import { createTimeLapse, timeLapseDates, timeLapseDefaults, canRunTimeLapse } from '../app/shared/probelauf-timelapse.js';
import { requestTimeLapse, renderTimeLapseUI, resumeTimeLapse } from '../app/shared/probelauf-timelapse-ui.js';
import { createTimeLapseServices } from '../app/overview/overview-timelapse.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { getAppTestDate, setAppTestDate, localCalendarDate } from '../app/shared/app-clock.js';
import { readAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { planScope } from '../app/profile/household-plan.js';
import { pendingPlayActions } from '../app/balance/balance-play-execution.js';
import { readMonthProvision, overviewScope, OVERVIEW_MONTH_KEY } from '../app/overview/overview-storage.js';
import { loadExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { probelaufTransferability } from '../app/shared/probelauf-comparison.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';

const oldDate = getAppTestDate(), oldFetch = globalThis.fetch;
const restoreLocks = installAnnualLocks();
let network = 0;
globalThis.fetch = async () => { network++; throw new Error('Zeitraffer darf kein Netz benötigen'); };
const refused = async (run, text) => {
    let error; try { await run(); } catch (cause) { error = cause; }
    assert(Boolean(error), text);
};
assertEqual(timeLapseDefaults('2026-11-02').end, '2027-01-02', 'Standard endet beim nächsten Januarabschluss');
assertEqual(JSON.stringify(timeLapseDates({ start: '2026-11-02', end: '2027-01-02', current: '2026-11-02' })),
    JSON.stringify(['2026-11-02', '2026-12-02', '2027-01-02']), 'Kalenderfortschritte schließen November und Dezember im Folgemonat');
assertEqual(timeLapseDates({ start: '2026-10-31', end: '2027-01-02', current: '2026-10-31' })[1], '2026-11-30', 'Monatsende bleibt ein gültiger Kalendertag');
await refused(() => timeLapseDates({ start: '2026-11-02', end: '2026-10-02' }), 'Rückwärtslauf wird abgewiesen');
await refused(() => timeLapseDates({ start: '2026-11-02', end: '2028-01-02' }), 'Lauf ist auf ein Jahr begrenzt');

try {
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
        const seed = createMusterHaushaltRecords('2026-11-02');
        seed.balance_inputs_v1 = '{"legacy":true}';
        const f = await playFixture(kind, seed);
        let controller = await f.boot();
        await SnapshotArchive.createSnapshot({ records: seed, id: `echt-${kind}`, label: 'Echter Ausgangsstand', kind: 'manual', createdAt: '2026-10-01T12:00:00Z' });
        const realBefore = f.realBytes();
        assert(!canRunTimeLapse(controller), `${kind}: echter Bereich bietet keinen Zeitraffer`);
        await refused(() => createTimeLapse({ controller, session: f.session }).start({ start: '2026-11-02', end: '2027-01-02' }), `${kind}: echter Betrieb verweigert den Start`);
        await controller.start(() => ({ source: 'demo', testDate: '2026-11-02' }));
        controller = await f.boot({ guard: createNavigationGuard() });
        let runner;
        const bootRunner = () => createTimeLapse({ controller, session: areaSessionStorage(f.session),
            services: createTimeLapseServices({ controller, win: f.win, guard: createNavigationGuard() }), yieldStep: async () => {} });
        runner = bootRunner(); runner.start({ start: '2026-11-02', end: '2027-01-02' });
        const progress = [];
        for (let attempt = 0; attempt < 5; attempt++) {
            await runner.run(); progress.push(runner.state.message);
            assertEqual(f.realBytes(), realBefore, `${kind}: jeder Datumssprung und Finanzschritt lässt echte Daten und Archive bytegleich`);
            if (runner.state.status !== 'running') break;
            controller = await f.boot({ guard: createNavigationGuard() }); runner = bootRunner(); runner.restore();
        }
        assertEqual(runner.state.status, 'done', `${kind}: Max und Erika laufen vom 02.11. bis Januar ohne Handeingabe: ${runner.state.message}`);
        assertEqual(localCalendarDate(), '2027-01-02', `${kind}: endet am gewählten Spieldatum`);
        assert(runner.state.message.includes('3 von 3'), `${kind}: Bandfortschritt nennt den vollständigen Lauf`);
        const persisted = await P.readPersistedRecords();
        const registry = JSON.parse(persisted.rs_profiles_v1), ids = Object.keys(registry.profiles).sort();
        const plan = readAnnualPlanRecord({ year: 2027, scope: planScope('household', ids) });
        assert(plan && !plan.status && plan.adopted.action && plan.periodId === 'calendar-year:2026', `${kind}: neuer Jahresplan und Handlungsanweisung sind festgeschrieben`);
        assertEqual(plan.committedAt.slice(0, 10), '2027-01-02', `${kind}: regulärer Jahresbeleg trägt das Abschlussdatum`);
        const scope = overviewScope('household', ids);
        for (const month of ['2026-11', '2026-12']) {
            const receipt = readMonthProvision(persisted[OVERVIEW_MONTH_KEY], month, scope);
            assert(receipt && Object.keys(receipt.playValues).length === 2, `${kind}: ${month} ist mit beiden Tagesgeld-Spielwerten abgeschlossen`);
        }
        const expenses = loadExpensesStore();
        for (const month of [11, 12]) for (const id of ids) {
            assertEqual(expenses.years[2026].months[month].profiles[id].source, 'probelauf-example', `${kind}: echte Ausgabenimports kennzeichnen Beispieldaten`);
        }
        assertEqual(pendingPlayActions().length, 0, `${kind}: erzeugte Verkäufe samt Gutschrift vollständig eingetragen`);
        assert(registry.playActionExecutions?.length > 0, `${kind}: fällige Jahresanweisung durch SD-2 tatsächlich gebucht`);
        assert(!probelaufTransferability(controller.state, seed).eligible, `${kind}: Datumssprung sperrt Übernehmen`);
        const endReview = await controller.readEndReview();
        assertEqual(endReview.real, null, `${kind}: auch nach Zeitraffer kein Echtvergleich`);
        assertEqual(endReview.madeChanges.closes.join(' · '), 'November bis Dezember 2026 · Jahr 2026', `${kind}: Zeitrafferzusammenfassung nennt nur durchgespielte Abschlüsse, keinen offenen Januar`);
        await controller.end(async () => true); await f.boot();
        assertEqual(f.realBytes(), realBefore, `${kind}: auch Verwerfen erhält echte Daten und Archive bytegleich`);
        P.resetPersistenceForTests();
    }

    // Anhalten zwischen echten Finanzschritten: importierte Daten bleiben manuell nutzbar.
    const f = await playFixture('tauri', createMusterHaushaltRecords('2026-11-02'));
    let controller = await f.boot();
    await controller.start(() => ({ source: 'copy', testDate: '2026-12-02' })); controller = await f.boot();
    const realBefore = f.realBytes(), session = areaSessionStorage(f.session);
    let runner;
    runner = createTimeLapse({ controller, session, services: createTimeLapseServices({ controller, win: f.win }),
        yieldStep: async () => { if (loadExpensesStore().years[2026]?.months[11]?.profiles?.muster_a?.source) runner.stop(); } });
    runner.start({ start: '2026-12-02', end: '2027-01-02' }); await runner.run();
    assertEqual(runner.state.status, 'stopped', 'Anhalten verhindert den nächsten Abschluss');
    assert(!readMonthProvision(storage.getItem(OVERVIEW_MONTH_KEY), '2026-11', overviewScope('household', ['muster_a', 'muster_b'])), 'Anhalten nach Import lässt November zur manuellen Fortsetzung offen');
    assertEqual(f.realBytes(), realBefore, 'Anhalten lässt echte Daten bytegleich');
    const interrupted = createTimeLapse({ controller, session });
    const rawSession = JSON.parse(session.getItem('probelauf.timelapse.v1'));
    session.setItem('probelauf.timelapse.v1', JSON.stringify({ ...rawSession, status: 'running', stage: 'working' }));
    assertEqual(interrupted.restore().status, 'stopped', 'Neuladen mitten im Finanzschritt wiederholt keine Buchung automatisch');
    const broken = createTimeLapse({ controller, session, services: { preparePeriod: async () => { throw new Error('Test-Speicherfehler'); } }, yieldStep: async () => {} });
    broken.start({ start: '2026-12-02', end: '2027-01-02' }); await broken.run();
    assertEqual(broken.state.status, 'error', 'Schrittfehler hält den Zeitraffer an');
    assert(broken.state.message.includes('Test-Speicherfehler'), 'Fehlermeldung nennt die Ursache im Band');
    await broken.run(); assertEqual(broken.state.index, 0, 'Kein automatischer Wiederholungsversuch nach Fehler');
    // Echter Bandknopf und Seitendialog, Anhalten auch während der Seitenbereitschaft.
    const ui = createDialogFixture().doc; ui.defaultView = f.win; ui.documentElement = { dataset: { suitePage: 'index' } };
    const main = ui.createElement('main'); main.id = 'suiteMain';
    const band = ui.createElement('aside'); band.id = 'probelaufBand';
    const actions = ui.createElement('div'); actions.className = 'ds-actions';
    const day = ui.createElement('button'); day.dataset.probelaufAction = 'day';
    const end = ui.createElement('button'); end.dataset.probelaufAction = 'end'; end.textContent = 'Spielbereich beenden'; actions.append(day, end); band.append(actions);
    const content = ui.createElement('div'); main.append(band, content); ui.body.append(main);
    renderTimeLapseUI(ui, controller);
    const order = actions.children.map(node => node.id || node.className || node.dataset.probelaufAction);
    assertEqual(order.join(','), 'day,probelaufTimeLapse,ds-info,probelaufTimeLapseStop,end,probelaufTimeLapseProgress', 'Zeitraffer, Info und Anhalten vor Beenden; Fortschritt am Bandende');
    renderTimeLapseUI(ui, controller);
    assertEqual(actions.children.map(node => node.id || node.className || node.dataset.probelaufAction).join(','), order.join(','), 'Erneutes Rendern erhält Bandreihenfolge ohne doppelte Knöpfe');
    let releaseReady; const waiting = new Promise(resolve => { releaseReady = resolve; });
    await resumeTimeLapse(ui, { ready: () => waiting });
    assert(!ui.getElementById('probelaufTimeLapse').disabled, 'Band bietet Ein Jahr durchspielen im aktiven Spielbereich');
    const click = ui.getElementById('probelaufTimeLapse').fire('click');
    ui.querySelector('[data-time-lapse-date="end"]').value = '2027-01-02';
    await ui.querySelector('[data-time-lapse-start]').fire('click'); await Promise.resolve();
    assert(content.inert && day.disabled && !ui.getElementById('probelaufTimeLapseStop').hidden, 'Lauf sperrt Eingaben und lässt Anhalten im Band bedienbar');
    await ui.getElementById('probelaufTimeLapseStop').fire('click'); releaseReady(); await click;
    assert(!content.inert && !day.disabled, 'Anhalten gibt den erreichten Stand zur manuellen Bedienung frei');
    await controller.changeDate('2027-11-02'); controller = await f.boot();
    const lateAnnual = await createTimeLapseServices({ controller, win: f.win }).preparePeriod();
    assert(lateAnnual.annual && lateAnnual.year === 2026, 'Ein verspäteter Jahresabschluss behält sein Abschlussjahr statt des aktuellen Vormonatsjahres');
    assert(Object.values(lateAnnual.cash.playValues).every(value => value.through === '2026-12-31'), 'Auch beim verspäteten Abschluss endet der Jahres-Tagesgeldvorschlag am richtigen Jahresende');
    P.resetPersistenceForTests();

    // Stand heute: Abbruch ohne Mutation, Start bestätigt den ersten echten Datumssprung.
    const todayFixture = await playFixture('localstorage', createMusterHaushaltRecords('2026-11-02'));
    controller = await todayFixture.boot(); await controller.start(() => ({ source: 'copy', testDate: null })); controller = await todayFixture.boot();
    const { doc } = createDialogFixture();
    const before = JSON.stringify(await P.readPersistedRecords());
    const cancelled = requestTimeLapse({ doc, controller });
    const dialog = doc.getElementById('probelaufTimeLapseDialog'); await dialog.fire('cancel'); await cancelled;
    assertEqual(JSON.stringify(await P.readPersistedRecords()), before, 'Abbruch des Zeitraffers schreibt keine Finanzdaten');
    const chosen = requestTimeLapse({ doc, controller });
    assert(doc.querySelector('[data-time-lapse-start]').textContent.includes('Datumssprung bestätigen'), 'Stand heute verlangt eine ausdrückliche Sprungbestätigung');
    await doc.querySelector('[data-time-lapse-start]').fire('click'); const selection = await chosen;
    const jumpRunner = createTimeLapse({ controller, session: areaSessionStorage(todayFixture.session), services: {}, yieldStep: async () => {} });
    const today = localCalendarDate(); jumpRunner.start(selection); await jumpRunner.run();
    assert(controller.state.testDate !== null && controller.state.testDate > today, 'Erster Schritt verlässt Stand heute über regulären Datumssprung');
    assert(controller.state.hasDateJump, 'Regulärer Sprung setzt die dauerhafte Übernahmesperre');
    assertEqual(network, 0, 'Zeitraffer ruft kein Netz ab');
} finally { P.resetPersistenceForTests(); setAppTestDate(oldDate); globalThis.fetch = oldFetch; restoreLocks(); }
