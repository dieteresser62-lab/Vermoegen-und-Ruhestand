// @ts-check
/**
 * Marktfelder der Korrektur zeigen gerundet (Euro 2, Jahre 1), halten aber den gespeicherten
 * Rohwert im data-Attribut. Wer ein solches Feld liest, nimmt readExactFieldValue.
 */

/** Nachkommastellen der Anzeige je Feld. */
export const MARKET_DISPLAY_DECIMALS = Object.freeze({ endeVJ: 2, endeVJ_1: 2, endeVJ_2: 2, endeVJ_3: 2, ath: 2, jahreSeitAth: 1 });

/** Rohwert, solange das Feld noch den angezeigten gerundeten Text hat; sonst der Feldtext.
 * @param {any} el @returns {any} */
export function readExactFieldValue(el) {
    if (!el) return '';
    const ds = el.dataset;
    return ds && ds.rawValue !== undefined && ds.shownValue === el.value ? ds.rawValue : el.value;
}

/** Setzt den genauen Wert und zeigt ihn gerundet an (Rohwert im data-Attribut).
 * @param {any} el @param {unknown} raw @param {number} decimals */
export function setExactFieldValue(el, raw, decimals) {
    if (!el) return;
    if (!Number.isFinite(Number(raw)) || String(raw).trim() === '') {
        el.value = raw;
        if (el.dataset) { delete el.dataset.rawValue; delete el.dataset.shownValue; }
        return;
    }
    el.value = String(Number(Number(raw).toFixed(decimals)));
    if (el.dataset) { el.dataset.rawValue = String(raw); el.dataset.shownValue = el.value; }
}
