import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarlo, cancelMonteCarlo, runMonteCarloSerial } from '../app/simulator/simulator-monte-carlo.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { simulatorRunAssumptions } from '../app/simulator/simulator-run-assumptions.js';

// Zwei echte Dokumentbesitzer teilen den Modulcache, aber niemals ihren Ergebnisstatus.
const originalDocument = globalThis.document, originalWindow = globalThis.window;
const originalError = console.error, originalPhase = simulatorRunAssumptions.read('montecarlo').phase;
const documentA = { getElementById: () => null }, documentB = { getElementById: () => null };
const guardA = getPageNavigationGuard(documentA, {}), guardB = getPageNavigationGuard(documentB, {});
const notificationsA = [], notificationsB = [];
const unsubscribeA = guardA.subscribe(reasons => notificationsA.push(reasons));
const unsubscribeB = guardB.subscribe(reasons => notificationsB.push(reasons));
const reason = guard => guard.reasons().find(item => item.owner === 'simulator-monte-carlo');
const gateResolvers = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); gateResolvers.push(resolve); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const calls = { results: 0, exports: 0, prepared: 0, errors: [], cleaned: 0, cancelled: 0 };
const inputs = {
    startAlter: 65, accumulationPhase: { enabled: false }, transitionYear: 0,
    startVermoegen: 500000, depotwertAlt: 500000, einstandAlt: 400000,
    tagesgeld: 20000, geldmarktEtf: 0, zielLiquiditaet: 20000,
    startFloorBedarf: 24000, startFlexBedarf: 6000, minimumFlexAnnual: 0,
    flexBudgetAnnual: 0, flexBudgetRecharge: 0, renteMonatlich: 0,
    renteStartOffsetJahre: 0, rentAdjPct: 0, goldAktiv: false,
    goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: false,
    risikoprofil: 'sicherheits-dynamisch', rebalancingBand: 20,
    runwayTargetMonths: 36, runwayMinMonths: 24, targetEq: 60,
    maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, marketCapeRatio: 20, capeRatio: 20,
    kirchensteuerSatz: 0, startSPB: 1000, dynamicFlex: false,
    horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: .85,
    goGoActive: false, goGoMultiplier: 1, pflegefallLogikAktivieren: false,
    geschlecht: 'm', partner: { aktiv: false }, stressPreset: 'NONE'
};
const ui = {
    bindCancel() {}, beginRun() {}, disableStart() {}, hideError() {}, clearRunExport() {},
    readUseCapeSampling: () => false, readWorkerConfig: () => ({}),
    requireLargeRunConfirmation() {}, showProgress() {}, hideCompareResults() {},
    readCompareMode: () => false, updateProgress() {}, beginCancelling() {},
    showCancelled: () => calls.cancelled++, publishRunExport: () => calls.exports++,
    showCompleted() {}, showError: message => calls.errors.push(message),
    finishProgress: async () => {}, unbindCancel() {}, finishRun: () => calls.cleaned++, enableStart() {}
};
const dependencies = {
    createUI: () => ui,
    prepareHistoricalData: () => { calls.prepared++; prepareHistoricalDataOnce(); },
    getInputs: () => inputs,
    readParameters: () => ({ anzahl: 2, maxDauer: 2, blockSize: 1, seed: 42,
        methode: 'block', rngMode: 'legacy-stream', startYearMode: 'UNIFORM' }),
    beginOverviewRun: () => undefined,
    displayResults: () => calls.results++
};
try {
    globalThis.window = { EngineAPI };
    globalThis.document = documentA;
    await runMonteCarlo(dependencies);
    assertEqual(calls.errors.length, 0, 'A: echter serieller Erstlauf ist erfolgreich');
    assertEqual(calls.results, 1, 'A: genau ein Ergebnis dargestellt');
    assertEqual(calls.exports, 1, 'A: genau ein Laufexport veröffentlicht');
    const publishedA = reason(guardA);
    assert(publishedA.result && publishedA.phase === 'idle', 'A: Ergebnis hat einen eigenen Verlustgrund');
    assertEqual(publishedA.revision, 2, 'A: Laufbeginn und Veröffentlichung ändern die eigene Revision');

    globalThis.document = documentB;
    const notificationsBeforeB = notificationsA.length, preparedBeforeB = calls.prepared;
    const firstAbortB = runMonteCarlo(dependencies);
    assertEqual(reason(guardB).revision, 1, 'B: eigener Erstlauf beginnt bei Revision eins');
    assertEqual(reason(guardB).result, false, 'B: Erstlauf übernimmt kein fremdes Ergebnis');
    assertEqual(reason(guardA).phase, 'idle', 'A: B-Rechnung verändert die Phase des Ergebnisbesitzers nicht');
    await cancelMonteCarlo(); await firstAbortB;
    assertEqual(calls.prepared, preparedBeforeB, 'B: sofortiger Erstabbruch läuft vor der Vorbereitung');
    assertEqual(guardB.reasons().length, 0, 'B: sofortiger Erstabbruch hinterlässt keinen Ergebnisverlustgrund');
    assertEqual(notificationsA.length, notificationsBeforeB, 'B: Abbruch benachrichtigt ausschließlich B');
    assertEqual(JSON.stringify(reason(guardA)), JSON.stringify(publishedA), 'A: B-Abbruch erhält Ergebnis und Revision');
    assertEqual(notificationsB.at(-1).length, 0, 'B: letzte Benachrichtigung bestätigt keinen Schutzgrund');

    // Auch während B-Vorbereitung darf A keinen fremden Controller melden.
    const preparationB = deferred();
    const pendingB = runMonteCarlo({ ...dependencies, prepareHistoricalData: () => preparationB.promise });
    await tick();
    assertEqual(reason(guardB).phase, 'preparing', 'B: eigene Vorbereitung ist geschützt');
    assertEqual(reason(guardA).phase, 'idle', 'A: während fremder Vorbereitung weiterhin idle');
    assertEqual(reason(guardA).revision, publishedA.revision, 'A: fremder Wiederstart ändert keine Revision');
    const cancellingB = cancelMonteCarlo(); preparationB.resolve();
    await cancellingB; await pendingB;
    assertEqual(guardB.reasons().length, 0, 'B: Vorbereitungsabbruch publiziert ebenfalls kein Ergebnis');

    globalThis.document = documentA;
    for (const mode of ['sofort', 'seriell', 'vor Veröffentlichung', 'Fehler']) {
        const before = { results: calls.results, exports: calls.exports, cleaned: calls.cleaned, revision: reason(guardA).revision };
        const gate = deferred(); let serialEntered = false;
        const overrides = mode === 'seriell' ? { runSerial: async args => { serialEntered = true; await gate.promise; return runMonteCarloSerial(args); } }
            : mode === 'vor Veröffentlichung' ? { runSerial: async args => { const result = await runMonteCarloSerial(args); cancelMonteCarlo(); return result; } }
            : mode === 'Fehler' ? { prepareHistoricalData: () => { throw new Error('SYNTHETIC_PREPARATION_FAILURE'); } } : {};
        console.error = () => {};
        const pendingA = runMonteCarlo({ ...dependencies, ...overrides });
        if (mode === 'sofort') await cancelMonteCarlo();
        if (mode === 'seriell') {
            await tick(); assert(serialEntered, 'A: serieller Abbruch erreicht die reale Ausführungsgrenze');
            const cancellation = cancelMonteCarlo(); gate.resolve(); await cancellation;
        }
        await pendingA;
        assertEqual(calls.results, before.results, `${mode}: kein neues Ergebnis`);
        assertEqual(calls.exports, before.exports, `${mode}: kein neuer Laufexport`);
        assertEqual(calls.cleaned, before.cleaned + 1, `${mode}: Cleanup endet genau einmal`);
        assertEqual(reason(guardA).revision, before.revision + 1, `${mode}: nur Laufbeginn, keine Veröffentlichungsrevision`);
        assert(reason(guardA).result && reason(guardA).phase === 'idle', `${mode}: vorhandenes A-Ergebnis bleibt geschützt`);
        assertEqual(guardB.reasons().length, 0, `${mode}: B übernimmt keinen Ergebnisverlustgrund`);
    }
    assertEqual(calls.errors.length, 1, 'Nur die Fehlergegenprobe zeigt einen Fehler');
    await runMonteCarlo(dependencies);
    assertEqual(calls.results, 2, 'A: Wiederstart nach Fehler und Abbruch veröffentlicht ein neues Ergebnis');
    assertEqual(calls.exports, 2, 'A: nur erfolgreiche Läufe veröffentlichen Laufexports');
    assert(notificationsA.at(-1)[0].result && notificationsA.at(-1)[0].phase === 'idle', 'A: Abschlussbenachrichtigung gehört zum neuen Ergebnis');
} finally {
    for (const resolve of gateResolvers) resolve();
    await cancelMonteCarlo();
    unsubscribeA(); unsubscribeB();
    simulatorRunAssumptions.phase('montecarlo', originalPhase);
    console.error = originalError;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}

// Detailfortschritt drosselt beide Statusbereiche, aber keinen der beiden Balken.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { createMonteCarloUI, syncMonteCarloRunControls } = await import('../app/simulator/monte-carlo-ui.js');
    const savedDocument = globalThis.document;
    const doc = createPresentationTestDocument();
    const statusWrites = [], mirroredWrites = [];
    for (const id of ['mcButton', 'mc-progress-bar-container', 'mc-progress-bar', 'mcRunStatus',
        'overviewMonteCarloRunStatus', 'overviewMonteCarloProgress', 'overviewMonteCarloProgressBar']) {
        const node = doc.createElement('div'); node.id = id;
    }
    const trackStatus = (node, writes) => {
        let text = node.textContent;
        Object.defineProperty(node, 'textContent', {
            get: () => text,
            set: value => { text = value; writes.push(value); }
        });
    };
    trackStatus(doc.getElementById('mcRunStatus'), statusWrites);
    trackStatus(doc.getElementById('overviewMonteCarloRunStatus'), mirroredWrites);
    try {
        globalThis.document = doc;
        const ui = createMonteCarloUI();
        const detail = { phase: 'simulating', completedRuns: 0, totalRuns: 100 };
        const announced = [], mirrored = [];
        for (let percent = 0; percent <= 100; percent++) {
            const before = statusWrites.length, mirroredBefore = mirroredWrites.length;
            ui.updateProgress(percent, { ...detail, completedRuns: percent });
            if (statusWrites.length > before) announced.push(percent);
            if (mirroredWrites.length > mirroredBefore) mirrored.push(percent);
            assertEqual(doc.getElementById('mc-progress-bar').style.width, `${percent}%`, `Reiterbalken folgt Wert ${percent}`);
            assertEqual(doc.getElementById('overviewMonteCarloProgressBar').style.width, `${percent}%`, `Ergebnisbalken folgt Wert ${percent}`);
            assertEqual(doc.getElementById('mc-progress-bar-container').getAttribute('aria-valuenow'), String(percent), `Reiterfortschritt folgt Wert ${percent}`);
            assertEqual(doc.getElementById('overviewMonteCarloProgress').getAttribute('aria-valuenow'), String(percent), `Ergebnisfortschritt folgt Wert ${percent}`);
        }
        const expected = Array.from({ length: 21 }, (_, index) => index * 5);
        assertEqual(JSON.stringify(announced), JSON.stringify(expected), 'Detailstatus meldet nur den ersten Wert, Fünferschritte und 100 Prozent');
        assertEqual(JSON.stringify(mirrored), JSON.stringify(expected), 'Gespiegelter Status wird ausschließlich in denselben Fünferschritten gesetzt');
        assertEqual(statusWrites.length, 21, 'Reiterstatus hat genau eine Zuweisung je Meldung');
        assertEqual(mirroredWrites.length, 21, 'Ergebnisstatus hat genau eine Zuweisung je Meldung');
        for (const [percent, phase, comparison, expectedWrites] of [
            [100, 'evaluating', '', 22],
            [99, 'evaluating', '', 22],
            [99, 'simulating', 'Vergleich seriell', 23],
            [98, 'simulating', 'Vergleich seriell', 23],
            [98, 'simulating', 'Vergleich Worker', 24],
            [97, 'simulating', 'Vergleich Worker', 24],
            [93, 'simulating', 'Vergleich Worker', 25],
            [98, 'simulating', 'Vergleich Worker', 26],
            [100, 'simulating', 'Vergleich Worker', 27]
        ]) {
            ui.updateProgress(percent, { ...detail, phase, comparison });
            assertEqual(statusWrites.length, expectedWrites, `${phase} ${comparison}: Phasenwechsel sofort, sonst fünf Prozentpunkte Abstand`);
            assertEqual(mirroredWrites.length, expectedWrites, 'Phasenmeldung wird genau einmal gespiegelt');
        }
        assert(statusWrites[21].startsWith('Auswertung'), 'Auswertungsphase wird auch bei gleichem Prozentwert sofort gemeldet');
        assert(statusWrites[22].includes('Vergleich seriell') && statusWrites[23].includes('Vergleich Worker'), 'Vergleichswechsel wird sofort gemeldet');
        assert(statusWrites.at(-1).endsWith('100 Prozent.'), '100 Prozent werden auch zwei Prozentpunkte nach der letzten Meldung angekündigt');
        const oldStatus = doc.getElementById('overviewMonteCarloRunStatus');
        doc.nodes.splice(doc.nodes.indexOf(oldStatus), 1);
        const replacement = doc.createElement('p'); replacement.id = 'overviewMonteCarloRunStatus';
        const replacementWrites = []; trackStatus(replacement, replacementWrites);
        syncMonteCarloRunControls(doc);
        syncMonteCarloRunControls(doc);
        assertEqual(replacement.textContent, doc.getElementById('mcRunStatus').textContent, 'Ersetzte Ergebniskarte erhält den letzten gemeldeten Status');
        assertEqual(replacementWrites.length, 1, 'Erneute Synchronisierung schreibt denselben Status nicht nochmals');
        ui.showProgress();
        const resetWrites = statusWrites.length;
        ui.updateProgress(1);
        assertEqual(statusWrites.length, resetWrites, 'Neuer Fortschrittslauf setzt die Meldeschwelle zurück');
        ui.updateProgress(5);
        assertEqual(statusWrites.length, resetWrites + 1, 'Fortschritt ohne Detail behält die Fünf-Prozent-Drosselung');
    } finally {
        if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument;
    }
}

// Beide DOM-Startwege erreichen denselben produktiven Controller und die echte UI.
{
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { initializeResultOverview, renderSimulatorOverview } = await import('../app/simulator/simulator-result-overview.js');
    const { syncMonteCarloRunControls, createMonteCarloUI } = await import('../app/simulator/monte-carlo-ui.js');
    const savedDocument = globalThis.document, savedWindow = globalThis.window, savedError = console.error;
    const doc = createPresentationTestDocument(), listeners = new Map();
    doc.addEventListener = (type, handler) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); };
    doc.removeEventListener = (type, handler) => listeners.get(type)?.delete(handler);
    doc.querySelectorAll = () => [];
    const add = (id, value = '') => {
        const node = doc.createElement('div'); node.id = id; node.value = value; node.querySelector = () => null;
        node.closest = selector => selector.includes('#mcButton') && id === 'mcButton' || selector.includes('[data-mc-start]') && id === 'overviewRunMonteCarlo'
            || selector === '[data-mc-cancel]' && id === 'overviewCancelMonteCarlo' ? node : null;
        return node;
    };
    const mirroredIds = ['overviewRunMonteCarlo', 'overviewMonteCarloSettings', 'overviewCancelMonteCarlo', 'overviewMonteCarloRunStatus', 'overviewMonteCarloProgress', 'overviewMonteCarloProgressBar'];
    const checkCardControls = busy => {
        assertEqual(doc.getElementById('overviewRunMonteCarlo').hidden, busy, 'Ergebnisstart ist nur im Ruhezustand sichtbar');
        assertEqual(doc.getElementById('overviewMonteCarloSettings').hidden, busy, 'Einstellungen sind nur im Ruhezustand sichtbar');
        assertEqual(doc.getElementById('overviewCancelMonteCarlo').hidden, !busy, 'Abbruch ist nur während des Laufs sichtbar');
    };
    for (const id of ['mcButton', 'mcCancelButton', 'mc-progress-bar-container', 'mc-progress-bar', 'mcRunStatus', 'mc-error-container', 'mc-error-message',
        'overviewBacktest', 'overviewMonteCarlo', 'monteCarloAnswers', 'overviewRunHeads', ...mirroredIds]) add(id);
    for (const [id, value] of Object.entries({ mcMethode: 'block', mcAnzahl: '2', mcDauer: '2', mcBlockSize: '1', mcSeed: '42', rngMode: 'legacy-stream', mcStartYearMode: 'UNIFORM' })) add(id, value);
    const click = id => {
        const target = doc.getElementById(id);
        if (!target.disabled) [...listeners.get('click') || []].forEach(handler => handler({ target }));
    };
    let pending, serialCalls = 0, summaryWrites = 0, gate = null, progressCallback = null;
    const outputs = [], tabs = [];
    const execution = {
        getInputs: () => inputs,
        prepareHistoricalData: prepareHistoricalDataOnce,
        runSerial: async args => { serialCalls++; progressCallback = args.onProgress; if (gate) await gate.promise; return runMonteCarloSerial(args); },
        displayResults: results => outputs.push(JSON.stringify(results)),
        completeSimulationSummary: () => { summaryWrites++; }
    };
    try {
        globalThis.document = doc; globalThis.window = { EngineAPI };
        syncMonteCarloRunControls(doc, false);
        checkCardControls(false);
        assertEqual(doc.getElementById('mcButton').textContent, 'Monte-Carlo rechnen', 'Ohne Ergebnis heißt der Start Monte-Carlo rechnen');
        initializeResultOverview({ runMonteCarlo: () => { pending = runMonteCarlo(execution); }, activateTab: tab => tabs.push(tab), rerunBacktest() {} }, doc);
        gate = deferred(); click('overviewRunMonteCarlo'); click('mcButton'); await tick();
        assertEqual(serialCalls, 1, 'Zwei schnelle Starts über verschiedene Hosts starten nur eine echte Rechnung');
        assertEqual(tabs.length, 0, 'Ergebnisstart aktiviert keinen anderen Reiter');
        assert(doc.getElementById('mcButton').disabled && doc.getElementById('overviewRunMonteCarlo').disabled, 'Beide Startknöpfe sind während des Laufs gesperrt');
        checkCardControls(true);
        renderSimulatorOverview();
        assert(doc.getElementById('overviewMonteCarlo').innerHTML.includes('data-mc-start'), 'Neurender enthält weiterhin den delegierten Ergebnisstart');
        gate.resolve(); await pending; gate = null;
        checkCardControls(false);
        assertEqual(outputs.length, 1, 'Ergebnisstart veröffentlicht genau einen Ergebnisstand');
        assertEqual(summaryWrites, 1, 'Ergebnisstart veröffentlicht genau einen bisherigen Summaryabschluss');
        const firstHead = simulatorRunAssumptions.read('montecarlo').last;
        const firstValues = JSON.stringify(firstHead.values);
        assertEqual(firstHead.values.settings.anzahl, 2, 'Ergebnisstart liest echte gemeinsame Reitereinstellungen');
        assertEqual(doc.getElementById('mcButton').textContent, 'Monte-Carlo neu rechnen', 'Erfolgreicher Ergebnisstand ändert die Startbeschriftung');
        assertEqual(doc.getElementById('overviewRunMonteCarlo').textContent, 'Monte-Carlo neu rechnen', 'Ergebnisstart trägt dieselbe Beschriftung');
        click('mcButton'); await pending;
        assertEqual(outputs[1], outputs[0], 'Reiterstart veröffentlicht mit gleichem Seed denselben echten Ergebnisstand');
        assertEqual(JSON.stringify(simulatorRunAssumptions.read('montecarlo').last.values), firstValues, 'Beide Startwege frieren identische Eingaben und Einstellungen ein');
        assertEqual(summaryWrites, 2, 'Beide Startwege haben jeweils genau einen Summaryabschluss');
        for (const cancelId of ['overviewCancelMonteCarlo', 'mcCancelButton']) {
            const previousHead = simulatorRunAssumptions.read('montecarlo').last;
            gate = deferred(); click('overviewRunMonteCarlo'); await tick();
            // Echte UI-Zähler synchronisieren auch gerade ersetzte Ergebnisknoten.
            progressCallback(45, { phase: 'simulating', completedRuns: 1, totalRuns: 2 });
            for (const id of mirroredIds) { const old = doc.getElementById(id); doc.nodes.splice(doc.nodes.indexOf(old), 1); add(id); }
            renderSimulatorOverview();
            checkCardControls(true);
            assertEqual(doc.getElementById('overviewMonteCarloRunStatus').textContent, doc.getElementById('mcRunStatus').textContent, 'Ersetzte Ergebniskarte spiegelt denselben Laufzähler');
            assert(doc.getElementById('mcRunStatus').textContent.includes('1 von 2 Läufen'), 'Laufzähler stammt aus fertig gerechneten Läufen');
            assertEqual(doc.getElementById('overviewMonteCarloProgressBar').style.width, doc.getElementById('mc-progress-bar').style.width, 'Beide Hosts spiegeln denselben Prozentfortschritt');
            if (cancelId === 'mcCancelButton') doc.getElementById(cancelId).click(); else click(cancelId);
            assert(doc.getElementById('overviewCancelMonteCarlo').disabled && doc.getElementById('mcCancelButton').disabled, 'Beide Abbruchknöpfe spiegeln den Abbruchzustand');
            gate.resolve(); await pending; gate = null;
            checkCardControls(false);
            assert(simulatorRunAssumptions.read('montecarlo').last === previousHead, `${cancelId}: Abbruch veröffentlicht keinen neuen erfolgreichen Laufkopf`);
            assertEqual(summaryWrites, 2, `${cancelId}: Abbruch veröffentlicht keine Summary`);
            assertEqual(doc.getElementById('overviewMonteCarloRunStatus').textContent, doc.getElementById('mcRunStatus').textContent, 'Abbruchabschluss steht in beiden Hosts');
        }
        const comparisonProgress = [];
        const compareMode = add('mcCompareMode'); compareMode.checked = true;
        doc.getElementById('rngMode').value = 'per-run-seed';
        execution.createUI = () => {
            const ui = createMonteCarloUI(), update = ui.updateProgress.bind(ui);
            ui.updateProgress = (percent, detail) => { update(percent, detail); if (detail) comparisonProgress.push({ percent, detail }); };
            return ui;
        };
        execution.runWorkers = runMonteCarloSerial;
        click('overviewRunMonteCarlo'); await pending;
        assert(comparisonProgress.some(event => event.detail.comparison === 'Vergleich seriell')
            && comparisonProgress.some(event => event.detail.comparison === 'Vergleich Worker'), 'Vergleich benennt beide Rechenphasen');
        assert(comparisonProgress.every(event => !Number.isFinite(event.detail.completedRuns) || event.detail.completedRuns <= 2), 'Vergleich meldet nie mehr fertige Läufe als n');
        assertEqual(summaryWrites, 3, 'Vergleich veröffentlicht ebenfalls genau einen Abschluss');
        const previousHead = simulatorRunAssumptions.read('montecarlo').last;
        execution.prepareHistoricalData = () => { throw new Error('SYNTHETIC_SHARED_START_FAILURE'); };
        console.error = () => {};
        click('mcButton'); await pending;
        assert(simulatorRunAssumptions.read('montecarlo').last === previousHead && summaryWrites === 3, 'Fehler meldet keinen neuen erfolgreichen Ergebnisstand');
        checkCardControls(false);
        assert(doc.getElementById('overviewMonteCarloRunStatus').textContent.includes('SYNTHETIC_SHARED_START_FAILURE'), 'Ergebnisansicht zeigt denselben Fehlerstatus');
        const settingsLink = add('settingsLink'); settingsLink.dataset = { simulatorTab: 'montecarlo' };
        settingsLink.closest = selector => selector.includes('[data-simulator-tab]') ? settingsLink : null;
        click('settingsLink'); assertEqual(tabs.at(-1), 'montecarlo', 'Einstellungen ändern aktiviert gezielt den Reiter');
    } finally {
        gate?.resolve(); await cancelMonteCarlo();
        globalThis.document = savedDocument; globalThis.window = savedWindow; console.error = savedError;
    }
}
