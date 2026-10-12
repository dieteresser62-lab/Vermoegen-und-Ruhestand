"use strict";

import { PROTOCOL_GROUPS, getProtocolColumns, readProtocolValue, formatProtocolValue,
    protocolRowData, protocolRowFlags, createProtocolPersonContext, PROTOCOL_COLUMNS } from './protocol-columns.js';

export function escapeProtocolHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const escape = escapeProtocolHtml;
const chip = (label, tone = '', description = '') => `<span class="sim-status-chip protocol-chip${tone ? ` protocol-chip-${tone}` : ''}"${description ? ` title="${escape(description)}" aria-label="${escape(description)}"` : ''}>${escape(label)}</span>`;
const LOW_WITHDRAWAL_HINT = 'Reale Entnahme unter dem 10-%-Wert aller simulierten Jahre (CaR)';

export function protocolYearPresentation(entry, index, options = {}) {
    const source = options.source || 'mc', row = protocolRowData(entry, source);
    // MC-jahr ist einsbasiert; das Backtestjahr ist bereits ein Kalenderjahr.
    const offset = source === 'backtest' ? (Number.isFinite(options.startYear) && Number.isFinite(entry?.jahr) ? entry.jahr - options.startYear : index)
        : (Number.isFinite(entry?.jahr) ? entry.jahr - 1 : index);
    const calendarYear = source === 'backtest' ? entry?.jahr
        : Number.isFinite(options.startYear) ? options.startYear + offset : null;
    const inputs = options.inputs || {};
    const age = (start, alive) => Number.isFinite(start) ? `${start + offset}${alive === false || alive === 0 ? ' †' : ''}` : null;
    const ages = [age(inputs.startAlter, row.Person1Alive)];
    if (inputs.partner?.aktiv) ages.push(age(inputs.partner.startAlter, row.Person2Alive));
    return { calendarYear, simulationYear: source === 'mc' ? entry?.jahr : offset + 1,
        ages: ages.filter(value => value !== null).join(' / ') };
}

const personFieldLabels = {
    profile_geburtsdatum: 'Geburtsdatum', profile_rentenbeginn: 'Rentenbeginn', profile_rente_monatlich: 'Monatliche Rente',
    profile_geschlecht: 'Geschlecht', profile_sparer_pauschbetrag: 'Sparer-Pauschbetrag', profile_kirchensteuer_pct: 'Kirchensteuer (%)',
    profile_rente_steuerquote_pct: 'Steuerquote (%)', profile_rentenanpassung_art: 'Gemeinsame Rentenanpassung', profile_rentenanpassung_pct: 'Rentenanpassung (% p.a.)'
};
export function renderPersonDataNotice(context) {
    if (!context?.deviationApplied) return '';
    const changes = context.persons.flatMap(person => person.changes.map(change =>
        `<li>${escape(person.role === 'primary' ? 'Hauptprofil' : 'Partner')} · ${escape(personFieldLabels[change.field] || change.field)}: Profil ${escape(change.profileValue)} → ${escape(change.effectiveValue)}</li>`)).join('');
    return `<aside class="ds-note person-data-deviation"><strong>Abweichung · nur diese Rechnung</strong><p>Personenwerte am 01.01.${escape(context.referenceYear)} · Profil unverändert.</p><ul>${changes}</ul></aside>`;
}

export function renderProtocolSummary(rows, options = {}) {
    const source = options.source || 'mc', data = Array.isArray(rows) ? rows : [];
    const flags = data.map(row => protocolRowFlags(row, source));
    const outcome = options.outcome?.kind || options.outcome;
    const outcomeLabel = ({ completed: 'Vollständig', no_ruin: 'Kein Ruin', ruin: 'Ruin', all_dead: 'Haushalt verstorben', horizon_exhausted: 'Horizont erreicht',
        incomplete: 'Unvollständig', technical_error: 'Technischer Fehler' })[outcome];
    const last = protocolRowData(data.at(-1), source);
    const chips = [];
    if (outcomeLabel) chips.push(chip(outcomeLabel, outcome === 'ruin' ? 'ruin' : ''));
    const end = options.endWealth ?? last.portfolio_total_end;
    if (Number.isFinite(end)) chips.push(chip(`Endvermögen ${formatProtocolValue({ format: 'money' }, end)}`));
    chips.push(chip(`${flags.filter(flag => flag.cut).length} Jahre mit Kürzung`, 'cut'));
    chips.push(chip(`${flags.filter(flag => flag.care).length} Pflegejahre`, 'care'));
    return renderPersonDataNotice(options.personDataContext) + `<p class="protocol-subtitle">${escape(options.subtitle || `${data.length} Jahreszeilen · nominale Euro · Anzeige unabhängig vom vollständigen Download`)}</p><div class="protocol-chips">${chips.join('')}</div>`;
}

export function renderProtocolLegend(options = {}) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const persons = options.source === 'backtest' ? '' : `✓ lebt · ${context.careEnabled ? 'PG Pflegegrad · ' : ''}† verstorben. `;
    return `<div class="protocol-legend"><span><i class="protocol-mark-cut" aria-hidden="true"></i>Jahr mit Kürzung</span><span><i class="protocol-mark-care" aria-hidden="true"></i>Pflegejahr</span><span><i class="protocol-mark-ruin" aria-hidden="true"></i>Ruin</span><span>${persons}Gepunktete Überschriften erklären die Spalten. Handel nennt verkauft oder gekauft.</span></div>`;
}

export function protocolPersonPresentation(rows, index, column, options = {}) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const person = column.person, raw = protocolRowData(rows[index], options.source);
    const alive = raw[`Person${person}Alive`];
    const name = context.persons[person - 1]?.name || `Person ${person}`;
    if (alive === false || alive === 0) {
        const deathIndex = rows.findIndex(entry => {
            const status = protocolRowData(entry, options.source)[`Person${person}Alive`];
            return status === false || status === 0;
        });
        const deathRow = rows[deathIndex], previous = rows[deathIndex - 1];
        const previousAlive = protocolRowData(previous, options.source)[`Person${person}Alive`];
        // Nur der erste Simulationsbeginn oder ein lückenloser Lebt→Tod-Übergang datiert den Tod.
        const observedTransition = deathIndex === 0 && deathRow?.jahr === 1
            || (previousAlive === 1 || previousAlive === true) && Number.isFinite(previous?.jahr) && deathRow?.jahr === previous.jahr + 1;
        const year = observedTransition && Number.isFinite(deathRow?.jahr)
            ? protocolYearPresentation(rows[deathIndex], deathIndex, options).calendarYear : null;
        return { text: '†', tone: `dead${index > deathIndex ? ' following' : ''}`,
            title: `${name}: verstorben${Number.isFinite(year) ? ` ${year}` : ' · Todesjahr unbekannt'}` };
    }
    if (alive !== true && alive !== 1) return { text: '—', tone: 'unknown', title: `${name}: Lebensstatus unbekannt` };
    if (context.careEnabled && raw[`CareP${person}_Active`]) {
        const grade = raw[`CareP${person}_Grade`];
        return { text: grade == null ? 'PG ?' : `PG ${grade}`, tone: 'care',
            title: `${name}: ${grade == null ? 'Pflegegrad unbekannt' : `Pflegegrad ${grade}`}` };
    }
    return { text: '✓', tone: 'alive', title: `${name}: lebt` };
}

export function renderProtocolTable(rows, options = {}) {
    const source = options.source || 'mc', data = Array.isArray(rows) ? rows : [];
    const columns = (options.columns || getProtocolColumns(options)).map(column => {
        // Auch Legacy-Spalten werden über den Katalog, nie über ihre Position zugeordnet.
        const catalog = PROTOCOL_COLUMNS.find(item => column.id ? item.id === column.id : item.legacyHeader === column.header);
        return catalog ? { ...catalog, ...column } : column;
    }).filter(column => {
        const catalog = PROTOCOL_COLUMNS.find(item => column.id ? item.id === column.id : item.legacyHeader === column.header);
        return column.visibility !== 'export' && catalog?.visibility !== 'export'
            && !(source === 'backtest' && ['care', 'persons'].includes(column.group || catalog?.group));
    });
    const groups = [];
    for (const column of columns) {
        const previous = groups.at(-1);
        const group = column.group || 'strategy';
        if (previous?.group === group) previous.count++;
        else groups.push({ group, count: 1 });
    }
    const caption = options.caption || (source === 'backtest' ? `Jahresprotokoll des kanonischen Backtest-Resultats (${data.length} Zeilen)` : `Szenario-Jahresprotokoll (${data.length} Zeilen)`);
    let html = '<thead><tr class="protocol-group-head">';
    html += groups.map(({ group, count }) => `<th scope="colgroup" colspan="${count}">${escape(PROTOCOL_GROUPS[group] || group)}</th>`).join('');
    html += '</tr><tr class="protocol-column-head">';
    const groupStart = position => position > 0 && columns[position].group !== columns[position - 1].group;
    html += columns.map((column, position) => `<th scope="col" class="${column.format === 'person' ? 'protocol-person' : column.align === 'right' ? 'protocol-number' : 'protocol-text'}${groupStart(position) ? ' protocol-group-start' : ''}" data-protocol-column="${escape(column.id || column.key || column.header)}" aria-label="${escape(column.title || column.header)}" title="${escape(column.title || column.header)}"><span class="protocol-explain">${escape(column.header)}</span></th>`).join('');
    html += '</tr></thead><tbody>';
    data.forEach((entry, index) => {
        const flags = protocolRowFlags(entry, source), raw = protocolRowData(entry, source);
        const belowCar = Number.isFinite(options.caRThreshold) && Number.isFinite(raw.jahresentnahme_real) && raw.jahresentnahme_real < options.caRThreshold;
        html += `<tr class="${index % 2 === 0 ? 'even' : 'odd'}${flags.cut ? ' backtest-row-cut protocol-row-cut' : ''}${flags.care ? ' protocol-row-care' : ''}${flags.ruin ? ' backtest-row-ruin protocol-row-ruin' : ''}${belowCar ? ' below-car' : ''}">`;
        columns.forEach((column, position) => {
            const value = column.id ? readProtocolValue(column, entry, options) : undefined;
            const requested = typeof column.cellClass === 'function' ? column.cellClass(entry) : column.cellClass;
            const tradeClass = ['backtest-trade-sale', 'backtest-trade-buy'].includes(requested) ? requested : '';
            const numeric = column.align === 'right' ? ' protocol-number' : '';
            if (column.id === 'year') {
                const year = protocolYearPresentation(entry, index, options);
                html += `<td class="protocol-year">${escape(year.calendarYear ?? '—')}<small>${source === 'mc' ? `Simulationsjahr ${escape(year.simulationYear ?? '—')}` : ''}${year.ages ? `${source === 'mc' ? ' · ' : ''}Alter ${escape(year.ages)}` : ''}</small></td>`;
            } else if (column.format === 'person') {
                const state = protocolPersonPresentation(data, index, column, options);
                html += `<td class="protocol-person protocol-person-${state.tone}${groupStart(position) ? ' protocol-group-start' : ''}" title="${escape(state.title)}" aria-label="${escape(state.title)}"><span aria-hidden="true">${escape(state.text)}</span></td>`;
            } else {
                const formatted = options.formatValue ? options.formatValue(column, entry) : formatProtocolValue(column, value, entry, options);
                html += `<td class="${numeric.trim()}${tradeClass ? ` ${tradeClass}` : ''}${groupStart(position) ? ' protocol-group-start' : ''}">${escape(formatted)}${column.id === 'withdrawal' && belowCar ? chip('Niedrige Entnahme', 'cut', LOW_WITHDRAWAL_HINT) : ''}</td>`;
            }
        });
        html += '</tr>';
    });
    return `<table class="ds-table protocol-table"><caption>${escape(caption)}</caption>${html}</tbody></table>${renderProtocolLegend(options)}`;
}
