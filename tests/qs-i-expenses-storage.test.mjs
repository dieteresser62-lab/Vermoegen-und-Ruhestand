import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { EXPENSES_STORAGE_KEY as KEY, loadExpensesStoreResult, saveExpensesStore, loadExpensesStore,
    resetCorruptExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { importExpenses } from '../app/balance/balance-expenses-import.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { PersistenceFacade as p, persistenceStorage } from '../app/shared/persistence-facade.js';

const store = value => ({ version: 1, activeYear: 2026, years: { 2020: { months: { 1: { profiles: { muster_a: { categories: { Alltag: value } } } } } } } });
for (const value of [null, false, {}, 'Infinity', '-1200', -1200]) {
    const raw = JSON.stringify(store(value)), records = { [KEY]: raw };
    const storage = { getItem: key => records[key] ?? null, setItem: (key, value) => { records[key] = value; } };
    const valid = ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value));
    assertEqual(loadExpensesStoreResult(storage).status, valid ? 'ok' : 'corrupt', 'QS-I 6: Ladegrenze erkennt unzulässige Kategoriebeträge');
    assertEqual(validatePersistenceDomainRecords(records).ok, valid, 'QS-I 6: Restore verwendet denselben Gültigkeitsvertrag');
    if (!valid) {
        const corruption = loadExpensesStoreResult(storage);
        resetCorruptExpensesStore(corruption, { storage, rawPreserved: true });
        assertEqual(loadExpensesStoreResult(storage).status, 'ok', 'QS-I 6: ungültige Altstände haben den vorhandenen Recoveryweg');
    }
}
const sample = balanceStorageFixture('Einzelprofil');
const originalRaw = JSON.stringify(store('-1200'), null, 2) + '\n';
const backend = new Map(Object.entries({ ...sample.records, [KEY]: originalRaw }));
let fail = true;
p.resetPersistenceForTests({ name: 'synthetic', loadAll: async () => Object.fromEntries(backend),
    saveBatch: async ({ upserts, deletes }) => {
        if (fail && upserts.some(([key]) => key === KEY)) { fail = false; throw new Error('WRITE_FAILED'); }
        deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value));
    } });
await p.init({ installLifecycleHooks: false });
const options = { storage: persistenceStorage, controller: null, win: null,
    targets: [{ year: 2026, month: 4, profileId: 'muster_a', text: async () => 'Kategorie;Betrag\nAlltag;-1200' }], confirm: async () => true };
const failed = await importExpenses(options);
assertEqual(failed.status, 'partial', 'QS-I 6: Backendfehler meldet fehlgeschlagenen Import');
assertEqual(failed.results[0].ok, false, 'QS-I 6: Backendfehler bestätigt den Kandidaten nicht');
assertEqual(persistenceStorage.getItem(KEY), originalRaw, 'QS-I 6: Rücknahme stellt Originalbytes im Cache wieder her');
await p.flush();
assertEqual(backend.get(KEY), originalRaw, 'QS-I 6: späterer Flush speichert keinen fehlgeschlagenen Kandidaten');
assertEqual((await importExpenses(options)).status, 'saved', 'QS-I 6: gültiger Import anderer Jahre trotz gültigem Altformat');
assertEqual(loadExpensesStore().years[2020].months[1].profiles.muster_a.categories.Alltag, '-1200', 'QS-I 6: Altformat bleibt erhalten');
const before = persistenceStorage.getItem(KEY), candidate = loadExpensesStore();
candidate.years[2026].months[4].profiles.muster_a.categories.Alltag = null;
let rejected = false;
try { saveExpensesStore(candidate); } catch { rejected = true; }
assert(rejected, 'QS-I 6: neue ungültige Records werden vor dem Speichern abgewiesen');
assertEqual(persistenceStorage.getItem(KEY), before, 'QS-I 6: ungültiger Kandidat verändert keine Bytes');
p.resetPersistenceRuntimeForTests();
