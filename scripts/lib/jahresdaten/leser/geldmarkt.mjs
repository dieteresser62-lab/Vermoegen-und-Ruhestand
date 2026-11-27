/**
 * Leser Geldmarkt: €STR-Tageswerte der EZB für Y−1 und Y. Jahresmittel = einfaches Mittel aller Veröffentlichungstage,
 * kaufmännisch auf zwei Stellen gerundet (Methodenwechsel ab JD-2b, siehe README der Kette).
 * Gegenprüfung: Mittel der zwölf Bundesbank-Monatsdurchschnitte BBMMB (Feld `monatsmittel`, vier Stellen).
 */
import { KETTE } from '../ketten/geldmarkt.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { csvZeilen, datumAus, kaufmaennischRunden, OffenFehler, standAus, strengeZahl } from './gemeinsam.mjs';
import { AbrufFehler } from './netz.mjs';

/** Ein volles TARGET-Jahr hat rund 255 Geschäftstage; deutlich weniger heißt, dass Tage fehlen. */
const MINDEST_TAGE = 250;

/**
 * Letzter TARGET-Geschäftstag eines Jahres: der 31.12., an einem Wochenende der Freitag davor.
 * Der 31.12. ist kein TARGET-Feiertag; sein €STR-Wert erscheint am ersten Geschäftstag des Folgejahres.
 * @param {number} jahr @returns {string} JJJJ-MM-TT
 */
export function letzterTargetTag(jahr) {
    const silvester = new Date(Date.UTC(jahr, 11, 31));
    const zurueck = { 0: 2, 6: 1 }[silvester.getUTCDay()] ?? 0;
    return new Date(silvester.getTime() - zurueck * 86_400_000).toISOString().slice(0, 10);
}

/** @param {number} jahr */
export function quellen(jahr) {
    return {
        estr: `https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?startPeriod=${jahr - 1}-01-01&endPeriod=${jahr}-12-31&format=csvdata`,
        bbmmb: `https://api.statistiken.bundesbank.de/rest/data/BBMMB/M.EU000A2X2A25.WT?startPeriod=${jahr}-01&endPeriod=${jahr}-12&format=sdmx_csv&lang=de`
    };
}

/** Statusregel für Lieferung, Vorlage und Kapitel. */
export const STATUSREGEL = 'endgültig, wenn die €STR-Tageswerte bis zum letzten TARGET-Geschäftstag des Jahres (meist 31.12., veröffentlicht am ersten Geschäftstag des Folgejahres) und mindestens 250 Tage vorliegen, für Y und Y−1; sonst vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: ['EZB Data Portal, Reihe EST.B.EU000A2X2A25.WT (Euro short-term rate, Tageswerte)'],
    zahlen: 'Alle Tageswerte von Y und Y−1; je Jahr das einfache Mittel, kaufmännisch auf zwei Stellen gerundet (Prozent p. a.).',
    beleg: 'Die CSV-Antwort der EZB-Schnittstelle (format=csvdata) unverändert speichern.'
});

/**
 * Tageswerte je Jahr und gerundetes Mittel. Ein Jahr ohne seinen letzten TARGET-Geschäftstag oder mit weniger als
 * 250 Tagen ist unvollständig: Das Mittel wird gerechnet, die Lieferung ist aber vorläufig (Prüfung rot).
 * Leere oder nicht numerische Werte und doppelte Tage sind ein Leserfehler.
 * @param {string} text @param {number} jahr
 */
export function estrLesen(text, jahr) {
    const zeilen = csvZeilen(text).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.TIME_PERIOD));
    const jahrFuer = y => {
        const tage = zeilen.filter(row => row.TIME_PERIOD.startsWith(`${y}-`)).sort((a, b) => a.TIME_PERIOD.localeCompare(b.TIME_PERIOD));
        if (!tage.length) throw new OffenFehler(`EZB liefert keine €STR-Tageswerte für ${y}`);
        const doppelt = tage.find((row, index) => index > 0 && row.TIME_PERIOD === tage[index - 1].TIME_PERIOD);
        if (doppelt) throw new OffenFehler(`€STR-Tageswert ${doppelt.TIME_PERIOD} kommt mehrfach vor`);
        const werte = tage.map(row => strengeZahl(row.OBS_VALUE));
        const unlesbar = tage.find((_, index) => werte[index] === null);
        if (unlesbar) throw new OffenFehler(`€STR-Tageswert ${unlesbar.TIME_PERIOD} ist leer oder nicht numerisch`);
        const letzter = tage.at(-1).TIME_PERIOD;
        const luecken = [];
        if (letzter < letzterTargetTag(y)) luecken.push(`Tageswerte reichen erst bis ${letzter}, es fehlt der letzte TARGET-Geschäftstag ${letzterTargetTag(y)}`);
        if (tage.length < MINDEST_TAGE) luecken.push(`nur ${tage.length} Tageswerte (mindestens ${MINDEST_TAGE})`);
        // Summe in Tausendsteln, damit die Gleitkommasumme das Runden an der halben Stelle nicht verschiebt.
        const tausendstel = werte.reduce((summe, value) => summe + Math.round(value * 1000), 0);
        return { mittel: kaufmaennischRunden(tausendstel / werte.length / 1000, 2), ungerundet: tausendstel / werte.length / 1000, tage: tage.length,
            vorlaeufig: luecken.length > 0 || tage.some(row => row.OBS_STATUS !== 'A'), luecken, von: tage[0].TIME_PERIOD, bis: letzter };
    };
    return { jahr: jahrFuer(jahr), vorjahr: jahrFuer(jahr - 1) };
}

/** @param {string} text @param {number} jahr @returns {{anzahl: number, mittel: number}} */
export function monatsmittelLesen(text, jahr) {
    const monate = csvZeilen(text, ';').filter(row => new RegExp(`^${jahr}-(0[1-9]|1[0-2])$`).test(row.TIME_PERIOD) && strengeZahl(row.OBS_VALUE) !== null);
    const mittel = monate.length ? monate.reduce((summe, row) => summe + strengeZahl(row.OBS_VALUE), 0) / monate.length : NaN;
    return { anzahl: monate.length, mittel: kaufmaennischRunden(mittel, 4) };
}

/**
 * @param {{jahr: number, abrufen: import('./netz.mjs').Abruf}} input
 */
export async function holen({ jahr, abrufen }) {
    const urls = quellen(jahr);
    const estrAntwort = await abrufen(urls.estr);
    const estr = estrLesen(estrAntwort.text(), jahr);
    const hinweise = [`€STR ${jahr}: ${estr.jahr.tage} Tageswerte ${estr.jahr.von} bis ${estr.jahr.bis}, Mittel ungerundet ${estr.jahr.ungerundet.toFixed(4)}.`,
        ...[[jahr, estr.jahr], [jahr - 1, estr.vorjahr]].flatMap(([y, teil]) => teil.luecken.map(text => `Vorläufig, €STR ${y}: ${text}.`))];
    const werte = { jahresmittel: estr.jahr.mittel };
    let bbmmbAntwort = null;
    try {
        bbmmbAntwort = await abrufen(urls.bbmmb);
        const monate = monatsmittelLesen(bbmmbAntwort.text(), jahr);
        if (monate.anzahl === 12) werte.monatsmittel = monate.mittel;
        else hinweise.push(`Bundesbank BBMMB ${jahr}: nur ${monate.anzahl} Monatswerte; keine Gegenprüfung.`);
    } catch (error) {
        if (!(error instanceof AbrufFehler)) throw error;
        bbmmbAntwort = null;
        hinweise.push(`Gegenprüfung Bundesbank BBMMB nicht möglich (${error.message}).`);
    }
    const rohdateien = [{ datei: 'antwort-ezb-estr.csv', inhalt: estrAntwort.bytes, art: 'antwort' }];
    if (bbmmbAntwort) rohdateien.push({ datei: 'antwort-bundesbank-bbmmb.csv', inhalt: bbmmbAntwort.bytes, art: 'antwort' });
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            anschluss: { jahr: jahr - 1, werte: { jahresmittel: estr.vorjahr.mittel } },
            quelle: {
                name: 'EZB, Euro short-term rate (€STR), Tageswerte; Gegenprüfung Bundesbank BBMMB Monatsdurchschnitte',
                url: urls.estr,
                abrufdatum: datumAus(estrAntwort.abgerufen),
                veroeffentlichungsstand: `EZB ${standAus(estrAntwort)}, Tageswerte bis ${estr.jahr.bis}`
            },
            methode: 'Mittel der €STR-Tageswerte: einfaches Mittel aller Veröffentlichungstage des Jahres, kaufmännisch auf zwei Stellen gerundet',
            lieferant: 'skript',
            status: estr.jahr.vorlaeufig || estr.vorjahr.vorlaeufig ? 'vorlaeufig' : 'endgueltig',
            hinweis: hinweise.join(' '),
            rohdateien
        })
    };
}
