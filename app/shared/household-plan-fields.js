import { DYNAMIC_FLEX_OPTIONS } from './dynamic-flex-presets.js';
import { createInfoPopover } from './designsystem-info-popover.js';

export function createHouseholdPlanHint(doc, spec) {
    const hint = doc.createElement('small'); hint.textContent = spec.hint;
    if (spec.infoHint) {
        hint.className = 'ds-explanation';
        hint.append(createInfoPopover(doc, `Erläuterung zu ${spec.label}`, spec.infoHint));
    }
    return hint;
}

const getPlanField = (values, path) => path.split('.').reduce((value, key) => value?.[key], values);

/** Persistenzfreie Beschreibung der bestehenden Planfelder. Zahlen sind kanonisch. */
export const HOUSEHOLD_PLAN_GROUPS = [
    {
        "label": "Bedarf",
        "hint": "pro Jahr, heutige Euro"
    },
    {
        "label": "Flex-Budget",
        "hint": "Puffer für Kürzungsjahre"
    },
    {
        "label": "Reserven",
        "hint": ""
    },
    {
        "label": "Entnahme & Umschichten",
        "hint": ""
    },
    {
        "label": "Dynamik",
        "hint": "nur mit CAPE"
    },
    {
        "label": "Marktdaten",
        "hint": "aus dem Jahresabschluss"
    }
];
export const HOUSEHOLD_PLAN_FIELDS = [
    {
        "path": "floorBedarf",
        "label": "Grundbedarf (Floor)",
        "hint": "muss immer gedeckt sein",
        "group": 0,
        "unit": "€"
    },
    {
        "path": "flexBedarf",
        "label": "Wunschbedarf (Flex)",
        "hint": "wird in schwachen Jahren gekürzt",
        "group": 0,
        "unit": "€"
    },
    {
        "path": "minimumFlexAnnual",
        "label": "Mindest-Flex",
        "hint": "Untergrenze der Kürzung",
        "group": 0,
        "unit": "€"
    },
    {
        "path": "flexBudgetAnnual",
        "label": "Budget pro Jahr",
        "hint": "",
        "group": 1,
        "unit": "€"
    },
    {
        "path": "flexBudgetYears",
        "label": "Reicht für",
        "hint": "",
        "group": 1,
        "unit": "Jahre"
    },
    {
        "path": "flexBudgetRecharge",
        "label": "Wiederauffüllen pro Jahr",
        "hint": "",
        "group": 1,
        "unit": "€"
    },
    {
        "path": "liquidityRunwayYears",
        "label": "Liquiditäts-Reichweite",
        "hint": "Tagesgeld + Geldmarkt",
        "infoHint": "Gemessen in Jahren der geplanten Entnahme.",
        "group": 2,
        "unit": "Jahre"
    },
    {
        "path": "minCashBufferMonths",
        "label": "Mindest-Liquidität",
        "hint": "eiserne Reserve",
        "group": 2,
        "unit": "Monate"
    },
    {
        "path": "decumulation.mode",
        "label": "Strategie",
        "options": [
            [
                "standard",
                "Standard"
            ],
            [
                "3_bucket_jilge",
                "3-Töpfe"
            ]
        ],
        "hint": "",
        "group": 3,
        "segment": true
    },
    {
        "path": "decumulation.bondTargetFactor",
        "label": "Anleihen-Zielfaktor",
        "hint": "Jahre Entnahme",
        "group": 3,
        "unit": "Jahre"
    },
    {
        "path": "decumulation.drawdownTrigger",
        "label": "Rückgang für Auffüllen",
        "hint": "",
        "group": 3,
        "unit": "%"
    },
    {
        "path": "decumulation.bondRefillThreshold",
        "label": "Anleihen-Auffüllschwelle",
        "hint": "leer: automatisch",
        "group": 3,
        "nullable": true
    },
    {
        "path": "maxSkimPctOfEq",
        "label": "Max. Abschöpfen",
        "hint": "vom Aktienwert in guten Jahren",
        "group": 3,
        "unit": "%"
    },
    {
        "path": "maxBearRefillPctOfEq",
        "label": "Max. Auffüllen im Bärenmarkt",
        "hint": "",
        "group": 3,
        "unit": "%"
    },
    {
        "path": "householdWithdrawalMode",
        "label": "Verteilung im Haushalt",
        "options": [
            [
                "tax_optimized",
                "Steueroptimiert"
            ],
            [
                "proportional",
                "Anteilig"
            ],
            [
                "runway_first",
                "Nacheinander"
            ]
        ],
        "hint": "wer entnimmt zuerst",
        "infoHint": "wer entnimmt zuerst · nacheinander: Reichweite zuerst",
        "group": 3,
        "segment": true
    },
    {
        "path": "dynamicFlex",
        "label": "Dynamische Entnahme",
        "checkbox": true,
        "hint": "Nur mit CAPE wirksam",
        "group": 4,
        "segment": true
    },
    {
        "path": "horizonMethod",
        "label": "Horizont-Methode",
        "options": [
            [
                "mean",
                "Mittlere Lebenserwartung"
            ],
            [
                "survival_quantile",
                "Überlebensquantil"
            ]
        ],
        "hint": "Methode",
        "group": 4
    },
    {
        "path": "horizonYears",
        "label": "Planungshorizont",
        "hint": "",
        "group": 4,
        "unit": "Jahre"
    },
    {
        "path": "survivalQuantile",
        "label": "Überlebensquantil",
        "hint": "",
        "group": 4,
        "unit": "%",
        "scale": 100
    },
    {
        "path": "goGoActive",
        "label": "Go-Go-Jahre",
        "checkbox": true,
        "hint": "",
        "group": 4,
        "segment": true
    },
    {
        "path": "goGoMultiplier",
        "label": "Go-Go-Faktor",
        "hint": "",
        "group": 4
    },
    {
        "path": "longevityMode",
        "label": "Langlebigkeit",
        "options": [
            [
                "none",
                "Ohne Zusatz"
            ],
            [
                "quantile_shift",
                "Quantil-Aufschlag"
            ],
            [
                "relative_horizon_buffer",
                "Relativer Horizont-Puffer"
            ],
            [
                "buffer_years",
                "Zusätzliche Jahre"
            ]
        ],
        "hint": "",
        "group": 4
    },
    {
        "path": "longevityQuantileShift",
        "label": "Quantil-Aufschlag",
        "hint": "",
        "group": 4,
        "unit": "%",
        "scale": 100
    },
    {
        "path": "longevityRelativePct",
        "label": "Relativer Horizont-Puffer",
        "hint": "",
        "group": 4,
        "unit": "%",
        "scale": 100
    },
    {
        "path": "longevityBufferYears",
        "label": "Zusätzlicher Horizont-Puffer",
        "hint": "",
        "group": 4,
        "unit": "Jahre"
    }
];
/** Karten folgen den gemeinsamen Gruppen; Zusatzanzeigen sind keine Planfelder. */
export const HOUSEHOLD_PLAN_CARDS = Object.freeze({
    need: HOUSEHOLD_PLAN_GROUPS[0].label,
    needAnnual: `${HOUSEHOLD_PLAN_GROUPS[0].label} pro Jahr`,
    strategy: `${HOUSEHOLD_PLAN_GROUPS[2].label} & ${HOUSEHOLD_PLAN_GROUPS[3].label.split(' & ')[0]}`
});
export const HOUSEHOLD_PLAN_DISPLAY_FIELDS = Object.freeze({
    'cape.value': Object.freeze({ label: 'CAPE', source: 'household-plan' }),
    'cape.asOf': Object.freeze({ label: 'CAPE-Datum', source: 'household-plan' }),
    'cape.source': Object.freeze({ label: 'CAPE-Quelle', source: 'household-plan' }),
    rebalancingBand: Object.freeze({ label: 'Gold-Umschichtungsband', unit: '%', source: 'profile' }),
    dynamicFlexPreset: Object.freeze({ label: 'Voreinstellung', options: DYNAMIC_FLEX_OPTIONS, source: 'derived' })
});

/** Textknoten ändern, Infoknöpfe und kleine Hilfekinder erhalten. */
export function projectHouseholdPlanFieldLabel({ doc, field, path } = {}) {
    const spec = householdPlanFieldSpec(path) || HOUSEHOLD_PLAN_DISPLAY_FIELDS[path];
    if (!spec || !field?.id) return;
    field.dataset.planFieldSource = spec.source || 'household-plan';
    const label = doc?.querySelector?.(`label[for="${field.id}"]`);
    if (label) {
        const texts = [...(label.childNodes || [])].filter(node => node.nodeType === 3);
        if (texts.length) {
            texts[0].textContent = spec.label;
            texts.slice(1).forEach(node => { node.textContent = ''; });
        } else if (!label.children?.length) label.textContent = spec.label;
        else if (doc.createTextNode) label.insertBefore(doc.createTextNode(spec.label), label.firstChild);
    }
    const presentationLabel = doc?.getElementById?.(`${field.id}-label`);
    if (presentationLabel?.firstChild?.nodeType === 3) presentationLabel.firstChild.textContent = spec.label;
    else if (presentationLabel) presentationLabel.textContent = spec.label;
    const balanceSegment = doc?.querySelector?.(`[data-balance-control="${field.id}"]`);
    if (balanceSegment && spec.options) for (const button of balanceSegment.querySelectorAll('button[data-balance-value]')) {
        const text = spec.options.find(([value]) => String(value) === button.dataset.balanceValue)?.[1];
        if (text !== undefined) button.textContent = text;
    }
    if (spec.hint) field.title = spec.infoHint || spec.hint;
    if (spec.options && field.options) {
        for (const option of field.options) {
            const text = spec.options.find(([value]) => value === option.value)?.[1];
            if (text !== undefined) option.textContent = text;
        }
        // Vorhandene Simulatorsegmente spiegeln die nativen Optionen.
        const segment = doc?.querySelector?.(`[data-select-segment="${field.id}"]`);
        if (segment) {
            segment.setAttribute('aria-label', spec.label);
            for (const button of segment.querySelectorAll('button[data-value]')) {
                const text = spec.options.find(([value]) => value === button.dataset.value)?.[1];
                if (text !== undefined) button.textContent = text;
            }
        }
    }
}
export function projectHouseholdPlanFieldLabels(doc, map) {
    for (const [id, path] of Object.entries(map)) projectHouseholdPlanFieldLabel({ doc, field: doc.getElementById(id), path });
    for (const path of Object.keys(HOUSEHOLD_PLAN_DISPLAY_FIELDS)) projectHouseholdPlanFieldLabel({ doc, field: doc.getElementById(path), path });
}

const descriptions = new Map(HOUSEHOLD_PLAN_FIELDS.map(spec => [spec.path, spec]));
export const householdPlanFieldSpec = path => descriptions.get(path);

/** UI-Eingabeschutz, kein Gültigkeitsvertrag für gespeicherte Altbestände. */
export function assertHouseholdPlanInputValues(values, changedPaths) {
    for (const path of changedPaths) {
        const spec = descriptions.get(path);
        if (!spec || spec.options || spec.checkbox) continue;
        const value = getPlanField(values, path);
        if (spec.nullable && value === null) continue;
        if (!Number.isFinite(value)) throw new Error(`${spec.label}: Bitte eine lesbare Zahl eingeben.`);
        if (value < 0) throw new Error(`${spec.label}: Bitte eine Zahl ab 0 eingeben.`);
        if (spec.unit === '€' && value > 10_000_000)
            throw new Error(`${spec.label}: Bitte höchstens 10.000.000 € pro Jahr eingeben.`);
    }
    if (values.minimumFlexAnnual > values.flexBedarf)
        throw new Error('Mindest-Flex darf den Wunschbedarf (Flex) nicht überschreiten. Bitte die Eingabe korrigieren.');
}

export function householdPlanFieldVisible(path, values) {
    return path.startsWith('decumulation.') && path !== 'decumulation.mode' ? values.decumulation.mode === '3_bucket_jilge'
        : path === 'horizonYears' ? false
        : path === 'survivalQuantile' ? values.horizonMethod === 'survival_quantile'
        : path === 'longevityQuantileShift' ? values.longevityMode === 'quantile_shift'
        : path === 'longevityRelativePct' ? values.longevityMode === 'relative_horizon_buffer'
        : path === 'longevityBufferYears' ? values.longevityMode === 'buffer_years'
        : path === 'goGoMultiplier' ? values.goGoActive : true;
}

/** Vollständige deutsche Zahl; Einheiten ausschließlich feldgenau, keine Teilstrings. */
export function parseHouseholdPlanNumber(text, path) {
    const spec = descriptions.get(path);
    let raw = String(text ?? '').trim();
    if (!raw) return spec?.nullable ? null : NaN;
    if (spec?.unit && raw.endsWith(spec.unit)) raw = raw.slice(0, -spec.unit.length).trim();
    // Leerzeichen (einschließlich NBSP) dürfen Gruppen von genau drei Ziffern trennen.
    if (/^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?$/.test(raw)) raw = raw.replace(/[ \u00a0\u202f]/g, '.');
    if (!/^[+-]?(?:\d+(?:,\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/.test(raw)) return NaN;
    const decimal = raw.replaceAll('.', '').replace(',', '.');
    const number = Number(spec?.scale === 100 ? decimal + 'e-2' : decimal);
    return Number.isFinite(number) ? number : NaN;
}

/** Dezimalpunkt textuell verschieben: keine Multiplikationsartefakte oder Präzisionskürzung. */
function shiftDecimalText(value, places) {
    const [coefficient, exponent = '0'] = String(value).split('e');
    const sign = coefficient.startsWith('-') ? '-' : '';
    const [integer, fraction = ''] = coefficient.replace(/^-/, '').split('.');
    const digits = integer + fraction, point = integer.length + Number(exponent) + places;
    const shifted = point <= 0 ? '0.' + '0'.repeat(-point) + digits
        : point >= digits.length ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
    return sign + shifted.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function formatHouseholdPlanValue(value, path, { editing = false, includeUnit = true } = {}) {
    const spec = descriptions.get(path) || HOUSEHOLD_PLAN_DISPLAY_FIELDS[path];
    if (value === null || value === undefined) return '';
    if (spec?.checkbox) return value ? 'An' : 'Aus';
    if (spec?.options) return spec.options.find(([key]) => key === value)?.[1] || String(value);
    if (!Number.isFinite(value)) return String(value);
    if (editing) return shiftDecimalText(value, spec?.scale === 100 ? 2 : 0).replace('.', ',');
    const scaled = value * (spec?.scale || 1);
    const number = scaled.toLocaleString('de-DE', { minimumFractionDigits: path === 'goGoMultiplier' ? 2 : 0, maximumFractionDigits: 2 });
    return number + (includeUnit && spec?.unit ? ' ' + spec.unit : '');
}

const bindings = new WeakMap();
/** Nur ausdrücklich gebundene Zahlenfelder; undefined kennzeichnet den Legacyweg. */
export function readBoundHouseholdPlanField(field) {
    const state = field && bindings.get(field);
    return state ? readHouseholdPlanField(field, state.path) : undefined;
}
export function writeBoundHouseholdPlanField(field, value) {
    const state = field && bindings.get(field);
    if (!state) return false;
    state.value = value;
    field.value = state.text = formatHouseholdPlanValue(value, state.path, { editing: state.focused, includeUnit: state.includeUnit });
    return true;
}
export function readHouseholdPlanField(field, path) {
    const spec = descriptions.get(path);
    if (spec?.checkbox) return field.checked === true;
    if (spec?.options) return String(field.value ?? '').trim();
    const state = bindings.get(field);
    if (state && field.value === state.text) return state.value;
    const value = parseHouseholdPlanNumber(field.value, path);
    if (state) { state.text = field.value; state.value = value; }
    return value;
}

/** Bindet einmalig native Anker; reine Projektion/Fokus/Blur ruft onChange nie auf. */
export function bindHouseholdPlanField({ doc, field, row, path, listen, onChange, onFocusStateChange = () => {}, nativeOnly = false, includeUnit = true } = {}) {
    bindings.get(field)?.dispose?.();
    projectHouseholdPlanFieldLabel({ doc, field, path });
    const spec = descriptions.get(path), removers = [], buttons = [];
    const originalHidden = field.hidden, originalDescription = field.getAttribute?.('aria-describedby');
    const bind = (node, kind, fn) => {
        if (listen) listen(node, kind, fn);
        else node.addEventListener(kind, fn);
        removers.push(() => node.removeEventListener?.(kind, fn));
    };
    const state = { path, value: undefined, text: undefined, focused: false, correcting: false, invalid: false, includeUnit };
    let visibleValues = null;
    bindings.set(field, state);
    let errorNode, segment;
    if (doc?.createElement && row?.append) {
        errorNode = doc.createElement('small'); errorNode.id = field.id + '_error'; errorNode.className = 'household-plan-error'; errorNode.hidden = true;
        row.append(errorNode); field.setAttribute('aria-describedby', errorNode.id);
    }
    function sync() {
        for (const { button, value } of buttons) {
            button.disabled = field.disabled;
            button.setAttribute('aria-pressed', String(Object.is(spec.checkbox ? field.checked : field.value, value)));
        }
    }
    if (spec.segment && !nativeOnly && doc?.createElement && row?.append) {
        segment = doc.createElement('div'); segment.className = 'ds-segment'; segment.dataset.planSegment = path;
        segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', spec.label);
        for (const [value, text] of spec.options || [[true, 'An'], [false, 'Aus']]) {
            const button = doc.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.planSegmentValue = String(value);
            bind(button, 'click', () => {
                if (field.disabled || Object.is(spec.checkbox ? field.checked : field.value, value)) return;
                if (spec.checkbox) field.checked = value; else field.value = value;
                sync(); onChange(field);
            });
            buttons.push({ button, value }); segment.append(button);
        }
        field.hidden = true; row.append(segment);
    }
    if (!spec.options && !spec.checkbox) {
        bind(field, 'focus', () => {
            const wasCorrecting = state.correcting;
            state.focused = true;
            // Eine Fehlerkorrektur endet erst mit Blur, nicht beim ersten gültigen Zeichen.
            state.correcting ||= !nativeOnly && state.invalid;
            const value = readHouseholdPlanField(field, path);
            if (!state.invalid && (value === null || Number.isFinite(value))) {
                field.value = state.text = formatHouseholdPlanValue(value, path, { editing: true });
            }
            // Synchron markieren, bevor Autofill oder Tippen die Auswahl ersetzt.
            // Spätere Klicks/Auswahlen gehören ausschließlich dem Nutzer.
            if (field.select) field.select();
            else field.setSelectionRange?.(0, field.value.length);
            onFocusStateChange({ correctionChanged: wasCorrecting !== state.correcting });
        });
        bind(field, 'blur', event => {
            const wasCorrecting = state.correcting;
            const value = readHouseholdPlanField(field, path); state.focused = false;
            state.correcting = false;
            if (!state.invalid && (value === null || Number.isFinite(value))) field.value = state.text = formatHouseholdPlanValue(value, path, { includeUnit });
            onFocusStateChange({ correctionChanged: wasCorrecting, blurredField: field, relatedTarget: event.relatedTarget });
        });
    }
    const binding = {
        hasError() { return !nativeOnly && state.invalid; },
        isCorrecting() { return !nativeOnly && state.focused && state.correcting; },
        isInvalid() {
            const value = readHouseholdPlanField(field, path);
            return state.invalid || !spec.options && !spec.checkbox && !(spec.nullable && value === null) && !Number.isFinite(value);
        },
        project(value, { force = false } = {}) {
            if (!force && (state.focused || doc?.activeElement === field || state.text !== undefined && binding.isInvalid())) { sync(); return; }
            if (force) state.correcting = false;
            state.value = value;
            if (spec.checkbox) field.checked = value;
            else field.value = state.text = spec.options ? value : formatHouseholdPlanValue(value, path, { includeUnit });
            sync();
        },
        sync(values, error = '') {
            const invalid = Boolean(error && (error.includes(path) || error.includes(path.split('.').at(-1))
                || path === 'minimumFlexAnnual' && error.includes('Mindest-Flex')
                || ['liquidityRunwayYears', 'minCashBufferMonths'].includes(path) && error.includes('Liquidität')
                || error.includes(spec.label)));
            state.invalid = invalid;
            // Abgelehnte Eingaben bleiben auch bei ausgeschalteter Fachoption korrigierbar.
            if (values) visibleValues = values;
            if (row && visibleValues) row.hidden = nativeOnly || (!invalid && !binding.isCorrecting() && !householdPlanFieldVisible(path, visibleValues));
            field.setAttribute?.('aria-invalid', String(invalid));
            if (errorNode) { errorNode.hidden = !invalid; errorNode.textContent = invalid ? error.replace(path, spec.label) : ''; }
            sync();
        },
        dispose() {
            state.focused = false; state.correcting = false; visibleValues = null;
            removers.forEach(remove => remove()); errorNode?.remove?.(); segment?.remove?.();
            field.hidden = originalHidden;
            if (originalDescription) field.setAttribute?.('aria-describedby', originalDescription);
            else if (field.removeAttribute) field.removeAttribute('aria-describedby');
            else field.setAttribute?.('aria-describedby', '');
            bindings.delete(field);
        }
    };
    state.dispose = binding.dispose;
    return binding;
}

/** Nur Fehler in den gemeinsamen Dynamikdetails öffnen die Detailgruppe. */
export function hasHouseholdPlanDynamicErrors(bindings) {
    return HOUSEHOLD_PLAN_FIELDS.some(spec => spec.group === 4 && spec.path !== 'dynamicFlex'
        && bindings.get(spec.path)?.hasError());
}

/** Flüchtiger Fokuszustand, unabhängig von inzwischen gültigen Zwischenwerten. */
export function hasHouseholdPlanDynamicCorrections(bindings) {
    return HOUSEHOLD_PLAN_FIELDS.some(spec => spec.group === 4 && spec.path !== 'dynamicFlex'
        && bindings.get(spec.path)?.isCorrecting());
}

export function projectHouseholdPlanBindings(bindings, values, options) {
    for (const [path, binding] of bindings) binding.project(getPlanField(values, path), options);
}
