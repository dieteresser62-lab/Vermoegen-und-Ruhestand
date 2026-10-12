import { preflightAnnualPeriod } from '../balance/balance-annual-period.js';
import { readWealthHistory } from '../../types/wealth-history-contract.js';

/** Gemeinsame P6c-Regel; die Adapter validieren vorhandene Anzeige- und Ausgabenverträge. */
const validPlanningYear = year => Number.isInteger(year) && year >= 1900 && year <= 9999;
const periodYear = period => /^calendar-year:[1-9]\d{3}$/.test(period || '') && validPlanningYear(Number(period.slice(14)))
    ? Number(period.slice(14)) : null;

/** Belege gehören ausschließlich zum ausgewählten Umfang. Keine Normalisierung oder Writes. */
export function derivePlanningStart({ now, scope, memberIds = scope?.ids || [], metadata = [], states = [], summarySources = [], store = null, sourceErrors = [], readSummary, readSummaries, projectExpenses }) {
    const evidence = [], errors = [...sourceErrors];
    const add = (id, year, kind) => { if (validPlanningYear(year)) evidence.push({ id, year, kind }); };
    for (const [index, id] of memberIds.entries()) {
        if (!scope?.ids.includes(id)) continue;
        const meta = metadata[index];
        for (const [kind, period] of [['committed', meta?.lastCommittedPeriod], ['pending', meta?.pendingCommit?.periodId]]) {
            const year = periodYear(period);
            if (year !== null) add(id, year, kind);
        }
        try {
            for (const entry of readWealthHistory(states[index]).entries) {
                add(id, Number(entry.asOf.slice(0, 4)), entry.reason === 'annual_close' ? 'annual' : 'wealth');
            }
        } catch { errors.push({ id, source: 'wealth' }); }
        const raw = summarySources[index];
        if (raw !== undefined && raw !== null) {
            try {
                const record = JSON.parse(raw);
                if (record?.version !== 1 || !record.entries || typeof record.entries !== 'object' || Array.isArray(record.entries)) {
                    errors.push({ id, source: 'summary' });
                }
            } catch { errors.push({ id, source: 'summary' }); }
            for (const item of Object.values(readSummaries(raw))) {
                if (item?.scope?.key !== scope.key) continue;
                if (validPlanningYear(item.year) && readSummary(raw, item.year, scope)) add(id, item.year, 'summary');
                else errors.push({ id, source: 'summary' });
            }
        }
    }
    for (const [yearKey, yearData] of Object.entries(store?.years || {})) {
        const year = Number(yearKey);
        if (!/^[1-9]\d{3}$/.test(yearKey) || !validPlanningYear(year)) continue;
        for (const monthKey of Object.keys(yearData?.months || {})) {
            if (!/^(?:[1-9]|1[0-2])$/.test(monthKey)) continue;
            const month = projectExpenses(store, scope, year, Number(monthKey));
            for (const row of month.rows) {
                if (row.present) add(row.id, year, 'expenses');
                else if (yearData.months[monthKey]?.profiles?.[row.id] !== undefined) errors.push({ id: row.id, source: 'expenses' });
            }
        }
    }
    // Nur die echte Vorjahresinitialisierung zusammen mit einem gültigen,
    // ausgewählten offenen Periodenstand zählt; activeYear allein ist kein Beleg.
    const closingYear = now.getFullYear() - 1;
    const initialized = store?.years?.[closingYear]?.months;
    if (store?.version === 1 && store.activeYear === closingYear && initialized
        && typeof initialized === 'object' && !Array.isArray(initialized) && Object.keys(initialized).length === 0) {
        for (const [index, id] of memberIds.entries()) {
            if (scope?.ids.includes(id) && states[index]
                && !errors.some(entry => !entry.id || entry.id === id) && metadata[index]
                && preflightAnnualPeriod({ targetYear: closingYear, currentAge: 0, metadata: metadata[index] }).status === 'ready') {
                add(id, closingYear, 'initialized');
            }
        }
    }
    return { firstPlanningYear: evidence.length ? evidence.reduce((year, entry) => Math.min(year, entry.year), Infinity) : now.getFullYear(), evidence, errors };
}


/** Der Writerkontext benennt die Livequelle; fehlende Personenstände sind keine offenen Abschlüsse.
 * Beim Profilwechsel ist nur eine eindeutige bestätigte Ablage (oder identische Kopien) verwendbar.
 * Fremde Quellen brauchen eine Anzeige für den exakten ausgewählten Umfang.
 */
export function resolvePlanningPeriodSource({ writerId, scope, records = [] }) {
    const eligible = records.filter(record => scope?.ids.includes(record.id) || record.scopeMatches);
    // Ein frisch geöffneter Writer ohne passende Anzeige ist nur die unbestätigte
    // Ausgangsbasis, wenn im ausgewählten Umfang noch kein Stand existiert.
    if (!eligible.some(record => record.state.value || record.state.status === 'corrupt')) {
        const writerRecord = records.find(record => record.id === writerId);
        if (writerRecord && !eligible.includes(writerRecord)) eligible.push(writerRecord);
    }
    const damaged = eligible.filter(record => record.state.status === 'corrupt');
    const persisted = eligible.filter(record => record.state.value?.annualPeriodMetadata !== undefined && record.state.value?.annualPeriodMetadata !== null);
    const writer = eligible.find(record => record.id === writerId);
    const sources = persisted.length ? persisted : writer ? [writer] : eligible.filter(record => record.state.value);
    const metadata = sources.map(record => record.state.value?.annualPeriodMetadata ?? null);
    const signature = meta => meta && typeof meta === 'object' ? JSON.stringify([
        meta.schemaVersion, meta.lastCommittedPeriod, meta.pendingCommit === null ? null : [
            meta.pendingCommit?.periodId, meta.pendingCommit?.phase, meta.pendingCommit?.snapshotId
        ]
    ]) : JSON.stringify(meta);
    const contradictory = new Set(metadata.map(signature)).size > 1;
    return { ids: sources.map(record => record.id).sort(), metadata,
        available: damaged.length === 0 && !contradictory && sources.length > 0,
        reason: damaged.length ? 'corrupt' : contradictory ? 'contradictory' : sources.length ? null : 'missing' };
}
