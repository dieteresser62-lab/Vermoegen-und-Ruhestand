"use strict";

import { deepFreeze } from './run-values.js';

export function requireFunction(value, name) {
    if (typeof value !== 'function') {
        throw new TypeError(`runHistoricalBacktest requires ${name} to be a function`);
    }
    return value;
}

export function prepareHistoricalPeriod(provider, period) {
    if (!provider || typeof provider !== 'object') {
        throw new TypeError('runHistoricalBacktest requires a historicalDataProvider');
    }
    const preparePeriod = requireFunction(provider.preparePeriod, 'historicalDataProvider.preparePeriod');
    const prepared = preparePeriod(period);
    if (!prepared || !['complete', 'incomplete'].includes(prepared.status)) {
        throw new TypeError('historicalDataProvider.preparePeriod returned an unsupported result');
    }
    return prepared;
}

export function readInitialMarketValue(initialMarketHistory, field) {
    const value = Number(initialMarketHistory?.levels?.[field]?.value);
    if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`historicalDataProvider returned invalid initialMarketHistory.${field}`);
    }
    return value;
}

export function buildYearData(record) {
    return {
        jahr: record.simulationYear,
        rendite: record.realized.equityReturn.value,
        gold_eur_perf: record.realized.goldReturn.value,
        zinssatz: record.realized.cashBondReturn.value,
        inflation: record.realized.inflation.value,
        lohn: record.realized.wagePensionAdjustment.value,
        cape: record.decisionAsOf.capeRatio.value,
        capeRatio: record.decisionAsOf.capeRatio.value,
        temporal: deepFreeze({
            temporalConventionId: record.temporalConventionId,
            simulationYear: record.simulationYear,
            realizedSourceYears: {
                equityReturn: record.realized.equityReturn.sourceYear,
                goldReturn: record.realized.goldReturn.sourceYear,
                cashBondReturn: record.realized.cashBondReturn.sourceYear,
                inflation: record.realized.inflation.sourceYear,
                wagePensionAdjustment: record.realized.wagePensionAdjustment.sourceYear
            },
            decisionAsOf: {
                capeRatio: record.decisionAsOf.capeRatio.asOfYear
            }
        })
    };
}

export function buildVpwFallbackHint(vpwPayload) {
    if (!vpwPayload || typeof vpwPayload !== 'object') return 'no_vpw';
    const status = String(vpwPayload.status || '');
    if (status === 'disabled') return 'dynamic_flex_off';
    if (status === 'contract_ready') return 'contract_not_active';
    if (status === 'safety_static_flex') return 'safety_static_flex';
    if (status !== 'active') return 'unknown_status';
    if (!Number.isFinite(vpwPayload.capeRatioUsed) || vpwPayload.capeRatioUsed <= 0) return 'fallback_no_cape';
    if (!Number.isFinite(vpwPayload.expectedReturnCape)) return 'fallback_no_cape_return';
    if (!Number.isFinite(vpwPayload.expectedRealReturn)) return 'fallback_no_real_return';
    return 'ok';
}
