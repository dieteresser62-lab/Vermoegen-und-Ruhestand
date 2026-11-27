#!/usr/bin/env node
/**
 * Register der amtlichen Jahreswerte prüfen (data/jahreswerte.json).
 *   npm run jahreswerte:pruefen [-- --datum JJJJ-MM-TT]
 * Listet je Wertgruppe, ob ein neuer Stand überfällig oder demnächst fällig ist, und prüft, dass jeder Ort im Code
 * den eingetragenen Stand noch enthält. Ändert nichts. Exit 0 ohne Überfälliges, 1 mit Überfälligem, 2 Registerfehler.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faelligkeiten, faelligkeitenText, registerFehler, registerLesen } from './lib/jahreswerte.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(args) {
    const index = args.indexOf('--datum');
    const heute = index >= 0 ? args[index + 1] : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heute ?? '') || args.some((arg, i) => arg !== '--datum' && i !== index + 1)) {
        console.error('Aufruf: npm run jahreswerte:pruefen [-- --datum JJJJ-MM-TT]');
        return 2;
    }
    const register = registerLesen(ROOT);
    const fehler = registerFehler(register, ROOT);
    if (fehler.length) {
        console.log('Register der Jahreswerte fehlerhaft:');
        for (const text of fehler) console.log(`  ${text}`);
        return 2;
    }
    const liste = faelligkeiten(register, heute);
    for (const zeile of faelligkeitenText(liste, heute)) console.log(zeile);
    return liste.some(item => item.status === 'ueberfaellig') ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
