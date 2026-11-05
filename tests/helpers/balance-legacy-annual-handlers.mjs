import { readProfilePersonFromStorage } from '../../app/profile/profile-state.js';
import { personReferenceYear } from '../../app/profile/profile-person-data.js';
/**
 * Module: Balance Annual Orchestrator
 * Purpose: Coordinates the complex "Annual Update" workflow (Year Adjustment -> Inflation -> Market Data).
 *          It ensures the sequence is correct (Age update first, then financial data) and tracks errors.
 * Usage: Used by balance-binder-annual.js to provide the main "Jahres-Update" function.
 * Dependencies: balance-config.js, balance-renderer.js, balance-storage.js
 */
"use strict";

import { AppError } from '../../app/balance/balance-config.js';
import { UIRenderer } from '../../app/balance/balance-renderer.js';
import { StorageManager } from '../../app/balance/balance-storage.js';
import { saveCurrentProfileFromLocalStorage } from '../../app/profile/profile-storage.js';
import { PROFILE_VALUE_KEYS } from '../../app/profile/profile-state.js';
import { PersistenceFacade, persistenceStorage } from '../../app/shared/persistence-facade.js';
import { getPageNavigationGuard } from '../../app/shared/navigation-guard-dialog.js';

const annualOperations = new WeakSet();

/** Flüchtiger Besitzer: Kündigung umfasst auch Hilfswrites und Handler-Cleanup. */
export function createAnnualNavigationLifecycle({
    guard = globalThis.document ? getPageNavigationGuard() : null,
    flush = () => PersistenceFacade.flush()
} = {}) {
    let active = null, generation = 0;
    const read = () => active
        ? { phase: active.phase, annualPhase: active.annualPhase, operationId: active.id, revision: generation,
            message: active.phase === 'commit' ? 'Der Jahresprozess schreibt – bitte warten.' : 'Der Jahresprozess wird vorbereitet – beim Wechsel wird er abgebrochen.' }
        : { phase: 'idle', operationId: null, revision: generation };
    const registration = guard?.register(Symbol('balance-annual'), {
        read,
        async cancel({ operationId }) {
            const operation = active;
            if (!operation || operation.id !== operationId) return;
            if (operation.phase === 'commit') return false;
            operation.phase = 'cancelling';
            operation.controller.abort();
            registration.notify();
            await operation.ended;
            return !operation.failed;
        }
    });
    return {
        read,
        isBlocked: () => Boolean(active || guard?.isBusy() || guard?.reasons().some(reason => reason.phase === 'commit')),
        async run({ navigationOperation } = {}, execute) {
            if (navigationOperation) {
                if (!annualOperations.has(navigationOperation) || navigationOperation.phase !== 'commit') {
                    throw new Error('ANNUAL_OPERATION_INVALID');
                }
                navigationOperation.check();
                return execute(navigationOperation);
            }
            if (active || guard?.isBusy() || guard?.reasons().some(reason => ['commit', 'preparing', 'cancelling'].includes(reason.phase))) {
                return { ok: false, status: 'in_flight' };
            }
            let finish;
            const operation = {
                id: ++generation, phase: 'preparing', controller: new AbortController(),
                ended: new Promise(resolve => { finish = resolve; }),
                check() {
                    if (this.controller.signal.aborted) {
                        const error = new Error('Die Jahresvorbereitung wurde abgebrochen.');
                        error.name = 'AbortError';
                        throw error;
                    }
                },
                commit(annualPhase = this.annualPhase || 'writes_started') {
                    this.check();
                    this.phase = 'commit';
                    this.annualPhase = annualPhase;
                    registration?.notify();
                }
            };
            annualOperations.add(operation);
            active = operation;
            registration?.notify();
            try {
                const result = await execute(operation);
                operation.failed = result?.ok === false || ['invalid', 'incomplete_recovery'].includes(result?.status);
                return result;
            } catch (error) {
                operation.failed = error?.name !== 'AbortError';
                if (error?.name === 'AbortError') return { ok: false, status: 'cancelled' };
                throw error;
            }
            finally {
                try {
                    if (operation.phase === 'commit') {
                        try {
                            if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
                        } catch (error) {
                            operation.failed = true;
                            UIRenderer.handleActionError(error, 'annual');
                            throw error;
                        }
                    }
                } finally {
                    annualOperations.delete(operation);
                    active = null;
                    registration?.notify();
                    finish();
                }
            }
        }
    };
}

export function createAnnualOrchestrator({
    dom,
    debouncedUpdate,
    handleFetchInflation,
    handleNachrueckenMitETF,
    handleFetchCapeAuto,
    showUpdateResultModal,
    setLastUpdateResults,
    navigationLifecycle = createAnnualNavigationLifecycle()
}) {
    // Interne Absicherung direkter Orchestratoraufrufe, kein zusätzlicher UI-Vertrag.
    // Beide Jahresknöpfe behalten die annualCloseInFlight-Sperre im Snapshot-Handler.
    let inFlight = false;
    const executeJahresUpdate = async ({ failOnStepError = false, nested = false, manualPrice, personAgeAfter, referenceYear, preparedMarketData, onProgress } = {}, navigationOperation) => {
        if (inFlight) return { ok: false, status: 'in_flight' };
        inFlight = true;
        if (!nested) UIRenderer.clearActionError('annual');
        const btn = dom.controls.btnJahresUpdate;
        const originalText = btn.innerHTML;
        const startTime = Date.now();

        // Results-Objekt für Modal
        const results = {
            startTime: startTime,
            inflation: null,
            etf: null,
            cape: null,
            age: { old: parseInt(dom.inputs.aktuellesAlter.value) || 0, new: 0 },
            errors: []
        };

        try {
            btn.disabled = true;
            btn.innerHTML = '⏳ Lädt...';

            UIRenderer.toast('Starte Jahres-Update...', 'info');

            // Schritt 1: Alter ausschließlich aus dem zentralen Profil projizieren.
            navigationOperation.commit();
            const currentAge = parseInt(dom.inputs.aktuellesAlter.value) || 0;
            const newAge = personAgeAfter ?? readProfilePersonFromStorage(persistenceStorage).startAlter;
            dom.inputs.aktuellesAlter.value = newAge.toString();
            results.age.new = newAge;

            // State aktualisieren: Das neue Alter gilt als "inflationsbereinigt"
            const state = StorageManager.loadState();
            state.needsAdjustedForInflationYear = referenceYear ?? personReferenceYear(state.annualPeriodMetadata);
            StorageManager.saveState(state);

            // Schritt 2: Inflation abrufen
            btn.innerHTML = '⏳ Inflation...';
            onProgress?.('Inflation wird angewendet …');
            try {
                results.inflation = await handleFetchInflation({ nested: true, navigationOperation, preparedResult: preparedMarketData?.inflation });
            } catch (err) {
                results.errors.push({ step: 'Inflation', error: err.message || 'Unbekannter Fehler' });
            }

            // Kurze Pause fuer besseres UX
            await new Promise(resolve => setTimeout(resolve, 500));

            // Schritt 3: Marktdaten via ETF abrufen und nachruecken
            btn.innerHTML = '⏳ ETF...';
            onProgress?.('ETF-Schlusskurs wird angewendet …');
            try {
                results.etf = await handleNachrueckenMitETF({ nested: true, navigationOperation, manualPrice, preparedResult: preparedMarketData?.etf });
            } catch (err) {
                results.errors.push({ step: 'ETF & Nachrücken', error: err.message || 'Unbekannter Fehler' });
            }

            // Schritt 4: CAPE automatisch aktualisieren (non-blocking)
            btn.innerHTML = '⏳ CAPE...';
            onProgress?.('CAPE wird angewendet …');
            try {
                results.cape = await handleFetchCapeAuto({ nested: true, navigationOperation, preparedResult: preparedMarketData?.cape });
                if (results.cape?.capeFetchStatus === 'error_no_source_no_stored') {
                    const details = Array.isArray(results.cape?.errors) && results.cape.errors.length > 0
                        ? ` Details: ${results.cape.errors.join(' | ')}`
                        : '';
                    results.errors.push({
                        step: 'CAPE',
                        error: `Keine CAPE-Quelle verfügbar und kein lokaler Stand vorhanden.${details}`
                    });
                }
            } catch (err) {
                results.errors.push({ step: 'CAPE', error: err.message || 'Unbekannter Fehler' });
            }

            // UI aktualisieren, damit die Erfolgsmeldung das neue Alter anzeigt
            debouncedUpdate();

            // Profil-Daten (inkl. Tranchen) explizit in Registry speichern
            saveCurrentProfileFromLocalStorage();

            results.endTime = Date.now();

            // Protokoll für erneute Anzeige speichern und UI-Button aktivieren
            setLastUpdateResults(JSON.parse(JSON.stringify(results)));
            if (dom.controls.btnJahresUpdateLog) {
                dom.controls.btnJahresUpdateLog.disabled = false;
            }

            // Ergebnisse sind noch nicht als endgültiger Periodenabschluss bestätigt.
            if (!nested && results.errors.length > 0) showUpdateResultModal(results);

            return { ok: results.errors.length === 0, results };

        } catch (err) {
            console.error('Jahres-Update fehlgeschlagen:', err);
            UIRenderer.handleActionError(new AppError('Jahres-Update fehlgeschlagen.', { originalError: err }), 'annual');
            return { ok: false, error: err, results };
        } finally {
            inFlight = false;
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };

    const handleJahresUpdate = (options = {}) => navigationLifecycle.run(options,
        operation => executeJahresUpdate(options, operation));
    return { handleJahresUpdate };
}
