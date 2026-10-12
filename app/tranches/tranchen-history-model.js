// Reine Tagesprojektionen. Keine Speicher-, Netzwerk-, DOM- oder Engineaufrufe.
import { historyDay, historyDate, normalizeHistorySymbol } from './tranchen-history-store.js';

export const HISTORY_ASSET_TYPES = ['aktien_alt', 'aktien_neu', 'anleihe', 'geldmarkt', 'gold', 'cash'];
const addValue = (a, b) => a === null || b === null || !Number.isFinite(a + b) ? null : a + b;
const emptyAllocation = () => Object.fromEntries(HISTORY_ASSET_TYPES.map(type => [type, 0]));
const sameShares = (a, b) => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

export function historyRange(startDate, today, period = 'all') {
    const start = historyDay(startDate), end = historyDay(today) - 1;
    let from = start;
    if (period === 'year') from = Math.max(start, historyDay(today.slice(0, 4) + '-01-01'));
    else if (period === '12m') {
        const last = historyDate(end), year = Number(last.slice(0, 4)) - 1, month = Number(last.slice(5, 7));
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        from = Math.max(start, historyDay(`${year}-${String(month).padStart(2, '0')}-${String(Math.min(Number(last.slice(8)), daysInMonth)).padStart(2, '0')}`));
    } else if (period !== 'all') throw new Error('Unbekannter Verlaufszeitraum.');
    return { start: from, end, startDate: historyDate(from), endDate: historyDate(end), period };
}

export function confirmedHistorySales(events = []) {
    const ids = new Map();
    for (const event of events) {
        if (event.eventType !== 'sale_reconciled') continue;
        if (!event.actionId) throw new Error('Verkaufskennung fehlt.');
        const key = `${event.profileId}\u0000${event.actionId}`;
        const old = ids.get(key);
        if (old) {
            if (JSON.stringify(old) !== JSON.stringify(event)) throw new Error('Widersprüchliche doppelte Verkaufskennung.');
            continue;
        }
        ids.set(key, event);
    }
    return [...ids.values()].sort((a, b) => a.executedAt.localeCompare(b.executedAt));
}

export function reconstructHistoryShares(lot, events = []) {
    const tranche = lot.tranche || lot;
    const remaining = lot.remainingShares ?? tranche.shares;
    if (lot.status === 'unknown') throw new Error('Bestand ohne belegte Ausführung verändert.');
    if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Ungültiger Restbestand.');
    if (!tranche.purchaseDate) throw new Error('Kaufdatum fehlt.');
    const purchaseDay = historyDay(tranche.purchaseDate);
    const sales = confirmedHistorySales(events).filter(event => event.trancheId === tranche.trancheId);
    let initial = remaining;
    for (const sale of sales) {
        const amount = sale.actual?.sharesSold;
        if (!Number.isFinite(amount) || amount <= 0 || historyDay(sale.executedAt) < purchaseDay) throw new Error('Ungültiger Stückbeleg.');
        initial += amount;
    }
    let shares = initial;
    const changes = [];
    for (const sale of sales) {
        if (!Number.isFinite(sale.result?.beforeShares) || !Number.isFinite(sale.result?.remainingShares)
            || !sameShares(shares, sale.result.beforeShares) || shares < sale.actual.sharesSold
            || !sameShares(shares - sale.actual.sharesSold, sale.result.remainingShares)) throw new Error('Verkaufsbelege und Restbestand widersprechen sich.');
        shares = sale.result.remainingShares;
        changes.push({ day: historyDay(sale.executedAt), shares, sale });
    }
    if (!sameShares(shares, remaining)) throw new Error('Endbestand widerspricht den Verkaufsbelegen.');
    if (lot.status === 'sold' && (remaining !== 0 || !sales.length)) throw new Error('Totalverkauf ist nicht belegt.');
    return { purchaseDay, initial, remaining, changes };
}
export function historySharesAt(chain, day) {
    if (day < chain.purchaseDay) return 0;
    let shares = chain.initial;
    for (const change of chain.changes) { if (change.day > day) break; shares = change.shares; }
    return shares;
}
export function historyCashAt(history, currentCash, day) {
    if (history == null) return { value: Number.isFinite(currentCash) && currentCash >= 0 ? currentCash : null, assumed: true, recorded: false };
    let value = history.baselineValue, assumed = true;
    for (const entry of history.entries) {
        if (historyDay(entry.date) > day) break;
        value = entry.value; assumed = false;
    }
    return { value, assumed, recorded: true };
}
export function historyWithdrawals(history, start, end) {
    if (history == null) return 0;
    if (!Number.isFinite(history.baselineValue) || history.baselineValue < 0
        || history.entries.some(entry => !Number.isFinite(entry.value) || entry.value < 0)) return null;
    let previous = history.baselineValue, sum = 0;
    for (let index = 0; index < history.entries.length; index++) {
        const entry = history.entries[index];
        const day = historyDay(entry.date);
        if (day > end) break;
        // Die validierte Liste ist datumssortiert; nur die letzte Bestätigung
        // eines Tages zählt. Zwischenwerte bleiben unverändert gespeichert.
        if (history.entries[index + 1]?.date === entry.date) continue;
        // V0 ist der erste Tagesabschluss und enthält bereits alle Änderungen am Starttag.
        if (day > start) sum += Math.max(previous - entry.value, 0);
        previous = entry.value;
    }
    return sum;
}
export function historyPriceAt(record, day) {
    const weekday = new Date(day * 86400000).getUTCDay();
    const queried = Boolean(record?.queried.some(([start, end]) => day >= start && day <= end));
    const gap = weekday !== 0 && weekday !== 6 && !queried;
    if (!record) return { value: null, status: 'missing-first-price', gap, queried, priceDay: null };
    if (record.currency && record.currency !== 'EUR') return { value: null, status: 'unsupported-currency', gap, queried, priceDay: null };
    let lo = 0, hi = record.days.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (record.days[mid] <= day) lo = mid + 1; else hi = mid; }
    if (!lo) return { value: null, status: 'missing-first-price', gap, queried, priceDay: null };
    return { value: record.closes[lo - 1], priceDay: record.days[lo - 1], status: gap ? 'open-gap' : record.days[lo - 1] === day ? 'close' : 'carried', gap, queried };
}

export function historyMetrics(points, withdrawals = null) {
    const complete = points.length > 0 && points.every(point => Number.isFinite(point.total));
    const provisional = points.some(point => point.gap || point.assumedCash);
    if (!complete) return { status: 'unavailable', change: null, percent: null, withdrawals, adjusted: null, adjustedPercent: null, peak: null, drawdown: null };
    const first = points[0].total, last = points.at(-1).total;
    let peak = { value: first, day: points[0].day }, running = { ...peak };
    let drawdown = { percent: 0, from: points[0].day, to: points[0].day };
    for (const point of points) {
        if (point.total > peak.value) peak = { value: point.total, day: point.day };
        if (point.total > running.value) running = { value: point.total, day: point.day };
        const percent = running.value > 0 ? (1 - point.total / running.value) * 100 : 0;
        if (percent > drawdown.percent) drawdown = { percent, from: running.day, to: point.day };
    }
    const change = last - first, comparable = points.length > 1 && first > 0;
    return { status: provisional ? 'provisional' : 'complete', change, percent: comparable ? change / first * 100 : null,
        withdrawals, adjusted: withdrawals === null ? null : change + withdrawals,
        adjustedPercent: comparable && withdrawals !== null ? (change + withdrawals) / first * 100 : null,
        peak, drawdown: points.length > 1 && peak.value > 0 ? drawdown : null };
}

// Nur fehlende Erstkurse dürfen den Messbeginn verschieben. Die Chartpunkte bleiben
// unverändert; andere Unsicherheiten und unbekannte Werte in der Messreihe sperren sie.
function measurementPoints(points, value, missingFirst) {
    const first = points.findIndex(point => Number.isFinite(value(point)));
    if (first < 0 || !points.slice(0, first).every(missingFirst)) return [];
    const measured = points.slice(first);
    return measured.every(point => Number.isFinite(value(point))) ? measured : [];
}

function stockUncertainty(lot) {
    if (lot.status !== 'unknown') return null;
    const tranche = lot.tranche || lot;
    try {
        const { fromDate, originalTranche } = lot.uncertainty;
        const fromDay = historyDay(fromDate), originalDay = historyDay(originalTranche.purchaseDate);
        const currentDay = historyDay(tranche.purchaseDate);
        if (originalTranche.trancheId !== tranche.trancheId || fromDay > originalDay || fromDay > currentDay
            || !HISTORY_ASSET_TYPES.includes(originalTranche.type)) throw new Error('Ungültige Bestandsunsicherheit.');
        return { fromDay, types: [...new Set([originalTranche.type, tranche.type])] };
    } catch {
        return { fromDay: null, types: [tranche.type] };
    }
}

/** profiles: normalisierte Bestände und Historien; Auswahl gilt auch für Entnahmen/Ereignisse. */
export function evaluateWealthHistory({ profiles, prices = { symbols: {} }, events = [], startDate, today, period = 'all', profileId = null, assetType = null }) {
    const range = historyRange(startDate, today, period);
    const selected = profiles.filter(profile => profileId ? profile.id === profileId : profile.belongsToHousehold !== false);
    const errors = [], marks = [], prepared = [];
    let sales, auditError = null;
    try { sales = confirmedHistorySales(events.filter(event => selected.some(profile => profile.id === event.profileId))); } catch (error) { errors.push(error.message); auditError = error.message; sales = []; }
    for (const profile of selected) {
        const ownSales = sales.filter(sale => sale.profileId === profile.id);
        const lots = profile.lots || [];
        let profileError = profile.error || auditError;
        if (profile.error) errors.push(profile.error);
        for (const sale of ownSales) if (assetType !== 'cash' && !lots.some(lot => (lot.tranche || lot).trancheId === sale.trancheId)) {
            profileError = 'Stammdaten eines historischen Verkaufs fehlen.'; errors.push(profileError);
        }
        const chains = lots.map(lot => ({ lot, uncertainty: stockUncertainty(lot) }))
            .filter(({ lot, uncertainty }) => !assetType || (uncertainty
                ? assetType !== 'cash' && (uncertainty.fromDay === null || uncertainty.types.includes(assetType))
                : (lot.tranche || lot).type === assetType)).map(({ lot, uncertainty }) => {
            const tranche = lot.tranche || lot;
            try {
                const chain = reconstructHistoryShares(lot, ownSales);
                const symbol = tranche.ticker ? normalizeHistorySymbol(tranche.ticker) : null;
                marks.push({ kind: 'buy', day: chain.purchaseDay, name: tranche.name, symbol, shares: chain.initial, amount: chain.initial * tranche.purchasePrice });
                chain.changes.forEach(change => marks.push({ kind: 'sell', day: change.day, name: tranche.name, symbol, shares: change.sale.actual.sharesSold, amount: change.sale.actual.grossProceeds }));
                return { tranche, chain, symbol };
            } catch (error) {
                const diagnostic = uncertainty ? uncertainty.fromDay === null
                    ? 'Bestand unbekannt: ursprünglicher Kaufbeginn nicht gesichert; jeder Tag bleibt unvollständig.'
                    : `Bestand unbekannt ab ${historyDate(uncertainty.fromDay)}; keine belegte Ausführung.` : error.message;
                errors.push(`${profile.id}: ${diagnostic}`);
                return { tranche, error: diagnostic, uncertainty };
            }
        });
        prepared.push({ profile, chains, profileError });
    }
    const points = [], types = new Set();
    for (const { chains } of prepared) for (const { tranche, uncertainty } of chains) {
        for (const type of assetType ? [assetType] : uncertainty?.types || [tranche.type]) types.add(type);
    }
    if (!assetType || assetType === 'cash') types.add('cash');
    for (let day = range.start; day <= range.end; day++) {
        const allocation = emptyAllocation(), quality = [], byProfile = {};
        let assumedCash = false, gap = false, known = 0, incomplete = !selected.length;
        for (const { profile, chains, profileError } of prepared) {
            const own = emptyAllocation();
            let ownKnown = 0;
            if (profileError) quality.push('invalid-profile');
            if (!assetType || assetType === 'cash') {
                const cash = historyCashAt(profile.cashHistory, profile.currentCash, day);
                own.cash = cash.value; assumedCash ||= cash.assumed;
                if (Number.isFinite(cash.value)) ownKnown = addValue(ownKnown, cash.value);
                if (cash.value === null) quality.push('missing-cash');
            }
            for (const { tranche, chain, symbol, error, uncertainty } of chains) {
                let value = null;
                if (error) {
                    if (Number.isInteger(uncertainty?.fromDay) && day < uncertainty.fromDay) value = 0;
                    else quality.push(uncertainty ? uncertainty.fromDay === null ? 'unknown-stock-undated' : 'unknown-stock' : 'invalid-shares');
                }
                else {
                    const shares = historySharesAt(chain, day);
                    if (shares === 0) value = 0;
                    else if (!symbol) quality.push('missing-ticker');
                    else {
                        const price = historyPriceAt(prices.symbols[symbol], day);
                        gap ||= price.gap;
                        quality.push(price.status);
                        if (price.value !== null && Number.isFinite(shares * price.value)) value = shares * price.value;
                    }
                }
                if (Number.isFinite(value)) ownKnown = addValue(ownKnown, value);
                for (const type of assetType ? [assetType] : uncertainty?.types || [tranche.type]) own[type] = addValue(own[type], value);
            }
            const total = profileError || ownKnown === null || Object.values(own).some(value => value === null) ? null : ownKnown;
            byProfile[profile.id] = { allocation: own, total, known: ownKnown };
            incomplete ||= total === null;
            known = addValue(known, ownKnown);
            for (const type of HISTORY_ASSET_TYPES) allocation[type] = addValue(allocation[type], own[type]);
        }
        points.push({ day, date: historyDate(day), allocation, byProfile, known: Number.isFinite(known) ? known : null,
            total: incomplete || !Number.isFinite(known) ? null : known,
            quality: [...new Set(quality)], gap, assumedCash });
    }
    const measured = measurementPoints(points, point => point.total,
        point => point.quality.includes('missing-first-price') && point.quality.every(status =>
            ['missing-first-price', 'close', 'carried', 'open-gap'].includes(status)));
    const measurementStart = measured[0]?.day ?? null;
    const cashSums = selected.map(profile => profile.error || profile.cashHistory == null && (!Number.isFinite(profile.currentCash) || profile.currentCash < 0)
        ? null : historyWithdrawals(profile.cashHistory, measurementStart ?? range.start, range.end));
    const withdrawals = assetType && assetType !== 'cash' ? null : cashSums.length && cashSums.every(Number.isFinite) ? cashSums.reduce((a, b) => a + b, 0) : null;
    const metrics = historyMetrics(measured, withdrawals);
    if (measurementStart !== null && measurementStart > range.start) metrics.status = 'provisional';
    const gaps = [];
    for (const point of points) if (point.gap) {
        const last = gaps.at(-1);
        if (last && last[1] === point.day - 1) last[1] = point.day; else gaps.push([point.day, point.day]);
    }
    return { range, points, types: HISTORY_ASSET_TYPES.filter(type => types.has(type)), errors: [...new Set(errors)], gaps,
        events: marks.filter(mark => mark.day >= range.start && mark.day <= range.end).sort((a, b) => a.day - b.day),
        measurementStart, metrics, end: points.at(-1) || null };
}

// Für den späteren Detailchart: Kursentwicklung unabhängig von verkauften Stückzahlen.
export function evaluateHistoryCourse({ tranche, prices, startDate, today, period = 'all' }) {
    const range = historyRange(tranche.purchaseDate > startDate ? tranche.purchaseDate : startDate, today, period);
    const symbol = tranche.ticker ? normalizeHistorySymbol(tranche.ticker) : null;
    const points = [];
    for (let day = range.start; day <= range.end; day++) points.push({ day, ...historyPriceAt(symbol ? prices.symbols[symbol] : null, day) });
    const measured = symbol ? measurementPoints(points, point => point.value, point => point.status === 'missing-first-price') : [];
    const measurementStart = measured[0]?.day ?? null;
    const first = measured[0]?.value, last = measured.at(-1)?.value;
    const status = !measured.length ? 'unavailable' : measurementStart > range.start || measured.some(point => point.gap) ? 'provisional' : 'complete';
    return { range, symbol, points, measurementStart, status,
        percent: measured.length > 1 && first > 0 ? (last / first - 1) * 100 : null, purchasePrice: tranche.purchasePrice };
}
