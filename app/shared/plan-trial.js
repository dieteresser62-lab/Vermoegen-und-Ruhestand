import { assertPlanValues, canonicalPlan, PLAN_FIELD_PATHS } from '../profile/household-plan.js';

const clone = value => structuredClone(value);
const leaf = (values, path) => path.split('.').reduce((value, key) => value[key], values);
const merge = (values, patch) => ({ ...values, ...patch,
    cape: { ...values.cape, ...patch.cape }, decumulation: { ...values.decumulation, ...patch.decumulation } });
export function planTrialDifferences(before, after) {
    return PLAN_FIELD_PATHS.filter(path => !Object.is(leaf(before, path), leaf(after, path)))
        .map(path => ({ path, before: leaf(before, path), after: leaf(after, path) }));
}
export function planTrialPatch(differences) {
    const patch = {};
    for (const { path, after, local } of differences) {
        if (local) continue;
        const [key, nested] = path.split('.');
        if (nested) (patch[key] ||= {})[nested] = after;
        else patch[key] = after;
    }
    return patch;
}

/** Seitenlokaler Besitzer. Nur die ausdrücklich bestätigte Übernahme schreibt. */
export function createPlanTrial({ readPlan, writePlan, profile = () => null, changed = () => {},
    readLocal = () => ({}), projectLocal = () => {} } = {}) {
    let scope = null, baseline = null, draft = null, active = false, revision = 0, busy = false, confirmed = false;
    // Die Auswahlidentität überlebt Planverlust; nur ein echter Bereichswechsel
    // hebt die frühere Bestätigungsgrenze wieder auf.
    let selectedScopeKey = null;
    let localBaseline = {}, localDraft = {};
    const localDifferences = () => Object.keys(localDraft).filter(path => !Object.is(localBaseline[path], localDraft[path]))
        .map(path => ({ path, before: localBaseline[path], after: localDraft[path], local: true }));
    const clearLocal = () => { if (active) projectLocal(clone(localBaseline)); localDraft = clone(localBaseline); };
    const listeners = new Set();
    const emit = () => { changed(); listeners.forEach(listener => listener()); };
    const notify = () => { revision++; emit(); };
    const sync = () => {
        const plan = readPlan();
        const nextScopeKey = plan.scope?.key ?? null;
        let changedScope = false;
        if (selectedScopeKey !== nextScopeKey) {
            changedScope = confirmed || Boolean(scope) || active;
            selectedScopeKey = nextScopeKey;
            clearLocal(); scope = baseline = draft = null; active = confirmed = false;
        }
        if (plan.status !== 'valid') {
            const changed = changedScope || Boolean(scope) || active;
            clearLocal(); scope = baseline = draft = null; active = false;
            if (changed) notify();
            return plan;
        }
        confirmed = true;
        if (scope?.key !== plan.scope.key) {
            scope = clone(plan.scope); baseline = clone(plan.entry.values); draft = null; active = false; notify();
        } else if (!active) baseline = clone(plan.entry.values);
        return plan;
    };
    const api = {
        sync,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        read() { const plan = sync(); return { active, busy, confirmed, revision, scope: clone(scope),
            differences: active ? [...planTrialDifferences(plan.entry.values, merge(plan.entry.values, planTrialPatch(planTrialDifferences(baseline, draft)))), ...localDifferences()] : [] }; },
        start() { const plan = sync(); if (busy || plan.status !== 'valid') return false;
            if (!active) { baseline = clone(plan.entry.values); draft = clone(baseline); localBaseline = clone(readLocal()); localDraft = clone(localBaseline); active = true; notify(); } return true; },
        update(patch, { validate = true } = {}) { sync(); if (!active) return false;
            const previous = canonicalPlan(draft);
            draft = merge(draft, patch);
            // Ein veränderter CAPE ist kein bestätigter Marktstand. Rückkehr erhält die Herkunft.
            if (patch.cape && Object.hasOwn(patch.cape, 'value')) draft.cape = Object.is(draft.cape.value, baseline.cape.value)
                ? clone(baseline.cape) : { ...draft.cape, asOf: null, source: null };
            if (canonicalPlan(draft) !== previous) notify(); if (validate) assertPlanValues(api.formValues()); return true; },
        updateLocal(patch) { sync(); if (!active) return false;
            const next = { ...localDraft, ...patch };
            if (JSON.stringify(next) !== JSON.stringify(localDraft)) { localDraft = clone(next); notify(); } return true; },
        localValues() { sync(); return clone(active ? localDraft : readLocal()); },
        formValues() { const plan = sync(); const values = active ? merge(plan.entry.values, planTrialPatch(planTrialDifferences(baseline, draft))) : baseline; return values ? clone(values) : null; },
        values() { const plan = sync(); if (plan.status !== 'valid') throw plan.error || new Error('Haushalt & Plan ist noch nicht bestätigt.');
            return clone(assertPlanValues(api.formValues())); },
        reset() { if (busy) return false; clearLocal(); active = false; draft = null; sync(); notify(); return true; },
        async adopt(confirmDifferences, navigationOperation) {
            if (busy) return { status: 'cancelled' };
            const plan = sync();
            if (!active || plan.status !== 'valid') return { status: 'cancelled' };
            const patch = planTrialPatch(planTrialDifferences(baseline, draft));
            const candidate = merge(plan.entry.values, patch);
            const differences = planTrialDifferences(plan.entry.values, candidate);
            if (!differences.length) { api.reset(); return { status: 'unchanged' }; }
            const token = { revision, profile: profile(), scope: scope.key, values: canonicalPlan(plan.entry.values) };
            const sameContext = () => revision === token.revision && profile() === token.profile
                && readPlan().scope?.key === token.scope;
            busy = true; emit();
            try {
                const accepted = await confirmDifferences(clone(differences));
                navigationOperation?.check();
                if (accepted == null || accepted === false) return { status: 'cancelled' };
                // Der alte Bestätigungsadapter bleibt kompatibel; neue Adapter liefern Pfade.
                const paths = accepted === true ? differences.map(item => item.path) : accepted;
                if (!Array.isArray(paths) || paths.some(path => !differences.some(item => item.path === path)))
                    throw new Error('Bitte nur angebotene Planänderungen auswählen.');
                const selected = differences.filter(item => paths.includes(item.path));
                const current = readPlan();
                if (!sameContext() || current.status !== 'valid' || canonicalPlan(current.entry.values) !== token.values)
                    throw new Error('Der Plan oder Bereich hat sich geändert. Bitte die Übernahme erneut prüfen.');
                const selectedPatch = planTrialPatch(selected);
                const selectedValues = assertPlanValues(merge(current.entry.values, selectedPatch));
                if (selectedPatch.cape && Object.hasOwn(selectedPatch.cape, 'value')
                    && !Object.is(selectedPatch.cape.value, current.entry.values.cape.value)
                    && (selectedValues.cape.asOf !== null || selectedValues.cape.source !== null))
                    throw new Error('Ein ausprobierter CAPE hat keinen bestätigten Marktbeleg. Bitte auch CAPE-Datum und CAPE-Quelle zurücknehmen.');
                if (!selected.length) { busy = false; api.reset(); return { status: 'unchanged' }; }
                await writePlan({ scope: clone(scope), patch: selectedPatch, navigationOperation, isCurrent: sameContext });
                if (!sameContext()) throw new Error('Der Planbereich hat sich geändert. Bitte neu laden.');
                clearLocal(); active = false; draft = null; sync(); notify();
                return { status: 'saved' };
            } finally { busy = false; emit(); }
        }
    };
    return api;
}

const contexts = new WeakMap();
export const planTrialContextFor = inputs => contexts.get(inputs) || null;
export function bindPlanTrialContext(inputs, context) { contexts.set(inputs, Object.freeze(clone(context))); return inputs; }

const owners = new WeakMap();
/** Explizite Registrierung: keine Erkennung anhand von Seitenmarkup. */
export function registerPlanTrial(doc, trial) { owners.set(doc, trial); return trial; }
export const registeredPlanTrial = doc => owners.get(doc) || null;
