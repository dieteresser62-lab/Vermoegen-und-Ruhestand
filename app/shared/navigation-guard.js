// Flüchtiger, DOM-freier Schutz. revision bezeichnet verlustrelevante Änderungen,
// operationId eine Laufgeneration; reine Abbruchphasen ändern revision nicht.
const activePhases = new Set(['preparing', 'running', 'cancelling']);
const stateOf = value => ({ phase: 'idle', revision: 0, operationId: null, dirty: false, result: false, ...value });
const hasReason = state => state.phase === 'commit' || activePhases.has(state.phase) || state.dirty || state.result;
const equal = (a, b) => ['phase', 'revision', 'operationId', 'dirty', 'result'].every(key => a[key] === b[key]);

export function createNavigationGuard({ decide = async () => false, status = () => {}, schedule = setTimeout, unschedule = clearTimeout } = {}) {
    const providers = new Map(), listeners = new Set();
    let active = null, sequence = 0, permit = null, timer = null;
    const snapshot = () => new Map(Array.from(providers, ([owner, provider]) => [owner, stateOf(provider.read())]));
    const reasons = () => Array.from(snapshot(), ([owner, state]) => ({ owner, ...state })).filter(hasReason);
    function revokeNative() {
        // Ohne tatsächlichen Dokumentwechsel (z. B. BFCache-Rückkehr oder
        // Reload-Doppel) darf die quittierte Reservierung nicht hängen bleiben.
        if (active?.committed) active = null;
        permit = null;
        if (timer !== null) unschedule(timer);
        timer = null;
    }
    function restoreDocument() {
        revokeNative();
        // Eine im BFCache eingefrorene Fortsetzung behält ihren Writebesitzer,
        // darf aber niemals mit der Zustimmung des alten Dokumentlebens wechseln.
        if (active) active.invalid = true;
    }
    function compatible(attempt, current) {
        for (const [owner, state] of current) {
            const old = attempt.states.get(owner);
            if (!old) { if (hasReason(state)) return false; continue; }
            if (equal(old, state)) continue;
            // Nur das eigene bestätigte Abbruchende darf die Zustimmung überleben.
            if (attempt.cancelling.has(owner) && state.revision === old.revision
                && state.dirty === old.dirty && state.result === old.result
                && (state.operationId === old.operationId || (state.phase === 'idle' && state.operationId === null))
                && (activePhases.has(state.phase) || state.phase === 'idle')) continue;
            if (hasReason(old) || hasReason(state)) return false;
        }
        for (const [owner, old] of attempt.states) {
            if (!current.has(owner) && hasReason(old) && !attempt.cancelling.has(owner)) return false;
        }
        return true;
    }
    function changed() {
        revokeNative();
        if (active && !compatible(active, snapshot())) active.invalid = true;
        for (const listener of listeners) listener(reasons());
    }
    function register(owner, provider) {
        if (!owner || providers.has(owner) || typeof provider.read !== 'function') throw new Error('NAVIGATION_PROVIDER_INVALID');
        providers.set(owner, provider);
        const unsubscribe = provider.subscribe?.(changed);
        changed();
        let registered = true;
        return { notify: changed, unregister() {
            if (!registered) return;
            registered = false; unsubscribe?.(); providers.delete(owner); changed();
        } };
    }
    function reloadCompletionMessage(attempt, stateChanged = false) {
        if (attempt.completionMessage) return attempt.completionMessage;
        if (attempt.mutationStarted) return 'Daten geändert; nicht neu geladen.'
            + (stateChanged ? ' Der Zustand hat sich geändert.' : '') + ' Bitte neu laden.';
        return stateChanged
            ? 'Navigation abgebrochen: Der Zustand hat sich geändert. Bitte erneut versuchen.'
            : 'Navigation abgebrochen: Die Seite konnte nicht neu geladen werden. Bitte erneut versuchen.';
    }
    function validate(attempt) {
        if (!attempt || active !== attempt || attempt.invalid || !compatible(attempt, snapshot())) {
            status(attempt?.writeStarted
                ? attempt.writeConfirmed
                    ? reloadCompletionMessage(attempt, true)
                    : 'Schreibvorgang begonnen: Der Zustand hat sich geändert. Bitte den Speicherabschluss abwarten.'
                : 'Navigation abgebrochen: Der Zustand hat sich geändert. Bitte erneut versuchen.');
            return false;
        }
        return true;
    }
    function end(attempt) {
        if (active !== attempt) return;
        active = null;
        revokeNative();
        changed();
    }
    async function prepare({ opener = null, decide: decision = decide, owners = null, intent = 'navigate', signal } = {}) {
        if (signal?.aborted) return null;
        if (active) {
            const commit = reasons().find(state => state.phase === 'commit');
            if (commit) status(intent === 'close' && commit.annualPhase ? 'Jahresabschluss schreibt – bitte warten' : commit.message || 'Daten werden geschrieben – bitte warten.');
            return null;
        }
        revokeNative();
        const attempt = { id: ++sequence, states: snapshot(), cancelling: new Set(), invalid: false };
        active = attempt;
        const abort = () => { attempt.invalid = true; end(attempt); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const currentReasons = Array.from(attempt.states, ([owner, state]) => ({ owner, ...state })).filter(state => hasReason(state) && (!owners || owners.includes(state.owner)));
            const commit = currentReasons.find(state => state.phase === 'commit');
            if (commit) {
                status(intent === 'close' && commit.annualPhase ? 'Jahresabschluss schreibt – bitte warten' : commit.message || 'Daten werden geschrieben – bitte warten.');
                end(attempt); return null;
            }
            if (currentReasons.length && await decision({ reasons: currentReasons, opener, attemptId: attempt.id, intent, signal }) !== true) {
                end(attempt); return null;
            }
            if (!validate(attempt)) { end(attempt); return null; }
            const jobs = [];
            for (const [owner, state] of attempt.states) {
                if (!activePhases.has(state.phase) || (owners && !owners.includes(owner))) continue;
                const provider = providers.get(owner);
                attempt.cancelling.add(owner);
                // Alle Abbrüche anfordern, auch wenn ein anderer Besitzer fehlschlägt.
                jobs.push(Promise.resolve().then(() => {
                    if (typeof provider?.cancel !== 'function') throw new Error('NAVIGATION_CANCEL_UNAVAILABLE');
                    return provider.cancel({ attemptId: attempt.id, operationId: state.operationId });
                }));
            }
            const endings = await Promise.allSettled(jobs);
            if (endings.some(result => result.status === 'rejected' || result.value === false)) throw new Error('NAVIGATION_CANCEL_FAILED');
            if (!validate(attempt)) { end(attempt); return null; }
            for (const owner of attempt.cancelling) {
                const state = snapshot().get(owner);
                if (state && activePhases.has(state.phase)) throw new Error('NAVIGATION_CANCEL_INCOMPLETE');
            }
            return attempt;
        } catch (error) {
            status('Navigation abgebrochen: Die laufende Aktion konnte nicht sicher beendet werden.');
            end(attempt);
            throw error;
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }
    function commitNavigation(attempt, navigate) {
        if (!validate(attempt) || attempt.committed) return false;
        attempt.committed = true;
        permit = attempt.id;
        timer = schedule(() => { revokeNative(); if (active === attempt) active = null; }, 0);
        try { navigate(); return true; } catch (error) { end(attempt); throw error; }
    }
    function beforeUnload(event) {
        if (permit !== null && permit === active?.id && validate(active)) { permit = null; return; }
        revokeNative();
        if (!reasons().length) return;
        event.preventDefault();
        event.returnValue = '';
    }
    /** Wiederverwendbarer Reloadweg; Mutation beginnt erst nach der Entscheidung. */
    async function reload({ opener, ready, mutate, flush, reload: navigate, subscribeChanges,
        returnResult = false, completionMessage }) {
        const result = (status, error) => returnResult ? { status, ...(error ? { error } : {}) } : status === 'reloaded';
        if (active) return result('cancelled');
        let inputChanged = false;
        const unwatch = subscribeChanges?.(() => {
            inputChanged = true;
            if (active) active.invalid = true;
            revokeNative();
        });
        let attempt;
        try { attempt = await prepare({ opener }); }
        catch (error) { unwatch?.(); if (returnResult) return result('cancelled', error); throw error; }
        if (!attempt) { unwatch?.(); return result('cancelled'); }
        attempt.completionMessage = completionMessage;
        let navigated = false, confirmed = false, lease = null, owner = null;
        const release = () => {
            if (!lease) return;
            attempt.states.delete(owner);
            lease.unregister();
            lease = null;
        };
        try {
            if (ready && await ready() === false) return result('cancelled');
            if (inputChanged) attempt.invalid = true;
            if (!validate(attempt)) return result('cancelled');
            if (mutate || flush) {
                // Eigener Schreibabschnitt umfasst auch den letzten Flush.
                owner = Symbol('navigation-mutation');
                attempt.states.set(owner, stateOf({ phase: 'commit' }));
                lease = register(owner, { read: () => ({ phase: 'commit' }) });
                const operation = {
                    phase: 'commit',
                    // Begonnene Writes und Rollback müssen trotz inzwischen
                    // ungültiger Zustimmung enden. Vor Reload wird neu geprüft.
                    check() {},
                    commit() {}
                };
                attempt.writeStarted = true;
                if (mutate) {
                    // Meldungsphase getrennt vom Commitbesitz des reinen Flushs.
                    attempt.mutationStarted = true;
                    if (await mutate(operation) === false) return result('failed');
                }
            }
            // Begonnene Writes auch bei neuer Eingabe bis zur Speicherantwort
            // schützen. Die ungültige Zustimmung erlaubt danach keinen Reload.
            if (flush && await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
            confirmed = true;
            attempt.writeConfirmed = true;
            if (inputChanged) attempt.invalid = true;
            if (!validate(attempt)) return result('reload_required');
            release();
            navigated = commitNavigation(attempt, navigate);
            return result(navigated ? 'reloaded' : 'reload_required');
        } catch (error) {
            if (!returnResult) throw error;
            if (confirmed) status(reloadCompletionMessage(attempt));
            return result(confirmed ? 'reload_required' : attempt.writeStarted ? 'failed' : 'cancelled', error);
        } finally { unwatch?.(); release(); if (!navigated) end(attempt); }
    }

    return { register, reasons, prepare, validate, end, commitNavigation, beforeUnload, reload,
        revokeNative, restoreDocument, isBusy: () => active !== null,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

/** Ein Besitzer umfasst Vorbereitung, Hilfswrites, Bestandscommit und Cleanup.
 * Verschachtelte Aufrufe leihen den Besitzer; sie quittieren ihn niemals selbst.
 */
export function createNavigationOperationLifecycle({ guard = null, message = 'Daten werden geschrieben – bitte warten.' } = {}) {
    let active = null, generation = 0;
    return {
        isBlocked: () => Boolean(active || guard?.isBusy() || guard?.reasons().some(reason => ['commit', 'preparing', 'running', 'cancelling'].includes(reason.phase))),
        async run({ navigationOperation } = {}, execute) {
            if (navigationOperation) {
                navigationOperation.check();
                return execute(navigationOperation);
            }
            if (this.isBlocked()) {
                const error = new Error('Eine andere Aktion oder Navigation läuft bereits. Bitte warten.');
                error.code = 'NAVIGATION_WRITE_BUSY';
                throw error;
            }
            let finish, registration;
            const operation = {
                id: ++generation, phase: 'preparing', controller: new AbortController(),
                owns: owner => active === operation && owner === operation.owner,
                ended: new Promise(resolve => { finish = resolve; }),
                check() {
                    if (this.controller.signal.aborted) {
                        const error = new Error('Die Vorbereitung wurde abgebrochen.');
                        error.name = 'AbortError';
                        throw error;
                    }
                },
                commit() { this.check(); this.phase = 'commit'; registration?.notify(); }
            };
            operation.owner = Symbol('persistence-operation');
            active = operation;
            registration = guard?.register(operation.owner, {
                read: () => ({ phase: operation.phase, operationId: operation.id, revision: generation,
                    message: operation.phase === 'commit' ? message : 'Daten werden vorbereitet – beim Wechsel wird die Aktion abgebrochen.' }),
                async cancel({ operationId }) {
                    if (operation.id !== operationId || operation.phase === 'commit') return false;
                    operation.phase = 'cancelling';
                    operation.controller.abort(); registration.notify();
                    await operation.ended;
                    return !operation.failed;
                }
            });
            try {
                const result = await execute(operation);
                operation.failed = result?.ok === false && result?.status !== 'cancelled';
                return result;
            } catch (error) {
                operation.failed = error?.name !== 'AbortError';
                throw error;
            } finally {
                active = null;
                registration?.unregister();
                finish();
            }
        }
    };
}

export const RESET_RELOAD_REQUIRED_MESSAGE = 'Reset gespeichert; die Seite wurde nicht neu geladen. Bitte jetzt neu laden. Eingaben werden bis dahin nicht gespeichert.';

/** Ein begonnener Reset bleibt schreibgeschützt; Wiederholung bestätigt nur den Flush. */
export function createResetReloadController({ reload, mutate, blockWrites, flush, message }) {
    let started = false, stored = false;
    const writeMessage = () => stored ? message
        : 'Reset noch nicht dauerhaft bestätigt. Bitte den Speicherabschluss abwarten oder erneut versuchen. Eingaben werden bis zum Neuladen nicht gespeichert.';
    return {
        async run(opener) {
            const result = await reload({ opener, returnResult: true, completionMessage: message,
                mutate: () => {
                    if (started) return;
                    started = true;
                    // Synchrone Resetmutation und Sperrinstallation bilden einen Abschnitt.
                    // Auch nach einer teilweise gescheiterten Mutation bleiben alte Inputs gesperrt.
                    try { mutate(); } finally { blockWrites(writeMessage); }
                }, flush });
            if (['reloaded', 'reload_required'].includes(result.status)) stored = true;
            // Auch nach dem Reloadcallback bleibt die alte Dokumentgeneration gesperrt.
            // Erst das neu geladene Modul besitzt wieder einen ungesperrten Cache.
            return result;
        }
    };
}
