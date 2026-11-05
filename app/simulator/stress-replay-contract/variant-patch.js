// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { fail, requireFinite, requirePlainObject, assertStressReplayFinite, deepFreeze, cloneValue } from './values.js';
import { normalizeDecumulationMode } from '../simulator-input-strategy.js';
import { normalizeLongevityMode } from '../dynamic-flex-longevity-contract.js';
import { isValidLiquidityRunwayYears, resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { STRESS_REPLAY_VARIANT_WHITELIST_VERSION, STANDARD_MODE, THREE_BUCKET_MODE, STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2 } from './schema.js';
import { getStressReplayVariantContract } from './variant-whitelist.js';

export function flattenLeaves(value, prefix = '', output = []) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value);
        if (keys.length === 0 && prefix) output.push([prefix, value]);
        for (const key of keys) flattenLeaves(value[key], prefix ? `${prefix}.${key}` : key, output);
    } else {
        output.push([prefix, value]);
    }
    return output;
}

function setPath(target, path, value) {
    const segments = path.split('.');
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index++) {
        cursor[segments[index]] ??= {};
        cursor = cursor[segments[index]];
    }
    cursor[segments.at(-1)] = value;
}

function normalizeWhitelistedValue(value, descriptor) {
    const path = descriptor.contractPath;
    if (descriptor.type === 'boolean') {
        if (typeof value !== 'boolean') fail('STRESS_REPLAY_VARIANT_VALUE_INVALID', `${path} must be boolean`, { path, value });
        return value;
    }
    if (descriptor.type === 'enum') {
        if (!descriptor.values.includes(value)) {
            fail('STRESS_REPLAY_VARIANT_VALUE_INVALID', `${path} has an unsupported value`, { path, value, allowed: descriptor.values });
        }
        return value;
    }
    if (descriptor.type === 'decumulation_mode') return normalizeDecumulationMode(value);
    if (descriptor.type === 'longevity_mode') return normalizeLongevityMode(value);
    if (descriptor.type === 'liquidity_runway_years') {
        if (!isValidLiquidityRunwayYears(value)) {
            fail('STRESS_REPLAY_VARIANT_VALUE_INVALID', `${path} violates the liquidity runway contract`, { path, value });
        }
        return value;
    }
    return requireFinite(value, path, {
        minimum: descriptor.minimum,
        maximum: descriptor.maximum,
        integer: descriptor.type === 'finite_integer'
    });
}

/**
 * Validates an already contract-shaped patch. Conditional subfields are kept
 * only when their controlling mode is effective in this patch or baseline.

 * @param {RuntimeTypes.JsonRecord} patch @param {{baselineStrategy?: Partial<CoreTypes.SimulatorInputs>; whitelistVersion?: string}} [options]
 * @returns {RuntimeTypes.JsonRecord} */
export function normalizeStressReplayVariantPatch(patch, {
    baselineStrategy = {},
    whitelistVersion = STRESS_REPLAY_VARIANT_WHITELIST_VERSION
} = {}) {
    requirePlainObject(patch, 'patch');
    assertStressReplayFinite(patch, 'patch');
    const { whitelist } = getStressReplayVariantContract(whitelistVersion);
    const whitelistByContractPath = new Map(
        whitelist.map(descriptor => [descriptor.contractPath, descriptor])
    );
    const leaves = flattenLeaves(patch);
    const forbidden = [...new Set(leaves
        .map(([path]) => path)
        .filter(path => !whitelistByContractPath.has(path)))].sort();
    if (forbidden.length > 0) {
        fail('STRESS_REPLAY_VARIANT_FIELD_FORBIDDEN', 'Variant patch contains fields outside its whitelist', {
            fields: forbidden,
            whitelistVersion
        });
    }

    const rawValues = new Map(leaves);
    const effectiveDecumulationMode = normalizeDecumulationMode(
        rawValues.get('strategy.decumulation.mode')
            ?? baselineStrategy.decumulation?.mode
            ?? STANDARD_MODE
    );
    const effectiveLongevityMode = normalizeLongevityMode(
        rawValues.get('strategy.longevityMode')
            ?? baselineStrategy.longevityMode
    );
    const normalized = {};
    for (const [path, value] of leaves) {
        const descriptor = whitelistByContractPath.get(path);
        const inactiveDecumulationField = descriptor.activeWhen?.startsWith('strategy.decumulation.mode=')
            && effectiveDecumulationMode !== THREE_BUCKET_MODE;
        const activeLongevityMode = descriptor.activeWhen?.startsWith('strategy.longevityMode=')
            ? descriptor.activeWhen.slice(descriptor.activeWhen.indexOf('=') + 1)
            : null;
        if (inactiveDecumulationField || (activeLongevityMode && effectiveLongevityMode !== activeLongevityMode)) {
            continue;
        }
        setPath(normalized, path, normalizeWhitelistedValue(value, descriptor));
    }
    return deepFreeze(cloneValue(normalized));
}

/** Builds the exact replay strategy projection from getCommonInputs().
 *
 * @param inputs - Eingaben des Laufes.
 * @param [options] - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayStrategySnapshot(
    inputs,
    { whitelistVersion = STRESS_REPLAY_VARIANT_WHITELIST_VERSION } = {}
) {
    requirePlainObject(inputs, 'inputs');
    const { whitelist } = getStressReplayVariantContract(whitelistVersion);
    const whitelistByContractPath = new Map(
        whitelist.map(descriptor => [descriptor.contractPath, descriptor])
    );
    const runway = resolveLiquidityRunwayYears(inputs).years;
    const decumulationMode = inputs.decumulation?.mode;
    const longevityMode = inputs.longevityMode;
    const strategy = {
        liquidityRunwayYears: runway,
        maxSkimPctOfEq: inputs.maxSkimPctOfEq,
        maxBearRefillPctOfEq: inputs.maxBearRefillPctOfEq,
        decumulation: {
            mode: decumulationMode,
            bondTargetFactor: inputs.decumulation?.bondTargetFactor,
            drawdownTrigger: inputs.decumulation?.drawdownTrigger,
            bondRefillThreshold: inputs.decumulation?.bondRefillThreshold
        },
        dynamicFlex: inputs.dynamicFlex,
        horizonMethod: inputs.horizonMethod,
        horizonYears: inputs.horizonYears,
        survivalQuantile: inputs.survivalQuantile,
        goGoActive: inputs.goGoActive,
        goGoMultiplier: inputs.goGoMultiplier,
        longevityMode,
        longevityQuantileShift: inputs.longevityQuantileShift,
        longevityRelativePct: inputs.longevityRelativePct,
        longevityBufferYears: inputs.longevityBufferYears
    };
    if (whitelistVersion === STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2) {
        for (const key of ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual']) {
            if (Object.hasOwn(inputs, key)) strategy[key] = inputs[key];
        }
    }
    const contractPatch = normalizeStressReplayVariantPatch(
        { strategy },
        { baselineStrategy: strategy, whitelistVersion }
    );
    const snapshot = cloneValue(contractPatch.strategy);
    snapshot.decumulation ??= {};
    snapshot.decumulation.mode = normalizeWhitelistedValue(decumulationMode, whitelistByContractPath.get('strategy.decumulation.mode'));
    snapshot.longevityMode = normalizeWhitelistedValue(longevityMode, whitelistByContractPath.get('strategy.longevityMode'));
    return deepFreeze(snapshot);
}

function getPath(value, path) {
    return path.split('.').reduce((cursor, segment) => cursor?.[segment], value);
}

function cloneAndSetPath(target, path, value) {
    const segments = path.split('.');
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index++) {
        const segment = segments[index];
        if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
            cursor[segment] = {};
        }
        cursor = cursor[segment];
    }
    cursor[segments.at(-1)] = cloneValue(value);
}

/** @param {{baselineInputs?: RuntimeTypes.JsonRecord; patch?: RuntimeTypes.JsonRecord}} [options] @returns {Partial<Pick<CoreTypes.SimulatorInputs, "startFloorBedarf" | "startFlexBedarf" | "minimumFlexAnnual">>} */
export function validateStressReplayEffectiveNeeds({ baselineInputs, patch = {} } = {}) {
    requirePlainObject(baselineInputs, 'baselineInputs');
    requirePlainObject(patch, 'patch');
    const effective = {};
    const needKeys = ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual'];
    const hasNeedPatch = needKeys.some(key => getPath(patch, `strategy.${key}`) !== undefined);
    for (const key of needKeys) {
        const patched = getPath(patch, `strategy.${key}`);
        const value = patched !== undefined ? patched : baselineInputs[key];
        if (value === undefined && hasNeedPatch) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', `effectiveNeeds.${key} is required for a V2 need patch`, {
                path: `effectiveNeeds.${key}`
            });
        }
        if (value !== undefined) effective[key] = requireFinite(value, `effectiveNeeds.${key}`, { minimum: 0 });
    }
    if (effective.startFlexBedarf !== undefined
        && effective.minimumFlexAnnual !== undefined
        && effective.minimumFlexAnnual > effective.startFlexBedarf) {
        fail(
            'STRESS_REPLAY_MINIMUM_FLEX_EXCEEDS_FLEX',
            'Effective minimum flex must not exceed effective flex need',
            {
                startFlexBedarf: effective.startFlexBedarf,
                minimumFlexAnnual: effective.minimumFlexAnnual,
                fields: ['strategy.startFlexBedarf', 'strategy.minimumFlexAnnual']
            }
        );
    }
    return deepFreeze(effective);
}

/** @param {{baselineInputs?: RuntimeTypes.JsonRecord; patch?: RuntimeTypes.JsonRecord; whitelistVersion?: string}} [options] @returns {RuntimeTypes.JsonRecord} */
export function applyStressReplayVariantPatch({
    baselineInputs,
    patch,
    whitelistVersion = STRESS_REPLAY_VARIANT_WHITELIST_VERSION
} = {}) {
    requirePlainObject(baselineInputs, 'baselineInputs');
    const normalizedPatch = normalizeStressReplayVariantPatch(patch, {
        baselineStrategy: createStressReplayStrategySnapshot(baselineInputs, { whitelistVersion }),
        whitelistVersion
    });
    if (whitelistVersion === STRESS_REPLAY_VARIANT_WHITELIST_VERSION_V2) {
        validateStressReplayEffectiveNeeds({ baselineInputs, patch: normalizedPatch });
    }
    const applied = cloneValue(baselineInputs);
    for (const descriptor of getStressReplayVariantContract(whitelistVersion).whitelist) {
        const value = getPath(normalizedPatch, descriptor.contractPath);
        if (value !== undefined) cloneAndSetPath(applied, descriptor.inputPath, value);
    }
    return deepFreeze(applied);
}
