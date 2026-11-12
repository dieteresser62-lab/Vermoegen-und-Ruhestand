/** @import * as O from "../../typcheck/overview-ui.js" */
import { HOUSEHOLD_PLAN_KEY, PLAN_FIELDS, assertHouseholdPlanRecord, projectPlanToBalance, memberPlanScope, SIMULATOR_LEGACY_PLAN_FIELDS, planEquityCostPct } from '../profile/household-plan.js';
import { readHouseholdSimulatorNeedsState } from '../simulator/simulator-household-needs-persistence.js';
import { canonicalizeHistoricalContractValue as canonical, sha256Hex } from '../simulator/historical-backtest-contract.js';
import { CONFIG } from '../balance/balance-config.js';
import { PROFILE_VALUE_KEYS } from '../profile/profile-state.js';
import { readPlannedExpenses } from '../profile/household-planned-expenses.js';
import { readBalancePlannedPosts } from '../balance/balance-planned-posts.js';
import { readBalancePlanContext } from '../balance/balance-plan-context.js';
import { readCareValues, careValuesInputPatch } from '../shared/household-care-values.js';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT } from '../simulator/german-demography-care-survivor-contract.js';

export const OVERVIEW_SIMULATION_KEY = 'overview_simulation_summary_v1';
export const FINGERPRINT_VERSION = 2;
export const SIMULATION_KINDS = ['backtest', 'montecarlo', 'workshop'];
export const simulationEntryKey = (scope, kind) => JSON.stringify([scope.key, kind]);
export const fingerprint = value => sha256Hex(canonical(value));
/** Modellstand von Sterbetafel und Pflege (LE-1b nach FR-75). Er zählt für Monte Carlo und Werkstatt und für
 * Backtests mit Dynamic Flex, deren Horizont aus der Zieltafel kommt. Ändert sich die Revision des Demografievertrags,
 * gelten gespeicherte Ergebnisse als veraltet; Ergebnisse von vor LE-1 haben keinen Modellstand und sind damit einmal
 * veraltet. Ein Backtest ohne Dynamic Flex kennt keinen Tod und bleibt gültig. Es wird nichts geschrieben. */
export const LIFE_MODEL_STATE = Object.freeze({ demographyCareSurvivor: GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.revision });
const LIFE_MODEL_KINDS = new Set(['montecarlo', 'workshop']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => value === null || (typeof value === 'number' && Number.isFinite(value));
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 180 && !/[\x00-\x1f]/.test(value);

// Neue numerische Felder bleiben optional; die bisherigen Pflichtfelder gelten unverändert.
export const OPTIONAL_FLEX_SUMMARY_FIELDS = [
    'minimumFlexStartNominalEur', 'minimumFlexYearSharePct', 'minimumFlexAffectedRunSharePct',
    'minimumFlexAffectedYearCount', 'minimumFlexObservationCount', 'flexPaidMedianNominalEur',
    'flexDesiredMedianNominalEur', 'flexPaidMinimumNominalEur', 'legacyFlexCutYearSharePct', 'legacyFlexCutYearCount'
];

function validScope(scope) {
    if (!plain(scope) || !['single', 'household'].includes(scope.kind) || !Array.isArray(scope.ids)
        || !scope.ids.length || scope.ids.some(id => !text(id) || !id)
        || (scope.kind === 'single' && scope.ids.length !== 1)) return false;
    const ids = [...new Set(scope.ids)].sort();
    return canonical(ids) === canonical(scope.ids) && scope.key === JSON.stringify([scope.kind, ids]);
}

/** Strenge Importgrenze: nur kleine Anzeigeprojektionen, keine Rohläufe. */
/**
 * @param raw Gespeicherter Rohwert.
 * @returns Geprüfte kleine Simulationszusammenfassung.
 */
export function assertSimulationRecord(raw) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!plain(record) || record.version !== 1 || !plain(record.entries)
        || Object.keys(record).some(key => !['version', 'entries'].includes(key))) throw new Error('Ungültige Simulationszusammenfassung.');
    for (const [key, item] of Object.entries(record.entries)) {
        if (!plain(item) || !validScope(item.scope) || !SIMULATION_KINDS.includes(item.kind)
            || key !== simulationEntryKey(item.scope, item.kind) || !Number.isFinite(Date.parse(item.completedAt))
            || typeof item.completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(item.completedAt)
            || new Date(item.completedAt).toISOString().slice(0, 19) !== item.completedAt.slice(0, 19) || !text(item.statement) || !text(item.priceBasis)
            || !Number.isInteger(item.fingerprintVersion) || item.fingerprintVersion < 1
            || !/^[a-f0-9]{64}$/.test(item.sourceFingerprint) || !/^[a-f0-9]{64}$/.test(item.runFingerprint)
            || typeof item.deviationApplied !== 'boolean' || !plain(item.metrics)
            || Object.keys(item).some(field => !['scope', 'kind', 'completedAt', 'statement', 'priceBasis', 'fingerprintVersion',
                'sourceFingerprint', 'runFingerprint', 'deviationApplied', 'metrics'].includes(field))) throw new Error('Ungültiger Simulationseintrag.');
        const fields = item.kind === 'backtest' ? ['startYear', 'endYear', 'failureYear', 'endWealthReal']
            : item.kind === 'montecarlo' ? ['runs', 'covered', 'successPct', 'median', 'p5'] : ['endWealthReal'];
        const optional = item.kind === 'workshop' ? [] : OPTIONAL_FLEX_SUMMARY_FIELDS.filter(field =>
            item.kind === 'backtest' ? !['minimumFlexAffectedRunSharePct', 'legacyFlexCutYearSharePct'].includes(field)
                : !['minimumFlexAffectedYearCount', 'minimumFlexObservationCount', 'legacyFlexCutYearCount'].includes(field));
        if (Object.keys(item.metrics).some(field => !fields.includes(field) && !optional.includes(field))
            || optional.some(field => Object.hasOwn(item.metrics, field) && (!finite(item.metrics[field])
                || item.metrics[field] !== null && (item.metrics[field] < 0
                    || field.endsWith('Pct') && item.metrics[field] > 100
                    || field.endsWith('Count') && !Number.isInteger(item.metrics[field]))))
            || fields.some(field => !Object.hasOwn(item.metrics, field) || !finite(item.metrics[field]))) throw new Error('Ungültige Simulationskennzahlen.');
        if (item.kind === 'backtest' && (![item.metrics.startYear, item.metrics.endYear].every(Number.isInteger)
            || item.metrics.endYear < item.metrics.startYear
            || (item.metrics.failureYear !== null && (!Number.isInteger(item.metrics.failureYear) || item.metrics.failureYear < item.metrics.startYear || item.metrics.failureYear > item.metrics.endYear))
            || !['completed', 'ruin'].includes(item.statement))) throw new Error('Ungültiger Backtestabschluss.');
        if (item.kind === 'montecarlo' && (!Number.isInteger(item.metrics.runs) || item.metrics.runs < 1
            || !Number.isInteger(item.metrics.covered) || item.metrics.covered < 0 || item.metrics.covered > item.metrics.runs
            || !Number.isFinite(item.metrics.successPct) || item.metrics.successPct < 0 || item.metrics.successPct > 100
            || Math.abs(item.metrics.successPct - item.metrics.covered / item.metrics.runs * 100) > 1e-8)) throw new Error('Ungültiges Monte-Carlo-Inventar.');
    }
    if (JSON.stringify(record).length > 100000) throw new Error('Simulationszusammenfassung zu groß.');
    return record;
}

/**
 * @param raw Gespeicherter Rohwert.
 * @returns Gelesene Zusammenfassung oder leerer Anzeigecontainer.
 */
export function readSimulationRecord(raw) {
    if (raw === null || raw === undefined) return { version: 1, entries: {} };
    try { return assertSimulationRecord(raw); } catch { return { version: 1, entries: {} }; }
}

const technical = /(?:name|notes|ticker|isin|createdAt|updatedAt|asOf|timestamp|^log|LogDetail|telemetry|worker|showAdvanced|showCareDetails|proxy|display|details|advanced|snapshot|fingerprint|uiState)/i;
const mcFields = /^(?:mc|rngMode$|useCapeSampling$|stressPreset$|tailRisk|marketCapeRatio$)/;
const simFields = new Set(('startFloorBedarf startFlexBedarf minimumFlexAnnual flexBudgetAnnual flexBudgetYears flexBudgetRecharge '
    + 'marketCapeRatio dynamicFlex horizonMethod horizonYears survivalQuantile goGoActive goGoMultiplier '
    + 'longevityMode longevityQuantileShift longevityRelativePct longevityBufferYears pflegefallLogikAktivieren pflegeModellTyp '
    + 'pflegeMaxFloor pflegeRampUp pflegeMinDauer pflegeMaxDauer pflegeKostenDrift pflegeRegionalZuschlag pflegeHeimEigeneAusgaben '
    + 'entnahmeStrategie bondTargetFactor drawdownTrigger bondRefillThreshold mcAnzahl mcDauer mcBlockSize mcSeed mcMethode rngMode '
    + 'useCapeSampling mcStartYearMode mcStartYearFilter mcStartYearHalfLife mcExcludeEstimatedHistory '
    + 'widowPensionMode widowPensionPct widowMarriageOffsetYears widowMinMarriageYears survivorFloorPercent survivorFlexPercent survivorMinimumFlexPercent stressPreset tailRiskMode tailRiskProbability tailRiskSeverity tailRiskHorizonYears goldAllokationAktiv goldAllokationProzent goldFloorProzent goldSteuerfrei rebalancingBand tagesgeld simStartVermoegen depotwertAlt geldmarktEtf einstandAlt liquidityRunwayYears runwayTargetMonths runwayMinMonths maxSkimPctOfEq maxBearRefillPctOfEq risikoprofil rentAdjPct').split(' '));
const boolFields = /(?:Aktiv|Aktivieren|Active|enabled|dynamicFlex|steuerfrei|Sampling|EstimatedHistory|rente_aktiv|gold_aktiv)$/i;
function normalize(value, key = '') {
    if (Array.isArray(value)) return value.map(item => normalize(item));
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().filter(field => !technical.test(field))
        .map(field => [field, normalize(value[field], field)]));
    if (typeof value !== 'string') return value;
    const str = value.trim();
    if (boolFields.test(key)) return ['true', '1', 'yes', 'on'].includes(str.toLowerCase());
    if (/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(str)) return Number(str.replace(',', '.'));
    if (str === 'true' || str === 'false') return str === 'true';
    return str;
}
function effective(values, kind) {
    const result = normalize(values);
    const care = result.pflegefallLogikAktivieren ?? false;
    if (care === false) for (const key of Object.keys(result)) if (key.startsWith('pflege') && key !== 'pflegefallLogikAktivieren') delete result[key];
    if ((result.goGoActive ?? false) === false) delete result.goGoMultiplier;
    if ((result.dynamicFlex ?? false) === false) for (const key of ['horizonMethod', 'horizonYears', 'survivalQuantile', 'goGoActive', 'goGoMultiplier', 'longevityMode', 'longevityQuantileShift', 'longevityRelativePct', 'longevityBufferYears']) delete result[key];
    if (result.horizonMethod === 'mean') delete result.survivalQuantile;
    if (result.longevityMode !== 'quantile_shift') delete result.longevityQuantileShift;
    if (result.longevityMode !== 'relative_horizon_buffer') delete result.longevityRelativePct;
    if (result.longevityMode !== 'buffer_years') delete result.longevityBufferYears;
    if ((result.entnahmeStrategie || result.decumulation?.mode) !== '3_bucket_jilge') {
        for (const key of ['bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']) delete result[key];
        if (result.decumulation) result.decumulation = { mode: result.decumulation.mode };
    }
    if (kind === 'montecarlo') {
        if (result.useCapeSampling === true || result.mcStartYearMode !== 'FILTER') delete result.mcStartYearFilter;
        if (result.useCapeSampling === true || result.mcStartYearMode !== 'RECENCY') delete result.mcStartYearHalfLife;
        if (result.useCapeSampling === true) delete result.mcStartYearMode;
        if (['iid', 'markov'].includes(result.mcMethode)) delete result.mcBlockSize;
    }
    if (kind !== 'montecarlo') for (const key of Object.keys(result)) if (mcFields.test(key)) delete result[key];
    return result;
}

/** Gespeicherte Quellen und Balance-Posten zum Fachdatum; kein DOM, keine Engine, kein Worker. */
/** @param {O.FingerprintOptions} options @returns {string|null} */
export function sourceFingerprint({ registry, activeId, liveData = {}, scope, kind, referenceYear }) {
    try {
        if (!validScope(scope) || !registry?.profiles?.[activeId]) return null;
        const planRecord = liveData[HOUSEHOLD_PLAN_KEY] == null ? null : assertHouseholdPlanRecord(liveData[HOUSEHOLD_PLAN_KEY]);
        const storage = { getItem: key => key === 'rs_profiles_v1' ? JSON.stringify(registry)
            : key === 'rs_current_profile' ? activeId : liveData[key] ?? null };
        const balanceContext = kind === 'balance' ? readBalancePlanContext({ storage, referenceYear }) : null;
        // Einpersonenpläne können aus älteren Haushaltsbereichen stammen.
        const membersScope = balanceContext?.scope || (scope.kind === 'single' && registry.profiles[scope.ids[0]]?.meta.belongsToHousehold !== false
            ? memberPlanScope(Object.keys(registry.profiles).filter(id => registry.profiles[id].meta.belongsToHousehold !== false), { getItem: key => liveData[key] ?? null })
            : scope);
        const plan = planRecord?.entries[membersScope.key]?.values;
        const members = scope.ids.map(id => {
            const profile = registry.profiles[id];
            if (!profile) throw new Error('Profil fehlt');
            const data = id === activeId ? liveData : profile.data;
            const state = data[CONFIG.STORAGE.LS_KEY] ? JSON.parse(data[CONFIG.STORAGE.LS_KEY]) : {};
            const tranches = data.depot_tranchen ? JSON.parse(data.depot_tranchen) : [];
            if (!plain(state) || !Array.isArray(tranches)) throw new Error('Quelle beschädigt');
            const person = Object.fromEntries(Object.values(PROFILE_VALUE_KEYS).filter(key => !['profile_person_schema_version', 'profile_person_migration_v1'].includes(key) && Object.hasOwn(data, key)).map(key => [key, normalize(data[key], key)]));
            if (person.profile_rente_aktiv === false) for (const key of ['profile_rente_monatlich', 'profile_rentenbeginn', 'profile_rentenanpassung_art', 'profile_rentenanpassung_pct', 'profile_rente_steuerquote_pct']) delete person[key];
            const assumptions = {};
            for (const key of Object.keys(data)) {
                if (!key.startsWith('sim_')) continue;
                const field = key.slice(4);
                if (plan && SIMULATOR_LEGACY_PLAN_FIELDS.includes(field)) continue;
                const raw = data[key];
                if (simFields.has(field) || /^pflegeStufe[1-5](Zusatz|FlexCut|Mortality)$/.test(field)) assumptions[field] = normalize(raw, field);
            }
            const health = data.profile_health_bucket ? normalize(JSON.parse(data.profile_health_bucket)) : null;
            const inputs = { ...(state.inputs || {}) };
            if (plan) for (const key of [...PLAN_FIELDS, 'marketCapeRatio', 'capeRatio', 'entnahmeStrategie', 'bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold',
                'startFloorBedarf', 'startFlexBedarf', 'runwayTargetMonths', 'runwayMinMonths', 'runwayTargetM', 'runwayMinM']) { delete inputs[key]; delete assumptions[key]; }
            // KO-2 (FR-76): Fondskosten sind ein Planwert, fehlend gilt die Vorgabe; der frühere Simulator-Schlüssel zählt nicht.
            // Ohne Plan rechnet der Simulator mit der Vorgabe. Gleiche Stelle wie in GU-1b, damit Ergebnisse mit 0,5 % gültig bleiben.
            assumptions.equityCostPct = planEquityCostPct(plan);
            return { id, belongs: profile.meta.belongsToHousehold !== false, person, inputs: effective(inputs, kind), assumptions: kind === 'balance' ? {} : effective(assumptions, kind),
                health: health?.enabled === false ? { enabled: false } : health,
                tranches: tranches.map(lot => normalize(lot)).sort((a, b) => canonical(a).localeCompare(canonical(b))) };
        });
        const needs = plan || kind === 'balance' ? null : /** @type {(storage: import("../../typcheck/datenvertraege.js").RecordReader)=>ReturnType<typeof readHouseholdSimulatorNeedsState>} */ (readHouseholdSimulatorNeedsState)({ getItem: key => liveData[key] ?? null });
        if (['invalid', 'unsupported'].includes(needs?.status)) return null;
        const projectedPlan = plan ? projectPlanToBalance(plan) : null;
        if (projectedPlan) projectedPlan.dynamicFlex = plan.dynamicFlex && plan.cape.value > 0;
        const usesDynamicFlex = projectedPlan ? projectedPlan.dynamicFlex === true
            : members.some(member => member.inputs.dynamicFlex === true || member.assumptions.dynamicFlex === true);
        const plannedExpenses = readPlannedExpenses({ scope: kind === 'balance' ? membersScope : scope, storage });
        const balancePosts = kind === 'balance' && plannedExpenses.length
            ? readBalancePlannedPosts({ storage, scope: membersScope, year: balanceContext.referenceYear, people: [] }) : null;
        const care = readCareValues({ getItem: key => liveData[key] ?? null });
        const careChanged = Object.hasOwn(careValuesInputPatch(care), 'careValues');
        return fingerprint({ version: FINGERPRINT_VERSION, kind, scope, members, plan: projectedPlan ? effective(projectedPlan, 'balance') : null,
            ...(LIFE_MODEL_KINDS.has(kind) || (kind === 'backtest' && usesDynamicFlex) ? { lifeModel: LIFE_MODEL_STATE } : {}),
            needs: normalize(needs?.values || null), mode: plan ? null : liveData.household_withdrawal_mode ?? null,
            ...(careChanged ? { careValues: { allowance: care.allowance.values, residentialMonthly: care.residential.monthly,
                ...(care.residential.components ? { residentialComponents: care.residential.components } : {}) } } : {}),
            ...(plannedExpenses.length ? { plannedExpenses: normalize(plannedExpenses) } : {}),
            ...(balancePosts ? { plannedPayments: normalize(balancePosts) } : {}) });
    } catch { return null; }
}

/**
 * @param context Personen-, Speicher- und Bereichskontext.
 * @returns Übereinstimmende Zusammenfassungen und deren Aktualitätsstatus.
 */
export function projectSimulationSummaries(context) {
    const { registry, activeId, liveData, scope } = context;
    return Object.fromEntries(SIMULATION_KINDS.map(kind => {
        const items = scope?.ids.map(id => readSimulationRecord(id === activeId ? liveData[OVERVIEW_SIMULATION_KEY]
            : registry.profiles[id]?.data[OVERVIEW_SIMULATION_KEY]).entries[simulationEntryKey(scope, kind)]) || [];
        const entry = items.length && items.every(item => item && canonical(item) === canonical(items[0])) ? items[0] : null;
        const current = sourceFingerprint({ ...context, kind });
        return [kind, { entry, stale: Boolean(entry && (entry.fingerprintVersion !== FINGERPRINT_VERSION || !current || current !== entry.sourceFingerprint)) }];
    }));
}
