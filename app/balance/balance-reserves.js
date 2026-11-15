import { remainingAnnualAction, annualActionPlanLines } from './annual-action-progress.js';
import { resolveTargetTagesgeld, withProfileLiquidityTargets } from './balance-play-execution.js';
import { displayUp, displayDown, displayRoundingStep, displayActionAmount, displayedBuyTotal } from '../shared/display-rounding.js';
import { confirmedCarrier } from './balance-action-origin.js';
/** @import { projectAnnualActionProgress } from './annual-action-progress.js' */
/** Lesende Bestandsprojektion der fertig vorbereiteten Buchungszeilen, vor Auszahlung. */
/** @param {import('../../typcheck/balance-ui.js').Ui} ui @param {import('../../typcheck/balance-ui.js').ActionEntry[]} [entries]
 * @param {{targetEntries?: {profileId?: string, name?: string, tagesgeldTarget?: number}[]|null, settled?: boolean}} [options] `targetEntries` liefert die
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
    // RK-4 (Ergänzung 1 FR-80): Bei „Eine Person trägt“ ist die andere Person gekennzeichnet; ihr Tagesgeld zählt für die Anzeige gesondert.
    const key = (/** @type {any} */ entry) => entry.profileId ?? entry.name;
    const heldKeys = new Set(entries.filter(entry => entry.action?.carrierHold === true).map(key));
    /** @type {{before: number, after: number}|null} */
    let held = null;
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
            if (heldKeys.size) held = { before: sum(entries.filter(entry => heldKeys.has(key(entry))), entry => entry.input.tagesgeld),
                after: sum(projected.filter((_, i) => heldKeys.has(key(entries[i]))), row => row.tagesgeld) };
            // Dieselbe gebundene Pflegevorsorge wie im heutigen operativen Bestand.
            after.liquidity = after.tagesgeld + after.geldmarkt - (finite(operative) && finite(liquidity)
                ? before.tagesgeld + before.geldmarkt - operative : 0);
        }
    }
    // Ist der Beleg ganz umgesetzt, entspricht „nach Umsetzung“ dem heutigen Stand.
    if (!after && settled && finite(before.tagesgeld) && finite(before.geldmarkt)) after = { ...before, liquidity };
    const mark = (/** @type {any} */ entry) => heldKeys.has(key(entry)) ? { held: true } : {};
    return { before: { ...before, liquidity }, after, targets: targetEntries ? targetEntries.map(entry => ({ name: entry.name, target: entry.tagesgeldTarget, ...mark(entry) }))
        : entries.map(entry => ({ name: entry.name, target: entry.tagesgeldTarget ?? entry.cashSplit?.zielTagesgeld ?? entry.input?.personalTagesgeldTarget, ...mark(entry) })),
    target: ui.zielLiquiditaet, ...(held ? { held } : {}) };
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
 * @param {{cashTarget?: number|null, shownCashTarget?: number|null, inflow?: number|null, liquidityTarget?: number|null, heldCash?: number|null}} [options]
 * `cashTarget` genaues Tagesgeldziel, `shownCashTarget` das angezeigte (Summe der angezeigten Personenziele), `inflow` angezeigter
 * Zufluss (mit Vorzeichen) zur Liquidität, `liquidityTarget` genaues Liquiditätsziel. `heldCash` (RK-4): unverändertes Tagesgeld der
 * nicht tragenden Person; die Ziele gelten dann nur für die übrigen Personen, ihr Tagesgeld steht unverändert daneben. */
export function displayedReserves(view, { cashTarget = null, shownCashTarget = null, inflow = null, liquidityTarget = null, heldCash = null } = {}) {
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
    const shownTarget = finite(shownCashTarget) ? /** @type {number} */ (shownCashTarget) : finite(cashTarget) ? displayUp(cashTarget) : null;
    const offset = finite(heldCash) ? /** @type {number} */ (heldCash) : 0;
    const target = shownTarget === null ? null : shownTarget + offset;
    const reached = finite(cashTarget) ? after.tagesgeld >= /** @type {number} */ (cashTarget) + offset - 0.5 : null;
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
    return { before, after: { tagesgeld, geldmarkt, liquidity }, cashTarget: shownTarget };
}

/** Ergänzung 3 FR-78: Deckung aus angezeigten Beträgen. Erreicht der genaue Wert 100 %, steht nie weniger als 100 %.
 * Status, Warnungen und Schwellen rechnen weiter mit dem genauen Wert.
 * @param {number|null|undefined} shown angezeigter Bestand @param {number|null|undefined} shownTarget angezeigtes Ziel
 * @param {number|null|undefined} exact genauer Bestand @param {number|null|undefined} target genaues Ziel
 * @returns {number|null} Prozent */
export function displayedCoverage(shown, shownTarget, exact, target) {
    const finite = Number.isFinite;
    if (!finite(shown) || !finite(shownTarget) || /** @type {number} */ (shownTarget) <= 0) return null;
    const percent = /** @type {number} */ (shown) / /** @type {number} */ (shownTarget) * 100;
    return finite(exact) && finite(target) && /** @type {number} */ (target) > 0 && /** @type {number} */ (exact) >= /** @type {number} */ (target) - 0.5
        ? Math.max(100, percent) : percent;
}

/** „Deine Reserven“ wie angezeigt (Ergänzungen 2 und 3 FR-78): Balance und Übersicht nutzen dieselbe Rechnung.
 * Der Zufluss ist die Summe der angezeigten offenen Planzeilen, wenn die Änderung genau diesem Rest entspricht; ein Kauf ohne
 * Planzeilen fließt mit dem angezeigten (abgerundeten) Betrag ab. Tagesgeldziel = Summe der angezeigten Personenziele.
 * @param {import('../../typcheck/balance-ui.js').Reserves} view
 * @param {any} [todoPlan] Plan aus `projectAnnualTodoPlan`
 * @returns {{shown: ReturnType<typeof displayedReserves>, targets: {name?: string, target: number}[], shownTarget: number|null,
 *   coverage: {today: number|null, after: number|null}}} */
export function displayedReserveView(view, todoPlan = null) {
    const finite = Number.isFinite;
    const targets = /** @type {{name?: string, target: number, held?: boolean}[]} */ (view.targets.filter(row => finite(row.target)));
    // RK-4 (Ergänzung 1 FR-80): Bleibt das Tagesgeld der nicht tragenden Person unverändert, rundet „nach Umsetzung“ nur den Teil der
    // tragenden Person, gemessen an ihrem eigenen Ziel. Sonst hinge ihr angezeigtes Ergebnis am Stand der anderen Person.
    const heldCash = view.held && Math.abs(view.held.after - view.held.before) < 0.5 ? view.held.before : null;
    const own = heldCash === null ? targets : targets.filter(row => !row.held);
    const exactTarget = own.length ? own.reduce((sum, row) => sum + row.target, 0) : null;
    const openRows = (todoPlan?.rows || []).filter((/** @type {any} */ row) => row.restNet > 0);
    const delta = view.after && finite(view.before.liquidity) ? view.after.liquidity - /** @type {number} */ (view.before.liquidity) : NaN;
    // VK-3d P4: Ein reiner Kaufplan mit Zeilen je Person fließt mit der Summe der angezeigten Zeilen ab (wie der Kopf der Karte).
    const buyLines = /** @type {any} */ (todoPlan)?.buyFlow?.lines;
    const purchase = !todoPlan?.rows?.length && todoPlan?.purchases?.length && finite(todoPlan.amount)
        && Math.abs(delta + todoPlan.amount) < 1 ? -(buyLines?.length ? displayedBuyTotal(buyLines) : displayActionAmount(todoPlan.verb, todoPlan.amount)) : null;
    const rowsExact = openRows.reduce((/** @type {number} */ sum, /** @type {any} */ row) => sum + row.restNet, 0);
    // VK-3d P4: Teilweise erledigt nennt die Karte den offenen Rest auf den Euro; offen den aufgerundeten Plan.
    const rowsShown = todoPlan?.status === 'teilweise' ? rowsExact : openRows.reduce((/** @type {number} */ sum, /** @type {any} */ row) => sum + displayUp(row.restNet), 0);
    // GN-1 (N3): Bezahlt der Plan aus dem Verkauf auch Käufe, fließen sie mit ihrem angezeigten (abgerundeten) Betrag ab,
    // damit „nach Umsetzung“ = heute + angezeigte Verkäufe − angezeigte Käufe aufgeht.
    const bought = (todoPlan?.purchases || []).filter((/** @type {any} */ item) => item.purchase && finite(item.amount) && item.amount > 0);
    const boughtExact = bought.reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + item.amount, 0);
    const boughtShown = bought.reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + displayActionAmount('Anlage kaufen', item.amount), 0);
    const inflow = !openRows.length ? purchase : Math.abs(delta - rowsExact) < 1 ? rowsShown
        : bought.length && Math.abs(delta - rowsExact + boughtExact) < 1 ? rowsShown - boughtShown : purchase;
    const shown = displayedReserves(view, { cashTarget: exactTarget, shownCashTarget: own.length ? own.reduce((sum, row) => sum + displayUp(row.target), 0) : null,
        inflow, liquidityTarget: view.target, heldCash });
    const shownTarget = finite(view.target) ? displayUp(view.target) : null;
    return { shown, targets, shownTarget, coverage: {
        today: displayedCoverage(view.before.liquidity, shownTarget, view.before.liquidity, view.target),
        after: view.after ? displayedCoverage(shown.after?.liquidity, shownTarget, view.after.liquidity, view.target) : null } };
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
    return confirmedActionSource(currentYear, confirmed);
}

/** Handlung des Belegs (offener Rest) auf heutige Bestände, mit heutigem Ziel und heutigen persönlichen Tagesgeldzielen.
 * Die Balance nimmt sie nur mit Planzeilen; die Spalte „Beschlossener Plan“ der Übersicht auch ohne (GN-2c).
 * @param {any} currentYear @param {{action?: any, progress?: ReturnType<typeof projectAnnualActionProgress>|null}} confirmed */
export function confirmedActionSource(currentYear, confirmed) {
    const action = remainingAnnualAction(confirmed.action, confirmed.progress || null);
    const carried = carrierEntries(action, currentYear.profileActionResults, confirmedCarrier(confirmed)?.carrierId);
    return { action, entries: carried || [{ action, input: currentYear.input, spending: currentYear.spending, targetLiquidity: currentYear.zielLiquiditaet }],
        targetEntries: personalCashTargetEntries(currentYear.profileActionResults, currentYear.zielLiquiditaet),
        settled: Boolean(confirmed.progress?.lines.length) && confirmed.progress.restNet === 0,
        creditPendingNet: confirmed.progress?.creditPendingNet || 0 };
}

/** RK-2 (Ergänzung 1 FR-80): Beleg im Modus „Eine Person trägt“ je Person. Die tragende Person bekommt die Handlung des Belegs,
 * jede andere nur ihre eigenen Verkaufszeilen (Rückgriff nach FR-80 Punkt 3) mit dem Kennzeichen `carrierHold`; ihr Tagesgeld wird so
 * wie in der Vorschau nicht umgeschichtet. Bestände und Ziele je Person aus der Rechnung des laufenden Jahres. Ohne „Eine Person trägt“
 * im Beleg oder ohne Personeneinträge `null` (dann der Haushaltseintrag wie bisher).
 * @param {any} action offener Rest des Belegs @param {any[]|null|undefined} entries Personeneinträge @param {string|null|undefined} carrierId */
function carrierEntries(action, entries, carrierId) {
    if (!carrierId || !Array.isArray(entries) || entries.length < 2 || entries.some(entry => !entry?.input) || !entries.some(entry => entry.profileId === carrierId)) return null;
    const own = (/** @type {any} */ source, /** @type {string} */ profileId) => (source.sourceProfileId ?? carrierId) === profileId;
    const others = (action.quellen || []).filter((/** @type {any} */ source) => !own(source, carrierId));
    const net = (/** @type {any[]} */ sources) => sources.reduce((sum, source) => sum + (Number(source.netto) || 0), 0);
    return entries.map(entry => {
        const base = { profileId: entry.profileId, name: entry.name, input: entry.input, spending: entry.spending, targetLiquidity: entry.targetLiquidity };
        if (entry.profileId === carrierId) {
            const carrier = structuredClone(action);
            carrier.quellen = (action.quellen || []).filter((/** @type {any} */ source) => own(source, carrierId));
            if (others.length && carrier.verwendungen?.liquiditaet > 0) carrier.verwendungen.liquiditaet = Math.max(0, carrier.verwendungen.liquiditaet - net(others));
            return { ...base, action: carrier };
        }
        const sold = structuredClone(others.filter((/** @type {any} */ source) => own(source, entry.profileId)));
        return { ...base, action: { type: sold.length ? 'TRANSACTION' : 'NONE', title: action.title, quellen: sold,
            verwendungen: sold.length ? { liquiditaet: net(sold) } : {}, steuer: sold.reduce((sum, source) => sum + (Number(source.steuer) || 0), 0), carrierHold: true } };
    });
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
        return withProfileLiquidityTargets(entries, householdTarget).map(entry => ({ profileId: entry.profileId, name: entry.name,
            tagesgeldTarget: resolveTargetTagesgeld(entry.spending, entry.targetLiquidity, entry.input) }));
    } catch { return null; }
}
