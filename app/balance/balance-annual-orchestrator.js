import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { UIRenderer } from './balance-renderer.js';
import { createAnnualNavigationLifecycle as createLifecycle } from '../shared/annual-coordinator.js';
/** Balance-Seitenadapter für den DOM-freien Lebenszyklus. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{guard?: import("../../typcheck/speicher-integration.js").Guard, flush?: ()=>Promise<boolean|void>}} [options] @returns Lebenszyklus der Jahresnavigation. */
export function createAnnualNavigationLifecycle({ guard = globalThis.document ? getPageNavigationGuard() : null,
    flush = () => PersistenceFacade.flush() } = {}) {
    return /** @type {import("../../typcheck/balance-ui.js").CreateAnnualLifecycle} */ (createLifecycle)({ guard, flush: async () => {
        try {
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        } catch (error) {
            UIRenderer.handleActionError(error, 'annual');
            throw error;
        }
    } });
}
