import { HOUSEHOLD_PLAN_GROUPS, householdPlanFieldSpec, HOUSEHOLD_PLAN_DISPLAY_FIELDS, createHouseholdPlanHint } from './household-plan-fields.js';
import { bindInfoPopovers } from './designsystem-info-popover.js';
import { DYNAMIC_FLEX_OPTIONS, detectDynamicFlexPreset } from './dynamic-flex-presets.js';
import { formatDisplayNumber, formatDisplayDate } from './designsystem-number-format.js';

/** Gleicher Kopf für den Plan und seine beiden lokalen Versuche. */
export function householdPlanSummary(values) {
    if (!values) return 'Planbereich noch nicht bestätigt';
    const preset = DYNAMIC_FLEX_OPTIONS.find(([key]) => key === detectDynamicFlexPreset(values))?.[1];
    const budget = Number(values.flexBudgetAnnual).toLocaleString('de-DE', { maximumFractionDigits: 0 });
    return `Flex-Budget ${budget} €/Jahr · Reserven ${formatDisplayNumber(values.liquidityRunwayYears)} Jahre · Strategie ${values.decumulation.mode === 'standard' ? 'Standard' : '3-Töpfe'} · Dynamik ${preset} · CAPE ${formatDisplayNumber(values.cape.value)}`;
}

const prepared = new WeakSet();
export function resetHouseholdPlanParameterDetails(doc, values) {
    if (!values) return;
    const detected = detectDynamicFlexPreset(values), showDetails = detected === 'custom';
    const advanced = doc.getElementById('dynamicFlexShowAdvanced');
    if (advanced) advanced.checked = false;
    const preset = doc.getElementById('dynamicFlexPreset');
    if (preset) preset.value = detected;
    for (const id of ['dynamicFlexConfigGroup', 'dynamicFlexAdvancedToggleRow']) {
        const group = doc.getElementById(id);
        if (group?.style) group.style.display = showDetails ? 'grid' : 'none';
    }
    const hint = doc.querySelector?.('.household-plan-more [data-plan-dynamic-hint]');
    if (hint) hint.hidden = showDetails;
}
/** Ergänzt nur Präsentation; bestehende Controls, Werte und Ereignisse bleiben erhalten. */
export function projectHouseholdPlanParameters(doc, root, map, values) {
    if (!root?.querySelectorAll) return;
    if (!prepared.has(root)) {
        for (const heading of root.querySelectorAll('[data-plan-group-label]')) {
            const group = HOUSEHOLD_PLAN_GROUPS[heading.dataset.planGroupLabel];
            heading.textContent = group.label;
            const hint = doc.createElement('small'); hint.textContent = group.hint; heading.append(hint);
        }
        for (const [id, path] of Object.entries(map)) {
            const field = doc.getElementById(id), spec = householdPlanFieldSpec(path) || HOUSEHOLD_PLAN_DISPLAY_FIELDS[path];
            const row = field?.closest?.('.household-plan-field');
            if (!row || !root.contains(row)) continue;
            const label = row.querySelector(`label[for="${id}"]`) || doc.getElementById(`${id}-label`);
            if (label && spec?.hint && (!label.querySelector('small') || spec.infoHint)) {
                label.querySelector('small')?.remove();
                label.append(createHouseholdPlanHint(doc, spec));
            }
            // Alte Hinweise standen unter dem Kasten; jetzt stehen sie beim Label.
            for (const hint of row.querySelectorAll(':scope > .ds-help')) hint.remove();
            const segment = row.querySelector('.ds-segment');
            if (segment) segment.dataset.planSegment = path;
            if (spec?.checkbox && !segment) {
                const toggle = field.closest('.ds-toggle');
                if (toggle) {
                    toggle.hidden = true;
                    const group = doc.createElement('div'); group.className = 'ds-segment';
                    group.dataset.planSegment = path; group.dataset.planToggle = id;
                    group.setAttribute('role', 'group'); group.setAttribute('aria-label', spec.label);
                    for (const [value, text] of [[false, 'Aus'], [true, 'An']]) {
                        const button = doc.createElement('button'); button.type = 'button'; button.textContent = text; button.className = 'ds-segment-button';
                        button.dataset.planToggleValue = String(value);
                        button.addEventListener('click', () => {
                            if (field.disabled || field.checked === value) return;
                            field.checked = value;
                            field.dispatchEvent(new (doc.defaultView?.Event || Event)('change', { bubbles: true }));
                        });
                        group.append(button);
                    }
                    row.append(group);
                }
            }
            const unit = row.querySelector('.ds-unit-frame > span:not(.sim-number-display)');
            if (unit && spec?.unit) {
                if (spec.source !== 'profile') unit.textContent = spec.unit;
            } else if (unit && spec && !spec.options && !spec.checkbox) unit.remove();
        }
        const dynamic = root.querySelector('[data-plan-group-label="4"]')?.closest('section');
        const presetRow = doc.getElementById('dynamicFlexPreset')?.closest('.household-plan-field');
        if (presetRow) {
            presetRow.classList.add('household-plan-preset');
            const label = presetRow.querySelector('label') || doc.getElementById('dynamicFlexPreset-label');
            if (label) label.hidden = true;
        }
        if (dynamic && presetRow) {
            const note = doc.createElement('p'); note.className = 'household-plan-note';
            note.textContent = 'Der Horizont wird aus der Lebenserwartung ermittelt.';
            dynamic.insertBefore(note, presetRow.parentElement);
            const hint = doc.createElement('p'); hint.className = 'ds-help'; hint.dataset.planDynamicHint = '';
            hint.textContent = 'Voreinstellung gilt; Details sind ausgeblendet.';
            presetRow.after(hint);
        }
        const capeRow = doc.getElementById('marketCapeRatio')?.closest('.household-plan-field');
        if (capeRow) {
            const origin = doc.createElement('small'); origin.dataset.planCapeOrigin = '';
            capeRow.querySelector('label')?.append(origin);
            const note = doc.createElement('p'); note.className = 'household-plan-note';
            note.textContent = 'Wird im Jahresabschluss aktualisiert; der Simulator nimmt ihn als Startwert.';
            capeRow.parentElement.after(note);
        }
        prepared.add(root);
        bindInfoPopovers(doc, { root });
    }
    const summary = root.querySelector('[data-plan-parameter-summary]');
    if (summary) summary.textContent = householdPlanSummary(values);
    for (const group of root.querySelectorAll('[data-plan-toggle]')) {
        const field = doc.getElementById(group.dataset.planToggle);
        group.dataset.fieldState = field.dataset.fieldState || 'editable';
        for (const button of group.querySelectorAll('button')) {
            button.disabled = field.disabled;
            button.setAttribute('aria-pressed', String(String(field.checked) === button.dataset.planToggleValue));
        }
    }
    // Der Ausschaltgrund steht bereits über den Details. Andere Feldgründe
    // und die vom Feldbesitzer gepflegten Beschreibungsziele bleiben erhalten.
    for (const reason of root.querySelectorAll('.ds-field-reason')) {
        const bundled = String(doc.getElementById('dynamicFlex')?.checked === false
            && reason.textContent.trim() === 'Dynamic Flex ist ausgeschaltet.');
        if (reason.dataset.planBundledReason !== bundled) reason.dataset.planBundledReason = bundled;
    }
    const origin = root.querySelector('[data-plan-cape-origin]');
    if (origin) origin.textContent = [values?.cape?.asOf ? formatDisplayDate(values.cape.asOf) : 'Stand nicht belegt', values?.cape?.source || 'Quelle nicht belegt'].join(' · ');
}
