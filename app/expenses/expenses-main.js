import { applyExpensesTarget } from '../shared/expenses-navigation.js';
import { initializeProfilePage, whenProfileDisplayReady } from '../profile/profile-navigation.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { createExpensesController } from './expenses-controller.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
const pages = new WeakMap();
export function initExpensesPage(doc = globalThis.document, win = doc.defaultView, options = {}) {
    if (!pages.has(doc)) pages.set(doc, (async () => {
        bindInfoPopovers(doc);
        const ready = await initializeProfilePage({ doc, win });
        const status = doc.getElementById('expensesStatus');
        if (!ready || !await whenProfileDisplayReady(doc) || win.__profileRecoveryBlocker || win.__personMigrationDeferred
            || PersistenceFacade.getPersistenceStatus().migrationWarning) {
            doc.getElementById('expensesRecoveryLinks').hidden = false;
            status.textContent = 'Ausgaben können noch nicht sicher geladen werden. Bitte Personen oder Daten & Sicherung prüfen.';
            return false;
        }
        const controller = createExpensesController({ doc, win, ...options });
        const applyTarget = () => applyExpensesTarget(controller, win.location, doc);
        applyTarget();
        win.addEventListener('hashchange', applyTarget);
        doc.documentElement.dataset.expensesReady = 'true';
        return controller;
    })().catch(() => {
        doc.getElementById('expensesRecoveryLinks').hidden = false;
        doc.getElementById('expensesStatus').textContent = 'Ausgaben konnten nicht sicher geladen werden. Bitte Daten & Sicherung prüfen.';
        return false;
    }));
    return pages.get(doc);
}
if (globalThis.document?.documentElement?.dataset.suitePage === 'expenses') {
    const start = () => { void initExpensesPage(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
