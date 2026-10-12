import { readOverviewSummaries, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';
import { CONFIG } from '../balance/balance-config.js';
import { createAnnualPeriodMetadata, preflightAnnualPeriod } from '../balance/balance-annual-period.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { readWealthHistory } from '../../types/wealth-history-contract.js';
import { captureCurrentRecords, SnapshotArchive, SNAPSHOT_KINDS, validateSnapshot } from './snapshot-archive.js';

export function isAnnualClosePrePoint(point, { targetYear, activeId } = {}) {
    return point?.kind === SNAPSHOT_KINDS.annualClosePreMutation
        && point.activeProfileId === activeId && new Date(point.createdAt).getFullYear() === targetYear + 1;
}

/** Nur passende Payloads lesen; ein Indexeintrag ist weder Vorabstand noch Erfolgsbeleg. */
export async function readAnnualCloseSnapshots({ archive = SnapshotArchive, targetYear, activeId,
    excludeSnapshotId, check = () => {} } = {}) {
    check();
    const points = await archive.listSnapshots();
    check();
    if (!Array.isArray(points)) throw new Error('Das Jahresarchiv ist nicht lesbar.');
    const snapshots = [];
    for (const point of points.filter(point => point?.id !== excludeSnapshotId
        && isAnnualClosePrePoint(point, { targetYear, activeId }))) {
        const snapshot = validateSnapshot(await archive.readSnapshot(point.id));
        check();
        if (snapshot.id !== point.id || !isAnnualClosePrePoint(snapshot, { targetYear, activeId })
            || snapshot.createdAt !== point.createdAt || snapshot.records.rs_current_profile !== activeId) {
            throw new Error('Der Jahresvorabpunkt passt nicht zur Archivprüfung.');
        }
        snapshots.push(snapshot);
    }
    return snapshots;
}

const archiveContextKey = context => JSON.stringify([context?.targetYear, context?.activeId,
    context?.scope?.kind, context?.scope?.key, context?.scope?.ids]);

/** Flüchtige Archivlesung für synchrone Projektionen; Finanzrecords werden nie gecacht.
 * read bindet/liest den aktuellen Kontext, refresh versucht die Lesung ausdrücklich neu.
 * Nur loaded liefert bestätigte Snapshotdaten. loading/error/stale geben keine Freigabe.
 */
export function createAnnualCloseArchiveReader({ archive = SnapshotArchive } = {}) {
    let key, revision = 0, current;
    const bind = context => {
        const next = archiveContextKey(context);
        if (next !== key) {
            key = next; revision++;
            current = { status: 'loading', context: structuredClone(context), snapshots: [], error: null };
        }
        return current;
    };
    return {
        read(context) { return structuredClone(bind(context)); },
        async refresh(context) {
            bind(context);
            const captured = structuredClone(context), requestKey = key, requestRevision = ++revision;
            const check = () => {
                if (key !== requestKey || revision !== requestRevision) throw new Error('ANNUAL_ARCHIVE_CONTEXT_CHANGED');
            };
            current = { status: 'loading', context: captured, snapshots: [], error: null };
            try {
                if (!Number.isInteger(captured.targetYear) || !captured.activeId || !captured.scope?.ids?.length
                    || !captured.scope.key) throw new Error('Der Kontext der Jahresarchivprüfung fehlt.');
                const snapshots = await readAnnualCloseSnapshots({ archive, ...captured, check });
                check();
                current = { status: 'loaded', context: captured, snapshots, error: null };
            } catch (error) {
                if (key !== requestKey || revision !== requestRevision) return {
                    status: 'stale', context: captured, snapshots: [], error: null
                };
                current = { status: 'error', context: captured, snapshots: [], error: error.message };
            }
            return structuredClone(current);
        }
    };
}

export const annualCloseArchiveReader = createAnnualCloseArchiveReader();

/** Reine Ableitung: Ein Vorabpunkt oder eine Vorschau ist kein Abschlussbeleg. */
export function deriveAnnualCloseEvidence({ targetYear, scope, activeId, records = {}, snapshots = [] } = {}) {
    const periodId = `calendar-year:${targetYear}`;
    const storage = { getItem: key => records[key] ?? null };
    const uncertain = message => ({ status: 'legacy_confirmation_required', periodId, metadata: null,
        errors: [{ message }], reason: 'ambiguous_evidence' });
    try {
        const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY] || '{}');
        const existing = preflightAnnualPeriod({ targetYear, currentAge: 0, metadata: state.annualPeriodMetadata });
        if (state.annualPeriodMetadata != null) return { ...existing, metadata: state.annualPeriodMetadata };
        if (!scope?.ids?.length || !activeId) return uncertain('Der Umfang der Jahresbelege fehlt. Bitte den Jahresstand klären.');
        const registry = JSON.parse(records.rs_profiles_v1 || '{"profiles":{}}');
        const sources = scope.ids.map(id => id === activeId ? state : JSON.parse(registry.profiles?.[id]?.data?.[CONFIG.STORAGE.LS_KEY] || '{}'));
        // Ein fremder Writer braucht einen Beleg für exakt diesen Umfang.
        const receipt = readAnnualPlanRecord({ year: targetYear + 1, scope, storage });
        if (receipt?.status === 'invalid') return uncertain('Der Jahresplanbeleg ist beschädigt. Bitte den Jahresstand klären.');
        const matchingReceipt = receipt?.periodId === periodId ? receipt : null;
        const histories = sources.map(source => readWealthHistory(source));
        const historyProof = histories.some((history, index) => {
            const id = scope.ids[index], data = id === activeId ? records : registry.profiles?.[id]?.data || {};
            const summaries = Object.values(readOverviewSummaries(data[OVERVIEW_SUMMARY_KEY])).filter(item => [targetYear, targetYear + 1].includes(item.year));
            const matchingScope = !summaries.length || summaries.some(item => item.scope?.key === scope.key);
            return matchingScope && history.entries.some(entry => entry.reason === 'annual_close' && entry.periodId === periodId
                && (!entry.scope || entry.scope.key === scope.key));
        });
        const future = sources.some(source => [source.needsAdjustedForInflationYear, source.lastInflationAppliedAtYear,
            source.annualMarketDataMeta?.targetYear && source.annualMarketDataMeta.targetYear + 1].some(year => Number(year) > targetYear + 1));
        if (future) return uncertain('Jahresmarker widersprechen der abzuschließenden Periode. Bitte den Jahresstand klären.');
        if (matchingReceipt || historyProof) return { status: 'already_committed', periodId,
            metadata: createAnnualPeriodMetadata({ lastCommittedPeriod: periodId }),
            committedAt: matchingReceipt?.committedAt ?? null, reason: matchingReceipt ? 'plan_receipt' : 'annual_history', errors: [] };
        const partial = sources.some(source =>
            [source.needsAdjustedForInflationYear, source.lastInflationAppliedAtYear].some(year => Number(year) >= targetYear + 1)
            || source.annualMarketDataMeta?.targetYear === targetYear);
        const legacyMarkers = sources.some(source =>
            source.ageAdjustedForInflation != null && source.ageAdjustedForInflation !== false
            || source.lastState?.lastInflationAppliedAtAge != null
            || Number(source.lastState?.cumulativeInflationFactor ?? 1) !== 1);
        const captured = captureCurrentRecords({ keys: Object.keys(records), getItem: key => records[key] });
        const points = snapshots.filter(point => isAnnualClosePrePoint(point, { targetYear, activeId }));
        // Ein vollständig zurückgeladener Quellsatz ist wieder der offene Vorabstand,
        // auch wenn ältere, abweichende Vorabpunkte im Archiv erhalten bleiben.
        const restoredPrePoint = points.some(point => point.records?.rs_current_profile === activeId
            && Object.keys(point.records).length === Object.keys(captured).length
            && Object.keys(captured).every(key => point.records[key] === captured[key]));
        const prePoint = points.length > 0 && !restoredPrePoint;
        if (partial || prePoint || legacyMarkers) return {
            ...uncertain('Einzelne Anpassungsmarker oder ein Vorabpunkt belegen keinen vollständigen Jahresabschluss. Bitte den Jahresstand vor einer erneuten Anpassung klären.'),
            // Undatierte Altmarker und isolierte Vorabpunkte dürfen offen sein. Dagegen lässt sich eine
            // belegte Teilanpassung des Zieljahres nicht mit „offen“ überschreiben.
            allowOpenConfirmation: !partial
        };
        return { status: 'ready', periodId, metadata: createAnnualPeriodMetadata(), reason: 'no_close_evidence', errors: [] };
    } catch { return uncertain('Jahresquellen sind nicht eindeutig lesbar. Bitte den Jahresstand klären.'); }
}
