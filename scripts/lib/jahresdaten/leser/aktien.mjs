/**
 * Leser Aktien: OECD-Aktienkursindizes Dezember Y−1 und Y je Land, EZB-Monatskurse Dezember Y−1 und Y.
 * Fällt die EZB aus, nimmt der Leser die Bundesbank-Monatsdurchschnitte BBEX3 (A02). Die Bundesbank
 * rundet auf fünf Stellen; dann passt der Anschluss Dezember Y−1 nicht zur Toleranz und die Prüfung zeigt rot.
 */
import { COUNTRY_CURRENCIES, KETTE } from '../ketten/aktien.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { csvZeilen, datumAus, genauEiner, OffenFehler, standAus, strengeZahl, vorFrist } from './gemeinsam.mjs';
import { AbrufFehler } from './netz.mjs';

const ISOS = Object.keys(COUNTRY_CURRENCIES);
const WAEHRUNGEN = [...new Set(Object.values(COUNTRY_CURRENCIES))].filter(code => code !== 'EUR').sort();

/** @param {number} jahr */
export function quellen(jahr) {
    const von = `${jahr - 1}-12`, bis = `${jahr}-12`;
    return {
        oecd: `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/${ISOS.join('+')}.M.SHARE.IX._Z._Z._Z._Z.N?startPeriod=${von}&endPeriod=${bis}&dimensionAtObservation=AllDimensions&format=csvfilewithlabels`,
        ezb: `https://data-api.ecb.europa.eu/service/data/EXR/M.${WAEHRUNGEN.join('+')}.EUR.SP00.A?startPeriod=${von}&endPeriod=${bis}&format=csvdata`,
        bundesbank: `https://api.statistiken.bundesbank.de/rest/data/BBEX3/M.${WAEHRUNGEN.join('+')}.EUR.BB.AC.A02?startPeriod=${von}&endPeriod=${bis}&format=sdmx_csv&lang=de`
    };
}

/** Endgültig ab (Ideengespräch: OECD mit zwei bis vier Wochen Verzug). */
export const ENDGUELTIG_AB = '02-01';
export const STATUSREGEL = 'endgültig ab 1. Februar des Folgejahres und nur, wenn alle OECD- und EZB-Werte den Status A tragen; sonst vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: ['OECD Data Explorer, Share prices (DF_FINMARK), Monatswerte, Messgröße SHARE, Einheit Index', 'EZB Data Portal, Referenzkurse EXR, Monatsdurchschnitt (SP00.A)'],
    zahlen: `Je Land (${ISOS.join(', ')}) der OECD-Index für Dezember Y und Dezember Y−1 mit allen Nachkommastellen; je Währung (${WAEHRUNGEN.join(', ')}) der EZB-Monatsdurchschnitt Dezember Y und Y−1 in Währungseinheiten je EUR.`,
    beleg: 'Die beiden CSV-Antworten der Schnittstellen (OECD csvfilewithlabels, EZB csvdata) unverändert speichern.'
});

/** @param {string} text @param {number} jahr */
export function oecdLesen(text, jahr) {
    const perioden = [`${jahr - 1}-12`, `${jahr}-12`];
    const zeilen = csvZeilen(text).filter(row => ISOS.includes(row.REF_AREA) && perioden.includes(row.TIME_PERIOD) && row.MEASURE === 'SHARE');
    const fehlt = [];
    const werteFuer = periode => Object.fromEntries(ISOS.map(iso => {
        const row = genauEiner(zeilen.filter(item => item.REF_AREA === iso && item.TIME_PERIOD === periode), `OECD-Zeile ${iso} ${periode}`);
        const wert = strengeZahl(row?.OBS_VALUE);
        if (wert === null) fehlt.push(`${iso} ${periode}`);
        return [iso, wert];
    }));
    const werte = { jahr: werteFuer(perioden[1]), vorjahr: werteFuer(perioden[0]) };
    if (fehlt.length) throw new OffenFehler(`OECD liefert noch keinen Wert für ${fehlt.join(', ')}`);
    return { ...werte, vorlaeufig: zeilen.some(row => row.OBS_STATUS !== 'A') };
}

/**
 * EZB-CSV (Spalten CURRENCY, OBS_STATUS) oder Bundesbank-SDMX-CSV (BBK_STD_CURRENCY, Semikolon).
 * @param {string} text @param {number} jahr @param {'ezb' | 'bundesbank'} quelle
 */
export function kurseLesen(text, jahr, quelle) {
    const perioden = [`${jahr - 1}-12`, `${jahr}-12`];
    const zeilen = csvZeilen(text, quelle === 'ezb' ? ',' : ';').map(row => ({
        waehrung: quelle === 'ezb' ? row.CURRENCY : row.BBK_STD_CURRENCY, periode: row.TIME_PERIOD, wert: row.OBS_VALUE,
        status: quelle === 'ezb' ? row.OBS_STATUS : 'A'
    })).filter(row => WAEHRUNGEN.includes(row.waehrung) && perioden.includes(row.periode));
    const fehlt = [];
    const werteFuer = periode => Object.fromEntries(WAEHRUNGEN.map(code => {
        const row = genauEiner(zeilen.filter(item => item.waehrung === code && item.periode === periode), `Kurszeile ${code} ${periode}`);
        const wert = strengeZahl(row?.wert);
        if (wert === null) fehlt.push(`${code} ${periode}`);
        return [code, wert];
    }));
    const werte = { jahr: werteFuer(perioden[1]), vorjahr: werteFuer(perioden[0]) };
    if (fehlt.length) throw new OffenFehler(`${quelle === 'ezb' ? 'EZB' : 'Bundesbank'} liefert noch keinen Kurs für ${fehlt.join(', ')}`);
    return { ...werte, vorlaeufig: zeilen.some(row => row.status !== 'A') };
}

/**
 * @param {{jahr: number, abrufen: import('./netz.mjs').Abruf}} input
 */
export async function holen({ jahr, abrufen }) {
    const urls = quellen(jahr);
    const oecdAntwort = await abrufen(urls.oecd);
    const oecd = oecdLesen(oecdAntwort.text(), jahr);
    const hinweise = [];
    let kursAntwort, kurse, kursQuelle = 'ezb';
    try {
        kursAntwort = await abrufen(urls.ezb);
        kurse = kurseLesen(kursAntwort.text(), jahr, 'ezb');
    } catch (error) {
        if (!(error instanceof AbrufFehler)) throw error;
        hinweise.push(`EZB nicht erreichbar (${error.message}); Ersatz Bundesbank BBEX3 A02. Die Bundesbank rundet auf fünf Stellen, der Anschluss Dezember ${jahr - 1} kann deshalb rot sein.`);
        kursQuelle = 'bundesbank';
        kursAntwort = await abrufen(urls.bundesbank);
        kurse = kurseLesen(kursAntwort.text(), jahr, 'bundesbank');
    }
    const frist = vorFrist(oecdAntwort.abgerufen, jahr, ENDGUELTIG_AB);
    if (frist) hinweise.push(`Vorläufig: Abruf vor dem 1. Februar ${jahr + 1}.`);
    if (oecd.vorlaeufig || kurse.vorlaeufig) hinweise.push('Vorläufig: Die Quelle kennzeichnet Werte nicht mit Status A.');
    const werte = { oecdDezember: oecd.jahr, ezbDezember: kurse.jahr };
    const kursName = kursQuelle === 'ezb' ? 'EZB-Referenzkurse (EXR), Monatsdurchschnitt' : 'Bundesbank BBEX3, Monatsdurchschnitt der EZB-Referenzkurse (A02)';
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            anschluss: { jahr: jahr - 1, werte: { oecdDezember: oecd.vorjahr, ezbDezember: kurse.vorjahr } },
            quelle: {
                name: `OECD Share prices (DF_FINMARK 4.0) und ${kursName}`,
                url: urls.oecd,
                abrufdatum: datumAus(oecdAntwort.abgerufen),
                veroeffentlichungsstand: `OECD ${standAus(oecdAntwort)}; ${kursQuelle === 'ezb' ? 'EZB' : 'Bundesbank'} ${standAus(kursAntwort)}`
            },
            methode: `abgerufen: Dezemberwerte Y und Y−1 aus der OECD-Schnittstelle und ${kursQuelle === 'ezb' ? 'der EZB-Schnittstelle' : 'der Bundesbank-Schnittstelle (Ersatz für die EZB)'}`,
            lieferant: 'skript',
            status: frist || oecd.vorlaeufig || kurse.vorlaeufig ? 'vorlaeufig' : 'endgueltig',
            hinweis: [`Kurse: ${kursAntwort.url}`, ...hinweise].join(' '),
            rohdateien: [
                { datei: 'antwort-oecd.csv', inhalt: oecdAntwort.bytes, art: 'antwort' },
                { datei: kursQuelle === 'ezb' ? 'antwort-ezb-exr.csv' : 'antwort-bundesbank-bbex3.csv', inhalt: kursAntwort.bytes, art: 'antwort' }
            ]
        })
    };
}
