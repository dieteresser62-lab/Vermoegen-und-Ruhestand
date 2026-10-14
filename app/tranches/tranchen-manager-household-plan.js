import { assertHouseholdPlanInputValues, bindHouseholdPlanField, readHouseholdPlanField, projectHouseholdPlanBindings, hasHouseholdPlanDynamicErrors, hasHouseholdPlanDynamicCorrections } from '../shared/household-plan-fields.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { appNow } from '../shared/app-clock.js';
import { persistenceStorage, PersistenceFacade } from '../shared/persistence-facade.js';
import { readBalanceHouseholdPlan, assertPlanValues, patchHouseholdPlan, canonicalPlan } from '../profile/household-plan.js';
import { initializeHouseholdPlanPage } from '../profile/household-plan-dialog.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { getPlanField, setPlanField } from '../profile/household-plan-migration.js';
import { projectHouseholdPlanComparison } from '../profile/household-plan-comparison.js';
import { projectOverview, planningYear } from '../overview/overview-model.js';
import { sourceFingerprint } from '../overview/overview-simulation-summary.js';
import { readOverviewSummary, OVERVIEW_SUMMARY_KEY, overviewScope } from '../overview/overview-storage.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { renderManagerPlanComparison, renderManagerPlanSummary } from './tranchen-manager-renderer.js';
import { bindHouseholdPlanDynamicFlex } from '../shared/household-plan-dynamic-flex.js';

export const managerPlanFieldId = path => 'managerPlan_' + path.replaceAll('.', '_');
export const managerPlanFieldValue = readHouseholdPlanField;
export function managerPlanPatch(values, changes) {
    const effective = structuredClone(values), patch = {};
    for (const [path, value] of Object.entries(changes)) {
        setPlanField(effective, path, value);
        const [key, nested] = path.split('.');
        if (nested) (patch[key] ||= {})[nested] = value; else patch[key] = value;
    }
    assertHouseholdPlanInputValues(effective, Object.keys(changes));
    assertPlanValues(effective);
    return patch;
}

/** Ein Controller pro statischem Host. Planfelder werden niemals neu erzeugt. */
export function createManagerHouseholdPlan({ doc, getProfileId, storage = persistenceStorage, persistence = PersistenceFacade,
    runOperation, notify = () => {}, blocked = () => false, now = appNow,
    schedule = setTimeout, unschedule = clearTimeout, initialize = initializeHouseholdPlanPage } = {}) {
    const host = doc.getElementById('managerHouseholdPlan');
    const fields = Array.from(host?.querySelectorAll?.('[data-manager-plan-field]') || []);
    let confirmed = null, scope = null, origin = null, generation = 0, revision = 0;
    let changes = {}, retryChanges = null, inFlightChanges = null, timer = null, writing = null, error = '', validation = '', disposed = false, saved = false;
    const node = id => doc.getElementById(id);
    const text = (id, value) => { if (node(id)) node(id).textContent = value; };
    const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
    const current = (key = scope?.key, id = origin, epoch = generation) => {
        if (disposed || getProfileId() !== id || generation !== epoch) return false;
        try { return readBalanceHouseholdPlan({ storage, profileId: id }).scope?.key === key; } catch { return false; }
    };
    const dirty = () => Object.keys(changes).length > 0 || Boolean(retryChanges);
    const bindings = new Map(fields.map(field => {
        const path = field.dataset.managerPlanField;
        return [path, bindHouseholdPlanField({ doc, field, path, nativeOnly: path === 'dynamicFlex', row: field.closest?.('.pv-plan-field'), onChange: field => changed({ target: field }),
            onFocusStateChange: focusState => {
                visible(effective(), focusState);
                if (path === 'goGoMultiplier' && focusState.correctionChanged) arm();
            } })];
    }));
    const effective = () => {
        if (!confirmed) return null;
        const values = structuredClone(confirmed.values);
        for (const [path, value] of Object.entries({ ...inFlightChanges, ...retryChanges, ...changes })) setPlanField(values, path, value);
        return values;
    };
    const dynamic = bindHouseholdPlanDynamicFlex({ doc, root: host, host: host?.querySelector?.('[data-plan-dynamic-presets-host]'),
        details: host?.querySelector?.('[data-plan-dynamic-details]'), read: effective,
        hasDetailErrors: () => hasHouseholdPlanDynamicErrors(bindings),
        hasDetailCorrections: () => hasHouseholdPlanDynamicCorrections(bindings),
        disabled: () => !confirmed || !current() || Boolean(fields.find(field => field.dataset.managerPlanField === 'dynamicFlex')?.disabled),
        onChange: patch => {
            // Auch noch nicht per input gemeldete Texte gehören zum selben Batch.
            const pending = {}, applicable = { ...patch };
            for (const field of fields) {
                const path = field.dataset.managerPlanField, value = managerPlanFieldValue(field, path);
                if (!Object.is(value, getPlanField(confirmed.values, path))) pending[path] = value;
                if (bindings.get(path).isInvalid()) delete applicable[path];
            }
            changeBatch({ ...pending, ...applicable });
            for (const [path, value] of Object.entries(applicable)) bindings.get(path)?.project(value, { force: true });
        } });
    const visible = (values, focusState) => { for (const binding of bindings.values()) binding.sync(values, validation); dynamic?.sync(focusState); renderManagerPlanSummary(doc, values); };
    function projectFields(force = false) {
        if (!confirmed) return;
        projectHouseholdPlanBindings(bindings, confirmed.values, { force });
        visible(confirmed.values);
        const cape = confirmed.values.cape;
        text('managerPlanCape', String(cape.value).replace('.', ','));
        text('managerPlanCapeOrigin', [cape.asOf ? new Date(cape.asOf).toLocaleDateString('de-DE') : 'Stand nicht belegt', cape.source || 'Quelle nicht belegt'].join(' · '));
    }
    function syncBlocked(external = blocked()) {
        const locked = !confirmed || persistence.hasSyncWriteBlocks?.() || Boolean(globalThis.window?.__profileRecoveryBlocker);
        for (const field of fields) field.disabled = locked || external && !writing;
        for (const binding of bindings.values()) binding.sync(null, validation);
        dynamic?.sync();
        if (node('managerPlanRetry')) { node('managerPlanRetry').hidden = !retryChanges; node('managerPlanRetry').disabled = locked || Boolean(writing); }
    }
    function status() {
        let validationText = validation;
        for (const field of fields) {
            const label = field.labels?.[0]?.textContent;
            if (label) validationText = validationText.replace(field.dataset.managerPlanField, label.trim());
        }
        text('managerPlanTechnicalMessage', error);
        if (node('managerPlanTechnical')) node('managerPlanTechnical').hidden = !error;
        text('managerPlanStatus', validation ? `Nicht gespeichert: ${validationText}` : error
            ? persistence.hasSyncWriteBlocks?.() ? 'Speichern und Rücknahme nicht bestätigt. Bitte neu laden und die Sicherung prüfen.' : 'Nicht gespeichert. Die Änderung konnte nicht bestätigt werden. Bitte erneut versuchen.'
            : writing ? 'Wird gespeichert …' : dirty() ? 'Änderungen warten auf Bestätigung …' : confirmed ? saved ? 'Gespeichert' : 'Bestätigter Plan geladen' : 'Planbereich noch nicht bestätigt.');
        syncBlocked(); notify();
    }
    function comparison() {
        if (!scope) return;
        const registry = loadProfileRegistry(storage).value;
        if (!registry) return;
        const liveData = Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)).map(key => [key, storage.getItem(key)]));
        let year, preview, source;
        if (scope.kind === 'household') {
            const overview = projectOverview({ registry, activeId: origin, liveData, now: now() });
            year = overview.year; preview = overview.previewSummary;
            source = sourceFingerprint({ registry, activeId: origin, liveData, scope: overview.scope, kind: 'balance' });
        } else {
            year = planningYear(loadStoredBalanceStateFromData(liveData).value?.annualPeriodMetadata, now());
            const previewScope = overviewScope('single', scope.ids);
            preview = readOverviewSummary(liveData[OVERVIEW_SUMMARY_KEY], year, previewScope);
            source = sourceFingerprint({ registry, activeId: origin, liveData, scope: previewScope, kind: 'balance' });
        }
        const view = projectHouseholdPlanComparison({ year, scope, storage, preview, sourceFingerprint: source, planUpdatedAt: confirmed?.updatedAt, now: now() });
        renderManagerPlanComparison(doc, view);
        const record = readAnnualPlanRecord({ year, scope, storage });
        const snapshot = record?.status !== 'invalid' ? record?.adopted?.snapshot : null;
        // updatedAt ist kein Inflationsnachweis. Nur die passende Momentaufnahme zählt.
        const matches = confirmed && snapshot && canonicalPlan(snapshot.plan) === canonicalPlan(confirmed.values);
        text('managerPlanInflation', matches ? `zuletzt fortgeschrieben mit der Inflation ${record.periodId.slice('calendar-year:'.length)} (${snapshot.inflation > 0 ? '+' : ''}${snapshot.inflation.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)` : 'Inflationsfortschreibung noch nicht belegt');
    }
    function safeComparison() {
        text('managerPlanInflation', 'Inflationsfortschreibung noch nicht belegt');
        try { comparison(); }
        catch { text('managerPlanComparison', 'Planvergleich derzeit nicht lesbar. Bitte die Sicherung prüfen.'); }
    }
    function refresh() {
        if (disposed || writing || dirty()) return false;
        const previousScope = scope?.key, previousOrigin = origin;
        clearTimer(); generation++; origin = getProfileId(); error = ''; validation = ''; saved = false; confirmed = null; scope = null;
        text('managerPlanScope', 'Planbereich noch nicht bestätigt');
        text('managerPlanCape', '—'); text('managerPlanCapeOrigin', 'Stand und Quelle nicht belegt');
        renderManagerPlanSummary(doc, null);
        text('managerPlanInflation', 'Inflationsfortschreibung noch nicht belegt');
        if (node('managerPlanComparison')) node('managerPlanComparison').innerHTML = '';
        try {
            const loaded = readBalanceHouseholdPlan({ storage, profileId: origin });
            scope = loaded.scope; confirmed = loaded.status === 'valid' ? loaded.entry : null;
            const registry = loadProfileRegistry(storage).value;
            const names = scope?.ids.map(id => registry?.profiles[id]?.meta.name || id) || [];
            text('managerPlanScope', scope?.kind === 'household' ? `Haushalt: ${names.join(' + ')}` : `${names[0] || '—'} (allein gerechnet)`);
            projectFields(true);
            // Rückmeldungen desselben Editors sind kein Verwerfen der Auswahl.
            if (previousScope !== scope?.key || previousOrigin !== origin) dynamic?.reset();
            else dynamic?.sync();
            safeComparison();
        } catch (caught) { error = caught.message; }
        if (!confirmed) for (const field of fields) { field.value = ''; field.checked = false; }
        if (node('managerPlanResume')) node('managerPlanResume').hidden = Boolean(confirmed);
        status(); return Boolean(confirmed);
    }
    const correctingFactor = () => bindings.get('goGoMultiplier')?.isCorrecting();
    function arm() {
        clearTimer();
        if (!dirty() || validation || error || writing || blocked() || correctingFactor()) return;
        const epoch = generation, id = origin, key = scope?.key;
        timer = schedule(() => { timer = null; if (current(key, id, epoch) && !correctingFactor()) void flush(true); }, 300);
    }
    async function drain(automatic) {
        while (dirty()) {
            if (!confirmed || validation || error || !current() || (automatic && correctingFactor())) return false;
            const batch = { ...retryChanges, ...changes }, epoch = generation, id = origin, key = scope.key, submittedRevision = revision;
            let patch;
            try { patch = managerPlanPatch(confirmed.values, batch); } catch (caught) { validation = caught.message; status(); return false; }
            inFlightChanges = batch; changes = {}; retryChanges = null;
            try {
                const entry = await runOperation(async operation => {
                    operation.check(); operation.commit();
                    return patchHouseholdPlan({ scope, patch, storage, persistence, now, navigationOperation: operation,
                        isCurrent: () => current(key, id, epoch) });
                });
                if (!entry || !current(key, id, epoch)) throw new Error('Planänderung wurde nicht bestätigt.');
                confirmed = entry; inFlightChanges = null; saved = true;
                if (revision === submittedRevision) projectFields();
                safeComparison();
            } catch (caught) {
                inFlightChanges = null; retryChanges = batch; error = caught.message;
                if (revision === submittedRevision) projectFields(true);
                status(); return false;
            }
        }
        return true;
    }
    function flush(automatic = false) {
        clearTimer();
        if (writing) return writing.then(ok => ok && dirty() ? flush(automatic) : ok);
        if (!dirty()) return Promise.resolve(true);
        // Promise setzen, bevor der Lifecycle Controls benachrichtigt.
        writing = Promise.resolve().then(() => drain(automatic)).finally(() => { writing = null; status(); });
        status(); return writing;
    }
    function discard() {
        if (writing) return false;
        clearTimer(); changes = {}; retryChanges = null; validation = ''; error = ''; revision++; generation++;
        projectFields(true); dynamic?.reset(); status(); return true;
    }
    function changeBatch(batch) {
        if (!confirmed || !current()) return;
        const previous = effective();
        const actual = Object.entries(batch).filter(([path, value]) => !Object.is(getPlanField(previous, path), value));
        if (!actual.length) return;
        for (const [path, value] of actual) changes[path] = value;
        revision++; error = ''; validation = '';
        try { managerPlanPatch(confirmed.values, { ...inFlightChanges, ...retryChanges, ...changes }); }
        catch (caught) { validation = caught.message; }
        visible(effective()); status(); arm();
    }
    function changed(event) {
        const field = event.target?.closest?.('[data-manager-plan-field]');
        if (!field || field.disabled || !confirmed || !current()) return;
        const path = field.dataset.managerPlanField;
        const value = managerPlanFieldValue(field, path);
        changeBatch({ [path]: value });
    }
    const focus = () => { if (!confirmed && !writing && !dirty()) refresh(); };
    const retry = () => { if (disposed) return; error = ''; validation = ''; void flush(); };
    const resume = async () => { if (disposed) return; await initialize({ doc, reopen: true, storage }); refresh(); };
    host?.addEventListener('focusin', focus);
    host?.addEventListener('input', changed); host?.addEventListener('change', changed);
    node('managerPlanRetry')?.addEventListener('click', retry);
    node('managerPlanResume')?.addEventListener('click', resume);
    refresh();
    return { flush: () => flush(), refresh, discard, syncBlocked, pause: clearTimer, resume: arm,
        read: () => ({ revision, dirty: dirty(), writing: Boolean(writing), error, validation, scope: scope?.key, origin }),
        dispose: () => {
            clearTimer(); disposed = true; dynamic?.dispose(); for (const binding of bindings.values()) binding.dispose();
            host?.removeEventListener?.('input', changed); host?.removeEventListener?.('change', changed); host?.removeEventListener?.('focusin', focus);
            node('managerPlanRetry')?.removeEventListener?.('click', retry); node('managerPlanResume')?.removeEventListener?.('click', resume);
        } };
}
