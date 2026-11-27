/**
 * Hilfen für die Jahresdaten-Leser: CSV lesen, runden, offene Lieferung melden.
 */

/** Wert noch nicht veröffentlicht oder Antwort nicht lesbar: Der Leser legt eine offene Lieferung an. */
export class OffenFehler extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'OffenFehler';
    }
}

/** @param {string} line @param {string} trenner @returns {string[]} */
function felder(line, trenner) {
    const values = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted;
        } else if (character === trenner && !quoted) {
            values.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    values.push(current);
    return values;
}

/**
 * CSV mit Kopfzeile als Liste von Objekten; doppelte Spaltennamen behalten den ersten Treffer.
 * @param {string} text @param {string} [trenner] @returns {Record<string, string>[]}
 */
export function csvZeilen(text, trenner = ',') {
    const [kopf, ...zeilen] = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
    if (!kopf) return [];
    const spalten = felder(kopf, trenner);
    return zeilen.map(zeile => {
        const werte = felder(zeile, trenner);
        const objekt = {};
        spalten.forEach((name, index) => { if (!(name in objekt)) objekt[name] = werte[index] ?? ''; });
        return objekt;
    });
}

/**
 * Kaufmännisch runden (halbe Stelle von null weg), ohne −0.
 * @param {number} wert @param {number} stellen
 */
export function kaufmaennischRunden(wert, stellen) {
    const faktor = 10 ** stellen;
    const skaliert = Math.abs(wert) * faktor;
    const gerundet = Math.sign(wert) * Math.round(Number(skaliert.toPrecision(12))) / faktor;
    return Object.is(gerundet, -0) ? 0 : gerundet;
}

/** @param {string} iso Zeitstempel @returns {string} Datum JJJJ-MM-TT */
export function datumAus(iso) {
    return String(iso).slice(0, 10);
}

/**
 * Stand einer Antwort für `veroeffentlichungsstand`. Schnittstellen liefern den Stand beim Abruf; nur bei Dateien
 * (Arbeitsmappen) ist das Änderungsdatum des Servers aussagekräftig.
 * @param {import('./netz.mjs').Antwort} antwort @param {{datei?: boolean}} [optionen]
 */
export function standAus(antwort, { datei = false } = {}) {
    const geaendert = datei ? antwort.kopf?.['last-modified'] : '';
    return geaendert ? `Datei vom ${new Date(geaendert).toISOString().slice(0, 10)}` : `Stand beim Abruf am ${datumAus(antwort.abgerufen)}`;
}

/** „Stand 10. März 2026“ einer Destatis-Seite, sonst leer. @param {string} html */
export function destatisStand(html) {
    const match = html.match(/Stand(?:&nbsp;|\s)+(\d{1,2}\.(?:&nbsp;|\s)*[A-Za-zäöüÄÖÜ]+(?:&nbsp;|\s)+\d{4})/);
    return match ? `Stand ${match[1].replace(/&nbsp;/g, ' ')}` : '';
}

/**
 * Zahl aus einer Zelle oder einem CSV-Feld, streng: leere, nur aus Leerraum bestehende oder nicht numerische Werte
 * ergeben null, nie 0. `komma` erlaubt das deutsche Dezimalkomma (Destatis).
 * @param {unknown} text @param {{komma?: boolean}} [optionen] @returns {number | null}
 */
export function strengeZahl(text, { komma = false } = {}) {
    if (typeof text !== 'string' && typeof text !== 'number') return null;
    const roh = String(text).trim();
    const muster = komma ? /^-?\d+(,\d+)?$/ : /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
    if (!muster.test(roh)) return null;
    const wert = Number(komma ? roh.replace(',', '.') : roh);
    return Number.isFinite(wert) ? wert : null;
}

/**
 * Genau ein Treffer, sonst OffenFehler (fehlt oder doppelt).
 * @template T @param {T[]} treffer @param {string} was @returns {T}
 */
export function genauEiner(treffer, was) {
    if (treffer.length > 1) throw new OffenFehler(`${was} kommt ${treffer.length}-mal vor`);
    return treffer[0];
}

/**
 * Frist „endgültig ab“ (Ideengespräch, Tabelle „Quellen je Kette“): Ein Abruf vor dem Stichtag im Folgejahr gilt als vorläufig.
 * @param {string} abgerufen Zeitstempel @param {number} jahr Datenjahr @param {string | null} monatTag MM-TT oder null (keine Frist)
 */
export function vorFrist(abgerufen, jahr, monatTag) {
    return monatTag !== null && datumAus(abgerufen) < `${jahr + 1}-${monatTag}`;
}
