import { readLE1References } from './helpers/le-1-expectations.mjs';
import { readGU1References } from './helpers/gu-1-expectations.mjs';
import { readPFA1References } from './helpers/pfa-1-expectations.mjs';
const readEV1bReferences = value => readPFA1References(beforePFA1References(value));
import { readEV1bReferences as beforePFA1References } from './helpers/ev-1b-expectations.mjs';
const readMD2References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readMD2References as readBeforeEV1bReferences } from './helpers/md-2-expectations.mjs';
import { readZG1References as readBeforeMD2References } from './helpers/zg-1-expectations.mjs';
const readZG1References = value => readMD2References(readBeforeMD2References(value));
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAS1Hash } from './helpers/as-1-expectations.mjs';
import { historicalSurvivorNeeds } from './helpers/historical-survivor-inputs.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash } from './helpers/rng-1-expectations.mjs';
import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { readEK1dHash } from './helpers/ek-1d-expectations.mjs';
import { withLegacyCareProvenance } from './helpers/pm-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { readKG1Hash } from './helpers/kg-1-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs, runFixture } from './extended/parity-replay-fixture.mjs';
import {
    advanceSimulatorCumulativeInflationFactor, initMcRunState, makeDefaultCareMeta,
    simulateOneYear, updateCareMeta
} from '../app/simulator/simulator-engine-wrapper.js';
import { PFLEGE_GRADE_PROBABILITIES } from '../app/simulator/simulator-data.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { createStressReplayCaptureRequest } from '../app/simulator/stress-replay-path-materializer.js';
import { DEFAULT_RESIDENTIAL_COMPONENTS, residentialMonthly } from '../app/shared/household-care-values.js';

const readRNG1Hash = before => readQSCReferences(readAS1Hash(readEP1Hash(readBeforeEP1Hash(before))));
const careInputs = () => ({ ...structuredClone(fixtureInputs), startAlter: 70,
    startFloorBedarf: 24000, startFlexBedarf: 12000,
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
    pflegeKostenDrift: .035, pflegeRegionalZuschlag: .1, pflegeMaxFloor: 1000000, pflegeRampUp: 5,
    pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade,
        { zusatz: grade * 2000, flexCut: 1 - grade * .2, mortalityFactor: 0 }])) });
const activeCare = () => ({ ...makeDefaultCareMeta(true), active: true, triggered: true,
    grade: 2, gradeLabel: 'Pflegegrad 2' });
const year = { jahr: 2000, inflation: 2, rendite: .04, gold_eur_perf: 0, zinssatz: .02, lohn: 0 };

// Grundbedarf und Pflege verwenden Preise am Jahresanfang. Jahr 1 ist Index 0,
// Eintritt in Jahr 9 ist Index 8: acht abgeschlossene Inflations-/Driftjahre.
{
    const inputs = careInputs();
    let state = initMcRunState(inputs);
    const care = makeDefaultCareMeta(true);
    const probabilities = PFLEGE_GRADE_PROBABILITIES[75];
    const grade2Draw = probabilities[1] + probabilities[2] / 2;
    for (let n = 0; n < 10; n++) {
        updateCareMeta(care, inputs, inputs.startAlter + n, year,
            () => n < 8 ? .999999 : n === 8 ? grade2Draw : 0, state, n);
        if (n < 8) assertEqual(care.active, false, `Kein Pflegeeintritt vor Jahr 9 (${n + 1})`);
        else {
            const grade = n === 8 ? 2 : 3;
            assertEqual(care.grade, grade, 'Eintritt in PG2, im Folgejahr Wechsel nach PG3');
            assertClose(care.zusatzFloorZiel,
                grade * 2000 * 1.02 ** n * 1.035 ** n * 1.1, 1e-7,
                `PG${grade}: heutiger Zusatz mit ${n} Preisfortschreibungen und Regionalzuschlag`);
            assertClose(care.log_floor_anchor, state.baseFloor, 0, 'Deckel zieht den tatsächlichen Jahresgrundbedarf ab');
            assertClose(care.log_delta_flex, state.baseFlex * (1 - care.flexFactor), 1e-8,
                'Flexverlust verwendet den tatsächlichen Jahresbedarf als Anker');
            assertEqual(Object.hasOwn(care, 'previousZielRoh'), false, 'Gradwechsel braucht keinen fortgeschriebenen Altgrad');
        }
        const result = simulateOneYear(state, inputs, { ...year, jahr: 2000 + n }, n,
            care, care.active ? care.zusatzFloorZiel : 0, null, 1, EngineAPI);
        assertEqual(result.kind, 'success', 'Preisprobe bleibt als echtes Simulatorjahr auswertbar');
        state = result.newState;
    }
    assertClose(care.floorAtTrigger, 24000 * 1.02 ** 8, 1e-7, 'Eintrittsanker enthält die Inflation vor Pflegebeginn');
    assertClose(care.maxFloorAtTrigger, 1000000 * 1.02 ** 8 * 1.035 ** 8, 1e-7,
        'Maximaler Pflege-Floor ist schon beim Eintritt fortgeschrieben');
}

// Wechselnde Jahresinflation darf den Deckel nicht auf die letzte Rate hoch n setzen.
for (const drift of [0, .035]) {
    const inputs = { ...careInputs(), pflegeKostenDrift: drift, pflegeMaxFloor: 60000,
        pflegeRampUp: 1, pflegeGradeConfigs: { 2: { zusatz: 1000000, flexCut: .25, mortalityFactor: 0 } } };
    const care = activeCare();
    let state = { cumulativeInflationFactor: 1, baseFloor: 24000, baseFlex: 12000 };
    let previousCap = 0;
    for (const [n, inflation] of [8, 0, 4, 0, 2, -1, 3].entries()) {
        updateCareMeta(care, inputs, 78 + n, { inflation }, () => .999999, state, n);
        const expectedMax = 60000 * state.cumulativeInflationFactor * (1 + drift) ** n;
        assertClose(care.log_maxfloor_anchor, expectedMax, 1e-7, 'Deckel nutzt das tatsächlich kumulierte Preisniveau');
        assertClose(care.zusatzFloorZiel, expectedMax - state.baseFloor, 1e-7, 'Zusatzkosten halten den fortgeschriebenen Deckel ein');
        if (n <= 5) assert(care.log_maxfloor_anchor >= previousCap, 'Ohne vorangegangene Deflation bleibt der Deckel monoton');
        previousCap = care.log_maxfloor_anchor;
        state = { cumulativeInflationFactor: advanceSimulatorCumulativeInflationFactor(state.cumulativeInflationFactor, inflation),
            baseFloor: state.baseFloor * (1 + inflation / 100), baseFlex: state.baseFlex * (1 + inflation / 100) };
    }
}

// Die Rampe zählt Pflegejahre, selbst wenn der Eintritt erst im neunten Jahr liegt.
{
    const inputs = { ...careInputs(), pflegeMaxFloor: 25000, pflegeRampUp: 5 };
    const care = activeCare();
    const state = { cumulativeInflationFactor: 1.02 ** 8,
        baseFloor: 24000 * 1.02 ** 8, baseFlex: 12000 * 1.02 ** 8 };
    inputs.pflegeGradeConfigs[2].zusatz = 20000;
    updateCareMeta(care, inputs, 78, year, () => .999999, state, 8);
    const raw = 20000 * 1.02 ** 8 * 1.035 ** 8 * 1.1;
    assertClose(care.zusatzFloorZiel, Math.min(care.log_cap_zusatz, raw / 5), 1e-7,
        'Erstes Pflegejahr behält ein Fünftel der Rampe trotz acht vorherigen Simulationsjahren');
    inputs.pflegeModellTyp = 'akut';
    care.durationYears = 1;
    updateCareMeta(care, inputs, 79, year, () => .999999, state, 9);
    assertEqual(care.active, false, 'Akute Pflege endet weiterhin nach der gezogenen Dauer');
}

// Gemeinsamer Lebensereignispfad von Sweep/Auto-Optimize: beide Personen
// erhalten denselben Haushalts-Preisstand, unabhängig von ihrem Startalter.
{
    const inputs = careInputs();
    const options = normalizeWidowOptions(inputs.widowOptions);
    const life = createMonteCarloLifeState(inputs, rng(42), options);
    Object.assign(life.careMetaP1, activeCare());
    Object.assign(life.careMetaP2, activeCare());
    life.rngCareP1 = life.rngCareP2 = () => .999999;
    const state = { cumulativeInflationFactor: 1.3, baseFloor: 31200, baseFlex: 15600 };
    updateMonteCarloLifeEventsForYear(life, inputs, options, 8, year, 0, null, false, () => .999999, state);
    for (const care of [life.careMetaP1, life.careMetaP2]) {
        assertClose(care.zusatzFloorZiel, 4000 * 1.3 * 1.035 ** 8 * 1.1, 1e-7,
            'P1/P2 erhalten im Lebensereignispfad dieselbe kumulierte Preisfortschreibung');
    }
}

const combo = { liquidityRunwayYears: 3, goldRebalancingBand: 20, maxSkimPct: 10, maxBearRefillPct: 5, goldTargetPct: 0 };
const sweepConfig = { anzahlRuns: 4, maxDauer: 12, blockSize: 1, baseSeed: 91827,
    methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };

// Echte MC- und Sweep-Aufrufe prüfen, dass ihre Pflegeaufrufe den Preisstand erhalten.
{
    const inputs = { ...careInputs(), startAlter: 80, partner: { aktiv: false }, pflegeRampUp: 1,
        pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade,
            { zusatz: 4000, flexCut: 1, mortalityFactor: 0 }])) };
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: {
        anzahl: 4, maxDauer: 12, methode: 'block', blockSize: 1, seed: 91827 },
        logIndices: [0, 1, 2, 3], useCapeSampling: false, widowOptions: inputs.widowOptions,
        stressReplayCapture: createStressReplayCaptureRequest([0, 1, 2, 3]), engine: EngineAPI });
    assertEqual(chunk.financialMetricsValid, true, 'Monte Carlo mit Pflege bleibt auswertbar');
    let observedCareYears = 0;
    for (const meta of chunk.runMeta) {
        for (const row of meta.logDataRows.filter(row => row.recordType === 'financial_year' && row.CareP1_Active)) {
            observedCareYears++;
            assertClose(row.CareP1_Cost, 4000 * row.inflation_factor_cum * 1.035 ** (row.jahr - 1) * 1.1,
                1e-7, 'Monte Carlo führt Pflegekosten ab Simulationsstart fort');
        }
    }
    assert(observedCareYears > 0, 'Fester Seed liefert beobachtbare MC-Pflegejahre');
    let sweepCareYears = 0;
    const engine = { ...EngineAPI, simulateSingleYear(input, lastState, ...rest) {
        const factor = lastState?.cumulativeInflationFactor ?? 1;
        const careAddition = input.floorBedarf - inputs.startFloorBedarf * factor;
        if (careAddition > 1) {
            sweepCareYears++;
            assertClose(careAddition, 4000 * factor * 1.035 ** (input.aktuellesAlter - inputs.startAlter) * 1.1,
                1e-7, 'Sweep führt Pflegekosten ab Simulationsstart fort');
        }
        return EngineAPI.simulateSingleYear(input, lastState, ...rest);
    } };
    const sweep = runSweepChunk({ baseInputs: inputs, paramCombinations: [combo], sweepConfig, engine });
    assertEqual(sweep.results[0].metrics.invalidCombination, undefined, 'Sweep mit Pflege bleibt auswertbar');
    assert(sweepCareYears > 0, 'Fester Seed liefert beobachtbare Sweep-Pflegejahre');

    // Nach Ruin werden für Replay weiter effektive Marktjahre gezogen.
    const ruinInputs = { ...inputs, startVermoegen: 150000, depotwertAlt: 150000, einstandAlt: 150000,
        tagesgeld: 0, geldmarktEtf: 0, detailledTranches: [], simulationPeople: undefined,
        goldStrategyDiagnostics: undefined, startFloorBedarf: 100000, startFlexBedarf: 0,
        minimumFlexAnnual: 0, renteMonatlich: 0 };
    const ruined = await runMonteCarloChunk({ inputs: ruinInputs, widowOptions: ruinInputs.widowOptions,
        monteCarloParams: { anzahl: 4, maxDauer: 12, methode: 'block', blockSize: 1, seed: 91827 },
        logIndices: [0, 1, 2, 3], stressReplayCapture: createStressReplayCaptureRequest([0, 1, 2, 3]), engine: EngineAPI });
    let shadowCareYears = 0;
    for (const meta of ruined.runMeta) {
        const capture = meta.stressReplayCapture;
        assertEqual(capture.continuation.active, true, 'Ruin aktiviert den Replay-Schattenpfad');
        let factor = 1;
        for (const record of capture.years) {
            const care = record.householdEvents[0].careMetaP1;
            if (record.continuation && care?.active) {
                shadowCareYears++;
                // FR-72 (HE-2): im Heim Heimkosten statt Staffelzusatz, mit derselben Preisfortschreibung.
                if (care.heimJahr >= 1) {
                    assertEqual(care.zusatzFloorZiel, 0, 'Pflege nach Ruin: im Heim kein Staffelzusatz');
                    assertClose(care.heimKosten, residentialMonthly(DEFAULT_RESIDENTIAL_COMPONENTS, care.heimJahr, { grade: care.grade })
                        * 12 * factor * 1.035 ** record.yearIndex * 1.1, 1e-7, 'Heimkosten nach Ruin verwenden alle tatsächlich gezogenen Inflationsjahre');
                } else assertClose(care.zusatzFloorZiel, 4000 * factor * 1.035 ** record.yearIndex * 1.1,
                    1e-7, 'Pflege nach Ruin verwendet alle tatsächlich gezogenen Inflationsjahre');
                assertClose(care.log_floor_anchor, ruinInputs.startFloorBedarf * factor, 1e-7,
                    'Grundbedarfsanker bleibt auch nach Ruin auf derselben Jahresbasis');
            }
            factor *= 1 + record.inflationPct / 100;
        }
    }
    assert(shadowCareYears > 0, 'Fester Seed liefert Pflegejahre im Replay-Schattenpfad');
}

// Vollständige JSON-Ergebnisbytes auf Basis cd34b374, vor der Quelländerung
// gemessen. Keine Felder werden ausgeblendet; je vier Pfade mit festem Seed.
const noCareHashes = {
    'single-backtest': 'ef9c701841aef6a9928b873c97d9a5ebf598a11869b94d036c4e82e72ba8cf16',
    'single-mc': '7da4803bebf64a461a08b816f9452747a61eaf4debc05496ae248fa000c13df9',
    'single-sweep': '39d7805c286cea27130234ebc8433b4cb7f6a82d29167e3b9c3e46da3393af46',
    'couple-backtest': '543dd1abccdaa2b06b6834b3368d35e8199fd33ec5e3a27dadcefae586527f06',
    'couple-mc': '110a70f8957a357870305dcac8b8f0d1f51f565c14e8a27746d3e8041527f313',
    'couple-sweep': '67c44adf6f004031bda97ba8186d149c8bbfdc37231f277d9c7146a7ebe73641'
};
for (const couple of [false, true]) {
    const inputs = { ...structuredClone(fixtureInputs), pflegefallLogikAktivieren: false };
    // Eingaben der ursprünglichen Hashmessung fixieren: vor FR-39 las der
    // Profiladapter bei fehlenden Pflegefeldern für alle Grade 100 % Flex.
    for (const config of Object.values(inputs.pflegeGradeConfigs)) config.flexCut = 1;
    if (!couple) inputs.partner = { aktiv: false };
    const outputs = {
        backtest: runFixture({ input: inputs, selectedPeriod: { startYear: 2000, endYear: 2011 } }),
        mc: await runMonteCarloChunk({ inputs: historicalSurvivorNeeds(inputs), monteCarloParams: { anzahl: 4, maxDauer: 12, blockSize: 1,
            seed: 91827, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
            widowOptions: inputs.widowOptions, useCapeSampling: false, logIndices: new Set([0, 1, 2, 3]), engine: EngineAPI }),
        sweep: runSweepChunk({ baseInputs: historicalSurvivorNeeds(inputs), paramCombinations: [combo], sweepConfig, engine: EngineAPI })
    };
    for (const [mode, result] of Object.entries(outputs)) {
        const key = `${couple ? 'couple' : 'single'}-${mode}`;
        assertEqual(createHash('sha256').update(JSON.stringify(withLegacyCareProvenance(result))).digest('hex'), readLE1References(readGU1References(readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(readAN1Hash(readEK1dHash(readKG1Hash(noCareHashes[key])))))))))),
            `${key}: vollständige Ausgabe ohne Pflege, nur vier FR-41-Herkunftsfelder zurückgeführt, samt KG-1-Texten`);
    }
}
