import { testParityReplayCollector } from './parity-replay-collector.mjs';
import { testParityBalanceReplay } from './parity-balance-replay.mjs';
import { testParityComparison } from './parity-comparison.mjs';
import { testParityD23, replayD23ParityCase } from './parity-d23.mjs';
import { replayParityCase } from '../../app/balance/parity-case.js';
import { EngineAPI } from '../../engine/index.mjs';
import { readFileSync } from 'node:fs';
import { runParityScenarios, writeParityRun, replayParitySequenceCase } from './parity-scenarios.mjs';
import { nodeParityHash } from './parity-node-hash.mjs';

const selected = process.argv.indexOf('--fall');
for (const flag of ['--fall', '--ausgabe']) {
    const position = process.argv.indexOf(flag);
    if (position >= 0 && (!process.argv[position + 1] || process.argv[position + 1].startsWith('--'))) throw new Error(`${flag} braucht einen Pfad.`);
}
if (selected >= 0) {
    const value = JSON.parse(readFileSync(process.argv[selected + 1], 'utf8'));
    const replay = value.kind === 'D23_PROBE' ? replayD23ParityCase(value)
        : value.replay?.sequence ? replayParitySequenceCase(value) : replayParityCase(value, { engineApi: EngineAPI, hashValue: nodeParityHash });
    if (!replay.reproduced) throw new Error(`Einzelfall nicht reproduziert: ${JSON.stringify(replay.validation)}`);
    console.log(`${value.id}: reproduziert (${replay.case.summary.status}); keine fachliche Freigabe.`);
} else if (process.argv.includes('--pruefungen')) {
    const started = performance.now();
    testParityReplayCollector();
    testParityBalanceReplay();
    const probes = [...testParityComparison(), ...testParityD23()];
    const { testParityScenarios } = await import('./parity-scenarios-checks.mjs');
    testParityScenarios();
    const output = process.argv.indexOf('--ausgabe');
    if (output >= 0) {
        const run = { cases: [], scenarios: [], failed: false, durationMs: performance.now() - started };
        const { destination } = writeParityRun(run, probes, process.argv[output + 1]);
        console.log(`${probes.length} reproduzierte Gegenproben: ${destination}`);
    }
} else {
    const run = runParityScenarios();
    for (const scenario of run.scenarios) console.log(scenario.console);
    const output = process.argv.indexOf('--ausgabe');
    const { destination, summary } = writeParityRun(run, [], output >= 0 ? process.argv[output + 1] : undefined);
    console.log(`${summary.files.length} ParityCaseV1-Fälle und zusammenfassung.json: ${destination}`);
    console.log(`Laufzeit Szenarien und Export: ${(summary.durationMs / 1000).toFixed(2)} s; Ziel unter 10 s ${summary.runtimeTargetMet ? 'erreicht' : 'überschritten'}.`);
    if (run.failed) process.exitCode = 1;
}
if (selected < 0 && process.argv.includes('--benchmark')) {
    const { benchmarkParityReplayCollector } = await import('./parity-replay-benchmark.mjs');
    await benchmarkParityReplayCollector();
}
