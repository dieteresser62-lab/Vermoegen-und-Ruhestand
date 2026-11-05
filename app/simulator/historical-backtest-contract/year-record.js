"use strict";

import { deepFreeze } from './values.js';
import { HISTORICAL_YEAR_RECORD_SCHEMA_VERSION, HISTORICAL_TEMPORAL_CONVENTION_ID, QUALITY_STATUSES } from './schema.js';
import { contractError, validateHistoricalDataManifest, validateRawHistoricalRecord } from './validation.js';
import { yearInSegments, resolveQualityStatus, combineQualityStatuses, createObservation } from './observations.js';
import { HISTORICAL_DATA_MANIFEST } from '../simulator-data.js';

/**
 * @param options - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function buildHistoricalYearRecord({ year, current, previous, manifest = HISTORICAL_DATA_MANIFEST }) {
    validateHistoricalDataManifest(manifest);
    if (!Number.isInteger(year)) {
        contractError('HISTORICAL_YEAR_RECORD_INVALID', 'Historical year record requires an integer year', { year });
    }
    validateRawHistoricalRecord(current, year);
    validateRawHistoricalRecord(previous, year - 1);
    const series = manifest.series;
    const previousEquityQuality = resolveQualityStatus(series.global_equity_research_index, year - 1, previous.global_equity_research_index);
    const currentEquityQuality = resolveQualityStatus(series.global_equity_research_index, year, current.global_equity_research_index);
    const equityReturn = (current.global_equity_research_index / previous.global_equity_research_index) - 1;
    if (!Number.isFinite(equityReturn)) {
        contractError('HISTORICAL_DATA_FIELD_NON_FINITE', `Historical equity return for ${year} must be finite`, {
            year,
            seriesId: 'global_equity_research_index'
        });
    }

    const record = {
        schemaVersion: HISTORICAL_YEAR_RECORD_SCHEMA_VERSION,
        year,
        simulationYear: year,
        temporalConventionId: HISTORICAL_TEMPORAL_CONVENTION_ID,
        alignmentStatus: 'approved_d01',
        dataset: {
            datasetId: manifest.datasetId,
            revision: manifest.revision,
            contentHash: manifest.contentHash.value
        },
        realized: {
            equityReturn: createObservation({
                seriesId: 'global_equity_research_index',
                value: equityReturn,
                unit: 'ratio',
                sourceYear: year,
                asOfYear: year,
                qualityStatus: combineQualityStatuses(previousEquityQuality, currentEquityQuality),
                derivation: 'index_level_t_div_index_level_t_minus_1_minus_1',
                inputs: {
                    previousSourceYear: year - 1,
                    previousIndexLevel: previous.global_equity_research_index,
                    currentSourceYear: year,
                    currentIndexLevel: current.global_equity_research_index
                }
            }),
            goldReturn: createObservation({
                seriesId: 'gold_eur_perf',
                value: current.gold_eur_perf,
                unit: series.gold_eur_perf.unit,
                sourceYear: year,
                asOfYear: year,
                qualityStatus: resolveQualityStatus(series.gold_eur_perf, year, current.gold_eur_perf),
                derivation: 'embedded_value_t'
            }),
            cashBondReturn: createObservation({
                seriesId: 'zinssatz_de',
                value: current.zinssatz_de,
                unit: series.zinssatz_de.unit,
                sourceYear: year,
                asOfYear: year,
                qualityStatus: resolveQualityStatus(series.zinssatz_de, year, current.zinssatz_de),
                derivation: 'embedded_value_t'
            }),
            inflation: createObservation({
                seriesId: 'inflation_de',
                value: current.inflation_de,
                unit: series.inflation_de.unit,
                sourceYear: year,
                asOfYear: year,
                qualityStatus: resolveQualityStatus(series.inflation_de, year, current.inflation_de),
                derivation: 'embedded_value_t'
            }),
            wagePensionAdjustment: createObservation({
                seriesId: 'lohn_de',
                value: current.lohn_de,
                unit: series.lohn_de.unit,
                sourceYear: year,
                asOfYear: year,
                qualityStatus: resolveQualityStatus(series.lohn_de, year, current.lohn_de),
                derivation: 'embedded_value_t'
            })
        },
        decisionAsOf: {
            capeRatio: createObservation({
                seriesId: 'cape',
                value: current.cape,
                unit: series.cape.unit,
                sourceYear: year - 1,
                asOfYear: year - 1,
                observationYear: year - 1,
                observationMonth: 12,
                decisionYear: year,
                qualityStatus: resolveQualityStatus(series.cape, year, current.cape),
                derivation: 'generated_december_t_minus_1_decision_signal'
            })
        }
    };
    validateHistoricalYearRecord(record, manifest);
    return deepFreeze(record);
}

const REQUIRED_OBSERVATIONS = Object.freeze([
    Object.freeze({ section: 'realized', field: 'equityReturn', expectedSeriesId: 'global_equity_research_index' }),
    Object.freeze({ section: 'realized', field: 'goldReturn', expectedSeriesId: 'gold_eur_perf' }),
    Object.freeze({ section: 'realized', field: 'cashBondReturn', expectedSeriesId: 'zinssatz_de' }),
    Object.freeze({ section: 'realized', field: 'inflation', expectedSeriesId: 'inflation_de' }),
    Object.freeze({ section: 'realized', field: 'wagePensionAdjustment', expectedSeriesId: 'lohn_de' }),
    Object.freeze({ section: 'decisionAsOf', field: 'capeRatio', expectedSeriesId: 'cape' })
]);

/**
 * @param record - Kontext für record.
 * @param [manifest] - Kontext für manifest.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateHistoricalYearRecord(record, manifest = HISTORICAL_DATA_MANIFEST) {
    validateHistoricalDataManifest(manifest);
    if (!record || typeof record !== 'object' || record.schemaVersion !== HISTORICAL_YEAR_RECORD_SCHEMA_VERSION) {
        contractError('HISTORICAL_YEAR_RECORD_INVALID', 'Unsupported or missing HistoricalYearRecord schema', {
            schemaVersion: record?.schemaVersion
        });
    }
    if (!Number.isInteger(record.year)) {
        contractError('HISTORICAL_YEAR_RECORD_INVALID', 'HistoricalYearRecord.year must be an integer', { year: record.year });
    }
    if (record.simulationYear !== record.year) {
        contractError('HISTORICAL_TEMPORAL_ALIGNMENT_INVALID', 'HistoricalYearRecord.simulationYear must match year', {
            year: record.year,
            simulationYear: record.simulationYear
        });
    }
    if (record.temporalConventionId !== HISTORICAL_TEMPORAL_CONVENTION_ID
        || record.alignmentStatus !== 'approved_d01') {
        contractError('HISTORICAL_TEMPORAL_ALIGNMENT_INVALID', 'HistoricalYearRecord does not use the approved D-01 convention', {
            year: record.year,
            temporalConventionId: record.temporalConventionId,
            alignmentStatus: record.alignmentStatus
        });
    }
    for (const definition of REQUIRED_OBSERVATIONS) {
        const observation = record[definition.section]?.[definition.field];
        const path = `${definition.section}.${definition.field}`;
        if (!observation || typeof observation !== 'object') {
            contractError('HISTORICAL_YEAR_RECORD_FIELD_MISSING', `HistoricalYearRecord is missing ${path}`, {
                year: record.year,
                path
            });
        }
        if (observation.seriesId !== definition.expectedSeriesId) {
            contractError('HISTORICAL_YEAR_RECORD_INVALID', `${path}.seriesId does not match the contract`, {
                year: record.year,
                path,
                seriesId: observation.seriesId,
                expectedSeriesId: definition.expectedSeriesId
            });
        }
        if (!Number.isFinite(observation.value)) {
            contractError('HISTORICAL_YEAR_RECORD_NON_FINITE', `${path}.value must be finite`, {
                year: record.year,
                path,
                value: observation.value
            });
        }
        if (!Number.isInteger(observation.sourceYear) || !Number.isInteger(observation.asOfYear)) {
            contractError('HISTORICAL_YEAR_RECORD_INVALID', `${path} requires integer sourceYear and asOfYear`, {
                year: record.year,
                path
            });
        }
        if (!QUALITY_STATUSES.has(observation.qualityStatus)) {
            contractError('HISTORICAL_YEAR_RECORD_INVALID', `${path} has an unsupported quality status`, {
                year: record.year,
                path,
                qualityStatus: observation.qualityStatus
            });
        }
        if (observation.qualityStatus === 'missing') {
            contractError('HISTORICAL_YEAR_RECORD_MISSING', `${path} is marked missing`, {
                year: record.year,
                path,
                seriesId: observation.seriesId
            });
        }
        if (observation.qualityStatus === 'fallback_zero') {
            const allowedSegments = manifest.series[observation.seriesId].missingness.fallbackZeroSegments;
            if (observation.value !== 0 || !yearInSegments(observation.sourceYear, allowedSegments)) {
                contractError('HISTORICAL_FALLBACK_ZERO_NOT_MANIFESTED', `${path} uses fallback_zero outside a manifested segment`, {
                    year: record.year,
                    path,
                    seriesId: observation.seriesId,
                    sourceYear: observation.sourceYear
                });
            }
        }
    }
    for (const field of ['equityReturn', 'goldReturn', 'cashBondReturn', 'inflation', 'wagePensionAdjustment']) {
        const observation = record.realized[field];
        if (observation.sourceYear !== record.simulationYear || observation.asOfYear !== record.simulationYear) {
            contractError('HISTORICAL_TEMPORAL_ALIGNMENT_INVALID', `realized.${field} must be assigned to simulation year t`, {
                year: record.year,
                path: `realized.${field}`,
                sourceYear: observation.sourceYear,
                asOfYear: observation.asOfYear,
                expectedYear: record.simulationYear
            });
        }
    }
    const capeObservation = record.decisionAsOf.capeRatio;
    const latestDecisionYear = record.simulationYear - 1;
    if (capeObservation.sourceYear !== latestDecisionYear
        || capeObservation.asOfYear !== latestDecisionYear
        || capeObservation.observationYear !== latestDecisionYear
        || capeObservation.observationMonth !== 12
        || capeObservation.decisionYear !== record.simulationYear
        || capeObservation.asOfYear >= record.simulationYear) {
        contractError('HISTORICAL_TEMPORAL_LOOKAHEAD', 'decisionAsOf.capeRatio must expose the December t-1 observation used for decision year t', {
            year: record.year,
            sourceYear: capeObservation.sourceYear,
            asOfYear: capeObservation.asOfYear,
            observationYear: capeObservation.observationYear,
            observationMonth: capeObservation.observationMonth,
            decisionYear: capeObservation.decisionYear,
            latestDecisionYear
        });
    }
    const equityInputs = record.realized.equityReturn.inputs;
    if (!equityInputs
        || !Number.isFinite(equityInputs.previousIndexLevel)
        || !Number.isFinite(equityInputs.currentIndexLevel)
        || equityInputs.previousIndexLevel <= 0
        || equityInputs.currentIndexLevel <= 0) {
        contractError('HISTORICAL_INDEX_LEVEL_INVALID', 'HistoricalYearRecord equity index levels must be finite and greater than zero', {
            year: record.year
        });
    }
    if (equityInputs.previousSourceYear !== record.simulationYear - 1
        || equityInputs.currentSourceYear !== record.simulationYear) {
        contractError('HISTORICAL_TEMPORAL_ALIGNMENT_INVALID', 'Historical equity return endpoints must be t-1 and t', {
            year: record.year,
            previousSourceYear: equityInputs.previousSourceYear,
            currentSourceYear: equityInputs.currentSourceYear
        });
    }
    if (record.decisionAsOf.capeRatio.value <= 0) {
        contractError('HISTORICAL_INDEX_LEVEL_INVALID', 'HistoricalYearRecord CAPE ratio must be greater than zero', {
            year: record.year,
            seriesId: 'cape'
        });
    }
    return record;
}
