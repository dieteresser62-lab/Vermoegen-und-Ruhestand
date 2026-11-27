// Jahresabschluss speichern: Vom Klick auf „Jahr … abschließen“ bis zum Ergebnis steht „Jahr wird gespeichert …“ und Escape tut nichts.
// Danach schließt Escape wie gewohnt. Beim Wiederholen eines Monats gilt dasselbe mit „Monat wird gespeichert …“.
// Nur erfundene Werte für Max und Erika Mustermann.
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createCloseDialog } from '../app/shared/close-dialog.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { syntheticAnnualQuote } from '../app/shared/probelauf-prices.js';
import { projectOverviewYear, projectAnnualClosePreparation } from '../app/overview/overview-model.js';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';

const ticks = async (count = 30) => { for (let i = 0; i < count; i++) await Promise.resolve(); };

// Gemeinsamer Abschlussdialog: Escape während des Speicherns wird abgefangen, auch wenn der Fokus außerhalb des Dialogs liegt.
{
    const f = createDialogFixture();
    const handle = createCloseDialog({ doc: f.doc, id: 'savingClose', title: 'Abschluss' });
    handle.setBusy(true);
    f.doc.activeElement = null;
    const outside = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of [...f.nodes.find(node => node.tag === 'document').listeners.get('keydown') || []]) fn(outside);
    assert(outside.defaultPrevented, 'Escape außerhalb des Dialogs wird während des Speicherns abgefangen');
    await handle.root.fire('keydown', { key: 'Escape' });
    assert(handle.root.open, 'Escape im Dialog schließt während des Speicherns nicht');
    handle.setBusy(false);
    const after = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of [...f.nodes.find(node => node.tag === 'document').listeners.get('keydown') || []]) fn(after);
    assert(!after.defaultPrevented, 'Nach dem Speichern bleibt Escape für den Dialog frei');
    await handle.root.fire('keydown', { key: 'Escape' }); await handle.closed;
    assert(!handle.root.open, 'Nach dem Speichern schließt Escape');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Auch der Dokumentlistener wird entfernt');
}

// Jahresabschluss mit echtem Dialog: Vorbereitung, Klick auf „Jahr 2026 abschließen“, Speichern, Ergebnis.
const { doc } = createDialogFixture();
const scope = { kind: 'household', ids: ['a', 'b'], key: 'household:a+b' };
const members = [{ id: 'a', name: 'Max Mustermann' }, { id: 'b', name: 'Erika Mustermann' }];
const store = { years: { 2026: { months: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, { profiles: {
    a: { categories: {} }, b: { categories: {} } } }])) } } };
const now = new Date(2027, 0, 2);
const annual = projectOverviewYear({ store, scope, now, retrospective: true, budgetSummary: { year: 2026, scope, monthlyBudget: 5000 } });
const model = { now, scope, members, annual, expenseBudget: 5000,
    occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 },
    expenses: { year: 2026, month: 12, complete: true, spent: 0, rows: members.map(person => ({ id: person.id, present: true, spent: 0 })) } };
const preview = { targetYear: 2026, planningYear: 2027, inflation: { rate: 2.5 },
    people: members.map(person => ({ id: person.id, name: person.name, startAlter: 67, ageStatus: 'valid', renteMonatlich: 1500, monateImJahr: 12,
        renteImJahr: 18000, budgetPensionMonthly: 1500, sonstigeEinkuenfte: 0 })),
    needs: [{ id: 'floorBedarf', before: 30000, after: 30750 }, { id: 'flexBedarf', before: 20000, after: 20500 }] };
const plan = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30750, flexBedarf: 20500 };
const recommended = { monthlyBudget: 4300, monthlyWithdrawal: 1300, snapshot: { plan } };
let binding;
const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false, projectPreview: () => preview,
    evaluatePlan: async () => ({ values: plan, recommended, adopted: recommended, adjustedFields: [] }) });
const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people: members.map(person => ({ ...person, value: 12000 })),
    onReady(handle) { binding = handle; } });
binding.updateMarketData({ values: { ...Object.fromEntries([['inflation', '2.5'], ['cape', '28']]
    .map(([type, value]) => [type, createManualAnnualValue(type, value, 2026)])), etf: syntheticAnnualQuote('VWCE.DE', 2026, '2027-01-02') }, errors: {} });
await ticks();
await prepareCloseFixture(doc);
const root = doc.getElementById('balanceAnnualClose');
const statusText = () => root.querySelector('[data-close-dialog-status]').textContent;
const confirm = doc.getElementById('annualConfirmBtn');
assert(!confirm.disabled && confirm.textContent === 'Jahr 2026 abschließen', 'Vorbereitung ist abschlussbereit');
await confirm.fire('click');
const accepted = await pending;
assert(accepted && root.getAttribute('aria-busy') === 'true', 'Klick auf „Jahr 2026 abschließen“ startet das Speichern');
assertEqual(statusText(), 'Jahr wird gespeichert …', 'Sichtbar: Jahr wird gespeichert …');
await root.fire('keydown', { key: 'Escape' }); await root.fire('cancel');
assert(root.open && root.isConnected, 'Escape tut während des Speicherns nichts');
ui.setProgress('CAPE wird vorbereitet …');
assertEqual(statusText(), 'Jahr wird gespeichert …', 'Zwischenschritte ersetzen den Speicherhinweis nicht');

// Ergebnis mit offenem Monat: „Erneut versuchen“ speichert nur den Monat und zeigt „Monat wird gespeichert …“.
const savedModel = projectAnnualClosePreparation({ ...model, summary: { year: 2027, monthlyBudget: 4300, monthlyWithdrawal: 1300 },
    planComparison: { year: 2027, recordStatus: 'valid' }, annual: { year: 2027, complete: false, months: [] },
    occasion: { ...model.occasion, kind: 'monthly', annualState: 'done' } }, { store, annualBudgetSummary: { year: 2026, scope, monthlyBudget: 5000 } });
let releaseMonth;
const results = { targetYear: 2026, confirmed: true, actionResult: { year: 2027, targetYear: 2026, action: { type: 'NONE', steuer: 0 }, needs: [] },
    monthError: 'Testfehler', monthSession: { model: savedModel, request: { cash: accepted.cash }, phase: 'failed',
        save: () => new Promise(resolve => { releaseMonth = () => resolve({ monthSnapshotId: 'monat-test' }); }) } };
ui.showUpdateResultModal(results);
assertEqual(root.getAttribute('aria-busy'), 'false', 'Nach dem Jahr ist der Dialog wieder frei');
assertEqual(confirm.textContent, 'Erneut versuchen', 'Offener Monat bietet „Erneut versuchen“');
ui.setProgress('Nachlauf');
assertEqual(statusText(), 'Nachlauf', 'Nach dem Speichern zeigt der Fuß wieder normale Meldungen');
const retry = confirm.fire('click');
await ticks(5);
assertEqual(statusText(), 'Monat wird gespeichert …', 'Sichtbar: Monat wird gespeichert …');
await root.fire('keydown', { key: 'Escape' });
assert(root.open && root.getAttribute('aria-busy') === 'true', 'Escape tut beim Wiederholen des Monats nichts');
releaseMonth(); await retry; await ticks();
assertEqual(root.getAttribute('aria-busy'), 'false', 'Monat gespeichert: Dialog ist wieder frei');
assertEqual(confirm.textContent, 'Fertig', 'Nach dem Monat bietet der Dialog „Fertig“');

// Danach schließt Escape wie gewohnt.
await root.fire('keydown', { key: 'Escape' }); await ticks();
assert(!root.open && !root.isConnected, 'Nach dem Speichern schließt Escape den Jahresabschluss');
