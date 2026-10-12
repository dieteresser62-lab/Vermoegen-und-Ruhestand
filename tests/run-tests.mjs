import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, ChildProcess } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (filePath, options) {
    try {
        return originalReadFileSync.call(fs, filePath, options);
    } catch (err) {
        if (err && err.code === 'ENOENT' && (typeof filePath === 'string' || (filePath instanceof URL))) {
            const pathStr = (filePath instanceof URL) ? fileURLToPath(filePath) : String(filePath);
            const normalized = pathStr.replace(/\\/g, '/');
            if (normalized.includes('/docs/internal/')) {
                const projectRoot = path.resolve(__dirname, '..');
                const archiveDir = path.join(projectRoot, 'docs', 'internal', 'archive');
                const basename = path.basename(pathStr);
                const subdirs = [
                    '2026-backtest-datenpruefung',
                    '2026-mindest-flex',
                    '2026-suite-datenintegritaet-hardening',
                    '2026-handbuch-ueberarbeitung',
                    '2026-bewertung-ruhestandssuite'
                ];
                for (const subdir of subdirs) {
                    const candidate = path.join(archiveDir, subdir, basename);
                    if (fs.existsSync(candidate)) {
                        return originalReadFileSync.call(fs, candidate, options);
                    }
                }
            }
        }
        throw err;
    }
};

export const QUICK_TESTS_DEPRECATED_MESSAGE =
    'QUICK_TESTS=1 is deprecated; use targeted run-single checks or the slice-specific commands instead.';

export const TEST_EXECUTION_POLICY = Object.freeze({
    'demography-care-survivor-runtime-measurement.test.mjs': Object.freeze({
        mode: 'isolated',
        referenceRuntime: Object.freeze({
            platform: 'win32',
            nodeVersion: 'v25.2.1',
            architecture: 'x64'
        }),
        command: 'node tests/run-single.mjs tests/demography-care-survivor-runtime-measurement.test.mjs',
        reason: 'Byte-exact demography evidence is pinned to its recorded Windows x64 and Node v25.2.1 runtime.'
    }),
    'german-cash-money-market-source-reconstruction.test.mjs': Object.freeze({
        mode: 'isolated',
        platforms: Object.freeze(['win32']),
        command: 'node tests/run-single.mjs tests/german-cash-money-market-source-reconstruction.test.mjs',
        reason: 'The pinned Poppler 25.07.0 PDF oracle is a Windows development gate.'
    }),
    'simulator-backtest-characterization.test.mjs': Object.freeze({
        mode: 'isolated',
        referenceRuntime: Object.freeze({
            platform: 'win32',
            nodeVersion: 'v25.2.1',
            architecture: 'x64'
        }),
        command: 'node tests/run-single.mjs tests/simulator-backtest-characterization.test.mjs',
        reason: 'Byte-exact historical evidence is pinned to its recorded Windows x64 and Node v25.2.1 runtime.'
    }),
    'auto-optimize-worker-contract.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses legacy local assertion helpers and worker/browser globals.'
    }),
    'expenses-page.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installiert einen eigenständigen Ausgaben-DOM und Persistenzfixtures.'
    }),
    'balance-expenses.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses node:assert plus legacy helpers and installs DOM/storage mocks.'
    }),
    'balance-smoke.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs a complete Balance DOM and browser-global smoke fixture.'
    }),
    'balance-messages.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installiert DOM- und Timer-Globals für den echten Balance-Renderer.'
    }),
    'balance-ui-orchestration.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs extensive DOM and browser-global mocks.'
    }),
    'profile-ui-contract.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs profile lifecycle mocks on browser globals.'
    }),
    'simulator-page-dialogs.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs simulator DOM, navigation guard and window globals for the page dialog fixtures; shared state would leak into simulator-sweep.test.mjs.'
    }),
    'health-bucket.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses legacy local assertion helpers.'
    }),
    'scenarios.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses legacy local assertion helpers.'
    }),
    'simulator-3bucket-ui-e2e.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses legacy local assertions and installs DOM mocks.'
    }),
    'simulator-headless.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Runs the full headless backtest against mutable simulator globals.'
    }),
    'simulator-overview-summary-integration.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Initialisiert den dokumentlokalen Replay-Singleton mit eigenen DOM-, Speicher- und Runnerabhängigkeiten.'
    }),
    'simulator-ui-orchestration.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs simulator DOM and browser-global mocks.'
    }),
    'spending-planner.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses legacy local assertion helpers.'
    }),
    'tranchen-manager-page.test.mjs': Object.freeze({
        mode: 'isolated',
        reason: 'Installs manager-page DOM, storage and browser-global mocks.'
    }),
    'transaction-quantization.test.mjs': Object.freeze({
        mode: 'isolated',
        instrumentAssertions: true,
        reason: 'Uses node:assert plus legacy numeric assertion helpers.'
    }),
    'browser-smoke.test.mjs': Object.freeze({
        mode: 'separate-gate',
        command: 'npm run test:browser',
        reason: 'Requires Playwright and its managed local HTTP server.'
    })
});

export function getTestExecutionPolicy(file, {
    platform = process.platform,
    nodeVersion = process.version,
    architecture = process.arch
} = {}) {
    const configured = TEST_EXECUTION_POLICY[file];
    if (configured?.mode === 'separate-gate') return configured;
    const platformMatches = !configured?.platforms || configured.platforms.includes(platform);
    const referenceRuntime = configured?.referenceRuntime;
    const referenceRuntimeMatches = !referenceRuntime || (
        referenceRuntime.platform === platform
        && referenceRuntime.nodeVersion === nodeVersion
        && referenceRuntime.architecture === architecture
    );
    if (configured && (!platformMatches || !referenceRuntimeMatches)) {
        return {
            mode: 'separate-gate',
            command: configured.command,
            reason: configured.reason
        };
    }
    // Serial resource gates must remain serial even with the legacy isolation flag.
    return configured || {
        mode: 'isolated',
        reason: 'One Node.js process per test file.'
    };
}

export class TestAssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TestAssertionError';
        this.isTestAssertionError = true;
    }
}

export function createAssertionContext({ verbosePasses = false, onFailure = () => {} } = {}) {
    const counters = {
        total: 0,
        passed: 0,
        failedAssertions: 0
    };

    function recordPass(message) {
        counters.passed++;
        if (verbosePasses) console.log(`✅ PASS: ${message}`);
    }

    function fail(message, details = []) {
        counters.failedAssertions++;
        console.error(`❌ FAIL: ${message}`);
        for (const detail of details) console.error(detail);
        const error = new TestAssertionError(message);
        onFailure(error, details);
        throw error;
    }

    return {
        counters,
        assert(condition, message) {
            counters.total++;
            if (!condition) fail(message);
            recordPass(message);
        },
        assertEqual(actual, expected, message) {
            counters.total++;
            if (actual !== expected) {
                fail(`${message} (Expected ${expected}, got ${actual})`);
            }
            recordPass(message);
        },
        assertClose(actual, expected, tolerance = 0.001, message) {
            counters.total++;
            if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
                fail(message, [
                    `   Expected: ${expected}`,
                    `   Actual:   ${actual}`,
                    '   Reason:   Non-finite value'
                ]);
            }
            if (Math.abs(actual - expected) > tolerance) {
                fail(message, [
                    `   Expected: ${expected} +/- ${tolerance}`,
                    `   Actual:   ${actual}`
                ]);
            }
            recordPass(message);
        }
    };
}

export function installAssertionGlobals(options = {}) {
    const context = createAssertionContext(options);
    global.assert = context.assert;
    global.assertEqual = context.assertEqual;
    global.assertClose = context.assertClose;
    global.__wrapExternalAssert = assertionApi => new Proxy(assertionApi, {
        apply(target, thisArg, args) {
            context.counters.total++;
            try {
                const result = Reflect.apply(target, thisArg, args);
                context.counters.passed++;
                return result;
            } catch (error) {
                context.counters.failedAssertions++;
                error.isTestAssertionError = true;
                options.onFailure?.(error);
                throw error;
            }
        },
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function') return value;
            return (...args) => global.__wrapExternalAssert(value)(...args);
        }
    });
    return context.counters;
}

export function getTestFiles(testDir, { quickOnly = false } = {}) {
    const quickFiles = new Set([
        'worker-parity.test.mjs'
    ]);

    return fs.readdirSync(testDir)
        .filter(f => f.endsWith('.test.mjs'))
        .filter(f => !quickOnly || quickFiles.has(f))
        .sort((a, b) => a.localeCompare(b, 'en'));
}

function formatOpenHandles() {
    const activeHandles = typeof process._getActiveHandles === 'function'
        ? process._getActiveHandles()
        : [];
    return activeHandles.filter(handle => (
        handle !== process.stdout &&
        handle !== process.stderr &&
        handle !== process.stdin &&
        !(handle instanceof ChildProcess && (handle.exitCode !== null || handle.signalCode !== null))
    ));
}

function printFileResult(file, policy, result, durationSeconds = 0) {
    const status = policy.mode === 'separate-gate' ? '⏭️ SKIP'
        : result.failedAssertions || result.failedFiles ? '❌ FAIL' : '✅ PASS';
    console.log(
        `📊 FILE RESULT: ${file} | mode=${policy.mode} | assertions=${result.totalAssertions}` +
        ` | passed=${result.passedAssertions} | failedAssertions=${result.failedAssertions}` +
        ` | failedFiles=${result.failedFiles} | duration=${durationSeconds.toFixed(2)} s | ${status}` +
        (policy.mode === 'separate-gate' ? ` | ${policy.command} | ${policy.reason}` : '')
    );
}

export function getWorkerCount(value = process.env.TEST_WORKERS) {
    if (value === undefined) return Math.max(1, os.cpus().length - 4);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('TEST_WORKERS must be a positive integer.');
    }
    return Number(value);
}

function runIsolatedFile({ testDir, file, policy, verbose }) {
    return new Promise(resolve => {
        const started = performance.now();
        const output = [];
        const errorOutput = [];
        let summary, spawnError;
        const child = spawn(process.execPath, [path.join(__dirname, 'run-single.mjs'), path.join(testDir, file)], {
            cwd: path.resolve(__dirname, '..'),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        });
        child.stdout.on('data', chunk => output.push(chunk));
        child.stderr.on('data', chunk => { output.push(chunk); errorOutput.push(chunk); });
        child.on('message', message => {
            if (message?.type === 'test-summary' && ['totalAssertions', 'passedAssertions', 'failedAssertions', 'failedFiles']
                .every(key => Number.isSafeInteger(message[key]) && message[key] >= 0)) summary = message;
        });
        child.on('error', error => { spawnError = error; });
        child.on('close', (code, signal) => {
            const result = {
                totalAssertions: summary?.totalAssertions ?? 0,
                passedAssertions: summary?.passedAssertions ?? 0,
                failedAssertions: summary?.failedAssertions ?? 0,
                failedFiles: summary?.failedFiles ?? 0
            };
            let diagnostic = '';
            if (spawnError || !summary) {
                result.failedFiles = Math.max(result.failedFiles, 1);
                diagnostic = spawnError?.message || `No isolated-test summary (exit=${code}, signal=${signal}).`;
            } else if ((code !== 0 || result.totalAssertions === 0) && result.failedAssertions === 0 && result.failedFiles === 0) {
                result.failedFiles++;
                diagnostic = `Unexpected exit=${code} or zero assertions.`;
            }
            const durationSeconds = (performance.now() - started) / 1000;
            const buffered = Buffer.concat(output).toString('utf8');
            const failed = result.failedAssertions || result.failedFiles;
            const reportedFailures = Array.isArray(summary?.failures) && summary.failures.every(item => typeof item === 'string')
                ? summary.failures : [];
            const failures = failed ? [...reportedFailures] : [];
            if (diagnostic) failures.push(diagnostic);
            // Missing IPC (e.g. a hard exit) still needs a short excerpt of the file's error output.
            if (failed && !reportedFailures.length) {
                const excerpt = (Buffer.concat(errorOutput).toString('utf8') || buffered).trim().split('\n').slice(0, 8).join('\n');
                if (excerpt) failures.push(excerpt);
            }
            if (verbose) {
                console.log(`\n📂 Running ${file} in isolated process...`);
                if (buffered) process.stdout.write(buffered.endsWith('\n') ? buffered : buffered + '\n');
                if (diagnostic) console.log(`❌ ${file}: ${diagnostic}`);
            }
            printFileResult(file, policy, result, durationSeconds);
            if (!verbose) for (const failure of failures) console.log(failure);
            resolve({ file, ...result, durationSeconds, output: buffered + diagnostic, failures });
        });
    });
}

async function runFiles({ testDir, files, workers, verbose, executionPolicy = getTestExecutionPolicy }) {
    const totals = {
        totalAssertions: 0, passedAssertions: 0, failedAssertions: 0, failedFiles: 0, separateGates: 0,
        fileResults: []
    };
    const parallel = [], serial = [];
    for (const file of files) {
        const policy = executionPolicy(file);
        if (policy.mode === 'separate-gate') {
            if (verbose) {
                console.log(`\n⏭️  ${file} is covered by separate gate: ${policy.command}`);
                console.log(`   Reason: ${policy.reason}`);
            }
            printFileResult(file, policy, { totalAssertions: 0, passedAssertions: 0, failedAssertions: 0, failedFiles: 0 });
            totals.separateGates++;
        } else {
            (policy.mode === 'serial' ? serial : parallel).push({ testDir, file, policy, verbose });
        }
    }
    const run = async task => {
        const result = await runIsolatedFile(task);
        for (const key of ['totalAssertions', 'passedAssertions', 'failedAssertions', 'failedFiles']) totals[key] += result[key];
        totals.fileResults.push(result);
    };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(workers, parallel.length) }, async () => {
        while (next < parallel.length) await run(parallel[next++]);
    }));
    for (const task of serial) await run(task);
    return totals;
}

function printSummary(results, openHandles) {
    const failedTotal = results.failedAssertions + results.failedFiles;

    console.log('\n' + '='.repeat(40));
    console.log('SUMMARY:');
    console.log(`Total Assertions: ${results.totalAssertions}`);
    console.log(`Passed: ${results.passedAssertions}`);
    console.log(`Failed Assertions: ${results.failedAssertions}`);
    console.log(`Failed Files: ${results.failedFiles}`);
    console.log(`Separate Gates: ${results.separateGates}`);
    console.log(`Failed: ${failedTotal}`);
    console.log(`Open Handles: ${openHandles.length}`);
    console.log('='.repeat(40));

    if (openHandles.length > 0) {
        console.warn(`\n⚠️  Open handles detected: ${openHandles.length}`);
        openHandles.forEach((handle, index) => {
            const name = handle?.constructor?.name || typeof handle;
            console.warn(`  ${index + 1}. ${name}`);
        });
    }

    return failedTotal;
}

export async function runTests({
    testDir = process.env.TESTS_DIR ? path.resolve(process.env.TESTS_DIR) : __dirname,
    quickOnly = process.env.QUICK_TESTS === '1',
    workers = getWorkerCount(),
    executionPolicy = getTestExecutionPolicy
} = {}) {
    workers = getWorkerCount(String(workers));
    const started = performance.now();
    console.log('🚀 Starting Test Runner...');

    if (quickOnly) {
        console.warn(`⚠️  ${QUICK_TESTS_DEPRECATED_MESSAGE}`);
    }

    const files = getTestFiles(testDir, { quickOnly });
    console.log(`Found ${files.length} test files.`);
    console.log(`Isolation: enabled (one Node.js process per test file). Workers: ${workers}`);
    const results = await runFiles({ testDir, files, workers, executionPolicy, verbose: process.env.TEST_VERBOSE === '1' });
    const durationSeconds = (performance.now() - started) / 1000;
    await new Promise(resolve => setImmediate(resolve));
    const openHandles = formatOpenHandles();
    const failedTotal = printSummary(results, openHandles);
    console.log(`\nTotal Duration: ${durationSeconds.toFixed(2)} s`);
    console.log('Ten slowest files:');
    [...results.fileResults].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 10)
        .forEach(result => console.log(`  ${result.durationSeconds.toFixed(2)} s | ${result.file}`));
    const failures = results.fileResults.filter(result => result.failedAssertions || result.failedFiles);
    if (failures.length) {
        console.log('\nCollected file failures:');
        for (const result of failures) {
            console.log(`\n❌ ${result.file}`);
            for (const failure of result.failures) console.log(failure);
        }
    }

    return {
        ...results,
        durationSeconds,
        failedTotal,
        openHandles: openHandles.length
    };
}

export async function flushTestOutput() {
    await Promise.all([process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write('', resolve))));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
    runTests()
        .then(async result => {
            await flushTestOutput();
            process.exit(result.failedTotal > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('❌ Test runner failed during setup/import:');
            console.error(error);
            process.exit(1);
        });
}
