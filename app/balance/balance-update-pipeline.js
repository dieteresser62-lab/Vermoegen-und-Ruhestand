/**
 * Module: Balance Update Pipeline
 * Purpose: Small helpers for the Balance main update cycle.
 */
"use strict";

import { applyGuardrailPlanChange, selectGuardrailPlanInputs } from '../shared/guardrail-history.js';
import { buildBalanceHealthBucketDiagnostics } from './balance-health-bucket.js';
import { ValidationError } from './balance-config.js';
import { stripBalancePlanInputs, projectPlanToBalance } from '../profile/household-plan.js';
import { projectBalanceBudget } from './balance-budget.js';

export const BALANCE_UPDATE_STATUS = Object.freeze({
    SUCCESS: 'success',
    VALIDATION_ERROR: 'validation_error',
    ENGINE_ERROR: 'engine_error',
    BLOCKED: 'blocked'
});

export const BALANCE_UPDATE_MODE = Object.freeze({
    PREVIEW: 'preview',
    PERSIST_INPUTS: 'persist_inputs',
    COMMIT_PERIOD: 'commit_period'
});

export const BALANCE_STATE_LIFECYCLE_KEY = 'balanceStateLifecycle';

export class EngineGateError extends Error {
    constructor(message, reason, context = {}) {
        super(message);
        this.name = 'EngineGateError';
        this.reason = reason;
        this.context = context;
    }
}

export class BalanceStateLifecycleError extends Error {
    constructor(message, reason, context = {}) {
        super(message);
        this.name = 'BalanceStateLifecycleError';
        this.reason = reason;
        this.context = context;
    }
}

function normalizeError(error) {
    if (error instanceof Error) return error;
    return new Error(typeof error === 'string' ? error : 'Unbekannter Fehler');
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function assertJsonCompatibleBalanceValue(value, seen = new WeakSet()) {
    if (value === null) return;
    if (value === undefined) {
        throw new BalanceStateLifecycleError(
            'Der Balance-State enthaelt einen nicht per JSON speicherbaren undefined-Wert.',
            'non_json_state'
        );
    }
    if (typeof value === 'number') {
        if (Number.isFinite(value)) return;
        throw new BalanceStateLifecycleError(
            'Der Balance-State enthaelt eine nicht per JSON speicherbare Zahl.',
            'non_json_state'
        );
    }
    if (typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value !== 'object') {
        throw new BalanceStateLifecycleError(
            `Der Balance-State enthaelt einen nicht per JSON speicherbaren Wert vom Typ ${typeof value}.`,
            'non_json_state'
        );
    }
    if (seen.has(value)) {
        throw new BalanceStateLifecycleError(
            'Der Balance-State enthaelt eine zyklische Struktur und kann nicht sicher verarbeitet werden.',
            'fingerprint_cycle'
        );
    }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new BalanceStateLifecycleError(
            `Der Balance-State enthaelt ein nicht unterstuetztes Laufzeitobjekt ${value.constructor?.name || 'Object'}.`,
            'non_json_state'
        );
    }
    seen.add(value);
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                throw new BalanceStateLifecycleError(
                    'Der Balance-State enthaelt ein nicht per JSON eindeutig speicherbares Array mit Luecken.',
                    'non_json_state'
                );
            }
        }
        const hasCustomArrayKey = Object.keys(value).some(key => {
            const index = Number(key);
            return !Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key;
        });
        if (hasCustomArrayKey) {
            throw new BalanceStateLifecycleError(
                'Der Balance-State enthaelt ein Array mit nicht per JSON erhaltenen Zusatzfeldern.',
                'non_json_state'
            );
        }
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new BalanceStateLifecycleError(
            'Der Balance-State enthaelt nicht per JSON speicherbare Symbol-Schluessel.',
            'non_json_state'
        );
    }
    Object.keys(value).forEach(key => assertJsonCompatibleBalanceValue(value[key], seen));
    seen.delete(value);
}

function normalizeFingerprintValue(value) {
    if (value === null) return null;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map(entry => normalizeFingerprintValue(entry));
    }
    const normalized = {};
    Object.keys(value).sort().forEach(key => {
        normalized[key] = normalizeFingerprintValue(value[key]);
    });
    return normalized;
}

/**
 * @param value Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function createBalanceFingerprint(value) {
    assertJsonCompatibleBalanceValue(value);
    const serialized = JSON.stringify(normalizeFingerprintValue(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index++) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function selectPersistentFinancialInputs(inputs) {
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return null;
    return Object.fromEntries(
        Object.entries(inputs)
            .filter(([key]) => key !== 'depotLastUpdate')
    );
}

/**
 * Fingerprints only persisted JSON data that can influence the financial
 * candidate. Workflow/UI metadata and depotLastUpdate are intentionally
 * excluded; period validity is guarded separately by assertBalancePeriodCommit.
 */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{persistentState?: import('../../typcheck/datenvertraege.js').BalanceState, profilverbundProfiles?: import('../../typcheck/balance-ui.js').ProfileInput[], householdPlan?: object}} [options] @returns {string} */
export function createBalanceCommitBaseFingerprint({
    persistentState = {},
    profilverbundProfiles = [],
    householdPlan = null
} = {}) {
    const select = inputs => selectPersistentFinancialInputs(householdPlan ? stripBalancePlanInputs(inputs) : inputs);
    const profiles = Array.isArray(profilverbundProfiles)
        ? profilverbundProfiles
            .map(entry => {
                const balanceState = entry?.balanceState || {};
                return {
                    profileId: entry?.profileId || null,
                    inputs: select(balanceState.inputs),
                    lastState: balanceState.lastState || null,
                    profilverbundHouseholdInputs: select(
                        balanceState.profilverbundHouseholdInputs
                    ),
                    profilverbundHouseholdLastState:
                        balanceState.profilverbundHouseholdLastState || null
                };
            })
            .sort((left, right) => String(left.profileId).localeCompare(String(right.profileId)))
        : [];

    return createBalanceFingerprint({
        inputs: select(persistentState?.inputs),
        lastState: persistentState?.lastState || null,
        profilverbundProfiles: profiles,
        ...(householdPlan ? { householdPlan } : {})
    });
}

/**
 * @param value Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function cloneBalanceState(value) {
    if (value === null) return value;
    assertJsonCompatibleBalanceValue(value);
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * @param options Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import('../../typcheck/balance-ui.js').UpdateRequest} [options] @returns Validierte Update-Anforderung. */
export function resolveBalanceUpdateRequest(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new BalanceStateLifecycleError(
            'Der Balance-Update-Vertrag ist ungueltig.',
            'invalid_update_request'
        );
    }

    const hasMode = hasOwn(options, 'mode');
    const hasLegacyPersist = hasOwn(options, 'persist');
    if (hasMode && hasLegacyPersist) {
        throw new BalanceStateLifecycleError(
            'Balance-Update darf mode und persist nicht kombinieren.',
            'ambiguous_update_request'
        );
    }

    if (hasLegacyPersist) {
        throw new BalanceStateLifecycleError(
            'Der Legacy-Parameter persist wird nicht mehr unterstuetzt. Bitte einen expliziten mode verwenden.',
            'legacy_persist_unsupported'
        );
    }
    const mode = hasMode ? options.mode : BALANCE_UPDATE_MODE.PREVIEW;
    if (!Object.values(BALANCE_UPDATE_MODE).includes(mode)) {
        throw new BalanceStateLifecycleError(
            `Unbekannter Balance-Update-Modus: ${String(mode)}`,
            'invalid_update_mode',
            { mode }
        );
    }

    const periodId = typeof options.periodId === 'string' ? options.periodId.trim() : '';
    if (mode === BALANCE_UPDATE_MODE.COMMIT_PERIOD && !periodId) {
        throw new BalanceStateLifecycleError(
            'Ein periodengebundener Balance-Commit benoetigt eine Perioden-ID.',
            'period_required'
        );
    }
    if (mode !== BALANCE_UPDATE_MODE.COMMIT_PERIOD && periodId) {
        throw new BalanceStateLifecycleError(
            'Eine Perioden-ID ist nur im Modus commit_period zulaessig.',
            'period_not_allowed'
        );
    }

    return Object.freeze({
        mode,
        periodId: periodId || null
    });
}

/**
 * @param expectedFingerprint Eingabe für die bestehende Projektion.
 * @param currentFingerprint Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function assertBalanceCandidateFresh(expectedFingerprint, currentFingerprint) {
    if (
        typeof expectedFingerprint !== 'string'
        || !expectedFingerprint
        || typeof currentFingerprint !== 'string'
        || !currentFingerprint
        || expectedFingerprint !== currentFingerprint
    ) {
        throw new BalanceStateLifecycleError(
            'Der berechnete Balance-Candidate basiert nicht mehr auf dem aktuellen Basis-State.',
            'stale_candidate',
            { expectedFingerprint, currentFingerprint }
        );
    }
    return currentFingerprint;
}

/**
 * @param persistentState Eingabe für die bestehende Projektion.
 * @param periodId Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function assertBalancePeriodCommit(persistentState = {}, periodId) {
    const normalizedPeriodId = typeof periodId === 'string' ? periodId.trim() : '';
    if (!normalizedPeriodId) {
        throw new BalanceStateLifecycleError(
            'Ein periodengebundener Balance-Commit benoetigt eine Perioden-ID.',
            'period_required'
        );
    }

    const annualMetadata = persistentState?.annualPeriodMetadata || {};
    const lifecycle = persistentState?.[BALANCE_STATE_LIFECYCLE_KEY] || {};
    if (
        annualMetadata.lastCommittedPeriod === normalizedPeriodId
        || lifecycle.lastCommittedPeriod === normalizedPeriodId
    ) {
        throw new BalanceStateLifecycleError(
            `Die Balance-Periode ${normalizedPeriodId} wurde bereits committed.`,
            'period_already_committed',
            { periodId: normalizedPeriodId }
        );
    }

    const pending = annualMetadata.pendingCommit;
    if (!pending || typeof pending !== 'object') {
        throw new BalanceStateLifecycleError(
            `Fuer die Balance-Periode ${normalizedPeriodId} ist kein Commit vorbereitet.`,
            'period_not_pending',
            { periodId: normalizedPeriodId }
        );
    }
    if (pending.periodId !== normalizedPeriodId) {
        throw new BalanceStateLifecycleError(
            `Vorbereitete Periode ${String(pending.periodId)} passt nicht zu ${normalizedPeriodId}.`,
            'period_mismatch',
            { periodId: normalizedPeriodId, pendingPeriodId: pending.periodId }
        );
    }
    if (typeof pending.snapshotId !== 'string' || !pending.snapshotId.trim()) {
        throw new BalanceStateLifecycleError(
            'Der periodengebundene Balance-Commit hat keinen bestaetigten Recovery-Snapshot.',
            'snapshot_required',
            { periodId: normalizedPeriodId }
        );
    }
    if (!['writes_started', 'validating'].includes(pending.phase)) {
        throw new BalanceStateLifecycleError(
            `Die Balance-Periode ${normalizedPeriodId} ist nicht in einer commitfaehigen Phase.`,
            'invalid_commit_phase',
            { periodId: normalizedPeriodId, phase: pending.phase }
        );
    }

    return pending;
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{expectedBaseFingerprint?: string, currentBaseFingerprint?: string, currentPersistentState?: import('../../typcheck/datenvertraege.js').BalanceState, periodId?: string}} [options] @returns {import('../../typcheck/datenvertraege.js').BalanceState} */
export function assertBalanceCommitStillCurrent({
    expectedBaseFingerprint,
    currentBaseFingerprint,
    currentPersistentState = {},
    periodId
} = {}) {
    assertBalanceCandidateFresh(expectedBaseFingerprint, currentBaseFingerprint);
    assertBalancePeriodCommit(currentPersistentState, periodId);
    return currentPersistentState;
}

function buildBalanceLifecycleMetadata(persistentState, periodId, fingerprints = {}) {
    return {
        ...(persistentState?.[BALANCE_STATE_LIFECYCLE_KEY] || {}),
        schemaVersion: 1,
        lastCommittedPeriod: periodId,
        inputFingerprint: fingerprints.inputFingerprint || null,
        baseStateFingerprint: fingerprints.baseStateFingerprint || null,
        candidateStateFingerprint: fingerprints.candidateStateFingerprint || null
    };
}

/**
 * @param engineApi Eingabe für die bestehende Projektion.
 * @param requiredVersionPrefix Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function createEngineHandshake(engineApi, requiredVersionPrefix) {
    if (!engineApi || typeof engineApi.getVersion !== 'function') {
        throw new EngineGateError(
            'EngineAPI (engine.js) konnte nicht geladen werden oder ist ungültig.',
            'missing_engine'
        );
    }
    if (typeof engineApi.simulateSingleYear !== 'function') {
        throw new EngineGateError(
            'EngineAPI.simulateSingleYear() fehlt. Berechnungen wurden blockiert.',
            'missing_simulation'
        );
    }

    let version;
    try {
        version = engineApi.getVersion();
    } catch (error) {
        throw new EngineGateError(
            'EngineAPI.getVersion() konnte nicht ausgeführt werden.',
            'version_read_failed',
            { originalError: normalizeError(error) }
        );
    }
    if (!version || typeof version.api !== 'string' || typeof version.build !== 'string') {
        throw new EngineGateError(
            'EngineAPI.getVersion() liefert ein ungültiges Format.',
            'invalid_version'
        );
    }
    if (!version.api.startsWith(requiredVersionPrefix)) {
        throw new EngineGateError(
            `Inkompatible Engine-Version erkannt (Geladen: ${version.api}, Erwartet: ${requiredVersionPrefix}x). Berechnungen wurden blockiert.`,
            'incompatible_version',
            { actualApi: version.api, requiredVersionPrefix }
        );
    }

    return Object.freeze({
        engineApi,
        version: Object.freeze({ api: version.api, build: version.build }),
        getVersion: engineApi.getVersion,
        simulateSingleYear: engineApi.simulateSingleYear
    });
}

/**
 * @param handshake Eingabe für die bestehende Projektion.
 * @param currentEngineApi Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function assertActiveEngineHandshake(handshake, currentEngineApi) {
    if (!handshake) {
        throw new EngineGateError(
            'Kein erfolgreicher Engine-Handshake vorhanden. Berechnungen wurden blockiert.',
            'handshake_missing'
        );
    }
    if (
        currentEngineApi !== handshake.engineApi ||
        currentEngineApi?.getVersion !== handshake.getVersion ||
        currentEngineApi?.simulateSingleYear !== handshake.simulateSingleYear
    ) {
        throw new EngineGateError(
            'Der Engine-Vertrag wurde nach dem Handshake verändert. Berechnungen wurden blockiert.',
            'contract_changed'
        );
    }
    return handshake.engineApi;
}

/**
 * @param payload Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {Partial<import('../../typcheck/balance-ui.js').UpdateSuccessResult>} [payload] @returns {import('../../typcheck/balance-ui.js').UpdateSuccessResult} */
export function createUpdateSuccessResult(payload = {}) {
    return { ok: true, status: BALANCE_UPDATE_STATUS.SUCCESS, ...payload };
}

/**
 * @param reason Eingabe für die bestehende Projektion.
 * @param error Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @returns {import('../../typcheck/balance-ui.js').UpdateHooks & {ok: boolean, status: string, reason: unknown, error?: Error}} @param {unknown} reason @param {unknown} [error] */
export function createBlockedUpdateResult(reason, error = null) {
    const result = { ok: false, status: BALANCE_UPDATE_STATUS.BLOCKED, reason };
    if (error) result.error = normalizeError(error);
    return result;
}

/**
 * @param error Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @returns {import('../../typcheck/balance-ui.js').UpdateHooks & {ok: boolean, status: string, reason: unknown, error?: Error}} @param {unknown} error @param {{phase?: string}} [options] */
export function createUpdateFailureResult(error, { phase = 'update' } = {}) {
    const normalizedError = normalizeError(error);
    /** @type {string} */
    let status = BALANCE_UPDATE_STATUS.BLOCKED;
    if (phase === 'validation' && normalizedError instanceof ValidationError) {
        status = BALANCE_UPDATE_STATUS.VALIDATION_ERROR;
    } else if (phase === 'engine') {
        status = BALANCE_UPDATE_STATUS.ENGINE_ERROR;
    }
    return {
        ok: false,
        status,
        reason: normalizedError instanceof EngineGateError ? normalizedError.reason : phase,
        error: normalizedError
    };
}

/**
 * @param inputData Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function validateBalanceInputs(inputData = {}) {
    const errors = [];
    const minimumFlexAnnual = Number(inputData.minimumFlexAnnual);
    const flexBedarf = Number(inputData.flexBedarf);
    if (Number.isFinite(minimumFlexAnnual) && minimumFlexAnnual < 0) {
        errors.push({
            fieldId: 'minimumFlexAnnual',
            message: 'Mindest-Flex p.a. darf nicht negativ sein.'
        });
    }
    if (
        Number.isFinite(minimumFlexAnnual) &&
        Number.isFinite(flexBedarf) &&
        minimumFlexAnnual > flexBedarf
    ) {
        errors.push({
            fieldId: 'minimumFlexAnnual',
            message: 'Mindest-Flex p.a. darf nicht größer als Flex-Bedarf p.a. sein.'
        });
        errors.push({
            fieldId: 'flexBedarf',
            message: 'Flex-Bedarf p.a. ist die Obergrenze für Mindest-Flex.'
        });
    }
    if (errors.length > 0) {
        throw new ValidationError(errors);
    }
}

/**
 * @param persistentState Eingabe für die bestehende Projektion.
 * @param inputData Eingabe für die bestehende Projektion.
 * @param planInputs Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function prepareEngineLastState(persistentState = {}, inputData = {}, planInputs = inputData) {
    const previousLastState = cloneBalanceState(persistentState.lastState || null);
    return applyGuardrailPlanChange(previousLastState, persistentState.inputs, planInputs);
}

/** Gleiche Rechnung, zusätzliche lesende Diagnose für die aktuelle Balance-Karte. */
/**
 * @param engineApi Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function createBalanceDisplayEngineApi(engineApi) {
    if (!engineApi) return null;
    return { ...engineApi,
        simulateSingleYear: (input, state) => engineApi.simulateSingleYear(input, state, { includeFlexTrace: true }) };
}

/**
 * @param modelResult Eingabe für die bestehende Projektion.
 * @param inputData Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function buildBalanceRendererPayload(modelResult = /** @type {Partial<import("../../typcheck/rechenkern.js").EngineSuccess>} */ ({}), inputData = {}) {
    const cumulativeInflationFactor = modelResult?.diagnosis?.keyParams?.cumulativeInflationFactor;
    return {
        ...(modelResult.ui || {}),
        input: inputData,
        healthBucketDiagnostics: buildBalanceHealthBucketDiagnostics(inputData, { cumulativeInflationFactor })
    };
}

/** Historische Rechenentscheidung liegt nur im haushaltsweiten Lifecycle, nie im Mitglied.
 * Sie ist Resetvergleich, keine Quelle für die aktuellen Engineeingaben.
 */
/**
 * @param persistentState Eingabe für die bestehende Projektion.
 * @param profiles Eingabe für die bestehende Projektion.
 * @param plan Eingabe für die bestehende Projektion.
 * @param options4 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function projectBalancePlanHistory(persistentState, profiles, plan, { profileId = null } = {}) {
    if (plan?.status !== 'valid') return { persistentState, profiles };
    const current = projectPlanToBalance(plan.entry.values);
    const source = profiles[0]?.balanceState || persistentState;
    // Ohne Lifecyclebeleg gelten die bisherigen Eingaben der Rechenauswahl.
    // Eine geöffnete Außenperson liefert keine Planhistorie des Haushalts.
    const ownInputs = profileId && profiles.length && !profiles.some(profile => profile.profileId === profileId)
        ? {} : persistentState.inputs;
    const legacy = { ...source.inputs, ...source.profilverbundHouseholdInputs, ...ownInputs };
    const previous = { ...selectGuardrailPlanInputs(current), ...selectGuardrailPlanInputs(legacy),
        ...persistentState.balanceStateLifecycle?.planInputEvidence?.[plan.scope.key] };
    const project = state => ({ ...state,
        inputs: { ...stripBalancePlanInputs(state.inputs), ...previous },
        profilverbundHouseholdInputs: { ...stripBalancePlanInputs(state.profilverbundHouseholdInputs), ...previous } });
    return { persistentState: project(persistentState), profiles: profiles.map(profile => ({ ...profile,
        balanceState: project(profile.balanceState || {}) })) };
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function enrichBalanceDiagnosisPayload({ formattedDiagnosis, modelResult = /** @type {Partial<import("../../typcheck/rechenkern.js").EngineSuccess>} */ ({}), inputData = /** @type {import("../../typcheck/balance-ui.js").Input} */ ({}), threeBucketDiagnosis = null }) {
    if (!formattedDiagnosis) return formattedDiagnosis;
    if (!inputData.goldAktiv && !(inputData.goldWert > 0) && Array.isArray(formattedDiagnosis.decisionTree)) {
        formattedDiagnosis.decisionTree = formattedDiagnosis.decisionTree.map(item => item.step === 'Verwendung (Restbetrag)'
            ? { ...item, impact: item.impact.replace('Investitionsziele (Aktien/Gold)', 'Investitionsziele (Aktien)') } : item);
    }
    if (modelResult.ui?.action?.transactionDiagnostics) {
        formattedDiagnosis.transactionDiagnostics = modelResult.ui.action.transactionDiagnostics;
    }
    if (modelResult.ui?.vpw) {
        formattedDiagnosis.keyParams = formattedDiagnosis.keyParams || {};
        formattedDiagnosis.keyParams.vpw = modelResult.ui.vpw;
    }
    formattedDiagnosis.keyParams = formattedDiagnosis.keyParams || {};
    formattedDiagnosis.keyParams.healthBucket = buildBalanceHealthBucketDiagnostics(
        inputData,
        { cumulativeInflationFactor: formattedDiagnosis.keyParams.cumulativeInflationFactor }
    );
    if (threeBucketDiagnosis) {
        formattedDiagnosis.threeBucket = threeBucketDiagnosis;
    }
    return formattedDiagnosis;
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function persistBalanceUpdate({
    mode = /** @type {import('../../typcheck/balance-ui.js').UpdateRequest["mode"]} */ (BALANCE_UPDATE_MODE.PREVIEW),
    periodId = null,
    profilverbundRuns,
    profilverbundHandlers,
    storageManager,
    persistentState = {},
    inputData = {},
    modelResult = /** @type {Partial<import('../../typcheck/rechenkern.js').EngineSuccess>} */ ({}),
    fingerprints = {},
    householdPlan = null
}) {
    if (mode === BALANCE_UPDATE_MODE.PREVIEW) {
        return { persisted: false, kind: BALANCE_UPDATE_MODE.PREVIEW };
    }

    const hasProfilverbundRuns = profilverbundRuns !== null && profilverbundRuns !== undefined;
    if (
        hasProfilverbundRuns
        && (!Array.isArray(profilverbundRuns) || profilverbundRuns.length < 1)
    ) {
        throw new BalanceStateLifecycleError(
            'Profilverbund-Persistenz benoetigt mindestens einen gueltigen Profil-Run.',
            'profile_runs_required'
        );
    }

    if (mode === BALANCE_UPDATE_MODE.PERSIST_INPUTS) {
        if (hasProfilverbundRuns) {
            profilverbundHandlers.persistProfilverbundInputs(profilverbundRuns);
        } else {
            storageManager.saveState({
                ...persistentState,
                inputs: cloneBalanceState(householdPlan ? stripBalancePlanInputs(inputData) : inputData)
            });
        }
        if (householdPlan) storageManager.saveState({ ...storageManager.loadState(),
            [BALANCE_STATE_LIFECYCLE_KEY]: buildBalancePlanLifecycle(persistentState, householdPlan,
                { profiles: profilverbundRuns || [], advance: false }) });
        return { persisted: true, kind: BALANCE_UPDATE_MODE.PERSIST_INPUTS };
    }

    if (mode !== BALANCE_UPDATE_MODE.COMMIT_PERIOD) {
        throw new BalanceStateLifecycleError(
            `Unbekannter Persistenzmodus: ${String(mode)}`,
            'invalid_update_mode',
            { mode }
        );
    }

    assertBalancePeriodCommit(persistentState, periodId);
    if (!modelResult?.newState || typeof modelResult.newState !== 'object') {
        throw new BalanceStateLifecycleError(
            'Der periodengebundene Balance-Commit hat keinen gueltigen Candidate-State.',
            'candidate_required',
            { periodId }
        );
    }

    const lifecycle = buildBalanceLifecycleMetadata(persistentState, periodId, fingerprints);
    if (householdPlan) lifecycle.planInputEvidence = buildBalancePlanLifecycle(persistentState, householdPlan).planInputEvidence;
    if (hasProfilverbundRuns) {
        profilverbundHandlers.persistProfilverbundProfileStates(profilverbundRuns, {
            lifecycle
        });
        // Der geöffnete Außenbereich gehört nicht zwingend zu den Runs.
        // Die haushaltsweite Planevidenz bestätigt trotzdem den beschlossenen Plan.
        if (householdPlan) {
            const current = storageManager.loadState();
            storageManager.saveState({ ...current, [BALANCE_STATE_LIFECYCLE_KEY]: {
                ...current[BALANCE_STATE_LIFECYCLE_KEY], planInputEvidence: lifecycle.planInputEvidence
            } });
        }
    } else {
        storageManager.saveState({
            ...persistentState,
            inputs: cloneBalanceState(householdPlan ? stripBalancePlanInputs(inputData) : inputData),
            lastState: cloneBalanceState(modelResult.newState),
            [BALANCE_STATE_LIFECYCLE_KEY]: lifecycle
        });
    }
    return {
        persisted: true,
        kind: BALANCE_UPDATE_MODE.COMMIT_PERIOD,
        lifecycle
    };
}

/**
 * @param state Eingabe für die bestehende Projektion.
 * @param plan Eingabe für die bestehende Projektion.
 * @param options3 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function buildBalancePlanLifecycle(state, plan, { profiles = [], advance = true } = {}) {
    const lifecycle = state?.[BALANCE_STATE_LIFECYCLE_KEY] || {};
    if (!plan) return lifecycle;
    const input = advance ? projectPlanToBalance(plan.entry.values)
        : projectBalancePlanHistory(state, profiles, plan).persistentState.inputs;
    return { ...lifecycle, planInputEvidence: { ...lifecycle.planInputEvidence,
        [plan.scope.key]: selectGuardrailPlanInputs(input) } };
}

/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{ui?: import('../../typcheck/balance-ui.js').Ui}} [options] @returns Monats- und Jahresbudget der Projektion. */
export function calculateExpensesBudget({ ui } = {}) {
    if (!ui) throw new Error('Ausgabenbudget: Das Balance-Ergebnis (ui) fehlt.');
    const { budget: monthlyBudget, saving: monthlySaving } = projectBalanceBudget(ui);
    return { monthlyBudget, annualBudget: monthlyBudget === null ? null : monthlyBudget * 12, monthlySaving };
}
