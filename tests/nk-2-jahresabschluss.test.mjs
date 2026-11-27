// NK-2 Punkte 1 und 2 (FR-84): Hilfe zur Pflege im Jahresabschluss. Nur Beispielhaushalte und erfundene Beträge, Testdatum 15.11.2026.
// J1: Helga trägt, Werner Grad 3 zu Hause ohne Geld und Einkünfte. Die Handlung ist dieselbe wie ohne Werners Pflege.
// J2: verheiratet, 30.000 € Aktienfonds (Einstand 300 €, 30 % Teilfreistellung), Grundbedarf 12.000 €, Pflege 18.000 €. Die Hilfe
// enthält den Pflegeanteil der Verkaufssteuer; Balance rechnet sie mit derselben Steuerabrechnung wie der Simulator.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { PROFILE_TRANCHES_KEY } from '../app/profile/profile-state.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope } from '../app/profile/household-plan.js';
import { capitalGainsTaxRate } from '../engine/tax-settlement.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

// Sollfall J1
{
    const run = care => {
        const { records, scope } = pfa2Records({ care: [null, care], unmarried: true, cash: [60000, 0],
            plan: { floorBedarf: 12000, householdWithdrawalMode: `one_carries:${IDS[0]}` } });
        const registry = JSON.parse(records.rs_profiles_v1);
        registry.profiles[IDS[1]].data[PROFILE_TRANCHES_KEY] = '[]';
        records.rs_profiles_v1 = JSON.stringify(registry);
        if (records.rs_current_profile === IDS[1]) records[PROFILE_TRANCHES_KEY] = '[]';
        const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
        const { ui } = EngineAPI.simulateSingleYear(calculation.engineInput, calculation.engineLastState);
        return { calculation, action: ui.action, sales: (ui.action.quellen || []).reduce((sum, source) => sum + (source.brutto || 0), 0) };
    };
    const withCare = run({ grade: 3, form: 'home-support' }), without = run(null);
    const projection = withCare.calculation.inputData.careLiquidityProjection;
    assertEqual(`${withCare.action.type} · ${withCare.sales}`, `${without.action.type} · ${without.sales}`, 'J1: Handlung und Verkäufe wie ohne Werners Pflege');
    assertEqual(withCare.calculation.inputData.careAidNext?.persons.map(row => row.profileId).join(), IDS[1], 'J1: Hilfe im Folgejahr bei Werner');
    // NK-2d (Abnahme J1): Trägt der Staat Werners Pflege in beiden Jahren ganz, gilt das Ziel wie ohne Pflege (keine Folgejahresvorschau).
    assertEqual(projection, undefined, 'J1: keine Folgejahresvorschau, Ziel wie ohne Werners Pflege');
}

// Sollfall J2
{
    const lot = { schemaVersion: 2, trancheId: 'j2-fonds', name: 'Aktienfonds J2', type: 'aktien_neu', category: 'equity', isin: 'J2FONDS', shares: 300,
        purchasePrice: 1, currentPrice: 100, marketValue: 30000, costBasis: 300, purchaseDate: '2018-01-02', tqf: 0.3, taxExempt: false };
    let stored = null;
    const j2 = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const [index, id] of IDS.entries()) {
            const data = registry.profiles[id].data;
            for (const key of Object.keys(data)) if (key.startsWith('profile_care_')) delete data[key];
            Object.assign(data, { profile_tagesgeld: '0', profile_rente_monatlich: '0', profile_kirchensteuer_pct: '0', profile_sparer_pauschbetrag: '1000',
                depot_tranchen: JSON.stringify(index === 0 ? [lot] : []) });
            if (index === 1) Object.assign(data, { profile_care_grade_today: '3', profile_care_form_today: 'home-support', profile_care_home_costs_monthly: '1500' });
            delete data.profile_health_bucket;
        }
        records.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(records, registry.profiles[records.rs_current_profile].data);
        const entry = Object.values(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries)[0];
        records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope: entry.scope ?? planScope('household', IDS), values: { ...entry.values,
            floorBedarf: 12000, flexBedarf: 0, minimumFlexAnnual: 0, jointAssessment: true } }], { now: () => new Date('2026-11-15T12:00:00Z') }).raw;
        stored = records;
        return records;
    };
    const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', j2);
    assertEqual(`${inputs.partnership?.status || 'married'} · ${inputs.jointAssessment} · ${inputs.startFloorBedarf}`, 'married · true · 12000', 'J2: verheiratet, Zusammenveranlagung');
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(stored).storage, referenceYear: 2026 });
    // Alles wird verkauft: Gewinn 29.700 €, nach Teilfreistellung 20.790 €, nach 2.000 € Sparer-Pauschbetrag 18.790 € steuerpflichtig.
    const tax = 18790 * capitalGainsTaxRate(0);
    assertEqual(calculation.careNeeds?.current.homeCareAddition, 18000, 'J2: Pflege 18.000 €');
    assert(Math.abs(calculation.inputData.careAid.total - 0.6 * tax) < 0.01,
        `J2: Hilfe = Pflegeanteil 18/30 der Verkaufssteuer (${calculation.inputData.careAid.total.toFixed(2)} statt ${(0.6 * tax).toFixed(2)})`);
    // Simulator Jahr 1 mit denselben Werten: ohne Rendite, Inflation und Fondskosten (Balance bewertet zum Testdatum).
    const year = simulateOneYear(initMcRunState({ ...inputs, equityCostPct: 0 }), { ...inputs, equityCostPct: 0 },
        { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(year.kind, 'success', 'J2 Simulator: Erfolgsjahr (die Steuer ohne Pflegebezug wird Schuld)');
    assert(Math.abs(year.logData.hilfe_zur_pflege - calculation.inputData.careAid.total) <= 1,
        `J2: Balance und Simulator nennen dieselbe Hilfe (${year.logData.hilfe_zur_pflege.toFixed(2)} / ${calculation.inputData.careAid.total.toFixed(2)})`);
    assert(Math.abs(year.logData.steuer_offen - 0.4 * tax) < 0.01, `J2 Simulator: 40 % der Steuer bleiben Schuld (${year.logData.steuer_offen.toFixed(2)})`);
}

// NK-2b (Gutachten NK2C Befund 4): J2 mit 35.000 € (Einstand 350 €). Für 30.000 € Bedarf wird alles verkauft, auch für die Steuer; diese Steuer
// zählt wieder. Gesamtsteuer (34.650 × 0,7 − 2.000) × 26,375 % = 5.869,76 €; nach den übrigen 5.000 € bleiben 869,76 €, die Hilfe sind.
{
    const lot = { schemaVersion: 2, trancheId: 'j2b-fonds', name: 'Aktienfonds J2b', type: 'aktien_neu', category: 'equity', isin: 'J2BFONDS', shares: 350,
        purchasePrice: 1, currentPrice: 100, marketValue: 35000, costBasis: 350, purchaseDate: '2018-01-02', tqf: 0.3, taxExempt: false };
    let stored = null;
    const j2b = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const [index, id] of IDS.entries()) {
            const data = registry.profiles[id].data;
            for (const key of Object.keys(data)) if (key.startsWith('profile_care_')) delete data[key];
            Object.assign(data, { profile_tagesgeld: '0', profile_rente_monatlich: '0', profile_kirchensteuer_pct: '0', profile_sparer_pauschbetrag: '1000',
                depot_tranchen: JSON.stringify(index === 0 ? [lot] : []) });
            if (index === 1) Object.assign(data, { profile_care_grade_today: '3', profile_care_form_today: 'home-support', profile_care_home_costs_monthly: '1500' });
            delete data.profile_health_bucket;
        }
        records.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(records, registry.profiles[records.rs_current_profile].data);
        const entry = Object.values(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries)[0];
        records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope: entry.scope ?? planScope('household', IDS), values: { ...entry.values,
            floorBedarf: 12000, flexBedarf: 0, minimumFlexAnnual: 0, jointAssessment: true } }], { now: () => new Date('2026-11-15T12:00:00Z') }).raw;
        stored = records;
        return records;
    };
    const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', j2b);
    const balance = buildBalanceEngineInputFromStorage({ storage: countingStorage(stored).storage, referenceYear: 2026 }).inputData.careAid?.total || 0;
    const expected = (34650 * 0.7 - 2000) * capitalGainsTaxRate(0) - 5000;
    const year = simulateOneYear(initMcRunState({ ...inputs, equityCostPct: 0 }), { ...inputs, equityCostPct: 0 },
        { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0, null, 0, null, 1, EngineAPI);
    assert(Math.abs(balance - expected) < 0.01, `J2b: Balance nennt ${balance.toFixed(2)} € Hilfe (erwartet ${expected.toFixed(2)})`);
    assert(Math.abs(year.logData.hilfe_zur_pflege - balance) <= 1, `J2b: Simulator gleich (${year.logData.hilfe_zur_pflege?.toFixed(2)})`);
}

// NK-2b (Gutachten NK2C Befund 3): Werner bekommt ab Januar 2027 Rente; die Folgejahreshilfe rechnet mit seiner Folgejahresrente.
{
    const { records, scope } = pfa2Records({ care: [null, { grade: 3, form: 'home-support', homeCostsMonthly: 1000 }], unmarried: true, cash: [60000, 0],
        plan: { floorBedarf: 12000, householdWithdrawalMode: `one_carries:${IDS[0]}` } });
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles[IDS[0]].data[PROFILE_TRANCHES_KEY] = '[]';
    Object.assign(registry.profiles[IDS[1]].data, { [PROFILE_TRANCHES_KEY]: '[]', profile_rente_monatlich: '1000', profile_rentenbeginn: '2027-01-01' });
    records.rs_profiles_v1 = JSON.stringify(registry);
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    const werner = calculation.careNeeds.persons.find(person => person.profileId === IDS[1]);
    assert(werner.nextIncome >= 12000, `Folgejahr: Werners Rente projiziert (${werner.nextIncome})`);
    assert(Math.abs(calculation.inputData.careAidNext.total - (werner.next.personal - werner.nextIncome)) < 0.01,
        `Folgejahr: Hilfe nur für den Teil, den die Rente nicht trägt (${calculation.inputData.careAidNext.total.toFixed(2)})`);
}
