// @ts-check

/** Status des Mindest-Flex. */
export const MINIMUM_FLEX_STATUS_LABELS = Object.freeze({
    inactive_zero: 'Nicht gesetzt',
    not_needed: 'Nicht benötigt',
    applied: 'Angewandt',
    applied_limited_by_final_smoothing: 'Geglättet angewandt',
    limited_by_final_quantization: 'Durch Endrundung begrenzt',
    limited_by_available_flex: 'Durch verfügbaren Flex begrenzt',
    limited_by_actual_payout: 'Durch tatsächliche Auszahlung begrenzt',
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
    floor_minimum_flex_not_covered: 'Deckung von Grundbedarf und Mindest-Flex unzureichend',
    minimum_runway_not_restorable: 'Mindestreichweite nicht wiederherstellbar'
});

/** @param {Record<string, string>} labels @param {unknown} code @param {string} [fallback] */
function label(labels, code, fallback = 'Sonstiger Grund') {
    const key = typeof code === 'string' ? code.trim() : '';
    return Object.hasOwn(labels, key) ? labels[key] : Object.hasOwn(labels, key.toLowerCase()) ? labels[key.toLowerCase()] : fallback;
}

/** @param {unknown} status */
export const minimumFlexStatusText = status => label(MINIMUM_FLEX_STATUS_LABELS, status || 'inactive_zero', 'Sonstiger Status');
/** @param {unknown} reason */
export const minimumFlexBlockText = reason => label(MINIMUM_FLEX_BLOCK_LABELS, reason);
