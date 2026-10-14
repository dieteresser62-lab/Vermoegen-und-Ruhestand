import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { formatCurrency } from './simulator-utils.js';
import { formatChartEuro } from './results-formatting.js';
import { buildScenarioEntries, renderScenarioWealthChart, scenarioEndWealth } from './scenario-wealth-chart.js';

const bindings = new WeakMap();
const groups = [['wealth', 'Endvermögen'], ['care', 'Pflege'], ['risk', 'Risiko'], ['sample', 'Stichprobe']];

function scenarioLabel(scenario) {
    const ranks = { worst: 'Minimum', p5: 'P5', p10: 'P10', p25: 'P25', p50: 'Median', p75: 'P75', p90: 'P90', p95: 'P95', best: 'Maximum' };
    return ranks[scenario.key] ? `${scenario.label} · nominaler Rang ${ranks[scenario.key]}` : scenario.label;
}

function scenarioLifeEvents(scenario, startYear, personDisplayContext) {
    const rows = scenario.logDataRows || [];
    const events = [];
    const yearLabel = (row, field, before) => {
        const previous = rows[rows.indexOf(row) - 1];
        const observed = row.jahr === 1 || previous?.jahr === row.jahr - 1
            && before.includes(previous[field]);
        return observed && Number.isInteger(row.jahr)
            ? Number.isInteger(startYear) ? startYear + row.jahr - 1 : `Jahr ${row.jahr}` : 'Jahr unbekannt';
    };
    for (const person of [1, 2]) {
        const death = rows.find(row => row[`Person${person}Alive`] === 0 || row[`Person${person}Alive`] === false);
        const care = rows.find(row => row[`CareP${person}_Active`] === 1 || row[`CareP${person}_Active`] === true);
        const parts = [];
        if (care) parts.push(`Pflege ${yearLabel(care, `CareP${person}_Active`, [0, false])}`);
        if (death) parts.push(`† ${yearLabel(death, `Person${person}Alive`, [1, true])}`);
        if (parts.length) events.push(`${personDisplayContext?.persons?.[person - 1]?.name || `Person ${person}`} ${parts.join(' · ')}`);
    }
    return events;
}

function renderPersonMarks(events) {
    return events.map(event => `<span class="scenario-person-mark">${escape(event)}</span>`).join(' ');
}

/** Nur die Anzeige der Stichprobe sortieren, niemals Quellarrays oder Logs. */
export function scenarioGroupEntries(entries, group) {
    const items = entries.filter(entry => entry.group === group);
    if (group !== 'sample') return items;
    const value = entry => scenarioEndWealth(entry.scenario, 'nominal');
    const index = entry => Number.isSafeInteger(entry.scenario.sourceIdentity?.absoluteRunIndex)
        ? entry.scenario.sourceIdentity.absoluteRunIndex : Number.MAX_SAFE_INTEGER;
    return items.sort((a, b) => (value(a) === null) - (value(b) === null)
        || (value(a) ?? 0) - (value(b) ?? 0) || index(a) - index(b)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function scenarioValue(scenario, mode, { startYear, realByRun } = {}) {
    const value = scenarioEndWealth(scenario, mode, realByRun);
    const ruinYear = scenario.logDataRows?.find(row => row.recordType === 'terminal_ruin')?.jahr;
    return scenario.failed ? Number.isFinite(ruinYear)
        ? `Ruin ${Number.isInteger(startYear) ? startYear + ruinYear - 1 : `Jahr ${ruinYear}`}` : 'Ruin'
        : value === null ? 'Messung fehlt' : formatChartEuro(value);
}

export function renderScenarioList(entries, selectedId, mode, options = {}) {
    const group = options.activeGroup || entries.find(entry => entry.id === selectedId)?.group || entries[0]?.group || 'wealth';
    const items = scenarioGroupEntries(entries, group);
    const candidate = options.focusedId || selectedId;
    const focusedId = items.some(entry => entry.id === candidate) ? candidate : items[0]?.id;
    if (!items.length) return `<p class="ds-note">${group === 'care' ? 'Keine beobachteten Pflegefälle.' : 'Keine Szenarien vorhanden.'}</p>`;
    return items.map(entry => {
        const wealth = scenarioValue(entry.scenario, mode, options);
        const endWealth = scenarioEndWealth(entry.scenario, mode, options.realByRun);
        const exactWealth = entry.scenario.failed || endWealth === null ? wealth : formatCurrency(endWealth);
        const label = scenarioLabel(entry.scenario);
        const events = scenarioLifeEvents(entry.scenario, options.startYear, options.personDisplayContext);
        return `<button type="button" role="option" tabindex="${entry.id === focusedId ? 0 : -1}" class="scenario-list-item" data-scenario-group="${group}" data-scenario-id="${escape(entry.id)}" aria-selected="${entry.id === selectedId}" title="${escape(exactWealth)}" aria-label="${escape(`${entry.scenario.label} · ${exactWealth}${events.length ? ` · ${events.join(' · ')}` : ''}`)}"><span class="scenario-swatch" style="--scenario-color:${entry.color}" aria-hidden="true"></span><span class="scenario-name">${escape(label)}</span><small class="scenario-value${entry.scenario.failed ? ' is-ruin' : ''}">${escape(wealth)}</small>${events.length ? `<small class="scenario-details">${renderPersonMarks(events)}</small>` : ''}</button>`;
    }).join('');
}

/** Ein Binder als einzige Auswahlquelle für Liste, SVG, Navigation und Protokoll. */
export function bindScenarioLogView({ document: doc, logs, onSelect, onMode, chartOptions = {} }) {
    disposeScenarioLogView(doc);
    const entries = buildScenarioEntries(logs).map(entry => {
        const person = { earliestCareP1: 1, earliestCareP2: 2 }[entry.scenario.key];
        const name = chartOptions.personDisplayContext?.persons?.[person - 1]?.name;
        return person ? { ...entry, scenario: { ...entry.scenario,
            label: `Frühester Pflegeeintritt ${name || `Person ${person}`}` } } : entry;
    });
    const list = doc.getElementById('scenarioList');
    const groupHost = doc.getElementById('scenarioGroups');
    const disclosure = doc.getElementById('scenarioSelectionDisclosure');
    const chart = doc.getElementById('scenarioWealthChart');
    let selectedId = entries.some(entry => entry.id === 'char_worst') ? 'char_worst' : entries[0]?.id || '';
    let activeGroup = entries.find(entry => entry.id === selectedId)?.group || 'wealth';
    let focusedId = selectedId;
    let mode = 'real';
    const remembered = new Map();
    const activeItems = () => scenarioGroupEntries(entries, activeGroup);
    const cleanup = [];
    const listen = (element, type, handler) => {
        if (!element?.addEventListener) return;
        element.addEventListener(type, handler);
        cleanup.push(() => element.removeEventListener(type, handler));
    };
    const contentWidth = () => {
        if (!chart) return 0;
        const style = doc.defaultView?.getComputedStyle?.(chart);
        return Math.max(0, (chart?.clientWidth || 0) - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0));
    };
    const drawChart = () => {
        if (!chart) return;
        const focusedId = chart.contains?.(doc.activeElement) ? doc.activeElement?.closest?.('[data-scenario-id]')?.getAttribute('data-scenario-id') : null;
        const width = contentWidth();
        const narrow = (doc.defaultView?.innerWidth || 1920) < 768;
        chart.innerHTML = renderScenarioWealthChart(entries, { ...chartOptions, mode, selectedId,
            displayWidth: width > 0 ? Math.max(narrow ? 760 : 300, width) : undefined });
        if (focusedId) Array.from(chart.querySelectorAll?.('[data-scenario-id]') || [])
            .find(element => element.getAttribute('data-scenario-id') === focusedId && element.tagName?.toLowerCase() === 'button')?.focus();
    };
    const options = () => Array.from(list?.querySelectorAll?.('[role="option"]') || []);
    const focusOption = (id, { preventScroll = true } = {}) => {
        focusedId = id;
        for (const option of options()) option.setAttribute('tabindex', option.getAttribute('data-scenario-id') === id ? '0' : '-1');
        const option = options().find(option => option.getAttribute('data-scenario-id') === id);
        option?.focus({ preventScroll });
        // Navigation hält die Seite fest; beim Replay-Rückweg darf der Browser sie scrollen.
        // Die Zeile bleibt in beiden Fällen vollständig in der inneren Liste sichtbar.
        if (option?.getBoundingClientRect && list?.getBoundingClientRect) {
            const row = option.getBoundingClientRect(), area = list.getBoundingClientRect();
            if (row.top < area.top) list.scrollTop += row.top - area.top;
            else if (row.bottom > area.bottom) list.scrollTop += row.bottom - area.bottom;
        }
    };
    const draw = () => {
        const hadFocus = list?.contains?.(doc.activeElement);
        const scrollTop = list?.scrollTop || 0;
        if (list) {
            list.innerHTML = renderScenarioList(entries, selectedId, mode, { ...chartOptions, activeGroup, focusedId });
            list.setAttribute('role', 'listbox');
            list.setAttribute('aria-label', `Szenarien: ${groups.find(([key]) => key === activeGroup)[1]}`);
            list.setAttribute('tabindex', activeItems().length ? '-1' : '0');
            list.setAttribute('data-selected-id', selectedId);
            list.scrollTop = scrollTop;
        }
        if (groupHost) {
            if (!groupHost.innerHTML) groupHost.innerHTML = groups.map(([key, title]) => `<button type="button" class="ds-button ds-button-secondary" data-scenario-group="${key}"><span>${title}</span> <span class="scenario-group-count">${entries.filter(entry => entry.group === key).length}</span></button>`).join('');
            for (const button of groupHost.querySelectorAll?.('[data-scenario-group]') || []) button.setAttribute('aria-pressed', String(button.getAttribute('data-scenario-group') === activeGroup));
        }
        const entry = entries.find(entry => entry.id === selectedId);
        const label = entry ? scenarioLabel(entry.scenario) : '';
        const wealth = entry ? scenarioValue(entry.scenario, mode, chartOptions) : '';
        const exactWealth = entry && !entry.scenario.failed ? scenarioEndWealth(entry.scenario, mode, chartOptions.realByRun) : null;
        const summary = doc.getElementById('scenarioSelectionSummary');
        if (summary) {
            summary.textContent = entry ? `Szenario: ${label} · ${wealth}` : 'Szenario: Keine Auswahl';
            summary.title = exactWealth === null ? wealth : formatCurrency(exactWealth);
        }
        const basis = doc.getElementById('scenarioListBasis');
        if (basis) basis.textContent = `Endvermögen · ${mode === 'real' ? 'heutige Euro' : 'nominal'} · Auswahl nach nominalem Rang oder Gruppenmerkmal`;
        const heading = doc.getElementById('scenarioSelectedHeading');
        const events = entry ? scenarioLifeEvents(entry.scenario, chartOptions.startYear, chartOptions.personDisplayContext) : [];
        if (heading) heading.innerHTML = entry ? `<p class="scenario-selected-eyebrow">Ausgewählt · Nach ${groups.find(([key]) => key === activeGroup)[1]}</p><strong class="scenario-selected-title">${escape(label)} · <span title="${escape(exactWealth === null ? wealth : formatCurrency(exactWealth))}"${entry.scenario.failed ? ' class="is-ruin"' : ''}>${escape(wealth)}</span></strong>${events.length ? `<div class="scenario-selected-events">${renderPersonMarks(events)}</div>` : ''}<div class="scenario-selected-meta"><span>Startjahr: ${Number.isInteger(chartOptions.startYear) ? chartOptions.startYear : 'unbekannt'}</span><span>${entry.scenario.logDataRows?.length || 0} Logzeilen</span><span>${mode === 'real' ? 'heutige Euro' : 'nominale Euro'}</span></div>` : '<strong>Ausgewählt: Kein Szenario</strong>';
        const items = activeItems(), position = items.findIndex(item => item.id === selectedId);
        for (const [id, offset, direction, neutral] of [
            ['scenarioPrevious', -1, 'Vorheriges', '‹ Vorheriges'],
            ['scenarioNext', 1, 'Nächstes', 'Nächstes ›']
        ]) {
            const button = doc.getElementById(id);
            if (!button) continue;
            const neighbor = position >= 0 ? items[position + offset] : null;
            button.disabled = !neighbor;
            button.textContent = neighbor ? offset < 0 ? `‹ ${neighbor.scenario.label}` : `${neighbor.scenario.label} ›` : neutral;
            button.setAttribute('aria-label', neighbor ? `${direction}: ${neighbor.scenario.label}` : direction);
        }
        drawChart();
        const control = doc.getElementById('mcWealthMode');
        if (control) control.hidden = false;
        for (const button of control?.querySelectorAll?.('[data-wealth-mode]') || []) button.setAttribute('aria-pressed', String(button.getAttribute('data-wealth-mode') === mode));
        if (hadFocus) focusOption(focusedId);
    };
    let lastSingle = (doc.defaultView?.innerWidth || 1920) <= 1100;
    if (disclosure) disclosure.open = !lastSingle;
    let lastWidth = contentWidth();
    let lastNarrow = (doc.defaultView?.innerWidth || 1920) < 768;
    const resize = () => {
        const width = contentWidth();
        const narrow = (doc.defaultView?.innerWidth || 1920) < 768;
        const single = (doc.defaultView?.innerWidth || 1920) <= 1100;
        if (single !== lastSingle && disclosure) disclosure.open = !single;
        lastSingle = single;
        if (width === lastWidth && narrow === lastNarrow) return;
        lastWidth = width; lastNarrow = narrow;
        drawChart();
    };
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer && chart) {
        const observer = new Observer(resize);
        observer.observe(chart);
        cleanup.push(() => observer.disconnect());
    }
    listen(doc.defaultView, 'resize', resize);
    const choose = id => {
        const entry = entries.find(entry => entry.id === id);
        selectedId = entry?.id || '';
        focusedId = selectedId;
        if (entry) { activeGroup = entry.group; remembered.set(activeGroup, selectedId); }
        onSelect(selectedId, entry?.scenario || null);
        draw();
    };
    const switchGroup = group => {
        if (!groups.some(([key]) => key === group)) return;
        activeGroup = group;
        const items = activeItems();
        choose(items.find(item => item.id === remembered.get(group))?.id || items[0]?.id || '');
    };
    listen(groupHost, 'click', event => switchGroup(event.target?.closest?.('[data-scenario-group]')?.getAttribute('data-scenario-group')));
    const navigate = offset => {
        const items = activeItems(), index = items.findIndex(entry => entry.id === selectedId);
        if (index >= 0 && items[index + offset]) choose(items[index + offset].id);
    };
    listen(doc.getElementById('scenarioPrevious'), 'click', () => navigate(-1));
    listen(doc.getElementById('scenarioNext'), 'click', () => navigate(1));
    listen(list, 'keydown', event => {
        const items = activeItems();
        if (!items.length) return;
        const index = items.findIndex(entry => entry.id === focusedId);
        let target;
        if (event.key === 'ArrowDown') target = items[Math.min(items.length - 1, index + 1)];
        if (event.key === 'ArrowUp') target = items[Math.max(0, index - 1)];
        if (event.key === 'Home') target = items[0];
        if (event.key === 'End') target = items.at(-1);
        if (target) { event.preventDefault(); focusOption(target.id); }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(focusedId); focusOption(selectedId); }
    });
    listen(list, 'focusin', event => {
        const id = event.target?.closest?.('[data-scenario-id]')?.getAttribute('data-scenario-id');
        if (activeItems().some(entry => entry.id === id)) {
            focusedId = id;
            for (const option of options()) option.setAttribute('tabindex', option.getAttribute('data-scenario-id') === id ? '0' : '-1');
        }
    });
    const pick = event => {
        const id = event.target?.closest?.('[data-scenario-id]')?.getAttribute('data-scenario-id');
        if (id) { choose(id); if (disclosure) disclosure.open = true; focusOption(selectedId); }
    };
    listen(list, 'click', pick);
    listen(chart, 'click', pick);
    for (const id of ['mcWealthMode']) listen(doc.getElementById(id), 'click', event => {
        const next = event.target?.closest?.('[data-wealth-mode]')?.getAttribute('data-wealth-mode');
        if (!['real', 'nominal'].includes(next) || next === mode) return;
        mode = next; draw(); onMode(mode);
    });
    const binding = {
        choose, switchGroup,
        focusSelected: () => { if (disclosure) disclosure.open = true; focusOption(selectedId, { preventScroll: false }); },
        get activeGroup() { return activeGroup; },
        get focusedId() { return focusedId; },
        get selectedId() { return selectedId; },
        get mode() { return mode; },
        dispose: () => cleanup.forEach(remove => remove())
    };
    bindings.set(doc, binding);
    if (groupHost) groupHost.innerHTML = '';
    onMode(mode);
    choose(selectedId);
    return binding;
}

export function disposeScenarioLogView(doc) {
    bindings.get(doc)?.dispose();
    bindings.delete(doc);
}

/** Replay-Rückweg öffnet dieselbe Auswahl und erlaubt sichtbaren Fokus im Seitenviewport. */
export function focusSelectedScenario(doc) {
    const binding = bindings.get(doc);
    if (!binding?.selectedId) return false;
    binding.focusSelected();
    return true;
}
