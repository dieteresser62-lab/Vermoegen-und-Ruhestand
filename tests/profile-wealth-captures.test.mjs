import { prepareWealthCapture, projectWealthCaptures } from '../app/profile/profile-wealth-captures.js';
import { WEALTH_CAPTURES_KEY, readWealthCaptures, assertWealthCaptures, CAPTURE_AMOUNT_FIELDS } from '../types/wealth-capture-contract.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry, assertWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { isAllowedSnapshotCaptureKey, isSnapshotGlobalDomainKey, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { createBalanceWealthHistoryService } from '../app/balance/balance-wealth-history.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { switchProfile } from '../app/profile/profile-storage.js';

const stateKey = CONFIG.STORAGE.LS_KEY;
const values = { tagesgeld: 100, geldmarktEtf: 200, depotwertAlt: 300, depotwertNeu: 450, goldWert: 50, bondsWert: 50 };
const oldA = createManualWealthHistoryEntry(values, '2026-03-01');
const oldB = { ...createManualWealthHistoryEntry({ ...values, tagesgeld: 200 }, '2026-03-01'), capturedAt: '2026-03-01T13:00:00Z' };
const lot = (type, category, value) => ({ schemaVersion: 2, trancheId: type, name: 'Muster', type, category,
    shares: value / 10, purchasePrice: 8, currentPrice: 10, purchaseDate: '2026-01-02', tqf: category === 'equity' ? 0.3 : 0, taxExempt: false });
const registry = { version: 1, profiles: {
    a: { meta: { name: 'Max Mustermann' }, data: { profile_tagesgeld: '100',
        depot_tranchen: JSON.stringify([lot('aktien_alt', 'equity', 300), lot('aktien_neu', 'equity', 400),
            lot('geldmarkt', 'money_market', 200), lot('gold', 'gold', 50), lot('anleihe', 'bonds', 50)]),
        [stateKey]: JSON.stringify({ inputs: values, wealthHistory: { schemaVersion: 1, entries: [oldA] } }) } },
    b: { meta: { name: 'Erika Mustermann' }, data: { profile_tagesgeld: '10',
        [stateKey]: JSON.stringify({ inputs: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v / 10])), wealthHistory: { schemaVersion: 1, entries: [oldB] } }) } },
    outside: { meta: { belongsToHousehold: false }, data: {} }
} };
let raw = null;
const storage = { getItem: key => key === WEALTH_CAPTURES_KEY ? raw : registry.profiles.a.data[key] ?? null };
const identity = createManualWealthHistoryEntry(values, '2026-10-15');
const before = JSON.stringify(registry);
raw = prepareWealthCapture({ storage, registry, activeId: 'a', entry: identity, inputData: {}, now: () => new Date('2026-10-15T12:00:00Z') });
const capture = readWealthCaptures(raw).captures[0];
assertEqual(JSON.stringify(Object.keys(capture.people)), JSON.stringify(['a', 'b']), 'Genau die Haushaltsmitglieder erhalten einen Personenstand');
assertEqual(capture.people.a.total, 1100, 'Max: alle Tranchen und Tagesgeld, Anleihen genau einmal');
assertEqual(capture.people.b.total, 110, 'Erika: nur eigene Werte aus Altbestand ohne Tranchenliste');
assertEqual(capture.household.total, 1210, 'Haushalt entspricht unabhängig berechneter Summe');
assertEqual(capture.people.a.goldWert, 50, 'Gold bleibt als eigene Anlageform erhalten');
assertEqual(capture.people.a.anleihen, 50, 'Anleihen bleiben separat');
assertEqual(capture.people.a.depotwertNeu, 400, 'Aktien-Neudepot enthält keine doppelt gezählten Anleihen');
for (const field of CAPTURE_AMOUNT_FIELDS) assertClose(capture.household[field], capture.people.a[field] + capture.people.b[field], 1e-8, `${field}: Personen ergeben Haushalt`);
assertEqual(JSON.stringify(registry), before, 'Vorbereitung ändert weder Altlisten noch Profilrecords');
for (const id of ['a', 'b']) {
    const projected = projectWealthCaptures(registry, raw, id);
    assertEqual(projected.wealthHistory.entries.length, 1, 'Person enthält nur den belegten neuen Personenstand');
    assertEqual(projected.wealthHistory.entries[0].total, capture.people[id].total, 'Personenkennzahl liest eigene Summe');
    assert(projected.hasLegacy, 'Ältere Haushaltsstände werden im Hinweis erklärt');
}
let household = projectWealthCaptures(registry, raw);
assertEqual(household.wealthHistory.entries.length, 2, 'Haushalt vereinigt Altbestand und neue Erfassung');
assertEqual(household.wealthHistory.entries.find(entry => entry.asOf === '2026-03-01').tagesgeld, 200, 'Ohne vergleichbare Zeitstempel gewinnt der später gespeicherte Altstand');
assertEqual(household.conflicts.join(','), '2026-03-01', 'Abweichung wird für das Infofeld mitgegeben');
assertEqual(household.conflictDetails[0].fields.find(item => item.field === 'tagesgeld').values.join(','), '100,200', 'Infofeld erhält auch die widersprüchlichen Beträge');
assertEqual(household.conflictDetails[0].selected.tagesgeld, 200, 'Infofeld nennt die angezeigte Auswahl');
const timed = structuredClone(registry);
const timedState = JSON.parse(timed.profiles.a.data[stateKey]); timedState.wealthHistory.entries[0].capturedAt = '2026-03-01T14:00:00Z';
timed.profiles.a.data[stateKey] = JSON.stringify(timedState);
assertEqual(projectWealthCaptures(timed, null).wealthHistory.entries[0].tagesgeld, 100, 'Bei vorhandenen Zeitstempeln gewinnt die zuletzt erfasste Version');
const corrupt = structuredClone(JSON.parse(raw)); corrupt.captures[0].people.b.total++;
let rejected = false; try { assertWealthCaptures(corrupt); } catch { rejected = true; }
assert(rejected, 'Beschädigte Personenaufteilung wird abgewiesen');
assertEqual(projectWealthCaptures(registry, null, 'b').wealthHistory.entries.length, 0, 'Altbestand erzeugt keine rückwirkenden Personenstände');
const oldBytes = JSON.stringify(oldA); assertWealthHistoryEntry(oldA); assertEqual(JSON.stringify(oldA), oldBytes, 'Alte Haushaltsform bleibt bytegleich gültig');
const annual = createAnnualWealthHistoryEntry(values, 2026);
raw = prepareWealthCapture({ storage, registry, activeId: 'a', entry: annual, inputData: {} });
const annualBefore = raw;
assertEqual(prepareWealthCapture({ storage, registry, activeId: 'a', entry: annual, inputData: {} }), annualBefore, 'Jahreswiederholung erhält den bereits bestätigten Personen- und Haushaltsstand');
assert(isAllowedSnapshotCaptureKey(WEALTH_CAPTURES_KEY) && isSnapshotGlobalDomainKey(WEALTH_CAPTURES_KEY)
    && isProbelaufRecordKey(WEALTH_CAPTURES_KEY), 'Gemeinsamer Record gehört zu Snapshot, Restore und Spielbereich');

const records = createMusterHaushaltRecords('2026-10-15');
records[WEALTH_CAPTURES_KEY] = raw;
const backup = buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records }) } });
assertEqual(normalizeFullPersistenceBackup(backup).backup.records[WEALTH_CAPTURES_KEY], raw, 'Vollsicherung enthält die neue Personenaufteilung bytegleich');
assert(validatePersistenceDomainRecords(records).ok, 'Altbestand und neue gemeinsame Stände sind zusammen wiederherstellbar');
const badRecords = { ...records, [WEALTH_CAPTURES_KEY]: JSON.stringify(corrupt) };
assert(!validatePersistenceDomainRecords(badRecords).ok, 'Restore lehnt beschädigte gemeinsame Stände vor dem Schreiben ab');

for (const kind of ['localstorage', 'indexeddb', 'tauri']) {
    const initial = createMusterHaushaltRecords('2026-10-15');
    const f = await playFixture(kind, initial);
    try {
        let controller = await f.boot();
        const restored = await importFullPersistenceBackup(backup, { persistence: P, confirm: async () => true });
        assert(restored.ok, `${kind}: Vollsicherung lässt sich wiederherstellen`);
        assertEqual(P.getItemSync(WEALTH_CAPTURES_KEY), raw, `${kind}: Wiederherstellung erhält alle Personenstände`);
        await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
        const registry = JSON.parse(P.getItemSync('rs_profiles_v1'));
        const service = createBalanceWealthHistoryService({ storage: persistenceStorage, persistence: P, guard: null,
            loadState: () => JSON.parse(P.getItemSync(stateKey)), loadRegistry: () => JSON.parse(P.getItemSync('rs_profiles_v1')) });
        const inputData = JSON.parse(registry.profiles.muster_a.data[stateKey]).inputs;
        await service.captureManual({ result: { ok: true, inputData }, asOf: '2026-10-16' });
        const capturedBeforeSwitch = P.getItemSync(WEALTH_CAPTURES_KEY);
        switchProfile('muster_b'); await P.flush();
        assertEqual(P.getItemSync(WEALTH_CAPTURES_KEY), capturedBeforeSwitch, `${kind}: Profilwechsel erhält den gemeinsamen Record bytegleich`);
        await service.captureManual({ result: { ok: true, inputData: JSON.parse(registry.profiles.muster_b.data[stateKey]).inputs }, asOf: '2026-10-16' });
        const playRaw = P.getItemSync(WEALTH_CAPTURES_KEY);
        const personCapture = readWealthCaptures(playRaw).captures.find(capture => capture.household.asOf === '2026-10-16');
        assertEqual(Object.keys(personCapture.people).length, 2, `${kind}: Erfassen bei aktiver Person B speichert wieder alle Personen`);
        assertClose(personCapture.household.total, personCapture.people.muster_a.total + personCapture.people.muster_b.total, 1e-8, `${kind}: Erfassen bei B ergibt weiterhin den Haushalt`);
        assertEqual((await P.readRealRecords())[WEALTH_CAPTURES_KEY], raw, `${kind}: Erfassen im Spielbereich verändert keine echten Personenstände`);
        const result = await controller.end(async () => ({ action: 'transfer', review: await controller.readEndReview() }));
        assertEqual(result.status, 'reloaded', `${kind}: Übernehmen bestätigt den Spielbereich`);
        await f.boot();
        assertEqual(P.getItemSync(WEALTH_CAPTURES_KEY), playRaw, `${kind}: Übernehmen erhält neue Haushalt- und Personenstände bytegleich`);
    } finally { P.resetPersistenceRuntimeForTests(); }
}
