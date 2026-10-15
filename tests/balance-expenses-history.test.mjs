import {
    computeYearStats,
    prepareExpensesHistoryMetrics
} from '../app/balance/balance-expenses-metrics.js';
import { refreshBalanceExpensesHistory } from '../app/balance/balance-expenses-history-renderer.js';
import { loadExpensesStoreResult, EXPENSES_STORAGE_KEY } from '../app/balance/balance-expenses-storage.js';
import { UIUtils } from '../app/balance/balance-utils.js';

console.log('--- Jahresausgaben: lesende Projektion ---');

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

const importedMonth = categories => ({ profiles: { A: { categories } } });
const completeYear = {
    months: Object.fromEntries(Array.from({ length: 12 }, (_, index) =>
        [String(index + 1), importedMonth({ Ausgabe: -(index + 1) * 10 })]))
};
const mixedYear = { months: {
    '1': { profiles: {
        A: { categories: { Ausgabe: -100, Erstattung: 20 } },
        B: { categories: { Ausgabe: 30 } }
    } },
    '2': importedMonth({ Ausgabe: -50 }),
    '3': importedMonth({ Ausgabe: -10, Erstattung: 10 }),
    '0': importedMonth({ Ausgabe: -9999 }),
    '13': importedMonth({ Ausgabe: -9999 })
} };
const store = deepFreeze({ version: 1, activeYear: 2021, years: {
    '2028': { months: { '1': importedMonth({ Ausgabe: -80 }) } },
    '2026': mixedYear,
    '2025': completeYear,
    '2024': { months: { '6': importedMonth({ Ausgabe: -75 }) } },
    '2023': { months: { '1': importedMonth({ Ausgabe: 0 }), '2': importedMonth({}) } },
    '2022': { months: { '1': { profiles: {} }, '2': {} } },
    '2021': { months: {} },
    '2020': {},
    '2019': null,
    '2018': { months: [] },
    '2017': { months: { '13': importedMonth({ Ausgabe: -9999 }) } },
    '2016': { months: { '1': { profiles: { A: null, B: {} } } } },
    '2015': { months: { '1': { profiles: [] } } },
    '2014': { months: { '1': { profiles: { A: { categories: null } } } } },
    '2013': { months: { '1': null } },
    'kein-jahr': { months: { '1': importedMonth({ Ausgabe: -9999 }) } },
    '0': { months: { '1': importedMonth({ Ausgabe: -9999 }) } },
    '2026.5': { months: { '1': importedMonth({ Ausgabe: -9999 }) } }
} });
const before = JSON.stringify(store);
const descriptors = new Map(['localStorage', 'window', 'document'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let environmentReads = 0;

try {
    // Selbst ein Versuch, DOM oder Browserpersistenz zu lesen, lässt den Test scheitern.
    for (const key of descriptors.keys()) {
        Object.defineProperty(globalThis, key, { configurable: true, get() {
            environmentReads++;
            throw new Error(`Unerlaubter Umgebungszugriff: ${key}`);
        } });
    }

    const rows = prepareExpensesHistoryMetrics(store, 2026);
    const singleMonth = prepareExpensesHistoryMetrics(deepFreeze({ years: {
        '2026': { months: { '1': mixedYear.months['1'] } }
    } }), 2026)[0];
    assertEqual(singleMonth.annualUsed, 110, 'Profil A mit −100/20 und Profil B mit +30 ergeben exakt 110 Euro');
    assertEqual(singleMonth.monthsWithData, 1, 'Zwei importierte Profile desselben Monats zählen genau einen Datenmonat');
    assertEqual(singleMonth.avgMonthly, 110, 'Ein gemeinsamer Datenmonat ergibt exakt 110 Euro Durchschnitt');
    assertEqual(rows.map(row => row.year).join(','), '2023,2024,2025,2026,2028',
        'Nur importierte Jahre erscheinen chronologisch, unabhängig vom ausgewählten Leerjahr');
    for (const row of rows) {
        const stats = computeYearStats({ yearData: store.years[String(row.year)] });
        assertEqual(row.annualUsed, stats.annualUsed, `Jahr ${row.year}: gleiche Summe wie Ausgaben-Check`);
        assertEqual(row.monthsWithData, stats.monthsWithData, `Jahr ${row.year}: gleiche Datenmonate`);
        assertEqual(row.avgMonthly, stats.avgMonthly, `Jahr ${row.year}: gleicher Durchschnitt`);
        assertEqual(Object.keys(row).sort().join(','),
            'annualUsed,avgMonthly,isCurrentPartialYear,monthsWithData,year',
            'Zeilen enthalten ausschließlich Istwerte und Laufend-Markierung, keine Budgetwerte');
    }
    const partial = rows.find(row => row.year === 2026);
    assertEqual(partial.annualUsed, 160, '110 Euro aus zwei Profilen plus 50 Euro; ungültige Monate zählen nicht');
    assertEqual(partial.monthsWithData, 2, 'Mehrere Profile zählen je Monat einmal; Nullimport zählt nicht');
    assertEqual(partial.avgMonthly, 80, 'Durchschnitt verwendet nur Monate mit positiven Ausgaben');
    assertEqual(partial.isCurrentPartialYear, true, 'Aktuelles Teiljahr ist laufend');
    assertEqual(rows.find(row => row.year === 2024).isCurrentPartialYear, false,
        'Historisches Teiljahr ist nicht laufend');
    assertEqual(rows.find(row => row.year === 2028).isCurrentPartialYear, false,
        'Zukünftiges Teiljahr ist nicht laufend');
    const full = rows.find(row => row.year === 2025);
    assertEqual(full.annualUsed, 780, 'Alle zwölf Kalendermonate werden summiert');
    assertEqual(full.monthsWithData, 12, 'Volljahr zählt zwölf Monate');
    assertEqual(full.avgMonthly, 65, 'Volljahr hat den erwarteten Durchschnitt');
    const zero = rows.find(row => row.year === 2023);
    assertEqual(zero.annualUsed, 0, 'Nullimporte bleiben als Jahr mit Summe null sichtbar');
    assertEqual(zero.monthsWithData, 0, 'Nullimporte erzeugen keine Datenmonate');
    assertEqual(zero.avgMonthly, 0, 'Nullimporte haben einen endlichen Durchschnitt null');

    for (const activeYear of [2023, 2026, 2030]) {
        assertEqual(JSON.stringify(prepareExpensesHistoryMetrics({ ...store, activeYear }, 2026)),
            JSON.stringify(rows), 'Jahresauswahl beeinflusst weder Liste noch Laufend-Markierung');
    }
    const fullCurrent = prepareExpensesHistoryMetrics(store, 2025);
    assertEqual(fullCurrent.find(row => row.year === 2025).isCurrentPartialYear, false,
        'Aktuelles Jahr mit zwölf Datenmonaten ist nicht als laufendes Teiljahr markiert');
    assertEqual(fullCurrent.some(row => row.isCurrentPartialYear), false,
        'Kalenderjahrwechsel entfernt die alte Laufend-Markierung');
    assertEqual(prepareExpensesHistoryMetrics(store, 2023).find(row => row.year === 2023).isCurrentPartialYear,
        true, 'Aktuelles Nullimportjahr ist ein laufendes Teiljahr');

    for (const empty of [undefined, null, {}, { years: {} }, { years: [] }, { years: null },
        { years: { '2026': { months: { '1': { profiles: {} } } } } }]) {
        assertEqual(prepareExpensesHistoryMetrics(deepFreeze(empty), 2026).length, 0,
            'Fehlende oder rein leere Container ergeben keine Jahreszeilen');
    }

    assertEqual(JSON.stringify(store), before, 'Tief eingefrorener Store bleibt vollständig unverändert');
    // Ausgabeobjekte haben keine Referenzen auf den Store und keine versteckten Ausgabecaches.
    rows[0].annualUsed = 999;
    rows.reverse();
    const repeated = prepareExpensesHistoryMetrics(store, 2026);
    assertEqual(repeated[0].year, 2023, 'Veränderte Ausgabereihenfolge beeinflusst Folgeaufrufe nicht');
    assertEqual(repeated[0].annualUsed, 0, 'Veränderte Ausgabeobjekte beeinflussen Eingaben nicht');
    assertEqual(JSON.stringify(store), before, 'Auch nach Ausgabeänderungen bleiben Eingaben unverändert');
    assertEqual(environmentReads, 0, 'Projektion benötigt weder DOM noch Speicherzugriffe');
} finally {
    for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
}

console.log('--- Jahresausgaben: Projektion geprüft ---');

console.log('--- Jahresausgaben: aktive lesende Darstellung ---');
let active = false, generated = 0, reads = 0, writes = 0;
const display = { panel: { classList: { contains: name => name === 'active' && active } }, hint: { textContent: '' } };
for (const key of ['chart', 'table']) {
    let markup = 'veraltet';
    display[key] = {
        get innerHTML() { return markup; },
        set innerHTML(value) {
            if (value) generated++;
            assert(active || value === '', 'Inaktiv keinerlei Markuperzeugung');
            markup = value;
        }
    };
}
const fixture = deepFreeze({ version: 1, activeYear: 2020, years: {
    '2023': { months: { '1': importedMonth({ Ausgabe: 0 }) } },
    '2024': { months: { '1': importedMonth({ Ausgabe: -1234.56 }) } },
    '2025': completeYear,
    '2026': { months: { '1': mixedYear.months['1'], '2': importedMonth({ Ausgabe: -50 }) } },
    '2027': { months: {} },
    '2028': { months: { '1': importedMonth({ Ausgabe: -80 }) } }
} });
const fixtureBefore = JSON.stringify(fixture);
let raw = JSON.stringify(fixture);
const storage = {
    getItem(key) { assertEqual(key, EXPENSES_STORAGE_KEY, 'Nur Ausgabenstore wird gelesen'); reads++; return raw; },
    setItem() { writes++; throw new Error('Unerlaubter Write'); }
};
const options = { storage, now: () => new Date(2026, 9, 3), getPersistenceStatus: () => ({ backend: 'Test-Backend' }) };
for (let i = 0; i < 4; i++) refreshBalanceExpensesHistory(display, options);
assertEqual(generated, 0, 'Gefüllter Store zeichnet vor erster Aktivierung nie');
active = true;
assert(refreshBalanceExpensesHistory(display, options), 'Aktivierung liest und zeichnet gültige Daten');
assertEqual(reads, 5, 'Aktivierung verwendet einen frischen Store');
const expectedRows = prepareExpensesHistoryMetrics(fixture, 2026);
assertEqual(expectedRows.map(row => row.year).join(','), '2023,2024,2025,2026,2028',
    'Renderer-Datenbasis enthält das importierte zukünftige Jahr, aber kein leeres Auswahljahr');
assertEqual((display.table.innerHTML.match(/<tr>/g) || []).length, expectedRows.length + 1, 'Genau eine Tabellenzeile je importiertem Jahr');
assert(display.table.innerHTML.includes('<caption class="balance-table-caption">') && display.table.innerHTML.includes('scope="row"')
    && display.table.innerHTML.includes('scope="col"'), 'Gleichwertige semantische Tabelle');
for (const row of expectedRows) {
    const tableRow = display.table.innerHTML.match(new RegExp(`<tr><th scope="row">${row.year}[^]*?</tr>`))?.[0] || '';
    const chartTitle = display.chart.innerHTML.match(new RegExp(`<g><title>${row.year}[^]*?</title>`))?.[0] || '';
    for (const value of [row.annualUsed, row.avgMonthly]) {
        assert(tableRow.includes(UIUtils.formatBalanceCurrency(value)), `${row.year}: Tabelle enthält Slice-1-Wert ${value}`);
        assert(chartTitle.includes(UIUtils.formatBalanceCurrency(value)), `${row.year}: SVG enthält Slice-1-Wert ${value}`);
    }
    assert(tableRow.includes(`<td>${row.monthsWithData}</td>`) && chartTitle.includes(`${row.monthsWithData} Monate mit Daten`),
        `${row.year}: gleiche Datenmonate in Tabelle und Diagramm`);
}
assert(display.chart.innerHTML.includes('2026 – laufendes Teiljahr') && display.table.innerHTML.includes('2026</th><td>laufendes Teiljahr'), 'Laufendes Teiljahr ist textlich markiert');
function assertRenderedYearStatus(year, status, barClass) {
    const tableRow = display.table.innerHTML.match(new RegExp(`<tr><th scope="row">${year}</th>[^]*?</tr>`))?.[0] || '';
    const group = display.chart.innerHTML.match(new RegExp(`<g><title>${year}[^]*?</g>`))?.[0] || '';
    assert(tableRow.includes(`<td>${status}</td>`), `${year}: isolierte Tabellenzeile hat Status ${status}`);
    assert(group.includes(status), `${year}: isolierte SVG-Gruppe kennzeichnet ${status}`);
    const classes = group.match(/<rect class="([^"]+)"/)?.[1].split(/\s+/).filter(Boolean) || [];
    assertEqual(classes.join(','), ['expenses-year-bar', barClass].filter(Boolean).join(','),
        `${year}: Säule besitzt ausschließlich die erwarteten Kalenderklassen`);
    if (status !== 'abgeschlossenes Kalenderjahr') {
        assert(!tableRow.includes('abgeschlossenes Kalenderjahr') && !group.includes('abgeschlossenes Kalenderjahr'),
            `${year}: weder Tabelle noch SVG kennzeichnen das Jahr als abgeschlossen`);
    }
}
assertRenderedYearStatus(2028, 'zukünftiges Jahr', '');
assertRenderedYearStatus(2024, 'abgeschlossenes Kalenderjahr', 'expenses-year-complete');
assertRenderedYearStatus(2026, 'laufendes Teiljahr', 'expenses-year-current');
for (const [currentYear, checks] of [
    [2025, [[2025, 'laufendes Jahr', 'expenses-year-current'], [2028, 'zukünftiges Jahr', '']]],
    [2024, [[2025, 'zukünftiges Jahr', '']]],
    [2028, [[2028, 'laufendes Teiljahr', 'expenses-year-current'],
        [2026, 'abgeschlossenes Kalenderjahr', 'expenses-year-complete']]]
]) {
    assert(refreshBalanceExpensesHistory(display, { ...options, now: () => new Date(currentYear, 9, 3) }),
        `Uhr im Jahr ${currentYear}: unveränderte Datenbasis wird neu dargestellt`);
    for (const [year, status, barClass] of checks) assertRenderedYearStatus(year, status, barClass);
    const metrics = prepareExpensesHistoryMetrics(fixture, currentYear);
    const renderedYears = [...display.table.innerHTML.matchAll(/<th scope="row">(\d+)<\/th>/g)].map(match => Number(match[1]));
    assertEqual(renderedYears.join(','), metrics.map(row => row.year).join(','),
        `Uhr im Jahr ${currentYear}: Jahresliste bleibt erhalten`);
    for (const row of metrics) {
        const tableRow = display.table.innerHTML.match(new RegExp(`<tr><th scope="row">${row.year}</th>[^]*?</tr>`))?.[0] || '';
        assert(tableRow.endsWith(`<td>${UIUtils.formatBalanceCurrency(row.annualUsed)}</td><td>${row.monthsWithData}</td><td>${UIUtils.formatBalanceCurrency(row.avgMonthly)}</td></tr>`),
            `${row.year}: Summe, Datenmonate und Durchschnitt bleiben beim Uhrwechsel erhalten`);
    }
}
assert(refreshBalanceExpensesHistory(display, { ...options, loadStore: () => ({ status: 'ok', store: fixture }) }),
    'Öffentliche Refresh-Funktion kann den tief eingefrorenen Store direkt lesen');
assertEqual(raw, fixtureBefore, 'Uhrwechsel verändern den gespeicherten Store nicht');
assertEqual(JSON.stringify(fixture), fixtureBefore, 'Uhrwechsel verändern die eingefrorene Fixture nicht');
assertEqual(writes, 0, 'Auch Status- und Uhrwechsel schreiben nichts');
refreshBalanceExpensesHistory(display, options);
assert(!display.table.innerHTML.includes('Budget') && !display.table.innerHTML.includes('Abweichung'), 'Keine historischen Budget- oder Abweichungsspalten');
const svg = display.chart.innerHTML;
assert(svg.includes('height="270"') && /viewBox="0 0 (\d+) 270" width="\1"/.test(svg), 'Jahresausgaben verwenden identische Pixel- und viewBox-Breiten');
assert(svg.includes('role="img" aria-labelledby="expensesChartTitle" aria-describedby="expensesChartDesc"'), 'Getrennter SVG-Name und Beschreibung');
assertEqual((svg.match(/id="expensesChartTitle"/g) || []).length, 1, 'Eindeutiger SVG-Titel');
assertEqual((svg.match(/id="expensesChartDesc"/g) || []).length, 1, 'Eindeutige SVG-Beschreibung');
for (const text of ['Ø pro Monat', 'Nullimporte', 'Historische Jahresbudgets', 'aller gespeicherten Profile']) {
    assert(svg.includes(text), `Vollständige Beschreibung erläutert ${text}`);
}
active = false;
refreshBalanceExpensesHistory(display, options);
assertEqual(display.chart.innerHTML + display.table.innerHTML + display.hint.textContent, '', 'Verlassen entfernt sämtliche dynamischen Inhalte');
const beforeInactive = generated;
raw = JSON.stringify({ version: 1, activeYear: 2030, years: { '2026': { months: { '1': importedMonth({ Ausgabe: -500 }) } } } });
refreshBalanceExpensesHistory(display, options);
assertEqual(generated, beforeInactive, 'Auch Datenänderung inaktiv zeichnet nichts');
active = true;
refreshBalanceExpensesHistory(display, options);
assert(display.table.innerHTML.includes(UIUtils.formatBalanceCurrency(500)) && !display.table.innerHTML.includes('2024'), 'Wiederöffnung ersetzt die Datenbasis vollständig');
for (const invalid of ['{private-finanzrohdaten', JSON.stringify({ years: [] }), JSON.stringify({ years: { '2026': { months: [] } } }),
    JSON.stringify({ years: { '2026': { months: { '1': { profiles: [] } } } } }),
    JSON.stringify({ years: { '2026': { months: { '1': importedMonth({ privat: 'secret' }) } } } })]) {
    raw = invalid;
    assert(!refreshBalanceExpensesHistory(display, options), 'Beschädigte Wurzel oder Untercontainer führen zu Hinweis');
    assertEqual(display.chart.innerHTML + display.table.innerHTML, '', 'Fehler entfernt alte Jahreswerte');
    assert(display.hint.textContent.includes('Test-Backend') && display.hint.textContent.includes('Recovery im Ausgaben-Check'), 'Diagnose nennt Backend und sicheren Recoveryweg');
    assert(!display.hint.textContent.includes('private-finanzrohdaten') && !display.hint.textContent.includes('secret'), 'Keine Rohdaten in der Diagnose');
}
assert(!refreshBalanceExpensesHistory(display, { ...options, loadStore() { throw new Error('privater Inhalt'); } }), 'Ladefehler wird abgefangen');
assert(!display.hint.textContent.includes('privater Inhalt'), 'Auch Ausnahmeinhalt wird nicht offengelegt');
for (const empty of [null, JSON.stringify({ version: 1, years: { '2026': { months: {} } } })]) {
    raw = empty;
    assert(refreshBalanceExpensesHistory(display, options), 'Fehlender oder leerer Store gültig');
    assertEqual(display.hint.textContent, 'Noch keine Ausgabendaten vorhanden.', 'Verständlicher Leerhinweis');
    assertEqual(display.chart.innerHTML + display.table.innerHTML, '', 'Leerzustand entfernt Fehler und Werte');
}
raw = JSON.stringify({ years: { '2025': { months: { '1': importedMonth({ Ausgabe: -1 }) } },
    '2026': { months: { '1': importedMonth({ Ausgabe: -1e300 }) } } } });
assert(refreshBalanceExpensesHistory(display, options), 'Sehr großer endlicher Betrag darstellbar');
const coordinates = [...display.chart.innerHTML.matchAll(/\s(?:x|y|width|height|x1|x2|y1|y2)="([^"]+)"/g)];
assert(coordinates.length > 0 && coordinates.every(match => Number.isFinite(Number(match[1]))), 'SVG-Koordinaten bleiben endlich');
assert([...display.chart.innerHTML.matchAll(/<rect[^>]*width="([^"]+)"/g)].every(match => Number(match[1]) <= 64),
    'Jahresvergleich begrenzt die Balkenbreite auch bei wenigen Jahren');
assertEqual(writes, 0, 'Aktive/inaktive Darstellung, Leer- und Fehlerzustände schreiben nie');
assertEqual(JSON.stringify(fixture), JSON.stringify(loadExpensesStoreResult({ getItem: () => JSON.stringify(fixture) }).store), 'Darstellung verändert eingefrorene Eingabedaten nicht');

raw = JSON.stringify({ years: { '2025': { months: { '1': importedMonth({ Ausgabe: -1234.56 }) } },
    '2026': { months: { '1': importedMonth({ Ausgabe: 0 }) } } } });
assert(refreshBalanceExpensesHistory(display, options), 'Centwerte und Nullimportjahr renderbar');
assertEqual((display.table.innerHTML.match(/<th scope="col">/g) || []).length, 5, 'Jahr und Status sind getrennte Spalten');
assert(display.table.innerHTML.includes('1.235 €') && !display.chart.innerHTML.includes('1.234,56'), 'Tabelle und SVG-Titel zeigen ganze Euro');
assert(display.chart.innerHTML.includes('expenses-year-complete') && display.chart.innerHTML.includes('expenses-year-current'), 'Kalenderjahr steuert die Säulentönung');
assert(!display.chart.innerHTML.includes('wealth-grid') && !display.chart.innerHTML.includes('Euro (€)</text>'), 'Schlichte Säulen ohne y-Achse oder Raster');

for (const mixed of [false, true]) {
    const examples = { version: 1, years: { '2026': { months: {
        '1': { profiles: { A: { categories: { Wohnen: -100 }, source: 'probelauf-example' } } },
        ...(mixed ? { '2': importedMonth({ Echt: -50 }) } : {})
    } } } };
    raw = JSON.stringify(examples);
    const oracle = prepareExpensesHistoryMetrics(examples, 2026);
    refreshBalanceExpensesHistory(display, options);
    assert(display.table.innerHTML.includes('Beispieldaten (Spielbereich)') && display.chart.innerHTML.includes('Beispieldaten (Spielbereich)'), 'Herkunft bleibt nach Speicherreload in Tabelle und Diagrammbeschreibung sichtbar');
    assertEqual(display.table.innerHTML.includes('gemischte Herkunft'), mixed, 'Gemischtes Jahr wird separat ausgewiesen');
    assertEqual(oracle[0].annualUsed, mixed ? 150 : 100, 'Herkunft ändert Rechenorakel nicht');
}
raw = JSON.stringify({ version: 1, years: { '2026': { months: { '1': importedMonth({ Echt: -100 }) } } } });
refreshBalanceExpensesHistory(display, options);
assert(!display.table.innerHTML.includes('Beispieldaten'), 'Altbestand und echte CSV bleiben ohne Beispielkennzeichen');

const standalone = { ...display, panel: null, isVisible: () => true };
assert(refreshBalanceExpensesHistory(standalone, options), 'Eigenständige Seite rendert ohne aktives Balancepanel');
assert(standalone.table.innerHTML.includes('2026'), 'Eigenständiger Jahresvergleich enthält historische Werte');
assert(standalone.chart.innerHTML.includes('expenses-year-summary') && !standalone.chart.innerHTML.includes('<svg'),
    'Ein importiertes Jahr erscheint als kompakte Zusammenfassung ohne Diagramm');
assert(standalone.chart.innerHTML.includes('laufendes Teiljahr') && standalone.chart.innerHTML.includes(UIUtils.formatBalanceCurrency(100)),
    'Jahreszusammenfassung erhält Status und Istbetrag');
raw = JSON.stringify({ version: 1, years: { '2026': { months: { '1': importedMonth({ Nullimport: 0 }) } }, '2027': { months: {} } } });
assert(refreshBalanceExpensesHistory(standalone, options), 'Ein Nullimportjahr neben einem Leerjahr ist darstellbar');
assert(standalone.chart.innerHTML.includes('expenses-year-summary') && !standalone.chart.innerHTML.includes('<svg')
    && standalone.chart.innerHTML.includes('<b>0</b>'), 'Nullimportjahr bleibt als Zusammenfassung mit null positiven Datenmonaten sichtbar');
raw = '{synthetic-corrupt';
assert(!refreshBalanceExpensesHistory(standalone, options), 'Eigenständiger Jahresvergleich meldet beschädigte Daten');
assertEqual(standalone.chart.innerHTML + standalone.table.innerHTML, '', 'Eigenständige Recovery entfernt veraltete Diagramm- und Tabellenwerte');
