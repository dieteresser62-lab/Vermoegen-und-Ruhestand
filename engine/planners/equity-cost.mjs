// @ts-check
/**
 * FR-76: Laufende Kosten eines Aktien-ETF mindern eine Aktienrendite zu (1 + r) × (1 − k) − 1.
 * Gilt für die realisierte Jahresrendite im Simulator und für die erwartete Aktienrendite des Dynamic Flex.
 * Ohne Kosten (k = 0, fehlend oder ungültig) bleibt r unverändert, damit solche Läufe bytegleich rechnen.
 *
 * @param {number} grossReturn Aktienrendite ohne Kosten als Anteil (0,1 = 10 %).
 * @param {unknown} costPct Laufende Kosten in % pro Jahr.
 * @returns {number} Aktienrendite nach Kosten als Anteil.
 */
export function netEquityReturn(grossReturn, costPct) {
    const cost = Number(costPct);
    if (!(cost > 0) || !Number.isFinite(cost)) return grossReturn;
    return (1 + grossReturn) * (1 - cost / 100) - 1;
}
