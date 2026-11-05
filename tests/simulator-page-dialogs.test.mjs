import { documentDouble, installPageDialogDom, respondPageDialog } from './helpers/page-dialog-dom.mjs';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { aggregateSweepMetrics } from '../app/simulator/simulator-results.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';

const saved = { document: globalThis.document, window: globalThis.window, error: console.error };
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const tree = node => [node, ...node.children.flatMap(tree)];
function fixture() {
    const env = documentDouble(), fields = new Map();
    env.doc.addEventListener = () => {};
    env.doc.getElementById = id => {
        if (id.startsWith('page')) return env.nodes.find(node => node.id === id && node.isConnected) || null;
        if (!fields.has(id)) fields.set(id, { value: '', checked: false, disabled: false, style: {}, innerHTML: '',
            textContent: '', setAttribute() {}, scrollIntoView() {} });
        return fields.get(id);
    };
    env.doc.getElementById('sweepMetric').value = 'medianEndWealth';
    env.doc.getElementById('sweepAxisX').value = 'liquidityRunwayYears';
    env.doc.getElementById('sweepAxisY').value = 'goldRebalancingBand';
    return env;
}
function buildSamplingTestInputs(overrides = {}) {
    return {
        startAlter: 30,
        geschlecht: 'm',
        startVermoegen: 500000,
        depotwertAlt: 450000,
        einstandAlt: 350000,
        tagesgeld: 50000,
        geldmarktEtf: 0,
        zielLiquiditaet: 30000,
        startFloorBedarf: 24000,
        startFlexBedarf: 12000,
        flexBudgetAnnual: 0,
        flexBudgetRecharge: 0,
        rebalancingBand: 25,
        maxSkimPctOfEq: 10,
        maxBearRefillPctOfEq: 5,
        liquidityRunwayYears: 5,
        goldAktiv: false,
        goldZielProzent: 0,
        goldFloorProzent: 0,
        goldSteuerfrei: true,
        dynamicFlex: false,
        horizonMethod: 'survival_quantile',
        horizonYears: 20,
        survivalQuantile: 0.85,
        goGoActive: false,
        goGoMultiplier: 1,
        startSPB: 1000,
        kirchensteuerSatz: 0,
        rentAdjMode: 'fix',
        rentAdjPct: 0,
        renteMonatlich: 0,
        renteStartOffsetJahre: 0,
        capeRatio: 20,
        marketCapeRatio: 20,
        stressPreset: 'NONE',
        pflegefallLogikAktivieren: false,
        partner: { aktiv: false },
        accumulationPhase: { enabled: false },
        transitionYear: 0,
        tailRiskEnabled: false,
        ...overrides
    };
}

try {
    console.error = () => {};
    globalThis.window = {};
    globalThis.document = fixture().doc;
    const result = { params: { liquidityRunwayYears: 3, goldRebalancingBand: 25 },
        metrics: aggregateSweepMetrics([{ finalVermoegen: 1000, failed: false, maxDrawdown: 20, minRunway: 24 }]) };
    // Jede Fixture bildet einen neuen Seitenstart ab. Eigene Modulinstanzen
    // halten Ergebnis-/Singleflightzustand aus dem gemeinsamen Suite-Cache fern.
    for (const hadResult of [false, true]) {
        for (const outcome of ['threshold', 'accept', 'cancel', 'escape', 'signal', 'stale', 'show', 'worker-error', 'render-error']) {
            const env = fixture(); globalThis.document = env.doc;
            const { runParameterSweep, cancelParameterSweep } = await import(
                `../app/simulator/simulator-sweep.js?page-dialog-fixture=${outcome}-${hadResult}`);
            const guard = getPageNavigationGuard(env.doc);
            delete window.sweepResults; delete window.sweepExecution; delete window.sweepParamRanges;
            env.doc.getElementById('sweepHeatmap').innerHTML = 'keine Ergebnisse';
            env.doc.getElementById('sweep-progress-bar-container').style.display = 'none';
            const parameters = { anzahl: 1, maxDauer: 40, blockSize: 1, seed: 42, methode: 'block',
                rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
            let jobs = 0;
            const dependencies = { prepareHistoricalData: () => {}, getInputs: buildSamplingTestInputs,
                readRanges: () => ({ ranges: { liquidityRunwayYears: [3], goldRebalancingBand: [25] } }),
                readParameters: () => parameters, runWorkers: async () => { jobs++; return [result]; }, renderResults: () => 'neue Heatmap' };
            if (hadResult) {
                await runParameterSweep(dependencies);
                assertEqual(guard.reasons().length, 1, 'Erfolgreicher Vorlauf registriert genau einen Ergebnisgrund');
                assert(guard.reasons()[0].result && guard.reasons()[0].phase === 'idle', 'Vorlauf endet mit veröffentlichtem Ergebnis');
            } else assertEqual(guard.reasons().length, 0, 'Erstlauf beginnt ohne Ergebnisgrund');
            const oldResults = window.sweepResults, oldExecution = window.sweepExecution, oldRanges = window.sweepParamRanges;
            const oldHeatmap = env.doc.getElementById('sweepHeatmap').innerHTML;
            jobs = 0;
            parameters.anzahl = outcome === 'threshold' ? 125000 : 125001;
            if (outcome === 'show') {
                const create = env.doc.createElement;
                env.doc.createElement = tag => { const n = create(tag); if (tag === 'dialog') n.showModal = () => { throw new Error('SHOW_FAILURE'); }; return n; };
            }
            if (outcome === 'worker-error') {
                dependencies.runWorkers = async () => { jobs++; throw new Error('WORKER_FAILURE'); };
                dependencies.runSerial = async () => { throw new Error('SERIAL_FAILURE'); };
            }
            if (outcome === 'render-error') dependencies.renderResults = () => { throw new Error('RENDER_FAILURE'); };
            const pending = runParameterSweep(dependencies);
            assert(runParameterSweep(dependencies) === pending, 'Doppelklick teilt den Sweep');
            await tick();
            if (outcome === 'threshold') assert(!env.dialog(), 'Genau 5.000.000 Laufjahre öffnen keinen Dialog');
            else if (outcome !== 'show') {
                const dialog = env.dialog();
                assert(dialog?.open, 'Oberhalb der Grenze öffnet der Seitendialog');
                const text = tree(dialog).map(n => n.textContent).join(' ');
                assert(text.includes('125.001 Läufe × 40 Jahre = 5.000.040 nominelle Laufjahre')
                    && text.includes('nicht zuverlässig vorhersagbar'), 'Großlast zeigt Faktoren und Dauerunsicherheit');
                assertEqual(jobs, 0, 'Offene Rückfrage beginnt keine Workerarbeit');
                assert(window.sweepResults === oldResults && env.doc.getElementById('sweepHeatmap').innerHTML === oldHeatmap, 'Offene Frage erhält Altbestand');
                assertEqual(env.doc.getElementById('sweep-progress-bar-container').style.display, 'none', 'Keine Fortschrittsanzeige vor Zustimmung');
                assertEqual(guard.reasons().filter(reason => reason.result).length, hadResult ? 1 : 0,
                    'Offene Rückfrage registriert keinen neuen Ergebnisgrund');
                if (outcome === 'signal') { await cancelParameterSweep(); }
                else if (outcome === 'escape') dialog.fire('keydown', { key: 'Escape' });
                else {
                    if (outcome === 'stale') parameters.anzahl = 125002;
                    tree(dialog).find(n => n.dataset[outcome === 'cancel' ? 'pageDialogCancel' : 'pageDialogAccept'] !== undefined).fire('click');
                }
            }
            await pending; await tick();
            const notice = env.dialog();
            if (notice?.open) tree(notice).find(n => n.dataset.pageDialogAccept !== undefined).fire('click');
            const successful = ['threshold', 'accept'].includes(outcome);
            assertEqual(jobs, ['threshold', 'accept', 'worker-error', 'render-error'].includes(outcome) ? 1 : 0,
                `${outcome}: nur bestätigte Läufe starten genau einen Workerjob`);
            assertEqual(guard.reasons().length, hadResult || successful ? 1 : 0,
                `${outcome}: erfolglose Läufe registrieren kein neues Ergebnis`);
            assert(guard.reasons().every(reason => reason.result && reason.phase === 'idle'),
                `${outcome}: Handlerende hinterlässt ausschließlich veröffentlichte Ergebnisse`);
            if (!successful) assert(window.sweepResults === oldResults && window.sweepExecution === oldExecution
                && window.sweepParamRanges === oldRanges && env.doc.getElementById('sweepHeatmap').innerHTML === oldHeatmap,
                'Abbruch und Fehler erhalten Ergebnisse, Ausführungsdaten, Ranges und Heatmap');
            assert(!env.doc.getElementById('sweepButton').disabled && env.doc.getElementById('sweepCancelButton').disabled,
                'Handlerende entsperrt Start und sperrt Abbruch');
        }
    }
    for (const outcome of ['accept', 'cancel', 'escape', 'invalid', 'stale']) {
        const env = fixture(); globalThis.document = env.doc; window.sweepResults = [result];
        const before = { metric1: 'successProbFloor', metric2: 'minRunwayObserved' }; window.paretoMetrics = before;
        let renders = 0, html = 'altes Diagramm';
        Object.defineProperty(env.doc.getElementById('paretoResults'), 'innerHTML', { get: () => html, set: value => { renders++; html = value; } });
        const pending = window.showParetoDialog(); await tick();
        await window.showParetoDialog();
        const dialog = env.dialog(), nodes = tree(dialog), fields = nodes.filter(n => n.tagName === 'select');
        assertEqual(fields[0].value, 'medianEndWealth', 'X behält Vorbelegung');
        assertEqual(fields[1].value, 'worst5Drawdown', 'Y behält Vorbelegung');
        assertEqual(fields[0].children.map(n => n.value).join(','), 'successProbFloor,medianEndWealth,p10EndWealth,p75EndWealth,meanEndWealth,maxEndWealth,worst5Drawdown,minRunwayObserved', 'Exakt acht bisherige Metriken');
        if (outcome === 'stale') window.sweepResults = [result];
        if (outcome === 'escape') dialog.fire('keydown', { key: 'Escape' });
        else {
            if (outcome === 'invalid') fields[0].value = 'unbekannt';
            nodes.find(n => n.dataset[outcome === 'cancel' ? 'pageChoiceCancel' : 'pageChoiceAccept'] !== undefined).fire('click');
            if (outcome === 'invalid') {
                assert(dialog.open && window.paretoMetrics === before && renders === 0, 'Ungültige Auswahl hält Dialog und bisherigen Zustand');
                dialog.fire('keydown', { key: 'Escape' });
            }
        }
        await pending;
        assertEqual(renders, outcome === 'accept' ? 1 : 0, 'Nur Zustimmung rendert einmal');
        if (outcome !== 'accept') assert(window.paretoMetrics === before && html === 'altes Diagramm', 'Abbruch erhält Metriken und Diagramm');
    }
    const { displayMultiObjectiveOptimization, displayConstraintBasedOptimization } = await import('../app/simulator/simulator-optimizer.js');
    const { displaySensitivityAnalysis, displayParetoFrontier } = await import('../app/simulator/simulator-visualization.js');
    const { createMonteCarloUI } = await import('../app/simulator/monte-carlo-ui.js');
    for (const action of [() => window.findAndDisplayBest(), () => displayMultiObjectiveOptimization([]),
        () => displayConstraintBasedOptimization('medianEndWealth', true, []), displaySensitivityAnalysis, displayParetoFrontier,
        () => createMonteCarloUI().showError(new Error('Synthetischer MC-Fehler'))]) {
        const env = fixture(); globalThis.document = env.doc; window.sweepResults = [];
        const get = env.doc.getElementById;
        env.doc.getElementById = id => id === 'mc-error-container' ? null : get(id);
        action(); await tick();
        assert(env.dialog()?.open, 'Simulatorhinweis ist ein echter Seitendialog');
        assert(tree(env.dialog()).some(n => n.textContent === 'Verstanden'), 'Hinweis besitzt Verstanden');
        assert(tree(env.dialog()).some(n => n.tagName === 'h2' && n.textContent), 'Hinweis besitzt verständlichen Titel');
        tree(env.dialog()).find(n => n.dataset.pageDialogAccept !== undefined).fire('click'); await tick();
    }
    const { runParameterSweep } = await import('../app/simulator/simulator-sweep.js?page-dialog-fixture=missing-document');
    globalThis.document = undefined;
    let unavailableJobs = 0;
    await runParameterSweep({ prepareHistoricalData: () => { unavailableJobs++; } });
    await window.showParetoDialog(); await tick();
    assertEqual(unavailableJobs, 0, 'Fehlendes Dokument startet keinen Job und behandelt Dialogfehler kontrolliert');
} finally {
    console.error = saved.error;
    for (const key of ['document', 'window']) { if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key]; }
}
