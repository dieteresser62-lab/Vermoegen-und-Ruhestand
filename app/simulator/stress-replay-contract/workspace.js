// @ts-check
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
"use strict";

import { requirePlainObject, createStressReplayFingerprint, fail, requireString, validateFingerprint, assertStressReplayFinite, assertStressReplaySize, deepFreeze, cloneValue } from './values.js';
import { STRESS_REPLAY_SCHEMA_VERSIONS, STRESS_REPLAY_CONTRACT_VERSION, STRESS_REPLAY_SCOPE, STRESS_REPLAY_LIMITS } from './schema.js';
import { validateStressReplayPathV1, createStressReplayPathFingerprint } from './path.js';
import { validateStressReplaySourceIdentity, createStressReplaySourceIdentityV2 } from './source-identity.js';
import { validateStressReplayVariantV1 } from './variant-result.js';
import { applyStressReplayVariantPatch } from './variant-patch.js';

function workspaceFingerprintBasis(workspace) {
    const { workspaceFingerprint: _workspaceFingerprint, ...basis } = workspace;
    return basis;
}

/**
 * @param workspace - Kontext für workspace.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createStressReplayWorkspaceFingerprint(workspace) {
    requirePlainObject(workspace, 'workspace');
    return createStressReplayFingerprint(workspaceFingerprintBasis(workspace));
}

/**
 * @param workspace - Kontext für workspace.
 * @returns Geprüfter Vertrag; ungültige Werte werden gemeldet.
 */
export function validateStressReplayWorkspaceV1(workspace) {
    requirePlainObject(workspace, 'workspace');
    const allowedKeys = new Set([
        'schemaVersion',
        'contractVersion',
        'scope',
        'createdAtUtc',
        'updatedAtUtc',
        'path',
        'pathFingerprint',
        'sourceIdentity',
        'baselineSnapshot',
        'baselineScenarioFingerprint',
        'variantOrder',
        'variants',
        'workspaceFingerprint'
    ]);
    const unknownKeys = Object.keys(workspace).filter(key => !allowedKeys.has(key)).sort();
    if (unknownKeys.length > 0) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'Workspace contains unknown contract fields', {
            fields: unknownKeys
        });
    }
    if (workspace.schemaVersion !== STRESS_REPLAY_SCHEMA_VERSIONS.workspace
        || workspace.contractVersion !== STRESS_REPLAY_CONTRACT_VERSION
        || workspace.scope !== STRESS_REPLAY_SCOPE) {
        fail('STRESS_REPLAY_VERSION_UNSUPPORTED', 'Unsupported stress replay workspace contract', {
            schemaVersion: workspace.schemaVersion,
            contractVersion: workspace.contractVersion,
            scope: workspace.scope
        });
    }
    for (const key of ['createdAtUtc', 'updatedAtUtc']) {
        requireString(workspace[key], `workspace.${key}`);
        const date = new Date(workspace[key]);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== workspace[key]) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', `workspace.${key} must be a canonical UTC timestamp`, {
                path: `workspace.${key}`
            });
        }
    }
    if (new Date(workspace.updatedAtUtc).getTime() < new Date(workspace.createdAtUtc).getTime()) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'workspace.updatedAtUtc must not predate createdAtUtc');
    }
    const path = validateStressReplayPathV1(workspace.path);
    validateFingerprint(workspace.pathFingerprint, 'workspace.pathFingerprint');
    const expectedPathFingerprint = createStressReplayPathFingerprint(path);
    if (workspace.pathFingerprint.value !== expectedPathFingerprint.value
        || (path.pathFingerprint && path.pathFingerprint.value !== expectedPathFingerprint.value)) {
        fail('STRESS_REPLAY_PATH_FINGERPRINT_MISMATCH', 'Workspace path fingerprint does not match its path');
    }
    const sourceIdentity = workspace.sourceIdentity === undefined
        ? null
        : validateStressReplaySourceIdentity(workspace.sourceIdentity, path);
    requirePlainObject(workspace.baselineSnapshot, 'workspace.baselineSnapshot');
    assertStressReplayFinite(workspace.baselineSnapshot, 'workspace.baselineSnapshot');
    validateFingerprint(workspace.baselineScenarioFingerprint, 'workspace.baselineScenarioFingerprint');
    const expectedBaselineFingerprint = createStressReplayFingerprint(workspace.baselineSnapshot);
    if (workspace.baselineScenarioFingerprint.value !== expectedBaselineFingerprint.value) {
        fail('STRESS_REPLAY_BASELINE_FINGERPRINT_MISMATCH', 'Workspace baseline snapshot fingerprint does not match');
    }
    if (!Array.isArray(workspace.variantOrder)
        || !Array.isArray(workspace.variants)
        || workspace.variantOrder.length !== workspace.variants.length
        || workspace.variantOrder.length < 1
        || workspace.variantOrder.length > STRESS_REPLAY_LIMITS.maximumVariants
        || workspace.variantOrder[0] !== 'baseline'
        || new Set(workspace.variantOrder).size !== workspace.variantOrder.length) {
        fail('STRESS_REPLAY_VARIANT_LIMIT_EXCEEDED', 'Workspace variant order is invalid');
    }
    const variants = workspace.variants.map((variant, index) => {
        const validated = validateStressReplayVariantV1(variant);
        if (validated.id !== workspace.variantOrder[index]
            || validated.role !== (index === 0 ? 'baseline' : 'alternative')
            || validated.baselineScenarioFingerprint.value !== expectedBaselineFingerprint.value) {
            fail('STRESS_REPLAY_CONTRACT_INVALID', 'Workspace variant identity or baseline binding is invalid', {
                path: `workspace.variants[${index}]`
            });
        }
        const appliedInputs = applyStressReplayVariantPatch({
            baselineInputs: workspace.baselineSnapshot,
            patch: validated.patch,
            whitelistVersion: validated.whitelistVersion
        });
        const appliedFingerprint = createStressReplayFingerprint(appliedInputs);
        if (appliedFingerprint.value !== validated.normalizedInputFingerprint.value) {
            fail(
                'STRESS_REPLAY_VARIANT_FINGERPRINT_MISMATCH',
                'Workspace variant normalized-input fingerprint does not match its baseline and patch',
                { path: `workspace.variants[${index}].normalizedInputFingerprint` }
            );
        }
        return validated;
    });
    validateFingerprint(workspace.workspaceFingerprint, 'workspace.workspaceFingerprint');
    const expectedWorkspaceFingerprint = createStressReplayWorkspaceFingerprint(workspace);
    if (workspace.workspaceFingerprint.value !== expectedWorkspaceFingerprint.value) {
        fail('STRESS_REPLAY_WORKSPACE_FINGERPRINT_MISMATCH', 'Workspace fingerprint does not match its contents');
    }
    assertStressReplaySize(workspace, STRESS_REPLAY_LIMITS.maximumEnvelopeBytes, 'workspace');
    return deepFreeze(cloneValue({ ...workspace, path, variants, ...(sourceIdentity ? { sourceIdentity } : {}) }));
}

export const assertStressReplayWorkspaceV1 = validateStressReplayWorkspaceV1;

/** @param {{path?: RuntimeTypes.JsonRecord; sourceIdentity?: RuntimeTypes.JsonRecord; sourceScenarioLog?: object[]; baselineSnapshot?: RuntimeTypes.JsonRecord; variants?: RuntimeTypes.JsonRecord[]; variantOrder?: string[]; createdAtUtc?: string; updatedAtUtc?: string}} [options] @returns {RuntimeTypes.JsonRecord} */
export function createStressReplayWorkspaceV1({
    path,
    sourceIdentity,
    sourceScenarioLog,
    baselineSnapshot,
    variants,
    variantOrder = variants?.map(variant => variant?.id),
    createdAtUtc = new Date().toISOString(),
    updatedAtUtc = createdAtUtc
} = {}) {
    const validatedPath = validateStressReplayPathV1(path);
    requirePlainObject(baselineSnapshot, 'baselineSnapshot');
    if (!Array.isArray(variants)) {
        fail('STRESS_REPLAY_CONTRACT_INVALID', 'variants must be an array');
    }
    const workspaceWithoutFingerprint = {
        schemaVersion: STRESS_REPLAY_SCHEMA_VERSIONS.workspace,
        contractVersion: STRESS_REPLAY_CONTRACT_VERSION,
        scope: STRESS_REPLAY_SCOPE,
        createdAtUtc,
        updatedAtUtc,
        path: validatedPath,
        pathFingerprint: createStressReplayPathFingerprint(validatedPath),
        ...(sourceIdentity !== undefined || sourceScenarioLog !== undefined
            ? { sourceIdentity: sourceIdentity === undefined
                ? createStressReplaySourceIdentityV2({ path: validatedPath, sourceRows: sourceScenarioLog })
                : validateStressReplaySourceIdentity(sourceIdentity, validatedPath) }
            : {}),
        baselineSnapshot: cloneValue(baselineSnapshot),
        baselineScenarioFingerprint: createStressReplayFingerprint(baselineSnapshot),
        variantOrder: cloneValue(variantOrder),
        variants: cloneValue(variants)
    };
    return validateStressReplayWorkspaceV1({
        ...workspaceWithoutFingerprint,
        workspaceFingerprint: createStressReplayWorkspaceFingerprint(workspaceWithoutFingerprint)
    });
}
