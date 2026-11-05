"use strict";

import { deepFreeze, cloneContractValue, canonicalizeHistoricalContractValue, sha256Hex, computeHistoricalDatasetHash } from './values.js';
import { HISTORICAL_TEMPORAL_CONVENTION_ID } from './schema.js';
import { contractError, validateHistoricalDataManifest, validateHistoricalDataset } from './validation.js';
import { buildHistoricalYearRecord } from './year-record.js';
import { preflightPeriod } from './period.js';
import { HISTORICAL_DATA, HISTORICAL_DATA_MANIFEST } from '../simulator-data.js';

const providerCache = new Map();

function buildValidatedRecordLookup(dataset, manifest) {
    const lookup = Object.create(null);
    const recordYears = [];
    for (const year of dataset.years) {
        const previous = dataset.rawLookup.get(year - 1);
        const current = dataset.rawLookup.get(year);
        if (!previous || !current) continue;
        const record = buildHistoricalYearRecord({ year, previous, current, manifest });
        lookup[year] = record;
        recordYears.push(year);
    }
    return {
        lookup: Object.freeze(lookup),
        recordYears: Object.freeze(recordYears)
    };
}

function notifyInstrumentation(instrumentation, method, payload) {
    if (typeof instrumentation?.[method] === 'function') instrumentation[method](payload);
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createHistoricalBacktestContractProvider({
    records = HISTORICAL_DATA,
    manifest = HISTORICAL_DATA_MANIFEST,
    instrumentation = null
} = {}) {
    validateHistoricalDataManifest(manifest);
    const manifestSnapshot = deepFreeze(cloneContractValue(manifest));
    const computedHash = computeHistoricalDatasetHash(records);
    if (computedHash !== manifestSnapshot.contentHash.value) {
        contractError('HISTORICAL_DATA_HASH_MISMATCH', 'Historical dataset does not match the manifested content hash', {
            expectedHash: manifestSnapshot.contentHash.value,
            actualHash: computedHash,
            revision: manifestSnapshot.revision
        });
    }
    const manifestHash = sha256Hex(canonicalizeHistoricalContractValue(manifestSnapshot));
    const cacheKey = `${manifestSnapshot.datasetId}:${manifestSnapshot.revision}:${computedHash}:${manifestHash}`;
    if (providerCache.has(cacheKey)) {
        notifyInstrumentation(instrumentation, 'onCacheHit', {
            cacheKey,
            revision: manifestSnapshot.revision,
            contentHash: computedHash
        });
        return providerCache.get(cacheKey);
    }

    notifyInstrumentation(instrumentation, 'onDatasetValidation', {
        cacheKey,
        revision: manifestSnapshot.revision,
        contentHash: computedHash
    });
    const dataset = validateHistoricalDataset(records, manifestSnapshot, computedHash);
    const validated = buildValidatedRecordLookup(dataset, manifestSnapshot);
    const lookbackYears = manifestSnapshot.lookback.backtestYears;
    const bounds = deepFreeze({
        startYear: manifestSnapshot.period.startYear + lookbackYears,
        endYear: manifestSnapshot.period.endYear,
        datasetStartYear: manifestSnapshot.period.startYear,
        datasetEndYear: manifestSnapshot.period.endYear,
        lookbackYears
    });
    const context = {
        manifest: manifestSnapshot,
        bounds,
        lookbackYears,
        rawYears: new Set(dataset.years),
        rawLookup: dataset.rawLookup,
        datasetYears: dataset.years,
        recordLookup: validated.lookup
    };

    const provider = Object.freeze({
        schemaVersion: 'HistoricalBacktestContractProviderV1',
        datasetId: manifestSnapshot.datasetId,
        revision: manifestSnapshot.revision,
        contentHash: computedHash,
        temporalConventionId: HISTORICAL_TEMPORAL_CONVENTION_ID,
        manifest: manifestSnapshot,
        bounds,
        getYears: () => validated.recordYears,
        getRecord: year => (Number.isInteger(Number(year)) ? validated.lookup[Number(year)] : undefined),
        preparePeriod(period, options = {}) {
            notifyInstrumentation(options.instrumentation, 'onPeriodPreflight', {
                mode: 'single_path',
                periods: [{ ...period }]
            });
            return preflightPeriod(period, context);
        },
        prepareBatch(periods, options = {}) {
            if (!Array.isArray(periods) || periods.length === 0) {
                contractError('HISTORICAL_PERIOD_INVALID', 'Cohort batch requires at least one period');
            }
            notifyInstrumentation(options.instrumentation, 'onPeriodPreflight', {
                mode: 'cohort_batch',
                periods: periods.map(period => ({ ...period }))
            });
            const validatedRecordYears = new Set();
            const prepared = periods.map(period => preflightPeriod(period, context, validatedRecordYears));
            const incomplete = prepared
                .map((result, batchIndex) => ({ result, batchIndex }))
                .filter(entry => entry.result.status !== 'complete')
                .map(entry => ({
                    batchIndex: entry.batchIndex,
                    period: entry.result.period,
                    reason: entry.result.reason
                }));
            const firstIncomplete = incomplete[0] || null;
            return deepFreeze({
                status: incomplete.length === 0 ? 'complete' : 'incomplete',
                periods: prepared,
                incomplete,
                ...(firstIncomplete || {})
            });
        }
    });
    providerCache.set(cacheKey, provider);
    return provider;
}
