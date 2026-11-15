// VK-3 (FR-79 Punkt 9, Ergänzung 1 Punkt 8, Nachträge 1 und 2): „Tranche im Detail“. Reine Projektion ohne DOM, Speicher oder Engine:
// Kennzahlen, Steuer wenn alles verkauft, Verlauf aus Kauf- und Verkaufsbelegen, Bezug „aus dem Plan JJJJ“ und ob Löschen erlaubt ist.
import { annualActionPlanLines, annualActionAssetClass, annualActionDecisionDay } from '../balance/annual-action-progress.js';
import { annualBuyLines } from './buy-flow-model.js';
import { readDecimalInput } from './tranchen-manager-decimal-input.js';

/** Abgeltungsteuer mit Soli, ohne Kirchensteuer (FR-79 Punkt 9). */
export const DETAIL_TAX_RATE = 0.26375;
/** Teilfreistellung zur Auswahl (Nachtrag 1: nur bei Anlageform Aktien; Mischfonds = Aktien mit 15 %). */
export const TQF_OPTIONS = Object.freeze([[0.3, 'Aktienfonds: 30 % steuerfrei'], [0.15, 'Mischfonds: 15 % steuerfrei'], [0, 'Einzelaktie: voll steuerpflichtig']]);
const finite = Number.isFinite;
const cents = (/** @type {number} */ value) => Math.round(value * 100) / 100;

/** Gewählte Teilfreistellung: eine der drei Optionen oder ein gespeicherter eigener Wert, der unverändert bleibt.
 * @param {unknown} tqf @returns {{value: number, custom: boolean}} */
export function tqfChoice(tqf) {
    const value = readDecimalInput(tqf);
    if (!finite(value)) return { value: 0, custom: false };
    return { value, custom: !TQF_OPTIONS.some(([option]) => Math.abs(Number(option) - value) < 1e-9) };
}

/** Kennzahlen: Stück genau, Einstand, Marktwert mit Kurs, Gewinn und Steuer, wenn alles verkauft (ohne Sparerpauschbetrag, Kirchensteuer
 * und bereits versteuerte Vorabpauschalen; „ganz steuerfrei“ und Verlust: 0 €). VK-3b (Fable P3-3): Der Tranchenvertrag verlangt im
 * gespeicherten Bestand einen positiven Kurs (Altdaten ohne Kurs bekommen beim Laden den Kaufpreis); „Kurs fehlt“ war nicht erreichbar
 * und entfällt. @param {any} tranche */
export function trancheDetailFigures(tranche) {
    const shares = Number(tranche?.shares) || 0;
    const purchasePrice = Number(tranche?.purchasePrice) || 0;
    const costBasis = finite(Number(tranche?.costBasis)) ? Number(tranche.costBasis) : shares * purchasePrice;
    const price = Number(tranche?.currentPrice) || 0;
    const marketValue = shares * price;
    const gain = marketValue - costBasis;
    const tqf = annualActionAssetClass(tranche) === 'equity' ? Math.max(0, Math.min(1, Number(tranche?.tqf) || 0)) : 0;
    const taxableShare = tranche?.taxExempt === true ? 0 : 1 - tqf;
    const tax = gain > 0 ? gain * taxableShare * DETAIL_TAX_RATE : 0;
    return { shares, purchasePrice, costBasis, price, marketValue, gain, gainPct: costBasis > 0 ? gain / costBasis : null,
        tqf, taxableShare, tax, taxExempt: tranche?.taxExempt === true };
}

/** Planbezug eines Belegs (Nachtrag 2): abgeleitet wie der Stand, Datum im Planjahr ab dem Beschluss, Person und Anlageklasse passen zu
 * einer Planzeile. Kein neues Feld. @param {any} entry Jahresbeleg @param {string[]} ids Personen des Plans */
export function planReference(entry, ids) {
    const action = entry && !entry.status ? entry.adopted?.action : null;
    if (!action || !Number.isInteger(entry.year)) return null;
    const key = (/** @type {string|null} */ id, /** @type {string|null} */ assetClass) => `${id}\u0000${assetClass}`;
    return { year: entry.year, decidedOn: annualActionDecisionDay(entry.committedAt),
        sales: new Set(annualActionPlanLines(action, ids.length === 1 ? ids[0] : null).map(line => key(line.profileId, line.assetClass))),
        buys: new Set(annualBuyLines(action, ids).map(line => key(line.profileId, line.assetClass))), key };
}

/** @param {any[]} references @param {'sales'|'buys'} kind @param {string} profileId @param {string|null} assetClass @param {string} executedAt */
function planYear(references, kind, profileId, assetClass, executedAt) {
    const hit = references.find(ref => ref && String(ref.year) === executedAt.slice(0, 4) && (!ref.decidedOn || executedAt >= ref.decidedOn)
        && ref[kind].has(ref.key(profileId, assetClass)));
    return hit ? hit.year : null;
}

/**
 * Verlauf der Tranche, neueste oben: der Kauf (Kaufbeleg `buy_reconciled` oder Stammdaten der Tranche) und jeder eingetragene Verkauf mit
 * Gutschrift, Gutschrift-Status und Planbezug. Korrekturen bleiben einzeln erhalten; ein alter Korrekturtag ohne Werte kennzeichnet
 * den Kauf als unvollständig. Der Kaufbeleg hat Vorrang vor abgeleiteten Kaufwerten.
 * @param {{tranche: any, profileId: string, records: any[], cashStatuses?: any[], buyStatuses?: any[], references?: any[], correctedAt?: string|null}} options
 */
export function trancheHistory({ tranche, profileId, records, cashStatuses = [], buyStatuses = [], references = [], correctedAt = null }) {
    const assetClass = annualActionAssetClass(tranche);
    const own = records.filter(record => record.profileId === profileId && record.trancheId === tranche.trancheId);
    const sales = own.filter(record => record.eventType === 'sale_reconciled');
    const cancelled = new Set(own.filter(record => record.eventType === 'buy_cancelled').map(record => record.targetActionId));
    const buy = own.find(record => record.eventType === 'buy_reconciled' && !cancelled.has(record.actionId)) || null;
    const credit = new Map(cashStatuses.map(status => [status.targetActionId, status]));
    const debit = new Map(buyStatuses.map(status => [status.targetActionId, status]));
    const corrections = tranche.correctionHistory || [];
    const first = corrections[0];
    const firstDay = first ? annualActionDecisionDay(first.at) : null;
    const legacyCorrectionAt = tranche.legacyCorrectionAt || (!first ? correctedAt : null);
    const rows = /** @type {any[]} */ (sales.map(sale => {
        const status = credit.get(sale.actionId);
        const shares = sale.actual.sharesSold, gross = sale.actual.grossProceeds;
        return { kind: 'sale', date: sale.executedAt, shares, price: gross / shares, amount: sale.actual.netProceeds, actionId: sale.actionId,
            plan: planYear(references, 'sales', profileId, assetClass, sale.executedAt),
            cash: status?.isPending ? 'pending' : status?.isConfirmed ? 'confirmed' : 'unknown' };
    }));
    const soldShares = sales.filter(sale => !first || (sale.executedAt < firstDay
        || (sale.executedAt === firstDay && sale.reconciledAt && sale.reconciledAt < first.at)))
        .reduce((sum, sale) => sum + sale.actual.sharesSold, 0);
    if (buy) {
        const status = debit.get(buy.actionId);
        rows.push({ kind: 'buy', date: buy.executedAt, shares: buy.actual.sharesBought, price: buy.actual.netCashDebited / buy.actual.sharesBought,
            amount: buy.actual.netCashDebited, actionId: buy.actionId, plan: planYear(references, 'buys', profileId, assetClass, buy.executedAt),
            cash: status?.isPending ? 'pending' : status?.isConfirmed ? 'confirmed' : 'unknown' });
    } else {
        const shares = legacyCorrectionAt ? null : (first ? first.sharesBefore : Number(tranche.shares) || 0) + soldShares;
        const price = first ? first.purchasePriceBefore : Number(tranche.purchasePrice) || 0;
        rows.push({ kind: 'buy', date: tranche.purchaseDate || '', shares, price, amount: shares === null ? null : cents(shares * price),
            legacyCorrectionAt, actionId: null, plan: null, cash: 'none' });
    }
    corrections.forEach((entry, index) => rows.push({ kind: 'correction', date: annualActionDecisionDay(entry.at), correctionIndex: index,
        sharesBefore: entry.sharesBefore, shares: entry.sharesAfter, reason: entry.reason, price: entry.purchasePriceAfter,
        amount: 0, actionId: null, plan: null, cash: 'none' }));
    const rank = /** @type {Record<string, number>} */ ({ correction: 0, sale: 1, buy: 2 });
    return rows.sort((a, b) => String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10))
        || (a.kind === 'correction' && b.kind === 'correction' ? b.correctionIndex - a.correctionIndex : rank[a.kind] - rank[b.kind]));
}

/** Löschen (Nachtrag 2): gesperrt, wenn ein Verkaufsbeleg an der Tranche hängt; hängt nur der eigene Kaufbeleg daran, ist Löschen
 * „Kauf rückgängig“ (Storno zum Kaufbeleg). @param {any} tranche @param {string} profileId @param {any[]} records
 * @returns {{allowed: boolean, reason: string, cancelBuy: string|null}} */
export function trancheDeletion(tranche, profileId, records) {
    const own = records.filter(record => record.profileId === profileId && record.trancheId === tranche.trancheId);
    if (own.some(record => record.eventType === 'sale_reconciled')) {
        return { allowed: false, cancelBuy: null, reason: 'Löschen geht nicht: Zu dieser Tranche ist ein Verkauf eingetragen. Der Verkaufsbeleg braucht sie.' };
    }
    const cancelled = new Set(own.filter(record => record.eventType === 'buy_cancelled').map(record => record.targetActionId));
    const buy = own.find(record => record.eventType === 'buy_reconciled' && !cancelled.has(record.actionId));
    return { allowed: true, reason: '', cancelBuy: buy ? buy.actionId : null };
}

/** VK-3b (Gutachten VK3-FABLE P2-3): Abbuchungsstand des Kaufbelegs, den „Kauf rückgängig“ zurücknimmt. Nur bei bestätigter Abbuchung ist
 * das Tagesgeld schon um die Belastung gekürzt. @param {any[]} records @param {any[]} buyStatuses @param {string|null} actionId
 * @returns {{confirmed: boolean, amount: number}|null} */
export function cancelledBuyDebit(records, buyStatuses, actionId) {
    if (!actionId) return null;
    const buy = records.find(record => record.eventType === 'buy_reconciled' && record.actionId === actionId);
    if (!buy) return null;
    const status = buyStatuses.find(item => item.targetActionId === actionId);
    return { confirmed: status?.isConfirmed === true, amount: Number(buy.actual?.netCashDebited) || 0 };
}

/** VK-3b (Gutachten VK3-FABLE P3-2): Ist der Abgleich nicht lesbar, bleibt Löschen gesperrt. */
export const DELETION_UNREADABLE = Object.freeze({ allowed: false, cancelBuy: null,
    reason: 'Löschen geht gerade nicht: Die eingetragenen Käufe und Verkäufe sind nicht lesbar. Bitte die Seite neu laden.' });

/** FR-83: Ohne Kaufdatum bleibt die manuelle Wahl erhalten. @param {string} date @param {string} type */
export function stockFromPurchaseDate(date, type) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? (date < '2009-01-01' ? 'aktien_alt' : 'aktien_neu') : type;
}

/** Bestehende Widersprüche anzeigen, erst bei geändertem Datum automatisch übernehmen.
 * @param {{category: string, type: string, purchaseDate: string}} tranche @param {string} [originalDate] */
export function purchaseStockState(tranche, originalDate = tranche.purchaseDate) {
    const equity = tranche.category === 'equity', dated = Boolean(tranche.purchaseDate);
    const expected = stockFromPurchaseDate(tranche.purchaseDate, tranche.type);
    const type = equity && dated && tranche.purchaseDate !== originalDate ? expected : tranche.type;
    return { equity, dated, expected, type, mismatch: equity && dated && type !== expected };
}

/** Split erhält den Einstand ohne Rundung des Kaufpreises. Die Vorschau schreibt keinen Verlauf.
 * @param {any} tranche @param {number} shares @param {string} reason */
export function correctedTranche(tranche, shares, reason) {
    if (!(Number.isFinite(shares) && shares > 0)) throw new Error('Bitte eine Stückzahl größer als 0 eintragen.');
    const purchasePrice = reason === 'split' ? trancheDetailFigures(tranche).costBasis / shares : tranche.purchasePrice;
    return { ...tranche, shares, purchasePrice, costBasis: shares * purchasePrice, marketValue: shares * tranche.currentPrice };
}
