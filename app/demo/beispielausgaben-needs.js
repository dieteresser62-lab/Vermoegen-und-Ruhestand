// Nur synthetische Beispiele: Zuordnung nach Haushaltsbedarf, keine Importregel.
const priorities = { Wohnen: 10, Gesundheit: 10, Versicherungen: 10, Alltag: 3,
    Lebensmittel: 3, Mobilität: 2, Reparatur: 2, Sonstiges: 1, Reisen: 0, 'Freizeit/Reisen': 0 };

/** Verteilt den Beispiel-Floor centgenau, ohne Kategoriesummen zu verändern.
 *
 * @param categories Wert für den bestehenden Aufrufvertrag.
 * @param floorShare Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function splitExampleExpenseNeeds(categories, floorShare) {
    const entries = Object.entries(categories);
    const cents = entries.map(([, amount]) => Math.round(Math.abs(amount) * 100));
    const total = cents.reduce((sum, value) => sum + value, 0);
    let remaining = Math.round(total * Math.max(0, Math.min(1, floorShare)));
    const floor = cents.map(() => 0);
    // Hohe Gewichte binden zuerst Wohnen und Gesundheit; Reisen bleiben möglichst Flex.
    while (remaining > 0) {
        const weights = entries.map(([name], i) => (cents[i] - floor[i]) * (priorities[name] ?? 1));
        if (!weights.some(value => value > 0)) weights.fill(1);
        const sum = weights.reduce((a, b) => a + b, 0), budget = remaining;
        let assigned = 0;
        for (let i = 0; i < entries.length; i++) {
            const amount = Math.min(cents[i] - floor[i], Math.floor(budget * weights[i] / sum));
            floor[i] += amount; assigned += amount;
        }
        remaining -= assigned;
        if (!assigned) {
            const i = weights.findIndex((value, index) => value > 0 && floor[index] < cents[index]);
            floor[i]++; remaining--;
        }
    }
    return Object.fromEntries(entries.map(([name, amount], i) => {
        const sign = amount < 0 ? -1 : 1;
        return [name, { floor: sign * floor[i] / 100, flex: sign * (cents[i] - floor[i]) / 100 }];
    }));
}
