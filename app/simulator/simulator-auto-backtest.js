import { appNow } from '../shared/app-clock.js';
const openingRuns = new WeakMap();
const documentStarts = new WeakMap();

// Bereitschaftsfehler werden bereits vom Öffnungslauf angezeigt. Nur ein
// tatsächlicher UI-Startfehler darf dessen Abschluss als technischen Fehler melden.
export function createSimulatorInitialization({ persistenceReady, profileReady, initialize, isBlocked, onReadinessError }) {
    let readinessFailed = false;
    const initialized = Promise.all([persistenceReady, profileReady]).catch(error => {
        readinessFailed = true;
        onReadinessError?.(error);
        throw error;
    }).then(initialize);
    initialized.catch(() => {});
    return {
        initialized,
        async settle() {
            try { await initialized; } catch (error) {
                if (readinessFailed || isBlocked() || error?.name === 'SimulatorValidationError') return;
                throw error;
            }
        }
    };
}

// Auch ein verspätet geladenes Modul startet; kein überschreibbarer onload-Slot.
// Die gesamte UI-Initialisierung gehört genau einmal zum jeweiligen Dokument.
export function startSimulatorDocument(documentRef, initialize) {
    if (documentStarts.has(documentRef)) return documentStarts.get(documentRef);
    const task = Promise.resolve().then(async () => {
        if (documentRef.readyState === 'loading') {
            await new Promise(resolve => documentRef.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        return initialize();
    });
    documentStarts.set(documentRef, task);
    return task;
}

// Zwei rAFs lassen den Laufzustand zwischen den Callbacks tatsächlich zeichnen.
export function nextPaintFrame() {
    return new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
}

export function automaticBacktestPeriod(provider, currentYear = appNow().getFullYear()) {
    const previousYear = currentYear - 1;
    const endYear = Math.min(previousYear, provider?.bounds?.endYear);
    return { startYear: 2000, endYear, missingYears: Number.isInteger(endYear)
        ? Array.from({ length: Math.max(0, previousYear - endYear) }, (_, index) => endYear + index + 1) : [] };
}

export function startAutomaticBacktest(documentRef, dependencies) {
    if (openingRuns.has(documentRef)) return openingRuns.get(documentRef);
    const d = dependencies;
    const promise = Promise.resolve().then(async () => {
        let awaitingReadiness = true;
        try {
            d.status('loading');
            await d.persistenceReady();
            await d.profileReady();
            awaitingReadiness = false;
            if (d.isBlocked()) { d.status('blocked'); return null; }
            await d.initializationReady();
            if (d.isBlocked()) { d.status('blocked'); return null; }
            const personStatus = d.personStatus?.();
            if (personStatus && !personStatus.ready) { d.status('skipped', personStatus); return null; }
            if (!d.engineReady()) { d.status('technical_error'); return null; }
            const provider = d.provider();
            const period = automaticBacktestPeriod(provider, d.currentYear?.());
            if (!Number.isInteger(period.endYear) || period.endYear < period.startYear
                || provider.bounds.startYear > period.startYear) { d.status('missing'); return null; }
            // preparePeriod prüft innere Lücken und den unveränderten Lookbackvertrag.
            const prepared = await provider.preparePeriod(period);
            if (prepared?.status !== 'complete') { d.status('missing'); return null; }
            d.validate();
            if (d.isBlocked()) { d.status('blocked'); return null; }
            d.setPeriod(period);
            d.status('preparing');
            return await d.run({ automatic: true, opening: true, cohortsEnabled: false, focus: false, beforeRun: d.frame, isBlocked: d.isBlocked });
        } catch (error) {
            d.status(d.isBlocked() || awaitingReadiness ? 'blocked'
                : error?.name === 'SimulatorValidationError' ? 'invalid' : 'technical_error', error);
            return null;
        }
    });
    openingRuns.set(documentRef, promise);
    return promise;
}
