import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { evaluateWealthHistory } from '../tranches/tranchen-history-model.js';
import { assertHistoryObject, assertHistoryId, historyDay, localHistoryDate, requireHistoryRecord } from '../tranches/tranchen-history-store.js';

export const PROFILE_CASH_HISTORY_KEY = 'profile_cash_history_v1';
export const PROFILE_WEALTH_LOTS_KEY = 'profile_wealth_history_lots_v1';
export function assertCashHistory(value) {
    assertHistoryObject(value);
    if (value.version !== 1 || typeof value.baselineValue !== 'number' || !Number.isFinite(value.baselineValue) || value.baselineValue < 0 || !Array.isArray(value.entries)) throw new Error('Ungültige Tagesgeldhistorie.');
    value.entries.forEach((entry, index) => {
        assertHistoryObject(entry); historyDay(entry.date);
        if (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0 || (index && entry.date < value.entries[index - 1].date)) throw new Error('Ungültiger Tagesgeldeintrag.');
    });
    return value;
}
export function appendCashHistory(raw, before, after, date = localHistoryDate()) {
    const current = requireHistoryRecord(raw, assertCashHistory);
    if (![before, after].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('Ungültiger Tagesgeldwert.');
    historyDay(date);
    if (current && (current.entries.at(-1)?.value ?? current.baselineValue) !== before) throw new Error('Tagesgeldhistorie und aktueller Betrag widersprechen sich.');
    if (before !== after && current?.entries.at(-1)?.date > date) throw new Error('Ungültiger Tagesgeldeintrag.');
    const dayEntries = (current?.entries || []).filter(entry => entry.date === date);
    if (before === after && dayEntries.length <= 1) return current;
    // Ohne Wertänderung nur Altbestand mit dem letzten Wert dieses Tages verdichten.
    const dayValue = before === after ? dayEntries.at(-1).value : after;
    // Nur den geschriebenen Tag ersetzen; ältere Mehrfacheinträge bleiben lesbar.
    const entries = (current?.entries || []).filter(entry => entry.date !== date);
    const previousValue = entries.filter(entry => entry.date < date).at(-1)?.value ?? current?.baselineValue ?? before;
    if (dayValue !== previousValue) entries.push({ date, value: dayValue });
    entries.sort((left, right) => left.date.localeCompare(right.date));
    return assertCashHistory({ version: 1, baselineValue: current?.baselineValue ?? before, entries });
}
export function assertWealthLots(value) {
    assertHistoryObject(value);
    if (value.version !== 1) throw new Error('Unbekannte Stammdatenversion.');
    assertHistoryObject(value.lots);
    for (const [id, lot] of Object.entries(value.lots)) {
        assertHistoryId(id); assertHistoryObject(lot); historyDay(lot.capturedAt);
        assertHistoryObject(lot.tranche);
        const tranche = normalizeTrancheCollection([lot.tranche], { mode: 'persisted' })[0];
        if (tranche.trancheId !== id || typeof lot.remainingShares !== 'number' || !Number.isFinite(lot.remainingShares) || lot.remainingShares < 0
            || !['present', 'sold', 'unknown'].includes(lot.status) || (lot.status === 'sold' && lot.remainingShares !== 0)
            || (lot.status === 'present' && tranche.shares !== lot.remainingShares)) throw new Error('Ungültige Verlaufsstammdaten.');
        if (Object.hasOwn(lot, 'uncertainty')) {
            assertHistoryObject(lot.uncertainty);
            const { fromDate, originalTranche } = lot.uncertainty;
            historyDay(fromDate);
            const original = normalizeTrancheCollection([originalTranche], { mode: 'persisted' })[0];
            historyDay(original.purchaseDate); historyDay(tranche.purchaseDate);
            if (lot.status !== 'unknown' || original.trancheId !== id
                || fromDate > original.purchaseDate || fromDate > tranche.purchaseDate) throw new Error('Ungültige Bestandsunsicherheit.');
        }
        if (Object.hasOwn(lot, 'manualCorrectionAt')) historyDay(lot.manualCorrectionAt);
    }
    return value;
}
const sameWealthIdentity = (copy, tranche) => copy.remainingShares === tranche.shares
    && ['purchaseDate', 'type', 'isin'].every(field => copy.tranche[field] === tranche[field]);

// Nur eine verlässliche Kopie begründet eine Grenze. Bei alten unknown-Records
// kann das gespeicherte Kaufdatum schon überschrieben sein: niemals nachdatieren.
function unknownWealthLot(copy, tranche = copy.tranche) {
    const next = { ...copy, tranche: { ...tranche }, remainingShares: tranche.shares, status: 'unknown' };
    const original = copy.uncertainty?.originalTranche ?? (copy.status === 'present' ? copy.tranche : null);
    delete next.uncertainty;
    if (original) {
        try {
            historyDay(original.purchaseDate); historyDay(tranche.purchaseDate);
            const fromDate = [copy.uncertainty?.fromDate, original.purchaseDate, tranche.purchaseDate].filter(Boolean).sort()[0];
            next.uncertainty = { fromDate, originalTranche: structuredClone(original) };
        } catch { /* Ohne gesicherte Datierung bleibt jeder Tag unbekannt. */ }
    }
    return next;
}

/** Gemeinsame, rein lesende Zusammenführung für Personen und Übersicht. */
export function mergeWealthLots(copies, current) {
    const merged = new Map(Object.entries(copies.lots).map(([id, copy]) => [id, structuredClone(copy)]));
    const present = new Set(current.map(tranche => tranche.trancheId));
    for (const tranche of current) {
        const copy = merged.get(tranche.trancheId);
        merged.set(tranche.trancheId, !copy ? { tranche: { ...tranche }, remainingShares: tranche.shares, status: 'present' }
            : copy.status === 'present' && sameWealthIdentity(copy, tranche)
                ? { ...copy, tranche: { ...tranche } } : unknownWealthLot(copy, tranche));
    }
    for (const [id, copy] of merged) if (!present.has(id) && copy.status === 'present') merged.set(id, unknownWealthLot(copy));
    return [...merged.values()];
}
/** Nur Stammdaten aus bestätigtem Bestand; Verschwinden ohne Audit ist kein Verkauf. */
export function captureWealthLots(raw, tranches, date = localHistoryDate()) {
    const previous = requireHistoryRecord(raw, assertWealthLots, { version: 1, lots: {} });
    const normalized = normalizeTrancheCollection(tranches, { mode: 'persisted' });
    const next = { version: 1, lots: Object.fromEntries(mergeWealthLots(previous, normalized).map(lot =>
        [lot.tranche.trancheId, { ...lot, capturedAt: lot.capturedAt ?? date }])) };
    return assertWealthLots(next);
}
export function captureSaleWealthLots(raw, beforeTranches, afterTranches, trancheId, date = localHistoryDate()) {
    const next = captureWealthLots(raw, beforeTranches, date);
    const after = new Map(afterTranches.map(lot => [lot.trancheId, lot]));
    for (const [id, lot] of Object.entries(next.lots)) {
        if (after.has(id)) {
            if (lot.status === 'unknown') next.lots[id] = unknownWealthLot(lot, after.get(id));
            else { lot.tranche = { ...after.get(id) }; lot.remainingShares = lot.tranche.shares; }
        }
        else if (id === trancheId && lot.status === 'present') { lot.remainingShares = 0; lot.status = 'sold'; }
    }
    return assertWealthLots(next);
}

/** Ausschließlich rückwirkende Stammdatenkorrektur, niemals ein Ausführungsbeleg. */
export function correctWealthLot(copies, current, trancheId, kind, date = localHistoryDate()) {
    assertWealthLots(copies); historyDay(date);
    const merged = mergeWealthLots(copies, current);
    const lot = merged.find(copy => copy.tranche.trancheId === trancheId);
    const live = current.find(tranche => tranche.trancheId === trancheId);
    if (!lot || lot.status !== 'unknown') return null;
    const next = structuredClone(copies);
    if (kind === 'correct' && live) {
        historyDay(live.purchaseDate);
        next.lots[trancheId] = { tranche: { ...live }, remainingShares: live.shares, status: 'present',
            capturedAt: lot.capturedAt, manualCorrectionAt: date };
    } else if (kind === 'discard' && !live) delete next.lots[trancheId];
    else throw new Error('Korrekturweg passt nicht zum aktuellen Bestand.');
    return assertWealthLots(next);
}

/** Dieselben belegten Bestände wie die Übersicht, ausschließlich lesend. */
export function projectProfileWealthHistory(registry, persons, options) {
    const profiles = persons.map(person => {
        try {
            const data = registry.profiles[person.id].data;
            const cashHistory = requireHistoryRecord(data[PROFILE_CASH_HISTORY_KEY], assertCashHistory);
            const copies = requireHistoryRecord(data[PROFILE_WEALTH_LOTS_KEY], assertWealthLots, { version: 1, lots: {} });
            const current = normalizeTrancheCollection(JSON.parse(data.depot_tranchen || '[]'), { mode: 'persisted' });
            const merged = mergeWealthLots(copies, current);
            return { id: person.id, belongsToHousehold: person.belongs, currentCash: person.values?.tagesgeld,
                cashHistory, lots: merged, error: person.valid ? null : 'Profilbestand unvollständig.' };
        } catch (error) {
            return { id: person.id, belongsToHousehold: person.belongs, lots: [], currentCash: null, error: error.message };
        }
    });
    const result = evaluateWealthHistory({ ...options, profiles });
    if (profiles.some(profile => (!options.profileId || options.profileId === profile.id)
        && (options.profileId || profile.belongsToHousehold !== false)
        && profile.cashHistory?.entries.some(entry => entry.source === 'spielwert'))) result.cashPlayValues = true;
    const manuallyCorrected = profiles.some(profile => (!options.profileId || options.profileId === profile.id)
        && (options.profileId || profile.belongsToHousehold !== false)
        && profile.lots.some(lot => lot.manualCorrectionAt && (!options.assetType || options.assetType === lot.tranche.type)));
    if (manuallyCorrected && Number.isFinite(result.metrics.change)) result.metrics.status = 'provisional';
    return result;
}
