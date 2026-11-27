// VK-2 (FR-79 Punkte 5–8, 10, 11; Ergänzung 1): geführter Kauf. Reine Projektion ohne DOM, Speicher oder Engine: Kaufzeilen aus dem
// Jahresbeleg (wer zahlt aus welchem Tagesgeld, Anlageklasse, Betrag), Stückvorschlag mit Kurspuffer, Schätzung, eingetragene Käufe
// (`buy_reconciled`) mit Abbuchungsstand, Stand je Zeile und je Schritt.
import { annualActionDoneThreshold } from '../balance/annual-action-progress.js';
import { readReconciliationHistory, projectBuyCashStatuses } from './tranche-reconciliation.js';
import { shownPrice } from './sale-flow-model.js';
import { splitUsesByPersonalNet } from '../profile/profilverbund-action-attribution.js';
import { personalUsesConsistent } from '../profile/annual-plan-record.js';

/** Ergänzung 1 FR-79 Punkt 3: Kurspuffer und Gebührenannahme beim Kauf. */
export const BUY_PRICE_BUFFER = 0.01;
export const BUY_FEE_ASSUMPTION = 10;
const finite = Number.isFinite;
const cents = (/** @type {number} */ value) => Math.round(value * 100) / 100;
const USE_CLASSES = /** @type {Record<string, string>} */ ({ aktien: 'equity', gold: 'gold', bonds: 'bonds', geldmarkt: 'money_market' });
/** Anlageform des neuen Bestands je Anlageklasse (Tranchentyp). */
export const BUY_TYPES = /** @type {Record<string, string>} */ ({ equity: 'aktien_neu', gold: 'gold', bonds: 'anleihe', money_market: 'geldmarkt' });
export const CLASS_NAMES = /** @type {Record<string, string>} */ ({ equity: 'Aktien', gold: 'Gold', bonds: 'Anleihen', money_market: 'Geldmarkt' });

/** Kaufvorschlag: ⌊(Planbetrag − 10 € Gebührenannahme) ÷ (Kurs × 1,01)⌋ mit dem angezeigten Kurs (Ergänzung 1 Punkt 3).
 * @param {number} amount @param {number} price */
export function suggestBuyShares(amount, price) {
    const quote = shownPrice(price);
    if (!(amount > BUY_FEE_ASSUMPTION) || !(quote > 0)) return 0;
    return Math.max(0, Math.floor((amount - BUY_FEE_ASSUMPTION) / (quote * (1 + BUY_PRICE_BUFFER)) + 1e-9));
}

/** Schätzung zum letzten Kurs: Kurswert und Belastung mit etwa 10 € Gebühren. @param {number} shares @param {number} price */
export function estimateBuy(shares, price) {
    const gross = cents(shares * shownPrice(price));
    return { gross, debit: cents(gross + BUY_FEE_ASSUMPTION) };
}

/** Abrechnung: Stück × Kurs + Gebühren = Belastung; Kaufpreis je Stück mit Gebühren ungerundet (Einstand = Belastung, VKR P1).
 * @param {{shares: number, price: number, fees: number}} values */
export function settleBuy({ shares, price, fees }) {
    if (!(shares > 0) || !(price > 0) || !(fees >= 0)) return { gross: NaN, fees, debit: NaN, pricePerShare: NaN };
    const gross = cents(shares * price), debit = cents(gross + fees);
    return { gross, fees, debit, pricePerShare: debit / shares };
}

/** Erledigt-Grenze einer Kaufzeile (Nachtrag 3): offen bleibt höchstens das Größere aus einem Stück zum letzten Kurs mit Kurspuffer
 * und der halben Engine-Stufe des Planbetrags (FR-77 Punkt 2). @param {number} plan @param {number} price */
export function buyRestLimit(plan, price) {
    const share = shownPrice(price) > 0 ? cents(shownPrice(price) * (1 + BUY_PRICE_BUFFER)) : 0;
    return Math.max(share, plan - annualActionDoneThreshold(plan));
}

/** Rest-Frage beim Kauf: nur über der Erledigt-Grenze (Ergänzung 1 Punkt 5). @param {{restAmount: number, amount: number, price: number}} line @param {number} debit */
export function restBuyQuestionAmount(line, debit) {
    const rest = cents(line.restAmount - debit);
    // Gemini VK2 P3-1: ab der Grenze fragen; die Zeile wird erst unter der Grenze erledigt (sonst bliebe sie still „teilweise“).
    return rest >= buyRestLimit(line.amount, line.price) ? rest : null;
}

/** Kaufzeilen des Belegs je Person und Anlageklasse. Trägt der Beleg stimmige persönliche Verwendungen der Haushaltsrechnung
 * (`personalUses`, auch nach der Verrechnung gegenläufiger Aufträge; nur Personen des Plans, Summen = Haushaltsverwendung), entstehen die
 * Zeilen daraus. Rückfall für ältere Belege ohne `personalUses` und für ein unstimmiges Feld: Aufteilung wie in der Haushaltsrechnung nach den persönlichen Nettoquellen (Verkäufe nach
 * Steuer, Tagesgeld mit seinem Betrag), der Anteil am Auffüllen geht vorher ab; nach einer Verrechnung gegenläufiger Aufträge ist dieser
 * Rückfall ungenau. Fehlt die Person einer Quelle (Altbeleg), zählt sie für die erste Person des Plans. Ohne Quellen zahlt die erste Person alles.
 * @param {any} action @param {string[]} ids */
export function annualBuyLines(action, ids) {
    const uses = /** @type {Record<string, number>} */ (Object.fromEntries(Object.entries(action?.verwendungen || {})
        .map(([key, value]) => [key, finite(value) && value > 0 ? Number(value) : 0])));
    const purchases = /** @type {[string, string][]} */ (Object.entries(uses).flatMap(([key, value]) => USE_CLASSES[key] && value > 0.5 ? [[key, USE_CLASSES[key]]] : []));
    if (!(purchases.reduce((sum, [key]) => sum + uses[key], 0) > 0.5)) return [];
    const personal = action?.personalUses;
    if (personalUsesConsistent(action, ids)) {
        return ids.flatMap(id => purchases.flatMap(([key, assetClass]) => {
            const amount = cents(Number(personal[id]?.[key]) || 0);
            return amount > 0.5 ? [{ key: `buy:${id}:${assetClass}`, profileId: id, assetClass, amount }] : [];
        }));
    }
    const sources = Array.isArray(action?.quellen) ? action.quellen : [];
    const fallback = ids[0] ?? null;
    const order = [...ids];
    const net = new Map();
    for (const source of sources) {
        const id = source?.sourceProfileId ?? fallback;
        const amount = finite(source?.netto) ? Number(source.netto)
            : finite(source?.brutto) ? Number(source.brutto) - (finite(source?.steuer) ? Number(source.steuer) : 0) : 0;
        if (!order.includes(id)) order.push(id);
        net.set(id, (net.get(id) || 0) + amount);
    }
    let weights = order.map(id => Math.max(0, net.get(id) || 0));
    if (!(weights.reduce((sum, value) => sum + value, 0) > 0.5)) weights = order.map(id => id === fallback ? 1 : 0);
    const shares = splitUsesByPersonalNet(uses, weights);
    const lines = [];
    order.forEach((id, index) => {
        for (const [key, assetClass] of purchases) {
            const amount = cents(shares[index][key]);
            if (amount > 0.5) lines.push({ key: `buy:${id}:${assetClass}`, profileId: id, assetClass, amount });
        }
    });
    return lines;
}

/** Eingetragene Käufe der Personen mit Abbuchungsstand. @param {any} registry @param {string[]} ids */
export function readFlowBuys(registry, ids) {
    const set = new Set(ids);
    const statuses = new Map(projectBuyCashStatuses(registry).map(status => [status.targetActionId, status]));
    // VK-3: Ein stornierter Kauf („Kauf rückgängig“) hat keinen Abbuchungsstand mehr und zählt nicht.
    return readReconciliationHistory(registry).filter(record => record.eventType === 'buy_reconciled' && set.has(record.profileId) && statuses.has(record.actionId)).map(record => {
        const status = statuses.get(record.actionId);
        return { actionId: record.actionId, profileId: record.profileId, trancheId: record.trancheId, executedAt: record.executedAt,
            assetClass: record.assetClass ?? null, name: record.name ?? null, isin: record.isin ?? null,
            shares: record.actual.sharesBought, gross: record.actual.grossAmount, fees: record.actual.fees, debit: record.actual.netCashDebited,
            debitPending: Boolean(status?.isPending), cashAfter: status?.isConfirmed && finite(status.cashBalanceAfterPostingEur) ? status.cashBalanceAfterPostingEur : null,
            confirmedAt: status?.confirmedAt ?? null };
    });
}

/** Stand je Kaufzeile: offen, teilweise, erledigt (Erledigt-Grenze) oder „Erledigt · Rest bleibt auf dem Tagesgeld“.
 * @param {{lines: ReturnType<typeof annualBuyLines>, buys: ReturnType<typeof readFlowBuys>, year: number, decidedOn?: string|null,
 * resolutions?: Record<string, {decision?: string, reason?: string}>, prices?: Record<string, number>}} options */
export function projectBuyLines({ lines, buys, year, decidedOn = null, resolutions = {}, prices = {} }) {
    return lines.map(line => {
        const own = buys.filter(buy => buy.profileId === line.profileId && buy.assetClass === line.assetClass
            && buy.executedAt.slice(0, 4) === String(year) && (!decidedOn || buy.executedAt >= decidedOn));
        const bought = cents(own.reduce((sum, buy) => sum + buy.debit, 0));
        const restAmount = Math.max(0, cents(line.amount - bought));
        // VK-2b P3-6: Mit eingetragenem Kauf rechnen Karte und Dialog die Erledigt-Grenze mit demselben Kurs (Kurswert ÷ Stück des letzten Kaufs).
        const last = own.length ? own.reduce((latest, buy) => buy.executedAt >= latest.executedAt ? buy : latest) : null;
        const price = last && last.shares > 0 ? last.gross / last.shares : prices[line.key] ?? NaN;
        const kept = resolutions[line.key]?.decision === 'keep_in_depot';
        const status = kept || bought > 0 && restAmount < buyRestLimit(line.amount, price) ? 'erledigt' : bought > 0 ? 'teilweise' : 'offen';
        return { ...line, bought, restAmount: status === 'erledigt' ? 0 : restAmount, openAmount: restAmount, status, keptCash: kept,
            keptReason: resolutions[line.key]?.reason || '', buys: own, price };
    });
}

/** Stand je Schritt aus Eingetragenem (Ergänzung 1 Punkt 7), nie aus „angesehen“; Fortsetzen mit Schritt n.
 * @param {ReturnType<typeof projectBuyLines>} lines @param {{securityChosen?: boolean}} [options] */
export function projectBuyFlowState(lines, { securityChosen = false } = {}) {
    const total = lines.length;
    const done = lines.filter(line => line.status === 'erledigt').length;
    const entered = lines.filter(line => line.buys.length || line.keptCash).length;
    const buys = lines.flatMap(line => line.buys);
    const pending = buys.filter(buy => buy.debitPending);
    const tile = (/** @type {number} */ count, /** @type {number} */ of) => count >= of && of > 0 ? { label: 'erledigt', done: true }
        : count > 0 ? { label: `${count} von ${of}`, done: false } : { label: of > 0 ? `0 von ${of}` : 'offen', done: false };
    const debit = !buys.length ? { label: 'offen', done: false } : pending.length ? { label: `${buys.length - pending.length} von ${buys.length}`, done: false }
        : { label: 'erledigt', done: true };
    const steps = {
        overview: buys.length || done || securityChosen ? { label: buys.length || done ? 'erledigt' : 'gewählt', done: true } : { label: 'Wertpapier wählen', done: false },
        buy: tile(entered, total), settle: tile(done, total), debit
    };
    const complete = total > 0 && done === total;
    const next = !buys.length && !done ? 1 : !complete ? 3 : pending.length ? 4 : null;
    return { steps, complete, next, buys, pending, entered, done, total };
}

/** Stand des Kaufplans in Euro (Balken „Stand des Plans“). @param {ReturnType<typeof projectBuyLines>} lines */
export function buyPlanProgress(lines) {
    const plan = lines.reduce((sum, line) => sum + line.amount, 0), bought = lines.reduce((sum, line) => sum + line.bought, 0);
    return { plan, bought, share: plan > 0 ? Math.min(1, bought / plan) : 0 };
}

/** Tagesgeld vor den Abbuchungen aus dem Plan: aus dem Beleg der ersten bestätigten Abbuchung, sonst heutiges Tagesgeld plus bestätigte
 * Abbuchungen (wie beim Verkauf, VK-1b P2-3 und TRG-1b P3-8). @param {ReturnType<typeof readFlowBuys>} buys @param {number|null} todayCash */
export function cashBeforeDebits(buys, todayCash) {
    const confirmed = buys.filter(buy => !buy.debitPending);
    const evidence = confirmed.filter(buy => finite(buy.cashAfter) && buy.confirmedAt);
    const first = evidence.length ? evidence.reduce((earliest, buy) => String(buy.confirmedAt) < String(earliest.confirmedAt) ? buy : earliest) : null;
    const gap = first && confirmed.some(buy => !(finite(buy.cashAfter) && buy.confirmedAt) && (!buy.confirmedAt || String(buy.confirmedAt) <= String(first.confirmedAt)));
    if (first && !gap) {
        const same = evidence.filter(buy => buy.confirmedAt === first.confirmedAt && Math.abs(/** @type {number} */ (buy.cashAfter) - /** @type {number} */ (first.cashAfter)) < 0.005);
        return cents(/** @type {number} */ (first.cashAfter) + same.reduce((sum, buy) => sum + buy.debit, 0));
    }
    if (!finite(todayCash)) return null;
    return cents(/** @type {number} */ (todayCash) + confirmed.reduce((sum, buy) => sum + buy.debit, 0));
}
