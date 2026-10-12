import { initializeProfilePage, whenProfileDisplayReady } from '../profile/profile-navigation.js';
import { exportProfilesBundleToWindowName } from '../profile/profile-storage.js';
import { PersistenceFacade } from './persistence-facade.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { getProbelaufController } from './probelauf-state.js';

export const LEGACY_WEALTH_TARGETS = ['verlauf', 'history', 'wealth', 'tab-history', 'tab-wealth', 'balanceTabHistory',
    'wealthHistoryTitle', 'wealthHistoryCount', 'wealthHistoryDate', 'wealthHistoryMetrics', 'wealthHistoryChart',
    'wealthHistoryTable', 'wealthHistoryStatus', 'wealthHistoryHint', 'wealthHistoryScrollHint', 'evaluationTitle', 'captureWealthBtn'];
export function isLegacyWealthTarget(location) {
    return LEGACY_WEALTH_TARGETS.includes((location?.hash || '').slice(1));
}
export function wealthHistoryHref() { return 'depot-tranchen-manager.html#verlauf'; }
export function applyWealthHistoryTarget(doc, location = doc.defaultView?.location) {
    if (location?.hash !== '#verlauf') return false;
    doc.getElementById('managerWealthHistory')?.scrollIntoView?.({ block: 'start' });
    return true;
}

export async function navigateWealthHistory({ doc = globalThis.document, win = doc?.defaultView || globalThis.window,
    replace = false, guard = getPageNavigationGuard(doc, win),
    ready = async () => await initializeProfilePage({ doc, win }) && await whenProfileDisplayReady(doc),
    beforeLeave = async () => true, flush = () => PersistenceFacade.flush(), exporter = exportProfilesBundleToWindowName } = {}) {
    let attempt, navigated = false, exported = false;
    const previousName = win.name;
    try {
        // Bootstrap vor der Navigation: eine notwendige Migration besitzt ihren eigenen Guard.
        if (!await ready() || win.__profileRecoveryBlocker || win.__personMigrationDeferred || PersistenceFacade.hasSyncWriteBlocks()) return false;
        if (!await beforeLeave()) return false;
        attempt = await guard.prepare();
        if (!attempt) return false;
        if (!getProbelaufController(doc)?.state) {
            exported = true;
            if (await exporter() === false) throw new Error('PROFILE_HANDOFF_EXPORT_FAILED');
        }
        if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        if (!guard.validate(attempt)) return false;
        navigated = guard.commitNavigation(attempt, () => {
            const href = wealthHistoryHref();
            if (replace) win.location.replace(href);
            else win.location.href = href;
        });
        return navigated;
    } catch {
        const status = doc.getElementById('suiteNavigationStatus');
        if (status) { status.hidden = false; status.textContent = 'Vermögensverlauf konnte nicht geöffnet werden. Bitte den Speicherabschluss prüfen und erneut versuchen.'; }
        return false;
    } finally {
        if (!navigated) {
            if (exported) win.name = previousName;
            if (attempt) guard.end(attempt);
        }
    }
}

export async function initializeWealthHistoryNavigation({ doc, win, navigate = navigateWealthHistory, beforeLeave = async () => true }) {
    const initial = isLegacyWealthTarget(win.location);
    win.addEventListener('hashchange', () => {
        if (isLegacyWealthTarget(win.location)) void navigate({ doc, win, beforeLeave });
    });
    if (!initial) return false;
    await navigate({ doc, win, replace: true });
    return true;
}
