/** @import {EngineInput, NormalizedEngineInput, Market, RunwayProfile, Needs, SaleContext, SaleLot, SaleResult, Action, ActionSource, ActionUses, ActionDetails, TransactionDiagnostics, TransactionParameters, TransactionHelpers, ActionEntry} from '../../typcheck/rechenkern' */
/**
 * Module: Three-Bucket Jilge Logic
 * Purpose: Provides shared logic for applying the 3-Bucket decumulation strategy
 *          (selling bonds instead of stocks during a market crash) to the standard
 *          engine output. Used by both Simulator and Balance App.
 */

import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { CONFIG } from '../config.mjs';
import { FinancialCalculationError } from '../errors.mjs';
import { calculateSaleAndTax } from './sale-engine.mjs';

const THREE_BUCKET_CFG = /** @type {Partial<typeof CONFIG.SPENDING_MODEL.THREE_BUCKET>} */ (CONFIG.SPENDING_MODEL?.THREE_BUCKET || {});

// FR-8: Prozentwerte am Eingang, Renditeverhältnis am Ausgang.
/** @param {number} nominalReturnPct
 * @param {number} inflationPct */
export function calculateRealEquityReturn(nominalReturnPct, inflationPct) {
    return ((Number(nominalReturnPct) || 0) - (Number(inflationPct) || 0)) / 100;
}

/**
 * Checks if an asset type or category is considered a bond.
 */
/** @param {unknown} category */
export function isBondCategory(category) {
    if (!category) return false;
    const catStr = String(category).toLowerCase();
    return catStr === 'anleihe' || catStr === 'bonds' || catStr.includes('bond');
}

/**
 * Normalizes input settings specifically for the 3-Bucket strategy.
 */

/** @param {Pick<EngineInput,"decumulation">|null|undefined} inputs */
export function getThreeBucketInputs(inputs) {
    const dec = (inputs?.decumulation && typeof inputs.decumulation === 'object') ? inputs.decumulation : {};
    const modeRaw = String(dec.mode || '').toLowerCase();
    const drawdownRaw = Number(dec.drawdownTrigger);

    // Normalize drawdown to negative, fallback to config
    const normalizedDrawdown = Number.isFinite(drawdownRaw)
        ? (drawdownRaw > 0 ? -drawdownRaw : drawdownRaw)
        : Number(THREE_BUCKET_CFG.DEFAULT_DRAWDOWN_TRIGGER ?? -15);

    const targetRaw = Number(dec.bondTargetFactor);
    const refillRaw = Number(dec.bondRefillThreshold);

    return {
        is3Bucket: modeRaw === STRATEGY_OPTIONS.THREE_BUCKET_JILGE,
        drawdownTrigger: normalizedDrawdown,
        bondTargetFactor: Number.isFinite(targetRaw) ? Math.max(0, targetRaw) : Number(THREE_BUCKET_CFG.DEFAULT_BOND_TARGET_FACTOR ?? 5),
        bondRefillThresholdPct: Number.isFinite(refillRaw) ? Math.max(0, refillRaw) : null,
        bondNominalReturn: Number(THREE_BUCKET_CFG.BOND_NOMINAL_RETURN ?? 0.02)
    };
}

/**
 * Sums the value of all bond tranches currently present.
 */
/** @param {readonly import('../../typcheck/rechenkern').EngineTranche[]|null|undefined} tranches */
export function sumBondBucketValuation(tranches) {
    return (tranches || []).reduce((sum, tranche) => {
        return sum + (isBondCategory(tranche.type) || isBondCategory(tranche.category) ? (Number(tranche.marketValue) || 0) : 0);
    }, 0);
}

/** @param {ActionSource} source */
function isLiquiditySource(source) {
    return String(source?.kind || '').toLowerCase() === 'liquiditaet';
}

/** @param {Action} action */
function nonLiquidSaleSources(action) {
    return (Array.isArray(action?.quellen) ? action.quellen : [])
        .filter(source => source?.kind && !isLiquiditySource(source) && (Number(source.brutto) || 0) > 0);
}


/** @param {Record<string,number>|undefined} verwendungen
 * @param {number} achievedNet */
export function reconcileUsesToAchievedNet(verwendungen, achievedNet, tolerance = 0.01) {
    if (!verwendungen || typeof verwendungen !== 'object' || Array.isArray(verwendungen)) {
        return verwendungen;
    }
    const entries = Object.entries(verwendungen);
    if (entries.some(([, value]) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return verwendungen;
    }
    const target = Math.max(0, Number(achievedNet) || 0);
    const requested = entries.reduce((total, [, value]) => total + value, 0);
    // Gerundete Anleihenverkäufe können mehr Netto liefern als angefordert.
    // Der Rest bleibt als Liquidität erhalten und gehört zum selben Action-Flow.
    if (target > requested + tolerance) return { ...verwendungen,
        liquiditaet: (verwendungen.liquiditaet || 0) + target - requested };
    if (requested <= target + tolerance) return { ...verwendungen };
    if (target === 0) {
        return Object.fromEntries(entries.map(([key]) => [key, 0]));
    }

    const positiveIndices = entries
        .map(([, value], index) => (value > 0 ? index : -1))
        .filter(index => index >= 0);
    const lastPositiveIndex = positiveIndices.at(-1);
    const factor = target / requested;
    let allocated = 0;
    return Object.fromEntries(entries.map(([key, value], index) => {
        if (value <= 0) return [key, 0];
        const scaled = index === lastPositiveIndex
            ? Math.max(0, target - allocated)
            : value * factor;
        allocated += scaled;
        return [key, scaled];
    }));
}

/** @param {{trancheId?:string|null;sourceProfileId?:string|null}} entry */
function lotReservationKey(entry) {
    const trancheId = String(entry?.trancheId || '').trim();
    if (!trancheId) return null;
    return JSON.stringify([String(entry?.sourceProfileId || '').trim(), trancheId]);
}

/** @param {string} message
 * @param {Record<string,unknown>} context */
function threeBucketContractError(message, context = {}) {
    return new FinancialCalculationError(
        `${message} Bitte pruefen Sie die Depot-Tranchen und deren Profilzuordnung und starten Sie die Berechnung erneut.`,
        context
    );
}

/** @param {readonly import('../../typcheck/rechenkern').EngineTranche[]|null|undefined} detailedTranches
 * @param {Action} pendingAction */
export function reservePlannedLotInventory(detailedTranches, pendingAction) {
    const tranches = Array.isArray(detailedTranches) ? detailedTranches : [];
    if (!tranches.length) return [];

    const reservations = new Map();
    nonLiquidSaleSources(pendingAction).forEach(source => {
        const key = lotReservationKey(source);
        if (!key) {
            throw threeBucketContractError(
                'Die 3-Bucket-Finalisierung kann eine Verkaufsquelle keiner eindeutigen Tranche zuordnen.',
                { contract: 'lot_reservation', source }
            );
        }
        reservations.set(
            key,
            (reservations.get(key) || 0) + Math.max(0, Number(source.brutto) || 0)
        );
    });

    return tranches
        .map(tranche => {
            const key = lotReservationKey(tranche);
            if (!key) {
                throw threeBucketContractError(
                    'Die 3-Bucket-Finalisierung hat eine Depot-Tranche ohne eindeutige Tranche-ID gefunden.',
                    { contract: 'lot_reservation', tranche }
                );
            }
            const marketValue = Math.max(0, Number(tranche?.marketValue) || 0);
            const reservedGross = reservations.get(key) || 0;
            if (reservedGross > marketValue + 0.01) {
                throw threeBucketContractError(
                    `Die 3-Bucket-Finalisierung wuerde Lot ${key} um ${(reservedGross - marketValue).toFixed(2)} EUR ueberbuchen.`,
                    { contract: 'lot_reservation', key, reservedGross, marketValue }
                );
            }
            const remainingMarketValue = Math.max(0, marketValue - reservedGross);
            const remainingRatio = marketValue > 0 ? remainingMarketValue / marketValue : 0;
            return {
                ...tranche,
                marketValue: remainingMarketValue,
                costBasis: Math.max(0, Number(tranche?.costBasis) || 0) * remainingRatio
            };
        })
        .filter(tranche => tranche.marketValue > 0.01);
}

/** @param {ActionSource[]} sources */
function mergeLotSaleSources(sources) {
    const merged = /** @type {ActionSource[]} */ ([]);
    const indexByLot = new Map();
    (sources || []).forEach((source, sourceIndex) => {
        const lotKey = lotReservationKey(source);
        const key = lotKey
            ? lotKey
            : `unscoped:${sourceIndex}`;
        const existingIndex = indexByLot.get(key);
        if (existingIndex === undefined) {
            indexByLot.set(key, merged.length);
            merged.push({ ...source });
            return;
        }
        const existing = merged[existingIndex];
        merged[existingIndex] = {
            ...existing,
            brutto: (Number(existing.brutto) || 0) + (Number(source.brutto) || 0),
            steuer: (Number(existing.steuer) || 0) + (Number(source.steuer) || 0),
            netto: (Number(existing.netto) || 0) + (Number(source.netto) || 0),
            spbUsed: (Number(existing.spbUsed) || 0) + (Number(source.spbUsed) || 0),
            realizedGainSigned: (Number(existing.realizedGainSigned) || 0) + (Number(source.realizedGainSigned) || 0),
            taxableAfterTqfSigned: (Number(existing.taxableAfterTqfSigned) || 0) + (Number(source.taxableAfterTqfSigned) || 0)
        };
    });
    return merged;
}

/** @param {Action} action
 * @param {readonly import('../../typcheck/rechenkern').EngineTranche[]|null|undefined} detailedTranches */
function assertFinalLotCapacities(action, detailedTranches) {
    const tranches = Array.isArray(detailedTranches) ? detailedTranches : [];
    if (!tranches.length) return;
    const capacityByLot = new Map();
    tranches.forEach(tranche => {
        const key = lotReservationKey(tranche);
        if (!key) {
            throw threeBucketContractError(
                'Die finale 3-Bucket-Pruefung hat eine Depot-Tranche ohne eindeutige Tranche-ID gefunden.',
                { contract: 'final_lot_capacity', tranche }
            );
        }
        if (capacityByLot.has(key)) {
            throw threeBucketContractError(
                `Die finale 3-Bucket-Pruefung hat die Tranche ${key} mehrfach gefunden.`,
                { contract: 'final_lot_capacity', key }
            );
        }
        capacityByLot.set(key, Math.max(0, Number(tranche?.marketValue) || 0));
    });
    const soldByLot = new Map();
    nonLiquidSaleSources(action).forEach(source => {
        const key = lotReservationKey(source);
        if (!key) {
            throw threeBucketContractError(
                'Die finale 3-Bucket-Pruefung kann eine Verkaufsquelle keiner eindeutigen Tranche zuordnen.',
                { contract: 'final_lot_capacity', source }
            );
        }
        if (!capacityByLot.has(key)) {
            throw threeBucketContractError(
                `Die finale 3-Bucket-Verkaufsquelle ${key} besitzt keine aktuelle Ursprungstranche.`,
                { contract: 'final_lot_capacity', key }
            );
        }
        soldByLot.set(key, (soldByLot.get(key) || 0) + Math.max(0, Number(source.brutto) || 0));
    });
    soldByLot.forEach((sold, key) => {
        const capacity = capacityByLot.get(key) || 0;
        if (sold > capacity + 0.01) {
            throw threeBucketContractError(
                `Die finale 3-Bucket-Aktion wuerde Lot ${key} um ${(sold - capacity).toFixed(2)} EUR ueberbuchen.`,
                { contract: 'final_lot_capacity', key, sold, capacity }
            );
        }
    });
}

/** * Central function to apply the 3-Bucket Decumulation.
 * Analyzes the standard Action recommendation. If it's a "bad year" (equity dropped below trigger),
 * overrides equity sales with bond sales.
 * */
/** @param {readonly import('../../typcheck/rechenkern').EngineTranche[]} detailedTranches
 * @param {NormalizedEngineInput} engineInput
 * @param {Market} market
 * @param {Action} pendingAction
 * @param {number} rA
 * @param {number} currentBondValuation */
export function applyThreeBucketLogic(
    detailedTranches,
    engineInput,
    market,
    pendingAction,
    rA,
    currentBondValuation
) {
    const threeBucketInput = getThreeBucketInputs(engineInput);
    const is3Bucket = threeBucketInput.is3Bucket;

    // Default pristine state for Diagnostics
    const threeBucketState = {
        is3Bucket,
        isBadYear: false,
        bondBucketBefore: currentBondValuation,
        bondBucketAfter: currentBondValuation,
        bondRefillGross: 0,
        bondRefillNet: 0,
        bondRefillTax: 0,
        bondSaleAmount: 0,
        equityPreserved: 0,
        unmetLiquidity: 0
    };

    if (!is3Bucket) {
        return { updatedAction: pendingAction, threeBucketState };
    }

    // Determine if trigger hit
    const drawdownRatio = threeBucketInput.drawdownTrigger / 100;

    const isBadYear = (rA < drawdownRatio);
    threeBucketState.isBadYear = isBadYear;

    let updatedAction = { ...pendingAction };
    const allQuellen = Array.isArray(updatedAction.quellen) ? updatedAction.quellen : [];
    let saleQuellen = allQuellen.filter(q => q?.kind && q.kind !== 'liquiditaet');

    // Eine Anlage aus vorhandenem Tagesgeld ist kein Auszahlungsverkauf.
    // FR-63 verteilt diesen Überschuss anschließend zuerst auf den Anleihentopf.
    const cashPurchase = allQuellen.some(isLiquiditySource) && saleQuellen.length === 0;
    if ((isBadYear || pendingAction.bondPayoutProtection === true) && !cashPurchase) {
        // Collect how much equity the engine wanted to sell
        const blockedEquitySale = saleQuellen.reduce((sum, q) => {
            const kind = String(q?.kind || '').toLowerCase();
            if (!kind || kind === 'liquiditaet' || isBondCategory(kind) || kind.startsWith('gold')) return sum;
            return sum + (Number(q?.brutto) || 0);
        }, 0);

        threeBucketState.equityPreserved = blockedEquitySale;

        // Calculate the netto value that MUST be produced
        const requestedNetto = Math.max(0, Number(updatedAction.nettoErlös) || 0);

        // Find specific bond tranches
        const bondTranchesOnly = (detailedTranches || []).filter(t => isBondCategory(t.type) || isBondCategory(t.category));

        if (requestedNetto > 0 && bondTranchesOnly.length > 0) {
            // Re-run the sale engine, BUT restrict it ONLY to Bond tranches
            const bondSale = calculateSaleAndTax(requestedNetto, {
                ...engineInput,
                detailledTranches: bondTranchesOnly,
                depotwertAlt: 0, // Prevent dynamic scaling tricks for equity
                depotwertNeu: 0,
                goldWert: 0
            }, { minGold: 0 }, market, false);

            updatedAction.quellen = Array.isArray(bondSale.breakdown)
                ? bondSale.breakdown.map(item => ({ ...item, category: 'bonds' }))
                : [];

            updatedAction.nettoErlös = bondSale.achievedRefill || 0;
            updatedAction.steuer = bondSale.steuerGesamt || 0;
            updatedAction.verwendungen = reconcileUsesToAchievedNet(
                updatedAction.verwendungen,
                updatedAction.nettoErlös
            );
            updatedAction.taxRawAggregate = {
                sumRealizedGainSigned: Number(bondSale.taxRawAggregate?.sumRealizedGainSigned) || 0,
                sumTaxableAfterTqfSigned: Number(bondSale.taxRawAggregate?.sumTaxableAfterTqfSigned) || 0
            };

            // Deficit if bonds run dry
            threeBucketState.unmetLiquidity = Math.max(0, requestedNetto - (bondSale.achievedRefill || 0));
            threeBucketState.bondSaleAmount = updatedAction.quellen.reduce((sum, q) => sum + (q?.brutto || 0), 0);
            threeBucketState.bondBucketAfter -= threeBucketState.bondSaleAmount;
        } else if (requestedNetto > 0) {
            // No bonds left to sell
            updatedAction.quellen = [];
            updatedAction.nettoErlös = 0;
            updatedAction.steuer = 0;
            updatedAction.verwendungen = reconcileUsesToAchievedNet(updatedAction.verwendungen, 0);
            updatedAction.taxRawAggregate = {
                sumRealizedGainSigned: 0,
                sumTaxableAfterTqfSigned: 0
            };
            threeBucketState.unmetLiquidity = requestedNetto;
        } else {
            // No sales requested
            updatedAction.quellen = [];
        }

        // FR-44: Erst Liquidität und Anleihen. Nur der noch offene Anteil
        // der zusätzlichen Ausgabe darf den normalen Aktienschutz verlassen.
        const expenseShortfall = pendingAction.plannedExpenseFunding
            ? Math.min(/** @type {number} */ (engineInput.plannedExpenseLiquidityReserve),
                Math.max(0, requestedNetto - (updatedAction.nettoErlös || 0))) : 0;
        if (expenseShortfall > 0) {
            const equityTranches = (detailedTranches || []).filter(t =>
                !(isBondCategory(t.type) || isBondCategory(t.category)) && t.category !== 'gold');
            const spbUsed = updatedAction.quellen.reduce((sum, q) => sum + (q.spbUsed || 0), 0);
            const expenseSale = calculateSaleAndTax(expenseShortfall, {
                ...engineInput,
                sparerPauschbetrag: Math.max(0, (engineInput.sparerPauschbetrag || 0) - spbUsed),
                detailledTranches: detailedTranches?.length ? equityTranches : undefined,
                goldWert: 0
            }, { minGold: 0 }, market, false);
            updatedAction.quellen.push(...(expenseSale.breakdown || []));
            /** @type {number} */ (updatedAction.nettoErlös) += expenseSale.achievedRefill || 0;
            /** @type {number} */ (updatedAction.steuer) += expenseSale.steuerGesamt || 0;
            for (const key of /** @type {('sumRealizedGainSigned'|'sumTaxableAfterTqfSigned')[]} */ (['sumRealizedGainSigned', 'sumTaxableAfterTqfSigned'])) {
                /** @type {Required<import("../../typcheck/rechenkern").RawTaxAggregate>} */ (updatedAction.taxRawAggregate)[key] += expenseSale.taxRawAggregate?.[key] || 0;
            }
            updatedAction.verwendungen = reconcileUsesToAchievedNet(pendingAction.verwendungen, /** @type {number} */ (updatedAction.nettoErlös));
            threeBucketState.unmetLiquidity = Math.max(0, requestedNetto - /** @type {number} */ (updatedAction.nettoErlös));
            threeBucketState.equityPreserved = Math.max(0, blockedEquitySale - (expenseSale.bruttoVerkaufGesamt || 0));
        }
    }

    if ((updatedAction.quellen || []).some(q => (isBondCategory(q.kind) || isBondCategory(q.category)) && q.brutto > .005)) updatedAction.bondPayoutProtection = true;
    else delete updatedAction.bondPayoutProtection;
    return { updatedAction, threeBucketState };
}

/** * Calculates whether bonds need to be replenished (bought) in a good year,
 * by selling excess equity. Updates the pendingAction to include these transactions.
 * */
/** @param {readonly import('../../typcheck/rechenkern').EngineTranche[]} detailedTranches
 * @param {NormalizedEngineInput} engineInput
 * @param {Action} pendingAction
 * @param {number} rA
 * @param {number} jahresEntnahmeTarget
 * @param {number} currentBondValuation
 * @param {Market} market */
export function appendBondReplenishment(
    detailedTranches,
    engineInput,
    pendingAction,
    rA,
    jahresEntnahmeTarget,
    currentBondValuation,
    market
) {
    const threeBucketInput = getThreeBucketInputs(engineInput);
    if (!threeBucketInput.is3Bucket) return { updatedAction: pendingAction, bondReplenishmentAmount: 0 };

    const drawdownRatio = threeBucketInput.drawdownTrigger / 100;
    const isBadYear = (rA < drawdownRatio);

    let updatedAction = { ...pendingAction, verwendungen: { ...pendingAction.verwendungen } };
    let bondReplenishmentAmount = 0;
    let addedActionDelta = null;

    if (threeBucketInput.bondTargetFactor > 0) {
        const remainingTranches = reservePlannedLotInventory(detailedTranches, pendingAction);
        const plannedBondSales = nonLiquidSaleSources(pendingAction).reduce((sum, source) => (
            isBondCategory(source.kind) || isBondCategory(source.category)
                ? sum + source.brutto : sum
        ), 0);
        const remainingBonds = Math.max(0, currentBondValuation - plannedBondSales);
        const bondTarget = Math.max(0, threeBucketInput.bondTargetFactor * jahresEntnahmeTarget);
        let bondDeficit = Math.max(0, bondTarget - remainingBonds - (Number(updatedAction.verwendungen?.bonds) || 0));
        // FR-63: Bereits zur Anlage freigegebenes Tagesgeld zuerst für Anleihen.
        // Der verbleibende Betrag behält die bisherige Reihenfolge Gold, Aktien.
        const cashInvestment = (pendingAction.quellen || []).filter(isLiquiditySource)
            .reduce((sum, source) => sum + (Number(source.brutto) || 0), 0);
        const equityBuy = Number(updatedAction.verwendungen.aktien) || 0;
        const goldBuy = Number(updatedAction.verwendungen.gold) || 0;
        const cashBondBuy = Math.min(bondDeficit, cashInvestment + (updatedAction.quellen || []).filter(q => q.kind === 'gold' || q.category === 'gold').reduce((sum, q) => sum + (q.netto || 0), 0), equityBuy + goldBuy);
        if (cashBondBuy > 0) {
            updatedAction.verwendungen.bonds = (Number(updatedAction.verwendungen.bonds) || 0) + cashBondBuy;
            updatedAction.verwendungen.aktien = Math.max(0, equityBuy - cashBondBuy);
            updatedAction.verwendungen.gold = goldBuy - Math.max(0, cashBondBuy - equityBuy);
            if (updatedAction.details) updatedAction.details = { ...updatedAction.details,
                kaufAkt: updatedAction.verwendungen.aktien, kaufGld: updatedAction.verwendungen.gold };
            bondReplenishmentAmount = cashBondBuy;
            bondDeficit -= cashBondBuy;
        }
        // Die Auszahlung aus Anleihen und der Aktienschutz der Marktphase
        // dürfen nicht durch eine anschließende Auffüllung rückgängig werden.
        const protectsEquity = plannedBondSales > .005;
        if (isBadYear || protectsEquity || updatedAction.verwendungen.aktien > 0) {
            return { updatedAction, bondReplenishmentAmount, addedActionDelta };
        }
        const refillThreshold = Number.isFinite(threeBucketInput.bondRefillThresholdPct)
            ? (bondTarget * (threeBucketInput.bondRefillThresholdPct / 100))
            : 0;

        if (bondDeficit > refillThreshold || remainingBonds <= .005 && bondDeficit > 0) {
            const equityOnly = remainingTranches.reduce((sum, t) => sum + (t.category === 'equity' ? (Number(t.marketValue) || 0) : 0), 0);
            const netFloorYear = Math.max(0, engineInput.floorBedarf - (engineInput.renteAktiv ? (/** @type {number} */ (engineInput.renteMonatlich) * 12) : 0));
            const equityGuardMin = Math.max(jahresEntnahmeTarget, netFloorYear);
            const maxRefillNet = Math.max(0, equityOnly - equityGuardMin);

            if (maxRefillNet > 0) {
                const requestedNet = Math.min(bondDeficit, maxRefillNet);
                const refillTranches = remainingTranches.filter(t => !(isBondCategory(t.type) || isBondCategory(t.category)) && String(t.category || '') === 'equity');

                if (requestedNet > 0 && refillTranches.length > 0) {
                    const spbUsed = nonLiquidSaleSources(pendingAction)
                        .reduce((sum, source) => sum + (Number(source.spbUsed) || 0), 0);
                    const refillSale = calculateSaleAndTax(requestedNet, {
                        ...engineInput,
                        sparerPauschbetrag: Math.max(0, (Number(engineInput.sparerPauschbetrag) || 0) - spbUsed),
                        detailledTranches: refillTranches,
                        depotwertAlt: 0,
                        depotwertNeu: 0,
                        goldWert: 0
                    }, { minGold: 0, maxEquityBudgetTotal: maxRefillNet }, market, false);

                    const refillNet = Math.max(0, refillSale.achievedRefill || 0);
                    const bondPurchase = Math.min(requestedNet, refillNet);
                    const excessCash = refillNet - bondPurchase;

                    if ((refillSale.bruttoVerkaufGesamt || 0) > 0 && refillNet > 0) {
                        bondReplenishmentAmount += bondPurchase;

                        addedActionDelta = {
                            nettoErlös: refillNet,
                            steuer: refillSale.steuerGesamt,
                            quellen: Array.isArray(refillSale.breakdown) ? refillSale.breakdown : [],
                            verwendungen: { bonds: bondPurchase, liquiditaet: excessCash },
                            taxRawAggregate: {
                                sumRealizedGainSigned: Number(refillSale.taxRawAggregate?.sumRealizedGainSigned) || 0,
                                sumTaxableAfterTqfSigned: Number(refillSale.taxRawAggregate?.sumTaxableAfterTqfSigned) || 0
                            }
                        };

                        updatedAction.type = 'TRANSACTION';
                        if (!updatedAction.quellen || updatedAction.quellen.length === 0) {
                            updatedAction.anweisungKlasse = 'anweisung-gelb';
                            updatedAction.title = 'Umschichtung: Aktien in Anleihen (3-Bucket)';
                            updatedAction.nettoErlös = refillNet;
                            updatedAction.steuer = refillSale.steuerGesamt;
                            updatedAction.verwendungen = {
                                liquiditaet: excessCash,
                                gold: 0,
                                aktien: 0,
                                bonds: bondPurchase
                            };
                            updatedAction.quellen = Array.isArray(refillSale.breakdown) ? refillSale.breakdown : [];
                            updatedAction.taxRawAggregate = {
                                sumRealizedGainSigned: Number(refillSale.taxRawAggregate?.sumRealizedGainSigned) || 0,
                                sumTaxableAfterTqfSigned: Number(refillSale.taxRawAggregate?.sumTaxableAfterTqfSigned) || 0
                            };
                        } else {
                            // If there is already an action (e.g., standard runway fill), we merge the sales.
                            // However, since it's a "good year", the standard action might just be opportunistic or surplus.
                            // We simplify by just appending to the uses and sources.
                            const existingNetto = updatedAction.nettoErlös || 0;
                            const existingSteuer = updatedAction.steuer || 0;
                            updatedAction.title += ' + Bonds Auffüllen';
                            updatedAction.nettoErlös = existingNetto + refillNet;
                            updatedAction.steuer = existingSteuer + refillSale.steuerGesamt;

                            updatedAction.verwendungen = updatedAction.verwendungen || {};
                            updatedAction.verwendungen.bonds = (updatedAction.verwendungen.bonds || 0) + bondPurchase;
                            updatedAction.verwendungen.liquiditaet = (updatedAction.verwendungen.liquiditaet || 0) + excessCash;

                            if (Array.isArray(refillSale.breakdown)) {
                                updatedAction.quellen = mergeLotSaleSources([
                                    ...(updatedAction.quellen || []),
                                    ...refillSale.breakdown
                                ]);
                            }
                            updatedAction.taxRawAggregate = {
                                sumRealizedGainSigned: (Number(updatedAction.taxRawAggregate?.sumRealizedGainSigned) || 0) + (Number(refillSale.taxRawAggregate?.sumRealizedGainSigned) || 0),
                                sumTaxableAfterTqfSigned: (Number(updatedAction.taxRawAggregate?.sumTaxableAfterTqfSigned) || 0) + (Number(refillSale.taxRawAggregate?.sumTaxableAfterTqfSigned) || 0)
                            };
                        }
                    }
                }
            }
        }
    }

    return { updatedAction, bondReplenishmentAmount, addedActionDelta };
}

/**
 * Finalizes the complete 3-bucket source ledger before annual tax settlement.
 * The real equity return uses ratio units (-0.30 means -30 percent).
 */
/** @param {{detailedTranches:readonly import('../../typcheck/rechenkern').EngineTranche[];engineInput:NormalizedEngineInput;market:Market;pendingAction:Action;realReturnEq:number;annualWithdrawalTarget:number;currentBondValuation:number}} options */
export function finalizeThreeBucketAction({
    detailedTranches,
    engineInput,
    market,
    pendingAction,
    realReturnEq,
    annualWithdrawalTarget,
    currentBondValuation
}) {
    if (!Number.isFinite(realReturnEq)) {
        throw new FinancialCalculationError(
            'Die 3-Bucket-Berechnung besitzt keine gueltige reale Aktienrendite. Bitte pruefen Sie die Marktdaten und starten Sie die Berechnung erneut.',
            { contract: 'three_bucket_real_return', realReturnEq }
        );
    }
    const threeBucketResult = applyThreeBucketLogic(
        detailedTranches,
        engineInput,
        market,
        pendingAction,
        realReturnEq,
        currentBondValuation
    );
    const replenishResult = appendBondReplenishment(
        detailedTranches,
        engineInput,
        threeBucketResult.updatedAction,
        realReturnEq,
        Math.max(0, Number(annualWithdrawalTarget) || 0),
        currentBondValuation,
        market
    );
    const updatedAction = {
        ...replenishResult.updatedAction,
        quellen: mergeLotSaleSources(replenishResult.updatedAction?.quellen || [])
    };
    assertFinalLotCapacities(updatedAction, detailedTranches);

    const bondSaleGross = nonLiquidSaleSources(updatedAction).reduce((total, source) => (
        isBondCategory(source?.kind) || isBondCategory(source?.category)
            ? total + (Number(source.brutto) || 0)
            : total
    ), 0);
    const bondRefillNet = Math.max(0, Number(replenishResult.bondReplenishmentAmount) || 0);
    const bondRefillGross = (replenishResult.addedActionDelta?.quellen || [])
        .reduce((total, source) => total + (Number(source?.brutto) || 0), 0);
    const bondRefillTax = Math.max(0, Number(replenishResult.addedActionDelta?.steuer) || 0);
    const threeBucketState = {
        ...threeBucketResult.threeBucketState,
        bondSaleAmount: bondSaleGross,
        bondRefillNet,
        bondRefillGross,
        bondRefillTax,
        bondBucketAfter: Math.max(0, currentBondValuation - bondSaleGross + bondRefillNet)
    };

    if ((updatedAction.quellen || []).some(q => (isBondCategory(q.kind) || isBondCategory(q.category)) && q.brutto > .005)) updatedAction.bondPayoutProtection = true;
    else delete updatedAction.bondPayoutProtection;
    return { updatedAction, threeBucketState };
}
