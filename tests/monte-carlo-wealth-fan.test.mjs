import { WEALTH_FAN_BOUNDARIES, WEALTH_FAN_CLASS_COUNT, WEALTH_FAN_OVERFLOW,
    classifyWealthFanValue, createWealthFan, createWealthFanPath, recordWealthFanYear,
    commitWealthFanPath, assertWealthFan, copyWealthFan, mergeWealthFan,
    estimateWealthFanQuantile, buildWealthFanModel, wealthFanByteLength } from '../app/simulator/wealth-fan-aggregation.js';

const rejects = fn => { try { fn(); return false; } catch { return true; } };
const bytes = fan => JSON.stringify(fan, (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value);
function observe(fan, value, real = value) {
    const path = createWealthFanPath(fan.horizonYears, value);
    recordWealthFanYear(path, 1, value, real, value === 0);
    commitWealthFanPath(fan, path);
}
assertEqual(classifyWealthFanValue(0), 0, 'Null hat eigene Klasse');
assertEqual(classifyWealthFanValue(Number.MIN_VALUE), 1, 'Kleinster positiver Wert ist Unterlauf');
assertEqual(classifyWealthFanValue(Number.MAX_VALUE), WEALTH_FAN_OVERFLOW, 'Größter Wert ist Überlauf');
for (const value of [-1, NaN, Infinity, -Infinity, undefined, null, '1']) assertEqual(classifyWealthFanValue(value), -1, 'Ungültiges Vermögen ist Missingness');
for (let i = 0; i < WEALTH_FAN_BOUNDARIES.length; i++) {
    const boundary = WEALTH_FAN_BOUNDARIES[i];
    assertEqual(classifyWealthFanValue(boundary), i === WEALTH_FAN_BOUNDARIES.length - 1 ? WEALTH_FAN_OVERFLOW : i + 2, 'Exakte Grenze ist linksgeschlossen');
    assertEqual(classifyWealthFanValue(boundary * (1 - 1e-12)), i === 0 ? 1 : i + 1, 'Wert knapp unter Grenze');
    assertEqual(classifyWealthFanValue(boundary * (1 + 1e-12)), i === WEALTH_FAN_BOUNDARIES.length - 1 ? WEALTH_FAN_OVERFLOW : i + 2, 'Wert knapp über Grenze');
}
for (const values of [
    [0], [0, 0, 0, 0, 100000], [1, 1.01, 1.0201, 1.030301],
    [0, 1000000], Array.from({ length: 99 }, (_, i) => 10 ** (i / 9)),
    [1, 2, 3, 4, 5, 6, 7, 8, 1e20], [0.001, 0.2, 0.8]
]) {
    const fan = createWealthFan(2);
    values.forEach(value => observe(fan, value));
    assertWealthFan(fan, values.length);
    const sorted = [...values].sort((a, b) => a - b);
    for (const p of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
        const rank = (sorted.length - 1) * p, fraction = rank % 1;
        const exact = sorted[Math.floor(rank)] * (1 - fraction) + sorted[Math.ceil(rank)] * fraction;
        const estimate = estimateWealthFanQuantile(fan, 1, 'real', p);
        assert(estimate.lower === null || exact >= estimate.lower - 1e-8, 'Exaktes Quantil liegt über interpolierter Untergrenze');
        assert(estimate.upper === null || exact <= estimate.upper + 1e-8, 'Exaktes Quantil liegt unter interpolierter Obergrenze');
        if (estimate.value !== null) assert(Math.abs(estimate.value - exact) <= Math.max(1e-8, exact * 0.01), 'Reguläre Klassenschätzung bleibt innerhalb 1 %');
        else assert(['underflow', 'overflow'].includes(estimate.status), 'Extremklassen behaupten keine Genauigkeit');
    }
}
{
    const fan = createWealthFan(2);
    observe(fan, 500, NaN);
    const failed = createWealthFanPath(2, 500);
    recordWealthFanYear(failed, 1, 900, 900);
    commitWealthFanPath(fan, failed, true);
    assertEqual(fan.alive[0], 1, 'Technischer Fehler hinterlässt keine Teilkurve');
    assertEqual(fan.missingReal[1], 1, 'Fehlende Inflation separat');
    assertEqual(fan.missingNominal[1], 0, 'Nominalwert bleibt beobachtet');
    assertEqual(fan.ruined[1], 0, 'Missingness ist kein Ruin');
    assertEqual(estimateWealthFanQuantile(fan, 1, 'real', 0.5).status, 'missing', 'Kein Ersatz für fehlende Inflation');
    assert(rejects(() => recordWealthFanYear(failed, 1, 0, 0)), 'Jahr nicht zweimal beobachten');
    assertWealthFan(fan, 2);
    for (const mutate of [f => { f.unit = 'USD'; }, f => { f.classId = 'other'; }, f => { f.real = new Uint32Array(1); }, f => { f.alive[1] = 2; }, f => { f.ruined[1] = 2; }, f => { f.real[0]++; }]) {
        const invalid = copyWealthFan(fan); mutate(invalid);
        assert(rejects(() => assertWealthFan(invalid)), 'Falscher Vertrag wird abgewiesen');
    }
    assert(rejects(() => estimateWealthFanQuantile(fan, 3, 'real', 0.5)), 'Lookup validiert Horizont');
    assert(rejects(() => estimateWealthFanQuantile(fan, 1, 'bad', 0.5)), 'Lookup validiert Maßstab');
}
{
    const values = Array.from({ length: 113 }, (_, i) => i % 11 === 0 ? 0 : 100 * 1.012 ** i);
    const serial = createWealthFan(2); values.forEach(value => observe(serial, value));
    for (const size of [7, 31]) {
        const chunks = [];
        for (let start = 0; start < values.length; start += size) {
            const chunk = createWealthFan(2); values.slice(start, start + size).forEach(value => observe(chunk, value)); chunks.push(chunk);
        }
        const merged = createWealthFan(2); chunks.reverse().forEach(chunk => mergeWealthFan(merged, chunk));
        assertEqual(bytes(merged), bytes(serial), 'Zwei Partitionen mit umgekehrtem Abschluss sind bytegleich');
    }
    const max = createWealthFan(1); max.validRuns = 0xffffffff; max.alive[0] = max.validRuns; max.real[0] = max.validRuns; max.nominal[0] = max.validRuns;
    const one = createWealthFan(1); observe(one, 0);
    const before = bytes(max);
    assert(rejects(() => mergeWealthFan(max, one)), 'Zählerüberlauf vor Mutation abweisen');
    assertEqual(bytes(max), before, 'Abgewiesener Merge zählt nichts');
}
{
    let expectedBytes = null;
    for (const observations of [10, 10000, 1000000]) {
        const fan = createWealthFan(1);
        const path = createWealthFanPath(1, 500); recordWealthFanYear(path, 1, 600, 500);
        for (let i = 0; i < observations; i++) commitWealthFanPath(fan, path);
        expectedBytes ??= wealthFanByteLength(fan);
        assertEqual(wealthFanByteLength(fan), expectedBytes, 'Matrixgröße unabhängig von Beobachtungszahl');
        assertEqual(Object.values(fan).filter(value => value instanceof Uint32Array).length, 6, 'Anzahl fester Arrays bleibt gleich');
        assertEqual(fan.alive[1], observations, 'Million Zählerbeobachtungen ohne vollständige Simulation');
    }
    assertEqual(expectedBytes, 2 * (2 * WEALTH_FAN_CLASS_COUNT + 4) * 4, 'Exakte Byteformel');
}
{
    for (const survivors of [0, 4, 5, 6]) {
        const fan = createWealthFan(1);
        for (let i = 0; i < 100; i++) {
            const path = createWealthFanPath(1, 100);
            if (i < survivors) recordWealthFanYear(path, 1, 0, 0, true);
            commitWealthFanPath(fan, path);
        }
        const model = buildWealthFanModel(fan);
        assertEqual(model.years.length, survivors < 5 ? 1 : 2, 'Schwelle ist strikt unter fünf Prozent');
    }
    assertEqual(buildWealthFanModel(null).available, false, 'Alte Daten erhalten Platzhalter');
}

// Instrumentierung nur im Testloader: Originaldateien und RNG-Algorithmus bleiben
// unangetastet. Auch Forks zählen jede tatsächlich gezogene Zufallszahl.
const { register } = await import('node:module');
const loader = `export async function resolve(specifier, context, nextResolve) {
    const result = await nextResolve(specifier, context);
    if (context.parentURL?.includes("?p7probe=1") && result.url.includes("/app/simulator/") && result.url.endsWith(".js")) result.url += "?p7probe=1";
    return result;
}
export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (!url.endsWith('?p7probe=1')) return result;
    url = url.split('?')[0];
    if (!url.endsWith('/app/simulator/simulator-utils.js') && !url.endsWith('/app/simulator/simulator-engine-wrapper.js')) return result;
    let source = String(result.source);
    if (url.endsWith('/simulator-utils.js')) source = source.replace('const generator = () => (', 'const generator = () => (globalThis.__p7ProbeCounts && globalThis.__p7ProbeCounts.rng++, ');
    else source = source.replace('    const performanceMonitoring =', '    if (globalThis.__p7ProbeCounts) globalThis.__p7ProbeCounts.years++;\\n    if (globalThis.__p7ForceAccumulationRuin && inputs.accumulationPhase?.enabled && yearIndex === 0) return { kind: "ruin", isRuin: true };\\n    const performanceMonitoring =');
    return { ...result, source };
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`);
const { benchmarkInputs, benchmarkWidowOptions, legacyDigest } = await import('./protocol-wealth-benchmark.mjs');
const { prepareHistoricalDataOnce } = await import('../app/simulator/simulator-engine-helpers.js?p7probe=1');
const { runMonteCarloChunk } = await import('../app/simulator/monte-carlo-runner.js?p7probe=1');
const { EngineAPI } = await import('../engine/index.mjs');
const { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } = await import('../app/simulator/monte-carlo-export.js');
const { createStressReplayCaptureRequest } = await import('../app/simulator/stress-replay-path-materializer.js');
prepareHistoricalDataOnce();
const baseOptions = { inputs: { ...benchmarkInputs, startAlter: 20 }, widowOptions: benchmarkWidowOptions,
    monteCarloParams: { anzahl: 4, maxDauer: 5, seed: 42, methode: 'block', blockSize: 1, rngMode: 'per-run-seed' },
    useCapeSampling: false, runRange: { start: 0, count: 4 }, engine: EngineAPI };
const originalProbe = globalThis.__p7ProbeCounts;
try {
    for (const inputs of [baseOptions.inputs,
        { ...baseOptions.inputs, startAlter: 110 },
        { ...baseOptions.inputs, startAlter: 110, partner: { aktiv: true, startAlter: 20, geschlecht: 'w' } },
        { ...baseOptions.inputs, startVermoegen: 1, depotwertAlt: 1, einstandAlt: 1, zielLiquiditaet: 0, startFloorBedarf: 1000000, startFlexBedarf: 0 },
        { ...baseOptions.inputs, accumulationPhase: { enabled: true, years: 3, sparrate: 0, sparrateIndexing: 'none' }, transitionYear: 3 }
    ]) {
        const options = { ...baseOptions, inputs, monteCarloParams: { ...baseOptions.monteCarloParams, maxDauer: inputs.startAlter === 110 ? 1 : 5 } };
        globalThis.__p7ProbeCounts = { rng: 0, years: 0 };
        const before = await runMonteCarloChunk(options);
        const counts = { ...globalThis.__p7ProbeCounts };
        globalThis.__p7ProbeCounts = { rng: 0, years: 0 };
        const after = await runMonteCarloChunk({ ...options, collectWealthFan: true });
        assertEqual(legacyDigest(after), legacyDigest(before), 'Lesende Aggregation erhält sämtliche bisherigen Chunkfelder');
        assertEqual(JSON.stringify(globalThis.__p7ProbeCounts), JSON.stringify(counts), 'RNG- und Jahresaufrufe bleiben gleich, einschließlich Ruin/Tod');
        assert(counts.rng > 0, 'RNG-Instrumentierung beobachtet echte Aufrufe');
        for (let i = 0; i < before.runMeta.length; i++) {
            const projection = rows => projectScenarioLogV2(rows);
            assertEqual(serializeScenarioLogExportV2(projection(after.runMeta[i].logDataRows)), serializeScenarioLogExportV2(projection(before.runMeta[i].logDataRows)), 'Szenario-JSON bytegleich');
            assertEqual(serializeScenarioLogCsvV2(projection(after.runMeta[i].logDataRows)), serializeScenarioLogCsvV2(projection(before.runMeta[i].logDataRows)), 'Szenario-CSV bytegleich');
        }
        assertWealthFan(after.wealthFan, 4);
        if (inputs.startAlter === 110 && !inputs.partner.aktiv) assertEqual(after.wealthFan.alive[1], 0, 'Tod vor Verpflichtung: nur Startbeobachtung');
        if (inputs.partner.aktiv) assertEqual(after.wealthFan.alive[1], 4, 'Partnerüberleben zählt den Haushalt weiter');
        if (inputs.startVermoegen === 1) {
            assertEqual(after.wealthFan.ruined[1], 4, 'Ruinjahr zählt Nullvermögen');
            assertEqual(after.wealthFan.ruined[5], 4, 'Weitere lebende Ruinjahre zählen ausschließlich aus bestehender Fortsetzung');
            const replay = await runMonteCarloChunk({ ...options, collectWealthFan: true, stressReplayCapture: createStressReplayCaptureRequest([0]) });
            assertEqual(bytes(replay.wealthFan), bytes(after.wealthFan), 'Replay-Schattenfortsetzung zählt nicht doppelt');
        }
    }
    const technical = await runMonteCarloChunk({ ...baseOptions, collectWealthFan: true,
        engine: { simulateSingleYear: () => ({ error: new Error('Technischer Testfehler') }) } });
    assertEqual(technical.wealthFan.technicalErrors, 4, 'Technische Fehler getrennt');
    assertEqual(technical.wealthFan.alive[0], 0, 'Technische Pfade hinterlassen keine scheinbare Finanzkurve');
    let calls = 0;
    const partialTechnical = await runMonteCarloChunk({ ...baseOptions, collectWealthFan: true,
        engine: { ...EngineAPI, simulateSingleYear(...args) {
            calls++; return calls % 2 === 0 ? { error: new Error('Fehler nach erster Jahresmessung') } : EngineAPI.simulateSingleYear(...args);
        } } });
    assertEqual(partialTechnical.wealthFan.technicalErrors, 4, 'Fehler nach Teilkurve bleiben technisch');
    assertEqual(partialTechnical.wealthFan.alive[1], 0, 'Schon beobachtetes Jahr eines technischen Pfads wird verworfen');
    globalThis.__p7ForceAccumulationRuin = true;
    const accumulationOptions = { ...baseOptions,
        inputs: { ...baseOptions.inputs, accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 3 } };
    globalThis.__p7ProbeCounts = { rng: 0, years: 0 };
    const accumulationBefore = await runMonteCarloChunk(accumulationOptions);
    const accumulationCounts = { ...globalThis.__p7ProbeCounts };
    globalThis.__p7ProbeCounts = { rng: 0, years: 0 };
    const accumulationRuin = await runMonteCarloChunk({ ...accumulationOptions, collectWealthFan: true });
    assertEqual(legacyDigest(accumulationRuin), legacyDigest(accumulationBefore), 'Ansparruin erhält bisherige Felder');
    assertEqual(JSON.stringify(globalThis.__p7ProbeCounts), JSON.stringify(accumulationCounts), 'Auch Ansparruin erhält RNG-/Jahresaufrufe');
    assertEqual(accumulationRuin.wealthFan.ruined[1], 4, 'Synthetischer Jahresadapterruin während Ansparphase zählt Null');
    assertEqual(accumulationRuin.wealthFan.ruined[3], 4, 'Lebende weitere Ansparruinjahre werden mitgezählt');
    assertEqual(accumulationRuin.wealthFan.ruined[5], 4, 'Post-Ruin-Übergang in Ruhestand zählt genau einmal');
    delete globalThis.__p7ForceAccumulationRuin;
    const { annualData } = await import('../app/simulator/simulator-data.js?p7probe=1');
    const inflationValues = annualData.map(row => row.inflation);
    try {
        annualData.forEach(row => { row.inflation = undefined; });
        const missingBefore = await runMonteCarloChunk(baseOptions);
        const missingAfter = await runMonteCarloChunk({ ...baseOptions, collectWealthFan: true });
        assertEqual(legacyDigest(missingAfter), legacyDigest(missingBefore), 'Fehlende Inflation ändert keine bisherigen Ergebnisse');
        assertEqual(missingAfter.wealthFan.missingReal[1], 4, 'Runner zählt fehlende Inflation explizit');
        assertEqual(missingAfter.wealthFan.missingNominal[1], 0, 'Runner erhält nominale Beobachtung');
    } finally { annualData.forEach((row, i) => { row.inflation = inflationValues[i]; }); }
} finally {
    delete globalThis.__p7ForceAccumulationRuin;
    if (originalProbe === undefined) delete globalThis.__p7ProbeCounts; else globalThis.__p7ProbeCounts = originalProbe;
}
