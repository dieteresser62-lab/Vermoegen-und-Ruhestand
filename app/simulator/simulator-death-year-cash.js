/** TJ-1/TJ-2 (FR-48/51): Kauf und Auffüllung im Todesjahr. Verlässt ein Teil des Nachlasses den Haushalt, entscheidet die
 * Engine mit dem, was nach dem Nachlass bei der überlebenden Person bleibt; gekauft und verkauft wird nur aus ihren
 * Beständen. Bei 100 % gilt die Haushaltssicht unverändert. */
import { inheritancePercent, hasTestament, testamentRule, hasInheritanceHomes } from '../profile/household-partnership.js';
import { buildInputsCtxFromPortfolio } from './simulator-portfolio.js';
import { buildDetailedTranchesFromPortfolio } from './simulator-engine-direct-utils.js';
import { CONFIG } from '../../engine/config.mjs';
import { decidedFixedIncomeSurplus } from '../../engine/planners/fixed-income-budget.mjs';
import { quantizeAmount } from '../../engine/transactions/transaction-utils.mjs';

const DEATH_YEAR_NO_PURCHASE = 'Kein Kauf im Sterbejahr: freie Liquidität gehört zum Nachlass';
const DEATH_YEAR_LIMITED_PURCHASE = 'Kauf im Sterbejahr auf die eigene Liquidität begrenzt';

/** Untergrenze des Geldanteils, der im Todesjahr bei der überlebenden Person bleibt.
 * Mindestbetrag und Steuergeld (FR-54) erhöhen ihn nur. 1 bedeutet: alles bleibt im Haushalt.
 *
 * @param {object} options
 * @param options.inputs Wirksame Simulationseingaben.
 * @param options.transition Übergang des Simulationsjahres.
 * @param {boolean} options.hasLifeEvents Jahreslauf mit Lebensereignissen (sonst kein Nachlass).
 * @returns {number} Anteil zwischen 0 und 1.
 */
export function deathYearCashShare({ inputs, transition, hasLifeEvents }) {
    if (!transition?.deathThisYear || !hasLifeEvents || !inputs.partner?.aktiv
        || !(inputs.partnership || inputs.simulationPeople?.length === 2)) return 1;
    const partnership = inputs.partnership || { status: 'married' };
    const { deceasedProfileId } = transition.survivor;
    const rule = hasTestament(partnership, deceasedProfileId, hasInheritanceHomes(inputs.home, deceasedProfileId))
        ? testamentRule(partnership, deceasedProfileId) : {};
    return Math.min(1, Math.min(inheritancePercent(partnership, deceasedProfileId), rule.maximumPercent ?? 100) / 100);
}

/** Höchstbetrag: eigene Liquidität plus Anteil an der Liquidität der verstorbenen Person nach deren Jahresbuchungen,
 * abzüglich Ziel; das eigene Konto deckt weiter den eigenen Ausgabenanteil.
 *
 * @param {object} options
 * @param options.portfolio Portfolio zur Entscheidung, vor Käufen und Auszahlung.
 * @param options.transition Übergang des Todesjahres.
 * @param {number} options.share Anteil aus {@link deathYearCashShare}.
 * @param {() => {profileId: string, amount: number}[]} options.bookings Jahresbuchungen je Person aus eigener Liquidität.
 * @param {number} options.requested Von der Engine geplante Anlage aus Liquidität.
 * @returns {{capacity: number, survivorProfileId: string, reserves: {profileId: string, amount: number}[]}|null}
 *     null, wenn alles im Haushalt bleibt oder nichts angelegt werden soll.
 */
export function deathYearCashLimit({ portfolio, transition, share, bookings, requested }) {
    if (!(share < 1) || !(requested > 0)) return null;
    const { deceasedProfileId, survivorProfileId } = transition.survivor;
    const cash = profileId => {
        const account = portfolio.personAccounts.find(row => row.profileId === profileId);
        return account ? account.tagesgeld + account.geldmarktEtf : 0;
    };
    const rows = bookings();
    const booked = profileId => rows.find(row => row.profileId === profileId)?.amount || 0;
    const deceasedCash = cash(deceasedProfileId), survivorCash = cash(survivorProfileId);
    const unavailable = deceasedCash - share * Math.max(0, deceasedCash - booked(deceasedProfileId));
    const capacity = Math.max(0, Math.min(survivorCash - booked(survivorProfileId), requested - unavailable));
    return { capacity, survivorProfileId, reserves: portfolio.personAccounts.map(account => ({ profileId: account.profileId,
        amount: account.profileId === survivorProfileId ? survivorCash - capacity : cash(account.profileId) })) };
}

/** TJ-2: Sicht der überlebenden Person für die Kauf- und Auffüllentscheidung der Engine. Liquidität: eigene plus Anteil an
 * der Liquidität der verstorbenen Person nach deren Jahresbuchungen; Bestände: nur eigene Lose, weil die Zuordnung
 * geerbte Teillose erst beim Nachlass kennt.
 *
 * @param {object} options
 * @param options.portfolio Portfolio nach den Gutschriften vor der Entscheidung.
 * @param options.inputs Wirksame Simulationseingaben.
 * @param options.transition Übergang des Todesjahres.
 * @param {number} options.share Anteil aus {@link deathYearCashShare}.
 * @param {() => {profileId: string, amount: number}[]} options.bookings Jahresbuchungen je Person aus eigener Liquidität.
 * @param {number} options.householdLiquidity Liquidität, mit der die Engine den Haushalt rechnet.
 * @returns Sicht für die Engine, freie eigene Liquidität und Zahler; null, wenn alles bleibt oder nichts den Haushalt verlässt.
 */
export function deathYearTransactionView({ portfolio, inputs, transition, share, bookings, householdLiquidity }) {
    if (!(share < 1)) return null;
    const { deceasedProfileId, survivorProfileId } = transition.survivor;
    const owner = lot => lot.sourceProfileId || portfolio.simulationSourceProfileId;
    const keys = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt'];
    const deceasedLots = keys.some(key => (portfolio[key] || []).some(lot => owner(lot) === deceasedProfileId && lot.marketValue > 0));
    const cash = profileId => {
        const account = portfolio.personAccounts.find(row => row.profileId === profileId);
        return account ? account.tagesgeld + account.geldmarktEtf : 0;
    };
    const deceasedCash = cash(deceasedProfileId);
    if (!(deceasedCash > 0) && !deceasedLots) return null;
    const rows = bookings();
    const booked = profileId => rows.find(row => row.profileId === profileId)?.amount || 0;
    const unavailable = deceasedCash - share * Math.max(0, deceasedCash - booked(deceasedProfileId));
    const liquidity = Math.max(0, householdLiquidity - unavailable);
    const survivorCash = cash(survivorProfileId), ownFree = Math.max(0, survivorCash - booked(survivorProfileId));
    const view = { ...portfolio, ...Object.fromEntries(keys.map(key => [key, (portfolio[key] || [])
        .filter(lot => owner(lot) === survivorProfileId)])) };
    const assets = buildInputsCtxFromPortfolio(inputs, view, { pensionAnnual: 0, marketData: null });
    const moneyMarket = view.depotTranchesGeldmarkt.reduce((sum, lot) => sum + (Number(lot.marketValue) || 0), 0);
    return { survivorProfileId, ownFree, unavailable,
        engineView: { aktuelleLiquiditaet: liquidity, tagesgeld: Math.max(0, liquidity - moneyMarket), geldmarktEtf: Math.min(liquidity, moneyMarket),
            depotwertAlt: assets.depotwertAlt, depotwertNeu: assets.depotwertNeu, goldWert: assets.goldWert,
            costBasisAlt: assets.costBasisAlt, costBasisNeu: assets.costBasisNeu, goldCost: assets.goldCost,
            tqfAlt: assets.tqfAlt, tqfNeu: assets.tqfNeu, taxExemptAlt: assets.taxExemptAlt, taxExemptNeu: assets.taxExemptNeu,
            anleihenWert: assets.anleihenWert ?? 0, detailledTranches: buildDetailedTranchesFromPortfolio(view) } };
}

/** Kauf aus der freien eigenen Liquidität. Trägt sie den Engine-Auftrag, bleibt er unverändert. Sonst gilt für den
 * gekürzten Betrag dieselbe Reihenfolge wie bei der Überschussanlage der Engine (C9): Schwelle gegen den ungerundeten
 * Betrag, danach abrunden. Drei Töpfe liefern die Regel mit der Aktion; sonst folgt sie aus Sparjahr, Mindesthandel
 * und investiertem Kapital wie in der Engine.
 *
 * @param {number} requested Kaufauftrag der Engine aus Liquidität.
 * @param {number} ownFree Freie eigene Liquidität nach dem eigenen Ausgabenanteil.
 * @param {{minimum: number, isSavingsYear: boolean}|undefined} rules Regel der Aktion, falls vorhanden.
 * @param {{input: object, ui: {spending?: object, vpw?: object|null}}} engineResult Jahresergebnis der Engine.
 * @param {number} capital Investiertes Kapital, mit dem die Engine entschieden hat (Depot plus Liquidität).
 * @returns {number} Anzulegender Betrag.
 */
export function deathYearPurchaseAmount(requested, ownFree, rules, engineResult, capital) {
    if (requested <= ownFree) return requested;
    let rule = rules;
    if (!rule) {
        const isSavingsYear = decidedFixedIncomeSurplus({ input: engineResult.input, spending: engineResult.ui.spending,
            vpw: engineResult.ui.vpw }) > 0;
        const minTrade = Math.max(CONFIG.THRESHOLDS.STRATEGY.minTradeAmountStatic,
            capital * CONFIG.THRESHOLDS.STRATEGY.minTradeAmountDynamicFactor);
        rule = { minimum: isSavingsYear || !CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED ? 500 : minTrade, isSavingsYear };
    }
    const amount = Math.max(0, ownFree);
    if (rule.isSavingsYear ? amount < 500 : amount <= rule.minimum) return 0;
    return rule.isSavingsYear ? Math.floor(amount * 100) / 100
        : CONFIG.ANTI_PSEUDO_ACCURACY.ENABLED ? quantizeAmount(amount, 'floor') : amount;
}

/** Protokoll und Diagnose nennen den tatsächlich angelegten Betrag.
 *
 * @param action Endgültige Jahresaktion nach Zuordnung.
 * @param {{requested: number, invested: number, survivorProfileId: string}} purchase Geplanter und angelegter Betrag.
 * @returns {void}
 */
export function describeDeathYearPurchase(action, { requested, invested, survivorProfileId }) {
    // Ohne persönliche Steuerbücher fehlt die Zuordnung; gekauft wird trotzdem nur von der überlebenden Person.
    action.quellen = (action.quellen || []).map(source => source.kind === 'liquiditaet' && !source.sourceProfileId
        ? { ...source, sourceProfileId: survivorProfileId } : source);
    if (invested >= requested) return;
    const text = invested > 0 ? DEATH_YEAR_LIMITED_PURCHASE : DEATH_YEAR_NO_PURCHASE;
    if (action.quellen.every(source => source.kind === 'liquiditaet')) {
        action.title = text;
        if (!action.quellen.length) action.type = 'NONE';
    }
    if (action.details?.source === 'surplus') action.details = { ...action.details, grund: text };
    action.diagnosisEntries = (action.diagnosisEntries || []).map(entry => entry.step === 'Surplus Rebalancing'
        ? { ...entry, status: invested > 0 ? 'active' : 'inactive',
            impact: `${text}. Angelegt ${invested.toFixed(0)}€ von ${requested.toFixed(0)}€ Überschuss.` } : entry);
}
