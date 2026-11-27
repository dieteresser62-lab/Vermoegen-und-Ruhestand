// @ts-check
/**
 * FR-82: Verkaufsreihenfolge der Bank innerhalb derselben ISIN (§ 20 Abs. 4 Satz 7 EStG).
 * Je Person und ISIN kommt nur die älteste noch vorhandene Tranche in Frage; erst nach ihrem Verbrauch rückt die nächste nach.
 * Ohne Kaufdatum zählt eine Tranche als älteste (vorsichtige Steuerschätzung). Tranchen ohne ISIN bilden je eine eigene Gruppe.
 * Die App kennt kein Depot je Tranche, deshalb gilt die Gruppe je Person. Engine, Balance und Simulator nutzen dieselben Funktionen.
 */

/** @typedef {{isin?: string|null, sourceProfileId?: string|null, purchaseDate?: string|null, trancheId?: string|null, simulationPurchaseOrder?: number}} FifoLot */

/** RK-3 Punkt 4: normierte ISIN je Rohwert nur einmal bilden (Großschreibung, ohne Leerraum). */
const NORMAL_ISIN = new Map();
/** @param {unknown} raw @returns {string} */
function normalIsin(raw) {
    if (!raw) return '';
    let normal = NORMAL_ISIN.get(raw);
    if (normal === undefined) {
        normal = String(raw).trim().toUpperCase();
        if (NORMAL_ISIN.size < 4096) NORMAL_ISIN.set(raw, normal);
    }
    return normal;
}

/** Gruppenschlüssel (Person, ISIN); null ohne ISIN. @param {FifoLot|null|undefined} lot @param {string|null} [profileId] */
export function isinFifoGroup(lot, profileId = null) {
    const isin = normalIsin(lot?.isin);
    return isin ? `${profileId ?? lot?.sourceProfileId ?? ''}|${isin}` : null;
}

/** Kaufdatum als Zahl; ohne gültiges Datum −∞ (gilt als älteste). @param {FifoLot|null|undefined} lot */
function purchaseStamp(lot) {
    const parsed = lot?.purchaseDate ? Date.parse(lot.purchaseDate) : NaN;
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Bankreihenfolge zweier Tranchen derselben Gruppe.
 * @param {FifoLot} left @param {FifoLot} right */
export function compareBankOrder(left, right) {
    // Der Anfangsbestand kommt vor Zukäufen. Zukäufe folgen der Kaufreihenfolge im Pfad;
    // das historische Marktjahr im Kaufdatum kann im Monte Carlo zurückspringen.
    const leftPurchase = left?.simulationPurchaseOrder ?? 0;
    const rightPurchase = right?.simulationPurchaseOrder ?? 0;
    if (leftPurchase !== rightPurchase) return leftPurchase - rightPurchase;
    const a = purchaseStamp(left), b = purchaseStamp(right);
    if (a !== b) return a < b ? -1 : 1;
    return String(left?.trancheId || '').localeCompare(String(right?.trancheId || ''));
}

/** Je Eintrag die Positionen der älteren Einträge derselben Gruppe. RK-3 Punkt 4: `null`, wenn keine Gruppe mehrere Einträge hat
 * (schneller Weg ohne Gruppenbildung; die Auswahl läuft dann wie vor FR-82).
 * @template T @param {T[]} items @param {(item: T) => FifoLot|null|undefined} lotOf @param {(item: T) => string|null} [groupOf]
 * @returns {number[][]|null} */
export function olderInIsinGroup(items, lotOf, groupOf = item => isinFifoGroup(lotOf(item))) {
    if (items.length < 2) return null;
    const keys = new Array(items.length);
    const first = new Map();
    let shared = false;
    for (let index = 0; index < items.length; index += 1) {
        const key = groupOf(items[index]);
        keys[index] = key;
        if (!key) continue;
        if (first.has(key)) shared = true; else first.set(key, index);
    }
    if (!shared) return null;
    const groups = new Map();
    keys.forEach((key, index) => {
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(index);
    });
    const older = items.map(() => /** @type {number[]} */ ([]));
    for (const indices of groups.values()) {
        if (indices.length < 2) continue;
        const ordered = [...indices].sort((a, b) => compareBankOrder(/** @type {FifoLot} */ (lotOf(items[a])), /** @type {FifoLot} */ (lotOf(items[b]))) || a - b);
        ordered.forEach((index, position) => { older[index] = ordered.slice(0, position); });
    }
    return older;
}

/** RK-3 Punkt 4: Hat eine Person zwei Tranchen derselben ISIN? Ohne solche Gruppe ändert die Bankreihenfolge nichts.
 * @template T @param {T[]} items @param {(item: T) => FifoLot|null|undefined} lotOf */
export function hasIsinFifoGroup(items, lotOf) {
    if (items.length < 2) return false;
    // Je Person die Menge ihrer ISINs, ohne Schlüsseltext (gleiche Gruppen wie `isinFifoGroup`).
    const seen = new Map();
    for (const item of items) {
        const lot = lotOf(item);
        const isin = normalIsin(lot?.isin);
        if (!isin) continue;
        const person = lot?.sourceProfileId ?? '';
        let isins = seen.get(person);
        if (!isins) { isins = new Set(); seen.set(person, isins); }
        if (isins.has(isin)) return true;
        isins.add(isin);
    }
    return false;
}

/** Feste Verkaufsfolge für Wege, die Tranchen nacheinander ausschöpfen: Unter den jeweils freien Tranchen (ohne ISIN oder älteste
 * ihrer Gruppe) gewinnt die erste in der übergebenen Ordnung. Ohne mehrfache ISIN je Person bleibt die Ordnung unverändert.
 * @template T @param {T[]} sorted bereits nach Steuerlast sortiert @param {(item: T) => FifoLot|null|undefined} lotOf
 * @param {(item: T) => string|null} [groupOf] @returns {T[]} */
export function applyIsinFifo(sorted, lotOf, groupOf) {
    const older = olderInIsinGroup(sorted, lotOf, groupOf);
    if (!older) return sorted;
    const taken = new Array(sorted.length).fill(false);
    const result = [];
    while (result.length < sorted.length) {
        const next = sorted.findIndex((item, index) => !taken[index] && older[index].every(other => taken[other]));
        taken[next] = true;
        result.push(sorted[next]);
    }
    return result;
}

/** RK-2 (Gutachten Gemini FI1-2): Folge für Rückfallwege ohne Steuerwahl (Simulator, Verkauf ohne Tranchen-ID oder Notreduktion).
 * Kaufdatum aufsteigend, ohne gültiges Datum zuerst, bei gleichem Datum die übergebene Reihenfolge; innerhalb derselben Person und
 * ISIN danach die Bankreihenfolge (`applyIsinFifo`). @template {FifoLot} T @param {T[]} lots @returns {T[]} */
export function bankOrderFallback(lots) {
    const list = lots || [];
    if (list.length < 2) return [...list];
    // RK-3 Punkt 4: Kaufdatum je Tranche einmal lesen statt in jedem Vergleich; die Sortierung ist stabil wie bisher.
    const stamped = list.map(lot => ({ lot, stamp: purchaseStamp(lot) }));
    stamped.sort((left, right) => left.stamp === right.stamp ? 0 : left.stamp < right.stamp ? -1 : 1);
    return applyIsinFifo(stamped.map(entry => entry.lot), lot => lot);
}

/** Hinweis nötig: Eine Tranche ohne Kaufdatum teilt ihre ISIN mit einer anderen Tranche derselben Person.
 * @param {FifoLot[]} lots @param {(lot: FifoLot) => string|null} [groupOf] */
export function bankOrderDateMissing(lots, groupOf = lot => isinFifoGroup(lot)) {
    const counts = new Map();
    for (const lot of lots || []) { const key = groupOf(lot); if (key) counts.set(key, (counts.get(key) || 0) + 1); }
    return (lots || []).some(lot => {
        const key = groupOf(lot);
        return Boolean(key) && counts.get(key) > 1 && purchaseStamp(lot) === Number.NEGATIVE_INFINITY;
    });
}

export const BANK_ORDER_DATE_MISSING_HINT = 'Kaufdatum fehlt – Reihenfolge der Bank geschätzt';
