import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { buildWealthFanModel } from './wealth-fan-aggregation.js';
import { renderWealthFanBands } from './wealth-fan-chart.js';
import { formatCurrency } from './simulator-formatting.js';

export const WEALTH_SCENARIO_KEYS = ['worst', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'best'];
export const WEALTH_SCENARIO_COLORS = ['var(--bad)', 'color-mix(in srgb, var(--bad) 80%, var(--warn))', 'var(--warn)', 'var(--accent-line)', 'var(--text-main)', 'color-mix(in srgb, var(--good) 55%, var(--surface))', 'color-mix(in srgb, var(--good) 80%, var(--surface))', 'var(--good)', 'color-mix(in srgb, var(--good) 85%, var(--text-main))'];
// Ausschließlich Ticktexte; Pfade und Endwerte werden nicht gerundet.
export function formatScenarioWealthTick(value) {
    return value >= 1000000
        ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value / 1000000)} Mio.`
        : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
}
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Reine Projektion: keine neue Finanzmessung im Todesjahr, keine Ersatzinflation. */
export function buildScenarioWealthPath(scenario, { mode = 'real', initialWealth = null, yearEndRealBasis = false } = {}) {
    const points = [{ year: 0, value: finite(initialWealth) ? initialWealth : null }];
    let endpoint = 'horizon';
    let inflationComplete = true;
    for (const row of scenario?.logDataRows || []) {
        if (row.recordType === 'terminal_death') { endpoint = 'death'; break; }
        const year = row.jahr;
        if (!finite(year) || year < 1) continue;
        if (row.recordType === 'terminal_ruin') {
            points.push({ year, value: 0 }); endpoint = 'ruin'; break;
        }
        const nominal = row.portfolio_total_end;
        // Logfaktor gilt für Ausgaben am Jahresbeginn. Der Renderer verwendet
        // unabhängig vom Fächer den Jahresendfaktor wie die Real-Drawdownmessung.
        // Rohlogs und direkte Legacy-Helferaufrufe bleiben unverändert.
        if (yearEndRealBasis && !finite(row.inflation)) inflationComplete = false;
        const factor = yearEndRealBasis
            ? inflationComplete && finite(row.inflation_factor_cum)
                ? row.inflation_factor_cum * (1 + row.inflation / 100) : null
            : row.inflation_factor_cum;
        const value = mode === 'nominal' ? nominal
            : finite(factor) && factor > 0 && finite(nominal) ? nominal / factor : null;
        points.push({ year, value: finite(value) ? value : null });
    }
    return { points, endpoint, missingCount: points.filter(point => point.value === null).length };
}

export function scenarioEndWealth(scenario, mode = 'real', realByRun = null) {
    if (!finite(scenario?.endVermoegen)) return null;
    if (mode === 'nominal') return scenario.endVermoegen;
    const sourceIndex = scenario.sourceIdentity?.absoluteRunIndex;
    if (Array.isArray(realByRun) && Number.isSafeInteger(sourceIndex)) {
        return finite(realByRun[sourceIndex]) ? realByRun[sourceIndex] : null;
    }
    if (scenario.failed === true) return 0;
    const rows = scenario.logDataRows || [];
    const lastFinancial = rows.filter(row => !['terminal_death', 'terminal_ruin'].includes(row.recordType)).at(-1);
    const factor = lastFinancial?.inflation_factor_cum;
    const value = finite(factor) && factor > 0 ? scenario.endVermoegen / factor : null;
    return finite(value) ? value : null;
}

export function buildScenarioEntries(logs) {
    return [
        ...(logs?.characteristic || []).map(scenario => {
            const index = WEALTH_SCENARIO_KEYS.indexOf(scenario.key);
            const group = index >= 0 ? 'wealth' : ['longestLife', 'maxCut'].includes(scenario.key) ? 'risk' : 'care';
            return { id: `char_${scenario.key}`, scenario, group, color: index >= 0 ? WEALTH_SCENARIO_COLORS[index] : group === 'care' ? 'var(--accent)' : 'var(--text-muted)' };
        }),
        ...(logs?.random || []).map((scenario, index) => ({ id: `rand_${scenario.key}`, scenario, group: 'sample', sampleNumber: index + 1, color: 'var(--border-strong)' }))
    ];
}

// Nur verbundene Beobachtungen schneiden die Plotkante. Durch Skalierung vor
// der Subtraktion bleiben auch extreme endliche Finanzwerte numerisch stabil.
function firstExitYear(points, limit) {
    let previous = null;
    for (const point of points) {
        if (!finite(point.value)) { previous = null; continue; }
        if (point.value > limit) {
            if (previous && previous.value <= limit) {
                const scale = Math.max(Math.abs(previous.value), Math.abs(point.value), limit);
                const fraction = (limit / scale - previous.value / scale)
                    / (point.value / scale - previous.value / scale);
                return previous.year + fraction * (point.year - previous.year);
            }
            return point.year;
        }
        previous = point;
    }
    return null;
}

function renderScenarioOutliers(paths, { maximum, maxValue, x, width }) {
    const marks = paths.filter(path => maximum(path) > maxValue).map(path => {
        const value = maximum(path);
        // Auch numerische Extremproben bekommen einen lesbaren Kurztext; der
        // vollständige Betrag bleibt im Titel und zugänglichen Namen erhalten.
        const short = value < 1e15 ? formatScenarioWealthTick(value)
            : new Intl.NumberFormat('de-DE', { notation: 'scientific', maximumFractionDigits: 1 }).format(value);
        const text = `↑ ${short}`;
        return { path, value, text, desired: x(firstExitYear(path.points, maxValue)) };
    }).sort((a, b) => a.desired - b.desired || (a.path.id < b.path.id ? -1 : a.path.id > b.path.id ? 1 : 0));
    if (!marks.length) return '';
    // Kompakte Reihen im vorhandenen Rand, einschließlich der seitlichen
    // SVG-Ränder. Die konservative Breite umfasst auch den Innenabstand.
    const left = 8, right = width - 8, gap = 4;
    const fontSize = 14;
    // IBM Plex Sans hat bei 14 px eine Texthöhe von 18 px. Der Rahmen
    // lässt oben und unten Luft, ohne das Band bis zur Plotkante zu vergrößern.
    const height = 20;
    const place = () => {
        const rows = Array.from({ length: Math.floor((86 - 8 + 2) / (height + 2)) }, () => []);
        for (const mark of marks) {
            mark.width = mark.text.length * 8 * fontSize / 11 + 8;
            const desiredLeft = mark.desired - mark.width / 2;
            let best = null;
            for (let row = 0; row < rows.length; row++) {
                const occupied = rows[row].slice().sort((a, b) => a.left - b.left);
                let edge = left;
                for (const next of [...occupied, { left: right + gap }]) {
                    const end = next.left - gap - mark.width;
                    if (edge <= end) {
                        const position = Math.max(edge, Math.min(end, desiredLeft));
                        const distance = Math.abs(position - desiredLeft);
                        if (!best || distance < best.distance) best = { left: position, row, distance };
                    }
                    edge = next.left + (next.width || 0) + gap;
                }
                // Seitlich ausweichen, bevor eine weitere Reihe verwendet wird.
                if (best) break;
            }
            if (!best) continue;
            mark.left = best.left;
            mark.top = 8 + best.row * (height + 2);
            rows[best.row].push(mark);
        }
        return true;
    };
    // Bei Platzmangel nur die Beschriftung weglassen. Die Originalpfade und
    // ihre Auswahl in der Szenarioliste bleiben vollständig erhalten.
    place();
    const visibleMarks = marks.filter(mark => Number.isFinite(mark.left));
    const guides = visibleMarks.map(mark => {
        const center = mark.left + mark.width / 2;
        return Math.abs(center - mark.desired) > 4 || mark.top > 8
            ? `<path d="M${mark.desired} 88 L${center} ${mark.top + height}" fill="none" stroke="${mark.path.color}" stroke-opacity=".35" pointer-events="none"/>` : '';
    }).join('');
    return `<g class="scenario-outliers">${guides}${visibleMarks.map(mark => {
        const { path, value, text } = mark;
        const name = `${path.scenario.label} · ${formatCurrency(value)}`;
        return `<foreignObject x="${mark.left}" y="${mark.top}" width="${mark.width}" height="${height}"><button xmlns="http://www.w3.org/1999/xhtml" type="button" class="ds-scenario-outlier" style="color:${path.color};font-size:${fontSize}px;line-height:${height}px" data-scenario-id="${escape(path.id)}" title="${escape(name)}" aria-label="${escape(name)}">${escape(text)}</button></foreignObject>`;
    }).join('')}</g>`;
}

let clipSequence = 0;

export function renderScenarioWealthChart(entries, options = {}) {
    const fan = buildWealthFanModel(options.wealthFan, options.mode || 'real');
    const paths = entries.map(entry => ({ ...entry, ...buildScenarioWealthPath(entry.scenario, { ...options, yearEndRealBasis: true }) }));
    let maxYear = 1;
    const maximum = path => path.points.reduce((max, point) => finite(point.value) ? Math.max(max, point.value) : max, 0);
    const observed = path => path.points.slice(1).some(point => finite(point.value));
    for (const path of paths) for (const point of path.points) maxYear = Math.max(maxYear, point.year);
    if (fan.available) maxYear = Math.max(maxYear, fan.horizonYears);
    const p95 = paths.find(path => path.id === 'char_p95' && observed(path));
    const fallback = paths.filter(path => path.group === 'wealth' && path.id !== 'char_best' && observed(path));
    let basis = p95 ? maximum(p95) : fallback.reduce((max, path) => Math.max(max, maximum(path)), 0);
    if (!p95 && !fallback.length && fan.available) {
        for (const row of fan.years) if (finite(row.quantiles[95].value)) basis = Math.max(basis, row.quantiles[95].value);
    }
    const selected = paths.find(path => path.id === options.selectedId);
    const maxValue = Math.max(1, basis, finite(options.initialWealth) ? options.initialWealth : 0, selected ? maximum(selected) : 0);
    const width = finite(options.displayWidth) ? Math.max(300, options.displayWidth) : 1100;
    const right = width - 92, top = 88, bottom = 410;
    const x = year => 88 + (year / maxYear) * (right - 88);
    // Extremwerte bleiben in den Rohpunkten erhalten. Nur weit außerhalb des
    // Clips begrenzen wir die Zeichenkoordinate gegen numerischen Überlauf.
    const y = value => bottom - Math.max(-1e6, Math.min(1e6, value / maxValue)) * (bottom - top);
    const clipId = `scenarioWealthPlot-${++clipSequence}`;
    const marks = renderScenarioOutliers(paths, { maximum, maxValue, x, width });
    const order = [...paths.filter(path => path.id !== options.selectedId), ...paths.filter(path => path.id === options.selectedId)];
    const lines = order.map(path => {
        let connected = false;
        const d = path.points.map(point => {
            if (point.value === null) { connected = false; return ''; }
            const command = connected ? 'L' : 'M'; connected = true;
            return `${command}${x(point.year).toFixed(2)} ${y(point.value).toFixed(2)}`;
        }).join(' ');
        const active = path.id === options.selectedId;
        const end = path.points.at(-1);
        const endmark = (active || path.endpoint === 'ruin') && end?.value !== null ? `<circle cx="${x(end.year)}" cy="${y(end.value)}" r="${active ? 5 : 3}" fill="${path.endpoint === 'ruin' ? 'var(--bad)' : path.color}"/>${active ? `<text x="${x(end.year) - 8}" y="${y(end.value) - 12}" text-anchor="end">${path.endpoint === 'ruin' ? `Ruin ${Number.isInteger(options.startYear) ? options.startYear + end.year - 1 : `Jahr ${end.year}`}` : path.endpoint === 'death' ? 'Tod · letzte Messung' : 'Ende'}</text>` : ''}` : '';
        return `<g data-scenario-id="${escape(path.id)}" class="scenario-line ${active ? ' is-active' : ''}" opacity="${active ? 1 : .45}"><title>${escape(path.scenario.label)}${path.missingCount ? ' · fehlende Messung' : ''}</title><path d="${d}" fill="none" stroke="${path.color}" stroke-width="${active ? 3.5 : path.group === 'sample' ? 1 : 1.6}"${['care', 'risk'].includes(path.group) ? ' stroke-dasharray="6 4"' : ''}/><path d="${d}" fill="none" stroke="transparent" stroke-width="10" pointer-events="stroke"/>${endmark}</g>`;
    }).join('');
    const ticks = Array.from({ length: 5 }, (_, index) => {
        const value = maxValue * (index / 4);
        return `<line x1="88" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="wealth-grid"/><text x="78" y="${y(value) + 4}" text-anchor="end">${escape(formatScenarioWealthTick(value))}</text>`;
    }).join('');
    const years = Array.from({ length: 6 }, (_, index) => {
        const year = Math.round(maxYear * (index / 5));
        const label = Number.isInteger(options.startYear) ? `${options.startYear + year} · ${Number.isFinite(options.startAge) ? options.startAge + year : `Jahr ${year}`}` : `Jahr ${year}`;
        return `<text x="${x(year)}" y="445" text-anchor="middle">${escape(label)}</text>`;
    }).join('');
    return `<svg class="scenario-wealth-svg chart-native-svg" width="${width}" height="470" viewBox="0 0 ${width} 470" role="group" aria-labelledby="scenarioWealthTitle scenarioWealthDescription"><title id="scenarioWealthTitle">Vermögensverläufe der Szenario-Logs</title><desc id="scenarioWealthDescription">${options.mode === 'nominal' ? 'Nominale Euro' : 'Heutige Euro'}. Linien, Randmarken oder die gleichwertige Liste und Szenarioauswahl wählen. Die Basisachse folgt P95; eine Auswahl mit höherem Maximum erweitert sie. Lücken bedeuten fehlende Messungen; roter Endpunkt bedeutet Ruin; Tod erzeugt keinen weiteren Jahresendwert.${fan.available ? ' Blasser Hintergrund: Jahresbänder aller noch lebenden gültigen Haushalte im selben Maßstab.' : ''}</desc>${ticks}<defs><clipPath id="${clipId}"><rect x="88" y="${top}" width="${right - 88}" height="${bottom - top}"/></clipPath></defs><g clip-path="url(#${clipId})">${renderWealthFanBands(fan, { x, y, background: true })}${lines}</g>${years}${marks}</svg>`;
}
