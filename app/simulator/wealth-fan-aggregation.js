/** Zusatzbeobachtung; keine Zufallszahlen, Simulation oder laufzahlabhängigen Matrizen. */
export const WEALTH_FAN_VERSION = 'WealthFanV1';
export const WEALTH_FAN_CLASS_ID = 'EUR-zero-log1.01-1-to-1e12-v1';
const RATIO = 1.01;
const REGULAR_COUNT = Math.ceil(Math.log(1e12) / Math.log(RATIO));
export const WEALTH_FAN_BOUNDARIES = Object.freeze(Array.from({ length: REGULAR_COUNT + 1 }, (_, i) => RATIO ** i));
export const WEALTH_FAN_CLASS_COUNT = REGULAR_COUNT + 3;
export const WEALTH_FAN_OVERFLOW = WEALTH_FAN_CLASS_COUNT - 1;
const MAX_COUNTER = 0xffffffff;
const fields = ['real', 'nominal', 'alive', 'ruined', 'missingReal', 'missingNominal'];
const fail = text => { throw new TypeError(`WealthFanV1: ${text}`); };
const counter = value => Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER;

export function classifyWealthFanValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return -1;
    if (value === 0) return 0;
    if (value < 1) return 1;
    if (value >= WEALTH_FAN_BOUNDARIES.at(-1)) return WEALTH_FAN_OVERFLOW;
    let index = Math.floor(Math.log(value) / Math.log(RATIO));
    // Korrektur an exakten Grenzen: Klassifikation hängt nicht von Log-Rundung ab.
    while (index > 0 && value < WEALTH_FAN_BOUNDARIES[index]) index--;
    while (value >= WEALTH_FAN_BOUNDARIES[index + 1]) index++;
    return index + 2;
}

export function createWealthFan(horizonYears) {
    if (!Number.isSafeInteger(horizonYears) || horizonYears < 1 || horizonYears > 1000) fail('Ungültiger Horizont.');
    const rows = horizonYears + 1;
    return { schemaVersion: WEALTH_FAN_VERSION, classId: WEALTH_FAN_CLASS_ID,
        unit: 'EUR', realBasis: 'start_prices', nominalBasis: 'year_end_prices',
        horizonYears, classCount: WEALTH_FAN_CLASS_COUNT, validRuns: 0, technicalErrors: 0,
        real: new Uint32Array(rows * WEALTH_FAN_CLASS_COUNT),
        nominal: new Uint32Array(rows * WEALTH_FAN_CLASS_COUNT),
        alive: new Uint32Array(rows), ruined: new Uint32Array(rows),
        missingReal: new Uint32Array(rows), missingNominal: new Uint32Array(rows) };
}

export function createWealthFanPath(horizonYears, initialWealth) {
    const nominal = new Float64Array(horizonYears + 1).fill(NaN);
    const real = new Float64Array(horizonYears + 1).fill(NaN);
    const alive = new Uint8Array(horizonYears + 1);
    const ruined = new Uint8Array(horizonYears + 1);
    nominal[0] = typeof initialWealth === 'number' ? initialWealth : NaN;
    real[0] = nominal[0]; alive[0] = 1;
    return { nominal, real, alive, ruined };
}

export function recordWealthFanYear(path, year, nominal, real, ruined = false) {
    if (!path) return;
    if (!Number.isSafeInteger(year) || year < 1 || year >= path.alive.length || path.alive[year]) fail('Jahresposition ungültig oder doppelt.');
    path.alive[year] = 1; path.ruined[year] = ruined ? 1 : 0;
    path.nominal[year] = ruined ? 0 : typeof nominal === 'number' ? nominal : NaN;
    path.real[year] = ruined ? 0 : typeof real === 'number' ? real : NaN;
}

function increment(values, index) {
    if (values[index] === MAX_COUNTER) fail('Zählerüberlauf.');
    values[index]++;
}

export function commitWealthFanPath(fan, path, technicalError = false) {
    if (!fan) return;
    const key = technicalError ? 'technicalErrors' : 'validRuns';
    if (!counter(fan[key]) || fan[key] === MAX_COUNTER) fail('Zählerüberlauf.');
    fan[key]++;
    if (technicalError) return;
    if (path.alive.length !== fan.horizonYears + 1) fail('Pfadhorizont passt nicht.');
    for (let year = 0; year < path.alive.length; year++) {
        if (!path.alive[year]) continue;
        increment(fan.alive, year);
        if (path.ruined[year]) increment(fan.ruined, year);
        for (const mode of ['real', 'nominal']) {
            const bin = classifyWealthFanValue(path[mode][year]);
            if (bin < 0) increment(fan[mode === 'real' ? 'missingReal' : 'missingNominal'], year);
            else increment(fan[mode], year * WEALTH_FAN_CLASS_COUNT + bin);
        }
    }
}

export function assertWealthFan(fan, expectedRuns = null) {
    if (fan?.schemaVersion !== WEALTH_FAN_VERSION || fan.classId !== WEALTH_FAN_CLASS_ID
        || fan.unit !== 'EUR' || fan.realBasis !== 'start_prices' || fan.nominalBasis !== 'year_end_prices'
        || fan.classCount !== WEALTH_FAN_CLASS_COUNT || !Number.isSafeInteger(fan.horizonYears)
        || fan.horizonYears < 1 || fan.horizonYears > 1000 || !counter(fan.validRuns) || !counter(fan.technicalErrors)
        || fan.validRuns + fan.technicalErrors > MAX_COUNTER) fail('Metadaten ungültig.');
    if (expectedRuns !== null && fan.validRuns + fan.technicalErrors !== expectedRuns) fail('Laufbestand passt nicht.');
    const rows = fan.horizonYears + 1;
    for (const field of fields) {
        if (!(fan[field] instanceof Uint32Array) || fan[field].length !== rows * (['real', 'nominal'].includes(field) ? WEALTH_FAN_CLASS_COUNT : 1)) fail(`Dimension ${field} ungültig.`);
    }
    if (fan.alive[0] !== fan.validRuns || fan.ruined[0] !== 0) fail('Ausgangsbestand ungültig.');
    for (let year = 0; year < rows; year++) {
        if (fan.alive[year] > fan.validRuns || (year && fan.alive[year] > fan.alive[year - 1]) || fan.ruined[year] > fan.alive[year]) fail('Lebensbestand ungültig.');
        for (const mode of ['real', 'nominal']) {
            let total = fan[mode === 'real' ? 'missingReal' : 'missingNominal'][year];
            const offset = year * WEALTH_FAN_CLASS_COUNT;
            for (let bin = 0; bin < WEALTH_FAN_CLASS_COUNT; bin++) total += fan[mode][offset + bin];
            if (total !== fan.alive[year] || fan[mode][offset] < fan.ruined[year]) fail('Klassensumme ungültig.');
        }
    }
    return fan;
}

export function copyWealthFan(fan) {
    assertWealthFan(fan);
    return { ...fan, ...Object.fromEntries(fields.map(field => [field, new Uint32Array(fan[field])])) };
}

export function mergeWealthFan(target, source) {
    assertWealthFan(target);
    assertWealthFan(source);
    if (target.horizonYears !== source.horizonYears || target.classId !== source.classId) fail('Unterschiedliche Klassen oder Horizonte.');
    if (target.validRuns + target.technicalErrors + source.validRuns + source.technicalErrors > MAX_COUNTER) fail('Zählerüberlauf.');
    // Erst vollständig prüfen, dann mutieren: ein abgewiesener Chunk zählt nichts.
    for (const field of fields) {
        if (!(target[field] instanceof Uint32Array) || target[field].length !== source[field].length) fail('Merge-Dimension ungültig.');
        for (let i = 0; i < target[field].length; i++) if (target[field][i] + source[field][i] > MAX_COUNTER) fail('Zählerüberlauf.');
    }
    for (const field of fields) for (let i = 0; i < target[field].length; i++) target[field][i] += source[field][i];
    target.validRuns += source.validRuns; target.technicalErrors += source.technicalErrors;
    return target;
}

function rankEstimate(values, offset, rank) {
    let sum = 0;
    for (let bin = 0; bin < WEALTH_FAN_CLASS_COUNT; bin++) {
        sum += values[offset + bin];
        if (sum <= rank) continue;
        if (bin === 0) return { value: 0, lower: 0, upper: 0, status: 'zero' };
        if (bin === 1) return { value: null, lower: 0, upper: 1, status: 'underflow' };
        if (bin === WEALTH_FAN_OVERFLOW) return { value: null, lower: WEALTH_FAN_BOUNDARIES.at(-1), upper: null, status: 'overflow' };
        const lower = WEALTH_FAN_BOUNDARIES[bin - 2], upper = WEALTH_FAN_BOUNDARIES[bin - 1];
        return { value: Math.sqrt(lower * upper), lower, upper, status: 'regular' };
    }
    return { value: null, lower: null, upper: null, status: 'missing' };
}

/** Derselbe (n-1)*p-Interpolationsrang wie quantile; Grenzen interpolieren mit. */
export function estimateWealthFanQuantile(fan, year, mode, p) {
    if (!['real', 'nominal'].includes(mode) || !Number.isInteger(year) || year < 0 || year > fan.horizonYears || !Number.isFinite(p) || p < 0 || p > 1) fail('Quantilabfrage ungültig.');
    const count = fan.alive[year] - fan[mode === 'real' ? 'missingReal' : 'missingNominal'][year];
    if (!count) return { value: null, lower: null, upper: null, status: 'missing' };
    const rank = (count - 1) * p, fraction = rank - Math.floor(rank);
    const left = rankEstimate(fan[mode], year * WEALTH_FAN_CLASS_COUNT, Math.floor(rank));
    if (!fraction) return left;
    const right = rankEstimate(fan[mode], year * WEALTH_FAN_CLASS_COUNT, Math.ceil(rank));
    const interpolate = key => left[key] === null || right[key] === null ? null : left[key] + fraction * (right[key] - left[key]);
    return { value: interpolate('value'), lower: interpolate('lower'), upper: interpolate('upper'),
        status: left.value === null ? left.status : right.value === null ? right.status : 'regular' };
}

export function buildWealthFanModel(fan, mode = 'real') {
    try { assertWealthFan(fan); } catch { return { available: false, mode, years: [] }; }
    const years = [];
    for (let year = 0; year <= fan.horizonYears; year++) {
        if (!fan.validRuns || fan.alive[year] * 100 < fan.validRuns * 5) break;
        years.push({ year, alive: fan.alive[year], ruined: fan.ruined[year], alivePct: fan.alive[year] / fan.validRuns * 100,
            missing: fan[mode === 'real' ? 'missingReal' : 'missingNominal'][year],
            quantiles: Object.fromEntries([5, 25, 50, 75, 95].map(p => [p, estimateWealthFanQuantile(fan, year, mode, p / 100)])) });
    }
    return { available: years.some(row => row.alive > row.missing), mode, horizonYears: fan.horizonYears,
        validRuns: fan.validRuns, technicalErrors: fan.technicalErrors, years };
}

export function wealthFanByteLength(fan) { return fields.reduce((sum, field) => sum + fan[field].byteLength, 0); }
export function wealthFanTransferables(fan) { return fan ? fields.map(field => fan[field].buffer) : []; }
