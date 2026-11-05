import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { initProfileIndexLifecycle, initProfileSubpageLifecycle, whenProfilePageReady } from '../app/profile/profile-navigation.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { buildSnapshot } from '../app/shared/snapshot-archive.js';
import { restoreImportRecoverySnapshot } from '../app/shared/snapshot-restore.js';
import { PARTNERSHIP_KEY, migratePartnershipRecord, readPartnership } from '../app/profile/household-partnership.js';
import { migrateStoredPartnership } from '../app/profile/profile-partnership-migration.js';
import { INCOME_KEY, INCOME_MIGRATION_KEY, incomeFromRecord } from '../app/profile/profile-income.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';

const legacy = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { muster_martin: 0 },
    homeAndTaxInheritance: { muster_martin: true }, testament: { muster_martin: { minimum: 200000, minimumStand: '2026-10' } } });
const explicit = JSON.stringify({ ...JSON.parse(legacy), maritalPropertyRegime: 'community', activeInheritanceRule: { muster_martin: 'home-and-tax' } });
const withoutRegime = ' { "inheritance": {}, "status": "married", "schemaVersion": 1 } ';
async function load(kind) {
    const doc = { documentElement: { dataset: { suitePage: kind } }, contains: () => false,
        addEventListener() {}, getElementById: () => null };
    const win = { addEventListener() {}, location: { reload() {} } };
    await (kind === 'index' ? initProfileIndexLifecycle({ root: doc, win }) : initProfileSubpageLifecycle({ doc, win }));
    assertEqual(await whenProfilePageReady(doc), true, 'Profilstart meldet Bereitschaft');
    await p.flush();
}
for (const kind of ['index', 'balance']) for (const raw of [legacy, explicit, withoutRegime]) {
    const records = { ...createMusterHaushaltRecords('2026-10-27', 'martin-petra'), [PARTNERSHIP_KEY]: raw };
    let writes = 0, fail = false;
    resetPersistenceForTests({ name: 'synthetic', loadAll: async () => ({ ...records }),
        saveBatch: async ({ deletes, upserts }) => {
            if (upserts.some(([key]) => key === PARTNERSHIP_KEY)) { writes++; if (fail) { fail = false; throw new Error('WRITE_FAILED'); } }
            deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => { records[key] = value; });
        } });
    await p.init({ installLifecycleHooks: false });
    await load(kind);
    assertEqual(records[PARTNERSHIP_KEY], migratePartnershipRecord(raw), 'QS-I 2: normaler Seitenstart persistiert die Erbregel');
    assertEqual(writes, raw === legacy ? 1 : 0, 'QS-I 2: nur die alte Vorrangregel löst einen Migrationswrite aus');
    if (raw === withoutRegime) {
        assertEqual(records[PARTNERSHIP_KEY], raw, 'ZG-1c: Start erhält Altdatensatz ohne Güterstand bytegleich');
        assertEqual(readPartnership(p.getItemSync(PARTNERSHIP_KEY)).maritalPropertyRegime, 'community', 'ZG-1c: Güterstand wird nur gelesen');
    }
    await load(kind);
    assertEqual(writes, raw === legacy ? 1 : 0, 'QS-I 2: erneuter Start ist bytegleich ohne Migrationswrite');
    const snapshot = buildSnapshot({ id: 'old', kind: 'full-backup-import-recovery', records: { ...records, [PARTNERSHIP_KEY]: raw } });
    const snapshotBytes = JSON.stringify(snapshot);
    await restoreImportRecoverySnapshot(snapshot);
    await load(kind);
    assertEqual(records[PARTNERSHIP_KEY], migratePartnershipRecord(raw), 'QS-I 2: Laden nach Restore migriert den Livebestand');
    assertEqual(JSON.stringify(snapshot), snapshotBytes, 'QS-I 2: Snapshotbytes bleiben erhalten');
    if (raw === legacy) {
        await restoreImportRecoverySnapshot(snapshot);
        fail = true;
        const warnings = [], warn = console.warn;
        console.warn = (...args) => warnings.push(args);
        try { await load(kind); } finally { console.warn = warn; }
        assertEqual(warnings.length, 1, 'ZG-1c: Migrations-Schreibfehler wird einmal geloggt; Initialisierung gelingt');
        assert(warnings[0][1] instanceof Error, 'ZG-1c: Log erhält den ursprünglichen Schreibfehler');
        assertEqual(records[PARTNERSHIP_KEY], raw, 'QS-I 2: fehlgeschlagene Migration erhält die ursprünglichen Bytes');
        assertEqual(p.getItemSync(PARTNERSHIP_KEY), raw, 'QS-I 2: fehlgeschlagene Migration erhält auch den Cache');
        await load(kind);
        assertEqual(records[PARTNERSHIP_KEY], migratePartnershipRecord(raw), 'QS-I 2: Migration bleibt wiederholbar');
    }
    resetPersistenceForTests();
}

// Echter Bereichsadapter und aktiver Importschutz: kein Partnerschaftswrite,
// auch wenn die alte Vorrangregel noch eine Migration benötigen würde.
for (const backend of ['tauri', 'indexeddb', 'localstorage']) for (const kind of ['index', 'balance']) {
    for (const raw of [withoutRegime, legacy]) {
        const records = { ...createMusterHaushaltRecords('2026-10-28', 'martin-petra'), [PARTNERSHIP_KEY]: raw };
        const f = await playFixture(backend, records);
        let controller = await f.boot();
        const real = f.realBytes();
        await controller.start(() => ({ source: 'copy', testDate: null }));
        controller = await f.boot();
        assertEqual(p.getPersistenceStatus().activeArea, 'spiel', 'ZG-1c: Spielbereich aktiv');
        let attempts = 0;
        const replace = p.replaceRecordsTransactional;
        p.replaceRecordsTransactional = (...args) => { attempts++; return replace(...args); };
        try {
            await load(kind);
            assertEqual(attempts, 0, 'ZG-1c: Initialisierung versucht keinen transaktionalen Partnerschaftswrite');
            assertEqual(await migrateStoredPartnership(), false, 'ZG-1c: Auch direkter Migrationsaufruf schreibt im Spielbereich nicht');
            assertEqual(attempts, 0, 'ZG-1c: Spielbereich wird vor dem Schreibversuch erkannt');
        } finally { p.replaceRecordsTransactional = replace; }
        assertEqual((await p.readPersistedRecords())[PARTNERSHIP_KEY], raw, 'ZG-1c: Partnerschaft bleibt im Spielbereich bytegleich');
        const read = readPartnership(p.getItemSync(PARTNERSHIP_KEY));
        assertEqual(read.maritalPropertyRegime, 'community', 'ZG-1c: Spielbereich liest Zugewinngemeinschaft');
        if (raw === legacy) assertEqual(read.activeInheritanceRule.muster_martin, 'testament', 'ZG-1c: Vorrang wirkt auch ohne Schreibmigration');
        assertEqual(f.realBytes(), real, 'ZG-1c: Start verändert keine echten Daten');
        await controller.end(() => true);
        await f.boot(); await load(kind);
        assertEqual((await p.readPersistedRecords())[PARTNERSHIP_KEY], migratePartnershipRecord(raw), 'ZG-1c: Nötige Vorrangmigration erfolgt erst nach Rückkehr in den echten Bestand');
        p.resetPersistenceRuntimeForTests();
    }
}

// Die beiden anderen automatischen Startmigrationen schreiben über den aktiven
// Fachspeicher. Der Importschutz erlaubt diese Writes ausschließlich in Spiel.
for (const kind of ['index', 'balance']) {
    const records = createMusterHaushaltRecords('2026-10-28');
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const data of [records, ...Object.values(registry.profiles).map(profile => profile.data)]) {
        delete data[INCOME_KEY]; delete data[INCOME_MIGRATION_KEY];
        data.profile_sonstige_einkuenfte = '300';
        data.profile_care_grade_today = '1'; data.profile_care_form_today = 'ambulant';
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    const f = await playFixture('tauri', records);
    let controller = await f.boot(); const real = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
    await load(kind);
    const persisted = await p.readPersistedRecords();
    assertEqual(persisted[INCOME_MIGRATION_KEY], '1', 'ZG-1c: Einkünftemigration bestätigt im Spielbereich');
    assertEqual(incomeFromRecord(persisted)[0].betragMonat, 300, 'ZG-1c: Spielkopie liest übernommene Einkünfte');
    assertEqual(persisted.profile_care_form_today, 'family', 'ZG-1c: Pflegemigration bestätigt im Spielbereich');
    assertEqual(f.realBytes(), real, 'ZG-1c: Einkünfte- und Pflegemigration lassen echte Bytes unverändert');
    await controller.end(() => true);
    p.resetPersistenceRuntimeForTests();
}
