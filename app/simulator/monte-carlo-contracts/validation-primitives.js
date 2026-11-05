// @ts-check

/** @param {string} contract
 * @param {string} code
 * @param {string} message */
export function contractError(contract, code, message) {
    const error = /** @type {TypeError & {code?:string}} */ (new TypeError(`${contract}: ${message}`));
    error.code = code;
    return error;
}

/** @template T
 * @overload
 * @param {T} value
 * @param {string} contract
 * @param {string} field
 * @returns {T & Record<string,unknown>}
 * */
/** @param {unknown} value
 * @param {string} contract
 * @param {string} field
 * @returns {Record<string,unknown>} */
export function requireObject(value, contract, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw contractError(contract, 'MC_CONTRACT_REQUIRED_OBJECT', `${field} must be an object.`);
    }
    return /** @type {Record<string,unknown>} */ (value);
}

/** @param {unknown} value
 * @param {string} contract
 * @param {string} field
 * @param {{min?:number}} [options]
 * @returns {number} */
export function requireInteger(value, contract, field, { min = 0 } = {}) {
    if (!Number.isSafeInteger(value) || value < min) {
        throw contractError(contract, 'MC_CONTRACT_INTEGER_INVALID', `${field} must be a safe integer >= ${min}.`);
    }
    return value;
}

/** @param {unknown} value
 * @param {string} contract
 * @param {string} field */
export function requireString(value, contract, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw contractError(contract, 'MC_CONTRACT_STRING_INVALID', `${field} must be a non-empty string.`);
    }
    return value;
}
