"use strict";

import { deepFreeze } from './values.js';
import { HISTORICAL_TEMPORAL_CONVENTION_ID } from './schema.js';
import { validatePeriodShape } from './validation.js';
import { resolveQualityStatus, createObservation } from './observations.js';
import { validateHistoricalYearRecord } from './year-record.js';

function createIncomplete(period, code, details = {}) {
    return deepFreeze({
        status: 'incomplete',
        period: { ...period },
        reason: { code, ...details }
    });
}

function buildInitialMarketHistory(startYear, context) {
    const levelDefinitions = [
        ['endeVJ', startYear - 1],
        ['endeVJ_1', startYear - 2],
        ['endeVJ_2', startYear - 3],
        ['endeVJ_3', startYear - 4]
    ];
    const equitySeries = context.manifest.series.global_equity_research_index;
    const levels = Object.fromEntries(levelDefinitions.map(([field, sourceYear]) => {
        const value = context.rawLookup.get(sourceYear)?.global_equity_research_index;
        return [field, createObservation({
            seriesId: 'global_equity_research_index',
            value,
            unit: equitySeries.unit,
            sourceYear,
            asOfYear: sourceYear,
            qualityStatus: resolveQualityStatus(equitySeries, sourceYear, value),
            derivation: `initial_market_history_${field}`
        })];
    }));
    const priorLevels = context.datasetYears
        .filter(year => year < startYear)
        .map(year => ({ year, value: context.rawLookup.get(year).global_equity_research_index }));
    const allTimeHigh = priorLevels.reduce((selected, candidate) => (
        candidate.value >= selected.value ? candidate : selected
    ), priorLevels[0]);
    return deepFreeze({
        schemaVersion: 'HistoricalInitialMarketHistoryV1',
        temporalConventionId: HISTORICAL_TEMPORAL_CONVENTION_ID,
        asOfYear: startYear - 1,
        levels,
        allTimeHigh: createObservation({
            seriesId: 'global_equity_research_index',
            value: allTimeHigh.value,
            unit: equitySeries.unit,
            sourceYear: allTimeHigh.year,
            asOfYear: startYear - 1,
            qualityStatus: resolveQualityStatus(equitySeries, allTimeHigh.year, allTimeHigh.value),
            derivation: 'maximum_index_level_through_t_minus_1'
        }),
        yearsSinceAllTimeHigh: 0,
        yearsSinceAllTimeHighPolicy: 'legacy_zero_preserved_until_regime_contract_slice'
    });
}

export function preflightPeriod(periodInput, context, validatedRecordYears = null) {
    const period = validatePeriodShape(periodInput, 'period');
    if (period.startYear < context.bounds.startYear || period.endYear > context.bounds.endYear) {
        return createIncomplete(period, 'period_out_of_bounds', { bounds: context.bounds });
    }
    for (let year = period.startYear - context.lookbackYears; year <= period.endYear; year++) {
        if (!context.rawYears.has(year)) {
            return createIncomplete(period, 'missing_historical_year', {
                year,
                phase: year < period.startYear ? 'lookback' : 'requested_period'
            });
        }
    }
    const records = [];
    for (let year = period.startYear; year <= period.endYear; year++) {
        const record = context.recordLookup[year];
        if (!record) {
            return createIncomplete(period, 'missing_historical_year_record', { year });
        }
        if (!validatedRecordYears || !validatedRecordYears.has(year)) {
            validateHistoricalYearRecord(record, context.manifest);
            validatedRecordYears?.add(year);
        }
        records.push(record);
    }
    return deepFreeze({
        status: 'complete',
        period,
        requestedYears: period.endYear - period.startYear + 1,
        lookbackYears: context.lookbackYears,
        temporalConventionId: HISTORICAL_TEMPORAL_CONVENTION_ID,
        initialMarketHistory: buildInitialMarketHistory(period.startYear, context),
        records
    });
}
