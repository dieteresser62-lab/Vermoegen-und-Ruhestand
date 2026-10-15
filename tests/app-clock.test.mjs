import { appNow, localCalendarDate, setAppTestDate, advanceCalendarDate, parseCalendarDate } from '../app/shared/app-clock.js';
import { planningYear, projectOverview } from '../app/overview/overview-model.js';
import { personReferenceYear } from '../app/profile/profile-person-data.js';
import { localHistoryDate } from '../app/tranches/tranchen-history-store.js';
import { createEmptyExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { buildSnapshot } from '../app/shared/snapshot-archive.js';
import { readDecimalInput } from '../app/tranches/tranchen-manager-decimal-input.js';
import { functionSource } from './designsystem-selection-dom.mjs';

// Tatsächlicher Vorschaupfad einschließlich Uhrübergabe an den isolierbaren DOM-Reader.
const reconciliationSource = ['readOptionalNumber', 'readReconciliationActionFromDom', 'createReconciliationPreview']
    .map(name => functionSource('app/tranches/tranchen-manager-page.js', name)).join('\n');
const reconciliationFields = new Map([
    ['reconcileCashStatus', 'confirmed_already_reflected'], ['reconcileInitialCashBalance', '207,5']
]);
const reconciliationState = { profileId: 'synthetic-person', confirmedTranches: [], confirmedRaw: '[]' };
const createPreview = new Function('dependencies', `
    const { byId, readDecimalInput, state, appNow, processingIsBlocked,
        previewTrancheReconciliation, readStoredValue, PROFILE_STORAGE_KEYS,
        renderReconciliationState, TrancheReconciliationError } = dependencies;
    ${reconciliationSource}
    return createReconciliationPreview;
`)({
    byId: id => ({ value: reconciliationFields.get(id) ?? '' }),
    readDecimalInput, state: reconciliationState, appNow,
    processingIsBlocked: () => false,
    previewTrancheReconciliation: () => ({ status: 'ready' }),
    readStoredValue: () => null, PROFILE_STORAGE_KEYS: { registry: 'rs_profiles_v1' },
    renderReconciliationState() {}, TrancheReconciliationError: class extends Error {}
});

const RealDate = globalThis.Date;
const fixed = new RealDate(2026, 10, 1, 9, 31, 22, 777).getTime();
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
try {
    assertEqual(appNow().getTime(), fixed, 'Normalzeit bleibt millisekundengenau');
    assertEqual(localCalendarDate(), '2026-11-01', 'Lokales Datum verwendet Kalenderkomponenten');
    const input = { registry: null, activeId: null };
    assertEqual(JSON.stringify(projectOverview(input)), JSON.stringify(projectOverview({ ...input, now: new Date() })), 'Normalprojektion entspricht expliziter Systemzeit');
    assertEqual(planningYear(null), planningYear(null, new Date()), 'Planungsjahr bleibt gleich');
    assertEqual(createPreview(), true, 'Cashvorschau im Normalmodus erfolgreich');
    assertEqual(reconciliationState.reconciliationPreview.action.cashConfirmedAt, new Date().toISOString(), 'Cashbestätigung verwendet im Normalmodus die Systemzeit');
    setAppTestDate('2027-01-02');
    assertEqual(createPreview(), true, 'Cashvorschau im Spielbereich erfolgreich');
    assertEqual(reconciliationState.reconciliationPreview.action.cashConfirmedAt, appNow().toISOString(), 'Produktiver Vorschaupfad übergibt die fachliche Uhr an den Cashreader');
    setAppTestDate('2027-02-03');
    assertEqual(createPreview(), true, 'Cashvorschau nach Datumssprung erfolgreich');
    assertEqual(reconciliationState.reconciliationPreview.action.cashConfirmedAt, appNow().toISOString(), 'Cashbestätigung folgt dem geänderten Testdatum');
    setAppTestDate(null);
    assertEqual(createPreview(), true, 'Cashvorschau nach Probelaufende erfolgreich');
    assertEqual(reconciliationState.reconciliationPreview.action.cashConfirmedAt, new Date().toISOString(), 'Cashbestätigung kehrt zur Systemzeit zurück');
    setAppTestDate('2027-01-02');
    reconciliationFields.set('reconcileCashStatus', 'pending_manual_posting');
    assertEqual(createPreview(), true, 'Unbestätigte Cashvorschau erfolgreich');
    assert(!Object.hasOwn(reconciliationState.reconciliationPreview.action, 'cashConfirmedAt'), 'Offener Cashstatus erhält keinen Bestätigungszeitpunkt');
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
