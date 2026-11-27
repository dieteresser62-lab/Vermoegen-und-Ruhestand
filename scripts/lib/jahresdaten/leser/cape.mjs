/**
 * Leser CAPE: Link auf ie_data.xls von shillerdata.com lesen (wie app/shared/shiller-cape.js, aber ohne
 * Umweg über r.jina.ai), die Arbeitsmappe laden und CAPE Dezember Y−1 (Wert) und Dezember Y−2 (Anschluss) lesen.
 * Die Shiller-Datei hat keine offene Lizenz: Ins Repo kommen nur der Auszug der zwei Zeilen und der SHA-256 der Datei.
 */
import { KETTE, lesen } from '../ketten/cape.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { sha256 } from '../kanonisch.mjs';
import { readBiff8Sheet } from '../../biff8-numeric-sheet.mjs';
import { datumAus, OffenFehler, standAus } from './gemeinsam.mjs';

export const SEITE = 'https://shillerdata.com/';

export function quellen() {
    return { seite: SEITE };
}

/** Endgültig sofort (Ideengespräch), aber nur, wenn die Mappe über Dezember Y−1 hinausreicht: Den jüngsten Monat überarbeitet Shiller noch. */
export const ENDGUELTIG_AB = null;
export const STATUSREGEL = 'endgültig, sobald die Shiller-Mappe mindestens einen Monat nach Dezember Y−1 enthält; ist Dezember Y−1 der jüngste Monat, vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: ['https://shillerdata.com/, Datei „U.S. Stock Markets 1871-Present and CAPE Ratio“ (ie_data.xls), Blatt „Data“'],
    zahlen: 'Spalte „CAPE“ in den Zeilen Dezember Y−1 (Datum Y−1.12) und Dezember Y−2 mit allen Nachkommastellen.',
    beleg: 'Nur einen Auszug mit den zwei Zeilen (Date,CAPE) als CSV speichern und den SHA-256 der Originaldatei eintragen; die Datei selbst nicht ins Repo legen.'
});

/**
 * Link auf ie_data.xls aus der Seite von shillerdata.com (Dateispeicher img1.wsimg.com).
 * @param {string} html @returns {string}
 */
export function dateiLink(html) {
    for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
        let url;
        try {
            url = new URL(match[1].replace(/&amp;/g, '&'), SEITE);
        } catch {
            continue;
        }
        if (url.protocol === 'https:' && url.hostname === 'img1.wsimg.com' && /\/ie_data\.xls$/i.test(url.pathname)) return url.href;
    }
    throw new OffenFehler('shillerdata.com verlinkt keine ie_data.xls');
}

/** @param {number} rawDate */
function monat(rawDate) {
    if (!Number.isFinite(rawDate)) return null;
    const year = Math.floor(rawDate + 1e-8);
    const month = Math.round((rawDate - year) * 100);
    return month >= 1 && month <= 12 ? { year, month } : null;
}

/**
 * CAPE Dezember Y−1 und Y−2 aus den gelesenen Zellen des Blatts Data; Zeile und Spalten wie im Kettenvertrag (`method`).
 * @param {{cells: Map<number, Map<number, number>>, textCells: Map<number, Map<number, string>>}} blatt @param {number} jahr
 * @param {{sourceHeaderRowZeroBased: number, sourceDateColumnZeroBased: number, sourceCapeColumnZeroBased: number}} methode
 */
export function capeLesen({ cells, textCells }, jahr, methode) {
    const DATUM_SPALTE = methode.sourceDateColumnZeroBased, CAPE_SPALTE = methode.sourceCapeColumnZeroBased;
    const kopf = textCells.get(methode.sourceHeaderRowZeroBased);
    if (kopf?.get(DATUM_SPALTE) !== 'Date' || kopf?.get(CAPE_SPALTE) !== 'CAPE') {
        throw new OffenFehler('Shiller-Arbeitsmappe: Spalten Date und CAPE stehen nicht an der bekannten Stelle');
    }
    const dezember = new Map();
    let letzter = null;
    for (const row of cells.values()) {
        const rawDate = row.get(DATUM_SPALTE);
        const periode = monat(rawDate);
        const cape = row.get(CAPE_SPALTE);
        if (!periode || !Number.isFinite(cape)) continue;
        if (!letzter || rawDate > letzter.rawDate) letzter = { rawDate, ...periode };
        if (periode.month === 12) dezember.set(periode.year, { rawDate, cape });
    }
    const fehlt = [jahr - 2, jahr - 1].filter(y => !dezember.has(y));
    if (fehlt.length) throw new OffenFehler(`Shiller-Arbeitsmappe: CAPE Dezember ${fehlt.join(', ')} fehlt`);
    const wert = dezember.get(jahr - 1), vorjahr = dezember.get(jahr - 2);
    return {
        wert: wert.cape, vorjahr: vorjahr.cape,
        bis: letzter ? `${letzter.year}-${String(letzter.month).padStart(2, '0')}` : '',
        juengsterMonat: letzter?.rawDate === wert.rawDate,
        auszug: `Date,CAPE\n${vorjahr.rawDate},${vorjahr.cape}\n${wert.rawDate},${wert.cape}\n`
    };
}

/**
 * Jüngster Monat der Mappe mit CAPE-Wert (JJJJ-MM), für `--quellen`; prüft Kopfzeile und Spalten wie capeLesen.
 * @param {{cells: Map<number, Map<number, number>>, textCells: Map<number, Map<number, string>>}} blatt @param {any} methode
 */
export function capeStand({ cells, textCells }, methode) {
    const kopf = textCells.get(methode.sourceHeaderRowZeroBased);
    if (kopf?.get(methode.sourceDateColumnZeroBased) !== 'Date' || kopf?.get(methode.sourceCapeColumnZeroBased) !== 'CAPE') {
        throw new OffenFehler('Shiller-Arbeitsmappe: Spalten Date und CAPE stehen nicht an der bekannten Stelle');
    }
    let letzter = null;
    for (const row of cells.values()) {
        const rawDate = row.get(methode.sourceDateColumnZeroBased);
        const periode = monat(rawDate);
        if (periode && Number.isFinite(row.get(methode.sourceCapeColumnZeroBased)) && (!letzter || rawDate > letzter.rawDate)) letzter = { rawDate, ...periode };
    }
    if (!letzter) throw new OffenFehler('Shiller-Arbeitsmappe ohne CAPE-Werte');
    return `${letzter.year}-${String(letzter.month).padStart(2, '0')}`;
}

/**
 * @param {{root: string, jahr: number, abrufen: import('./netz.mjs').Abruf, blattLesen?: (bytes: Buffer, blatt: string) => any}} input
 */
export async function holen({ root, jahr, abrufen, blattLesen = readBiff8Sheet }) {
    const methode = lesen(root).method;
    const seite = await abrufen(SEITE);
    const link = dateiLink(seite.text());
    const datei = await abrufen(link);
    let blatt;
    try {
        blatt = blattLesen(datei.bytes, methode.sourceSheet);
    } catch (error) {
        throw new OffenFehler(`Shiller-Arbeitsmappe nicht lesbar (${error.message})`);
    }
    const cape = capeLesen(blatt, jahr, methode);
    const werte = { cape: cape.wert };
    const hinweise = cape.juengsterMonat ? [`Vorläufig: Dezember ${jahr - 1} ist der jüngste Monat der Mappe.`] : [];
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            anschluss: { jahr: jahr - 1, werte: { cape: cape.vorjahr } },
            quelle: {
                name: 'Robert J. Shiller, U.S. Stock Markets 1871-Present and CAPE Ratio (ie_data.xls), Blatt Data, Spalte CAPE',
                url: SEITE,
                abrufdatum: datumAus(datei.abgerufen),
                veroeffentlichungsstand: `Daten bis ${cape.bis}, ${standAus(datei, { datei: true })}`
            },
            methode: 'abgerufen: Dezemberwert des Vorjahres aus der aktuellen Shiller-Arbeitsmappe; nur Auszug, keine Originaldatei',
            lieferant: 'skript',
            status: hinweise.length ? 'vorlaeufig' : 'endgueltig',
            hinweis: [`Datei: ${link}`, ...hinweise].join(' '),
            rohdateien: [{ datei: 'rohauszug-shiller-cape.csv', inhalt: Buffer.from(cape.auszug, 'utf8'), art: 'auszug', originalDatei: link, originalSha256: sha256(datei.bytes) }]
        })
    };
}
