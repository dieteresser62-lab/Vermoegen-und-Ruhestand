// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { requirePlainObject, createStressReplayFingerprint, fail, validateFingerprint, requireString, requireInteger, assertStressReplayFinite, deepFreeze, cloneValue } from './values.js';
import { STRESS_REPLAY_SCHEMA_VERSIONS, STRESS_REPLAY_LIMITS, RESULT_TERMINAL_STATUSES, STRESS_REPLAY_COMPARISON_KPIS_V1 } from './schema.js';
import { canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';

function comparisonFingerprintBasis(comparison) {
    const { comparisonFingerprint: _comparisonFingerprint, ...basis } = comparison;
    return basis;
}

/**
 * @param comparison - Kontext für comparison.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayComparisonFingerprint(comparison) {
    requirePlainObject(comparison, 'comparison');
    return createStressReplayFingerprint(comparisonFingerprintBasis(comparison));
}

/**
 * @param comparison - Kontext für comparison.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplayComparisonV1(comparison) {
    requirePlainObject(comparison, 'comparison');
    const allowedKeys = new Set([
        'schemaVersion',
        'comparisonVersion',
        'baselineId',
        'pathFingerprint',
        'baselineScenarioFingerprint',
        'variantOrder',
        'variants',
        'pairwise',
        'overallStatus',
        'financialRankingAllowed',
        'interpretation',
        'comparisonFingerprint'
    ]);
    const unknownKeys = Object.keys(comparison).filter(key => !allowedKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Comparison contains unknown contract fields', {
            fields: unknownKeys
        });
    }
    if (comparison.schemaVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.comparison
        || comparison.comparisonVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.comparison) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay comparison contract', {
            schemaVersion: comparison.schemaVersion,
            comparisonVersion: comparison.comparisonVersion
        });
    }
    if (comparison.baselineId !== 'baseline') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison must use the reserved baseline id');
    }
    validateFingerprint(comparison.pathFingerprint, 'comparison.pathFingerprint');
    validateFingerprint(comparison.baselineScenarioFingerprint, 'comparison.baselineScenarioFingerprint');
    validateFingerprint(comparison.comparisonFingerprint, 'comparison.comparisonFingerprint');
    if (!Array.isArray(comparison.variantOrder)
        || !Array.isArray(comparison.variants)
        || !Array.isArray(comparison.pairwise)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison collections are invalid');
    }
    if (comparison.variantOrder.length < 1
        || comparison.variantOrder.length > STRESS_REPLAY_LIMITS.maximumVariants
        || comparison.variantOrder[0] !== 'baseline'
        || new Set(comparison.variantOrder).size !== comparison.variantOrder.length) {
        fail('STRESS_REPLAY_VARIANT_LIMIT_EXCEEDED', 'Stress replay comparison variant order is invalid');
    }
    const expectedAlternativeOrder = comparison.variantOrder.slice(1).sort((left, right) => left.localeCompare(right));
    if (canonicalizeHistoricalContractValue(comparison.variantOrder.slice(1))
        !== canonicalizeHistoricalContractValue(expectedAlternativeOrder)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Alternative comparison order must be stable by id');
    }
    if (comparison.variants.length !== comparison.variantOrder.length
        || comparison.pairwise.length !== comparison.variantOrder.length - 1) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison cardinalities do not reconcile');
    }
    const variantIds = comparison.variants.map(entry => entry?.variantId);
    const pairwiseIds = comparison.pairwise.map(entry => entry?.variantId);
    if (canonicalizeHistoricalContractValue(variantIds)
        !== canonicalizeHistoricalContractValue(comparison.variantOrder)
        || canonicalizeHistoricalContractValue(pairwiseIds)
        !== canonicalizeHistoricalContractValue(comparison.variantOrder.slice(1))) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison identities do not reconcile');
    }
    for (const [index, entry] of comparison.variants.entries()) {
        requirePlainObject(entry, `comparison.variants[${index}]`);
        requireString(entry.variantId, `comparison.variants[${index}].variantId`);
        requireString(entry.label, `comparison.variants[${index}].label`);
        validateFingerprint(entry.variantFingerprint, `comparison.variants[${index}].variantFingerprint`);
        validateFingerprint(entry.resultFingerprint, `comparison.variants[${index}].resultFingerprint`);
        const expectedRole = index === 0 ? 'baseline' : 'alternative';
        if (entry.role !== expectedRole
            || !RESULT_TERMINAL_STATUSES.has(entry.terminalStatus)
            || !Array.isArray(entry.materialChangeGroups)
            || !Array.isArray(entry.warnings)
            || !Array.isArray(entry.transactionSummary)
            || !Array.isArray(entry.missingness)) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison variant entry is invalid', {
                path: `comparison.variants[${index}]`
            });
        }
        if ((entry.terminalStatus === 'technical_error') !== (entry.summary === null)) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Comparison variant summary conflicts with terminal status', {
                path: `comparison.variants[${index}].summary`
            });
        }
    }
    const allowedStatuses = new Set(['complete', 'blocked_technical_error']);
    if (!allowedStatuses.has(comparison.overallStatus)
        || typeof comparison.financialRankingAllowed !== 'boolean') {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Stress replay comparison status is invalid');
    }
    const hasTechnicalError = comparison.variants.some(entry => entry?.terminalStatus === 'technical_error');
    if (hasTechnicalError !== (comparison.overallStatus === 'blocked_technical_error')
        || comparison.financialRankingAllowed !== false) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Technical comparison status or interpretation is misleading');
    }
    const baselineTechnical = comparison.variants[0]?.terminalStatus === 'technical_error';
    for (const [index, pair] of comparison.pairwise.entries()) {
        if (!Array.isArray(pair?.firstDeltaMarkers)
            || !Array.isArray(pair?.missingness)
            || !Array.isArray(pair?.warnings)) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Pairwise stress replay diagnostics are invalid');
        }
        if (typeof pair.comparable !== 'boolean'
            || (pair.comparable && (!pair.kpiDeltas || typeof pair.kpiDeltas !== 'object'))
            || (!pair.comparable && pair.kpiDeltas !== null)) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Pairwise stress replay comparability is invalid');
        }
        const variantTechnical = comparison.variants[index + 1]?.terminalStatus === 'technical_error';
        if (pair.baselineId !== 'baseline'
            || pair.comparable !== !(baselineTechnical || variantTechnical)
            || !['single_factor', 'multi_factor'].includes(pair.factorMode)
            || !Array.isArray(pair.materialChangeGroups)
            || typeof pair.interpretation !== 'string') {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Pairwise stress replay status is inconsistent');
        }
        if (pair.comparable) {
            const baselineSummary = comparison.variants[0].summary;
            const variantSummary = comparison.variants[index + 1].summary;
            const expectedKpiKeys = STRESS_REPLAY_COMPARISON_KPIS_V1.map(kpi => kpi.field).sort();
            const actualKpiKeys = Object.keys(pair.kpiDeltas).sort();
            if (canonicalizeHistoricalContractValue(actualKpiKeys)
                !== canonicalizeHistoricalContractValue(expectedKpiKeys)) {
                fail('STRESS_REPLAY_CONTRACT_INVALID', 'Pairwise KPI ledger has an invalid field set');
            }
            for (const { field: kpiField, unit } of STRESS_REPLAY_COMPARISON_KPIS_V1) {
                const delta = requirePlainObject(pair.kpiDeltas[kpiField], `comparison.pairwise[${index}].kpiDeltas.${kpiField}`);
                const baselineValue = baselineSummary?.[kpiField] ?? null;
                const variantValue = variantSummary?.[kpiField] ?? null;
                const observed = Number.isFinite(baselineValue) && Number.isFinite(variantValue);
                const expectedAbsolute = observed ? variantValue - baselineValue : null;
                const expectedRelative = observed && baselineValue !== 0
                    ? ((variantValue - baselineValue) / Math.abs(baselineValue)) * 100
                    : null;
                if (delta.unit !== unit
                    || canonicalizeHistoricalContractValue(delta.baselineValue) !== canonicalizeHistoricalContractValue(baselineValue)
                    || canonicalizeHistoricalContractValue(delta.variantValue) !== canonicalizeHistoricalContractValue(variantValue)
                    || canonicalizeHistoricalContractValue(delta.absoluteDelta) !== canonicalizeHistoricalContractValue(expectedAbsolute)
                    || canonicalizeHistoricalContractValue(delta.relativeDeltaPct) !== canonicalizeHistoricalContractValue(expectedRelative)) {
                    fail('STRESS_REPLAY_CONTRACT_INVALID', 'Pairwise KPI delta does not match variant summaries', {
                        field: kpiField
                    });
                }
            }
        }
        for (const [markerIndex, deltaMarker] of pair.firstDeltaMarkers.entries()) {
            requirePlainObject(deltaMarker, `comparison.pairwise[${index}].firstDeltaMarkers[${markerIndex}]`);
            requireInteger(deltaMarker.yearIndex, `comparison.pairwise[${index}].firstDeltaMarkers[${markerIndex}].yearIndex`, 0);
            requireString(deltaMarker.category, `comparison.pairwise[${index}].firstDeltaMarkers[${markerIndex}].category`);
            requireString(deltaMarker.causeCode, `comparison.pairwise[${index}].firstDeltaMarkers[${markerIndex}].causeCode`);
            if (!Array.isArray(deltaMarker.fields) || deltaMarker.fields.length === 0) {
                fail('STRESS_REPLAY_CONTRACT_INVALID', 'First delta marker fields are invalid');
            }
        }
    }
    assertStressReplayFinite(comparison, 'comparison');
    const expectedFingerprint = createStressReplayComparisonFingerprint(comparison);
    if (expectedFingerprint.value !== comparison.comparisonFingerprint.value) {
        fail('STRESS_REPLAY_COMPARISON_FINGERPRINT_MISMATCH', 'Comparison fingerprint does not match its contents');
    }
    return deepFreeze(cloneValue(comparison));
}

export const assertStressReplayComparisonV1 = validateStressReplayComparisonV1;
