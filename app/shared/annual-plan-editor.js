import { assertPlanValues, PLAN_FIELD_PATHS } from '../profile/household-plan.js';
import { getPlanField, setPlanField } from '../profile/household-plan-migration.js';
import { HOUSEHOLD_PLAN_FIELDS, HOUSEHOLD_PLAN_GROUPS, createHouseholdPlanHint, assertHouseholdPlanInputValues, bindHouseholdPlanField, readHouseholdPlanField, projectHouseholdPlanBindings, hasHouseholdPlanDynamicErrors, hasHouseholdPlanDynamicCorrections } from './household-plan-fields.js';
import { computeAnnualPlanUpdate } from '../balance/balance-annual-storage.js';
import { evaluateAnnualDraft } from '../balance/balance-annual-storage-commit.js';
import { annualEngineLoader } from './annual-engine-loader.js';
import { persistenceStorage } from './persistence-facade.js';
import { createManualAnnualQuote } from './annual-marketdata.js';
import { appNow } from './app-clock.js';
import { bindHouseholdPlanDynamicFlex } from './household-plan-dynamic-flex.js';
import { formatAnnualNeed } from '../balance/balance-annual-preview.js';

/** Rechnet ausschließlich in privatem Speicher, mit Engine auf Abruf. */
export async function evaluateAnnualPlanPreview({ targetYear, marketData, adoptedPlanPatch, storage = persistenceStorage,
    engineLoader = annualEngineLoader, now = appNow, signal } = {}) {
    signal?.throwIfAborted();
    const engineApi = await engineLoader.load();
    signal?.throwIfAborted();
    if (marketData.manualPrice !== undefined) marketData = { ...marketData, etf: createManualAnnualQuote(marketData.manualPrice, `calendar-year:${targetYear}`) };
    const date = now(), draft = computeAnnualPlanUpdate({ targetYear, marketData, storage, now: () => date });
    const recommended = evaluateAnnualDraft(draft, { engineApi, now: () => date });
    const adopted = adoptedPlanPatch === undefined ? recommended : evaluateAnnualDraft(draft, { engineApi, adoptedPlanPatch, now: () => date });
    return { values: draft.values, recommended: recommended.outcome, adopted: adopted.outcome, adjustedFields: adopted.adjustedFields };
}

export { householdPlanFieldVisible as annualPlanFieldVisible } from './household-plan-fields.js';

/** Jede Eingabe entwertet ältere Rechnungen bereits synchron. */
export function createAnnualPlanDraft({ evaluate, notify = () => {} } = {}) {
    let revision = 0, base = null, values = null, changes = {}, result = null, error = '', pending = false, disposed = false;
    const patch = () => {
        const next = {};
        for (const [path, value] of Object.entries(changes)) {
            if (Object.is(getPlanField(base, path), value)) continue;
            const [key, nested] = path.split('.');
            if (nested) (next[key] ||= {})[nested] = value; else next[key] = value;
        }
        return Object.keys(next).length ? next : undefined;
    };
    const read = () => ({ revision, values, result, error, pending, valid: Boolean(result && !error && !pending), dirty: Object.keys(changes).length > 0 });
    async function calculate() {
        const current = ++revision; result = null; error = ''; pending = true; notify(read());
        try {
            values = structuredClone(base);
            for (const [path, value] of Object.entries(changes)) setPlanField(values, path, value);
            assertHouseholdPlanInputValues(values, Object.keys(changes));
            assertPlanValues(values); notify(read());
            const next = await evaluate(patch());
            if (disposed || current !== revision) return;
            result = next;
        } catch (caught) { if (!disposed && current === revision) error = caught.message; }
        finally { if (!disposed && current === revision) { pending = false; notify(read()); } }
    }
    function changeBatch(batch) {
        if (!base || disposed) return;
        let changed = false;
        for (const [path, value] of Object.entries(batch)) {
            if (!PLAN_FIELD_PATHS.includes(path) || path.startsWith('cape.') || Object.is(getPlanField(values, path), value)) continue;
            changed = true;
            if (Object.is(getPlanField(base, path), value)) delete changes[path]; else changes[path] = value;
        }
        if (changed) return calculate();
    }
    return { read, setBase(next) { base = structuredClone(next); return calculate(); }, changeBatch,
        change(path, value) { return changeBatch({ [path]: value }); },
        discard() { changes = {}; return calculate(); },
        accept() { if (!read().valid) throw new Error(error || 'Bitte die aktuelle Planberechnung abwarten.'); return patch(); },
        dispose() { disposed = true; revision++; }
    };
}

export { HOUSEHOLD_PLAN_FIELDS as ANNUAL_PLAN_FIELDS } from './household-plan-fields.js';

export function createAnnualPlanEditor({ doc, listen, evaluate, getPreview, onState = () => {} } = {}) {
    const root = doc.createElement('section'); root.dataset.annualPlanEditor = ''; root.className = 'annual-plan-editor';
    const create = (tag, text = '', className = '') => { const node = doc.createElement(tag); node.textContent = text; node.className = className; return node; };
    const summary = create('dl', '', 'annual-plan-summary'); summary.dataset.annualPlanSummary = '';
    const summaryCells = new Map();
    for (const [key, label] of [['monthlyBudget', 'Monatsbudget'], ['pension', 'Davon Renten im Jahresdurchschnitt'],
        ['income', 'Davon sonstige Einkünfte'], ['monthlyWithdrawal', 'Geplante Entnahme aus dem Vermögen']]) {
        const row = create('div'), term = create('dt', label), value = create('dd', '—');
        row.append(term, value); summary.append(row); summaryCells.set(key, { row, term, value });
    }
    summary.hidden = !getPreview;
    const changes = create('section'); changes.dataset.annualPlanChanges = ''; changes.hidden = !getPreview;
    const comparison = create('div', '', 'annual-plan-comparison ds-table-box');
    const table = create('table', '', 'ds-table'); table.setAttribute('aria-label', 'Empfehlung der App und Dein Plan');
    const head = create('thead'), headRow = create('tr'), adoptedTitle = create('th', 'Dein Plan');
    const badge = doc.createElement('span'); badge.textContent = 'angepasst'; badge.className = 'ds-badge'; badge.dataset.annualPlanAdjusted = ''; badge.hidden = true; adoptedTitle.append(badge);
    headRow.append(create('th', ''), create('th', 'Empfehlung der App'), adoptedTitle); head.append(headRow);
    const body = create('tbody'), recommendedCells = [], adoptedCells = [];
    for (const label of ['Vermögensentnahme / Monat', 'Monatsbudget']) {
        const row = create('tr'), title = create('th', label); title.setAttribute('scope', 'row');
        const recommendation = create('td', '—'), adopted = create('td', '—');
        recommendation.dataset.annualRecommendation = ''; adopted.dataset.annualAdopted = '';
        recommendedCells.push(recommendation); adoptedCells.push(adopted); row.append(title, recommendation, adopted); body.append(row);
    }
    table.append(head, body); comparison.append(table);
    const status = create('p'); status.setAttribute('role', 'status'); status.dataset.annualPlanStatus = '';
    const toggle = doc.createElement('button'); toggle.textContent = 'Plan anpassen …'; toggle.className = 'ds-button ds-button-secondary'; toggle.type = 'button'; toggle.dataset.annualPlanToggle = '';
    const panel = doc.createElement('div'); panel.id = 'annualPlanFields'; panel.hidden = true; panel.dataset.annualPlanPanel = '';
    toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-expanded', 'false');
    const grid = create('div', '', 'household-plan-groups');
    const groups = HOUSEHOLD_PLAN_GROUPS.map(spec => {
        const group = create('section', '', 'household-plan-group'), title = create('h3', spec.label);
        if (spec.hint) title.append(create('small', spec.hint)); group.append(title); grid.append(group); return group;
    });
    const discard = doc.createElement('button'); discard.textContent = 'Anpassung verwerfen'; discard.className = 'ds-button ds-button-secondary'; discard.type = 'button'; discard.dataset.annualPlanDiscard = ''; discard.disabled = true;
    const bindings = new Map(), fields = new Map(), observedValues = new Map(); let initialized = false, dynamic = null;
    const projectFields = values => {
        projectHouseholdPlanBindings(bindings, values, { force: true });
        for (const [path, field] of fields) observedValues.set(path, readHouseholdPlanField(field, path));
    };
    const presets = create('div'); presets.dataset.planDynamicPresetsHost = '';
    const details = create('div'); details.dataset.planDynamicDetails = ''; details.hidden = true;
    groups[4].append(presets);
    const money = value => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    const draft = createAnnualPlanDraft({ evaluate, notify: state => {
        for (const [path, field] of fields) {
            field.disabled = !initialized;
            bindings.get(path).sync(state.values, state.error);
        }
        dynamic?.sync();
        status.textContent = state.error ? `Plan nicht gültig: ${state.error}` : state.pending ? 'Dein Plan wird berechnet …' : state.valid ? 'Dein Plan ist gültig.' : 'Marktdaten abwarten.';
        badge.hidden = !state.dirty; discard.disabled = !state.dirty || !initialized;
        if (state.dirty) { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
        for (const [index, key] of ['monthlyWithdrawal', 'monthlyBudget'].entries()) {
            adoptedCells[index].textContent = state.valid ? money(state.result.adopted[key]) : '—';
            if (state.valid) recommendedCells[index].textContent = money(state.result.recommended[key]);
        }
        if (getPreview) {
            const preview = getPreview(), adopted = state.valid ? state.result.adopted : null;
            summaryCells.get('monthlyBudget').term.textContent = `Monatsbudget ${preview.planningYear}`;
            for (const key of ['monthlyBudget', 'monthlyWithdrawal']) summaryCells.get(key).value.textContent = adopted ? money(adopted[key]) : '—';
            const people = preview.people || [];
            const pension = people.length && people.every(person => !person.error && Number.isFinite(person.budgetPensionMonthly))
                ? people.reduce((sum, person) => sum + person.budgetPensionMonthly, 0) : null;
            const income = people.reduce((sum, person) => sum + (person.sonstigeEinkuenfte || 0), 0);
            summaryCells.get('pension').value.textContent = adopted && pension !== null ? money(pension) : '—';
            summaryCells.get('income').row.hidden = !(income > 0);
            summaryCells.get('income').value.textContent = adopted ? money(income) : '—';
            Array.from(changes.children).forEach(child => child.remove());
            changes.append(create('h4', `Änderungen gegenüber ${preview.targetYear}`));
            for (const need of preview.needs.filter(need => ['floorBedarf', 'flexBedarf'].includes(need.id))) {
                const after = adopted?.snapshot?.plan?.[need.id];
                changes.append(create('p', `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${adopted
                    ? formatAnnualNeed({ ...need, after: Number.isFinite(after) ? after : need.after }, { ...preview, adjustedFields: state.result.adjustedFields || [] }) : '—'}`));
            }
        }
        onState(state);
    } });
    for (const spec of HOUSEHOLD_PLAN_FIELDS) {
        const row = create('div', '', 'household-plan-field ds-field');
        const label = create('label', spec.label);
        if (spec.hint) label.append(createHouseholdPlanHint(doc, spec));
        const field = create(spec.options ? 'select' : 'input');
        field.id = 'annualPlan_' + spec.path.replaceAll('.', '_'); label.setAttribute('for', field.id);
        field.dataset.annualPlanField = spec.path;
        if (spec.options) for (const [value, text] of spec.options) { const option = create('option', text); option.value = value; field.append(option); }
        else { field.type = spec.checkbox ? 'checkbox' : 'text'; if (!spec.checkbox) field.setAttribute('inputmode', 'decimal'); }
        field.className = spec.options ? 'ds-select' : spec.checkbox ? 'ds-checkbox' : 'ds-input'; field.disabled = true;
        row.append(label, field);
        (spec.group === 4 && spec.path !== 'dynamicFlex' ? details : groups[spec.group]).append(row); fields.set(spec.path, field);
        const changed = () => {
            if (field.disabled) return;
            const value = readHouseholdPlanField(field, spec.path);
            observedValues.set(spec.path, value);
            if (Object.is(getPlanField(draft.read().values, spec.path), value)) return;
            void draft.change(spec.path, value);
        };
        bindings.set(spec.path, bindHouseholdPlanField({ doc, field, row, path: spec.path, nativeOnly: spec.path === 'dynamicFlex', listen, onChange: changed,
            onFocusStateChange: focusState => {
                const state = draft.read();
                for (const binding of bindings.values()) binding.sync(state.values, state.error);
                dynamic?.sync(focusState);
            } }));
        listen(field, 'input', changed); listen(field, 'change', changed);
    }
    groups[4].append(details);
    dynamic = bindHouseholdPlanDynamicFlex({ doc, root, host: presets, details, read: () => draft.read().values,
        hasDetailErrors: () => hasHouseholdPlanDynamicErrors(bindings),
        hasDetailCorrections: () => hasHouseholdPlanDynamicCorrections(bindings),
        disabled: () => !initialized || fields.get('dynamicFlex')?.disabled === true,
        onChange: patch => {
            const pending = {}, applicable = { ...patch };
            // Nur ungemeldete Eingaben ergänzen. Ein neu berechneter Jahresbasisplan
            // darf nicht durch noch unveränderte ältere Anzeigewerte ersetzt werden.
            for (const [path, field] of fields) {
                const value = readHouseholdPlanField(field, path);
                if (!Object.is(value, observedValues.get(path))) pending[path] = value;
                // Ein Preset ist keine Korrektur eines abgelehnten Feldtexts.
                if (bindings.get(path).isInvalid()) delete applicable[path];
                observedValues.set(path, value);
            }
            void draft.changeBatch({ ...pending, ...applicable });
            for (const [path, value] of Object.entries(applicable)) {
                bindings.get(path)?.project(value, { force: true }); observedValues.set(path, value);
            }
        } });
    const capeRow = create('div', '', 'household-plan-field'), capeLabel = create('span', 'CAPE');
    const provenance = create('small'); provenance.dataset.annualPlanCape = ''; capeLabel.append(provenance);
    const capeValue = create('output'); capeValue.setAttribute('aria-label', 'CAPE'); capeRow.append(capeLabel, capeValue);
    groups[5].append(capeRow);
    panel.append(grid, discard);
    listen(toggle, 'click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
    listen(discard, 'click', () => { void draft.discard(); projectFields(draft.read().values); dynamic.reset(); });
    const actions = create('div', '', 'annual-plan-actions'); actions.append(status, toggle);
    root.append(summary, comparison, changes, actions, panel);
    return { root, read: draft.read, accept: draft.accept, dispose() { draft.dispose(); dynamic.dispose(); for (const binding of bindings.values()) binding.dispose(); },
        setBase(values) {
            initialized = true;
            if (!draft.read().values) projectFields(values);
            capeValue.textContent = values.cape.value.toLocaleString('de-DE');
            provenance.textContent = `${values.cape.asOf || 'Stand fehlt'} · ${values.cape.source || 'Quelle fehlt'}`;
            return draft.setBase(values);
        } };
}
