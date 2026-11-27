import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PersistenceFacade } from './persistence-facade.js';
import { isLegacySnapshotKey } from './persistence-key-policy.js';

// Archivkopien im Hauptspeicher (localStorage-Fallback und Altbestand) sind kein Livebestand.
const ARCHIVE_RECORD_KEY = 'rs_snapshot_archive_v1';

// SV-1 (Nutzer 18.11.2026 „12 / immer / 3“): Monatspunkte der letzten 12 Monate, Jahresabschluss-Punkte immer,
// Punkte vor dem Einspielen bzw. Zurückholen die letzten 3. Gekürzt wird nur innerhalb derselben Art.
export const RETENTION = Object.freeze({ months: 12, imports: 3 });

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id));
/** @param {{createdAt: string}} point @returns {string} Kalendermonat in Ortszeit. */
const monthOf = point => {
    const date = new Date(point.createdAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** Läuft über alle Objekte im Livebestand, auch in JSON-Texten; Archivkopien zählen nicht.
 * @param {Record<string, string>} records @param {(value: Record<string, unknown>) => void} onObject @returns {boolean} `false`, wenn ein Record nicht lesbar ist. */
function walkLiveRecords(records, onObject) {
    let readable = true;
    const visit = value => {
        if (typeof value === 'string') {
            if (!/^\s*[[{]/.test(value)) return;
            try { visit(JSON.parse(value)); } catch { readable = false; }
            return;
        }
        if (!value || typeof value !== 'object') return;
        onObject(value);
        Object.values(value).forEach(visit);
    };
    visit(Object.fromEntries(Object.entries(records || {}).filter(([key]) => key !== ARCHIVE_RECORD_KEY && !isLegacySnapshotKey(key))));
    return readable;
}

/** Kennungen, auf die gespeicherte Vorgänge verweisen: offener Jahresabschluss (`pendingCommit.snapshotId`) und der alte Spielbereich.
 * Gesucht wird nur im Livebestand, nicht in Archivkopien. Ist ein Record nicht lesbar, liefert die Funktion `null`; dann wird nichts gekürzt.
 * @param {Record<string, string>} records @returns {string[]|null} */
export function referencedSnapshotIds(records) {
    const ids = new Set();
    const readable = walkLiveRecords(records, value => {
        for (const [key, item] of Object.entries(value)) {
            if (['snapshotId', 'recoverySnapshotId'].includes(key) && typeof item === 'string') ids.add(item);
            if (key === 'archiveIds' && Array.isArray(item)) item.forEach(id => ids.add(String(id)));
        }
    });
    return readable ? [...ids] : null;
}

/** SV-1c: Punkte, auf die ein offener Jahresabschluss im Livebestand verweist (`pendingCommit.snapshotId`), egal welcher Art.
 * @param {Record<string, string>} records @returns {string[]|null} `null`, wenn ein Record nicht lesbar ist. */
export function pendingCommitSnapshotIds(records) {
    const ids = new Set();
    const readable = walkLiveRecords(records, value => {
        const pending = /** @type {{snapshotId?: unknown}|null|undefined} */ (value.pendingCommit);
        if (pending && typeof pending === 'object' && typeof pending.snapshotId === 'string') ids.add(pending.snapshotId);
    });
    return readable ? [...ids] : null;
}

/** Reiner Plan: Kennungen der Punkte einer Art, die wegfallen. Beschädigte Punkte zählen mit, geschützte bleiben immer.
 * @param {{id: string, kind: string, createdAt: string}[]} points @param {string} kind
 * @param {{protectedIds?: string[]}} [options] @returns {string[]} */
export function planRestorePointPruning(points, kind, { protectedIds = [] } = {}) {
    const keep = new Set(protectedIds);
    const same = points.filter(point => point.kind === kind).sort(newestFirst);
    if (kind === SNAPSHOT_KINDS.monthlyClosePreMutation) {
        const months = new Set();
        return same.filter(point => {
            const month = monthOf(point);
            const newestOfMonth = !months.has(month);
            months.add(month);
            return !keep.has(point.id) && !(newestOfMonth && months.size <= RETENTION.months);
        }).map(point => point.id);
    }
    if (kind === SNAPSHOT_KINDS.fullBackupImportRecovery) {
        return same.slice(RETENTION.imports).filter(point => !keep.has(point.id)).map(point => point.id);
    }
    return [];
}

/** Kürzt eine Art nach erfolgreichem Abschluss des Vorgangs. Ein Fehler hier ändert das Ergebnis des Vorgangs nicht; die Punkte
 * bleiben dann bis zum nächsten neuen Punkt dieser Art liegen.
 * @param {string} kind
 * @param {{storage?: any, archive?: typeof SnapshotArchive, protectedIds?: string[], records?: Record<string, string>, navigationOperation?: unknown}} [options]
 * @returns {Promise<{deleted: string[], error?: Error}>} */
export async function pruneRestorePoints(kind, { storage = PersistenceFacade, archive = SnapshotArchive, protectedIds = [], records, navigationOperation } = {}) {
    const deleted = [];
    try {
        const source = records ?? (typeof storage.readPersistedRecords === 'function' ? await storage.readPersistedRecords() : {});
        const referenced = referencedSnapshotIds(source);
        if (referenced === null) return { deleted };
        const plan = planRestorePointPruning(await archive.listSnapshots({ storage }), kind, { protectedIds: [...protectedIds, ...referenced] });
        for (const id of plan) {
            await archive.deleteSnapshot(id, { storage, navigationOperation });
            deleted.push(id);
        }
        return { deleted };
    } catch (error) { return { deleted, error }; }
}
