/**
 * Resolves the annual post-policy portfolio withdrawal shared by the engine
 * and simulator reporting. All supplied representations must reconcile;
 * callers decide whether a missing value is allowed at their boundary.
 */

const RECONCILIATION_TOLERANCE_EUR = 0.01;
const RECONCILIATION_FLOAT_EPSILON_EUR = 1e-9;


/** @template {PropertyKey} K
 * @param {unknown} object
 * @param {K} key
 * @returns {object is Record<K,unknown>} */
function hasOwn(object, key) {
    return object !== null
        && object !== undefined
        && Object.prototype.hasOwnProperty.call(object, key);
}

/** @param {string} source
 * @param {unknown} value
 * @param {boolean} present
 * @returns {import('../typcheck/rechenkern').WithdrawalCandidate|null} */
function readCandidate(source, value, present) {
    if (!present) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return { source, status: 'invalid', value };
    }
    return { source, status: 'valid', value };
}

/** @param {import('../typcheck/rechenkern').WithdrawalInput} options
 * @returns {import('../typcheck/rechenkern').WithdrawalResolution} */
export function resolvePlannedAnnualWithdrawal(options = {}) {
    const { spendingResult, annualPlan } = options;
    const hasAnnualDetails = hasOwn(spendingResult?.details, 'endgueltigeEntnahme')
        && spendingResult.details.endgueltigeEntnahme !== undefined;
    const hasMonthlyWithdrawal = hasOwn(spendingResult, 'monatlicheEntnahme')
        && spendingResult.monatlicheEntnahme !== undefined;
    const hasAnnualPlan = hasOwn(options, 'annualPlan') && annualPlan !== undefined;
    const monthlyWithdrawal = spendingResult?.monatlicheEntnahme;
    const candidates = /** @type {import('../typcheck/rechenkern').WithdrawalCandidate[]} */ ([
        readCandidate(
            'spending.details.endgueltigeEntnahme',
            spendingResult?.details?.endgueltigeEntnahme,
            hasAnnualDetails
        ),
        readCandidate(
            'spending.monatlicheEntnahme_x12',
            typeof monthlyWithdrawal === 'number' ? monthlyWithdrawal * 12 : monthlyWithdrawal,
            hasMonthlyWithdrawal
        ),
        readCandidate('annualPlan', annualPlan, hasAnnualPlan)
    ].filter(Boolean));

    const invalidCandidates = candidates.filter(candidate => candidate.status === 'invalid');
    if (invalidCandidates.length > 0) {
        return {
            status: 'invalid',
            annualWithdrawal: null,
            source: null,
            candidates
        };
    }

    const validCandidates = /** @type {import('../typcheck/rechenkern').ValidWithdrawalCandidate[]} */ (candidates.filter(candidate => candidate.status === 'valid'));
    if (validCandidates.length === 0) {
        return {
            status: 'missing',
            annualWithdrawal: null,
            source: null,
            candidates: []
        };
    }

    const canonical = validCandidates[0];
    const conflicts = validCandidates.filter(candidate => (
        Math.abs(candidate.value - canonical.value)
            > RECONCILIATION_TOLERANCE_EUR + RECONCILIATION_FLOAT_EPSILON_EUR
    ));
    if (conflicts.length > 0) {
        return {
            status: 'conflict',
            annualWithdrawal: null,
            source: null,
            candidates: validCandidates
        };
    }

    return {
        status: 'resolved',
        annualWithdrawal: canonical.value,
        source: canonical.source,
        candidates: validCandidates
    };
}
