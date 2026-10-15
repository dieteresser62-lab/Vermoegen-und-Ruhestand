import { adaptScenarioLog, finite } from './log-analysis-adapters.js';
import { hasTechnicalFinancialError, projectMinimumFlexDisplay } from './results-metrics.js';
import { detectDynamicFlexPreset, DYNAMIC_FLEX_OPTIONS } from '../shared/dynamic-flex-presets.js';
import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { formatWholeEuro as formatCurrency } from './results-formatting.js';
import { DEFAULT_EURO_MODE, euroBasisLabel } from './euro-display.js';
import { scenarioEndWealth, scenarioDisplayLabel } from './scenario-wealth-chart.js';
import { formatChartEuro, formatPercentage } from './results-formatting.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';

export const COMPARISON_DEFAULT = Object.freeze(['char_p10', 'char_p50', 'char_p90']);
export const COMPARISON_EXTREMES = Object.freeze(['char_worst', 'char_p50', 'char_best']);
const labels = { worst: 'Minimum', p5: 'P5', p10: 'P10', p25: 'P25', p50: 'Median',
    p75: 'P75', p90: 'P90', p95: 'P95', best: 'Maximum', longestLife: 'Längstes Leben', maxCut: 'Stärkste Kürzung' };
const count = value => Number.isSafeInteger(value) && value >= 0;
export const comparisonLabel = entry => labels[entry?.scenario.key] || scenarioDisplayLabel(entry?.scenario);
export const comparisonEntries = entries => entries.filter(entry => entry.id.startsWith('char_'));

/** Nur protokollierte Entnahmejahre. Terminalzeilen liefern keine Jahresrendite. */
export function scenarioComparisonMetrics(scenario) {
    const adapted = adaptScenarioLog(scenario);
    const terminal = adapted.rows.findIndex(item => ['terminal_death', 'terminal_ruin', 'technical_error'].includes(item.recordType));
    const rows = (terminal < 0 ? adapted.rows : adapted.rows.slice(0, terminal)).filter(item => item.financial);
    const first = rows.slice(0, 5);
    // Das Feld trägt historisch „Pct“ im Namen, enthält aber eine Rendite-Ratio.
    const complete = first.length === 5 && first.every((item, index) => item.year === index + 1
        && finite(item.row.NominalReturnEquityPct) && item.row.NominalReturnEquityPct >= -1);
    const cumulative = complete ? (first.reduce((product, item) => product * (1 + item.row.NominalReturnEquityPct), 1) - 1) * 100 : null;
    const source = scenario?.sourceIdentity;
    const runNumber = count(source?.absoluteRunIndex) ? source.absoluteRunIndex + 1 : null;
    return { runNumber, endNominal: adapted.terminalWealthNominalEur,
        withdrawalYears: adapted.available && adapted.rows.length ? rows.length : null,
        firstFiveReturnPct: finite(cumulative) ? cumulative : null };
}

/** Gesamtanteile ausschließlich aus dem Laufaggregat, niemals aus den ausgewählten Logs. */
export function buildComparisonContext({ results, totalRuns, failCount, inputs } = {}) {
    const inventory = results?.outcomeInventory;
    const current = inventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1';
    const total = current ? inventory.requestedRuns : totalRuns;
    const ruined = current ? inventory.ruin : failCount;
    const technical = hasTechnicalFinancialError(results);
    const coverageKnown = !technical && count(total) && total > 0 && count(ruined) && ruined <= total
        && (!current || inventory.floorCoverageMissingnessReason === null && inventory.floorCoveredCount === total - ruined);
    const floor = !coverageKnown ? { text: 'Grundbedarf: unbekannt', tone: '' }
        : ruined === 0 ? { text: `Grundbedarf in allen ${total} Pfaden gedeckt`, tone: 'success' }
            : { text: `Ruin in ${ruined} von ${total} Pfaden (${formatPercentage(ruined / total * 100)})`, tone: 'error' };
    const block = results?.minimumFlexRestriction;
    const minimum = projectMinimumFlexDisplay(results);
    const minimumKnown = !technical && (minimum.valid || block?.startMinimumFlexAnnual === 0
        && block.definitionVersion === 'MinimumFlexRestrictionV1' && block.missingReason === null)
        && count(block?.sampleSize) && block.sampleSize > 0 && count(block.affectedRunCount)
        && block.affectedRunCount <= block.sampleSize && block.requestedRuns === total
        && block.sampleSize <= total;
    const excluded = minimumKnown ? total - block.sampleSize : 0;
    const restriction = minimumKnown ? { text: `${block.affectedRunCount} von ${block.sampleSize}${excluded ? ' auswertbaren' : ''} Pfaden zeitweise unter Mindest-Flex${excluded ? ` · ${excluded} unbekannt` : ''}`,
        tone: block.affectedRunCount ? 'warning' : '' } : { text: 'Pfade unter Mindest-Flex: unbekannt', tone: '' };
    const care = { text: inputs?.pflegefallLogikAktivieren === true ? 'Pflege simuliert'
        : inputs?.pflegefallLogikAktivieren === false ? 'Pflege nicht simuliert' : 'Pflege simuliert: unbekannt', tone: '' };
    const preset = typeof inputs?.dynamicFlex === 'boolean' ? detectDynamicFlexPreset(inputs) : null;
    const presetLabel = preset === 'off' ? 'Dynamik aus' : DYNAMIC_FLEX_OPTIONS.find(([key]) => key === preset)?.[1] || 'Voreinstellung unbekannt';
    return { sourceLine: `${count(total) ? `${total} Pfade` : 'Pfadzahl unbekannt'} · ${presetLabel}`, chips: [floor, restriction, care] };
}

function renderComparisonInspectLink({ entry }) {
    if (!entry) return 'unbekannt';
    return `<a href="#scenarioLogAnalysis" data-comparison-inspect="${escape(entry.id)}">Was hier auffällt →</a>`;
}

export function renderScenarioComparison(entries, selection, { context = buildComparisonContext(), selectedId = '', moneyBasis = DEFAULT_EURO_MODE, realByRun } = {}) {
    const available = comparisonEntries(entries);
    const columns = selection.map(id => {
        const entry = available.find(item => item.id === id);
        return { entry, metrics: { ...scenarioComparisonMetrics(entry?.scenario), endWealth: scenarioEndWealth(entry?.scenario, moneyBasis, realByRun) } };
    });
    const header = columns.map(({ entry, metrics }, index) => {
        const duplicates = columns.flatMap((other, position) => position !== index && metrics.runNumber !== null
            && other.metrics.runNumber === metrics.runNumber ? [position + 1] : []);
        return `<th scope="col"><label for="scenarioCompare${index + 1}">Auswahl ${index + 1}</label><select id="scenarioCompare${index + 1}" class="ds-select" data-comparison-column="${index}">${!entry ? '<option value="">Pfad nicht vorhanden</option>' : ''}${available.map(item => `<option value="${escape(item.id)}"${entry?.id === item.id ? ' selected' : ''}>${escape(comparisonLabel(item))}</option>`).join('')}</select>${duplicates.length ? `<small class="scenario-comparison-duplicate">Gleicher Quellpfad wie Spalte ${duplicates.join(' und ')}</small>` : ''}</th>`;
    }).join('');
    const row = (label, render) => `<tr><th scope="row">${label}</th>${columns.map(column => `<td>${render(column)}</td>`).join('')}</tr>`;
    const value = (number, formatter) => number === null ? 'unbekannt' : formatter(number);
    const sameSelection = preset => preset.every((id, index) => id === selection[index]);
    return `<div class="scenario-comparison-heading"><div><h2 id="scenarioComparisonHeading">Pfade vergleichen</h2><div class="scenario-comparison-source"><span>${escape(context.sourceLine)}</span>${infoPopoverHtml('Wie die Pfade ausgewählt werden', 'Die Läufe werden nach dem Endvermögen auf dem Konto ausgewählt. Beim Umschalten bleiben es dieselben Läufe. Pflege- und Risikofälle folgen ihrem jeweiligen Merkmal. Mehrere Auswahlen können denselben Quellpfad zeigen. Die Gesamtanteile stammen aus der Aggregation aller auswertbaren Pfade. Aktienrendite: die fünf protokollierten Jahresrenditen als Produkt, ohne Entnahmen; bei fehlenden Jahren unbekannt. Jahre mit Entnahme zählen abgeschlossene Entnahmejahre, ohne Todes-, Ruin- oder Fehlerzeilen. Die Auswahl bleibt in dieser Sitzung erhalten.')}</div></div><div class="ds-segment" role="group" aria-label="Schnellwahl für drei Pfade"><button type="button" class="ds-button" data-comparison-preset="default" aria-pressed="${sameSelection(COMPARISON_DEFAULT)}">P10 · Median · P90</button><button type="button" class="ds-button" data-comparison-preset="extremes" aria-pressed="${sameSelection(COMPARISON_EXTREMES)}">Schwächster · Median · Stärkster</button></div></div>
        <div class="ds-chips scenario-comparison-chips">${context.chips.map(chip => `<span class="ds-badge${chip.tone ? ` ds-chip-${chip.tone}` : ''}">${escape(chip.text)}</span>`).join('')}</div>
        <div class="ds-table-box"><table class="ds-table scenario-comparison-table"><thead><tr><th scope="col">Vergleich</th>${header}</tr></thead><tbody>
        ${row('Pfadnummer', ({ entry, metrics }) => entry ? `<button type="button" class="ds-button ds-button-secondary" data-scenario-id="${escape(entry.id)}" aria-pressed="${selectedId === entry.id}">${metrics.runNumber === null ? 'Pfadnummer unbekannt' : `Pfad ${metrics.runNumber}`}</button>` : 'unbekannt')}
        ${row(`Endvermögen · ${euroBasisLabel(moneyBasis)}`, ({ metrics }) => `<span class="scenario-comparison-value"${metrics.endWealth === null ? '' : ` title="${escape(formatCurrency(metrics.endWealth))}"`}>${escape(value(metrics.endWealth, formatChartEuro))}</span>`)}
        ${row('Aktienrendite der ersten 5 Jahre', ({ metrics }) => escape(value(metrics.firstFiveReturnPct, number => `${number > 0 ? '+' : ''}${formatPercentage(number)}`)))}
        ${row('Jahre mit Entnahme', ({ metrics }) => escape(value(metrics.withdrawalYears, String)))}
        ${row('', renderComparisonInspectLink)}
        </tbody></table></div><p class="scenario-comparison-note">Die Pfade enden zu verschiedenen Zeitpunkten. Ein Vergleich zeigt Zusammenhänge, keine Ursachen.</p>`;
}
