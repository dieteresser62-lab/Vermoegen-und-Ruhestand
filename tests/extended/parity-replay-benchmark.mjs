import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { EngineAPI } from '../../engine/index.mjs';
import { simulateOneYear } from '../../app/simulator/simulator-engine-wrapper.js';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../../app/simulator/sweep-runner.js';
import { hashParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { normalizeWidowOptions } from '../../app/simulator/simulator-sweep-utils.js';
import { inputs, records, source, provider, runFixture } from './parity-replay-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselineRevision = 'f99a62cd9920fa589239f21bff593bd1e7aeeb8d';
const baselineHashes = {
    'simulator-engine-direct.js': '7060827078580137bf73437ddd24e5724c2c0aa6582edc994b9d3015be2667c9',
    'simulator-engine-wrapper.js': '9a24050717a7be3c6f8cb8ffee58cd615b1bc0e75e5c9db0a20947c511251387'
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function sourceContentHash() {
    async function files(path) {
        const entries = await readdir(path, { withFileTypes: true });
        const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(path, entry.name))
            : /\.(js|mjs|json)$/.test(entry.name) ? [join(path, entry.name)] : []));
        return nested.flat();
    }
    const paths = (await Promise.all(['app', 'engine', 'types', 'workers'].map(path => files(join(root, path))))).flat().sort();
    const manifest = await Promise.all(paths.map(async path => [relative(root, path), hashParityReplayValue(await readFile(path, 'utf8'))]));
    return hashParityReplayValue(manifest);
}

/** Read-only git baseline, rewritten into a private temporary module graph. No checkout or writes to .git. */
async function loadBaseline(scratch) {
    const sourcePath = 'app/simulator/';
    const direct = sourcePath + 'simulator-engine-direct.js';
    const wrapper = sourcePath + 'simulator-engine-wrapper.js';
    const targets = new Map([direct, wrapper, sourcePath + 'monte-carlo-runner.js', sourcePath + 'sweep-runner.js']
        .map(path => [resolve(root, path), pathToFileURL(join(scratch, path.split('/').at(-1))).href]));
    for (const [absolute, destination] of targets) {
        const name = relative(root, absolute);
        let contents;
        if (name === direct || name === wrapper) {
            if (process.env.PARITY_BASELINE_DIR) {
                contents = await readFile(join(process.env.PARITY_BASELINE_DIR, name.split('/').at(-1)), 'utf8');
            } else {
                try {
                    contents = execFileSync('git', ['show', `${baselineRevision}:${name}`], { cwd: root, encoding: 'utf8' });
                } catch {
                    throw new Error('Git-Unterprozess gesperrt. Die beiden ursprünglichen Jahresmodule in PARITY_BASELINE_DIR bereitstellen (tests/README.md).');
                }
            }
            assert.equal(hashParityReplayValue(contents), baselineHashes[name.split('/').at(-1)], 'Basisdatei entspricht der festgelegten Revision');
        } else contents = await readFile(absolute, 'utf8');
        assert.ok(!contents.includes('replayCollector'), 'Baseline muss der Stand vor dem Collector sein');
        const rewritten = contents.replace(/(from\s*)(['"])(\.[^'"]+)\2/g, (_, prefix, quote, specifier) => {
            const imported = resolve(dirname(absolute), specifier);
            return `${prefix}${quote}${targets.get(imported) || pathToFileURL(imported).href}${quote}`;
        });
        await writeFile(fileURLToPath(destination), rewritten);
    }
    const [wrapperModule, mc, sweep] = await Promise.all([
        import(targets.get(resolve(root, wrapper))),
        import(targets.get(resolve(root, sourcePath + 'monte-carlo-runner.js'))),
        import(targets.get(resolve(root, sourcePath + 'sweep-runner.js')))
    ]);
    return { simulate: wrapperModule.simulateOneYear, mc: mc.runMonteCarloChunk, sweep: sweep.runSweepChunk };
}

export async function benchmarkParityReplayCollector() {
    const scratch = await mkdtemp(join(tmpdir(), 'pa-2-benchmark-'));
    try {
        await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
        const baseline = await loadBaseline(scratch);
        const selectedPeriod = { startYear: 2000, endYear: 2025 };
        const provenance = { ...source, sourceHash: await sourceContentHash(), datasetHash: hashParityReplayValue(provider.preparePeriod(selectedPeriod)) };
        const monteCarloParams = { anzahl: 12, maxDauer: 12, blockSize: 3, seed: 12345,
            methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
        const options = { inputs, monteCarloParams, widowOptions: normalizeWidowOptions(inputs.widowOptions), useCapeSampling: true, engine: EngineAPI };
        const sweepOptions = { baseInputs: inputs, paramCombinations: [
            { liquidityRunwayYears: 3 }, { liquidityRunwayYears: 5 }
        ], sweepConfig: { ...monteCarloParams, anzahl: 6, useCapeSampling: true }, engine: EngineAPI };
        const jobs = [
            { name: 'Backtest, 26 Jahre', old: () => runFixture({ simulate: baseline.simulate, selectedPeriod }),
                off: () => runFixture({ selectedPeriod }),
                on: () => runFixture({ selectedPeriod, collector: createParityReplayCollector({ source: provenance, initialRecords: records }) }) },
            { name: 'Monte Carlo, 12 × 12 Jahre', old: () => baseline.mc(options), off: () => runMonteCarloChunk(options) },
            { name: 'Sweep, 2 × 6 × 12 Jahre', old: () => baseline.sweep(sweepOptions), off: () => runSweepChunk(sweepOptions) }
        ];
        const measurements = [];
        for (const job of jobs) {
            const previous = JSON.stringify(await job.old());
            assert.equal(JSON.stringify(await job.off()), previous, `${job.name}: alt/aus bytegleich`);
            if (job.on) assert.equal(JSON.stringify(await job.on()), previous, `${job.name}: alt/an bytegleich`);
            for (let i = 0; i < 3; i++) { await job.old(); await job.off(); }
            const times = { old: [], off: [], on: [] };
            const batch = 3;
            for (let round = 0; round < 9; round++) {
                const modes = round % 2 ? ['off', 'old'] : ['old', 'off'];
                if (job.on) modes.push('on');
                for (const mode of modes) {
                    const start = performance.now();
                    for (let i = 0; i < batch; i++) await job[mode]();
                    times[mode].push((performance.now() - start) / batch);
                }
            }
            const oldMs = median(times.old);
            const offMs = median(times.off);
            const pairDelta = times.off.map((value, index) => value - times.old[index]);
            const deltaMs = median(pairDelta);
            const noiseMs = median(pairDelta.map(value => Math.abs(value - deltaMs)));
            const row = { name: job.name, byteIdentical: true, oldMedianMs: oldMs, offMedianMs: offMs,
                pairedDeltaMedianMs: deltaMs, pairedDeltaMadMs: noiseMs,
                measurableDisabledOverhead: deltaMs > Math.max(noiseMs * 3, oldMs * 0.02),
                ...(job.on ? { onMedianMs: median(times.on) } : {}) };
            measurements.push(row);
        }
        const collector = createParityReplayCollector({ source: provenance, initialRecords: records });
        runFixture({ selectedPeriod, collector });
        const start = performance.now();
        const json = JSON.stringify(collector.toLog());
        const result = { node: process.version, baselineRevision, samples: 9, batch: 3,
            criterion: 'Median der gepaarten Differenz > max(3 × MAD, 2 % der bisherigen Laufzeit)',
            source: provenance, measurements, logBytes: Buffer.byteLength(json), exportMs: performance.now() - start };
        console.log(JSON.stringify(result, null, 2));
        return result;
    } finally {
        await rm(scratch, { recursive: true });
    }
}
