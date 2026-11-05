// Historische Vollreferenzen fixieren die damals verwendeten 70/75/75 %.
// Der Backtest kennt keinen Tod; sein eingefrorener Input behält die alte Form.
export function historicalSurvivorInput(inputs) {
    const result = { ...inputs, survivorFloorPercent: 70 };
    delete result.survivorFlexPercent;
    delete result.survivorMinimumFlexPercent;
    return result;
}
export function historicalSurvivorNeeds(inputs) {
    return { ...inputs, survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75 };
}
