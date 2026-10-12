import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    getWorkerCount,
    getTestFiles,
    getTestExecutionPolicy,
    QUICK_TESTS_DEPRECATED_MESSAGE
} from './run-tests.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const runTestsPath = path.join(__dirname, 'run-tests.mjs');
const runSinglePath = path.join(__dirname, 'run-single.mjs');

function createTempTestDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ruhestand-runner-'));
}

function writeTest(dir, filename, source) {
    fs.writeFileSync(path.join(dir, filename), source, 'utf8');
}

function runNode(args, env = {}) {
    return spawnSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            TEST_WORKERS: '1',
            TEST_VERBOSE: '0',
            ...env
        }
    });
}

function combinedOutput(result) {
    return `${result.stdout || ''}${result.stderr || ''}`;
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

console.log('--- Runner Contract Tests ---');

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'b.test.mjs', "console.log('ORDER:b');\nassert(true, 'b pass');\n");
        writeTest(dir, 'a.test.mjs', "console.log('ORDER:a');\nassert(true, 'a pass');\n");

        const files = getTestFiles(dir);
        assertEqual(files.join(','), 'a.test.mjs,b.test.mjs', 'getTestFiles should sort test files deterministically');

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 0, 'Sorted passing temp suite should exit 0');
        const output = combinedOutput(result);
        assert(
            output.indexOf('FILE RESULT: a.test.mjs') < output.indexOf('FILE RESULT: b.test.mjs'),
            'Runner should execute sorted files in deterministic order'
        );
        assert(output.includes('a.test.mjs | mode=isolated | assertions=1'), 'Runner should report mode and assertion count per file');
    } finally {
        cleanup(dir);
    }
}

{
    const windowsOnlyPolicy = getTestExecutionPolicy(
        'german-cash-money-market-source-reconstruction.test.mjs',
        { platform: 'linux', nodeVersion: 'v22.23.2', architecture: 'x64' }
    );
    assertEqual(windowsOnlyPolicy.mode, 'separate-gate',
        'Windows-only software gate should be explicit on Linux');
    assert(windowsOnlyPolicy.reason.includes('Windows'),
        'Windows-only software gate should name its required platform');

    const windowsPolicy = getTestExecutionPolicy(
        'german-cash-money-market-source-reconstruction.test.mjs',
        { platform: 'win32', nodeVersion: 'v22.23.2', architecture: 'x64' }
    );
    assertEqual(windowsPolicy.mode, 'isolated',
        'Windows-only software gate should execute on Windows');

    const mismatchedReferencePolicy = getTestExecutionPolicy(
        'demography-care-survivor-runtime-measurement.test.mjs',
        { platform: 'linux', nodeVersion: 'v22.23.2', architecture: 'x64' }
    );
    assertEqual(mismatchedReferencePolicy.mode, 'separate-gate',
        'Byte-exact evidence should be separate outside its reference runtime');

    const matchingReferencePolicy = getTestExecutionPolicy(
        'demography-care-survivor-runtime-measurement.test.mjs',
        { platform: 'win32', nodeVersion: 'v25.2.1', architecture: 'x64' }
    );
    assertEqual(matchingReferencePolicy.mode, 'isolated',
        'Byte-exact evidence should execute in its recorded reference runtime');
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'zero.test.mjs', "console.log('import-only fixture');\n");

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 1, 'Import-only temp suite should fail the standard gate');
        const output = combinedOutput(result);
        assert(output.includes('completed with zero assertions'), 'Zero-assertion failure should explain the false-green contract');
        assert(output.includes('zero.test.mjs | mode=isolated | assertions=0'), 'Zero-assertion result should remain attributable to its file');
        assert(output.includes('Failed Files: 1'), 'Zero-assertion file should count as one failed file');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'tranchen-manager-page.test.mjs', "assert(true, 'isolated policy fixture');\n");

        const policy = getTestExecutionPolicy('tranchen-manager-page.test.mjs');
        assertEqual(policy.mode, 'isolated', 'Manager page should have an explicit isolated execution policy');
        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 0, 'Policy-isolated temp suite should exit 0');
        const output = combinedOutput(result);
        assert(output.includes('tranchen-manager-page.test.mjs | mode=isolated'), 'Policy should execute manager page in a child process');
        assert(output.includes('tranchen-manager-page.test.mjs | mode=isolated | assertions=1'), 'Isolated result should report its assertion count');
        assert(output.includes('Total Assertions: 1'), 'Parent summary should include isolated assertions');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(
            dir,
            'health-bucket.test.mjs',
            "function assert(condition, message) {\n    if (!condition) throw new Error(message);\n}\nassert(true, 'legacy pass');\n"
        );

        const policy = getTestExecutionPolicy('health-bucket.test.mjs');
        assertEqual(policy.instrumentAssertions, true, 'Legacy helper policy should activate assertion instrumentation');
        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 0, 'Instrumented legacy assertion should pass the standard gate');
        const output = combinedOutput(result);
        assert(output.includes('health-bucket.test.mjs | mode=isolated | assertions=1'), 'Legacy helper call should be counted at runtime');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(
            dir,
            'scenarios.test.mjs',
            "function assert(condition, message) {\n    if (!condition) throw new Error(message);\n}\nassert(false, 'legacy fail');\n"
        );

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 1, 'Failing instrumented legacy assertion should fail the standard gate');
        const output = combinedOutput(result);
        assert(output.includes('legacy fail'), 'Legacy assertion failure should preserve its error message');
        assert(output.includes('scenarios.test.mjs | mode=isolated | assertions=1'), 'Failing legacy helper should still report its runtime count');
        assert(output.includes('Failed Assertions: 1'), 'Legacy assertion error should count as an assertion failure');
        assert(output.includes('Failed Files: 0'), 'Legacy assertion error should not also count as a file failure');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'browser-smoke.test.mjs', "throw new Error('separate gate fixture must not be imported');\n");

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 0, 'Explicit separate-gate file should not fail the Node standard suite');
        const output = combinedOutput(result);
        assert(output.includes('browser-smoke.test.mjs | mode=separate-gate | assertions=0'), 'Separate gate should be reported explicitly');
        assert(output.includes('npm run test:browser'), 'Separate gate should name its required command');
        assert(output.includes('Separate Gates: 1'), 'Parent summary should count separate gates');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'fail.test.mjs', "assert(false, 'intentional assertion failure');\n");

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 1, 'Assertion failure should exit 1');
        const output = combinedOutput(result);
        assert(output.includes('Failed Assertions: 1'), 'Assertion failure should count one failed assertion');
        assert(output.includes('Failed Files: 0'), 'Assertion failure should not also count as a failed file');
        assert(output.includes('Failed: 1'), 'Assertion failure should produce total failed count of one');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'setup-error.test.mjs', "throw new Error('setup exploded');\n");

        const result = runNode([runTestsPath], { TESTS_DIR: dir });
        assertEqual(result.status, 1, 'Setup/import failure should exit 1');
        const output = combinedOutput(result);
        assert(output.includes('Failed Assertions: 0'), 'Setup/import failure should not count as assertion failure');
        assert(output.includes('Failed Files: 1'), 'Setup/import failure should count as failed file');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'isolated.test.mjs', "assert(true, 'isolated pass');\n");

        const result = runNode([runTestsPath, '--isolated'], { TESTS_DIR: dir });
        assertEqual(result.status, 0, 'Isolated temp suite should exit 0');
        const output = combinedOutput(result);
        assert(output.includes('Isolation: enabled'), 'Isolated mode should be visible in output');
        assert(output.includes('isolated.test.mjs | mode=isolated'), 'Isolated mode should spawn per-file runner');
        assert(output.includes('isolated.test.mjs | mode=isolated | assertions=1'), 'Forced isolation should keep assertion accounting');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        const file = path.join(dir, 'single.test.mjs');
        writeTest(dir, 'single.test.mjs', "assertEqual(2 + 2, 4, 'single arithmetic');\n");

        const result = runNode([runSinglePath, file]);
        assertEqual(result.status, 0, 'run-single should exit 0 for passing file');
        const output = combinedOutput(result);
        assert(output.includes('SINGLE TEST SUMMARY'), 'run-single should print a summary');
        assert(output.includes('Total Assertions: 1'), 'run-single should count assertions with shared assertion helpers');
        assert(output.includes('✅ PASS: single arithmetic'), 'Direct run-single stays verbose even with TEST_VERBOSE=0');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        const file = path.join(dir, 'single-fail.test.mjs');
        writeTest(dir, 'single-fail.test.mjs', "assert(false, 'single assertion failure');\n");

        const result = runNode([runSinglePath, file]);
        assertEqual(result.status, 1, 'run-single should exit 1 for assertion failure');
        const output = combinedOutput(result);
        assert(output.includes('TestAssertionError'), 'run-single should print assertion error type');
        assert(output.includes('single-fail.test.mjs'), 'run-single should print stack trace with failing file');
        assert(output.includes('Failed Assertions: 1'), 'run-single should keep assertion failure count');
        assert(output.includes('Failed Files: 0'), 'run-single should not count assertion failure as file failure');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        const file = path.join(dir, 'single-zero.test.mjs');
        writeTest(dir, 'single-zero.test.mjs', "console.log('single import-only fixture');\n");

        const result = runNode([runSinglePath, file]);
        assertEqual(result.status, 1, 'run-single should exit 1 for a zero-assertion file');
        const output = combinedOutput(result);
        assert(output.includes('completed with zero assertions'), 'run-single should explain the zero-assertion failure');
        assert(output.includes('Failed Files: 1'), 'run-single should count a zero-assertion file failure');
    } finally {
        cleanup(dir);
    }
}

{
    const dir = createTempTestDir();
    try {
        const result = runNode([runTestsPath], {
            TESTS_DIR: dir,
            QUICK_TESTS: '1'
        });
        const output = combinedOutput(result);
        assertEqual(result.status, 0, 'Deprecated QUICK_TESTS mode with no quick files should not fail setup');
        assert(output.includes(QUICK_TESTS_DEPRECATED_MESSAGE), 'QUICK_TESTS should emit a deprecation warning');
    } finally {
        cleanup(dir);
    }
}

// Normal output hides successful checks and file logs, but retains every failed
// check, including caught assertions, and repeats failures after all other output.
{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'green.test.mjs', `
            console.log('GREEN:stdout');
            console.error('GREEN:stderr');
            assert(true, 'green individual check');
        `);
        writeTest(dir, 'red.test.mjs', `
            console.log('RED:noise'.repeat(1000));
            assert(true, 'red passing check');
            try { assertClose(3, 5, 0.1, 'caught failing check'); } catch {}
            assert(false, 'final failing check');
        `);
        const normal = runNode([runTestsPath], { TESTS_DIR: dir });
        const verbose = runNode([runTestsPath], { TESTS_DIR: dir, TEST_VERBOSE: '1' });
        const normalOutput = combinedOutput(normal), verboseOutput = combinedOutput(verbose);
        assertEqual(normal.status, 1, 'Normal mode preserves failing exit code');
        assertEqual(verbose.status, normal.status, 'Verbose mode preserves exit code');
        for (const line of ['Total Assertions: 4', 'Passed: 2', 'Failed Assertions: 2', 'Failed Files: 0', 'Failed: 2']) {
            assert(normalOutput.includes(line) && verboseOutput.includes(line), `Both output modes preserve ${line}`);
        }
        for (const hidden of ['green individual check', 'red passing check', 'GREEN:stdout', 'GREEN:stderr', 'RED:noise']) {
            assert(!normalOutput.includes(hidden), `Normal mode hides ${hidden}`);
            assert(verboseOutput.includes(hidden), `Verbose mode retains ${hidden}`);
        }
        assert(verboseOutput.includes('✅ PASS: green individual check'), 'TEST_VERBOSE=1 prints individual passes');
        const resultLines = normalOutput.split('\n').filter(line => line.startsWith('📊 FILE RESULT:'));
        assertEqual(resultLines.length, 2, 'Normal mode prints exactly one result line per file');
        assert(resultLines.some(line => /green.test.mjs.*assertions=1.*duration=\d+\.\d{2} s.*✅ PASS/.test(line)),
            'Green result line reports file, assertions, duration and status');
        assert(resultLines.some(line => /red.test.mjs.*assertions=3.*duration=\d+\.\d{2} s.*❌ FAIL/.test(line)),
            'Red result line reports file, assertions, duration and status');
        const [fileOutput, finalFailures] = normalOutput.split('Collected file failures:');
        assert(finalFailures?.includes('red.test.mjs'), 'Final failure list names the red file');
        assert(!finalFailures.includes('green.test.mjs'), 'Final failure list excludes green files');
        for (const message of ['caught failing check', 'Expected: 5 +/- 0.1', 'final failing check', 'TestAssertionError:', 'at ']) {
            assert(fileOutput.includes(message) && finalFailures.includes(message), `File diagnostics and final list retain ${message}`);
        }
        assert(normalOutput.indexOf('Collected file failures:') > normalOutput.indexOf('Ten slowest files:'),
            'Final failure list follows the slowest files');
        assert(normalOutput.indexOf('Ten slowest files:') > normalOutput.indexOf('\nSUMMARY:'),
            'Slowest files follow the summary, leaving failures last');
        assert(!finalFailures.includes('SUMMARY:') && !finalFailures.includes('Ten slowest files:'),
            'No summary or timing output follows the final failure list');
    } finally { cleanup(dir); }
}

// Mixed outcomes must aggregate identically regardless of pool size. A hard exit
// deliberately produces no summary; it remains a file failure, never false green.
{
    const dir = createTempTestDir();
    try {
        writeTest(dir, 'a-pass.test.mjs', "assert(true, 'pass'); assert(true, 'pass again');");
        writeTest(dir, 'b-fail.test.mjs', "assert(false, 'expected failure');");
        writeTest(dir, 'c-throw.test.mjs', "throw new Error('expected import crash');");
        writeTest(dir, 'd-exit.test.mjs', "console.error('hard exit diagnostic'); process.exit(7);");
        writeTest(dir, 'browser-smoke.test.mjs', "throw new Error('must stay separate');");
        for (const workers of ['1', '2']) {
            const result = runNode([runTestsPath], { TESTS_DIR: dir, TEST_WORKERS: workers });
            const output = combinedOutput(result), summary = output.split('SUMMARY:').at(-1);
            assertEqual(result.status, 1, `Mixed suite exits 1 with ${workers} workers`);
            for (const line of ['Total Assertions: 3', 'Passed: 2', 'Failed Assertions: 1', 'Failed Files: 2', 'Separate Gates: 1', 'Failed: 3']) {
                assert(summary.includes(line), `${workers} workers: ${line}`);
            }
            const failures = output.split('Collected file failures:')[1];
            for (const file of ['b-fail.test.mjs', 'c-throw.test.mjs', 'd-exit.test.mjs']) {
                assert(failures.includes(file), `Collected failure names ${file}`);
            }
            assert(failures.includes('expected import crash') && failures.includes('hard exit diagnostic') && failures.includes('No isolated-test summary'),
                'Final list retains import errors and hard-exit stderr with missing-summary diagnostics');
            assert(output.includes('Total Duration:') && output.includes('Ten slowest files:'), 'Runner reports duration and slow files');
        }
    } finally { cleanup(dir); }
}

// Both files must be alive together before either may finish. This proves actual
// concurrency without relying on a tight wall-clock threshold.
{
    const dir = createTempTestDir();
    try {
        for (const [file, other] of [['a', 'b'], ['b', 'a']]) {
            writeTest(dir, file + '.test.mjs', `
                import fs from 'node:fs';
                import path from 'node:path';
                import { fileURLToPath } from 'node:url';
                const dir = path.dirname(fileURLToPath(import.meta.url));
                console.log('BLOCK:${file}:start');
                console.error('BLOCK:${file}:stderr');
                fs.writeFileSync(path.join(dir, '${file}.ready'), 'ready');
                const deadline = Date.now() + 5000;
                while (!fs.existsSync(path.join(dir, '${other}.ready')) && Date.now() < deadline) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                assert(fs.existsSync(path.join(dir, '${other}.ready')), 'pool overlaps files');
                console.log('BLOCK:${file}:end');
            `);
        }
        const result = runNode([runTestsPath], { TESTS_DIR: dir, TEST_WORKERS: '2', TEST_VERBOSE: '1' });
        assertEqual(result.status, 0, 'Two workers execute independent files concurrently');
        const output = combinedOutput(result);
        const aStart = output.indexOf('BLOCK:a:start'), aEnd = output.indexOf('BLOCK:a:end');
        const bStart = output.indexOf('BLOCK:b:start'), bEnd = output.indexOf('BLOCK:b:end');
        assert(aStart >= 0 && bStart >= 0 && (aEnd < bStart || bEnd < aStart), 'Buffered file outputs stay contiguous');
        for (const file of ['a', 'b']) assert(output.includes(`BLOCK:${file}:stderr`), 'Buffered stderr survives');
        fs.unlinkSync(path.join(dir, 'a.ready'));
        fs.unlinkSync(path.join(dir, 'b.ready'));
        writeTest(dir, 'z-serial.test.mjs', `
            import fs from 'node:fs';
            assert(fs.existsSync(${JSON.stringify(path.join(dir, 'a.ready'))}) && fs.existsSync(${JSON.stringify(path.join(dir, 'b.ready'))}), 'serial follows pool');
        `);
        const program = `
            import { runTests, getTestExecutionPolicy } from ${JSON.stringify(new URL('./run-tests.mjs', import.meta.url).href)};
            const result = await runTests({ executionPolicy: file => file === 'z-serial.test.mjs'
                ? { mode: 'serial', reason: 'Synthetic shared resource gate.' } : getTestExecutionPolicy(file) });
            process.exit(result.failedTotal ? 1 : 0);
        `;
        const serial = runNode(['--input-type=module', '-e', program], { TESTS_DIR: dir, TEST_WORKERS: '2' });
        assertEqual(serial.status, 0, 'Serial policy executes after the pool');
        const serialOutput = combinedOutput(serial);
        assert(serialOutput.indexOf('z-serial.test.mjs | mode=serial') > serialOutput.indexOf('b.test.mjs | mode=isolated'), 'Serial result follows parallel results');
    } finally { cleanup(dir); }
}
assertEqual(getWorkerCount('1'), 1, 'TEST_WORKERS=1 selects a single worker');
assertEqual(getWorkerCount(), Number(process.env.TEST_WORKERS || Math.max(1, os.cpus().length - 4)), 'Worker default follows CPU reserve or environment override');
for (const value of ['0', '-1', '1.5', 'abc', '']) {
    let failed = false;
    try { getWorkerCount(value); } catch { failed = true; }
    assert(failed, `Invalid worker count is rejected: ${value}`);
}

console.log('Runner contract tests passed');
