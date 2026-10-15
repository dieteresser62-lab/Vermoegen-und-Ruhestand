"use strict";
import { backtestChartSeries, HISTORICAL_CRISES } from './simulator-crises.js';
import { buildBacktestChartAnnotations, layoutBacktestChartLabels } from './backtest-chart-annotations.js';
import { jumpToBacktestYear } from './backtest-log-analysis.js';
import { backtestEuroBasis, projectBacktestChartSeries } from './backtest-euro-display.js';

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
    options = { ...options, annotations: options.analysisData ? buildBacktestChartAnnotations(options.analysisData, { moneyBasis: options.moneyBasis ?? 'nominal' }) : null };
    container.innerHTML = '';
    let width = measurePortfolioWidth(container, view);
    let svg = drawPortfolioChart(container, rows, options, width, doc);
    if (!svg) {
        container.textContent = 'Für diesen Verlauf fehlen belegte Vermögens- oder Inflationswerte.';
        return;
    }
    let active = true;
    let observer;
    const jumpState = {};
    const jump = event => {
        const link = event.target.closest?.('.backtest-chart-marker');
        if (link && container.contains(link) && jumpToBacktestYear(doc, Number(link.getAttribute('data-backtest-chart-year')), jumpState)) event.preventDefault();
    };
    const dispose = () => {
        active = false;
        if (typeof observer?.disconnect === 'function') observer.disconnect();
        else observer?.unobserve?.(container);
        view?.removeEventListener?.('resize', resize);
        options.annotationToggle?.removeEventListener('change', redraw);
        container.removeEventListener?.('click', jump);
        clearTimeout(jumpState.timer);
        jumpState.row?.classList.remove('backtest-analysis-highlight');
    };
    const redraw = () => {
        if (!active) return;
        if (container.isConnected === false) { disposeThreeBucketPortfolioChart(container); return; }
        width = measurePortfolioWidth(container, view);
        // Nur das SVG ersetzen: Legende und Hinweise gehören weiterhin dem ersten Render.
        const nextSvg = drawPortfolioChart(container, rows, options, width, doc, true);
        container.replaceChild(nextSvg, svg);
        svg = nextSvg;
    };
    const resize = () => {
        if (container.isConnected === false || measurePortfolioWidth(container, view) !== width) redraw();
    };
    chartBindings.set(container, dispose);
    if (options.annotations) {
        options.annotationToggle?.addEventListener('change', redraw);
        container.addEventListener?.('click', jump);
    }
    if (typeof view?.ResizeObserver === 'function') {
        observer = new view.ResizeObserver(resize);
        observer.observe(container);
    }
    view?.addEventListener?.('resize', resize);
}

function drawPortfolioChart(container, rows, options, width, document, svgOnly = false) {
    const source = options.result ? projectBacktestChartSeries(options.result, options.moneyBasis)
        : backtestChartSeries({ rows: Array.isArray(rows) ? rows : [] });
    const series = source.filter(point => point.total !== null).map((point, index) => ({ ...point, index }));
    if (!series.length) return;
    const calendar = options.calendar || series.every(point => Number.isInteger(point.year));
    const maxTotal = Math.max(...series.map(s => s.total), 1);
    const unit = maxTotal >= 1000000 ? 1000000 : maxTotal >= 1000 ? 1000 : 1;
    const suffix = unit === 1000000 ? 'Mio. €' : unit === 1000 ? 'Tsd. €' : '€';
    const yLabels = Array.from({ length: 5 }, (_, i) =>
        `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: unit === 1 ? 0 : 1 }).format(maxTotal * i / 4 / unit)} ${suffix}`);
    const basis = backtestEuroBasis(options.result, options.moneyBasis);

    const height = 320;
    const margin = calendar ? { top: 64, right: 24, bottom: 38, left: Math.max(124, ...yLabels.map(label => label.length * 8 + 16)) }
        : { top: 16, right: 16, bottom: 24, left: 28 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xScale = (idx) => margin.left + ((series.length <= 1 ? 0 : idx / (series.length - 1)) * plotWidth);
    const yearScale = year => margin.left + (series.at(-1).year === series[0].year ? 0
        : (year - series[0].year) / (series.at(-1).year - series[0].year)) * plotWidth;
    const yScale = (value) => margin.top + plotHeight - ((value / maxTotal) * plotHeight);
    const annotations = calendar && options.annotationToggle?.checked !== false ? options.annotations : null;
    const visibleYears = new Set(series.map(point => point.year));
    const markers = layoutBacktestChartLabels((annotations?.markers ?? []).filter(marker => visibleYears.has(marker.year)),
        marker => yearScale(marker.year), margin.left, width - margin.right);
    const bands = layoutBacktestChartLabels((annotations?.bands ?? []).filter(band => band.endYear >= series[0].year
        && band.startYear <= series.at(-1).year), band => yearScale((Math.max(band.startYear, series[0].year)
            + Math.min(band.endYear, series.at(-1).year)) / 2), margin.left, width - margin.right);
    const svgHeight = height + (bands.length ? 42 + Math.max(...bands.map(band => band.lane)) * 24 : 0);

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
    svg.setAttribute('viewBox', `0 0 ${width} ${svgHeight}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(svgHeight));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${calendar ? 'Jahresendvermögen ohne Pflegereserve nach Kalenderjahren' : 'Jahresendvermögen ohne Pflegereserve'} · ${basis}`);
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

    const element = (parent, tag, attributes, content) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
        if (content !== undefined) node.textContent = content;
        parent.appendChild(node);
        return node;
    };
    for (const marker of markers) {
        const x = yearScale(marker.year), y = margin.top + 8 + marker.lane * 30;
        const link = element(svg, 'a', { href: `#backtest-year-${marker.year}`,
            'data-backtest-chart-year': marker.year, 'aria-label': `${marker.label} im Protokoll` });
        link.setAttribute('class', 'backtest-chart-marker');
        element(link, 'title', {}, `${marker.text} ${marker.type === 'minimum_real_year_end_wealth'
            ? `Reales Gesamttief einschließlich Pflegevorsorge; die Fläche zeigt Vermögen in ${basis === 'nominal' ? 'nominalen Euro' : basis} ohne Pflegereserve. ` : ''}Zum Jahr im Protokoll springen.`);
        element(link, 'line', { x1: x, x2: x, y1: y + 24, y2: height - margin.bottom,
            stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' });
        element(link, 'circle', { cx: x, cy: yScale(series.find(point => point.year === marker.year).total), r: 5,
            fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 2 });
        element(link, 'rect', { x: marker.center - marker.labelWidth / 2, y, width: marker.labelWidth, height: 24, rx: 12,
            fill: 'var(--accent)' });
        element(link, 'text', { x: marker.center, y: y + 17, 'text-anchor': 'middle',
            fill: 'var(--surface)', 'font-size': 'var(--balance-help)' }, marker.label);
    }
    for (const band of bands) {
        const from = Math.max(margin.left, yearScale(band.startYear - 0.5));
        const to = series.length === 1 ? width - margin.right : Math.min(width - margin.right, yearScale(band.endYear + 0.5));
        const group = element(svg, 'g', {});
        group.setAttribute('class', 'backtest-chart-cut-band');
        element(group, 'title', {}, band.text);
        element(group, 'rect', { x: from, y: height + 8, width: Math.max(2, to - from), height: 8, rx: 3,
            fill: 'var(--accent-soft)', stroke: 'var(--accent-line)' });
        const labelY = height + 36 + band.lane * 24;
        element(group, 'line', { x1: (from + to) / 2, y1: height + 16, x2: band.center, y2: labelY - 14,
            stroke: 'var(--accent-line)' });
        element(group, 'text', { x: band.center, y: labelY, 'text-anchor': 'middle',
            fill: 'var(--accent)', 'font-size': 'var(--balance-help)' }, band.label);
    }

    if (svgOnly) return svg;

    const hint = document.createElement('p');
    hint.className = 'ds-scroll-hint';
    hint.textContent = `Jahresende, ${basis}, ohne Pflegereserve · rot: historische Krisen. Bei Bedarf horizontal scrollen.`;
    if (options.annotations) hint.textContent = `Jahresende, ${basis}, ohne Pflegereserve · rot: historische Krisen · Messing: Flex-Entnahme ab 10 % gekürzt. `
        + 'Marken: Ereignisjahre, Klick öffnet das Protokoll. Reales Tief: Kaufkraft zum Laufstart einschließlich Pflegevorsorge. '
        + (options.annotations.missingCutYears ? 'Kürzungswerte fehlen in einzelnen Jahren; Bänder zeigen nur belegte Phasen. ' : '')
        + 'Bei Bedarf horizontal scrollen.';
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
