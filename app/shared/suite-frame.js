import { initializeProfilePage, whenProfileDisplayReady, profileMigrationDisplayState, retryDeferredPersonMigration } from '../profile/profile-navigation.js';
import { readProfileContext } from '../profile/profile-context-reader.js';
import { initSuiteSidebar } from './suite-sidebar-preference.js';
import { createDesignsystemIcon } from './designsystem-icons.js';
import { initHouseholdSwitcher } from './household-switcher.js';

const initializedFrames = new WeakSet();

/**
 * @param {Document} doc Dokument der Seite.
 * @param context Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderSuiteProfile(doc = globalThis.document, context) {
    const host = doc?.getElementById('suiteProfileContext');
    if (!host) return;
    context ||= profileMigrationDisplayState(doc) ? { status: profileMigrationDisplayState(doc) } : readProfileContext();
    host.dataset.profileState = context.status;
    // Identität bleibt für interne Leser verfügbar; die doppelte Profilanzeige entfällt.
    host.hidden = ['ready', 'loading', 'missing'].includes(context.status);
    host.textContent = context.status === 'deferred' ? 'Umstellung der Personendaten ausstehend'
        : context.status === 'unavailable' ? 'Profil nicht verfügbar' : '';
    if (context.status === 'ready') {
        host.dataset.profileId = context.id;
        host.dataset.profileName = context.name;
    } else {
        delete host.dataset.profileId;
        delete host.dataset.profileName;
    }
    if (context.status === 'deferred') {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'ds-button ds-button-secondary';
        button.dataset.personMigrationRetry = ''; button.textContent = 'Jetzt übernehmen';
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            button.disabled = true;
            await retryDeferredPersonMigration({ doc });
            renderSuiteProfile(doc);
        });
        host.appendChild(button);
    }
}

/** Adapter bekommt ausschließlich den bereits bestimmten Haushalts-Anzeigezustand.
 *
 * @param profiles Wert für den bestehenden Aufrufvertrag.
 * @param {Document} doc Dokument der Seite.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderSuiteHousehold(profiles, doc = globalThis.document) {
    const host = doc?.getElementById('suiteHouseholdContext');
    if (!host) return;
    host.textContent = profiles === null ? 'Haushalt: nicht verfügbar'
        : `Haushalt: ${profiles.length ? profiles.map(p => p.name || p.id || p.profileId).join(', ') : 'Keine Auswahl'}`;
}

/** Das Markup und seine Linknamen stehen bereits ohne JavaScript bereit.
 *
 * @param {Document} doc Dokument der Seite.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function initSuiteFrame(doc = globalThis.document) {
    if (!doc || initializedFrames.has(doc)) return false;
    initializedFrames.add(doc);
    // Bindung vor jedem asynchronen Wartepunkt; Symbolfehler blockieren keine Übergabe.
    void initializeProfilePage({ doc, win: doc.defaultView });
    renderSuiteProfile(doc, { status: 'loading' });
    void whenProfileDisplayReady(doc).then(available => renderSuiteProfile(doc, available ? undefined : { status: profileMigrationDisplayState(doc) || 'unavailable' }))
        .catch(() => renderSuiteProfile(doc, { status: 'unavailable' }));
    initSuiteSidebar(doc);
    initHouseholdSwitcher(doc);
    for (const host of /** @type {NodeListOf<HTMLElement>} */ (doc.querySelectorAll('[data-suite-icon]'))) {
        createDesignsystemIcon(host.dataset.suiteIcon, doc)
            .then(icon => host.replaceChildren(icon))
            .catch(() => {});
    }
    return true;
}

if (globalThis.document?.documentElement?.dataset?.suitePage) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initSuiteFrame(document), { once: true });
    } else {
        initSuiteFrame(document);
    }
}
