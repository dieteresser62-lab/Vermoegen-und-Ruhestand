// NK-2b: Nachstellungen der Gutachten NK2C (Codex) und NK2C-Fable als Regressionstests. Nur Beispielhaushalte und erfundene Beträge.
import { couple, single, lot, A, B, YEAR } from './helpers/nk-1b-cases.mjs';
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { resolveMonteCarloDefaultDurationV1 } from '../app/simulator/monte-carlo-parameters.js';
import { observeYearOutcomesForTests } from '../app/simulator/simulator-engine-direct.js';
import { rowAllocation } from '../app/simulator/wealth-display.js';
import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { EngineAPI } from '../engine/index.mjs';
import { unpaidBasicNeed } from './helpers/nk-1-invariant.mjs';

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const flat = (id, wert, nutzung = 'vermietet') => ({ id: `w-${id}`, profileId: id, wert, nutzung, stand: '2026-01' });
const bothCare = (inputs, careA, careB, state = null) => { const meta = care => ({ active: true, grade: 3, zusatzFloorZiel: care, zusatzFloorDelta: care });
    return simulateOneYear(state || initMcRunState(inputs), inputs, YEAR, 0, null, careA + careB, { p1Alive: true, p2Alive: true, care: { p1: meta(careA), p2: meta(careB) } }, 1, EngineAPI); };

// Codex 1: Wohnrecht, 1.000 € Tagesgeld, Grundbedarf 1.000 €, keine Einkünfte, Jahressteuer 100 €. Kein Ruin: Grundbedarf bezahlt, Steuer Schuld.
{
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    base.partnership.testament.muster_martin.residenceTax = 'annual';
    Object.assign(base, { startFloorBedarf: 4000 / 3, startFlexBedarf: 0, minimumFlexAnnual: 0 });
    const alive = { p1Alive: false, p2Alive: true };
    const death = simulateOneYear(initMcRunState(base), base, YEAR, 0, null, 0, alive, 1, EngineAPI);
    const state = structuredClone(death.newState);
    for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt']) state.portfolio[key] = [];
    state.portfolio.personAccounts.forEach(account => { account.tagesgeld = 1000; account.geldmarktEtf = 0; });
    state.portfolio.liquiditaet = 1000 * state.portfolio.personAccounts.length;
    Object.assign(state, { currentAnnualPension: 0, currentAnnualPension2: 0, widowPensionP1: 0, widowPensionP2: 0 });
    state.portfolio.residenceTax = { ...state.portfolio.residenceTax, annualValue: 1000, rate: 0.1, allowanceRemaining: 0, annualTax: 100 };
    const inputs = { ...base, renteMonatlich: 0, partner: { ...base.partner, monatsrente: 0, brutto: 0 }, fixedIncome: [] };
    let coverage = null;
    observeYearOutcomesForTests(outcome => { coverage = outcome?.basicCoverage || coverage; });
    const year = simulateOneYear(state, inputs, YEAR, 1, null, 0, alive, 1, EngineAPI);
    observeYearOutcomesForTests(null);
    assertEqual(`${year.kind} · ${year.logData.entnahme_effektiv} · ${year.logData.steuer_offen}`, 'success · 1000 · 100', 'Codex 1: Grundbedarf bezahlt, Wohnrechtsteuer wird Schuld');
    assert(!year.logData.immobilien_notverkauf && unpaidBasicNeed(year.logData) === null, 'Codex 1: kein Notverkauf, Grundbedarf nachweislich bezahlt');
}

// Codex 2 und Fable P2-2: zwei Pflegebedürftige mit je einer vermieteten Wohnung. Beide werden vor der Hilfe verkauft.
{
    const codex = bothCare(couple({ mode: `one_carries:${A}`, cash: [12000, 0], home: [flat(A, 100000), flat(B, 100000)] }), 10000, 10000);
    assertEqual(`${codex.logData.immobilienverkauf_personen.map(row => row.profileId).sort().join()} · ${codex.logData.hilfe_zur_pflege ?? 0}`, `${A},${B} · 0`,
        'Codex 2: beide Wohnungen verkauft, keine Hilfe');
    const fable = bothCare(couple({ cash: [0, 0], home: [flat(A, 300000), flat(B, 200000)] }), 30000, 30000);
    assertEqual(`${fable.logData.immobilienverkauf_personen.length} · ${fable.logData.hilfe_zur_pflege ?? 0}`, '2 · 0', 'Fable P2-2: beide verkauft, keine Hilfe');
}

// Fable P3-6: verheiratet, B hat die höheren Pflegekosten. Zuerst Bs Wohnung; reicht das, bleibt As Wohnung.
{
    const result = bothCare(couple({ status: 'married', cash: [15000, 0], home: [flat(A, 300000), flat(B, 200000)] }), 1000, 20000);
    assertEqual(result.logData.immobilienverkauf_personen.map(row => row.profileId).join(), B, 'Fable P3-6: Immobilie der Person mit den höheren Pflegekosten zuerst');
}

// Fable P2-1: Einzelperson, Grundbedarf 1.000 €, 1.400 € Tagesgeld, Altschuld 263,75 €, Haus 1 Mio. €. Die Schuld geht der Einmalausgabe vor.
{
    const inputs = single({ cash: 1400, floor: 1000 });
    Object.assign(inputs, { home: [flat(inputs.simulationPeople[0].profileId, 1000000, 'selbst')], homeReferenceYear: 2026, plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'ausgabe', monat: '2026-06', betrag: 200, bezeichnung: 'Ausgabe' }] });
    const state = initMcRunState(inputs);
    state.portfolio.personAccounts[0].openTax = 263.75;
    const year = simulateOneYear(state, inputs, YEAR, 0, null, 0, null, 1, EngineAPI);
    assertEqual(`${year.kind} · ${year.logData.immobilien_notverkauf ?? false} · ${year.logData.steuer_offen ?? 0} · ${year.logData.geplante_ausgaben_gekuerzt}`,
        'success · false · 0 · 200', 'Fable P2-1: Schuld bezahlt, Ausgabe entfällt, kein Notverkauf');
}

// Fable P2-3, P3-4 und Punkt 18/19 nach dem Wortlaut: Helga und Werner unverheiratet, Werner Grad 4 im Heim, Startwert 12345.
{
    const heim = records => { const registry = JSON.parse(records.rs_profiles_v1);
        Object.assign(registry.profiles.muster_werner.data, { profile_care_grade_today: '4', profile_care_form_today: 'residential', profile_care_residential_since: '2023-01' });
        records.rs_profiles_v1 = JSON.stringify(registry); Object.assign(records, registry.profiles[records.rs_current_profile].data);
        records[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { muster_helga: 0, muster_werner: 0 } }); return records; };
    const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', heim);
    const runOf = async index => (await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 1000,
        maxDauer: resolveMonteCarloDefaultDurationV1(inputs) }, widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: index, count: 1 },
        logIndices: [index] })).runMeta[0].logDataRows;
    const item = (row, id) => row.personalPayout?.items?.find(entry => entry.profileId === id);
    const homeFloor = row => row.floor_brutto - (row.pflege_heimkosten || 0) - (row.pflege_heim_eigene_ausgaben || 0) - (row.pflege_zusatz_floor || 0);
    const run280 = await runOf(280);
    const covered = run280.filter(row => row.partner_grundbedarf?.length);
    assert(covered.length > 0 && covered.every(row => Math.abs(row.partner_grundbedarf[0].amount - (homeFloor(row) - item(row, 'muster_helga').amount)) < 1),
        'Fable P2-3: Werner deckt nur Helgas Grundbedarfslücke, nie ihren Flex (Lauf 280)');
    const run0 = await runOf(0);
    const death = run0.findIndex(row => row.Person2Alive === 0);
    const deathRow = run0[death];
    assert(death > 0 && Math.abs(item(deathRow, 'muster_werner').planned - deathRow.CareP2_HeimKosten - deathRow.CareP2_HeimEigeneAusgaben) < 1,
        `Fable P3-4: Im Todesjahr zahlt Werner nur sein Heim (Jahr ${death + 1})`);
}
{
    const IDS = ['muster_helga', 'muster_werner'];
    const make = (cash, pension) => records => { const registry = JSON.parse(records.rs_profiles_v1);
        for (const [i, id] of IDS.entries()) { const data = registry.profiles[id].data; for (const key of Object.keys(data)) if (key.startsWith('profile_care_')) delete data[key];
            Object.assign(data, { profile_tagesgeld: String(cash[i]), profile_rente_monatlich: String(pension[i]), depot_tranchen: '[]', profile_kirchensteuer_pct: '0' });
            delete data.profile_health_bucket;
            if (i === 1) Object.assign(data, { profile_care_grade_today: '4', profile_care_form_today: 'residential', profile_care_residential_since: '2023-01' }); }
        records.rs_profiles_v1 = JSON.stringify(registry); Object.assign(records, registry.profiles[records.rs_current_profile].data);
        records[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { muster_helga: 0, muster_werner: 0 } }); return records; };
    const year = async (cash, pension) => { const inputs = await measurementInputs(0, 'helga-werner', '2026-11-15', 'grund', make(cash, pension));
        let coverage = null; observeYearOutcomesForTests(outcome => { coverage = outcome?.basicCoverage || coverage; });
        const result = simulateOneYear(initMcRunState(inputs), { ...inputs, equityCostPct: 0 }, YEAR, 0, null, 0, null, 1, EngineAPI);
        observeYearOutcomesForTests(null); return { result, coverage }; };
    // Werners Rente (30.000 €) zahlt zuerst sein Heim; Helga hat nichts: echter Mangel, kein Verstoß gegen Punkt 13.
    const poor = await year([0, 0], [0, 2500]);
    assert(poor.result.kind === 'ruin' && poor.coverage.money + 0.01 < poor.coverage.need, `Punkt 18/19: Rente ins Heim, Helgas Grundbedarf ungedeckt, echter Mangel (${poor.coverage.need})`);
    // Mit Werners Geld: Rente ins Heim, sein Geld deckt Helgas Grundbedarf.
    const rich = await year([0, 60000], [0, 2500]);
    assertEqual(`${rich.result.kind} · ${rich.result.logData.partner_grundbedarf?.[0]?.amount}`, 'success · 27000', 'Punkt 18/19: Werners Geld deckt Helgas Grundbedarf');
}

// Codex 5: Ansparphase, kein Geld, eigene Immobilie 100.000 €, Altschuld 500 €. Verkauf wie im Entnahmepfad; die Schuld wird bezahlt.
{
    const inputs = single({ cash: 0, floor: 0 });
    Object.assign(inputs, { accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 5, home: [flat(inputs.simulationPeople[0].profileId, 100000, 'selbst')], homeReferenceYear: 2026 });
    const state = initMcRunState(inputs);
    state.portfolio.personAccounts[0].openTax = 500;
    const year = simulateOneYear(state, inputs, YEAR, 1, null, 0, null, 1, EngineAPI);
    assertEqual(`${year.kind} · ${year.logData.Regime} · ${year.logData.immobilien_notverkauf} · ${year.logData.steuer_offen ?? 0}`, 'success · accumulation · true · 0',
        'Codex 5: Ansparphase verkauft für die fällige Altschuld');
}

// Codex 6: Wohnrecht in der Ansparphase, Jahressteuer 100 €, kein Anfangsgeld, Sparrate 1.000 €/Monat: einmal protokolliert, Nachweis bezahlt.
{
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    base.partnership.testament.muster_martin.residenceTax = 'annual';
    Object.assign(base, { startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0 });
    const alive = { p1Alive: false, p2Alive: true };
    const death = simulateOneYear(initMcRunState(base), base, YEAR, 0, null, 0, alive, 1, EngineAPI);
    const state = structuredClone(death.newState);
    for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt']) state.portfolio[key] = [];
    state.portfolio.personAccounts.forEach(account => { account.tagesgeld = 0; account.geldmarktEtf = 0; });
    state.portfolio.liquiditaet = 0;
    Object.assign(state, { currentAnnualPension: 0, currentAnnualPension2: 0, widowPensionP1: 0, widowPensionP2: 0 });
    state.portfolio.residenceTax = { ...state.portfolio.residenceTax, annualValue: 1000, rate: 0.1, allowanceRemaining: 0, annualTax: 100 };
    const inputs = { ...base, renteMonatlich: 0, partner: { ...base.partner, monatsrente: 0, brutto: 0 }, fixedIncome: [],
        accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 5 };
    const year = simulateOneYear(state, inputs, YEAR, 1, null, 0, alive, 1, EngineAPI);
    assertEqual(`${year.logData.Regime} · ${year.logData.wohnrechtsteuer} · ${year.logData.residenceTaxPayment.paidCost} · ${year.logData.residenceTaxPayment.shortfall} · ${year.logData.steuer_offen ?? 0}`,
        'accumulation · 100 · 100 · 0 · 0', 'Codex 6: am Jahresende bezahlt, einmal im Protokoll und im Zahlungsnachweis');
}

// Fable P3-9: Mit Steuerschuld zeigen die Teile den Bestand, nicht ein um die Schuld gemindertes Tagesgeld.
{
    const row = { portfolio_total_end: 0, portfolio_total_brutto: 1000, steuer_offen: 1000, wertAktien: 0, wertGold: 0, inflation_factor_cum: 1, inflation: 0 };
    close(rowAllocation(row).cash, 1000, 'Fable P3-9: Tagesgeld brutto, die Schuld steht getrennt');
}
