import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readConfig, readStrictFiles, collectDiagnostics, reconcileNormalDiagnostics, formatDiagnostic,
    projectRoot, relativePath } from './typecheck-support.mjs';
import { inspectTypeRatchet } from './typecheck-ratchet.mjs';

function writeMap(files, checked, normal, strict, counts) {
    const rows = new Map();
    for (const file of files) {
        const folder = path.posix.dirname(relativePath(file));
        if (!rows.has(folder)) rows.set(folder, [0, 0, 0, 0, 0]);
        const row = rows.get(folder);
        row[0]++;
        if (checked.has(file)) row[1]++;
        row[4] = counts[folder];
    }
    for (const [diagnostics, column] of [[normal, 2], [strict, 3]]) {
        for (const diagnostic of diagnostics) {
            const row = diagnostic.file && rows.get(path.posix.dirname(relativePath(diagnostic.file.fileName)));
            if (row) row[column]++;
        }
    }
    const totals = [0, 0, 0, 0, 0];
    const lines = ['# Fehlerkarte der Typprüfung', '',
        'Erzeugt mit `npm run check:types -- --karte`. `checkJs: true` prüft alle JavaScript-Dateien normal. Die strenge Kartenspalte prüft zusätzlich alle Dateien mit `strict: true`; nur die Liste `typcheck/streng.json` ist das strenge Gate. Vorhandene `@ts-expect-error` bleiben wirksam.', '',
        '| Ordner | Dateien | Normal geprüfte Dateien | Fehler bei normaler Prüfung aller Dateien | Fehler bei strenger Prüfung | `@ts-expect-error` |',
        '| --- | ---: | ---: | ---: | ---: | ---: |'];
    for (const [folder, row] of [...rows].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        row.forEach((value, i) => { totals[i] += value; });
        lines.push(`| ${folder} | ${row.join(' | ')} |`);
    }
    lines.push(`| Gesamt | ${totals.join(' | ')} |`, '');
    writeFileSync(path.join(projectRoot, 'docs/internal/typpruefung-fehlerkarte.md'), lines.join('\n'));
    console.log(`Fehlerkarte: ${files.length} Dateien, ${totals[2]} Fehler normal, ${totals[3]} Fehler streng.`);
}

try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--karte')) throw new Error('Aufruf: node scripts/check-types.mjs [--karte]');
    const normalConfig = readConfig();
    const strictConfig = readConfig('tsconfig.strict.json');
    const files = normalConfig.fileNames.filter(file => /\.(?:m?js)$/.test(file));
    if (normalConfig.options.checkJs !== true) throw new Error('tsconfig.json muss checkJs: true setzen.');
    const normalFiles = files;
    const strictFiles = readStrictFiles(files);
    const ratchet = inspectTypeRatchet(files, strictFiles, projectRoot);
    if (ratchet.errors.length) throw new Error(ratchet.errors.join('\n'));
    if (args.includes('--karte')) {
        const strict = collectDiagnostics(strictConfig, files, { all: true });
        const normal = reconcileNormalDiagnostics(collectDiagnostics(normalConfig, files, { all: true }), strict, files);
        writeMap(files, new Set(normalFiles), normal, strict, ratchet.counts);
    } else {
        const strict = collectDiagnostics(strictConfig, strictFiles);
        const normal = reconcileNormalDiagnostics(collectDiagnostics(normalConfig, normalFiles), strict, strictFiles);
        for (const diagnostic of [...normal, ...strict]) console.error(formatDiagnostic(diagnostic));
        console.log(`Typprüfung: ${normalFiles.length} Dateien normal, ${strictFiles.length} Dateien streng, ${normal.length + strict.length} Fehler.`);
        if (normal.length || strict.length) process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
