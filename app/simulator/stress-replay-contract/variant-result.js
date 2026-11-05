// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { requirePlainObject, createStressReplayFingerprint, fail, requireString, validateFingerprint, assertStressReplayFinite, deepFreeze, cloneValue, requireInteger, requireFinite } from './values.js';
import { STRESS_REPLAY_VARIANT_CONTRACT_KEYS_V1, STRESS_REPLAY_SCHEMA_VERSIONS, STRESS_REPLAY_CONTRACT_VERSION, YEAR_RESULT_STATUSES, RESULT_TERMINAL_STATUSES } from './schema.js';
import { getStressReplayVariantContract } from './variant-whitelist.js';
import { normalizeStressReplayVariantPatch, flattenLeaves } from './variant-patch.js';
import { canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';

/**
 * @param variant - Kontext für variant.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayVariantFingerprint(variant) {
    requirePlainObject(variant, 'variant');
    const fingerprintBasis = Object.fromEntries(
        STRESS_REPLAY_VARIANT_CONTRACT_KEYS_V1
            .filter(key => key !== 'label' && key !== 'variantFingerprint')
            .filter(key => Object.hasOwn(variant, key))
            .map(key => [key, variant[key]])
    );
    return createStressReplayFingerprint(fingerprintBasis);
}

/**
 * @param variant - Kontext für variant.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplayVariantV1(variant) {
    requirePlainObject(variant, 'variant');
    const allowedKeys = new Set(STRESS_REPLAY_VARIANT_CONTRACT_KEYS_V1);
    const unknownKeys = Object.keys(variant).filter(key => !allowedKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Variant contains unknown contract fields', {
            fields: unknownKeys
        });
    }
    if (variant.schemaVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.variant
        || variant.contractVersion !== STRESS_REPLAY_CONTRACT_VERSION) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay variant contract', {
            schemaVersion: variant.schemaVersion,
            contractVersion: variant.contractVersion,
            whitelistVersion: variant.whitelistVersion
        });
    }
    getStressReplayVariantContract(variant.whitelistVersion);
    requireString(variant.id, 'variant.id');
    requireString(variant.label, 'variant.label');
    if (variant.role !== 'baseline' && variant.role !== 'alternative') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'variant.role must be baseline or alternative', {
            path: 'variant.role',
            role: variant.role
        });
    }
    if ((variant.role === 'baseline' && variant.id !== 'baseline')
        || (variant.role === 'alternative' && variant.id === 'baseline')) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'The baseline id is reserved for the baseline variant', {
            path: 'variant.id'
        });
    }
    validateFingerprint(variant.baselineScenarioFingerprint, 'variant.baselineScenarioFingerprint');
    validateFingerprint(variant.normalizedInputFingerprint, 'variant.normalizedInputFingerprint');
    validateFingerprint(variant.variantFingerprint, 'variant.variantFingerprint');
    const expectedVariantFingerprint = createStressReplayVariantFingerprint(variant);
    if (expectedVariantFingerprint.value !== variant.variantFingerprint.value) {
        fail('STRESS_REPLAY_VARIANT_FINGERPRINT_MISMATCH', 'Variant fingerprint does not match its contents');
    }
    const normalizedPatch = normalizeStressReplayVariantPatch(variant.patch, {
        whitelistVersion: variant.whitelistVersion
    });
    if (canonicalizeHistoricalContractValue(normalizedPatch)
        !== canonicalizeHistoricalContractValue(variant.patch)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Variant patch must already be canonically normalized', {
            path: 'variant.patch'
        });
    }
    const patchLeaves = flattenLeaves(normalizedPatch);
    if (variant.role === 'baseline' && patchLeaves.length !== 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'The baseline variant must have an empty patch', {
            path: 'variant.patch'
        });
    }
    if (variant.role === 'alternative' && patchLeaves.length === 0) {
        fail('STRESS_REPLAY_VARIANT_NO_OP', 'An alternative variant must contain a material change');
    }
    if (!Array.isArray(variant.materialChangeGroups) || !Array.isArray(variant.warnings)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Variant diagnostics must be arrays');
    }
    const expectedGroups = [...new Set(patchLeaves.map(([path]) => {
        if (path.startsWith('strategy.decumulation.')) return 'decumulation';
        if (path === 'strategy.longevityMode' || path.startsWith('strategy.longevity')) return 'longevity';
        return path.replace(/^strategy\./, '');
    }))].sort();
    if (canonicalizeHistoricalContractValue(variant.materialChangeGroups)
        !== canonicalizeHistoricalContractValue(expectedGroups)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Variant material-change groups do not match its patch');
    }
    const expectedWarnings = expectedGroups.length > 1
        ? [{
            code: 'STRESS_REPLAY_MULTI_FACTOR_VARIANT',
            factorCount: expectedGroups.length,
            factorGroups: expectedGroups
        }]
        : [];
    if (canonicalizeHistoricalContractValue(variant.warnings)
        !== canonicalizeHistoricalContractValue(expectedWarnings)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Variant warnings do not match its material changes');
    }
    if (variant.role === 'baseline' && variant.materialChangeGroups.length !== 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'The baseline variant must not report material changes');
    }
    if (variant.role === 'baseline'
        && variant.normalizedInputFingerprint.value !== variant.baselineScenarioFingerprint.value) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Baseline normalized inputs must match the baseline scenario');
    }
    assertStressReplayFinite(variant, 'variant');
    return deepFreeze(cloneValue({ ...variant, patch: normalizedPatch }));
}

export const assertStressReplayVariantV1 = validateStressReplayVariantV1;

function validateYearResult(record, index) {
    const path = `result.yearResults[${index}]`;
    requirePlainObject(record, path);
    requireInteger(record.yearIndex, `${path}.yearIndex`, 0);
    if (record.yearIndex !== index) {
        fail('STRESS_REPLAY_INDEX_BASIS_INVALID', `${path}.yearIndex must be zero-based and contiguous`, {
            path: `${path}.yearIndex`,
            expected: index,
            actual: record.yearIndex
        });
    }
    requireInteger(record.historicalYear, `${path}.historicalYear`);
    if (!YEAR_RESULT_STATUSES.has(record.status)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path}.status is unsupported`, {
            path: `${path}.status`,
            status: record.status
        });
    }
    requireFinite(record.nominalValueEur, `${path}.nominalValueEur`);
    requireFinite(record.realValueEur, `${path}.realValueEur`);
    if (record.status !== 'terminal_death') return;
    if (record.financiallyEvaluable !== false
        || record.withdrawalEur !== null
        || record.taxEur !== null) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'A terminal death year must remain financially unevaluable', {
            path
        });
    }
    if (!Array.isArray(record.missingness)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', `${path}.missingness must be an array`, { path: `${path}.missingness` });
    }
    const missingFields = new Set(record.missingness.map(entry => {
        requirePlainObject(entry, `${path}.missingness[]`);
        requireString(entry.reason, `${path}.missingness[].reason`);
        return requireString(entry.field, `${path}.missingness[].field`);
    }));
    if (!missingFields.has('withdrawalEur') || !missingFields.has('taxEur')) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'A terminal death year must explain missing financial values', {
            path,
            missingFields: [...missingFields]
        });
    }
}

/**
 * @param result - Laufergebnis.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplayVariantResultV1(result) {
    requirePlainObject(result, 'result');
    if (result.schemaVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.variantResult) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay variant result contract', {
            schemaVersion: result.schemaVersion
        });
    }
    for (const key of [
        'pathFingerprint',
        'baselineScenarioFingerprint',
        'variantFingerprint',
        'resultFingerprint'
    ]) validateFingerprint(result[key], `result.${key}`);
    if (!RESULT_TERMINAL_STATUSES.has(result.terminalStatus)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'result.terminalStatus is unsupported', {
            terminalStatus: result.terminalStatus
        });
    }
    if (!Array.isArray(result.yearResults) || !Array.isArray(result.transactions)
        || !Array.isArray(result.missingness) || !Array.isArray(result.warnings)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay result collections are invalid');
    }
    result.yearResults.forEach(validateYearResult);
    if (result.terminalStatus === 'technical_error') {
        requirePlainObject(result.technicalError, 'result.technicalError');
        if (result.summary !== null || result.reconciliation?.matched === true) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Technical errors must not expose reconciled financial summaries');
        }
    } else {
        requirePlainObject(result.summary, 'result.summary');
        if (result.technicalError !== null) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Financial results must not contain a technical error');
        }
        const financiallyEvaluatedYears = result.yearResults.filter(record => record.status === 'financial_year').length;
        if (result.summary.financiallyEvaluatedYears !== financiallyEvaluatedYears) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Financially evaluated years must count only financial year records', {
                expected: financiallyEvaluatedYears,
                actual: result.summary.financiallyEvaluatedYears
            });
        }
        if (result.terminalStatus === 'all_dead') {
            const deathRows = result.yearResults.filter(record => record.status === 'terminal_death');
            if (deathRows.length !== 1 || result.yearResults.at(-1)?.status !== 'terminal_death') {
                fail('STRESS_REPLAY_CONTRACT_INVALID', 'An all-dead result must end in exactly one terminal death year');
            }
            if (result.summary.ruinYear !== null) {
                fail('STRESS_REPLAY_CONTRACT_INVALID', 'An all-dead result must not expose a ruin year');
            }
        }
    }
    assertStressReplayFinite(result, 'result');
    return deepFreeze(cloneValue(result));
}

export const assertStressReplayVariantResultV1 = validateStressReplayVariantResultV1;
