// NK-2c: Jahresabschluss rechnet wie der Simulator (Gutachten NK2C2 Befunde 1 bis 3). Nachstellungen mit Beispielhaushalten und erfundenen
// Beträgen, Testdatum 15.11.2026.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { couple, lot, A, B } from './helpers/nk-1b-cases.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { estimateBalanceCareAid } from '../app/balance/balance-care.js';
import { calculateHouseholdWithdrawalNeed, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { careAidHintText } from '../app/shared/care-aid.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const residential = { grade: 4, form: 'residential', residentialSince: '2023-01' };

// Befund 1: Werner im Heim mit 2.500 €/Monat Rente, beide ohne Geld. Seine Rente zahlt zuerst das Heim (31.332 €); Hilfe 1.332 € wie im
// Simulator, Helgas Grundbedarf zu Hause (27.000 €) bleibt ungedeckt und wird als Mangel genannt.
{
    const { records, scope } = pfa2Records({ care: [null, residential], unmarried: true, cash: [0, 0], pensions: [0, 2500], clearTranches: true, testDate: '2026-11-15' });
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    const aid = calculation.inputData.careAid;
    close(aid.total, 1332, 'Befund 1: Hilfe nur für den Teil des Heims, den die Rente nicht trägt');
    close(aid.floorGap, 27000, 'Befund 1: Grundbedarf zu Hause als Mangel ausgewiesen');
    assert(/Grundbedarf zu Hause nicht gedeckt: Es fehlen 27000/.test(careAidHintText(aid, value => String(Math.round(value)))), 'Befund 1: Hinweis nennt den Mangel');
    close(calculation.inputData.floorBedarf - 30000, 27000, 'Befund 1: Die Entnahme des Haushalts enthält Helgas Grundbedarf (keine stille Hilfe)');
}

// Befund 2: verheiratet, Aktienfonds 60.000 € (Einstand 600 €, Teilfreistellung 30 %), Grundbedarf 12.000 €, Pflege 18.000 €, im Folgejahr
// 12.240 € und 18.360 €. Die Folgejahreshilfe beginnt mit dem Bestand nach Verkaufssteuer (23.935,72 €), wie zwei Simulatorjahre.
{
    const fund = { ...lot(A, 60000, 600, 'equity'), tqf: 0.3 };
    const inputs = couple({ status: 'married', floor: 12000, lots: [fund] });
    inputs.jointAssessment = true;
    inputs.simulationPeople.forEach(person => { person.sparerPauschbetrag = 1000; person.kirchensteuerSatz = 0; });
    const care = amount => ({ p1Alive: true, p2Alive: true, care: { p2: { active: true, grade: 3, zusatzFloorZiel: amount, zusatzFloorDelta: amount } } });
    const year = (index, state, amount) => simulateOneYear(state, inputs, { jahr: 2000 + index, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 },
        index, null, amount, care(amount), 1, EngineAPI);
    const first = year(0, initMcRunState(inputs), 18000), second = year(1, first.newState, 18360);
    close(first.logData.portfolio_total_end, 23935.72, 'Befund 2: Simulator Jahr 1 zahlt die Verkaufssteuer, 23.935,72 € bleiben', 0.01);
    const careNeeds = { current: { homeCareAddition: 18000, total: 30000 }, next: { homeCareAddition: 18360, total: 30600, incomeAnnual: 0 },
        persons: [{ profileId: A, personal: 0, next: { personal: 0 }, nextIncome: 0 }, { profileId: B, personal: 18000, next: { personal: 18360 }, nextIncome: 0 }] };
    const profiles = [{ profileId: A, name: 'A', inputs: { tagesgeld: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }, tranches: [fund] },
        { profileId: B, name: 'B', inputs: { tagesgeld: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }, tranches: [] }];
    const inputData = { floorBedarf: 30000, jointAssessment: true };
    const current = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '' });
    const next = estimateBalanceCareAid({ careNeeds, profiles, inputData, unmarried: false, mode: '', nextYear: { currentAid: current } });
    assert(Math.abs(next.total - second.logData.hilfe_zur_pflege) <= 1, `Befund 2: Folgejahreshilfe wie Simulator Jahr 2 (${next.total.toFixed(2)} / ${second.logData.hilfe_zur_pflege.toFixed(2)})`);
}

// Befund 3: Helga 10.000 €, Werner 100.000 €, Werner im Heim, Grundbedarf 36.000 €, Flex 10.000 €. Werner zahlt sein Heim und Helgas
// Grundbedarfslücke (48.332 €), nicht ihren Flex; der Flex wird gekürzt.
{
    const { records, scope } = pfa2Records({ care: [null, residential], unmarried: true, cash: [10000, 100000], clearTranches: true, testDate: '2026-11-15',
        plan: { floorBedarf: 36000, flexBedarf: 10000 } });
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    const net = Number(EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState).ui.spending.monatlicheEntnahme) * 12;
    const need = calculateHouseholdWithdrawalNeed(calculation.profiles, { floorBedarf: calculation.inputData.floorBedarf, flexBedarf: calculation.inputData.flexBedarf });
    const split = calculateWithdrawalDistribution(calculation.profiles, { ...need, netWithdrawal: net }, 'proportional');
    close(split.items.find(item => item.profileId === IDS[1]).withdrawalAmount, 48332, 'Befund 3: Werner zahlt Heim und Grundbedarfslücke');
    close(split.items.find(item => item.profileId === IDS[0]).withdrawalAmount, 10000, 'Befund 3: Helga zahlt ihr Geld');
    close(split.flexCut?.[0]?.amount, net - 58332, 'Befund 3: Helgas Flex wird gekürzt');
    assertEqual(split.remaining, 0, 'Befund 3: keine ungedeckte Lücke');
}
