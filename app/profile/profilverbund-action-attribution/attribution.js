// @ts-check
/**
 * Module: Profilverbund Action Attribution
 * Purpose: Attributes one finalized household action to profile-owned sources without
 *          allowing profile-level engines to create new transaction purposes.
 */
"use strict";

import { previewTermsScope, rawAggregateForSources, householdSettlements, allocateSettlementTaxToSources, addRawAggregate, setPreviewTermsScope } from './tax.js';
import { normalizeUses, sumUses, hasFiniteValue, TOLERANCE_EUR, isLiquiditySource, finiteNumber, sum, EPSILON, allocateCentsByWeights, actionAmountsChanged } from './amounts.js';
import { allocateLiquiditySources } from './liquidity.js';
import { planAssetSources } from './asset-plan.js';
import { reconcileUsesToAchievedNet } from '../../../engine/transactions/three-bucket-logic.mjs';
import { netActionEntries, sumPersonalActions } from '../../../engine/transactions/net-action.mjs';

/** @param {Parameters<typeof attributeHouseholdActionScoped>[0]} options @returns {import("../../../typcheck/profile-ui.js").AttributionResult} */
export function attributeHouseholdAction(options) {
    const outerScope = previewTermsScope;
    setPreviewTermsScope(new Map());
    try {
        return attributeHouseholdActionScoped(options);
    } finally {
        setPreviewTermsScope(outerScope);
    }
}

function attributeHouseholdActionScoped({ householdAction, profiles, mode = 'tax_optimized', jointAssessment = false }) {
    const profileList = Array.isArray(profiles) ? (jointAssessment && profiles.length === 2
        ? profiles.map(profile => ({ ...profile, inputs: { ...profile.inputs, jointAssessment: true } })) : profiles) : [];
    if (profileList.length < 2) {
        throw new Error('Profilverbund: Haushaltsattribution erfordert mindestens zwei Profile.');
    }
    const profileById = new Map(profileList.map(profile => [profile.profileId, profile]));
    if (profileById.size !== profileList.length || profileById.has(undefined) || profileById.has(null)) {
        throw new Error('Profilverbund: Profile besitzen keine eindeutige Profil-ID.');
    }

    let uses = normalizeUses(householdAction?.verwendungen || {});
    let targetNet = sumUses(uses);
    const originalSources = Array.isArray(householdAction?.quellen) ? householdAction.quellen : [];
    originalSources.forEach(source => {
        if (!hasFiniteValue(source?.brutto) || Number(source.brutto) < -TOLERANCE_EUR) {
            throw new Error('Profilverbund: Quelle besitzt keinen gueltigen nichtnegativen Bruttobetrag.');
        }
    });
    const cashTotal = originalSources
        .filter(isLiquiditySource)
        .reduce((total, source) => total + Math.max(0, finiteNumber(source?.brutto)), 0);
    const cashSources = allocateLiquiditySources(cashTotal, profileList, mode);
    const assetSources = originalSources
        .filter(source => !isLiquiditySource(source) && finiteNumber(source?.brutto) > 0)
        .map(source => {
            const sourceProfileId = source?.sourceProfileId;
            if (!sourceProfileId || !profileById.has(sourceProfileId)) {
                throw new Error('Profilverbund: Verkaufstranche besitzt keine eindeutige sourceProfileId.');
            }
            const hasRealizedRaw = hasFiniteValue(source?.realizedGainSigned) || hasFiniteValue(source?.gainQuoteSigned) || hasFiniteValue(source?.gainQuotePlan);
            const hasTaxableRaw = hasFiniteValue(source?.taxableAfterTqfSigned) || (hasRealizedRaw && hasFiniteValue(source?.tqf));
            if (!hasRealizedRaw || !hasTaxableRaw) {
                throw new Error('Profilverbund: Verkaufstranche besitzt keine vollstaendigen Steuer-Rohdaten.');
            }
            return { ...source, sourceProfileId, brutto: Math.max(0, finiteNumber(source.brutto)) };
        });

    const assetTargetNet = targetNet - cashTotal;
    if (assetTargetNet < -TOLERANCE_EUR) {
        throw new Error(`Profilverbund: Liquiditaetsquellen uebersteigen die Haushaltsverwendungen um ${Math.abs(assetTargetNet).toFixed(2)} EUR.`);
    }
    if (targetNet <= TOLERANCE_EUR && assetSources.some(source => source.brutto > TOLERANCE_EUR)) {
        throw new Error('Profilverbund: Verkaufsquellen besitzen keine verbindliche Haushaltsverwendung.');
    }
    const assetPlan = planAssetSources(assetSources, profileList, mode, Math.max(0, assetTargetNet), cashSources);
    const additionalCash = sum((assetPlan.extraCash || []).map(source => source.brutto));
    // Existing cash already belongs to liquidity: cancel that part of the
    // requested top-up instead of inventing a cash-funded liquidity inflow.
    let liquidityOffset = Math.min(uses.liquiditaet, additionalCash);
    uses.liquiditaet -= liquidityOffset;
    targetNet -= liquidityOffset;
    for (const source of assetPlan.extraCash || []) {
        const offset = Math.min(liquidityOffset, source.brutto);
        liquidityOffset -= offset;
        if (source.brutto > offset) cashSources.push({ ...source,
            brutto: source.brutto - offset, netto: source.netto - offset });
    }
    if (assetPlan.shortfall > EPSILON) {
        // Same capped-use reconciliation as the Engine's limited bond sale.
        // Simulator payout/floor checks then handle the remaining financial gap.
        uses = reconcileUsesToAchievedNet(uses, Math.max(0, targetNet - assetPlan.shortfall), 0);
        targetNet = sumUses(uses);
    }
    const assetScale = assetPlan.scale;
    const scaledAssetSources = assetPlan.sources;
    const scaledByProfile = new Map(profileList.map(profile => [profile.profileId, []]));
    scaledAssetSources.forEach(source => scaledByProfile.get(source.sourceProfileId).push(source));

    const rawByProfile = new Map(profileList.map(profile => [profile.profileId,
        rawAggregateForSources(scaledByProfile.get(profile.profileId), 1)]));
    const assessed = householdSettlements(profileList, rawByProfile);
    const settlements = profileList.map((profile, index) => {
        const rawAggregate = rawAggregateForSources(scaledByProfile.get(profile.profileId), 1);
        const settlement = assessed[index];
        const sources = allocateSettlementTaxToSources(scaledByProfile.get(profile.profileId), settlement.taxDue);
        return {
            profileId: profile.profileId,
            rawAggregate,
            taxDue: settlement.taxDue,
            taxStateNext: settlement.taxStateNext,
            details: settlement.details,
            sources
        };
    });
    const settlementByProfile = new Map(settlements.map(settlement => [settlement.profileId, settlement]));

    cashSources.forEach(source => {
        settlementByProfile.get(source.sourceProfileId).sources.unshift(source);
    });
    const finalSources = settlements.flatMap(settlement => settlement.sources);
    const finalNet = sum(finalSources.map(source => source.netto));
    const netDifference = finalNet - targetNet;
    if (Math.abs(netDifference) > TOLERANCE_EUR) {
        throw new Error(`Profilverbund: Quellen und Verwendungen weichen um ${Math.abs(netDifference).toFixed(2)} EUR voneinander ab.`);
    }
    if (Math.abs(netDifference) > 1e-7) {
        // Persönliche Steuer und Verkaufsgrenzen bleiben exakt. Reicht der
        // Liquiditätszugang nicht, sinken die Käufe in dieser Reihenfolge.
        let remaining = netDifference;
        for (const key of ['liquiditaet', 'bonds', 'aktien', 'gold']) {
            if (remaining === 0) break;
            const adjustment = Math.max(-uses[key], remaining);
            if (adjustment === 0) continue;
            uses[key] += adjustment;
            remaining -= adjustment;
        }
        if (Math.abs(remaining) > 1e-7) throw new Error(`Profilverbund: Cent-Rest von ${remaining} EUR kann keiner Verwendung zugeordnet werden.`);
    }
    const profileNetWeights = settlements.map(settlement => sum(settlement.sources.map(source => source.netto)));
    const usesByProfile = settlements.map(() => ({}));
    Object.entries(uses).forEach(([key, amount]) => {
        const allocations = allocateCentsByWeights(amount, settlements, (_, index) => profileNetWeights[index]);
        allocations.forEach((allocation, index) => { usesByProfile[index][key] = allocation; });
    });
    // Zuerst jede Spaltensumme erhalten, dann persönliche Rundungsüberhänge
    // innerhalb derselben Verwendung verschieben. Jeder Verkäufer trägt so
    // seine eigenen Centbruchteile; der Haushalt bleibt in jedem Posten gleich.
    const residual = index => profileNetWeights[index] - sumUses(usesByProfile[index]);
    for (const [key, amount] of Object.entries(uses)) {
        const difference = amount - sum(usesByProfile.map(row => row[key]));
        if (Math.abs(difference) <= 1e-7) continue;
        const candidates = settlements.map((_, index) => index)
            .filter(index => profileNetWeights[index] > 0 && usesByProfile[index][key] + difference >= 0)
            .sort((a, b) => Math.sign(difference) * (residual(b) - residual(a)) || a - b);
        if (!candidates.length) throw new Error('Profilverbund: Persönlicher Cent-Rest kann keiner Verwendung zugeordnet werden.');
        usesByProfile[candidates[0]][key] += difference;
    }
    for (let receiver = 0; receiver < settlements.length; receiver++) {
        for (let donor = 0; donor < settlements.length && residual(receiver) > 1e-7; donor++) {
            if (residual(donor) >= -1e-7) continue;
            for (const key of ['liquiditaet', 'bonds', 'aktien', 'gold', ...Object.keys(uses)]) {
                const transfer = Math.min(Math.max(0, residual(receiver)), Math.max(0, -residual(donor)), usesByProfile[donor][key]);
                if (!(transfer > 0)) continue;
                usesByProfile[donor][key] -= transfer;
                usesByProfile[receiver][key] += transfer;
            }
        }
    }
    if (settlements.some((_, index) => Math.abs(residual(index)) > 1e-7))
        throw new Error('Profilverbund: Persönliche Quellen und Verwendungen bleiben nach dem Cent-Ausgleich unausgeglichen.');

    const profileActions = settlements.map((settlement, index) => {
        const sources = settlement.sources;
        const profileNet = sum(sources.map(source => source.netto));
        const profileUses = usesByProfile[index];
        const material = profileNet > TOLERANCE_EUR || sumUses(profileUses) > TOLERANCE_EUR;
        return {
            profileId: settlement.profileId,
            action: {
                ...householdAction,
                type: material ? 'TRANSACTION' : 'NONE',
                title: material ? 'Profilverbund-Transaktionen' : 'Kein Handlungsbedarf',
                anweisungKlasse: material ? 'anweisung-gelb' : 'anweisung-gruen',
                nettoErlös: profileNet,
                steuer: settlement.taxDue,
                quellen: sources,
                verwendungen: profileUses,
                taxRawAggregate: { ...settlement.rawAggregate },
                taxSettlement: { ...settlement.details },
                taxSettlementDeferred: false,
                bruttoVerkaufGesamt: sum(sources.filter(source => !isLiquiditySource(source)).map(source => source.brutto)),
                steuerPlanGesamt: settlement.taxDue,
                nettoErlösPlan: profileNet,
                taxCashAdjustment: 0,
                sourceProfileId: settlement.profileId
            },
            taxStateNext: settlement.taxStateNext
        };
    });

    const finalTax = sum(settlements.map(settlement => settlement.taxDue));
    const rawAggregate = settlements.reduce(
        (aggregate, settlement) => addRawAggregate(aggregate, settlement.rawAggregate),
        { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 }
    );
    const transactionDiagnostics = householdAction?.transactionDiagnostics
        ? {
            ...householdAction.transactionDiagnostics,
            selectedTranches: finalSources
                .filter(source => !isLiquiditySource(source))
                .map(source => ({
                    kind: source.kind,
                    name: source.name || null,
                    trancheId: source.trancheId || null,
                    sourceProfileId: source.sourceProfileId,
                    brutto: source.brutto,
                    steuer: source.steuer,
                    taxPerEuro: source.brutto > 0 ? source.steuer / source.brutto : 0
                }))
        }
        : undefined;
    if (transactionDiagnostics && actionAmountsChanged(householdAction, { quellen: finalSources, steuer: finalTax,
        nettoErlös: finalNet, verwendungen: uses })) {
        const trade = transactionDiagnostics.potentialTrade || {};
        transactionDiagnostics.potentialTrade = { ...trade, netAmount: finalNet,
            liquidityUse: uses.liquiditaet, goldUse: uses.gold, equityUse: uses.aktien,
            ...(Object.hasOwn(trade, 'bondUse') ? { bondUse: uses.bonds } : {}) };
    }
    const finalTaxSettlement = {
        profilverbund: true,
        taxAfterLossCarry: finalTax,
        profiles: settlements.map(settlement => ({
            profileId: settlement.profileId,
            taxDue: settlement.taxDue,
            taxStateNext: settlement.taxStateNext,
            details: settlement.details
        }))
    };

    const finalAction = {
        ...householdAction,
        type: targetNet > TOLERANCE_EUR ? 'TRANSACTION' : (householdAction?.type || 'NONE'),
        title: targetNet > TOLERANCE_EUR ? 'Profilverbund-Transaktionen' : (householdAction?.title || 'Kein Handlungsbedarf'),
        anweisungKlasse: targetNet > TOLERANCE_EUR ? 'anweisung-gelb' : (householdAction?.anweisungKlasse || 'anweisung-gruen'),
        nettoErlös: finalNet,
        steuer: finalTax,
        quellen: finalSources,
        verwendungen: uses,
        bruttoVerkaufGesamt: sum(finalSources.filter(source => !isLiquiditySource(source)).map(source => source.brutto)),
        steuerPlanGesamt: finalTax,
        nettoErlösPlan: finalNet,
        taxCashAdjustment: 0,
        taxRawAggregate: rawAggregate,
        taxSettlement: finalTaxSettlement,
        taxSettlementDeferred: false,
        taxSettlements: settlements.map(settlement => ({
            profileId: settlement.profileId,
            taxDue: settlement.taxDue,
            taxStateNext: settlement.taxStateNext,
            details: settlement.details
        })),
        ...(transactionDiagnostics ? { transactionDiagnostics } : {}),
        ...(assetPlan.fundingGap > TOLERANCE_EUR ? { personalTaxFunding: {
            gap: assetPlan.fundingGap, cash: additionalCash,
            shortfall: assetPlan.shortfall,
            reason: assetPlan.shortfall > EPSILON
                ? 'Profilsteuern: Verfügbare Mittel reichen nicht; Auffüllung und Käufe begrenzt.'
                : 'Profilsteuern: Zusätzliche Deckung aus vorhandenen Haushaltsmitteln.'
        } } : {}),
        attributionMode: mode
    };

    if (!Object.hasOwn(householdAction.verwendungen || {}, 'bonds')) return { finalAction, profileActions, settlements, assetScale };
    // FR-63 gilt je Person, bevor deren Steuerzustand gespeichert wird.
    const net = /** @type {<T extends import("../../../typcheck/balance-ui.js").ActionEntry>(entries: T[], jointAssessment?: boolean)=>(T & {taxStateNext?: import("../../../typcheck/rechenkern.js").TaxState, cashSplit?: unknown})[]} */ (netActionEntries)(profileActions.map(entry => ({ ...entry,
        input: { ...profileList.find(profile => profile.profileId === entry.profileId).inputs,
            taxStatePrev: { lossCarry: entry.action.taxSettlement.lossCarryStart } }
    })), jointAssessment);
    if (net.some((entry, index) => entry.action !== profileActions[index].action)) {
        const nextSettlements = net.map((entry, index) => ({ ...settlements[index],
            taxDue: entry.action.steuer, taxStateNext: entry.taxStateNext,
            rawAggregate: entry.action.taxRawAggregate, details: entry.action.taxSettlement, sources: entry.action.quellen }));
        const nextAction = sumPersonalActions(finalAction, net);
        nextAction.taxSettlement = { ...finalTaxSettlement, taxAfterLossCarry: nextAction.steuer,
            profiles: nextSettlements.map(({ profileId, taxDue, taxStateNext, details }) => ({ profileId, taxDue, taxStateNext, details })) };
        nextAction.taxSettlements = nextAction.taxSettlement.profiles;
        nextAction.bruttoVerkaufGesamt = sum(nextAction.quellen.filter(source => !isLiquiditySource(source)).map(source => source.brutto));
        nextAction.steuerPlanGesamt = nextAction.steuer; nextAction.nettoErlösPlan = nextAction.nettoErlös;
        return { finalAction: nextAction, profileActions: net.map(({ input, cashSplit, ...entry }) => entry), settlements: nextSettlements, assetScale };
    }
    return { finalAction, profileActions, settlements, assetScale };
}
