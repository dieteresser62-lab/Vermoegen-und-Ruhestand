/** Historische Balance-Bytes ohne den jetzt mitreisenden Planwert vergleichen.
 * Ausschließlich die Vorgabe 12 ist erlaubt; Rechenwerte bleiben vollständig erhalten.
 */
export function previousLiquidityInput(value) {
    if (Array.isArray(value)) return value.map(previousLiquidityInput);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key, child]) => {
        if (key !== 'liquidityCashMonths') return true;
        if (child !== 12) throw new Error('Historischer Vergleich erwartet genau zwölf Tagesgeldmonate.');
        return false;
    }).map(([key, child]) => [key, previousLiquidityInput(child)]));
}
