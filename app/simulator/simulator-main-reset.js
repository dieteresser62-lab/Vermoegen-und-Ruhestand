import { getSimulatorPlanTrial, renderSimulatorPlanTrial } from './simulator-plan-trial.js';
import { requestPageConfirmation } from '../shared/page-dialog.js';
import { resetPersonOverrides, SIMULATOR_PERSON_FIELD_IDS } from './simulator-person-overrides.js';
import { LEGACY_PERSON_KEYS } from '../profile/profile-person-migration.js';
"use strict";

import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { createResetReloadController, RESET_RELOAD_REQUIRED_MESSAGE } from '../shared/navigation-guard.js';
import { HOUSEHOLD_SIMULATOR_NEEDS_STORAGE_KEY, HOUSEHOLD_SIMULATOR_NEEDS_WARNING_ACK_KEY, clearHouseholdSimulatorNeeds } from './simulator-household-needs-persistence.js';
import { reloadGuardedPage } from '../shared/navigation-guard-dialog.js';
import { saveCurrentProfileFromLocalStorage } from '../profile/profile-storage.js';

/**
 * Initialisiert den Reset-Button für die Simulator-Einstellungen.
 */
export function initResetButton({ requestConfirmation = requestPageConfirmation } = {}) {
    const resetBtn = document.getElementById('resetBtn');
    if (!resetBtn) return;

    const message = RESET_RELOAD_REQUIRED_MESSAGE;
    let mutationCompleted = false;
    const controller = createResetReloadController({
        reload: reloadGuardedPage, message,
        mutate: () => {
            const keysToRemove = [];
            // Alt-Personenquellen gehören ausschließlich der bestätigten zentralen Migration.
            const personKeys = new Set(['sim_accumulationPhaseEnabled', 'sim_accumulationDurationYears',
                'sim_accumulationSparrate', 'sim_sparrateIndexing', ...LEGACY_PERSON_KEYS, ...SIMULATOR_PERSON_FIELD_IDS.map(id => `sim_${id}`)]);
            for (let i = 0; i < persistenceStorage.length; i++) {
                const key = persistenceStorage.key(i);
                if (key && key.startsWith('sim_') && !personKeys.has(key)) keysToRemove.push(key);
            }
            if (!saveCurrentProfileFromLocalStorage({ deletedKeys: keysToRemove })) {
                throw new Error('PROFILE_RESET_SAVE_FAILED');
            }
            getSimulatorPlanTrial(document).reset();
            renderSimulatorPlanTrial(document, { project: true });
            document.dispatchEvent?.(new CustomEvent('simulator:plan-trial'));
            resetPersonOverrides();
            keysToRemove.forEach(key => persistenceStorage.removeItem(key));
            clearHouseholdSimulatorNeeds();
            mutationCompleted = true;
        },
        blockWrites: writeMessage => PersistenceFacade.blockSyncWrites(
            [HOUSEHOLD_SIMULATOR_NEEDS_STORAGE_KEY, HOUSEHOLD_SIMULATOR_NEEDS_WARNING_ACK_KEY], writeMessage, { prefixes: ['sim_'] }),
        flush: () => {
            if (!mutationCompleted) throw new Error('PROFILE_RESET_INCOMPLETE');
            return PersistenceFacade.flush();
        }
    });
    resetBtn.addEventListener('click', async () => {
        if (resetBtn.disabled) return { status: 'cancelled' };
        const statusEl = document.getElementById('simProfileStatus');
        resetBtn.disabled = true;
        let result;
        try {
            const doc = document;
            const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
            const accepted = await requestConfirmation({ doc, opener: resetBtn,
                title: 'Simulator-Einstellungen zurücksetzen?',
                description: 'Alle gespeicherten Simulator-Einstellungen werden zurückgesetzt. Dies kann nicht rückgängig gemacht werden. Personendaten bleiben erhalten.',
                confirmLabel: 'Einstellungen zurücksetzen', cancelLabel: 'Abbrechen', danger: true });
            if (accepted !== true || before !== JSON.stringify(PersistenceFacade.exportAllSync().records)
                || doc !== document || resetBtn !== doc.getElementById('resetBtn')) return { status: 'cancelled' };
            result = await controller.run(resetBtn);
            if (statusEl && ['reload_required', 'failed'].includes(result.status)) {
                statusEl.hidden = false;
                statusEl.dataset.kind = 'error';
                statusEl.textContent = result.status === 'reload_required' ? message
                    : mutationCompleted
                        ? 'Simulator-Reset konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen. Eingaben werden bis zum Neuladen nicht gespeichert.'
                        : 'Simulator-Reset konnte nicht dauerhaft gespeichert werden. Bitte neu laden und den Profil-/Speicherfehler beheben. Eingaben werden bis zum Neuladen nicht gespeichert.';
            }
            if (result.status === 'failed') console.error('[SimulatorReset] Persistenz-Flush fehlgeschlagen.', result.error);
            return result;
        } catch (error) {
            console.error('[SimulatorReset] Rückfrage fehlgeschlagen.', error);
            if (statusEl) { statusEl.hidden = false; statusEl.dataset.kind = 'error';
                statusEl.textContent = 'Die Rückfrage konnte nicht geöffnet werden. Bitte lade die Seite neu und versuche es erneut.'; }
            return { status: 'failed', error };
        } finally { if (result?.status !== 'reloaded') resetBtn.disabled = false; }
    });
}
