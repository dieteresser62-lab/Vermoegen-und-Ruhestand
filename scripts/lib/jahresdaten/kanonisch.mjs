/**
 * Kanonische Hashes wie in den Bauskripten. Die Bauskripte kennen zwei Schreibweisen:
 * - `codepoint` (Aktien, Inflation, Geldmarkt, Gold): Schlüssel nach Ganzzahl, sonst nach Codepunkt;
 *   nicht endliche Zahlen brechen ab.
 * - `locale` (Lohn, CAPE): Schlüssel nach Ganzzahl, sonst mit localeCompare.
 * Für Jahrestabellen mit Zahlen liefern beide dasselbe; für Beobachtungsobjekte zählt die Schreibweise der Kette.
 */
import crypto from 'node:crypto';

/** @param {string | Buffer} value @returns {string} */
export function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

const INTEGER_KEY = /^(0|[1-9]\d*)$/;

/** @param {(left: string, right: string) => number} textCompare */
function keyComparator(textCompare) {
    return (left, right) => {
        const leftInteger = INTEGER_KEY.test(left);
        const rightInteger = INTEGER_KEY.test(right);
        if (leftInteger && rightInteger) return Number(left) - Number(right);
        if (leftInteger !== rightInteger) return leftInteger ? -1 : 1;
        return textCompare(left, right);
    };
}

const codepointCompare = keyComparator((left, right) => (left < right ? -1 : left > right ? 1 : 0));
const localeCompare = keyComparator((left, right) => left.localeCompare(right));

/** @param {unknown} value @returns {string} */
function canonicalizeCodepoint(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`Cannot canonicalize a non-finite number: ${value}`);
        return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalizeCodepoint).join(',')}]`;
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort(codepointCompare);
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeCodepoint(/** @type {any} */ (value)[key])}`).join(',')}}`;
    }
    throw new Error(`Unsupported canonical value: ${typeof value}`);
}

/** @param {unknown} value @returns {string} */
function canonicalizeLocale(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalizeLocale).join(',')}]`;
    return `{${Object.keys(value).sort(localeCompare)
        .map(key => `${JSON.stringify(key)}:${canonicalizeLocale(/** @type {any} */ (value)[key])}`).join(',')}}`;
}

/** @param {unknown} value @returns {string} SHA-256 der Codepunkt-Schreibweise. */
export function sha256CanonicalCodepoint(value) {
    return sha256(canonicalizeCodepoint(value));
}

/** @param {unknown} value @returns {string} SHA-256 der localeCompare-Schreibweise. */
export function sha256CanonicalLocale(value) {
    return sha256(Buffer.from(canonicalizeLocale(value), 'utf8'));
}
