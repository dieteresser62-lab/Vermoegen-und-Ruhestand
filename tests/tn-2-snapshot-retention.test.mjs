import { buildSnapshot, SNAPSHOT_KINDS as K } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRetentionPlan, previewSnapshotRetention, executeSnapshotRetention } from '../app/shared/snapshot-retention.js';

// Nur Arten, Zeitpunkte und leere Profilhüllen; keine Archiv- oder Haushaltsinhalte.
const fullScope = { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' };
const restoreScope = { profileRegistryMode: 'restore-target-profile', profileLiveDataMode: 'restore-previous-live', targetProfileId: 'synthetic' };
const make = (id, kind, createdAt, scope) => buildSnapshot({ id, kind, createdAt, activeProfileId: 'synthetic',
    records: { rs_profiles_v1: '{"profiles":{"synthetic":{"data":{}}}}' }, ...(scope ? { restoreScope: scope } : {}) });
const archivePoints = [
    ...Array.from({ length: 15 }, (_, i) => make(`full-${i + 1}`, K.fullBackupImportRecovery,
        i === 14 ? '2026-11-02T12:00:00Z' : `2026-10-${13 + i}T12:00:00Z`, fullScope)),
    ...Array.from({ length: 6 }, (_, i) => make(`trial-${i + 1}`, K.probelaufBefore, `2026-10-${i < 3 ? '13' : '14'}T1${i % 3}:00:00Z`)),
    ...Array.from({ length: 2 }, (_, i) => make(`restore-${i + 1}`, K.beforeRestoreRecovery, `2026-10-29T1${i}:00:00Z`, restoreScope)),
    ...Array.from({ length: 2 }, (_, i) => make(`plan-${i + 1}`, K.householdPlanMigrationRecovery, `2026-10-2${i}T12:00:00Z`)),
    make('persons', K.profileManagementBefore, '2026-10-22T12:00:00Z', fullScope),
    make('manual-1', K.manual, '2026-10-30T12:00:00Z'), make('manual-2', K.manual, '2026-10-31T12:00:00Z')
];
for (const [date, expected] of [['2026-11-02', 28], ['2026-12-15', 9]]) {
    const points = new Map(archivePoints.map(point => [point.id, point]));
    const records = { sim_reference: '{"recoverySnapshotId":"full-1"}' };
    const persistence = { readPersistedRecords: async () => ({ ...records }), listSnapshots: async () => [...points.values()],
        readSnapshot: async id => points.get(id), deleteSnapshot: async id => { points.delete(id); } };
    const preview = await previewSnapshotRetention({ persistence, now: new Date(date + 'T12:00:00Z') });
    const result = await executeSnapshotRetention(preview, { persistence });
    assertEqual(result.status, 'cleaned', date + ': Archivtest vollständig bestätigt');
    assertEqual(archivePoints.length, 28, date + ': Ausgangsarchiv 28 Punkte');
    assertEqual(points.size, expected, date + ': verbleibende Punkte ' + expected);
    assert(points.has('full-1'), date + ': verwiesener Vollimportpunkt bleibt');
    for (const id of ['plan-1', 'plan-2', 'persons']) assert(points.has(id), date + ': Dauerpunkt bleibt: ' + id);
    if (date === '2026-12-15') {
        assertEqual([...points.keys()].sort().join(','), 'full-1,full-14,full-15,manual-2,persons,plan-1,plan-2,restore-2,trial-6', 'Je Art, Umfang und Monat bleibt der letzte plus der verwiesene Punkt');
        assertEqual((await previewSnapshotRetention({ persistence, now: preview.now })).remove.length, 0, 'Archivtest ist nach Ausführung idempotent');
    }
    console.log(`TN-2 Archivtest ${date}: ${archivePoints.length} -> ${points.size}; entfernt ${result.deleted.length}`);
}

const now = new Date('2026-12-15T12:00:00Z');
const old = make('old', K.fullBackupImportRecovery, '2026-10-13T12:00:00Z', fullScope);
const newer = make('newer', K.fullBackupImportRecovery, '2026-10-14T12:00:00Z', fullScope);
const removed = points => buildSnapshotRetentionPlan(points, { now }).remove.map(point => point.id).join(',');
assertEqual(removed([old, newer]), 'old', 'Ganzer Bestand deckt älteren Ganzbestand mit gleicher Keypolicy');
assertEqual(removed([old, { ...newer, activeProfileId: '' }]), 'old', 'Ganzbestand braucht keine aktive Person');
assertEqual(removed([old, make('profile', K.manual, newer.createdAt)]), '', 'Personenpunkt deckt keinen Ganzbestand');
assertEqual(removed([old, { ...newer, restoreScope: { ...fullScope, liveKeyMode: 'snapshot-full' } }]), '', 'Andere Ganzbestand-Keypolicy deckt Vollimport nicht');
assertEqual(removed([old, { ...newer, damaged: true }]), '', 'Beschädigter Ganzbestand bietet keine Deckung');
assertEqual(removed([old, { ...newer, records: { rs_profiles_v1: '{broken' }, recordCount: 1 }]), '', 'Unlesbarer Ganzbestand bietet keine Deckung');
assertEqual(removed([old, { ...newer, records: { rs_profiles_v1: '[]' }, recordCount: 1 }]), '', 'Beschädigte Profilstruktur bietet keine Ganzbestand-Deckung');
assertEqual(removed([{ ...old, records: { rs_profiles_v1: '{broken' }, recordCount: 1 }, newer]), '', 'Unlesbarer alter Ganzbestand bleibt');
assertEqual(removed([old, { ...newer, records: undefined }]), '', 'Reiner Indexeintrag bietet keine Deckung');
assertEqual(removed([old, { ...newer, restoreScope: { ...fullScope, liveKeyMode: 'future' } }]), '', 'Unbekannter Umfang bietet keine Deckung');

for (const kind of [K.fullBackupImportRecovery, K.balanceImportRecovery, K.beforeRestoreRecovery, K.probelaufBefore]) {
    const scope = kind === K.fullBackupImportRecovery ? fullScope : kind === K.beforeRestoreRecovery ? restoreScope : undefined;
    const first = make('first', kind, '2026-10-13T12:00:00Z', scope), last = make('last', kind, '2026-10-14T12:00:00Z', scope);
    assertEqual(buildSnapshotRetentionPlan([first, last], { now: new Date('2026-11-12T12:00:00Z') }).remove.length, 0, kind + ': genau 30 Tage geschützt');
    assertEqual(removed([first, last]), 'first', kind + ': danach älterer Monatsstand löschbar');
    assertEqual(buildSnapshotRetentionPlan([first, last], { now, neededIds: ['first'] }).remove.length, 0, kind + ': benötigter Punkt immer geschützt');
}
for (const kind of [K.annualClosePreMutation, K.householdPlanMigrationRecovery, K.personDataMigrationRecovery,
    K.newBeginningBefore, K.probelaufTransferBefore, K.profileManagementBefore, 'future-kind']) {
    assertEqual(removed([make('permanent', kind, old.createdAt, fullScope), newer]), '', kind + ': Dauerpunkt wird nicht aufgeräumt');
}

const persons = make('persons', K.profileManagementBefore, old.createdAt, fullScope);
for (const damaged of [false, true]) {
    const item = damaged ? { ...persons, records: { rs_profiles_v1: '{broken' }, recordCount: 1 } : persons;
    const persistence = { readPersistedRecords: async () => ({}), listSnapshots: async () => [item], readSnapshot: async () => item };
    const preview = await previewSnapshotRetention({ persistence, now });
    assertEqual(preview.individualRemove.length, damaged ? 0 : 1, 'Personenverwaltung: nur lesbare Punkte einzeln löschbar');
}

const until = buildSnapshotRetentionPlan([newer], { now: new Date('2026-11-02T12:00:00Z') });
assertEqual(until.keep[0].reason, 'Rückholpunkt – bleibt bis 13.11.2026', 'Junger Rückholpunkt nennt sein Aufbewahrungsdatum');
