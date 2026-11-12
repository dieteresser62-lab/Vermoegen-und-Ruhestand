// Nur lesender Hinweis „Möglicher Split“ (TH-1, Nutzer 09.11.2026). Kein Speichern, keine Sperre, keine Umrechnung:
// Der Hinweis entsteht bei jeder Anzeige neu und verschwindet von selbst, wenn die Bedingung nicht mehr zutrifft.
import { normalizeHistorySymbol } from './tranchen-history-store.js';
import { historyPriceAt } from './tranchen-history-model.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

/** Ab diesem Tagesverlust (Anteil) erscheint der Hinweis. */
export const SPLIT_HINT_DROP_SHARE = 0.5;
/** Älter darf der Vergleichskurs nicht sein; sonst wäre es kein Tagesverlust (Wochenende und Feiertage passen hinein). */
export const SPLIT_HINT_MAX_GAP_DAYS = 7;

export const SPLIT_HINT_LABEL = 'Möglicher Split';
export const SPLIT_HINT_INFO = 'Der Kurs liegt mehr als 50 % unter dem letzten gespeicherten Schlusskurs, vielleicht wegen eines Splits. '
    + 'Trage dann über „Tranche bearbeiten“ Stückzahl und Kaufpreis laut Depotauszug ein (Einstand bleibt gleich) und bestätige im Reiter „Haushalt & Plan“ (bei einer Person „Plan“) in der Personenkarte den korrigierten Bestand für den Verlauf. '
    + 'Danach holt „Tageskurse neu laden“ die alten Schlusskurse im neuen Maßstab; ohne das zeigen Kurs- und Vermögensverlauf am Splittag eine Stufe.';

/** TH-2c: Bestätigung mit Name und Zahl der gespeicherten Tage.
 * @param {string} name @param {number} days */
export const reloadPricesDoneText = (name, days) => `Tageskurse von „${name}“ neu geladen: ${formatDisplayNumber(days, { fractionDigits: 0 })} Tage.`;

/** TH-2c: Zustand an der Klickstelle. Der Knopf zeigt „Lädt …“, danach steht die Bestätigung direkt daneben.
 * @type {{trancheId: string, phase: 'running' | 'done', text: string} | null} */
let reloadProgress = null;
/** @param {{trancheId: string, phase: 'running' | 'done', text: string} | null} progress */
export function setReloadPricesProgress(progress) { reloadProgress = progress; }

/** TH-2d: Bestätigung allein, unabhängig vom Splithinweis (der nach dem Neuladen wegfallen kann).
 * @param {{trancheId?: string}} tranche
 * @returns {string} */
export function reloadPricesNoticeHtml(tranche) {
    return reloadProgress?.phase === 'done' && reloadProgress.trancheId === tranche.trancheId
        ? `<span class="ds-badge ds-chip-success" data-price-reload-notice aria-hidden="true">${escapeHtml(reloadProgress.text)}</span>` : '';
}

/** TH-2: ruhiger Knopf; die Rückfrage und der Abruf liegen im Manager. TH-2c: „Lädt …“ und Bestätigung bei der Tranche.
 * @param {{trancheId?: string, name?: string}} tranche
 * @returns {string} */
export function reloadPricesButtonHtml(tranche) {
    const id = escapeHtml(tranche.trancheId || ''), name = escapeHtml(tranche.name || '');
    const mine = reloadProgress && reloadProgress.trancheId === tranche.trancheId ? reloadProgress : null;
    if (mine?.phase === 'running') {
        return `<button type="button" class="ds-button ds-button-quiet" data-action="reload-prices" data-tranche-id="${id}" aria-label="Tageskurse ${name} werden geladen" disabled>Lädt …</button>`;
    }
    const notice = mine ? ` ${reloadPricesNoticeHtml(tranche)}` : '';
    return `<button type="button" class="ds-button ds-button-quiet" data-action="reload-prices" data-tranche-id="${id}" aria-label="Tageskurse ${name} neu laden">Tageskurse neu laden</button>${notice}`;
}

/** Vergleicht den aktuellen Kurs mit dem letzten gespeicherten Schlusskurs vor dem Kurstag.
 * @param tranche Tranche mit currentPrice, asOf (UTC-Sekunden) und ticker.
 * @param prices Gespeicherte Tageskurse ({ symbols }) oder null.
 * @returns {{ previousClose: number, previousDay: number, drop: number } | null} */
export function detectPossibleSplit(tranche, prices) {
    const price = Number(tranche?.currentPrice);
    const asOf = tranche?.asOf;
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(asOf) || asOf <= 0 || !tranche.ticker) return null;
    let symbol;
    try { symbol = normalizeHistorySymbol(tranche.ticker); } catch { return null; }
    const record = prices?.symbols?.[symbol];
    if (!record) return null;
    const quoteDay = Math.floor(asOf / 86400);
    const previous = historyPriceAt(record, quoteDay - 1);
    if (!Number.isFinite(previous.value) || previous.value <= 0 || previous.priceDay === null
        || quoteDay - previous.priceDay > SPLIT_HINT_MAX_GAP_DAYS) return null;
    // TH-1b: Ein ungeprüfter Werktag dazwischen (open-gap) heißt, der Tagesverlust ist unbekannt. Wochenenden
    // und abgefragte Feiertage ohne Schlusskurs bleiben erlaubt.
    for (let day = previous.priceDay + 1; day < quoteDay; day++) {
        if (historyPriceAt(record, day).status === 'open-gap') return null;
    }
    const drop = 1 - price / previous.value;
    return drop > SPLIT_HINT_DROP_SHARE ? { previousClose: previous.value, previousDay: previous.priceDay, drop } : null;
}

/** @param tranche
 * @param context Verlaufskontext des Managers (status, prices).
 * @returns {string} Markup des Hinweises oder leer. */
export function splitHintHtml(tranche, context) {
    if (context?.status !== 'ready' || !detectPossibleSplit(tranche, context.prices)) {
        const notice = reloadPricesNoticeHtml(tranche);
        return notice ? `<small class="pv-split-hint">${notice}</small>` : '';
    }
    return `<small class="pv-split-hint" data-split-hint><span class="ds-badge ds-chip-warning">${SPLIT_HINT_LABEL}</span> ${infoPopoverHtml(`${SPLIT_HINT_LABEL}: was tun?`, SPLIT_HINT_INFO, { handbookAnchor: 'moeglicher-split' })} ${reloadPricesButtonHtml(tranche)}</small>`;
}
