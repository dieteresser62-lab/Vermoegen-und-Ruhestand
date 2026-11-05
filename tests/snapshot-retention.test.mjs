import { buildSnapshot, SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { buildSnapshotRetentionPlan, previewSnapshotRetention, executeSnapshotRetention, snapshotOccasion } from '../app/shared/snapshot-retention.js';
const now = new Date('2026-03-31T12:00:00Z');
const point = (id, createdAt, activeProfileId = 'a', extra = {}) => buildSnapshot({ id, createdAt, activeProfileId,
    records: { rs_profiles_v1: JSON.stringify({ profiles: { [activeProfileId]: { meta: { name: activeProfileId }, data: {} } } }) }, ...extra });
const points = [point('boundary', new Date(now.getTime() - 30 * 86400000).toISOString()),
    point('recent', '2026-03-15T12:00:00Z'), point('jan-old', '2026-01-01T12:00:00Z'), point('jan-last', '2026-01-31T12:00:00Z'),
    point('feb-old', '2026-02-01T12:00:00Z'), point('feb-last', '2026-02-28T12:00:00Z'),
    point('b-old', '2026-01-01T12:00:00Z', 'b'), point('b-last', '2026-01-30T12:00:00Z', 'b'),
    point('dec', '2025-12-31T12:00:00Z'), point('tie-a', '2025-11-01T12:00:00Z'), point('tie-z', '2025-11-01T12:00:00Z'),
    point('annual', '2025-01-01T12:00:00Z', 'a', { kind: 'annual-close-pre-mutation' }),
    point('migration', '2025-01-02T12:00:00Z', 'a', { kind: 'person-data-migration-recovery' }),
    point('full', '2025-01-03T12:00:00Z', 'a', { kind: 'full-backup-import-recovery' }),
    point('undo', '2025-01-04T12:00:00Z', 'a', { kind: 'before-restore-recovery' }),
    point('trial', '2025-01-05T12:00:00Z', 'a', { kind: 'probelauf-before' }),
    point('unknown', '2025-01-06T12:00:00Z', 'a', { kind: 'future-kind' }),
    point('missing-profile', '2025-01-07T12:00:00Z', ''),
    point('different-scope', '2026-01-01T12:00:00Z', 'a', { restoreScope: { profileRegistryMode: 'restore-target-profile' } }),
    { ...point('damaged', '2025-01-08T12:00:00Z'), damaged: true },
    point('bad-state', '2026-01-30T12:00:00Z', 'a', { records: { rs_profiles_v1: '{"profiles":{"a":{"data":{}}}}', ruhestandsmodellValues_v29_guardrails: '{broken' } }),
    { id: 'bad-date', createdAt: 'not a date', kind: 'manual', activeProfileId: 'a' }];
const plan = buildSnapshotRetentionPlan(points, { now });
assertEqual(plan.remove.map(item => item.id).sort().join(','), 'b-old,feb-old,jan-old,tie-a', 'Nur ältere Nichtvertreter mit passender jüngerer Deckung werden entfernt');
for (const id of ['boundary', 'recent', 'jan-last', 'feb-last', 'b-last', 'dec', 'tie-z', 'annual', 'migration', 'full', 'undo', 'trial', 'unknown', 'missing-profile', 'different-scope', 'damaged', 'bad-date', 'bad-state'])
    assert(plan.keep.some(item => item.id === id), 'Erhalten: ' + id);
assertEqual(plan.keep.find(item => item.id === 'boundary').reason, 'Innerhalb von einschließlich 30 Tagen', 'Grenze exakt 30 Tage eingeschlossen');
assertEqual(buildSnapshotRetentionPlan([point('last', '2020-01-01T12:00:00Z')], { now }).remove.length, 0, 'Letzter nicht abgedeckter Stand bleibt');
assertEqual(buildSnapshotRetentionPlan(points.filter(item => !plan.remove.some(entry => entry.id === item.id)), { now }).remove.length, 0, 'Wiederholtes Aufräumen ist idempotent');
assert(!buildSnapshotRetentionPlan(points, { now, neededIds: ['jan-old'] }).remove.some(item => item.id === 'jan-old'), 'Benötigter Recoverybezug schützt auch manuellen Altpunkt');
assertEqual(buildSnapshotRetentionPlan([point('tie-a', '2025-11-01T12:00:00Z'), point('tie-z', '2025-11-01T12:00:00Z')], { now }).remove.length, 0, 'Gleichstand allein ist keine jüngere Deckung');
assertEqual(snapshotOccasion({ kind: 'manual', label: 'Monatsabschluss 2026-01' }), 'Monatsabschluss', 'Alter Monatsanlass erkannt');
assertEqual(snapshotOccasion({ kind: 'monthly-close-pre-mutation' }), 'Monatsabschluss', 'Neuer Monatsanlass erkannt');
assert(snapshotOccasion({ kind: 'annual-close-pre-mutation' }).includes('dauerhaft'), 'Jahrespunkt als dauerhaft gekennzeichnet');

for (const outcome of ['success', 'archive-change', 'failure', 'partial', 'mid-change', 'reference', 'nested-reference', 'invalid-reference', 'trial']) {
    const saved = new Map(points.filter(point => !['bad-date', 'damaged'].includes(point.id)).map(point => [point.id, point]));
    const records = {}, deleted = []; let attempts = 0;
    const persistence = { readPersistedRecords: async () => records,
        listSnapshots: async () => [...saved.values()], readSnapshot: async id => saved.get(id),
        deleteSnapshot: async id => {
            attempts++;
            if (outcome === 'failure' || outcome === 'partial' && attempts === 2) throw new Error('DELETE_FAILED');
            saved.delete(id); deleted.push(id);
            if (outcome === 'mid-change') saved.set('extra', point('extra', '2026-03-30T12:00:00Z'));
        } };
    if (outcome === 'reference') records.balance = '{"pendingCommit":{"snapshotId":"jan-old"}}';
    if (outcome === 'nested-reference') records.rs_profiles_v1 = JSON.stringify({ profiles: { other: { data: { state: '{"pendingCommit":{"snapshotId":"jan-old"}}' } } } });
    if (outcome === 'invalid-reference') records.rs_profiles_v1 = '{"broken"';
    if (outcome === 'trial') records.rs_probelauf_state_v1 = 'active';
    let preview, error;
    try { preview = await previewSnapshotRetention({ persistence, now }); } catch (caught) { error = caught; }
    if (outcome === 'trial') { assert(error, 'Spielbereich verhindert Aufräumen'); continue; }
    if (outcome.includes('reference')) {
        assert(!preview.remove.some(item => item.id === 'jan-old'), outcome + ': Referenzprojektion schützt Stand');
        if (outcome === 'invalid-reference') assertEqual(preview.remove.length, 0, 'Beschädigte Referenzquelle bleibt konservativ ohne Löschung');
    }
    if (outcome === 'archive-change') saved.set('extra', point('extra', '2026-03-30T12:00:00Z'));
    const result = await executeSnapshotRetention(preview, { persistence, archive: SnapshotArchive });
    if (outcome === 'success') {
        assertEqual(result.status, 'cleaned', 'Aufräumen bestätigt Abschluss');
        assertEqual(result.deleted.length, 4, 'Genau vier gedeckte Stände entfernt');
        assertEqual((await previewSnapshotRetention({ persistence, now })).remove.length, 0, 'Ausgeführter Löschplan bleibt idempotent');
    }
    if (['failure', 'archive-change'].includes(outcome)) {
        assertEqual(result.status, 'failed', outcome + ': kein falscher Abschluss');
        assertEqual(result.deleted.length, 0, outcome + ': kein bestätigtes Delete');
    }
    if (['partial', 'mid-change'].includes(outcome)) {
        assertEqual(result.status, 'partial', outcome + ': ehrlicher Teilstatus');
        assertEqual(result.deleted.length, 1, outcome + ': nur tatsächlich bestätigtes Delete gezählt');
        assertEqual(attempts, outcome === 'partial' ? 2 : 1, outcome + ': Fehler stoppt weitere Löschungen');
    }
}

const planMigrationPoints = [
    point('new-plan', '2026-01-01T10:00:00Z', 'a', { kind: 'household-plan-migration-recovery', label: 'Vor Umstellung Haushalt & Plan' }),
    point('old-plan', '2026-01-02T10:00:00Z', 'a', { kind: 'manual', label: 'Vor Umstellung Haushalt & Plan' }),
    point('comparison', '2026-01-03T10:00:00Z', 'a', { kind: 'manual', label: 'Manueller Vergleich' }),
    point('covering-month', '2026-01-31T10:00:00Z', 'a', { kind: 'monthly-close-pre-mutation' })
];
const migrationRetention = buildSnapshotRetentionPlan(planMigrationPoints, { now });
assertEqual(migrationRetention.remove.map(item => item.id).join(','), 'comparison', 'Neuer und alter Umstellungspunkt bleiben über 30 Tage trotz deckendem Monatspunkt');
for (const migration of planMigrationPoints.slice(0, 2)) assertEqual(snapshotOccasion(migration), 'Planumstellung · dauerhaft', 'Neue und alte Planumstellung ist dauerhaft beschriftet');
assertEqual(snapshotOccasion({ kind: 'manual', label: 'Vor Umstellung Haushalt & Plan ' }), 'Manuell', 'Nur exakt benannter manueller Altpunkt wird geschützt');
