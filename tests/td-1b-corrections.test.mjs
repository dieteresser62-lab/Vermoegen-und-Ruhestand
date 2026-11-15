import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { memoryStorage, prepareTrancheDetailWrite, commitSaleFlowWrite, openHouseholdRegistry } from '../app/tranches/household-sale-writer.js';
import { correctedTranche, trancheHistory, trancheDetailFigures } from '../app/tranches/tranche-detail-model.js';
import { renderTrancheDetail } from '../app/tranches/tranche-detail-view.js';
import { loadTranchesFromStorage } from '../app/tranches/tranchen-manager-state.js';
import { normalizeTranche, normalizeTrancheCollection, TRANCHE_FIELD_GROUPS } from '../types/tranche-contract.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { previewSnapshotRestore, executeSnapshotRestore } from '../app/shared/snapshot-restore.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';

const day = '2026-11-15', profileId = 'muster_martin';
setAppTestDate(day);
const source = createMusterHaushaltRecords(day, 'martin-petra', 'grund');
const initial = JSON.parse(source.depot_tranchen).find(lot => lot.type === 'aktien_neu');
const trancheId = initial.trancheId;
const original = { ...initial, shares: 3460.931, purchasePrice: 300000 / 3460.931, purchaseDate: '2020-05-18' };
const recordsWith = tranche => {
    const records = { ...source }, registry = JSON.parse(records.rs_profiles_v1);
    const lots = JSON.parse(records.depot_tranchen).map(lot => lot.trancheId === trancheId ? tranche : lot);
    records.depot_tranchen = JSON.stringify(lots);
    registry.profiles[profileId].data.depot_tranchen = records.depot_tranchen;
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
};
const store = records => {
    const storage = memoryStorage(records);
    Object.defineProperty(storage, 'length', { get: () => Object.keys(storage.copy).length });
    storage.key = i => Object.keys(storage.copy)[i] || null;
    return storage;
};
const lot = storage => loadTranchesFromStorage(storage).tranches.find(item => item.trancheId === trancheId);
const write = async (storage, shares, reason = 'depotauszug', time = '2026-11-15T12:00:00.000Z') => {
    const tranche = correctedTranche(lot(storage), shares, reason);
    const prepared = await prepareTrancheDetailWrite({ storage, profileId, now: new Date(time), tranche, correction: true, correctionReason: reason });
    for (const [key, value] of Object.entries(prepared.records)) storage.setItem(key, value);
    return lot(storage);
};
function shown(history) {
    const element = () => ({ children: [], dataset: {}, textContent: '', append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = [...items]; }, setAttribute() {}, addEventListener() {} });
    const list = element(), doc = { createElement: element, getElementById: id => id === 'trancheHistoryList' ? list : null };
    renderTrancheDetail(doc, { tranche: original, personName: 'Martin', history, deletion: { allowed: true, reason: '' } });
    const text = node => [node.textContent, ...node.children.map(text)].filter(Boolean).join(' · ');
    return list.children.map(text);
}
const history = (tranche, records = [], correctedAt = null) => trancheHistory({ tranche, profileId, records, correctedAt });

// Zwei echte Schreibvorbereitungen bewahren den ursprünglichen Kauf und die Listenreihenfolge auch am selben Tag.
const storage = store(recordsWith(original));
await write(storage, 50);
const corrected = await write(storage, 55);
assertEqual(corrected.correctionHistory.length, 2, 'Jeder bestätigte Korrekturweg hängt an');
assertEqual(corrected.correctionHistory[0].at, '2026-11-15T12:00:00.000Z', 'Vollständiger ISO-Zeitstempel');
const rows = history(corrected), texts = shown(rows);
assert(texts[0].includes('von 50 auf 55, laut Depotauszug'), 'Zuletzt angehängte Korrektur zuerst');
assert(texts[1].includes('von 3.460,931 auf 50, laut Depotauszug'), 'Erste Korrektur mit altem Wert');
assert(!texts[0].includes('je Stück'), 'Depotauszug nennt keinen Preis');
assert(texts[2].includes('Kauf · 18.05.2020 · 3.460,931 Stück × 86,68 € · Einstand 300.000 €'), 'Kauf mit ursprünglichen Werten und ungerundetem Kaufpreis');
assertEqual(trancheDetailFigures(corrected).costBasis, 55 * original.purchasePrice, 'Einstand des aktuellen Bestands bleibt unverändert berechnet');
assertEqual(openHouseholdRegistry(storage).registry.profiles[profileId].data.depot_tranchen, storage.getItem('depot_tranchen'), 'Registry führt die Liste mit');
await write(storage, 55);
assertEqual(lot(storage).correctionHistory.length, 2, 'Gleiche Stückzahl erzeugt keinen Eintrag');
const edited = await prepareTrancheDetailWrite({ storage, profileId, tranche: { ...lot(storage), name: 'Umbenannt', ticker: 'NEU', purchasePrice: 90, purchaseDate: '2021-01-01' } });
assertEqual(JSON.stringify(JSON.parse(edited.records.depot_tranchen).find(item => item.trancheId === trancheId).correctionHistory), JSON.stringify(corrected.correctionHistory), 'Angaben ändern keinen Korrektureintrag');

// Split und Kaufbelegvorrang.
const splitStorage = store(recordsWith({ ...original, shares: 1250, purchasePrice: 52.4 }));
const split = await write(splitStorage, 2500, 'split');
assertEqual(split.purchasePrice, 26.2, 'Splitpreis ungerundet umgerechnet');
assertEqual(split.correctionHistory[0].purchasePriceBefore, 52.4, 'Alter Splitpreis gespeichert');
assert(shown(history(split))[0].includes('von 1.250 auf 2.500, Aktiensplit · 26,20 € je Stück'), 'Split nennt neuen Preis');
const receipt = { profileId, trancheId, eventType: 'buy_reconciled', actionId: 'kauf', executedAt: '2020-05-18', actual: { sharesBought: 1250, netCashDebited: 65500 } };
const receiptBuy = history(split, [receipt]).find(row => row.kind === 'buy');
assertEqual(`${receiptBuy.shares}/${receiptBuy.amount}`, '1250/65500', 'Kaufbeleg behält seine Werte');
const sale = (date, shares, reconciledAt) => ({ profileId, trancheId, eventType: 'sale_reconciled', executedAt: date, reconciledAt, actual: { sharesSold: shares, grossProceeds: shares * 100, netProceeds: shares * 100 } });
const sales = [sale('2026-11-14', 10), sale(day, 3, '2026-11-15T11:00:00.000Z'), sale(day, 7, '2026-11-15T13:00:00.000Z'), sale('2026-11-16', 20)];
assertEqual(history(split, sales).find(row => row.kind === 'buy').shares, 1263, 'Nur Verkäufe vor erster Korrektur zurückzählen');
assertEqual(history(original, sales).find(row => row.kind === 'buy').shares, original.shares + 40, 'Ohne Korrektur bestehende Verkaufsrückrechnung');
const previousZone = process.env.TZ;
try {
    process.env.TZ = 'Europe/Berlin';
    const atMidnight = { ...split, correctionHistory: [{ ...split.correctionHistory[0], at: '2026-11-15T23:30:00.000Z' }] };
    assert(shown(history(atMidnight))[0].includes('16.11.2026'), 'ISO-Zeitpunkt zeigt den lokalen Korrekturtag');
    assertEqual(history(atMidnight, [sale('2026-11-15', 10)]).find(row => row.kind === 'buy').shares, 1260, 'Verkaufsgrenze verwendet denselben lokalen Tag');
} finally {
    if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone;
}

// Alte Korrektur bleibt unbekannt, auch wenn danach neue Einträge entstehen und manualCorrectionAt überschrieben wird.
const legacy = store(recordsWith(original));
const registry = JSON.parse(legacy.getItem('rs_profiles_v1'));
const wealth = JSON.parse(registry.profiles[profileId].data.profile_wealth_history_lots_v1);
wealth.lots[trancheId].manualCorrectionAt = '2026-10-23';
registry.profiles[profileId].data.profile_wealth_history_lots_v1 = JSON.stringify(wealth);
legacy.setItem('profile_wealth_history_lots_v1', JSON.stringify(wealth));
legacy.setItem('rs_profiles_v1', JSON.stringify(registry));
const oldText = shown(history(original, [], '2026-10-23'))[0];
assert(oldText.includes('86,68 € je Stück') && !oldText.includes('Einstand') && !oldText.includes('3.460,931'), 'Altkauf ohne erfundene Stücke und Einstand');
assert(oldText.includes('Stückzahl vor der Korrektur am 23.10.2026 nicht gespeichert'), 'Hinweis direkt unter Kauf');
const later = await write(legacy, 50);
assertEqual(later.legacyCorrectionAt, '2026-10-23', 'Altdatum vor Überschreiben bewahrt');
assert(shown(history(later)).at(-1).includes('23.10.2026 nicht gespeichert'), 'Althinweis nach neuer Korrektur erhalten');
assertEqual(history(later).filter(row => row.kind === 'correction').length, 1, 'Neue Korrektur zusätzlich sichtbar');

// Lesen und Normalisieren schreibt nie; Engineprojektion ist mit und ohne Metadaten bytegleich.
let writes = 0;
const readOnly = { getItem: key => storage.getItem(key), setItem() { writes++; } };
const loaded = loadTranchesFromStorage(readOnly);
history(loaded.tranches.find(item => item.trancheId === trancheId));
assertEqual(writes, 0, 'Zählendes setItem bleibt beim Lesen unberührt');
assert(TRANCHE_FIELD_GROUPS.persisted.includes('correctionHistory'), 'Feldgruppe führt Verlauf');
const withoutHistory = { ...corrected }; delete withoutHistory.correctionHistory;
assertEqual(JSON.stringify(normalizeTranche(corrected, { mode: 'engine' })), JSON.stringify(normalizeTranche(withoutHistory, { mode: 'engine' })), 'Engine ignoriert Verlaufsfeld bytegleich');
assertEqual((normalizeTranche(withoutHistory).correctionHistory || []).length, 0, 'Fehlend heißt leer');
assert(!('correctionHistory' in normalizeTranche(withoutHistory)), 'Altdaten bekommen kein neues Leerfeld');
for (const bad of [null, {}, [{ ...corrected.correctionHistory[0], at: '2026-11-15' }], [{ ...corrected.correctionHistory[0], reason: 'anderes' }], [{ ...corrected.correctionHistory[0], sharesBefore: -1 }], [{ ...corrected.correctionHistory[0], purchasePriceAfter: Infinity }]]) {
    let rejected = false;
    try { normalizeTrancheCollection([{ ...corrected, correctionHistory: bad }]); } catch (error) { rejected = error.errors.some(item => item.field === 'correctionHistory'); }
    assert(rejected, 'Persistenz lehnt ungültige Liste ab');
    assert(!('correctionHistory' in normalizeTranche({ ...corrected, correctionHistory: bad }, { mode: 'engine' })), 'Engine ignoriert auch ungültige Verlaufsdaten');
}

// Profil-Export/Import, alte Datei, Vollsicherung und Wiederherstellung mit produktiven Adaptern.
const bundle = exportProfilesBundle({ storage });
const imported = store({});
assert(importProfilesBundle(JSON.parse(JSON.stringify(bundle)), { storage: imported }).ok, 'Export → Import gelingt');
assertEqual(JSON.stringify(lot(imported).correctionHistory), JSON.stringify(corrected.correctionHistory), 'Profilrundreise erhält Liste');
const oldBundle = exportProfilesBundle({ storage: store(recordsWith(original)) });
assert(importProfilesBundle(oldBundle, { storage: imported }).ok, 'Alter Export ohne Feld lädt unverändert');
assertEqual((lot(imported).correctionHistory || []).length, 0, 'Alter Export hat leere Liste');
const f = await playFixture('localstorage', { ...storage.copy });
let controller = await f.boot();
const backup = buildFullPersistenceBackup();
assert(normalizeFullPersistenceBackup(backup).ok, 'Vollsicherung akzeptiert Korrekturliste');
const snapshot = await SnapshotArchive.createSnapshot({ label: 'Korrekturen', records: backup.records, activeProfileId: profileId });
await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId, tranche: correctedTranche(lot(persistenceStorage), 60, 'depotauszug'), correction: true, correctionReason: 'depotauszug' }));
assertEqual(lot(persistenceStorage).correctionHistory.length, 3, 'Produktiver Commit schreibt Liste');
assert((await importFullPersistenceBackup(JSON.parse(JSON.stringify(backup)))).ok, 'Vollsicherung lässt sich einspielen');
assertEqual(lot(persistenceStorage).correctionHistory.length, 2, 'Vollimport erhält zwei Korrekturen');
await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId, tranche: correctedTranche(lot(persistenceStorage), 60, 'depotauszug'), correction: true }));
const restored = await executeSnapshotRestore(await previewSnapshotRestore(snapshot.id));
assertEqual(restored.status, 'restored', 'Wiederherstellungspunkt lässt sich zurückholen');
controller = await f.boot();
assertEqual(lot(persistenceStorage).correctionHistory.length, 2, 'Wiederherstellung erhält Liste');
await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
assertEqual(lot(persistenceStorage).correctionHistory.length, 2, 'Spielbereich kopiert Korrekturen');
await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId, tranche: correctedTranche(lot(persistenceStorage), 60, 'depotauszug'), correction: true }));
const review = await controller.readEndReview();
assert(JSON.stringify(review.changes).includes('Korrekturen: 2 → 3'), 'Übernahmevorschau zeigt lesbare Anzahl');
await controller.end(() => ({ action: 'transfer', review })); await f.boot();
assertEqual(lot(persistenceStorage).correctionHistory.length, 3, 'Rückweg übernimmt Korrekturliste');
assertEqual(JSON.parse(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles[profileId].data.depot_tranchen).find(item => item.trancheId === trancheId).correctionHistory.length, 3, 'Registry nach Rückweg vollständig');
