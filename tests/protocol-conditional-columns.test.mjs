import { PROTOCOL_COLUMNS, getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { renderWorstRunLog } from '../app/simulator/simulator-results.js';
import { buildAccessibleBacktestTableHtml } from '../app/simulator/historical-backtest-ui.js';
import { buildBacktestColumnDefinitions, formatColumnValue, prepareRowsForExport } from '../app/simulator/simulator-main-helpers.js';
import { projectScenarioLogV2 } from '../app/simulator/monte-carlo-export.js';

const heads = html => [...html.matchAll(/data-protocol-column="([^"]+)"/g)].map(match => match[1]);
const extras = new Set(['widow-income-offset', 'zufluss']);
const raw = Object.freeze({ jahr: 1, histJahr: 2000, recordType: 'financial_year', financiallyEvaluable: true,
    entscheidung: Object.freeze({ jahresEntnahme: 12000 }), renteSum: 6000, portfolio_total_end: 123000,
    inflation_factor_cum: 1, inflation: 0 });

for (const source of ['mc', 'backtest']) for (const logDetailLevel of ['normal', 'detailed']) {
    for (const zufluss of [0, 50000]) for (const WidowIncomeOffset of [0, 1200]) {
        const label = `${source}/${logDetailLevel}/${zufluss}/${WidowIncomeOffset}`;
        // Normal und Backtest zeigen Zusatzfelder erst bei Beträgen, MC detailliert immer.
        const data = [raw, Object.freeze({ ...raw, jahr: 2, zufluss, WidowIncomeOffset })];
        const rows = Object.freeze(source === 'backtest' ? data.map(row => Object.freeze({ jahr: 2025 + row.jahr, entscheidung: row.entscheidung, row })) : data);
        const before = JSON.stringify(rows);
        const options = { source, logDetailLevel, rows, startYear: 2026 };
        const expected = ['income-total', 'expense-total', ...(logDetailLevel === 'detailed'
            ? ['withdrawal', 'rentesum', 'rente1', 'rente2', 'other-income', 'zufluss', 'planned-expenses', 'income-saved', 'widow-income-offset'] : [])];
        const columns = getProtocolColumns(options);
        assertEqual(columns.filter(column => column.group === 'withdrawal').slice(0, expected.length).map(column => column.id).join(','), expected.join(','), `${label}: Katalog sortiert Entnahme, Renten, Rentenanrechnung, Zufluss`);
        const variants = [
            ['Katalog', undefined],
            ['Aufruf ohne Zusatzspalten', columns.filter(column => !extras.has(column.id))],
            ['Umgestellte Spalten', [...columns].reverse()],
            ['Legacy-Spalten', [...columns.filter(column => column.legacyHeader && !extras.has(column.id)).map(column => ({ header: column.legacyHeader, key: column.key, valueFormatter: column.valueFormatter })).reverse(),
                { header: 'Zufluss', group: 'wealth' }, { header: 'Rentenanrechnung', group: 'withdrawal' }]]
        ];
        for (const [name, requested] of variants) {
            const context = { ...options, columns: requested };
            const html = source === 'backtest' && requested
                ? buildAccessibleBacktestTableHtml(rows, requested, formatColumnValue, context)
                : source === 'mc' ? renderWorstRunLog(rows, undefined, context) : renderProtocolTable(rows, context);
            const ids = heads(html);
            const withdrawal = ids.indexOf('income-total');
            assertEqual(ids.slice(withdrawal, withdrawal + expected.length).join(','), expected.join(','), `${label}/${name}: gemeinsamer Entnahmeblock in der richtigen Reihenfolge`);
            for (const id of extras) assertEqual(ids.filter(value => value === id).length, expected.includes(id) ? 1 : 0, `${label}/${name}: ${id} nur einmal und nur bei Beträgen`);
            const groupRow = html.match(/<tr class="protocol-group-head">([\s\S]*?)<\/tr>/)[1];
            const groups = [...groupRow.matchAll(/<th\b[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
            assertEqual(groups.filter(group => group === 'Einnahmen und Ausgaben').length, 1, `${label}/${name}: genau ein Block Einnahmen und Ausgaben`);
            assertEqual(new Set(groups).size, groups.length, `${label}/${name}: keine wiederholten Gruppen`);
            const resolved = getProtocolColumns(context);
            assertEqual(resolved.map(column => column.id || column.header).join(','), ids.join(','), `${label}/${name}: Anzeige und Spaltenliste stimmen überein`);
        }
        // Die alten Anzeigeexporter übernehmen die fertige Spaltenliste in beiden Formaten.
        const exportColumns = source === 'backtest' ? buildBacktestColumnDefinitions(logDetailLevel, { ...options, display: true }) : columns;
        const headers = exportColumns.map(column => column.exportHeader || column.header);
        assertEqual(Object.keys(JSON.parse(JSON.stringify(prepareRowsForExport(rows, exportColumns)))[0]).join(','), headers.join(','), `${label}: JSON folgt den Anzeigespalten`);
        assertEqual(JSON.stringify(rows), before, `${label}: Jahresdaten bleiben bytegleich`);
        if (source === 'mc') {
            const replayRows = projectScenarioLogV2(rows).records;
            assertEqual(heads(renderWorstRunLog(replayRows, undefined, options)).join(','), columns.map(column => column.id).join(','), `${label}: Replay-Szenariolog verwendet dieselbe Spaltenfolge`);
        }
    }
    const options = { source, logDetailLevel, inputs: { plannedInflows: [{ year: 2040, amount: 1 }] } };
    const entry = row => source === 'backtest' ? { jahr: 2026, row } : row;
    const absent = renderProtocolTable([entry(raw)], options);
    for (const value of [0, undefined, null, NaN, Infinity]) {
        const html = renderProtocolTable([entry({ ...raw, zufluss: value, WidowIncomeOffset: value })], options);
        if (logDetailLevel === 'detailed' || value === 0 || value == null || !Number.isFinite(value)) {
            assertEqual(heads(html).join(','), heads(absent).join(','), 'MC detailliert erhält alle Anzeigefelder unabhängig von fehlenden Beträgen');
        } else {
            assertEqual(html, absent, `${source}/${logDetailLevel}: ohne gebuchte Beträge bleibt die Ausgabe bytegleich`);
        }
    }
}
assertEqual(PROTOCOL_COLUMNS.find(column => column.id === 'zufluss').group, 'withdrawal', 'Einnahmen und Ausgaben mit vollständiger Detailansicht');
