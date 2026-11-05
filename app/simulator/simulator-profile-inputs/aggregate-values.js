

export function sumNumbers(list, selector) {
    return list.reduce((acc, item) => acc + selector(item), 0);
}

export function moneyToCents(value) {
    return Math.round(value * 100);
}

export function weightedAverage(list, selector, weightSelector, fallback = 0) {
    const totalWeight = sumNumbers(list, weightSelector);
    if (totalWeight <= 0) return fallback;
    const weighted = list.reduce((acc, item) => acc + selector(item) * weightSelector(item), 0);
    return weighted / totalWeight;
}

export function maxNumber(list, selector, fallback = 0) {
    if (!list.length) return fallback;
    return Math.max(...list.map(selector));
}

export function ensureValueMatch(list, selector) {
    if (!list.length) return true;
    const first = selector(list[0]);
    return list.every(item => selector(item) === first);
}

export function stableStringify(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
        sorted[key] = value[key];
    });
    return JSON.stringify(sorted);
}
