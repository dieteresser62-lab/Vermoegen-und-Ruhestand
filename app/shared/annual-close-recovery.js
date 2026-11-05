/** Einheitliche Anzeige auch dann, wenn der Abruf noch keine Ergebnisfelder lieferte.
 *
 * @param result Rückgabe des Jahresabschlusses.
 * @param {{archive?: import("../../typcheck/shared-annual.js").Archive; metadata?: import("../../typcheck/datenvertraege.js").AnnualPeriodMetadata}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export async function projectAnnualCloseRecovery(result, { archive, metadata } = {}) {
    if (result?.status !== 'incomplete_recovery') return null;
    const snapshotId = result.recovery?.snapshotId || result.retryContext?.snapshotId || metadata?.pendingCommit?.snapshotId;
    let snapshot = null;
    try { if (snapshotId) snapshot = await archive.readSnapshot(snapshotId); } catch { /* Die Kennung bleibt als Ladenziel verfügbar. */ }
    return { snapshotId, label: snapshot?.label ?? null, createdAt: snapshot?.createdAt ?? null,
        message: 'Der Jahresabschluss wurde nicht vollständig bestätigt. Bitte den Wiederherstellungspunkt laden und den Jahresstand prüfen.' };
}
