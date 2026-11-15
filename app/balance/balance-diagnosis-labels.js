// @ts-check
// GH-1 Punkt 1 (Gutachten 13.11., F-01): deutsche Texte für Rohcodes der Diagnose. Ein unbekannter Code erscheint als „Sonstiger Grund“
// statt roh. Nur Anzeige; die Rechnung bleibt unverändert.

const OTHER = 'Sonstiger Grund';

/** Status des Mindest-Flex. */
export const MINIMUM_FLEX_STATUS_LABELS = Object.freeze({
    inactive_zero: 'Nicht gesetzt',
    not_needed: 'Nicht benötigt',
    applied: 'Angewandt',
    applied_limited_by_final_smoothing: 'Geglättet angewandt',
    limited_by_final_quantization: 'Durch Endrundung begrenzt',
    limited_by_available_flex: 'Durch verfügbaren Flex begrenzt',
    blocked_emergency: 'Blockiert',
    limited_by_flex_budget: 'Durch Flex-Budget begrenzt',
    overridden_by_severe_flex_emergency: 'In schwerer Flex-Notlage bewusst überstimmt'
});

/** Gründe, warum der Mindest-Flex nicht greift. */
export const MINIMUM_FLEX_BLOCK_LABELS = Object.freeze({
    alarm_active: 'Alarmmodus aktiv',
    no_open_flex_need: 'kein offener Flex-Bedarf',
    no_open_depot_flex_need: 'kein offener Flex-Bedarf aus dem Depot',
    covered_by_pension_surplus: 'Einkünfte decken den Bedarf',
    floor_minimum_flex_not_covered: 'Floor-/Mindest-Flex-Deckung unzureichend',
    minimum_runway_not_restorable: 'Mindest-Runway nicht wiederherstellbar'
});

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

/** @param {unknown} status */
export const minimumFlexStatusText = status => label(MINIMUM_FLEX_STATUS_LABELS, status || 'inactive_zero', 'Sonstiger Status');
/** @param {unknown} reason */
export const minimumFlexBlockText = reason => label(MINIMUM_FLEX_BLOCK_LABELS, reason);
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
