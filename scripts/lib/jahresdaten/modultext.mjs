/**
 * Liest erzeugte Ketten-Module als Text. Die Bauskripte schreiben das Kettenobjekt mit JSON.stringify
 * in das Modul; dieses JSON wird hier wieder herausgelöst. So bleibt der Modul-Cache von Node außen vor
 * (die Übernahme liest und schreibt dieselben Dateien in einem Prozess), und es braucht kein Poppler.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} text Modultext.
 * @param {string} startMarker Text direkt vor dem JSON.
 * @param {string} endMarker Text direkt nach dem JSON.
 * @param {string} label Name für Fehlermeldungen.
 * @returns {string} JSON-Text.
 */
export function jsonTextZwischen(text, startMarker, endMarker, label) {
    const start = text.indexOf(startMarker);
    if (start < 0) throw new Error(`${label}: Anfangsmarke fehlt (${startMarker}).`);
    const from = start + startMarker.length;
    const end = text.indexOf(endMarker, from);
    if (end < 0) throw new Error(`${label}: Endmarke fehlt (${JSON.stringify(endMarker)}).`);
    return text.slice(from, end);
}

/**
 * @param {string} root Projektwurzel.
 * @param {string} file Pfad relativ zur Wurzel.
 * @param {string} startMarker
 * @param {string} endMarker
 * @returns {any} Geparstes Objekt.
 */
export function jsonAusModul(root, file, startMarker, endMarker) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    return JSON.parse(jsonTextZwischen(text, startMarker, endMarker, file));
}
