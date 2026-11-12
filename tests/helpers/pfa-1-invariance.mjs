import { withPreviousRunEvidence } from './le-1b-expectations.mjs';
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Eingefrorene wirksame Preise trennen neue Leserdefaults von der Rechenweg-Gegenprobe. */
export async function pfa1Invariance(root = new URL('../../', import.meta.url)) {
    const load = file => import(new URL(file, root));
    const { inputs: fixture, runFixture } = await load('tests/extended/parity-replay-fixture.mjs');
    const { EngineAPI } = await load('engine/index.mjs');
    const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
    const { initMcRunState } = await load('app/simulator/simulator-engine-wrapper.js');
    const { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } = await load('app/simulator/mc-life-events.js');
    const { careFormForPerson } = await load('app/shared/care-benefits.js');
    const { rng } = await load('app/simulator/simulator-utils.js');
    const input = { ...structuredClone(fixture), pflegeKostenDrift: .035, pflegeStufe1Zusatz: 6000,
        pflegeMaxFloor: 120000, pflegeGradeConfigs: Object.fromEntries([6000, 12000, 18000, 32000, 60000].map((zusatz, i) => [i + 1,
            { zusatz, flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: 0 }])), pflegefallLogikAktivieren: false };
    const mc = await runMonteCarloChunk({ inputs: input, engine: EngineAPI, useCapeSampling: false,
        monteCarloParams: { anzahl: 4, maxDauer: 40, methode: 'block', blockSize: 3, seed: 12345 },
        logIndices: [0, 1, 2, 3], widowOptions: input.widowOptions });
    const traces = {};
    for (const [name, p1, p2] of [['healthy', null, null], ['home', { grade: 3, form: 'home-support', progression: 'slower' }, null],
        ['heim', { grade: 4, form: 'residential', progression: 'much_slower', residentialSince: '2023-01' }, { grade: 2, form: 'family', progression: 'usual' }]]) {
        for (const preset of ['custom', 'amtlich']) {
            const inputs = { ...input, careReferenceDate: '2026-10-23', pflegefallLogikAktivieren: true,
                pflegeKostenStaffelPreset: preset, ...(p1 ? { careToday: p1 } : {}), partner: { ...input.partner, ...(p2 ? { careToday: p2 } : {}) } };
            const all = [];
            for (let seed = 1; seed <= 64; seed++) {
                const random = rng(seed), life = createMonteCarloLifeState(inputs, random), state = initMcRunState(inputs);
                const path = [];
                for (let t = 0; t < 40; t++) {
                    const y = updateMonteCarloLifeEventsForYear(life, inputs, inputs.widowOptions, t,
                        { jahr: 2000, inflation: 2 }, 0, null, false, random, state);
                    path.push([life.p1Alive, life.p2Alive, ...['p1', 'p2'].flatMap((key, index) => {
                        const care = y.householdContext.care?.[key];
                        return [care?.active, care?.grade, care?.currentYearInCare, care?.mortalityFactor, care?.heimZufall,
                            care?.active ? careFormForPerson(inputs, care.grade, index, y.householdContext) : null];
                    })]);
                    if (life.runEndedBecauseAllDied) break;
                }
                all.push(path);
            }
            traces[`${name}/${preset}`] = digest(all);
        }
    }
    // LE-1b: Laufbeleg der Sterbetafel wie vor LE-1b; alle übrigen MC-Bytes bleiben im Vergleich.
    return { noCareMonteCarlo: digest(withPreviousRunEvidence(mc)), noCareBacktest: digest(runFixture({ input })), traces };
}
