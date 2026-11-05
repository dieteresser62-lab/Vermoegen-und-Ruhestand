// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

export function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    return Object.freeze(value);
}

export function resolved(value) {
    return { status: 'known', value };
}

export function unresolved() {
    return { status: 'unresolved', value: null };
}

export function notApplicable() {
    return { status: 'not_applicable', value: null };
}

export function historicalSeries({
    id,
    label,
    unit,
    currency,
    transformation,
    embeddedValueHash,
    qualitySegments,
    discontinuities = [],
    evidenceClass = 'unresolved',
    implementationLocations = [`app/simulator/simulator-data.js:HISTORICAL_DATA.*.${id}`],
    source = unresolved(),
    seriesIdentifier = unresolved(),
    yearConvention = unresolved(),
    license = unresolved(),
    retrievedAt = unresolved(),
    rawDataHash = unresolved(),
    externalValidationStatus = 'unresolved'
}) {
    return {
        id,
        category: 'historical_series',
        label,
        evidenceClass,
        implementationLocations,
        source,
        seriesIdentifier,
        unit,
        currency,
        yearConvention,
        transformation: resolved(transformation),
        license,
        retrievedAt,
        rawDataHash,
        embeddedValueHash: resolved(embeddedValueHash),
        externalValidationStatus,
        qualitySegments,
        discontinuities
    };
}

/** @param {AnalysisTypes.StaticInventoryEntryInput} options */
export function staticEntry({
    id,
    category,
    label,
    evidenceClass,
    implementationLocations,
    unit,
    embeddedValueHash,
    source = notApplicable(),
    seriesIdentifier = notApplicable(),
    currency = notApplicable(),
    yearConvention = notApplicable(),
    transformation = notApplicable(),
    license = notApplicable(),
    retrievedAt = notApplicable(),
    rawDataHash = notApplicable(),
    externalValidationStatus = 'not_validated',
    contractValue
}) {
    return {
        id,
        category,
        label,
        evidenceClass,
        implementationLocations,
        source,
        seriesIdentifier,
        unit,
        currency,
        yearConvention,
        transformation,
        license,
        retrievedAt,
        rawDataHash,
        embeddedValueHash,
        externalValidationStatus,
        ...(contractValue === undefined ? {} : { contractValue })
    };
}
