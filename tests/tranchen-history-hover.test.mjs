import { bindHistoryDayInteraction, bindHistoryChartSize, selectHistoryDayIndex, renderWealthHistorySvg } from '../app/tranches/tranchen-history-svg.js';
import { historyDay, historyDate } from '../app/tranches/tranchen-history-store.js';
import { formatDisplayNumber } from '../app/shared/designsystem-number-format.js';
const start = historyDay('2026-01-01');
const points = Array.from({ length: 800 }, (_, i) => ({ day: start + i, date: historyDate(start + i), total: 200000 + i,
    known: 200000 + i, allocation: { aktien: 100000 + i, geldmarkt: 50000, cash: 40000, gold: 10000 }, quality: [] }));
points[42].allocation = { aktien: 100040, geldmarkt: 50000, cash: 40000, gold: 10002 }; // kein Cash-/Nullbestandswechsel
points[63] = { ...points[63], total: null, allocation: { ...points[63].allocation, aktien: null }, quality: ['missing-first-price'] };
points[64] = { ...points[64], total: 0, allocation: { aktien: 0, geldmarkt: 0, cash: 0, gold: 0 } };
points[65] = { ...points[65], total: 210045, allocation: { ...points[65].allocation, cash: 50000 } };
const history = { points, range: { start, end: start + 799 }, types: ['aktien', 'geldmarkt', 'cash', 'gold'], gaps: [], events: [] };
const input = JSON.stringify(history);
for (const [pos, expected] of [[start - 50, 0], [start + .5, 0], [start + 1, 0], [start + 1.001, 1], [start + 42.5, 42], [start + 900, 799]])
    assertEqual(selectHistoryDayIndex(points, pos), expected, 'Originaltag über Tagesmitten inklusive früherem Gleichstand');
assertEqual(selectHistoryDayIndex([], start), -1, 'Leere Reihe hat keine Auswahl');
assertEqual(selectHistoryDayIndex(points, NaN), -1, 'Ungültige Geometrie hat keine Auswahl');
const rendered = renderWealthHistorySvg(history, { width: 280, height: 440 });
const drawnX = [...rendered.matchAll(/<path class="history-total"[^>]* d="([^"]+)"/g)].flatMap(m => m[1].slice(1).split('L').map(p => Number(p.split(',')[0])));
const omittedX = 84 + 42.5 / 800 * 168;
assert(!drawnX.some(x => Math.abs(x - omittedX) < .005), 'Abweichend aufgeteilter Tag 42 wird tatsächlich nicht gezeichnet');

class Node {
    constructor(name, doc) { this.name = name; this.ownerDocument = doc; this.children = []; this.attributes = {}; this.listeners = new Map(); this.text = ''; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(n => { n.parent = null; }); this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, event = {}) { for (const fn of [...(this.listeners.get(type) || [])]) fn({ preventDefault() {}, ...event }); }
    focus() { this.ownerDocument.activeElement = this; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join('\n'); }
    set textContent(value) { this.text = value; this.children = []; }
}
for (const observerMode of [true, false]) {
    let writes = 0, requests = 0, projections = 0;
    const savedFetch = globalThis.fetch, savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    globalThis.fetch = () => { requests++; throw new Error('Unerwarteter Kursabruf'); };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { writes++; }, removeItem() { writes++; }, clear() { writes++; } } });
    const frames = new Map(), observers = [], removals = [], win = new Node('window'); let frameId = 0;
    Object.assign(win, { requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); },
        fetch() { requests++; }, localStorage: { setItem() { writes++; } },
        MutationObserver: class { constructor(fn) { this.callback = fn; removals.push(this); } observe() {} disconnect() { this.disconnected = true; } } });
    if (observerMode) win.ResizeObserver = class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
    const doc = { defaultView: win, documentElement: {}, activeElement: null, createElement: name => { const node = new Node(name, doc); if (doc.measuredHeight) node.scrollHeight = doc.measuredHeight; return node; }, createElementNS: (_, name) => new Node(name, doc) };
    const host = new Node('host', doc); Object.assign(host, { clientWidth: 280, clientHeight: 440, isConnected: true });
    host.querySelector = () => host.children.find(n => n.name === 'svg');
    const draw = source => {
        host.replaceChildren();
        if (!source) return;
        const svg = new Node('svg', doc);
        svg.viewBox = { baseVal: { width: host.clientWidth, height: 440 } };
        svg.dataset = { historyLeft: '84', historyRight: String(host.clientWidth - 28), historyTop: '60', historyBottom: '380' };
        svg.getScreenCTM = () => ({ inverse: () => ({}) });
        svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: (this.x - 100) / 2 }; } });
        host.append(svg);
    };
    const prepareProjection = () => { projections++; return history; };
    const initialProjection = prepareProjection(), preparedCount = projections;
    const bind = bindHistoryDayInteraction(host);
    assertEqual(bindHistoryDayInteraction(host), bind, 'Hostbindung ist idempotent');
    const size = bindHistoryChartSize(host, draw);
    size.update(initialProjection);
    let svg = host.querySelector();
    const field = () => svg.children.find(n => n.name === 'foreignObject');
    const status = () => host.children.find(n => n.className === 'history-day-status');
    const pointer = i => svg.emit('pointermove', { clientX: 100 + 2 * (84 + (i + .5) / 800 * (host.clientWidth - 112)), clientY: 80 });
    const key = k => svg.emit('keydown', { key: k });
    const resize = width => {
        host.clientWidth = width;
        if (observerMode) observers[0].callback([{ target: host, contentRect: { width, height: 440 } }]);
        else win.emit('resize');
        assertEqual(frames.size, 1, 'Resize plant genau einen Frame');
        const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
        svg = host.querySelector();
    };
    const money = value => formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 });
    const check = i => {
        const content = field().textContent;
        assert(content.includes(historyDate(start + i).split('-').reverse().join('.')), 'Datum stammt vom ausgewählten Originaltag ' + i);
        assert(content.includes('Gesamtwert: ' + (points[i].total === null ? '—' : money(points[i].total))), 'Originalgesamtwert inklusive Null/Unbekannt ' + i);
        for (const [type, value] of Object.entries(points[i].allocation)) assert(content.includes(value === null ? '—' : money(value)), 'Originalaufteilung ' + type + '/' + i);
        assert(!content.includes('Tagesgeld (stufig)') && content.includes('Tagesgeld:'), 'Hover verwendet das kurze Tagesgeldlabel');
        const a = field().attributes;
        assert(Number(a.x) >= 0 && Number(a.y) >= 0 && Number(a.x) + Number(a.width) <= host.clientWidth && Number(a.y) + Number(a.height) <= 440, 'Tagesfeld liegt vollständig innerhalb der Grafik');
        const guide = svg.children.find(n => n.name === 'line');
        const gx = Number(guide.attributes.x1), fx = Number(a.x), fw = Number(a.width);
        if (gx >= fw + 20 || host.clientWidth - gx >= fw + 20) assert(fx >= gx + 11.99 || fx + fw <= gx - 11.99, 'Bei ausreichend Platz liegt das Feld seitlich mit Abstand zur Hilfslinie');
        assert(Number(guide.attributes.x1) >= 84 && Number(guide.attributes.x1) <= host.clientWidth - 28, 'Hilfslinie liegt innerhalb des Plots');
    };
    for (const i of [0, 2, 42, 63, 64, 65, 799]) { pointer(i); check(i); }
    assertEqual(status().textContent, '', 'Zeigerbewegung erzeugt keine Liveansage');
    svg.emit('pointerleave'); assert(!field(), 'Zeigerverlassen schließt Zeigerauswahl');
    svg.focus(); key('ArrowLeft'); check(799);
    key('ArrowRight'); check(799);
    pointer(62); key('ArrowRight'); check(63);
    assert(status().textContent.includes('Gesamtwert nicht vollständig bewertbar'), 'Tastatur liest unbekannten Tag und Qualität vor');
    svg.emit('pointerleave'); check(63);
    key('ArrowRight'); check(64);
    // Tastatur → Zeiger: auch derselbe Tag übernimmt die Auswahlquelle und bleibt stumm.
    pointer(64); check(64);
    assertEqual(status().textContent, '', 'Zeiger auf demselben Tag leert den vorherigen Tastaturstatus');
    resize(300); check(64);
    assertEqual(status().textContent, '', 'Resize einer Zeigerauswahl erzeugt keine Statusansage');
    svg.emit('pointerleave'); assert(!field(), 'Zeigerverlassen schließt nach Tastatur → Zeiger auf demselben Tag');
    resize(320);
    assert(!field() && status().textContent === '', 'Resize nach Verlassen erhält geschlossene Anzeige und leeren Status');
    key('ArrowLeft'); check(799);
    pointer(42); check(42);
    assertEqual(status().textContent, '', 'Zeiger auf anderem Tag erzeugt nach Tastatur keine Statusansage');
    svg.emit('pointerleave'); assert(!field(), 'Zeigerverlassen schließt nach Tastatur → Zeiger auf anderem Tag');
    resize(340);
    assert(!field() && status().textContent === '', 'Auch nach anderem Zeigertag bleibt Resize ohne Statusansage');
    pointer(62); key('ArrowRight'); check(63);
    svg.emit('pointerleave'); check(63);
    assert(status().textContent.includes('Gesamtwert nicht vollständig bewertbar'), 'Zeiger → Tastatur bleibt beim Verlassen mit Tastaturstatus offen');
    key('Escape'); assert(!field() && doc.activeElement === svg, 'Esc schließt bei erhaltenem Grafikfokus');
    pointer(0); key('ArrowLeft'); check(0);
    const oldSvg = svg;
    host.clientWidth = 540;
    if (observerMode) observers[0].callback([{ target: host, contentRect: { width: 540, height: 440 } }]);
    else win.emit('resize');
    assertEqual(frames.size, 1, 'Resize plant genau einen Frame');
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
    svg = host.querySelector(); check(0);
    assert(doc.activeElement === svg && oldSvg !== svg, 'Resize stellt Grafikfokus und ausgewählten Tag wieder her');
    assert([...oldSvg.listeners.values()].every(set => set.size === 0), 'Replace entfernt sämtliche alten SVGlistener');
    svg.emit('blur'); assert(!field(), 'Fokusverlust schließt Auswahl');
    pointer(42);
    const replacement = { ...history, points: points.map(p => p.day === start + 42 ? { ...p, total: 999999, allocation: { ...p.allocation, gold: 77777 } } : p) };
    size.update(replacement); svg = host.querySelector();
    assert(field().textContent.includes(money(999999)) && field().textContent.includes(money(77777)), 'Aktualisierung verwendet ausschließlich neue Originalwerte');
    size.update({ ...history, points: points.slice(100), range: { start: start + 100, end: start + 799 } }); svg = host.querySelector();
    assert(!field(), 'Zeitraumwechsel schließt nicht mehr vorhandenen Tag');
    key('ArrowLeft'); assert(field().textContent.includes(historyDate(start + 799).split('-').reverse().join('.')), 'Neue Zeitraumreihe startet beim letzten Originaltag');
    size.update({ ...history, points: [{ ...points[0], date: '<img onerror=bad>', allocation: { '<script>': 12 } }], types: ['<script>'] }); svg = host.querySelector();
    key('ArrowLeft');
    assert(field().textContent.includes('<img onerror=bad>') && field().textContent.includes('<script>'), 'Fremde Datentexte stehen unverändert in Textknoten');
    assert(field().children[0].children.every(node => node.name === 'div' && node.children.length === 0), 'Kein fremdes Markup wird als Element erzeugt');
    // Injiziert wird die vom Browser gemeldete Umbruchhöhe, keine Produktionsrechnung.
    doc.measuredHeight = 400; host.clientWidth = 160;
    const large = 123456789012345;
    size.update({ ...history, points: [{ ...points[0], total: large, allocation: { cash: large } }], types: ['cash'] }); svg = host.querySelector();
    key('ArrowLeft');
    assert(field().textContent.includes(money(large)) && Number(field().attributes.height) >= 402, 'Langer Betrag bleibt vollständig im Text; tatsächliche Umbruchhöhe vergrößert das Feld');
    assert(Number(field().attributes.x) + Number(field().attributes.width) <= 160 && Number(field().attributes.y) + Number(field().attributes.height) <= 440, 'Schmales Feld mit langem Betrag bleibt innerhalb der Grafik');
    delete doc.measuredHeight;
    host.clientWidth = 0;
    size.update(null); assertEqual(host.children.length, 0, 'Fehlende Historie entfernt SVG, Tagesfeld und Status');
    host.clientWidth = 540; size.update(history); svg = host.querySelector();
    const second = new Node('host', doc); second.querySelector = () => second.children[0]; draw(history);
    const secondSvg = host.children[0]; host.children = []; second.append(secondSvg); draw(history); svg = host.querySelector(); bind.update(history);
    const other = bindHistoryDayInteraction(second); other.update(history);
    pointer(42); secondSvg.emit('keydown', { key: 'ArrowLeft' });
    assert(field().textContent.includes('12.02.2026') && secondSvg.textContent.includes(historyDate(start + 799).split('-').reverse().join('.')), 'Zwei Charts besitzen unabhängige Auswahl');
    other.dispose(); assert([...secondSvg.listeners.values()].every(set => set.size === 0), 'Eigenes Dispose entfernt zweite Chartlistener');
    host.clientWidth = 600;
    if (observerMode) observers[0].callback([{ target: host, contentRect: { width: 600, height: 440 } }]); else win.emit('resize');
    host.isConnected = false; removals[0].callback();
    assertEqual(frames.size, 0, 'Hostentfernung verwirft ausstehenden Frame');
    assert([...svg.listeners.values()].every(set => set.size === 0) && !field(), 'Hostentfernung entfernt Tageslistener und Overlay');
    assert([...win.listeners.values()].every(set => set.size === 0), 'Hostentfernung räumt Windowlistener auf');
    size.dispose();
    host.isConnected = true; const rebound = bindHistoryDayInteraction(host); const freshSize = bindHistoryChartSize(host, draw); freshSize.update(history); svg = host.querySelector(); pointer(42);
    win.emit('pagehide'); assert(!field() && [...svg.listeners.values()].every(set => set.size === 0), 'Pagehide räumt erneute Bindung auf'); rebound.dispose();
    assertEqual(writes + requests, 0, 'Hover/Tastatur/Resize starten keine Writes oder Requests');
    assertEqual(projections, preparedCount, 'Hover/Tastatur/Resize verwenden die vorbereitete Projektion ohne erneuten Fachaufruf');
    assertEqual(JSON.stringify(history), input, 'Alle Original-, Qualitäts- und Aufteilungsbytes bleiben unverändert');
    globalThis.fetch = savedFetch;
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete globalThis.localStorage;
}
