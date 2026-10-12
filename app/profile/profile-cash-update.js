import { loadProfileAssetValues, saveProfileAssetValues } from './profile-asset-values.js';
import { assertCashHistory, PROFILE_CASH_HISTORY_KEY } from './profile-wealth-history.js';
import { requireHistoryRecord, localHistoryDate } from '../tranches/tranchen-history-store.js';
import { canonicalDecimalInput } from '../tranches/tranchen-manager-decimal-input.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_SCOPED_FIXED_KEYS } from './profile-state.js';
import { CONFIG } from '../balance/balance-config.js';

export const CASH_KEYS = Object.freeze(['profile_tagesgeld', PROFILE_CASH_HISTORY_KEY]);
export function parseCashInput(raw) {
    const canonical = canonicalDecimalInput(raw);
    const value = canonical === '' ? NaN : Number(canonical);
    if (!Number.isFinite(value) || value < 0) throw new Error('Bitte einen endlichen Tagesgeld-Stand ab null eingeben.');
    return value;
}

/** Keine Normalisierung beschädigter Quellrecords zu null. */
export function readCashPerson(id, name, data) {
    const cashRaw = data.profile_tagesgeld ?? null;
    const historyRaw = data[PROFILE_CASH_HISTORY_KEY] ?? null;
    try {
        const value = cashRaw === null ? null : parseCashInput(cashRaw);
        const history = requireHistoryRecord(historyRaw, assertCashHistory);
        if (history && (value === null || (history.entries.at(-1)?.value ?? history.baselineValue) !== value)) {
            throw new Error('Tagesgeldhistorie und aktueller Betrag widersprechen sich.');
        }
        return { id, name, cashRaw, historyRaw, value, lastDate: history?.entries.at(-1)?.date ?? null, error: null };
    } catch (error) { return { id, name, cashRaw, historyRaw, value: null, lastDate: null, error: error.message }; }
}

export function liveCashData(storage = persistenceStorage) {
    const keys = Number.isInteger(storage.length) ? Array.from({ length: storage.length }, (_, index) => storage.key(index))
        : [...PROFILE_SCOPED_FIXED_KEYS, CONFIG.STORAGE.LS_KEY];
    return Object.fromEntries(keys.sort().map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
}

export function captureCashPeople({ storage = persistenceStorage, ids, activeId }) {
    const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
    const live = liveCashData(storage);
    return ids.map(id => {
        const profile = registry?.profiles?.[id];
        if (!profile) throw new Error('Die Haushaltsperson ist nicht mehr vorhanden.');
        return readCashPerson(id, profile.meta.name, id === activeId ? live : profile.data);
    });
}

/** Der bestehende Profilwriter arbeitet ausschließlich auf einer privaten Kopie. */
export function prepareCashRecords(data, raw, date = localHistoryDate()) {
    const person = readCashPerson('', '', data);
    if (person.error) throw new Error(person.error);
    const value = parseCashInput(raw);
    if (person.value === value) return {};
    const copy = { ...data };
    const adapter = { getItem: key => copy[key] ?? null, setItem: (key, text) => { copy[key] = String(text); } };
    const values = loadProfileAssetValues(adapter);
    saveProfileAssetValues({ ...values, tagesgeld: value }, adapter, { recordCashChange: true, date });
    return Object.fromEntries(CASH_KEYS.filter(key => copy[key] !== data[key]).map(key => [key, copy[key]]));
}

/** Entwurf mit Rohbelegen; Mitgliedschaft und Werte werden unmittelbar vor Commit geprüft. */
export function prepareHouseholdCash({ storage = persistenceStorage, activeId, ids, cash, registry,
    date = localHistoryDate(), checkMembership = true }) {
    if (!cash || !Array.isArray(cash.people) || !cash.values || !Array.isArray(ids)
        || JSON.stringify([...ids].sort()) !== JSON.stringify(cash.people.map(person => person.id).sort())) {
        throw new Error('Die Tagesgeldfelder passen nicht mehr zum Haushalt.');
    }
    if (storage.getItem('rs_current_profile') !== activeId
        || (storage.getItem('rs_active_profile') !== null && storage.getItem('rs_active_profile') !== activeId)) {
        throw new Error('Das aktive Profil hat sich geändert.');
    }
    if (checkMembership) {
        const members = Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false).sort();
        if (JSON.stringify(members) !== JSON.stringify([...ids].sort())) throw new Error('Der Haushalt hat sich geändert.');
    }
    const nextRegistry = structuredClone(registry), records = {}, expected = {};
    const live = liveCashData(storage);
    let total = 0;
    for (const source of cash.people) {
        const profile = registry.profiles[source.id];
        if (!profile) throw new Error('Die Haushaltsperson ist nicht mehr vorhanden.');
        const data = source.id === activeId ? live : profile.data;
        if ((data.profile_tagesgeld ?? null) !== source.cashRaw || (data[PROFILE_CASH_HISTORY_KEY] ?? null) !== source.historyRaw) {
            throw new Error('Der Tagesgeld-Stand wurde seit der Rückfrage verändert.');
        }
        const changes = prepareCashRecords(data, cash.values[source.id], date);
        total += parseCashInput(cash.values[source.id]);
        if (source.id === activeId) for (const key of CASH_KEYS) {
            if (data[key] === undefined || data[key] === null) delete nextRegistry.profiles[source.id].data[key];
            else nextRegistry.profiles[source.id].data[key] = data[key];
        }
        Object.assign(nextRegistry.profiles[source.id].data, changes);
        if (source.id === activeId) for (const key of Object.keys(changes)) {
            records[key] = changes[key];
            if (data[key] !== undefined && data[key] !== null) expected[key] = data[key];
        }
    }
    if (!Number.isFinite(total)) throw new Error('Die Tagesgeldsumme ist nicht endlich.');
    return { registry: nextRegistry, records, expected, total };
}
