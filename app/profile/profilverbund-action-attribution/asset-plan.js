// @ts-check
import { EPSILON, finiteNumber, TOLERANCE_EUR, sum } from './amounts.js';
import { candidateTaxTerms, addRawAggregate, previewHouseholdTax, rawAggregateForSources } from './tax.js';
import { stableCandidateComparison, appendCandidateSelection, sourceFromCandidate, buildAssetBlueprint, buildAssetCandidates } from './candidates.js';
import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';
import { allocateLiquiditySources } from './liquidity.js';

function selectTaxOptimizedGross(candidates, grossTarget, selected, rawByProfile) {
    let remaining = grossTarget;
    const count = candidates.length;
    // Kandidatenschlüssel sind je Liste eindeutig: Verbrauch und Rohsummen je Position
    // statt je Schlüssel-Map (gleiche Werte, nur ohne String-Hashing in jedem Durchlauf).
    const usedByIndex = new Array(count).fill(0);
    const rawByIndex = new Array(count);
    for (let index = 0; index < count; index += 1) rawByIndex[index] = rawByProfile.get(candidates[index].sourceProfileId);
    while (remaining > EPSILON) {
        // Lineare Minimumsuche mit demselben Vergleich wie die frühere Sortierung
        // (Satz zuerst, dann stabile Kandidatenordnung): liefert dasselbe erste Element.
        let best = null, bestIndex = -1, bestCapacityLeft = 0, bestRate = 0, bestBoundary = 0;
        for (let index = 0; index < count; index += 1) {
            const candidate = candidates[index];
            const capacityLeft = candidate.capacity - usedByIndex[index];
            if (capacityLeft <= EPSILON) continue;
            // Grenzsatz wie marginalTaxDescriptor, ohne Zwischenobjekt.
            let rate = 0, boundary = Number.POSITIVE_INFINITY;
            if (!(candidate.taxableRatio <= 0)) {
                const terms = candidateTaxTerms(candidate);
                const rawAggregate = rawByIndex[index];
                const allowance = Math.max(0, terms.allowanceBase - finiteNumber(rawAggregate?.sumTaxableAfterTqfSigned));
                if (allowance > EPSILON) boundary = allowance / candidate.taxableRatio;
                else rate = candidate.taxableRatio * terms.keSt;
            }
            if (best === null || ((rate - bestRate) || stableCandidateComparison(candidate, best)) < 0) {
                best = candidate; bestIndex = index; bestCapacityLeft = capacityLeft; bestRate = rate; bestBoundary = boundary;
            }
        }
        if (best === null) break;
        const chunk = Math.min(remaining, bestCapacityLeft, bestBoundary);
        if (chunk <= EPSILON) break;
        usedByIndex[bestIndex] += chunk;
        appendCandidateSelection(selected, best, chunk);
        const raw = rawByIndex[bestIndex];
        raw.sumRealizedGainSigned += finiteNumber(chunk * best.realizedRatio);
        raw.sumTaxableAfterTqfSigned += finiteNumber(chunk * best.taxableRatio);
        remaining -= chunk;
    }
    if (remaining > TOLERANCE_EUR) {
        throw new Error(`Profilverbund: ${remaining.toFixed(2)} EUR Bruttoverkauf besitzen keine geeignete steueroptimierte Quelle.`);
    }
}

function profileAllocationWeight(profile, mode) {
    const inputs = profile?.inputs || {};
    if (mode === 'runway_first') return Math.max(0, resolveLiquidityRunwayYears(inputs).years);
    return Math.max(0,
        finiteNumber(inputs.depotwertAlt)
        + finiteNumber(inputs.depotwertNeu)
        + finiteNumber(inputs.goldWert)
        + finiteNumber(inputs.tagesgeld)
        + finiteNumber(inputs.geldmarktEtf)
    );
}

function allocateGrossByProfile(grossTarget, candidates, profiles, mode) {
    const capacities = new Map(profiles.map(profile => [
        profile.profileId,
        sum(candidates.filter(candidate => candidate.sourceProfileId === profile.profileId).map(candidate => candidate.capacity))
    ]));
    const allocations = new Map(profiles.map(profile => [profile.profileId, 0]));
    let remaining = grossTarget;
    let active = profiles.filter(profile => (capacities.get(profile.profileId) || 0) > EPSILON);
    while (remaining > EPSILON && active.length) {
        const rawWeights = active.map(profile => profileAllocationWeight(profile, mode));
        const totalRawWeight = sum(rawWeights);
        const weights = totalRawWeight > EPSILON
            ? rawWeights
            : active.map(profile => capacities.get(profile.profileId) - allocations.get(profile.profileId));
        const totalWeight = sum(weights);
        if (totalWeight <= EPSILON) break;
        const capped = [];
        active.forEach((profile, index) => {
            const capacityLeft = capacities.get(profile.profileId) - allocations.get(profile.profileId);
            const share = remaining * (weights[index] / totalWeight);
            if (share >= capacityLeft - EPSILON) capped.push({ profile, capacityLeft });
        });
        if (!capped.length) {
            active.forEach((profile, index) => {
                allocations.set(profile.profileId, allocations.get(profile.profileId) + remaining * (weights[index] / totalWeight));
            });
            remaining = 0;
            break;
        }
        capped.forEach(({ profile, capacityLeft }) => {
            allocations.set(profile.profileId, allocations.get(profile.profileId) + capacityLeft);
            remaining -= capacityLeft;
        });
        const cappedIds = new Set(capped.map(entry => entry.profile.profileId));
        active = active.filter(profile => !cappedIds.has(profile.profileId));
    }
    if (remaining > TOLERANCE_EUR) {
        throw new Error(`Profilverbund: ${remaining.toFixed(2)} EUR Bruttoverkauf konnten keinem Profil zugeordnet werden.`);
    }
    return allocations;
}

function selectWeightedGross(candidates, profiles, grossTarget, mode, selected, rawByProfile) {
    const allocations = allocateGrossByProfile(grossTarget, candidates, profiles, mode);
    profiles.forEach(profile => {
        let remaining = allocations.get(profile.profileId) || 0;
        const ordered = candidates
            .filter(candidate => candidate.sourceProfileId === profile.profileId)
            .slice()
            .sort(stableCandidateComparison);
        ordered.forEach(candidate => {
            if (remaining <= EPSILON) return;
            const gross = Math.min(remaining, candidate.capacity);
            appendCandidateSelection(selected, candidate, gross);
            addRawAggregate(rawByProfile.get(profile.profileId), {
                sumRealizedGainSigned: gross * candidate.realizedRatio,
                sumTaxableAfterTqfSigned: gross * candidate.taxableRatio
            });
            remaining -= gross;
        });
        if (remaining > TOLERANCE_EUR) {
            throw new Error(`Profilverbund: ${remaining.toFixed(2)} EUR Profilverkauf besitzen keine konkrete Tranche.`);
        }
    });
}

function candidatesPerBucket(candidates, blueprint) {
    return new Map(blueprint.order.map(bucket => [bucket, candidates.filter(candidate => candidate.bucket === bucket)]));
}

/* withSources=false liefert nur net/tax/selected (Bisektion); das Brutto je Auswahl ist
 * dasselbe max(0, finiteNumber(gross)) wie in sourceFromCandidate, gleiche Summenreihenfolge. */
function selectAssetSourcesAtScale({ candidates, blueprint, profiles, mode, scale, candidatesByBucket = null, withSources = true }) {
    const selected = new Map();
    const rawByProfile = new Map(profiles.map(profile => [
        profile.profileId,
        { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 }
    ]));
    const byBucket = candidatesByBucket || candidatesPerBucket(candidates, blueprint);
    blueprint.order.forEach(bucket => {
        const bucketCandidates = byBucket.get(bucket);
        const grossTarget = (blueprint.grossByBucket.get(bucket) || 0) * scale;
        if (mode === 'tax_optimized') {
            selectTaxOptimizedGross(bucketCandidates, grossTarget, selected, rawByProfile);
        } else {
            selectWeightedGross(bucketCandidates, profiles, grossTarget, mode, selected, rawByProfile);
        }
    });
    const tax = previewHouseholdTax(profiles, rawByProfile);
    if (!withSources) {
        let gross = 0;
        for (const entry of selected.values()) gross = gross + Math.max(0, finiteNumber(entry.gross));
        return { sources: null, tax, net: gross - tax, selected };
    }
    const sources = [...selected.values()].map(entry => sourceFromCandidate(entry.candidate, entry.gross));
    return {
        sources,
        tax,
        net: sum(sources.map(source => source.brutto)) - tax,
        selected
    };
}

/** Only the previously infeasible plan enters this funding path. */
function coverAttributionGap({ maxPlan, maxScale, candidates, profiles, mode, targetNet, cashSources }) {
    // Use uncommitted Tagesgeld first. Money market stays in the ordinary
    // liquidity/payout path, where its disposal is recorded in the annual tax book.
    const cashProfiles = profiles.map(profile => ({ ...profile, inputs: { ...profile.inputs,
        tagesgeld: Math.floor(Math.max(0, finiteNumber(profile.inputs?.tagesgeld)
            - sum(cashSources.filter(source => source.sourceProfileId === profile.profileId).map(source => source.brutto))) * 100) / 100,
        geldmarktEtf: 0 } }));
    const cashCapacity = sum(cashProfiles.map(profile => profile.inputs.tagesgeld));
    const cashToUse = Math.min(targetNet - maxPlan.net, cashCapacity);
    const extraCash = allocateLiquiditySources(Math.min(cashCapacity, Math.ceil(cashToUse * 100) / 100), cashProfiles, mode);
    // Keep the established cent allocation order, but fund the unrounded tax
    // amount exactly so the simulator's action-flow contract remains balanced.
    if (extraCash.length) {
        const last = extraCash.at(-1);
        last.brutto -= sum(extraCash.map(source => source.brutto)) - cashToUse;
        last.netto = last.brutto;
    }
    const cashNet = sum(extraCash.map(source => source.netto));
    const remainingTarget = targetNet - cashNet;
    let plan = maxPlan;
    if (plan.net < remainingTarget - EPSILON) {
        // A saturated bucket must not cap still available lots in another bucket
        // or another person's depot. Settle the combined sale, never each part.
        const remainingCandidates = candidates.map(candidate => ({ ...candidate,
            capacity: Math.max(0, candidate.capacity - (maxPlan.selected.get(candidate.key)?.gross || 0))
        })).filter(candidate => candidate.capacity > EPSILON);
        const capacity = sum(remainingCandidates.map(candidate => candidate.capacity));
        const selectAdditional = gross => {
            const selected = new Map(maxPlan.selected);
            const rawByProfile = new Map(profiles.map(profile => [profile.profileId,
                rawAggregateForSources(maxPlan.sources.filter(source => source.sourceProfileId === profile.profileId))]));
            if (mode === 'tax_optimized') {
                selectTaxOptimizedGross(remainingCandidates, gross, selected, rawByProfile);
            } else {
                selectWeightedGross(remainingCandidates, profiles, gross, mode, selected, rawByProfile);
            }
            const sources = [...selected.values()].map(entry => sourceFromCandidate(entry.candidate, entry.gross));
            const tax = previewHouseholdTax(profiles, rawByProfile);
            return { sources, net: sum(sources.map(source => source.brutto)) - tax };
        };
        plan = selectAdditional(capacity);
        if (plan.net >= remainingTarget) {
            let lower = 0, upper = capacity;
            for (let iteration = 0; iteration < 80; iteration += 1) {
                const middle = (lower + upper) / 2;
                if (selectAdditional(middle).net < remainingTarget) lower = middle;
                else upper = middle;
            }
            plan = selectAdditional(upper);
        }
    }
    return { sources: plan.sources, scale: maxScale, extraCash,
        fundingGap: targetNet - maxPlan.net,
        shortfall: Math.max(0, targetNet - plan.net - cashNet) };
}

export function planAssetSources(plannedSources, profiles, mode, targetNet, cashSources) {
    if (targetNet <= TOLERANCE_EUR) return { sources: [], scale: 0 };
    if (!plannedSources.length) {
        throw new Error(`Profilverbund: ${targetNet.toFixed(2)} EUR Netto-Verwendung besitzen keine attribuierbare Verkaufsquelle.`);
    }
    const blueprint = buildAssetBlueprint(plannedSources);
    const candidates = buildAssetCandidates(profiles, plannedSources);
    const candidatesByBucket = candidatesPerBucket(candidates, blueprint);
    const scaleCaps = blueprint.order.map(bucket => {
        const plannedGross = blueprint.grossByBucket.get(bucket) || 0;
        const capacity = sum(candidatesByBucket.get(bucket).map(candidate => candidate.capacity));
        return plannedGross > EPSILON ? capacity / plannedGross : Number.POSITIVE_INFINITY;
    });
    const maxScale = Math.min(...scaleCaps);
    if (!Number.isFinite(maxScale) || maxScale <= EPSILON) {
        throw new Error('Profilverbund: Haushaltsverkauf besitzt keine ausreichende profilbezogene Tranche.');
    }
    const maxPlan = selectAssetSourcesAtScale({ candidates, blueprint, profiles, mode, scale: maxScale, candidatesByBucket });
    if (maxPlan.net < targetNet - TOLERANCE_EUR) {
        return coverAttributionGap({ maxPlan, maxScale, candidates, profiles, mode, targetNet, cashSources });
    }
    let lower = 0;
    let upper = maxScale;
    for (let iteration = 0; iteration < 80; iteration += 1) {
        const middle = (lower + upper) / 2;
        const plan = selectAssetSourcesAtScale({ candidates, blueprint, profiles, mode, scale: middle, candidatesByBucket, withSources: false });
        if (plan.net < targetNet) lower = middle;
        else upper = middle;
    }
    const plan = selectAssetSourcesAtScale({ candidates, blueprint, profiles, mode, scale: upper, candidatesByBucket });
    return { sources: plan.sources, scale: upper };
}
