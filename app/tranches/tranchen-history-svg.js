import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { historyDate } from './tranchen-history-store.js';

export const HISTORY_TYPE_LABELS = { aktien: 'Aktien', aktien_alt: 'Aktien · Altbestand', aktien_neu: 'Aktien · Neubestand', anleihe: 'Anleihen', geldmarkt: 'Geldmarkt', gold: 'Gold', cash: 'Tagesgeld (stufig)' };
let svgSequence = 0;
const n = value => Number(value.toFixed(2));
const dateLabel = day => historyDate(day).split('-').reverse().join('.');
const shortMoney = value => value >= 1e6 ? `${(value / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.` : value.toLocaleString('de-DE', { maximumFractionDigits: 0 });
const roundMultiple = (value, step, up) => {
    const ratio = value / step, nearest = Math.round(ratio);
    const tolerant = Math.abs(ratio - nearest) <= 16 * Number.EPSILON * Math.max(1, Math.abs(ratio)) ? nearest : ratio;
    return (up ? Math.ceil(tolerant) : Math.floor(tolerant)) * step;
};
const roundedStep = target => {
    const magnitude = 10 ** Math.floor(Math.log10(target));
    return Math.max(Number.MIN_VALUE, magnitude > 0 ? roundMultiple(target, magnitude, true) : target);
};

/** Gesamte gewählte Originalreihe, unabhängig von Zeichnungsbudget und Pixelbreite. */
export function wealthHistoryScale(points) {
    let min = Infinity, max = 0, peak = 0;
    for (const point of points) {
        if (Number.isFinite(point.total) && point.total >= 0) {
            min = Math.min(min, point.total); max = Math.max(max, point.total);
        }
        if (Number.isFinite(point.known) && point.known >= 0) peak = Math.max(peak, point.known);
    }
    peak = Math.max(peak, max);
    if (!Number.isFinite(min)) min = 0;
    const delta = max - min, small = delta < .02 * min;
    const target = Math.max(delta, .04 * min) / 4;
    const cropStep = Number.isFinite(target) && target > 0 ? roundedStep(target) : 0;
    const floor = cropStep ? Math.max(0, roundMultiple(Math.max(0, min - Math.max(delta / 2, small ? .02 * min : 0)), cropStep, false)) : 0;
    if (floor > 0) {
        const padding = Math.max(cropStep / 2, small ? .02 * min : 0);
        return { floor, ceiling: Math.min(Number.MAX_VALUE, roundMultiple(peak + padding, cropStep, true)), step: cropStep };
    }
    // Nullstart behält vier gerundete Intervalle; exakte Maxima brauchen obere Luft.
    const step = roundedStep((peak || 1) / 4);
    let ceiling = step * 4;
    const required = small ? max + .02 * min : peak;
    if (required > ceiling) ceiling = roundMultiple(required, step, true);
    if (ceiling <= peak) ceiling += step;
    return { floor: 0, ceiling: Math.min(Number.MAX_VALUE, ceiling), step };
}

// Nur Achsenlabels: genügend Dezimalstellen für kleine absolute Spannweiten.
function axisMoney(value, step) {
    if (step < 1e-20) return value.toLocaleString('de-DE', { notation: 'scientific', maximumFractionDigits: 6 });
    const divisor = value >= 1e6 ? 1e6 : 1;
    let digits = Math.min(20, Math.max(0, Math.ceil(-Math.log10(step / divisor))));
    // Teilintervalle können weitere Dezimalstellen brauchen, z. B. 2,8375 Mio.
    while (digits < 20) {
        const scaled = value / divisor * 10 ** digits;
        if (Math.abs(scaled - Math.round(scaled)) <= 16 * Number.EPSILON * Math.max(1, Math.abs(scaled))) break;
        digits++;
    }
    return (value / divisor).toLocaleString('de-DE', { maximumFractionDigits: digits }) + (divisor === 1e6 ? ' Mio.' : '');
}
const segments = (points, available) => {
    const result = []; let current = [];
    for (const point of points) {
        if (available(point)) current.push(point);
        else if (current.length) { result.push(current); current = []; }
    }
    if (current.length) result.push(current);
    return result;
};

/** Reine Auswahl von Originalindizes. Reguläre Buckets plus belegte Pflichtpunkte. */
export function selectHistoryDrawingIndices(points, { budget = 200, series = [p => p.total], eventDays = [], step = () => false } = {}) {
    budget = Number.isFinite(budget) ? Math.max(1, Math.floor(budget)) : 200;
    const mandatory = new Set(), valid = points.map(p => Number.isFinite(series[0](p)));
    const eventSet = new Set(eventDays);
    const keep = i => { if (i >= 0 && i < points.length && valid[i]) mandatory.add(i); };
    for (let i = 0; i < points.length; i++) {
        if (valid[i] && (!valid[i - 1] || !valid[i + 1])) keep(i);
        if (eventSet.has(points[i].day)) { keep(i - 1); keep(i); keep(i + 1); }
        if (i && (points[i].gap !== points[i - 1].gap || step(points[i - 1], points[i]))) { keep(i - 1); keep(i); }
    }
    for (const value of series) {
        let lo = -1, hi = -1;
        for (let i = 0; i < points.length; i++) if (valid[i] && Number.isFinite(value(points[i]))) {
            if (lo < 0 || value(points[i]) < value(points[lo])) lo = i;
            if (hi < 0 || value(points[i]) > value(points[hi])) hi = i;
        }
        keep(lo); keep(hi);
    }
    const chosen = new Set(mandatory);
    if (points.length <= budget) valid.forEach((known, i) => { if (known) chosen.add(i); });
    else {
        const count = Math.floor(budget / (2 * series.length));
        const start = points[0]?.day || 0, span = Math.max(1, (points.at(-1)?.day || 0) - start + 1);
        const buckets = Array.from({ length: count }, () => series.map(() => [-1, -1]));
        for (let i = 0; i < points.length && count; i++) if (valid[i]) {
            const bucket = buckets[Math.min(count - 1, Math.floor((points[i].day - start) / span * count))];
            series.forEach((value, column) => {
                const v = value(points[i]), pair = bucket[column];
                if (!Number.isFinite(v)) return;
                if (pair[0] < 0 || v < value(points[pair[0]])) pair[0] = i;
                if (pair[1] < 0 || v > value(points[pair[1]])) pair[1] = i;
            });
        }
        for (const bucket of buckets) for (const pair of bucket) for (const i of pair) if (i >= 0) chosen.add(i);
    }
    return { indices: [...chosen].sort((a, b) => a - b), mandatoryCount: mandatory.size, budget };
}

// Gemeinsame Grenzen der gestapelten Flächen; Cash- und Nullbestandsstufen erhalten.
function wealthDrawing(points, types, budget, eventDays = []) {
    const series = [p => p.total, ...types.map((_, i) => p => types.slice(0, i + 1).reduce((sum, type) => sum + p.allocation[type], 0))];
    const step = (a, b) => Object.keys(a.byProfile || {}).some(id => a.byProfile[id]?.allocation?.cash !== b.byProfile?.[id]?.allocation?.cash) || types.some(type => type === 'cash'
        ? a.allocation?.[type] !== b.allocation?.[type]
        : (a.allocation?.[type] === 0) !== (b.allocation?.[type] === 0));
    return selectHistoryDrawingIndices(points, { budget, series, eventDays, step });
}
const drawingRuns = (points, available, selection) => {
    const chosen = new Set(selection.indices.map(i => points[i]));
    return segments(points, available).map(run => run.filter(p => chosen.has(p))).filter(run => run.length);
};
const drawingAttributes = selection => `data-drawing-points="${selection.indices.length}" data-mandatory-points="${selection.mandatoryCount}" data-drawing-budget="${selection.budget}"`;

/** Nächster Originaltag über Tagesmitten; Gleichstand gehört dem früheren Tag. */
export function selectHistoryDayIndex(points, dayPosition) {
    if (!points.length || !Number.isFinite(dayPosition)) return -1;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (points[mid].day + .5 < dayPosition) lo = mid + 1;
        else hi = mid;
    }
    return lo && dayPosition - (points[lo - 1].day + .5) <= points[lo].day + .5 - dayPosition ? lo - 1 : lo;
}

const dayBindings = new WeakMap();
/** Nur flüchtiger hostlokaler Lesestand; niemals fachlich projizieren oder schreiben. */
export function bindHistoryDayInteraction(host) {
    if (dayBindings.has(host)) return dayBindings.get(host);
    const doc = host.ownerDocument;
    let history, svg, overlay, guide, status, selectedDay = null, keyboard = false, restoreFocus = false, stopped = false;
    const listeners = [];
    const listen = (type, callback) => {
        svg.addEventListener(type, callback);
        listeners.push([svg, type, callback]);
    };
    const clear = () => {
        selectedDay = null; keyboard = false;
        overlay?.remove(); guide?.remove(); overlay = guide = null;
        if (status) status.textContent = '';
    };
    const detach = () => {
        for (const [node, type, callback] of listeners) node.removeEventListener(type, callback);
        listeners.length = 0;
        overlay?.remove(); guide?.remove(); status?.remove();
        overlay = guide = status = svg = null;
    };
    const element = (name, attributes) => {
        const node = doc.createElementNS('http://www.w3.org/2000/svg', name);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
        return node;
    };
    const show = (index, announce = false) => {
        const point = history?.points[index];
        if (!point || !svg) return;
        if (point.day === selectedDay && overlay && !announce) return;
        selectedDay = point.day;
        const { width, height } = svg.viewBox.baseVal;
        const left = Number(svg.dataset.historyLeft), right = Number(svg.dataset.historyRight);
        const top = Number(svg.dataset.historyTop), bottom = Number(svg.dataset.historyBottom);
        const x = Math.max(left, Math.min(right, left + (point.day + .5 - history.range.start)
            / Math.max(1, history.range.end - history.range.start + 1) * (right - left)));
        const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
        const rows = [point.date ? String(point.date).split('-').reverse().join('.') : dateLabel(point.day),
            'Gesamtwert: ' + money(point.total),
            ...history.types.map(type => `${type === 'cash' ? 'Tagesgeld' : HISTORY_TYPE_LABELS[type] || type}: ${money(point.allocation?.[type])}`)];
        if (!Number.isFinite(point.total)) rows.push('Gesamtwert nicht vollständig bewertbar');
        else if (point.gap) rows.push('Ungeprüfter Werktag');
        const qualityLabels = { carried: 'Letzter bestätigter Schlusskurs fortgeführt', 'open-gap': 'Ungeprüfte Kursabdeckung',
            'missing-first-price': 'Erster Schlusskurs fehlt', 'unsupported-currency': 'Kurswährung nicht unterstützt',
            'missing-cash': 'Tagesgeld unbekannt', 'missing-ticker': 'Ticker fehlt', 'invalid-profile': 'Profildaten unvollständig',
            'invalid-shares': 'Stückzahl unbekannt', 'unknown-stock': 'Bestand nicht gesichert', 'unknown-stock-undated': 'Ursprünglicher Kaufbeginn nicht gesichert' };
        const quality = (point.quality || []).filter(value => value !== 'close').map(value => qualityLabels[value] || value);
        if (quality.length) rows.push(quality.join(' · '));
        if (!guide) {
            guide = element('line', { 'aria-hidden': 'true' });
            guide.setAttribute('class', 'history-day-guide');
            overlay = element('foreignObject', { 'aria-hidden': 'true' });
            overlay.setAttribute('class', 'history-day-field');
            svg.append(guide, overlay);
        }
        for (const [key, value] of Object.entries({ x1: n(x), x2: n(x), y1: top, y2: bottom })) guide.setAttribute(key, String(value));
        const fieldWidth = Math.max(1, Math.min(340, width - 16));
        const fieldHeight = Math.max(1, Math.min(height - 16, rows.length * 24 + 24));
        const fieldX = Math.max(8, Math.min(width - fieldWidth - 8, x + 12 + fieldWidth <= width - 8 ? x + 12 : x - fieldWidth - 12));
        for (const [key, value] of Object.entries({ x: n(fieldX), y: 8, width: fieldWidth, height: fieldHeight })) overlay.setAttribute(key, String(value));
        const field = doc.createElement('div');
        field.className = 'history-day-content';
        for (const row of rows) { const node = doc.createElement('div'); node.textContent = row; field.append(node); }
        overlay.replaceChildren(field);
        // Umgebrochene lange Beträge/Qualitätstexte brauchen mehr als eine Zeile.
        if (Number.isFinite(field.scrollHeight)) overlay.setAttribute('height', String(Math.min(height - 16, Math.max(fieldHeight, field.scrollHeight + 2))));
        if (announce) status.textContent = rows.join('. ');
    };
    const binding = {
        beforeReplace() { restoreFocus = !!svg && doc?.activeElement === svg; detach(); },
        update(value) {
            if (stopped) return;
            // Direkte Wiederbindung ist ebenfalls idempotent.
            if (svg) binding.beforeReplace();
            history = value;
            svg = history?.points?.length ? host.querySelector?.('svg.wealth-history-svg') : null;
            if (!svg || !doc?.createElementNS) { clear(); return; }
            status = doc.createElement('span');
            status.className = 'history-day-status';
            status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
            host.append(status);
            listen('pointermove', event => {
                keyboard = false;
                status.textContent = '';
                let x;
                const matrix = svg.getScreenCTM?.();
                if (matrix && svg.createSVGPoint) {
                    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
                    x = point.matrixTransform(matrix.inverse()).x;
                } else {
                    const box = svg.getBoundingClientRect();
                    x = (event.clientX - box.left) / box.width * svg.viewBox.baseVal.width;
                }
                const left = Number(svg.dataset.historyLeft), right = Number(svg.dataset.historyRight);
                x = Math.max(left, Math.min(right, x));
                show(selectHistoryDayIndex(history.points, history.range.start + (x - left) / (right - left)
                    * Math.max(1, history.range.end - history.range.start + 1)));
            });
            listen('pointerleave', () => { if (!keyboard) clear(); });
            listen('blur', clear);
            listen('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); clear(); return; }
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault(); keyboard = true;
                let index = history.points.findIndex(point => point.day === selectedDay);
                index = index < 0 ? history.points.length - 1 : Math.max(0, Math.min(history.points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
                show(index, true);
            });
            // Resize erhält denselben Originaltag; außerhalb des neuen Zeitraums schließen.
            const index = history.points.findIndex(point => point.day === selectedDay);
            if (index < 0) clear();
            if (restoreFocus) svg.focus({ preventScroll: true });
            restoreFocus = false;
            if (index >= 0) show(index, keyboard);
        },
        dispose() { if (stopped) return; stopped = true; detach(); history = null; selectedDay = null; dayBindings.delete(host); }
    };
    dayBindings.set(host, binding);
    return binding;
}

const chartBindings = new WeakMap();
/** Flüchtige Pixelgeometrie: nur zeichnen, niemals Projektion oder Speicherung anstoßen. */
export function bindHistoryChartSize(host, draw, { win = host.ownerDocument?.defaultView, region, prepareMeasure = () => {} } = {}) {
    if (chartBindings.has(host)) return chartBindings.get(host);
    let projection, size, pending, frame = null, stopped = false;
    const valid = value => Number.isFinite(value?.width) && value.width > 0 && Number.isFinite(value?.height) && value.height > 0;
    const measure = () => { prepareMeasure(); return { width: host.clientWidth, height: host.clientHeight }; };
    const paint = () => {
        if (stopped || (projection != null && !(valid(size) || host.clientWidth === undefined))) return;
        const interaction = dayBindings.get(host);
        interaction?.beforeReplace();
        draw(projection, size);
        interaction?.update(projection);
    };
    const request = callback => win?.requestAnimationFrame ? win.requestAnimationFrame(callback) : win?.setTimeout?.(callback, 0);
    const cancel = id => win?.requestAnimationFrame ? win.cancelAnimationFrame?.(id) : win?.clearTimeout?.(id);
    const flush = () => {
        frame = null;
        if (stopped) return;
        if (host.isConnected === false) { dispose(); return; }
        const next = pending; pending = null;
        if (!valid(next) || (next.width === size?.width && next.height === size?.height)) return;
        size = next; paint();
    };
    const schedule = next => {
        if (stopped) return;
        if (host.isConnected === false) { dispose(); return; }
        if (!valid(next)) {
            pending = null;
            if (frame !== null) cancel(frame);
            frame = null;
            return;
        }
        if (next.width === size?.width && next.height === size?.height) {
            pending = null;
            if (frame !== null) cancel(frame);
            frame = null;
            return;
        }
        pending = next;
        if (frame === null) frame = request(flush) ?? null;
    };
    const onResize = () => schedule(measure());
    const observer = win?.ResizeObserver ? new win.ResizeObserver(entries => {
        for (const entry of entries) if (entry.target === host || entry.target === region) schedule(region ? measure() : entry.contentRect);
    }) : null;
    // ResizeObserver allein meldet das Entfernen eines Hosts nicht zuverlässig.
    const removal = win?.MutationObserver ? new win.MutationObserver(() => {
        if (host.isConnected === false) dispose();
    }) : null;
    function dispose() {
        if (stopped) return;
        stopped = true;
        observer?.disconnect(); removal?.disconnect();
        win?.removeEventListener?.('resize', onResize);
        win?.removeEventListener?.('pagehide', dispose);
        if (frame !== null) cancel(frame);
        frame = pending = projection = null;
        dayBindings.get(host)?.dispose();
        chartBindings.delete(host);
    }
    const binding = {
        update(value) {
            if (stopped) return;
            if (host.isConnected === false) { dispose(); return; }
            projection = value;
            const measured = measure();
            size = valid(measured) ? measured : undefined;
            pending = null;
            if (frame !== null) cancel(frame);
            frame = null;
            paint();
        },
        dispose
    };
    chartBindings.set(host, binding);
    observer?.observe(host);
    if (region && region !== host) observer?.observe(region);
    if (!observer) win?.addEventListener?.('resize', onResize);
    removal?.observe(host.ownerDocument.documentElement, { childList: true, subtree: true });
    win?.addEventListener?.('pagehide', dispose);
    return binding;
}

function renderHistoryGridTick(value, left, right, yy, label) {
    return `<line class="history-grid" data-history-tick="${value}" x1="${left}" x2="${right}" y1="${yy}" y2="${yy}"/><text class="history-axis" x="${left - 16}" y="${yy + 5}" text-anchor="end">${escapeHtml(label)}</text>`;
}
function renderHistoryTotalArea(upper, lower) {
    return `<path class="history-total-area" d="M${upper}L${lower}Z"/>`;
}

/** Vollständige Skalenbasis; nur Zeichnungspunkte werden ausgewählt. */
export function renderWealthHistorySvg(history, { title = 'Vermögensverlauf', description = '', width = 1420, height = 460 } = {}) {
    width = Number.isFinite(width) && width > 0 ? width : 1420;
    height = Number.isFinite(height) && height > 0 ? height : 460;
    const id = `wealth-history-${++svgSequence}`;
    const left = Math.min(90, width * .3), right = Math.max(left + 1, width - Math.min(50, width * .1)), top = Math.min(60, height * .2), bottom = Math.max(top + 1, height - Math.min(60, height * .2));
    const points = history.points;
    const closures = history.closures || [];
    const { floor, ceiling, step } = wealthHistoryScale([...points, ...closures]);
    const span = Math.max(1, history.range.end - history.range.start + 1);
    const x = day => left + (day - history.range.start) / span * (right - left);
    const px = day => x(day + .5);
    const y = value => bottom - (value - floor) / (ceiling - floor) * (bottom - top);
    let grid = '';
    // Teiler bevorzugen; ohne mindestens drei Intervalle die volle Spanne vierteln.
    // So behalten auch Primzahlen beide Grenzen und ein gleichmäßiges Zwischenraster.
    const intervals = Math.max(1, Math.round((ceiling - floor) / step));
    let count = Math.min(8, intervals);
    while (count > 1 && intervals % count !== 0) count--;
    if (count < 3) count = 4;
    const gridStep = (ceiling - floor) / count;
    for (let tick = 0; tick <= count; tick++) {
        const value = tick === count ? ceiling : floor + (ceiling - floor) * (tick / count);
        const yy = n(y(value));
        grid += renderHistoryGridTick(value, left, right, yy, axisMoney(value, gridStep));
    }
    const cropHint = floor > 0 ? ` Achse beginnt bei ${axisMoney(floor, step)} €.` : '';
    const axisBreak = floor > 0 ? `<path class="history-axis-break" aria-hidden="true" d="M${left - 6},${bottom + 9}l4,-4l4,4l4,-4"/>` : '';
    let ticks = '', lastTick = -Infinity;
    for (const point of points) {
        if (point.date.slice(8) !== '01') continue;
        const xx = n(x(point.day)), january = point.date.slice(5, 7) === '01';
        if (january) ticks += `<line class="history-year-line" x1="${xx}" x2="${xx}" y1="${top}" y2="${bottom}"/>`;
        if (xx - lastTick < 100 || xx < left + 110 || xx > right - 100) continue;
        lastTick = xx;
        const label = january ? point.date.slice(0, 4) : new Date(point.day * 86400000).toLocaleDateString('de-DE', { month: 'short', timeZone: 'UTC' });
        ticks += `<text class="history-axis" x="${xx}" y="${bottom + 30}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }
    ticks += `<text class="history-axis" x="${left}" y="${bottom + 30}">${escapeHtml(dateLabel(history.range.start))}</text><text class="history-axis" x="${right}" y="${bottom + 30}" text-anchor="end">${escapeHtml(dateLabel(history.range.end))}</text>`;
    const selection = wealthDrawing(points, history.types, right - left, history.events.map(e => e.day));
    const runs = drawingRuns(points, point => Number.isFinite(point.total), selection);
    let areas = '', line = '';
    for (const run of runs) {
        const path = values => run.map((point, i) => `${n(px(point.day))},${n(y(values[i]))}`).join('L');
        if (floor > 0) {
            const upper = path(run.map(point => point.total));
            const lower = run.slice().reverse().map(point => `${n(px(point.day))},${n(bottom)}`).join('L');
            areas += renderHistoryTotalArea(upper, lower);
        }
        const bases = run.map(() => 0);
        for (const type of floor === 0 ? history.types : []) {
            const tops = run.map((point, index) => bases[index] + point.allocation[type]);
            // Wie die Gesamtlinie linear zwischen ausgewählten Tagesabschlüssen.
            // Pflichtpunkte erhalten beide Seiten von Cash- und Bestandswechseln.
            const path = (values, reverse = false) => {
                const rows = run.map((point, index) => [n(px(point.day)), n(y(values[index]))]);
                if (reverse) rows.reverse();
                return rows.map(([xx, yy]) => `${xx},${yy}`).join('L');
            };
            areas += `<path class="history-area history-${type}" d="M${path(tops)}L${path(bases, true)}Z"/>`;
            tops.forEach((value, index) => { bases[index] = value; });
        }
        // Eigener offener Pfad: erster Tagesendwert, niemals die Abschlusskante der Fläche.
        line += `<path class="history-total" vector-effect="non-scaling-stroke" d="M${run.map(point => `${n(px(point.day))},${n(y(point.total))}`).join('L')}"/>`;
        if (run.length === 1) line += `<circle class="history-total-point" cx="${n(px(run[0].day))}" cy="${n(y(run[0].total))}" r="3"/>`;
    }
    const gaps = history.gaps.map(([start, end]) => {
        const a = Math.max(left, x(start)), b = Math.min(right, x(end + 1));
        return `<rect class="history-gap" data-history-gap="${historyDate(start)}" x="${n(a)}" y="${top}" width="${n(Math.max(0, b - a))}" height="${bottom - top}" fill="url(#${id}-hatch)"><title>Ungeprüfte Werktage: ${escapeHtml(dateLabel(start))} bis ${escapeHtml(dateLabel(end))}</title></rect>`;
    }).join('');
    let marks = '', lastLabel = -Infinity, lane = 0;
    for (const event of history.events) {
        const point = points.find(point => point.day === event.day);
        if (!Number.isFinite(point?.total)) continue;
        const xx = n(px(event.day)), yy = n(y(point.total)), buy = event.kind === 'buy';
        const label = `${buy ? 'Kauf' : 'Verkauf'} ${event.name || event.symbol || ''} · ${event.shares.toLocaleString('de-DE')} Stück · ${dateLabel(event.day)}${event.source === 'spielwert' ? ' · Spielwert' : ''}`;
        marks += `<g class="history-event history-${buy ? 'buy' : 'sell'}"><title>${escapeHtml(label)}</title><circle cx="${xx}" cy="${yy}" r="4"/>`;
        if (xx - lastLabel > 180) {
            const anchor = xx > right - 150 ? 'end' : 'start';
            const labelY = 22 + (lane++ % 2) * 20;
            marks += `<line class="history-event-connector" x1="${xx}" x2="${xx}" y1="${labelY + 5}" y2="${yy - 6}"/><text x="${xx}" y="${labelY}" text-anchor="${anchor}">${buy ? '▲ Kauf' : '▼ Verkauf'} ${escapeHtml(shortMoney(event.amount))} €</text>`;
            lastLabel = xx;
        }
        marks += '</g>';
    }
    for (const row of closures) {
        const xx = n(px(row.day)), yy = n(y(row.total));
        const label = `${dateLabel(row.day)}: ${row.marker} ${row.label}, Summe ${formatDisplayNumber(row.total, { unit: 'currency', fractionDigits: 0 })}`;
        marks += `<g class="history-closure ${row.reason === 'annual_close' ? 'history-closure-annual' : 'history-closure-manual'}" data-closure-date="${escapeHtml(row.asOf)}" data-closure-total="${row.total}"><title>${escapeHtml(label)}</title><path d="M${xx},${yy - 7}l7,7l-7,7l-7,-7Z"/></g>`;
    }
    const end = points.at(-1);
    const endLabel = Number.isFinite(end?.total) ? `<text class="history-end-value" x="${right}" y="${Math.max(top + 18, n(y(end.total)) - 12)}" text-anchor="end">${escapeHtml(shortMoney(end.total))} €</text>` : '';
    return `<svg class="wealth-history-svg" tabindex="0" data-history-left="${left}" data-history-right="${right}" data-history-top="${top}" data-history-bottom="${bottom}" ${drawingAttributes(selection)} data-scale-floor="${floor}" data-scale-ceiling="${ceiling}" data-scale-step="${step}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${escapeHtml(title + cropHint)}</title><desc id="${id}-desc">${escapeHtml(description || (floor > 0 ? 'Gesamtfläche und Gesamtwert.' : 'Gestapelte Anlageformen und Gesamtwert.') + ' Schraffur kennzeichnet ungeprüfte Werktage. Pfeiltasten zeigen Originaltageswerte; Esc schließt die Tagesanzeige.')} Zeitraum ${escapeHtml(dateLabel(history.range.start))} bis ${escapeHtml(dateLabel(history.range.end))}.${escapeHtml(cropHint)}</desc><defs><pattern id="${id}-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path class="history-hatch" d="M-2,2L2,-2M0,8L8,0M6,10L10,6"/></pattern><clipPath id="${id}-clip"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/></clipPath></defs>${grid}${ticks}${axisBreak}<g clip-path="url(#${id}-clip)">${areas}${gaps}${line}</g>${marks}${endLabel}</svg>`;
}

export function renderHistorySparkline(points, { title = 'Vermögensverlauf', width = 220, height = 60, kind = 'total', eventDays = [] } = {}) {
    width = Number.isFinite(width) && width > 0 ? width : 220;
    height = Number.isFinite(height) && height > 0 ? height : 60;
    const id = `wealth-spark-${++svgSequence}`;
    let min = Infinity, max = -Infinity;
    for (const point of points) if (Number.isFinite(point.total)) { min = Math.min(min, point.total); max = Math.max(max, point.total); }
    const start = points[0]?.day || 0, span = Math.max(1, (points.at(-1)?.day || 0) - start);
    const selection = points.some(p => p.allocation) ? wealthDrawing(points, Object.keys(points.find(p => p.allocation).allocation), Math.min(200, width), eventDays)
        : selectHistoryDrawingIndices(points, { budget: Math.min(200, width), eventDays });
    const y = value => n(max === min ? height / 2 : height - 3 - (value - min) / (max - min || 1) * (height - 6));
    const path = drawingRuns(points, p => Number.isFinite(p.total), selection).map(run => {
        const xy = p => `${n((p.day - start) / span * width)},${y(p.total)}`;
        return `<path class="history-${kind === 'course' ? 'course' : 'total'}" vector-effect="non-scaling-stroke" d="M${run.map(xy).join('L')}"/>` +
            (run.length === 1 ? `<circle class="history-${kind === 'course' ? 'course' : 'total'}-point" cx="${n((run[0].day - start) / span * width)}" cy="${y(run[0].total)}" r="2"/>` : '');
    }).join('');
    return `<svg class="history-sparkline" ${drawingAttributes(selection)} viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-labelledby="${id} ${id}-desc"><title id="${id}">${escapeHtml(title)}</title><desc id="${id}-desc">Werte an den erfassten Tagen; unbekannte Abschnitte bleiben leer.</desc>${path}</svg>`;
}

/** Kursachsen aus der vollständigen Reihe; Kaufdatum ist eine Darstellungsoption. */
export function renderHistoryCourseSvg(course, { title = 'Kursverlauf', sales = [], purchaseDate = '', width = 1200, height = 290 } = {}) {
    width = Number.isFinite(width) && width > 0 ? width : 1200;
    height = Number.isFinite(height) && height > 0 ? height : 290;
    const id = `wealth-course-${++svgSequence}`;
    const left = Math.min(110, width * .3), right = Math.max(left + 1, width - Math.min(30, width * .1)), top = 55, bottom = Math.max(top + 1, height - 45);
    let courseMin = Infinity, courseMax = -Infinity;
    for (const p of course.points) if (Number.isFinite(p.value)) { courseMin = Math.min(courseMin, p.value); courseMax = Math.max(courseMax, p.value); }
    let min = Math.min(courseMin, Number.isFinite(course.purchasePrice) ? course.purchasePrice : Infinity);
    let max = Math.max(courseMax, Number.isFinite(course.purchasePrice) ? course.purchasePrice : -Infinity);
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min -= .5; max += .5; }
    const span = Math.max(1, course.range.end - course.range.start + 1);
    const x = day => n(left + (day - course.range.start) / span * (right - left));
    const px = day => x(day + .5);
    const y = value => n(bottom - (value - min) / (max - min) * (bottom - top));
    const selection = selectHistoryDrawingIndices(course.points, { budget: right - left, series: [p => p.value], eventDays: sales.map(s => s.day) });
    const paths = drawingRuns(course.points, p => Number.isFinite(p.value), selection).map(run => `<path class="history-course" vector-effect="non-scaling-stroke" d="M${run.map(p => `${px(p.day)},${y(p.value)}`).join('L')}"/>` +
        (run.length === 1 ? `<circle class="history-course-point" cx="${px(run[0].day)}" cy="${y(run[0].value)}" r="3"/>` : '')).join('');
    const price = value => value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const buy = Number.isFinite(course.purchasePrice) ? `<line class="history-purchase-line" vector-effect="non-scaling-stroke" x1="${left}" x2="${right}" y1="${y(course.purchasePrice)}" y2="${y(course.purchasePrice)}"/><text class="history-axis history-purchase-label" x="${left}" y="${Math.max(18, y(course.purchasePrice) - 8)}">Kaufpreis ${escapeHtml(price(course.purchasePrice))} €${purchaseDate ? ' (' + escapeHtml(purchaseDate.split('-').reverse().join('.')) + ')' : ''}</text>` : '';
    const pointsByDay = new Map(course.points.map(p => [p.day, p]));
    const marks = sales.filter(s => s.day >= course.range.start && s.day <= course.range.end).map((sale, i) => {
        const point = pointsByDay.get(sale.day);
        if (!Number.isFinite(point?.value)) return '';
        const xx = px(sale.day), anchor = xx > (left + right) / 2 ? 'end' : 'start';
        return `<g class="history-sell history-event"><title>Verkauf ${escapeHtml(String(sale.shares))} Stück · ${escapeHtml(dateLabel(sale.day))}${sale.source === 'spielwert' ? ' · Spielwert' : ''}</title><circle cx="${xx}" cy="${y(point.value)}" r="5"/><text x="${xx}" y="${30 + i % 2 * 18}" text-anchor="${anchor}">▼ ${escapeHtml(sale.shares.toLocaleString('de-DE'))} Stück</text></g>`;
    }).join('');
    const gaps = course.points.filter(p => p.gap).map(p => `<rect class="history-gap" x="${x(p.day)}" y="${top}" width="${n((right - left) / span)}" height="${bottom - top}" fill="url(#${id}-hatch)"/>`).join('');
    const axes = Number.isFinite(courseMin) ? `<text class="history-axis" x="${left - 12}" y="${y(courseMax) + 4}" text-anchor="end">${escapeHtml(price(courseMax))} €</text>${courseMin !== courseMax ? `<text class="history-axis" x="${left - 12}" y="${y(courseMin) + 4}" text-anchor="end">${escapeHtml(price(courseMin))} €</text>` : ''}` : '';
    return `<svg class="wealth-history-svg history-course-svg" ${drawingAttributes(selection)} viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${escapeHtml(title)}</title><desc id="${id}-desc">Schlusskurse, Kaufpreislinie und bestätigte Verkäufe.${Number.isFinite(courseMin) ? ' Höchster Kurs ' + escapeHtml(price(courseMax)) + ' €, niedrigster Kurs ' + escapeHtml(price(courseMin)) + ' €.' : ' Keine bekannten Kurse.'}</desc><defs><pattern id="${id}-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path class="history-hatch" d="M0,8L8,0"/></pattern></defs>${gaps}${axes}${buy}${paths}${marks}<text class="history-axis" x="${left}" y="${bottom + 30}">${escapeHtml(dateLabel(course.range.start))}</text><text class="history-axis" x="${right}" y="${bottom + 30}" text-anchor="end">${escapeHtml(dateLabel(course.range.end))}</text></svg>`;
}
