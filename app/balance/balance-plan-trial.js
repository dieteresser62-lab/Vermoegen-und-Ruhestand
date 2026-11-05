import { bindHouseholdPlanField, HOUSEHOLD_PLAN_DISPLAY_FIELDS, projectHouseholdPlanFieldLabels, HOUSEHOLD_PLAN_CARDS, HOUSEHOLD_PLAN_GROUPS, householdPlanFieldSpec, formatHouseholdPlanValue, readBoundHouseholdPlanField } from '../shared/household-plan-fields.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { assertPlanValues, PLAN_FIELDS,
    readBalanceHouseholdPlan, projectPlanToBalance, patchHouseholdPlan } from '../profile/household-plan.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { requestPageChoice } from '../shared/page-choice-dialog.js';
import { setFieldState } from '../shared/field-state.js';
import { syncSelectionText } from '../shared/designsystem-selection-text.js';
import { projectHouseholdPlanParameters, resetHouseholdPlanParameterDetails } from '../shared/household-plan-presentation.js';

import { createPlanTrial as createSharedPlanTrial, registerPlanTrial, registeredPlanTrial } from '../shared/plan-trial.js';
export const BALANCE_PLAN_FIELD_MAP = Object.freeze({
    ...Object.fromEntries(PLAN_FIELDS.filter(key => !['cape', 'decumulation', 'householdWithdrawalMode', 'jointAssessment'].includes(key)).map(key => [key, key])),
    marketCapeRatio: 'cape.value', entnahmeStrategie: 'decumulation.mode',
    bondTargetFactor: 'decumulation.bondTargetFactor', drawdownTrigger: 'decumulation.drawdownTrigger',
    bondRefillThreshold: 'decumulation.bondRefillThreshold', 'profilverbund-withdrawal-mode': 'householdWithdrawalMode'
});
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @param ids Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function balancePlanFormPatch(doc, ids = Object.keys(BALANCE_PLAN_FIELD_MAP)) {
    const patch = {};
    for (const id of ids) {
        const path = BALANCE_PLAN_FIELD_MAP[id], field = /** @type {HTMLInputElement} */ (doc.getElementById(id));
        if (!path || !field) continue;
        const spec = householdPlanFieldSpec(path);
        const raw = String(field.value ?? '').trim();
        const value = readBoundHouseholdPlanField(field) ?? (spec?.checkbox ? field.checked === true
            : spec?.options ? raw : raw === '' && path === 'decumulation.bondRefillThreshold' ? null
            : raw === '' ? NaN : Number(raw.replace(',', '.')));
        const [key, nested] = path.split('.');
        if (nested) (patch[key] ||= {})[nested] = value; else patch[key] = value;
    }
    if (Number.isFinite(patch.liquidityRunwayYears)) {
        const field = /** @type {HTMLInputElement} */ (doc.getElementById('liquidityCashMonths'));
        if (field) field.max = String(patch.liquidityRunwayYears * 12);
    }
    return patch;
}
export { planTrialDifferences, planTrialPatch, planTrialContextFor, bindPlanTrialContext } from '../shared/plan-trial.js';
/**
 * @param options Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {import("../../typcheck/simulator-ui.js").SharedPlanOptions} [options] @returns Gemeinsamer Planversuch mit Balance-Schreibschutz. */
export function createPlanTrial(options = {}) {
    return /** @type {import("../../typcheck/simulator-ui.js").CreateSharedPlanTrial} */ (createSharedPlanTrial)({ validateBeforeUpdate: true, readPlan: readBalanceHouseholdPlan, writePlan: options => {
        const own = readBalanceHouseholdPlan({ profileId: persistenceStorage.getItem('rs_current_profile') });
        if (own.scope?.key !== /** @type {{scope: {key: string}}} */ (options).scope.key) throw new Error('Die geöffnete Außenperson darf den Haushaltsplan nicht ändern.');
        return patchHouseholdPlan(options);
    }, ...options });
}
const leaf = (values, path) => path.split('.').reduce((value, key) => value?.[key], values);
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function getBalancePlanTrial(doc = globalThis.document) {
    if (!registeredPlanTrial(doc)) registerPlanTrial(doc, createPlanTrial({
        profile: () => persistenceStorage.getItem('rs_current_profile'),
        readLocal: () => { const field = doc.getElementById('rebalancingBand');
            return field ? { rebalancingBand: Number(field.value) } : {}; },
        projectLocal: values => { const field = doc.getElementById('rebalancingBand');
            if (field && values.rebalancingBand !== undefined) /** @type {import("../../typcheck/simulator-analysis.js").NumericInput} */ (field).value = /** @type {number} */ (values.rebalancingBand); }
    }));
    const trial = registeredPlanTrial(doc);
    trial.render = options => renderBalancePlanTrial(doc, options);
    trial.capture = ids => updateBalancePlanTrial(doc, ids);
    return trial;
}
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function readBalanceTrialInputs(doc = globalThis.document) {
    const trial = getBalancePlanTrial(doc);
    // Auch eine noch nicht zugestellte Eingabe darf keinen ungültigen Lauf starten.
    if (trial.read().active) { trial.update(balancePlanFormPatch(doc)); updateLocalTrial(doc, trial); }
    const values = trial.values();
    return { inputs: projectPlanToBalance(values), context: {
        scope: trial.read().scope, deviationApplied: trial.read().differences.length > 0
    } };
}
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @param ids Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function updateBalancePlanTrial(doc = globalThis.document, ids) {
    const trial = getBalancePlanTrial(doc);
    const updated = trial.update(balancePlanFormPatch(doc, ids));
    if (updated && (!ids || ids.includes('rebalancingBand'))) updateLocalTrial(doc, trial);
    // Die Rücklesung programmatischer Übernahmen muss bereits nach dem Ereignis
    // den wirksamen Plan sehen. Ungültige aktive Entwürfe bleiben dagegen stehen.
    if (!updated && trial.read().confirmed) renderBalancePlanTrial(doc, { project: true });
    return updated;
}

const display = (value, path) => value === null
    ? path === 'decumulation.bondRefillThreshold' ? 'automatisch' : 'ohne Beleg'
    : formatHouseholdPlanValue(value, path);
/** @param {{path: string, before: unknown, after: unknown, local?: boolean}} difference @returns {string} */
export const describePlanTrialDifference = difference => `${householdPlanFieldSpec(difference.path)?.label || HOUSEHOLD_PLAN_DISPLAY_FIELDS[difference.path]?.label || difference.path}: ${display(difference.before, difference.path)} → ${display(difference.after, difference.path)}${difference.local ? ' · nur hier' : ''}`;

function trialHeadButtons(doc) {
    return [...new Set([doc.getElementById('balancePlanTrialStart'),
        ...(doc.querySelectorAll?.('[data-plan-trial-toggle]') || [])].filter(Boolean))];
}
function updateLocalTrial(doc, trial) {
    const field = doc.getElementById('rebalancingBand');
    if (!field) return;
    const value = Number(field.value);
    if (!String(field.value).trim() || !Number.isFinite(value) || value < 0 || value > 100)
        throw new Error('Gold-Umschichtungsband: Bitte eine Zahl zwischen 0 und 100 eingeben.');
    trial.updateLocal({ rebalancingBand: value });
}

const numericBindings = new WeakMap();
function syncNumericBindings(doc, state) {
    let fields = numericBindings.get(doc);
    if (!fields) { fields = new Map(); numericBindings.set(doc, fields); }
    for (const [id, path] of Object.entries(BALANCE_PLAN_FIELD_MAP)) {
        const spec = householdPlanFieldSpec(path), field = /** @type {HTMLInputElement} */ (doc.getElementById(id));
        if (!field || !spec || spec.checkbox || spec.options) continue;
        if (state.scope || state.confirmed) {
            if (!fields.has(id)) {
                const originalType = field.type, originalInputMode = field.inputMode;
                field.type = 'text'; field.inputMode = 'decimal';
                const binding = /** @type {import('../../typcheck/balance-ui.js').WithOptions<typeof bindHouseholdPlanField, {doc: Document, field: HTMLInputElement, path: string}>} */ (bindHouseholdPlanField)({ doc, field, path, includeUnit: false });
                fields.set(id, { binding, field, originalType, originalInputMode });
            }
        } else if (fields.has(id)) {
            const old = fields.get(id), value = readBoundHouseholdPlanField(field);
            old.binding.dispose(); field.type = old.originalType; field.inputMode = old.originalInputMode;
            field.value = value ?? ''; fields.delete(id);
        }
    }
    return fields;
}
const bindings = new WeakMap();
const boundFields = new WeakMap();
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function renderBalancePlanTrial(doc = globalThis.document, { project = false } = {}) {
    const trial = getBalancePlanTrial(doc), state = trial.read();
    if (project && !state.active && state.scope) resetHouseholdPlanParameterDetails(doc, trial.formValues());
    projectHouseholdPlanFieldLabels(doc, BALANCE_PLAN_FIELD_MAP);
    for (const heading of doc.querySelectorAll?.('[data-plan-card-label]') || [])
        heading.textContent = HOUSEHOLD_PLAN_CARDS[/** @type {HTMLElement} */ (heading).dataset.planCardLabel];
    for (const hint of doc.querySelectorAll?.('[data-plan-field-hint]') || [])
        hint.textContent = householdPlanFieldSpec(/** @type {HTMLElement} */ (hint).dataset.planFieldHint)?.hint || '';
    for (const heading of doc.querySelectorAll?.('[data-plan-group-label]') || [])
        if (!heading.closest?.('.household-plan-more')) heading.textContent = HOUSEHOLD_PLAN_GROUPS[/** @type {HTMLElement} */ (heading).dataset.planGroupLabel].label;
    const numeric = syncNumericBindings(doc, state);
    if (project && state.scope) {
        const raw = trial.formValues();
        let valid = true;
        try { if (raw) assertPlanValues(raw); } catch { valid = false; }
        const values = raw ? Object.fromEntries(Object.entries(BALANCE_PLAN_FIELD_MAP).map(([id, path]) => [id, leaf(raw, path)])) : null;
        if (valid) doc.getElementById('dynamicFlexPreset')?.setCustomValidity?.('');
        if (values) for (const id of Object.keys(BALANCE_PLAN_FIELD_MAP)) {
            const field = /** @type {HTMLInputElement} */ (doc.getElementById(id)); if (!field) continue;
            if (numeric.has(id)) {
                if (values[id] === null || Number.isFinite(values[id])) numeric.get(id).binding.project(values[id], { force: !state.active });
            }
            else if (field.type === 'checkbox') field.checked = values[id] === true;
            else field.value = values[id] ?? '';
            if (valid) field.setCustomValidity?.('');
            if (field.tagName === 'SELECT') syncSelectionText(field);
        }
    }
    const cashMonthsField = /** @type {HTMLInputElement} */ (doc.getElementById('liquidityCashMonths'));
    const runwayField = doc.getElementById('liquidityRunwayYears');
    if (cashMonthsField && runwayField) {
        const months = Number(String(runwayField.value).replace(',', '.')) * 12;
        cashMonthsField.max = Number.isFinite(months) && months > 0 ? String(months) : '120';
    }
    if (project && state.active) {
        const local = trial.localValues(), gold = doc.getElementById('rebalancingBand');
        if (gold && local.rebalancingBand !== undefined) gold.value = local.rebalancingBand;
    }
    for (const id of [...Object.keys(BALANCE_PLAN_FIELD_MAP), 'dynamicFlexPreset', 'rebalancingBand']) {
        const field = /** @type {HTMLInputElement} */ (doc.getElementById(id)); if (!field) continue;
        // Vor der ersten Bestätigung gehören Sperren und Herkunft dem Altformular.
        // Ein später verlorener Plan darf diesen Schreib-/Rechenweg nicht freigeben.
        const planBound = Boolean(state.scope) || state.confirmed;
        field.dataset.planTrialReadonly = String(planBound && !state.active);
        if (!planBound) {
            // Nur die vom Planbesitzer gesetzte Sperre zurücknehmen. Fachliche
            // Inaktivität wird beim produktiven Refresh weiterhin berechnet.
            if (boundFields.has(field)) {
                field.disabled = field.dataset.planTrialInactive === undefined
                    ? boundFields.get(field).disabled : field.dataset.planTrialInactive === 'true';
                boundFields.delete(field);
                if (field.ownerDocument && field.parentNode && field.dataset.fieldState === 'adopted')
                    setFieldState(field, 'editable', '');
            }
            continue;
        }
        // Profilwerte bleiben ohne Versuch bei der aktuellen Profilprojektion.
        // Die lokale Baseline und deren Rückkehr gehören dem Versuchsbesitzer.
        if (!boundFields.has(field)) boundFields.set(field, { disabled: field.disabled });
        field.disabled = state.busy || !state.active || !state.scope || field.dataset.planTrialInactive === 'true';
        if (field.ownerDocument && field.parentNode) {
            if (!state.active) setFieldState(field, 'adopted', id === 'rebalancingBand' ? 'aus Personen & Vermögen · nur lokal ausprobierbar' : 'aus Haushalt & Plan');
            else if (!field.disabled && field.dataset.fieldState === 'adopted') setFieldState(field, 'editable', '');
        }
    }
    for (const id of ['goldAktiv', 'goldZielProzent', 'goldFloorProzent', 'goldSteuerfrei']) {
        const field = /** @type {HTMLInputElement} */ (doc.getElementById(id)); if (field) { field.disabled = true; field.dataset.planTrialReadonly = 'true'; }
    }
    projectHouseholdPlanParameters(doc, doc.getElementById('balanceAllParameters'), {
        ...BALANCE_PLAN_FIELD_MAP, dynamicFlexPreset: 'dynamicFlexPreset', rebalancingBand: 'rebalancingBand'
    }, trial.formValues(), { trial: true });
    const band = doc.getElementById('balancePlanTrialBand'), list = doc.getElementById('balancePlanTrialDifferences');
    if (band) band.hidden = !state.active;
    if (list) { list.textContent = ''; for (const difference of state.differences) {
        const item = doc.createElement('li'); item.className = 'sim-plan-difference'; item.textContent = describePlanTrialDifference(difference) + (difference.local ? ' · Ursprung: Personen & Vermögen' : ''); list.appendChild(item);
    } }
    const message = doc.getElementById('balancePlanTrialMessage');
    if (message) message.textContent = state.differences.length ? 'Ausprobiert – weicht vom Plan ab, wird nicht gespeichert.' : 'Nur hier ausprobieren – bisher ohne Abweichung vom Plan.';
    for (const start of trialHeadButtons(doc)) {
        start.hidden = false; start.disabled = !state.scope || state.busy;
        start.textContent = state.active ? 'Zurück zum Plan' : 'Nur hier ausprobieren';
    }
    for (const id of ['balancePlanTrialBack', 'balancePlanTrialAdopt']) {
        const button = /** @type {HTMLButtonElement} */ (doc.getElementById(id));
        if (button) button.disabled = state.busy || id === 'balancePlanTrialAdopt' && !state.differences.some(item => !item.local);
    }
    bindings.get(doc)?.registration?.notify();
}
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function initBalancePlanTrial({ doc = globalThis.document, refresh = () => {},
    requestChoice = /** @type {import("../../typcheck/simulator-ui.js").PageChoice} */ (requestPageChoice) } = {}) {
    if (bindings.has(doc)) return;
    const trial = getBalancePlanTrial(doc), guard = getPageNavigationGuard(doc);
    const registration = guard.register(trial, { read: () => { const state = trial.read(); return {
        dirty: state.differences.length > 0, revision: state.revision,
        message: 'Der Balanceversuch wird beim Wechsel verworfen.'
    }; } });
    const lifecycle = createNavigationOperationLifecycle({ guard });
    bindings.set(doc, { registration });
    trial.subscribe(() => {
        const status = doc.getElementById('balancePlanTrialStatus'); if (status) status.textContent = '';
        renderBalancePlanTrial(doc);
    });
    const redraw = () => { renderBalancePlanTrial(doc, { project: true }); refresh();
        doc.dispatchEvent?.(new Event('balance:plan-trial')); };
    for (const button of trialHeadButtons(doc)) button.addEventListener('click', () => {
        if (trial.read().active) trial.reset(); else trial.start(); redraw();
    });
    doc.getElementById('balancePlanTrialBack')?.addEventListener('click', () => { trial.reset(); redraw(); doc.getElementById('balancePlanTrialStart')?.focus(); });
    doc.getElementById('balancePlanTrialAdopt')?.addEventListener('click', async event => {
        const status = doc.getElementById('balancePlanTrialStatus');
        try {
            trial.update(balancePlanFormPatch(doc));
            updateLocalTrial(doc, trial);
            const result = await lifecycle.run({}, operation => trial.adopt(async differences => {
                const selected = await requestChoice({ doc, opener: event.currentTarget,
                    title: 'Änderungen in Haushalt & Plan übernehmen?',
                    description: 'Wähle die Änderungen, die künftig für Balance und Simulator gelten sollen.',
                    rows: differences.map(difference => ({ id: difference.path,
                        label: describePlanTrialDifference(difference), selected: 'adopt',
                        options: [{ value: 'adopt', label: 'Übernehmen' }, { value: 'keep', label: 'Im Plan belassen' }] })),
                    confirmLabel: 'Auswahl in den Plan übernehmen', cancelLabel: 'Abbrechen' });
                return selected === null ? null : differences.filter(item => selected[item.path] === 'adopt').map(item => item.path);
            }, operation));
            if (status) status.textContent = result.status === 'saved' ? 'Im gemeinsamen Plan gespeichert.' : '';
            redraw();
            if (['saved', 'unchanged'].includes(result.status)) doc.getElementById('balancePlanTrialStart')?.focus();
        } catch (error) { if (status) status.textContent = `Nicht gespeichert: ${error.message}`; renderBalancePlanTrial(doc); }
    });
    const gold = doc.getElementById('rebalancingBand');
    for (const type of ['input', 'change']) gold?.addEventListener(type, () => {
        try { if (trial.read().active) updateLocalTrial(doc, trial); else redraw(); gold.setCustomValidity?.(''); }
        catch (error) { gold.setCustomValidity?.(error.message); }
    });
    // Der Seitenstart rechnet nach der vollständigen UI-Bindung genau einmal.
    // Hier werden nur Planwerte und Sperren projiziert.
    renderBalancePlanTrial(doc, { project: true });
}
/**
 * @param doc Eingabe für die bestehende Projektion.
 * @param opener Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export async function discardBalanceTrialForScopeChange(doc = globalThis.document, opener) {
    const trial = getBalancePlanTrial(doc), guard = getPageNavigationGuard(doc);
    const attempt = await guard.prepare({ owners: [trial], intent: 'discard', opener });
    if (!attempt) return false;
    const accepted = guard.validate(attempt); guard.end(attempt);
    if (accepted) trial.reset();
    return accepted;
}
