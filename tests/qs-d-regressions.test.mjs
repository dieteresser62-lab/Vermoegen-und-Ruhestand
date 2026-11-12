import nodeAssert from 'node:assert/strict';
const A = globalThis.__wrapExternalAssert(nodeAssert);
import { inputs as fixture, runFixture } from './extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { buildPlanOverview } from '../app/simulator/simulator-plan-overview.js';
import { buildEuroAggregates } from '../app/simulator/mc-euro-metrics.js';
import { buildMonteCarloAggregates } from '../app/simulator/monte-carlo-aggregates.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { createMonteCarloChunkAccumulatorV1, mergeMonteCarloChunkResultV1,
    finalizeMonteCarloChunkAccumulatorV1, MONTE_CARLO_MISSINGNESS_CODE as codes
} from '../app/simulator/monte-carlo-chunk-result.js';

const selected = id => !process.env.QSD_CASE || process.env.QSD_CASE === String(id);
const close = (actual, expected) => A.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
function cashInputs(cash = 10000, couple = false) {
    const input = { ...structuredClone(fixture), startVermoegen: cash, depotwertAlt: 0, depotwertNeu: 0,
        einstandAlt: 0, einstandNeu: 0, tagesgeld: cash, geldmarktEtf: 0, detailledTranches: [],
        startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0, renteMonatlich: 0,
        renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjMode: 'fix', rentAdjPct: 0,
        pflegefallLogikAktivieren: false, dynamicFlex: false, goldAktiv: false,
        healthBucket: { enabled: false }, healthBucketEnabled: false,
        partner: couple ? { ...fixture.partner, aktiv: true, monatsrente: 0, brutto: 0,
            startInJahren: 0, renteStartMonate: 12 } : { aktiv: false } };
    input.simulationPeople = input.simulationPeople.slice(0, couple ? 2 : 1)
        .map(person => ({ ...person, tagesgeld: cash / (couple ? 2 : 1) }));
    return input;
}
function reserveInputs(cash = 10000, floor = 20000) {
    return { ...cashInputs(cash), startFloorBedarf: floor, careToday: { grade: 4, form: 'home-support' },
        // Rücklagenbuchung isolieren; Pflegepreise selbst sichern die FR-73-Solltests.
        pflegeGradeConfigs: { ...fixture.pflegeGradeConfigs, 4: { ...fixture.pflegeGradeConfigs[4], zusatz: 0 } },
        healthBucket: { enabled: true, initialAmount: 10000, assetSource: 'cash', triggerMinGrade: 4,
            coverageMode: 'floor_when_care_active' } };
}
const chunk = (inputs, count = 1, years = 1) => runMonteCarloChunk({ inputs, engine: EngineAPI,
    useCapeSampling: false, widowOptions: { mode: 'none', percent: 0 },
    logIndices: Array.from({ length: count }, (_, index) => index),
    monteCarloParams: { anzahl: count, maxDauer: years, blockSize: 1, seed: 12345,
        methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' } });
function finalize(result) {
    const accumulator = createMonteCarloChunkAccumulatorV1(result.runRange.count);
    mergeMonteCarloChunkResultV1(accumulator, result);
    return finalizeMonteCarloChunkAccumulatorV1(accumulator);
}

if (selected(1)) {
    const mc = await chunk(reserveInputs());
    A.equal(mc.technicalInventory.technicalError, 0);
    A.equal(mc.totals.failCount, 1);
    A.equal(mc.totals.totalHealthBucketUsed, 10000);
    A.equal(mc.pathSummaries.healthBucketUsedRealEur[0], 10000, 'Ruinjahr zählt auch in heutigen Euro');
    const merged = finalize(mc);
    const real = buildEuroAggregates(merged.pathSummaries, merged.pathMissingness, 1, codes).real;
    A.equal(real.healthBucket.usedMedian, 10000);
    A.equal(real.healthBucket.usedP90, 10000);
    A.equal(real.healthBucket.endMedian, 0);
    A.equal(merged.pathSummaries.withdrawalP10NominalEur[0], 0, 'Ruinentnahme bleibt null');

    // Späterer Ruin: Zahlungen zur Start-, terminaler Bestand zur Endkaufkraft.
    const later = await chunk(reserveInputs(30000, 12000), 1, 10);
    A.equal(later.technicalInventory.technicalError, 0);
    A.equal(later.totals.failCount, 1);
    const rows = later.runMeta[0].logDataRows;
    const terminalIndex = rows.findIndex(row => row.recordType === 'terminal_ruin');
    A.ok(terminalIndex > 0, 'Gegenprobe hat abgeschlossene Jahre vor Ruin');
    let factor = 1, realUsed = 0, terminalEndFactor;
    for (const row of rows.slice(0, terminalIndex + 1)) {
        realUsed += (row.health_bucket_used || 0) / factor;
        factor *= 1 + row.inflation / 100;
        terminalEndFactor = factor;
    }
    const terminal = rows[terminalIndex];
    A.ok(terminal.health_bucket_used > 0, 'Auch das spätere Ruinjahr verbraucht Rücklage');
    close(later.pathSummaries.healthBucketUsedRealEur[0], realUsed);
    close(later.pathSummaries.healthBucketEndRealEur[0], terminal.health_bucket_end / terminalEndFactor);
    close(later.pathSummaries.healthBucketTargetGapRealEur[0], terminal.health_bucket_target_gap / terminalEndFactor);
}

if (selected(2)) {
    const input = cashInputs();
    input.healthBucket = { enabled: true, initialAmount: 10000, assetSource: 'cash', returnMode: 'cash_return' };
    const mc = await chunk(input, 100);
    A.equal(mc.technicalInventory.technicalError, 0);
    A.equal(mc.lists.healthBucketInterestAmounts.length, 100);
    A.equal(mc.lists.healthBucketInterestAmounts.filter(value => value < 0).length, 8);
    A.equal(mc.lists.healthBucketInterestAmounts.filter(value => value === 0).length, 3);
    const merged = finalize(mc);
    A.deepEqual(merged.lists.healthBucketInterestAmounts, mc.lists.healthBucketInterestAmounts,
        'Finale Zusammenführung erhält alle aktivierten Rücklagen einschließlich negativer und null Zinsen');
    const expected = quantile(mc.lists.healthBucketInterestAmounts, .5);
    close(expected, 327);
    const aggregates = buildMonteCarloAggregates({ ...merged, inputs: input });
    close(aggregates.extraKPI.healthBucket.interestMedian, expected);
    const disabled = finalize(await chunk(cashInputs()));
    A.deepEqual(disabled.lists.healthBucketInterestAmounts, [], 'Deaktivierte Rücklage liefert keine Zinsbeobachtung');
}

if (selected(3)) {
    for (const caredPerson of [0, 1]) for (const caregiverGrade of [2, 3, 4]) {
        const input = cashInputs(500000, true);
        input.pflegeKostenStaffelPreset = 'custom';
        const people = [input, input.partner];
        people[caredPerson].careToday = { grade: 2, form: 'family' };
        people[1 - caredPerson].careToday = { grade: caregiverGrade, form: 'home-support' };
        const entries = [...input.simulationPeople].reverse().map(person => ({ profileId: person.profileId,
            name: person.profileId, data: {} }));
        const plan = buildPlanOverview({ inputs: input, entries, referenceYear: 2026, inflationPct: 0, wagePct: 0 });
        const expected = caregiverGrade >= 3 ? 0 : 4164;
        A.equal(plan.rows[0].incomes.reduce((sum, amount) => sum + amount, 0), expected,
            `Plan: Pflegeperson mit PG${caregiverGrade}, Richtung ${caredPerson}`);
        const historical = runFixture({ input });
        A.equal(historical.outcome.kind, 'completed');
        A.equal(historical.rows[0].row.pflegegeld || 0, expected);
        const mc = await chunk(input);
        A.equal(mc.technicalInventory.technicalError, 0);
        const row = mc.runMeta[0].logDataRows[0];
        A.equal(row.pflegegeld || 0, expected);
        if (caregiverGrade >= 3) {
            for (const log of [historical.rows[0].row, row]) {
                A.deepEqual(log[`CareP${caredPerson + 1}_FamilyFallback`], { reason: 'care', grade: caregiverGrade });
            }
        }
    }
    const single = cashInputs();
    single.careToday = { grade: 2, form: 'family' };
    single.partner.careToday = { grade: 3, form: 'home-support' };
    const plan = buildPlanOverview({ inputs: single, entries: [{ profileId: single.simulationPeople[0].profileId,
        data: {} }], referenceYear: 2026, inflationPct: 0, wagePct: 0 });
    A.equal(plan.rows[0].incomes[0], 4164, 'Inaktiver Partner sperrt Angehörigenpflege nicht');
}

if (selected(4)) {
    for (const [cash, floor, ruinYear] of [[30000, 12000, 2002], [10000, 20000, 2000]]) {
        const historical = runFixture({ input: reserveInputs(cash, floor) });
        A.equal(historical.outcome.kind, 'ruin');
        A.equal(historical.ruinYear, ruinYear);
        if (ruinYear === 2002) A.equal(historical.rows.at(-2).row.health_bucket_end.toFixed(2), '5816.68');
        const terminal = historical.rows.at(-1).row;
        A.equal(terminal.health_bucket_enabled, true, 'Erschöpfte Rücklage bleibt aktiviert');
        A.equal(terminal.health_bucket_end, 0);
        A.ok(terminal.health_bucket_used > 0, 'Terminale Entnahme bleibt im Backtestprotokoll');
        A.equal(terminal.health_bucket_real_coverage_pct, 0);
        A.ok(terminal.health_bucket_target_gap > 0);
        A.deepEqual(historical.summary.healthBucket, { enabled: true, end: 0, realCoveragePct: 0,
            targetGap: terminal.health_bucket_target_gap });
    }
}
console.log(`QS-D ${process.env.QSD_CASE || '1–4'}: Gegenproben bestanden.`);
