/**
 * Leser Lohn: Destatis-Seite „index-brutto-monatsverdienst-jahr-erbbau“ (Index der Bruttomonatsverdienste ohne
 * Sonderzahlungen, Jahreswerte, Veränderung zum Vorjahr). Jeder Stand ersetzt die ganze Reihe; ältere Jahre gehen
 * als `alteJahre` in die Lieferung und erscheinen im Prüfbericht, wenn sie vom gespeicherten Stand abweichen.
 */
import { gespeichert, KETTE, lesen } from '../ketten/lohn.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { datumAus, destatisStand, OffenFehler, standAus, strengeZahl, vorFrist } from './gemeinsam.mjs';

export const SEITE = 'https://www.destatis.de/DE/Themen/Arbeit/Verdienste/Verdienste-Branche-Berufe/Tabellen/index-brutto-monatsverdienst-jahr-erbbau.html';
const ZEILE = /<tr><td class="Vorspalte">(\d{4})<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g;

export function quellen() {
    return { seite: SEITE };
}

/** Endgültig ab (Ideengespräch: Anfang März). */
export const ENDGUELTIG_AB = '03-01';
export const STATUSREGEL = 'endgültig ab 1. März des Folgejahres, solange die Seite kein „vorläufig“ trägt; sonst vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: [`${SEITE} (Tabelle „Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen“, Jahre)`],
    zahlen: 'Indexstand (Basis laut Seite, z. B. 2025 = 100) und Veränderung zum Vorjahr in Prozent für Y und Y−1, je eine Stelle.',
    beleg: 'Die ganze HTML-Seite unverändert speichern (Seitenstand des Abrufs, „Stand …“ steht auf der Seite).'
});

/** Zellwert streng: Fußnoten oder andere Auszeichnung in der Zelle, leere und nicht numerische Werte ergeben null. @param {string} value */
function zahl(value) {
    if (/</.test(value)) return null;
    return strengeZahl(value.replace(/&nbsp;/g, ' ').replace(/&minus;/g, '-'), { komma: true });
}

/** @param {string} html */
export function verdiensteLesen(html) {
    const seite = verdiensteZeilen(html);
    if (!seite.basis) throw new OffenFehler('Destatis-Seite: Indexbasis (JJJJ = 100) fehlt');
    return { ...seite, stand: destatisStand(html) };
}

/**
 * Nur die Jahreszeilen (Index, Veränderung), auch aus einem Auszug ohne Seitenkopf; für die Belegprüfung.
 * @param {string} html
 */
export function verdiensteZeilen(html) {
    const zeilen = new Map(), doppelt = new Set(), unlesbar = new Set();
    for (const match of html.matchAll(ZEILE)) {
        const jahr = Number(match[1]);
        if (zeilen.has(jahr) || unlesbar.has(jahr)) doppelt.add(jahr);
        const indexstand = zahl(match[2]), veraenderung = zahl(match[3]);
        if (indexstand !== null && veraenderung !== null) zeilen.set(jahr, { indexstand, veraenderung });
        else unlesbar.add(jahr);
    }
    if (!zeilen.size) throw new OffenFehler('Destatis-Seite: keine Jahreszeilen gefunden');
    const basis = html.match(/(\d{4})\s*=\s*100/)?.[1];
    return { zeilen, doppelt, unlesbar, basis: basis ? `${basis}=100` : undefined, vorlaeufig: /vorläufig/i.test(html) };
}

/**
 * @param {{root: string, jahr: number, abrufen: import('./netz.mjs').Abruf}} input
 */
export async function holen({ root, jahr, abrufen }) {
    const antwort = await abrufen(SEITE);
    const seite = verdiensteLesen(antwort.text());
    const doppelt = [jahr - 1, jahr].filter(y => seite.doppelt.has(y));
    if (doppelt.length) throw new OffenFehler(`Destatis-Tabelle: Jahr ${doppelt.join(', ')} kommt mehrfach vor`);
    const unlesbar = [jahr - 1, jahr].filter(y => seite.unlesbar.has(y));
    if (unlesbar.length) throw new OffenFehler(`Destatis-Tabelle: Zelle für ${unlesbar.join(', ')} ist leer oder nicht numerisch`);
    const fehlt = [jahr - 1, jahr].filter(y => !seite.zeilen.has(y));
    if (fehlt.length) throw new OffenFehler(`Destatis zeigt noch keinen Jahreswert für ${fehlt.join(', ')}`);
    const chain = lesen(root);
    const alteJahre = {};
    for (const y of [...seite.zeilen.keys()].filter(y => y < jahr - 1 && !seite.doppelt.has(y)).sort()) {
        const stand = gespeichert(chain, y, root);
        if (Number.isFinite(stand?.veraenderung) && Number.isFinite(stand?.indexstand) && stand.basis?.indexstand === seite.basis) alteJahre[y] = seite.zeilen.get(y);
    }
    const werte = seite.zeilen.get(jahr);
    const hinweise = [];
    if (vorFrist(antwort.abgerufen, jahr, ENDGUELTIG_AB)) hinweise.push(`Vorläufig: Abruf vor dem 1. März ${jahr + 1}.`);
    if (seite.vorlaeufig) hinweise.push('Vorläufig: Die Destatis-Seite kennzeichnet Werte als vorläufig.');
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            basis: { indexstand: seite.basis },
            anschluss: { jahr: jahr - 1, werte: seite.zeilen.get(jahr - 1) },
            quelle: {
                name: 'Destatis, Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen, Jahre',
                url: SEITE,
                abrufdatum: datumAus(antwort.abgerufen),
                veroeffentlichungsstand: seite.stand || standAus(antwort)
            },
            methode: 'abgerufen: Indexstand und veröffentlichte Veränderung zum Vorjahr für Y und Y−1 aus der Destatis-Tabelle',
            lieferant: 'skript',
            status: hinweise.length ? 'vorlaeufig' : 'endgueltig',
            ...(hinweise.length ? { hinweis: hinweise.join(' ') } : {}),
            ...(Object.keys(alteJahre).length ? { alteJahre } : {}),
            rohdateien: [{ datei: 'antwort-destatis-verdienste.html', inhalt: antwort.bytes, art: 'antwort' }]
        })
    };
}
