/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */
import { STRESS_REPLAY_CONTRACT_VERSION, createStressReplayFingerprint } from '../stress-replay-contract.js';
import { getDataVersion } from '../simulator-engine-helpers.js';
import { captureMonteCarloEngineProvenance } from '../monte-carlo-export.js';
import { runStressReplayPathV1 } from '../stress-replay-runner.js';
import { buildStressReplayComparisonV1 } from '../stress-replay-comparison.js';
import { EngineAPI } from '../../../engine/index.mjs';
import { cloneValue } from './values.js';

/** @param {{workspace: RuntimeTypes.JsonRecord; sourceIdentity?: RuntimeTypes.JsonRecord; sourceScenarioLog?: object[]}} options */
export function defaultRunComparison({ workspace }) {
    const results = workspace.variants.map(variant => runStressReplayPathV1({
        path: cloneValue(workspace.path),
        baselineInputs: cloneValue(workspace.baselineSnapshot),
        sourceIdentity: variant.role === 'baseline' ? cloneValue(workspace.sourceIdentity) : null,
        variant
    }));
    return { comparison: buildStressReplayComparisonV1({ variants: workspace.variants, results }), results };
}

export function defaultCompatibility() {
    return {
        contractVersion: STRESS_REPLAY_CONTRACT_VERSION,
        dataFingerprint: createStressReplayFingerprint(getDataVersion()),
        engineFingerprint: createStressReplayFingerprint(captureMonteCarloEngineProvenance(EngineAPI))
    };
}

export async function defaultCaptureSelectedRun(options) {
    const { runMonteCarloReplayCaptureForIndices } = await import('../simulator-monte-carlo.js');
    return runMonteCarloReplayCaptureForIndices(options);
}

export function downloadJson(serialized, filename, {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    BlobCtor = globalThis.Blob,
    mimeType = 'application/json'
} = {}) {
    if (!documentRef?.createElement || typeof urlApi?.createObjectURL !== 'function' || typeof BlobCtor !== 'function') {
        throw new Error('Der Browserdownload ist in dieser Umgebung nicht verfügbar.');
    }
    const url = urlApi.createObjectURL(new BlobCtor([serialized], { type: mimeType }));
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    try {
        documentRef.body?.appendChild?.(anchor);
        anchor.click();
    } finally {
        anchor.remove?.();
        urlApi.revokeObjectURL?.(url);
    }
}
