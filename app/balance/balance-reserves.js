/** Lesende Bestandsprojektion der fertig vorbereiteten Buchungszeilen, vor Auszahlung. */
/** @param {import('../../typcheck/balance-ui.js').Ui} ui @param {import('../../typcheck/balance-ui.js').ActionEntry[]} [entries] @returns {import('../../typcheck/balance-ui.js').Reserves} */
export function projectBalanceReserves(ui, entries = []) {
    const input = ui.input || {}, finite = Number.isFinite;
    const sum = (items, read) => items.reduce((total, item) => total + read(item), 0);
    const before = { tagesgeld: input.tagesgeld, geldmarkt: input.geldmarktEtf };
    const operative = ui.healthBucketDiagnostics?.operativeLiquidity;
    const liquidity = finite(operative) ? operative : finite(before.tagesgeld) && finite(before.geldmarkt)
        ? before.tagesgeld + before.geldmarkt : null;
    /** @type {import("../../typcheck/balance-ui.js").Reserves["after"]} */
    let after = null;
    const proposal = entries.some(entry => (entry.action?.quellen || []).some(source => source.brutto > 0)
        || Object.values(entry.action?.verwendungen || {}).some(amount => amount > 0));
    if (proposal && entries.every(entry => !entry.action?.automaticExecutionBlocked && finite(entry.input?.tagesgeld) && finite(entry.input?.geldmarktEtf))) {
        const projected = entries.map(entry => {
            const action = entry.action, uses = action.verwendungen || {}, sources = action.quellen || [];
            const sales = sources.filter(source => source.kind !== 'liquiditaet' && source.source !== 'Liquidität');
            const cashSales = action.cashOutflowSales || [];
            const moneyMarketOut = sum(sources.filter(source => source.kind === 'geldmarkt'), source => source.brutto)
                + (cashSales.length ? sum(cashSales, source => source.brutto) : entry.cashSplit?.fromGeldmarkt || 0);
            const routed = action.liquidityInflowToMoneyMarket || 0;
            const purchases = sum(['aktien', 'gold', 'bonds', 'geldmarkt'], key => uses[key] || 0) + routed;
            const net = source => finite(source.netto) ? source.netto : finite(source.brutto) && finite(source.steuer) ? source.brutto - source.steuer : NaN;
            return { tagesgeld: entry.input.tagesgeld + sum(sales, net) + sum(cashSales, net) - purchases,
                geldmarkt: entry.input.geldmarktEtf - moneyMarketOut + (uses.geldmarkt || 0) + routed };
        });
        if (projected.every(row => finite(row.tagesgeld) && finite(row.geldmarkt))) {
            after = { tagesgeld: sum(projected, row => row.tagesgeld), geldmarkt: sum(projected, row => row.geldmarkt) };
            // Dieselbe gebundene Pflegevorsorge wie im heutigen operativen Bestand.
            after.liquidity = after.tagesgeld + after.geldmarkt - (finite(operative) && finite(liquidity)
                ? before.tagesgeld + before.geldmarkt - operative : 0);
        }
    }
    return { before: { ...before, liquidity }, after, targets: entries.map(entry => ({
        name: entry.name, target: entry.tagesgeldTarget ?? entry.cashSplit?.zielTagesgeld ?? entry.input?.personalTagesgeldTarget
    })), target: ui.zielLiquiditaet };
}
