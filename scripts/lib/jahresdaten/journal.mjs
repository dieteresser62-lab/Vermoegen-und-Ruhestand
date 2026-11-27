/**
 * Umschaltjournal der Übernahme (JD-2a, Nachtrag 2, Befund 1): ein Jahr ganz oder gar nicht, auch bei anhaltendem
 * Schreibfehler.
 *
 * Vor dem Umschalten liegen unter `.jahresdaten-uebernahme/` dauerhaft: `journal.json` (Jahr, Revision, Richtung,
 * Ziele mit altem und neuem SHA-256) sowie die alten und neuen Inhalte jedes Ziels. Umgeschaltet wird je Datei atomar
 * (temporäre Datei, dann Umbenennen). Scheitert das Umschalten, versucht die Übernahme sofort die Rücknahme
 * (Richtung „zurueck“). Bleibt das Journal offen, schließt der nächste Aufruf es ab: Richtung „vor“ setzt vollständig
 * fort, Richtung „zurueck“ setzt vollständig zurück. Ein Mischstand bleibt nie ohne offenes Journal und Meldung.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './kanonisch.mjs';

export const JOURNAL_ORDNER = '.jahresdaten-uebernahme';
const JOURNAL = 'journal.json';

/**
 * Schreibt einen Buffer vollständig: Ein verkürzter Schreibzugriff wird mit den Restbytes fortgesetzt, ein Zugriff ohne
 * Fortschritt ist ein Fehler.
 * @param {number} fd @param {Buffer | string} inhalt @param {typeof fs.writeSync} [writeSync]
 */
export function vollstaendigSchreiben(fd, inhalt, writeSync = fs.writeSync) {
    const buffer = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt, 'utf8');
    let geschrieben = 0;
    while (geschrieben < buffer.length) {
        const anzahl = writeSync(fd, buffer, geschrieben, buffer.length - geschrieben);
        if (!Number.isInteger(anzahl) || anzahl <= 0) throw new Error(`Schreibzugriff ohne Fortschritt nach ${geschrieben} von ${buffer.length} Bytes`);
        geschrieben += anzahl;
    }
}

/** Dauerhaft schreiben: Inhalt vollständig, dann fsync. */
function dauerhaft(full, inhalt, writeSync = fs.writeSync) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const fd = fs.openSync(full, 'w');
    try {
        vollstaendigSchreiben(fd, inhalt, writeSync);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Schreibweg für Ziele: neue Datei vollständig daneben, dann Umbenennen; `null` entfernt das Ziel. Scheitert das
 * Schreiben, bleibt keine halbe Nebendatei liegen. `writeSync` ist nur für Tests austauschbar.
 * @param {{writeSync?: typeof fs.writeSync}} [options] @returns {(full: string, inhalt: Buffer | null) => void}
 */
export function atomarSchreibenMit({ writeSync = fs.writeSync } = {}) {
    return (full, inhalt) => {
        if (inhalt === null) {
            fs.rmSync(full, { force: true });
            return;
        }
        const neu = `${full}.jahresdaten-neu`;
        try {
            dauerhaft(neu, inhalt, writeSync);
            fs.renameSync(neu, full);
        } finally {
            fs.rmSync(neu, { force: true });
        }
    };
}

/** Schreibt ein Ziel atomar mit dem echten Dateisystem. */
export const atomarSchreiben = atomarSchreibenMit();

const journalPfad = root => path.join(root, JOURNAL_ORDNER, JOURNAL);
const inhaltPfad = (root, art, datei) => path.join(root, JOURNAL_ORDNER, art, datei);

/** @param {string} root @returns {boolean} */
export function journalOffen(root) {
    return fs.existsSync(journalPfad(root));
}

/** @param {string} root @returns {any} */
export function journalLesen(root) {
    return JSON.parse(fs.readFileSync(journalPfad(root), 'utf8'));
}

/**
 * Legt das Journal an: alte und neue Inhalte, dann journal.json mit Richtung „vor“.
 * @param {string} root
 * @param {{jahr: number, revision: string, ziele: {datei: string, alt: Buffer | null, neu: Buffer}[]}} input
 */
export function journalAnlegen(root, { jahr, revision, ziele }) {
    if (journalOffen(root)) throw new Error(`Offenes Übernahme-Journal unter ${JOURNAL_ORDNER}/; zuerst abschließen.`);
    for (const { datei, alt, neu } of ziele) {
        dauerhaft(inhaltPfad(root, 'neu', datei), neu);
        if (alt !== null) dauerhaft(inhaltPfad(root, 'alt', datei), alt);
    }
    const journal = { jahr, revision, richtung: 'vor', ziele: ziele.map(({ datei, alt, neu }) => ({
        datei, altSha256: alt === null ? null : sha256(alt), neuSha256: sha256(neu)
    })) };
    dauerhaft(journalPfad(root), `${JSON.stringify(journal, null, 2)}\n`);
    return journal;
}

/** Inhalt eines Ziels aus dem Journal; prüft den SHA-256. */
function gespeicherterInhalt(root, ziel, art) {
    const soll = art === 'neu' ? ziel.neuSha256 : ziel.altSha256;
    if (soll === null) return null;
    const full = inhaltPfad(root, art, ziel.datei);
    const inhalt = fs.existsSync(full) ? fs.readFileSync(full) : undefined;
    if (inhalt === undefined || sha256(inhalt) !== soll) throw new Error(`Journal: ${art} Inhalt von ${ziel.datei} fehlt oder passt nicht zum SHA-256`);
    return inhalt;
}

/**
 * Bringt alle Ziele in die Richtung des Journals.
 * @param {string} root @param {any} journal @param {'vor' | 'zurueck'} richtung
 * @param {(full: string, inhalt: Buffer | null) => void} schreibe
 * @returns {string[]} geschriebene Ziele.
 */
export function zieleSchreiben(root, journal, richtung, schreibe) {
    const geschrieben = [];
    for (const ziel of journal.ziele) {
        const soll = richtung === 'vor' ? ziel.neuSha256 : ziel.altSha256;
        const full = path.join(root, ziel.datei);
        const ist = fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null;
        if (ist === soll) continue;
        schreibe(full, gespeicherterInhalt(root, ziel, richtung === 'vor' ? 'neu' : 'alt'));
        geschrieben.push(ziel.datei);
    }
    return geschrieben;
}

/**
 * Prüft vor dem Abbau des Journals jedes Ziel gegen die Richtung (vorwärts neuer, zurück alter SHA-256).
 * Weicht eines ab, bleibt das Journal stehen und die Meldung ist rot.
 * @param {string} root @param {any} journal @param {'vor' | 'zurueck'} richtung
 */
export function zieleBestaetigen(root, journal, richtung) {
    const abweichend = journal.ziele.filter(ziel => {
        const full = path.join(root, ziel.datei);
        const ist = fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null;
        return ist !== (richtung === 'vor' ? ziel.neuSha256 : ziel.altSha256);
    }).map(ziel => ziel.datei);
    if (abweichend.length) {
        throw new Error(`Zielprüfung vor dem Abbau des Journals: ${abweichend.length} Datei(en) weichen vom ${richtung === 'vor' ? 'neuen' : 'alten'} SHA-256 ab `
            + `(${abweichend.join(', ')}); ${JOURNAL_ORDNER}/ bleibt offen, der nächste Aufruf schließt es ab.`);
    }
}

/** Setzt die Richtung im Journal (Rücknahme beginnt). */
export function richtungSetzen(root, journal, richtung, schreibe) {
    const neu = { ...journal, richtung };
    schreibe(journalPfad(root), Buffer.from(`${JSON.stringify(neu, null, 2)}\n`, 'utf8'));
    return neu;
}

/** Entfernt Journal und Inhalte. */
export function journalEntfernen(root) {
    fs.rmSync(path.join(root, JOURNAL_ORDNER), { recursive: true, force: true });
}

/**
 * Wiederanlauf: Ein offenes Journal wird vollständig in seine Richtung abgeschlossen, alle Zielhashes werden geprüft,
 * erst dann wird es entfernt.
 * @param {string} root @param {{schreibe?: (full: string, inhalt: Buffer | null) => void}} [options]
 * @returns {null | {jahr: number, revision: string, richtung: 'vor' | 'zurueck', geschrieben: string[], ziele: number, meldung: string}}
 *   abgeschlossener Vorgang, wenn ein Journal offen war.
 */
export function journalAbschliessen(root, { schreibe = atomarSchreiben } = {}) {
    if (!journalOffen(root)) return null;
    const journal = journalLesen(root);
    let richtung = journal.richtung === 'zurueck' ? 'zurueck' : 'vor';
    try {
        for (const ziel of journal.ziele) gespeicherterInhalt(root, ziel, richtung === 'vor' ? 'neu' : 'alt');
    } catch (error) {
        if (richtung !== 'vor') throw new Error(`${error.message}; Journal ${JOURNAL_ORDNER}/ bleibt offen.`);
        richtung = 'zurueck';
    }
    try {
        const geschrieben = zieleSchreiben(root, journal, richtung, schreibe);
        zieleBestaetigen(root, journal, richtung);
        journalEntfernen(root);
        return {
            jahr: journal.jahr, revision: journal.revision, richtung, geschrieben, ziele: journal.ziele.length,
            meldung: `Offenes Übernahme-Journal für ${journal.jahr} (Revision ${journal.revision}) abgeschlossen: `
                + `${richtung === 'vor' ? 'vollständig fortgesetzt' : 'vollständig zurückgesetzt'}, ${geschrieben.length} von ${journal.ziele.length} Dateien geschrieben.`
        };
    } catch (error) {
        throw new Error(`Offenes Übernahme-Journal für ${journal.jahr} ließ sich nicht abschließen (${error.message}); `
            + `${JOURNAL_ORDNER}/ bleibt offen, der Stand ist gemischt. Nächster Aufruf versucht es erneut.`);
    }
}
