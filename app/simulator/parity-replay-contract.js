import { canonicalizeHistoricalContractValue, sha256Hex } from './historical-backtest-contract.js';

export const PARITY_REPLAY_SCHEMA_VERSION = 'ParityReplayLogV1';
export const PARITY_REPLAY_PHASE = 'VOR_TRANSAKTION';
export const PARITY_REPLAY_INCOMPLETE = 'nicht vollständig replayfähig';
const HASH = /^[a-f0-9]{64}$/;
const TAG = '$parityValue';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** JSON copies retain undefined and -0; unsupported values stay explicit, never silently null. */
export function copyParityReplayValue(value, issues = [], path = '$', ancestors = new Set()) {
    if (value === undefined) return { [TAG]: 'undefined' };
    if (Object.is(value, -0)) return { [TAG]: '-0' };
    if (typeof value === 'number' && !Number.isFinite(value)) {
        issues.push({ status: 'TECHNISCHER_FEHLER', path, reason: 'non_finite_number' });
        return { [TAG]: String(value) };
    }
    if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
    if (typeof value !== 'object' || ancestors.has(value)
        || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        || own(value, TAG)) {
        issues.push({ status: 'FEHLT_LOG', path, reason: 'unsupported_replay_value' });
        return { [TAG]: 'unsupported' };
    }
    ancestors.add(value);
    const copy = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
        Object.defineProperty(copy, key, {
            value: copyParityReplayValue(value[key], issues, `${path}.${key}`, ancestors),
            enumerable: true, writable: true, configurable: true
        });
    }
    ancestors.delete(value);
    return copy;
}

/** Restore exact Engine arguments after JSON loading (including own undefined properties). */
export function restoreParityReplayValue(value) {
    if (record(value) && own(value, TAG)) {
        if (value[TAG] === 'undefined') return undefined;
        if (value[TAG] === '-0') return -0;
        throw new TypeError('Replay enthält einen nicht wiederherstellbaren Wert.');
    }
    if (record(value) && value.status === 'UNBEGRENZT' && value.reason === 'zero_withdrawal') return Infinity;
    if (value === null || typeof value !== 'object') return value;
    return restoreContainer(value);
}

function restoreContainer(value) {
    const copy = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
        Object.defineProperty(copy, key, {
            value: restoreParityReplayValue(value[key]), enumerable: true, writable: true, configurable: true
        });
    }
    return copy;
}

export function hashParityReplayValue(value) {
    return sha256Hex(canonicalizeHistoricalContractValue(value));
}

export function sealParityReplayLog(log, hashValue = hashParityReplayValue) {
    const { logHash: ignored, ...payload } = log;
    return { ...payload, logHash: hashValue(payload) };
}

function inspectJson(value, path, issues, ancestors = new Set()) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        issues.push({ status: 'TECHNISCHER_FEHLER', path, reason: 'non_finite_number' });
    } else if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        issues.push({ status: 'TECHNISCHER_FEHLER', path, reason: 'not_json_value' });
    } else if (value && typeof value === 'object') {
        if (ancestors.has(value) || (!Array.isArray(value)
            && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
            issues.push({ status: 'TECHNISCHER_FEHLER', path, reason: 'not_json_document' });
            return;
        }
        if (own(value, TAG)) {
            if (Object.keys(value).length !== 1 || !['undefined', '-0'].includes(value[TAG])) {
                issues.push({ status: 'TECHNISCHER_FEHLER', path, reason: 'unreplayable_encoded_value' });
            }
        } else {
            ancestors.add(value);
            for (const [key, child] of Object.entries(value)) inspectJson(child, `${path}.${key}`, issues, ancestors);
            ancestors.delete(value);
        }
    }
}

/** Structural validity, Engine replay and complete household parity are separate results. */
export function validateParityReplayLog(log, { expectedSource = null, hashValue = hashParityReplayValue } = {}) {
    const issues = [];
    let schemaValid = true;
    const invalid = (path, reason) => issues.push({ status: 'TECHNISCHER_FEHLER', path, reason });
    const missing = (path, reason) => issues.push({ status: 'FEHLT_LOG', path, reason });
    if (!record(log) || log.schemaVersion !== PARITY_REPLAY_SCHEMA_VERSION) {
        return { valid: false, engineReplayable: false, replayable: false, status: PARITY_REPLAY_INCOMPLETE,
            issues: [{ status: 'FEHLT_LOG', path: '$.schemaVersion', reason: 'unsupported_or_legacy_log' }] };
    }
    inspectJson(log, '$', issues);
    if (issues.length) return { valid: false, engineReplayable: false, replayable: false, status: PARITY_REPLAY_INCOMPLETE, issues };
    for (const field of ['source', 'initialRecords', 'years', 'limitations', 'captureIssues', 'logHash']) {
        if (!own(log, field)) schemaValid = false;
    }
    if (!record(log.source)) invalid('$.source', 'source_required');
    for (const field of ['sourceHash', 'datasetHash']) {
        if (log.source?.[field] === null) missing(`$.source.${field}`, 'provenance_unavailable');
        else if (!HASH.test(log.source?.[field] || '')) invalid(`$.source.${field}`, 'sha256_required');
    }
    const version = log.source?.engineVersion;
    if (version === null) missing('$.source.engineVersion', 'engine_version_unavailable');
    else if (!record(version) || !['string', 'number'].includes(typeof version.api)
        || !['string', 'number'].includes(typeof version.build)) invalid('$.source.engineVersion', 'engine_version_required');
    if (typeof log.source?.temporalConventionId !== 'string' || !log.source.temporalConventionId) {
        missing('$.source.temporalConventionId', 'temporal_convention_unavailable');
    }
    if (expectedSource) {
        for (const [key, value] of Object.entries(expectedSource)) {
            if (hashValue(log.source?.[key]) !== hashValue(value)) invalid(`$.source.${key}`, 'source_mismatch');
        }
    }
    if (!own(log, 'initialRecords') || log.initialRecords === null) missing('$.initialRecords', 'initial_person_and_plan_records_unavailable');
    else if (!record(log.initialRecords)) invalid('$.initialRecords', 'records_object_required');
    if (!Array.isArray(log.captureIssues)) invalid('$.captureIssues', 'issues_array_required');
    else for (const [index, issue] of log.captureIssues.entries()) {
        if (!record(issue) || typeof issue.path !== 'string' || !['FEHLT_LOG', 'TECHNISCHER_FEHLER'].includes(issue.status)) {
            invalid(`$.captureIssues.${index}`, 'capture_issue_invalid');
        } else issues.push(issue);
    }
    if (!Array.isArray(log.limitations)) invalid('$.limitations', 'limitations_array_required');
    else for (const [index, issue] of log.limitations.entries()) {
        if (!record(issue) || !['FEHLT_LOG', 'FEHLT_MODELL', 'FACHLICH_OFFEN'].includes(issue.status)) {
            invalid(`$.limitations.${index}`, 'limitation_invalid');
        } else issues.push({ ...issue, path: `$.limitations.${index}` });
    }
    if (!Array.isArray(log.years) || log.years.length === 0) missing('$.years', 'no_engine_calls_recorded');
    const indices = new Set();
    for (const [index, year] of (Array.isArray(log.years) ? log.years : []).entries()) {
        const path = `$.years.${index}`;
        if (!record(year)) { invalid(path, 'year_record_required'); continue; }
        if (!Number.isInteger(year.yearIndex) || year.yearIndex < 0 || indices.has(year.yearIndex)) invalid(`${path}.yearIndex`, 'unique_year_index_required');
        if (index > 0 && year.yearIndex <= log.years[index - 1]?.yearIndex) invalid(`${path}.yearIndex`, 'chronological_year_order_required');
        indices.add(year.yearIndex);
        if (!Number.isInteger(year.historicalYear)) missing(`${path}.historicalYear`, 'historical_year_unavailable');
        if (!Number.isInteger(year.logicalPlanningYear)) missing(`${path}.logicalPlanningYear`, 'logical_planning_year_unavailable');
        if (year.decisionPhase !== PARITY_REPLAY_PHASE) invalid(`${path}.decisionPhase`, 'unsupported_decision_phase');
        for (const field of ['yearIndex', 'historicalYear', 'logicalPlanningYear', 'decisionPhase', 'engineInput', 'engineLastState', 'options', 'expectedDecision', 'simulatorStateAtYearStart',
            'simulatorStateBefore', 'assumptions', 'householdEvents', 'effectiveAnnualPensions', 'cashAndLots', 'marketContext', 'horizonContext', 'resetEvidence']) {
            if (!own(year, field)) { schemaValid = false; missing(`${path}.${field}`, 'required_capture_missing'); }
        }
        for (const field of ['engineInput', 'simulatorStateAtYearStart', 'simulatorStateBefore', 'assumptions',
            'householdEvents', 'effectiveAnnualPensions', 'cashAndLots', 'marketContext', 'horizonContext', 'resetEvidence']) {
            if (own(year, field) && (!record(year[field]) || own(year[field], TAG))) invalid(`${path}.${field}`, 'object_required');
        }
        for (const field of ['engineLastState', 'options']) {
            if (own(year, field) && year[field] !== null && (!record(year[field])
                || (own(year[field], TAG) && year[field][TAG] !== 'undefined'))) invalid(`${path}.${field}`, 'object_null_or_undefined_required');
        }
        for (const field of ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'aktuelleLiquiditaet', 'renteMonatlich',
            'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation', 'capeRatio']) {
            if (!Number.isFinite(year.engineInput?.[field])) missing(`${path}.engineInput.${field}`, 'engine_input_value_unavailable');
        }
        if (!Array.isArray(year.engineInput?.detailledTranches)) missing(`${path}.engineInput.detailledTranches`, 'engine_lots_unavailable');
        if (!record(year.expectedDecision?.ui?.spending) || !record(year.expectedDecision?.ui?.action)
            || !record(year.expectedDecision?.ui?.market) || !record(year.expectedDecision?.newState)
            || year.expectedDecision?.error) missing(`${path}.expectedDecision`, 'successful_engine_decision_unavailable');
        if (!Number.isFinite(year.expectedDecision?.ui?.spending?.monatlicheEntnahme)
            || typeof year.expectedDecision?.ui?.action?.type !== 'string'
            || !Array.isArray(year.expectedDecision?.ui?.action?.quellen)
            || typeof year.expectedDecision?.ui?.market?.sKey !== 'string') {
            missing(`${path}.expectedDecision`, 'decision_fields_unavailable');
        }
        if (!Number.isFinite(year.effectiveAnnualPensions?.pensionAnnual)) missing(`${path}.effectiveAnnualPensions.pensionAnnual`, 'annual_pensions_unavailable');
        if (!Number.isFinite(year.cashAndLots?.pooledLiquidity) || !Array.isArray(year.cashAndLots?.lots)) missing(`${path}.cashAndLots`, 'cash_or_lots_unavailable');
        for (const [lotIndex, lot] of (Array.isArray(year.cashAndLots?.lots) ? year.cashAndLots.lots : []).entries()) {
            if (!lot?.sourceProfileId) missing(`${path}.cashAndLots.lots.${lotIndex}.sourceProfileId`, 'lot_owner_unavailable');
        }
        if (!Number.isFinite(year.horizonContext?.horizonYears) && year.engineInput?.dynamicFlex === true) missing(`${path}.horizonContext.horizonYears`, 'resolved_horizon_unavailable');
        for (const [field, expected] of [
            ['cashAndLots.pooledLiquidity', year.engineInput?.aktuelleLiquiditaet],
            ['cashAndLots.lots', year.engineInput?.detailledTranches],
            ['horizonContext.horizonYears', year.engineInput?.horizonYears],
            ['marketContext.yearData.jahr', year.historicalYear]
        ]) {
            let actual = year;
            for (const key of field.split('.')) actual = actual?.[key];
            if (hashValue(actual) !== hashValue(expected)) invalid(`${path}.${field}`, 'capture_evidence_mismatch');
        }
        if (typeof year.resetEvidence?.simulatorResetApplied !== 'boolean' || !Array.isArray(year.resetEvidence?.removedFields)) {
            missing(`${path}.resetEvidence`, 'direct_path_reset_evidence_unavailable');
        }
    }
    if (!log.years?.every(year => year.cashAndLots?.cashOwnership?.persons?.every(person => person.taxState))) {
        issues.push({ status: 'FEHLT_MODELL', path: '$.years', reason: 'legacy_personal_tax_state_unavailable', fields: ['personalTaxState'] });
    }
    try {
        const { logHash, ...payload } = log;
        if (!HASH.test(logHash || '') || hashValue(payload) !== logHash) invalid('$.logHash', 'log_hash_mismatch');
    } catch { invalid('$.logHash', 'log_hash_unverifiable'); }
    const valid = schemaValid && !issues.some(issue => issue.status === 'TECHNISCHER_FEHLER');
    const engineFields = /\.(engineInput|engineLastState|options|expectedDecision)(\.|$)/;
    const engineReplayable = valid && Array.isArray(log.years) && log.years.length > 0
        && !issues.some(issue => issue.status === 'FEHLT_LOG' && (engineFields.test(issue.path)
            || issue.path.startsWith('$.source') || issue.path === '$.years'));
    return { valid, engineReplayable, replayable: false, status: PARITY_REPLAY_INCOMPLETE, issues };
}

export function parseParityReplayLog(json, options) {
    const log = JSON.parse(json);
    return { log, validation: validateParityReplayLog(log, options) };
}
