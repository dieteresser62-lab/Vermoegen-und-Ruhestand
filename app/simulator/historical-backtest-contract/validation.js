"use strict";

import { HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION, REQUIRED_SERIES_IDS, RESOLUTION_STATUSES } from './schema.js';
import { HISTORICAL_DATA_MANIFEST } from '../simulator-data.js';

export class HistoricalDataContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'HistoricalDataContractError';
        this.code = code;
        this.details = details && typeof details === 'object' ? details : {};
    }
}

export function contractError(code, message, details = {}) {
    throw new HistoricalDataContractError(code, message, details);
}

function requireNonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        contractError('HISTORICAL_MANIFEST_INVALID', `${path} must be a non-empty string`, { path });
    }
}

function validateResolutionField(value, path) {
    if (!value || typeof value !== 'object' || !RESOLUTION_STATUSES.has(value.status)) {
        contractError('HISTORICAL_MANIFEST_INVALID', `${path} requires a supported resolution status`, { path });
    }
    if (value.status === 'known') {
        requireNonEmptyString(value.value, `${path}.value`);
    } else if (value.value !== null) {
        contractError('HISTORICAL_MANIFEST_INVALID', `${path}.value must be null when status is ${value.status}`, { path });
    }
}

export function validatePeriodShape(period, path) {
    const startYear = period?.startYear;
    const endYear = period?.endYear;
    if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || !Number.isInteger(startYear) || !Number.isInteger(endYear)) {
        contractError('HISTORICAL_PERIOD_INVALID', `${path} requires finite integer startYear and endYear`, {
            path,
            startYear,
            endYear
        });
    }
    if (startYear > endYear) {
        contractError('HISTORICAL_PERIOD_INVALID', `${path}.startYear must not exceed endYear`, {
            path,
            startYear,
            endYear
        });
    }
    return { startYear, endYear };
}

function validateSegments(segments, path, outerPeriod) {
    if (!Array.isArray(segments)) {
        contractError('HISTORICAL_MANIFEST_INVALID', `${path} must be an array`, { path });
    }
    for (let index = 0; index < segments.length; index++) {
        const segment = validatePeriodShape(segments[index], `${path}[${index}]`);
        if (segment.startYear < outerPeriod.startYear || segment.endYear > outerPeriod.endYear) {
            contractError('HISTORICAL_MANIFEST_INVALID', `${path}[${index}] lies outside the series period`, {
                path: `${path}[${index}]`,
                segment,
                outerPeriod
            });
        }
    }
}

function validateDiscontinuities(discontinuities, path, outerPeriod) {
    if (!Array.isArray(discontinuities)) {
        contractError('HISTORICAL_MANIFEST_INVALID', `${path} must be an array`, { path });
    }
    let previousYear = outerPeriod.startYear - 1;
    for (let index = 0; index < discontinuities.length; index++) {
        const discontinuity = discontinuities[index];
        const itemPath = `${path}[${index}]`;
        if (!Number.isInteger(discontinuity?.year)
            || discontinuity.year < outerPeriod.startYear
            || discontinuity.year > outerPeriod.endYear
            || discontinuity.year <= previousYear) {
            contractError('HISTORICAL_MANIFEST_INVALID', `${itemPath}.year must be unique and ascending within the series period`, {
                path: `${itemPath}.year`,
                previousYear,
                discontinuity,
                outerPeriod
            });
        }
        requireNonEmptyString(discontinuity.type, `${itemPath}.type`);
        requireNonEmptyString(discontinuity.note, `${itemPath}.note`);
        previousYear = discontinuity.year;
    }
}

/**
 * @param [manifest] - Kontext für manifest.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateHistoricalDataManifest(manifest = HISTORICAL_DATA_MANIFEST) {
    if (!manifest || typeof manifest !== 'object') {
        contractError('HISTORICAL_MANIFEST_INVALID', 'Historical data manifest must be an object');
    }
    if (manifest.schemaVersion !== HISTORICAL_DATA_MANIFEST_SCHEMA_VERSION) {
        contractError('HISTORICAL_MANIFEST_INVALID', 'Unsupported historical data manifest schema', {
            schemaVersion: manifest.schemaVersion
        });
    }
    requireNonEmptyString(manifest.datasetId, 'manifest.datasetId');
    requireNonEmptyString(manifest.revision, 'manifest.revision');
    const datasetPeriod = validatePeriodShape(manifest.period, 'manifest.period');
    if (!Number.isInteger(manifest.lookback?.backtestYears) || manifest.lookback.backtestYears < 1) {
        contractError('HISTORICAL_MANIFEST_INVALID', 'manifest.lookback.backtestYears must be a positive integer', {
            path: 'manifest.lookback.backtestYears'
        });
    }
    requireNonEmptyString(manifest.lookback.reason, 'manifest.lookback.reason');
    if (manifest.contentHash?.algorithm !== 'sha256-canonical-json-v1'
        || typeof manifest.contentHash?.value !== 'string'
        || !/^[a-f0-9]{64}$/.test(manifest.contentHash.value)) {
        contractError('HISTORICAL_MANIFEST_INVALID', 'Manifest requires a canonical SHA-256 content hash', {
            path: 'manifest.contentHash'
        });
    }
    requireNonEmptyString(manifest.documentation, 'manifest.documentation');

    for (const seriesId of REQUIRED_SERIES_IDS) {
        const series = manifest.series?.[seriesId];
        if (!series || typeof series !== 'object' || series.id !== seriesId) {
            contractError('HISTORICAL_MANIFEST_INVALID', `Missing manifest series ${seriesId}`, { seriesId });
        }
        requireNonEmptyString(series.label, `manifest.series.${seriesId}.label`);
        requireNonEmptyString(series.unit, `manifest.series.${seriesId}.unit`);
        validateResolutionField(series.variant, `manifest.series.${seriesId}.variant`);
        validateResolutionField(series.currency, `manifest.series.${seriesId}.currency`);
        validateResolutionField(series.region, `manifest.series.${seriesId}.region`);
        validateResolutionField(series.frequency, `manifest.series.${seriesId}.frequency`);
        validateResolutionField(series.source, `manifest.series.${seriesId}.source`);
        validateResolutionField(series.license, `manifest.series.${seriesId}.license`);
        validateResolutionField(series.transformation, `manifest.series.${seriesId}.transformation`);
        const seriesPeriod = validatePeriodShape(series.period, `manifest.series.${seriesId}.period`);
        if (seriesPeriod.startYear !== datasetPeriod.startYear || seriesPeriod.endYear !== datasetPeriod.endYear) {
            contractError('HISTORICAL_MANIFEST_INVALID', `Series ${seriesId} period must match dataset period`, {
                seriesId,
                seriesPeriod,
                datasetPeriod
            });
        }
        validateSegments(series.estimatedSegments, `manifest.series.${seriesId}.estimatedSegments`, seriesPeriod);
        validateDiscontinuities(series.discontinuities, `manifest.series.${seriesId}.discontinuities`, seriesPeriod);
        if (series.missingness?.required !== true || series.missingness.rule !== 'reject_missing_or_non_finite') {
            contractError('HISTORICAL_MANIFEST_INVALID', `Series ${seriesId} must declare the required missingness rule`, {
                seriesId
            });
        }
        validateSegments(
            series.missingness.fallbackZeroSegments,
            `manifest.series.${seriesId}.missingness.fallbackZeroSegments`,
            seriesPeriod
        );
        if (!['literal_value', 'unresolved_if_zero'].includes(series.missingness.zeroValuePolicy)) {
            contractError('HISTORICAL_MANIFEST_INVALID', `Series ${seriesId} has an unsupported zero-value policy`, {
                seriesId,
                zeroValuePolicy: series.missingness.zeroValuePolicy
            });
        }
        requireNonEmptyString(series.revision, `manifest.series.${seriesId}.revision`);
    }
    return manifest;
}

function extractHistoricalYears(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
        contractError('HISTORICAL_DATASET_INVALID', 'Historical dataset must be an object keyed by integer years');
    }
    const seen = new Set();
    const years = [];
    for (const key of Object.keys(records)) {
        if (!/^-?\d+$/.test(key)) {
            contractError('HISTORICAL_DATASET_INVALID', 'Historical dataset contains a non-integer year key', { key });
        }
        const year = Number(key);
        if (!Number.isSafeInteger(year)) {
            contractError('HISTORICAL_DATASET_INVALID', 'Historical dataset contains an unsafe year key', { key });
        }
        if (seen.has(year)) {
            contractError('HISTORICAL_DATASET_DUPLICATE_YEAR', `Historical dataset contains duplicate year ${year}`, { year });
        }
        seen.add(year);
        years.push(year);
    }
    years.sort((left, right) => left - right);
    return years;
}

export function validateRawHistoricalRecord(record, year) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        contractError('HISTORICAL_DATA_RECORD_INVALID', `Historical record ${year} must be an object`, { year });
    }
    for (const seriesId of REQUIRED_SERIES_IDS) {
        if (!Object.prototype.hasOwnProperty.call(record, seriesId)) {
            contractError('HISTORICAL_DATA_FIELD_MISSING', `Historical record ${year} is missing ${seriesId}`, {
                year,
                seriesId
            });
        }
        if (!Number.isFinite(record[seriesId])) {
            contractError('HISTORICAL_DATA_FIELD_NON_FINITE', `Historical record ${year}.${seriesId} must be finite`, {
                year,
                seriesId,
                value: record[seriesId]
            });
        }
    }
    if (record.global_equity_research_index <= 0) {
        contractError('HISTORICAL_INDEX_LEVEL_INVALID', `Historical record ${year}.global_equity_research_index must be greater than zero`, {
            year,
            seriesId: 'global_equity_research_index',
            value: record.global_equity_research_index
        });
    }
    if (record.cape <= 0) {
        contractError('HISTORICAL_INDEX_LEVEL_INVALID', `Historical record ${year}.cape must be greater than zero`, {
            year,
            seriesId: 'cape',
            value: record.cape
        });
    }
}

export function validateHistoricalDataset(records, manifest, computedHash) {
    if (computedHash !== manifest.contentHash.value) {
        contractError('HISTORICAL_DATA_HASH_MISMATCH', 'Historical dataset does not match the manifested content hash', {
            expectedHash: manifest.contentHash.value,
            actualHash: computedHash,
            revision: manifest.revision
        });
    }
    const years = extractHistoricalYears(records);
    if (years.length === 0) {
        contractError('HISTORICAL_DATASET_INVALID', 'Historical dataset must not be empty');
    }
    if (years[0] !== manifest.period.startYear || years[years.length - 1] !== manifest.period.endYear) {
        contractError('HISTORICAL_DATASET_INVALID', 'Historical dataset boundary years do not match the manifest', {
            actualStartYear: years[0],
            actualEndYear: years[years.length - 1],
            expectedPeriod: manifest.period
        });
    }
    const rawLookup = new Map();
    for (const year of years) {
        const record = records[String(year)];
        validateRawHistoricalRecord(record, year);
        rawLookup.set(year, record);
    }
    return { years, rawLookup };
}
