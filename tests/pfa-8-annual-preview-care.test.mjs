// FR-73 Paket 8: Gegenproben zum Argon-Gutachten PFA-7, Abschnitt 4 (A1, A2), über den echten Jahresabschluss-Dialog.
// Jahresabschluss 2026, Testdatum 23.10.2026, 2 % Inflation. Helga Grad 3 zu Hause durch Angehörige (Pflegegeld 599 €)
// mit eigenem Wert 200 €/Monat; Werner ohne Pflegegrad. Alter Stand d5e4bd1b: A2 (Signatur) rot.
import { pfa2Records, IDS } from './helpers/pfa-2-balance.mjs';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { annualRecordStorage, captureAnnualRecords, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { annualTestMarketData, annualTestNow as now } from './helpers/balance-storage-fixtures.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { applyCareTodayClosing } from '../app/shared/care-today-closing.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { createDialogFixture, prepareCloseFixture, settleAnnualReading } from './close-dialog.test.mjs?fixture';
setAppTestDate('2026-10-23');

const helga = IDS[0];
const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
const { records, scope } = pfa2Records({ care: [{ grade: 3, form: 'family', homeCostsMonthly: 200 }, null] });
{
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
}
const marketData = { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } };
// Der Dialog liest Pflegewerte aus dem App-Speicher; der Test lädt die Records dorthin und zählt Schreibvorgänge.
const store = new Map(Object.entries(records)); let writes = 0;
P.resetPersistenceForTests({ name: 'PFA-8', async loadAll() { return Object.fromEntries(store); },
    async saveBatch({ upserts, deletes }) { writes += upserts.length + deletes.length; for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const before = JSON.stringify(captureAnnualRecords(storage));
try {
const engineLoader = { load: async () => EngineAPI };
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

const { doc } = createDialogFixture(); let binding; const evaluations = [], pendingAtReading = [];
const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage, now });
const people = captureCashPeople({ storage, registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, ids: draft.scope.ids });
const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
    projectMarketReadings: opts => {
        pendingAtReading.push(doc.querySelector('[data-annual-reading-pending]')?.dataset.annualReadingPending);
        return projectAnnualMarketReadings({ ...opts, storage, engineLoader });
    },
    projectPreview: opts => projectAnnualPreview({ ...opts, storage }),
    evaluatePlan: async opts => { evaluations.push(opts); return evaluateAnnualPlanPreview({ ...opts, storage, now, engineLoader }); } });
const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
binding.updateMarketData({ values: marketData, errors: {} });
await settle();
await prepareCloseFixture(doc, { marketReading: null }); await settle();
const ownField = doc.getElementById(`annualCare_own:${helga}`);
assertEqual(ownField?.value, '214 €', 'Ausgang: eigener Wert Helga 200 € × 1,02 × 1,05 = 214 €/Monat');
const floorOf = () => evaluations.at(-1);
const plan = () => doc.querySelector('[data-annual-plan-summary]');
const summary = () => Object.fromEntries(plan().children.map(row => [row.children[0].textContent, row.hidden ? null : row.children[1].textContent]));
const initialSummary = summary(), initialCount = evaluations.length;

// A1: Der Dialog kennt beim heutigen Pflegezustand nur den eigenen Wert zu Hause; Grad, Form und „im Heim“ sind hier nicht änderbar.
const careKeys = doc.querySelectorAll('[data-annual-care-field]').map(input => input.dataset.annualCareField);
assert(careKeys.every(key => /^(\d|home(Care|Board|Invest)|cost\d|maxFloor|ownExpenses|own:|from)/.test(key)),
    `A1 Pflegewerte-Schritt bietet kein Feld für Grad, Form oder Heim (${careKeys.join(', ')})`);
assert(initialSummary['Davon sonstige Einkünfte']?.includes('599'), `A1 Ausgang: Pflegegeld Helga 599 € in „Davon sonstige Einkünfte“ (${initialSummary['Davon sonstige Einkünfte']})`);

// A2 (Signatur): Ein geänderter eigener Wert rechnet die Marktablesung neu und meldet das ehrlich als laufend.
await doc.querySelector('[data-annual-care-edit]').fire('click');
ownField.value = '300'; await ownField.fire('input');
const readingsBefore = pendingAtReading.length;
await doc.querySelector('[data-annual-care-confirm]').fire('click');
assert(pendingAtReading.length > readingsBefore, 'A2 Bestätigung rechnet die Marktablesung neu');
assertEqual(pendingAtReading.at(-1), 'true', 'A2 geänderter eigener Wert: Ablesung gilt als laufend');
await settleAnnualReading(doc); await settle();
assert(evaluations.length > initialCount, 'A2 Bestätigung rechnet den Plan neu');
assertEqual(JSON.stringify(floorOf().careToday), JSON.stringify({ [helga]: 300 }), 'A2 Plan rechnet mit 300 €/Monat');
const changedSummary = summary();
assert(changedSummary['Monatsbudget 2027'] !== initialSummary['Monatsbudget 2027'], `A2 höherer eigener Wert ändert das Monatsbudget (${initialSummary['Monatsbudget 2027']} → ${changedSummary['Monatsbudget 2027']})`);
assertEqual(changedSummary['Davon sonstige Einkünfte'], initialSummary['Davon sonstige Einkünfte'], 'A1 eigener Wert ändert das Pflegegeld nicht');

// A2 (Rücknahme): Zurück auf den Vorschlag rechnet neu; der Plan steht wieder auf dem Ausgangsstand.
ownField.value = '214'; await ownField.fire('input');
await doc.querySelector('[data-annual-care-confirm]').fire('click');
assertEqual(pendingAtReading.at(-1), 'true', 'A2 Rücknahme ändert nur careToday: Ablesung gilt als laufend (alt: false)');
await settleAnnualReading(doc); await settle();
assertEqual(JSON.stringify(floorOf().careToday), JSON.stringify({ [helga]: 214 }), 'A2 Rücknahme rechnet mit 214 €/Monat');
assertEqual(JSON.stringify(summary()), JSON.stringify(initialSummary), 'A2 Rücknahme: Zusammenfassung wieder wie am Anfang');

// A1: Die übergebene Vorschau entspricht der Vorschau auf einer Kopie mit angewandtem Abschluss des eigenen Werts.
assert(!doc.getElementById('annualConfirmBtn').disabled, 'Abschluss möglich');
await doc.getElementById('annualConfirmBtn').fire('click');
const accepted = await pending;
const copy = annualRecordStorage(captureAnnualRecords(storage));
applyCareTodayClosing(copy, { ids: draft.scope.ids, activeId: draft.profileId, inflationRate: 2, driftPercent: 5, targetYear: 2026, ownValues: accepted.careToday });
const closedPreview = projectAnnualPreview({ targetYear: 2026, inflation: marketData.inflation, careValues: accepted.careValues, storage: copy });
assertEqual(JSON.stringify(accepted.displayPreview.people.map(p => [p.sonstigeEinkuenfte, p.budgetPensionMonthly])),
    JSON.stringify(closedPreview.people.map(p => [p.sonstigeEinkuenfte, p.budgetPensionMonthly])), 'A1 übergebene Vorschau = Vorschau nach angewandtem eigenem Wert');
binding.close(true);
assertEqual(writes, 0, 'Dialog und Vorschau schreiben nie');
assertEqual(JSON.stringify(captureAnnualRecords(storage)), before, 'Records unverändert');
} finally { P.resetPersistenceForTests(); }
