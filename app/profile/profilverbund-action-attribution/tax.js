// @ts-check
import { finiteNumber, sum } from './amounts.js';
import { settleHouseholdTaxYear, capitalGainsTaxRate } from '../../../engine/tax-settlement.mjs';

function profileTaxParameters(profile) {
    const inputs = profile?.inputs || {};
    const lastState = profile?.balanceState?.lastState || {};
    return {
        taxStatePrev: lastState.taxState || { lossCarry: 0 },
        sparerPauschbetrag: Math.max(0, finiteNumber(inputs.sparerPauschbetrag)),
        kirchensteuerSatz: Math.max(0, finiteNumber(inputs.kirchensteuerSatz))
    };
}

export function householdSettlements(profiles, rawByProfile) {
    return settleHouseholdTaxYear(profiles.map(profile => ({ ...profileTaxParameters(profile),
        rawAggregate: rawByProfile.get(profile.profileId) })),
        profiles.length === 2 && profiles.every(profile => profile.inputs?.jointAssessment === true));
}

export function previewHouseholdTax(profiles, rawByProfile) {
    if (profiles.length === 2 && profiles.every(profile => profile.inputs?.jointAssessment === true)) {
        return sum(householdSettlements(profiles, rawByProfile).map(row => row.taxDue));
    }
    // Gleiche Summenreihenfolge wie sum(profiles.map(...)), ohne Zwischenarray je Bisektionsschritt.
    let total = 0;
    for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        total = total + finiteNumber(previewTaxDueForScale(profile, rawByProfile.get(profile.profileId), 1));
    }
    return total;
}

function sourceRawAggregate(source, scale = 1) {
    const factor = Math.max(0, finiteNumber(scale, 1));
    const gross = Math.max(0, finiteNumber(source?.brutto)) * factor;
    const realizedRaw = Number(source?.realizedGainSigned);
    const gainQuote = finiteNumber(source?.gainQuoteSigned, finiteNumber(source?.gainQuotePlan));
    const realizedGainSigned = Number.isFinite(realizedRaw)
        ? realizedRaw * factor
        : gross * gainQuote;
    const taxableRaw = Number(source?.taxableAfterTqfSigned);
    const tqf = Math.max(0, Math.min(1, finiteNumber(source?.tqf)));
    const taxableAfterTqfSigned = Number.isFinite(taxableRaw)
        ? taxableRaw * factor
        : (source?.taxExempt === true ? 0 : realizedGainSigned * (1 - tqf));
    return { sumRealizedGainSigned: realizedGainSigned, sumTaxableAfterTqfSigned: taxableAfterTqfSigned };
}

export function addRawAggregate(target, source) {
    target.sumRealizedGainSigned += finiteNumber(source?.sumRealizedGainSigned);
    target.sumTaxableAfterTqfSigned += finiteNumber(source?.sumTaxableAfterTqfSigned);
    return target;
}

export function rawAggregateForSources(sources, scale = 1) {
    return (sources || []).reduce(
        (aggregate, source) => addRawAggregate(aggregate, sourceRawAggregate(source, scale)),
        { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 }
    );
}

/* Nur während eines attributeHouseholdAction-Aufrufs gesetzt: Profile sind dort unveränderlich,
 * die Vorschau läuft aber über 80 Bisektionsschritte je Profil. */
export let previewTermsScope = null;

// Interner Schreibzugriff; die importierte Bindung bleibt live.
export function setPreviewTermsScope(value) {
    previewTermsScope = value;
}

function previewTaxTerms(profile) {
    const cached = previewTermsScope?.get(profile);
    if (cached) return cached;
    const params = profileTaxParameters(profile);
    const terms = {
        lossCarry: Math.max(0, finiteNumber(params.taxStatePrev?.lossCarry)),
        sparerPauschbetrag: params.sparerPauschbetrag,
        taxRate: capitalGainsTaxRate(params.kirchensteuerSatz)
    };
    if (previewTermsScope && profile && typeof profile === 'object') previewTermsScope.set(profile, terms);
    return terms;
}

function previewTaxDueForScale(profile, rawAggregateAtFullScale, scale) {
    const terms = previewTaxTerms(profile);
    const taxable = finiteNumber(rawAggregateAtFullScale?.sumTaxableAfterTqfSigned) * scale;
    const positiveAfterCarry = Math.max(0, taxable - terms.lossCarry);
    const taxBase = Math.max(0, positiveAfterCarry - terms.sparerPauschbetrag);
    return taxBase * terms.taxRate;
}

/** Steuerparameter eines Kandidaten sind während einer Attribution konstant: einmal je Kandidat ableiten. */
export function candidateTaxTerms(candidate) {
    let terms = candidate.taxTerms;
    if (terms) return terms;
    const params = profileTaxParameters(candidate.profile);
    terms = {
        allowanceBase: Math.max(0, finiteNumber(params.taxStatePrev?.lossCarry)) + params.sparerPauschbetrag,
        keSt: capitalGainsTaxRate(params.kirchensteuerSatz)
    };
    candidate.taxTerms = terms;
    return terms;
}

export function allocateSettlementTaxToSources(sources, taxDue) {
    if (!sources.length) return [];
    const positiveTaxable = sources.map(source => Math.max(0, finiteNumber(source.taxableAfterTqfSigned)));
    const taxableTotal = sum(positiveTaxable);
    const weights = taxableTotal > 0 ? positiveTaxable : sources.map(source => finiteNumber(source.brutto));
    const weightTotal = sum(weights);
    let taxRemaining = Math.max(0, finiteNumber(taxDue));

    return sources.map((source, index) => {
        const isLast = index === sources.length - 1;
        const allocatedTax = isLast
            ? taxRemaining
            : Math.min(taxRemaining, taxDue * (weightTotal > 0 ? weights[index] / weightTotal : 0));
        taxRemaining -= allocatedTax;
        return {
            ...source,
            steuerPlan: finiteNumber(source.steuer),
            steuer: allocatedTax,
            netto: finiteNumber(source.brutto) - allocatedTax
        };
    });
}
