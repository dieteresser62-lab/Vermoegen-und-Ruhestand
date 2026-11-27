// VS-2 (Nutzer 16.11.2026): Erfasste Vermögensstände sind Altbestand. Ausgabenimport und Beispielhaushalte schreiben
// keine Erfassung mehr; der Jahresabschluss schreibt seinen Eintrag bis nach dem Januar-Abschluss weiter.
// Zweiter Teil: Eine Tagesgeldänderung in Personen & Vermögen schreibt einen datierten Verlaufseintrag, und die Kurve zeigt ihn.
import { overviewImportFixture } from './overview-close-dialog-import.test.mjs';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { WEALTH_CAPTURES_KEY, readWealthCaptures } from '../types/wealth-capture-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE } from '../app/demo/muster-haushalte.js';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { EngineAPI } from '../engine/index.mjs';
import { saveProfileAssetValues, loadProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { PROFILE_CASH_HISTORY_KEY, projectProfileWealthHistory } from '../app/profile/profile-wealth-history.js';
import { readReconciliationHistory } from '../app/tranches/tranche-reconciliation.js';
import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';
import { readFileSync } from 'node:fs';

// 1. Ausgabenimport über den echten Dialogweg schreibt weder Erfassung noch Tagespunkt.
{
    const f = await overviewImportFixture();
    try {
        await f.open();
        const stateBefore = f.backend.get(CONFIG.STORAGE.LS_KEY), batchesBefore = f.batches.length;
        assertEqual(f.backend.has(WEALTH_CAPTURES_KEY), false, 'Beispielhaushalt startet ohne erfasste Stände');
        await f.csv();
        assert(JSON.parse(f.backend.get('balance_expenses_v1')).years[2026].months[9].profiles.muster_a, 'Ausgabenimport ist dauerhaft bestätigt');
        assertEqual(f.backend.has(WEALTH_CAPTURES_KEY), false, 'Ausgabenimport schreibt keine Erfassung');
        assert(!f.batches.slice(batchesBefore).some(batch => batch.some(([key]) => key === WEALTH_CAPTURES_KEY)), 'Kein Speicherauftrag berührt die Erfassungen');
        assertEqual(f.backend.get(CONFIG.STORAGE.LS_KEY), stateBefore, 'Ausgabenimport ändert den Balance-Zustand samt Verlauf nicht');
    } finally { await f.close(); }
}

// 2. Das Anlegen eines Beispielhaushalts schreibt keine Erfassung.
for (const { id } of MUSTER_HAUSHALTE) {
    const records = createMusterHaushaltRecords('2026-09-01', id);
    assertEqual(Object.hasOwn(records, WEALTH_CAPTURES_KEY), false, `Beispielhaushalt ${id} legt keine Erfassung an`);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) {
        assertEqual(JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]).wealthHistory.entries.length, 0, `Beispielhaushalt ${id}: kein Verlaufseintrag im Balance-Zustand`);
        assert(JSON.parse(profile.data[PROFILE_CASH_HISTORY_KEY]).entries.length > 0, `Beispielhaushalt ${id}: Tagesgeld-Historie bleibt die Quelle der Kurve`);
    }
}

// 3. Der Jahresabschluss schreibt seinen Eintrag weiter in den Verlauf und in die Erfassungen.
{
    const fixture = balanceStorageFixture('Muster-Haushalt', 'standard', 25);
    const { records, scope } = fixture;
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
        pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: {} } } });
    const clock = () => new Date('2027-01-02T12:00:00Z');
    const marketData = { inflation: { rate: 2.14, year: 2026, source: 'ECB (HICP)', dataAsOf: '2027-01-01', fetchStatus: 'ok_primary_ecb',
        metric: 'consumer_prices_all_items_annual_average_growth_pct' },
        etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: 2026 },
        cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: clock().toISOString() } };
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records) });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: clock });
    const captured = readWealthCaptures(prepared.records[WEALTH_CAPTURES_KEY]).captures.find(capture => capture.household.id === 'annual:2026');
    assert(captured && captured.household.reason === 'annual_close', 'Jahresabschluss schreibt seinen Eintrag weiter in die Erfassungen');
    const committed = JSON.parse(prepared.records[CONFIG.STORAGE.LS_KEY]).wealthHistory.entries;
    assert(committed.some(entry => entry.id === 'annual:2026' && entry.reason === 'annual_close'), 'Jahresabschluss schreibt seinen Eintrag weiter in den Verlauf');
}

// 4. Keine App-Datei außer dem Jahresabschluss schreibt Erfassungen.
{
    const writers = ['app/balance/balance-annual-storage-commit.js'];
    for (const file of writers) assert(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('prepareWealthCapture('), `${file} bleibt Schreiber des Abschlussnachweises`);
    for (const file of ['app/demo/muster-haushalt.js', 'app/overview/overview-example-expenses.js', 'app/expenses/expenses-controller.js',
        'app/balance/balance-binder.js', 'app/tranches/tranchen-manager-page/startup.js']) {
        const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert(!text.includes('WEALTH_CAPTURES_KEY') && !text.includes('afterImport') && !text.includes('WealthCapture'), `${file} schreibt keine Erfassung mehr`);
    }
}

// 5. Tagesgeld in Personen & Vermögen ändern: datierter Eintrag in profile_cash_history_v1, die Kurve zeigt ihn.
{
    const managerSource = readFileSync(new URL('../app/tranches/tranchen-manager-page/profile-values.js', import.meta.url), 'utf8');
    assert(/saveProfileAssetValues\(validatedValues, persistenceStorage, \{ recordCashChange: true/.test(managerSource),
        'Personen & Vermögen speichert Tagesgeld immer mit Verlaufseintrag');
    const map = new Map();
    const storage = { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
    saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 1000 }, storage);
    saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 1500 }, storage, { recordCashChange: true, date: '2026-03-04' });
    const history = JSON.parse(storage.getItem(PROFILE_CASH_HISTORY_KEY));
    assertEqual(history.baselineValue, 1000, 'Verlauf behält den Stand vor der Änderung als Basis');
    assertEqual(JSON.stringify(history.entries), JSON.stringify([{ date: '2026-03-04', value: 1500 }]), 'Änderung steht datiert im Tagesgeld-Verlauf');
    const curve = evaluateWealthHistory({ startDate: '2026-03-01', today: '2026-03-07',
        profiles: [{ id: 'a', currentCash: 1500, cashHistory: history, lots: [] }] });
    const cashOn = date => curve.points.find(point => point.date === date)?.allocation.cash;
    assertEqual(cashOn('2026-03-03'), 1000, 'Kurve zeigt vor der Änderung den alten Stand');
    assertEqual(cashOn('2026-03-04'), 1500, 'Kurve zeigt die Änderung ab ihrem Tag');
    assertEqual(cashOn('2026-03-06'), 1500, 'Kurve hält den neuen Stand bis zur nächsten Änderung');
}

// 6. Beispielvariante „teilweise“: Die bestätigte Verkaufsgutschrift steht datiert im Tagesgeld-Verlauf (Nachtrag 2).
{
    const { readCashPerson } = await import('../app/profile/profile-cash-update.js');
    const records = createMusterHaushaltRecords('2026-10-28', 'max-erika', 'teilweise');
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(registry.profiles)) {
        const history = JSON.parse(profile.data[PROFILE_CASH_HISTORY_KEY]), cash = Number(profile.data.profile_tagesgeld);
        assertEqual(readCashPerson(id, id, profile.data).error, null, `teilweise ${id}: Tagesgeld und Verlauf widersprechen sich nicht`);
        assertEqual(history.entries.at(-1).value, cash, `teilweise ${id}: letzter Verlaufswert = Kontostand`);
        const curve = evaluateWealthHistory({ startDate: '2026-03-01', today: '2026-10-28',
            profiles: [{ id, currentCash: cash, cashHistory: history, lots: [] }] });
        assertEqual(curve.points.at(-1).allocation.cash, cash, `teilweise ${id}: Kurve endet beim Kontostand`);
    }
    const max = JSON.parse(registry.profiles.muster_a.data[PROFILE_CASH_HISTORY_KEY]).entries;
    const credit = max.find(entry => entry.date === '2026-03-12'), before = max.filter(entry => entry.date < '2026-03-12').at(-1);
    assert(credit && credit.value > before.value, 'teilweise: Gutschrift am Verkaufstag erhöht den Verlauf');
    assertEqual(records[PROFILE_CASH_HISTORY_KEY], registry.profiles[records.rs_current_profile].data[PROFILE_CASH_HISTORY_KEY], 'teilweise: aktiver Verlauf entspricht der Registrykopie');
    // VS-3a: Seitenweg mit Stammdaten und Verkaufsbelegen; die verkauften Tranchen bleiben belegt.
    const persons = Object.entries(registry.profiles).map(([id, profile]) => ({ id, name: profile.meta.name, belongs: true, valid: true,
        values: { tagesgeld: Number(profile.data.profile_tagesgeld) } }));
    const context = { prices: JSON.parse(records.rs_daily_prices_v1), events: readReconciliationHistory(registry),
        startDate: JSON.parse(records.rs_wealth_history_start_v1).startDate, today: '2026-10-28' };
    for (const profileId of [undefined, ...persons.map(person => person.id)]) {
        const page = projectProfileWealthHistory(registry, persons, { ...context, profileId });
        const label = profileId || 'Haushalt';
        assertEqual(JSON.stringify(page.errors), '[]', `teilweise ${label}: Seitenweg ohne Fehler`);
        assert(page.metrics.status !== 'unavailable', `teilweise ${label}: Kennzahlen verfügbar`);
        assert(Number.isFinite(page.points.at(-1).total), `teilweise ${label}: Kurve endet mit bekanntem Bestand`);
    }
    assertEqual(records.profile_wealth_history_lots_v1, registry.profiles[records.rs_current_profile].data.profile_wealth_history_lots_v1, 'teilweise: aktive Stammdaten entsprechen der Registrykopie');
}
