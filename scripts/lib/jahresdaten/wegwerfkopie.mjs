/**
 * Wegwerfkopie des Projekts unter einem Temp-Ordner für Rückwärtsprobe und Gegenprobe.
 * Ohne Git-Daten, Doku, Tauri, Auftragsordner und die große Sterbetafel-Quelle; alles, was Ketten, Generator,
 * Prüfung, Übernahme und Sollwerte brauchen, ist dabei. node_modules wird verlinkt (Zeilenzählung der Größenliste).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AUSGELASSEN = new Set(['.git', 'node_modules', 'docs', 'src-tauri', 'auftrag', '.testlauf', 'dist', 'target',
    '.jahresdaten-uebernahme', 'data/historical/german-cohort-life-table']);

/** @param {string} root @param {string} [praefix] @returns {string} Pfad der Kopie. */
export function wegwerfkopieAnlegen(root, praefix = 'jahresdaten-') {
    const ziel = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
    fs.cpSync(root, ziel, {
        recursive: true,
        filter: quelle => !AUSGELASSEN.has(path.relative(root, quelle).split(path.sep).join('/'))
    });
    const module = path.join(root, 'node_modules');
    if (fs.existsSync(module)) fs.symlinkSync(fs.realpathSync(module), path.join(ziel, 'node_modules'));
    return ziel;
}

/** @param {string} kopie */
export function wegwerfkopieEntfernen(kopie) {
    if (!kopie.startsWith(os.tmpdir())) throw new Error(`Keine Wegwerfkopie unter ${os.tmpdir()}: ${kopie}`);
    fs.rmSync(kopie, { recursive: true, force: true });
}
