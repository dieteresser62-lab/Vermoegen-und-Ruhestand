// GA-2b (FR-43, 11.11.2026): Monatsabschluss und Überblick nutzen dasselbe Monatsbudget wie die Ausgaben-Seite;
// die Pflegeprojektion des Folgejahrs enthält die festen Ausgaben in Balance und Simulator gleich.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { pfa2Records, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { EngineAPI } from '../engine/index.mjs';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { personReferenceYear } from '../app/profile/profile-person-data.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';

try {
    // Punkt 2, Zahlen aus S4: Jahresbudget 126.000 €, feste Ausgabe 1.000 €/Monat von 07 bis 12/2027.
    for (const [date, month, expected] of [['2027-08-10', 7, 11000], ['2027-02-10', 1, 10000]]) {
        setAppTestDate(date);
        const records = createMusterHaushaltRecords(date, 'sophie');
        const receipts = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(receipts.entries)[0];
        assertEqual(entry.year, 2027, 'Beleg für das Planjahr 2027');
        entry.adopted.monthlyBudget = 10500;
        entry.adopted.plannedPosts = { year: 2027, reserve: 0, expenseTotal: 0, items: Array.from({ length: 6 }, (_, index) => ({
            id: 'kv', month: `2027-${String(index + 7).padStart(2, '0')}`, label: 'Krankenversicherung', amount: 1000, kind: 'expense', fixed: true, paid: false, paidAmount: 0 })) };
        records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(receipts);
        const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile,
            liveData: records, now: new Date(`${date}T12:00:00Z`) });
        assertEqual(model.occasion.previousMonth, month, `Monatsabschluss für Monat ${month}`);
        assertEqual(model.expenseBudget, expected, `Monatsabschluss vergleicht Monat ${month} mit ${expected} €`);
        assertEqual(model.annual.months[6].budget, 11000, 'Überblick: Juli mit 11.000 €');
        assertEqual(model.annual.months[0].budget, 10000, 'Überblick: Januar mit 10.000 €');
        assertEqual(model.annual.budget, 10500, 'Überblick behält das Jahresmittel (Jahresbudget / 12)');
    }
    {
        // Ohne feste Ausgaben im Beschluss: einheitliches Monatsbudget, keine zusätzlichen Felder.
        setAppTestDate('2027-08-10');
        const records = createMusterHaushaltRecords('2027-08-10', 'renate');
        const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile,
            liveData: records, now: new Date('2027-08-10T12:00:00Z') });
        assert(model.annual.months.every(month => !Object.hasOwn(month, 'budget')), 'Ohne feste Ausgaben kein Monatsbudget je Monat');
        assert(!Object.hasOwn(model.expenseBudgetSource, 'months'), 'Ohne feste Ausgaben keine Monatsliste in der Budgetquelle');
    }

    // Punkt 3: Balance und Simulator, erstes Jahr mit Pflege (Werner im Heim) und fester Ausgabe 500 €/Monat ohne Ende.
    setAppTestDate('2026-10-23');
    const loan = { id: 'kv', bezeichnung: 'Versicherung', betragMonat: 500, ab: null, bis: null, anpassung: 'keine' };
    const year = withLoan => {
        const { records, scope } = pfa2Records({ care: [null, { grade: 4, form: 'residential' }], testDate: '2026-10-23' });
        if (withLoan) records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [scope.key]: { scope, items: [loan] } } });
        const storage = { getItem: key => records[key] ?? null };
        const balance = buildBalanceEngineInputFromStorage({ storage, scope });
        const referenceYear = personReferenceYear(JSON.parse(records[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata ?? null);
        const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
        const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name, data: registry.profiles[profileId].data,
            inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear, planValues: plan.entry.values, profileId }) }));
        const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
        if (withLoan) Object.assign(inputs, { plannedExpenses: [loan], plannedExpensesReferenceYear: referenceYear });
        const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
        let captured;
        const engine = { simulateSingleYear(input, last) { captured = EngineAPI.simulateSingleYear(input, last); return captured; } };
        const result = simulateOneYear(state, inputs, { jahr: 2027, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0,
            fixed.pflegeMeta, fixed.careFloorAddition, fixed.householdContext, .75, engine);
        assertEqual(result.kind, 'success', 'Simulatorjahr auswertbar');
        return { balance: { floor: balance.inputData.floorBedarf, next: balance.inputData.careLiquidityProjection.floor },
            simulator: { floor: captured.input.floorBedarf, next: captured.input.careLiquidityProjection.floor } };
    };
    const plain = year(false), loaned = year(true);
    for (const side of ['balance', 'simulator']) {
        assertClose(loaned[side].floor - plain[side].floor, 6000, 1e-6, `${side}: Grundbedarf des ersten Jahres enthält die feste Ausgabe`);
        assertClose(loaned[side].next - plain[side].next, 6000, 1e-6, `${side}: Pflegeprojektion des Folgejahrs enthält die feste Ausgabe`);
    }
} finally { setAppTestDate(null); }
