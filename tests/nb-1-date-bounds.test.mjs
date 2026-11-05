import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createProbelaufController, PROBELAUF_STATE_KEY } from '../app/shared/probelauf-state.js';
import { appTestDateBounds, advanceCalendarDate, getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { createTimeLapse } from '../app/shared/probelauf-timelapse.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';

const RealDate = globalThis.Date;
const fixed = new RealDate('2026-10-30T12:00:00').getTime();
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
const message = 'Bitte ein Datum bis spätestens 30.10.2027 wählen.';
async function rejected(run) { let error; try { await run(); } catch (cause) { error = cause; } return error; }
try {
    const f = await playFixture('tauri', createMusterHaushaltRecords('2026-10-30'));
    let c = await f.boot();
    const real = f.realBytes();
    assertEqual((await rejected(() => c.start(() => ({ source: 'demo', testDate: '2207-01-02' })))).message, message, 'Unzulässiger Start vor Musterberechnung abgelehnt');
    assertEqual(f.realBytes(), real, 'Abgewiesener Start erhält echte Bytes');
    await c.start(() => ({ source: 'demo', testDate: '2026-10-28' })); c = await f.boot();
    for (const date of ['2207-01-02', '2027-10-31', advanceCalendarDate(appTestDateBounds().max, 'day'), advanceCalendarDate(appTestDateBounds().max, 'month')]) {
        const before = JSON.stringify(await P.readPersistedRecords()), writes = f.writes;
        assertEqual((await rejected(() => c.changeDate(date))).message, message, 'Datumssprung erhält zentrale Feldmeldung');
        assertEqual(JSON.stringify(await P.readPersistedRecords()), before, 'Abgewiesener Datumssprung speichert nichts');
        assertEqual(f.writes, writes, 'Kein Schreibbatch für abgewiesenen Sprung');
        assertEqual(getAppTestDate(), '2026-10-28', 'Abgewiesener Sprung erhält Fachuhr');
        assert(!c.blocked, 'Abgewiesener Sprung erlaubt weitere Bedienung');
    }
    const runner = createTimeLapse({ controller: c, session: areaSessionStorage(f.session) });
    assertEqual((await rejected(() => runner.start({ start: '2026-10-30', end: '2027-10-31' }))).message, message, 'Zeitraffer erhält dieselbe Meldung');
    assertEqual(runner.state, null, 'Abgewiesener Zeitraffer legt keinen Lauf an');
    assertEqual(getAppTestDate(), '2026-10-28', 'Abgewiesener Zeitraffer springt nicht');
    // Simulierter Altbestand: nur die synthetische Spielkopie erhält ein beschädigtes Testdatum.
    f.values[PROBELAUF_STATE_KEY] = JSON.stringify({ ...c.state, testDate: '2207-01-02' });
    P.resetPersistenceRuntimeForTests(); await P.init(f.options);
    c = createProbelaufController({ win: f.win, reload() {}, restoreReload() {} });
    const before = JSON.stringify(await P.readPersistedRecords()), writes = f.writes;
    const error = await rejected(() => c.initialize());
    assert(error.message.includes('02.01.2207 liegt außerhalb des erlaubten Zeitraums'), 'Gespeichertes 2207 zeigt verständlichen Hinweis');
    assertEqual(c.blockReason, error.message, 'Vorhandener Recoverybaustein erhält den Hinweis');
    assert(c.blocked && getAppTestDate() === null, 'Seitenstart blockiert mit echter Uhr vor Fachberechnung');
    assertEqual(f.writes, writes, 'Seitenstart berechnet und schreibt keine Spielkurse');
    assertEqual(JSON.stringify(await P.readPersistedRecords()), before, 'Start erhält sämtliche gespeicherten Bytes');
    assertEqual((await c.end(() => true)).status, 'reloaded', 'Vorhandener Weg Spielbereich beenden bleibt erreichbar');
    assertEqual(f.realBytes(), real, 'Beenden des Altbestands erhält echte Daten');
} finally { P.resetPersistenceForTests(); setAppTestDate(null); globalThis.Date = RealDate; }
