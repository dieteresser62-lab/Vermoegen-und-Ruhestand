/**
 * `npm run jahresdaten -- <Y> --uebernehmen`: hängt Y an alle sechs Ketten an.
 *
 * Ablauf: offenes Journal abschließen → Prüfung (rot bricht ab, ohne etwas zu schreiben) → Staging in einer
 * Wegwerfkopie: Jahreszeilen mit derselben Rechenregel wie der Bau, Generator mit Endjahr und Revision `<Y>-<lfd>`,
 * Klasse-3-Sollwerte, Größenliste, Bericht, danach Generator- und Sollwertprüfung → Journal mit altem und neuem SHA
 * je Ziel → Umschalten je Datei atomar. Scheitert das Umschalten, nimmt die Übernahme alles zurück; scheitert auch
 * das, bleibt das Journal offen und der nächste Aufruf schließt es ab (journal.mjs). Werte vor Y ändert sie nie.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KETTEN } from './ketten.mjs';
import { lieferungLesen } from './lieferung.mjs';
import { zeileAnhaengen } from './fortschreibung.mjs';
import { berichtPfade, berichtSchreiben, datenstandLesen, DATENSTAND_DATEI, pruefen } from './pruefung.mjs';
import { SOLLWERT_DATEIEN } from './sollwerte.mjs';
import { countCodeLines } from '../../javascript-syntax.mjs';
import { wegwerfkopieAnlegen, wegwerfkopieEntfernen } from './wegwerfkopie.mjs';
import { atomarSchreiben, journalAbschliessen, journalAnlegen, journalEntfernen, JOURNAL_ORDNER, richtungSetzen, zieleBestaetigen, zieleSchreiben } from './journal.mjs';

export const GENERATOR_DATEIEN = Object.freeze([DATENSTAND_DATEI, 'app/simulator/historical-data-records.js', 'Simulator.html']);
export const NAECHSTER_SCHRITT = 'Prüfkette, Messung MC 2.000 Pfade alt/neu, Backtest, Abnahme';
export const GROESSENLISTE = 'typcheck/grosse-dateien.json';

/**
 * Erzeugte Kettenmodule wachsen mit jedem angehängten Jahr. Liegt eines über 300 Codezeilen und über seinem
 * Listenwert, hebt die Übernahme den Wert in typcheck/grosse-dateien.json an (Begründung: erzeugte Daten).
 * @param {string} root @param {string[]} dateien @returns {string[]} angehobene Dateien.
 */
export function groessenlisteNachziehen(root, dateien) {
    const full = path.join(root, GROESSENLISTE);
    const liste = JSON.parse(fs.readFileSync(full, 'utf8'));
    const angehoben = dateien.filter(file => {
        const zeilen = countCodeLines(fs.readFileSync(path.join(root, file), 'utf8'), file);
        if (zeilen <= 300 || liste[file] >= zeilen) return false;
        liste[file] = zeilen;
        return true;
    });
    if (angehoben.length) fs.writeFileSync(full, `${JSON.stringify(liste, null, 2)}\n`);
    return angehoben;
}

/**
 * Revision nach dem Schema `<Y>-<lfd>`: erste Übernahme eines Jahres `<Y>-1`, jede weitere zählt hoch.
 * @param {string} bisher @param {number} jahr
 */
export function naechsteRevision(bisher, jahr) {
    const match = /^(\d{4})-(\d+)$/.exec(bisher ?? '');
    return match && Number(match[1]) === jahr ? `${jahr}-${Number(match[2]) + 1}` : `${jahr}-1`;
}

/** @param {string} root @param {string} file @returns {Buffer | null} */
function lesenOderNull(root, file) {
    const full = path.join(root, file);
    return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

/** Startet ein Skript der Projektwurzel in einem frischen Prozess (frischer Modul-Cache). */
function skript(root, args) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`${args.join(' ')} scheiterte (Exit ${result.status}): ${(result.stderr || result.stdout).trim()}`);
    return result.stdout;
}

/**
 * Erzeugt alle Artefakte in einem Staging-Ordner (Wegwerfkopie) und prüft sie dort.
 * @returns {Promise<Map<string, {alt: Buffer | null, neu: Buffer}>>} geänderte Dateien.
 */
async function staging(root, jahr, revision, bericht) {
    const kopie = wegwerfkopieAnlegen(root, 'jahresdaten-staging-');
    try {
        const kettenDateien = new Map();
        for (const modul of KETTEN) {
            const gelesen = /** @type {any} */ (lieferungLesen(root, modul.KETTE, jahr));
            const neu = zeileAnhaengen(modul, modul.lesen(root), gelesen.lieferung, gelesen.sha256);
            for (const [file, text] of modul.schreiben(neu)) kettenDateien.set(file, text);
        }
        for (const [file, text] of kettenDateien) fs.writeFileSync(path.join(kopie, file), text);
        skript(kopie, ['scripts/historical-data-generate.mjs', '--endjahr', String(jahr), '--revision', revision]);
        skript(kopie, ['scripts/jahresdaten-sollwerte.mjs']);
        groessenlisteNachziehen(kopie, [...kettenDateien.keys()]);
        berichtSchreiben(kopie, bericht);
        skript(kopie, ['scripts/historical-data-generate.mjs', '--verify-only']);
        skript(kopie, ['scripts/jahresdaten-sollwerte.mjs', '--pruefen']);
        const stand = await datenstandLesen(kopie);
        if (stand.endYear !== jahr || stand.revision !== revision) throw new Error(`Staging: Datenstand ${stand.endYear}/${stand.revision} statt ${jahr}/${revision}`);
        for (const modul of KETTEN) {
            if (modul.endjahr(modul.lesen(kopie)) !== jahr) throw new Error(`Staging: ${modul.KETTE.label} endet nicht ${jahr}`);
        }
        const pfade = berichtPfade(jahr);
        const kandidaten = [...kettenDateien.keys(), ...GENERATOR_DATEIEN, ...SOLLWERT_DATEIEN, GROESSENLISTE, pfade.md, pfade.json];
        const ziele = new Map();
        for (const file of kandidaten) {
            const alt = lesenOderNull(root, file);
            const neu = lesenOderNull(kopie, file);
            if (neu === null) throw new Error(`Staging: ${file} fehlt`);
            if (!(alt && alt.equals(neu))) ziele.set(file, { alt, neu });
        }
        return ziele;
    } finally {
        wegwerfkopieEntfernen(kopie);
    }
}

/**
 * Übernimmt ein Jahr: Prüfung, Staging, Journal, Umschalten. Ein offenes Journal eines früheren Laufs wird zuerst
 * abgeschlossen. Setzt es die abgebrochene Übernahme desselben Jahres vollständig fort, ist die Übernahme damit
 * abgeschlossen (`fortgesetzt`, mit den tatsächlich geschriebenen Dateien). `schreibe` ist nur für Tests austauschbar.
 * @param {string} root Projektwurzel. @param {number} jahr Datenjahr Y.
 * @param {{schreibe?: (full: string, inhalt: Buffer | null) => void}} [options]
 * @returns {Promise<{uebernommen: boolean, fortgesetzt?: boolean, bericht: any, geschrieben: string[], revision?: string,
 *   wiederanlauf: ReturnType<typeof journalAbschliessen>}>}
 */
export async function uebernehmen(root, jahr, { schreibe = atomarSchreiben, belegBestaetigt = [] } = {}) {
    const wiederanlauf = journalAbschliessen(root);
    if (wiederanlauf?.richtung === 'vor' && wiederanlauf.jahr === jahr) {
        return { uebernommen: true, fortgesetzt: true, bericht: null, geschrieben: wiederanlauf.geschrieben, revision: wiederanlauf.revision, wiederanlauf };
    }
    const bericht = await pruefen(root, jahr, { belegBestaetigt });
    if (bericht.ergebnis === 'rot') return { uebernommen: false, bericht, geschrieben: [], wiederanlauf };
    const datenstand = await datenstandLesen(root);
    const revision = naechsteRevision(datenstand.revision, jahr);
    const ziele = await staging(root, jahr, revision, bericht);
    let journal = journalAnlegen(root, { jahr, revision, ziele: [...ziele].map(([datei, { alt, neu }]) => ({ datei, alt, neu })) });
    try {
        zieleSchreiben(root, journal, 'vor', schreibe);
    } catch (fehler) {
        try {
            journal = richtungSetzen(root, journal, 'zurueck', schreibe);
            zieleSchreiben(root, journal, 'zurueck', schreibe);
            zieleBestaetigen(root, journal, 'zurueck');
            journalEntfernen(root);
        } catch (ruecknahme) {
            throw new Error(`Umschalten abgebrochen (${fehler.message}); Rücknahme ebenfalls gescheitert (${ruecknahme.message}). `
                + `Offenes Journal ${JOURNAL_ORDNER}/journal.json: Der nächste Aufruf schließt es vollständig ab.`);
        }
        throw new Error(`Umschalten abgebrochen (${fehler.message}); alle ${ziele.size} Dateien sind zurückgesetzt, nichts ist übernommen.`);
    }
    // Kein Abbau ohne Beleg: Jedes Ziel muss den neuen SHA-256 tragen, sonst bleibt das Journal offen (rot).
    zieleBestaetigen(root, journal, 'vor');
    journalEntfernen(root);
    return { uebernommen: true, bericht, geschrieben: [...ziele.keys()], revision, wiederanlauf };
}
