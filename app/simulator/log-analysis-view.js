import { escapeHtml as escape } from '../shared/security-utils.js';
import { bindInfoPopovers, infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { formatProtocolValue } from './protocol-columns.js';

const known = value => typeof value === 'number' && Number.isFinite(value);
const euro = value => known(value) ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value)} €` : 'unbekannt';
const years = count => `${count} ${count === 1 ? 'Jahr' : 'Jahre'}`;
const yearText = (year, mc) => year == null ? 'Jahr unbekannt' : mc ? `Simulationsjahr ${year}` : String(year);
const range = event => `${event.source === 'monte_carlo' ? 'Simulationsjahr ' : ''}${event.evidence.startYear === event.evidence.endYear
    ? event.evidence.startYear : `${event.evidence.startYear}–${event.evidence.endYear}`}`;
const bindings = new WeakMap();

function eventPoint(event, occurrences, model, { startYear }) {
    const point = { ...event, count: occurrences.length };
    const mc = model.source === 'monte_carlo';
    if (event.type === 'minimum_flex_held') {
        point.label = 'Mindest-Flex';
        point.valueText = 'In keinem Jahr unterschritten';
        point.text = 'Der bezahlte Haushalts-Flex einschließlich Rentenbeitrag bleibt in allen abgeschlossenen Jahren mindestens auf dem angewandten Mindest-Flex.';
        // Bei gehaltenem Minimum führt der Link zum ersten belegten Kürzungsjahr.
        point.year = model.events.find(item => item.type === 'decision_flex_cut_phase')?.year ?? event.year;
    } else if (event.type === 'decision_flex_cut_phase') {
        point.label = 'Längste Kürzung';
        point.valueText = `${years(event.evidence.durationYears)} · ${range(event)}`;
    } else if (event.type === 'below_minimum_flex_phase') {
        point.valueText = `${years(event.evidence.durationYears)} · ${range(event)}`;
    } else if (event.type === 'minimum_real_year_end_wealth') {
        point.label = `Stand im Kaufkraft-Tief · ${model.moneyBasis === 'real' ? mc ? 'heutige Euro' : `Euro von ${startYear ?? 'Laufstart'}` : 'nominal'}`;
        point.valueText = `${event.valueText} · ${yearText(event.year, mc)}`;
        const recovery = model.events.find(item => item.type === 'real_wealth_unrecovered'
            && item.evidence.peakYear === 'start' && item.evidence.openAtEnd);
        point.text = recovery && !mc
            ? `${event.text} Die Kaufkraft des Startvermögens wird bis ${yearText(recovery.evidence.observationEnd, mc)} in den Jahresendständen nicht wieder erreicht.`
            : event.text;
    } else if (event.type === 'liquidity_below_target') {
        point.valueText = `${years(occurrences.length)} · Beispiel ${yearText(event.year, mc)}`;
    } else if (event.type === 'tax_peak') {
        point.label = 'Höchste Jahressteuer';
        point.valueText = `${event.valueText} · ${yearText(event.year, mc)}`;
    } else if (occurrences.length > 1) {
        point.valueText = `${event.valueText} · ${occurrences.length} ${event.evidence.durationYears ? 'Phasen' : 'Treffer'}`;
    }
    if (event.type === 'market_regime_change') {
        const label = value => formatProtocolValue({ id: 'market', format: 'text' }, value);
        point.valueText = `${label(event.evidence.from)} → ${label(event.evidence.to)}${occurrences.length > 1 ? ` · ${occurrences.length} Wechsel` : ''}`;
        point.text = `Im ${mc ? 'Simulationsjahr' : 'Jahr'} ${event.year ?? 'unbekannt'} wechselt die protokollierte Marktphase von „${label(event.evidence.from)}“ zu „${label(event.evidence.to)}“.`;
    }
    return point;
}

/** Reine Anzeigeprojektion: Priorität aus LA-1, wiederholte Treffer je Art bündeln. */
export function buildLogAnalysisView(model, { rows, source, startYear } = {}) {
    if (!model.available) return null;
    const groups = new Map();
    for (const event of model.prioritizedEvents) {
        if (event.type === 'floor_covered') continue;
        const key = event.evidence.person ? `${event.type}:${event.evidence.person}` : event.type;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
    }
    const points = [...groups.values()].map(events => eventPoint(events[0], events, model, { startYear }));
    if (model.minimumFlex.missingReason !== null) points.push({ type: 'minimum_flex_unknown', priority: 10,
        label: 'Mindest-Flex', valueText: 'unbekannt', year: null,
        text: 'Die Zahl der Jahre unter Mindest-Flex ist wegen fehlender oder nicht auswertbarer Jahreswerte unbekannt.' });
    if (!groups.has('decision_flex_cut_phase')) points.push({ type: 'cuts_none', priority: 20,
        label: 'Längste Kürzung', valueText: model.cuts.missingYears || !model.financialYears ? 'unbekannt' : 'Keine ab 10 %', year: null,
        text: model.cuts.missingYears || !model.financialYears
            ? 'Kürzungen der vorgesehenen Flex-Entnahme sind wegen fehlender Jahreswerte nicht vollständig auswertbar.'
            : 'Die vorgesehene Flex-Entnahme wird in keinem abgeschlossenen Jahr um mindestens 10 % gekürzt.' });
    if (!groups.has('minimum_real_year_end_wealth')) points.push({ type: 'wealth_unknown', priority: 30,
        label: 'Tiefster realer Stand', valueText: 'unbekannt', year: null,
        text: 'Ohne belegte Vermögens- und Inflationswerte bleibt das reale Vermögenstief unbekannt.' });
    const cardPriority = point => ({ ruin: 1, floor_shortfall: 2, technical_error: 4,
        below_minimum_flex_phase: 10, minimum_flex_unknown: 10, minimum_flex_held: 11,
        decision_flex_cut_phase: 20, cuts_none: 20,
        minimum_real_year_end_wealth: 30, wealth_unknown: 30 })[point.type] ?? 100 + point.priority;
    points.sort((a, b) => cardPriority(a) - cardPriority(b));
    const lastYear = model.yearRange.end;
    const mc = model.source === 'monte_carlo';
    if (lastYear !== null) points.push({ type: 'end_wealth', priority: 120, label: `Ende ${yearText(lastYear, mc)}`, year: lastYear,
        valueText: `${euro(model.moneyBasis === 'real' ? model.realEndWealth : model.nominalEndWealth)} · ${model.moneyBasis === 'real' ? mc ? 'heutige Euro' : `Euro von ${startYear ?? 'Laufstart'}` : 'nominal'}`,
        text: `Stand des letzten abgeschlossenen Finanzjahrs · ${model.moneyBasis === 'real' ? mc ? 'heutige Euro' : `Euro von ${startYear ?? 'Laufstart'}` : 'nominale Euro'}.` });
    const ruin = model.events.find(event => event.type === 'ruin');
    const shortfall = model.events.find(event => event.type === 'floor_shortfall');
    const badge = ruin ? { tone: 'warning', text: `Finanzieller Abbruch ${yearText(ruin.year, mc)}` }
        : shortfall ? { tone: 'warning', text: `Grundbedarf ${yearText(shortfall.year, mc)} ungedeckt` }
            : model.floorCovered ? { tone: 'good', text: model.financialYears === 1 ? 'Grundbedarf im einzigen Jahr gedeckt'
                : `Grundbedarf in allen ${model.financialYears} Jahren gedeckt` }
                : { tone: 'unknown', text: 'Deckung des Grundbedarfs unbekannt' };
    for (const point of points) {
        const row = rows.find(entry => entry?.jahr === point.year);
        if (!row) point.year = null;
        point.historicalYear = Number.isInteger(row?.histJahr) ? row.histJahr : null;
    }
    return { model, source, badge, mc, cards: points.slice(0, 3), more: points.slice(3) };
}

function yearLink(point, options) {
    if (!Number.isInteger(point.year)) return '';
    const info = options.mc ? infoPopoverHtml(`Datenjahr zu Simulationsjahr ${point.year}`,
        `Simulationsjahr ${point.year}: ${point.historicalYear === null ? 'gezogenes Datenjahr unbekannt' : `gezogenes Datenjahr ${point.historicalYear}`}. Das Datenjahr ist keine Kalenderzeit des simulierten Haushalts.`) : '';
    return `<span class="log-analysis-year-link"><a class="backtest-analysis-year" href="#${options.yearPrefix}${point.year}" ${options.yearAttribute}="${point.year}">${yearText(point.year, options.mc)} im Protokoll →</a>${info}</span>`;
}

/** Derselbe Kartenbaustein für Backtest und genau einen MC-Pfad. */
export function logAnalysisHtml(view, options) {
    if (!view) return '';
    const heading = options.mc ? '<h2 id="scenarioLogAnalysisHeading">Was im gewählten Pfad auffällt</h2>'
        : '<h2 id="backtestAnalysisHeading">Was im Lauf auffällt</h2>';
    let info = 'Die Punkte stammen aus festen Regeln für diesen Lauf. Mindest-Flex und Grundbedarf haben Vorrang, danach folgen Kürzungsphasen und das reale Vermögenstief. Kürzung bedeutet mindestens 10 % weniger vorgesehene Flex-Entnahme; unter Mindest-Flex zählt der tatsächlich bezahlte Haushalts-Flex einschließlich Rentenbeitrag. Wiederholte Treffer werden je Art und Person gebündelt, bei Phasen steht die längste vorn. Steuerspitzen sind mindestens doppelt so hoch wie der Laufmedian und über 1.000 €, große Verkäufe erreichen mindestens 10 % des Vorjahresvermögens. Reale Werte zeigen Kaufkraft zum Laufstart einschließlich Pflegevorsorge. Fehlende Werte bleiben unbekannt; die Anzeige erklärt keine unbelegten Ursachen.'
        + (options.mc ? ' Die Zeitachse nennt Simulationsjahre. Das ⓘ am Jahreslink nennt das dazu gezogene Datenjahr. Die Karten beschreiben nur diesen Pfad, keine Anteile aller Pfade. Pflege und Tod sind protokollierte Lebensereignisse, keine Bewertung.' : '');
    info = info.replace('und über 1.000 €,', 'und überschreiten den festen Steuerfilter,');
    return `<div class="backtest-analysis-head"><div>${heading}
        <p class="backtest-analysis-source ds-explanation"><span>${escape(view.source)}</span>${infoPopoverHtml('Wie die Punkte gefunden werden', info)}</p></div>
        <div class="log-analysis-actions">${options.mc ? '<a href="#scenarioProtocolHeading" data-scenario-analysis-protocol>Zum Jahresprotokoll →</a>' : ''}<span class="backtest-analysis-badge is-${view.badge.tone}">${escape(view.badge.text)}</span></div></div>
        <div class="backtest-analysis-cards">${view.cards.map(point => `<article class="backtest-analysis-event" data-analysis-type="${escape(point.type)}">
            <div class="backtest-analysis-label">${escape(point.label)}</div><div class="backtest-analysis-value">${escape(point.valueText)}</div>
            <p>${escape(point.text)}</p>${yearLink(point, options)}</article>`).join('')}</div>
        <details class="backtest-analysis-more"><summary>Weitere ${view.more.length + 1} Punkte · als Text</summary>
            <div>${view.more.map(point => `<div class="backtest-analysis-row" data-analysis-type="${escape(point.type)}">
                <div><span class="backtest-analysis-label">${escape(point.label)}</span><p>${escape(point.text)}</p></div>
                <div class="backtest-analysis-row-value"><strong>${escape(point.valueText)}</strong>${yearLink(point, options)}</div></div>`).join('')}
            <p class="backtest-analysis-text">Als Text: ${escape(view.model.summary)}</p></div></details>`;
}

function clearHighlight(state) {
    clearTimeout(state?.timer);
    state?.row?.classList.remove('backtest-analysis-highlight');
    if (state) { state.row = null; state.timer = null; }
}

/** Auch Links nach einem Neuaufbau benutzen die aktuelle Protokolltabelle. */
export function jumpToLogAnalysisYear(documentRef, year, options, state = {}) {
    if (!Number.isInteger(year)) return false;
    const row = documentRef.getElementById(`${options.yearPrefix}${year}`);
    if (!row) return false;
    clearHighlight(state);
    const log = documentRef.getElementById(options.logId);
    if (log) log.scrollLeft = 0;
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    row.focus({ preventScroll: true });
    row.classList.add('backtest-analysis-highlight');
    state.row = row;
    state.timer = setTimeout(() => clearHighlight(state), 2400);
    return true;
}

/** Quelle und Details werden nach jedem neuen Lauf vollständig ersetzt. */
export function renderLogAnalysis(documentRef, view, options) {
    const host = documentRef.getElementById(options.hostId);
    if (!host) return;
    let state = bindings.get(host);
    if (!state) {
        state = {};
        bindings.set(host, state);
        host.addEventListener('click', event => {
            const link = event.target.closest(`[${options.yearAttribute}]`);
            if (link && host.contains(link) && jumpToLogAnalysisYear(documentRef, Number(link.getAttribute(options.yearAttribute)), options, state)) event.preventDefault();
            const protocol = event.target.closest('[data-scenario-analysis-protocol]');
            if (protocol && host.contains(protocol)) {
                const heading = documentRef.getElementById('scenarioProtocolHeading');
                if (heading) { event.preventDefault(); heading.scrollIntoView({ block: 'start' }); heading.focus({ preventScroll: true }); }
            }
        });
    }
    clearHighlight(state);
    host.innerHTML = logAnalysisHtml(view, options);
    host.hidden = !view;
    if (view) bindInfoPopovers(documentRef, { root: host });
}
