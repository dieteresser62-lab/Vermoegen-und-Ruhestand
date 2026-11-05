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
/**
 * @param point Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function snapshotTitle(point) {
    if (point.kind === 'profile-management-before') return displaySnapshotMonths(point.label);
    if (Object.hasOwn(snapshotTitles, point.kind)) {
        const period = /(?:Jahresabschluss|Monatsabschluss) (\d{4}(?:-\d{2})?)$/.exec(point.label || '');
        return snapshotTitles[point.kind] + (period ? ' ' + displaySnapshotMonths(period[1]) : '');
    }
    if (point.kind === 'manual' || !point.kind) return displaySnapshotMonths(point.label || 'Manuell angelegter Stand');
    return 'Wiederherstellungspunkt';
}
// Dieselben Sperren wie bisher, gemeinsam für Zusammenfassung und Zeilenaktion.
/**
 * @param point Wert für den bestehenden Aufrufvertrag.
 * @param model Bestehendes Lesemodell.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function snapshotBlockReason(point, model) {
    if (model.archiveError) return 'archive';
    if (model.trialActive) return 'trial-active';
    if (point.kind === 'probelauf-before') return 'probelauf';
    if (isFullImportRecoverySnapshot(point)) return null;
    if (!point.activeProfileId) return 'unassigned';
    return model.profileIds && !model.profileIds.includes(point.activeProfileId) ? 'removed-person' : null;
}

/** Nur Anzeige: gespeicherte Titel und Periodenschlüssel bleiben unverändert.
 *
 * @param label Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function displaySnapshotMonths(label) {
    return String(label).replace(/\b(\d{4})-(0[1-9]|1[0-2])\b/g, (_, year, month) =>
        new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }));
}
/**
 * @param point Wert für den bestehenden Aufrufvertrag.
 * @param model Bestehendes Lesemodell.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function isArchivedTrialPoint(point, model) {
    return !model.trialActive && point.kind === 'probelauf-before' && point.id !== model.activeTrialSnapshotId;
}
/**
 * @param points Wert für den bestehenden Aufrufvertrag.
 * @param model Bestehendes Lesemodell.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function snapshotGroups(points, model) {
    const names = ['Monatsabschluss', 'Jahresabschluss', 'Import und Einspielen', 'Löschen und Haushalt', 'Spielbereich', 'Sonstiges', 'Spielbereich (nur Archiv)'];
    const groups = names.map(title => ({ title, archive: title === 'Spielbereich (nur Archiv)', points: [] }));
    for (const point of [...points].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)))) {
        const index = isArchivedTrialPoint(point, model) ? 6
            : point.kind === 'monthly-close-pre-mutation' || point.kind === 'manual' && /^Monatsabschluss \d{4}-\d{2}$/.test(point.label) ? 0
            : point.kind === 'annual-close-pre-mutation' ? 1
            : ['full-backup-import-recovery', 'balance-import-recovery', 'before-restore-recovery'].includes(point.kind) ? 2
            : ['profile-management-before', 'new-beginning-before'].includes(point.kind) ? 3
            : ['probelauf-before', 'probelauf-transfer-before'].includes(point.kind) ? 4 : 5;
        groups[index].points.push(point);
    }
    return groups.filter(group => group.points.length);
}
