#!/usr/bin/env node
/**
 * Erzeugt die rechenbaren Klasse-3-Sollwerte aus dem aktuellen Datenstand neu (scripts/lib/jahresdaten/sollwerte.mjs).
 * `npm run jahresdaten -- <Jahr> --uebernehmen` ruft das Skript selbst auf.
 *   npm run jahresdaten:sollwerte [-- --pruefen]   mit --pruefen nur melden, ob eine Datei abweicht (Exit 1)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sollwerteSchreiben } from './lib/jahresdaten/sollwerte.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nurPruefen = process.argv.includes('--pruefen');

sollwerteSchreiben(ROOT, { nurPruefen }).then(ergebnis => {
    for (const { datei, geaendert } of ergebnis) {
        console.log(`${geaendert ? (nurPruefen ? 'weicht ab' : 'geschrieben') : 'unverändert'}: ${datei}`);
    }
    if (nurPruefen && ergebnis.some(({ geaendert }) => geaendert)) process.exitCode = 1;
}, error => {
    console.error(`Abbruch: ${error?.stack ?? error}`);
    process.exitCode = 2;
});
