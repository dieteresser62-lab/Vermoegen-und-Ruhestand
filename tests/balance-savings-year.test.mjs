import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { runFixture } from './extended/parity-replay-fixture.mjs';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { creditFixedIncomeSurplus } from '../app/simulator/simulator-fixed-income.js';
import { EngineAPI } from '../engine/index.mjs';
import { projectBalanceBudget } from '../app/balance/balance-budget.js';
import { projectBalanceMonthlyFlow } from '../app/balance/balance-monthly-flow.js';
import { calculateExpensesBudget } from '../app/balance/balance-update-pipeline.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY, readAnnualPlanRecord, buildAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { evaluateAnnualDraft, prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectAnnualCloseResult, createAnnualPlanResult } from '../app/shared/annual-close-result.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const saved = { document: globalThis.document, window: globalThis.window };
try {
    // Echte Simulatorjahre einschließlich des zweiten Jahres als Hinterbliebene.
    for (const household of ['max-erika', 'sophie']) for (const dynamicFlex of [false, true]) for (const care of [false, true]) {
        const inputs = await measurementInputs(household === 'max-erika' ? 5000 : 0, household);
        inputs.dynamicFlex = dynamicFlex;
        const decisions = [];
        const engine = { ...EngineAPI, simulateSingleYear(input, state, ...options) {
            const result = EngineAPI.simulateSingleYear(input, state, ...options);
            decisions.push({ ...result.ui, input: structuredClone(input) });
            return result;
        } };
        const result = runFixture({ input: inputs, selectedPeriod: { startYear: 2000, endYear: 2001 }, engine,
            simulate(state, input, year, index, ...unused) {
                const pair = household === 'max-erika';
                const meta = care ? { active: true, grade: 3, flexFactor: .5, zusatzFloorZiel: 4800 } : null;
                const context = { p1Alive: true, p2Alive: pair && !care, care: { p1: meta, p2: null } };
                return simulateOneYear(state, input, year, index, meta, care ? 4800 : 0, context,
                    care ? pair ? .375 : .5 : 1, engine);
            } });
        assertEqual(result.outcome.kind, 'completed', `${household}/${dynamicFlex}/${care}: Simulatorjahr abgeschlossen`);
        assertEqual(decisions.length, 2, 'Beide Jahresentscheidungen wurden tatsächlich gerechnet');
        result.rows.forEach(({ row }, index) => {
            const ui = decisions[index], budget = projectBalanceBudget(ui);
            assert(ui.vpw && typeof ui.vpw.enabled === 'boolean', 'Produktiver Jahrespfad liefert VPW auch ohne Dynamik');
            const income = row.pension_annual + (row.sonstige_einkuenfte || 0);
            const expected = (income - (row.einkuenfte_gespart || 0) + row.entnahme_effektiv) / 12;
            assertClose(budget.budget, expected, 1e-7, 'Balance-Budget entspricht dem wirklichen Simulatorverbrauch');
            assertClose(budget.saving, (row.einkuenfte_gespart || 0) / 12, 1e-7, 'Angelegt entspricht der tatsächlichen Simulatorgutschrift');
            assertEqual(calculateExpensesBudget({ ui }).monthlyBudget, budget.budget, 'Ausgabenbudget verwendet dieselbe Grenze');
            const flow = projectBalanceMonthlyFlow(ui);
            for (const unit of ['cents', 'euros']) assertEqual(flow[unit].income + flow[unit].withdrawal,
                flow[unit].budget + flow[unit].saving, 'Angezeigte Gleichung schließt auf Cent und Euro');
            if (care) {
                assert(ui.input.floorBedarf > inputs.startFloorBedarf * (pairFactor(household, index)), 'Pflegezusatz steckt bereits im effektiven Grundbedarf');
                assert(ui.input.flexBedarf < inputs.startFlexBedarf, 'Pflege-/Hinterbliebenenfaktor steckt im effektiven Flex');
            }
        });
    }
    // Die erste Grenze vor der Entscheidung ist Floor plus einfacher/doppelter Flex.
    for (const dynamic of [false, true]) {
        const portfolio = { personAccounts: [{ profileId: 'a', tagesgeld: 0, geldmarktEtf: 0 }] };
        const income = creditFixedIncomeSurplus(portfolio, { total: 60000, persons: [{ profileId: 'a', amount: 60000 }] },
            { pensionAnnual: 0, rente1: 0, rente2: 0 }, 22000, 8000, dynamic, { simulationSourceProfileId: 'a' });
        assertEqual(income.einkuenfte_gespart, dynamic ? 22000 : 30000, 'Simulator-Vorgrenze bleibt unverändert');
    }
    const displayOnly = { input: { renteAktiv: true, renteMonatlich: 5000, floorBedarf: 22000,
        flexBedarf: 8000, dynamicFlex: true }, spending: { monatlicheEntnahme: 0 } };
    assertEqual(projectBalanceBudget(displayOnly).budget, 2500, 'Anzeigeobjekt ohne VPW bleibt statisch, auch bei angeforderter Dynamik');
    assertClose(projectBalanceBudget({ ...displayOnly, vpw: { enabled: true } }).budget, 38000 / 12, 1e-9,
        'Aktive Dynamik ohne beschlossene Beträge verwendet die doppelte Simulator-Vorgrenze');
    for (const missing of [{}, { fixedIncomeAnnual: 60000, monthlyWithdrawal: 0 }]) {
        let error;
        try { calculateExpensesBudget(missing); } catch (caught) { error = caught; }
        assert(error?.message.includes('Balance-Ergebnis (ui) fehlt'), 'Fehlendes UI darf kein ungekapptes Budget erzeugen');
    }

    const records = createMusterHaushaltRecords('2026-10-16', 'sophie');
    const storage = { getItem: key => records[key] ?? null };
    const { scope, entry } = readBalanceHouseholdPlan({ storage });
    const outcome = evaluateAnnualDraft({ records, planningYear: 2026, scope, values: entry.values,
        ageByPerson: Object.fromEntries(scope.ids.map(id => [id, 55])) }, { engineApi: EngineAPI }).outcome;
    assertEqual(outcome.monthlyBudget, 2800, 'Neuer Sophie-Plan speichert das begrenzte Budget (GA-2: mit 300 € Ratenkredit im Grundbedarf)');
    assertEqual(outcome.monthlySaving, 600, 'Neuer Sophie-Plan speichert angelegt getrennt');
    const commitStorage = annualRecordStorage(records), clock = () => new Date('2027-01-02T12:00:00Z');
    const state = JSON.parse(commitStorage.getItem(CONFIG.STORAGE.LS_KEY));
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic-before', phase: 'writes_started' };
    commitStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, scope, storage: commitStorage, now: clock,
        marketData: { inflation: { rate: 0, year: 2026, source: 'Test', dataAsOf: '2027-01-01', fetchStatus: 'ok_primary_ecb',
                metric: 'consumer_prices_all_items_annual_average_growth_pct' },
            etf: { price: 160, asOf: '2026-12-31', date: new Date('2026-12-31'), targetYear: 2026, ticker: 'VWCE.DE', source: 'Test' },
            cape: { capeRatio: 25, capeAsOf: '2026-12-01', capeSource: 'synthetisch', capeFetchStatus: 'ok_primary', capeUpdatedAt: clock().toISOString() } } });
    const committed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now: clock });
    const savedPlan = readAnnualPlanRecord({ year: 2027, scope, storage: annualRecordStorage(committed.records) });
    assertEqual(savedPlan.adopted.monthlyBudget, 2800, 'Vollständiger Jahrescommit speichert das begrenzte Budget');
    assertEqual(savedPlan.adopted.monthlySaving, 600, 'Vollständiger Jahrescommit speichert den Anlageanteil');
    const legacyRecord = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]);
    for (const receipt of Object.values(legacyRecord.entries)) {
        receipt.recommended.monthlyBudget = receipt.adopted.monthlyBudget = 3400;
        delete receipt.recommended.monthlySaving; delete receipt.adopted.monthlySaving;
    }
    const legacyRaw = JSON.stringify(legacyRecord);
    for (const oldPeriod of ['calendar-year:2025', 'calendar-year:2026']) {
        const legacy = JSON.parse(legacyRaw);
        Object.values(legacy.entries)[0].periodId = oldPeriod;
        const raw = JSON.stringify(legacy), oldStorage = { getItem: key => key === ANNUAL_PLAN_RECORD_KEY ? raw : records[key] ?? null };
        const read = readAnnualPlanRecord({ year: 2026, scope, storage: oldStorage });
        assertEqual(read.adopted.monthlyBudget, 3400, 'Altbestand mit beiden Periodenschlüsseln bleibt bei seinem gespeicherten Betrag');
        const comparison = projectHouseholdPlanComparison({ year: 2026, scope, storage: oldStorage });
        assert(comparison.rows.find(row => row.label === 'Monatsbudget').plan.includes('3.400'), 'Anzeige verwendet den Altbeleg ohne Neuberechnung');
        assert(!Object.hasOwn(comparison.confirmedAction, 'monthlySaving'), 'Für Altbelege wird kein Anlageanteil erfunden');
        assertEqual(oldStorage.getItem(ANNUAL_PLAN_RECORD_KEY), raw, 'Altbelegbytes bleiben beim Lesen und Anzeigen erhalten');
    }
    const next = buildAnnualPlanRecord(legacyRaw, { targetYear: 2026, scope, committedAt: '2027-01-02T12:00:00Z', recommended: outcome });
    assertEqual(JSON.stringify(next.record.entries[Object.keys(legacyRecord.entries)[0]]),
        JSON.stringify(Object.values(legacyRecord.entries)[0]), 'Neuer Ansparplan bewahrt vorhandene Belege vollständig');
    const comparison = projectHouseholdPlanComparison({ year: 2027, scope,
        storage: { getItem: key => key === ANNUAL_PLAN_RECORD_KEY ? next.raw : records[key] ?? null } });
    const model = { scope, summary: { monthlyBudget: 2800 }, planComparison: comparison };
    const close = projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model });
    assertEqual(close.monthlySaving, 600, 'Ergebnis liest den gespeicherten Anlageanteil');
    const { doc } = createDialogFixture();
    assert(dialogElements(createAnnualPlanResult({ doc, result: close, model })).some(node => node.textContent.includes('600,00')),
        'Jahresbeleg zeigt den gespeicherten Anlageanteil');

    const dom = createPresentationTestDocument(); globalThis.document = dom;
    const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetCut', 'balanceAnnualBudget', 'balanceMonthlyIncome',
        'balanceFlowNeed', 'balanceFlowSaving', 'balanceFlowSavingSign', 'balanceFlowWithdrawal', 'balanceFlowWithdrawalSign',
        'balanceMonthlySaving'].map(id => [id, dom.createElement('div')]));
    const renderer = new SummaryRenderer({ outputs });
    const ui = { input: { renteAktiv: true, renteMonatlich: 3400.495, floorBedarf: 22000, flexBedarf: 8000 },
        spending: { monatlicheEntnahme: 0 } };
    renderer.renderPlanCards(ui);
    assertEqual(outputs.balanceBudgetCut.textContent, 'Ansparjahr: Einkünfte decken das Budget', 'Ansparjahr nennt den freigegebenen Kopftext');
    assert(!outputs.balanceFlowSaving.hidden && outputs.balanceFlowWithdrawal.hidden, 'Anlage ersetzt die leere Entnahme im Geldfluss');
    assertEqual(outputs.balanceFlowNeed.textContent, '', 'Der Statussatz nennt die volle Deckung ohne doppelte Zeile');
    renderer.renderPlanCards({ input: { ...ui.input, renteMonatlich: 1000 }, spending: { monatlicheEntnahme: 1500 } });
    assert(outputs.balanceFlowSaving.hidden && !outputs.balanceFlowWithdrawal.hidden, 'Nach Wechsel zum Entnahmejahr stimmt die Gleichung wieder');
} finally { Object.assign(globalThis, saved); setAppTestDate(null); P.resetPersistenceRuntimeForTests(); }
function pairFactor(household, index) { return household === 'max-erika' ? index === 0 ? .85 : .7 : 1; }
