// NK-2 Punkt 3 (FR-84 Punkte 18 und 19): Heimeintritt bei Unverheirateten. Ab dem Heimeintritt zahlt die Person im Heim nichts zum
// Grundbedarf zu Hause; ihr Geld zahlt das Heim, den Grundbedarf zu Hause trägt die Person zu Hause allein. Fehlt dort Geld, deckt es
// die Person im Heim (Punkt 13 hat Vorrang); was sie fürs Heim nicht mehr hat, ist Hilfe zur Pflege. Beispielhaushalt Helga und Werner
// (unverheiratet, Werner heute Grad 4 im Heim, nur Tagesgeld, keine Renten, erfundene Beträge), Testdatum 15.11.2026.
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { calculateHouseholdWithdrawalNeed, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

const [HELGA, WERNER] = IDS;
const YEAR = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
const homeCase = cash => records => {
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const [index, id] of IDS.entries()) {
        const data = registry.profiles[id].data;
        for (const key of Object.keys(data)) if (key.startsWith('profile_care_')) delete data[key];
        Object.assign(data, { profile_tagesgeld: String(cash[index]), profile_rente_monatlich: '0', depot_tranchen: '[]', profile_kirchensteuer_pct: '0' });
        delete data.profile_health_bucket;
        if (id === WERNER) Object.assign(data, { profile_care_grade_today: '4', profile_care_form_today: 'residential', profile_care_residential_since: '2023-01' });
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    records[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { [HELGA]: 0, [WERNER]: 0 } });
    return records;
};
const simulate = async cash => {
    const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', homeCase(cash));
    return { inputs, year: simulateOneYear(initMcRunState(inputs), inputs, YEAR, 0, null, 0, null, 1, EngineAPI).logData };
};
const item = (log, id) => log.personalPayout.items.find(row => row.profileId === id);
const homeCosts = log => log.CareP2_HeimKosten + log.CareP2_HeimEigeneAusgaben;

// Beide haben Geld: Werner zahlt nur sein Heim, Helga den ganzen Grundbedarf zu Hause.
{
    const { inputs, year } = await simulate([50000, 50000]);
    assertEqual(`${inputs.partnership.status} · ${year.CareP2_Form}`, 'unmarried · residential', 'Heim: unverheiratet, Werner im Heim');
    assert(Math.abs(item(year, WERNER).planned - homeCosts(year)) < 0.01, `Heim: Werner zahlt nur sein Heim (${item(year, WERNER).planned})`);
    assert(item(year, HELGA).planned >= year.floor_brutto - homeCosts(year) - 0.01, 'Heim: Helga trägt den Grundbedarf zu Hause allein');
    assert(!year.hilfe_zur_pflege && !year.partner_grundbedarf, 'Heim: keine Hilfe, kein Ausgleich');
}
// Punkt 19: Helga ohne Geld. Werners Geld zahlt sein Heim, der Rest deckt Helgas Grundbedarf zu Hause.
{
    const { year } = await simulate([0, 100000]);
    const paid = year.partner_grundbedarf?.find(row => row.profileId === HELGA && row.fromProfileId === WERNER)?.amount || 0;
    assert(Math.abs(item(year, WERNER).amount - homeCosts(year)) < 0.01 && paid > 0, `Punkt 19: Werner zahlt Heim und Helgas Grundbedarf (${paid})`);
    assert(!year.hilfe_zur_pflege, 'Punkt 19: keine Hilfe, solange Werners Geld reicht');
}
// Punkt 13 vor „Heim zuerst“: Werners Geld reicht nicht für beides. Helgas Grundbedarf ist gedeckt, sein Heim teils Hilfe zur Pflege.
let simulatorAid = 0;
{
    const { year } = await simulate([0, 40000]);
    const paid = year.partner_grundbedarf?.find(row => row.profileId === HELGA)?.amount || 0;
    simulatorAid = year.hilfe_zur_pflege;
    assert(paid > 0 && Math.abs(paid + item(year, WERNER).amount - 40000) < 0.01, 'Punkt 13: Werners 40.000 € decken Helgas Grundbedarf und einen Teil des Heims');
    assert(Math.abs(year.hilfe_zur_pflege - (homeCosts(year) - item(year, WERNER).amount)) < 0.01, `Punkt 13: der Rest des Heims ist Hilfe zur Pflege (${year.hilfe_zur_pflege})`);
}
// Jahresabschluss: dieselbe Aufteilung und dieselbe Hilfe.
{
    const balance = cash => {
        const { records, scope } = pfa2Records({ care: [null, { grade: 4, form: 'residential', residentialSince: '2023-01' }], unmarried: true, cash,
            clearTranches: true, testDate: '2026-11-15' });
        const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
        const net = Number(EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState).ui.spending.monatlicheEntnahme) * 12;
        const need = calculateHouseholdWithdrawalNeed(calculation.profiles, { floorBedarf: calculation.inputData.floorBedarf, flexBedarf: calculation.inputData.flexBedarf });
        return { calculation, split: calculateWithdrawalDistribution(calculation.profiles, { ...need, netWithdrawal: net }, 'proportional') };
    };
    const even = balance([50000, 50000]);
    const werner = even.split.items.find(row => row.profileId === WERNER).withdrawalAmount;
    assertEqual(werner, even.calculation.profiles.find(row => row.profileId === WERNER).personalCareNeed, 'Jahresabschluss: Werner zahlt nur sein Heim');
    assert(!even.split.carrierId && !even.split.attacked, 'Jahresabschluss: kein Hinweis „wird angegriffen“');
    const short = balance([0, 40000]);
    assert(Math.abs(short.calculation.inputData.careAid.total - simulatorAid) < 1, `Jahresabschluss: dieselbe Hilfe wie der Simulator (${short.calculation.inputData.careAid.total})`);
}
// Monte Carlo und Backtest rechnen mit demselben Jahr: Im Backtest zahlt Werner im Heim nie zum Grundbedarf zu Hause.
{
    const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', homeCase([150000, 150000]));
    const rows = backtest(inputs, 2000, 2025).rows.map(entry => entry.row).filter(row => row?.CareP2_Form === 'residential' && item(row, WERNER) && item(row, HELGA));
    assert(rows.length > 3, `Backtest: Jahre mit Werner im Heim (${rows.length})`);
    assertEqual(rows.filter(row => item(row, WERNER).planned > homeCosts(row) + 0.01).length, 0, 'Backtest: Werners Plan enthält keinen Grundbedarf zu Hause');
}
