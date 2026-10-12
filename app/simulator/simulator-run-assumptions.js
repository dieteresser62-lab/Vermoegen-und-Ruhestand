import { personDataContextFor, freezePersonDataContext } from './simulator-person-overrides.js';
// Dokumentlokale Laufköpfe; kein Speicher- oder Exportvertrag.
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
        .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
}

export function effectiveRunAssumptions(kind, inputs, settings = {}) {
    const values = { ...inputs };
    delete values.telemetry;
    delete values.logDetails;
    if (values.pflegefallLogikAktivieren === false) {
        for (const key of Object.keys(values)) if (key.startsWith('pflege') && key !== 'pflegefallLogikAktivieren') delete values[key];
    }
    if (values.partner?.aktiv === false) values.partner = { aktiv: false };
    if (values.accumulationPhase?.enabled === false) values.accumulationPhase = { enabled: false };
    if (values.decumulation?.mode === 'standard') values.decumulation = { mode: 'standard' };
    if (values.goGoActive === false) delete values.goGoMultiplier;
    if (kind === 'backtest') {
        // Historische Jahresdaten ersetzen diese MC-Auswahlwerte.
        delete values.stressPreset;
        for (const key of Object.keys(values)) if (key.startsWith('tailRisk')) delete values[key];
        delete values.capeRatio;
        delete values.marketCapeRatio;
    }
    const context = personDataContextFor(inputs);
    return canonical({ inputs: values, settings, ...(context ? { personDataContext: context } : {}) });
}

export function createRunAssumptions() {
    const runs = { backtest: null, montecarlo: null };
    const current = { backtest: null, montecarlo: null };
    const phases = { backtest: 'idle', montecarlo: 'idle' };
    const revisions = { backtest: 0, montecarlo: 0 };
    const contextRevisions = { backtest: 0, montecarlo: 0 };
    const handled = { backtest: -1, montecarlo: -1 };
    const pending = { backtest: null, montecarlo: null };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
        observe(kind, values) {
            const next = canonical(values);
            if (!equal(next, current[kind])) { current[kind] = next; revisions[kind]++; }
            return this.read(kind);
        },
        replaceContext(kind, values) {
            const revision = revisions[kind];
            this.observe(kind, values);
            if (revision === revisions[kind]) return false;
            // Ein Altabschluss besitzt den neuen Haushaltskontext nicht.
            pending[kind] = null;
            contextRevisions[kind]++;
            phases[kind] = 'idle';
            return true;
        },
        begin(kind, values, metadata = {}) {
            const token = { values: freezePersonDataContext(canonical(values)), metadata: freezePersonDataContext(canonical(metadata)), revision: revisions[kind] };
            pending[kind] = token;
            phases[kind] = 'running';
            return token;
        },
        complete(kind, token, result) {
            if (pending[kind] !== token) return false;
            // Kopie statt mutable Runner-/DOM-Referenz; UI-Metadaten bleiben separat.
            runs[kind] = { ...token, result };
            handled[kind] = token.revision;
            pending[kind] = null;
            phases[kind] = 'completed';
            return true;
        },
        fail(kind, phase = 'error') { pending[kind] = null; phases[kind] = phase; handled[kind] = revisions[kind]; },
        phase(kind, phase) { phases[kind] = phase; },
        read(kind) {
            const last = runs[kind];
            return { last, phase: phases[kind], revision: revisions[kind], contextRevision: contextRevisions[kind],
                stale: Boolean(last && !equal(last.values, current[kind])),
                needsRun: handled[kind] !== revisions[kind] && (!last || !equal(last.values, current[kind])) };
        },
        claimBacktestRevision() {
            const state = this.read('backtest');
            if (!state.needsRun || pending.backtest || ['loading', 'running', 'preparing', 'blocked'].includes(state.phase)) return false;
            handled.backtest = revisions.backtest;
            return true;
        }
    };
}

export const simulatorRunAssumptions = createRunAssumptions();
