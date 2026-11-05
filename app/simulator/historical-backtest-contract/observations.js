"use strict";

import { deepFreeze } from './values.js';

export function yearInSegments(year, segments) {
    return segments.some(segment => year >= segment.startYear && year <= segment.endYear);
}

export function resolveQualityStatus(series, year, value) {
    if (value === 0 && yearInSegments(year, series.missingness.fallbackZeroSegments)) return 'fallback_zero';
    if (value === 0 && series.missingness.zeroValuePolicy === 'unresolved_if_zero') return 'unresolved';
    if (yearInSegments(year, series.estimatedSegments)) return 'estimated';
    return 'present';
}

export function combineQualityStatuses(...statuses) {
    const priority = { present: 0, estimated: 1, fallback_zero: 2, unresolved: 3, missing: 4 };
    return statuses.reduce((selected, status) => (
        priority[status] > priority[selected] ? status : selected
    ), 'present');
}

/** @param {{seriesId: string; value: unknown; unit: string; sourceYear: number | string; asOfYear: number | string;
 * observationYear?: number; observationMonth?: number; decisionYear?: number; qualityStatus: string; derivation: string; inputs?: object}} options */
export function createObservation({
    seriesId,
    value,
    unit,
    sourceYear,
    asOfYear,
    observationYear,
    observationMonth,
    decisionYear,
    qualityStatus,
    derivation,
    inputs
}) {
    return deepFreeze({
        seriesId,
        value,
        unit,
        sourceYear,
        asOfYear,
        ...(observationYear === undefined ? {} : { observationYear }),
        ...(observationMonth === undefined ? {} : { observationMonth }),
        ...(decisionYear === undefined ? {} : { decisionYear }),
        qualityStatus,
        derivation,
        ...(inputs ? { inputs } : {})
    });
}
