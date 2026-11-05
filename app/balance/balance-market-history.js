/** Kurslinie für die gemeinsame Jahreshoch-Anzeige; ausschließlich gespeicherte Kurse. */
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

/** @param {Document} doc
 * @param {ReturnType<typeof import('./balance-market-preview.js').projectMarketPreview>} view
 * @param {boolean} [annual] */
export function createMarketHistory(doc, view, annual = false) {
    const host = doc.createElement('figure'); host.className = 'balance-market-history';
    const svg = (tag, attrs = {}, text = '') => {
        const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        if (text) node.textContent = text;
        return node;
    };
    const money = value => formatDisplayNumber(value, { fractionDigits: 2 }) + ' €';
    const date = value => value?.split('-').reverse().join('.') || 'Datum nicht belegt';
    const start = { asOf: view.yearEndDate, price: view.stored.index }, quote = view.quote;
    if (!quote) return host;
    const high = view.yearlyHigh || quote;
    const points = [start, ...(view.closes || []).filter(point => point.asOf > start.asOf)];
    const threshold = view.high.deepBear.threshold;
    const low = Math.min(threshold, ...points.map(point => point.price)) * 0.93;
    const top = Math.max(threshold, ...points.map(point => point.price)) * 1.1;
    const from = Date.parse(start.asOf), duration = Math.max(86400000, Date.parse(quote.asOf) - from);
    const x = point => 58 + (Date.parse(point.asOf) - from) / duration * 564;
    const y = value => 173 - (value - low) / (top - low || 1) * 142;
    const root = svg('svg', { viewBox: '0 0 680 230', role: 'img',
        'aria-label': `Schlusskurse VWCE.DE seit Ende ${view.yearEndDate.slice(0, 4)}: ${money(start.price)}, Jahreshoch ${money(high.price)} am ${date(high.asOf)}, ${annual ? 'Jahresende' : 'heute'} ${money(quote.price)}; tiefer Bärenmarkt unter ${money(threshold)}; gepunktet: Sicht der Jahresendregel.` });
    root.append(svg('rect', { x: 58, y: y(threshold), width: 564, height: 173 - y(threshold), fill: 'var(--warn-soft)' }));
    for (const value of [low, (low + top) / 2, top]) {
        root.append(svg('line', { x1: 58, x2: 622, y1: y(value), y2: y(value), stroke: 'var(--border)' }),
            svg('text', { x: 50, y: y(value) + 4, 'text-anchor': 'end', fill: 'var(--text-muted)' }, formatDisplayNumber(value, { fractionDigits: 0 })));
    }
    root.append(svg('line', { x1: 58, x2: 622, y1: y(threshold), y2: y(threshold), stroke: 'var(--warn)', 'stroke-dasharray': '6 4' }),
        svg('line', { x1: 58, x2: x(quote), y1: y(start.price), y2: y(quote.price), stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '2 5' }),
        svg('path', { d: points.map((point, i) => `${i ? 'L' : 'M'}${x(point).toFixed(2)},${y(point.price).toFixed(2)}`).join(' '), fill: 'none', stroke: 'var(--text-main)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    const markers = /** @type {[{asOf: string, price: number}, string, string][]} */ ([[start, `Ende ${start.asOf.slice(0, 4)}: ${money(start.price)}`, 'start'],
        [high, `Jahreshoch ${money(high.price)} · ${date(high.asOf)}`, 'middle'],
        [quote, `${annual ? 'Ende ' + quote.asOf.slice(0, 4) : 'heute'} ${money(quote.price)}`, 'end']]);
    for (const [point, label, anchor] of markers) {
        root.append(svg('circle', { cx: x(point), cy: y(point.price), r: 4, fill: point === high ? 'var(--accent)' : 'var(--surface)', stroke: 'var(--text-main)', 'stroke-width': 2 }),
            svg('text', { x: point === high ? Math.max(210, Math.min(470, x(point))) : x(point), y: point === high ? 18 : 195, 'text-anchor': anchor, fill: 'var(--text-main)' }, label));
    }
    root.append(svg('text', { x: 622, y: 220, 'text-anchor': 'end', fill: 'var(--warn)' }, `Tiefer Bär unter ${money(threshold)}`));
    const caption = doc.createElement('figcaption'); caption.className = 'ds-source';
    // Die Bärenfläche misst am Hoch der zweiten Lesart; liegt ein älteres gespeichertes Hoch höher, ist es dieses.
    const measured = view.high.high.origin !== 'stored_close' && view.high.high.value > high.price
        ? `gemessen am gespeicherten Hoch von ${money(view.high.high.value)}` : 'gemessen am Jahreshoch';
    caption.textContent = `Gespeicherte Schlusskurse VWCE.DE seit Ende ${view.yearEndDate.slice(0, 4)}, € je Anteil. Gepunktet: Sicht der Jahresendregel. Fläche: tiefer Bärenmarkt, ${measured}.`;
    host.append(root, caption); return host;
}
