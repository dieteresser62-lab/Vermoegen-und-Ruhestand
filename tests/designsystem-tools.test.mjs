import { readSources, validateTools, validateToolMarkup, validateFoundation, contrast, COLORS, TOOL_RENDERERS } from './designsystem-source-contract.mjs';

// Prüfungen
const sources = readSources();
assertEqual(JSON.stringify(validateTools(sources)), '[]', 'Benannte Werkzeugerzeuger sind vollständig tokenisiert');
for (const path of TOOL_RENDERERS) {
    for (const [label, addition, validator] of [
        ['Altpalette', '<p style="color: #123456;">Probe</p>', validateTools],
        ['Textdeckkraft', '<p style="opacity: .5;">Probe</p>', validateTools],
        ['Linienfarbe als Text', '<p style="color: var(--accent-line);">Probe</p>', validateTools],
        ['Alias', '<p style="color: var(--nicht-definiert);">Probe</p>', validateFoundation],
        ['Priorität', '<style>.probe { color: var(--text-main) !important; }</style>', validateFoundation]
    ]) {
        const mutated = { ...sources, [path]: sources[path] + '\n' + addition };
        assert(validator(mutated).length > 0, `${path}: scheiternde Gegenprobe ${label}`);
    }
}
assert(validateTools({ ...sources, 'simulator.css': sources['simulator.css'] + '\n.chart-svg .axis-label { fill: var(--chart-5); }' }).length > 0, 'Gegenprobe: Serientoken darf keine Grafiktextfarbe werden');
assert(validateToolMarkup('<svg><text fill="var(--text-main)" opacity=".8">Probe</text></svg>').length > 0, 'Gegenprobe: erzeugtes SVG-Textlabel ohne volle Deckkraft scheitert');
assert(validateToolMarkup('<div style="color: rgba(29,40,48,.5)">Probe</div>').length > 0, 'Gegenprobe: erzeugte transparente Textfarbe scheitert');
assert(validateToolMarkup('<rect class="sweep-label-bg" fill="var(--accent-line)" />').length > 0, 'Gegenprobe: Labelunterlage darf keine Palettenfarbe sein');
assert(validateTools({ ...sources, 'app/simulator/simulator-heatmap.js': sources['app/simulator/simulator-heatmap.js'].replace('.cell-label-text {', '.cell-label-text { opacity: .5;') }).length > 0, 'Gegenprobe: Deckkraft in erzeugtem HEATMAP_V4_STYLE scheitert');
assert(validateTools({ ...sources, 'app/shared/designsystem-chart-colors.js': sources['app/shared/designsystem-chart-colors.js'].replace("bgFill: 'var(--surface)'", "bgFill: 'var(--heatmap-mid)'") }).length > 0, 'Gegenprobe: opakes Labelpaar in der Farbhilfe ist verbindlich');
assert(contrast(COLORS['text-main'], COLORS['accent-line']) >= 4.5, 'Fortschrittstext ist auf Messinglinie und heller Restfläche lesbar');
assert(contrast(COLORS['text-muted'], COLORS['bad-soft']) >= 4.5, 'Hilfetext bleibt auf allen Werkzeugstatusflächen lesbar');
for (const bg of ['surface', 'surface-sunken', 'good-soft', 'warn-soft', 'bad-soft']) {
    for (const fg of ['text-main', 'text-muted']) assert(contrast(COLORS[fg], COLORS[bg]) >= 4.5, `Werkzeugtext ${fg}/${bg} mindestens 4,5:1`);
}
for (const status of ['good', 'warn', 'bad']) assert(contrast(COLORS.surface, COLORS[status]) >= 4.5, `Stabilitätslabel surface/${status} mindestens 4,5:1`);
for (const fg of ['good', 'bad']) for (const bg of ['good-soft', 'bad-soft']) assert(contrast(COLORS[fg], COLORS[bg]) >= 4.5, `Selbsttest-Einzelmeldung ${fg}/${bg} mindestens 4,5:1`);

for (const html of [
    '<rect class="cell-label-bg" fill="var(--surface)" />',
    '<text class="sweep-cell-text" fill="var(--chart-label-dark)" stroke="var(--surface)" paint-order="stroke">75,0 %</text>',
    '<text class="cell-label-text" fill="var(--chart-label-light)" opacity=".5">1 %</text>'
]) assert(validateToolMarkup(html).length > 0, 'P16b-Gegenprobe: Labelplatte, Halo oder Textdeckkraft werden abgewiesen');
