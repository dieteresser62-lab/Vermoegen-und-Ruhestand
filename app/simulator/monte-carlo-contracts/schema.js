// @ts-check

export const MONTE_CARLO_RUN_REQUEST_VERSION = 'MonteCarloRunRequestV1';

export const MONTE_CARLO_RUN_RESULT_VERSION = 'MonteCarloRunResultV1';

export const MONTE_CARLO_RUN_RESULT_V2_VERSION = 'MonteCarloRunResultV2';

export const MONTE_CARLO_UNIT_CONTRACT_V2_VERSION = 'MonteCarloUnitContractV2';

export const MONTE_CARLO_SCENARIO_VERSION = 'MonteCarloScenarioV1';

export const MONTE_CARLO_SNAPSHOT_POLICY_VERSION = 'MonteCarloSnapshotPolicyV1';

export const MONTE_CARLO_FINGERPRINT_ALGORITHM = 'sha256-canonical-json-v1';

export const MONTE_CARLO_SNAPSHOT_POLICY = Object.freeze({
    schemaVersion: MONTE_CARLO_SNAPSHOT_POLICY_VERSION,
    immutableBaseline: 'pre-hardening-v1',
    currentReference: null,
    deltaLedger: 'delta-ledger-v1',
    finalCandidate: 'monte-carlo-v1-final',
    policy: 'immutable-baseline-with-versioned-pending-candidates',
    promotionRule: 'current-reference-remains-null-until-external-approval'
});

export const BATCH_STATUSES = new Set(['completed', 'technical_error']);
