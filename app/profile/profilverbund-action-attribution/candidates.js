// @ts-check
import { classifyTrancheCategoryCached, buildProfileOwnedTranches } from '../profilverbund-balance.js';
import { finiteNumber, EPSILON, hasFiniteValue } from './amounts.js';

function resolveAssetBucket(value = {}) {
    const category = classifyTrancheCategoryCached(value);
    // Geldmarkt gehoert bereits zur Haushaltsliquiditaet und wird nicht ein
    // zweites Mal als verkaufbare Assetquelle angeboten.
    return category === 'money_market' ? null : category;
}

function assetContext(profile, bucket) {
    const asset = { equity: 'Aktien', bonds: 'Anleihen', gold: 'Gold' }[bucket] || bucket;
    return `Person „${profile?.name || profile?.profileId || 'unbekannt'}“, Anlageklasse ${asset}`;
}

function readConfirmedTqf(value, profile, bucket) {
    const tqf = Number(value?.tqf);
    if (!Number.isFinite(tqf) || tqf < 0 || tqf > 1) {
        throw new Error(`Profilverbund: Datenfehler bei ${assetContext(profile, bucket)}: Verkaufstranche besitzt keine gültige Teilfreistellung zwischen 0 und 1.`);
    }
    return tqf;
}

/* Kaufdatum → Zeitstempel wie zuvor (`purchaseDate && isFinite(Date.parse(...)) ? Date.parse(...) : +Infinity`),
 * aber nur ein Date.parse je Aufruf; Ergebnisse je Datumstext gemerkt (Date.parse ist für denselben Text konstant). */
const PURCHASE_STAMP_CACHE = new Map();

function purchaseStampOf(value) {
    if (!value) return Number.POSITIVE_INFINITY;
    if (typeof value !== 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    }
    const cached = PURCHASE_STAMP_CACHE.get(value);
    if (cached !== undefined) return cached;
    const parsed = Date.parse(value);
    const stamp = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    if (PURCHASE_STAMP_CACHE.size < 4096) PURCHASE_STAMP_CACHE.set(value, stamp);
    return stamp;
}

function candidateFromTranche(tranche, profile, index, profileRank = undefined) {
    const marketValue = Math.max(0, finiteNumber(tranche?.marketValue, finiteNumber(tranche?.shares) * finiteNumber(tranche?.currentPrice)));
    const costBasis = Math.max(0, finiteNumber(tranche?.costBasis, finiteNumber(tranche?.shares) * finiteNumber(tranche?.purchasePrice)));
    const bucket = resolveAssetBucket(tranche);
    if (!bucket || marketValue <= EPSILON) return null;
    const tqf = readConfirmedTqf(tranche, profile, bucket);
    const taxExempt = tranche?.taxExempt === true;
    const realizedRatio = (marketValue - costBasis) / marketValue;
    const taxableRatio = taxExempt ? 0 : realizedRatio * (1 - tqf);
    const purchaseStamp = purchaseStampOf(tranche?.purchaseDate);
    return {
        key: `${profile.profileId}:${tranche?.trancheId || tranche?.isin || tranche?.name || 'tranche'}:${bucket}:${index}`,
        profile,
        sourceProfileId: profile.profileId,
        sourceProfileName: profile.name || profile.profileId,
        bucket,
        kind: tranche?.type || tranche?.kind || (bucket === 'equity' ? 'aktien_neu' : bucket),
        category: tranche?.category || bucket,
        trancheId: tranche?.trancheId || null,
        name: tranche?.name || null,
        isin: tranche?.isin || null,
        purchaseDate: tranche?.purchaseDate || null,
        purchaseStamp,
        tqf,
        taxExempt,
        capacity: marketValue,
        realizedRatio,
        taxableRatio,
        taxTerms: null,
        profileRank,
        sourceTemplate: tranche
    };
}

function candidateFromPlannedSource(source, profile, index, profileRank = undefined) {
    const capacity = Math.max(0, finiteNumber(source?.brutto));
    const bucket = resolveAssetBucket(source);
    if (!bucket || capacity <= EPSILON) return null;
    const tqf = readConfirmedTqf(source, profile, bucket);
    const taxExempt = source?.taxExempt === true;
    const realizedRatio = hasFiniteValue(source?.realizedGainSigned)
        ? finiteNumber(source.realizedGainSigned) / capacity
        : finiteNumber(source?.gainQuoteSigned, finiteNumber(source?.gainQuotePlan));
    const taxableRatio = hasFiniteValue(source?.taxableAfterTqfSigned)
        ? finiteNumber(source.taxableAfterTqfSigned) / capacity
        : (taxExempt ? 0 : realizedRatio * (1 - tqf));
    const purchaseStamp = purchaseStampOf(source?.purchaseDate);
    return {
        key: `${profile.profileId}:${source?.trancheId || source?.isin || source?.name || 'planned'}:${bucket}:planned-${index}`,
        profile,
        sourceProfileId: profile.profileId,
        sourceProfileName: profile.name || profile.profileId,
        bucket,
        kind: source?.kind || (bucket === 'equity' ? 'aktien_neu' : bucket),
        category: source?.category || bucket,
        trancheId: source?.trancheId || null,
        name: source?.name || null,
        isin: source?.isin || null,
        purchaseDate: source?.purchaseDate || null,
        purchaseStamp,
        tqf,
        taxExempt,
        capacity,
        realizedRatio,
        taxableRatio,
        taxTerms: null,
        profileRank,
        sourceTemplate: source,
        plannedSourceFallback: true
    };
}

/** Rang je Profil-ID in localeCompare-Ordnung; undefined, falls zwei IDs dort gleich wären (dann weiter localeCompare). */
function profileRanks(profiles) {
    const ids = profiles.map(profile => String(profile.profileId)).sort((left, right) => left.localeCompare(right));
    for (let index = 1; index < ids.length; index += 1) if (ids[index - 1].localeCompare(ids[index]) === 0) return null;
    return new Map(ids.map((id, index) => [id, index]));
}

export function buildAssetCandidates(profiles, plannedSources) {
    const ranks = profileRanks(profiles);
    const rankOf = profile => ranks ? ranks.get(String(profile.profileId)) : undefined;
    const candidates = profiles.flatMap(profile => buildProfileOwnedTranches(profile)
        .map((tranche, index) => candidateFromTranche(tranche, profile, index, rankOf(profile)))
        .filter(Boolean));
    plannedSources.forEach((source, index) => {
        const profile = profiles.find(entry => entry.profileId === source.sourceProfileId);
        const bucket = resolveAssetBucket(source);
        const matchingCandidates = candidates.filter(candidate => (
            candidate.sourceProfileId === source.sourceProfileId && candidate.bucket === bucket
        ));
        const exactCandidateExists = source?.trancheId && matchingCandidates.some(candidate => candidate.trancheId === source.trancheId);
        if (exactCandidateExists || (!source?.trancheId && matchingCandidates.length > 0)) return;
        // Drei Töpfe plant den Anleihenverkauf für den Haushalt. Die geplante
        // Person ist kein Besitznachweis; nur reale Anleihentranchen anbieten.
        // Die bestehende Auswahl verteilt danach unverändert unter den Besitzern.
        if (bucket === 'bonds') {
            if (candidates.some(candidate => candidate.bucket === bucket)) return;
            throw new Error(`Profilverbund: Datenfehler bei ${assetContext(profile, bucket)}: Für den geplanten Verkauf ist im Haushalt keine passende Tranche vorhanden.`);
        }
        const fallback = candidateFromPlannedSource(source, profile, index, rankOf(profile));
        if (fallback) candidates.push(fallback);
    });
    return candidates;
}

export function buildAssetBlueprint(plannedSources) {
    const order = [];
    const grossByBucket = new Map();
    plannedSources.forEach(source => {
        const bucket = resolveAssetBucket(source);
        if (!bucket) {
            throw new Error(`Profilverbund: Verkaufsquelle ${source?.kind || source?.category || 'unbekannt'} besitzt keine attribuierbare Assetklasse.`);
        }
        if (!grossByBucket.has(bucket)) order.push(bucket);
        grossByBucket.set(bucket, (grossByBucket.get(bucket) || 0) + Math.max(0, finiteNumber(source.brutto)));
    });
    return { order, grossByBucket };
}

export function stableCandidateComparison(left, right) {
    if (left.taxableRatio !== right.taxableRatio) return left.taxableRatio - right.taxableRatio;
    // profileRank: Reihenfolge der Profil-IDs nach localeCompare, einmal je Attribution bestimmt (nur Vorzeichen zählt).
    const profileOrder = left.profileRank !== undefined && right.profileRank !== undefined
        ? left.profileRank - right.profileRank
        : String(left.sourceProfileId).localeCompare(String(right.sourceProfileId));
    if (profileOrder !== 0) return profileOrder;
    if (left.purchaseStamp !== right.purchaseStamp) return left.purchaseStamp - right.purchaseStamp;
    return String(left.key).localeCompare(String(right.key));
}

export function sourceFromCandidate(candidate, gross) {
    const brutto = Math.max(0, finiteNumber(gross));
    const realizedGainSigned = brutto * candidate.realizedRatio;
    const taxableAfterTqfSigned = brutto * candidate.taxableRatio;
    return {
        kind: candidate.kind,
        category: candidate.category,
        trancheId: candidate.trancheId,
        sourceProfileId: candidate.sourceProfileId,
        sourceProfileName: candidate.sourceProfileName,
        name: candidate.name,
        isin: candidate.isin,
        purchaseDate: candidate.purchaseDate,
        brutto,
        steuer: 0,
        netto: brutto,
        tqf: candidate.tqf,
        taxExempt: candidate.taxExempt === true,
        gainQuotePlan: Math.max(0, candidate.realizedRatio),
        gainQuoteSigned: candidate.realizedRatio,
        realizedGainSigned,
        taxableAfterTqfSigned
    };
}

export function appendCandidateSelection(selected, candidate, gross) {
    if (gross <= EPSILON) return;
    const existing = selected.get(candidate.key);
    selected.set(candidate.key, {
        candidate,
        gross: (existing?.gross || 0) + gross
    });
}
