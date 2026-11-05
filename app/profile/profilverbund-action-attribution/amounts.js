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

export function actionAmountsChanged(before, after) {
    const gross = action => sum((action?.quellen || []).filter(source => !isLiquiditySource(source)).map(source => source.brutto));
    return Math.abs(gross(before) - gross(after)) > 1e-7
        || ['steuer', 'nettoErlös'].some(key => Math.abs(finiteNumber(before?.[key]) - finiteNumber(after?.[key])) > 1e-7)
        || USE_KEYS.some(key => Math.abs(finiteNumber(before?.verwendungen?.[key]) - finiteNumber(after?.verwendungen?.[key])) > 1e-7);
}
