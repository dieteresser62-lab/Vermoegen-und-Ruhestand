/** @import {EngineInput, NormalizedEngineInput, Market, RunwayProfile, Needs, SaleContext, SaleLot, SaleResult, Action, ActionSource, ActionUses, ActionDetails, TransactionDiagnostics, TransactionParameters, TransactionHelpers, ActionEntry} from '../../typcheck/rechenkern' */
import { capitalGainsTaxRate } from '../tax-settlement.mjs';
/**
 * Module: Sale Engine
 * Purpose: Calculates tax-efficient sales of assets (Shares, Gold).
 *          Orders asset classes, equities by estimated tax per euro, gold by oldest purchase, and calculates capital gains tax.
 * Usage: Called by transaction-action.mjs to execute sell orders.
 * Dependencies: canonical tranche contract and engine errors (pure logic)
 */
import {
    classifyTranche,
    normalizeTrancheCollection,
    TrancheValidationError
} from '../../types/tranche-contract.js';
import { ValidationError } from '../errors.mjs';

/** @param {unknown} error */
function asEngineTrancheValidationError(error) {
    if (!(error instanceof TrancheValidationError)) return error;
    const engineError = /** @type {ValidationError & {code?:string}} */ (new ValidationError(error.errors));
    engineError.code = error.code;
    engineError.context = {
        contract: 'detailledTranches',
        errors: error.errors
    };
    return engineError;
}

/** @param {unknown} items */
function normalizeDetailedTranches(items) {
    try {
        return normalizeTrancheCollection(items, { mode: 'engine' });
    } catch (error) {
        throw asEngineTrancheValidationError(error);
    }
}

/** @param {number} requestedRefill
 * @param {NormalizedEngineInput} input
 * @param {SaleContext|null|undefined} context
 * @param {Market} market
 * @param {boolean|undefined} isEmergencySale
 * @returns {SaleResult} */
export function calculateSaleAndTax(requestedRefill, input, context, market, isEmergencySale) {
    const forceGrossSellAmount = context && context.forceGrossSellAmount ? Number(context.forceGrossSellAmount) : 0;

    // Hardening against NaN inputs
    const kiSt = Number(input.kirchensteuerSatz) || 0;
    const keSt = capitalGainsTaxRate(kiSt);

    /** @param {number} nettoBedarf
 * @param {number} pauschbetrag
 * @param {SaleLot[]} tranchesToUse
 * @returns {SaleResult} */
    const _calculateSingleSale = (nettoBedarf, pauschbetrag, tranchesToUse) => {
        let finalBreakdown = [];
        let totalBrutto = 0;
        let totalSteuer = 0;
        let pauschbetragVerbraucht = 0;
        let totalRealizedGainSigned = 0;
        let totalTaxableAfterTqfSigned = 0;
        let nochZuDeckenderNettoBetrag = Math.max(0, Number(nettoBedarf) || 0);
        let pauschbetragRest = Math.max(0, Number(pauschbetrag) || 0);

        const remainingBudgets = (context && context.saleBudgets)
            ? { ...context.saleBudgets }
            : null;
        const hasExplicitEquityBudget = Boolean(
            context
            && Object.prototype.hasOwnProperty.call(context, 'maxEquityBudgetTotal')
        );
        const equityBudgetRaw = Number(context?.maxEquityBudgetTotal);
        let remainingEquityBudget = hasExplicitEquityBudget
            ? (Number.isFinite(equityBudgetRaw) ? Math.max(0, equityBudgetRaw) : 0)
            : null;
        const hasGoldFloorContract = Boolean(
            context
            && Object.prototype.hasOwnProperty.call(context, 'minGold')
        );
        const totalGoldValue = tranchesToUse.reduce(
            (total, tranche) => (
                tranche?.kind === 'gold'
                    ? total + Math.max(0, Number(tranche.marketValue) || 0)
                    : total
            ),
            0
        );
        const effectiveMinGold = (isEmergencySale || context?.ignoreGoldFloor)
            ? 0
            : Math.max(0, Number(context?.minGold) || 0);
        let remainingGoldHeadroom = hasGoldFloorContract
            ? Math.max(0, totalGoldValue - effectiveMinGold)
            : null;

        for (const tranche of tranchesToUse) {
            // Abbruchbedingung: Wenn Netto-Bedarf gedeckt ist (Normalfall)
            // ODER: Wenn ein explizites Brutto-Ziel gesetzt ist, muss dieses erreicht werden.
            if (forceGrossSellAmount > 0) {
                if (totalBrutto >= forceGrossSellAmount) break;
            } else {
                if (nochZuDeckenderNettoBetrag <= 0.01) break;
            }

            let maxBruttoVerkaufbar = Number(tranche.marketValue) || 0;

            // Gold-Floor berücksichtigen - ABER: Bei Notfallverkäufen (isEmergencySale)
            // oder wenn context.ignoreGoldFloor gesetzt ist, darf der Floor ignoriert werden,
            // um Liquiditätsengpässe zu vermeiden.
            if (tranche.kind === 'gold' && remainingGoldHeadroom !== null) {
                maxBruttoVerkaufbar = Math.min(maxBruttoVerkaufbar, remainingGoldHeadroom);
            }

            // Sale-Budget berücksichtigen
            if (remainingBudgets && remainingBudgets[tranche.kind] !== undefined) {
                const budgetRaw = remainingBudgets[tranche.kind];
                const budget = Number.isFinite(budgetRaw) ? budgetRaw : 0;
                maxBruttoVerkaufbar = Math.min(maxBruttoVerkaufbar, budget);
            }
            if (remainingEquityBudget !== null && String(tranche.kind || '').startsWith('aktien')) {
                maxBruttoVerkaufbar = Math.min(maxBruttoVerkaufbar, remainingEquityBudget);
            }

            if (maxBruttoVerkaufbar <= 0) continue;

            // Gewinnquote berechnen
            const mv = Number(tranche.marketValue) || 0;
            const cb = Number(tranche.costBasis) || 0;
            const gewinnQuoteSigned = mv > 0
                ? ((mv - cb) / mv)
                : 0;
            const gewinnQuote = mv > 0
                ? Math.max(0, (mv - cb) / mv)
                : 0;

            // Maximal möglichen Netto-Erlös berechnen
            const gewinnBruttoMax = maxBruttoVerkaufbar * gewinnQuote;
            const tqf = Number(tranche.tqf) || 0;
            const taxableFactor = tranche.taxExempt === true ? 0 : (1 - tqf);
            const steuerpflichtigerAnteilMax = gewinnBruttoMax * taxableFactor;
            const anrechenbarerPauschbetragMax = Math.min(pauschbetragRest, steuerpflichtigerAnteilMax);
            const finaleSteuerbasisMax = steuerpflichtigerAnteilMax - anrechenbarerPauschbetragMax;
            const steuerMax = Math.max(0, finaleSteuerbasisMax) * keSt;
            const maxNettoAusTranche = maxBruttoVerkaufbar - steuerMax;

            if (maxNettoAusTranche <= 0) continue;

            // Normalfall: Wir verkaufen nur so viel wie nötig für Netto-Bedarf
            // Sonderfall (Gross Target): Wir verkaufen so viel wie nötig für Brutto-Ziel
            let nettoAusDieserTranche = 0;
            let explicitBrutto;

            if (forceGrossSellAmount > 0) {
                // Bei Gross Target Logik berechnen wir "zuVerkaufenBrutto" direkt vom Brutto-Rest
                const remainingGross = Math.max(0, forceGrossSellAmount - totalBrutto);
                // Wir setzen nettoAusDieserTranche vorläufig auf max, um "zuVerkaufenBrutto" Logik unten nicht zu brechen
                // (oder wir passen die Logik unten an)
                // Einfacher: Wir nutzen direkt maxBruttoVerkaufbar, aber gekappt auf remainingGross
                const targetBruttoForTranche = Math.min(remainingGross, maxBruttoVerkaufbar);

                // Helper variable to bypass standard calc
                explicitBrutto = targetBruttoForTranche;
            } else {
                nettoAusDieserTranche = Math.min(nochZuDeckenderNettoBetrag, maxNettoAusTranche);
            }

            // Zu verkaufenden Bruttobetrag berechnen
            let zuVerkaufenBrutto;
            if (forceGrossSellAmount > 0 && typeof explicitBrutto !== 'undefined') {
                zuVerkaufenBrutto = explicitBrutto;
            } else if (nettoAusDieserTranche < maxNettoAusTranche) {
                if (anrechenbarerPauschbetragMax > 0) {
                    // Netto = Brutto - max(0, Brutto × Gewinnfaktor - Rest-SPB) × Steuersatz.
                    // Der feste Freibetrag wird beim Teilverkauf nicht mitskaliert.
                    const gainFactor = gewinnQuote * taxableFactor;
                    zuVerkaufenBrutto = nettoAusDieserTranche * gainFactor <= pauschbetragRest
                        ? nettoAusDieserTranche
                        : (nettoAusDieserTranche - pauschbetragRest * keSt) / (1 - gainFactor * keSt);
                    zuVerkaufenBrutto = Math.min(maxBruttoVerkaufbar, zuVerkaufenBrutto);
                } else {
                    zuVerkaufenBrutto = (nettoAusDieserTranche / maxNettoAusTranche) * maxBruttoVerkaufbar;
                }
            } else {
                zuVerkaufenBrutto = maxBruttoVerkaufbar;
            }

            if (zuVerkaufenBrutto < 1) continue;

            if (remainingBudgets && remainingBudgets[tranche.kind] !== undefined) {
                const budgetLeft = Number(remainingBudgets[tranche.kind]) || 0;
                remainingBudgets[tranche.kind] = Math.max(0, budgetLeft - zuVerkaufenBrutto);
            }
            if (remainingEquityBudget !== null && String(tranche.kind || '').startsWith('aktien')) {
                remainingEquityBudget = Math.max(0, remainingEquityBudget - zuVerkaufenBrutto);
            }
            if (remainingGoldHeadroom !== null && tranche.kind === 'gold') {
                remainingGoldHeadroom = Math.max(0, remainingGoldHeadroom - zuVerkaufenBrutto);
            }
            // Tatsächliche Steuer berechnen
            const bruttogewinn = zuVerkaufenBrutto * gewinnQuote;
            const bruttogewinnSigned = zuVerkaufenBrutto * gewinnQuoteSigned;
            const gewinnNachTFSSigned = bruttogewinnSigned * taxableFactor;
            const gewinnNachTFS = bruttogewinn * taxableFactor;
            const anrechenbarerPauschbetrag = Math.min(pauschbetragRest, gewinnNachTFS);
            const finaleSteuerbasis = gewinnNachTFS - anrechenbarerPauschbetrag;
            const steuer = Math.max(0, finaleSteuerbasis) * keSt;
            const nettoErlös = zuVerkaufenBrutto - steuer;

            totalBrutto += zuVerkaufenBrutto;
            totalSteuer += steuer;
            pauschbetragRest -= anrechenbarerPauschbetrag;
            pauschbetragVerbraucht += anrechenbarerPauschbetrag;
            totalRealizedGainSigned += bruttogewinnSigned;
            totalTaxableAfterTqfSigned += gewinnNachTFSSigned;
            nochZuDeckenderNettoBetrag -= nettoErlös;

            finalBreakdown.push({
                kind: tranche.kind,
                category: tranche.category || null,
                trancheId: tranche.trancheId || null,
                sourceProfileId: tranche.sourceProfileId || null,
                name: tranche.name || null,
                isin: tranche.isin || null,
                purchaseDate: tranche.purchaseDate || null,
                brutto: zuVerkaufenBrutto,
                steuer,
                tqf: tranche.tqf,
                taxExempt: tranche.taxExempt === true,
                spbUsed: anrechenbarerPauschbetrag,
                netto: nettoErlös,
                gainQuotePlan: gewinnQuote,
                gainQuoteSigned: gewinnQuoteSigned,
                realizedGainSigned: bruttogewinnSigned,
                taxableAfterTqfSigned: gewinnNachTFSSigned
            });
        }

        return {
            steuerGesamt: totalSteuer,
            bruttoVerkaufGesamt: totalBrutto,
            achievedRefill: Math.max(0, nettoBedarf - nochZuDeckenderNettoBetrag),
            breakdown: finalBreakdown,
            pauschbetragVerbraucht: pauschbetragVerbraucht,
            sumRealizedGainSigned: totalRealizedGainSigned,
            sumTaxableAfterTqfSigned: totalTaxableAfterTqfSigned,
            taxRawAggregate: {
                sumRealizedGainSigned: totalRealizedGainSigned,
                sumTaxableAfterTqfSigned: totalTaxableAfterTqfSigned
            }
        };
    };

    // Tranchen zusammenstellen
    let tranches = /** @type {Record<string,SaleLot|null>} */ ({});

    // Prüfe ob detaillierte Tranchen verfügbar sind (aus Portfolio)
    if (input.detailledTranches !== undefined && input.detailledTranches !== null) {
        // Verwende detaillierte Tranchen
        normalizeDetailedTranches(input.detailledTranches).forEach((t) => {
            tranches[t.trancheId] = {
                ...t,
                kind: t.type
            };
        });
    } else {
        // Fallback auf alte Struktur
        tranches = {
            aktien_alt: {
                marketValue: input.depotwertAlt,
                costBasis: input.costBasisAlt,
                tqf: input.tqfAlt,
                taxExempt: input.taxExemptAlt === true,
                kind: 'aktien_alt',
                type: 'aktien_alt',
                category: 'equity'
            },
            aktien_neu: {
                marketValue: input.depotwertNeu,
                costBasis: input.costBasisNeu,
                tqf: input.tqfNeu,
                taxExempt: input.taxExemptNeu === true,
                kind: 'aktien_neu',
                type: 'aktien_neu',
                category: 'equity'
            },
            gold: (input.goldAktiv && input.goldWert > 0)
                ? {
                    marketValue: input.goldWert,
                    costBasis: input.goldCost,
                    tqf: 0,
                    taxExempt: input.goldSteuerfrei === true,
                    kind: 'gold',
                    type: 'gold',
                    category: 'gold'
                }
                : null
        };
    }

    // Leere Tranchen entfernen
    Object.keys(tranches).forEach(key => {
        if (!tranches[key] || !tranches[key].marketValue) {
            delete tranches[key];
        }
    });

    const sellOrder = getSellOrder(tranches, market, input, context, isEmergencySale);
    const orderedTranches = sellOrder.map(k => /** @type {SaleLot} */ (tranches[k]));

    return _calculateSingleSale(requestedRefill, input.sparerPauschbetrag || 0, orderedTranches);
}

/**
 * Bestimmt Anlageklassenfolge und Steuer-/Datumsordnung je Anlageklasse.
 */
/** @param {Record<string,SaleLot|null>} tranches
 * @param {Market} market
 * @param {NormalizedEngineInput} input
 * @param {SaleContext|null|undefined} context
 * @param {boolean|undefined} isEmergencySale
 * @returns {string[]} */
export function getSellOrder(tranches, market, input, context, isEmergencySale) {
    // Alle verfügbaren Keys
    const allKeys = Object.keys(tranches);
    const assetClassByKey = new Map();
    try {
        for (const key of allKeys) {
            const tranche = /** @type {Partial<SaleLot>} */ (tranches[key] || {});
            assetClassByKey.set(key, classifyTranche({
                ...tranche,
                trancheId: tranche.trancheId || key,
                type: tranche.type || tranche.kind || key
            }, { index: allKeys.indexOf(key) }));
        }
    } catch (error) {
        throw asEngineTrancheValidationError(error);
    }

    // Disjunkte Assetklassen: jeder Key kann nur einer Liste angehören.
    const equityKeys = allKeys.filter(k => assetClassByKey.get(k) === 'equity');
    const bondKeys = allKeys.filter(k => assetClassByKey.get(k) === 'bonds');
    const goldKeys = allKeys.filter(k => assetClassByKey.get(k) === 'gold');
    /** @param {string[]} keys */
    const uniqueExisting = (keys) => [...new Set(keys)].filter(k => tranches[k]);

    // Steuer-optimierte Sortierung für Aktien (geringste Steuerlast zuerst)
    const sortedEquityKeys = [...equityKeys].sort((a, b) => {
        const tA = tranches[a];
        const tB = tranches[b];
        const kiSt = Number(input.kirchensteuerSatz) || 0;
        const keSt = capitalGainsTaxRate(kiSt);
        const mvA = Number(/** @type {SaleLot} */ (tA).marketValue) || 0;
        const mvB = Number(/** @type {SaleLot} */ (tB).marketValue) || 0;
        const cbA = Number(/** @type {SaleLot} */ (tA).costBasis) || 0;
        const cbB = Number(/** @type {SaleLot} */ (tB).costBasis) || 0;
        const tqfA = Number(/** @type {SaleLot} */ (tA).tqf) || 0;
        const tqfB = Number(/** @type {SaleLot} */ (tB).tqf) || 0;
        const gqA = mvA > 0 ? Math.max(0, (mvA - cbA) / mvA) : 0;
        const gqB = mvB > 0 ? Math.max(0, (mvB - cbB) / mvB) : 0;
        const taxRateA = /** @type {SaleLot} */ (tA).taxExempt === true ? 0 : gqA * (1 - tqfA) * keSt;
        const taxRateB = /** @type {SaleLot} */ (tB).taxExempt === true ? 0 : gqB * (1 - tqfB) * keSt;

        if (taxRateA !== taxRateB) return taxRateA - taxRateB;
        if (gqA !== gqB) return gqA - gqB;

        const dateA = /** @type {SaleLot} */ (tA).purchaseDate ? Date.parse(/** @type {SaleLot} */ (tA).purchaseDate) : NaN;
        const dateB = /** @type {SaleLot} */ (tB).purchaseDate ? Date.parse(/** @type {SaleLot} */ (tB).purchaseDate) : NaN;
        const dateAOk = Number.isFinite(dateA);
        const dateBOk = Number.isFinite(dateB);
        if (dateAOk && dateBOk && dateA !== dateB) return /** @type {number} */ (/** @type {unknown} */ (dateA)) - /** @type {number} */ (/** @type {unknown} */ (dateB)); // oldest first
        if (dateAOk && !dateBOk) return -1;
        if (!dateAOk && dateBOk) return 1;

        return String(a).localeCompare(String(b));
    });

    // FIFO-Sortierung für Gold (falls mehrere Gold-Tranchen existieren)
    const sortedGoldKeys = [...goldKeys].sort((a, b) => {
        const tA = tranches[a];
        const tB = tranches[b];

        if (/** @type {SaleLot} */ (tA).purchaseDate && /** @type {SaleLot} */ (tB).purchaseDate) {
            const dateA = new Date(/** @type {SaleLot} */ (tA).purchaseDate);
            const dateB = new Date(/** @type {SaleLot} */ (tB).purchaseDate);
            return /** @type {number} */ (/** @type {unknown} */ (dateA)) - /** @type {number} */ (/** @type {unknown} */ (dateB));
        }

        if (/** @type {SaleLot} */ (tA).purchaseDate && !/** @type {SaleLot} */ (tB).purchaseDate) return -1;
        if (!/** @type {SaleLot} */ (tA).purchaseDate && /** @type {SaleLot} */ (tB).purchaseDate) return 1;

        return 0;
    });

    const isDefensiveContext = isEmergencySale ||
        market.sKey === 'bear_deep' ||
        market.sKey === 'recovery_in_bear';

    // Defensiv: Gold nach älterem Kaufdatum, dann Anleihen in vorhandener Reihenfolge, dann steuerlich sortierte Aktien.
    if (isDefensiveContext) {
        const order = [...sortedGoldKeys, ...bondKeys, ...sortedEquityKeys];
        return uniqueExisting(order);
    }

    // Gold über Obergrenze? Gold zuerst verkaufen
    if (input.goldAktiv && sortedGoldKeys.length > 0) {
        const depotwertGesamt = (input.depotwertAlt || 0) +
            (input.depotwertNeu || 0) +
            (input.goldWert || 0);
        const aktuelleLiquiditaet = input.aktuelleLiquiditaet
            ?? ((input.tagesgeld || 0) + (input.geldmarktEtf || 0));
        const investiertesKapital = depotwertGesamt + aktuelleLiquiditaet;
        const goldZielwert = investiertesKapital * (/** @type {number} */ (input.goldZielProzent) / 100);
        const goldBandPct = (input.rebalancingBand ?? 35) / 100;
        const goldObergrenze = goldZielwert * (1 + goldBandPct);

        // Gesamter Gold-Wert berechnen
        const totalGoldValue = sortedGoldKeys.reduce((sum, k) => sum + (/** @type {SaleLot} */ (tranches[k]).marketValue || 0), 0);

        if (totalGoldValue > goldObergrenze) {
            return uniqueExisting([...sortedGoldKeys, ...bondKeys, ...sortedEquityKeys]);
        }
    }

    // Standard: Anleihen in vorhandener Reihenfolge, dann steuerlich sortierte Aktien, dann Gold nach älterem Kaufdatum.
    return uniqueExisting([...bondKeys, ...sortedEquityKeys, ...sortedGoldKeys]);
}

/**
 * Merge zwei Verkaufsergebnisse
 */
/** @param {SaleResult} res1
 * @param {SaleResult} res2
 * @returns {SaleResult} */
export function mergeSaleResults(res1, res2) {
    if (!res1) return res2;
    if (!res2) return res1;

    const merged = {
        steuerGesamt: (res1.steuerGesamt || 0) + (res2.steuerGesamt || 0),
        bruttoVerkaufGesamt: (res1.bruttoVerkaufGesamt || 0) + (res2.bruttoVerkaufGesamt || 0),
        achievedRefill: (res1.achievedRefill || 0) + (res2.achievedRefill || 0),
        pauschbetragVerbraucht: (res1.pauschbetragVerbraucht || 0) + (res2.pauschbetragVerbraucht || 0),
        sumRealizedGainSigned: (res1.sumRealizedGainSigned || 0) + (res2.sumRealizedGainSigned || 0),
        sumTaxableAfterTqfSigned: (res1.sumTaxableAfterTqfSigned || 0) + (res2.sumTaxableAfterTqfSigned || 0),
        taxRawAggregate: {
            sumRealizedGainSigned: (res1?.taxRawAggregate?.sumRealizedGainSigned || 0) + (res2?.taxRawAggregate?.sumRealizedGainSigned || 0),
            sumTaxableAfterTqfSigned: (res1?.taxRawAggregate?.sumTaxableAfterTqfSigned || 0) + (res2?.taxRawAggregate?.sumTaxableAfterTqfSigned || 0)
        },
        breakdown: [...(res1.breakdown || []), ...(res2.breakdown || [])]
    };

    return merged;
}
