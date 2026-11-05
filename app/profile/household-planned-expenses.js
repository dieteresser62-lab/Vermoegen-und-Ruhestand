/** @import * as D from "../../typcheck/datenvertraege.js" */
/** @import * as I from "../../typcheck/speicher-integration.js" */
import { assertPlanScope, readSimulatorHouseholdPlan } from './household-plan.js';
import { persistenceStorage, PersistenceFacade } from '../shared/persistence-facade.js';
import { appNow } from '../shared/app-clock.js';

export const PLANNED_EXPENSES_KEY = 'household_planned_expenses_v1';
/** @param {unknown} value */
const month = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
/** @param {D.PlannedExpense} entry @returns {entry is D.PlannedExpenseFixed} */
export const isFixedExpense = entry => Object.hasOwn(entry, 'betragMonat');

/**
 * @param {unknown} entries
 * @returns {{field: string, message: string}[]}
 */
export function plannedExpenseErrors(entries) {
    if (!Array.isArray(entries)) return [{ field: 'plannedExpenses', message: 'Geplante Ausgaben: Die Liste ist beschädigt.' }];
    /** @type {{field: string, message: string}[]} */
    const errors = [], ids = new Set();
    entries.forEach((entry, index) => {
        /** @param {string} field @param {string} message */
        const add = (field, message) => errors.push({ field: `expense-${index}-${field}`, message: `Geplante Ausgaben ${index + 1}: ${message}` });
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { add('id', 'Die Zeile ist beschädigt.'); return; }
        if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) add('id', 'Die Zeilenkennung fehlt oder ist doppelt.');
        ids.add(entry.id);
        if (entry.priceYear !== undefined && (!Number.isInteger(entry.priceYear) || entry.priceYear < 1 || entry.priceYear > 9999)) add('priceYear', 'Das Preisbezugsjahr ist ungültig.');
        if (entry.priceFactor !== undefined && (!Number.isFinite(entry.priceFactor) || entry.priceFactor <= 0)) add('priceFactor', 'Der Preisfaktor ist ungültig.');
        if (typeof entry.bezeichnung !== 'string' || entry.bezeichnung.length > 60) add('bezeichnung', 'Bezeichnung darf höchstens 60 Zeichen haben.');
        const fixed = isFixedExpense(entry), amount = fixed ? entry.betragMonat : entry.betrag;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || fixed && !Number.isFinite(amount * 12)) add(fixed ? 'betragMonat' : 'betrag', 'Betrag muss größer als 0 Euro sein.');
        if (fixed) {
            for (const key of /** @type {const} */ (['ab', 'bis'])) if (entry[key] !== null && !month(entry[key])) add(key, 'Bitte einen gültigen Monat mit Jahr eingeben.');
            if (entry.ab && entry.bis && entry.ab > entry.bis) add('bis', 'Das Ende darf nicht vor dem Beginn liegen.');
            if (!['keine', 'inflation'].includes(entry.anpassung)) add('anpassung', 'Ungültige Anpassung.');
        } else if (!month(entry.monat)) add('monat', 'Bitte einen gültigen Monat mit Jahr eingeben.');
    });
    return errors;
}

/**
 * @param {unknown} raw
 * @returns {D.PlannedExpensesRecord}
 */
export function assertPlannedExpensesRecord(raw) {
    const record = /** @type {D.PlannedExpensesRecord} */ (typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (record?.version !== 1 || !record.entries || typeof record.entries !== 'object' || Array.isArray(record.entries)) throw new Error('Geplante Ausgaben: Unbekannte Version oder beschädigter Datensatz.');
    for (const [key, entry] of Object.entries(record.entries)) {
        if (assertPlanScope(entry?.scope).key !== key) throw new Error('Geplante Ausgaben: Ungültiger Planbereich.');
        const errors = plannedExpenseErrors(entry.items);
        if (errors.length) throw new Error(errors.map(error => error.message).join(' '));
    }
    return record;
}

/** Gleiche Bereichsauswahl wie Haushalt & Plan; Profilwechsel kopiert keine Haushaltsliste. */
/**
 * @param {{storage?: D.RecordReader, scope?: D.PlanScope | null}} [options]
 * @returns {D.PlannedExpense[]}
 */
export function readPlannedExpenses({ storage = persistenceStorage, scope } = {}) {
    const raw = storage.getItem(PLANNED_EXPENSES_KEY);
    /** @type {D.PlannedExpensesRecord} */
const record = raw == null ? { version: 1, entries: {} } : assertPlannedExpensesRecord(raw);
    if (scope === undefined) scope = readSimulatorHouseholdPlan({ storage }).scope;
    if (scope) assertPlanScope(scope);
    return structuredClone(scope ? record.entries[/** @type {D.PlanScope} */ (scope).key]?.items || [] : []);
}

/**
 * @param {{scope?: D.PlanScope, items?: D.PlannedExpense[], storage?: D.RecordReader, persistence?: I.Facade, navigationOperation?: I.Operation, isCurrent?: () => boolean}} [options]
 * @returns {Promise<void>}
 */
export async function savePlannedExpenses({ scope, items, storage = persistenceStorage, persistence = PersistenceFacade,
    navigationOperation, isCurrent = () => true } = {}) {
    assertPlanScope(scope);
    const check = () => {
        navigationOperation?.check();
        if (!isCurrent() || persistence.hasSyncWriteBlocks?.() || globalThis.window?.__profileRecoveryBlocker) throw new Error('Geplante Ausgaben: Speichern gesperrt oder Planbereich gewechselt.');
    };
    check();
    const before = storage.getItem(PLANNED_EXPENSES_KEY);
    /** @type {D.PlannedExpensesRecord} */
    const record = before == null ? { version: 1, entries: {} } : structuredClone(assertPlannedExpensesRecord(before));
    const previous = record.entries[/** @type {D.PlanScope} */ (scope).key]?.items || [];
    const pricedItems = structuredClone(/** @type {D.PlannedExpense[]} */ (items)).map(item => {
        const old = previous.find(entry => entry.id === item.id);
        const amountKey = isFixedExpense(item) ? 'betragMonat' : 'betrag';
        item.priceYear = !old || /** @type {Partial<D.PlannedExpenseFixed & D.PlannedExpenseOnce>} */ (old)[amountKey] !== /** @type {Partial<D.PlannedExpenseFixed & D.PlannedExpenseOnce>} */ (item)[amountKey] ? appNow().getFullYear() : old.priceYear ?? 2026;
        return item;
    });
    record.entries[/** @type {D.PlanScope} */ (scope).key] = { scope: structuredClone(/** @type {D.PlanScope} */ (scope)), items: pricedItems };
    assertPlannedExpensesRecord(record);
    const raw = JSON.stringify(record);
    if (raw === before) return;
    try {
        await persistence.replaceRecordsTransactional({ [PLANNED_EXPENSES_KEY]: raw }, { probelaufDomainWrite: true,
            navigationOperation, allowKey: key => key === PLANNED_EXPENSES_KEY,
            expectedRecords: before == null ? {} : { [PLANNED_EXPENSES_KEY]: before },
            postValidate: actual => { check(); assertPlannedExpensesRecord(actual[PLANNED_EXPENSES_KEY]); } });
    } catch (error) {
        if (/** @type {I.AppError} */ (error).code === 'rollback_failed') persistence.blockSyncWrites?.([PLANNED_EXPENSES_KEY], 'Geplante Ausgaben und Rücknahme unbestätigt. Bitte neu laden und die Sicherung prüfen.');
        throw error;
    }
    check();
}

/** Kalenderjahr relativ zum Planjahr, nicht zum gezogenen historischen Marktjahr. */
/**
 * @param {D.PlannedExpense[]} items
 * @param {number} year
 * @param {number} [inflationFactor]
 * @returns {number}
 */
export function plannedExpensesForYear(items, year, inflationFactor = 1) {
    return (items || []).reduce((total, entry) => {
        const factor = inflationFactor * (entry.priceFactor ?? 1);
        if (!isFixedExpense(entry)) return total + (Number(entry.monat.slice(0, 4)) === year ? entry.betrag * factor : 0);
        const first = !entry.ab || entry.ab < `${year}-01` ? 1 : entry.ab > `${year}-12` ? 13 : Number(entry.ab.slice(5));
        const last = !entry.bis || entry.bis > `${year}-12` ? 12 : entry.bis < `${year}-01` ? 0 : Number(entry.bis.slice(5));
        return total + entry.betragMonat * Math.max(0, last - first + 1) * (entry.anpassung === 'inflation' ? factor : 1);
    }, 0);
}

/**
 * @param {{storage?: D.RecordReader, scope?: D.PlanScope | null}} options
 * @param {number} referenceYear
 */
export function simulatorPlannedExpenses(options = {}, referenceYear) {
    const items = readPlannedExpenses(options);
    return items.length ? { plannedExpenses: items, plannedExpensesReferenceYear: referenceYear } : {};
}

/** Einzelne Zahlungstermine; gleicher Jahresbetrag wie im Simulator. */
/**
 * @param {D.PlannedExpense[]} items
 * @param {number} year
 * @param {number} [inflationFactor]
 * @returns {{id: string, month: string, label: string, amount: number, fixed?: boolean}[]}
 */
export function plannedExpenseOccurrences(items, year, inflationFactor = 1) {
    return (items || []).flatMap(entry => {
        const factor = inflationFactor * (entry.priceFactor ?? 1);
        if (!isFixedExpense(entry)) return Number(entry.monat.slice(0, 4)) === year
            ? [{ id: entry.id, month: entry.monat, label: entry.bezeichnung, amount: entry.betrag * factor }] : [];
        return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
            .filter(month => (!entry.ab || entry.ab <= month) && (!entry.bis || entry.bis >= month))
            .map(month => ({ id: entry.id, month, label: entry.bezeichnung, fixed: true,
                amount: entry.betragMonat * (entry.anpassung === 'inflation' ? factor : 1) }));
    });
}
