// @ts-check
// GH-1 Punkt 1 (Gutachten 13.11., F-01): deutsche Texte für Rohcodes der Diagnose. Ein unbekannter Code erscheint als „Sonstiger Grund“
// statt roh. Nur Anzeige; die Rechnung bleibt unverändert.

const OTHER = 'Sonstiger Grund';

export { MINIMUM_FLEX_STATUS_LABELS, MINIMUM_FLEX_BLOCK_LABELS, minimumFlexStatusText, minimumFlexBlockText } from '../shared/minimum-flex-display.js';

/** Gründe der Transaktionsdiagnostik. */
export const TRANSACTION_BLOCK_LABELS = Object.freeze({
    none: 'Keine Blockade',
    min_trade: 'Unter Mindestgröße',
    liquidity_sufficient: 'Liquidität ausreichend',
    guardrail_block: 'Leitplanke verhindert Verkauf',
    cap_active: 'Obergrenze begrenzt Handel',
    gold_floor: 'Gold-Mindestreserve aktiv'
});

/** @param {Record<string, string>} labels @param {unknown} code @param {string} [fallback] */
function label(labels, code, fallback = OTHER) {
    const key = typeof code === 'string' ? code.trim() : '';
    return Object.hasOwn(labels, key) ? labels[key] : Object.hasOwn(labels, key.toLowerCase()) ? labels[key.toLowerCase()] : fallback;
}

/** @param {unknown} reason */
export const transactionBlockText = reason => (reason ? label(TRANSACTION_BLOCK_LABELS, reason) : TRANSACTION_BLOCK_LABELS.none);

/** Text, wenn die Einkünfte den Bedarf decken (Entnahme 0). */
export const PENSION_SURPLUS_CUT_TEXT = 'keine – Einkünfte decken den Bedarf';

/** Decken die Einkünfte den Bedarf? Grund `covered_by_pension_surplus` aus dem Mindest-Flex oder Entnahme 0, obwohl ein Flex-Bedarf da
 * ist und die Einkünfte ihn tragen. @param {any} keyParams @returns {boolean} */
export function coveredByIncome(keyParams) {
    if (!keyParams || typeof keyParams !== 'object') return false;
    if (keyParams.minimumFlexBlockReason === 'covered_by_pension_surplus') return true;
    const flex = Number(keyParams.minimumFlexHouseholdFlexAnnual), income = Number(keyParams.minimumFlexPensionContributionAnnual);
    return keyParams.jahresentnahme === 0 && flex > 0 && Number.isFinite(income) && income >= flex;
}
