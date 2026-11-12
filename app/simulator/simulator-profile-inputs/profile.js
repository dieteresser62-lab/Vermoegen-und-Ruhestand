import { localCalendarDate } from '../../shared/app-clock.js';
import { resolveCarePrices } from '../../shared/care-prices.js';
import { careReference } from '../../shared/care-needs.js';
import { sharesHouseholdCareValues } from '../../shared/care-profile-settings.js';
/** @import {StorageReader} from '../../../typcheck/runtime-contracts.js' */
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { migrateCareDefaultsRecord } from '../simulator-care-flex.js';
import { readSimulatorHouseholdPlan, assertPlanValues, SIMULATOR_LEGACY_PLAN_FIELDS, projectPlanToSimulatorProfile } from '../../profile/household-plan.js';
import { parseStoredBalanceInputsFromData, parseProfileOverridesFromData, parseProfileHealthBucketFromData, PROFILE_VALUE_KEYS, parseStoredBalanceStateFromData } from '../../profile/profile-state.js';
import { readCareValues, officialCareCosts, careValuesInputPatch } from '../../shared/household-care-values.js';
import { parsePflegeGradeConfigs, careTodaySources } from './care.js';
import { SUPPORTED_PFLEGE_GRADES } from '../simulator-data.js';
import { parseDetailledTranches, sumTrancheTotals } from './tranches.js';
import { readNumber, readBool, simKey, normalizeDynamicFlexHorizonMethod, readString, DYNAMIC_FLEX_DEFAULTS, clamp, readValue, normalizeDecumulationMode, readInt, parseWidowOptions, readPositiveBalanceNeed } from './values.js';
import { simulatorOneTimeIncome, effectiveIncomeFromRecord } from '../../profile/profile-income.js';
import { readImmobilien, IMMOBILIEN_KEY } from '../../profile/profile-immobilien.js';
import { projectPerson, personReferenceYear, personGenderAssumed, personBirthYear } from '../../profile/profile-person-data.js';
import { careTodayFromRecord } from '../../profile/profile-care.js';
import { normalizeLongevityMode, LONGEVITY_DEFAULTS } from '../dynamic-flex-longevity-contract.js';
import { STRATEGY_OPTIONS } from '../../../types/strategy-options.js';
import { normalizeCareCostDriftPercent } from '../simulator-input-care.js';
import { survivorFloorPercent, survivorFlexPercent } from '../simulator-survivor.js';
import { residentialOwnExpensesInputPatch } from '../simulator-residential-care.js';
import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';

/** @param {Record<string, string>} profileData
 * @param {{referenceYear?: number, planValues?: object, storage?: StorageReader, profileId?: string}} [options]
 *   `profileId` nennt den Preisbesitzer: Haushaltsmitglieder lesen den gemeinsamen Preisblock, Außenpersonen ihre
 *   eigene `sim_`-Staffel (Gutachten PFA-2, Befund 5); ohne Angabe gilt das geöffnete Profil.
 *
 * @returns Ergebnis der Operation.
 */
export function buildSimulatorInputsFromProfileData(profileData, { referenceYear, planValues, storage = persistenceStorage, profileId } = {}) {
    profileData = migrateCareDefaultsRecord(profileData);
    if (planValues === undefined) {
        const plan = readSimulatorHouseholdPlan();
        planValues = plan.status === 'valid' ? plan.entry.values : null;
    }
    if (planValues) {
        assertPlanValues(planValues);
        const excluded = new Set([...SIMULATOR_LEGACY_PLAN_FIELDS.map(key => `sim_${key}`), 'decumulation']);
        profileData = Object.fromEntries(Object.keys(profileData).filter(key => !excluded.has(key)).map(key => [key, profileData[key]]));
    }
    // Balance-App Inputs (falls vorhanden) liefern Defaults für fehlende Simulator-Werte.
    const balanceInputs = parseStoredBalanceInputsFromData(profileData);
    const careValues = readCareValues(storage);
    // FR-73 P8: Preise aus dem Pflegewerte-Record, alte sim_-Beträge nur lesend als Altbestand; Außenpersonen behalten ihre Staffel.
    const shared = profileId === undefined ? sharesHouseholdCareValues(storage) : sharesHouseholdCareValues(storage, profileId);
    const careCosts = resolveCarePrices(careValues, profileData, { shared });
    const pflegeGradeConfigs = parsePflegeGradeConfigs(profileData, careCosts.costs);
    if (profileData.sim_pflegeKostenStaffelPreset === 'amtlich') {
        const costs = officialCareCosts(careValues);
        for (const grade of SUPPORTED_PFLEGE_GRADES) pflegeGradeConfigs[grade].zusatz = costs[grade];
    }
    const trancheInput = parseDetailledTranches(profileData);
    const detailedTranches = trancheInput.tranches;
    const trancheTotals = sumTrancheTotals(detailedTranches);
    const grade1Config = pflegeGradeConfigs[1] || { zusatz: 0, flexCut: 1 };
    const overrides = parseProfileOverridesFromData(profileData);
    const healthBucket = parseProfileHealthBucketFromData(profileData);
    const goldOverrides = {
        goldAktiv: overrides.profileGoldAktiv,
        goldZielProzent: overrides.profileGoldZiel,
        goldFloorProzent: overrides.profileGoldFloor,
        goldSteuerfrei: overrides.profileGoldSteuerfrei,
        rebalancingBand: overrides.profileGoldRebalBand
    };
    const hasProfileTagesgeld = Object.prototype.hasOwnProperty.call(profileData, PROFILE_VALUE_KEYS.tagesgeld);
    const profileTagesgeld = hasProfileTagesgeld ? readNumber(profileData, PROFILE_VALUE_KEYS.tagesgeld, 0) : 0;
    const hasProfileRenteAktiv = Object.prototype.hasOwnProperty.call(profileData, PROFILE_VALUE_KEYS.renteAktiv);
    const profileRenteAktiv = hasProfileRenteAktiv ? readBool(profileData, PROFILE_VALUE_KEYS.renteAktiv, false) : false;
    const profileRenteMonatlich = readNumber(profileData, PROFILE_VALUE_KEYS.renteMonatlich, 0);

    const plannedInflows = simulatorOneTimeIncome(profileData);
    const home = readImmobilien(profileData[IMMOBILIEN_KEY]);
    const fixedIncome = effectiveIncomeFromRecord(profileData).filter(entry => entry.art === 'sonstige');
    const person = projectPerson(profileData, referenceYear ?? personReferenceYear(null));
    // FR-75: Geburtsjahr für die Kohortensterbetafel (sonst Planungsjahr − Startalter).
    const birthYear = personBirthYear(profileData, referenceYear ?? personReferenceYear(null));
    const careToday = careTodayFromRecord(profileData);
    careTodaySources.set(careToday, profileData);
    const p1StartAlter = person.startAlter;
    const p1Geschlecht = person.geschlecht;
    const p1KirchensteuerPct = person.kirchensteuerSatz * 100;
    const rentAdjMode = person.rentAdjMode;
    const rentAdjPct = person.rentAdjPct;
    const dynamicFlex = readBool(profileData, simKey('dynamicFlex'), false);
    const horizonMethod = normalizeDynamicFlexHorizonMethod(
        readString(profileData, simKey('horizonMethod'), DYNAMIC_FLEX_DEFAULTS.HORIZON_METHOD)
    );
    const horizonYears = clamp(
        readNumber(profileData, simKey('horizonYears'), DYNAMIC_FLEX_DEFAULTS.HORIZON_YEARS),
        1,
        60
    );
    const survivalQuantile = clamp(
        readNumber(profileData, simKey('survivalQuantile'), DYNAMIC_FLEX_DEFAULTS.SURVIVAL_QUANTILE),
        0.5,
        0.99
    );
    const goGoActive = readBool(profileData, simKey('goGoActive'), false);
    const goGoMultiplier = clamp(
        readNumber(profileData, simKey('goGoMultiplier'), DYNAMIC_FLEX_DEFAULTS.GO_GO_MULTIPLIER),
        1.0,
        1.5
    );
    const longevityMode = normalizeLongevityMode(readString(profileData, simKey('longevityMode'), LONGEVITY_DEFAULTS.mode));
    const longevityQuantileShift = readNumber(profileData, simKey('longevityQuantileShift'), LONGEVITY_DEFAULTS.quantileShift);
    const longevityRelativePct = readNumber(profileData, simKey('longevityRelativePct'), LONGEVITY_DEFAULTS.relativePct);
    const longevityBufferYears = readNumber(profileData, simKey('longevityBufferYears'), LONGEVITY_DEFAULTS.bufferYears);
    const decumulationRaw = readValue(profileData, 'decumulation');
    const decumulationFromProfile = (decumulationRaw && typeof decumulationRaw === 'object') ? decumulationRaw : null;
    const decumulationMode = normalizeDecumulationMode(
        readString(profileData, simKey('entnahmeStrategie'),
            decumulationFromProfile?.mode || STRATEGY_OPTIONS.STANDARD)
    );
    const bondTargetFactor = readNumber(
        profileData,
        simKey('bondTargetFactor'),
        Number(decumulationFromProfile?.bondTargetFactor)
    );
    const drawdownTrigger = readNumber(
        profileData,
        simKey('drawdownTrigger'),
        Number(decumulationFromProfile?.drawdownTrigger)
    );
    const bondRefillThreshold = (() => {
        const simValue = readValue(profileData, simKey('bondRefillThreshold'));
        if (simValue === null || simValue === undefined || simValue === '') {
            const profileValue = decumulationFromProfile?.bondRefillThreshold;
            if (profileValue === null || profileValue === undefined || profileValue === '') return null;
            const n = Number(String(profileValue).replace(',', '.'));
            return Number.isFinite(n) ? Math.max(0, n) : null;
        }
        const n = Number(String(simValue).replace(',', '.'));
        return Number.isFinite(n) ? Math.max(0, n) : null;
    })();

    const goldAktivFromProfile = goldOverrides.goldAktiv;
    const goldAktiv = (typeof goldAktivFromProfile === 'boolean')
        ? goldAktivFromProfile
        : readBool(profileData, simKey('goldAllokationAktiv'), true);
    const goldZielProzent = Number.isFinite(goldOverrides.goldZielProzent)
        ? goldOverrides.goldZielProzent
        : readNumber(profileData, simKey('goldAllokationProzent'), 0);
    const goldFloorProzent = Number.isFinite(goldOverrides.goldFloorProzent)
        ? goldOverrides.goldFloorProzent
        : readNumber(profileData, simKey('goldFloorProzent'), 0);
    const goldSteuerfrei = (typeof goldOverrides.goldSteuerfrei === 'boolean')
        ? goldOverrides.goldSteuerfrei
        : readBool(profileData, simKey('goldSteuerfrei'), false);
    const rebalancingBand = Number.isFinite(goldOverrides.rebalancingBand)
        ? goldOverrides.rebalancingBand
        : readNumber(profileData, simKey('rebalancingBand'), 25);

    const simTagesgeld = readNumber(profileData, simKey('tagesgeld'), 0);
    // Profil-Tagesgeld (Balance) überschreibt Simulator-Tagesgeld, falls gesetzt.
    const tagesgeld = hasProfileTagesgeld ? profileTagesgeld : simTagesgeld;
    const baseInputs = {
        ...(careToday.grade ? { careToday, ...careReference(localCalendarDate(), person.referenceYear) } : {}),
        startVermoegen: readNumber(profileData, simKey('simStartVermoegen'), 0),
        depotwertAlt: readNumber(profileData, simKey('depotwertAlt'), 0),
        tagesgeld,
        geldmarktEtf: readNumber(profileData, simKey('geldmarktEtf'), 0),
        einstandAlt: readNumber(profileData, simKey('einstandAlt'), 0),
        zielLiquiditaet: tagesgeld + readNumber(profileData, simKey('geldmarktEtf'), 0),
        startFloorBedarf: readNumber(profileData, simKey('startFloorBedarf'), 0),
        startFlexBedarf: readNumber(profileData, simKey('startFlexBedarf'), 0),
        minimumFlexAnnual: readNumber(profileData, simKey('minimumFlexAnnual'), 0),
        flexBudgetAnnual: readNumber(profileData, simKey('flexBudgetAnnual'), 0),
        flexBudgetYears: readNumber(profileData, simKey('flexBudgetYears'), 0),
        flexBudgetRecharge: readNumber(profileData, simKey('flexBudgetRecharge'), 0),
        marketCapeRatio: readNumber(profileData, simKey('marketCapeRatio'), 0),
        capeRatio: readNumber(profileData, simKey('marketCapeRatio'), 0),
        dynamicFlex,
        horizonMethod,
        horizonYears,
        survivalQuantile,
        goGoActive,
        goGoMultiplier,
        longevityMode,
        longevityQuantileShift,
        longevityRelativePct,
        longevityBufferYears,
        risikoprofil: 'sicherheits-dynamisch',
        goldAktiv,
        goldZielProzent: goldAktiv ? goldZielProzent : 0,
        goldFloorProzent: goldAktiv ? goldFloorProzent : 0,
        rebalancingBand: goldAktiv ? rebalancingBand : 25,
        goldSteuerfrei: goldAktiv && goldSteuerfrei,
        startAlter: p1StartAlter,
        ...(birthYear !== null ? { geburtsjahr: birthYear } : {}),
        geschlecht: p1Geschlecht,
        ...(personGenderAssumed(profileData) ? { residenceGenderUnknown: true } : {}),
        startSPB: person.startSPB,
        taxState: { lossCarry: Math.max(0, Number(parseStoredBalanceStateFromData(profileData)?.lastState?.taxState?.lossCarry) || 0) },
        kirchensteuerSatz: p1KirchensteuerPct / 100,
        renteMonatlich: person.renteMonatlich,
        renteStartOffsetJahre: person.renteStartOffsetJahre,
        renteStartMonate: person.renteStartMonate, renteKalenderbeginn: person.renteKalenderbeginn,
        rentAdjMode,
        rentAdjPct,
        renteIndexierungsart: person.renteIndexierungsart,
        renteFesterSatz: person.renteFesterSatz,
        ...careValuesInputPatch(careValues),
        pflegefallLogikAktivieren: readBool(profileData, simKey('pflegefallLogikAktivieren'), false),
        pflegeModellTyp: readString(profileData, simKey('pflegeModellTyp'), 'kosten'),
        ...(readString(profileData, simKey('pflegeKostenStaffelPreset'), 'custom') === 'amtlich' ? { pflegeKostenStaffelPreset: 'amtlich' } : {}),
        pflegeGradeConfigs,
        pflegeStufe1Zusatz: grade1Config.zusatz,
        pflegeStufe1FlexCut: grade1Config.flexCut,
        pflegeMaxFloor: careCosts.maximumFloor,
        pflegeRampUp: readInt(profileData, simKey('pflegeRampUp'), 5),
        pflegeMinDauer: readInt(profileData, simKey('pflegeMinDauer'), 5),
        pflegeMaxDauer: readInt(profileData, simKey('pflegeMaxDauer'), 10),
        pflegeKostenDrift: normalizeCareCostDriftPercent(careCosts.driftPercent),
        pflegeRegionalZuschlag: readNumber(profileData, simKey('pflegeRegionalZuschlag'), 0) / 100,
        ...residentialOwnExpensesInputPatch(careCosts.ownExpensesMonthly),
        healthBucket,
        healthBucketEnabled: healthBucket.enabled,
        healthBucketInitialAmount: healthBucket.initialAmount,
        healthBucketAssetSource: healthBucket.assetSource,
        healthBucketTriggerMinGrade: healthBucket.triggerMinGrade,
        healthBucketTriggerMode: healthBucket.triggerMode,
        healthBucketCoverageMode: healthBucket.coverageMode,
        healthBucketReturnMode: healthBucket.returnMode,
        healthBucketTargetMode: healthBucket.targetMode,
        decumulation: {
            mode: decumulationMode,
            bondTargetFactor: Number.isFinite(bondTargetFactor) ? Math.max(0, bondTargetFactor) : null,
            drawdownTrigger: Number.isFinite(drawdownTrigger) ? drawdownTrigger : null,
            bondRefillThreshold
        },
        stressPreset: readString(profileData, simKey('stressPreset'), 'NONE'),
        referenceYear: person.referenceYear,
        steuerquotePct: person.steuerquotePct,
        partner: { aktiv: false },
        survivorFloorPercent: survivorFloorPercent(readValue(profileData, simKey('survivorFloorPercent'))),
        survivorFlexPercent: survivorFlexPercent(readValue(profileData, simKey('survivorFlexPercent'))),
        survivorMinimumFlexPercent: survivorFlexPercent(readValue(profileData, simKey('survivorMinimumFlexPercent')), 'Mindest-Flex'),
        widowOptions: parseWidowOptions(profileData)
    };


    const hasDetailedInput = Array.isArray(detailedTranches);
    if (hasDetailedInput) {
        const trancheSum = trancheTotals.equity + trancheTotals.gold + trancheTotals.moneyMarket;
        baseInputs.depotwertAlt = trancheTotals.equity;
        baseInputs.einstandAlt = trancheTotals.equityCost;
        baseInputs.geldmarktEtf = trancheTotals.moneyMarket;
        baseInputs.startVermoegen = trancheSum + (baseInputs.tagesgeld || 0);
        baseInputs.zielLiquiditaet = (baseInputs.tagesgeld || 0) + trancheTotals.moneyMarket;
    }

    // Floor/Flex/Mindest-Flex werden pro Profil in Balance gepflegt. Historische
    // sim_-Werte bleiben nur fuer Profile ohne Balance-Wert als Lesefallback erhalten.
    const balanceFloor = readPositiveBalanceNeed(balanceInputs, 'floorBedarf');
    const balanceFlex = readPositiveBalanceNeed(balanceInputs, 'flexBedarf');
    const balanceMinimumFlex = readPositiveBalanceNeed(balanceInputs, 'minimumFlexAnnual');
    if (balanceFloor !== null) baseInputs.startFloorBedarf = balanceFloor;
    if (balanceFlex !== null) baseInputs.startFlexBedarf = balanceFlex;
    if (balanceMinimumFlex !== null) baseInputs.minimumFlexAnnual = balanceMinimumFlex;
    if ((!baseInputs.flexBudgetAnnual || baseInputs.flexBudgetAnnual <= 0) && balanceInputs) {
        baseInputs.flexBudgetAnnual = Number(balanceInputs.flexBudgetAnnual) || baseInputs.flexBudgetAnnual;
    }
    if ((!baseInputs.flexBudgetYears || baseInputs.flexBudgetYears <= 0) && balanceInputs) {
        baseInputs.flexBudgetYears = Number(balanceInputs.flexBudgetYears) || baseInputs.flexBudgetYears;
    }
    if ((!baseInputs.flexBudgetRecharge || baseInputs.flexBudgetRecharge <= 0) && balanceInputs) {
        baseInputs.flexBudgetRecharge = Number(balanceInputs.flexBudgetRecharge) || baseInputs.flexBudgetRecharge;
    }
    if ((!baseInputs.marketCapeRatio || baseInputs.marketCapeRatio <= 0) && balanceInputs) {
        baseInputs.marketCapeRatio = Number(balanceInputs.marketCapeRatio) || baseInputs.marketCapeRatio;
        baseInputs.capeRatio = baseInputs.marketCapeRatio;
    }

    const storedRunway = {};
    const canonicalRunway = readValue(profileData, simKey('liquidityRunwayYears'));
    const legacyRunwayTarget = readValue(profileData, simKey('runwayTargetMonths'));
    const legacyRunwayMinimum = readValue(profileData, simKey('runwayMinMonths'));
    if (canonicalRunway !== null && canonicalRunway !== undefined && canonicalRunway !== '') {
        storedRunway.liquidityRunwayYears = canonicalRunway;
    }
    if (legacyRunwayTarget !== null && legacyRunwayTarget !== undefined && legacyRunwayTarget !== '') {
        storedRunway.runwayTargetMonths = legacyRunwayTarget;
    }
    if (legacyRunwayMinimum !== null && legacyRunwayMinimum !== undefined && legacyRunwayMinimum !== '') {
        storedRunway.runwayMinMonths = legacyRunwayMinimum;
    }
    const strategyInputs = {
        liquidityRunwayYears: resolveLiquidityRunwayYears(storedRunway).years,
        maxSkimPctOfEq: readInt(profileData, simKey('maxSkimPctOfEq'), 10),
        maxBearRefillPctOfEq: readInt(profileData, simKey('maxBearRefillPctOfEq'), 5)
    };

    // Alte vier Ansparschlüssel werden unverändert aufbewahrt und hier ignoriert.
    const accumulationPhase = { enabled: false, durationYears: 0, sparrate: 0, sparrateIndexing: 'none' };
    const transitionYear = 0;
    const transitionAge = p1StartAlter;

    return {
        ...baseInputs,
        ...(home.length ? { home } : {}),
        ...(fixedIncome.length ? { fixedIncome, fixedIncomeReferenceYear: referenceYear ?? personReferenceYear(null) } : {}),
        ...(plannedInflows.length ? {
            plannedInflows,
            plannedInflowsReferenceYear: referenceYear ?? personReferenceYear(null)
        } : {}),
        ...strategyInputs,
        accumulationPhase,
        transitionYear,
        transitionAge,
        detailledTranches: detailedTranches,
        trancheInputState: trancheInput.state,
        ...(planValues ? projectPlanToSimulatorProfile(planValues) : {})
    };
}
