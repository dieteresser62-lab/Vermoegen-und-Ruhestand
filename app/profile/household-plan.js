/** @import * as P from "../../typcheck/profile-ui.js" */
import { readBoundHouseholdPlanField } from '../shared/household-plan-fields.js';
import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { isValidLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';
import { validateLongevitySettings } from '../simulator/dynamic-flex-longevity-contract.js';
import { loadProfileRegistry } from './profile-registry.js';
import { DEFAULT_EQUITY_COST_PCT } from '../shared/equity-cost-default.js';

export const HOUSEHOLD_PLAN_KEY = 'household_plan_v1';
/** @type {Readonly<import("../../typcheck/datenvertraege.js").PlanValues>} */
export const PLAN_DEFAULTS = Object.freeze({
    floorBedarf: 12000, flexBedarf: 24000, minimumFlexAnnual: 0,
    flexBudgetAnnual: 7000, flexBudgetYears: 5, flexBudgetRecharge: 5000,
    liquidityRunwayYears: 5, liquidityCashMonths: 12, minCashBufferMonths: 2, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
    decumulation: Object.freeze({ mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }),
    dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85,
    goGoActive: false, goGoMultiplier: 1.1, longevityMode: 'none', longevityQuantileShift: 0.05,
    jointAssessment: false, longevityRelativePct: 0.05, longevityBufferYears: 2, householdWithdrawalMode: 'tax_optimized',
    cape: Object.freeze({ value: 0, asOf: null, source: null }),
    // FR-76 (Ergänzung 12.11.2026): Fondskosten Aktien-ETF in % pro Jahr; fehlt der Wert, gilt die Vorgabe beim Lesen.
    equityCostPct: DEFAULT_EQUITY_COST_PCT
});
/** Planfelder, die in älteren Ständen fehlen dürfen; gelesen wird dann ihre Vorgabe, geschrieben wird nichts. */
const OPTIONAL_PLAN_FIELDS = Object.freeze(['jointAssessment', 'liquidityCashMonths', 'equityCostPct']);
/** Fehlende Lesevorgaben ergänzen, ohne gespeicherte Bytes zu ändern. */
const withReadDefaults = values => ({ ...values,
    liquidityCashMonths: values.liquidityCashMonths ?? PLAN_DEFAULTS.liquidityCashMonths,
    equityCostPct: values.equityCostPct ?? PLAN_DEFAULTS.equityCostPct });
/** FR-76: Fondskosten des Plans, ohne gespeicherten Wert die Vorgabe.
 * @param {Partial<import("../../typcheck/datenvertraege.js").PlanValues>|null|undefined} values
 * @returns {number} */
export const planEquityCostPct = values => values?.equityCostPct ?? PLAN_DEFAULTS.equityCostPct;
/** FR-76: Die Balance gibt die Fondskosten nur mit Dynamic Flex an die Engine; dort mindern sie die erwartete Rendite.
 * Ohne Dynamic Flex oder mit 0 % bleibt die Eingabe unverändert (bytegleich). Ohne bestätigten Plan gilt die Vorgabe.
 * @template {{dynamicFlex?: boolean, equityCostPct?: number}} T
 * @param {T} input Balance-Eingabe mit wirksamem Dynamic-Flex-Schalter.
 * @param {Partial<import("../../typcheck/datenvertraege.js").PlanValues>|null} values Planwerte oder null.
 * @returns {T} Dieselbe Eingabe. */
export function applyBalanceEquityCost(input, values) {
    const cost = planEquityCostPct(values);
    // Mit 0 % rechnet die Engine ohne Abzug; die Eingabe bleibt dann wie ohne Fondskosten.
    if (input.dynamicFlex === true && cost > 0) input.equityCostPct = cost;
    return input;
}
export const PLAN_FIELDS = Object.freeze(Object.keys(PLAN_DEFAULTS));
export const PLAN_FIELD_PATHS = Object.freeze(PLAN_FIELDS.flatMap(key =>
    ['decumulation', 'cape'].includes(key) ? Object.keys(PLAN_DEFAULTS[key]).map(field => `${key}.${field}`) : [key]));
export const BALANCE_PLAN_INPUT_KEYS = Object.freeze([...PLAN_FIELDS, 'capeRatio', 'marketCapeRatio',
    'entnahmeStrategie', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']);

/** Explizite Einzelpläne lesen; vorhandene Einpersonen-Haushaltspläne behalten ihren Bereich. */
/** @param {string[]} ids @param {import("../../typcheck/datenvertraege.js").RecordReader} storage @param {boolean} [belongsToHousehold] @returns {import("../../typcheck/datenvertraege.js").PlanScope|null} */
export function memberPlanScope(ids, storage, belongsToHousehold = true) {
    const single = ids.length === 1 ? planScope('single', ids) : null;
    return single && readHouseholdPlan({ scope: single, storage }).status === 'valid'
        ? single : planScope(belongsToHousehold ? 'household' : 'single', ids);
}

/** Gemeinsame Bereichsauswahl; der Aufrufer entscheidet über ungültige Pläne. */
/** @param {P.SelectedPlanOptions} [options] */
function readSelectedHouseholdPlan({ storage = persistenceStorage, profileId = null } = {}) {
    const loaded = loadProfileRegistry(storage);
    if (['corrupt', 'unavailable'].includes(loaded.status)) throw loaded.error || new Error('Profilbestand nicht lesbar.');
    const profiles = loaded.value?.profiles || {};
    const members = Object.keys(profiles).filter(id => profiles[id].meta?.belongsToHousehold !== false);
    const current = profileId || storage.getItem('rs_current_profile');
    const scope = profileId && profiles[profileId]?.meta?.belongsToHousehold === false
        ? planScope('single', [profileId])
        : members.length ? memberPlanScope(members, storage) : current ? planScope('single', [current]) : null;
    const plan = readHouseholdPlan({ scope, storage });
    return { ...plan, scope };
}

/** Balance rechnet den ausgewählten Haushalt; ungültige Pläne bleiben Fehler. */
/** @param {P.SelectedPlanOptions} [options] @returns {P.PlanRead & {scope: import("../../typcheck/datenvertraege.js").PlanScope|null}} */
export function readBalanceHouseholdPlan(options = {}) {
    const plan = readSelectedHouseholdPlan(options);
    if (plan.status === 'invalid') throw plan.error;
    return plan;
}

/** Simulator rechnet den ausgewählten Haushalt, ohne Auswahl die geöffnete Person.
 * Ein expliziter Außenbereich bleibt unabhängig vom gemeinsamen Haushalt.
 * Der ungültige Status erlaubt dem Zustandsbesitzer, Planverlust zu synchronisieren.
 */
/** @param {P.SelectedPlanOptions} [options] @returns {P.PlanRead & {scope: import("../../typcheck/datenvertraege.js").PlanScope|null}} */
export function readSimulatorHouseholdPlan(options = {}) {
    return readSelectedHouseholdPlan(options);
}
export const SIMULATOR_PLAN_FIELD_MAP = Object.freeze({
    ...Object.fromEntries(PLAN_FIELDS.filter(key => !['floorBedarf', 'flexBedarf', 'decumulation', 'cape',
        'householdWithdrawalMode', 'jointAssessment', 'liquidityCashMonths'].includes(key)).map(key => [key, key])),
    startFloorBedarf: 'floorBedarf', startFlexBedarf: 'flexBedarf', marketCapeRatio: 'cape.value',
    entnahmeStrategie: 'decumulation.mode', bondTargetFactor: 'decumulation.bondTargetFactor',
    drawdownTrigger: 'decumulation.drawdownTrigger', bondRefillThreshold: 'decumulation.bondRefillThreshold'
});
export const SIMULATOR_LEGACY_PLAN_FIELDS = Object.freeze([...Object.keys(SIMULATOR_PLAN_FIELD_MAP),
    'householdWithdrawalMode', 'runwayTargetMonths', 'runwayMinMonths']);

/** Nur vorhandene Formularfelder projizieren; unsichtbare Werte bleiben im Plan.
 * Zahlen werden validiert, niemals still begrenzt oder durch Defaults ersetzt.
 */
/**
 * @param doc Zieldokument der Seite.
 * @param ids Kennungen der ausgewählten Personen oder Formularfelder.
 * @returns Patch aus vorhandenen Formularfeldern ohne Speicherung.
 */
export function simulatorPlanFormPatch(doc, ids = Object.keys(SIMULATOR_PLAN_FIELD_MAP)) {
    const patch = {};
    for (const id of ids) {
        const path = SIMULATOR_PLAN_FIELD_MAP[id], field = doc?.getElementById?.(id);
        if (!path || !field) continue;
        const [key, nested] = path.split('.');
        const raw = String(field.value ?? '').trim();
        const bound = readBoundHouseholdPlanField(field);
        const value = bound !== undefined ? bound : field.type === 'checkbox' ? field.checked === true
            : ['entnahmeStrategie', 'horizonMethod', 'longevityMode'].includes(id) ? raw
            : id === 'bondRefillThreshold' && raw === '' ? null
            : raw === '' ? NaN : Number(raw.replace(',', '.'));
        if (nested) (patch[key] ||= {})[nested] = value;
        else patch[key] = value;
    }
    return patch;
}

/** Formularwerte haben Vorrang, ohne beim Lesen zu speichern. */
/**
 * @param values Vorhandene Eingabe- oder Planwerte.
 * @param doc Zieldokument der Seite.
 * @returns Wirksame Simulatorwerte mit den aktuellen Formularwerten.
 */
export function projectSimulatorPlanForm(values, doc) {
    const patch = simulatorPlanFormPatch(doc);
    const effective = { ...values, ...patch,
        cape: { ...values.cape, ...patch.cape }, decumulation: { ...values.decumulation, ...patch.decumulation } };
    return projectPlanToSimulator(effective);
}

/** Keine neuen Planwertkopien; Altbestände bleiben bis zum nächsten Write lesbar. */
/**
 * @param inputs Vorhandene Eingaben des Aufrufers.
 * @returns Eingaben ohne die gemeinsam besessenen Planfelder.
 */
export function stripBalancePlanInputs(inputs) {
    if (!inputs) return inputs;
    return Object.fromEntries(Object.entries(inputs).filter(([key]) => !BALANCE_PLAN_INPUT_KEYS.includes(key)
        && !['guardrailPlanHorizonYears', 'longevityHorizonDiagnostics'].includes(key)));
}

/** Synchroner Balance-Write im vorhandenen entprellten/periodengebundenen Besitzer.
 * Die Bestätigung im Backend erfolgt wie für Balance-State über dessen Flush.
 * Asynchrone Seitenschreiber verwenden weiterhin patchHouseholdPlan.

 * @param {{scope?: import("../../typcheck/datenvertraege.js").PlanScope, patch?: P.PlanPatch, storage?: import('../../typcheck/runtime-contracts.js').StorageWriter, persistence?: typeof PersistenceFacade, now?: () => Date, navigationOperation?: import('../../typcheck/runtime-contracts.js').NavigationOperation}} [options]
 * @returns Geänderter Planbereich im vorhandenen Speicherbesitzer.
 */
export function stageBalancePlanPatch({ scope, patch, storage = persistenceStorage,
    persistence = PersistenceFacade, now = appNow, navigationOperation } = {}) {
    navigationOperation?.check();
    if (persistence.hasSyncWriteBlocks?.() || globalThis.window?.__profileRecoveryBlocker) throw new Error('Planänderung wegen Wiederherstellung gesperrt.');
    assertPlanScope(scope);
    if (!plain(patch) || Object.keys(patch).some(key => !PLAN_FIELDS.includes(key))) throw new Error('Unbekanntes Planfeld.');
    const loaded = readHouseholdPlan({ scope, storage });
    if (loaded.status !== 'valid') throw loaded.error || new Error('Planbereich ist noch nicht bestätigt.');
    const values = /** @type {import("../../typcheck/datenvertraege.js").PlanValues} */ ({ ...loaded.entry.values, ...patch });
    for (const key of ['cape', 'decumulation']) if (Object.hasOwn(patch, key)) values[key] = { ...loaded.entry.values[key], ...patch[key] };
    const next = buildPlanRecord(loaded.raw, [{ scope, values }], { now });
    navigationOperation?.check();
    if (next.changed) storage.setItem(HOUSEHOLD_PLAN_KEY, next.raw);
    return next.record.entries[scope.key];
}
export const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns Kanonische JSON-Darstellung für Vergleiche.
 */
export function canonicalPlan(value) {
    if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonicalPlan(item))));
    if (plain(value)) return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonicalPlan(value[key]))])));
    return JSON.stringify(value);
}
/** @param {string} kind @param {string[]} ids @returns {import("../../typcheck/datenvertraege.js").PlanScope|null} */
export function planScope(kind, ids) {
    if (!['household', 'single'].includes(kind) || !Array.isArray(ids) || !ids.length
        || ids.some(id => typeof id !== 'string' || !id.trim()) || kind === 'single' && ids.length !== 1) return null;
    const members = [...new Set(ids)].sort();
    return /** @type {import("../../typcheck/datenvertraege.js").PlanScope} */ ({ kind, ids: members, key: JSON.stringify([kind, members]) });
}
/**
 * @param scope Geprüfter Personen- oder Haushaltsbereich.
 * @returns Normalisierter und auf seine Kennung geprüfter Planbereich.
 */
export function assertPlanScope(scope) {
    const normalized = planScope(scope?.kind, scope?.ids);
    if (!normalized || normalized.key !== scope.key || canonicalPlan(normalized.ids) !== canonicalPlan(scope.ids)) throw new Error('Ungültiger Planbereich.');
    return normalized;
}
function exactKeys(value, keys, label) {
    if (!plain(value) || canonicalPlan(Object.keys(value).sort()) !== canonicalPlan([...keys].sort())) throw new Error(`${label}: unvollständige oder unbekannte Felder.`);
}
/**
 * @param values Vorhandene Eingabe- oder Planwerte.
 * @returns Geprüfte Planwerte; ungültige Werte lösen einen Fehler aus.
 */
export function assertPlanValues(values) {
    exactKeys(values, PLAN_FIELDS.filter(key => !OPTIONAL_PLAN_FIELDS.includes(key) || Object.hasOwn(values || {}, key)), 'Plan');
    if (values.jointAssessment !== undefined && typeof values.jointAssessment !== 'boolean') throw new Error('Zusammenveranlagung muss eine Checkboxentscheidung sein.');
    const ranges = {
        floorBedarf: [0, Infinity], flexBedarf: [0, Infinity], minimumFlexAnnual: [0, Infinity],
        flexBudgetAnnual: [0, Infinity], flexBudgetYears: [0, 10], flexBudgetRecharge: [0, Infinity],
        minCashBufferMonths: [0, 12], maxSkimPctOfEq: [0, 25], maxBearRefillPctOfEq: [0, 15],
        horizonYears: [1, 60], survivalQuantile: [0.5, 0.99], goGoMultiplier: [1, 1.5]
    };
    for (const [field, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(values[field]) || values[field] < min || values[field] > max) throw new Error(`${field}: ungültiger Zahlenbereich.`);
    if (!Number.isInteger(values.minCashBufferMonths) || !isValidLiquidityRunwayYears(values.liquidityRunwayYears)) throw new Error('Ungültige Liquiditätsreichweite oder Mindest-Liquidität.');
    const cashMonths = values.liquidityCashMonths ?? PLAN_DEFAULTS.liquidityCashMonths;
    if (Number.isFinite(cashMonths) && cashMonths > values.liquidityRunwayYears * 12) {
        throw new Error(`davon im Tagesgeld (${cashMonths} Monate) ist größer als die Reichweite (${values.liquidityRunwayYears * 12} Monate) – eines davon anpassen`);
    }
    if (!Number.isInteger(cashMonths) || cashMonths < 0 || cashMonths > values.liquidityRunwayYears * 12
        || Object.hasOwn(values, 'liquidityCashMonths') && values.liquidityCashMonths === null) {
        throw new Error('liquidityCashMonths: ganze Monate zwischen 0 und Liquiditäts-Reichweite × 12 eingeben.');
    }
    if (Object.hasOwn(values, 'equityCostPct') && (!Number.isFinite(values.equityCostPct) || values.equityCostPct < 0 || values.equityCostPct > 5)) {
        throw new Error('equityCostPct: Bitte Prozent zwischen 0 und 5 eingeben.');
    }
    if (values.minimumFlexAnnual > values.flexBedarf) throw new Error('Mindest-Flex darf den Flex-Bedarf nicht überschreiten. Bitte die Auswahl korrigieren.');
    for (const field of ['dynamicFlex', 'goGoActive']) if (typeof values[field] !== 'boolean') throw new Error(`${field} muss eine Checkboxentscheidung sein.`);
    if (!['mean', 'survival_quantile'].includes(values.horizonMethod)) throw new Error('Ungültige Horizont-Methode.');
    const longevity = validateLongevitySettings(values);
    if (!longevity.valid) throw new Error(longevity.errors.map(error => error.message).join(' '));
    if (!['tax_optimized', 'proportional', 'runway_first'].includes(values.householdWithdrawalMode)) throw new Error('Ungültiger Haushaltsentnahmemodus.');
    exactKeys(values.decumulation, Object.keys(PLAN_DEFAULTS.decumulation), 'Strategie');
    if (!['standard', '3_bucket_jilge'].includes(values.decumulation.mode)) throw new Error('Ungültige Entnahmestrategie.');
    for (const field of ['bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']) {
        const value = values.decumulation[field];
        if (field === 'bondRefillThreshold' && value === null) continue;
        if (!Number.isFinite(value) || value < 0) throw new Error(`${field}: ungültiger Strategiewert.`);
    }
    exactKeys(values.cape, ['value', 'asOf', 'source'], 'CAPE');
    if (!Number.isFinite(values.cape.value) || values.cape.value < 0
        || values.cape.asOf !== null && (typeof values.cape.asOf !== 'string' || !Number.isFinite(Date.parse(values.cape.asOf)))
        || values.cape.source !== null && (typeof values.cape.source !== 'string' || !values.cape.source.trim())) throw new Error('Ungültiger CAPE-Wert oder Herkunft.');
    return values;
}
/** @param {unknown} raw @returns {import("../../typcheck/datenvertraege.js").HouseholdPlanRecord} */
export function assertHouseholdPlanRecord(raw) {
    const record = /** @type {import('../../typcheck/datenvertraege.js').HouseholdPlanRecord} */ (typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw));
    exactKeys(record, ['version', 'entries'], 'Plandatensatz');
    if (record.version !== 1 || !plain(record.entries)) throw new Error('Beschädigter oder künftig versionierter Plandatensatz. Sicherung prüfen.');
    for (const [key, entry] of Object.entries(record.entries)) {
        exactKeys(entry, ['scope', 'updatedAt', 'values'], 'Planbereich');
        if (assertPlanScope(entry.scope).key !== key || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error('Ungültiger Planbereich oder Zeitstempel.');
        assertPlanValues(entry.values);
        // Nur die gelesene Projektion ergänzen; die gespeicherten Bytes bleiben erhalten.
        entry.values = withReadDefaults(entry.values);
    }
    return record;
}
/** Fehlend bleibt fehlend; Schäden dürfen nie als leere Migration behandelt werden. */
/** @param {P.PlanReadOptions} [options] @returns {P.PlanRead} */
export function readHouseholdPlan({ scope, storage = persistenceStorage } = {}) {
    const raw = storage.getItem(HOUSEHOLD_PLAN_KEY);
    if (raw === null || raw === undefined) return { status: 'missing', entry: null, raw: null };
    try {
        const record = assertHouseholdPlanRecord(raw);
        if (scope) assertPlanScope(scope);
        const entry = scope ? record.entries[scope.key] ?? null : null;
        return /** @type {P.PlanRead} */ ({ status: entry ? 'valid' : 'missing', entry, record, raw });
    } catch (error) { return { status: 'invalid', entry: null, raw, error }; }
}
/** @overload @param {string|null} raw @param {[{scope: import("../../typcheck/datenvertraege.js").PlanScope, values: import("../../typcheck/datenvertraege.js").PlanValues}, ...{scope: import("../../typcheck/datenvertraege.js").PlanScope, values: import("../../typcheck/datenvertraege.js").PlanValues}[]]} entries @param {{now?: ()=>Date}} [options] @returns {{raw: string, record: import("../../typcheck/datenvertraege.js").HouseholdPlanRecord, changed: boolean}} */
/** @overload @param {string|null} raw @param {{scope: import("../../typcheck/datenvertraege.js").PlanScope, values: import("../../typcheck/datenvertraege.js").PlanValues}[]} entries @param {{now?: ()=>Date}} [options] @returns {{raw: string|null, record: import("../../typcheck/datenvertraege.js").HouseholdPlanRecord, changed: boolean}} */
/** @param {string|null} raw @param {{scope: import("../../typcheck/datenvertraege.js").PlanScope, values: import("../../typcheck/datenvertraege.js").PlanValues}[]} entries @param {{now?: ()=>Date}} [options] @returns {{raw: string|null, record: import("../../typcheck/datenvertraege.js").HouseholdPlanRecord, changed: boolean}} */
export function buildPlanRecord(raw, entries, { now = appNow } = {}) {
    if (raw != null) assertHouseholdPlanRecord(raw);
    // Validierte Lesevorgaben nicht in unberührte andere Planbereiche schreiben.
    const record = raw == null ? { version: 1, entries: {} } : typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
    const comparable = values => values ? withReadDefaults(values) : null;
    let changed = false;
    for (const { scope, values } of entries) {
        assertPlanScope(scope); assertPlanValues(values);
        if (canonicalPlan(comparable(record.entries[scope.key]?.values)) === canonicalPlan(comparable(values))) continue;
        record.entries[scope.key] = { scope: structuredClone(scope), updatedAt: now().toISOString(), values: structuredClone(values) };
        changed = true;
    }
    return { raw: changed ? JSON.stringify(record) : raw, record, changed };
}
/** Nutzerentscheidung projizieren; erst die Enginegrenze wendet das CAPE-Gate an. */
/**
 * @param values Vorhandene Eingabe- oder Planwerte.
 * @returns Balance-Eingaben aus den bestätigten Planwerten.
 */
export function projectPlanToBalance(values) {
    assertPlanValues(values);
    const { cape, householdWithdrawalMode, jointAssessment, equityCostPct, ...inputs } = structuredClone(values);
    inputs.liquidityCashMonths ??= PLAN_DEFAULTS.liquidityCashMonths;
    // FR-76: In der Balance mindern Fondskosten nur die erwartete Rendite des Dynamic Flex. Ohne Dynamic Flex
    // fehlt der Wert, damit die Balance-Rechnung bytegleich bleibt.
    const cost = equityCostPct ?? PLAN_DEFAULTS.equityCostPct;
    const equityCost = values.dynamicFlex && cape.value > 0 && cost > 0 ? { equityCostPct: cost } : {};
    return { ...inputs, ...(jointAssessment === true ? { jointAssessment: true } : {}), capeRatio: cape.value, marketCapeRatio: cape.value, entnahmeStrategie: inputs.decumulation.mode, ...inputs.decumulation, householdWithdrawalMode, ...equityCost };
}
/**
 * @param values Vorhandene Eingabe- oder Planwerte.
 * @returns Simulator-Eingaben aus denselben Planwerten.
 */
export function projectPlanToSimulator(values) {
    const { liquidityCashMonths, ...inputs } = projectPlanToBalance(values);
    // FR-76: Der Simulator zieht die Fondskosten immer von der Jahresrendite ab, mit Dynamic Flex auch von der Erwartung.
    return { ...inputs, equityCostPct: planEquityCostPct(values), startFloorBedarf: values.floorBedarf, startFlexBedarf: values.flexBedarf };
}
/** Direkt aus Profildaten gebaute Simulatoreingaben rechnen wie seit GU-1 ohne Fondskosten (fehlend = 0).
 * Die Simulatorseite übernimmt k aus dem Plan über ihren Planversuch.
 * @param values Vorhandene Planwerte.
 * @returns Simulator-Eingaben ohne `equityCostPct`. */
export function projectPlanToSimulatorProfile(values) {
    const { equityCostPct, ...inputs } = projectPlanToSimulator(values);
    return inputs;
}
/** Patch ausschließlich im bestätigten Bereich; neue Bereiche gehören dem Umstellungskoordinator. */
/** @param {P.PlanPatchOptions} [options] @returns {Promise<P.PlanEntry>} */
export async function patchHouseholdPlan({ scope, patch, storage = persistenceStorage, persistence = PersistenceFacade,
    now = appNow, navigationOperation, isCurrent = () => true } = {}) {
    assertPlanScope(scope);
    if (!plain(patch) || Object.keys(patch).some(key => !PLAN_FIELDS.includes(key))) throw new Error('Unbekanntes Planfeld.');
    const check = () => {
        navigationOperation?.check();
        if (persistence.hasSyncWriteBlocks?.()) throw new Error('Planänderung gesperrt. Bitte den bestätigten Bestand wiederherstellen.');
        if (!isCurrent()) throw new Error('Planbereich hat sich geändert.');
    };
    check();
    const loaded = readHouseholdPlan({ scope, storage });
    if (loaded.status !== 'valid') throw loaded.error || new Error('Planbereich ist noch nicht bestätigt.');
    const values = /** @type {import("../../typcheck/datenvertraege.js").PlanValues} */ ({ ...loaded.entry.values, ...patch });
    for (const key of ['cape', 'decumulation']) if (Object.hasOwn(patch, key)) values[key] = { ...loaded.entry.values[key], ...patch[key] };
    const next = buildPlanRecord(loaded.raw, [{ scope, values }], { now });
    if (!next.changed) return loaded.entry;
    try {
        await persistence.replaceRecordsTransactional({ [HOUSEHOLD_PLAN_KEY]: next.raw }, { probelaufDomainWrite: true,
            navigationOperation, allowKey: key => key === HOUSEHOLD_PLAN_KEY, expectedRecords: { [HOUSEHOLD_PLAN_KEY]: loaded.raw },
            postValidate: actual => { check(); assertHouseholdPlanRecord(actual[HOUSEHOLD_PLAN_KEY]); } });
    } catch (error) {
        if (error.code === 'rollback_failed') persistence.blockSyncWrites?.([HOUSEHOLD_PLAN_KEY],
            'Planänderung und Rücknahme unbestätigt. Bitte neu laden und den Wiederherstellungspunkt prüfen.');
        throw error;
    }
    check();
    return next.record.entries[scope.key];
}
