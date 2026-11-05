/**
 * Module: Balance Health Bucket
 * Purpose: Care-bucket diagnostics and operative asset copies for Balance calculations.
 */
"use strict";

import { DEFAULT_PROFILE_HEALTH_BUCKET, normalizeProfileHealthBucket } from '../profile/profile-state.js';
import { classifyTranche } from '../../types/tranche-contract.js';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** @param {import('../../typcheck/balance-ui.js').Input} [inputData] @returns {import('../../typcheck/datenvertraege.js').HealthBucket} */
export function resolveBalanceHealthBucketDefinition(inputData = {}) {
    return normalizeProfileHealthBucket(/** @type {Parameters<typeof normalizeProfileHealthBucket>[0]} */ (inputData.healthBucket || DEFAULT_PROFILE_HEALTH_BUCKET));
}

/** @param {import('../../typcheck/balance-ui.js').Input} [inputData] @param {{cumulativeInflationFactor?: number}} [options] @returns {import('../../typcheck/balance-ui.js').HealthDiagnostics} */
export function buildBalanceHealthBucketDiagnostics(inputData = {}, options = {}) {
    const definition = resolveBalanceHealthBucketDefinition(inputData);
    const tagesgeld = Math.max(0, safeNumber(inputData.tagesgeld, 0));
    const geldmarktEtf = Math.max(0, safeNumber(inputData.geldmarktEtf, 0));
    const grossLiquidity = tagesgeld + geldmarktEtf;
    const requestedAmount = definition.enabled ? Math.max(0, safeNumber(definition.initialAmount, 0)) : 0;
    const lockedAmount = Math.min(requestedAmount, grossLiquidity);
    const lockedFromMoneyMarket = Math.min(geldmarktEtf, lockedAmount);
    const lockedFromCash = Math.min(tagesgeld, Math.max(0, lockedAmount - lockedFromMoneyMarket));
    const operativeLiquidity = Math.max(0, grossLiquidity - lockedAmount);
    const nominalGap = Math.max(0, requestedAmount - lockedAmount);
    const cumulativeInflationFactor = Math.max(1, safeNumber(options.cumulativeInflationFactor, 1));
    const targetInflationAdjusted = definition.targetMode === 'inflation_indexed_diagnostic'
        ? requestedAmount * cumulativeInflationFactor
        : requestedAmount;
    const targetGap = Math.max(0, targetInflationAdjusted - lockedAmount);
    const targetCoveragePct = targetInflationAdjusted > 0
        ? (lockedAmount / targetInflationAdjusted) * 100
        : null;

    return {
        enabled: definition.enabled,
        definition,
        releasePolicy: 'diagnostic_only',
        releaseAllowed: false,
        releaseReason: definition.enabled
            ? 'Balance zeigt den Pflegebucket nur als Zweckbindung; automatische Entsperrung erfordert einen expliziten Pflegefall-Ist-Zustand.'
            : 'Pflegebucket ist deaktiviert.',
        releasedAmount: 0,
        grossLiquidity,
        requestedAmount,
        lockedAmount,
        lockedFromMoneyMarket,
        lockedFromCash,
        operativeLiquidity,
        nominalGap,
        targetInflationAdjusted,
        targetCoveragePct,
        targetGap,
        warning: definition.enabled && nominalGap > 0
            ? 'Pflegebucket-Ziel ist durch Geldmarkt/Cash aktuell nicht vollständig gedeckt.'
            : null
    };
}

/** Rechenkopie: Geldmarkt (FIFO), danach Cash in Haushaltsreihenfolge sperren.
 * Eingaben und Eigentumsnachweise für Speicherung/Ausführung bleiben brutto. */
/** @template {import('../../typcheck/balance-ui.js').Input} T @param {T} inputData @param {import('../../typcheck/balance-ui.js').ProfileInput[]} [profiles] @returns {{input: T, profiles: import('../../typcheck/balance-ui.js').ProfileInput[]}} */
export function prepareBalanceEngineAssets(inputData, profiles = []) {
    const diagnostics = buildBalanceHealthBucketDiagnostics(inputData);
    let input = inputData;
    let operativeProfiles = profiles;
    if (diagnostics.lockedAmount > 0) {
        const tranches = (inputData.detailledTranches || []).map(t => ({ ...t }));
        let remaining = diagnostics.lockedFromMoneyMarket;
        const reductions = new Map();
        const date = t => {
            const parsed = Date.parse(t.purchaseDate || '1900-01-01');
            return Number.isFinite(parsed) ? parsed : Date.parse('1900-01-01');
        };
        for (const tranche of tranches.filter(t => classifyTranche(/** @type {import("../../typcheck/rechenkern.js").EngineTranche & Record<string, unknown>} */ (t), { allowLegacy: true }) === 'money_market')
            .sort((a, b) => date(a) - date(b))) {
            const value = Math.max(0, Number(tranche.marketValue) || 0);
            const take = Math.min(remaining, value);
            if (take <= 0) continue;
            const ratio = take / value;
            tranche.marketValue = value - take;
            const cost = Number(tranche.costBasis) || 0;
            tranche.costBasis = Math.max(0, cost - cost * ratio);
            if (tranche.shares > 0) tranche.shares = Math.max(0, tranche.shares - tranche.shares * ratio);
            reductions.set(tranche.sourceProfileId, (reductions.get(tranche.sourceProfileId) || 0) + take);
            remaining -= take;
        }
        let cashRemaining = diagnostics.lockedFromCash;
        operativeProfiles = profiles.map(entry => {
            const money = reductions.get(entry.profileId) || 0;
            // Untranched money market follows the same household order as cash.
            const untranched = Math.min(remaining, Math.max(0, (entry.inputs.geldmarktEtf || 0) - money));
            remaining -= untranched;
            const cash = Math.min(cashRemaining, Math.max(0, entry.inputs.tagesgeld || 0));
            cashRemaining -= cash;
            return { ...entry, inputs: { ...entry.inputs,
                geldmarktEtf: Math.max(0, (entry.inputs.geldmarktEtf || 0) - money - untranched),
                tagesgeld: Math.max(0, (entry.inputs.tagesgeld || 0) - cash) },
                // mergedTranches already carry the owner prefix. The attribution
                // adds it again, so restore the profile-local ID here.
                tranches: tranches.filter(t => t.sourceProfileId === entry.profileId && t.marketValue > 0.01)
                    .map(t => ({ ...t, trancheId: t.trancheId.startsWith(`${entry.profileId}:`)
                        ? t.trancheId.slice(entry.profileId.length + 1) : t.trancheId })),
                hasExplicitTrancheOverride: true };
        });
        input = { ...inputData,
            lockedHealthBucketAmount: diagnostics.lockedAmount,
            tagesgeld: Math.max(0, safeNumber(inputData.tagesgeld) - diagnostics.lockedFromCash),
            geldmarktEtf: Math.max(0, safeNumber(inputData.geldmarktEtf) - diagnostics.lockedFromMoneyMarket),
            ...(inputData.aktuelleLiquiditaet !== undefined ? { aktuelleLiquiditaet: diagnostics.operativeLiquidity } : {}),
            ...(Array.isArray(inputData.detailledTranches) ? { detailledTranches: tranches.filter(t => t.marketValue > 0.01) } : {}) };
    }
    const bonds = (input.detailledTranches || []).reduce((sum, t) =>
        sum + (classifyTranche(/** @type {import("../../typcheck/rechenkern.js").EngineTranche & Record<string, unknown>} */ (t), { allowLegacy: true }) === 'bonds' ? Math.max(0, Number(t.marketValue) || 0) : 0), 0);
    if (bonds > 0) input = { ...input, anleihenWert: bonds };
    return { input, profiles: operativeProfiles };
}
