// Private Eingaben verlassen diesen Prozess nur als Prüfsummen und Zählwerte.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = process.stdout.write.bind(process.stdout);
for (const method of ['log', 'error', 'warn', 'info', 'debug']) console[method] = () => {};
const hash = records => createHash('sha256').update(JSON.stringify(Object.entries(records)
    .sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
let persistence;
let checks = 0;
try {
    const { PersistenceFacade } = await import('../app/shared/persistence-facade.js');
    const { importFullPersistenceBackup } = await import('../app/shared/persistence-backup.js');
    const { BACKUP_DELIVERY_KEY } = await import('../app/data/data-backup-summary.js');
    persistence = PersistenceFacade;
    const payload = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (!payload?.records || typeof payload.records !== 'object') throw new Error();
    checks++;
    const stored = {}, snapshots = new Map();
    persistence.resetPersistenceForTests({ name: 'hs1-private-memory',
        async loadAll() { return { ...stored }; },
        async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => delete stored[key]); Object.assign(stored, Object.fromEntries(upserts));
        },
        async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); },
        async readSnapshot(id) { return structuredClone(snapshots.get(id)); },
        async listSnapshots() { return [...snapshots.values()]; } });
    await persistence.init({ installLifecycleHooks: false });
    const imported = await importFullPersistenceBackup(payload);
    if (!imported.ok) throw new Error();
    checks++;
    const read = await persistence.readPersistedRecords();
    // Ausschließlich Zählwerte und Prüfsummen; auch Loaderdiagnosen nie ausgeben.
    const { loadExpensesStoreResult } = await import('../app/balance/balance-expenses-storage.js');
    const { hasExpenseImport, hasCategoryNeeds, computeSpent, expenseConventions } = await import('../app/balance/balance-expenses-metrics.js');
    const loaded = loadExpensesStoreResult({ getItem: key => read[key] ?? null });
    if (loaded.status === 'corrupt') throw new Error();
    const entries = store => Object.values(store?.years || {}).flatMap(year => {
        const directions = expenseConventions(year);
        return Object.values(year.months || {}).flatMap(month => Object.entries(month.profiles || {})
            .filter(([, entry]) => hasExpenseImport(entry))
            .map(([id, entry]) => ({ entry, direction: directions.get(id) })));
    });
    const oldEntries = entries(payload.records.balance_expenses_v1 ? JSON.parse(payload.records.balance_expenses_v1) : {});
    const newEntries = entries(loaded.store);
    const sumsHash = values => createHash('sha256').update(JSON.stringify(values.map(({ entry, direction }) => computeSpent(entry.categories, direction)))).digest('hex');
    const oldSumsHash = sumsHash(oldEntries), newSumsHash = sumsHash(newEntries);
    const withBreakdownCount = newEntries.filter(({ entry }) => hasCategoryNeeds(entry)).length;
    const withoutBreakdownCount = newEntries.length - withBreakdownCount;
    // Der lokale Sicherungsstatus entsteht erst bei der Übernahme. Verglichen werden die Fachrecords der Datei.
    const oldRecords = { ...payload.records };
    delete oldRecords[BACKUP_DELIVERY_KEY];
    delete read[BACKUP_DELIVERY_KEY];
    const oldHash = hash(oldRecords), newHash = hash(read);
    const oldCount = Object.keys(oldRecords).length, newCount = Object.keys(read).length;
    const equal = oldHash === newHash && oldCount === newCount && oldSumsHash === newSumsHash && oldEntries.length === newEntries.length;
    output(JSON.stringify({ checks: ++checks, oldCount, newCount, oldHash, newHash,
        oldExpenseCount: oldEntries.length, newExpenseCount: newEntries.length, withBreakdownCount, withoutBreakdownCount, oldSumsHash, newSumsHash }) + '\n');
    output(equal ? 'alt = neu\n' : 'alt != neu\n');
    if (!equal) process.exitCode = 1;
} catch {
    output(JSON.stringify({ checks, failures: 1 }) + '\n');
    process.exitCode = 1;
} finally { persistence?.resetPersistenceForTests(); }
