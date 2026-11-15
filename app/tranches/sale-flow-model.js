// FR-79: geführter Verkauf. Reine Projektion ohne DOM, Speicher oder Engine: Planzeilen mit Wertpapier, Stückvorschlag,
// Schätzung, Bankreihenfolge, eingetragenen Abrechnungen und Gutschriften; Verteilung der Gutschriften; Stand je Schritt.
import { capitalGainsTaxRate } from '../../engine/tax-settlement.mjs';
import { annualActionDoneThreshold, annualActionAssetClass } from '../balance/annual-action-progress.js';
import { readReconciliationHistory, projectReconciliationCashStatuses } from './tranche-reconciliation.js';
import { bankOrderDateMissing, compareBankOrder } from '../../types/sale-fifo.js';

/** Ergänzung 1 FR-79 Punkt 3: Kurspuffer beim Verkauf. */
export const SALE_PRICE_BUFFER = 0.01;
const finite = Number.isFinite;
const cents = value => Math.round(value * 100) / 100;
/** Gerechnet wird mit dem angezeigten Kurs (2 Nachkommastellen). @param {number} price */
export const shownPrice = price => finite(price) ? cents(price) : NaN;
const TYPE_NAMES = /** @type {Record<string, string>} */ ({ aktien_neu: 'Neubestand', aktien_alt: 'Altbestand', geldmarkt: 'Geldmarkt-ETF',
    anleihe: 'Anleihe', gold: 'Gold-ETC' });
const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** Bestandsart einer Tranche in Klartext. @param {{type?: string}} tranche */
export const trancheTypeName = tranche => TYPE_NAMES[tranche?.type || ''] || 'Bestand';

/** Tranche in Klartext: „Name · Neubestand · ISIN · Bestand 1.245,935 Stück“ (ohne technische ID).
 * @param {any} tranche @param {(value: number, digits?: number) => string} number */
export function trancheLabel(tranche, number) {
    return [tranche.name || 'Wertpapier', trancheTypeName(tranche), tranche.isin || null,
        finite(tranche.shares) ? `Bestand ${number(tranche.shares, 3)} Stück` : null].filter(Boolean).join(' · ');
}

/** Verkaufsvorschlag: ⌈brutto × 1,01 ÷ Kurs⌉ (FR-79 Punkt 10 (2), Ergänzung 1 Punkt 3). @param {number} gross @param {number} price */
export function suggestSaleShares(gross, price) {
    const quote = shownPrice(price);
    if (!(gross > 0) || !(quote > 0)) return 0;
    return Math.ceil(cents(gross * (1 + SALE_PRICE_BUFFER)) / quote - 1e-9);
}

/** RK-4 (FR-82): Vorschlag für das Tranchenfeld im Verkaufsdialog. Verkauft die Bank zuerst eine andere Tranche derselben ISIN als
 * der Beleg nennt, ist es diese; sonst die Tranche des Belegs. @param {any} line Zeile aus `readSaleFlowPlan` @returns {string|null} */
export function saleStartTrancheId(line) {
    return (line?.bank?.differs && line.bank.parts?.[0]?.tranche?.trancheId) || line?.tranche?.trancheId || null;
}

/** Tranchen derselben ISIN einer Person in Bankreihenfolge: älteste Stücke zuerst (§ 20 Abs. 4 Satz 7 EStG).
 * @param {any[]} tranches @param {any} tranche */
export function bankOrderTranches(tranches, tranche) {
    if (!tranche?.isin) return [tranche];
    return tranches.filter(item => item.isin === tranche.isin && item.shares > 0)
        .sort(compareBankOrder);
}

/** FR-82: Hinweis „Kaufdatum fehlt – Reihenfolge der Bank geschätzt“, wenn einer Tranche derselben ISIN der Person das Kaufdatum fehlt.
 * @param {any[]} tranches Tranchen einer Person @param {string|null|undefined} isin */
export function bankOrderGuessed(tranches, isin) {
    if (!isin) return false;
    return bankOrderDateMissing((tranches || []).filter(item => item?.isin === isin && item.shares > 0), () => isin);
}

/** FR-82: Hat ein Plan Verkäufe aus Wertpapieren, bei denen die App die Bankreihenfolge mangels Kaufdatum schätzt?
 * @param {any} registry @param {any[]} sources Verkaufsquellen des Belegs */
export function planBankOrderGuessed(registry, sources) {
    return (sources || []).some(source => source?.isin && source?.sourceProfileId
        && bankOrderGuessed(parse(registry?.profiles?.[source.sourceProfileId]?.data?.depot_tranchen) || [], source.isin));
}

/** Stücke einer Order auf die Tranchen in Bankreihenfolge verteilt. Reicht der Bestand nicht, bleibt `missing` > 0.
 * @param {any[]} ordered @param {number} shares */
export function allocateBankOrder(ordered, shares) {
    let rest = shares;
    const parts = [];
    for (const tranche of ordered) {
        if (rest <= 1e-9) break;
        const take = Math.min(rest, tranche.shares);
        if (take > 0) { parts.push({ tranche, shares: take }); rest -= take; }
    }
    return { parts, missing: Math.max(0, rest) };
}

/** Geschätzte Steuer einer Aufteilung ohne Sparerpauschbetrag: Gewinn × (1 − Teilfreistellung) × Steuersatz. Verlust ergibt eine Erstattung (negativ).
 * @param {{tranche: any, shares: number}[]} parts @param {number} price @param {number} [churchTax] */
export function estimatePartsTax(parts, price, churchTax = 0) {
    const rate = capitalGainsTaxRate(churchTax);
    return cents(parts.reduce((sum, { tranche, shares }) => sum + (tranche.taxExempt ? 0
        : shares * (shownPrice(price) - tranche.purchasePrice) * (1 - (tranche.tqf || 0)) * rate), 0));
}

/** Gebühren und Steuern einer Abrechnung anteilig nach Stücken auf die Tranchen. Je Betrag wird in ganzen Cent verteilt (größter Rest
 * zuerst), so wird kein Teil negativ und die Summe stimmt genau. Teile unter einem halben Cent Kurswert gehen im Nachbarn auf
 * (Gutachten VK-1 P3-7): ihre Stücke bleiben im Bestand, ihre Beträge zählen zu den übrigen Teilen.
 * @param {{tranche: any, shares: number}[]} parts @param {{shares: number, gross: number, fees: number, taxes: number}} order
 * @returns {{tranche: any, shares: number, gross: number, fees: number, taxes: number}[]} */
export function splitOrder(parts, order) {
    const unit = order.shares > 0 ? order.gross / order.shares : 0;
    const kept = parts.length > 1 ? parts.filter(part => part.shares * unit >= 0.005) : parts;
    const used = kept.length ? kept : parts.slice(0, 1);
    const weight = used.reduce((sum, part) => sum + part.shares, 0);
    const spread = (/** @type {number} */ amount) => {
        const total = Math.round(amount * 100), sign = total < 0 ? -1 : 1, abs = Math.abs(total);
        const raw = used.map(part => weight > 0 ? abs * part.shares / weight : abs / used.length);
        const base = raw.map(value => Math.floor(value + 1e-9));
        let rest = abs - base.reduce((sum, value) => sum + value, 0);
        for (const index of raw.map((value, i) => i).sort((a, b) => (raw[b] - base[b]) - (raw[a] - base[a]) || a - b)) {
            if (rest <= 0) break;
            base[index] += 1; rest -= 1;
        }
        return base.map(value => sign * value / 100);
    };
    const gross = spread(order.gross), fees = spread(order.fees), taxes = spread(order.taxes);
    return used.map((part, index) => ({ tranche: part.tranche, shares: part.shares, gross: gross[index], fees: fees[index], taxes: taxes[index] }));
}

/** Bestätigte Verkäufe der Personen mit allen Abrechnungsfeldern und Gutschriftstand.
 * @param {any} registry @param {string[]} ids */
export function readFlowSales(registry, ids) {
    const set = new Set(ids);
    const statuses = new Map(projectReconciliationCashStatuses(registry).map(status => [status.targetActionId, status]));
    const classes = new Map();
    for (const id of ids) {
        const data = registry?.profiles?.[id]?.data || {};
        for (const lot of Object.values(parse(data.profile_wealth_history_lots_v1)?.lots || {})) if (lot?.tranche?.trancheId) classes.set(`${id}|${lot.tranche.trancheId}`, lot.tranche);
        for (const tranche of parse(data.depot_tranchen) || []) if (tranche?.trancheId) classes.set(`${id}|${tranche.trancheId}`, tranche);
    }
    return readReconciliationHistory(registry).filter(record => record.eventType === 'sale_reconciled' && set.has(record.profileId)).map(record => {
        const tranche = classes.get(`${record.profileId}|${record.trancheId}`) || null;
        const status = statuses.get(record.actionId);
        return { actionId: record.actionId, profileId: record.profileId, trancheId: record.trancheId, executedAt: record.executedAt,
            shares: record.actual.sharesSold, gross: record.actual.grossProceeds, fees: record.actual.fees, taxes: record.actual.taxes ?? 0,
            net: record.actual.netProceeds, assetClass: annualActionAssetClass(tranche), security: tranche,
            creditPending: Boolean(status?.isPending), cashStatus: record.cashStatus,
            cashAfter: status?.isConfirmed && finite(status.cashBalanceAfterPostingEur) ? status.cashBalanceAfterPostingEur : null, confirmedAt: status?.confirmedAt ?? null };
    });
}

/** Tagesgeld einer Person vor den Gutschriften aus dem Plan (Gutachten VK-1 P2-3): festgehalten aus dem Beleg der ersten bestätigten
 * Gutschrift (Kontostand danach − bestätigte Gutschrift; bei einer Order über mehrere Tranchen alle Teile derselben Bestätigung).
 * Ohne bestätigte Gutschrift gilt das heutige Tagesgeld. Liegt vor dem ersten Beleg eine bestätigte Gutschrift ohne Kontostand, gilt das
 * heutige Tagesgeld minus alle bestätigten Gutschriften (TRG-1b, P3-8). Nicht lesbar ergibt null (Hinweis statt still 0 €).
 * @param {{net: number, creditPending: boolean, cashAfter?: number|null, confirmedAt?: string|null}[]} sales Verkäufe der Person im Plan
 * @param {number|null} todayCash heutiges Tagesgeld @returns {number|null} */
export function cashBeforeCredits(sales, todayCash) {
    const confirmed = sales.filter(sale => !sale.creditPending);
    const evidence = confirmed.filter(sale => finite(sale.cashAfter) && sale.confirmedAt);
    const first = evidence.length ? evidence.reduce((earliest, sale) => String(sale.confirmedAt) < String(earliest.confirmedAt) ? sale : earliest) : null;
    // TRG-1b (P3-8): Nicht über eine bestätigte Gutschrift ohne Kontostand hinweg, die früher (oder ohne Zeitpunkt) bestätigt wurde.
    const gap = first && confirmed.some(sale => !(finite(sale.cashAfter) && sale.confirmedAt)
        && (!sale.confirmedAt || String(sale.confirmedAt) <= String(first.confirmedAt)));
    if (first && !gap) {
        const same = evidence.filter(sale => sale.confirmedAt === first.confirmedAt && Math.abs(/** @type {number} */ (sale.cashAfter) - /** @type {number} */ (first.cashAfter)) < 0.005);
        return Math.max(0, cents(/** @type {number} */ (first.cashAfter) - same.reduce((sum, sale) => sum + sale.net, 0)));
    }
    if (!finite(todayCash)) return null;
    // Altbelege ohne Kontostand (auch vor dem ersten Beleg): heutiges Tagesgeld minus alle bestätigten Gutschriften.
    return Math.max(0, cents(/** @type {number} */ (todayCash) - confirmed.reduce((sum, sale) => sum + sale.net, 0)));
}

/** Planzeilen des geführten Verkaufs. Status, Netto und „Rest bleibt im Depot“ kommen aus `progress` (FR-77, FR-79 Punkt 11).
 * @param {{action: any, progress: any, registry: any, people: {id: string, name: string}[], decidedOn?: string|null, year: number}} options */
export function projectSaleFlowLines({ action, progress, registry, people, decidedOn = null, year }) {
    const ids = people.map(person => person.id);
    const sources = Array.isArray(action?.quellen) ? action.quellen : [];
    const sales = readFlowSales(registry, ids).filter(sale => sale.executedAt?.slice(0, 4) === String(year) && (!decidedOn || sale.executedAt >= decidedOn));
    const used = new Set();
    // FR-82: Der Plan verkauft selbst in Bankreihenfolge. Ältere Tranchen derselben ISIN, die eine andere Planzeile verkauft, gehen voraus.
    const stockIdOf = (/** @type {any} */ line) => line.trancheId && String(line.trancheId).startsWith(`${line.profileId}:`)
        ? String(line.trancheId).slice(String(line.profileId).length + 1) : line.trancheId;
    const plannedOf = (/** @type {any} */ line) => new Set((progress?.lines || []).filter((/** @type {any} */ item) => item !== line && item.profileId === line.profileId)
        .map(stockIdOf).filter(Boolean));
    // Gutachten VK-1 P3-6: Zeilen derselben Person und Anlageklasse bilden eine Gruppe; die Rest-Frage rechnet auf ihr.
    const groupOf = (/** @type {any} */ line) => (progress?.lines || []).filter((/** @type {any} */ item) => item.profileId === line.profileId && item.assetClass === line.assetClass);
    return (progress?.lines || []).map((/** @type {any} */ line) => {
        const group = groupOf(line);
        const source = sources[line.index] || {};
        const profileId = line.profileId;
        const data = registry?.profiles?.[profileId]?.data || {};
        const tranches = (parse(data.depot_tranchen) || []).filter((/** @type {any} */ item) => item && item.trancheId);
        const stockId = stockIdOf(line);
        const tranche = tranches.find((/** @type {any} */ item) => item.trancheId === stockId)
            || tranches.find((/** @type {any} */ item) => source.isin && item.isin === source.isin && item.shares > 0) || null;
        const price = shownPrice(tranche?.currentPrice);
        const planNet = line.planNet;
        const planTax = finite(source.steuer) ? source.steuer : 0;
        const planGross = finite(source.brutto) ? source.brutto : planNet + planTax;
        // Rest einer teilweise umgesetzten Zeile: Brutto anteilig.
        const restGross = line.restNet > 0 ? line.restNet * (planGross / planNet) : 0;
        const fullOrder = tranche ? bankOrderTranches(tranches, tranche) : [];
        const planned = plannedOf(line);
        const position = tranche ? fullOrder.findIndex(item => item.trancheId === tranche.trancheId) : -1;
        const planFollowsBank = position > 0 && fullOrder.slice(0, position).every(item => planned.has(item.trancheId));
        // RK-2 (Fable P3-1): Eine ältere Tranche aus einer anderen Planzeile ist nur um die Stücke kleiner, die ihre eigene offene Zeile
        // noch verkauft. Was danach bleibt (Kursanstieg, „Rest bleibt im Depot“), verkauft die Bank vor dieser Zeile.
        const pendingShares = (/** @type {string} */ stockId) => {
            const other = (progress?.lines || []).find((/** @type {any} */ item) => item !== line && item.profileId === line.profileId && stockIdOf(item) === stockId);
            if (!other || !(other.restNet > 0) || !(other.planNet > 0)) return 0;
            const otherSource = sources[other.index] || {};
            const otherGross = finite(otherSource.brutto) ? otherSource.brutto : other.planNet + (finite(otherSource.steuer) ? otherSource.steuer : 0);
            return suggestSaleShares(other.restNet * (otherGross / other.planNet), price);
        };
        const ordered = planFollowsBank ? [...fullOrder.slice(0, position).map(item => ({ ...item, shares: Math.max(0, item.shares - pendingShares(item.trancheId)) }))
            .filter(item => item.shares > 1e-9), ...fullOrder.slice(position)] : fullOrder;
        const churchTax = Number(data.profile_kirchensteuer_pct || 0) / 100;
        let shares = suggestSaleShares(restGross, price), allocation = allocateBankOrder(ordered, shares);
        // FR-82: Verkauft die nächste Planzeile die folgende Tranche derselben ISIN, reicht der Puffer bis zum Bestand dieser Tranche.
        if (tranche && allocation.parts.length > 1 && ordered[0]?.trancheId === tranche.trancheId && planned.has(ordered[1]?.trancheId)) {
            shares = Math.min(shares, tranche.shares);
            allocation = allocateBankOrder(ordered, shares);
        }
        // Gutachten VK-1 P3-01: auch wenn der Verkauf schon aus der ersten Tranche in die nächste überläuft.
        const differs = Boolean(tranche) && ordered[0] && (ordered[0].trancheId !== tranche.trancheId || allocation.parts.length > 1);
        let bankTax = null;
        if (differs && shares > 0) {
            for (let round = 0; round < 6; round++) {
                bankTax = estimatePartsTax(allocation.parts, price, churchTax);
                const next = suggestSaleShares(line.restNet + Math.max(0, bankTax), price);
                if (next === shares) break;
                shares = next; allocation = allocateBankOrder(ordered, shares);
            }
            bankTax = estimatePartsTax(allocation.parts, price, churchTax);
        }
        const planShares = suggestSaleShares(restGross, price);
        const restTax = line.restNet > 0 ? planTax * (line.restNet / planNet) : 0;
        const gross = cents(shares * price);
        const taxes = differs ? /** @type {number} */ (bankTax) : cents(restTax);
        const lineSales = sales.filter(sale => sale.profileId === profileId && sale.assetClass === line.assetClass && !used.has(sale.actionId));
        lineSales.forEach(sale => used.add(sale.actionId));
        return {
            key: line.key, index: line.index, profileId, name: people.find(person => person.id === profileId)?.name || line.profileName || 'Person',
            security: { name: tranche?.name || source.name || 'Wertpapier', isin: tranche?.isin || source.isin || '', ticker: tranche?.ticker || '',
                typeName: trancheTypeName(tranche || { type: source.kind }), shares: tranche?.shares ?? null, purchaseDate: tranche?.purchaseDate || source.purchaseDate || null },
            tranche, tranches, churchTax, price, priceAsOf: tranche?.asOf ?? null,
            planNet, planTax, planGross, restNet: line.restNet, restGross, soldNet: line.soldNet, status: line.status,
            keptInDepot: Boolean(line.keptInDepot), keptReason: line.keptReason ?? null,
            suggestion: { shares, gross, taxes, net: cents(gross - taxes), buffer: cents(gross - taxes - line.restNet) },
            bank: { differs: Boolean(differs), parts: allocation.parts, missing: allocation.missing, tax: bankTax, planTax: cents(restTax), planShares,
                guessed: bankOrderGuessed(tranches, tranche?.isin || source.isin) },
            sales: lineSales, threshold: annualActionDoneThreshold(planNet), assetClass: line.assetClass,
            group: { keys: group.map((/** @type {any} */ item) => item.key), planNet: group.reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + item.planNet, 0),
                soldNet: group.reduce((/** @type {number} */ sum, /** @type {any} */ item) => sum + item.soldNet, 0) }
        };
    });
}

/** Ergänzung 1 FR-79 Punkt 5: Die Rest-Frage kommt erst, wenn nach dieser Abrechnung mehr fehlt als die Erledigt-Grenze erlaubt.
 * Mit `group` (mehrere Planzeilen derselben Person und Anlageklasse) rechnet sie auf der Gruppe.
 * @param {{planNet: number, soldNet: number, group?: {planNet: number, soldNet: number}}} line @param {number} net Netto der neuen Abrechnung @returns {number|null} fehlender Rest oder null */
export function restQuestionAmount(line, net) {
    const scope = line.group ?? line;
    const sold = scope.soldNet + net;
    if (!(net > 0) || sold >= annualActionDoneThreshold(scope.planNet)) return null;
    return cents(scope.planNet - sold);
}

/** Abrechnung aus den Feldern: Kurswert − Gebühren − Steuern = Gutschrift. Mit `fromCredit` sind die Steuern der Rest.
 * @param {{shares: number, price: number, fees: number, taxes?: number|null, credit?: number|null, fromCredit?: boolean}} input */
export function settleSale({ shares, price, fees, taxes = null, credit = null, fromCredit = false }) {
    const gross = finite(shares) && finite(price) ? cents(shares * price) : NaN;
    const fee = finite(fees) ? fees : 0;
    const tax = fromCredit ? (finite(credit) && finite(gross) ? cents(gross - fee - /** @type {number} */ (credit)) : NaN) : finite(taxes) ? /** @type {number} */ (taxes) : 0;
    const net = finite(gross) && finite(tax) ? cents(gross - fee - tax) : NaN;
    return { gross, fees: fee, taxes: tax, net };
}

/** Abrechnung speicherbar: Stück und Netto größer 0, Steuern lesbar (Gutachten VK-1 P2-03, mit und ohne Plan gleich).
 * @param {{shares: number, net: number, taxes: number}} values */
export const settlementReady = values => values.shares > 0 && values.net > 0 && finite(values.taxes);

/** Ergänzung 1 FR-79 Punkt 2: Aufs Tagesgeld kommt nur die Lücke zum Haushaltsziel. Sie geht an die Personen unter ihrem
 * persönlichen Tagesgeldziel im Verhältnis ihres Fehlbetrags; den Rest ihrer Gutschrift kauft jede Person in den Geldmarkt.
 * Alle Haushaltspersonen zählen mit ihrem Tagesgeld zur Lücke, auch ohne Gutschrift (Gutachten VK-1 P1-01); verteilt wird nur an
 * Personen mit Gutschrift.
 * @param {{people: {profileId: string, name: string, cashBefore: number, target: number, credit: number}[], householdTarget: number}} options */
export function distributeCredits({ people, householdTarget }) {
    const before = people.reduce((sum, person) => sum + person.cashBefore, 0);
    const gap = Math.max(0, cents(householdTarget - before));
    const shortfall = people.map(person => person.credit > 0 ? Math.max(0, person.target - person.cashBefore) : 0);
    const total = shortfall.reduce((sum, value) => sum + value, 0);
    let rest = gap;
    const rows = people.map((person, index) => {
        const last = index === people.length - 1 || shortfall.slice(index + 1).every(value => value <= 0);
        const wanted = total > 0 ? (last && shortfall[index] > 0 ? rest : cents(gap * shortfall[index] / total)) : 0;
        const toCash = Math.max(0, Math.min(person.credit, wanted, rest));
        rest = cents(rest - toCash);
        return { ...person, toCash: cents(toCash), toMoneyMarket: cents(person.credit - toCash), cashAfter: cents(person.cashBefore + toCash) };
    });
    return { rows, gap, cashBefore: cents(before), cashAfter: cents(before + rows.reduce((sum, row) => sum + row.toCash, 0)),
        credits: cents(people.reduce((sum, person) => sum + person.credit, 0)), toCash: cents(rows.reduce((sum, row) => sum + row.toCash, 0)),
        toMoneyMarket: cents(rows.reduce((sum, row) => sum + row.toMoneyMarket, 0)) };
}

/** Geldmarktkäufe einer Person seit dem Beschluss (Kaufdatum im Planjahr ab dem Beschlusstag), mit Einstand.
 * @param {any[]} tranches @param {{year: number, decidedOn?: string|null}} plan */
export function moneyMarketBought(tranches, { year, decidedOn = null }) {
    return cents((tranches || []).filter(tranche => annualActionAssetClass(tranche) === 'money_market'
        && String(tranche.purchaseDate || '').slice(0, 4) === String(year) && (!decidedOn || tranche.purchaseDate >= decidedOn))
        .reduce((sum, tranche) => sum + tranche.shares * tranche.purchasePrice, 0));
}

/** Stand je Schritt aus Eingetragenem (Ergänzung 1 Punkt 7), nie aus „angesehen“. Liefert auch den Schritt für „Weiter mit Schritt n“.
 * @param {ReturnType<typeof projectSaleFlowLines>} lines @param {{distributionDone?: boolean}} [options] */
export function projectSaleFlowState(lines, { distributionDone = false } = {}) {
    const total = lines.length;
    const sold = lines.filter(line => line.sales.length || line.keptInDepot).length;
    const done = lines.filter(line => line.status === 'erledigt').length;
    const partial = lines.filter(line => line.status === 'teilweise').length;
    const sales = lines.flatMap(line => line.sales);
    const pending = sales.filter(sale => sale.creditPending);
    const tile = (/** @type {number} */ count, /** @type {number} */ of) => count >= of && of > 0 ? { label: 'erledigt', done: true }
        : count > 0 ? { label: `${count} von ${of}`, done: false } : { label: of > 0 ? `0 von ${of}` : 'offen', done: false };
    const credit = !sales.length ? { label: 'offen', done: false } : pending.length ? { label: `${sales.length - pending.length} von ${sales.length}`, done: false }
        : { label: 'erledigt', done: true };
    const steps = {
        overview: sales.length || done ? { label: 'erledigt', done: true } : { label: 'offen', done: false },
        // VN-1 Punkt 3: Die Abrechnung nennt neben den erledigten Zeilen auch die mit einer Teilabrechnung („0 von 2 · 1 teilweise“).
        sell: tile(sold, total), settle: partial && done < total ? { label: `${done} von ${total} · ${partial} teilweise`, done: false } : tile(done, total), credit,
        distribute: distributionDone ? { label: 'erledigt', done: true } : { label: 'offen', done: false }
    };
    const next = !sales.length && !done ? 1 : done < total ? 3 : pending.length ? 4 : distributionDone ? null : 5;
    return { steps, next, total, sold, done, pending, sales, complete: done === total && total > 0 };
}
