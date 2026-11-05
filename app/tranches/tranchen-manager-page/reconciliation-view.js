// @ts-check
import { byId, formatReconciliationNumber, localIsoDate } from './helpers.js';
import { loadReconciliationRegistryFromStorage } from '../tranchen-manager-state.js';
import { state } from './state.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { projectReconciliationCashStatuses, TrancheReconciliationError } from '../tranche-reconciliation.js';
import { syncSelectionText } from '../../shared/designsystem-selection-text.js';
import { processingIsBlocked } from './controls.js';
import { ensureReconciliationCashControls, renderReconciliationCashStatuses } from '../tranchen-manager-renderer.js';

export function setReconciliationStatus(message = '', kind = '') {
    const saleStatus = byId('saleStatus');
    if (saleStatus) { saleStatus.textContent = message; saleStatus.dataset.kind = kind; }
    const target = byId('reconciliationStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
}

export function refreshReconciliationCashStatuses() {
    const loaded = loadReconciliationRegistryFromStorage(state.registryDisplayRaw === undefined ? persistenceStorage : {
        getItem: () => state.registryDisplayRaw
    });
    if (loaded.status === 'empty') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = '';
        return;
    }
    if (loaded.status !== 'valid') {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = 'Cashstatus-Audit ist nicht lesbar. Bestätigung und Korrektur bleiben blockiert.';
        return;
    }
    try {
        state.reconciliationCashStatuses = projectReconciliationCashStatuses(loaded.registry, state.profileId);
        state.cashStatusError = '';
    } catch (error) {
        state.reconciliationCashStatuses = [];
        state.cashStatusError = error instanceof TrancheReconciliationError
            ? `Cashstatus-Audit blockiert: ${error.message}`
            : 'Cashstatus-Audit ist beschädigt oder nicht unterstützt.';
    }
}

export function syncInitialCashStatusControls() {
    const status = byId('reconcileCashStatus')?.value || 'pending_manual_posting';
    const group = byId('reconcileInitialCashBalanceGroup');
    const input = byId('reconcileInitialCashBalance');
    const confirmed = status === 'confirmed_already_reflected';
    if (group) group.hidden = !confirmed;
    if (input) input.required = confirmed;
}

export function renderReconciliationOptions() {
    const select = byId('reconcileTrancheId');
    if (!select || typeof document.createElement !== 'function') return;
    const previousValue = select.value;
    select.replaceChildren?.();
    if (!select.replaceChildren) select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.tranchen.length > 0
        ? 'Tranche nach Namen auswählen'
        : 'Keine Tranche verfügbar';
    select.appendChild(placeholder);
    state.tranchen.forEach(tranche => {
        const option = document.createElement('option');
        option.value = tranche.trancheId;
        option.textContent = `${tranche.name || 'Tranche'} — ${tranche.trancheId}`;
        select.appendChild(option);
    });
    select.value = state.tranchen.some(tranche => tranche.trancheId === previousValue)
        ? previousValue
        : '';
    syncSelectionText(select);
}

export function renderReconciliationPreview() {
    const container = byId('reconciliationPreview');
    const content = byId('reconciliationPreviewContent');
    const confirmButton = byId('reconciliationConfirmBtn');
    const cancelButton = byId('reconciliationCancelBtn');
    const preview = state.reconciliationPreview?.preview || null;
    if (container) container.hidden = !preview;
    if (confirmButton) {
        confirmButton.hidden = !preview;
        confirmButton.disabled = processingIsBlocked() || preview?.status !== 'ready';
    }
    if (cancelButton) {
        cancelButton.hidden = !preview;
        cancelButton.disabled = state.commitInFlight;
    }
    if (!content) return;
    if (!preview) {
        content.textContent = '';
        return;
    }

    const action = preview.action;
    const after = preview.after;
    const lines = [
        `Profil-ID: ${action.profileId}`,
        `Tranche-ID: ${action.trancheId}`,
        `Action-ID: ${action.actionId}`,
        `Ausführungstag: ${action.executedAt}`,
        '',
        `Ist-Bestand vorher: ${formatReconciliationNumber(preview.before?.shares)} Stück · ${formatReconciliationNumber(preview.before?.marketValue, { currency: true })} Marktwert · ${formatReconciliationNumber(preview.before?.costBasis, { currency: true })} Einstandskosten`,
        `Tatsächliche Ausführung: ${formatReconciliationNumber(preview.execution?.sharesSold)} Stück · ${formatReconciliationNumber(preview.execution?.grossProceeds, { currency: true })} Brutto · ${formatReconciliationNumber(preview.execution?.fees, { currency: true })} Kosten · ${formatReconciliationNumber(preview.execution?.netProceeds, { currency: true })} Netto`,
        action.cashStatus === 'confirmed_already_reflected'
            ? `Cashstatus: bereits berücksichtigt · bestätigter Cashstand ${formatReconciliationNumber(action.cashBalanceAfterPostingEur, { currency: true })} · Nachweiszeitpunkt ${action.cashConfirmedAt}`
            : 'Cashstatus: offen – Nettoerlös nach dem Lot-Commit manuell in der freien Liquidität nachführen und anschließend bestätigen.',
        'Es erfolgt keine automatische Cashbuchung der freien Liquidität.',
        after
            ? `Resultierender Bestand: ${formatReconciliationNumber(after.shares)} Stück · ${formatReconciliationNumber(after.marketValue, { currency: true })} Marktwert · ${formatReconciliationNumber(after.costBasis, { currency: true })} Einstandskosten`
            : 'Resultierender Bestand: Tranche vollständig verkauft und entfernt.'
    ];
    if (preview.deviation) {
        const deviations = [];
        if (Object.prototype.hasOwnProperty.call(preview.deviation, 'sharesSold')) {
            deviations.push(`${formatReconciliationNumber(preview.deviation.sharesSold)} Stück`);
        }
        if (Object.prototype.hasOwnProperty.call(preview.deviation, 'grossProceeds')) {
            deviations.push(formatReconciliationNumber(preview.deviation.grossProceeds, { currency: true }));
        }
        lines.push(`Abweichung zur optional erfassten Empfehlung: ${deviations.join(' · ')}`);
    } else {
        lines.push('Empfehlungsvergleich: keine Referenz erfasst; tatsächliche Ausführung bleibt maßgeblich.');
    }
    if (preview.status === 'duplicate') {
        lines.push('', 'Diese Action-ID wurde mit denselben Ausführungsdaten bereits angewendet. Es erfolgt keine weitere Bestandsänderung.');
    }
    content.textContent = lines.join('\n');
}

export function renderReconciliationState() {
    const form = byId('reconciliationForm');
    if (!form) return;
    const cashContainer = ensureReconciliationCashControls(document);
    syncInitialCashStatusControls();
    renderReconciliationOptions();
    const dateInput = byId('reconcileExecutedAt');
    if (dateInput && !dateInput.value) dateInput.value = localIsoDate();
    const previewButton = byId('reconciliationPreviewBtn');
    if (previewButton) previewButton.disabled = processingIsBlocked() || state.tranchen.length === 0;
    renderReconciliationPreview();
    renderReconciliationCashStatuses(cashContainer, state.reconciliationCashStatuses, {
        errorMessage: state.cashStatusError
    });
    if (state.cashStatusError) {
        setReconciliationStatus(state.cashStatusError, 'error');
    } else if (state.reconciliationError) {
        setReconciliationStatus(state.reconciliationError, 'error');
    } else if (state.reconciliationStatus) {
        setReconciliationStatus(state.reconciliationStatus, 'ok');
    } else {
        setReconciliationStatus(
            'Balance und Simulator ändern deine Bestände nicht. Erst wenn du hier einen Verkauf einträgst, ändern sich Depot und Tagesgeld.',
            ''
        );
    }
}
