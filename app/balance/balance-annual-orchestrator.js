import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { UIRenderer } from './balance-renderer.js';
import { createAnnualNavigationLifecycle as createLifecycle } from '../shared/annual-coordinator.js';
/** Balance-Seitenadapter für den DOM-freien Lebenszyklus. */
export function createAnnualNavigationLifecycle({ guard = globalThis.document ? getPageNavigationGuard() : null,
    flush = () => PersistenceFacade.flush() } = {}) {
    return createLifecycle({ guard, flush: async () => {
        try {
            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        } catch (error) {
            UIRenderer.handleActionError(error, 'annual');
            throw error;
        }
    } });
}
