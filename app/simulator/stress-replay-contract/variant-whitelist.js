// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { deepFreeze, fail } from './values.js';
import { HORIZON_METHODS, STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V1, STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2, STRESS_REPLAY_VARIANT_WHITELIST_VERSION } from './schema.js';
import { LONGEVITY_LIMITS } from '../dynamic-flex-longevity-contract.js';

const field = (inputPath, contractPath, options) => deepFreeze({ inputPath, contractPath, ...options });

export const STRESS_REPLAY_VARIANT_WHITELIST_V1 = deepFreeze([
    field('liquidityRunwayYears', 'strategy.liquidityRunwayYears', { type: 'liquidity_runway_years' }),
    field('maxSkimPctOfEq', 'strategy.maxSkimPctOfEq', { type: 'finite_number', minimum: 0, maximum: 50 }),
    field('maxBearRefillPctOfEq', 'strategy.maxBearRefillPctOfEq', { type: 'finite_number', minimum: 0, maximum: 70 }),
    field('decumulation.mode', 'strategy.decumulation.mode', { type: 'decumulation_mode' }),
    field('decumulation.bondTargetFactor', 'strategy.decumulation.bondTargetFactor', { type: 'finite_number', minimum: 0, activeWhen: 'strategy.decumulation.mode=3_bucket_jilge' }),
    field('decumulation.drawdownTrigger', 'strategy.decumulation.drawdownTrigger', { type: 'finite_number', activeWhen: 'strategy.decumulation.mode=3_bucket_jilge' }),
    field('decumulation.bondRefillThreshold', 'strategy.decumulation.bondRefillThreshold', { type: 'finite_number', minimum: 0, activeWhen: 'strategy.decumulation.mode=3_bucket_jilge' }),
    field('dynamicFlex', 'strategy.dynamicFlex', { type: 'boolean' }),
    field('horizonMethod', 'strategy.horizonMethod', { type: 'enum', values: [...HORIZON_METHODS] }),
    field('horizonYears', 'strategy.horizonYears', { type: 'finite_number', minimum: 1, maximum: 60 }),
    field('survivalQuantile', 'strategy.survivalQuantile', { type: 'finite_number', minimum: 0.5, maximum: 0.99 }),
    field('goGoActive', 'strategy.goGoActive', { type: 'boolean' }),
    field('goGoMultiplier', 'strategy.goGoMultiplier', { type: 'finite_number', minimum: 1, maximum: 1.5 }),
    field('longevityMode', 'strategy.longevityMode', { type: 'longevity_mode' }),
    field('longevityQuantileShift', 'strategy.longevityQuantileShift', { type: 'finite_number', minimum: LONGEVITY_LIMITS.quantileShiftMin, maximum: LONGEVITY_LIMITS.quantileShiftMax, activeWhen: 'strategy.longevityMode=quantile_shift' }),
    field('longevityRelativePct', 'strategy.longevityRelativePct', { type: 'finite_number', minimum: LONGEVITY_LIMITS.relativePctMin, maximum: LONGEVITY_LIMITS.relativePctMax, activeWhen: 'strategy.longevityMode=relative_horizon_buffer' }),
    field('longevityBufferYears', 'strategy.longevityBufferYears', { type: 'finite_integer', minimum: LONGEVITY_LIMITS.bufferYearsMin, maximum: LONGEVITY_LIMITS.bufferYearsMax, activeWhen: 'strategy.longevityMode=buffer_years' })
]);

export const STRESS_REPLAY_VARIANT_WHITELIST_V2 = deepFreeze([
    ...STRESS_REPLAY_VARIANT_WHITELIST_V1,
    field('startFloorBedarf', 'strategy.startFloorBedarf', { type: 'finite_number', minimum: 0 }),
    field('startFlexBedarf', 'strategy.startFlexBedarf', { type: 'finite_number', minimum: 0 }),
    field('minimumFlexAnnual', 'strategy.minimumFlexAnnual', { type: 'finite_number', minimum: 0 })
]);

export const STRESS_REPLAY_FORBIDDEN_VARIANT_PATHS_V1 = Object.freeze([
    'strategy.goldAktiv',
    'strategy.goldZielProzent',
    'strategy.goldFloorProzent',
    'strategy.rebalancingBand',
    'strategy.goldSteuerfrei',
    'strategy.goldTargetPct',
    'strategy.minimumFlexAnnual',
    'strategy.flexBudgetAnnual',
    'strategy.flexBudgetYears',
    'strategy.flexBudgetRecharge',
    'strategy.tranchen'
]);

export const STRESS_REPLAY_FORBIDDEN_VARIANT_PATHS_V2 = Object.freeze(
    STRESS_REPLAY_FORBIDDEN_VARIANT_PATHS_V1.filter(path => path !== 'strategy.minimumFlexAnnual')
);

const VARIANT_CONTRACTS = new Map([
    [STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V1, Object.freeze({
        whitelist: STRESS_REPLAY_VARIANT_WHITELIST_V1,
        forbiddenPaths: STRESS_REPLAY_FORBIDDEN_VARIANT_PATHS_V1
    })],
    [STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2, Object.freeze({
        whitelist: STRESS_REPLAY_VARIANT_WHITELIST_V2,
        forbiddenPaths: STRESS_REPLAY_FORBIDDEN_VARIANT_PATHS_V2
    })]
]);

/**
 * @param {string} [whitelistVersion] - Kontext für whitelistVersion.
 * @returns Ergebnis der Operation.
 */
export function getStressReplayVariantContract(whitelistVersion = STRESS_REPLAY_VARIANT_WHITELIST_VERSION) {
    const contract = VARIANT_CONTRACTS.get(whitelistVersion);
    if (!contract) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay variant whitelist version', {
            whitelistVersion,
            supportedWhitelistVersions: [...VARIANT_CONTRACTS.keys()]
        });
    }
    return contract;
}
