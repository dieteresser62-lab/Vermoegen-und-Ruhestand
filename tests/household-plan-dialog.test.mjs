import { documentDouble } from './helpers/page-dialog-dom.mjs';
import { requestHouseholdPlanMigration, migrationResetWarning, initializeHouseholdPlanPage } from '../app/profile/household-plan-dialog.js';
import { PLAN_DEFAULTS, planScope } from '../app/profile/household-plan.js';

function analysis(values = {}) {
    const plan = { ...structuredClone(PLAN_DEFAULTS), ...values };
    const fields = [
        { path: 'floorBedarf', selected: plan.floorBedarf, conflict: true, balance: { status: 'present', value: plan.floorBedarf }, simulator: { status: 'present', value: plan.floorBedarf + 1000 } },
        { path: 'minimumFlexAnnual', selected: 0, conflict: true, balance: { status: 'present', value: 0 }, simulator: { status: 'present', value: 25000 } }
    ];
    return { scope: planScope('household', ['a']), values: plan, fields, conflicts: fields, warnings: ['Synthetischer unlesbarer Alias.'] };
}
for (const action of ['accept', 'later', 'escape', 'abort']) {
    const env = documentDouble(), controller = new AbortController(), item = analysis();
    const job = requestHouseholdPlanMigration(item, { doc: env.doc, signal: controller.signal });
    const [floor, minimum, later, accept] = env.controls();
    assertEqual(floor.value, 'balance', 'Balance ist standardmäßig ausgewählt');
    const reset = env.nodes.find(node => node.dataset.householdPlanReset !== undefined);
    assert(reset.hidden, 'Unveränderte Balanceauswahl zeigt keinen Reset');
    floor.value = 'simulator'; floor.fire('change');
    assert(!reset.hidden, 'Tatsächliche 1000-Euro-Resetschwelle zeigt Hinweis vor Bestätigung');
    minimum.value = 'simulator'; minimum.fire('change'); accept.fire('click');
    assert(env.dialog().open, 'Ungültige gekoppelte Werte verhindern Übernahme');
    assert(env.nodes.find(node => node.dataset.householdPlanValidation !== undefined).textContent.includes('Mindest-Flex'), 'Mindest-Flex-Fehler wird erklärt');
    minimum.value = 'balance'; minimum.fire('change');
    if (action === 'accept') accept.fire('click');
    if (action === 'later') later.fire('click');
    if (action === 'escape') env.dialog().fire('keydown', { key: 'Escape' });
    if (action === 'abort') controller.abort();
    const result = await job;
    assertEqual(result === null, action !== 'accept', action + ': Aufschub/Abbruch hat keine Auswahl');
    if (result) assertEqual(result.floorBedarf, 'simulator', 'Bewusste Simulatorauswahl bleibt erhalten');
    assert(env.cleaned() && !env.dialog().isConnected, 'Dialoglistener und Modalität werden entfernt');
}
const threshold = analysis({ floorBedarf: 50000 });
threshold.fields[0].simulator.value = 50999;
assert(!migrationResetWarning(threshold, { floorBedarf: 'simulator' }), '999 Euro unter beiden Bedarfsschwellen erzeugt keinen Hinweis');
threshold.fields[0].simulator.value = 51000;
assert(migrationResetWarning(threshold, { floorBedarf: 'simulator' }), '1000 Euro trifft tatsächlichen Resetvertrag');
const budget = analysis(); budget.fields = [{ path: 'flexBudgetAnnual', selected: 7000, conflict: true, balance: { status: 'present', value: 7000 }, simulator: { status: 'present', value: 8000 } }]; budget.conflicts = budget.fields;
assert(migrationResetWarning(budget, { flexBudgetAnnual: 'simulator' }), 'Budgetwechsel nutzt ebenfalls den vorhandenen Resetvertrag');
const env = documentDouble(); let calls = 0;
env.doc.getElementById = id => env.nodes.find(node => node.id === id && node.isConnected);
const options = { doc: env.doc, win: {}, storage: { getItem: () => '{}' }, migrate: async () => { calls++; return { status: 'deferred' }; } };
await initializeHouseholdPlanPage(options); await initializeHouseholdPlanPage(options);
assertEqual(calls, 1, 'Dokumentlokal nur einmal fragen');
const reopen = env.nodes.find(node => node.dataset.householdPlanOpen !== undefined);
assert(reopen?.textContent === 'Planungsdaten zusammenführen', 'Ruhiger Hinweis bleibt erreichbar');
reopen.fire('click'); for (let i = 0; i < 10; i++) await Promise.resolve();
assertEqual(calls, 2, 'Hinweis öffnet die Umstellung ausdrücklich erneut');
await initializeHouseholdPlanPage({ ...options, doc: documentDouble().doc });
assertEqual(calls, 3, 'Neuer Seitenstart fragt wieder');
