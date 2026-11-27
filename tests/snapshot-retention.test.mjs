// SV-1 (Nutzer 18.11.2026 „12 / immer / 3“): Aufbewahrung je Art. Nur synthetische Punkte, Testdaten fest im Jahr 2026.
import { buildSnapshot, SnapshotArchive, SNAPSHOT_KINDS as K } from '../app/shared/snapshot-archive.js';
import { planRestorePointPruning, pruneRestorePoints, referencedSnapshotIds, RETENTION } from '../app/shared/snapshot-retention.js';

const point = (id, kind, createdAt) => ({ id, kind, createdAt });
const monthStamp = (year, month, day = 10) => new Date(year, month - 1, day, 12).toISOString();

// 1 · Monatspunkte: je Kalendermonat der jüngste, davon die 12 jüngsten Monate.
{
    const points = [];
    for (let month = 1; month <= 12; month++) points.push(point(`m-2026-${month}`, K.monthlyClosePreMutation, monthStamp(2026, month)));
    points.push(point('m-2025-12', K.monthlyClosePreMutation, monthStamp(2025, 12)));
    points.push(point('m-2026-10-frueh', K.monthlyClosePreMutation, monthStamp(2026, 10, 2)));
    const removed = planRestorePointPruning(points, K.monthlyClosePreMutation);
    assertEqual(removed.sort().join(','), 'm-2025-12,m-2026-10-frueh', 'Monat: ältester 13. Monat und älterer Punkt im selben Monat fallen weg');
    assertEqual(RETENTION.months, 12, 'Monat: 12 Monate');
}
// 2 · Jahresabschluss-Punkte bleiben immer.
{
    const points = Array.from({ length: 20 }, (_, index) => point(`j-${index}`, K.annualClosePreMutation, monthStamp(2000 + index, 1)));
    assertEqual(planRestorePointPruning(points, K.annualClosePreMutation).length, 0, 'Jahresabschluss: alle 20 Punkte bleiben');
}
// 3 · Vor dem Einspielen bzw. Zurückholen: die letzten 3; gekürzt wird nur innerhalb derselben Art.
{
    const points = [1, 2, 3, 4, 5].map(day => point(`e-${day}`, K.fullBackupImportRecovery, monthStamp(2026, 11, day)));
    points.push(point('m-alt', K.monthlyClosePreMutation, monthStamp(2020, 1)));
    assertEqual(planRestorePointPruning(points, K.fullBackupImportRecovery).sort().join(','), 'e-1,e-2', 'Einspielen: die drei jüngsten bleiben');
    assertEqual(RETENTION.imports, 3, 'Einspielen: drei Punkte');
    // Geschützter Quellpunkt bleibt, zählt aber mit.
    assertEqual(planRestorePointPruning(points, K.fullBackupImportRecovery, { protectedIds: ['e-1'] }).join(','), 'e-2', 'Geschützter Quellpunkt bleibt erhalten');
    assertEqual(planRestorePointPruning(points, K.internalRecovery).length, 0, 'Andere Arten werden nicht gekürzt');
}
// 4 · Verweise gespeicherter Vorgänge schützen Punkte; unlesbare Records verhindern jede Kürzung.
{
    const records = { ruhestandsmodellValues_v29_guardrails: JSON.stringify({ annualPeriodMetadata: { pendingCommit: { snapshotId: 'j-offen' } } }) };
    assertEqual(referencedSnapshotIds(records).join(','), 'j-offen', 'Offener Jahresabschluss verweist auf seinen Punkt');
    assertEqual(referencedSnapshotIds({ kaputt: '{nicht lesbar' }), null, 'Unlesbarer Record ergibt keine sichere Verweisliste');
}
// 5 · Echte Kürzung über das Archiv; beschädigte Punkte zählen mit und fallen bei Überzahl weg.
{
    const archive = new Map();
    const storage = { writeSnapshot: async snapshot => { archive.set(snapshot.id, structuredClone(snapshot)); },
        readSnapshot: async id => structuredClone(archive.get(id)), listSnapshots: async () => [...archive.values()].map(({ records, ...entry }) => entry),
        deleteSnapshot: async id => archive.delete(id), readPersistedRecords: async () => ({}) };
    for (const day of [1, 2, 3, 4]) {
        await SnapshotArchive.writeSnapshot(buildSnapshot({ id: `e-${day}`, kind: K.fullBackupImportRecovery, createdAt: monthStamp(2026, 11, day), records: { a: String(day) } }), { storage });
    }
    archive.get('e-2').recordCount = 99; // beschädigt: Nutzdaten passen nicht zur Anzahl
    const result = await pruneRestorePoints(K.fullBackupImportRecovery, { storage, protectedIds: ['e-4'] });
    assertEqual(result.deleted.join(','), 'e-1', 'Kürzung entfernt nur den ältesten Punkt dieser Art');
    assert(archive.has('e-2'), 'Beschädigter Punkt zählt mit und bleibt innerhalb der letzten drei');
    const pending = await pruneRestorePoints(K.fullBackupImportRecovery, { storage,
        records: { state: JSON.stringify({ pendingCommit: { snapshotId: 'e-2' } }) } });
    assertEqual(pending.deleted.length, 0, 'Weniger als drei übrige Punkte: nichts zu kürzen');
    const failing = await pruneRestorePoints(K.fullBackupImportRecovery, { storage: { listSnapshots: async () => { throw new Error('ARCHIV'); } }, records: {} });
    assert(failing.error && failing.deleted.length === 0, 'Ein Archivfehler beim Kürzen wird gemeldet, ändert aber nichts');
}
