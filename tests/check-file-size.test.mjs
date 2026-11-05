import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectCodeSizes, checkFileSizes, countCodeLines } from '../scripts/check-file-size.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'tp1-size-'));
try {
    for (const folder of ['app', 'engine', 'workers', 'types']) mkdirSync(path.join(root, folder));
    const file = path.join(root, 'app/example.js');
    const code = lines => Array.from({ length: lines }, (_, i) => `run(${i});`).join('\n');
    writeFileSync(file, code(301));
    assertEqual(checkFileSizes(collectCodeSizes(root), {}).length, 1, 'a: neue Datei über 300 wird abgewiesen');
    assertEqual(checkFileSizes(collectCodeSizes(root), { 'app/example.js': 300 }).length, 2, 'ungültige Listenwerte werden abgewiesen');
    assertEqual(checkFileSizes(collectCodeSizes(root), { 'app/example.js': 301 }).length, 0, 'bestehender Listenwert ist grün');
    writeFileSync(file, code(302));
    assertEqual(checkFileSizes(collectCodeSizes(root), { 'app/example.js': 301 }).length, 1, 'b: Wachstum über Listenwert wird abgewiesen');
    writeFileSync(file, code(300));
    assert(checkFileSizes(collectCodeSizes(root), { 'app/example.js': 301 })[0].includes('aus der Liste streichen'), 'c: geschrumpfte Datei aus der Liste streichen');
    rmSync(file);
    assert(checkFileSizes(collectCodeSizes(root), { 'app/example.js': 301 })[0].includes('aus der Liste streichen'), 'c: verschwundene Datei aus der Liste streichen');
    writeFileSync(file, `/** Kopf\n * Dokumentation\n */\n${code(300)}\n// Ende\n\n`);
    assertEqual(checkFileSizes(collectCodeSizes(root), {}).length, 0, 'grün: 300 Codezeilen mit Kommentaren');
    assertEqual(countCodeLines('/* Kopf */\n\nconst x = 1; // Kommentar\n/**\n * mehrzeilig\n */\n'), 1, 'reine Kommentar- und Leerzeilen zählen nicht');
    assertEqual(countCodeLines('const x = `a\nb`;\nconst r = /a\\/b/;'), 3, 'mehrzeilige Literale und Regex zählen als Token');
} finally {
    rmSync(root, { recursive: true, force: true });
}
