import { classifyTranche } from '../../../types/tranche-contract.js';
import { readNumber } from './values.js';

/** Leistung: classifyTranche hängt (mit allowLegacy) nur von type, kind und category ab;
 * Tranche/Index dienen dort nur der Fehlermeldung. Erfolgreiche Ergebnisse je Werte-Tripel merken,
 * Fehler werden nie gemerkt (sie werfen weiterhin). Nicht-String-Werte gehen direkt an classifyTranche. */
const CATEGORY_CACHE = new Map();

// type → kind → category → Kategorie (undefined ist als Map-Schlüssel erlaubt)
let categoryCacheSize = 0;

export function classifyTrancheCategoryCached(tranche) {
    if (!tranche || typeof tranche !== 'object' || Array.isArray(tranche)) return classifyTranche(tranche, { allowLegacy: true });
    const type = tranche.type, kind = tranche.kind, category = tranche.category;
    if ((type !== undefined && typeof type !== 'string') || (kind !== undefined && typeof kind !== 'string')
        || (category !== undefined && typeof category !== 'string')) return classifyTranche(tranche, { allowLegacy: true });
    const byKind = CATEGORY_CACHE.get(type);
    const byCategory = byKind && byKind.get(kind);
    const cached = byCategory && byCategory.get(category);
    if (cached !== undefined) return cached;
    const result = classifyTranche(tranche, { allowLegacy: true });
    if (categoryCacheSize < 4096) {
        let kinds = CATEGORY_CACHE.get(type);
        if (!kinds) { kinds = new Map(); CATEGORY_CACHE.set(type, kinds); }
        let categories = kinds.get(kind);
        if (!categories) { categories = new Map(); kinds.set(kind, categories); }
        categories.set(category, result);
        categoryCacheSize += 1;
    }
    return result;
}

export function resolveTrancheCategory(tranche) {
    return classifyTrancheCategoryCached(tranche);
}

export function resolveTrancheSplitTotals(tranches) {
    const totals = {
        altValue: 0,
        altCost: 0,
        neuValue: 0,
        neuCost: 0,
        goldValue: 0,
        goldCost: 0,
        moneyValue: 0,
        moneyCost: 0
    };
    if (!Array.isArray(tranches)) return totals;
    tranches.forEach(tranche => {
        const marketValue = readNumber(tranche.marketValue, 0);
        const costBasis = readNumber(tranche.costBasis, 0);
        const type = String(tranche.type || tranche.kind || '').toLowerCase();
        const category = resolveTrancheCategory(tranche);

        if (category === 'gold') {
            totals.goldValue += marketValue;
            totals.goldCost += costBasis;
            return;
        }

        if (category === 'money_market') {
            totals.moneyValue += marketValue;
            totals.moneyCost += costBasis;
            return;
        }

        if (category === 'bonds') {
            // Bonds remain part of the legacy "neu" depot total while their detailed
            // category is preserved for the one-time household 3-bucket logic.
            totals.neuValue += marketValue;
            totals.neuCost += costBasis;
            return;
        }

        if (type === 'aktien_alt') {
            totals.altValue += marketValue;
            totals.altCost += costBasis;
            return;
        }

        if (type === 'aktien_neu') {
            totals.neuValue += marketValue;
            totals.neuCost += costBasis;
            return;
        }

        if (category === 'equity') {
            const isAltByTax = Number(tranche.tqf) === 1;
            if (isAltByTax) {
                totals.altValue += marketValue;
                totals.altCost += costBasis;
            } else {
                totals.neuValue += marketValue;
                totals.neuCost += costBasis;
            }
        }
    });
    return totals;
}

function buildSyntheticProfileTranches(entry) {
    const inputs = entry?.inputs || {};
    const profileId = entry?.profileId;
    const profileName = entry?.name || profileId;
    const definitions = [
        {
            suffix: 'aktien_alt',
            type: 'aktien_alt',
            category: 'equity',
            marketValue: inputs.depotwertAlt,
            costBasis: inputs.costBasisAlt,
            tqf: inputs.tqfAlt,
            taxExempt: false
        },
        {
            suffix: 'aktien_neu',
            type: 'aktien_neu',
            category: 'equity',
            marketValue: inputs.depotwertNeu,
            costBasis: inputs.costBasisNeu,
            tqf: inputs.tqfNeu,
            taxExempt: false
        },
        {
            suffix: 'gold',
            type: 'gold',
            category: 'gold',
            marketValue: inputs.goldWert,
            costBasis: inputs.goldCost,
            tqf: 0,
            taxExempt: inputs.goldSteuerfrei === true
        },
        {
            suffix: 'geldmarkt',
            type: 'geldmarkt',
            category: 'money_market',
            marketValue: inputs.geldmarktEtf,
            costBasis: inputs.geldmarktEtf,
            tqf: 0,
            taxExempt: false
        }
    ];
    return definitions
        .filter(definition => readNumber(definition.marketValue, 0) > 0)
        .map(definition => ({
            trancheId: `profilverbund:${profileId}:${definition.suffix}`,
            schemaVersion: 2,
            name: `${profileName} ${definition.suffix}`,
            type: definition.type,
            category: definition.category,
            marketValue: readNumber(definition.marketValue, 0),
            costBasis: readNumber(definition.costBasis, 0),
            tqf: readNumber(definition.tqf, 0),
            taxExempt: definition.taxExempt === true,
            sourceProfileId: profileId,
            sourceProfileName: profileName,
            syntheticProfileFallback: true
        }));
}

export function buildProfileOwnedTranches(entry) {
    const profileId = entry?.profileId;
    if (!profileId) {
        throw new Error('Profilverbund: Profil ohne eindeutige Profil-ID kann keine Tranchen bereitstellen.');
    }
    const profileName = entry?.name || profileId;
    const tranches = Array.isArray(entry?.tranches) ? entry.tranches : [];
    if (entry?.hasExplicitTrancheOverride && tranches.length === 0) return [];
    if (!tranches.length) return buildSyntheticProfileTranches(entry);
    return tranches.map(tranche => ({
        ...tranche,
        trancheId: `${profileId}:${tranche.trancheId}`,
        sourceProfileId: profileId,
        sourceProfileName: profileName
    }));
}
