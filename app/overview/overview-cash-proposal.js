import { canGenerateExampleExpenses } from '../demo/beispielausgaben.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { projectPersonPension, validateIsoDate } from '../profile/profile-person-data.js';
import { liveCashData } from '../profile/profile-cash-update.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { planScope } from '../profile/household-plan.js';
import { loadExpensesStoreResult } from '../balance/balance-expenses-storage.js';
import { computeSpent } from '../balance/balance-expenses-metrics.js';
import { readOverviewSummary, OVERVIEW_SUMMARY_KEY } from './overview-storage.js';

export const CASH_PLAY_SOURCE = 'spielwert';
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;
const dayNumber = text => Date.UTC(...text.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86400000;
const iso = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const displayDate = date => date.split('-').reverse().join('.');
const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

/** Reine Spielrechnung. Bestätigte Zeiträume werden auch im Jahresabschluss nicht erneut gezählt. */
export function calculateCashProposal({ person, data, end, fallbackStart, expenses, withdrawalForYear, personCount }) {
    if (person.error || !Number.isFinite(person.value)) throw new Error(person.error || 'Zuerst einen Tagesgeld-Ausgangsstand eintragen.');
    const last = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
    if (validateIsoDate(end).status !== 'valid' || validateIsoDate(fallbackStart).status !== 'valid'
        || last && validateIsoDate(last).status !== 'valid' || !Number.isInteger(personCount) || personCount < 1) throw new Error('Zeitraum für den Spielwert fehlt.');
    const startDay = last ? dayNumber(last) + 1 : dayNumber(fallbackStart), endDay = dayNumber(end);
    let pension = 0, income = 0, withdrawals = 0, spent = 0, days = 0;
    const missing = [], sources = new Set();
    for (let cursor = startDay; cursor <= endDay;) {
        const date = new Date(cursor * 86400000), year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
        const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const count = Math.min(endDay - cursor + 1, monthDays - date.getUTCDate() + 1), fraction = count / monthDays;
        const personIncome = projectPersonPension(data, year);
        const receivesPension = month > 12 - personIncome.monateImJahr;
        pension += (receivesPension ? personIncome.renteMonatlich : 0) * fraction;
        income += personIncome.sonstigeEinkuenfte * fraction;
        const withdrawal = withdrawalForYear(year);
        withdrawals += withdrawal.value / personCount * fraction; sources.add(withdrawal.source);
        const entry = expenses?.years?.[year]?.months?.[month]?.profiles?.[person.id];
        if (entry?.categories) spent += computeSpent(entry.categories).spent * fraction;
        else missing.push(`${String(month).padStart(2, '0')}.${year}`);
        days += count; cursor += count;
    }
    pension = rounded(pension); income = rounded(income); withdrawals = rounded(withdrawals); spent = rounded(spent);
    const interest = rounded(person.value * .01 * days / 365);
    const value = rounded(person.value + pension + income - withdrawals - spent + interest);
    if (![pension, income, withdrawals, spent, interest, value].every(Number.isFinite)) throw new Error('Spielwert ist nicht berechenbar.');
    const from = days ? new Date(startDay * 86400000).toISOString().slice(0, 10) : end;
    const explanation = `Spielwert für ${person.name}: ${days ? displayDate(from) + ' bis ' + displayDate(end) : 'kein neuer Zeitraum seit dem letzten Stand'}. `
        + `Ausgangsstand ${money(person.value)}${last ? ' vom ' + displayDate(last) : ' ohne Datum; gerechnet ab ' + displayDate(fallbackStart)} `
        + `+ Rente ${money(pension)} + sonstige Einkünfte ${money(income)} − Entnahmen ${money(withdrawals)} − Ausgaben ${money(spent)} + Zins ${money(interest)} = ${money(value)}. `
        + `Monatsbeträge und importierte Ausgaben zählen zeitanteilig nach Kalendertagen; der Rentenbeginn zählt ab dem Beginnmonat. `
        + `Entnahmen: ${[...sources].join(', ') || 'kein neuer Zeitraum'}, gleichmäßig auf ${personCount} Personen verteilt. `
        + `Zins: 1 % pro Jahr auf den Ausgangsstand, ${days}/365 Tage. `
        + (missing.length ? `Fehlende Ausgaben (${missing.join(', ')}) zählen hier mit 0 €. ` : '')
        + 'Dies ist eine Spielannahme. Gespeichert wird erst mit dem Abschluss.';
    return { source: CASH_PLAY_SOURCE, value, from, through: end, pension, income, withdrawals, expenses: spent, interest, explanation,
        ...(value < 0 ? { error: 'Der Vorschlag ist negativ. Bitte einen Tagesgeld-Stand ab null eintragen.' } : {}) };
}

/** Nur im bestätigten Spielbereich; keine Writes, keine Netzabfragen und kein Registry-Fallback für Livewerte. */
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
        const area = planScope(model.members?.some(person => person.belongs) ? 'household' : model.scope.kind, model.scope.ids);
        const withdrawalForYear = year => {
            const record = readAnnualPlanRecord({ year, scope: area, storage });
            if (record?.status === 'invalid') throw new Error('Jahresplan ist nicht sicher lesbar.');
            if (record) return { value: record.adopted.monthlyWithdrawal, source: `laut Plan ${year}` };
            const summaries = people.map(person => readOverviewSummary(person.id === model.activeId ? storage.getItem(OVERVIEW_SUMMARY_KEY)
                : registry.profiles[person.id]?.data?.[OVERVIEW_SUMMARY_KEY], year, model.scope));
            const summary = summaries.every(item => item && JSON.stringify(item) === JSON.stringify(summaries[0])) ? summaries[0]
                : model.summary?.year === year ? model.summary : null;
            return summary ? { value: summary.monthlyWithdrawal, source: `vorläufige Entnahme ${year}` }
                : { value: 0, source: `kein Entnahmebetrag für ${year}, hier 0 €` };
        };
        return Object.fromEntries(people.map(person => {
            try {
                const profile = registry.profiles[person.id];
                if (!profile) throw new Error('Personenquelle fehlt.');
                const data = person.id === model.activeId ? liveCashData(storage) : profile.data;
                return [person.id, calculateCashProposal({ person, data, end, fallbackStart, expenses: expenseResult.store, withdrawalForYear, personCount: people.length })];
            } catch (error) { return [person.id, { error: error.message }]; }
        }));
    } catch (error) { return Object.fromEntries(people.map(person => [person.id, { error: error.message }])); }
}
