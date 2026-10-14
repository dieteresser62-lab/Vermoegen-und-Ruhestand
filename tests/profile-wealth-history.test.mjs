import { PROFILE_CASH_HISTORY_KEY, PROFILE_WEALTH_LOTS_KEY, assertCashHistory, assertWealthLots, appendCashHistory, captureWealthLots, captureSaleWealthLots } from '../app/profile/profile-wealth-history.js';
import { WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY, loadHistoryRecord } from '../app/tranches/tranchen-history-store.js';
import { saveProfileAssetValues, loadProfileAssetValues, DEFAULT_PROFILE_ASSET_VALUES } from '../app/profile/profile-asset-values.js';
import { captureProfileData, loadProfileDataIntoLocalStorage } from '../app/profile/profile-live-storage.js';
import { exportProfilesBundle, importProfilesBundle, normalizeProfilesBundle } from '../app/profile/profile-bundle-io.js';
const map = new Map();
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key),
    key: index => [...map.keys()][index] ?? null, get length() { return map.size; } };
for (const validator of [assertCashHistory, assertWealthLots]) {
    assertEqual(loadHistoryRecord(null, validator).status, 'missing', 'Fehlende Profilhistorie bleibt von beschädigter unterscheidbar');
    for (const raw of ['', '{}', '{', 'null', '{"version":2}']) assertEqual(loadHistoryRecord(raw, validator).status, 'corrupt', 'Beschädigte Profilhistorie wird nicht ersetzt');
}
assertEqual(appendCashHistory(null, 100, 100), null, 'Gleichbleibender Cashwert erzeugt keine Historie');
let cash = appendCashHistory(null, 100, 80, '2026-01-02');
cash = appendCashHistory(JSON.stringify(cash), 80, 90, '2026-01-02');
assertEqual(cash.baselineValue, 100, 'Erste Änderung erhält bisherigen Betrag als rückwirkende Basis');
assertEqual(JSON.stringify(cash.entries), '[{"date":"2026-01-02","value":90}]', 'Zwei Änderungen am selben Tag ergeben nur den letzten Stand');
const reverted = appendCashHistory(JSON.stringify(cash), 90, 100, '2026-01-02');
assertEqual(reverted.entries.length, 0, 'Rückkehr zur Ausgangsbasis entfernt den Tageseintrag');
const nextDay = appendCashHistory(JSON.stringify(cash), 90, 70, '2026-01-03');
assertEqual(JSON.stringify(appendCashHistory(JSON.stringify(nextDay), 70, 90, '2026-01-03')), JSON.stringify(cash),
    'Rückkehr auf den Vortagesstand entfernt nur den geschriebenen Tag');
const legacy = { version: 1, baselineValue: 100, entries: [
    { date: '2026-01-01', value: 80 }, { date: '2026-01-01', value: 90 },
    ...[1, 12, 123, 1234, 12345].map(value => ({ date: '2026-01-02', value }))] };
assertCashHistory(legacy);
for (const value of [12345, 15000, 90]) {
    const normalized = appendCashHistory(JSON.stringify(legacy), 12345, value, '2026-01-02');
    assertEqual(JSON.stringify(normalized.entries.filter(entry => entry.date === '2026-01-01')), JSON.stringify(legacy.entries.slice(0, 2)),
        'Andere Altbestandstage werden nicht aufgeräumt');
    assertEqual(JSON.stringify(normalized.entries.filter(entry => entry.date === '2026-01-02')),
        JSON.stringify(value === 90 ? [] : [{ date: '2026-01-02', value }]), 'Fünf Alteinträge werden auch bei unverändertem Stand zusammengefasst');
}
assertEqual(legacy.entries.length, 7, 'Schreibvorbereitung mutiert den Altbestand nicht');
const historicalCash = { version: 1, baselineValue: 8000, entries: [
    { date: '2026-05-01', value: 10000 }, { date: '2026-05-10', value: 12000 }] };
for (const date of ['2026-04-30', '2026-05-01', '2026-05-05', '2026-05-10', '2026-05-15']) {
    assertEqual(JSON.stringify(appendCashHistory(JSON.stringify(historicalCash), 12000, 12000, date)), JSON.stringify(historicalCash),
        'Unveränderte Bestätigung an einem Tag ohne Mehrfacheinträge erhält den Verlauf: ' + date);
}
for (const dayValue of [11500, 10000]) {
    const historicalLegacy = { ...historicalCash, entries: [historicalCash.entries[0],
        { date: '2026-05-05', value: 11000 }, { date: '2026-05-05', value: dayValue }, historicalCash.entries[1]] };
    const normalized = appendCashHistory(JSON.stringify(historicalLegacy), 12000, 12000, '2026-05-05');
    const expected = [historicalCash.entries[0], ...(dayValue === 10000 ? [] : [{ date: '2026-05-05', value: dayValue }]), historicalCash.entries[1]];
    assertEqual(JSON.stringify(normalized.entries), JSON.stringify(expected),
        'Unveränderte Bestätigung fasst einen früheren Altbestandstag auf dessen letzten Wert zusammen: ' + dayValue);
}
const baselineLegacy = { ...historicalCash, entries: [
    { date: '2026-05-01', value: 9000 }, { date: '2026-05-01', value: 8000 }, historicalCash.entries[1]] };
assertEqual(JSON.stringify(appendCashHistory(JSON.stringify(baselineLegacy), 12000, 12000, '2026-05-01').entries),
    JSON.stringify([historicalCash.entries[1]]), 'Früherer Altbestandstag entfällt bei Rückkehr zur Basis');
let conflict; try { appendCashHistory(JSON.stringify(cash), 70, 60, '2026-01-03'); } catch (error) { conflict = error; }
assert(conflict, 'Widersprüchlicher Cashwert wird abgewiesen statt Historie still umzudeuten');
conflict = null; try { appendCashHistory(JSON.stringify(cash), 70, 70, '2026-01-02'); } catch (error) { conflict = error; }
assert(conflict, 'Auch ein unveränderter Betrag verdeckt keinen Historienwiderspruch');
conflict = null; try { appendCashHistory(JSON.stringify(cash), 90, 60, '2026-01-01'); } catch (error) { conflict = error; }
assert(conflict, 'Eine neue Änderung vor dem letzten Historiendatum bleibt abgewiesen');
const lot = { schemaVersion: 1, trancheId: 'lot-a', name: 'Synthetisch', shares: 10, purchasePrice: 80, currentPrice: 100,
    purchaseDate: '2020-01-02', ticker: 'TEST.DE', category: 'equity', type: 'aktien_neu', tqf: 0, notes: '' };
const original = JSON.stringify(lot);
const lots = captureWealthLots(null, [lot], '2026-01-02');
assertEqual(JSON.stringify(lot), original, 'Stammdatenerfassung mutiert Quelle nicht');
assertEqual(lots.lots['lot-a'].tranche.purchaseDate, '2020-01-02', 'Erfassungsdatum ersetzt Kaufdatum niemals');
const removed = captureWealthLots(JSON.stringify(lots), [], '2026-01-03');
assertEqual(removed.lots['lot-a'].status, 'unknown', 'Manuelles Entfernen unterstellt keinen Realverkauf');
const sold = captureSaleWealthLots(JSON.stringify(lots), [lot], [], 'lot-a', '2026-01-03');
assertEqual(sold.lots['lot-a'].remainingShares, 0, 'Totalverkauf bewahrt Stammdaten mit belegtem Nullrest');
assertEqual(sold.lots['lot-a'].status, 'sold', 'Totalverkauf bleibt von manuellem Entfernen unterscheidbar');
assertEqual(sold.lots['lot-a'].tranche.ticker, 'TEST.DE', 'Ticker bleibt nach Totalverkauf verfügbar');
const changed = captureWealthLots(JSON.stringify(lots), [{ ...lot, shares: 8 }], '2026-01-04');
assertEqual(changed.lots['lot-a'].status, 'unknown', 'Manuell widersprüchlich geänderter Restbestand unterstellt keinen Verkauf');
const resolved = captureWealthLots(JSON.stringify(lots), [{ ...lot, ticker: 'RESOLVED.DE' }], '2026-01-04');
assertEqual(resolved.lots['lot-a'].tranche.ticker, 'RESOLVED.DE', 'Kopie folgt wirklich gespeichertem aufgelöstem Ticker');
for (const value of [{ version: 1, baselineValue: -1, entries: [] }, { version: 1, baselineValue: 10, entries: [{ date: '2026-02-29', value: 9 }] },
    { version: 1, baselineValue: 10, entries: [{ date: '2026-01-03', value: 8 }, { date: '2026-01-02', value: 7 }] }]) assertEqual(loadHistoryRecord(JSON.stringify(value), assertCashHistory).status, 'corrupt', 'Ungültige Cashfelder abgewiesen');
const invalidLots = structuredClone(sold); invalidLots.lots['lot-a'].remainingShares = 1;
assertEqual(loadHistoryRecord(JSON.stringify(invalidLots), assertWealthLots).status, 'corrupt', 'Verkaufter Bestand darf keinen positiven Rest tragen');
assertEqual(loadHistoryRecord('{"version":1,"lots":{"__proto__":{}}}', assertWealthLots).status, 'corrupt', 'Unsichere Stammdatenkennung abgewiesen');

storage.setItem(WEALTH_HISTORY_START_KEY, '{"version":1,"startDate":"2020-01-01"}');
storage.setItem(DAILY_PRICES_KEY, '{"version":1,"symbols":{}}');
saveProfileAssetValues({ ...DEFAULT_PROFILE_ASSET_VALUES, tagesgeld: 100 }, storage);
assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), null, 'Initialwerte erzeugen ohne bestätigenden Besitzer keine Historie');
saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 80 }, storage, { recordCashChange: true, date: '2026-01-02' });
storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(sold));
const dataA = captureProfileData(storage);
assert(!Object.hasOwn(dataA, WEALTH_HISTORY_START_KEY) && !Object.hasOwn(dataA, DAILY_PRICES_KEY), 'Globale Kursdaten und Beginn gelangen nicht in Profilcapture');
loadProfileDataIntoLocalStorage({}, storage);
assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), null, 'Profilwechsel leert Cashhistorie des vorherigen Profils');
saveProfileAssetValues({ ...DEFAULT_PROFILE_ASSET_VALUES, tagesgeld: 500 }, storage);
saveProfileAssetValues({ ...loadProfileAssetValues(storage), tagesgeld: 400 }, storage, { recordCashChange: true, date: '2026-01-03' });
const dataB = captureProfileData(storage);
loadProfileDataIntoLocalStorage(dataA, storage);
assertEqual(JSON.parse(storage.getItem(PROFILE_CASH_HISTORY_KEY)).baselineValue, 100, 'Rückwechsel stellt erste Cashhistorie wieder her');
assertEqual(JSON.parse(dataB[PROFILE_CASH_HISTORY_KEY]).baselineValue, 500, 'Zweites Profil hat eigene Cashbasis');
assertEqual(storage.getItem(WEALTH_HISTORY_START_KEY), '{"version":1,"startDate":"2020-01-01"}', 'Profilwechsel lässt globalen Beginn unverändert');
assertEqual(storage.getItem(DAILY_PRICES_KEY), '{"version":1,"symbols":{}}', 'Profilwechsel lässt globale Kurse unverändert');
const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'A' }, data: dataA }, b: { meta: { id: 'b', name: 'B' }, data: dataB } } };
storage.setItem('rs_profiles_v1', JSON.stringify(registry)); storage.setItem('rs_current_profile', 'a'); storage.setItem('rs_active_profile', 'a');
const bundle = JSON.parse(JSON.stringify(exportProfilesBundle({ storage })));
assertEqual(bundle.globals[WEALTH_HISTORY_START_KEY], storage.getItem(WEALTH_HISTORY_START_KEY), 'Profilbundle transportiert gemeinsamen Beginn');
assertEqual(bundle.globals[DAILY_PRICES_KEY], storage.getItem(DAILY_PRICES_KEY), 'Profilbundle transportiert globale Kurse');
map.clear(); assertEqual(importProfilesBundle(bundle, { storage }).ok, true, 'Profilbundle-Rundreise importiert beide Historien');
assertEqual(storage.getItem(PROFILE_WEALTH_LOTS_KEY), dataA[PROFILE_WEALTH_LOTS_KEY], 'Bundle erhält Totalverkaufsstammdaten bytegleich');
assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), dataA[PROFILE_CASH_HISTORY_KEY], 'Bundle erhält aktive Cashhistorie bytegleich');
assertEqual(storage.getItem('rs_profiles_v1'), JSON.stringify(registry), 'Bundle erhält beide Profildaten bytegleich');
const before = JSON.stringify([...map]);
for (const mutate of [b => b.globals[WEALTH_HISTORY_START_KEY] = '{}', b => b.globals[DAILY_PRICES_KEY] = '{}',
    b => b.registry.profiles.b.data[PROFILE_CASH_HISTORY_KEY] = '{}', b => b.registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY] = '{}']) {
    const broken = structuredClone(bundle); mutate(broken);
    assertEqual(normalizeProfilesBundle(broken).ok, false, 'Bundle validiert neue Records einschließlich inaktivem Profil');
    assertEqual(importProfilesBundle(broken, { storage }).ok, false, 'Ungültiges Bundle verhindert Import');
    assertEqual(JSON.stringify([...map]), before, 'Preflight führt keinen Write aus');
}

// Festes Mehrprofilbeispiel, dieselben Reihen wie die Übersicht, keine Livefinanzdaten.
{
    const { projectManagerProfiles } = await import('../app/tranches/tranchen-manager-profiles.js');
    const { projectOverviewHistory } = await import('../app/overview/overview-model.js');
    const { historyDay } = await import('../app/tranches/tranchen-history-store.js');
    const { renderManagerProfiles } = await import('../app/tranches/tranchen-manager-renderer.js');
    const day = historyDay('2026-01-02');
    const prices = { version: 1, symbols: { 'TEST.DE': { currency: 'EUR', days: [day, day + 3], closes: [100, 110], queried: [[day, day + 3]], failures: 0, lastError: null } } };
    const fixture = { version: 1, profiles: {
        a: { meta: { id: 'a', name: 'A' }, data: { depot_tranchen: JSON.stringify([{ ...lot, purchaseDate: '2025-01-02' }]), profile_tagesgeld: '50' } },
        b: { meta: { id: 'b', name: 'B', belongsToHousehold: false }, data: { depot_tranchen: '[]', profile_tagesgeld: '500' } }
    } };
    const freeze = value => { Object.freeze(value); Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); }); return value; };
    freeze(fixture); freeze(prices);
    const raw = JSON.stringify(fixture);
    const context = { status: 'ready', startDate: '2026-01-02', today: '2026-01-06', prices, events: [] };
    const projected = projectManagerProfiles(fixture, 'b', context);
    const overview = projectOverviewHistory({ registry: fixture, profiles: projected.profiles, liveData: {
        [WEALTH_HISTORY_START_KEY]: JSON.stringify({ version: 1, startDate: context.startDate }), [DAILY_PRICES_KEY]: JSON.stringify(prices)
    }, today: context.today });
    assertEqual(JSON.stringify(projected.householdHistory.points), JSON.stringify(overview.points), 'Manager und Übersicht zeigen dieselben belegten Haushaltswerte');
    assertEqual(projected.profiles[0].history.metrics.change, 100, 'Personenkarten verwenden belegte Tagesveränderung');
    assertEqual(projected.profiles[1].history.end.total, 500, 'Profil außerhalb Haushalt behält eigene Verlaufsreihe');
    assertEqual(projected.householdHistory.end.total, 1150, 'Außenprofil trägt nicht zur Haushaltsverlaufsreihe bei');
    const nodes = new Map(['managerHousehold', 'managerProfileTabs', 'managerPageTitle'].map(id => [id, { innerHTML: '', textContent: '' }]));
    renderManagerProfiles({ getElementById: id => nodes.get(id) }, projected);
    assert(nodes.get('managerHousehold').innerHTML.includes('Außerhalb Haushalt') && !nodes.get('managerHousehold').innerHTML.includes('pv-active'), 'Außenprofil besitzt eigene Karte mit Haushaltszuordnung ohne Auswahlrahmen');
    assert(nodes.get('managerHousehold').innerHTML.includes('managerHistoryStartForm'), 'Beginnbedienung sitzt an der Haushaltskarte');
    assertEqual(JSON.stringify(fixture), raw, 'Kartenprojektion und Rendern verändern auch eingefrorene Registry nicht');
}

{
    const { confirmManagerHistoryStart } = await import('../app/tranches/tranchen-history-ui.js');
    await confirmManagerHistoryStart('2019-01-01', { storage, today: '2026-01-07', flush: async () => true });
    const changedBundle = exportProfilesBundle({ storage });
    map.clear();
    assertEqual(importProfilesBundle(changedBundle, { storage }).ok, true, 'Bundle akzeptiert tatsächlich bestätigte Beginnänderung');
    assertEqual(JSON.parse(storage.getItem(WEALTH_HISTORY_START_KEY)).startDate, '2019-01-01', 'Backup-Rundreise erhält geänderten Haushaltsbeginn');
    assertEqual(storage.getItem(PROFILE_WEALTH_LOTS_KEY), dataA[PROFILE_WEALTH_LOTS_KEY], 'Beginnbackup erhält Totalverkaufsstammdaten weiterhin bytegleich');
}

// Herkunft wird nur beim Übergang einer verlässlichen Kopie gesichert.
{
    const { projectProfileWealthHistory } = await import('../app/profile/profile-wealth-history.js');
    const { historyDay } = await import('../app/tranches/tranchen-history-store.js');
    const first = { ...lot, purchaseDate: '2026-01-02' };
    const initial = captureWealthLots(null, [first], '2026-01-03');
    for (const patch of [{ shares: 8 }, { purchaseDate: '2026-01-05' }, { type: 'aktien_alt' }, { isin: 'DE0001234567' }, null]) {
        const current = patch ? [{ ...first, ...patch }] : [];
        const record = captureWealthLots(JSON.stringify(initial), current, '2026-01-06');
        const changed = record.lots['lot-a'];
        assertEqual(changed.status, 'unknown', 'Identitätsänderung oder Entfernen bleibt unbekannt');
        assertEqual(changed.uncertainty.fromDate, '2026-01-02', 'Verlässliche Kopie bewahrt ursprünglichen Beginn');
        assertEqual(changed.uncertainty.originalTranche.purchaseDate, '2026-01-02', 'Ursprüngliche Tranche bleibt erhalten');
        assert(changed.remainingShares > 0, 'Manuelle Änderung ist kein Nullrestverkauf');
        const later = captureWealthLots(JSON.stringify(record), [{ ...first, purchaseDate: '2026-01-09' }], '2026-01-10');
        assertEqual(later.lots['lot-a'].uncertainty.fromDate, '2026-01-02', 'Wiederholte spätere Kaufdaten verschieben Grenze nie nach hinten');
        const earlier = captureWealthLots(JSON.stringify(later), [{ ...first, purchaseDate: '2026-01-01' }], '2026-01-10');
        assertEqual(earlier.lots['lot-a'].uncertainty.fromDate, '2026-01-01', 'Früherer möglicher Kauf erweitert Unsicherheit');
        assertEqual(captureWealthLots(JSON.stringify(earlier), [], '2026-01-11').lots['lot-a'].uncertainty.fromDate,
            '2026-01-01', 'Erneutes Entfernen erhält früheste Grenze');
    }
    const good = captureWealthLots(JSON.stringify(initial), [], '2026-01-06');
    for (const patch of [null, {}, { fromDate: '2026-02-29', originalTranche: first },
        { fromDate: '2026-01-05', originalTranche: first }, { fromDate: '2026-01-02', originalTranche: { ...first, trancheId: 'other' } },
        { fromDate: '2026-01-02', originalTranche: { ...first, purchaseDate: '' } }]) {
        const bad = structuredClone(good); bad.lots['lot-a'].uncertainty = patch;
        assertEqual(loadHistoryRecord(JSON.stringify(bad), assertWealthLots).status, 'corrupt', 'Ungültige optionale Herkunft abgewiesen');
    }
    const presentWithMetadata = structuredClone(good); presentWithMetadata.lots['lot-a'].status = 'present';
    assertEqual(loadHistoryRecord(JSON.stringify(presentWithMetadata), assertWealthLots).status, 'corrupt', 'Unsicherheit nur an unbekanntem Bestand zulässig');
    const undated = captureWealthLots(null, [{ ...first, purchaseDate: '' }], '2026-01-03');
    assert(!captureWealthLots(JSON.stringify(undated), [], '2026-01-04').lots['lot-a'].uncertainty, 'Fehlendes Originaldatum erzeugt keine Datierungsgrenze');

    const valid = { ...first, trancheId: 'valid', shares: 2, purchaseDate: '2026-01-01' };
    const prices = { symbols: { 'TEST.DE': { currency: 'EUR', days: [historyDay('2026-01-01')], closes: [10],
        queried: [[historyDay('2026-01-01'), historyDay('2026-01-06')]] } } };
    for (const removed of [false, true]) {
        // Exakt der Altwriter-Verlust: ursprünglich 02.01., Kopie jetzt 05.01.
        const legacy = { version: 1, lots: { 'lot-a': { status: 'unknown', capturedAt: '2026-01-03', remainingShares: 10,
            tranche: { ...first, purchaseDate: '2026-01-05' } } } };
        const current = removed ? [valid] : [valid, legacy.lots['lot-a'].tranche];
        let captured = legacy;
        for (let repeat = 0; repeat < 3; repeat++) {
            captured = captureWealthLots(JSON.stringify(captured), current, '2026-01-07');
            assert(!captured.lots['lot-a'].uncertainty, 'Altgleichheit/Entfernung und Reload erzeugen keine nachträgliche Herkunft');
            const registry = { profiles: { a: { data: { depot_tranchen: JSON.stringify(current), [PROFILE_WEALTH_LOTS_KEY]: JSON.stringify(captured) } } } };
            const before = JSON.stringify(registry);
            const result = projectProfileWealthHistory(registry, [{ id: 'a', valid: true, belongs: true, values: { tagesgeld: 100 } }],
                { prices, startDate: '2026-01-01', today: '2026-01-07' });
            assert(result.points.every(point => point.total === null && point.known === 120), 'Altbestand durchgehend unbekannt, gültige Tranche plus Cash vollständig bekannt');
            assert(result.errors.some(error => error.includes('ursprünglicher Kaufbeginn nicht gesichert')), 'Personenprojektion nennt Altverlust');
            assertEqual(JSON.stringify(registry), before, 'Altprojektion erhält sämtliche Speicherbytes');
        }
    }

    // Der vorhandene Profilcapture und Bundlepfad transportiert Metadaten bytegleich.
    storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(good));
    const capturedData = captureProfileData(storage);
    assertEqual(capturedData[PROFILE_WEALTH_LOTS_KEY], JSON.stringify(good), 'Profilcapture erhält Unsicherheit bytegleich');
    const capturedRegistry = JSON.parse(storage.getItem('rs_profiles_v1'));
    capturedRegistry.profiles[storage.getItem('rs_current_profile')].data = capturedData;
    storage.setItem('rs_profiles_v1', JSON.stringify(capturedRegistry));
    const metadataBundle = exportProfilesBundle({ storage });
    map.clear();
    assertEqual(importProfilesBundle(metadataBundle, { storage }).ok, true, 'Bundle akzeptiert optionale Unsicherheit ohne Versionswechsel');
    assertEqual(storage.getItem(PROFILE_WEALTH_LOTS_KEY), JSON.stringify(good), 'Bundle erhält Herkunft und Grenze bytegleich');
    const badBundle = structuredClone(metadataBundle);
    const active = badBundle.activeProfileId || storage.getItem('rs_current_profile');
    const damaged = structuredClone(good); damaged.lots['lot-a'].uncertainty.fromDate = '2026-02-29';
    badBundle.registry.profiles[active].data[PROFILE_WEALTH_LOTS_KEY] = JSON.stringify(damaged);
    assertEqual(normalizeProfilesBundle(badBundle).ok, false, 'Bundlepreflight weist ungültige Metadaten ab');
}

// Reparaturen durch den echten gemeinsamen Writer in injiziertem Speicher.
{
    const { prepareHistoryRecovery, commitHistoryRecovery, projectHistoryRecovery } = await import('../app/tranches/tranchen-history-recovery.js');
    const { projectProfileWealthHistory } = await import('../app/profile/profile-wealth-history.js');
    const { previewTrancheReconciliation } = await import('../app/tranches/tranche-reconciliation.js');
    const { historyDay } = await import('../app/tranches/tranchen-history-store.js');
    const { createNavigationGuard, createNavigationOperationLifecycle } = await import('../app/shared/navigation-guard.js');
    const first = { ...lot, purchaseDate: '2026-01-02' };
    const validLot = { ...first, trancheId: 'valid', purchaseDate: '2026-01-01', shares: 2 };
    const corrected = { ...first, shares: 8, purchaseDate: '2026-01-05' };
    const initial = captureWealthLots(null, [first, validLot], '2026-01-03');
    const setup = (removed = false, legacy = false) => {
        const current = removed ? [validLot] : [corrected, validLot];
        const copies = captureWealthLots(JSON.stringify(initial), current, '2026-01-06');
        if (legacy) {
            delete copies.lots['lot-a'].uncertainty;
            copies.lots['lot-a'].tranche = { ...corrected };
            copies.lots['lot-a'].remainingShares = corrected.shares;
        }
        const data = { depot_tranchen: JSON.stringify(current), [PROFILE_WEALTH_LOTS_KEY]: JSON.stringify(copies),
            profile_tagesgeld: '100', [PROFILE_CASH_HISTORY_KEY]: JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-01-01', value: 100 }] }) };
        const registry = { version: 1, profiles: { a: { meta: { id: 'a' }, data },
            b: { meta: { id: 'b' }, data: { depot_tranchen: '[]', profile_tagesgeld: '321' } } } };
        const records = new Map(Object.entries({ ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a' }));
        let writes = 0;
        const store = { getItem: key => records.get(key) ?? null, setItem: (key, raw) => { writes++; records.set(key, String(raw)); },
            removeItem: key => { writes++; records.delete(key); } };
        const request = { profileId: 'a', trancheId: 'lot-a', kind: removed ? 'discard' : 'correct' };
        return { records, store, request, writes: () => writes, prepare: () => prepareHistoryRecovery(request, { storage: store, date: '2026-01-07' }) };
    };
    const bytes = fixture => JSON.stringify([...fixture.records]);
    const options = { startDate: '2026-01-01', today: '2026-01-07', events: [], prices: { symbols: {
        'TEST.DE': { currency: 'EUR', days: [historyDay('2026-01-01'), historyDay('2026-01-06')], closes: [10, 11],
            queried: [[historyDay('2026-01-01'), historyDay('2026-01-06')]] } } } };
    const project = fixture => projectProfileWealthHistory(JSON.parse(fixture.store.getItem('rs_profiles_v1')),
        [{ id: 'a', valid: true, belongs: true, values: { tagesgeld: 100 } }], options);
    for (const removed of [false, true]) for (const legacy of [false, true]) {
        const fixture = setup(removed, legacy), before = bytes(fixture);
        const originalRegistry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        const prepared = fixture.prepare();
        assertEqual(bytes(fixture), before, 'Vorbereitung und Kandidatenprojektion schreiben nichts');
        assertEqual(await commitHistoryRecovery(prepared, { storage: fixture.store }), false, 'Keine Reparatur ohne ausdrückliche Bestätigung');
        assertEqual(bytes(fixture), before, 'Ohne Bestätigung bleiben alle Bytes gleich');
        if (legacy) assert(project(fixture).points.every(point => point.total === null), 'Beide undatierten Altvarianten bleiben bis Bestätigung durchgehend unbekannt');
        const guard = createNavigationGuard({ decide: async () => true });
        const lifecycle = createNavigationOperationLifecycle({ guard });
        let release, started = false, done = false;
        const promise = lifecycle.run({}, operation => commitHistoryRecovery(prepared, { confirmed: true, storage: fixture.store, operation,
            flush: () => { started = true; return new Promise(resolve => { release = resolve; }); } })).then(result => { done = true; return result; });
        await Promise.resolve();
        assert(started && !done && lifecycle.isBlocked(), 'Verzögerter Flush meldet keinen Erfolg und sperrt Navigation');
        assertEqual(await guard.prepare(), null, 'Navigation überholt den Reparaturcommit nicht');
        const second = await commitHistoryRecovery(prepared, { confirmed: false, storage: fixture.store });
        assertEqual(second, false, 'Unbestätigter Doppelklick bleibt schreibfrei');
        let duplicate; try { await commitHistoryRecovery(prepared, { confirmed: true, storage: fixture.store }); } catch (error) { duplicate = error; }
        assert(duplicate, 'Doppelter Auftrag bestätigt keinen zweiten Write');
        release(true); assertEqual(await promise, true, 'Erfolg erst nach Flushbestätigung');
        const savedRegistry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        assertEqual(fixture.store.getItem(PROFILE_WEALTH_LOTS_KEY), savedRegistry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY], 'Live- und Registryrecord gemeinsam bestätigt');
        assertEqual(JSON.stringify(savedRegistry.profiles.b), JSON.stringify(originalRegistry.profiles.b), 'Fremdes Profil bleibt bytegleich');
        for (const key of ['depot_tranchen', 'profile_tagesgeld', PROFILE_CASH_HISTORY_KEY]) assertEqual(fixture.store.getItem(key), originalRegistry.profiles.a.data[key], 'Aktueller Bestand und Cash bleiben bytegleich');
        const history = project(fixture);
        assert(history.points.every(point => Number.isFinite(point.total)), 'Reparatur bewertet alle Tage einschließlich vor Kauf');
        assertEqual(history.points[0].total, 120, 'Vor korrigiertem Kauf zählt nur gültige Tranche plus Cash');
        assertEqual(history.end.total, removed ? 122 : 210, 'Endwert enthält genau bestätigte rückwirkende Bestände');
        assertEqual(history.metrics.status, removed ? 'complete' : 'provisional', 'Nur manuelle Bestandsannahme erzwingt Vorläufigkeit');
        assertEqual(history.metrics.withdrawals, 0, 'Reparatur erzeugt keine Entnahme');
        assert(!history.events.some(event => event.kind === 'sell'), 'Keine erfundene Verkaufsmarke');
        const reloaded = JSON.parse(fixture.store.getItem(PROFILE_WEALTH_LOTS_KEY));
        const captured = captureWealthLots(JSON.stringify(reloaded), JSON.parse(fixture.store.getItem('depot_tranchen')), '2026-01-08');
        assertEqual(JSON.stringify(captured), JSON.stringify(reloaded), 'Reload und nachfolgendes Capture halten Reparatur stabil');
        const writeCount = fixture.writes();
        assertEqual(fixture.prepare(), null, 'Erneute Reparatur ist No-op');
        assertEqual(fixture.writes(), writeCount, 'No-op schreibt keine Bytes');
    }
    for (const removed of [false, true]) {
        const fixture = setup(removed), before = bytes(fixture);
        let calls = 0, failure;
        try { await commitHistoryRecovery(fixture.prepare(), { confirmed: true, storage: fixture.store,
            flush: async () => { if (++calls === 1) return false; return true; } }); } catch (error) { failure = error; }
        assert(failure?.rollbackConfirmed, 'Fehlflush bestätigt Rollback');
        assertEqual(bytes(fixture), before, 'Fehlflush rollt Live- und Registryrecord bytegleich zurück');
        assertEqual(await commitHistoryRecovery(fixture.prepare(), { confirmed: true, storage: fixture.store, flush: async () => true }), true, 'Retry bestätigt beide Reparaturwege');
    }
    for (const mutation of ['profile', 'document', 'registry', 'lots', 'tranches']) {
        const fixture = setup(), prepared = fixture.prepare();
        let current = true;
        if (mutation === 'document') current = false;
        else {
            const key = { profile: 'rs_current_profile', registry: 'rs_profiles_v1', lots: PROFILE_WEALTH_LOTS_KEY, tranches: 'depot_tranchen' }[mutation];
            fixture.records.set(key, fixture.store.getItem(key) + ' ');
        }
        const before = bytes(fixture), writes = fixture.writes();
        let error; try { await commitHistoryRecovery(prepared, { confirmed: true, storage: fixture.store, valid: () => current }); } catch (cause) { error = cause; }
        assert(error, 'Verlorener Kontext oder geänderte Quellbytes stoppen Writeaufnahme');
        assertEqual(bytes(fixture), before, 'Keine Bytes nach Kontextverlust verändert');
        assertEqual(fixture.writes(), writes, 'Kein Write nach Kontextverlust');
    }
    for (const removed of [false, true]) for (const legacy of [false, true]) {
        const fixture = setup(removed, legacy);
        const registry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        const sale = previewTrancheReconciliation({ profileId: 'a', tranches: [first], registry,
            action: { actionId: 'repair-sale', profileId: 'a', trancheId: first.trancheId, executedAt: '2026-01-03', sharesSold: 2, grossProceeds: 20, fees: 0 } }).auditRecord;
        registry.trancheReconciliation = { schemaVersion: 1, actions: [sale] };
        fixture.records.set('rs_profiles_v1', JSON.stringify(registry));
        const before = bytes(fixture);
        assert(projectHistoryRecovery(registry, 'a')[0].blocked, 'Bestätigter Verkaufsbeleg sperrt auch beide Altvarianten');
        let error; try { fixture.prepare(); } catch (cause) { error = cause; }
        assert(error, 'Verkaufsbestand nicht reparierbar');
        assertEqual(bytes(fixture), before, 'Verkaufs- und Auditbytes bleiben bytegleich');
    }
    {
        const fixture = setup();
        const registry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        const sale = previewTrancheReconciliation({ profileId: 'b', tranches: [first], registry,
            action: { actionId: 'foreign-sale', profileId: 'b', trancheId: first.trancheId, executedAt: '2026-01-03', sharesSold: 2, grossProceeds: 20, fees: 0 } }).auditRecord;
        registry.trancheReconciliation = { schemaVersion: 1, actions: [sale] };
        fixture.records.set('rs_profiles_v1', JSON.stringify(registry));
        const auditBytes = JSON.stringify(registry.trancheReconciliation);
        const profileBytes = JSON.stringify(registry.profiles.b);
        assertEqual(await commitHistoryRecovery(fixture.prepare(), { confirmed: true, storage: fixture.store, flush: async () => true }), true, 'Gleiche Lotkennung in fremdem Profil sperrt eigene Reparatur nicht');
        const repaired = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        assertEqual(JSON.stringify(repaired.trancheReconciliation), auditBytes, 'Vorhandener fremder Verkaufsaudit bleibt bytegleich');
        assertEqual(JSON.stringify(repaired.profiles.b), profileBytes, 'Fremdprofil mit Audit bleibt bytegleich');
        const another = setup();
        const duplicateAuditRegistry = JSON.parse(another.store.getItem('rs_profiles_v1'));
        duplicateAuditRegistry.trancheReconciliation = { schemaVersion: 1, actions: [sale, sale] };
        another.records.set('rs_profiles_v1', JSON.stringify(duplicateAuditRegistry));
        const before = bytes(another);
        let failure; try { another.prepare(); } catch (error) { failure = error; }
        assert(failure, 'Widersprüchliches doppeltes Audit sperrt beide Reparaturwege');
        assertEqual(bytes(another), before, 'Widersprüchliches Audit bleibt unverändert');
    }
    {
        const fixture = setup();
        let current = true, release, finished = false;
        const writes = fixture.writes();
        const promise = commitHistoryRecovery(fixture.prepare(), { confirmed: true, storage: fixture.store,
            valid: () => current, flush: () => new Promise(resolve => { release = resolve; }) }).then(() => { finished = true; }, () => false);
        await Promise.resolve();
        const committedWrites = fixture.writes();
        assertEqual(committedWrites - writes, 2, 'Beide Records synchron vor Flush aufgenommen');
        current = false; release(true); await promise;
        assert(!finished, 'Kontextverlust während übernommenem Commit meldet keinen falschen Erfolg');
        assertEqual(fixture.writes(), committedWrites, 'Nach Kontextverlust keine weiteren Writes');
        assertEqual(fixture.store.getItem(PROFILE_WEALTH_LOTS_KEY), JSON.parse(fixture.store.getItem('rs_profiles_v1')).profiles.a.data[PROFILE_WEALTH_LOTS_KEY], 'Übernommener Commit endet auch bei Kontextverlust mit gleichen Records');
    }
    {
        const fixture = setup();
        const copies = JSON.parse(fixture.store.getItem(PROFILE_WEALTH_LOTS_KEY));
        copies.lots['lot-a'].status = 'sold'; copies.lots['lot-a'].remainingShares = 0;
        delete copies.lots['lot-a'].uncertainty;
        const raw = JSON.stringify(copies);
        const registry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY] = raw;
        fixture.records.set(PROFILE_WEALTH_LOTS_KEY, raw); fixture.records.set('rs_profiles_v1', JSON.stringify(registry));
        let error; try { fixture.prepare(); } catch (cause) { error = cause; }
        assert(error, 'Als verkauft gespeicherter Bestand wird auch bei fehlendem Audit nicht als Stammdatenfehler repariert');
    }
    for (const damage of ['audit', 'lots', 'foreign', 'mismatch', 'date']) {
        const fixture = setup();
        const registry = JSON.parse(fixture.store.getItem('rs_profiles_v1'));
        if (damage === 'audit') registry.trancheReconciliation = { schemaVersion: 1, actions: [{}] };
        if (damage === 'lots') registry.profiles.a.data[PROFILE_WEALTH_LOTS_KEY] = '{';
        if (damage === 'mismatch') registry.profiles.a.data.depot_tranchen = '[]';
        if (damage === 'date') {
            const current = JSON.parse(fixture.store.getItem('depot_tranchen')); current[0].purchaseDate = '';
            fixture.records.set('depot_tranchen', JSON.stringify(current)); registry.profiles.a.data.depot_tranchen = JSON.stringify(current);
        }
        fixture.records.set('rs_profiles_v1', JSON.stringify(registry));
        if (damage === 'lots') fixture.records.set(PROFILE_WEALTH_LOTS_KEY, '{');
        if (damage === 'foreign') fixture.request.profileId = 'b';
        const before = bytes(fixture);
        let error; try { fixture.prepare(); } catch (cause) { error = cause; }
        assert(error, 'Beschädigter Vertrag, Fremdprofil oder fehlendes korrigiertes Kaufdatum sperrt Reparatur');
        assertEqual(bytes(fixture), before, 'Abgewiesene Reparatur bleibt schreibfrei');
    }
    for (const date of ['', '2026-02-29', null]) {
        const fixture = setup();
        const copies = JSON.parse(fixture.store.getItem(PROFILE_WEALTH_LOTS_KEY)); copies.lots['lot-a'].manualCorrectionAt = date;
        assertEqual(loadHistoryRecord(JSON.stringify(copies), assertWealthLots).status, 'corrupt', 'manualCorrectionAt wird kalendarisch validiert');
    }
}
