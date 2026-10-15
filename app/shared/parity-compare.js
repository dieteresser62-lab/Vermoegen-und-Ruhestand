/** Comparison mechanics only; no policy, storage or ambient dependencies. */
export const PARITY_TOLERANCES = Object.freeze({ EUR: 0.01, RATE: 1e-9, EXACT: 0 });
export const PARITY_PHASES = Object.freeze(['VOR_TRANSAKTION', 'NACH_TRANSAKTION', 'VOR_AUSZAHLUNG', 'JAHRESENDE']);
const labels = { GLEICH: 'gleich', FEHLT_LOG: 'fehlender Logwert', FEHLT_MODELL: 'fehlendes Personenmodell',
    PHASE_NICHT_VERGLEICHBAR: 'andere Phase', TECHNISCHER_FEHLER: 'technischer Fehler',
    NICHT_ANWENDBAR: 'nicht anwendbar', AUSGEKLAMMERT: 'ausgeklammert' };
const unlimited = value => value?.status === 'UNBEGRENZT' && value.value === null && value.reason === 'zero_withdrawal';
const compareKeys = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function parityMeasurement(value, { phase, path, status, reason, zeroWithdrawal = false } = {}) {
    if (value === Infinity && zeroWithdrawal) value = { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' };
    if (typeof value === 'number' && !Number.isFinite(value)) return {
        status: 'TECHNISCHER_FEHLER', value: null, reason: 'non_finite_number', phase, path };
    if (unlimited(value) && !zeroWithdrawal) return {
        status: 'TECHNISCHER_FEHLER', value: null, reason: 'unlimited_requires_zero_withdrawal', phase, path };
    if (value === undefined) return { status: status || 'FEHLT_LOG', value: null,
        reason: reason || 'value_not_recorded', phase, path };
    return { status: status || 'VORHANDEN', value, reason: reason || 'measured', phase, path };
}

/** Rounding remains visible even below EUR tolerance. Exceptions never mask invalid numbers. */
export function compareParityField({ id, phase = 'VOR_TRANSAKTION', category = 'EINGABE',
    simulator, balance, tolerance = 'EXACT', status, reason, question, rounding = false, upstream = [] }) {
    if (!Object.hasOwn(PARITY_TOLERANCES, tolerance)) throw new TypeError('Unknown parity tolerance');
    const invalid = [simulator, balance].some(m => m.status === 'TECHNISCHER_FEHLER')
        || tolerance !== 'EXACT' && [simulator, balance].some(m => m.status === 'VORHANDEN'
            && typeof m.value !== 'number' && !unlimited(m.value));
    const available = [simulator, balance].every(m => m.status === 'VORHANDEN');
    const numeric = available && [simulator.value, balance.value].every(v => typeof v === 'number');
    const delta = numeric ? balance.value - simulator.value : null;
    const withinTolerance = available && (numeric ? Math.abs(delta) <= PARITY_TOLERANCES[tolerance]
        : JSON.stringify(simulator.value) === JSON.stringify(balance.value));
    let resultStatus, classification;
    if (invalid) resultStatus = 'TECHNISCHER_FEHLER';
    else if (status) resultStatus = status;
    else if (!available) resultStatus = [simulator, balance].find(m => m.status !== 'VORHANDEN').status;
    else if (rounding && numeric && delta !== 0) resultStatus = withinTolerance ? 'GLEICH' : 'FACHLICH_OFFEN';
    else if (withinTolerance) resultStatus = 'GLEICH';
    else resultStatus = question ? 'FACHLICH_OFFEN' : 'TECHNISCHER_FEHLER';
    if (resultStatus === 'FACHLICH_OFFEN' && (!Number.isInteger(question) || question < 1 || question > 8)) {
        throw new TypeError('Offene Fachfrage braucht eine Nummer von 1 bis 8.');
    }
    classification = rounding && numeric && delta !== 0 && ['GLEICH', 'FACHLICH_OFFEN'].includes(resultStatus)
        ? 'Rundungsursache' : resultStatus === 'FACHLICH_OFFEN' ? `offene Fachfrage ${question}` : labels[resultStatus];
    const expose = measurement => ({ ...measurement, status: measurement.status === 'TECHNISCHER_FEHLER' ? measurement.status
        : status ? resultStatus : measurement.status === 'VORHANDEN' ? withinTolerance ? 'GLEICH' : 'ABWEICHUNG' : measurement.status });
    return { id, phase, category: rounding && delta !== 0 ? 'RUNDUNG' : category, tolerance,
        absoluteTolerance: PARITY_TOLERANCES[tolerance], status: resultStatus, classification,
        reason: invalid ? 'invalid_measurement' : reason || (withinTolerance ? 'within_tolerance' : 'field_difference'),
        question: question ?? null, upstream, withinTolerance, delta, simulator: expose(simulator), balance: expose(balance) };
}

/** Keep identifiers distinct and compare individual amounts, never compensated sums. */
export function canonicalParityLots(lots) {
    if (!Array.isArray(lots)) return undefined;
    return lots.map(lot => Object.fromEntries(['sourceProfileId', 'trancheId', 'type', 'category', 'marketValue',
        'costBasis', 'tqf', 'taxExempt', 'purchaseDate', 'shares'].map(key => [key, lot[key]])))
        .sort((a, b) => compareKeys(JSON.stringify([a.sourceProfileId, a.trancheId]), JSON.stringify([b.sourceProfileId, b.trancheId])));
}

/** Sources retain execution order. Object key order and explicit zero uses are immaterial. */
export function canonicalParityAction(action) {
    if (!action) return undefined;
    const sources = Array.isArray(action.quellen) ? action.quellen.map(source => Object.fromEntries(
        ['kind', 'category', 'sourceProfileId', 'trancheId', 'brutto', 'netto', 'steuer'].map(key => [key, source[key]]))) : undefined;
    const uses = action.verwendungen && Object.fromEntries(Object.entries(action.verwendungen)
        .filter(([, value]) => value !== 0).sort(([a], [b]) => compareKeys(a, b)));
    return { type: action.type, sources, uses, tax: action.steuer };
}

export function parityStateTolerance(key) {
    if (/^(flexRate|flexRateSmoothingReference|flexBudgetBalanceYears|cumulativeInflationFactor|vpwExpectedRealReturn|tqf|shares)$/.test(key)) return 'RATE';
    if (/^(peakRealVermoegen|lastTotalBudget|lastEntnahmeReal|flexBudgetBalance|vpwLastDynamicFlex|lossCarry|marketValue|costBasis|brutto|netto|steuer|tax)$/.test(key)) return 'EUR';
    return 'EXACT';
}

/** Recursive STATE comparison; array order is significant unless canonicalized by the caller. */
export function compareParityTree({ id, simulator, balance, phase, category, toleranceForKey = parityStateTolerance,
    simulatorPath = id, balancePath = id, zeroWithdrawal = false, ...options }) {
    const rows = [];
    function visit(a, b, path, pa, pb, key) {
        const object = value => value !== null && typeof value === 'object' && !unlimited(value);
        if (object(a) && object(b) && Array.isArray(a) === Array.isArray(b)) {
            const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
            if (keys.length) { for (const child of keys) visit(a[child], b[child], `${path}.${child}`, `${pa}.${child}`, `${pb}.${child}`, child); return; }
        }
        const config = typeof options.forPath === 'function' ? options.forPath(path, a, b) : options;
        rows.push(compareParityField({ id: path, phase, category, tolerance: toleranceForKey(key, a, b), ...config,
            simulator: parityMeasurement(a, { phase, path: pa, zeroWithdrawal }), balance: parityMeasurement(b, { phase, path: pb, zeroWithdrawal }) }));
    }
    visit(simulator, balance, id, simulatorPath, balancePath, id.split('.').at(-1));
    return rows;
}

export function summarizeParityFields(fields) {
    const counts = {};
    for (const row of fields) counts[row.status] = (counts[row.status] || 0) + 1;
    return { status: counts.TECHNISCHER_FEHLER ? 'TECHNISCHER_FEHLER'
        : fields.length && fields.every(row => row.status === 'GLEICH' && row.classification === 'gleich') ? 'GLEICH' : 'UNVOLLSTAENDIG',
    complete: fields.length > 0 && fields.every(row => row.status === 'GLEICH' && row.classification === 'gleich'), counts };
}
