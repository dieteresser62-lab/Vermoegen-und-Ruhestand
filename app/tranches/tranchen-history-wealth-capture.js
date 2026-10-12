import { createBalanceWealthHistoryPreview } from '../balance/balance-wealth-history-preview.js';

const bindings = new WeakMap();
/** Derselbe bestätigte Schreibdienst und dasselbe Kursgate wie nach dem Import. */
export function bindManagerWealthCapture(doc, { refresh, beforeCapture = async () => true, blocked = () => false,
    createPreview = createBalanceWealthHistoryPreview } = {}) {
    if (bindings.has(doc)) return bindings.get(doc);
    const button = doc.getElementById('managerCaptureWealthBtn');
    if (!button) return null;
    let pending = false;
    const report = text => {
        const status = doc.getElementById('managerWealthStatus');
        if (status) status.textContent = text.replace('Ausgaben importiert; ', '');
    };
    const preview = createPreview({ doc, win: doc.defaultView, refresh, report });
    const capture = async () => {
        if (pending || blocked()) return false;
        pending = true; button.disabled = true;
        report('');
        try {
            const context = preview.service.captureContext();
            if (!await beforeCapture()) { report('Stand nicht erfasst. Bitte offene Eingaben zuerst bestätigen.'); return false; }
            preview.service.assertContext(context);
            return await preview.afterImport();
        } catch (error) { report(`Stand nicht bestätigt: ${error.message}`); return false; }
        finally { pending = false; button.disabled = blocked(); }
    };
    button.addEventListener('click', capture);
    const api = { capture };
    bindings.set(doc, api);
    return api;
}
