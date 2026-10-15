import { isFullImportRecoverySnapshot } from '../shared/snapshot-restore.js';

const snapshotTitles = {
    'full-backup-import-recovery': 'Vor dem Einspielen einer Sicherung',
    'balance-import-recovery': 'Vor dem Einspielen eines Balance-Stands',
    'before-restore-recovery': 'Vor dem Zurückholen eines früheren Stands',
    'annual-close-pre-mutation': 'Vor dem Jahresabschluss',
    'monthly-close-pre-mutation': 'Vor dem Monatsabschluss',
    'person-data-migration-recovery': 'Vor der Umstellung der Personendaten',
    'household-plan-migration-recovery': 'Vor der Umstellung von Haushalt & Plan',
    'probelauf-before': 'Vor dem Spielbereich',
    'new-beginning-before': 'Vor Neu beginnen',
    'probelauf-transfer-before': 'Vor Übernahme aus dem Spielbereich'
};
export function snapshotTitle(point) {
    if (Object.hasOwn(snapshotTitles, point.kind)) {
        const period = /(?:Jahresabschluss|Monatsabschluss) (\d{4}(?:-\d{2})?)$/.exec(point.label || '');
        return snapshotTitles[point.kind] + (period ? ' ' + period[1] : '');
    }
    if (point.kind === 'manual' || !point.kind) return point.label || 'Manuell angelegter Stand';
    return 'Wiederherstellungspunkt';
}
// Dieselben Sperren wie bisher, gemeinsam für Zusammenfassung und Zeilenaktion.
export function snapshotBlockReason(point, model) {
    if (model.archiveError) return 'archive';
    if (point.kind === 'probelauf-before') return 'probelauf';
    if (isFullImportRecoverySnapshot(point)) return null;
    if (!point.activeProfileId) return 'unassigned';
    return model.profileIds && !model.profileIds.includes(point.activeProfileId) ? 'removed-person' : null;
}
