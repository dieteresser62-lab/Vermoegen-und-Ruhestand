import { CONFIG } from '../balance/balance-config.js';
import { PROFILE_SCOPED_FIXED_KEYS, loadStoredBalanceStateFromData, parseStoredNumber } from './profile-state.js';
import { loadTranchesFromStorage } from '../tranches/tranchen-manager-state.js';
import { calculateAggregatedValues } from '../tranches/depot-tranchen-status.js';
import { createManualWealthHistoryEntry, assertWealthHistoryEntry, readWealthHistory } from '../../types/wealth-history-contract.js';
import { WEALTH_CAPTURES_KEY, CAPTURE_AMOUNT_FIELDS, readWealthCaptures, assertWealthCaptures } from '../../types/wealth-capture-contract.js';
import { appNow } from '../shared/app-clock.js';

function stateFromData(data) {
    const loaded = loadStoredBalanceStateFromData(data);
    if (['corrupt', 'unavailable'].includes(loaded.status)) throw new Error(loaded.error?.message || 'Vermögensstände nicht lesbar.');
    return loaded.value || {};
}

function personEntry(input, identity) {
    const anleihen = input.bondsWert ?? 0, goldWert = input.goldWert ?? 0;
    // Die alte Engine-Projektion enthält Anleihen im Neu-Depot. Hier werden sie
    // separat gezeigt; sie dürfen nicht noch einmal in die Summe eingehen.
    const base = createManualWealthHistoryEntry({ ...input, depotwertNeu: input.depotwertNeu - anleihen }, identity.asOf);
    return assertWealthHistoryEntry({ ...base, ...identity, goldWert, anleihen, total: base.total + goldWert + anleihen });
}

/** Nur vorbereiten. Der aufrufende Abschlussdienst schreibt alle Records atomar. */
export function prepareWealthCapture({ storage, registry, activeId, entry, inputData, cashRecords = {}, now = appNow }) {
    const record = readWealthCaptures(storage.getItem(WEALTH_CAPTURES_KEY));
    const existing = record.captures.find(capture => capture.household.id === entry.id);
    if (entry.reason === 'annual_close' && existing) return JSON.stringify(record);
    const selected = Object.entries(registry.profiles).filter(([, profile]) => profile.meta?.belongsToHousehold !== false);
    // Wie der bestehende Balance-Pfad: ohne Verbund bildet das aktive Profil
    // den Einzelhaushalt.
    const members = selected.length ? selected : [[activeId, registry.profiles[activeId]]];
    const identity = { id: entry.id, asOf: entry.asOf, reason: entry.reason, periodId: entry.periodId };
    const people = Object.fromEntries(members.map(([id, profile]) => {
        const data = { ...profile.data };
        if (id === activeId) for (const key of [...PROFILE_SCOPED_FIXED_KEYS, CONFIG.STORAGE.LS_KEY]) {
            const raw = storage.getItem(key);
            if (raw == null) delete data[key]; else data[key] = raw;
        }
        if (id === activeId) Object.assign(data, cashRecords);
        const lots = loadTranchesFromStorage({ getItem: key => data[key] ?? null });
        if (['corrupt', 'unavailable'].includes(lots.status)) throw new Error('Personenbestand nicht lesbar.');
        const sourceLots = Array.isArray(inputData.detailledTranches)
            ? inputData.detailledTranches.filter(lot => lot.sourceProfileId === id || members.length === 1 && !lot.sourceProfileId)
            : lots.tranches;
        const explicit = data.depot_tranchen != null && data.depot_tranchen !== '';
        const totals = sourceLots.length ? calculateAggregatedValues(sourceLots)
            : explicit ? { depotwertAlt: 0, depotwertNeu: 0, geldmarktEtf: 0, goldWert: 0, bondsWert: 0 }
                : members.length === 1 ? inputData : stateFromData(data).inputs || {};
        const tagesgeld = data.profile_tagesgeld != null ? parseStoredNumber(data.profile_tagesgeld, null)
            : members.length === 1 ? inputData.tagesgeld : stateFromData(data).inputs?.tagesgeld;
        return [id, personEntry({ ...totals, tagesgeld }, identity)];
    }));
    const amounts = Object.fromEntries(CAPTURE_AMOUNT_FIELDS.map(field => [field,
        Object.values(people).reduce((sum, person) => sum + person[field], 0)]));
    const capture = { capturedAt: now().toISOString(), household: { ...identity, ...amounts }, people };
    const captures = record.captures.filter(item => item.household.id !== entry.id);
    captures.push(capture);
    return JSON.stringify(assertWealthCaptures({ ...record, captures }));
}

/** Altlisten bleiben unverändert. Pro Datum gewinnt die jüngste Erfassung. */
export function projectWealthCaptures(registry, raw, profileId = null) {
    const record = readWealthCaptures(raw), dates = new Map(), conflicts = new Set(), alternatives = new Map();
    let order = 0;
    const add = (entry, capturedAt, source) => {
        const time = Date.parse(capturedAt), candidate = { entry, time: Number.isFinite(time) ? time : null, order: order++, source };
        const previous = dates.get(entry.asOf);
        if (!alternatives.has(entry.asOf)) alternatives.set(entry.asOf, []);
        alternatives.get(entry.asOf).push(entry);
        if (previous && CAPTURE_AMOUNT_FIELDS.some(field => (previous.entry[field] ?? 0) !== (entry[field] ?? 0))) conflicts.add(entry.asOf);
        if (!previous || (candidate.time !== null && previous.time !== null ? candidate.time >= previous.time : candidate.order > previous.order)) dates.set(entry.asOf, candidate);
    };
    if (!profileId) for (const [id, profile] of Object.entries(registry.profiles || {})) {
        for (const entry of readWealthHistory(stateFromData(profile.data || {})).entries) {
            // Neue Erfassungen behalten eine lesbare Kopie im alten Format.
            // Diese Kopie ist kein widersprüchlicher zweiter Haushaltsstand.
            const canonical = record.captures.find(capture => capture.household.id === entry.id)?.household;
            if (canonical && ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu'].every(field =>
                entry[field] === canonical[field] + (field === 'depotwertNeu' ? canonical.anleihen : 0))) continue;
            add(entry, entry.capturedAt ?? entry.updatedAt ?? entry.createdAt ?? entry.timestamp, id);
        }
    }
    for (const capture of record.captures) {
        const entry = profileId ? capture.people[profileId] : capture.household;
        if (entry) add(entry, capture.capturedAt, 'household');
    }
    return { wealthHistory: { schemaVersion: 1, entries: [...dates.values()].map(value => value.entry) },
        conflictDetails: [...conflicts].sort().map(asOf => ({ asOf, selected: dates.get(asOf).entry,
            fields: CAPTURE_AMOUNT_FIELDS.filter(field => new Set(alternatives.get(asOf).map(entry => entry[field] ?? 0)).size > 1)
                .map(field => ({ field, values: [...new Set(alternatives.get(asOf).map(entry => entry[field] ?? 0))] })) })),
        conflicts: [...conflicts].sort(), hasLegacy: Object.values(registry.profiles || {}).some(profile => readWealthHistory(stateFromData(profile.data || {})).entries.some(entry => !record.captures.some(capture => capture.household.asOf === entry.asOf))) };
}
