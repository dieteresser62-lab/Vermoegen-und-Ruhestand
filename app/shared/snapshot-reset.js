import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PersistenceFacade } from './persistence-facade.js';
import { PROBELAUF_STATE_KEY } from './persistence-key-policy.js';
import { referencedSnapshotIds, pendingCommitSnapshotIds } from './snapshot-retention.js';
import { appNow } from './app-clock.js';

// SV-1 (Nutzer 18.11.2026 „Neu anfangen“): Beim ersten Start der vereinfachten Sicherung werden die alten Punkte des Haushalts
// entfernt, Jahresabschluss-Punkte ausgenommen (SV-1b). Die Markierung liegt als technische Markierung des echten Bereichs außerhalb der Fachrecords; Vollsicherung, Einspielen,
// Zurückholen und „Neu beginnen“ berühren sie nicht.
export const RESTORE_POINTS_RESET_KEY = 'rs_restore_points_reset_v1';
const BACKUP_KEY = 'overview_last_full_backup_v1';
// Startfolgen schreiben ohne Navigationsbesitz; Löschen und Markierung sind wiederholbar.
/** @returns {import("../../typcheck/speicher-integration.js").Operation} */
const startupOperation = () => /** @type {any} */ ({ check() {}, commit() {}, controller: new AbortController() });

/** @param {unknown} raw gespeicherte Markierung (Objekt oder JSON-Text) @returns {Record<string, any>|null} auch ohne `clearedAt` */
function parseMarker(raw) {
    try {
        /** @type {any} */
        let marker = raw;
        while (typeof marker === 'string') marker = JSON.parse(marker);
        return marker && typeof marker === 'object' && !Array.isArray(marker) ? marker : null;
    } catch { return null; }
}

/** @param {unknown} raw gespeicherte Markierung (Objekt oder JSON-Text)
 * @returns {{clearedAt: string, installedAt?: string, legacyIds?: string[], removed: number|null, notice: string, dismissed?: boolean}|null} */
export function readRestorePointReset(raw) {
    const marker = parseMarker(raw);
    return marker && typeof marker.clearedAt === 'string' ? /** @type {any} */ (marker) : null;
}

/** SV-1c: Vollsicherung oder Schließen erledigen den Hinweis auch dann, wenn die Leerung noch wartet oder gerade läuft.
 * @param {unknown} raw @returns {{dismissed?: true}} */
const keepDismissed = raw => parseMarker(raw)?.dismissed === true ? { dismissed: true } : {};

/** Der Hinweis bleibt, bis eine Vollsicherung erstellt oder angestoßen wurde oder der Nutzer ihn schließt. Beides schließt die
 * Markierung dauerhaft (`closeRestorePointNotice`); die Sicherungszeit blendet ihn nur zusätzlich aus.
 * @param {unknown} rawMarker @param {Record<string, string>} records @returns {boolean} */
export function isRestorePointNoticeOpen(rawMarker, records) {
    const marker = readRestorePointReset(rawMarker);
    if (marker?.notice !== 'open' || marker.dismissed === true || records?.[PROBELAUF_STATE_KEY]) return false;
    const backup = Date.parse(records?.[BACKUP_KEY] || '');
    return !(Number.isFinite(backup) && backup >= Date.parse(marker.clearedAt));
}

/** Alter Punkt: ohne Herkunft dieser Version, vor der Installation angelegt und kein Jahresabschluss-Punkt. Jahrespunkte bleiben
 * immer; der Jahresabschluss-Nachweis kann sie brauchen. @param {{id: string, kind: string, createdAt: string, origin?: string}} point
 * @param {string} installedAt @param {string[]|undefined} listed beim ersten Lauf festgehaltene Kennungen */
const isLegacyPoint = (point, installedAt, listed) => !point.origin && point.kind !== SNAPSHOT_KINDS.annualClosePreMutation
    && Date.parse(point.createdAt) <= Date.parse(installedAt) && (!listed || listed.includes(point.id));

/** Wartegrund im Livebestand: Spielbereich, offener Jahresabschluss mit irgendeinem Punkt oder ein Verweis auf einen alten Punkt.
 * @param {typeof PersistenceFacade} persistence @param {{id: string}[]} legacy @returns {Promise<boolean>} */
async function mustWait(persistence, legacy) {
    const records = await persistence.readPersistedRecords();
    const referenced = referencedSnapshotIds(records), openCommits = pendingCommitSnapshotIds(records);
    return Boolean(records[PROBELAUF_STATE_KEY] || referenced === null || openCommits === null || openCommits.length
        || legacy.some(point => referenced.includes(point.id)));
}

/** Leert die alten Punkte genau einmal. Beim ersten Lauf hält die Markierung Installationszeit und die Liste der alten Punkte fest;
 * spätere Läufe löschen nur aus dieser Liste. Neue Punkte und Jahresabschluss-Punkte werden nie gelöscht, auch wenn die Markierung
 * verloren ging. Die Leerung wartet, solange der Spielbereich aktiv ist, ein offener Jahresabschluss im Livebestand auf irgendeinen
 * Punkt verweist (SV-1c) oder ein anderer Vorgang auf einen alten Punkt; dann bleibt das Archiv bis zu einem späteren Start unverändert.
 * SV-1d: Diese Prüfung läuft unmittelbar vor jedem Löschen erneut.
 * Alle Schreibzugriffe auf die Markierung laufen über `updateMetadata` in der gemeinsamen Schreibreihenfolge.
 * @param {{persistence?: typeof PersistenceFacade, archive?: typeof SnapshotArchive, now?: () => Date}} [options]
 * @returns {Promise<{status: 'done'|'waiting'|'cleared'|'unsupported', removed?: number}>} */
export async function resetRestorePointsOnce({ persistence = PersistenceFacade, archive = SnapshotArchive, now = appNow } = {}) {
    if (persistence.getPersistenceStatus?.().activeArea === 'spiel') return { status: 'waiting' };
    if (typeof persistence.getMetadata !== 'function' || typeof persistence.updateMetadata !== 'function') return { status: 'unsupported' };
    const existing = readRestorePointReset(await persistence.getMetadata(RESTORE_POINTS_RESET_KEY));
    if (existing && existing.notice !== 'pending') return { status: 'done' };
    const installedAt = existing?.installedAt || existing?.clearedAt || now().toISOString();
    const listed = Array.isArray(existing?.legacyIds) ? existing.legacyIds.map(String) : undefined;
    const legacy = (await archive.listSnapshots({ storage: persistence })).filter(point => isLegacyPoint(point, installedAt, listed));
    const pending = { version: 2, installedAt, clearedAt: installedAt, legacyIds: legacy.map(point => point.id), removed: null, notice: 'pending' };
    if (await mustWait(persistence, legacy)) {
        // Die Liste steht ab jetzt fest; Punkte, die bis zum späteren Lauf entstehen, gehören nie dazu.
        if (!listed) await persistence.updateMetadata(RESTORE_POINTS_RESET_KEY,
            current => readRestorePointReset(current) ? undefined : { ...pending, ...keepDismissed(current) });
        return { status: 'waiting' };
    }
    // Erst die Markierung „läuft“: Ein Speicher ohne technische Markierungen (Testdoppel) leert gar nicht, ein Abbruch
    // mittendrin setzt die Leerung beim nächsten Start mit derselben Liste fort.
    if (await persistence.updateMetadata(RESTORE_POINTS_RESET_KEY, current => ({ ...pending, ...keepDismissed(current) })) === false) return { status: 'unsupported' };
    const operation = startupOperation();
    for (const point of legacy) {
        // SV-1d: Unmittelbar vor jedem Löschen den Livebestand neu lesen; ein inzwischen offener Abschluss hält die Leerung an.
        // Die Markierung bleibt „läuft“ mit derselben Liste, ein späterer Start setzt fort.
        if (await mustWait(persistence, legacy)) return { status: 'waiting' };
        await archive.deleteSnapshot(point.id, { storage: persistence, navigationOperation: operation });
    }
    if (legacy.length && (await archive.listSnapshots({ storage: persistence })).some(point => legacy.some(old => old.id === point.id))) {
        throw new Error('Die früheren Wiederherstellungspunkte konnten nicht vollständig entfernt werden.');
    }
    const removed = legacy.length || Boolean(listed?.length);
    // Die Markierung wird erst hier neu gelesen: Eine Vollsicherung während der Leerung hat den Hinweis schon erledigt.
    await persistence.updateMetadata(RESTORE_POINTS_RESET_KEY, current => ({ version: 2, installedAt, clearedAt: installedAt, removed: legacy.length,
        notice: removed && !keepDismissed(current).dismissed ? 'open' : 'closed', ...keepDismissed(current) }));
    return { status: 'cleared', removed: legacy.length };
}

const runs = new WeakMap();
/** Einmal je Speicher und Seite; Fehler bleiben folgenlos und die Leerung läuft beim nächsten Start erneut.
 * @param {{persistence?: typeof PersistenceFacade, archive?: typeof SnapshotArchive}} [options] */
export function startRestorePointReset(options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    if (!runs.has(persistence)) runs.set(persistence, resetRestorePointsOnce(options).catch(error => ({ status: 'failed', error })));
    return runs.get(persistence);
}

/** Schließt den Hinweis dauerhaft: Schließen-Knopf oder eine erstellte bzw. angestoßene Vollsicherung. Danach erscheint er nie
 * wieder, auch nicht nach dem Einspielen einer älteren Sicherung. SV-1c: Wartet die Leerung noch oder läuft sie gerade, hält
 * `dismissed` das fest; die Leerung öffnet den Hinweis dann nicht mehr. Lesen und Schreiben laufen in einem Schritt der
 * gemeinsamen Schreibreihenfolge.
 * @param {{persistence?: {updateMetadata?: (key: string, update: (current: unknown) => unknown) => Promise<boolean>}}} [options]
 * @returns {Promise<boolean>} `true`, wenn die Markierung geändert wurde. */
export async function closeRestorePointNotice({ persistence = PersistenceFacade } = {}) {
    if (typeof persistence.updateMetadata !== 'function') return false;
    let changed = false;
    await persistence.updateMetadata(RESTORE_POINTS_RESET_KEY, current => {
        const marker = parseMarker(current);
        if (marker?.dismissed === true || (marker?.notice === 'closed' && readRestorePointReset(marker))) return undefined;
        changed = true;
        return { ...(marker || { version: 2 }), dismissed: true, ...(marker?.notice === 'open' ? { notice: 'closed' } : {}) };
    });
    return changed;
}
