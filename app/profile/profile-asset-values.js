import { PERSON_VALUE_KEYS, validatePersonValues, personAge, personReferenceYear, personDateInputToIso, personDateDisplay, personGenderAssumed, describePersonDates } from './profile-person-data.js';
import { PROFILE_CASH_HISTORY_KEY, appendCashHistory } from './profile-wealth-history.js';
import { canonicalDecimalInput, displayDecimalInput, isEditableDecimalInput } from '../tranches/tranchen-manager-decimal-input.js';
// @ts-check

import { CONFIG } from '../balance/balance-config.js';
import {
    PROFILE_HEALTH_BUCKET_KEY,
    PROFILE_VALUE_KEYS,
    normalizeProfileHealthBucket,
    readProfileHealthBucketFromStorage,
    serializeProfileHealthBucket
} from './profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { setFieldState } from '../shared/field-state.js';

export const DEFAULT_PROFILE_ASSET_VALUES = {
    tagesgeld: 0,
    renteAktiv: false,
    renteMonatlich: 0,
    sonstigeEinkuenfte: 0,
    alter: null,
    goldAktiv: false,
    goldZiel: 7.5,
    goldFloor: 1,
    goldBand: 25,
    goldSteuerfrei: false,
    healthBucket: normalizeProfileHealthBucket()
};

const PROFILE_BOOLEAN_FIELDS = new Set(['goldAktiv', 'goldSteuerfrei']);
const HEALTH_BUCKET_OPTIONS = Object.freeze({
    assetSource: new Set(['money_market_first_then_cash']),
    triggerMode: new Set(['OR', 'AND']),
    coverageMode: new Set(['care_additional_floor_only', 'floor_when_care_active']),
    returnMode: new Set(['cash_return']),
    targetMode: new Set(['inflation_indexed_diagnostic', 'nominal_fixed'])
});

export class ProfileAssetValuesValidationError extends Error {
    constructor(errors) {
        super('Die Profilwerte sind ungültig.');
        this.name = 'ProfileAssetValuesValidationError';
        this.code = 'PROFILE_ASSET_VALUES_INVALID';
        this.errors = errors;
    }
}

function nonNegativeFinite(raw) {
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Builds the household gold contract from per-profile euro bases.
 *
 * Each entry must already describe its assets exactly once. The helper only
 * removes the supported dedicated care reserve from operative liquidity and
 * translates the summed euro targets back into the household percentages
 * consumed by the existing engine contract.
 */
export function calculateProfileGoldStrategy(profileEntries = []) {
    const entries = Array.isArray(profileEntries) ? profileEntries : [];
    const diagnostics = entries.map((entry, index) => {
        const assetBase = nonNegativeFinite(entry?.assetBase);
        const operativeLiquidity = Math.min(
            assetBase,
            nonNegativeFinite(entry?.operativeLiquidity)
        );
        const healthBucket = normalizeProfileHealthBucket(entry?.healthBucket);
        const excludedHealthBucket = healthBucket.enabled
            ? Math.min(operativeLiquidity, nonNegativeFinite(healthBucket.initialAmount))
            : 0;
        const freeAssetBase = Math.max(0, assetBase - excludedHealthBucket);
        const goldActive = entry?.goldAktiv === true;
        const targetPct = goldActive ? nonNegativeFinite(entry?.goldZielProzent) : 0;
        const floorPct = goldActive ? nonNegativeFinite(entry?.goldFloorProzent) : 0;
        const targetAmount = freeAssetBase * (targetPct / 100);
        const floorAmount = freeAssetBase * (floorPct / 100);
        const rebalancingBand = goldActive
            ? nonNegativeFinite(entry?.rebalancingBand)
            : 0;

        return {
            profileId: String(entry?.profileId || `profile_${index + 1}`),
            name: String(entry?.name || entry?.profileId || `Profil ${index + 1}`),
            assetBase,
            operativeLiquidity,
            excludedHealthBucket,
            freeAssetBase,
            goldAktiv: goldActive,
            goldZielProzent: targetPct,
            goldFloorProzent: floorPct,
            goldZielBetrag: targetAmount,
            goldFloorBetrag: floorAmount,
            rebalancingBand,
            goldSteuerfrei: goldActive && entry?.goldSteuerfrei === true
        };
    });

    const goldBasisVermoegen = diagnostics.reduce((sum, entry) => sum + entry.freeAssetBase, 0);
    const goldZielBetrag = diagnostics.reduce((sum, entry) => sum + entry.goldZielBetrag, 0);
    const goldFloorBetrag = diagnostics.reduce((sum, entry) => sum + entry.goldFloorBetrag, 0);
    const activeGoldEntries = diagnostics.filter(entry => entry.goldAktiv && entry.goldZielBetrag > 0);
    const goldAktiv = goldZielBetrag > 0 && goldBasisVermoegen > 0;
    const goldZielProzent = goldAktiv
        ? (goldZielBetrag / goldBasisVermoegen) * 100
        : 0;
    const goldFloorProzent = goldAktiv
        ? (goldFloorBetrag / goldBasisVermoegen) * 100
        : 0;
    const rebalancingBand = goldZielBetrag > 0
        ? activeGoldEntries.reduce(
            (sum, entry) => sum + (entry.rebalancingBand * entry.goldZielBetrag),
            0
        ) / goldZielBetrag
        : 0;

    return {
        goldAktiv,
        goldBasisVermoegen,
        goldZielBetrag,
        goldFloorBetrag,
        goldZielProzent,
        goldFloorProzent,
        rebalancingBand,
        goldSteuerfrei: activeGoldEntries.length > 0
            && activeGoldEntries.every(entry => entry.goldSteuerfrei),
        diagnostics
    };
}

function profileFieldError(field, message, value) {
    return { code: 'PROFILE_ASSET_FIELD_INVALID', field, message, value };
}

function readStrictNumber(raw, field, errors, options = {}) {
    const { min = null, max = null, integer = false } = options;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        errors.push(profileFieldError(field, `${field} ist erforderlich.`, raw));
        return null;
    }
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value)) {
        errors.push(profileFieldError(field, `${field} muss eine endliche Zahl sein.`, raw));
        return null;
    }
    if ((min !== null && value < min) || (max !== null && value > max) || (integer && !Number.isInteger(value))) {
        const interval = min !== null && max !== null
            ? `zwischen ${min} und ${max}`
            : min !== null ? `mindestens ${min}` : `höchstens ${max}`;
        errors.push(profileFieldError(field, `${field} muss ${interval}${integer ? ' und ganzzahlig' : ''} sein.`, raw));
    }
    return value;
}

function readStrictBool(raw, field, errors) {
    if (raw === true || raw === false) return raw;
    const value = String(raw ?? '').trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    errors.push(profileFieldError(field, `${field} muss Ja oder Nein sein.`, raw));
    return false;
}

function readStrictOption(raw, field, allowed, errors, transform = value => value) {
    const value = transform(String(raw ?? '').trim());
    if (!allowed.has(value)) {
        errors.push(profileFieldError(field, `${field} enthält keine unterstützte Auswahl.`, raw));
    }
    return value;
}

export function validateProfileAssetValues(values = {}) {
    let person;
    try { person = validatePersonValues(values); }
    catch (error) { throw new ProfileAssetValuesValidationError(error.errors || [{ field: 'geburtsdatum', message: error.message }]); }
    const errors = [];
    const healthBucket = values?.healthBucket && typeof values.healthBucket === 'object'
        ? values.healthBucket
        : {};
    const validated = {
        ...person,
        tagesgeld: readStrictNumber(values.tagesgeld, 'tagesgeld', errors, { min: 0 }),
        renteMonatlich: readStrictNumber(values.renteMonatlich, 'renteMonatlich', errors, { min: 0 }),
        sonstigeEinkuenfte: readStrictNumber(values.sonstigeEinkuenfte, 'sonstigeEinkuenfte', errors, { min: 0 }),
        alter: values.alter ?? null,
        goldAktiv: readStrictBool(values.goldAktiv, 'goldAktiv', errors),
        goldZiel: readStrictNumber(values.goldZiel, 'goldZiel', errors, { min: 0, max: 100 }),
        goldFloor: readStrictNumber(values.goldFloor, 'goldFloor', errors, { min: 0, max: 100 }),
        goldBand: readStrictNumber(values.goldBand, 'goldBand', errors, { min: 0, max: 100 }),
        goldSteuerfrei: readStrictBool(values.goldSteuerfrei, 'goldSteuerfrei', errors),
        healthBucket: {
            enabled: readStrictBool(healthBucket.enabled, 'healthBucket.enabled', errors),
            initialAmount: readStrictNumber(healthBucket.initialAmount, 'healthBucket.initialAmount', errors, { min: 0 }),
            assetSource: readStrictOption(healthBucket.assetSource, 'healthBucket.assetSource', HEALTH_BUCKET_OPTIONS.assetSource, errors),
            triggerMinGrade: readStrictNumber(healthBucket.triggerMinGrade, 'healthBucket.triggerMinGrade', errors, { min: 1, max: 5, integer: true }),
            triggerMode: readStrictOption(healthBucket.triggerMode, 'healthBucket.triggerMode', HEALTH_BUCKET_OPTIONS.triggerMode, errors, value => value.toUpperCase()),
            coverageMode: readStrictOption(healthBucket.coverageMode, 'healthBucket.coverageMode', HEALTH_BUCKET_OPTIONS.coverageMode, errors),
            returnMode: readStrictOption(healthBucket.returnMode, 'healthBucket.returnMode', HEALTH_BUCKET_OPTIONS.returnMode, errors),
            targetMode: readStrictOption(healthBucket.targetMode, 'healthBucket.targetMode', HEALTH_BUCKET_OPTIONS.targetMode, errors)
        }
    };

    for (const field of PROFILE_BOOLEAN_FIELDS) {
        if (typeof validated[field] !== 'boolean') {
            errors.push(profileFieldError(field, `${field} muss boolesch sein.`, values[field]));
        }
    }
    if (errors.length) throw new ProfileAssetValuesValidationError(errors);
    validated.renteAktiv = validated.renteMonatlich + validated.sonstigeEinkuenfte > 0;
    return validated;
}

function readNumber(raw, fallback = 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function readBool(raw, fallback = false) {
    if (raw === true || raw === false) return raw;
    if (raw === null || raw === undefined || raw === '') return fallback;
    return String(raw).toLowerCase() === 'true';
}

export function readProfileStoredInputs(storage = persistenceStorage) {
    const raw = storage.getItem(CONFIG.STORAGE.LS_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed?.inputs || {};
    } catch {
        return {};
    }
}

export function normalizeProfileAssetValues(values = {}) {
    const renteMonatlich = readNumber(values.renteMonatlich, 0);
    const sonstigeEinkuenfte = readNumber(values.sonstigeEinkuenfte, 0);
    return {
        genderAssumed: values.genderAssumed === true,
        tagesgeld: readNumber(values.tagesgeld, 0),
        renteAktiv: renteMonatlich + sonstigeEinkuenfte > 0,
        renteMonatlich,
        sonstigeEinkuenfte,
        alter: values.alter === null || values.alter === undefined ? null : readNumber(values.alter, null),
        ...Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).filter(([field]) => !['personSchemaVersion', 'personMigration'].includes(field)).map(([field]) => [field, values[field] ?? (field === 'geschlecht' ? 'm' : field === 'rentenanpassungArt' ? 'wage' : ['geburtsdatum', 'rentenbeginn'].includes(field) ? '' : 0)])),
        goldAktiv: readBool(values.goldAktiv, false),
        goldZiel: readNumber(values.goldZiel, DEFAULT_PROFILE_ASSET_VALUES.goldZiel),
        goldFloor: readNumber(values.goldFloor, DEFAULT_PROFILE_ASSET_VALUES.goldFloor),
        goldBand: readNumber(values.goldBand, DEFAULT_PROFILE_ASSET_VALUES.goldBand),
        goldSteuerfrei: readBool(values.goldSteuerfrei, false),
        healthBucket: normalizeProfileHealthBucket(values.healthBucket)
    };
}

export function loadProfileAssetValues(storage = persistenceStorage) {
    const storedInputs = readProfileStoredInputs(storage);
    const healthBucket = readProfileHealthBucketFromStorage(storage);
    const tagesgeldRaw = storage.getItem(PROFILE_VALUE_KEYS.tagesgeld);
    const renteMonatlichRaw = storage.getItem(PROFILE_VALUE_KEYS.renteMonatlich);
    const sonstigeEinkuenfteRaw = storage.getItem(PROFILE_VALUE_KEYS.sonstigeEinkuenfte);
    const personData = Object.fromEntries(Object.values(PROFILE_VALUE_KEYS).map(key => [key, storage.getItem(key)]));
    const rawState = storage.getItem(CONFIG.STORAGE.LS_KEY);
    const year = personReferenceYear(rawState ? JSON.parse(rawState).annualPeriodMetadata : null);
    const age = personAge(personData, year);
    const goldAktivRaw = storage.getItem(PROFILE_VALUE_KEYS.goldAktiv);
    const goldZielRaw = storage.getItem(PROFILE_VALUE_KEYS.goldZiel);
    const goldFloorRaw = storage.getItem(PROFILE_VALUE_KEYS.goldFloor);
    const goldBandRaw = storage.getItem(PROFILE_VALUE_KEYS.goldRebalBand);
    const goldSteuerfreiRaw = storage.getItem(PROFILE_VALUE_KEYS.goldSteuerfrei);

    return normalizeProfileAssetValues({
        ...Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).map(([field, key]) => [field, personData[key]])),
        tagesgeld: tagesgeldRaw !== null ? tagesgeldRaw : storedInputs.tagesgeld,
        renteMonatlich: renteMonatlichRaw ?? 0,
        sonstigeEinkuenfte: sonstigeEinkuenfteRaw ?? 0,
        alter: age.age,
        genderAssumed: personGenderAssumed(personData),
        goldAktiv: goldAktivRaw !== null ? goldAktivRaw : storedInputs.goldAktiv,
        goldZiel: goldZielRaw !== null ? goldZielRaw : storedInputs.goldZielProzent,
        goldFloor: goldFloorRaw !== null ? goldFloorRaw : storedInputs.goldFloorProzent,
        goldBand: goldBandRaw !== null ? goldBandRaw : storedInputs.rebalancingBand,
        goldSteuerfrei: goldSteuerfreiRaw !== null ? goldSteuerfreiRaw : storedInputs.goldSteuerfrei,
        healthBucket
    });
}

// Ausschließlich Darstellung der bestehenden normalisierten Rentenableitung.
export function applyProfileRenteStatusToDom(values, doc = document) {
    const normalized = normalizeProfileAssetValues(values);
    const field = doc.getElementById('profileRenteAktiv');
    if (!field) return;
    field.value = normalized.renteAktiv ? 'true' : 'false';
    field.disabled = true;
    if (field.ownerDocument && field.parentNode) {
        const raw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const year = personReferenceYear(raw ? JSON.parse(raw).annualPeriodMetadata : null);
        const status = describePersonDates({ profile_rentenbeginn: normalized.rentenbeginn }, year).pensionStatus;
        setFieldState(field, 'adopted', `${status} · Status abgeleitet; sonstige Einkünfte wirken unabhängig.`);
    }
}

export function applyProfileAssetValuesToDom(values, doc = document, { preserveActiveDecimalInput = false } = {}) {
    const normalized = normalizeProfileAssetValues(values);
    if (!preserveActiveDecimalInput && doc.getElementById('profilePensionSegments')) delete doc.getElementById('profilePensionSegments').dataset.explicitFixed;
    const assign = (id, value, transform = v => v) => {
        const el = doc.getElementById(id);
        if (!el) return;
        if (preserveActiveDecimalInput && doc.activeElement === el && isEditableDecimalInput(el)) {
            const canonical = canonicalDecimalInput(el.value, el);
            if (canonical !== '' && canonical !== 'NaN' && Number(canonical) === value) return;
        }
        el.value = el.getAttribute?.('inputmode') === 'decimal'
            ? displayDecimalInput(transform(value), el, { editing: doc.activeElement === el }) : transform(value);
    };

    assign('profileTagesgeld', normalized.tagesgeld);
    applyProfileRenteStatusToDom(normalized, doc);
    assign('profileRenteMonatlich', normalized.renteMonatlich);
    assign('profileSonstigeEinkuenfte', normalized.sonstigeEinkuenfte);
    assign('profileAlter', normalized.alter ?? '');
    const ageField = doc.getElementById('profileAlter');
    if (ageField) ageField.disabled = true;
    for (const field of PERSON_FORM_FIELDS) assign(PERSON_FORM_IDS[field], normalized[field], ['geburtsdatum', 'rentenbeginn'].includes(field) ? personDateDisplay : value => value);
    assign('profileGoldAktiv', normalized.goldAktiv, v => v ? 'true' : 'false');
    assign('profileGoldZiel', normalized.goldZiel);
    assign('profileGoldFloor', normalized.goldFloor);
    assign('profileGoldBand', normalized.goldBand);
    assign('profileGoldSteuerfrei', normalized.goldSteuerfrei, v => v ? 'true' : 'false');
    assign('profileHealthBucketEnabled', normalized.healthBucket.enabled, v => v ? 'true' : 'false');
    assign('profileHealthBucketInitialAmount', normalized.healthBucket.initialAmount);
    assign('profileHealthBucketAssetSource', normalized.healthBucket.assetSource);
    assign('profileHealthBucketTriggerMinGrade', normalized.healthBucket.triggerMinGrade);
    assign('profileHealthBucketTriggerMode', normalized.healthBucket.triggerMode);
    assign('profileHealthBucketCoverageMode', normalized.healthBucket.coverageMode);
    assign('profileHealthBucketReturnMode', normalized.healthBucket.returnMode);
    assign('profileHealthBucketTargetMode', normalized.healthBucket.targetMode);
}

export function readProfileAssetValuesFromDom(doc = document) {
    const decimalFields = new Set(['profileTagesgeld', 'profileRenteMonatlich', 'profileSonstigeEinkuenfte', 'profileGoldZiel', 'profileGoldFloor', 'profileGoldBand', 'profileHealthBucketInitialAmount', 'profileRentenanpassungPct', 'profileKirchensteuerPct', 'profileSparerPauschbetrag', 'profileRenteSteuerquotePct']);
    const read = id => {
        const raw = doc.getElementById(id)?.value ?? '';
        if (['profileGeburtsdatum', 'profileRentenbeginn'].includes(id)) return personDateInputToIso(raw) ?? raw;
        return decimalFields.has(id) ? canonicalDecimalInput(raw, doc.getElementById(id)) : raw;
    };
    return validateProfileAssetValues({
        genderConfirmed: doc.getElementById('profileGeschlecht')?.dataset?.genderConfirmed === 'true',
        ...Object.fromEntries(PERSON_FORM_FIELDS.map(field => [field, read(PERSON_FORM_IDS[field])])),
        tagesgeld: read('profileTagesgeld'),
        renteMonatlich: read('profileRenteMonatlich'),
        sonstigeEinkuenfte: read('profileSonstigeEinkuenfte'),
        alter: read('profileAlter'),
        goldAktiv: read('profileGoldAktiv'),
        goldZiel: read('profileGoldZiel'),
        goldFloor: read('profileGoldFloor'),
        goldBand: read('profileGoldBand'),
        goldSteuerfrei: read('profileGoldSteuerfrei'),
        healthBucket: {
            enabled: read('profileHealthBucketEnabled'),
            initialAmount: read('profileHealthBucketInitialAmount'),
            assetSource: read('profileHealthBucketAssetSource'),
            triggerMinGrade: read('profileHealthBucketTriggerMinGrade'),
            triggerMode: read('profileHealthBucketTriggerMode'),
            coverageMode: read('profileHealthBucketCoverageMode'),
            returnMode: read('profileHealthBucketReturnMode'),
            targetMode: read('profileHealthBucketTargetMode')
        }
    });
}

export function saveProfileAssetValues(values, storage = persistenceStorage, { recordCashChange = false, date, confirmGender = false } = {}) {
    const normalized = validateProfileAssetValues(values);
    const migrationRaw = storage.getItem(PERSON_VALUE_KEYS.personMigration);
    const assumed = personGenderAssumed({ profile_geschlecht: storage.getItem(PERSON_VALUE_KEYS.geschlecht), profile_person_migration_v1: migrationRaw });
    let metadata;
    if (assumed) {
        const balanceRaw = storage.getItem(CONFIG.STORAGE.LS_KEY);
        metadata = migrationRaw ? JSON.parse(migrationRaw) : {
            referenceYear: personReferenceYear(balanceRaw ? JSON.parse(balanceRaw).annualPeriodMetadata : null)
        };
    }
    // Nur der bestätigende Managerpfad nimmt die Historie in seinen Commit auf.
    if (recordCashChange) {
        const raw = storage.getItem(PROFILE_CASH_HISTORY_KEY);
        const history = appendCashHistory(raw, loadProfileAssetValues(storage).tagesgeld, normalized.tagesgeld, date);
        if (history && JSON.stringify(history) !== raw) storage.setItem(PROFILE_CASH_HISTORY_KEY, JSON.stringify(history));
    }
    storage.setItem(PROFILE_VALUE_KEYS.tagesgeld, String(normalized.tagesgeld));
    storage.setItem(PROFILE_VALUE_KEYS.renteAktiv, normalized.renteAktiv ? 'true' : 'false');
    storage.setItem(PROFILE_VALUE_KEYS.renteMonatlich, String(normalized.renteMonatlich));
    storage.setItem(PROFILE_VALUE_KEYS.sonstigeEinkuenfte, String(normalized.sonstigeEinkuenfte));
    for (const field of PERSON_FORM_FIELDS) storage.setItem(PERSON_VALUE_KEYS[field], String(normalized[field]));
    storage.setItem(PERSON_VALUE_KEYS.personSchemaVersion, '1');
    if (assumed) {
        metadata.sources ||= {};
        metadata.sources.geschlecht = [confirmGender ? 'bestätigt' : 'angenommen'];
        storage.setItem(PERSON_VALUE_KEYS.personMigration, JSON.stringify(metadata));
    }
    storage.setItem(PROFILE_VALUE_KEYS.goldAktiv, normalized.goldAktiv ? 'true' : 'false');
    storage.setItem(PROFILE_VALUE_KEYS.goldZiel, String(normalized.goldZiel));
    storage.setItem(PROFILE_VALUE_KEYS.goldFloor, String(normalized.goldFloor));
    storage.setItem(PROFILE_VALUE_KEYS.goldRebalBand, String(normalized.goldBand));
    storage.setItem(PROFILE_VALUE_KEYS.goldSteuerfrei, normalized.goldSteuerfrei ? 'true' : 'false');
    storage.setItem(PROFILE_HEALTH_BUCKET_KEY, serializeProfileHealthBucket(normalized.healthBucket));
    return normalized;
}

export const PERSON_FORM_IDS = Object.freeze({ geburtsdatum: 'profileGeburtsdatum', geschlecht: 'profileGeschlecht',
    rentenbeginn: 'profileRentenbeginn', rentenanpassungArt: 'profileRentenanpassungArt', rentenanpassungPct: 'profileRentenanpassungPct',
    kirchensteuerPct: 'profileKirchensteuerPct', sparerPauschbetrag: 'profileSparerPauschbetrag', renteSteuerquotePct: 'profileRenteSteuerquotePct' });
export const PERSON_FORM_FIELDS = Object.freeze(Object.keys(PERSON_FORM_IDS));
