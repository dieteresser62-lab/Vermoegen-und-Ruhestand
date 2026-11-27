import { readWealthHistory, WealthHistoryError } from '../types/wealth-history-contract.js';
import { CONFIG, StorageError } from '../app/balance/balance-config.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { createLocalStorageAdapter } from '../app/shared/persistence-adapter-localstorage.js';
import { resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS, SNAPSHOT_TYPE } from '../app/shared/snapshot-archive.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';

console.log('--- Balance Storage Contract Tests ---');

class MockLocalStorage {
    constructor() {
        this.store = new Map();
    }

    getItem(key) {
        return this.store.has(String(key)) ? this.store.get(String(key)) : null;
    }

    setItem(key, value) {
        this.store.set(String(key), String(value));
    }

    removeItem(key) {
        this.store.delete(String(key));
    }

    clear() {
        this.store.clear();
    }

    key(index) {
        return Array.from(this.store.keys())[index] || null;
    }

    get length() {
        return this.store.size;
    }
}

function installMockLocalStorage() {
    global.localStorage = new MockLocalStorage();
    resetPersistenceForTests(createLocalStorageAdapter(() => global.localStorage));
    return global.localStorage;
}

const prevLocalStorage = global.localStorage;
const prevLocation = global.location;

try {
    console.log('Test 1: real migration preserves valid inflation state and creates taxState');
    {
        installMockLocalStorage();
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            inputs: { floorBedarf: 24000 },
            lastState: {
                cumulativeInflationFactor: 20,
                lastInflationAppliedAtAge: null
            }
        }));

        const loaded = StorageManager.loadState();

        assertEqual(loaded.lastState.cumulativeInflationFactor, 20,
            'Migration erhaelt den Inflationsfaktor an der Plausibilitaetsgrenze');
        assertEqual(loaded.lastState.lastInflationAppliedAtAge, 0, 'Migration setzt ungueltiges Inflationsalter zurueck');
        assertEqual(loaded.lastState.taxState.lossCarry, 0, 'Migration ergaenzt fehlenden TaxState');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.MIGRATION_FLAG), '1', 'Migration setzt das Flag');
    }

    console.log('Test 2: taxState is repaired even when migration flag already exists');
    {
        installMockLocalStorage();
        localStorage.setItem(CONFIG.STORAGE.MIGRATION_FLAG, '1');
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            lastState: {
                cumulativeInflationFactor: 2.9,
                lastInflationAppliedAtAge: 99,
                taxState: { lossCarry: -50 }
            }
        }));

        const loaded = StorageManager.loadState();

        assertEqual(loaded.lastState.cumulativeInflationFactor, 2.9,
            'Alte Inflation-Migration laeuft bei gesetztem Flag nicht erneut');
        assertEqual(loaded.lastState.lastInflationAppliedAtAge, 99, 'Altes Inflationsalter bleibt bei gesetztem Flag unveraendert');
        assertEqual(loaded.lastState.taxState.lossCarry, 0, 'TaxState wird trotz gesetztem Flag repariert');
    }

    console.log('Test 2b: invalid inflation factors fail closed before migration or save');
    {
        for (const invalidFactor of [0, -1, 20.0001, 99, null, 'NaN', 'Infinity']) {
            installMockLocalStorage();
            const raw = JSON.stringify({
                lastState: {
                    cumulativeInflationFactor: invalidFactor,
                    taxState: { lossCarry: 5 }
                }
            });
            localStorage.setItem(CONFIG.STORAGE.LS_KEY, raw);
            let thrown = null;
            try {
                StorageManager.loadState();
            } catch (error) {
                thrown = error;
            }
            assertEqual(thrown?.code, 'CUMULATIVE_INFLATION_FACTOR_INVALID',
                `Load muss den Domaenenfehler fuer Inflationsfaktor ${String(invalidFactor)} unverhuellt erhalten`);
            assert(thrown?.message.includes('nicht veraendert'),
                `Load-Fehler fuer ${String(invalidFactor)} muss den Rohdatenerhalt erklaeren`);
            assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), raw,
                `Load muss das korrupte Rohpayload ${String(invalidFactor)} erhalten`);
            assertEqual(localStorage.getItem(CONFIG.STORAGE.MIGRATION_FLAG), null,
                `Load darf fuer ${String(invalidFactor)} keinen Migrationsmarker setzen`);
        }

        installMockLocalStorage();
        let saveThrown = null;
        try {
            StorageManager.saveState({
                lastState: { cumulativeInflationFactor: Number.POSITIVE_INFINITY }
            });
        } catch (error) {
            saveThrown = error;
        }
        assertEqual(saveThrown?.code, 'CUMULATIVE_INFLATION_FACTOR_INVALID',
            'Save muss den Inflations-Domaenenfehler vor JSON.stringify unverhuellt erhalten');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), null,
            'Fehlgeschlagener Save darf kein null-normalisiertes Inflationspayload schreiben');
    }

    console.log('Test 3: valid taxState.lossCarry is preserved');
    {
        installMockLocalStorage();
        localStorage.setItem(CONFIG.STORAGE.MIGRATION_FLAG, '1');
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
            lastState: {
                taxState: { lossCarry: 1234.56 }
            }
        }));

        const loaded = StorageManager.loadState();

        assertClose(loaded.lastState.taxState.lossCarry, 1234.56, 1e-9, 'Gueltiger Verlusttopf bleibt erhalten');
    }

    console.log('Test 4: invalid storage JSON throws StorageError');
    {
        installMockLocalStorage();
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, 'nicht-json{{{');

        let thrown = null;
        try {
            StorageManager.loadState();
        } catch (err) {
            thrown = err;
        }

        assert(thrown instanceof StorageError, 'Ungueltiges JSON wirft den echten StorageError');
    }

    // SV-1: Zurückholen setzt den ganzen Haushalt auf den Punkt; fremde Schlüssel und das Archiv bleiben.
    console.log('Test 5: snapshot restore uses archive, restores the whole household and keeps unrelated keys plus snapshot history');
    {
        let reloadCount = 0;
        installMockLocalStorage();
        global.location = { reload: () => { reloadCount += 1; } };

        localStorage.setItem(PROFILE_STORAGE_KEYS.current, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.active, 'default');
        localStorage.setItem(PROFILE_STORAGE_KEYS.registry, JSON.stringify({
            version: 1,
            currentProfileId: 'default',
            profiles: {
                default: { meta: { name: 'Default' }, data: {} },
                other: { meta: { name: 'Other' }, data: { profile_tagesgeld: '999' } }
            }
        }));
        const snapshot = await SnapshotArchive.createSnapshot({
            id: 'contract-restore',
            label: 'Monatsabschluss 2026-05',
            kind: SNAPSHOT_KINDS.monthlyClosePreMutation,
            createdAt: '2026-05-12T10:00:00.000Z',
            activeProfileId: 'default',
            activeProfileName: 'Default',
            records: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 30000 } }),
                [PROFILE_STORAGE_KEYS.current]: 'default',
                [PROFILE_STORAGE_KEYS.active]: 'default',
                [PROFILE_STORAGE_KEYS.registry]: JSON.stringify({ version: 1, profiles: { default: { meta: { name: 'Default' }, data: { profile_tagesgeld: '50000' } } } }),
                depot_tranchen: JSON.stringify([{ schemaVersion: 2, trancheId: 't1', name: 'Muster Aktien-ETF', type: 'aktien_alt', category: 'equity', ticker: 'VWRL.DE',
                    isin: 'IE00B3RBWM25', shares: 10, purchasePrice: 50, currentPrice: 100, purchaseDate: '2016-06-15', tqf: 0.3, taxExempt: false, notes: '' }]),
                profile_tagesgeld: '50000',
                balance_expenses_2026: JSON.stringify({ activeYear: 2026, years: { 2026: { months: { 1: { profiles: { default: { categories: { Wohnen: -1 } } } } } } } })
            }
        });

        localStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ inputs: { floorBedarf: 1 } }));
        localStorage.setItem('unrelated_private_export', 'old');

        const restoreGuard = createNavigationGuard();
        await StorageManager.restoreSnapshot(snapshot.id, { guard: restoreGuard });

        assertEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE.LS_KEY)).inputs.floorBedarf, 30000, 'Restore ersetzt den Balance-State');
        assertEqual(JSON.parse(localStorage.getItem('depot_tranchen'))[0].trancheId, 't1', 'Restore stellt Tranchen wieder her');
        assertEqual(localStorage.getItem('profile_tagesgeld'), '50000', 'Restore stellt Profilwerte wieder her');
        assert(localStorage.getItem('balance_expenses_2026'), 'Ganzer Haushalt: Ausgaben kommen mit zurück');
        assertEqual(localStorage.getItem('unrelated_private_export'), 'old', 'Restore laesst nicht erlaubte fremde Keys unveraendert');
        assert(await SnapshotArchive.readSnapshot(snapshot.id), 'Restore behaelt den verwendeten Snapshot im Archiv');
        const registry = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEYS.registry));
        assert(!registry.profiles.other, 'Ganzer Haushalt: eine Person, die es im Punkt nicht gab, entfällt');
        assertEqual(registry.profiles.default.data.profile_tagesgeld, '50000', 'Restore setzt die Registry auf den Punkt');
        assertEqual(reloadCount, 1, 'Restore triggert genau einen Reload');
        assert(restoreGuard.isBusy(), 'Reload-Doppel hält die quittierte Dokumentreservierung');
        restoreGuard.revokeNative(); // Das Doppel ersetzt kein Dokument; Testgrenze explizit beenden.
        assertEqual(restoreGuard.isBusy(), false, 'Simulierter Dokumentwechsel gibt nur den Testguard frei');
    }

    console.log('Test 11: Verlauf-Roundtrip und Validierung vor jeglichem Write');
    {
        installMockLocalStorage();
        const entry = { id: 'manual:2026-12-31', asOf: '2026-12-31', reason: 'manual', periodId: null,
            tagesgeld: 12000, geldmarktEtf: 23000, depotwertAlt: 34000, depotwertNeu: 45000, aktienEtf: 79000, total: 114000 };
        const annual = { ...entry, id: 'annual:2026', reason: 'annual_close', periodId: 'calendar-year:2026' };
        const history = { schemaVersion: 1, entries: [annual, entry] };
        StorageManager.saveState({ inputs: {}, wealthHistory: history });
        assertEqual(JSON.stringify(StorageManager.loadState().wealthHistory), JSON.stringify(history), 'Speichern und Laden erhalten jedes Verlauffeld');
        const oldRaw = localStorage.getItem(CONFIG.STORAGE.LS_KEY);
        for (const invalid of [null, undefined, { schemaVersion: 2, entries: [] }, { schemaVersion: 1, entries: [{ ...entry, total: 0 }] }]) {
            let error;
            try { StorageManager.saveState({ inputs: {}, wealthHistory: invalid }); } catch (caught) { error = caught; }
            assert(error instanceof WealthHistoryError, 'Ungültiges Speichern wird kontrolliert abgelehnt');
            assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), oldRaw, 'Ungültiges Speichern verändert den Bestand nicht');
        }
        installMockLocalStorage();
        const corruptRaw = JSON.stringify({ inputs: {}, wealthHistory: { ...history, entries: [{ ...entry, asOf: '2026-02-30' }] } });
        localStorage.setItem(CONFIG.STORAGE.LS_KEY, corruptRaw);
        let loadError;
        try { StorageManager.loadState(); } catch (caught) { loadError = caught; }
        assert(loadError instanceof WealthHistoryError, 'Ungültiger Verlauf wird beim Laden sichtbar abgelehnt');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.LS_KEY), corruptRaw, 'Laden repariert oder überschreibt keinen beschädigten Verlauf');
        assertEqual(localStorage.getItem(CONFIG.STORAGE.MIGRATION_FLAG), null, 'Validierung erfolgt vor Migrationswrites');
    }

    // SV-1: Zurückholen gilt für den ganzen Haushalt, auch für den Vermögensverlauf; ein beschädigter Verlauf im Punkt sperrt.
    console.log('Test 12: Snapshot-Restore setzt den Verlauf auf den Punkt und validiert ihn vorher');
    {
        installMockLocalStorage();
        const restoreGuard = createNavigationGuard();
        let reloads = 0;
        global.location = { reload() { reloads += 1; } };
        const entry = { id: 'manual:2026-10-02', asOf: '2026-10-02', reason: 'manual', periodId: null,
            tagesgeld: 12000, geldmarktEtf: 23000, depotwertAlt: 34000, depotwertNeu: 45000, aktienEtf: 79000, total: 114000 };
        const history = { schemaVersion: 1, entries: [entry] };
        const registry = { version: 1, profiles: { default: { meta: { id: 'default', name: 'Default' }, data: {} } } };
        const records = { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: {}, wealthHistory: history }),
            [PROFILE_STORAGE_KEYS.registry]: JSON.stringify(registry), [PROFILE_STORAGE_KEYS.active]: 'default', [PROFILE_STORAGE_KEYS.current]: 'default' };
        for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
        const snapshot = await SnapshotArchive.createSnapshot({ kind: SNAPSHOT_KINDS.monthlyClosePreMutation, records, activeProfileId: 'default' });
        const today = { schemaVersion: 1, entries: [{ ...entry, id: 'manual:2026-10-20', asOf: '2026-10-20' }] };
        StorageManager.saveState({ inputs: {}, wealthHistory: today });
        await StorageManager.restoreSnapshot(snapshot.id, { guard: restoreGuard });
        restoreGuard.revokeNative(); // Reload-Doppel: nächsten simulierten Dokumentstand beginnen.
        resetPersistenceForTests(createLocalStorageAdapter(() => global.localStorage));
        assertEqual(JSON.stringify(StorageManager.loadState().wealthHistory), JSON.stringify(history), 'Restore setzt den Live-Verlauf auf den Stand des Punkts');
        assertEqual(localStorage.getItem(PROFILE_STORAGE_KEYS.registry), records[PROFILE_STORAGE_KEYS.registry], 'Restore setzt die Registry bytegleich zurück');
        const corruptSnapshot = await SnapshotArchive.createSnapshot({ kind: SNAPSHOT_KINDS.monthlyClosePreMutation, records: { ...records,
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: {}, wealthHistory: { schemaVersion: 1, entries: [{ ...entry, total: 0 }] } }) }, activeProfileId: 'default' });
        const before = JSON.stringify(Array.from(localStorage.store.entries()));
        let error;
        try { await StorageManager.restoreSnapshot(corruptSnapshot.id, { guard: restoreGuard }); } catch (caught) { error = caught; }
        assert(error instanceof WealthHistoryError, 'Ein beschädigter Snapshot-Verlauf wird vor Restorewrites abgewiesen');
        assertEqual(JSON.stringify(Array.from(localStorage.store.entries())), before, 'Fehlerhafter Restore verändert weder Live-State noch Registry');
        assertEqual(reloads, 1, 'Abgewiesener Restore meldet keinen Erfolg durch Reload');
        const legacySnapshot = await SnapshotArchive.createSnapshot({ kind: SNAPSHOT_KINDS.monthlyClosePreMutation, records: { ...records, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: {} }) }, activeProfileId: 'default' });
        await StorageManager.restoreSnapshot(legacySnapshot.id, { guard: restoreGuard });
        restoreGuard.revokeNative();
        resetPersistenceForTests(createLocalStorageAdapter(() => global.localStorage));
        // Ein Altpunkt ohne Verlauf bleibt lesbar; zurück kommt sein Stand ohne Verlauf.
        assertEqual(readWealthHistory(StorageManager.loadState()).entries.length, 0, 'Altpunkt ohne Verlauf wird ohne Verlauf zurückgeholt');
    }

    console.log('Balance storage contract tests passed');
} finally {
    resetPersistenceForTests(createLocalStorageAdapter());
    if (prevLocation === undefined) delete global.location; else global.location = prevLocation;
    if (prevLocalStorage === undefined) delete global.localStorage; else global.localStorage = prevLocalStorage;
}

console.log('--- Balance Storage Contract Tests Completed ---');
