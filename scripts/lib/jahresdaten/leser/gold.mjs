/**
 * Leser Gold: Weltbank-CMO-Jahrespreis (Pink Sheet, USD je Feinunze) und Bundesbank-Jahresmittel USD/EUR (BBEX3 A04).
 * Gegenprüfung: Mittel der zwölf CMO-Monatswerte, Abstand unter 0,5 %. Weichen die Werte stärker ab oder fehlen
 * Monate, gilt die Lieferung als vorläufig. Die Arbeitsmappen sind groß (rund 3,8 MB); ins Repo kommt nur ein Auszug
 * der benötigten Zeilen mit dem SHA-256 der abgerufenen Datei.
 */
import { KETTE } from '../ketten/gold.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { sha256 } from '../kanonisch.mjs';
import { readXlsxSheetRows } from '../xlsx.mjs';
import { csvZeilen, datumAus, genauEiner, OffenFehler, standAus, strengeZahl, vorFrist } from './gemeinsam.mjs';
import { AbrufFehler } from './netz.mjs';

const CMO = 'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/';
export const JAHRESBLATT = 'Annual Prices (Nominal)';
export const MONATSBLATT = 'Monthly Prices';
const GRENZE_MONATSMITTEL = 0.005;

/** @param {number} jahr */
export function quellen(jahr) {
    return {
        jahrespreise: `${CMO}CMO-Historical-Data-Annual.xlsx`,
        monatspreise: `${CMO}CMO-Historical-Data-Monthly.xlsx`,
        kurs: `https://api.statistiken.bundesbank.de/rest/data/BBEX3/A.USD.EUR.BB.AC.A04?startPeriod=${jahr - 1}&endPeriod=${jahr}&format=sdmx_csv&lang=de`
    };
}

/** Endgültig ab (Ideengespräch: Januar, sicher Februar). */
export const ENDGUELTIG_AB = '02-01';
export const STATUSREGEL = 'endgültig ab 1. Februar des Folgejahres und nur mit bestandener Gegenprüfung: zwölf CMO-Monatswerte, deren Mittel weniger als 0,5 % vom Jahrespreis abweicht; sonst vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: ['Weltbank, Commodity Markets, Pink Sheet Data, „Annual prices“ (CMO-Historical-Data-Annual.xlsx), Blatt „Annual Prices (Nominal)“', 'Bundesbank-Zeitreihe BBEX3.A.USD.EUR.BB.AC.A04 (Jahresdurchschnitt USD je EUR)'],
    zahlen: 'Goldpreis in USD je Feinunze für Y und Y−1 (Spalte „Gold“) und USD je EUR für Y und Y−1 mit vier Stellen.',
    beleg: 'Auszug der Arbeitsmappe (Kopfzeilen mit „Updated on …“ und die Zeilen Y−1 und Y) als CSV, dazu der SHA-256 der Arbeitsmappe; die Bundesbank-CSV unverändert.'
});

/** @param {string[][]} rows @param {string} blatt */
function goldSpalte(rows, blatt) {
    const kopf = rows.findIndex(row => row.includes('Gold'));
    if (kopf < 0) throw new OffenFehler(`Weltbank-Arbeitsmappe: Blatt „${blatt}“ ohne Spalte Gold`);
    return { kopf, spalte: rows[kopf].indexOf('Gold'), stand: rows.find(row => /^Updated on /.test(row[0] ?? ''))?.[0] ?? '' };
}

/**
 * Alle lesbaren Goldwerte eines Blatts (Periode wie in Spalte A, z. B. 2025 oder 2025M12), für `--quellen`.
 * @param {string[][]} rows @param {string} blatt @returns {{periode: string, wert: number}[]}
 */
export function goldWerte(rows, blatt) {
    const { kopf, spalte } = goldSpalte(rows, blatt);
    return rows.slice(kopf + 1).map(row => ({ periode: String(row[0] ?? '').trim(), wert: strengeZahl(row[spalte]) }))
        .filter(item => /^\d{4}(M(0[1-9]|1[0-2]))?$/.test(item.periode) && item.wert !== null);
}

/** @param {string[][]} rows @param {number} jahr */
export function jahrespreiseLesen(rows, jahr) {
    const { kopf, spalte, stand } = goldSpalte(rows, JAHRESBLATT);
    const zeileFuer = y => genauEiner(rows.slice(kopf + 1).filter(row => String(row[0]).trim() === String(y)), `Weltbank-Jahreszeile ${y}`);
    const fehlt = [jahr - 1, jahr].filter(y => !zeileFuer(y));
    if (fehlt.length) throw new OffenFehler(`Weltbank-Jahrespreis Gold fehlt für ${fehlt.join(', ')}`);
    const unlesbar = [jahr - 1, jahr].filter(y => strengeZahl(zeileFuer(y)[spalte]) === null);
    if (unlesbar.length) throw new OffenFehler(`Weltbank-Jahrespreis Gold für ${unlesbar.join(', ')} ist leer oder nicht numerisch`);
    const auszug = ['Zeile;Gold (USD/troy oz), Blatt Annual Prices (Nominal)', `Stand;${stand}`, ...[jahr - 1, jahr].map(y => `${y};${zeileFuer(y)[spalte]}`)].join('\n');
    return { jahr: strengeZahl(zeileFuer(jahr)[spalte]), vorjahr: strengeZahl(zeileFuer(jahr - 1)[spalte]), stand, auszug: `${auszug}\n` };
}

/** @param {string[][]} rows @param {number} jahr */
export function monatspreiseLesen(rows, jahr) {
    const { kopf, spalte, stand } = goldSpalte(rows, MONATSBLATT);
    const alle = rows.slice(kopf + 1).filter(row => new RegExp(`^${jahr}M(0[1-9]|1[0-2])$`).test(String(row[0]).trim()));
    if (new Set(alle.map(row => String(row[0]).trim())).size !== alle.length) throw new OffenFehler(`Weltbank-Monatswerte ${jahr}: ein Monat kommt mehrfach vor`);
    const monate = alle.filter(row => strengeZahl(row[spalte]) !== null);
    const mittel = monate.length ? monate.reduce((summe, row) => summe + strengeZahl(row[spalte]), 0) / monate.length : NaN;
    const auszug = ['Monat;Gold (USD/troy oz), Blatt Monthly Prices', `Stand;${stand}`, ...monate.map(row => `${row[0]};${row[spalte]}`)].join('\n');
    return { anzahl: monate.length, mittel, stand, auszug: `${auszug}\n` };
}

/** @param {string} text @param {number} jahr */
export function kursLesen(text, jahr) {
    const zeilen = csvZeilen(text, ';');
    const zeileFuer = y => genauEiner(zeilen.filter(row => row.TIME_PERIOD === String(y) && row.BBK_STD_CURRENCY === 'USD'), `Bundesbank-Zeile USD/EUR ${y}`);
    const fehlt = [jahr - 1, jahr].filter(y => strengeZahl(zeileFuer(y)?.OBS_VALUE) === null);
    if (fehlt.length) throw new OffenFehler(`Bundesbank-Jahresmittel USD/EUR fehlt für ${fehlt.join(', ')} oder ist nicht numerisch`);
    return { jahr: strengeZahl(zeileFuer(jahr).OBS_VALUE), vorjahr: strengeZahl(zeileFuer(jahr - 1).OBS_VALUE) };
}

/** Arbeitsmappe lesen; HTML statt XLSX oder ein umbenanntes Blatt ergibt eine offene Lieferung. */
function arbeitsmappe(xlsxZeilen, bytes, blatt) {
    try {
        return xlsxZeilen(bytes, blatt);
    } catch (error) {
        throw new OffenFehler(`Weltbank-Arbeitsmappe, Blatt „${blatt}“ nicht lesbar (${error.message})`);
    }
}

/**
 * @param {{jahr: number, abrufen: import('./netz.mjs').Abruf, xlsxZeilen?: typeof readXlsxSheetRows}} input
 */
export async function holen({ jahr, abrufen, xlsxZeilen = readXlsxSheetRows }) {
    const urls = quellen(jahr);
    const jahresAntwort = await abrufen(urls.jahrespreise);
    const preise = jahrespreiseLesen(arbeitsmappe(xlsxZeilen, jahresAntwort.bytes, JAHRESBLATT), jahr);
    const kursAntwort = await abrufen(urls.kurs);
    const kurs = kursLesen(kursAntwort.text(), jahr);
    const hinweise = [];
    let vorlaeufig = false;
    let monatsAntwort = null, monate = null;
    try {
        monatsAntwort = await abrufen(urls.monatspreise);
        monate = monatspreiseLesen(arbeitsmappe(xlsxZeilen, monatsAntwort.bytes, MONATSBLATT), jahr);
    } catch (error) {
        if (!(error instanceof AbrufFehler) && !(error instanceof OffenFehler)) throw error;
        monate = null;
        vorlaeufig = true;
        hinweise.push(`Vorläufig: Gegenprüfung mit den CMO-Monatswerten nicht möglich (${error.message}).`);
    }
    if (monate) {
        const abstand = Math.abs(preise.jahr / monate.mittel - 1);
        if (monate.anzahl !== 12) {
            vorlaeufig = true;
            hinweise.push(`CMO-Monatswerte ${jahr}: nur ${monate.anzahl} von 12 Monaten; Jahreswert vorläufig.`);
        } else if (!(abstand < GRENZE_MONATSMITTEL)) {
            vorlaeufig = true;
            hinweise.push(`Jahrespreis ${preise.jahr} weicht ${(abstand * 100).toFixed(2)} % vom Mittel der Monatswerte ${monate.mittel.toFixed(2)} ab (Grenze 0,5 %).`);
        } else {
            hinweise.push(`Gegenprüfung: Mittel der zwölf Monatswerte ${monate.mittel.toFixed(2)}, Abstand ${(abstand * 100).toFixed(2)} %.`);
        }
    }
    if (vorFrist(jahresAntwort.abgerufen, jahr, ENDGUELTIG_AB)) {
        vorlaeufig = true;
        hinweise.push(`Vorläufig: Abruf vor dem 1. Februar ${jahr + 1}.`);
    }
    const werte = { goldUsdJeUnze: preise.jahr, usdJeEur: kurs.jahr };
    const rohdateien = [
        { datei: 'rohauszug-weltbank-gold-jahr.csv', inhalt: Buffer.from(preise.auszug, 'utf8'), art: 'auszug', originalDatei: urls.jahrespreise, originalSha256: sha256(jahresAntwort.bytes) },
        { datei: 'antwort-bundesbank-usd-eur.csv', inhalt: kursAntwort.bytes, art: 'antwort' }
    ];
    if (monate) rohdateien.push({ datei: 'rohauszug-weltbank-gold-monate.csv', inhalt: Buffer.from(monate.auszug, 'utf8'), art: 'auszug', originalDatei: urls.monatspreise, originalSha256: sha256(monatsAntwort.bytes) });
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            anschluss: { jahr: jahr - 1, werte: { goldUsdJeUnze: preise.vorjahr, usdJeEur: kurs.vorjahr } },
            quelle: {
                name: 'Weltbank Commodity Price Data (Pink Sheet), Gold, Jahresdurchschnitt; Bundesbank BBEX3 USD/EUR Jahresdurchschnitt',
                url: urls.jahrespreise,
                abrufdatum: datumAus(jahresAntwort.abgerufen),
                veroeffentlichungsstand: `Weltbank ${preise.stand || standAus(jahresAntwort, { datei: true })}; Bundesbank ${standAus(kursAntwort)}`
            },
            methode: 'abgerufen: Weltbank-Jahrespreis Gold und Bundesbank-Jahresmittel USD/EUR für Y und Y−1; Gegenprüfung mit dem Mittel der CMO-Monatswerte',
            lieferant: 'skript',
            status: vorlaeufig ? 'vorlaeufig' : 'endgueltig',
            hinweis: [`Kurs: ${urls.kurs}`, ...hinweise].join(' '),
            rohdateien
        })
    };
}
