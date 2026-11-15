// @ts-check
/** FR-80 (TRG-1b): Bei „Eine Person trägt“ entscheidet die Engine weiter für den ganzen Haushalt. Dieser Baustein passt die fertige
 * Haushaltsaktion an, bevor sie den Personen zugeordnet wird, und zwar in Balance und Simulator gleich:
 * 1. Käufe aus Überschuss nur aus der freien Liquidität der tragenden Person (Liquidität nach ihrer Jahresauszahlung). Reicht sie
 *    nicht, wird der Kauf kleiner; die Liquidität der anderen Person bleibt stehen (vorläufige Entscheidung der Steuerung 13.11.).
 * 2. Reicht ihre Liquidität nicht für ihre Jahresauszahlung, verkauft sie eigene Wertpapiere für den Rest (statt still auf das
 *    Tagesgeld der anderen Person auszuweichen). Erst wenn ihr Vermögen nicht reicht, greift der Plan auf die andere Person zu
 *    (das entscheidet die Auszahlungsverteilung, mit Hinweis).
 * Der Rechenkern bleibt unverändert: Verkauf und Steuer kommen aus derselben Verkaufsrechnung der Engine. */
import { calculateSaleAndTax } from '../../engine/transactions/sale-engine.mjs';
import { CONFIG } from '../../engine/config.mjs';
import { decidedFixedIncomeSurplus } from '../../engine/planners/fixed-income-budget.mjs';
import { quantizeAmount } from '../../engine/transactions/transaction-utils.mjs';

const TOLERANCE = 1;

/** LZ-1 (Ergänzung 2 FR-80): Sicht der Engine für Auffüllen und Anlegen bei „Eine Person trägt“ – nur Tagesgeld und Geldmarkt
 * der tragenden Person. Ausgaben, Flex-Entscheidung und Liquiditätsziel rechnet die Engine weiter für den Haushalt (`transactionView`).
 * VN-3 (Ergänzung 1 FR-80): Auch die Wertpapiere sind nur die der tragenden Person (`holdings`, wie die Todesjahr-Sicht TJ-2). Reicht
 * ihr Depot nicht für das Ziel, bleibt das Ziel unerreicht; die andere Person verkauft nie fürs Auffüllen.
 * @param {{tagesgeld?: number, geldmarktEtf?: number}} account
 * @param {{depotwertAlt: number, depotwertNeu: number, goldWert: number, detailledTranches: any[]}|null} [holdings] Eigene Bestände.
 * @returns {{aktuelleLiquiditaet: number, tagesgeld: number, geldmarktEtf: number} & Record<string, any>} */
export function carrierTransactionView(account, holdings = null) {
    const tagesgeld = Math.max(0, Number(account?.tagesgeld) || 0), geldmarktEtf = Math.max(0, Number(account?.geldmarktEtf) || 0);
    return { ...(holdings || {}), aktuelleLiquiditaet: tagesgeld + geldmarktEtf, tagesgeld, geldmarktEtf };
}

/** VN-3 (Ergänzung 1 FR-80): Personen für die Zuordnung bei aktiver Sicht der tragenden Person. Die andere Person hat dort weder
 * Lose noch Liquidität (wie TJ-2b `onlyProfileId`/`onlyProfileCash` im Simulator), damit sie fürs Auffüllen nie verkauft oder zahlt.
 * @template {{profileId: string, inputs?: any}} P @param {P[]} profiles @param {string} carrierId @returns {P[]} */
export function carrierOnlyProfiles(profiles, carrierId) {
    return profiles.map(profile => profile.profileId === carrierId ? profile : { ...profile, tranches: [], hasExplicitTrancheOverride: true,
        inputs: { ...profile.inputs, tagesgeld: 0, geldmarktEtf: 0 } });
}

/** VN-3: Investiertes Kapital, mit dem die Engine in der Sicht entschieden hat (Depot plus Liquidität der Sicht).
 * @param {any} input Haushaltseingabe der Engine. @param {any} view Sicht aus {@link carrierTransactionView}. @returns {number} */
export function carrierViewCapital(input, view) {
    const depot = view.detailledTranches ? view : input;
    return (depot.depotwertAlt || 0) + (depot.depotwertNeu || 0) + (input.goldAktiv ? depot.goldWert || 0 : 0) + (view.aktuelleLiquiditaet || 0);
}

/** VN-3 (Ergänzung 1 FR-80): Fehlbetrag der Reserve der tragenden Person, wenn ihr eigenes Vermögen nicht für das Liquiditätsziel
 * reicht (Hinweis „Reserve von … unter Ziel“). 0, wenn das Ziel erreicht ist oder ihr noch genug Wertpapiere bleiben (dann hat die
 * Engine aus eigenen Regeln weniger aufgefüllt). Gleich in Balance und Simulator.
 * @param {{view: any, target: number, carrierAction: any}} options Sicht der Engine, Liquiditätsziel, Aktion der tragenden Person.
 * @returns {number} Fehlbetrag in Euro. */
export function carrierReserveShortfall({ view, target, carrierAction }) {
    if (!view?.detailledTranches || !(target > 0)) return 0;
    const sellable = view.detailledTranches.filter((/** @type {any} */ lot) => !/geldmarkt|money_market/i.test(`${lot.category || ''} ${lot.type || ''} ${lot.kind || ''}`))
        .reduce((/** @type {number} */ sum, /** @type {any} */ lot) => sum + amount(lot.marketValue), 0);
    const sources = carrierAction?.quellen || [];
    const sold = sources.filter((/** @type {any} */ source) => source.kind !== 'liquiditaet').reduce((/** @type {number} */ sum, /** @type {any} */ source) => sum + amount(source.brutto), 0);
    const after = amount(view.aktuelleLiquiditaet) + amount(carrierAction?.verwendungen?.liquiditaet) - cashTotal(carrierAction);
    const gap = target - after;
    return gap > TOLERANCE && sellable - sold < gap ? gap : 0;
}

const amount = value => Math.max(0, Number(value) || 0);
const cashSources = action => (action?.quellen || []).filter(source => source.kind === 'liquiditaet');
const cashTotal = action => cashSources(action).reduce((sum, source) => sum + amount(source.brutto), 0);

/** Kürzt die aus Liquidität bezahlten Käufe auf `capacity` (zuerst Aktien, dann Gold, dann Anleihen). Verändert `action`.
 * @param {any} action @param {number} capacity @returns {void} */
export function limitCashInvestment(action, capacity) {
    const cash = cashSources(action);
    const requested = cash.reduce((sum, source) => sum + (source.brutto || 0), 0), invest = Math.min(requested, capacity);
    if (invest >= requested) return;
    let reduction = requested - invest;
    action.verwendungen = { ...action.verwendungen };
    for (const key of ['aktien', 'gold', 'bonds']) {
        const take = Math.min(action.verwendungen[key] || 0, reduction);
        if (take > 0) action.verwendungen[key] -= take; reduction -= take;
    }
    action.quellen = [...(invest > 0 ? [{ kind: 'liquiditaet', source: 'Liquidität', brutto: invest, netto: invest, steuer: 0 }] : []),
        ...action.quellen.filter(source => source.kind !== 'liquiditaet')];
    action.nettoErlös = (action.nettoErlös || 0) - requested + invest;
    if (!action.quellen.length) action.type = 'NONE';
    if (action.details) action.details = { ...action.details, kaufAkt: action.verwendungen.aktien || 0,
        kaufGld: action.verwendungen.gold || 0, verkaufLiquiditaet: invest };
}

/** Gekürzter Kauf aus freier Liquidität. Trägt sie den Engine-Auftrag, bleibt er unverändert. Sonst gilt für den gekürzten Betrag
 * dieselbe Reihenfolge wie bei der Überschussanlage der Engine (C9): Schwelle gegen den ungerundeten Betrag, danach abrunden.
 * Drei Töpfe liefern die Regel mit der Aktion; sonst folgt sie aus Sparjahr, Mindesthandel und investiertem Kapital wie in der Engine.
 * @param {number} requested Kaufauftrag der Engine aus Liquidität.
 * @param {number} free Freie Liquidität.
 * @param {{minimum: number, isSavingsYear: boolean}|undefined} rules Regel der Aktion, falls vorhanden.
 * @param {{input: object, ui: {spending?: object, vpw?: object|null}}} engineResult Jahresergebnis der Engine.
 * @param {number} capital Investiertes Kapital, mit dem die Engine entschieden hat (Depot plus Liquidität).
 * @returns {number} Anzulegender Betrag. */
export function cappedPurchaseAmount(requested, free, rules, engineResult, capital) {
    if (requested <= free) return requested;
    let rule = rules;
    if (!rule) {
        const isSavingsYear = decidedFixedIncomeSurplus({ input: engineResult.input, spending: engineResult.ui.spending,
            vpw: engineResult.ui.vpw }) > 0;
        const minTrade = Math.max(CONFIG.THRESHOLDS.STRATEGY.minTradeAmountStatic,
            capital * CONFIG.THRESHOLDS.STRATEGY.minTradeAmountDynamicFactor);
        rule = { minimum: isSavingsYear || !CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED ? 500 : minTrade, isSavingsYear };
    }
    const value = Math.max(0, free);
    if (rule.isSavingsYear ? value < 500 : value <= rule.minimum) return 0;
    return rule.isSavingsYear ? Math.floor(value * 100) / 100
        : CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED ? quantizeAmount(value, 'floor') : value;
}

const DEFENSIVE_MARKETS = new Set(['bear_deep', 'recovery_in_bear']);
const isBond = lot => [lot.category, lot.type, lot.kind].some(value => /^(bonds?|anleihe)$/i.test(String(value || '')));

/** Verkauf aus eigenen Wertpapieren der tragenden Person für `net` Euro netto; Steuer wie in der Verkaufsrechnung der Engine.
 * VK-2b P2-2: Anleihen zählen mit. Im Bärenmarkt (wie die Engine im Vorgabemodus) zuerst Anleihen, dann Aktien und Gold; sonst
 * Anleihen zuletzt. Verändert `action`. @returns {{raised: number, breakdown: any[]}} erzielter Nettoerlös und verkaufte Teile */
function addCarrierSale(action, carrierId, net, { lots, kirchensteuerSatz = 0, market = {} }) {
    const own = (lots || []).filter(lot => (lot.sourceProfileId ?? carrierId) === carrierId && amount(lot.marketValue) > 0.005);
    if (!own.length || !(net > 0)) return { raised: 0, breakdown: [] };
    const bonds = own.filter(isBond), others = own.filter(lot => !isBond(lot));
    const groups = (DEFENSIVE_MARKETS.has(/** @type {any} */ (market)?.sKey) ? [bonds, others] : [others, bonds]).filter(group => group.length);
    let raised = 0, brutto = 0, steuer = 0, gain = 0, taxable = 0;
    const breakdown = [];
    for (const group of groups) {
        const rest = net - raised;
        if (rest <= 0.01) break;
        const sale = calculateSaleAndTax(Math.max(2, rest), /** @type {any} */ ({ detailledTranches: group, sparerPauschbetrag: 0, kirchensteuerSatz, goldAktiv: true }),
            { minGold: 0 }, /** @type {any} */ (market || {}), true);
        if (!(sale.bruttoVerkaufGesamt > 0)) continue;
        raised += sale.achievedRefill; brutto += sale.bruttoVerkaufGesamt; steuer += sale.steuerGesamt;
        gain += sale.sumRealizedGainSigned; taxable += sale.sumTaxableAfterTqfSigned;
        breakdown.push(...sale.breakdown);
    }
    if (!(brutto > 0)) return { raised: 0, breakdown: [] };
    const sources = breakdown.map(source => ({ ...source, sourceProfileId: carrierId }));
    action.quellen = [...(action.quellen || []), ...sources];
    action.verwendungen = { ...(action.verwendungen || {}), liquiditaet: (action.verwendungen?.liquiditaet || 0) + raised };
    action.nettoErlös = (action.nettoErlös || 0) + raised;
    action.steuer = (action.steuer || 0) + steuer;
    if (Number.isFinite(action.bruttoVerkaufGesamt)) action.bruttoVerkaufGesamt += brutto;
    if (action.taxRawAggregate) action.taxRawAggregate = {
        sumRealizedGainSigned: (action.taxRawAggregate.sumRealizedGainSigned || 0) + gain,
        sumTaxableAfterTqfSigned: (action.taxRawAggregate.sumTaxableAfterTqfSigned || 0) + taxable };
    if (action.type !== 'TRANSACTION') {
        action.type = 'TRANSACTION';
        action.title = 'Verkauf für die Jahresauszahlung';
    }
    return { raised, breakdown };
}

/** VK-2b P1-2: Restbestand nach einem Verkauf. Jeder Bestand wird höchstens einmal verkauft; ein verkaufter Teil mindert Marktwert,
 * Einstand und Stück anteilig, ein ganz verkaufter fällt weg. @param {any[]} lots @param {any[]} breakdown @returns {any[]} */
export function lotsAfterSale(lots, breakdown) {
    const sold = new Map();
    for (const part of breakdown) sold.set(part.trancheId, (sold.get(part.trancheId) || 0) + amount(part.brutto));
    return lots.flatMap(lot => {
        const value = amount(lot.marketValue), take = Math.min(value, sold.get(lot.trancheId) || 0);
        if (!take) return [lot];
        const keep = value > 0 ? (value - take) / value : 0;
        if (keep * value <= 0.005) return [];
        return [{ ...lot, marketValue: value * keep, costBasis: (Number(lot.costBasis) || 0) * keep,
            ...(Number(lot.shares) > 0 ? { shares: Number(lot.shares) * keep } : {}) }];
    });
}

/** Haushaltsaktion für „Eine Person trägt“ anpassen und zuordnen. `attribute` ordnet eine Haushaltsaktion den Personen zu und meldet
 * je Person, wie viel Liquidität Käufe verbrauchen (`cash`) und wie viel Verkaufserlös aufs Konto kommt (`liquidity`).
 * @template T
 * @param {object} options
 * @param {any} options.action Fertige Haushaltsaktion der Engine (wird nicht verändert).
 * @param {string} options.carrierId Tragende Person.
 * @param {number} options.cashBefore Liquidität der tragenden Person vor der Aktion (Tagesgeld und Geldmarkt).
 * @param {number} options.payout Jahresauszahlung der tragenden Person aus ihrem Vermögen.
 * @param {(action: any) => {cash: (profileId: string) => number, liquidity: (profileId: string) => number, result: T}} options.attribute
 * @param {(requested: number, free: number) => number} options.purchase Gekürzter Kauf nach den Regeln der Engine.
 * @param {{lots: any[], kirchensteuerSatz?: number, market?: object}} options.sale Eigene Wertpapiere der tragenden Person.
 * @returns {{action: any, result: T, purchaseCut: number, carrierSale: number}} */
export function planCarrierAction({ action, carrierId, cashBefore, payout, attribute, purchase, sale }) {
    let current = action, attributed = attribute(current), purchaseCut = 0, carrierSale = 0;
    let lots = [...(sale?.lots || [])];
    for (let step = 0; step < 3; step++) {
        const requested = cashTotal(current);
        const incoming = attributed.liquidity(carrierId);
        // Freie Liquidität der tragenden Person für Käufe: was nach ihrer Jahresauszahlung bleibt.
        const free = Math.max(0, cashBefore + incoming - payout);
        const allowed = requested > free + 0.005 ? Math.min(free, purchase(requested, free)) : requested;
        let changed = false;
        if (allowed < requested - 0.005) {
            current = structuredClone(current);
            limitCashInvestment(current, allowed);
            purchaseCut += requested - allowed;
            changed = true;
        }
        const shortfall = payout - (cashBefore - (changed ? allowed : attributed.cash(carrierId)) + incoming);
        if (shortfall > TOLERANCE) {
            if (!changed) current = structuredClone(current);
            const { raised, breakdown } = addCarrierSale(current, carrierId, shortfall, { ...sale, lots });
            lots = lotsAfterSale(lots, breakdown);
            carrierSale += raised;
            changed = changed || raised > 0;
        }
        if (!changed) break;
        attributed = attribute(current);
    }
    return { action: current, result: attributed.result, purchaseCut, carrierSale };
}

/** Zuordnung je Person aus Personenaktionen (`[{profileId, action}]`).
 * @param {{profileId: string, action: any}[]} entries */
export function carrierAttributionView(entries) {
    const of = profileId => entries.find(entry => entry.profileId === profileId)?.action;
    return {
        cash: profileId => cashTotal(of(profileId)),
        liquidity: profileId => amount(of(profileId)?.verwendungen?.liquiditaet)
    };
}

/** FR-80 Punkt 3 (P3-4): Verkäufe der anderen Person in einer Aktion bei „Eine Person trägt“ (Rückgriff, mit Hinweis).
 * VK-2b P3-7 (Nachtrag 1): Der Hinweis gilt nur, wenn Vermögen der anderen Person verwendet wird. Mit den Personenaktionen (`entries`)
 * zählt deshalb nur der Teil ihres Verkaufserlöses, der nicht bei ihr bleibt (eigene Liquidität oder eigene Käufe); ein Auffüllverkauf,
 * dessen Erlös auf ihrem Tagesgeld landet, ist kein Rückgriff. Ohne `entries` wie bisher der Bruttoverkauf.
 * @param {{quellen?: any[]}} action @param {string} carrierId @param {{profileId: string, action: any}[]|null} [entries]
 * @returns {{profileId: string, amount: number}[]} */
export function nonCarrierSales(action, carrierId, entries = null) {
    const rows = new Map();
    for (const source of action?.quellen || []) {
        if (source.kind === 'liquiditaet' || !source.sourceProfileId || source.sourceProfileId === carrierId) continue;
        const value = entries ? amount(source.netto ?? (amount(source.brutto) - amount(source.steuer))) : amount(source.brutto);
        rows.set(source.sourceProfileId, (rows.get(source.sourceProfileId) || 0) + value);
    }
    if (entries) for (const [profileId, value] of rows) {
        const uses = entries.find(entry => entry.profileId === profileId)?.action?.verwendungen || {};
        const kept = ['liquiditaet', 'aktien', 'gold', 'bonds'].reduce((sum, key) => sum + amount(uses[key]), 0);
        rows.set(profileId, Math.max(0, value - kept));
    }
    return [...rows].filter(([, value]) => value > 0.5).map(([profileId, value]) => ({ profileId, amount: value }));
}
