import { loadProfileAssetValues, saveProfileAssetValues } from './profile-asset-values.js';
import { appendCashHistory, assertCashHistory, PROFILE_CASH_HISTORY_KEY } from './profile-wealth-history.js';
import { requireHistoryRecord, localHistoryDate, historyDay } from '../tranches/tranchen-history-store.js';
import { canonicalDecimalInput } from '../tranches/tranchen-manager-decimal-input.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { PROFILE_SCOPED_FIXED_KEYS, PROFILE_CASH_CONFIRMED_DATE_KEY } from './profile-state.js';
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
    const confirmationRaw = data[PROFILE_CASH_CONFIRMED_DATE_KEY] ?? null;
    try {
        const value = cashRaw === null ? null : parseCashInput(cashRaw);
        const history = requireHistoryRecord(historyRaw, assertCashHistory);
        if (confirmationRaw !== null) historyDay(confirmationRaw);
        if (history && (value === null || (history.entries.at(-1)?.value ?? history.baselineValue) !== value)) {
            throw new Error('Tagesgeldhistorie und aktueller Betrag widersprechen sich.');
        }
        return { id, name, cashRaw, historyRaw, confirmationRaw, value, lastDate: history?.entries.at(-1)?.date ?? null,
            confirmedDate: confirmationRaw, error: null };
    } catch (error) { return { id, name, cashRaw, historyRaw, confirmationRaw, value: null, lastDate: null, confirmedDate: null, error: error.message }; }
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
    if (person.value === value) {
        const history = appendCashHistory(person.historyRaw, value, value, date);
        const historyRaw = history ? JSON.stringify(history) : null;
        return historyRaw === person.historyRaw ? {} : { [PROFILE_CASH_HISTORY_KEY]: historyRaw };
    }
    const copy = { ...data };
    const adapter = { getItem: key => copy[key] ?? null, setItem: (key, text) => { copy[key] = String(text); } };
    const values = loadProfileAssetValues(adapter);
    saveProfileAssetValues({ ...values, tagesgeld: value }, adapter, { recordCashChange: true, date });
    return Object.fromEntries(CASH_KEYS.filter(key => copy[key] !== data[key]).map(key => [key, copy[key]]));
}

/** Entwurf mit Rohbelegen; Mitgliedschaft und Werte werden unmittelbar vor Commit geprüft. */
export function prepareHouseholdCash({ storage = persistenceStorage, activeId, ids, cash, registry,
    date = localHistoryDate(), checkMembership = true, recordConfirmation = false }) {
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
        if ((data.profile_tagesgeld ?? null) !== source.cashRaw || (data[PROFILE_CASH_HISTORY_KEY] ?? null) !== source.historyRaw
            || (data[PROFILE_CASH_CONFIRMED_DATE_KEY] ?? null) !== (source.confirmationRaw ?? null)) {
            throw new Error('Der Tagesgeld-Stand wurde seit der Rückfrage verändert.');
        }
        const changes = prepareCashRecords(data, cash.values[source.id], date);
        const playValue = cash.playValues?.[source.id];
        if (playValue) {
            if (PersistenceFacade.getPersistenceStatus().activeArea !== 'spiel' || playValue.source !== 'spielwert'
                || playValue.value !== cash.values[source.id]) throw new Error('Tagesgeld-Spielwerte dürfen nur im Spielbereich gespeichert werden.');
            const historyRaw = changes[PROFILE_CASH_HISTORY_KEY] ?? data[PROFILE_CASH_HISTORY_KEY];
            if (historyRaw) {
                const history = assertCashHistory(JSON.parse(historyRaw));
                const entry = history.entries.find(entry => entry.date === date);
                if (entry) {
                    entry.source = 'spielwert';
                    changes[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history);
                }
            }
        }
        // Die Abschlussbestätigung datiert die Prüfung, ohne den Wertverlauf zu ergänzen.
        if (recordConfirmation && data[PROFILE_CASH_CONFIRMED_DATE_KEY] !== date) changes[PROFILE_CASH_CONFIRMED_DATE_KEY] = date;
        total += parseCashInput(cash.values[source.id]);
        if (source.id === activeId) for (const key of [...CASH_KEYS, PROFILE_CASH_CONFIRMED_DATE_KEY]) {
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
