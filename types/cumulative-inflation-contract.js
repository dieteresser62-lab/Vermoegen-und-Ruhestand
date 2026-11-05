
export const CUMULATIVE_INFLATION_FACTOR_ERROR_CODE = 'CUMULATIVE_INFLATION_FACTOR_INVALID';
export const CUMULATIVE_INFLATION_FACTOR_MAX = 20;

export class CumulativeInflationFactorError extends RangeError {
    /** @param {unknown} value
 * @param {string} path
 * @param {{runtime?:boolean}} options */
    constructor(value, path = 'cumulativeInflationFactor', options = {}) {
        const runtime = options.runtime === true;
        const domain = runtime
            ? `${path} muss eine endliche Zahl groesser 0 sein.`
            : `${path} muss eine endliche Zahl groesser 0 und hoechstens ${CUMULATIVE_INFLATION_FACTOR_MAX} sein.`;
        const recovery = runtime
            ? ''
            : ' Der gespeicherte Wert wurde nicht veraendert; bitte den Zustand oder ein Recovery-Backup korrigieren.';
        super(`${domain}${recovery}`);
        this.name = 'CumulativeInflationFactorError';
        this.code = CUMULATIVE_INFLATION_FACTOR_ERROR_CODE;
        this.path = path;
        this.value = value;
        this.runtime = runtime;
    }
}

/** @param {unknown} value
 * @returns {value is number} */
export function isValidCumulativeInflationFactor(value) {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value > 0
        && value <= CUMULATIVE_INFLATION_FACTOR_MAX;
}

/** @param {unknown} value
 * @returns {value is number} */
export function isValidRuntimeCumulativeInflationFactor(value) {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value > 0;
}

/** @param {unknown} value
 * @param {import('../typcheck/rechenkern').InflationOptions} options
 * @returns {number} */
export function assertCumulativeInflationFactor(value, options = {}) {
    const path = options.path || 'cumulativeInflationFactor';
    if (!isValidCumulativeInflationFactor(value)) {
        throw new CumulativeInflationFactorError(value, path);
    }
    return value;
}

/** @param {unknown} value
 * @param {import('../typcheck/rechenkern').InflationOptions} options
 * @returns {number} */
export function resolveCumulativeInflationFactor(value, options = {}) {
    const {
        allowMissing = true,
        defaultValue = 1,
        path = 'cumulativeInflationFactor'
    } = options;
    if (value === undefined && allowMissing) {
        return assertCumulativeInflationFactor(defaultValue, { path: `${path}.defaultValue` });
    }
    return assertCumulativeInflationFactor(value, { path });
}

/** @param {unknown} value
 * @param {import('../typcheck/rechenkern').InflationOptions} options
 * @returns {number} */
export function assertRuntimeCumulativeInflationFactor(value, options = {}) {
    const path = options.path || 'cumulativeInflationFactor';
    if (!isValidRuntimeCumulativeInflationFactor(value)) {
        throw new CumulativeInflationFactorError(value, path, { runtime: true });
    }
    return value;
}

/** @param {unknown} value
 * @param {import('../typcheck/rechenkern').InflationOptions} options
 * @returns {number} */
export function resolveRuntimeCumulativeInflationFactor(value, options = {}) {
    const {
        allowMissing = true,
        defaultValue = 1,
        path = 'cumulativeInflationFactor'
    } = options;
    if (value === undefined && allowMissing) {
        return assertRuntimeCumulativeInflationFactor(defaultValue, {
            path: `${path}.defaultValue`
        });
    }
    return assertRuntimeCumulativeInflationFactor(value, { path });
}
