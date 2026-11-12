import { remainingAnnualAction, annualActionPlanLines } from './annual-action-progress.js';
import { resolveTargetTagesgeld, withProfileLiquidityTargets } from './balance-play-execution.js';
import { displayUp, displayDown, displayRoundingStep } from '../shared/display-rounding.js';
/** @import { projectAnnualActionProgress } from './annual-action-progress.js' */
/** Lesende Bestandsprojektion der fertig vorbereiteten Buchungszeilen, vor Auszahlung. */
/** @param {import('../../typcheck/balance-ui.js').Ui} ui @param {import('../../typcheck/balance-ui.js').ActionEntry[]} [entries]
 * @param {{targetEntries?: {name?: string, tagesgeldTarget?: number}[]|null, settled?: boolean}} [options] `targetEntries` liefert die
 * persönlichen Tagesgeldziele, wenn die Aktion aus dem Jahresbeleg kommt; `settled` heißt: Der Beleg ist vollständig umgesetzt.
 * @returns {import('../../typcheck/balance-ui.js').Reserves} */
export function projectBalanceReserves(ui, entries = [], { targetEntries = null, settled = false } = {}) {
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
    // Ist der Beleg ganz umgesetzt, entspricht „nach Umsetzung“ dem heutigen Stand.
    if (!after && settled && finite(before.tagesgeld) && finite(before.geldmarkt)) after = { ...before, liquidity };
    return { before: { ...before, liquidity }, after, targets: targetEntries ? targetEntries.map(entry => ({ name: entry.name, target: entry.tagesgeldTarget }))
        : entries.map(entry => ({ name: entry.name, target: entry.tagesgeldTarget ?? entry.cashSplit?.zielTagesgeld ?? entry.input?.personalTagesgeldTarget })),
    target: ui.zielLiquiditaet };
}

/** Ergänzung 2 FR-78 und RD-1c: angezeigte Reservewerte, die in sich aufgehen. Heute bleibt genau (Kontostand). Nach Umsetzung
 * entsteht aus den angezeigten Beträgen und kann deshalb über dem genauen Wert liegen:
 * - Ein Topf ohne Änderung bleibt wie heute; eine Änderung unter einer halben Stufe bleibt genau.
 * - Zufluss aufgerundet, bei echter Lücke zum Tagesgeldziel abgerundet; Abfluss aufgerundet, nie unter 0, wenn der genaue Stand es nicht ist.
 * - Geht der ganze angezeigte Zufluss (`inflow`, z. B. Summe der Planzeilen oder minus der angezeigte Kauf) in einen Topf, steht
 *   dort heute + Zufluss; sonst nimmt der Geldmarkt den Rest, solange er nahe am genauen Wert bleibt.
 * - Regel 4: Erreicht ein Stand sein Ziel genau gerechnet (Tagesgeld, Liquidität), steht er nicht unter dem angezeigten Ziel.
 * Die Liquidität ist die Summe der angezeigten Töpfe (ohne Pflegevorsorge). Nur Anzeige; gerechnet wird mit `view`.
 * @param {import('../../typcheck/balance-ui.js').Reserves} view
 * @param {{cashTarget?: number|null, shownCashTarget?: number|null, inflow?: number|null, liquidityTarget?: number|null}} [options]
 * `cashTarget` genaues Tagesgeldziel, `shownCashTarget` das angezeigte (Summe der angezeigten Personenziele), `inflow` angezeigter
 * Zufluss (mit Vorzeichen) zur Liquidität, `liquidityTarget` genaues Liquiditätsziel. */
export function displayedReserves(view, { cashTarget = null, shownCashTarget = null, inflow = null, liquidityTarget = null } = {}) {
    const before = view.before, after = view.after, finite = Number.isFinite;
    if (!after || ![before.tagesgeld, before.geldmarkt, after.tagesgeld, after.geldmarkt].every(finite)) return { before, after, cashTarget: displayUp(cashTarget) };
    const still = (/** @type {number} */ delta) => Math.abs(delta) < 0.5;
    /** @param {number} delta @param {boolean|null} gap echte Lücke zum Ziel */
    const shownChange = (delta, gap = null) => {
        const size = Math.abs(delta);
        if (still(delta)) return 0;
        if (size < displayRoundingStep(size) / 2) return delta;
        return delta > 0 ? gap ? displayDown(size) : displayUp(size) : -displayUp(size);
    };
    const floorAtZero = (/** @type {number} */ shown, /** @type {number} */ exact) => exact >= 0 && shown < 0 ? 0 : shown;
    const dTg = after.tagesgeld - before.tagesgeld, dGm = after.geldmarkt - before.geldmarkt;
    const target = finite(shownCashTarget) ? /** @type {number} */ (shownCashTarget) : finite(cashTarget) ? displayUp(cashTarget) : null;
    const reached = finite(cashTarget) ? after.tagesgeld >= /** @type {number} */ (cashTarget) - 0.5 : null;
    let tagesgeld = still(dTg) ? before.tagesgeld : finite(inflow) && still(dGm) ? before.tagesgeld + /** @type {number} */ (inflow)
        : before.tagesgeld + shownChange(dTg, reached === false);
    if (!still(dTg) && target !== null) {
        if (reached && tagesgeld < target) tagesgeld = target;
        if (reached === false && tagesgeld >= target) tagesgeld = Math.min(before.tagesgeld + shownChange(dTg, true), after.tagesgeld);
    }
    tagesgeld = floorAtZero(tagesgeld, after.tagesgeld);
    let geldmarkt = still(dGm) ? before.geldmarkt : before.geldmarkt + shownChange(dGm);
    if (!still(dGm) && finite(inflow)) {
        const rest = still(dTg) ? before.geldmarkt + /** @type {number} */ (inflow) : before.geldmarkt + /** @type {number} */ (inflow) - (tagesgeld - before.tagesgeld);
        if (Math.sign(rest - before.geldmarkt) === Math.sign(dGm) && Math.abs(rest - after.geldmarkt) <= displayRoundingStep(Math.abs(dGm))) geldmarkt = rest;
    }
    geldmarkt = floorAtZero(geldmarkt, after.geldmarkt);
    const care = finite(before.liquidity) ? before.tagesgeld + before.geldmarkt - /** @type {number} */ (before.liquidity) : 0;
    let liquidity = tagesgeld + geldmarkt - care;
    // Regel 4 auch für das Liquiditätsziel: Der Ausgleich geht in einen Topf, der sich ohnehin ändert.
    const shownLiquidityTarget = finite(liquidityTarget) ? displayUp(liquidityTarget) : null;
    if (shownLiquidityTarget !== null && finite(after.liquidity) && after.liquidity >= /** @type {number} */ (liquidityTarget) - 0.5 && liquidity < shownLiquidityTarget) {
        const lift = shownLiquidityTarget - liquidity;
        if (!still(dGm)) { geldmarkt += lift; liquidity += lift; } else if (!still(dTg)) { tagesgeld += lift; liquidity += lift; }
    }
    return { before, after: { tagesgeld, geldmarkt, liquidity }, cashTarget: target };
}

/** S6 und GU-1b: Aktion für Reserven „nach Umsetzung“ und Diagnose im laufenden Jahr. Eine festgeschriebene Handlungsanweisung
 * des Jahres hat Vorrang, weil die Seite genau sie zeigt, aber nur mit ihrem offenen Rest (FR-77 Punkt 2): Was schon verkauft
 * und gutgeschrieben ist, steckt im heutigen Stand. Ohne Beleg gilt die Rechnung mit heutigen Werten wie bisher.
 * @param {{action?: any, input?: any, spending?: any, zielLiquiditaet?: number, profileActionResults?: any[]|null}} currentYear
 * @param {{action?: any, progress?: ReturnType<typeof projectAnnualActionProgress>|null}|null} [confirmed] Beleg aus `projectBalanceActionOrigin`
 * samt Umsetzungsstand.
 * @returns {{action: any, entries: any[], targetEntries: {name?: string, tagesgeldTarget?: number}[]|null, settled: boolean, creditPendingNet: number}} */
export function currentYearActionSource(currentYear, confirmed = null) {
    // WT-1 (Gutachten GU1B-FABLE Befund 1): Ein Beleg ohne Verkaufszeile (nur Käufe aus der Liquidität) hat keinen ableitbaren
    // Umsetzungsstand; er rechnet wie vor GU-1 mit der Neuberechnung zu heutigen Beständen, damit kein Kauf doppelt zählt.
    if (!confirmed?.action || !annualActionPlanLines(confirmed.action).length) return recalculatedActionSource(currentYear);
    const action = remainingAnnualAction(confirmed.action, confirmed.progress || null);
    return { action, entries: [{ action, input: currentYear.input, spending: currentYear.spending, targetLiquidity: currentYear.zielLiquiditaet }],
        targetEntries: personalCashTargetEntries(currentYear.profileActionResults, currentYear.zielLiquiditaet),
        settled: Boolean(confirmed.progress?.lines.length) && confirmed.progress.restNet === 0,
        creditPendingNet: confirmed.progress?.creditPendingNet || 0 };
}

/** Neuberechnung des laufenden Jahres zu heutigen Beständen (wie vor GU-1). @param {any} currentYear */
export function recalculatedActionSource(currentYear) {
    return { action: currentYear.action, entries: currentYear.profileActionResults || [{ action: currentYear.action,
        input: currentYear.input, spending: currentYear.spending, targetLiquidity: currentYear.zielLiquiditaet }], targetEntries: null, settled: false, creditPendingNet: 0 };
}

/** Persönliche Tagesgeldziele aus den Personeneinträgen des laufenden Jahres, dieselbe Rechnung wie bei der Aufteilung
 * der Erlöse. @param {any[]|null|undefined} entries @param {number} householdTarget */
export function personalCashTargetEntries(entries, householdTarget) {
    if (!Array.isArray(entries) || entries.length < 2 || entries.some(entry => !entry?.input)) return null;
    try {
        return withProfileLiquidityTargets(entries, householdTarget).map(entry => ({ name: entry.name,
            tagesgeldTarget: resolveTargetTagesgeld(entry.spending, entry.targetLiquidity, entry.input) }));
    } catch { return null; }
}
