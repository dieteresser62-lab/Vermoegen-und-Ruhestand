/** Diagrammfarben: einzige Farbquelle bleibt css/tokens.css. */
export function readChartTokens(doc = globalThis.document) {
    const view = doc?.defaultView;
    if (!view?.getComputedStyle || !doc.documentElement) return {};
    const style = view.getComputedStyle(doc.documentElement);
    return Object.fromEntries(['heatmap-low', 'heatmap-mid', 'heatmap-high', 'chart-label-dark', 'chart-label-light', 'bad', 'surface-sunken'].map(name =>
        [`--${name}`, style.getPropertyValue(`--${name}`).trim()]));
}

export function parseChartColor(value) {
    if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1).match(/../g).map(v => parseInt(v, 16));
    const rgb = value?.match(/^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/);
    return rgb ? rgb.slice(1).map(Number) : null;
}

/** Hell → Messing → Schiefer, sRGB-Interpolation mit zwei gleich langen Segmenten.
 * Ohne Dokument liefert die Funktion dieselbe Palette als CSS-Ausdruck; kein
 * Headless-Fallback pflegt eine zweite Hex-Tabelle. Eine aufgelöste Tokenmap ist
 * für DOM-freie Gegenproben injizierbar.
 */
export function heatmapColor(value, tokens = readChartTokens()) {
    const t = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const names = t <= .5 ? ['--heatmap-low', '--heatmap-mid'] : ['--heatmap-mid', '--heatmap-high'];
    const fraction = t <= .5 ? t * 2 : (t - .5) * 2;
    const a = parseChartColor(tokens[names[0]]), b = parseChartColor(tokens[names[1]]);
    if (a && b) return `rgb(${a.map((v, i) => Math.round(v + fraction * (b[i] - v))).join(', ')})`;
    if (fraction === 0) return `var(${names[0]})`;
    if (fraction === 1) return `var(${names[1]})`;
    return `color-mix(in srgb, var(${names[0]}) ${(1 - fraction) * 100}%, var(${names[1]}))`;
}

/** WCAG-Kontrast in sRGB, auch für alpha-komponierte (nicht gerundete) Farben. */
export function chartContrast(a, b) {
    const luminance = color => color.map(v => v / 255)
        .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

export function visibleHeatmapColor(t, tokens, critical = false, missing = false) {
    const background = parseChartColor(missing ? tokens['--surface-sunken'] : heatmapColor(t, tokens));
    const overlay = parseChartColor(tokens['--bad']);
    if (!background || (critical && !overlay)) return null;
    return critical ? background.map((v, i) => v * .88 + overlay[i] * .12) : background;
}

/** Opake Textrolle gegen die tatsächlich sichtbare Zelle, ohne Labelplatte. */
export function heatmapLabelColor(t, tokens = readChartTokens(), critical = false, missing = false) {
    const background = visibleHeatmapColor(t, tokens, critical, missing);
    const dark = parseChartColor(tokens['--chart-label-dark']);
    const light = parseChartColor(tokens['--chart-label-light']);
    if (background && dark && light) {
        return chartContrast(dark, background) >= chartContrast(light, background)
            ? 'var(--chart-label-dark)' : 'var(--chart-label-light)';
    }
    // DOM-freies Markup: aus 1001 kanonischen Palettenpunkten geprüfte
    // Umschaltgrenzen, keine zweite Farbtabelle. Browser lösen Tokens oben auf.
    return !missing && t > (critical ? .635 : .656)
        ? 'var(--chart-label-light)' : 'var(--chart-label-dark)';
}

// Kompatibler Export für Verbraucher außerhalb der Heatmaps.
export const CHART_LABEL = Object.freeze({
    textFill: 'var(--text-main)', bgFill: 'var(--surface)', dotFill: 'var(--text-main)'
});
