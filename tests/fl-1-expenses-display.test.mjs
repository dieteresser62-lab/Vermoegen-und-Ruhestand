import { prepareExpensesHistoryMetrics } from '../app/balance/balance-expenses-metrics.js';
import { renderExpensesDetails } from '../app/balance/balance-expenses-renderer.js';
import { refreshBalanceExpensesHistory } from '../app/balance/balance-expenses-history-renderer.js';
import { renderExpenseNeeds } from '../app/expenses/expenses-needs-renderer.js';
import { projectExpenses } from '../app/expenses/expenses-model.js';
import { renderExpensesPage } from '../app/expenses/expenses-renderer.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import fs from 'node:fs';
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const split = { categories: { Wohnen: -200, Alltag: -100, Erstattung: 20 }, categoryNeeds: {
    Wohnen: { floor: -200, flex: 0 }, Alltag: { floor: -40, flex: -60 }, Erstattung: { floor: 0, flex: 20 }
}, plannedExpenses: [{ id: 'p', scopeKey: 'household:a', month: '2026-01', label: 'Muster', amount: 50 }] };
const plain = { categories: { Alt: -100 } }, invalid = { ...plain, categoryNeeds: { Alt: { floor: -20, flex: -20 } } };
const store = { version: 1, years: { 2025: { months: { 1: { profiles: { a: plain } } } }, 2026: { months: {
    1: { profiles: { a: split } }, 2: { profiles: { a: invalid } }, 3: { profiles: { a: plain } } } } } };
const before = JSON.stringify(store);
const rows = prepareExpensesHistoryMetrics(store, 2026, { includeSegments: true });
assertEqual(JSON.stringify(rows[0].segments), JSON.stringify({ floor: 0, flex: 0, unallocated: 100 }), 'FL-1: Altjahr ist vollständig grau');
assertEqual(JSON.stringify(rows[1].segments), JSON.stringify({ floor: 240, flex: 40, unallocated: 200 }), 'FL-1: Jahressegmente ohne Zahlungsabzug; nicht lesbare Aufteilung grau');
for (const row of rows) assertEqual(Object.values(row.segments).reduce((a, b) => a + b, 0), row.annualUsed, 'FL-1: Summe der Jahressegmente gleich Jahressumme');
assert(prepareExpensesHistoryMetrics(store, 2026).every(row => !Object.hasOwn(row, 'segments')), 'FL-1: Personenprojektion ohne Segmente');
const { doc } = createDialogFixture();
const add = (tag, id) => { const node = doc.createElement(tag); node.id = id; doc.body.append(node); return node; };
const refs = { detailDialog: add('dialog', 'detail'), detailTitle: add('h2', 'title'), detailBody: add('div', 'body') };
for (const [entry, hint, columns] of [[split, 'Importiert mit Spalte „Bedarf“', 4], [plain, 'ohne Aufteilung importiert', 2], [invalid, 'Aufteilung nicht lesbar', 2]]) {
    renderExpensesDetails({ refs, monthName: 'Januar', profileName: 'Max', ...entry, doc });
    assert(text(refs.detailBody).includes(hint), 'FL-1: Lupe benennt den Importzustand');
    const table = refs.detailBody.querySelector('table');
    assertEqual(table.querySelector('thead').children[0].children.length, columns, 'FL-1: Lupe zeigt passende Spaltenzahl');
    assertEqual(table.querySelector('tbody').children[0].children[0].textContent, columns === 4 ? 'Wohnen' : 'Alt', 'FL-1: Lupe sortiert weiterhin nach Betrag');
    if (columns === 4) {
        assertEqual(table.querySelector('tbody').children[0].children[2].textContent, '—', 'FL-1: Leerer Anteil ist ein Strich');
        assertEqual(table.querySelector('tfoot').children[0].children.length, 4, 'FL-1: Aufgeteilte Lupe enthält Summenzeile');
        assert(text(table.querySelector('tfoot')).includes('280,00 €'), 'FL-1: Lupe zeigt Nettoausgaben einschließlich geplanter Zahlung positiv');
    } else assert(!table.querySelector('tfoot'), 'FL-1: Lupe ohne Aufteilung behält Zweispaltentabelle');
}
const cents = { categories: { Wohnen: -1250, Alltag: -1250 }, categoryNeeds: {
    Wohnen: { floor: -1100.50, flex: -149.50 }, Alltag: { floor: -224.50, flex: -1025.50 }
} };
renderExpensesDetails({ refs, monthName: 'September', profileName: 'Max', ...cents, doc });
const centsTable = refs.detailBody.querySelector('table');
const cells = row => row.children.slice(1).map(cell => cell.textContent);
assertEqual(JSON.stringify(cells(centsTable.querySelector('tbody').children[0])), JSON.stringify(['1.100,50 €', '149,50 €', '1.250,00 €']), 'FL-2c: Lupe zeigt gespeicherte Ausgaben positiv mit Cent');
assertEqual(JSON.stringify(cells(centsTable.querySelector('tfoot').children[0])), JSON.stringify(['1.325,00 €', '1.175,00 €', '2.500,00 €']), 'FL-2c: Summenzeile zeigt Ausgaben positiv mit Cent');
const displayedAmount = value => Number(value.replace(/[. €]/g, '').replace('−', '-').replace(',', '.'));
const assertVisibleSums = table => {
    const bodyRows = table.querySelector('tbody').children;
    const footer = table.querySelector('tfoot').children[0];
    for (const row of [...bodyRows, footer]) {
        const [floor, flex, total] = cells(row).map(value => value === '—' ? 0 : displayedAmount(value));
        assertEqual(floor + flex, total, 'FL-2c: Sichtbare Floor- und Flexbeträge ergeben die sichtbare Summe');
    }
    for (let column = 0; column < 3; column++) {
        const sum = bodyRows.reduce((total, row) => total + (cells(row)[column] === '—' ? 0 : displayedAmount(cells(row)[column])), 0);
        assertEqual(sum, displayedAmount(cells(footer)[column]), 'FL-2c: Sichtbare Spaltensumme entspricht der Summenzeile');
    }
};
assertVisibleSums(centsTable);
const mixed = { categories: { Wohnen: -1000.50, Erstattung: 25.50 }, categoryNeeds: {
    Wohnen: { floor: -1100.50, flex: 100 }, Erstattung: { floor: 0, flex: 25.50 }
}, plannedExpenses: [{ label: 'Muster', amount: 50.50 }] };
const mixedBefore = JSON.stringify(mixed);
renderExpensesDetails({ refs, monthName: 'September', profileName: 'Max', ...mixed, doc });
const mixedTable = refs.detailBody.querySelector('table');
assertEqual(JSON.stringify(cells(mixedTable.querySelector('tbody').children[0])), JSON.stringify(['1.100,50 €', '−100,00 €', '1.000,50 €']), 'FL-2c: Erstattungsanteil bleibt negativ in einer Ausgabenkategorie');
assertEqual(JSON.stringify(cells(mixedTable.querySelector('tbody').children[1])), JSON.stringify(['—', '−25,50 €', '−25,50 €']), 'FL-2c: Erstattungskategorie negativ, leerer Anteil bleibt Strich');
assertEqual(JSON.stringify(cells(mixedTable.querySelector('tfoot').children[0])), JSON.stringify(['1.100,50 €', '−125,50 €', '975,00 €']), 'FL-2c: Summenzeile saldiert Ausgaben und Erstattungen');
assertVisibleSums(mixedTable);
assert(text(refs.detailBody).includes('Geplante Ausgabe bezahlt: Muster · 50,50 € · außerhalb des Monatsbudgets'), 'FL-2c: Bezahlte geplante Ausgabe bleibt positiv mit Cent');
assertEqual(JSON.stringify(mixed), mixedBefore, 'FL-2c: Lupe erhält signierte Quelldaten bytegleich');
renderExpensesDetails({ refs, monthName: 'September', profileName: 'Max', categories: { Wohnen: -100.50 }, categoryNeeds: { Wohnen: { floor: -100.50, flex: 0 } }, doc });
assertEqual(cells(refs.detailBody.querySelector('tfoot').children[0])[1], '0,00 €', 'FL-2c: Nullsumme ohne negatives Nullzeichen');
for (const categoryNeeds of [undefined, { Alt: { floor: -20, flex: -20 } }]) {
    renderExpensesDetails({ refs, monthName: 'September', profileName: 'Max', categories: { Alt: -100.50 }, categoryNeeds, doc });
    assertEqual(refs.detailBody.querySelector('tbody').children[0].children[1].textContent, '100,50 €', 'FL-2c: Lupe auch ohne lesbare Aufteilung positiv mit Cent');
}
const card = add('section', 'expensesNeeds');
const args = { store, year: 2026, people: [{ id: 'a', name: 'Max' }], needsPlan: { floorBedarf: 1200, flexBedarf: 1200 }, budget: { monthly: 200, status: 'adopted' }, now: new Date(2026, 9, 30) };
const view = projectExpenses(args);
renderExpenseNeeds(doc, view, true);
let details = doc.getElementById('expensesNeedsMonths');
assert(details.parent === card && !details.open, 'FL-1: Monatstabelle unten in Floor/Flex und beim Laden zu');
const tableRows = details.querySelector('tbody').children;
assertEqual(tableRows.length, 5, 'FL-1: Nur drei Datenmonate sowie Mittelwert und Plan');
assertEqual(tableRows[1].children[1].colSpan, 4, 'FL-1: Monat ohne lesbare Aufteilung als einzelne Hinweiszeile');
assert(text(tableRows[1]).includes('zählt nur im Gesamt'), 'FL-1: Hinweiszeile erklärt fehlende Aufteilung');
assert(text(tableRows[0]).includes('+130') && text(tableRows[0]).includes('−100'), 'FL-1: Gegen Plan zeigt plus und echtes Minus nach Zahlungsabzug');
assert(text(tableRows[3]).includes('+130') && text(tableRows[4]).includes('100'), 'FL-1: Mittelwert mit Abweichung und Plan je Monat');
assert(text(card).includes('aus 1 Monat mit Aufteilung') && text(card).includes('2 Monate ohne Aufteilung'), 'FL-1: Kopf mit Einzahl und Mehrzahl');
assert(text(card).includes('unter Flex 2026'), 'FL-1: Flexabweichung nennt Bezugsjahr');
details.open = true; renderExpenseNeeds(doc, view, true);
assert(!doc.getElementById('expensesNeedsMonths').open, 'FL-1: Neu geladene Klappe speichert keinen Zustand');
const chart = add('div', 'chart'), historyTable = add('div', 'historyTable'), hint = add('p', 'hint'), legend = add('div', 'legend');
chart.clientWidth = 1100;
const history = { chart, table: historyTable, hint, legend, isVisible: () => true, showNeedsSegments: true };
const refreshHistory = () => refreshBalanceExpensesHistory(history, { loadStore: () => ({ status: 'ok', store }), now: () => args.now, forecast: { year: 2026, amount: 1720 } });
assert(refreshHistory(), 'FL-1: Gestapeltes Jahresdiagramm renderbar');
assert(chart.innerHTML.includes('expenses-year-floor') && chart.innerHTML.includes('expenses-year-flex') && chart.innerHTML.includes('expenses-year-unallocated') && chart.innerHTML.includes('expenses-year-forecast'), 'FL-1: Säulen zeigen Aufteilung und bisherige Prognose');
assert(text(legend).includes('Prognose bis Jahresende') && !legend.hidden, 'FL-1: Jahreslegende mit vier Farbkästchen');
const unchangedTable = historyTable.innerHTML;
history.showNeedsSegments = false; refreshHistory();
assert(!chart.innerHTML.includes('expenses-year-floor') && legend.hidden, 'FL-1: Personenansicht mit bisherigen Säulen ohne Legende');
assertEqual(historyTable.innerHTML, unchangedTable, 'FL-1: Jahrestabelle unverändert');
const html = fs.readFileSync(new URL('../Ausgaben.html', import.meta.url), 'utf8');
assert(html.indexOf('class="expenses-grid"') < html.indexOf('id="expensesNeeds"') && html.indexOf('id="expensesNeeds"') < html.indexOf('id="expensesHistoryTitle"'), 'FL-1: Reihenfolge Monate/Wofür, Floor/Flex, Jahresvergleich');
for (const id of ['expensesCategories', 'expensesCategoriesLegend', 'expensesCategoriesNeeds', 'overviewFocus', 'expensesClose', 'expensesForecastNote', 'expensesForecastDeviation']) add('div', id);
const forecastTile = add('div', 'forecastTile'), forecast = doc.createElement('strong'); forecast.id = 'expensesForecast';
Object.defineProperty(forecast, 'parentElement', { get: () => forecastTile }); forecastTile.append(forecast);
const create = doc.createElement; doc.createElement = tag => { const node = create(tag); node.style = {}; return node; };
renderExpensesPage(doc, { ...view, personId: 'a' });
assertEqual(doc.getElementById('expensesForecastNote').textContent, `Mittelwert aus ${view.stats.monthsWithData} positiven Ausgabenmonaten × 12`, 'FL-2: Personenhochrechnung nennt denselben Mittelwert');
renderExpensesPage(doc, view);
assertEqual(forecastTile.dataset.tone, '', 'FL-1: Hochrechnung unter Budget ohne Warnfärbung');
assert(text(doc.getElementById('expensesForecastDeviation')).includes('−'), 'FL-1: Hochrechnung nennt signierte Budgetabweichung');
renderExpensesPage(doc, { ...view, stats: { ...view.stats, annualForecast: 2700 } });
assertEqual(forecastTile.dataset.tone, 'warning', 'FL-1: Hochrechnung über Budget warm hervorgehoben');
assert(text(doc.getElementById('expensesForecastDeviation')).includes('+300') && text(doc.getElementById('expensesForecastDeviation')).includes('12,5 % über Budget'), 'FL-1: Hochrechnung mit Betrag und Prozent');
for (const [floor, flex, unallocated, expectedParts] of [[100, 100, 0, ['Floor', 'Flex']], [0, 100, 0, ['Flex']], [100, 0, 100, ['Floor', 'ohne Aufteilung']]]) {
    renderExpensesPage(doc, { ...view, categories: [{ name: 'Muster', amount: floor + flex + unallocated, share: 100, floor, flex, unallocated }] });
    const totals = doc.getElementById('expensesCategoriesNeeds');
    assertEqual(totals.textContent.split(' · ').map(part => part.replace(/ [\d.]+\s€.*$/, '')).join(','), expectedParts.join(','), 'FL-2b: Wofür-Fußzeile lässt jeden Nullteil weg');
    assert(!totals.hidden, 'FL-2b: Vorhandene Aufteilung bleibt sichtbar');
}
renderExpensesPage(doc, { ...view, needs: { ...view.needs, monthsWithBreakdown: 0 } });
assert(doc.getElementById('expensesCategoriesNeeds').hidden && doc.getElementById('expensesCategoriesNeeds').textContent === '', 'FL-2b: Ohne jede Aufteilung keine Floor/Flex-Fußzeile');
assertEqual(JSON.stringify(store), before, 'FL-1: Alle Anzeigen erhalten den Store bytegleich');
