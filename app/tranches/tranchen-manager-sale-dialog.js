// @ts-check
import { bindManagerAuxiliaryDialog, openManagerAuxiliaryDialog, closeManagerAuxiliaryDialog } from './tranchen-manager-modal.js';

const bindings = new WeakMap();
/** Nur Schrittdarstellung. Vorschau und Schreiben bleiben beim Manager. */
export function bindManagerSaleDialog(doc, { preview, discard, blocked }) {
    if (bindings.has(doc) || !doc.getElementById('saleModal')) return bindings.get(doc);
    const byId = id => doc.getElementById(id);
    const state = { step: 1 };
    const show = step => {
        state.step = step;
        for (let i = 1; i <= 3; i++) {
            byId(`saleStep${i}`).hidden = i !== step;
            byId(`saleProgress${i}`).setAttribute('aria-current', i === step ? 'step' : 'false');
        }
        byId('saleBackBtn').hidden = step === 1;
        byId('saleNextBtn').hidden = step !== 1;
        byId('reconciliationPreviewBtn').hidden = step !== 2;
    };
    const valid = step => Array.from(byId(`saleStep${step}`)?.querySelectorAll?.('input, select') || [])
        .every(field => field.disabled || field.reportValidity?.() !== false);
    bindManagerAuxiliaryDialog('sale', doc, () => { discard(); show(1); });
    for (const id of ['dismissSaleModalBtn', 'saleCancelBtn', 'reconciliationCancelBtn']) {
        byId(id)?.addEventListener('click', () => closeManagerAuxiliaryDialog('sale', doc));
    }
    byId('saleNextBtn').addEventListener('click', () => {
        if (!blocked() && valid(1)) { show(2); byId('reconcileCashStatus')?.focus(); }
    });
    byId('saleBackBtn').addEventListener('click', () => {
        if (!blocked()) { show(state.step - 1); byId(state.step === 1 ? 'reconcileTrancheId' : 'reconcileCashStatus')?.focus(); }
    });
    byId('reconciliationForm').addEventListener('submit', event => {
        event.preventDefault();
        if (blocked()) return false;
        if (state.step === 1) { if (valid(1)) { show(2); byId('reconcileCashStatus')?.focus(); } return false; }
        if (!valid(1) || !valid(2)) return false;
        const ok = preview();
        if (ok) { show(3); byId('reconciliationConfirmBtn')?.focus(); }
        return ok;
    });
    state.open = opener => {
        // Ein vorhandener Entwurf einschließlich seiner Kennung bleibt erhalten.
        show(1);
        return openManagerAuxiliaryDialog('sale', doc, opener, 'reconcileTrancheId');
    };
    state.reset = () => show(1);
    bindings.set(doc, state);
    return state;
}
