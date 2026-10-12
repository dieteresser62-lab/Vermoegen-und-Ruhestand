import { renderThreeBucketPortfolioChart } from '../app/simulator/simulator-portfolio-chart.js';
import { invalidateBacktestForHousehold } from '../app/simulator/simulator-backtest.js';

// Nur DOM und Größenereignisse sind synthetisch; der echte Renderer zeichnet die Pfade.
export function createPortfolioFixture({ observer = true } = {}) {
    const callbacks = new Set(), observers = [];
    const view = {
        getComputedStyle: node => ({ paddingLeft: `${node.paddingLeft || 0}px`, paddingRight: `${node.paddingRight || 0}px` }),
        addEventListener: (type, fn) => { if (type === 'resize') callbacks.add(fn); }, removeEventListener: (type, fn) => { if (type === 'resize') callbacks.delete(fn); }
    };
    if (observer) view.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(node) { this.host = node; }
        disconnect() { this.disconnected = true; }
    };
    const doc = { defaultView: view, nodes: [], querySelectorAll: () => [], getElementById: id => doc.nodes.find(node => node.id === id) || null };
    doc.createElement = tag => {
        const node = { tag, ownerDocument: doc, children: [], attributes: {}, style: {}, isConnected: true, clientWidth: 0,
            textContent: '', setAttribute(key, value) { this.attributes[key] = String(value); },
            getAttribute(key) { return this.attributes[key] ?? null; },
            get firstChild() { return this.children[0] || null; },
            get innerHTML() { return ''; }, set innerHTML(_value) { this.children = []; },
            appendChild(child) { this.children.push(child); return child; },
            replaceChild(child, old) { this.children[this.children.indexOf(old)] = child; return old; }
        };
        doc.nodes.push(node); return node;
    };
    doc.createElementNS = (_ns, tag) => doc.createElement(tag);
    const host = doc.createElement('div'); host.id = 'portfolioCompositionChart';
    host.clientWidth = 1400; host.paddingLeft = 24; host.paddingRight = 16;
    return { doc, host, observers, callbacks, resize() { [...callbacks].forEach(fn => fn()); }, observe() { observers.at(-1)?.callback(); } };
}
const rows = [
    { wertAktien: 100, wertGold: 20, liquiditaet: 30, row: { bondBucketAfter: 40 } },
    { wertAktien: 200, wertGold: 40, liquiditaet: 60, row: { bondBucketAfter: 50 } }
];
const previous = globalThis.document, previousWindow = globalThis.window;
try {
    {
        const f = createPortfolioFixture(); globalThis.document = f.doc;
        const calendarRows = [2000, 2001, 2002].map((year, i) => ({ ...rows[i % 2], jahr: year }));
        const result = { rows: calendarRows, ruinYear: 2001 };
        const bytes = JSON.stringify(result);
        renderThreeBucketPortfolioChart(f.host, calendarRows, { result, calendar: true });
        const labels = () => f.host.children[0].children.filter(node => node.tag === 'text').map(node => node.textContent);
        const beforeLabels = JSON.stringify(labels());
        assert(labels().includes(2000) && labels().includes(2001) && !labels().includes(2002), 'Kalender endet am Ruinjahr');
        assert(labels().includes('Dotcom-Crash') && labels().some(label => String(label).includes('€')), 'Kalender behält Krisen und Euroeinheiten');
        f.host.clientWidth = 1920; f.observe();
        assertEqual(JSON.stringify(labels()), beforeLabels, 'Resize erhält sämtliche Kalender-, Krisen- und Eurotexte');
        assertEqual(JSON.stringify(result), bytes, 'Kalenderresize erhält Resultat und Ruinquelle');
        renderThreeBucketPortfolioChart(f.host, []);
        assert(!f.host.children.length && !f.callbacks.size && f.observers.at(-1).disconnected, 'Leerer Folgeauftrag beendet alte Bindung');
    }
    {
        const f = createPortfolioFixture(); globalThis.document = f.doc;
        const prototype = f.doc.defaultView.ResizeObserver.prototype;
        delete prototype.disconnect;
        prototype.unobserve = function(host) { this.unobserved = host; };
        renderThreeBucketPortfolioChart(f.host, rows);
        const observer = f.observers[0];
        renderThreeBucketPortfolioChart(f.host, []);
        assert(observer.unobserved === f.host && !f.callbacks.size, 'Unobserve beendet auch Observer ohne disconnect-Methode');
        observer.callback(); assertEqual(f.host.children.length, 0, 'Unobserve entwertet verspäteten Observercallback');
    }
    for (const observer of [true, false]) {
        const f = createPortfolioFixture({ observer }); globalThis.document = f.doc; globalThis.window = f.doc.defaultView;
        const bytes = JSON.stringify(rows);
        renderThreeBucketPortfolioChart(f.host, rows);
        const svg = () => f.host.children.find(node => node.tag === 'svg');
        assertEqual(svg().getAttribute('width'), '1360', 'Erste Zeichnung nutzt Host-Inhaltsbreite mit Paddingabzug');
        assertEqual(svg().getAttribute('viewBox'), '0 0 1360 320', 'Native Maße und viewBox stimmen überein');
        const legend = f.host.children[1], hint = f.host.children[2], first = svg();
        const foreign = f.doc.createElement('p'); foreign.textContent = 'Veralteter Portfolioverlauf · bisheriger Lauf'; f.host.appendChild(foreign);
        f.resize(); f.observe(); assert(svg() === first, 'Unveränderte Breite zeichnet nicht erneut');
        f.host.clientWidth = 1960; f.resize(); f.observe();
        assertEqual(svg().getAttribute('width'), '1920', 'Resize misst erneut statt SVG prozentual zu skalieren');
        assertEqual(svg().children.filter(node => node.tag === 'path').length, 4, 'Resize erhält alle vier Serien');
        assert(f.host.children[1] === legend && f.host.children[2] === hint && f.host.children[3] === foreign,
            'Resize erhält Legende, Scrollhinweis und Fremdhinweis mit Identität');
        assertEqual(JSON.stringify(rows), bytes, 'Resize verändert keine Quelldaten');
        const oldCallback = f.observers.at(-1)?.callback, oldWindow = [...f.callbacks][0];
        renderThreeBucketPortfolioChart(f.host, rows.slice(0, 1));
        const replacement = svg(); f.host.clientWidth = 2560; oldCallback?.(); oldWindow();
        assert(svg() === replacement, 'Neuer Auftrag entwertet alte Observer- und Fenstercallbacks');
        f.resize(); assertEqual(svg().getAttribute('width'), '2520', 'Neuer Auftrag besitzt eigenen Resizepfad');
        f.host.clientWidth = 0; f.resize(); assertEqual(svg().getAttribute('width'), '820', 'Verborgener Host nutzt Mindestbreitenfallback');
        f.host.clientWidth = 1400; f.observe(); f.resize(); assertEqual(svg().getAttribute('width'), '1360', 'Sichtbarer Host wird erneut gemessen');
        f.host.clientWidth = 390; f.resize(); assertEqual(svg().getAttribute('width'), '820', 'Schmaler Host behält Mindestbreite für Scrollschutz');
        const clearedCallback = f.observers.at(-1)?.callback, clearedWindow = [...f.callbacks][0];
        invalidateBacktestForHousehold();
        assertEqual(f.host.children.length, 0, 'Produktiver Backtest-Clear entfernt den Chart');
        f.host.clientWidth = 1920; clearedCallback?.(); clearedWindow();
        assertEqual(f.host.children.length, 0, 'Clear bleibt gegen verspätete Resizecallbacks geschützt');
        assertEqual(f.callbacks.size, 0, 'Clear entfernt Fensterbindung');
        renderThreeBucketPortfolioChart(f.host, rows);
        const detached = svg(); f.host.isConnected = false; f.host.clientWidth = 2560; f.resize();
        assert(svg() === detached && !f.callbacks.size, 'Entfernter Host wird nicht neu gezeichnet und löst Bindung');
    }
} finally { globalThis.document = previous; globalThis.window = previousWindow; }
