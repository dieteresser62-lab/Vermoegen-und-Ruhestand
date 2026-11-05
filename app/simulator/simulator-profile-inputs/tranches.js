import { PROFILE_TRANCHES_KEY } from '../../profile/profile-state.js';
import { classifyTranche } from '../../../types/tranche-contract.js';

export function parseDetailledTranches(data) {
    if (!data || typeof data !== 'object'
        || !Object.prototype.hasOwnProperty.call(data, PROFILE_TRANCHES_KEY)) {
        return { state: 'absent', tranches: null };
    }

    const raw = data[PROFILE_TRANCHES_KEY];
    if (raw === null || raw === undefined || raw === '') {
        return { state: 'absent', tranches: null };
    }

    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) return { state: 'corrupt', tranches: null };
        return {
            state: parsed.length > 0 ? 'valid' : 'empty',
            tranches: parsed
        };
    } catch {
        return { state: 'corrupt', tranches: null };
    }
}

export function sumTrancheTotals(tranches) {
    const totals = { equity: 0, equityCost: 0, gold: 0, moneyMarket: 0 };
    if (!Array.isArray(tranches)) return totals;
    tranches.forEach((tranche, index) => {
        const marketValue = Number(tranche.marketValue) || 0;
        const costBasis = Number(tranche.costBasis) || 0;
        const category = classifyTranche(tranche, { index });
        if (category === 'gold') {
            totals.gold += marketValue;
            return;
        }
        if (category === 'money_market') {
            totals.moneyMarket += marketValue;
            return;
        }
        totals.equity += marketValue;
        totals.equityCost += costBasis;
    });
    return totals;
}

function profileAssetTotal(inputs) {
    if (!inputs) return 0;
    const start = inputs.startVermoegen || 0;
    const components = (inputs.depotwertAlt || 0) + (inputs.tagesgeld || 0) + (inputs.geldmarktEtf || 0);
    return Math.max(start, components);
}

function resolveTrancheInputState(inputs) {
    const state = String(inputs?.trancheInputState || '').trim().toLowerCase();
    if (state === 'corrupt') return 'corrupt';
    if (state === 'valid' || state === 'empty' || state === 'absent') return state;
    if (Array.isArray(inputs?.detailledTranches)) {
        return inputs.detailledTranches.length > 0 ? 'valid' : 'empty';
    }
    return 'absent';
}

export function buildProfileAssetRecord(entry) {
    const inputs = entry?.inputs || {};
    const trancheState = resolveTrancheInputState(inputs);
    const hasDetailedRepresentation = trancheState === 'valid' || trancheState === 'empty';
    const trancheTotals = hasDetailedRepresentation
        ? sumTrancheTotals(inputs.detailledTranches)
        : null;
    const tagesgeld = Math.max(0, Number(inputs.tagesgeld) || 0);
    const depotwertAlt = hasDetailedRepresentation
        ? trancheTotals.equity
        : Math.max(0, Number(inputs.depotwertAlt) || 0);
    const geldmarktEtf = hasDetailedRepresentation
        ? trancheTotals.moneyMarket
        : Math.max(0, Number(inputs.geldmarktEtf) || 0);
    const einstandAlt = hasDetailedRepresentation
        ? trancheTotals.equityCost
        : Math.max(0, Number(inputs.einstandAlt) || 0);
    const assetTotal = hasDetailedRepresentation
        ? trancheTotals.equity + trancheTotals.gold + trancheTotals.moneyMarket + tagesgeld
        : profileAssetTotal(inputs);
    const aggregateInvestment = trancheState === 'absent'
        ? Math.max(
            depotwertAlt + geldmarktEtf,
            Math.max(0, assetTotal - tagesgeld)
        )
        : 0;

    return {
        entry,
        inputs,
        trancheState,
        hasDetailedRepresentation,
        assetTotal,
        depotwertAlt,
        geldmarktEtf,
        tagesgeld,
        einstandAlt,
        aggregateInvestment,
        operativeLiquidity: tagesgeld + geldmarktEtf
    };
}
