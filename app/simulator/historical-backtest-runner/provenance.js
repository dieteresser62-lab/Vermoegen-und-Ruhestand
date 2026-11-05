"use strict";

import { cloneRunValue } from './run-values.js';
import { canonicalizeHistoricalContractValue, sha256Hex } from '../historical-backtest-contract.js';

export function buildDatasetProvenance(historicalDataProvider) {
    const manifest = historicalDataProvider?.manifest;
    return {
        datasetId: historicalDataProvider?.datasetId || null,
        revision: historicalDataProvider?.revision || null,
        contentHash: historicalDataProvider?.contentHash || null,
        manifestSchemaVersion: manifest?.schemaVersion || null,
        manifestHash: manifest && typeof manifest === 'object'
            ? {
                algorithm: 'sha256-canonical-json-v1',
                value: sha256Hex(canonicalizeHistoricalContractValue(manifest))
            }
            : null
    };
}

export function buildEngineProvenance(engineProvenance) {
    const configFingerprint = engineProvenance?.configFingerprint;
    const quantizationContract = engineProvenance?.quantizationContract;
    return {
        apiVersion: typeof engineProvenance?.apiVersion === 'string' ? engineProvenance.apiVersion : null,
        buildId: typeof engineProvenance?.buildId === 'string' ? engineProvenance.buildId : null,
        sourceCommit: typeof engineProvenance?.sourceCommit === 'string'
            ? engineProvenance.sourceCommit
            : null,
        sourceTreeStatus: typeof engineProvenance?.sourceTreeStatus === 'string'
            ? engineProvenance.sourceTreeStatus
            : 'unavailable',
        sourceProvenanceProvider: typeof engineProvenance?.sourceProvenanceProvider === 'string'
            ? engineProvenance.sourceProvenanceProvider
            : null,
        configFingerprint: configFingerprint
            && typeof configFingerprint.algorithm === 'string'
            && typeof configFingerprint.value === 'string'
            ? {
                algorithm: configFingerprint.algorithm,
                value: configFingerprint.value
            }
            : null,
        quantizationContract: quantizationContract && typeof quantizationContract === 'object'
            ? cloneRunValue(quantizationContract)
            : null
    };
}
