// @ts-check
import { failMarketCsv } from './validation-core.js';
import { UIUtils } from '../balance-utils.js';

function splitMarketCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ';' && !inQuotes) {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (inQuotes) {
        failMarketCsv('market_csv_unclosed_quote', 'Die Markt-CSV enthaelt ein nicht geschlossenes Anfuehrungszeichen.');
    }
    cells.push(current.trim());
    return cells;
}

function normalizeMarketHeader(value) {
    return String(value || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLocaleLowerCase('de-DE')
        .replace(/[^a-z0-9äöüß]/g, '');
}

function parseMarketDate(rawValue) {
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(rawValue || '').trim());
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

/**
 * Parst eine semikolonseparierte Markt-CSV ohne DOM-Seiteneffekte.
 * Fuer den letzten Datenstand muessen Vergleichswerte aus jedem der drei
 * vorangegangenen Kalenderjahre am oder vor dem jeweiligen Stichtag existieren.
 */
/**
 * @param text Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function parseMarketDataCsv(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(entry => entry.line !== '');
    if (lines.length < 2) {
        failMarketCsv('market_csv_empty', 'Die Markt-CSV enthaelt keine Datenzeilen.');
    }

    const header = splitMarketCsvLine(lines[0].line).map(normalizeMarketHeader);
    const dateHeaders = new Set(['datum', 'date']);
    const closeHeaders = new Set(['schluss', 'schlusskurs', 'close', 'zuletzt']);
    const dateIndex = header.findIndex(value => dateHeaders.has(value));
    const closeIndex = header.findIndex(value => closeHeaders.has(value));
    const missingHeaders = [];
    if (dateIndex === -1) missingHeaders.push('Datum/Date');
    if (closeIndex === -1) missingHeaders.push('Schluss/Close');
    if (missingHeaders.length > 0) {
        failMarketCsv(
            'market_csv_missing_headers',
            `Der Markt-CSV fehlen Pflichtspalten: ${missingHeaders.join(', ')}.`,
            { missingHeaders }
        );
    }

    const data = [];
    const rejectedRows = [];
    const seenDates = new Set();
    lines.slice(1).forEach(({ line, lineNumber }) => {
        let columns;
        try {
            columns = splitMarketCsvLine(line);
        } catch (error) {
            rejectedRows.push({ lineNumber, reason: error.message });
            return;
        }
        if (columns.length !== header.length) {
            rejectedRows.push({ lineNumber, reason: `Spaltenanzahl ${columns.length} statt ${header.length}` });
            return;
        }

        const date = parseMarketDate(columns[dateIndex]);
        if (!date) {
            rejectedRows.push({ lineNumber, reason: `ungueltiges Kalenderdatum „${columns[dateIndex] || ''}“` });
            return;
        }
        const closeResult = UIUtils.parseCurrencyResult(columns[closeIndex]);
        if (!closeResult.valid) {
            rejectedRows.push({ lineNumber, reason: `ungueltiger Schlusswert (${closeResult.error.code})` });
            return;
        }
        const dateKey = date.toISOString().slice(0, 10);
        if (seenDates.has(dateKey)) {
            rejectedRows.push({ lineNumber, reason: `doppeltes Datum ${dateKey}` });
            return;
        }
        seenDates.add(dateKey);
        data.push({ date, close: closeResult.value });
    });

    if (rejectedRows.length > 0) {
        const preview = rejectedRows
            .slice(0, 5)
            .map(row => `Zeile ${row.lineNumber}: ${row.reason}`)
            .join('; ');
        const remainder = rejectedRows.length > 5 ? `; weitere ${rejectedRows.length - 5}` : '';
        failMarketCsv(
            'market_csv_invalid_rows',
            `Die Markt-CSV enthaelt ${rejectedRows.length} ungueltige Datenzeile(n): ${preview}${remainder}.`,
            { rejectedRows }
        );
    }
    if (data.length === 0) {
        failMarketCsv('market_csv_no_valid_rows', 'Die Markt-CSV enthaelt keine gueltigen Datenzeilen.');
    }

    data.sort((left, right) => left.date - right.date);
    const lastEntry = data[data.length - 1];
    const lastDate = lastEntry.date;
    const historicalEntries = [];
    const missingYears = [];
    for (let offset = 1; offset <= 3; offset++) {
        const targetYear = lastDate.getUTCFullYear() - offset;
        const targetMonth = lastDate.getUTCMonth();
        const lastTargetMonthDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        const targetDay = Math.min(lastDate.getUTCDate(), lastTargetMonthDay);
        const targetTimestamp = Date.UTC(targetYear, targetMonth, targetDay);
        const match = data
            .filter(entry => entry.date.getUTCFullYear() === targetYear && entry.date.getTime() <= targetTimestamp)
            .at(-1);
        if (!match) missingYears.push(targetYear);
        historicalEntries.push(match || null);
    }
    if (missingYears.length > 0) {
        failMarketCsv(
            'market_csv_missing_years',
            `Der Markt-CSV fehlen Jahreswerte fuer: ${missingYears.join(', ')}.`,
            { missingYears }
        );
    }

    const windowHigh = data.reduce((best, entry) => entry.close > best.close ? entry : best, data[0]);
    const yearsSinceWindowHigh = windowHigh.close > lastEntry.close + 0.01
        ? Math.max(0, Math.floor((lastDate.getTime() - windowHigh.date.getTime()) / (1000 * 60 * 60 * 24 * 365.2425)))
        : 0;
    const coverageYears = [...new Set(data.map(entry => entry.date.getUTCFullYear()))];

    return {
        schemaVersion: 1,
        asOf: lastDate.toISOString().slice(0, 10),
        asOfDate: new Date(lastDate),
        rowCount: data.length,
        coverage: {
            start: data[0].date.toISOString().slice(0, 10),
            end: lastDate.toISOString().slice(0, 10),
            calendarYears: coverageYears,
            rowCount: data.length
        },
        high: {
            scope: 'windowHigh',
            value: windowHigh.close,
            asOf: windowHigh.date.toISOString().slice(0, 10),
            yearsSince: yearsSinceWindowHigh,
            verifiedAllTimeHighAvailable: false
        },
        values: {
            endeVJ: lastEntry.close,
            endeVJ_1: historicalEntries[0].close,
            endeVJ_2: historicalEntries[1].close,
            endeVJ_3: historicalEntries[2].close
        }
    };
}
