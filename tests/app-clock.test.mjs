import { appNow, localCalendarDate, setAppTestDate, advanceCalendarDate, parseCalendarDate } from '../app/shared/app-clock.js';
import { planningYear, projectOverview } from '../app/overview/overview-model.js';
import { personReferenceYear } from '../app/profile/profile-person-data.js';
import { localHistoryDate } from '../app/tranches/tranchen-history-store.js';
import { createEmptyExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { buildSnapshot } from '../app/shared/snapshot-archive.js';
import { readDecimalInput } from '../app/tranches/tranchen-manager-decimal-input.js';

{
    const RealDate = globalThis.Date;
    let realDay = '2026-10-30';
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [realDay + 'T12:00:00'])); } };
    try {
        for (const date of ['2207-01-02', '2027-10-31']) {
            let error;
            try { setAppTestDate(date); } catch (cause) { error = cause; }
            assertEqual(error?.message, 'Bitte ein Datum bis spätestens 30.10.2027 wählen.', 'Datum außerhalb des Rahmens abgelehnt: ' + date);
        }
        for (const date of ['2027-10-30', '2027-01-02', '2026-10-28', '0001-01-01']) {
            setAppTestDate(date);
            assertEqual(localCalendarDate(), date, 'Zulässiges Testdatum: ' + date);
        }
        realDay = '2024-02-29';
        setAppTestDate('2025-02-28');
        let error; try { setAppTestDate('2025-03-01'); } catch (cause) { error = cause; }
        assertEqual(error?.message, 'Bitte ein Datum bis spätestens 28.02.2025 wählen.', 'Schalttag endet am 28. Februar des Folgejahrs');
        assertEqual(localCalendarDate(), '2025-02-28', 'Abgewiesenes Datum verändert die Fachuhr nicht');
    } finally { setAppTestDate(null); globalThis.Date = RealDate; }
}

// FR-79: Der alte Verkaufsdialog mit eigenem DOM-Reader entfällt; der geführte Verkauf nimmt die Uhr über `appNow()` (vk-1-sollfaelle).

const RealDate = globalThis.Date;
const fixed = new RealDate(2026, 10, 1, 9, 31, 22, 777).getTime();
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
try {
    assertEqual(appNow().getTime(), fixed, 'Normalzeit bleibt millisekundengenau');
    assertEqual(localCalendarDate(), '2026-11-01', 'Lokales Datum verwendet Kalenderkomponenten');
    const input = { registry: null, activeId: null };
    assertEqual(JSON.stringify(projectOverview(input)), JSON.stringify(projectOverview({ ...input, now: new Date() })), 'Normalprojektion entspricht expliziter Systemzeit');
    assertEqual(planningYear(null), planningYear(null, new Date()), 'Planungsjahr bleibt gleich');
    setAppTestDate('2027-01-02');
    setAppTestDate('2027-02-03');
    setAppTestDate(null);
    setAppTestDate('2027-01-02');
    assertEqual(appNow().getHours(), 12, 'Virtuelle Uhr ist lokale Mittagszeit');
    assertEqual(planningYear(null), 2027, 'Planungsjahr verwendet virtuelle Uhr');
    assertEqual(personReferenceYear(null), 2027, 'Personenstandard verwendet virtuelle Uhr');
    assertEqual(createEmptyExpensesStore().activeYear, 2027, 'Ausgabenstandard verwendet virtuelle Uhr');
    assertEqual(localHistoryDate(), '2027-01-02', 'Historiedatum verwendet virtuelle Uhr');
    assertEqual(buildSnapshot({ records: {} }).createdAt, appNow().toISOString(), 'Snapshotzeit verwendet virtuelle Uhr');
    assertEqual(planningYear(null, new Date(2023, 0, 1)), 2023, 'Explizite Referenz bleibt vorrangig');
    const date = appNow(); date.setFullYear(2000);
    assertEqual(appNow().getFullYear(), 2027, 'Aufrufer kann zentrale Uhr nicht mutieren');
    for (const [value, unit, result] of [
        ['2026-01-31', 'month', '2026-02-28'], ['2024-01-31', 'month', '2024-02-29'],
        ['2024-02-28', 'day', '2024-02-29'], ['2024-02-29', 'day', '2024-03-01'],
        ['2026-12-31', 'day', '2027-01-01'], ['2026-03-28', 'day', '2026-03-29'],
        ['2026-10-24', 'day', '2026-10-25']]) {
        assertEqual(advanceCalendarDate(value, unit), result, `Kalenderfall ${value}/${unit}`);
    }
    for (const invalid of ['2026-02-29', '2026-13-01', '2026-01-32', '2026-1-1', '0000-01-01']) {
        let rejected = false; try { parseCalendarDate(invalid); } catch { rejected = true; }
        assert(rejected, `Ungültiges Datum verworfen: ${invalid}`);
    }
} finally { setAppTestDate(null); globalThis.Date = RealDate; }

{
    const previousZone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
        assertEqual(parseCalendarDate('2026-03-29') - parseCalendarDate('2026-03-28'), 23 * 3600000, 'Sommerzeitbeginn ist ein realer 23-Stunden-Kalendertag');
        assertEqual(parseCalendarDate('2026-10-25') - parseCalendarDate('2026-10-24'), 25 * 3600000, 'Sommerzeitende ist ein realer 25-Stunden-Kalendertag');
        assertEqual(advanceCalendarDate('2026-03-28', 'day'), '2026-03-29', 'Kalenderfortschritt über echte Sommerzeitgrenze');
    } finally {
        if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone;
    }
}
