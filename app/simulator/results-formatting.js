"use strict";

import { formatCurrency } from './simulator-formatting.js';
import { formatDisplayNumberWithUnit as formatNumberWithUnit } from '../shared/shared-formatting.js';
const formatPercentage = value => formatNumberWithUnit(value, '%');

export function formatWholeEuro(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

// Nur Anzeigetexte übersetzen; stabile Gründe im Viewmodell bleiben erhalten.
export function formatMetricStatus(text = '') {
    const reasons = {
        no_observations: 'Keine Beobachtungen', missing_inflation: 'Inflationsdaten fehlen',
        not_applicable: 'Nicht anwendbar', technical_error: 'Technischer Fehler',
        invalid_non_finite: 'Kein endlicher Zahlenwert', invalid_drawdown_domain: 'Verlustwert außerhalb von 0 bis 100 %',
        unpaired_group_median_difference: 'Gruppenmediane sind nicht paarweise vergleichbar'
    };
    return text.replace(/Grund: ([a-z_]+)/g, (_, reason) => `Grund: ${reasons[reason] || reason.replaceAll('_', ' ')}`);
}

/**
 * Wandelt einen numerischen Wert defensiv in einen Währungs-String um.
 * Liefert einen Gedankenstrich, wenn der Wert fehlt oder nicht finiten ist.
 *
 * @param {number|null|undefined} value - Zahl, die als Währung formatiert werden soll.
 * @returns {string} Formatierter Währungswert oder '—' als Fallback.
 */
export function formatCurrencySafe(value) {
    if (value == null || !isFinite(value)) {
        return '—';
    }
    return formatCurrency(value);
}

/**
 * Formatiert einen numerischen Wert mit optionaler Einheit und Dezimalstellen.
 *
 * @param {number|null|undefined} value - Der zu formatierende Wert.
 * @param {string} unit - Einheit, die an den formatierten Wert angehängt wird (inkl. z.B. "%", "Jahre").
 * @param {number} fractionDigits - Anzahl der Nachkommastellen.
 * @returns {string} Formatierter Wert mit Einheit oder '—' falls nicht darstellbar.
 */
export { formatNumberWithUnit, formatPercentage };

/**
 * Hilfsfunktion für plain-text KPI-Beschreibungen.
 *
 * @param {string} text - Beschreibungstext, darf leer sein.
 * @returns {string} Getrimmter Beschreibungstext.
 */
export function sanitizeDescription(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.trim();
}
