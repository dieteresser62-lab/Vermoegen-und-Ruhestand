import { escapeHtml } from './security-utils.js';

/**
 * @param warning Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function assetStrategyWarningHtml(warning, { showName = false } = {}) {
    const bonds = warning.kind === 'bonds';
    return `<div class="ds-banner ds-banner-warning" data-asset-strategy-warning="${warning.kind}" role="status"><span>${showName ? `${escapeHtml(warning.name)}: ` : ''}${bonds
        ? 'Für Anleihen braucht die Rechnung die Strategie 3 Töpfe.' : 'Für Gold braucht die Rechnung die Gold-Allokation.'}
        </span><button type="button" class="ds-button ds-button-secondary" data-enable-asset-strategy="${warning.kind}" data-asset-profile="${escapeHtml(warning.profileId)}" data-asset-plan="${escapeHtml(warning.scopeKey)}">${bonds ? '3 Töpfe einschalten' : 'Gold einschalten'}</button></div>`;
}

/**
 * @param host Wert für den bestehenden Aufrufvertrag.
 * @param warnings Wert für den bestehenden Aufrufvertrag.
 * @param options Optionen des Aufrufers.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderAssetStrategyWarnings(host, warnings, { showName = false } = {}) {
    if (!host) return;
    // Eine gemeinsame Strategie braucht nur einen Hinweis, Gold bleibt je Person.
    const seen = new Set();
    const html = warnings.filter(warning => {
        const key = warning.kind === 'bonds' ? warning.scopeKey : warning.profileId;
        const id = `${warning.kind}:${key}`;
        if (seen.has(id)) return false;
        seen.add(id); return true;
    }).map(warning => assetStrategyWarningHtml(warning, { showName: showName && warning.kind === 'gold' })).join('');
    if (host.innerHTML !== html) host.innerHTML = html;
    host.hidden = !warnings.length;
}

const bound = new WeakSet();
/**
 * @param options Optionen des Aufrufers.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function bindAssetStrategyWarnings({ doc, enable, refresh, blocked = () => false }) {
    if (bound.has(doc)) return;
    bound.add(doc);
    let writing = false;
    doc.body?.addEventListener?.('click', async event => {
        const button = event.target?.closest?.('[data-enable-asset-strategy]');
        if (!button || button.disabled || writing || blocked()) return;
        writing = true; button.disabled = true;
        try {
            await enable({ kind: button.dataset.enableAssetStrategy, profileId: button.dataset.assetProfile,
                scopeKey: button.dataset.assetPlan });
            refresh();
        } catch (error) {
            const host = button.closest('[data-asset-strategy-warning]');
            let message = host?.querySelector('[data-asset-strategy-error]');
            if (!message && host) {
                message = doc.createElement('p'); message.dataset.assetStrategyError = ''; host.appendChild(message);
            }
            if (message) message.textContent = `Nicht gespeichert: ${error.message}`;
        } finally { writing = false; button.disabled = false; }
    });
}
