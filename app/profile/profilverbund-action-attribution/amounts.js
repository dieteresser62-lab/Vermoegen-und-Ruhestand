// @ts-check

export const TOLERANCE_EUR = 0.01;

export const EPSILON = 1e-9;

const USE_KEYS = ['liquiditaet', 'gold', 'aktien', 'geldmarkt', 'bonds'];

export function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function hasFiniteValue(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function sum(values) {
    return values.reduce((total, value) => total + finiteNumber(value), 0);
}

export function isLiquiditySource(source) {
    const category = String(source?.category || '').toLowerCase();
    const kind = String(source?.type || source?.kind || '').toLowerCase();
    return source?.source === 'Liquidität'
        || source?.source === 'Geldmarkt-ETF'
        || kind === 'liquiditaet'
        || kind.includes('geldmarkt')
        || kind.includes('money_market')
        || category === 'money_market';
}

export function normalizeUses(uses = {}) {
    /** @type {Record<string, number>} */
    const normalized = {};
    const keys = new Set([...USE_KEYS, ...Object.keys(uses || {})]);
    keys.forEach(key => {
        const value = finiteNumber(uses?.[key]);
        if (value < -TOLERANCE_EUR) {
            throw new Error(`Profilverbund: Negative Verwendung fuer ${key} ist nicht zulaessig.`);
        }
        normalized[key] = Math.max(0, value);
    });
    return normalized;
}

export function sumUses(uses) {
    return sum(Object.values(uses || {}));
}

export function allocateCentsByWeights(amount, entries, weightOf) {
    const totalCents = Math.max(0, Math.round(finiteNumber(amount) * 100));
    if (totalCents === 0) return entries.map(() => 0);
    const weights = entries.map((entry, index) => Math.max(0, finiteNumber(weightOf(entry, index))));
    const totalWeight = sum(weights);
    if (totalWeight <= 0) {
        throw new Error('Profilverbund: Verwendung kann keinem ausfuehrenden Profil zugeordnet werden.');
    }

    const rows = entries.map((entry, index) => {
        const exact = totalCents * (weights[index] / totalWeight);
        return { index, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    let remaining = totalCents - sum(rows.map(row => row.cents));
    rows.slice()
        .sort((left, right) => (right.fraction - left.fraction) || (left.index - right.index))
        .forEach(row => {
            if (remaining <= 0) return;
            rows[row.index].cents += 1;
            remaining -= 1;
        });
    return rows.map(row => row.cents / 100);
}

/**
 * Verwendungen des Haushalts je Person nach ihren persönlichen Nettoquellen: jede Verwendung centgenau im Verhältnis der Gewichte,
 * danach erhält jede Spalte ihre Summe, und die Personen tauschen Centbruchteile innerhalb derselben Verwendung, bis Quellen und
 * Verwendungen je Person übereinstimmen. Haushaltsrechnung und Kaufzeilen des Jahresbelegs teilen so gleich auf.
 * @param {Record<string, number>} uses Verwendungen des Haushalts.
 * @param {number[]} weights Persönliche Nettoquellen in der Reihenfolge der Personen.
 * @returns {Record<string, number>[]} Verwendungen je Person.
 */
export function splitUsesByPersonalNet(uses, weights) {
    /** @type {Record<string, number>[]} */
    const usesByProfile = weights.map(() => ({}));
    Object.entries(uses).forEach(([key, amount]) => {
        const allocations = allocateCentsByWeights(amount, weights, (_, index) => weights[index]);
        allocations.forEach((allocation, index) => { usesByProfile[index][key] = allocation; });
    });
    // Zuerst jede Spaltensumme erhalten, dann persönliche Rundungsüberhänge
    // innerhalb derselben Verwendung verschieben. Jeder Verkäufer trägt so
    // seine eigenen Centbruchteile; der Haushalt bleibt in jedem Posten gleich.
    const residual = (/** @type {number} */ index) => weights[index] - sumUses(usesByProfile[index]);
    for (const [key, amount] of Object.entries(uses)) {
        const difference = amount - sum(usesByProfile.map(row => row[key]));
        if (Math.abs(difference) <= 1e-7) continue;
        const candidates = weights.map((_, index) => index)
            .filter(index => weights[index] > 0 && usesByProfile[index][key] + difference >= 0)
            .sort((a, b) => Math.sign(difference) * (residual(b) - residual(a)) || a - b);
        if (!candidates.length) throw new Error('Profilverbund: Persönlicher Cent-Rest kann keiner Verwendung zugeordnet werden.');
        usesByProfile[candidates[0]][key] += difference;
    }
    for (let receiver = 0; receiver < weights.length; receiver++) {
        for (let donor = 0; donor < weights.length && residual(receiver) > 1e-7; donor++) {
            if (residual(donor) >= -1e-7) continue;
            for (const key of ['liquiditaet', 'bonds', 'aktien', 'gold', ...Object.keys(uses)]) {
                const transfer = Math.min(Math.max(0, residual(receiver)), Math.max(0, -residual(donor)), usesByProfile[donor][key]);
                if (!(transfer > 0)) continue;
                usesByProfile[donor][key] -= transfer;
                usesByProfile[receiver][key] += transfer;
            }
        }
    }
    return usesByProfile;
}

export function actionAmountsChanged(before, after) {
    const gross = action => sum((action?.quellen || []).filter(source => !isLiquiditySource(source)).map(source => source.brutto));
    return Math.abs(gross(before) - gross(after)) > 1e-7
        || ['steuer', 'nettoErlös'].some(key => Math.abs(finiteNumber(before?.[key]) - finiteNumber(after?.[key])) > 1e-7)
        || USE_KEYS.some(key => Math.abs(finiteNumber(before?.verwendungen?.[key]) - finiteNumber(after?.verwendungen?.[key])) > 1e-7);
}
