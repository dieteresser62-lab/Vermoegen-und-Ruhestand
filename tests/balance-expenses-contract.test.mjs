import * as facade from '../app/balance/balance-expenses.js';
import * as entry from '../app/balance/balance-expenses/entry.js';
import { context, state } from '../app/balance/balance-expenses/context.js';
import { createEmptyExpensesStore } from '../app/balance/balance-expenses-storage.js';

for (const name of ['initExpensesTab', 'updateExpensesBudget', 'rollExpensesYear',
    'projectCommittedExpensesYear', 'selectExpensesYear', 'refreshExpensesView', 'getExpensesViewYear']) {
    assertEqual(facade[name], entry[name], `${name} behält dieselbe Exportbindung`);
}

const previousContext = { ...context }, previousState = { ...state };
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const bindings = [];
function element(name) {
    return {
        dataset: {}, children: [],
        addEventListener(type, handler) { bindings.push({ name, type, handler }); },
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
}
const refs = { expenses: Object.fromEntries(['table', 'csvInput', 'yearSelect', 'detailDelete',
    'detailClose', 'detailDialog'].map(name => [name, element(name)])) };
let changes = 0, receiver, renders = 0;
const raw = JSON.stringify(createEmptyExpensesStore(2026));
const options = {
    storage: { getItem: () => raw }, initialYear: 2026, readOnlySelection: true,
    preserveMatrixFocus() { renders++; },
    onChange() { receiver = this; changes++; }
};
try {
    globalThis.document = { createElement: name => element(name), getElementById: () => null };
    facade.initExpensesTab(refs, options);
    assertEqual(context.dom, refs, 'Alle Teilmodule verwenden dieselben DOM-Referenzen');
    assertEqual(context.adapters, options, 'Adapter werden einmal im gemeinsamen Kontext gehalten');
    assertEqual(bindings.length, 6, 'Jedes bestehende Controlereignis wird einmal gebunden');
    assertEqual(new Set(bindings.map(({ name, type }) => `${name}:${type}`)).size, 6,
        'Die Initialisierung erzeugt keine doppelte Bindung');
    assertEqual(changes, 0, 'Initialisierung löst keinen Änderungsrückruf aus');
    const generation = context.generation;
    context.pendingImport = { month: 1 };
    facade.refreshExpensesView({ invalidateContext: true });
    assertEqual(context.generation, generation + 1, 'Refresh invalidiert dieselbe Importgeneration');
    assertEqual(context.pendingImport, null, 'Refresh verwirft dieselbe offene Dateiauswahl');
    const yearChange = bindings.find(({ name }) => name === 'yearSelect').handler;
    yearChange({ target: { value: '2027' } });
    assertEqual(facade.getExpensesViewYear(), 2027, 'Gebundener Jahreswechsel erreicht den öffentlichen Zustand');
    assertEqual(state.year, 2027, 'Darstellung und Einstieg besitzen dasselbe Jahr');
    assertEqual(changes, 1, 'Jahreswechsel benachrichtigt genau einmal');
    assertEqual(receiver, undefined, 'Der Änderungsrückruf behält seinen freien Aufruf');
    facade.updateExpensesBudget({ monthlyBudget: 100, annualBudget: 1200 });
    assertEqual(state.monthlyBudget, 100, 'Budgetänderung erreicht denselben Monatszustand');
    assertEqual(state.annualBudget, 1200, 'Budgetänderung erreicht denselben Jahreszustand');
    assertEqual(renders, 4, 'Initialisierung, Refresh, Jahreswechsel und Budget delegieren jeweils einmal');
    assertEqual(bindings.length, 6, 'Refresh und Zustandsänderungen binden keine weiteren Ereignisse');
} finally {
    Object.assign(context, previousContext);
    Object.assign(state, previousState);
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
}
