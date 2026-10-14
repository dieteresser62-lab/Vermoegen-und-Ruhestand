import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createAnnualExpenseStatus } from '../app/shared/annual-close-result.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { projectOverviewYear, projectAnnualClosePreparation } from '../app/overview/overview-model.js';
import { dialogElements } from '../app/shared/close-dialog.js';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';

const { doc } = createDialogFixture();
const scope = { kind: 'household', ids: ['a', 'b'], key: 'household:a+b' };
const members = [{ id: 'a', name: 'Max Mustermann' }, { id: 'b', name: 'Erika Mustermann' }];
const store = { years: { 2026: { months: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, { profiles: {
    a: { categories: {} }, ...(index === 6 ? {} : { b: { categories: {} } })
} }])) } } };
const now = new Date(2027, 0, 2);
const annualBudgetSummary = { year: 2026, scope, monthlyBudget: 5000 };
const annual = projectOverviewYear({ store, scope, now, retrospective: true, budgetSummary: annualBudgetSummary });
assertEqual(annual.months[6].missingPersonIds.join(','), 'b', 'Jahresprojektion nennt den fehlenden Partner im Juli');
assertEqual(annual.months[11].missingPersonIds.length, 0, 'Nullimporte beider Personen sind vollständige Dezemberdaten');
const model = { now, scope, members, annual, expenseBudget: 5000,
    occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 },
    expenses: { year: 2026, month: 12, complete: true, spent: 0, rows: members.map(person => ({ id: person.id, present: true, spent: 0 })) } };
const preview = { targetYear: 2026, planningYear: 2027, inflation: { rate: 2.5 },
    people: [
        { id: 'a', name: members[0].name, startAlter: 68, ageStatus: 'valid', renteMonatlich: 1600, monateImJahr: 12, renteImJahr: 19200, budgetPensionMonthly: 1600, sonstigeEinkuenfte: 100 },
        { id: 'b', name: members[1].name, startAlter: 65, ageStatus: 'valid', renteMonatlich: 3000, monateImJahr: 6, renteImJahr: 18000, budgetPensionMonthly: 1500, sonstigeEinkuenfte: 0 }
    ], needs: [{ id: 'floorBedarf', before: 30000, after: 30750 }, { id: 'flexBedarf', before: 24000, after: 24600 }] };
const before = JSON.stringify({ store, model, preview });
const base = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30750, flexBedarf: 24600 };
const recommended = { monthlyBudget: 5150, monthlyWithdrawal: 1950, snapshot: { plan: base } };
let binding;
const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
    projectPreview: () => preview, evaluatePlan: async ({ adoptedPlanPatch }) => ({ values: base, recommended,
        adopted: adoptedPlanPatch ? { monthlyBudget: 5250, monthlyWithdrawal: 2050, snapshot: { plan: { ...base, ...adoptedPlanPatch } } } : recommended,
        adjustedFields: adoptedPlanPatch ? Object.keys(adoptedPlanPatch) : [] }) });
const pending = ui.showAnnualPreparation({ targetYear: 2026, model,
    people: members.map(person => ({ ...person, value: 10000 })), onReady(handle) { binding = handle; } });
binding.updateMarketData({ values: Object.fromEntries([['inflation', '2.5'], ['etf', '100'], ['cape', '28']]
    .map(([type, value]) => [type, createManualAnnualValue(type, value, 2026)])), errors: {} });
for (let i = 0; i < 30; i++) await Promise.resolve();
const root = doc.getElementById('balanceAnnualClose');
const text = element => dialogElements(element).map(node => node.textContent || '').join(' ').replaceAll('\u00a0', ' ');
const footer = root.querySelector('[data-close-dialog-footer]');
const conditions = root.querySelector('[data-annual-close-conditions]');
assert(conditions.parent === binding.content && !conditions.open && text(conditions).includes('Alle sechs Vorbereitungsschritte ansehen'), 'Abschlussbedingungen sind im scrollbaren Inhalt erreichbar');
assert(!text(footer).includes('Alle sechs Vorbereitungsschritte') && doc.getElementById('annualCloseBtn').hidden, 'Vorbereitungsfuß enthält keine ausführlichen Bedingungen oder doppelten Schließknopf');
const plan = root.querySelector('[data-annual-plan-editor]');
const summary = plan.querySelector('[data-annual-plan-summary]');
assertEqual(plan.children[0], summary, 'Monatsbudget und Aufteilung stehen vor dem Planvergleich');
assert(text(summary).includes('5.150 €') && text(summary).includes('3.100 €') && text(summary).includes('1.950 €'),
    'Zusammenfassung verwendet berechnetes Budget, anteilige Renten und geplante Vermögensentnahme');
assert(text(summary).includes('100 €') && text(summary).includes('Davon sonstige Einkünfte'), 'Sonstige Einkünfte werden getrennt von Renten benannt');
assert(text(plan.children[1]).includes('Empfehlung der App') && text(plan.children[1]).includes('Dein Plan'), 'Vergleich folgt direkt auf die Ergebniswerte');
const calculations = root.querySelector('[data-annual-calculations]');
assert(!calculations.open && text(calculations).includes('68') && text(calculations).includes('Geburtsdatum'), 'Altersherleitung liegt in geschlossenen Berechnungsgrundlagen');
const previewSection = root.querySelector('[data-annual-preview]');
assert(previewSection.children.some(node => (node.tagName?.toLowerCase() || node.tag) === 'p' && node.textContent.includes('6 Bezugsmonate')), 'Anteiliges Rentenjahr bleibt außerhalb der Grundlagen sichtbar');
const budget = root.querySelector('[data-close-dialog-step="budget"]');
await root.querySelector('[data-close-dialog-activate="budget"]').fire('click');
assertEqual(budget.querySelector('.close-dialog-step-pill').textContent, 'angesehen', 'Haken und Pille belegen allein den Schrittbesuch');
assert(text(budget).includes('Dezember vollständig') && text(budget).includes('Jahr 2026 noch unvollständig'), 'Dezemberstatus ist vom Jahresstatus getrennt');
assert(text(budget).includes('Juli (Erika Mustermann)'), 'Budgetvergleich nennt fehlenden Monat und Person');
await plan.querySelector('[data-annual-plan-toggle]').fire('click');
const floor = doc.getElementById('annualPlan_floorBedarf'); floor.value = '32000'; await floor.fire('input');
for (let i = 0; i < 30; i++) await Promise.resolve();
assert(text(summary).includes('5.250 €') && text(summary).includes('2.050 €'), 'Bewusste Anpassung aktualisiert die Ergebniswerte');
assert(text(plan.querySelector('[data-annual-plan-changes]')).includes('30.000,00 € → 32.000,00 € (von dir angepasst)'), 'Vorjahresvergleich zeigt den tatsächlichen beschlossenen Bedarf');
await plan.querySelector('[data-annual-plan-discard]').fire('click');
for (let i = 0; i < 30; i++) await Promise.resolve();
await prepareCloseFixture(doc);
assert(!doc.getElementById('annualConfirmBtn').disabled, 'Jahreslücken ändern die bestehenden Abschlussbedingungen nicht');
await doc.getElementById('annualConfirmBtn').fire('click');
const accepted = await pending;
assertEqual(JSON.stringify({ store, model, preview }), before, 'Planprüfung, Anpassung und Freigabe erhalten alle Anzeigequellen');
const savedModel = projectAnnualClosePreparation({ ...model, summary: { year: 2027, monthlyBudget: 5150, monthlyWithdrawal: 1950 },
    annual: { year: 2027, complete: false, months: [] }, occasion: { ...model.occasion, kind: 'monthly', annualState: 'done' } }, { store, annualBudgetSummary });
assertEqual(savedModel.annual.year, 2026, 'Monatsphase nach Jahreswrite behält den Rückblick auf das Abschlussjahr');
ui.showUpdateResultModal({ targetYear: 2026, confirmed: true, actionResult: { year: 2027, targetYear: 2026, action: { type: 'NONE', steuer: 0 }, needs: [] },
    monthSession: { model: savedModel, request: { cash: accepted.cash }, result: { monthSnapshotId: 'test' }, phase: 'done' } });
const receipt = root.querySelector('[data-annual-expense-status]');
assert(text(receipt).includes('Dezember vollständig') && text(receipt).includes('Jahr 2026 noch unvollständig') && text(receipt).includes('Juli (Erika Mustermann)'),
    'Abschlussbeleg bewahrt den getrennten Status und konkrete Jahreslücken');
assert(!text(receipt).includes('Jahr 2027'), 'Neues Planjahr ersetzt nicht das Ausgabenjahr im Beleg');
assert(text(root.querySelector('.close-dialog-success')).includes('Dezember und 2026 abgeschlossen. Handlungsanweisung 2027 festgeschrieben.'), 'Erfolgsblock bestätigt Dezember, Abschlussjahr und festgeschriebene Handlungsanweisung');
assert(doc.getElementById('annualShowLog').parent !== footer && root.querySelector('[data-annual-receipt-details]').parent === binding.content.children[0], 'Protokoll und Belegerläuterung liegen im scrollbaren Inhalt');
assert(root.querySelector('.close-dialog-footnote').hidden, 'Ergebnisfuß lässt die Belegerläuterung im Inhalt');
await doc.getElementById('annualConfirmBtn').fire('click');
const completeStore = structuredClone(store); completeStore.years[2026].months[7].profiles.b = { categories: {} };
const completeYear = projectOverviewYear({ store: completeStore, scope, now, retrospective: true });
const completeStatus = createAnnualExpenseStatus({ doc, model: { ...model, annual: completeYear }, targetYear: 2026 });
assert(text(completeStatus).includes('Jahr 2026 vollständig') && !text(completeStatus).includes('Ausgaben fehlen'), 'Zwölf Nullimporte je Person belegen ein vollständiges Jahr');
const incompleteMonth = createAnnualExpenseStatus({ doc, model: { ...model, expenses: { ...model.expenses, complete: false,
    rows: [{ id: 'a', present: true }, { id: 'b', present: false }] } }, targetYear: 2026 });
assert(text(incompleteMonth).includes('Dezember noch unvollständig · Ausgaben fehlen: Erika Mustermann'), 'Fehlende Dezemberausgaben nennen die betroffene Person');
