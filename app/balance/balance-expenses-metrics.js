/**
 * Module: Balance Expenses Metrics
 * Purpose: DOM-free calculations for the expenses check.
 */
"use strict";

/** Leerimporte und endliche Zahlenstrings aus Altständen gelten als erfasst. */
/** @param {import('../../typcheck/datenvertraege.js').ExpenseEntryRead} record @returns {boolean} */
export function hasExpenseImport(record) {
    const categories = record?.categories;
    return Boolean(categories && typeof categories === 'object' && !Array.isArray(categories)
        && Object.values(categories).every(value => ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value)))
        && Number.isFinite(computeSpent(categories).spent));
}

/** Optionale signierte Aufteilung; Alt-Kategoriesummen bleiben maßgeblich. */
/** @param {import('../../typcheck/datenvertraege.js').ExpenseEntryRead} record @returns {boolean} */
export function hasCategoryNeeds(record) {
    const needs = record?.categoryNeeds;
    if (!hasExpenseImport(record) || !needs || typeof needs !== 'object' || Array.isArray(needs)) return false;
    const categories = Object.entries(record.categories);
    return Object.keys(needs).length === categories.length && categories.every(([name, total]) => {
        if (!Object.hasOwn(needs, name)) return false;
        const pair = /** @type {import('../../typcheck/datenvertraege.js').CategoryNeeds} */ (needs[name]);
        return pair && typeof pair === 'object' && !Array.isArray(pair)
            && typeof pair.floor === 'number' && Number.isFinite(pair.floor)
            && typeof pair.flex === 'number' && Number.isFinite(pair.flex)
            && Number.isFinite(pair.floor + pair.flex)
            && Math.abs(pair.floor + pair.flex - Number(total)) < 0.005;
    });
}

/** Haushalt und Jahr, rein lesend. forecastMonths begrenzt auf abgelaufene Monate.
 * Die Gesamthochrechnung zählt vollständige positive Monate wie computeYearStats.
 * Floor/Flex verwenden davon nur die Monate mit Aufteilung aller Haushaltspersonen.
 */
/** @param {{yearData: import('../../typcheck/datenvertraege.js').ExpensesYearAlt, profileIds?: string[], forecastMonths?: number[]}} options @returns {import('../../typcheck/balance-ui.js').NeedsStats} */
export function computeHouseholdNeedsStats({ yearData, profileIds = null, forecastMonths = null }) {
    const ids = profileIds ?? [...new Set(Object.values(yearData?.months || {})
        .flatMap(data => Object.entries(data.profiles || {}).filter(([, entry]) => hasExpenseImport(entry)).map(([id]) => id)))];
    const months = [];
    const selectedYear = { months: {} }, completeMonths = [];
    for (let month = 1; month <= 12; month++) {
        const entries = Object.entries(yearData?.months?.[month]?.profiles || {})
            .filter(([id, entry]) => ids.includes(id) && hasExpenseImport(entry));
        selectedYear.months[month] = { profiles: Object.fromEntries(entries) };
        if (!entries.length) continue;
        const complete = entries.length === ids.length;
        if (complete && (forecastMonths === null || forecastMonths.includes(month))) completeMonths.push(month);
        const total = entries.reduce((sum, [, entry]) => sum + computeBudgetSpent(entry).spent, 0);
        const withBreakdown = complete && entries.every(([, entry]) => hasCategoryNeeds(entry));
        let floor = null, flex = null;
        const planned = entries.reduce((sum, [, entry]) => sum + computeBudgetSpent(entry).planned, 0);
        if (withBreakdown) {
            floor = 0; flex = 0;
            for (const [, entry] of entries) {
                const direction = computeSpent(entry.categories).sum < 0 ? -1 : 1;
                for (const pair of Object.values(/** @type {Record<string, import('../../typcheck/datenvertraege.js').CategoryNeeds>} */ (entry.categoryNeeds))) {
                    floor += direction * pair.floor; flex += direction * pair.flex;
                }
            }
            const fromFlex = Math.min(Math.max(0, flex), planned);
            flex -= fromFlex; floor -= planned - fromFlex;
        }
        months.push({ month, withBreakdown, floor, flex, total, planned });
    }
    const counted = months.filter(month => month.total > 0 && completeMonths.includes(month.month));
    const split = counted.filter(month => month.withBreakdown);
    const totals = computeYearStats({ yearData: selectedYear, forecastMonths: completeMonths });
    const average = key => split.length ? split.reduce((sum, month) => sum + month[key], 0) / split.length : null;
    const avgMonthly = { floor: average('floor'), flex: average('flex'), total: totals.avgMonthly };
    const annualForecast = Object.fromEntries(Object.entries(avgMonthly).map(([key, value]) => [key, value === null ? null : value * 12]));
    return { months, monthsWithBreakdown: split.length, monthsWithoutBreakdown: counted.length - split.length, avgMonthly, annualForecast };
}

/** @param {Record<string, number|string>} categories @returns {{sum: number, spent: number}} */
export function computeSpent(categories) {
    const values = Object.values(categories || {});
    const sum = /** @type {number} */ (values.reduce((/** @type {number} */ acc, val) => acc + (Number(val) || 0), 0));
    const spent = sum < 0 ? -sum : sum;
    return { sum, spent };
}

/** Rohsumme bleibt für Kontostände erhalten; nur der Budgetvergleich zieht Zuordnungen ab. */
/** @param {import('../../typcheck/datenvertraege.js').ExpenseEntryRead} record @returns {{spent: number, planned: number, total: number}} */
export function computeBudgetSpent(record) {
    const { spent } = computeSpent(record?.categories);
    const assignments = record?.plannedExpenses === undefined ? [] : record.plannedExpenses;
    if (!Array.isArray(assignments) || assignments.some(item => !item || typeof item.id !== 'string' || !item.id
        || typeof item.scopeKey !== 'string' || !item.scopeKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)
        || typeof item.label !== 'string' || !Number.isFinite(item.amount) || item.amount <= 0)) throw new Error('Beschädigte Zuordnung geplanter Ausgaben.');
    const planned = assignments.reduce((sum, item) => sum + item.amount, 0);
    if (planned > spent + 0.01) throw new Error('Geplante Ausgaben übersteigen die importierte Summe.');
    return { spent: Math.max(0, spent - planned), planned, total: spent };
}

/** @param {number[]} values @returns {number} */
export function computeMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/** @param {import('../../typcheck/datenvertraege.js').ExpensesMonthAlt} monthData @param {boolean} [includePlanned] @returns {number} */
export function sumMonthProfiles(monthData, includePlanned = false) {
    const profiles = monthData?.profiles || {};
    return Object.values(profiles).reduce((acc, entry) => {
        const { spent } = includePlanned ? computeSpent(entry?.categories) : computeBudgetSpent(entry);
        return acc + spent;
    }, 0);
}

/** @param {import('../../typcheck/balance-ui.js').YearStatsOptions} options @returns {import('../../typcheck/balance-ui.js').YearStats} */
export function computeYearStats({ yearData, annualBudget = 0, monthlyBudget = 0, includePlanned = false, forecastMonths = null }) {
    let annualUsed = 0;
    let ytdUsed = 0;
    let monthsWithData = 0;
    let sumWithData = 0;
    const monthTotalsWithData = [];

    for (let month = 1; month <= 12; month++) {
        const monthData = yearData?.months?.[String(month)] || { profiles: {} };
        const monthTotal = sumMonthProfiles(monthData, includePlanned);
        annualUsed += monthTotal;
        if (monthTotal > 0 && (forecastMonths === null || forecastMonths.includes(month))) {
            ytdUsed += monthTotal;
            monthsWithData += 1;
            sumWithData += monthTotal;
            monthTotalsWithData.push(monthTotal);
        }
    }

    const annualRemaining = (annualBudget || 0) - annualUsed;
    const avgMonthly = monthsWithData > 0 ? sumWithData / monthsWithData : 0;
    const medianMonthly = computeMedian(monthTotalsWithData);
    const annualForecast = avgMonthly > 0 ? avgMonthly * 12 : 0;
    const ytdBudget = (monthlyBudget || 0) * monthsWithData;
    const ytdDelta = ytdBudget > 0 ? (ytdUsed - ytdBudget) : 0;

    return {
        annualUsed,
        annualRemaining,
        ytdUsed,
        ytdBudget,
        ytdDelta,
        annualForecast,
        avgMonthly,
        medianMonthly,
        monthsWithData
    };
}

/**
 * Lesende Jahresprojektion aller gespeicherten Profile, unabhängig von activeYear.
 * currentYear ist das vom Aufrufer bestimmte lokale Kalenderjahr; kein Uhr-/Storagezugriff.
 * Nullimporte bleiben sichtbar, reine Auswahlcontainer werden ausgelassen.
 */
/** @param {import('../../typcheck/datenvertraege.js').ExpensesStoreAlt} store @param {number} currentYear @param {{includeSegments?: boolean}} [options] @returns {import('../../typcheck/balance-ui.js').ExpenseHistoryRow[]} */
export function prepareExpensesHistoryMetrics(store, currentYear, { includeSegments = false } = {}) {
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!isRecord(store?.years)) return [];

    return Object.entries(store.years)
        .filter(([key, yearData]) => {
            const year = Number(key);
            if (!Number.isSafeInteger(year) || year <= 0 || String(year) !== key
                || !isRecord(yearData) || !isRecord(yearData.months)) return false;
            // Nur die zwölf Kalendermonate können einen importierten Eintrag belegen.
            for (let month = 1; month <= 12; month++) {
                const profiles = yearData.months[String(month)]?.profiles;
                if (isRecord(profiles) && Object.values(profiles).some(entry =>
                    isRecord(entry) && isRecord(entry.categories))) return true;
            }
            return false;
        })
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([key, yearData]) => {
            const year = Number(key);
            const { annualUsed, monthsWithData, avgMonthly } = computeYearStats({ yearData, includePlanned: true });
            const segments = { floor: 0, flex: 0, unallocated: 0 };
            if (includeSegments) {
                for (let month = 1; month <= 12; month++) for (const entry of Object.values(yearData.months[month]?.profiles || {})) {
                    if (!hasCategoryNeeds(entry)) continue;
                    const direction = computeSpent(entry.categories).sum < 0 ? -1 : 1;
                    for (const pair of Object.values(/** @type {Record<string, import('../../typcheck/datenvertraege.js').CategoryNeeds>} */ (entry.categoryNeeds))) {
                        segments.floor += pair.floor * direction; segments.flex += pair.flex * direction;
                    }
                }
                segments.unallocated = annualUsed - segments.floor - segments.flex;
            }
            return {
                ...(includeSegments ? { segments } : {}),
                year,
                annualUsed,
                monthsWithData,
                avgMonthly,
                isCurrentPartialYear: year === currentYear && monthsWithData < 12
            };
        });
}

/** @param {Record<string, number|string>} categories @returns {{name: string, value: number}[]} */
export function sortExpenseEntries(categories) {
    return Object.entries(categories || {})
        .map(([name, value]) => ({ name, value: Number(value) || 0 }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
