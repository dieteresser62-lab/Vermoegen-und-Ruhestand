import { readBoundHouseholdPlanField } from '../shared/household-plan-fields.js';
import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { isValidLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';
import { validateLongevitySettings } from '../simulator/dynamic-flex-longevity-contract.js';
import { loadProfileRegistry } from './profile-registry.js';

export const HOUSEHOLD_PLAN_KEY = 'household_plan_v1';
export const PLAN_DEFAULTS = Object.freeze({
    floorBedarf: 12000, flexBedarf: 24000, minimumFlexAnnual: 0,
    flexBudgetAnnual: 7000, flexBudgetYears: 5, flexBudgetRecharge: 5000,
    liquidityRunwayYears: 5, minCashBufferMonths: 2, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
    decumulation: Object.freeze({ mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }),
    dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85,
    goGoActive: false, goGoMultiplier: 1.1, longevityMode: 'none', longevityQuantileShift: 0.05,
    longevityRelativePct: 0.05, longevityBufferYears: 2, householdWithdrawalMode: 'tax_optimized',
    cape: Object.freeze({ value: 0, asOf: null, source: null })
});
export const PLAN_FIELDS = Object.freeze(Object.keys(PLAN_DEFAULTS));
export const PLAN_FIELD_PATHS = Object.freeze(PLAN_FIELDS.flatMap(key =>
    ['decumulation', 'cape'].includes(key) ? Object.keys(PLAN_DEFAULTS[key]).map(field => `${key}.${field}`) : [key]));
export const BALANCE_PLAN_INPUT_KEYS = Object.freeze([...PLAN_FIELDS, 'capeRatio', 'marketCapeRatio',
    'entnahmeStrategie', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']);

/** Gemeinsame Bereichsauswahl; der Aufrufer entscheidet über ungültige Pläne. */
function readSelectedHouseholdPlan({ storage = persistenceStorage, profileId = null } = {}) {
    const loaded = loadProfileRegistry(storage);
    if (['corrupt', 'unavailable'].includes(loaded.status)) throw loaded.error || new Error('Profilbestand nicht lesbar.');
    const profiles = loaded.value?.profiles || {};
    const members = Object.keys(profiles).filter(id => profiles[id].meta?.belongsToHousehold !== false);
    const current = profileId || storage.getItem('rs_current_profile');
    const scope = profileId && profiles[profileId]?.meta?.belongsToHousehold === false
        ? planScope('single', [profileId])
        : members.length ? planScope('household', members) : current ? planScope('single', [current]) : null;
    const plan = readHouseholdPlan({ scope, storage });
    return { ...plan, scope };
}

/** Balance rechnet den ausgewählten Haushalt; ungültige Pläne bleiben Fehler. */
export function readBalanceHouseholdPlan(options = {}) {
    const plan = readSelectedHouseholdPlan(options);
    if (plan.status === 'invalid') throw plan.error;
    return plan;
}

/** Simulator rechnet den ausgewählten Haushalt, ohne Auswahl die geöffnete Person.
 * Ein expliziter Außenbereich bleibt unabhängig vom gemeinsamen Haushalt.
 * Der ungültige Status erlaubt dem Zustandsbesitzer, Planverlust zu synchronisieren.
 */
export function readSimulatorHouseholdPlan(options = {}) {
    return readSelectedHouseholdPlan(options);
}
export const SIMULATOR_PLAN_FIELD_MAP = Object.freeze({
    ...Object.fromEntries(PLAN_FIELDS.filter(key => !['floorBedarf', 'flexBedarf', 'decumulation', 'cape',
        'minCashBufferMonths', 'householdWithdrawalMode'].includes(key)).map(key => [key, key])),
    startFloorBedarf: 'floorBedarf', startFlexBedarf: 'flexBedarf', marketCapeRatio: 'cape.value',
    entnahmeStrategie: 'decumulation.mode', bondTargetFactor: 'decumulation.bondTargetFactor',
    drawdownTrigger: 'decumulation.drawdownTrigger', bondRefillThreshold: 'decumulation.bondRefillThreshold'
});
export const SIMULATOR_LEGACY_PLAN_FIELDS = Object.freeze([...Object.keys(SIMULATOR_PLAN_FIELD_MAP),
    'minCashBufferMonths', 'householdWithdrawalMode', 'runwayTargetMonths', 'runwayMinMonths']);

/** Nur vorhandene Formularfelder projizieren; unsichtbare Werte bleiben im Plan.
 * Zahlen werden validiert, niemals still begrenzt oder durch Defaults ersetzt.
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
export function projectSimulatorPlanForm(values, doc) {
    const patch = simulatorPlanFormPatch(doc);
    const effective = { ...values, ...patch,
        cape: { ...values.cape, ...patch.cape }, decumulation: { ...values.decumulation, ...patch.decumulation } };
    return projectPlanToSimulator(effective);
}

/** Keine neuen Planwertkopien; Altbestände bleiben bis zum nächsten Write lesbar. */
export function stripBalancePlanInputs(inputs) {
    if (!inputs) return inputs;
    return Object.fromEntries(Object.entries(inputs).filter(([key]) => !BALANCE_PLAN_INPUT_KEYS.includes(key)));
}

/** Synchroner Balance-Write im vorhandenen entprellten/periodengebundenen Besitzer.
 * Die Bestätigung im Backend erfolgt wie für Balance-State über dessen Flush.
 * Asynchrone Seitenschreiber verwenden weiterhin patchHouseholdPlan.
 */
export function stageBalancePlanPatch({ scope, patch, storage = persistenceStorage,
    persistence = PersistenceFacade, now = appNow, navigationOperation } = {}) {
    navigationOperation?.check();
    if (persistence.hasSyncWriteBlocks?.() || globalThis.window?.__profileRecoveryBlocker) throw new Error('Planänderung wegen Wiederherstellung gesperrt.');
    assertPlanScope(scope);
    if (!plain(patch) || Object.keys(patch).some(key => !PLAN_FIELDS.includes(key))) throw new Error('Unbekanntes Planfeld.');
    const loaded = readHouseholdPlan({ scope, storage });
    if (loaded.status !== 'valid') throw loaded.error || new Error('Planbereich ist noch nicht bestätigt.');
    const values = { ...loaded.entry.values, ...patch };
    for (const key of ['cape', 'decumulation']) if (Object.hasOwn(patch, key)) values[key] = { ...loaded.entry.values[key], ...patch[key] };
    const next = buildPlanRecord(loaded.raw, [{ scope, values }], { now });
    navigationOperation?.check();
    if (next.changed) storage.setItem(HOUSEHOLD_PLAN_KEY, next.raw);
    return next.record.entries[scope.key];
}
export const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function canonicalPlan(value) {
    if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonicalPlan(item))));
    if (plain(value)) return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonicalPlan(value[key]))])));
    return JSON.stringify(value);
}
export function planScope(kind, ids) {
    if (!['household', 'single'].includes(kind) || !Array.isArray(ids) || !ids.length
        || ids.some(id => typeof id !== 'string' || !id.trim()) || kind === 'single' && ids.length !== 1) return null;
    const members = [...new Set(ids)].sort();
    return { kind, ids: members, key: JSON.stringify([kind, members]) };
}
export function assertPlanScope(scope) {
    const normalized = planScope(scope?.kind, scope?.ids);
    if (!normalized || normalized.key !== scope.key || canonicalPlan(normalized.ids) !== canonicalPlan(scope.ids)) throw new Error('Ungültiger Planbereich.');
    return normalized;
}
function exactKeys(value, keys, label) {
    if (!plain(value) || canonicalPlan(Object.keys(value).sort()) !== canonicalPlan([...keys].sort())) throw new Error(`${label}: unvollständige oder unbekannte Felder.`);
}
export function assertPlanValues(values) {
    exactKeys(values, PLAN_FIELDS, 'Plan');
    const ranges = {
        floorBedarf: [0, Infinity], flexBedarf: [0, Infinity], minimumFlexAnnual: [0, Infinity],
        flexBudgetAnnual: [0, Infinity], flexBudgetYears: [0, 10], flexBudgetRecharge: [0, Infinity],
        minCashBufferMonths: [0, 12], maxSkimPctOfEq: [0, 25], maxBearRefillPctOfEq: [0, 15],
        horizonYears: [1, 60], survivalQuantile: [0.5, 0.99], goGoMultiplier: [1, 1.5]
    };
    for (const [field, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(values[field]) || values[field] < min || values[field] > max) throw new Error(`${field}: ungültiger Zahlenbereich.`);
    if (!Number.isInteger(values.minCashBufferMonths) || !isValidLiquidityRunwayYears(values.liquidityRunwayYears)) throw new Error('Ungültige Liquiditätsreichweite oder Mindest-Liquidität.');
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
export function assertHouseholdPlanRecord(raw) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    exactKeys(record, ['version', 'entries'], 'Plandatensatz');
    if (record.version !== 1 || !plain(record.entries)) throw new Error('Beschädigter oder künftig versionierter Plandatensatz. Sicherung prüfen.');
    for (const [key, entry] of Object.entries(record.entries)) {
        exactKeys(entry, ['scope', 'updatedAt', 'values'], 'Planbereich');
        if (assertPlanScope(entry.scope).key !== key || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error('Ungültiger Planbereich oder Zeitstempel.');
        assertPlanValues(entry.values);
    }
    return record;
}
/** Fehlend bleibt fehlend; Schäden dürfen nie als leere Migration behandelt werden. */
export function readHouseholdPlan({ scope, storage = persistenceStorage } = {}) {
    const raw = storage.getItem(HOUSEHOLD_PLAN_KEY);
    if (raw === null || raw === undefined) return { status: 'missing', entry: null, raw: null };
    try {
        const record = assertHouseholdPlanRecord(raw);
        if (scope) assertPlanScope(scope);
        const entry = scope ? record.entries[scope.key] ?? null : null;
        return { status: entry ? 'valid' : 'missing', entry, record, raw };
    } catch (error) { return { status: 'invalid', entry: null, raw, error }; }
}
export function buildPlanRecord(raw, entries, { now = appNow } = {}) {
    const record = raw == null ? { version: 1, entries: {} } : structuredClone(assertHouseholdPlanRecord(raw));
    let changed = false;
    for (const { scope, values } of entries) {
        assertPlanScope(scope); assertPlanValues(values);
        if (canonicalPlan(record.entries[scope.key]?.values ?? null) === canonicalPlan(values)) continue;
        record.entries[scope.key] = { scope: structuredClone(scope), updatedAt: now().toISOString(), values: structuredClone(values) };
        changed = true;
    }
    return { raw: changed ? JSON.stringify(record) : raw, record, changed };
}
/** Nutzerentscheidung projizieren; erst die Enginegrenze wendet das CAPE-Gate an. */
export function projectPlanToBalance(values) {
    assertPlanValues(values);
    const { cape, householdWithdrawalMode, ...inputs } = structuredClone(values);
    return { ...inputs, capeRatio: cape.value, marketCapeRatio: cape.value, entnahmeStrategie: inputs.decumulation.mode, ...inputs.decumulation, householdWithdrawalMode };
}
export function projectPlanToSimulator(values) {
    const inputs = projectPlanToBalance(values);
    return { ...inputs, startFloorBedarf: values.floorBedarf, startFlexBedarf: values.flexBedarf };
}
/** Patch ausschließlich im bestätigten Bereich; neue Bereiche gehören dem Umstellungskoordinator. */
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
    const values = { ...loaded.entry.values, ...patch };
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
