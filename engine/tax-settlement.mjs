/**
 * Module: Tax Settlement
 * Purpose: Calculates final annual tax and next tax-state based on raw annual sale aggregates.
 *          This module is intentionally pure (no mutation of inputs, no side effects).
 */

/** @param {unknown} value */
function toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** @param {import('../typcheck/rechenkern').TaxState|null|undefined} taxStatePrev */
function sanitizeTaxState(taxStatePrev) {
    const prev = taxStatePrev && typeof taxStatePrev === 'object' ? taxStatePrev : {};
    return {
        lossCarry: Math.max(0, toFiniteNumber(prev.lossCarry, 0))
    };
}

/** Kapitalertragsteuer einschließlich Soli und Kirchensteuer (§ 32d Abs. 1 EStG). */
export function capitalGainsTaxRate(kirchensteuerSatz = 0) {
    const kiSt = Math.max(0, toFiniteNumber(kirchensteuerSatz, 0));
    return 0.25 / (1 + 0.25 * kiSt) * (1 + 0.055 + kiSt);
}

/** @param {import('../typcheck/rechenkern').TaxYearParameters} params */
export function settleTaxYear(params = {}) {
    const taxStatePrev = sanitizeTaxState(params.taxStatePrev);
    const raw = params.rawAggregate && typeof params.rawAggregate === 'object'
        ? params.rawAggregate
        : {};
    const sparerPauschbetrag = Math.max(0, toFiniteNumber(params.sparerPauschbetrag, 0));
    const keSt = capitalGainsTaxRate(params.kirchensteuerSatz);

    const sumTaxableAfterTqfSigned = toFiniteNumber(raw.sumTaxableAfterTqfSigned, 0);
    const sumRealizedGainSigned = toFiniteNumber(raw.sumRealizedGainSigned, 0);

    // Baseline tax without loss carry (still with SPB).
    const positiveBeforeCarry = Math.max(0, sumTaxableAfterTqfSigned);
    const spbUsedBeforeCarry = Math.min(sparerPauschbetrag, positiveBeforeCarry);
    const taxBaseBeforeCarry = Math.max(0, positiveBeforeCarry - spbUsedBeforeCarry);
    const taxBeforeLossCarry = taxBaseBeforeCarry * keSt;

    // Apply existing loss-carry on signed annual taxable base.
    const signedAfterCarry = sumTaxableAfterTqfSigned - taxStatePrev.lossCarry;
    const positiveAfterCarry = Math.max(0, signedAfterCarry);
    const spbUsedThisYear = Math.min(sparerPauschbetrag, positiveAfterCarry);
    const taxBaseAfterCarry = Math.max(0, positiveAfterCarry - spbUsedThisYear);
    const taxDue = taxBaseAfterCarry * keSt;
    const lossCarryNext = Math.max(0, -signedAfterCarry);

    const taxStateNext = { lossCarry: lossCarryNext };

    return {
        taxDue,
        taxStateNext,
        details: {
            keSt,
            sumRealizedGainSigned,
            sumTaxableAfterTqfSigned,
            lossCarryStart: taxStatePrev.lossCarry,
            signedAfterCarry,
            spbUsedThisYear,
            taxBaseBeforeCarry,
            taxBaseAfterCarry,
            taxBeforeLossCarry,
            taxAfterLossCarry: taxDue,
            taxSavedByLossCarry: Math.max(0, taxBeforeLossCarry - taxDue)
        }
    };
}

/** FR-28: Erst persönliche Verluste, dann Partnerausgleich und eigene Pauschbeträge.
 * Restverluste bleiben beim ursprünglichen Eigentümer; Einzeljahre (FR-24) und
 * ausgeschaltete Zusammenveranlagung verwenden unverändert settleTaxYear.
 */
/** @param {import('../typcheck/rechenkern').TaxYearParameters[]} rows */
export function settleHouseholdTaxYear(rows, jointAssessment = false) {
    if (!jointAssessment || rows.length !== 2) return rows.map(settleTaxYear);
    const calculate = /** @param {boolean} useCarry */
    useCarry => {
        const signed = rows.map(row => toFiniteNumber(row.rawAggregate?.sumTaxableAfterTqfSigned)
            - (useCarry ? sanitizeTaxState(row.taxStatePrev).lossCarry : 0));
        const transferredLoss = [0, 0];
        for (let i = 0; i < 2; i++) if (signed[i] < 0 && signed[1 - i] > 0) {
            const used = Math.min(-signed[i], signed[1 - i]);
            signed[i] += used; signed[1 - i] -= used;
            transferredLoss[i] = -used; transferredLoss[1 - i] = used;
        }
        const allowances = rows.map(row => Math.max(0, toFiniteNumber(row.sparerPauschbetrag)));
        const ownUsed = signed.map((value, i) => Math.min(allowances[i], Math.max(0, value)));
        const borrowed = signed.map((value, i) => Math.min(Math.max(0, value - ownUsed[i]), allowances[1 - i] - ownUsed[1 - i]));
        return signed.map((value, i) => ({ signed: value, loss: transferredLoss[i], own: ownUsed[i], borrowed: borrowed[i],
            base: Math.max(0, value - ownUsed[i] - borrowed[i]) }));
    };
    const before = calculate(false), after = calculate(true);
    return rows.map((row, i) => {
        const result = settleTaxYear(row), current = after[i], keSt = result.details.keSt;
        const taxDue = current.base * keSt, taxBeforeLossCarry = before[i].base * keSt;
        return { taxDue, taxStateNext: { lossCarry: Math.max(0, -current.signed) }, details: { ...result.details,
            signedAfterCarry: current.signed, spbUsedThisYear: current.own + current.borrowed,
            taxBaseBeforeCarry: before[i].base, taxBaseAfterCarry: current.base,
            taxBeforeLossCarry, taxAfterLossCarry: taxDue,
            taxSavedByLossCarry: Math.max(0, taxBeforeLossCarry - taxDue),
            jointAssessment: true, partnerLossUsed: current.loss, partnerAllowanceUsed: current.borrowed } };
    });
}

export default { settleTaxYear, settleHouseholdTaxYear };
