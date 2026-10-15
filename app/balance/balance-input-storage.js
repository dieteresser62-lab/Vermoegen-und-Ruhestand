import { projectBalancePlanningHorizon } from './balance-planning-horizon.js';
import { readBalanceInflationSource } from './balance-inflation-source.js';
/** DOM-freier, ausschließlich lesender Eingabebau. Der UIReader bleibt das DOM-Orakel. */
import { readBalancePersonStatus, projectParticipatingPerson } from '../shared/person-data-status.js';
import { BALANCE_PLAN_INPUT_KEYS, readBalanceHouseholdPlan, assertPlanScope, projectPlanToBalance } from '../profile/household-plan.js';
import { parseBalanceCurrencyInput } from './balance-reader.js';
import { UIUtils } from './balance-utils.js';
import { CONFIG, ValidationError } from './balance-config.js';
import { TRANCHE_STATUS_STATES, calculateAggregatedValues } from '../tranches/depot-tranchen-status.js';
import { loadTranchesFromStorage } from '../tranches/tranchen-manager-state.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { PROFILE_STORAGE_KEYS, readProfileOverridesFromStorage, readProfileHealthBucketFromStorage,
    parseProfileOverridesFromData, parseProfileHealthBucketFromData, parseStoredBalanceStateFromData } from '../profile/profile-state.js';
import { assertProfileDataLoadable } from '../profile/profile-storage.js';
import { loadProfilverbundProfiles, buildProfilverbundAssetSummary } from '../profile/profilverbund-balance.js';
import { LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../../types/liquidity-runway-contract.js';
import { LONGEVITY_DEFAULTS, normalizeLongevityMode } from '../simulator/dynamic-flex-longevity-contract.js';
import { cloneBalanceState, validateBalanceInputs, prepareEngineLastState, projectBalancePlanHistory,
    createBalanceCommitBaseFingerprint, createBalanceFingerprint } from './balance-update-pipeline.js';

export const BALANCE_STORAGE_FIELD_IDS = Object.freeze([
    'aktuellesAlter', 'ath', 'bondRefillThreshold', 'bondTargetFactor', 'capeRatio', 'costBasisAlt',
    'costBasisNeu', 'depotwertAlt', 'depotwertNeu', 'drawdownTrigger', 'dynamicFlex', 'endeVJ',
    'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'entnahmeStrategie', 'flexBedarf', 'flexBudgetAnnual',
    'flexBudgetRecharge', 'flexBudgetYears', 'floorBedarf', 'geldmarktEtf', 'goGoActive',
    'goGoMultiplier', 'goldAktiv', 'goldCost', 'goldFloorProzent', 'goldSteuerfrei', 'goldWert',
    'goldZielProzent', 'horizonMethod', 'horizonYears', 'inflation', 'jahreSeitAth',
    'kirchensteuerSatz', 'liquidityRunwayYears', 'longevityBufferYears', 'longevityMode',
    'longevityQuantileShift', 'longevityRelativePct', 'marketCapeRatio', 'maxBearRefillPctOfEq',
    'maxSkimPctOfEq', 'minCashBufferMonths', 'minimumFlexAnnual', 'profilName', 'rebalancingBand',
    'renteAktiv', 'renteMonatlich', 'sparerPauschbetrag', 'survivalQuantile', 'tagesgeld', 'tqfAlt',
    'tqfNeu'
]);

const currencyFields = new Set(['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual',
    'flexBudgetRecharge', 'tagesgeld', 'geldmarktEtf', 'goldWert',
    'costBasisAlt', 'costBasisNeu', 'goldCost', 'sparerPauschbetrag']);

function storedFields(inputs = {}, rawFields = {}) {
    const values = { ...inputs };
    const strategy = inputs.decumulation?.threeBucket || inputs.decumulation;
    if (strategy) Object.assign(values, strategy, { entnahmeStrategie: inputs.decumulation.mode });
    const fields = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
        value: value == null ? '' : currencyFields.has(id) ? UIUtils.formatNumber(UIUtils.parseCurrency(value))
            : id === 'renteAktiv' ? value === true ? 'ja' : 'nein' : String(value),
        checked: value === true
    }]));
    return { ...fields, ...rawFields };
}

function readStoredInputValues({ fields, storage, status, trancheSource, plan }) {
    const num = (id) => fields[id]
        ? parseBalanceCurrencyInput(id, fields[id].value)
        : 0;
    const val = (id) => fields[id] ? fields[id].value : '';
    const finiteNumber = (id, fallback = 0, { integer = false } = {}) => {
        const rawValue = val(id);
        if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
            return fallback;
        }
        const raw = String(rawValue).trim();
        if (raw.includes('.') && raw.includes(',')) return fallback;
        const normalized = raw.includes(',') ? raw.replace(',', '.') : raw;
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
            return fallback;
        }
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return fallback;
        return parsed;
    };
    const checked = (id) => fields[id] ? fields[id].checked : false;
    const readPersistedCapeRatio = () => {
        try {
            const raw = storage.getItem(CONFIG.STORAGE.LS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const direct = Number(parsed?.capeMeta?.capeRatio);
            if (Number.isFinite(direct) && direct > 0) return direct;
            const legacy = Number(parsed?.inputs?.capeRatio);
            if (Number.isFinite(legacy) && legacy > 0) return legacy;
            return null;
        } catch {
            return null;
        }
    };

    // Profilwerte (localStorage) überschreiben DOM-Werte, wenn vorhanden.
    const readiness = status;
    if (readiness.status === 'corrupt') throw readiness.error;
    if (!readiness.ready) throw new ValidationError([{ fieldId: 'aktuellesAlter', code: 'person_data_incomplete', message: readiness.message }]);
    const selectedData = readiness.entries?.find(entry => entry.profileId === readiness.calculationProfileId)?.data;
    const profileOverrides = selectedData ? parseProfileOverridesFromData(selectedData) : readProfileOverridesFromStorage(storage);
    const profileTagesgeld = profileOverrides.profileTagesgeld;
    const person = readiness.status === 'demo' ? {
        startAlter: finiteNumber('aktuellesAlter', 0, { integer: true }), renteMonatlich: num('renteMonatlich'),
        sonstigeEinkuenfte: 0, startSPB: num('sparerPauschbetrag'), kirchensteuerSatz: finiteNumber('kirchensteuerSatz')
    } : projectParticipatingPerson(readiness, storage.getItem('rs_current_profile'));
    const profileRenteMonatlich = readiness.status === 'demo' || person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12;
    const profileSonstigeEinkuenfte = person.sonstigeEinkuenfte;
    const profileRenteAktiv = profileRenteMonatlich + profileSonstigeEinkuenfte > 0;
    const profileAlter = person.startAlter;
    const profileGoldAktiv = profileOverrides.profileGoldAktiv;
    const profileGoldZiel = profileOverrides.profileGoldZiel;
    const profileGoldFloor = profileOverrides.profileGoldFloor;
    const profileGoldSteuerfrei = profileOverrides.profileGoldSteuerfrei;
    const profileGoldRebalBand = profileOverrides.profileGoldRebalBand;
    const healthBucket = selectedData ? parseProfileHealthBucketFromData(selectedData) : readProfileHealthBucketFromStorage(storage);
    // Der Statuspfad trennt nicht geladen, explizit leer, gültig und fehlerhaft.
    // Ein leeres Profilverbund-Override ist kanonisch leer und darf weder auf
    // DOM-Werte noch auf den aktuell gespeicherten Profilbestand zurückfallen.
    const trancheStatus = trancheSource;
    if (trancheStatus.state === TRANCHE_STATUS_STATES.ERROR) {
        throw new ValidationError([{
            fieldId: 'detailledTranches',
            code: trancheStatus.errorCode || 'tranche_status_error',
            message: 'Der Tranchenbestand ist fehlerhaft und kann nicht für die Berechnung verwendet werden.'
        }]);
    }
    const detailledTranches = trancheStatus.state === TRANCHE_STATUS_STATES.VALID
        ? trancheStatus.tranches
        : [];
    const explicitEmptyOverride = trancheStatus.source === 'override'
        && trancheStatus.state === TRANCHE_STATUS_STATES.EMPTY;
    const aggregated = trancheStatus.state === TRANCHE_STATUS_STATES.VALID
        ? calculateAggregatedValues(detailledTranches)
        : (explicitEmptyOverride ? {
            depotwertAlt: 0,
            costBasisAlt: 0,
            depotwertNeu: 0,
            costBasisNeu: 0,
            geldmarktEtf: 0,
            goldWert: 0,
            goldCost: 0,
            bondsWert: 0,
            bondsCost: 0
        } : null);

    const useAggregates = aggregated !== null;



    // Fallback-Defaults für Gold, wenn Inputs unplausibel/leer sind.
    const DEFAULT_GOLD_ZIEL = 7.5;
    const DEFAULT_GOLD_FLOOR = 1;
    const DEFAULT_GOLD_BAND = 25;

    let goldAktivFinal = (typeof profileGoldAktiv === 'boolean') ? profileGoldAktiv : checked('goldAktiv');
    let goldZielFinal = Number.isFinite(profileGoldZiel)
        ? profileGoldZiel
        : finiteNumber('goldZielProzent', Number.NaN);
    let goldFloorFinal = Number.isFinite(profileGoldFloor) ? profileGoldFloor : (parseFloat(val('goldFloorProzent')) || 0);
    let goldSteuerfreiFinal = (typeof profileGoldSteuerfrei === 'boolean') ? profileGoldSteuerfrei : checked('goldSteuerfrei');
    let rebalancingBandFinal = Number.isFinite(profileGoldRebalBand)
        ? profileGoldRebalBand
        : finiteNumber('rebalancingBand', Number.NaN);

    if (!Number.isFinite(goldZielFinal) || goldZielFinal < 0 || goldZielFinal > 50) {
        goldZielFinal = DEFAULT_GOLD_ZIEL;
    }
    if (!Number.isFinite(goldFloorFinal) || goldFloorFinal < 0 || goldFloorFinal > 50) {
        goldFloorFinal = DEFAULT_GOLD_FLOOR;
    }
    if (goldAktivFinal && (!Number.isFinite(rebalancingBandFinal) || rebalancingBandFinal < 0)) {
        rebalancingBandFinal = DEFAULT_GOLD_BAND;
    } else if (!Number.isFinite(rebalancingBandFinal)) {
        rebalancingBandFinal = 0;
    }

    const hasProfileRenteSum = Number.isFinite(profileRenteMonatlich)
        || Number.isFinite(profileSonstigeEinkuenfte);
    const renteMonatlichFinal = hasProfileRenteSum
        ? (Number.isFinite(profileRenteMonatlich) ? profileRenteMonatlich : 0)
        + (Number.isFinite(profileSonstigeEinkuenfte) ? profileSonstigeEinkuenfte : 0)
        : num('renteMonatlich');
    const renteAktivFinal = hasProfileRenteSum
        ? renteMonatlichFinal > 0
        : ((typeof profileRenteAktiv === 'boolean') ? profileRenteAktiv : val('renteAktiv') === 'ja');
    const capeInputValue = parseFloat(val('marketCapeRatio') || val('capeRatio')) || 0;
    const persistedCapeRatio = readPersistedCapeRatio() || 0;
    const capeRatio = Math.max(0, capeInputValue > 0 ? capeInputValue : persistedCapeRatio);
    const rawDynamicFlex = checked('dynamicFlex');
    const rawHorizonMethod = val('horizonMethod') || 'survival_quantile';
    const horizonMethod = (rawHorizonMethod === 'mean' || rawHorizonMethod === 'survival_quantile')
        ? rawHorizonMethod
        : 'survival_quantile';
    const horizonYears = Math.max(1, Math.min(60, parseFloat(val('horizonYears')) || 30));
    const survivalQuantile = Math.max(0.5, Math.min(0.99, parseFloat(val('survivalQuantile')) || 0.85));
    const goGoActive = checked('goGoActive');
    const goGoMultiplier = Math.max(1.0, Math.min(1.5, parseFloat(val('goGoMultiplier')) || 1.0));
    const longevityMode = normalizeLongevityMode(val('longevityMode') || LONGEVITY_DEFAULTS.mode);
    const longevityQuantileShiftRaw = parseFloat(val('longevityQuantileShift'));
    const longevityRelativePctRaw = parseFloat(val('longevityRelativePct'));
    const longevityBufferYearsRaw = parseFloat(val('longevityBufferYears'));
    // Feature gate for Balance rollout: Dynamic Flex requires a valid CAPE anchor.
    const dynamicFlex = rawDynamicFlex && capeRatio > 0;

    const bondTargetFactor = parseFloat(val('bondTargetFactor'));
    const drawdownTrigger = parseFloat(val('drawdownTrigger'));
    const bondRefillThreshold = parseFloat(val('bondRefillThreshold'));

    const output = {
        aktuellesAlter: profileAlter,
        floorBedarf: num('floorBedarf'),
        flexBedarf: num('flexBedarf'),
        minimumFlexAnnual: num('minimumFlexAnnual'),
        flexBudgetAnnual: num('flexBudgetAnnual'),
        flexBudgetYears: parseFloat(val('flexBudgetYears')) || 0,
        flexBudgetRecharge: num('flexBudgetRecharge'),
        inflation: parseFloat(val('inflation')) || 0,
        tagesgeld: Number.isFinite(profileTagesgeld) ? profileTagesgeld : num('tagesgeld'),
        geldmarktEtf: useAggregates ? aggregated.geldmarktEtf : num('geldmarktEtf'),
        depotwertAlt: useAggregates ? aggregated.depotwertAlt : num('depotwertAlt'),
        depotwertNeu: useAggregates ? aggregated.depotwertNeu : num('depotwertNeu'),
        goldWert: useAggregates ? aggregated.goldWert : num('goldWert'),
        endeVJ: parseFloat(val('endeVJ')) || 0,
        endeVJ_1: parseFloat(val('endeVJ_1')) || 0,
        endeVJ_2: parseFloat(val('endeVJ_2')) || 0,
        endeVJ_3: parseFloat(val('endeVJ_3')) || 0,
        ath: parseFloat(val('ath')) || 0,
        jahreSeitAth: parseFloat(val('jahreSeitAth')) || 0,
        renteAktiv: renteAktivFinal,
        renteMonatlich: renteMonatlichFinal,
        risikoprofil: 'sicherheits-dynamisch',
        goldAktiv: goldAktivFinal,
        goldZielProzent: goldZielFinal,
        goldFloorProzent: goldFloorFinal,
        goldSteuerfrei: goldSteuerfreiFinal,
        rebalancingBand: rebalancingBandFinal,
        costBasisAlt: useAggregates ? aggregated.costBasisAlt : num('costBasisAlt'),
        costBasisNeu: useAggregates ? aggregated.costBasisNeu : num('costBasisNeu'),
        tqfAlt: parseFloat(val('tqfAlt')) || 0,
        tqfNeu: parseFloat(val('tqfNeu')) || 0,
        goldCost: useAggregates ? aggregated.goldCost : num('goldCost'),
        kirchensteuerSatz: person.kirchensteuerSatz,
        sparerPauschbetrag: readiness.status !== 'demo' ? readiness.entries.reduce((sum, entry) => sum + projectParticipatingPerson({ ...readiness, calculationProfileId: entry.profileId }, entry.profileId).startSPB, 0) : person.startSPB,
        liquidityRunwayYears: finiteNumber(
            'liquidityRunwayYears',
            LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears
        ),
        minCashBufferMonths: finiteNumber('minCashBufferMonths', 2, { integer: true }),
        maxSkimPctOfEq: finiteNumber('maxSkimPctOfEq', 0),
        maxBearRefillPctOfEq: finiteNumber('maxBearRefillPctOfEq', 0),
        marketCapeRatio: capeRatio,
        capeRatio: capeRatio,
        dynamicFlex,
        horizonMethod,
        horizonYears,
        survivalQuantile,
        goGoActive,
        goGoMultiplier,
        longevityMode,
        longevityQuantileShift: Number.isFinite(longevityQuantileShiftRaw) ? longevityQuantileShiftRaw : LONGEVITY_DEFAULTS.quantileShift,
        longevityRelativePct: Number.isFinite(longevityRelativePctRaw) ? longevityRelativePctRaw : LONGEVITY_DEFAULTS.relativePct,
        longevityBufferYears: Number.isFinite(longevityBufferYearsRaw) ? longevityBufferYearsRaw : LONGEVITY_DEFAULTS.bufferYears,
        decumulation: {
            mode: val('entnahmeStrategie') || 'standard',
            bondTargetFactor: Number.isFinite(bondTargetFactor) ? bondTargetFactor : 5.0,
            drawdownTrigger: Number.isFinite(drawdownTrigger) ? drawdownTrigger : 15.0,
            bondRefillThreshold: Number.isFinite(bondRefillThreshold) ? bondRefillThreshold : null
        },
        healthBucket,
        healthBucketEnabled: healthBucket.enabled,
        healthBucketInitialAmount: healthBucket.initialAmount,
        healthBucketAssetSource: healthBucket.assetSource,
        healthBucketTriggerMinGrade: healthBucket.triggerMinGrade,
        healthBucketTriggerMode: healthBucket.triggerMode,
        healthBucketCoverageMode: healthBucket.coverageMode,
        healthBucketReturnMode: healthBucket.returnMode,
        healthBucketTargetMode: healthBucket.targetMode,
        profilName: val('profilName') || '',
        // NEU: Detaillierte Tranchen für FIFO und präzise Steuerberechnung
        detailledTranches: detailledTranches.length
            ? detailledTranches
            : (explicitEmptyOverride ? [] : null)
    };
    if (plan.status === 'valid') {
        const projection = projectPlanToBalance(plan.entry.values);
        for (const key of Object.keys(output)) if (Object.hasOwn(projection, key)) output[key] = projection[key];
        output.dynamicFlex = plan.entry.values.dynamicFlex && plan.entry.values.cape.value > 0;
    }
    validateBalanceInputs(output);
    return projectBalancePlanningHorizon(output, readiness);
}

/** Fachliche Ergänzungen aus dem bisherigen updateProfilverbundGlobals ohne Fensterquellen. */
export function projectStoredHouseholdInputs(profiles, inputData) {
    if (!profiles.length) return inputData;
    const assetSummary = buildProfilverbundAssetSummary(profiles);

    const totalRenteMonatlich = assetSummary.totalRenteMonatlich;
    inputData.tagesgeld = assetSummary.totalTagesgeld;
    inputData.geldmarktEtf = assetSummary.totalGeldmarkt;
    inputData.depotwertAlt = assetSummary.totalDepotAlt;
    inputData.depotwertNeu = assetSummary.totalDepotNeu;
    inputData.costBasisAlt = assetSummary.totalCostAlt;
    inputData.costBasisNeu = assetSummary.totalCostNeu;
    inputData.goldWert = assetSummary.totalGold;
    inputData.goldCost = assetSummary.totalGoldCost;
    inputData.detailledTranches = assetSummary.mergedTranches;
    inputData.goldAktiv = assetSummary.goldStrategy.goldAktiv;
    inputData.goldBasisVermoegen = assetSummary.goldStrategy.goldBasisVermoegen;
    inputData.goldZielBetrag = assetSummary.goldStrategy.goldZielBetrag;
    inputData.goldFloorBetrag = assetSummary.goldStrategy.goldFloorBetrag;
    inputData.goldZielProzent = assetSummary.goldStrategy.goldZielProzent;
    inputData.goldFloorProzent = assetSummary.goldStrategy.goldFloorProzent;
    inputData.goldSteuerfrei = assetSummary.goldStrategy.goldSteuerfrei;
    inputData.rebalancingBand = assetSummary.goldStrategy.rebalancingBand;
    inputData.goldStrategyDiagnostics = assetSummary.goldStrategy.diagnostics;
    inputData.renteAktiv = totalRenteMonatlich > 0;
    inputData.renteMonatlich = totalRenteMonatlich;
    if (assetSummary.primaryHealthBucket) {
        inputData.healthBucket = assetSummary.primaryHealthBucket;
        inputData.healthBucketEnabled = assetSummary.primaryHealthBucket.enabled;
        inputData.healthBucketInitialAmount = assetSummary.primaryHealthBucket.initialAmount;
    }

    return inputData;
}

/** Umfang wird gegen die tatsächliche Auswahl geprüft, niemals still ersetzt. */
export function buildBalanceEngineInputFromStorage({ scope, storage, referenceYear } = {}) {
    if (!storage || typeof storage.getItem !== 'function') throw new Error('Ein lesender Speicheradapter ist erforderlich.');
    const plan = readBalanceHouseholdPlan({ storage });
    if (scope) {
        assertPlanScope(scope);
        if (scope.key !== plan.scope?.key) throw new Error('Rechenumfang und gespeicherte Profilauswahl stimmen nicht überein.');
    }
    const status = readBalancePersonStatus({ storage, win: null, referenceYear });
    if (status.status === 'corrupt') throw status.error;
    if (!status.ready) throw new ValidationError([{ fieldId: 'aktuellesAlter', message: status.message }]);
    const persistentState = parseStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) }) || {};
    // Bestehende Ladeprojektion, ohne deren technischen Migrationswrite.
    if (!storage.getItem(CONFIG.STORAGE.MIGRATION_FLAG)) {
        persistentState.lastState ||= {};
        if (!Number.isFinite(persistentState.lastState.lastInflationAppliedAtAge)) persistentState.lastState.lastInflationAppliedAtAge = 0;
    }
    if (persistentState.lastState) {
        persistentState.lastState.taxState ||= { lossCarry: 0 };
        if (!Number.isFinite(persistentState.lastState.taxState.lossCarry) || persistentState.lastState.taxState.lossCarry < 0) persistentState.lastState.taxState.lossCarry = 0;
    }
    // Nur den ausgewählten Rechenumfang lesend prüfen; Schäden mit Profilname
    // und Rohwert über die bestehende Recovery melden, bevor projiziert wird.
    if (status.status !== 'demo') {
        const registryRaw = storage.getItem(PROFILE_STORAGE_KEYS.registry);
        for (const entry of status.entries) {
            assertProfileDataLoadable(entry.profileId, {
                meta: { name: entry.name }, data: entry.data
            }, { registryRaw });
        }
    }
    const profiles = loadProfilverbundProfiles({ storage, status });
    const householdTranches = profiles.length ? buildProfilverbundAssetSummary(profiles).mergedTranches : null;
    const loaded = householdTranches === null ? loadTranchesFromStorage(storage) : { raw: null, tranches: [] };
    if (['corrupt', 'unavailable'].includes(loaded.status)) throw new ValidationError([{ fieldId: 'detailledTranches', message: 'Der Tranchenbestand ist fehlerhaft.', code: loaded.errorCode }]);
    // Ein Haushalt stellt die eindeutig profilzugeordneten Tranchen bereit; auch [] ist explizit.
    const tranches = householdTranches ? normalizeTrancheCollection(householdTranches, { mode: 'engine' }) : loaded.tranches || [];
    const trancheSource = { state: tranches.length ? TRANCHE_STATUS_STATES.VALID
        : loaded.raw || householdTranches ? TRANCHE_STATUS_STATES.EMPTY : TRANCHE_STATUS_STATES.NOT_LOADED,
        source: householdTranches ? 'override' : 'storage', tranches };
    const rawFields = Object.fromEntries(Object.entries(persistentState.balanceInputFields || {})
        .filter(([key]) => BALANCE_STORAGE_FIELD_IDS.includes(key) && (plan.status !== 'valid' || !BALANCE_PLAN_INPUT_KEYS.includes(key))));
    const fields = storedFields({ ...persistentState.inputs, ...(plan.status === 'valid' ? projectPlanToBalance(plan.entry.values) : {}) }, rawFields);
    fields.inflation = { value: String(readBalanceInflationSource({ storage, scope: plan.scope, referenceYear }).value), checked: false };
    const readerInputData = readStoredInputValues({ fields, storage, status, trancheSource, plan });
    const inputData = projectStoredHouseholdInputs(profiles, cloneBalanceState(readerInputData));
    if (Object.hasOwn(persistentState.inputs || {}, 'depotLastUpdate')) inputData.depotLastUpdate = persistentState.inputs.depotLastUpdate;
    const profileId = storage.getItem('rs_current_profile');
    const history = projectBalancePlanHistory(persistentState, profiles, plan, { profileId });
    const planInputs = plan.status === 'valid' ? projectPlanToBalance(plan.entry.values) : inputData;
    const multi = profiles.length > 1 || profiles.length === 1 && profiles[0].profileId !== profileId;
    const source = history.profiles.find(entry => entry.balanceState?.profilverbundHouseholdLastState)?.balanceState || history.persistentState;
    const lastState = prepareEngineLastState({ ...history.persistentState,
        inputs: { ...history.persistentState.inputs, ...history.persistentState.personInputEvidence } }, inputData, planInputs);
    const householdLastState = multi ? profiles.length === 1 ? prepareEngineLastState(history.profiles[0].balanceState || {}, inputData, planInputs)
        : prepareEngineLastState({ inputs: source.profilverbundHouseholdInputs, lastState: source.profilverbundHouseholdLastState }, inputData, planInputs) : null;
    const engineInput = { ...(multi && profiles.length === 1 ? buildStoredProfileEngineInput(inputData, history.profiles[0]) : inputData), finalizeThreeBucketAction: true, ...(multi && profiles.length > 1 ? { deferTaxSettlement: true } : {}) };
    const baseStateFingerprint = createBalanceCommitBaseFingerprint({ persistentState, profilverbundProfiles: multi ? profiles : [],
        householdPlan: plan.status === 'valid' ? { scope: plan.scope, values: plan.entry.values } : null });
    return { inputData, readerInputData, engineInput, lastState, householdLastState, engineLastState: multi ? householdLastState : lastState, persistentState,
        householdPlan: plan, scope: plan.scope, profiles: history.profiles, history, profileId,
        profileInputs: history.profiles.map(entry => ({ profileId: entry.profileId, lastState: cloneBalanceState(entry.balanceState?.lastState || null),
            inputData: buildStoredProfileEngineInput(inputData, entry) })),
        baseStateFingerprint, sourceFingerprint: createBalanceFingerprint({ profileId, scope: plan.scope, inputData, baseStateFingerprint,
            profiles: profiles.map(entry => ({ profileId: entry.profileId, inputs: entry.inputs, healthBucket: entry.healthBucket, tranches: entry.tranches })) }) };

}

export function buildStoredProfileEngineInput(sharedInput, entry) {
    const output = { ...sharedInput };
    for (const key of ['aktuellesAlter', 'tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'goldWert',
        'costBasisAlt', 'costBasisNeu', 'goldCost', 'tqfAlt', 'tqfNeu', 'renteAktiv', 'renteMonatlich',
        'kirchensteuerSatz', 'sparerPauschbetrag', 'goldAktiv', 'goldZielProzent', 'goldFloorProzent', 'goldSteuerfrei', 'rebalancingBand']) {
        if (Object.hasOwn(entry.inputs || {}, key)) output[key] = entry.inputs[key];
    }
    output.detailledTranches = entry.tranches || [];
    return output;
}
