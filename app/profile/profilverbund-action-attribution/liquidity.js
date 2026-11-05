// @ts-check
import { finiteNumber, sum, normalizeUses, isLiquiditySource, actionAmountsChanged } from './amounts.js';

export function allocateLiquiditySources(totalAmount, profiles, mode) {
    const totalCents = Math.max(0, Math.round(finiteNumber(totalAmount) * 100));
    const entries = profiles.map((profile, index) => ({
        profile,
        index,
        capacityCents: Math.max(0, Math.round((
            finiteNumber(profile?.inputs?.tagesgeld) + finiteNumber(profile?.inputs?.geldmarktEtf)
        ) * 100))
    }));
    const totalCapacity = sum(entries.map(entry => entry.capacityCents));
    if (totalCents > totalCapacity + 1) {
        throw new Error(`Profilverbund: Liquiditaetsquelle ist um ${((totalCents - totalCapacity) / 100).toFixed(2)} EUR unterdeckt.`);
    }

    const allocations = new Array(entries.length).fill(0);
    if (mode === 'tax_optimized') {
        let remaining = totalCents;
        entries.slice()
            .sort((left, right) => String(left.profile.profileId).localeCompare(String(right.profile.profileId)))
            .forEach(entry => {
                const used = Math.min(remaining, entry.capacityCents);
                allocations[entry.index] = used;
                remaining -= used;
            });
    } else if (totalCapacity > 0) {
        const rows = entries.map(entry => {
            const exact = totalCents * (entry.capacityCents / totalCapacity);
            return {
                ...entry,
                cents: Math.min(entry.capacityCents, Math.floor(exact)),
                fraction: exact - Math.floor(exact)
            };
        });
        let remaining = totalCents - sum(rows.map(row => row.cents));
        rows.slice()
            .sort((left, right) => (right.fraction - left.fraction) || (left.index - right.index))
            .forEach(row => {
                if (remaining <= 0) return;
                const capacityLeft = row.capacityCents - rows[row.index].cents;
                if (capacityLeft <= 0) return;
                rows[row.index].cents += 1;
                remaining -= 1;
            });
        if (remaining > 0) {
            rows.forEach(row => {
                if (remaining <= 0) return;
                const used = Math.min(remaining, row.capacityCents - row.cents);
                row.cents += used;
                remaining -= used;
            });
        }
        rows.forEach(row => { allocations[row.index] = row.cents; });
    }

    const allocated = sum(allocations);
    if (Math.abs(allocated - totalCents) > 1) {
        throw new Error(`Profilverbund: ${(Math.abs(totalCents - allocated) / 100).toFixed(2)} EUR Liquiditaet konnten keinem Profil zugeordnet werden.`);
    }

    return entries.flatMap(entry => {
        const amount = allocations[entry.index] / 100;
        if (amount <= 0) return [];
        return [{
            source: 'Liquidität',
            kind: 'liquiditaet',
            brutto: amount,
            netto: amount,
            steuer: 0,
            sourceProfileId: entry.profile.profileId
        }];
    });
}

/**
 * @param action Geplante oder endgültig attribuierte Aktion.
 * @returns Liquiditätsänderung der Aktion in Euro.
 */
export function calculateActionLiquidityDelta(action = {}) {
    const uses = normalizeUses(action.verwendungen || {});
    const liquidityOutflow = (Array.isArray(action.quellen) ? action.quellen : [])
        .filter(isLiquiditySource)
        .reduce((total, source) => total + Math.max(0, finiteNumber(source?.brutto)), 0);
    return finiteNumber(uses.liquiditaet) - liquidityOutflow;
}

/**
 * @param options Optionen und Abhängigkeiten des bestehenden Aufrufers.
 * @returns Abgeglichene Liquiditätskennzahlen oder null ohne Ergebnis.
 */
export function reconcileHouseholdLiquidityKpis({ modelResult, inputData, action }) {
    if (!modelResult?.ui) return null;
    const liquidityBefore = finiteNumber(inputData?.tagesgeld) + finiteNumber(inputData?.geldmarktEtf);
    const liquidityAfter = liquidityBefore + calculateActionLiquidityDelta(action);
    const targetLiquidity = Math.max(0, finiteNumber(modelResult.ui.zielLiquiditaet));
    const coverage = value => targetLiquidity > 0 ? (value / targetLiquidity) * 100 : 100;
    const monthlyWithdrawal = Math.max(0, finiteNumber(modelResult.ui?.spending?.monatlicheEntnahme));
    const runwayMonths = monthlyWithdrawal > 0 ? liquidityAfter / monthlyWithdrawal : Infinity;

    modelResult.ui.liquiditaet = {
        ...(modelResult.ui.liquiditaet || {}),
        deckungVorher: coverage(liquidityBefore),
        deckungNachher: coverage(liquidityAfter)
    };
    modelResult.ui.runway = { ...(modelResult.ui.runway || {}), months: runwayMonths };
    modelResult.diagnosis = modelResult.diagnosis || {};
    modelResult.diagnosis.general = modelResult.diagnosis.general || {};
    modelResult.diagnosis.general.deckungVorher = coverage(liquidityBefore);
    modelResult.diagnosis.general.deckungNachher = coverage(liquidityAfter);
    modelResult.diagnosis.general.runwayMonate = runwayMonths;
    return { liquidityBefore, liquidityAfter, targetLiquidity, runwayMonths };
}

/** Diagnose nach der persönlichen Steuerauflösung aus der endgültigen Aktion. */
/**
 * @param state Vorhandener Fachzustand.
 * @param before Bisheriger bestätigter Wert.
 * @param action Geplante oder endgültig attribuierte Aktion.
 * @returns Diagnose mit den Beträgen der endgültigen Aktion.
 */
export function reconcileAttributedThreeBucketState(state, before, action) {
    if (!state?.is3Bucket || !actionAmountsChanged(before, action)) return state;
    const sources = action.quellen || [];
    const assetSources = sources.filter(source => !isLiquiditySource(source));
    const bondSaleAmount = sum(assetSources.filter(source => source.category === 'bonds'
        || ['anleihe', 'bonds', 'bond'].includes(source.kind)).map(source => source.brutto));
    const bondRefillNet = Math.max(0, finiteNumber(action.verwendungen?.bonds));
    // Die finalen Quellen finanzieren die Verwendungen gemeinsam. Brutto und
    // Steuer der Auffüllung folgen ihrem Anteil am gesamten Nettoerlös.
    const fraction = action.nettoErlös > 0 ? bondRefillNet / action.nettoErlös : 0;
    return { ...state, bondRefillNet, bondRefillGross: sum(assetSources.map(source => source.brutto)) * fraction,
        bondRefillTax: finiteNumber(action.steuer) * fraction, bondSaleAmount,
        bondBucketAfter: Math.max(0, state.bondBucketBefore - bondSaleAmount + bondRefillNet),
        unmetLiquidity: Math.max(0, finiteNumber(state.unmetLiquidity) + finiteNumber(before.verwendungen?.liquiditaet)
            - finiteNumber(action.verwendungen?.liquiditaet)) };
}
