// @ts-check
import { state, PROFILE_ERROR_DOM_IDS } from './state.js';
import { persistenceStorage, PersistenceFacade } from '../../shared/persistence-facade.js';
import { showEditorErrors } from '../tranchen-manager-income-fields.js';
import { appNow } from '../../shared/app-clock.js';
import { canonicalDecimalInput } from '../tranchen-manager-decimal-input.js';
import { isManagerModalSubmissionCurrent, captureManagerModalSubmission, finishManagerModalSubmission } from '../tranchen-manager-modal.js';

/** @template {string} K
 * @param {K} id
 * @returns {import('../../../typcheck/dom-elements.js').PageElement<K> | null}
 */
export function byId(id) {
    return /** @type {import('../../../typcheck/dom-elements.js').PageElement<K> | null} */ (document.getElementById(id));
}

export function syncGlobalState() {
    window.tranchen = state.tranchen;
}

export function readStoredValue(key, fallback = null) {
    try {
        return persistenceStorage.getItem(key);
    } catch {
        return fallback;
    }
}

export async function restoreManagerRecords(records) {
    let failed = false;
    for (const [key, value] of records) {
        try {
            if (value === null || value === undefined) persistenceStorage.removeItem(key);
            else persistenceStorage.setItem(key, value);
        } catch { failed = true; }
    }
    try { await flushManagerRecords(); } catch { failed = true; }
    return !failed;
}

export async function flushManagerRecords() {
    if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
}

export function clearProfileValidationStatus() {
    const status = byId('profileValidationStatus');
    if (status) {
        status.textContent = '';
        status.hidden = true;
    }
    Object.values(PROFILE_ERROR_DOM_IDS).forEach(id => byId(id)?.removeAttribute?.('aria-invalid'));
}

export function showProfileValidationStatus(error) {
    clearProfileValidationStatus();
    const income = byId('managerIncomeBody');
    const details = (error?.errors || []).map(detail => ({ ...detail, field: PROFILE_ERROR_DOM_IDS[detail.field] || detail.field }));
    const local = details.filter(detail => income?.contains(byId(detail.field)));
    if (local.length) showEditorErrors(document, income, local);
    if (local.length && local.length === details.length) return local[0].message;
    const first = error?.errors?.[0];
    const status = byId('profileValidationStatus');
    const message = first?.message || 'Die Profilwerte sind unvollständig oder ungültig.';
    if (status) {
        status.textContent = `Profilwerte nicht gespeichert: ${message}`;
        status.hidden = false;
    }
    for (const detail of error?.errors || []) byId(PROFILE_ERROR_DOM_IDS[detail.field] || detail.field)?.setAttribute?.('aria-invalid', 'true');
    const field = first ? byId(PROFILE_ERROR_DOM_IDS[first.field] || first.field) : null;
    field?.setAttribute?.('aria-invalid', 'true');
    return message;
}

export function formatReconciliationNumber(value, options = {}) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    const { currency = false, maximumFractionDigits = currency ? 2 : 6 } = options;
    return new Intl.NumberFormat('de-DE', {
        ...(currency ? { style: 'currency', currency: 'EUR' } : {}),
        maximumFractionDigits
    }).format(Number(value));
}

export function localIsoDate(date = appNow()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function managerDecimalSignatureValue(id, value) {
    const raw = String(value ?? '');
    const canonical = byId(id)?.getAttribute?.('inputmode') === 'decimal' ? canonicalDecimalInput(raw, byId(id)) : 'NaN';
    return canonical === 'NaN' ? raw : canonical;
}

// Ein Retry darf einen reinen Kommawechsel nicht als neue Dialogeingabe
// behandeln. Öffnungsidentität und echte Text-/Wertänderungen bleiben geschützt.
export function finishManagerDecimalSubmission(kind, submission, navigationOperation) {
    if (submission && isManagerModalSubmissionCurrent(kind, submission)) {
        const current = captureManagerModalSubmission(kind);
        const canonicalSignature = signature => JSON.stringify(JSON.parse(signature).map(([id, value, checked]) =>
            [id, managerDecimalSignatureValue(id, value), checked]));
        if (canonicalSignature(current.signature) === canonicalSignature(submission.signature)) {
            submission = { ...submission, signature: current.signature };
        }
    }
    return finishManagerModalSubmission(kind, submission, navigationOperation);
}

export function managerInputSignature(ids, values = {}) {
    return JSON.stringify(ids.map(id => {
        const element = /** @type {HTMLInputElement | HTMLSelectElement | HTMLButtonElement} */ (byId(id));
        // Äquivalente Anzeigeformate ausgleichen; ungültige Texte
        // bleiben unterscheidbar und echte Änderungen während Flush sichtbar.
        return [id, managerDecimalSignatureValue(id, Object.hasOwn(values, id) ? values[id] : element?.value), /** @type {HTMLInputElement} */ (element)?.checked === true];
    }));
}

export async function flushManagerHouseholdPlan() {
    if (state.partnership && !await state.partnership.flush()) return false;
    if (state.householdPlan && !await state.householdPlan.flush()) return false;
    return state.plannedExpenses?.flush() || true;
}

export function getManagerCashPostingDiagnostics() {
    return Object.freeze({ pendingCashPosting: state.pendingCashPosting === null ? null : 'pending' });
}
