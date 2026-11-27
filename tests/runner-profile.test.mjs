// TZ-1: Testprofile „schnell“ (npm test) und „schwer“ (npm run test:schwer) sowie Reihenfolge nach zuletzt gemessener Dauer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTestExecutionPolicy, getTestFiles, orderByDuration, readFileDurations } from './run-tests.mjs';
import { getTestProfile, invariantRuns } from './helpers/test-profil.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runTestsPath = path.join(__dirname, 'run-tests.mjs');
const throwsWith = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(error.message); } };

// Profil: ohne Variable „schnell“, unbekannte Werte brechen ab.
assertEqual(getTestProfile(''), 'schnell', 'Leeres TEST_PROFIL gilt als schnell');
assertEqual(getTestProfile('schwer'), 'schwer', 'TEST_PROFIL=schwer wählt das schwere Profil');
assert(throwsWith(() => getTestProfile('voll'), /TEST_PROFIL="voll" ist unbekannt/), 'Unbekannter Profilwert bricht mit Meldung ab');
assert(throwsWith(() => invariantRuns('Schwer'), /unbekannt/), 'Auch die Laufzahl der Invarianten lehnt unbekannte Profile ab');

// GN-2 ist nur im schnellen Profil ein getrenntes Tor; alle anderen Tore bleiben in beiden Profilen getrennt.
const fast = getTestExecutionPolicy('gn-2-renate-mc.test.mjs', { profile: 'schnell' });
assertEqual(fast.mode, 'separate-gate', 'Schnell: GN-2 ist ein getrenntes Tor');
assertEqual(fast.command, 'npm run test:schwer', 'Schnell: das Tor nennt npm run test:schwer');
assertEqual(getTestExecutionPolicy('gn-2-renate-mc.test.mjs', { profile: 'schwer' }).mode, 'isolated', 'Schwer: GN-2 läuft im Pool');
assertEqual(getTestExecutionPolicy('browser-smoke.test.mjs', { profile: 'schwer' }).mode, 'separate-gate', 'Schwer: Browser bleibt getrennt');
assertEqual(getTestExecutionPolicy('demography-care-survivor-runtime-measurement.test.mjs',
    { profile: 'schwer', platform: 'linux', nodeVersion: 'v22.0.0', architecture: 'x64' }).mode, 'separate-gate',
'Schwer: plattformgebundene Tests bleiben getrennt');
// Die Backtest-Charakterisierung prüft ihre bytegenauen Belege selbst nur auf der Referenzlaufzeit; Validierung und Ablauf laufen überall.
for (const profile of ['schnell', 'schwer']) {
    assertEqual(getTestExecutionPolicy('simulator-backtest-characterization.test.mjs',
        { profile, platform: 'linux', nodeVersion: 'v22.0.0', architecture: 'x64' }).mode, 'isolated',
    `${profile}: die Backtest-Charakterisierung läuft auch unter Linux im Pool`);
}

for (const profile of ['schnell', 'schwer']) {
    assertEqual(getTestExecutionPolicy('tranchen-history-returns.test.mjs', { profile }).mode, 'serial',
        `${profile}: die Zeitmessung der Tranchenrenditen läuft seriell nach dem Pool`);
}

// Invarianten: 100 Läufe im schnellen, 1.000 im schweren Profil; der Wert kommt im Kindprozess über die Umgebung an,
// ohne Variable gilt „schnell“ (auch wenn dieser Test selbst unter `npm run test:schwer` läuft).
assertEqual(invariantRuns('schnell'), 100, 'Schnell: Invarianten mit 100 Läufen');
assertEqual(invariantRuns('schwer'), 1000, 'Schwer: Invarianten mit 1.000 Läufen');
const helperUrl = new URL('./helpers/test-profil.mjs', import.meta.url).href;
for (const [profile, runs] of [[null, '100'], ['schnell', '100'], ['schwer', '1000']]) {
    const env = { ...process.env, TEST_PROFIL: profile };
    if (profile === null) delete env.TEST_PROFIL;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        `const { invariantRuns } = await import(${JSON.stringify(helperUrl)}); console.log('RUNS=' + invariantRuns());`],
    { cwd: repoRoot, encoding: 'utf8', env });
    assert(child.stdout.includes(`RUNS=${runs}`), `TEST_PROFIL=${profile ?? '(ohne)'} ergibt ${runs} Invariantenläufe`);
}

// Reihenfolge: ohne oder mit unlesbarer Dauerdatei alphabetisch, sonst lange Dateien zuerst.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruhestand-profil-'));
try {
    for (const name of ['c', 'a', 'b']) fs.writeFileSync(path.join(dir, `${name}.test.mjs`), `assert(true, '${name}');\n`);
    const files = getTestFiles(dir);
    assertEqual(readFileDurations('schnell', path.join(dir, 'fehlt.json')), null, 'Fehlende Dauerdatei liefert keine Dauern');
    fs.writeFileSync(path.join(dir, 'kaputt.json'), '{ nicht lesbar');
    assertEqual(readFileDurations('schnell', path.join(dir, 'kaputt.json')), null, 'Unlesbare Dauerdatei liefert keine Dauern');
    assertEqual(orderByDuration(files, null).join(','), 'a.test.mjs,b.test.mjs,c.test.mjs', 'Ohne Dauern bleibt die alphabetische Reihenfolge');
    fs.writeFileSync(path.join(dir, 'dauern.json'), JSON.stringify({ schwer: { 'a.test.mjs': 1, 'b.test.mjs': 9 }, schnell: { 'a.test.mjs': 5 } }));
    const durations = readFileDurations('schnell', path.join(dir, 'dauern.json'));
    assertEqual(orderByDuration(files, durations).join(','), 'c.test.mjs,b.test.mjs,a.test.mjs',
        'Mit Dauern: ungemessene Dateien zuerst, dann absteigend; das eigene Profil hat Vorrang');

    // Ein anderes TESTS_DIR liest keine Dauerdatei; ein unbekanntes Profil bricht den Lauf mit Rückgabewert 1 ab.
    const run = profile => spawnSync(process.execPath, [runTestsPath], { cwd: repoRoot, encoding: 'utf8',
        env: { ...process.env, TESTS_DIR: dir, TEST_WORKERS: '1', TEST_VERBOSE: '0', TEST_PROFIL: profile } });
    const ok = run('schwer'), output = ok.stdout + ok.stderr;
    assertEqual(ok.status, 0, 'Synthetische Suite im schweren Profil ist grün');
    assert(output.includes('Profil: schwer. Reihenfolge: alphabetisch'), 'Fremdes TESTS_DIR läuft alphabetisch ohne Dauerdatei');
    assert(output.indexOf('FILE RESULT: a.test.mjs') < output.indexOf('FILE RESULT: b.test.mjs')
        && output.indexOf('FILE RESULT: b.test.mjs') < output.indexOf('FILE RESULT: c.test.mjs'), 'Ergebniszeilen in alphabetischer Reihenfolge');
    const bad = run('voll');
    assertEqual(bad.status, 1, 'Unbekanntes Profil beendet den Lauf mit Rückgabewert 1');
    assert((bad.stdout + bad.stderr).includes('TEST_PROFIL="voll" ist unbekannt'), 'Unbekanntes Profil nennt den Wert');
    assert(!(bad.stdout + bad.stderr).includes('FILE RESULT'), 'Unbekanntes Profil startet keine Testdatei');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
