import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(os.tmpdir(), 'zl1-exports-'));
const project = path.resolve(import.meta.dirname, '..');
const write = (file, text) => writeFileSync(path.join(root, file), text);
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8' });
try {
    for (const folder of ['app', 'engine', 'workers', 'types', 'scripts']) mkdirSync(path.join(root, folder));
    symlinkSync(path.join(project, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    copyFileSync(path.join(project, 'scripts/check-facade-exports.mjs'), path.join(root, 'scripts/check-facade-exports.mjs'));
    write('package.json', '{"type":"module"}');
    write('app/store.js', 'export let value = 1; export default function store() {}');
    write('app/existing.js', 'export { value as renamed } from "./store.js";');
    write('engine/core.mjs', 'export const engine = 1;');
    write('workers/job.js', 'export const job = 1;');
    write('types/record.js', 'export const record = 1;');
    write('engine.js', 'export { engine } from "./engine/core.mjs";');
    for (const args of [['init', '--quiet'], ['add', '.'],
        ['-c', 'user.name=Facade Test', '-c', 'user.email=facade@example.invalid', '-c', 'core.hooksPath=/dev/null',
            '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']]) {
        const result = run('git', args);
        assertEqual(result.status, 0, `synthetische Git-Basis: ${result.error?.message || result.stderr}`);
    }
    const check = () => run(process.execPath, ['scripts/check-facade-exports.mjs', 'HEAD']);
    write('app/module.js', 'export let value = 1; export default function store() {}');
    write('app/store.js', 'export { value, default } from "./module.js";');
    let result = check();
    assertEqual(result.status, 0, `benannte Re-Exporte einschließlich default erhalten: ${result.stderr}`);
    assertEqual(result.stdout.trim(), 'Exporte erhalten: 6 Dateien', 'CLI nennt die Zahl der Basisdateien');
    write('app/module.js', 'export default function store() {}');
    result = check();
    assertEqual(result.status, 1, 'fehlender Export hinter Re-Export ist ein Verstoß');
    assert(result.stderr.includes('app/store.js: Export value fehlt'), 'Verstoß nennt fehlenden ursprünglichen Namen');
    assert(result.stderr.includes('app/existing.js: Export renamed fehlt'), 'auch mehrstufiger Re-Export wird aufgelöst');
    write('app/module.js', 'export let value = 1;');
    result = check();
    assertEqual(result.status, 1, 'fehlender default ist ein Verstoß');
    assert(result.stderr.includes('app/store.js: Export default fehlt'), 'default wird benannt');
    write('app/module.js', 'export let value = 1; export default function store() {}');
    rmSync(path.join(root, 'workers/job.js'));
    result = check();
    assertEqual(result.status, 1, 'gelöschte Basisdatei ist ein Verstoß');
    assert(result.stderr.includes('workers/job.js: Datei fehlt'), 'gelöschte Datei wird benannt');
    write('workers/job.js', 'export const job = 1; export const extra = 2;');
    result = check();
    assertEqual(result.status, 0, `zusätzlicher Export ist erlaubt: ${result.stderr}`);
} finally {
    rmSync(root, { recursive: true, force: true });
}
