import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { readFX1aHash } from './helpers/fx-1a-expectations.mjs';
import { readNR1Hash } from './helpers/nr-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear, makeDefaultCareMeta } from '../app/simulator/simulator-engine-wrapper.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { rng } from '../app/simulator/simulator-utils.js';

const inputs = { ...structuredClone(fixtureInputs), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75, startFloorBedarf: 24000, startFlexBedarf: 24000,
    minimumFlexAnnual: 0, renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0,
    partner: { ...fixtureInputs.partner, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch', pflegeRampUp: 1,
    pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, pflegeMaxFloor: 100000,
    pflegeGradeConfigs: { 2: { zusatz: 12000, flexCut: .25, mortalityFactor: 0 } } };
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const care = () => ({ ...makeDefaultCareMeta(true), active: true, triggered: true, grade: 2,
    gradeLabel: 'Pflegegrad 2', zusatzFloorZiel: 12000, zusatzFloorDelta: 12000, flexFactor: .25,
    floorAtTrigger: 24000, flexAtTrigger: 24000, maxFloorAtTrigger: 100000 });
for (const [p1Care, p2Care, deceased, factor, nextFactor] of [
    [true, true, 1, .21875, .1875],
    [false, true, 1, .5, .1875],
    [true, false, 2, .5, .1875],
    [true, false, 1, .78125, .75]
]) {
    const context = { p1Alive: deceased !== 1, p2Alive: deceased !== 2,
        care: { p1: p1Care ? care() : null, p2: p2Care ? care() : null } };
    const before = JSON.stringify(context);
    const total = (p1Care ? 12000 : 0) + (p2Care ? 12000 : 0);
    const halfDeceased = (deceased === 1 ? p1Care : p2Care) ? 6000 : 0;
    const first = simulateOneYear(initMcRunState(inputs), inputs, year, 0, context.care.p1, total, context, 1, EngineAPI);
    assertEqual(first.kind, 'success', 'Pflege im Sterbejahr auswertbar');
    assertEqual(first.logData.pflege_flex_faktor, factor, 'Sterbejahr verwendet Paarfaktor vor dem Tod und Faktor danach');
    assertEqual(first.logData.floor_brutto, 24000 * .85 + total - halfDeceased, 'Sterbejahr enthält halbe Pflegekosten der verstorbenen Person');
    assertEqual(first.logData.flex_brutto_haushalt, 24000 * factor, 'Logfaktor entspricht dem tatsächlich gerechneten Flex');
    assertEqual(first.logData.CareP1_Cost + first.logData.CareP2_Cost, total - halfDeceased, 'Pflegekosten im Log entsprechen dem Grundbedarf');
    assertEqual(JSON.stringify(context), before, 'Replay-Quellzustand bleibt unverändert');
    const next = simulateOneYear(first.newState, inputs, year, 1, context.care.p1, total, context, nextFactor, EngineAPI);
    assertEqual(next.kind, 'success', 'Folgejahr auswertbar');
    assertEqual(next.logData.floor_brutto, 24000 * .7 + total - 2 * halfDeceased, 'Folgejahr enthält keine Pflegekosten der verstorbenen Person');
    assertEqual(next.logData.flex_brutto_haushalt, 24000 * nextFactor, 'Folgejahr verwendet nur den Faktor der lebenden Person');
    if ((deceased === 1 ? p2Care : p1Care)) assertEqual(next.logData.pflege_flex_faktor, .1875, 'Folgejahr protokolliert den Pflegefaktor .1875');
}

// Der gemeinsame Lebensereignispfad liefert die Pflege vor der Bereinigung an den Jahreseinstieg.
const options = normalizeWidowOptions(inputs.widowOptions);
const life = createMonteCarloLifeState(inputs, rng(12345), options);
Object.assign(life.careMetaP1, care()); Object.assign(life.careMetaP2, care());
let draws = 0;
const death = updateMonteCarloLifeEventsForYear(life, inputs, options, 0, year, 0, null, false, () => draws++ === 0 ? 0 : .999999);
assert(!life.careMetaP1.active && death.householdContext.care.p1.active, 'Lebenszustand endet, Jahreszustand behält Pflege vor dem Tod');
const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, life.careMetaP1,
    death.totalCareFloor, death.householdContext, death.effectiveFlexFactor, EngineAPI);
assertEqual(result.logData.pflege_flex_faktor, .21875, 'Sweep/Auto-Optimize erhalten denselben gemittelten Faktor');
assertEqual(result.logData.floor_brutto, 24000 * .85 + death.householdContext.care.p1.zusatzFloorZiel * .5
    + death.householdContext.care.p2.zusatzFloorZiel, 'Gemeinsamer Lebensereignispfad erhält die halben Pflegekosten');

// Ausgangsstand f3e81bd2: alle Ergebnisbytes außer den drei separat geänderten Ausgabetexten.
const healthyInputs = { ...structuredClone(fixtureInputs), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75, pflegefallLogikAktivieren: false };
const healthyContext = { p1Alive: false, p2Alive: true, care: { p1: null, p2: null } };
const healthyDeath = simulateOneYear(initMcRunState(healthyInputs), healthyInputs, year, 0, null, 0, healthyContext, .75, EngineAPI);
const healthyNext = simulateOneYear(healthyDeath.newState, healthyInputs, year, 1, null, 0, healthyContext, .75, EngineAPI);
const unchangedBytes = JSON.stringify([healthyDeath, healthyNext], (key, value) =>
    ['kuerzungQuelle', 'anmerkung', 'CutReason'].includes(key) ? undefined : value);
assertEqual(createHash('sha256').update(unchangedBytes).digest('hex'), readQSCReferences(readVF2BReferences(readGL1References(readEP1Hash(readNR1Hash(readFX1aHash('2a3cd8f4f5edbbd3e164f64bbdb10e3903037a6c37275c60c61d67fe31be3962')))))),
    'Tod ohne Pflege: Sterbe- und Folgejahr mit belegten Text- und Nachlassprotokollfolgen');

// B2: halbe Pflegekosten dürfen im Sterbejahr aus der Reserve bezahlt werden.
{
    const reserveInputs = { ...inputs, startVermoegen: 74000, depotwertAlt: 0, einstandAlt: 0,
        tagesgeld: 74000, geldmarktEtf: 0, detailledTranches: [], simulationPeople: undefined, goldStrategyDiagnostics: undefined,
        startFlexBedarf: 0, goldAktiv: false, goldWert: 0,
        healthBucket: { enabled: true, initialAmount: 50000, triggerMinGrade: 2, triggerMode: 'OR',
            coverageMode: 'care_additional_floor_only', returnMode: 'cash_return' } };
    const context = { p1Alive: false, p2Alive: true, care: { p1: care(), p2: null } };
    const snapshot = JSON.stringify(context);
    const state = initMcRunState(reserveInputs);
    const result = simulateOneYear(state, reserveInputs, year, 0, context.care.p1, 12000, context, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Reserve deckt den Fehlbetrag im Sterbejahr');
    assert(result.logData.health_bucket_used > 0, 'Reserve löst mit dem Pflegegrad vor dem Tod aus');
    assert(result.logData.health_bucket_used <= 6000, 'Reserve zahlt höchstens die halben Jahrespflegekosten');
    assertEqual(result.logData.health_bucket_used, result.logData.health_bucket_eligible_need, 'Reserve deckt den gesamten berechtigten Fehlbetrag');
    const bucket = result.newState.portfolio.healthBucketGeldmarkt;
    simulateOneYear(result.newState, reserveInputs, year, 1, context.care.p1, 12000, context, 1, EngineAPI);
    assertEqual(result.newState.portfolio.healthBucketGeldmarkt, bucket, 'Folgejahr zahlt nichts mehr für die verstorbene Person');
    assertEqual(JSON.stringify(context), snapshot, 'Reserve verändert den Jahrespflegebeleg nicht');
}

// B4: nur der laufende Zuwachs wird halbiert, die Vorjahre bleiben erhalten.
{
    const { buildCareLogFields } = await import('../app/simulator/simulator-care-log.js');
    const meta = { ...care(), zusatzFloorDelta: 2000, log_delta_flex: 6000, kumulierteKosten: 30000 };
    const before = JSON.stringify(meta);
    const fields = buildCareLogFields({ hasPartner: true, p1Alive: false, p2Alive: true,
        careMetaP1: meta, careMetaP2: null, deathThisYear: true });
    assertEqual(fields.pflege_kumuliert, 26000, 'Vorjahre 22.000 plus halber laufender Zuwachs 4.000');
    assertEqual(fields.pflege_delta_flex, 3000, 'Halber Flexverlust im Sterbejahr');
    assertEqual(fields.CareP1_Cost, 6000, 'Halbe Pflegekosten im Sterbejahr');
    assertEqual(JSON.stringify(meta), before, 'Diagnose ändert keine Rechenwerte');
    assertEqual(life.p1CareYears, .5, 'Gemeinsamer Lebensereignispfad zählt halbes P1-Pflegejahr');
    assertEqual(life.p2CareYears, 1, 'Überlebende Person zählt volles Pflegejahr');
    assertEqual(life.bothCareYears, .5, 'Überlappende Pflege endet nach einem halben Jahr');
}
