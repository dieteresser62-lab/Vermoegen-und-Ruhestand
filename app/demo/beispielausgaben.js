import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { CONFIG } from '../balance/balance-config.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { overviewScope, readOverviewSummary, OVERVIEW_SUMMARY_KEY } from '../overview/overview-storage.js';
import { planScope, readHouseholdPlan } from '../profile/household-plan.js';
import { splitExampleExpenseNeeds } from './beispielausgaben-needs.js';

export const EXAMPLE_SOURCE = 'probelauf-example';
/**
 * @param controller Besitzer des laufenden Vorgangs.
 * @param options Optionen des Aufrufers.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function canGenerateExampleExpenses(controller = getProbelaufController(globalThis.document), { allowBusy = false } = {}) {
    return Boolean(typeof controller?.initialize === 'function' && controller?.state?.active && controller.state.phase === 'active'
        && controller.runtime?.canContinue && (allowBusy || !controller.busy) && !controller.blocked
        // Ohne Testdatum („Stand heute“) gilt das heutige Datum.
        && (controller.state.testDate === null || controller.state.testDate === localCalendarDate(appNow())));
}
/**
 * @param controller Besitzer des laufenden Vorgangs.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function assertExampleExpensesAllowed(controller) {
    if (!canGenerateExampleExpenses(controller)) throw Object.assign(new Error('Beispielausgaben sind nur im bestätigten aktiven Spielbereich verfügbar.'), { code: 'EXPENSES_NOT_ALLOWED' });
}

// Das Haushaltsbudget und der gemeinsam gespeicherte Bedarf werden genau einmal gelesen.
/**
 * @param options Optionen des Aufrufers.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function resolveExampleExpensesBasis({ year, ids, budget = null, storage = persistenceStorage }) {
    const scope = overviewScope(ids.length === 1 ? 'single' : 'household', ids);
    const summary = readOverviewSummary(storage.getItem(OVERVIEW_SUMMARY_KEY), year, scope);
    const candidate = budget ?? summary?.monthlyBudget;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
    const loaded = loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) });
    const inputs = loaded.status === 'valid' ? loaded.value?.inputs : null;
    const number = value => value !== null && value !== undefined && value !== '' ? Number(String(value).replace(',', '.')) : NaN;
    const floor = number(inputs?.floorBedarf), flex = number(inputs?.flexBedarf);
    const basis = (floor + flex) / 12;
    if (!Number.isFinite(basis) || basis <= 0 || floor < 0 || flex < 0) throw new Error('Kein gültiges gemeinsames Monatsbudget oder Haushaltsbedarf vorhanden. Bitte den Plan in Balance prüfen.');
    return basis;
}
const hash = text => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };
/**
 * @param options Optionen des Aufrufers.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function resolveExampleExpensesFloor({ ids, storage = persistenceStorage }) {
    const plan = readHouseholdPlan({ scope: planScope(ids.length === 1 ? 'single' : 'household', ids), storage });
    if (plan.status === 'valid') return plan.entry.values.floorBedarf / 12;
    const loaded = loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) });
    const value = loaded.status === 'valid' ? Number(String(loaded.value?.inputs?.floorBedarf).replace(',', '.')) : NaN;
    if (!Number.isFinite(value) || value < 0) throw new Error('Kein gültiger gemeinsamer Grundbedarf vorhanden. Bitte den Plan in Balance prüfen.');
    return value / 12;
}
function distribute(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    const cents = weights.map(weight => Math.floor(total * weight / sum));
    for (let i = 0, rest = total - cents.reduce((a, b) => a + b, 0); i < rest; i++) cents[i % cents.length]++;
    return cents;
}

/** CSV-only: keine Speicherzugriffe, kein Zufall und keine Uhrzeit im Rechenpfad.
 *
 * @param options Optionen des Aufrufers.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function generateExampleExpensesCsv({ controller = getProbelaufController(globalThis.document), ids, profileId, year, month, basis, floorMonthly = basis / 2 }) {
    assertExampleExpensesAllowed(controller);
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)
        || new Set(ids).size !== ids.length || !ids.includes(profileId)
        || !Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12
        || !Number.isFinite(basis) || basis <= 0 || !Number.isFinite(floorMonthly) || floorMonthly < 0) throw new Error('Ungültiger Haushalt, Monat oder Ausgabenbasis.');
    const sorted = [...ids].sort(), absoluteMonth = year * 12 + month - 1;
    const seed = JSON.stringify([sorted, absoluteMonth]);
    const repair = absoluteMonth % 5 === 0;
    const factor = repair ? 1.08 + hash(seed) % 201 / 10000
        : month === 12 ? 1.05 + hash(seed) % 501 / 10000 : .85 + hash(seed) % 2001 / 10000;
    const total = Math.round(basis * factor * 100);
    if (!Number.isSafeInteger(total) || total < sorted.length * 8) throw new Error('Ausgabenbasis ist für eine centgenaue Verteilung ungeeignet.');
    const shares = distribute(total, sorted.map(id => 80 + hash(id) % 41));
    const personSeed = seed + profileId;
    const names = ['Wohnen', 'Lebensmittel', 'Mobilität', 'Gesundheit', 'Freizeit/Reisen', 'Versicherungen', 'Sonstiges'];
    const weights = [32, 20, 9, 7, 15, 10, 7].map((value, index) => value + hash(personSeed + index) % 7);
    if (repair && sorted[hash(seed + 'repair') % sorted.length] === profileId) { names.push('Reparatur'); weights.push(60); }
    const amounts = distribute(shares[sorted.indexOf(profileId)], weights);
    if (amounts.some(value => value <= 0)) throw new Error('Ausgabenbasis ist für positive Kategorien zu klein.');
    const categories = Object.fromEntries(names.map((name, i) => [name, -amounts[i] / 100]));
    const needs = splitExampleExpenseNeeds(categories, Math.min(.98, floorMonthly * 1.06 * 100 / total));
    const money = amount => amount.toFixed(2).replace('.', ',');
    return 'Kategorie;Betrag;Bedarf\n' + Object.entries(needs).flatMap(([name, pair]) =>
        [['Floor', pair.floor], ['Flex', pair.flex]].filter(([, amount]) => amount !== 0)
            .map(([need, amount]) => `${name};${money(amount)};${need}`)).join('\n');
}
