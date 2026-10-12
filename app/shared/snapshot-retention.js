import { SnapshotArchive, SNAPSHOT_KINDS } from './snapshot-archive.js';
import { PersistenceFacade } from './persistence-facade.js';
import { recordIdentity, validateSnapshotWealthHistory } from './snapshot-restore.js';
import { PROBELAUF_STATE_KEY } from './persistence-key-policy.js';
import { appNow } from './app-clock.js';
import { createNavigationOperationLifecycle } from './navigation-guard.js';

const DAYS_30 = 30 * 86400000;
const isPlanMigration = point => point.kind === SNAPSHOT_KINDS.householdPlanMigrationRecovery
    || point.kind === 'manual' && point.label === 'Vor Umstellung Haushalt & Plan';
export function snapshotOccasion(point) {
    if (isPlanMigration(point)) return 'Planumstellung · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.annualClosePreMutation) return 'Jahresabschluss · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.personDataMigrationRecovery) return 'Personenumstellung · dauerhaft';
    if (point.kind === SNAPSHOT_KINDS.fullBackupImportRecovery) return 'vor Vollimport';
    if (point.kind === SNAPSHOT_KINDS.balanceImportRecovery) return 'vor Balance-Import';
    if (point.kind === SNAPSHOT_KINDS.beforeRestoreRecovery) return 'vor Zurückholen';
    if (point.kind === SNAPSHOT_KINDS.probelaufBefore) return 'vor Probelauf · nur über Probelauf beenden';
    if (point.kind === SNAPSHOT_KINDS.monthlyClosePreMutation || (point.kind === 'manual' && /^Monatsabschluss \d{4}-\d{2}$/.test(point.label))) return 'Monatsabschluss';
    return point.kind === 'manual' ? 'Manuell' : 'Unbekannter Anlass · bleibt erhalten';
}
const protectedKind = point => isPlanMigration(point) || !['manual', SNAPSHOT_KINDS.monthlyClosePreMutation].includes(point.kind);
function coverage(point) {
    if (!point.activeProfileId || point.restoreScope?.profileRegistryMode !== 'preserve-by-default'
        || point.restoreScope?.profileLiveDataMode !== 'restore-only-if-active-profile-still-exists') return null;
    if (point.records) {
        try {
            if (!JSON.parse(point.records.rs_profiles_v1 || 'null')?.profiles?.[point.activeProfileId]) return null;
            validateSnapshotWealthHistory(point);
        }
        catch { return null; }
    }
    return recordIdentity({ profile: point.activeProfileId, scope: recordIdentity(point.restoreScope) });
}

/** Konservativ: alle Recovery-, Dauer-, unbekannten und nicht vergleichbaren Punkte bleiben. */
export function buildSnapshotRetentionPlan(points, { now = appNow(), neededIds = [] } = {}) {
    const boundary = now.getTime() - DAYS_30;
    if (!Number.isFinite(boundary)) throw new Error('Aufbewahrungszeit ist ungültig.');
    const protectedIds = new Set(neededIds), keep = new Map(), candidates = [], representatives = new Map();
    const sorted = [...points].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    for (const point of sorted) {
        const time = Date.parse(point.createdAt), scope = coverage(point);
        if (!point.id || !Number.isFinite(time) || point.damaged || protectedKind(point) || !scope || protectedIds.has(point.id)) {
            keep.set(point.id, 'Dauerpunkt, Recovery oder nicht sicher vergleichbar'); continue;
        }
        if (time >= boundary) { keep.set(point.id, 'Innerhalb von einschließlich 30 Tagen'); continue; }
        const date = new Date(time);
        const month = `${date.getFullYear()}-${date.getMonth() + 1}`;
        const group = `${scope}:${month}`;
        if (!representatives.has(group)) { representatives.set(group, point.id); keep.set(point.id, 'Letzter Stand dieses Monats und Profilumfangs'); }
        else candidates.push(point);
    }
    const remove = [];
    for (const point of candidates) {
        const covering = sorted.find(other => keep.has(other.id) && coverage(other) === coverage(point) && Date.parse(other.createdAt) > Date.parse(point.createdAt));
        if (covering) remove.push({ id: point.id, coveringId: covering.id });
        else keep.set(point.id, 'Kein jüngerer erhaltener Stand mit gleichem Umfang');
    }
    return { remove, keep: [...keep].map(([id, reason]) => ({ id, reason })), boundary: new Date(boundary).toISOString() };
}

export async function previewSnapshotRetention({ persistence = PersistenceFacade, archive = SnapshotArchive, now = appNow() } = {}) {
    const records = await persistence.readPersistedRecords();
    if (records[PROBELAUF_STATE_KEY]) throw new Error('Aufräumen während des Probelaufs gesperrt.');
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
    const index = await archive.listSnapshots({ storage: persistence });
    const points = await Promise.all(index.map(async point => {
        try { return await archive.readSnapshot(point.id, { storage: persistence }); }
        catch { return { ...point, damaged: true }; }
    }));
    const identity = recordIdentity({ points: recordIdentity(Object.fromEntries(points.map(point => [point.id, JSON.stringify(point)]))), references: JSON.stringify([...neededIds].sort()), referenceError });
    return { ...buildSnapshotRetentionPlan(points, { now, neededIds: referenceError ? points.map(point => point.id) : [...neededIds] }), identity, now };
}
const active = new WeakSet();
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
            let expected = fresh;
            for (const point of fresh.remove) {
                // Vor jedem Delete auch die bestätigten Deckungspunkte erneut prüfen.
                const current = await previewSnapshotRetention({ persistence, archive, now: preview.now });
                operation.check();
                if (current.identity !== expected.identity) throw new Error('Das Archiv hat sich während des Aufräumens geändert.');
                if (!current.remove.some(item => item.id === point.id)) throw new Error('Der Punkt wird inzwischen benötigt und bleibt erhalten.');
                await archive.deleteSnapshot(point.id, { storage: persistence, navigationOperation: operation });
                // Ein inzwischen gestarteter Probelauf stoppt auch nach dem Delete.
                const records = await persistence.readPersistedRecords();
                if (records[PROBELAUF_STATE_KEY]) throw new Error('Aufräumen während des Probelaufs gesperrt.');
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
