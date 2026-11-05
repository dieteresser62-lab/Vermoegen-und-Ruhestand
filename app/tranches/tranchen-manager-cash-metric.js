import { formatDisplayNumber, formatDisplayDate } from '../shared/designsystem-number-format.js';
import { displayDecimalInput, readDecimalInput } from './tranchen-manager-decimal-input.js';

// Nur die Darstellung wechselt; das bestehende Profilfeld bleibt Wertträger.
const bindings = new WeakMap();
/** @param doc Dokument mit dem Tagesgeldfeld.
 * @param {{cancel?: ()=>void}} [options]
 * @returns Anzeige- und Bearbeitungssteuerung. */
export function bindManagerCashMetric(doc, { cancel = () => {} } = {}) {
    if (bindings.has(doc)) return bindings.get(doc);
    const byId = id => doc.getElementById(id);
    let profileId, amount = 0, editing = false;
    const paint = () => {
        if (byId('managerCashEditor')) byId('managerCashEditor').hidden = !editing;
        if (byId('managerCashValue')) byId('managerCashValue').hidden = editing;
        if (byId('managerCashEdit')) byId('managerCashEdit').hidden = editing;
    };
    const start = () => {
        const field = byId('profileTagesgeld');
        if (!field || field.disabled || field.readOnly) return;
        editing = true; paint(); field.focus(); field.select?.();
    };
    byId('managerCashValue')?.addEventListener('click', start);
    byId('managerCashEdit')?.addEventListener('click', start);
    byId('profileTagesgeld')?.addEventListener('blur', () => {
        const field = byId('profileTagesgeld');
        if (readDecimalInput(field.value, field) === amount && field.getAttribute('aria-invalid') !== 'true') {
            editing = false; paint();
        }
    });
    byId('profileTagesgeld')?.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !editing) return;
        event.preventDefault();
        byId('profileTagesgeld').value = displayDecimalInput(amount, byId('profileTagesgeld'));
        editing = false; paint(); cancel(); byId('managerCashValue')?.focus();
    });
    const api = {
        start,
        finish(saved) {
            const field = byId('profileTagesgeld');
            if (saved && readDecimalInput(field?.value, field) === amount) { editing = false; paint(); }
        },
        sync(next) {
            if (profileId !== next.profileId) { profileId = next.profileId; editing = false; }
            amount = next.amount;
            const value = byId('managerCashValue');
            if (value) value.textContent = `${formatDisplayNumber(amount, { fractionDigits: 0 })}\u00a0€`;
            const note = byId('managerCashDate');
            if (note) note.textContent = `von Hand nachgeführt · ${next.date ? `Stand ${formatDisplayDate(next.date)}` : 'Stand nicht erfasst'}`;
            paint();
        }
    };
    bindings.set(doc, api);
    return api;
}
