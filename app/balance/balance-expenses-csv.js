/**
 * Module: Balance Expenses CSV
 * Purpose: Parse monthly category CSV exports without DOM or storage access.
 */
"use strict";

import { parseLocalizedNumber } from './balance-utils.js';

export const EXPENSE_CSV_IMPORT_SUMMARY = Symbol('expense-csv-import-summary');
// Metadaten bleiben außerhalb der enumerierbaren Kategoriesummen (Altvertrag).
export const EXPENSE_CSV_CATEGORY_NEEDS = Symbol('expense-csv-category-needs');

export class ExpenseCsvImportError extends Error {
    /** @param {string} code @param {string} message @param {{summary?: {totalRows: number, importedRows: number, rejectedRows: {lineNumber: number, reason: string}[]}}} [details] */
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ExpenseCsvImportError';
        this.code = code;
        this.details = details;
    }
}

/** @param {string} line @param {string} delimiter @returns {string[]} */
export function splitCsvLine(line, delimiter) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === delimiter && !inQuotes) {
            cells.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    if (inQuotes) {
        throw new ExpenseCsvImportError(
            'expenses_csv_unclosed_quote',
            'Die CSV-Zeile enthaelt ein nicht geschlossenes Anfuehrungszeichen.'
        );
    }
    cells.push(current);
    return cells;
}

/** @param {string} line @returns {string} */
export function detectCsvDelimiter(line) {
    const candidates = [';', '\t', ','];
    let best = { delim: ';', count: -1 };
    candidates.forEach(delim => {
        let count = 0;
        let inQuotes = false;
        for (let index = 0; index < line.length; index++) {
            if (line[index] === '"') {
                if (inQuotes && line[index + 1] === '"') {
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (line[index] === delim && !inQuotes) {
                count += 1;
            }
        }
        if (count > best.count) best = { delim, count };
    });
    return best.delim;
}

/** @param {unknown} raw @returns {number} */
export function parseExpenseAmount(raw) {
    const result = parseLocalizedNumber(raw, {
        required: true,
        allowCurrencySymbol: true
    });
    return result.valid ? result.value : NaN;
}

/** @param {string} text @returns {import('../../typcheck/balance-ui.js').CategoryCsv} */
export function parseCategoryCsv(text) {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(entry => entry.line !== '');
    if (!lines.length) throw new Error('Leere CSV-Datei.');
    const delimiter = detectCsvDelimiter(lines[0].line);
    const header = splitCsvLine(lines[0].line, delimiter).map(h => h.trim().toLowerCase());
    const needsIndex = header.findIndex(h => h === 'bedarf');
    const categoryIndex = header.findIndex((h, index) => index !== needsIndex && h.includes('kategorie'));
    const amountIndex = header.findIndex((h, index) => index !== needsIndex && h.includes('betrag'));
    if (categoryIndex === -1 || amountIndex === -1) {
        throw new ExpenseCsvImportError(
            'expenses_csv_missing_headers',
            'CSV-Header braucht die Pflichtspalten "Kategorie" und "Betrag".'
        );
    }

    const categories = /** @type {import("../../typcheck/balance-ui.js").CategoryCsv} */ (Object.create(null));
    const categoryNeeds = /** @type {Record<string, import('../../typcheck/datenvertraege.js').CategoryNeeds>} */ (Object.create(null));
    const rejectedRows = [];
    let importedRows = 0;
    for (let i = 1; i < lines.length; i++) {
        const { line, lineNumber } = lines[i];
        let row;
        try {
            row = splitCsvLine(line, delimiter);
        } catch (error) {
            rejectedRows.push({ lineNumber, reason: error.message });
            continue;
        }
        if (row.length !== header.length) {
            rejectedRows.push({ lineNumber, reason: `Spaltenanzahl ${row.length} statt ${header.length}` });
            continue;
        }
        const category = (row[categoryIndex] || '').trim();
        const amount = parseExpenseAmount(row[amountIndex]);
        if (!category) {
            rejectedRows.push({ lineNumber, reason: 'Kategorie fehlt' });
            continue;
        }
        if (!Number.isFinite(amount)) {
            rejectedRows.push({ lineNumber, reason: 'Betrag ist ungueltig' });
            continue;
        }
        const need = needsIndex < 0 ? null : (row[needsIndex] || '').trim().toLowerCase();
        if (needsIndex >= 0 && !['floor', 'grundbedarf', 'flex'].includes(need)) {
            rejectedRows.push({ lineNumber, reason: need ? `Bedarf ‚${row[needsIndex].trim()}‘ unbekannt (Floor oder Flex)` : 'Bedarf fehlt' });
            continue;
        }
        const aggregated = (categories[category] || 0) + amount;
        if (!Number.isFinite(aggregated)) throw new ExpenseCsvImportError('expenses_csv_non_finite_sum', 'CSV-Import abgebrochen: Eine Kategoriesumme ist zu groß.');
        categories[category] = aggregated;
        if (needsIndex >= 0) {
            const pair = categoryNeeds[category] ||= { floor: 0, flex: 0 };
            pair[need === 'flex' ? 'flex' : 'floor'] += amount;
            if (!Number.isFinite(pair.floor) || !Number.isFinite(pair.flex)) throw new ExpenseCsvImportError('expenses_csv_non_finite_sum', 'CSV-Import abgebrochen: Eine Bedarfssumme ist zu groß.');
        }
        importedRows += 1;
    }

    if (rejectedRows.length > 0) {
        const preview = rejectedRows
            .slice(0, 5)
            .map(row => `Zeile ${row.lineNumber}: ${row.reason}`)
            .join('; ');
        const remainder = rejectedRows.length > 5 ? `; weitere ${rejectedRows.length - 5}` : '';
        throw new ExpenseCsvImportError(
            'expenses_csv_invalid_rows',
            `CSV-Import abgebrochen: ${rejectedRows.length} von ${lines.length - 1} Datenzeile(n) ungueltig (${preview}${remainder}).`,
            {
                summary: {
                    totalRows: lines.length - 1,
                    importedRows,
                    rejectedRows
                }
            }
        );
    }

    if (Object.keys(categories).length === 0) {
        throw new Error('Keine gültigen Kategorien gefunden.');
    }
    if (!Number.isFinite(Object.values(categories).reduce((sum, value) => sum + value, 0))) {
        throw new ExpenseCsvImportError('expenses_csv_non_finite_sum', 'CSV-Import abgebrochen: Die Gesamtsumme ist zu groß.');
    }

    Object.defineProperty(categories, EXPENSE_CSV_IMPORT_SUMMARY, {
        value: Object.freeze({
            totalRows: lines.length - 1,
            importedRows,
            rejectedRows: 0
        }),
        enumerable: false
    });

    if (needsIndex >= 0) Object.defineProperty(categories, EXPENSE_CSV_CATEGORY_NEEDS, { value: categoryNeeds });
    return categories;
}
