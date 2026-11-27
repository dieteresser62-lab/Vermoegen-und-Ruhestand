/**
 * Werte gegen Beleg (JD-2c): `--pruefen` liest die Rohdateien einer Lieferung mit dem Leser der Kette neu und vergleicht
 * jedes Feld von `werte` und `anschluss.werte` mit lieferung.json, mit der Anschlusstoleranz der Kette.
 *
 * Erkannt werden die Belege des Skripts (`--holen`, Antworten und Auszüge) und die Auszüge aus den festgeschriebenen
 * Originalen (Rückwärtsprobe). Eine Hand- oder Agentenlieferung besteht die Prüfung, wenn ihr Beleg eines dieser Formate
 * hat, etwa die ganze Destatis-Seite. Passt der Beleg zu keinem Leser, wirft belegWerte einen BelegFehler; die Prüfung
 * ist dann rot, außer die Kette ist mit `--beleg-bestaetigt <kette>` von Hand bestätigt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { lieferungsOrdner } from './lieferung.mjs';
import { strengeZahl } from './leser/gemeinsam.mjs';
import { kurseLesen, oecdLesen } from './leser/aktien.mjs';
import { vpiLesen } from './leser/inflation.mjs';
import { DESTATIS_LEVEL_TABLE, DESTATIS_RATE_TABLE } from './ketten/inflation.mjs';
import { estrLesen, monatsmittelLesen } from './leser/geldmarkt.mjs';
import { verdiensteLesen, verdiensteZeilen } from './leser/lohn.mjs';
import { kursLesen } from './leser/gold.mjs';

/** Beleg passt zu keinem Leser der Kette. */
export class BelegFehler extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'BelegFehler';
    }
}

/** Toleranz für Felder ohne Anschlusstoleranz (Geldmarkt-Monatsmittel mit vier Stellen): halbe vierte Stelle. */
const STANDARD_TOLERANZ = 0.00005;

/** Erste vorhandene Datei aus `namen` als Text, sonst null. @param {Map<string, Buffer>} dateien @param {string[]} namen */
function text(dateien, ...namen) {
    const name = namen.find(item => dateien.has(item));
    return name ? { name, inhalt: dateien.get(name).toString('utf8') } : null;
}

const muss = (wert, was) => {
    if (wert === null || wert === undefined || (typeof wert === 'number' && !Number.isFinite(wert))) throw new BelegFehler(`Beleg ohne lesbaren Wert für ${was}`);
    return wert;
};

/** Je Kette: Werte für Y und Y−1 aus den Belegdateien. */
const LESER = {
    'global-equity-research-chain': (dateien, jahr) => {
        const oecd = text(dateien, 'antwort-oecd.csv', 'rohauszug-oecd.csv');
        const ezb = text(dateien, 'antwort-ezb-exr.csv', 'rohauszug-ezb.csv');
        const bbk = text(dateien, 'antwort-bundesbank-bbex3.csv');
        if (!oecd || !(ezb || bbk)) throw new BelegFehler('kein OECD- und Kursbeleg im Format der Leser');
        const aktien = oecdLesen(oecd.inhalt, jahr);
        const kurse = ezb ? kurseLesen(ezb.inhalt, jahr, 'ezb') : kurseLesen(bbk.inhalt, jahr, 'bundesbank');
        return { werte: { oecdDezember: aktien.jahr, ezbDezember: kurse.jahr }, anschluss: { oecdDezember: aktien.vorjahr, ezbDezember: kurse.vorjahr },
            vorlaeufig: aktien.vorlaeufig || kurse.vorlaeufig };
    },
    'german-cpi-chain': (dateien, jahr) => {
        const seite = text(dateien, 'antwort-destatis-vpi.html');
        const auszug = text(dateien, 'rohauszug-destatis-vpi.html');
        if (!seite && !auszug) throw new BelegFehler('kein Destatis-Beleg im Format der Leser');
        // Der Auszug aus dem Original enthält nur die beiden Tabellen; mit den Eintragsmarken liest ihn derselbe Leser.
        const html = seite ? seite.inhalt : auszug.inhalt.split('</table>').filter(teil => teil.includes('<caption>')).map((teil, index) => (
            `<div class="c-toggle__entry" id="${index === 0 ? DESTATIS_LEVEL_TABLE.entryId : DESTATIS_RATE_TABLE.entryId}">${teil}</table>`)).join('\n');
        const vpi = vpiLesen(html);
        const fuer = y => ({ jahresrate: muss(vpi.raten.get(y), `Rate ${y}`), indexstand: muss(vpi.index.get(y), `Index ${y}`) });
        return { werte: fuer(jahr), anschluss: fuer(jahr - 1), basis: vpi.basis, vorlaeufig: vpi.vorlaeufig };
    },
    'german-cash-money-market-chain': (dateien, jahr) => {
        const estr = text(dateien, 'antwort-ezb-estr.csv');
        const bbk = text(dateien, 'rohauszug-bundesbank-tagesgeld.txt');
        if (estr) {
            const tage = estrLesen(estr.inhalt, jahr);
            const werte = { jahresmittel: tage.jahr.mittel };
            const monate = text(dateien, 'antwort-bundesbank-bbmmb.csv');
            if (monate) {
                const mittel = monatsmittelLesen(monate.inhalt, jahr);
                if (mittel.anzahl === 12) werte.monatsmittel = mittel.mittel;
            }
            return { werte, anschluss: { jahresmittel: tage.vorjahr.mittel }, vorlaeufig: tage.jahr.vorlaeufig || tage.vorjahr.vorlaeufig };
        }
        if (!bbk) throw new BelegFehler('kein €STR- oder Bundesbank-Beleg im Format der Leser');
        const zeilen = new Map();
        for (const zeile of bbk.inhalt.split(/\r?\n/)) {
            const match = zeile.match(/^\s*(\d{4})\s+(-\s*)?(\d+\.\d+)(?:\s|$)/);
            if (match) zeilen.set(Number(match[1]), Number(`${match[2] ? '-' : ''}${match[3]}`));
        }
        return { werte: { jahresmittel: muss(zeilen.get(jahr), `Jahresmittel ${jahr}`) }, anschluss: { jahresmittel: muss(zeilen.get(jahr - 1), `Jahresmittel ${jahr - 1}`) } };
    },
    'german-gross-wage-growth-chain': (dateien, jahr) => {
        const seite = text(dateien, 'antwort-destatis-verdienste.html');
        const beleg = seite || text(dateien, 'rohauszug-destatis-verdienste.html');
        if (!beleg) throw new BelegFehler('kein Destatis-Beleg im Format der Leser');
        const { zeilen, doppelt, basis, vorlaeufig } = seite ? verdiensteLesen(seite.inhalt) : verdiensteZeilen(beleg.inhalt);
        const fuer = y => {
            if (doppelt.has(y)) throw new BelegFehler(`Jahr ${y} steht mehrfach im Beleg`);
            return muss(zeilen.get(y), `Jahr ${y}`);
        };
        return { werte: fuer(jahr), anschluss: fuer(jahr - 1), basis, vorlaeufig };
    },
    'gold-german-investor-chain': (dateien, jahr) => {
        const preis = text(dateien, 'rohauszug-weltbank-gold-jahr.csv', 'rohauszug-weltbank-gold.csv');
        const kurs = text(dateien, 'antwort-bundesbank-usd-eur.csv', 'rohauszug-bundesbank-usd-eur.csv');
        if (!preis || !kurs) throw new BelegFehler('kein Weltbank- und Bundesbank-Beleg im Format der Leser');
        const preise = new Map();
        for (const zeile of preis.inhalt.split(/\r?\n/)) {
            const match = zeile.match(/^(\d{4});(.*)$/);
            if (match) {
                if (preise.has(Number(match[1]))) throw new BelegFehler(`Goldpreis ${match[1]} steht mehrfach im Beleg`);
                preise.set(Number(match[1]), strengeZahl(match[2]));
            }
        }
        const kurse = kursLesen(kurs.inhalt, jahr);
        return { werte: { goldUsdJeUnze: muss(preise.get(jahr), `Goldpreis ${jahr}`), usdJeEur: kurse.jahr },
            anschluss: { goldUsdJeUnze: muss(preise.get(jahr - 1), `Goldpreis ${jahr - 1}`), usdJeEur: kurse.vorjahr } };
    },
    'us-shiller-cape-chain': (dateien, jahr) => {
        const beleg = text(dateien, 'rohauszug-shiller-cape.csv');
        if (!beleg) throw new BelegFehler('kein Shiller-Auszug im Format der Leser');
        const [kopf, ...zeilen] = beleg.inhalt.split(/\r?\n/).filter(Boolean);
        if (kopf !== 'Date,CAPE') throw new BelegFehler('Shiller-Auszug ohne Kopf Date,CAPE');
        const dezember = new Map(), doppelteJahre = new Set();
        for (const zeile of zeilen) {
            const [datum, wert] = zeile.split(',');
            const roh = strengeZahl(datum);
            if (roh === null) continue;
            const jahrDerZeile = Math.floor(roh + 1e-8);
            if (Math.round((roh - jahrDerZeile) * 100) !== 12) continue;
            if (dezember.has(jahrDerZeile)) doppelteJahre.add(jahrDerZeile);
            dezember.set(jahrDerZeile, strengeZahl(wert));
        }
        const fuer = y => ({ cape: doppelteJahre.size ? dezember.get(y) : muss(dezember.get(y), `CAPE Dezember ${y}`) });
        return { werte: fuer(jahr - 1), anschluss: fuer(jahr - 2), doppelteJahre };
    }
};

/**
 * Liest die Belegdateien einer Lieferung mit dem Leser der Kette. Wirft BelegFehler, wenn kein Leser passt.
 * @param {string} root @param {any} KETTE @param {any} lieferung
 * @returns {{werte: Record<string, any>, anschluss: Record<string, any>, basis?: string, vorlaeufig?: boolean, doppelteJahre?: Set<number>}}
 */
export function belegWerte(root, KETTE, lieferung) {
    const ordner = lieferungsOrdner(root, KETTE.id, lieferung.jahr);
    const dateien = new Map((lieferung.rohdaten ?? []).map(eintrag => [eintrag.datei, fs.readFileSync(path.join(ordner, eintrag.datei))]));
    try {
        return LESER[KETTE.id](dateien, lieferung.jahr);
    } catch (error) {
        if (error instanceof BelegFehler) throw error;
        throw new BelegFehler(error?.message ?? String(error));
    }
}

/**
 * Vergleicht jedes gelieferte Feld mit dem Beleg. Fehlt ein Feld im Beleg, ist das eine Abweichung.
 * @param {any} KETTE @param {any} lieferung @param {{werte: any, anschluss: any}} beleg
 * @returns {{teil: string, feld: string, geliefert: number, beleg: number | null, toleranz: number}[]} Abweichungen.
 */
export function belegAbweichungen(KETTE, lieferung, beleg) {
    const abweichungen = [];
    for (const [teil, geliefert, belegt] of [['Wert', lieferung.werte, beleg.werte], ['Anschluss', lieferung.anschluss?.werte, beleg.anschluss]]) {
        for (const [feld, spec] of Object.entries(KETTE.werte)) {
            if (geliefert?.[feld] === undefined) continue;
            // Optionale Felder (Geldmarkt-Monatsmittel) gehören zum Wert Y; im Anschluss prüft sie nur die Anschlussregel.
            if (teil === 'Anschluss' && spec.optional) continue;
            const toleranz = KETTE.anschluss.toleranz[feld] ?? STANDARD_TOLERANZ;
            const paare = spec.gruppe ? spec.gruppe.map(key => [`${feld}.${key}`, geliefert[feld][key], belegt?.[feld]?.[key]]) : [[feld, geliefert[feld], belegt?.[feld]]];
            for (const [name, wert, soll] of paare) {
                if (!(Number.isFinite(soll) && Math.abs(wert - soll) <= toleranz + 1e-12)) abweichungen.push({ teil, feld: name, geliefert: wert, beleg: Number.isFinite(soll) ? soll : null, toleranz });
            }
        }
    }
    return abweichungen;
}
