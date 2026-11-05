import { IMMOBILIEN_KEY, readImmobilien, immobilienIncome } from './profile-immobilien.js';
import { appNow } from '../shared/app-clock.js';
import { computeRentAdjRate } from '../shared/income-adjustment.js';
import { readPlannedInflows } from './profile-planned-inflows.js';

export const PENSION_LABEL_KEY = 'profile_rente_bezeichnung';
export const INCOME_KEY = 'profile_einkuenfte_v1';
export const INCOME_MIGRATION_KEY = 'profile_einkuenfte_migration_v1';
export const INCOME_KEYS = Object.freeze({ einkuenfte: INCOME_KEY, einkuenfteMigration: INCOME_MIGRATION_KEY });
const validMonth = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);

/**
 * @param entries Einträge der betroffenen Liste.
 * @returns Feldbezogene Fehler der Einkünfteliste.
 */
export function incomeErrors(entries) {
    const errors = [], ids = new Set();
    entries.forEach((entry, index) => {
        const add = (field, message) => errors.push({ field: `income-${index}-${field}`, message: `Einkünfte ${index + 1}: ${message}` });
        if (!entry || typeof entry !== 'object') { add('id', 'Die Zeile ist beschädigt.'); return; }
        if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) add('id', 'Die Zeilenkennung fehlt oder ist doppelt.');
        ids.add(entry.id);
        if (typeof entry.bezeichnung !== 'string' || entry.bezeichnung.length > 60) add('bezeichnung', 'Bezeichnung darf höchstens 60 Zeichen haben.');
        const fixed = entry.art === 'sonstige', amount = fixed ? entry.betragMonat : entry.betrag;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || (fixed && !Number.isFinite(amount * 12))) add(fixed ? 'betragMonat' : 'betrag', 'Betrag (netto) muss größer als 0 Euro sein.');
        if (fixed) {
            for (const key of ['ab', 'bis']) if (entry[key] !== null && !validMonth(entry[key])) add(key, 'Bitte einen gültigen Monat mit Jahr eingeben.');
            if (entry.ab && entry.bis && entry.ab > entry.bis) add('bis', 'Das Ende darf nicht vor dem Beginn liegen.');
            if (!['keine', 'inflation', 'lohn'].includes(entry.anpassung)) add('anpassung', 'Ungültige Anpassung.');
        } else {
            if (entry.art !== undefined) add('art', 'Ungültige Einkunftsart.');
            if (!validMonth(entry.monat)) add('monat', 'Bitte einen gültigen Monat mit Jahr eingeben.');
        }
    });
    return errors;
}

// Entwürfe dürfen unvollständig sein. Gespeicherte Werte werden am Leser geprüft.
/**
 * @param raw Gespeicherter Rohwert.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Gelesene Einkünfte; ungeprüfte Entwürfe nur bei ausdrücklicher Auswahl.
 */
export function readIncome(raw, { draft = false } = {}) {
    if (raw == null || raw === '') return [];
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error('Einkünfte: Die gespeicherte Liste ist beschädigt oder hat eine unbekannte Version.');
    const errors = incomeErrors(value.entries);
    if (!draft && errors.length) throw new Error(errors.map(error => error.message).join(' '));
    return value.entries.map(entry => ({ ...entry }));
}
export const writeIncome = entries => JSON.stringify({ schemaVersion: 1, entries });

/** Einmalige Übernahme, ohne die alten Records zu löschen oder zu überschreiben. */
/**
 * @param data Personenrecords der gelesenen Quelle.
 * @returns Personenrecords mit einmalig übernommenen Altangaben.
 */
export function migrateIncomeRecord(data = {}) {
    if (data[INCOME_MIGRATION_KEY] != null && data[INCOME_MIGRATION_KEY] !== '1') throw new Error('Unbekannte Einkünfte-Übernahme.');
    if (data[INCOME_MIGRATION_KEY] === '1') {
        if (!data[INCOME_KEY]) throw new Error('Einkünfte: Die übernommene Liste fehlt.');
        readIncome(data[INCOME_KEY]); return data;
    }
    // Eine bereits vorhandene neue Liste hat Vorrang, auch wenn sie leer ist.
    if (data[INCOME_KEY] != null && data[INCOME_KEY] !== '') {
        readIncome(data[INCOME_KEY]);
        return { ...data, [INCOME_MIGRATION_KEY]: '1' };
    }
    const entries = [];
    const raw = data.profile_sonstige_einkuenfte;
    const amount = raw == null || raw === '' ? 0 : typeof raw === 'boolean' ? NaN : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Ungültige frühere sonstige Einkünfte.');
    if (amount > 0) entries.push({ id: 'legacy-sonstige', art: 'sonstige', bezeichnung: 'Sonstige Einkünfte', betragMonat: amount, ab: null, bis: null, anpassung: 'keine' });
    readPlannedInflows(data.profile_planned_inflows_v1).forEach((entry, index) => entries.push({
        id: `legacy-einmalig-${index + 1}`, monat: `${String(entry.year).padStart(4, '0')}-01`, betrag: entry.amount, bezeichnung: entry.label
    }));
    const serialized = writeIncome(entries);
    readIncome(serialized);
    return { ...data, [INCOME_KEY]: serialized, [INCOME_MIGRATION_KEY]: '1' };
}
export const incomeFromRecord = data => readIncome(migrateIncomeRecord(data)[INCOME_KEY]);
export const effectiveIncomeFromRecord = data => [...incomeFromRecord(data), ...immobilienIncome(readImmobilien(data[IMMOBILIEN_KEY]))];
/**
 * @param storage Speicherzugang des vorhandenen Besitzers.
 * @returns Einkünfte aus dem aktuellen Speicher.
 */
export function incomeFromStorage(storage) {
    const data = { [INCOME_KEY]: storage.getItem(INCOME_KEY), [INCOME_MIGRATION_KEY]: storage.getItem(INCOME_MIGRATION_KEY) };
    if (data[INCOME_MIGRATION_KEY] !== '1' && !data[INCOME_KEY]) {
        for (const key of ['profile_sonstige_einkuenfte', 'profile_planned_inflows_v1']) data[key] = storage.getItem(key);
    }
    return incomeFromRecord(data);
}

/**
 * @param entries Einträge der betroffenen Liste.
 * @param month Kalendermonat von 1 bis 12.
 * @returns Summe fester Einkünfte im angegebenen Monat.
 */
export function fixedMonthlyIncome(entries, month) {
    return entries.filter(entry => entry.art === 'sonstige' && (!entry.ab || entry.ab <= month) && (!entry.bis || entry.bis >= month))
        .reduce((sum, entry) => sum + entry.betragMonat, 0);
}

/** Monatsanteil im Planjahr; die erste Fortschreibung gilt erst im Folgejahr. */
/**
 * @param entries Einträge der betroffenen Liste.
 * @param year Kalenderjahr der Projektion.
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Mittlerer Monatsbetrag im Planjahr einschließlich Anpassung.
 */
export function monthlyOtherIncome(entries, year, { baseYear = appNow().getFullYear(), inflationPct = 0, wagePct = 0 } = {}) {
    return entries.filter(entry => entry.art === 'sonstige').reduce((sum, entry) => {
        const first = !entry.ab || Number(entry.ab.slice(0, 4)) < year ? 1 : Number(entry.ab.slice(0, 4)) > year ? 13 : Number(entry.ab.slice(5));
        const last = !entry.bis || Number(entry.bis.slice(0, 4)) > year ? 12 : Number(entry.bis.slice(0, 4)) < year ? 0 : Number(entry.bis.slice(5));
        const rate = entry.anpassung === 'inflation' ? inflationPct : entry.anpassung === 'lohn'
            ? computeRentAdjRate({ rentAdjMode: 'wage' }, { lohn: wagePct }) : 0;
        const months = Math.max(0, last - first + 1);
        const monthly = months === 12 ? entry.betragMonat : entry.betragMonat * months / 12;
        return sum + monthly * Math.pow(1 + rate / 100, Math.max(0, year - baseYear));
    }, 0);
}

export const annualOtherIncome = (entries, year, options) => monthlyOtherIncome(entries, year, options) * 12;

/** Bestehender Runnervertrag: Monat bestimmt nur das Jahr; Reihenfolge bleibt erhalten. */
export const simulatorOneTimeIncome = data => incomeFromRecord(data).filter(entry => !entry.art)
    .map(entry => ({ year: Number(entry.monat.slice(0, 4)), amount: entry.betrag, label: entry.bezeichnung }));

/**
 * @param raw Gespeicherter Rohwert.
 * @returns Kalendermonat oder unveränderter ungültiger Eingabetext.
 */
export function incomeMonthInput(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;
    if (validMonth(value)) return value;
    const match = /^(\d{2})[./](\d{4})$/.exec(value);
    const month = match ? `${match[2]}-${match[1]}` : value;
    return validMonth(month) ? month : value;
}
export const incomeMonthDisplay = value => value ? `${value.slice(5, 7)}.${value.slice(0, 4)}` : '';
