// FR-73 Paket 2: Echtdatenprobe. Private Eingaben verlassen diesen Prozess nur als Prüfsummen, Zählwerte und Ja/Nein.
// Aufruf: node scripts/check-pfa2-backup.mjs <sicherung.json>
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = process.stdout.write.bind(process.stdout);
for (const method of ['log', 'error', 'warn', 'info', 'debug']) console[method] = () => {};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let persistence;
let checks = 0;
try {
    const { PersistenceFacade } = await import('../app/shared/persistence-facade.js');
    const { importFullPersistenceBackup } = await import('../app/shared/persistence-backup.js');
    const { buildBalanceEngineInputFromStorage } = await import('../app/balance/balance-input-storage.js');
    const { readBalancePersonStatus } = await import('../app/shared/person-data-status.js');
    const { parseCareValues, readCareValues, HOUSEHOLD_CARE_VALUES_KEY } = await import('../app/shared/household-care-values.js');
    const { projectCareValuesForYear, careDriftPercent, resolveCarePrices } = await import('../app/shared/care-prices.js');
    const { careSettingsStorage } = await import('../app/shared/care-profile-settings.js');
    const { EngineAPI } = await import('../engine/index.mjs');
    const { migrateCareFlexRecord } = await import('../app/simulator/simulator-care-flex.js');
    persistence = PersistenceFacade;
    const payload = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (!payload?.records || typeof payload.records !== 'object') throw new Error();
    checks++;
    const stored = {}, snapshots = new Map();
    persistence.resetPersistenceForTests({ name: 'pfa2-private-memory',
        async loadAll() { return { ...stored }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete stored[key]); Object.assign(stored, Object.fromEntries(upserts)); },
        async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); },
        async readSnapshot(id) { return structuredClone(snapshots.get(id)); },
        async listSnapshots() { return [...snapshots.values()]; } });
    await persistence.init({ installLifecycleHooks: false });
    const imported = await importFullPersistenceBackup(payload);
    if (!imported.ok) throw new Error();
    checks++;
    const records = await persistence.readPersistedRecords();
    const before = hash(Object.entries(records).sort(([a], [b]) => a.localeCompare(b)));
    // Nur lesender Adapter mit Zählern: Balance darf beim Lesen nichts schreiben.
    const counts = { setItem: 0, removeItem: 0 };
    const storage = { getItem: key => records[key] ?? null, setItem() { counts.setItem++; }, removeItem() { counts.removeItem++; },
        key: index => Object.keys(records)[index] ?? null, get length() { return Object.keys(records).length; } };
    const status = readBalancePersonStatus({ storage, win: null });
    const persons = status.entries?.length ?? 0;
    const careToday = (status.entries || []).filter(entry => Number(entry.data?.profile_care_grade_today) > 0).length;
    const calculation = buildBalanceEngineInputFromStorage({ storage });
    checks++;
    const result = EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState);
    if (result.error) throw new Error();
    checks++;
    const budgetReadable = Number.isFinite(result.ui?.spending?.monatlicheEntnahme) && Number.isFinite(calculation.inputData.floorBedarf);
    const careRows = calculation.careNeeds?.persons?.filter(person => person.grade > 0).length ?? 0;
    // Jahresabschluss-Entwurf der Pflegewerte: fortgeschrieben mit 2 % und dem gespeicherten Kostenanstieg, nur Schemaprüfung.
    const legacy = careSettingsStorage(storage);
    const current = readCareValues(storage);
    const prices = resolveCarePrices(current, legacy);
    const draft = projectCareValuesForYear(storage.getItem(HOUSEHOLD_CARE_VALUES_KEY), { inflationRate: 2, driftPercent: careDriftPercent(legacy),
        priceYear: (status.referenceYear || new Date().getFullYear()) + 1, legacySource: legacy });
    const schemaValid = (() => { try { parseCareValues(JSON.stringify(draft)); return true; } catch { return false; } })();
    checks++;
    // PFA-12: Zählt Flex-Altvorgaben ohne Versionsmarke (Profile im Verzeichnis, dazu ja/nein für den Live-Speicher).
    const isFlexLegacy = data => !!data && migrateCareFlexRecord(data) !== data;
    let flexLegacyProfiles = 0;
    try { flexLegacyProfiles = Object.values(JSON.parse(records.rs_profiles_v1 || '{}').profiles || {}).filter(profile => isFlexLegacy(profile?.data)).length; } catch { flexLegacyProfiles = -1; }
    const flexLegacyLive = isFlexLegacy(records);
    const after = hash(Object.entries(await persistence.readPersistedRecords()).sort(([a], [b]) => a.localeCompare(b)));
    output(JSON.stringify({ checks: ++checks, recordCount: Object.keys(records).length, persons, careToday, careRows,
        balanceReadable: budgetReadable, writesWhileReading: counts.setItem + counts.removeItem, pricesFromRecord: prices.stored,
        careValuesSchemaValid: schemaValid, flexLegacyProfiles, flexLegacyLive, draftOrigin: draft.prices.origin, recordsHash: before, recordsUnchanged: before === after }) + '\n');
    output(budgetReadable && schemaValid && counts.setItem + counts.removeItem === 0 && before === after
        ? 'lesbar, keine Schreiboperation beim Lesen, Pflegewerte-Schema gültig\n' : 'Probe nicht bestanden\n');
    if (!(budgetReadable && schemaValid && counts.setItem + counts.removeItem === 0 && before === after)) process.exitCode = 1;
} catch {
    output(JSON.stringify({ checks, failures: 1 }) + '\n');
    process.exitCode = 1;
} finally { persistence?.resetPersistenceForTests(); }
