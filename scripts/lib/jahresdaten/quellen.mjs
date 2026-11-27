/**
 * `npm run jahresdaten -- --quellen [<Jahr>]`: Testmodus, der nur prüft, ob die Quellen erreichbar und lesbar sind.
 *
 * Je Kette und Quelle, auch Ersatz (Bundesbank für die EZB) und Gegenprüfung (BBMMB, CMO-Monatswerte), meldet der
 * Modus: erreichbar (HTTP-Status), Format erkannt (Parser greift, Pflichtfelder da), neuester verfügbarer Stand.
 * Mit Jahr zusätzlich je Kette, ob Y vorhanden ist und mit welchem Status; dafür läuft der Leser von `--holen` im
 * Speicher mit denselben Antworten. Der Modus schreibt nichts. Exit 0 alles erreichbar und lesbar, 1 eine Quelle nicht
 * lesbar, 2 eine Quelle nicht erreichbar.
 */
import { KETTEN } from './ketten.mjs';
import { LESER } from './holen.mjs';
import { AbrufFehler, netzAbruf } from './leser/netz.mjs';
import { csvZeilen, OffenFehler, strengeZahl } from './leser/gemeinsam.mjs';
import { COUNTRY_CURRENCIES } from './ketten/aktien.mjs';
import { lesen as capeKette } from './ketten/cape.mjs';
import * as aktien from './leser/aktien.mjs';
import * as inflation from './leser/inflation.mjs';
import * as geldmarkt from './leser/geldmarkt.mjs';
import * as lohn from './leser/lohn.mjs';
import * as gold from './leser/gold.mjs';
import * as cape from './leser/cape.mjs';
import { readXlsxSheetRows } from './xlsx.mjs';
import { readBiff8Sheet } from '../biff8-numeric-sheet.mjs';

const ISOS = Object.keys(COUNTRY_CURRENCIES);
const WAEHRUNGEN = [...new Set(Object.values(COUNTRY_CURRENCIES))].filter(code => code !== 'EUR');

/** Neueste Periode einer SDMX-CSV mit lesbarem Wert; ohne passende Zeile ist das Format nicht erkannt. */
function neuesteCsv(text, { trenner = ',', passt = () => true, was }) {
    const zeilen = csvZeilen(text, trenner);
    if (!zeilen.length || !('TIME_PERIOD' in zeilen[0]) || !('OBS_VALUE' in zeilen[0])) throw new OffenFehler(`${was}: Spalten TIME_PERIOD und OBS_VALUE fehlen`);
    const perioden = zeilen.filter(row => passt(row) && strengeZahl(row.OBS_VALUE) !== null).map(row => row.TIME_PERIOD).sort();
    if (!perioden.length) throw new OffenFehler(`${was}: keine lesbaren Werte`);
    return perioden.at(-1);
}

const neuestesJahr = (werte, was) => {
    const jahre = [...werte.entries()].filter(([, wert]) => wert !== null && wert !== undefined).map(([jahr]) => jahr).sort((a, b) => a - b);
    if (!jahre.length) throw new OffenFehler(`${was}: keine lesbaren Jahreswerte`);
    return String(jahre.at(-1));
};

/**
 * Quellen je Kette in der Reihenfolge von KETTEN. `stand` liest die Antwort mit den Parsern der Leser und gibt den
 * neuesten Stand zurück; ein Fehler darin heißt „Format nicht erkannt“.
 * @param {{root: string, blattLesen?: Function, xlsxZeilen?: Function}} optionen
 */
function quellenListe({ root, blattLesen = readBiff8Sheet, xlsxZeilen = readXlsxSheetRows }) {
    return [
        { kette: 'global-equity-research-chain', name: 'OECD Aktienkurse', url: jahr => aktien.quellen(jahr).oecd,
            stand: antwort => neuesteCsv(antwort.text(), { was: 'OECD', passt: row => ISOS.includes(row.REF_AREA) && row.MEASURE === 'SHARE' }) },
        { kette: 'global-equity-research-chain', name: 'EZB Kurse (EXR)', url: jahr => aktien.quellen(jahr).ezb,
            stand: antwort => neuesteCsv(antwort.text(), { was: 'EZB', passt: row => WAEHRUNGEN.includes(row.CURRENCY) }) },
        { kette: 'global-equity-research-chain', name: 'Bundesbank BBEX3 A02 (Ersatz)', url: jahr => aktien.quellen(jahr).bundesbank,
            stand: antwort => neuesteCsv(antwort.text(), { trenner: ';', was: 'Bundesbank', passt: row => WAEHRUNGEN.includes(row.BBK_STD_CURRENCY) }) },
        { kette: 'german-cpi-chain', name: 'Destatis VPI', url: () => inflation.SEITE,
            stand: antwort => neuestesJahr(inflation.vpiLesen(antwort.text()).index, 'Destatis VPI') },
        { kette: 'german-cash-money-market-chain', name: 'EZB €STR', url: jahr => geldmarkt.quellen(jahr).estr,
            stand: antwort => neuesteCsv(antwort.text(), { was: 'EZB €STR', passt: row => /^\d{4}-\d{2}-\d{2}$/.test(row.TIME_PERIOD) }) },
        { kette: 'german-cash-money-market-chain', name: 'Bundesbank BBMMB (Gegenprüfung)', url: jahr => geldmarkt.quellen(jahr).bbmmb,
            stand: antwort => neuesteCsv(antwort.text(), { trenner: ';', was: 'BBMMB' }) },
        { kette: 'german-gross-wage-growth-chain', name: 'Destatis Verdienste', url: () => lohn.SEITE,
            stand: antwort => neuestesJahr(lohn.verdiensteLesen(antwort.text()).zeilen, 'Destatis Verdienste') },
        { kette: 'gold-german-investor-chain', name: 'Weltbank CMO Jahrespreise', url: jahr => gold.quellen(jahr).jahrespreise,
            stand: antwort => goldStand(xlsxZeilen, antwort.bytes, gold.JAHRESBLATT) },
        { kette: 'gold-german-investor-chain', name: 'Weltbank CMO Monatswerte (Gegenprüfung)', url: jahr => gold.quellen(jahr).monatspreise,
            stand: antwort => goldStand(xlsxZeilen, antwort.bytes, gold.MONATSBLATT) },
        { kette: 'gold-german-investor-chain', name: 'Bundesbank USD/EUR A04', url: jahr => gold.quellen(jahr).kurs,
            stand: antwort => neuesteCsv(antwort.text(), { trenner: ';', was: 'Bundesbank USD/EUR', passt: row => row.BBK_STD_CURRENCY === 'USD' }) },
        { kette: 'us-shiller-cape-chain', name: 'shillerdata.com (Link)', url: () => cape.SEITE,
            stand: antwort => `Link ${new URL(cape.dateiLink(antwort.text())).pathname.split('/').pop()}` },
        { kette: 'us-shiller-cape-chain', name: 'Shiller ie_data.xls', url: null, link: true,
            stand: antwort => {
                let blatt;
                try {
                    blatt = blattLesen(antwort.bytes, capeKette(root).method.sourceSheet);
                } catch (error) {
                    throw new OffenFehler(`Shiller-Arbeitsmappe nicht lesbar (${error.message})`);
                }
                return cape.capeStand(blatt, capeKette(root).method);
            } }
    ];
}

function goldStand(xlsxZeilen, bytes, blatt) {
    let rows;
    try {
        rows = xlsxZeilen(bytes, blatt);
    } catch (error) {
        throw new OffenFehler(`Weltbank-Arbeitsmappe, Blatt „${blatt}“ nicht lesbar (${error.message})`);
    }
    const werte = gold.goldWerte(rows, blatt);
    if (!werte.length) throw new OffenFehler(`Weltbank, Blatt „${blatt}“: keine lesbaren Goldwerte`);
    return werte.at(-1).periode.replace(/^(\d{4})M(\d{2})$/, '$1-$2');
}

/** Abruf mit Zwischenspeicher: Jede Adresse wird höchstens einmal angefragt, auch Fehler werden gemerkt. */
function zwischengespeichert(abrufen) {
    const gemerkt = new Map();
    return adresse => {
        if (!gemerkt.has(adresse)) gemerkt.set(adresse, abrufen(adresse));
        return gemerkt.get(adresse);
    };
}

/**
 * Prüft alle Quellen. Schreibt nichts.
 * @param {{root: string, jahr?: number, heute?: string, abrufen?: import('./leser/netz.mjs').Abruf, leserOptionen?: object}} optionen
 *   `jahr` fehlt: Abfragefenster des laufenden Jahres, keine Aussage zu einem Datenjahr.
 */
export async function quellenPruefen({ root, jahr, heute = new Date().toISOString().slice(0, 10), abrufen = netzAbruf, leserOptionen = {} }) {
    const fenster = jahr ?? Number(heute.slice(0, 4));
    const abruf = zwischengespeichert(abrufen);
    const zeilen = [];
    let shillerLink = null;
    for (const quelle of quellenListe({ root, ...leserOptionen })) {
        const zeile = { kette: quelle.kette, label: KETTEN.find(modul => modul.KETTE.id === quelle.kette).KETTE.label, quelle: quelle.name,
            erreichbar: false, http: null, format: false, stand: '', fehler: '' };
        const url = quelle.link ? shillerLink : quelle.url(fenster);
        if (!url) {
            zeile.fehler = 'kein Link auf die Datei';
            zeilen.push(zeile);
            continue;
        }
        let antwort;
        try {
            antwort = await abruf(url);
        } catch (error) {
            zeile.http = error instanceof AbrufFehler ? error.status : null;
            zeile.fehler = error?.message ?? String(error);
            zeilen.push(zeile);
            continue;
        }
        Object.assign(zeile, { erreichbar: true, http: antwort.status });
        try {
            zeile.stand = quelle.stand(antwort);
            zeile.format = true;
            if (quelle.kette === 'us-shiller-cape-chain' && !quelle.link) shillerLink = cape.dateiLink(antwort.text());
        } catch (error) {
            zeile.fehler = error?.message ?? String(error);
        }
        zeilen.push(zeile);
    }
    const ketten = [];
    if (jahr !== undefined) {
        for (const modul of KETTEN) {
            try {
                const { lieferung } = await LESER[modul.KETTE.id].holen({ root, jahr, abrufen: abruf, ...leserOptionen });
                ketten.push({ kette: modul.KETTE.id, label: modul.KETTE.label, jahr: lieferung.status, grund: lieferung.hinweis ?? '' });
            } catch (error) {
                ketten.push({ kette: modul.KETTE.id, label: modul.KETTE.label, jahr: 'fehlt', grund: error?.message ?? String(error) });
            }
        }
    }
    const exit = zeilen.some(zeile => !zeile.erreichbar) ? 2 : zeilen.some(zeile => !zeile.format) ? 1 : 0;
    return { jahr: jahr ?? null, fenster, zeilen, ketten, exit };
}

/** Terminaltabelle. @param {Awaited<ReturnType<typeof quellenPruefen>>} ergebnis @returns {string[]} */
export function quellenText(ergebnis) {
    const kopf = ['Kette', 'Quelle', 'erreichbar', 'Format', 'neuester Stand'];
    const reihen = ergebnis.zeilen.map(zeile => [zeile.label, zeile.quelle,
        zeile.erreichbar ? `ja (${zeile.http})` : `nein${zeile.http ? ` (${zeile.http})` : ''}`,
        zeile.erreichbar ? (zeile.format ? 'ja' : 'nein') : '–',
        zeile.format ? zeile.stand : zeile.fehler]);
    const breiten = kopf.map((titel, index) => Math.max(titel.length, ...reihen.map(reihe => String(reihe[index]).length)));
    const formatieren = reihe => reihe.map((zelle, index) => (index === reihe.length - 1 ? zelle : String(zelle).padEnd(breiten[index]))).join('  ');
    const text = [`Quellen der Jahresdaten${ergebnis.jahr ? `, Datenjahr ${ergebnis.jahr}` : `, Abfragefenster ${ergebnis.fenster}`} (Testmodus, schreibt nichts)`,
        formatieren(kopf), ...reihen.map(formatieren)];
    if (ergebnis.ketten.length) {
        text.push(`Datenjahr ${ergebnis.jahr} je Kette:`);
        for (const item of ergebnis.ketten) text.push(`  ${item.label}: ${item.jahr === 'fehlt' ? `fehlt (${item.grund})` : item.jahr}${item.jahr === 'vorlaeufig' && item.grund ? ` (${item.grund})` : ''}`);
    }
    text.push(`Ergebnis: ${['alle Quellen erreichbar und lesbar', 'mindestens eine Quelle nicht lesbar', 'mindestens eine Quelle nicht erreichbar'][ergebnis.exit]} (Exit ${ergebnis.exit})`);
    return text;
}
