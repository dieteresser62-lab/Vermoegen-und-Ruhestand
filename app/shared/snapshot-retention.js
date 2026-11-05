import { SnapshotArchive, SNAPSHOT_KINDS, validateSnapshot } from './snapshot-archive.js';
import { PersistenceFacade } from './persistence-facade.js';
import { recordIdentity, validateSnapshotWealthHistory } from './snapshot-restore.js';
import { PROBELAUF_STATE_KEY } from './persistence-key-policy.js';
import { appNow } from './app-clock.js';
import { createNavigationOperationLifecycle } from './navigation-guard.js';

const DAYS_30 = 30 * 86400000;
const temporaryRecoveryKinds = new Set([SNAPSHOT_KINDS.fullBackupImportRecovery, SNAPSHOT_KINDS.balanceImportRecovery,
    SNAPSHOT_KINDS.beforeRestoreRecovery, SNAPSHOT_KINDS.probelaufBefore]);
const isPlanMigration = point => point.kind === SNAPSHOT_KINDS.householdPlanMigrationRecovery
    || point.kind === 'manual' && point.label === 'Vor Umstellung Haushalt & Plan';
/**
 * @param point Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function snapshotOccasion(point) {
    if (point.kind === SNAPSHOT_KINDS.profileManagementBefore) return (point.label || 'vor Personenverwaltung') + ' · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.newBeginningBefore) return 'vor Neu beginnen · dauerhaft';
    if (isPlanMigration(point)) return 'Planumstellung · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.annualClosePreMutation) return 'Jahresabschluss · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.personDataMigrationRecovery) return 'Personenumstellung · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.fullBackupImportRecovery) return 'vor Vollimport';
    if (point.kind === SNAPSHOT_KINDS.balanceImportRecovery) return 'vor Balance-Import';
    if (point.kind === SNAPSHOT_KINDS.beforeRestoreRecovery) return 'vor Zurückholen';
    if (point.kind === SNAPSHOT_KINDS.probelaufBefore) return 'vor Spielbereich';
    if (point.kind === SNAPSHOT_KINDS.probelaufTransferBefore) return 'vor Übernahme aus dem Spielbereich · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.monthlyClosePreMutation || (point.kind === 'manual' && /^Monatsabschluss \d{4}-\d{2}$/.test(point.label))) return 'Monatsabschluss';
    return point.kind === 'manual' ? 'Manuell' : 'Unbekannter Anlass · bleibt erhalten';
}
const protectedKind = point => isPlanMigration(point)
    || !['manual', SNAPSHOT_KINDS.monthlyClosePreMutation].includes(point.kind) && !temporaryRecoveryKinds.has(point.kind);
function assertReadable(point) {
    if (point.damaged) throw new Error('Nicht verlässlich lesbar.');
    validateSnapshot(point);
    // Auch verschachtelter Profil-Rohtext muss lesbar sein, bevor er Deckung bietet.
    const readable = value => {
        if (typeof value === 'string' && /^\s*[\[{]/.test(value)) readable(JSON.parse(value));
        else if (value && typeof value === 'object') Object.values(value).forEach(readable);
    };
    readable(point.records);
    if (Object.hasOwn(point.records, 'rs_profiles_v1')) {
        const registry = JSON.parse(point.records.rs_profiles_v1);
        if (!registry || typeof registry !== 'object' || Array.isArray(registry)
            || !registry.profiles || typeof registry.profiles !== 'object' || Array.isArray(registry.profiles)) throw new Error('Profilbestand nicht verlässlich lesbar.');
    }
    validateSnapshotWealthHistory(point);
}
function isReadable(point) { try { assertReadable(point); return true; } catch { return false; } }
function coverage(point) {
    try {
        assertReadable(point);
        const scope = point.restoreScope;
        if (scope?.profileRegistryMode === 'replace-all-rollback' && scope.profileLiveDataMode === 'replace-all-rollback') {
            const mode = scope.liveKeyMode || (point.kind === SNAPSHOT_KINDS.fullBackupImportRecovery ? 'full-import' : 'snapshot-full');
            if (!['full-import', 'snapshot-full', 'new-beginning', 'play-transfer'].includes(mode)) return null;
            // Ganzer Bestand, getrennt nach tatsächlicher Keypolicy und weiteren Scopeangaben.
            return recordIdentity({ wholeStore: recordIdentity({ ...scope, liveKeyMode: mode }) });
        }
        if (point.kind === SNAPSHOT_KINDS.beforeRestoreRecovery && scope?.profileRegistryMode === 'restore-target-profile'
            && scope.profileLiveDataMode === 'restore-previous-live' && scope.targetProfileId
            && JSON.parse(point.records.rs_profiles_v1 || 'null')?.profiles?.[scope.targetProfileId]) {
            return recordIdentity({ profile: scope.targetProfileId, scope: recordIdentity(scope) });
        }
        if (!point.activeProfileId || scope?.profileRegistryMode !== 'preserve-by-default'
            || scope.profileLiveDataMode !== 'restore-only-if-active-profile-still-exists'
            || point.kind === SNAPSHOT_KINDS.fullBackupImportRecovery
            || !JSON.parse(point.records.rs_profiles_v1 || 'null')?.profiles?.[point.activeProfileId]) return null;
    } catch { return null; }
    return recordIdentity({ profile: point.activeProfileId, scope: recordIdentity(point.restoreScope) });
}

/** Dauerpunkte und nicht sicher vergleichbare Punkte bleiben; Rückholpunkte altern nach FR-70.
 *
 * @param points Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function buildSnapshotRetentionPlan(points, { now = appNow(), neededIds = [] } = {}) {
    const boundary = now.getTime() - DAYS_30;
    if (!Number.isFinite(boundary)) throw new Error('Aufbewahrungszeit ist ungültig.');
    const protectedIds = new Set(neededIds), keep = new Map(), candidates = [], representatives = new Map();
    const sorted = [...points].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const scopes = new Map(sorted.map(point => [point, coverage(point)]));
    for (const point of sorted) {
        const time = Date.parse(point.createdAt), scope = scopes.get(point);
        if (protectedIds.has(point.id)) { keep.set(point.id, 'Wird noch benötigt – bleibt erhalten'); continue; }
        if (!point.id || !Number.isFinite(time) || point.damaged) { keep.set(point.id, 'Nicht verlässlich lesbar – bleibt erhalten'); continue; }
        if (protectedKind(point)) { keep.set(point.id, 'Bleibt immer erhalten'); continue; }
        if (time >= boundary) {
            keep.set(point.id, temporaryRecoveryKinds.has(point.kind)
                ? 'Rückholpunkt – bleibt bis ' + new Date(time + DAYS_30).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : 'Innerhalb von einschließlich 30 Tagen'); continue;
        }
        if (!scope) { keep.set(point.id, 'Nicht sicher vergleichbar – bleibt erhalten'); continue; }
        const date = new Date(time);
        const month = `${date.getFullYear()}-${date.getMonth() + 1}`;
        const group = `${temporaryRecoveryKinds.has(point.kind) ? point.kind : 'regular'}:${scope}:${month}`;
        if (!representatives.has(group)) { representatives.set(group, point.id); keep.set(point.id, 'Letzter Stand dieses Monats und Datenumfangs'); }
        else candidates.push(point);
    }
    const remove = [];
    for (const point of candidates) {
        const covering = sorted.find(other => keep.has(other.id) && scopes.get(other) === scopes.get(point) && Date.parse(other.createdAt) > Date.parse(point.createdAt));
        if (covering) remove.push({ id: point.id, coveringId: covering.id });
        else keep.set(point.id, 'Kein jüngerer erhaltener Stand mit gleichem Umfang');
    }
    return { remove, keep: [...keep].map(([id, reason]) => ({ id, reason })), boundary: new Date(boundary).toISOString() };
}

/**
 * @param {{persistence?: typeof PersistenceFacade; archive?: typeof SnapshotArchive; now?: Date; guard?: import("../../typcheck/shared-annual.js").Guard; win?: Window & typeof globalThis}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export async function previewSnapshotRetention({ persistence = PersistenceFacade, archive = SnapshotArchive, now = appNow() } = {}) {
    const records = await persistence.readPersistedRecords();
    const index = await archive.listSnapshots({ storage: persistence });
    const points = await Promise.all(index.map(async point => {
        try { return await archive.readSnapshot(point.id, { storage: persistence }); }
        catch { return { ...point, damaged: true }; }
    }));
    return projectSnapshotRetention(points, records, { now });
}

/** Lesende Projektion für Löschvorschau und Datenseite aus demselben bestätigten Bestand. */
export function projectSnapshotRetention(points, records, { now = appNow() } = {}) {
    if (records[PROBELAUF_STATE_KEY]) throw new Error('Aufräumen während des Spielbereichs gesperrt.');
    const neededIds = new Set();
    let referenceError = false;
    function references(value) {
        if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
            try { references(JSON.parse(value)); } catch { referenceError = true; }
            return;
        }
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (['snapshotId', 'recoverySnapshotId'].includes(key) && typeof item === 'string') neededIds.add(item);
            if (key === 'archiveIds' && Array.isArray(item)) item.forEach(id => neededIds.add(id));
            references(item);
        }
    }
    references(records);
    const identity = recordIdentity({ points: recordIdentity(Object.fromEntries(points.map(point => [point.id, JSON.stringify(point)]))), references: JSON.stringify([...neededIds].sort()), referenceError });
    return { ...buildSnapshotRetentionPlan(points, { now, neededIds: referenceError ? points.map(point => point.id) : [...neededIds] }),
        neededIds: [...neededIds],
        individualRemove: points.filter(point => point.kind === SNAPSHOT_KINDS.profileManagementBefore
            && isReadable(point) && !referenceError && !neededIds.has(point.id)).map(point => ({ id: point.id })), identity, now };
}
const active = new WeakSet();
/**
 * @param {Awaited<ReturnType<typeof previewSnapshotRetention>>} preview
 * @param {{persistence?: typeof PersistenceFacade; archive?: typeof SnapshotArchive; guard?: import("../../typcheck/shared-annual.js").Guard}} [options]
 * @returns {Promise<{status: string; deleted: string[]; error?: Error}>} Ergebnis der Archivbereinigung.
 */
export async function executeSnapshotRetention(preview, options = {}) {
    const persistence = options.persistence || PersistenceFacade, archive = options.archive || SnapshotArchive;
    if (active.has(persistence)) return { status: 'in_flight', deleted: [] };
    active.add(persistence);
    const deleted = [];
    try {
        const lifecycle = createNavigationOperationLifecycle({ guard: options.guard });
        return await lifecycle.run({}, async operation => {
            const fresh = await previewSnapshotRetention({ persistence, archive, now: preview.now });
            operation.check();
            if (fresh.identity !== preview.identity) throw new Error('Das Archiv hat sich seit der Vorschau geändert. Bitte erneut prüfen.');
            let expected = /** @type {{identity: string}} */ (fresh);
            for (const point of fresh.remove) {
                // Vor jedem Delete auch die bestätigten Deckungspunkte erneut prüfen.
                const current = await previewSnapshotRetention({ persistence, archive, now: preview.now });
                operation.check();
                if (current.identity !== expected.identity) throw new Error('Das Archiv hat sich während des Aufräumens geändert.');
                if (!current.remove.some(item => item.id === point.id)) throw new Error('Der Punkt wird inzwischen benötigt und bleibt erhalten.');
                await archive.deleteSnapshot(point.id, { storage: persistence, navigationOperation: operation });
                // Ein inzwischen gestarteter Spielbereich stoppt auch nach dem Delete.
                const records = await persistence.readPersistedRecords();
                if (records[PROBELAUF_STATE_KEY]) throw new Error('Aufräumen während des Spielbereichs gesperrt.');
                const index = await archive.listSnapshots({ storage: persistence });
                if (index.some(item => item.id === point.id)) throw new Error('Das Entfernen des Punkts wurde nicht bestätigt.');
                deleted.push(point.id);
                // Erwartung aus dem vorigen Bestand ableiten, keine fremden Änderungen quittieren.
                const entries = Object.fromEntries(JSON.parse(expected.identity));
                const remaining = Object.fromEntries(JSON.parse(entries.points));
                delete remaining[point.id];
                entries.points = recordIdentity(remaining);
                expected = { identity: recordIdentity(entries) };
            }
            return { status: 'cleaned', deleted };
        });
    } catch (error) { return { status: deleted.length ? 'partial' : 'failed', deleted, error }; }
    finally { active.delete(persistence); }
}
