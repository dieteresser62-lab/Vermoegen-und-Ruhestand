import { renderBalanceExpensesHistory } from '../app/balance/balance-expenses-history-renderer.js';
import { readFileSync } from 'node:fs';

// VS-3a: Der alte Balance-Verlaufsrenderer samt Aufbereitung ist entfernt; hier bleiben Seitenhosts und Jahresausgaben.
console.log('--- Vermögensverlauf: Seitenhosts und Jahresausgaben ---');
const html = readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
const expensesPage = readFileSync(new URL('../Ausgaben.html', import.meta.url), 'utf8');
// Zusätzliche Darstellungsklassen wie ds-tab ändern den funktionalen Tabvertrag nicht.
const tabs = [...html.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*data-tab="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
    .map(([, classes, id, label]) => ({ classes: classes.split(/\s+/), id, label }))
    .filter(tab => tab.classes.includes('tab-btn'));
assertEqual(tabs.map(tab => tab.id).join(','), 'overview,strategy,diagnosis', 'Genau drei Balancereiter');
assertEqual(tabs.filter(tab => tab.classes.includes('active')).map(tab => tab.id).join(','), 'overview', 'Nur Überblick startet aktiv');
assert(!html.includes('id="tab-history"') && !html.includes('id="captureWealthBtn"'), 'Balance besitzt keine Verlaufhosts mehr');
const manager = readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
for (const id of ['managerWealthHistory', 'managerWealthChart']) {
    assertEqual((manager.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id}: eindeutiger Managerhost`);
}
for (const id of ['managerWealthTable', 'managerCaptureWealthBtn']) assert(!manager.includes(`id="${id}"`), `VS-2: ${id} entfällt im Manager`);
assert(!html.includes('id="tab-expenses"') && expensesPage.includes('id="expensesHistoryTitle"'), 'Jahresausgaben bleiben auf der Ausgabenseite');
const expensesDisplay = { isVisible: () => true, chart: { innerHTML: '' }, table: { innerHTML: '' }, hint: { textContent: '' } };
const expensesStore = { version: 1, years: {
    '2025': { months: { '1': { profiles: { A: { categories: { Ausgabe: -100 } } } } } },
    '2026': { months: { '1': { profiles: { A: { categories: { Ausgabe: -120 } } } } } }
} };
const expensesBefore = JSON.stringify(expensesStore);
assert(renderBalanceExpensesHistory(expensesDisplay, { status: 'ok', store: expensesStore }, 2026), 'Jahresvergleich bleibt auf der eigenständigen Seite renderbar');
assert(expensesDisplay.chart.innerHTML.includes('Historische Jahresbudgets werden nicht gespeichert') && expensesDisplay.table.innerHTML.includes('Ø pro Monat'), 'Budgetgrenze und Teiljahresvergleich sind in den erzeugten Ausgabeninhalten erklärt');
assertEqual(JSON.stringify(expensesStore), expensesBefore, 'Ausgelagerter Jahresvergleich bleibt schreibfrei');
