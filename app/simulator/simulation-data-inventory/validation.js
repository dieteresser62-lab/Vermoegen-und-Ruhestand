// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { RESOLUTION_STATUSES, EVIDENCE_CLASSES, REQUIRED_RESOLUTION_FIELDS, EXTERNAL_VALIDATION_STATUSES, EXTERNAL_GATE_FIELDS, SIMULATION_DATA_INVENTORY_SCHEMA_VERSION, REQUIRED_HISTORICAL_SERIES, REQUIRED_STATIC_CATEGORIES } from './schema.js';
import { SIMULATION_DATA_INVENTORY } from './inventory.js';

export class SimulationDataInventoryError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'SimulationDataInventoryError';
        this.code = code;
        this.details = details;
    }
}

export function inventoryError(code, message, details = {}) {
    throw new SimulationDataInventoryError(code, message, details);
}

function requireNonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        inventoryError('SIMULATION_DATA_INVENTORY_INVALID', `${path} must be a non-empty string`, { path });
    }
}

function validateResolutionField(field, path) {
    if (!field || typeof field !== 'object' || !RESOLUTION_STATUSES.has(field.status)) {
        inventoryError('SIMULATION_DATA_INVENTORY_INVALID', `${path} has no supported resolution status`, { path });
    }
    if (field.status === 'known') {
        if (field.value === null || field.value === undefined || field.value === '') {
            inventoryError('SIMULATION_DATA_INVENTORY_INVALID', `${path}.value must be populated when known`, { path });
        }
    } else if (field.value !== null) {
        inventoryError('SIMULATION_DATA_INVENTORY_INVALID', `${path}.value must be null when ${field.status}`, { path });
    }
}

function validateEntry(entry, path) {
    if (!entry || typeof entry !== 'object') {
        inventoryError('SIMULATION_DATA_INVENTORY_INVALID', `${path} must be an object`, { path });
    }
    requireNonEmptyString(entry.id, `${path}.id`);
    requireNonEmptyString(entry.category, `${path}.category`);
    requireNonEmptyString(entry.label, `${path}.label`);
    requireNonEmptyString(entry.unit, `${path}.unit`);
    if (!EVIDENCE_CLASSES.has(entry.evidenceClass)) {
        inventoryError('SIMULATION_DATA_EVIDENCE_CLASS_INVALID', `${path}.evidenceClass is unsupported`, {
            path,
            evidenceClass: entry.evidenceClass
        });
    }
    if (!Array.isArray(entry.implementationLocations) || entry.implementationLocations.length === 0) {
        inventoryError('SIMULATION_DATA_COVERAGE_MISSING', `${path} requires implementation locations`, { path });
    }
    for (const [index, location] of entry.implementationLocations.entries()) {
        requireNonEmptyString(location, `${path}.implementationLocations[${index}]`);
    }
    for (const fieldName of REQUIRED_RESOLUTION_FIELDS) {
        validateResolutionField(entry[fieldName], `${path}.${fieldName}`);
    }
    for (const hashFieldName of ['rawDataHash', 'embeddedValueHash']) {
        const hashField = entry[hashFieldName];
        if (hashField.status === 'known'
            && (typeof hashField.value !== 'string' || !/^[a-f0-9]{64}$/.test(hashField.value))) {
            inventoryError('SIMULATION_DATA_HASH_INVALID', `${path}.${hashFieldName} must use a lowercase SHA-256 hex value`, {
                path,
                hashFieldName,
                hash: hashField.value
            });
        }
    }
    if (!EXTERNAL_VALIDATION_STATUSES.has(entry.externalValidationStatus)) {
        inventoryError('SIMULATION_DATA_EXTERNAL_STATUS_INVALID', `${path}.externalValidationStatus is unsupported`, {
            path,
            externalValidationStatus: entry.externalValidationStatus
        });
    }
    if (entry.externalValidationStatus === 'externally_validated') {
        const unresolvedFields = EXTERNAL_GATE_FIELDS.filter(fieldName => entry[fieldName].status !== 'known');
        if (unresolvedFields.length > 0
            || ['model_assumption', 'user_input', 'stress_parameter', 'missing', 'unresolved'].includes(entry.evidenceClass)) {
            inventoryError(
                'SIMULATION_DATA_EXTERNAL_VALIDATION_UNPROVEN',
                `${path} cannot claim external validation`,
                { path, unresolvedFields, evidenceClass: entry.evidenceClass }
            );
        }
    }
}

function validateQualitySegments(series, path) {
    if (!Array.isArray(series.qualitySegments) || series.qualitySegments.length === 0) {
        inventoryError('SIMULATION_DATA_QUALITY_SEGMENTS_MISSING', `${path}.qualitySegments must not be empty`, { path });
    }
    let expectedStartYear = 1925;
    for (let index = 0; index < series.qualitySegments.length; index++) {
        const segment = series.qualitySegments[index];
        const segmentPath = `${path}.qualitySegments[${index}]`;
        if (!Number.isInteger(segment.startYear) || !Number.isInteger(segment.endYear)
            || segment.startYear !== expectedStartYear || segment.endYear < segment.startYear) {
            inventoryError(
                'SIMULATION_DATA_QUALITY_SEGMENTS_INVALID',
                `${segmentPath} must provide contiguous ordered coverage`,
                { segmentPath, expectedStartYear, segment }
            );
        }
        if (!EVIDENCE_CLASSES.has(segment.evidenceClass)) {
            inventoryError('SIMULATION_DATA_EVIDENCE_CLASS_INVALID', `${segmentPath}.evidenceClass is unsupported`, {
                segmentPath,
                evidenceClass: segment.evidenceClass
            });
        }
        requireNonEmptyString(segment.note, `${segmentPath}.note`);
        expectedStartYear = segment.endYear + 1;
    }
    if (expectedStartYear !== 2026) {
        inventoryError('SIMULATION_DATA_QUALITY_SEGMENTS_INVALID', `${path}.qualitySegments must cover through 2025`, {
            path,
            lastCoveredYear: expectedStartYear - 1
        });
    }
}

function validateDiscontinuities(series, path) {
    if (!Array.isArray(series.discontinuities)) {
        inventoryError('SIMULATION_DATA_DISCONTINUITIES_INVALID', `${path}.discontinuities must be an array`, { path });
    }
    let previousYear = 1924;
    for (let index = 0; index < series.discontinuities.length; index++) {
        const discontinuity = series.discontinuities[index];
        const discontinuityPath = `${path}.discontinuities[${index}]`;
        if (!Number.isInteger(discontinuity?.year)
            || discontinuity.year < 1925
            || discontinuity.year > 2025
            || discontinuity.year <= previousYear) {
            inventoryError('SIMULATION_DATA_DISCONTINUITIES_INVALID', `${discontinuityPath}.year must be unique and ascending within the historical period`, {
                discontinuityPath,
                previousYear,
                discontinuity
            });
        }
        requireNonEmptyString(discontinuity.type, `${discontinuityPath}.type`);
        requireNonEmptyString(discontinuity.note, `${discontinuityPath}.note`);
        previousYear = discontinuity.year;
    }
}

/**
 * @param [inventory] - Kontext für inventory.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateSimulationDataInventory(inventory = SIMULATION_DATA_INVENTORY) {
    if (!inventory || typeof inventory !== 'object'
        || inventory.schemaVersion !== SIMULATION_DATA_INVENTORY_SCHEMA_VERSION) {
        inventoryError('SIMULATION_DATA_INVENTORY_INVALID', 'Unsupported or missing simulation data inventory schema', {
            schemaVersion: inventory?.schemaVersion
        });
    }
    requireNonEmptyString(inventory.inventoryId, 'inventory.inventoryId');
    requireNonEmptyString(inventory.revision, 'inventory.revision');
    requireNonEmptyString(inventory.documentation, 'inventory.documentation');

    for (const seriesId of REQUIRED_HISTORICAL_SERIES) {
        const series = inventory.historicalSeries?.[seriesId];
        validateEntry(series, `inventory.historicalSeries.${seriesId}`);
        if (series.id !== seriesId || series.category !== 'historical_series') {
            inventoryError('SIMULATION_DATA_HISTORICAL_SERIES_INVALID', `Historical series ${seriesId} has inconsistent identity`, {
                seriesId,
                id: series.id,
                category: series.category
            });
        }
        validateQualitySegments(series, `inventory.historicalSeries.${seriesId}`);
        validateDiscontinuities(series, `inventory.historicalSeries.${seriesId}`);
    }

    const staticEntries = Object.values(inventory.staticData || {});
    const seenIds = new Set(REQUIRED_HISTORICAL_SERIES);
    for (const entry of staticEntries) {
        validateEntry(entry, `inventory.staticData.${entry?.id || 'unknown'}`);
        if (seenIds.has(entry.id)) {
            inventoryError('SIMULATION_DATA_DUPLICATE_ID', `Duplicate inventory ID ${entry.id}`, { id: entry.id });
        }
        seenIds.add(entry.id);
    }
    const presentCategories = new Set(staticEntries.map(entry => entry.category));
    const missingCategories = REQUIRED_STATIC_CATEGORIES.filter(category => !presentCategories.has(category));
    if (missingCategories.length > 0) {
        inventoryError('SIMULATION_DATA_STATIC_CATEGORY_MISSING', 'Static data inventory is incomplete', {
            missingCategories
        });
    }

    if (inventory.gates?.unresolvedMayRunReproducibly !== true
        || inventory.gates?.unresolvedMayClaimExternalValidation !== false
        || inventory.gates?.unresolvedMayReplacePackagedData !== false) {
        inventoryError('SIMULATION_DATA_GATE_INVALID', 'Inventory unresolved gates must fail closed for external claims and replacement');
    }
    return inventory;
}
