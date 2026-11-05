import { HOUSEHOLD_CURRENT_LIMIT_MESSAGE } from '../../profile/profile-registry.js';
import { readSimulatorHouseholdPlan, projectPlanToSimulator } from '../../profile/household-plan.js';
import { buildProfileAssetRecord } from './tranches.js';
import { aggregateProfileHealthBuckets } from '../../profile/profile-state.js';
import { sumNumbers, moneyToCents, weightedAverage, maxNumber, ensureValueMatch, stableStringify } from './aggregate-values.js';
import { calculateProfileGoldStrategy } from '../../profile/profile-asset-values.js';
import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { careTodaySources } from './care.js';
import { SUPPORTED_PFLEGE_GRADES } from '../simulator-data.js';
import { normalizeCareForm } from '../../shared/care-benefits.js';
import { careTodayFromRecord } from '../../profile/profile-care.js';

/** @param {object[]} profileInputs
 * @param {string} primaryProfileId
 * @param {{planValues?: object}} [options]
 *
 * @returns Ergebnis der Operation.
 */
export function combineSimulatorProfiles(profileInputs, primaryProfileId, { planValues } = {}) {
    if (!Array.isArray(profileInputs) || profileInputs.length === 0) {
        return { combined: null, warnings: ['Keine Personen im Haushalt. Öffne „Personen verwalten“ in Personen & Vermögen.'] };
    }
    if (profileInputs.length > 2) throw new Error(HOUSEHOLD_CURRENT_LIMIT_MESSAGE(profileInputs.length));
    if (planValues === undefined) {
        const plan = readSimulatorHouseholdPlan();
        planValues = plan.status === 'valid' ? plan.entry.values : null;
    }
    if (planValues) {
        const projected = projectPlanToSimulator(planValues);
        profileInputs = profileInputs.map(entry => ({ ...entry, inputs: { ...entry.inputs, ...projected } }));
    }


    const inputsList = profileInputs.map(entry => entry.inputs);
    const warnings = [];
    const assetRecords = profileInputs.map(buildProfileAssetRecord);
    const corruptRecord = assetRecords.find(record => record.trancheState === 'corrupt');
    if (corruptRecord) {
        return {
            combined: null,
            errorCode: 'SIMULATOR_PROFILE_TRANCHES_CORRUPT',
            warnings: [`Tranchendaten fuer Profil ${corruptRecord.entry?.name || corruptRecord.entry?.profileId || 'unbekannt'} sind fehlerhaft.`]
        };
    }

    const hasDetailedRepresentation = assetRecords.some(record => record.hasDetailedRepresentation);
    const unprovenancedAggregate = hasDetailedRepresentation
        ? assetRecords.find(record => record.trancheState === 'absent' && record.aggregateInvestment > 0.01)
        : null;
    if (unprovenancedAggregate) {
        const profileName = unprovenancedAggregate.entry?.name
            || unprovenancedAggregate.entry?.profileId
            || 'unbekannt';
        return {
            combined: null,
            errorCode: 'SIMULATOR_PROFILE_ASSET_PROVENANCE_MISSING',
            warnings: [
                `Profil ${profileName} besitzt positive Depot- oder Geldmarkt-Aggregate ohne Detailtranchen. `
                + 'Der Hybridhaushalt wurde blockiert, weil Cost Basis und TQF nicht verlustfrei ableitbar sind.'
            ]
        };
    }

    const primaryEntry = profileInputs.find(entry => entry.profileId === primaryProfileId) || profileInputs[0];
    const primaryInputs = primaryEntry?.inputs;
    if (!primaryInputs) {
        return { combined: null, warnings: ['Keine gueltigen Profile gefunden.'] };
    }

    const mergedTranches = [];
    const usedTrancheIds = new Set();
    const normalizeTranche = (tranche, profileId, seq) => {
        const normalized = typeof structuredClone === 'function'
            ? structuredClone(tranche)
            : JSON.parse(JSON.stringify(tranche));
        const rawId = String(normalized.trancheId || normalized.id || '').trim();
        const baseId = rawId || `tranche_${seq}`;
        const prefixedId = `${profileId}:${baseId}`;
        if (usedTrancheIds.has(prefixedId)) {
            throw new Error(`Doppelte Tranche ${baseId} in Profil ${profileId}.`);
        }
        usedTrancheIds.add(prefixedId);
        normalized.trancheId = prefixedId;
        normalized.sourceProfileId = profileId;
        if (normalized.isin) normalized.isin = String(normalized.isin).trim();
        if (normalized.name) normalized.name = String(normalized.name).trim();
        if (normalized.type) normalized.type = String(normalized.type).trim();
        if (normalized.category) normalized.category = String(normalized.category).trim();
        return normalized;
    };
    const orderedEntries = [primaryEntry, ...profileInputs.filter(entry => entry !== primaryEntry)];
    const { healthBucket, configurationsDiffer: healthBucketSettingsDiffer } = aggregateProfileHealthBuckets(
        profileInputs.map(entry => entry.inputs.healthBucket)
    );
    orderedEntries.forEach(entry => {
        const input = entry?.inputs;
        if (Array.isArray(input?.detailledTranches)) {
            input.detailledTranches.forEach((tranche, idx) => {
                mergedTranches.push(normalizeTranche(tranche, entry.profileId || 'profil', idx));
            });
        }
    });
    Object.defineProperty(mergedTranches, 'simulationSourceProfileId', {
        value: primaryEntry.profileId || 'simulation',
        enumerable: false
    });

    const sumStartVermoegen = sumNumbers(assetRecords, record => record.assetTotal);
    const sumDepotwertAlt = sumNumbers(assetRecords, record => record.depotwertAlt);
    const sumTagesgeld = sumNumbers(assetRecords, record => record.tagesgeld);
    const sumGeldmarkt = sumNumbers(assetRecords, record => record.geldmarktEtf);
    const sumEinstandAlt = sumNumbers(assetRecords, record => record.einstandAlt);
    const sumFloor = sumNumbers(inputsList, i => i.startFloorBedarf || 0);
    const sumFlex = sumNumbers(inputsList, i => i.startFlexBedarf || 0);
    const invalidMinimumFlexEntry = profileInputs.find(entry => {
        const minimumFlexAnnual = Number(entry?.inputs?.minimumFlexAnnual ?? 0);
        const flexAnnual = Number(entry?.inputs?.startFlexBedarf ?? 0);
        return !Number.isFinite(minimumFlexAnnual)
            || minimumFlexAnnual < 0
            || !Number.isFinite(flexAnnual)
            || flexAnnual < 0
            || minimumFlexAnnual > flexAnnual + 0.01;
    });
    if (invalidMinimumFlexEntry) {
        const profileName = invalidMinimumFlexEntry.name
            || invalidMinimumFlexEntry.profileId
            || 'unbekannt';
        return {
            combined: null,
            errorCode: 'SIMULATOR_PROFILE_MINIMUM_FLEX_INVALID',
            warnings: [
                `minimumFlexAnnual fuer Profil ${profileName} muss eine nicht-negative Zahl sein und darf startFlexBedarf nicht ueberschreiten.`
            ]
        };
    }
    const sumMinimumFlex = sumNumbers(inputsList, i => i.minimumFlexAnnual || 0);
    if (sumMinimumFlex > sumFlex + 0.01) {
        return {
            combined: null,
            errorCode: 'SIMULATOR_HOUSEHOLD_MINIMUM_FLEX_INVALID',
            warnings: [
                `Die Summe minimumFlexAnnual (${sumMinimumFlex.toFixed(2)} EUR) darf den aggregierten startFlexBedarf (${sumFlex.toFixed(2)} EUR) nicht ueberschreiten.`
            ]
        };
    }
    const sumFlexBudgetAnnual = sumNumbers(inputsList, i => i.flexBudgetAnnual || 0);
    const sumFlexBudgetRecharge = sumNumbers(inputsList, i => i.flexBudgetRecharge || 0);
    const minFlexBudgetYears = inputsList.reduce((minVal, i) => {
        const years = Number(i.flexBudgetYears);
        if (!Number.isFinite(years) || years <= 0) return minVal;
        if (minVal === null) return years;
        return Math.min(minVal, years);
    }, null);

    const totalAssets = sumStartVermoegen || (sumDepotwertAlt + sumTagesgeld + sumGeldmarkt);
    const goldStrategy = calculateProfileGoldStrategy(assetRecords.map(record => ({
        profileId: record.entry?.profileId,
        name: record.entry?.name,
        assetBase: record.assetTotal,
        operativeLiquidity: record.operativeLiquidity,
        healthBucket: record.inputs.healthBucket,
        goldAktiv: record.inputs.goldAktiv,
        goldZielProzent: record.inputs.goldZielProzent,
        goldFloorProzent: record.inputs.goldFloorProzent,
        goldSteuerfrei: record.inputs.goldSteuerfrei,
        rebalancingBand: record.inputs.rebalancingBand
    })));

    const componentAssets = sumDepotwertAlt + sumTagesgeld + sumGeldmarkt;
    if (moneyToCents(totalAssets) < moneyToCents(componentAssets)) {
        warnings.push('Startvermoegen ist kleiner als die Summe aus Depot + Liquiditaet. Bitte Profile pruefen.');
    }

    const combined = {
        ...primaryInputs,
        ...(healthBucket?.enabled ? {
            healthBucket,
            healthBucketEnabled: true,
            healthBucketInitialAmount: healthBucket.initialAmount,
            healthBucketAssetSource: healthBucket.assetSource,
            healthBucketTriggerMinGrade: healthBucket.triggerMinGrade,
            healthBucketTriggerMode: healthBucket.triggerMode,
            healthBucketCoverageMode: healthBucket.coverageMode,
            healthBucketReturnMode: healthBucket.returnMode,
            healthBucketTargetMode: healthBucket.targetMode
        } : {}),
        startVermoegen: totalAssets,
        depotwertAlt: sumDepotwertAlt,
        tagesgeld: sumTagesgeld,
        geldmarktEtf: sumGeldmarkt,
        einstandAlt: sumEinstandAlt,
        zielLiquiditaet: sumTagesgeld + sumGeldmarkt,
        startFloorBedarf: sumFloor,
        startFlexBedarf: sumFlex,
        minimumFlexAnnual: sumMinimumFlex,
        minimumFlexProfiles: profileInputs.map(entry => ({
            profileId: entry.profileId,
            name: entry.name || entry.profileId,
            minimumFlexAnnual: Number(entry.inputs?.minimumFlexAnnual) || 0
        })),
        flexBudgetAnnual: sumFlexBudgetAnnual,
        flexBudgetRecharge: sumFlexBudgetRecharge,
        flexBudgetYears: minFlexBudgetYears || 0,
        detailledTranches: inputsList.some(i => Array.isArray(i.detailledTranches)) ? mergedTranches : null,
        ...(orderedEntries.some(entry => entry.inputs.plannedInflows?.length) ? {
            plannedInflows: orderedEntries.flatMap(entry => (entry.inputs.plannedInflows || []).map(inflow => ({
                ...inflow, profileId: entry.profileId }))),
            plannedInflowsReferenceYear: primaryInputs.plannedInflowsReferenceYear
                ?? orderedEntries.find(entry => entry.inputs.plannedInflows?.length)?.inputs.plannedInflowsReferenceYear
        } : {}),
        ...(orderedEntries.some(entry => entry.inputs.home?.length) ? { home: orderedEntries.flatMap(entry => (entry.inputs.home || []).map(home => ({ ...home, profileId: entry.profileId }))) } : {}),
        simulationSourceProfileId: primaryEntry.profileId || 'simulation',
        ...(orderedEntries.some(entry => entry.inputs.fixedIncome?.length) ? {
            fixedIncome: orderedEntries.flatMap(entry => (entry.inputs.fixedIncome || []).map(income => ({ ...income,
                id: `${entry.profileId}:${income.id}`, profileId: entry.profileId }))),
            fixedIncomeReferenceYear: primaryInputs.fixedIncomeReferenceYear
                ?? orderedEntries.find(entry => entry.inputs.fixedIncome?.length)?.inputs.fixedIncomeReferenceYear
        } : {}),
        simulationPeople: orderedEntries.map(entry => ({ profileId: entry.profileId, name: entry.name || entry.profileId,
            ...(entry.inputs.residenceGenderUnknown ? { residenceGenderUnknown: true } : {}),
            tagesgeld: Math.max(0, Number(entry.inputs.tagesgeld) || 0),
            sparerPauschbetrag: Math.max(0, Number(entry.inputs.startSPB) || 0),
            taxState: { lossCarry: Math.max(0, Number(entry.inputs.taxState?.lossCarry) || 0) },
            kirchensteuerSatz: Number(entry.inputs.kirchensteuerSatz) || 0,
            liquidityRunwayYears: resolveLiquidityRunwayYears(entry.inputs).years })),
        startSPB: sumNumbers(inputsList, i => i.startSPB || 0),
        kirchensteuerSatz: weightedAverage(inputsList, i => i.kirchensteuerSatz || 0, i => i.startVermoegen || 0, primaryInputs.kirchensteuerSatz || 0),
        maxSkimPctOfEq: Math.round(weightedAverage(inputsList, i => i.maxSkimPctOfEq || 0, i => i.startVermoegen || 0, primaryInputs.maxSkimPctOfEq || 0)),
        maxBearRefillPctOfEq: Math.round(weightedAverage(inputsList, i => i.maxBearRefillPctOfEq || 0, i => i.startVermoegen || 0, primaryInputs.maxBearRefillPctOfEq || 0)),
        goldAktiv: goldStrategy.goldAktiv,
        goldBasisVermoegen: goldStrategy.goldBasisVermoegen,
        goldZielBetrag: goldStrategy.goldZielBetrag,
        goldFloorBetrag: goldStrategy.goldFloorBetrag,
        goldZielProzent: goldStrategy.goldZielProzent,
        goldFloorProzent: goldStrategy.goldFloorProzent,
        goldSteuerfrei: goldStrategy.goldSteuerfrei,
        rebalancingBand: goldStrategy.rebalancingBand,
        goldStrategyDiagnostics: goldStrategy.diagnostics,
        liquidityRunwayYears: maxNumber(
            inputsList,
            i => resolveLiquidityRunwayYears(i).years,
            resolveLiquidityRunwayYears(primaryInputs).years
        ),
        accumulationPhase: {
            enabled: false,
            durationYears: 0,
            sparrate: 0,
            sparrateIndexing: 'none'
        },
        transitionYear: 0,
        transitionAge: primaryInputs.startAlter
    };

    if (!ensureValueMatch(inputsList, i => i.rentAdjMode)) {
        warnings.push('Rentenanpassung (Mode) unterscheidet sich zwischen Profilen. Es wird das Hauptprofil verwendet.');
    }
    if (!ensureValueMatch(inputsList, i => i.stressPreset)) {
        warnings.push('Stress-Preset unterscheidet sich zwischen Profilen. Es wird das Hauptprofil verwendet.');
    }
    if (!ensureValueMatch(inputsList, i => i.pflegeModellTyp)) {
        warnings.push('Pflege-Modell unterscheidet sich zwischen Profilen. Es wird das Hauptprofil verwendet.');
    }
    if (!healthBucket?.enabled && !ensureValueMatch(inputsList, i => stableStringify(i.healthBucket || null))) {
        // Ohne aktivierte Rücklage bleibt auch die bisherige Warnung bytegleich.
        warnings.push('Pflegebucket-Konfiguration unterscheidet sich zwischen Profilen. Es wird das Hauptprofil verwendet.');
    } else if (healthBucket?.enabled && healthBucketSettingsDiffer) {
        warnings.push('Pflegebucket-Konfiguration unterscheidet sich zwischen Profilen. Die Einstellungen der ersten Person mit aktivierter Rücklage werden verwendet; die Beträge werden summiert.');
    }
    // Dynamic-Flex-Parameter werden im Simulator explizit aus den aktuellen Rahmendaten
    // gelesen und nicht aus Profil-Differenzen im Profilverbund abgeleitet.

    const secondaryEntry = profileInputs.find(entry => entry.profileId !== primaryEntry.profileId) || null;
    const secondaryInputs = secondaryEntry?.inputs || null;
    const secondaryData = secondaryEntry?.profileData || secondaryEntry?.data || careTodaySources.get(secondaryInputs?.careToday);
    const primaryCareSettings = { preset: primaryInputs.pflegeKostenStaffelPreset, forms: Object.fromEntries(
        SUPPORTED_PFLEGE_GRADES.map(grade => [grade, normalizeCareForm(primaryInputs.pflegeGradeConfigs?.[grade]?.careForm, grade)])) };
    const partnerCare = secondaryData ? careTodayFromRecord(secondaryData, primaryCareSettings) : secondaryInputs?.careToday;
    const totalRente = sumNumbers(profileInputs, entry => entry.inputs?.renteMonatlich || 0);
    const partnerRente = secondaryInputs ? (secondaryInputs.renteMonatlich || 0) : 0;
    const p1Rente = Math.max(0, totalRente - partnerRente);

    const partner = secondaryInputs ? {
        ...(partnerCare?.grade ? { careToday: partnerCare } : {}),
        aktiv: true,
        geschlecht: secondaryInputs.geschlecht || 'w',
        startAlter: secondaryInputs.startAlter || 0,
        startInJahren: secondaryInputs.renteStartOffsetJahre || 0,
        renteStartMonate: secondaryInputs.renteStartMonate ?? 12, renteKalenderbeginn: secondaryInputs.renteKalenderbeginn ?? false,
        monatsrente: partnerRente,
        sparerPauschbetrag: secondaryInputs.startSPB || 0,
        kirchensteuerPct: (secondaryInputs.kirchensteuerSatz || 0) * 100,
        steuerquotePct: secondaryInputs.steuerquotePct ?? 0,
        brutto: partnerRente * 12
    } : {
        ...combined.partner,
        aktiv: false,
        monatsrente: 0,
        brutto: 0
    };

    const merged = {
        ...combined,
        startAlter: primaryInputs.startAlter || combined.startAlter,
        geschlecht: primaryInputs.geschlecht || combined.geschlecht,
        renteMonatlich: p1Rente,
        renteStartOffsetJahre: primaryInputs.renteStartOffsetJahre || 0,
        renteStartMonate: primaryInputs.renteStartMonate ?? 12, renteKalenderbeginn: primaryInputs.renteKalenderbeginn ?? false,
        rentAdjMode: primaryInputs.rentAdjMode || combined.rentAdjMode,
        rentAdjPct: Number.isFinite(primaryInputs.rentAdjPct) ? primaryInputs.rentAdjPct : combined.rentAdjPct,
        partner
    };


    if (planValues) {
        Object.assign(merged, projectPlanToSimulator(planValues));
        delete merged.minimumFlexProfiles;
    }
    return { combined: merged, warnings };
}
