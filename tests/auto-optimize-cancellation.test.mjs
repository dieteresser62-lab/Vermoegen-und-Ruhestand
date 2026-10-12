import { EngineAPI } from '../engine/index.mjs';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { runAutoOptimize } from '../app/simulator/auto_optimize.js';
import { evaluateCandidate } from '../app/simulator/auto-optimize-evaluate.js';
import { handleRunAutoOptimize, cancelAutoOptimize } from '../app/simulator/auto_optimize_ui.js';

console.log('--- Auto-Optimize Kündigung ---');
const saved = { document: global.document, window: global.window, localStorage: global.localStorage, alert: global.alert };
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const elements = {
    p1StartAlter: { value: '67' },
    liquidityRunwayYears: { value: '5' },
    mcSeed: { value: '42' }, mcMethode: { value: 'block' },
    mcBlockSize: { value: '1' }, mcDauer: { value: '2' },
    ao_run_btn: {}, ao_cancel_btn: { disabled: true }, ao_progress: { style: {} },
    ao_result: { style: {}, innerHTML: '' }, ao_apply_btn: { style: {} }
};
global.document = { getElementById: id => elements[id] || null };
global.window = { EngineAPI };
global.localStorage = { getItem: () => null };
global.alert = () => { throw new Error('Kündigung darf keinen Fehleralert anzeigen'); };
const metrics = { metricContract: { schemaVersion: 'AutoOptimizeMetricResultV1' },
    medianEndWealth: 500000, successProbFloor: 1, depletionRate: 0, worst5Drawdown: 0,
    timeShareWRgt45: 0, medianWithdrawalRate: 0.03 };
const config = () => ({ objective: { metric: 'EndWealth_P50', direction: 'max' },
    params: { liquidityRunwayYears: { min: 1, max: 10, step: 0.5 } },
    modelAssumptions: { monteCarloParameters: { anzahl: 2, maxDauer: 2, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed' }, useCapeSampling: false },
    runsPerCandidate: 2, seedsTrain: 2, seedsTest: 2, constraints: {}, maxDauer: 2 });
try {
    for (const cancelledStage of ['quick_filter', 'evaluate_lhs', 'refine', 'validate']) {
        const controller = new AbortController();
        const gates = [];
        const progress = [];
        let stage = '', settled = false, calls = 0;
        const run = runAutoOptimize({ ...config(), signal: controller.signal, generationId: cancelledStage,
            onProgress: status => { stage = status.stage; progress.push(status); },
            evaluateCandidateFn: async (...args) => {
                calls++;
                assert(args[7].signal === controller.signal && args[7].generationId === cancelledStage,
                    'Evaluator erhält Signal und Generation unverändert');
                if (stage === cancelledStage) {
                    const gate = deferred(); gates.push(gate); await gate.promise;
                }
                return metrics;
            }
        }).then(value => value, error => error).finally(() => { settled = true; });
        for (let i = 0; i < 500 && !gates.length; i++) await tick();
        if (!gates.length && settled) throw await run;
        assert(gates.length > 0, `${cancelledStage}: echte Evaluationsbarriere erreicht`);
        controller.abort();
        const callCount = calls, progressCount = progress.length;
        for (const gate of gates.slice(0, -1)) gate.resolve();
        await tick();
        assert(!settled, `${cancelledStage}: Handler wartet auch den letzten parallelen Unterlauf ab`);
        gates.at(-1).resolve();
        assert((await run)?.name === 'AbortError', `${cancelledStage}: keine Championrückgabe nach Kündigung`);
        assert(calls === callCount && progress.length === progressCount,
            `${cancelledStage}: keine Folgeevaluation oder späte Fortschrittspublikation`);
    }

    // Evaluator ignoriert verspätete Antwort; kein Wechsel zum zweiten Seed.
    const seedGate = deferred(), seedController = new AbortController();
    let seedCalls = 0;
    const evaluation = evaluateCandidate({ liquidityRunwayYears: 5 }, {
        liquidityRunwayYears: 5, startFloorBedarf: 24000, startFlexBedarf: 6000
    }, 2, 2, [42, 43], null, null, {
        signal: seedController.signal, generationId: 'seed-cancel',
        runMonteCarlo: async options => {
            seedCalls++;
            assert(options.signal === seedController.signal, 'Seedbatch erhält das ursprüngliche Signal');
            await seedGate.promise;
            return { aggregatedResults: {}, failCount: 0 };
        }
    }).catch(error => error);
    seedController.abort(); seedGate.resolve();
    assert((await evaluation)?.name === 'AbortError' && seedCalls === 1,
        'Verspäteter Seedbatch startet keinen Folgeseed und wertet keine Rohdaten aus');

    const guard = getPageNavigationGuard(document);
    const old = { championCfg: { liquidityRunwayYears: 5 } };
    window.aoChampionResult = old;
    elements.ao_result.innerHTML = 'Vorhandener Champion';
    const gate = deferred();
    let captured;
    const dependencies = { readConfig: config, run: async supplied => {
        captured = supplied; await gate.promise; supplied.onProgress({ stage: 'done', progress: 1 });
        return old;
    } };
    const uiRun = handleRunAutoOptimize(dependencies);
    assert(handleRunAutoOptimize(dependencies) === uiRun, 'UI-Doppelstart teilt denselben Handler');
    await tick();
    assert(!elements.ao_cancel_btn.disabled, 'Sichtbarer Abbruchknopf ist während der laufenden Optimierung freigegeben');
    assert(await guard.prepare({ decide: async () => false }) === null && !captured.signal.aborted,
        'Bleiben kündigt den echten AO-Handler nicht');
    const attemptPromise = guard.prepare({ decide: async ({ reasons }) => {
        assert(reasons.some(reason => reason.result && reason.phase === 'running'),
            'Kombinierte Nachfrage enthält alten Champion und laufende Rechnung');
        return true;
    } });
    await tick();
    assert(captured.signal.aborted, 'Wechselzustimmung kündigt die echte AO-Generation');
    assert(handleRunAutoOptimize({ readConfig: () => { throw new Error('unzulässiger Neustart'); } }) === uiRun,
        'Neustart während Kündigung erzeugt keine Generation');
    const cancellation = cancelAutoOptimize();
    assert(cancelAutoOptimize() === cancellation, 'Wiederholte Kündigung teilt ihr Ende');
    gate.resolve();
    const attempt = await attemptPromise;
    await cancellation;
    assert(elements.ao_cancel_btn.disabled, 'Abbruchknopf wird erst nach Handlercleanup wieder gesperrt');
    assert(attempt && guard.reasons()[0].phase === 'idle', 'Freigabe erfolgt erst nach Handlercleanup');
    assert(window.aoChampionResult === old && elements.ao_result.innerHTML === 'Vorhandener Champion',
        'Abgebrochener Folgelauf erhält altes Ergebnis und dessen Projektion');
    assert(elements.ao_progress.textContent === 'Abgebrochen' && !elements.ao_run_btn.disabled,
        'Späte Fortschrittsantwort wird verworfen und Startknopf wieder freigegeben');
    guard.end(attempt);
    let preparationCalls = 0;
    const preparing = handleRunAutoOptimize({ readConfig: () => { preparationCalls++; return config(); }, run: async () => old });
    const preparationCancel = cancelAutoOptimize();
    await preparing; await preparationCancel;
    assert(preparationCalls === 0 && window.aoChampionResult === old,
        'Kündigung vor UI-Vorbereitung liest keine Konfiguration und ersetzt kein Ergebnis');

    const restartGate = deferred();
    const restarted = handleRunAutoOptimize({ readConfig: config, run: async () => { await restartGate.promise; return old; } });
    await tick();
    const restartedCancel = cancelAutoOptimize(); restartGate.resolve(); await restartedCancel; await restarted;
    assert(guard.reasons()[0].result && guard.reasons()[0].phase === 'idle', 'Erneuter Start und Abbruch erhalten Ergebnisgrund');
} finally {
    Object.assign(global, saved);
}
