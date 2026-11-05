// Offline-Prüfung der amtlichen PDF-Anlage; Abrufherkunft steht in der Testfixture.
// Aufruf: node scripts/check-bmf-lifetime-use.mjs <PDF> [Quellordner]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [pdf, root = '.'] = process.argv.slice(2);
if (!pdf) throw new Error('Bitte den Pfad zur amtlichen BMF-Anlage 2026 angeben.');
const { BMF_LIFETIME_USE_2026: table } = await import(pathToFileURL(resolve(root, 'app/shared/bmf-lifetime-use-2026.js')));
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
const rows = [...text.matchAll(/^\s*(\d+)\s+\d+,\d{2}\s+(\d+,\d{3})\s+\d+,\d{2}\s+(\d+,\d{3})\s*$/gm)];
if (rows.length !== 101 || rows.some((row, index) => Number(row[1]) !== index)) throw new Error('PDF-Anlage enthält nicht genau die Alter 0 bis 100.');
const differences = [];
for (const [index, row] of rows.entries()) for (const [gender, column] of [['m', 2], ['w', 3]]) {
    const official = Number(row[column].replace(',', '.'));
    if (table[gender][index] !== official) differences.push(`${gender}/${index}: ${table[gender][index]} → ${official}`);
}
console.log(`202 von 202 Werten geprüft, Abweichungen: ${differences.length ? differences.join('; ') : 'keine'}`);
process.exitCode = differences.length ? 1 : 0;
