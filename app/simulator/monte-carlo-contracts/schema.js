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

// The time-boxed V1 read-compatibility window ended with Slice 11. Keeping the
// frozen registry as an empty public contract lets readers expose the same
// compatibility shape without recognizing removed KPI aliases.
/** @type {readonly {path:string;replacement:string;removalTarget:string}[]} */
export const MONTE_CARLO_LEGACY_READ_ALIASES = Object.freeze([]);

export const BATCH_STATUSES = new Set(['completed', 'technical_error']);
