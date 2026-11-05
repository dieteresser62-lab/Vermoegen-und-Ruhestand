// @ts-check
import { state } from './state.js';
import { byId } from './helpers.js';
import { renderPersistenceState, clearRawPreview } from './persistence-status.js';
import { runManagerOperation, requestManagerDecision } from './history.js';
import { persistTranchen } from './tranches.js';
import { normalizeTranches } from '../tranchen-manager-state.js';
import { render } from './rendering.js';
import { executeCashPosting } from './cash-posting.js';
import { executeReconciliation } from './reconciliation.js';
import { saveProfileValues } from './profile-values.js';

export function describeLegacyTaxMigration(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return '';
    let records;
    try {
        records = JSON.parse(raw);
    } catch {
        return '';
    }
    if (!Array.isArray(records)) return '';
    const legacy = records.filter(record => {
        const version = record?.schemaVersion;
        return version === undefined || version === null || version === 0 || version === 1;
    });
    if (legacy.length === 0) return '';
    const goldExemptions = legacy.filter(record => (
        (record?.category === 'gold' || record?.type === 'gold' || record?.kind === 'gold')
        && Number(record?.tqf) === 1
        && typeof record?.taxExempt !== 'boolean'
    )).length;
    const resetNonEquityTqf = legacy.filter(record => (
        record?.category !== 'equity'
        && Number(record?.tqf) > 0
        && !((record?.category === 'gold' || record?.type === 'gold' || record?.kind === 'gold') && Number(record?.tqf) === 1)
    )).length;
    return `${legacy.length} Legacy-Tranche(n) wurden nur fuer die Anzeige auf den heutigen Steuervertrag migriert: `
        + `Steuerfreiheit standardmaessig nein, ${goldExemptions} alte Gold-TQF-1-Kodierung(en) als explizit steuerfrei, `
        + `${resetNonEquityTqf} unbelegte Nicht-Aktien-TQF auf 0. Bis Sie jede Tranche fachlich pruefen und speichern, `
        + 'rechnet die Simulation mit diesen konservativen Annahmen.';
}

export function revealCorruptPayload() {
    if (state.loadStatus !== 'corrupt' || typeof state.corruptRaw !== 'string') return;
    const preview = byId('corruptPayloadPreview');
    const copyButton = byId('copyCorruptPayloadBtn');
    state.rawRevealed = true;
    if (preview) {
        preview.textContent = state.corruptRaw;
        preview.hidden = false;
    }
    if (copyButton) copyButton.hidden = false;
}

export async function copyCorruptPayload() {
    if (!state.rawRevealed || typeof state.corruptRaw !== 'string') return;
    try {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await globalThis.navigator.clipboard.writeText(state.corruptRaw);
        state.persistenceMessage = 'Rohdaten wurden bewusst in die Zwischenablage kopiert.';
        state.persistenceError = '';
    } catch {
        state.persistenceError = 'Automatisches Kopieren ist nicht verfügbar. Die eingeblendeten Rohdaten können manuell markiert werden.';
    }
    renderPersistenceState();
}

export async function resetCorruptPayload() {
    if (state.navigationLifecycle?.isBlocked() || state.loadStatus !== 'corrupt') return false;
    return runManagerOperation(async operation => {
        if (!await requestManagerDecision({ title: 'Bestand zurücksetzen', confirmLabel: 'Bestand zurücksetzen', danger: true,
            opener: document.activeElement, description: 'Beschädigte Tranchen wirklich dauerhaft durch einen leeren Bestand ersetzen?\n\nDie Originaldaten gehen dabei verloren. Prüfe vorher Dein Backup oder die Rohdatenkopie.' }, operation)) return false;
        return persistTranchen([], { navigationOperation: operation,
            successMessage: 'Beschädigte Tranchen wurden bestätigt zurückgesetzt.', allowRecovery: true, onSuccess: () => byId('depotAddTrancheBtn')?.focus?.() });
    });
}

export function applyLoadResult(result) {
    state.registryDisplayRaw = undefined;
    state.persistenceMessage = '';
    state.persistenceError = '';
    state.taxMigrationWarning = '';
    state.pendingCommit = null;
    state.pendingReconciliation = null;
    state.pendingCashPosting = null;
    state.reconciliationPreview = null;
    state.reconciliationStatus = '';
    state.reconciliationError = '';
    clearRawPreview();

    if (result?.status === 'valid' || result?.status === 'empty') {
        const loaded = normalizeTranches(result.tranches || []);
        state.tranchen = loaded;
        state.confirmedTranches = loaded;
        state.confirmedRaw = result.raw;
        state.corruptRaw = null;
        state.loadStatus = result.status;
        state.taxMigrationWarning = describeLegacyTaxMigration(result.raw);
    } else if (result?.status === 'corrupt') {
        state.loadStatus = 'corrupt';
        state.corruptRaw = result.raw;
    } else {
        state.loadStatus = 'unavailable';
    }

    render();
    renderPersistenceState();
}

export function retryLoad() {
    if (state.navigationLifecycle?.isBlocked()) return;
    applyLoadResult(state.loader());
}

export async function retryPendingCommit() {
    if (state.navigationLifecycle?.isBlocked()) return;
    if (state.pendingCashPosting) {
        await executeCashPosting(state.pendingCashPosting);
        return;
    }
    if (state.pendingReconciliation) {
        await executeReconciliation(state.pendingReconciliation, { requireConfirmation: false });
        return;
    }
    if (state.pendingCommit) {
        const pending = state.pendingCommit;
        await persistTranchen(pending.tranches, pending);
        return;
    }
    if (state.pendingProfileValues) {
        await saveProfileValues(state.pendingProfileValues);
    }
}
