import strict from 'node:assert/strict';
import { parseCategoryCsv, EXPENSE_CSV_CATEGORY_NEEDS } from '../app/balance/balance-expenses-csv.js';
import { computeHouseholdNeedsStats, computeYearStats } from '../app/balance/balance-expenses-metrics.js';
import { loadExpensesStoreResult, loadExpensesStore, saveExpensesStore } from '../app/balance/balance-expenses-storage.js';
import { importExpenses, requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { previewPersonExport, confirmPersonExport, previewPersonImport, importPersonFile, normalizePersonFile } from '../app/profile/profile-person-file.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { buildProbelaufTransferRecords } from '../app/shared/probelauf-records.js';
import { previewSnapshotRestore, executeSnapshotRestore } from '../app/shared/snapshot-restore.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
const same = (a, b, label) => { strict.deepEqual(a, b, label); assert(true, label); };
const csv = 'Kategorie;Betrag;Bedarf\nAlltag;-100,10; Floor \nAlltag;-20,20;fLeX\nAlltag;-10,30;Flex\nWohnen;-200;Grundbedarf\nErstattung;5,50;Floor';
const categories = parseCategoryCsv(csv), categoryNeeds = categories[EXPENSE_CSV_CATEGORY_NEEDS];
same({ ...categories }, { Alltag: -130.6, Wohnen: -200, Erstattung: 5.5 }, 'FF-1: bestehende Kategoriesummen unverändert');
same({ ...categoryNeeds }, { Alltag: { floor: -100.1, flex: -30.5 }, Wohnen: { floor: -200, flex: 0 }, Erstattung: { floor: 5.5, flex: 0 } }, 'FF-1: gleiches Paar addiert, Floor und Flex derselben Kategorie getrennt');
same(parseCategoryCsv('Bedarf;Betrag;Kategorie\nFlex;-12;Alltag')[EXPENSE_CSV_CATEGORY_NEEDS].Alltag, { floor: 0, flex: -12 }, 'FF-1: Bedarfskopf stört Kategorieerkennung nicht');
same(parseCategoryCsv('Bedarf;Kategorie;Betrag\nFloor;Alltag;12')[EXPENSE_CSV_CATEGORY_NEEDS].Alltag, { floor: 12, flex: 0 }, 'FF-1: Bedarfskopf stört Betragerkennung nicht');
same(parseCategoryCsv('Betrag;Bedarf;Kategorie\n12;Flex;Alltag')[EXPENSE_CSV_CATEGORY_NEEDS].Alltag.flex, 12, 'FF-1: andere Spaltenreihenfolge');
same(parseCategoryCsv('Kategorie;Betrag\nAlt;-12')[EXPENSE_CSV_CATEGORY_NEEDS], undefined, 'FF-1: ohne Spalte keine Aufteilung');
for (const need of ['', 'Luxus']) {
    strict.throws(() => parseCategoryCsv(`Kategorie;Betrag;Bedarf\nAlltag;-1;Floor\n\nAlltag;-2;${need}`), error => error.code === 'expenses_csv_invalid_rows' && error.message.includes('Zeile 4') && error.message.includes(need ? 'unbekannt' : 'Bedarf fehlt'));
    assert(true, 'FF-1: ungültiger Bedarf bricht mit Originalzeile ab');
}
const makeStore = entry => ({ version: 1, activeYear: 2026, years: { 2026: { months: { 1: { profiles: { a: entry } } } } } });
let raw = JSON.stringify(makeStore({ categories, categoryNeeds }));
const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
const loaded = loadExpensesStore(storage); saveExpensesStore(loaded, storage);
same(loadExpensesStore(storage).years[2026].months[1].profiles.a.categoryNeeds, JSON.parse(JSON.stringify(categoryNeeds)), 'FF-1: Store-Roundtrip');
for (const invalid of [{ Alltag: { floor: 0, flex: 1 } }, { ...categoryNeeds, Alltag: { floor: '100', flex: 0 } }, null]) {
    raw = JSON.stringify(makeStore({ categories, categoryNeeds: invalid }));
    const result = loadExpensesStoreResult(storage);
    same([result.status, result.diagnostics.length, result.store.years[2026].months[1].profiles.a.categoryNeeds], ['ok', 1, invalid], 'FF-1: ungültiges Feld bleibt mit Diagnose erhalten');
    same(result.store.years[2026].months[1].profiles.a.categories, JSON.parse(JSON.stringify(categories)), 'FF-1: fehlerhafte Aufteilung erhält Summen');
    assert(validatePersistenceDomainRecords({ balance_expenses_v1: raw }).ok, 'FF-1: Sicherungsvalidator erhält ungültige Aufteilung');
}
for (const legacy of [{ years: { 2026: { months: { 1: { profiles: { a: { categories: { Alt: '-12.30' } } } } } } } }, { version: '1', years: {} }]) {
    raw = JSON.stringify(legacy); const result = loadExpensesStoreResult(storage);
    same(result.status, 'ok', 'FF-1: alter Record ohne Aufteilung lädt');
    same(result.store.years, legacy.years, 'FF-1: Altjahre unverändert');
}
const entry = (floor, flex, planned = 0) => ({ categories: { Alltag: -(floor + flex) }, categoryNeeds: { Alltag: { floor: -floor, flex: -flex } }, ...(planned ? { plannedExpenses: [{ id: 'auto', scopeKey: 'household:a,b', month: '2026-01', label: 'Auto', amount: planned }] } : {}) });
const yearData = { months: {
    1: { profiles: { a: entry(800, 200, 200), b: entry(100, 100) } },
    2: { profiles: { a: entry(400, 100, 250) } },
    3: { profiles: { a: entry(100, 100), b: { categories: { Alt: -400 } } } },
    4: { profiles: { a: entry(0, 0) } },
    5: { profiles: {} }
} };
same(computeHouseholdNeedsStats({ yearData: { months: { 1: { profiles: { a: entry(400, 100, 250) } } } }, profileIds: ['a'] }).months[0].floor, 250, 'FF-1: Rest einer Geplanten Ausgabe geht vom Floor ab');
const before = JSON.stringify(yearData), stats = computeHouseholdNeedsStats({ yearData });
same(stats.months[0], { month: 1, withBreakdown: true, floor: 900, flex: 100, total: 1000, planned: 200 }, 'FF-1: Haushalt summiert Personen und zieht Flex zuerst ab');
same([stats.months[1].floor, stats.months[1].flex], [null, null], 'FF-1b: unvollständiger Haushalt ohne Monatsaufteilung');
same([stats.months[2].withBreakdown, stats.months[2].floor, stats.months[2].total], [false, null, 600], 'FF-1: eine Person ohne Aufteilung macht den Haushaltsmonat ungeteilt');
same([stats.monthsWithBreakdown, stats.monthsWithoutBreakdown], [1, 1], 'FF-1b: vollständige positive Monate mit/ohne Aufteilung');
same(stats.annualForecast, { floor: 10800, flex: 1200, total: 9600 }, 'FF-1b: Floor/Flex aus aufgeteilten Monaten, Gesamt aus allen gezählten Monaten');
same(computeHouseholdNeedsStats({ yearData: {} }).annualForecast.floor, null, 'FF-1: ohne Monate kein erfundener Nullwert');
same(JSON.stringify(yearData), before, 'FF-1: Rechenkern schreibt nichts');
same(computeYearStats({ yearData: { months: { 1: { profiles: { a: { categories: { x: 100 } } } }, 2: { profiles: { a: { categories: { x: 200 } } } }, 3: { profiles: { a: { categories: { x: 900 } } } } } } }).annualForecast, 4800, 'FF-1: Gesamthochrechnung nutzt Mittelwert auch bei großem Einzelposten');
const doc = new MockDocument(), walk = node => [node, ...node.children.flatMap(walk)];
const createElement = doc.createElement.bind(doc);
doc.createElement = tag => { const node = createElement(tag); node.focus = () => { doc.activeElement = node; }; return node; };
const preview = requestExpensesPreview([{ profileId: 'a', year: 2026, month: 1, categories, categoryNeeds, total: 325.1, replacing: true }], { doc });
const dialog = walk(doc.body).find(node => node.id === 'expensesImportPreview');
assert(dialog.textContent.includes('Floor und Flex') && dialog.textContent.includes('Vorhandene Monatsdaten werden ersetzt.'), 'FF-1: Vorschau erklärt Aufteilung und Reimport');
same(walk(dialog).filter(node => node.tagName === 'TD').length, 12, 'FF-1: Vorschau enthält je Kategorie und Summe drei Betragsspalten');
walk(dialog).find(node => Object.hasOwn(node.dataset, 'expensesPreviewCancel')).dispatchEvent({ type: 'click' });
same(await preview, false, 'FF-1: Vorschau abbrechbar');
const records = createMusterHaushaltRecords('2026-10-30'), snapshots = new Map();
const init = async () => {
    P.resetPersistenceForTests({ name: 'FF-1', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); Object.assign(records, Object.fromEntries(upserts)); },
        async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); },
        async readSnapshot(id) { return structuredClone(snapshots.get(id)); }, async listSnapshots() { return [...snapshots.values()]; } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
};
try {
    await init(); const id = records.rs_current_profile;
    const options = { storage: persistenceStorage, controller: null, win: null, confirm: async () => true };
    const target = text => ({ year: 2026, month: 10, profileId: id, text: async () => text });
    same((await importExpenses({ ...options, targets: [target(csv)] })).status, 'saved', 'FF-1: echter Import speichert Aufteilung');
    const saved = loadExpensesStore(persistenceStorage).years[2026].months[10].profiles[id];
    same(saved.categoryNeeds, JSON.parse(JSON.stringify(categoryNeeds)), 'FF-1: Importfeld dauerhaft vorhanden');
    const baseline = records.balance_expenses_v1;
    await strict.rejects(importExpenses({ ...options, targets: [target('Kategorie;Betrag;Bedarf\nAlltag;-1;falsch')] }), error => error.code === 'expenses_csv_invalid_rows');
    same(records.balance_expenses_v1, baseline, 'FF-1: fehlerhafte CSV schreibt nichts');
    const backup = buildFullPersistenceBackup({ storage: P });
    const imported = await importFullPersistenceBackup(backup);
    assert(imported.ok, 'FF-1: Vollsicherung importierbar');
    same(records.balance_expenses_v1, baseline, 'FF-1: Vollsicherung roundtrip bytegleich');
    same(Object.fromEntries(Object.entries(records).filter(([key]) => isProbelaufRecordKey(key))).balance_expenses_v1, baseline, 'FF-1: Spielbereich-Kopie enthält unveränderte Aufteilung');
    same(buildProbelaufTransferRecords(records, records).balance_expenses_v1, baseline, 'FF-1: Spielbereich-Übernahme erhält Aufteilung');
    assert([...snapshots.values()].some(point => point.records?.balance_expenses_v1 === baseline), 'FF-1: Wiederherstellungspunkt enthält Aufteilung');
    const file = await confirmPersonExport(await previewPersonExport(id));
    same(Object.hasOwn(file, 'expenses'), false, 'FF-1b: Personendatei enthält keine Ausgaben');
    normalizePersonFile({ ...file, expenses: { version: 2 } });
    const plan = await previewPersonImport(file), result = await importPersonFile(plan);
    same(result.status, 'imported', 'FF-1: Personenimport bestätigt');
    same(records.balance_expenses_v1, baseline, 'FF-1b: Personen-Roundtrip erhält Ausgabenstore bytegleich');
    same((await importExpenses({ ...options, targets: [target('Kategorie;Betrag\nAlltag;-12')] })).status, 'saved', 'FF-1: Reimport ohne Spalte');
    same(loadExpensesStore(persistenceStorage).years[2026].months[10].profiles[id].categoryNeeds, undefined, 'FF-1: Reimport entfernt alte Aufteilung');
    const point = [...snapshots.values()].find(point => point.records?.balance_expenses_v1 === baseline);
    const restore = await executeSnapshotRestore(await previewSnapshotRestore(point.id), { reload: () => true });
    same(restore.status, 'restored', 'FF-1: Wiederherstellungspunkt zurückgeholt');
    same(records.balance_expenses_v1, baseline, 'FF-1: Wiederherstellung erhält Aufteilung bytegleich');
} finally { P.resetPersistenceForTests(); }
