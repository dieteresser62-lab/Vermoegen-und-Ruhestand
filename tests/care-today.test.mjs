import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
const readMD2References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readMD2References as readBeforeEV1bReferences } from './helpers/md-2-expectations.mjs';
import { readZG1References as readBeforeMD2References } from './helpers/zg-1-expectations.mjs';
const readZG1References = value => readMD2References(readBeforeMD2References(value));
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences as readBeforePA1References } from './helpers/vf-2b-expectations.mjs';
import { readPA1References } from './helpers/pa-1-expectations.mjs';
const readVF2BReferences = value => readQSCReferences(readPA1References(readBeforePA1References(value)));
import { protocolAnnualTotals, protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture, runFixture } from './extended/parity-replay-fixture.mjs';
import { makeDefaultCareMeta, updateCareMeta, computeCareMortalityMultiplier, initMcRunState,
    simulateOneYear, endCareForDeceased } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { CARE_BENEFITS_2026 } from '../app/shared/care-benefits.js';
import { evaluateHealthBucketTrigger } from '../app/simulator/simulator-health-bucket.js';
import { PFLEGE_GRADE_PROGRESSION_PROBABILITIES } from '../app/simulator/simulator-data.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const today = (extra = {}) => ({ grade: 2, additionalMonthly: null, progression: 'usual', allowanceAsIncome: false, ...extra });
const base = () => ({ ...structuredClone(fixture), startAlter: 60, geschlecht: 'm',
    partner: { ...fixture.partner, aktiv: true, startAlter: 63, geschlecht: 'w' },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'akut', pflegeMinDauer: 1, pflegeMaxDauer: 1,
    pflegeKostenDrift: .035, pflegeRegionalZuschlag: .1, pflegeMaxFloor: 1000000, pflegeRampUp: 5,
    pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map((grade, i) => [grade,
        { zusatz: [6000, 12000, 18000, 32000, 60000][i], flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: [1.5, 2, 3, 4, 5][i] }])),
    careToday: today() });
const year = { jahr: 2000, inflation: 2, rendite: .04, gold_eur_perf: 0, zinssatz: .02, lohn: 0 };
const create = inputs => makeDefaultCareMeta(inputs.pflegefallLogikAktivieren, inputs.geschlecht, inputs.careToday, inputs.startAlter, inputs);
const noDraw = () => { throw new Error('Kein Eintritt und kein Fortschritt in Jahr 1.'); };

{
    const inputs = base(), care = create(inputs);
    assert(care.active && care.triggered, 'Person 60 startet aktiv und triggered mit heutigem Grad');
    assertEqual(care.startAge, 60, 'Startalter ist das heutige Alter, auch unter 65');
    updateCareMeta(care, inputs, 60, year, noDraw, initMcRunState(inputs), 0);
    assertEqual(care.grade, 2, 'Jahr 1 bleibt im heutigen Grad');
    assertClose(care.zusatzFloorZiel, 0, 1e-8, 'Heutiger Grad: keine Zusatzkosten, auch bei Regionalfaktor');
    assertEqual(care.flexFactor, 1, 'PG2 erhält nach FR-39 den vollen Flex');
    assertEqual(computeCareMortalityMultiplier(care), 2, 'Sterblichkeitsfaktor gilt ab Jahr 1');
    const trigger = evaluateHealthBucketTrigger({ inputs: { ...inputs,
        healthBucket: { enabled: true, initialAmount: 100000, triggerMinGrade: 2, triggerMode: 'OR' } },
        householdContext: { p1Alive: true, p2Alive: true, care: { p1: care } } });
    assertEqual(trigger.triggered, true, 'Heutiger Grad löst die Pflegereserve ab Jahr 1 wie ein gezogener Eintritt aus');
    updateCareMeta(care, inputs, 61, year, () => .999, { cumulativeInflationFactor: 1.02, baseFloor: 24000, baseFlex: 12000 }, 1);
    assert(care.active, 'Heutige Pflege bleibt trotz akutem Einjahresmodell dauerhaft');
    assertClose(care.zusatzFloorZiel, 0, 1e-8, 'Heutiger Grad bleibt auch mit Inflation ohne Zusatzkosten');
}
{
    const inputs = { ...base(), careToday: today({ additionalMonthly: 0 }) }, care = create(inputs);
    updateCareMeta(care, inputs, 60, year, noDraw, {}, 0);
    assertEqual(care.zusatzFloorZiel, 0, 'Explizite Mehrkosten 0 bleiben 0');
    updateCareMeta(care, inputs, 61, year, () => 0, { cumulativeInflationFactor: 1.02 }, 1);
    assertEqual(care.grade, 3, 'Fortschritt frühestens ab Jahr 2');
    assertClose(care.zusatzFloorZiel, 18000 * 1.02 * 1.035 * 1.1, 1e-8, 'Nach Fortschritt gilt die volle neue Staffel');
    assertEqual(care.flexFactor, .5, 'Nach Fortschritt greift PG3-Flex');
}
for (const [progression, multiplier] of [['usual', 1], ['slower', .5], ['much_slower', .25]]) {
    const inputs = { ...base(), careToday: today({ progression }) }, care = create(inputs);
    let draws = 0;
    updateCareMeta(care, inputs, 60, year, noDraw, {}, 0);
    assertEqual(computeCareMortalityMultiplier(care), 1 + multiplier, `${progression}: nur Übersterblichkeit skaliert`);
    updateCareMeta(care, inputs, 61, year, () => { draws++; return .2; }, {}, 1);
    assertEqual(care.grade, progression === 'usual' ? 3 : 2, `${progression}: gleiche Ziehung gegen skalierte Wahrscheinlichkeit`);
    updateCareMeta(care, inputs, 62, year, () => { draws++; return 0; }, {}, 2);
    assertEqual(computeCareMortalityMultiplier(care), care.grade === 4 ? 4 : 3, 'Nach Fortschritt normale Sterblichkeit');
    for (let n = 3; n < 12; n++) updateCareMeta(care, inputs, 60 + n, year, () => { draws++; return progression === 'usual' ? 0 : .999; }, {}, n);
    assertEqual(draws, 11, `${progression}: exakt eine Ziehung je Folgejahr, auch nach PG5`);
}
// FR-45 ergänzt: Die verringerte Wahrscheinlichkeit bleibt nach jedem Wechsel;
// die verringerte Übersterblichkeit endet dagegen beim ersten Wechsel.
for (const [progression, factor] of [['usual', 1], ['slower', .5], ['much_slower', .25]]) {
    for (let initialGrade = 1; initialGrade <= 4; initialGrade++) {
        const inputs = { ...base(), careToday: today({ grade: initialGrade, progression }) }, care = create(inputs);
        updateCareMeta(care, inputs, 60, year, noDraw, {}, 0);
        let yearIndex = 1;
        for (let grade = initialGrade; grade < 5; grade++) {
            const probability = PFLEGE_GRADE_PROGRESSION_PROBABILITIES[grade] * factor;
            updateCareMeta(care, inputs, 60 + yearIndex, year, () => probability, {}, yearIndex++);
            assertEqual(care.grade, grade, `${progression}, Start PG${initialGrade}: kein Fortschritt an PG${grade}-Grenze`);
            updateCareMeta(care, inputs, 60 + yearIndex, year, () => probability - 1e-9, {}, yearIndex++);
            assertEqual(care.grade, grade + 1, `${progression}, Start PG${initialGrade}: Faktor ${factor} auch in PG${grade}`);
            assertEqual(computeCareMortalityMultiplier(care), inputs.pflegeGradeConfigs[grade + 1].mortalityFactor,
                `${progression}: Übersterblichkeit in neuem PG${grade + 1} bleibt normal`);
        }
    }
}
{
    const controls = JSON.parse(readFileSync(new URL('./fixtures/lv-1-care-controls.json', import.meta.url), 'utf8'));
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for (const { couple, variant, mcSha256, backtestSha256 } of controls.cases) {
        const input = base();
        if (!couple) input.partner = { aktiv: false };
        if (variant === 'none') delete input.careToday;
        else input.careToday = today({ grade: variant === 'zero' ? 0 : 2, progression: variant === 'zero' ? 'slower' : variant });
        if (mcSha256) {
            const chunk = await runMonteCarloChunk({ inputs: input,
                monteCarloParams: { anzahl: 4, maxDauer: 35, methode: 'regime_markov', blockSize: 3,
                    seed: 12345, rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
                logIndices: [0, 1, 2, 3], widowOptions: input.widowOptions, useCapeSampling: false, engine: EngineAPI });
            assertEqual(hash(chunk), readEV1References(readQSCReferences(readVF2BReferences(mcSha256))), `${variant}, Paar ${couple}: vollständiges MC-Ergebnis mit belegten PA-1-Folgen`);
        }
        const historical = runFixture({ input, selectedPeriod: { startYear: 2000, endYear: 2011 } });
        assertEqual(hash(historical), readQSCReferences(readVF2BReferences(backtestSha256)), `${variant}, Paar ${couple}: vollständiger Backtest bytegleich zu vor LV-1`);
    }
}
{
    const inputs = { ...base(), careToday: today({ allowanceAsIncome: true }) }, care = create(inputs);
    updateCareMeta(care, inputs, 60, year, noDraw, {}, 0);
    const income = (meta, alive = true, deathThisYear = false, factor = 1) => calculateFixedIncomeForYear({
        inputs: { ...inputs, fixedIncome: [] }, state: {}, yearIndex: 0, inflationFactor: factor,
        household: { p1Alive: alive, p2Alive: true }, deathThisYear, care: { p1: meta } });
    assertEqual(income(care).total, 347 * 12, 'Pflegegeld aus der gemeinsamen BMG-Tabelle');
    assertEqual(income(care).persons[0].profileId, inputs.simulationPeople[0].profileId, 'Pflegegeld gehört der betroffenen Person');
    assertClose(income(care, true, false, 1.02).total, 347 * 12 * 1.02, 1e-9, 'Pflegegeld wird nur mit Inflation fortgeschrieben');
    assertEqual(income(care, false, true).total, 347 * 6, 'Im Sterbejahr zählt das halbe Pflegegeld');
    assertEqual(income(care, false, false).total, 0, 'Nach dem Tod kein Pflegegeld');
    updateCareMeta(care, inputs, 61, year, () => 0, {}, 1);
    assertEqual(income(care), null, 'PG3 ist vorsichtig extern: kein Pflegegeld');
    inputs.pflegeGradeConfigs[3].careForm = 'family';
    assertEqual(income(care).pflegegeld, 599 * 12, 'PG3 zu Hause erhält Pflegegeld auch nach Fortschritt');
    inputs.pflegeKostenStaffelPreset = 'amtlich';
    assertEqual(income(care), null, 'Amtlicher Durchschnitt bleibt netto und ohne Pflegegeld');
    delete inputs.pflegeKostenStaffelPreset;
    endCareForDeceased(care, false);
    assert(!care.active && !care.initialGrade, 'Tod beendet auch den heutigen Pflegezustand');
}
{
    const inputs = base(), healthy = { ...inputs }; delete healthy.careToday;
    const a = createMonteCarloLifeState(inputs, rng(12345)), b = createMonteCarloLifeState(healthy, rng(12345));
    for (let n = 0; n < 12; n++) {
        const args = [inputs.widowOptions, n, year, 0, null, false, () => .999999, {}];
        updateMonteCarloLifeEventsForYear(a, inputs, ...args);
        updateMonteCarloLifeEventsForYear(b, healthy, ...args);
        assertEqual(JSON.stringify(a.careMetaP2), JSON.stringify(b.careMetaP2), 'Partner ohne heutigen Grad behält seinen Pflege-Zufallsstrom');
    }
}
{
    const inputs = { ...base(), pflegefallLogikAktivieren: false, careToday: today({ additionalMonthly: 0, allowanceAsIncome: true }) };
    const fixed = fixedCareTodayForYear(inputs, initMcRunState(inputs), 20);
    assertEqual(fixed.pflegeMeta.grade, 2, 'Backtest behält den heutigen Grad auch in Jahr 21');
    assertEqual(fixed.pflegeMeta.zusatzFloorZiel, 0, 'Backtest ergänzt keine heutigen Kosten');
    assertEqual(fixed.pflegeMeta.floorAtTrigger, inputs.startFloorBedarf, 'Backtest behält den Grundbedarfsanker auch ab Jahr 2');
    let result;
    const backtest = runFixture({ input: inputs, selectedPeriod: { startYear: 2000, endYear: 2011 },
        simulate(...args) { result = simulateOneYear(...args); return result; } });
    assertEqual(backtest.rows.length, 12, 'Historischer Runner rechnet alle Jahre ohne Todesziehung');
    for (const row of backtest.rows) {
        assertEqual(row.row.CareP1_Grade, 2, 'Backtest zieht keinen Fortschritt');
        assertClose(row.row.pflegegeld, 347 * 12 * row.row.inflation_factor_cum, 1e-7, 'Backtest erhält Pflegegeld in jedem Jahr');
    }
    assertEqual(result.kind, 'success', 'Backtest bleibt auswertbar');
    // Bedarf komplett gedeckt: reales Konto muss den Überschuss erhalten.
    const surplusInputs = { ...inputs, startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0,
        renteMonatlich: 0, partner: { aktiv: false }, fixedIncome: [], dynamicFlex: false };
    const single = simulateOneYear(initMcRunState(surplusInputs), surplusInputs, year, 0, null, 0, null, 1, EngineAPI);
    assertEqual(single.logData.einkuenfte_gespart, 347 * 12, 'Nicht verbrauchtes Pflegegeld wird nach FR-42 gespart');
}
{
    const inputs = base(), params = { anzahl: 4, maxDauer: 8, methode: 'block', blockSize: 1, seed: 12345 };
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, logIndices: new Set([0, 1, 2, 3]),
        widowOptions: inputs.widowOptions, useCapeSampling: false, engine: EngineAPI });
    assertEqual(chunk.financialMetricsValid, true, 'MC mit heutigem Grad ist auswertbar');
    for (const meta of chunk.runMeta) {
        const first = meta.logDataRows.find(row => row.recordType === 'financial_year');
        assertEqual(first.CareP1_Grade, 2, 'MC startet jede Person mit dem heutigen Grad');
        assertClose(first.CareP1_Cost, 0, 1e-8, 'MC-Jahr 1 ergänzt keine heutigen Kosten');
    }
    let observed = 0;
    const engine = { ...EngineAPI, simulateSingleYear(input, ...rest) {
        if (input.aktuellesAlter === 60) { observed++; assertClose(input.floorBedarf, inputs.startFloorBedarf, 1e-7, 'Sweep verrechnet Pflegegeld ohne heutige Zusatzkosten'); }
        return EngineAPI.simulateSingleYear(input, ...rest);
    } };
    const sweep = runSweepChunk({ baseInputs: inputs,
        paramCombinations: [{ liquidityRunwayYears: 3, goldRebalancingBand: 20, maxSkimPct: 10, maxBearRefillPct: 5, goldTargetPct: 0 }],
        sweepConfig: { anzahlRuns: 4, maxDauer: 8, blockSize: 1, baseSeed: 12345, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, engine });
    assertEqual(sweep.results[0].metrics.invalidCombination, undefined, 'Sweep mit heutigem Grad ist auswertbar');
    assertEqual(observed, 4, 'Sweep prüft Jahr 1 aller vier Pfade');
}
assertEqual(Object.values(CARE_BENEFITS_2026).map(row => row.allowance).join('/'), '0/347/599/800/990', 'BMG 2026: Pflegegeld PG1–5');

// FR-47 gilt auch für gezogenen Eintritt und je Person, ohne heutige Pflegefelder.
{
    const inputs = base(); delete inputs.careToday;
    inputs.pflegeGradeConfigs[3].careForm = 'family';
    const result = calculateFixedIncomeForYear({ inputs: { ...inputs, fixedIncome: [] }, state: {}, yearIndex: 5,
        inflationFactor: 1.2, household: { p1Alive: true, p2Alive: false }, deathThisYear: true,
        care: { p1: { active: true, grade: 2 }, p2: { active: true, grade: 3 } } });
    assertClose(result.pflegegeld, 599 / 2 * 12 * 1.2, 1e-8, 'PA-1: Nach Partnertod entfällt Pflegegeld der lebenden Person bereits im Sterbejahr');
    assertEqual(result.pflegegeld_personen.length, 1, 'PA-1: Nur die verstorbene Person erhält noch ein halbes Pflegegeldjahr');
}

{
    const row = { jahr: 1, recordType: 'financial_year', financiallyEvaluable: true,
        renteSum: 12000, sonstige_einkuenfte: 14164, sonstige_einkuenfte_personen: [{ profileId: 'max', amount: 14164 }],
        pflegegeld: 4164, pflegegeld_personen: [{ profileId: 'max', amount: 4164 }], zufluss: 2000,
        entscheidung: { jahresEntnahme: 0 } };
    assertEqual(protocolAnnualTotals(row).einnahmen_gesamt, 28164, 'Einnahmen enthält Pflegegeld genau einmal');
    const details = protocolCashflowBreakdown(row, { inputs: { simulationPeople: [{ profileId: 'max', name: 'Max' }] } });
    assertEqual(details.incomes.find(item => item.label === 'Pflegegeld Max').amount, 4164, 'Einnahmen-Info zeigt Pflegegeld als eigene Zeile');
    assertEqual(details.incomes.find(item => item.label === 'Sonstige Einkünfte Max').amount, 10000, 'Info trennt Pflegegeld vom bestehenden sonstigen Summenfeld');
    assertEqual(details.incomes.reduce((sum, item) => sum + item.amount, 0), 28164, 'Infozeilen stimmen mit Einnahmensumme überein');
    const document = projectScenarioLogV2([row]);
    const exported = JSON.parse(serializeScenarioLogExportV2(document)).records[0];
    assertEqual(exported.pflegegeld, 4164, 'MC-JSON erhält neues Pflegegeldfeld');
    assertEqual(exported.pflegegeld_personen[0].profileId, 'max', 'MC-JSON erhält persönliche Pflegegeldzuordnung');
    const csv = serializeScenarioLogCsvV2(document);
    assert(csv.split('\r\n')[0].split(';').includes('pflegegeld_personen'), 'MC-CSV enthält Pflegegeld samt Personenzuordnung');
}
