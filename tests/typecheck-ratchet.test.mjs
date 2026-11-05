import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { checkTypeRatchet, inspectTypeDirectives } from '../scripts/typecheck-ratchet.mjs';

const current = ['app/strict.js'];
assertEqual(checkTypeRatchet(current, current, { app: 1 }, { app: 1 }).length, 0, 'gleiche Ausnahmezahl ist grün');
assertEqual(checkTypeRatchet(current, current, { app: 2 }, { app: 1 }).length, 1, 'mehr Ausnahmen sind rot');
assertEqual(checkTypeRatchet(current, current, { app: 0 }, { app: 1 }).length, 0, 'weniger Ausnahmen sind erlaubt');
assertEqual(checkTypeRatchet(current, current, { neu: 1 }, { app: 1 }).length, 1, 'neuer Ordner hat zunächst keine Ausnahmen');
assertEqual(checkTypeRatchet([], current, {}, {}).length, 1, 'strenge Liste darf nicht schrumpfen');
assertEqual(checkTypeRatchet([...current, 'app/new.js'], current, {}, {}).length, 0, 'strenge Liste darf wachsen');
assertEqual(checkTypeRatchet(current, current, {}, { app: -1 }).length, 1, 'negative Grenze ist ungültig');
assertEqual(inspectTypeDirectives('const text = "// @ts-expect-error";').exceptions, 0, 'Literal zählt nicht');
assertEqual(inspectTypeDirectives('const text = `\n// @ts-expect-error\n`;').exceptions, 0, 'Template zählt nicht');
assertEqual(inspectTypeDirectives('/** Beispiel: // @ts-expect-error */').exceptions, 0, 'JSDoc-Beispiel zählt nicht');
assertEqual(inspectTypeDirectives('// @ts-expect-error Muster: Test\nx;\n/* @ts-expect-error Muster: Test */\ny;').exceptions,
    2, 'Zeilen- und Blockdirektiven zählen');
assert(inspectTypeDirectives('// @ts-nocheck\nconst x = 1;').noCheck, 'Prüfabschaltung wird erkannt');
assert(!inspectTypeDirectives('const text = "// @ts-nocheck";').noCheck, 'Abschaltung im Literal zählt nicht');

// Der echte CLI-Pfad läuft in einem kleinen, vollständig synthetischen Repository.
const root = mkdtempSync(path.join(os.tmpdir(), 'tp10-ratchet-'));
const project = path.resolve(import.meta.dirname, '..');
const write = (file, text) => writeFileSync(path.join(root, file), text);
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
try {
    for (const folder of ['app', 'scripts', 'typcheck']) mkdirSync(path.join(root, folder));
    symlinkSync(path.join(project, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    for (const file of ['check-types.mjs', 'typecheck-support.mjs', 'typecheck-ratchet.mjs']) {
        copyFileSync(path.join(project, 'scripts', file), path.join(root, 'scripts', file));
    }
    for (const file of ['tsconfig.json', 'tsconfig.strict.json']) copyFileSync(path.join(project, file), path.join(root, file));
    write('package.json', '{"type":"module"}');
    write('typcheck/streng.json', JSON.stringify(current));
    write('typcheck/ausnahmen.json', '{"app":1}');
    write('app/strict.js', 'export const value = 1;');
    write('app/normal.js', '// @ts-expect-error Muster: synthetischer Fehler\nexport const value = missing;');
    for (const args of [['init', '--quiet'], ['add', 'typcheck/streng.json'],
        ['-c', 'user.name=Typecheck Test', '-c', 'user.email=typecheck@example.invalid',
            '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']]) {
        const result = run('git', args);
        assertEqual(result.status, 0, `synthetische Git-Basis: ${result.error?.message || result.stderr}`);
    }
    const check = () => run(process.execPath, ['scripts/check-types.mjs']);
    let result = check();
    assertEqual(result.status, 0, `CLI gleich → grün: ${result.stderr}`);
    write('app/normal.js', '// @ts-expect-error Muster: erster Fehler\nexport const one = missing;\n'
        + '// @ts-expect-error Muster: zweiter Fehler\nexport const two = missingToo;');
    result = check();
    assertEqual(result.status, 1, 'CLI mehr → rot');
    assert(result.stderr.includes('2 @ts-expect-error, höchstens 1 erlaubt'), 'CLI nennt Ordner und überschrittene Grenze');
    write('app/normal.js', 'export const value = 1;');
    result = check();
    assertEqual(result.status, 0, `CLI weniger → grün: ${result.stderr}`);
    write('typcheck/streng.json', '[]');
    result = check();
    assertEqual(result.status, 1, 'CLI entfernte strenge Datei → rot');
    assert(result.stderr.includes('Liste darf nur wachsen'), 'CLI vergleicht mit der eingecheckten strengen Liste');
    write('typcheck/streng.json', JSON.stringify(current));
    write('app/new.js', '/** @type {number} */ export const value = "falsch";');
    result = check();
    assertEqual(result.status, 1, 'CLI neue Datei ohne Freischaltzeile → rot');
    assert(result.stderr.includes('app/new.js:1:') && result.stderr.includes('TS2322'), 'CLI meldet den neuen Typfehler');
    write('app/new.js', '// @ts-nocheck\nexport const value = 1;');
    result = check();
    assertEqual(result.status, 1, 'CLI Prüfabschaltung → rot');
    assert(result.stderr.includes('@ts-nocheck ist nicht erlaubt'), 'CLI erklärt verbotene Abschaltung');
} finally {
    rmSync(root, { recursive: true, force: true });
}
