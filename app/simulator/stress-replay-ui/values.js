/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @import * as RuntimeTypes from '../../../typcheck/runtime-contracts.js' */

"use strict";

/** @type {Readonly<{status: string; workspace: RuntimeTypes.JsonRecord | null; compatibility: RuntimeTypes.JsonRecord | null; error: {code: string; message: string} | null}>} */
export const EMPTY_STATE = Object.freeze({ status: 'empty', workspace: null, compatibility: null, error: null });

/** @type {Readonly<{status: string; error: {code: string; message: string} | null}>} */
export const IDLE_COMPARISON_STATE = Object.freeze({ status: 'idle', error: null });

export function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export function focusElement(element) {
    if (typeof element?.focus !== 'function') return;
    try {
        element.focus({ preventScroll: false });
    } catch {
        element.focus();
    }
}

export function shortFingerprint(fingerprint) {
    const value = fingerprint?.value;
    return typeof value === 'string' ? `${value.slice(0, 12)}…${value.slice(-8)}` : 'nicht verfügbar';
}

export function terminalLabel(status) {
    if (status === 'ruin') return 'Vermögen aufgebraucht';
    if (status === 'all_dead') return 'Haushalt verstorben';
    if (status === 'horizon_exhausted') return 'Horizont erreicht';
    return String(status || 'unbekannt');
}

export function continuationLabel(path) {
    if (path?.continuation?.active === true) return 'deterministischer Restpfad nach Vermögensaufbrauch';
    return 'keine Fortsetzung erforderlich';
}

export function getPath(value, path) {
    return path.split('.').reduce((cursor, segment) => cursor?.[segment], value);
}

export function setPath(target, path, value) {
    const segments = path.split('.');
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index++) {
        cursor[segments[index]] ??= {};
        cursor = cursor[segments[index]];
    }
    cursor[segments.at(-1)] = value;
}

export function readVariantPatch(form) {
    const patch = {};
    for (const control of form?.querySelectorAll?.('[data-stress-replay-path]') || []) {
        if (control.value === '') continue;
        const type = control.dataset.valueType;
        const value = type === 'boolean' ? control.value === 'true'
            : type === 'number' ? Number(control.value)
                : control.value;
        setPath(patch, control.dataset.stressReplayPath, value);
    }
    return patch;
}

export function formatBaselineValue(value, format) {
    if (typeof value === 'boolean') return value ? 'aktiv' : 'inaktiv';
    if (value === undefined || value === null || value === '') return 'nicht gesetzt';
    if (format === 'currency-eur' && Number.isFinite(value)) {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(value);
    }
    return String(value);
}

export function formatNeedCurrency(value) {
    return Number.isFinite(value)
        ? new Intl.NumberFormat('de-DE', {
            style: 'currency', currency: 'EUR', maximumFractionDigits: 0
        }).format(value)
        : 'unbekannt';
}

export function comparisonErrorDiagnostic(error) {
    const rawCode = typeof error?.code === 'string' ? error.code.trim() : '';
    const code = /^[A-Z0-9_:-]{1,80}$/.test(rawCode)
        ? rawCode
        : 'STRESS_REPLAY_COMPARISON_FAILED';
    const rawMessage = formatStressReplayUiError(error);
    const message = String(rawMessage || 'Der Variantenvergleich konnte nicht berechnet werden.')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500) || 'Der Variantenvergleich konnte nicht berechnet werden.';
    return Object.freeze({ code, message });
}

export function comparisonResultIsUsable(computed) {
    return computed
        && typeof computed === 'object'
        && computed.comparison
        && typeof computed.comparison === 'object'
        && Array.isArray(computed.comparison.variants)
        && computed.comparison.variants.length > 0;
}

/**
 * @param error - Fehlerdiagnose.
 * @returns Darstellung der übergebenen Laufdaten.
 */
export function formatStressReplayUiError(error) {
    const code = error?.code;
    if (code === 'STRESS_REPLAY_MINIMUM_FLEX_EXCEEDS_FLEX') {
        return `Mindest-Flex p. a. (${formatNeedCurrency(error?.details?.minimumFlexAnnual)}) darf den effektiven Flex-Bedarf p. a. (${formatNeedCurrency(error?.details?.startFlexBedarf)}) nicht überschreiten.`;
    }
    if (code === 'STRESS_REPLAY_SOURCE_UNSUPPORTED') {
        return 'Dieser Monte-Carlo-Lauf nutzt den Legacy-Zufallsstrom und kann in V1 nicht fixiert werden.';
    }
    if (code === 'STRESS_REPLAY_REPLACE_CONFIRMATION_REQUIRED') {
        return 'Der vorhandene Stresspfad wurde nicht ersetzt.';
    }
    if (code === 'STRESS_REPLAY_VERSION_UNSUPPORTED'
        && error?.details?.schemaVersion === 'StressReplaySourceIdentityV1') {
        return 'Dieser Arbeitsstand ist nur zur Inspektion verfügbar. Bitte den Stresspfad neu fixieren.';
    }
    if (code === 'STRESS_REPLAY_BASELINE_RECONCILIATION_FAILED'
        || code === 'STRESS_REPLAY_RECONCILIATION_FAILED') {
        return 'Der Pfad stimmt nicht vollständig mit dem Ursprungslauf überein und wurde nicht gespeichert.';
    }
    return error?.message || String(error || 'Unbekannter Fehler');
}
