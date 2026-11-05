import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { applyPartnerCareFallback, careFormForPerson } from '../app/shared/care-benefits.js';
import { allLivingInExternalCare } from '../app/simulator/simulator-home-sale.js';

const inputs = await measurementInputs(0, 'helga-werner', '2026-10-23', 'haus-pg3');
inputs.careToday = { grade: 2, form: 'home-support', progression: 'usual' };
inputs.partner.careToday = { grade: 2, form: 'family', progression: 'much_slower' };
inputs.pflegeGradeConfigs[2].careForm = 'home-support';
const params = { anzahl: 48, maxDauer: 35, blockSize: 5, seed: 12345,
    methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
const run = async input => runMonteCarloChunk({ inputs: input, engine: EngineAPI, monteCarloParams: params,
    widowOptions: input.widowOptions, useCapeSampling: false, runRange: { start: 0, count: params.anzahl },
    logIndices: Array.from({ length: params.anzahl }, (_, i) => i) });
const chunk = await run(inputs);
assertEqual(chunk.technicalInventory.technicalError, 0, 'PA-1: echte MC-Pfade sind technisch auswertbar');
const rows = chunk.runMeta.flatMap(meta => meta.logDataRows);
const death = chunk.runMeta.flatMap(meta => meta.logDataRows.filter((row, index, list) =>
    row.Person1Alive === 0 && list[index - 1]?.Person1Alive === 1 && row.Person2Alive === 1
    && row.CareP2_FamilyFallback?.reason === 'death' && !list[index - 1]?.CareP2_FamilyFallback));
assert(death.length > 0, 'PA-1: reale Sterbejahre mit erstmaligem Wechsel vorhanden');
for (const row of death) {
    assertEqual(row.pflegegeld || 0, 0, 'PA-1: Pflegegeld endet bereits im Sterbejahr des Partners');
    assert(row.CareP2_Cost > 0, 'PA-1: heutige Angehörigenpflege erhält ab Ausfall die Kostenstaffel');
}
const progression = chunk.runMeta.flatMap(meta => meta.logDataRows.filter((row, index, list) =>
    row.Person1Alive === 1 && row.Person2Alive === 1 && row.CareP1_Grade === 3 && list[index - 1]?.CareP1_Grade === 2
    && row.CareP2_FamilyFallback?.reason === 'care' && !list[index - 1]?.CareP2_FamilyFallback));
assert(progression.length > 0, 'PA-1: reale Jahre mit Partnerfortschritt von Grad 2 auf 3 vorhanden');
for (const row of progression) assertEqual(row.pflegegeld || 0, 0, 'PA-1: Partnergrad 3 beendet Pflegegeld im selben Jahr');
const bothTwo = rows.filter(row => row.Person1Alive === 1 && row.Person2Alive === 1 && row.CareP1_Grade === 2
    && row.CareP2_Grade === 2 && !row.CareP2_FamilyFallback);
assert(bothTwo.length > 0, 'PA-1: reale Paarjahre mit Partnergrad 2 vorhanden');
assertEqual(bothTwo[0].pflegegeld, 347 * 12, 'PA-1: Form heute Angehörige gilt trotz externer Grad-2-Staffel; Partnergrad 2 löst keinen Wechsel aus');
const atHome = rows.find(row => row.Person2Alive === 1 && row.CareP2_Grade <= 3 && row.CareP2_FamilyFallback);
const atHomeHousehold = { p1Alive: false, p2Alive: true, care: { p2: { active: true, grade: atHome.CareP2_Grade, familyCareFallback: atHome.CareP2_FamilyFallback } } };
assert(!allLivingInExternalCare(inputs, atHomeHousehold), 'PA-1: externe Unterstützung löst keinen Heimverkauf aus');
const residential = rows.find(row => row.Person2Alive === 1 && row.CareP2_Grade === 4);
assert(residential, 'PA-1: reale Grad-4-Zeile vorhanden');
assert(!residential.CareP2_FamilyFallback, 'PA-1: Grad 4 zeigt die bisherige Heimform');
assert(allLivingInExternalCare(inputs, { p1Alive: false, p2Alive: true, care: { p2: { active: true, grade: 4 } } }), 'PA-1: Grad 4 löst Heimverkauf wie bisher aus');

for (const [row, text] of [[death[0], 'Helga verstorben ist'], [progression[0], 'Helga selbst Pflegegrad 3 hat']]) {
    const html = renderProtocolTable([row], { source: 'mc', inputs, logDetailLevel: 'detailed' });
    assert(html.includes('Pflegeform: externe Unterstützung, weil ' + text), 'PA-1: Protokoll-ⓘ erklärt den wirklichen Wechselgrund');
}
const single = structuredClone(inputs);
single.careToday = { grade: 2, form: 'family', progression: 'usual' };
single.partner.aktiv = false;
const alone = await run(single);
const singleRows = alone.runMeta.flatMap(meta => meta.logDataRows).filter(row => row.Person1Alive === 1 && row.CareP1_Grade === 2);
assert(singleRows.length > 0, 'PA-1: reale alleinstehende Pflegejahre vorhanden');
for (const row of singleRows) {
    assert(!row.CareP1_FamilyFallback, 'PA-1: Alleinstehende wechseln nicht wegen eines fehlenden Partners');
    assert(row.pflegegeld > 0, 'PA-1: alleinstehende Angehörigenpflege behält Pflegegeld');
}
const household = { p1Alive: true, p2Alive: true, care: { p1: { active: true, grade: 2 }, p2: { active: true, grade: 3 } } };
const lasting = { ...inputs, careToday: { grade: 2, form: 'family' } };
applyPartnerCareFallback(lasting, household);
household.care.p2.active = false;
applyPartnerCareFallback(lasting, household);
assertEqual(careFormForPerson(lasting, 2, 0, household), 'home-support', 'PA-1: kein Rückwechsel nach Ende einer akuten Partnerpflege');

const historicalInputs = structuredClone(inputs);
historicalInputs.careToday.grade = 3;
const historical = backtest(historicalInputs, 2000, 2002);
assertEqual(historical.outcome.kind, 'completed', 'PA-1: Backtest bleibt ausführbar');
const first = historical.rows[0].row;
assertEqual(first.CareP2_FamilyFallback?.grade, 3, 'PA-1: Backtest berücksichtigt den heutigen Partnergrad 3 ab Jahr 1');
assertEqual(first.pflegegeld || 0, 0, 'PA-1: Backtest zahlt bei Ausfall kein Pflegegeld');
assert(first.CareP2_Cost > 0, 'PA-1: Backtest rechnet die Staffel trotz unverändertem heutigen Grad');
console.log(`PA-1 Laufbelege: ${death.length} Todesjahre, ${progression.length} Gradwechseljahre, ${bothTwo.length} Paarjahre mit Grad 2, ${singleRows.length} Einzeljahre.`);
