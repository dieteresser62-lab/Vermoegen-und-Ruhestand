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

/** @typedef {{negative: number, positive: number, negativeSum: number, positiveSum: number}} ExpenseSignTally */

/** Zählt negative und positive Kategoriesalden mit ihren Beträgen; Nullsalden zählen nicht.
 * @param {Record<string, number|string>} categories @param {ExpenseSignTally} [tally] @returns {ExpenseSignTally}
 */
function tallyExpenseSigns(categories, tally = { negative: 0, positive: 0, negativeSum: 0, positiveSum: 0 }) {
    for (const raw of Object.values(categories || {})) {
        const value = Number(raw);
        if (value < 0) { tally.negative++; tally.negativeSum -= value; }
        else if (value > 0) { tally.positive++; tally.positiveSum += value; }
    }
    return tally;
}

/** Positive Altimporte führen Ausgaben positiv. NR-1 (M4): Überwiegen positive Kategoriesalden nach Anzahl und Betrag,
 * bleibt es trotz einzelner Erstattungen bei dieser Konvention; sonst gelten negative Salden als Ausgaben.
 * @param {ExpenseSignTally} tally @returns {number}
 */
const conventionFromTally = ({ negative, positive, negativeSum, positiveSum }) =>
    negative === 0 || positive > negative && positiveSum > negativeSum ? 1 : -1;

/** @param {Record<string, number|string>} categories @returns {number} */
export function expenseConvention(categories) {
    return conventionFromTally(tallyExpenseSigns(categories));
}

/** Die Konvention gilt je Person über alle zwölf Monate.
 * @param {import('../../typcheck/datenvertraege.js').ExpensesYearAlt} yearData @returns {Map<string, number>}
 */
export function expenseConventions(yearData) {
    /** @type {Map<string, ExpenseSignTally>} */
    const tallies = new Map();
    for (let month = 1; month <= 12; month++) {
        for (const [id, entry] of Object.entries(yearData?.months?.[month]?.profiles || {})) {
            if (hasExpenseImport(entry)) tallies.set(id, tallyExpenseSigns(entry.categories, tallies.get(id)));
        }
    }
    return new Map([...tallies].map(([id, tally]) => [id, conventionFromTally(tally)]));
}

/** @typedef {import('../../typcheck/datenvertraege.js').ExpenseEntryRead} ExpenseEntry */
/** @typedef {import('../../typcheck/datenvertraege.js').CategoryNeeds} CategoryNeeds */

/** Saldiert den Bedarf je Kategorie über die übergebenen Monate.
 * @param {ExpenseEntry[]} entries @param {number} direction @returns {Map<string, CategoryNeeds>}
 */
export function sumCategoryNeeds(entries, direction) {
    const categories = new Map();
    for (const entry of entries) {
        for (const [name, pair] of Object.entries(/** @type {Record<string, CategoryNeeds>} */ (entry.categoryNeeds))) {
            const total = categories.get(name) ?? { floor: 0, flex: 0 };
            total.floor += direction * pair.floor;
            total.flex += direction * pair.flex;
            categories.set(name, total);
        }
    }
    return categories;
}

/** @param {Map<string, CategoryNeeds>} categories @returns {CategoryNeeds} */
export function sumNeeds(categories) {
    let floor = 0, flex = 0;
    for (const pair of categories.values()) { floor += pair.floor; flex += pair.flex; }
    return { floor, flex };
}

/** Untergrenze für den saldierten Jahresbedarf je Person. @param {CategoryNeeds} needs @returns {CategoryNeeds} */
export function boundAnnualNeeds({ floor, flex }) {
    return { floor: Math.max(0, floor), flex: Math.max(0, flex) };
}

/** Haushalt und Jahr, rein lesend. Für die Hochrechnung zählen vollständige Monate mit Budgetverbrauch ungleich null.
 * Floor/Flex verwenden davon die Monate mit Aufteilung aller Haushaltspersonen.
 */
/** @param {{yearData: import('../../typcheck/datenvertraege.js').ExpensesYearAlt, profileIds?: string[], forecastMonths?: number[]}} options @returns {import('../../typcheck/balance-ui.js').NeedsStats} */
export function computeHouseholdNeedsStats({ yearData, profileIds = null, forecastMonths = null }) {
    const ids = profileIds ?? [...new Set(Object.values(yearData?.months || {})
        .flatMap(data => Object.entries(data.profiles || {}).filter(([, entry]) => hasExpenseImport(entry)).map(([id]) => id)))];
    const directions = expenseConventions(yearData);
    const months = [], completeTotals = [];
    const annualNeeds = new Map(ids.map(id => [id, { entries: [], floorPaid: 0, flexPaid: 0 }]));
    let splitCount = 0, annualFloor = 0, annualFlex = 0;
    for (let month = 1; month <= 12; month++) {
        const entries = Object.entries(yearData?.months?.[month]?.profiles || {})
            .filter(([id, entry]) => ids.includes(id) && hasExpenseImport(entry))
            .map(([id, entry]) => ({ id, entry, ...computeBudgetSpent(entry, directions.get(id)) }));
        if (!entries.length) continue;
        const complete = entries.length === ids.length;
        const total = entries.reduce((sum, row) => sum + row.spent, 0);
        const planned = entries.reduce((sum, row) => sum + row.planned, 0);
        const counted = complete && total !== 0 && (forecastMonths === null || forecastMonths.includes(month));
        if (counted) completeTotals.push(total);
        const withBreakdown = complete && entries.every(({ entry }) => hasCategoryNeeds(entry));
        let floor = null, flex = null;
        if (withBreakdown) {
            const rows = entries.map(row => ({ ...row, ...sumNeeds(sumCategoryNeeds([row.entry], directions.get(row.id))) }));
            const rawFloor = rows.reduce((sum, row) => sum + row.floor, 0);
            const rawFlex = rows.reduce((sum, row) => sum + row.flex, 0);
            const fromFlex = Math.min(Math.max(0, rawFlex), planned);
            const fromFloor = planned - fromFlex;
            floor = rawFloor - fromFloor;
            flex = rawFlex - fromFlex;
            if (counted) {
                splitCount++;
                annualFloor += floor;
                annualFlex += flex;
                const positiveFlex = rows.reduce((sum, row) => sum + Math.max(0, row.flex), 0);
                // Flex-Abzug folgt positiven Flexanteilen, der restliche Floor-Abzug den Zahlenden.
                for (const row of rows) {
                    const annual = annualNeeds.get(row.id);
                    annual.entries.push(row.entry);
                    if (fromFlex) annual.flexPaid += fromFlex * Math.max(0, row.flex) / positiveFlex;
                    if (fromFloor) annual.floorPaid += fromFloor * row.planned / planned;
                }
            }
        }
        months.push({ month, withBreakdown, floor, flex, total, planned });
    }
    for (const [id, { entries, floorPaid, flexPaid }] of annualNeeds) {
        const raw = sumNeeds(sumCategoryNeeds(entries, directions.get(id)));
        const net = { floor: raw.floor - floorPaid, flex: raw.flex - flexPaid };
        const bounded = boundAnnualNeeds(net);
        // Die Monatssummen behalten den exakten Zahlungsabzug vor der anteiligen Verteilung.
        annualFloor += bounded.floor - net.floor;
        annualFlex += bounded.flex - net.flex;
    }
    const boundedTotal = boundAnnualNeeds({ floor: annualFloor, flex: annualFlex }); // Gleitkommareste aus der Verteilung
    const { avgMonthly: averageTotal, annualForecast: forecastTotal } = forecastExpenseMonths(completeTotals);
    const avgMonthly = { floor: splitCount ? boundedTotal.floor / splitCount : null, flex: splitCount ? boundedTotal.flex / splitCount : null, total: averageTotal };
    const annualForecast = { floor: splitCount ? avgMonthly.floor * 12 : null, flex: splitCount ? avgMonthly.flex * 12 : null, total: forecastTotal };
    return { months, monthsWithBreakdown: splitCount, monthsWithoutBreakdown: completeTotals.length - splitCount, avgMonthly, annualForecast };
}

/** @param {Record<string, number|string>} categories @param {number} [direction] @returns {{sum: number, spent: number}} */
export function computeSpent(categories, direction = expenseConvention(categories)) {
    const values = Object.values(categories || {});
    const sum = /** @type {number} */ (values.reduce((/** @type {number} */ acc, val) => acc + (Number(val) || 0), 0));
    return { sum, spent: sum === 0 ? 0 : direction * sum };
}

/** Rohsumme bleibt für Kontostände erhalten; nur der Budgetvergleich zieht Zuordnungen ab. */
/** @param {ExpenseEntry} record @param {number} [direction] @returns {{spent: number, planned: number, total: number}} */
export function computeBudgetSpent(record, direction) {
    const { spent } = computeSpent(record?.categories, direction);
    const assignments = record?.plannedExpenses === undefined ? [] : record.plannedExpenses;
    if (!Array.isArray(assignments) || assignments.some(item => !item || typeof item.id !== 'string' || !item.id
        || typeof item.scopeKey !== 'string' || !item.scopeKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)
        || typeof item.label !== 'string' || !Number.isFinite(item.amount) || item.amount <= 0)) throw new Error('Beschädigte Zuordnung geplanter Ausgaben.');
    const planned = assignments.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isFinite(planned)) throw new Error('Beschädigte Zuordnung geplanter Ausgaben.');
    return { spent: spent - planned, planned, total: spent };
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

/** @param {number[]} totals Vollständige, bereits vorzeichenrichtige Monatsbeträge ungleich null. */
export function forecastExpenseMonths(totals) {
    const monthsWithData = totals.length;
    const avgMonthly = monthsWithData ? totals.reduce((sum, value) => sum + value, 0) / monthsWithData : 0;
    return { monthsWithData, avgMonthly, annualForecast: Math.max(0, avgMonthly * 12) };
}

/** @param {import('../../typcheck/datenvertraege.js').ExpensesMonthAlt} monthData @param {boolean} [includePlanned] @param {Map<string, number>} [directions] @returns {number} */
export function sumMonthProfiles(monthData, includePlanned = false, directions = null) {
    const profiles = monthData?.profiles || {};
    return Object.entries(profiles).reduce((acc, [id, entry]) => {
        const direction = directions?.get(id);
        const { spent } = includePlanned ? computeSpent(entry?.categories, direction) : computeBudgetSpent(entry, direction);
        return acc + spent;
    }, 0);
}

/** @param {import('../../typcheck/balance-ui.js').YearStatsOptions} options @returns {import('../../typcheck/balance-ui.js').YearStats} */
export function computeYearStats({ yearData, annualBudget = 0, monthlyBudget = 0, includePlanned = false, forecastMonths = null }) {
    let annualUsed = 0;
    let ytdUsed = 0;
    const directions = expenseConventions(yearData);
    const monthTotalsWithData = [];

    for (let month = 1; month <= 12; month++) {
        const monthData = yearData?.months?.[String(month)] || { profiles: {} };
        const monthTotal = sumMonthProfiles(monthData, includePlanned, directions);
        annualUsed += monthTotal;
        if (monthTotal !== 0 && (forecastMonths === null || forecastMonths.includes(month))) {
            ytdUsed += monthTotal;
            monthTotalsWithData.push(monthTotal);
        }
    }

    const annualRemaining = (annualBudget || 0) - annualUsed;
    const { monthsWithData, avgMonthly, annualForecast } = forecastExpenseMonths(monthTotalsWithData);
    const medianMonthly = computeMedian(monthTotalsWithData);
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
                const directions = expenseConventions(yearData), split = new Map();
                for (let month = 1; month <= 12; month++) {
                    for (const [id, entry] of Object.entries(yearData.months[month]?.profiles || {})) {
                        if (!hasCategoryNeeds(entry)) {
                            segments.unallocated += computeSpent(entry?.categories, directions.get(id)).spent;
                            continue;
                        }
                        if (!split.has(id)) split.set(id, []);
                        split.get(id).push(entry);
                    }
                }
                for (const [id, entries] of split) {
                    const { floor, flex } = boundAnnualNeeds(sumNeeds(sumCategoryNeeds(entries, directions.get(id))));
                    segments.floor += floor;
                    segments.flex += flex;
                }
                segments.unallocated = Math.max(0, segments.unallocated);
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
