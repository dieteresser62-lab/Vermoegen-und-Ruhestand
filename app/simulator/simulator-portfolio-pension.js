/**
 * Module: Simulator Portfolio Pension
 * Purpose: Calculating pension payments.
 *          Handles standard indexing, adjustments, and legacy logic.
 * Usage: Called by simulator-portfolio.js facade.
 * Dependencies: None (pure logic)
 */
"use strict";

/**
 * Berechnet jährliche Rente basierend auf Indexierung
 * VERALTET: Wird durch computePensionNext ersetzt (nur noch für Abwärtskompatibilität)
 *
 * @param {object} options
 * @param options.yearIndex
 * @param options.baseMonthly
 * @param options.startOffset
 * @param options.lastAnnualPension
 * @param options.indexierungsArt
 * @param options.inflRate
 * @param options.lohnRate
 * @param options.festerSatz
 * @returns {number} Ergebnis der Operation.
 */
export function computeYearlyPension({ yearIndex, baseMonthly, startOffset, lastAnnualPension, indexierungsArt, inflRate, lohnRate, festerSatz }) {
    if (!baseMonthly || yearIndex < startOffset) return 0;
    let anpassungsSatz = 0;
    switch (indexierungsArt) {
        case 'inflation': anpassungsSatz = Math.max(0, inflRate) / 100; break;
        case 'lohn': anpassungsSatz = Math.max(0, lohnRate ?? inflRate) / 100; break;
        case 'fest': anpassungsSatz = festerSatz / 100; break;
    }
    if (yearIndex === startOffset) return baseMonthly * 12;
    const last = lastAnnualPension > 0 ? lastAnnualPension : baseMonthly * 12;
    return last * (1 + anpassungsSatz);
}

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
