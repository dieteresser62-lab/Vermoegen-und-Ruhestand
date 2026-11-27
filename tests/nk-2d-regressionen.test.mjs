// NK-2d: Nachstellungen aus GUTACHTEN-NK2C3 (Codex Runde 3) und der Abnahme (S1 mit Zufluss) als Regressionstests. Erfundene Beträge.
import { single, couple, lot, A, B, YEAR } from './helpers/nk-1b-cases.mjs';
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { estimateBalanceCareAid } from '../app/balance/balance-care.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { calculateHouseholdWithdrawalNeed, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const residential = { grade: 4, form: 'residential', residentialSince: '2023-01' };

// Abnahme S1 (Punkt 8): 263,75 € Steuerschuld aus Jahr 1, im Jahr 2 ein Zufluss von 2.000 €. Grundbedarf und Schuld sind gedeckt: kein
// Notverkauf des selbst genutzten Hauses, die Schuld wird bezahlt.
{
    const inputs = single({ floor: 1000, lots: [lot(A, 1000, 0.01)] });
    inputs.simulationPeople[0].sparerPauschbetrag = 0; inputs.startSPB = 0;
    const id = inputs.simulationPeople[0].profileId;
    Object.assign(inputs, { home: [{ id: 'haus', profileId: id, wert: 1000000, nutzung: 'selbst', stand: '2026-01' }], homeReferenceYear: 2026,
        plannedInflowsReferenceYear: 2026, plannedInflows: [{ id: 'zufluss', year: 2027, amount: 2000, profileId: id, label: 'Einmalzufluss' }] });
    const first = simulateOneYear(initMcRunState(inputs), inputs, YEAR, 0, null, 0, null, 1, EngineAPI);
    const second = simulateOneYear(structuredClone(first.newState), inputs, YEAR, 1, null, 0, null, 1, EngineAPI);
    close(first.logData.steuer_offen, 263.75, 'S1: Schuld aus dem ersten Jahr');
    assertEqual(`${second.kind} · ${second.logData.zufluss} · ${second.logData.immobilien_notverkauf ?? false} · ${second.logData.steuer_offen ?? 0}`, 'success · 2000 · false · 0',
        'S1 mit Zufluss: kein Notverkauf, Schuld bezahlt');
    close(second.logData.portfolio_total_end, 2000 - 1000 - 263.75, 'S1 mit Zufluss: Restgeld');
}

// Befund 1: Werner im Heim mit 30.000 € Rente, beide ohne Geld, kein Flex. Der fehlende Grundbedarf ist keine Flex-Kürzung; er bleibt offen
// und steht im Abschluss.
const annual = (opts, mode = 'proportional') => {
    const { records, scope } = pfa2Records({ care: [null, residential], unmarried: true, clearTranches: true, testDate: '2026-11-15', ...opts });
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    return { calculation, runs: evaluateStoredAnnualHousehold(calculation.inputData, calculation.profiles, calculation.engineLastState, { engineApi: EngineAPI, withdrawalMode: mode }) };
};
{
    const { calculation, runs } = annual({ cash: [0, 0], pensions: [0, 2500] });
    const need = calculateHouseholdWithdrawalNeed(calculation.profiles, { floorBedarf: calculation.inputData.floorBedarf, flexBedarf: calculation.inputData.flexBedarf });
    const split = calculateWithdrawalDistribution(calculation.profiles, { ...need, netWithdrawal: 27000 }, 'proportional');
    assertEqual(`${split.flexCut?.length ?? 0} · ${split.floorShortfall} · ${split.remaining}`, '0 · 27000 · 27000', 'Befund 1: keine Flex-Kürzung, 27.000 € Grundbedarf offen');
    close(runs.distribution.floorShortfall, 27000, 'Befund 1: Abschluss behält den offenen Grundbedarf');
}

// Befunde 2 und 3: Helga 10.000 €, Werner 100.000 €, Flex 10.000 €. Werner zahlt 48.332 €; die Haushalts-Engine rechnet mit dem gekürzten Flex
// (Monatsbudget, Entnahme, Folgezustand 58.332 €), auch bei „Helga trägt“.
for (const mode of ['proportional', `one_carries:${IDS[0]}`]) {
    const { runs } = annual({ cash: [10000, 100000], plan: { floorBedarf: 36000, flexBedarf: 10000, householdWithdrawalMode: mode } }, mode);
    const werner = runs.distribution.items.find(item => item.profileId === IDS[1]).withdrawalAmount;
    close(werner, 48332, `Befund 2/3 (${mode}): Werner zahlt Heim und Grundbedarfslücke`, 1);
    close(runs.householdResult.ui.spending.monatlicheEntnahme * 12, 58332, `Befund 2 (${mode}): Entnahme nach der Kürzung`, 1);
    close(runs.householdResult.newState.lastTotalBudget, 58332, `Befund 2 (${mode}): Folgezustand nach der Kürzung`, 1);
}

// Befunde 4 bis 6: Folgejahr aus dem echten Planjahresbestand.
const married = (lots, cash = 0, lossCarry = 0) => [{ profileId: A, name: 'A', inputs: { tagesgeld: cash, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }, tranches: lots,
    balanceState: { lastState: { taxState: { lossCarry } } } }, { profileId: B, name: 'B', inputs: { tagesgeld: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }, tranches: [] }];
const careNeedsOf = (care, careNext, floorNext) => ({ current: { homeCareAddition: care }, next: { homeCareAddition: careNext, total: floorNext + careNext, incomeAnnual: 0 },
    persons: [{ profileId: A, personal: 0, next: { personal: 0 }, nextIncome: 0 }, { profileId: B, personal: care, next: { personal: careNext }, nextIncome: 0 }] });
{
    // Befund 4: 20.000 € Verlustvortrag werden im Planjahr verbraucht und zählen im Folgejahr nicht noch einmal.
    const fund = { ...lot(A, 60000, 600, 'equity'), tqf: 0.3 };
    const careNeeds = careNeedsOf(18000, 18000, 12000), inputData = { floorBedarf: 30000, flexBedarf: 0, jointAssessment: true };
    const profiles = married([fund], 0, 20000);
    const current = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '' });
    const next = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '', nextYear: { currentAid: current } });
    close(next?.total || 0, 2973.52, 'Befund 4: Folgejahreshilfe mit verbrauchtem Verlustvortrag', 0.5);
}
{
    // Befund 5: 60.000 € Tagesgeld, Flex 10.000 €. Der Planjahresbestand enthält den bezahlten Flex (geplanter Flex als Obergrenze).
    const careNeeds = careNeedsOf(18000, 18000, 12000), inputData = { floorBedarf: 30000, flexBedarf: 10000, jointAssessment: true };
    const profiles = married([], 60000);
    const current = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '' });
    const next = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '', nextYear: { currentAid: current } });
    close(next?.total || 0, 10000, 'Befund 5: Bestand nach Grundbedarf, Pflege und Flex (20.000 €), Hilfe 10.000 €');
}
{
    // Befund 6: unverheiratet, A 90.000 €, B 10.000 €, Grundbedarf 12.000 €, Bs Pflege 5.000 €. Im Folgejahr gelten die Anteile nach dem Jahr
    // (A 79.200 €, B 3.800 €) wie im Simulator.
    const inputs = couple({ cash: [90000, 10000], floor: 12000 });
    const year = (state, index) => simulateOneYear(state, inputs, YEAR, index, null, 5000,
        { p1Alive: true, p2Alive: true, care: { p2: { active: true, grade: 3, zusatzFloorZiel: 5000, zusatzFloorDelta: 5000 } } }, 1, EngineAPI);
    const second = year(year(initMcRunState(inputs), 0).newState, 1);
    const careNeeds = { current: { homeCareAddition: 5000 }, next: { homeCareAddition: 5000, total: 17000, incomeAnnual: 0 },
        persons: [{ profileId: A, personal: 0, next: { personal: 0 }, nextIncome: 0 }, { profileId: B, personal: 5000, next: { personal: 5000 }, nextIncome: 0 }] };
    const profiles = [{ profileId: A, name: 'A', inputs: { tagesgeld: 90000 }, tranches: [] }, { profileId: B, name: 'B', inputs: { tagesgeld: 10000 }, tranches: [] }];
    const inputData = { floorBedarf: 17000, flexBedarf: 0 };
    const current = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: true, mode: 'proportional' });
    const next = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: true, mode: 'proportional', nextYear: { currentAid: current } });
    assert(Math.abs((next?.total || 0) - second.logData.hilfe_zur_pflege) <= 1, `Befund 6: Folgejahreshilfe wie Simulator Jahr 2 (${next?.total} / ${second.logData.hilfe_zur_pflege})`);
}

// Befund 7: Der Mangel beim Grundbedarf zu Hause bleibt im Abschlussergebnis und im Beleg (Werners Rente ins Heim, beide ohne Geld).
{
    const { annualRecordStorage, computeAnnualPlanUpdate } = await import('../app/balance/balance-annual-storage.js');
    const { evaluateAnnualDraft } = await import('../app/balance/balance-annual-storage-commit.js');
    const { annualTestMarketData, annualTestNow } = await import('./helpers/balance-storage-fixtures.mjs');
    const { CONFIG } = await import('../app/balance/balance-config.js');
    const { careAidHintText } = await import('../app/shared/care-aid.js');
    setAppTestDate('2027-01-02');
    const { records, scope } = pfa2Records({ care: [null, residential], unmarried: true, cash: [0, 0], pensions: [0, 2500], clearTranches: true });
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = state.annualPeriodMetadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const { outcome } = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now: annualTestNow });
    assert(outcome.careAid?.floorGap > 0, `Befund 7: Mangel im Abschlussergebnis (${outcome.careAid?.floorGap})`);
    assert(/Grundbedarf zu Hause nicht gedeckt/.test(careAidHintText(outcome.careAid, value => String(Math.round(value)))), 'Befund 7: Hinweis aus dem Beleg nennt den Mangel');
}

// Abnahme J1 (Punkt 9): Werners Pflege (Grad 3 zu Hause) zahlt ganz der Staat. Das Liquiditätsziel bleibt wie ohne Pflege (60.000 €).
{
    const { PROFILE_TRANCHES_KEY } = await import('../app/profile/profile-state.js');
    setAppTestDate('2026-11-15');
    const target = care => {
        const { records, scope } = pfa2Records({ care: [null, care], unmarried: true, cash: [60000, 0], plan: { floorBedarf: 12000, householdWithdrawalMode: `one_carries:${IDS[0]}` } });
        const registry = JSON.parse(records.rs_profiles_v1);
        registry.profiles[IDS[1]].data[PROFILE_TRANCHES_KEY] = '[]';
        records.rs_profiles_v1 = JSON.stringify(registry);
        if (records.rs_current_profile === IDS[1]) records[PROFILE_TRANCHES_KEY] = '[]';
        const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
        return { aid: calculation.inputData.careAid?.total || 0, target: EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState).ui.zielLiquiditaet };
    };
    const without = target(null), withCare = target({ grade: 3, form: 'home-support' });
    assertEqual(`${withCare.aid} · ${withCare.target}`, `18000 · ${without.target}`, 'J1: staatlich gedeckte Pflege ändert das Liquiditätsziel nicht');
}
