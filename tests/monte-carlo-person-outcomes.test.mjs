import './helpers/grundbestand-sicht-aktiv.mjs';
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk, runMonteCarloSimulation } from '../app/simulator/monte-carlo-runner.js';
import { createPersonOutcomeCounts, finalizePersonOutcomeRows, mergePersonOutcomeCounts, recordPersonOutcomes } from '../app/simulator/mc-person-outcomes.js';
import { renderMonteCarloPersonOutcomes } from '../app/simulator/mc-person-outcomes-view.js';

globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
setAppTestDate('2026-10-23');
prepareHistoricalDataOnce();
const assertDeepEqual = (actual, expected, message) => assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);

// Fiktiver Haushalt Lina und Jon mit kleinem Vermögen und Pflegegrad 1 bei Lina zu Laufbeginn.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pe-1-max-erika.json', import.meta.url), 'utf8'));
const names = ['Lina', 'Jon'];
const inputs = { ...fixture, startFloorBedarf: 75000, floorBedarf: 75000, careToday: { grade: 1, form: 'family' },
    startVermoegen: fixture.startVermoegen / 4, depotwertAlt: fixture.depotwertAlt / 4, einstandAlt: fixture.einstandAlt / 4,
    tagesgeld: fixture.tagesgeld / 4, geldmarktEtf: fixture.geldmarktEtf / 4,
    detailledTranches: fixture.detailledTranches.map(tranche => ({ ...tranche, shares: tranche.shares / 4,
        marketValue: tranche.marketValue / 4, costBasis: tranche.costBasis / 4 })),
    simulationPeople: fixture.simulationPeople.map((person, index) => ({ ...person, name: names[index], tagesgeld: person.tagesgeld / 4 }))
};
const options = { inputs, engine: EngineAPI, widowOptions: inputs.widowOptions, useCapeSampling: false,
    monteCarloParams: { anzahl: 12, maxDauer: 35, blockSize: 5, seed: 12345,
        methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' } };

// Handprotokoll, Simulationsjahre 1–35: Tod Lina, Tod Jon, Pflege Lina, Pflege Jon, Fehlschlag.
const yearsByRun = [
    [15, 22, 1, 15, 4], [9, 14, 1, null, 6], [5, 23, 1, 19, 4], [20, 23, 1, 14, 5],
    [18, 21, 1, null, 4], [5, 28, 1, 22, 4], [5, 26, 1, 19, 5], [12, 4, 1, null, null],
    [12, null, 1, 27, 5], [3, null, 1, 25, 5], [13, 24, 1, 19, 6], [11, 14, 1, 14, 5]
];
// Lina: 2/12 zu Lebzeiten (Läufe 8, 10), 10 Fehlschläge mit Pflege. Stirbt in 11 Läufen zuerst.
// Jon: 1/12 zu Lebzeiten (Lauf 8), 11 Fehlschläge mit Pflege, davon 2 mit Linas Tod (7, 10).
// Lauf 7 zählt für beide als Fehlschlag. Jon stirbt nur in Lauf 8 zuerst, Lina ist noch 8 Jahre versorgt.
// Jons 11 Restdauern nach Linas Tod: 3, 3, 3, 5, 7, 11, 18, 21, 23, 23, 32. Keiner reicht finanziell.
const expected = [
    { runs: 12, coveredWhileAlive: 2, partner: { partnerDiedByFailure: 0, careStartedByFailure: 10, neitherByFailure: 0,
        coveredForSurvivor: 0, diedFirst: 11, simultaneousDeaths: 0, medianSurvivalYears: 11 } },
    { runs: 12, coveredWhileAlive: 1, partner: { partnerDiedByFailure: 2, careStartedByFailure: 11, neitherByFailure: 0,
        coveredForSurvivor: 1, diedFirst: 1, simultaneousDeaths: 0, medianSurvivalYears: 8 } }
];
const observedYears = yearsByRun.map(() => Array(5).fill(null));
const comparisonPairing = { mode: 'record', tapes: new Map(), continuationYears: new Map(),
    onYear({ runIndex, yearIndex, p1Alive, p2Alive, careP1, careP2 }) {
        const row = observedYears[runIndex];
        if (!p1Alive) row[0] ??= yearIndex + 1;
        if (!p2Alive) row[1] ??= yearIndex + 1;
        if (careP1 > 0) row[2] ??= yearIndex + 1;
        if (careP2 > 0) row[3] ??= yearIndex + 1;
    }
};
let counts = null;
for (const start of [6, 0]) {
    const chunk = await runMonteCarloChunk({ ...options, runRange: { start, count: 6 }, comparisonPairing, collectPersonOutcomes: true });
    for (const meta of chunk.runMeta) {
        observedYears[meta.index][4] = meta.logDataRows.find(row => row.recordType === 'terminal_ruin')?.jahr ?? null;
    }
    counts = mergePersonOutcomeCounts(counts, chunk.personOutcomeCounts);
}
assertDeepEqual(observedYears, yearsByRun, 'Handprotokoll stimmt mit Lebensereignissen und Fehlschlagzeilen überein');
assertDeepEqual(finalizePersonOutcomeRows(counts), expected, 'Handzählung der Personenkarte stimmt auch über Teilpakete');
const { aggregatedResults } = await runMonteCarloSimulation({ ...options, collectPersonOutcomes: true });
assertDeepEqual(aggregatedResults.personOutcomeRows, expected, 'Der DOM-freie Ergebnispfad liefert die fertigen Personenzeilen');

const boundaryCounts = createPersonOutcomeCounts(true, 5);
for (const [deathP1, deathP2, careP1, careP2, failure] of [
    [2, 2, null, null, null], // gleichzeitig verstorben
    [4, null, null, null, null], // erster Tod im letzten Planjahr
    [0, null, null, null, null], // vier verbleibende Jahre
    [null, null, null, 2, 1], // Pflege beginnt nach dem Fehlschlag
    [null, 1, null, 1, 1] // Pflege und Tod im Fehlschlagjahr
]) recordPersonOutcomes(boundaryCounts, { deathP1, deathP2, careP1, careP2, failure }, 5);
const boundaryRows = finalizePersonOutcomeRows(boundaryCounts);
assertDeepEqual(boundaryRows, [
    { runs: 5, coveredWhileAlive: 3, partner: { partnerDiedByFailure: 1, careStartedByFailure: 1, neitherByFailure: 1,
        coveredForSurvivor: 2, diedFirst: 2, simultaneousDeaths: 1, medianSurvivalYears: 2 } },
    { runs: 5, coveredWhileAlive: 3, partner: { partnerDiedByFailure: 0, careStartedByFailure: 1, neitherByFailure: 1,
        coveredForSurvivor: 0, diedFirst: 1, simultaneousDeaths: 1, medianSurvivalYears: 3 } }
], 'Gleichzeitiger Tod, inklusives Fehlschlagjahr, weder noch und Planende sind korrekt gezählt');

const table = { innerHTML: '' };
const host = { hidden: true, querySelector: () => table };
renderMonteCarloPersonOutcomes(host, expected, inputs.simulationPeople);
assert(table.innerHTML.includes('<th scope="col">Partner lebt danach noch (Jahre, Median)</th>'),
    'Die Spalte benennt die Jahre des überlebenden Partners');
assert(table.innerHTML.includes('Lina</th><td>16,7\u00a0% (2 von 12)</td>') && table.innerHTML.includes('Jon</th><td>8,3\u00a0% (1 von 12)</td>'),
    'Die Karte verwendet genau die Zähler und Nenner der Handzählung');
renderMonteCarloPersonOutcomes(host, [{ runs: 1000000, coveredWhileAlive: 999999, partner: null }], inputs.simulationPeople);
assert(table.innerHTML.includes('99,9999\u00a0% (999.999 von 1.000.000)'), 'Ein einzelner Fehlschlag bleibt auch bei der größten Laufzahl sichtbar');
