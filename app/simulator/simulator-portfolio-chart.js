"use strict";
import { backtestChartSeries, HISTORICAL_CRISES } from './simulator-crises.js';

function buildAreaPath(pointsTop, pointsBottom) {
    if (!pointsTop.length || !pointsBottom.length) return '';
    const start = `M ${pointsTop[0].x.toFixed(2)} ${pointsTop[0].y.toFixed(2)}`;
    const topLine = pointsTop.slice(1).map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const bottomLine = pointsBottom.slice().reverse().map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    return `${start} ${topLine} ${bottomLine} Z`;
}

const chartBindings = new WeakMap();

/** Beendet auch bereits zugestellte Rückrufe eines ersetzten Chartauftrags. */
export function disposeThreeBucketPortfolioChart(container) {
    chartBindings.get(container)?.();
    chartBindings.delete(container);
}

function measurePortfolioWidth(container, view) {
    const style = view?.getComputedStyle?.(container);
    const contentWidth = (container.clientWidth || 0)
        - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0);
    return Math.max(820, contentWidth);
}

export function renderThreeBucketPortfolioChart(container, rows, options = {}) {
    if (!container) return;
    disposeThreeBucketPortfolioChart(container);
    const doc = container.ownerDocument || globalThis.document;
    if (typeof doc?.createElementNS !== 'function') return;
    const view = doc.defaultView || globalThis.window;
    container.innerHTML = '';
    let width = measurePortfolioWidth(container, view);
    let svg = drawPortfolioChart(container, rows, options, width, doc);
    if (!svg) return;
    let active = true;
    let observer;
    const dispose = () => {
        active = false;
        if (typeof observer?.disconnect === 'function') observer.disconnect();
        else observer?.unobserve?.(container);
        view?.removeEventListener?.('resize', resize);
    };
    const resize = () => {
        if (!active) return;
        if (container.isConnected === false) { disposeThreeBucketPortfolioChart(container); return; }
        const nextWidth = measurePortfolioWidth(container, view);
        if (nextWidth === width) return;
        width = nextWidth;
        // Nur das SVG ersetzen: Legende und Hinweise gehören weiterhin dem ersten Render.
        const nextSvg = drawPortfolioChart(container, rows, options, width, doc, true);
        container.replaceChild(nextSvg, svg);
        svg = nextSvg;
    };
    chartBindings.set(container, dispose);
    if (typeof view?.ResizeObserver === 'function') {
        observer = new view.ResizeObserver(resize);
        observer.observe(container);
    }
    view?.addEventListener?.('resize', resize);
}

function drawPortfolioChart(container, rows, options, width, document, svgOnly = false) {
    const source = options.result ? backtestChartSeries(options.result)
        : backtestChartSeries({ rows: Array.isArray(rows) ? rows : [] });
    const series = source.filter(point => point.total !== null).map((point, index) => ({ ...point, index }));
    if (!series.length) return;
    const calendar = options.calendar || series.every(point => Number.isInteger(point.year));
    const maxTotal = Math.max(...series.map(s => s.total), 1);
    const unit = maxTotal >= 1000000 ? 1000000 : maxTotal >= 1000 ? 1000 : 1;
    const suffix = unit === 1000000 ? 'Mio. €' : unit === 1000 ? 'Tsd. €' : '€';
    const yLabels = Array.from({ length: 5 }, (_, i) =>
        `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(maxTotal * i / 4 / unit)} ${suffix}`);

    const height = 320;
    const margin = calendar ? { top: 64, right: 24, bottom: 38, left: Math.max(124, ...yLabels.map(label => label.length * 8 + 16)) }
        : { top: 16, right: 16, bottom: 24, left: 28 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xScale = (idx) => margin.left + ((series.length <= 1 ? 0 : idx / (series.length - 1)) * plotWidth);
    const yearScale = year => margin.left + (series.at(-1).year === series[0].year ? 0
        : (year - series[0].year) / (series.at(-1).year - series[0].year)) * plotWidth;
    const yScale = (value) => margin.top + plotHeight - ((value / maxTotal) * plotHeight);

    const etfTop = [];
    const etfBottom = [];
    const bondTop = [];
    const bondBottom = [];
    const goldTop = [];
    const goldBottom = [];
    const liqTop = [];
    const liqBottom = [];

    series.forEach((item) => {
        const x = calendar ? yearScale(item.year) : xScale(item.index);
        const etfYTop = yScale(item.etf);
        const bondYTop = yScale(item.etf + item.bond);
        const goldYTop = yScale(item.etf + item.bond + item.gold);
        const liqYTop = yScale(item.total);
        const zeroY = yScale(0);
        etfTop.push({ x, y: etfYTop });
        etfBottom.push({ x, y: zeroY });
        bondTop.push({ x, y: bondYTop });
        bondBottom.push({ x, y: etfYTop });
        goldTop.push({ x, y: goldYTop });
        goldBottom.push({ x, y: bondYTop });
        liqTop.push({ x, y: liqYTop });
        liqBottom.push({ x, y: goldYTop });
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ds-portfolio-svg chart-native-svg');
    if (calendar) svg.setAttribute('class', 'ds-portfolio-svg ds-portfolio-calendar chart-native-svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', calendar ? 'Jahresendvermögen ohne Pflegereserve nach Kalenderjahren' : 'Jahresendvermögen ohne Pflegereserve');
    svg.setAttribute('style', 'display:block;background:var(--surface);border:1px solid var(--border);border-radius:8px;');
    const addPath = (d, fill) => {
        if (!d) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', fill);
        svg.appendChild(path);
    };
    const text = (x, y, label, anchor = 'middle') => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        node.setAttribute('x', String(x)); node.setAttribute('y', String(y));
        node.setAttribute('text-anchor', anchor); node.setAttribute('fill', 'var(--text-main)');
        node.setAttribute('font-size', 'var(--balance-help)'); node.textContent = label; svg.appendChild(node);
    };
    addPath(buildAreaPath(etfTop, etfBottom), 'var(--chart-1)');
    addPath(buildAreaPath(bondTop, bondBottom), 'var(--chart-4)');
    addPath(buildAreaPath(goldTop, goldBottom), 'var(--chart-2)');
    addPath(buildAreaPath(liqTop, liqBottom), 'var(--chart-3)');
    if (calendar) {
        const labelEnds = [-Infinity, -Infinity];
        for (const crisis of HISTORICAL_CRISES) {
            const from = Math.max(series[0].year, crisis.start);
            const to = Math.min(series.at(-1).year, crisis.end);
            if (from > to) continue;
            const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            band.setAttribute('x', String(yearScale(from)));
            band.setAttribute('y', String(margin.top));
            band.setAttribute('width', String(Math.max(2, yearScale(Math.min(to + 1, series.at(-1).year)) - yearScale(from))));
            band.setAttribute('height', String(plotHeight)); band.setAttribute('fill', 'var(--bad)');
            band.setAttribute('opacity', '0.14');
            svg.appendChild(band);
            const labelWidth = crisis.label.length * 8;
            const center = Math.max(margin.left + labelWidth / 2,
                Math.min(width - margin.right - labelWidth / 2, (yearScale(from) + yearScale(to)) / 2));
            const lane = center - labelWidth / 2 > labelEnds[0] + 12 ? 0 : 1;
            labelEnds[lane] = center + labelWidth / 2;
            text(center, 22 + lane * 22, crisis.label);
        }
    }
    if (calendar) {
        for (let i = 0; i <= 4; i++) text(margin.left - 8, yScale(maxTotal * i / 4) + 5,
            yLabels[i], 'end');
        const years = series.filter((point, i) => i === 0 || i === series.length - 1 || point.year % 5 === 0);
        years.forEach(point => text(yearScale(point.year), height - 12, point.year));
    }

    if (svgOnly) return svg;

    const hint = document.createElement('p');
    hint.className = 'ds-scroll-hint';
    hint.textContent = 'Jahresende, nominal, ohne Pflegereserve · rot: historische Krisen. Bei Bedarf horizontal scrollen.';
    container.appendChild(svg);

    const legend = document.createElement('div');
    legend.style.color = 'var(--text-main)';
    legend.style.display = 'flex';
    legend.style.alignItems = 'center';
    legend.style.justifyContent = 'center';
    legend.style.flexWrap = 'wrap';
    legend.style.gap = '20px';
    legend.style.marginTop = '10px';
    const createLegendItem = (label, color) => {
        const item = document.createElement('div');
        item.style.display = 'inline-flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        const box = document.createElement('span');
        box.style.display = 'inline-block';
        box.style.width = '12px';
        box.style.height = '12px';
        box.style.background = color;
        const text = document.createElement('span');
        text.textContent = label;
        item.appendChild(box);
        item.appendChild(text);
        return item;
    };
    legend.appendChild(createLegendItem('ETF', 'var(--chart-1)'));
    legend.appendChild(createLegendItem('Bonds/Puffer', 'var(--chart-4)'));
    legend.appendChild(createLegendItem('Gold', 'var(--chart-2)'));
    legend.appendChild(createLegendItem('Liquidität', 'var(--chart-3)'));
    container.appendChild(legend);
    container.appendChild(hint);
    return svg;
}
