/**
 * Module: Simulator Portfolio Pension
 * Purpose: Calculating pension payments.
 *          Handles standard indexing and adjustments.
 * Usage: Called by simulator-portfolio.js facade.
 * Dependencies: None (pure logic)
 */
"use strict";

/**
 * Berechnet die nächste jährliche Rente mit gemeinsamer Anpassungsrate
 * @param {number} prev - Vorjahresrente (brutto, vor Steuern)
 * @param {boolean} isFirstYear - Ist es das erste Auszahlungsjahr?
 * @param {number} base - Basisrente (brutto p.a.) im ersten Jahr
 * @param {number} adjPct - Jährliche Anpassungsrate in Prozent (z.B. 2.0 für 2%)
 * @returns {number} Rentenbrutto für das Jahr (≥ 0)
 */
export function computePensionNext(prev, isFirstYear, base, adjPct) {
    if (isFirstYear) return Math.max(0, base);
    const val = prev * (1 + adjPct / 100);
    return Math.max(0, val);
}

// Gemeinsame Schutzklausel für Renten und Einkünfte; öffentlicher Import bleibt erhalten.
export { computeRentAdjRate } from '../shared/income-adjustment.js';
