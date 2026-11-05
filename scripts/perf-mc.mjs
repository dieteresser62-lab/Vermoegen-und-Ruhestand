// PE-1/MP-1: seriell, ohne Protokollzeilen, frischer V8-Prozess je Messung.
// Synthetischer Musterhaushalt; bewusst kein Zeitgrenzwert in npm test.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

if (process.argv.includes('--sample')) {
    const { EngineAPI } = await import('../engine/index.mjs');
    globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
    const { prepareHistoricalDataOnce } = await import('../app/simulator/simulator-engine-helpers.js');
    prepareHistoricalDataOnce();
    const { runMonteCarloChunk } = await import('../app/simulator/monte-carlo-runner.js');
    const inputs = JSON.parse(readFileSync(new URL('../tests/fixtures/pe-1-max-erika.json', import.meta.url), 'utf8'));
    const monteCarloParams = { anzahl: 1000, maxDauer: 35, blockSize: 5, seed: 12345,
        methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    const started = performance.now();
    for (let start = 0; start < 1000; start += 100) {
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams,
            widowOptions: inputs.widowOptions, useCapeSampling: false,
            runRange: { start, count: 100 }, logIndices: [] });
        if (chunk.technicalInventory.technicalError !== 0) throw new Error('MC-Messung enthält technische Fehler.');
    }
    const measurement = { msPerRun: (performance.now() - started) / 1000 };
    if (process.send) {
        await new Promise((resolve, reject) => process.send(measurement, error => error ? reject(error) : resolve()));
        process.disconnect();
    } else console.log(JSON.stringify(measurement));
} else {
    const samples = [];
    for (let trial = 1; trial <= 3; trial++) {
        const measurement = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--sample'],
                { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
            let result = null, errors = '';
            child.stderr.setEncoding('utf8');
            child.on('message', value => { result = value; });
            child.stderr.on('data', chunk => { errors += chunk; });
            child.once('error', reject);
            child.once('close', status => status === 0 && result ? resolve(result)
                : reject(new Error(errors || `Messprozess: ${status}, Messwert fehlt`)));
        });
        const { msPerRun } = measurement;
        if (!Number.isFinite(msPerRun) || msPerRun <= 0) throw new Error('Ungültiger Messwert.');
        samples.push(msPerRun);
        console.log(`Messung ${trial}/3: ${msPerRun.toFixed(2)} ms je Lauf`);
    }
    samples.sort((a, b) => a - b);
    console.log(`Max und Erika · 1.000 Läufe · Median aus 3: ${samples[1].toFixed(2)} ms je Lauf (${process.version})`);
}
