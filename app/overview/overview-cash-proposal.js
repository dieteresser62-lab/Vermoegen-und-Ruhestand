/** @import * as O from "../../typcheck/overview-ui.js" */
import { readProfileCareSettings } from '../shared/care-profile-settings.js';
import { canGenerateExampleExpenses } from '../demo/beispielausgaben.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { projectPersonMonthIncome, validateIsoDate } from '../profile/profile-person-data.js';
import { liveCashData } from '../profile/profile-cash-update.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { computeSpent } from '../balance/balance-expenses-metrics.js';

export const CASH_PLAY_SOURCE = 'spielwert';
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;
const dayNumber = text => Date.UTC(.../** @type {[number, number, number]} */ (text.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) / 86400000;
const iso = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const displayDate = date => date.split('-').reverse().join('.');
const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

/** Reine Spielrechnung. Bestätigte Zeiträume werden auch im Jahresabschluss nicht erneut gezählt. */
/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Zeitanteiliger Tagesgeld-Spielwert mit Herleitung.
 */
export function calculateCashProposal({ person, data, end, fallbackStart, expenses, careSettings }) {
    if (person.error || !Number.isFinite(person.value)) throw new Error(person.error || 'Zuerst einen Tagesgeld-Ausgangsstand eintragen.');
    const last = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
    if (validateIsoDate(end).status !== 'valid' || validateIsoDate(fallbackStart).status !== 'valid'
        || last && validateIsoDate(last).status !== 'valid') throw new Error('Zeitraum für den Spielwert fehlt.');
    const startDay = last ? dayNumber(last) + 1 : dayNumber(fallbackStart), endDay = dayNumber(end);
    let pension = 0, income = 0, spent = 0, days = 0;
    const missing = [];
    for (let cursor = startDay; cursor <= endDay;) {
        const date = new Date(cursor * 86400000), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
        const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const count = Math.min(endDay - cursor + 1, monthDays - date.getUTCDate() + 1), fraction = count / monthDays;
        const personIncome = projectPersonMonthIncome(data, year, month, careSettings);
        pension += personIncome.pension * fraction;
        income += personIncome.income * fraction;
        const entry = expenses?.years?.[year]?.months?.[month]?.profiles?.[person.id];
        if (entry?.categories) spent += computeSpent(entry.categories).spent * fraction;
        else missing.push(`${String(month).padStart(2, '0')}.${year}`);
        days += count; cursor += count;
    }
    pension = rounded(pension); income = rounded(income); spent = rounded(spent);
    const interest = rounded(person.value * .01 * days / 365);
    const value = rounded(person.value + pension + income - spent + interest);
    if (![pension, income, spent, interest, value].every(Number.isFinite)) throw new Error('Spielwert ist nicht berechenbar.');
    const from = days ? new Date(startDay * 86400000).toISOString().slice(0, 10) : end;
    const explanation = `Spielwert für ${person.name}: ${days ? displayDate(from) + ' bis ' + displayDate(end) : 'kein neuer Zeitraum seit dem letzten Stand'}. `
        + `Ausgangsstand ${money(person.value)}${last ? ' vom ' + displayDate(last) : ' ohne Datum; gerechnet ab ' + displayDate(fallbackStart)} `
        + `+ Rente ${money(pension)} + sonstige Einkünfte ${money(income)} − Ausgaben ${money(spent)} + Zins ${money(interest)} = ${money(value)}. `
        + `Monatsbeträge und importierte Ausgaben zählen zeitanteilig nach Kalendertagen; der Rentenbeginn zählt ab dem Beginnmonat. `
        + 'Tagesgeld zählt als Ausgabenkonto; die Entnahme finanziert die Ausgaben und wird nicht zusätzlich abgezogen. '
        + `Zins: 1 % pro Jahr auf den Ausgangsstand, ${days}/365 Tage. `
        + (missing.length ? `Fehlende Ausgaben (${missing.join(', ')}) zählen hier mit 0 €. ` : '')
        + 'Dies ist eine Spielannahme. Gespeichert wird erst mit dem Abschluss.';
    return { source: CASH_PLAY_SOURCE, value, from, through: end, pension, income, expenses: spent, interest, explanation,
        ...(value < 0 ? { error: 'Der Vorschlag ist negativ. Bitte einen Tagesgeld-Stand ab null eintragen.' } : {}) };
}

/** Nur im bestätigten Spielbereich; keine Writes, keine Netzabfragen und kein Registry-Fallback für Livewerte. */
/** @param {O.CashProposalOptions} [options] @returns {O.CashProposals} */
export function createCashProposals({ doc = globalThis.document, model, people, targetYear = null,
    controller = getProbelaufController(doc), storage = persistenceStorage } = {}) {
    if (!canGenerateExampleExpenses(controller, { allowBusy: true })) return {};
    const now = model.now || appNow();
    const end = targetYear === null ? localCalendarDate(now) : iso(targetYear, 12, 31);
    const fallbackStart = targetYear === null ? iso(model.occasion.previousYear, model.occasion.previousMonth, 1) : iso(targetYear, 1, 1);
    try {
        const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
        const expenseResult = loadExpensesStoreResult(storage);
        if (expenseResult.status === 'corrupt') throw new Error('Ausgaben sind nicht sicher lesbar.');
        return Object.fromEntries(people.map(person => {
            try {
                const profile = registry.profiles[person.id];
                if (!profile) throw new Error('Personenquelle fehlt.');
                const data = person.id === model.activeId ? liveCashData(storage) : profile.data;
                return [person.id, calculateCashProposal({ person, data, end, fallbackStart, expenses: expenseResult.store, careSettings: readProfileCareSettings(storage, person.id) })];
            } catch (error) { return [person.id, { error: error.message }]; }
        }));
    } catch (error) { return Object.fromEntries(people.map(person => [person.id, { error: error.message }])); }
}
