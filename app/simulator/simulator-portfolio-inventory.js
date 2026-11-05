/** Gemeinsame verfügbare Lotbasis für Summen und detaillierte Engineeingaben.
 * Offene positive Bestände behalten auch unterhalb eines Cents ihren Wert.
 *
 * @param tranche
 * @returns {boolean} Ergebnis der Operation.
 */
export function isAvailableSimulationLot(tranche) {
    return Boolean(tranche) && tranche.simulationLotStatus !== 'sold'
        && (Number(tranche.marketValue) || 0) > 0;
}
