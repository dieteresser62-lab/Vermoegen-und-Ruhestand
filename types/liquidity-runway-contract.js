/**
 * Canonical user-facing liquidity runway contract shared by Balance,
 * Simulator and the engine. Values in months from older versions are ignored;
 * a missing runway uses the default.
 */

const REQUEST_KEY = 'liquidityRunwayYears';

export const LIQUIDITY_RUNWAY_CONTRACT_V1 = Object.freeze({
    version: 'LiquidityRunwayContractV1',
    requestKey: REQUEST_KEY,
    unit: 'years',
    defaultYears: 5,
    minimumYears: 1,
    maximumYears: 10,
    stepYears: 0.5,
    internalPolicy: Object.freeze({
        hardMinimumCapMonths: 24,
        hardMinimumSource: 'engine_policy_cap_24_months'
    })
});

/** @param {unknown} object
 * @param {PropertyKey} key */
function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

/** @param {unknown} value */
function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** @param {number} years */
function isValidStep(years) {
    const steps = (years - LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears)
        / LIQUIDITY_RUNWAY_CONTRACT_V1.stepYears;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** @param {number} years */
export function isValidLiquidityRunwayYears(years) {
    return Number.isFinite(years)
        && years >= LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears
        && years <= LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears
        && isValidStep(years);
}

/** @param {import('../typcheck/rechenkern').RunwayInput} input */
export function resolveLiquidityRunwayYears(input = {}) {
    const canonicalYears = finiteNumber(input[REQUEST_KEY]);
    if (canonicalYears !== null) {
        return {
            years: canonicalYears,
            source: 'canonical'
        };
    }

    if (hasOwn(input, REQUEST_KEY)
        && input[REQUEST_KEY] !== null
        && input[REQUEST_KEY] !== undefined
        && input[REQUEST_KEY] !== '') {
        return {
            years: NaN,
            source: 'canonical_invalid'
        };
    }

    return {
        years: LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears,
        source: 'default'
    };
}

/** @param {unknown} years */
export function deriveLiquidityRunwayPolicy(years) {
    const numericYears = Number(years);
    if (!isValidLiquidityRunwayYears(numericYears)) {
        throw new RangeError(
            `liquidityRunwayYears must be a finite ${LIQUIDITY_RUNWAY_CONTRACT_V1.stepYears}-year step between `
            + `${LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears} and ${LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears}`
        );
    }
    const targetMonths = numericYears * 12;
    const hardMinimumMonths = Math.min(
        targetMonths,
        LIQUIDITY_RUNWAY_CONTRACT_V1.internalPolicy.hardMinimumCapMonths
    );
    return Object.freeze({
        targetYears: numericYears,
        targetMonths,
        hardMinimumMonths,
        hardMinimumSource: LIQUIDITY_RUNWAY_CONTRACT_V1.internalPolicy.hardMinimumSource
    });
}
